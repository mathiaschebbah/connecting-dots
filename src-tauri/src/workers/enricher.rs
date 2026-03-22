use crate::db::Database;
use crate::workers::SyncEvent;
use std::sync::Arc;
use tauri::{AppHandle, Emitter};
use tokio::time::{sleep, Duration};

const ENRICH_INTERVAL_SECS: u64 = 15;
const BATCH_SIZE: u32 = 20;

pub async fn enrich_loop_with_events(db: Arc<Database>, api_key: String, app_handle: AppHandle) {
    log::info!(
        "Worker started: AI enrichment every {}s",
        ENRICH_INTERVAL_SECS
    );

    let client = reqwest::Client::new();

    loop {
        let _ = app_handle.emit("sync:event", SyncEvent {
            worker: "enricher".to_string(),
            status: "start".to_string(),
            detail: None,
        });

        match enrich_batch(&db, &client, &api_key).await {
            Ok(count) => {
                if count > 0 {
                    log::info!("[enricher] enriched {} tweets", count);
                }
                let _ = app_handle.emit("sync:event", SyncEvent {
                    worker: "enricher".to_string(),
                    status: "done".to_string(),
                    detail: if count > 0 { Some(format!("+{} enriched", count)) } else { None },
                });
            }
            Err(e) => {
                log::error!("[enricher] error: {}", e);
                let _ = app_handle.emit("sync:event", SyncEvent {
                    worker: "enricher".to_string(),
                    status: "done".to_string(),
                    detail: Some(format!("error: {}", e)),
                });
            }
        }

        sleep(Duration::from_secs(ENRICH_INTERVAL_SECS)).await;
    }
}

async fn enrich_batch(
    db: &Database,
    client: &reqwest::Client,
    api_key: &str,
) -> anyhow::Result<u32> {
    let pending = db.tweets_without_ai_metadata(BATCH_SIZE)?;
    log::info!("[enricher] found {} tweets to enrich", pending.len());
    if pending.is_empty() {
        return Ok(0);
    }

    // Build prompt with all tweets in the batch
    let mut tweets_text = String::new();
    for (i, (id, content)) in pending.iter().enumerate() {
        tweets_text.push_str(&format!("[Tweet {}] (id: {})\n{}\n\n", i + 1, id, content));
    }

    let system_prompt = r#"Tu analyses des tweets et extrais des métadonnées structurées pour une plateforme de veille technologique destinée à des centres de R&D. Pour chaque tweet, réponds avec un tableau JSON où chaque élément contient :
- "id": l'id du tweet
- "category": un domaine large pour le code couleur. Un parmi : "ai/ml", "dev-tools", "web", "crypto", "design", "science", "business", "politics", "culture", "other"
- "cluster": le NOM DU SUJET/PROJET/OUTIL de granularité moyenne. C'est le champ le plus important — il détermine dans quel "dot" (dossier thématique) le tweet sera rangé. Le niveau de granularité est crucial : ni trop large ("intelligence-artificielle" est TROP large), ni trop précis ("bug-fix-dans-claude-3.5" est TROP précis). Le bon niveau : "claude-code", "cursor-ide", "dspy", "rlhf", "react-server-components", "rust-async", "rag-pipelines", "stable-diffusion", "openai-codex", "mcp-protocol", "langchain", "vercel-ai-sdk". Si le tweet parle d'un outil/produit, utilise son nom. Si c'est une technique, nomme la technique. Si c'est un concept, nomme le concept. Utilise des minuscules avec tirets.
- "summary": un résumé en une ligne EN FRANÇAIS (max 100 caractères). Capture l'essence du tweet pour un chercheur en veille techno.
- "topics": tableau de 1-5 tags de sujets (minuscules, sans #). Complètent le cluster avec des concepts liés.
- "type": un parmi : "tutorial", "opinion", "announcement", "thread", "question", "news", "meme", "showcase", "discussion", "resource", "alpha". Utilise "alpha" pour les informations exclusives ou signaux faibles. Utilise "meme" ou "opinion" pour le contenu sans substance technique.

Réponds UNIQUEMENT avec le tableau JSON, sans fences markdown, sans explication."#;

    let body = serde_json::json!({
        "model": "claude-haiku-4-5-20251001",
        "max_tokens": 4096,
        "system": system_prompt,
        "messages": [{
            "role": "user",
            "content": format!("Analyze these tweets:\n\n{}", tweets_text)
        }]
    });

    let response = client
        .post("https://api.anthropic.com/v1/messages")
        .header("x-api-key", api_key)
        .header("anthropic-version", "2023-06-01")
        .header("content-type", "application/json")
        .json(&body)
        .send()
        .await?;

    if !response.status().is_success() {
        let status = response.status();
        let text = response.text().await.unwrap_or_default();
        anyhow::bail!("Claude API error {}: {}", status, text);
    }

    let resp: serde_json::Value = response.json().await?;
    let content_text = resp["content"][0]["text"].as_str().unwrap_or("[]");

    // Strip markdown code fences if present
    let mut clean = content_text.trim().to_string();
    if clean.starts_with("```") {
        if let Some(pos) = clean.find('\n') {
            clean = clean[pos + 1..].to_string();
        }
    }
    if clean.ends_with("```") {
        clean = clean[..clean.len() - 3].to_string();
    }
    let clean_text = clean.trim();

    // Parse the JSON array response
    let enrichments: Vec<TweetEnrichment> = match serde_json::from_str(clean_text) {
        Ok(v) => v,
        Err(e) => {
            log::error!("[enricher] Failed to parse response: {}", e);
            vec![]
        }
    };

    let mut count = 0u32;
    for enrichment in &enrichments {
        let topics_json = serde_json::to_string(&enrichment.topics).unwrap_or_default();
        db.update_ai_metadata(
            &enrichment.id,
            &enrichment.category,
            &enrichment.cluster,
            &enrichment.summary,
            &topics_json,
            &enrichment.r#type,
        )?;

        // Auto-assign tweet to a dot based on cluster
        if !enrichment.cluster.is_empty() {
            let slug = enrichment.cluster.to_lowercase().replace(' ', "-");
            let name = enrichment.cluster.split('-').map(|w| {
                let mut c = w.chars();
                match c.next() {
                    None => String::new(),
                    Some(f) => f.to_uppercase().collect::<String>() + c.as_str(),
                }
            }).collect::<Vec<_>>().join(" ");

            // Pick color from category
            let color = match enrichment.category.as_str() {
                "ai/ml" => Some("#7C3AED"),
                "dev-tools" => Some("#0891B2"),
                "web" => Some("#2563EB"),
                "crypto" => Some("#059669"),
                "design" => Some("#DB2777"),
                "science" => Some("#D97706"),
                "business" => Some("#EA580C"),
                "politics" => Some("#DC2626"),
                "culture" => Some("#65A30D"),
                _ => Some("#71717A"),
            };

            if let Ok(dot_id) = db.get_or_create_dot(&slug, &name, color) {
                let _ = db.assign_tweet_to_dot(&enrichment.id, dot_id);
            }
        }

        count += 1;
    }

    Ok(count)
}

#[derive(Debug, serde::Deserialize)]
struct TweetEnrichment {
    id: String,
    category: String,
    cluster: String,
    summary: String,
    topics: Vec<String>,
    r#type: String,
}
