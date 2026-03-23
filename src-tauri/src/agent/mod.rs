use crate::db::Database;
use crate::embeddings::Embedder;
use crate::twitter::clix::Clix;
use anyhow::Result;
use serde::{Deserialize, Serialize};
use std::sync::Arc;

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct ChatMessage {
    pub role: String,
    pub content: serde_json::Value,
}

#[derive(Debug, Serialize, Clone)]
#[serde(tag = "type")]
pub enum AgentEvent {
    #[serde(rename = "text")]
    Text { text: String },
    #[serde(rename = "tool_start")]
    ToolStart { tool: String, input: serde_json::Value },
    #[serde(rename = "tool_result")]
    ToolResult { tool: String, result: serde_json::Value },
    #[serde(rename = "done")]
    Done,
    #[serde(rename = "error")]
    Error { message: String },
}

const SYSTEM_PROMPT: &str = r#"Tu es l'agent IA de Connecting Dots, un moteur de signets X/Twitter qui organise les bookmarks en "dots" (dossiers thématiques).

RÈGLES :
- Utilise TOUJOURS les outils de manière proactive. Fais-le et montre les résultats.
- Sois concis et orienté résultat. Parle toujours en français.

TON RÔLE :
- Explorer les signets par sujet, trouver des connexions entre dots.
- Chercher sur Twitter pour compléter un sujet.
- Taguer et organiser les signets.

Outils :
- list_dots : Liste tous les dots existants (sujets). Utilise-le pour connaître l'organisation actuelle.
- search_bookmarks : Recherche sémantique dans les signets.
- search_twitter : Recherche live sur Twitter/X.
- find_similar : Tweets similaires par similarité sémantique.
- tag_tweet : Ajouter un tag à un tweet.
- get_tweet_info : Détails complets d'un tweet.
"#;

pub async fn run_agent(
    db: Arc<Database>,
    embedder: Arc<Embedder>,
    api_key: String,
    user_message: String,
    history: Vec<ChatMessage>,
    event_tx: tokio::sync::mpsc::Sender<AgentEvent>,
) {
    if let Err(e) = run_agent_inner(db, embedder, api_key, user_message, history, &event_tx).await
    {
        let _ = event_tx.send(AgentEvent::Error { message: e.to_string() }).await;
    }
    let _ = event_tx.send(AgentEvent::Done).await;
}

