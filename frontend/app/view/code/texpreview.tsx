// frontend/app/view/code/texpreview.tsx
// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

// A .tex file as a reading view, read-only: the title and authors, the numbered headings, and the prose with its
// emphasis, \cite and \ref keys and KaTeX math. It is the Doc review's reader (docprose.ts, prosetokens.tsx) with
// no diff, so the two read a paper the same way. Double-clicking a sentence opens Source at its line, which is
// where an edit happens; an editable visual mode is deferred (docs/deferred.md, 2026-10-07).

import { texAuthors, toProse, type ProseSection, type ProseSentence } from "@/app/view/agents/docprose";
import { ProseTokens } from "@/app/view/agents/prosetokens";
import { cn } from "@/util/util";
import { useMemo } from "react";
import { lineAtOffset } from "./codeclassify";

// the Doc review's prose size and measure (docreviewpane.tsx PROSE), in DESIGN.md's centred reading column
const PROSE = "text-[15px] leading-[1.75] text-secondary";
// texSections names the text before the first heading this when the document has no \title
const FRONT_MATTER = "Front matter";

const HEADING: Record<number, string> = {
    1: "text-[18px]",
    2: "text-[16px]",
    3: "text-[15px]",
};

export function TexPreview(p: { text: string; onSource: (line: number) => void; onLink: (href: string) => void }) {
    const { text } = p;
    const doc = useMemo(() => toProse("latex", text), [text]);
    const authors = useMemo(() => texAuthors(text), [text]);
    const first = doc.sections[0];
    const title = first != null && first.level === 0 && first.title !== FRONT_MATTER ? first.title : "";
    return (
        <div data-tex-preview className="h-full overflow-y-auto bg-background">
            <div className="mx-auto max-w-[760px] px-8 pb-12 pt-7">
                {title !== "" || authors.length > 0 ? (
                    <header data-tex-title className="mb-4 flex flex-col items-center gap-2 text-center">
                        {title !== "" ? (
                            <h1 className="m-0 text-[22px] font-semibold leading-[1.3] text-primary">{title}</h1>
                        ) : null}
                        {authors.length > 0 ? (
                            <div data-tex-authors className="text-[13.5px] text-secondary">
                                {authors.join(" · ")}
                            </div>
                        ) : null}
                    </header>
                ) : null}
                {doc.sections.map((section, i) => (
                    <Section key={i} section={section} text={text} onSource={p.onSource} onLink={p.onLink} />
                ))}
            </div>
        </div>
    );
}

function Section(p: {
    section: ProseSection;
    text: string;
    onSource: (line: number) => void;
    onLink: (href: string) => void;
}) {
    const { section } = p;
    return (
        <section>
            {section.level > 0 ? (
                <div className="flex items-baseline gap-[10px] pt-[26px]">
                    {section.label.startsWith("§") ? (
                        <span className="text-[12px] text-muted">{section.label}</span>
                    ) : null}
                    <h2 className={cn("m-0 font-semibold text-primary", HEADING[section.level] ?? HEADING[3])}>
                        {section.title}
                    </h2>
                </div>
            ) : null}
            {section.paragraphs.map((paragraph, k) => {
                const sentences = paragraph.sentences.map((s, j) => (
                    <Sentence
                        key={j}
                        sentence={s}
                        last={j === paragraph.sentences.length - 1}
                        onOpen={() => p.onSource(lineAtOffset(p.text, s.source.start))}
                        onLink={p.onLink}
                    />
                ));
                return (
                    <div key={k} className={cn(PROSE, "pt-[14px]")}>
                        {paragraph.list ? (
                            <ul className="m-0 list-disc pl-[22px]">
                                <li>{sentences}</li>
                            </ul>
                        ) : (
                            sentences
                        )}
                    </div>
                );
            })}
        </section>
    );
}

function Sentence(p: { sentence: ProseSentence; last: boolean; onOpen: () => void; onLink: (href: string) => void }) {
    const tokens = p.sentence.tokens.map((token) => ({ token, op: "same" as const }));
    return (
        <>
            <span data-tex-s title="Double-click to edit in Source" onDoubleClick={p.onOpen}>
                <ProseTokens
                    tokens={tokens}
                    onLink={p.onLink}
                    image={(alt) => <span className="italic text-muted">[{alt || "figure"}]</span>}
                />
            </span>
            {p.last ? null : " "}
        </>
    );
}
