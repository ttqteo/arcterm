import { mkdirSync, mkdtempSync, rmSync, writeFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { CASES, PASS_TAG, RETIRED_IDS, caseEntry, findLeaks, renderKey, scrubDocs, updateCases } from "./council-bench-cases.mjs";

const root = mkdtempSync(join(tmpdir(), "council-bench-cases-"));
afterAll(() => rmSync(root, { recursive: true, force: true }));

let n = 0;
// a project folder holding the given files ({relative path: text})
function project(files) {
    const dir = join(root, `p${n++}`);
    for (const [rel, text] of Object.entries(files)) {
        mkdirSync(dirname(join(dir, rel)), { recursive: true });
        writeFileSync(join(dir, rel), text);
    }
    return dir;
}

const SUBJECT = "fix(orchestrate): settle ended runs' dags; drop routine log lines";
const KEY = "A retried removal of a held final tree deletes by path, so it can remove the next round's live tree";
const HASH = "5604d611db316052115e90aea544a50015657059";

describe("findLeaks", () => {
    it("finds a planted fix subject and a planted key line, with the file", () => {
        const dir = project({
            "docs/notes.md": `see ${SUBJECT} for the story\n`,
            "pkg/a/a.go": `// ${KEY}\n`,
            "pkg/a/b.go": "package a\n",
        });
        expect(findLeaks(dir, [SUBJECT, KEY])).toEqual([
            { file: "docs/notes.md", needle: SUBJECT },
            { file: "pkg/a/a.go", needle: KEY },
        ]);
    });

    it("passes a clean tree", () => {
        const dir = project({ "docs/notes.md": "settle ended runs\n", "pkg/a/a.go": "package a\n" });
        expect(findLeaks(dir, [SUBJECT, KEY])).toEqual([]);
    });
});

describe("scrubDocs", () => {
    const fixes = [{ hash: HASH, subject: SUBJECT }];

    it("deletes docs that name a fix by subject or by a short hash, and keeps the case's own files and non-docs", () => {
        const dir = project({
            "docs/by-subject.md": `${SUBJECT}\n`,
            "docs/by-hash.md": "landed in 5604d61 last week\n",
            "docs/unrelated.md": "nothing here; deadbeef1 is another commit\n",
            "docs/superpowers/plans/kept.md": `${SUBJECT}\n`,
            "pkg/a/a.go": `// ${SUBJECT}\n`,
        });
        const deleted = scrubDocs(dir, fixes, ["docs/superpowers/plans/kept.md"]);
        expect(deleted).toEqual(["docs/by-hash.md", "docs/by-subject.md"]);
        expect(existsSync(join(dir, "docs/unrelated.md"))).toBe(true);
        expect(existsSync(join(dir, "docs/superpowers/plans/kept.md"))).toBe(true);
        expect(existsSync(join(dir, "pkg/a/a.go"))).toBe(true);
    });
});

describe("updateCases", () => {
    const entries = CASES.map((c) => caseEntry(c, "D:/data"));
    const old = [
        { id: "newcomer", mode: "brainstorm", project: "p/newcomer", extra: "kept" },
        { id: "services-bugs", mode: "review" },
        { id: "agents-bugs", mode: "review" },
        { id: "services-sleep", mode: "brainstorm" },
        { id: "mine", mode: "review", note: "someone else's case" },
    ];

    it("retires 0b's cases, adds the two new ones, and keeps an unknown case and field as they are", () => {
        const out = updateCases(old, entries);
        expect(out.map((c) => c.id)).toEqual([...RETIRED_IDS, "mine", "spec-live-agents", "bugs-orchestrate"]);
        for (const c of out.slice(0, 4)) expect(c.retired).toBe(true);
        expect(out[0]).toEqual({ id: "newcomer", mode: "brainstorm", project: "p/newcomer", extra: "kept", retired: true });
        expect(out[4]).toEqual({ id: "mine", mode: "review", note: "someone else's case" });
        expect(out.slice(5)).toEqual(entries);
        expect(old[0].retired).toBeUndefined();
    });

    it("is idempotent, and a rerun replaces a new case in place while keeping a field it does not own", () => {
        const once = updateCases(old, entries);
        expect(updateCases(once, entries)).toEqual(once);
        const edited = once.map((c) => (c.id === "bugs-orchestrate" ? { ...c, feature: "stale", extra: "kept" } : c));
        const again = updateCases(edited, entries);
        expect(again.map((c) => c.id)).toEqual(once.map((c) => c.id));
        expect(again[6]).toEqual({ ...entries[1], extra: "kept" });
    });

    it("refuses a cases.json that is not a list", () => {
        expect(() => updateCases({ id: "x" }, entries)).toThrow("not a JSON list");
    });
});

describe("the approved cases", () => {
    it("build review entries for group ui-feature with this pass's tag, in forward-slash paths", () => {
        const [spec, bugs] = CASES.map((c) => caseEntry(c, "C:\\data dir\\x"));
        for (const e of [spec, bugs]) {
            expect(e).toMatchObject({ mode: "review", group: "ui-feature", solo_group: "solo-ui", tag: PASS_TAG });
            expect(e.project).toBe(`C:/data dir/x/council-bench-projects/${e.id}`);
            expect(e.key).toBe(`C:/data dir/x/council-bench/keys/${e.id}.md`);
        }
        expect(spec.files.split(",")).toHaveLength(9);
        expect(bugs.files.split(",")).toHaveLength(9);
    });

    it("render keys as K lines the bench's key reader takes", () => {
        expect(renderKey(["first.", "second."])).toBe("K1: first.\nK2: second.\n");
        for (const c of CASES) expect(c.key).toHaveLength(4);
    });
});
