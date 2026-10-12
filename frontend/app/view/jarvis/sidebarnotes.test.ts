import { describe, expect, it } from "vitest";
import type { FeedEntry } from "./effortfeed";
import { noteRunFace, sidebarNotes } from "./sidebarnotes";

const e = (seq: number, text: string, over: Partial<FeedEntry> = {}): FeedEntry => ({
    seq,
    ts: 1000 + seq,
    kind: "effort-note",
    chunk: "N1",
    status: "active",
    marked: "",
    text,
    noteAt: seq + 1,
    ...over,
});

describe("sidebarNotes", () => {
    it("opens the newest short note by default and gives it no chevron", () => {
        const cards = sidebarNotes([e(2, "short"), e(1, "older")], "N1", 5000, new Set());
        expect(cards[0]).toMatchObject({ open: true, chev: "" });
        expect(cards[1]).toMatchObject({ open: false, chev: "more" });
    });
    it("a long newest note starts folded", () => {
        const cards = sidebarNotes([e(1, "x".repeat(300))], "N1", 5000, new Set());
        expect(cards[0]).toMatchObject({ open: false, chev: "more" });
    });
    it("an expanded card offers less", () => {
        const cards = sidebarNotes([e(2, "a"), e(1, "b")], "N1", 5000, new Set(["1"]));
        expect(cards[1]).toMatchObject({ open: true, chev: "less" });
    });
    it("labels the author; a legacy note has none", () => {
        const cards = sidebarNotes(
            [
                e(3, "a", { author: "agent", session: "agent:tab9", run: "run:r1" }),
                e(2, "b", { author: "you" }),
                e(1, "c"),
            ],
            "N1",
            5000,
            new Set()
        );
        expect(cards.map((c) => c.who)).toEqual(["agent", "you", ""]);
        expect(cards[0]).toMatchObject({ sessionTab: "tab9", runOid: "r1", editable: false });
        expect(cards[1].editable).toBe(true);
        expect(cards[2].editable).toBe(true);
    });
});

describe("noteRunFace", () => {
    it("draws the skeleton only while the run is being read", () => {
        expect(noteRunFace({ run: undefined, loading: true, error: false })).toBe("loading");
    });
    it("says a run is gone once the read settles empty or fails, instead of a skeleton that never resolves", () => {
        expect(noteRunFace({ run: undefined, loading: false, error: false })).toBe("gone");
        expect(noteRunFace({ run: undefined, loading: false, error: true })).toBe("gone");
    });
    it("shows a run that loaded", () => {
        expect(noteRunFace({ run: { oid: "r1" } as Run, loading: false, error: false })).toBe("ready");
    });
});
