// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { describe, expect, it } from "vitest";
import {
    agentInFocus,
    anchorRight,
    buildSavePayload,
    canSend,
    dragRect,
    frameWidth,
    MIN_REGION_PX,
    sentTitle,
    thumbCrop,
    toImageRegion,
    waitingLabel,
    type BugReportOpen,
} from "./bugreportboxmodel";

function open(over: Partial<BugReportOpen> = {}): BugReportOpen {
    return {
        kind: "open",
        capture: null,
        captureSize: null,
        region: null,
        selecting: false,
        surface: "cockpit",
        agent: null,
        ts: 1_700_000_000_000,
        waiting: 0,
        text: "chip gợi ý không hiện",
        sending: false,
        ...over,
    };
}

describe("canSend", () => {
    it("needs a non-space character", () => {
        expect(canSend("", false)).toBe(false);
        expect(canSend("   \n\t ", false)).toBe(false);
        expect(canSend("a", false)).toBe(true);
        expect(canSend("  chip không hiện  ", false)).toBe(true);
    });

    it("is off while a save is in flight, so Ctrl+Enter twice sends once", () => {
        expect(canSend("a", true)).toBe(false);
    });
});

describe("waitingLabel", () => {
    it("reads 'N đang chờ Jarvis' and says nothing at 0", () => {
        expect(waitingLabel(3)).toBe("3 đang chờ Jarvis");
        expect(waitingLabel(1)).toBe("1 đang chờ Jarvis");
        expect(waitingLabel(0)).toBe("");
    });

    it("says nothing for a count that is not a positive whole number", () => {
        expect(waitingLabel(-1)).toBe("");
        expect(waitingLabel(Number.NaN)).toBe("");
    });
});

describe("sentTitle", () => {
    it("names the count the save left waiting", () => {
        expect(sentTitle(4)).toBe("Đã gửi báo lỗi · 4 đang chờ Jarvis");
    });

    it("drops the count when the server reported none", () => {
        expect(sentTitle(0)).toBe("Đã gửi báo lỗi");
    });
});

describe("buildSavePayload", () => {
    it("carries the text trimmed, the press time, the version and commit, the surface and the agent", () => {
        const p = buildSavePayload(
            open({ text: "  chip không hiện\nsau lượt  ", agent: { id: "tab-1", name: "ghi-chu" }, surface: "agent" }),
            "AAAA",
            "0.15.11",
            "6000e1e37"
        );
        expect(p).toEqual({
            text: "chip không hiện\nsau lượt",
            ts: 1_700_000_000_000,
            version: "0.15.11",
            commit: "6000e1e37",
            surface: "agent",
            agent: { id: "tab-1", name: "ghi-chu" },
            screen64: "AAAA",
        });
    });

    it("leaves out what there is none of: no picture, no agent, no commit", () => {
        const p = buildSavePayload(open(), undefined, "0.15.11", "");
        expect(p).toEqual({
            text: "chip gợi ý không hiện",
            ts: 1_700_000_000_000,
            version: "0.15.11",
            surface: "cockpit",
        });
        expect("screen64" in p).toBe(false);
        expect("agent" in p).toBe(false);
        expect("commit" in p).toBe(false);
    });

    it("does not send the box's own bookkeeping", () => {
        const p = buildSavePayload(open({ waiting: 5, error: "x", sending: true }), undefined, "v", "");
        expect(Object.keys(p).sort()).toEqual(["surface", "text", "ts", "version"]);
    });
});

describe("agentInFocus", () => {
    const items = [
        { id: "a1", name: "ghi-chu" },
        { id: "t9", name: "zsh" },
    ];

    it("finds the agent or terminal the focus id names", () => {
        expect(agentInFocus(items, "a1")).toEqual({ id: "a1", name: "ghi-chu" });
        expect(agentInFocus(items, "t9")).toEqual({ id: "t9", name: "zsh" });
    });

    it("is null with no focus or an id that no longer exists", () => {
        expect(agentInFocus(items, undefined)).toBeNull();
        expect(agentInFocus(items, "gone")).toBeNull();
    });
});

