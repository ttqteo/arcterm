// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { describe, expect, it } from "vitest";
import type { AgentActionEntry, EditFile } from "./agentsviewmodel";
import { doingText, stepSummary, stretchTime } from "./chatstepsummary";

const action = (verb: string, extra: Partial<AgentActionEntry> = {}): AgentActionEntry => ({
    kind: "action",
    verb,
    target: `${verb}-target`,
    ...extra,
});

const diff = (path: string, adds: number, dels: number): EditFile => ({ path, badge: "M", adds, dels, lines: [] });
const read = (path: string, extra: Partial<AgentActionEntry> = {}) =>
    action("read", { target: path.split("/").pop(), path, ...extra });
const edit = (path: string, adds = 1, dels = 0, extra: Partial<AgentActionEntry> = {}) =>
    action("edited", {
        target: path.split("/").pop(),
        path,
        detail: { kind: "edit", files: [diff(path, adds, dels)] },
        ...extra,
    });
const ran = (command: string, extra: Partial<AgentActionEntry> = {}) =>
    action("ran", { target: command, outcome: "ok", ...extra });

describe("stepSummary: finished", () => {
    it("only reads: one file names it, several count", () => {
        expect(stepSummary([read("/r/a.ts")], false).text).toBe("Read a.ts");
        expect(stepSummary([read("/r/a.ts"), read("/r/b.ts"), read("/r/a.ts")], false).text).toBe("Read 2 files");
        expect(stepSummary([read("/r/a.ts")], false).edits).toBeNull();
    });

    it("one edit: the file's name and its lines", () => {
        const s = stepSummary([edit("/r/server.js", 5, 2)], false);
        expect(s).toEqual({ running: false, text: "Edited server.js", more: 0, edits: { adds: 5, dels: 2 } });
    });

    it("edits, then writes, then commands, then what only looked, whatever the order they happened in", () => {
        const s = stepSummary(
            [
                read("/r/a.ts"),
                ran("npm test"),
                edit("/r/a.ts", 3, 0),
                action("grep", { target: "retries" }),
                read("/r/b.ts"),
                ran("npm run lint"),
                edit("/r/b.ts", 2, 1),
                action("wrote", { target: "c.ts", path: "/r/c.ts" }),
            ],
            false
        );
        expect(s.text).toBe("Edited 2 files, created c.ts, ran 2 commands, read 2 files and searched");
        expect(s.edits).toEqual({ adds: 5, dels: 1 });
    });

    it("one file edited several times is still named", () => {
        expect(stepSummary([edit("/r/a.ts"), edit("\\r\\a.ts")], false).text).toBe("Edited a.ts");
        expect(stepSummary([edit("/r/a.ts"), edit("/s/a.ts")], false).text).toBe("Edited 2 files");
    });

    it("commands always count", () => {
        expect(stepSummary([ran("ls")], false).text).toBe("Ran a command");
        expect(stepSummary([ran("ls"), ran("pwd")], false).text).toBe("Ran 2 commands");
    });

    it("the searches merge into one count beside the reads", () => {
        const searches = [action("grep"), action("glob"), action("grep"), action("webfetch")];
        expect(stepSummary(searches, false).text).toBe("Searched 4 times");
        expect(stepSummary([read("/r/a.ts"), ...searches], false).text).toBe("Read a.ts and searched 4 times");
        expect(stepSummary([action("glob")], false).text).toBe("Searched for files");
        expect(stepSummary([action("webfetch"), action("webfetch")], false).text).toBe("Fetched 2 pages");
        expect(stepSummary([action("websearch")], false).text).toBe("Searched the web");
    });

    it("reads as the canvas words it: what looked, then the skill it ran", () => {
        const s = stepSummary(
            [
                action("skill", { target: "/superpowers:test-driven-development" }),
                read("/r/server.js"),
                action("glob", { target: "**/*.{js,json}" }),
                read("/r/package.json"),
                read("/r/cart.test.js"),
            ],
            false
        );
        expect(s.text).toBe("Read 3 files and searched for files, ran skill");
        expect(stepSummary([action("skill"), action("skill")], false).text).toBe("Ran 2 skills");
    });

    it("spawns, skills, questions and tools with no word never drop out", () => {
        const s = stepSummary(
            [
                action("run_thing"),
                action("spawned"),
                action("skill", { target: "brainstorming" }),
                action("asked"),
                read("/r/a.ts"),
                action("mcp__x__y"),
            ],
            false
        );
        expect(s.text).toBe("Spawned an agent, asked a question, read a.ts, ran skill, used 2 tools");
    });

    it("a harness's own tool names count by their detail (agy's run_command is a command)", () => {
        const s = stepSummary(
            [action("run_command", { detail: { kind: "bash", command: "ls", output: "", exit: 0 } })],
            false
        );
        expect(s.text).toBe("Ran a command");
    });

    it("a failed or refused call stays out of the sentence and its lines out of the counts", () => {
        const s = stepSummary(
            [
                edit("/r/a.ts", 4, 0),
                edit("/r/b.ts", 9, 9, { outcome: "fail" }),
                ran("rm -rf /", { outcome: "blocked" }),
            ],
            false
        );
        expect(s.text).toBe("Edited a.ts");
        expect(s.edits).toEqual({ adds: 4, dels: 0 });
        expect(stepSummary([read("/r/a.ts"), action("blocked", { target: "rm" })], false).text).toBe("Read a.ts");
    });

    it("a stretch in which every call failed reads by what it tried", () => {
        expect(stepSummary([edit("/r/server.js", 1, 1, { outcome: "fail" })], false)).toEqual({
            running: false,
            text: "Tried to edit server.js",
            more: 0,
            edits: null,
        });
        expect(stepSummary([ran("x", { outcome: "fail" }), action("grep", { outcome: "fail" })], false).text).toBe(
            "Tried to run a command, search"
        );
    });

    it("a stretch with removed lines only still counts its adds as +0", () => {
        expect(stepSummary([edit("/r/a.ts", 0, 3)], false).edits).toEqual({ adds: 0, dels: 3 });
    });

    it("calls with no result in a stopped session are not running", () => {
        expect(stepSummary([read("/r/a.ts", { outcome: undefined })], false).running).toBe(false);
    });
});

