import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import {
    BRAINSTORM_RETIRED_IDS,
    brainstormEntry,
    checkCites,
    checkFiles,
    loadCaseFiles,
    parseArgs,
    parseCite,
    renderBrainstormKey,
    validateCase,
} from "./council-bench-brainstorm-cases.mjs";
import { RETIRED_IDS, updateCases } from "./council-bench-cases.mjs";

const root = mkdtempSync(join(tmpdir(), "council-bench-brainstorm-cases-"));
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

// a valid case; `over` replaces fields
function caseOf(over = {}) {
    return {
        id: "run-pause",
        snapshot: "d04210830^",
        feature_commits: ["d04210830", "abcdef012"],
        feature: "Pausing a run",
        question: "A run holds a lot of RAM while it works. What should pausing it look like?",
        files: ["pkg/a/a.go", "pkg/b/b.go"],
        key: [
            { text: "A paused run still counts against the active limit, so the queue starts no other run in its place.", at: "pkg/a/a.go:3", shows: "func Active(" },
            { text: "The worker slots are held by the run, not by a task.", at: "pkg/b/b.go:2", shows: "slots" },
            { text: "An interrupted run resumes from its saved dag.", at: "pkg/a/a.go:1", shows: "package a" },
            { text: "The memory reading differs per platform.", at: "pkg/b/b.go:1", shows: "package b" },
        ],
        ...over,
    };
}

describe("parseCite", () => {
    it("reads a project-relative path and a line of 1 or more", () => {
        expect(parseCite("pkg/a/a.go:12")).toEqual({ path: "pkg/a/a.go", line: 12 });
        expect(parseCite("frontend/app/x.tsx:1")).toEqual({ path: "frontend/app/x.tsx", line: 1 });
    });

    it.each(["a.go", "a.go:0", "a.go:x", "a.go:-3", ":4", "../a.go:3", "pkg/../a.go:3", "/a.go:3", "C:/a.go:3", "pkg\\a.go:3", "a.go:3 ", undefined, 7])(
        "refuses %s",
        (at) => {
            expect(parseCite(at)).toBeNull();
        },
    );
});

