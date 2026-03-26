//! Port of Python `xclienttransaction` library.
//! Extracts GraphQL query IDs from x.com JS bundles and generates
//! the `x-client-transaction-id` header required by Twitter's Cloudflare protection.

use anyhow::{Context, Result};
use base64::Engine;
use regex_lite::Regex;
use sha2::{Digest, Sha256};
use std::sync::Mutex;

// ── Constants (from constants.py) ──

const ADDITIONAL_RANDOM_NUMBER: u8 = 3;
const DEFAULT_KEYWORD: &str = "obfiowerehiring";
const ON_DEMAND_FILE_URL: &str =
    "https://abs.twimg.com/responsive-web/client-web/ondemand.s.{}a.js";
const USER_AGENT: &str = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/127.0.0.0 Safari/537.36";

// ── Cache ──

struct SignerCache {
    transaction: Option<TransactionSigner>,
}

static CACHE: Mutex<Option<SignerCache>> = Mutex::new(None);

/// Generate an x-client-transaction-id header for the given method and path.
pub fn generate_transaction_id(method: &str, path: &str) -> Result<String> {
    ensure_cache()?;
    let cache = CACHE.lock().unwrap_or_else(|p| p.into_inner());
    let signer = cache
        .as_ref()
        .and_then(|c| c.transaction.as_ref())
        .context("Transaction signer not initialized")?;
    Ok(signer.generate(method, path))
}

/// Pre-initialize the cache synchronously. Call once at startup before workers.
pub fn ensure_cache_sync() -> Result<()> {
    ensure_cache()
}

fn ensure_cache() -> Result<()> {
    {
        let cache = CACHE.lock().unwrap_or_else(|p| p.into_inner());
        if cache.is_some() {
            return Ok(());
        }
    }

    let result = fetch_and_parse();
    match result {
        Ok(signer) => {
            log::info!("[graphql_ops] Cache initialized with signer");
            let mut cache = CACHE.lock().unwrap_or_else(|p| p.into_inner());
            *cache = Some(SignerCache {
                transaction: Some(signer),
            });
        }
        Err(e) => {
            log::warn!("[graphql_ops] Signer init failed: {}. Caching without signer.", e);
            let mut cache = CACHE.lock().unwrap_or_else(|p| p.into_inner());
            *cache = Some(SignerCache {
                transaction: None,
            });
        }
    }
    Ok(())
}

/// Fetch x.com homepage + ondemand JS and build the transaction signer.
fn fetch_and_parse() -> Result<TransactionSigner> {
    let client = reqwest::blocking::Client::builder()
        .timeout(std::time::Duration::from_secs(15))
        .redirect(reqwest::redirect::Policy::limited(5))
        .build()?;

    // Step 1: Fetch x.com homepage WITHOUT cookies to get the loading page with SVG animations
    let home_html = client
        .get("https://x.com")
        .header("user-agent", USER_AGENT)
        .send()
        .context("Failed to fetch x.com")?
        .text()
        .context("Failed to read x.com")?;

    // Step 2: Extract ondemand JS URL and fetch it
    let ondemand_url = extract_ondemand_url(&home_html)
        .context("Could not find ondemand.s JS URL in homepage")?;
    log::info!("[graphql_ops] Fetching ondemand JS: {}", ondemand_url);

    let ondemand_js = client
        .get(&ondemand_url)
        .header("user-agent", USER_AGENT)
        .send()
        .context("Failed to fetch ondemand JS")?
        .text()
        .context("Failed to read ondemand JS")?;

    // Step 3: Build transaction signer
    let signer = TransactionSigner::new(&home_html, &ondemand_js)?;

    Ok(signer)
}

// ── Ondemand URL extraction (from utils.py) ──

