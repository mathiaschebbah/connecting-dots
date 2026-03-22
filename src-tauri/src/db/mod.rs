use anyhow::Result;
use rusqlite::Connection;
use std::path::Path;
use std::sync::Mutex;

use crate::embeddings::EMBEDDING_DIM;
use crate::twitter::clix::ClixTweet;

pub struct Database {
    conn: Mutex<Connection>,
}

impl Database {
    pub fn open(path: &Path) -> Result<Self> {
        // Register sqlite-vec extension before opening
        unsafe {
            rusqlite::ffi::sqlite3_auto_extension(Some(std::mem::transmute(
                sqlite_vec::sqlite3_vec_init as *const (),
            )));
        }

        let conn = Connection::open(path)?;
        conn.execute_batch("PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON;")?;
        let db = Self {
            conn: Mutex::new(conn),
        };
        db.migrate()?;
        Ok(db)
    }

    fn migrate(&self) -> Result<()> {
        let conn = self.conn.lock().unwrap();

        // Core schema
        let schema = include_str!("schema.sql");
        conn.execute_batch(schema)?;


        // Vector index (sqlite-vec, created at runtime)
        conn.execute_batch(&format!(
            "CREATE VIRTUAL TABLE IF NOT EXISTS tweets_vec USING vec0(
                tweet_id TEXT PRIMARY KEY,
                embedding float[{EMBEDDING_DIM}]
            );"
        ))?;

