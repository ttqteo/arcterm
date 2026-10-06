// A macOS app opened from Finder or the Dock inherits launchd's PATH (/usr/bin:/bin:/usr/sbin:/sbin),
// not the one the user's shell profile builds, so wavesrv and every agent it starts would miss
// Homebrew, nvm, ~/.local/bin… and `claude` exits 127. Ask the user's login shell for its PATH once
// at launch, while the window is being built, and hand it to the children we spawn.

const MARKER: &str = "__ARC_PATH__";

// Runs on its own thread from the top of main; setup joins it just before spawning wavesrv.
pub struct PathProbe(Option<std::thread::JoinHandle<Option<String>>>);

impl PathProbe {
    pub fn start() -> Self {
        if cfg!(target_os = "macos") {
            PathProbe(Some(std::thread::spawn(probe_login_path)))
        } else {
            PathProbe(None)
        }
    }

    // The PATH to give child processes, or None to let them inherit ours.
    pub fn finish(self) -> Option<String> {
        let login = self.0?.join().ok()??;
        Some(merge_path(
            &login,
            &std::env::var("PATH").unwrap_or_default(),
        ))
    }
}

// -i as well as -l: nvm and similar add to PATH from .zshrc / .bashrc, which only interactive shells
// read. Bounded, so a startup file that hangs costs the launch a few seconds, not the backend.
fn probe_login_path() -> Option<String> {
    use std::io::Read;
    use std::process::{Command, Stdio};
    use std::time::Duration;

    let shell = std::env::var("SHELL")
        .ok()
        .filter(|s| !s.is_empty())
        .unwrap_or_else(|| "/bin/zsh".into());
    let mut child = Command::new(&shell)
        .args([
            "-l",
            "-i",
            "-c",
            &format!("echo {MARKER}; /usr/bin/printenv PATH"),
        ])
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::null())
        .spawn()
        .ok()?;
    let mut stdout = child.stdout.take()?;
    let (tx, rx) = std::sync::mpsc::channel();
    std::thread::spawn(move || {
        let mut out = String::new();
        let _ = stdout.read_to_string(&mut out);
        let _ = tx.send(out);
    });
    let out = rx.recv_timeout(Duration::from_secs(5));
    if out.is_err() {
        let _ = child.kill();
    }
    let _ = child.wait();
    parse_probe_output(&out.ok()?)
}

// The probe's stdout carries whatever the shell's startup files print; PATH is the line after MARKER.
pub fn parse_probe_output(out: &str) -> Option<String> {
    let mut lines = out.lines().map(str::trim);
    lines.find(|l| *l == MARKER)?;
    lines.next().filter(|l| !l.is_empty()).map(str::to_string)
}

// The login shell's entries first, then anything the launcher added that the shell did not, each once.
pub fn merge_path(login: &str, inherited: &str) -> String {
    let mut seen = std::collections::HashSet::new();
    login
        .split(':')
        .chain(inherited.split(':'))
        .filter(|e| !e.is_empty() && seen.insert(*e))
        .collect::<Vec<_>>()
        .join(":")
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn takes_the_line_after_the_marker() {
        let out = "Last login: Mon\nwelcome banner\n__ARC_PATH__\n/opt/homebrew/bin:/usr/bin\n";
        assert_eq!(
            parse_probe_output(out).as_deref(),
            Some("/opt/homebrew/bin:/usr/bin")
        );
    }

    #[test]
    fn rejects_output_without_a_marker_or_a_path() {
        assert_eq!(
            parse_probe_output("zsh: command not found: printenv\n"),
            None
        );
        assert_eq!(parse_probe_output("__ARC_PATH__\n"), None);
        assert_eq!(parse_probe_output("__ARC_PATH__\n\n"), None);
    }

    #[test]
    fn tolerates_crlf_and_surrounding_spaces() {
        assert_eq!(
            parse_probe_output("__ARC_PATH__\r\n /usr/bin:/bin \r\n").as_deref(),
            Some("/usr/bin:/bin")
        );
    }

    #[test]
    fn login_entries_lead_and_inherited_extras_follow() {
        let got = merge_path(
            "/opt/homebrew/bin:/usr/bin:/bin",
            "/usr/bin:/bin:/usr/sbin:/sbin",
        );
        assert_eq!(got, "/opt/homebrew/bin:/usr/bin:/bin:/usr/sbin:/sbin");
    }

    #[test]
    fn drops_duplicates_and_empty_entries() {
        let got = merge_path("/a:/b:/a::/c", "/c:/d:");
        assert_eq!(got, "/a:/b:/c:/d");
    }
}
