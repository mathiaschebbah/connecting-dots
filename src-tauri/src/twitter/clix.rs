use anyhow::{Context, Result};
use serde_json::Value;
use std::process::Command;

pub struct Clix;

impl Clix {
    pub fn run(args: &[&str]) -> Result<Value> {
        let output = Command::new("clix")
            .args(args)
            .arg("--json")
            .output()
            .context("Failed to run clix. Is it installed? (pip install clix0)")?;

        if !output.status.success() {
            let stderr = String::from_utf8_lossy(&output.stderr);
            anyhow::bail!("clix failed: {}", stderr);
        }

        let json: Value =
            serde_json::from_slice(&output.stdout).context("Failed to parse clix JSON output")?;

        Ok(json)
    }

    pub fn bookmarks(count: u32) -> Result<Value> {
        Self::run(&["bookmarks", "--count", &count.to_string()])
    }

    pub fn feed(feed_type: &str, count: u32) -> Result<Value> {
        Self::run(&["feed", "--type", feed_type, "--count", &count.to_string()])
    }

    pub fn tweet(tweet_id: &str) -> Result<Value> {
        Self::run(&["tweet", tweet_id])
    }

    pub fn search(query: &str, count: u32) -> Result<Value> {
        Self::run(&["search", query, "--count", &count.to_string()])
    }

    pub fn user(handle: &str) -> Result<Value> {
        Self::run(&["user", handle])
    }
}
