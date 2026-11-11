// Installs the council bench's Brainstorm cases (docs/superpowers/specs/2026-11-11-brainstorm-bench-round2-design.md,
// "Cases") into the packaged app's data dir. A case is one file, scripts/council-bench-brainstorm-cases/<id>.json:
//   { id, snapshot, feature_commits: [hashes], feature, question, files: [repo paths],
//     key: [{ text, at: "path:line", shows: "text that line holds" }] }
// The key lines are mechanisms the code at the snapshot shows only when read closely; `at` and `shows` let a reviewer, and
// this script, check that each one is derivable. For each case it validates the file, archives the snapshot, deletes the
// docs that name a feature commit, checks that every `files` path is in the copy and every cite resolves, and runs the
// leak check (the feature commits' subjects and every key line's text must appear nowhere in the copy). A real install
// then writes the copy to <data dir>/council-bench-projects/<id>, the key (each cite on an indented line under its K
// line, which the judge's key reader ignores) to <data dir>/council-bench/keys/<id>.md, and updates cases.json:
// launcher-declutter is retired, the cases added or replaced. Rerunning gives the same result.
//   --check [<id>...]   checks the named cases (every case with no id) in temp dirs; never touches the data dir
//   --dry-run           every check in temp dirs, the cases listed as the person reads them, nothing written
//   neither             checks first, and writes nothing unless every case passed
// A failed check in any mode exits nonzero. The data dir is the Review script's (scripts/council-bench-cases.mjs).
// Usage: node scripts/council-bench-brainstorm-cases.mjs [--data-dir <path>] [--dry-run] [--check <id>...]
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { ROOT, archiveInto, dataBase, defaultDataDir, findLeaks, git, resolveCommit, scrubDocs, updateCases, walkFiles } from "./council-bench-cases.mjs";

export const CASES_DIR = join(ROOT, "scripts", "council-bench-brainstorm-cases");

// set aside by round 2: its key was layout taste, which no variant can derive without a person
export const BRAINSTORM_RETIRED_IDS = ["launcher-declutter"];

// a path inside the project: relative, forward slashes, no way out of the folder
const projectPath = (p) => typeof p === "string" && p !== "" && !/^([A-Za-z]:|[\\/])/.test(p) && !p.includes("\\") && !p.split("/").includes("..");

// text as a person reads it: runs of whitespace are one space
const squash = (s) => s.replace(/\s+/g, " ").trim();

// a JSON file Windows tools wrote may start with a byte order mark
const stripBom = (s) => (s.charCodeAt(0) === 0xfeff ? s.slice(1) : s);

// `path:line` as {path, line}, or null when it is not a project path with a line of 1 or more
export function parseCite(at) {
    const m = typeof at === "string" ? /^(.+):(\d+)$/.exec(at) : null;
    if (!m || !projectPath(m[1]) || Number(m[2]) < 1) return null;
    return { path: m[1], line: Number(m[2]) };
}

