use crate::db::Database;
use crate::twitter::clix::Clix;
use crate::workers::SyncEvent;
use std::sync::Arc;
use tauri::{AppHandle, Emitter};
use tokio::time::{sleep, Duration};

const RESOLVE_INTERVAL_SECS: u64 = 15;
const BATCH_SIZE: u32 = 20;

/// Extract a tweet ID from a URL like https://x.com/user/status/123456
fn extract_tweet_id(url: &str) -> Option<String> {
    let patterns = ["x.com/", "twitter.com/"];
    for pat in &patterns {
        if let Some(idx) = url.find(pat) {
            let rest = &url[idx + pat.len()..];
            if let Some(status_idx) = rest.find("/status/") {
                let id_part = &rest[status_idx + 8..];
                let id: String = id_part.chars().take_while(|c| c.is_ascii_digit()).collect();
                if !id.is_empty() {
                    return Some(id);
                }
            }
        }
    }
    None
}

/// Extract an X article ID from a URL like https://x.com/i/article/2033772621536591872
fn extract_article_id(url: &str) -> Option<String> {
    let patterns = ["x.com/i/article/", "twitter.com/i/article/"];
    for pat in &patterns {
        if let Some(idx) = url.find(pat) {
            let rest = &url[idx + pat.len()..];
            let id: String = rest.chars().take_while(|c| c.is_ascii_digit()).collect();
            if !id.is_empty() {
                return Some(id);
            }
        }
    }
    None
}

/// Check if content contains a t.co shortlink
fn extract_tco_url(content: &str) -> Option<String> {
    for word in content.split_whitespace() {
        let trimmed = word.trim_matches(|c: char| !c.is_alphanumeric() && c != ':' && c != '/' && c != '.');
        if trimmed.contains("t.co/") {
            let url = if trimmed.starts_with("http") {
                trimmed.to_string()
            } else {
                format!("https://{}", trimmed)
            };
            return Some(url);
        }
    }
    None
}

/// Follow a t.co redirect to get the final URL (no-redirect client, read Location header)
async fn resolve_tco_redirect(url: &str) -> Option<String> {
    let client = reqwest::Client::builder()
        .redirect(reqwest::redirect::Policy::none())
        .timeout(std::time::Duration::from_secs(10))
        .build()
        .ok()?;

    let resp = client.head(url).send().await.ok()?;

    // Follow Location header
    if let Some(location) = resp.headers().get("location") {
        return location.to_str().ok().map(|s| s.to_string());
    }

    // Some t.co links return 200 with meta refresh — try GET and check body
    let resp = client.get(url).send().await.ok()?;
    if let Some(location) = resp.headers().get("location") {
        return location.to_str().ok().map(|s| s.to_string());
    }

    None
}

pub async fn resolve_loop_with_events(db: Arc<Database>, app_handle: AppHandle) {
    log::info!("Worker started: link resolver every {}s", RESOLVE_INTERVAL_SECS);

    loop {
        sleep(Duration::from_secs(RESOLVE_INTERVAL_SECS)).await;

        let _ = app_handle.emit("sync:event", SyncEvent {
            worker: "resolver".to_string(),
            status: "start".to_string(),
            detail: None,
        });

        match resolve_batch(&db).await {
            Ok(count) => {
                if count > 0 {
                    log::info!("[resolver] resolved {} tweet links", count);
                }
                let _ = app_handle.emit("sync:event", SyncEvent {
                    worker: "resolver".to_string(),
                    status: "done".to_string(),
                    detail: if count > 0 { Some(format!("+{} resolved", count)) } else { None },
                });
            }
            Err(e) => {
                log::error!("[resolver] error: {}", e);
                let _ = app_handle.emit("sync:event", SyncEvent {
                    worker: "resolver".to_string(),
                    status: "done".to_string(),
                    detail: Some(format!("error: {}", e)),
                });
            }
        }
    }
}

