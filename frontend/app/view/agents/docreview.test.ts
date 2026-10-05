// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { describe, expect, it } from "vitest";
import type { AgentAsk, AgentVM } from "./agentsviewmodel";
import { focusItem, parseDocReview, shouldAutoOpen } from "./docreview";

const OPTIONS = [{ label: "Approve" }, { label: "Request changes" }];

const ask = (header: string, question: string, options = OPTIONS, askId = "a1"): AgentAsk => ({
    askId,
    questions: [{ question, header, options }],
});

describe("parseDocReview", () => {
    it("reads a Spec review ask", () => {
        const q =
            "C:/repo/docs/specs/2026-09-24-auth.md\n- Redis sessions, 14-day sliding TTL\n- Accept the legacy sid cookie for one release";
        expect(parseDocReview(ask("Spec review", q))).toEqual({
            kind: "spec",
            path: "C:/repo/docs/specs/2026-09-24-auth.md",
            doc: "markdown",
            intro: [],
            items: ["Redis sessions, 14-day sliding TTL", "Accept the legacy sid cookie for one release"],
            approveIndex: 0,
            requestIndex: 1,
        });
    });
    it("reads a mockup-settled Spec review whose first line is the canvas board", () => {
        const q = "C:/repo/.superpowers/design/peek/project/Main.dc.html\n- Peek opens on hover, not click";
        expect(parseDocReview(ask("Spec review", q))).toEqual({
            kind: "spec",
            path: "C:/repo/.superpowers/design/peek/project/Main.dc.html",
            doc: "canvas",
            intro: [],
            items: ["Peek opens on hover, not click"],
            approveIndex: 0,
            requestIndex: 1,
        });
        expect(parseDocReview(ask("Spec review", "`/r/Main.DC.HTML`"))?.doc).toBe("canvas");
    });
    it("reads a Plan review ask and splits intro from items", () => {
        const q =
            "C:/repo/docs/plans/2026-09-30-x.md\nThe reviewer found four problems; the plan now fixes them.\n- Task 3 depended on Task 5\n- Verify line missed the wsh package\n- Task 2 had no test\n- Setup was absent";
        const r = parseDocReview(ask("Plan review", q));
        expect(r?.kind).toBe("plan");
        expect(r?.intro).toEqual(["The reviewer found four problems; the plan now fixes them."]);
        expect(r?.items).toHaveLength(4);
    });
    it("tolerates a backticked path, CRLF, and header case and spacing", () => {
        expect(parseDocReview(ask("spec Review ", "`/r/spec.md`\r\n- one"))?.path).toBe("/r/spec.md");
        expect(parseDocReview(ask("  PLAN review", "/r/plan.md"))?.kind).toBe("plan");
    });
    it("falls back to an ordinary question when the convention is not met", () => {
        expect(parseDocReview(ask("Flake fix", "/r/spec.md"))).toBeNull();
        expect(parseDocReview(ask("Spec review", "Does the spec look right?"))).toBeNull();
        expect(parseDocReview(ask("Spec review", "/r/spec.txt"))).toBeNull();
        expect(parseDocReview(ask("Spec review", "/r/board.html"))).toBeNull();
        // the path must be the first line, not merely somewhere in the question
        expect(parseDocReview(ask("Spec review", "Please review the mockup\n/r/Main.dc.html\n- one"))).toBeNull();
        expect(parseDocReview(undefined)).toBeNull();
    });
    it("needs exactly one question", () => {
        const two: AgentAsk = {
            questions: [
                { question: "/r/spec.md", header: "Spec review", options: OPTIONS },
                { question: "Anything else?", header: "Other" },
            ],
        };
        expect(parseDocReview(two)).toBeNull();
    });
    it("finds the approve and request options", () => {
        const opts = [{ label: "Request changes" }, { label: "Looks good (Recommended)" }];
        const r = parseDocReview(ask("Spec review", "/r/s.md", opts));
        expect(r?.requestIndex).toBe(0);
        expect(r?.approveIndex).toBe(1);
        const marked = parseDocReview(
            ask("Spec review", "/r/s.md", [{ label: "Approve" }, { label: "Request changes (Recommended)" }])
        );
        expect(marked?.requestIndex).toBe(1);
        expect(marked?.approveIndex).toBe(0);
    });
    it("reports no request option as -1", () => {
        const r = parseDocReview(ask("Spec review", "/r/s.md", [{ label: "Approve" }, { label: "Later" }]));
        expect(r?.requestIndex).toBe(-1);
        expect(r?.approveIndex).toBe(0);
    });
});

