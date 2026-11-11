// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { describe, expect, it } from "vitest";
import type { AgentActionEntry, EditFile } from "./agentsviewmodel";
import { MAX_STEP_CHIPS, stepElapsed, stepOf } from "./chatsteps";

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
    it("reads: the verb Read and a file chip on the full path", () => {
        const s = stepOf(action("read", { target: "a.ts", path: "/repo/src/a.ts", outcome: "ok" }), false);
        expect(s.verb).toBe("Read");
        expect(s.icon).toBe("read");
        expect(s.chips).toEqual([{ kind: "file", path: "/repo/src/a.ts" }]);
        expect(s.more).toBe(0);
        expect(s.running).toBe(false);
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
        expect(one.verb).toBe("Edit");
        expect(one.icon).toBe("edit");
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

    it("writes: the verb Write, a file chip", () => {
        const s = stepOf(action("wrote", { target: "n.ts", path: "/r/n.ts" }), false);
        expect(s.verb).toBe("Write");
        expect(s.icon).toBe("write");
        expect(s.chips).toEqual([{ kind: "file", path: "/r/n.ts" }]);
    });

    it("runs: the verb Ran and the command as a chip, from the detail when it is there", () => {
        const done = stepOf(
            action("ran", {
                target: "run the tests",
                outcome: "ok",
                detail: { kind: "bash", command: "npx vitest run sticktobottom", output: "18 passed", exit: 0 },
            }),
            false
        );
        expect(done.verb).toBe("Ran");
        expect(done.icon).toBe("run");
        expect(done.chips).toEqual([{ kind: "command", text: "npx vitest run sticktobottom" }]);

        // before the result lands there is no detail: the target stands in
        const pending = stepOf(action("ran", { target: "go build ./..." }), true);
        expect(pending.chips).toEqual([{ kind: "command", text: "go build ./..." }]);
    });

    it("runs: a multi-line command is its first line", () => {
        const s = stepOf(
            action("ran", { detail: { kind: "bash", command: "cd x\n  && make", output: "", exit: 0 } }),
            false
        );
        expect(s.chips).toEqual([{ kind: "command", text: "cd x" }]);
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
        expect(s.verb).toBe("Search");
        expect(s.icon).toBe("search");
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

    it("finds: a glob is the verb Find with its pattern as a text chip", () => {
        const s = stepOf(action("glob", { target: "src/**/*.tsx" }), false);
        expect(s.verb).toBe("Find");
        expect(s.icon).toBe("find");
        expect(s.chips).toEqual([{ kind: "text", text: "src/**/*.tsx" }]);
    });

    it("an unknown tool keeps its own name, capitalised, with the target as a text chip", () => {
        const s = stepOf(action("mytool", { target: "example.com" }), false);
        expect(s.verb).toBe("Mytool");
        expect(s.icon).toBe("tool");
        expect(s.chips).toEqual([{ kind: "text", text: "example.com" }]);
        expect(s.more).toBe(0);
        // a verb written with underscores (antigravity's run_command) reads as words
        expect(stepOf(action("run_command", { target: "ls" }), false).verb).toBe("Run command");
    });

    it("an unknown tool that names a file gets a file chip, and one with no target no chip", () => {
        expect(stepOf(action("mytool", { target: "x.md", path: "/r/x.md" }), false).chips).toEqual([
            { kind: "file", path: "/r/x.md" },
        ]);
        expect(stepOf(action("mytool", { target: "" }), false).chips).toEqual([]);
    });

    it("names the tools the transcripts call by other names", () => {
        expect(stepOf(action("spawned", { target: "reviewer" }), false).icon).toBe("spawn");
        expect(stepOf(action("webfetch", { target: "example.com" }), false)).toMatchObject({
            verb: "Fetch",
            icon: "web",
        });
        expect(stepOf(action("skill", { target: "arc:design" }), false).icon).toBe("skill");
        expect(stepOf(action("asked", { target: "Which one?" }), false).icon).toBe("ask");
        expect(stepOf(action("blocked", { outcome: "blocked" }), false).icon).toBe("blocked");
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
