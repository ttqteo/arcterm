use serde::Serialize;
use std::sync::{Arc, Condvar, Mutex};
use std::time::{Duration, Instant};

#[derive(Default, Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct InitData {
    pub ws_endpoint: String,
    pub web_endpoint: String,
    pub auth_key: String,
    // app_version is this shell's own version (tauri.conf.json, synced from package.json);
    // version is the wavesrv it spawned, read off the ESTART line. They are stamped by separate
    // build steps, so a stale dist/bin makes them disagree and the frontend says so.
    pub app_version: String,
    pub version: String,
    pub build_time: i64,
    pub platform: String,
    pub is_dev: bool,
    pub user_name: String,
    pub host_name: String,
}

// .0 holds the boot data; .1 is signalled by the wavesrv stderr reader once it parses
// the ESTART line and fills in the endpoints.
#[derive(Default)]
pub struct InitState(pub Arc<Mutex<InitData>>, pub Arc<Condvar>);

// wavesrv only prints its ESTART line (the endpoints) after it binds its ports and inits
// the SQLite store — which, on a fresh data dir, lands well after the packaged webview
// loads from disk and calls get_init. Returning the empty default there makes the frontend
// build a URL from an empty endpoint, which collapses to host "wave" and fails the http
// scope. Block until the endpoints are populated; bounded so a wavesrv that never starts
// surfaces as a clear empty-endpoint error rather than hanging forever.
const ENDPOINT_WAIT: Duration = Duration::from_secs(15);

pub fn wait_for_endpoints(data: &Arc<Mutex<InitData>>, ready: &Condvar, timeout: Duration) -> InitData {
    let deadline = Instant::now() + timeout;
    let mut d = data.lock().unwrap();
    while d.web_endpoint.is_empty() {
        let Some(remaining) = deadline.checked_duration_since(Instant::now()) else {
            break;
        };
        let (guard, res) = ready.wait_timeout(d, remaining).unwrap();
        d = guard;
        if res.timed_out() {
            break;
        }
    }
    d.clone()
}

// async and off the main thread: tauri builds every config window before running our setup hook
// (which spawns wavesrv), and building the attention-popup pumps the message loop, so the main
// page can call get_init that early. a sync command would block the main thread there, setup
// could never spawn wavesrv, and the wait would always time out to empty endpoints.
#[tauri::command]
pub async fn get_init(state: tauri::State<'_, InitState>) -> Result<InitData, String> {
    let (data, ready) = (state.0.clone(), state.1.clone());
    tauri::async_runtime::spawn_blocking(move || wait_for_endpoints(&data, &ready, ENDPOINT_WAIT))
        .await
        .map_err(|e| format!("get_init wait failed: {}", e))
}

// backs both getApi().sendLog and the harness's hlog. Renamed from harness_log:
// the WebView2 console isn't observable from the dev loop, so logs land in the Rust console.
#[tauri::command]
pub fn fe_log(msg: String) {
    crate::applog::log_line(&format!("[fe-log] {}", msg));
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn wait_returns_endpoints_once_the_reader_fills_them() {
        let data = Arc::new(Mutex::new(InitData::default()));
        let ready = Arc::new(Condvar::new());
        let (d2, r2) = (data.clone(), ready.clone());
        std::thread::spawn(move || {
            std::thread::sleep(Duration::from_millis(50));
            d2.lock().unwrap().web_endpoint = "127.0.0.1:5000".to_string();
            r2.notify_all();
        });
        let got = wait_for_endpoints(&data, &ready, Duration::from_secs(5));
        assert_eq!(got.web_endpoint, "127.0.0.1:5000");
    }

    #[test]
    fn wait_times_out_to_empty_when_wavesrv_never_reports() {
        let data = Arc::new(Mutex::new(InitData::default()));
        let ready = Arc::new(Condvar::new());
        let got = wait_for_endpoints(&data, &ready, Duration::from_millis(50));
        assert!(got.web_endpoint.is_empty());
    }
}