describe("validateCase", () => {
    it("passes a whole case, with and without the file name", () => {
        expect(validateCase(caseOf(), "run-pause.json")).toEqual([]);
        expect(validateCase(caseOf())).toEqual([]);
    });

    it("refuses an id that is not the file's name, or not a safe folder name", () => {
        expect(validateCase(caseOf(), "held-services.json")).toEqual([expect.stringContaining("does not match the file name")]);
        expect(validateCase(caseOf({ id: "../x" }))).toEqual([expect.stringContaining("id")]);
    });

    it("refuses a case with no snapshot, no feature commits, no question, no feature or no files", () => {
        for (const field of ["snapshot", "feature_commits", "question", "feature", "files"]) {
            for (const bad of [undefined, "", "   ", []]) {
                const problems = validateCase(caseOf({ [field]: bad }));
                expect(problems.length, `${field}=${JSON.stringify(bad)}`).toBeGreaterThan(0);
                expect(problems.join("\n")).toContain(field);
            }
        }
    });

    it("refuses a feature commit or a file that is not a plain string, and a file name holding a comma", () => {
        expect(validateCase(caseOf({ feature_commits: ["d04210830", ""] }))).not.toEqual([]);
        expect(validateCase(caseOf({ files: ["pkg/a/a.go", 7] }))).not.toEqual([]);
        expect(validateCase(caseOf({ files: ["pkg/a,b.go"] }))).toEqual([expect.stringContaining("comma")]);
    });

    it("takes 4 to 6 key lines and no fewer or more", () => {
        const key = caseOf().key;
        for (const count of [4, 5, 6]) expect(validateCase(caseOf({ key: Array.from({ length: count }, (_, i) => ({ ...key[i % 4], text: `${key[i % 4].text} (${i})` })) }))).toEqual([]);
        expect(validateCase(caseOf({ key: key.slice(0, 3) }))).toEqual([expect.stringContaining("4 to 6")]);
        expect(validateCase(caseOf({ key: [...key, ...key.slice(0, 3)] }))).toEqual([expect.stringContaining("4 to 6")]);
        expect(validateCase(caseOf({ key: undefined }))).toEqual([expect.stringContaining("key")]);
    });

    it("checks every key line: text, cite and shows", () => {
        const key = caseOf().key;
        const withLine = (i, line) => caseOf({ key: key.map((k, j) => (j === i ? { ...k, ...line } : k)) });
        expect(validateCase(withLine(1, { text: "" }))).toEqual([expect.stringContaining("K2")]);
        expect(validateCase(withLine(1, { text: "two\nlines" }))).toEqual([expect.stringContaining("K2")]);
        expect(validateCase(withLine(2, { at: "pkg/a/a.go" }))).toEqual([expect.stringContaining("K3")]);
        expect(validateCase(withLine(2, { at: "pkg/a/a.go:0" }))).toEqual([expect.stringContaining("K3")]);
        expect(validateCase(withLine(3, { shows: "  " }))).toEqual([expect.stringContaining("K4")]);
        expect(validateCase(withLine(0, { shows: undefined }))).toEqual([expect.stringContaining("K1")]);
    });

    it("refuses a question that holds a key line's text, however it is spaced or cased", () => {
        const key = caseOf().key;
        const q = (s) => caseOf({ question: s });
        expect(validateCase(q(`Please. ${key[1].text} Thanks.`))).toEqual([expect.stringContaining("K2")]);
        expect(validateCase(q(key[0].text.toUpperCase().replaceAll(" ", "  ")))).toEqual([expect.stringContaining("K1")]);
    });

    it("refuses what is not a JSON object", () => {
        for (const bad of [null, [], "x", 3]) expect(validateCase(bad)).toEqual([expect.stringContaining("object")]);
    });
});

describe("checkCites", () => {
    const key = (at, shows) => [{ text: "t", at, shows }];

    it("passes a line that holds its shows text, ignoring surrounding and repeated whitespace", () => {
        const dir = project({ "pkg/a.go": "package a\r\n\r\n\tfunc  Active(x int)  bool {\r\n}\r\n" });
        expect(checkCites(dir, key("pkg/a.go:3", "func Active(x int) bool"))).toEqual([]);
        expect(checkCites(dir, key("pkg/a.go:1", "  package a  "))).toEqual([]);
    });

    it("reports a missing file, a line past the end and a line that does not hold the text, each with its line's name", () => {
        const dir = project({ "pkg/a.go": "package a\nfunc A() {}\n" });
        const out = checkCites(dir, [
            { text: "t", at: "pkg/gone.go:1", shows: "x" },
            { text: "t", at: "pkg/a.go:3", shows: "x" },
            { text: "t", at: "pkg/a.go:2", shows: "func B" },
            { text: "t", at: "pkg/a.go:2", shows: "func A" },
        ]);
        expect(out).toEqual([
            { id: "K1", at: "pkg/gone.go:1", problem: "the file is missing" },
            { id: "K2", at: "pkg/a.go:3", problem: "line 3 is past the end (the file has 2 lines)" },
            { id: "K3", at: "pkg/a.go:2", problem: 'line 2 does not hold "func B"' },
        ]);
    });

    it("counts a file's lines without the empty one after its last newline, and counts one with none", () => {
        const dir = project({ "a.txt": "one\ntwo\n", "b.txt": "one\ntwo" });
        expect(checkCites(dir, key("a.txt:2", "two"))).toEqual([]);
        expect(checkCites(dir, key("a.txt:3", "two"))).toEqual([expect.objectContaining({ problem: expect.stringContaining("past the end") })]);
        expect(checkCites(dir, key("b.txt:2", "two"))).toEqual([]);
    });

    it("reports a folder, and a cite that is not a path:line, instead of throwing", () => {
        const dir = project({ "pkg/a.go": "x\n" });
        expect(checkCites(dir, key("pkg:1", "x"))).toEqual([expect.objectContaining({ id: "K1", problem: expect.stringContaining("cannot be read") })]);
        expect(checkCites(dir, key("pkg/a.go", "x"))).toEqual([expect.objectContaining({ id: "K1", problem: expect.stringContaining("path:line") })]);
    });
});

