// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { nextAgentView, setAgentView } from "./agentview";
import { attachCanvas, detachCanvas, getCanvas } from "./canvasstore";
import { getDocReview, syncDocReview } from "./docreviewstore";

const CANVAS = { topic: "t", dir: "/p/.superpowers/design/t", projectDir: "/p" };
const DOC_ASK = {
    askId: "k1",
    questions: [
        {
            header: "Doc review",
            question: "/r/paper/main.tex\n- §3.2: rewritten",
            options: [{ label: "Approve" }, { label: "Request changes" }],
        },
    ],
};

describe("setAgentView", () => {
    beforeEach(() => {
        attachCanvas("a1", CANVAS, 0);
        syncDocReview("a1", DOC_ASK);
    });

    afterEach(() => {
        detachCanvas("a1");
        syncDocReview("a1", undefined);
    });

    it("review puts the canvas back to terminal mode", () => {
        setAgentView("a1", "canvas", 5);
        setAgentView("a1", "review", 6);
        expect(getDocReview("a1")?.mode).toBe("review");
        expect(getCanvas("a1")?.mode).toBe("terminal");
    });

    it("canvas puts the review back to terminal mode, and marks the canvas viewed", () => {
        setAgentView("a1", "review", 5);
        setAgentView("a1", "canvas", 6);
        expect(getCanvas("a1")).toMatchObject({ mode: "canvas", lastViewedMs: 6 });
        expect(getDocReview("a1")?.mode).toBe("terminal");
    });

    it("terminal puts both back", () => {
        setAgentView("a1", "review", 5);
        setAgentView("a1", "terminal", 6);
        expect(getDocReview("a1")?.mode).toBe("terminal");
        setAgentView("a1", "canvas", 7);
        setAgentView("a1", "terminal", 8);
        expect(getCanvas("a1")?.mode).toBe("terminal");
    });

    it("a view the agent doesn't have leaves the other one showing", () => {
        setAgentView("a1", "canvas", 5);
        syncDocReview("a1", undefined);
        setAgentView("a1", "review", 6);
        expect(getCanvas("a1")?.mode).toBe("canvas");

        syncDocReview("a1", DOC_ASK);
        setAgentView("a1", "review", 7);
        detachCanvas("a1");
        setAgentView("a1", "canvas", 8);
        expect(getDocReview("a1")?.mode).toBe("review");
    });
});

describe("nextAgentView", () => {
    it("walks terminal, canvas, review in the header's order", () => {
        expect(nextAgentView("terminal", true, true)).toBe("canvas");
        expect(nextAgentView("canvas", true, true)).toBe("review");
        expect(nextAgentView("review", true, true)).toBe("terminal");
    });

    it("skips a view the agent doesn't have", () => {
        expect(nextAgentView("terminal", true, false)).toBe("canvas");
        expect(nextAgentView("canvas", true, false)).toBe("terminal");
        expect(nextAgentView("terminal", false, true)).toBe("review");
        expect(nextAgentView("review", false, true)).toBe("terminal");
    });

    it("has nothing to switch to with the terminal alone", () => {
        expect(nextAgentView("terminal", false, false)).toBeNull();
    });
});