// The problems with a case file's contents, as a list of messages (empty: the case is usable). fileName is the file's
// name, e.g. "run-pause.json"; when given, the id must be its base name.
export function validateCase(c, fileName) {
    if (c === null || typeof c !== "object" || Array.isArray(c)) return ["the case is not a JSON object"];
    const problems = [];
    const text = (v) => typeof v === "string" && v.trim() !== "";
    if (!text(c.id) || !/^[a-z0-9][a-z0-9-]*$/.test(c.id)) problems.push("id must be a name of lowercase letters, digits and dashes");
    else if (fileName !== undefined && fileName !== `${c.id}.json`) problems.push(`id ${c.id} does not match the file name ${fileName}`);
    if (!text(c.snapshot)) problems.push("snapshot is missing");
    if (!Array.isArray(c.feature_commits) || c.feature_commits.length === 0 || !c.feature_commits.every(text)) {
        problems.push("feature_commits must list at least one commit, each a non-empty string");
    }
    if (!text(c.feature)) problems.push("feature is missing");
    if (!text(c.question)) problems.push("question is missing");
    if (!Array.isArray(c.files) || c.files.length === 0) problems.push("files must list at least one path");
    else {
        for (const f of c.files) {
            if (!text(f)) problems.push(`files holds ${JSON.stringify(f)}, not a path`);
            else if (f.includes(",")) problems.push(`files: ${f} holds a comma, which the bench reads as two paths`);
            else if (!projectPath(f)) problems.push(`files: ${f} is not a project-relative path`);
        }
    }
    if (!Array.isArray(c.key) || c.key.length < 4 || c.key.length > 6) problems.push("key must have 4 to 6 lines");
    if (Array.isArray(c.key)) {
        c.key.forEach((k, i) => {
            const id = `K${i + 1}`;
            if (k === null || typeof k !== "object") return problems.push(`${id} is not an object`);
            if (!text(k.text)) problems.push(`${id}: text is missing`);
            else if (/[\r\n]/.test(k.text)) problems.push(`${id}: text must be one line`);
            else if (text(c.question) && squash(c.question).toLowerCase().includes(squash(k.text).toLowerCase())) {
                problems.push(`${id}: the question holds this key line's text`);
            }
            if (!parseCite(k.at)) problems.push(`${id}: at ${JSON.stringify(k.at)} is not a project-relative path:line with a line of 1 or more`);
            if (!text(k.shows)) problems.push(`${id}: shows is missing`);
        });
    }
    return problems;
}

// The key lines whose cite does not hold, as {id, at, problem}: the file is missing or unreadable, the line is past the
// end of the file, or the line does not contain `shows` (compared with runs of whitespace as one space).
export function checkCites(root, key) {
    const bad = [];
    key.forEach((k, i) => {
        const id = `K${i + 1}`;
        const fail = (problem) => bad.push({ id, at: k.at, problem });
        const cite = parseCite(k.at);
        if (!cite) return fail("is not a project-relative path:line");
        let data;
        try {
            data = readFileSync(join(root, cite.path), "utf8");
        } catch (err) {
            return fail(err.code === "ENOENT" ? "the file is missing" : `cannot be read: ${err.message}`);
        }
        const lines = data.split(/\r?\n/);
        if (lines[lines.length - 1] === "") lines.pop(); // the empty piece after the last newline is no line
        if (cite.line > lines.length) return fail(`line ${cite.line} is past the end (the file has ${lines.length} line${lines.length === 1 ? "" : "s"})`);
        if (!squash(lines[cite.line - 1]).includes(squash(k.shows))) fail(`line ${cite.line} does not hold ${JSON.stringify(k.shows)}`);
    });
    return bad;
}

// The case's `files` paths that are not regular files in the archived copy, in the case's order. The bench loads a case
// when its project folder and key exist, so a wrong path would otherwise surface only in the round itself.
export function checkFiles(root, files) {
    return files.filter((f) => {
        if (!projectPath(f)) return true;
        try {
            return !statSync(join(root, f)).isFile();
        } catch (err) {
            if (err.code === "ENOENT" || err.code === "ENOTDIR") return true;
            throw err;
        }
    });
}

// A key file: `K1: <text>` and, indented under it, `    at <path:line>`. The judge's key reader (keyLineRe in
// pkg/council/bench/cases.go) takes the K lines only, so it never sees a cite.
export function renderBrainstormKey(key) {
    return key.map((k, i) => `K${i + 1}: ${k.text}\n    at ${k.at}\n`).join("");
}

// a case's cases.json entry, in the field order the file's other entries use; paths are absolute with forward slashes.
// It has no tag: only the cases tagged for the council-against-team pass count toward that verdict.
export function brainstormEntry(c, dataDir) {
    const base = dataBase(dataDir);
    return {
        id: c.id,
        mode: "brainstorm",
        project: `${base}/council-bench-projects/${c.id}`,
        group: "ui-feature",
        solo_group: "solo-ui",
        feature: c.feature,
        question: c.question,
        files: c.files.join(","),
        key: `${base}/council-bench/keys/${c.id}.md`,
    };
}

