// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { describe, expect, it } from "vitest";
import {
    proseKindOf,
    texAuthors,
    texHasProse,
    texTitle,
    toProse,
    type ProseDoc,
    type ProseKind,
    type ProseSentence,
} from "./docprose";

const sentenceTexts = (doc: ProseDoc, section = 0, paragraph = 0) =>
    doc.sections[section].paragraphs[paragraph].sentences.map((s) => s.text);
const kinds = (s: ProseSentence) => s.tokens.map((t) => [t.kind, t.text.trim()]);
const labels = (doc: ProseDoc) => doc.sections.map((s) => s.label);

// the spec's §5.2 example, in a paper shaped like the thesis repo's: preamble, front matter, nested sections
const PAPER = String.raw`\documentclass[sigconf]{acmart}
\usepackage{graphicx}
\title{Property-based exploit generation}
\begin{document}
\maketitle
\begin{abstract}
We study exploit generation. Our method is deterministic.
\end{abstract}

\section{Introduction}
Agents write exploits~\cite{a2025}. % TODO cut this
We ask whether they can be trusted.

\section{Method}\label{sec:method}
\subsection{Method overview}
XYZ replaces the payload initialization with \emph{a deterministic replay}~\cite{anderson2000,garcia2016}.
This de-confounds the \textbf{success rate}, e.g. in Fig.~\ref{fig:rq} vs. Table~\ref{tab:rq}.

\begin{figure}[t]
  \centering
  \includegraphics[width=\linewidth]{rq.pdf}
  \caption{Overview of \emph{XYZ}.}
  \label{fig:rq}
\end{figure}

We report 17/29 benchmarks, i.e. 58\% of the set, with $p < 0.05$. See \autoref{sec:eval}.
\subsection{Threats}
None.
\paragraph{Scope}
Only Java.
\section*{Acknowledgments}
Thanks.
\end{document}
`;

const NOTE = `---
title: seminar note
---
Intro before any heading. It has two sentences.

# 5. Results

The **null result** holds, see [the plan](../plan.md) and [docs](https://example.com/a_b).
It uses \`wsh ask\` and *emphasis* or _this_ and snake_case_name too.

![Pipeline diagram](img/pipeline.png)

- first item. Second sentence of it.
- second item with $x^2$ inline
  continued on a second line

## 5.2 Setup details

1. numbered one
2. numbered two

> quoted line

| Name | Value |
| ---- | ----- |
| a    | 1     |

\`\`\`ts
const x = 1. Not a sentence.
\`\`\`

## A heading that is much longer than forty characters

Price is $5 and $6 here.
`;

const FIXTURES: [ProseKind, string][] = [
    ["latex", PAPER],
    ["markdown", NOTE],
];

describe("proseKindOf", () => {
    it("maps the extension to a kind", () => {
        expect(proseKindOf("D:\\thesis\\paper\\main.tex")).toBe("latex");
        expect(proseKindOf("/x/NOTE.TEX")).toBe("latex");
        expect(proseKindOf("a/b/note.md")).toBe("markdown");
        expect(proseKindOf("a/b/note.markdown")).toBe("markdown");
        expect(proseKindOf("a/b/figure.pdf")).toBeNull();
        expect(proseKindOf("a/b/main.tex.bak")).toBeNull();
    });
});

