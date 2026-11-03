use chrono::Local;
use serde::{Deserialize, Serialize};
use std::fs;
use std::path::PathBuf;
use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::sync::{Mutex, OnceLock};
use std::time::{Duration, Instant, SystemTime, UNIX_EPOCH};
use tauri::menu::{Menu, MenuItem};
use tauri::tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent};
use tauri::{AppHandle, LogicalSize, Manager, WebviewUrl, WebviewWindow, WebviewWindowBuilder};
use tauri_plugin_global_shortcut::{GlobalShortcutExt, Shortcut, ShortcutState};
use tauri_plugin_opener::OpenerExt;
use base64::prelude::*;

const EMBEDDED_SETTING_JSON: &str = include_str!("../assets/avatars/setting.json");
const EMBEDDED_QUOTES_JSON: &str = include_str!("../assets/avatars/plugin/quotes.json");

#[derive(Serialize, Deserialize, Clone, Debug)]
pub struct PluginVideoItem {
    pub name: String,
    pub data_url: String,
}

#[derive(Serialize, Deserialize, Clone, Debug)]
pub struct PluginConfigsPayload {
    pub setting: serde_json::Value,
    pub quotes: serde_json::Value,
}

#[derive(Serialize, Deserialize, Clone, Debug)]
pub struct AvatarVideoPack {
    pub idle: String,
    pub waking: String,
    pub working: String,
    pub making_something: String,
    pub milestone_level_up: String,
    pub plugins: Vec<PluginVideoItem>,
    pub setting: serde_json::Value,
    pub quotes: serde_json::Value,
}

static NONCE_COUNTER: AtomicU64 = AtomicU64::new(1);
static CURRENT_DOC_TITLE: OnceLock<Mutex<String>> = OnceLock::new();
static BRIDGE_BUSY: AtomicBool = AtomicBool::new(false);

fn doc_title_store() -> &'static Mutex<String> {
    CURRENT_DOC_TITLE.get_or_init(|| Mutex::new(String::new()))
}

fn get_latest_doc_title() -> Option<String> {
    doc_title_store().lock().ok().map(|s| s.clone())
}

struct BridgeLockGuard;
impl Drop for BridgeLockGuard {
    fn drop(&mut self) {
        BRIDGE_BUSY.store(false, Ordering::Release);
    }
}

async fn acquire_bridge_lock() -> BridgeLockGuard {
    while BRIDGE_BUSY
        .compare_exchange(false, true, Ordering::Acquire, Ordering::Relaxed)
        .is_err()
    {
        tokio::time::sleep(Duration::from_millis(25)).await;
    }
    BridgeLockGuard
}

const USER_AGENT: &str = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36 Edg/131.0.0.0";
const SESSION_URL: &str = "https://muse.ai/?__pwa=1";
const BROWSER_URL: &str = "https://muse.ai";

const SMALL_WIDTH: f64 = 360.0;
const SMALL_HEIGHT: f64 = 580.0;
const LARGE_WIDTH: f64 = 1024.0;
const LARGE_HEIGHT: f64 = 768.0;
const MASCOT_WIDTH: f64 = 620.0;
const MASCOT_HEIGHT: f64 = 260.0;

static SESSION_BRIDGE_JS: &str = include_str!("session_bridge.js");

#[derive(Serialize, Deserialize, Clone, Debug)]
pub struct ChatMessage {
    pub role: String, // "user" or "assistant"
    pub text: String,
}

#[derive(Serialize, Deserialize, Clone, Debug)]
pub struct UsageLimitInfo {
    pub plan_name: String,
    pub used_percent: Option<u32>,
    pub remaining_percent: Option<u32>,
    pub reset_text: String,
    pub updated_at: String,
}

fn default_avatar_name() -> String {
    "ラッキー".to_string()
}

fn default_last_normal_mode() -> String {
    "small".to_string()
}

#[derive(Serialize, Deserialize, Clone, Debug)]
pub struct GadgetConfig {
    pub size_mode: String, // "small", "large", or "mascot"
    #[serde(default = "default_last_normal_mode")]
    pub last_normal_mode: String, // "small" or "large"
    pub message_limit: usize,
    pub hotkey: String,
    #[serde(default = "default_avatar_name")]
    pub avatar_name: String,
    pub last_limit_info: Option<UsageLimitInfo>,
    #[serde(default)]
    pub small_pos: Option<(i32, i32)>,
    #[serde(default)]
    pub large_pos: Option<(i32, i32)>,
    #[serde(default)]
    pub mascot_pos: Option<(i32, i32)>,
}

impl Default for GadgetConfig {
    fn default() -> Self {
        Self {
            size_mode: "mascot".to_string(),
            last_normal_mode: "small".to_string(),
            message_limit: 5,
            hotkey: "Ctrl+Shift+M".to_string(),
            avatar_name: default_avatar_name(),
            last_limit_info: None,
            small_pos: None,
            large_pos: None,
            mascot_pos: None,
        }
    }
}

#[derive(Serialize, Deserialize, Debug, Clone)]
pub struct SessionStatus {
    pub exists: bool,
    pub visible: bool,
    pub title: Option<String>,
    pub url: Option<String>,
}

