// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { describe, expect, it } from "vitest";
import type { AgentActionEntry, EditFile } from "./agentsviewmodel";
import type { AgentPart } from "./chatmodel";
import {
    editCounts,
    fileWhere,
    foldOf,
    foreignPathGuesses,
    MAX_STEP_CHIPS,
    pictureOf,
    stepElapsed,
    stepOf,
    stepRows,
    stretchPictures,
    turnFileAbs,
    turnFiles,
} from "./chatsteps";

const action = (verb: string, extra: Partial<AgentActionEntry> = {}): AgentActionEntry => ({
    kind: "action",
    verb,
    target: `${verb}-target`,
    ...extra,
});

const file = (path: string): EditFile => ({
    path,
    badge: "M",
    adds: 1,
    dels: 0,
    lines: [{ sign: "+", text: "x" }],
});

describe("stepElapsed", () => {
    it("counts whole seconds, then minutes", () => {
        expect(stepElapsed(-5)).toBe("0s");
        expect(stepElapsed(12_900)).toBe("12s");
        expect(stepElapsed(185_000)).toBe("3m 5s");
        expect(stepElapsed(120_000)).toBe("2m");
    });
});

describe("stepOf", () => {
    it("reads: the verb Read, a file chip on the full path, its summary as the meta", () => {
        const s = stepOf(
            action("read", { target: "a.ts", path: "/repo/src/a.ts", outcome: "ok", summary: "25 lines" }),
            false
        );
        expect(s).toEqual({
            verb: "Read",
            chips: [{ kind: "file", path: "/repo/src/a.ts" }],
            more: 0,
            meta: "25 lines",
            command: false,
            running: false,
            failed: false,
        });
    });

    it("a running call says its verb in the present tense", () => {
        expect(stepOf(action("read", { target: "a.ts" }), true).verb).toBe("Reading");
        expect(stepOf(action("edited", { target: "a.ts" }), true).verb).toBe("Editing");
        expect(stepOf(action("wrote", { target: "a.ts" }), true).verb).toBe("Creating");
        expect(stepOf(action("mcp__x__y", { target: "" }), true).verb).toBe("Using");
    });

    it("a failed call says so in its verb, its error as the meta; a refused one is Blocked", () => {
        const failed = stepOf(
            action("edited", {
                target: "server.js",
                outcome: "fail",
                note: "String to replace not found in file.",
                summary: "x",
            }),
            false
        );
        expect(failed).toMatchObject({
            verb: "Edit failed",
            failed: true,
            meta: "String to replace not found in file.",
        });
        expect(stepOf(action("read", { outcome: "fail", summary: "no such file" }), false)).toMatchObject({
            verb: "Read failed",
            meta: "no such file",
        });
        expect(stepOf(action("mcp__x__y", { outcome: "fail" }), false).verb).toBe("Tool failed");
        expect(stepOf(action("edited", { outcome: "blocked" }), false)).toMatchObject({
            verb: "Blocked",
            failed: false,
        });
    });

    it("falls back to the target as the file when the transcript gave no full path", () => {
        const s = stepOf(action("read", { target: "a.ts" }), false);
        expect(s.chips).toEqual([{ kind: "file", path: "a.ts" }]);
    });

    it("edits: one chip per file in the call, at most three, the rest counted in more", () => {
        const one = stepOf(
            action("edited", { target: "a.ts", path: "/r/a.ts", detail: { kind: "edit", files: [file("/r/a.ts")] } }),
            false
        );
        expect(one.verb).toBe("Edited");
        expect(one.chips).toEqual([{ kind: "file", path: "/r/a.ts" }]);
        expect(one.more).toBe(0);

        const many = stepOf(
            action("edited", {
                detail: { kind: "edit", files: ["a", "b", "c", "d", "e"].map((n) => file(`/r/${n}.ts`)) },
            }),
            false
        );
        expect(many.chips).toHaveLength(MAX_STEP_CHIPS);
        expect(many.chips.map((c) => (c.kind === "file" ? c.path : null))).toEqual(["/r/a.ts", "/r/b.ts", "/r/c.ts"]);
        expect(many.more).toBe(2);
    });

    it("edits: the same path twice in one call is one chip", () => {
        const s = stepOf(
            action("edited", { detail: { kind: "edit", files: [file("/r/a.ts"), file("/r/a.ts"), file("/r/b.ts")] } }),
            false
        );
        expect(s.chips).toEqual([
            { kind: "file", path: "/r/a.ts" },
            { kind: "file", path: "/r/b.ts" },
        ]);
        expect(s.more).toBe(0);
    });

    it("writes: the verb Created, a file chip", () => {
        const s = stepOf(action("wrote", { target: "n.ts", path: "/r/n.ts" }), false);
        expect(s.verb).toBe("Created");
        expect(s.chips).toEqual([{ kind: "file", path: "/r/n.ts" }]);
    });

    it("runs: a command with no description is a command row of its first line, no verb, before and after the result", () => {
        const done = stepOf(
            action("ran", {
                target: "npx vitest run sticktobottom",
                outcome: "ok",
                detail: { kind: "bash", command: "npx vitest run sticktobottom", output: "18 passed", exit: 0 },
            }),
            false
        );
        expect(done.verb).toBe("");
        expect(done.command).toBe(true);
        expect(done.chips).toEqual([{ kind: "command", text: "npx vitest run sticktobottom" }]);

        // before the result lands there is no detail: the target (pi, codex, opencode: the command) stands in
        const pending = stepOf(action("ran", { target: "go build ./..." }), true);
        expect(pending.verb).toBe("");
        expect(pending.command).toBe(true);
        expect(pending.chips).toEqual([{ kind: "command", text: "go build ./..." }]);
    });

    it("runs: a command with a description shows the description in place of the verb, before and after the result", () => {
        const done = stepOf(
            action("ran", {
                target: "Run the tests",
                command: "npx vitest run sticktobottom",
                outcome: "ok",
                detail: { kind: "bash", command: "npx vitest run sticktobottom", output: "18 passed", exit: 0 },
            }),
            false
        );
        expect(done.verb).toBe("");
        expect(done.command).toBe(true);
        expect(done.chips).toEqual([
            { kind: "description", text: "Run the tests", command: "npx vitest run sticktobottom" },
        ]);

        // before the result: the Claude projection keeps the command on the action when the target is its description
        const pending = stepOf(action("ran", { target: "Run the tests", command: "npm test" }), true);
        expect(pending.verb).toBe("");
        expect(pending.chips).toEqual([{ kind: "description", text: "Run the tests", command: "npm test" }]);
    });

    it("runs: a tool whose detail is a command and whose target is a summary (agy) shows the summary", () => {
        const s = stepOf(
            action("run_command", {
                target: "Listing the repo",
                detail: { kind: "bash", command: "ls -la", output: "", exit: 0 },
            }),
            false
        );
        expect(s.verb).toBe("");
        expect(s.chips).toEqual([{ kind: "description", text: "Listing the repo", command: "ls -la" }]);
    });

    it("runs: a multi-line command is its first line; an empty target falls back to the command", () => {
        const s = stepOf(
            action("ran", {
                target: "cd x\n  && make",
                detail: { kind: "bash", command: "cd x\n  && make", output: "", exit: 0 },
            }),
            false
        );
        expect(s.chips).toEqual([{ kind: "command", text: "cd x" }]);
        const bare = stepOf(
            action("ran", { target: "", detail: { kind: "bash", command: "make", output: "", exit: 0 } }),
            false
        );
        expect(bare.chips).toEqual([{ kind: "command", text: "make" }]);
    });

    it("searches: a grep with hits is one file chip per distinct file, in order of first hit, then +N", () => {
        const matches = [
            { loc: "/r/a.ts:3", code: "x" },
            { loc: "/r/a.ts:9", code: "x" },
            { loc: "/r/b.ts:1", code: "x" },
            { loc: "D:\\r\\c.ts:22", code: "x" },
            { loc: "/r/d.ts:4", code: "x" },
            { loc: "/r/e.ts:5", code: "x" },
        ];
        const s = stepOf(action("grep", { target: "pin", detail: { kind: "grep", matches } }), false);
        expect(s.verb).toBe("Searched");
        expect(s.chips).toEqual([
            { kind: "file", path: "/r/a.ts" },
            { kind: "file", path: "/r/b.ts" },
            { kind: "file", path: "D:\\r\\c.ts" },
        ]);
        expect(s.more).toBe(2);
    });

    it("searches: a grep with no parseable hits shows its pattern as a text chip", () => {
        const none = stepOf(action("grep", { target: "pin(" }), false);
        expect(none.chips).toEqual([{ kind: "text", text: "pin(" }]);
        const noLoc = stepOf(
            action("grep", { target: "pin(", detail: { kind: "grep", matches: [{ loc: "", code: "/r/a.ts" }] } }),
            false
        );
        expect(noLoc.chips).toEqual([{ kind: "text", text: "pin(" }]);
        expect(noLoc.more).toBe(0);
    });

    it("finds: a glob is the verb Found with its pattern as a text chip", () => {
        const s = stepOf(action("glob", { target: "src/**/*.tsx", summary: "8 lines" }), false);
        expect(s.verb).toBe("Found");
        expect(s.chips).toEqual([{ kind: "text", text: "src/**/*.tsx" }]);
        expect(s.meta).toBe("8 lines");
    });

    it("an unknown tool is Used, its name as what the row names, its target as the meta", () => {
        const s = stepOf(action("mcp__github__get_pull_request", { target: "PR 12" }), false);
        expect(s.verb).toBe("Used");
        expect(s.chips).toEqual([{ kind: "text", text: "mcp__github__get_pull_request" }]);
        expect(s.meta).toBe("PR 12");
        expect(s.more).toBe(0);
        expect(stepOf(action("mytool", { target: "" }), false).meta).toBeUndefined();
        // an unknown name whose detail says what it was (agy's edit_file) words it by the detail
        expect(
            stepOf(action("edit_file", { detail: { kind: "edit", files: [file("/r/a.ts")] } }), false)
        ).toMatchObject({
            verb: "Edited",
            chips: [{ kind: "file", path: "/r/a.ts" }],
        });
    });

    it("a subagent is named by its type, its task as the meta; with no type, by its target", () => {
        const s = stepOf(
            action("spawned", {
                target: "Find where the router registers routes",
                subagent: { description: "Find where the router registers routes", subagentType: "Explore" },
            }),
            false
        );
        expect(s).toMatchObject({
            verb: "Spawned",
            chips: [{ kind: "text", text: "Explore" }],
            meta: "Find where the router registers routes",
        });
        expect(stepOf(action("spawned", { target: "reviewer" }), false).chips).toEqual([
            { kind: "text", text: "reviewer" },
        ]);
    });

    it("words the other tools the transcripts name in the past tense", () => {
        expect(stepOf(action("webfetch", { target: "example.com" }), false).verb).toBe("Fetched");
        expect(stepOf(action("websearch", { target: "vitest" }), false).verb).toBe("Searched the web");
        expect(stepOf(action("skill", { target: "arc:design" }), false).verb).toBe("Ran skill");
        expect(stepOf(action("asked", { target: "Which one?" }), false).verb).toBe("Asked");
        expect(stepOf(action("blocked", { target: "x", outcome: "blocked" }), false).verb).toBe("Blocked");
    });

    it("is running only for a call with no result in a session that is working", () => {
        const pending = action("read", { target: "a.ts" });
        expect(stepOf(pending, true).running).toBe(true);
        // a session that stopped left it without a result: not running, however old
        expect(stepOf(pending, false).running).toBe(false);
        // a result landed: not running even while the session works
        expect(stepOf({ ...pending, outcome: "ok" }, true).running).toBe(false);
        expect(stepOf({ ...pending, outcome: "fail" }, true).running).toBe(false);
    });
});

