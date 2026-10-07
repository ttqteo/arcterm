// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { describe, expect, it } from "vitest";
import { toProse, type ProseKind } from "./docprose";
import {
    anchorFor,
    canRequest,
    clipSelection,
    formatRequest,
    orderComments,
    paragraphSpan,
    QUOTE_MAX,
    replacementFor,
    wordDiff,
    type ProseComment,
    type SelPoint,
} from "./proseanchor";

const PAPER = String.raw`\section{Introduction}
Intro.

\section{Method}
\subsection{Method overview}
We start here.
XYZ replaces the payload initialization with \emph{XYZ} sampling.  This   de-confounds
the \textbf{success rate}. Last one.
`;

// the paragraph `anchorFor` sees, as the pane builds it from a section of the after-document
function paraOf(kind: ProseKind, text: string, label: string, paragraph = 0) {
    const doc = toProse(kind, text);
    const sectionIndex = doc.sections.findIndex((s) => s.label === label);
    const section = doc.sections[sectionIndex];
    return { sectionIndex, label, index: paragraph + 1, sentences: section.paragraphs[paragraph].sentences };
}

function comment(id: string, over: Partial<ProseComment> = {}): ProseComment {
    return {
        id,
        sectionIndex: 0,
        sectionLabel: "§1",
        paragraph: 1,
        sentences: [0, 0],
        quote: `quote ${id}`,
        selectedText: `quote ${id}`,
        note: `note ${id}`,
        draft: false,
        ...over,
    };
}

describe("anchorFor", () => {
    it("quotes the source of every covered sentence, macros intact and whitespace collapsed", () => {
        const para = paraOf("latex", PAPER, "§2.1");
        expect(para.sentences.map((s) => s.text)).toEqual([
            "We start here.",
            "XYZ replaces the payload initialization with XYZ sampling.",
            "This de-confounds the success rate.",
            "Last one.",
        ]);
        const a = anchorFor(PAPER, para, 1, 2, "initialization with XYZ sampling. This de-confounds");
        expect(a).toEqual({
            sectionIndex: para.sectionIndex,
            sectionLabel: "§2.1",
            paragraph: 1,
            sentences: [1, 2],
            quote: String.raw`XYZ replaces the payload initialization with \emph{XYZ} sampling. This de-confounds the \textbf{success rate}.`,
            selectedText: "initialization with XYZ sampling. This de-confounds",
        });
    });

    it("quotes one sentence for a selection inside it", () => {
        const para = paraOf("latex", PAPER, "§2.1");
        const a = anchorFor(PAPER, para, 3, 3, "Last");
        expect(a.sentences).toEqual([3, 3]);
        expect(a.quote).toBe("Last one.");
    });

    it("quotes a markdown sentence from its source", () => {
        const note = "# 5. Results\n\nFirst para.\n\nThe **null result** holds. It uses `wsh ask` here.\n";
        const para = paraOf("markdown", note, "5.", 1);
        const a = anchorFor(note, para, 0, 1, "null result holds");
        expect(a.sectionLabel).toBe("5.");
        expect(a.paragraph).toBe(2);
        expect(a.quote).toBe("The **null result** holds. It uses `wsh ask` here.");
    });

    it("cuts a long quote at QUOTE_MAX characters, with no space before the ellipsis", () => {
        const long = "Word ".repeat(59) + "end."; // 299 characters, one sentence
        const text = `\\section{Long}\n${long}\n`;
        const para = paraOf("latex", text, "§1");
        const a = anchorFor(text, para, 0, 0, "Word");
        expect(QUOTE_MAX).toBe(160);
        expect(a.quote).toBe(long.slice(0, 159) + "…");
        expect(a.quote.length).toBeLessThanOrEqual(QUOTE_MAX + 1);
    });

    it("cuts a 300-character word at exactly QUOTE_MAX", () => {
        const word = "x".repeat(299) + ".";
        const text = `\\section{Long}\n${word}\n`;
        const a = anchorFor(text, paraOf("latex", text, "§1"), 0, 0, "x");
        expect(a.quote).toBe("x".repeat(160) + "…");
    });

    it("quotes sentences that share one macro's source as a true slice of the file", () => {
        const text = String.raw`\section{S}
Before. \emph{One here. Two here.} After it.
`;
        const para = paraOf("latex", text, "§1");
        expect(para.sentences.map((s) => s.text)).toEqual(["Before.", "One here.", "Two here.", "After it."]);
        const a = anchorFor(text, para, 2, 3, "Two");
        expect(text).toContain(a.quote);
        expect(a.quote).toContain("Two here.");
        expect(a.quote).toContain("After it.");
    });

    it("takes the sentences in either order", () => {
        const para = paraOf("latex", PAPER, "§2.1");
        expect(anchorFor(PAPER, para, 2, 1, "x")).toEqual(anchorFor(PAPER, para, 1, 2, "x"));
    });
});

