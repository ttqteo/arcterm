// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { describe, expect, it } from "vitest";
import { clampDockHeight, DOCK_DEFAULT_PX, DOCK_MIN_PX, dockHostId, lastOutputLine, splitDock } from "./terminaldock";

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

    it("does not dock a picked terminal: it is shown in the centre", () => {
        const s = splitDock({ focused: terminals[0], docked: null, agents, terminals });
        expect(s.focused?.id).toBe("t1");
        expect(s.docked).toBeUndefined();
        expect(s.dockedId).toBeNull();
    });

    it("keeps an explicitly docked terminal under the agent that is shown", () => {
        const s = splitDock({ focused: agents[1], docked: "t1", agents, terminals });
        expect(s.focused?.id).toBe("a2");
        expect(s.docked?.id).toBe("t1");
        expect(s.dockedId).toBe("t1");
    });

    it("undocks a docked terminal that becomes the focused one", () => {
        const s = splitDock({ focused: terminals[0], docked: "t1", agents, terminals });
        expect(s.focused?.id).toBe("t1");
        expect(s.docked).toBeUndefined();
        expect(s.dockedId).toBeNull();
    });

    it("keeps the dock when another terminal is picked, which takes the centre", () => {
        const s = splitDock({ focused: terminals[1], docked: "t1", agents, terminals });
        expect(s.focused?.id).toBe("t2");
        expect(s.docked?.id).toBe("t1");
    });

    it("keeps the dock while an agent is focused", () => {
        const s = splitDock({ focused: agents[0], docked: "t2", agents, terminals });
        expect(s.focused?.id).toBe("a1");
        expect(s.docked?.id).toBe("t2");
    });

    it("leaves the focus to the default when nothing is in focus", () => {
        const s = splitDock({ focused: undefined, docked: "t2", agents, terminals });
        expect(s.focused).toBeUndefined();
        expect(s.docked?.id).toBe("t2");
    });

    it("shows a terminal alone when there is no agent, and drops the dock it has nothing to sit under", () => {
        const s = splitDock({ focused: terminals[0], docked: null, agents: [], terminals });
        expect(s.focused?.id).toBe("t1");
        expect(s.docked).toBeUndefined();
        expect(s.dockedId).toBeNull();
        expect(splitDock({ focused: terminals[0], docked: "t2", agents: [], terminals }).dockedId).toBeNull();
    });

    it("empties the dock when its terminal closed or has no block", () => {
        expect(splitDock({ focused: agents[0], docked: "gone", agents, terminals }).dockedId).toBeNull();
        const noBlock: Item[] = [{ id: "t3", kind: "terminal" }];
        expect(splitDock({ focused: agents[0], docked: "t3", agents, terminals: noBlock }).docked).toBeUndefined();
    });
});

describe("dockHostId", () => {
    const roster = [agent("a1"), agent("a2"), { id: "a3" }];

    it("is the agent in view before the terminal", () => {
        expect(dockHostId(["t1", "a2", "a1"], roster, "t1")).toBe("a2");
    });

    it("skips terminals and agents that are gone or have no terminal in the recent list", () => {
        expect(dockHostId(["t1", "t2", "a3", "gone", "a1"], roster, "t1")).toBe("a1");
    });

    it("falls back to the first agent with a terminal when none was in view", () => {
        expect(dockHostId(["t1"], roster, "t1")).toBe("a1");
        expect(dockHostId([], roster, "t1")).toBe("a1");
    });

    it("is undefined with no agent to dock under", () => {
        expect(dockHostId(["t1"], [{ id: "a3" }], "t1")).toBeUndefined();
        expect(dockHostId(["t1"], [], "t1")).toBeUndefined();
    });
});

describe("lastOutputLine", () => {
    it("is the last line with text, trimmed", () => {
        expect(lastOutputLine(["a", "  12:42:02 [vite] hmr update  ", "", "   "])).toBe("12:42:02 [vite] hmr update");
    });

    it("is undefined for a screen with nothing on it", () => {
        expect(lastOutputLine([])).toBeUndefined();
        expect(lastOutputLine(["", "  "])).toBeUndefined();
    });
});
