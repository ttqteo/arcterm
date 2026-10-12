// Where the OS's foreground is, for the fold that follows you out of the app (floatstore.ts window:autosprout). The main
// window losing focus is not enough to fold:
// - "ours": a file dialog, the color picker or another arcterm window took the focus; folding under them would be wrong.
// - "covered": another app took it, and its window hides most of arcterm (maximized, full screen, or a big window over
//   it), so the fold keeps arcterm in sight as a picture-in-picture would.
// - "beside": another app took it but arcterm still shows next to it (a small window, a popup, a window on another
//   screen), or an overlay took it: the screenshot tool, the lock screen, Alt+Tab's switcher or the Start menu cover the
//   whole screen for a moment, which is no leaving arcterm. Folding would hide a cockpit you are coming back to.
// On Windows the foreground window's process is compared with ours and its frame with arcterm's. On macOS the app is
// asked whether it is active, which a sheet or dialog keeps it, and then the window list: the frontmost window of
// another app above arcterm's is compared with it the same way. AppKit's occlusion state cannot answer it: it counts a
// window hidden only behind windows the window server takes as opaque, and Chrome's is not, so a zoomed Chrome right
// over arcterm left it "visible". Elsewhere it answers "covered", so a lost focus alone decides.

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

// a window frame in screen pixels (points on macOS): left, top, right, bottom
#[cfg_attr(not(any(windows, target_os = "macos")), allow(dead_code))]
#[derive(Clone, Copy, Debug)]
struct Frame {
    left: i64,
    top: i64,
    right: i64,
    bottom: i64,
}

// Whether `front` hides `ours`: it covers at least COVER_SHARE of arcterm's area. Not all of it: a big window that is not
// maximized still hides the cockpit, and the strip it leaves showing is no cockpit to watch.
#[cfg_attr(not(any(windows, target_os = "macos")), allow(dead_code))]
const COVER_SHARE: f64 = 0.80;

// Whether a window with these extended styles is an overlay rather than an app's window: it stays above every other
// window (the screenshot tool, the lock screen, Alt+Tab's switcher) or is a tool window kept out of the taskbar.
#[cfg_attr(not(windows), allow(dead_code))]
fn is_overlay(ex_style: u32) -> bool {
    const WS_EX_TOPMOST: u32 = 0x8;
    const WS_EX_TOOLWINDOW: u32 = 0x80;
    ex_style & (WS_EX_TOPMOST | WS_EX_TOOLWINDOW) != 0
}

#[cfg_attr(not(any(windows, target_os = "macos")), allow(dead_code))]
fn area(f: Frame) -> i64 {
    (f.right - f.left).max(0) * (f.bottom - f.top).max(0)
}

#[cfg_attr(not(any(windows, target_os = "macos")), allow(dead_code))]
fn covers(front: Frame, ours: Frame) -> bool {
    let area = area(ours) as f64;
    if area == 0.0 {
        return false;
    }
    let w = (front.right.min(ours.right) - front.left.max(ours.left)).max(0);
    let h = (front.bottom.min(ours.bottom) - front.top.max(ours.top)).max(0);
    (w * h) as f64 / area >= COVER_SHARE
}

// one on-screen window as macOS's window list gives it, front to back: its app, its level (0 is an app's normal window;
// the menu bar, the Dock, the screenshot tool and the lock screen sit above it), how opaque, and its frame
#[cfg_attr(not(target_os = "macos"), allow(dead_code))]
#[derive(Clone, Copy, Debug)]
struct Listed {
    pid: i64,
    layer: i64,
    alpha: f64,
    frame: Frame,
}

// macOS's answer once another app is active. arcterm's window is its biggest normal one (only the full window folds), and
// none on screen means a full-screen app's Space or another Space took the screen. Otherwise the frontmost normal window
// of another app above it decides, as the foreground window does on Windows; none above it (an overlay took the focus)
// leaves it beside.
#[cfg_attr(not(target_os = "macos"), allow(dead_code))]
fn from_window_list(list: &[Listed], our_pid: i64) -> Foreground {
    let normal = |w: &&Listed| w.layer == 0 && w.alpha > 0.0;
    let Some(ours) = list
        .iter()
        .filter(normal)
        .filter(|w| w.pid == our_pid)
        .max_by_key(|w| area(w.frame))
    else {
        return Foreground::Covered;
    };
    for w in list.iter().filter(normal) {
        if std::ptr::eq(w, ours) {
            break;
        }
        if w.pid != our_pid {
            return if covers(w.frame, ours.frame) {
                Foreground::Covered
            } else {
                Foreground::Beside
            };
        }
    }
    Foreground::Beside
}

