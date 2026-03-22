use anyhow::{Context, Result};
use serde::Deserialize;
use std::process::Command;

/// Raw tweet structure from clix JSON output
#[derive(Debug, Deserialize, Clone, serde::Serialize)]
pub struct ClixTweet {
    pub id: String,
    pub text: String,
    pub author_id: Option<String>,
    pub author_name: Option<String>,
    pub author_handle: String,
    pub author_verified: Option<bool>,
    pub created_at: Option<String>,
    pub engagement: Option<ClixEngagement>,
    pub media: Option<Vec<serde_json::Value>>,
    pub quoted_tweet: Option<Box<ClixTweet>>,
    pub reply_to_id: Option<String>,
    pub reply_to_handle: Option<String>,
    pub conversation_id: Option<String>,
    pub language: Option<String>,
    pub source: Option<String>,
    pub is_retweet: Option<bool>,
    pub retweeted_by: Option<String>,
    pub is_subscriber_only: Option<bool>,
    pub url: Option<String>,
    pub tweet_url: Option<String>,
}

#[derive(Debug, Deserialize, Clone, serde::Serialize)]
pub struct ClixEngagement {
    pub likes: Option<i64>,
    pub retweets: Option<i64>,
    pub replies: Option<i64>,
    pub quotes: Option<i64>,
    pub bookmarks: Option<i64>,
    pub views: Option<i64>,
}

/// Tweet detail response (single tweet view)
#[derive(Debug, Deserialize, Clone, serde::Serialize)]
pub struct ClixTweetDetail {
    pub tweet: ClixTweet,
    pub article: Option<ClixArticle>,
}

#[derive(Debug, Deserialize, Clone, serde::Serialize)]
pub struct ClixArticle {
    pub title: Option<String>,
    pub cover_image_url: Option<String>,
    pub markdown: Option<String>,
}

/// User profile from clix
#[derive(Debug, Deserialize, Clone, serde::Serialize)]
pub struct ClixUser {
    pub id: String,
    pub name: String,
    pub handle: String,
    pub bio: Option<String>,
    pub location: Option<String>,
    pub website: Option<String>,
    pub verified: Option<bool>,
    pub followers_count: Option<i64>,
    pub following_count: Option<i64>,
    pub tweet_count: Option<i64>,
    pub listed_count: Option<i64>,
    pub created_at: Option<String>,
    pub profile_image_url: Option<String>,
    pub profile_banner_url: Option<String>,
    pub pinned_tweet_id: Option<String>,
}

/// Trending topic
#[derive(Debug, Deserialize, Clone, serde::Serialize)]
pub struct ClixTrending {
    pub name: String,
    pub tweet_count: Option<i64>,
    pub context: Option<String>,
    pub url: Option<String>,
}

pub struct Clix {
    command: String,
    args_prefix: Vec<String>,
}

impl Clix {
    pub fn new() -> Self {
        // Try to find clix in PATH first, fallback to uvx
        if Command::new("clix").arg("--version").output().is_ok() {
            Self {
                command: "clix".into(),
                args_prefix: vec![],
            }
        } else {
            Self {
                command: "uvx".into(),
                args_prefix: vec!["--from".into(), "clix0".into(), "clix".into()],
            }
        }
    }

    /// Run a clix command. Flags (like --json) go BEFORE positional args.
    fn run(&self, args: &[&str]) -> Result<serde_json::Value> {
        let mut cmd = Command::new(&self.command);
        for prefix_arg in &self.args_prefix {
            cmd.arg(prefix_arg);
        }
        cmd.args(args);

        let output = cmd
            .output()
            .context("Failed to run clix. Is it installed? (uv tool install clix0)")?;

        if !output.status.success() {
            let stderr = String::from_utf8_lossy(&output.stderr);
            anyhow::bail!("clix failed: {}", stderr);
        }

        let json: serde_json::Value = serde_json::from_slice(&output.stdout)
            .context("Failed to parse clix JSON output")?;

        Ok(json)
    }

    // ── Bookmarks ──

    pub fn bookmarks(&self, count: u32) -> Result<Vec<ClixTweet>> {
        let raw = self.run(&["bookmarks", "--json", "--count", &count.to_string()])?;
        let tweets: Vec<ClixTweet> = serde_json::from_value(raw)?;
        Ok(tweets)
    }

    // ── Feed ──

    pub fn feed(&self, feed_type: &str, count: u32) -> Result<Vec<ClixTweet>> {
        let raw = self.run(&[
            "feed",
            "--type",
            feed_type,
            "--json",
            "--count",
            &count.to_string(),
        ])?;
        let tweets: Vec<ClixTweet> = serde_json::from_value(raw)?;
        Ok(tweets)
    }

    // ── Tweet ──

    pub fn tweet_detail(&self, tweet_id: &str) -> Result<ClixTweetDetail> {
        let raw = self.run(&["tweet", "--json", tweet_id])?;
        let detail: ClixTweetDetail = serde_json::from_value(raw)?;
        Ok(detail)
    }

    pub fn tweet_thread(&self, tweet_id: &str) -> Result<Vec<ClixTweet>> {
        let raw = self.run(&["tweet", "--thread", "--json", tweet_id])?;
        let tweets: Vec<ClixTweet> = serde_json::from_value(raw)?;
        Ok(tweets)
    }

    // ── Search ──

    pub fn search(&self, query: &str, count: u32) -> Result<Vec<ClixTweet>> {
        let raw = self.run(&["search", "--json", "--count", &count.to_string(), query])?;
        let tweets: Vec<ClixTweet> = serde_json::from_value(raw)?;
        Ok(tweets)
    }

    // ── User ──

    pub fn user_profile(&self, handle: &str) -> Result<ClixUser> {
        let raw = self.run(&["user", "--json", handle])?;
        let user: ClixUser = serde_json::from_value(raw)?;
        Ok(user)
    }

    pub fn user_tweets(&self, handle: &str, count: u32) -> Result<Vec<ClixTweet>> {
        let raw = self.run(&[
            "user",
            "--json",
            handle,
            "tweets",
            "--count",
            &count.to_string(),
        ])?;
        let tweets: Vec<ClixTweet> = serde_json::from_value(raw)?;
        Ok(tweets)
    }

    // ── Trending ──

    pub fn trending(&self) -> Result<Vec<ClixTrending>> {
        let raw = self.run(&["trending", "--json"])?;
        let topics: Vec<ClixTrending> = serde_json::from_value(raw)?;
        Ok(topics)
    }
}