describe("orderComments", () => {
    it("orders by section index, not by label, then paragraph, then first sentence", () => {
        const c10 = comment("c10", { sectionIndex: 9, sectionLabel: "§10" });
        const c2p2 = comment("c2p2", { sectionIndex: 1, sectionLabel: "§2", paragraph: 2 });
        const c2s3 = comment("c2s3", { sectionIndex: 1, sectionLabel: "§2", paragraph: 1, sentences: [3, 4] });
        const c2s0 = comment("c2s0", { sectionIndex: 1, sectionLabel: "§2", paragraph: 1, sentences: [0, 5] });
        const ids = orderComments([c10, c2p2, c2s3, c2s0]).map((c) => c.id);
        expect(ids).toEqual(["c2s0", "c2s3", "c2p2", "c10"]);
    });

    it("keeps drafts in their place in the document", () => {
        const late = comment("late", { sectionIndex: 3 });
        const draft = comment("draft", { sectionIndex: 2, draft: true });
        const early = comment("early", { sectionIndex: 1 });
        expect(orderComments([late, draft, early]).map((c) => c.id)).toEqual(["early", "draft", "late"]);
    });

    it("keeps the order comments were added in when they share a position, and leaves its input alone", () => {
        const input = [comment("b"), comment("a")];
        expect(orderComments(input).map((c) => c.id)).toEqual(["b", "a"]);
        expect(input.map((c) => c.id)).toEqual(["b", "a"]);
    });
});

describe("formatRequest", () => {
    const first = comment("1", {
        sectionIndex: 4,
        sectionLabel: "§3.2",
        paragraph: 2,
        sentences: [0, 0],
        quote: "XYZ replaces the payload initialization…",
        note: "Say why this de-confounds success rate.",
    });
    const second = comment("2", {
        sectionIndex: 7,
        sectionLabel: "§5.1",
        paragraph: 1,
        sentences: [2, 2],
        quote: "17/29 benchmarks…",
        note: "This disagrees with Table 3.",
    });

    it("matches the spec's sample, in document order", () => {
        expect(formatRequest([second, first], "§3 still reads like a tutorial.")).toBe(
            [
                "Request changes",
                '1. [§3.2 ¶2] "XYZ replaces the payload initialization…"',
                "   → Say why this de-confounds success rate.",
                '2. [§5.1 ¶1] "17/29 benchmarks…"',
                "   → This disagrees with Table 3.",
                "General: §3 still reads like a tutorial.",
            ].join("\n")
        );
    });

    it("has no General line when the note is empty or blank", () => {
        const want = [
            "Request changes",
            '1. [§3.2 ¶2] "XYZ replaces the payload initialization…"',
            "   → Say why this de-confounds success rate.",
        ].join("\n");
        expect(formatRequest([first], "")).toBe(want);
        expect(formatRequest([first], "  \n ")).toBe(want);
    });

    it("leaves drafts out and numbers only the saved comments", () => {
        const draft = comment("d", { sectionIndex: 5, sectionLabel: "§4", note: "half-written", draft: true });
        const out = formatRequest([second, draft, first], "");
        expect(out).not.toContain("half-written");
        expect(out).not.toContain("§4");
        expect(out).toContain('2. [§5.1 ¶1] "17/29 benchmarks…"');
    });

    it("sends the general note alone", () => {
        expect(formatRequest([], "  Tighten §3.  ")).toBe("Request changes\nGeneral: Tighten §3.");
    });

    it("writes a markdown location as the heading's label", () => {
        const md = comment("m", {
            sectionLabel: "5.",
            paragraph: 2,
            quote: "The **null result** holds.",
            note: "Cite it.",
        });
        expect(formatRequest([md], "")).toBe(
            ["Request changes", '1. [5. ¶2] "The **null result** holds."', "   → Cite it."].join("\n")
        );
    });

    it("trims a note, indents its later lines under the arrow, and drops the arrow for an empty note", () => {
        const multi = comment("x", { quote: "Q.", note: "  First line.\nSecond line.  " });
        const bare = comment("y", { sectionIndex: 1, quote: "R.", note: "   " });
        expect(formatRequest([multi, bare], "")).toBe(
            ["Request changes", '1. [§1 ¶1] "Q."', "   → First line.", "     Second line.", '2. [§1 ¶1] "R."'].join(
                "\n"
            )
        );
    });
});

