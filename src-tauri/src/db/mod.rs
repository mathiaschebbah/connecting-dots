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
                    t.tweet_url, t.likes, t.retweets, t.replies_count, t.views, t.source
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
                    tweet_url, likes, retweets, replies_count, views, source
             FROM tweets WHERE source = ?3 ORDER BY bookmark_order ASC LIMIT ?1 OFFSET ?2"
        } else {
            "SELECT id, author_handle, author_name, content, created_at,
                    tweet_url, likes, retweets, replies_count, views, source
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
                    t.tweet_url, t.likes, t.retweets, t.replies_count, t.views, t.source
             FROM tweets t
             JOIN tweets_fts fts ON t.rowid = fts.rowid
             WHERE tweets_fts MATCH ?1 AND t.source = ?3
             ORDER BY rank
             LIMIT ?2"
        } else {
            "SELECT t.id, t.author_handle, t.author_name, t.content, t.created_at,
                    t.tweet_url, t.likes, t.retweets, t.replies_count, t.views, t.source
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
}
