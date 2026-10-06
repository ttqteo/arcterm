// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0
//
// The File tab's Preview of a markdown file and the gestures that comment on it
// (docs/superpowers/specs/2026-10-06-md-comments-design.md): a selection's floating Comment (or c), the gutter + with
// Shift+click for a range, and an image's Comment. It reads the rendered blocks' line stamps (rehype-srclines.ts),
// measures them for the marks and buttons, and hosts cards through MdDocContext; which lines a gesture means and
// which block a card hangs after is mdcomments.ts.

import { Markdown } from "@/app/element/markdown";
import { globalStore } from "@/app/store/jotaiStore";
import { splitFrontmatter } from "@/app/view/code/codefrontmatter";
import { FrontmatterCard } from "@/app/view/code/frontmattercard";
import { formatChordString } from "@/util/keysym";
import { cn, fireAndForget } from "@/util/util";
import { useAtomValue } from "jotai";
import { MessageSquarePlus, Plus } from "lucide-react";
import {
    useCallback,
    useEffect,
    useLayoutEffect,
    useMemo,
    useRef,
    useState,
    type KeyboardEvent,
    type MouseEvent,
} from "react";
import { openFileInPanel, openRefInCode, railMdModeAtom } from "./agentrailstore";
import type { FileRef } from "./agentrailtabs";
import type { AgentsViewModel } from "./agents";
import type { AgentVM } from "./agentsviewmodel";
import { CardSlot, MdDocContext, type MdDocCtx } from "./mdcommentcards";
import {
    blockForLine,
    blockKind,
    bodyOffset,
    cardNumbers,
    coveredIndexes,
    hostIndex,
    imageTarget,
    orderMdComments,
    panelLink,
    plusTarget,
    selectionTarget,
    type MdBlock,
    type MdComment,
    type MdTarget,
} from "./mdcomments";
import { mdCommentAtom, openBox, setBoxRange } from "./mdcommentstore";

// the text column's left inset: room for the gutter +
const GUTTER = 36;
const FLOAT_BTN =
    "absolute z-10 flex cursor-pointer items-center gap-[6px] whitespace-nowrap rounded-[7px] border-0 bg-accent px-[10px] py-[5px] text-[12.5px] font-semibold leading-[1.2] text-background shadow-popover-sm hover:bg-accenthover";
const KBD = "rounded-[4px] bg-background/20 px-[5px] font-mono text-[10.5px]";

interface Overlay {
    top: number;
    height: number;
    lines: string;
}

function lineOf(el: Element): { start: number; end: number } {
    return { start: Number(el.getAttribute("data-src-start")), end: Number(el.getAttribute("data-src-end")) };
}

function toBlock(el: Element): MdBlock {
    const src = el.getAttribute("data-md-src");
    return { kind: blockKind(el.tagName), ...lineOf(el), ...(src != null ? { src } : {}) };
}

// Shows the agent's open comment box with the caret in it (spec item 11): `shownAbs` is the file the File tab shows.
// The box renders in Preview only, so Preview is switched on. In another file, or out of Source, the box's Preview
// mounts and its textarea takes the caret as it renders (autoFocus); here and already in Preview, it is focused now.
export function revealMdBox(model: AgentsViewModel, agentId: string, shownAbs: string | null): void {
    const box = globalStore.get(mdCommentAtom(agentId)).box;
    if (box == null) {
        return;
    }
    const wasPreview = globalStore.get(railMdModeAtom) === "preview";
    globalStore.set(railMdModeAtom, "preview");
    if (box.file !== shownAbs) {
        openFileInPanel(model, agentId, { abs: box.file, root: box.root, line: box.startLine });
    } else if (wasPreview) {
        document.querySelector<HTMLTextAreaElement>("[data-rail-file] [data-md-box] textarea")?.focus();
    }
}

