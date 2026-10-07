// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { describe, expect, it } from "vitest";
import { clampDockHeight, DOCK_DEFAULT_PX, DOCK_MIN_PX, splitDock } from "./terminaldock";

interface Item {
    id: string;
    kind?: string;
    blockId?: string;
}
const agent = (id: string): Item => ({ id, blockId: `b-${id}` });
const term = (id: string): Item => ({ id, kind: "terminal", blockId: `b-${id}` });

describe("clampDockHeight", () => {
    it("keeps a height inside the bounds", () => {
        expect(clampDockHeight(300, 1000)).toBe(300);
    });

    it("never goes under the floor", () => {
        expect(clampDockHeight(40, 1000)).toBe(DOCK_MIN_PX);
    });

    it("never takes more than 60% of the column", () => {
        expect(clampDockHeight(900, 1000)).toBe(600);
    });

    it("gives a column too short for the floor only its share", () => {
        expect(clampDockHeight(300, 150)).toBe(90);
    });

    it("applies only the floor before the column is measured", () => {
        expect(clampDockHeight(900, 0)).toBe(900);
        expect(clampDockHeight(40, 0)).toBe(DOCK_MIN_PX);
    });

    it("reads a stored value that is not a number as the default", () => {
        expect(clampDockHeight(NaN, 1000)).toBe(DOCK_DEFAULT_PX);
    });
});

describe("splitDock", () => {
    const agents = [agent("a1"), agent("a2")];
    const terminals = [term("t1"), term("t2")];

    it("docks a chosen terminal under the agent that was showing", () => {
        const s = splitDock({ focused: terminals[0], docked: null, host: "a2", agents, terminals });
        expect(s.focused?.id).toBe("a2");
        expect(s.docked?.id).toBe("t1");
        expect(s.dockedId).toBe("t1");
    });

    it("leaves the agent to the default when no agent was showing", () => {
        const s = splitDock({ focused: terminals[0], docked: null, host: null, agents, terminals });
        expect(s.focused).toBeUndefined();
        expect(s.dockedId).toBe("t1");
    });

    it("replaces the docked terminal with the newly chosen one", () => {
        const s = splitDock({ focused: terminals[1], docked: "t1", host: "a1", agents, terminals });
        expect(s.docked?.id).toBe("t2");
    });

    it("keeps the dock while an agent is focused", () => {
        const s = splitDock({ focused: agents[0], docked: "t2", host: "a1", agents, terminals });
        expect(s.focused?.id).toBe("a1");
        expect(s.docked?.id).toBe("t2");
    });

    it("shows a terminal alone when there is no agent", () => {
        const s = splitDock({ focused: terminals[0], docked: null, host: null, agents: [], terminals });
        expect(s.focused?.id).toBe("t1");
        expect(s.docked).toBeUndefined();
        expect(s.dockedId).toBeNull();
    });

    it("empties the dock when its terminal closed or has no block", () => {
        expect(splitDock({ focused: agents[0], docked: "gone", host: "a1", agents, terminals }).dockedId).toBeNull();
        const noBlock: Item[] = [{ id: "t3", kind: "terminal" }];
        expect(
            splitDock({ focused: agents[0], docked: "t3", host: "a1", agents, terminals: noBlock }).docked
        ).toBeUndefined();
    });
});
