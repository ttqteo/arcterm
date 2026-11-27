// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { describe, expect, it } from "vitest";
import {
    agentChunk,
    chipCount,
    CHUNK_RENAME,
    chunkMenuItems,
    latestNote,
    linkChunk,
    nextChunks,
    popoverProgress,
    popoverRows,
    popoverStatus,
    proposedCount,
    stepRow,
} from "./initiativepopovermodel";

type Extra = {
    workrefs?: { kind: string; oref: string; ts: number }[];
    notes?: { ts: number; text: string }[];
    later?: boolean;
};
const chunk = (label: string, status: string, extra: Extra = {}) => ({ label, status, ...extra });

// [done A, active B (the agent's, with a note), pending C, D, E, proposed P]
const effort = {
    chunks: [
        chunk("A", "done"),
        chunk("B", "active", {
            workrefs: [{ kind: "agent", oref: "agent:t1", ts: 1 }],
            notes: [{ ts: 5, text: "slow" }],
        }),
        chunk("C", "pending"),
        chunk("D", "pending"),
        chunk("E", "pending"),
        chunk("P", "proposed"),
    ],
};

describe("agentChunk", () => {
    it("is the chunk whose workrefs hold the agent's tab", () => {
        expect(agentChunk(effort, "t1")?.label).toBe("B");
    });

    it("is null for an agent with no workref of its own: the active chunk does not stand in", () => {
        expect(agentChunk(effort, "t9")).toBeNull();
    });

    it("is null with no workref, whatever the chunks are", () => {
        expect(agentChunk({ chunks: [chunk("A", "done"), chunk("C", "pending")] }, "t9")).toBeNull();
        expect(agentChunk({ chunks: [] }, "t9")).toBeNull();
        expect(agentChunk({}, "t9")).toBeNull();
    });

    it("is null once every chunk the agent holds is settled", () => {
        const e = {
            chunks: [
                chunk("A", "done", { workrefs: [{ kind: "agent", oref: "agent:t1", ts: 1 }] }),
                chunk("B", "skipped", { workrefs: [{ kind: "agent", oref: "agent:t1", ts: 2 }] }),
                chunk("C", "active"),
            ],
        };
        expect(agentChunk(e, "t1")).toBeNull();
    });

    it("prefers the active chunk when legacy data attached the agent to several live ones", () => {
        const e = {
            chunks: [
                chunk("A", "pending", { workrefs: [{ kind: "agent", oref: "agent:t1", ts: 1 }] }),
                chunk("B", "active", { workrefs: [{ kind: "agent", oref: "agent:t1", ts: 2 }] }),
            ],
        };
        expect(agentChunk(e, "t1")?.label).toBe("B");
    });

    it("prefers the unsettled chunk when the agent was attached to several", () => {
        const e = {
            chunks: [
                chunk("A", "done", { workrefs: [{ kind: "agent", oref: "agent:t1", ts: 1 }] }),
                chunk("B", "pending", { workrefs: [{ kind: "agent", oref: "agent:t1", ts: 2 }] }),
                chunk("C", "active"),
            ],
        };
        expect(agentChunk(e, "t1")?.label).toBe("B");
    });

    it("does not take a proposed chunk, nor another agent's workref", () => {
        const e = {
            chunks: [
                chunk("P", "proposed", { workrefs: [{ kind: "agent", oref: "agent:t1", ts: 1 }] }),
                chunk("A", "pending", { workrefs: [{ kind: "agent", oref: "agent:t2", ts: 1 }] }),
            ],
        };
        expect(agentChunk(e, "t1")).toBeNull();
    });
});

describe("nextChunks", () => {
    it("lists the two pending chunks after the given one, never a proposed one", () => {
        expect(nextChunks(effort, "B")).toEqual(["C", "D"]);
    });

    it("skips what is not pending, and stops at the end of the plan", () => {
        const e = {
            chunks: [chunk("A", "active"), chunk("B", "deferred"), chunk("C", "pending"), chunk("P", "proposed")],
        };
        expect(nextChunks(e, "A")).toEqual(["C"]);
    });

    it("starts from the top of the plan with no chunk to follow", () => {
        expect(nextChunks(effort, null)).toEqual(["C", "D"]);
    });
});

