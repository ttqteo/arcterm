// Native side of the Agent surface's canvas mode: a whole-window capture (the canvas iframe is
// cross-origin, so the page cannot read its pixels). wavesrv serves the boards themselves.
use crate::applog::log_line;

#[cfg(windows)]
#[tauri::command]
pub async fn capture_webview(window: tauri::WebviewWindow) -> Result<tauri::ipc::Response, String> {
    let result = capture_png(&window).await;
    if let Err(e) = &result {
        log_line(&format!("[capture] {e}"));
    }
    result.map(tauri::ipc::Response::new)
}

#[cfg(not(windows))]
#[tauri::command]
pub async fn capture_webview(_window: tauri::WebviewWindow) -> Result<tauri::ipc::Response, String> {
    Err("window capture is Windows-only".to_string())
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
