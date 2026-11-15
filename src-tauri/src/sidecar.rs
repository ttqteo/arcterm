//! Sidecar, the second window (spec 2026-11-13-sidecar-design.md): a wall of every agent for another screen. Its page
//! (sidecar.html) is a slim one fed snapshots by the main window, like the tray popover's; this file is only the window.
//! The Ctrl+P row "Open Sidecar" invokes `open_sidecar`, which builds the window the first time and brings it forward
//! after. It opens on a screen other than the main window's when there is one (positioned in physical pixels after the
//! build, since screens of different scale make a logical position ambiguous), then maximized; with one screen it opens
//! centred. It closes with the main window (a main window hidden to the tray icon leaves it open), and tells the main
//! window when it is gone (`sidecar:closed`), so the bridge stops sending snapshots.
//!
//! It reopens as last time: its frame is kept as it moves and resizes (the way winframe.rs keeps the main window's, from
//! the same `Frame`, `next_frame` and `on_screen`), and `open`, the frame and full screen are written to
//! sidecar-frame.json in the app config dir at exit. `open` turns false only on the person's own close (the window's
//! `CloseRequested`): the main window's destroy and a quit leave it true, since neither raises a `CloseRequested` on
//! Sidecar (`app.exit` goes `ExitRequested`, then out of the event loop, in tauri-runtime-wry; macOS's
//! `applicationWillTerminate` sends no `windowShouldClose` either), so the next launch reopens it. A reopen in the same
//! session uses the frame kept in memory.

use std::sync::{Mutex, MutexGuard};

use serde::{Deserialize, Serialize};
use tauri::{
    AppHandle, Emitter, Manager, PhysicalPosition, PhysicalSize, WebviewUrl, WebviewWindow,
    WebviewWindowBuilder, Window, WindowEvent,
};

use crate::applog::log_line;
use crate::winframe::{self, Frame, Seen};

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

/// The main window's screen: the one holding its centre, else the first. None when no screen is known.
pub fn main_screen(main_centre: Option<(i32, i32)>, screens: &[Screen]) -> Option<usize> {
    screens
        .iter()
        .position(|s| main_centre.is_some_and(|c| holds(*s, c)))
        .or(if screens.is_empty() { None } else { Some(0) })
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
    Some(Pick {
        index: main_screen(main_centre, screens)?,
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

// the dev app shares the packaged app's identifier, and so its config dir: a file of its own keeps a quit dev window from
// moving the installed Sidecar (winframe.rs does the same for the main window)
const FILE: &str = if cfg!(debug_assertions) {
    "sidecar-frame-dev.json"
} else {
    "sidecar-frame.json"
};

/// What the S button puts back: the frame Sidecar had before it shrank (as `Remembered::frame` keeps one: a maximized
/// window's is the frame under it) and whether it was full screen.
#[derive(Clone, Copy, Debug, PartialEq, Serialize, Deserialize)]
pub struct Back {
    pub frame: Frame,
    pub fullscreen: bool,
}

/// What Sidecar keeps across launches. A field a file does not hold reads as its default, so a field a later version adds
/// leaves an older file readable (part 1's has neither `small` nor `pinned`: not small, not pinned), and one this version
/// does not know is ignored.
#[derive(Clone, Copy, Debug, Default, PartialEq, Serialize, Deserialize)]
#[serde(default)]
pub struct Remembered {
    /// open when arcterm closed: false only after the person's own close
    pub open: bool,
    /// the frame to go back to, as winframe.rs keeps one: the outer position and inner size in physical pixels, and under
    /// a maximized window the frame it unmaximizes to. In the small form it is the small window's own.
    pub frame: Option<Frame>,
    pub fullscreen: bool,
    /// the small form (the S button, spec 1a): Some holds the frame S returns to. A window dragged wider stays small,
    /// only the page's layout follows its width.
    pub small: Option<Back>,
    /// always on top. The S button pins with the shrink and unpins with the restore; the pin button turns it off and on
    /// by itself.
    pub pinned: bool,
}

/// Something that happened to the window.
#[derive(Clone, Copy, Debug)]
pub enum Change {
    /// built and shown
    Opened,
    /// the person closed it (its `CloseRequested`)
    ClosedByPerson,
    /// destroyed: after the person's close, or by the main window going. Not the person's doing in the second case, so it
    /// leaves `open` as it was.
    Destroyed,
    /// a move or resize left it so
    Seen(Seen),
    /// placed at this frame by the host: a fresh frame, so neither small nor pinned any more
    Placed(Frame),
    /// the S button shrank it to `frame` and pinned it, leaving full screen and unmaximizing first; `back` is what a
    /// press of S puts back
    Shrunk { back: Back, frame: Frame },
    /// the S button put it back as `Back` says, and unpinned it
    Restored(Back),
    /// always on top turned on or off
    Pinned(bool),
}

impl Remembered {
    pub fn after(self, change: Change) -> Remembered {
        match change {
            Change::Opened => Remembered { open: true, ..self },
            Change::ClosedByPerson => Remembered {
                open: false,
                ..self
            },
            Change::Destroyed => self,
            // a window the person closed is on its way out: what it does while it goes is not where it was
            Change::Seen(_) if !self.open => self,
            Change::Seen(seen) => Remembered {
                frame: winframe::next_frame(self.frame, seen),
                // a minimized window keeps the state it was in, as next_frame keeps its frame
                fullscreen: if seen.minimized {
                    self.fullscreen
                } else {
                    seen.fullscreen
                },
                ..self
            },
            Change::Placed(frame) => Remembered {
                frame: Some(frame),
                fullscreen: false,
                small: None,
                pinned: false,
                ..self
            },
            Change::Shrunk { back, frame } => Remembered {
                frame: Some(frame),
                fullscreen: false,
                small: Some(back),
                pinned: true,
                ..self
            },
            Change::Restored(back) => Remembered {
                frame: Some(back.frame),
                fullscreen: back.fullscreen,
                small: None,
                pinned: false,
                ..self
            },
            Change::Pinned(pinned) => Remembered { pinned, ..self },
        }
    }

    /// The form the page shows its button states from.
    pub fn form(&self) -> SidecarForm {
        SidecarForm {
            small: self.small.is_some(),
            pinned: self.pinned,
        }
    }
}

/// What the page asks of `sidecar_form`. A field left out changes nothing; both left out reads the form.
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq, Deserialize)]
#[serde(default)]
pub struct FormChange {
    /// true shrinks to the small form and pins; false puts it back and unpins
    pub small: Option<bool>,
    /// always on top only, whatever the size
    pub pinned: Option<bool>,
}

/// The window's form, as `sidecar_form` answers.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize)]
pub struct SidecarForm {
    pub small: bool,
    pub pinned: bool,
}

/// One thing a form change does to the window.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Step {
    /// leave full screen and unmaximize, take the small frame, pin
    Shrink,
    /// unpin, put back the frame S returns to
    Restore,
    /// always on top on or off, the size left alone
    Pin(bool),
}

