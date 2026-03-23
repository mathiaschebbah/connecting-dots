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
        let schema = include_str!("schema.sql");
        conn.execute_batch(schema)?;

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
                ?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10,
                ?11, ?12, ?13, ?14, ?15, ?16,
                ?17, ?18, ?19, ?20, ?21, ?22, ?23, ?24, ?25
            )",
        )?;

        for tweet in tweets {
            let engagement = tweet.engagement.as_ref();
            let media_json = tweet.media.as_ref().map(|m| serde_json::to_string(m).unwrap_or_default());
            let quoted_json = tweet.quoted_tweet.as_ref().map(|q| serde_json::to_string(q).unwrap_or_default());
            let raw = serde_json::to_string(tweet).unwrap_or_default();

            let rows = stmt.execute(rusqlite::params![
                tweet.id, tweet.author_id, tweet.author_handle, tweet.author_name,
                tweet.author_verified.unwrap_or(false) as i32,
                tweet.text, tweet.created_at, tweet.conversation_id, tweet.language, tweet.tweet_url,
                tweet.reply_to_id, tweet.reply_to_handle,
                tweet.is_retweet.unwrap_or(false) as i32, tweet.retweeted_by,
                media_json, quoted_json,
                engagement.and_then(|e| e.likes).unwrap_or(0),
                engagement.and_then(|e| e.retweets).unwrap_or(0),
                engagement.and_then(|e| e.replies).unwrap_or(0),
                engagement.and_then(|e| e.quotes).unwrap_or(0),
                engagement.and_then(|e| e.bookmarks).unwrap_or(0),
                engagement.and_then(|e| e.views).unwrap_or(0),
                source, now, raw,
            ])?;
            if rows > 0 { count += 1; }

            if source == "bookmark" {
                conn.execute("UPDATE tweets SET source = 'bookmark' WHERE id = ?1", rusqlite::params![tweet.id])?;
            }
        }
        Ok(count)
    }

    pub fn set_bookmark_order(&self, tweet_ids: &[String]) -> Result<()> {
        let conn = self.conn.lock().unwrap();
        let mut stmt = conn.prepare_cached("UPDATE tweets SET bookmark_order = ?1 WHERE id = ?2 AND source = 'bookmark'")?;
        let mut order = 0i64;
        for id in tweet_ids {
            let changed = stmt.execute(rusqlite::params![order, id])?;
            if changed > 0 { order += 1; }
        }
        Ok(())
    }

    pub fn store_embedding(&self, tweet_id: &str, embedding: &[f32]) -> Result<()> {
        let conn = self.conn.lock().unwrap();
        let _ = conn.execute("DELETE FROM tweets_vec WHERE tweet_id = ?1", rusqlite::params![tweet_id]);
        conn.execute("INSERT INTO tweets_vec (tweet_id, embedding) VALUES (?1, ?2)", rusqlite::params![tweet_id, f32_slice_to_bytes(embedding)])?;
        conn.execute("UPDATE tweets SET embedding = ?1 WHERE id = ?2", rusqlite::params![f32_slice_to_bytes(embedding), tweet_id])?;
        Ok(())
    }

    pub fn tweets_without_embedding(&self, limit: u32) -> Result<Vec<(String, String)>> {
        let conn = self.conn.lock().unwrap();
        let mut stmt = conn.prepare("SELECT id, COALESCE(resolved_content, content) FROM tweets WHERE embedding IS NULL LIMIT ?1")?;
        let rows = stmt.query_map(rusqlite::params![limit], |row| Ok((row.get(0)?, row.get(1)?)))?;
        let mut results = Vec::new();
        for row in rows { results.push(row?); }
        Ok(results)
    }

    // ── Search ──

    pub fn search_semantic(&self, query_embedding: &[f32], limit: u32) -> Result<Vec<TweetRow>> {
        let conn = self.conn.lock().unwrap();
        let mut stmt = conn.prepare(
            "SELECT t.id, t.author_handle, t.author_name, COALESCE(t.resolved_content, t.content), t.created_at,
                    t.tweet_url, t.likes, t.retweets, t.replies_count, t.views, t.source, t.ai_category, t.ai_cluster, t.ai_summary, t.ai_type, t.ai_topics,
                    (t.media_json IS NOT NULL AND t.media_json != '[]') as has_media
             FROM tweets t JOIN tweets_vec v ON t.id = v.tweet_id
             WHERE v.embedding MATCH ?1 AND k = ?2
             ORDER BY distance",
        )?;
        let rows = stmt.query_map(rusqlite::params![f32_slice_to_bytes(query_embedding), limit], map_tweet_row)?;
        let mut tweets = Vec::new();
        for row in rows { tweets.push(row?); }
        Ok(tweets)
    }

    pub fn tweet_count(&self) -> Result<u32> {
        let conn = self.conn.lock().unwrap();
        Ok(conn.query_row("SELECT COUNT(*) FROM tweets", [], |row| row.get(0))?)
    }

    pub fn list_tweets(&self, limit: u32, offset: u32, source_filter: Option<&str>) -> Result<Vec<TweetRow>> {
        let conn = self.conn.lock().unwrap();
        let query = if source_filter == Some("bookmark") {
            "SELECT id, author_handle, author_name, COALESCE(resolved_content, content), created_at,
                    tweet_url, likes, retweets, replies_count, views, source, ai_category, ai_cluster, ai_summary, ai_type, ai_topics,
                    (media_json IS NOT NULL AND media_json != '[]') as has_media
             FROM tweets WHERE source = 'bookmark' ORDER BY bookmark_order ASC LIMIT ?1 OFFSET ?2"
        } else {
            "SELECT id, author_handle, author_name, COALESCE(resolved_content, content), created_at,
                    tweet_url, likes, retweets, replies_count, views, source, ai_category, ai_cluster, ai_summary, ai_type, ai_topics,
                    (media_json IS NOT NULL AND media_json != '[]') as has_media
             FROM tweets ORDER BY created_at DESC LIMIT ?1 OFFSET ?2"
        };
        let mut stmt = conn.prepare(query)?;
        let rows = stmt.query_map(rusqlite::params![limit, offset], map_tweet_row)?;
        let mut tweets = Vec::new();
        for row in rows { tweets.push(row?); }
        Ok(tweets)
    }

    pub fn search_fulltext(&self, query: &str, limit: u32, source_filter: Option<&str>) -> Result<Vec<TweetRow>> {
        let conn = self.conn.lock().unwrap();
        let sql = if source_filter.is_some() {
            "SELECT t.id, t.author_handle, t.author_name, COALESCE(t.resolved_content, t.content), t.created_at,
                    t.tweet_url, t.likes, t.retweets, t.replies_count, t.views, t.source, t.ai_category, t.ai_cluster, t.ai_summary, t.ai_type, t.ai_topics,
                    (t.media_json IS NOT NULL AND t.media_json != '[]') as has_media
             FROM tweets t JOIN tweets_fts fts ON t.rowid = fts.rowid
             WHERE tweets_fts MATCH ?1 AND t.source = ?3 ORDER BY rank LIMIT ?2"
        } else {
            "SELECT t.id, t.author_handle, t.author_name, COALESCE(t.resolved_content, t.content), t.created_at,
                    t.tweet_url, t.likes, t.retweets, t.replies_count, t.views, t.source, t.ai_category, t.ai_cluster, t.ai_summary, t.ai_type, t.ai_topics,
                    (t.media_json IS NOT NULL AND t.media_json != '[]') as has_media
             FROM tweets t JOIN tweets_fts fts ON t.rowid = fts.rowid
             WHERE tweets_fts MATCH ?1 ORDER BY rank LIMIT ?2"
        };
        let mut stmt = conn.prepare(sql)?;
        let mut tweets = Vec::new();
        if let Some(src) = source_filter {
            let rows = stmt.query_map(rusqlite::params![query, limit, src], map_tweet_row)?;
            for row in rows { tweets.push(row?); }
        } else {
            let rows = stmt.query_map(rusqlite::params![query, limit], map_tweet_row)?;
            for row in rows { tweets.push(row?); }
        }
        Ok(tweets)
    }

    // ── Tweet Detail ──

    pub fn get_tweet_full(&self, tweet_id: &str) -> Result<Option<TweetFull>> {
        let conn = self.conn.lock().unwrap();
        let mut stmt = conn.prepare(
            "SELECT id, author_id, author_handle, author_name, author_verified,
                    content, created_at, conversation_id, language, tweet_url,
                    reply_to_id, reply_to_handle, is_retweet, retweeted_by,
                    media_json, quoted_tweet_json,
                    likes, retweets, replies_count, quotes, bookmarks_count, views,
                    source, ai_category, ai_cluster, ai_summary, ai_topics, ai_type, embedding,
                    resolved_content, resolved_author, resolved_url
             FROM tweets WHERE id = ?1",
        )?;
        let result = stmt.query_row(rusqlite::params![tweet_id], |row| {
            let embedding_blob: Option<Vec<u8>> = row.get(28)?;
            let has_embedding = embedding_blob.is_some();
            let topics_raw: Option<String> = row.get(26)?;
            let topics: Vec<String> = topics_raw.and_then(|s| serde_json::from_str(&s).ok()).unwrap_or_default();
            Ok(TweetFull {
                id: row.get(0)?, author_id: row.get(1)?, author_handle: row.get(2)?,
                author_name: row.get(3)?, author_verified: row.get::<_, i32>(4)? != 0,
                content: row.get(5)?, created_at: row.get(6)?, conversation_id: row.get(7)?,
                language: row.get(8)?, tweet_url: row.get(9)?, reply_to_id: row.get(10)?,
                reply_to_handle: row.get(11)?, is_retweet: row.get::<_, i32>(12)? != 0,
                retweeted_by: row.get(13)?, media_json: row.get(14)?, quoted_tweet_json: row.get(15)?,
                likes: row.get(16)?, retweets: row.get(17)?, replies_count: row.get(18)?,
                quotes: row.get(19)?, bookmarks_count: row.get(20)?, views: row.get(21)?,
                source: row.get(22)?, ai_category: row.get(23)?, ai_cluster: row.get(24)?,
                ai_summary: row.get(25)?, ai_topics: topics, ai_type: row.get(27)?,
                has_embedding, resolved_content: row.get(29)?, resolved_author: row.get(30)?,
                resolved_url: row.get(31)?,
            })
        });
        match result {
            Ok(t) => Ok(Some(t)),
            Err(rusqlite::Error::QueryReturnedNoRows) => Ok(None),
            Err(e) => Err(e.into()),
        }
    }

    pub fn get_embedding(&self, tweet_id: &str) -> Result<Option<Vec<f32>>> {
        let conn = self.conn.lock().unwrap();
        let result: Result<Vec<u8>, _> = conn.query_row(
            "SELECT embedding FROM tweets WHERE id = ?1 AND embedding IS NOT NULL",
            rusqlite::params![tweet_id], |row| row.get(0),
        );
        match result {
            Ok(blob) => Ok(Some(blob.chunks_exact(4).map(|b| f32::from_le_bytes([b[0], b[1], b[2], b[3]])).collect())),
            Err(rusqlite::Error::QueryReturnedNoRows) => Ok(None),
            Err(e) => Err(e.into()),
        }
    }

    // ── Tags ──

    pub fn list_tags(&self) -> Result<Vec<Tag>> {
        let conn = self.conn.lock().unwrap();
        let mut stmt = conn.prepare("SELECT id, name, color FROM tags ORDER BY name")?;
        let rows = stmt.query_map([], |row| Ok(Tag { id: row.get(0)?, name: row.get(1)?, color: row.get(2)? }))?;
        let mut tags = Vec::new();
        for row in rows { tags.push(row?); }
        Ok(tags)
    }

    pub fn create_tag(&self, name: &str, color: Option<&str>) -> Result<i64> {
        let conn = self.conn.lock().unwrap();
        conn.execute("INSERT OR IGNORE INTO tags (name, color) VALUES (?1, ?2)", rusqlite::params![name, color])?;
        Ok(conn.query_row("SELECT id FROM tags WHERE name = ?1", rusqlite::params![name], |row| row.get(0))?)
    }

    pub fn tag_tweet(&self, tweet_id: &str, tag_id: i64) -> Result<()> {
        let conn = self.conn.lock().unwrap();
        conn.execute("INSERT OR IGNORE INTO tweet_tags (tweet_id, tag_id) VALUES (?1, ?2)", rusqlite::params![tweet_id, tag_id])?;
        Ok(())
    }

    pub fn untag_tweet(&self, tweet_id: &str, tag_id: i64) -> Result<()> {
        let conn = self.conn.lock().unwrap();
        conn.execute("DELETE FROM tweet_tags WHERE tweet_id = ?1 AND tag_id = ?2", rusqlite::params![tweet_id, tag_id])?;
        Ok(())
    }

    pub fn get_tweet_tags(&self, tweet_id: &str) -> Result<Vec<Tag>> {
        let conn = self.conn.lock().unwrap();
        let mut stmt = conn.prepare("SELECT t.id, t.name, t.color FROM tags t JOIN tweet_tags tt ON t.id = tt.tag_id WHERE tt.tweet_id = ?1 ORDER BY t.name")?;
        let rows = stmt.query_map(rusqlite::params![tweet_id], |row| Ok(Tag { id: row.get(0)?, name: row.get(1)?, color: row.get(2)? }))?;
        let mut tags = Vec::new();
        for row in rows { tags.push(row?); }
        Ok(tags)
    }

    // ── AI Metadata ──

    pub fn tweets_without_ai_metadata(&self, limit: u32) -> Result<Vec<(String, String)>> {
        let conn = self.conn.lock().unwrap();
        // Skip ANY tweet with an unresolved link — wait for the link resolver to fetch the real content first.
        // This prevents garbage categorizations like "article-x", "long-form-article", etc.
        let mut stmt = conn.prepare(
            "SELECT id, COALESCE(resolved_content, content) FROM tweets
             WHERE ai_enriched_at IS NULL
             AND NOT (
                resolved_content IS NULL
                AND (content LIKE '%x.com/%/status/%' OR content LIKE '%twitter.com/%/status/%' OR content LIKE '%x.com/i/article/%' OR content LIKE '%t.co/%')
             )
             ORDER BY CASE WHEN source = 'bookmark' THEN 0 ELSE 1 END
             LIMIT ?1",
        )?;
        let rows = stmt.query_map(rusqlite::params![limit], |row| Ok((row.get(0)?, row.get(1)?)))?;
        let mut results = Vec::new();
        for row in rows { results.push(row?); }
        Ok(results)
    }

    pub fn reset_all_enrichments(&self) -> Result<u32> {
        let conn = self.conn.lock().unwrap();
        let count: u32 = conn.query_row("SELECT COUNT(*) FROM tweets WHERE ai_enriched_at IS NOT NULL", [], |row| row.get(0))?;
        conn.execute("UPDATE tweets SET ai_enriched_at = NULL, ai_category = NULL, ai_cluster = NULL, ai_summary = NULL, ai_topics = NULL, ai_type = NULL WHERE ai_enriched_at IS NOT NULL", [])?;
        Ok(count)
    }

    pub fn update_ai_metadata(&self, tweet_id: &str, category: &str, cluster: &str, summary: &str, topics: &str, tweet_type: &str) -> Result<()> {
        let conn = self.conn.lock().unwrap();
        let now = chrono::Utc::now().to_rfc3339();
        conn.execute(
            "UPDATE tweets SET ai_category = ?1, ai_cluster = ?2, ai_summary = ?3, ai_topics = ?4, ai_type = ?5, ai_enriched_at = ?6 WHERE id = ?7",
            rusqlite::params![category, cluster, summary, topics, tweet_type, now, tweet_id],
        )?;
        Ok(())
    }

    pub fn store_resolved_content(&self, tweet_id: &str, content: &str, author: Option<&str>, url: &str) -> Result<()> {
        let conn = self.conn.lock().unwrap();
        conn.execute("UPDATE tweets SET resolved_content = ?1, resolved_author = ?2, resolved_url = ?3 WHERE id = ?4", rusqlite::params![content, author, url, tweet_id])?;
        // Clear embedding so it gets re-embedded with the resolved content
        conn.execute("UPDATE tweets SET embedding = NULL WHERE id = ?1 AND embedding IS NOT NULL", rusqlite::params![tweet_id])?;
        Ok(())
    }

    pub fn tweets_with_unresolved_links(&self, limit: u32) -> Result<Vec<(String, String)>> {
        let conn = self.conn.lock().unwrap();
        let mut stmt = conn.prepare(
            "SELECT id, content FROM tweets WHERE resolved_content IS NULL
             AND (content LIKE '%x.com/%/status/%' OR content LIKE '%twitter.com/%/status/%' OR content LIKE '%x.com/i/article/%' OR content LIKE '%t.co/%')
             AND length(content) < 200 LIMIT ?1"
        )?;
        let rows = stmt.query_map(rusqlite::params![limit], |row| Ok((row.get(0)?, row.get(1)?)))?;
        let mut results = Vec::new();
        for row in rows { results.push(row?); }
        Ok(results)
    }

    // ── Notes ──

    pub fn get_tweet_notes(&self, tweet_id: &str) -> Result<Vec<TweetNote>> {
        let conn = self.conn.lock().unwrap();
        let mut stmt = conn.prepare("SELECT id, tweet_id, content, created_at, updated_at FROM tweet_notes WHERE tweet_id = ?1 ORDER BY created_at DESC")?;
        let rows = stmt.query_map(rusqlite::params![tweet_id], |row| {
            Ok(TweetNote { id: row.get(0)?, tweet_id: row.get(1)?, content: row.get(2)?, created_at: row.get(3)?, updated_at: row.get(4)? })
        })?;
        let mut notes = Vec::new();
        for row in rows { notes.push(row?); }
        Ok(notes)
    }

    pub fn create_tweet_note(&self, tweet_id: &str, content: &str) -> Result<TweetNote> {
        let conn = self.conn.lock().unwrap();
        let now = chrono::Utc::now().to_rfc3339();
        conn.execute("INSERT INTO tweet_notes (tweet_id, content, created_at, updated_at) VALUES (?1, ?2, ?3, ?4)", rusqlite::params![tweet_id, content, now, now])?;
        let id = conn.last_insert_rowid();
        Ok(TweetNote { id, tweet_id: tweet_id.to_string(), content: content.to_string(), created_at: now.clone(), updated_at: now })
    }

    pub fn update_tweet_note(&self, note_id: i64, content: &str) -> Result<()> {
        let conn = self.conn.lock().unwrap();
        let now = chrono::Utc::now().to_rfc3339();
        conn.execute("UPDATE tweet_notes SET content = ?1, updated_at = ?2 WHERE id = ?3", rusqlite::params![content, now, note_id])?;
        Ok(())
    }

    pub fn delete_tweet_note(&self, note_id: i64) -> Result<()> {
        let conn = self.conn.lock().unwrap();
        conn.execute("DELETE FROM tweet_notes WHERE id = ?1", rusqlite::params![note_id])?;
        Ok(())
    }

    // ── Dashboard ──

    pub fn get_dashboard_stats(&self) -> Result<DashboardStats> {
        let conn = self.conn.lock().unwrap();
        let total_tweets: u32 = conn.query_row("SELECT COUNT(*) FROM tweets", [], |r| r.get(0))?;
        let total_bookmarks: u32 = conn.query_row("SELECT COUNT(*) FROM tweets WHERE source = 'bookmark'", [], |r| r.get(0))?;
        let enriched_count: u32 = conn.query_row("SELECT COUNT(*) FROM tweets WHERE ai_category IS NOT NULL", [], |r| r.get(0))?;
        let pending_enrichment: u32 = conn.query_row("SELECT COUNT(*) FROM tweets WHERE ai_enriched_at IS NULL", [], |r| r.get(0))?;
        let pending_embedding: u32 = conn.query_row("SELECT COUNT(*) FROM tweets WHERE embedding IS NULL", [], |r| r.get(0))?;

        let mut cat_stmt = conn.prepare("SELECT ai_category, COUNT(*) FROM tweets WHERE ai_category IS NOT NULL GROUP BY ai_category ORDER BY COUNT(*) DESC")?;
        let cat_rows = cat_stmt.query_map([], |row| Ok(CategoryCount { name: row.get(0)?, count: row.get(1)? }))?;
        let mut categories = Vec::new();
        for row in cat_rows { categories.push(row?); }

        Ok(DashboardStats { total_tweets, total_bookmarks, enriched_count, pending_enrichment, pending_embedding, categories })
    }

    // ── Dots ──

    /// Get existing dot slugs for the enricher prompt (lightweight, no counts)
    pub fn list_dot_slugs(&self) -> Result<Vec<(String, String)>> {
        let conn = self.conn.lock().unwrap();
        let mut stmt = conn.prepare("SELECT slug, name FROM dots ORDER BY slug")?;
        let rows = stmt.query_map([], |row| Ok((row.get::<_, String>(0)?, row.get::<_, String>(1)?)))?;
        let mut results = Vec::new();
        for row in rows { results.push(row?); }
        Ok(results)
    }

    pub fn list_dots(&self) -> Result<Vec<Dot>> {
        let conn = self.conn.lock().unwrap();
        let mut stmt = conn.prepare(
            "SELECT d.id, d.name, d.slug, d.parent_id, d.description, d.color, d.created_at,
                    (SELECT COUNT(*) FROM tweet_dots td JOIN tweets t ON td.tweet_id = t.id WHERE td.dot_id = d.id AND t.source = 'bookmark') as bookmark_count
             FROM dots d WHERE d.parent_id IS NULL
             AND d.slug NOT IN ('unknown', 'other', 'article-link', 'unknown-article', 'twitter-article', 'meme-content', 'pop-culture-humor', 'article-x', 'articles-x', 'x-article', 'x-articles', 'long-form-article', 'misc', 'unspecified', 'unlabeled', 'tweet-indisponible', 'contenu-viral', 'general')
             AND (SELECT COUNT(*) FROM tweet_dots td JOIN tweets t ON td.tweet_id = t.id WHERE td.dot_id = d.id AND t.source = 'bookmark') >= 2
             ORDER BY (SELECT MAX(t.created_at) FROM tweet_dots td JOIN tweets t ON td.tweet_id = t.id WHERE td.dot_id = d.id AND t.source = 'bookmark') DESC"
        )?;
        let rows = stmt.query_map([], |row| {
            Ok(Dot {
                id: row.get(0)?, name: row.get(1)?, slug: row.get(2)?, parent_id: row.get(3)?,
                description: row.get(4)?, color: row.get(5)?, created_at: row.get(6)?,
                bookmark_count: row.get(7)?, children: vec![],
            })
        })?;
        let mut dots: Vec<Dot> = Vec::new();
        for row in rows { dots.push(row?); }
        Ok(dots)
    }

    pub fn get_dot_detail(&self, slug: &str, limit: u32, offset: u32) -> Result<Option<DotDetail>> {
        let conn = self.conn.lock().unwrap();

        let dot_result = conn.query_row(
            "SELECT d.id, d.name, d.slug, d.parent_id, d.description, d.color, d.created_at,
                    (SELECT COUNT(*) FROM tweet_dots td JOIN tweets t ON td.tweet_id = t.id WHERE td.dot_id = d.id AND t.source = 'bookmark') as bookmark_count
             FROM dots d WHERE d.slug = ?1",
            rusqlite::params![slug],
            |row| Ok(Dot {
                id: row.get(0)?, name: row.get(1)?, slug: row.get(2)?, parent_id: row.get(3)?,
                description: row.get(4)?, color: row.get(5)?, created_at: row.get(6)?,
                bookmark_count: row.get(7)?, children: vec![],
            }),
        );

        let dot = match dot_result {
            Ok(d) => d,
            Err(rusqlite::Error::QueryReturnedNoRows) => return Ok(None),
            Err(e) => return Err(e.into()),
        };

        let mut tweet_stmt = conn.prepare(
            "SELECT t.id, t.author_handle, t.author_name, COALESCE(t.resolved_content, t.content), t.created_at,
                    t.tweet_url, t.likes, t.retweets, t.replies_count, t.views, t.source, t.ai_category, t.ai_cluster, t.ai_summary, t.ai_type, t.ai_topics,
                    (t.media_json IS NOT NULL AND t.media_json != '[]') as has_media
             FROM tweets t JOIN tweet_dots td ON t.id = td.tweet_id
             WHERE td.dot_id = ?1 AND t.source = 'bookmark'
             ORDER BY t.bookmark_order ASC LIMIT ?2 OFFSET ?3"
        )?;
        let tweet_rows = tweet_stmt.query_map(rusqlite::params![dot.id, limit, offset], map_tweet_row)?;
        let mut tweets = Vec::new();
        for row in tweet_rows { tweets.push(row?); }

        let mut sub_stmt = conn.prepare(
            "SELECT d.id, d.name, d.slug, d.parent_id, d.description, d.color, d.created_at,
                    (SELECT COUNT(*) FROM tweet_dots td JOIN tweets t ON td.tweet_id = t.id WHERE td.dot_id = d.id AND t.source = 'bookmark') as bookmark_count
             FROM dots d WHERE d.parent_id = ?1 ORDER BY bookmark_count DESC"
        )?;
        let sub_rows = sub_stmt.query_map(rusqlite::params![dot.id], |row| {
            Ok(Dot {
                id: row.get(0)?, name: row.get(1)?, slug: row.get(2)?, parent_id: row.get(3)?,
                description: row.get(4)?, color: row.get(5)?, created_at: row.get(6)?,
                bookmark_count: row.get(7)?, children: vec![],
            })
        })?;
        let mut sub_dots = Vec::new();
        for row in sub_rows { sub_dots.push(row?); }

        Ok(Some(DotDetail { dot, tweets, sub_dots }))
    }

    pub fn get_or_create_dot(&self, slug: &str, name: &str, color: Option<&str>) -> Result<i64> {
        let conn = self.conn.lock().unwrap();
        let existing: Result<i64, _> = conn.query_row("SELECT id FROM dots WHERE slug = ?1", rusqlite::params![slug], |row| row.get(0));
        match existing {
            Ok(id) => {
                // Update name if the new one looks better (has mixed case = LLM-provided)
                if name.chars().any(|c| c.is_uppercase()) && name.chars().any(|c| c.is_lowercase()) {
                    conn.execute("UPDATE dots SET name = ?1 WHERE slug = ?2", rusqlite::params![name, slug])?;
                }
                Ok(id)
            }
            Err(rusqlite::Error::QueryReturnedNoRows) => {
                let now = chrono::Utc::now().to_rfc3339();
                conn.execute("INSERT INTO dots (name, slug, color, created_at) VALUES (?1, ?2, ?3, ?4)", rusqlite::params![name, slug, color, now])?;
                Ok(conn.last_insert_rowid())
            }
            Err(e) => Err(e.into()),
        }
    }

    pub fn assign_tweet_to_dot(&self, tweet_id: &str, dot_id: i64) -> Result<()> {
        let conn = self.conn.lock().unwrap();
        conn.execute("INSERT OR IGNORE INTO tweet_dots (tweet_id, dot_id) VALUES (?1, ?2)", rusqlite::params![tweet_id, dot_id])?;
        Ok(())
    }

    pub fn backfill_dots(&self) -> Result<u32> {
        let conn = self.conn.lock().unwrap();
        let now = chrono::Utc::now().to_rfc3339();

        let cat_colors = std::collections::HashMap::from([
            ("ai/ml", "#7C3AED"), ("dev-tools", "#0891B2"), ("web", "#2563EB"),
            ("crypto", "#059669"), ("design", "#DB2777"), ("science", "#D97706"),
            ("business", "#EA580C"), ("politics", "#DC2626"), ("culture", "#65A30D"),
            ("other", "#71717A"),
        ]);

        let mut stmt = conn.prepare(
            "SELECT ai_cluster, ai_category, COUNT(*) as cnt FROM tweets WHERE ai_cluster IS NOT NULL AND ai_cluster != ''
             GROUP BY ai_cluster, ai_category ORDER BY ai_cluster, cnt DESC"
        )?;
        let rows: Vec<(String, Option<String>)> = {
            let mut result = Vec::new();
            let mut seen = std::collections::HashSet::new();
            let mapped = stmt.query_map([], |row| Ok((row.get::<_, String>(0)?, row.get::<_, Option<String>>(1)?)))?;
            for row in mapped {
                if let Ok((cluster, cat)) = row {
                    if seen.insert(cluster.clone()) { result.push((cluster, cat)); }
                }
            }
            result
        };

        let mut count = 0u32;
        for (cluster, category) in &rows {
            let slug = cluster.to_lowercase().replace(' ', "-");
            let name = cluster.split('-').map(|w| {
                let mut c = w.chars();
                match c.next() {
                    None => String::new(),
                    Some(f) => f.to_uppercase().collect::<String>() + c.as_str(),
                }
            }).collect::<Vec<_>>().join(" ");

            let color = category.as_deref().and_then(|c| cat_colors.get(c)).copied();
            conn.execute("INSERT OR IGNORE INTO dots (name, slug, color, created_at) VALUES (?1, ?2, ?3, ?4)", rusqlite::params![name, slug, color, now])?;
            if color.is_some() { conn.execute("UPDATE dots SET color = ?1 WHERE slug = ?2 AND color IS NULL", rusqlite::params![color, slug])?; }

            let dot_id: i64 = conn.query_row("SELECT id FROM dots WHERE slug = ?1", rusqlite::params![slug], |row| row.get(0))?;
            let assigned = conn.execute("INSERT OR IGNORE INTO tweet_dots (tweet_id, dot_id) SELECT id, ?1 FROM tweets WHERE ai_cluster = ?2", rusqlite::params![dot_id, cluster])?;
            count += assigned as u32;
        }
        Ok(count)
    }
}