fn get_config_path(app: &AppHandle) -> Result<PathBuf, String> {
    let dir = app
        .path()
        .app_local_data_dir()
        .map_err(|e| format!("Path error: {}", e))?;
    fs::create_dir_all(&dir).map_err(|e| format!("Create dir error: {}", e))?;
    Ok(dir.join("gadget_config.json"))
}

fn get_avatar_cache_path(app: &AppHandle) -> Result<PathBuf, String> {
    let dir = app
        .path()
        .app_local_data_dir()
        .map_err(|e| format!("Path error: {}", e))?;
    fs::create_dir_all(&dir).map_err(|e| format!("Create dir error: {}", e))?;
    Ok(dir.join("avatar_cache.txt"))
}

fn load_config_internal(app: &AppHandle) -> GadgetConfig {
    if let Ok(path) = get_config_path(app) {
        if let Ok(content) = fs::read_to_string(path) {
            if let Ok(cfg) = serde_json::from_str::<GadgetConfig>(&content) {
                return cfg;
            }
        }
    }
    GadgetConfig::default()
}

fn save_config_internal(app: &AppHandle, config: &GadgetConfig) -> Result<(), String> {
    let path = get_config_path(app)?;
    let content = serde_json::to_string_pretty(config).map_err(|e| e.to_string())?;
    fs::write(path, content).map_err(|e| format!("Save config error: {}", e))?;
    Ok(())
}

fn ensure_session_window(app: &AppHandle) -> Result<WebviewWindow, String> {
    if let Some(win) = app.get_webview_window("session") {
        return Ok(win);
    }

    let url = SESSION_URL
        .parse::<tauri::Url>()
        .map_err(|e| format!("URL parse error: {}", e))?;

    let mut builder = WebviewWindowBuilder::new(app, "session", WebviewUrl::External(url))
        .title("Muse AI - Session")
        .inner_size(1024.0, 768.0)
        .visible(false)
        .on_document_title_changed(|_win, title| {
            if let Ok(mut t) = doc_title_store().lock() {
                *t = title;
            }
        });

    // アプリ専用データディレクトリで Cookie / ログインセッションを永続化
    if let Ok(data_dir) = app.path().app_local_data_dir() {
        let session_data_dir = data_dir.join("webview2_session");
        builder = builder.data_directory(session_data_dir);
    }

    // Google OAuth 対策の最新 Chrome / Edge User-Agent
    builder = builder.user_agent(USER_AGENT);

    // ページロード毎に session_bridge.js を初期化スクリプトとして注入
    builder = builder.initialization_script(SESSION_BRIDGE_JS);

    let window = builder
        .build()
        .map_err(|e| format!("Failed to build session window: {}", e))?;

    let _ = window.set_icon(tauri::include_image!("icons/128x128.png"));

    // セッション画面の「×」や最小化ボタン（Win+M含む）でマスコットモードへ移行
    let handle_for_session = app.clone();
    window.on_window_event(move |event| {
        match event {
            tauri::WindowEvent::CloseRequested { api, .. } => {
                api.prevent_close();
                let h = handle_for_session.clone();
                tauri::async_runtime::spawn(async move {
                    let _ = hide_session(h).await;
                });
            }
            tauri::WindowEvent::Resized(size) => {
                // Windows で最小化された場合、内部サイズが 0x0 になる
                if size.width == 0 && size.height == 0 {
                    let h = handle_for_session.clone();
                    tauri::async_runtime::spawn(async move {
                        let _ = hide_session(h).await;
                    });
                }
            }
            tauri::WindowEvent::Focused(false) => {
                // 最小化ボタンや Win+M でフォーカスが外れ、かつ最小化状態の場合
                let h = handle_for_session.clone();
                tauri::async_runtime::spawn(async move {
                    if let Some(s) = h.get_webview_window("session") {
                        if s.is_minimized().unwrap_or(false) {
                            let _ = hide_session(h).await;
                        }
                    }
                });
            }
            _ => {}
        }
    });

    Ok(window)
}

fn parse_bridge_payload(val: serde_json::Value) -> Result<serde_json::Value, String> {
    if val.get("ok").and_then(|v| v.as_bool()).unwrap_or(false) {
        Ok(val.get("data").cloned().unwrap_or(serde_json::Value::Null))
    } else {
        let err_msg = val
            .get("error")
            .and_then(|v| v.as_str())
            .unwrap_or("Unknown script error");
        Err(err_msg.to_string())
    }
}

