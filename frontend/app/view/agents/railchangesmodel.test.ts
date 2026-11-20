// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { describe, expect, it } from "vitest";
import type { DiffLine } from "./agentsviewmodel";
import type { GitChange } from "./gitstatus";
import {
    anyFileOpen,
    changesGroups,
    changesSegments,
    hunkWalk,
    isCitedRow,
    isFileOpen,
    NONE_OPEN,
    openFile,
    splitHunks,
    stepHunk,
    stepInto,
    toggleAll,
    toggleFile,
    toggleFolder,
    type ChangesOpen,
} from "./railchangesmodel";
import { parseUnifiedDiff } from "./unifieddiff";

const change = (path: string, status = "M"): GitChange => ({ path, status, adds: 1, dels: 0 });
const patchOf = (...parts: string[]) => parseUnifiedDiff(parts.join("\n"));
const modified = (path: string, ...hunks: string[]) =>
    [`diff --git a/${path} b/${path}`, `--- a/${path}`, `+++ b/${path}`, ...hunks].join("\n");
const opts = { truncated: false, ignoreWs: false };

describe("the groups the tab draws", () => {
    const files = [
        change("src/b.ts"),
        change("README.md"),
        change("pkg/x/z.go"),
        change("src/a.ts"),
        change("go.mod"),
        change("pkg/x/a.go"),
    ];
    const groups = changesGroups(files, null, opts);

    it("puts root files first, then one group per directory by path, files by name", () => {
        expect(groups.map((g) => [g.dir, g.files.map((f) => f.name)])).toEqual([
            ["", ["README.md", "go.mod"]],
            ["pkg/x", ["a.go", "z.go"]],
            ["src", ["a.ts", "b.ts"]],
        ]);
    });

    it("counts each group's files", () => {
        expect(groups.map((g) => g.count)).toEqual(["2 files", "2 files", "2 files"]);
        expect(changesGroups([change("a/b.ts")], null, opts)[0].count).toBe("1 file");
    });
});

describe("a file's facts", () => {
    const [root] = changesGroups(
        [change("a.ts", "M"), change("b.ts", "D"), change("c.ts", "A"), change("d.ts", "?"), change("e.ts", "R")],
        null,
        opts
    );
    const by = (name: string) => root.files.find((f) => f.name === name);

    it("reads an added or untracked file as a new file, letter A", () => {
        expect([by("c.ts")?.isNew, by("c.ts")?.letter]).toEqual([true, "A"]);
        expect([by("d.ts")?.isNew, by("d.ts")?.letter]).toEqual([true, "A"]);
        expect([by("a.ts")?.isNew, by("a.ts")?.letter]).toEqual([false, "M"]);
        expect(by("e.ts")?.letter).toBe("R");
    });

    it("starts every file closed, new or not", () => {
        for (const f of root.files) {
            expect(isFileOpen(NONE_OPEN, f.change.path)).toBe(false);
        }
    });
});

