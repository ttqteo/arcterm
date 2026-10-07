// OS notifications for agent events (frontend notifysync.tsx decides when; this only shows them). Windows uses WinRT
// toasts so a click can focus the window and hand the toast's target back to the frontend; macOS uses the notification
// plugin and a click only raises the app.
use crate::applog::log_line;
use tauri::{AppHandle, Manager};
#[cfg(windows)]
use tauri::Emitter;

/// Emitted with the toast's target (the frontend's JSON) when you click a toast.
#[cfg_attr(not(windows), allow(dead_code))]
pub const ACTIVATED_EVENT: &str = "os-notify-activated";

/// The AppUserModelID a toast is shown under. A release build registers the bundle identifier (main.rs
/// set_app_user_model_id, and the installer's shortcut); a dev build has none registered, and Windows drops a toast
/// from an unregistered id, so it borrows PowerShell's and the toast reads "Windows PowerShell".
#[cfg(windows)]
fn app_id(is_dev: bool, identifier: &str) -> String {
    if is_dev {
        tauri_winrt_notification::Toast::POWERSHELL_APP_ID.to_string()
    } else {
        identifier.to_string()
    }
}

#[cfg_attr(not(windows), allow(dead_code))]
fn focus_main(app: &AppHandle) {
    if let Some(w) = app.get_webview_window("main") {
        let _ = w.unminimize();
        let _ = w.show();
        let _ = w.set_focus();
    }
}

#[tauri::command]
pub fn notify_os(app: AppHandle, title: String, body: String, target: String, loud: bool) {
    if loud {
        if let Some(w) = app.get_webview_window("main") {
            let _ = w.request_user_attention(Some(tauri::UserAttentionType::Informational));
        }
    }
    if let Err(e) = show(&app, &title, &body, target, loud) {
        log_line(&format!("[tauri] notify_os failed: {}", e));
    }
}

#[cfg(windows)]
fn show(app: &AppHandle, title: &str, body: &str, target: String, loud: bool) -> Result<(), String> {
    use tauri_winrt_notification::{Sound, Toast};
    let handle = app.clone();
    Toast::new(&app_id(cfg!(debug_assertions), &app.config().identifier))
        .title(title)
        .text1(body)
        .sound(if loud { Some(Sound::Default) } else { None })
        .on_activated(move |_action| {
            focus_main(&handle);
            if let Err(e) = handle.emit(ACTIVATED_EVENT, target.clone()) {
                log_line(&format!("[tauri] notify activation emit failed: {}", e));
            }
            Ok(())
        })
        .show()
        .map_err(|e| e.to_string())
}

#[cfg(target_os = "macos")]
fn show(app: &AppHandle, title: &str, body: &str, _target: String, loud: bool) -> Result<(), String> {
    use tauri_plugin_notification::NotificationExt;
    let mut b = app.notification().builder().title(title).body(body);
    if loud {
        b = b.sound("default");
    }
    b.show().map_err(|e| e.to_string())
}

#[cfg(not(any(windows, target_os = "macos")))]
fn show(_app: &AppHandle, _title: &str, _body: &str, _target: String, _loud: bool) -> Result<(), String> {
    Ok(())
}

#[cfg(all(test, windows))]
mod tests {
    use super::*;

    #[test]
    fn dev_borrows_powershells_app_id() {
        assert_eq!(app_id(true, "dev.arc.app"), tauri_winrt_notification::Toast::POWERSHELL_APP_ID);
    }

    #[test]
    fn release_uses_the_bundle_identifier() {
        assert_eq!(app_id(false, "dev.arc.app"), "dev.arc.app");
    }
}
