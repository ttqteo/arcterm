//! The menu bar / tray icon and its popover (spec 2026-10-15-tray-popover-design.md). The icon shows what waits on
//! you, from the cockpit (set_tray_status); a left click opens the popover, a second webview window ("tray",
//! tray.html) that lives only while open, since a webview costs 50-100 MB and the popover is an occasional glance; a
//! right click opens Open / Quit. wavesrv's exit dims the icon here, since then no frontend can.

use std::sync::{Mutex, OnceLock};
use std::time::{Duration, Instant};

use tauri::image::Image;
use tauri::menu::{Menu, MenuItem};
use tauri::tray::{MouseButton, MouseButtonState, TrayIcon, TrayIconBuilder, TrayIconEvent};
use tauri::{
    AppHandle, Emitter, Listener, Manager, PhysicalPosition, PhysicalSize, Rect, WebviewUrl, WebviewWindow,
    WebviewWindowBuilder, WindowEvent, Wry,
};

use crate::applog::log_line;
use crate::trayicon::{self, R};

pub const TRAY_LABEL: &str = "tray";
const TRAY_ID: &str = "arc";
const WIDTH: f64 = 360.0;
const FIRST_HEIGHT: f64 = 480.0;
// the click on the icon that blurred the popover shut must not open it again
const REOPEN_GUARD: Duration = Duration::from_millis(250);

#[derive(Clone, Default)]
struct State {
    count: u32,
    alert: bool,
    visible: bool,
    offline: bool,
    icon: Option<R>,
    height: Option<f64>,
    closed_at: Option<Instant>,
    // the click that opened the popover, until its page says hello: the cold open's cost, logged
    opened_at: Option<Instant>,
}

fn state() -> &'static Mutex<State> {
    static S: OnceLock<Mutex<State>> = OnceLock::new();
    S.get_or_init(|| Mutex::new(State::default()))
}

static APP: OnceLock<AppHandle> = OnceLock::new();

// only macOS and Windows build the icon (main.rs gates the call), so Linux compiles this without using it
#[cfg_attr(not(any(target_os = "macos", windows)), allow(dead_code))]
pub fn setup(app: &AppHandle) -> tauri::Result<()> {
    let _ = APP.set(app.clone());
    let open = MenuItem::with_id(app, "tray-open", "Open arcterm", true, None::<&str>)?;
    let quit = MenuItem::with_id(app, "tray-quit", "Quit arcterm", true, None::<&str>)?;
    let menu = Menu::with_items(app, &[&open, &quit])?;
    let builder = TrayIconBuilder::with_id(TRAY_ID)
        .icon(icon_image(app, &State::default()))
        .icon_as_template(cfg!(target_os = "macos"))
        .tooltip("arcterm")
        .show_menu_on_left_click(false)
        // a tray's menu handler hears every menu event, so it hears Open / Quit while pop_menu has them attached
        .on_menu_event(|app, ev| match ev.id().as_ref() {
            "tray-open" => {
                let _ = app.emit("tray:act", serde_json::json!({ "kind": "open-arcterm" }));
            }
            "tray-quit" => app.exit(0),
            _ => {}
        });
    // macOS 27 opens a status item's attached menu itself on a left click, and the click never reaches the app, so
    // the popover could not open: on a Mac the menu is attached only for the right click that opens it (pop_menu)
    let builder = if cfg!(target_os = "macos") { builder } else { builder.menu(&menu) };
    let tray = builder
        .on_tray_icon_event(move |tray, ev| {
            if let TrayIconEvent::Click { button, button_state, rect, .. } = ev {
                match (button, button_state) {
                    (MouseButton::Left, MouseButtonState::Up) => toggle(tray.app_handle(), rect),
                    (MouseButton::Right, MouseButtonState::Down) if cfg!(target_os = "macos") => pop_menu(tray, &menu),
                    _ => {}
                }
            }
        })
        .build(app)?;
    // hidden until the cockpit reports its first status: app:tray may be off
    tray.set_visible(false)?;
    let handle = app.clone();
    app.listen_any("tray:act", move |ev| {
        let payload = ev.payload().to_string();
        let app = handle.clone();
        let _ = handle.run_on_main_thread(move || on_act(&app, &payload));
    });
    Ok(())
}

