use crate::agent::{self, AgentEvent, ChatMessage};
use crate::db::{cosine_similarity, ClusterStat, DashboardStats, Group, KanbanCard, KanbanColumn, MonitoredTopic, PinnedAccount, Project, Tag, TweetFull, TweetNote, TweetRow};
use crate::twitter::clix::Clix;
use crate::workers;
use crate::AppState;
use serde::Serialize;
use tauri::{Emitter, State};

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
pub async fn reset_enrichments(state: State<'_, AppState>) -> Result<u32, String> {
    state.db.reset_all_enrichments().map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn check_api_key(state: State<'_, AppState>) -> Result<bool, String> {
    let config = state.config.lock().unwrap();
    Ok(config.has_api_key())
}

#[tauri::command]
pub async fn set_api_key(
    state: State<'_, AppState>,
    app_handle: tauri::AppHandle,
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
        app_handle,
    );

    log::info!("API key set, workers started");

    Ok(true)
}

#[derive(Debug, Serialize, Clone)]
pub struct TweetDetailResult {
    pub tweet: TweetFull,
    pub similar: Vec<TweetRow>,
    pub tags: Vec<Tag>,
}

#[tauri::command]
pub async fn get_tweet_detail(
    state: State<'_, AppState>,
    tweet_id: String,
) -> Result<TweetDetailResult, String> {
    let tweet = state
        .db
        .get_tweet_full(&tweet_id)
        .map_err(|e| e.to_string())?
        .ok_or_else(|| "Tweet not found".to_string())?;

    // Find similar tweets via embedding
    let similar = if tweet.has_embedding {
        match state.db.get_embedding(&tweet_id) {
            Ok(Some(embedding)) => state
                .db
                .search_semantic(&embedding, 10)
                .unwrap_or_default()
                .into_iter()
                .filter(|t| t.id != tweet_id)
                .collect(),
            _ => vec![],
        }
    } else {
        vec![]
    };

    let tags = state.db.get_tweet_tags(&tweet_id).unwrap_or_default();

    Ok(TweetDetailResult { tweet, similar, tags })
}