#[cfg(windows)]
fn foreground(window: &WebviewWindow) -> Foreground {
    use windows_sys::Win32::Foundation::{HWND, RECT};
    use windows_sys::Win32::UI::WindowsAndMessaging::{
        GetForegroundWindow, GetWindowLongW, GetWindowRect, GetWindowThreadProcessId, GWL_EXSTYLE,
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
    // SAFETY: takes no pointers; a stale handle reads 0
    if is_overlay(unsafe { GetWindowLongW(front, GWL_EXSTYLE) } as u32) {
        return Foreground::Beside;
    }
    // both frames from GetWindowRect, so they share its pixels and its borders
    let ours = window.hwnd().ok().and_then(|h| frame(h.0 as HWND));
    match (frame(front), ours) {
        (Some(f), Some(o)) if covers(f, o) => Foreground::Covered,
        _ => Foreground::Beside,
    }
}

#[cfg(target_os = "macos")]
fn foreground(_window: &WebviewWindow) -> Foreground {
    use objc2::MainThreadMarker;
    use objc2_app_kit::NSApplication;
    // AppKit answers only on the main thread, where a command that is not async runs; off it the window list still decides
    if let Some(mtm) = MainThreadMarker::new() {
        if NSApplication::sharedApplication(mtm).isActive() {
            return Foreground::Ours;
        }
    }
    from_window_list(&window_list(), i64::from(std::process::id()))
}

// the windows on screen, front to back, with their frames in global points (top-left origin, as Frame takes them).
// Frames and owners need no Screen Recording permission; only window titles would
#[cfg(target_os = "macos")]
fn window_list() -> Vec<Listed> {
    use objc2_core_foundation::{CFDictionary, CFNumber, CFString, CGRect};
    use objc2_core_graphics::{
        kCGNullWindowID, kCGWindowAlpha, kCGWindowBounds, kCGWindowLayer, kCGWindowOwnerPID,
        CGRectMakeWithDictionaryRepresentation, CGWindowListCopyWindowInfo, CGWindowListOption,
    };
    let Some(list) = CGWindowListCopyWindowInfo(
        CGWindowListOption::OptionOnScreenOnly | CGWindowListOption::ExcludeDesktopElements,
        kCGNullWindowID,
    ) else {
        return Vec::new();
    };
    let mut out = Vec::new();
    for i in 0..list.count() {
        // SAFETY: every entry of the window list is a CFDictionary keyed by the kCGWindow* strings, which the list's
        // retain keeps alive while we read it; the keys are CoreGraphics' own static CFStrings
        let (dict, pid_key, layer_key, alpha_key, bounds_key) = unsafe {
            (
                &*(list.value_at_index(i) as *const CFDictionary),
                kCGWindowOwnerPID,
                kCGWindowLayer,
                kCGWindowAlpha,
                kCGWindowBounds,
            )
        };
        let get = |key: &CFString| unsafe { dict.value((key as *const CFString).cast()) };
        // SAFETY: the owner, layer and alpha values are CFNumbers, and the bounds a CFDictionary, by the API's contract
        let number = |key: &CFString| {
            let v = get(key);
            (!v.is_null()).then(|| unsafe { &*(v as *const CFNumber) })
        };
        let (Some(pid), Some(layer)) = (
            number(pid_key).and_then(|n| n.as_i64()),
            number(layer_key).and_then(|n| n.as_i64()),
        ) else {
            continue;
        };
        let alpha = number(alpha_key).and_then(|n| n.as_f64()).unwrap_or(1.0);
        let bounds = get(bounds_key);
        let mut rect = CGRect::ZERO;
        if bounds.is_null()
            || !unsafe {
                CGRectMakeWithDictionaryRepresentation(
                    Some(&*(bounds as *const CFDictionary)),
                    &mut rect,
                )
            }
        {
            continue;
        }
        out.push(Listed {
            pid,
            layer,
            alpha,
            frame: Frame {
                left: rect.origin.x.round() as i64,
                top: rect.origin.y.round() as i64,
                right: (rect.origin.x + rect.size.width).round() as i64,
                bottom: (rect.origin.y + rect.size.height).round() as i64,
            },
        });
    }
    out
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
            crate::applog::log_line("[tauri] taskbar button: app-reopen");
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
    fn an_overlay_is_a_topmost_or_tool_window() {
        // the lock screen (LockApp): WS_EX_NOREDIRECTIONBITMAP | WS_EX_TOPMOST
        assert!(is_overlay(0x200008));
        assert!(is_overlay(0x80));
        // a plain app window: WS_EX_WINDOWEDGE | WS_EX_APPWINDOW
        assert!(!is_overlay(0x40100));
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

    const US: i64 = 100;
    const MAC_SCREEN: Frame = Frame {
        left: 0,
        top: 30,
        right: 1872,
        bottom: 1080,
    };

    fn listed(pid: i64, layer: i64, frame: Frame) -> Listed {
        Listed {
            pid,
            layer,
            alpha: 1.0,
            frame,
        }
    }

    #[test]
    fn a_maximized_window_over_arcterm_covers_it_on_macos() {
        // as measured on a Mac: Chrome zoomed over a zoomed arcterm, which also has a small window of its own between them.
        // AppKit called arcterm's window visible here, since Chrome's window does not count as opaque
        let list = [
            listed(7, 0, MAC_SCREEN),
            listed(US, 0, f(159, 860, 439, 1028)),
            listed(US, 0, MAC_SCREEN),
        ];
        assert_eq!(from_window_list(&list, US), Foreground::Covered);
    }

    #[test]
    fn a_small_window_over_arcterm_leaves_it_beside() {
        let list = [
            listed(7, 0, f(400, 300, 1300, 900)),
            listed(US, 0, MAC_SCREEN),
        ];
        assert_eq!(from_window_list(&list, US), Foreground::Beside);
    }

    #[test]
    fn arcterm_on_no_screen_is_covered() {
        // a full-screen app's Space, or another Space, took the screen
        let list = [
            listed(7, 0, MAC_SCREEN),
            listed(8, 0, f(100, 100, 900, 700)),
        ];
        assert_eq!(from_window_list(&list, US), Foreground::Covered);
    }

    #[test]
    fn an_overlay_over_arcterm_leaves_it_beside() {
        // the screenshot tool or the lock screen sit above the normal level, and arcterm is still the frontmost window there
        let list = [
            listed(9, 25, MAC_SCREEN),
            listed(US, 0, MAC_SCREEN),
            listed(7, 0, MAC_SCREEN),
        ];
        assert_eq!(from_window_list(&list, US), Foreground::Beside);
    }

    #[test]
    fn only_a_window_above_arcterm_counts() {
        let list = [listed(US, 0, MAC_SCREEN), listed(7, 0, MAC_SCREEN)];
        assert_eq!(from_window_list(&list, US), Foreground::Beside);
    }

    #[test]
    fn an_invisible_window_over_arcterm_does_not_count() {
        let clear = Listed {
            alpha: 0.0,
            ..listed(7, 0, MAC_SCREEN)
        };
        let list = [clear, listed(US, 0, MAC_SCREEN)];
        assert_eq!(from_window_list(&list, US), Foreground::Beside);
    }

    #[test]
    fn the_frontmost_other_window_decides_on_macos() {
        // a small window of the app you went to, over a big one of another app: beside, as on Windows
        let list = [
            listed(7, 0, f(400, 300, 900, 700)),
            listed(8, 0, MAC_SCREEN),
            listed(US, 0, MAC_SCREEN),
        ];
        assert_eq!(from_window_list(&list, US), Foreground::Beside);
    }

    #[test]
    fn a_window_on_another_screen_leaves_arcterm_beside_on_macos() {
        let list = [
            listed(7, 0, f(1872, 0, 3792, 1080)),
            listed(US, 0, MAC_SCREEN),
        ];
        assert_eq!(from_window_list(&list, US), Foreground::Beside);
    }
}