// the case files of a folder as {file, c}, in file-name order; a folder that is not there holds none
export function loadCaseFiles(dir = CASES_DIR) {
    let names;
    try {
        names = readdirSync(dir);
    } catch (err) {
        if (err.code === "ENOENT") return [];
        throw err;
    }
    return names
        .filter((n) => n.endsWith(".json"))
        .sort()
        .map((file) => {
            try {
                return { file, c: JSON.parse(stripBom(readFileSync(join(dir, file), "utf8"))) };
            } catch (err) {
                throw new Error(`${file}: ${err.message}`);
            }
        });
}

export function parseArgs(argv) {
    const opts = { dataDir: null, dryRun: false, check: null };
    for (let i = 0; i < argv.length; i++) {
        if (argv[i] === "--dry-run") opts.dryRun = true;
        else if (argv[i] === "--data-dir") {
            opts.dataDir = argv[++i];
            if (!opts.dataDir) throw new Error("--data-dir needs a path");
        } else if (argv[i] === "--check") {
            opts.check = [];
            while (i + 1 < argv.length && !argv[i + 1].startsWith("--")) opts.check.push(argv[++i]);
        } else throw new Error(`unknown argument ${argv[i]}`);
    }
    if (opts.check && opts.dataDir) throw new Error("--check never touches the data dir: drop --data-dir");
    return opts;
}

// replaces dest with the snapshot's archive minus the docs that name a feature commit; returns the deleted paths
function prepareCopy(snapshot, dest, commits, keep) {
    archiveInto(snapshot, dest);
    return scrubDocs(dest, commits, keep);
}

// Lists one case and runs every check on a copy of its snapshot in dest. A failure is printed as `FAIL …` and returned
// in `problems`; with none the case passed.
function checkCase(file, c, dest) {
    console.log(`${typeof c?.id === "string" && c.id ? c.id : file}: ${c?.feature ?? "(no feature)"}`);
    const problems = validateCase(c, file);
    const fail = (msg) => {
        problems.push(msg);
        console.log(`  FAIL ${msg}`);
    };
    if (problems.length) {
        for (const p of problems) console.log(`  FAIL ${p}`);
        return { c, problems }; // an unusable case is not archived
    }
    console.log(`  question: ${c.question}`);
    console.log(`  files: ${c.files.join(", ")}`);
    for (const [i, k] of c.key.entries()) {
        console.log(`  K${i + 1} ${k.text}`);
        console.log(`     at ${k.at}  shows ${JSON.stringify(k.shows)}`);
    }
    let snapshot, commits;
    try {
        snapshot = git(["rev-parse", "--verify", `${c.snapshot}^{commit}`]);
        commits = c.feature_commits.map(resolveCommit);
        console.log(`  snapshot ${c.snapshot} = ${snapshot.slice(0, 9)}`);
        for (const f of commits) console.log(`  feature commit ${f.hash.slice(0, 9)} ${f.subject}`);
        const deleted = prepareCopy(snapshot, dest, commits, c.files);
        console.log(`  archived ${walkFiles(dest).length} files; deleted docs naming a feature commit: ${deleted.length ? deleted.join(", ") : "none"}`);

        const gone = checkFiles(dest, c.files);
        for (const f of gone) fail(`files: ${f} is not a file in the snapshot`);
        if (!gone.length) console.log(`  files: all ${c.files.length} are in the copy`);

        const bad = checkCites(dest, c.key);
        for (const b of bad) fail(`${b.id} ${b.at}: ${b.problem}`);
        if (!bad.length) console.log(`  cites: all ${c.key.length} resolve`);

        const hits = findLeaks(dest, [...commits.map((f) => f.subject), ...c.key.map((k) => k.text)]);
        for (const h of hits) fail(`leak: ${h.file} holds ${JSON.stringify(h.needle)}`);
        if (!hits.length) console.log(`  leak check: clean (${commits.length} subjects, ${c.key.length} key lines)`);
    } catch (err) {
        fail(err.message);
    }
    console.log(`  ${problems.length ? "FAILED" : "ok"}`);
    return { c, problems, snapshot, commits };
}

