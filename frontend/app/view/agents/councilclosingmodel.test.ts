import { describe, expect, it } from "vitest";
import { closingCard } from "./councilclosingmodel";

const entry = (id: string, kind: string, at: number): CouncilMemoryEntry =>
    ({ id, kind, text: `text ${id}`, at }) as CouncilMemoryEntry;

const council = (extra: Partial<Council> = {}): Council =>
    ({
        id: "c1",
        project: "D:\\code\\arc",
        feature: "Rail apps",
        experts: [],
        state: "done",
        round: 3,
        proposals: [],
        replies: [],
        summary: { text: "", answer: "Ship B first.", directions: [], outcomes: {}, at: 15 },
        tokens: 0,
        calls: 0,
        created: 0,
        updated: 0,
        ...extra,
    }) as Council;

describe("closingCard", () => {
    it("draws the Report's answer and its settled counts, in the Report's order, once the council is done", () => {
        const c = council({
            memory: {
                chosen: { text: " Keep the oracle " } as CouncilMemoryDirection,
                entries: [
                    entry("m1", "agreed", 1),
                    entry("m2", "open", 2),
                    entry("m3", "agreed", 3),
                    entry("m4", "ruledout", 4),
                ],
            } as CouncilMemory,
        });
        expect(closingCard(c)).toEqual({
            kicker: "Council done",
            answer: "Ship B first.",
            direction: "Keep the oracle",
            counts: "2 agreed · 1 still open · 1 ruled out",
        });
    });

    it("leaves out a group with no entries, and the counts and direction with no memory", () => {
        expect(closingCard(council({ memory: { entries: [entry("m1", "open", 1)] } as CouncilMemory }))?.counts).toBe(
            "1 still open"
        );
        const bare = closingCard(council())!;
        expect([bare.counts, bare.direction]).toEqual(["", ""]);
    });

    it("falls back on the summary's first sentence when the coordinator wrote no answer", () => {
        const c = council({ summary: { text: "Go with B. Then A.", directions: [], outcomes: {}, at: 15 } });
        expect(closingCard(c)?.answer).toBe("Go with B.");
    });

    it("names how the council ended: done, stopped, or failed after its summary", () => {
        expect(closingCard(council({ state: "stopped" }))?.kicker).toBe("Council stopped");
        expect(closingCard(council({ state: "failed" }))?.kicker).toBe("Council ended");
    });

    it("has no card while the council still runs or waits, or when it ended with no summary", () => {
        for (const state of ["running", "awaiting-you", "queued"]) {
            expect(closingCard(council({ state }))).toBeNull();
        }
        expect(closingCard(council({ summary: undefined }))).toBeNull();
    });
});