        Ok(())
    }

    pub fn conn(&self) -> std::sync::MutexGuard<'_, Connection> {
        self.conn.lock().unwrap()
    }

    // ── Insert / Update ──

    /// Insert tweets from clix, skipping duplicates. Returns count of new tweets inserted.
    pub fn upsert_tweets(&self, tweets: &[ClixTweet], source: &str) -> Result<u32> {
        let conn = self.conn.lock().unwrap();
        let now = chrono::Utc::now().to_rfc3339();
        let mut count = 0u32;

        let mut stmt = conn.prepare_cached(
            "INSERT OR IGNORE INTO tweets (
                id, author_id, author_handle, author_name, author_verified,
                content, created_at, conversation_id, language, tweet_url,
                reply_to_id, reply_to_handle, is_retweet, retweeted_by,
                media_json, quoted_tweet_json,
                likes, retweets, replies_count, quotes, bookmarks_count, views,
                source, fetched_at, raw_json
            ) VALUES (
                ?1, ?2, ?3, ?4, ?5,
                ?6, ?7, ?8, ?9, ?10,
                ?11, ?12, ?13, ?14,
                ?15, ?16,
                ?17, ?18, ?19, ?20, ?21, ?22,
                ?23, ?24, ?25
            )",
        )?;

        for tweet in tweets {
            let engagement = tweet.engagement.as_ref();
            let media_json = tweet
                .media
                .as_ref()
                .map(|m| serde_json::to_string(m).unwrap_or_default());
            let quoted_json = tweet
                .quoted_tweet
                .as_ref()
                .map(|q| serde_json::to_string(q).unwrap_or_default());
            let raw = serde_json::to_string(tweet).unwrap_or_default();

            let rows = stmt.execute(rusqlite::params![
                tweet.id,
                tweet.author_id,
                tweet.author_handle,
                tweet.author_name,
                tweet.author_verified.unwrap_or(false) as i32,
                tweet.text,
                tweet.created_at,
                tweet.conversation_id,
                tweet.language,
                tweet.tweet_url,
                tweet.reply_to_id,
                tweet.reply_to_handle,
                tweet.is_retweet.unwrap_or(false) as i32,
                tweet.retweeted_by,
                media_json,
                quoted_json,
                engagement.and_then(|e| e.likes).unwrap_or(0),
                engagement.and_then(|e| e.retweets).unwrap_or(0),
                engagement.and_then(|e| e.replies).unwrap_or(0),
                engagement.and_then(|e| e.quotes).unwrap_or(0),
                engagement.and_then(|e| e.bookmarks).unwrap_or(0),
                engagement.and_then(|e| e.views).unwrap_or(0),
                source,
                now,
                raw,
            ])?;

            if rows > 0 {
                count += 1;
            }

            if source == "bookmark" {
                // Upgrade source to bookmark (feed tweets found in bookmarks)
                conn.execute(
                    "UPDATE tweets SET source = 'bookmark' WHERE id = ?1",
                    rusqlite::params![tweet.id],
                )?;
            }
        }

        Ok(count)
    }

    /// Set bookmark_order for a list of tweet IDs (in bookmarking order, index 0 = most recent)
    /// Only assigns order to tweets that exist in DB, preserving relative order.
    pub fn set_bookmark_order(&self, tweet_ids: &[String]) -> Result<()> {
        let conn = self.conn.lock().unwrap();
        let mut stmt = conn.prepare_cached(
            "UPDATE tweets SET bookmark_order = ?1 WHERE id = ?2 AND source = 'bookmark'",
        )?;
        let mut order = 0i64;
        for id in tweet_ids {
            let changed = stmt.execute(rusqlite::params![order, id])?;
            if changed > 0 {
                order += 1;
            }
        }
        log::info!("set_bookmark_order: assigned order to {} bookmarks", order);
        Ok(())
    }

    /// Store embedding for a tweet
    pub fn store_embedding(&self, tweet_id: &str, embedding: &[f32]) -> Result<()> {
        let conn = self.conn.lock().unwrap();

        // Delete existing entry first (vec0 tables don't support OR REPLACE)
        let _ = conn.execute("DELETE FROM tweets_vec WHERE tweet_id = ?1", rusqlite::params![tweet_id]);

        // Store in sqlite-vec virtual table
        conn.execute(
            "INSERT INTO tweets_vec (tweet_id, embedding) VALUES (?1, ?2)",
            rusqlite::params![tweet_id, f32_slice_to_bytes(embedding)],
        )?;

        // Also store in tweets table blob column
        conn.execute(
            "UPDATE tweets SET embedding = ?1 WHERE id = ?2",
            rusqlite::params![f32_slice_to_bytes(embedding), tweet_id],
        )?;

        Ok(())
    }

    /// Get tweet IDs that have no embedding yet
    pub fn tweets_without_embedding(&self, limit: u32) -> Result<Vec<(String, String)>> {
        let conn = self.conn.lock().unwrap();
        let mut stmt = conn.prepare(
            "SELECT id, content FROM tweets WHERE embedding IS NULL LIMIT ?1",
        )?;
        let rows = stmt.query_map(rusqlite::params![limit], |row| {
            Ok((row.get::<_, String>(0)?, row.get::<_, String>(1)?))
        })?;
        let mut results = Vec::new();
        for row in rows {
            results.push(row?);
        }
        Ok(results)
    }

    /// Semantic search via sqlite-vec KNN
    pub fn search_semantic(&self, query_embedding: &[f32], limit: u32) -> Result<Vec<TweetRow>> {
        let conn = self.conn.lock().unwrap();
        let mut stmt = conn.prepare(
            "SELECT t.id, t.author_handle, t.author_name, t.content, t.created_at,
                    t.tweet_url, t.likes, t.retweets, t.replies_count, t.views, t.source, t.ai_category, t.ai_summary, t.ai_type, t.ai_topics,
                    (t.media_json IS NOT NULL AND t.media_json != '[]') as has_media
             FROM tweets t
             JOIN tweets_vec v ON t.id = v.tweet_id
             WHERE v.embedding MATCH ?1
             AND k = ?2
             ORDER BY distance",
        )?;

        let rows = stmt.query_map(
            rusqlite::params![f32_slice_to_bytes(query_embedding), limit],
            |row| {
                Ok(TweetRow {
                    id: row.get(0)?,
                    author_handle: row.get(1)?,
                    author_name: row.get(2)?,
                    content: row.get(3)?,
                    created_at: row.get(4)?,
                    tweet_url: row.get(5)?,
                    likes: row.get(6)?,
                    retweets: row.get(7)?,
                    replies_count: row.get(8)?,
                    views: row.get(9)?,
                    source: row.get(10)?,
                    ai_category: row.get(11)?,
                    ai_summary: row.get(12)?,
                    ai_type: row.get(13)?,
                    ai_topics: row.get::<_, Option<String>>(14)?.and_then(|s| serde_json::from_str(&s).ok()).unwrap_or_default(),
                    has_media: row.get::<_, i32>(15).unwrap_or(0) != 0,
                })
            },
        )?;

        let mut tweets = Vec::new();
        for row in rows {
            tweets.push(row?);
        }
        Ok(tweets)
    }

    // ── Queries ──

    /// Get total tweet count
    pub fn tweet_count(&self) -> Result<u32> {
        let conn = self.conn.lock().unwrap();
        let count: u32 = conn.query_row("SELECT COUNT(*) FROM tweets", [], |row| row.get(0))?;
        Ok(count)
    }

    /// Get tweets ordered by created_at desc, optionally filtered by source
    pub fn list_tweets(
        &self,
        limit: u32,
        offset: u32,
        source_filter: Option<&str>,
    ) -> Result<Vec<TweetRow>> {
        let conn = self.conn.lock().unwrap();

        let query = if source_filter.is_some() {
            "SELECT id, author_handle, author_name, content, created_at,
                    tweet_url, likes, retweets, replies_count, views, source, ai_category, ai_summary, ai_type, ai_topics,
                    (media_json IS NOT NULL AND media_json != '[]') as has_media
             FROM tweets WHERE source = ?3 ORDER BY bookmark_order ASC LIMIT ?1 OFFSET ?2"
        } else {
            "SELECT id, author_handle, author_name, content, created_at,
                    tweet_url, likes, retweets, replies_count, views, source, ai_category, ai_summary, ai_type, ai_topics,
                    (media_json IS NOT NULL AND media_json != '[]') as has_media
             FROM tweets ORDER BY created_at DESC LIMIT ?1 OFFSET ?2"
        };

        let mut stmt = conn.prepare(query)?;

        let map_row = |row: &rusqlite::Row| -> rusqlite::Result<TweetRow> {
            Ok(TweetRow {
                id: row.get(0)?,
                author_handle: row.get(1)?,
                author_name: row.get(2)?,
                content: row.get(3)?,
                created_at: row.get(4)?,
                tweet_url: row.get(5)?,
                likes: row.get(6)?,
                retweets: row.get(7)?,
                replies_count: row.get(8)?,
                views: row.get(9)?,
                source: row.get(10)?,
                ai_category: row.get(11)?,
                ai_summary: row.get(12)?,
                ai_type: row.get(13)?,
                ai_topics: row.get::<_, Option<String>>(14)?.and_then(|s| serde_json::from_str(&s).ok()).unwrap_or_default(),
                has_media: row.get::<_, i32>(15).unwrap_or(0) != 0,
            })
        };

        let mut tweets = Vec::new();
        if let Some(src) = source_filter {
            let rows = stmt.query_map(rusqlite::params![limit, offset, src], map_row)?;
            for row in rows { tweets.push(row?); }
        } else {
            let rows = stmt.query_map(rusqlite::params![limit, offset], map_row)?;
            for row in rows { tweets.push(row?); }
        }
        Ok(tweets)
    }

    /// Full-text search
    pub fn search_fulltext(
        &self,
        query: &str,
        limit: u32,
        source_filter: Option<&str>,
    ) -> Result<Vec<TweetRow>> {
        let conn = self.conn.lock().unwrap();

        let sql = if source_filter.is_some() {
            "SELECT t.id, t.author_handle, t.author_name, t.content, t.created_at,
                    t.tweet_url, t.likes, t.retweets, t.replies_count, t.views, t.source, t.ai_category, t.ai_summary, t.ai_type, t.ai_topics,
                    (t.media_json IS NOT NULL AND t.media_json != '[]') as has_media
             FROM tweets t
             JOIN tweets_fts fts ON t.rowid = fts.rowid
             WHERE tweets_fts MATCH ?1 AND t.source = ?3
             ORDER BY rank
             LIMIT ?2"
        } else {
            "SELECT t.id, t.author_handle, t.author_name, t.content, t.created_at,
                    t.tweet_url, t.likes, t.retweets, t.replies_count, t.views, t.source, t.ai_category, t.ai_summary, t.ai_type, t.ai_topics,
                    (t.media_json IS NOT NULL AND t.media_json != '[]') as has_media
             FROM tweets t
             JOIN tweets_fts fts ON t.rowid = fts.rowid
             WHERE tweets_fts MATCH ?1
             ORDER BY rank
             LIMIT ?2"
        };

        let mut stmt = conn.prepare(sql)?;

        let map_row = |row: &rusqlite::Row| -> rusqlite::Result<TweetRow> {
            Ok(TweetRow {
                id: row.get(0)?,
                author_handle: row.get(1)?,
                author_name: row.get(2)?,
                content: row.get(3)?,
                created_at: row.get(4)?,
                tweet_url: row.get(5)?,
                likes: row.get(6)?,
                retweets: row.get(7)?,
                replies_count: row.get(8)?,
                views: row.get(9)?,
                source: row.get(10)?,
                ai_category: row.get(11)?,
                ai_summary: row.get(12)?,
                ai_type: row.get(13)?,
                ai_topics: row.get::<_, Option<String>>(14)?.and_then(|s| serde_json::from_str(&s).ok()).unwrap_or_default(),
                has_media: row.get::<_, i32>(15).unwrap_or(0) != 0,
            })
        };

        let mut tweets = Vec::new();
        if let Some(src) = source_filter {
            let rows = stmt.query_map(rusqlite::params![query, limit, src], map_row)?;
            for row in rows { tweets.push(row?); }
        } else {
            let rows = stmt.query_map(rusqlite::params![query, limit], map_row)?;
            for row in rows { tweets.push(row?); }
        }
        Ok(tweets)
    }

    // ── AI Metadata ──

    /// Get a single tweet with all fields
    pub fn get_tweet_full(&self, tweet_id: &str) -> Result<Option<TweetFull>> {
        let conn = self.conn.lock().unwrap();
        let mut stmt = conn.prepare(
            "SELECT id, author_id, author_handle, author_name, author_verified,
                    content, created_at, conversation_id, language, tweet_url,
                    reply_to_id, reply_to_handle, is_retweet, retweeted_by,
                    media_json, quoted_tweet_json,
                    likes, retweets, replies_count, quotes, bookmarks_count, views,
                    source, ai_category, ai_summary, ai_topics, ai_type, embedding
             FROM tweets WHERE id = ?1",
        )?;
        let result = stmt.query_row(rusqlite::params![tweet_id], |row| {
            let embedding_blob: Option<Vec<u8>> = row.get(27)?;
            let has_embedding = embedding_blob.is_some();
            let topics_raw: Option<String> = row.get(25)?;
            let topics: Vec<String> = topics_raw
                .and_then(|s| serde_json::from_str(&s).ok())
                .unwrap_or_default();
            Ok(TweetFull {
                id: row.get(0)?,
                author_id: row.get(1)?,
                author_handle: row.get(2)?,
                author_name: row.get(3)?,
                author_verified: row.get::<_, i32>(4)? != 0,
                content: row.get(5)?,
                created_at: row.get(6)?,
                conversation_id: row.get(7)?,
                language: row.get(8)?,
                tweet_url: row.get(9)?,
                reply_to_id: row.get(10)?,
                reply_to_handle: row.get(11)?,
                is_retweet: row.get::<_, i32>(12)? != 0,
                retweeted_by: row.get(13)?,
                media_json: row.get(14)?,
                quoted_tweet_json: row.get(15)?,
                likes: row.get(16)?,
                retweets: row.get(17)?,
                replies_count: row.get(18)?,
                quotes: row.get(19)?,
                bookmarks_count: row.get(20)?,
                views: row.get(21)?,
                source: row.get(22)?,
                ai_category: row.get(23)?,
                ai_summary: row.get(24)?,
                ai_topics: topics,
                ai_type: row.get(26)?,
                has_embedding,
            })
        });
        match result {
            Ok(t) => Ok(Some(t)),
            Err(rusqlite::Error::QueryReturnedNoRows) => Ok(None),
            Err(e) => Err(e.into()),
        }
    }

    /// Get embedding for a tweet
    pub fn get_embedding(&self, tweet_id: &str) -> Result<Option<Vec<f32>>> {
        let conn = self.conn.lock().unwrap();
        let result: Result<Vec<u8>, _> = conn.query_row(
            "SELECT embedding FROM tweets WHERE id = ?1 AND embedding IS NOT NULL",
            rusqlite::params![tweet_id],
            |row| row.get(0),
        );
        match result {
            Ok(blob) => {
                let embedding: Vec<f32> = blob
                    .chunks_exact(4)
                    .map(|b| f32::from_le_bytes([b[0], b[1], b[2], b[3]]))
                    .collect();
                Ok(Some(embedding))
            }
            Err(rusqlite::Error::QueryReturnedNoRows) => Ok(None),
            Err(e) => Err(e.into()),
        }
    }

    // ── Tags ──

    /// Get all tags
    pub fn list_tags(&self) -> Result<Vec<Tag>> {
        let conn = self.conn.lock().unwrap();
        let mut stmt = conn.prepare("SELECT id, name, color FROM tags ORDER BY name")?;
        let rows = stmt.query_map([], |row| {
            Ok(Tag { id: row.get(0)?, name: row.get(1)?, color: row.get(2)? })
        })?;
        let mut tags = Vec::new();
        for row in rows { tags.push(row?); }
        Ok(tags)
    }

    /// Create a tag, returns its ID
    pub fn create_tag(&self, name: &str, color: Option<&str>) -> Result<i64> {
        let conn = self.conn.lock().unwrap();
        conn.execute(
            "INSERT OR IGNORE INTO tags (name, color) VALUES (?1, ?2)",
            rusqlite::params![name, color],
        )?;
        let id: i64 = conn.query_row(
            "SELECT id FROM tags WHERE name = ?1",
            rusqlite::params![name],
            |row| row.get(0),
        )?;
        Ok(id)
    }

    /// Assign a tag to a tweet
    pub fn tag_tweet(&self, tweet_id: &str, tag_id: i64) -> Result<()> {
        let conn = self.conn.lock().unwrap();
        conn.execute(
            "INSERT OR IGNORE INTO tweet_tags (tweet_id, tag_id) VALUES (?1, ?2)",
            rusqlite::params![tweet_id, tag_id],
        )?;
        Ok(())
    }

    /// Remove a tag from a tweet
    pub fn untag_tweet(&self, tweet_id: &str, tag_id: i64) -> Result<()> {
        let conn = self.conn.lock().unwrap();
        conn.execute(
            "DELETE FROM tweet_tags WHERE tweet_id = ?1 AND tag_id = ?2",
            rusqlite::params![tweet_id, tag_id],
        )?;
        Ok(())
    }

    /// Get tags for a tweet
    pub fn get_tweet_tags(&self, tweet_id: &str) -> Result<Vec<Tag>> {
        let conn = self.conn.lock().unwrap();
        let mut stmt = conn.prepare(
            "SELECT t.id, t.name, t.color FROM tags t JOIN tweet_tags tt ON t.id = tt.tag_id WHERE tt.tweet_id = ?1 ORDER BY t.name",
        )?;
        let rows = stmt.query_map(rusqlite::params![tweet_id], |row| {
            Ok(Tag { id: row.get(0)?, name: row.get(1)?, color: row.get(2)? })
        })?;
        let mut tags = Vec::new();
        for row in rows { tags.push(row?); }
        Ok(tags)
    }

    /// Get tweets without AI metadata
    pub fn tweets_without_ai_metadata(&self, limit: u32) -> Result<Vec<(String, String)>> {
        let conn = self.conn.lock().unwrap();
        let mut stmt = conn.prepare(
            "SELECT id, content FROM tweets WHERE ai_enriched_at IS NULL ORDER BY CASE WHEN source = 'bookmark' THEN 0 ELSE 1 END LIMIT ?1",
        )?;
        let rows = stmt.query_map(rusqlite::params![limit], |row| {
            Ok((row.get::<_, String>(0)?, row.get::<_, String>(1)?))
        })?;
        let mut results = Vec::new();
        for row in rows {
            results.push(row?);
        }
        Ok(results)
    }

    /// Update AI metadata for a tweet
    pub fn update_ai_metadata(
        &self,
        tweet_id: &str,
        category: &str,
        summary: &str,
        topics: &str,
        tweet_type: &str,
    ) -> Result<()> {
        let conn = self.conn.lock().unwrap();
        let now = chrono::Utc::now().to_rfc3339();
        conn.execute(
            "UPDATE tweets SET ai_category = ?1, ai_summary = ?2, ai_topics = ?3, ai_type = ?4, ai_enriched_at = ?5 WHERE id = ?6",
            rusqlite::params![category, summary, topics, tweet_type, now, tweet_id],
        )?;
        Ok(())
    }

    // ── Projects ──

    pub fn list_projects(&self) -> Result<Vec<Project>> {
        let conn = self.conn.lock().unwrap();
        let mut stmt = conn.prepare("SELECT id, name, description, color, created_at FROM projects ORDER BY created_at DESC")?;
        let rows = stmt.query_map([], |row| {
            Ok(Project {
                id: row.get(0)?,
                name: row.get(1)?,
                description: row.get(2)?,
                color: row.get(3)?,
                created_at: row.get(4)?,
            })
        })?;
        let mut projects = Vec::new();
        for row in rows { projects.push(row?); }
        Ok(projects)
    }

    pub fn create_project(&self, name: &str, description: Option<&str>, color: Option<&str>) -> Result<Project> {
        let conn = self.conn.lock().unwrap();
        let now = chrono::Utc::now().to_rfc3339();
        conn.execute(
            "INSERT INTO projects (name, description, color, created_at) VALUES (?1, ?2, ?3, ?4)",
            rusqlite::params![name, description, color, now],
        )?;
        let id = conn.last_insert_rowid();
        Ok(Project { id, name: name.to_string(), description: description.map(String::from), color: color.map(String::from), created_at: now })
    }

    pub fn delete_project(&self, id: i64) -> Result<()> {
        let conn = self.conn.lock().unwrap();
        // Delete cards in project's columns first
        conn.execute(
            "DELETE FROM kanban_cards WHERE column_id IN (SELECT id FROM kanban_columns WHERE project_id = ?1)",
            rusqlite::params![id],
        )?;
        conn.execute("DELETE FROM kanban_columns WHERE project_id = ?1", rusqlite::params![id])?;
        conn.execute("DELETE FROM project_accounts WHERE project_id = ?1", rusqlite::params![id])?;
        conn.execute("DELETE FROM groups WHERE project_id = ?1", rusqlite::params![id])?;
        conn.execute("DELETE FROM projects WHERE id = ?1", rusqlite::params![id])?;
        Ok(())
    }

    // ── Kanban ──

    pub fn list_kanban_columns(&self, project_id: i64) -> Result<Vec<KanbanColumn>> {
        let conn = self.conn.lock().unwrap();
        let mut stmt = conn.prepare(
            "SELECT id, project_id, name, position FROM kanban_columns WHERE project_id = ?1 ORDER BY position"
        )?;
        let rows = stmt.query_map(rusqlite::params![project_id], |row| {
            Ok(KanbanColumn { id: row.get(0)?, project_id: row.get(1)?, name: row.get(2)?, position: row.get(3)? })
        })?;
        let mut cols = Vec::new();
        for row in rows { cols.push(row?); }
        Ok(cols)
    }

    pub fn create_kanban_column(&self, project_id: i64, name: &str) -> Result<KanbanColumn> {
        let conn = self.conn.lock().unwrap();
        let max_pos: i64 = conn.query_row(
            "SELECT COALESCE(MAX(position), -1) FROM kanban_columns WHERE project_id = ?1",
            rusqlite::params![project_id],
            |row| row.get(0),
        )?;
        let position = max_pos + 1;
        conn.execute(
            "INSERT INTO kanban_columns (project_id, name, position) VALUES (?1, ?2, ?3)",
            rusqlite::params![project_id, name, position],
        )?;
        let id = conn.last_insert_rowid();
        Ok(KanbanColumn { id, project_id, name: name.to_string(), position })
    }

    pub fn delete_kanban_column(&self, id: i64) -> Result<()> {
        let conn = self.conn.lock().unwrap();
        conn.execute("DELETE FROM kanban_cards WHERE column_id = ?1", rusqlite::params![id])?;
        conn.execute("DELETE FROM kanban_columns WHERE id = ?1", rusqlite::params![id])?;
        Ok(())
    }

    pub fn list_kanban_cards(&self, column_id: i64) -> Result<Vec<KanbanCard>> {
        let conn = self.conn.lock().unwrap();
        let mut stmt = conn.prepare(
            "SELECT k.id, k.column_id, k.tweet_id, k.note, k.position, t.author_handle, substr(t.content, 1, 200)
             FROM kanban_cards k LEFT JOIN tweets t ON k.tweet_id = t.id
             WHERE k.column_id = ?1 ORDER BY k.position"
        )?;
        let rows = stmt.query_map(rusqlite::params![column_id], |row| {
            Ok(KanbanCard {
                id: row.get(0)?,
                column_id: row.get(1)?,
                tweet_id: row.get(2)?,
                note: row.get(3)?,
                position: row.get(4)?,
                author_handle: row.get(5)?,
                content: row.get(6)?,
            })
        })?;
        let mut cards = Vec::new();
        for row in rows { cards.push(row?); }
        Ok(cards)
    }

    pub fn create_kanban_card(&self, column_id: i64, tweet_id: &str, note: Option<&str>) -> Result<KanbanCard> {
        let conn = self.conn.lock().unwrap();
        let max_pos: i64 = conn.query_row(
            "SELECT COALESCE(MAX(position), -1) FROM kanban_cards WHERE column_id = ?1",
            rusqlite::params![column_id],
            |row| row.get(0),
        )?;
        let position = max_pos + 1;
        conn.execute(
            "INSERT INTO kanban_cards (column_id, tweet_id, note, position) VALUES (?1, ?2, ?3, ?4)",
            rusqlite::params![column_id, tweet_id, note, position],
        )?;
        let id = conn.last_insert_rowid();
        // Fetch denormalized tweet info
        let (author, content) = conn.query_row(
            "SELECT author_handle, substr(content, 1, 200) FROM tweets WHERE id = ?1",
            rusqlite::params![tweet_id],
            |row| Ok((row.get::<_, Option<String>>(0)?, row.get::<_, Option<String>>(1)?)),
        ).unwrap_or((None, None));
        Ok(KanbanCard { id, column_id, tweet_id: tweet_id.to_string(), note: note.map(String::from), position, author_handle: author, content })
    }

    pub fn move_kanban_card(&self, card_id: i64, target_column_id: i64, target_position: i64) -> Result<()> {
        let conn = self.conn.lock().unwrap();
        // Shift existing cards at target position
        conn.execute(
            "UPDATE kanban_cards SET position = position + 1 WHERE column_id = ?1 AND position >= ?2",
            rusqlite::params![target_column_id, target_position],
        )?;
        conn.execute(
            "UPDATE kanban_cards SET column_id = ?1, position = ?2 WHERE id = ?3",
            rusqlite::params![target_column_id, target_position, card_id],
        )?;
        Ok(())
    }

    pub fn delete_kanban_card(&self, id: i64) -> Result<()> {
        let conn = self.conn.lock().unwrap();
        conn.execute("DELETE FROM kanban_cards WHERE id = ?1", rusqlite::params![id])?;
        Ok(())
    }

    // ── Tweet Notes ──

    pub fn get_tweet_notes(&self, tweet_id: &str) -> Result<Vec<TweetNote>> {
        let conn = self.conn.lock().unwrap();
        let mut stmt = conn.prepare(
            "SELECT id, tweet_id, content, created_at, updated_at FROM tweet_notes WHERE tweet_id = ?1 ORDER BY created_at DESC"
        )?;
        let rows = stmt.query_map(rusqlite::params![tweet_id], |row| {
            Ok(TweetNote {
                id: row.get(0)?,
                tweet_id: row.get(1)?,
                content: row.get(2)?,
                created_at: row.get(3)?,
                updated_at: row.get(4)?,
            })
        })?;
        let mut notes = Vec::new();
        for row in rows { notes.push(row?); }
        Ok(notes)
    }

    pub fn create_tweet_note(&self, tweet_id: &str, content: &str) -> Result<TweetNote> {
        let conn = self.conn.lock().unwrap();
        let now = chrono::Utc::now().to_rfc3339();
        conn.execute(
            "INSERT INTO tweet_notes (tweet_id, content, created_at, updated_at) VALUES (?1, ?2, ?3, ?4)",
            rusqlite::params![tweet_id, content, now, now],
        )?;
        let id = conn.last_insert_rowid();
        Ok(TweetNote { id, tweet_id: tweet_id.to_string(), content: content.to_string(), created_at: now.clone(), updated_at: now })
    }

    pub fn update_tweet_note(&self, note_id: i64, content: &str) -> Result<()> {
        let conn = self.conn.lock().unwrap();
        let now = chrono::Utc::now().to_rfc3339();
        conn.execute(
            "UPDATE tweet_notes SET content = ?1, updated_at = ?2 WHERE id = ?3",
            rusqlite::params![content, now, note_id],
        )?;
        Ok(())
    }

    pub fn delete_tweet_note(&self, note_id: i64) -> Result<()> {
        let conn = self.conn.lock().unwrap();
        conn.execute("DELETE FROM tweet_notes WHERE id = ?1", rusqlite::params![note_id])?;
        Ok(())
    }

    // ── Groups ──

    pub fn list_groups(&self, project_id: i64) -> Result<Vec<Group>> {
        let conn = self.conn.lock().unwrap();
        let mut stmt = conn.prepare(
            "SELECT g.id, g.project_id, g.name, g.description, g.color,
                    (SELECT COUNT(*) FROM tweet_groups tg WHERE tg.group_id = g.id) as tweet_count
             FROM groups g WHERE g.project_id = ?1 ORDER BY g.name"
        )?;
        let rows = stmt.query_map(rusqlite::params![project_id], |row| {
            Ok(Group {
                id: row.get(0)?, project_id: row.get(1)?, name: row.get(2)?,
                description: row.get(3)?, color: row.get(4)?, tweet_count: row.get(5)?,
            })
        })?;
        let mut groups = Vec::new();
        for row in rows { groups.push(row?); }
        Ok(groups)
    }

    pub fn create_group(&self, project_id: i64, name: &str, color: Option<&str>) -> Result<Group> {
        let conn = self.conn.lock().unwrap();
        conn.execute(
            "INSERT INTO groups (project_id, name, color) VALUES (?1, ?2, ?3)",
            rusqlite::params![project_id, name, color],
        )?;
        let id = conn.last_insert_rowid();
        Ok(Group { id, project_id, name: name.to_string(), description: None, color: color.map(String::from), tweet_count: 0 })
    }

    pub fn delete_group(&self, group_id: i64) -> Result<()> {
        let conn = self.conn.lock().unwrap();
        conn.execute("DELETE FROM tweet_groups WHERE group_id = ?1", rusqlite::params![group_id])?;
        conn.execute("DELETE FROM groups WHERE id = ?1", rusqlite::params![group_id])?;
        Ok(())
    }

    pub fn add_tweet_to_group(&self, tweet_id: &str, group_id: i64) -> Result<()> {
        let conn = self.conn.lock().unwrap();
        conn.execute(
            "INSERT OR IGNORE INTO tweet_groups (tweet_id, group_id) VALUES (?1, ?2)",
            rusqlite::params![tweet_id, group_id],
        )?;
        Ok(())
    }

    pub fn remove_tweet_from_group(&self, tweet_id: &str, group_id: i64) -> Result<()> {
        let conn = self.conn.lock().unwrap();
        conn.execute(
            "DELETE FROM tweet_groups WHERE tweet_id = ?1 AND group_id = ?2",
            rusqlite::params![tweet_id, group_id],
        )?;
        Ok(())
    }

    pub fn get_group_tweets(&self, group_id: i64, limit: u32) -> Result<Vec<TweetRow>> {
        let conn = self.conn.lock().unwrap();
        let mut stmt = conn.prepare(
            "SELECT t.id, t.author_handle, t.author_name, t.content, t.created_at,
                    t.tweet_url, t.likes, t.retweets, t.replies_count, t.views, t.source, t.ai_category, t.ai_summary, t.ai_type, t.ai_topics,
                    (t.media_json IS NOT NULL AND t.media_json != '[]') as has_media
             FROM tweets t
             JOIN tweet_groups tg ON t.id = tg.tweet_id
             WHERE tg.group_id = ?1
             ORDER BY t.created_at DESC LIMIT ?2"
        )?;
        let rows = stmt.query_map(rusqlite::params![group_id, limit], |row| {
            Ok(TweetRow {
                id: row.get(0)?, author_handle: row.get(1)?, author_name: row.get(2)?,
                content: row.get(3)?, created_at: row.get(4)?, tweet_url: row.get(5)?,
                likes: row.get(6)?, retweets: row.get(7)?, replies_count: row.get(8)?,
                views: row.get(9)?, source: row.get(10)?, ai_category: row.get(11)?,
                ai_summary: row.get(12)?, ai_type: row.get(13)?,
                ai_topics: row.get::<_, Option<String>>(14)?.and_then(|s| serde_json::from_str(&s).ok()).unwrap_or_default(),
                has_media: row.get::<_, i32>(15).unwrap_or(0) != 0,
            })
        })?;
        let mut tweets = Vec::new();
        for row in rows { tweets.push(row?); }
        Ok(tweets)
    }

    // ── Pinned Accounts ──

    pub fn list_pinned_accounts(&self) -> Result<Vec<PinnedAccount>> {
        let conn = self.conn.lock().unwrap();
        let mut stmt = conn.prepare(
            "SELECT p.handle, p.display_name, p.bio, p.avatar_url, p.pinned_since,
                    p.poll_interval_secs, p.last_polled_at, p.notes,
                    (SELECT COUNT(*) FROM tweets t WHERE t.author_handle = p.handle) as tweet_count
             FROM pinned_accounts p ORDER BY p.pinned_since DESC"
        )?;
        let rows = stmt.query_map([], |row| {
            Ok(PinnedAccount {
                handle: row.get(0)?,
                display_name: row.get(1)?,
                bio: row.get(2)?,
                avatar_url: row.get(3)?,
                pinned_since: row.get(4)?,
                poll_interval_secs: row.get(5)?,
                last_polled_at: row.get(6)?,
                notes: row.get(7)?,
                tweet_count: row.get(8)?,
            })
        })?;
        let mut accounts = Vec::new();
        for row in rows { accounts.push(row?); }
        Ok(accounts)
    }

    pub fn pin_account(&self, handle: &str, display_name: Option<&str>, bio: Option<&str>) -> Result<PinnedAccount> {
        let conn = self.conn.lock().unwrap();
        let now = chrono::Utc::now().to_rfc3339();
        conn.execute(
            "INSERT OR IGNORE INTO pinned_accounts (handle, display_name, bio, pinned_since) VALUES (?1, ?2, ?3, ?4)",
            rusqlite::params![handle, display_name, bio, now],
        )?;
        let tweet_count: i64 = conn.query_row(
            "SELECT COUNT(*) FROM tweets WHERE author_handle = ?1",
            rusqlite::params![handle],
            |row| row.get(0),
        )?;
        Ok(PinnedAccount {
            handle: handle.to_string(),
            display_name: display_name.map(String::from),
            bio: bio.map(String::from),
            avatar_url: None,
            pinned_since: now,
            poll_interval_secs: 300,
            last_polled_at: None,
            notes: None,
            tweet_count,
        })
    }

    pub fn unpin_account(&self, handle: &str) -> Result<()> {
        let conn = self.conn.lock().unwrap();
        conn.execute("DELETE FROM project_accounts WHERE account_handle = ?1", rusqlite::params![handle])?;
        conn.execute("DELETE FROM pinned_accounts WHERE handle = ?1", rusqlite::params![handle])?;
        Ok(())
    }

    pub fn get_account_tweets(&self, handle: &str, limit: u32) -> Result<Vec<TweetRow>> {
        let conn = self.conn.lock().unwrap();
        let mut stmt = conn.prepare(
            "SELECT id, author_handle, author_name, content, created_at,
                    tweet_url, likes, retweets, replies_count, views, source, ai_category, ai_summary, ai_type, ai_topics,
                    (media_json IS NOT NULL AND media_json != '[]') as has_media
             FROM tweets WHERE author_handle = ?1 ORDER BY created_at DESC LIMIT ?2"
        )?;
        let rows = stmt.query_map(rusqlite::params![handle, limit], |row| {
            Ok(TweetRow {
                id: row.get(0)?, author_handle: row.get(1)?, author_name: row.get(2)?,
                content: row.get(3)?, created_at: row.get(4)?, tweet_url: row.get(5)?,
                likes: row.get(6)?, retweets: row.get(7)?, replies_count: row.get(8)?,
                views: row.get(9)?, source: row.get(10)?, ai_category: row.get(11)?,
                ai_summary: row.get(12)?,
                ai_type: row.get(13)?,
                ai_topics: row.get::<_, Option<String>>(14)?.and_then(|s| serde_json::from_str(&s).ok()).unwrap_or_default(),
                has_media: row.get::<_, i32>(15).unwrap_or(0) != 0,
            })
        })?;
        let mut tweets = Vec::new();
        for row in rows { tweets.push(row?); }
        Ok(tweets)
    }

    /// List tweets filtered by ai_category
    pub fn list_tweets_by_category(&self, category: &str, limit: u32) -> Result<Vec<TweetRow>> {
        let conn = self.conn.lock().unwrap();
        let mut stmt = conn.prepare(
            "SELECT id, author_handle, author_name, content, created_at,
                    tweet_url, likes, retweets, replies_count, views, source, ai_category, ai_summary, ai_type, ai_topics,
                    (media_json IS NOT NULL AND media_json != '[]') as has_media
             FROM tweets WHERE ai_category = ?1 ORDER BY created_at DESC LIMIT ?2"
        )?;
        let rows = stmt.query_map(rusqlite::params![category, limit], |row| {
            Ok(TweetRow {
                id: row.get(0)?, author_handle: row.get(1)?, author_name: row.get(2)?,
                content: row.get(3)?, created_at: row.get(4)?, tweet_url: row.get(5)?,
                likes: row.get(6)?, retweets: row.get(7)?, replies_count: row.get(8)?,
                views: row.get(9)?, source: row.get(10)?, ai_category: row.get(11)?,
                ai_summary: row.get(12)?,
                ai_type: row.get(13)?,
                ai_topics: row.get::<_, Option<String>>(14)?.and_then(|s| serde_json::from_str(&s).ok()).unwrap_or_default(),
                has_media: row.get::<_, i32>(15).unwrap_or(0) != 0,
            })
        })?;
        let mut tweets = Vec::new();
        for row in rows { tweets.push(row?); }
        Ok(tweets)
    }

    // ── Monitored Topics ──

    pub fn list_monitored_topics(&self) -> Result<Vec<MonitoredTopic>> {
        let conn = self.conn.lock().unwrap();
        let mut stmt = conn.prepare(
            "SELECT id, query, created_at, last_polled_at, poll_interval_secs, is_active FROM monitored_topics ORDER BY created_at DESC"
        )?;
        let rows = stmt.query_map([], |row| {
            Ok(MonitoredTopic {
                id: row.get(0)?, query: row.get(1)?, created_at: row.get(2)?,
                last_polled_at: row.get(3)?, poll_interval_secs: row.get(4)?, is_active: row.get::<_, i32>(5)? != 0,
            })
        })?;
        let mut topics = Vec::new();
        for row in rows { topics.push(row?); }
        Ok(topics)
    }

    pub fn create_monitored_topic(&self, query: &str) -> Result<MonitoredTopic> {
        let conn = self.conn.lock().unwrap();
        let now = chrono::Utc::now().to_rfc3339();
        conn.execute(
            "INSERT INTO monitored_topics (query, created_at, poll_interval_secs, is_active) VALUES (?1, ?2, 300, 1)",
            rusqlite::params![query, now],
        )?;
        let id = conn.last_insert_rowid();
        Ok(MonitoredTopic { id, query: query.to_string(), created_at: now, last_polled_at: None, poll_interval_secs: 300, is_active: true })
    }

    pub fn delete_monitored_topic(&self, id: i64) -> Result<()> {
        let conn = self.conn.lock().unwrap();
        conn.execute("DELETE FROM monitored_topics WHERE id = ?1", rusqlite::params![id])?;
        Ok(())
    }

    pub fn get_due_monitored_topics(&self) -> Result<Vec<MonitoredTopic>> {
        let conn = self.conn.lock().unwrap();
        let now = chrono::Utc::now().to_rfc3339();
        let mut stmt = conn.prepare(
            "SELECT id, query, created_at, last_polled_at, poll_interval_secs, is_active
             FROM monitored_topics
             WHERE is_active = 1
             AND (last_polled_at IS NULL OR datetime(last_polled_at, '+' || poll_interval_secs || ' seconds') <= datetime(?1))"
        )?;
        let rows = stmt.query_map(rusqlite::params![now], |row| {
            Ok(MonitoredTopic {
                id: row.get(0)?, query: row.get(1)?, created_at: row.get(2)?,
                last_polled_at: row.get(3)?, poll_interval_secs: row.get(4)?, is_active: row.get::<_, i32>(5)? != 0,
            })
        })?;
        let mut topics = Vec::new();
        for row in rows { topics.push(row?); }
        Ok(topics)
    }

    pub fn update_topic_polled(&self, id: i64) -> Result<()> {
        let conn = self.conn.lock().unwrap();
        let now = chrono::Utc::now().to_rfc3339();
        conn.execute("UPDATE monitored_topics SET last_polled_at = ?1 WHERE id = ?2", rusqlite::params![now, id])?;
        Ok(())
    }

    // ── Dashboard Stats ──

    pub fn get_dashboard_stats(&self) -> Result<DashboardStats> {
        let conn = self.conn.lock().unwrap();

        let total_tweets: u32 = conn.query_row("SELECT COUNT(*) FROM tweets", [], |r| r.get(0))?;
        let total_bookmarks: u32 = conn.query_row("SELECT COUNT(*) FROM tweets WHERE source = 'bookmark'", [], |r| r.get(0))?;
        let enriched_count: u32 = conn.query_row("SELECT COUNT(*) FROM tweets WHERE ai_category IS NOT NULL", [], |r| r.get(0))?;
        let pending_enrichment: u32 = conn.query_row("SELECT COUNT(*) FROM tweets WHERE ai_enriched_at IS NULL", [], |r| r.get(0))?;
        let pending_embedding: u32 = conn.query_row("SELECT COUNT(*) FROM tweets WHERE embedding IS NULL", [], |r| r.get(0))?;

        // Category counts
        let mut cat_stmt = conn.prepare(
            "SELECT ai_category, COUNT(*) FROM tweets WHERE ai_category IS NOT NULL GROUP BY ai_category ORDER BY COUNT(*) DESC"
        )?;
        let cat_rows = cat_stmt.query_map([], |row| {
            Ok(CategoryCount { name: row.get(0)?, count: row.get(1)? })
        })?;
        let mut categories = Vec::new();
        for row in cat_rows { categories.push(row?); }

        // Top topics (parse JSON arrays, aggregate)
        let mut topic_stmt = conn.prepare(
            "SELECT ai_topics FROM tweets WHERE ai_topics IS NOT NULL AND ai_topics != '[]'"
        )?;
        let topic_rows = topic_stmt.query_map([], |row| row.get::<_, String>(0))?;
        let mut topic_counts = std::collections::HashMap::<String, u32>::new();
        for row in topic_rows {
            if let Ok(raw) = row {
                if let Ok(topics) = serde_json::from_str::<Vec<String>>(&raw) {
                    for topic in topics {
                        *topic_counts.entry(topic).or_insert(0) += 1;
                    }
                }
            }
        }
        let mut top_topics: Vec<(String, u32)> = topic_counts.into_iter().collect();
        top_topics.sort_by(|a, b| b.1.cmp(&a.1));
        top_topics.truncate(20);

        Ok(DashboardStats {
            total_tweets,
            total_bookmarks,
            enriched_count,
            pending_enrichment,
            pending_embedding,
            categories,
            top_topics,
        })
    }

    // ── Network Graph ──

    /// Get tweets with embeddings for the network graph
    pub fn get_graph_nodes(
        &self,
        source_filter: Option<&str>,
        limit: u32,
    ) -> Result<Vec<GraphNode>> {
        let conn = self.conn.lock().unwrap();
        let sql = if source_filter.is_some() {
            "SELECT id, author_handle, author_name, substr(content, 1, 200), ai_category, ai_summary, embedding, ai_topics
             FROM tweets WHERE embedding IS NOT NULL AND source = ?2 LIMIT ?1"
        } else {
            "SELECT id, author_handle, author_name, substr(content, 1, 200), ai_category, ai_summary, embedding, ai_topics
             FROM tweets WHERE embedding IS NOT NULL LIMIT ?1"
        };
        let mut stmt = conn.prepare(sql)?;

        let map_row = |row: &rusqlite::Row| -> rusqlite::Result<GraphNode> {
            let embedding_blob: Vec<u8> = row.get(6)?;
            let embedding: Vec<f32> = embedding_blob
                .chunks_exact(4)
                .map(|b| f32::from_le_bytes([b[0], b[1], b[2], b[3]]))
                .collect();
            let topics_raw: Option<String> = row.get(7)?;
            let topics: Vec<String> = topics_raw
                .and_then(|s| serde_json::from_str(&s).ok())
                .unwrap_or_default();
            Ok(GraphNode {
                id: row.get(0)?,
                author_handle: row.get(1)?,
                author_name: row.get(2)?,
                content_preview: row.get(3)?,
                category: row.get(4)?,
                summary: row.get(5)?,
                topics,
                embedding,
            })
        };

        let mut nodes = Vec::new();
        if let Some(src) = source_filter {
            let rows = stmt.query_map(rusqlite::params![limit, src], map_row)?;
            for row in rows { nodes.push(row?); }
        } else {
            let rows = stmt.query_map(rusqlite::params![limit], map_row)?;
            for row in rows { nodes.push(row?); }
        }
        Ok(nodes)
    }
}

