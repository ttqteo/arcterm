// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { describe, expect, it, vi } from "vitest";
import {
    COUNCIL_OPENED_KEY,
    isUnreadCouncil,
    loadOpened,
    markOpened,
    openedAt,
    saveOpened,
    type CouncilOpenedMap,
    type OpenedStore,
} from "./councilopened";

function memStore(init: Record<string, string> = {}): OpenedStore & { data: Record<string, string> } {
    const data = { ...init };
    return {
        data,
        getItem: (k) => (k in data ? data[k] : null),
        setItem: (k, v) => {
            data[k] = v;
        },
    };
}

function council(over: Partial<Council>): Council {
    return {
        id: "c1",
        project: "p",
        feature: "f",
        experts: [],
        state: "done",
        round: 3,
        tokens: 0,
        calls: 0,
        created: 0,
        updated: 0,
        ...over,
    };
}

const MAP: CouncilOpenedMap = { seededAt: 1_000, opened: { seen: 5_000 } };

describe("loadOpened", () => {
    it("sets seededAt on the first read, persists it, and keeps it on later reads", () => {
        const store = memStore();
        const first = loadOpened(store, 100);
        expect(first).toEqual({ seededAt: 100, opened: {} });
        expect(JSON.parse(store.data[COUNCIL_OPENED_KEY])).toEqual({ seededAt: 100, opened: {} });
        const again = loadOpened(store, 900);
        expect(again.seededAt).toBe(100);
    });

    it("reads back the opened times it saved", () => {
        const store = memStore();
        saveOpened(store, { seededAt: 7, opened: { a: 20 } });
        expect(loadOpened(store, 99)).toEqual({ seededAt: 7, opened: { a: 20 } });
    });

    it("starts again on a stored value it cannot read, dropping non-number times", () => {
        const store = memStore({ [COUNCIL_OPENED_KEY]: "{not json" });
        expect(loadOpened(store, 50)).toEqual({ seededAt: 50, opened: {} });
        const partly = memStore({ [COUNCIL_OPENED_KEY]: JSON.stringify({ seededAt: 3, opened: { a: 4, b: "x" } }) });
        expect(loadOpened(partly, 50)).toEqual({ seededAt: 3, opened: { a: 4 } });
    });

    it("works on an in-memory map when the store throws", () => {
        const err = vi.spyOn(console, "error").mockImplementation(() => {});
        const broken: OpenedStore = {
            getItem: () => {
                throw new Error("denied");
            },
            setItem: () => {
                throw new Error("denied");
            },
        };
        expect(loadOpened(broken, 42)).toEqual({ seededAt: 42, opened: {} });
        expect(() => saveOpened(broken, MAP)).not.toThrow();
        expect(loadOpened(undefined, 43)).toEqual({ seededAt: 43, opened: {} });
        err.mockRestore();
    });
});

describe("openedAt", () => {
    it("is the council's own time, else seededAt", () => {
        expect(openedAt(MAP, "seen")).toBe(5_000);
        expect(openedAt(MAP, "never")).toBe(1_000);
    });
});

describe("isUnreadCouncil", () => {
    it("is unread when it ended after it was last opened", () => {
        expect(isUnreadCouncil(council({ id: "seen", updated: 6_000 }), MAP)).toBe(true);
        expect(isUnreadCouncil(council({ id: "seen", updated: 4_000 }), MAP)).toBe(false);
    });

    it("is unread when never opened and it ended after seededAt", () => {
        expect(isUnreadCouncil(council({ id: "never", state: "stopped", updated: 2_000 }), MAP)).toBe(true);
    });

    it("is not unread when it ended before seededAt", () => {
        expect(isUnreadCouncil(council({ id: "never", state: "failed", updated: 900 }), MAP)).toBe(false);
    });

    it("is not unread while running, waiting on the person or queued", () => {
        for (const state of ["running", "awaiting-you", "queued"]) {
            expect(isUnreadCouncil(council({ id: "never", state, updated: 9_000 }), MAP)).toBe(false);
        }
    });

    it("takes the summary's time as the end when there is one", () => {
        const summary = { text: "", directions: [], outcomes: {}, at: 4_000 };
        expect(isUnreadCouncil(council({ id: "seen", updated: 9_000, summary }), MAP)).toBe(false);
        expect(isUnreadCouncil(council({ id: "seen", updated: 1, summary: { ...summary, at: 6_000 } }), MAP)).toBe(
            true
        );
    });
});

describe("markOpened", () => {
    it("records the time without touching the input or seededAt", () => {
        const next = markOpened(MAP, "new", 8_000);
        expect(next).toEqual({ seededAt: 1_000, opened: { seen: 5_000, new: 8_000 } });
        expect(MAP.opened).toEqual({ seen: 5_000 });
        expect(openedAt(next, "new")).toBe(8_000);
    });
});