async fn run_bridge_action(
    session: &WebviewWindow,
    action: &str,
    args: &serde_json::Value,
    timeout_ms: u64,
) -> Result<serde_json::Value, String> {
    let _lock = acquire_bridge_lock().await;

    // ブリッジスクリプトが未ロードなら念のため注入
    let ensure_js = format!(
        "if (!window.__MUSE_BRIDGE__) {{ {} }}",
        SESSION_BRIDGE_JS
    );
    let _ = session.eval(&ensure_js);

    let nonce = format!(
        "{}_{}",
        SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap_or_default()
            .as_millis(),
        NONCE_COUNTER.fetch_add(1, Ordering::Relaxed)
    );

    let exec_js = format!(
        "window.__MUSE_BRIDGE__.executeAction('{}', {}, '{}');",
        action,
        args.to_string(),
        nonce
    );

    session
        .eval(&exec_js)
        .map_err(|e| format!("Session eval failed: {}", e))?;

    let timeout = Duration::from_millis(timeout_ms);
    let interval = Duration::from_millis(25);
    let start = Instant::now();

    let res_prefix = format!("__MUSE_RES__:{}:", nonce);
    let ready_prefix = format!("__MUSE_CHUNK_READY__:{}:", nonce);

    while start.elapsed() < timeout {
        tokio::time::sleep(interval).await;
        if let Some(title) = get_latest_doc_title() {
            // ケース1: 1チャンクで即座に完了
            if let Some(encoded) = title.strip_prefix(&res_prefix) {
                let decoded = urlencoding::decode(encoded)
                    .map_err(|e| format!("Decode error: {}", e))?;
                let val: serde_json::Value = serde_json::from_str(&decoded)
                    .map_err(|e| format!("JSON parse error: {}", e))?;
                let _ = session.eval(&format!("window.__MUSE_BRIDGE__.cleanup('{}');", nonce));
                return parse_bridge_payload(val);
            }

            // ケース2: チャンク分割ハンドシェイク Pull（アバター動画 Base64 等の大容量通信）
            if let Some(total_str) = title.strip_prefix(&ready_prefix) {
                let total_chunks: usize = total_str
                    .trim()
                    .parse()
                    .map_err(|e| format!("Parse total chunks error: {}", e))?;
                let mut full_encoded = String::new();

                for idx in 0..total_chunks {
                    let req_js = format!("window.__MUSE_BRIDGE__.serveChunk('{}', {});", nonce, idx);
                    session
                        .eval(&req_js)
                        .map_err(|e| format!("Eval chunk request failed: {}", e))?;

                    let chunk_prefix = format!("__MUSE_CHUNK__:{}:{}:", nonce, idx);
                    let chunk_start = Instant::now();
                    let mut got_chunk = false;

                    while chunk_start.elapsed() < Duration::from_millis(4000) {
                        tokio::time::sleep(Duration::from_millis(12)).await;
                        if let Some(t) = get_latest_doc_title() {
                            if let Some(chunk_data) = t.strip_prefix(&chunk_prefix) {
                                if chunk_data == "ERROR_NO_DATA" {
                                    return Err("Chunk server error: no data".to_string());
                                }
                                full_encoded.push_str(chunk_data);
                                got_chunk = true;
                                break;
                            }
                        }
                    }

                    if !got_chunk {
                        return Err(format!(
                            "Timed out waiting for chunk {} of {}",
                            idx + 1,
                            total_chunks
                        ));
                    }
                }

                let decoded = urlencoding::decode(&full_encoded)
                    .map_err(|e| format!("Full decode error: {}", e))?;
                let val: serde_json::Value = serde_json::from_str(&decoded)
                    .map_err(|e| format!("Full JSON parse error: {}", e))?;
                let _ = session.eval(&format!("window.__MUSE_BRIDGE__.cleanup('{}');", nonce));
                return parse_bridge_payload(val);
            }
        }
    }

    Err(format!(
        "Action '{}' timed out after {}ms waiting for bridge response",
        action, timeout_ms
    ))
}

// ==========================================
// Tauri コマンド群
// ==========================================

fn collect_avatar_dirs(app: &AppHandle) -> Vec<PathBuf> {
    let mut avatar_dirs: Vec<PathBuf> = Vec::new();

    // 1. プロジェクト内の src-tauri/assets/avatars (開発・ローカル差し替え最優先)
    let manifest_avatars = PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .join("assets")
        .join("avatars");
    if manifest_avatars.exists() {
        avatar_dirs.push(manifest_avatars);
    }

    // 2. 実行ファイルと同じ階層の avatars フォルダ (ポータブル配布対応)
    if let Ok(exe_path) = std::env::current_exe() {
        if let Some(exe_dir) = exe_path.parent() {
            let exe_avatars = exe_dir.join("avatars");
            if exe_avatars.exists() {
                avatar_dirs.push(exe_avatars);
            }
        }
    }

    // 3. %LOCALAPPDATA%\works.mowthow.muse.gadgets\avatars
    if let Ok(local_dir) = app.path().app_local_data_dir() {
        let appdata_avatars = local_dir.join("avatars");
        if appdata_avatars.exists() {
            avatar_dirs.push(appdata_avatars);
        }
    }

    avatar_dirs
}

