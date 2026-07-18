use serde::{Deserialize, Serialize};
use std::fs;
use std::path::PathBuf;
use std::sync::{Arc, Mutex};
use std::sync::atomic::{AtomicUsize, Ordering};

// Axum / tokio networking
use axum::{
    body::Body,
    extract::{Query, State, ConnectInfo},
    http::{StatusCode, HeaderMap},
    response::{IntoResponse, Response},
    routing::{delete, get, post},
    Json, Router,
};
use std::collections::HashMap;
use std::net::SocketAddr;
use tokio::net::TcpListener;
use tokio_stream::StreamExt;


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
    #[serde(default)]
    pub message_examples: String,
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
    pub genai_viewimage_enabled: bool,
    pub genai_imagered_enabled: bool,
    pub genai_faster_actions: bool,
    pub genai_smart_context: bool,
}

#[derive(Serialize, Deserialize, Clone, Debug)]
pub struct SearchSettings {
    #[serde(default = "default_web_search_provider")]
    pub web_search_provider: String,
    #[serde(default = "default_web_search_searxng_url")]
    pub web_search_searxng_url: String,
    #[serde(default = "default_web_search_tavily_key")]
    pub web_search_tavily_key: String,
    #[serde(default)]
    pub web_search_clean_pages: bool,
    #[serde(default)]
    pub web_search_auto_approve: bool,
}

fn default_web_search_provider() -> String { "ddg".to_string() }
fn default_web_search_searxng_url() -> String { "http://localhost:8080".to_string() }
fn default_web_search_tavily_key() -> String { "".to_string() }

fn read_search_settings() -> SearchSettings {
    let path = get_app_dir().join("settings.json");
    if let Ok(content) = fs::read_to_string(&path) {
        if let Ok(settings) = serde_json::from_str::<SearchSettings>(&content) {
            return settings;
        }
    }
    SearchSettings {
        web_search_provider: "ddg".to_string(),
        web_search_searxng_url: "http://localhost:8080".to_string(),
        web_search_tavily_key: "".to_string(),
        web_search_clean_pages: false,
        web_search_auto_approve: false,
    }
}

