// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { nextAgentView, setAgentView } from "./agentview";
import { attachBrainstorm, detachBrainstorm, getBrainstorm, setBrainstormMode } from "./brainstormstore";
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

describe("setAgentView with a brainstorm", () => {
    beforeEach(() => {
        attachCanvas("a1", CANVAS, 0);
        attachBrainstorm("a1", { topic: "t", cwd: "/p" }, 0);
        syncDocReview("a1", DOC_ASK);
    });

    afterEach(() => {
        detachCanvas("a1");
        detachBrainstorm("a1");
        syncDocReview("a1", undefined);
    });

    it("brainstorm shows it, marks it viewed, and puts a showing review back", () => {
        setAgentView("a1", "review", 5);
        setAgentView("a1", "brainstorm", 6);
        expect(getBrainstorm("a1")).toMatchObject({ mode: "brainstorm", lastViewedMs: 6 });
        expect(getDocReview("a1")?.mode).toBe("terminal");
    });

    it("review puts a showing brainstorm back to terminal mode", () => {
        setAgentView("a1", "brainstorm", 5);
        setAgentView("a1", "review", 6);
        expect(getDocReview("a1")?.mode).toBe("review");
        expect(getBrainstorm("a1")?.mode).toBe("terminal");
    });

    it("an agent with a brainstorm never shows its canvas, however the canvas is asked for", () => {
        setAgentView("a1", "canvas", 5);
        expect(getCanvas("a1")?.mode).toBe("terminal");
        expect(getBrainstorm("a1")?.mode).toBe("terminal");
    });

    it("terminal puts the brainstorm and the review back", () => {
        setAgentView("a1", "brainstorm", 5);
        setAgentView("a1", "terminal", 6);
        expect(getBrainstorm("a1")?.mode).toBe("terminal");
        setAgentView("a1", "review", 7);
        setAgentView("a1", "terminal", 8);
        expect(getDocReview("a1")?.mode).toBe("terminal");
    });

    it("a brainstorm the agent doesn't have changes nothing", () => {
        detachBrainstorm("a1");
        setAgentView("a1", "review", 5);
        setAgentView("a1", "brainstorm", 6);
        expect(getBrainstorm("a1")).toBeNull();
        expect(getDocReview("a1")?.mode).toBe("review");
    });

    it("a switch the brainstorm's own mode setter makes stays inside the brainstorm", () => {
        setBrainstormMode("a1", "brainstorm", 5);
        expect(getBrainstorm("a1")?.mode).toBe("brainstorm");
        setAgentView("a1", "terminal", 6);
        expect(getBrainstorm("a1")?.mode).toBe("terminal");
    });
});

describe("nextAgentView with a brainstorm", () => {
    it("walks terminal, brainstorm, review: the brainstorm takes the canvas's slot", () => {
        expect(nextAgentView("terminal", false, true, true)).toBe("brainstorm");
        expect(nextAgentView("brainstorm", false, true, true)).toBe("review");
        expect(nextAgentView("review", false, true, true)).toBe("terminal");
    });

    it("never offers the canvas beside a brainstorm", () => {
        expect(nextAgentView("terminal", true, false, true)).toBe("brainstorm");
        expect(nextAgentView("brainstorm", true, false, true)).toBe("terminal");
        expect(nextAgentView("terminal", true, true, true)).toBe("brainstorm");
    });

    it("has nothing to switch to with the terminal alone", () => {
        expect(nextAgentView("terminal", false, false, false)).toBeNull();
    });
});