fn load_plugin_configs_internal(app: &AppHandle) -> PluginConfigsPayload {
    let avatar_dirs = collect_avatar_dirs(app);
    let mut setting_val: serde_json::Value =
        serde_json::from_str(EMBEDDED_SETTING_JSON).unwrap_or_else(|_| serde_json::json!({}));
    let mut quotes_val: serde_json::Value =
        serde_json::from_str(EMBEDDED_QUOTES_JSON).unwrap_or_else(|_| serde_json::json!({}));

    let plugin_dir_opt = avatar_dirs
        .iter()
        .map(|d| d.join("plugin"))
        .find(|p| p.exists() && p.is_dir());

    // setting.json の探索 (avatars/setting.json -> plugin/setting.json -> プロジェクトルート/setting.json)
    let mut setting_candidates: Vec<PathBuf> = Vec::new();
    for d in &avatar_dirs {
        setting_candidates.push(d.join("setting.json"));
    }
    if let Some(ref pdir) = plugin_dir_opt {
        setting_candidates.push(pdir.join("setting.json"));
    }
    if let Some(proj_root) = PathBuf::from(env!("CARGO_MANIFEST_DIR")).parent() {
        setting_candidates.push(proj_root.join("setting.json"));
    }

    for sp in setting_candidates {
        if sp.exists() {
            if let Ok(txt) = fs::read_to_string(&sp) {
                if let Ok(parsed) = serde_json::from_str::<serde_json::Value>(&txt) {
                    setting_val = parsed;
                    break;
                }
            }
        }
    }

    // quotes.json の探索
    if let Some(ref pdir) = plugin_dir_opt {
        let quotes_path = pdir.join("quotes.json");
        if quotes_path.exists() {
            if let Ok(txt) = fs::read_to_string(&quotes_path) {
                if let Ok(parsed) = serde_json::from_str::<serde_json::Value>(&txt) {
                    quotes_val = parsed;
                }
            }
        }
    }

    PluginConfigsPayload {
        setting: setting_val,
        quotes: quotes_val,
    }
}

#[tauri::command]
fn get_plugin_configs(app: AppHandle) -> Result<PluginConfigsPayload, String> {
    Ok(load_plugin_configs_internal(&app))
}

#[tauri::command]
fn get_avatar_video_pack(app: AppHandle) -> Result<AvatarVideoPack, String> {
    let avatar_dirs = collect_avatar_dirs(&app);

    let load_one_opt = |name: &str| -> Option<String> {
        for dir in &avatar_dirs {
            let file_path = dir.join(name);
            if file_path.exists() {
                if let Ok(bytes) = fs::read(&file_path) {
                    if !bytes.is_empty() {
                        return Some(format!("data:video/mp4;base64,{}", BASE64_STANDARD.encode(&bytes)));
                    }
                }
            }
        }
        None
    };

    let idle = load_one_opt("idle.mp4").unwrap_or_default();
    let waking = load_one_opt("waking.mp4").unwrap_or_else(|| idle.clone());
    let working = load_one_opt("working.mp4").unwrap_or_else(|| idle.clone());
    let making_something = load_one_opt("making_something.mp4").unwrap_or_else(|| working.clone());
    let milestone_level_up = load_one_opt("milestone_level_up.mp4").unwrap_or_else(|| idle.clone());

    let configs = load_plugin_configs_internal(&app);
    let mut plugins: Vec<PluginVideoItem> = Vec::new();

    let plugin_dir_opt = avatar_dirs
        .iter()
        .map(|d| d.join("plugin"))
        .find(|p| p.exists() && p.is_dir());

    if let Some(plugin_dir) = plugin_dir_opt {
        if let Ok(entries) = fs::read_dir(&plugin_dir) {
            let mut mp4_paths: Vec<PathBuf> = entries
                .filter_map(|e| e.ok().map(|de| de.path()))
                .filter(|p| {
                    p.is_file()
                        && p.extension()
                            .and_then(|ext| ext.to_str())
                            .map(|ext| ext.eq_ignore_ascii_case("mp4"))
                            .unwrap_or(false)
                })
                .collect();
            mp4_paths.sort();

            for path in mp4_paths {
                let Some(file_name) = path.file_name().and_then(|n| n.to_str()).map(|s| s.to_string()) else {
                    continue;
                };

                if let Ok(bytes) = fs::read(&path) {
                    if !bytes.is_empty() {
                        let data_url =
                            format!("data:video/mp4;base64,{}", BASE64_STANDARD.encode(&bytes));

                        plugins.push(PluginVideoItem {
                            name: file_name,
                            data_url,
                        });
                    }
                }
            }
        }
    }

    Ok(AvatarVideoPack {
        idle,
        waking,
        working,
        making_something,
        milestone_level_up,
        plugins,
        setting: configs.setting,
        quotes: configs.quotes,
    })
}

#[tauri::command]
async fn get_avatar_data_url(
    app: AppHandle,
    force_refresh: Option<bool>,
) -> Result<String, String> {
    let cache_path = get_avatar_cache_path(&app)?;
    let force = force_refresh.unwrap_or(false);

    if !force && cache_path.exists() {
        if let Ok(content) = fs::read_to_string(&cache_path) {
            let trimmed = content.trim();
            if trimmed.starts_with("data:video/") {
                return Ok(trimmed.to_string());
            }
        }
    }

    // セッションからアバター動画 Base64 を取得
    let session = ensure_session_window(&app)?;
    let res = run_bridge_action(&session, "get_avatar", &serde_json::json!({}), 30000).await?;

    let data_url = res
        .as_str()
        .ok_or_else(|| "Avatar result is not a string".to_string())?;

    if data_url.starts_with("data:video/") {
        let _ = fs::write(&cache_path, data_url);
        Ok(data_url.to_string())
    } else {
        Err("Invalid avatar data URL received".to_string())
    }
}

#[tauri::command]
async fn get_chat_messages(
    app: AppHandle,
    limit: Option<usize>,
) -> Result<Vec<ChatMessage>, String> {
    let session = ensure_session_window(&app)?;
    let msg_limit = limit.unwrap_or(5);
    let res = run_bridge_action(
        &session,
        "get_messages",
        &serde_json::json!({ "limit": msg_limit }),
        8000,
    )
    .await?;

    let messages: Vec<ChatMessage> = serde_json::from_value(res)
        .map_err(|e| format!("Failed to parse chat messages: {}", e))?;
    Ok(messages)
}

