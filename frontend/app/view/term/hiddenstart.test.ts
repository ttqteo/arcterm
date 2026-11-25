import { describe, expect, it } from "vitest";
import { hiddenStartSize, startsWhileHidden } from "./hiddenstart";

describe("startsWhileHidden", () => {
    it("starts a new launch whose pane mounted hidden", () => {
        expect(startsWhileHidden({ hidden: true, started: false, replayed: false })).toBe(true);
    });

    it("leaves a restored pane with output for its first fit", () => {
        expect(startsWhileHidden({ hidden: true, started: false, replayed: true })).toBe(false);
    });

    it("leaves a pane on screen to its fit", () => {
        expect(startsWhileHidden({ hidden: false, started: false, replayed: false })).toBe(false);
    });

    it("does not start a pane twice", () => {
        expect(startsWhileHidden({ hidden: true, started: true, replayed: false })).toBe(false);
    });
});

describe("hiddenStartSize", () => {
    it("takes the size of a terminal on screen", () => {
        expect(hiddenStartSize([{ cols: 124, rows: 53 }], { cols: 80, rows: 24 })).toEqual({ cols: 124, rows: 53 });
    });

    it("skips an on-screen terminal with no size", () => {
        expect(
            hiddenStartSize(
                [
                    { cols: 0, rows: 0 },
                    { cols: 100, rows: 40 },
                ],
                { cols: 80, rows: 24 }
            )
        ).toEqual({ cols: 100, rows: 40 });
    });

    it("keeps the terminal's own size when none is on screen", () => {
        expect(hiddenStartSize([], { cols: 80, rows: 24 })).toEqual({ cols: 80, rows: 24 });
    });
});
