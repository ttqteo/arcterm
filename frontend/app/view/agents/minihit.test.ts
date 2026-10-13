// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { describe, expect, it } from "vitest";
import {
    HOVER_DISMISSED,
    HOVER_ENTER_MS,
    HOVER_LEAVE_MS,
    HOVER_NONE,
    hitAny,
    nextHover,
    toPagePoint,
    type HoverState,
} from "./minihit";

const sprout = { left: 260, top: 32, right: 340, bottom: 112 };
const chip = { left: 40, top: 70, right: 250, bottom: 100 };

describe("hitAny", () => {
    it("hits inside a drawn box", () => {
        expect(hitAny({ x: 300, y: 70 }, [sprout, chip])).toBe(true);
        expect(hitAny({ x: 41, y: 99 }, [sprout, chip])).toBe(true);
    });
    it("passes through the see-through margin", () => {
        expect(hitAny({ x: 255, y: 70 }, [sprout, chip])).toBe(false);
        expect(hitAny({ x: 10, y: 10 }, [sprout, chip])).toBe(false);
    });
    it("counts the left and top edges in and the right and bottom edges out", () => {
        expect(hitAny({ x: 260, y: 32 }, [sprout])).toBe(true);
        expect(hitAny({ x: 340, y: 50 }, [sprout])).toBe(false);
        expect(hitAny({ x: 300, y: 112 }, [sprout])).toBe(false);
    });
    it("passes everything through when nothing is drawn", () => {
        expect(hitAny({ x: 300, y: 70 }, [])).toBe(false);
    });
});

describe("toPagePoint", () => {
    it("turns Windows' physical cursor into the page's CSS pixels", () => {
        expect(toPagePoint({ x: 2600, y: 1700 }, { x: 2000, y: 1500 }, { cursor: 2, window: 2 }, false)).toEqual({
            x: 300,
            y: 100,
        });
    });
    // macOS reports the cursor in the primary monitor's scale and the window in its own: a 2x laptop with Sprout on a
    // 1x monitor put every cursor far outside every box, and the window ignored all clicks
    it("measures in points on macOS when the cursor's scale and the window's differ", () => {
        const cursor = { x: 3080, y: 600 }; // points (1540, 300) at the 2x primary's scale
        const inner = { x: 1500, y: 250 }; // points (1500, 250) at the 1x window's scale
        expect(toPagePoint(cursor, inner, { cursor: 2, window: 1 }, true)).toEqual({ x: 40, y: 50 });
    });
});

describe("nextHover", () => {
    // poll the cursor from `start` every 67 ms (15 Hz) for `ms`, over or not
    const poll = (start: HoverState, over: boolean, ms: number, t0 = 0): { state: HoverState; at: number } => {
        let state = start;
        let at = t0;
        for (; at <= t0 + ms; at += 67) {
            state = nextHover(state, over, at);
        }
        return { state, at };
    };

    it("opens nothing for a cursor that passes over Sprout", () => {
        expect(poll(HOVER_NONE, true, HOVER_ENTER_MS - 70).state.shown).toBe(false);
    });
    it("opens the card once the cursor has rested on Sprout", () => {
        expect(poll(HOVER_NONE, true, HOVER_ENTER_MS + 70).state.shown).toBe(true);
    });
    it("starts the wait again when the cursor leaves before it is up", () => {
        const half = poll(HOVER_NONE, true, HOVER_ENTER_MS / 2);
        const gone = nextHover(half.state, false, half.at);
        expect(gone).toEqual(HOVER_NONE);
        expect(nextHover(gone, true, half.at + 67).shown).toBe(false);
    });
    it("keeps the card while the cursor travels to it, and closes it after", () => {
        const open: HoverState = { shown: true, since: null };
        expect(poll(open, false, HOVER_LEAVE_MS - 70).state.shown).toBe(true);
        expect(poll(open, false, HOVER_LEAVE_MS + 70).state.shown).toBe(false);
    });
    it("keeps the card when the cursor comes back in time", () => {
        const open: HoverState = { shown: true, since: null };
        const away = nextHover(open, false, 0);
        expect(nextHover(away, true, 100)).toEqual(open);
    });
    it("opens nothing for a cursor still resting on Sprout after a click closed the card", () => {
        expect(poll(HOVER_DISMISSED, true, HOVER_ENTER_MS * 4).state.shown).toBe(false);
    });
    it("opens the card again once the cursor has left and come back to rest", () => {
        const gone = nextHover(HOVER_DISMISSED, false, 0);
        expect(gone).toEqual(HOVER_NONE);
        expect(poll(gone, true, HOVER_ENTER_MS + 70, 67).state.shown).toBe(true);
    });
});