#[tauri::command]
async fn inspect_latest_message(app: AppHandle) -> Result<serde_json::Value, String> {
    let session = ensure_session_window(&app)?;
    let res = run_bridge_action(&session, "inspect_latest", &serde_json::json!({}), 20000).await;
    match res {
        Ok(val) => {
            if let Ok(dir) = app.path().app_local_data_dir() {
                let dump_path = dir.join("latest_inspect.json");
                let _ = fs::write(&dump_path, serde_json::to_string_pretty(&val).unwrap_or_default());
            }
            Ok(val)
        }
        Err(e) => {
            if let Ok(dir) = app.path().app_local_data_dir() {
                let dump_path = dir.join("latest_inspect_error.txt");
                let _ = fs::write(&dump_path, format!("inspect_latest error: {}", e));
            }
            Err(e)
        }
    }
}

#[tauri::command]
async fn send_chat_message(
    app: AppHandle,
    text: String,
) -> Result<serde_json::Value, String> {
    let session = ensure_session_window(&app)?;
    run_bridge_action(
        &session,
        "send_message",
        &serde_json::json!({ "text": text }),
        8000,
    )
    .await
}

#[tauri::command]
async fn get_usage_limit(
    app: AppHandle,
    force_refresh: Option<bool>,
) -> Result<UsageLimitInfo, String> {
    let force = force_refresh.unwrap_or(false);
    let mut config = load_config_internal(&app);

    if !force {
        if let Some(info) = &mut config.last_limit_info {
            if info.used_percent.is_some() {
                let mut need_save = false;
                if info.reset_text.contains("mp4") || info.reset_text.contains("KB") {
                    info.reset_text = "1週間の上限は11月6日にリセットされます".to_string();
                    need_save = true;
                }
                let out = info.clone();
                if need_save {
                    let _ = save_config_internal(&app, &config);
                }
                return Ok(out);
            }
        }
    }

    let session = ensure_session_window(&app)?;
    // §16 ガードレール①: session WebView が可視状態（フルUI表示中）のときは自動画面遷移を抑止
    let is_session_visible = session.is_visible().unwrap_or(false);
    let res = run_bridge_action(
        &session,
        "fetch_limit",
        &serde_json::json!({ "passiveOnly": is_session_visible }),
        12000,
    )
    .await?;

    let plan_name = res
        .get("plan_name")
        .and_then(|v| v.as_str())
        .unwrap_or("無料プラン")
        .to_string();

    let used_percent = res
        .get("used_percent")
        .and_then(|v| v.as_u64())
        .map(|v| v as u32);

    let remaining_percent = res
        .get("remaining_percent")
        .and_then(|v| v.as_u64())
        .map(|v| v as u32);

    let reset_text = res
        .get("reset_text")
        .and_then(|v| v.as_str())
        .unwrap_or("")
        .to_string();

    let now_str = Local::now().format("%Y-%m-%d %H:%M").to_string();

    let info = UsageLimitInfo {
        plan_name,
        used_percent,
        remaining_percent,
        reset_text,
        updated_at: now_str,
    };

    if info.used_percent.is_some() {
        config.last_limit_info = Some(info.clone());
        let _ = save_config_internal(&app, &config);
        return Ok(info);
    }

    if let Some(prev) = &mut config.last_limit_info {
        if prev.used_percent.is_some() {
            let mut need_save = false;
            if prev.reset_text.contains("mp4") || prev.reset_text.contains("KB") {
                prev.reset_text = "1週間の上限は11月6日にリセットされます".to_string();
                need_save = true;
            }
            let out = prev.clone();
            if need_save {
                let _ = save_config_internal(&app, &config);
            }
            return Ok(out);
        }
    }

    Ok(info)
}

#[tauri::command]
async fn get_avatar_state(app: AppHandle) -> Result<serde_json::Value, String> {
    let session = ensure_session_window(&app)?;
    run_bridge_action(&session, "get_avatar_state", &serde_json::json!({}), 4000).await
}

#[tauri::command]
async fn check_bridge_health(app: AppHandle) -> Result<serde_json::Value, String> {
    let session = ensure_session_window(&app)?;
    let res = run_bridge_action(&session, "check_health", &serde_json::json!({}), 6000).await?;
    if let Some(name) = res.get("avatar_name").and_then(|v| v.as_str()) {
        let trimmed = name.trim();
        if !trimmed.is_empty() {
            let mut config = load_config_internal(&app);
            if config.avatar_name != trimmed {
                config.avatar_name = trimmed.to_string();
                let _ = save_config_internal(&app, &config);
            }
        }
    }
    Ok(res)
}

#[tauri::command]
fn get_gadget_config(app: AppHandle) -> Result<GadgetConfig, String> {
    Ok(load_config_internal(&app))
}

#[tauri::command]
fn save_gadget_config(app: AppHandle, config: GadgetConfig) -> Result<(), String> {
    save_config_internal(&app, &config)
}