#[tauri::command]
pub async fn list_tags(state: State<'_, AppState>) -> Result<Vec<Tag>, String> {
    state.db.list_tags().map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn create_and_assign_tag(
    state: State<'_, AppState>,
    tweet_id: String,
    tag_name: String,
    color: Option<String>,
) -> Result<Tag, String> {
    let tag_id = state
        .db
        .create_tag(&tag_name, color.as_deref())
        .map_err(|e| e.to_string())?;
    state
        .db
        .tag_tweet(&tweet_id, tag_id)
        .map_err(|e| e.to_string())?;
    Ok(Tag {
        id: tag_id,
        name: tag_name,
        color,
    })
}

#[tauri::command]
pub async fn remove_tag_from_tweet(
    state: State<'_, AppState>,
    tweet_id: String,
    tag_id: i64,
) -> Result<bool, String> {
    state
        .db
        .untag_tweet(&tweet_id, tag_id)
        .map_err(|e| e.to_string())?;
    Ok(true)
}

#[tauri::command]
pub async fn send_agent_message(
    state: State<'_, AppState>,
    app: tauri::AppHandle,
    message: String,
    history: Vec<ChatMessage>,
) -> Result<bool, String> {
    let api_key = {
        let config = state.config.lock().unwrap();
        config.api_key().map(String::from).ok_or("No API key")?
    };

    let db = state.db.clone();
    let embedder = state.embedder.clone();

    let (tx, mut rx) = tokio::sync::mpsc::channel::<AgentEvent>(100);

    // Spawn agent in background
    tauri::async_runtime::spawn(async move {
        agent::run_agent(db, embedder, api_key, message, history, tx).await;
    });

    // Forward events to frontend
    tauri::async_runtime::spawn(async move {
        while let Some(event) = rx.recv().await {
            let _ = app.emit("agent:event", &event);
        }
    });

    Ok(true)
}

// ── Category queries ──

#[tauri::command]
pub async fn list_tweets_by_category(
    state: State<'_, AppState>,
    category: String,
    limit: Option<u32>,
) -> Result<Vec<TweetRow>, String> {
    state.db.list_tweets_by_category(&category, limit.unwrap_or(50)).map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn list_tweets_by_cluster(
    state: State<'_, AppState>,
    cluster: String,
    limit: Option<u32>,
) -> Result<Vec<TweetRow>, String> {
    state.db.list_tweets_by_cluster(&cluster, limit.unwrap_or(50)).map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn get_cluster_stats(state: State<'_, AppState>) -> Result<Vec<ClusterStat>, String> {
    state.db.get_cluster_stats().map_err(|e| e.to_string())
}

// ── Thread ──

#[derive(Debug, Serialize, Clone)]
pub struct ThreadData {
    pub tweets: Vec<ThreadTweet>,
}

#[derive(Debug, Serialize, Clone)]
pub struct ThreadTweet {
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
}

#[tauri::command]
pub async fn get_thread(tweet_id: String) -> Result<ThreadData, String> {
    let clix = Clix::new();
    match clix.tweet_thread(&tweet_id) {
        Ok(tweets) => {
            let thread_tweets: Vec<ThreadTweet> = tweets.into_iter().map(|t| {
                let eng = t.engagement.as_ref();
                ThreadTweet {
                    id: t.id,
                    author_handle: t.author_handle,
                    author_name: t.author_name,
                    content: t.text,
                    created_at: t.created_at,
                    tweet_url: t.tweet_url,
                    likes: eng.and_then(|e| e.likes).unwrap_or(0),
                    retweets: eng.and_then(|e| e.retweets).unwrap_or(0),
                    replies_count: eng.and_then(|e| e.replies).unwrap_or(0),
                    views: eng.and_then(|e| e.views).unwrap_or(0),
                }
            }).collect();
            Ok(ThreadData { tweets: thread_tweets })
        }
        Err(e) => Err(e.to_string()),
    }
}

// ── Dashboard ──

#[tauri::command]
pub async fn get_dashboard_stats(state: State<'_, AppState>) -> Result<DashboardStats, String> {
    state.db.get_dashboard_stats().map_err(|e| e.to_string())
}

// ── Projects ──

#[tauri::command]
pub async fn list_projects(state: State<'_, AppState>) -> Result<Vec<Project>, String> {
    state.db.list_projects().map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn create_project(
    state: State<'_, AppState>,
    name: String,
    description: Option<String>,
    color: Option<String>,
) -> Result<Project, String> {
    state.db.create_project(&name, description.as_deref(), color.as_deref()).map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn delete_project(state: State<'_, AppState>, id: i64) -> Result<bool, String> {
    state.db.delete_project(id).map_err(|e| e.to_string())?;
    Ok(true)
}

// ── Kanban ──

#[tauri::command]
pub async fn list_kanban_columns(state: State<'_, AppState>, project_id: i64) -> Result<Vec<KanbanColumn>, String> {
    state.db.list_kanban_columns(project_id).map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn create_kanban_column(
    state: State<'_, AppState>,
    project_id: i64,
    name: String,
) -> Result<KanbanColumn, String> {
    state.db.create_kanban_column(project_id, &name).map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn delete_kanban_column(state: State<'_, AppState>, id: i64) -> Result<bool, String> {
    state.db.delete_kanban_column(id).map_err(|e| e.to_string())?;
    Ok(true)
}

#[tauri::command]
pub async fn list_kanban_cards(state: State<'_, AppState>, column_id: i64) -> Result<Vec<KanbanCard>, String> {
    state.db.list_kanban_cards(column_id).map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn create_kanban_card(
    state: State<'_, AppState>,
    column_id: i64,
    tweet_id: String,
    note: Option<String>,
) -> Result<KanbanCard, String> {
    state.db.create_kanban_card(column_id, &tweet_id, note.as_deref()).map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn move_kanban_card(
    state: State<'_, AppState>,
    card_id: i64,
    target_column_id: i64,
    target_position: i64,
) -> Result<bool, String> {
    state.db.move_kanban_card(card_id, target_column_id, target_position).map_err(|e| e.to_string())?;
    Ok(true)
}

#[tauri::command]
pub async fn delete_kanban_card(state: State<'_, AppState>, id: i64) -> Result<bool, String> {
    state.db.delete_kanban_card(id).map_err(|e| e.to_string())?;
    Ok(true)
}

// ── Monitored Topics ──

#[tauri::command]
pub async fn list_monitored_topics(state: State<'_, AppState>) -> Result<Vec<MonitoredTopic>, String> {
    state.db.list_monitored_topics().map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn delete_monitored_topic(state: State<'_, AppState>, id: i64) -> Result<bool, String> {
    state.db.delete_monitored_topic(id).map_err(|e| e.to_string())?;
    Ok(true)
}

// ── Groups ──

#[tauri::command]
pub async fn list_groups(state: State<'_, AppState>, project_id: i64) -> Result<Vec<Group>, String> {
    state.db.list_groups(project_id).map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn create_group(state: State<'_, AppState>, project_id: i64, name: String, color: Option<String>) -> Result<Group, String> {
    state.db.create_group(project_id, &name, color.as_deref()).map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn delete_group(state: State<'_, AppState>, group_id: i64) -> Result<bool, String> {
    state.db.delete_group(group_id).map_err(|e| e.to_string())?;
    Ok(true)
}

#[tauri::command]
pub async fn add_tweet_to_group(state: State<'_, AppState>, tweet_id: String, group_id: i64) -> Result<bool, String> {
    state.db.add_tweet_to_group(&tweet_id, group_id).map_err(|e| e.to_string())?;
    Ok(true)
}

#[tauri::command]
pub async fn remove_tweet_from_group(state: State<'_, AppState>, tweet_id: String, group_id: i64) -> Result<bool, String> {
    state.db.remove_tweet_from_group(&tweet_id, group_id).map_err(|e| e.to_string())?;
    Ok(true)
}

#[tauri::command]
pub async fn get_group_tweets(state: State<'_, AppState>, group_id: i64, limit: Option<u32>) -> Result<Vec<TweetRow>, String> {
    state.db.get_group_tweets(group_id, limit.unwrap_or(100)).map_err(|e| e.to_string())
}

// ── Tweet Notes ──

#[tauri::command]
pub async fn get_tweet_notes(state: State<'_, AppState>, tweet_id: String) -> Result<Vec<TweetNote>, String> {
    state.db.get_tweet_notes(&tweet_id).map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn create_tweet_note(state: State<'_, AppState>, tweet_id: String, content: String) -> Result<TweetNote, String> {
    state.db.create_tweet_note(&tweet_id, &content).map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn update_tweet_note(state: State<'_, AppState>, note_id: i64, content: String) -> Result<bool, String> {
    state.db.update_tweet_note(note_id, &content).map_err(|e| e.to_string())?;
    Ok(true)
}

#[tauri::command]
pub async fn delete_tweet_note(state: State<'_, AppState>, note_id: i64) -> Result<bool, String> {
    state.db.delete_tweet_note(note_id).map_err(|e| e.to_string())?;
    Ok(true)
}

// ── Pinned Accounts ──

#[tauri::command]
pub async fn list_pinned_accounts(state: State<'_, AppState>) -> Result<Vec<PinnedAccount>, String> {
    state.db.list_pinned_accounts().map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn pin_account(
    state: State<'_, AppState>,
    handle: String,
    display_name: Option<String>,
    bio: Option<String>,
) -> Result<PinnedAccount, String> {
    state.db.pin_account(&handle, display_name.as_deref(), bio.as_deref()).map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn unpin_account(state: State<'_, AppState>, handle: String) -> Result<bool, String> {
    state.db.unpin_account(&handle).map_err(|e| e.to_string())?;
    Ok(true)
}

#[tauri::command]
pub async fn get_account_tweets(
    state: State<'_, AppState>,
    handle: String,
    limit: Option<u32>,
) -> Result<Vec<TweetRow>, String> {
    state.db.get_account_tweets(&handle, limit.unwrap_or(50)).map_err(|e| e.to_string())
}

// ── Network Graph ──

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
    pub cluster: Option<String>,
    pub summary: Option<String>,
    pub topics: Vec<String>,
    pub created_at: Option<String>,
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
            cluster: n.cluster,
            summary: n.summary,
            topics: n.topics,
            created_at: n.created_at,
        })
        .collect();

    Ok(GraphData {
        nodes: graph_nodes,
        links,
    })
}