fn extract_ondemand_url(html: &str) -> Option<String> {
    // Pattern: ,<index>:"ondemand.s" or ,<index>:'ondemand.s'
    let re_index = Regex::new(r#",(\d+):["\']ondemand\.s["\']"#).ok()?;
    let index = re_index.captures(html)?.get(1)?.as_str();

    // Pattern: ,<index>:"<hash>"
    let re_hash = Regex::new(&format!(r#",{}:"([0-9a-f]+)""#, index)).ok()?;
    let hash = re_hash.captures(html)?.get(1)?.as_str();

    Some(ON_DEMAND_FILE_URL.replace("{}", hash))
}

// ── Transaction Signer (from transaction.py) ──

struct TransactionSigner {
    key_bytes: Vec<u8>,
    animation_key: String,
}

impl TransactionSigner {
    fn new(home_html: &str, ondemand_js: &str) -> Result<Self> {
        // Step 1: Extract key
        let key_b64 = extract_meta_verification(home_html)
            .context("Could not find twitter-site-verification meta tag")?;
        log::info!("[signer] Step 1 OK: verification key found ({} chars)", key_b64.len());

        let key_bytes = base64::engine::general_purpose::STANDARD
            .decode(&key_b64)
            .context("Failed to decode verification key")?;
        log::info!("[signer] Step 2 OK: key decoded ({} bytes)", key_bytes.len());

        // Step 2: Extract indices from ondemand JS
        let (row_index_idx, key_bytes_indices) = extract_indices(ondemand_js)
            .context("Could not extract key byte indices from ondemand JS")?;
        log::info!("[signer] Step 3 OK: indices extracted (row={}, keys={:?})", row_index_idx, key_bytes_indices);

        // Step 3: Extract animation frames from SVG elements
        let animation_key = compute_animation_key(&key_bytes, home_html, row_index_idx, &key_bytes_indices)?;
        log::info!("[signer] Step 4 OK: animation key = {}", animation_key);

        Ok(Self {
            key_bytes,
            animation_key,
        })
    }

    fn generate(&self, method: &str, path: &str) -> String {
        // Timestamp: milliseconds since 2023-05-01 00:00:00 UTC, divided by 1000
        let time_now =
            (std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap()
                .as_millis() as i64
                - 1682924400_000)
                / 1000;

        let time_bytes: Vec<u8> = (0..4).map(|i| ((time_now >> (i * 8)) & 0xFF) as u8).collect();

        // SHA256 hash
        let hash_input = format!(
            "{}!{}!{}{}{}",
            method, path, time_now, DEFAULT_KEYWORD, self.animation_key
        );
        let hash = Sha256::digest(hash_input.as_bytes());
        let hash_bytes: Vec<u8> = hash[..16].to_vec();

        // Build output
        let mut bytes_arr = Vec::new();
        bytes_arr.extend_from_slice(&self.key_bytes);
        bytes_arr.extend_from_slice(&time_bytes);
        bytes_arr.extend_from_slice(&hash_bytes);
        bytes_arr.push(ADDITIONAL_RANDOM_NUMBER);

        // XOR with random byte
        let random_byte: u8 = rand::random();
        let mut out = vec![random_byte];
        for b in &bytes_arr {
            out.push(b ^ random_byte);
        }

        // Base64 encode, strip padding
        base64::engine::general_purpose::STANDARD
            .encode(&out)
            .trim_end_matches('=')
            .to_string()
    }
}

// ── Helper: extract meta verification ──

fn extract_meta_verification(html: &str) -> Option<String> {
    let re = Regex::new(
        r#"<meta\s+name\s*=\s*["\']twitter-site-verification["\']\s+content\s*=\s*["\']([^"\']+)["\']"#,
    )
    .ok()?;
    re.captures(html)?.get(1).map(|m| m.as_str().to_string())
}

// ── Helper: extract indices from ondemand JS ──

fn extract_indices(js: &str) -> Option<(usize, Vec<usize>)> {
    // Pattern: (\w[\d{1,2}], 16) repeated
    let re = Regex::new(r#"\(\w\[(\d{1,2})\],\s*16\)"#).ok()?;
    let indices: Vec<usize> = re
        .captures_iter(js)
        .filter_map(|c| c.get(1)?.as_str().parse().ok())
        .collect();

    if indices.is_empty() {
        return None;
    }
    Some((indices[0], indices[1..].to_vec()))
}

// ── Helper: compute animation key ──

fn compute_animation_key(
    key_bytes: &[u8],
    html: &str,
    row_index_idx: usize,
    key_bytes_indices: &[usize],
) -> Result<String> {
    let total_time: f64 = 4096.0;

    // row_index = key_bytes[row_index_idx] % 16
    let row_index = (key_bytes[row_index_idx] % 16) as usize;

    // frame_time = product of key_bytes[i] % 16 for each index
    let frame_time: u64 = key_bytes_indices
        .iter()
        .map(|&i| (key_bytes[i] % 16) as u64)
        .product();
    let frame_time = js_round(frame_time as f64 / 10.0) * 10.0;

    // Extract SVG animation frames
    let frames_2d = extract_svg_frames(html, key_bytes)?;
    log::info!("[signer] frames_2d has {} rows, row_index={}, first row has {} values",
        frames_2d.len(), row_index,
        frames_2d.first().map(|r| r.len()).unwrap_or(0));
    let frame_row = frames_2d
        .get(row_index)
        .context(format!("Animation frame row {} out of bounds (have {} rows)", row_index, frames_2d.len()))?;

    let target_time = frame_time / total_time;
    Ok(animate(frame_row, target_time))
}

// ── Helper: extract SVG frames ──

fn extract_svg_frames(html: &str, key_bytes: &[u8]) -> Result<Vec<Vec<i64>>> {
    // Python: frames = home_page_response.select("[id^='loading-x-anim']")
    // Then: frames[key_bytes[5] % 4].children...
    // We need to extract the SVG at index key_bytes[5] % 4, then parse its path "d" into a 2D array.

    let anim_index = (key_bytes[5] % 4) as usize;
    log::info!("[signer] Looking for loading-x-anim-{} SVG", anim_index);

    // Each loading-x-anim SVG has TWO <path> elements:
    // 1. A simple outline path
    // 2. The animation data path (with many "C" segments) — this is the one we need
    // The Python code does: list(list(frames[i].children)[0].children)[1].get("d")
    // which is the SECOND child path.

    // Find all path "d" attributes within each loading-x-anim SVG
    // We collect pairs of paths per SVG and take the second one
    let mut all_paths: Vec<String> = Vec::new();

    for i in 0..4 {
        let pattern = format!(
            r#"id\s*=\s*["\']loading-x-anim-{}["\']"#, i
        );
        let re_id = Regex::new(&pattern).unwrap();

        if let Some(id_match) = re_id.find(html) {
            // Find all path d="" after this ID, up to the closing </svg>
            let after_id = &html[id_match.start()..];
            let end = after_id.find("</svg>").unwrap_or(after_id.len().min(2000));
            let chunk = &after_id[..end];

            let re_path = Regex::new(r#"\bd\s*=\s*["\']([^"\']+)["\']"#).unwrap();
            let paths: Vec<String> = re_path
                .captures_iter(chunk)
                .filter_map(|c| c.get(1).map(|m| m.as_str().to_string()))
                .collect();

            // Take the second path (index 1) — the animation data
            if paths.len() >= 2 {
                all_paths.push(paths[1].clone());
            } else if !paths.is_empty() {
                all_paths.push(paths[0].clone());
            }
        }
    }

    log::info!("[signer] Found {} loading-x-anim SVG paths", all_paths.len());

    let d_attr = all_paths
        .get(anim_index)
        .context(format!("SVG anim index {} out of bounds (found {})", anim_index, all_paths.len()))?;

    // Parse: skip first 9 chars (e.g. "M 0 0 C "), split by "C"
    let d_data = if d_attr.len() > 9 { &d_attr[9..] } else { d_attr };
    let rows: Vec<Vec<i64>> = d_data
        .split('C')
        .map(|segment| {
            let re_nums = Regex::new(r"\d+").unwrap();
            re_nums
                .find_iter(segment.trim())
                .filter_map(|m| m.as_str().parse().ok())
                .collect()
        })
        .collect();

    log::info!("[signer] Parsed {} frame rows from SVG path", rows.len());
    Ok(rows)
}

// ── Helper: animate (from transaction.py) ──

fn animate(frames: &[i64], target_time: f64) -> String {
    let from_color: Vec<f64> = frames[..3].iter().map(|&x| x as f64).chain(std::iter::once(1.0)).collect();
    let to_color: Vec<f64> = frames[3..6].iter().map(|&x| x as f64).chain(std::iter::once(1.0)).collect();
    let to_rotation = solve(frames[6] as f64, 60.0, 360.0, true);

    let curves: Vec<f64> = frames[7..]
        .iter()
        .enumerate()
        .map(|(i, &v)| solve(v as f64, if i % 2 != 0 { -1.0 } else { 0.0 }, 1.0, false))
        .collect();

    let val = cubic_get_value(&curves, target_time);

    let color: Vec<f64> = interpolate(&from_color, &to_color, val);
    let color_clamped: Vec<f64> = color.iter().map(|&v| v.max(0.0).min(255.0)).collect();

    let rotation = interpolate(&[0.0], &[to_rotation], val);
    let matrix = rotation_to_matrix(rotation[0]);

    let mut str_arr: Vec<String> = color_clamped[..3]
        .iter()
        .map(|&v| format!("{:x}", v.round() as i64))
        .collect();

    for &v in &matrix {
        let mut rounded = (v * 100.0).round() / 100.0;
        if rounded < 0.0 {
            rounded = -rounded;
        }
        let hex = float_to_hex(rounded);
        let s = if hex.starts_with('.') {
            format!("0{}", hex)
        } else if hex.is_empty() {
            "0".to_string()
        } else {
            hex
        };
        str_arr.push(s.to_lowercase());
    }

    str_arr.extend(["0".to_string(), "0".to_string()]);
    let joined = str_arr.join("");
    joined.replace(['.', '-'], "")
}

// ── Math helpers ──

fn solve(value: f64, min_val: f64, max_val: f64, rounding: bool) -> f64 {
    let result = value * (max_val - min_val) / 255.0 + min_val;
    if rounding {
        result.floor()
    } else {
        (result * 100.0).round() / 100.0
    }
}

fn cubic_get_value(curves: &[f64], time: f64) -> f64 {
    if curves.len() < 4 {
        return 0.0;
    }
    let (c0, c1, c2, c3) = (curves[0], curves[1], curves[2], curves[3]);

    if time <= 0.0 {
        return if c0 > 0.0 {
            c1 / c0 * time
        } else if c1 == 0.0 && c2 > 0.0 {
            c3 / c2 * time
        } else {
            0.0
        };
    }
    if time >= 1.0 {
        return if c2 < 1.0 {
            1.0 + (c3 - 1.0) / (c2 - 1.0) * (time - 1.0)
        } else if c2 == 1.0 && c0 < 1.0 {
            1.0 + (c1 - 1.0) / (c0 - 1.0) * (time - 1.0)
        } else {
            1.0
        };
    }

    let mut start = 0.0_f64;
    let mut end = 1.0_f64;
    let mut mid = 0.5_f64;

    while start < end {
        mid = (start + end) / 2.0;
        let x_est = cubic_calc(c0, c2, mid);
        if (time - x_est).abs() < 0.00001 {
            return cubic_calc(c1, c3, mid);
        }
        if x_est < time {
            start = mid;
        } else {
            end = mid;
        }
    }
    cubic_calc(c1, c3, mid)
}

fn cubic_calc(a: f64, b: f64, m: f64) -> f64 {
    3.0 * a * (1.0 - m) * (1.0 - m) * m + 3.0 * b * (1.0 - m) * m * m + m * m * m
}

fn interpolate(from: &[f64], to: &[f64], f: f64) -> Vec<f64> {
    from.iter()
        .zip(to.iter())
        .map(|(&a, &b)| a * (1.0 - f) + b * f)
        .collect()
}

fn rotation_to_matrix(degrees: f64) -> Vec<f64> {
    let rad = degrees.to_radians();
    vec![rad.cos(), -rad.sin(), rad.sin(), rad.cos()]
}

fn float_to_hex(x: f64) -> String {
    let mut result = Vec::new();
    let quotient_part = x as i64;
    let fraction_part = x - quotient_part as f64;

    if quotient_part > 0 {
        let mut q = x;
        while q as i64 > 0 {
            let quotient = (q / 16.0) as i64;
            let remainder = (q as i64) - quotient * 16;
            if remainder > 9 {
                result.insert(0, (remainder as u8 + 55) as char);
            } else {
                result.insert(0, char::from_digit(remainder as u32, 10).unwrap_or('0'));
            }
            q = quotient as f64;
        }
    }

    if fraction_part == 0.0 {
        return result.iter().collect();
    }

    result.push('.');
    let mut frac = fraction_part;
    let mut iterations = 0;
    while frac > 0.0 && iterations < 10 {
        frac *= 16.0;
        let integer = frac as i64;
        frac -= integer as f64;
        if integer > 9 {
            result.push((integer as u8 + 55) as char);
        } else {
            result.push(char::from_digit(integer as u32, 10).unwrap_or('0'));
        }
        iterations += 1;
    }

    result.iter().collect()
}

fn js_round(num: f64) -> f64 {
    let x = num.floor();
    if (num - x) >= 0.5 {
        num.ceil()
    } else {
        x
    }
}

mod rand {
    pub fn random() -> u8 {
        use std::time::SystemTime;
        let seed = SystemTime::now()
            .duration_since(SystemTime::UNIX_EPOCH)
            .unwrap()
            .subsec_nanos();
        (seed % 256) as u8
    }
}
