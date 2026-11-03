// Installs the council team bench's two approved cases into the packaged app's data dir
// (docs/superpowers/specs/2026-11-03-council-bench-team-design.md, "Approved cases"; that table is CASES below).
// For each case it archives the snapshot commit into <data dir>/council-bench-projects/<id> (no .git), deletes the docs
// that name one of the case's fix commits, runs the leak check, writes the key to <data dir>/council-bench/keys/<id>.md,
// and updates <data dir>/council-bench/cases.json: Phase 0b's four cases are marked retired, the two new ones added or
// replaced. A leak hit exits nonzero before any key or cases.json write. Rerunning gives the same result.
// The data dir is %LOCALAPPDATA%\dev.arc.app\data on Windows and ~/Library/Application Support/dev.arc.app on a Mac.
// Usage: node scripts/council-bench-cases.mjs [--data-dir <path>] [--dry-run]
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");

// the pass's tag; it is bench.TeamPassTag in pkg/council/bench
export const PASS_TAG = "team-bench-2026-11";

// Phase 0b's cases, retired by this pass: a bench skips them unless a case is named
export const RETIRED_IDS = ["newcomer", "services-bugs", "agents-bugs", "services-sleep"];

// The approved cases, word for word from the spec. `fixes` are the commits whose repairs the key lists: their subjects
// are read from git, and no doc in the project may name them.
export const CASES = [
    {
        id: "spec-live-agents",
        snapshot: "0d452589e",
        feature: "Council with live agents and a Slack-style council chat",
        question: "This spec and plan are about to be built. What is wrong or missing in them? List every flaw you can show.",
        files: [
            "docs/superpowers/specs/2026-10-29-council-live-agents-design.md",
            "docs/superpowers/plans/2026-10-29-council-live-agents.md",
            "pkg/council/prompts.go",
            "pkg/council/runner.go",
            "pkg/council/types.go",
            "frontend/app/view/agents/councilmodel.ts",
            "frontend/app/view/agents/councildiscussionmodel.ts",
            "frontend/app/view/agents/agenttreemodel.ts",
            "frontend/app/view/agents/councilsetupmodel.ts",
        ],
        key: [
            "The synthesis, answers and picks prompts hard-code round 2 for the picks and withdrawals, so a council the person sets to 3 rounds (or 1) names the wrong round.",
            "Summarize accepts an awaiting council whose ideas are all held drafts, so the synthesis runs with no idea to read.",
            "The frontend's Summarize check and the expert cards count held and dropped drafts as ideas, not only sent ones.",
            "The plan adds a second claude/pi seat rule (Setup's seatable agents) beside the agent tree's, with a different project-path fallback.",
        ],
        fixes: ["537c4dbf3", "54559d037", "c5ca6fedd"],
    },
    {
        id: "bugs-orchestrate",
        // 18e85a3fa was committed before the other three fixes despite its later author date: this is 16abe9e10
        snapshot: "18e85a3fa^",
        feature: "The orchestrator engine: ended runs, final-stage trees and lands",
        question: "What is broken or wrong here? List every bug you can show.",
        files: [
            "pkg/orchestrate/engine.go",
            "pkg/orchestrate/mutation.go",
            "pkg/orchestrate/watchdog.go",
            "pkg/orchestrate/final.go",
            "pkg/orchestrate/verifier.go",
            "pkg/orchestrate/land.go",
            "pkg/orchestrate/queue.go",
            "frontend/app/view/orchestrate/daggraph-header.tsx",
            "frontend/app/view/agents/runlineage.ts",
        ],
        key: [
            "A dag whose owner run is done or cancelled is never settled: it stays blocked or finalizing, and the watchdog keeps ticking a finalizing one that fails on the branch the land deleted.",
            "A retried removal of a held final tree deletes by path, so it can remove the next round's live tree made at the same `<run>-final` path.",
            "A land held by a merge, rebase or cherry-pick in progress is not Dirty, so the dirty-land retry never retries it once the operation ends.",
            "The DAG graph header counts only done tasks while the tree's run progress counts done and skipped, so a run with a skipped task reads 4/5 in one and 5/5 in the other.",
        ],
        fixes: ["5604d611d", "981dd5bd3", "18e85a3fa", "7561eb541"],
    },
];

