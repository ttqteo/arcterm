// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { describe, expect, it } from "vitest";
import { filterLaterRows, laterDoneKey, laterNavId, laterRows, type LaterSession } from "./briefforlater";

const DAY = 86_400_000;
const NOW = 100 * DAY;
const age = (ms: number) => `${Math.floor(ms / DAY)}d`;

const session = (id: string, over: Partial<LaterSession> = {}): LaterSession => ({
    runtime: "claude",
    id,
    task: `task ${id}`,
    projectname: "arcterm",
    transcriptpath: `C:\\Users\\me\\.claude\\projects\\p\\${id}.jsonl`,
    resumecommand: `claude --resume ${id}`,
    live: false,
    ...over,
});

describe("laterRows", () => {
    it("lists every mark newest first, whatever its age, with the session's name, project and the mark's age", () => {
        const marks = { a: NOW - 30 * DAY, b: NOW - DAY, c: NOW - 3 * DAY };
        const rows = laterRows(marks, [session("a"), session("b"), session("c")], ["a", "b", "c"], new Set(), NOW, age);
        expect(rows.map((r) => [r.key, r.title, r.project, r.age])).toEqual([
            ["b", "task b", "arcterm", "1d"],
            ["c", "task c", "arcterm", "3d"],
            ["a", "task a", "arcterm", "30d"],
        ]);
        expect(rows[0].navId).toBe(laterNavId("b"));
    });

    it("breaks a tie on the mark's time by its key", () => {
        const rows = laterRows({ z: NOW, a: NOW }, [], [], new Set(), NOW, age);
        expect(rows.map((r) => r.key)).toEqual(["a", "z"]);
    });

    it("names an untitled session", () => {
        const rows = laterRows({ a: NOW }, [session("a", { task: "" })], ["a"], new Set(), NOW, age);
        expect(rows[0].title).toBe("(untitled session)");
    });

    it("matches a session by its transcript's stem, with a forward-slash path too", () => {
        const s = session("x", { id: "other", transcriptpath: "/home/me/.pi/sessions/abc.jsonl" });
        const rows = laterRows({ abc: NOW }, [s], ["abc"], new Set(), NOW, age);
        expect(rows[0]).toMatchObject({ state: "found", session: s });
    });

    it("shows a mark the finished lookup found no session for as not found, with no open and no Resume", () => {
        const rows = laterRows({ gone: NOW }, [], ["gone"], new Set(), NOW, age);
        expect(rows[0]).toMatchObject({
            state: "missing",
            title: "(session not found)",
            project: "",
            canOpen: false,
            canResume: false,
        });
    });

    it("shows a mark the lookup has not answered for by its short id, not as not found", () => {
        const rows = laterRows({ "0123456789abcdef": NOW }, [], [], new Set(), NOW, age);
        expect(rows[0]).toMatchObject({ state: "looking", title: "01234567", canOpen: false, canResume: false });
    });

    it("offers Resume only on an ended session with a resume command, and opens a live one", () => {
        const marks = { ended: NOW, live: NOW - 1, bare: NOW - 2 };
        const rows = laterRows(
            marks,
            [session("ended"), session("live", { live: true }), session("bare", { resumecommand: "" })],
            Object.keys(marks),
            new Set(),
            NOW,
            age
        );
        expect(rows.map((r) => [r.key, r.canOpen, r.canResume])).toEqual([
            ["ended", true, true],
            ["live", true, false],
            ["bare", true, false],
        ]);
    });

    it("hides a mark whose Done waits out its undo window", () => {
        const rows = laterRows({ a: NOW, b: NOW - 1 }, [], ["a", "b"], new Set([laterDoneKey("a")]), NOW, age);
        expect(rows.map((r) => r.key)).toEqual(["b"]);
    });

    it("never prints a negative age for a mark stamped ahead of the clock", () => {
        const rows = laterRows({ a: NOW + DAY }, [], [], new Set(), NOW, age);
        expect(rows[0].age).toBe("0d");
    });
});

describe("filterLaterRows", () => {
    const rows = laterRows(
        { a: NOW, b: NOW - 1 },
        [session("a", { task: "Fix the Diff badge" }), session("b", { projectname: "vnstock" })],
        ["a", "b"],
        new Set(),
        NOW,
        age
    );

    it("keeps every row with no query", () => {
        expect(filterLaterRows(rows, "  ")).toHaveLength(2);
    });

    it("matches the name or the project, ignoring case", () => {
        expect(filterLaterRows(rows, "diff").map((r) => r.key)).toEqual(["a"]);
        expect(filterLaterRows(rows, "VNSTOCK").map((r) => r.key)).toEqual(["b"]);
    });
});