fn get_mascot_default_position(win: &WebviewWindow) -> (i32, i32) {
    if let Ok(Some(monitor)) = win.current_monitor() {
        let mon_pos = monitor.position();
        let mon_size = monitor.size();
        let scale = monitor.scale_factor();
        let win_w = (MASCOT_WIDTH * scale) as i32;
        let win_h = (MASCOT_HEIGHT * scale) as i32;
        // デスクトップ右下隅（タスクバーの上マージン約 56px、右端マージン約 20px）
        let x = mon_pos.x + (mon_size.width as i32) - win_w - 20;
        let y = mon_pos.y + (mon_size.height as i32) - win_h - 56;
        (x, y)
    } else {
        (100, 100)
    }
}

fn clamp_window_to_monitor(win: &WebviewWindow, target_pos: Option<(i32, i32)>) {
    let Ok(Some(monitor)) = win.current_monitor() else {
        if let Some((x, y)) = target_pos {
            let _ = win.set_position(tauri::PhysicalPosition::new(x, y));
        }
        return;
    };
    let mon_pos = monitor.position();
    let mon_size = monitor.size();
    let win_size = win.outer_size().unwrap_or(tauri::PhysicalSize::new(360, 580));

    let (mut x, mut y) = target_pos.unwrap_or_else(|| {
        let cur = win.outer_position().unwrap_or(tauri::PhysicalPosition::new(mon_pos.x + 60, mon_pos.y + 60));
        (cur.x, cur.y)
    });

    let max_x = mon_pos.x + (mon_size.width as i32) - (win_size.width as i32) - 12;
    let max_y = mon_pos.y + (mon_size.height as i32) - (win_size.height as i32) - 48;
    let min_x = mon_pos.x + 12;
    let min_y = mon_pos.y + 12;

    if x > max_x { x = max_x; }
    if x < min_x { x = min_x; }
    if y > max_y { y = max_y; }
    if y < min_y { y = min_y; }

    let _ = win.set_position(tauri::PhysicalPosition::new(x, y));
}

#[tauri::command]
async fn toggle_size_mode(app: AppHandle) -> Result<String, String> {
    let mut config = load_config_internal(&app);
    let prev_mode = config.size_mode.clone();
    
    // もし現在 mascot なら直前の通常モードへ復元
    if prev_mode == "mascot" {
        return restore_from_mascot(app).await;
    }

    let next_mode = if prev_mode == "small" {
        "large".to_string()
    } else {
        "small".to_string()
    };

    if let Some(win) = app.get_webview_window("main") {
        if let Ok(cur_pos) = win.outer_position() {
            if prev_mode == "small" {
                config.small_pos = Some((cur_pos.x, cur_pos.y));
            } else if prev_mode == "large" {
                config.large_pos = Some((cur_pos.x, cur_pos.y));
            }
        }

        let (w, h) = if next_mode == "large" {
            (LARGE_WIDTH, LARGE_HEIGHT)
        } else {
            (SMALL_WIDTH, SMALL_HEIGHT)
        };
        let _ = win.set_size(LogicalSize::new(w, h));

        let saved_target = if next_mode == "large" {
            config.large_pos
        } else {
            config.small_pos
        };
        clamp_window_to_monitor(&win, saved_target);
    }

    config.size_mode = next_mode.clone();
    config.last_normal_mode = next_mode.clone();
    let _ = save_config_internal(&app, &config);

    Ok(next_mode)
}

#[tauri::command]
async fn enter_mascot_mode(app: AppHandle) -> Result<String, String> {
    let mut config = load_config_internal(&app);
    let prev_mode = config.size_mode.clone();

    if prev_mode != "mascot" {
        config.last_normal_mode = prev_mode.clone();
    }

    if let Some(win) = app.get_webview_window("main") {
        if let Ok(cur_pos) = win.outer_position() {
            if prev_mode == "small" {
                config.small_pos = Some((cur_pos.x, cur_pos.y));
            } else if prev_mode == "large" {
                config.large_pos = Some((cur_pos.x, cur_pos.y));
            }
        }

        let _ = win.set_size(LogicalSize::new(MASCOT_WIDTH, MASCOT_HEIGHT));
        let target_pos = config.mascot_pos.or_else(|| Some(get_mascot_default_position(&win)));
        clamp_window_to_monitor(&win, target_pos);
    }

    config.size_mode = "mascot".to_string();
    let _ = save_config_internal(&app, &config);

    Ok("mascot".to_string())
}

#[tauri::command]
async fn save_current_window_position(app: AppHandle) -> Result<(), String> {
    let mut config = load_config_internal(&app);
    if let Some(win) = app.get_webview_window("main") {
        if let Ok(pos) = win.outer_position() {
            if config.size_mode == "mascot" {
                config.mascot_pos = Some((pos.x, pos.y));
            } else if config.size_mode == "large" {
                config.large_pos = Some((pos.x, pos.y));
            } else {
                config.small_pos = Some((pos.x, pos.y));
            }
            let _ = save_config_internal(&app, &config);
        }
    }
    Ok(())
}