impl Default for AppSettings {
    fn default() -> Self {
        AppSettings {
            api_url: "http://localhost:5001".to_string(),
            max_tokens: 2048,
            temperature: 0.7,
            top_p: 0.9,
            top_k: 40,
            rep_penalty: 1.0,
            thinking_enabled: false,
            memory_enabled: true,
            font_size: 15,
            genai_viewimage_enabled: false,
            genai_imagered_enabled: true,
            genai_faster_actions: false,
            genai_smart_context: false,
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

// ─── Local Network Server State ──────────────────────────────────────

struct RunningServer {
    key: String,
    port: u16,
    shutdown_tx: tokio::sync::oneshot::Sender<()>,
    udp_shutdown_tx: tokio::sync::oneshot::Sender<()>,
    client_count: Arc<AtomicUsize>,
    local_ip: String,
}

#[derive(Clone)]
struct ServerShared {
    inner: Arc<Mutex<Option<RunningServer>>>,
}

impl ServerShared {
    fn new() -> Self {
        ServerShared { inner: Arc::new(Mutex::new(None)) }
    }
}

#[derive(Serialize)]
struct StartServerResult {
    key: String,
    port: u16,
    local_ip: String,
}

#[derive(Serialize)]
struct ServerStatusResult {
    running: bool,
    key: Option<String>,
    port: Option<u16>,
    local_ip: Option<String>,
    client_count: usize,
}

#[derive(Serialize, Clone)]
struct DiscoveredHost {
    ip: String,
    port: u16,
    host_name: String,
}

// Shared axum app state
#[derive(Clone)]
struct AxumState {
    key: String,
    client_count: Arc<AtomicUsize>,
    app_handle: tauri::AppHandle,
}

// Query params for all routes
#[derive(Deserialize)]
struct KeyQuery {
    key: Option<String>,
}

#[derive(Serialize, Deserialize, Clone, Debug)]
pub struct AllowedDevice {
    pub id: String,
    pub name: String,
    pub ip: String,
    pub allowed_without_key: bool,
    pub last_seen: String,
}

fn read_allowed_devices() -> Vec<AllowedDevice> {
    let path = get_app_dir().join("allowed_devices.json");
    if path.exists() {
        if let Ok(data) = fs::read_to_string(&path) {
            if let Ok(list) = serde_json::from_str::<Vec<AllowedDevice>>(&data) {
                return list;
            }
        }
    }
    Vec::new()
}

fn write_allowed_devices(list: &[AllowedDevice]) {
    let path = get_app_dir().join("allowed_devices.json");
    let _ = fs::write(&path, serde_json::to_string_pretty(list).unwrap());
}

fn register_device(id: String, name: String, ip: String) -> Result<(), String> {
    let mut list = read_allowed_devices();
    let now = chrono::Local::now().to_rfc3339();
    
    if let Some(d) = list.iter_mut().find(|d| d.id == id) {
        d.name = name;
        if !ip.is_empty() { d.ip = ip; }
        d.last_seen = now;
    } else {
        list.push(AllowedDevice {
            id,
            name,
            ip,
            allowed_without_key: false,
            last_seen: now,
        });
    }
    write_allowed_devices(&list);
    Ok(())
}

fn is_device_allowed_without_key(id: &str) -> bool {
    let list = read_allowed_devices();
    list.iter().any(|d| d.id == id && d.allowed_without_key)
}

fn check_auth(
    q: &KeyQuery,
    headers: &HeaderMap,
    client_ip: String,
    s: &AxumState,
) -> bool {
    let is_key_valid = q.key.as_deref() == Some(s.key.as_str());
    
    let device_id = headers.get("x-device-id").and_then(|v| v.to_str().ok());
    let device_name = headers.get("x-device-name")
        .and_then(|v| v.to_str().ok())
        .unwrap_or("Unknown Device");

    if is_key_valid {
        if let Some(id) = device_id {
            let _ = register_device(id.to_string(), device_name.to_string(), client_ip);
        }
        return true;
    }

    if let Some(id) = device_id {
        if is_device_allowed_without_key(id) {
            let _ = register_device(id.to_string(), device_name.to_string(), client_ip);
            return true;
        } else {
            let _ = register_device(id.to_string(), device_name.to_string(), client_ip);
        }
    }

    false
}

// Helper to get local LAN IP
fn get_local_ip() -> String {
    if let Ok(interfaces) = local_ip_address::list_afinet_netifas() {
        let mut best_ip = None;
        for (name, ip) in &interfaces {
            if ip.is_ipv4() && !ip.is_loopback() {
                let ip_str = ip.to_string();
                let name_lower = name.to_lowercase();
                
                // Exclude common VPN / virtual interface names
                if name_lower.contains("tun")
                    || name_lower.contains("tap")
                    || name_lower.contains("vpn")
                    || name_lower.contains("wg")
                    || name_lower.contains("ppp")
                    || name_lower.contains("virtual")
                    || name_lower.contains("vbox")
                    || name_lower.contains("vmware")
                    || name_lower.contains("wsl")
                {
                    continue;
                }
                
                // Prioritize standard Wi-Fi / Ethernet prefixes
                if name_lower.contains("wi-fi")
                    || name_lower.contains("wifi")
                    || name_lower.contains("ethernet")
                    || name_lower.contains("wlan")
                    || name_lower.contains("eth")
                    || name_lower.contains("en")
                {
                    return ip_str;
                }
                
                // Fallback to any valid private LAN IPv4 address
                if ip_str.starts_with("192.168.") || ip_str.starts_with("10.") || ip_str.starts_with("172.") {
                    best_ip = Some(ip_str);
                }
            }
        }
        if let Some(ip) = best_ip {
            return ip;
        }
    }

    use std::net::UdpSocket;
    let socket = UdpSocket::bind("0.0.0.0:0").ok();
    if let Some(s) = socket {
        s.connect("8.8.8.8:80").ok();
        if let Ok(addr) = s.local_addr() {
            return addr.ip().to_string();
        }
    }
    "127.0.0.1".to_string()
}

// Generate random 8-char alphanumeric key
fn generate_key() -> String {
    use rand::Rng;
    let mut rng = rand::thread_rng();
    (0..8)
        .map(|_| {
            let idx = rng.gen_range(0..36);
            if idx < 10 { (b'0' + idx) as char } else { (b'A' + idx - 10) as char }
        })
        .collect()
}

// Read api_url from settings file
fn read_api_url() -> String {
    let path = get_app_dir().join("settings.json");
    if let Ok(content) = fs::read_to_string(&path) {
        if let Ok(v) = serde_json::from_str::<serde_json::Value>(&content) {
            if let Some(url) = v["api_url"].as_str() {
                return url.to_string();
            }
        }
    }
    "http://localhost:5001".to_string()
}

fn read_dir_json_files_stem(dir_path: std::path::PathBuf) -> serde_json::Value {
    let mut map = serde_json::Map::new();
    if let Ok(entries) = fs::read_dir(dir_path) {
        for entry in entries.flatten() {
            if entry.path().is_file() && entry.path().extension().map_or(false, |e| e == "json") {
                if let Some(filename_os) = entry.path().file_stem() {
                    let filename = filename_os.to_string_lossy().to_string();
                    if let Ok(content) = fs::read_to_string(entry.path()) {
                        if let Ok(val) = serde_json::from_str::<serde_json::Value>(&content) {
                            map.insert(filename, val);
                        }
                    }
                }
            }
        }
    }
    serde_json::Value::Object(map)
}

fn read_dir_text_files_stem(dir_path: std::path::PathBuf) -> serde_json::Value {
    let mut map = serde_json::Map::new();
    if let Ok(entries) = fs::read_dir(dir_path) {
        for entry in entries.flatten() {
            if entry.path().is_file() {
                if let Some(filename_os) = entry.path().file_stem() {
                    let filename = filename_os.to_string_lossy().to_string();
                    if let Ok(content) = fs::read_to_string(entry.path()) {
                        map.insert(filename, serde_json::Value::String(content));
                    }
                }
            }
        }
    }
    serde_json::Value::Object(map)
}

fn read_dir_text_files_name(dir_path: std::path::PathBuf) -> serde_json::Value {
    let mut map = serde_json::Map::new();
    if let Ok(entries) = fs::read_dir(dir_path) {
        for entry in entries.flatten() {
            if entry.path().is_file() {
                if let Some(filename_os) = entry.path().file_name() {
                    let filename = filename_os.to_string_lossy().to_string();
                    if let Ok(content) = fs::read_to_string(entry.path()) {
                        map.insert(filename, serde_json::Value::String(content));
                    }
                }
            }
        }
    }
    serde_json::Value::Object(map)
}

// Build and return the sync bundle (all characters + all chats + settings + memories + history + RPG + skills + credentials)
fn build_sync_bundle() -> serde_json::Value {
    let app_dir = get_app_dir();

    // 1. Settings
    let settings_str = fs::read_to_string(app_dir.join("settings.json")).unwrap_or_default();
    let settings: serde_json::Value = serde_json::from_str(&settings_str).unwrap_or(serde_json::Value::Null);

    // 2. Characters
    let chars_dir = app_dir.join("characters");
    let mut characters: Vec<serde_json::Value> = Vec::new();
    if let Ok(entries) = fs::read_dir(&chars_dir) {
        for entry in entries.flatten() {
            if entry.path().extension().map_or(false, |e| e == "json") {
                if let Ok(c) = fs::read_to_string(entry.path()) {
                    if let Ok(v) = serde_json::from_str::<serde_json::Value>(&c) {
                        characters.push(v);
                    }
                }
            }
        }
    }

    // 3. Chats: character_id -> Vec<session>
    let chats_root = app_dir.join("chats");
    let mut chats_map: serde_json::Map<String, serde_json::Value> = serde_json::Map::new();
    if let Ok(char_dirs) = fs::read_dir(&chats_root) {
        for char_dir in char_dirs.flatten() {
            if char_dir.path().is_dir() {
                let char_id = char_dir.file_name().to_string_lossy().to_string();
                let mut sessions: Vec<serde_json::Value> = Vec::new();
                if let Ok(chat_files) = fs::read_dir(char_dir.path()) {
                    for cf in chat_files.flatten() {
                        if cf.path().extension().map_or(false, |e| e == "json") {
                            if let Ok(c) = fs::read_to_string(cf.path()) {
                                if let Ok(v) = serde_json::from_str::<serde_json::Value>(&c) {
                                    sessions.push(v);
                                }
                            }
                        }
                    }
                }
                chats_map.insert(char_id, serde_json::Value::Array(sessions));
            }
        }
    }

    // 4. GenAI Memories
    let memories = read_dir_json_files_stem(app_dir.join("memory"));

    // 5. GenAI History
    let genai_history_str = fs::read_to_string(app_dir.join("genai_history.json")).unwrap_or_default();
    let genai_history: serde_json::Value = serde_json::from_str(&genai_history_str).unwrap_or(serde_json::Value::Null);

    // 6. Games State
    let games_state_str = fs::read_to_string(app_dir.join("games_state.json")).unwrap_or_default();
    let games_state: serde_json::Value = serde_json::from_str(&games_state_str).unwrap_or(serde_json::Value::Null);

    // 7. Groups
    let groups_str = fs::read_to_string(app_dir.join("groups.json")).unwrap_or_default();
    let groups: serde_json::Value = serde_json::from_str(&groups_str).unwrap_or(serde_json::Value::Null);

    // 8. Group Chats
    let group_chats = read_dir_json_files_stem(app_dir.join("group_chats"));

    // 9. Custom Skills
    let skills = read_dir_text_files_name(app_dir.join("skills"));

    // 10. Credentials
    let credentials = read_dir_text_files_stem(app_dir.join("credentials"));

    // 11. GenAI assistant memories (stored facts)
    let genai_memories_str = fs::read_to_string(app_dir.join("genai_memories.json")).unwrap_or_default();
    let genai_memories: serde_json::Value = serde_json::from_str(&genai_memories_str).unwrap_or(serde_json::Value::Null);

    serde_json::json!({
        "settings": settings,
        "characters": characters,
        "chats": chats_map,
        "memories": memories,
        "genai_history": genai_history,
        "games_state": games_state,
        "groups": groups,
        "group_chats": group_chats,
        "skills": skills,
        "credentials": credentials,
        "genai_memories": genai_memories
    })
}

// ─── Axum Route Handlers ─────────────────────────────────────────────

async fn route_ping(
    Query(q): Query<KeyQuery>,
    headers: HeaderMap,
    ConnectInfo(addr): ConnectInfo<SocketAddr>,
    State(s): State<AxumState>,
) -> Response {
    if !check_auth(&q, &headers, addr.ip().to_string(), &s) {
        return (StatusCode::UNAUTHORIZED, "Unauthorized").into_response();
    }
    s.client_count.fetch_add(1, Ordering::Relaxed);
    Json(serde_json::json!({"ok": true, "version": "1"})).into_response()
}

async fn route_sync_bundle(
    Query(q): Query<KeyQuery>,
    headers: HeaderMap,
    ConnectInfo(addr): ConnectInfo<SocketAddr>,
    State(s): State<AxumState>,
) -> Response {
    if !check_auth(&q, &headers, addr.ip().to_string(), &s) {
        return (StatusCode::UNAUTHORIZED, "Unauthorized").into_response();
    }
    s.client_count.fetch_add(0, Ordering::Relaxed); // no-op, just satisfy compiler
    let bundle = build_sync_bundle();
    Json(bundle).into_response()
}

async fn route_relay(
    Query(q): Query<KeyQuery>,
    headers: HeaderMap,
    ConnectInfo(addr): ConnectInfo<SocketAddr>,
    State(s): State<AxumState>,
    body: axum::body::Bytes,
) -> Response {
    if !check_auth(&q, &headers, addr.ip().to_string(), &s) {
        return (StatusCode::UNAUTHORIZED, "Unauthorized").into_response();
    }

    let api_url = read_api_url();
    let target = format!("{}/v1/chat/completions", api_url);

    let client = reqwest::Client::new();
    let result = client
        .post(&target)
        .header("Content-Type", "application/json")
        .body(body.to_vec())
        .send()
        .await;

    match result {
        Ok(resp) => {
            let status = axum::http::StatusCode::from_u16(resp.status().as_u16())
                .unwrap_or(axum::http::StatusCode::INTERNAL_SERVER_ERROR);

            // Convert reqwest bytes stream to axum Body stream
            let byte_stream = resp.bytes_stream().map(|r| {
                r.map_err(|e| std::io::Error::new(std::io::ErrorKind::Other, e))
            });
            let body = Body::from_stream(byte_stream);

            Response::builder()
                .status(status)
                .header("Content-Type", "text/event-stream")
                .header("Cache-Control", "no-cache")
                .header("X-Accel-Buffering", "no")
                .body(body)
                .unwrap_or_else(|_| (StatusCode::INTERNAL_SERVER_ERROR, "Stream error").into_response())
        }
        Err(e) => (StatusCode::BAD_GATEWAY, format!("LLM relay error: {}", e)).into_response(),
    }
}

// Push a chat session from client to host filesystem
async fn route_push_chat(
    Query(q): Query<KeyQuery>,
    headers: HeaderMap,
    ConnectInfo(addr): ConnectInfo<SocketAddr>,
    State(s): State<AxumState>,
    Json(payload): Json<serde_json::Value>,
) -> Response {
    if !check_auth(&q, &headers, addr.ip().to_string(), &s) {
        return (StatusCode::UNAUTHORIZED, "Unauthorized").into_response();
    }
    let char_id = payload["character_id"].as_str().unwrap_or("").to_string();
    let chat_data = &payload["data"];
    if char_id.is_empty() || chat_data.is_null() {
        return (StatusCode::BAD_REQUEST, "Missing character_id or data").into_response();
    }
    // Security: prevent path traversal
    if char_id.contains('/') || char_id.contains('\\') || char_id.contains('.') {
        return (StatusCode::BAD_REQUEST, "Invalid character_id").into_response();
    }
    let session: ChatSession = match serde_json::from_value(chat_data.clone()) {
        Ok(s) => s,
        Err(e) => return (StatusCode::BAD_REQUEST, format!("Invalid session: {}", e)).into_response(),
    };
    let dir = get_app_dir().join("chats").join(&char_id);
    ensure_dir(&dir);
    let path = dir.join(format!("{}.json", session.id));
    match fs::write(&path, serde_json::to_string_pretty(&session).unwrap()) {
        Ok(_) => {
            use tauri::Emitter;
            let _ = s.app_handle.emit("host-data-updated", ());
            StatusCode::OK.into_response()
        },
        Err(e) => (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()).into_response(),
    }
}

// Delete a chat session on host
async fn route_delete_chat(
    Query(q): Query<KeyQuery>,
    headers: HeaderMap,
    ConnectInfo(addr): ConnectInfo<SocketAddr>,
    State(s): State<AxumState>,
    Json(payload): Json<serde_json::Value>,
) -> Response {
    if !check_auth(&q, &headers, addr.ip().to_string(), &s) {
        return (StatusCode::UNAUTHORIZED, "Unauthorized").into_response();
    }
    let char_id = payload["character_id"].as_str().unwrap_or("").to_string();
    let chat_id = payload["chat_id"].as_str().unwrap_or("").to_string();
    if char_id.is_empty() || chat_id.is_empty() {
        return (StatusCode::BAD_REQUEST, "Missing ids").into_response();
    }
    if char_id.contains('/') || char_id.contains('\\') || char_id.contains('.')
        || chat_id.contains('/') || chat_id.contains('\\') || chat_id.contains('.') {
        return (StatusCode::BAD_REQUEST, "Invalid id").into_response();
    }
    let path = get_app_dir().join("chats").join(&char_id).join(format!("{}.json", chat_id));
    if path.exists() {
        let _ = fs::remove_file(&path);
    }
    use tauri::Emitter;
    let _ = s.app_handle.emit("host-data-updated", ());
    StatusCode::OK.into_response()
}

// Push a character from client to host
async fn route_push_character(
    Query(q): Query<KeyQuery>,
    headers: HeaderMap,
    ConnectInfo(addr): ConnectInfo<SocketAddr>,
    State(s): State<AxumState>,
    Json(payload): Json<serde_json::Value>,
) -> Response {
    if !check_auth(&q, &headers, addr.ip().to_string(), &s) {
        return (StatusCode::UNAUTHORIZED, "Unauthorized").into_response();
    }
    let character: Character = match serde_json::from_value(payload) {
        Ok(c) => c,
        Err(e) => return (StatusCode::BAD_REQUEST, format!("Invalid character: {}", e)).into_response(),
    };
    let dir = get_app_dir().join("characters");
    ensure_dir(&dir);
    let path = dir.join(format!("{}.json", character.id));
    match fs::write(&path, serde_json::to_string_pretty(&character).unwrap()) {
        Ok(_) => {
            use tauri::Emitter;
            let _ = s.app_handle.emit("host-data-updated", ());
            StatusCode::OK.into_response()
        },
        Err(e) => (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()).into_response(),
    }
}

// Delete a character on host
async fn route_delete_character(
    Query(q): Query<KeyQuery>,
    headers: HeaderMap,
    ConnectInfo(addr): ConnectInfo<SocketAddr>,
    State(s): State<AxumState>,
    Json(payload): Json<serde_json::Value>,
) -> Response {
    if !check_auth(&q, &headers, addr.ip().to_string(), &s) {
        return (StatusCode::UNAUTHORIZED, "Unauthorized").into_response();
    }
    let id = payload["id"].as_str().unwrap_or("").to_string();
    if id.is_empty() || id.contains('/') || id.contains('\\') || id.contains('.') {
        return (StatusCode::BAD_REQUEST, "Invalid id").into_response();
    }
    let path = get_app_dir().join("characters").join(format!("{}.json", id));
    if path.exists() {
        let _ = fs::remove_file(&path);
    }
    // Also remove associated chats dir and memory
    let chats_dir = get_app_dir().join("chats").join(&id);
    if chats_dir.exists() { let _ = fs::remove_dir_all(&chats_dir); }
    let mem = get_app_dir().join("memory").join(format!("{}.json", id));
    if mem.exists() { let _ = fs::remove_file(&mem); }
    use tauri::Emitter;
    let _ = s.app_handle.emit("host-data-updated", ());
    StatusCode::OK.into_response()
}

async fn route_push_genai_history(
    Query(q): Query<KeyQuery>,
    headers: HeaderMap,
    ConnectInfo(addr): ConnectInfo<SocketAddr>,
    State(s): State<AxumState>,
    Json(payload): Json<serde_json::Value>,
) -> Response {
    if !check_auth(&q, &headers, addr.ip().to_string(), &s) {
        return (StatusCode::UNAUTHORIZED, "Unauthorized").into_response();
    }
    let data = payload["data"].as_str().unwrap_or("");
    if data.is_empty() {
        return (StatusCode::BAD_REQUEST, "Missing data").into_response();
    }
    match save_genai_history(data.to_string()) {
        Ok(_) => {
            use tauri::Emitter;
            let _ = s.app_handle.emit("host-data-updated", ());
            StatusCode::OK.into_response()
        },
        Err(e) => (StatusCode::INTERNAL_SERVER_ERROR, e).into_response(),
    }
}

async fn route_push_memory(
    Query(q): Query<KeyQuery>,
    headers: HeaderMap,
    ConnectInfo(addr): ConnectInfo<SocketAddr>,
    State(s): State<AxumState>,
    Json(payload): Json<serde_json::Value>,
) -> Response {
    if !check_auth(&q, &headers, addr.ip().to_string(), &s) {
        return (StatusCode::UNAUTHORIZED, "Unauthorized").into_response();
    }
    let char_id = payload["character_id"].as_str().unwrap_or("").to_string();
    let data = payload["data"].as_str().unwrap_or("");
    if char_id.is_empty() || data.is_empty() {
        return (StatusCode::BAD_REQUEST, "Missing character_id or data").into_response();
    }
    match save_memory(char_id, data.to_string()) {
        Ok(_) => {
            use tauri::Emitter;
            let _ = s.app_handle.emit("host-data-updated", ());
            StatusCode::OK.into_response()
        },
        Err(e) => (StatusCode::INTERNAL_SERVER_ERROR, e).into_response(),
    }
}

async fn route_push_genai_memories(
    Query(q): Query<KeyQuery>,
    headers: HeaderMap,
    ConnectInfo(addr): ConnectInfo<SocketAddr>,
    State(s): State<AxumState>,
    Json(payload): Json<serde_json::Value>,
) -> Response {
    if !check_auth(&q, &headers, addr.ip().to_string(), &s) {
        return (StatusCode::UNAUTHORIZED, "Unauthorized").into_response();
    }
    let data = payload["data"].as_str().unwrap_or("");
    if data.is_empty() {
        return (StatusCode::BAD_REQUEST, "Missing data").into_response();
    }
    match save_genai_memories(data.to_string()) {
        Ok(_) => {
            use tauri::Emitter;
            let _ = s.app_handle.emit("host-data-updated", ());
            StatusCode::OK.into_response()
        },
        Err(e) => (StatusCode::INTERNAL_SERVER_ERROR, e).into_response(),
    }
}

// ─── Tauri Commands: Local Network ───────────────────────────────────

#[tauri::command]
async fn start_host_server(
    state: tauri::State<'_, ServerShared>,
    app_handle: tauri::AppHandle,
) -> Result<StartServerResult, String> {
    let port: u16 = 8765;
    let key = generate_key();
    let local_ip = get_local_ip();
    let client_count = Arc::new(AtomicUsize::new(0));

    // Stop existing server if running
    {
        let mut guard = state.inner.lock().unwrap();
        if let Some(old) = guard.take() {
            let _ = old.shutdown_tx.send(());
            let _ = old.udp_shutdown_tx.send(());
        }
    }

    let axum_state = AxumState {
        key: key.clone(),
        client_count: client_count.clone(),
        app_handle: app_handle.clone(),
    };

    let cors = tower_http::cors::CorsLayer::new()
        .allow_origin(tower_http::cors::Any)
        .allow_methods(tower_http::cors::Any)
        .allow_headers(tower_http::cors::Any);

    let app = Router::new()
        .route("/ping", get(route_ping))
        .route("/sync/bundle", get(route_sync_bundle))
        .route("/relay", post(route_relay))
        .route("/push/chat", post(route_push_chat))
        .route("/push/chat", delete(route_delete_chat))
        .route("/push/character", post(route_push_character))
        .route("/push/character", delete(route_delete_character))
        .route("/push/genai_history", post(route_push_genai_history))
        .route("/push/memory", post(route_push_memory))
        .route("/push/genai_memories", post(route_push_genai_memories))
        .with_state(axum_state)
        .layer(cors);

    let listener = TcpListener::bind(format!("0.0.0.0:{}", port))
        .await
        .map_err(|e| format!("Failed to bind port {}: {}", port, e))?;

    let (shutdown_tx, shutdown_rx) = tokio::sync::oneshot::channel::<()>();
    let (udp_tx, udp_rx) = tokio::sync::oneshot::channel::<()>();

    // Start axum server
    tokio::spawn(async move {
        axum::serve(listener, app.into_make_service_with_connect_info::<SocketAddr>())
            .with_graceful_shutdown(async move {
                let _ = shutdown_rx.await;
            })
            .await
            .ok();
    });

    // Start UDP broadcast
    let udp_ip = local_ip.clone();
    let _udp_key_hint = key[..2].to_string();
    tokio::spawn(async move {
        use tokio::net::UdpSocket;
        let sock = match UdpSocket::bind("0.0.0.0:0").await {
            Ok(s) => s,
            Err(_) => return,
        };
        let _ = sock.set_broadcast(true);
        let hostname = std::env::var("COMPUTERNAME")
            .or_else(|_| std::env::var("HOSTNAME"))
            .unwrap_or_else(|_| "LLMChat Host".to_string());
        let msg = serde_json::json!({
            "app": "llmchat",
            "port": port,
            "host_name": hostname,
            "ip": udp_ip,
        })
        .to_string();
        let msg_bytes = msg.as_bytes().to_vec();
        let mut udp_rx = udp_rx;
        loop {
            tokio::select! {
                _ = &mut udp_rx => break,
                _ = tokio::time::sleep(tokio::time::Duration::from_secs(3)) => {
                    let _ = sock.send_to(&msg_bytes, "255.255.255.255:8766").await;
                }
            }
        }
    });

    {
        let mut guard = state.inner.lock().unwrap();
        *guard = Some(RunningServer {
            key: key.clone(),
            port,
            shutdown_tx,
            udp_shutdown_tx: udp_tx,
            client_count,
            local_ip: local_ip.clone(),
        });
    }

    Ok(StartServerResult { key, port, local_ip })
}

#[tauri::command]
async fn stop_host_server(
    state: tauri::State<'_, ServerShared>,
) -> Result<(), String> {
    let mut guard = state.inner.lock().unwrap();
    if let Some(server) = guard.take() {
        let _ = server.shutdown_tx.send(());
        let _ = server.udp_shutdown_tx.send(());
    }
    Ok(())
}

#[tauri::command]
async fn get_host_server_status(
    state: tauri::State<'_, ServerShared>,
) -> Result<ServerStatusResult, String> {
    let guard = state.inner.lock().unwrap();
    if let Some(server) = guard.as_ref() {
        Ok(ServerStatusResult {
            running: true,
            key: Some(server.key.clone()),
            port: Some(server.port),
            local_ip: Some(server.local_ip.clone()),
            client_count: server.client_count.load(Ordering::Relaxed),
        })
    } else {
        Ok(ServerStatusResult {
            running: false,
            key: None,
            port: None,
            local_ip: None,
            client_count: 0,
        })
    }
}

#[tauri::command]
async fn discover_hosts() -> Result<Vec<DiscoveredHost>, String> {
    use tokio::net::UdpSocket;
    let sock = UdpSocket::bind("0.0.0.0:8766")
        .await
        .map_err(|e| format!("Cannot listen for discovery: {}", e))?;

    let mut hosts: Vec<DiscoveredHost> = Vec::new();
    let mut seen: std::collections::HashSet<String> = std::collections::HashSet::new();
    let deadline = tokio::time::Instant::now() + tokio::time::Duration::from_secs(4);
    let mut buf = [0u8; 1024];

    loop {
        let remaining = deadline.saturating_duration_since(tokio::time::Instant::now());
        if remaining.is_zero() { break; }

        match tokio::time::timeout(remaining, sock.recv_from(&mut buf)).await {
            Ok(Ok((len, addr))) => {
                let msg = std::str::from_utf8(&buf[..len]).unwrap_or("");
                if let Ok(v) = serde_json::from_str::<serde_json::Value>(msg) {
                    if v["app"].as_str() == Some("llmchat") {
                        let ip = v["ip"].as_str()
                            .unwrap_or(&addr.ip().to_string())
                            .to_string();
                        let port = v["port"].as_u64().unwrap_or(8765) as u16;
                        let host_name = v["host_name"].as_str().unwrap_or("Unknown").to_string();
                        let key = format!("{}:{}", ip, port);
                        if seen.insert(key) {
                            hosts.push(DiscoveredHost { ip, port, host_name });
                        }
                    }
                }
            }
            _ => break,
        }
    }
    Ok(hosts)
}

#[tauri::command]
async fn client_http_request(
    method: String,
    url: String,
    body: Option<String>,
    headers: Option<HashMap<String, String>>,
    timeout_secs: Option<u64>,
) -> Result<String, String> {
    let client = reqwest::Client::new();
    let mut builder = match method.to_uppercase().as_str() {
        "POST" => client.post(&url),
        "DELETE" => client.delete(&url),
        _ => client.get(&url),
    };
    
    let secs = timeout_secs.unwrap_or(10);
    builder = builder.timeout(std::time::Duration::from_secs(secs));
    
    if let Some(ref h) = headers {
        for (k, v) in h {
            builder = builder.header(k, v);
        }
    }

    if let Some(ref b) = body {
        builder = builder.header("Content-Type", "application/json").body(b.clone());
    }

    let resp = builder.send().await.map_err(|e| e.to_string())?;
    let status = resp.status();
    let text = resp.text().await.map_err(|e| e.to_string())?;
    
    if !status.is_success() {
        return Err(format!("HTTP error {}: {}", status, text));
    }
    
    Ok(text)
}

static ACTIVE_RELAYS: std::sync::OnceLock<std::sync::Mutex<std::collections::HashMap<String, tokio::sync::oneshot::Sender<()>>>> = std::sync::OnceLock::new();

fn get_active_relays() -> &'static std::sync::Mutex<std::collections::HashMap<String, tokio::sync::oneshot::Sender<()>>> {
    ACTIVE_RELAYS.get_or_init(|| std::sync::Mutex::new(std::collections::HashMap::new()))
}

#[tauri::command]
async fn client_relay_stream(
    app_handle: tauri::AppHandle,
    url: String,
    body: String,
    event_id: String,
    headers: Option<HashMap<String, String>>,
) -> Result<(), String> {
    use tokio_stream::StreamExt;
    use tauri::Emitter;

    let (cancel_tx, mut cancel_rx) = tokio::sync::oneshot::channel::<()>();
    
    // Register the cancellation channel
    {
        let mut map = get_active_relays().lock().unwrap();
        map.insert(event_id.clone(), cancel_tx);
    }

    // Ensure we remove the channel when this function exits
    struct Cleanup {
        event_id: String,
    }
    impl Drop for Cleanup {
        fn drop(&mut self) {
            let mut map = get_active_relays().lock().unwrap();
            map.remove(&self.event_id);
        }
    }
    let _cleanup = Cleanup { event_id: event_id.clone() };

    let client = reqwest::Client::new();
    let mut builder = client
        .post(&url)
        .header("Content-Type", "application/json");

    if let Some(ref h) = headers {
        for (k, v) in h {
            builder = builder.header(k, v);
        }
    }

    let send_fut = builder.body(body).send();

    let result = tokio::select! {
        res = send_fut => match res {
            Ok(r) => r,
            Err(e) => return Err(e.to_string()),
        },
        _ = &mut cancel_rx => {
            return Ok(());
        }
    };

    if !result.status().is_success() {
        let status = result.status();
        let text = result.text().await.unwrap_or_default();
        return Err(format!("Relay HTTP error {}: {}", status, text));
    }

    let mut stream = result.bytes_stream();
    loop {
        tokio::select! {
            chunk_opt = stream.next() => {
                match chunk_opt {
                    Some(Ok(bytes)) => {
                        let text = String::from_utf8_lossy(&bytes).into_owned();
                        let _ = app_handle.emit(&format!("relay-chunk-{}", event_id), text);
                    }
                    Some(Err(e)) => {
                        return Err(e.to_string());
                    }
                    None => break,
                }
            }
            _ = &mut cancel_rx => {
                break;
            }
        }
    }

    let _ = app_handle.emit(&format!("relay-done-{}", event_id), ());
    Ok(())
}

#[tauri::command]
fn cancel_client_relay(event_id: String) {
    let mut map = get_active_relays().lock().unwrap();
    if let Some(tx) = map.remove(&event_id) {
        let _ = tx.send(());
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

#[tauri::command]
fn save_genai_history(data: String) -> Result<(), String> {
    let dir = get_app_dir();
    ensure_dir(&dir);
    let path = dir.join("genai_history.json");
    fs::write(&path, &data).map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
fn load_genai_history() -> Result<String, String> {
    let path = get_app_dir().join("genai_history.json");
    if path.exists() {
        fs::read_to_string(&path).map_err(|e| e.to_string())
    } else {
        Ok("".to_string())
    }
}

// ─── Game State Commands ───────────────────────────────────────────

#[tauri::command]
fn save_game_state(data: String) -> Result<(), String> {
    let dir = get_app_dir();
    ensure_dir(&dir);
    let path = dir.join("games_state.json");
    fs::write(&path, &data).map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
fn load_game_state() -> Result<String, String> {
    let path = get_app_dir().join("games_state.json");
    if path.exists() {
        fs::read_to_string(&path).map_err(|e| e.to_string())
    } else {
        Ok("".to_string())
    }
}

// ─── Group Chat Commands ───────────────────────────────────────────

#[tauri::command]
fn save_group_state(data: String) -> Result<(), String> {
    let dir = get_app_dir();
    ensure_dir(&dir);
    let path = dir.join("groups.json");
    fs::write(&path, &data).map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
fn load_group_state() -> Result<String, String> {
    let path = get_app_dir().join("groups.json");
    if path.exists() {
        fs::read_to_string(&path).map_err(|e| e.to_string())
    } else {
        Ok("".to_string())
    }
}

#[tauri::command]
fn save_group_sessions(group_id: String, data: String) -> Result<(), String> {
    let dir = get_app_dir().join("group_chats");
    ensure_dir(&dir);
    let path = dir.join(format!("{}.json", group_id));
    fs::write(&path, &data).map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
fn load_group_sessions(group_id: String) -> Result<String, String> {
    let path = get_app_dir().join("group_chats").join(format!("{}.json", group_id));
    if path.exists() {
        fs::read_to_string(&path).map_err(|e| e.to_string())
    } else {
        Ok("".to_string())
    }
}

#[tauri::command]
fn delete_group_sessions(group_id: String) -> Result<(), String> {
    let path = get_app_dir().join("group_chats").join(format!("{}.json", group_id));
    if path.exists() {
        fs::remove_file(&path).map_err(|e| e.to_string())?;
    }
    Ok(())
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

    // Skill 3: Internet Browser
    let internet_path = dir.join("Internet Browser.json");
    let content = r#"{
  "name": "Internet Browser",
  "capabilities": [
    "Web Search: Can search the web for real-time information, weather, news, facts, and website details using 'web_search' command. Supports advanced search operators such as 'site:example.com query' to search within specific domains.",
    "Web Page Reader: Can read and fetch the text content of a specific webpage or URL using 'web_fetch' command."
  ],
  "instructions": "Whenever the user asks about current events, facts you don't know, or requests web data, use the following tools on a new line and nothing else: \n1. {\"genai_action\":\"web_search\",\"query\":\"your search query\"}\n2. {\"genai_action\":\"web_fetch\",\"url\":\"https://...\"}\n\nTip: You can search within specific websites by using the 'site:domain.com query' syntax in your web_search query (e.g. {\"genai_action\":\"web_search\",\"query\":\"site:en.wikipedia.org quantum physics\"})."
}"#;
    fs::write(&internet_path, content).ok();

    // Skill 4: App Settings
    let app_settings_path = dir.join("App Settings.json");
    if !app_settings_path.exists() {
        let content = r#"{
  "name": "App Settings",
  "description": "VibeChatting Application Settings Guide and Key-Value Options",
  "settings": []
}"#;
        fs::write(&app_settings_path, content).ok();
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
                    let is_default = filename == "VibeChatting Guide.txt" || filename == "GenAI Features.json" || filename == "Internet Browser.json" || filename == "App Settings.json";
                    
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
    
    let is_default = filename == "VibeChatting Guide.txt" || filename == "GenAI Features.json" || filename == "Internet Browser.json" || filename == "App Settings.json";
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
    let is_default = filename == "VibeChatting Guide.txt" || filename == "GenAI Features.json" || filename == "Internet Browser.json" || filename == "App Settings.json";
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
fn open_skills_folder() -> Result<(), String> {
    ensure_default_skills();
    let dir = get_app_dir().join("skills");
    ensure_dir(&dir);
    
    #[cfg(target_os = "windows")]
    {
        std::process::Command::new("explorer")
            .arg(&dir)
            .spawn()
            .map_err(|e| e.to_string())?;
    }
    #[cfg(target_os = "macos")]
    {
        std::process::Command::new("open")
            .arg(&dir)
            .spawn()
            .map_err(|e| e.to_string())?;
    }
    #[cfg(target_os = "linux")]
    {
        std::process::Command::new("xdg-open")
            .arg(&dir)
            .spawn()
            .map_err(|e| e.to_string())?;
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
fn save_genai_memories(data: String) -> Result<(), String> {
    let dir = get_app_dir();
    ensure_dir(&dir);
    let path = dir.join("genai_memories.json");
    fs::write(&path, data).map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
fn load_genai_memories() -> Result<String, String> {
    let path = get_app_dir().join("genai_memories.json");
    if path.exists() {
        fs::read_to_string(&path).map_err(|e| e.to_string())
    } else {
        Ok("".to_string())
    }
}

#[tauri::command]
fn get_allowed_devices() -> Result<Vec<AllowedDevice>, String> {
    Ok(read_allowed_devices())
}

#[tauri::command]
fn set_device_auth_status(id: String, allowed_without_key: bool) -> Result<(), String> {
    let mut list = read_allowed_devices();
    if let Some(d) = list.iter_mut().find(|d| d.id == id) {
        d.allowed_without_key = allowed_without_key;
        write_allowed_devices(&list);
        Ok(())
    } else {
        Err("Device not found".to_string())
    }
}

#[tauri::command]
fn remove_allowed_device(id: String) -> Result<(), String> {
    let mut list = read_allowed_devices();
    let old_len = list.len();
    list.retain(|d| d.id != id);
    if list.len() != old_len {
        write_allowed_devices(&list);
        Ok(())
    } else {
        Err("Device not found".to_string())
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

// ─── Gelbooru Commands ──────────────────────────────────────────────

#[tauri::command]
async fn gelbooru_request(
    url: String,
    api_key: Option<String>,
    user_id: Option<String>,
) -> Result<String, String> {
    use reqwest::header::{HeaderMap, HeaderValue, USER_AGENT};

    let client = reqwest::Client::new();
    let mut headers = HeaderMap::new();
    
    headers.insert(
        USER_AGENT,
        HeaderValue::from_static("VibeChatting/1.0.0 (contact@vibechatting.org)"),
    );

    // Build URL with auth params
    let mut final_url = url.clone();
    if let (Some(ref key), Some(ref uid)) = (&api_key, &user_id) {
        if !key.trim().is_empty() && !uid.trim().is_empty() {
            let separator = if url.contains('?') { "&" } else { "?" };
            final_url = format!("{}{}api_key={}&user_id={}", url, separator, key.trim(), uid.trim());
            
            let masked = if key.len() > 4 { format!("{}...", &key[..4]) } else { "...".to_string() };
            println!("[Rust Gelbooru API] Appending credentials. User ID: {}, Key: {}", uid.trim(), masked);
        } else {
            println!("[Rust Gelbooru API] Credentials exist but are empty strings.");
        }
    } else {
        println!("[Rust Gelbooru API] No credentials provided: api_key={:?}, user_id={:?}", api_key, user_id);
    }

    let resp = client.get(&final_url)
        .headers(headers)
        .send()
        .await
        .map_err(|e| format!("Gelbooru network request failed: {}", e))?;

    let status = resp.status();
    let text = resp
        .text()
        .await
        .map_err(|e| format!("Failed to read Gelbooru response body: {}", e))?;

    if !status.is_success() {
        return Err(format!("Gelbooru API Error ({}): {}", status.as_u16(), text));
    }

    Ok(text)
}

#[tauri::command]
async fn gelbooru_fetch_image_base64(
    url: String,
) -> Result<String, String> {
    use reqwest::header::{HeaderMap, HeaderValue, USER_AGENT, REFERER};
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

    headers.insert(
        REFERER,
        HeaderValue::from_static("https://gelbooru.com/"),
    );

    let resp = client.get(&url)
        .headers(headers)
        .send()
        .await
        .map_err(|e| format!("Gelbooru CDN request failed: {}", e))?;

    let status = resp.status();
    let content_type = resp.headers()
        .get(reqwest::header::CONTENT_TYPE)
        .and_then(|v| v.to_str().ok())
        .unwrap_or("image/jpeg")
        .to_string();

    let bytes = resp.bytes().await.map_err(|e| format!("Failed to read Gelbooru image bytes: {}", e))?;

    if !status.is_success() {
        return Err(format!("CDN returned HTTP {} for Gelbooru image URL", status.as_u16()));
    }

    if !content_type.starts_with("image/") {
        return Err(format!("CDN returned non-image content-type '{}'", content_type));
    }

    let b64 = general_purpose::STANDARD.encode(&bytes);

    Ok(format!("data:{};base64,{}", content_type, b64))
}

#[tauri::command]
async fn fetch_image_base64(
    url: String,
) -> Result<String, String> {
    use reqwest::header::{HeaderMap, HeaderValue, USER_AGENT};
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

    let resp = client.get(&url)
        .headers(headers)
        .send()
        .await
        .map_err(|e| format!("Image request failed: {}", e))?;

    let status = resp.status();
    let content_type = resp.headers()
        .get(reqwest::header::CONTENT_TYPE)
        .and_then(|v| v.to_str().ok())
        .unwrap_or("image/jpeg")
        .to_string();

    let bytes = resp.bytes().await.map_err(|e| format!("Failed to read image bytes: {}", e))?;

    if !status.is_success() {
        return Err(format!("Server returned HTTP {} for image URL", status.as_u16()));
    }

    if !content_type.starts_with("image/") {
        return Err(format!("Server returned non-image content-type '{}'", content_type));
    }

    let b64 = general_purpose::STANDARD.encode(&bytes);

    Ok(format!("data:{};base64,{}", content_type, b64))
}

// ─── Web Search / Fetch Commands ────────────────────────────────────

fn strip_html_tags(html: &str) -> String {
    let mut result = String::new();
    let mut in_tag = false;
    let mut in_script_or_style = false;
    let mut tag_buffer = String::new();
    let mut body_chars = html.chars().peekable();
    
    while let Some(c) = body_chars.next() {
        if c == '<' {
            in_tag = true;
            tag_buffer.clear();
        } else if c == '>' {
            in_tag = false;
            let tag_lower = tag_buffer.to_lowercase();
            if tag_lower.starts_with("script") || tag_lower.starts_with("style") {
                in_script_or_style = true;
            } else if tag_lower.starts_with("/script") || tag_lower.starts_with("/style") {
                in_script_or_style = false;
            }
        } else if in_tag {
            tag_buffer.push(c);
        } else if !in_script_or_style {
            result.push(c);
        }
    }
    
    let cleaned = result
        .replace("&nbsp;", " ")
        .replace("&lt;", "<")
        .replace("&gt;", ">")
        .replace("&amp;", "&")
        .replace("&quot;", "\"")
        .replace("&#39;", "'");
        
    let mut collapsed = String::new();
    let mut last_was_whitespace = false;
    for c in cleaned.chars() {
        if c.is_whitespace() {
            if !last_was_whitespace {
                collapsed.push(' ');
                last_was_whitespace = true;
            }
        } else {
            collapsed.push(c);
            last_was_whitespace = false;
        }
    }
    
    collapsed.trim().to_string()
}

fn percent_decode(s: &str) -> String {
    let mut decoded = String::new();
    let mut chars = s.chars().peekable();
    while let Some(c) = chars.next() {
        if c == '%' {
            let mut hex = String::new();
            if let Some(h1) = chars.next() { hex.push(h1); }
            if let Some(h2) = chars.next() { hex.push(h2); }
            if let Ok(val) = u8::from_str_radix(&hex, 16) {
                decoded.push(val as char);
            } else {
                decoded.push('%');
                decoded.push_str(&hex);
            }
        } else if c == '+' {
            decoded.push(' ');
        } else {
            decoded.push(c);
        }
    }
    decoded
}

fn parse_ddg_html(html: &str) -> String {
    let mut results = Vec::new();
    let parts: Vec<&str> = html.split("result__body").collect();
    
    for part in parts.iter().skip(1).take(5) {
        let url = if let Some(href_idx) = part.find("href=\"") {
            let start = href_idx + 6;
            if let Some(end) = part[start..].find('"') {
                let raw_url = &part[start..start + end];
                if raw_url.contains("uddg=") {
                    if let Some(uddg_idx) = raw_url.find("uddg=") {
                        let enc_url = &raw_url[uddg_idx + 5..];
                        percent_decode(enc_url)
                    } else {
                        raw_url.to_string()
                    }
                } else {
                    raw_url.to_string()
                }
            } else {
                "".to_string()
            }
        } else {
            "".to_string()
        };
        
        if url.is_empty() {
            continue;
        }

        let title = if let Some(title_idx) = part.find("class=\"result__a\"") {
            let start = title_idx;
            if let Some(tag_end) = part[start..].find('>') {
                let content_start = start + tag_end + 1;
                if let Some(close_tag) = part[content_start..].find("</a>") {
                    strip_html_tags(&part[content_start..content_start + close_tag])
                } else {
                    "Untitled".to_string()
                }
            } else {
                "Untitled".to_string()
            }
        } else {
            "Untitled".to_string()
        };

        let snippet = if let Some(snippet_idx) = part.find("class=\"result__snippet\"") {
            let start = snippet_idx;
            if let Some(tag_end) = part[start..].find('>') {
                let content_start = start + tag_end + 1;
                if let Some(close_span) = part[content_start..].find("</span>") {
                    strip_html_tags(&part[content_start..content_start + close_span])
                } else if let Some(close_tag) = part[content_start..].find("</") {
                    strip_html_tags(&part[content_start..content_start + close_tag])
                } else {
                    "".to_string()
                }
            } else {
                "".to_string()
            }
        } else {
            "".to_string()
        };

        results.push(format!("### [{}]({})\n{}\n", title, url, snippet));
    }

    if results.is_empty() {
        "No results found.".to_string()
    } else {
        results.join("\n")
    }
}

const SEARXNG_ROTATION_POOL: &[&str] = &[
    "https://searx.be",
    "https://searxng.site",
    "https://searx.work",
    "https://search.disroot.org",
    "https://priv.au",
    "https://searx.name",
    "https://search.noc.im",
    "https://baresearch.org",
    "https://search.river.ooo",
    "https://searx.dresden.network",
    "https://search.bus-hit.me",
    "https://searx.si",
];

fn strip_layout_blocks_from_html(html: &str) -> String {
    let mut cleaned = String::new();
    let mut pos = 0;
    
    // We want to skip content inside: script, style, nav, footer, header, aside, form, iframe, svg
    let skip_tags = ["script", "style", "nav", "footer", "header", "aside", "form", "iframe", "svg"];
    
    while pos < html.len() {
        if let Some(start_tag_idx) = html[pos..].find('<') {
            let abs_start = pos + start_tag_idx;
            cleaned.push_str(&html[pos..abs_start]);
            
            // Find tag end
            if let Some(tag_end_idx) = html[abs_start..].find('>') {
                let abs_tag_end = abs_start + tag_end_idx;
                let tag_content = html[abs_start + 1..abs_tag_end].trim();
                let tag_name = tag_content.split_whitespace().next().unwrap_or("").to_lowercase();
                
                let is_skip_tag = skip_tags.iter().any(|&t| tag_name == t || tag_name.starts_with(&(t.to_owned() + " ")));
                
                if is_skip_tag && !tag_name.starts_with('/') {
                    // Find closing tag
                    let close_tag = format!("</{}", tag_name);
                    if let Some(close_idx) = html[abs_tag_end..].to_lowercase().find(&close_tag) {
                        let abs_close = abs_tag_end + close_idx;
                        // Find the closing tag end '>'
                        if let Some(close_end_idx) = html[abs_close..].find('>') {
                            pos = abs_close + close_end_idx + 1;
                            continue;
                        }
                    }
                }
                
                // Normal tag (or closing tag, or tag we don't skip), we just consume the tag itself
                cleaned.push('<');
                cleaned.push_str(&html[abs_start + 1..abs_tag_end + 1]);
                pos = abs_tag_end + 1;
            } else {
                // No closing tag bracket, append rest and break
                cleaned.push_str(&html[abs_start..]);
                break;
            }
        } else {
            cleaned.push_str(&html[pos..]);
            break;
        }
    }
    cleaned
}

async fn search_searxng(client: &reqwest::Client, base_url: &str, query: &str) -> Result<String, String> {
    let mut url = base_url.trim_end_matches('/').to_string();
    url.push_str("/search");

    let resp = client.get(&url)
        .query(&[("q", query), ("format", "json")])
        .send()
        .await
        .map_err(|e| format!("SearXNG request failed: {}", e))?;

    if !resp.status().is_success() {
        return Err(format!("SearXNG HTTP Error {}", resp.status()));
    }

    let json: serde_json::Value = resp.json()
        .await
        .map_err(|e| format!("Failed to parse SearXNG JSON: {}", e))?;

    let results_array = json["results"]
        .as_array()
        .ok_or_else(|| "No results array in SearXNG JSON".to_string())?;

    let mut results = Vec::new();
    for item in results_array.iter().take(5) {
        let title = item["title"].as_str().unwrap_or("Untitled");
        let url_str = item["url"].as_str().unwrap_or("");
        let content = item["content"].as_str().unwrap_or("");

        if url_str.is_empty() {
            continue;
        }
        results.push(format!("### [{}]({})\n{}\n", title, url_str, content));
    }

    if results.is_empty() {
        Ok("No results found.".to_string())
    } else {
        Ok(results.join("\n"))
    }
}

async fn search_searxng_rotation(client: &reqwest::Client, query: &str) -> Result<String, String> {
    use rand::seq::SliceRandom;
    
    let mut pool = SEARXNG_ROTATION_POOL.to_vec();
    {
        let mut rng = rand::thread_rng();
        pool.shuffle(&mut rng);
    }

    let max_attempts = 4;
    let mut last_err = String::new();
    
    for (i, instance) in pool.iter().take(max_attempts).enumerate() {
        println!("SearXNG rotation attempt {}: trying {}", i + 1, instance);
        match search_searxng(client, instance, query).await {
            Ok(res) => {
                if res != "No results found." {
                    return Ok(res);
                } else {
                    last_err = "No results found.".to_string();
                }
            }
            Err(e) => {
                last_err = e;
            }
        }
    }
    
    Err(format!("All rotation attempts failed. Last error: {}", last_err))
}

async fn search_tavily(client: &reqwest::Client, api_key: &str, query: &str) -> Result<String, String> {
    if api_key.trim().is_empty() {
        return Err("Tavily API key is empty. Please set it in Web Search Settings.".to_string());
    }

    let url = "https://api.tavily.com/search";
    
    let body = serde_json::json!({
        "api_key": api_key,
        "query": query,
        "search_depth": "basic",
        "include_answer": false,
        "max_results": 5
    });

    let resp = client.post(url)
        .json(&body)
        .send()
        .await
        .map_err(|e| format!("Request to Tavily failed: {}", e))?;

    if !resp.status().is_success() {
        return Err(format!("Tavily HTTP Error {}", resp.status()));
    }

    let json: serde_json::Value = resp.json()
        .await
        .map_err(|e| format!("Failed to parse Tavily JSON: {}", e))?;

    let results_array = json["results"]
        .as_array()
        .ok_or_else(|| "No results array in Tavily response".to_string())?;

    let mut results = Vec::new();
    for item in results_array.iter().take(5) {
        let title = item["title"].as_str().unwrap_or("Untitled");
        let url_str = item["url"].as_str().unwrap_or("");
        let content = item["content"].as_str().unwrap_or("");

        if url_str.is_empty() {
            continue;
        }
        results.push(format!("### [{}]({})\n{}\n", title, url_str, content));
    }

    if results.is_empty() {
        Ok("No results found.".to_string())
    } else {
        Ok(results.join("\n"))
    }
}

async fn search_ddg(client: &reqwest::Client, query: &str) -> Result<String, String> {
    let resp = client.get("https://html.duckduckgo.com/html/")
        .query(&[("q", query)])
        .send()
        .await
        .map_err(|e| format!("DDG search failed to connect: {}", e))?;

    let html = resp.text()
        .await
        .map_err(|e| format!("Failed to read DDG response body: {}", e))?;

    Ok(parse_ddg_html(&html))
}

#[tauri::command]
async fn web_search(query: String) -> Result<String, String> {
    let settings = read_search_settings();
    
    use reqwest::header::{HeaderMap, HeaderValue, USER_AGENT, ACCEPT, ACCEPT_LANGUAGE};
    let mut headers = HeaderMap::new();
    headers.insert(
        USER_AGENT,
        HeaderValue::from_static("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36"),
    );
    headers.insert(
        ACCEPT,
        HeaderValue::from_static("application/json, text/html, application/xhtml+xml, */*"),
    );
    headers.insert(
        ACCEPT_LANGUAGE,
        HeaderValue::from_static("en-US,en;q=0.9,ru;q=0.8"),
    );

    let client = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(10))
        .default_headers(headers)
        .build()
        .unwrap_or_else(|_| reqwest::Client::new());

    match settings.web_search_provider.as_str() {
        "searxng_rotation" => {
            match search_searxng_rotation(&client, &query).await {
                Ok(res) => Ok(res),
                Err(e) => {
                    println!("SearXNG rotation failed: {}. Falling back to DuckDuckGo.", e);
                    search_ddg(&client, &query).await
                }
            }
        }
        "searxng_custom" => {
            search_searxng(&client, &settings.web_search_searxng_url, &query).await
        }
        "tavily" => {
            search_tavily(&client, &settings.web_search_tavily_key, &query).await
        }
        _ => {
            search_ddg(&client, &query).await
        }
    }
}

#[tauri::command]
async fn web_fetch(url: String) -> Result<String, String> {
    use reqwest::header::{HeaderMap, HeaderValue, USER_AGENT, ACCEPT, ACCEPT_LANGUAGE, CONNECTION};
    
    let client = reqwest::Client::new();
    let mut headers = HeaderMap::new();
    headers.insert(
        USER_AGENT,
        HeaderValue::from_static("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36"),
    );
    headers.insert(
        ACCEPT,
        HeaderValue::from_static("text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8,application/signed-exchange;v=b3;q=0.7"),
    );
    headers.insert(
        ACCEPT_LANGUAGE,
        HeaderValue::from_static("en-US,en;q=0.9,ru;q=0.8"),
    );
    headers.insert(
        CONNECTION,
        HeaderValue::from_static("keep-alive"),
    );
    
    if let Ok(val) = HeaderValue::from_str("\"Google Chrome\";v=\"125\", \"Chromium\";v=\"125\", \"Not.A/Brand\";v=\"24\"") {
        headers.insert(reqwest::header::HeaderName::from_static("sec-ch-ua"), val);
    }
    headers.insert(
        reqwest::header::HeaderName::from_static("sec-ch-ua-mobile"),
        HeaderValue::from_static("?0"),
    );
    if let Ok(val) = HeaderValue::from_str("\"Windows\"") {
        headers.insert(reqwest::header::HeaderName::from_static("sec-ch-ua-platform"), val);
    }
    headers.insert(
        reqwest::header::HeaderName::from_static("upgrade-insecure-requests"),
        HeaderValue::from_static("1"),
    );
    headers.insert(
        reqwest::header::HeaderName::from_static("sec-fetch-dest"),
        HeaderValue::from_static("document"),
    );
    headers.insert(
        reqwest::header::HeaderName::from_static("sec-fetch-mode"),
        HeaderValue::from_static("navigate"),
    );
    headers.insert(
        reqwest::header::HeaderName::from_static("sec-fetch-site"),
        HeaderValue::from_static("none"),
    );
    headers.insert(
        reqwest::header::HeaderName::from_static("sec-fetch-user"),
        HeaderValue::from_static("?1"),
    );

    let resp = client.get(&url)
        .headers(headers)
        .send()
        .await
        .map_err(|e| format!("Failed to connect to page: {}", e))?;

    let html = resp.text()
        .await
        .map_err(|e| format!("Failed to read page content: {}", e))?;

    let cleaned_html = if read_search_settings().web_search_clean_pages {
        strip_layout_blocks_from_html(&html)
    } else {
        html
    };

    let text = strip_html_tags(&cleaned_html);
    
    let char_count = text.chars().count();
    if char_count > 100000 {
        let truncated: String = text.chars().take(100000).collect();
        Ok(format!("{}... [TRUNCATED]", truncated))
    } else {
        Ok(text)
    }
}

// ─── App Entry ──────────────────────────────────────────────────────

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .manage(ServerShared::new())
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
            save_genai_history,
            load_genai_history,
            save_game_state,
            load_game_state,
            save_group_state,
            load_group_state,
            save_group_sessions,
            load_group_sessions,
            delete_group_sessions,
            load_skills,
            save_skill,
            delete_skill,
            open_skills_folder,
            save_credential,
            load_credential,
            nhentai_request,
            nhentai_fetch_image_base64,
            gelbooru_request,
            gelbooru_fetch_image_base64,
            fetch_image_base64,
            web_search,
            web_fetch,
            start_host_server,
            stop_host_server,
            get_host_server_status,
            discover_hosts,
            client_http_request,
            client_relay_stream,
            cancel_client_relay,
            save_genai_memories,
            load_genai_memories,
            get_allowed_devices,
            set_device_auth_status,
            remove_allowed_device
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
