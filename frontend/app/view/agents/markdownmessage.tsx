// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { CopyButton } from "@/app/element/copybutton";
import { tableClipboard } from "@/app/element/markdown-table";
import { Mermaid } from "@/app/element/mermaid";
import remarkMark from "@/app/element/remark-mark";
import { openLink } from "@/app/store/global";
import { cn } from "@/util/util";
import { Lightbulb } from "lucide-react";
import {
    Children,
    createContext,
    Fragment,
    isValidElement,
    memo,
    useContext,
    useEffect,
    useRef,
    type ComponentProps,
    type ReactNode,
} from "react";
import ReactMarkdown, { defaultUrlTransform, type Components } from "react-markdown";
import remarkGfm from "remark-gfm";
import remarkMath from "remark-math";
import type { PluggableList } from "unified";
import { fenceBangLines } from "./bashlines";
import { FilePill } from "./chatfilepill";
import { codePicturePath, imageSrcKind, keepLocalImageUrl, localImagePath } from "./chatimagesrc";
import { INITIATIVE_LANG } from "./chatinitiative";
import { InitiativeBlockView } from "./chatinitiativecard";
import { copyableHref } from "./chatlink";
import { CodePicture, ImageNamed, ReplyImage } from "./chatlocalimage";
import { JudgeBlock, PairBlock } from "./chatpairblock";
import { CodeRefBadge, RefBadge } from "./chatrefbadge";
import { STEPS_LANG } from "./chatsteplist";
import { StepsBlock } from "./chatsteplistview";
import { VISUAL_LANG } from "./chatvisual";
import { VisualBlock } from "./chatvisualview";
import { CodeBlock } from "./codeblock";
import { isInlineCommand } from "./coderun";
import { splitInsightBlocks } from "./insightblocks";
import { guardDollars } from "./mathdollars";
import { JUDGE_LANG, PAIR_LANG } from "./pairblocks";
import { PathLink } from "./pathlinkcontext";
import { inlinePathOf } from "./pathlinks";
import { MathToken } from "./prosetokens";
import { codeRef } from "./refbadge";
import type { RefKind } from "./refmention";
import remarkFileMention from "./remarkfilemention";
import remarkRefMention from "./remarkrefmention";
import { paintSelectionIn } from "./selectionpaint";
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

// remark-math's `$$…$$` block (and a ```math fence): the formula on its own line, centred, scrolling sideways when wide.
// MathToken's span is the sideways scroller; padded and clipped on y, so a \sum's limits never raise a vertical bar.
// katex.min.css is unlayered, so its 1em margin on .katex-display beats a layered utility unless it is important
function DisplayMath({ tex }: { tex: string }) {
    return (
        <div data-math className="my-2 text-center [&>span]:overflow-y-hidden [&>span]:py-1 [&_.katex-display]:my-0!">
            <MathToken tex={tex.trim()} display />
        </div>
    );
}

// A link, with a copy button that shows on hover so its url can be taken without selecting it. The button sits on the
// link's top-right corner, like a footnote mark, from a zero-width anchor at the link's end: it covers no word on the
// line, only the gap over it, and showing it moves no word. It is drawn as a reply's Copy is (small, muted, on the
// surface). The anchor sits in the link's hover group and the button's foot overlaps the link's top, so moving onto it
// keeps it shown. Not selectable: a selection over the line neither paints nor copies it.
function MdLink({ href, children }: { href?: string; children?: ReactNode }) {
    const url = copyableHref(href);
    const link = (
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
    );
    if (url == null) {
        return link;
    }
    return (
        <span data-md-link className="group/link">
            {link}
            <span className="relative inline-block w-0 select-none align-text-top">
                <span
                    data-md-link-copy
                    className="invisible absolute -bottom-[0.3em] left-0 z-10 flex rounded-md bg-surface group-hover/link:visible group-focus-within/link:visible"
                >
                    <CopyButton content={url} title="Copy link" className="p-0.5 text-[11px]" />
                </span>
            </span>
        </span>
    );
}

// A fenced block, a diagram or a formula as one block: Chat's focus read lights and dims it whole and Q quotes a code block
// in it fenced with `data-md-lang` (chatfocusreadview.ts). A plain div, so the margins inside collapse through it as before.
function Fenced({ lang, children }: { lang?: string; children: ReactNode }) {
    return (
        <div data-md-block="fence" data-md-lang={lang ?? ""}>
            {children}
        </div>
    );
}

// A list item holding a list: the words before that list wrapped as one block (`data-md-li-head`), so focus read lights
// the item's own line apart from its nested items. Any other item draws as it did.
function MdListItem({ node: _node, children, ...props }: ComponentProps<"li"> & { node?: unknown }) {
    const parts = Children.toArray(children);
    const at = parts.findIndex((c) => isValidElement(c) && (c.type === "ul" || c.type === "ol"));
    if (at <= 0) {
        return <li {...props}>{children}</li>;
    }
    return (
        <li {...props}>
            <div data-md-li-head>{parts.slice(0, at)}</div>
            {parts.slice(at)}
        </li>
    );
}

