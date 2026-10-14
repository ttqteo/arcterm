import { describe, expect, it } from "vitest";
import {
    askingOrefs,
    eventAge,
    eventLine,
    eventParts,
    eventsSince,
    eventTone,
    idleLabel,
    isChanged,
    isIdle,
    quietLine,
    reviewCards,
    reviewDone,
    reviewedInSession,
    reviewQueue,
    reviewSummary,
    reviewSummaryLine,
    sessionNext,
    sessionStep,
    sinceHeading,
    workingOrefs,
} from "./reviewmodel";

const DAY = 86_400_000;

const card = (oref: string, over: Partial<any> = {}) => ({
    oref,
    status: "active",
    updatedts: 0,
    blockedChunks: [],
    working: false,
    asking: false,
    ...over,
});

describe("isIdle", () => {
    it("is active, nobody on it, and still and unreviewed for 14 days", () => {
        const now = 15 * DAY;
        expect(isIdle(card("a", { updatedts: 0 }), undefined, now)).toBe(true);
        expect(isIdle(card("a", { updatedts: 0, working: true }), undefined, now)).toBe(false);
        expect(isIdle(card("a", { updatedts: 2 * DAY }), undefined, now)).toBe(false);
        expect(isIdle(card("a", { status: "paused" }), undefined, 99 * DAY)).toBe(false);
        // Mark reviewed takes it out of the queue until 14 more still days pass
        expect(isIdle(card("a", { updatedts: 0 }), now - DAY, now)).toBe(false);
        expect(isIdle(card("a", { updatedts: 0 }), 0, now)).toBe(true);
    });
});

describe("isChanged", () => {
    it("is an update after the mark, or after the cursor when it was never reviewed", () => {
        expect(isChanged(card("a", { updatedts: 10 }), 5, 99)).toBe(true);
        expect(isChanged(card("a", { updatedts: 10 }), 10, 99)).toBe(false);
        expect(isChanged(card("a", { updatedts: 10 }), undefined, 5)).toBe(true);
        expect(isChanged(card("a", { updatedts: 10 }), undefined, 10)).toBe(false);
        // the mark wins over the cursor, even an older one
        expect(isChanged(card("a", { updatedts: 10 }), 20, 5)).toBe(false);
    });
});

describe("reviewQueue", () => {
    it("takes changed and idle ones: blocked, asking, working, changed, then idle", () => {
        const now = 30 * DAY;
        const cards = [
            card("idle", { updatedts: 1 }),
            card("changed", { updatedts: now - 1000 }),
            card("work", { updatedts: now - 1000, working: true }),
            card("ask", { updatedts: now - 1000, asking: true }),
            card("stuck", { updatedts: now - 1000, blockedChunks: ["x"] }),
            card("seen", { updatedts: now - 5000 }),
            card("idleseen", { updatedts: 1 }),
        ];
        const reviewed = { seen: now - 4000, idleseen: now - 2 * DAY };
        expect(reviewQueue(cards as any, reviewed, now - DAY, now).map((q) => q.oref)).toEqual([
            "stuck",
            "ask",
            "work",
            "changed",
            "idle",
        ]);
    });
    it("empties once each one is marked reviewed", () => {
        const now = 30 * DAY;
        const cards = [card("idle", { updatedts: 1 }), card("changed", { updatedts: now - 1000 })];
        const reviewed = { idle: now - 10, changed: now - 10 };
        expect(reviewQueue(cards as any, reviewed, now - DAY, now)).toEqual([]);
    });
    it("names each one's reason, and keeps the given order inside a reason", () => {
        const now = 30 * DAY;
        const cards = [
            card("c2", { updatedts: now - 2000 }),
            card("i1", { updatedts: 1 }),
            card("c1", { updatedts: now - 1000 }),
        ];
        const queue = reviewQueue(cards as any, {}, now - DAY, now);
        expect(queue.map((q) => [q.oref, q.reason])).toEqual([
            ["c2", "changed"],
            ["c1", "changed"],
            ["i1", "idle"],
        ]);
        expect(queue[0].card).toBe(cards[0]);
    });
    it("a blocked one that nothing changed and nobody left is not in it", () => {
        const now = 30 * DAY;
        const cards = [card("stuck", { updatedts: now - 5000, blockedChunks: ["x"] })];
        expect(reviewQueue(cards as any, { stuck: now - 4000 }, now - DAY, now)).toEqual([]);
    });
});

