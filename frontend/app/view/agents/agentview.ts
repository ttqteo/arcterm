// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

// What the Agent surface shows in the terminal's place: the terminal, the agent's canvas, its Doc review, or its
// brainstorm. They are exclusive, so the header, the keys, the tree and the reveal routes switch through here, never
// through one store alone. A view the agent doesn't have changes nothing. An agent with a brainstorm never shows its
// canvas (the brainstorm pane opens the boards itself), so its canvas slot is the brainstorm's.

import { getBrainstorm, setBrainstormMode } from "./brainstormstore";
import { getCanvas, setCanvasMode } from "./canvasstore";
import { setDocReviewMode } from "./docreviewstore";

export type AgentView = "terminal" | "canvas" | "review" | "brainstorm";

// Alt+C walks the header's segmented control in its order, skipping a view the agent doesn't have. Null when the
// terminal is the only one, so the key passes.
export function nextAgentView(
    view: AgentView,
    hasCanvas: boolean,
    hasReview: boolean,
    hasBrainstorm = false
): AgentView | null {
    const views: AgentView[] = [
        "terminal",
        ...(hasBrainstorm ? ["brainstorm" as const] : hasCanvas ? ["canvas" as const] : []),
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
            // puts a showing canvas or brainstorm back itself, so openReview keeps the three exclusive too
            setDocReviewMode(agentId, "review", now);
            return;
        case "brainstorm":
            if (getBrainstorm(agentId) == null) {
                return;
            }
            setDocReviewMode(agentId, "terminal", now);
            setBrainstormMode(agentId, "brainstorm", now);
            return;
        case "canvas":
            if (getCanvas(agentId) == null || getBrainstorm(agentId) != null) {
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
            if (getBrainstorm(agentId)?.mode === "brainstorm") {
                setBrainstormMode(agentId, "terminal", now);
            }
    }
}