// macOS: attach the menu, click the button, which tracks the menu until it closes, then take the menu off again so the
// next left click reaches the popover
#[cfg_attr(not(target_os = "macos"), allow(dead_code))]
fn pop_menu(tray: &TrayIcon, menu: &Menu<Wry>) {
    let _ = tray.set_menu(Some(menu.clone()));
    let _ = tray.with_inner_tray_icon(|inner| inner.show_menu());
    let _ = tray.set_menu(None::<Menu<Wry>>);
}

fn icon_image(app: &AppHandle, st: &State) -> Image<'static> {
    let img = if cfg!(target_os = "macos") {
        trayicon::mac_icon(st.offline)
    } else {
        let scale = app.primary_monitor().ok().flatten().map(|m| m.scale_factor()).unwrap_or(1.0);
        trayicon::win_icon(trayicon::win_icon_size(scale), st.count, st.alert, st.offline)
    };
    Image::new_owned(img.px, img.width, img.height)
}

fn apply(app: &AppHandle, st: &State) {
    let Some(tray) = app.tray_by_id(TRAY_ID) else {
        return;
    };
    let _ = tray.set_icon(Some(icon_image(app, st)));
    #[cfg(target_os = "macos")]
    {
        let _ = tray.set_icon_as_template(true);
        let title = trayicon::mac_title(st.count, st.alert, st.offline);
        // Some(""), never None: tray-icon 0.24.1's set_title(None) leaves the old title on the button
        let _ = tray.set_title(Some(title.clone()));
        if title.starts_with(trayicon::MAC_ALERT) {
            crate::macwindow::tint_tray_alert(&tray, title);
        }
    }
    let _ = tray.set_tooltip(Some(trayicon::tooltip(st.count, st.alert, st.offline)));
    // `app:tray` off keeps the icon hidden, offline too.
    let _ = tray.set_visible(st.visible);
}

#[tauri::command]
pub fn set_tray_status(app: AppHandle, count: u32, alert: bool, visible: bool) {
    let st = {
        let mut s = state().lock().unwrap();
        s.count = count;
        s.alert = alert;
        s.visible = visible;
        s.clone()
    };
    apply(&app, &st);
    if !visible {
        close(&app, "the icon is off");
    }
}

#[tauri::command]
pub fn tray_popover_size(app: AppHandle, height: f64) {
    state().lock().unwrap().height = Some(height);
    if let Some(win) = app.get_webview_window(TRAY_LABEL) {
        place(&app, &win);
    }
}

/// wavesrv's stderr closed: dim the icon and tell an open popover. Called from the stderr reader thread.
pub fn wavesrv_gone() {
    let Some(app) = APP.get().cloned() else {
        return;
    };
    let app2 = app.clone();
    let _ = app.run_on_main_thread(move || {
        let st = {
            let mut s = state().lock().unwrap();
            s.offline = true;
            s.clone()
        };
        apply(&app2, &st);
        let _ = app2.emit_to(TRAY_LABEL, "tray:offline", serde_json::json!({}));
    });
}

fn toggle(app: &AppHandle, rect: Rect) {
    if app.get_webview_window(TRAY_LABEL).is_some() {
        close(app, "a second click on the icon");
        return;
    }
    {
        let mut s = state().lock().unwrap();
        if s.closed_at.is_some_and(|t| t.elapsed() < REOPEN_GUARD) {
            return;
        }
        let scale = app.primary_monitor().ok().flatten().map(|m| m.scale_factor()).unwrap_or(1.0);
        let p = rect.position.to_physical::<f64>(scale);
        let z = rect.size.to_physical::<f64>(scale);
        s.icon = Some(R { x: p.x, y: p.y, w: z.width, h: z.height });
        s.opened_at = Some(Instant::now());
    }
    if let Err(e) = open(app) {
        log_line(&format!("[tray] opening the popover failed: {e}"));
    }
}

fn open(app: &AppHandle) -> tauri::Result<()> {
    let win = WebviewWindowBuilder::new(app, TRAY_LABEL, WebviewUrl::App("tray.html".into()))
        .title("arcterm")
        .inner_size(WIDTH, FIRST_HEIGHT)
        .decorations(false)
        .transparent(true)
        .shadow(true)
        .resizable(false)
        .always_on_top(true)
        .skip_taskbar(true)
        .visible_on_all_workspaces(true)
        .visible(false)
        .focused(false)
        .build()?;
    place(app, &win);
    let handle = app.clone();
    win.on_window_event(move |ev| {
        if let WindowEvent::Focused(false) = ev {
            log_line("[tray] the popover lost focus");
            let app = handle.clone();
            // not inside the window's own event: destroying it there tears down what is dispatching
            let _ = handle.run_on_main_thread(move || close(&app, "it lost focus"));
        }
    });
    if cfg!(target_os = "macos") {
        // the window stays hidden and its webview shows in a panel, whose losing the key is the blur
        crate::macwindow::show_in_panel(&win, panel_blurred);
    } else {
        win.show()?;
        win.set_focus()?;
    }
    Ok(())
}

