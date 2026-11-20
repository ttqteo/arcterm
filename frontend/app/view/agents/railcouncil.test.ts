// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { describe, expect, it } from "vitest";
import {
    agentCouncil,
    feedWindow,
    railCouncilFeed,
    railCouncilHead,
    railCouncilMove,
    railCouncilTab,
} from "./railcouncil";

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

describe("railCouncilTab", () => {
    it("dots a running council green and names its round", () => {
        const b = railCouncilTab(council());
        expect(b.dot).toBe("working");
        expect(b.title).toBe("Chat's suggested replies · Round 1 of 2 (c)");
    });

    it("dots a council waiting on the person amber", () => {
        const b = railCouncilTab(council({ state: "awaiting-you" }));
        expect(b.dot).toBe("asking");
        expect(b.title).toBe("Chat's suggested replies · Waiting on you (c)");
    });

    it("dots a failed council red", () => {
        expect(railCouncilTab(council({ state: "failed" })).dot).toBe("error");
    });

    it("draws no dot on a council that is over", () => {
        const b = railCouncilTab(council({ state: "done" }));
        expect(b.dot).toBeNull();
        expect(b.title).toBe("Chat's suggested replies · Done (c)");
    });

    it("calls a council with no feature a Council", () => {
        expect(railCouncilTab(council({ feature: "  ", state: "done" })).title).toBe("Council · Done (c)");
    });
});

const seat = (id: string, name: string): CouncilExpert => ({ id, name, brief: "", model: "sonnet" });
const idea = (id: string, author: string, ts: number, extra: Partial<CouncilProposal> = {}): CouncilProposal => ({
    id,
    author,
    title: `Idea ${id}`,
    argument: `Why ${id}`,
    ts,
    ...extra,
});
const reply = (id: string, author: string, on: string, round: number, ts: number): CouncilReply => ({
    id,
    proposalid: on,
    author,
    text: `Reply ${id}`,
    round,
    ts,
});

describe("railCouncilHead", () => {
    it("says where the council stands and how many seats it has", () => {
        const h = railCouncilHead(council({ experts: [seat("a", "Skeptic"), seat("b", "UX")] }));
        expect(h).toEqual({ title: "Chat's suggested replies", dot: "working", line: "Round 1 of 2 · 2 seats" });
    });

    it("counts one seat in the singular", () => {
        expect(railCouncilHead(council({ experts: [seat("a", "Skeptic")], state: "done" })).line).toBe("Done · 1 seat");
    });
});

describe("railCouncilFeed", () => {
    it("keeps a reply on an idea in the list, naming its idea, as the panel has no thread to open", () => {
        const c = council({
            question: "Is the cost axis a real contribution?",
            experts: [seat("a", "Skeptic"), seat("b", "UX")],
            round: 2,
            proposals: [idea("p1", "a", 110)],
            replies: [reply("r1", "b", "p1", 2, 120)],
        });
        const kinds = railCouncilFeed(c).map((i) => `${i.kind}:${i.id}`);
        expect(kinds).toEqual(["question:question", "divider:round:1", "idea:p1", "divider:round:2", "reply:r1"]);
        const r = railCouncilFeed(c).find((i) => i.kind === "reply");
        expect(r?.kind === "reply" && r.on).toBe("Idea p1");
    });

    it("leaves a dropped draft out and keeps a held one", () => {
        const c = council({
            experts: [seat("a", "Skeptic")],
            proposals: [idea("p1", "a", 110, { draft: "held" }), idea("p2", "a", 111, { draft: "dropped" })],
        });
        expect(railCouncilFeed(c).map((i) => `${i.kind}:${i.id}`)).toEqual(["divider:round:1", "draft:p1"]);
    });
});

describe("feedWindow", () => {
    it("keeps the newest n at the end", () => {
        expect(feedWindow([1, 2, 3, 4], 2)).toEqual([3, 4]);
        expect(feedWindow([1, 2], 5)).toEqual([1, 2]);
        expect(feedWindow([1, 2], 0)).toEqual([]);
    });
});

describe("railCouncilMove", () => {
    it("is nothing while the council runs with nothing held", () => {
        expect(railCouncilMove(council())).toBeNull();
    });

    it("lists the held drafts for Send to the others", () => {
        const c = council({
            proposals: [idea("p1", "a", 110, { draft: "held" }), idea("p2", "a", 111)],
            replies: [{ ...reply("r1", "a", "p2", 2, 120), draft: "held" }],
        });
        expect(railCouncilMove(c)).toEqual({ kind: "drafts", text: "2 drafts wait for you", drafts: ["p1", "r1"] });
    });

    it("sends the pause to the Discussion, whose choices it is", () => {
        expect(railCouncilMove(council({ state: "awaiting-you" }))?.kind).toBe("pause");
    });

    it("reads a done council, and a stopped one with its report, as done", () => {
        expect(railCouncilMove(council({ state: "done" }))?.kind).toBe("done");
        expect(railCouncilMove(council({ state: "stopped", summary: {} as CouncilSummary }))?.kind).toBe("done");
        expect(railCouncilMove(council({ state: "stopped" }))).toBeNull();
    });

    it("says a failed council failed", () => {
        expect(railCouncilMove(council({ state: "failed" }))?.kind).toBe("failed");
    });
});
