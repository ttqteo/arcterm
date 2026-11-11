// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { describe, expect, it } from "vitest";
import {
    contextFigures,
    ENDED_SHOWN,
    formatUsd,
    localCommand,
    sessionIdOf,
    taskGroups,
    withCard,
    type LocalCard,
} from "./chatlocal";
import type { BackgroundTask } from "./transcriptprojection";

describe("localCommand", () => {
    it("answers the bare panel commands in Chat", () => {
        expect(localCommand("/usage")).toEqual({ panel: "usage", command: "/usage" });
        expect(localCommand("/cost")).toEqual({ panel: "usage", command: "/cost" });
        expect(localCommand("/context")).toEqual({ panel: "context", command: "/context" });
        expect(localCommand("/tasks")).toEqual({ panel: "tasks", command: "/tasks" });
        expect(localCommand("/bashes")).toEqual({ panel: "tasks", command: "/bashes" });
        expect(localCommand("/stats")).toEqual({ panel: "stats", command: "/stats" });
        expect(localCommand("/skills")).toEqual({ panel: "skills", command: "/skills" });
        expect(localCommand("/help")).toEqual({ panel: "help", command: "/help" });
        expect(localCommand("/status")).toEqual({ panel: "status", command: "/status" });
    });

    it("opens the Diff surface for /diff", () => {
        expect(localCommand("/diff")).toEqual({ open: "diff", command: "/diff" });
    });

    it("takes the trailing space a menu pick leaves", () => {
        expect(localCommand("/usage ")).toEqual({ panel: "usage", command: "/usage" });
        expect(localCommand("  /tasks\n")).toEqual({ panel: "tasks", command: "/tasks" });
    });

    it("sends a command with an argument, any other command and plain text", () => {
        expect(localCommand("/context verbose")).toBeNull();
        expect(localCommand("/compact")).toBeNull();
        expect(localCommand("/model")).toBeNull();
        expect(localCommand("/Usage")).toBeNull();
        expect(localCommand("show /usage")).toBeNull();
        expect(localCommand("usage")).toBeNull();
        expect(localCommand("")).toBeNull();
    });
});

describe("withCard", () => {
    const card = (id: string, panel: LocalCard["panel"]): LocalCard => ({ id, panel, command: `/${panel}`, at: 0 });

    it("adds a card at the end", () => {
        expect(withCard([card("a", "usage")], card("b", "tasks")).map((c) => c.id)).toEqual(["a", "b"]);
    });

    it("keeps one card per panel, the newest moved to the end", () => {
        const out = withCard([card("a", "usage"), card("b", "tasks")], card("c", "usage"));
        expect(out.map((c) => c.id)).toEqual(["b", "c"]);
    });
});

describe("contextFigures", () => {
    it("is null before the first reading", () => {
        expect(contextFigures(undefined)).toBeNull();
        expect(contextFigures({})).toBeNull();
        expect(contextFigures({ contextpct: NaN })).toBeNull();
    });

    it("gives the tokens the percent stands for", () => {
        expect(contextFigures({ contextpct: 42, contextmax: 200_000 })).toEqual({
            pct: 42,
            used: "84k",
            max: "200k",
            left: "116k",
        });
    });

    it("keeps the percent alone when the window is unknown", () => {
        expect(contextFigures({ contextpct: 10 })).toEqual({ pct: 10, used: null, max: null, left: null });
        expect(contextFigures({ contextpct: 10, contextmax: 0 })).toEqual({
            pct: 10,
            used: null,
            max: null,
            left: null,
        });
    });

    it("never reads less than nothing left", () => {
        expect(contextFigures({ contextpct: 104, contextmax: 1_000_000 })?.left).toBe("0");
    });
});

describe("formatUsd", () => {
    it("shows cents", () => {
        expect(formatUsd(1.234)).toBe("$1.23");
        expect(formatUsd(0)).toBe("$0.00");
        expect(formatUsd(-3)).toBe("$0.00");
        expect(formatUsd(NaN)).toBe("$0.00");
    });

    it("drops the cents past $1000", () => {
        expect(formatUsd(1234.5)).toBe("$1,235");
    });
});

describe("taskGroups", () => {
    const task = (id: string, status: BackgroundTask["status"], startMs: number, endMs?: number): BackgroundTask => ({
        toolUseId: id,
        label: id,
        status,
        startMs,
        ...(endMs != null ? { endMs } : {}),
    });

    it("splits running from ended, the newest end first", () => {
        const g = taskGroups([
            task("a", "completed", 1, 5),
            task("b", "running", 2),
            task("c", "failed", 3, 9),
            task("d", "running", 4),
        ]);
        expect(g.running.map((t) => t.toolUseId)).toEqual(["b", "d"]);
        expect(g.ended.map((t) => t.toolUseId)).toEqual(["c", "a"]);
        expect(g.endedMore).toBe(0);
    });

    it("folds the ended past ENDED_SHOWN into a count", () => {
        const ended = Array.from({ length: ENDED_SHOWN + 3 }, (_, i) => task(`t${i}`, "completed", i, i + 1));
        const g = taskGroups(ended);
        expect(g.ended).toHaveLength(ENDED_SHOWN);
        expect(g.ended[0].toolUseId).toBe(`t${ENDED_SHOWN + 2}`);
        expect(g.endedMore).toBe(3);
    });

    it("reads no list as empty", () => {
        expect(taskGroups(undefined)).toEqual({ running: [], ended: [], endedMore: 0 });
    });
});

describe("sessionIdOf", () => {
    it("reads the session id off a transcript path", () => {
        expect(sessionIdOf("C:\\Users\\x\\.claude\\projects\\p\\c8d17f34-ff9c-483d-aac7-10f8d058ddea.jsonl")).toBe(
            "c8d17f34-ff9c-483d-aac7-10f8d058ddea"
        );
    });

    it("is null for anything else", () => {
        expect(sessionIdOf(undefined)).toBeNull();
        expect(sessionIdOf("/tmp/session.jsonl")).toBeNull();
    });
});
