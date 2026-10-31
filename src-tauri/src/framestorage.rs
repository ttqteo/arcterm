// A pinned app's page keeps its storage (localStorage, IndexedDB) across restarts on macOS. The page is a frame from
// another site (http://127.0.0.1:<port>) inside the cockpit's page (tauri://localhost), and two WebKit defaults treat it
// as a tracker: the storage blocking policy BlockThirdPartyStorage gives such a frame storage that lives in memory only,
// and Intelligent Tracking Prevention deletes the storage of a site that has had no first-party user interaction lately,
// which 127.0.0.1 never has here (it is never the top page, and a click in its frame does not count). So an app's dark
// mode and other settings were gone after every restart, while the same app in a browser kept them (2026-10-31).
// AllowAll puts a frame's storage on disk (under the app's own origin, as a top page's would be), and ITP is turned off
// for the webview's data store: the webview frames only 127.0.0.1 (the CSP's frame-src) and sends every other link to
// the browser, so ITP had nothing to protect. Both setters are WebKit's private ones; set on the built webview they hold
// for every frame loaded afterwards, and no app frame loads before wavesrv is up. WebView2 (Chromium) keeps a cross-site
// frame's storage on disk, partitioned by top-level site, and has no such deletion, so Windows needs nothing.

#[cfg(target_os = "macos")]
mod imp {
    use objc2::rc::Retained;
    use objc2::runtime::AnyObject;
    use objc2::{msg_send, sel};
    use tauri::WebviewWindow;

    use crate::applog::log_line;

    // WebKit's _WKStorageBlockingPolicy: AllowAll, BlockThirdParty (the default), BlockAll
    const ALLOW_ALL: isize = 0;

    // Sets the preferences' storage blocking policy to AllowAll and returns the policy read back.
    pub(super) fn allow_frame_storage(prefs: &AnyObject) -> Result<isize, String> {
        // SAFETY: respondsToSelector: is NSObject's; the setter and getter take and give an NSInteger and are sent
        // only where they exist
        unsafe {
            let exists: bool = msg_send![prefs, respondsToSelector: sel!(_setStorageBlockingPolicy:)];
            if !exists {
                return Err("WKPreferences has no _setStorageBlockingPolicy:".to_string());
            }
            let _: () = msg_send![prefs, _setStorageBlockingPolicy: ALLOW_ALL];
            Ok(msg_send![prefs, _storageBlockingPolicy])
        }
    }

    // Turns the data store's tracking prevention (ITP) off and returns whether it is on, read back.
    pub(super) fn stop_tracking_prevention(store: &AnyObject) -> Result<bool, String> {
        // SAFETY: as above, with a BOOL
        unsafe {
            let exists: bool = msg_send![store, respondsToSelector: sel!(_setResourceLoadStatisticsEnabled:)];
            if !exists {
                return Err("WKWebsiteDataStore has no _setResourceLoadStatisticsEnabled:".to_string());
            }
            let _: () = msg_send![store, _setResourceLoadStatisticsEnabled: false];
            Ok(msg_send![store, _resourceLoadStatisticsEnabled])
        }
    }

    pub fn keep_frame_storage(window: &WebviewWindow) {
        let res = window.with_webview(|wv| {
            // SAFETY: wry hands back its live WKWebView*, on the main thread; configuration, preferences and
            // websiteDataStore are WKWebView's and WKWebViewConfiguration's own, and the configuration's copy shares
            // the preferences and data store the view uses
            let (policy, tracking) = unsafe {
                let web = &*(wv.inner() as *const AnyObject);
                let config: Retained<AnyObject> = msg_send![web, configuration];
                let prefs: Retained<AnyObject> = msg_send![&*config, preferences];
                let store: Retained<AnyObject> = msg_send![&*config, websiteDataStore];
                (allow_frame_storage(&prefs), stop_tracking_prevention(&store))
            };
            match (policy, tracking) {
                (Ok(policy), Ok(tracking)) => log_line(&format!(
                    "[tauri] pinned apps keep their storage (storage blocking policy {policy}, tracking prevention {})",
                    if tracking { "on" } else { "off" }
                )),
                (policy, tracking) => {
                    for e in [policy.err(), tracking.err()].into_iter().flatten() {
                        log_line(&format!("[tauri] keeping pinned apps' storage failed: {e}"));
                    }
                }
            }
        });
        if let Err(e) = res {
            log_line(&format!("[tauri] keeping pinned apps' storage failed: {e}"));
        }
    }
}

// Runs from setup, once the main window is built.
pub fn keep_frame_storage(window: &tauri::WebviewWindow) {
    #[cfg(target_os = "macos")]
    imp::keep_frame_storage(window);
    #[cfg(not(target_os = "macos"))]
    let _ = window;
}

// A real WKPreferences or WKWebsiteDataStore cannot be made here: WebKit asserts it is on the main thread when it first
// starts, and the test harness runs every test on a thread of its own. The settings taking effect is a hand check
// (docs/open-issues.md, section 0).
#[cfg(all(test, target_os = "macos"))]
mod tests {
    use objc2::rc::Retained;
    use objc2::runtime::{AnyObject, NSObject};

    use super::imp::{allow_frame_storage, stop_tracking_prevention};

    #[test]
    fn a_webkit_without_the_private_setters_is_reported_not_sent_them() {
        let obj: Retained<AnyObject> = NSObject::new().into();
        assert!(allow_frame_storage(&obj).unwrap_err().contains("_setStorageBlockingPolicy:"));
        assert!(stop_tracking_prevention(&obj).unwrap_err().contains("_setResourceLoadStatisticsEnabled:"));
    }
}
