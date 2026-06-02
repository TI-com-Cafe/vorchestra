//! Local-first AI helpers.
//!
//! VOrchestra only talks to local providers. The MVP supports Ollama on
//! localhost and never sends environment data to a remote service.

use crate::types::LocalAiStatus;
use reqwest::Client;
use serde::Deserialize;
use std::time::Duration;

const OLLAMA_BASE_URL: &str = "http://127.0.0.1:11434";
const DEFAULT_MODEL: &str = "llama3.2";

#[derive(Deserialize)]
struct OllamaTags {
    models: Vec<OllamaModel>,
}

#[derive(Deserialize)]
struct OllamaModel {
    name: String,
}

#[tauri::command]
pub async fn check_local_ai_status() -> Result<LocalAiStatus, String> {
    let client = local_client()?;
    match client
        .get(format!("{}/api/tags", OLLAMA_BASE_URL))
        .send()
        .await
    {
        Ok(resp) if resp.status().is_success() => {
            let tags: OllamaTags = resp.json().await.map_err(|e| e.to_string())?;
            Ok(LocalAiStatus {
                available: true,
                provider: "ollama".to_string(),
                models: tags.models.into_iter().map(|model| model.name).collect(),
                error: None,
            })
        }
        Ok(resp) => Ok(LocalAiStatus {
            available: false,
            provider: "ollama".to_string(),
            models: Vec::new(),
            error: Some(format!("Ollama returned HTTP {}", resp.status())),
        }),
        Err(err) => Ok(LocalAiStatus {
            available: false,
            provider: "ollama".to_string(),
            models: Vec::new(),
            error: Some(format!("Ollama is not reachable on localhost: {}", err)),
        }),
    }
}

#[tauri::command]
pub async fn explain_environment_with_local_ai(
    context: String,
    model: Option<String>,
) -> Result<String, String> {
    let trimmed = context.trim();
    if trimmed.is_empty() {
        return Err("No environment context was provided.".to_string());
    }
    if trimmed.len() > 16_000 {
        return Err("Environment context is too large for local AI analysis.".to_string());
    }

    let client = local_client()?;
    let model = model
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .unwrap_or(DEFAULT_MODEL);
    let prompt = format!(
        "You are VOrchestra, a local-first Python environment maintenance assistant. \
         Use only the provided context. Give a concise diagnosis and 3 practical next actions. \
         Do not invent package data.\n\nContext:\n{}",
        trimmed
    );
    let payload = serde_json::json!({
        "model": model,
        "prompt": prompt,
        "stream": false,
        "options": {
            "temperature": 0.2
        }
    });

    let resp = client
        .post(format!("{}/api/generate", OLLAMA_BASE_URL))
        .json(&payload)
        .send()
        .await
        .map_err(|e| format!("Ollama request failed: {}", e))?;
    if !resp.status().is_success() {
        return Err(format!("Ollama returned HTTP {}", resp.status()));
    }
    let json: serde_json::Value = resp.json().await.map_err(|e| e.to_string())?;
    json.get("response")
        .and_then(|value| value.as_str())
        .map(|value| value.trim().to_string())
        .filter(|value| !value.is_empty())
        .ok_or_else(|| "Ollama returned an empty response.".to_string())
}

fn local_client() -> Result<Client, String> {
    Client::builder()
        .timeout(Duration::from_secs(45))
        .build()
        .map_err(|e| e.to_string())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn default_model_is_stable() {
        assert_eq!(DEFAULT_MODEL, "llama3.2");
    }
}
