// Copyright 2025, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { CopyButton } from "@/app/element/copybutton";
import { createContentBlockPlugin } from "@/app/element/markdown-contentblock-plugin";
import { tableClipboard } from "@/app/element/markdown-table";
import {
    cachedLocalImage,
    MarkdownContentBlockType,
    resolveRemoteFile,
    resolveSrcSet,
    transformBlocks,
} from "@/app/element/markdown-util";
import { rehypeSrcLines, withSrcLineAttributes } from "@/app/element/rehype-srclines";
import remarkMark from "@/app/element/remark-mark";
import remarkMermaidToTag from "@/app/element/remark-mermaid-to-tag";
import remarkQuoteBreaks from "@/app/element/remark-quote-breaks";
import { boundNumber, cn, useAtomValueSafe } from "@/util/util";
import clsx from "clsx";
import { Atom } from "jotai";
import { OverlayScrollbarsComponent, OverlayScrollbarsComponentRef } from "overlayscrollbars-react";
import { memo, useEffect, useMemo, useRef, useState } from "react";
import ReactMarkdown, { Components } from "react-markdown";
import rehypeHighlight from "rehype-highlight";
import rehypeRaw from "rehype-raw";
import rehypeSanitize, { defaultSchema } from "rehype-sanitize";
import rehypeSlug from "rehype-slug";
import RemarkFlexibleToc, { TocItem } from "remark-flexible-toc";
import remarkGfm from "remark-gfm";
import { openLink } from "../store/global";
import { IconButton } from "./iconbutton";
import "./markdown.scss";
import { Mermaid } from "./mermaid";

// the source-line stamp (rehype-srclines.ts) an overridden component must keep on the element it renders
function stampAttrs(props: object): Record<string, string> {
    const p = props as Record<string, unknown>;
    if (p["data-src-start"] == null) {
        return {};
    }
    return { "data-src-start": String(p["data-src-start"]), "data-src-end": String(p["data-src-end"]) };
}

const Link = ({
    setFocusedHeading,
    onClickLink,
    props,
}: {
    props: React.AnchorHTMLAttributes<HTMLAnchorElement>;
    setFocusedHeading: (href: string) => void;
    onClickLink?: (href: string) => boolean;
}) => {
    const onClick = (e: React.MouseEvent) => {
        e.preventDefault();
        if (props.href.startsWith("#")) {
            setFocusedHeading(props.href);
        } else if (!onClickLink?.(props.href)) {
            openLink(props.href);
        }
    };
    return (
        <a href={props.href} onClick={onClick} className="text-accent hover:underline">
            {props.children}
        </a>
    );
};

const Heading = ({ props, hnum }: { props: React.HTMLAttributes<HTMLHeadingElement>; hnum: number }) => {
    return (
        <div id={props.id} className={clsx("heading", `is-${hnum}`)} {...stampAttrs(props)}>
            {props.children}
        </div>
    );
};

const Code = ({ className = "", children }: { className?: string; children: React.ReactNode }) => {
    if (/\blanguage-mermaid\b/.test(className)) {
        const text = Array.isArray(children) ? children.join("") : String(children ?? "");
        return <Mermaid chart={text} />;
    }
    return <code className={className}>{children}</code>;
};

type CodeBlockProps = {
    children: React.ReactNode;
    onClickExecute?: (cmd: string) => void;
    attrs?: Record<string, string>;
};

const CodeBlock = ({ children, onClickExecute, attrs }: CodeBlockProps) => {
    const getTextContent = (children: any): string => {
        if (typeof children === "string") {
            return children;
        } else if (Array.isArray(children)) {
            return children.map(getTextContent).join("");
        } else if (children.props && children.props.children) {
            return getTextContent(children.props.children);
        }
        return "";
    };

    const handleExecute = (e: React.MouseEvent) => {
        let textToCopy = getTextContent(children);
        textToCopy = textToCopy.replace(/\n$/, ""); // remove trailing newline
        if (onClickExecute) {
            onClickExecute(textToCopy);
            return;
        }
    };

    return (
        <pre className="codeblock" {...attrs}>
            {children}
            <div className="codeblock-actions">
                <CopyButton content={getTextContent(children).replace(/\n$/, "")} title="Copy" />
                {onClickExecute && (
                    <IconButton
                        decl={{
                            elemtype: "iconbutton",
                            icon: "regular@square-terminal",
                            click: handleExecute,
                        }}
                    />
                )}
            </div>
        </pre>
    );
};

