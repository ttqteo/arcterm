// Stopping a dev app a script started, including when that script is killed before its own cleanup runs.
//
// On windows node puts the processes it spawns into a kill-on-close job with silent breakaway: when node dies, its
// direct child (the dev command's shell) dies with it, and everything that shell started breaks away and keeps
// running with a dead parent, out of reach of `taskkill /T` on the shell. A closed console (an agent's terminal
// going away) kills every console process of the chain, but not wave-tauri, which has no console. So a watchdog,
// a process of its own, waits for the script to die and then stops what the chain left: the shell's children, which it
// was told about when it started, and any process still running the slot's exe. On posix the dev command runs in its
// own process group, which outlives its leader, so killing the group is enough.
//
//   node scripts/cdp/devtree.mjs watch <parent pid> <exe or -> <root pid>...
//
// The user's packaged arcterm shares the dev app's image names, so a process is only ever killed by a PID this script
// was given or by the full path of a slot's own exe, which only a Final's dev app runs.
import { execFileSync, spawn } from "node:child_process";
import { tmpdir } from "node:os";
import { fileURLToPath, pathToFileURL } from "node:url";

const WATCH_POLL_MS = 1_000;

export function killTree(pid) {
    try {
        if (process.platform === "win32") {
            execFileSync("taskkill", ["/PID", String(pid), "/T", "/F"], { stdio: "ignore", windowsHide: true });
        } else {
            process.kill(-pid, "SIGKILL");
        }
    } catch {
        // already gone
    }
}

export function alive(pid) {
    try {
        process.kill(pid, 0);
        return true;
    } catch (e) {
        // EPERM: it runs, under another user
        return e.code === "EPERM";
    }
}

// the PIDs a WMI filter matches, empty when the query fails. windows only
function wmiPids(filter, where = "") {
    try {
        const out = execFileSync(
            "powershell",
            ["-NoProfile", "-NonInteractive", "-Command", `Get-CimInstance Win32_Process -Filter "${filter}" ${where}| ForEach-Object { $_.ProcessId }`],
            { encoding: "utf8", windowsHide: true, stdio: ["ignore", "pipe", "ignore"] }
        );
        return out.split(/\s+/).filter(Boolean).map(Number);
    } catch {
        return [];
    }
}

// the processes pid started. windows only: a posix dev command is a process group
export function childPids(pid) {
    return wmiPids(`ParentProcessId=${Number(pid)}`);
}

// the processes running exe, matched by its full path. windows only
export function exePids(exe) {
    const name = exe.split(/[\\/]/).pop().replace(/'/g, "''");
    return wmiPids(`Name='${name}'`, `| Where-Object { $_.ExecutablePath -eq '${exe.replace(/'/g, "''")}' } `);
}

// the shell spawn() started and, on windows, what it started in turn: the processes a watchdog must stop. The shell's
// child appears a moment after the spawn; waits up to waitMs for it
export async function devRoots(pid, { waitMs = 5_000, platform = process.platform } = {}) {
    if (platform !== "win32") return [pid];
    const deadline = Date.now() + waitMs;
    for (;;) {
        const kids = childPids(pid);
        if (kids.length || Date.now() >= deadline || !alive(pid)) return [pid, ...kids];
        await new Promise((r) => setTimeout(r, 200));
    }
}

// stops each root's tree, then whatever still runs exe (a closed console leaves wave-tauri with every parent gone)
export function stopDevTree(roots, exe) {
    for (const pid of roots) if (alive(pid)) killTree(pid);
    if (exe && process.platform === "win32") for (const pid of exePids(exe)) killTree(pid);
}

// a process of its own that stops the dev app when parentPid dies. Kill it (child.kill()) before stopping the dev app
// yourself, so it never acts on a PID the system has since handed to another process
export function startWatchdog(parentPid, roots, exe) {
    const script = fileURLToPath(import.meta.url);
    const child = spawn(process.execPath, [script, "watch", String(parentPid), exe || "-", ...roots.map(String)], {
        // not the stage's tree: a windows process's cwd keeps its dir from being removed
        cwd: tmpdir(),
        detached: true,
        stdio: "ignore",
        windowsHide: true,
    });
    child.unref();
    return child;
}

async function watch(parentPid, exe, roots) {
    while (alive(parentPid)) {
        await new Promise((r) => setTimeout(r, WATCH_POLL_MS));
    }
    stopDevTree(roots, exe === "-" ? undefined : exe);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href && process.argv[2] === "watch") {
    const [parent, exe, ...roots] = process.argv.slice(3);
    await watch(Number(parent), exe, roots.map(Number));
}
