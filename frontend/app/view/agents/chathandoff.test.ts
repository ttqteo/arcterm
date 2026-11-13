// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { describe, expect, it } from "vitest";
import {
    factsLine,
    HANDOFF_CHOICES,
    HANDOFF_HEADER,
    handoffDoneLine,
    handoffRows,
    isEngineChoice,
    isHandoffAsk,
    planFacts,
    planPathOf,
} from "./chathandoff";

describe("isHandoffAsk", () => {
    it("recognizes one question with the header Handoff", () => {
        expect(HANDOFF_HEADER).toBe("Handoff");
        expect(isHandoffAsk([{ header: "Handoff" }])).toBe(true);
    });

    it("takes the header whatever its case or padding", () => {
        expect(isHandoffAsk([{ header: " handoff " }])).toBe(true);
    });

    it("does not take another header, no header, or no questions", () => {
        expect(isHandoffAsk([{ header: "Approach" }])).toBe(false);
        expect(isHandoffAsk([{}])).toBe(false);
        expect(isHandoffAsk([])).toBe(false);
        expect(isHandoffAsk(undefined)).toBe(false);
    });

    it("does not take two questions, even when one is the Handoff", () => {
        expect(isHandoffAsk([{ header: "Handoff" }, { header: "Scope" }])).toBe(false);
    });
});

describe("handoffRows", () => {
    const all = (extra?: Partial<Record<string, string>>) => ({
        options: HANDOFF_CHOICES.map((label) => ({ label, description: extra?.[label] })),
    });

    it("draws the four rows in the fixed order with the letters A to D", () => {
        const rows = handoffRows(all());
        expect(rows.map((r) => [r.letter, r.label])).toEqual([
            ["A", "Arc engine"],
            ["B", "Arc engine, queued"],
            ["C", "Inline in this session"],
            ["D", "Subagent-driven"],
        ]);
    });

    it("keeps the fixed order whatever order the agent sent, and maps each row to the agent's own option index", () => {
        const rows = handoffRows({
            options: [
                { label: "Inline in this session (Recommended)" },
                { label: "Arc engine" },
                { label: "Subagent-driven" },
                { label: "Arc engine, queued" },
            ],
        });
        expect(rows.map((r) => r.label)).toEqual([...HANDOFF_CHOICES]);
        expect(rows.map((r) => r.optionIndex)).toEqual([1, 3, 0, 2]);
    });

    it("puts Recommended on the row whose option carries (Recommended), and drops the suffix from the match", () => {
        const rows = handoffRows({
            options: [
                { label: "Arc engine (Recommended)" },
                { label: "Arc engine, queued" },
                { label: "Inline in this session" },
                { label: "Subagent-driven" },
            ],
        });
        expect(rows.map((r) => r.recommended)).toEqual([true, false, false, false]);
        expect(rows[0].optionIndex).toBe(0);
    });

    it("takes the marker in any case", () => {
        const rows = handoffRows({
            options: [
                { label: "Arc engine" },
                { label: "Arc engine, queued (recommended)" },
                { label: "Inline in this session" },
                { label: "Subagent-driven" },
            ],
        });
        expect(rows.map((r) => r.recommended)).toEqual([false, true, false, false]);
        expect(rows[1].optionIndex).toBe(1);
    });

    it("does not take Arc engine, queued for Arc engine, nor the reverse", () => {
        const rows = handoffRows({ options: [{ label: "Arc engine, queued (Recommended)" }] });
        expect(rows.map((r) => r.optionIndex)).toEqual([null, 0, null, null]);
        expect(rows.map((r) => r.recommended)).toEqual([false, true, false, false]);
    });

    it("matches a label without regard to its case or padding", () => {
        const rows = handoffRows({ options: [{ label: "  arc ENGINE " }] });
        expect(rows[0].optionIndex).toBe(0);
    });

    it("gives a choice the agent left out a null option index, no Recommended and the default detail", () => {
        const rows = handoffRows({ options: [{ label: "Arc engine" }, { label: "Inline in this session" }] });
        expect(rows.map((r) => r.optionIndex)).toEqual([0, null, 1, null]);
        expect(rows[1].recommended).toBe(false);
        expect(rows[1].detail).not.toBe("");
    });

    it("draws four rows with no option index when the question has no options", () => {
        expect(handoffRows({}).map((r) => r.optionIndex)).toEqual([null, null, null, null]);
        expect(handoffRows({ options: [] })).toHaveLength(4);
    });

    it("uses the agent's description for a row when it gave one", () => {
        const rows = handoffRows(all({ "Arc engine": "Runs on route arcterm now." }));
        expect(rows[0].detail).toBe("Runs on route arcterm now.");
    });

    it("uses the default sentence when the description is missing or blank", () => {
        const rows = handoffRows(all({ "Arc engine": "   " }));
        for (const r of rows) {
            expect(r.detail.trim()).not.toBe("");
        }
        expect(rows[0].detail).toBe(handoffRows(all())[0].detail);
    });

    it("never calls the inline choice Native", () => {
        for (const r of handoffRows({})) {
            expect(`${r.label} ${r.detail}`).not.toMatch(/native/i);
        }
    });
});

