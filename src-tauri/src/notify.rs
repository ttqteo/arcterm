// OS notifications for agent events (frontend notifysync.tsx decides when; this only shows them). A click focuses the
// window and hands the toast's target back to the frontend, which opens what it is about: Windows through WinRT toasts'
// activation callback, macOS by waiting on each Notification Center banner for its click.
use crate::applog::log_line;
use tauri::{AppHandle, Emitter, Manager};

/// Emitted with the toast's target (the frontend's JSON) when you click a toast.
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

fn focus_main(app: &AppHandle) {
    if let Some(w) = app.get_webview_window("main") {
        let _ = w.unminimize();
        let _ = w.show();
        let _ = w.set_focus();
    }
}

/// A clicked toast: bring the window up and tell the frontend what the toast was about.
#[cfg_attr(not(any(windows, target_os = "macos")), allow(dead_code))]
fn activate(app: &AppHandle, target: String) {
    focus_main(app);
    if let Err(e) = app.emit(ACTIVATED_EVENT, target) {
        log_line(&format!("[tauri] notify activation emit failed: {}", e));
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
            activate(&handle, target.clone());
            Ok(())
        })
        .show()
        .map_err(|e| e.to_string())
}

/// The bundle a banner is posted as. A release build posts as itself, so a click comes back to it. A dev build is a
/// bare binary with no bundle, and posting as the installed arcterm's id would launch that app on a click, so it
/// borrows Terminal's, as tauri-plugin-notification did; the click still reaches this process.
#[cfg(target_os = "macos")]
fn bundle_id(is_dev: bool, identifier: &str) -> &str {
    if is_dev {
        "com.apple.Terminal"
    } else {
        identifier
    }
}

/// Whether a banner's response opens its target: a click on it. Closing it, clearing it from Notification Center or
/// leaving it there does not.
#[cfg(target_os = "macos")]
fn opens(response: &mac_notification_sys::NotificationResponse) -> bool {
    use mac_notification_sys::NotificationResponse;
    matches!(response, NotificationResponse::Click | NotificationResponse::ActionButton(_))
}

// Each banner waiting for its click holds a thread, and mac-notification-sys polls Notification Center for it on the
// main run loop every half second until it is clicked or cleared. Past this many uncleared banners a new one is shown
// without waiting, and a click on it only raises the app.
#[cfg(target_os = "macos")]
const MAX_WAITING: usize = 16;
#[cfg(target_os = "macos")]
static WAITING: std::sync::atomic::AtomicUsize = std::sync::atomic::AtomicUsize::new(0);

#[cfg(target_os = "macos")]
fn show(app: &AppHandle, title: &str, body: &str, target: String, loud: bool) -> Result<(), String> {
    use mac_notification_sys::{Notification, Sound};
    use std::sync::atomic::Ordering::SeqCst;
    // set once per process; every later call reports AlreadySet
    let _ = mac_notification_sys::set_application(bundle_id(tauri::is_dev(), &app.config().identifier));
    let wait = WAITING.fetch_add(1, SeqCst) < MAX_WAITING;
    if !wait {
        WAITING.fetch_sub(1, SeqCst);
    }
    let (handle, title, body) = (app.clone(), title.to_owned(), body.to_owned());
    // send() blocks until the banner is clicked or leaves Notification Center, so each banner gets its own thread
    std::thread::Builder::new()
        .name("notify-os".into())
        .spawn(move || {
            let mut n = Notification::new();
            n.title(&title).message(&body).wait_for_click(wait);
            if loud {
                n.sound(Sound::Default);
            }
            let response = n.send();
            if wait {
                WAITING.fetch_sub(1, SeqCst);
            }
            match response {
                Ok(r) if opens(&r) => activate(&handle, target),
                Ok(_) => {}
                Err(e) => log_line(&format!("[tauri] notify_os failed: {}", e)),
            }
        })
        .map(|_| ())
        .map_err(|e| {
            if wait {
                WAITING.fetch_sub(1, SeqCst);
            }
            e.to_string()
        })
}

#[cfg(not(any(windows, target_os = "macos")))]
fn show(_app: &AppHandle, _title: &str, _body: &str, _target: String, _loud: bool) -> Result<(), String> {
    Ok(())
}

#[cfg(all(test, target_os = "macos"))]
mod mac_tests {
    use super::*;
    use mac_notification_sys::NotificationResponse;

    #[test]
    fn dev_posts_as_terminal() {
        assert_eq!(bundle_id(true, "dev.arc.app"), "com.apple.Terminal");
    }

    #[test]
    fn release_posts_as_itself() {
        assert_eq!(bundle_id(false, "dev.arc.app"), "dev.arc.app");
    }

    #[test]
    fn only_a_click_opens_the_target() {
        assert!(opens(&NotificationResponse::Click));
        assert!(!opens(&NotificationResponse::None));
        assert!(!opens(&NotificationResponse::CloseButton("Close".into())));
    }
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
