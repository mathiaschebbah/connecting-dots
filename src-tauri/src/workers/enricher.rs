use crate::db::Database;
use crate::workers::SyncEvent;
use std::sync::Arc;
use tauri::{AppHandle, Emitter};
use tokio::time::{sleep, Duration};

const ENRICH_INTERVAL_SECS: u64 = 15;
const BATCH_SIZE: u32 = 10;
const PARALLEL_BATCHES: usize = 3;
const CONSOLIDATION_EVERY_N_CYCLES: u32 = 40; // consolidate dots every ~10 minutes

pub async fn enrich_loop_with_events(db: Arc<Database>, api_key: String, app_handle: AppHandle) {
    log::info!("Worker started: AI enrichment every {}s ({} parallel batches of {})", ENRICH_INTERVAL_SECS, PARALLEL_BATCHES, BATCH_SIZE);

    let client = reqwest::Client::new();
    let mut cycle_count = 0u32;

    loop {
        let _ = app_handle.emit("sync:event", SyncEvent {
            worker: "enricher".to_string(),
            status: "start".to_string(),
            detail: None,
        });

        // Fetch all pending tweets for this cycle
        let total_size = BATCH_SIZE * PARALLEL_BATCHES as u32;
        let pending = db.tweets_without_ai_metadata(total_size).unwrap_or_default();

        if pending.is_empty() {
            // Nothing to enrich — run consolidation if due
            cycle_count += 1;
            if cycle_count % CONSOLIDATION_EVERY_N_CYCLES == 0 {
                if let Err(e) = consolidate_dots(&db, &client, &api_key).await {
                    log::error!("[enricher] consolidation error: {}", e);
                }
            }
            let _ = app_handle.emit("sync:event", SyncEvent {
                worker: "enricher".to_string(),
                status: "done".to_string(),
                detail: None,
            });
            sleep(Duration::from_secs(ENRICH_INTERVAL_SECS)).await;
            continue;
        }

        // Split into sub-batches and run in parallel
        let chunks: Vec<Vec<(String, String)>> = pending
            .chunks(BATCH_SIZE as usize)
            .map(|c| c.to_vec())
            .collect();

        let mut handles = Vec::new();
        for chunk in chunks {
            let client = client.clone();
            let api_key = api_key.clone();
            let db = db.clone();
            handles.push(tokio::spawn(async move {
                enrich_batch(&db, &client, &api_key, &chunk).await
            }));
        }

        let mut total_count = 0u32;
        for handle in handles {
            match handle.await {
                Ok(Ok(count)) => total_count += count,
                Ok(Err(e)) => log::error!("[enricher] batch error: {}", e),
                Err(e) => log::error!("[enricher] task panic: {}", e),
            }
        }

        if total_count > 0 {
            log::info!("[enricher] enriched {} tweets", total_count);
        }

        let _ = app_handle.emit("sync:event", SyncEvent {
            worker: "enricher".to_string(),
            status: "done".to_string(),
            detail: if total_count > 0 { Some(format!("+{} enriched", total_count)) } else { None },
        });

        sleep(Duration::from_secs(ENRICH_INTERVAL_SECS)).await;
    }
}