describe("toProse latex: sections", () => {
    it("counts § labels per level", () => {
        const doc = toProse(
            "latex",
            String.raw`\section{A}
\subsection{B}
\subsection{C}
\subsubsection{D}
\section{E}
\subsection{F}
`
        );
        expect(labels(doc)).toEqual(["§1", "§1.1", "§1.2", "§1.2.1", "§2", "§2.1"]);
        expect(doc.sections.map((s) => s.level)).toEqual([1, 2, 2, 3, 1, 2]);
        expect(doc.sections.map((s) => s.title)).toEqual(["A", "B", "C", "D", "E", "F"]);
        expect(doc.kind).toBe("latex");
    });

    it("leaves starred sections and \\paragraph unnumbered, labelled by their title", () => {
        const doc = toProse(
            "latex",
            String.raw`\section{A}
\section*{Thanks}
\paragraph{Notes} Run-in text.
\section{B}
`
        );
        expect(labels(doc)).toEqual(["§1", "Thanks", "Notes", "§2"]);
        expect(doc.sections[1].level).toBe(1);
        expect(doc.sections[2].level).toBe(4);
        expect(sentenceTexts(doc, 2)).toEqual(["Run-in text."]);
    });

    it("titles the text before the first heading by \\title, else 'Front matter'", () => {
        const doc = toProse("latex", PAPER);
        expect(doc.sections[0]).toMatchObject({ level: 0, title: "Property-based exploit generation" });
        expect(sentenceTexts(doc, 0)).toEqual(["We study exploit generation.", "Our method is deterministic."]);
        const bare = toProse("latex", "Just some words.\n\n\\section{A}\nBody.\n");
        expect(bare.sections[0]).toMatchObject({ level: 0, title: "Front matter", label: "Front matter" });
        expect(sentenceTexts(bare, 0)).toEqual(["Just some words."]);
    });

    it("strips macros from a \\title", () => {
        const doc = toProse("latex", String.raw`\title{Rewriting \emph{XYZ}\\ again}` + "\n\nBody.\n");
        expect(doc.sections[0].title).toBe("Rewriting XYZ again");
    });

    it("has no front-matter section when the document opens with a heading", () => {
        const doc = toProse("latex", "\\section{A}\nBody.\n");
        expect(doc.sections).toHaveLength(1);
        expect(doc.sections[0].label).toBe("§1");
    });

    it("skips the preamble and everything after \\end{document}", () => {
        const doc = toProse("latex", PAPER);
        const all = doc.sections.flatMap((s) => s.paragraphs.flatMap((p) => p.sentences.map((x) => x.text))).join(" ");
        expect(all).not.toContain("acmart");
        expect(all).not.toContain("graphicx");
        expect(all).not.toContain("sigconf");
    });

    it("reads a whole file with no \\begin{document}", () => {
        const doc = toProse("latex", "\\section{A}\nOne.\n");
        expect(sentenceTexts(doc)).toEqual(["One."]);
    });

    it("ignores a heading inside a comment", () => {
        const doc = toProse("latex", "\\section{A}\nOne.\n% \\section{Hidden}\nTwo.\n");
        expect(doc.sections).toHaveLength(1);
        expect(sentenceTexts(doc)).toEqual(["One.", "Two."]);
    });

    it("keeps the dashes, quotes and escapes a reader sees", () => {
        const doc = toProse("latex", "A--B and C---D, ``quoted'' \\& \\_x\\_ \\# \\$5.\n");
        expect(sentenceTexts(doc, 0)[0]).toBe("A–B and C—D, “quoted” & _x_ # $5.");
    });
});

describe("toProse latex: paragraphs", () => {
    it("splits paragraphs on blank lines", () => {
        const doc = toProse("latex", "\\section{A}\nOne. Two.\nstill the first.\n\nSecond paragraph.\n\n\n\nThird.\n");
        expect(doc.sections[0].paragraphs).toHaveLength(3);
        expect(sentenceTexts(doc, 0, 0)).toEqual(["One.", "Two. still the first."]);
        expect(sentenceTexts(doc, 0, 1)).toEqual(["Second paragraph."]);
    });

    it("does not break a paragraph at a comment-only line", () => {
        const doc = toProse("latex", "\\section{A}\nFirst part.\n% a note to self\nSecond part.\n\nNext.\n");
        expect(doc.sections[0].paragraphs).toHaveLength(2);
        expect(sentenceTexts(doc, 0, 0)).toEqual(["First part.", "Second part."]);
    });

    it("drops a paragraph that is only a comment or a dropped macro", () => {
        const doc = toProse("latex", "\\section{A}\n% nothing here\n\n\\vspace{2mm}\n\nReal.\n");
        expect(doc.sections[0].paragraphs).toHaveLength(1);
    });

    it("turns \\item into list paragraphs and hides the environment markers", () => {
        const doc = toProse(
            "latex",
            String.raw`\section{A}
Intro text:
\begin{itemize}
  \item First point. More.
  \item Second \emph{point}

  \item Third
\end{itemize}
After.
`
        );
        const ps = doc.sections[0].paragraphs;
        expect(ps.map((p) => p.sentences.map((s) => s.text))).toEqual([
            ["Intro text:"],
            ["First point.", "More."],
            ["Second point"],
            ["Third After."],
        ]);
        expect(ps.map((p) => !!p.list)).toEqual([false, true, true, true]);
    });
});

