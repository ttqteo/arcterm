// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

// The production build behind `task tauri:build`. It builds a commit, not the working tree: agents keep editing
// the main checkout while a build runs, and Vite bundles whatever half-made file it reads at that moment. So the
// commit (HEAD by default) is checked out into a detached worktree, .worktrees/release-build, with the heavy
// build dirs junctioned from the main checkout (node_modules, src-tauri/target, dist/bin, as `task
// worktree:prepare` does); `task tauri:build:post-bump` runs there, and the worktree goes afterwards. Through the
// target junction the bundle lands in the main checkout's src-tauri/target, where `task install` looks, and a
// copy goes to releases/ named with the commit it was built from.
//
//   node scripts/release-build.mjs [--bump none|patch|minor|major|auto] [--force] [--from <commit>|tree] [--dry-run]
//
// --bump    bumps package.json in the main checkout (commit the bump after) and builds the commit at that version.
//           `auto` picks it from the built commit's CHANGELOG.md Unreleased lines (release-bump.mjs: MIN_RELEASE_LINES
//           lines, or MAX_BIG_LINES big ones -> minor, else none, the lines waiting for the next minor). A bump passed by hand that is smaller than those lines call for
//           stops the build before anything is written, unless --force. A bumped build of a commit is tagged
//           v<version> on that commit (local, never pushed), so `git log v1.1.3..v1.1.4` is what 1.1.4 holds.
// --from    the commit to build (default HEAD); `tree` builds the main checkout as it stands, uncommitted edits
//           included, and names the installer <commit>-dirty when the tree has any.
// --dry-run sets the worktree up and removes it again, building nothing.
import { copyFileSync, existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { MAX_BIG_LINES, MIN_RELEASE_LINES, bumpTooSmall, describeCounts, suggestBump } from "./release-bump.mjs";
import { KEEP_RELEASES, pruneReleases } from "./release-prune.mjs";
import { linkShared, unlinkShared } from "./worktree-junctions.mjs";

const ROOT = fileURLToPath(new URL("..", import.meta.url)).replace(/[\\/]$/, "");
const SNAPSHOT = join(ROOT, ".worktrees", "release-build");

function arg(name, fallback) {
    const i = process.argv.indexOf(`--${name}`);
    return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : fallback;
}

function git(args, cwd = ROOT) {
    const r = spawnSync("git", args, { cwd, encoding: "utf8" });
    if (r.status !== 0) {
        throw new Error(`git ${args.join(" ")} failed: ${(r.stderr || r.stdout).trim()}`);
    }
    return r.stdout.trimEnd();
}

function run(cmd, args, cwd) {
    console.log(`\n> ${cmd} ${args.join(" ")}   (in ${cwd})`);
    const r = spawnSync(cmd, args, { cwd, stdio: "inherit" });
    if (r.status !== 0) {
        throw new Error(`${cmd} ${args.join(" ")} exited ${r.status ?? r.error}`);
    }
}

function readVersion(dir) {
    return JSON.parse(readFileSync(join(dir, "package.json"), "utf8")).version;
}

// patch only the version literal, as sync-tauri-version.mjs does, so the rest of the file is left as committed
function writeVersion(dir, version) {
    const file = join(dir, "package.json");
    writeFileSync(file, readFileSync(file, "utf8").replace(/("version"\s*:\s*")([^"]*)(")/, `$1${version}$3`));
}

function removeSnapshot() {
    if (existsSync(SNAPSHOT)) {
        // junctions first: `git worktree remove --force` deletes recursively and would follow one into the main checkout
        unlinkShared(SNAPSHOT);
        const r = spawnSync("git", ["worktree", "remove", "--force", SNAPSHOT], { cwd: ROOT, encoding: "utf8" });
        if (r.status !== 0) {
            console.warn(`could not remove ${SNAPSHOT}: ${(r.stderr || r.stdout).trim()}`);
            console.warn("its junctions are gone, so deleting the folder by hand is safe; the next build retries.");
        }
    }
    git(["worktree", "prune"]);
}

// copy the bundle to releases/, with the build's stamp after the version: arcterm_0.15.11_89186130c_x64-setup.exe
function copyInstaller(version, stamp) {
    const bundles = {
        win32: join(ROOT, "src-tauri", "target", "release", "bundle", "nsis"),
        darwin: join(ROOT, "src-tauri", "target", "release", "bundle", "dmg"),
    };
    const dir = bundles[process.platform];
    if (!dir) return null;
    const prefix = `arcterm_${version}_`;
    const name = readdirSync(dir).find((f) => f.startsWith(prefix) && /\.(exe|dmg)$/.test(f));
    if (!name) {
        throw new Error(`no arcterm_${version} installer in ${dir}`);
    }
    mkdirSync(join(ROOT, "releases"), { recursive: true });
    const out = `${prefix}${stamp}_${name.slice(prefix.length)}`;
    copyFileSync(join(dir, name), join(ROOT, "releases", out));
    return `releases/${out}`;
}

// tag the built commit v<version>, beside the "release: <version>" commit that follows it; an existing tag is kept
function tagRelease(version, commit, stamp) {
    const tag = `v${version}`;
    if (spawnSync("git", ["rev-parse", "--verify", "--quiet", `refs/tags/${tag}`], { cwd: ROOT }).status === 0) {
        console.warn(`\ntag ${tag} already exists (on ${git(["rev-parse", "--short", `${tag}^{commit}`])}): left as it is`);
        return;
    }
    git(["tag", "-a", tag, commit, "-m", `arcterm ${version}, built from ${stamp}`]);
    console.log(`\ntagged ${tag} on ${stamp} (local; push it with the release if you push)`);
}

const requested = arg("bump", "none");
const from = arg("from", "HEAD");
const dryRun = process.argv.includes("--dry-run");
const force = process.argv.includes("--force");
const fromTree = from === "tree";

const commit = git(["rev-parse", "--verify", `${fromTree ? "HEAD" : from}^{commit}`]);
const short = git(["rev-parse", "--short", commit]);
const subject = git(["log", "-1", "--format=%s", commit]);
const dirty = git(["status", "--porcelain"]).split("\n").filter(Boolean);
const stamp = fromTree && dirty.length > 0 ? `${short}-dirty` : short;
// the app shows the same stamp beside its version (frontend/tauri/buildcommit.ts): git in the snapshot would read
// dirty once the bump writes its package.json, so it is passed down to vite instead of asked for there
process.env.ARC_BUILD_COMMIT = stamp;

// the lines the build carries: the commit's CHANGELOG.md, or the checkout's own for --from tree
const changelog = fromTree ? readFileSync(join(ROOT, "CHANGELOG.md"), "utf8") : git(["show", `${commit}:CHANGELOG.md`]);
const suggested = suggestBump(changelog);
let bump = requested;
if (requested === "auto") {
    bump = suggested.bump;
    console.log(`BUMP=auto: CHANGELOG.md's Unreleased has ${describeCounts(suggested.counts)} -> ${bump}`);
    if (bump === "none" && suggested.lines > 0) {
        console.log(
            `building without a bump: ${suggested.lines} line(s) wait in Unreleased until there are ${MIN_RELEASE_LINES}, or ${MAX_BIG_LINES} big ones`
        );
    } else if (bump === "none") {
        console.log("nothing a user would notice since the last release: building without a bump");
    }
} else {
    if (!["none", "patch", "minor", "major"].includes(requested)) {
        console.error(`unknown bump "${requested}": use none, patch, minor, major or auto`);
        process.exit(1);
    }
    const tooSmall = bumpTooSmall(requested, suggested.bump);
    if (tooSmall && !force) {
        console.error(`${tooSmall} (${describeCounts(suggested.counts)}).`);
        console.error(`Pass BUMP=${suggested.bump} or BUMP=auto, or FORCE=1 to bump ${requested} anyway.`);
        process.exit(1);
    }
    if (tooSmall) {
        console.warn(`${tooSmall}; FORCE=1, bumping ${requested} anyway`);
    }
}

if (bump !== "none" && !dryRun) {
    // the bump is written to the main checkout, where it gets committed; the snapshot is given the same version below
    run("node", ["version.cjs", bump], ROOT);
    run("node", ["scripts/sync-tauri-version.mjs"], ROOT);
}

let buildDir = ROOT;
let version;
try {
    if (!fromTree) {
        removeSnapshot(); // a worktree a crashed build left behind
        git(["worktree", "add", "--detach", SNAPSHOT, commit]);
        linkShared(SNAPSHOT, ROOT);
        buildDir = SNAPSHOT;
        if (bump !== "none") {
            writeVersion(SNAPSHOT, readVersion(ROOT));
        }
    }
    version = readVersion(buildDir);
    console.log(`\nbuilding arcterm ${version} from ${fromTree ? "the working tree at " : ""}${stamp} (${subject})`);
    if (dryRun) {
        console.log("--dry-run: not building");
    } else {
        // a fresh `task` process: Task reads VERSION once per process, so it must start after the bump
        run("task", ["tauri:build:post-bump"], buildDir);
        if (!fromTree && bump !== "none" && commit === git(["rev-parse", "HEAD"])) {
            // cargo rewrote the snapshot's Cargo.lock for the new crate version; hand it over with the bump to commit
            const lock = join("src-tauri", "Cargo.lock");
            if (git(["status", "--porcelain", "--", lock]) === "") {
                copyFileSync(join(SNAPSHOT, lock), join(ROOT, lock));
            }
        }
    }
} finally {
    if (!fromTree) {
        removeSnapshot();
    }
}

if (!dryRun) {
    const out = copyInstaller(version, stamp);
    console.log(`\nbuilt arcterm ${version} from ${stamp} (${subject})${out ? `\n  -> ${out}` : ""}`);
    if (out) {
        const dropped = pruneReleases(join(ROOT, "releases"), out.slice("releases/".length));
        if (dropped.length > 0) {
            console.log(`\nreleases/ keeps the newest ${KEEP_RELEASES}: deleted ${dropped.join(", ")}`);
        }
    }
    if (bump !== "none") {
        if (fromTree) {
            console.log(`\nnot tagged: --from tree builds uncommitted edits no commit holds`);
        } else {
            tagRelease(version, commit, stamp);
        }
    }
}
if (!fromTree && dirty.length > 0) {
    console.log(`\nleft out: ${dirty.length} uncommitted change(s) in the checkout:`);
    for (const line of dirty.slice(0, 20)) {
        console.log(`  ${line}`);
    }
    if (dirty.length > 20) {
        console.log(`  ... and ${dirty.length - 20} more`);
    }
}
if (bump !== "none" && !dryRun) {
    console.log(`
commit the bump to ${version}: package.json, src-tauri/tauri.conf.json, src-tauri/Cargo.toml, src-tauri/Cargo.lock`);
}
