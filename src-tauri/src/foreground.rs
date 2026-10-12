// Where the OS's foreground is, for the fold that follows you out of the app (floatstore.ts window:autosprout). The main
// window losing focus is not enough to fold:
// - "ours": a file dialog, the color picker or another arcterm window took the focus; folding under them would be wrong.
// - "covered": another app took it, and its window hides arcterm (maximized or full screen on arcterm's screen), so the
//   fold keeps arcterm in sight as a picture-in-picture would.
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

// Whether `front` hides `ours`: it covers at least COVER_SHARE of arcterm's area. Not all of it: a maximized window's frame
// and arcterm's can differ by a few pixels of border, and a sliver left showing is no cockpit to watch.
#[cfg_attr(not(windows), allow(dead_code))]
const COVER_SHARE: f64 = 0.95;

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
    fn an_empty_frame_is_never_covered() {
        assert!(!covers(f(0, 0, 100, 100), f(0, 0, 0, 0)));
    }
}
