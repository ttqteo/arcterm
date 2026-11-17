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

/// Sidecar's own icon: arcterm's mark with a small screen badge, one PNG frame per size
/// (scripts/gen-app-icon.mjs writes it beside icon.ico). The exe carries it as bytes, not as a resource, so the
/// Sidecar window can take it while the exe keeps its own icon.
#[cfg_attr(not(windows), allow(dead_code))]
pub const SIDECAR_ICO: &[u8] = include_bytes!("../icons/icon-sidecar.ico");

/// The frame of an ICO that draws best at `size` px, as (offset, length) into `ico`: the exact size, else the smallest
/// larger, else the largest (a width byte of 0 is 256; of two frames of one size the first). None for a buffer that is
/// not an ICO, or is cut short anywhere in its directory or in a frame's bytes.
#[cfg_attr(not(windows), allow(dead_code))]
pub fn pick_ico_frame(ico: &[u8], size: u32) -> Option<(usize, usize)> {
    let word = |at: usize| ico.get(at..at + 2).map(|b| u16::from_le_bytes([b[0], b[1]]));
    let long = |at: usize| ico.get(at..at + 4).map(|b| u32::from_le_bytes([b[0], b[1], b[2], b[3]]) as usize);
    // reserved 0, type 1 (icon; 2 is a cursor)
    if word(0)? != 0 || word(2)? != 1 {
        return None;
    }
    let mut best: Option<((u8, u32), usize, usize)> = None;
    for n in 0..word(4)? as usize {
        let entry = 6 + n * 16;
        let width = match ico.get(entry..entry + 16)?[0] {
            0 => 256,
            w => w as u32,
        };
        let (len, offset) = (long(entry + 8)?, long(entry + 12)?);
        if len == 0 || offset.checked_add(len)? > ico.len() {
            return None;
        }
        // exact first, then the larger ones smallest first, then the smaller ones largest first
        let rank = match width.cmp(&size) {
            std::cmp::Ordering::Equal => (0, 0),
            std::cmp::Ordering::Greater => (1, width),
            std::cmp::Ordering::Less => (2, u32::MAX - width),
        };
        if best.as_ref().map_or(true, |(r, _, _)| rank < *r) {
            best = Some((rank, offset, len));
        }
    }
    best.map(|(_, offset, len)| (offset, len))
}

/// An icon of Sidecar's icon at `size` px, made from the frame that draws best at it (a PNG frame goes in as it is).
/// The caller owns it: a window's icon lives as long as the window, so the caller hands it to `keep_window_icons`,
/// which frees it when the window is destroyed.
#[cfg(windows)]
pub fn make_icon(size: i32) -> Result<windows_sys::Win32::UI::WindowsAndMessaging::HICON, String> {
    use windows_sys::Win32::UI::WindowsAndMessaging::{CreateIconFromResourceEx, LR_DEFAULTCOLOR};
    // the version every icon resource states
    const ICON_VERSION: u32 = 0x0003_0000;

    if size <= 0 {
        return Err(format!("no icon size for its window ({size})"));
    }
    let (at, len) = pick_ico_frame(SIDECAR_ICO, size as u32).ok_or("its icon has no frame to draw")?;
    let icon = unsafe {
        CreateIconFromResourceEx(
            SIDECAR_ICO[at..at + len].as_ptr(),
            len as u32,
            1, // an icon, not a cursor
            ICON_VERSION,
            size,
            size,
            LR_DEFAULTCOLOR,
        )
    };
    if icon.is_null() {
        return Err(format!("making its {size}px icon failed"));
    }
    Ok(icon)
}

/// The icons made for one Sidecar window and the window they were set on. The HICONs are held as integers: a raw
/// pointer is not `Send`, and a static must be.
#[cfg(windows)]
struct WindowIcons {
    hwnd: isize,
    icons: Vec<isize>,
}