const edit = (path: string, adds: number, dels: number, extra: Partial<AgentActionEntry> = {}): AgentActionEntry =>
    action("edited", {
        target: path.split("/").pop(),
        path,
        outcome: "ok",
        detail: { kind: "edit", files: [{ ...file(path), adds, dels }] },
        ...extra,
    });
const read = (path: string, extra: Partial<AgentActionEntry> = {}): AgentActionEntry =>
    action("read", { target: path.split("/").pop(), path, outcome: "ok", summary: "25 lines", ...extra });

describe("pictureOf", () => {
    it("is the absolute path of a picture a read took in", () => {
        expect(pictureOf(read("/a/shot.png"))).toBe("/a/shot.png");
        expect(pictureOf(read("C:\\a\\Shot.JPG", { target: "Shot.JPG" }))).toBe("C:\\a\\Shot.JPG");
    });
    it("falls back to an absolute target when the call gave no path", () => {
        expect(pictureOf(action("read", { target: "/a/b.webp" }))).toBe("/a/b.webp");
    });
    it("is null for a bare name, another file, another verb, or a failed read", () => {
        expect(pictureOf(action("read", { target: "b.png" }))).toBeNull();
        expect(pictureOf(read("/a/b.ts"))).toBeNull();
        expect(pictureOf(read("/a/b.svg"))).toBeNull();
        expect(pictureOf(edit("/a/b.png", 1, 0))).toBeNull();
        expect(pictureOf(read("/a/b.png", { outcome: "fail" }))).toBeNull();
    });
});