const MarkdownSource = ({
    props,
    resolveOpts,
}: {
    props: React.HTMLAttributes<HTMLSourceElement> & {
        srcSet?: string;
        media?: string;
    };
    resolveOpts: MarkdownResolveOpts;
}) => {
    const [resolvedSrcSet, setResolvedSrcSet] = useState<string>(props.srcSet);
    const [resolving, setResolving] = useState<boolean>(true);

    useEffect(() => {
        const resolvePath = async () => {
            const resolved = await resolveSrcSet(props.srcSet, resolveOpts);
            setResolvedSrcSet(resolved);
            setResolving(false);
        };

        resolvePath();
    }, [props.srcSet]);

    if (resolving) {
        return null;
    }

    return <source srcSet={resolvedSrcSet} media={props.media} />;
};

interface WaveBlockProps {
    blockkey: string;
    blockmap: Map<string, MarkdownContentBlockType>;
}

function WaveBlock(props: WaveBlockProps) {
    const { blockkey, blockmap } = props;
    const block = blockmap.get(blockkey);
    if (block == null) {
        return null;
    }
    const sizeInKB = Math.round((block.content.length / 1024) * 10) / 10;
    const displayName = block.id.replace(/^"|"$/g, "");
    return (
        <div className="waveblock">
            <div className="wave-block-content">
                <div className="wave-block-icon">
                    <i className="fas fa-file-code"></i>
                </div>
                <div className="wave-block-info">
                    <span className="wave-block-filename">{displayName}</span>
                    <span className="wave-block-size">{sizeInKB} KB</span>
                </div>
            </div>
        </div>
    );
}

const MarkdownImg = ({
    props,
    resolveOpts,
}: {
    props: React.ImgHTMLAttributes<HTMLImageElement>;
    resolveOpts: MarkdownResolveOpts;
}) => {
    // every render of Markdown remounts its images: one read before draws at once from its blob:, checked again below
    // (not with a srcset, whose own paths wait for the read)
    const [cached] = useState(() => (props.srcSet ? null : cachedLocalImage(props.src, resolveOpts)));
    const [resolvedSrc, setResolvedSrc] = useState<string>(cached ?? props.src);
    const [resolvedSrcSet, setResolvedSrcSet] = useState<string>(props.srcSet);
    const [resolvedStr, setResolvedStr] = useState<string>(null);
    const [resolving, setResolving] = useState<boolean>(cached == null);

    useEffect(() => {
        if (props.src.startsWith("data:image/")) {
            setResolving(false);
            setResolvedSrc(props.src);
            setResolvedStr(null);
            return;
        }
        if (resolveOpts == null) {
            setResolving(false);
            setResolvedSrc(null);
            setResolvedStr(`[img:${props.src}]`);
            return;
        }

        const resolveFn = async () => {
            const [resolvedSrc, resolvedSrcSet] = await Promise.all([
                resolveRemoteFile(props.src, resolveOpts),
                resolveSrcSet(props.srcSet, resolveOpts),
            ]);

            setResolvedSrc(resolvedSrc);
            setResolvedSrcSet(resolvedSrcSet);
            setResolvedStr(null);
            setResolving(false);
        };
        resolveFn();
    }, [props.src, props.srcSet]);

    if (resolving) {
        return null;
    }
    if (resolvedStr != null) {
        return <span>{resolvedStr}</span>;
    }
    if (resolvedSrc != null) {
        return <img {...props} src={resolvedSrc} srcSet={resolvedSrcSet} data-md-src={props.src} />;
    }
    return <span>[img]</span>;
};

type MarkdownProps = {
    text?: string;
    textAtom?: Atom<string> | Atom<Promise<string>>;
    showTocAtom?: Atom<boolean>;
    style?: React.CSSProperties;
    className?: string;
    contentClassName?: string;
    onClickExecute?: (cmd: string) => void;
    // return true when the link was handled; false falls through to the external opener
    onClickLink?: (href: string) => boolean;
    resolveOpts?: MarkdownResolveOpts;
    scrollable?: boolean;
    rehype?: boolean;
    fontSizeOverride?: number;
    fixedFontSizeOverride?: number;
    // rendered above the document, inside its scroll area (the Code preview's frontmatter card)
    header?: React.ReactNode;
    // turns on source-line stamps: the number of file lines above `text` (a frontmatter block lifted off the top)
    srcLineOffset?: number;
    // Wave's @@@start content blocks; off where line numbers must match the file, since the transform folds lines
    contentBlocks?: boolean;
    // rendered after every stamped block (inside an li, as its last child): the Agent panel's comment cards
    blockAfter?: (tag: string) => React.ReactNode;
    // makes task boxes clickable: called with the source line of the box's list item (needs srcLineOffset)
    onToggleTask?: (line: number) => void;
};

