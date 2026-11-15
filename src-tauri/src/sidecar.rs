//! Sidecar, the second window (spec 2026-11-13-sidecar-design.md): a wall of every agent for another screen. Its page
//! (sidecar.html) is a slim one fed snapshots by the main window, like the tray popover's; this file is only the window.
//! The Ctrl+P row "Open Sidecar" invokes `open_sidecar`, which builds the window the first time and brings it forward
//! after. It opens on a screen other than the main window's when there is one (positioned in physical pixels after the
//! build, since screens of different scale make a logical position ambiguous), then maximized; with one screen it opens
//! centred. It closes with the main window (a main window hidden to the tray icon leaves it open), and tells the main
//! window when it is gone (`sidecar:closed`), so the bridge stops sending snapshots.

use std::sync::Mutex;

use tauri::{
    AppHandle, Emitter, Manager, PhysicalPosition, PhysicalSize, WebviewUrl, WebviewWindow,
    WebviewWindowBuilder, Window, WindowEvent,
};

use crate::applog::log_line;

pub const SIDECAR_LABEL: &str = "sidecar";
/// host → main window: the Sidecar window was destroyed (the person's close, or the main window's)
pub const CLOSED_EVENT: &str = "sidecar:closed";

// the dev app shares the packaged app's taskbar and Alt+Tab: its title tells the two apart
const TITLE: &str = if cfg!(debug_assertions) {
    "arcterm Sidecar (dev)"
} else {
    "arcterm Sidecar"
};

// logical px: the smallest the person can drag it to (the small form, spec 1a), and the size a first open takes on a
// screen that fits it
const MIN_SIZE: (f64, f64) = (340.0, 440.0);
const FIRST_SIZE: (f64, f64) = (1280.0, 800.0);
// a first open never takes more than this much of the screen it is centred on
const FIRST_SHARE: f64 = 0.9;

// a screen's work area (x, y, width, height) in physical pixels, the taskbar and the menu bar left out
type Screen = (i32, i32, u32, u32);

// two quick presses of Open Sidecar must not both find no window and both build one
static OPENING: Mutex<()> = Mutex::new(());

/// Where a first open goes: the screen (an index into the list given) and whether the window takes all of it.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct Pick {
    pub index: usize,
    pub maximize: bool,
}

fn holds(screen: Screen, point: (i32, i32)) -> bool {
    let (x, y, w, h) = screen;
    let (px, py) = (point.0 as i64, point.1 as i64);
    px >= x as i64 && px < x as i64 + w as i64 && py >= y as i64 && py < y as i64 + h as i64
}

/// The screen a first open goes to. With another screen, the largest one that does not hold the main window's centre,
/// maximized; the earlier one wins a tie. With one screen, or when none is known to hold the main window, that
/// screen (else the first), centred, not maximized. No screens: None, and the window takes the system's place.
pub fn pick_screen(main_centre: Option<(i32, i32)>, screens: &[Screen]) -> Option<Pick> {
    let on_main = |s: &Screen| main_centre.is_some_and(|c| holds(*s, c));
    if screens.len() >= 2 {
        let other = screens
            .iter()
            .enumerate()
            .filter(|(_, s)| !on_main(s))
            // key: the area, and the earlier index ahead of a later one (max_by_key keeps the last of equals)
            .max_by_key(|(i, s)| (s.2 as u64 * s.3 as u64, std::cmp::Reverse(*i)));
        if let Some((index, _)) = other {
            return Some(Pick {
                index,
                maximize: true,
            });
        }
    }
    let index =
        screens
            .iter()
            .position(on_main)
            .or(if screens.is_empty() { None } else { Some(0) })?;
    Some(Pick {
        index,
        maximize: false,
    })
}

