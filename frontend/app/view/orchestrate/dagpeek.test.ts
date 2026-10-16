// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { computePosition, type Platform, type Rect } from "@floating-ui/react";
import { describe, expect, it } from "vitest";
import type { TaskBrief } from "./dagdigest";
import {
    nextSelection,
    PEEK_GAP_PX,
    PEEK_PAD_PX,
    PEEK_PLACEMENT,
    PEEK_W_PX,
    peekActions,
    peekMiddleware,
    taskPeek,
    verifySection,
} from "./dagpeek";

const NOW = 10_000_000;
const MIN = 60_000;

function task(over: Partial<TaskNode>): TaskNode {
    return { id: "t1", state: "pending", ...over };
}

function digest(over: Partial<DagTaskDigest>): DagTaskDigest {
    return { taskid: "t1", waitreason: "none", mergestate: "not-required", cleanupstate: "clear", ...over };
}

const briefs = new Map<string, TaskBrief>([
    ["t0", { label: "Add the schema", state: "running" }],
    ["t2", { label: "Wire the RPC", state: "running" }],
]);

describe("taskPeek", () => {
    it("titles the peek with the label, falling back to the id, and carries the trimmed description", () => {
        expect(
            taskPeek(task({ label: "Build it", description: "  pin the API shape\n" }), undefined, briefs, NOW)
        ).toMatchObject({
            title: "Build it",
            description: "pin the API shape",
        });
        expect(taskPeek(task({}), undefined, briefs, NOW)).toMatchObject({ title: "t1", description: "" });
    });

    it("names what a pending task is waiting on by label", () => {
        const peek = taskPeek(
            task({}),
            digest({ waitreason: "dependency", blockingtaskids: ["t0", "t2"] }),
            briefs,
            NOW
        );
        expect(peek.rows).toEqual([{ text: "waiting on Add the schema, Wire the RPC", tone: "muted" }]);
    });

    it("says a pending task is waiting for a slot, and makes no claim without a digest", () => {
        expect(taskPeek(task({}), digest({ waitreason: "parallelism" }), briefs, NOW).rows).toEqual([
            { text: "waiting for a worker slot", tone: "muted" },
        ]);
        expect(taskPeek(task({}), undefined, briefs, NOW).rows).toEqual([
            { text: "not dispatched yet", tone: "muted" },
        ]);
    });

    it("dates a running task's first and latest transcript activity", () => {
        const peek = taskPeek(
            task({ state: "running", firstactivity: NOW - 12 * MIN, lastactivity: NOW - 40_000 }),
            undefined,
            briefs,
            NOW
        );
        expect(peek.rows).toEqual([{ text: "first activity 12m ago · last 40s ago", tone: "muted" }]);
    });

    it("says no activity was observed for a running task with no stamps, rather than dating nothing", () => {
        expect(taskPeek(task({ state: "running" }), undefined, briefs, NOW).rows).toEqual([
            { text: "no activity observed", tone: "muted" },
        ]);
        expect(taskPeek(task({ state: "done" }), undefined, briefs, NOW).rows).toEqual([]);
    });

    it("tells an ask for the human apart from one the lead holds", () => {
        const mine = taskPeek(
            task({ state: "running" }),
            digest({ waitreason: "ask", asksummary: "Which port?" }),
            briefs,
            NOW
        );
        expect(mine.rows[0]).toEqual({ text: "asked you: Which port?", tone: "warning" });
        const lead = taskPeek(
            task({ state: "running" }),
            digest({ waitreason: "lead-ask", asksummary: "Which port?" }),
            briefs,
            NOW
        );
        expect(lead.rows[0]).toEqual({ text: "asked the lead: Which port?", tone: "warning" });
    });

    it("reports the failure kind with the attempt count once it has repeated", () => {
        expect(taskPeek(task({ state: "failed", lastfailurekind: "exit" }), undefined, briefs, NOW).rows).toEqual([
            { text: "last failure: exit", tone: "warning" },
        ]);
        expect(
            taskPeek(task({ state: "failed", lastfailurekind: "exit", attempts: 3 }), undefined, briefs, NOW).rows
        ).toEqual([{ text: "last failure: exit · attempt 3", tone: "warning" }]);
    });

    it("shows only the first line of a verify, merge or cleanup error", () => {
        const peek = taskPeek(
            task({ state: "verify-failed", verifyerror: "go test failed\n--- FAIL: TestX" }),
            undefined,
            briefs,
            NOW
        );
        expect(peek.rows).toEqual([{ text: "go test failed", tone: "warning" }]);
        expect(
            taskPeek(
                task({ state: "blocked-merge", mergeerror: "conflict in a.go", cleanuperror: "worktree locked" }),
                undefined,
                briefs,
                NOW
            ).rows
        ).toEqual([
            { text: "conflict in a.go", tone: "warning" },
            { text: "worktree locked", tone: "warning" },
        ]);
    });
});

