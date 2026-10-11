use std::ffi::OsString;
use std::path::{Path, PathBuf};

// WAVETERM_APP_PATH: the dir whose `bin/` subdir holds the bundled wavesrv + wsh
// (wavebase.GetWaveAppBinPath = WAVETERM_APP_PATH + "/bin"). Dev keeps the spike's
// source-tree path; packaged uses Tauri's resource dir.
pub fn resolve_app_path(is_dev: bool, manifest_dir: &Path, resource_dir: &Path) -> PathBuf {
    if is_dev {
        manifest_dir.join("..").join("dist")
    } else {
        resource_dir.to_path_buf()
    }
}

// dev and packaged builds share one bundle identifier, so app_local_data_dir() resolves
// to the same %LOCALAPPDATA%/<id> for both. Without separation a running dev instance and
// an installed build fight over the same SQLite store + wave.lock (the dev wavesrv wins the
// lock and the packaged one blocks forever). Suffix the dev base to isolate them — this is
// the waveterm-dev split the Electron build had and the Tauri port dropped.
pub fn data_base_for(base: &Path, is_dev: bool) -> PathBuf {
    if !is_dev {
        return base.to_path_buf();
    }
    let name = base.file_name().and_then(|s| s.to_str()).unwrap_or("app");
    base.with_file_name(format!("{name}-dev"))
}

// a debug build started beside another dev app (the orchestrator's final stage) is pointed at its own store
// through this, since two wavesrv on one data dir fight over its wave.lock. packaged builds ignore it.
pub const DEV_DATA_DIR_ENV: &str = "ARC_DEV_DATA_DIR";

// a debug build with this set leaves the user's global agent hooks alone: install-agent-hooks copies the
// launching wsh to ~/.arc/bin, which every hook runs.
pub const DEV_NO_GLOBAL_INSTALL_ENV: &str = "ARC_DEV_NO_GLOBAL_INSTALL";

pub fn dev_data_base(default: PathBuf, is_dev: bool, override_dir: Option<OsString>) -> PathBuf {
    match override_dir {
        Some(dir) if is_dev && !dir.is_empty() => PathBuf::from(dir),
        _ => default,
    }
}

// wavesrv hard-requires both WAVETERM_DATA_HOME and WAVETERM_CONFIG_HOME; split the
// per-user base dir into those two homes.
pub fn data_home_dirs(base: &Path) -> (PathBuf, PathBuf) {
    (base.join("data"), base.join("config"))
}

// The OS a path rule is for. Rules take it as an argument so one test machine covers every OS; `Os::current()` is
// the one the app was compiled for.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Os {
    Windows,
    MacOs,
    Other,
}

impl Os {
    pub fn current() -> Os {
        if cfg!(windows) {
            Os::Windows
        } else if cfg!(target_os = "macos") {
            Os::MacOs
        } else {
            Os::Other
        }
    }
}

// Tauri's app_local_data_dir for `identifier`, for code that runs before the app exists (main, before the
// builder): %LOCALAPPDATA%\<identifier> on Windows, ~/Library/Application Support/<identifier> on macOS.
pub fn app_local_data_dir_on(os: Os, identifier: &str, home: Option<&Path>, local_app_data: Option<&Path>) -> Option<PathBuf> {
    match os {
        Os::Windows => local_app_data.map(|d| d.join(identifier)),
        Os::MacOs => home.map(|h| h.join("Library").join("Application Support").join(identifier)),
        Os::Other => None,
    }
}

#[cfg(test)]
pub fn app_local_data_dir_for(identifier: &str, home: Option<&Path>, local_app_data: Option<&Path>) -> Option<PathBuf> {
    app_local_data_dir_on(Os::current(), identifier, home, local_app_data)
}

