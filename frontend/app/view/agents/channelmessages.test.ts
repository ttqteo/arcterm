// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { describe, expect, it } from "vitest";
import { parseMentions, planMessage, tierFromMeta } from "./channelmessages";

describe("parseMentions", () => {
    it("returns no mentions for plain text", () => {
        expect(parseMentions("hello there")).toEqual({ mentions: [], body: "hello there" });
    });

    it("extracts leading mentions and strips them from the body", () => {
        expect(parseMentions("@codex build the auth refactor")).toEqual({
            mentions: ["codex"],
            body: "build the auth refactor",
        });
    });

    it("lowercases mentions and keeps interior text intact", () => {
        expect(parseMentions("@API-Auth do the thing")).toEqual({ mentions: ["api-auth"], body: "do the thing" });
    });
});

const roster = [
    { id: "t1", name: "api-auth", blockId: "b1" },
    { id: "t2", name: "web", blockId: "b2" },
];

describe("planMessage", () => {
    it("plans a dispatch when the mention is a known runtime", () => {
        expect(planMessage("@codex build it", roster)).toEqual({
            kind: "dispatch",
            runtime: "codex",
            text: "build it",
        });
    });

    it("plans a steer when the mention is a live worker name", () => {
        expect(planMessage("@api-auth run the tests", roster)).toEqual({
            kind: "steer",
            targetId: "t1",
            blockId: "b1",
            text: "run the tests",
        });
    });

    it("plans a plain post when there is no actionable mention", () => {
        expect(planMessage("just a note", roster)).toEqual({ kind: "post", text: "just a note" });
    });

    it("treats an unknown mention as a plain post", () => {
        expect(planMessage("@nobody hi", roster)).toEqual({ kind: "post", text: "@nobody hi" });
    });

    it("plans a consult when prefixed with ask + a runtime", () => {
        expect(planMessage("ask @claude does this have races?", roster)).toEqual({
            kind: "consult",
            runtimes: ["claude"],
            text: "does this have races?",
        });
    });
    it("fans a consult out across multiple runtimes", () => {
        expect(planMessage("ask @codex @claude review this", roster)).toEqual({
            kind: "consult",
            runtimes: ["codex", "claude"],
            text: "review this",
        });
    });
    it("treats ask with no known runtime as a plain post (kept verbatim)", () => {
        expect(planMessage("ask @nobody anything", roster)).toEqual({ kind: "post", text: "ask @nobody anything" });
    });
    it("does not consult without the ask keyword (leading @runtime still dispatches)", () => {
        expect(planMessage("@claude build it", roster)).toEqual({ kind: "dispatch", runtime: "claude", text: "build it" });
    });
    it("dispatches to opencode by leading mention", () => {
        expect(planMessage("@opencode fix the flaky test", [])).toEqual({
            kind: "dispatch",
            runtime: "opencode",
            text: "fix the flaky test",
        });
    });
    it("consults opencode after ask", () => {
        expect(planMessage("ask @opencode does this race?", [])).toEqual({
            kind: "consult",
            runtimes: ["opencode"],
            text: "does this race?",
        });
    });
    it("dispatches to agy by leading mention", () => {
        expect(planMessage("@agy fix the flaky test", [])).toEqual({
            kind: "dispatch",
            runtime: "agy",
            text: "fix the flaky test",
        });
    });
    it("consults agy after ask", () => {
        expect(planMessage("ask @agy does this race?", [])).toEqual({
            kind: "consult",
            runtimes: ["agy"],
            text: "does this race?",
        });
    });
    it("dispatches to pi by leading mention", () => {
        expect(planMessage("@pi investigate", [])).toEqual({ kind: "dispatch", runtime: "pi", text: "investigate" });
    });
    it("consults pi after ask", () => {
        expect(planMessage("ask @pi review this", [])).toEqual({
            kind: "consult",
            runtimes: ["pi"],
            text: "review this",
        });
    });
});

// "jarvis" was a reserved manager handle routing to a fleet summary or a delegator dispatch. The
// consolidation left no composer able to produce it, so the branch is gone and the name is ordinary:
// it steers a roster worker called jarvis, and otherwise posts.
describe("planMessage @jarvis is no longer reserved", () => {
    it("posts @jarvis when no roster worker owns the name", () => {
        expect(planMessage("@jarvis what's blocked?", [])).toEqual({
            kind: "post",
            text: "@jarvis what's blocked?",
        });
    });
    it("steers a roster worker actually named jarvis", () => {
        expect(planMessage("@jarvis go", [{ id: "t1", name: "jarvis" }])).toEqual({
            kind: "steer",
            targetId: "t1",
            blockId: undefined,
            text: "go",
        });
    });
});

describe("tierFromMeta", () => {
    it("is gatekeeper unless the channel was explicitly set to concierge", () => {
        expect(tierFromMeta(undefined)).toBe("gatekeeper");
        expect(tierFromMeta({})).toBe("gatekeeper");
        expect(tierFromMeta({ "gatekeeper:enabled": true })).toBe("gatekeeper");
        expect(tierFromMeta({ "gatekeeper:enabled": false })).toBe("concierge");
    });

    it("reads a project left on the retired delegator rung as gatekeeper", () => {
        expect(tierFromMeta({ "gatekeeper:enabled": true, "delegator:enabled": true })).toBe("gatekeeper");
    });
});