// a case's cases.json entry, in the field order the file's other entries use; paths are absolute with forward slashes
export function caseEntry(c, dataDir) {
    const base = resolve(dataDir).replaceAll("\\", "/");
    return {
        id: c.id,
        mode: "review",
        project: `${base}/council-bench-projects/${c.id}`,
        group: "ui-feature",
        solo_group: "solo-ui",
        feature: c.feature,
        question: c.question,
        files: c.files.join(","),
        key: `${base}/council-bench/keys/${c.id}.md`,
        tag: PASS_TAG,
    };
}

// a key file: one `K1: …` line per key line
export function renderKey(lines) {
    return lines.map((text, i) => `K${i + 1}: ${text}`).join("\n") + "\n";
}

// the regular files under root, as sorted forward-slash relative paths; a symlink or junction is neither read nor followed
function walkFiles(root) {
    const out = [];
    const visit = (dir, prefix) => {
        for (const e of readdirSync(dir, { withFileTypes: true })) {
            if (e.isDirectory()) visit(join(dir, e.name), `${prefix}${e.name}/`);
            else if (e.isFile()) out.push(`${prefix}${e.name}`);
        }
    };
    visit(root, "");
    return out.sort();
}

// text names a fix by its subject, or by a hash that is a prefix (7 characters or more) of its full hash
function namesFix(text, fixes) {
    const tokens = text.match(/\b[0-9a-f]{7,40}\b/g) ?? [];
    return fixes.some((f) => text.includes(f.subject) || tokens.some((t) => f.hash.startsWith(t)));
}

// Deletes every file under docs/ that names one of the fixes ({hash, subject}), except the paths in keep (the case's own
// file list); returns the paths it deleted.
export function scrubDocs(root, fixes, keep) {
    const deleted = [];
    for (const rel of walkFiles(root)) {
        if (!rel.startsWith("docs/") || keep.includes(rel)) continue;
        if (namesFix(readFileSync(join(root, rel), "utf8"), fixes)) {
            rmSync(join(root, rel));
            deleted.push(rel);
        }
    }
    return deleted;
}

// The leak check: every file under root that holds one of the needles verbatim, as {file, needle}.
export function findLeaks(root, needles) {
    const hits = [];
    for (const file of walkFiles(root)) {
        const data = readFileSync(join(root, file));
        for (const needle of needles) {
            if (data.includes(needle)) hits.push({ file, needle });
        }
    }
    return hits;
}

// cases.json with 0b's cases marked retired and the entries added (or, when the id exists, laid over the old case, so a
// field this script does not own stays); every other case and field is kept as it is. It returns a new list.
export function updateCases(existing, entries, retiredIds = RETIRED_IDS) {
    if (!Array.isArray(existing)) throw new Error("cases.json is not a JSON list of cases");
    const out = existing.map((c) => (retiredIds.includes(c?.id) ? { ...c, retired: true } : c));
    for (const entry of entries) {
        const i = out.findIndex((c) => c?.id === entry.id);
        if (i < 0) out.push(entry);
        else out[i] = { ...out[i], ...entry };
    }
    return out;
}

function run(cmd, args, cwd) {
    const r = spawnSync(cmd, args, { cwd, encoding: "utf8" });
    if (r.error) throw new Error(`${cmd} ${args.join(" ")}: ${r.error.message}`);
    if (r.status !== 0) throw new Error(`${cmd} ${args.join(" ")} failed: ${(r.stderr || r.stdout).trim()}`);
    return r.stdout.trim();
}

const git = (args) => run("git", args, ROOT);

// a case's snapshot as a full hash, and its fixes as {hash, subject}
function resolveCase(c) {
    return {
        snapshot: git(["rev-parse", "--verify", `${c.snapshot}^{commit}`]),
        fixes: c.fixes.map((h) => {
            const [hash, subject] = git(["log", "-1", "--format=%H%n%s", h]).split("\n");
            return { hash, subject };
        }),
    };
}

// replaces dest with a `git archive` of the snapshot; the tar goes through a temp file and is read from its own folder,
// so no path with a drive colon reaches tar's -f
function archiveInto(snapshot, dest) {
    rmSync(dest, { recursive: true, force: true });
    mkdirSync(dest, { recursive: true });
    const tmp = mkdtempSync(join(tmpdir(), "council-bench-archive-"));
    try {
        git(["archive", "--format=tar", "-o", join(tmp, "snapshot.tar"), snapshot]);
        run("tar", ["-xf", "snapshot.tar", "-C", dest], tmp);
    } finally {
        rmSync(tmp, { recursive: true, force: true });
    }
}

