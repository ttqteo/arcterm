import { describe, expect, it } from "vitest";
import {
    captureAction,
    chipPlacement,
    chipVisible,
    cleanSelection,
    IDEA_MAX_CHARS,
    INPUT_REQUEST_TTL_MS,
    inputRequestLive,
    selectionAnchor,
    type Box,
} from "./ideacapture";

describe("cleanSelection", () => {
    it("collapses whitespace runs, newlines included, and trims", () => {
        expect(cleanSelection("  Stop hook  đếm số lượt\n   không có idea \t nào.  ")).toBe(
            "Stop hook đếm số lượt không có idea nào."
        );
    });

    it("is null when nothing but whitespace was selected", () => {
        expect(cleanSelection("")).toBeNull();
        expect(cleanSelection(" \n\t  ")).toBeNull();
        expect(cleanSelection(null)).toBeNull();
        expect(cleanSelection(undefined)).toBeNull();
    });

    it("keeps a selection of exactly the cap and cuts a longer one to it", () => {
        const exact = "a".repeat(IDEA_MAX_CHARS);
        expect(cleanSelection(exact)).toBe(exact);
        expect(cleanSelection(exact + "bcd")).toBe(exact);
    });

    it("leaves no space at the end of a cut", () => {
        const text = "a".repeat(IDEA_MAX_CHARS - 1) + " tail";
        const out = cleanSelection(text)!;
        expect(out).toBe("a".repeat(IDEA_MAX_CHARS - 1));
        expect(out.endsWith(" ")).toBe(false);
    });

    it("does not cut an emoji in half", () => {
        const out = cleanSelection("a".repeat(IDEA_MAX_CHARS - 1) + "😀 more")!;
        expect(out).toBe("a".repeat(IDEA_MAX_CHARS - 1));
        expect(out.length).toBeLessThanOrEqual(IDEA_MAX_CHARS);
    });
});

describe("chipVisible", () => {
    it("shows for a selection in an agent's terminal that nothing has dismissed", () => {
        expect(chipVisible({ hasSelection: true, hasSession: true, typedSinceSelect: false })).toBe(true);
    });

    it("hides without a selection, without a session, or once a key was typed", () => {
        expect(chipVisible({ hasSelection: false, hasSession: true, typedSinceSelect: false })).toBe(false);
        expect(chipVisible({ hasSelection: true, hasSession: false, typedSinceSelect: false })).toBe(false);
        expect(chipVisible({ hasSelection: true, hasSession: true, typedSinceSelect: true })).toBe(false);
    });
});

describe("captureAction", () => {
    it("adds a selection to the session's ideas", () => {
        expect(captureAction({ selection: "Stop hook counts turns", sessionId: "abc-1" })).toBe("add");
    });

    it("opens the Ideas input when nothing is selected", () => {
        expect(captureAction({ selection: null, sessionId: "abc-1" })).toBe("open-input");
    });

    it("does nothing where there is no session to add to", () => {
        expect(captureAction({ selection: "text", sessionId: null })).toBe("none");
        expect(captureAction({ selection: null, sessionId: null })).toBe("none");
    });
});

describe("inputRequestLive", () => {
    const request = { sessionId: "abc-1", at: 10_000 };

    it("holds for the session it was made for, for a few seconds", () => {
        expect(inputRequestLive(request, "abc-1", 10_000)).toBe(true);
        expect(inputRequestLive(request, "abc-1", 10_000 + INPUT_REQUEST_TTL_MS)).toBe(true);
        expect(inputRequestLive(request, "abc-1", 10_001 + INPUT_REQUEST_TTL_MS)).toBe(false);
    });

    it("is not for another session, nor for none, nor when nothing was asked", () => {
        expect(inputRequestLive(request, "other", 10_000)).toBe(false);
        expect(inputRequestLive(request, null, 10_000)).toBe(false);
        expect(inputRequestLive(null, "abc-1", 10_000)).toBe(false);
    });
});

describe("selectionAnchor", () => {
    it("turns the selection's end into a column and a row on screen", () => {
        // the buffer holds 100 scrollback rows above a 24-row screen: viewportY is the first row on screen
        expect(selectionAnchor({ x: 40, y: 112 }, 100, 24)).toEqual({ col: 40, row: 12 });
    });

    it("is null when the end has scrolled off either side of the screen", () => {
        expect(selectionAnchor({ x: 3, y: 99 }, 100, 24)).toBeNull();
        expect(selectionAnchor({ x: 3, y: 124 }, 100, 24)).toBeNull();
    });
});

describe("chipPlacement", () => {
    // an 80x24 terminal drawn at 8x16 cells, 5px in from the corner of a 700x420 pane
    const host: Box = { left: 100, top: 50, width: 700, height: 420 };
    const screen: Box = { left: 105, top: 55, width: 640, height: 384 };
    const chip = { width: 160, height: 28 };
    const place = (col: number, row: number) =>
        chipPlacement({ anchor: { col, row }, cols: 80, rows: 24, screen, host, chip });

    it("sits just under the line the selection ends on, at the column it ends", () => {
        // col 10 → 5 + 80 = 85px in; row 3 ends at 5 + 4 * 16 = 69px down, and a 4px gap
        expect(place(10, 3)).toEqual({ left: 85, top: 73 });
    });

    it("slides left to stay inside the pane", () => {
        // col 78 would put the chip at 629px, past the 700 - 160 - 4 = 536px the pane has room for
        expect(place(78, 3).left).toBe(536);
    });

    it("goes above the line when there is no room under it", () => {
        // the last row ends at 5 + 24 * 16 = 389px: 28px more would end at 421px, past the pane's 416px
        const p = place(10, 23);
        expect(p.top).toBe(5 + 23 * 16 - 4 - 28);
    });

    it("never leaves the pane's top or left edge", () => {
        const tiny: Box = { left: 100, top: 50, width: 100, height: 20 };
        const p = chipPlacement({ anchor: { col: 0, row: 0 }, cols: 80, rows: 24, screen, host: tiny, chip });
        expect(p.left).toBeGreaterThanOrEqual(4);
        expect(p.top).toBeGreaterThanOrEqual(4);
    });
});
