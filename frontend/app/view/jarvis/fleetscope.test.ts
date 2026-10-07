import { describe, expect, it } from "vitest";
import type { AgentVM } from "@/app/view/agents/agentsviewmodel";
import { fleetCountsLine, RAIL_COUNTS_MAX_CHARS, fleetForRecord } from "./fleetscope";

function agent(id: string, state: AgentVM["state"]): AgentVM {
    return { id, name: id, state } as unknown as AgentVM;
}

function channel(oid: string): Channel {
    return { oid, name: oid } as unknown as Channel;
}

// a run row names its owning channel
function run(id: string, channeloid: string): Run {
    return { id, channeloid } as unknown as Run;
}

// dispatch messages pointing at the worker tabs, which is what buildFleetSnapshot resolves.
function dispatches(workerIds: string[]): ChannelMessage[] {
    return workerIds.map((w, i) => ({
        id: `m${i}`,
        kind: "dispatch",
        reforef: `tab:${w}`,
        text: "do a thing",
    })) as unknown as ChannelMessage[];
}

describe("fleetForRecord", () => {
    it("returns no workers and no channels when the record has no attributed runs", () => {
        const out = fleetForRecord({
            channels: [channel("c1")],
            messagesByChannel: { c1: dispatches(["w1"]) },
            agents: [agent("w1", "working")],
            attributedRuns: [],
        });
        expect(out).toEqual({ workers: [], channelCount: 0 });
    });

    it("counts only the channels that own an attributed run", () => {
        const out = fleetForRecord({
            channels: [channel("c1"), channel("c2")],
            messagesByChannel: { c1: dispatches(["w1"]), c2: dispatches(["w9"]) },
            agents: [agent("w1", "working"), agent("w9", "working")],
            attributedRuns: [run("r1", "c1")],
        });
        expect(out.channelCount).toBe(1);
        expect(out.workers.map((w) => w.oref)).toEqual(["tab:w1"]);
    });

    it("rolls up workers across several channels", () => {
        const out = fleetForRecord({
            channels: [channel("c1"), channel("c2")],
            messagesByChannel: { c1: dispatches(["w1"]), c2: dispatches(["w2"]) },
            agents: [agent("w1", "working"), agent("w2", "asking")],
            attributedRuns: [run("r1", "c1"), run("r2", "c2")],
        });
        expect(out.channelCount).toBe(2);
        expect(out.workers.map((w) => w.oref).sort()).toEqual(["tab:w1", "tab:w2"]);
    });

    it("dedups a worker reachable through two channels", () => {
        const out = fleetForRecord({
            channels: [channel("c1"), channel("c2")],
            messagesByChannel: { c1: dispatches(["w1"]), c2: dispatches(["w1"]) },
            agents: [agent("w1", "working")],
            attributedRuns: [run("r1", "c1"), run("r2", "c2")],
        });
        expect(out.workers).toHaveLength(1);
        expect(out.channelCount).toBe(2);
    });

    it("counts a channel once however many of its runs are attributed", () => {
        const out = fleetForRecord({
            channels: [channel("c1")],
            messagesByChannel: { c1: dispatches(["w1"]) },
            agents: [agent("w1", "working")],
            attributedRuns: [run("r1", "c1"), run("r2", "c1")],
        });
        expect(out.channelCount).toBe(1);
        expect(out.workers).toHaveLength(1);
    });

    it("tolerates a channel that owns none of the attributed runs", () => {
        const out = fleetForRecord({
            channels: [channel("c1")],
            messagesByChannel: { c1: dispatches(["w1"]) },
            agents: [agent("w1", "working")],
            attributedRuns: [run("r1", "gone")],
        });
        expect(out).toEqual({ workers: [], channelCount: 0 });
    });

    it("counts a channel whose run is attributed even when it has no dispatch messages", () => {
        const out = fleetForRecord({
            channels: [channel("c1"), channel("c2")],
            messagesByChannel: { c1: [] },
            agents: [],
            attributedRuns: [run("r1", "c1"), run("r2", "c2")],
        });
        expect(out).toEqual({ workers: [], channelCount: 2 });
    });
});

describe("fleetCountsLine", () => {
    it("states working, waiting and cost for a channel", () => {
        expect(fleetCountsLine({ working: 2, waiting: 1 }, 1.2, null)).toBe("2 working · 1 waiting · $1.20");
    });

    it("drops the cost when nothing has been spent", () => {
        expect(fleetCountsLine({ working: 0, waiting: 0 }, 0, null)).toBe("0 working · 0 waiting");
    });

    it("counts channels instead of waiting workers for a record", () => {
        expect(fleetCountsLine({ working: 3, waiting: 2 }, 4, { workers: [], channelCount: 2 })).toBe(
            "3 working · 2 channels"
        );
    });

    it("singularizes one channel", () => {
        expect(fleetCountsLine({ working: 1, waiting: 0 }, 0, { workers: [], channelCount: 1 })).toBe(
            "1 working · 1 channel"
        );
    });

    // the rail is 300px with 18px of padding a side, and the row shares those 264px with the
    // "Fleet · on this record" title (~123px at 9px mono). The record variant used to read
    // "N working · across M channels" under whitespace-nowrap and ran off the edge, clipped
    // mid-word to "…across 0 ch".
    it("keeps the record variant inside the rail's character budget", () => {
        for (const [working, channels] of [
            [0, 0],
            [9, 9],
            [99, 99],
        ]) {
            const line = fleetCountsLine({ working, waiting: 0 }, 0, { workers: [], channelCount: channels });
            expect(line.length).toBeLessThanOrEqual(RAIL_COUNTS_MAX_CHARS);
        }
    });
});