/// The steps a change takes from what is kept, in order. Small first, then an explicit pin over it, so
/// `{small: true, pinned: false}` shrinks without the pin. A step that would change nothing is left out: shrinking a
/// small window, or restoring one that is not small.
pub fn steps(kept: &Remembered, change: FormChange) -> Vec<Step> {
    let mut out = Vec::new();
    let mut pinned = kept.pinned;
    let small = kept.small.is_some();
    match change.small {
        Some(true) if !small => {
            out.push(Step::Shrink);
            pinned = true;
        }
        Some(false) if small => {
            out.push(Step::Restore);
            pinned = false;
        }
        // not small: nothing to put back, and "restores and unpins" leaves it unpinned
        Some(false) if pinned => {
            out.push(Step::Pin(false));
            pinned = false;
        }
        _ => {}
    }
    if let Some(want) = change.pinned {
        if want != pinned {
            out.push(Step::Pin(want));
        }
    }
    out
}

// a window's rect in physical pixels: x, y, width, height (the outer position and the inner size, as `Seen` has them)
type Rect = (i32, i32, u32, u32);

// logical px: the small form is the smallest the window goes (spec 1a)
const SMALL_SIZE: (f64, f64) = MIN_SIZE;

fn good_scale(scale: Option<f64>) -> f64 {
    match scale {
        Some(s) if s.is_finite() && s > 0.0 => s,
        _ => 1.0,
    }
}

/// The frame the S button shrinks the window to, in physical pixels: 340x440 logical at the scale of the screen holding
/// the window's centre (else the first), keeping the window's top-right corner where it was, then moved into that
/// screen's work area. `from` is the window as it is, maximized or full screen included, so a maximized Sidecar shrinks
/// to its screen's top-right corner. A screen smaller than the form cuts it. With no screen known the corner stays and
/// the scale is 1.
pub fn small_frame(from: Rect, screens: &[Screen], scales: &[f64]) -> Rect {
    let (fx, fy, fw, fh) = from;
    let index = main_screen(Some((fx + (fw / 2) as i32, fy + (fh / 2) as i32)), screens);
    let scale = good_scale(index.and_then(|i| scales.get(i).copied()));
    let mut w = (SMALL_SIZE.0 * scale).round() as i64;
    let mut h = (SMALL_SIZE.1 * scale).round() as i64;
    let right = fx as i64 + fw as i64;
    let mut x = right - w;
    let mut y = fy as i64;
    if let Some(i) = index {
        let (sx, sy, sw, sh) = screens[i];
        let (sx, sy, sw, sh) = (sx as i64, sy as i64, sw as i64, sh as i64);
        w = w.min(sw);
        h = h.min(sh);
        x = (right - w).clamp(sx, sx + sw - w);
        y = y.clamp(sy, sy + sh - h);
    }
    (x as i32, y as i32, w as u32, h as u32)
}

/// What the S button returns to, taken from what is kept (refreshed from the window just before) when it shrinks: the
/// kept frame, which under a maximized or full-screen window is the frame beneath, and the full-screen flag. A window
/// whose frame is not kept yet gives the frame it has.
pub fn back_from(kept: &Remembered, seen: Seen) -> Back {
    Back {
        frame: kept.frame.unwrap_or(Frame {
            x: seen.x,
            y: seen.y,
            width: seen.width,
            height: seen.height,
            maximized: seen.maximized,
        }),
        fullscreen: kept.fullscreen,
    }
}

/// Where a restore puts the window: `back` as it was, unless its frame is on no screen now (the screen was unplugged
/// while Sidecar was small), then the first-open frame, centred, on the screen holding the window's centre. With no
/// screen known `back` stands.
pub fn restore_to(back: Back, from: Rect, screens: &[Screen], scales: &[f64]) -> Back {
    if screens.is_empty() || winframe::on_screen(&back.frame, screens) {
        return back;
    }
    let (fx, fy, fw, fh) = from;
    let Some(i) = main_screen(Some((fx + (fw / 2) as i32, fy + (fh / 2) as i32)), screens) else {
        return back;
    };
    let (x, y, width, height) = first_frame(screens[i], good_scale(scales.get(i).copied()));
    Back {
        frame: Frame {
            x,
            y,
            width,
            height,
            maximized: false,
        },
        fullscreen: false,
    }
}

/// Whether a window just placed goes always on top: the pin kept, as the place left it (a place at a fresh frame clears
/// it).
pub fn pin_on_open(kept: &Remembered) -> bool {
    kept.pinned
}

/// Where a window goes when it is built.
#[derive(Clone, Copy, Debug, PartialEq)]
pub enum Place {
    /// back where it was, full screen after it is shown if it was
    Frame { frame: Frame, fullscreen: bool },
    /// the screen it was on is gone: maximized on the main window's screen
    MainScreen,
    /// no frame is kept: the first-open rule (`pick_screen`)
    First,
}

/// The place for a window built now, from the frame kept and the screens there are.
pub fn place_for(kept: &Remembered, screens: &[Screen]) -> Place {
    match kept.frame {
        None => Place::First,
        Some(frame) if winframe::on_screen(&frame, screens) => Place::Frame {
            frame,
            fullscreen: kept.fullscreen,
        },
        Some(_) => Place::MainScreen,
    }
}

/// What a launch does with the file it read: nothing when Sidecar was not open, else where the window goes.
pub fn launch_place(saved: &Remembered, screens: &[Screen]) -> Option<Place> {
    saved.open.then(|| place_for(saved, screens))
}

fn parse(text: &str) -> Result<Remembered, serde_json::Error> {
    serde_json::from_str(text)
}

struct Kept {
    state: Remembered,
    // set when something differs from what the file held, so a launch that opened nothing and moved nothing leaves the
    // file as it was
    changed: bool,
}

// Never held across a call on a window: a getter from another thread waits on the main thread, and the main thread's
// event handler may be waiting here.
static KEPT: Mutex<Kept> = Mutex::new(Kept {
    state: Remembered {
        open: false,
        frame: None,
        fullscreen: false,
        small: None,
        pinned: false,
    },
    changed: false,
});

// What a launch keeps of the file it read: all of it, the small form's frame for S and the pin included, and nothing
// changed yet, so a launch that moves and resizes nothing leaves the file as it was.
fn kept_at_launch(saved: Remembered) -> Kept {
    Kept {
        state: saved,
        changed: false,
    }
}

fn kept() -> MutexGuard<'static, Kept> {
    KEPT.lock().unwrap_or_else(|e| e.into_inner())
}

fn current() -> Remembered {
    kept().state
}

fn apply(change: Change) {
    let mut k = kept();
    let next = k.state.after(change);
    if next != k.state {
        k.state = next;
        k.changed = true;
    }
}

// read the window as it is now and keep it
fn sample(app: &AppHandle) {
    if let Some(win) = app.get_webview_window(SIDECAR_LABEL) {
        if let Some(seen) = winframe::seen(&win) {
            apply(Change::Seen(seen));
        }
    }
}

