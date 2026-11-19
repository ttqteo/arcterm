// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { describe, expect, it } from "vitest";
import { agentCouncil, railCouncilButton } from "./railcouncil";

const council = (extra: Partial<Council> = {}): Council => ({
    id: "c1",
    project: "D:\\code\\arc",
    feature: "Chat's suggested replies",
    experts: [],
    state: "running",
    round: 1,
    rounds: 2,
    tokens: 0,
    calls: 0,
    created: 100,
    updated: 100,
    ...extra,
});

describe("agentCouncil", () => {
    it("is null with no councils, or none this agent started", () => {
        expect(agentCouncil(null, ["a1"])).toBeNull();
        expect(agentCouncil([], ["a1"])).toBeNull();
        expect(agentCouncil([council({ sessionid: "other" }), council({ sessionid: undefined })], ["a1"])).toBeNull();
    });

    it("matches any of the ids the agent goes by", () => {
        expect(agentCouncil([council({ sessionid: "a1" })], ["a1"])?.id).toBe("c1");
        expect(agentCouncil([council({ sessionid: "s9" })], ["a1", undefined, "s9"])?.id).toBe("c1");
    });

    it("does not match an empty session on either side", () => {
        expect(agentCouncil([council({ sessionid: "" })], ["a1", "", null])).toBeNull();
    });

    it("picks the one started last, whatever the list's order", () => {
        const list = [
            council({ id: "old", sessionid: "a1", created: 100 }),
            council({ id: "new", sessionid: "a1", created: 300 }),
            council({ id: "mid", sessionid: "a1", created: 200 }),
        ];
        expect(agentCouncil(list, ["a1"])?.id).toBe("new");
    });

    it("passes over a council refused at the start", () => {
        const list = [
            council({ id: "ran", sessionid: "a1", created: 100, state: "done" }),
            council({ id: "refused", sessionid: "a1", created: 200, state: "not-run" }),
        ];
        expect(agentCouncil(list, ["a1"])?.id).toBe("ran");
    });
});

describe("railCouncilButton", () => {
    it("dots a running council green and names its round", () => {
        const b = railCouncilButton(council());
        expect(b.dot).toBe("working");
        expect(b.title).toBe("Chat's suggested replies · Round 1 of 2 (c)");
    });

    it("dots a council waiting on the person amber", () => {
        const b = railCouncilButton(council({ state: "awaiting-you" }));
        expect(b.dot).toBe("asking");
        expect(b.title).toBe("Chat's suggested replies · Waiting on you (c)");
    });

    it("dots a failed council red", () => {
        expect(railCouncilButton(council({ state: "failed" })).dot).toBe("error");
    });

    it("draws no dot on a council that is over", () => {
        const b = railCouncilButton(council({ state: "done" }));
        expect(b.dot).toBeNull();
        expect(b.title).toBe("Chat's suggested replies · Done (c)");
    });

    it("calls a council with no feature a Council", () => {
        expect(railCouncilButton(council({ feature: "  ", state: "done" })).title).toBe("Council · Done (c)");
    });
});