// an image in the markdown (chatimagesrc.ts): a web one as it is, a file on this machine read from disk (a bare
// <img src="/Users/…"> draws as a broken image in the webview), and a relative path, which has no folder to be read
// against, named
function MdImage({ src, alt }: { src?: string; alt?: string }) {
    const kind = imageSrcKind(src);
    if (kind === "web") {
        return <img src={src} alt={alt ?? ""} className="max-w-full rounded-[6px]" />;
    }
    if (kind === "local") {
        return <ReplyImage path={localImagePath(src)} alt={alt} />;
    }
    return <ImageNamed path={src || alt || "image"} why="not a full path" />;
}

const urlTransform = (url: string) => keepLocalImageUrl(url, defaultUrlTransform);

const MD_COMPONENTS: Components = {
    a: ({ href, children }) => <MdLink href={href}>{children}</MdLink>,
    img: ({ src, alt }) => <MdImage src={typeof src === "string" ? src : undefined} alt={alt} />,
    li: MdListItem,
    // the copy button sits outside the scroller, so it stays on the corner while a wide table scrolls; the box
    // shrinks to a short table instead of running the panel's width
    table: ({ node, children }) => (
        <div data-md-block="table" className="group relative w-fit max-w-full">
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
        return (
            <Fenced lang={lang}>
                {lang === "math" ? <DisplayMath tex={raw} /> : <CodeBlock code={raw} lang={lang} />}
            </Fenced>
        );
    },
    code: ({ className, children }) => <InlineCode className={className}>{children}</InlineCode>,
};

// set where the caller opted into `commands` (Chat), read by every inline code span whichever components map drew it
const CommandsContext = createContext(false);

function InlineCode({ className, children }: { className?: string; children?: ReactNode }) {
    const text = typeof children === "string" ? children : null;
    const commands = useContext(CommandsContext);
    // remark-math's `$…$`: a formula in the line
    if (text != null && className?.includes("math-inline")) {
        return <MathToken tex={text} />;
    }
    // a `! cmd` to type draws in the mark's tint over the code's own colours (tailwindsetup.css data-command-mark)
    if (commands && className == null && text != null && isInlineCommand(text)) {
        return <code data-command-mark>{children}</code>;
    }
    const found = className == null && text != null ? inlinePathOf(text) : null;
    if (found == null) {
        return <code className={className}>{children}</code>;
    }
    // a link flows inline and wraps with the prose, so a long path shows whole instead of ending in an ellipsis; a full
    // path to a picture also draws the picture under it (chatimagesrc.ts codePicturePath), as `![](path)` would
    const link = (
        <PathLink path={found.path} line={found.line} wrap>
            <code>{children}</code>
        </PathLink>
    );
    const picture = found.line == null ? codePicturePath(found.path) : null;
    if (picture == null) {
        return link;
    }
    return (
        <>
            {link}
            <CodePicture path={picture} />
        </>
    );
}

// The extras a caller opts into: `marks` draws ==…== (remark-mark.ts) as a <mark> in the accent's tint the terminal draws a
// skim highlight in, `diagrams` draws a ```mermaid block as its diagram instead of its code and an ```arc-visual block
// as the page it names where a visual host provides one (Chat's, chatvisualview.tsx), as code elsewhere (an ```arc-initiative
// block the same way: the card an agent proposes where Chat's initiative host provides one, chatinitiativecard.tsx, and an
// ```arc-steps block as its turn's checklist where Chat's steps host provides one, chatsteplistview.tsx, and an
// ```arc-pair or ```arc-judge block as a pair card where Chat's pair host provides one, chatpairblock.tsx), and `mentions`
// draws an `@path` (remarkfilemention.ts) as a file pill (chatfilepill.tsx) and an `agent:`, `run:` or `council:`
// reference (remarkrefmention.ts) as a badge (chatrefbadge.tsx; plain text where Chat provides nothing to resolve it
// against). They combine: each adds its plugin and its component to the same map. A council's messages take marks and
// diagrams, your bubble in Chat takes mentions; an agent's transcript takes none, so it never loads mermaid. `refs` is the
// references alone, for an agent's reply in Chat (no `@path` pills: an agent's `@` is not a pick): an `agent:`… token as
// a badge, and a code span that is an id (`4e6ea128`, refbadge.ts codeRef) as the badge of what it names, the code as
// written when it names nothing. `mentions` includes `refs`. `commands` fences a bare `! cmd` line (bashlines.ts), so a
// command an agent forgot to put in code draws as the command row it meant, not as prose Markdown rewrote, and draws a
// `! cmd` code span in the mark's tint (coderun.ts isInlineCommand).
export interface MarkdownExtras {
    marks?: boolean;
    diagrams?: boolean;
    mentions?: boolean;
    refs?: boolean;
    commands?: boolean;
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
        return <Fenced lang={lang}>{diagramOf(lang, raw)}</Fenced>;
    },
};

