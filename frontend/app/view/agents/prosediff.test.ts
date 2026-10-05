// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { describe, expect, it } from "vitest";
import { toProse, type ProseDoc } from "./docprose";
import { diffProse, MODIFY_SIMILARITY, type SectionChange, type SentenceChange } from "./prosediff";

const md = (text: string): ProseDoc => toProse("markdown", text);
const tex = (text: string): ProseDoc => toProse("latex", text);

const ops = (change: SectionChange, paragraph = 0) => change.paragraphs[paragraph].sentences.map((s) => s.op);
const words = (s: SentenceChange) => s.words.map((w) => [w.op, w.token.kind, w.token.text.trim()]);
const allSentences = (changes: SectionChange[]) => changes.flatMap((c) => c.paragraphs.flatMap((p) => p.sentences));
const totals = (changes: SectionChange[]) =>
    changes.reduce(
        (acc, c) => ({
            insert: acc.insert + c.counts.insert,
            delete: acc.delete + c.counts.delete,
            modify: acc.modify + c.counts.modify,
        }),
        { insert: 0, delete: 0, modify: 0 }
    );

const PAPER = String.raw`\title{Exploit generation}
\begin{document}
We study exploit generation. Our method is deterministic.

\section{Introduction}
Agents write exploits~\cite{a2025}. We ask whether they can be trusted.

Second paragraph of the introduction.

\section{Method}
XYZ replaces payload initialization with \emph{a deterministic replay}. We run it with $k = 3$ seeds.
\end{document}
`;

// one paragraph of `n` words w0 … w(n-1), the first `replaced` of them swapped for other words
const wordsParagraph = (n: number, replaced = 0) =>
    Array.from({ length: n }, (_, i) => (i < replaced ? `x${i}` : `w${i}`)).join(" ") + ".";

