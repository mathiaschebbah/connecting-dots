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
        }

        Ok(count)
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
             FROM tweets WHERE source = ?3 ORDER BY created_at DESC LIMIT ?1 OFFSET ?2"
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
    pub fn search_fulltext(&self, query: &str, limit: u32) -> Result<Vec<TweetRow>> {
        let conn = self.conn.lock().unwrap();
        let mut stmt = conn.prepare(
            "SELECT t.id, t.author_handle, t.author_name, t.content, t.created_at,
                    t.tweet_url, t.likes, t.retweets, t.replies_count, t.views, t.source
             FROM tweets t
             JOIN tweets_fts fts ON t.rowid = fts.rowid
             WHERE tweets_fts MATCH ?1
             ORDER BY rank
             LIMIT ?2",
        )?;

        let rows = stmt.query_map(rusqlite::params![query, limit], |row| {
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
        })?;

        let mut tweets = Vec::new();
        for row in rows {
            tweets.push(row?);
        }
        Ok(tweets)
    }

    // ── AI Metadata ──

    /// Get tweets without AI metadata
    pub fn tweets_without_ai_metadata(&self, limit: u32) -> Result<Vec<(String, String)>> {
        let conn = self.conn.lock().unwrap();
        let mut stmt = conn.prepare(
            "SELECT id, content FROM tweets WHERE ai_enriched_at IS NULL LIMIT ?1",
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
}

/// Convert &[f32] to &[u8] for sqlite-vec
fn f32_slice_to_bytes(floats: &[f32]) -> &[u8] {
    unsafe { std::slice::from_raw_parts(floats.as_ptr() as *const u8, floats.len() * 4) }
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
