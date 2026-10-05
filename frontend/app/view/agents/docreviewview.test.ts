// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { describe, expect, it } from "vitest";
import { toProse } from "./docprose";
import {
    anchorTarget,
    commentNumbers,
    focusTarget,
    headingId,
    imageMark,
    isNarrow,
    leadLabel,
    metaLine,
    resolveRelative,
    reviewRows,
    runLabel,
    sectionHeading,
    sentenceMarks,
    sentLine,
    trayState,
    type ReviewRow,
} from "./docreviewview";
import type { ProseComment } from "./proseanchor";
import { diffProse, type SectionChange } from "./prosediff";

const md = (text: string) => toProse("markdown", text);
const diffMd = (before: string, after: string) => diffProse(md(before), md(after));

// five numbered sections; only the last one changes
const BEFORE =
    [1, 2, 3, 4].map((n) => `## ${n}. Part ${n}\n\nPart ${n} text stays.\n`).join("\n") +
    "\n## 5. Plan\n\nStep one runs. Step two waits.\n\nThe list stays.\n";
const AFTER = BEFORE.replace("Step two waits.", "Step two still waits.");

const comment = (over: Partial<ProseComment>): ProseComment => ({
    id: "c",
    sectionIndex: 0,
    sectionLabel: "§1",
    paragraph: 1,
    sentences: [0, 0],
    quote: "q",
    selectedText: "q",
    note: "n",
    draft: false,
    ...over,
});

const kinds = (rows: ReviewRow[]) =>
    rows.map((r) => (r.kind === "unchanged" ? `run:${r.label}` : r.kind === "section" ? `§${r.section.index}` : "p"));

describe("isNarrow", () => {
    it("is the pane's own width against the comment column floor", () => {
        expect(isNarrow(719)).toBe(true);
        expect(isNarrow(720)).toBe(false);
    });
});

describe("reviewRows", () => {
    const changes = diffMd(BEFORE, AFTER);

    it("shows changed sections only and folds a run of unchanged ones into one row", () => {
        expect(kinds(reviewRows(changes, [], false))).toEqual(["run:1. – 4. · unchanged", "§4", "p", "p"]);
    });

    it("shows every section with wholeFile", () => {
        const rows = reviewRows(changes, [], true);
        expect(rows.filter((r) => r.kind === "unchanged")).toEqual([]);
        expect(rows.filter((r) => r.kind === "section").map((r) => r.section.index)).toEqual([0, 1, 2, 3, 4]);
    });

    it("keeps a section that holds a comment, splitting the run around it", () => {
        const c = comment({ id: "c2", sectionIndex: 1, sectionLabel: "2.", paragraph: 1 });
        expect(kinds(reviewRows(changes, [c], false))).toEqual([
            "run:1. Part 1 · unchanged",
            "§1",
            "p",
            "run:3. – 4. · unchanged",
            "§4",
            "p",
            "p",
        ]);
    });

    it("attaches comments to their paragraph row in document order", () => {
        const late = comment({ id: "late", sectionIndex: 4, sectionLabel: "5.", paragraph: 1, sentences: [1, 1] });
        const early = comment({ id: "early", sectionIndex: 4, sectionLabel: "5.", paragraph: 1, sentences: [0, 0] });
        const other = comment({ id: "other", sectionIndex: 4, sectionLabel: "5.", paragraph: 2 });
        const paras = reviewRows(changes, [late, other, early], false).filter((r) => r.kind === "paragraph");
        expect(paras.map((r) => (r.kind === "paragraph" ? r.comments.map((c) => c.id) : []))).toEqual([
            ["early", "late"],
            ["other"],
        ]);
    });

    it("gives every row a distinct key, even a removed section beside the after section at its index", () => {
        const removed = diffMd(
            "## A\n\nAlpha text here.\n\n## B\n\nBeta.\n",
            "## C\n\nGamma text there.\n\n## B\n\nBeta.\n"
        );
        const keys = reviewRows(removed, [], true).map((r) => r.key);
        expect(new Set(keys).size).toBe(keys.length);
    });

    it("sums a section's counts into its stats line", () => {
        const section = reviewRows(changes, [], false).find((r) => r.kind === "section");
        expect(section?.kind === "section" && section.stats).toBe("1 edited");
    });
});

describe("runLabel", () => {
    it("names one section by label and title, a run by its first and last label", () => {
        expect(runLabel([{ label: "§2", title: "Background" }])).toBe("§2 Background · unchanged");
        expect(
            runLabel([
                { label: "1.", title: "A" },
                { label: "2.", title: "B" },
                { label: "4.", title: "D" },
            ])
        ).toBe("1. – 4. · unchanged");
        expect(
            runLabel([
                { label: "§2", title: "x" },
                { label: "§4", title: "y" },
            ])
        ).toBe("§2 – §4 · unchanged");
    });

    it("does not print an unnumbered section's title twice", () => {
        expect(runLabel([{ label: "Front matter", title: "Front matter" }])).toBe("Front matter · unchanged");
    });
});

