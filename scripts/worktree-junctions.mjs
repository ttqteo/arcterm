// Junction helpers for git worktrees on Windows. `prepare` shares the heavy build-artifact
// directories (node_modules, src-tauri/target, dist/bin) from the main checkout into the current
// worktree so `task dev` boots there in ~1 min instead of a cold npm+cargo install. `cleanup`
// removes those junction links BEFORE the worktree directory goes — a recursive delete can follow
// a junction and wipe the main checkout's copy through the link, so junction-first ordering is the
// whole point. Only junction links are ever removed; a real directory is left alone with a warning.
// `is-linked <dir>` exits 0 when dir is such a link, so `npm:install` leaves a junctioned node_modules alone:
// npm install there replaces the link with a full install of the worktree's own.
// Usage: node scripts/worktree-junctions.mjs prepare|cleanup [worktree-path] | is-linked <dir>
import { lstatSync, mkdirSync, realpathSync, rmdirSync, rmSync, symlinkSync, existsSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const SHARE_DIRS = ["node_modules", "src-tauri/target", "dist/bin"];

function git(args, cwd) {
    const r = spawnSync("git", args, { cwd, encoding: "utf8" });
    if (r.status !== 0) {
        throw new Error(`git ${args.join(" ")} failed: ${(r.stderr || r.stdout).trim()}`);
    }
    return r.stdout.trim();
}

// the first line of `git worktree list` is always the main checkout
function mainCheckout(wtPath) {
    return git(["worktree", "list"], wtPath).split("\n")[0].split(/\s+/)[0];
}

function isJunction(p) {
    try {
        return lstatSync(p).isSymbolicLink();
    } catch {
        return false;
    }
}

// junction each of SHARE_DIRS in wtPath to the main checkout's copy; scripts/release-build.mjs uses it too
export function linkShared(wtPath, main) {
    for (const rel of SHARE_DIRS) {
        const wtDir = join(wtPath, rel);
        const mainDir = join(main, rel);
        if (isJunction(wtDir)) {
            let target = "?";
            try {
                target = realpathSync(wtDir);
            } catch {}
            console.log(`${rel}: already a junction -> ${target}`);
            continue;
        }
        if (existsSync(wtDir)) {
            console.warn(`${rel}: exists as a real directory; leaving it alone (delete it first if you want a junction)`);
            continue;
        }
        if (!existsSync(mainDir)) {
            console.warn(`${rel}: main checkout has no ${rel}; skipping`);
            continue;
        }
        // junction links need their parent dir to exist (e.g. wt/dist for dist/bin)
        mkdirSync(dirname(wtDir), { recursive: true });
        symlinkSync(mainDir, wtDir, "junction");
        console.log(`${rel}: junctioned -> ${mainDir}`);
    }
}

export function prepare(cwd) {
    // resolve to the git toplevel so running from a subdir (e.g. frontend/) still junctions at the worktree root
    const wtPath = git(["rev-parse", "--show-toplevel"], cwd);
    const main = mainCheckout(wtPath);
    if (resolve(main) === resolve(wtPath)) {
        console.log("this is the main checkout; nothing to junction. run inside a worktree.");
        return;
    }
    linkShared(wtPath, main);
    console.log("run `task dev`; if the main dev app is already on :9222, use");
    console.log('  WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS="--remote-debugging-port=9223" WEBVIEW2_USER_DATA_FOLDER="$TEMP/wave-wt-profile" task dev');
    console.log("then `CDP_PORT=9223 task verify:ui`.");
}

// remove the SHARE_DIRS junction links in wtPath, never a real directory
export function unlinkShared(wtPath) {
    for (const rel of SHARE_DIRS) {
        const d = join(wtPath, rel);
        if (!existsSync(d)) continue;
        if (isJunction(d)) {
            rmSync(d, { recursive: true, force: true });
            console.log(`${rel}: junction removed`);
            // sweep the now-empty parent (e.g. dist/) so the worktree dir removes cleanly
            for (let p = dirname(d); resolve(p) !== resolve(wtPath); p = dirname(p)) {
                try {
                    rmdirSync(p);
                } catch {
                    break;
                }
            }
        } else {
            console.warn(`${rel}: real directory, not removing`);
        }
    }
}

export function cleanup(wtPath) {
    const main = mainCheckout(wtPath);
    // junction links first: removing them is what keeps the main checkout's dirs alive
    unlinkShared(wtPath);
    if (resolve(main) === resolve(wtPath)) return;
    const branch = git(["branch", "--show-current"], wtPath);
    if (!branch) {
        console.error(`worktree ${wtPath} is on detached HEAD; remove it manually`);
        process.exitCode = 1;
        return;
    }
    // run git from the main checkout so the worktree dir is not a process cwd (Windows lock);
    // `git worktree remove` refuses on dirty, `git branch -d` refuses on unmerged — both guard loudly
    const r = spawnSync("git", ["worktree", "remove", wtPath], { cwd: main, encoding: "utf8" });
    if (r.status !== 0) {
        console.error(`git worktree remove failed: ${(r.stderr || r.stdout).trim()}`);
        console.error("likely a Windows file lock from a shell whose cwd is inside the worktree; leave the dir, then remove it from outside (or retry).");
        process.exitCode = 1;
        return;
    }
    console.log(`worktree removed: ${wtPath}`);
    const rb = spawnSync("git", ["branch", "-d", branch], { cwd: main, encoding: "utf8" });
    if (rb.status !== 0) {
        console.warn(`branch not deleted: ${(rb.stderr || rb.stdout).trim()}`);
    } else {
        console.log(`branch deleted: ${branch}`);
    }
}

function isLinked(dir) {
    if (!isJunction(dir)) {
        return false;
    }
    let target = "?";
    try {
        target = realpathSync(dir);
    } catch {}
    console.log(`${dir}: a link to ${target}; not installing over it`);
    return true;
}

// the CLI runs only when this file is the entry point, not when release-build.mjs imports it
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
    const [sub, arg] = process.argv.slice(2);
    if (sub === "prepare") {
        prepare(process.cwd());
    } else if (sub === "cleanup") {
        // no path arg: resolve cwd to its git toplevel (cleanup() needs the worktree root, not a subdir)
        cleanup(arg ? resolve(arg) : git(["rev-parse", "--show-toplevel"], process.cwd()));
    } else if (sub === "is-linked" && arg) {
        process.exitCode = isLinked(arg) ? 0 : 1;
    } else {
        console.error("usage: node scripts/worktree-junctions.mjs prepare|cleanup [worktree-path] | is-linked <dir>");
        process.exitCode = 2;
    }
}
