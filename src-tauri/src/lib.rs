use serde::{Deserialize, Serialize};
use std::fs;
use std::path::PathBuf;

// ─── Data Structures ────────────────────────────────────────────────

#[derive(Serialize, Deserialize, Clone, Debug)]
pub struct Character {
    pub id: String,
    pub name: String,
    pub avatar: String,
    pub description: String,
    pub personality: String,
    pub scenario: String,
    pub system_prompt: String,
    pub first_message: String,
    #[serde(default)]
    pub alternate_greetings: Vec<String>,
    pub created_at: String,
    #[serde(default)]
    pub last_chat_at: String,
}

#[derive(Serialize, Deserialize, Clone, Debug)]
pub struct MemoryEntry {
    pub id: String,
    pub timestamp: String,
    pub category: String,
    pub content: String,
}

#[derive(Serialize, Deserialize, Clone, Debug)]
pub struct CharacterMemory {
    pub character_id: String,
    pub entries: Vec<MemoryEntry>,
}

#[derive(Serialize, Deserialize, Clone, Debug)]
pub struct ContinuationOption {
    pub label: String,
    pub message: String,
}

#[derive(Serialize, Deserialize, Clone, Debug)]
pub struct AiComment {
    pub id: String,
    pub target_message_id: String,
    pub target_content_snippet: String,
    pub content: String,
    pub timestamp: String,
}

#[derive(Serialize, Deserialize, Clone, Debug)]
pub struct Indicator {
    pub name: String,
    pub value: i32,
}

#[derive(Serialize, Deserialize, Clone, Debug)]
pub struct ChatIndicators {
    pub enabled: bool,
    pub list: Vec<Indicator>,
}

#[derive(Serialize, Deserialize, Clone, Debug)]
pub struct ChatMessage {
    pub id: String,
    pub role: String,
    pub content: String,
    pub thinking: Option<String>,
    pub options: Option<Vec<ContinuationOption>>,
    pub timestamp: String,
    #[serde(default)]
    pub translated_content: Option<String>,
    #[serde(default)]
    pub show_original: Option<bool>,
    #[serde(default)]
    pub original_text: Option<String>,
}

#[derive(Serialize, Deserialize, Clone, Debug)]
pub struct ChatSession {
    pub id: String,
    pub character_id: String,
    pub messages: Vec<ChatMessage>,
    pub created_at: String,
    pub updated_at: String,
    #[serde(default)]
    pub custom_title: Option<String>,
    #[serde(default)]
    pub selected_greeting_index: Option<u32>,
    #[serde(default)]
    pub user_name: Option<String>,
    #[serde(default)]
    pub persona_id: Option<String>,
    #[serde(default)]
    pub ai_comments: Vec<AiComment>,
    #[serde(default)]
    pub indicators: Option<ChatIndicators>,
}

#[derive(Serialize, Deserialize, Clone, Debug)]
pub struct AppSettings {
    pub api_url: String,
    pub max_tokens: u32,
    pub temperature: f32,
    pub top_p: f32,
    pub top_k: u32,
    pub rep_penalty: f32,
    pub thinking_enabled: bool,
    pub memory_enabled: bool,
    pub font_size: u32,
}

impl Default for AppSettings {
    fn default() -> Self {
        AppSettings {
            api_url: "http://localhost:5001".to_string(),
            max_tokens: 2048,
            temperature: 0.7,
            top_p: 0.9,
            top_k: 40,
            rep_penalty: 1.1,
            thinking_enabled: false,
            memory_enabled: true,
            font_size: 15,
        }
    }
}

// ─── Helper: Get app data directory ─────────────────────────────────

fn get_app_dir() -> PathBuf {
    let base = dirs::data_local_dir().unwrap_or_else(|| PathBuf::from("."));
    base.join("LLMChat")
}

fn ensure_dir(path: &PathBuf) {
    if !path.exists() {
        fs::create_dir_all(path).ok();
    }
}

// ─── Character Commands ─────────────────────────────────────────────

#[tauri::command]
fn save_character(data: String) -> Result<String, String> {
    let character: Character = serde_json::from_str(&data).map_err(|e| e.to_string())?;
    let dir = get_app_dir().join("characters");
    ensure_dir(&dir);
    let path = dir.join(format!("{}.json", character.id));
    fs::write(&path, serde_json::to_string_pretty(&character).unwrap())
        .map_err(|e| e.to_string())?;
    Ok(character.id.clone())
}