describe("which files are open", () => {
    const opened = (s: ChangesOpen) =>
        Object.entries(s.open)
            .filter(([, v]) => v)
            .map(([p]) => p)
            .sort();

    it("a header toggle flips the file, and forgets it only when it was the step-opened one", () => {
        const s = toggleFile(NONE_OPEN, "a.ts");
        expect(isFileOpen(s, "a.ts")).toBe(true);
        expect(isFileOpen(toggleFile(s, "a.ts"), "a.ts")).toBe(false);
        const stepped = stepInto(NONE_OPEN, "b.ts");
        expect(toggleFile(stepped, "a.ts").stepOpened).toBe("b.ts");
        expect(toggleFile(stepped, "b.ts")).toEqual({ open: { "b.ts": false }, stepOpened: null });
    });

    it("a step opens a closed file and remembers it; the next step into another file closes it", () => {
        const one = stepInto(NONE_OPEN, "a.ts");
        expect(one).toEqual({ open: { "a.ts": true }, stepOpened: "a.ts" });
        const two = stepInto(one, "b.ts");
        expect(opened(two)).toEqual(["b.ts"]);
        expect(two.stepOpened).toBe("b.ts");
    });

    it("a step into the same file's next hunk keeps it open and remembered", () => {
        const one = stepInto(NONE_OPEN, "a.ts");
        expect(stepInto(one, "a.ts")).toEqual(one);
    });

    it("a step into a file already open remembers nothing, so the next step leaves it open", () => {
        const user = toggleFile(NONE_OPEN, "a.ts");
        const into = stepInto(stepInto(user, "a.ts"), "b.ts");
        expect(opened(into)).toEqual(["a.ts", "b.ts"]);
        expect(into.stepOpened).toBe("b.ts");
    });

    it("opening a file makes it the user's: a step-opened file is forgotten and stays open", () => {
        const s = openFile(stepInto(NONE_OPEN, "a.ts"), "a.ts");
        expect(s).toEqual({ open: { "a.ts": true }, stepOpened: null });
        expect(opened(stepInto(s, "b.ts"))).toEqual(["a.ts", "b.ts"]);
        expect(openFile(stepInto(NONE_OPEN, "b.ts"), "a.ts").stepOpened).toBe("b.ts");
    });

    it("a folder toggle opens every file in it when none is open, else closes them all", () => {
        const folder = ["src/a.ts", "src/b.ts"];
        const all = toggleFolder(NONE_OPEN, folder);
        expect(opened(all)).toEqual(folder);
        const one = toggleFile(NONE_OPEN, "src/b.ts");
        expect(opened(toggleFolder(one, folder))).toEqual([]);
        expect(opened(toggleFolder(toggleFile(one, "x.ts"), folder))).toEqual(["x.ts"]);
    });

    it("a folder toggle forgets the step-opened file only when it is in that folder", () => {
        const stepped = stepInto(NONE_OPEN, "lib/c.ts");
        expect(toggleFolder(stepped, ["src/a.ts"]).stepOpened).toBe("lib/c.ts");
        const own = toggleFolder(stepped, ["lib/c.ts", "lib/d.ts"]);
        expect(own.stepOpened).toBeNull();
        expect(opened(own)).toEqual([]);
    });

    it("toggling all opens every listed file, new ones too, or closes every one, and always forgets the step", () => {
        const listed = ["a.ts", "lib/n.ts", "src/b.ts"];
        // a step-opened file that is no longer listed does not count as open, so this expands
        const expanded = toggleAll(stepInto(NONE_OPEN, "zz.ts"), listed);
        expect(opened(expanded)).toEqual([...listed, "zz.ts"]);
        expect(expanded.stepOpened).toBeNull();
        expect(opened(stepInto(expanded, "a.ts"))).toEqual([...listed, "zz.ts"]);
        const collapsed = toggleAll(stepInto(NONE_OPEN, "a.ts"), listed);
        expect(opened(collapsed)).toEqual([]);
        expect(collapsed.stepOpened).toBeNull();
    });

    it("counts as any open only the listed files", () => {
        const stale = toggleFile(NONE_OPEN, "gone.ts");
        expect(anyFileOpen(stale, ["a.ts"])).toBe(false);
        expect(anyFileOpen(toggleFile(stale, "a.ts"), ["a.ts"])).toBe(true);
        expect(opened(toggleAll(stale, ["a.ts"]))).toEqual(["a.ts", "gone.ts"]);
    });
});

describe("a group's list boxes and cards", () => {
    const [root] = changesGroups([change("a.ts"), change("b.ts"), change("c.ts"), change("d.ts")], null, opts);
    const shape = (s: ChangesOpen) =>
        changesSegments(root.files, s).map((seg) =>
            seg.kind === "list" ? seg.files.map((f) => f.name) : `card ${seg.file.name}`
        );

    it("runs every closed file together as one list box", () => {
        expect(shape(NONE_OPEN)).toEqual([["a.ts", "b.ts", "c.ts", "d.ts"]]);
    });

    it("splits the list where an open file is, the open file a card of its own", () => {
        expect(shape(toggleFile(NONE_OPEN, "b.ts"))).toEqual([["a.ts"], "card b.ts", ["c.ts", "d.ts"]]);
        expect(shape(toggleFile(toggleFile(NONE_OPEN, "a.ts"), "b.ts"))).toEqual([
            "card a.ts",
            "card b.ts",
            ["c.ts", "d.ts"],
        ]);
        expect(shape(toggleAll(NONE_OPEN, ["a.ts", "b.ts", "c.ts", "d.ts"]))).toEqual([
            "card a.ts",
            "card b.ts",
            "card c.ts",
            "card d.ts",
        ]);
    });
});