describe("verifySection", () => {
    it("ticks elapsed for a verifying task and shows whatever output it has", () => {
        expect(verifySection(task({ state: "verifying", verifystartedts: NOW - 125_000 }), NOW)).toEqual({
            heading: "Verify running · 2m",
            tail: "",
            tone: "muted",
        });
        expect(verifySection(task({ state: "verifying" }), NOW)?.heading).toBe("Verify running");
    });

    it("shows the tail of a passing Verify", () => {
        const out = ["ok pkg/a", "ok pkg/b"].join("\n");
        expect(
            verifySection(task({ state: "done", verifystartedts: NOW - MIN, verifyoutput: out + "\n" }), NOW)
        ).toEqual({
            heading: "Verify passed",
            tail: out,
            tone: "muted",
        });
        expect(verifySection(task({ state: "done", verifystartedts: NOW - MIN }), NOW)?.heading).toBe("Verify passed");
    });

    it("shows the tail of a failed Verify", () => {
        expect(
            verifySection(
                task({ state: "verify-failed", verifyerror: "exit 1: FAIL", verifyoutput: "FAIL pkg/a" }),
                NOW
            )
        ).toEqual({ heading: "Verify output", tail: "FAIL pkg/a", tone: "warning" });
    });

    it("has nothing for a task that never verified", () => {
        expect(verifySection(task({ state: "done" }), NOW)).toBeNull();
        expect(verifySection(task({ state: "running" }), NOW)).toBeNull();
        expect(verifySection(task({ state: "verify-failed", verifyerror: "exit 1" }), NOW)).toBeNull();
        expect(taskPeek(task({ state: "done" }), undefined, briefs, NOW).verify).toBeNull();
    });
});

describe("taskPeek review rows", () => {
    it("shows a failed review's findings as a warning", () => {
        const peek = taskPeek(
            task({ state: "review-failed", reviewverdict: "fail", reviewnote: "misses empty input\nsee parse.ts" }),
            undefined,
            briefs,
            NOW
        );
        expect(peek.rows).toContainEqual({ text: "review fail: misses empty input", tone: "warning" });
    });
});

describe("peekActions", () => {
    it("keeps the engine's order with escalate last, the first one primary", () => {
        expect(peekActions(["retry", "skip", "escalate"])).toEqual([
            { action: "retry", label: "Retry", primary: true, picker: false },
            { action: "skip", label: "Skip", primary: false, picker: false },
            { action: "escalate", label: "Escalate…", primary: false, picker: true },
        ]);
        expect(peekActions(["escalate", "approve", "sendback"]).map((a) => a.action)).toEqual([
            "approve",
            "sendback",
            "escalate",
        ]);
    });
    it("labels in sentence case, an unknown action as itself capitalised", () => {
        expect(peekActions(["approve", "sendback", "merge", "resolve", "rebase"]).map((a) => a.label)).toEqual([
            "Approve",
            "Send back",
            "Merge",
            "Resolve",
            "Rebase",
        ]);
    });
    it("makes a lone escalate both primary and the picker", () => {
        expect(peekActions(["escalate"])).toEqual([
            { action: "escalate", label: "Escalate…", primary: true, picker: true },
        ]);
    });
    it("offers nothing for no actions", () => {
        expect(peekActions([])).toEqual([]);
    });
});