describe("checkFiles", () => {
    it("returns the paths of the case's files that are not in the copy, in the case's order", () => {
        const dir = project({ "pkg/a.go": "x\n", "pkg/b/b.go": "y\n" });
        expect(checkFiles(dir, ["pkg/a.go", "pkg/gone.go", "pkg/b/b.go", "docs/spec.md"])).toEqual(["pkg/gone.go", "docs/spec.md"]);
        expect(checkFiles(dir, ["pkg/a.go", "pkg/b/b.go"])).toEqual([]);
        expect(checkFiles(dir, [])).toEqual([]);
    });

    it("counts a folder, and a path that climbs out of the copy, as missing: a case file is a file inside the project", () => {
        const dir = project({ "pkg/a.go": "x\n" });
        expect(checkFiles(dir, ["pkg", "../p0/pkg/a.go", "/etc/hosts"])).toEqual(["pkg", "../p0/pkg/a.go", "/etc/hosts"]);
    });
});

describe("renderBrainstormKey", () => {
    // keyLineRe in pkg/council/bench/cases.go, which the judge reads a key file with
    const keyLineRe = /^\s*(?:[-*]\s+)?(K\d+)\s*:\s*(.+?)\s*$/;

    it("writes a K line and its indented cite per key line", () => {
        const key = [
            { text: "First line.", at: "pkg/a.go:3", shows: "x" },
            { text: "Second line.", at: "pkg/b.go:10", shows: "y" },
        ];
        expect(renderBrainstormKey(key)).toBe("K1: First line.\n    at pkg/a.go:3\nK2: Second line.\n    at pkg/b.go:10\n");
    });

    it("gives the judge's key reader the K lines only: the cites never match", () => {
        const key = caseOf().key;
        const lines = renderBrainstormKey(key).split("\n");
        const read = lines.map((l) => keyLineRe.exec(l)).filter(Boolean);
        expect(read.map((m) => [m[1], m[2]])).toEqual(key.map((k, i) => [`K${i + 1}`, k.text]));
        for (const l of lines.filter((l) => l.startsWith("    at "))) expect(keyLineRe.test(l)).toBe(false);
        expect(lines.filter((l) => l.startsWith("    at "))).toHaveLength(key.length);
    });
});

describe("brainstormEntry", () => {
    it("builds a brainstorm entry for the ui-feature panels, with forward-slash paths under the data dir", () => {
        const e = brainstormEntry(caseOf(), "C:\\data dir\\x");
        expect(e).toEqual({
            id: "run-pause",
            mode: "brainstorm",
            project: "C:/data dir/x/council-bench-projects/run-pause",
            group: "ui-feature",
            solo_group: "solo-ui",
            feature: "Pausing a run",
            question: caseOf().question,
            files: "pkg/a/a.go,pkg/b/b.go",
            key: "C:/data dir/x/council-bench/keys/run-pause.md",
        });
        expect(Object.keys(e)).toEqual(["id", "mode", "project", "group", "solo_group", "feature", "question", "files", "key"]);
    });

    it("carries no tag: the verdict on the council against the agent team reads only the tagged cases", () => {
        expect(brainstormEntry(caseOf(), "D:/data").tag).toBeUndefined();
    });
});