describe("eventsSince", () => {
    it("keeps the events after the mark, newest first", () => {
        const events = [
            { ts: 1, kind: "chunk-added", label: "old" },
            { ts: 5, kind: "chunk-done", label: "Fold pause box" },
            { ts: 9, kind: "effort-note", text: "beam timing feels slow" },
        ];
        expect(eventsSince(events as any, 2).map((e) => e.ts)).toEqual([9, 5]);
    });
    it("reads a batch that shares one stamp newest-written first", () => {
        const events = [
            { ts: 5, kind: "chunk-added", label: "first" },
            { ts: 5, kind: "chunk-added", label: "second" },
        ];
        expect(eventsSince(events as any, 0).map((e) => e.label)).toEqual(["second", "first"]);
    });
    it("is empty for an effort with no events", () => {
        expect(eventsSince(undefined, 0)).toEqual([]);
    });
});

describe("eventLine", () => {
    it("words each kind", () => {
        expect(eventLine({ ts: 1, kind: "chunk-done", label: "Fold pause box" })).toBe("✓ Fold pause box · done");
        expect(eventLine({ ts: 1, kind: "chunk-added", label: "Teleport sound cue" })).toBe(
            "+ Teleport sound cue · added"
        );
        expect(eventLine({ ts: 1, kind: "effort-status", text: "paused" })).toBe("now paused");
        expect(eventLine({ ts: 1, kind: "effort-note", label: "Teleport", text: "beam timing feels slow" })).toBe(
            "note: beam timing feels slow"
        );
    });
    it("reads a chunk's new status off the note the change wrote", () => {
        const chunks = [
            { label: "Parse SSI export", status: "blocked", notes: [{ ts: 7, text: "marked blocked · x" }] },
        ];
        expect(eventLine({ ts: 7, kind: "chunk-status", label: "Parse SSI export", text: "x" }, chunks)).toBe(
            "Parse SSI export · blocked"
        );
    });
    it("says the status changed when the trail does not tell which", () => {
        expect(eventLine({ ts: 7, kind: "chunk-status", label: "Parse SSI export" })).toBe(
            "Parse SSI export · status changed"
        );
        const chunks = [{ label: "Parse SSI export", status: "blocked", notes: [{ ts: 3, text: "marked blocked" }] }];
        expect(eventLine({ ts: 7, kind: "chunk-status", label: "Parse SSI export" }, chunks)).toBe(
            "Parse SSI export · status changed"
        );
    });
});

describe("idleLabel", () => {
    it("reads the weeks it has been still", () => {
        expect(idleLabel(0, 21 * DAY)).toBe("idle 3w");
        expect(idleLabel(0, 14 * DAY)).toBe("idle 2w");
        expect(idleLabel(0, 20 * DAY)).toBe("idle 2w");
    });
});

describe("workingOrefs and askingOrefs", () => {
    it("finds the initiatives with a workref on a chunk", () => {
        const summaries = [
            {
                oref: "effort:a",
                chunks: [{ label: "x", status: "active", workrefs: [{ kind: "agent", oref: "agent:t" }] }],
            },
            { oref: "effort:b", chunks: [{ label: "y", status: "pending", workrefs: [] }] },
            { oref: "effort:c", chunks: [{ label: "z", status: "pending" }] },
            { oref: "effort:d" },
        ];
        expect([...workingOrefs(summaries as any)]).toEqual(["effort:a"]);
    });
    it("finds the initiatives something waits on you for: a queue item, or an agent asking", () => {
        const attention = [
            { kind: "plan-review", effortoid: "p1" },
            { kind: "radar-triage" },
            { kind: "ask", effortoid: "" },
        ];
        const agents = [{ state: "asking", effortId: "a1" }, { state: "working", effortId: "w1" }, { state: "asking" }];
        expect([...askingOrefs(attention as any, agents as any)].sort()).toEqual(["effort:a1", "effort:p1"]);
    });
});

