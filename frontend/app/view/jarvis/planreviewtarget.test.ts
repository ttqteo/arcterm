// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import type { AgentVM } from "@/app/view/agents/agentsviewmodel";
import { describe, expect, it } from "vitest";
import { planReviewAgent, planReviewORef } from "./planreviewtarget";

const plan = (over: Partial<AttentionItem> = {}): AttentionItem =>
    ({
        kind: "plan-review",
        key: "plan-review:e1",
        source: "Nav rail",
        text: "2 proposed",
        action: "Review",
        phaseidx: 0,
        waitingsince: 1000,
        oref: "effort:e1",
        effortoid: "e1",
        ...over,
    }) as AttentionItem;

const agent = (over: Partial<AgentVM>): AgentVM => ({ id: "t", name: "a", task: "", state: "idle", ...over });

describe("planReviewAgent", () => {
    it("finds the live agent on the item's initiative", () => {
        const roster = [agent({ id: "x", effortId: "e2" }), agent({ id: "a", effortId: "e1" })];
        expect(planReviewAgent(plan(), roster)?.id).toBe("a");
    });

    it("takes the newest when several are open on it", () => {
        const roster = [
            agent({ id: "old", effortId: "e1", idleSince: 100 }),
            agent({ id: "new", effortId: "e1", idleSince: 200 }),
        ];
        expect(planReviewAgent(plan(), roster)?.id).toBe("new");
    });

    it("finds nothing when no open agent is on the initiative", () => {
        expect(planReviewAgent(plan(), [])).toBeUndefined();
        expect(planReviewAgent(plan(), [agent({ effortId: "e2" })])).toBeUndefined();
        expect(planReviewAgent(plan({ effortoid: undefined }), [agent({ effortId: "e1" })])).toBeUndefined();
    });

    it("finds nothing for any other kind of item", () => {
        const roster = [agent({ id: "a", effortId: "e1" })];
        expect(planReviewAgent(plan({ kind: "chunk-due" }), roster)).toBeUndefined();
        expect(planReviewAgent(plan({ kind: "ask" }), roster)).toBeUndefined();
    });
});

describe("planReviewORef", () => {
    it("opens the agent when one is open on the initiative", () => {
        expect(planReviewORef(plan(), [agent({ id: "a", effortId: "e1" })])).toBe("agent:a");
    });

    it("opens the initiative when its agent is gone", () => {
        expect(planReviewORef(plan(), [])).toBe("effort:e1");
    });
});
