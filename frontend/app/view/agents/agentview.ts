// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

// What the Agent surface shows in the terminal's place: the terminal, the agent's canvas, or its Doc review. The
// canvas and the review are exclusive, so the header, the keys and the tree switch through here, never through one
// store alone. A view the agent doesn't have changes nothing.

import { getCanvas, setCanvasMode } from "./canvasstore";
import { setDocReviewMode } from "./docreviewstore";

export type AgentView = "terminal" | "canvas" | "review";

// Alt+C walks the header's segmented control in its order, skipping a view the agent doesn't have. Null when the
// terminal is the only one, so the key passes.
export function nextAgentView(view: AgentView, hasCanvas: boolean, hasReview: boolean): AgentView | null {
    const views: AgentView[] = [
        "terminal",
        ...(hasCanvas ? ["canvas" as const] : []),
        ...(hasReview ? ["review" as const] : []),
    ];
    if (views.length < 2) {
        return null;
    }
    const i = views.indexOf(view);
    return views[(i + 1) % views.length];
}

export function setAgentView(agentId: string, view: AgentView, now: number): void {
    switch (view) {
        case "review":
            // puts a showing canvas back itself, so openReview keeps the two exclusive too
            setDocReviewMode(agentId, "review", now);
            return;
        case "canvas":
            if (getCanvas(agentId) == null) {
                return;
            }
            setDocReviewMode(agentId, "terminal", now);
            setCanvasMode(agentId, "canvas", now);
            return;
        default:
            setDocReviewMode(agentId, "terminal", now);
            if (getCanvas(agentId)?.mode === "canvas") {
                setCanvasMode(agentId, "terminal", now);
            }
    }
}