describe("planPathOf", () => {
    it("reads a backticked path", () => {
        expect(planPathOf("Plan saved to `docs/superpowers/plans/2026-11-13-x.md`. How should it run?")).toBe(
            "docs/superpowers/plans/2026-11-13-x.md"
        );
    });

    it("reads a bare path", () => {
        expect(planPathOf("Plan saved to docs/plans/x.md. How should it run?")).toBe("docs/plans/x.md");
        expect(planPathOf("plan: docs/plans/x.md")).toBe("docs/plans/x.md");
    });

    it("reads a Windows path", () => {
        expect(planPathOf("Plan at C:\\Users\\me\\repo\\docs\\plans\\x.md (5 tasks)")).toBe(
            "C:\\Users\\me\\repo\\docs\\plans\\x.md"
        );
        expect(planPathOf("Plan at `C:\\Users\\me\\my repo\\x.md`")).toBe("C:\\Users\\me\\my repo\\x.md");
    });

    it("takes the first .md path when the text names several", () => {
        expect(planPathOf("Plan `a/plan.md` follows the spec `b/spec.md`.")).toBe("a/plan.md");
        expect(planPathOf("From b/spec.md, the plan `a/plan.md`.")).toBe("b/spec.md");
    });

    it("does not take a longer extension that starts with md", () => {
        expect(planPathOf("see notes.mdx and x.md5")).toBeNull();
    });

    it("is null when the text names no markdown file", () => {
        expect(planPathOf("How should the plan run?")).toBeNull();
        expect(planPathOf("")).toBeNull();
    });
});

