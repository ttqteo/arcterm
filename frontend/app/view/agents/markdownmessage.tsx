// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { CopyButton } from "@/app/element/copybutton";
import { tableClipboard } from "@/app/element/markdown-table";
import { Mermaid } from "@/app/element/mermaid";
import remarkMark from "@/app/element/remark-mark";
import { openLink } from "@/app/store/global";
import { cn } from "@/util/util";
import { Lightbulb } from "lucide-react";
import { Fragment, memo, type ReactNode } from "react";
import ReactMarkdown, { type Components } from "react-markdown";
import remarkGfm from "remark-gfm";
import type { PluggableList } from "unified";
import { FilePill } from "./chatfilepill";
import { INITIATIVE_LANG } from "./chatinitiative";
import { InitiativeBlockView } from "./chatinitiativecard";
import { STEPS_LANG } from "./chatsteplist";
import { StepsBlock } from "./chatsteplistview";
import { VISUAL_LANG } from "./chatvisual";
import { VisualBlock } from "./chatvisualview";
import { CodeBlock } from "./codeblock";
import { splitInsightBlocks } from "./insightblocks";
import { PathLink } from "./pathlinkcontext";
import { inlinePathOf } from "./pathlinks";
import remarkFileMention from "./remarkfilemention";
import { trimTripleClick } from "./selectiontrim";

// Lightweight inline markdown for narration lines. Deliberately NOT the full element/markdown.tsx
// (which wraps every render in OverlayScrollbars + a TOC + rehypeRaw); raw HTML is not enabled here,
// so transcript text cannot inject markup.

// links open through the app helper (external/internal routing), matching element/markdown.tsx —
// NOT target=_blank, which bypasses that routing. tables are wrapped so wide ones scroll inside
// the panel instead of breaking its width.
// a fenced block's language and text, from the <code> element react-markdown put in its <pre>
function fencedOf(children: unknown): { lang?: string; raw: string } {
    const child: any = Array.isArray(children) ? children[0] : children;
    const props = child?.props ?? {};
    // `[\w+-]`: a language with a dash or a plus (arc-visual, objective-c, c++) survives whole
    const lang = /language-([\w+-]+)/.exec(props.className ?? "")?.[1];
    const raw = Array.isArray(props.children) ? props.children.join("") : String(props.children ?? "");
    return { lang, raw };
}

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
    // the copy button sits outside the scroller, so it stays on the corner while a wide table scrolls; the box
    // shrinks to a short table instead of running the panel's width
    table: ({ node, children }) => (
        <div className="group relative w-fit max-w-full">
            <div className="agent-table-wrap">
                <table>{children}</table>
            </div>
            <div className="invisible absolute right-1 top-1 rounded bg-surface-raised p-0.5 group-hover:visible group-focus-within:visible">
                <CopyButton content={() => (node != null ? tableClipboard(node) : "")} title="Copy table" />
            </div>
        </div>
    ),
    pre: ({ children }) => {
        const { lang, raw } = fencedOf(children);
        return <CodeBlock code={raw} lang={lang} />;
    },
    code: ({ className, children }) => {
        const text = typeof children === "string" ? children : null;
        const found = className == null && text != null ? inlinePathOf(text) : null;
        if (found == null) {
            return <code className={className}>{children}</code>;
        }
        // a link is an inline-block that does not wrap: capped at the line's width, a long path ends in an ellipsis
        // inside the bubble instead of running out of it (its title still names the whole path)
        return (
            <PathLink path={found.path} line={found.line} className="max-w-full align-bottom">
                <code>{children}</code>
            </PathLink>
        );
    },
};

// The extras a caller opts into: `marks` draws ==…== (remark-mark.ts) as a <mark> in the accent's tint the terminal draws a
// skim highlight in, `diagrams` draws a ```mermaid block as its diagram instead of its code and an ```arc-visual block
// as the page it names where a visual host provides one (Chat's, chatvisualview.tsx), as code elsewhere (an ```arc-initiative
// block the same way: the card an agent proposes where Chat's initiative host provides one, chatinitiativecard.tsx, and an
// ```arc-steps block as its turn's checklist where Chat's steps host provides one, chatsteplistview.tsx), and `mentions`
// draws an `@path` (remarkfilemention.ts) as a file pill (chatfilepill.tsx). They combine: each adds its plugin and its
// component to the same map. A council's messages take marks and diagrams, your bubble in Chat takes mentions; an
// agent's transcript takes none, so it never loads mermaid.
export interface MarkdownExtras {
    marks?: boolean;
    diagrams?: boolean;
    mentions?: boolean;
}

