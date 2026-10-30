// SPDX-License-Identifier: GPL-3.0-only
use std::collections::BTreeSet;
use std::path::Path;
use std::sync::Mutex;

use base64::engine::general_purpose::STANDARD as B64;
use base64::Engine;
use ed25519_dalek::{Signer, SigningKey};
use keyring::Entry;
use rand::rngs::OsRng;
use serde::{Deserialize, Serialize};
use tauri::menu::{Menu, MenuItem};
use tauri::tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent};
use tauri::{AppHandle, Emitter, Manager, State, Wry};
use tauri_plugin_deep_link::DeepLinkExt;
use tauri_plugin_opener::OpenerExt;

// These two mirror packages/contracts (PAIRING_SIGNATURE_PREFIX) and src/config.ts (DEEP_LINK_SCHEME).
// src/identity/prefix.test.ts fails if they drift.
const PAIRING_SIGNATURE_PREFIX: &str = "azeroth-pairing:v1:";
const DEEP_LINK_SCHEME: &str = "azeroth-journey";

const DEEP_LINK_EVENT: &str = "deep-link-urls";
const TRAY_PAUSE_EVENT: &str = "tray-toggle-pause";
/// The only site the companion will open in the system browser. Set `AZEROTH_WEB_URL` at build time for releases.
const WEBSITE_URL: &str = match option_env!("AZEROTH_WEB_URL") {
    Some(u) => u,
    None => "http://localhost:3000",
};
const KEYRING_SERVICE: &str = "com.azeroth.journey.desktop";
const KEY_PRIVATE: &str = "device-private-key";
const KEY_IDENTITY: &str = "device-identity";

/// Deep-link URLs that launched the app (cold start); the frontend takes them once it is ready.
struct LaunchUrls(Mutex<Vec<String>>);

/// Tray "Pause/Resume syncing" item, kept so its label follows the frontend's paused state.
struct PauseItem(MenuItem<Wry>);

#[derive(Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct StoredIdentity {
    device_id: String,
    device_token: String,
}

#[derive(Serialize)]
struct DiscoveredCharacter {
    name: String,
    realm: String,
}

fn entry(user: &str) -> Result<Entry, String> {
    Entry::new(KEYRING_SERVICE, user).map_err(|e| e.to_string())
}

/// `Ok(None)` when the entry does not exist.
fn read_secret(user: &str) -> Result<Option<String>, String> {
    match entry(user)?.get_password() {
        Ok(v) => Ok(Some(v)),
        Err(keyring::Error::NoEntry) => Ok(None),
        Err(e) => Err(e.to_string()),
    }
}

fn delete_secret(user: &str) -> Result<(), String> {
    match entry(user)?.delete_credential() {
        Ok(()) | Err(keyring::Error::NoEntry) => Ok(()),
        Err(e) => Err(e.to_string()),
    }
}

fn load_signing_key() -> Result<Option<SigningKey>, String> {
    let Some(b64) = read_secret(KEY_PRIVATE)? else { return Ok(None) };
    let bytes = B64.decode(b64).map_err(|e| e.to_string())?;
    let seed: [u8; 32] = bytes.try_into().map_err(|_| "stored device key is corrupt".to_string())?;
    Ok(Some(SigningKey::from_bytes(&seed)))
}

fn public_key_b64(key: &SigningKey) -> String {
    B64.encode(key.verifying_key().to_bytes())
}

/// Generates the Ed25519 keypair on first use. The private key never leaves the keychain / this process.
#[tauri::command]
fn ensure_device_key() -> Result<String, String> {
    if let Some(key) = load_signing_key()? {
        return Ok(public_key_b64(&key));
    }
    let key = SigningKey::generate(&mut OsRng);
    entry(KEY_PRIVATE)?
        .set_password(&B64.encode(key.to_bytes()))
        .map_err(|e| e.to_string())?;
    Ok(public_key_b64(&key))
}