describe("planFacts", () => {
    it("reads the title and counts the tasks of a serial plan (no Depends lines)", () => {
        const plan = [
            "# Chat handoff — plan",
            "",
            "intro",
            "",
            "### Task 1: One",
            "text",
            "### Task 2: Two",
            "text",
            "### Task 3: Three",
        ].join("\n");
        expect(planFacts(plan)).toEqual({ title: "Chat handoff — plan", tasks: 3, width: 1 });
    });

    it("counts both ## and ### task headings", () => {
        const plan = "# T\n## Task 1: a\n## Task 2: b\n### Task 3: c\n";
        expect(planFacts(plan).tasks).toBe(3);
    });

    it("takes none as level 0, so tasks that depend on nothing run at once", () => {
        const plan = [
            "# P",
            "### Task 1: a",
            "**Depends on:** none",
            "### Task 2: b",
            "**Depends on:** none",
            "### Task 3: c",
            "**Depends on:** none",
        ].join("\n");
        expect(planFacts(plan)).toEqual({ title: "P", tasks: 3, width: 3 });
    });

    it("measures the widest level of the Depends graph, a task with listed Depends one level below its deepest", () => {
        const plan = [
            "# P",
            "### Task 1: a",
            "**Depends on:** none",
            "### Task 2: b",
            "**Depends on:** none",
            "### Task 3: c",
            "**Depends on:** Task 1",
            "### Task 4: d",
            "**Depends on:** Task 1, Task 3",
            "### Task 5: e",
            "**Depends on:** Task 2",
        ].join("\n");
        // levels: t1 0, t2 0, t3 1, t4 2, t5 1 -> widths 2, 2, 1
        expect(planFacts(plan)).toEqual({ title: "P", tasks: 5, width: 2 });
    });

    it("reads a dependency with a reason in parentheses, commas inside the reason included", () => {
        const plan = [
            "# P",
            "### Task 1: a",
            "**Depends on:** none",
            "### Task 2: b",
            "**Depends on:** none",
            "### Task 3: c",
            "**Depends on:** Task 1 (uses its types, its parser), Task 2 (the rows it adds)",
            "### Task 4: d",
            "**Depends on:** Task 3 (all of it)",
        ].join("\n");
        expect(planFacts(plan)).toEqual({ title: "P", tasks: 4, width: 2 });
    });

    it("runs a task with no Depends line after the previous one", () => {
        const plan = [
            "# P",
            "### Task 1: a",
            "**Depends on:** none",
            "### Task 2: b",
            "**Depends on:** none",
            "### Task 3: c",
            "text with no Depends line",
        ].join("\n");
        // t3 follows t2 (level 0) -> level 1
        expect(planFacts(plan)).toEqual({ title: "P", tasks: 3, width: 2 });
    });

    it("reads the Depends line when a blank line separates it from its heading", () => {
        const plan = "# P\n### Task 1: a\n\n**Depends on:** none\n### Task 2: b\n\n**Depends on:** none\n";
        expect(planFacts(plan).width).toBe(2);
    });

    it("ignores headings and Depends lines inside a code fence", () => {
        const plan = [
            "# Real title",
            "```md",
            "# Fenced title",
            "### Task 9: fenced",
            "```",
            "### Task 1: a",
            "**Depends on:** none",
        ].join("\n");
        expect(planFacts(plan)).toEqual({ title: "Real title", tasks: 1, width: 1 });
    });

    it("gives the title alone for a plan with no tasks", () => {
        expect(planFacts("# Only a title\n\nsome text\n")).toEqual({ title: "Only a title" });
    });

    it("gives nothing for text with neither title nor tasks, and takes ## headings for no title", () => {
        expect(planFacts("")).toEqual({});
        expect(planFacts("## Not a title\ntext")).toEqual({});
    });

    it("leaves a dependency on an unknown task out of the levels", () => {
        const plan = "# P\n### Task 1: a\n**Depends on:** none\n### Task 2: b\n**Depends on:** Task 7\n";
        expect(planFacts(plan)).toEqual({ title: "P", tasks: 2, width: 2 });
    });
});

