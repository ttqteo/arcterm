import { describe, expect, it } from "vitest";
// The Go twin (pkg/waveobj/chunkorder.go) reads this same file: the two rules are checked against one table.
import shared from "../../../../pkg/waveobj/testdata/chunkorder-cases.json";
import { CHUNK_PRIORITIES, chunkRank, orderOfWork, priorityBadge } from "./chunkorder";

type SharedChunk = { status: string; priority?: string };

describe("chunk order of work: the cases shared with the Go rule", () => {
    for (const c of shared.cases) {
        it(c.name, () => {
            const chunks: SharedChunk[] = c.chunks;
            const got = orderOfWork(chunks).map((ch) => chunks.indexOf(ch));
            expect(got).toEqual(c.order);
        });
    }

    it("leaves the input array and its chunks alone", () => {
        const a = { label: "a", status: "pending", priority: "low" };
        const b = { label: "b", status: "pending", priority: "critical" };
        const input = [a, b];
        const out = orderOfWork(input);
        expect(input).toEqual([a, b]);
        expect(out).toEqual([b, a]);
        expect(out[0]).toBe(b); // the chunks themselves, not copies: callers keep their extra fields
    });
});

describe("chunk priority scale", () => {
    it("lists the levels highest first, the reverse of the shared lowest-first list", () => {
        expect(CHUNK_PRIORITIES).toEqual([...shared.priorities].reverse());
    });

    it("ranks each level above the one below it", () => {
        for (let i = 1; i < shared.priorities.length; i++) {
            expect(chunkRank(shared.priorities[i])).toBeGreaterThan(chunkRank(shared.priorities[i - 1]));
        }
    });

    it("ranks an unset chunk, and a level this build does not know, as medium", () => {
        expect(chunkRank(undefined)).toBe(chunkRank("medium"));
        expect(chunkRank("")).toBe(chunkRank("medium"));
        expect(chunkRank("bogus")).toBe(chunkRank("medium"));
    });
});

describe("priorityBadge", () => {
    it("shows no badge for a chunk with no priority", () => {
        expect(priorityBadge(undefined)).toBeNull();
        expect(priorityBadge("")).toBeNull();
    });

    it("names the level in its own word, with a theme-token tone per level", () => {
        expect(priorityBadge("critical")).toEqual({ text: "critical", className: "text-error font-semibold" });
        expect(priorityBadge("high")).toEqual({ text: "high", className: "text-ink-hi font-semibold" });
        expect(priorityBadge("medium")).toEqual({ text: "medium", className: "text-ink-mid" });
        expect(priorityBadge("low")).toEqual({ text: "low", className: "text-muted" });
        expect(priorityBadge("information")).toEqual({ text: "information", className: "text-ink-faint" });
    });

    it("covers every level on the scale, and shows none for a level it does not know", () => {
        for (const p of CHUNK_PRIORITIES) {
            expect(priorityBadge(p)?.text).toBe(p);
        }
        expect(priorityBadge("bogus")).toBeNull();
    });

    it("uses tokens only: no raw color in any class", () => {
        for (const p of CHUNK_PRIORITIES) {
            expect(priorityBadge(p)?.className).not.toMatch(/#|rgb|\[/);
        }
    });
});
