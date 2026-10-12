// Where the OS's foreground is, for the fold that follows you out of the app (floatstore.ts window:autosprout). The main
// window losing focus is not enough to fold:
// - "ours": a file dialog, the color picker or another arcterm window took the focus; folding under them would be wrong.
// - "covered": another app took it, and its window hides most of arcterm (maximized, full screen, or a big window over
//   it), so the fold keeps arcterm in sight as a picture-in-picture would.
// - "beside": another app took it but arcterm still shows next to it (a small window, a popup, the Start menu, a window on
//   another screen); folding would hide a cockpit you can still see.
// On Windows the foreground window's process is compared with ours and its frame with arcterm's; on macOS the app is
// asked whether it is active, which a sheet or dialog keeps it, and the window whether any of it is still on screen.
// Elsewhere it answers "covered", so a lost focus alone decides.

use tauri::WebviewWindow;

#[derive(Clone, Copy, Debug, PartialEq)]
enum Foreground {
    Ours,
    Covered,
    Beside,
}

impl Foreground {
    fn as_str(self) -> &'static str {
        match self {
            Foreground::Ours => "ours",
            Foreground::Covered => "covered",
            Foreground::Beside => "beside",
        }
    }
}

// a window frame in screen pixels: left, top, right, bottom
#[cfg_attr(not(windows), allow(dead_code))]
#[derive(Clone, Copy, Debug)]
struct Frame {
    left: i64,
    top: i64,
    right: i64,
    bottom: i64,
}

// Whether `front` hides `ours`: it covers at least COVER_SHARE of arcterm's area. Not all of it: a big window that is not
// maximized still hides the cockpit, and the strip it leaves showing is no cockpit to watch.
#[cfg_attr(not(windows), allow(dead_code))]
const COVER_SHARE: f64 = 0.80;

#[cfg_attr(not(windows), allow(dead_code))]
fn covers(front: Frame, ours: Frame) -> bool {
    let area = ((ours.right - ours.left).max(0) * (ours.bottom - ours.top).max(0)) as f64;
    if area == 0.0 {
        return false;
    }
    let w = (front.right.min(ours.right) - front.left.max(ours.left)).max(0);
    let h = (front.bottom.min(ours.bottom) - front.top.max(ours.top)).max(0);
    (w * h) as f64 / area >= COVER_SHARE
}

#[cfg(windows)]
fn foreground(window: &WebviewWindow) -> Foreground {
    use windows_sys::Win32::Foundation::{HWND, RECT};
    use windows_sys::Win32::UI::WindowsAndMessaging::{
        GetForegroundWindow, GetWindowRect, GetWindowThreadProcessId,
    };

    fn frame(hwnd: HWND) -> Option<Frame> {
        let mut r = RECT {
            left: 0,
            top: 0,
            right: 0,
            bottom: 0,
        };
        // SAFETY: the out-param lives on this stack; a stale handle only makes the call fail
        if unsafe { GetWindowRect(hwnd, &mut r) } == 0 {
            return None;
        }
        Some(Frame {
            left: r.left as i64,
            top: r.top as i64,
            right: r.right as i64,
            bottom: r.bottom as i64,
        })
    }

    // SAFETY: takes no pointers
    let front = unsafe { GetForegroundWindow() };
    if front.is_null() {
        return Foreground::Beside;
    }
    let mut pid: u32 = 0;
    // SAFETY: the out-param lives on this stack
    unsafe { GetWindowThreadProcessId(front, &mut pid) };
    if pid == std::process::id() {
        return Foreground::Ours;
    }
    // both frames from GetWindowRect, so they share its pixels and its borders
    let ours = window.hwnd().ok().and_then(|h| frame(h.0 as HWND));
    match (frame(front), ours) {
        (Some(f), Some(o)) if covers(f, o) => Foreground::Covered,
        _ => Foreground::Beside,
    }
}