describe("stretchPictures", () => {
    it("names each picture once, in order, up to the cap", () => {
        const acts = [read("/a/1.png"), read("/a/x.ts"), read("/a/1.png"), read("/a/2.png"), read("/a/3.png")];
        expect(stretchPictures(acts, 2)).toEqual(["/a/1.png", "/a/2.png"]);
        expect(stretchPictures(acts, 5)).toEqual(["/a/1.png", "/a/2.png", "/a/3.png"]);
    });
});

describe("stepRows", () => {
    it("folds a run of the same verb on the same file, in order, each line keyed by its first call", () => {
        const calls = [
            read("/r/a.test.ts"),
            read("/r/a.test.ts"),
            read("/r/a.ts"),
            edit("/r/a.ts", 5, 9),
            edit("/r/a.ts", 2, 6),
            edit("/r/a.test.ts", 0, 11),
            edit("/r/rail.tsx", 0, 9),
            edit("/r/rail.tsx", 1, 6),
        ];
        expect(stepRows(calls).map((r) => [r.start, r.actions.length])).toEqual([
            [0, 2],
            [2, 1],
            [3, 2],
            [5, 1],
            [6, 2],
        ]);
    });

    it("never folds across another call, a different verb, or a call that touched several files", () => {
        const two = action("edited", {
            outcome: "ok",
            detail: { kind: "edit", files: [file("/r/a.ts"), file("/r/b.ts")] },
        });
        const calls = [edit("/r/a.ts", 1, 0), read("/r/b.ts"), edit("/r/a.ts", 1, 0), read("/r/a.ts"), two, two];
        expect(stepRows(calls).map((r) => r.actions.length)).toEqual([1, 1, 1, 1, 1, 1]);
    });

    it("a failed or blocked call keeps its own line and ends the run", () => {
        const calls = [
            edit("/r/a.ts", 1, 0),
            edit("/r/a.ts", 1, 0, { outcome: "fail" }),
            edit("/r/a.ts", 1, 0),
            edit("/r/a.ts", 1, 0, { outcome: "blocked" }),
            edit("/r/a.ts", 1, 0),
            edit("/r/a.ts", 1, 0),
        ];
        expect(stepRows(calls).map((r) => r.actions.length)).toEqual([1, 1, 1, 1, 2]);
    });

    it("a call still in flight joins the run of its file (its path, before the diff lands)", () => {
        const pending = action("edited", { target: "a.ts", path: "/r/a.ts" });
        expect(stepRows([edit("/r/a.ts", 1, 0), pending]).map((r) => r.actions.length)).toEqual([2]);
    });

    it("matches a path written with either slash", () => {
        expect(stepRows([read("C:\\r\\a.ts"), read("C:/r/a.ts")]).map((r) => r.actions.length)).toEqual([2]);
    });
});

