// Fixtures for the setup-memory CDP scenario. Everything lives under one mkdtemp root: the git repos the
// fixture projects are registered on, their Claude Code memory folders, and the instruction doc a change
// moves a memory into. Nothing touches ~/.claude. The state files follow pkg/memhygiene's shape (types.go
// State, wshrpctypes_memhygiene.go) with real sha256s, so the backend lists and applies them exactly like a
// checked project's.
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";

export const MEMORY_PROJECTS = {
    own: "verify-mem-own",
    splitA: "verify-mem-split-a",
    splitB: "verify-mem-split-b",
    fresh: "verify-mem-new",
    failed: "verify-mem-failed",
    checking: "verify-mem-checking",
};

export const MEMORY_FAILED_ERROR = "judge returned malformed JSON";

// the shared folder is named for this repo's slug, so the tab names the repo as the memory's owner
export const MEMORY_SHARED_REPO = "monorepo";

const STATE_DIR = "memhygiene";
const INDEX = "MEMORY.md";
const HOUR_MS = 60 * 60 * 1000;
const DAY_MS = 24 * HOUR_MS;
const CHECK_INTERVAL_MS = 7 * DAY_MS;
const FILE_NAME_MAX_STEM = 60;
const FILE_NAME_HASH_HEX = 8;
const NO_DELTA = { lines: 0, bytes: 0 };

const sha256 = (data) => createHash("sha256").update(data).digest("hex");

// mirrors pkg/memhygiene/store.go FileName
export function memoryFileName(project) {
    let stem = "";
    for (const ch of project) {
        stem += /^[A-Za-z0-9._-]$/.test(ch) ? ch : "_";
    }
    stem = stem.slice(0, FILE_NAME_MAX_STEM);
    return `${stem}-${sha256(Buffer.from(project, "utf8")).slice(0, FILE_NAME_HASH_HEX)}.json`;
}

export function memoryStatePath(dataDir, project) {
    return join(dataDir, STATE_DIR, memoryFileName(project));
}

export function memoryBackupDir(dataDir, applyId) {
    return join(dataDir, STATE_DIR, "backups", applyId);
}

// mirrors pkg/memhygiene/textfile.go HashFile: "" for a file that doesn't exist
export function sha256File(path) {
    return existsSync(path) ? sha256(readFileSync(path)) : "";
}

// mirrors pkg/memhygiene/textfile.go ChangeID
export function memoryChangeId(kind, files) {
    const h = createHash("sha256").update(kind);
    for (const f of [...files].sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0))) {
        h.update(Buffer.from([0]))
            .update(f.path)
            .update(Buffer.from([0]))
            .update(f.sha256);
    }
    return h.digest("hex");
}

// mirrors agentobserve.SlugifyCwd, which names Claude Code's per-project folders
export function slugifyPath(path) {
    return path.replace(/[^A-Za-z0-9]/g, "-");
}

// what pkg/memhygiene measures: every line, and every byte (BOM and CRs included)
export function indexStats(path) {
    if (!existsSync(path)) return { exists: false, lines: 0, bytes: 0 };
    const buf = readFileSync(path);
    const lines = buf.toString("utf8").replace(/^﻿/, "").split(/\r?\n/);
    if (lines.at(-1) === "") lines.pop();
    return { exists: true, lines: lines.length, bytes: buf.length };
}

const lineDelta = (line, sign) => ({ lines: sign, bytes: sign * (Buffer.byteLength(line) + 1) });
const signedBytes = (n) => `${n < 0 ? "−" : "+"}${Math.abs(n).toLocaleString("en-US")} B`;
const diffLines = (sign, text) => text.split("\n").map((t) => ({ sign, text: t }));

function emptyOp() {
    return {
        folder: "",
        memories: [],
        old: "",
        new: "",
        indexremove: [],
        indexadd: "",
        indexfolder: "",
        writename: "",
        writebody: "",
        docpath: "",
        docsection: "",
        docpassage: "",
        tofolder: "",
        settingspath: "",
        settingsvalue: "",
        stripharvester: false,
    };
}

