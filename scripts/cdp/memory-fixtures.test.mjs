import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { isAbsolute, join, relative } from "node:path";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import {
    buildMemoryFixture,
    indexStats,
    MEMORY_ASK_ERROR,
    MEMORY_JUDGED_BY,
    MEMORY_PROJECTS,
    memoryChangeId,
    memoryFileName,
    memoryStatePath,
    settleMemoryStates,
    sha256File,
    writeMemoryStates,
} from "./memory-fixtures.mjs";

const roots = [];
function tempRoot(prefix = "memory-fixtures-test-") {
    const r = mkdtempSync(join(tmpdir(), prefix));
    roots.push(r);
    return r;
}
afterEach(() => {
    for (const r of roots.splice(0)) rmSync(r, { recursive: true, force: true });
});

// one fixture for the file: every case only reads it, and each build runs several git inits, ~0.6 s idle but past
// vitest's 5 s case timeout under a final stage's load (run 32878721, 2026-11-02); the hook gets the 120 s instead
let fxRoot;
let fx;
beforeAll(() => {
    fxRoot = mkdtempSync(join(tmpdir(), "memory-fixtures-test-"));
    fx = buildMemoryFixture(fxRoot);
}, 120_000);
afterAll(() => {
    if (fxRoot) rmSync(fxRoot, { recursive: true, force: true });
});

const under = (root, path) => {
    const rel = relative(root, path);
    return rel !== "" && !rel.startsWith("..") && !isAbsolute(rel);
};

// every absolute path a state names: the project, its folders, and each change's files and op targets
function statePaths(state) {
    const out = [state.path, state.folder, state.ownfolder].filter(Boolean);
    for (const c of state.changes) {
        out.push(...c.files.map((f) => f.path), ...c.doclines.map((d) => d.doc));
        if (c.conflictfile) out.push(c.conflictfile);
        const op = c.op;
        out.push(
            ...[op.folder, op.indexfolder, op.tofolder, op.docpath, op.settingspath, op.settingsvalue].filter(Boolean)
        );
    }
    return out;
}

