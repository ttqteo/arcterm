// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { openLink } from "@/app/store/global";
import { cn } from "@/util/util";
import { Lightbulb } from "lucide-react";
import { Fragment, memo } from "react";
import ReactMarkdown, { type Components } from "react-markdown";
import remarkGfm from "remark-gfm";
import { CodeBlock } from "./codeblock";
import { splitInsightBlocks } from "./insightblocks";
import { PathLink } from "./pathlinkcontext";
import { inlinePathOf } from "./pathlinks";

// Lightweight inline markdown for narration lines. Deliberately NOT the full element/markdown.tsx
// (which wraps every render in OverlayScrollbars + a TOC + rehypeRaw); raw HTML is not enabled here,
// so transcript text cannot inject markup.

// links open through the app helper (external/internal routing), matching element/markdown.tsx —
// NOT target=_blank, which bypasses that routing. tables are wrapped so wide ones scroll inside
// the panel instead of breaking its width.
const MD_COMPONENTS: Components = {
    a: ({ href, children }) => (
        <a
            href={href}
            onClick={(e) => {
                e.preventDefault();
                openLink(href);
            }}
            className="cursor-pointer text-accent hover:underline"
        >
            {children}
        </a>
    ),
    table: ({ children }) => (
        <div className="agent-table-wrap">
            <table>{children}</table>
        </div>
    ),
    pre: ({ children }) => {
        // children is the <code> element react-markdown produced for a fenced block
        const child: any = Array.isArray(children) ? children[0] : children;
        const props = child?.props ?? {};
        const className: string = props.className ?? "";
        const lang = /language-(\w+)/.exec(className)?.[1];
        const raw = Array.isArray(props.children) ? props.children.join("") : String(props.children ?? "");
        return <CodeBlock code={raw} lang={lang} />;
    },
    code: ({ className, children }) => {
        const text = typeof children === "string" ? children : null;
        const found = className == null && text != null ? inlinePathOf(text) : null;
        if (found == null) {
            return <code className={className}>{children}</code>;
        }
        return (
            <PathLink path={found.path} line={found.line}>
                <code>{children}</code>
            </PathLink>
        );
    },
};

const REMARK_PLUGINS = [remarkGfm];

function renderMd(text: string) {
    return (
        <ReactMarkdown remarkPlugins={REMARK_PLUGINS} components={MD_COMPONENTS}>
            {text}
        </ReactMarkdown>
    );
}

function InsightCallout({ text }: { text: string }) {
    return (
        <div data-insight className="my-2.5 rounded-[8px] border border-accent/25 bg-accent/[0.05] px-3 py-2">
            <div className="mb-1 flex items-center gap-1.5 text-[10.5px] font-bold uppercase tracking-[0.1em] text-accent-soft">
                <Lightbulb size={11} strokeWidth={2.2} aria-hidden />
                Insight
            </div>
            {renderMd(text)}
        </div>
    );
}

export const MarkdownMessage = memo(function MarkdownMessage({ text, className }: { text: string; className?: string }) {
    const segments = splitInsightBlocks(text);
    return (
        <div className={cn("agent-md", className)}>
            {segments.map((seg, i) =>
                seg.kind === "insight" ? (
                    <InsightCallout key={i} text={seg.text} />
                ) : (
                    <Fragment key={i}>{renderMd(seg.text)}</Fragment>
                )
            )}
        </div>
    );
});
