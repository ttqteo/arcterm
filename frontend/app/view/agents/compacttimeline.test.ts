// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { describe, expect, it } from "vitest";
import type { AgentActionEntry, AgentEntry, EditFile } from "./agentsviewmodel";
import {
    filesChangedLabel,
    groupCompact,
    mergeEditFiles,
    toolCountLabel,
    userNeedsClamp,
    workedFor,
    type WorkItem,
} from "./compacttimeline";

const action = (verb: string, extra: Partial<AgentActionEntry> = {}): AgentEntry => ({
    kind: "action",
    verb,
    target: `${verb}-target`,
    ...extra,
});

const file = (path: string, adds: number, dels: number, badge: "M" | "A" = "M"): EditFile => ({
    path,
    badge,
    adds,
    dels,
    lines: [{ sign: "+", text: `${path}:+${adds}` }],
});

const edit = (...files: EditFile[]): AgentEntry =>
    action("edited", { detail: { kind: "edit", files } });

const works = (entries: AgentEntry[]): WorkItem[] =>
    groupCompact(entries).filter((i): i is WorkItem => i.kind === "work");

describe("groupCompact", () => {
    it("keeps prose and folds the tool calls between two messages into one work item", () => {
        const items = groupCompact([
            { kind: "user", text: "do it" },
            action("read"),
            action("grep"),
            { kind: "message", text: "done" },
        ]);
        expect(items.map((i) => i.kind)).toEqual(["user", "work", "message"]);
        const work = items[1] as WorkItem;
        expect(work.actions.map((a) => a.verb)).toEqual(["read", "grep"]);
        expect(work.startIndex).toBe(1);
    });

    it("folds even a single tool call, which the live feed leaves as a bare line", () => {
        expect(groupCompact([action("read")]).map((i) => i.kind)).toEqual(["work"]);
    });

    it("starts a new work item after prose and after a notification", () => {
        const items = groupCompact([
            action("read"),
            { kind: "message", text: "a" },
            action("grep"),
            { kind: "notification", summary: "child done" },
            action("bash"),
        ]);
        expect(items.map((i) => i.kind)).toEqual(["work", "message", "work", "notification", "work"]);
        expect(works([action("read"), { kind: "message", text: "a" }, action("grep")]).map((w) => w.startIndex)).toEqual(
            [0, 2]
        );
    });

    it("passes commands, compactions and interruptions through with their own entries", () => {
        const items = groupCompact([
            { kind: "command", name: "/review", args: "x" },
            { kind: "compaction", trigger: "auto" },
            { kind: "interrupted" },
        ]);
        expect(items.map((i) => i.kind)).toEqual(["command", "compaction", "interrupted"]);
    });

    it("adds the tools' wall time and counts the failures", () => {
        const [w] = works([
            action("read", { durationMs: 1500 }),
            action("bash", { durationMs: 2500, outcome: "fail" }),
            action("grep"),
        ]);
        expect(w.durationMs).toBe(4000);
        expect(w.failed).toBe(1);
    });

    it("reports no files for a stretch that edited nothing", () => {
        const [w] = works([action("read"), action("grep")]);
        expect(w.files).toEqual([]);
        expect(w.adds).toBe(0);
        expect(w.dels).toBe(0);
    });

    it("gathers the files its edits touched, once per path, with the summed counts", () => {
        const [w] = works([
            edit(file("a.ts", 3, 1)),
            action("read"),
            edit(file("b.ts", 2, 0, "A"), file("a.ts", 4, 2)),
        ]);
        expect(w.files.map((f) => f.path)).toEqual(["a.ts", "b.ts"]);
        expect(w.files[0]).toMatchObject({ adds: 7, dels: 3, badge: "M" });
        expect(w.files[0].lines).toHaveLength(2);
        expect(w.adds).toBe(9);
        expect(w.dels).toBe(3);
    });

    it("ignores an edit-verb action that carries no edit detail", () => {
        const [w] = works([action("edited")]);
        expect(w.files).toEqual([]);
    });
});

describe("mergeEditFiles", () => {
    it("does not mutate its input", () => {
        const a = file("a.ts", 1, 0);
        mergeEditFiles([a, file("a.ts", 2, 0)]);
        expect(a.adds).toBe(1);
        expect(a.lines).toHaveLength(1);
    });
});

describe("workedFor", () => {
    it("says plain Worked when there is no time to report", () => {
        expect(workedFor(0)).toBe("Worked");
        expect(workedFor(400)).toBe("Worked");
    });

    it("reads seconds, minutes and hours", () => {
        expect(workedFor(24_000)).toBe("Worked for 24s");
        expect(workedFor(60_000)).toBe("Worked for 1m");
        expect(workedFor(192_000)).toBe("Worked for 3m 12s");
        expect(workedFor(3_900_000)).toBe("Worked for 1h 5m");
        expect(workedFor(7_200_000)).toBe("Worked for 2h");
    });

    it("rounds to the nearest second", () => {
        expect(workedFor(24_600)).toBe("Worked for 25s");
    });
});

describe("userNeedsClamp", () => {
    it("leaves a short message whole", () => {
        expect(userNeedsClamp("nên bọc với 2 div không nhỉ?")).toBe(false);
        expect(userNeedsClamp("a\nb\nc\nd\ne\nf")).toBe(false);
    });

    it("clamps one past six lines or past 480 characters", () => {
        expect(userNeedsClamp("a\nb\nc\nd\ne\nf\ng")).toBe(true);
        expect(userNeedsClamp("x".repeat(481))).toBe(true);
        expect(userNeedsClamp("x".repeat(480))).toBe(false);
    });
});

describe("labels", () => {
    it("pluralizes", () => {
        expect(toolCountLabel(1)).toBe("1 tool");
        expect(toolCountLabel(5)).toBe("5 tools");
        expect(filesChangedLabel(1)).toBe("1 file changed");
        expect(filesChangedLabel(3)).toBe("3 files changed");
    });
});
