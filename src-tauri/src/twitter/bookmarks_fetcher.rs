use anyhow::{Context, Result};
use serde_json::{json, Value};

use super::types::{Article, Engagement, Tweet, TweetDetail};

const BOOKMARKS_QUERY_ID: &str = "tmd4ifV8RHltzn8ymGg1aw";
const TWEET_DETAIL_QUERY_ID: &str = "xOhkmRac04YFZmOzU9PJHg";
const GRAPHQL_URL: &str = "https://x.com/i/api/graphql";
const BEARER_TOKEN: &str = "Bearer AAAAAAAAAAAAAAAAAAAAANRILgAAAAAAnNwIzUejRCOuH5E6I8xnZz4puTs%3D1Zv7ttfk8LF81IUq16cHjhLTvJu4FA33AGWWjCpTnA";
const USER_AGENT: &str = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36";

/// Fetches bookmarks and tweet details directly via Twitter's GraphQL API.
pub struct BookmarksFetcher {
    ct0: String,
    cookies_str: String,
}

impl BookmarksFetcher {
    /// Create a fetcher from stored cookies (extracted via webview login).
    pub fn new(ct0: String, cookies_str: String) -> Self {
        Self { ct0, cookies_str }
    }

    fn client(&self) -> reqwest::blocking::Client {
        reqwest::blocking::Client::builder()
            .timeout(std::time::Duration::from_secs(30))
            .build()
            .unwrap_or_else(|_| reqwest::blocking::Client::new())
    }

    fn authenticated_get_json(
        &self,
        client: &reqwest::blocking::Client,
        url: &str,
        endpoint_name: &str,
    ) -> Result<Value> {
        let path = url::Url::parse(url)
            .map(|u| u.path().to_string())
            .unwrap_or_default();

        let mut req = client
            .get(url)
            .header("authorization", BEARER_TOKEN)
            .header("x-csrf-token", &self.ct0)
            .header("cookie", &self.cookies_str)
            .header("x-twitter-auth-type", "OAuth2Session")
            .header("x-twitter-active-user", "yes")
            .header("user-agent", USER_AGENT)
            .header("accept", "application/json, text/plain, */*");

        // Add transaction ID if available (bypasses Cloudflare)
        if let Ok(tid) = super::graphql_ops::generate_transaction_id("GET", &path) {
            req = req.header("x-client-transaction-id", tid);
        }

        let response = req
            .send()
            .with_context(|| format!("Failed to connect to {}", endpoint_name))?;

        if !response.status().is_success() {
            let status = response.status();
            let text = response.text().unwrap_or_default();
            anyhow::bail!(
                "{} error {}: {}",
                endpoint_name,
                status,
                &text[..text.len().min(200)]
            );
        }

        response
            .json()
            .with_context(|| format!("Failed to parse JSON from {}", endpoint_name))
    }

    fn graphql_get(&self, client: &reqwest::blocking::Client, url: &str) -> Result<Value> {
        self.authenticated_get_json(client, url, "Twitter GraphQL")
    }

    // ── Account ──

    /// Extract the authenticated user's ID from the `twid` cookie.
    pub fn viewer_user_id(&self) -> Result<String> {
        self.cookies_str
            .split("; ")
            .find_map(|c| {
                let (name, value) = c.split_once('=')?;
                if name == "twid" {
                    let decoded = value.replace("%3D", "=").replace("%3d", "=");
                    decoded
                        .trim_matches('"')
                        .strip_prefix("u=")
                        .and_then(|id| id.split('&').next())
                        .filter(|id| !id.is_empty())
                        .map(|id| id.to_string())
                } else {
                    None
                }
            })
            .context("Cookie 'twid' introuvable. Connecte-toi à x.com dans ton navigateur.")
    }

    // ── Bookmarks ──

    /// Fetch all bookmarks with cursor-based pagination.
    pub fn fetch_all(&self, max_pages: u32) -> Result<Vec<Tweet>> {
        let client = self.client();
        let mut all_tweets = Vec::new();
        let mut seen_ids = std::collections::HashSet::new();
        let mut cursor: Option<String> = None;
        let mut consecutive_empty = 0u32;

        for page in 0..max_pages {
            let (tweets, next_cursor) = self.fetch_page(&client, cursor.as_deref())?;

            if tweets.is_empty() {
                log::info!(
                    "Bookmarks fetch complete (empty page): {} pages, {} unique tweets",
                    page,
                    all_tweets.len()
                );
                break;
            }

            let mut new_count = 0;
            for tweet in tweets {
                if seen_ids.insert(tweet.id.clone()) {
                    all_tweets.push(tweet);
                    new_count += 1;
                }
            }

            log::info!(
                "Bookmarks page {}: {} new, {} total",
                page + 1,
                new_count,
                all_tweets.len()
            );

            if new_count == 0 {
                consecutive_empty += 1;
                if consecutive_empty >= 2 {
                    break;
                }
            } else {
                consecutive_empty = 0;
            }

            match next_cursor {
                Some(c) => cursor = Some(c),
                None => break,
            }
        }

        Ok(all_tweets)
    }

    fn fetch_page(
        &self,
        client: &reqwest::blocking::Client,
        cursor: Option<&str>,
    ) -> Result<(Vec<Tweet>, Option<String>)> {
        let mut variables = json!({
            "count": 20,
            "includePromotedContent": false
        });

        if let Some(c) = cursor {
            variables["cursor"] = json!(c);
        }

        let features = standard_features();

        let url = format!(
            "{}/{}/Bookmarks?variables={}&features={}",
            GRAPHQL_URL,
            BOOKMARKS_QUERY_ID,
            urlencoded(&variables.to_string()),
            urlencoded(&features.to_string()),
        );

        let data = self.graphql_get(client, &url)?;
        parse_bookmarks_response(&data)
    }