describe("toProse latex: sentences", () => {
    const split = (src: string) => sentenceTexts(toProse("latex", `\\section{A}\n${src}\n`));

    it("splits on . ? ! followed by space and an uppercase letter", () => {
        expect(split("One. Two? Three! four. Five.")).toEqual(["One.", "Two?", "Three! four.", "Five."]);
    });

    it("splits before a macro, not before lowercase text", () => {
        expect(split("We use \\emph{A}. \\emph{B} follows.")).toEqual(["We use A.", "B follows."]);
        expect(split("This is v. big. but fine.")).toEqual(["This is v. big. but fine."]);
    });

    it("does not split after a common abbreviation", () => {
        expect(split("See e.g. Smith et al. Fig.~3 vs. Eq.~2 for Sec. 4.")).toEqual([
            "See e.g. Smith et al. Fig. 3 vs. Eq. 2 for Sec. 4.",
        ]);
        expect(split("It holds (i.e. Always). Then it ends.")).toEqual(["It holds (i.e. Always).", "Then it ends."]);
        expect(split("Shown in Fig. 3. Next one.")).toEqual(["Shown in Fig. 3.", "Next one."]);
    });

    it("does not split inside math", () => {
        const s = split("We set $x = a. B$ here. Then.");
        expect(s).toEqual(["We set x = a. B here.", "Then."]);
    });

    it("keeps a closing bracket or quote with the sentence it ends", () => {
        expect(split("It works (see above.) Then more.")).toEqual(["It works (see above.)", "Then more."]);
    });

    it("splits on a Vietnamese capital letter, not only A-Z", () => {
        expect(split("Bước 1 xong. Đã chạy script. Ế quá!")).toEqual(["Bước 1 xong.", "Đã chạy script.", "Ế quá!"]);
        expect(split("Xem e.g. Đây là ví dụ.")).toEqual(["Xem e.g. Đây là ví dụ."]);
    });
});

