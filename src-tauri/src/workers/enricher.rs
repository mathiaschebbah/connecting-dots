use crate::db::Database;
use std::sync::Arc;
use tokio::time::{sleep, Duration};

const ENRICH_INTERVAL_SECS: u64 = 30;
const BATCH_SIZE: u32 = 10;

pub async fn enrich_loop(db: Arc<Database>, api_key: String) {
    log::info!(
        "Worker started: AI enrichment every {}s",
        ENRICH_INTERVAL_SECS
    );

    let client = reqwest::Client::new();

    loop {
        match enrich_batch(&db, &client, &api_key).await {
            Ok(count) => {
                if count > 0 {
                    log::info!("[enricher] enriched {} tweets", count);
                }
            }
            Err(e) => {
                log::error!("[enricher] error: {}", e);
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
    if pending.is_empty() {
        return Ok(0);
    }

    // Build prompt with all tweets in the batch
    let mut tweets_text = String::new();
    for (i, (id, content)) in pending.iter().enumerate() {
        tweets_text.push_str(&format!("[Tweet {}] (id: {})\n{}\n\n", i + 1, id, content));
    }

    let system_prompt = r#"You analyze tweets and extract metadata. For each tweet, respond with a JSON array where each element has:
- "id": the tweet id
- "category": one of: "AI", "Dev Tools", "Web Dev", "Crypto/Finance", "Design", "Science", "Business", "Politics", "Humor", "Personal", "Other"
- "summary": a one-line summary (max 100 chars)
- "topics": array of 1-5 topic tags (lowercase, no #)
- "type": one of: "tutorial", "opinion", "announcement", "thread", "question", "news", "meme", "showcase", "discussion"

Respond ONLY with the JSON array, no markdown fences, no explanation."#;

    let body = serde_json::json!({
        "model": "claude-sonnet-4-20250514",
        "max_tokens": 2048,
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

    // Parse the JSON array response
    let enrichments: Vec<TweetEnrichment> =
        serde_json::from_str(content_text).unwrap_or_default();

    let mut count = 0u32;
    for enrichment in &enrichments {
        let topics_json = serde_json::to_string(&enrichment.topics).unwrap_or_default();
        db.update_ai_metadata(
            &enrichment.id,
            &enrichment.category,
            &enrichment.summary,
            &topics_json,
            &enrichment.r#type,
        )?;
        count += 1;
    }

    Ok(count)
}

#[derive(Debug, serde::Deserialize)]
struct TweetEnrichment {
    id: String,
    category: String,
    summary: String,
    topics: Vec<String>,
    r#type: String,
}
