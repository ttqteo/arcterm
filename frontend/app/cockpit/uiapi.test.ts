// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import type { CommandItem } from "@/app/cockpit/palette-commands";
import { describe, expect, it } from "vitest";
import {
    BUSY_POLL_MS,
    BUSY_WAIT_MS,
    callerName,
    isBusy,
    parseSurfaceAddress,
    resolveAction,
    revealError,
    revealLeavesTrail,
    revealWaitsForUser,
    selectionFor,
    toUiActions,
    USER_IDLE_MS,
    waitUntilIdle,
    type SelectionSnapshot,
} from "./uiapi";

const empty: SelectionSnapshot = {
    focusId: undefined,
    subject: null,
    activeRunIds: {},
    peekRecordId: null,
    radarReportId: undefined,
};

const item = (key: string, over: Partial<CommandItem> = {}): CommandItem => ({
    key,
    title: key,
    group: "Global",
    run: () => {},
    ...over,
});

describe("selectionFor", () => {
    it("reports the focused terminal on the Agent surface", () => {
        expect(selectionFor("agent", { ...empty, focusId: "t1" })).toEqual(["agent:t1"]);
        expect(selectionFor("agent", empty)).toEqual([]);
    });

    it("reports a jarvis channel subject with its own active run", () => {
        const s = { ...empty, subject: { kind: "channel", id: "c1" }, activeRunIds: { c1: "r1", c2: "r9" } };
        expect(selectionFor("jarvis", s)).toEqual(["channel:c1", "run:r1"]);
    });

    it("reports a channel with no active run as the channel alone", () => {
        expect(selectionFor("jarvis", { ...empty, subject: { kind: "channel", id: "c1" } })).toEqual(["channel:c1"]);
    });

    it("reports effort and dossier subjects in the address dialect", () => {
        expect(selectionFor("jarvis", { ...empty, subject: { kind: "effort", id: "e1" } })).toEqual(["effort:e1"]);
        expect(selectionFor("jarvis", { ...empty, subject: { kind: "dossier", id: "d1" } })).toEqual(["task:d1"]);
    });

    it("omits subjects that have no address", () => {
        expect(selectionFor("jarvis", { ...empty, subject: { kind: "briefing", id: "x" } })).toEqual([]);
    });

    it("adds an open record peek, once", () => {
        expect(selectionFor("jarvis", { ...empty, peekRecordId: "d2" })).toEqual(["task:d2"]);
        const same = { ...empty, subject: { kind: "dossier", id: "d1" }, peekRecordId: "d1" };
        expect(selectionFor("jarvis", same)).toEqual(["task:d1"]);
    });

    it("reports the radar report", () => {
        expect(selectionFor("radar", { ...empty, radarReportId: "rr1" })).toEqual(["radarreport:rr1"]);
    });

    it("reports nothing on surfaces without an addressed selection, whatever else is set", () => {
        const s = { ...empty, focusId: "t1", radarReportId: "rr1" };
        expect(selectionFor("usage", s)).toEqual([]);
        expect(selectionFor("cockpit", s)).toEqual([]);
    });
});

describe("toUiActions", () => {
    it("maps palette items to the wire shape, carrying destructive only when set", () => {
        expect(toUiActions([item("a", { title: "Do A", group: "G" }), item("b", { destructive: true })])).toEqual([
            { id: "a", label: "Do A", group: "G" },
            { id: "b", label: "b", group: "Global", destructive: true },
        ]);
    });
});

describe("resolveAction", () => {
    it("finds an available action by id", () => {
        const r = resolveAction([item("a"), item("b")], "b", "usage");
        expect("item" in r && r.item.key).toBe("b");
    });

    it("rejects an id that is not available now, pointing at the actions list", () => {
        const r = resolveAction([item("a")], "code:save", "usage");
        expect("error" in r && r.error).toBe(
            '"code:save" is not an available action on usage right now; see wsh ui actions'
        );
    });
});

describe("parseSurfaceAddress", () => {
    it("is null for a non-surface address, leaving it to the shared router", () => {
        expect(parseSurfaceAddress("run:r1")).toBeNull();
    });

    it("accepts rail surfaces, setup and settings", () => {
        expect(parseSurfaceAddress("surface:usage")).toEqual({ surface: "usage" });
        expect(parseSurfaceAddress("surface:setup")).toEqual({ surface: "setup" });
        expect(parseSurfaceAddress("surface:settings")).toEqual({ surface: "settings" });
    });

    it("rejects an unknown surface and lists the valid ones", () => {
        const r = parseSurfaceAddress("surface:nope");
        expect(r != null && "error" in r && r.error).toMatch(/^unknown surface "nope"; one of cockpit, /);
    });
});