describe("canRequest", () => {
    it("needs a saved comment or a note", () => {
        expect(canRequest([], "")).toBe(false);
        expect(canRequest([], "   ")).toBe(false);
        expect(canRequest([comment("d", { draft: true })], "")).toBe(false);
        expect(canRequest([comment("d", { draft: true })], "note")).toBe(true);
        expect(canRequest([comment("s")], "")).toBe(true);
    });
});

describe("clipSelection", () => {
    const pt = (section: number, paragraph: number, sentence: number): SelPoint => ({ section, paragraph, sentence });
    // section 1 ¶1 has sentences 0–3, ¶2 has 0–1; section 2 ¶1 has 0–4
    const last = (section: number, paragraph: number) => (section === 1 ? (paragraph === 1 ? 3 : 1) : 4);

    it("keeps a selection inside one sentence", () => {
        expect(clipSelection(pt(1, 1, 2), pt(1, 1, 2), last)).toEqual({
            section: 1,
            paragraph: 1,
            first: 2,
            last: 2,
            clipped: false,
        });
    });

    it("keeps a selection across two sentences of one paragraph", () => {
        expect(clipSelection(pt(1, 1, 1), pt(1, 1, 2), last)).toEqual({
            section: 1,
            paragraph: 1,
            first: 1,
            last: 2,
            clipped: false,
        });
    });

    it("clips a selection across two paragraphs to the first paragraph's last sentence", () => {
        expect(clipSelection(pt(1, 1, 2), pt(1, 2, 0), last)).toEqual({
            section: 1,
            paragraph: 1,
            first: 2,
            last: 3,
            clipped: true,
        });
    });

    it("clips a selection across two sections to the first paragraph", () => {
        expect(clipSelection(pt(1, 2, 0), pt(2, 1, 3), last)).toEqual({
            section: 1,
            paragraph: 2,
            first: 0,
            last: 1,
            clipped: true,
        });
    });

    it("orders a backward selection", () => {
        expect(clipSelection(pt(1, 1, 2), pt(1, 1, 0), last)).toEqual({
            section: 1,
            paragraph: 1,
            first: 0,
            last: 2,
            clipped: false,
        });
        expect(clipSelection(pt(2, 1, 3), pt(1, 1, 1), last)).toEqual({
            section: 1,
            paragraph: 1,
            first: 1,
            last: 3,
            clipped: true,
        });
    });
});

describe("paragraphSpan", () => {
    it("runs from the earliest start to the latest end, since one macro's sentences share a span", () => {
        const s = (start: number, end: number) => ({ tokens: [], text: "", source: { start, end } });
        expect(paragraphSpan([s(10, 20), s(5, 30), s(22, 25)])).toEqual({ start: 5, end: 30 });
    });
});