export function MdDoc({
    model,
    agent,
    fileRef,
    text,
}: {
    model: AgentsViewModel;
    agent: AgentVM;
    fileRef: FileRef;
    text: string;
}) {
    const agentId = agent.id;
    const state = useAtomValue(mdCommentAtom(agentId));
    const scrollRef = useRef<HTMLDivElement>(null);
    const contentRef = useRef<HTMLDivElement>(null);
    const doc = useMemo(() => splitFrontmatter(text), [text]);
    const offset = useMemo(() => bodyOffset(text, doc.body), [text, doc]);
    const fileLines = useMemo(() => text.split(/\r?\n/), [text]);
    // memoized: Markdown is memo'd, and a new header element would re-render the whole document
    const header = useMemo(() => (doc.fields.length > 0 ? <FrontmatterCard fields={doc.fields} /> : null), [doc]);
    const resolveOpts = useMemo(
        () => ({ connName: "local", baseDir: fileRef.abs.replace(/[\\/][^\\/]*$/, "") }),
        [fileRef.abs]
    );
    const [els, setEls] = useState<Element[]>([]);
    const blocks = useMemo(() => els.map(toBlock), [els]);
    const [hover, setHover] = useState<{ index: number; top: number } | null>(null);
    const [hoverImg, setHoverImg] = useState<number | null>(null);
    const [sel, setSel] = useState<{ target: MdTarget; top: number; left: number } | null>(null);
    const [geo, setGeo] = useState<{
        marks: (Overlay & { kind: string })[];
        bars: Overlay[];
        images: { index: number; top: number; right: number }[];
    }>({ marks: [], bars: [], images: [] });

    const fileComments = useMemo(
        () => orderMdComments(state.comments.filter((c) => c.file === fileRef.abs)),
        [state.comments, fileRef.abs]
    );
    const box = state.box?.file === fileRef.abs ? state.box : undefined;
    const line = fileRef.line;
    const hitIndex = line != null ? blockForLine(blocks, line) : -1;

    // the stamped blocks in document order; again whenever the rendered DOM changes (an image resolves late), but not
    // for our own cards and buttons
    useLayoutEffect(() => {
        const root = contentRef.current;
        if (root == null) {
            return;
        }
        let raf = 0;
        const collect = () => {
            raf = 0;
            const next = [...root.querySelectorAll("[data-src-start]")];
            setEls((prev) => (prev.length === next.length && prev.every((e, i) => e === next[i]) ? prev : next));
        };
        collect();
        const mo = new MutationObserver((records) => {
            if (records.every((r) => (r.target as Element).closest?.("[data-md-slot],[data-md-overlay]") != null)) {
                return;
            }
            if (raf === 0) {
                raf = requestAnimationFrame(collect);
            }
        });
        mo.observe(root, { childList: true, subtree: true });
        return () => {
            mo.disconnect();
            cancelAnimationFrame(raf);
        };
    }, [text]);

    // opened at a line: centre its block once per file and line, not on every later DOM change
    const scrolledTo = useRef("");
    useLayoutEffect(() => {
        const key = `${fileRef.abs}:${line ?? ""}`;
        if (line == null || hitIndex < 0 || scrolledTo.current === key) {
            return;
        }
        els[hitIndex]?.scrollIntoView({ block: "center" });
        scrolledTo.current = key;
    }, [hitIndex, els, fileRef.abs, line]);

    // the marks (the :line block, the open box's blocks), each comment's gutter bar, and each image's top-right corner
    // for its Comment button, in content coordinates
    useLayoutEffect(() => {
        const root = contentRef.current;
        if (root == null) {
            return;
        }
        const measure = () => {
            const base = root.getBoundingClientRect();
            const span = (idxs: number[], lines: string): Overlay | null => {
                const rects = idxs.filter((i) => i >= 0 && els[i] != null).map((i) => els[i].getBoundingClientRect());
                if (rects.length === 0) {
                    return null;
                }
                const top = Math.min(...rects.map((r) => r.top)) - base.top;
                const bottom = Math.max(...rects.map((r) => r.bottom)) - base.top;
                return { top, height: bottom - top, lines };
            };
            const covered = (c: { startLine: number; endLine: number; image?: string }) =>
                c.image != null ? [hostIndex(blocks, c)] : coveredIndexes(blocks, c.startLine, c.endLine);
            const marks: (Overlay & { kind: string })[] = [];
            const hit = hitIndex >= 0 ? span([hitIndex], `${blocks[hitIndex].start}-${blocks[hitIndex].end}`) : null;
            if (hit != null) {
                marks.push({ ...hit, kind: "hit" });
            }
            const target = box != null ? span(covered(box), `${box.startLine}-${box.endLine}`) : null;
            if (target != null) {
                marks.push({ ...target, kind: "target" });
            }
            const bars = fileComments
                .map((c) => span(covered(c), `${c.startLine}-${c.endLine}`))
                .filter((o): o is Overlay => o != null);
            const images = blocks.flatMap((b, index) => {
                if (b.kind !== "img") {
                    return [];
                }
                const r = els[index].getBoundingClientRect();
                return [{ index, top: r.top - base.top + 10, right: base.right - r.right + 10 }];
            });
            setGeo({ marks, bars, images });
        };
        measure();
        const ro = new ResizeObserver(measure);
        ro.observe(root);
        return () => ro.disconnect();
    }, [els, blocks, hitIndex, box, fileComments]);

    // the selection's target (mdcomments.ts selectionTarget, from the body's blocks it touches) and where its Comment
    // button floats. A selection inside a card or the box (copying your own note) is not one.
    useEffect(() => {
        const update = () => {
            const s = window.getSelection();
            const root = contentRef.current;
            if (s == null || s.isCollapsed || s.rangeCount === 0 || root == null) {
                setSel(null);
                return;
            }
            const range = s.getRangeAt(0);
            const common = range.commonAncestorContainer;
            const commonEl = common instanceof Element ? common : common.parentElement;
            if (!range.intersectsNode(root) || commonEl?.closest("[data-md-slot],[data-md-overlay]") != null) {
                setSel(null);
                return;
            }
            const touched = els.flatMap((el, i) => (range.intersectsNode(el) ? [i] : []));
            const target = selectionTarget(blocks, touched, s.toString());
            if (target == null) {
                setSel(null);
                return;
            }
            const r = range.getBoundingClientRect();
            const base = root.getBoundingClientRect();
            setSel({
                target,
                top: r.bottom - base.top + 6,
                left: Math.min(Math.max(r.right - base.left - 120, 8), base.width - 150),
            });
        };
        document.addEventListener("selectionchange", update);
        return () => document.removeEventListener("selectionchange", update);
    }, [els, blocks]);

    // a box that holds text was kept: the caret goes to it, in its own file when that is not this one
    const focusBox = useCallback(() => revealMdBox(model, agentId, fileRef.abs), [model, agentId, fileRef.abs]);
    const done = useCallback(() => scrollRef.current?.focus({ preventScroll: true }), []);
    const opened = (r: "opened" | "kept") => {
        if (r === "kept") {
            focusBox();
        }
    };
    const at = { file: fileRef.abs, root: fileRef.root };

    const commentSelection = () => {
        if (sel == null) {
            return;
        }
        opened(openBox(agentId, { ...at, ...sel.target }));
        window.getSelection()?.removeAllRanges();
        setSel(null);
    };

    const plus = (index: number, shift: boolean) => {
        const from = state.box?.file === fileRef.abs ? state.box.anchor : undefined;
        const p = plusTarget(blocks, index, fileLines, shift, from);
        if (p == null) {
            return;
        }
        if (p.extend) {
            setBoxRange(agentId, p.target.startLine, p.target.endLine, p.target.quote);
        } else {
            opened(openBox(agentId, { ...at, ...p.target }));
        }
    };

    const commentImage = (index: number) => {
        const target = imageTarget(blocks, index);
        if (target != null) {
            opened(openBox(agentId, { ...at, ...target }));
        }
    };

    // the block under the pointer's row, probed at the text column so the gutter + stays reachable; between blocks
    // or over a button the last one stays
    const onMove = (e: MouseEvent<HTMLDivElement>) => {
        const root = contentRef.current;
        if (root == null) {
            return;
        }
        const base = root.getBoundingClientRect();
        const probe = document.elementFromPoint(Math.max(e.clientX, base.left + GUTTER + 2), e.clientY);
        if (probe == null || probe.closest("[data-md-slot],[data-md-overlay]") != null) {
            return;
        }
        const el = probe.closest("[data-src-start]");
        const index = el != null && root.contains(el) ? els.indexOf(el) : -1;
        if (index < 0) {
            return;
        }
        if (el.tagName === "IMG") {
            setHoverImg(index);
            setHover(null);
        } else {
            setHover({ index, top: el.getBoundingClientRect().top - base.top + 2 });
            setHoverImg(null);
        }
    };

    const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
        if (
            e.key === "c" &&
            !e.ctrlKey &&
            !e.metaKey &&
            !e.altKey &&
            sel != null &&
            !(e.target instanceof HTMLTextAreaElement)
        ) {
            e.preventDefault();
            e.stopPropagation();
            commentSelection();
        }
    };

    const onClickLink = useCallback(
        (href: string) => {
            const t = panelLink(fileRef.abs, href);
            if (t == null) {
                return false;
            }
            // panelLink answers with "/": keep this file's separators, so a comment's file matches however it opens
            const abs = fileRef.abs.includes("\\") ? t.abs.replace(/\//g, "\\") : t.abs;
            const ref: FileRef = { abs, root: fileRef.root, ...(t.line != null ? { line: t.line } : {}) };
            if (t.markdown) {
                openFileInPanel(model, agentId, ref);
            } else {
                fireAndForget(() => openRefInCode(model, ref));
            }
            return true;
        },
        [fileRef.abs, fileRef.root, model, agentId]
    );

    const blockAfter = useCallback((tag: string) => <CardSlot inside={tag === "li"} />, []);

    const hosts = useMemo(() => {
        const m = new Map<Element, MdComment[]>();
        for (const c of fileComments) {
            const el = els[hostIndex(blocks, c)];
            if (el != null) {
                m.set(el, [...(m.get(el) ?? []), c]);
            }
        }
        return m;
    }, [fileComments, blocks, els]);
    const boxHost = box != null ? (els[hostIndex(blocks, box)] ?? null) : null;
    const numbers = useMemo(() => cardNumbers(state.comments), [state.comments]);
    const ctx = useMemo<MdDocCtx>(
        () => ({ agentId, hosts, box, boxHost, numbers, focusBox, done }),
        [agentId, hosts, box, boxHost, numbers, focusBox, done]
    );

    return (
        <div
            ref={scrollRef}
            tabIndex={-1}
            data-md-doc
            onKeyDown={onKeyDown}
            className="min-h-0 flex-1 overflow-y-auto bg-background outline-none focus:ring-1 focus:ring-inset focus:ring-accent/40"
        >
            <div
                ref={contentRef}
                onMouseMove={onMove}
                onMouseLeave={() => {
                    setHover(null);
                    setHoverImg(null);
                }}
                className="relative pb-10 pr-[22px] pt-[18px]"
                style={{ paddingLeft: GUTTER }}
            >
                <div data-md-overlay aria-hidden className="pointer-events-none absolute inset-0">
                    {geo.marks.map((m) => (
                        <div
                            key={m.kind}
                            data-md-mark={m.kind}
                            data-lines={m.lines}
                            className="absolute left-5 right-3 rounded-r-[4px] bg-surface-hover"
                            style={{ top: m.top - 4, height: m.height + 8 }}
                        >
                            <div className="absolute inset-y-0 left-0 w-0.5 bg-accent" />
                        </div>
                    ))}
                    {geo.bars.map((b, i) => (
                        <div
                            key={i}
                            data-md-bar
                            data-lines={b.lines}
                            className="absolute left-5 w-0.5 rounded-[1px] bg-edge-strong"
                            style={{ top: b.top + 2, height: Math.max(b.height - 4, 4) }}
                        />
                    ))}
                </div>
                {/* positioned, and after the overlay, so the text paints over the marks' fill */}
                <div className="relative">
                    <MdDocContext.Provider value={ctx}>
                        <Markdown
                            text={doc.body}
                            header={header}
                            scrollable={false}
                            className="markdown-doc"
                            contentClassName="p-0"
                            fontSizeOverride={14}
                            resolveOpts={resolveOpts}
                            srcLineOffset={offset}
                            contentBlocks={false}
                            blockAfter={blockAfter}
                            onClickLink={onClickLink}
                        />
                    </MdDocContext.Provider>
                </div>
                {hover != null && sel == null ? (
                    <button
                        type="button"
                        data-md-overlay
                        data-md-plus
                        title="Comment on this block (Shift+click another for a range)"
                        aria-label="Comment on this block"
                        onMouseDown={(e) => e.preventDefault()}
                        onClick={(e) => plus(hover.index, e.shiftKey)}
                        className="absolute left-2 flex h-[18px] w-[18px] cursor-pointer items-center justify-center rounded-[5px] border-0 bg-accent p-0 text-background hover:bg-accenthover"
                        style={{ top: hover.top }}
                    >
                        <Plus size={12} strokeWidth={2.6} aria-hidden />
                    </button>
                ) : null}
                {/* one per image and always in the DOM, so Tab reaches it (spec item 17); seen while its image is
                    hovered or it has keyboard focus */}
                {geo.images.map((m) => (
                    <button
                        key={m.index}
                        type="button"
                        data-md-overlay
                        data-md-image-comment
                        title="Comment on this image"
                        // the pointer can reach the corner before the image: show the button it is over
                        onMouseEnter={() => setHoverImg(m.index)}
                        onClick={() => commentImage(m.index)}
                        className={cn(
                            FLOAT_BTN,
                            hoverImg === m.index && sel == null ? null : "opacity-0 focus-visible:opacity-100"
                        )}
                        style={{ top: m.top, right: m.right }}
                    >
                        <MessageSquarePlus size={13} strokeWidth={2.2} aria-hidden />
                        Comment
                    </button>
                ))}
                {sel != null ? (
                    <button
                        type="button"
                        data-md-overlay
                        data-md-comment
                        title={`Comment on the selection (${formatChordString("c")})`}
                        // keep the selection: a press would otherwise collapse it before the click
                        onMouseDown={(e) => e.preventDefault()}
                        onClick={commentSelection}
                        className={FLOAT_BTN}
                        style={{ top: sel.top, left: sel.left }}
                    >
                        <MessageSquarePlus size={13} strokeWidth={2.2} aria-hidden />
                        Comment
                        <span className={KBD}>{formatChordString("c")}</span>
                    </button>
                ) : null}
            </div>
        </div>
    );
}
