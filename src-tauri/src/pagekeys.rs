// The page's reload keys: Ctrl+R, Ctrl+Shift+R and F5. WebView2 takes them as browser keys and reloads the whole
// cockpit, even from inside a pinned app's page, whose keys never reach the cockpit's keybindings (it is a cross-origin
// frame). Here they lose that browser action but still reach the page, so a terminal keeps Ctrl+R as the shell's reverse
// search; the frontend hears RELOAD_KEY_EVENT and reloads the app's page when its frame holds the focus (appstore.ts
// setupPageReloadKey). The frame's own location.reload() runs here too, as the cockpit cannot reach into it.
use crate::applog::log_line;

#[cfg(windows)]
const RELOAD_KEY_EVENT: &str = "page-reload-key";

#[cfg(any(windows, test))]
const VK_F5: u32 = 0x74;
#[cfg(any(windows, test))]
const VK_R: u32 = 0x52;

// Ctrl+R with or without Shift, and F5 with or without Ctrl (a browser's hard reload); never with Alt
#[cfg(any(windows, test))]
fn is_reload_key(vk: u32, ctrl: bool, alt: bool) -> bool {
    !alt && ((vk == VK_R && ctrl) || vk == VK_F5)
}

#[cfg(windows)]
thread_local! {
    // the main document's frames, which reload_app_frame looks up by name; pruned of the destroyed ones as frames come.
    // WebView2 raises FrameCreated on the main thread, and with_webview runs there too.
    static FRAMES: std::cell::RefCell<Vec<webview2_com::Microsoft::Web::WebView2::Win32::ICoreWebView2Frame>> =
        const { std::cell::RefCell::new(Vec::new()) };
}

#[cfg(windows)]
pub fn watch(window: &tauri::WebviewWindow) {
    use tauri::Manager;
    let app = window.app_handle().clone();
    let res = window.with_webview(move |wv| unsafe {
        if let Err(e) = install(&wv.controller(), app) {
            log_line(&format!("[tauri] watching the page's reload keys failed: {e}"));
        }
    });
    if let Err(e) = res {
        log_line(&format!("[tauri] watching the page's reload keys failed: {e}"));
    }
}

#[cfg(not(windows))]
pub fn watch(_window: &tauri::WebviewWindow) {}

#[cfg(windows)]
unsafe fn install(
    controller: &webview2_com::Microsoft::Web::WebView2::Win32::ICoreWebView2Controller,
    app: tauri::AppHandle,
) -> windows::core::Result<()> {
    use tauri::Emitter;
    use webview2_com::Microsoft::Web::WebView2::Win32::{
        ICoreWebView2AcceleratorKeyPressedEventArgs2, ICoreWebView2_4, COREWEBVIEW2_KEY_EVENT_KIND,
        COREWEBVIEW2_KEY_EVENT_KIND_KEY_DOWN, COREWEBVIEW2_PHYSICAL_KEY_STATUS,
    };
    use webview2_com::{AcceleratorKeyPressedEventHandler, FrameCreatedEventHandler};
    use windows::core::Interface;
    use windows_sys::Win32::UI::Input::KeyboardAndMouse::{GetKeyState, VK_CONTROL, VK_MENU};

    let mut token = 0i64;
    let keys = AcceleratorKeyPressedEventHandler::create(Box::new(move |_, args| {
        let Some(args) = args else {
            return Ok(());
        };
        let mut kind = COREWEBVIEW2_KEY_EVENT_KIND::default();
        args.KeyEventKind(&mut kind)?;
        if kind != COREWEBVIEW2_KEY_EVENT_KIND_KEY_DOWN {
            return Ok(());
        }
        let mut vk = 0u32;
        args.VirtualKey(&mut vk)?;
        let ctrl = GetKeyState(VK_CONTROL as i32) < 0;
        let alt = GetKeyState(VK_MENU as i32) < 0;
        if !is_reload_key(vk, ctrl, alt) {
            return Ok(());
        }
        // the key still goes to the page; only the browser's reload is taken away, on every repeat too
        args.cast::<ICoreWebView2AcceleratorKeyPressedEventArgs2>()?
            .SetIsBrowserAcceleratorKeyEnabled(false)?;
        let mut status = COREWEBVIEW2_PHYSICAL_KEY_STATUS::default();
        args.PhysicalKeyStatus(&mut status)?;
        if !status.WasKeyDown.as_bool() {
            let _ = app.emit(RELOAD_KEY_EVENT, ());
        }
        Ok(())
    }));
    controller.add_AcceleratorKeyPressed(&keys, &mut token)?;

    let core = controller.CoreWebView2()?.cast::<ICoreWebView2_4>()?;
    let frames = FrameCreatedEventHandler::create(Box::new(|_, args| {
        let Some(args) = args else {
            return Ok(());
        };
        let frame = args.Frame()?;
        FRAMES.with(|all| {
            let mut all = all.borrow_mut();
            all.retain(|f| !destroyed(f));
            all.push(frame);
        });
        Ok(())
    }));
    core.add_FrameCreated(&frames, &mut token)?;
    Ok(())
}