export function main(argv, casesDir = CASES_DIR) {
    const opts = parseArgs(argv);
    const all = loadCaseFiles(casesDir);
    if (all.length === 0) throw new Error(`no case files in ${casesDir}`);
    const idOf = (file) => file.replace(/\.json$/, "");
    if (opts.check?.length) {
        const unknown = opts.check.filter((id) => !all.some(({ file }) => idOf(file) === id));
        if (unknown.length) throw new Error(`no case file for ${unknown.join(", ")} in ${casesDir} (it has ${all.map(({ file }) => idOf(file)).join(", ")})`);
    }
    const selected = opts.check?.length ? all.filter(({ file }) => opts.check.includes(idOf(file))) : all;

    let dataDir = null;
    let casesPath = null;
    let existing = null;
    if (!opts.check) {
        dataDir = resolve(opts.dataDir ?? defaultDataDir());
        casesPath = join(dataDir, "council-bench", "cases.json");
        try {
            existing = JSON.parse(stripBom(readFileSync(casesPath, "utf8")));
        } catch (err) {
            throw new Error(`cannot read the cases list ${casesPath} (is --data-dir the app's data dir?): ${err.message}`);
        }
        console.log(`data dir ${dataDir.replaceAll("\\", "/")}${opts.dryRun ? " (dry run: nothing is written)" : ""}`);
    }

    // every check runs on copies in a temp dir, so a failure anywhere leaves the data dir as it was
    const tmp = mkdtempSync(join(tmpdir(), "council-bench-brainstorm-"));
    try {
        const checked = selected.map(({ file, c }, i) => checkCase(file, c, join(tmp, String(i))));
        const failed = checked.filter((r) => r.problems.length);
        if (failed.length) {
            console.error(`${failed.length} of ${checked.length} case(s) failed: ${failed.map((r) => r.c?.id ?? "?").join(", ")}${opts.check ? "" : "; nothing is written"}`);
            return 1;
        }
        console.log(`all ${checked.length} case(s) passed`);
        if (opts.check) return 0;

        const entries = checked.map((r) => brainstormEntry(r.c, dataDir));
        const updated = updateCases(existing, entries, BRAINSTORM_RETIRED_IDS);
        const present = new Set(existing.map((c) => c?.id));
        const retire = BRAINSTORM_RETIRED_IDS.filter((id) => present.has(id));
        const added = entries.filter((e) => !present.has(e.id)).map((e) => e.id);
        const replaced = entries.filter((e) => present.has(e.id)).map((e) => e.id);
        for (const e of entries) console.log(`${e.id}: project ${e.project}, key ${e.key}`);
        console.log(`${casesPath.replaceAll("\\", "/")}: retire ${retire.join(", ") || "none"}; add ${added.join(", ") || "none"}; replace ${replaced.join(", ") || "none"}`);
        if (opts.dryRun) return 0;

        for (const [i, r] of checked.entries()) prepareCopy(r.snapshot, entries[i].project, r.commits, r.c.files);
        mkdirSync(join(dataDir, "council-bench", "keys"), { recursive: true });
        for (const r of checked) writeFileSync(join(dataDir, "council-bench", "keys", `${r.c.id}.md`), renderBrainstormKey(r.c.key));
        writeFileSync(casesPath, JSON.stringify(updated, null, 2) + "\n");
        console.log("projects, keys and cases.json written");
        return 0;
    } finally {
        rmSync(tmp, { recursive: true, force: true });
    }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
    try {
        process.exitCode = main(process.argv.slice(2));
    } catch (err) {
        console.error(err.message);
        process.exitCode = 1;
    }
}
