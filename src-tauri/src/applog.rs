// Persistent host log at {data}/waveapp.log. The Electron shell wrote this file and wavesrv still
// assumes it: it logs without timestamps (the wrapper adds them) and `wsh path log` points here.
// Without it, a packaged (no-console) launch's output — wavesrv stderr, panics, fe-log — is lost.
use std::fs::{File, OpenOptions};
use std::io::Write;
use std::path::{Path, PathBuf};
use std::sync::{Mutex, OnceLock};

const LOG_FILE_NAME: &str = "waveapp.log";
const ROTATED_FILE_NAME: &str = "waveapp.1.log";
// rotated during writes, not only at launch: a wavesrv panic loop emits ~20 stack traces a second,
// so a launch-only check lets one session grow without bound. Disk use stays under 2x this.
const MAX_LOG_BYTES: u64 = 10 * 1024 * 1024;

struct RotatingLog {
    path: PathBuf,
    rotated_path: PathBuf,
    max_bytes: u64,
    file: Option<File>,
    size: u64,
}

impl RotatingLog {
    fn open(dir: &Path, max_bytes: u64) -> std::io::Result<Self> {
        std::fs::create_dir_all(dir)?;
        let path = dir.join(LOG_FILE_NAME);
        let file = OpenOptions::new().create(true).append(true).open(&path)?;
        let size = file.metadata()?.len();
        Ok(Self {
            path,
            rotated_path: dir.join(ROTATED_FILE_NAME),
            max_bytes,
            file: Some(file),
            size,
        })
    }

    fn write_line(&mut self, line: &str) -> std::io::Result<()> {
        let entry = format!("{} {}\n", timestamp(), line);
        if self.size > 0 && self.size + entry.len() as u64 > self.max_bytes {
            self.rotate()?;
        }
        let file = self.file.as_mut().ok_or_else(|| std::io::Error::other("log file not open"))?;
        file.write_all(entry.as_bytes())?;
        self.size += entry.len() as u64;
        Ok(())
    }

    fn rotate(&mut self) -> std::io::Result<()> {
        // windows cannot rename a file this process holds open, so drop the handle first
        self.file = None;
        std::fs::rename(&self.path, &self.rotated_path)?;
        self.file = Some(OpenOptions::new().create(true).append(true).open(&self.path)?);
        self.size = 0;
        Ok(())
    }
}

fn timestamp() -> String {
    chrono::Local::now().format("%Y-%m-%d %H:%M:%S%.3f").to_string()
}

static LOG: OnceLock<Mutex<RotatingLog>> = OnceLock::new();

// Opens the log under the wavesrv data dir. Lines logged before init reach only the console.
pub fn init(data_home: &Path) {
    match RotatingLog::open(data_home, MAX_LOG_BYTES) {
        Ok(log) => {
            let path = log.path.clone();
            let _ = LOG.set(Mutex::new(log));
            log_line(&format!("[tauri] logging to {:?}", path));
        }
        Err(e) => eprintln!("[tauri] cannot open log in {:?}: {}", data_home, e),
    }
}

pub fn log_line(line: &str) {
    println!("{}", line);
    let Some(log) = LOG.get() else { return };
    let mut log = log.lock().unwrap_or_else(|poisoned| poisoned.into_inner());
    if let Err(e) = log.write_line(line) {
        eprintln!("[tauri] log write to {:?} failed: {}", log.path, e);
    }
}

// A panic inside an AppKit callback cannot unwind out of it (tao's sendEvent: is extern "C"), so the process aborts and
// macOS's crash report keeps only "abort() called": the message and the frames that panicked went to stderr, which a
// packaged launch discards. This writes them to the log first, then runs the default hook.
pub fn install_panic_hook() {
    let default_hook = std::panic::take_hook();
    std::panic::set_hook(Box::new(move |info| {
        let thread = std::thread::current();
        let lines = panic_lines(
            thread.name().unwrap_or("<unnamed>"),
            panic_message(info.payload()),
            info.location().map(|l| l.to_string()).as_deref(),
            &std::backtrace::Backtrace::force_capture().to_string(),
        );
        write_panic(&lines);
        default_hook(info);
    }));
}

fn panic_message(payload: &(dyn std::any::Any + Send)) -> &str {
    if let Some(s) = payload.downcast_ref::<&str>() {
        s
    } else if let Some(s) = payload.downcast_ref::<String>() {
        s
    } else {
        "<non-string panic payload>"
    }
}

fn panic_lines(thread: &str, message: &str, location: Option<&str>, backtrace: &str) -> Vec<String> {
    let mut lines = vec![format!(
        "[tauri] panic in thread '{}' at {}: {}",
        thread,
        location.unwrap_or("<unknown>"),
        message
    )];
    lines.extend(backtrace.lines().map(|l| format!("[tauri]   {}", l)));
    lines
}