fn read(app: &AppHandle) -> Remembered {
    let Ok(dir) = app.path().app_config_dir() else {
        return Remembered::default();
    };
    match std::fs::read_to_string(dir.join(FILE)) {
        Ok(text) => parse(&text).unwrap_or_else(|e| {
            log_line(&format!(
                "[sidecar] {FILE} is unreadable ({e}); starting fresh"
            ));
            Remembered::default()
        }),
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => Remembered::default(),
        Err(e) => {
            log_line(&format!("[sidecar] reading {FILE} failed: {e}"));
            Remembered::default()
        }
    }
}

/// At exit: what is kept, if this launch changed any of it.
pub fn save(app: &AppHandle) {
    let state = {
        let k = kept();
        if !k.changed {
            return;
        }
        k.state
    };
    let Ok(dir) = app.path().app_config_dir() else {
        return;
    };
    let write = std::fs::create_dir_all(&dir).and_then(|_| {
        std::fs::write(
            dir.join(FILE),
            serde_json::to_string(&state).unwrap_or_default(),
        )
    });
    if let Err(e) = write {
        log_line(&format!("[sidecar] saving {FILE} failed: {e}"));
    }
}

/// Just before arcterm exits, the windows still there: read Sidecar once more, so a full-screen toggle that left its size
/// as it was (no resize event) is not lost.
pub fn on_exit_requested(app: &AppHandle) {
    sample(app);
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

// the screens' work areas, and each one's scale
fn screens_of(app: &AppHandle) -> tauri::Result<(Vec<Screen>, Vec<f64>)> {
    Ok(app
        .available_monitors()?
        .iter()
        .map(|m| {
            let wa = m.work_area();
            (
                (wa.position.x, wa.position.y, wa.size.width, wa.size.height),
                m.scale_factor(),
            )
        })
        .unzip())
}

// The window at the first frame on a screen, and that frame kept as the one an unmaximize returns to. The position goes
// first, so the window takes the scale of the screen it lands on before its physical size is set; the maximize after
// them leaves the frame as the size an unmaximize returns to.
fn put_on(win: &WebviewWindow, screen: Screen, scale: f64, maximize: bool) -> (i32, i32, u32, u32) {
    let (x, y, w, h) = first_frame(screen, scale);
    note(
        "setting the position",
        win.set_position(PhysicalPosition::new(x, y)),
    );
    note("setting the size", win.set_size(PhysicalSize::new(w, h)));
    if maximize {
        note("maximizing", win.maximize());
    }
    apply(Change::Placed(Frame {
        x,
        y,
        width: w,
        height: h,
        maximized: maximize,
    }));
    (x, y, w, h)
}

// Place a window built hidden: back where it was kept, else on the main window's screen when that one is gone, else by
// the first-open rule. True when it is to go full screen once shown.
fn place(app: &AppHandle, win: &WebviewWindow) -> bool {
    let (screens, scales) = match screens_of(app) {
        Ok(s) => s,
        Err(e) => {
            log_line(&format!(
                "[sidecar] reading the screens failed: {e}; opening at the system's place"
            ));
            return false;
        }
    };
    let main = main_centre(app);
    match place_for(&current(), &screens) {
        Place::Frame { frame, fullscreen } => {
            note(
                "setting the position",
                win.set_position(PhysicalPosition::new(frame.x, frame.y)),
            );
            note(
                "setting the size",
                win.set_size(PhysicalSize::new(frame.width, frame.height)),
            );
            if frame.maximized {
                note("maximizing", win.maximize());
            }
            log_line(&format!(
                "[sidecar] back where it was: {}x{} at {},{}{}{}",
                frame.width,
                frame.height,
                frame.x,
                frame.y,
                if frame.maximized { ", maximized" } else { "" },
                if fullscreen { ", full screen" } else { "" }
            ));
            fullscreen
        }
        Place::MainScreen => {
            let Some(index) = main_screen(main, &screens) else {
                log_line("[sidecar] no screen is known; opening at the system's place");
                return false;
            };
            let (x, y, w, h) = put_on(win, screens[index], scales[index], true);
            log_line(&format!(
                "[sidecar] its screen is gone: maximized on the main window's screen {} of {}: {w}x{h} at {x},{y}",
                index + 1,
                screens.len()
            ));
            false
        }
        Place::First => {
            let Some(pick) = pick_screen(main, &screens) else {
                log_line("[sidecar] no screen is known; opening at the system's place");
                return false;
            };
            let (x, y, w, h) = put_on(win, screens[pick.index], scales[pick.index], pick.maximize);
            log_line(&format!(
                "[sidecar] first open on screen {} of {}: {w}x{h} at {x},{y}{}",
                pick.index + 1,
                screens.len(),
                if pick.maximize { ", maximized" } else { "" }
            ));
            false
        }
    }
}

fn note(what: &str, result: tauri::Result<()>) {
    if let Err(e) = result {
        log_line(&format!("[sidecar] {what} failed: {e}"));
    }
}

/// Open Sidecar: the window built hidden, placed and shown when there is none; unminimized, shown and focused when
/// there is one.
pub fn open(app: &AppHandle) -> tauri::Result<()> {
    open_window(app, true)
}

// A launch's reopen shows the window without taking the focus from the main window (nor, in a dev build, from the
// editor the person launched it from): `focus` is false there.
fn open_window(app: &AppHandle, focus: bool) -> tauri::Result<()> {
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
    // open before it is placed: what its placing does to its frame is kept only while it is open
    apply(Change::Opened);
    let fullscreen = place(app, &win);
    if focus {
        win.show()?;
    } else {
        show_unfocused(app, &win)?;
    }
    if fullscreen {
        note("going full screen", win.set_fullscreen(true));
    }
    // a pinned Sidecar reopens on top; read after the placing, which clears the pin when it puts the window at a fresh frame
    if pin_on_open(&current()) {
        note("pinning", win.set_always_on_top(true));
        log_line("[sidecar] reopened pinned on top");
    }
    // a full-screen toggle onto a screen of the same size raises no resize: read the window once placed
    sample(app);
    if focus {
        win.set_focus()?;
    }
    Ok(())
}

#[cfg(all(debug_assertions, windows))]
fn show_unfocused(_app: &AppHandle, win: &WebviewWindow) -> tauri::Result<()> {
    crate::show_behind_foreground(win);
    Ok(())
}

// the main window has the focus at a launch, and a window shown takes it: give it back
#[cfg(not(all(debug_assertions, windows)))]
fn show_unfocused(app: &AppHandle, win: &WebviewWindow) -> tauri::Result<()> {
    win.show()?;
    if let Some(main) = app.get_webview_window(crate::MAIN_WINDOW_LABEL) {
        if main.is_visible().unwrap_or(false) {
            note("giving the main window the focus back", main.set_focus());
        }
    }
    Ok(())
}

/// At launch, after the main window is set up: Sidecar reopens as last time when it was open when arcterm closed.
pub fn reopen_at_launch(app: &AppHandle) {
    let saved = read(app);
    *kept() = kept_at_launch(saved);
    // screens that cannot be read: none known, and the window takes the system's place
    let screens = screens_of(app).map(|(s, _)| s).unwrap_or_default();
    let Some(place) = launch_place(&saved, &screens) else {
        return;
    };
    log_line(&format!(
        "[sidecar] it was open when arcterm closed: reopening it ({place:?})"
    ));
    if let Err(e) = open_window(app, false) {
        log_line(&format!("[sidecar] reopening it failed: {e}"));
    }
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

// two quick presses of S must not run their window calls into each other
static FORMING: Mutex<()> = Mutex::new(());

// a window call that must have worked for the change to be kept: the failure is logged, and answers the page
fn must(what: &str, result: tauri::Result<()>) -> Result<(), String> {
    result.map_err(|e| {
        let msg = format!("{what} failed: {e}");
        log_line(&format!("[sidecar] {msg}"));
        msg
    })
}

// A window leaves full screen over a moment on macOS, and a size set meanwhile is dropped: wait, a second at most, for
// it to be out. Where the window is out at once (Windows) the first look ends it.
fn settle(mut done: impl FnMut() -> bool) {
    for _ in 0..50 {
        if done() {
            return;
        }
        std::thread::sleep(std::time::Duration::from_millis(20));
    }
}

fn describe(frame: &Frame, fullscreen: bool) -> String {
    format!(
        "{}x{} at {},{}{}{}",
        frame.width,
        frame.height,
        frame.x,
        frame.y,
        if frame.maximized { ", maximized" } else { "" },
        if fullscreen { ", full screen" } else { "" }
    )
}

// the screens, or none known when they cannot be read: the rules then keep the window's corner at scale 1
fn screens_or_none(app: &AppHandle) -> (Vec<Screen>, Vec<f64>) {
    screens_of(app).unwrap_or_else(|e| {
        log_line(&format!("[sidecar] reading the screens failed: {e}"));
        (Vec::new(), Vec::new())
    })
}

// the S button on: remember the frame S returns to, leave full screen and unmaximize, take the small frame, pin
fn shrink(app: &AppHandle, win: &WebviewWindow) -> Result<(), String> {
    // read the window as it is now: a full-screen toggle that left its size as it was raised no resize
    let Some(seen) = winframe::seen(win) else {
        let msg = "reading the window failed".to_string();
        log_line(&format!("[sidecar] {msg}"));
        return Err(msg);
    };
    apply(Change::Seen(seen));
    let back = back_from(&current(), seen);
    let (screens, scales) = screens_or_none(app);
    let (x, y, w, h) = small_frame((seen.x, seen.y, seen.width, seen.height), &screens, &scales);
    if win.is_fullscreen().unwrap_or(false) {
        must("leaving full screen", win.set_fullscreen(false))?;
        settle(|| !win.is_fullscreen().unwrap_or(false));
    }
    if win.is_maximized().unwrap_or(false) {
        must("unmaximizing", win.unmaximize())?;
    }
    // the position first, then the size, as put_on does: the window takes the scale of the screen it lands on before its
    // physical size is set
    must(
        "setting the position",
        win.set_position(PhysicalPosition::new(x, y)),
    )?;
    must("setting the size", win.set_size(PhysicalSize::new(w, h)))?;
    must("pinning", win.set_always_on_top(true))?;
    let frame = Frame {
        x,
        y,
        width: w,
        height: h,
        maximized: false,
    };
    apply(Change::Shrunk { back, frame });
    log_line(&format!(
        "[sidecar] small form: {} and pinned; S returns to {}",
        describe(&frame, false),
        describe(&back.frame, back.fullscreen)
    ));
    Ok(())
}

// the S button off: unpin, put back the frame it returns to (maximized, then full screen, if it was)
fn restore(app: &AppHandle, win: &WebviewWindow) -> Result<(), String> {
    let Some(back) = current().small else {
        return Ok(());
    };
    let from = winframe::seen(win).map(|s| (s.x, s.y, s.width, s.height));
    let (screens, scales) = screens_or_none(app);
    let back = match from {
        Some(from) => restore_to(back, from, &screens, &scales),
        None => back,
    };
    must("unpinning", win.set_always_on_top(false))?;
    // the person may have gone full screen or maximized the small window
    if win.is_fullscreen().unwrap_or(false) {
        must("leaving full screen", win.set_fullscreen(false))?;
        settle(|| !win.is_fullscreen().unwrap_or(false));
    }
    if win.is_maximized().unwrap_or(false) {
        must("unmaximizing", win.unmaximize())?;
    }
    let f = back.frame;
    must(
        "setting the position",
        win.set_position(PhysicalPosition::new(f.x, f.y)),
    )?;
    must(
        "setting the size",
        win.set_size(PhysicalSize::new(f.width, f.height)),
    )?;
    if f.maximized {
        must("maximizing", win.maximize())?;
    }
    if back.fullscreen {
        must("going full screen", win.set_fullscreen(true))?;
    }
    apply(Change::Restored(back));
    log_line(&format!(
        "[sidecar] back from the small form: {}, unpinned",
        describe(&back.frame, back.fullscreen)
    ));
    Ok(())
}

fn run_step(app: &AppHandle, win: &WebviewWindow, step: Step) -> Result<(), String> {
    match step {
        Step::Shrink => shrink(app, win),
        Step::Restore => restore(app, win),
        Step::Pin(on) => {
            must("pinning", win.set_always_on_top(on))?;
            apply(Change::Pinned(on));
            log_line(&format!(
                "[sidecar] {}",
                if on { "pinned on top" } else { "unpinned" }
            ));
            Ok(())
        }
    }
}

/// The S button and the pin button, as one host command (spec 1a): only the host can keep the small form, the frame S
/// returns to and the pin across a relaunch, so the window's frame has this one owner. No change reads the form. A
/// change on a window that is not there is an error.
pub fn form(app: &AppHandle, change: FormChange) -> Result<SidecarForm, String> {
    let _one_at_a_time = FORMING.lock().unwrap_or_else(|e| e.into_inner());
    if change == FormChange::default() {
        return Ok(current().form());
    }
    let Some(win) = app.get_webview_window(SIDECAR_LABEL) else {
        return Err("Sidecar is not open".to_string());
    };
    for step in steps(&current(), change) {
        run_step(app, &win, step)?;
    }
    Ok(current().form())
}

// async: a window call from a synchronous command runs on the main thread, which the call then waits on
#[tauri::command]
pub async fn sidecar_form(
    app: AppHandle,
    change: Option<FormChange>,
) -> Result<SidecarForm, String> {
    form(&app, change.unwrap_or_default())
}

/// The window events Sidecar cares about, from main.rs's one handler. The main window destroyed (not hidden to the tray
/// icon: that is a CloseRequested the host turns into a hide) closes Sidecar, which would otherwise keep the app running
/// with no terminals to open its agents in. Sidecar destroyed, by the person or by that, tells the main window. Sidecar's
/// own `CloseRequested` is the person's close: the only thing that keeps it shut at the next launch. Its moves and
/// resizes keep its frame.
pub fn on_window_event(window: &Window, event: &WindowEvent) {
    match (window.label(), event) {
        (crate::MAIN_WINDOW_LABEL, WindowEvent::Destroyed) => close_with_main(window.app_handle()),
        (SIDECAR_LABEL, WindowEvent::Destroyed) => {
            apply(Change::Destroyed);
            let _ = window
                .app_handle()
                .emit_to(crate::MAIN_WINDOW_LABEL, CLOSED_EVENT, ());
        }
        (SIDECAR_LABEL, WindowEvent::CloseRequested { .. }) => apply(Change::ClosedByPerson),
        (SIDECAR_LABEL, WindowEvent::Moved(_) | WindowEvent::Resized(_)) => {
            sample(window.app_handle())
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

    // the dev app shares the packaged app's identifier, so the same config dir: it keeps a file of its own
    #[test]
    fn sidecar_a_dev_build_keeps_its_own_frame_file() {
        assert_eq!(FILE, "sidecar-frame-dev.json");
    }

    // --- reopens as last time ---

    fn frame(x: i32, y: i32, width: u32, height: u32, maximized: bool) -> Frame {
        Frame {
            x,
            y,
            width,
            height,
            maximized,
        }
    }

    fn seen(x: i32, y: i32, width: u32, height: u32) -> Seen {
        Seen {
            x,
            y,
            width,
            height,
            maximized: false,
            minimized: false,
            fullscreen: false,
        }
    }

    // open, on the 4K screen to the laptop's right, maximized over the frame it unmaximizes to
    fn kept_on_the_4k() -> Remembered {
        Remembered {
            open: true,
            frame: Some(frame(4220, 680, 1280, 800, true)),
            fullscreen: false,
            ..Default::default()
        }
    }

    // the laptop panel at 2x and the 4K at 1.5x, as `screens_of` lists them
    const SCALES: [f64; 2] = [2.0, 1.5];

    // Sidecar in the small form on the 4K screen, pinned, as a window that was full screen there shrank: the small frame
    // is the 4K's top-right corner, and S returns to the maximized frame it had, full screen
    fn small_pinned_on_the_4k() -> Remembered {
        Remembered {
            open: true,
            frame: Some(frame(6270, 0, 510, 660, false)),
            fullscreen: false,
            small: Some(Back {
                frame: frame(4220, 680, 1280, 800, true),
                fullscreen: true,
            }),
            pinned: true,
        }
    }

    #[test]
    fn sidecar_state_round_trips_through_its_file() {
        let state = Remembered {
            open: true,
            frame: Some(frame(4220, 680, 1280, 800, true)),
            fullscreen: true,
            ..Default::default()
        };
        let text = serde_json::to_string(&state).unwrap();
        assert_eq!(parse(&text).unwrap(), state);
        // the shape the file has, for the next version to extend
        let json: serde_json::Value = serde_json::from_str(&text).unwrap();
        assert_eq!(json["open"], true);
        assert_eq!(json["fullscreen"], true);
        assert_eq!(json["frame"]["x"], 4220);
        assert_eq!(json["frame"]["maximized"], true);
        assert_eq!(json["small"], serde_json::Value::Null);
        assert_eq!(json["pinned"], false);
    }

    #[test]
    fn sidecar_state_missing_fields_read_as_their_defaults() {
        let nothing = Remembered {
            open: false,
            frame: None,
            fullscreen: false,
            small: None,
            pinned: false,
        };
        assert_eq!(Remembered::default(), nothing);
        assert_eq!(parse("{}").unwrap(), nothing);
        assert_eq!(
            parse(r#"{"open":true}"#).unwrap(),
            Remembered {
                open: true,
                ..nothing
            }
        );
        // a file with a frame but no full-screen flag (an earlier version's)
        let f = r#"{"open":true,"frame":{"x":1,"y":2,"width":3,"height":4,"maximized":false}}"#;
        assert_eq!(
            parse(f).unwrap(),
            Remembered {
                open: true,
                frame: Some(frame(1, 2, 3, 4, false)),
                fullscreen: false,
                ..nothing
            }
        );
    }

    // part 1 wrote open, frame and full screen only: the small form's and the pin's fields are not in its file
    #[test]
    fn sidecar_a_part_1_file_reads_as_not_small_and_not_pinned() {
        let f = r#"{"open":true,"frame":{"x":4220,"y":680,"width":1280,"height":800,"maximized":true},"fullscreen":true}"#;
        let read = parse(f).unwrap();
        assert!(read.open && read.fullscreen);
        assert_eq!(read.frame, Some(frame(4220, 680, 1280, 800, true)));
        assert_eq!(read.small, None);
        assert!(!read.pinned);
        assert_eq!(
            read.form(),
            SidecarForm {
                small: false,
                pinned: false
            }
        );
        // and it reopens where it was, on top of nothing
        assert_eq!(
            launch_place(&read, &[LAPTOP, FOUR_K]),
            Some(Place::Frame {
                frame: frame(4220, 680, 1280, 800, true),
                fullscreen: true
            })
        );
        assert!(!pin_on_open(&read));
    }

    #[test]
    fn sidecar_state_ignores_a_field_a_later_version_added() {
        let text = r#"{"open":true,"fullscreen":true,"zoom":2,"dock":{"side":"left"}}"#;
        assert_eq!(
            parse(text).unwrap(),
            Remembered {
                open: true,
                frame: None,
                fullscreen: true,
                ..Default::default()
            }
        );
    }

    #[test]
    fn sidecar_state_that_is_not_a_state_does_not_parse() {
        assert!(parse("").is_err());
        assert!(parse("not json").is_err());
        assert!(parse(r#"{"open":"yes"}"#).is_err());
    }

    #[test]
    fn sidecar_a_frame_on_a_screen_goes_back_there() {
        let mut kept = kept_on_the_4k();
        kept.fullscreen = true;
        assert_eq!(
            place_for(&kept, &[LAPTOP, FOUR_K]),
            Place::Frame {
                frame: frame(4220, 680, 1280, 800, true),
                fullscreen: true
            }
        );
        // half off the screen's edge still overlaps it
        let edge = Remembered {
            frame: Some(frame(6000, 100, 1280, 800, false)),
            ..kept_on_the_4k()
        };
        assert!(matches!(
            place_for(&edge, &[LAPTOP, FOUR_K]),
            Place::Frame { .. }
        ));
    }

    #[test]
    fn sidecar_a_frame_on_a_screen_that_is_gone_takes_the_main_screen() {
        // the 4K is unplugged: only the laptop panel is left
        assert_eq!(place_for(&kept_on_the_4k(), &[LAPTOP]), Place::MainScreen);
        // and with no screen known at all
        assert_eq!(place_for(&kept_on_the_4k(), &[]), Place::MainScreen);
    }

    #[test]
    fn sidecar_with_no_frame_kept_is_a_first_open() {
        let fresh = Remembered {
            frame: None,
            ..kept_on_the_4k()
        };
        assert_eq!(place_for(&fresh, &[LAPTOP, FOUR_K]), Place::First);
        assert_eq!(place_for(&Remembered::default(), &[LAPTOP]), Place::First);
    }

    #[test]
    fn sidecar_a_launch_reopens_only_what_was_open() {
        let screens = [LAPTOP, FOUR_K];
        // closed by the person: nothing, however good the frame kept
        let closed = Remembered {
            open: false,
            ..kept_on_the_4k()
        };
        assert_eq!(launch_place(&closed, &screens), None);
        assert_eq!(launch_place(&Remembered::default(), &screens), None);
        // open, on a screen still there: back where it was
        assert!(matches!(
            launch_place(&kept_on_the_4k(), &screens),
            Some(Place::Frame { .. })
        ));
        // open, on a screen that is gone: the main screen
        assert_eq!(
            launch_place(&kept_on_the_4k(), &[LAPTOP]),
            Some(Place::MainScreen)
        );
    }

    #[test]
    fn sidecar_stays_open_for_the_next_launch_when_the_main_window_or_a_quit_destroys_it() {
        let open = Remembered::default().after(Change::Opened);
        assert!(open.open);
        // no CloseRequested comes first: the main window's destroy() and a quit raise none
        assert!(open.after(Change::Destroyed).open);
    }

    #[test]
    fn sidecar_stays_shut_for_the_next_launch_after_the_persons_own_close() {
        let open = Remembered::default().after(Change::Opened);
        // the person's close is a CloseRequested, then the destroy that follows it
        let closed = open.after(Change::ClosedByPerson).after(Change::Destroyed);
        assert!(!closed.open);
    }

    #[test]
    fn sidecar_reopened_after_the_persons_close_in_the_same_session_is_open_at_the_frame_kept() {
        let kept = Remembered {
            open: true,
            frame: Some(frame(4220, 680, 1280, 800, true)),
            fullscreen: true,
            ..Default::default()
        };
        let closed = kept.after(Change::ClosedByPerson).after(Change::Destroyed);
        assert!(!closed.open);
        // the frame and full screen are still kept, for the window the next open builds
        assert_eq!(closed.frame, kept.frame);
        assert!(closed.fullscreen);
        assert_eq!(
            place_for(&closed, &[LAPTOP, FOUR_K]),
            Place::Frame {
                frame: frame(4220, 680, 1280, 800, true),
                fullscreen: true
            }
        );
        assert!(closed.after(Change::Opened).open);
    }

    #[test]
    fn sidecar_keeps_the_frame_a_move_or_resize_left() {
        let open = Remembered::default().after(Change::Opened);
        let moved = open.after(Change::Seen(seen(100, 50, 1280, 800)));
        assert_eq!(moved.frame, Some(frame(100, 50, 1280, 800, false)));
        assert!(!moved.fullscreen);
    }

    #[test]
    fn sidecar_a_maximized_window_keeps_the_frame_under_it() {
        let open = Remembered {
            open: true,
            frame: Some(frame(100, 50, 1280, 800, false)),
            fullscreen: false,
            ..Default::default()
        };
        let maximized = open.after(Change::Seen(Seen {
            maximized: true,
            ..seen(0, 0, 2940, 1912)
        }));
        assert_eq!(maximized.frame, Some(frame(100, 50, 1280, 800, true)));
    }

    #[test]
    fn sidecar_full_screen_is_kept_apart_from_the_frame_under_it() {
        let open = Remembered {
            open: true,
            frame: Some(frame(4220, 680, 1280, 800, true)),
            fullscreen: false,
            ..Default::default()
        };
        let full = open.after(Change::Seen(Seen {
            fullscreen: true,
            maximized: true,
            ..seen(2940, 0, 3840, 2160)
        }));
        assert!(full.fullscreen);
        assert_eq!(full.frame, open.frame);
        // and leaving it clears the flag
        let left = full.after(Change::Seen(Seen {
            maximized: true,
            ..seen(2940, 0, 3840, 2120)
        }));
        assert!(!left.fullscreen);
    }

    #[test]
    fn sidecar_a_minimized_window_keeps_the_state_it_had() {
        let open = Remembered {
            open: true,
            frame: Some(frame(100, 50, 1280, 800, false)),
            fullscreen: true,
            ..Default::default()
        };
        let minimized = open.after(Change::Seen(Seen {
            minimized: true,
            ..seen(-32000, -32000, 160, 28)
        }));
        assert_eq!(minimized, open);
    }

    #[test]
    fn sidecar_a_window_the_person_closed_no_longer_moves_the_frame() {
        let kept = Remembered {
            open: true,
            frame: Some(frame(4220, 680, 1280, 800, true)),
            fullscreen: true,
            ..Default::default()
        };
        let closed = kept.after(Change::ClosedByPerson);
        // a window on its way out leaves full screen, or resizes, before it is gone
        let after = closed.after(Change::Seen(seen(0, 0, 800, 600)));
        assert_eq!(after, closed);
    }

    #[test]
    fn sidecar_placed_by_the_host_replaces_the_frame_and_leaves_full_screen() {
        let old = Remembered {
            open: true,
            frame: Some(frame(4220, 680, 1280, 800, true)),
            fullscreen: true,
            ..Default::default()
        };
        let placed = old.after(Change::Placed(frame(660, 556, 1280, 800, true)));
        assert_eq!(placed.frame, Some(frame(660, 556, 1280, 800, true)));
        assert!(!placed.fullscreen);
        assert!(placed.open);
    }

    // a fresh frame put by the host is a wide one: the small form and the pin do not outlive it (the reopen whose screen
    // is gone lands here)
    #[test]
    fn sidecar_placed_by_the_host_is_neither_small_nor_pinned() {
        let small = small_pinned_on_the_4k();
        assert!(small.small.is_some() && small.pinned);
        let placed = small.after(Change::Placed(frame(660, 556, 1280, 800, true)));
        assert_eq!(placed.small, None);
        assert!(!placed.pinned);
        assert!(!pin_on_open(&placed));
    }

    #[test]
    fn sidecar_main_screen_is_the_one_holding_the_main_windows_centre_else_the_first() {
        assert_eq!(main_screen(Some((1470, 956)), &[LAPTOP, FOUR_K]), Some(0));
        assert_eq!(main_screen(Some((4860, 1080)), &[LAPTOP, FOUR_K]), Some(1));
        // on no screen (minimized), or unreadable: the first
        assert_eq!(
            main_screen(Some((-32000, -32000)), &[LAPTOP, FOUR_K]),
            Some(0)
        );
        assert_eq!(main_screen(None, &[LAPTOP, FOUR_K]), Some(0));
        assert_eq!(main_screen(None, &[]), None);
    }

    // --- the small form: the S button and the pin (decisions 1, 2 and 12) ---

    const ONE_SCREEN: Screen = (0, 0, 1920, 1040);

    #[test]
    fn sidecar_small_frame_is_340_by_440_logical_keeping_the_top_right_corner() {
        assert_eq!(SMALL_SIZE, (340.0, 440.0));
        // 1280x800 at 320,120 ends at x = 1600: the small window's right edge is there too
        assert_eq!(
            small_frame((320, 120, 1280, 800), &[ONE_SCREEN], &[1.0]),
            (1260, 120, 340, 440)
        );
    }

    #[test]
    fn sidecar_small_frame_takes_the_scale_of_the_screen_holding_the_windows_centre() {
        let screens = [LAPTOP, FOUR_K];
        // centre (4860, 1080) is on the 4K, at 1.5x: 510x660 physical
        assert_eq!(
            small_frame((4220, 680, 1280, 800), &screens, &SCALES),
            (4990, 680, 510, 660)
        );
        // centre (1470, 900) is on the laptop panel, at 2x: 680x880
        assert_eq!(
            small_frame((700, 400, 1540, 1000), &screens, &SCALES),
            (1560, 400, 680, 880)
        );
        // one screen at 1.5x
        assert_eq!(
            small_frame((510, 356, 1920, 1200), &[LAPTOP], &[1.5]),
            (1920, 356, 510, 660)
        );
    }

    #[test]
    fn sidecar_a_maximized_window_shrinks_to_the_top_right_corner_of_its_screen() {
        let screens = [LAPTOP, FOUR_K];
        // maximized on the 4K: the window is the screen's work area
        assert_eq!(
            small_frame(FOUR_K, &screens, &[1.0, 1.0]),
            (2940 + 3840 - 340, 0, 340, 440)
        );
        // and on the laptop panel
        assert_eq!(
            small_frame(LAPTOP, &screens, &[1.0, 1.0]),
            (2940 - 340, 0, 340, 440)
        );
        // full screen covers the screen, the taskbar's strip too: the corner is pulled up into the work area
        let monitor = (0, -40, 1920, 1080);
        assert_eq!(
            small_frame(monitor, &[ONE_SCREEN], &[1.0]),
            (1920 - 340, 0, 340, 440)
        );
    }

    #[test]
    fn sidecar_small_frame_is_clamped_into_the_work_area_of_the_screen() {
        // the right edge is past the screen (centre on none: the first screen)
        assert_eq!(
            small_frame((1700, 100, 1280, 800), &[ONE_SCREEN], &[1.0]),
            (1920 - 340, 100, 340, 440)
        );
        // above the screen
        assert_eq!(
            small_frame((320, -50, 1280, 800), &[ONE_SCREEN], &[1.0]),
            (1260, 0, 340, 440)
        );
        // the top near the bottom edge: the whole form stays on screen
        assert_eq!(
            small_frame((100, 1000, 800, 600), &[ONE_SCREEN], &[1.0]),
            (560, 1040 - 440, 340, 440)
        );
        // left of the screen
        assert_eq!(
            small_frame((0, 0, 200, 300), &[ONE_SCREEN], &[1.0]),
            (0, 0, 340, 440)
        );
        // a screen smaller than the form cuts it
        assert_eq!(
            small_frame((0, 0, 300, 400), &[(0, 0, 300, 400)], &[1.0]),
            (0, 0, 300, 400)
        );
    }

    #[test]
    fn sidecar_small_frame_with_no_screen_known_keeps_the_corner_at_scale_one() {
        assert_eq!(
            small_frame((100, 50, 800, 600), &[], &[]),
            (560, 50, 340, 440)
        );
        // a bad scale is one
        for bad in [0.0, -1.0, f64::NAN] {
            assert_eq!(
                small_frame((320, 120, 1280, 800), &[ONE_SCREEN], &[bad]),
                (1260, 120, 340, 440)
            );
        }
    }

    #[test]
    fn sidecar_back_is_the_kept_frame_and_full_screen() {
        // a maximized window kept the frame under it, and full screen is kept apart from both
        let start = Remembered {
            fullscreen: true,
            ..kept_on_the_4k()
        };
        let seen_full = Seen {
            fullscreen: true,
            maximized: true,
            ..seen(2940, 0, 3840, 2160)
        };
        assert_eq!(
            back_from(&start, seen_full),
            Back {
                frame: frame(4220, 680, 1280, 800, true),
                fullscreen: true
            }
        );
        // no frame kept yet: the window's own
        let none = Remembered {
            frame: None,
            fullscreen: false,
            ..start
        };
        assert_eq!(
            back_from(&none, seen(100, 50, 1280, 800)),
            Back {
                frame: frame(100, 50, 1280, 800, false),
                fullscreen: false
            }
        );
    }

    #[test]
    fn sidecar_shrink_then_restore_returns_the_first_frame_and_full_screen() {
        // full screen over a maximized window on the 4K
        let start = Remembered {
            fullscreen: true,
            ..kept_on_the_4k()
        };
        let seen_full = Seen {
            fullscreen: true,
            maximized: true,
            ..seen(2940, 0, 3840, 2160)
        };
        let back = back_from(&start, seen_full);
        let (x, y, w, h) = small_frame((2940, 0, 3840, 2160), &[LAPTOP, FOUR_K], &SCALES);
        assert_eq!((x, y, w, h), (6270, 0, 510, 660));
        let small_frame_kept = frame(x, y, w, h, false);
        let shrunk = start.after(Change::Shrunk {
            back,
            frame: small_frame_kept,
        });
        assert_eq!(shrunk, small_pinned_on_the_4k());
        assert_eq!(
            shrunk.form(),
            SidecarForm {
                small: true,
                pinned: true
            }
        );
        // S again: the first frame, maximized as it was, and full screen as it was
        let to = restore_to(
            shrunk.small.unwrap(),
            (x, y, w, h),
            &[LAPTOP, FOUR_K],
            &SCALES,
        );
        let restored = shrunk.after(Change::Restored(to));
        assert_eq!(restored, start);
        assert!(restored.frame.unwrap().maximized);
        assert!(restored.fullscreen);
        assert_eq!(
            restored.form(),
            SidecarForm {
                small: false,
                pinned: false
            }
        );
        // a window that was neither maximized nor full screen comes back the same
        let plain = Remembered {
            open: true,
            frame: Some(frame(320, 120, 1280, 800, false)),
            ..Default::default()
        };
        let back = back_from(&plain, seen(320, 120, 1280, 800));
        let there = plain.after(Change::Shrunk {
            back,
            frame: frame(1260, 120, 340, 440, false),
        });
        assert_eq!(there.after(Change::Restored(back)), plain);
    }

    #[test]
    fn sidecar_restore_puts_the_window_on_a_screen_when_its_first_frame_has_none() {
        let back = Back {
            frame: frame(4220, 680, 1280, 800, true),
            fullscreen: true,
        };
        // the 4K is unplugged while the window is small on the laptop panel: centred there, not maximized, not full screen
        let to = restore_to(back, (2400, 0, 510, 660), &[LAPTOP], &[2.0]);
        assert_eq!(to.frame, frame(190, 156, 2560, 1600, false));
        assert!(!to.fullscreen);
        // a frame still on a screen stands, as does one with no screen known
        assert_eq!(
            restore_to(back, (6270, 0, 510, 660), &[LAPTOP, FOUR_K], &SCALES),
            back
        );
        assert_eq!(restore_to(back, (0, 0, 510, 660), &[], &[]), back);
    }

    #[test]
    fn sidecar_pin_is_independent_of_small() {
        let open = Remembered::default().after(Change::Opened);
        let pinned = open.after(Change::Pinned(true));
        assert!(pinned.pinned);
        assert_eq!(pinned.small, None);
        // the pin button in the small form turns the pin off and leaves the form small
        let small = small_pinned_on_the_4k();
        let off = small.after(Change::Pinned(false));
        assert!(!off.pinned);
        assert_eq!(off.small, small.small);
        assert_eq!(off.frame, small.frame);
        assert!(off.after(Change::Pinned(true)).pinned);
    }

    #[test]
    fn sidecar_dragging_the_small_window_wider_keeps_it_small() {
        let small = small_pinned_on_the_4k();
        let wider = small.after(Change::Seen(seen(5400, 0, 1380, 660)));
        assert_eq!(wider.frame, Some(frame(5400, 0, 1380, 660, false)));
        assert_eq!(wider.small, small.small);
        assert!(wider.pinned);
    }

    #[test]
    fn sidecar_a_form_change_takes_the_steps_it_needs() {
        let change = |small, pinned| FormChange { small, pinned };
        let plain = Remembered {
            open: true,
            frame: Some(frame(320, 120, 1280, 800, false)),
            ..Default::default()
        };
        // not small
        assert_eq!(steps(&plain, change(None, None)), Vec::<Step>::new());
        assert_eq!(steps(&plain, change(Some(true), None)), vec![Step::Shrink]);
        assert_eq!(
            steps(&plain, change(Some(true), Some(false))),
            vec![Step::Shrink, Step::Pin(false)]
        );
        assert_eq!(
            steps(&plain, change(None, Some(true))),
            vec![Step::Pin(true)]
        );
        assert_eq!(steps(&plain, change(None, Some(false))), Vec::<Step>::new());
        assert_eq!(steps(&plain, change(Some(false), None)), Vec::<Step>::new());
        // small and pinned
        let small = small_pinned_on_the_4k();
        assert_eq!(
            steps(&small, change(Some(false), None)),
            vec![Step::Restore]
        );
        // shrinking a small window changes nothing: the frame S returns to is not overwritten by the small one
        assert_eq!(steps(&small, change(Some(true), None)), Vec::<Step>::new());
        assert_eq!(
            steps(&small, change(None, Some(false))),
            vec![Step::Pin(false)]
        );
        assert_eq!(steps(&small, change(None, Some(true))), Vec::<Step>::new());
        assert_eq!(
            steps(&small, change(Some(false), Some(true))),
            vec![Step::Restore, Step::Pin(true)]
        );
        // small, the pin turned off: S pressed again puts it back with nothing left to unpin
        let unpinned = Remembered {
            pinned: false,
            ..small
        };
        assert_eq!(
            steps(&unpinned, change(Some(false), None)),
            vec![Step::Restore]
        );
        assert_eq!(
            steps(&unpinned, change(Some(true), None)),
            Vec::<Step>::new()
        );
        // pinned but not small (the pin button in a narrow window): "restores and unpins" unpins
        let pinned = Remembered {
            pinned: true,
            ..plain
        };
        assert_eq!(
            steps(&pinned, change(Some(false), None)),
            vec![Step::Pin(false)]
        );
    }

    #[test]
    fn sidecar_a_form_change_and_the_form_have_the_wire_shape() {
        let c: FormChange = serde_json::from_str(r#"{"small":true}"#).unwrap();
        assert_eq!(
            c,
            FormChange {
                small: Some(true),
                pinned: None
            }
        );
        let c: FormChange = serde_json::from_str(r#"{"pinned":false}"#).unwrap();
        assert_eq!(
            c,
            FormChange {
                small: None,
                pinned: Some(false)
            }
        );
        assert_eq!(
            serde_json::from_str::<FormChange>("{}").unwrap(),
            FormChange::default()
        );
        let form = serde_json::to_value(small_pinned_on_the_4k().form()).unwrap();
        assert_eq!(form, serde_json::json!({"small": true, "pinned": true}));
    }

    // The relaunch the run can only test here: no scenario restarts the app (decision 1). Sidecar was small and pinned when
    // arcterm closed, on the 4K screen it had been maximized and full screen on before it shrank.
    #[test]
    fn sidecar_a_launch_reopens_small_and_pinned_with_the_frame_s_returns_to() {
        let saved = small_pinned_on_the_4k();
        let back = Back {
            frame: frame(4220, 680, 1280, 800, true),
            fullscreen: true,
        };
        // through the file: the small form's frame for S and the pin survive it
        let text = serde_json::to_string(&saved).unwrap();
        let read = parse(&text).unwrap();
        assert_eq!(read, saved);
        assert_eq!(read.small, Some(back));
        assert!(read.pinned);
        // the window is placed at its small frame (not at the frame S returns to, nor full screen), and is pinned
        let screens = [LAPTOP, FOUR_K];
        assert_eq!(
            launch_place(&read, &screens),
            Some(Place::Frame {
                frame: frame(6270, 0, 510, 660, false),
                fullscreen: false
            })
        );
        assert!(pin_on_open(&read));
        // what the launch keeps still holds it, and has changed nothing to write back
        let k = kept_at_launch(read);
        assert!(!k.changed);
        assert_eq!(k.state.small, Some(back));
        assert!(k.state.pinned);
        // opening the window leaves it small and pinned
        let opened = k.state.after(Change::Opened);
        assert_eq!(opened.small, Some(back));
        assert!(opened.pinned);
        assert_eq!(
            opened.form(),
            SidecarForm {
                small: true,
                pinned: true
            }
        );
        // S still returns to the first frame
        let restored = opened.after(Change::Restored(opened.small.unwrap()));
        assert_eq!(restored.frame, Some(back.frame));
        assert!(restored.fullscreen && !restored.pinned && restored.small.is_none());
    }

    #[test]
    fn sidecar_a_launch_with_the_small_forms_screen_gone_opens_wide_on_the_main_screen() {
        // only the laptop panel is left: the screen holding the small frame is gone
        let saved = small_pinned_on_the_4k();
        assert_eq!(launch_place(&saved, &[LAPTOP]), Some(Place::MainScreen));
        // the host's placing then clears the small form and the pin, so the window opens neither small nor pinned
        let placed = saved.after(Change::Placed(frame(660, 556, 1280, 800, true)));
        assert!(!pin_on_open(&placed));
        assert_eq!(placed.small, None);
    }

    // the small form and the pin stay kept when the person closes Sidecar and opens it again in the same session
    #[test]
    fn sidecar_reopened_in_the_same_session_is_still_small_and_pinned() {
        let closed = small_pinned_on_the_4k()
            .after(Change::ClosedByPerson)
            .after(Change::Destroyed);
        assert!(!closed.open);
        assert_eq!(closed.small, small_pinned_on_the_4k().small);
        assert!(closed.pinned);
        let reopened = closed.after(Change::Opened);
        assert!(pin_on_open(&reopened));
        assert_eq!(
            place_for(&reopened, &[LAPTOP, FOUR_K]),
            Place::Frame {
                frame: frame(6270, 0, 510, 660, false),
                fullscreen: false
            }
        );
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
        ];
        want.sort_unstable();
        assert_eq!(got, want);
        // the S button and the pin are the host command, not window calls the page makes
        assert!(!got.contains(&"core:window:allow-set-position"));
        assert!(!got.contains(&"core:window:allow-set-always-on-top"));
    }
}