/// Compute cosine similarity between two vectors
pub fn cosine_similarity(a: &[f32], b: &[f32]) -> f32 {
    let dot: f32 = a.iter().zip(b.iter()).map(|(x, y)| x * y).sum();
    let norm_a: f32 = a.iter().map(|x| x * x).sum::<f32>().sqrt();
    let norm_b: f32 = b.iter().map(|x| x * x).sum::<f32>().sqrt();
    if norm_a == 0.0 || norm_b == 0.0 {
        return 0.0;
    }
    dot / (norm_a * norm_b)
}

/// Convert &[f32] to &[u8] for sqlite-vec
fn f32_slice_to_bytes(floats: &[f32]) -> &[u8] {
    unsafe { std::slice::from_raw_parts(floats.as_ptr() as *const u8, floats.len() * 4) }
}

#[derive(Debug, serde::Serialize, Clone)]
pub struct GraphNode {
    pub id: String,
    pub author_handle: String,
    pub author_name: Option<String>,
    pub content_preview: String,
    pub category: Option<String>,
    pub summary: Option<String>,
    pub topics: Vec<String>,
    #[serde(skip)]
    pub embedding: Vec<f32>,
}

#[derive(Debug, serde::Serialize, Clone)]
pub struct Tag {
    pub id: i64,
    pub name: String,
    pub color: Option<String>,
}

