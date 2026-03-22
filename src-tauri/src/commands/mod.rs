use crate::db::{cosine_similarity, TweetRow};
use crate::twitter::clix::Clix;
use crate::workers;
use crate::AppState;
use serde::Serialize;
use tauri::State;

#[derive(Debug, Serialize, Clone)]
pub struct SyncResult {
    pub new_tweets: u32,
    pub total_tweets: u32,
}

#[tauri::command]
pub async fn sync_bookmarks(state: State<'_, AppState>) -> Result<SyncResult, String> {
    let clix = Clix::new();
    let tweets = clix.bookmarks(200).map_err(|e| e.to_string())?;
    let new_tweets = state.db.upsert_tweets(&tweets, "bookmark").map_err(|e| e.to_string())?;
    let total_tweets = state.db.tweet_count().map_err(|e| e.to_string())?;

    log::info!("Synced bookmarks: {} new, {} total", new_tweets, total_tweets);

    Ok(SyncResult {
        new_tweets,
        total_tweets,
    })
}

#[tauri::command]
pub async fn sync_feed(state: State<'_, AppState>) -> Result<SyncResult, String> {
    let clix = Clix::new();
    let tweets = clix.feed("following", 100).map_err(|e| e.to_string())?;
    let new_tweets = state.db.upsert_tweets(&tweets, "feed").map_err(|e| e.to_string())?;
    let total_tweets = state.db.tweet_count().map_err(|e| e.to_string())?;

    log::info!("Synced feed: {} new, {} total", new_tweets, total_tweets);

    Ok(SyncResult {
        new_tweets,
        total_tweets,
    })
}

#[tauri::command]
pub async fn list_tweets(
    state: State<'_, AppState>,
    limit: Option<u32>,
    offset: Option<u32>,
    source: Option<String>,
) -> Result<Vec<TweetRow>, String> {
    state
        .db
        .list_tweets(
            limit.unwrap_or(50),
            offset.unwrap_or(0),
            source.as_deref(),
        )
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn search_tweets(
    state: State<'_, AppState>,
    query: String,
    limit: Option<u32>,
    source: Option<String>,
) -> Result<Vec<TweetRow>, String> {
    state
        .db
        .search_fulltext(&query, limit.unwrap_or(20), source.as_deref())
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn get_tweet_count(state: State<'_, AppState>) -> Result<u32, String> {
    state.db.tweet_count().map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn search_semantic(
    state: State<'_, AppState>,
    query: String,
    limit: Option<u32>,
) -> Result<Vec<TweetRow>, String> {
    let embedding = state
        .embedder
        .embed_one(&query)
        .map_err(|e| e.to_string())?;
    state
        .db
        .search_semantic(&embedding, limit.unwrap_or(20))
        .map_err(|e| e.to_string())
}

#[derive(Debug, Serialize, Clone)]
pub struct EmbedResult {
    pub embedded_count: u32,
    pub remaining: u32,
}

#[tauri::command]
pub async fn embed_pending(state: State<'_, AppState>) -> Result<EmbedResult, String> {
    let batch_size = 50u32;
    let pending = state
        .db
        .tweets_without_embedding(batch_size)
        .map_err(|e| e.to_string())?;

    if pending.is_empty() {
        return Ok(EmbedResult {
            embedded_count: 0,
            remaining: 0,
        });
    }

    let texts: Vec<String> = pending.iter().map(|(_, content)| content.clone()).collect();
    let embeddings = state
        .embedder
        .embed_batch(&texts)
        .map_err(|e| e.to_string())?;

    let mut count = 0u32;
    for ((tweet_id, _), embedding) in pending.iter().zip(embeddings.iter()) {
        state
            .db
            .store_embedding(tweet_id, embedding)
            .map_err(|e| e.to_string())?;
        count += 1;
    }

    let remaining = state
        .db
        .tweets_without_embedding(1)
        .map_err(|e| e.to_string())?
        .len() as u32;

    log::info!("Embedded {} tweets, {} remaining", count, remaining);

    Ok(EmbedResult {
        embedded_count: count,
        remaining,
    })
}

#[tauri::command]
pub async fn check_api_key(state: State<'_, AppState>) -> Result<bool, String> {
    let config = state.config.lock().unwrap();
    Ok(config.has_api_key())
}

#[tauri::command]
pub async fn set_api_key(
    state: State<'_, AppState>,
    api_key: String,
) -> Result<bool, String> {
    // Save to config
    {
        let mut config = state.config.lock().unwrap();
        config.anthropic_api_key = Some(api_key.clone());
        config.save(&state.app_dir).map_err(|e| e.to_string())?;
    }

    // Start workers now that we have a key
    workers::start_all(
        state.db.clone(),
        state.embedder.clone(),
        Some(api_key),
    );

    log::info!("API key set, workers started");

    Ok(true)
}

#[derive(Debug, Serialize, Clone)]
pub struct GraphData {
    pub nodes: Vec<GraphNodeOut>,
    pub links: Vec<GraphLink>,
}

#[derive(Debug, Serialize, Clone)]
pub struct GraphNodeOut {
    pub id: String,
    pub author_handle: String,
    pub author_name: Option<String>,
    pub content_preview: String,
    pub category: Option<String>,
    pub summary: Option<String>,
    pub topics: Vec<String>,
}

#[derive(Debug, Serialize, Clone)]
pub struct GraphLink {
    pub source: String,
    pub target: String,
    pub similarity: f32,
}

#[tauri::command]
pub async fn get_network_graph(
    state: State<'_, AppState>,
    source: Option<String>,
    similarity_threshold: Option<f32>,
    limit: Option<u32>,
) -> Result<GraphData, String> {
    let threshold = similarity_threshold.unwrap_or(0.65);
    let nodes = state
        .db
        .get_graph_nodes(source.as_deref(), limit.unwrap_or(200))
        .map_err(|e| e.to_string())?;

    // Compute edges: cosine similarity between all pairs above threshold
    let mut links = Vec::new();
    for i in 0..nodes.len() {
        for j in (i + 1)..nodes.len() {
            let sim = cosine_similarity(&nodes[i].embedding, &nodes[j].embedding);
            if sim >= threshold {
                links.push(GraphLink {
                    source: nodes[i].id.clone(),
                    target: nodes[j].id.clone(),
                    similarity: sim,
                });
            }
        }
    }

    let graph_nodes: Vec<GraphNodeOut> = nodes
        .into_iter()
        .map(|n| GraphNodeOut {
            id: n.id,
            author_handle: n.author_handle,
            author_name: n.author_name,
            content_preview: n.content_preview,
            category: n.category,
            summary: n.summary,
            topics: n.topics,
        })
        .collect();

    Ok(GraphData {
        nodes: graph_nodes,
        links,
    })
}
