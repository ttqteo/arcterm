// Whether the OS's foreground belongs to arcterm, for the fold that follows you out of the app (floatstore.ts
// window:autosprout). The main window losing focus is not enough: a file dialog, the color picker or another arcterm
// window takes it too, and folding under them would be wrong. On Windows the foreground window's process is compared
// with ours; on macOS the app is asked whether it is active, which a sheet or dialog keeps it. Elsewhere it answers
// false, so a lost focus alone decides.

#[cfg(windows)]
fn has_foreground() -> bool {
    use windows_sys::Win32::UI::WindowsAndMessaging::{GetForegroundWindow, GetWindowThreadProcessId};
    // SAFETY: both calls take no pointers but the out-param, which lives on this stack
    unsafe {
        let hwnd = GetForegroundWindow();
        if hwnd.is_null() {
            return false;
        }
        let mut pid: u32 = 0;
        GetWindowThreadProcessId(hwnd, &mut pid);
        pid == std::process::id()
    }
}

#[cfg(target_os = "macos")]
fn has_foreground() -> bool {
    use objc2::MainThreadMarker;
    use objc2_app_kit::NSApplication;
    // a command that is not async runs on the main thread, which AppKit requires
    match MainThreadMarker::new() {
        Some(mtm) => NSApplication::sharedApplication(mtm).isActive(),
        None => false,
    }
}

#[cfg(not(any(windows, target_os = "macos")))]
fn has_foreground() -> bool {
    false
}

#[tauri::command]
pub fn app_has_foreground() -> bool {
    has_foreground()
}