#[tauri::command]
fn device_public_key() -> Result<Option<String>, String> {
    Ok(load_signing_key()?.map(|k| public_key_b64(&k)))
}

/// Signs a pairing message. Refuses anything that is not `PREFIX + XXXX-XXXX`, so the key cannot be used as a general signing oracle.
#[tauri::command]
fn sign_pairing(message: String) -> Result<String, String> {
    let code = message
        .strip_prefix(PAIRING_SIGNATURE_PREFIX)
        .ok_or("refusing to sign: message lacks the pairing prefix")?;
    let b = code.as_bytes();
    let shaped = b.len() == 9
        && b[4] == b'-'
        && b.iter().enumerate().all(|(i, c)| i == 4 || c.is_ascii_uppercase() || (i >= 5 && c.is_ascii_digit()));
    if !shaped {
        return Err("refusing to sign: malformed pairing code".into());
    }
    let key = load_signing_key()?.ok_or("no device key; create an account first")?;
    Ok(B64.encode(key.sign(message.as_bytes()).to_bytes()))
}

#[tauri::command]
fn save_identity(device_id: String, device_token: String) -> Result<(), String> {
    let json = serde_json::to_string(&StoredIdentity { device_id, device_token }).map_err(|e| e.to_string())?;
    entry(KEY_IDENTITY)?.set_password(&json).map_err(|e| e.to_string())
}

#[tauri::command]
fn load_identity() -> Result<Option<StoredIdentity>, String> {
    // An identity without its private key is unusable (keychain wiped); treat as no identity.
    if load_signing_key()?.is_none() {
        return Ok(None);
    }
    match read_secret(KEY_IDENTITY)? {
        Some(json) => Ok(serde_json::from_str(&json).ok()),
        None => Ok(None),
    }
}

#[tauri::command]
fn clear_identity() -> Result<(), String> {
    delete_secret(KEY_IDENTITY)?;
    delete_secret(KEY_PRIVATE)
}

#[tauri::command]
fn device_name() -> String {
    std::env::var("COMPUTERNAME")
        .or_else(|_| std::env::var("HOSTNAME"))
        .ok()
        .filter(|s| !s.trim().is_empty())
        .unwrap_or_else(|| "This computer".to_string())
}

#[tauri::command]
fn initial_deep_links(state: State<LaunchUrls>) -> Vec<String> {
    std::mem::take(&mut *state.0.lock().unwrap())
}

#[tauri::command]
fn default_wow_dir() -> Option<String> {
    [
        r"C:\Program Files (x86)\World of Warcraft\_retail_",
        r"C:\Program Files\World of Warcraft\_retail_",
        "/Applications/World of Warcraft/_retail_",
    ]
    .into_iter()
    .find(|p| Path::new(p).is_dir())
    .map(String::from)
}

/// Characters are the `WTF/Account/<ACCOUNT>/<Realm>/<Character>` folders WoW creates.
/// (The addon's SavedVariables file does not record character identity.)
#[tauri::command]
fn discover_characters(wow_dir: String) -> Result<Vec<DiscoveredCharacter>, String> {
    let accounts = Path::new(&wow_dir).join("WTF").join("Account");
    let dirs = |p: &Path| -> Vec<(String, std::path::PathBuf)> {
        std::fs::read_dir(p)
            .map(|rd| {
                rd.filter_map(|e| e.ok())
                    .filter(|e| e.path().is_dir())
                    .map(|e| (e.file_name().to_string_lossy().to_string(), e.path()))
                    .collect()
            })
            .unwrap_or_default()
    };
    if !accounts.is_dir() {
        return Err("no WTF/Account folder found".into());
    }
    let mut seen = BTreeSet::new();
    for (_, account) in dirs(&accounts) {
        for (realm, realm_path) in dirs(&account) {
            if realm == "SavedVariables" {
                continue;
            }
            for (name, _) in dirs(&realm_path) {
                seen.insert((realm.clone(), name));
            }
        }
    }
    Ok(seen.into_iter().map(|(realm, name)| DiscoveredCharacter { name, realm }).collect())
}