/// The frame a first open takes on a screen, in physical pixels: FIRST_SIZE (logical, so `scale` converts it) cut to
/// 90% of the screen where it does not fit, and centred. A maximized window keeps it as the size an unmaximize goes
/// back to.
pub fn first_frame(screen: Screen, scale: f64) -> (i32, i32, u32, u32) {
    let scale = if scale.is_finite() && scale > 0.0 {
        scale
    } else {
        1.0
    };
    let (sx, sy, sw, sh) = screen;
    let w = (FIRST_SIZE.0 * scale).min(sw as f64 * FIRST_SHARE).round() as u32;
    let h = (FIRST_SIZE.1 * scale).min(sh as f64 * FIRST_SHARE).round() as u32;
    (sx + ((sw - w) / 2) as i32, sy + ((sh - h) / 2) as i32, w, h)
}

// the main window's centre in physical pixels; None while it cannot be read (it is gone)
fn main_centre(app: &AppHandle) -> Option<(i32, i32)> {
    let main = app.get_webview_window(crate::MAIN_WINDOW_LABEL)?;
    let pos = main.outer_position().ok()?;
    let size = main.outer_size().ok()?;
    Some((
        pos.x + (size.width / 2) as i32,
        pos.y + (size.height / 2) as i32,
    ))
}

// Place a window built hidden. The position goes first, so the window takes the scale of the screen it lands on before
// its physical size is set; the maximize after them leaves the frame as the size an unmaximize returns to.
fn place(app: &AppHandle, win: &WebviewWindow) {
    let monitors = match app.available_monitors() {
        Ok(m) => m,
        Err(e) => {
            log_line(&format!(
                "[sidecar] reading the screens failed: {e}; opening at the system's place"
            ));
            return;
        }
    };
    let screens: Vec<Screen> = monitors
        .iter()
        .map(|m| {
            let wa = m.work_area();
            (wa.position.x, wa.position.y, wa.size.width, wa.size.height)
        })
        .collect();
    let Some(pick) = pick_screen(main_centre(app), &screens) else {
        log_line("[sidecar] no screen is known; opening at the system's place");
        return;
    };
    let (x, y, w, h) = first_frame(screens[pick.index], monitors[pick.index].scale_factor());
    note(
        "setting the position",
        win.set_position(PhysicalPosition::new(x, y)),
    );
    note("setting the size", win.set_size(PhysicalSize::new(w, h)));
    if pick.maximize {
        note("maximizing", win.maximize());
    }
    log_line(&format!(
        "[sidecar] first open on screen {} of {}: {w}x{h} at {x},{y}{}",
        pick.index + 1,
        screens.len(),
        if pick.maximize { ", maximized" } else { "" }
    ));
}

fn note(what: &str, result: tauri::Result<()>) {
    if let Err(e) = result {
        log_line(&format!("[sidecar] {what} failed: {e}"));
    }
}

/// Open Sidecar: the window built hidden, placed and shown when there is none; unminimized, shown and focused when
/// there is one.
pub fn open(app: &AppHandle) -> tauri::Result<()> {
    let _one_at_a_time = OPENING.lock().unwrap_or_else(|e| e.into_inner());
    if let Some(win) = app.get_webview_window(SIDECAR_LABEL) {
        if win.is_minimized().unwrap_or(false) {
            win.unminimize()?;
        }
        win.show()?;
        return win.set_focus();
    }
    let win = WebviewWindowBuilder::new(app, SIDECAR_LABEL, WebviewUrl::App("sidecar.html".into()))
        .title(TITLE)
        .inner_size(FIRST_SIZE.0, FIRST_SIZE.1)
        .min_inner_size(MIN_SIZE.0, MIN_SIZE.1)
        .resizable(true)
        // the page draws its own title bar, as the main window's does
        .decorations(false)
        .visible(false)
        .build()?;
    // the exe's own multi-frame icon, as the main window takes, so the taskbar draws the frame made for its size
    #[cfg(windows)]
    if let Ok(hwnd) = win.hwnd() {
        let hwnd = hwnd.0 as isize;
        let _ = app.run_on_main_thread(move || crate::use_resource_window_icons(hwnd));
    }
    place(app, &win);
    win.show()?;
    win.set_focus()
}

// async: Tauri builds a window from a synchronous command on the main thread, which deadlocks on Windows
#[tauri::command]
pub async fn open_sidecar(app: AppHandle) -> Result<(), String> {
    open(&app).map_err(|e| {
        let msg = format!("opening Sidecar failed: {e}");
        log_line(&format!("[sidecar] {msg}"));
        msg
    })
}