function defaultDataDir() {
    if (process.platform === "win32") {
        if (!process.env.LOCALAPPDATA) throw new Error("LOCALAPPDATA is not set; pass --data-dir");
        return join(process.env.LOCALAPPDATA, "dev.arc.app", "data");
    }
    if (process.platform === "darwin") return join(homedir(), "Library", "Application Support", "dev.arc.app");
    throw new Error(`no packaged app's data dir on ${process.platform}; pass --data-dir`);
}

export function parseArgs(argv) {
    const opts = { dataDir: null, dryRun: false };
    for (let i = 0; i < argv.length; i++) {
        if (argv[i] === "--dry-run") opts.dryRun = true;
        else if (argv[i] === "--data-dir") {
            opts.dataDir = argv[++i];
            if (!opts.dataDir) throw new Error("--data-dir needs a path");
        } else throw new Error(`unknown argument ${argv[i]}`);
    }
    return opts;
}

function main(argv) {
    const opts = parseArgs(argv);
    const dataDir = resolve(opts.dataDir ?? defaultDataDir());
    const casesPath = join(dataDir, "council-bench", "cases.json");
    let existing;
    try {
        existing = JSON.parse(readFileSync(casesPath, "utf8").replace(/^﻿/, ""));
    } catch (err) {
        throw new Error(`cannot read the cases list ${casesPath} (is --data-dir the app's data dir?): ${err.message}`);
    }
    console.log(`data dir ${dataDir.replaceAll("\\", "/")}${opts.dryRun ? " (dry run: nothing is written)" : ""}`);

    const entries = CASES.map((c) => caseEntry(c, dataDir));
    const leaks = [];
    for (const [i, c] of CASES.entries()) {
        const { snapshot, fixes } = resolveCase(c);
        const entry = entries[i];
        console.log(`${c.id}: snapshot ${c.snapshot} = ${snapshot.slice(0, 9)} -> ${entry.project}`);
        for (const f of fixes) console.log(`  fix ${f.hash.slice(0, 9)} ${f.subject}`);
        console.log(`  key ${entry.key} (${c.key.length} lines)`);
        if (opts.dryRun) continue;

        archiveInto(snapshot, entry.project);
        const deleted = scrubDocs(entry.project, fixes, c.files);
        console.log(`  archived ${walkFiles(entry.project).length} files; deleted docs naming a fix: ${deleted.length ? deleted.join(", ") : "none"}`);
        const hits = findLeaks(entry.project, [...fixes.map((f) => f.subject), ...c.key]);
        for (const h of hits) leaks.push(`${c.id}: ${h.file} holds "${h.needle}"`);
        console.log(`  leak check: ${hits.length ? `${hits.length} hit(s)` : "clean"} (${fixes.length} subjects, ${c.key.length} key lines)`);
    }

    const present = new Set(existing.map((c) => c?.id));
    const retire = RETIRED_IDS.filter((id) => present.has(id));
    const added = entries.filter((e) => !present.has(e.id)).map((e) => e.id);
    const replaced = entries.filter((e) => present.has(e.id)).map((e) => e.id);
    console.log(`${casesPath.replaceAll("\\", "/")}: retire ${retire.join(", ") || "none"}; add ${added.join(", ") || "none"}; replace ${replaced.join(", ") || "none"}`);
    if (opts.dryRun) return 0;

    if (leaks.length) {
        for (const l of leaks) console.error(`LEAK ${l}`);
        console.error("leak check failed: no key or cases.json written");
        return 1;
    }
    mkdirSync(join(dataDir, "council-bench", "keys"), { recursive: true });
    for (const c of CASES) writeFileSync(join(dataDir, "council-bench", "keys", `${c.id}.md`), renderKey(c.key));
    writeFileSync(casesPath, JSON.stringify(updateCases(existing, entries), null, 2) + "\n");
    console.log("keys and cases.json written");
    return 0;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
    try {
        process.exitCode = main(process.argv.slice(2));
    } catch (err) {
        console.error(err.message);
        process.exitCode = 1;
    }
}
