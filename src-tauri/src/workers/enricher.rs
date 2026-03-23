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

    let system_prompt = r#"Tu classes des signets Twitter dans des dossiers thématiques. Pour chaque tweet, réponds avec un tableau JSON :

- "id": l'id du tweet
- "category": domaine large. Un parmi : "ai/ml", "dev-tools", "web", "crypto", "design", "science", "business", "politics", "culture", "other"
- "cluster": le NOM DU DOSSIER où ranger ce signet. C'est le champ le plus important.

RÈGLES POUR LE CLUSTER :
1. Granularité MOYENNE : le nom d'un outil, projet, technique ou concept. Pas une catégorie large, pas un détail spécifique.
2. EXEMPLES CORRECTS : "claude-code", "cursor", "dspy", "rlm", "mcp", "rag", "react-server-components", "stable-diffusion", "openai-codex", "langchain", "veo", "gemini", "deepseek"
3. EXEMPLES INCORRECTS : "intelligence-artificielle" (trop large), "bug-fix-claude-3.5-sonnet" (trop précis), "unknown" (interdit), "other" (interdit), "misc" (interdit)
4. JAMAIS "unknown", "other", "misc", "unspecified", "unlabeled", "general". Si tu ne sais pas, choisis le sujet dominant du tweet.
5. Si le tweet est un mème, une réaction, ou du contenu culturel, utilise le SUJET du mème, pas "meme-content".
6. CONSOLIDE les variantes : utilise "rlm" pas "recursive-language-models" ni "rlm-agents" ni "rlm-evaluation". Un seul nom court par sujet.
7. Utilise des minuscules avec tirets. Maximum 3 mots.
8. Si le tweet parle d'un outil/produit spécifique, utilise SON NOM (ex: "cursor", "claude-code", "v0").

- "summary": résumé en UNE LIGNE en FRANÇAIS (max 90 caractères). Commence par un verbe ou un nom.
- "topics": tableau de 1-3 tags (minuscules, sans #)
- "type": un parmi : "tutorial", "opinion", "announcement", "thread", "question", "news", "meme", "showcase", "discussion", "resource", "alpha"

Réponds UNIQUEMENT avec le tableau JSON, sans fences markdown."#;

    let body = serde_json::json!({
        "model": "claude-sonnet-4-6",
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