describe("latestNote", () => {
    it("is the newest note's text", () => {
        expect(latestNote(effort.chunks[1])).toBe("slow");
        expect(
            latestNote(
                chunk("X", "active", {
                    notes: [
                        { ts: 9, text: "newest" },
                        { ts: 3, text: "older" },
                    ],
                })
            )
        ).toBe("newest");
    });

    it("is undefined for a chunk with no notes, or none at all", () => {
        expect(latestNote(effort.chunks[0])).toBeUndefined();
        expect(latestNote(null)).toBeUndefined();
    });
});

describe("proposedCount", () => {
    it("counts the chunks waiting for a decision", () => {
        expect(proposedCount(effort)).toBe(1);
        expect(proposedCount({ chunks: [chunk("A", "done")] })).toBe(0);
        expect(proposedCount({})).toBe(0);
    });
});

describe("popoverProgress", () => {
    it("counts the plan without the proposed and skipped chunks", () => {
        const p = popoverProgress({ chunks: [...effort.chunks, chunk("S", "skipped")] });
        expect(p.done).toBe(1);
        expect(p.total).toBe(5);
        expect(p.segments).toEqual(["done", "active", "pending", "pending", "pending"]);
    });
});

describe("chipCount", () => {
    it("is done/total over the plan the chip counts", () => {
        expect(chipCount({ chunks: [chunk("A", "done"), chunk("B", "active"), chunk("C", "pending")] })).toBe("1/3");
        // a proposed chunk is not work yet and a skipped one leaves the total, as popoverProgress counts
        expect(chipCount({ chunks: [...effort.chunks, chunk("S", "skipped")] })).toBe("1/5");
    });

    it("is null with no initiative read yet, or with no chunk to count", () => {
        expect(chipCount(undefined)).toBeNull();
        expect(chipCount({ chunks: [] })).toBeNull();
        expect(chipCount({})).toBeNull();
        expect(chipCount({ chunks: [chunk("P", "proposed"), chunk("S", "skipped")] })).toBeNull();
    });
});

describe("popoverStatus", () => {
    it("says the agent is open, and at work while it works", () => {
        expect(popoverStatus({ status: "active", chunks: effort.chunks }, "idle").text).toBe("agent open");
        expect(popoverStatus({ status: "active", chunks: effort.chunks }, "working").text).toBe("at work");
    });

    it("puts a blocked chunk, a pause and a finished plan first", () => {
        expect(popoverStatus({ status: "active", chunks: [chunk("A", "blocked")] }, "working").text).toBe("blocked");
        expect(popoverStatus({ status: "paused", chunks: effort.chunks }, "working").text).toBe("paused");
        expect(popoverStatus({ status: "active", chunks: [chunk("A", "done")] }, "working").text).toBe("done");
    });
});

describe("popoverRows and stepRow", () => {
    it("lists the agent's chunk, then the next ones", () => {
        expect(popoverRows(effort, "t1")).toEqual([
            { kind: "current", label: "B" },
            { kind: "next", label: "C" },
            { kind: "next", label: "D" },
        ]);
    });

    it("lists only the next ones when the agent is on no chunk", () => {
        expect(popoverRows({ chunks: [chunk("C", "pending")] }, "t1")).toEqual([{ kind: "next", label: "C" }]);
    });

    it("does not take the active chunk for an agent with none of its own", () => {
        expect(popoverRows(effort, "t9")).toEqual([
            { kind: "next", label: "C" },
            { kind: "next", label: "D" },
        ]);
    });

    it("moves the cursor and stops at the ends", () => {
        expect(stepRow(3, 0, 1)).toBe(1);
        expect(stepRow(3, 2, 1)).toBe(2);
        expect(stepRow(3, 0, -1)).toBe(0);
        expect(stepRow(0, 0, 1)).toBe(0);
    });
});