describe("stepSummary: running", () => {
    it("names the call in flight, a command by its first line", () => {
        const s = stepSummary(
            [read("/r/a.ts", { outcome: "ok" }), action("ran", { target: "npm test", startedAt: 5 })],
            true
        );
        expect(s).toEqual({ running: true, text: "Running npm test", more: 0, edits: null });
    });

    it("a described command by its description, a leading Run or Ran said as Running", () => {
        const described = (target: string) =>
            stepSummary([action("ran", { target, command: "npm test", startedAt: 5 })], true).text;
        expect(described("Run the test suite")).toBe("Running the test suite");
        expect(described("Ran tests to confirm new test fails")).toBe("Running tests to confirm new test fails");
        expect(described("Install dependencies")).toBe("Install dependencies");
        // a word that only starts with run is not the verb
        expect(described("Runtime check")).toBe("Runtime check");
    });

    it("several in flight: the latest to start, and the rest as more", () => {
        const s = stepSummary(
            [
                read("/r/a.ts", { startedAt: 10 }),
                action("ran", { target: "npm test", startedAt: 30 }),
                read("/r/b.ts", { startedAt: 20 }),
            ],
            true
        );
        expect(s.text).toBe("Running npm test");
        expect(s.more).toBe(2);
    });

    it("an unknown verb reads as using it", () => {
        expect(doingText(action("mcp_fetch", { target: "issue 12" }))).toBe("Using mcp fetch issue 12");
        expect(doingText(action("glob", { target: "**/*.ts" }))).toBe("Finding **/*.ts");
        expect(doingText(read("/r/server.js"))).toBe("Reading server.js");
    });
});

describe("stretchTime", () => {
    it("formats as workedFor does, without its words", () => {
        expect(stretchTime(400)).toBe("");
        expect(stretchTime(38_000)).toBe("38s");
        expect(stretchTime(192_000)).toBe("3m 12s");
        expect(stretchTime(3_900_000)).toBe("1h 5m");
    });
});