async fn enrich_batch(
    db: &Database,
    client: &reqwest::Client,
    api_key: &str,
    pending: &[(String, String)],
) -> anyhow::Result<u32> {
    if pending.is_empty() { return Ok(0); }

    let mut tweets_text = String::new();
    for (i, (id, content)) in pending.iter().enumerate() {
        tweets_text.push_str(&format!("[Tweet {}] (id: {})\n{}\n\n", i + 1, id, content));
    }

    // Fetch existing dots to inject into prompt
    let existing_dots = db.list_dot_slugs().unwrap_or_default();
    let dots_list = if existing_dots.is_empty() {
        String::new()
    } else {
        let dots_str: Vec<String> = existing_dots.iter().map(|(slug, name)| format!("\"{}\" ({})", slug, name)).collect();
        format!("\n\nDOTS EXISTANTS (utilise un de ceux-ci si le tweet correspond, sinon crée un nouveau) :\n{}\n", dots_str.join(", "))
    };

    let system_prompt = format!(r#"Tu classes des signets Twitter dans des dossiers thématiques appelés "dots". Pour chaque tweet, réponds avec un tableau JSON :

- "id": l'id du tweet
- "category": domaine large. Un parmi : "ai/ml", "dev-tools", "web", "crypto", "design", "science", "business", "politics", "culture", "other"
- "cluster": le slug du dot (minuscules, tirets). PRIVILÉGIE un dot existant si le tweet y correspond.
- "cluster_name": le nom lisible avec la bonne casse (acronymes en majuscules, noms propres corrects).
- "summary": résumé en UNE LIGNE en FRANÇAIS (max 90 caractères).
- "topics": tableau de 1-3 tags (minuscules)
- "type": un parmi : "tutorial", "opinion", "announcement", "thread", "question", "news", "meme", "showcase", "discussion", "resource", "alpha"

RÈGLES :
1. GRANULARITÉ : un dot = un outil, projet, framework, modèle, ou concept SPÉCIFIQUE. Chaque produit/outil a son propre dot.
   - "claude-code" et "cursor" sont DEUX dots différents (deux outils différents)
   - "rlm" et "dspy" sont DEUX dots différents (deux frameworks différents)
   - "gpt-5" et "gemini" sont DEUX dots différents (deux modèles différents)
2. RÉUTILISE les dots existants quand c'est possible. Un tweet qui parle de Claude Code va dans "claude-code", pas dans "coding-assistant" ni "claude-code-tips".
3. Ne crée un NOUVEAU dot que si aucun existant ne correspond. Le nouveau dot doit nommer le sujet précis.
4. INTERDIT : "unknown", "other", "misc", "general", "article-x", "tweet-indisponible", "long-form-article". Choisis toujours le sujet dominant.
5. Si le tweet est un mème ou une réaction culturelle, classe-le par le SUJET (ex: un mème sur l'IA va dans le dot du sujet IA concerné).
6. Slug : minuscules, tirets, 1-3 mots max. Utilise le nom court de l'outil/concept.
{}
Réponds UNIQUEMENT avec le tableau JSON, sans fences markdown."#, dots_list);

    let body = serde_json::json!({
        "model": "claude-sonnet-4-6",
        "max_tokens": 4096,
        "system": system_prompt,
        "messages": [{ "role": "user", "content": format!("Analyze these tweets:\n\n{}", tweets_text) }]
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

    let mut clean = content_text.trim().to_string();
    if clean.starts_with("```") {
        if let Some(pos) = clean.find('\n') { clean = clean[pos + 1..].to_string(); }
    }
    if clean.ends_with("```") { clean = clean[..clean.len() - 3].to_string(); }

    let enrichments: Vec<TweetEnrichment> = match serde_json::from_str(clean.trim()) {
        Ok(v) => v,
        Err(e) => { log::error!("[enricher] Failed to parse response: {}", e); vec![] }
    };

    let mut count = 0u32;
    for enrichment in &enrichments {
        let topics_json = serde_json::to_string(&enrichment.topics).unwrap_or_default();
        db.update_ai_metadata(&enrichment.id, &enrichment.category, &enrichment.cluster, &enrichment.summary, &topics_json, &enrichment.r#type)?;

        if !enrichment.cluster.is_empty() {
            let slug = enrichment.cluster.to_lowercase().replace(' ', "-");
            let name = enrichment.cluster_name.as_deref()
                .filter(|n| !n.is_empty())
                .map(String::from)
                .unwrap_or_else(|| {
                    enrichment.cluster.split('-').map(|w| {
                        let mut c = w.chars();
                        match c.next() { None => String::new(), Some(f) => f.to_uppercase().collect::<String>() + c.as_str() }
                    }).collect::<Vec<_>>().join(" ")
                });

            let color = match enrichment.category.as_str() {
                "ai/ml" => Some("#7C3AED"), "dev-tools" => Some("#0891B2"), "web" => Some("#2563EB"),
                "crypto" => Some("#059669"), "design" => Some("#DB2777"), "science" => Some("#D97706"),
                "business" => Some("#EA580C"), "politics" => Some("#DC2626"), "culture" => Some("#65A30D"),
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

/// Periodic consolidation: review all dots and merge/rename to converge toward stable organization
async fn consolidate_dots(
    db: &Database,
    client: &reqwest::Client,
    api_key: &str,
) -> anyhow::Result<()> {
    let dots = db.dots_for_consolidation()?;
    if dots.len() < 5 { return Ok(()); } // too few dots to consolidate

    log::info!("[enricher] Running consolidation on {} dots", dots.len());

    let mut dots_text = String::new();
    for (slug, name, count, samples) in &dots {
        dots_text.push_str(&format!("- \"{}\" ({}) [{} signets] Exemples: {}\n", slug, name, count, &samples[..samples.len().min(200)]));
    }

    let prompt = format!(r#"Tu es un organisateur de signets. Voici la liste actuelle des "dots" (dossiers thématiques) :

{}

Suggère UNIQUEMENT des fusions de VRAIS DOUBLONS — deux dots qui parlent EXACTEMENT du même outil/concept sous deux noms différents.

EXEMPLES DE MERGE CORRECT :
- "rlm" et "recursive-language-models" → même concept, garder "rlm"
- "gpt-5" et "gpt5" → même modèle, garder "gpt-5"
- "claude-code" et "claude-code-cli" → même outil, garder "claude-code"

EXEMPLES DE MERGE INTERDIT (produits/concepts différents) :
- "claude-code" et "cursor" → deux outils différents
- "codex" et "claude-code" → OpenAI Codex ≠ Claude Code
- "notebooklm" et "claude" → Google ≠ Anthropic
- "nextjs" et "indie-stack" → un framework ≠ une catégorie
- "postgresql" et "system-design" → un outil ≠ un concept
- "sam-3d" et "ai-agents" → vision ≠ agents
- "web-scraping" et "rag" → sujets différents

RÈGLES STRICTES :
- Ne MERGE que des DOUBLONS EXACTS (même sujet, noms différents)
- Ne merge JAMAIS un outil spécifique dans une catégorie large
- Ne merge JAMAIS deux produits de compagnies différentes
- En cas de doute, NE PAS MERGER
- Maximum 5 actions par cycle
- Préfère [] (rien) plutôt que des merges douteux

Réponds avec un tableau JSON :
[{{"action": "merge", "from": "slug-doublon", "into": "slug-principal"}}]

Si rien à fusionner, réponds []. Pas de fences markdown."#, dots_text);

    let body = serde_json::json!({
        "model": "claude-sonnet-4-6",
        "max_tokens": 2048,
        "messages": [{ "role": "user", "content": prompt }]
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
        let text = response.text().await.unwrap_or_default();
        anyhow::bail!("Consolidation API error: {}", text);
    }

    let resp: serde_json::Value = response.json().await?;
    let content_text = resp["content"][0]["text"].as_str().unwrap_or("[]");

    let mut clean = content_text.trim().to_string();
    if clean.starts_with("```") { if let Some(pos) = clean.find('\n') { clean = clean[pos + 1..].to_string(); } }
    if clean.ends_with("```") { clean = clean[..clean.len() - 3].to_string(); }

    let actions: Vec<ConsolidationAction> = match serde_json::from_str(clean.trim()) {
        Ok(v) => v,
        Err(e) => { log::warn!("[enricher] Failed to parse consolidation: {}", e); vec![] }
    };

    let mut merges = 0u32;
    let mut renames = 0u32;

    for action in &actions {
        match action {
            ConsolidationAction::Merge { from, into } => {
                match db.merge_dots(from, into) {
                    Ok(n) => { merges += 1; log::info!("[consolidation] Merged '{}' → '{}' ({} tweets)", from, into, n); }
                    Err(e) => log::warn!("[consolidation] Failed to merge '{}' → '{}': {}", from, into, e),
                }
            }
            ConsolidationAction::Rename { slug, new_slug, new_name } => {
                match db.rename_dot(slug, new_name, new_slug) {
                    Ok(()) => { renames += 1; log::info!("[consolidation] Renamed '{}' → '{}' ({})", slug, new_slug, new_name); }
                    Err(e) => log::warn!("[consolidation] Failed to rename '{}': {}", slug, e),
                }
            }
        }
    }

    if merges > 0 || renames > 0 {
        log::info!("[consolidation] Done: {} merges, {} renames", merges, renames);
    }

    Ok(())
}

#[derive(Debug, serde::Deserialize)]
#[serde(tag = "action")]
enum ConsolidationAction {
    #[serde(rename = "merge")]
    Merge { from: String, into: String },
    #[serde(rename = "rename")]
    Rename { slug: String, new_slug: String, new_name: String },
}

#[derive(Debug, serde::Deserialize)]
struct TweetEnrichment {
    id: String,
    category: String,
    cluster: String,
    #[serde(default)]
    cluster_name: Option<String>,
    summary: String,
    topics: Vec<String>,
    r#type: String,
}