#[derive(Debug, serde::Serialize, Clone)]
pub struct Project {
    pub id: i64,
    pub name: String,
    pub description: Option<String>,
    pub color: Option<String>,
    pub created_at: String,
}

#[derive(Debug, serde::Serialize, Clone)]
pub struct KanbanColumn {
    pub id: i64,
    pub project_id: i64,
    pub name: String,
    pub position: i64,
}

#[derive(Debug, serde::Serialize, Clone)]
pub struct KanbanCard {
    pub id: i64,
    pub column_id: i64,
    pub tweet_id: String,
    pub note: Option<String>,
    pub position: i64,
    // Denormalized tweet info for display
    pub author_handle: Option<String>,
    pub content: Option<String>,
}

#[derive(Debug, serde::Serialize, Clone)]
pub struct PinnedAccount {
    pub handle: String,
    pub display_name: Option<String>,
    pub bio: Option<String>,
    pub avatar_url: Option<String>,
    pub pinned_since: String,
    pub poll_interval_secs: i64,
    pub last_polled_at: Option<String>,
    pub notes: Option<String>,
    pub tweet_count: i64,
}

#[derive(Debug, serde::Serialize, Clone)]
pub struct TweetFull {
    pub id: String,
    pub author_id: Option<String>,
    pub author_handle: String,
    pub author_name: Option<String>,
    pub author_verified: bool,
    pub content: String,
    pub created_at: Option<String>,
    pub conversation_id: Option<String>,
    pub language: Option<String>,
    pub tweet_url: Option<String>,
    pub reply_to_id: Option<String>,
    pub reply_to_handle: Option<String>,
    pub is_retweet: bool,
    pub retweeted_by: Option<String>,
    pub media_json: Option<String>,
    pub quoted_tweet_json: Option<String>,
    pub likes: i64,
    pub retweets: i64,
    pub replies_count: i64,
    pub quotes: i64,
    pub bookmarks_count: i64,
    pub views: i64,
    pub source: String,
    pub ai_category: Option<String>,
    pub ai_summary: Option<String>,
    pub ai_topics: Vec<String>,
    pub ai_type: Option<String>,
    pub has_embedding: bool,
}

