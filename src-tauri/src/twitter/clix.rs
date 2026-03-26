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
    #[serde(default)]
    pub author_avatar: Option<String>,
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

    /// Create a new Clix with the same command/prefix (for use in spawn_blocking)
    pub fn clone_command(&self) -> Self {
        Self {
            command: self.command.clone(),
            args_prefix: self.args_prefix.clone(),
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

        let json: serde_json::Value =
            serde_json::from_slice(&output.stdout).context("Failed to parse clix JSON output")?;

        Ok(json)
    }

    // ── Bookmarks ──

    pub fn bookmarks(&self, count: u32) -> Result<Vec<ClixTweet>> {
        let raw = self.run(&["bookmarks", "--json", "--count", &count.to_string()])?;
        let tweets: Vec<ClixTweet> = serde_json::from_value(raw)?;
        Ok(tweets)
    }

    // ── Tweet ──

    pub fn tweet_detail(&self, tweet_id: &str) -> Result<ClixTweetDetail> {
        let raw = self.run(&["tweet", "--json", tweet_id])?;

        // clix returns different formats depending on the tweet:
        // - Array of tweets (thread): [{tweet1}, {tweet2}, ...]
        // - Single object: {tweet, article}
        // - Single tweet object: {id, text, ...}

        if let Some(arr) = raw.as_array() {
            // It's a thread array — find the tweet matching our ID
            let tweet = arr
                .iter()
                .find_map(|v| {
                    let t: ClixTweet = serde_json::from_value(v.clone()).ok()?;
                    if t.id == tweet_id {
                        Some(t)
                    } else {
                        None
                    }
                })
                .or_else(|| {
                    // Fallback: take the first tweet
                    arr.first()
                        .and_then(|v| serde_json::from_value(v.clone()).ok())
                })
                .ok_or_else(|| anyhow::anyhow!("Empty response from clix"))?;
            Ok(ClixTweetDetail {
                tweet,
                article: None,
            })
        } else if let Ok(detail) = serde_json::from_value::<ClixTweetDetail>(raw.clone()) {
            Ok(detail)
        } else {
            // Single tweet object
            let tweet: ClixTweet = serde_json::from_value(raw)?;
            Ok(ClixTweetDetail {
                tweet,
                article: None,
            })
        }
    }

}