describe("anchorRight", () => {
    it("lines the box's right edge up with the button's", () => {
        expect(anchorRight(1200, 1280)).toBe(80);
    });

    it("keeps the box on a narrow window", () => {
        // a button 40px from the left: the box (380px) cannot hang left of it, so it stops 8px from the right edge's far side
        expect(anchorRight(40, 800)).toBe(800 - 380 - 8);
    });

    it("keeps an 8px margin from the right edge", () => {
        expect(anchorRight(1280, 1280)).toBe(8);
    });

    it("falls back when there is no button on screen", () => {
        expect(anchorRight(null, 1280)).toBe(88);
    });
});

describe("buildSavePayload and the region", () => {
    const region = { x: 10, y: 20, w: 300, h: 64 };

    it("sends the region with the picture it was framed on", () => {
        expect(buildSavePayload(open({ region }), "AAAA", "1.3.0", "").region).toEqual(region);
    });

    it("sends no region without a picture, and none when nothing was framed", () => {
        expect(buildSavePayload(open({ region }), undefined, "1.3.0", "").region).toBeUndefined();
        expect("region" in buildSavePayload(open(), "AAAA", "1.3.0", "")).toBe(false);
    });
});

describe("dragRect", () => {
    const bounds = { w: 1000, h: 600 };

    it("spans the drag whichever way it went", () => {
        expect(dragRect({ x: 100, y: 50 }, { x: 400, y: 114 }, bounds)).toEqual({ x: 100, y: 50, w: 300, h: 64 });
        expect(dragRect({ x: 400, y: 114 }, { x: 100, y: 50 }, bounds)).toEqual({ x: 100, y: 50, w: 300, h: 64 });
    });

    it("is cut to the window", () => {
        expect(dragRect({ x: -40, y: 500 }, { x: 60, y: 900 }, bounds)).toEqual({ x: 0, y: 500, w: 60, h: 100 });
    });

    it("is null for a click or a sliver", () => {
        expect(dragRect({ x: 10, y: 10 }, { x: 10, y: 10 }, bounds)).toBeNull();
        expect(dragRect({ x: 10, y: 10 }, { x: 10 + MIN_REGION_PX - 1, y: 200 }, bounds)).toBeNull();
        expect(dragRect({ x: 995, y: 10 }, { x: 1400, y: 200 }, bounds)).toBeNull();
    });
});

describe("toImageRegion", () => {
    it("scales from the window to the picture's pixels (a 1.5x screen)", () => {
        expect(toImageRegion({ x: 100, y: 50, w: 300, h: 64 }, { w: 1000, h: 600 }, { w: 1500, h: 900 })).toEqual({
            x: 150,
            y: 75,
            w: 450,
            h: 96,
        });
    });

    it("keeps the region inside the picture", () => {
        const r = toImageRegion({ x: 990, y: 590, w: 10, h: 10 }, { w: 1000, h: 600 }, { w: 1000, h: 600 });
        expect(r.x + r.w).toBeLessThanOrEqual(1000);
        expect(r.y + r.h).toBeLessThanOrEqual(600);
    });
});

describe("frameWidth", () => {
    it("is 3 CSS px at the picture's scale, never under 2", () => {
        expect(frameWidth({ w: 2000, h: 1200 }, { w: 1000, h: 600 })).toBe(6);
        expect(frameWidth({ w: 500, h: 300 }, { w: 1000, h: 600 })).toBe(2);
    });
});

describe("thumbCrop", () => {
    it("scales the picture so the region fills the thumb, centred", () => {
        // a 300x64 region in a 96x60 thumb: the height decides (60/64), the width overflows and is centred
        const c = thumbCrop({ x: 100, y: 50, w: 300, h: 64 }, { w: 1000, h: 600 }, { w: 96, h: 60 });
        const s = 60 / 64;
        expect(c.width).toBeCloseTo(1000 * s);
        expect(c.height).toBeCloseTo(600 * s);
        expect(c.top).toBeCloseTo(-50 * s);
        expect(c.left).toBeCloseTo((96 - 300 * s) / 2 - 100 * s);
    });
});
