// Clearing the webview's cache at launch. Its files are in use while arcterm runs, so Settings → Storage
// (pkg/storage, CacheMarkerName) only leaves a marker in the data dir; main() calls this before the Tauri builder
// creates the window, and it removes the cache dirs and then the marker.
use crate::paths::{self, Os};
use std::ffi::OsString;
use std::path::{Path, PathBuf};

/// The file pkg/storage writes in the data dir to ask for a clear.
pub const MARKER_NAME: &str = "clear-webview-cache";

/// When `<data_home>/clear-webview-cache` exists, removes every dir in `cache_dirs` (a missing one is fine) and
/// then the marker. Returns whether it ran. On an error the marker stays, so the next launch tries again.
pub fn clear_if_marked(data_home: &Path, cache_dirs: &[PathBuf]) -> std::io::Result<bool> {
    let marker = data_home.join(MARKER_NAME);
    if !marker.exists() {
        return Ok(false);
    }
    for dir in cache_dirs {
        match std::fs::remove_dir_all(dir) {
            Ok(()) => {}
            Err(e) if e.kind() == std::io::ErrorKind::NotFound => {}
            Err(e) => return Err(e),
        }
    }
    std::fs::remove_file(&marker)?;
    Ok(true)
}

/// The webview's cache dirs on `os`, the same pkg/storage.WebviewCacheDirs lists: WebKit's under
/// ~/Library/Caches/<identifier>/WebKit on macOS, WebView2's under <app base>/EBWebView/Default on Windows.
pub fn cache_dirs_on(os: Os, identifier: &str, home: &Path, app_base: &Path) -> Vec<PathBuf> {
    match os {
        Os::MacOs => {
            let wk = home.join("Library").join("Caches").join(identifier).join("WebKit");
            vec![wk.join("NetworkCache"), wk.join("CacheStorage")]
        }
        Os::Windows => {
            let d = app_base.join("EBWebView").join("Default");
            vec![d.join("Cache"), d.join("Code Cache"), d.join("GPUCache")]
        }
        Os::Other => Vec::new(),
    }
}

#[cfg(test)]
pub fn cache_dirs(identifier: &str, home: &Path, app_base: &Path) -> Vec<PathBuf> {
    cache_dirs_on(Os::current(), identifier, home, app_base)
}

/// Where a launch looks for the marker and what it clears.
#[derive(Debug, PartialEq, Eq)]
pub struct LaunchTargets {
    pub data_home: PathBuf,
    pub cache_dirs: Vec<PathBuf>,
}