// a change with every field the backend stores; files are hashed as they are on disk now
function change(kind, { paths, op, ...rest }) {
    const files = paths.map(([path, mustNotExist]) => ({ path, sha256: mustNotExist ? "" : sha256File(path) }));
    return {
        id: memoryChangeId(kind, files),
        kind,
        group: "",
        title: "",
        note: "",
        applylabel: "",
        effect: "",
        files,
        evidence: [],
        diffs: [],
        indexdelta: NO_DELTA,
        ownindexdelta: NO_DELTA,
        status: "open",
        conflictfile: "",
        decidedat: 0,
        backupuntil: 0,
        applyid: "",
        ...rest,
        op: { ...emptyOp(), ...op },
    };
}

function project(name, path, fields) {
    return {
        project: name,
        path,
        checkedat: 0,
        nextcheckat: 0,
        checking: false,
        lasterror: "",
        memories: 0,
        sessions: 0,
        folder: "",
        sharedwith: [],
        ownfolder: "",
        formershared: "",
        switchedat: 0,
        index: { exists: false, lines: 0, bytes: 0 },
        changes: [],
        ...fields,
    };
}

const memoryFile = (name, description, body, eol = "\n") =>
    ["---", `name: ${name}`, `description: ${description}`, "---", "", ...body.split("\n"), ""].join(eol);

function gitInit(dir) {
    execFileSync("git", ["-C", dir, "init", "-q", "--initial-branch=main"], { stdio: "pipe" });
}

