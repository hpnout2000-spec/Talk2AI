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
    pub created_at: String,
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
pub struct ChatMessage {
    pub id: String,
    pub role: String,
    pub content: String,
    pub thinking: Option<String>,
    pub options: Option<Vec<ContinuationOption>>,
    pub timestamp: String,
}

#[derive(Serialize, Deserialize, Clone, Debug)]
pub struct ChatSession {
    pub id: String,
    pub character_id: String,
    pub messages: Vec<ChatMessage>,
    pub created_at: String,
    pub updated_at: String,
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
            load_settings
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