#[tauri::command]
async fn restore_from_mascot(app: AppHandle) -> Result<String, String> {
    let mut config = load_config_internal(&app);
    let target_mode = if config.last_normal_mode == "large" {
        "large"
    } else {
        "small"
    };

    if let Some(win) = app.get_webview_window("main") {
        if let Ok(cur_pos) = win.outer_position() {
            if config.size_mode == "mascot" {
                config.mascot_pos = Some((cur_pos.x, cur_pos.y));
            }
        }

        let (w, h) = if target_mode == "large" {
            (LARGE_WIDTH, LARGE_HEIGHT)
        } else {
            (SMALL_WIDTH, SMALL_HEIGHT)
        };
        let _ = win.set_size(LogicalSize::new(w, h));

        let saved_target = if target_mode == "large" {
            config.large_pos
        } else {
            config.small_pos
        };
        clamp_window_to_monitor(&win, saved_target);
    }

    config.size_mode = target_mode.to_string();
    let _ = save_config_internal(&app, &config);

    Ok(target_mode.to_string())
}

#[tauri::command]
async fn open_in_browser(app: AppHandle) -> Result<(), String> {
    let _ = app.opener().open_url(BROWSER_URL, None::<&str>);
    Ok(())
}

#[tauri::command]
async fn open_or_show_session(app: AppHandle) -> Result<SessionStatus, String> {
    let session = ensure_session_window(&app)?;
    
    // セッション表示時はマスコットを非表示にする
    if let Some(main_win) = app.get_webview_window("main") {
        let _ = main_win.hide();
    }

    let _ = session.unminimize();
    let _ = session.show();
    let _ = session.set_focus();

    let title = session.title().ok();
    let url = session.url().ok().map(|u| u.to_string());
    Ok(SessionStatus {
        exists: true,
        visible: true,
        title,
        url,
    })
}

#[tauri::command]
async fn hide_session(app: AppHandle) -> Result<SessionStatus, String> {
    if let Some(session) = app.get_webview_window("session") {
        let _ = session.hide();
        let _ = session.unminimize();

        // セッション非表示時はマスコットモードを表示
        if let Some(main_win) = app.get_webview_window("main") {
            let _ = enter_mascot_mode(app.clone()).await;
            let _ = main_win.show();
            let _ = main_win.set_focus();
        }

        let title = session.title().ok();
        let url = session.url().ok().map(|u| u.to_string());
        Ok(SessionStatus {
            exists: true,
            visible: false,
            title,
            url,
        })
    } else {
        Ok(SessionStatus {
            exists: false,
            visible: false,
            title: None,
            url: None,
        })
    }
}

#[tauri::command]
async fn toggle_minimize_restore(app: AppHandle) -> Result<String, String> {
    let session = ensure_session_window(&app)?;
    let is_session_vis = session.is_visible().unwrap_or(false);

    if is_session_vis {
        let _ = hide_session(app).await;
        Ok("mascot".to_string())
    } else {
        let _ = open_or_show_session(app).await;
        Ok("session".to_string())
    }
}

#[tauri::command]
async fn open_session_devtools(app: AppHandle) -> Result<bool, String> {
    let session = ensure_session_window(&app)?;
    session.open_devtools();
    Ok(true)
}

#[tauri::command]
async fn get_session_status(app: AppHandle) -> Result<SessionStatus, String> {
    if let Some(session) = app.get_webview_window("session") {
        let visible = session.is_visible().unwrap_or(false);
        let title = session.title().ok();
        let url = session.url().ok().map(|u| u.to_string());
        Ok(SessionStatus {
            exists: true,
            visible,
            title,
            url,
        })
    } else {
        Ok(SessionStatus {
            exists: false,
            visible: false,
            title: None,
            url: None,
        })
    }
}

#[tauri::command]
fn drag_window(window: tauri::Window) {
    let _ = window.start_dragging();
}

#[tauri::command]
fn minimize_window(window: tauri::Window) {
    let _ = window.minimize();
}