describe("reviewSummary", () => {
    it("counts the changed ones and the idle ones the queue holds", () => {
        const now = 30 * DAY;
        const cards = [
            card("a", { updatedts: now - 1000 }),
            card("b", { updatedts: now - 1000, blockedChunks: ["x"] }),
            card("c", { updatedts: 1 }),
        ];
        const queue = reviewQueue(cards as any, {}, now - DAY, now);
        expect(reviewSummary(queue)).toEqual({ changed: 2, idle: 1 });
    });
    it("says it in one line", () => {
        expect(reviewSummaryLine({ changed: 3, idle: 1 })).toBe("3 initiatives changed · 1 idle");
        expect(reviewSummaryLine({ changed: 1, idle: 0 })).toBe("1 initiative changed");
        expect(reviewSummaryLine({ changed: 0, idle: 2 })).toBe("2 initiatives idle");
        expect(reviewSummaryLine({ changed: 0, idle: 0 })).toBe("");
    });
});

describe("a review session", () => {
    const orefs = ["a", "b", "c"];
    it("is reviewed in it when its mark is at or after the start", () => {
        expect(reviewedInSession({ a: 100 }, "a", 100)).toBe(true);
        expect(reviewedInSession({ a: 99 }, "a", 100)).toBe(false);
        expect(reviewedInSession({}, "a", 100)).toBe(false);
    });
    it("steps with wrap-around", () => {
        expect(sessionStep(orefs, "a", 1)).toBe("b");
        expect(sessionStep(orefs, "c", 1)).toBe("a");
        expect(sessionStep(orefs, "a", -1)).toBe("c");
        expect(sessionStep(orefs, "gone", 1)).toBe("a");
        expect(sessionStep([], "a", 1)).toBe("");
    });
    it("moves on to the next one not yet reviewed, wrapping past the end", () => {
        expect(sessionNext(orefs, { b: 100 }, 100, "a")).toBe("c");
        expect(sessionNext(orefs, { a: 100 }, 100, "c")).toBe("b");
        expect(sessionNext(orefs, { a: 100, b: 100, c: 100 }, 100, "c")).toBeNull();
    });
    it("is done when every one is marked", () => {
        expect(reviewDone(orefs, { a: 100, b: 101 }, 100)).toBe(false);
        expect(reviewDone(orefs, { a: 100, b: 101, c: 150 }, 100)).toBe(true);
        expect(reviewDone([], {}, 100)).toBe(true);
    });
});

describe("what the views read", () => {
    it("adds working and asking to the trackers", () => {
        const trackers = [
            { oref: "effort:a", status: "active", updatedts: 1, blockedChunks: [] },
            { oref: "effort:b", status: "active", updatedts: 1, blockedChunks: [] },
        ];
        const summaries = [
            {
                oref: "effort:a",
                chunks: [{ label: "x", status: "active", workrefs: [{ kind: "agent", oref: "agent:t" }] }],
            },
        ];
        const cards = reviewCards(trackers, summaries as any, [{ effortoid: "b" }] as any, []);
        expect(cards.map((c) => [c.oref, c.working, c.asking])).toEqual([
            ["effort:a", true, false],
            ["effort:b", false, true],
        ]);
    });
    it("heads the block with the mark, or the cursor", () => {
        expect(sinceHeading(undefined)).toBe("since you last looked");
        expect(sinceHeading(new Date(2026, 9, 10, 12).getTime())).toBe("last reviewed Oct 10");
    });
    it("says what an idle one's block is for", () => {
        expect(quietLine(0, 21 * DAY)).toBe("nothing moved in 3 weeks and no agent is on it");
        expect(quietLine(0, 14 * DAY)).toBe("nothing moved in 2 weeks and no agent is on it");
    });
    it("reads an event's age", () => {
        expect(eventAge(0, 30_000)).toBe("just now");
        expect(eventAge(0, 2 * 3_600_000)).toBe("2h ago");
        expect(eventAge(0, 2 * DAY)).toBe("2d ago");
    });
    it("tones the kinds", () => {
        expect(eventTone("chunk-done")).toBe("ok");
        expect(eventTone("chunk-added")).toBe("accent");
        expect(eventTone("effort-note")).toBe("muted");
    });
});

describe("eventParts", () => {
    it("splits the glyph off, or leaves a quiet dot", () => {
        expect(eventParts("✓ Fold pause box · done")).toEqual({ glyph: "✓", text: "Fold pause box · done" });
        expect(eventParts("+ Teleport · added")).toEqual({ glyph: "+", text: "Teleport · added" });
        expect(eventParts("note: slow")).toEqual({ glyph: "·", text: "note: slow" });
    });
});
