use anyhow::{Context, Result};
use serde_json::{json, Value};
use std::path::PathBuf;

use super::clix::ClixTweet;

const BOOKMARKS_QUERY_ID: &str = "tmd4ifV8RHltzn8ymGg1aw";
const GRAPHQL_URL: &str = "https://x.com/i/api/graphql";

/// Fetches ALL bookmarks with cursor-based pagination, bypassing clix's single-page limit.
pub struct BookmarksFetcher {
    auth_token: String,
    ct0: String,
    cookies_str: String,
}

impl BookmarksFetcher {
    /// Load auth from clix's stored credentials
    pub fn from_clix_config() -> Result<Self> {
        let config_path = dirs::home_dir()
            .unwrap_or_else(|| PathBuf::from("/tmp"))
            .join(".config")
            .join("clix")
            .join("auth.json");

        let data = std::fs::read_to_string(&config_path)
            .context("Failed to read clix auth.json. Run 'clix auth login' first.")?;

        let auth: Value = serde_json::from_str(&data)?;
        let default_account = auth["accounts"]["default"]
            .as_object()
            .context("No default account in clix auth")?;

        let auth_token = default_account["auth_token"]
            .as_str()
            .context("Missing auth_token")?
            .to_string();

        let ct0 = default_account["ct0"]
            .as_str()
            .context("Missing ct0")?
            .to_string();

        // Build cookies string
        let cookies = default_account["cookies"]
            .as_object()
            .context("Missing cookies")?;

        let cookies_str = cookies
            .iter()
            .map(|(k, v)| format!("{}={}", k, v.as_str().unwrap_or("")))
            .collect::<Vec<_>>()
            .join("; ");

        Ok(Self {
            auth_token,
            ct0,
            cookies_str,
        })
    }

    /// Fetch all bookmarks, paginating through all pages.
    /// Deduplicates and stops when no new bookmarks are found.
    pub fn fetch_all(&self, max_pages: u32) -> Result<Vec<ClixTweet>> {
        let client = reqwest::blocking::Client::new();
        let mut all_tweets = Vec::new();
        let mut seen_ids = std::collections::HashSet::new();
        let mut cursor: Option<String> = None;

        for page in 0..max_pages {
            let (tweets, next_cursor) = self.fetch_page(&client, cursor.as_deref())?;

            if tweets.is_empty() {
                log::info!("Bookmarks fetch complete: {} pages, {} unique tweets", page, all_tweets.len());
                break;
            }

            // Deduplicate: only keep tweets we haven't seen yet
            let mut new_count = 0;
            for tweet in tweets {
                if seen_ids.insert(tweet.id.clone()) {
                    all_tweets.push(tweet);
                    new_count += 1;
                }
            }

            // If no new tweets on this page, we've looped — stop
            if new_count == 0 {
                log::info!("Bookmarks fetch complete (no new tweets): {} pages, {} unique tweets", page + 1, all_tweets.len());
                break;
            }

            match next_cursor {
                Some(c) => cursor = Some(c),
                None => {
                    log::info!("Bookmarks fetch complete (no more cursor): {} pages, {} unique tweets", page + 1, all_tweets.len());
                    break;
                }
            }
        }

        Ok(all_tweets)
    }

    fn fetch_page(
        &self,
        client: &reqwest::blocking::Client,
        cursor: Option<&str>,
    ) -> Result<(Vec<ClixTweet>, Option<String>)> {
        let mut variables = json!({
            "count": 100,
            "includePromotedContent": false
        });

        if let Some(c) = cursor {
            variables["cursor"] = json!(c);
        }

        let features = json!({
            "graphql_timeline_v2_bookmark_timeline": true,
            "rweb_tipjar_consumption_enabled": true,
            "responsive_web_graphql_exclude_directive_enabled": true,
            "verified_phone_label_enabled": false,
            "creator_subscriptions_tweet_preview_api_enabled": true,
            "responsive_web_graphql_timeline_navigation_enabled": true,
            "responsive_web_graphql_skip_user_profile_image_extensions_enabled": false,
            "communities_web_enable_tweet_community_results_fetch": true,
            "c9s_tweet_anatomy_moderator_badge_enabled": true,
            "articles_preview_enabled": true,
            "responsive_web_edit_tweet_api_enabled": true,
            "tweetypie_unmention_optimization_enabled": true,
            "responsive_web_text_conversations_enabled": false,
            "freedom_of_speech_not_reach_fetch_enabled": true,
            "standardized_nudges_misinfo": true,
            "tweet_with_visibility_results_prefer_gql_limited_actions_policy_enabled": true,
            "longform_notetweets_rich_text_read_enabled": true,
            "longform_notetweets_inline_media_enabled": true,
            "responsive_web_enhance_cards_enabled": false,
            "tweet_awards_web_tipping_enabled": false,
            "rweb_video_timestamps_enabled": true,
            "longform_notetweets_consumption_enabled": true
        });

        let url = format!(
            "{}/{}/Bookmarks?variables={}&features={}",
            GRAPHQL_URL,
            BOOKMARKS_QUERY_ID,
            urlencoded(&variables.to_string()),
            urlencoded(&features.to_string()),
        );

        let response = client
            .get(&url)
            .header("authorization", "Bearer AAAAAAAAAAAAAAAAAAAAANRILgAAAAAAnNwIzUejRCOuH5E6I8xnZz4puTs%3D1Zv7ttfk8LF81IUq16cHjhLTvJu4FA33AGWWjCpTnA")
            .header("x-csrf-token", &self.ct0)
            .header("cookie", &self.cookies_str)
            .header("x-twitter-auth-type", "OAuth2Session")
            .header("x-twitter-active-user", "yes")
            .header("user-agent", "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36")
            .send()
            .context("Failed to fetch bookmarks from Twitter GraphQL")?;

        if !response.status().is_success() {
            let status = response.status();
            let text = response.text().unwrap_or_default();
            anyhow::bail!("Twitter GraphQL error {}: {}", status, &text[..text.len().min(200)]);
        }

        let data: Value = response.json()?;

        // Parse the GraphQL response into tweets and extract cursor
        let (tweets, next_cursor) = parse_bookmarks_response(&data)?;

        Ok((tweets, next_cursor))
    }
}

