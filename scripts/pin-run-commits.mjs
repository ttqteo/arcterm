// Pins the commits arcterm's stored runs cite so they stay resolvable.
//
// An orchestrator run records the lane's basecommit/endcommit, but merging a lane rewrites it — the
// commit arcterm stored is then reachable from nothing and survives only until the next `git gc --prune`.
// Run diffs and `wsh jarvis` range reads break at that point, silently and unrecoverably. This walks
// both arcterm stores (the packaged app and the dev app keep separate databases), takes every commit cited
// by a run for THIS repo, and gives the unreachable ones a ref under refs/arc/runs/ so gc keeps them.
//
//   node scripts/pin-run-commits.mjs --dry-run   # list what would be pinned
//   node scripts/pin-run-commits.mjs             # create the refs
//
// Idempotent: a commit already reachable from main, or already pinned, is skipped. Safe to re-run
// after any orchestrator run. Unpin everything with `git for-each-ref --format='%(refname)'
// refs/arc/runs/ | xargs -n1 git update-ref -d`.

import { execFileSync } from "node:child_process";
import { DatabaseSync } from "node:sqlite";
import path from "node:path";

const REF_PREFIX = "refs/arc/runs/";
const dryRun = process.argv.includes("--dry-run");

const git = (args) => execFileSync("git", args, { encoding: "utf8" }).trim();
const gitOk = (args) => {
    try {
        execFileSync("git", args, { stdio: "ignore" });
        return true;
    } catch {
        return false;
    }
};

const repoRoot = path.resolve(git(["rev-parse", "--show-toplevel"])).toLowerCase();
const localAppData = process.env.LOCALAPPDATA;
if (!localAppData) {
    throw new Error("LOCALAPPDATA is not set; this script targets the Windows arcterm stores");
}
const stores = ["dev.arc.app", "dev.arc.app-dev"].map((app) =>
    path.join(localAppData, app, "data", "db", "waveterm.db")
);

// A run's projectpath is the worktree for a lane, so match the repo root as a prefix, not for equality.
function isThisRepo(projectPath) {
    if (!projectPath) return false;
    const resolved = path.resolve(projectPath).toLowerCase();
    return resolved === repoRoot || resolved.startsWith(repoRoot + path.sep);
}

function citedCommits(dbPath) {
    let db;
    try {
        db = new DatabaseSync(dbPath, { readOnly: true });
    } catch {
        return []; // a store that was never created is not an error
    }
    const found = [];
    for (const row of db.prepare("select data from db_run").all()) {
        let run;
        try {
            const raw = typeof row.data === "string" ? row.data : Buffer.from(row.data).toString("utf8");
            run = JSON.parse(raw);
        } catch {
            continue;
        }
        if (!isThisRepo(run.projectpath)) continue;
        for (const commit of [run.basecommit, run.endcommit]) {
            if (typeof commit === "string" && /^[0-9a-f]{40}$/.test(commit)) found.push(commit);
        }
    }
    db.close();
    return found;
}

const cited = new Set(stores.flatMap(citedCommits));
let created = 0;
let gone = 0;
for (const commit of [...cited].sort()) {
    if (!gitOk(["cat-file", "-e", commit + "^{commit}"])) {
        console.log("gone      " + commit + "  (object no longer in this repo)");
        gone++;
        continue;
    }
    if (gitOk(["merge-base", "--is-ancestor", commit, "main"])) continue;
    const ref = REF_PREFIX + commit;
    if (gitOk(["show-ref", "--verify", "--quiet", ref])) continue;
    const subject = git(["log", "-1", "--format=%s", commit]).slice(0, 60);
    console.log((dryRun ? "would pin " : "pinned    ") + commit.slice(0, 8) + "  " + subject);
    if (!dryRun) git(["update-ref", ref, commit]);
    created++;
}
console.log(
    `${cited.size} commits cited, ${created} ${dryRun ? "to pin" : "pinned"}, ${gone} already gone, ` +
        `${cited.size - created - gone} already resolvable`
);