describe("foldOf", () => {
    it("adds up the run: count and an edit run's lines", () => {
        const f = foldOf([edit("/r/rail.tsx", 0, 9), edit("/r/rail.tsx", 1, 6)], false);
        expect(f.step.verb).toBe("Edited");
        expect(f.step.chips).toEqual([{ kind: "file", path: "/r/rail.tsx" }]);
        expect(f.count).toBe(2);
        expect(f.edits).toEqual({ adds: 1, dels: 15 });
        expect(f.step.running).toBe(false);
    });

    it("keeps a read's summary only when every call says the same", () => {
        expect(foldOf([read("/r/a.ts"), read("/r/a.ts")], false).summary).toBe("25 lines");
        expect(foldOf([read("/r/a.ts"), read("/r/a.ts", { summary: "80 lines" })], false).summary).toBeUndefined();
        expect(foldOf([read("/r/a.ts"), read("/r/a.ts")], false).edits).toBeUndefined();
    });

    it("is running while its last call is in flight, its verb in the present tense", () => {
        const pending = action("edited", { target: "a.ts", path: "/r/a.ts", startedAt: 1_000 });
        const f = foldOf([edit("/r/a.ts", 1, 2), pending], true);
        expect(f.step.running).toBe(true);
        expect(f.step.verb).toBe("Editing");
        expect(f.edits).toEqual({ adds: 1, dels: 2 });
        expect(foldOf([edit("/r/a.ts", 1, 2), pending], false).step.running).toBe(false);
    });
});

