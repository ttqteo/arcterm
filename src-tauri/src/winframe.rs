// The main window's frame across launches (window-frame.json in the app config dir): kept as the window moves and
// resizes, written at exit, and set over tauri.conf.json's default at the next launch when it is still on a screen.
// Float and the fold shrink this same window: while the frontend holds the frame (hold_window_frame, sent whenever it
// lifts the window's minimum size), those frames are not kept, so a quit mid-float reopens at the frame Float was
// entered from. Native fullscreen is not kept either; the frame under it is.

use crate::applog;
use serde::{Deserialize, Serialize};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Mutex;
use tauri::{
    AppHandle, Manager, PhysicalPosition, PhysicalSize, Runtime, WebviewWindow, WindowEvent,
};

const FILE: &str = "window-frame.json";

static HELD: AtomicBool = AtomicBool::new(false);
static LAST: Mutex<Option<Frame>> = Mutex::new(None);

// physical pixels: the outer position and the inner size, as set_position and set_size take them
#[derive(Clone, Copy, Debug, PartialEq, Serialize, Deserialize)]
pub struct Frame {
    pub x: i32,
    pub y: i32,
    pub width: u32,
    pub height: u32,
    pub maximized: bool,
}

// the window as one move or resize left it
#[derive(Clone, Copy, Debug)]
pub struct Seen {
    pub x: i32,
    pub y: i32,
    pub width: u32,
    pub height: u32,
    pub maximized: bool,
    pub minimized: bool,
    pub fullscreen: bool,
}

// The frame to keep after a move or resize. Minimized or fullscreen, the one before stands. Maximized, the frame before
// stands with the flag set, so an unmaximize after the next launch has a size to go back to.
pub fn next_frame(prev: Option<Frame>, seen: Seen) -> Option<Frame> {
    if seen.minimized || seen.fullscreen {
        return prev;
    }
    if seen.maximized {
        if let Some(p) = prev {
            return Some(Frame {
                maximized: true,
                ..p
            });
        }
    }
    Some(Frame {
        x: seen.x,
        y: seen.y,
        width: seen.width,
        height: seen.height,
        maximized: seen.maximized,
    })
}

// a saved frame is set back only when it overlaps a screen there now; one left on an unplugged display is dropped
pub fn on_screen(f: &Frame, screens: &[(i32, i32, u32, u32)]) -> bool {
    let (l, t) = (f.x as i64, f.y as i64);
    let (r, b) = (l + f.width as i64, t + f.height as i64);
    screens.iter().any(|&(x, y, w, h)| {
        let (sl, st) = (x as i64, y as i64);
        l < sl + w as i64 && r > sl && t < st + h as i64 && b > st
    })
}

// Float and the fold lift the window's minimum size before they shrink it and give the main one back with the Full
// frame (floatstore.ts setMinSize); held, a move or resize is not the frame to reopen at
#[tauri::command]
pub fn hold_window_frame(held: bool) {
    HELD.store(held, Ordering::SeqCst);
}

fn keep<R: Runtime>(window: &WebviewWindow<R>) {
    if HELD.load(Ordering::SeqCst) {
        return;
    }
    let (Ok(pos), Ok(size)) = (window.outer_position(), window.inner_size()) else {
        return;
    };
    let seen = Seen {
        x: pos.x,
        y: pos.y,
        width: size.width,
        height: size.height,
        maximized: window.is_maximized().unwrap_or(false),
        minimized: window.is_minimized().unwrap_or(false),
        fullscreen: window.is_fullscreen().unwrap_or(false),
    };
    let mut last = LAST.lock().unwrap();
    *last = next_frame(*last, seen);
}

// Set the saved frame back, if it is still on a screen, then keep the frame as the window moves and resizes. Called in
// setup, before the window first draws.
pub fn restore_and_track<R: Runtime>(window: &WebviewWindow<R>) {
    if let Some(f) = read(window.app_handle()) {
        let screens: Vec<(i32, i32, u32, u32)> = window
            .available_monitors()
            .unwrap_or_default()
            .iter()
            .map(|m| {
                (
                    m.position().x,
                    m.position().y,
                    m.size().width,
                    m.size().height,
                )
            })
            .collect();
        if on_screen(&f, &screens) {
            // tauri.conf.json opens it maximized. Windows needs the restore before a smaller frame; macOS runs
            // unmaximize as an animated zoom, and the frame set next takes it out of the zoom alone (floatstore.ts)
            if !f.maximized && cfg!(not(target_os = "macos")) {
                let _ = window.unmaximize();
            }
            let _ = window.set_size(PhysicalSize::new(f.width, f.height));
            let _ = window.set_position(PhysicalPosition::new(f.x, f.y));
            if f.maximized {
                let _ = window.maximize();
            }
            *LAST.lock().unwrap() = Some(f);
        } else {
            applog::log_line(
                "[tauri] the saved window frame is on no screen now; opening at the default",
            );
        }
    }
    let w = window.clone();
    window.on_window_event(move |e| {
        if matches!(e, WindowEvent::Moved(_) | WindowEvent::Resized(_)) {
            keep(&w);
        }
    });
}

