//! The menu bar / tray icon and its popover (spec 2026-10-15-tray-popover-design.md). The icon shows what waits on
//! you, from the cockpit (set_tray_status); a left click, and on a Mac a right click too, opens the popover, a second
//! webview window ("tray", tray.html); on Windows a right click opens Open / Quit. The popover's window is built on the
//! pointer's first hover over the icon, or the click, and kept hidden between opens: a fresh one each open took
//! 0.5-1.8 s on an 8 GB Mac, past the spec's 0.5 s line. It is dropped, and its 50-100 MB go back, at critical memory
//! pressure and with the icon off (trayicon::keeps_popover). wavesrv's exit dims the icon here, since then no frontend
//! can.

use std::sync::{Mutex, OnceLock};
use std::time::{Duration, Instant};

use tauri::image::Image;
use tauri::menu::{Menu, MenuItem};
use tauri::tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent};
use tauri::{
    AppHandle, Emitter, Listener, Manager, PhysicalPosition, PhysicalSize, Rect, WebviewUrl, WebviewWindow,
    WebviewWindowBuilder, WindowEvent,
};

use crate::applog::log_line;
use crate::trayicon::{self, Click, R};

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
    // the memory free beside the icon; None when app:traymemory is off or wavesrv gave no reading
    mem: Option<u64>,
    visible: bool,
    offline: bool,
    icon: Option<R>,
    height: Option<f64>,
    // the popover is on screen; its window may be there hidden, kept for the next open
    shown: bool,
    closed_at: Option<Instant>,
    // the kept window's page has said hello, and has shown at least once
    loaded: bool,
    shown_once: bool,
    // the window's build, until its page says hello, and the click, until the page says it shows: both logged
    built_at: Option<Instant>,
    opened_at: Option<(Instant, &'static str)>,
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
        .on_menu_event(|app, ev| match ev.id().as_ref() {
            "tray-open" => {
                let _ = app.emit("tray:act", serde_json::json!({ "kind": "open-arcterm" }));
            }
            "tray-quit" => app.exit(0),
            _ => {}
        });
    // On a Mac both clicks open the popover and there is no menu: macOS 27 opens a status item's attached menu itself
    // on a left click and never passes the click on, and the popover's footer has Open arcterm. Windows keeps Open /
    // Quit on a right click.
    let builder = if cfg!(target_os = "macos") { builder } else { builder.menu(&menu) };
    let tray = builder
        .on_tray_icon_event(|tray, ev| match ev {
            TrayIconEvent::Click { button, button_state: MouseButtonState::Up, rect, .. } => {
                let opens = button == MouseButton::Left || (cfg!(target_os = "macos") && button == MouseButton::Right);
                if opens {
                    toggle(tray.app_handle(), rect);
                }
            }
            // the page loads while the pointer travels to the click
            TrayIconEvent::Enter { .. } => warm_on_hover(tray.app_handle()),
            _ => {}
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
        let title = trayicon::mac_title(st.count, st.alert, st.offline, st.mem);
        // Some(""), never None: tray-icon 0.24.1's set_title(None) leaves the old title on the button
        let _ = tray.set_title(Some(title.clone()));
        if title.starts_with(trayicon::MAC_ALERT) {
            crate::macwindow::tint_tray_alert(&tray, title);
        }
    }
    let _ = tray.set_tooltip(Some(trayicon::tooltip(st.count, st.alert, st.offline, st.mem)));
    // `app:tray` off keeps the icon hidden, offline too.
    let _ = tray.set_visible(st.visible);
}

#[tauri::command]
pub fn set_tray_status(app: AppHandle, count: u32, alert: bool, mem_free: Option<u64>, visible: bool) {
    let st = {
        let mut s = state().lock().unwrap();
        s.count = count;
        s.alert = alert;
        s.mem = mem_free;
        s.visible = visible;
        s.clone()
    };
    apply(&app, &st);
    if !visible {
        hide(&app, "the icon is off");
    }
    drop_unkept(&app);
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
    let built = app.get_webview_window(TRAY_LABEL).is_some();
    {
        let mut s = state().lock().unwrap();
        match trayicon::click_action(s.shown, s.closed_at.map(|t| t.elapsed()), REOPEN_GUARD) {
            Click::Hide => {
                drop(s);
                hide(app, "a second click on the icon");
                return;
            }
            Click::Ignore => return,
            Click::Show => {}
        }
        let scale = app.primary_monitor().ok().flatten().map(|m| m.scale_factor()).unwrap_or(1.0);
        let p = rect.position.to_physical::<f64>(scale);
        let z = rect.size.to_physical::<f64>(scale);
        s.icon = Some(R { x: p.x, y: p.y, w: z.width, h: z.height });
        let how = match (built, s.loaded, s.shown_once) {
            (false, _, _) => "cold",
            (true, false, _) => "still loading",
            (true, true, false) => "warmed",
            (true, true, true) => "kept",
        };
        s.opened_at = Some((Instant::now(), how));
    }
    if let Err(e) = open(app) {
        log_line(&format!("[tray] opening the popover failed: {e}"));
    }
}

fn warm_on_hover(app: &AppHandle) {
    let keeps = {
        let s = state().lock().unwrap();
        trayicon::keeps_popover(s.alert, s.visible)
    };
    if keeps && app.get_webview_window(TRAY_LABEL).is_none() {
        if let Err(e) = window(app, "the pointer is over the icon") {
            log_line(&format!("[tray] building the popover failed: {e}"));
        }
    }
}

// The popover's window, built hidden if there is none
fn window(app: &AppHandle, why: &str) -> tauri::Result<WebviewWindow> {
    if let Some(win) = app.get_webview_window(TRAY_LABEL) {
        return Ok(win);
    }
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
    log_line(&format!("[tray] built the popover's window: {why}"));
    state().lock().unwrap().built_at = Some(Instant::now());
    let handle = app.clone();
    win.on_window_event(move |ev| {
        if let WindowEvent::Focused(false) = ev {
            log_line("[tray] the popover lost focus");
            let app = handle.clone();
            // not inside the window's own event: a drop there tears down what is dispatching
            let _ = handle.run_on_main_thread(move || hide(&app, "it lost focus"));
        }
    });
    Ok(win)
}

fn open(app: &AppHandle) -> tauri::Result<()> {
    let win = window(app, "a click on the icon")?;
    {
        let mut s = state().lock().unwrap();
        s.shown = true;
        s.shown_once = true;
    }
    place(app, &win);
    if cfg!(target_os = "macos") {
        // the window stays hidden and its webview shows in a panel, whose losing the key is the blur; the panel takes
        // the frame place gave the window, which tao sets after this returns
        let w = win.clone();
        let app2 = app.clone();
        crate::macwindow::after_tao_frame(move || {
            crate::macwindow::show_in_panel(&w, panel_blurred);
            // the icon draws selected while the panel shows; hide_panel lets it go
            #[cfg(target_os = "macos")]
            if let Some(tray) = app2.tray_by_id(TRAY_ID) {
                crate::macwindow::present_from_tray(&tray);
            }
            #[cfg(not(target_os = "macos"))]
            let _ = app2;
        });
    } else {
        win.show()?;
        win.set_focus()?;
    }
    // the cockpit starts feeding it; a page still loading misses this and hears it at its hello
    let _ = app.emit("tray:shown", ());
    Ok(())
}

fn panel_blurred() {
    let Some(app) = APP.get() else {
        return;
    };
    log_line("[tray] the popover lost focus");
    let app2 = app.clone();
    // not inside AppKit's resignKeyWindow: hiding or dropping the panel there tears down what is dispatching
    let _ = app.run_on_main_thread(move || hide(&app2, "it lost focus"));
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
    let w = win.clone();
    crate::macwindow::after_tao_frame(move || crate::macwindow::panel_follow(&w));
}

// The popover goes off screen and its window stays for the next open, unless keeps_popover says otherwise
fn hide(app: &AppHandle, why: &str) {
    let Some(win) = app.get_webview_window(TRAY_LABEL) else {
        return;
    };
    {
        let mut s = state().lock().unwrap();
        if !s.shown {
            return;
        }
        s.shown = false;
        s.closed_at = Some(Instant::now());
    }
    log_line(&format!("[tray] hiding the popover: {why}"));
    if cfg!(target_os = "macos") {
        crate::macwindow::hide_panel();
    } else {
        let _ = win.hide();
    }
    let _ = app.emit("tray:closed", ());
    drop_unkept(app);
}

fn drop_unkept(app: &AppHandle) {
    let why = {
        let s = state().lock().unwrap();
        if s.shown || trayicon::keeps_popover(s.alert, s.visible) {
            return;
        }
        if s.visible {
            "memory pressure is critical"
        } else {
            "the icon is off"
        }
    };
    let Some(win) = app.get_webview_window(TRAY_LABEL) else {
        return;
    };
    // `why` is logged on either side of the destroy, which on the Mac once aborted the app (macwindow::show_in_panel)
    log_line(&format!("[tray] dropping the hidden popover: {why}"));
    // on the Mac the webview goes back into its own window first, where wry takes it out on destroy, and the window
    // and delegate tao would leave behind are freed a moment after
    crate::macwindow::close_panel();
    crate::macwindow::free_when_destroyed(&win);
    let _ = win.destroy();
    {
        let mut s = state().lock().unwrap();
        s.loaded = false;
        s.shown_once = false;
        s.built_at = None;
    }
    log_line("[tray] popover dropped");
}

/// The icon shows (`app:tray` on), so closing the main window hides it and arcterm keeps running from the icon,
/// whose popover's Open arcterm, or the Dock icon, brings it back. With the icon off, or none built (Linux, or a
/// failed setup), closing it quits.
pub fn keeps_app_open(app: &AppHandle) -> bool {
    app.tray_by_id(TRAY_ID).is_some() && state().lock().unwrap().visible
}

/// The app is exiting with the popover's window there, shown or kept (⌘Q): its webview goes back into its own window,
/// as a drop puts it, before Tauri drops the windows.
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
            let (built, shown, offline) = {
                let mut s = state().lock().unwrap();
                s.loaded = true;
                (s.built_at.take(), s.shown, s.offline)
            };
            if let Some(t) = built {
                log_line(&format!("[tray] popover page loaded {} ms after its window was built", t.elapsed().as_millis()));
            }
            // a click while it loaded: its tray:shown went out before the page listened
            if shown {
                let _ = app.emit_to(TRAY_LABEL, "tray:shown", ());
            }
            if offline {
                let _ = app.emit_to(TRAY_LABEL, "tray:offline", serde_json::json!({}));
            }
        }
        "shown" => {
            // the spec's 0.5 s line for an open; a kept or warmed popover should be a frame or two
            let opened = state().lock().unwrap().opened_at.take();
            if let Some((t, how)) = opened {
                log_line(&format!("[tray] popover shown {} ms after the click ({how})", t.elapsed().as_millis()));
            }
        }
        "close" => hide(app, "the page asked"),
        "restart" => {
            hide(app, "Restart arcterm");
            app.restart();
        }
        "quit" => {
            hide(app, "Quit arcterm");
            app.exit(0);
        }
        "showlog" => {
            hide(app, "Show log");
            if let Some(path) = crate::applog::log_path() {
                if let Err(e) = open::that(&path) {
                    log_line(&format!("[tray] opening {path:?} failed: {e}"));
                }
            }
        }
        "open-monitor" => {
            hide(app, "the OS monitor");
            let spawned = if cfg!(target_os = "macos") {
                std::process::Command::new("open").args(["-a", "Activity Monitor"]).spawn()
            } else {
                std::process::Command::new("taskmgr").spawn()
            };
            if let Err(e) = spawned {
                log_line(&format!("[tray] opening the OS's monitor failed: {e}"));
            }
        }
        k if k.starts_with("open-") => hide(app, k),
        _ => {}
    }
}
