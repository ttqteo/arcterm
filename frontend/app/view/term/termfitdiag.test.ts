import { describe, expect, it } from "vitest";
import { formatFitDiag, isStaleFit } from "./termfitdiag";

describe("isStaleFit", () => {
    it("is stale when the xterm is not the size its box fits", () => {
        expect(isStaleFit({ cols: 80, rows: 24 }, { cols: 132, rows: 50 })).toBe(true);
        expect(isStaleFit({ cols: 132, rows: 24 }, { cols: 132, rows: 50 })).toBe(true);
    });

    it("is not stale at the size its box fits", () => {
        expect(isStaleFit({ cols: 132, rows: 50 }, { cols: 132, rows: 50 })).toBe(false);
    });

    it("is not stale while the renderer cannot size a cell yet", () => {
        expect(isStaleFit({ cols: 80, rows: 24 }, undefined)).toBe(false);
        expect(isStaleFit({ cols: 80, rows: 24 }, { cols: NaN, rows: 50 })).toBe(false);
    });
});

describe("formatFitDiag", () => {
    it("names the event and the block, then each field that has a value", () => {
        const line = formatFitDiag("stale", "240f2cf7-bac1-4559-a4a2-f1d096252e15", {
            xterm: "80x24",
            fits: "132x50",
            hidden: false,
            ro: 0,
            sent: undefined,
            cell: null,
        });
        expect(line).toBe("[termfit] stale 240f2cf7 xterm=80x24 fits=132x50 hidden=false ro=0");
    });
});