describe("editCounts", () => {
    it("adds an edit's files up, and is null without an edit detail", () => {
        const two = action("edited", {
            detail: {
                kind: "edit",
                files: [
                    { ...file("/r/a.ts"), adds: 3, dels: 1 },
                    { ...file("/r/b.ts"), adds: 2, dels: 4 },
                ],
            },
        });
        expect(editCounts(two)).toEqual({ adds: 5, dels: 5 });
        expect(editCounts(read("/r/a.ts"))).toBeNull();
    });
});

describe("turnFiles", () => {
    const changed = (path: string, adds: number, dels: number, extra: Partial<AgentActionEntry> = {}) =>
        action("edited", {
            path,
            outcome: "ok",
            detail: { kind: "edit", files: [{ path, badge: "M", adds, dels, lines: [] }] },
            ...extra,
        });
    const work = (...actions: AgentActionEntry[]): AgentPart => ({
        kind: "work",
        work: { kind: "work", startIndex: 0, actions, durationMs: 0, failed: 0, files: [], adds: 0, dels: 0 },
    });

    it("one file", () => {
        expect(turnFiles([work(changed("/r/a.ts", 3, 1))])).toEqual([{ path: "/r/a.ts", adds: 3, dels: 1 }]);
    });

    it("several files across stretches, in the order first touched, a file edited twice summed once", () => {
        const parts: AgentPart[] = [
            work(changed("/r/b.ts", 1, 0), action("read", { path: "/r/c.ts", outcome: "ok" })),
            { kind: "prose", text: "next" },
            work(changed("/r/a.ts", 2, 2), changed("\\r\\b.ts", 4, 1)),
        ];
        expect(turnFiles(parts)).toEqual([
            { path: "/r/b.ts", adds: 5, dels: 1 },
            { path: "/r/a.ts", adds: 2, dels: 2 },
        ]);
    });

    it("a failed or refused edit adds nothing", () => {
        const parts = [
            work(
                changed("/r/a.ts", 3, 0, { outcome: "fail" }),
                changed("/r/b.ts", 3, 0, { outcome: "blocked" }),
                changed("/r/c.ts", 1, 0)
            ),
        ];
        expect(turnFiles(parts)).toEqual([{ path: "/r/c.ts", adds: 1, dels: 0 }]);
    });

    it("a create counts its lines as adds", () => {
        const create = action("wrote", {
            path: "/r/new.md",
            outcome: "ok",
            detail: { kind: "edit", files: [{ path: "/r/new.md", badge: "A", adds: 12, dels: 0, lines: [] }] },
        });
        expect(turnFiles([work(create)])).toEqual([{ path: "/r/new.md", adds: 12, dels: 0 }]);
    });

    it("commands and reads add nothing", () => {
        expect(turnFiles([work(action("ran", { target: "touch x", outcome: "ok" }))])).toEqual([]);
    });
});

