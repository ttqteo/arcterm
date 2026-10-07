// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import type { AgentVM } from "@/app/view/agents/agentsviewmodel";
import { describe, expect, it } from "vitest";
import { askAgent, inlineSelections, needsGroups, needsRows, needsTarget } from "./palette-needs";

const agent = (over: Partial<AgentVM>) =>
    ({ id: "t1", name: "juno", state: "asking", blockId: "b1", ...over }) as AgentVM;
const item = (kind: string, key = `${kind}:x`) =>
    ({ kind, key, source: "", text: "", action: "", phaseidx: 0, waitingsince: 0 }) as AttentionItem;
const oneQ = { questions: [{ question: "Which?", options: [{ label: "A" }, { label: "B" }] }] };

describe("palette-needs", () => {
    it("resolves an ask to its agent by block, with or without a channel", () => {
        expect(askAgent(item("ask", "ask:block:b1"), [agent({})])?.id).toBe("t1");
        expect(askAgent(item("ask", "ask:block:zz"), [agent({})])).toBeUndefined();
    });

    it("never resolves a non-ask item, even one whose key names a block", () => {
        expect(askAgent(item("dag-gate", "ask:block:b1"), [agent({})])).toBeUndefined();
    });

    it("groups by kind and drops radar triage", () => {
        const g = needsGroups(
            needsRows(
                [
                    item("dag-gate"),
                    item("ask", "ask:block:b1"),
                    item("dag-blocked"),
                    item("radar-triage"),
                    item("run-unverified"),
                ],
                [agent({ ask: oneQ })]
            )
        );
        expect(g.map((x) => [x.group, x.rows.length])).toEqual([
            ["asks", 1],
            ["reviews", 1],
            ["blocked", 2],
        ]);
    });

    it("escalations are asks, dag gates reviews, and unknown kinds blocked", () => {
        const rows = needsRows([item("escalation"), item("dag-gate"), item("run-land-held"), item("mystery")], []);
        expect(rows.map((r) => r.group)).toEqual(["asks", "reviews", "blocked", "blocked"]);
    });

    it("keeps server order within a group and drops empty groups", () => {
        const g = needsGroups(
            needsRows([item("dag-blocked", "a"), item("dag-gate", "g"), item("run-unverified", "b")], [])
        );
        expect(g.map((x) => [x.group, x.rows.map((r) => r.item.key)])).toEqual([
            ["reviews", ["g"]],
            ["blocked", ["a", "b"]],
        ]);
    });

    it("a doc review ask is a review with no inline options", () => {
        const review = {
            questions: [
                {
                    header: "Spec review",
                    question: "/abs/spec.md\n- one",
                    options: [{ label: "Approve" }, { label: "Request changes" }],
                },
            ],
        };
        const [row] = needsRows([item("ask", "ask:block:b1")], [agent({ ask: review })]);
        expect(row).toMatchObject({ group: "reviews", review: true, options: [] });
    });

    it("inline options only for one single-select question", () => {
        expect(needsRows([item("ask", "ask:block:b1")], [agent({ ask: oneQ })])[0].options).toEqual(["A", "B"]);
        const multi = { questions: [{ question: "q", multiSelect: true, options: [{ label: "A" }] }] };
        expect(needsRows([item("ask", "ask:block:b1")], [agent({ ask: multi })])[0].options).toEqual([]);
        const two = { questions: [oneQ.questions[0], oneQ.questions[0]] };
        expect(needsRows([item("ask", "ask:block:b1")], [agent({ ask: two })])[0].options).toEqual([]);
        expect(needsRows([item("ask", "ask:block:none")], [agent({ ask: oneQ })])[0].options).toEqual([]);
    });

    it("inlineSelections rejects an out-of-range digit", () => {
        const [row] = needsRows([item("ask", "ask:block:b1")], [agent({ ask: oneQ })]);
        expect(inlineSelections(row, 1)).toEqual({ 0: new Set([1]) });
        expect(inlineSelections(row, 5)).toBeNull();
        expect(inlineSelections(row, -1)).toBeNull();
        const [bare] = needsRows([item("ask", "ask:block:none")], [agent({ ask: oneQ })]);
        expect(inlineSelections(bare, 0)).toBeNull();
    });

    describe("needsTarget", () => {
        const at = (over: Partial<AttentionItem>) => ({ ...item("run-land-held"), ...over }) as AttentionItem;
        const target = (it: AttentionItem, agents: AgentVM[] = []) => needsTarget(needsRows([it], agents)[0]);

        it("opens a resolved ask's agent, and a doc review as a review", () => {
            expect(target(item("ask", "ask:block:b1"), [agent({ ask: oneQ })])).toEqual({
                kind: "agent",
                agentId: "t1",
            });
            const review = { questions: [{ header: "Plan review", question: "/abs/plan.md", options: [] }] };
            expect(target(item("ask", "ask:block:b1"), [agent({ ask: review })])).toEqual({
                kind: "review",
                agentId: "t1",
            });
        });

        it("opens a dag item on its task graph, with the task when the key names one", () => {
            const gate = at({ kind: "dag-gate", key: "dag-gate:g1:t4", taskid: "t4", channelid: "c1", runid: "r1" });
            expect(target(gate)).toEqual({ kind: "dag", channelId: "c1", runId: "r1", dagId: "g1", taskId: "t4" });
            const blocked = at({ kind: "dag-blocked", key: "dag-blocked:g2", channelid: "c1", runid: "r1" });
            expect(target(blocked)).toEqual({ kind: "dag", channelId: "c1", runId: "r1", dagId: "g2" });
        });

        it("opens a held land on its run, and falls back to the channel, then to nothing", () => {
            expect(target(at({ channelid: "c1", runid: "r1" }))).toEqual({ kind: "run", channelId: "c1", runId: "r1" });
            expect(target(at({ channelid: "c1" }))).toEqual({ kind: "channel", channelId: "c1" });
            expect(target(at({}))).toBeNull();
        });

        it("an ask whose agent left the roster opens its channel, never an answer", () => {
            expect(target({ ...item("ask", "ask:block:gone"), channelid: "c1" } as AttentionItem)).toEqual({
                kind: "channel",
                channelId: "c1",
            });
        });
    });
});