describe("revealError", () => {
    it("names a superseded landing for what it is", () => {
        expect(revealError("run:r1", "superseded", "")).toBe("superseded by a newer navigation");
    });

    it("points an unsupported address at the grammar", () => {
        expect(revealError("bogus", "unsupported", "This item can't be opened")).toBe(
            'unsupported address "bogus"; see wsh ui reveal --help'
        );
    });

    it("passes the router's own message through otherwise", () => {
        expect(revealError("run:r1", "unavailable", "That run no longer exists")).toBe("That run no longer exists");
    });
});

describe("isBusy", () => {
    it("is busy just inside the idle window and idle at its edge", () => {
        expect(isBusy(10_000, 10_000 - USER_IDLE_MS + 1, false)).toBe(true);
        expect(isBusy(10_000, 10_000 - USER_IDLE_MS, false)).toBe(false);
    });

    it("is busy whenever a modal is open", () => {
        expect(isBusy(10_000, 0, true)).toBe(true);
    });
});

function fakeClock(start: number) {
    let t = start;
    return {
        now: () => t,
        sleep: async (ms: number) => {
            t += ms;
        },
    };
}

describe("waitUntilIdle", () => {
    it("returns at once when the user is idle", async () => {
        const c = fakeClock(10_000);
        expect(await waitUntilIdle({ ...c, lastKeyTs: () => 0, modalOpen: () => false })).toBe(true);
        expect(c.now()).toBe(10_000);
    });

    it("waits out a recent keystroke, then proceeds", async () => {
        const c = fakeClock(10_000);
        expect(await waitUntilIdle({ ...c, lastKeyTs: () => 10_000, modalOpen: () => false })).toBe(true);
        expect(c.now()).toBeGreaterThanOrEqual(10_000 + USER_IDLE_MS);
        expect(c.now()).toBeLessThan(10_000 + USER_IDLE_MS + BUSY_POLL_MS);
    });

    it("gives up after BUSY_WAIT_MS while a modal stays open", async () => {
        const c = fakeClock(10_000);
        expect(await waitUntilIdle({ ...c, lastKeyTs: () => 0, modalOpen: () => true })).toBe(false);
        expect(c.now()).toBeGreaterThanOrEqual(10_000 + BUSY_WAIT_MS);
    });
});

describe("revealWaitsForUser", () => {
    it("lets an agent attach its canvas while the user is busy", () => {
        expect(revealWaitsForUser("canvas:dag-activity-rail", "b1")).toBe(false);
        expect(revealWaitsForUser("canvas:t/States", "b1")).toBe(false);
    });

    it("waits when the reveal moves the user", () => {
        // with no caller a canvas reveal jumps to the agent that has it open
        expect(revealWaitsForUser("canvas:dag-activity-rail", undefined)).toBe(true);
        expect(revealWaitsForUser("run:abc", "b1")).toBe(true);
        expect(revealWaitsForUser("surface:files", "b1")).toBe(true);
    });
});

describe("revealLeavesTrail", () => {
    it("announces a canvas the caller did not have attached", () => {
        expect(revealLeavesTrail("canvas:t", undefined)).toBe(true);
        expect(revealLeavesTrail("canvas:t", "other")).toBe(true);
    });

    it("stays quiet when the caller reveals the canvas it already has", () => {
        expect(revealLeavesTrail("canvas:t", "t")).toBe(false);
        expect(revealLeavesTrail("canvas:t/States", "t")).toBe(false);
    });

    it("announces every other move", () => {
        expect(revealLeavesTrail("run:t", "t")).toBe(true);
        expect(revealLeavesTrail("agent:t", "t")).toBe(true);
    });
});

describe("callerName", () => {
    const roster = [{ blockId: "b1", name: "claude · waveterm" }];

    it("names the calling agent by its block", () => {
        expect(callerName(roster, "b1")).toBe("claude · waveterm");
    });

    it("falls back when the caller is unknown or absent", () => {
        expect(callerName(roster, "zz")).toBe("An agent");
        expect(callerName(roster, undefined)).toBe("An agent");
    });
});