fn write_panic(lines: &[String]) {
    let Some(log) = LOG.get() else { return };
    // never block: the panic may have come from inside write_line on this thread, which holds the lock, so wait only a
    // moment for another thread's write to finish
    for _ in 0..40 {
        let mut log = match log.try_lock() {
            Ok(log) => log,
            Err(std::sync::TryLockError::Poisoned(poisoned)) => poisoned.into_inner(),
            Err(std::sync::TryLockError::WouldBlock) => {
                std::thread::sleep(std::time::Duration::from_millis(5));
                continue;
            }
        };
        for line in lines {
            let _ = log.write_line(line);
        }
        return;
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;

    fn temp_dir(name: &str) -> PathBuf {
        let dir = std::env::temp_dir().join(format!("arc-applog-{}-{}", name, std::process::id()));
        let _ = fs::remove_dir_all(&dir);
        dir
    }

    #[test]
    fn appends_timestamped_lines_across_reopen() {
        let dir = temp_dir("append");
        RotatingLog::open(&dir, 1024).unwrap().write_line("first").unwrap();
        RotatingLog::open(&dir, 1024).unwrap().write_line("second").unwrap();

        let text = fs::read_to_string(dir.join(LOG_FILE_NAME)).unwrap();
        let lines: Vec<&str> = text.lines().collect();
        assert_eq!(lines.len(), 2);
        assert!(lines[0].ends_with(" first"), "got {:?}", lines[0]);
        assert!(lines[1].ends_with(" second"), "got {:?}", lines[1]);
        // "YYYY-MM-DD HH:MM:SS.mmm " prefix
        assert_eq!(lines[0].as_bytes()[4], b'-');
        assert_eq!(lines[0].as_bytes()[23], b' ');
        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn rotates_when_the_next_line_would_exceed_the_cap() {
        let dir = temp_dir("rotate");
        let mut log = RotatingLog::open(&dir, 100).unwrap();
        log.write_line("old-1").unwrap();
        log.write_line("old-2").unwrap();
        log.write_line(&"x".repeat(60)).unwrap();

        let current = fs::read_to_string(dir.join(LOG_FILE_NAME)).unwrap();
        let rotated = fs::read_to_string(dir.join(ROTATED_FILE_NAME)).unwrap();
        assert!(rotated.contains("old-1") && rotated.contains("old-2"));
        assert!(current.contains(&"x".repeat(60)) && !current.contains("old-1"));
        assert!(current.len() as u64 <= 100 && rotated.len() as u64 <= 100);
        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn a_second_rotation_replaces_the_previous_backup() {
        let dir = temp_dir("rerotate");
        let mut log = RotatingLog::open(&dir, 60).unwrap();
        for tag in ["gen-a", "gen-b", "gen-c"] {
            log.write_line(&format!("{}{}", tag, "-".repeat(20))).unwrap();
        }

        let rotated = fs::read_to_string(dir.join(ROTATED_FILE_NAME)).unwrap();
        assert!(rotated.contains("gen-b") && !rotated.contains("gen-a"));
        assert!(fs::read_to_string(dir.join(LOG_FILE_NAME)).unwrap().contains("gen-c"));
        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn a_panic_names_its_thread_place_and_message_then_its_frames() {
        let lines = panic_lines(
            "main",
            "already borrowed: BorrowMutError",
            Some("src/lib.rs:12:5"),
            "   0: tao::send_event\n   1: main",
        );
        assert_eq!(
            lines,
            vec![
                "[tauri] panic in thread 'main' at src/lib.rs:12:5: already borrowed: BorrowMutError",
                "[tauri]      0: tao::send_event",
                "[tauri]      1: main",
            ]
        );
    }

    #[test]
    fn reads_str_and_string_panic_payloads() {
        let payload = std::panic::catch_unwind(|| panic!("static text")).unwrap_err();
        assert_eq!(panic_message(payload.as_ref()), "static text");
        let payload = std::panic::catch_unwind(|| panic!("formatted {}", 7)).unwrap_err();
        assert_eq!(panic_message(payload.as_ref()), "formatted 7");
        let payload = std::panic::catch_unwind(|| std::panic::panic_any(7u8)).unwrap_err();
        assert_eq!(panic_message(payload.as_ref()), "<non-string panic payload>");
    }

    #[test]
    fn a_single_oversized_line_is_still_written() {
        let dir = temp_dir("oversized");
        let mut log = RotatingLog::open(&dir, 10).unwrap();
        log.write_line("a line longer than the cap").unwrap();
        let text = fs::read_to_string(dir.join(LOG_FILE_NAME)).unwrap();
        assert!(text.contains("a line longer than the cap"));
        assert!(!dir.join(ROTATED_FILE_NAME).exists());
        let _ = fs::remove_dir_all(&dir);
    }
}