async fn run_agent_inner(
    db: Arc<Database>,
    embedder: Arc<Embedder>,
    api_key: String,
    user_message: String,
    history: Vec<ChatMessage>,
    event_tx: &tokio::sync::mpsc::Sender<AgentEvent>,
) -> Result<()> {
    let client = reqwest::Client::new();

    let tools = serde_json::json!([
        {
            "name": "search_bookmarks",
            "description": "Search the user's saved bookmarks using semantic search. Returns tweets most relevant to the query.",
            "input_schema": {
                "type": "object",
                "properties": {
                    "query": { "type": "string", "description": "What to search for" }
                },
                "required": ["query"]
            }
        },
        {
            "name": "search_twitter",
            "description": "Search Twitter/X live for tweets on any topic. Returns recent tweets matching the query.",
            "input_schema": {
                "type": "object",
                "properties": {
                    "query": { "type": "string", "description": "Search query" },
                    "count": { "type": "integer", "description": "Number of results (default 10)" }
                },
                "required": ["query"]
            }
        },
        {
            "name": "find_similar",
            "description": "Find tweets semantically similar to a specific tweet. Useful for discovering connections.",
            "input_schema": {
                "type": "object",
                "properties": {
                    "tweet_id": { "type": "string", "description": "The tweet ID to find similar tweets for" }
                },
                "required": ["tweet_id"]
            }
        },
        {
            "name": "tag_tweet",
            "description": "Add a tag to a tweet for organization.",
            "input_schema": {
                "type": "object",
                "properties": {
                    "tweet_id": { "type": "string", "description": "Tweet ID to tag" },
                    "tag": { "type": "string", "description": "Tag name to add" }
                },
                "required": ["tweet_id", "tag"]
            }
        },
        {
            "name": "list_dots",
            "description": "List all existing dots (topic folders) with their names and bookmark counts. Use this to see how bookmarks are organized.",
            "input_schema": {
                "type": "object",
                "properties": {},
                "required": []
            }
        },
        {
            "name": "get_tweet_info",
            "description": "Get full details about a specific tweet including content, author, engagement, and AI analysis.",
            "input_schema": {
                "type": "object",
                "properties": {
                    "tweet_id": { "type": "string", "description": "Tweet ID" }
                },
                "required": ["tweet_id"]
            }
        },
    ]);

    // Build messages
    let mut messages: Vec<serde_json::Value> = history
        .iter()
        .map(|m| serde_json::json!({"role": m.role, "content": m.content}))
        .collect();
    messages.push(serde_json::json!({"role": "user", "content": user_message}));

    // Agent loop: call Claude, execute tools, repeat until no more tool calls
    loop {
        let body = serde_json::json!({
            "model": "claude-haiku-4-5-20251001",
            "max_tokens": 4096,
            "system": SYSTEM_PROMPT,
            "tools": tools,
            "messages": messages,
        });

        let response = client
            .post("https://api.anthropic.com/v1/messages")
            .header("x-api-key", &api_key)
            .header("anthropic-version", "2023-06-01")
            .header("content-type", "application/json")
            .json(&body)
            .send()
            .await?;

        if !response.status().is_success() {
            let text = response.text().await.unwrap_or_default();
            anyhow::bail!("Claude API error: {}", &text[..text.len().min(200)]);
        }

        let resp: serde_json::Value = response.json().await?;
        let content = resp["content"].as_array().cloned().unwrap_or_default();
        let stop_reason = resp["stop_reason"].as_str().unwrap_or("");

        // Process content blocks
        let mut tool_uses = Vec::new();
        for block in &content {
            match block["type"].as_str() {
                Some("text") => {
                    let text = block["text"].as_str().unwrap_or("").to_string();
                    if !text.is_empty() {
                        let _ = event_tx.send(AgentEvent::Text { text }).await;
                    }
                }
                Some("tool_use") => {
                    tool_uses.push(block.clone());
                }
                _ => {}
            }
        }

        // If no tool calls, we're done
        if tool_uses.is_empty() || stop_reason != "tool_use" {
            break;
        }

        // Execute tools and build tool results
        let mut tool_results = Vec::new();
        for tool_use in &tool_uses {
            let tool_name = tool_use["name"].as_str().unwrap_or("");
            let tool_id = tool_use["id"].as_str().unwrap_or("");
            let input = &tool_use["input"];

            let _ = event_tx
                .send(AgentEvent::ToolStart {
                    tool: tool_name.to_string(),
                    input: input.clone(),
                })
                .await;

            let result = execute_tool(tool_name, input, &db, &embedder).await;

            // Send full results to frontend for rich rendering
            let _ = event_tx
                .send(AgentEvent::ToolResult {
                    tool: tool_name.to_string(),
                    result: result.clone(),
                })
                .await;

            // Send condensed results to Claude to avoid context explosion
            let condensed = condense_for_llm(&result);
            tool_results.push(serde_json::json!({
                "type": "tool_result",
                "tool_use_id": tool_id,
                "content": condensed,
            }));
        }

        // Add assistant response and tool results to messages
        messages.push(serde_json::json!({"role": "assistant", "content": content}));
        messages.push(serde_json::json!({"role": "user", "content": tool_results}));
    }

    Ok(())
}