describe("factsLine", () => {
    const facts = { title: "T", tasks: 5, width: 3 };
    const runs = { active: 2, max: 3 };

    it("joins the file name, the tasks and the runs as the board does", () => {
        expect(factsLine({ path: "docs/superpowers/plans/2026-11-13-x.md", facts, runs })).toBe(
            "2026-11-13-x.md · 5 tasks, up to 3 at once · 2 of 3 runs active"
        );
    });

    it("takes the file name of a Windows path", () => {
        expect(factsLine({ path: "C:\\repo\\docs\\x.md", facts: null, runs: null })).toBe("x.md");
    });

    it("leaves the file out when there is no path", () => {
        expect(factsLine({ path: null, facts, runs })).toBe("5 tasks, up to 3 at once · 2 of 3 runs active");
        expect(factsLine({ facts, runs })).toBe("5 tasks, up to 3 at once · 2 of 3 runs active");
    });

    it("leaves the plan's part out when the plan is unread", () => {
        expect(factsLine({ path: "x.md", facts: null, runs })).toBe("x.md · 2 of 3 runs active");
        expect(factsLine({ path: "x.md", facts: {}, runs })).toBe("x.md · 2 of 3 runs active");
        expect(factsLine({ path: "x.md", facts: { title: "T" }, runs })).toBe("x.md · 2 of 3 runs active");
    });

    it("leaves the runs out when the run list is unknown", () => {
        expect(factsLine({ path: "x.md", facts, runs: null })).toBe("x.md · 5 tasks, up to 3 at once");
        expect(factsLine({ path: "x.md", facts })).toBe("x.md · 5 tasks, up to 3 at once");
    });

    it("leaves the runs out when runs:maxactive is 0, which means no cap, never 2 of 0 runs active", () => {
        expect(factsLine({ path: "x.md", facts, runs: { active: 2, max: 0 } })).toBe("x.md · 5 tasks, up to 3 at once");
        expect(factsLine({ facts: null, runs: { active: 0, max: 0 } })).toBe("");
    });

    it("leaves out runs that are not numbers", () => {
        expect(factsLine({ path: "x.md", runs: { active: Number.NaN, max: 3 } })).toBe("x.md");
        expect(factsLine({ path: "x.md", runs: { active: 1, max: Number.NaN } })).toBe("x.md");
    });

    it("says a task in the singular, and leaves the width out for a plan of one", () => {
        expect(factsLine({ facts: { tasks: 1, width: 1 } })).toBe("1 task");
    });

    it("says a serial plan runs one at a time, not up to 1 at once", () => {
        expect(factsLine({ facts: { tasks: 4, width: 1 } })).toBe("4 tasks, one at a time");
    });

    it("says the tasks alone when the width is unknown", () => {
        expect(factsLine({ facts: { tasks: 4 } })).toBe("4 tasks");
    });

    it("says a run in the singular when the cap is one", () => {
        expect(factsLine({ runs: { active: 1, max: 1 } })).toBe("1 of 1 run active");
    });

    it("is empty when it knows nothing", () => {
        expect(factsLine({})).toBe("");
        expect(factsLine({ path: null, facts: null, runs: null })).toBe("");
    });

    it("never says Native", () => {
        expect(factsLine({ path: "x.md", facts, runs })).not.toMatch(/native/i);
    });
});

describe("isEngineChoice", () => {
    it("is true for the two engine choices", () => {
        expect(isEngineChoice("Arc engine")).toBe(true);
        expect(isEngineChoice("Arc engine, queued")).toBe(true);
    });

    it("takes the label as the agent wrote it, suffix and case aside", () => {
        expect(isEngineChoice("Arc engine (Recommended)")).toBe(true);
        expect(isEngineChoice("arc engine, QUEUED")).toBe(true);
    });

    it("is false for the others and for a typed reply", () => {
        expect(isEngineChoice("Inline in this session")).toBe(false);
        expect(isEngineChoice("Subagent-driven")).toBe(false);
        expect(isEngineChoice("Use the engine, but wait")).toBe(false);
        expect(isEngineChoice("")).toBe(false);
    });
});

describe("handoffDoneLine", () => {
    it("reads Handoff · <choice> for each of the four choices", () => {
        for (const c of HANDOFF_CHOICES) {
            expect(handoffDoneLine({ picked: [c] })).toBe(`Handoff · ${c}`);
        }
    });

    it("drops (Recommended) from a picked label", () => {
        expect(handoffDoneLine({ picked: ["Arc engine (Recommended)"] })).toBe("Handoff · Arc engine");
    });

    it("reads Handoff · You replied for a typed answer", () => {
        expect(handoffDoneLine({ picked: [], typed: "go with the engine but wait for run 3" })).toBe(
            "Handoff · You replied"
        );
    });

    it("prefers the picked choice when there is one", () => {
        expect(handoffDoneLine({ picked: ["Inline in this session"], typed: "x" })).toBe(
            "Handoff · Inline in this session"
        );
    });

    it("reads Handoff alone when nothing was answered", () => {
        expect(handoffDoneLine({ picked: [] })).toBe("Handoff");
        expect(handoffDoneLine({ picked: [], typed: "  " })).toBe("Handoff");
    });
});
