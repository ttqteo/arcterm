// Keeping a desktop app an agent started alive when arcterm quits. wavesrv runs in the host's kill-on-close job
// (assign_kill_on_close_job), and so does everything under it: a Docker Desktop an agent started is a member, and every
// quit (the window closing, an install force-stopping arcterm) took it down. While the job holds a kept app, it stops
// killing on close: wavesrv still ends with the host, on its stdin closing, and its shutdown reaps its blocks' trees
// except the kept app (pkg/util/jobobject WatchKeptApps and KillKeptJobs, which keep the same list).

use std::sync::atomic::{AtomicBool, Ordering};
use windows_sys::Win32::Foundation::{CloseHandle, HANDLE};
use windows_sys::Win32::System::JobObjects::{
    JobObjectBasicProcessIdList, JobObjectExtendedLimitInformation, QueryInformationJobObject,
    SetInformationJobObject, JOBOBJECT_EXTENDED_LIMIT_INFORMATION, JOB_OBJECT_LIMIT_BREAKAWAY_OK,
    JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE,
};
use windows_sys::Win32::System::Threading::{
    OpenProcess, QueryFullProcessImageNameW, PROCESS_NAME_WIN32, PROCESS_QUERY_LIMITED_INFORMATION,
};

// lower-case image names, as keepImages in pkg/util/jobobject/keep.go
pub const KEPT_IMAGES: &[&str] = &["docker desktop.exe"];

// how often the watch looks, as keepWatchInterval in pkg/util/jobobject
const WATCH_INTERVAL: std::time::Duration = std::time::Duration::from_secs(10);

// true while the host job holds a kept app and so no longer kills on close
pub static HOST_JOB_KEEPING: AtomicBool = AtomicBool::new(false);

// the pids in job; empty when the query fails
fn members(job: isize) -> Vec<u32> {
    // JOBOBJECT_BASIC_PROCESS_ID_LIST: two u32 counts, then the ids as usize
    let mut cap = 64usize;
    loop {
        let mut buf = vec![0usize; 1 + cap];
        let ok = unsafe {
            QueryInformationJobObject(
                job as HANDLE,
                JobObjectBasicProcessIdList,
                buf.as_mut_ptr() as *mut _,
                (buf.len() * std::mem::size_of::<usize>()) as u32,
                std::ptr::null_mut(),
            )
        };
        let assigned = (buf[0] & 0xffff_ffff) as usize;
        let listed = ((buf[0] as u64) >> 32) as usize;
        if ok != 0 && listed >= assigned {
            return buf[1..1 + listed].iter().map(|&p| p as u32).collect();
        }
        if assigned <= cap && ok == 0 {
            return Vec::new();
        }
        cap = assigned.max(cap * 2) + 16;
    }
}

// the lower-case base name of pid's image; None when it cannot be opened (gone, or not ours to read)
fn image_name(pid: u32) -> Option<String> {
    unsafe {
        let h = OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION, 0, pid);
        if h.is_null() {
            return None;
        }
        let mut buf = [0u16; 1024];
        let mut len = buf.len() as u32;
        let ok = QueryFullProcessImageNameW(h, PROCESS_NAME_WIN32, buf.as_mut_ptr(), &mut len);
        CloseHandle(h);
        if ok == 0 {
            return None;
        }
        let path = String::from_utf16_lossy(&buf[..len as usize]);
        Some(path.rsplit('\\').next().unwrap_or(&path).to_lowercase())
    }
}

fn holds_kept_app(job: isize, kept: &[&str]) -> bool {
    members(job)
        .into_iter()
        .any(|pid| image_name(pid).is_some_and(|name| kept.contains(&name.as_str())))
}

fn set_kill_on_close(job: isize, on: bool) -> bool {
    let mut info: JOBOBJECT_EXTENDED_LIMIT_INFORMATION = unsafe { std::mem::zeroed() };
    info.BasicLimitInformation.LimitFlags = if on {
        JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE | JOB_OBJECT_LIMIT_BREAKAWAY_OK
    } else {
        JOB_OBJECT_LIMIT_BREAKAWAY_OK
    };
    let size = std::mem::size_of::<JOBOBJECT_EXTENDED_LIMIT_INFORMATION>() as u32;
    unsafe {
        SetInformationJobObject(
            job as HANDLE,
            JobObjectExtendedLimitInformation,
            &info as *const _ as *const _,
            size,
        ) != 0
    }
}

// Sets the job's kill-on-close from whether it holds a kept app, recording the state in keeping; returns whether it
// holds one.
pub fn refresh(job: isize, kept: &[&str], keeping: &AtomicBool) -> bool {
    let holds = holds_kept_app(job, kept);
    if holds != keeping.load(Ordering::Relaxed) && set_kill_on_close(job, !holds) {
        keeping.store(holds, Ordering::Relaxed);
        crate::applog::log_line(&format!(
            "[tauri] host job holds a kept app: {holds}, kill-on-close {}",
            !holds
        ));
    }
    holds
}

// Watches the host job for the app's life.
pub fn watch(job: isize) {
    std::thread::spawn(move || loop {
        refresh(job, KEPT_IMAGES, &HOST_JOB_KEEPING);
        std::thread::sleep(WATCH_INTERVAL);
    });
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::process::{Command, Stdio};
    use std::time::Duration;

    // A job holding a kept app (ping stands in for Docker Desktop) stops killing on close, so the app outlives the
    // last handle; with no kept app it stays armed.
    #[test]
    fn a_kept_app_outlives_the_job() {
        let mut app = Command::new("ping")
            .args(["-n", "30", "127.0.0.1"])
            .stdout(Stdio::null())
            .stderr(Stdio::null())
            .spawn()
            .expect("spawn ping");
        let job = crate::assign_kill_on_close_job(&app)
            .expect("assign to job")
            .0;
        let keeping = AtomicBool::new(false);

        assert!(
            !refresh(job, &["nothing.exe"], &keeping),
            "no kept app, yet one was found"
        );
        assert!(!keeping.load(Ordering::Relaxed));
        assert!(
            refresh(job, &["ping.exe"], &keeping),
            "the kept app was not found in the job"
        );
        assert!(keeping.load(Ordering::Relaxed));

        unsafe { CloseHandle(job as HANDLE) };
        std::thread::sleep(Duration::from_millis(500));
        let alive = app.try_wait().unwrap().is_none();
        let _ = app.kill();
        let _ = app.wait();
        assert!(alive, "the kept app died with the job's last handle");
    }
}