async fn resolve_batch(db: &Database) -> anyhow::Result<u32> {
    let pending = db.tweets_with_unresolved_links(BATCH_SIZE)?;
    if pending.is_empty() {
        return Ok(0);
    }

    let clix = Clix::new();
    let mut count = 0u32;

    for (tweet_id, content) in &pending {
        // Step 1: Determine the actual URL (resolve t.co if needed)
        let resolved_url = if let Some(tco_url) = extract_tco_url(content) {
            match resolve_tco_redirect(&tco_url).await {
                Some(final_url) => {
                    log::info!("[resolver] t.co {} -> {}", tco_url, final_url);
                    final_url
                }
                None => {
                    log::warn!("[resolver] Failed to follow t.co redirect: {}", tco_url);
                    db.store_resolved_content(tweet_id, "[failed to resolve]", None, &tco_url)?;
                    continue;
                }
            }
        } else {
            content.clone()
        };

        // Step 2a: If it's an X article, fetch the article content via HTTP
        if let Some(_article_id) = extract_article_id(&resolved_url) {
            match fetch_x_article(&resolved_url).await {
                Some((title, body)) => {
                    let resolved_text = if body.is_empty() {
                        format!("{}\n\n{}", title, resolved_url)
                    } else {
                        format!("{}\n\n{}", title, body)
                    };
                    db.store_resolved_content(tweet_id, &resolved_text, None, &resolved_url)?;
                    count += 1;
                }
                None => {
                    // Fallback: store URL with whatever title we can get
                    match fetch_page_title(&resolved_url).await {
                        Some(title) => {
                            db.store_resolved_content(tweet_id, &format!("{}\n\n{}", title, resolved_url), None, &resolved_url)?;
                            count += 1;
                        }
                        None => {
                            db.store_resolved_content(tweet_id, &resolved_url, None, &resolved_url)?;
                            count += 1;
                        }
                    }
                }
            }
            continue;
        }

        // Step 2b: If it's a tweet link, fetch the tweet
        if let Some(linked_id) = extract_tweet_id(&resolved_url) {
            // Check if we already have this tweet in DB
            match db.get_tweet_full(&linked_id) {
                Ok(Some(existing)) => {
                    db.store_resolved_content(
                        tweet_id,
                        &existing.content,
                        Some(&existing.author_handle),
                        &format!("https://x.com/{}/status/{}", existing.author_handle, linked_id),
                    )?;
                    count += 1;
                    continue;
                }
                _ => {}
            }

            // Fetch from Twitter
            match clix.tweet_detail(&linked_id) {
                Ok(detail) => {
                    let mut resolved_text = detail.tweet.text.clone();
                    if let Some(article) = &detail.article {
                        if let Some(title) = &article.title {
                            resolved_text.push_str(&format!("\n\n--- Article: {} ---\n", title));
                        }
                        if let Some(md) = &article.markdown {
                            resolved_text.push_str(md);
                        }
                    }

                    let author = &detail.tweet.author_handle;
                    let url = detail.tweet.tweet_url.clone().unwrap_or_else(|| {
                        format!("https://x.com/{}/status/{}", author, linked_id)
                    });
                    db.store_resolved_content(tweet_id, &resolved_text, Some(author), &url)?;
                    let _ = db.upsert_tweets(&[detail.tweet], "resolved");
                    count += 1;
                }
                Err(e) => {
                    log::warn!("[resolver] Failed to fetch tweet {}: {}", linked_id, e);
                    db.store_resolved_content(tweet_id, "[failed to resolve]", None, &resolved_url)?;
                }
            }
        } else {
            // Not a tweet link — it's an external article/page. Fetch title via HTTP.
            match fetch_page_title(&resolved_url).await {
                Some(title) => {
                    let resolved_text = format!("{}\n\n{}", title, resolved_url);
                    db.store_resolved_content(tweet_id, &resolved_text, None, &resolved_url)?;
                    count += 1;
                }
                None => {
                    // Store the resolved URL itself as content
                    db.store_resolved_content(tweet_id, &resolved_url, None, &resolved_url)?;
                    count += 1;
                }
            }
        }
    }

    Ok(count)
}