#[tauri::command]
fn load_characters() -> Result<String, String> {
    let dir = get_app_dir().join("characters");
    ensure_dir(&dir);
    let mut characters: Vec<Character> = Vec::new();
    if let Ok(entries) = fs::read_dir(&dir) {
        for entry in entries.flatten() {
            if entry.path().extension().map_or(false, |e| e == "json") {
                if let Ok(content) = fs::read_to_string(entry.path()) {
                    if let Ok(character) = serde_json::from_str::<Character>(&content) {
                        characters.push(character);
                    }
                }
            }
        }
    }
    serde_json::to_string(&characters).map_err(|e| e.to_string())
}

#[tauri::command]
fn delete_character(id: String) -> Result<(), String> {
    let dir = get_app_dir().join("characters");
    let path = dir.join(format!("{}.json", id));
    if path.exists() {
        fs::remove_file(&path).map_err(|e| e.to_string())?;
    }
    // Also delete associated memory and chats
    let mem_path = get_app_dir().join("memory").join(format!("{}.json", id));
    if mem_path.exists() {
        fs::remove_file(&mem_path).ok();
    }
    let chats_dir = get_app_dir().join("chats").join(&id);
    if chats_dir.exists() {
        fs::remove_dir_all(&chats_dir).ok();
    }
    Ok(())
}

// ─── Memory Commands ────────────────────────────────────────────────