describe("commentNumbers and sentenceMarks", () => {
    const a = comment({ id: "a", sectionIndex: 2, paragraph: 1, sentences: [1, 2] });
    const b = comment({ id: "b", sectionIndex: 1, paragraph: 3 });
    const d = comment({ id: "d", sectionIndex: 0, paragraph: 1, draft: true });

    it("numbers saved comments as the answer will, and a draft after them", () => {
        expect(Object.fromEntries(commentNumbers([a, b, d]))).toEqual({ b: 1, a: 2, d: 3 });
    });

    it("underlines every covered sentence and chips the last one", () => {
        const marks = sentenceMarks([a], commentNumbers([a]));
        expect(marks.get(1)).toEqual({ draft: false, chips: [] });
        expect(marks.get(2)).toEqual({ draft: false, chips: [1] });
        expect(marks.has(0)).toBe(false);
    });

    it("draws a draft dashed until a saved comment covers the same sentence", () => {
        const draft = comment({ id: "x", sentences: [0, 0], draft: true });
        const saved = comment({ id: "y", sentences: [0, 0] });
        expect(sentenceMarks([draft], commentNumbers([draft])).get(0)?.draft).toBe(true);
        expect(sentenceMarks([draft, saved], commentNumbers([draft, saved])).get(0)).toEqual({
            draft: false,
            chips: [1, 2],
        });
    });
});

describe("trayState", () => {
    const saved = comment({ id: "s" });
    const draft = comment({ id: "d", draft: true });

    it("with nothing to send, Approve is the accent and Request changes is off", () => {
        expect(trayState([], "", "paper-writer")).toEqual({
            accent: "approve",
            requestEnabled: false,
            saved: 0,
            drafts: 0,
            hint: "Comment on a passage to ask for changes.",
        });
    });

    it("one saved comment makes Request changes the accent", () => {
        const t = trayState([saved], "", "paper-writer");
        expect(t.accent).toBe("request");
        expect(t.requestEnabled).toBe(true);
        expect(t.hint).toBe("Sends 1 comment to paper-writer as one answer.");
    });

    it("a note alone can be sent", () => {
        const t = trayState([], " tighten §3 ", "paper-writer");
        expect(t.requestEnabled).toBe(true);
        expect(t.hint).toBe("Sends your note to paper-writer as one answer.");
        expect(trayState([saved, saved], "x", "paper-writer").hint).toBe(
            "Sends 2 comments and your note to paper-writer as one answer."
        );
    });

    it("says a draft is not added yet, and a draft alone sends nothing", () => {
        expect(trayState([saved, draft], "", "w").hint).toBe(
            "Sends 1 comment to w as one answer. 1 comment is not added yet."
        );
        const onlyDraft = trayState([draft], "", "w");
        expect(onlyDraft.accent).toBe("approve");
        expect(onlyDraft.drafts).toBe(1);
        expect(onlyDraft.hint).toBe("1 comment is not added yet.");
    });
});

describe("sentLine", () => {
    it("names what this tray sent, or plain Sent when another surface answered", () => {
        const tail = " · back to the terminal when paper-writer picks it up";
        expect(sentLine({ kind: "request", comments: 3 }, true, "paper-writer")).toBe(
            "Sent: Request changes, 3 comments" + tail
        );
        expect(sentLine({ kind: "request", comments: 1 }, true, "paper-writer")).toBe(
            "Sent: Request changes, 1 comment" + tail
        );
        expect(sentLine({ kind: "approve", comments: 0 }, true, "paper-writer")).toBe("Sent: Approve" + tail);
        expect(sentLine(null, true, "paper-writer")).toBe("Sent" + tail);
        expect(sentLine({ kind: "approve", comments: 0 }, false, "paper-writer")).toBeNull();
    });
});

describe("metaLine", () => {
    const counted = (insert: number, del: number, modify: number): SectionChange[] => [
        {
            status: "changed",
            level: 1,
            label: "§1",
            title: "A",
            index: 0,
            paragraphs: [],
            counts: { insert, delete: 0, modify },
        },
        {
            status: "changed",
            level: 1,
            label: "§2",
            title: "B",
            index: 1,
            paragraphs: [],
            counts: { insert: 0, delete: del, modify: 0 },
        },
    ];

    it("counts, then the baseline", () => {
        expect(metaLine(counted(2, 0, 1), "session", "5eb0de24")).toBe(
            "+2 · 1 edited · against 5eb0de24, session start"
        );
        expect(metaLine(counted(2, 1, 1), "head", "")).toBe("+2 −1 · 1 edited · against HEAD");
        expect(metaLine(counted(3, 0, 0), "new", "")).toBe("+3 · new file");
        const at = new Date(2026, 9, 5, 14, 6).getTime();
        expect(metaLine(counted(2, 1, 1), "previous", "", at)).toBe(
            "+2 −1 · 1 edited · against what you reviewed at 14:06"
        );
    });

    it("says when nothing in the prose changed", () => {
        expect(metaLine(counted(0, 0, 0), "head", "")).toBe("no prose changes · against HEAD");
    });
});

