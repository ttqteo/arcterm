// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { describe, expect, it } from "vitest";
import {
    keepsSwitcher,
    openSwitcher,
    pickOf,
    pushRecent,
    RECENT_MAX,
    recentOrder,
    releasesSwitcher,
    stepSwitcher,
} from "./tabswitcher";

describe("pushRecent", () => {
    it("puts the id first, once", () => expect(pushRecent(["a", "b", "c"], "b")).toEqual(["b", "a", "c"]));
    it("adds a new id at the front", () => expect(pushRecent(["a"], "z")).toEqual(["z", "a"]));
    it("caps the history", () => {
        const long = Array.from({ length: RECENT_MAX }, (_, i) => `t${i}`);
        const next = pushRecent(long, "new");
        expect(next).toHaveLength(RECENT_MAX);
        expect(next[0]).toBe("new");
        expect(next).not.toContain(`t${RECENT_MAX - 1}`);
    });
});

describe("recentOrder", () => {
    const tabs = ["a", "b", "c", "d"];
    it("starts on the tab in view, then the recent ones, then the rest in ledge order", () =>
        expect(recentOrder(tabs, ["c", "a", "b"], "a")).toEqual(["a", "c", "b", "d"]));
    it("drops what is no longer a tab", () =>
        expect(recentOrder(tabs, ["gone", "d"], "b")).toEqual(["b", "d", "a", "c"]));
    it("falls back to the ledge order with no history", () => expect(recentOrder(tabs, [], null)).toEqual(tabs));
    it("leaves out an agent in view that is not a tab", () =>
        expect(recentOrder(tabs, ["c"], "worker")).toEqual(["c", "a", "b", "d"]));
});

describe("openSwitcher", () => {
    const ids = ["a", "b", "c"];
    it("picks the tab before the one in view on Ctrl+Tab", () => {
        const s = openSwitcher(ids, "a", 1, "ctrl")!;
        expect(pickOf(s)).toBe("b");
        expect(s.shown).toBe(false);
    });
    it("picks the oldest on Ctrl+Shift+Tab", () => expect(pickOf(openSwitcher(ids, "a", -1, "ctrl")!)).toBe("c"));
    it("starts at an end when the one in view is not a tab", () => {
        expect(pickOf(openSwitcher(ids, "worker", 1, "ctrl")!)).toBe("a");
        expect(pickOf(openSwitcher(ids, "worker", -1, "ctrl")!)).toBe("c");
    });
    it("does not open with one tab", () => expect(openSwitcher(["a"], "a", 1, "ctrl")).toBeNull());
});

describe("stepSwitcher", () => {
    const s = openSwitcher(["a", "b", "c"], "a", 1, "alt")!;
    it("moves the pick and draws the switcher", () => {
        const next = stepSwitcher(s, 1);
        expect(pickOf(next)).toBe("c");
        expect(next.shown).toBe(true);
    });
    it("wraps at both ends", () => {
        expect(pickOf(stepSwitcher(stepSwitcher(s, 1), 1))).toBe("a");
        expect(pickOf(stepSwitcher(stepSwitcher(s, -1), -1))).toBe("c");
    });
});

describe("releasesSwitcher", () => {
    it("opens the pick when the modifier that opened it goes up", () => {
        expect(releasesSwitcher(openSwitcher(["a", "b"], "a", 1, "ctrl")!, "Control")).toBe(true);
        expect(releasesSwitcher(openSwitcher(["a", "b"], "a", 1, "alt")!, "Alt")).toBe(true);
    });
    it("ignores the other modifier and Shift", () => {
        const s = openSwitcher(["a", "b"], "a", 1, "ctrl")!;
        expect(releasesSwitcher(s, "Alt")).toBe(false);
        expect(releasesSwitcher(s, "Shift")).toBe(false);
    });
});

describe("keepsSwitcher", () => {
    it("stays open through Tab, Escape and the modifiers", () => {
        for (const key of ["Tab", "Escape", "Control", "Alt", "Shift", "Meta"]) {
            expect(keepsSwitcher(key), key).toBe(true);
        }
    });
    it("closes on any other key", () => {
        expect(keepsSwitcher("c")).toBe(false);
        expect(keepsSwitcher("Enter")).toBe(false);
    });
});