// Each open of the Sidecar window makes its two icons (`make_icon`), and Windows never frees an icon it was given with
// WM_SETICON. They are kept here, with the window, until that window is destroyed: one Sidecar window exists at a time,
// and its `WindowEvent::Destroyed` (`on_window_event`) runs on the main thread before a later open can build the next
// one, so a close and reopen leaves no icon behind. The main window's icons are not kept: they live as long as the app.
#[cfg(windows)]
static WINDOW_ICONS: Mutex<Vec<WindowIcons>> = Mutex::new(Vec::new());

#[cfg(windows)]
fn window_icons() -> MutexGuard<'static, Vec<WindowIcons>> {
    WINDOW_ICONS.lock().unwrap_or_else(|e| e.into_inner())
}

/// Keep the icons that were set on the Sidecar window `hwnd`, to be freed when that window is destroyed
/// (`free_window_icons`). They must stay alive until then: the window draws them.
#[cfg(windows)]
pub fn keep_window_icons(
    hwnd: isize,
    icons: Vec<windows_sys::Win32::UI::WindowsAndMessaging::HICON>,
) {
    if icons.is_empty() {
        return;
    }
    let icons = icons.into_iter().map(|icon| icon as isize).collect();
    window_icons().push(WindowIcons { hwnd, icons });
}

/// Free every icon kept for a Sidecar window, once it is destroyed; how many were freed. It runs in the window's
/// WM_DESTROY (the window is hidden by then, but its handle still answers), so each window is first taken off the icons,
/// then they are destroyed: nothing frees an icon a window still names. A second call finds nothing and frees nothing.
#[cfg(windows)]
pub fn free_window_icons() -> usize {
    use windows_sys::Win32::Foundation::HWND;
    use windows_sys::Win32::UI::WindowsAndMessaging::{
        DestroyIcon, IsWindow, SendMessageW, HICON, ICON_BIG, ICON_SMALL, WM_SETICON,
    };

    // taken out of the list first, so the lock is not held while Windows is called
    let kept = std::mem::take(&mut *window_icons());
    let mut freed = 0;
    for WindowIcons { hwnd, icons } in kept {
        unsafe {
            let window = hwnd as HWND;
            if IsWindow(window) != 0 {
                for which in [ICON_BIG, ICON_SMALL] {
                    SendMessageW(window, WM_SETICON, which as usize, 0);
                }
            }
            for icon in icons {
                if DestroyIcon(icon as HICON) != 0 {
                    freed += 1;
                } else {
                    log_line("[sidecar] freeing one of its window's icons failed");
                }
            }
        }
    }
    freed
}

/// The AppUserModelID of the Sidecar window: the app's identifier with `.sidecar` on the end (`-dev` first in a dev
/// build, which shares the identifier with the packaged app), so the taskbar draws it as its own button.
#[cfg_attr(not(windows), allow(dead_code))]
pub fn sidecar_app_id(identifier: &str, dev: bool) -> String {
    format!("{identifier}{}.sidecar", if dev { "-dev" } else { "" })
}