describe("replacementFor", () => {
    const FILE = "Intro line.\n\nA proof is an input that makes a defect show up in a running program.\n";
    const PARA = "A proof is an input that makes a defect show up in a running program.";

    // what the agent needs: the old text found exactly once, long enough to spot, holding the change
    const checks = (file: string, para: string, before: string, after: string) => {
        const r = replacementFor(file, para, para.replace(before, after));
        expect(file.split(r.old).length - 1).toBe(1);
        expect(r.old.length).toBeGreaterThanOrEqual(16);
        expect(r.old.length).toBeLessThan(para.length);
        expect(r.old).toBe(r.old.trim());
        expect(r.new).toBe(r.old.replace(before, after));
    };

    it("keeps the change with a little context, not the whole paragraph", () => {
        checks(FILE, PARA, "show up", "manifest");
    });

    it("widens the context until the old text occurs once", () => {
        const file = "is an input that works. A proof is an input that works and more.\n";
        checks(file, "A proof is an input that works and more.", "an input", "a test input");
    });

    it("anchors an insertion to its neighbours", () => {
        checks(FILE, PARA, "a running", "a real running");
    });

    it("handles a change at the start and at the end", () => {
        checks(FILE, PARA, "A proof", "One proof");
        checks(FILE, PARA, "program.", "process.");
    });

    it("falls back to the whole paragraph when nothing shorter is unique", () => {
        const file = "same same\nsame same\n";
        const r = replacementFor(file, "same same", "same other");
        expect(r).toEqual({ old: "same same", new: "same other" });
    });
});

describe("wordDiff", () => {
    it("marks removed and added words and keeps the rest", () => {
        expect(wordDiff("a defect show up here", "a defect manifest here")).toEqual([
            { op: "same", text: "a defect " },
            { op: "delete", text: "show up " },
            { op: "insert", text: "manifest " },
            { op: "same", text: "here" },
        ]);
    });
});

describe("formatRequest with a suggestion", () => {
    const base = { sectionIndex: 1, sectionLabel: "§1", paragraph: 1, sentences: [0, 2] as [number, number] };
    it("writes the exact old and new text, unclipped, among the comments in document order", () => {
        const comments: ProseComment[] = [
            {
                ...base,
                sectionIndex: 2,
                sectionLabel: "§2",
                id: "c",
                note: "Why?",
                draft: false,
                quote: "q",
                selectedText: "q",
            },
            {
                ...base,
                id: "s",
                note: "",
                draft: false,
                quote: "q",
                selectedText: "",
                suggestion: { from: "show up in it", to: "manifest in it", old: "show up", new: "manifest" },
            },
        ];
        expect(formatRequest(comments, "")).toBe(
            [
                "Request changes",
                "1. [§1 ¶1] Edit: replace",
                '   "show up"',
                "   with",
                '   "manifest"',
                '2. [§2 ¶1] "q"',
                "   → Why?",
            ].join("\n")
        );
    });

    it("indents a multi-line replacement and adds the note", () => {
        const c: ProseComment = {
            ...base,
            id: "s",
            note: "Shorter.",
            draft: false,
            quote: "q",
            selectedText: "",
            suggestion: { from: "x", to: "y", old: "one\ntwo", new: "three" },
        };
        expect(formatRequest([c], "")).toBe(
            [
                "Request changes",
                "1. [§1 ¶1] Edit: replace",
                '   "one',
                '   two"',
                "   with",
                '   "three"',
                "   → Shorter.",
            ].join("\n")
        );
    });
});

describe("wordDiff at the end of a paragraph", () => {
    it("keeps the last word when text is added after it", () => {
        expect(wordDiff("It ends here.", "It ends here. More words.")).toEqual([
            { op: "same", text: "It ends here. " },
            { op: "insert", text: "More words." },
        ]);
    });
});
