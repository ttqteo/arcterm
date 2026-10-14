// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { describe, expect, it, vi } from "vitest";

vi.mock("@/app/store/wshclientapi", () => ({ RpcApi: {} }));
vi.mock("@/app/store/wshrpcutil", () => ({ TabRpcClient: {} }));
vi.mock("@/app/store/modalmodel", () => ({ modalsModel: {} }));

import { createRunPayload } from "./runactions";

const lead: RoutePin = { runtime: "claude", model: "opus" };
const reviewers: RoutePin = { runtime: "claude", model: "sonnet" };

describe("createRunPayload reviewer fields", () => {
    it("carries the workers setting and the reviewer route for an orchestrator", () => {
        const payload = createRunPayload("ws-1", "ch-1", "goal", lead, {
            mode: "orchestrator",
            reviewerPicks: true,
            reviewerRoute: reviewers,
        });
        expect(payload.reviewerpicks).toBe(true);
        expect(payload.reviewerroute).toEqual(reviewers);
    });

    it("carries reviewerpicks false, which overrides a profile on picks", () => {
        const payload = createRunPayload("ws-1", "ch-1", "goal", lead, { mode: "orchestrator", reviewerPicks: false });
        expect(payload).toHaveProperty("reviewerpicks", false);
        expect(payload).not.toHaveProperty("reviewerroute");
    });

    it("omits both for a quick launch", () => {
        const payload = createRunPayload("ws-1", "ch-1", "goal", lead, {
            mode: "quick",
            reviewerPicks: true,
            reviewerRoute: reviewers,
        });
        expect(payload).not.toHaveProperty("reviewerpicks");
        expect(payload).not.toHaveProperty("reviewerroute");
    });
});

describe("createRunPayload Light reviewers route", () => {
    it("carries it for an orchestrator and drops it for a quick launch", () => {
        const opts = { lightReviewerRoute: reviewers };
        expect(
            createRunPayload("ws-1", "ch-1", "goal", lead, { mode: "orchestrator", ...opts }).lightreviewerroute
        ).toEqual(reviewers);
        expect(createRunPayload("ws-1", "ch-1", "goal", lead, { mode: "quick", ...opts })).not.toHaveProperty(
            "lightreviewerroute"
        );
    });
});