#[cfg(target_os = "macos")]
fn foreground(window: &WebviewWindow) -> Foreground {
    use objc2::MainThreadMarker;
    use objc2_app_kit::{NSApplication, NSWindow, NSWindowOcclusionState};
    // a command that is not async runs on the main thread, which AppKit requires
    let Some(mtm) = MainThreadMarker::new() else {
        return Foreground::Beside;
    };
    if NSApplication::sharedApplication(mtm).isActive() {
        return Foreground::Ours;
    }
    let Ok(ptr) = window.ns_window() else {
        return Foreground::Beside;
    };
    // SAFETY: Tauri hands back this window's live NSWindow*, which outlives the call, and we are on the main thread
    let ns = unsafe { &*(ptr as *const NSWindow) };
    // AppKit's occlusion state: Visible while any part of the window is on screen. Another app's maximized or full-screen
    // window (its own Space) takes it away; a smaller one beside arcterm leaves it.
    if ns
        .occlusionState()
        .contains(NSWindowOcclusionState::Visible)
    {
        Foreground::Beside
    } else {
        Foreground::Covered
    }
}

#[cfg(not(any(windows, target_os = "macos")))]
fn foreground(_window: &WebviewWindow) -> Foreground {
    Foreground::Covered
}

#[tauri::command]
pub fn app_foreground(window: WebviewWindow) -> &'static str {
    foreground(&window).as_str()
}

// A click on arcterm's taskbar button brings a window folded into Sprout back, as the Dock icon does on macOS (main.rs
// emits "app-reopen" there; floatstore.ts grows the window back on it). Windows has no reopen event, so the host watches
// the foreground: the main window taking it straight from the taskbar is a click on its button, while Alt+Tab comes from
// the switcher and only focuses Sprout. A click on the button of the window already in front minimizes it instead, so
// that minimize counts too. The frontend lets both pass unless the window is folded.

// the window classes of the taskbar: the main one, one on another screen, and a button's thumbnail
#[cfg_attr(not(windows), allow(dead_code))]
fn is_taskbar(class: &str) -> bool {
    matches!(
        class,
        "Shell_TrayWnd" | "Shell_SecondaryTrayWnd" | "TaskListThumbnailWnd"
    )
}

// how soon after the taskbar took the foreground the main window must take it (or minimize) to count as its button's click
#[cfg_attr(not(windows), allow(dead_code))]
const TASKBAR_CLICK_MS: u32 = 1500;

// `at`: when the taskbar last took the foreground (event ms, 0 for not since the main window last had it)
#[cfg_attr(not(windows), allow(dead_code))]
fn from_taskbar(at: u32, now: u32) -> bool {
    at != 0 && now.wrapping_sub(at) <= TASKBAR_CLICK_MS
}

