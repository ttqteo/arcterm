// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { describe, expect, it } from "vitest";
import {
    agentChunk,
    CHUNK_RENAME,
    chunkMenuItems,
    latestNote,
    nextChunks,
    popoverProgress,
    popoverRows,
    popoverStatus,
    proposedCount,
    stepRow,
} from "./initiativepopovermodel";

type Extra = { workrefs?: { kind: string; oref: string; ts: number }[]; notes?: { ts: number; text: string }[] };
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

    it("lets the active chunk stand in for an agent with no workref of its own", () => {
        expect(agentChunk(effort, "t9")?.label).toBe("B");
    });

    it("is null with no workref and no active chunk", () => {
        expect(agentChunk({ chunks: [chunk("A", "done"), chunk("C", "pending")] }, "t9")).toBeNull();
        expect(agentChunk({ chunks: [] }, "t9")).toBeNull();
        expect(agentChunk({}, "t9")).toBeNull();
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

    it("moves the cursor and stops at the ends", () => {
        expect(stepRow(3, 0, 1)).toBe(1);
        expect(stepRow(3, 2, 1)).toBe(2);
        expect(stepRow(3, 0, -1)).toBe(0);
        expect(stepRow(0, 0, 1)).toBe(0);
    });
});

describe("chunkMenuItems", () => {
    it("lists the statuses a chunk can be set to, the current one marked, and Rename last", () => {
        const items = chunkMenuItems("pending");
        expect(items.map((i) => i.id)).toEqual(["pending", "active", "blocked", "deferred", "skipped", CHUNK_RENAME]);
        expect(items.filter((i) => i.current).map((i) => i.id)).toEqual(["pending"]);
    });
});