/// The addon's SavedVariables file name (`addon.name` in apps/addon/wowlua.json, plus `.lua`).
const SAVED_VARIABLES_FILE: &str = "AzerothJourney.lua";
/// A journal this big is not ours (or is corrupt); reading it whole would only stall the app.
const MAX_SAVED_VARIABLES_BYTES: u64 = 64 * 1024 * 1024;

/// Text of the addon's SavedVariables file for every WoW account under `<wow_dir>/WTF/Account/*/SavedVariables/`.
/// Missing files are normal (the addon has not run yet) and are skipped. The client only writes the file on
/// logout or /reload, so this is a snapshot of the last such moment. Parsing happens in the frontend.
#[tauri::command]
fn read_saved_variables(wow_dir: String) -> Result<Vec<String>, String> {
    let accounts = Path::new(&wow_dir).join("WTF").join("Account");
    let entries = std::fs::read_dir(&accounts).map_err(|e| format!("cannot read {}: {e}", accounts.display()))?;
    let mut out = Vec::new();
    for account in entries.filter_map(|e| e.ok()).filter(|e| e.path().is_dir()) {
        let file = account.path().join("SavedVariables").join(SAVED_VARIABLES_FILE);
        let Ok(meta) = std::fs::metadata(&file) else { continue };
        if !meta.is_file() || meta.len() > MAX_SAVED_VARIABLES_BYTES {
            continue;
        }
        let bytes = std::fs::read(&file).map_err(|e| format!("cannot read {}: {e}", file.display()))?;
        out.push(String::from_utf8_lossy(&bytes).into_owned());
    }
    Ok(out)
}

#[tauri::command]
fn website_url() -> &'static str {
    WEBSITE_URL
}

/// Opens the configured website (optionally a path on it) in the system browser. No arbitrary URLs.
#[tauri::command]
fn open_website(app: AppHandle, path: Option<String>) -> Result<(), String> {
    let path = path.unwrap_or_default();
    if !path.is_empty() && !path.starts_with('/') {
        return Err("path must start with /".into());
    }
    let url = format!("{}{}", WEBSITE_URL.trim_end_matches('/'), path);
    app.opener().open_url(url, None::<&str>).map_err(|e| e.to_string())
}

#[tauri::command]
fn set_paused(paused: bool, item: State<PauseItem>) -> Result<(), String> {
    item.0.set_text(if paused { "Resume syncing" } else { "Pause syncing" }).map_err(|e| e.to_string())
}

fn toggle_main(app: &AppHandle) {
    if let Some(w) = app.get_webview_window("main") {
        if w.is_visible().unwrap_or(false) && w.is_focused().unwrap_or(false) {
            let _ = w.hide();
        } else {
            focus_main(app);
        }
    }
}

fn build_tray(app: &tauri::App) -> tauri::Result<()> {
    let open = MenuItem::with_id(app, "open", "Open", true, None::<&str>)?;
    let pause = MenuItem::with_id(app, "pause", "Pause syncing", true, None::<&str>)?;
    let quit = MenuItem::with_id(app, "quit", "Quit", true, None::<&str>)?;
    let menu = Menu::with_items(app, &[&open, &pause, &quit])?;
    app.manage(PauseItem(pause));

    let mut tray = TrayIconBuilder::with_id("main")
        .tooltip("Azeroth Journey")
        .menu(&menu)
        .show_menu_on_left_click(false)
        .on_menu_event(|app, event| match event.id.as_ref() {
            "open" => focus_main(app),
            "pause" => {
                let _ = app.emit(TRAY_PAUSE_EVENT, ());
            }
            "quit" => app.exit(0),
            _ => {}
        })
        .on_tray_icon_event(|tray, event| {
            if let TrayIconEvent::Click { button: MouseButton::Left, button_state: MouseButtonState::Up, .. } = event {
                toggle_main(tray.app_handle());
            }
        });
    if let Some(icon) = app.default_window_icon() {
        tray = tray.icon(icon.clone());
    }
    tray.build(app)?;
    Ok(())
}