describe("memoryFileName mirrors pkg/memhygiene FileName", () => {
    it("matches the Go test's fixed example", () => {
        expect(memoryFileName("SIEM/a b:c")).toBe("SIEM_a_b_c-5e870e11.json");
    });

    it("keeps names that differ only in unsafe characters apart", () => {
        const names = ["a/b", "a:b", "a b", "a*b"].map(memoryFileName);
        expect(new Set(names).size).toBe(4);
        for (const n of names) expect(n).not.toMatch(/[\\/:*?"<>| ]/);
    });

    it("cuts the stem to 60 characters before the hash", () => {
        expect(memoryFileName("x".repeat(80))).toMatch(/^x{60}-[0-9a-f]{8}\.json$/);
    });
});

describe("buildMemoryFixture", () => {
    it("writes only under its temp root and names no path outside it", () => {
        const root = fxRoot;
        expect(fx.written.length).toBeGreaterThan(0);
        for (const p of fx.written) expect(under(root, p), p).toBe(true);
        for (const { path } of fx.projects) expect(under(root, path), path).toBe(true);
        for (const state of Object.values(fx.states)) {
            for (const p of statePaths(state)) expect(under(root, p), `${state.project}: ${p}`).toBe(true);
        }
        expect(JSON.stringify(fx.states)).not.toContain(join(homedir(), ".claude"));
    });

    it("hashes every file a change names as it is on disk, and ids the change the way the backend does", () => {
        const changes = Object.values(fx.states).flatMap((s) => s.changes);
        expect(changes.length).toBe(20);
        for (const c of changes) {
            for (const f of c.files) {
                // a conflict's file was edited after the check, so it no longer matches its hash
                if (c.status === "conflict") {
                    expect(f.sha256, f.path).not.toBe(sha256File(f.path));
                } else {
                    expect(f.sha256, f.path).toBe(sha256File(f.path));
                }
                // "" = must not exist yet
                expect(existsSync(f.path), f.path).toBe(f.sha256 !== "");
            }
            expect(c.id).toBe(memoryChangeId(c.kind, c.files));
        }
        // a changed hash is a different change
        const [first] = changes;
        expect(memoryChangeId(first.kind, [{ ...first.files[0], sha256: "0".repeat(64) }])).not.toBe(first.id);
    });

    it("measures each index the way the backend does", () => {
        const own = fx.states[MEMORY_PROJECTS.own];
        expect(own.index).toEqual(indexStats(fx.paths.ownIndex));
        expect(own.index).toEqual({ exists: true, lines: 13, bytes: readFileSync(fx.paths.ownIndex).length });
        expect(fx.states[MEMORY_PROJECTS.splitA].ownindex).toEqual({ exists: false, lines: 0, bytes: 0 });
    });

    it("gives the own project five changes, then the card view's, and split-a the split's three groups", () => {
        expect(fx.states[MEMORY_PROJECTS.own].changes.map((c) => c.kind)).toEqual([
            "trim",
            "delete",
            "merge",
            "move-to-doc",
            "add-to-index",
            "review",
            "review",
            "move-to-doc",
            "review",
            "review",
            "review",
            "trim",
        ]);
        expect(fx.states[MEMORY_PROJECTS.splitA].changes.map((c) => `${c.group}:${c.kind}`)).toEqual([
            "shared:move-here",
            "shared:move-here",
            "shared:copy-here",
            "own:delete",
            "switch:settings",
        ]);
        expect(fx.states[MEMORY_PROJECTS.fresh]).toBeUndefined();
        expect(fx.states[MEMORY_PROJECTS.checking].checking).toBe(true);
    });

    it("seeds the card view: a judged-by fallback, an answered Review, an agent proposal, asks and a conflict", () => {
        const own = fx.states[MEMORY_PROJECTS.own];
        const { first, proposed, asking, askError, waiting } = fx.reviews;
        expect(own.judgedby).toBe(MEMORY_JUDGED_BY);

        // the first Review carries its text, the reason section and an ask's answer
        expect(first.body).not.toBe("");
        expect(readFileSync(fx.paths.firstReview, "utf8")).toContain(first.body);
        expect(first.verdict).not.toBe("");
        expect(first.doclines).toHaveLength(2);
        const doc = readFileSync(fx.paths.doc, "utf8").split("\n");
        for (const d of first.doclines) {
            expect(d.doc).toBe(fx.paths.doc);
            expect(d.text).toBe(doc[d.line - 1].trim());
        }
        expect(first.askreason).not.toBe("");
        expect(first.askedby).toBe("claude");
        expect(first.askedat).toBeGreaterThan(own.checkedat);

        // the proposal and its Review name each other; the Review is out of the pending list
        const { proposal } = fx;
        expect(proposal).toMatchObject({ kind: "move-to-doc", source: "agent", status: "open", fromreview: proposed.id });
        expect(proposed).toMatchObject({ status: "superseded", supersededby: proposal.id });
        expect(proposal.diffs.map((d) => d.path)).toEqual(["AGENTS.md", "MEMORY.md", "feedback_commit-pathspec.md"]);
        expect(proposal.files.map((f) => f.path)).toEqual([proposed.files[0].path]);
        expect(proposal.op.docpath).toBe(fx.paths.doc);

        // one ask running (recent, on claude), one waiting behind it, one that failed
        expect(own.asking).toMatchObject({ changeid: asking.id, runtime: "claude" });
        expect(Date.now() - own.asking.startedat).toBeLessThan(30 * 60 * 1000);
        expect(own.askwaiting).toEqual([waiting.id]);
        expect(askError.askerror).toBe(MEMORY_ASK_ERROR);
        expect(waiting.askerror).toBe("");

        // a trim found changed on disk names its file
        expect(fx.conflict).toMatchObject({ kind: "trim", status: "conflict", conflictfile: fx.paths.conflict });

        // every Review's memory is in the index, so a Delete removes its line
        const index = readFileSync(fx.paths.ownIndex, "utf8");
        for (const r of Object.values(fx.reviews)) expect(index).toContain(`](${r.op.memories[0]})`);
    });

    it("gives the done project one change, decided after its check", () => {
        const done = fx.states[MEMORY_PROJECTS.done];
        expect(done.changes).toEqual([fx.doneReview]);
        expect(fx.doneReview.status).toBe("applied");
        expect(fx.doneReview.decidedat).toBeGreaterThanOrEqual(done.checkedat);
        expect(done.index).toEqual(indexStats(fx.paths.doneIndex));
    });

    it("leaves every change with the wire's fields, and every project with its ask fields", () => {
        for (const s of Object.values(fx.states)) {
            expect(s.askwaiting, s.project).toBeInstanceOf(Array);
            expect(typeof s.judgedby, s.project).toBe("string");
            for (const c of s.changes) {
                expect(c.doclines, c.id).toBeInstanceOf(Array);
                for (const k of ["body", "verdict", "source", "fromreview", "supersededby", "askreason", "askedby", "askerror"]) {
                    expect(typeof c[k], `${c.id} ${k}`).toBe("string");
                }
                for (const k of ["proposedat", "askedat"]) expect(typeof c[k], `${c.id} ${k}`).toBe("number");
            }
        }
    });

    it("has a trim whose passage occurs once in a crlf file", () => {
        const text = readFileSync(fx.paths.trim, "utf8");
        expect(text).toContain("\r\n");
        expect(text.split(fx.trim.old).length).toBe(2);
    });
});

describe("writeMemoryStates", () => {
    it("writes each state under <data dir>/memhygiene and nothing else", () => {
        const dataDir = tempRoot("memory-fixtures-data-");
        const paths = writeMemoryStates(dataDir, fx.states);
        expect(readdirSync(dataDir)).toEqual(["memhygiene"]);
        const names = Object.keys(fx.states);
        expect(readdirSync(join(dataDir, "memhygiene")).sort()).toEqual(names.map(memoryFileName).sort());
        expect(paths).toEqual(names.map((n) => memoryStatePath(dataDir, n)));
        expect(JSON.parse(readFileSync(memoryStatePath(dataDir, MEMORY_PROJECTS.own), "utf8"))).toEqual(
            fx.states[MEMORY_PROJECTS.own]
        );
    });
});

describe("settleMemoryStates", () => {
    it("leaves no change to review and keeps decided ones as they were", () => {
        const settled = settleMemoryStates(fx.states, 1234);
        for (const s of Object.values(settled)) {
            for (const c of s.changes) expect(["applied", "kept"]).toContain(c.status);
        }
        const failed = settled[MEMORY_PROJECTS.failed].changes[0];
        expect(failed).toEqual(fx.states[MEMORY_PROJECTS.failed].changes[0]);
        expect(settled[MEMORY_PROJECTS.own].changes[0].decidedat).toBe(1234);
    });
});
