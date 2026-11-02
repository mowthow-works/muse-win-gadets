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

#[derive(Serialize, Deserialize, Clone, Debug)]
pub struct GadgetConfig {
    pub size_mode: String, // "small" or "large"
    pub message_limit: usize,
    pub hotkey: String,
    #[serde(default = "default_avatar_name")]
    pub avatar_name: String,
    pub last_limit_info: Option<UsageLimitInfo>,
    #[serde(default)]
    pub small_pos: Option<(i32, i32)>,
    #[serde(default)]
    pub large_pos: Option<(i32, i32)>,
}

impl Default for GadgetConfig {
    fn default() -> Self {
        Self {
            size_mode: "small".to_string(),
            message_limit: 5,
            hotkey: "Ctrl+Shift+M".to_string(),
            avatar_name: default_avatar_name(),
            last_limit_info: None,
            small_pos: None,
            large_pos: None,
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
    let next_mode = if prev_mode == "small" {
        "large".to_string()
    } else {
        "small".to_string()
    };

    if let Some(win) = app.get_webview_window("main") {
        if let Ok(cur_pos) = win.outer_position() {
            if prev_mode == "small" {
                config.small_pos = Some((cur_pos.x, cur_pos.y));
            } else {
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
    let _ = save_config_internal(&app, &config);

    Ok(next_mode)
}

#[tauri::command]
async fn open_in_browser(app: AppHandle) -> Result<(), String> {
    let _ = app.opener().open_url(BROWSER_URL, None::<&str>);
    Ok(())
}

#[tauri::command]
async fn open_or_show_session(app: AppHandle) -> Result<SessionStatus, String> {
    let session = ensure_session_window(&app)?;
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
fn close_window(window: tauri::Window) {
    let _ = window.close();
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_global_shortcut::Builder::new().build())
        .setup(|app| {
            let handle = app.handle();

            // システムトレイの初期化
            let toggle_main = MenuItem::with_id(handle, "toggle_main", "ガジェットを表示 / 非表示", true, None::<&str>)?;
            let toggle_size = MenuItem::with_id(handle, "toggle_size", "サイズ切替 (小 ⇄ 大)", true, None::<&str>)?;
            let open_session = MenuItem::with_id(handle, "open_session", "セッション画面を開く (公式UI / ログイン)", true, None::<&str>)?;
            let open_browser = MenuItem::with_id(handle, "open_browser", "ブラウザで Muse を開く", true, None::<&str>)?;
            let quit = MenuItem::with_id(handle, "quit", "終了", true, None::<&str>)?;

            let menu = Menu::with_items(
                handle,
                &[
                    &toggle_main,
                    &toggle_size,
                    &open_session,
                    &open_browser,
                    &quit,
                ],
            )?;

            let _tray = TrayIconBuilder::new()
                .menu(&menu)
                .show_menu_on_left_click(false)
                .on_menu_event(|app, event| match event.id.as_ref() {
                    "toggle_main" => {
                        if let Some(win) = app.get_webview_window("main") {
                            if win.is_visible().unwrap_or(false) {
                                let _ = win.hide();
                            } else {
                                let _ = win.show();
                                let _ = win.set_focus();
                            }
                        }
                    }
                    "toggle_size" => {
                        let app_clone = app.clone();
                        tauri::async_runtime::spawn(async move {
                            let _ = toggle_size_mode(app_clone).await;
                        });
                    }
                    "open_session" => {
                        let app_clone = app.clone();
                        tauri::async_runtime::spawn(async move {
                            let _ = open_or_show_session(app_clone).await;
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
                        let app = tray.app_handle();
                        if let Some(win) = app.get_webview_window("main") {
                            if win.is_visible().unwrap_or(false) {
                                let _ = win.hide();
                            } else {
                                let _ = win.show();
                                let _ = win.set_focus();
                            }
                        }
                    }
                })
                .build(handle)?;

            // グローバルホットキーの登録 (Ctrl+Shift+M)
            if let Ok(shortcut) = "Ctrl+Shift+M".parse::<Shortcut>() {
                let _ = app.global_shortcut().on_shortcut(shortcut, |app, _sc, event| {
                    if event.state() == ShortcutState::Pressed {
                        if let Some(win) = app.get_webview_window("main") {
                            if win.is_visible().unwrap_or(false) {
                                let _ = win.hide();
                            } else {
                                let _ = win.show();
                                let _ = win.set_focus();
                            }
                        }
                    }
                });
            }

            // 設定の初期サイズをメインウィンドウに反映
            let config = load_config_internal(handle);
            if let Some(main_win) = app.get_webview_window("main") {
                let (w, h) = if config.size_mode == "large" {
                    (LARGE_WIDTH, LARGE_HEIGHT)
                } else {
                    (SMALL_WIDTH, SMALL_HEIGHT)
                };
                let _ = main_win.set_size(LogicalSize::new(w, h));
            }

            // セッションウィンドウをバックグラウンドで先行初期化
            let _ = ensure_session_window(handle);

            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            check_bridge_health,
            get_avatar_data_url,
            get_chat_messages,
            send_chat_message,
            get_usage_limit,
            get_gadget_config,
            save_gadget_config,
            toggle_size_mode,
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