describe("a file's hunks", () => {
    it("labels a hunk with the text after its second @@", () => {
        const patch = patchOf(modified("a.go", "@@ -40,7 +41,11 @@ func Groups(bs []Bookmark)", "-a", "+b"));
        const [g] = changesGroups([change("a.go")], patch, opts);
        expect(g.files[0].body).toBe("hunks");
        expect(g.files[0].hunks).toHaveLength(1);
        expect(g.files[0].hunks[0]).toMatchObject({ label: "func Groups(bs []Bookmark)", newStart: 41 });
        expect(g.files[0].hunks[0].rows.map((r) => [r.sign, r.text])).toEqual([
            ["-", "a"],
            ["+", "b"],
        ]);
    });

    it("labels a hunk git found no context for by its line", () => {
        const patch = patchOf(modified("a.go", "@@ -40,1 +41,1 @@", "-a", "+b"));
        expect(changesGroups([change("a.go")], patch, opts)[0].files[0].hunks[0].label).toBe("line 41");
    });

    it("labels a deleted file's hunk by the old side's line", () => {
        const patch = patchOf(
            "diff --git a/gone.go b/gone.go",
            "deleted file mode 100644",
            "--- a/gone.go",
            "+++ /dev/null",
            "@@ -1,2 +0,0 @@",
            "-x",
            "-y"
        );
        const hunk = changesGroups([change("gone.go", "D")], patch, opts)[0].files[0].hunks[0];
        expect(hunk.label).toBe("line 1");
        expect(hunk.newStart).toBe(0);
    });

    it("splits a file's lines at each hunk header", () => {
        const patch = patchOf(modified("a.go", "@@ -1 +1 @@ one", "-a", "+b", "@@ -9 +9,2 @@ two", " c", "+d"));
        const hunks = changesGroups([change("a.go")], patch, opts)[0].files[0].hunks;
        expect(hunks.map((h) => [h.label, h.newStart, h.rows.length])).toEqual([
            ["one", 1, 2],
            ["two", 9, 2],
        ]);
    });

    it("draws a new file's hunk with no label and numbered rows with no sign", () => {
        const patch = patchOf(
            "diff --git a/new.go b/new.go",
            "new file mode 100644",
            "--- /dev/null",
            "+++ b/new.go",
            "@@ -0,0 +1,2 @@",
            "+package a",
            "+// new"
        );
        const hunk = changesGroups([change("new.go", "?")], patch, opts)[0].files[0].hunks[0];
        expect(hunk.label).toBeNull();
        expect(hunk.rows.map((r) => [r.sign, r.text, r.newNo])).toEqual([
            ["", "package a", 1],
            ["", "// new", 2],
        ]);
    });
});

describe("splitting diff lines into hunks", () => {
    const head = (text: string): DiffLine => ({ sign: "", text, hunk: true });

    it("labels a hunk by git's context, or by its line when there is none", () => {
        const hunks = splitHunks(
            [
                head("@@ -40,7 +41,11 @@ func Groups()"),
                { sign: "+", text: "b", newNo: 41 },
                head("@@ -90,2 +95,2 @@"),
                { sign: "", text: "c", oldNo: 90, newNo: 95 },
            ],
            false
        );
        expect(hunks.map((h) => [h.label, h.newStart, h.rows.length])).toEqual([
            ["func Groups()", 41, 1],
            ["line 95", 95, 1],
        ]);
    });

    it("gives a new file's hunk no label and rows with no sign", () => {
        const [hunk] = splitHunks([head("@@ -0,0 +1,1 @@"), { sign: "+", text: "x", newNo: 1 }], true);
        expect(hunk.label).toBeNull();
        expect(hunk.rows).toEqual([{ sign: "", text: "x", newNo: 1 }]);
    });
});

describe("which row is the cited one", () => {
    const added: DiffLine = { sign: "+", text: "a", newNo: 12 };
    const context: DiffLine = { sign: "", text: "c", oldNo: 11, newNo: 12 };
    const removed: DiffLine = { sign: "-", text: "r", oldNo: 12 };

    it("is an added or context row numbered the cited line", () => {
        expect(isCitedRow(added, 12)).toBe(true);
        expect(isCitedRow(context, 12)).toBe(true);
    });

    it("is not a removed row, whose number is the old side's", () => {
        expect(isCitedRow(removed, 12)).toBe(false);
    });

    it("is not a row of another number", () => {
        expect(isCitedRow(added, 13)).toBe(false);
    });

    it("is no row when nothing is cited", () => {
        expect(isCitedRow(added, null)).toBe(false);
        expect(isCitedRow(added, undefined)).toBe(false);
    });
});

