// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { describe, expect, it } from "vitest";
import { endedNotice, markRead, markUnread, viewingCouncil } from "./councilnotify";

const council = (over: Partial<Council> = {}): Council => ({
    id: "c1",
    project: "/p",
    feature: "Pick a cache",
    experts: [],
    state: "running",
    round: 2,
    tokens: 0,
    calls: 0,
    created: 1,
    updated: 2,
    ...over,
});
const summary = (over: Partial<CouncilSummary> = {}): CouncilSummary => ({
    text: "Use Redis. It is faster.",
    directions: [],
    outcomes: {},
    at: 3,
    ...over,
});

describe("endedNotice", () => {
    it("fires once on running → done, with the answer as its body", () => {
        const next = council({ state: "done", summary: summary({ answer: "Use Redis for the cache." }) });
        expect(endedNotice(council(), next, false)).toEqual({
            title: "Council done",
            body: "Use Redis for the cache.",
        });
        expect(endedNotice(next, next, false)).toBeNull();
    });

    it("fires from waiting on you, and names stopped", () => {
        const next = council({ state: "stopped" });
        expect(endedNotice(council({ state: "awaiting-you" }), next, false)?.title).toBe("Council stopped");
    });

    it("falls back to the summary's first sentence when there is no answer", () => {
        const next = council({ state: "done", summary: summary() });
        expect(endedNotice(council(), next, false)?.body).toBe("Use Redis.");
    });

    it("falls back to the error, and says Council failed", () => {
        const next = council({ state: "failed", error: "the coordinator timed out" });
        expect(endedNotice(council(), next, false)).toEqual({
            title: "Council failed",
            body: "the coordinator timed out",
        });
    });

    it("keeps a body when there is neither a summary nor an error", () => {
        expect(endedNotice(council(), council({ state: "done" }), false)?.body).toBe("Pick a cache");
    });

    it("says nothing on the first load, while the person is looking, or for a state that is not an end", () => {
        const done = council({ state: "done" });
        expect(endedNotice(undefined, done, false)).toBeNull();
        expect(endedNotice(council(), done, true)).toBeNull();
        expect(endedNotice(council(), council({ state: "awaiting-you" }), false)).toBeNull();
        expect(endedNotice(council({ state: "not-run" }), council(), false)).toBeNull();
    });
});

describe("viewingCouncil", () => {
    it("is the Agent surface on that council's Discussion or Summary, and not on Setup", () => {
        expect(viewingCouncil("agent", "council", "discussion", "c1", "c1")).toBe(true);
        expect(viewingCouncil("agent", "council", "summary", "c1", "c1")).toBe(true);
        expect(viewingCouncil("agent", "council", "setup", "c1", "c1")).toBe(false);
        expect(viewingCouncil("agent", "council", "summary", "c2", "c1")).toBe(false);
        expect(viewingCouncil("agent", "terminal", "summary", "c1", "c1")).toBe(false);
        expect(viewingCouncil("cockpit", "council", "summary", "c1", "c1")).toBe(false);
    });
});

describe("markUnread and markRead", () => {
    it("add and remove an id without changing the set they were given", () => {
        const empty: ReadonlySet<string> = new Set();
        const one = markUnread(empty, "a");
        expect([...empty]).toEqual([]);
        expect([...one]).toEqual(["a"]);
        const none = markRead(one, "a");
        expect([...one]).toEqual(["a"]);
        expect([...none]).toEqual([]);
    });

    it("hand back the same set when there is nothing to change", () => {
        const one: ReadonlySet<string> = new Set(["a"]);
        expect(markUnread(one, "a")).toBe(one);
        expect(markRead(one, "b")).toBe(one);
    });
});
