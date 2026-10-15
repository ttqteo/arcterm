// Native side of the Agent surface's canvas mode: a whole-window capture (the canvas iframe is
// cross-origin, so the page cannot read its pixels), for canvas Send and the gallery's previews.
// wavesrv serves the boards themselves.
use crate::applog::log_line;

#[cfg(any(windows, target_os = "macos"))]
#[tauri::command]
pub async fn capture_webview(window: tauri::WebviewWindow) -> Result<tauri::ipc::Response, String> {
    let result = capture_png(&window).await;
    if let Err(e) = &result {
        log_line(&format!("[capture] {e}"));
    }
    result.map(tauri::ipc::Response::new)
}

#[cfg(not(any(windows, target_os = "macos")))]
#[tauri::command]
pub async fn capture_webview(_window: tauri::WebviewWindow) -> Result<tauri::ipc::Response, String> {
    Err("window capture is Windows and macOS only".to_string())
}

// macOS: the window server's image of the window, by screencapture -l. WKWebView has no CapturePreview,
// and its own snapshot is not sure to draw a cross-origin frame. The webview fills the window (the
// title bar is an overlay), so the image is the page at the backing scale, which the page's crop
// expects. It takes the Screen Recording permission, which the fixed signing identity keeps across
// installs; without it screencapture would hand back the desktop, so it is asked first.
#[cfg(target_os = "macos")]
async fn capture_png(window: &tauri::WebviewWindow) -> Result<Vec<u8>, String> {
    use std::sync::atomic::{AtomicU64, Ordering};
    static NEXT: AtomicU64 = AtomicU64::new(0);

    if !objc2_core_graphics::CGPreflightScreenCaptureAccess() {
        return Err("arcterm has no Screen Recording permission (System Settings → Privacy & Security)".to_string());
    }
    let id = window_number(window).await?;
    let path = std::env::temp_dir().join(format!(
        "arcterm-capture-{}-{}.png",
        std::process::id(),
        NEXT.fetch_add(1, Ordering::Relaxed)
    ));
    let run = {
        let path = path.clone();
        tauri::async_runtime::spawn_blocking(move || {
            // -x no sound, -o no shadow, so the image is the window's frame and nothing around it
            std::process::Command::new("/usr/sbin/screencapture")
                .args(["-x", "-o", "-t", "png", &format!("-l{id}")])
                .arg(&path)
                .output()
        })
    };
    let out = run
        .await
        .map_err(|e| e.to_string())?
        .map_err(|e| format!("screencapture: {e}"))?;
    let bytes = std::fs::read(&path);
    let _ = std::fs::remove_file(&path);
    if !out.status.success() {
        return Err(format!("screencapture: {}", String::from_utf8_lossy(&out.stderr).trim()));
    }
    bytes.map_err(|e| format!("screencapture wrote no image: {e}"))
}

// the window's number, which is its CGWindowID; AppKit answers only on the main thread
#[cfg(target_os = "macos")]
async fn window_number(window: &tauri::WebviewWindow) -> Result<isize, String> {
    let (tx, rx) = tokio::sync::oneshot::channel::<Result<isize, String>>();
    let w = window.clone();
    window
        .run_on_main_thread(move || {
            let number = (|| {
                objc2::MainThreadMarker::new().ok_or("not on the main thread")?;
                let ptr = w.ns_window().map_err(|e| e.to_string())?;
                // SAFETY: Tauri hands back this window's live NSWindow*, and we are on the main thread
                let ns = unsafe { &*(ptr as *const objc2_app_kit::NSWindow) };
                Ok(ns.windowNumber())
            })();
            let _ = tx.send(number);
        })
        .map_err(|e| e.to_string())?;
    let number = rx.await.map_err(|_| "window number was dropped".to_string())??;
    if number <= 0 {
        return Err("the window is not on screen".to_string());
    }
    Ok(number)
}

#[cfg(windows)]
async fn capture_png(window: &tauri::WebviewWindow) -> Result<Vec<u8>, String> {
    use std::cell::RefCell;
    use std::rc::Rc;
    use webview2_com::CapturePreviewCompletedHandler;
    use webview2_com::Microsoft::Web::WebView2::Win32::COREWEBVIEW2_CAPTURE_PREVIEW_IMAGE_FORMAT_PNG;
    use windows::Win32::Foundation::HGLOBAL;
    use windows::Win32::System::Com::StructuredStorage::CreateStreamOnHGlobal;

    let (tx, rx) = tokio::sync::oneshot::channel::<Result<Vec<u8>, String>>();
    window
        .with_webview(move |wv| unsafe {
            // runs on the main thread; CapturePreview completes asynchronously into the stream,
            // so the sender is shared between the setup-error path and the completion handler
            let tx = Rc::new(RefCell::new(Some(tx)));
            let send = {
                let tx = tx.clone();
                move |out: Result<Vec<u8>, String>| {
                    if let Some(tx) = tx.borrow_mut().take() {
                        let _ = tx.send(out);
                    }
                }
            };
            let done = send.clone();
            let setup = (|| -> Result<(), String> {
                let core = wv.controller().CoreWebView2().map_err(|e| e.to_string())?;
                let stream = CreateStreamOnHGlobal(HGLOBAL::default(), true).map_err(|e| e.to_string())?;
                let keep = stream.clone();
                let handler = CapturePreviewCompletedHandler::create(Box::new(move |res| {
                    done(res.map_err(|e| e.to_string()).and_then(|_| read_all(&keep)));
                    Ok(())
                }));
                core.CapturePreview(COREWEBVIEW2_CAPTURE_PREVIEW_IMAGE_FORMAT_PNG, &stream, &handler)
                    .map_err(|e| e.to_string())
            })();
            if let Err(e) = setup {
                send(Err(e));
            }
        })
        .map_err(|e| e.to_string())?;
    rx.await.map_err(|_| "capture was dropped".to_string())?
}

#[cfg(windows)]
unsafe fn read_all(stream: &windows::Win32::System::Com::IStream) -> Result<Vec<u8>, String> {
    use windows::Win32::System::Com::STREAM_SEEK_SET;
    const CHUNK: usize = 64 * 1024;

    stream.Seek(0, STREAM_SEEK_SET, None).map_err(|e| e.to_string())?;
    let mut out = Vec::new();
    let mut buf = vec![0u8; CHUNK];
    loop {
        let mut read = 0u32;
        stream
            .Read(buf.as_mut_ptr().cast(), CHUNK as u32, Some(&mut read))
            .ok()
            .map_err(|e| e.to_string())?;
        if read == 0 {
            return Ok(out);
        }
        out.extend_from_slice(&buf[..read as usize]);
    }
}