fn panel_blurred() {
    let Some(app) = APP.get() else {
        return;
    };
    log_line("[tray] the popover lost focus");
    let app2 = app.clone();
    // not inside AppKit's resignKeyWindow: destroying the panel there tears down what is dispatching
    let _ = app.run_on_main_thread(move || close(&app2, "it lost focus"));
}

fn place(app: &AppHandle, win: &WebviewWindow) {
    let (icon, height) = {
        let s = state().lock().unwrap();
        (s.icon, s.height.unwrap_or(FIRST_HEIGHT))
    };
    let Some(icon) = icon else {
        return;
    };
    let monitor = app
        .monitor_from_point(icon.x + icon.w / 2.0, icon.y + icon.h / 2.0)
        .ok()
        .flatten()
        .or_else(|| app.primary_monitor().ok().flatten());
    let Some(monitor) = monitor else {
        return;
    };
    let scale = monitor.scale_factor();
    let wa = monitor.work_area();
    let work = R {
        x: wa.position.x as f64,
        y: wa.position.y as f64,
        w: wa.size.width as f64,
        h: wa.size.height as f64,
    };
    let size = (WIDTH * scale, (height * scale).min(work.h - 16.0 * scale));
    let (x, y) = trayicon::popover_origin(icon, size, work);
    let _ = win.set_size(PhysicalSize::new(size.0.round() as u32, size.1.round() as u32));
    let _ = win.set_position(PhysicalPosition::new(x.round() as i32, y.round() as i32));
    crate::macwindow::panel_follow(win);
}

// `why` is logged on either side of the destroy, which on the Mac once aborted the app (macwindow::show_in_panel)
fn close(app: &AppHandle, why: &str) {
    if let Some(win) = app.get_webview_window(TRAY_LABEL) {
        log_line(&format!("[tray] closing the popover: {why}"));
        // on the Mac the webview goes back into its own window first, where wry takes it out on destroy
        crate::macwindow::close_panel();
        let _ = win.destroy();
        log_line("[tray] popover closed");
        state().lock().unwrap().closed_at = Some(Instant::now());
        let _ = app.emit("tray:closed", ());
    }
}

/// The app is exiting with the popover open (⌘Q): its webview goes back into its own window, as close puts it, before
/// Tauri drops the windows.
pub fn before_exit(app: &AppHandle) {
    if app.get_webview_window(TRAY_LABEL).is_some() {
        crate::macwindow::close_panel();
    }
}

fn on_act(app: &AppHandle, payload: &str) {
    let Ok(v) = serde_json::from_str::<serde_json::Value>(payload) else {
        return;
    };
    let kind = v.get("kind").and_then(|k| k.as_str()).unwrap_or("");
    match kind {
        "hello" => {
            // the spec keeps the window hidden after its first open instead, if this is past 0.5 s on the Mac
            let opened = state().lock().unwrap().opened_at.take();
            if let Some(t) = opened {
                log_line(&format!("[tray] popover ready {} ms after the click", t.elapsed().as_millis()));
            }
            if state().lock().unwrap().offline {
                let _ = app.emit_to(TRAY_LABEL, "tray:offline", serde_json::json!({}));
            }
        }
        "close" => close(app, "the page asked"),
        "restart" => {
            close(app, "Restart arcterm");
            app.restart();
        }
        "quit" => {
            close(app, "Quit arcterm");
            app.exit(0);
        }
        "showlog" => {
            close(app, "Show log");
            if let Some(path) = crate::applog::log_path() {
                if let Err(e) = open::that(&path) {
                    log_line(&format!("[tray] opening {path:?} failed: {e}"));
                }
            }
        }
        "open-monitor" => {
            close(app, "the OS monitor");
            let spawned = if cfg!(target_os = "macos") {
                std::process::Command::new("open").args(["-a", "Activity Monitor"]).spawn()
            } else {
                std::process::Command::new("taskmgr").spawn()
            };
            if let Err(e) = spawned {
                log_line(&format!("[tray] opening the OS's monitor failed: {e}"));
            }
        }
        k if k.starts_with("open-") => close(app, k),
        _ => {}
    }
}