fn focus_main(app: &AppHandle) {
    if let Some(w) = app.get_webview_window("main") {
        if !w.is_visible().unwrap_or(true) {
            let _ = w.center(); // no tray-relative positioning; centered is good enough for now
        }
        let _ = w.unminimize();
        let _ = w.show();
        let _ = w.set_focus();
    }
}

/// Managed once the updater plugin is registered; tells the frontend whether this build can update itself.
struct UpdaterEnabled;

/// Release builds merge `plugins.updater` (public key + endpoint) from tauri.release.conf.json. Dev and plain
/// `cargo check` builds have none, and the plugin refuses to initialise without a key, so register it only when
/// the config exists.
fn register_updater(app: &tauri::App) {
    if !app.config().plugins.0.contains_key("updater") {
        eprintln!("updater: no plugins.updater config in this build; automatic updates are disabled");
        return;
    }
    match app.handle().plugin(tauri_plugin_updater::Builder::new().build()) {
        Ok(()) => {
            app.manage(UpdaterEnabled);
        }
        Err(e) => eprintln!("updater: could not initialise, updates disabled: {e}"),
    }
}

/// Lets the frontend hide the update UI in builds without an updater config.
#[tauri::command]
fn updates_enabled(app: AppHandle) -> bool {
    app.try_state::<UpdaterEnabled>().is_some()
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        // Must be registered first. With the `deep-link` feature it forwards a second launch's URL to the
        // running instance's deep-link handler, so we only need to bring the window forward here.
        .plugin(tauri_plugin_single_instance::init(|app, _argv, _cwd| focus_main(app)))
        .plugin(tauri_plugin_deep_link::init())
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_process::init())
        .on_window_event(|window, event| {
            // Closing hides to the tray; "Quit" in the tray menu exits.
            if let tauri::WindowEvent::CloseRequested { api, .. } = event {
                api.prevent_close();
                let _ = window.hide();
            }
        })
        .setup(|app| {
            build_tray(app)?;
            let launch = app
                .deep_link()
                .get_current()
                .ok()
                .flatten()
                .map(|urls| urls.iter().map(|u| u.to_string()).collect())
                .unwrap_or_default();
            app.manage(LaunchUrls(Mutex::new(launch)));

            let handle = app.handle().clone();
            app.deep_link().on_open_url(move |event| {
                let urls: Vec<String> = event
                    .urls()
                    .iter()
                    .map(|u| u.to_string())
                    .filter(|u| u.starts_with(&format!("{DEEP_LINK_SCHEME}://")))
                    .collect();
                if !urls.is_empty() {
                    let _ = handle.emit(DEEP_LINK_EVENT, urls);
                    focus_main(&handle);
                }
            });

            register_updater(app);

            // Installed builds register the scheme via the bundle; this makes `cargo tauri dev` work.
            #[cfg(all(debug_assertions, any(windows, target_os = "linux")))]
            app.deep_link().register_all()?;
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            ping,
            read_saved_variables_dir,
            ensure_device_key,
            device_public_key,
            sign_pairing,
            save_identity,
            load_identity,
            clear_identity,
            device_name,
            initial_deep_links,
            default_wow_dir,
            discover_characters,
            read_saved_variables,
            website_url,
            open_website,
            set_paused,
            updates_enabled
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}

#[tauri::command]
fn ping() -> &'static str {
    "pong"
}

#[tauri::command]
fn read_saved_variables_dir(path: String) -> Result<Vec<String>, String> {
    std::fs::read_dir(&path)
        .map(|entries| entries.filter_map(|e| e.ok()).map(|e| e.file_name().to_string_lossy().to_string()).collect())
        .map_err(|e| e.to_string())
}