const Markdown = memo(function Markdown({
    text,
    textAtom,
    showTocAtom,
    style,
    className,
    contentClassName,
    resolveOpts,
    fontSizeOverride,
    fixedFontSizeOverride,
    header,
    srcLineOffset,
    contentBlocks = true,
    blockAfter,
    onToggleTask,
    scrollable = true,
    rehype = true,
    onClickExecute,
    onClickLink,
}: MarkdownProps) {
    const textAtomValue = useAtomValueSafe<string>(textAtom);
    const tocRef = useRef<TocItem[]>([]);
    const showToc = useAtomValueSafe(showTocAtom) ?? false;
    const contentsOsRef = useRef<OverlayScrollbarsComponentRef>(null);
    const [focusedHeading, setFocusedHeading] = useState<string>(null);

    // Ensure uniqueness of ids between MD preview instances.
    const [idPrefix] = useState<string>(crypto.randomUUID());

    text = textAtomValue ?? text ?? "";
    const transformedOutput = contentBlocks
        ? transformBlocks(text)
        : { content: text, blocks: new Map<string, MarkdownContentBlockType>() };
    const transformedText = transformedOutput.content;
    const contentBlocksMap = transformedOutput.blocks;

    useEffect(() => {
        if (!focusedHeading) {
            return;
        }
        const heading = document.getElementById(idPrefix + focusedHeading.slice(1));
        if (heading == null) {
            return;
        }
        const viewport = contentsOsRef.current?.osInstance()?.elements().viewport;
        if (viewport != null) {
            viewport.scrollBy({ top: heading.getBoundingClientRect().top - viewport.getBoundingClientRect().top });
        } else {
            // not scrollable: the host's scroller moves (the Agent panel's markdown Preview)
            heading.scrollIntoView({ block: "start" });
        }
    }, [focusedHeading]);

    const after = (tag: string, props: object) =>
        blockAfter != null && (props as Record<string, unknown>)["data-src-start"] != null ? blockAfter(tag) : null;
    const markdownComponents: Partial<Components> = {
        a: (props: React.HTMLAttributes<HTMLAnchorElement>) => (
            <Link props={props} setFocusedHeading={setFocusedHeading} onClickLink={onClickLink} />
        ),
        p: ({ node, ...props }: any) => (
            <>
                <div className="paragraph" {...props} />
                {after("p", props)}
            </>
        ),
        h1: ({ node, ...props }: any) => (
            <>
                <Heading props={props} hnum={1} />
                {after("h1", props)}
            </>
        ),
        h2: ({ node, ...props }: any) => (
            <>
                <Heading props={props} hnum={2} />
                {after("h2", props)}
            </>
        ),
        h3: ({ node, ...props }: any) => (
            <>
                <Heading props={props} hnum={3} />
                {after("h3", props)}
            </>
        ),
        h4: ({ node, ...props }: any) => (
            <>
                <Heading props={props} hnum={4} />
                {after("h4", props)}
            </>
        ),
        h5: ({ node, ...props }: any) => (
            <>
                <Heading props={props} hnum={5} />
                {after("h5", props)}
            </>
        ),
        h6: ({ node, ...props }: any) => (
            <>
                <Heading props={props} hnum={6} />
                {after("h6", props)}
            </>
        ),
        li: ({ node, children, ...props }: any) => (
            <li {...props}>
                {children}
                {after("li", props)}
            </li>
        ),
        hr: ({ node, ...props }: any) => (
            <>
                <hr {...props} />
                {after("hr", props)}
            </>
        ),
        table: ({ node, children, ...props }: any) => (
            <>
                <div className="table-block">
                    <div className="table-box">
                        <table {...props}>{children}</table>
                        <div className="table-actions">
                            <CopyButton content={() => tableClipboard(node)} title="Copy table" />
                        </div>
                    </div>
                </div>
                {after("table", props)}
            </>
        ),
        img: ({ node, ...props }: any) => (
            <>
                <MarkdownImg props={props} resolveOpts={resolveOpts} />
                {after("img", props)}
            </>
        ),
        source: (props: React.HTMLAttributes<HTMLSourceElement>) => (
            <MarkdownSource props={props} resolveOpts={resolveOpts} />
        ),
        code: Code,
        pre: ({ node, ...props }: any) => (
            <>
                <CodeBlock children={props.children} onClickExecute={onClickExecute} attrs={stampAttrs(props)} />
                {after("pre", props)}
            </>
        ),
    };
    if (onToggleTask != null) {
        // GFM renders a task box disabled; enabled here, it stays controlled by `checked` until the file changes
        markdownComponents.input = ({ node, ...props }: any) => {
            if (props.type !== "checkbox") {
                return <input {...props} />;
            }
            return (
                <input
                    {...props}
                    disabled={false}
                    className="cursor-pointer accent-accent"
                    onChange={(e) => {
                        const li = e.currentTarget.closest("li[data-src-start]");
                        if (li != null) {
                            onToggleTask(Number(li.getAttribute("data-src-start")));
                        }
                    }}
                />
            );
        };
    }
    markdownComponents["waveblock"] = (props: any) => <WaveBlock {...props} blockmap={contentBlocksMap} />;
    markdownComponents["mermaidblock"] = (props: any) => {
        const getTextContent = (children: any): string => {
            if (typeof children === "string") {
                return children;
            } else if (Array.isArray(children)) {
                return children.map(getTextContent).join("");
            } else if (children && typeof children === "object" && children.props && children.props.children) {
                return getTextContent(children.props.children);
            }
            return String(children || "");
        };

        const chartText = getTextContent(props.children);
        return <Mermaid chart={chartText} />;
    };

    const toc = useMemo(() => {
        if (showToc) {
            if (tocRef.current.length > 0) {
                return tocRef.current.map((item) => {
                    return (
                        <a
                            key={item.href}
                            className="toc-item text-accent hover:underline"
                            style={{ "--indent-factor": item.depth } as React.CSSProperties}
                            onClick={() => setFocusedHeading(item.href)}
                        >
                            {item.value}
                        </a>
                    );
                });
            } else {
                return (
                    <div
                        className="toc-item toc-empty text-secondary"
                        style={{ "--indent-factor": 2 } as React.CSSProperties}
                    >
                        No sub-headings found
                    </div>
                );
            }
        }
    }, [showToc, tocRef]);

    let rehypePlugins = null;
    if (rehype) {
        rehypePlugins = [
            ...(srcLineOffset != null ? [[rehypeSrcLines, { offset: srcLineOffset }]] : []),
            rehypeRaw,
            rehypeHighlight,
            () =>
                rehypeSanitize(
                    withSrcLineAttributes({
                        ...defaultSchema,
                        attributes: {
                            ...defaultSchema.attributes,
                            span: [
                                ...(defaultSchema.attributes?.span || []),
                                // Allow all class names starting with `hljs-`.
                                ["className", /^hljs-./],
                                ["srcset"],
                                ["media"],
                                ["type"],
                            ],
                            waveblock: [["blockkey"]],
                        },
                        tagNames: [
                            ...(defaultSchema.tagNames || []),
                            "span",
                            "waveblock",
                            "picture",
                            "source",
                            "mermaidblock",
                            "mark",
                        ],
                    })
                ),
            () => rehypeSlug({ prefix: idPrefix }),
        ];
    }
    const remarkPlugins: any = [
        remarkMermaidToTag,
        remarkGfm,
        remarkQuoteBreaks,
        remarkMark,
        [RemarkFlexibleToc, { tocRef: tocRef.current }],
        [createContentBlockPlugin, { blocks: contentBlocksMap }],
    ];

    // Rendered inline, NOT as <ScrollableMarkdown/> components declared here: a component defined
    // during render is a new type on every render, so React unmounts and remounts the whole subtree —
    // which threw away the scroll position (and every child's state) whenever an ancestor re-rendered.
    const rendered = (
        <ReactMarkdown remarkPlugins={remarkPlugins} rehypePlugins={rehypePlugins} components={markdownComponents}>
            {transformedText}
        </ReactMarkdown>
    );

    const mergedStyle = { ...style };
    if (fontSizeOverride != null) {
        mergedStyle["--markdown-font-size"] = `${boundNumber(fontSizeOverride, 6, 64)}px`;
    }
    if (fixedFontSizeOverride != null) {
        mergedStyle["--markdown-fixed-font-size"] = `${boundNumber(fixedFontSizeOverride, 6, 64)}px`;
    }
    return (
        <div className={clsx("markdown", className)} style={mergedStyle}>
            {scrollable ? (
                <OverlayScrollbarsComponent
                    ref={contentsOsRef}
                    className={cn("content", contentClassName)}
                    options={{ scrollbars: { autoHide: "leave" } }}
                >
                    {header}
                    {rendered}
                </OverlayScrollbarsComponent>
            ) : (
                <div className={cn("content non-scrollable", contentClassName)}>
                    {header}
                    {rendered}
                </div>
            )}
            {toc && (
                <OverlayScrollbarsComponent className="toc mt-1" options={{ scrollbars: { autoHide: "leave" } }}>
                    <div className="toc-inner">
                        <h4 className="font-bold">Table of Contents</h4>
                        {toc}
                    </div>
                </OverlayScrollbarsComponent>
            )}
        </div>
    );
});

export { Markdown };