/// The window events Sidecar cares about, from main.rs's one handler. The main window destroyed (not hidden to the tray
/// icon: that is a CloseRequested the host turns into a hide) closes Sidecar, which would otherwise keep the app running
/// with no terminals to open its agents in. Sidecar destroyed, by the person or by that, tells the main window.
pub fn on_window_event(window: &Window, event: &WindowEvent) {
    if !matches!(event, WindowEvent::Destroyed) {
        return;
    }
    match window.label() {
        crate::MAIN_WINDOW_LABEL => close_with_main(window.app_handle()),
        SIDECAR_LABEL => {
            let _ = window
                .app_handle()
                .emit_to(crate::MAIN_WINDOW_LABEL, CLOSED_EVENT, ());
        }
        _ => {}
    }
}

// destroy(), not close(): the person's own close is Sidecar's CloseRequested, and this is not that. Queued to run after
// the main window's event is through: a window torn down from another window's event tears down what is dispatching.
fn close_with_main(app: &AppHandle) {
    let handle = app.clone();
    let _ = app.run_on_main_thread(move || {
        if let Some(win) = handle.get_webview_window(SIDECAR_LABEL) {
            log_line("[sidecar] the main window is gone: closing Sidecar");
            let _ = win.destroy();
        }
    });
}

#[cfg(test)]
mod tests {
    use super::*;

    // a 2940x1912 laptop panel and a 4K screen to its right, as physical work areas
    const LAPTOP: Screen = (0, 0, 2940, 1912);
    const FOUR_K: Screen = (2940, 0, 3840, 2160);
    const FULL_HD: Screen = (-1920, 0, 1920, 1040);

    #[test]
    fn sidecar_opens_on_the_other_screen_maximized() {
        // the main window's centre is on the laptop panel
        let pick = pick_screen(Some((1470, 956)), &[LAPTOP, FOUR_K]);
        assert_eq!(
            pick,
            Some(Pick {
                index: 1,
                maximize: true
            })
        );
        // and the other way round
        let pick = pick_screen(Some((4860, 1080)), &[LAPTOP, FOUR_K]);
        assert_eq!(
            pick,
            Some(Pick {
                index: 0,
                maximize: true
            })
        );
    }

    #[test]
    fn sidecar_takes_the_largest_of_several_other_screens() {
        // main on the laptop; a full HD to its left and a 4K to its right: the 4K is the larger
        let pick = pick_screen(Some((1470, 956)), &[LAPTOP, FULL_HD, FOUR_K]);
        assert_eq!(
            pick,
            Some(Pick {
                index: 2,
                maximize: true
            })
        );
        // main on the 4K: the laptop panel is larger than the full HD
        let pick = pick_screen(Some((4860, 1080)), &[FULL_HD, LAPTOP, FOUR_K]);
        assert_eq!(
            pick,
            Some(Pick {
                index: 1,
                maximize: true
            })
        );
    }

    #[test]
    fn sidecar_leaves_the_earlier_of_two_equal_screens() {
        let a: Screen = (-1920, 0, 1920, 1080);
        let b: Screen = (1920, 0, 1920, 1080);
        let pick = pick_screen(Some((960, 540)), &[(0, 0, 1920, 1080), a, b]);
        assert_eq!(
            pick,
            Some(Pick {
                index: 1,
                maximize: true
            })
        );
    }

    #[test]
    fn sidecar_with_one_screen_is_centred_not_maximized() {
        assert_eq!(
            pick_screen(Some((1470, 956)), &[LAPTOP]),
            Some(Pick {
                index: 0,
                maximize: false
            })
        );
        // a main window parked off every screen (minimized) leaves the one screen the choice
        assert_eq!(
            pick_screen(Some((-32000, -32000)), &[LAPTOP]),
            Some(Pick {
                index: 0,
                maximize: false
            })
        );
        assert_eq!(
            pick_screen(None, &[LAPTOP]),
            Some(Pick {
                index: 0,
                maximize: false
            })
        );
    }

