// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { describe, expect, it } from "vitest";
import {
    AGENT_DRAG_MIME,
    EDGE_FRACTION,
    allowedZones,
    isAgentDrag,
    resolveDrop,
    zoneBox,
    zoneFromPoint,
    zoneLabel,
} from "./griddrop";

const rect = { left: 100, top: 50, width: 400, height: 200 };
// the zone at a point given as a fraction of the rect
const at = (u: number, v: number) => zoneFromPoint(rect, rect.left + rect.width * u, rect.top + rect.height * v);
// the zone at an offset in px from the rect's top-left
const off = (dx: number, dy: number) => zoneFromPoint(rect, rect.left + dx, rect.top + dy);

describe("zoneFromPoint", () => {
    it("the middle of a cell is the centre", () => {
        expect(at(0.5, 0.5)).toBe("center");
        expect(at(0.3, 0.3)).toBe("center");
        expect(at(0.7, 0.7)).toBe("center");
    });
    it("the outer quarter on a side is that edge", () => {
        expect(at(0.1, 0.5)).toBe("left");
        expect(at(0.9, 0.5)).toBe("right");
        expect(at(0.5, 0.1)).toBe("top");
        expect(at(0.5, 0.9)).toBe("bottom");
    });
    it("the edge starts exactly one quarter in", () => {
        expect(EDGE_FRACTION).toBe(0.25);
        expect(off(100, 100)).toBe("center"); // 25% across: still the centre
        expect(off(99, 100)).toBe("left");
        expect(off(300, 100)).toBe("center"); // 75% across
        expect(off(301, 100)).toBe("right");
        expect(off(200, 50)).toBe("center"); // 25% down
        expect(off(200, 49)).toBe("top");
        expect(off(200, 150)).toBe("center"); // 75% down
        expect(off(200, 151)).toBe("bottom");
    });
    it("a corner goes to the nearer edge, the horizontal one on a tie", () => {
        expect(off(0, 0)).toBe("left");
        expect(off(0, 200)).toBe("left");
        expect(off(400, 0)).toBe("right");
        expect(off(400, 200)).toBe("right");
        expect(at(0.2, 0.02)).toBe("top");
        expect(at(0.02, 0.2)).toBe("left");
        expect(at(0.8, 0.98)).toBe("bottom");
    });
    it("a point outside the rect clamps to the nearest edge", () => {
        expect(at(-1, 0.5)).toBe("left");
        expect(at(2, 0.5)).toBe("right");
        expect(at(0.5, -3)).toBe("top");
        expect(at(0.5, 5)).toBe("bottom");
    });
    it("a rect with no area, or a non-finite point, is the centre", () => {
        expect(zoneFromPoint({ left: 0, top: 0, width: 0, height: 100 }, 5, 5)).toBe("center");
        expect(zoneFromPoint({ left: 0, top: 0, width: 100, height: 0 }, 5, 5)).toBe("center");
        expect(zoneFromPoint({ left: 0, top: 0, width: -10, height: 100 }, 5, 5)).toBe("center");
        expect(zoneFromPoint(rect, Number.NaN, 100)).toBe("center");
        expect(zoneFromPoint(rect, 200, Number.NaN)).toBe("center");
    });
});

describe("allowedZones", () => {
    it("offers every zone until the grid is full", () => {
        for (const n of [0, 1, 2, 3]) {
            expect(allowedZones(n)).toEqual(["center", "left", "right", "top", "bottom"]);
        }
    });
    it("offers only the swap at four cells", () => {
        expect(allowedZones(4)).toEqual(["center"]);
        expect(allowedZones(9)).toEqual(["center"]);
    });
});

describe("resolveDrop", () => {
    it("finds the target's index in the grid as it is now, so a drop never lands on a stale position", () => {
        expect(resolveDrop(["a", "b", "c"], "c", "left")).toEqual({ index: 2, zone: "left" });
        // the grid changed between the hover and the drop: the target moved from 2 to 0
        expect(resolveDrop(["c", "a"], "c", "left")).toEqual({ index: 0, zone: "left" });
    });
    it("is null when the target has left the grid", () => {
        expect(resolveDrop(["a", "b"], "c", "center")).toBeNull();
        expect(resolveDrop([], "a", "center")).toBeNull();
    });
    it("turns an edge into the swap once the grid is full, which is all a full grid offers", () => {
        expect(resolveDrop(["a", "b", "c", "d"], "b", "right")).toEqual({ index: 1, zone: "center" });
        expect(resolveDrop(["a", "b", "c", "d"], "b", "center")).toEqual({ index: 1, zone: "center" });
        expect(resolveDrop(["a", "b", "c"], "b", "right")).toEqual({ index: 1, zone: "right" });
    });
});

describe("isAgentDrag", () => {
    it("is true only for a drag that carries the agent MIME", () => {
        expect(isAgentDrag(["Files", AGENT_DRAG_MIME])).toBe(true);
        expect(isAgentDrag({ length: 1, 0: AGENT_DRAG_MIME } as ArrayLike<string>)).toBe(true);
        expect(isAgentDrag(["Files"])).toBe(false);
        expect(isAgentDrag(["text/plain"])).toBe(false);
        expect(isAgentDrag([])).toBe(false);
        expect(isAgentDrag(null)).toBe(false);
        expect(isAgentDrag(undefined)).toBe(false);
    });
    it("uses the documented MIME", () => {
        expect(AGENT_DRAG_MIME).toBe("application/x-arc-agent");
    });
});

describe("zoneBox", () => {
    it("previews where the dropped agent will sit, as percentages of the cell", () => {
        expect(zoneBox("center")).toEqual({ left: 25, top: 25, width: 50, height: 50 });
        expect(zoneBox("left")).toEqual({ left: 0, top: 0, width: 50, height: 100 });
        expect(zoneBox("right")).toEqual({ left: 50, top: 0, width: 50, height: 100 });
        expect(zoneBox("top")).toEqual({ left: 0, top: 0, width: 100, height: 50 });
        expect(zoneBox("bottom")).toEqual({ left: 0, top: 50, width: 100, height: 50 });
    });
});

describe("zoneLabel", () => {
    it("says what a drop will do", () => {
        expect(zoneLabel("center", false)).toBe("Replace");
        expect(zoneLabel("center", true)).toBe("Swap");
        expect(zoneLabel("left", false)).toBe("Place before");
        expect(zoneLabel("top", true)).toBe("Place before");
        expect(zoneLabel("right", false)).toBe("Place after");
        expect(zoneLabel("bottom", true)).toBe("Place after");
    });
});
