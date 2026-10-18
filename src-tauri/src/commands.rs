use crate::applog::log_line;
use tauri::{AppHandle, Emitter};

// Phase 1 minimal wave-init payload — proves the Rust→FE event round-trip.
// The real WaveInitOpts (tabId/clientId/windowId from window/workspace state) is
// assembled in Phase 5 when the real boot path comes online.
#[derive(Clone, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct WaveInitOpts {
    pub tab_id: String,
    pub client_id: String,
    pub window_id: String,
    pub activate: bool,
}

#[tauri::command]
pub fn set_window_init_status(app: AppHandle, status: String) {
    log_line(&format!("[init-status] {}", status));
    if status == "ready" {
        let opts = WaveInitOpts {
            tab_id: String::new(),
            client_id: String::new(),
            window_id: String::new(),
            activate: true,
        };
        if let Err(e) = app.emit("wave-init", opts) {
            log_line(&format!("[init-status] emit wave-init failed: {}", e));
        }
    }
}

// The webview renders model-controlled markdown; the OS opener (ShellExecute "open" on Windows)
// launches executables and file:// paths, so only schemes the model can legitimately want are
// allowed. Anything else is rejected and logged rather than handed to the opener.
fn is_allowed_external_url(url: &str) -> bool {
    let Some(scheme) = url.split_once(':').map(|(s, _)| s.to_ascii_lowercase()) else {
        return false;
    };
    matches!(scheme.as_str(), "http" | "https" | "mailto")
}

#[tauri::command]
pub fn open_external(url: String) {
    if !is_allowed_external_url(&url) {
        log_line(&format!(
            "[open-external] rejected URL with non-allowlisted scheme: {}",
            url
        ));
        return;
    }
    if let Err(e) = open::that(&url) {
        log_line(&format!("[open-external] failed to open {}: {}", url, e));
    }
}

// Only an absolute path is handed to the file manager: a relative one would resolve against the host's cwd, and on
// macOS one starting with "-" would read as a flag to `open`.
fn is_revealable(path: &str) -> bool {
    std::path::Path::new(path).is_absolute()
}

// Shows a file or folder selected in Finder / Explorer (the tree and path menus' Reveal in Finder). It waits on a
// thread of its own, so the opener never blocks the main thread and its exit is reaped.
#[tauri::command]
pub fn reveal_path(path: String) {
    if !is_revealable(&path) {
        log_line(&format!(
            "[reveal-path] rejected non-absolute path: {}",
            path
        ));
        return;
    }
    std::thread::spawn(move || {
        #[cfg(target_os = "macos")]
        let result = std::process::Command::new("open")
            .arg("-R")
            .arg(&path)
            .status()
            .and_then(|s| {
                if s.success() {
                    Ok(())
                } else {
                    Err(std::io::Error::other(format!("open -R exited {}", s)))
                }
            });
        // explorer wants the quotes inside its one /select, argument, and exits 1 even when it showed the file; a
        // forward slash (a path git or the frontend wrote) makes it open Documents instead, so it gets backslashes
        #[cfg(target_os = "windows")]
        let result = {
            use std::os::windows::process::CommandExt;
            std::process::Command::new("explorer")
                .raw_arg(format!("/select,\"{}\"", path.replace('/', "\\")))
                .status()
                .map(|_| ())
        };
        #[cfg(not(any(target_os = "macos", target_os = "windows")))]
        let result = match std::path::Path::new(&path).parent() {
            Some(dir) => open::that(dir),
            None => open::that(&path),
        };
        if let Err(e) = result {
            log_line(&format!("[reveal-path] failed to reveal {}: {}", path, e));
        }
    });
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn allows_http_https_mailto() {
        assert!(is_allowed_external_url("https://example.com/page"));
        assert!(is_allowed_external_url("http://localhost:3000"));
        assert!(is_allowed_external_url("mailto:dev@example.com"));
    }

    #[test]
    fn scheme_match_is_case_insensitive() {
        assert!(is_allowed_external_url("HTTPS://example.com"));
        assert!(is_allowed_external_url("MailTo:dev@example.com"));
    }

    #[test]
    fn rejects_other_schemes_and_schemeless_urls() {
        // ShellExecute would launch executables via file:// or a bare path
        assert!(!is_allowed_external_url(
            "file:///C:/Windows/System32/notepad.exe"
        ));
        assert!(!is_allowed_external_url("javascript:alert(1)"));
        assert!(!is_allowed_external_url("C:\\Windows\\notepad.exe"));
        assert!(!is_allowed_external_url("\\\\.\\pipe\\x"));
        assert!(!is_allowed_external_url("example.com/page"));
        assert!(!is_allowed_external_url(""));
    }

    #[test]
    fn reveals_only_absolute_paths() {
        assert!(!is_revealable(""));
        assert!(!is_revealable("src/main.rs"));
        assert!(!is_revealable("-a"));
        #[cfg(unix)]
        assert!(is_revealable("/Users/me/repo/src/main.rs"));
        #[cfg(windows)]
        assert!(is_revealable("C:\\repo\\src\\main.rs"));
    }
}