#[tauri::command]
fn save_memory(character_id: String, data: String) -> Result<(), String> {
    let memory: CharacterMemory = serde_json::from_str(&data).map_err(|e| e.to_string())?;
    let dir = get_app_dir().join("memory");
    ensure_dir(&dir);
    let path = dir.join(format!("{}.json", character_id));
    fs::write(&path, serde_json::to_string_pretty(&memory).unwrap())
        .map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
fn load_memory(character_id: String) -> Result<String, String> {
    let dir = get_app_dir().join("memory");
    ensure_dir(&dir);
    let path = dir.join(format!("{}.json", character_id));
    if path.exists() {
        fs::read_to_string(&path).map_err(|e| e.to_string())
    } else {
        let empty = CharacterMemory {
            character_id,
            entries: Vec::new(),
        };
        serde_json::to_string(&empty).map_err(|e| e.to_string())
    }
}

// ─── Chat Commands ──────────────────────────────────────────────────

#[tauri::command]
fn save_chat(character_id: String, data: String) -> Result<(), String> {
    let session: ChatSession = serde_json::from_str(&data).map_err(|e| e.to_string())?;
    let dir = get_app_dir().join("chats").join(&character_id);
    ensure_dir(&dir);
    let path = dir.join(format!("{}.json", session.id));
    fs::write(&path, serde_json::to_string_pretty(&session).unwrap())
        .map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
fn load_chats(character_id: String) -> Result<String, String> {
    let dir = get_app_dir().join("chats").join(&character_id);
    ensure_dir(&dir);
    let mut sessions: Vec<ChatSession> = Vec::new();
    if let Ok(entries) = fs::read_dir(&dir) {
        for entry in entries.flatten() {
            if entry.path().extension().map_or(false, |e| e == "json") {
                if let Ok(content) = fs::read_to_string(entry.path()) {
                    if let Ok(session) = serde_json::from_str::<ChatSession>(&content) {
                        sessions.push(session);
                    }
                }
            }
        }
    }
    sessions.sort_by(|a, b| b.updated_at.cmp(&a.updated_at));
    serde_json::to_string(&sessions).map_err(|e| e.to_string())
}

#[tauri::command]
fn delete_chat(character_id: String, chat_id: String) -> Result<(), String> {
    let path = get_app_dir().join("chats").join(&character_id).join(format!("{}.json", chat_id));
    if path.exists() {
        fs::remove_file(&path).map_err(|e| e.to_string())?;
    }
    Ok(())
}

// ─── Settings Commands ──────────────────────────────────────────────

#[tauri::command]
fn save_settings(data: String) -> Result<(), String> {
    let dir = get_app_dir();
    ensure_dir(&dir);
    let path = dir.join("settings.json");
    fs::write(&path, &data).map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
fn load_settings() -> Result<String, String> {
    let path = get_app_dir().join("settings.json");
    if path.exists() {
        fs::read_to_string(&path).map_err(|e| e.to_string())
    } else {
        let defaults = AppSettings::default();
        serde_json::to_string(&defaults).map_err(|e| e.to_string())
    }
}

// ─── Skills Commands ────────────────────────────────────────────────

#[derive(Serialize, Deserialize, Clone, Debug)]
pub struct SkillInfo {
    pub name: String,
    pub filename: String,
    pub is_default: bool,
    pub content: String,
}

fn ensure_default_skills() {
    let dir = get_app_dir().join("skills");
    ensure_dir(&dir);
    
    // Skill 1: VibeChatting Guide
    let guide_path = dir.join("VibeChatting Guide.txt");
    if !guide_path.exists() {
        let content = "VibeChatting Application Guide:\n\
- Characters: Users can chat with individual character cards. Each character has a unique description, personality, scenario, system prompt, and alternate greetings.\n\
- Group Chats: Multiple characters can be added to a group chat. The response mode can be Auto (AI chooses who speaks) or Round-robin.\n\
- RPG Game Mode: Interactive text-based RPG adventures where a Game Master (GM) guides the story, tracks stats (HP, Stress, Lust, Money), manages scene choices, and maintains a story chronicle.\n\
- Settings: Customizable parameters including API URL, font size, AI comments, AI suggestions, Thinking Mode, Auto Memory, and translation options.";
        fs::write(&guide_path, content).ok();
    }
    
    // Skill 2: GenAI Features
    let features_path = dir.join("GenAI Features.json");
    if !features_path.exists() {
        let content = r#"{
  "name": "GenAI Features",
  "capabilities": [
    "Personal Memory: Can remember facts about the user across sessions using 'add_memory', 'delete_memory', and 'list_memories' commands.",
    "Character Customization: Can create or refine character cards step-by-step using 'save_character' or via GenAI Creator panel facts/final texts.",
    "Interface Controls: Can change app settings (like font size, safe mode, suggestions, AI comments) on request via 'set_setting'.",
    "Active Roleplay Interventions: Can send messages in individual chats, orchestrate group chats, or take actions in interactive games."
  ]
}"#;
        fs::write(&features_path, content).ok();
    }
}

#[tauri::command]
fn load_skills() -> Result<String, String> {
    ensure_default_skills();
    let dir = get_app_dir().join("skills");
    let mut skills = Vec::new();
    
    if let Ok(entries) = fs::read_dir(&dir) {
        for entry in entries.flatten() {
            let path = entry.path();
            if path.is_file() {
                let ext = path.extension().and_then(|s| s.to_str()).unwrap_or("");
                if ext == "txt" || ext == "json" {
                    let filename = path.file_name().and_then(|s| s.to_str()).unwrap_or("").to_string();
                    let name = path.file_stem().and_then(|s| s.to_str()).unwrap_or("").to_string();
                    let is_default = filename == "VibeChatting Guide.txt" || filename == "GenAI Features.json";
                    
                    if let Ok(content) = fs::read_to_string(&path) {
                        skills.push(SkillInfo {
                            name,
                            filename,
                            is_default,
                            content,
                        });
                    }
                }
            }
        }
    }
    
    serde_json::to_string(&skills).map_err(|e| e.to_string())
}

#[tauri::command]
fn save_skill(filename: String, content: String) -> Result<(), String> {
    let dir = get_app_dir().join("skills");
    ensure_dir(&dir);
    
    let is_default = filename == "VibeChatting Guide.txt" || filename == "GenAI Features.json";
    if is_default {
        return Err("Cannot overwrite default skills".to_string());
    }
    
    if filename.contains('/') || filename.contains('\\') || filename.contains("..") {
        return Err("Invalid filename".to_string());
    }
    
    let path = dir.join(&filename);
    fs::write(&path, content).map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
fn delete_skill(filename: String) -> Result<(), String> {
    let is_default = filename == "VibeChatting Guide.txt" || filename == "GenAI Features.json";
    if is_default {
        return Err("Cannot delete default skills".to_string());
    }
    
    let dir = get_app_dir().join("skills");
    let path = dir.join(&filename);
    if path.exists() {
        fs::remove_file(&path).map_err(|e| e.to_string())?;
    }
    Ok(())
}

#[tauri::command]
fn save_credential(provider: String, key: String) -> Result<(), String> {
    let dir = get_app_dir().join("credentials");
    ensure_dir(&dir);
    let path = dir.join(format!("{}.txt", provider));
    fs::write(&path, key).map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
fn load_credential(provider: String) -> Result<String, String> {
    let path = get_app_dir().join("credentials").join(format!("{}.txt", provider));
    if path.exists() {
        fs::read_to_string(&path).map_err(|e| e.to_string())
    } else {
        Ok("".to_string())
    }
}

#[tauri::command]
async fn nhentai_request(
    url: String,
    method: String,
    body: Option<String>,
    api_key: Option<String>,
) -> Result<String, String> {
    use reqwest::header::{HeaderMap, HeaderValue, AUTHORIZATION, USER_AGENT, CONTENT_TYPE};

    let client = reqwest::Client::new();
    let mut headers = HeaderMap::new();
    
    headers.insert(
        USER_AGENT,
        HeaderValue::from_static("VibeChatting/1.0.0 (contact@vibechatting.org)"),
    );

    if let Some(ref key) = api_key {
        if !key.trim().is_empty() {
            if let Ok(val) = HeaderValue::from_str(&format!("Key {}", key)) {
                headers.insert(AUTHORIZATION, val);
            }
        }
    }

    let mut req_builder = match method.to_uppercase().as_str() {
        "POST" => client.post(&url),
        _ => client.get(&url),
    };

    req_builder = req_builder.headers(headers);

    if let Some(ref body_str) = body {
        req_builder = req_builder
            .header(CONTENT_TYPE, "application/json")
            .body(body_str.clone());
    }

    let resp = req_builder
        .send()
        .await
        .map_err(|e| format!("Network request failed: {}", e))?;

    let status = resp.status();
    if status == reqwest::StatusCode::TOO_MANY_REQUESTS {
        return Err("nhentai API Rate limit exceeded (429). Please wait a moment and try again.".to_string());
    }

    let text = resp
        .text()
        .await
        .map_err(|e| format!("Failed to read response body: {}", e))?;

    if !status.is_success() {
        return Err(format!("nhentai API Error ({}): {}", status.as_u16(), text));
    }

    Ok(text)
}

#[tauri::command]
async fn nhentai_fetch_image_base64(
    url: String,
    api_key: Option<String>,
) -> Result<String, String> {
    use reqwest::header::{HeaderMap, HeaderValue, AUTHORIZATION, USER_AGENT, REFERER};
    use base64::{Engine as _, engine::general_purpose};

    let client = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(30))
        .build()
        .unwrap_or_default();
    let mut headers = HeaderMap::new();
    
    headers.insert(
        USER_AGENT,
        HeaderValue::from_static("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36"),
    );

    // Referer header is required to bypass Cloudflare hotlink protection on nhentai CDN
    headers.insert(
        REFERER,
        HeaderValue::from_static("https://nhentai.net/"),
    );

    if let Some(ref key) = api_key {
        if !key.trim().is_empty() {
            if let Ok(val) = HeaderValue::from_str(&format!("Key {}", key)) {
                headers.insert(AUTHORIZATION, val);
            }
        }
    }

    let resp = client.get(&url)
        .headers(headers)
        .send()
        .await
        .map_err(|e| format!("Network request failed: {}", e))?;

    let status = resp.status();

    // Read content-type BEFORE consuming the response body
    let content_type = resp.headers()
        .get(reqwest::header::CONTENT_TYPE)
        .and_then(|v| v.to_str().ok())
        .unwrap_or("image/jpeg")
        .to_string();

    let bytes = resp.bytes().await.map_err(|e| format!("Failed to read image bytes: {}", e))?;

    // Check status AFTER reading body (so the body is consumed), but before encoding
    if !status.is_success() {
        return Err(format!(
            "CDN returned HTTP {} for image URL. This is usually a hotlink/auth restriction. Content-Type was: {}",
            status.as_u16(),
            content_type
        ));
    }

    // Ensure the response is actually an image (not an HTML error page)
    if !content_type.starts_with("image/") {
        return Err(format!(
            "CDN returned non-image content-type '{}' instead of image data for URL: {}",
            content_type, url
        ));
    }

    let b64 = general_purpose::STANDARD.encode(&bytes);

    Ok(format!("data:{};base64,{}", content_type, b64))
}

// ─── App Entry ──────────────────────────────────────────────────────

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .invoke_handler(tauri::generate_handler![
            save_character,
            load_characters,
            delete_character,
            save_memory,
            load_memory,
            save_chat,
            load_chats,
            delete_chat,
            save_settings,
            load_settings,
            load_skills,
            save_skill,
            delete_skill,
            save_credential,
            load_credential,
            nhentai_request,
            nhentai_fetch_image_base64
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
