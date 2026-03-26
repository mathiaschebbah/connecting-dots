use serde::Deserialize;

/// Raw tweet structure from Twitter GraphQL
#[derive(Debug, Deserialize, Clone, serde::Serialize)]
pub struct Tweet {
    pub id: String,
    pub text: String,
    pub author_id: Option<String>,
    pub author_name: Option<String>,
    pub author_handle: String,
    pub author_verified: Option<bool>,
    pub created_at: Option<String>,
    pub engagement: Option<Engagement>,
    pub media: Option<Vec<serde_json::Value>>,
    pub quoted_tweet: Option<Box<Tweet>>,
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
pub struct Engagement {
    pub likes: Option<i64>,
    pub retweets: Option<i64>,
    pub replies: Option<i64>,
    pub quotes: Option<i64>,
    pub bookmarks: Option<i64>,
    pub views: Option<i64>,
}

/// Tweet detail with optional article content
#[derive(Debug, Deserialize, Clone, serde::Serialize)]
pub struct TweetDetail {
    pub tweet: Tweet,
    pub article: Option<Article>,
}

#[derive(Debug, Deserialize, Clone, serde::Serialize)]
pub struct Article {
    pub title: Option<String>,
    pub cover_image_url: Option<String>,
    pub markdown: Option<String>,
}