#[tauri::command]
fn close_window(app: AppHandle) {
    app.exit(0);
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_global_shortcut::Builder::new().build())
        .setup(|app| {
            let handle = app.handle();

            // システムトレイの初期化
            let toggle_app = MenuItem::with_id(handle, "toggle_app", "セッション画面 ⇄ マスコット (Ctrl+Shift+M)", true, None::<&str>)?;
            let open_session = MenuItem::with_id(handle, "open_session", "セッション画面を開く (公式UI)", true, None::<&str>)?;
            let open_devtools = MenuItem::with_id(handle, "open_devtools", "セッションの開発者ツールを開く", true, None::<&str>)?;
            let toggle_mascot = MenuItem::with_id(handle, "toggle_mascot", "マスコットモード (アバター単体)", true, None::<&str>)?;
            let toggle_size = MenuItem::with_id(handle, "toggle_size", "（旧）中・小画面切替", true, None::<&str>)?;
            let open_browser = MenuItem::with_id(handle, "open_browser", "ブラウザで Muse を開く", true, None::<&str>)?;
            let quit = MenuItem::with_id(handle, "quit", "終了", true, None::<&str>)?;

            let menu = Menu::with_items(
                handle,
                &[
                    &toggle_app,
                    &open_session,
                    &open_devtools,
                    &toggle_mascot,
                    &toggle_size,
                    &open_browser,
                    &quit,
                ],
            )?;

            let _tray = TrayIconBuilder::new()
                .icon(tauri::include_image!("icons/128x128.png"))
                .menu(&menu)
                .tooltip("Muse Desktop Mascot")
                .show_menu_on_left_click(false)
                .on_menu_event(|app, event| match event.id.as_ref() {
                    "toggle_app" => {
                        let app_clone = app.clone();
                        tauri::async_runtime::spawn(async move {
                            let _ = toggle_minimize_restore(app_clone).await;
                        });
                    }
                    "open_session" => {
                        let app_clone = app.clone();
                        tauri::async_runtime::spawn(async move {
                            let _ = open_or_show_session(app_clone).await;
                        });
                    }
                    "open_devtools" => {
                        let app_clone = app.clone();
                        tauri::async_runtime::spawn(async move {
                            let _ = open_session_devtools(app_clone).await;
                        });
                    }
                    "toggle_mascot" => {
                        let app_clone = app.clone();
                        tauri::async_runtime::spawn(async move {
                            let _ = hide_session(app_clone).await;
                        });
                    }
                    "toggle_size" => {
                        let app_clone = app.clone();
                        tauri::async_runtime::spawn(async move {
                            let _ = toggle_size_mode(app_clone).await;
                        });
                    }
                    "open_browser" => {
                        let app_clone = app.clone();
                        tauri::async_runtime::spawn(async move {
                            let _ = open_in_browser(app_clone).await;
                        });
                    }
                    "quit" => {
                        app.exit(0);
                    }
                    _ => {}
                })
                .on_tray_icon_event(|tray, event| {
                    if let TrayIconEvent::Click {
                        button: MouseButton::Left,
                        button_state: MouseButtonState::Up,
                        ..
                    } = event
                    {
                        let app = tray.app_handle().clone();
                        tauri::async_runtime::spawn(async move {
                            let _ = toggle_minimize_restore(app).await;
                        });
                    }
                })
                .build(handle)?;

            // グローバルホットキーの登録 (Ctrl+Shift+M): 最小化 / 元に戻す
            if let Ok(shortcut) = "Ctrl+Shift+M".parse::<Shortcut>() {
                let _ = app.global_shortcut().on_shortcut(shortcut, |app, _sc, event| {
                    if event.state() == ShortcutState::Pressed {
                        let app_clone = app.clone();
                        tauri::async_runtime::spawn(async move {
                            let _ = toggle_minimize_restore(app_clone).await;
                        });
                    }
                });
            }

            // 設定の初期サイズ・位置・アイコンをメインウィンドウに反映
            let config = load_config_internal(handle);
            if let Some(main_win) = app.get_webview_window("main") {
                let _ = main_win.set_icon(tauri::include_image!("icons/128x128.png"));
                let (w, h) = if config.size_mode == "large" {
                    (LARGE_WIDTH, LARGE_HEIGHT)
                } else if config.size_mode == "mascot" {
                    (MASCOT_WIDTH, MASCOT_HEIGHT)
                } else {
                    (SMALL_WIDTH, SMALL_HEIGHT)
                };
                let _ = main_win.set_size(LogicalSize::new(w, h));

                if config.size_mode == "mascot" {
                    let target_pos = config.mascot_pos.or_else(|| Some(get_mascot_default_position(&main_win)));
                    clamp_window_to_monitor(&main_win, target_pos);
                } else if config.size_mode == "large" {
                    clamp_window_to_monitor(&main_win, config.large_pos);
                } else {
                    clamp_window_to_monitor(&main_win, config.small_pos);
                }

                // ウィンドウ終了・移動イベント
                let app_handle_for_events = handle.clone();
                main_win.on_window_event(move |event| {
                    match event {
                        tauri::WindowEvent::CloseRequested { .. } | tauri::WindowEvent::Destroyed => {
                            // main ウィンドウが閉じられた場合はプロセスを残さず確実に完全終了
                            app_handle_for_events.exit(0);
                        }
                        tauri::WindowEvent::Moved(pos) => {
                            let mut cfg = load_config_internal(&app_handle_for_events);
                            if cfg.size_mode == "mascot" {
                                cfg.mascot_pos = Some((pos.x, pos.y));
                                let _ = save_config_internal(&app_handle_for_events, &cfg);
                            } else if cfg.size_mode == "large" {
                                cfg.large_pos = Some((pos.x, pos.y));
                                let _ = save_config_internal(&app_handle_for_events, &cfg);
                            } else if cfg.size_mode == "small" {
                                cfg.small_pos = Some((pos.x, pos.y));
                                let _ = save_config_internal(&app_handle_for_events, &cfg);
                            }
                        }
                        _ => {}
                    }
                });
            }

            // セッションウィンドウをバックグラウンドで先行初期化
            let _ = ensure_session_window(handle);

            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            check_bridge_health,
            get_avatar_data_url,
            get_avatar_video_pack,
            get_plugin_configs,
            get_avatar_state,
            get_chat_messages,
            inspect_latest_message,
            send_chat_message,
            get_usage_limit,
            get_gadget_config,
            save_gadget_config,
            toggle_size_mode,
            enter_mascot_mode,
            restore_from_mascot,
            toggle_minimize_restore,
            save_current_window_position,
            open_in_browser,
            open_or_show_session,
            hide_session,
            open_session_devtools,
            get_session_status,
            drag_window,
            minimize_window,
            close_window
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