describe("nextSelection", () => {
    it("opens, switches and toggles the card shut", () => {
        expect(nextSelection(null, "t1", 1)).toBe("t1");
        expect(nextSelection("t1", "t2", 1)).toBe("t2");
        expect(nextSelection("t1", "t1", 1)).toBeNull();
    });
    it("never closes on the second click of a double-click", () => {
        expect(nextSelection("t1", "t1", 2)).toBe("t1");
        expect(nextSelection(null, "t1", 2)).toBe("t1");
    });
});

describe("peekMiddleware", () => {
    const NODE_W = 196;
    const NODE_H = 64;
    type Box = { rect: Rect };
    type Card = { style: Record<string, string>; height: number };

    // rects only, no DOM: the card honours the max height the size middleware writes, as a styled element does
    const cardHeight = (card: Card) => Math.min(card.height, parseFloat(card.style.maxHeight) || Infinity);
    const platform: Pick<Platform, "getElementRects" | "getDimensions" | "getClippingRect"> = {
        getElementRects: async ({ reference, floating }) => ({
            reference: (reference as unknown as Box).rect,
            floating: { x: 0, y: 0, width: PEEK_W_PX, height: cardHeight(floating as unknown as Card) },
        }),
        getDimensions: async (el) => ({ width: PEEK_W_PX, height: cardHeight(el as unknown as Card) }),
        getClippingRect: async ({ boundary }) => boundary as Rect,
    };

    async function place(node: { x: number; y: number }, pane: Rect, cardH = 300, rightInsetPx = PEEK_PAD_PX) {
        const card: Card = { style: {}, height: cardH };
        const reference = { rect: { ...node, width: NODE_W, height: NODE_H } };
        const out = await computePosition(reference as any, card as any, {
            placement: PEEK_PLACEMENT,
            strategy: "absolute",
            middleware: peekMiddleware(pane, rightInsetPx),
            platform: platform as Platform,
        });
        return { ...out, height: cardHeight(card) };
    }

    const pane: Rect = { x: 0, y: 0, width: 1000, height: 600 };

    it("sits right of the node, top-aligned, a gap off", async () => {
        const p = await place({ x: 100, y: 100 }, pane);
        expect(p.placement).toBe("right-start");
        expect(p.x).toBe(100 + NODE_W + PEEK_GAP_PX);
        expect(p.y).toBe(100);
        expect(p.middlewareData.hide?.referenceHidden).toBe(false);
    });

    it("flips to the node's left near the pane's right edge", async () => {
        const p = await place({ x: 700, y: 100 }, pane);
        expect(p.placement).toBe("left-start");
        expect(p.x).toBe(700 - PEEK_GAP_PX - PEEK_W_PX);
    });

    it("keeps the card's bottom inside the pane for a node low in it", async () => {
        const shifted = await place({ x: 100, y: 500 }, pane);
        expect(shifted.y + shifted.height).toBeLessThanOrEqual(pane.height - PEEK_PAD_PX);
        expect(shifted.y).toBeLessThan(500);
        const capped = await place({ x: 100, y: 500 }, pane, 900);
        expect(capped.height).toBe(pane.height - 2 * PEEK_PAD_PX);
        expect(capped.y).toBe(PEEK_PAD_PX);
    });

    it("reports a node panned out of the pane as hidden", async () => {
        const p = await place({ x: -400, y: 100 }, pane);
        expect(p.middlewareData.hide?.referenceHidden).toBe(true);
    });

    it("never reaches into the controls strip on the right", async () => {
        const wide: Rect = { x: 0, y: 0, width: 1200, height: 600 };
        const inset = 150 + PEEK_PAD_PX;
        // the right side fits until the strip is taken off it
        expect((await place({ x: 500, y: 20 }, wide)).placement).toBe("right-start");
        const p = await place({ x: 500, y: 20 }, wide, 300, inset);
        expect(p.placement).toBe("left-start");
        expect(p.x + PEEK_W_PX).toBeLessThanOrEqual(wide.width - inset);
    });
});