describe("diffProse", () => {
    it("marks identical documents as all same with zero counts", () => {
        const changes = diffProse(tex(PAPER), tex(PAPER));
        expect(changes.map((c) => c.status)).toEqual(["same", "same", "same"]);
        expect(changes.flatMap((c) => c.paragraphs.map((p) => p.status))).toEqual(["same", "same", "same", "same"]);
        expect(allSentences(changes).every((s) => s.op === "same")).toBe(true);
        expect(totals(changes)).toEqual({ insert: 0, delete: 0, modify: 0 });
        expect(changes.map((c) => [c.index, c.label, c.title])).toEqual([
            [0, "Exploit generation", "Exploit generation"],
            [1, "§1", "Introduction"],
            [2, "§2", "Method"],
        ]);
    });

    it("finds an inserted, a deleted and a modified sentence, with the modify's word diff", () => {
        const before = md(
            "# Method\n\nOne fish swims here. The fuzzer runs on every advisory in the corpus. Old results were cached on disk.\n"
        );
        const after = md(
            "# Method\n\nA new opening line appears. One fish swims here. The fuzzer runs on each advisory in the corpus.\n"
        );
        const [method] = diffProse(before, after);
        expect(method.status).toBe("changed");
        expect(method.paragraphs[0].status).toBe("changed");
        expect(ops(method)).toEqual(["insert", "same", "modify", "delete"]);
        const [inserted, same, modified, deleted] = method.paragraphs[0].sentences;
        expect(inserted.after.text).toBe("A new opening line appears.");
        expect(inserted.before).toBeUndefined();
        expect(same.before.text).toBe(same.after.text);
        expect(deleted.before.text).toBe("Old results were cached on disk.");
        expect(deleted.after).toBeUndefined();
        expect(modified.before.text).toBe("The fuzzer runs on every advisory in the corpus.");
        expect(modified.after.text).toBe("The fuzzer runs on each advisory in the corpus.");
        expect(words(modified)).toEqual([
            ["same", "text", "The"],
            ["same", "text", "fuzzer"],
            ["same", "text", "runs"],
            ["same", "text", "on"],
            ["delete", "text", "every"],
            ["insert", "text", "each"],
            ["same", "text", "advisory"],
            ["same", "text", "in"],
            ["same", "text", "the"],
            ["same", "text", "corpus."],
        ]);
        expect(inserted.words).toBeUndefined();
        expect(method.counts).toEqual({ insert: 1, delete: 1, modify: 1 });
    });

    it("keeps a delete + insert under the similarity threshold and turns one at it into a modify", () => {
        expect(MODIFY_SIMILARITY).toBe(0.6);
        // 100 words each side: 59 shared words is a similarity of 0.59, 60 is 0.6
        const below = diffProse(md(wordsParagraph(100)), md(wordsParagraph(100, 41)));
        expect(ops(below[0])).toEqual(["delete", "insert"]);
        expect(below[0].counts).toEqual({ insert: 1, delete: 1, modify: 0 });

        const at = diffProse(md(wordsParagraph(100)), md(wordsParagraph(100, 40)));
        expect(ops(at[0])).toEqual(["modify"]);
        expect(at[0].counts).toEqual({ insert: 0, delete: 0, modify: 1 });
        const sentence = at[0].paragraphs[0].sentences[0];
        expect(sentence.words.filter((w) => w.op === "same")).toHaveLength(60);
        expect(sentence.words.filter((w) => w.op === "delete")).toHaveLength(40);
        expect(sentence.words.filter((w) => w.op === "insert")).toHaveLength(40);
    });

    it("does not count the whitespace after math toward similarity", () => {
        // five words each side, two shared: 0.4. Counting the three " " separators would read 0.625.
        const before = md("$a$ $b$ $c$ one two.\n");
        expect(before.sections[0].paragraphs[0].sentences[0].tokens.filter((t) => t.text === " ")).toHaveLength(3);
        const changes = diffProse(before, md("$x$ $y$ $z$ one two.\n"));
        expect(ops(changes[0])).toEqual(["delete", "insert"]);
    });

    it("keeps every token of the after sentence, separators included, in a modify's words", () => {
        const before = md("We set $k=3$ for all runs here.\n");
        const after = md("We set $k=5$ for all runs here.\n");
        const sentence = diffProse(before, after)[0].paragraphs[0].sentences[0];
        expect(sentence.op).toBe("modify");
        expect(sentence.words.filter((w) => w.op !== "delete").map((w) => w.token)).toEqual(sentence.after.tokens);
        expect(
            sentence.words
                .filter((w) => w.op !== "insert")
                .map((w) => w.token.text)
                .join("")
                .replace(/\s+/g, " ")
                .trim()
        ).toBe(sentence.before.text);
        expect(words(sentence).filter(([, kind]) => kind === "math")).toEqual([
            ["delete", "math", "k=3"],
            ["insert", "math", "k=5"],
        ]);
    });

    it("pairs a renamed section by order", () => {
        const before = tex(
            String.raw`\section{Intro}
Hello there.
\section{Method}
We run the tool. It is fast.
\section{Results}
It works.`
        );
        const after = tex(
            String.raw`\section{Intro}
Hello there.
\section{Approach}
We run the tool. It is fast.
\section{Results}
It works.`
        );
        const changes = diffProse(before, after);
        expect(changes.map((c) => [c.status, c.title])).toEqual([
            ["same", "Intro"],
            ["changed", "Approach"],
            ["same", "Results"],
        ]);
        expect(changes[1].beforeTitle).toBe("Method");
        expect(ops(changes[1])).toEqual(["same", "same"]);
        expect(changes[0].beforeTitle).toBeUndefined();
    });

    it("pairs a section moved within the document by its title", () => {
        const before = md(
            "# Intro\n\nHello.\n\n# Method\n\nWe run it.\n\n# Results\n\nIt works.\n\n# Discussion\n\nWhy.\n"
        );
        const after = md(
            "# Intro\n\nHello.\n\n# Results\n\nIt works.\n\n# Method\n\nWe run it.\n\n# Discussion\n\nWhy.\n"
        );
        const changes = diffProse(before, after);
        expect(changes.map((c) => [c.index, c.status, c.title])).toEqual([
            [0, "same", "Intro"],
            [1, "same", "Results"],
            [2, "same", "Method"],
            [3, "same", "Discussion"],
        ]);
        expect(allSentences(changes).every((s) => s.op === "same")).toBe(true);
    });

    it("pairs the occurrences of a title several sections share by their content", () => {
        const before = md(
            "# Run A\n\nThe first run.\n\n## Setup\n\nAlpha machines with eight cores.\n\n# Run B\n\nThe second run.\n\n## Setup\n\nBeta machines with sixteen cores.\n"
        );
        const after = md("# Run B\n\nThe second run.\n\n## Setup\n\nBeta machines with sixteen cores.\n");
        const changes = diffProse(before, after);
        expect(changes.map((c) => [c.status, c.index, c.title])).toEqual([
            ["removed", 0, "Run A"],
            ["removed", 1, "Setup"],
            ["same", 0, "Run B"],
            ["same", 1, "Setup"],
        ]);
        expect(changes[1].paragraphs[0].sentences[0].before.text).toBe("Alpha machines with eight cores.");
    });

    it("pairs sections whose titles differ only in case and spacing", () => {
        const changes = diffProse(
            md("# Intro\n\nHello.\n\n# Related  work\n\nOthers.\n"),
            md("# Intro\n\nHello.\n\n# Related Work\n\nOthers.\n")
        );
        expect(changes.map((c) => c.status)).toEqual(["same", "changed"]);
        expect(ops(changes[1])).toEqual(["same"]);
    });

    it("reports an added and a removed section, each in its own document's order", () => {
        const before = tex(
            String.raw`\section{Intro}
Hello there.
\section{Old}
Gone now. Really gone.
\section{Results}
It works.`
        );
        const after = tex(
            String.raw`\section{Intro}
Hello there.
\section{Results}
It works.
\section{New}
Fresh text here.`
        );
        const changes = diffProse(before, after);
        expect(changes.map((c) => [c.status, c.index, c.label, c.title])).toEqual([
            ["same", 0, "§1", "Intro"],
            ["removed", 1, "§2", "Old"],
            ["same", 1, "§2", "Results"],
            ["added", 2, "§3", "New"],
        ]);
        const [, old, , fresh] = changes;
        expect(old.paragraphs.map((p) => p.status)).toEqual(["removed"]);
        expect(ops(old)).toEqual(["delete", "delete"]);
        expect(old.counts).toEqual({ insert: 0, delete: 2, modify: 0 });
        expect(fresh.paragraphs.map((p) => [p.status, p.index])).toEqual([["added", 1]]);
        expect(fresh.paragraphs[0].sentences.map((s) => [s.op, s.afterIndex])).toEqual([["insert", 0]]);
        expect(fresh.counts).toEqual({ insert: 1, delete: 0, modify: 0 });
    });

    it("keeps a code token's kind inside a modified sentence", () => {
        const before = tex(String.raw`We call \texttt{toProse} on every file before diffing them.`);
        const after = tex(String.raw`We call \texttt{toProse} on each file before diffing them.`);
        const sentence = diffProse(before, after)[0].paragraphs[0].sentences[0];
        expect(sentence.op).toBe("modify");
        expect(words(sentence).filter(([, kind]) => kind === "code")).toEqual([["same", "code", "toProse"]]);

        const renamed = tex(String.raw`We call \texttt{diffProse} on every file before diffing them.`);
        const renamedSentence = diffProse(before, renamed)[0].paragraphs[0].sentences[0];
        expect(renamedSentence.op).toBe("modify");
        expect(words(renamedSentence).filter(([, kind]) => kind === "code")).toEqual([
            ["delete", "code", "toProse"],
            ["insert", "code", "diffProse"],
        ]);
    });

    it("numbers sections in the after-document's order after an inserted section", () => {
        const before = md("# Intro\n\nHello.\n\n# Method\n\nWe run it.\n\n# Results\n\nIt works.\n");
        const after = md(
            "# Intro\n\nHello.\n\n# Background\n\nPrior art.\n\n# Method\n\nWe run it.\n\n# Results\n\nIt works.\n"
        );
        const changes = diffProse(before, after);
        expect(changes.map((c) => [c.index, c.status, c.title])).toEqual([
            [0, "same", "Intro"],
            [1, "added", "Background"],
            [2, "same", "Method"],
            [3, "same", "Results"],
        ]);
    });

    it("gives afterIndex in the after sentences, skipping deleted ones", () => {
        const before = md("# Notes\n\nFirst one here. Second one goes. Third one stays.\n");
        const after = md("# Notes\n\nFirst one here. Third one stays. A fourth arrives now.\n");
        const sentences = diffProse(before, after)[0].paragraphs[0].sentences;
        expect(sentences.map((s) => [s.op, s.afterIndex])).toEqual([
            ["same", 0],
            ["delete", undefined],
            ["same", 1],
            ["insert", 2],
        ]);
    });

    it("pairs paragraphs by overlap, so an inserted paragraph does not shift the rest out of alignment", () => {
        const before = md(
            "# Method\n\nWe run the fuzzer on every advisory.\n\nResults are cached on disk for reuse.\n\nThe cache is cleared weekly.\n"
        );
        const after = md(
            "# Method\n\nWe run the fuzzer on every advisory.\n\nA brand new paragraph sits here.\n\nResults are cached on disk for later reuse.\n\nThe cache is cleared weekly.\n"
        );
        const [method] = diffProse(before, after);
        expect(method.paragraphs.map((p) => [p.status, p.index])).toEqual([
            ["same", 1],
            ["added", 2],
            ["changed", 3],
            ["same", 4],
        ]);
        expect(ops(method, 2)).toEqual(["modify"]);
        expect(method.counts).toEqual({ insert: 1, delete: 0, modify: 1 });
    });

    it("keeps a removed paragraph's before-document number, in place", () => {
        const before = md("# Method\n\nKeep this paragraph.\n\nDrop this one entirely.\n\nAnd keep this too.\n");
        const after = md("# Method\n\nKeep this paragraph.\n\nAnd keep this too.\n");
        const [method] = diffProse(before, after);
        expect(method.paragraphs.map((p) => [p.status, p.index])).toEqual([
            ["same", 1],
            ["removed", 2],
            ["same", 2],
        ]);
        expect(method.paragraphs[1].sentences.map((s) => [s.op, s.afterIndex])).toEqual([["delete", undefined]]);
    });

    it("pairs a fully rewritten paragraph in place by order", () => {
        const [section] = diffProse(md("# A\n\nAlpha beta gamma.\n"), md("# A\n\nZeta eta theta.\n"));
        expect(section.paragraphs.map((p) => [p.status, p.index])).toEqual([["changed", 1]]);
        expect(ops(section)).toEqual(["delete", "insert"]);
    });

    it("carries a list item's flag", () => {
        const [section] = diffProse(md("# A\n\n- one item.\n"), md("# A\n\n- one item.\n- two items.\n"));
        expect(section.paragraphs.map((p) => [p.status, p.list])).toEqual([
            ["same", true],
            ["added", true],
        ]);
    });

    it("sees a replaced image with the same alt text as a delete and an insert", () => {
        const before = md("# Figures\n\n![pipeline](diagrams/a.png)\n");
        const after = md("# Figures\n\n![pipeline](diagrams/b.png)\n");
        const [section] = diffProse(before, after);
        expect(section.status).toBe("changed");
        const sentences = section.paragraphs[0].sentences;
        expect(sentences.map((s) => s.op)).toEqual(["delete", "insert"]);
        expect(sentences[0].before.tokens[0]).toMatchObject({ kind: "image", href: "diagrams/a.png" });
        expect(sentences[1].after.tokens[0]).toMatchObject({ kind: "image", href: "diagrams/b.png" });
    });

    it("diffs against an empty document as everything inserted", () => {
        const changes = diffProse(md(""), md("# New\n\nAll new. Every word.\n"));
        expect(changes.map((c) => c.status)).toEqual(["added"]);
        expect(totals(changes)).toEqual({ insert: 2, delete: 0, modify: 0 });
    });
});