// ── Row Mapper ──

fn map_tweet_row(row: &rusqlite::Row) -> rusqlite::Result<TweetRow> {
    Ok(TweetRow {
        id: row.get(0)?, author_handle: row.get(1)?, author_name: row.get(2)?,
        content: row.get(3)?, created_at: row.get(4)?, tweet_url: row.get(5)?,
        likes: row.get(6)?, retweets: row.get(7)?, replies_count: row.get(8)?,
        views: row.get(9)?, source: row.get(10)?, ai_category: row.get(11)?,
        ai_cluster: row.get(12)?, ai_summary: row.get(13)?, ai_type: row.get(14)?,
        ai_topics: row.get::<_, Option<String>>(15)?.and_then(|s| serde_json::from_str(&s).ok()).unwrap_or_default(),
        has_media: row.get::<_, i32>(16).unwrap_or(0) != 0,
    })
}

pub fn cosine_similarity(a: &[f32], b: &[f32]) -> f32 {
    let dot: f32 = a.iter().zip(b.iter()).map(|(x, y)| x * y).sum();
    let norm_a: f32 = a.iter().map(|x| x * x).sum::<f32>().sqrt();
    let norm_b: f32 = b.iter().map(|x| x * x).sum::<f32>().sqrt();
    if norm_a == 0.0 || norm_b == 0.0 { return 0.0; }
    dot / (norm_a * norm_b)
}