// Dev-only WebView2 profile dir. app_local_data_dir is %LOCALAPPDATA%/<identifier>; Tauri would
// otherwise default the WebView2 profile to <that>/EBWebView, which a co-installed packaged build
// (same identifier) also uses. WebView2 runs one browser process per profile, so a dev launch
// opening a profile the running packaged app holds destabilizes it — killing the packaged window
// and, via our RunEvent::Exit handler, its wavesrv. Isolate dev onto the same -dev base the data
// store already uses so the two never share a WebView2 browser process.
#[cfg(any(debug_assertions, test))]
pub fn dev_webview_data_dir(app_local_data_dir: &Path) -> PathBuf {
    data_base_for(app_local_data_dir, true).join("EBWebView")
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn dev_uses_source_tree_dist() {
        let got = resolve_app_path(true, Path::new("C:/proj/src-tauri"), Path::new("C:/ignored"));
        assert_eq!(got, Path::new("C:/proj/src-tauri").join("..").join("dist"));
    }

    #[test]
    fn packaged_uses_resource_dir() {
        let got = resolve_app_path(false, Path::new("C:/ignored"), Path::new("C:/app/res"));
        assert_eq!(got, PathBuf::from("C:/app/res"));
    }

    #[test]
    fn packaged_data_base_is_unchanged() {
        let base = Path::new("C:/u/AppData/Local/dev.arc.app");
        assert_eq!(data_base_for(base, false), base.to_path_buf());
    }

    #[test]
    fn dev_data_base_is_suffixed_to_isolate_from_packaged() {
        let base = Path::new("C:/u/AppData/Local/dev.arc.app");
        assert_eq!(
            data_base_for(base, true),
            PathBuf::from("C:/u/AppData/Local/dev.arc.app-dev")
        );
    }

    #[test]
    fn dev_data_base_takes_the_override() {
        let got = dev_data_base(
            PathBuf::from("C:/default"),
            true,
            Some(OsString::from("C:/final/arc-data")),
        );
        assert_eq!(got, PathBuf::from("C:/final/arc-data"));
    }

    #[test]
    fn packaged_data_base_ignores_the_override() {
        let got = dev_data_base(
            PathBuf::from("C:/default"),
            false,
            Some(OsString::from("C:/final/arc-data")),
        );
        assert_eq!(got, PathBuf::from("C:/default"));
    }

    #[test]
    fn empty_override_keeps_the_default() {
        let default = PathBuf::from("C:/default");
        assert_eq!(
            dev_data_base(default.clone(), true, Some(OsString::new())),
            default
        );
        assert_eq!(dev_data_base(default.clone(), true, None), default);
    }

    #[test]
    fn dev_webview_profile_is_isolated_under_dev_base() {
        let base = Path::new("C:/u/AppData/Local/dev.arc.app");
        assert_eq!(
            dev_webview_data_dir(base),
            PathBuf::from("C:/u/AppData/Local/dev.arc.app-dev/EBWebView")
        );
    }

    #[test]
    fn app_local_data_dir_matches_tauris() {
        let got = app_local_data_dir_for("dev.arc.app", Some(Path::new("/Users/me")), Some(Path::new("C:/u/AppData/Local")));
        if cfg!(windows) {
            assert_eq!(got, Some(Path::new("C:/u/AppData/Local").join("dev.arc.app")));
        } else if cfg!(target_os = "macos") {
            assert_eq!(got, Some(Path::new("/Users/me").join("Library").join("Application Support").join("dev.arc.app")));
        } else {
            assert_eq!(got, None);
        }
    }

    #[test]
    fn app_local_data_dir_on_each_os() {
        let home = Some(Path::new("/Users/me"));
        let local = Some(Path::new("C:/u/AppData/Local"));
        assert_eq!(
            app_local_data_dir_on(Os::Windows, "dev.arc.app", home, local),
            Some(Path::new("C:/u/AppData/Local").join("dev.arc.app"))
        );
        assert_eq!(
            app_local_data_dir_on(Os::MacOs, "dev.arc.app", home, local),
            Some(Path::new("/Users/me").join("Library").join("Application Support").join("dev.arc.app"))
        );
        assert_eq!(app_local_data_dir_on(Os::Other, "dev.arc.app", home, local), None);
        assert_eq!(app_local_data_dir_on(Os::MacOs, "dev.arc.app", None, local), None);
        assert_eq!(app_local_data_dir_on(Os::Windows, "dev.arc.app", home, None), None);
    }

    #[test]
    fn data_home_splits_into_data_and_config() {
        let base = Path::new("C:/u/AppData/Local/dev.waveterm.tauri");
        let (data, config) = data_home_dirs(base);
        assert_eq!(data, base.join("data"));
        assert_eq!(config, base.join("config"));
    }
}