#[derive(Debug, serde::Serialize, Clone)]
pub struct TweetRow {
    pub id: String,
    pub author_handle: String,
    pub author_name: Option<String>,
    pub content: String,
    pub created_at: Option<String>,
    pub tweet_url: Option<String>,
    pub likes: i64,
    pub retweets: i64,
    pub replies_count: i64,
    pub views: i64,
    pub source: String,
    pub ai_category: Option<String>,
    pub ai_summary: Option<String>,
    pub ai_type: Option<String>,
    pub ai_topics: Vec<String>,
    pub has_media: bool,
}

#[derive(Debug, serde::Serialize, Clone)]
pub struct TweetNote {
    pub id: i64,
    pub tweet_id: String,
    pub content: String,
    pub created_at: String,
    pub updated_at: String,
}

#[derive(Debug, serde::Serialize, Clone)]
pub struct MonitoredTopic {
    pub id: i64,
    pub query: String,
    pub created_at: String,
    pub last_polled_at: Option<String>,
    pub poll_interval_secs: i64,
    pub is_active: bool,
}

#[derive(Debug, serde::Serialize, Clone)]
pub struct Group {
    pub id: i64,
    pub project_id: i64,
    pub name: String,
    pub description: Option<String>,
    pub color: Option<String>,
    pub tweet_count: u32,
}

#[derive(Debug, serde::Serialize, Clone)]
pub struct CategoryCount {
    pub name: String,
    pub count: u32,
}

#[derive(Debug, serde::Serialize, Clone)]
pub struct DashboardStats {
    pub total_tweets: u32,
    pub total_bookmarks: u32,
    pub enriched_count: u32,
    pub pending_enrichment: u32,
    pub pending_embedding: u32,
    pub categories: Vec<CategoryCount>,
    pub top_topics: Vec<(String, u32)>,
}