describe("toProse latex: macros", () => {
    const sentence = (src: string) => toProse("latex", `\\section{A}\n${src}\n`).sections[0].paragraphs[0].sentences[0];

    it("reads % as a comment and \\% as a percent sign", () => {
        const doc = toProse("latex", "\\section{A}\nGain of 5\\% overall. % hidden words\nNext line.\n");
        expect(sentenceTexts(doc)).toEqual(["Gain of 5% overall.", "Next line."]);
    });

    it("maps formatting macros to token kinds", () => {
        const s = sentence("A \\emph{b} \\textit{c} \\textbf{d} \\texttt{e}.");
        expect(kinds(s)).toEqual([
            ["text", "A"],
            ["em", "b"],
            ["em", "c"],
            ["strong", "d"],
            ["code", "e"],
            ["text", "."],
        ]);
    });

    it("emits one word-sized token per word and keeps trailing whitespace in its text", () => {
        const s = sentence("An \\emph{italic phrase} here");
        expect(s.tokens.map((t) => [t.kind, t.text])).toEqual([
            ["text", "An "],
            ["em", "italic "],
            ["em", "phrase "],
            ["text", "here"],
        ]);
    });

    it("turns \\cite and \\ref into one bracketed token", () => {
        const s = sentence("As in \\cite{a,b} and \\autoref{sec:x}, see Fig.~\\ref{f}\\label{l}.");
        expect(kinds(s)).toEqual([
            ["text", "As"],
            ["text", "in"],
            ["cite", "[a, b]"],
            ["text", "and"],
            ["ref", "[sec:x]"],
            ["text", ","],
            ["text", "see"],
            ["text", "Fig."],
            ["ref", "[f]"],
            ["text", "."],
        ]);
    });

    it("skips an optional argument of \\cite", () => {
        const s = sentence("Shown \\cite[p.~3]{key}.");
        expect(kinds(s).find(([k]) => k === "cite")).toEqual(["cite", "[key]"]);
    });

    it("keeps the last braced argument of an unknown macro, and drops one with none", () => {
        const s = sentence("The \\textsc{Foo} tool \\foo\\bar and \\href{http://x.y}{a link} and \\vspace{2mm}done.");
        expect(s.text).toBe("The Foo tool and a link and done.");
    });

    it("reads a space for ~", () => {
        expect(sentence("Fig.~3 and A~B.").text).toBe("Fig. 3 and A B.");
    });

    it("emits math as one token holding the TeX", () => {
        const s = sentence("Let $x_1 + y$ and \\(z\\) hold, then \\[ a = b \\] and $$c$$ end.");
        const math = s.tokens.filter((t) => t.kind === "math");
        expect(math.map((t) => [t.text.trim(), !!t.display])).toEqual([
            ["x_1 + y", false],
            ["z", false],
            ["a = b", true],
            ["c", true],
        ]);
    });

    it("emits an equation or align environment as display math, whole, with the label removed", () => {
        const doc = toProse(
            "latex",
            String.raw`\section{A}
We have
\begin{equation}
  E = mc^2 \label{eq:e}
\end{equation}
and
\begin{align*}
  a &= b \\
  c &= d
\end{align*}
done.
`
        );
        const math = doc.sections[0].paragraphs[0].sentences[0].tokens.filter((t) => t.kind === "math");
        expect(math).toHaveLength(2);
        expect(math.every((t) => t.display)).toBe(true);
        expect(math[0].text).toContain("\\begin{equation}");
        expect(math[0].text).toContain("E = mc^2");
        expect(math[0].text).not.toContain("\\label");
        expect(math[1].text).toContain("\\begin{align*}");
    });

    it("reads a lone $ as a dollar sign", () => {
        expect(sentence("It costs 5$ only.").text).toBe("It costs 5$ only.");
    });

    it("turns a figure into one placeholder sentence of its own", () => {
        const doc = toProse("latex", PAPER);
        const method = doc.sections.find((s) => s.title === "Method overview")!;
        expect(method.paragraphs.map((p) => p.sentences.map((s) => s.text))).toEqual([
            [
                "XYZ replaces the payload initialization with a deterministic replay [anderson2000, garcia2016].",
                "This de-confounds the success rate, e.g. in Fig. [fig:rq] vs. Table [tab:rq].",
            ],
            ["[Figure: Overview of XYZ.]"],
            ["We report 17/29 benchmarks, i.e. 58% of the set, with p < 0.05.", "See [sec:eval]."],
        ]);
        const fig = method.paragraphs[1].sentences[0];
        expect(fig.tokens).toEqual([{ kind: "placeholder", text: "[Figure: Overview of XYZ.]" }]);
        const src = PAPER.slice(fig.source.start, fig.source.end);
        expect(src.startsWith("\\begin{figure}")).toBe(true);
        expect(src.endsWith("\\end{figure}")).toBe(true);
    });

    it("turns a table into a [Table: …] placeholder", () => {
        const doc = toProse(
            "latex",
            String.raw`\section{A}
\begin{table*}[t]
\begin{tabular}{ll}
a & b \\
\end{tabular}

\caption[short]{Results by venue}
\end{table*}
`
        );
        expect(doc.sections[0].paragraphs).toHaveLength(1);
        expect(sentenceTexts(doc)).toEqual(["[Table: Results by venue]"]);
    });

    it("keeps the source of an edited sentence intact, macros and all", () => {
        const doc = toProse("latex", PAPER);
        const method = doc.sections.find((s) => s.title === "Method overview")!;
        const first = method.paragraphs[0].sentences[0];
        expect(PAPER.slice(first.source.start, first.source.end)).toBe(
            "XYZ replaces the payload initialization with \\emph{a deterministic replay}~\\cite{anderson2000,garcia2016}."
        );
    });
});