fn f32_slice_to_bytes(floats: &[f32]) -> &[u8] {
    unsafe { std::slice::from_raw_parts(floats.as_ptr() as *const u8, floats.len() * 4) }
}

// ── Structs ──

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
    pub ai_cluster: Option<String>,
    pub ai_summary: Option<String>,
    pub ai_type: Option<String>,
    pub ai_topics: Vec<String>,
    pub has_media: bool,
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
    pub ai_cluster: Option<String>,
    pub ai_summary: Option<String>,
    pub ai_topics: Vec<String>,
    pub ai_type: Option<String>,
    pub has_embedding: bool,
    pub resolved_content: Option<String>,
    pub resolved_author: Option<String>,
    pub resolved_url: Option<String>,
}

#[derive(Debug, serde::Serialize, Clone)]
pub struct Tag {
    pub id: i64,
    pub name: String,
    pub color: Option<String>,
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
}

#[derive(Debug, serde::Serialize, Clone)]
pub struct Dot {
    pub id: i64,
    pub name: String,
    pub slug: String,
    pub parent_id: Option<i64>,
    pub description: Option<String>,
    pub color: Option<String>,
    pub created_at: String,
    pub bookmark_count: u32,
    pub children: Vec<Dot>,
}

#[derive(Debug, serde::Serialize, Clone)]
pub struct DotDetail {
    pub dot: Dot,
    pub tweets: Vec<TweetRow>,
    pub sub_dots: Vec<Dot>,
}