describe("focusTarget", () => {
    const sections = [
        { label: "§1", title: "Introduction" },
        { label: "§3", title: "Method overview" },
        { label: "§5.2", title: "What the patch constraint adds" },
    ];
    const note = [
        { label: "1.", title: "Bối cảnh" },
        { label: "5.", title: "Kế hoạch — 3 bước" },
    ];

    it("reads a leading section label and its paragraph", () => {
        expect(focusTarget("§5.2 ¶1 now opens with the null result", sections)).toEqual({
            sectionIndex: 2,
            paragraph: 1,
        });
        expect(focusTarget("§3 still reads like a tutorial", sections)).toEqual({ sectionIndex: 1 });
    });

    it("reads a markdown enumerator equal to a section's label", () => {
        expect(focusTarget("5. Bước 1: viết lại đầu ra", note)).toEqual({ sectionIndex: 1 });
        expect(focusTarget("5. ¶2 thêm sơ đồ", note)).toEqual({ sectionIndex: 1, paragraph: 2 });
    });

    it("falls back to a section whose title the text names", () => {
        expect(focusTarget("tightened the method overview wording", sections)).toEqual({ sectionIndex: 1 });
    });

    it("is inert when nothing matches", () => {
        expect(focusTarget("tidied wording", sections)).toBeNull();
        expect(focusTarget("§9 is new", sections)).toBeNull();
    });

    it("splits a chip's leading label from its text", () => {
        expect(leadLabel("§5.2 What the patch constraint adds: rewritten")).toEqual({
            label: "§5.2",
            rest: "What the patch constraint adds: rewritten",
        });
        expect(leadLabel("5. thêm sơ đồ pipeline")).toEqual({ label: "5.", rest: "thêm sơ đồ pipeline" });
        expect(leadLabel("tidied wording")).toBeNull();
    });
});

describe("headings and anchors", () => {
    it("slugs a heading the way GitHub does", () => {
        expect(headingId("5. Kế hoạch — 3 bước")).toBe("5-kế-hoạch--3-bước");
        expect(headingId("Hello, World!")).toBe("hello-world");
    });

    it("finds the section a #anchor names, from the heading as written", () => {
        const sections = md("## 1. Bối cảnh\n\nA.\n\n## 5. Kế hoạch — 3 bước\n\nB.\n").sections;
        expect(sectionHeading(sections[1])).toBe("5. Kế hoạch — 3 bước");
        expect(anchorTarget(sections, "#5-kế-hoạch--3-bước")).toBe(1);
        expect(anchorTarget(sections, "#5-k%E1%BA%BF-ho%E1%BA%A1ch--3-b%C6%B0%E1%BB%9Bc")).toBe(1);
        expect(anchorTarget(sections, "#nowhere")).toBeNull();
    });
});

describe("imageMark", () => {
    const changes = diffMd(
        "## 5. Plan\n\nText.\n\n![old](diagrams/old.png)\n\n![kept](diagrams/kept.png)\n",
        "## 5. Plan\n\nText.\n\n![kept](diagrams/kept.png)\n\n![pipeline](diagrams/pipeline.svg)\n"
    );
    const marks = changes[0].paragraphs.flatMap((p) => p.sentences.map(imageMark)).filter((m) => m != null);

    it("marks an added image, a removed one, and leaves an unchanged one plain", () => {
        expect(marks).toEqual([
            { kind: "removed", src: "diagrams/old.png", alt: "old" },
            { kind: "same", src: "diagrams/kept.png", alt: "kept" },
            { kind: "added", src: "diagrams/pipeline.svg", alt: "pipeline" },
        ]);
    });

    it("is null for a sentence that is not only an image", () => {
        const text = diffMd("## A\n\nSee ![x](a.png) here.\n", "## A\n\nSee ![x](a.png) here.\n");
        expect(imageMark(text[0].paragraphs[0].sentences[0])).toBeNull();
    });
});

describe("resolveRelative", () => {
    it("resolves a link against the file's folder, in the file's separator style", () => {
        expect(resolveRelative("C:\\r\\notes\\next_step.md", "diagrams/pipeline.png")).toBe(
            "C:\\r\\notes\\diagrams\\pipeline.png"
        );
        expect(resolveRelative("/r/notes/next_step.md", "../paper/main.tex")).toBe("/r/paper/main.tex");
        expect(resolveRelative("/r/notes/a.md", "./misses%20audit.md#top")).toBe("/r/notes/misses audit.md");
        expect(resolveRelative("/r/notes/a.md", "/abs/x.md")).toBe("/abs/x.md");
    });
});