describe("toProse markdown: sections", () => {
    const doc = toProse("markdown", NOTE);

    it("labels a numbered heading by its enumerator and a plain one by its text cut to 40 characters", () => {
        expect(labels(doc)).toEqual(["Front matter", "5.", "5.2", "A heading that is much longer than forty…"]);
        expect(doc.sections[1]).toMatchObject({ level: 1, title: "Results" });
        expect(doc.sections[2]).toMatchObject({ level: 2, title: "Setup details" });
        expect(doc.sections[3].title).toBe("A heading that is much longer than forty characters");
        expect(Array.from(doc.sections[3].label)).toHaveLength(41);
    });

    it("leaves a heading of 40 characters or fewer uncut", () => {
        const d = toProse("markdown", "# " + "x".repeat(40) + "\n\n## Short one\n");
        expect(d.sections.map((s) => s.label)).toEqual(["x".repeat(40), "Short one"]);
    });

    it("titles the text before the first heading 'Front matter' and skips YAML front matter", () => {
        expect(doc.sections[0]).toMatchObject({ level: 0, title: "Front matter" });
        expect(sentenceTexts(doc, 0)).toEqual(["Intro before any heading.", "It has two sentences."]);
        expect(toProse("markdown", "# 1 Only\n").sections).toHaveLength(1);
    });

    it("reads a numbered heading's enumerator without a trailing dot", () => {
        const d = toProse("markdown", "## 5.2.1 Deep\n\n### 2026 plan\n");
        expect(d.sections.map((s) => [s.label, s.title])).toEqual([
            ["5.2.1", "Deep"],
            ["2026", "plan"],
        ]);
    });

    it("strips inline formatting from a heading's title", () => {
        const d = toProse("markdown", "# The `wsh` **tool** #\n");
        expect(d.sections[0].title).toBe("The wsh tool");
    });
});

describe("toProse markdown: paragraphs", () => {
    const doc = toProse("markdown", NOTE);
    const results = doc.sections[1];

    it("reads paragraphs, an image paragraph and list items, each list item its own paragraph", () => {
        expect(results.paragraphs.map((p) => !!p.list)).toEqual([false, false, true, true]);
        expect(results.paragraphs[2].sentences.map((s) => s.text)).toEqual(["first item.", "Second sentence of it."]);
        expect(results.paragraphs[3].sentences.map((s) => s.text)).toEqual([
            "second item with x^2 inline continued on a second line",
        ]);
    });

    it("reads numbered items and a block quote as paragraphs", () => {
        const setup = doc.sections[2];
        expect(setup.paragraphs.map((p) => [!!p.list, p.sentences[0].text])).toEqual([
            [true, "numbered one"],
            [true, "numbered two"],
            [false, "quoted line"],
            [false, "[Table: Name, Value]"],
            [false, "const x = 1. Not a sentence."],
        ]);
    });

    it("maps strong, em, code and math", () => {
        const s = results.paragraphs[0].sentences[1];
        expect(kinds(s).filter(([k]) => k !== "text")).toEqual([
            ["code", "wsh"],
            ["code", "ask"],
            ["em", "emphasis"],
            ["em", "this"],
        ]);
        expect(s.text).toContain("snake_case_name");
        const m = results.paragraphs[3].sentences[0].tokens.find((t) => t.kind === "math")!;
        expect(m.text.trim()).toBe("x^2");
    });

    it("emits strong and links, one token per word carrying the href", () => {
        const s = results.paragraphs[0].sentences[0];
        expect(s.tokens.filter((t) => t.kind === "strong").map((t) => t.text.trim())).toEqual(["null", "result"]);
        const links = s.tokens.filter((t) => t.kind === "link");
        expect(links.map((t) => [t.text.trim(), t.href])).toEqual([
            ["the", "../plan.md"],
            ["plan", "../plan.md"],
            ["docs", "https://example.com/a_b"],
        ]);
    });

    it("reads an image alone on its line as a paragraph of its own", () => {
        const img = results.paragraphs.find((p) => p.sentences[0].tokens.some((t) => t.kind === "image"))!;
        expect(img.sentences).toHaveLength(1);
        expect(img.sentences[0].tokens).toEqual([
            { kind: "image", text: "Pipeline diagram", href: "img/pipeline.png" },
        ]);
        expect(img.sentences[0].text).toBe("Pipeline diagram");
        expect(results.paragraphs.indexOf(img)).toBe(1);
    });

    it("keeps an image inside a sentence when it shares its line", () => {
        const d = toProse("markdown", "See ![alt text](a b.png) here.\n");
        expect(d.sections[0].paragraphs).toHaveLength(1);
        // a space after an image is a token of its own: the image's `text` is its alt, so there is nowhere to keep it
        expect(d.sections[0].paragraphs[0].sentences[0].tokens).toEqual([
            { kind: "text", text: "See " },
            { kind: "image", text: "alt text", href: "a b.png" },
            { kind: "text", text: " " },
            { kind: "text", text: "here." },
        ]);
    });

    it("turns a table into one [Table: header cells] sentence and a fenced block into one code token", () => {
        const setup = doc.sections[2];
        const table = setup.paragraphs[3].sentences[0];
        expect(table.tokens).toEqual([{ kind: "placeholder", text: "[Table: Name, Value]" }]);
        const code = setup.paragraphs[4].sentences[0];
        expect(code.tokens).toEqual([{ kind: "code", text: "const x = 1. Not a sentence." }]);
        expect(setup.paragraphs[4].sentences).toHaveLength(1);
        expect(NOTE.slice(code.source.start, code.source.end).startsWith("```ts")).toBe(true);
        expect(NOTE.slice(code.source.start, code.source.end).endsWith("```")).toBe(true);
    });

    it("does not read a price as math", () => {
        const last = doc.sections[3];
        expect(last.paragraphs[0].sentences[0].text).toBe("Price is $5 and $6 here.");
        expect(last.paragraphs[0].sentences[0].tokens.some((t) => t.kind === "math")).toBe(false);
    });

    it("does not split inside a code span", () => {
        const d = toProse("markdown", "Run `a. B` now. Then stop.\n");
        expect(sentenceTexts(d)).toEqual(["Run a. B now.", "Then stop."]);
    });

    it("reads a backslash escape as the literal character", () => {
        const d = toProse("markdown", "Not \\*emphasis\\* here.\n");
        expect(sentenceTexts(d)).toEqual(["Not *emphasis* here."]);
        expect(d.sections[0].paragraphs[0].sentences[0].tokens.every((t) => t.kind === "text")).toBe(true);
    });

    it("keeps source offsets into the file for a list item, past its marker", () => {
        const d = toProse("markdown", "- first item. Second one.\n");
        const [a, b] = d.sections[0].paragraphs[0].sentences;
        expect("- first item. Second one.".slice(a.source.start, a.source.end)).toBe("first item.");
        expect("- first item. Second one.".slice(b.source.start, b.source.end)).toBe("Second one.");
    });

    it("splits Vietnamese sentences at a capital letter and not after e.g.", () => {
        const d = toProse("markdown", "Bước 1 xong. Đã chạy script. Ế quá!\n\nXem e.g. Đây là ví dụ.\n");
        expect(sentenceTexts(d, 0, 0)).toEqual(["Bước 1 xong.", "Đã chạy script.", "Ế quá!"]);
        expect(sentenceTexts(d, 0, 1)).toEqual(["Xem e.g. Đây là ví dụ."]);
    });
});