describe("updateCases with the Brainstorm cases", () => {
    const entries = ["run-pause", "held-services"].map((id) => brainstormEntry(caseOf({ id }), "D:/data"));
    const old = [
        { id: "newcomer", mode: "brainstorm", retired: true },
        { id: "spec-live-agents", mode: "review", tag: "team-bench-2026-11" },
        { id: "launcher-declutter", mode: "brainstorm", project: "p/launcher", extra: "kept" },
        { id: "run-pause", mode: "brainstorm", project: "old", note: "kept" },
    ];

    it("retires launcher-declutter alone, replaces run-pause in place and appends the new case", () => {
        const out = updateCases(old, entries, BRAINSTORM_RETIRED_IDS);
        expect(BRAINSTORM_RETIRED_IDS).toEqual(["launcher-declutter"]);
        expect(out.map((c) => c.id)).toEqual(["newcomer", "spec-live-agents", "launcher-declutter", "run-pause", "held-services"]);
        expect(out[2]).toEqual({ id: "launcher-declutter", mode: "brainstorm", project: "p/launcher", extra: "kept", retired: true });
        expect(out[3]).toEqual({ ...entries[0], note: "kept" });
        expect(out[4]).toEqual(entries[1]);
        expect(out[1].retired).toBeUndefined();
        expect(old[2].retired).toBeUndefined();
    });

    it("leaves Phase 0b's cases as they are (the Review script retires them) and is idempotent", () => {
        const out = updateCases([{ id: RETIRED_IDS[0], mode: "brainstorm" }], entries, BRAINSTORM_RETIRED_IDS);
        expect(out[0]).toEqual({ id: RETIRED_IDS[0], mode: "brainstorm" });
        const once = updateCases(old, entries, BRAINSTORM_RETIRED_IDS);
        expect(updateCases(once, entries, BRAINSTORM_RETIRED_IDS)).toEqual(once);
    });
});

describe("parseArgs", () => {
    it("reads the flags", () => {
        expect(parseArgs([])).toEqual({ dataDir: null, dryRun: false, check: null });
        expect(parseArgs(["--dry-run", "--data-dir", "D:/d"])).toEqual({ dataDir: "D:/d", dryRun: true, check: null });
        expect(parseArgs(["--check", "run-pause", "held-services"]).check).toEqual(["run-pause", "held-services"]);
        expect(parseArgs(["--check", "run-pause", "--dry-run"])).toEqual({ dataDir: null, dryRun: true, check: ["run-pause"] });
    });

    it("takes --check with no id as every case", () => {
        expect(parseArgs(["--check"]).check).toEqual([]);
    });

    it("refuses an unknown flag, a --data-dir with no path, and --check with a data dir", () => {
        expect(() => parseArgs(["--nope"])).toThrow("unknown argument --nope");
        expect(() => parseArgs(["--data-dir"])).toThrow("needs a path");
        expect(() => parseArgs(["--check", "x", "--data-dir", "D:/d"])).toThrow("never touches the data dir");
    });
});

describe("loadCaseFiles", () => {
    it("reads each .json file by name, in order, and ignores other files; a missing folder holds no cases", () => {
        const dir = project({
            "b.json": JSON.stringify({ id: "b" }),
            "a.json": JSON.stringify({ id: "a" }),
            "README.md": "# not a case\n",
        });
        expect(loadCaseFiles(dir)).toEqual([
            { file: "a.json", c: { id: "a" } },
            { file: "b.json", c: { id: "b" } },
        ]);
        expect(loadCaseFiles(join(root, "no-such-folder"))).toEqual([]);
    });

    it("reads a file that starts with a byte order mark", () => {
        const dir = project({ "a.json": String.fromCharCode(0xfeff) + JSON.stringify({ id: "a" }) });
        expect(loadCaseFiles(dir)).toEqual([{ file: "a.json", c: { id: "a" } }]);
    });

    it("names the file whose JSON cannot be parsed", () => {
        const dir = project({ "bad.json": "{ not json" });
        expect(() => loadCaseFiles(dir)).toThrow("bad.json");
    });
});

describe("the committed Brainstorm case files", () => {
    it("each passes validateCase (an empty or missing folder passes: the files arrive with the case tasks)", () => {
        for (const { file, c } of loadCaseFiles()) {
            expect(validateCase(c, file), file).toEqual([]);
        }
    });
});