fn urlencoded(s: &str) -> String {
    s.replace('{', "%7B")
        .replace('}', "%7D")
        .replace('"', "%22")
        .replace(':', "%3A")
        .replace(',', "%2C")
        .replace('[', "%5B")
        .replace(']', "%5D")
        .replace(' ', "%20")
}

fn parse_bookmarks_response(data: &Value) -> Result<(Vec<ClixTweet>, Option<String>)> {
    let entries = data
        .pointer("/data/bookmark_timeline_v2/timeline/instructions")
        .and_then(|v| v.as_array())
        .and_then(|instructions| {
            instructions.iter().find_map(|i| {
                if i["type"].as_str() == Some("TimelineAddEntries") {
                    i["entries"].as_array()
                } else {
                    None
                }
            })
        })
        .cloned()
        .unwrap_or_default();

    let mut tweets = Vec::new();
    let mut next_cursor = None;

    for entry in &entries {
        let entry_id = entry["entryId"].as_str().unwrap_or("");

        // Cursor entries
        if entry_id.starts_with("cursor-bottom") {
            next_cursor = entry["content"]["value"]
                .as_str()
                .map(String::from);
            continue;
        }

        // Tweet entries
        if entry_id.starts_with("tweet-") {
            if let Some(tweet) = parse_tweet_result(entry) {
                tweets.push(tweet);
            }
        }
    }

    Ok((tweets, next_cursor))
}

fn parse_tweet_result(entry: &Value) -> Option<ClixTweet> {
    let result = entry
        .pointer("/content/itemContent/tweet_results/result")?;

    // Handle tombstone / unavailable tweets
    let tweet_data = if result.get("tweet").is_some() {
        result.get("tweet")?
    } else {
        result
    };

    let legacy = tweet_data.get("legacy")?;
    let core = tweet_data.get("core")?;
    let user = core.pointer("/user_results/result/legacy")?;

    let id = legacy["id_str"].as_str()?.to_string();
    let text = legacy["full_text"].as_str().unwrap_or("").to_string();
    let author_handle = user["screen_name"].as_str()?.to_string();
    let author_name = user["name"].as_str().map(String::from);
    let author_id = tweet_data
        .pointer("/core/user_results/result/rest_id")
        .and_then(|v| v.as_str())
        .map(String::from);

    let created_at = legacy["created_at"].as_str().map(String::from);

    let engagement = Some(super::clix::ClixEngagement {
        likes: legacy["favorite_count"].as_i64(),
        retweets: legacy["retweet_count"].as_i64(),
        replies: legacy["reply_count"].as_i64(),
        quotes: legacy["quote_count"].as_i64(),
        bookmarks: legacy["bookmark_count"].as_i64(),
        views: tweet_data
            .pointer("/views/count")
            .and_then(|v| v.as_str())
            .and_then(|s| s.parse().ok()),
    });

    let conversation_id = legacy["conversation_id_str"]
        .as_str()
        .map(String::from);

    let tweet_url = Some(format!(
        "https://x.com/{}/status/{}",
        author_handle, id
    ));

    Some(ClixTweet {
        id,
        text,
        author_id,
        author_name,
        author_handle,
        author_verified: None,
        created_at,
        engagement,
        media: None,
        quoted_tweet: None,
        reply_to_id: legacy["in_reply_to_status_id_str"]
            .as_str()
            .map(String::from),
        reply_to_handle: legacy["in_reply_to_screen_name"]
            .as_str()
            .map(String::from),
        conversation_id,
        language: legacy["lang"].as_str().map(String::from),
        source: None,
        is_retweet: Some(legacy.get("retweeted_status_result").is_some()),
        retweeted_by: None,
        is_subscriber_only: None,
        url: None,
        tweet_url,
    })
}