const MARK_COMPONENT: Components = {
    mark: ({ children }) => (
        <mark data-council-mark className="rounded-[2px] bg-warning/25 px-px text-inherit">
            {children}
        </mark>
    ),
};

const DIAGRAM_COMPONENT: Components = {
    pre: ({ children }) => {
        const { lang, raw } = fencedOf(children);
        if (lang === VISUAL_LANG) {
            return <VisualBlock raw={raw} />;
        }
        // the turn's step checklist (chatsteplistview.tsx); outside Chat's host it is the code block
        if (lang === STEPS_LANG) {
            return <StepsBlock raw={raw} />;
        }
        // the card an agent proposes (chatinitiativecard.tsx); outside Chat's host it is the code block
        if (lang === INITIATIVE_LANG) {
            return <InitiativeBlockView raw={raw} />;
        }
        return lang === "mermaid" ? <Mermaid chart={raw} /> : <CodeBlock code={raw} lang={lang} />;
    },
};

// `filemention` is not an HTML tag, so it is not a key of react-markdown's Components type
const MENTION_COMPONENT = {
    filemention: ({ path, children }: { path?: string; children?: ReactNode }) =>
        path != null && path !== "" ? <FilePill path={path} /> : <>{children}</>,
} as unknown as Components;

// one plugin list and one components map per set of extras, built once, so react-markdown never sees a new one on a
// re-render
const PLUGINS_BY_EXTRAS = new Map<string, PluggableList>();
const COMPONENTS_BY_EXTRAS = new Map<string, Components>();

function extrasKey(extras: MarkdownExtras): string {
    return `${extras.marks ? "m" : ""}${extras.diagrams ? "d" : ""}${extras.mentions ? "f" : ""}`;
}

function pluginsFor(extras: MarkdownExtras): PluggableList {
    const key = extrasKey(extras);
    let out = PLUGINS_BY_EXTRAS.get(key);
    if (out == null) {
        out = [
            remarkGfm,
            ...(extras.marks ? [remarkMark] : []),
            // after the marks, so a mention inside a ==mark== is found too
            ...(extras.mentions ? [remarkFileMention] : []),
        ];
        PLUGINS_BY_EXTRAS.set(key, out);
    }
    return out;
}

function componentsFor(extras: MarkdownExtras): Components {
    const key = extrasKey(extras);
    let out = COMPONENTS_BY_EXTRAS.get(key);
    if (out == null) {
        out = {
            ...MD_COMPONENTS,
            ...(extras.marks ? MARK_COMPONENT : {}),
            ...(extras.diagrams ? DIAGRAM_COMPONENT : {}),
            ...(extras.mentions ? MENTION_COMPONENT : {}),
        };
        COMPONENTS_BY_EXTRAS.set(key, out);
    }
    return out;
}

function renderMd(text: string, extras: MarkdownExtras = {}) {
    return (
        <ReactMarkdown remarkPlugins={pluginsFor(extras)} components={componentsFor(extras)}>
            {text}
        </ReactMarkdown>
    );
}

function InsightCallout({ text, extras }: { text: string; extras?: MarkdownExtras }) {
    return (
        <div data-insight className="my-2.5 rounded-[8px] border border-accent/25 bg-accent/[0.05] px-3 py-2">
            <div className="mb-1 flex items-center gap-1.5 text-[10.5px] font-bold uppercase tracking-[0.1em] text-accent-soft">
                <Lightbulb size={11} strokeWidth={2.2} aria-hidden />
                Insight
            </div>
            {renderMd(text, extras)}
        </div>
    );
}

export const MarkdownMessage = memo(function MarkdownMessage({
    text,
    className,
    marks,
    diagrams,
    mentions,
}: { text: string; className?: string } & MarkdownExtras) {
    const segments = splitInsightBlocks(text);
    return (
        <div className={cn("agent-md", className)} onMouseUp={trimTripleClick}>
            {segments.map((seg, i) =>
                seg.kind === "insight" ? (
                    <InsightCallout key={i} text={seg.text} extras={{ marks, diagrams, mentions }} />
                ) : (
                    <Fragment key={i}>{renderMd(seg.text, { marks, diagrams, mentions })}</Fragment>
                )
            )}
        </div>
    );
});