describe("fileWhere", () => {
    it("its folder relative to the working directory, none at its root", () => {
        expect(fileWhere("/repo/pkg/orchestrate/fixround.go", "/repo")).toEqual({
            name: "fixround.go",
            folder: "pkg/orchestrate",
        });
        expect(fileWhere("/repo/CHANGELOG.md", "/repo/")).toEqual({ name: "CHANGELOG.md", folder: "" });
        expect(fileWhere("D:\\Repo\\docs\\hand-checks.md", "d:\\repo")).toEqual({
            name: "hand-checks.md",
            folder: "docs",
        });
    });

    it("outside the directory or with none known, the folder's own name; a relative path as written", () => {
        expect(fileWhere("/other/lib/x.ts", "/repo")).toEqual({ name: "x.ts", folder: "lib" });
        expect(fileWhere("/repo/pkg/x.go", null)).toEqual({ name: "x.go", folder: "pkg" });
        expect(fileWhere("pkg/x.go", undefined)).toEqual({ name: "x.go", folder: "pkg" });
        expect(fileWhere("x.go", undefined)).toEqual({ name: "x.go", folder: "" });
    });
});

describe("foreignPathGuesses", () => {
    it("reads each tail of a Windows path against the cwd on a Mac, longest first", () => {
        expect(foreignPathGuesses("d:\\ttq\\mit-thesis\\obsidian_harness\\a.html", "/Users/me/thesis", false)).toEqual([
            "/Users/me/thesis/ttq/mit-thesis/obsidian_harness/a.html",
            "/Users/me/thesis/mit-thesis/obsidian_harness/a.html",
            "/Users/me/thesis/obsidian_harness/a.html",
            "/Users/me/thesis/a.html",
        ]);
        expect(foreignPathGuesses("D:/p/a.go", "/r", false)).toEqual(["/r/p/a.go", "/r/a.go"]);
    });
    it("reads each tail of a Mac path against the cwd on Windows, in its separator", () => {
        expect(foreignPathGuesses("/Users/me/thesis/a/b.md", "D:\\mit", true)).toEqual([
            "D:\\mit\\Users\\me\\thesis\\a\\b.md",
            "D:\\mit\\me\\thesis\\a\\b.md",
            "D:\\mit\\thesis\\a\\b.md",
            "D:\\mit\\a\\b.md",
            "D:\\mit\\b.md",
        ]);
    });
    it("has no guesses for a path this machine opens as written, or with no cwd", () => {
        expect(foreignPathGuesses("/Users/me/a.go", "/Users/me", false)).toEqual([]);
        expect(foreignPathGuesses("C:\\r\\a.go", "C:\\r", true)).toEqual([]);
        expect(foreignPathGuesses("\\\\server\\share\\a.go", "C:\\r", true)).toEqual([]);
        expect(foreignPathGuesses("pkg/a.go", "/r", false)).toEqual([]);
        expect(foreignPathGuesses("d:\\p\\a.go", null, false)).toEqual([]);
    });
});

describe("turnFileAbs", () => {
    it("keeps an absolute path as written", () => {
        expect(turnFileAbs("/notes/obsidian_harness/a.html", "/repo")).toBe("/notes/obsidian_harness/a.html");
        expect(turnFileAbs("C:\\repo\\a.go", null)).toBe("C:\\repo\\a.go");
    });
    it("reads a relative path against the cwd, in its separator", () => {
        expect(turnFileAbs("pkg/a.go", "/repo/")).toBe("/repo/pkg/a.go");
        expect(turnFileAbs("./a.go", "/repo")).toBe("/repo/a.go");
        expect(turnFileAbs("pkg\\a.go", "C:\\repo")).toBe("C:\\repo\\pkg\\a.go");
    });
    it("has nowhere to open a relative path without a cwd", () => {
        expect(turnFileAbs("pkg/a.go", undefined)).toBeNull();
        expect(turnFileAbs("pkg/a.go", "")).toBeNull();
    });
});