async fn execute_tool(
    name: &str,
    input: &serde_json::Value,
    db: &Database,
    embedder: &Embedder,
) -> serde_json::Value {
    match name {
        "search_bookmarks" => {
            let query = input["query"].as_str().unwrap_or("");
            match embedder.embed_one(query) {
                Ok(embedding) => match db.search_semantic(&embedding, 100) {
                    Ok(tweets) => {
                        let bookmarks: Vec<_> = tweets.into_iter().filter(|t| t.source == "bookmark").take(30).collect();
                        serde_json::to_value(&bookmarks).unwrap_or_default()
                    },
                    Err(e) => serde_json::json!({"error": e.to_string()}),
                },
                Err(e) => serde_json::json!({"error": e.to_string()}),
            }
        }
        "search_twitter" => {
            let query = input["query"].as_str().unwrap_or("").to_string();
            let count = input["count"].as_u64().unwrap_or(10) as u32;
            match tokio::task::spawn_blocking(move || {
                let clix = Clix::new();
                clix.search(&query, count)
            })
            .await
            {
                Ok(Ok(tweets)) => serde_json::to_value(&tweets).unwrap_or_default(),
                Ok(Err(e)) => serde_json::json!({"error": e.to_string()}),
                Err(e) => serde_json::json!({"error": e.to_string()}),
            }
        }
        "find_similar" => {
            let tweet_id = input["tweet_id"].as_str().unwrap_or("");
            match db.get_embedding(tweet_id) {
                Ok(Some(embedding)) => match db.search_semantic(&embedding, 20) {
                    Ok(tweets) => {
                        let filtered: Vec<_> =
                            tweets.into_iter().filter(|t| t.id != tweet_id).collect();
                        serde_json::to_value(&filtered).unwrap_or_default()
                    }
                    Err(e) => serde_json::json!({"error": e.to_string()}),
                },
                Ok(None) => serde_json::json!({"error": "No embedding for this tweet"}),
                Err(e) => serde_json::json!({"error": e.to_string()}),
            }
        }
        "tag_tweet" => {
            let tweet_id = input["tweet_id"].as_str().unwrap_or("");
            let tag = input["tag"].as_str().unwrap_or("");
            match db.create_tag(tag, None) {
                Ok(tag_id) => match db.tag_tweet(tweet_id, tag_id) {
                    Ok(()) => serde_json::json!({"success": true, "tag": tag}),
                    Err(e) => serde_json::json!({"error": e.to_string()}),
                },
                Err(e) => serde_json::json!({"error": e.to_string()}),
            }
        }
        "list_dots" => {
            match db.list_dot_slugs() {
                Ok(dots) => {
                    let list: Vec<serde_json::Value> = dots.iter().map(|(slug, name)| {
                        serde_json::json!({"slug": slug, "name": name})
                    }).collect();
                    serde_json::json!({"dots": list, "count": list.len()})
                }
                Err(e) => serde_json::json!({"error": e.to_string()}),
            }
        }
        "get_tweet_info" => {
            let tweet_id = input["tweet_id"].as_str().unwrap_or("");
            match db.get_tweet_full(tweet_id) {
                Ok(Some(tweet)) => serde_json::to_value(&tweet).unwrap_or_default(),
                Ok(None) => serde_json::json!({"error": "Tweet not found"}),
                Err(e) => serde_json::json!({"error": e.to_string()}),
            }
        }
        _ => serde_json::json!({"error": format!("Unknown tool: {}", name)}),
    }
}

/// Condense tool results for Claude context to avoid token explosion.
/// Full results are sent to the frontend separately.
fn condense_for_llm(result: &serde_json::Value) -> String {
    if let Some(arr) = result.as_array() {
        // Array of tweets — condense to short summaries
        let summaries: Vec<String> = arr
            .iter()
            .take(30)
            .enumerate()
            .map(|(i, t)| {
                let handle = t["author_handle"].as_str().unwrap_or("?");
                let content = t["content"]
                    .as_str()
                    .or(t["text"].as_str())
                    .unwrap_or("");
                let short = &content[..content.len().min(120)];
                let id = t["id"].as_str().unwrap_or("");
                format!("{}. @{} (id:{}): {}", i + 1, handle, id, short)
            })
            .collect();
        let total = arr.len();
        format!(
            "Found {} tweets (showing {}):\n{}",
            total,
            summaries.len(),
            summaries.join("\n")
        )
    } else if result.is_object() {
        // Single result — truncate
        let s = serde_json::to_string(result).unwrap_or_default();
        s[..s.len().min(2000)].to_string()
    } else {
        result.to_string()
    }
}
