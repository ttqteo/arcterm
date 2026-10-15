// Where the OS's foreground is, for the fold that follows you out of the app (floatstore.ts window:autosprout). The main
// window losing focus is not enough to fold:
// - "ours": a file dialog, the color picker or another arcterm window took the focus; folding under them would be wrong.
// - "covered": another app took it, and its window hides most of arcterm, so the fold keeps arcterm in sight as a
//   picture-in-picture would. On Windows only a maximized or full-screen window on arcterm's screen counts.
// - "beside": another app took it but arcterm still shows next to it (a small or merely big window, a dialog or popup, a
//   window on another screen, another desktop on a Mac), or an overlay took it: the screenshot tool, the lock screen, Alt+Tab's switcher or the
//   Start menu cover the whole screen for a moment, which is no leaving arcterm. Folding would hide a cockpit you are
//   coming back to, and a popup that steals the focus while you watch something must not fold it.
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

// Windows' answer for another app's foreground window: it hides arcterm only as an app's own top-level window (an owned
// one is a dialog or popup) that is maximized or fills its screen, the screen arcterm is on.
#[cfg_attr(not(windows), allow(dead_code))]
fn covered_on_windows(
    front: Frame,
    ours: Frame,
    screen: Option<Frame>,
    maximized: bool,
    owned: bool,
) -> bool {
    let fills = |s: Frame| {
        front.left <= s.left
            && front.top <= s.top
            && front.right >= s.right
            && front.bottom >= s.bottom
    };
    !owned && (maximized || screen.is_some_and(fills)) && covers(front, ours)
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
// none on screen means another Space took the screen: a full-screen app's folds, so Sprout shows over it, but another
// desktop leaves arcterm beside, on its own desktop, where ⌘Tab takes the screen back to it. Folded there, Sprout would
// follow you and grow back on the desktop you clicked it on, moving arcterm off its own. Otherwise the frontmost normal
// window of another app above it decides, as the foreground window does on Windows; none above it (an overlay took the
// focus) leaves it beside.
#[cfg_attr(not(target_os = "macos"), allow(dead_code))]
fn from_window_list(list: &[Listed], our_pid: i64, desktop_on_screen: bool) -> Foreground {
    let normal = |w: &&Listed| w.layer == 0 && w.alpha > 0.0;
    let Some(ours) = list
        .iter()
        .filter(normal)
        .filter(|w| w.pid == our_pid)
        .max_by_key(|w| area(w.frame))
    else {
        return if desktop_on_screen {
            Foreground::Beside
        } else {
            Foreground::Covered
        };
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
    use windows_sys::Win32::Graphics::Gdi::{
        GetMonitorInfoW, MonitorFromWindow, MONITORINFO, MONITOR_DEFAULTTONULL,
    };
    use windows_sys::Win32::UI::WindowsAndMessaging::{
        GetForegroundWindow, GetWindow, GetWindowLongW, GetWindowRect, GetWindowThreadProcessId,
        IsZoomed, GWL_EXSTYLE, GW_OWNER,
    };

    fn screen(hwnd: HWND) -> Option<Frame> {
        // SAFETY: takes no pointers; a stale handle gives no monitor
        let monitor = unsafe { MonitorFromWindow(hwnd, MONITOR_DEFAULTTONULL) };
        if monitor.is_null() {
            return None;
        }
        // SAFETY: zeroed is a valid MONITORINFO; cbSize is set and the out-param lives on this stack
        let mut info: MONITORINFO = unsafe { std::mem::zeroed() };
        info.cbSize = std::mem::size_of::<MONITORINFO>() as u32;
        if unsafe { GetMonitorInfoW(monitor, &mut info) } == 0 {
            return None;
        }
        let r = info.rcMonitor;
        Some(Frame {
            left: r.left as i64,
            top: r.top as i64,
            right: r.right as i64,
            bottom: r.bottom as i64,
        })
    }

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
    // SAFETY: take no pointers; a stale handle reads as neither maximized nor owned
    let (maximized, owned) =
        unsafe { (IsZoomed(front) != 0, !GetWindow(front, GW_OWNER).is_null()) };
    match (frame(front), ours) {
        (Some(f), Some(o)) if covered_on_windows(f, o, screen(front), maximized, owned) => {
            Foreground::Covered
        }
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
    from_window_list(
        &window_list(),
        i64::from(std::process::id()),
        desktop_on_screen(),
    )
}

// Whether the Space on screen is a desktop rather than a full-screen app's. AppKit has no public answer, so this asks the
// window server's own calls (CGSSpaceGetType: 0 a desktop, 4 a full-screen app's Space), looked up at run time: a macOS
// without them reads as no desktop, the fold's answer from before, instead of keeping arcterm from launching.
#[cfg(target_os = "macos")]
fn desktop_on_screen() -> bool {
    use std::ffi::{c_char, c_void, CStr};
    use std::sync::OnceLock;

    type MainConnectionId = unsafe extern "C" fn() -> i32;
    type GetActiveSpace = unsafe extern "C" fn(i32) -> u64;
    type SpaceGetType = unsafe extern "C" fn(i32, u64) -> i32;
    extern "C" {
        fn dlsym(handle: *mut c_void, symbol: *const c_char) -> *mut c_void;
    }
    // RTLD_DEFAULT: every image loaded, CoreGraphics among them
    const RTLD_DEFAULT: *mut c_void = -2isize as *mut c_void;
    const DESKTOP: i32 = 0;

    static CALLS: OnceLock<Option<(MainConnectionId, GetActiveSpace, SpaceGetType)>> =
        OnceLock::new();
    let calls = CALLS.get_or_init(|| {
        // SAFETY: dlsym takes a NUL-terminated name and only reads it
        let find = |name: &CStr| {
            let ptr = unsafe { dlsym(RTLD_DEFAULT, name.as_ptr()) };
            (!ptr.is_null()).then_some(ptr)
        };
        let (connection, active, kind) = (
            find(c"CGSMainConnectionID")?,
            find(c"CGSGetActiveSpace")?,
            find(c"CGSSpaceGetType")?,
        );
        // SAFETY: the window server's exports with these C signatures, as yabai and Hammerspoon call them
        Some(unsafe {
            (
                std::mem::transmute::<*mut c_void, MainConnectionId>(connection),
                std::mem::transmute::<*mut c_void, GetActiveSpace>(active),
                std::mem::transmute::<*mut c_void, SpaceGetType>(kind),
            )
        })
    });
    let Some((connection, active, kind)) = *calls else {
        return false;
    };
    // SAFETY: plain values in and out; an unknown Space reads as no desktop
    unsafe {
        let cid = connection();
        let space = active(cid);
        space != 0 && kind(cid, space) == DESKTOP
    }
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

// Lift the folded window above every other (floatstore.ts foldToSprout). Windows lifts a window above the foreground one
// only for a process allowed to take the foreground, and the fold that follows you out comes after another app took it:
// tao's always-on-top then sets the TOPMOST style but leaves Sprout under that app. Joined to the foreground window's
// thread for the call, the lift goes through, without taking the focus. A sync command, so it runs on the main thread,
// the window's. Answers how it went, for the fold's log line.
#[tauri::command]
pub fn raise_topmost(window: WebviewWindow) -> &'static str {
    #[cfg(windows)]
    {
        use windows_sys::Win32::Foundation::HWND;
        use windows_sys::Win32::System::Threading::{AttachThreadInput, GetCurrentThreadId};
        use windows_sys::Win32::UI::WindowsAndMessaging::{
            GetForegroundWindow, GetWindowThreadProcessId, SetWindowPos, HWND_TOPMOST,
            SWP_NOACTIVATE, SWP_NOMOVE, SWP_NOSIZE,
        };
        let Ok(h) = window.hwnd() else {
            return "no window";
        };
        // SAFETY: takes no pointers but the null out-param GetWindowThreadProcessId allows; stale handles only fail
        unsafe {
            let me = GetCurrentThreadId();
            let front = GetForegroundWindow();
            let them = if front.is_null() {
                0
            } else {
                GetWindowThreadProcessId(front, std::ptr::null_mut())
            };
            let joined = them != 0 && them != me && AttachThreadInput(me, them, 1) != 0;
            let lifted = SetWindowPos(
                h.0 as HWND,
                HWND_TOPMOST,
                0,
                0,
                0,
                0,
                SWP_NOMOVE | SWP_NOSIZE | SWP_NOACTIVATE,
            ) != 0;
            if joined {
                AttachThreadInput(me, them, 0);
            }
            match (lifted, joined) {
                (false, _) => "failed",
                (true, true) => "lifted, joined to the foreground",
                (true, false) => "lifted alone",
            }
        }
    }
    #[cfg(not(windows))]
    {
        let _ = window;
        "not needed"
    }
}

// A click on arcterm's taskbar button brings a window folded into Sprout back, as the Dock icon does on macOS (main.rs
// emits "app-reopen" there; floatstore.ts grows the window back on it). Windows has no reopen event, so the host watches
// the foreground: the main window taking it straight from the taskbar is a click on its button, while Alt+Tab comes from
// the switcher and only focuses Sprout. A click on the button of the window already in front minimizes it instead, so
// that minimize counts too. The frontend lets both pass unless the window is folded.
// Every time the main window takes the foreground the host also emits "main-foreground": the folded window's focus event
// cannot tell a return to arcterm, since the fold's own window changes activate it inside its thread while another app
// stays in front, and the real return then brings no new focus event.

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
        if event == EVENT_SYSTEM_FOREGROUND {
            if let Some(app) = APP.get() {
                let _ = app.emit("main-foreground", ());
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
    fn on_windows_only_a_maximized_or_full_screen_app_window_covers() {
        let ours = f(0, 0, 1920, 1040);
        let screen = Some(f(0, 0, 1920, 1080));
        // a maximized window, its frame overhanging the work area
        assert!(covered_on_windows(
            f(-8, -8, 1928, 1048),
            ours,
            screen,
            true,
            false
        ));
        // full screen: a borderless window over the whole screen
        assert!(covered_on_windows(
            f(0, 0, 1920, 1080),
            ours,
            screen,
            false,
            false
        ));
        // a big window that is neither: ~86% of arcterm, which used to fold it
        assert!(!covered_on_windows(
            f(60, 40, 1860, 990),
            ours,
            screen,
            false,
            false
        ));
        // a dialog or popup the app owns, even one as big as the screen
        assert!(!covered_on_windows(
            f(0, 0, 1920, 1080),
            ours,
            screen,
            false,
            true
        ));
        // maximized on another screen
        assert!(!covered_on_windows(
            f(1912, -8, 3848, 1048),
            ours,
            Some(f(1920, 0, 3840, 1080)),
            true,
            false
        ));
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
        assert_eq!(from_window_list(&list, US, true), Foreground::Covered);
    }

    #[test]
    fn a_small_window_over_arcterm_leaves_it_beside() {
        let list = [
            listed(7, 0, f(400, 300, 1300, 900)),
            listed(US, 0, MAC_SCREEN),
        ];
        assert_eq!(from_window_list(&list, US, true), Foreground::Beside);
    }

    #[test]
    fn arcterm_under_a_full_screen_app_is_covered() {
        // a full-screen app's Space took the screen
        let list = [listed(7, 0, MAC_SCREEN)];
        assert_eq!(from_window_list(&list, US, false), Foreground::Covered);
    }

    #[test]
    fn arcterm_left_on_another_desktop_is_beside() {
        // another desktop took the screen: arcterm stays on its own, unfolded
        let list = [
            listed(7, 0, MAC_SCREEN),
            listed(8, 0, f(100, 100, 900, 700)),
        ];
        assert_eq!(from_window_list(&list, US, true), Foreground::Beside);
    }

    #[test]
    fn an_overlay_over_arcterm_leaves_it_beside() {
        // the screenshot tool or the lock screen sit above the normal level, and arcterm is still the frontmost window there
        let list = [
            listed(9, 25, MAC_SCREEN),
            listed(US, 0, MAC_SCREEN),
            listed(7, 0, MAC_SCREEN),
        ];
        assert_eq!(from_window_list(&list, US, true), Foreground::Beside);
    }

    #[test]
    fn only_a_window_above_arcterm_counts() {
        let list = [listed(US, 0, MAC_SCREEN), listed(7, 0, MAC_SCREEN)];
        assert_eq!(from_window_list(&list, US, true), Foreground::Beside);
    }

    #[test]
    fn an_invisible_window_over_arcterm_does_not_count() {
        let clear = Listed {
            alpha: 0.0,
            ..listed(7, 0, MAC_SCREEN)
        };
        let list = [clear, listed(US, 0, MAC_SCREEN)];
        assert_eq!(from_window_list(&list, US, true), Foreground::Beside);
    }

    #[test]
    fn the_frontmost_other_window_decides_on_macos() {
        // a small window of the app you went to, over a big one of another app: beside, as on Windows
        let list = [
            listed(7, 0, f(400, 300, 900, 700)),
            listed(8, 0, MAC_SCREEN),
            listed(US, 0, MAC_SCREEN),
        ];
        assert_eq!(from_window_list(&list, US, true), Foreground::Beside);
    }

    #[test]
    fn a_window_on_another_screen_leaves_arcterm_beside_on_macos() {
        let list = [
            listed(7, 0, f(1872, 0, 3792, 1080)),
            listed(US, 0, MAC_SCREEN),
        ];
        assert_eq!(from_window_list(&list, US, true), Foreground::Beside);
    }
}