function diagramOf(lang: string | undefined, raw: string): ReactNode {
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
    // a pair's list and a judge's marks as cards (chatpairblock.tsx); outside Chat's host they are the code block
    if (lang === PAIR_LANG) {
        return <PairBlock raw={raw} />;
    }
    if (lang === JUDGE_LANG) {
        return <JudgeBlock raw={raw} />;
    }
    if (lang === "math") {
        return <DisplayMath tex={raw} />;
    }
    return lang === "mermaid" ? <Mermaid chart={raw} /> : <CodeBlock code={raw} lang={lang} />;
}

// `filemention` and `refmention` are not HTML tags, so they are not keys of react-markdown's Components type
const MENTION_COMPONENT = {
    filemention: ({ path, children }: { path?: string; children?: ReactNode }) =>
        path != null && path !== "" ? <FilePill path={path} /> : <>{children}</>,
} as unknown as Components;

const REF_COMPONENT = {
    refmention: ({ kind, id, raw, children }: { kind?: RefKind; id?: string; raw?: string; children?: ReactNode }) =>
        kind != null && id != null && raw != null ? (
            <RefBadge kind={kind} id={id} raw={raw}>
                {children}
            </RefBadge>
        ) : (
            <>{children}</>
        ),
    code: ({ className, children }: { className?: string; children?: ReactNode }) => {
        const ref = className == null && typeof children === "string" ? codeRef(children) : null;
        const code = <InlineCode className={className}>{children}</InlineCode>;
        return ref == null ? (
            code
        ) : (
            <CodeRefBadge kind={ref.kind} id={ref.id} raw={children as string}>
                {code}
            </CodeRefBadge>
        );
    },
} as unknown as Components;

// one plugin list and one components map per set of extras, built once, so react-markdown never sees a new one on a
// re-render
const PLUGINS_BY_EXTRAS = new Map<string, PluggableList>();
const COMPONENTS_BY_EXTRAS = new Map<string, Components>();

function extrasKey(extras: MarkdownExtras): string {
    return `${extras.marks ? "m" : ""}${extras.diagrams ? "d" : ""}${extras.mentions ? "f" : ""}${refsOn(extras) ? "r" : ""}`;
}

const refsOn = (extras: MarkdownExtras) => extras.refs === true || extras.mentions === true;

function pluginsFor(extras: MarkdownExtras): PluggableList {
    const key = extrasKey(extras);
    let out = PLUGINS_BY_EXTRAS.get(key);
    if (out == null) {
        out = [
            remarkGfm,
            // `$…$` and `$$…$$` as formulas (KaTeX, prosetokens.tsx); guardDollars has already escaped a `$` that is no math
            remarkMath,
            ...(extras.marks ? [remarkMark] : []),
            // after the marks, so a mention inside a ==mark== is found too
            ...(extras.mentions ? [remarkFileMention] : []),
            ...(refsOn(extras) ? [remarkRefMention] : []),
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
            ...(refsOn(extras) ? REF_COMPONENT : {}),
        };
        COMPONENTS_BY_EXTRAS.set(key, out);
    }
    return out;
}

function renderMd(text: string, extras: MarkdownExtras = {}) {
    return (
        <CommandsContext.Provider value={extras.commands === true}>
            <ReactMarkdown
                remarkPlugins={pluginsFor(extras)}
                components={componentsFor(extras)}
                urlTransform={urlTransform}
            >
                {guardDollars(extras.commands ? fenceBangLines(text) : text)}
            </ReactMarkdown>
        </CommandsContext.Provider>
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
    refs,
    commands,
}: { text: string; className?: string } & MarkdownExtras) {
    const segments = splitInsightBlocks(text);
    // the selection is drawn over the text by selectionpaint.ts, not by the engine (WebKit fills the margins)
    const rootRef = useRef<HTMLDivElement>(null);
    const layerRef = useRef<HTMLDivElement>(null);
    useEffect(() => {
        if (rootRef.current == null || layerRef.current == null) {
            return;
        }
        return paintSelectionIn(rootRef.current, layerRef.current);
    }, []);
    return (
        <div ref={rootRef} className={cn("agent-md relative", className)} onMouseUp={trimTripleClick}>
            <div
                ref={layerRef}
                aria-hidden
                data-md-selection-layer
                className="pointer-events-none absolute inset-0 z-[1]"
            />
            {segments.map((seg, i) =>
                seg.kind === "insight" ? (
                    <InsightCallout key={i} text={seg.text} extras={{ marks, diagrams, mentions, refs, commands }} />
                ) : (
                    <Fragment key={i}>{renderMd(seg.text, { marks, diagrams, mentions, refs, commands })}</Fragment>
                )
            )}
        </div>
    );
});
