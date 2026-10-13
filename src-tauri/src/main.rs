#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

mod applog;
mod canvas;
mod estart;
mod init;
mod commands;
mod paths;

use init::InitState;
use std::io::{BufRead, BufReader};
use std::path::PathBuf;
use std::process::{Child, Command, Stdio};
use std::sync::Mutex;
use tauri::Manager;
use uuid::Uuid;

// Holds the spawned wavesrv so we can kill it on app exit. Without this the backend orphans when
// the window closes (Windows doesn't kill a child on parent exit) and the stale wavesrv keeps
// holding wave.lock + its own exe open — blocking the next launch and even reinstalls.
struct WavesrvChild(Mutex<Option<Child>>);

// Windows Job Object handle, held for the app's lifetime. RunEvent::Exit (below) reaps wavesrv on a
// graceful quit, but a Ctrl+C in a `task dev` terminal kills wave-tauri via the OS default handler
// *before* Tauri's event loop can emit RunEvent::Exit, so that path can't run. wavesrv is spawned
// CREATE_NO_WINDOW (see spawn_wavesrv), so it isn't in the console's Ctrl+C group and never gets the
// signal itself either — it orphans. Putting wavesrv in a KILL_ON_JOB_CLOSE job closes that gap: the
// job dies with its last handle, so when wave-tauri exits by ANY means the OS closes this handle and
// the kernel terminates every process in the job. We never close it ourselves — the OS does at
// process teardown, which is exactly when we want it to fire.
#[cfg(windows)]
struct JobHandle(#[allow(dead_code)] isize);
#[cfg(windows)]
unsafe impl Send for JobHandle {}
#[cfg(windows)]
unsafe impl Sync for JobHandle {}

// Returns Err (not a panic) so a missing/corrupted backend aborts setup visibly via Tauri's
// startup error path instead of an opaque crash; packaged runs at least exit non-zero.
fn spawn_wavesrv(
    auth_key: String,
    app_path: PathBuf,
    data_base: PathBuf,
    state: tauri::State<InitState>,
) -> Result<Child, String> {
    // Packaged: app_path = resource_dir(); dev: app_path = src-tauri/../dist (paths::resolve_app_path).
    // wavesrv + wsh both live under {app_path}/bin; wavesrv discovers wsh via WAVETERM_APP_PATH.
    let exe = app_path.join("bin").join("wavesrv.x64.exe");
    let (data_home, config_home) = paths::data_home_dirs(&data_base);
    let _ = std::fs::create_dir_all(&data_home);
    let _ = std::fs::create_dir_all(&config_home);
    let mut cmd = Command::new(&exe);
    cmd.env("WAVETERM_AUTH_KEY", &auth_key)
        .env("WAVETERM_APP_PATH", &app_path)
        .env("WAVETERM_DATA_HOME", &data_home)
        .env("WAVETERM_CONFIG_HOME", &config_home)
        // wavesrv logs to stderr (which we parse); discard stdout so an unread pipe can't
        // fill and deadlock it.
        .stdout(Stdio::null())
        .stderr(Stdio::piped());
    // wavesrv is a console-subsystem exe. A GUI (no-console) parent spawning it without this
    // flag makes Windows pop a separate console window for it — and closing that window sends
    // CTRL_CLOSE_EVENT, killing wavesrv and the whole backend. Run it with no console.
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        const CREATE_NO_WINDOW: u32 = 0x0800_0000;
        cmd.creation_flags(CREATE_NO_WINDOW);
    }
    let mut child = cmd
        .spawn()
        .map_err(|e| format!("failed to spawn wavesrv at {:?}: {}", exe, e))?;

    let stderr = child
        .stderr
        .take()
        .ok_or_else(|| "wavesrv stderr pipe missing".to_string())?;
    let state_data = state.0.clone();
    let ready = state.1.clone();
    std::thread::spawn(move || {
        let reader = BufReader::new(stderr);
        for line in reader.lines().flatten() {
            if let Some(info) = estart::parse_estart(&line) {
                let mut d = state_data.lock().unwrap();
                d.ws_endpoint = info.ws;
                d.web_endpoint = info.web;
                d.version = info.version;
                d.build_time = info.buildtime;
                // not {:?} of InitData: it carries the auth key, and this line is persisted
                applog::log_line(&format!(
                    "[tauri] wavesrv ready: ws={} web={} version={} build={}",
                    d.ws_endpoint, d.web_endpoint, d.version, d.build_time
                ));
                drop(d); // release before waking get_init so it doesn't re-block on the lock
                ready.notify_all();
            } else {
                // wavesrv prefixes its own lines with "[wavesrv] " (log.SetPrefix)
                applog::log_line(&line);
            }
        }
        // eof on stderr means wavesrv exited; without this line a backend crash leaves no trace
        applog::log_line("[tauri] wavesrv stderr closed");
    });

    Ok(child)
}