    #[test]
    fn sidecar_with_a_main_window_on_no_screen_takes_the_largest() {
        let pick = pick_screen(Some((-32000, -32000)), &[LAPTOP, FOUR_K]);
        assert_eq!(
            pick,
            Some(Pick {
                index: 1,
                maximize: true
            })
        );
    }

    #[test]
    fn sidecar_with_no_screens_picks_none() {
        assert_eq!(pick_screen(Some((10, 10)), &[]), None);
        assert_eq!(pick_screen(None, &[]), None);
    }

    #[test]
    fn sidecar_screen_edges_belong_to_the_screen_they_start() {
        // x = 2940 is the 4K's first column, not the laptop's last
        let pick = pick_screen(Some((2940, 0)), &[LAPTOP, FOUR_K]);
        assert_eq!(
            pick,
            Some(Pick {
                index: 0,
                maximize: true
            })
        );
        let pick = pick_screen(Some((2939, 0)), &[LAPTOP, FOUR_K]);
        assert_eq!(
            pick,
            Some(Pick {
                index: 1,
                maximize: true
            })
        );
    }

    #[test]
    fn sidecar_first_frame_is_1280_by_800_centred_where_it_fits() {
        assert_eq!(first_frame((0, 0, 1920, 1040), 1.0), (320, 120, 1280, 800));
        // a screen that is not at the origin
        assert_eq!(
            first_frame((2940, 0, 3840, 2160), 1.0),
            (2940 + 1280, 680, 1280, 800)
        );
    }

    #[test]
    fn sidecar_first_frame_is_cut_to_90_percent_of_a_small_screen() {
        // 1366x728 work area: 90% is 1229x655
        let (x, y, w, h) = first_frame((0, 0, 1366, 728), 1.0);
        assert_eq!((w, h), (1229, 655));
        assert_eq!((x, y), ((1366 - 1229) / 2, (728 - 655) / 2));
    }

    #[test]
    fn sidecar_first_frame_scales_the_logical_size_to_physical() {
        // at 2x, 1280x800 logical is 2560x1600 physical and fits a 2940x1912 panel
        assert_eq!(first_frame(LAPTOP, 2.0), (190, 156, 2560, 1600));
        // at 1.5x it is 1920x1200
        assert_eq!(first_frame(LAPTOP, 1.5), (510, 356, 1920, 1200));
    }

    #[test]
    fn sidecar_first_frame_takes_a_bad_scale_as_one() {
        for bad in [0.0, -2.0, f64::NAN, f64::INFINITY] {
            assert_eq!(first_frame((0, 0, 1920, 1040), bad), (320, 120, 1280, 800));
        }
    }

    // the dev app shares the packaged app's taskbar and Alt+Tab
    #[test]
    fn sidecar_a_dev_build_says_so_in_its_title() {
        assert_eq!(TITLE, "arcterm Sidecar (dev)");
    }

    // Sidecar's page runs no cockpit code, so its capability is the title bar's and nothing else: a window label that
    // drifts from the file, or a permission added to it, shows here
    #[test]
    fn sidecar_capability_names_this_window_and_the_title_bars_permissions_only() {
        let caps: serde_json::Value =
            serde_json::from_str(include_str!("../capabilities/sidecar.json"))
                .expect("sidecar.json is JSON");
        assert_eq!(caps["windows"], serde_json::json!([SIDECAR_LABEL]));
        let mut got: Vec<&str> = caps["permissions"]
            .as_array()
            .expect("permissions")
            .iter()
            .map(|p| p.as_str().expect("a plain permission"))
            .collect();
        got.sort_unstable();
        let mut want = vec![
            "core:event:default",
            "core:window:allow-start-dragging",
            "core:window:allow-internal-toggle-maximize",
            "core:window:allow-minimize",
            "core:window:allow-toggle-maximize",
            "core:window:allow-close",
            "core:window:allow-set-fullscreen",
            "core:window:allow-is-fullscreen",
            "core:window:allow-inner-size",
            "core:window:allow-set-size",
            "core:window:allow-set-position",
            "core:window:allow-set-always-on-top",
        ];
        want.sort_unstable();
        assert_eq!(got, want);
    }
}