fn read<R: Runtime>(app: &AppHandle<R>) -> Option<Frame> {
    let path = app.path().app_config_dir().ok()?.join(FILE);
    let text = std::fs::read_to_string(path).ok()?;
    serde_json::from_str(&text).ok()
}

// at exit: the frame last kept, if any; a launch that never moved or resized the window leaves the file as it was
pub fn save<R: Runtime>(app: &AppHandle<R>) {
    let Some(f) = *LAST.lock().unwrap() else {
        return;
    };
    let Ok(dir) = app.path().app_config_dir() else {
        return;
    };
    let write = std::fs::create_dir_all(&dir).and_then(|_| {
        std::fs::write(
            dir.join(FILE),
            serde_json::to_string(&f).unwrap_or_default(),
        )
    });
    if let Err(e) = write {
        applog::log_line(&format!("[tauri] saving the window frame failed: {}", e));
    }
}

#[cfg(test)]
mod tests {
    use super::*;

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

    #[test]
    fn keeps_the_frame_a_move_or_resize_left() {
        let f = next_frame(None, seen(100, 50, 1440, 900));
        assert_eq!(
            f,
            Some(Frame {
                x: 100,
                y: 50,
                width: 1440,
                height: 900,
                maximized: false
            })
        );
    }

    #[test]
    fn a_maximized_window_keeps_the_frame_under_it() {
        let prev = Some(Frame {
            x: 100,
            y: 50,
            width: 1440,
            height: 900,
            maximized: false,
        });
        let f = next_frame(
            prev,
            Seen {
                maximized: true,
                ..seen(0, 0, 2940, 1800)
            },
        );
        assert_eq!(
            f,
            Some(Frame {
                x: 100,
                y: 50,
                width: 1440,
                height: 900,
                maximized: true
            })
        );
    }

    #[test]
    fn a_window_first_seen_maximized_keeps_that_frame() {
        let f = next_frame(
            None,
            Seen {
                maximized: true,
                ..seen(0, 0, 2940, 1800)
            },
        );
        assert_eq!(
            f,
            Some(Frame {
                x: 0,
                y: 0,
                width: 2940,
                height: 1800,
                maximized: true
            })
        );
    }

    #[test]
    fn minimized_or_fullscreen_leaves_the_frame_before() {
        let prev = Some(Frame {
            x: 100,
            y: 50,
            width: 1440,
            height: 900,
            maximized: false,
        });
        assert_eq!(
            next_frame(
                prev,
                Seen {
                    minimized: true,
                    ..seen(-32000, -32000, 160, 28)
                }
            ),
            prev
        );
        assert_eq!(
            next_frame(
                prev,
                Seen {
                    fullscreen: true,
                    ..seen(0, 0, 2940, 1912)
                }
            ),
            prev
        );
    }

    #[test]
    fn a_frame_on_a_screen_is_set_back() {
        let f = Frame {
            x: 100,
            y: 50,
            width: 1440,
            height: 900,
            maximized: false,
        };
        assert!(on_screen(&f, &[(0, 0, 2940, 1912)]));
        // half off the right edge still overlaps
        assert!(on_screen(&Frame { x: 2500, ..f }, &[(0, 0, 2940, 1912)]));
    }

    #[test]
    fn a_frame_left_on_an_unplugged_display_is_dropped() {
        let f = Frame {
            x: 3200,
            y: 100,
            width: 1440,
            height: 900,
            maximized: false,
        };
        assert!(!on_screen(&f, &[(0, 0, 2940, 1912)]));
        assert!(on_screen(&f, &[(0, 0, 2940, 1912), (2940, 0, 3840, 2160)]));
        assert!(!on_screen(&f, &[]));
    }
}