// Put a freshly-spawned child in a KILL_ON_JOB_CLOSE job so it dies with wave-tauri no matter how
// wave-tauri exits (graceful quit, crash, or a hard Ctrl+C that skips RunEvent::Exit). Returns the
// job handle for the caller to keep alive; None if any step fails (non-fatal — RunEvent::Exit still
// covers the graceful path).
#[cfg(windows)]
fn assign_kill_on_close_job(child: &Child) -> Option<JobHandle> {
    use std::os::windows::io::AsRawHandle;
    use windows_sys::Win32::Foundation::{CloseHandle, HANDLE};
    use windows_sys::Win32::System::JobObjects::{
        AssignProcessToJobObject, CreateJobObjectW, JobObjectExtendedLimitInformation,
        SetInformationJobObject, JOBOBJECT_EXTENDED_LIMIT_INFORMATION,
        JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE,
    };

    unsafe {
        let job = CreateJobObjectW(std::ptr::null(), std::ptr::null());
        if job.is_null() {
            return None;
        }
        let mut info: JOBOBJECT_EXTENDED_LIMIT_INFORMATION = std::mem::zeroed();
        info.BasicLimitInformation.LimitFlags = JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE;
        let size = std::mem::size_of::<JOBOBJECT_EXTENDED_LIMIT_INFORMATION>() as u32;
        if SetInformationJobObject(
            job,
            JobObjectExtendedLimitInformation,
            &info as *const _ as *const _,
            size,
        ) == 0
        {
            CloseHandle(job);
            return None;
        }
        if AssignProcessToJobObject(job, child.as_raw_handle() as HANDLE) == 0 {
            CloseHandle(job);
            return None;
        }
        Some(JobHandle(job as isize))
    }
}

// The bundle ships wsh version-named (e.g. wsh-0.14.5-windows.x64.exe), not a plain
// wsh.exe — find it by pattern in {app_path}/bin.
fn find_wsh_binary(bin_dir: &std::path::Path) -> Option<PathBuf> {
    let entries = std::fs::read_dir(bin_dir).ok()?;
    for entry in entries.flatten() {
        let name = entry.file_name();
        let name = name.to_string_lossy();
        if name.starts_with("wsh") && name.ends_with("windows.x64.exe") {
            return Some(entry.path());
        }
    }
    None
}

// Fire-and-forget: idempotently provision Arc's Claude Code hooks into the user's
// ~/.claude/settings.json. Runs every launch; wsh does the idempotent merge. Any
// failure is ignored — a missing hook only means degraded cockpit display.
fn install_agent_hooks(app_path: &std::path::Path) {
    let bin = app_path.join("bin");
    let Some(wsh) = find_wsh_binary(&bin) else {
        applog::log_line(&format!("[tauri] wsh not found under {:?}; skipping hook install", bin));
        return;
    };
    let mut cmd = Command::new(&wsh);
    cmd.arg("install-agent-hooks")
        .stdout(Stdio::null())
        .stderr(Stdio::null());
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        const CREATE_NO_WINDOW: u32 = 0x0800_0000;
        cmd.creation_flags(CREATE_NO_WINDOW);
    }
    match cmd.spawn() {
        Ok(_) => applog::log_line(&format!("[tauri] triggered agent-hooks install via {:?}", wsh)),
        Err(e) => applog::log_line(&format!("[tauri] agent-hooks install spawn failed: {}", e)),
    }
}

