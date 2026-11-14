import { describe, expect, it } from "vitest";
import { mergeAgentStatusData, normalizeAgentUsage, seedAgentStatus } from "./agentstatusstore";

function status(over: Partial<AgentStatusData>): AgentStatusData {
    return { oref: "block:uuid-1", state: "working", ts: 1, ...over };
}

describe("normalizeAgentUsage", () => {
    it("keeps Claude used percentages unchanged", () => {
        expect(normalizeAgentUsage("claude", { contextpct: 30, fivehourpct: 40, weekpct: 50 })).toEqual({
            contextpct: 30,
            fivehourpct: 40,
            weekpct: 50,
        });
    });

    it("converts Codex remaining percentages to used percentages", () => {
        expect(normalizeAgentUsage("codex", { contextpct: 100, fivehourpct: 75, weekpct: 0 })).toEqual({
            contextpct: 0,
            fivehourpct: 25,
            weekpct: 100,
        });
    });
});

describe("mergeAgentStatusData", () => {
    it("passes the first event through unchanged", () => {
        const ev = status({ title: "fix the bug", agent: "claude", model: "sonnet" });
        expect(mergeAgentStatusData(null, ev)).toEqual(ev);
    });

    it("retains the title when a state event omits it (the ask/notification flicker)", () => {
        const prev = status({ state: "working", title: "fix the bug", agent: "claude", ts: 1 });
        const asking = status({ state: "asking", ts: 2 }); // AskUserQuestion event: no title
        const merged = mergeAgentStatusData(prev, asking);
        expect(merged.title).toBe("fix the bug");
        expect(merged.state).toBe("asking");
        expect(merged.ts).toBe(2);
    });

    it("a newer explicit title replaces the retained one", () => {
        const prev = status({ title: "old title", ts: 1 });
        const next = status({ title: "new title", ts: 2 });
        expect(mergeAgentStatusData(prev, next).title).toBe("new title");
    });

    it("retains the model across title-less events but clears the transient detail", () => {
        const prev = status({
            title: "t",
            model: "sonnet",
            detail: "editing foo.go",
            transcriptpath: "T",
            sessionid: "s1",
            ts: 1,
        });
        const merged = mergeAgentStatusData(prev, status({ state: "waiting", ts: 2 }));
        expect(merged.model).toBe("sonnet");
        expect(merged.transcriptpath).toBe("T");
        expect(merged.sessionid).toBe("s1");
        expect(merged.detail).toBeUndefined();
    });

    it("a title-less stream never invents a title out of nothing", () => {
        const ev = status({ state: "idle", ts: 9 });
        expect(mergeAgentStatusData(null, ev).title).toBeUndefined();
    });

    it("holds the label steady across a full working→asking→working turn", () => {
        let cur: AgentStatusData | null = null;
        const events = [
            status({ state: "working", title: "fix the bug", agent: "claude", ts: 1 }),
            status({ state: "asking", ts: 2 }),
            status({ state: "working", detail: "editing foo.go", title: "fix the bug", ts: 3 }),
        ];
        for (const ev of events) {
            cur = mergeAgentStatusData(cur, ev);
        }
        expect(cur?.title).toBe("fix the bug");
        expect(cur?.state).toBe("working");
    });
});

describe("seedAgentStatus", () => {
    it("fills an empty atom from the block's retained last event", () => {
        expect(seedAgentStatus(null, status({ state: "working", title: "t" }))).toEqual(
            status({ state: "working", title: "t" })
        );
    });
    it("never replaces a live event that arrived before the read returned", () => {
        const live = status({ state: "asking", ts: 9 });
        expect(seedAgentStatus(live, status({ state: "working", ts: 1 }))).toBe(live);
    });
    it("seeds nothing from a missing or stateless event", () => {
        expect(seedAgentStatus(null, undefined)).toBeNull();
        expect(seedAgentStatus(null, status({ state: "" }))).toBeNull();
    });
});

describe("mergeAgentStatusData effort", () => {
    it("keeps the last effort through an event that carries none, and takes a new one", () => {
        const first = { oref: "block:1", state: "working", ts: 1, effort: "high" };
        const kept = mergeAgentStatusData(first, { oref: "block:1", state: "idle", ts: 2 });
        expect(kept.effort).toBe("high");
        const moved = mergeAgentStatusData(kept, { oref: "block:1", state: "working", ts: 3, effort: "low" });
        expect(moved.effort).toBe("low");
    });
});
