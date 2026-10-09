// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { describe, expect, it } from "vitest";
import type { SubagentVM } from "./session-models/sessionviewmodel";
import { statusChangedIds, workingChildIds } from "./subagentrefresh";

describe("statusChangedIds", () => {
    it("records a first sighting without reporting it", () => {
        const prev = new Map<string, string>();
        expect(statusChangedIds(prev, [{ id: "a", state: "working", stateSince: 1 }])).toEqual([]);
        expect(prev.has("a")).toBe(true);
    });

    it("reports a parent that went idle, and only it", () => {
        const prev = new Map<string, string>();
        statusChangedIds(prev, [
            { id: "a", state: "working", stateSince: 1 },
            { id: "b", state: "idle", idleSince: 5 },
        ]);
        const changed = statusChangedIds(prev, [
            { id: "a", state: "idle", idleSince: 9 },
            { id: "b", state: "idle", idleSince: 5 },
        ]);
        expect(changed).toEqual(["a"]);
    });

    it("reports a new working turn, which restarts stateSince", () => {
        const prev = new Map<string, string>();
        statusChangedIds(prev, [{ id: "a", state: "working", stateSince: 1 }]);
        expect(statusChangedIds(prev, [{ id: "a", state: "working", stateSince: 7 }])).toEqual(["a"]);
    });

    it("forgets an agent that left, so its return counts as a first sighting", () => {
        const prev = new Map<string, string>();
        statusChangedIds(prev, [{ id: "a", state: "working", stateSince: 1 }]);
        statusChangedIds(prev, []);
        expect(statusChangedIds(prev, [{ id: "a", state: "idle", idleSince: 2 }])).toEqual([]);
    });
});

describe("workingChildIds", () => {
    const sub = (state: SubagentVM["state"]): SubagentVM => ({ id: state, type: "Explore", state });

    it("names only parents with a child still working", () => {
        const subs = { a: [sub("done"), sub("working")], b: [sub("done")], c: [sub("failure")] };
        expect(workingChildIds([{ id: "a" }, { id: "b" }, { id: "c" }, { id: "d" }], subs)).toEqual(["a"]);
    });
});