fn main() {
    let context = tauri::generate_context!();
    // WebView2 reads these env vars before the webview is created, so they must be set here in
    // main (before the Tauri builder), not in the setup hook. Dev-only: compiled out of packaged.
    #[cfg(debug_assertions)]
    {
        // expose WebView2's Chrome DevTools Protocol on :9222 for visual verification.
        if std::env::var_os("WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS").is_none() {
            std::env::set_var("WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS", "--remote-debugging-port=9222");
        }
        // Isolate dev's WebView2 profile from a co-installed packaged build (same identifier =>
        // same default EBWebView profile). Sharing it lets a dev launch kill the running packaged
        // app's window+wavesrv. See paths::dev_webview_data_dir.
        if std::env::var_os("WEBVIEW2_USER_DATA_FOLDER").is_none() {
            if let Some(local) = std::env::var_os("LOCALAPPDATA") {
                let app_local_data = PathBuf::from(local).join(&context.config().identifier);
                std::env::set_var("WEBVIEW2_USER_DATA_FOLDER", paths::dev_webview_data_dir(&app_local_data));
            }
        }
    }
    let auth_key = Uuid::new_v4().to_string();
    tauri::Builder::default()
        .plugin(tauri_plugin_http::init())
        .plugin(tauri_plugin_dialog::init())
        .manage(InitState::default())
        .manage(WavesrvChild(Mutex::new(None)))
        .invoke_handler(tauri::generate_handler![
            init::get_init,
            init::fe_log,
            commands::set_window_init_status,
            commands::open_external,
            canvas::capture_webview
        ])
        .setup(move |app| {
            // seed the static identity fields before wavesrv parsing fills in the endpoints.
            {
                let state = app.state::<InitState>();
                let mut d = state.0.lock().unwrap();
                d.auth_key = auth_key.clone();
                d.app_version = app.package_info().version.to_string();
                d.platform = "win32".to_string();
                d.is_dev = cfg!(debug_assertions);
                d.user_name = std::env::var("USERNAME").unwrap_or_default();
                d.host_name = std::env::var("COMPUTERNAME").unwrap_or_default();
            }
            let is_dev = cfg!(debug_assertions);
            let manifest_dir = std::path::Path::new(env!("CARGO_MANIFEST_DIR"));
            // resource_dir() only matters when packaged; avoid calling it in dev.
            let resource_dir = if is_dev { PathBuf::new() } else { app.path().resource_dir()? };
            let app_path = paths::resolve_app_path(is_dev, manifest_dir, &resource_dir);
            let data_base = paths::dev_data_base(
                paths::data_base_for(&app.path().app_local_data_dir()?, is_dev),
                is_dev,
                std::env::var_os(paths::DEV_DATA_DIR_ENV),
            );
            applog::init(&paths::data_home_dirs(&data_base).0);
            if is_dev && std::env::var_os(paths::DEV_NO_GLOBAL_INSTALL_ENV).is_some() {
                applog::log_line(
                    "[tauri] ARC_DEV_NO_GLOBAL_INSTALL is set; skipping the agent-hooks install",
                );
            } else {
                install_agent_hooks(&app_path);
            }
            let child = spawn_wavesrv(
                auth_key.clone(),
                app_path,
                data_base,
                app.state::<InitState>(),
            )
            .map_err(|e| {
                applog::log_line(&format!("[tauri] {}", e));
                e
            })?;
            // Safety net for the Ctrl+C path RunEvent::Exit can't catch: bind wavesrv's lifetime to
            // ours via a kill-on-close job. Held in state so the handle (and thus the job) survives.
            #[cfg(windows)]
            if let Some(job) = assign_kill_on_close_job(&child) {
                app.manage(job);
            }
            app.state::<WavesrvChild>().0.lock().unwrap().replace(child);
            Ok(())
        })
        .build(context)
        .expect("error while building tauri application")
        .run(|app_handle, event| {
            // Kill wavesrv when the app exits so it doesn't orphan and hold wave.lock + its exe.
            if let tauri::RunEvent::Exit = event {
                if let Some(mut child) = app_handle.state::<WavesrvChild>().0.lock().unwrap().take() {
                    let _ = child.kill();
                }
            }
        });
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;

    #[test]
    fn finds_versioned_wsh_binary() {
        let dir = std::env::temp_dir().join(format!("arc-wsh-test-{}", std::process::id()));
        let _ = fs::create_dir_all(&dir);
        fs::write(dir.join("wavesrv.x64.exe"), b"x").unwrap();
        fs::write(dir.join("wsh-0.14.5-windows.x64.exe"), b"x").unwrap();

        let got = find_wsh_binary(&dir).expect("should find wsh");
        assert_eq!(got.file_name().unwrap(), "wsh-0.14.5-windows.x64.exe");

        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn returns_none_when_no_wsh() {
        let dir = std::env::temp_dir().join(format!("arc-wsh-none-{}", std::process::id()));
        let _ = fs::create_dir_all(&dir);
        fs::write(dir.join("wavesrv.x64.exe"), b"x").unwrap();
        assert!(find_wsh_binary(&dir).is_none());
        let _ = fs::remove_dir_all(&dir);
    }

    // Proves the KILL_ON_JOB_CLOSE mechanism: once the last job handle closes, every process in the
    // job is terminated. Closing the handle here stands in for wave-tauri exiting (Ctrl+C, crash, or
    // quit) — the OS closes it identically in all three cases.
    #[cfg(windows)]
    #[test]
    fn job_kills_child_when_last_handle_closes() {
        use std::time::{Duration, Instant};
        use windows_sys::Win32::Foundation::{CloseHandle, HANDLE};

        // long-lived child so it can't self-exit inside the test window
        let mut child = Command::new("cmd")
            .args(["/c", "ping", "-n", "30", "127.0.0.1"])
            .stdout(Stdio::null())
            .stderr(Stdio::null())
            .spawn()
            .expect("spawn test child");

        let job = assign_kill_on_close_job(&child).expect("assign child to job");
        assert!(
            child.try_wait().unwrap().is_none(),
            "child died before the handle was closed"
        );

        unsafe { CloseHandle(job.0 as HANDLE) };

        let deadline = Instant::now() + Duration::from_secs(5);
        let mut exited = false;
        while Instant::now() < deadline {
            if child.try_wait().unwrap().is_some() {
                exited = true;
                break;
            }
            std::thread::sleep(Duration::from_millis(50));
        }
        let _ = child.kill(); // reap if the assertion is about to fail
        assert!(exited, "job did not kill child after its last handle closed");
    }
}