#[cfg(windows)]
pub fn watch_taskbar(window: &WebviewWindow) {
    use std::sync::atomic::{AtomicIsize, AtomicU32, Ordering};
    use std::sync::OnceLock;
    use tauri::{AppHandle, Emitter, Manager};
    use windows_sys::Win32::Foundation::HWND;
    use windows_sys::Win32::UI::Accessibility::{SetWinEventHook, HWINEVENTHOOK};
    use windows_sys::Win32::UI::WindowsAndMessaging::{
        GetClassNameW, EVENT_SYSTEM_FOREGROUND, EVENT_SYSTEM_MINIMIZESTART, OBJID_WINDOW,
        WINEVENT_OUTOFCONTEXT,
    };

    static APP: OnceLock<AppHandle> = OnceLock::new();
    static MAIN: AtomicIsize = AtomicIsize::new(0);
    static TASKBAR_AT: AtomicU32 = AtomicU32::new(0);

    fn class_of(hwnd: HWND) -> String {
        let mut buf = [0u16; 64];
        // SAFETY: the buffer lives on this stack and its length is passed; a stale handle only makes the call fail
        let n = unsafe { GetClassNameW(hwnd, buf.as_mut_ptr(), buf.len() as i32) };
        String::from_utf16_lossy(&buf[..n.max(0) as usize])
    }

    // an out-of-context hook: called on this (the main) thread from its message loop
    unsafe extern "system" fn on_event(
        _hook: HWINEVENTHOOK,
        event: u32,
        hwnd: HWND,
        id_object: i32,
        _id_child: i32,
        _thread: u32,
        time: u32,
    ) {
        if id_object != OBJID_WINDOW || hwnd.is_null() {
            return;
        }
        if hwnd as isize != MAIN.load(Ordering::Relaxed) {
            if event == EVENT_SYSTEM_FOREGROUND {
                let at = if is_taskbar(&class_of(hwnd)) {
                    time.max(1)
                } else {
                    0
                };
                TASKBAR_AT.store(at, Ordering::Relaxed);
            }
            return;
        }
        if from_taskbar(TASKBAR_AT.swap(0, Ordering::Relaxed), time) {
            if let Some(app) = APP.get() {
                let _ = app.emit("app-reopen", ());
            }
        }
    }

    let Ok(hwnd) = window.hwnd() else {
        return;
    };
    MAIN.store(hwnd.0 as isize, Ordering::Relaxed);
    let _ = APP.set(window.app_handle().clone());
    for event in [EVENT_SYSTEM_FOREGROUND, EVENT_SYSTEM_MINIMIZESTART] {
        // SAFETY: the callback is a plain function that outlives the app; the hook lives as long as this thread
        unsafe {
            SetWinEventHook(
                event,
                event,
                std::ptr::null_mut(),
                Some(on_event),
                0,
                0,
                WINEVENT_OUTOFCONTEXT,
            )
        };
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn f(left: i64, top: i64, right: i64, bottom: i64) -> Frame {
        Frame {
            left,
            top,
            right,
            bottom,
        }
    }

    #[test]
    fn a_maximized_window_on_arcterms_screen_covers_it() {
        // a maximized window's frame overhangs the screen by its invisible border
        assert!(covers(f(-8, -8, 1928, 1048), f(0, 0, 1920, 1040)));
    }

    #[test]
    fn a_smaller_or_snapped_window_does_not() {
        assert!(!covers(f(200, 100, 1200, 800), f(0, 0, 1920, 1040)));
        assert!(!covers(f(0, 0, 960, 1040), f(0, 0, 1920, 1040)));
    }

    #[test]
    fn a_window_on_another_screen_does_not() {
        assert!(!covers(f(1920, 0, 3840, 1040), f(0, 0, 1920, 1040)));
    }

    #[test]
    fn a_window_leaving_a_sliver_still_covers() {
        assert!(covers(f(0, 0, 1920, 1000), f(0, 0, 1920, 1040)));
    }

    #[test]
    fn a_big_window_that_is_not_maximized_covers() {
        // 1800x950 over a 1920x1040 arcterm: ~86%
        assert!(covers(f(60, 40, 1860, 990), f(0, 0, 1920, 1040)));
    }

    #[test]
    fn a_window_over_three_quarters_does_not() {
        assert!(!covers(f(0, 0, 1440, 1040), f(0, 0, 1920, 1040)));
    }

    #[test]
    fn the_taskbar_is_its_windows_not_the_alt_tab_switcher() {
        assert!(is_taskbar("Shell_TrayWnd"));
        assert!(is_taskbar("Shell_SecondaryTrayWnd"));
        assert!(!is_taskbar("XamlExplorerHostIslandWindow"));
        assert!(!is_taskbar("MultitaskingViewFrame"));
        assert!(!is_taskbar("Chrome_WidgetWin_1"));
    }

    #[test]
    fn a_return_counts_as_a_taskbar_click_only_soon_after_the_taskbar() {
        assert!(from_taskbar(1000, 1120));
        assert!(!from_taskbar(1000, 1000 + TASKBAR_CLICK_MS + 1));
        assert!(!from_taskbar(0, 50));
        // the tick count wraps after ~49 days
        assert!(from_taskbar(u32::MAX - 10, 100));
    }

    #[test]
    fn an_empty_frame_is_never_covered() {
        assert!(!covers(f(0, 0, 100, 100), f(0, 0, 0, 0)));
    }
}