    // ── Tweet Detail ──

    /// Fetch a single tweet's detail by ID.
    pub fn fetch_tweet_detail(&self, tweet_id: &str) -> Result<TweetDetail> {
        let client = self.client();

        let variables = json!({
            "focalTweetId": tweet_id,
            "referrer": "tweet",
            "with_rux_injections": false,
            "rankingMode": "Relevance",
            "includePromotedContent": true,
            "withCommunity": true,
            "withQuickPromoteEligibilityTweetFields": true,
            "withBirdwatchNotes": true,
            "withVoice": true
        });

        let features = standard_features();

        let field_toggles = json!({
            "withArticleRichContentState": true,
            "withArticlePlainText": false,
            "withGrokAnalyze": false,
            "withDisallowedReplyControls": false
        });

        let url = format!(
            "{}/{}/TweetDetail?variables={}&features={}&fieldToggles={}",
            GRAPHQL_URL,
            TWEET_DETAIL_QUERY_ID,
            urlencoded(&variables.to_string()),
            urlencoded(&features.to_string()),
            urlencoded(&field_toggles.to_string()),
        );

        let data = self.graphql_get(&client, &url)?;
        parse_tweet_detail_response(&data, tweet_id)
    }
}

// ── Shared helpers ──

fn standard_features() -> Value {
    json!({
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
    })
}

fn urlencoded(s: &str) -> String {
    let mut result = String::with_capacity(s.len() * 2);
    for c in s.chars() {
        match c {
            'A'..='Z' | 'a'..='z' | '0'..='9' | '-' | '_' | '.' | '~' => result.push(c),
            _ => {
                for b in c.to_string().as_bytes() {
                    result.push_str(&format!("%{:02X}", b));
                }
            }
        }
    }
    result
}

// ── Response parsing ──

fn parse_bookmarks_response(data: &Value) -> Result<(Vec<Tweet>, Option<String>)> {
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

        if entry_id.starts_with("cursor-bottom") {
            next_cursor = entry["content"]["value"].as_str().map(String::from);
            continue;
        }

        if entry_id.starts_with("tweet-") {
            if let Some(tweet) = parse_tweet_from_entry(entry) {
                tweets.push(tweet);
            }
        }
    }

    Ok((tweets, next_cursor))
}

fn parse_tweet_detail_response(data: &Value, tweet_id: &str) -> Result<TweetDetail> {
    // TweetDetail response nests tweets in timeline instructions
    let entries = data
        .pointer("/data/tweetResult/result")
        .map(|result| {
            // Direct result path
            vec![json!({"content": {"itemContent": {"tweet_results": {"result": result}}}})]
        })
        .or_else(|| {
            // Timeline instructions path (more common)
            data.pointer("/data/threaded_conversation_with_injections_v2/instructions")
                .and_then(|v| v.as_array())
                .and_then(|instructions| {
                    instructions.iter().find_map(|i| {
                        if i["type"].as_str() == Some("TimelineAddEntries") {
                            i["entries"].as_array().cloned()
                        } else {
                            None
                        }
                    })
                })
        })
        .unwrap_or_default();

    // Find the focal tweet
    for entry in &entries {
        if let Some(tweet) = parse_tweet_from_entry(entry) {
            if tweet.id == tweet_id {
                let article = extract_article(entry);
                return Ok(TweetDetail { tweet, article });
            }
        }
    }

    // Fallback: take the first valid tweet
    for entry in &entries {
        if let Some(tweet) = parse_tweet_from_entry(entry) {
            let article = extract_article(entry);
            return Ok(TweetDetail { tweet, article });
        }
    }

    anyhow::bail!("Tweet {} not found in response", tweet_id)
}

fn extract_article(entry: &Value) -> Option<Article> {
    let result = entry.pointer("/content/itemContent/tweet_results/result")?;
    let tweet_data = result.get("tweet").unwrap_or(result);

    // Check for Note tweet (long-form article)
    let note = tweet_data.pointer("/note_tweet/note_tweet_results/result")?;
    let text = note.get("text")?.as_str()?;

    // If it's significantly longer than a normal tweet, treat as article
    if text.len() > 500 {
        Some(Article {
            title: None,
            cover_image_url: None,
            markdown: Some(text.to_string()),
        })
    } else {
        None
    }
}

/// Parse a single tweet from a GraphQL timeline entry.
pub fn parse_tweet_from_entry(entry: &Value) -> Option<Tweet> {
    let result = entry.pointer("/content/itemContent/tweet_results/result")?;

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

    let engagement = Some(Engagement {
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

    let tweet_url = Some(format!("https://x.com/{}/status/{}", author_handle, id));

    Some(Tweet {
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
        reply_to_handle: legacy["in_reply_to_screen_name"].as_str().map(String::from),
        conversation_id: legacy["conversation_id_str"].as_str().map(String::from),
        language: legacy["lang"].as_str().map(String::from),
        source: None,
        is_retweet: Some(legacy.get("retweeted_status_result").is_some()),
        retweeted_by: None,
        is_subscriber_only: None,
        url: None,
        tweet_url,
        author_avatar: user["profile_image_url_https"]
            .as_str()
            .map(|u| u.replace("_normal.", "_bigger."))
            .or_else(|| user["profile_image_url_https"].as_str().map(String::from)),
    })
}