describe("parseDocReview — Doc review", () => {
    it("reads a .tex file as latex", () => {
        const q =
            "D:\\thesis\\paper\\venue2027\\main.tex\nRewrote §3.2 around XYZ determinism.\nPages: 8\n- §3.2 Method overview: rewritten\n- §5.1: numbers aligned with number_audit.md";
        expect(parseDocReview(ask("Doc review", q))).toEqual({
            kind: "doc",
            path: "D:\\thesis\\paper\\venue2027\\main.tex",
            doc: "latex",
            intro: ["Rewrote §3.2 around XYZ determinism."],
            items: ["§3.2 Method overview: rewritten", "§5.1: numbers aligned with number_audit.md"],
            approveIndex: 0,
            requestIndex: 1,
            pageLimit: 8,
        });
    });
    it("reads a .md file as markdown, with no page limit", () => {
        const r = parseDocReview(ask("Doc review", "/notes/seminar.md\n- 5.: tightened"));
        expect(r?.kind).toBe("doc");
        expect(r?.doc).toBe("markdown");
        expect(r?.items).toEqual(["5.: tightened"]);
        expect(r).not.toHaveProperty("pageLimit");
    });
    it("tolerates header case and a backticked or upper-case path", () => {
        expect(parseDocReview(ask(" doc REVIEW", "`/r/Main.TEX`"))?.doc).toBe("latex");
    });
    it("takes a Pages line out of the intro", () => {
        const r = parseDocReview(ask("Doc review", "/r/main.tex\nDone.\npages: 12\nAlso this.\n- one"));
        expect(r?.pageLimit).toBe(12);
        expect(r?.intro).toEqual(["Done.", "Also this."]);
        expect(r?.items).toEqual(["one"]);
    });
    it("finds a Pages line after the focus items", () => {
        const r = parseDocReview(ask("Doc review", "/r/main.tex\n- one\nPages: 8"));
        expect(r?.pageLimit).toBe(8);
        expect(r?.items).toEqual(["one"]);
    });
    it("keeps a Pages line that is not a page count as intro text", () => {
        for (const line of ["Pages: x", "Pages: 8 or so", "Pages: 0", "Pages: -3", "Pages:"]) {
            const r = parseDocReview(ask("Doc review", `/r/main.tex\n${line}\n- one`));
            expect(r?.pageLimit).toBeUndefined();
            expect(r?.intro).toEqual([line]);
        }
    });
    it("leaves a Pages line in a Spec review as intro text", () => {
        const r = parseDocReview(ask("Spec review", "/r/spec.md\nPages: 8\n- one"));
        expect(r?.pageLimit).toBeUndefined();
        expect(r?.intro).toEqual(["Pages: 8"]);
    });
    it("refuses a canvas board or any other extension", () => {
        expect(parseDocReview(ask("Doc review", "/r/Main.dc.html\n- one"))).toBeNull();
        expect(parseDocReview(ask("Doc review", "/r/board.html"))).toBeNull();
        expect(parseDocReview(ask("Doc review", "/r/paper.pdf"))).toBeNull();
        expect(parseDocReview(ask("Doc review", "/r/main.tex.bak"))).toBeNull();
        expect(parseDocReview(ask("Doc review", "Review the paper please"))).toBeNull();
    });
    it("refuses a .tex under Spec review or Plan review", () => {
        expect(parseDocReview(ask("Spec review", "/r/main.tex\n- one"))).toBeNull();
        expect(parseDocReview(ask("Plan review", "/r/main.tex\n- one"))).toBeNull();
    });
    it("still reads a .md and a canvas board under Spec review and Plan review", () => {
        expect(parseDocReview(ask("Spec review", "/r/s.md"))?.doc).toBe("markdown");
        expect(parseDocReview(ask("Plan review", "/r/p.md"))?.doc).toBe("markdown");
        expect(parseDocReview(ask("Spec review", "/r/Main.dc.html"))?.doc).toBe("canvas");
        expect(parseDocReview(ask("Plan review", "/r/Main.dc.html"))?.doc).toBe("canvas");
    });
    it("finds the approve and request options", () => {
        const r = parseDocReview(
            ask("Doc review", "/r/main.tex", [{ label: "Request changes" }, { label: "Approve" }])
        );
        expect(r?.requestIndex).toBe(0);
        expect(r?.approveIndex).toBe(1);
    });
});

describe("focusItem", () => {
    it("splits a numbered line into its number and text", () => {
        expect(focusItem("2: §5.2 ¶2 accounts for the other 6")).toEqual({
            n: 2,
            text: "§5.2 ¶2 accounts for the other 6",
        });
        expect(focusItem("1: done X")).toEqual({ n: 1, text: "done X" });
        expect(focusItem("12:   spaced")).toEqual({ n: 12, text: "spaced" });
    });
    it("leaves any other line a plain chip", () => {
        expect(focusItem("§5.2: rewritten")).toEqual({ n: null, text: "§5.2: rewritten" });
        expect(focusItem("§3.2 Method overview: rewritten")).toEqual({
            n: null,
            text: "§3.2 Method overview: rewritten",
        });
        expect(focusItem("5.: tightened")).toEqual({ n: null, text: "5.: tightened" });
        expect(focusItem("10:30 pm deadline")).toEqual({ n: null, text: "10:30 pm deadline" });
        expect(focusItem("1:")).toEqual({ n: null, text: "1:" });
        expect(focusItem("")).toEqual({ n: null, text: "" });
    });
});

describe("shouldAutoOpen", () => {
    const agent = (a?: AgentAsk): AgentVM =>
        ({ id: "lead", name: "lead", task: "t", state: "asking", ask: a }) as AgentVM;
    const base = () => ({
        surface: "agent",
        focusedId: "lead",
        agent: agent(ask("Spec review", "/r/s.md")),
        opened: new Set<string>(),
        editable: false,
    });
    it("opens for the focused agent's fresh doc-review ask on the agent surface", () => {
        expect(shouldAutoOpen(base())).toBe(true);
    });
    it("stays closed off the agent surface", () => {
        expect(shouldAutoOpen({ ...base(), surface: "cockpit" })).toBe(false);
    });
    it("stays closed for an agent that is not focused", () => {
        expect(shouldAutoOpen({ ...base(), focusedId: "other" })).toBe(false);
    });
    it("stays closed once the ask has opened", () => {
        expect(shouldAutoOpen({ ...base(), opened: new Set(["a1"]) })).toBe(false);
    });
    it("stays closed while typing", () => {
        expect(shouldAutoOpen({ ...base(), editable: true })).toBe(false);
    });
    it("stays closed with no ask, an ordinary ask, or no agent", () => {
        expect(shouldAutoOpen({ ...base(), agent: agent(undefined) })).toBe(false);
        expect(shouldAutoOpen({ ...base(), agent: agent(ask("Flake", "/r/s.md")) })).toBe(false);
        expect(shouldAutoOpen({ ...base(), agent: undefined })).toBe(false);
    });
});