/// Fetch page title from an external URL
async fn fetch_page_title(url: &str) -> Option<String> {
    let client = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(10))
        .build()
        .ok()?;

    let resp = client.get(url)
        .header("User-Agent", "Mozilla/5.0 (compatible; ConnectingDots/1.0)")
        .send().await.ok()?;

    if !resp.status().is_success() {
        return None;
    }

    let body = resp.text().await.ok()?;

    // Extract <title> tag
    if let Some(start) = body.find("<title") {
        let rest = &body[start..];
        if let Some(gt) = rest.find('>') {
            let after_tag = &rest[gt + 1..];
            if let Some(end) = after_tag.find("</title>") {
                let title = after_tag[..end].trim();
                if !title.is_empty() {
                    return Some(html_decode(title));
                }
            }
        }
    }

    // Try og:title
    if let Some(idx) = body.find("og:title") {
        let rest = &body[idx..];
        if let Some(content_idx) = rest.find("content=\"") {
            let after = &rest[content_idx + 9..];
            if let Some(end) = after.find('"') {
                let title = after[..end].trim();
                if !title.is_empty() {
                    return Some(html_decode(title));
                }
            }
        }
    }

    None
}

/// Fetch an X article's content by scraping the page
async fn fetch_x_article(url: &str) -> Option<(String, String)> {
    let client = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(15))
        .build()
        .ok()?;

    let resp = client.get(url)
        .header("User-Agent", "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36")
        .send().await.ok()?;

    if !resp.status().is_success() {
        return None;
    }

    let body = resp.text().await.ok()?;

    // Extract title
    let title = extract_meta_content(&body, "og:title")
        .or_else(|| extract_html_title(&body))
        .unwrap_or_else(|| "Article X".to_string());

    // Extract article body from og:description or article content
    let description = extract_meta_content(&body, "og:description")
        .unwrap_or_default();

    // Try to extract article text from the page body
    // X articles have their content in data attributes or script tags
    let article_text = extract_article_text(&body)
        .unwrap_or(description);

    Some((html_decode(&title), html_decode(&article_text)))
}

fn extract_meta_content(html: &str, property: &str) -> Option<String> {
    // Try property="og:title" content="..."
    if let Some(idx) = html.find(property) {
        let search_area = &html[idx..std::cmp::min(idx + 500, html.len())];
        if let Some(content_idx) = search_area.find("content=\"") {
            let after = &search_area[content_idx + 9..];
            if let Some(end) = after.find('"') {
                let content = after[..end].trim();
                if !content.is_empty() {
                    return Some(content.to_string());
                }
            }
        }
    }
    None
}

fn extract_html_title(html: &str) -> Option<String> {
    if let Some(start) = html.find("<title") {
        let rest = &html[start..];
        if let Some(gt) = rest.find('>') {
            let after_tag = &rest[gt + 1..];
            if let Some(end) = after_tag.find("</title>") {
                let title = after_tag[..end].trim();
                if !title.is_empty() {
                    return Some(title.to_string());
                }
            }
        }
    }
    None
}

fn extract_article_text(html: &str) -> Option<String> {
    // Try to find article content in JSON-LD
    if let Some(idx) = html.find("\"articleBody\"") {
        let rest = &html[idx..];
        if let Some(colon) = rest.find(':') {
            let after = rest[colon + 1..].trim_start();
            if after.starts_with('"') {
                let content = &after[1..];
                if let Some(end) = content.find('"') {
                    let text = &content[..end];
                    if text.len() > 50 {
                        return Some(text.replace("\\n", "\n").replace("\\\"", "\""));
                    }
                }
            }
        }
    }

    // Try twitter:description
    extract_meta_content(html, "twitter:description")
}

fn html_decode(s: &str) -> String {
    s.replace("&amp;", "&")
        .replace("&lt;", "<")
        .replace("&gt;", ">")
        .replace("&quot;", "\"")
        .replace("&#39;", "'")
        .replace("&#x27;", "'")
        .replace("&apos;", "'")
}
