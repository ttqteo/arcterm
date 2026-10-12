import { describe, expect, it } from "vitest";
import {
    canQuote,
    pickQuote,
    quoteDelayMs,
    quoteEvent,
    quotePool,
    QUOTES,
    SPIDEY_QUOTES,
    type QuoteMoment,
} from "./petquotes";

const QUIET: QuoteMoment = {
    enabled: true,
    expression: "at-rest",
    posture: "none",
    speaking: false,
    peekOpen: false,
    focused: true,
};

describe("QUOTES", () => {
    it("holds a few dozen, each with its author", () => {
        expect(QUOTES.length).toBeGreaterThanOrEqual(30);
        for (const q of QUOTES) {
            expect(q.text.trim()).not.toBe("");
            expect(q.author.trim()).not.toBe("");
        }
    });

    // the bubble is 268px wide and clamps its body: a longer line would be cut mid-sentence
    it("keeps every quote short enough for the bubble", () => {
        for (const q of QUOTES) {
            expect(q.text.length, q.text).toBeLessThanOrEqual(125);
        }
    });

    it("never repeats a quote", () => {
        expect(new Set(QUOTES.map((q) => q.text)).size).toBe(QUOTES.length);
    });

    it("never uses an em dash", () => {
        for (const q of QUOTES) {
            expect(q.text + q.author).not.toContain("—");
        }
    });
});

describe("quoteDelayMs", () => {
    it("waits between 45 and 90 minutes", () => {
        expect(quoteDelayMs(0)).toBe(45 * 60_000);
        expect(quoteDelayMs(1)).toBe(90 * 60_000);
        expect(quoteDelayMs(0.5)).toBe(67.5 * 60_000);
    });
});

// a quote is idle talk: it never speaks over anything the creature has to say, nor to a window you are not in
describe("canQuote", () => {
    it("speaks when the creature is quiet and you are here", () => {
        expect(canQuote(QUIET)).toBe(true);
    });

    it("keeps quiet when turned off", () => expect(canQuote({ ...QUIET, enabled: false })).toBe(false));
    it("keeps quiet while something waits on you", () =>
        expect(canQuote({ ...QUIET, posture: "blocked-worker" })).toBe(false));
    it("keeps quiet while tired", () => expect(canQuote({ ...QUIET, expression: "tired" })).toBe(false));
    it("keeps quiet over another bubble", () => expect(canQuote({ ...QUIET, speaking: true })).toBe(false));
    it("keeps quiet with the popup open", () => expect(canQuote({ ...QUIET, peekOpen: true })).toBe(false));
    it("keeps quiet while arcterm is in the background", () =>
        expect(canQuote({ ...QUIET, focused: false })).toBe(false));
});

describe("pickQuote", () => {
    it("maps a random number onto the list", () => {
        expect(pickQuote(0, -1)).toBe(0);
        expect(pickQuote(0.999, -1)).toBe(QUOTES.length - 1);
    });

    it("does not say the same quote twice in a row", () => {
        expect(pickQuote(0, 0)).not.toBe(0);
        expect(pickQuote(0.999, QUOTES.length - 1)).not.toBe(QUOTES.length - 1);
    });
});

describe("quoteEvent", () => {
    it("says the quote in curly quotes, with its author as the label", () => {
        const q = QUOTES[0];
        expect(quoteEvent(0, 5000)).toEqual({
            id: "quote:5000",
            at: 5000,
            kind: "quote",
            text: `“${q.text}”`,
            detail: q.author,
        });
    });
});

describe("SPIDEY_QUOTES", () => {
    it("keeps his lines to the bubble's rules: authored, short, no em dash, none said twice", () => {
        for (const q of SPIDEY_QUOTES) {
            expect(q.author.trim()).not.toBe("");
            expect(q.text.length, q.text).toBeLessThanOrEqual(125);
            expect(q.text + q.author).not.toContain("—");
        }
        const all = [...QUOTES, ...SPIDEY_QUOTES].map((q) => q.text);
        expect(new Set(all).size).toBe(all.length);
    });
});

describe("quotePool", () => {
    it("mixes Spider-Man's lines in only while he is the character", () => {
        expect(quotePool("sprout")).toBe(QUOTES);
        expect(quotePool("minion")).toBe(QUOTES);
        expect(quotePool("spidey")).toEqual([...QUOTES, ...SPIDEY_QUOTES]);
    });

    it("picks and says from the pool it is given", () => {
        const pool = quotePool("spidey");
        expect(pickQuote(0.999, -1, pool)).toBe(pool.length - 1);
        expect(quoteEvent(pool.length - 1, 1, pool).detail).toBe(SPIDEY_QUOTES[SPIDEY_QUOTES.length - 1].author);
    });
});