describe("a file's body", () => {
    const bodyOf = (patch: ReturnType<typeof patchOf>, o = opts) =>
        changesGroups([change("a.go")], patch, o)[0].files[0].body;
    const patchA = patchOf(modified("a.go", "@@ -1 +1 @@", "-a", "+b"));
    const binary = patchOf("diff --git a/a.go b/a.go", "Binary files a/a.go and b/a.go differ");
    const noHunks = patchOf("diff --git a/a.go b/a.go", "old mode 100644", "new mode 100755");
    // sorts before a.go, so a cut after it leaves a.go out
    const before = patchOf(modified("0.go", "@@ -1 +1 @@", "-a", "+b"));

    it("is loading while the first read is pending", () => {
        expect(bodyOf(null)).toBe("loading");
    });

    it("is hunks, or binary", () => {
        expect(bodyOf(patchA)).toBe("hunks");
        expect(bodyOf(binary)).toBe("binary");
    });

    it("is too large for a file past the cut, never loading", () => {
        expect(bodyOf(before, { ...opts, truncated: true })).toBe("toolarge");
        expect(bodyOf([], { ...opts, truncated: true })).toBe("toolarge");
    });

    // git -w leaves a whitespace-only file out of the patch altogether, so a missing file is cut only when it would
    // come after the patch's last entry: the tracked diff by path, then the untracked files by path
    it("is whitespace, not too large, for a file the cut did not reach", () => {
        const files = [change("a.go"), change("b.go"), change("z.go", "?")];
        const patch = patchOf(modified("b.go", "@@ -1 +1 @@", "-a", "+b"));
        const bodies = changesGroups(files, patch, { truncated: true, ignoreWs: true })[0].files.map((f) => f.body);
        expect(bodies).toEqual(["whitespace", "hunks", "toolarge"]);
    });

    it("orders untracked files after every tracked one when placing the cut", () => {
        const files = [change("z.go"), change("a.go", "?")];
        const patch = patchOf(modified("z.go", "@@ -1 +1 @@", "-a", "+b"));
        const bodies = changesGroups(files, patch, { truncated: true, ignoreWs: false })[0].files.map((f) => f.body);
        expect(bodies).toEqual(["toolarge", "hunks"]);
    });

    it("is whitespace when hiding it leaves no hunks, and empty otherwise", () => {
        expect(bodyOf([], { ...opts, ignoreWs: true })).toBe("whitespace");
        expect(bodyOf(noHunks, { ...opts, ignoreWs: true })).toBe("whitespace");
        expect(bodyOf([])).toBe("empty");
        expect(bodyOf(noHunks)).toBe("empty");
    });
});

describe("the hunk walk", () => {
    const patch = patchOf(
        modified("b.go", "@@ -1 +1 @@", "-a", "+b", "@@ -9 +9 @@", "-c", "+d"),
        modified("src/a.go", "@@ -1 +1 @@", "-a", "+b"),
        modified("a.go", "@@ -1 +1 @@", "-a", "+b")
    );
    const files = [change("b.go"), change("src/a.go"), change("a.go", "?")];
    const groups = changesGroups(files, patch, opts);

    it("lists every hunk of every file in display order, closed files included", () => {
        expect(hunkWalk(groups)).toEqual([
            { path: "a.go", hunk: 0 },
            { path: "b.go", hunk: 0 },
            { path: "b.go", hunk: 1 },
            { path: "src/a.go", hunk: 0 },
        ]);
    });

    it("is empty with no hunks", () => {
        expect(hunkWalk(changesGroups(files, null, opts))).toEqual([]);
    });
});

describe("stepping the change counter", () => {
    it("goes from none yet to the first on next and to the last on previous", () => {
        expect(stepHunk(0, 4, "next")).toBe(1);
        expect(stepHunk(0, 4, "previous")).toBe(4);
    });

    it("steps by one and wraps at both ends", () => {
        expect(stepHunk(2, 4, "next")).toBe(3);
        expect(stepHunk(2, 4, "previous")).toBe(1);
        expect(stepHunk(4, 4, "next")).toBe(1);
        expect(stepHunk(1, 4, "previous")).toBe(4);
    });

    it("stays at none with nothing to step to", () => {
        expect(stepHunk(0, 0, "next")).toBe(0);
        expect(stepHunk(0, 0, "previous")).toBe(0);
    });
});