// A chunk saved for later is kept on Jarvis, not worked. These plans put one AHEAD of the plan's chunks, where a rule
// reading the list in order would reach it first.
describe("chunks saved for later", () => {
    const mine = { workrefs: [{ kind: "agent", oref: "agent:t1", ts: 1 }] };
    const later = (label: string, status = "pending", extra: Extra = {}) =>
        chunk(label, status, { ...extra, later: true });
    const withLater = {
        chunks: [later("L1"), later("L2", "active"), chunk("A", "done"), chunk("B", "pending"), chunk("C", "pending")],
    };

    it("is never the chunk an agent is on, whatever its workrefs", () => {
        const e = { chunks: [later("L", "active", mine), chunk("B", "pending", mine)] };
        expect(agentChunk(e, "t1")?.label).toBe("B");
        expect(agentChunk({ chunks: [later("L", "active", mine)] }, "t1")).toBeNull();
    });

    it("is never one of the next chunks, from the top or after a chunk", () => {
        expect(nextChunks(withLater, null)).toEqual(["B", "C"]);
        expect(nextChunks(withLater, "A")).toEqual(["B", "C"]);
        expect(nextChunks({ chunks: [later("L1"), later("L2")] }, null)).toEqual([]);
    });

    it("is never in the popover's rows", () => {
        expect(popoverRows(withLater, "t1")).toEqual([
            { kind: "next", label: "B" },
            { kind: "next", label: "C" },
        ]);
    });

    it("is not counted in the bar, the done count or the chip", () => {
        expect(popoverProgress(withLater)).toEqual({ segments: ["done", "pending", "pending"], done: 1, total: 3 });
        expect(chipCount(withLater)).toBe("1/3");
        expect(chipCount({ chunks: [later("L1"), later("L2", "done")] })).toBeNull();
    });

    it("does not make the initiative blocked, nor keep a settled plan from being done", () => {
        expect(
            popoverStatus({ status: "active", chunks: [later("L", "blocked"), chunk("A", "pending")] }, "idle").text
        ).toBe("agent open");
        expect(
            popoverStatus({ status: "active", chunks: [later("L", "pending"), chunk("A", "done")] }, "idle").text
        ).toBe("done");
        // only later chunks: there is no plan to be done with
        expect(popoverStatus({ status: "active", chunks: [later("L", "done")] }, "idle").text).toBe("agent open");
    });
});

describe("linkChunk", () => {
    const later = (label: string, status: string) => chunk(label, status, { later: true });

    it("is the active chunk, else the first pending one", () => {
        expect(linkChunk([chunk("A", "done"), chunk("B", "pending"), chunk("C", "active")])?.label).toBe("C");
        expect(linkChunk([chunk("A", "done"), chunk("B", "pending"), chunk("C", "pending")])?.label).toBe("B");
    });

    it("never picks a later chunk ahead of the plan, whatever its status", () => {
        expect(linkChunk([later("L1", "pending"), chunk("B", "pending")])?.label).toBe("B");
        expect(linkChunk([later("L1", "active"), chunk("B", "pending"), chunk("C", "active")])?.label).toBe("C");
        expect(linkChunk([later("L1", "active"), chunk("B", "pending")])?.label).toBe("B");
    });

    it("is nothing when the plan has no chunk to pick, a later one left or not", () => {
        expect(linkChunk([later("L1", "pending"), later("L2", "active")])).toBeUndefined();
        expect(linkChunk([later("L1", "pending"), chunk("A", "done"), chunk("S", "skipped")])).toBeUndefined();
        expect(linkChunk([])).toBeUndefined();
    });

    it("leaves a proposed chunk, a deferred one and a blocked one alone", () => {
        expect(linkChunk([chunk("P", "proposed"), chunk("D", "deferred"), chunk("X", "blocked")])).toBeUndefined();
    });
});

describe("chunkMenuItems", () => {
    it("lists the statuses a chunk can be set to, the current one marked, and Rename last", () => {
        const items = chunkMenuItems("pending");
        expect(items.map((i) => i.id)).toEqual(["pending", "active", "blocked", "deferred", "skipped", CHUNK_RENAME]);
        expect(items.filter((i) => i.current).map((i) => i.id)).toEqual(["pending"]);
    });
});