/// The page draws its own title bar, as the main window's does. On Windows the window has no frame at all and the page
/// draws the window buttons too. On macOS it keeps the native frame with the title bar laid over the page
/// (`tauri.macos.conf.json` does the same for the main window): a frameless window there has square corners, no shadow
/// and no traffic lights, so no green button for full screen. The page learns which from `?frame=mac`, and leaves the
/// lights their room and drops its own window buttons. The red light raises the `CloseRequested` the page's close does.
fn sidecar_builder(app: &AppHandle) -> WebviewWindowBuilder<'_, tauri::Wry, AppHandle> {
    #[cfg(target_os = "macos")]
    let page = "sidecar.html?frame=mac";
    #[cfg(not(target_os = "macos"))]
    let page = "sidecar.html";
    let builder = WebviewWindowBuilder::new(app, SIDECAR_LABEL, WebviewUrl::App(page.into()))
        .title(TITLE)
        .inner_size(FIRST_SIZE.0, FIRST_SIZE.1)
        .min_inner_size(MIN_SIZE.0, MIN_SIZE.1)
        .resizable(true);
    #[cfg(target_os = "macos")]
    let builder = builder
        .title_bar_style(tauri::TitleBarStyle::Overlay)
        .hidden_title(true)
        // the main window's place for them: both title bars are 38 px tall on a Mac
        .traffic_light_position(tauri::LogicalPosition::new(16.0, 21.0));
    #[cfg(not(target_os = "macos"))]
    let builder = builder.decorations(false);
    builder
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
    let win = sidecar_builder(app).visible(false).build()?;
    // its own taskbar button (Windows): its own AppUserModelID, no pinning (a pin of it would relaunch arcterm, not
    // Sidecar), and its own icon (arcterm's mark with a screen badge, the frame made for each size). On the main thread,
    // where COM is up for the property store.
    #[cfg(windows)]
    {
        let id = sidecar_app_id(&app.config().identifier, cfg!(debug_assertions));
        let for_icons = win.clone();
        let _ = app.run_on_main_thread(move || {
            match crate::set_window_app_user_model_id(&for_icons, &id, true) {
                None => log_line(&format!("[sidecar] app id {id}")),
                Some(failed) => log_line(&failed),
            }
            if let Ok(hwnd) = for_icons.hwnd() {
                crate::use_sidecar_icons(hwnd.0 as isize);
            }
        });
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
            // its taskbar and title bar icons (Windows): the window is gone, so nothing draws them any more
            #[cfg(windows)]
            free_window_icons();
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

    // --- its own taskbar button and icon (Windows; the pure parts run everywhere) ---

    // An ICO holding one frame per width byte (0 stands for 256), frame n being 8 + n bytes of 0xA0 + n: so a pick's
    // offset and length say which frame it was.
    fn fake_ico(widths: &[u8]) -> Vec<u8> {
        let mut out = vec![0, 0, 1, 0];
        out.extend_from_slice(&(widths.len() as u16).to_le_bytes());
        let mut offset = 6 + 16 * widths.len();
        let mut frames = Vec::new();
        for (n, w) in widths.iter().enumerate() {
            let len = 8 + n;
            out.extend_from_slice(&[*w, *w, 0, 0, 1, 0, 32, 0]);
            out.extend_from_slice(&(len as u32).to_le_bytes());
            out.extend_from_slice(&(offset as u32).to_le_bytes());
            frames.extend(std::iter::repeat(0xA0 + n as u8).take(len));
            offset += len;
        }
        out.extend(frames);
        out
    }

    // the frame fake_ico made at index n, as pick_ico_frame names it
    fn frame_of(widths: &[u8], n: usize) -> Option<(usize, usize)> {
        let offset = 6 + 16 * widths.len() + (0..n).map(|k| 8 + k).sum::<usize>();
        Some((offset, 8 + n))
    }

    #[test]
    fn pick_ico_frame_takes_the_exact_size() {
        let w = [32, 16, 20, 24, 40, 48, 64, 0];
        let ico = fake_ico(&w);
        assert_eq!(pick_ico_frame(&ico, 32), frame_of(&w, 0));
        assert_eq!(pick_ico_frame(&ico, 16), frame_of(&w, 1));
        assert_eq!(pick_ico_frame(&ico, 24), frame_of(&w, 3));
        assert_eq!(pick_ico_frame(&ico, 64), frame_of(&w, 6));
        // a width byte of 0 is 256
        assert_eq!(pick_ico_frame(&ico, 256), frame_of(&w, 7));
    }

    #[test]
    fn pick_ico_frame_without_the_size_takes_the_smallest_larger() {
        let w = [32, 16, 20, 24, 40, 48, 64, 0];
        let ico = fake_ico(&w);
        assert_eq!(pick_ico_frame(&ico, 17), frame_of(&w, 2)); // 20
        assert_eq!(pick_ico_frame(&ico, 25), frame_of(&w, 0)); // 32, not 40 or 48
        assert_eq!(pick_ico_frame(&ico, 49), frame_of(&w, 6)); // 64
        assert_eq!(pick_ico_frame(&ico, 65), frame_of(&w, 7)); // 256
        assert_eq!(pick_ico_frame(&ico, 1), frame_of(&w, 1)); // 16
    }

    #[test]
    fn pick_ico_frame_larger_than_every_frame_takes_the_largest() {
        let w = [16, 48, 32];
        let ico = fake_ico(&w);
        assert_eq!(pick_ico_frame(&ico, 64), frame_of(&w, 1));
        assert_eq!(pick_ico_frame(&ico, 4096), frame_of(&w, 1));
        // a 256 frame (width byte 0) is the largest, not the smallest
        let w = [16, 0, 32];
        assert_eq!(pick_ico_frame(&fake_ico(&w), 512), frame_of(&w, 1));
    }

    #[test]
    fn pick_ico_frame_of_the_same_size_twice_takes_the_first() {
        let w = [16, 32, 32];
        let ico = fake_ico(&w);
        assert_eq!(pick_ico_frame(&ico, 32), frame_of(&w, 1));
        assert_eq!(pick_ico_frame(&ico, 20), frame_of(&w, 1));
    }

    #[test]
    fn pick_ico_frame_of_a_truncated_or_non_ico_buffer_is_none() {
        let w = [16, 32];
        let ico = fake_ico(&w);
        assert_eq!(pick_ico_frame(&[], 32), None);
        // a header cut short, then a directory cut short
        assert_eq!(pick_ico_frame(&ico[..5], 32), None);
        assert_eq!(pick_ico_frame(&ico[..6 + 16 + 3], 32), None);
        // the last frame's bytes cut short
        assert_eq!(pick_ico_frame(&ico[..ico.len() - 1], 32), None);
        // no frames at all
        assert_eq!(pick_ico_frame(&[0, 0, 1, 0, 0, 0], 32), None);
        // a cursor (type 2), a reserved word that is not 0, a PNG, and text
        let mut cursor = ico.clone();
        cursor[2] = 2;
        assert_eq!(pick_ico_frame(&cursor, 32), None);
        let mut reserved = ico.clone();
        reserved[0] = 1;
        assert_eq!(pick_ico_frame(&reserved, 32), None);
        assert_eq!(pick_ico_frame(b"\x89PNG\r\n\x1a\n and then some more bytes", 32), None);
        assert_eq!(pick_ico_frame(b"not an icon at all, not even close", 32), None);
        // a frame whose offset points past the buffer, however large
        let mut far = ico.clone();
        far[6 + 12..6 + 16].copy_from_slice(&u32::MAX.to_le_bytes());
        assert_eq!(pick_ico_frame(&far, 16), None);
    }

    #[test]
    fn pick_ico_frame_reads_the_icon_the_exe_embeds() {
        // every size gen-app-icon.mjs draws is in it, each frame a PNG
        for size in [16u32, 20, 24, 32, 40, 48, 64, 96, 128, 256] {
            let (at, len) = pick_ico_frame(SIDECAR_ICO, size).expect("a frame");
            assert!(at + len <= SIDECAR_ICO.len());
            assert_eq!(&SIDECAR_ICO[at..at + 8], b"\x89PNG\r\n\x1a\n");
            // exact: the PNG's width is the size asked for
            let width = u32::from_be_bytes(SIDECAR_ICO[at + 16..at + 20].try_into().unwrap());
            assert_eq!(width, size);
        }
    }

    // Windows takes a PNG frame of the ICO as it is: the sizes the taskbar and the title bar ask for, at 100% to 300%
    #[cfg(windows)]
    #[test]
    fn windows_makes_an_icon_from_each_frame_of_the_sidecar_ico() {
        use windows_sys::Win32::UI::WindowsAndMessaging::DestroyIcon;
        for size in [16, 20, 24, 32, 40, 48, 64, 96, 128, 256] {
            let icon = make_icon(size).unwrap_or_else(|e| panic!("{size}px: {e}"));
            assert!(unsafe { DestroyIcon(icon) } != 0, "{size}px");
        }
        // a size between two frames takes the next one up, and nothing is not a size
        assert!(make_icon(30).is_ok());
        assert!(make_icon(0).is_err());
        assert!(make_icon(-1).is_err());
    }

    // the two icons set on the Sidecar window are kept with it, and freed when it is destroyed: the window is taken off
    // them first. A real window (the default window procedure, hidden) stands in for Sidecar's. This is the one test
    // that touches the kept list, which every window shares.
    #[cfg(windows)]
    #[test]
    fn windows_frees_the_icons_kept_for_a_sidecar_window_when_it_is_destroyed() {
        use windows_sys::Win32::System::LibraryLoader::GetModuleHandleW;
        use windows_sys::Win32::UI::WindowsAndMessaging::{
            CreateWindowExW, DefWindowProcW, DestroyWindow, RegisterClassW, SendMessageW,
            UnregisterClassW, ICON_BIG, ICON_SMALL, WM_GETICON, WM_SETICON, WNDCLASSW,
        };
        let class: Vec<u16> = "arcterm_sidecar_icons_test\0".encode_utf16().collect();
        unsafe {
            let module = GetModuleHandleW(std::ptr::null());
            let mut def: WNDCLASSW = std::mem::zeroed();
            def.lpfnWndProc = Some(DefWindowProcW);
            def.hInstance = module;
            def.lpszClassName = class.as_ptr();
            assert!(RegisterClassW(&def) != 0, "registering the test window's class");
            let hwnd = CreateWindowExW(
                0,
                class.as_ptr(),
                class.as_ptr(),
                0,
                0,
                0,
                0,
                0,
                std::ptr::null_mut(),
                std::ptr::null_mut(),
                module,
                std::ptr::null(),
            );
            assert!(!hwnd.is_null(), "creating the test window");

            // what use_sidecar_icons does with them
            let mut made = Vec::new();
            for (which, size) in [(ICON_BIG, 32), (ICON_SMALL, 16)] {
                let icon = make_icon(size).expect("an icon");
                SendMessageW(hwnd, WM_SETICON, which as usize, icon as isize);
                made.push(icon);
            }
            keep_window_icons(hwnd as isize, made);
            // nothing to keep is not an entry
            keep_window_icons(hwnd as isize, Vec::new());
            for which in [ICON_BIG, ICON_SMALL] {
                assert_ne!(SendMessageW(hwnd, WM_GETICON, which as usize, 0), 0, "kept: the window draws it");
            }

            // destroyed: both are freed, and the window no longer names either
            assert_eq!(free_window_icons(), 2);
            for which in [ICON_BIG, ICON_SMALL] {
                assert_eq!(SendMessageW(hwnd, WM_GETICON, which as usize, 0), 0, "freed: the window let go of it");
            }
            // nothing is left, so a second destroy frees nothing twice
            assert_eq!(free_window_icons(), 0);

            // an icon kept for a window that is already gone is freed all the same
            let gone = make_icon(16).expect("an icon");
            DestroyWindow(hwnd);
            keep_window_icons(hwnd as isize, vec![gone]);
            assert_eq!(free_window_icons(), 1);
            UnregisterClassW(class.as_ptr(), module);
        }
    }

    #[test]
    fn sidecar_app_id_is_the_identifier_with_sidecar_on_the_end() {
        assert_eq!(sidecar_app_id("dev.arc.app", false), "dev.arc.app.sidecar");
        assert_eq!(sidecar_app_id("dev.arc.app", true), "dev.arc.app-dev.sidecar");
    }

    #[test]
    fn sidecar_app_id_is_not_the_main_windows_id() {
        // a dev build's main window keeps no id at all, and a packaged one's is the bare identifier
        for dev in [false, true] {
            assert_ne!(sidecar_app_id("dev.arc.app", dev), "dev.arc.app");
        }
    }
}