// buildMemoryFixture writes the repos, memory folders and doc under root and returns the projects to
// register, the state each checked one starts from, and what the scenario's steps compare against.
export function buildMemoryFixture(root, now = Date.now()) {
    const written = [];
    const write = (path, text) => {
        mkdirSync(dirname(path), { recursive: true });
        writeFileSync(path, text);
        written.push(path);
        return path;
    };
    const repo = (name) => {
        const dir = join(root, name);
        mkdirSync(dir, { recursive: true });
        gitInit(dir);
        return dir;
    };
    const claudeFolder = (path) => join(root, "claude", "projects", slugifyPath(path), "memory");
    const checkedAt = now - HOUR_MS;
    const checked = { checkedat: checkedAt, nextcheckat: checkedAt + CHECK_INTERVAL_MS };

    // ---- the own project: a memory folder with ordinary changes ----
    const ownRepo = repo("own-repo");
    const doc = write(
        join(ownRepo, "AGENTS.md"),
        "# Agent notes\n\n## Rules\n\n- Run the focused tests first.\n\n## Build\n\n- `task dev` runs the app.\n"
    );
    const own = claudeFolder(ownRepo);
    const ownIndex = join(own, INDEX);
    const line = {
        build: "- [Build reference](build-reference.md) — scripts/build.mjs is the working reference",
        flaky: "- [Flaky retry test](flaky-retry-test.md) — one run of the retry test failed on 07-12",
        answer: "- [EC-TIME on answer](ec-time-answer.md) — the answer lands though the call times out",
        submit: "- [EC-TIME on submit](ec-time-submit.md) — a submit that times out was never sent",
        check: "- [Check lines on Windows](check-lines-windows.md) — plan Check lines: use go build ./cmd/wsh/...",
        merged: "- [wsh jarvis EC-TIME](ec-time-answer.md) — an answer lands anyway; a submit was never sent",
        harvested: "- [Harvested note](harvested-note.md) — vitest needs --stack-size for tsc here",
    };
    write(
        ownIndex,
        ["# Memory index", "", line.build, line.flaky, line.answer, line.submit, line.check, ""].join("\n")
    );
    const trimOld = "See `scripts/build.mjs` for the working reference. Verified 2026-07-24 (commit 64bc188f).";
    const trimNew = "See `scripts/build.mjs` for the working reference.";
    // crlf, so the trim is checked against a file whose line endings it must keep
    const trimPath = write(
        join(own, "build-reference.md"),
        memoryFile("Build reference", "scripts/build.mjs is the working reference", trimOld, "\r\n")
    );
    const flakyPath = write(
        join(own, "flaky-retry-test.md"),
        memoryFile(
            "Flaky retry test",
            "one run failed",
            "The retry test failed once on 2026-07-12 and passed on rerun."
        )
    );
    const answerPath = write(
        join(own, "ec-time-answer.md"),
        memoryFile(
            "EC-TIME on answer",
            "the answer lands",
            "`wsh jarvis dag answer` can time out though the answer lands; check `dag asks` first."
        )
    );
    const submitPath = write(
        join(own, "ec-time-submit.md"),
        memoryFile(
            "EC-TIME on submit",
            "never sent",
            "`wsh jarvis dag submit` timing out means it was never sent; check planreview.round."
        )
    );
    const checkPath = write(
        join(own, "check-lines-windows.md"),
        memoryFile(
            "Check lines on Windows",
            "use go build ./cmd/wsh/...",
            "Plan Check lines: use `go build ./cmd/wsh/...`, never `go build -o /dev/null`."
        )
    );
    const harvestedPath = write(
        join(own, "harvested-note.md"),
        [
            "---",
            "name: Harvested note",
            "description: vitest needs --stack-size for tsc here",
            "source: codex",
            "source_hash: 3f2a9c",
            "harvested_at: 2026-08-02",
            "---",
            "",
            "Typecheck with `task check:ts`; plain `npx tsc` overflows the stack.",
            "",
        ].join("\n")
    );
    const mergedBody = memoryFile(
        "wsh jarvis EC-TIME",
        "an answer lands anyway; a submit was never sent",
        "`dag answer` can time out though it lands (check `dag asks`); a timed-out `dag submit` was never sent (check planreview.round)."
    ).replace(/\n$/, "");
    const docPassage = "- **Check lines on Windows:** use `go build ./cmd/wsh/...`, never `go build -o /dev/null`.";

    const ownChanges = {
        trim: change("trim", {
            paths: [[trimPath]],
            title: "Drop a past verification note",
            note: "The index line stays as it is.",
            applylabel: "Apply trim",
            effect: `Body ${signedBytes(trimNew.length - trimOld.length)}`,
            evidence: [
                { tone: "none", text: "Records one past check (2026-07-24, commit 64bc188f), not a rule", code: "" },
                { tone: "ok", text: "The reference still exists: ", code: "scripts/build.mjs" },
            ],
            diffs: [
                {
                    path: "build-reference.md",
                    note: "body",
                    lines: [...diffLines("-", trimOld), ...diffLines("+", trimNew)],
                },
            ],
            op: { folder: own, memories: ["build-reference.md"], old: trimOld, new: trimNew },
        }),
        delete: change("delete", {
            paths: [[flakyPath]],
            title: "A one-time test result, not a rule",
            applylabel: "Delete memory",
            effect: `Index ${signedBytes(-(Buffer.byteLength(line.flaky) + 1))}`,
            indexdelta: lineDelta(line.flaky, -1),
            evidence: [{ tone: "none", text: "Records one failed run on 2026-07-12 that passed on rerun", code: "" }],
            diffs: [
                { path: INDEX, note: "−1 line", lines: diffLines("-", line.flaky) },
                { path: "flaky-retry-test.md", note: "deleted", lines: [] },
            ],
            op: { folder: own, memories: ["flaky-retry-test.md"], indexremove: [line.flaky] },
        }),
        merge: change("merge", {
            paths: [[answerPath], [submitPath]],
            title: "Two entries about EC-TIME from wsh jarvis",
            note: "The bodies are joined into ec-time-answer.md; the other files are deleted.",
            applylabel: "Merge entries",
            effect: `Index ${signedBytes(
                Buffer.byteLength(line.merged) - Buffer.byteLength(line.answer) - Buffer.byteLength(line.submit) - 1
            )}`,
            indexdelta: {
                lines: -1,
                bytes:
                    Buffer.byteLength(line.merged) -
                    Buffer.byteLength(line.answer) -
                    Buffer.byteLength(line.submit) -
                    1,
            },
            evidence: [{ tone: "none", text: "Both are about a 5 s EC-TIME from ", code: "wsh jarvis" }],
            diffs: [
                {
                    path: INDEX,
                    note: "2 lines → 1",
                    lines: [...diffLines("-", `${line.answer}\n${line.submit}`), ...diffLines("+", line.merged)],
                },
            ],
            op: {
                folder: own,
                memories: ["ec-time-answer.md", "ec-time-submit.md"],
                indexremove: [line.answer, line.submit],
                indexadd: line.merged,
                writename: "ec-time-answer.md",
                writebody: mergedBody,
            },
        }),
        moveToDoc: change("move-to-doc", {
            paths: [[doc], [checkPath]],
            title: "A plan-writing rule the repo should own",
            note: "Leaves AGENTS.md changed in your working tree. Commit it with your next change.",
            applylabel: "Move to AGENTS.md",
            effect: `Index ${signedBytes(-(Buffer.byteLength(line.check) + 1))}`,
            indexdelta: lineDelta(line.check, -1),
            evidence: [{ tone: "none", text: "AGENTS.md already documents plan rules under ", code: "## Rules" }],
            diffs: [
                { path: "AGENTS.md", note: "## Rules", lines: diffLines("+", docPassage) },
                { path: INDEX, note: "−1 line", lines: diffLines("-", line.check) },
            ],
            op: {
                folder: own,
                memories: ["check-lines-windows.md"],
                indexremove: [line.check],
                docpath: doc,
                docsection: "## Rules",
                docpassage: docPassage,
            },
        }),
        addToIndex: change("add-to-index", {
            paths: [[harvestedPath]],
            title: "A memory the index doesn't link",
            note: "The old harvester’s fields are dropped from a memory it keeps.",
            applylabel: "Add to index",
            effect: `Index ${signedBytes(Buffer.byteLength(line.harvested) + 1)}`,
            indexdelta: lineDelta(line.harvested, 1),
            evidence: [{ tone: "warn", text: "No index line links ", code: "harvested-note.md" }],
            diffs: [
                { path: INDEX, note: "+1 line", lines: diffLines("+", line.harvested) },
                {
                    path: "harvested-note.md",
                    note: "frontmatter",
                    lines: diffLines("-", "source: codex\nsource_hash: 3f2a9c\nharvested_at: 2026-08-02"),
                },
            ],
            op: { folder: own, memories: ["harvested-note.md"], indexadd: line.harvested, stripharvester: true },
        }),
    };

    // ---- the split: two subprojects of one repo loading its shared folder ----
    const mono = repo(MEMORY_SHARED_REPO);
    const splitAPath = join(mono, "split-a");
    const splitBPath = join(mono, "split-b");
    write(join(splitAPath, "README.md"), "# split-a\n");
    write(join(splitBPath, "README.md"), "# split-b\n");
    const shared = claudeFolder(mono);
    const sharedIndex = join(shared, INDEX);
    const ownA = claudeFolder(splitAPath);
    const ownB = claudeFolder(splitBPath);
    const sline = {
        build: "- [split-a build](split-a-build.md) — split-a builds with vite, not webpack",
        deploy: "- [split-a deploy](split-a-deploy.md) — split-a deploys from the release branch",
        lint: "- [Shared lint rule](shared-lint.md) — both subprojects lint with the root config",
        api: "- [split-b api](split-b-api.md) — split-b's api client is generated",
    };
    write(sharedIndex, ["# Memory index", "", sline.build, sline.deploy, sline.lint, sline.api, ""].join("\n"));
    const sharedMemory = (name, body) => write(join(shared, name), memoryFile(name.replace(/\.md$/, ""), body, body));
    sharedMemory("split-a-build.md", "split-a builds with vite, not webpack");
    sharedMemory("split-a-deploy.md", "split-a deploys from the release branch");
    sharedMemory("shared-lint.md", "both subprojects lint with the root config");
    sharedMemory("split-b-api.md", "split-b's api client is generated");
    const leftover = write(
        join(ownA, "old-harvest.md"),
        memoryFile("old harvest", "a codex note", "A note the old harvester copied from codex.")
    );
    mkdirSync(ownB, { recursive: true });
    const settingsA = join(splitAPath, ".claude", "settings.local.json");

    const moveOrCopy = (kind, name, indexLine, ownFolder, projectName, others) =>
        change(kind, {
            paths: [[join(shared, name)], [join(ownFolder, name), true]],
            group: "shared",
            title: indexLine.replace(/^- \[([^\]]+)\].*$/, "$1"),
            note:
                kind === "copy-here"
                    ? "Once every project that needs it has a copy, a later check offers to delete it from the shared memory."
                    : "",
            applylabel: kind === "copy-here" ? "Copy here" : "Move here",
            effect: `File ${Buffer.byteLength(readFileSync(join(shared, name))).toLocaleString("en-US")} B`,
            indexdelta: kind === "move-here" ? lineDelta(indexLine, -1) : NO_DELTA,
            ownindexdelta: lineDelta(indexLine, 1),
            evidence: [
                kind === "copy-here"
                    ? { tone: "none", text: `Also applies to ${others.join(", ")}, so the shared copy stays`, code: "" }
                    : { tone: "none", text: `Applies only to ${projectName}`, code: "" },
            ],
            diffs: [
                ...(kind === "move-here"
                    ? [{ path: sharedIndex, note: "−1 line", lines: diffLines("-", indexLine) }]
                    : []),
                { path: join(ownFolder, INDEX), note: "+1 line", lines: diffLines("+", indexLine) },
            ],
            op: {
                folder: shared,
                memories: [name],
                tofolder: ownFolder,
                indexfolder: ownFolder,
                indexadd: indexLine,
                indexremove: kind === "move-here" ? [indexLine] : [],
            },
        });

    const splitChanges = {
        moveBuild: moveOrCopy("move-here", "split-a-build.md", sline.build, ownA, MEMORY_PROJECTS.splitA, []),
        moveDeploy: moveOrCopy("move-here", "split-a-deploy.md", sline.deploy, ownA, MEMORY_PROJECTS.splitA, []),
        copyLint: moveOrCopy("copy-here", "shared-lint.md", sline.lint, ownA, MEMORY_PROJECTS.splitA, [
            MEMORY_PROJECTS.splitB,
        ]),
        ownDelete: change("delete", {
            paths: [[leftover]],
            group: "own",
            title: "A codex note no session needs",
            applylabel: "Delete memory",
            effect: `File ${signedBytes(-Buffer.byteLength(readFileSync(leftover)))}`,
            evidence: [{ tone: "none", text: "Copied by the old harvester from ", code: "codex" }],
            diffs: [
                {
                    path: "old-harvest.md",
                    note: "deleted",
                    lines: diffLines("-", "A note the old harvester copied from codex."),
                },
            ],
            op: { folder: ownA, memories: ["old-harvest.md"] },
        }),
        settings: change("settings", {
            paths: [[settingsA]],
            group: "switch",
            title: `Point Claude Code at ${MEMORY_PROJECTS.splitA}’s memory`,
            note: `Sessions started in ${MEMORY_PROJECTS.splitA} after this load its own memory. Running sessions keep the shared memory until they restart.`,
            applylabel: "Switch memory",
            effect: "1 setting",
            evidence: [{ tone: "none", text: "Every other setting in the file stays as it is", code: "" }],
            diffs: [
                {
                    path: settingsA,
                    note: "+1 key",
                    lines: diffLines("+", `  "autoMemoryDirectory": ${JSON.stringify(ownA)},`),
                },
            ],
            op: { settingspath: settingsA, settingsvalue: ownA },
        }),
    };

    // ---- the state-only projects: never checked, a failed check, a check running ----
    const freshRepo = repo("new-repo");
    const failedRepo = repo("failed-repo");
    const checkingRepo = repo("checking-repo");
    const failedFolder = claudeFolder(failedRepo);
    const failedLine = "- [Old rule](old-rule.md) — a rule from before";
    const failedIndex = write(join(failedFolder, INDEX), `# Memory index\n\n${failedLine}\n`);
    const failedMemory = write(
        join(failedFolder, "old-rule.md"),
        memoryFile("Old rule", "a rule from before", "A rule from before the last check.")
    );
    const failedCheckedAt = now - 2 * DAY_MS;
    const failedKept = change("delete", {
        paths: [[failedMemory]],
        title: "A rule the repo no longer follows",
        applylabel: "Delete memory",
        effect: `Index ${signedBytes(-(Buffer.byteLength(failedLine) + 1))}`,
        indexdelta: lineDelta(failedLine, -1),
        evidence: [{ tone: "none", text: "Read in 0 of 12 sessions", code: "" }],
        op: { folder: failedFolder, memories: ["old-rule.md"], indexremove: [failedLine] },
        status: "kept",
        decidedat: failedCheckedAt + HOUR_MS,
    });

    const states = {
        [MEMORY_PROJECTS.own]: project(MEMORY_PROJECTS.own, ownRepo, {
            ...checked,
            memories: 6,
            sessions: 42,
            folder: own,
            index: indexStats(ownIndex),
            changes: Object.values(ownChanges),
        }),
        [MEMORY_PROJECTS.splitA]: project(MEMORY_PROJECTS.splitA, splitAPath, {
            ...checked,
            memories: 4,
            sessions: 17,
            folder: shared,
            sharedwith: [MEMORY_PROJECTS.splitB],
            ownfolder: ownA,
            index: indexStats(sharedIndex),
            ownindex: indexStats(join(ownA, INDEX)),
            changes: Object.values(splitChanges),
        }),
        [MEMORY_PROJECTS.splitB]: project(MEMORY_PROJECTS.splitB, splitBPath, {
            ...checked,
            memories: 4,
            sessions: 9,
            folder: shared,
            sharedwith: [MEMORY_PROJECTS.splitA],
            ownfolder: ownB,
            index: indexStats(sharedIndex),
            ownindex: indexStats(join(ownB, INDEX)),
            changes: [moveOrCopy("move-here", "split-b-api.md", sline.api, ownB, MEMORY_PROJECTS.splitB, [])],
        }),
        [MEMORY_PROJECTS.failed]: project(MEMORY_PROJECTS.failed, failedRepo, {
            checkedat: failedCheckedAt,
            nextcheckat: failedCheckedAt + CHECK_INTERVAL_MS,
            lasterror: MEMORY_FAILED_ERROR,
            memories: 1,
            sessions: 12,
            folder: failedFolder,
            index: indexStats(failedIndex),
            changes: [failedKept],
        }),
        [MEMORY_PROJECTS.checking]: project(MEMORY_PROJECTS.checking, checkingRepo, { checking: true }),
    };

    return {
        root,
        written,
        // verify-mem-new is registered with no state file: it lists as never checked
        projects: [
            { name: MEMORY_PROJECTS.own, path: ownRepo },
            { name: MEMORY_PROJECTS.splitA, path: splitAPath },
            { name: MEMORY_PROJECTS.splitB, path: splitBPath },
            { name: MEMORY_PROJECTS.fresh, path: freshRepo },
            { name: MEMORY_PROJECTS.failed, path: failedRepo },
            { name: MEMORY_PROJECTS.checking, path: checkingRepo },
        ],
        states,
        ownChanges,
        splitChanges,
        paths: {
            own,
            ownIndex,
            doc,
            trim: trimPath,
            delete: flakyPath,
            harvested: harvestedPath,
            shared,
            sharedIndex,
            ownA,
        },
        trim: { old: trimOld, new: trimNew },
    };
}

// writeMemoryStates writes each state to <dataDir>/memhygiene/<FileName>.json and returns the paths.
export function writeMemoryStates(dataDir, states) {
    const out = [];
    for (const [name, state] of Object.entries(states)) {
        const path = memoryStatePath(dataDir, name);
        mkdirSync(dirname(path), { recursive: true });
        writeFileSync(path, JSON.stringify(state, null, 2));
        out.push(path);
    }
    return out;
}

// settleMemoryStates returns the states with every undecided change kept, so no project has one to review.
export function settleMemoryStates(states, now = Date.now()) {
    const out = {};
    for (const [name, state] of Object.entries(states)) {
        out[name] = {
            ...state,
            changes: state.changes.map((c) =>
                c.status === "applied" || c.status === "kept"
                    ? c
                    : { ...c, status: "kept", conflictfile: "", decidedat: now }
            ),
        };
    }
    return out;
}
