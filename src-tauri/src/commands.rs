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
// allowed. Anything else is rejected and logged rather than handed to the opener. A well-formed
// URL percent-encodes quotes, whitespace and control characters, so a raw one is refused too: it
// can only be an attempt to break out of an argument.
//
// Why a URL is refused, for the log: someone reading it for a break-out attempt needs the real cause.
// Claude Desktop's resume link for one CLI session (a session's Open in Claude Desktop), and no other claude: link: the
// rest of that scheme can start a prompt or sign in.
fn is_claude_desktop_resume(url: &str) -> bool {
    let Some(id) = url.strip_prefix("claude://resume?session=") else {
        return false;
    };
    id.len() == 36
        && id.char_indices().all(|(i, c)| match i {
            8 | 13 | 18 | 23 => c == '-',
            _ => c.is_ascii_hexdigit(),
        })
}

fn external_url_rejection(url: &str) -> Option<&'static str> {
    if url.chars().any(|c| c == '"' || c.is_whitespace() || c.is_control()) {
        return Some("a raw quote, whitespace or control character");
    }
    let Some(scheme) = url.split_once(':').map(|(s, _)| s.to_ascii_lowercase()) else {
        return Some("no scheme");
    };
    if matches!(scheme.as_str(), "http" | "https" | "mailto") || is_claude_desktop_resume(url) {
        None
    } else {
        Some("a non-allowlisted scheme")
    }
}

#[tauri::command]
pub fn open_external(url: String) {
    if let Some(reason) = external_url_rejection(&url) {
        // {:?} escapes the control characters a refused URL may carry, so one log line stays one line
        log_line(&format!("[open-external] rejected URL with {}: {:?}", reason, url));
        return;
    }
    // that_detached with shellexecute-on-windows hands the URL to ShellExecuteExW as one string;
    // open::that runs `cmd /c start` with it, where the shell parses it
    if let Err(e) = open::that_detached(&url) {
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

// The kinds of file the panel cannot show (a deck, a sheet, a PDF, media) that Open hands to the OS's default app. The
// path comes from model-written terminal output, and ShellExecute "open" runs an .exe, a .bat or a .lnk, so the
// extension is an allowlist: a document or a media file, never anything that can run.
const OPENABLE_EXTS: &[&str] = &[
    "pdf", "ppt", "pptx", "pps", "ppsx", "key", "odp", "doc", "docx", "rtf", "odt", "pages", "xls", "xlsx", "csv",
    "ods", "numbers", "png", "jpg", "jpeg", "gif", "webp", "bmp", "tif", "tiff", "heic", "mp4", "mov", "webm", "mkv",
    "mp3", "wav", "m4a", "flac", "ogg", "epub",
];

fn is_openable(path: &str) -> bool {
    let p = std::path::Path::new(path);
    let Some(ext) = p.extension().and_then(|e| e.to_str()) else {
        return false;
    };
    p.is_absolute() && OPENABLE_EXTS.contains(&ext.to_ascii_lowercase().as_str())
}

// Opens a document in the OS's default app (a .pptx in PowerPoint, a .pdf in the PDF reader): the File panel's Open on a
// file it cannot show. An existing absolute file of an allowlisted kind only; anything else is rejected and logged.
#[tauri::command]
pub fn open_path(path: String) {
    if !is_openable(&path) || !std::path::Path::new(&path).is_file() {
        log_line(&format!("[open-path] rejected: {}", path));
        return;
    }
    std::thread::spawn(move || {
        if let Err(e) = open::that(&path) {
            log_line(&format!("[open-path] failed to open {}: {}", path, e));
        }
    });
}

#[cfg(test)]
mod tests {
    use super::*;

    // the yes/no the tests read; the opener itself logs external_url_rejection's reason
    fn is_allowed_external_url(url: &str) -> bool {
        external_url_rejection(url).is_none()
    }

    #[test]
    fn opens_only_absolute_documents_and_media() {
        assert!(is_openable("C:\\work\\docs\\slide\\Deck_v1.4.pptx"));
        // an absolute path is the platform's own: a drive on Windows, a leading slash elsewhere
        #[cfg(windows)]
        assert!(is_openable("D:/work/report.PDF"));
        #[cfg(not(windows))]
        assert!(is_openable("/Users/me/clip.mov"));
        assert!(!is_openable("docs/slide/Deck.pptx"));
        assert!(!is_openable("C:\\Windows\\System32\\notepad.exe"));
        assert!(!is_openable("C:\\x\\run.bat"));
        assert!(!is_openable("C:\\x\\link.lnk"));
        assert!(!is_openable("C:\\x\\page.html"));
        assert!(!is_openable("C:\\x\\noext"));
    }

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
    fn rejects_urls_that_could_break_out_of_an_argument() {
        // a raw quote closed `cmd /c start "" "<url>"` and ran what followed it
        assert!(!is_allowed_external_url("https://example.com/\"&calc.exe&\""));
        assert!(!is_allowed_external_url("https://example.com/a b"));
        assert!(!is_allowed_external_url("https://example.com/\nx"));
        assert!(!is_allowed_external_url("https://example.com/\tx"));
    }

    #[test]
    fn names_the_real_reason_for_a_refusal() {
        // a raw quote in an https URL is refused for the quote, not for its scheme
        assert_eq!(
            external_url_rejection("https://example.com/\"&calc.exe&\""),
            Some("a raw quote, whitespace or control character")
        );
        assert_eq!(
            external_url_rejection("javascript:alert(1)"),
            Some("a non-allowlisted scheme")
        );
        assert_eq!(external_url_rejection("example.com/page"), Some("no scheme"));
        assert_eq!(external_url_rejection("https://example.com"), None);
    }

    #[test]
    fn allows_only_claude_desktops_resume_link() {
        // a session's Open in Claude Desktop: the one claude: link Desktop's handler imports a CLI session from
        assert!(is_allowed_external_url(
            "claude://resume?session=6fc42214-cac4-494e-a823-f51d986afa66"
        ));
        assert!(!is_allowed_external_url("claude://resume?session=../x"));
        assert!(!is_allowed_external_url(
            "claude://resume?session=6fc42214-cac4-494e-a823-f51d986afa66&q=hi"
        ));
        assert!(!is_allowed_external_url("claude://code/new?q=hi"));
        assert!(!is_allowed_external_url("claude://login"));
        assert_eq!(
            external_url_rejection("claude://code/new"),
            Some("a non-allowlisted scheme")
        );
    }

    #[test]
    fn accepts_encoded_and_query_urls() {
        assert!(is_allowed_external_url("https://example.com/%22&calc.exe&%22"));
        assert!(is_allowed_external_url("https://example.com/a%20b?x=1&y=2#frag"));
        assert!(is_allowed_external_url("mailto:dev@example.com?subject=hi%20there"));
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