/// Resolves, before the Tauri builder exists, the data dir the marker sits in and the cache dirs to clear for a
/// launch on `os`. None when this launch must not clear: an unknown OS, a missing home or LOCALAPPDATA, or a macOS
/// debug build — dev and packaged share ~/Library/Caches/<identifier>/WebKit there, so a dev launch must never
/// clear a cache the packaged app may be using.
pub fn launch_targets(
    os: Os,
    identifier: &str,
    home: Option<&Path>,
    local_app_data: Option<&Path>,
    is_dev: bool,
    dev_data_override: Option<OsString>,
) -> Option<LaunchTargets> {
    if os == Os::MacOs && is_dev {
        return None;
    }
    let app_local = paths::app_local_data_dir_on(os, identifier, home, local_app_data)?;
    let base = paths::dev_data_base(paths::data_base_for(&app_local, is_dev), is_dev, dev_data_override);
    let dirs = cache_dirs_on(os, identifier, home.unwrap_or(Path::new("")), &base);
    Some(LaunchTargets {
        data_home: paths::data_home_dirs(&base).0,
        cache_dirs: dirs,
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;

    fn temp_dir(name: &str) -> PathBuf {
        let dir = std::env::temp_dir().join(format!("arc-webcache-{}-{}", name, std::process::id()));
        let _ = fs::remove_dir_all(&dir);
        fs::create_dir_all(&dir).unwrap();
        dir
    }

    #[test]
    fn a_marker_clears_the_cache_dirs_and_itself() {
        let dir = temp_dir("marked");
        let data = dir.join("data");
        let cache = dir.join("cache").join("NetworkCache");
        fs::create_dir_all(&data).unwrap();
        fs::create_dir_all(&cache).unwrap();
        fs::write(cache.join("blob"), b"x").unwrap();
        fs::write(data.join(MARKER_NAME), b"2026-10-08T00:00:00Z").unwrap();
        let missing = dir.join("cache").join("CacheStorage");
        assert!(clear_if_marked(&data, &[cache.clone(), missing]).unwrap());
        assert!(!cache.exists());
        assert!(!data.join(MARKER_NAME).exists());
    }

    #[test]
    fn no_marker_leaves_the_cache_alone() {
        let dir = temp_dir("unmarked");
        let data = dir.join("data");
        let cache = dir.join("cache");
        fs::create_dir_all(&data).unwrap();
        fs::create_dir_all(&cache).unwrap();
        assert!(!clear_if_marked(&data, &[cache.clone()]).unwrap());
        assert!(cache.exists());
    }

    #[test]
    fn cache_dirs_match_the_go_side() {
        let dirs = cache_dirs("dev.arc.app", Path::new("/Users/me"), Path::new("/base"));
        if cfg!(target_os = "macos") {
            let wk = Path::new("/Users/me").join("Library").join("Caches").join("dev.arc.app").join("WebKit");
            assert_eq!(dirs, vec![wk.join("NetworkCache"), wk.join("CacheStorage")]);
        } else if cfg!(windows) {
            let d = Path::new("/base").join("EBWebView").join("Default");
            assert_eq!(dirs, vec![d.join("Cache"), d.join("Code Cache"), d.join("GPUCache")]);
        } else {
            assert!(dirs.is_empty());
        }
    }

    const ID: &str = "dev.arc.app";

    #[test]
    fn a_packaged_macos_launch_clears_webkits_caches() {
        let got = launch_targets(Os::MacOs, ID, Some(Path::new("/Users/me")), None, false, None).unwrap();
        let support = Path::new("/Users/me").join("Library").join("Application Support").join(ID);
        let wk = Path::new("/Users/me").join("Library").join("Caches").join(ID).join("WebKit");
        assert_eq!(got.data_home, support.join("data"));
        assert_eq!(got.cache_dirs, vec![wk.join("NetworkCache"), wk.join("CacheStorage")]);
    }

    #[test]
    fn a_packaged_macos_launch_ignores_the_dev_override() {
        let got = launch_targets(Os::MacOs, ID, Some(Path::new("/Users/me")), None, false, Some(OsString::from("/elsewhere"))).unwrap();
        assert_eq!(got.data_home, Path::new("/Users/me").join("Library").join("Application Support").join(ID).join("data"));
    }

    #[test]
    fn a_macos_debug_build_never_clears() {
        let home = Some(Path::new("/Users/me"));
        assert_eq!(launch_targets(Os::MacOs, ID, home, None, true, None), None);
        assert_eq!(launch_targets(Os::MacOs, ID, home, None, true, Some(OsString::from("/final/data"))), None);
    }

    #[test]
    fn a_dev_windows_launch_uses_the_dev_base() {
        let local = Path::new("C:/u/AppData/Local");
        let got = launch_targets(Os::Windows, ID, None, Some(local), true, None).unwrap();
        let base = local.join(format!("{ID}-dev"));
        let d = base.join("EBWebView").join("Default");
        assert_eq!(got.data_home, base.join("data"));
        assert_eq!(got.cache_dirs, vec![d.join("Cache"), d.join("Code Cache"), d.join("GPUCache")]);
    }

    #[test]
    fn a_dev_windows_launch_takes_the_override() {
        let local = Path::new("C:/u/AppData/Local");
        let got = launch_targets(Os::Windows, ID, None, Some(local), true, Some(OsString::from("C:/final/arc-data"))).unwrap();
        let base = Path::new("C:/final/arc-data");
        let d = base.join("EBWebView").join("Default");
        assert_eq!(got.data_home, base.join("data"));
        assert_eq!(got.cache_dirs, vec![d.join("Cache"), d.join("Code Cache"), d.join("GPUCache")]);
    }

    #[test]
    fn a_packaged_windows_launch_uses_the_plain_base() {
        let local = Path::new("C:/u/AppData/Local");
        let got = launch_targets(Os::Windows, ID, None, Some(local), false, Some(OsString::from("C:/ignored"))).unwrap();
        let base = local.join(ID);
        assert_eq!(got.data_home, base.join("data"));
        assert_eq!(got.cache_dirs[0], base.join("EBWebView").join("Default").join("Cache"));
    }

    #[test]
    fn a_launch_with_no_home_or_another_os_clears_nothing() {
        assert_eq!(launch_targets(Os::MacOs, ID, None, None, false, None), None);
        assert_eq!(launch_targets(Os::Windows, ID, None, None, false, None), None);
        assert_eq!(launch_targets(Os::Other, ID, Some(Path::new("/home/me")), None, false, None), None);
    }
}