#[cfg(windows)]
unsafe fn destroyed(frame: &webview2_com::Microsoft::Web::WebView2::Win32::ICoreWebView2Frame) -> bool {
    let mut out = windows::core::BOOL::default();
    frame.IsDestroyed(&mut out).is_err() || out.as_bool()
}

#[cfg(windows)]
unsafe fn frame_name(frame: &webview2_com::Microsoft::Web::WebView2::Win32::ICoreWebView2Frame) -> Option<String> {
    let mut name = windows::core::PWSTR::null();
    frame.Name(&mut name).ok()?;
    Some(webview2_com::take_pwstr(name))
}

// Reloads the app frame named `name` where it is, as a browser's reload. False when no live frame has that name.
#[cfg(windows)]
#[tauri::command]
pub async fn reload_app_frame(window: tauri::WebviewWindow, name: String) -> Result<bool, String> {
    let (tx, rx) = tokio::sync::oneshot::channel::<Result<bool, String>>();
    window
        .with_webview(move |_| unsafe {
            let _ = tx.send(reload_frame(&name));
        })
        .map_err(|e| e.to_string())?;
    rx.await.map_err(|_| "the reload was dropped".to_string())?
}

#[cfg(not(windows))]
#[tauri::command]
pub async fn reload_app_frame(_window: tauri::WebviewWindow, _name: String) -> Result<bool, String> {
    Ok(false)
}

#[cfg(windows)]
unsafe fn reload_frame(name: &str) -> Result<bool, String> {
    use webview2_com::ExecuteScriptCompletedHandler;
    use webview2_com::Microsoft::Web::WebView2::Win32::ICoreWebView2Frame2;
    use windows::core::{w, Interface};

    let frame = FRAMES.with(|all| {
        all.borrow()
            .iter()
            .find(|f| !destroyed(f) && frame_name(f).as_deref() == Some(name))
            .cloned()
    });
    let Some(frame) = frame else {
        return Ok(false);
    };
    let done = ExecuteScriptCompletedHandler::create(Box::new(|res, _| {
        if let Err(e) = res {
            log_line(&format!("[tauri] reloading an app's page failed: {e}"));
        }
        Ok(())
    }));
    frame
        .cast::<ICoreWebView2Frame2>()
        .and_then(|f| f.ExecuteScript(w!("location.reload()"), &done))
        .map_err(|e| e.to_string())?;
    Ok(true)
}

#[cfg(test)]
mod tests {
    use super::is_reload_key;

    #[test]
    fn reload_keys_are_ctrl_r_and_f5_never_with_alt() {
        assert!(is_reload_key(0x52, true, false)); // Ctrl+R, Ctrl+Shift+R
        assert!(is_reload_key(0x74, false, false)); // F5
        assert!(is_reload_key(0x74, true, false)); // Ctrl+F5
        assert!(!is_reload_key(0x52, false, false)); // a plain r
        assert!(!is_reload_key(0x52, true, true)); // Ctrl+Alt+R
        assert!(!is_reload_key(0x74, false, true));
        assert!(!is_reload_key(0x41, true, false)); // Ctrl+A
    }
}