describe("toProse: every sentence's source slices back to its words", () => {
    // words of the sentence, minus the label a placeholder adds ("Figure", "Table"); alphanumeric runs only,
    // because the shown text normalizes punctuation (`--`, `~`, `\cite{a,b}` → `[a, b]`)
    const wordsOf = (s: ProseSentence) =>
        s.tokens
            .map((t) => (t.kind === "placeholder" ? t.text.replace(/^\[(?:Figure|Table)\b:?/, "") : t.text))
            .join(" ")
            .match(/[\p{L}\p{N}]+/gu) ?? [];
    const inOrder = (haystack: string, words: string[]) => {
        const hay = haystack.toLowerCase();
        let from = 0;
        for (const w of words) {
            const k = hay.indexOf(w.toLowerCase(), from);
            if (k < 0) {
                return false;
            }
            from = k + w.length;
        }
        return true;
    };

    for (const [kind, text] of FIXTURES) {
        it(`holds for the ${kind} fixture`, () => {
            const doc = toProse(kind, text);
            let count = 0;
            for (const sec of doc.sections) {
                for (const p of sec.paragraphs) {
                    let prevEnd = -1;
                    for (const s of p.sentences) {
                        count++;
                        expect(s.source.start).toBeGreaterThanOrEqual(prevEnd);
                        expect(s.source.end).toBeGreaterThan(s.source.start);
                        prevEnd = s.source.end;
                        const slice = text.slice(s.source.start, s.source.end);
                        expect(inOrder(slice, wordsOf(s)), `${s.text} <- ${slice}`).toBe(true);
                        expect(s.text).toBe(
                            s.tokens
                                .map((t) => t.text)
                                .join("")
                                .replace(/\s+/g, " ")
                                .trim()
                        );
                    }
                }
            }
            expect(count).toBeGreaterThan(10);
        });
    }
});

describe("toProse: degenerate input", () => {
    it("returns no sections for an empty file", () => {
        expect(toProse("latex", "").sections).toEqual([]);
        expect(toProse("markdown", "\n\n").sections).toEqual([]);
    });

    it("treats an unbalanced $ or brace as text instead of swallowing the file", () => {
        const doc = toProse("latex", "\\section{A}\nOpen $ never closed.\n\nSecond \\emph{open paragraph.\n\nThird.\n");
        expect(doc.sections[0].paragraphs).toHaveLength(3);
        expect(sentenceTexts(doc, 0, 2)).toEqual(["Third."]);
    });

    it("reads CRLF files the same as LF", () => {
        const lf = toProse("markdown", "# 1 A\n\nOne. Two.\n\n- item\n");
        const crlf = toProse("markdown", "# 1 A\r\n\r\nOne. Two.\r\n\r\n- item\r\n");
        expect(crlf.sections.map((s) => s.paragraphs.map((p) => p.sentences.map((x) => x.text)))).toEqual(
            lf.sections.map((s) => s.paragraphs.map((p) => p.sentences.map((x) => x.text)))
        );
        const tex = toProse("latex", "\\section{A}\r\nOne. Two.\r\n\r\nThree.\r\n");
        expect(tex.sections[0].paragraphs).toHaveLength(2);
    });
});

describe("texAuthors", () => {
    it("splits one author on and", () => {
        expect(texAuthors(String.raw`\author{Ada Lovelace \and Alan Turing}`)).toEqual(["Ada Lovelace", "Alan Turing"]);
    });

    it("reads ACM's one author per person and drops affiliation, email and orcid", () => {
        const src = String.raw`\documentclass[sigconf]{acmart}
\author{Tran Tu Quang}
\affiliation{\institution{UIT}\country{Vietnam}}
\email{quang@example.org}
\author{Van-Hau Pham}
\orcid{0000-0000}
\begin{document}
\maketitle
\end{document}`;
        expect(texAuthors(src)).toEqual(["Tran Tu Quang", "Van-Hau Pham"]);
    });

    it("drops thanks and an affiliation after a line break", () => {
        const src = String.raw`\author{Ada Lovelace\thanks{Funded by nobody.} \\ Analytical Society \and Alan Turing}`;
        expect(texAuthors(src)).toEqual(["Ada Lovelace", "Alan Turing"]);
    });

    it("skips an optional argument and plain-texts macros", () => {
        expect(texAuthors(String.raw`\author[1]{Trần Tú Quang \and \textbf{Emmy} Noether}`)).toEqual([
            "Trần Tú Quang",
            "Emmy Noether",
        ]);
    });

    it("ignores a commented-out author and a document with none", () => {
        expect(
            texAuthors(String.raw`% \author{Nobody}
\title{T}`)
        ).toEqual([]);
    });
});

describe("texHasProse", () => {
    it("is false for a file of macros alone", () => {
        // the shape of a generated numbers.tex
        const src = String.raw`% AUTO-GENERATED from numbers/ledger.yaml
\newcommand{\ArtifactURL}{https://example.org/r/repro}
\newcommand{\NboundedAna}{61}
\newcommand{\NcmTP}{32}
`;
        expect(texHasProse(src)).toBe(false);
    });

    it("is true for a heading, a paragraph or a title", () => {
        expect(texHasProse(String.raw`\section{Results}`)).toBe(true);
        expect(texHasProse("Just a paragraph of prose.\n")).toBe(true);
        expect(texHasProse(String.raw`\title{T}`)).toBe(true);
    });
});

describe("texTitle", () => {
    it("reads the title even when no prose comes before the first heading", () => {
        const src = String.raw`\title{Measuring \emph{What} Adds}
\begin{document}
\maketitle
\section{Introduction}
Text.
\end{document}`;
        expect(texTitle(src)).toBe("Measuring What Adds");
    });

    it("is empty with no title, or only a commented-out one", () => {
        expect(
            texTitle(String.raw`% \title{Old}
\section{A}`)
        ).toBe("");
    });
});
