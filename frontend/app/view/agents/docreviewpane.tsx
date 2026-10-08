// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0
//
// An agent's Doc review, shown on the Agent surface in place of its (still mounted, hidden) terminal: a toolbar,
// the agent's ask, the prose diff with comments level with their paragraph, and a tray that sends Approve or
// Request changes as one answer. Thin: rows, tray copy and scroll targets come from docreviewview.ts, the reads
// from docreviewload.ts, and the state from docreviewstore.ts.

import { openFileInCode } from "@/app/cockpit/openfilestore";
import { SkeletonLine } from "@/app/element/skeleton";
import { useDimensionsWithCallbackRef } from "@/app/hook/useDimensions";
import { openLink } from "@/app/store/global";
import { globalStore } from "@/app/store/jotaiStore";
import { formatChordString } from "@/util/keysym";
import { cn, fireAndForget } from "@/util/util";
import { useAtomValue } from "jotai";
import { Check, FileText, MessageSquarePlus, Pencil, X } from "lucide-react";
import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import type { AgentsViewModel } from "./agents";
import { askSentKey, type AgentVM } from "./agentsviewmodel";
import { PdfPanel, PdfToolbar } from "./docpdfpane";
import { toProse, type ProseDoc, type ProseSentence } from "./docprose";
import { focusItem, parseDocReview, type DocReview } from "./docreview";
import { docReviewLoadAtom, loadDocReview, loadImage, type DocReviewLoad, type ImageData } from "./docreviewload";
import {
    addComment,
    docReviewStateAtom,
    removeComment,
    setDocReviewTab,
    setGeneralNote,
    setLastSend,
    toggleWholeFile,
    updateComment,
    type DocReviewState,
} from "./docreviewstore";
import {
    anchorTarget,
    commentNumbers,
    focusTarget,
    imageMark,
    isNarrow,
    leadLabel,
    metaLine,
    resolveRelative,
    reviewRows,
    sentenceMarks,
    sentLine,
    showsLabel,
    trayState,
    type ImageMark,
    type ReviewRow,
    type SentenceMark,
    type TrayState,
} from "./docreviewview";
import {
    anchorFor,
    clipSelection,
    formatRequest,
    paragraphSpan,
    replacementFor,
    wordDiff,
    type ProseComment,
    type SelPoint,
} from "./proseanchor";
import { diffProse, type SectionChange, type SentenceChange } from "./prosediff";
import { DELETED, INSERTED, ProseTokens, type OpToken } from "./prosetokens";
import { SWAP_BAR, SWAP_BTN, SWAP_BTN_ON, SWAP_LABEL, SwapTabs } from "./swapbar";

// a doc review is always the ask's only question
const QI = 0;

// the comment column beside each paragraph, as the mockup draws it; one column below COMMENT_COLUMN_MIN_PANE
const GRID = "grid grid-cols-[minmax(0,1fr)_300px] gap-x-[40px]";
const PROSE = "text-[15px] leading-[1.75] text-secondary";
const META_TEXT = "text-[10.5px] text-muted";

const ACCENT_BTN =
    "flex cursor-pointer items-center gap-2 rounded-[8px] bg-accent px-3.5 py-[7px] text-[12.5px] font-semibold text-background hover:bg-accenthover disabled:cursor-default disabled:opacity-50";
const SECONDARY_BTN =
    "flex cursor-pointer items-center gap-2 rounded-[8px] border border-edge-mid bg-surface-raised px-3 py-[6px] text-[12.5px] font-semibold text-secondary hover:border-edge-strong hover:bg-surface-hover disabled:cursor-default disabled:opacity-50";
const OFF_BTN =
    "flex cursor-default items-center gap-2 rounded-[8px] bg-surface-hover px-3.5 py-[7px] text-[12.5px] font-semibold text-muted";
const KBD = "rounded-[4px] bg-background/20 px-[5px] font-mono text-[10.5px]";
const CHIP =
    "inline-flex h-[17px] w-[17px] items-center justify-center rounded-full bg-accent text-[10.5px] font-bold leading-none text-background";

// the selection reduced to one paragraph's sentences, and where its Comment button floats
interface CommentTarget {
    section: number;
    paragraph: number;
    first: number;
    last: number;
    text: string;
    top: number;
    left: number;
}

interface ParaInfo {
    section: SectionChange;
    after: ProseSentence[];
}

function splitPath(path: string): { file: string; dir: string } {
    const cut = Math.max(path.lastIndexOf("/"), path.lastIndexOf("\\"));
    return { file: path.slice(cut + 1), dir: cut > 0 ? path.slice(0, cut) : "" };
}

// the paragraph's after sentences in afterIndex order: what data-s and a comment's sentence indices index
function afterSentences(sentences: SentenceChange[]): ProseSentence[] {
    const out: ProseSentence[] = [];
    for (const s of sentences) {
        if (s.after != null && s.afterIndex != null) {
            out[s.afterIndex] = s.after;
        }
    }
    return out;
}

const randomId = () =>
    typeof crypto !== "undefined" && "randomUUID" in crypto ? crypto.randomUUID() : `c${Date.now()}${Math.random()}`;

// Opens a paragraph's source for a suggested edit: the paragraph's existing suggestion again, or a new one anchored
// to the whole paragraph. A suggestion is a draft comment while it is being edited, so nothing sends it half-done.
function startSuggestion(
    agentId: string,
    source: string,
    para: { section: SectionChange; index: number; after: ProseSentence[] },
    existing: ProseComment | undefined
): void {
    if (existing != null) {
        updateComment(agentId, existing.id, { draft: true });
        return;
    }
    if (para.after.length === 0 || para.after.some((s) => s == null)) {
        return;
    }
    const span = paragraphSpan(para.after);
    const from = source.slice(span.start, span.end);
    const anchor = anchorFor(
        source,
        { sectionIndex: para.section.index, label: para.section.label, index: para.index, sentences: para.after },
        0,
        para.after.length - 1,
        ""
    );
    addComment(agentId, {
        ...anchor,
        id: randomId(),
        note: "",
        draft: true,
        suggestion: { from, to: from, old: "", new: "" },
    });
}

// Save: an unchanged paragraph is no suggestion, so it goes; anything else keeps the smallest unique replacement
function saveSuggestion(agentId: string, source: string, c: ProseComment, text: string): void {
    const s = c.suggestion!;
    if (text === s.from) {
        removeComment(agentId, c.id);
        return;
    }
    const r = replacementFor(source, s.from, text);
    updateComment(agentId, c.id, { draft: false, suggestion: { from: s.from, to: text, old: r.old, new: r.new } });
}

// Cancel: a new suggestion goes; one being edited again keeps what it was
function cancelSuggestion(agentId: string, c: ProseComment): void {
    if (c.suggestion!.to === c.suggestion!.from) {
        removeComment(agentId, c.id);
    } else {
        updateComment(agentId, c.id, { draft: false });
    }
}

export function DocReviewPane({ model, agent }: { model: AgentsViewModel; agent: AgentVM }) {
    const state = useAtomValue(docReviewStateAtom(agent.id));
    const kept = useAtomValue(docReviewLoadAtom(agent.id));
    const sentIds = useAtomValue(model.sentIdsAtom);
    const [measureRef, , rect] = useDimensionsWithCallbackRef<HTMLDivElement>();
    const askId = state?.askId;
    const path = state?.path ?? "";
    useEffect(() => {
        if (askId != null) {
            fireAndForget(() => loadDocReview(agent.id, { askId, path, transcriptPath: agent.transcriptPath }));
        }
    }, [agent.id, askId]);
    const load = state != null && kept?.askId === state.askId ? kept : null;
    const diff = useProseDiff(load, state?.doc ?? "markdown");
    if (state == null) {
        return null;
    }
    const review = parseDocReview(agent.ask);
    const sent = sentIds.has(askSentKey(agent) ?? "");
    // before the first measure, assume the wide layout the pane usually has
    const narrow = rect != null && isNarrow(rect.width);
    return (
        <div
            ref={measureRef}
            data-doc-review-pane
            tabIndex={-1}
            className="flex min-h-0 min-w-0 flex-1 flex-col outline-none"
        >
            <Toolbar
                state={state}
                load={load}
                diff={diff}
                narrow={narrow}
                agentId={agent.id}
                pageLimit={review?.pageLimit}
            />
            {state.doc === "latex" && state.tab === "pdf" ? (
                <PdfPanel agentId={agent.id} agentName={agent.name} review={state} sent={sent} />
            ) : (
                <Changes
                    model={model}
                    agent={agent}
                    state={state}
                    load={load}
                    diff={diff}
                    review={review}
                    sent={sent}
                    narrow={narrow}
                />
            )}
            <Tray model={model} agent={agent} state={state} review={review} sent={sent} narrow={narrow} />
        </div>
    );
}

// `+2 −1 · 1 edited · …`, the counts in their diff colours
function Meta({ text }: { text: string }) {
    return (
        <span className="text-[10.5px] tabular-nums text-muted">
            {text.split(/([+−]\d+)/).map((part, i) =>
                /^\+\d+$/.test(part) ? (
                    <span key={i} className="text-diff-added">
                        {part}
                    </span>
                ) : /^−\d+$/.test(part) ? (
                    <span key={i} className="text-diff-removed">
                        {part}
                    </span>
                ) : (
                    part
                )
            )}
        </span>
    );
}

interface ProseDiff {
    sections: SectionChange[];
    after: ProseDoc;
}

function Toolbar(p: {
    state: DocReviewState;
    load: DocReviewLoad | null;
    diff: ProseDiff | null;
    narrow: boolean;
    agentId: string;
    pageLimit?: number;
}) {
    const { state, load, diff } = p;
    const { file, dir } = splitPath(state.path);
    const onChanges = state.doc !== "latex" || state.tab === "changes";
    return (
        <div className={SWAP_BAR}>
            <FileText size={15} strokeWidth={1.8} aria-hidden className="flex-none text-ink-mid" />
            <span className={cn(SWAP_LABEL, "flex-none")}>{file}</span>
            {!p.narrow ? <span className="min-w-0 truncate text-[10.5px] text-muted">{dir}</span> : null}
            {state.doc === "latex" ? (
                <SwapTabs
                    className="ml-[6px]"
                    ariaLabel="Review view"
                    title={`Previous and next tab (${formatChordString("[")} and ${formatChordString("]")})`}
                    value={state.tab}
                    options={[
                        { key: "changes", label: "Changes" },
                        { key: "pdf", label: "PDF" },
                    ]}
                    onChange={(tab) => setDocReviewTab(p.agentId, tab)}
                />
            ) : null}
            {onChanges ? (
                <button
                    type="button"
                    aria-pressed={state.wholeFile}
                    onClick={() => toggleWholeFile(p.agentId)}
                    className={cn(SWAP_BTN, state.wholeFile && SWAP_BTN_ON)}
                >
                    Whole file
                </button>
            ) : null}
            <div className="flex-1" />
            {onChanges && load != null && diff != null ? (
                <Meta text={metaLine(diff.sections, load.from, load.ref, load.reviewedAt)} />
            ) : null}
            {!onChanges ? (
                <PdfToolbar agentId={p.agentId} review={state} pageLimit={p.pageLimit} narrow={p.narrow} />
            ) : null}
        </div>
    );
}

// the reading views and their diff, once per load
function useProseDiff(load: DocReviewLoad | null, doc: DocReviewState["doc"]): ProseDiff | null {
    return useMemo(() => {
        if (load?.current == null) {
            return null;
        }
        const after = toProse(doc, load.current);
        return { sections: diffProse(toProse(doc, load.baseline), after), after };
    }, [load, doc]);
}

function Changes(p: {
    model: AgentsViewModel;
    agent: AgentVM;
    state: DocReviewState;
    load: DocReviewLoad | null;
    diff: ProseDiff | null;
    review: DocReview | null;
    sent: boolean;
    narrow: boolean;
}) {
    const { model, agent, state, load, diff, review, sent, narrow } = p;
    const rows = useMemo(
        () => (diff == null ? [] : reviewRows(diff.sections, state.comments, state.wholeFile)),
        [diff, state.comments, state.wholeFile]
    );
    const numbers = useMemo(() => commentNumbers(state.comments), [state.comments]);
    const scrollRef = useRef<HTMLDivElement>(null);
    const bodyRef = useRef<HTMLDivElement>(null);
    const [sel, setSel] = useState<CommentTarget | null>(null);
    const [pendingScroll, setPendingScroll] = useState<{ sectionIndex: number; paragraph?: number } | null>(null);

    // section:paragraph → what a selection there anchors to
    const paras = useMemo(() => {
        const map = new Map<string, ParaInfo>();
        for (const r of rows) {
            if (r.kind === "paragraph" && r.section.status !== "removed" && r.paragraph.status !== "removed") {
                map.set(`${r.section.index}:${r.paragraph.index}`, {
                    section: r.section,
                    after: afterSentences(r.paragraph.sentences),
                });
            }
        }
        return map;
    }, [rows]);

    // what the selection covers, clipped to its first paragraph, and where its Comment button floats
    useEffect(() => {
        const update = () => {
            const s = window.getSelection();
            const body = bodyRef.current;
            const scroller = scrollRef.current;
            if (sent || s == null || s.isCollapsed || s.rangeCount === 0 || body == null || scroller == null) {
                setSel(null);
                return;
            }
            const range = s.getRangeAt(0);
            if (!body.contains(range.commonAncestorContainer)) {
                setSel(null);
                return;
            }
            const a = selPoint(range.startContainer, "start");
            if (a == null) {
                setSel(null);
                return;
            }
            const b = selPoint(range.endContainer, "end") ?? { ...a, paragraph: Number.MAX_SAFE_INTEGER };
            const info = (sec: number, para: number) => paras.get(`${sec}:${para}`);
            const clip = clipSelection(a, b, (sec, para) => (info(sec, para)?.after.length ?? 1) - 1);
            const para = info(clip.section, clip.paragraph);
            if (para == null) {
                setSel(null);
                return;
            }
            const covered = para.after.slice(clip.first, clip.last + 1);
            const text = clip.clipped ? covered.map((x) => x.text).join(" ") : s.toString().trim();
            const r = range.getBoundingClientRect();
            const box = scroller.getBoundingClientRect();
            setSel({
                section: clip.section,
                paragraph: clip.paragraph,
                first: clip.first,
                last: clip.last,
                text,
                top: r.top - box.top + scroller.scrollTop - 36,
                left: Math.max(0, r.left - box.left + scroller.scrollLeft),
            });
        };
        document.addEventListener("selectionchange", update);
        return () => document.removeEventListener("selectionchange", update);
    }, [paras, sent]);

    const comment = () => {
        const para = sel != null ? paras.get(`${sel.section}:${sel.paragraph}`) : null;
        if (sel == null || para == null || load?.current == null) {
            return;
        }
        const anchor = anchorFor(
            load.current,
            { sectionIndex: sel.section, label: para.section.label, index: sel.paragraph, sentences: para.after },
            sel.first,
            sel.last,
            sel.text
        );
        addComment(agent.id, { ...anchor, id: randomId(), note: "", draft: true });
        window.getSelection()?.removeAllRanges();
        setSel(null);
    };

    // the selection's paragraph, opened for a suggested edit (its existing suggestion if it has one)
    const suggest = () => {
        const para = sel != null ? paras.get(`${sel.section}:${sel.paragraph}`) : null;
        if (sel == null || para == null || load?.current == null) {
            return;
        }
        const existing = state.comments.find(
            (c) => c.suggestion != null && c.sectionIndex === sel.section && c.paragraph === sel.paragraph
        );
        startSuggestion(
            agent.id,
            load.current,
            { section: para.section, index: sel.paragraph, after: para.after },
            existing
        );
        window.getSelection()?.removeAllRanges();
        setSel(null);
    };

    // a focus item or an #anchor names a section that may be folded away: show the whole file, then scroll once
    // it has rendered
    const scrollTo = (target: { sectionIndex: number; paragraph?: number }) => {
        if (!scrollToNode(scrollRef.current, target)) {
            if (!state.wholeFile) {
                toggleWholeFile(agent.id);
            }
            setPendingScroll(target);
        }
    };
    useEffect(() => {
        if (pendingScroll != null && scrollToNode(scrollRef.current, pendingScroll)) {
            setPendingScroll(null);
        }
    }, [pendingScroll, rows]);

    const onLink = (href: string) => {
        if (href.startsWith("#")) {
            const at = diff != null ? anchorTarget(diff.after.sections, href) : null;
            if (at != null) {
                scrollTo({ sectionIndex: at });
            }
        } else if (/^[a-z][a-z0-9+.-]*:/i.test(href) && !/^[a-zA-Z]:[\\/]/.test(href)) {
            fireAndForget(() => openLink(href));
        } else if (href !== "") {
            fireAndForget(() => openFileInCode(model, resolveRelative(state.path, href)));
        }
    };

    const { file } = splitPath(state.path);
    const afterSections = diff?.after.sections ?? [];
    return (
        <div
            ref={scrollRef}
            data-doc-review-scroll
            className="relative min-h-0 flex-1 overflow-y-auto bg-background px-[28px] pb-[28px] pt-[22px]"
        >
            <div ref={bodyRef} className="mx-auto flex max-w-[1000px] flex-col">
                <Head
                    agent={agent}
                    review={review}
                    load={load}
                    saved={state.comments.filter((c) => !c.draft).length}
                    sent={sent}
                    narrow={narrow}
                    onFocus={(text) => {
                        const target = focusTarget(text, afterSections);
                        if (target != null) {
                            scrollTo(target);
                        }
                    }}
                    canFocus={(text) => focusTarget(text, afterSections) != null}
                />
                {load == null ? (
                    <div aria-hidden="true" className="flex flex-col gap-2.5 pt-[26px]">
                        {["w-[45%]", "w-[85%]", "w-[75%]", "w-[60%]", "w-[80%]"].map((w, i) => (
                            <SkeletonLine key={i} className={cn("h-[12px]", w)} />
                        ))}
                    </div>
                ) : load.current == null ? (
                    <div data-doc-review-gone className="flex flex-col gap-1 pt-[26px]">
                        <span className="text-[13px] text-secondary">Couldn't read {file}</span>
                        <span className="break-all text-[11px] text-muted">{state.path}</span>
                    </div>
                ) : (
                    rows.map((row) => (
                        <Row
                            key={row.key}
                            row={row}
                            agentId={agent.id}
                            source={load.current!}
                            path={state.path}
                            numbers={numbers}
                            sent={sent}
                            narrow={narrow}
                            onLink={onLink}
                        />
                    ))
                )}
            </div>
            {sel != null ? (
                <button
                    type="button"
                    data-doc-review-comment
                    title={`Comment on the selection (${formatChordString("c")})`}
                    // keep the selection: a press on the button would otherwise collapse it before the click
                    onMouseDown={(e) => e.preventDefault()}
                    onClick={comment}
                    className="absolute z-10 flex cursor-pointer items-center gap-[6px] rounded-[7px] bg-accent px-[10px] py-[5px] text-[12.5px] font-semibold text-background shadow-lg hover:bg-accenthover"
                    style={{ top: sel.top, left: sel.left }}
                >
                    <MessageSquarePlus size={13} strokeWidth={2.2} aria-hidden />
                    Comment
                    <span className={KBD}>{formatChordString("c")}</span>
                </button>
            ) : null}
            {sel != null ? (
                <button
                    type="button"
                    data-doc-review-edit-sel
                    title={`Suggest an edit to this paragraph's source (${formatChordString("e")})`}
                    onMouseDown={(e) => e.preventDefault()}
                    onClick={suggest}
                    className="absolute z-10 flex cursor-pointer items-center gap-[6px] rounded-[7px] border border-edge-mid bg-surface-raised px-[10px] py-[4px] text-[12.5px] font-semibold text-secondary shadow-lg hover:border-edge-strong hover:text-primary"
                    style={{ top: sel.top, left: sel.left + 128 }}
                >
                    <Pencil size={12} strokeWidth={2.2} aria-hidden />
                    Edit
                    <span className={cn(KBD, "bg-surface-hover")}>{formatChordString("e")}</span>
                </button>
            ) : null}
        </div>
    );
}

// a DOM point in the prose as a sentence: its own `data-s`, or, inside a struck sentence or the gap between two,
// the nearest selectable sentence on the selection's side of it
function selPoint(node: Node, edge: "start" | "end"): SelPoint | null {
    const el = node.nodeType === Node.ELEMENT_NODE ? (node as Element) : node.parentElement;
    const p = el?.closest<HTMLElement>("[data-p]");
    if (el == null || p == null) {
        return null;
    }
    const at = (s: Element): SelPoint => ({
        section: Number(p.dataset.section),
        paragraph: Number(p.dataset.p),
        sentence: Number((s as HTMLElement).dataset.s),
    });
    const own = el.closest("[data-s]");
    if (own != null && p.contains(own)) {
        return at(own);
    }
    const all = [...p.querySelectorAll("[data-s]")];
    const near =
        edge === "start"
            ? all.find((s) => node.compareDocumentPosition(s) & Node.DOCUMENT_POSITION_FOLLOWING)
            : all.reverse().find((s) => node.compareDocumentPosition(s) & Node.DOCUMENT_POSITION_PRECEDING);
    return near != null ? at(near) : null;
}

function scrollToNode(scroller: HTMLElement | null, target: { sectionIndex: number; paragraph?: number }): boolean {
    const node =
        (target.paragraph != null
            ? scroller?.querySelector(`[data-section="${target.sectionIndex}"][data-p="${target.paragraph}"]`)
            : null) ?? scroller?.querySelector(`[data-doc-section="${target.sectionIndex}"]`);
    if (scroller == null || node == null) {
        return false;
    }
    const top = node.getBoundingClientRect().top - scroller.getBoundingClientRect().top + scroller.scrollTop;
    scroller.scrollTo({ top: Math.max(0, top - 12) });
    return true;
}

function Head(p: {
    agent: AgentVM;
    review: DocReview | null;
    load: DocReviewLoad | null;
    saved: number;
    sent: boolean;
    narrow: boolean;
    onFocus: (text: string) => void;
    canFocus: (text: string) => boolean;
}) {
    const items = (p.review?.items ?? []).map(focusItem);
    const numbered = items.filter((i) => i.n != null);
    const chips = items.filter((i) => i.n == null);
    const round = p.load?.round ?? 1;
    return (
        <div className={cn(p.narrow ? "flex flex-col gap-3" : GRID, "border-b border-edge-faint pb-[18px]")}>
            <div className="flex min-w-0 flex-col gap-[10px]">
                <div className="flex items-center gap-2">
                    <span className="h-[7px] w-[7px] rounded-full bg-warning" aria-hidden />
                    <span
                        data-doc-review-eyebrow
                        className="text-[10.5px] font-bold uppercase tracking-[0.1em] text-warning"
                    >
                        {round > 1 ? `Doc review · round ${round}` : "Doc review"}
                    </span>
                    <span className="truncate text-[10.5px] text-muted">
                        · {p.sent ? "" : "waiting on you · "}
                        {p.agent.name}
                    </span>
                </div>
                {(p.review?.intro ?? []).length > 0 ? (
                    <div className="text-[13.5px] leading-[1.55] text-secondary">{p.review!.intro.join(" ")}</div>
                ) : null}
                {numbered.length > 0 ? (
                    <div className="flex flex-col gap-[6px]">
                        {numbered.map((item, i) => (
                            <FocusLink
                                key={i}
                                text={item.text}
                                live={p.canFocus(item.text)}
                                onFocus={p.onFocus}
                                className="flex items-baseline gap-2 text-left text-[13px] text-secondary"
                            >
                                <span className="inline-flex h-[18px] w-[18px] flex-none items-center justify-center rounded-full border border-accent text-[10.5px] font-bold text-accent-soft">
                                    {item.n}
                                </span>
                                {item.text}
                            </FocusLink>
                        ))}
                    </div>
                ) : null}
                {chips.length > 0 ? (
                    <div className="flex flex-wrap gap-2">
                        {chips.map((item, i) => {
                            const lead = leadLabel(item.text);
                            return (
                                <FocusLink
                                    key={i}
                                    text={item.text}
                                    live={p.canFocus(item.text)}
                                    onFocus={p.onFocus}
                                    className="flex items-baseline gap-[7px] rounded-[7px] border border-edge-mid bg-surface-raised px-[10px] py-[5px] text-left text-[12.5px] text-secondary"
                                >
                                    {lead != null ? (
                                        <>
                                            <span className="text-[11px] text-muted">{lead.label}</span>
                                            {lead.rest}
                                        </>
                                    ) : (
                                        item.text
                                    )}
                                </FocusLink>
                            );
                        })}
                    </div>
                ) : null}
            </div>
            <div className="flex flex-col gap-[6px] pt-[2px]">
                <span className="text-[10.5px] font-bold uppercase tabular-nums tracking-[0.1em] text-muted">
                    Your comments · {p.saved}
                </span>
                <span className="text-[12.5px] leading-[1.5] text-muted">
                    {p.load?.from === "previous"
                        ? "Only what changed since your last review is marked."
                        : "Select text in the document to comment on it."}
                </span>
            </div>
        </div>
    );
}

// a focus item that names a section scrolls to it; one that names none is inert
function FocusLink(p: {
    text: string;
    live: boolean;
    onFocus: (text: string) => void;
    className: string;
    children: ReactNode;
}) {
    if (!p.live) {
        return (
            <span data-doc-review-focus="" className={p.className}>
                {p.children}
            </span>
        );
    }
    return (
        <button
            type="button"
            data-doc-review-focus={p.text}
            onClick={() => p.onFocus(p.text)}
            className={cn(p.className, "cursor-pointer hover:border-edge-strong hover:text-primary")}
        >
            {p.children}
        </button>
    );
}

function Row(p: {
    row: ReviewRow;
    agentId: string;
    source: string;
    path: string;
    numbers: Map<string, number>;
    sent: boolean;
    narrow: boolean;
    onLink: (href: string) => void;
}) {
    const { row } = p;
    if (row.kind === "unchanged") {
        return (
            <div data-doc-review-unchanged className="flex items-center gap-[10px] pt-[14px]">
                <span className="text-[11px] text-muted">{row.label}</span>
                <div className="h-px flex-1 bg-edge-mid" />
                <button
                    type="button"
                    onClick={() => toggleWholeFile(p.agentId)}
                    className="cursor-pointer text-[12px] font-semibold text-accent-soft hover:underline"
                >
                    Show whole file
                </button>
            </div>
        );
    }
    if (row.kind === "section") {
        const s = row.section;
        return (
            <div
                data-doc-section={s.status === "removed" ? undefined : s.index}
                className={cn("flex items-baseline gap-[10px] pt-[26px]", s.status === "removed" && DELETED)}
            >
                {showsLabel(s) ? <span className="text-[12px] text-muted">{s.label}</span> : null}
                <h2
                    className={cn(
                        "m-0 text-[18px] font-semibold text-primary",
                        s.status === "added" && INSERTED,
                        s.status === "removed" && "text-ink-mid"
                    )}
                >
                    {s.title}
                </h2>
                {row.stats !== "" ? <span className={cn(META_TEXT, "whitespace-nowrap")}>{row.stats}</span> : null}
            </div>
        );
    }
    return <ParagraphRow {...p} row={row} />;
}

function ParagraphRow(p: {
    row: Extract<ReviewRow, { kind: "paragraph" }>;
    agentId: string;
    source: string;
    path: string;
    numbers: Map<string, number>;
    sent: boolean;
    narrow: boolean;
    onLink: (href: string) => void;
}) {
    const { section, paragraph, comments } = p.row;
    const selectable = section.status !== "removed" && paragraph.status !== "removed";
    const marks = sentenceMarks(comments, p.numbers);
    const shown = p.sent ? comments.filter((c) => !c.draft) : comments;
    // one suggestion per paragraph: the pencil reopens it rather than starting a second
    const suggestion = comments.find((c) => c.suggestion != null);
    const editing = suggestion != null && suggestion.draft && !p.sent;
    const [text, setText] = useState("");
    useEffect(() => {
        if (editing) {
            setText(suggestion.suggestion!.to);
        }
    }, [editing]);
    const save = () => saveSuggestion(p.agentId, p.source, suggestion!, text);
    const cancel = () => cancelSuggestion(p.agentId, suggestion!);
    const edit = () =>
        startSuggestion(
            p.agentId,
            p.source,
            { section, index: paragraph.index, after: afterSentences(paragraph.sentences) },
            suggestion
        );
    const sentences = paragraph.sentences.map((change, k) => (
        <SentenceView
            key={k}
            change={change}
            mark={change.afterIndex != null ? marks.get(change.afterIndex) : undefined}
            last={k === paragraph.sentences.length - 1}
            path={p.path}
            onLink={p.onLink}
        />
    ));
    return (
        <div className={cn(p.narrow ? "flex flex-col gap-[10px]" : cn(GRID, "items-start"), "pt-[14px]")}>
            {editing ? (
                // the paragraph's own source, LaTeX or markdown as it is in the file; the view cannot be edited in
                // place because it drops the markup (spec: doc-review suggested edits, decision 2)
                <div data-doc-review-draft className="min-w-0">
                    <textarea
                        data-doc-review-edit-box
                        autoFocus
                        value={text}
                        rows={Math.min(16, Math.max(4, Math.ceil(text.length / 80) + text.split("\n").length))}
                        onChange={(e) => setText(e.target.value)}
                        onKeyDown={(e) => {
                            if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) {
                                e.preventDefault();
                                save();
                            } else if (e.key === "Escape") {
                                e.preventDefault();
                                e.stopPropagation();
                                cancel();
                            }
                        }}
                        className="w-full resize-y rounded-[7px] border border-accent bg-surface-code px-[10px] py-[8px] font-mono text-[12.5px] leading-[1.6] text-primary outline-none"
                    />
                </div>
            ) : (
                <div
                    data-section={selectable ? section.index : undefined}
                    data-p={selectable ? paragraph.index : undefined}
                    className={cn("group/para relative min-w-0", PROSE)}
                >
                    {paragraph.list ? (
                        <ul className="m-0 list-disc pl-[22px]">
                            <li>{sentences}</li>
                        </ul>
                    ) : (
                        sentences
                    )}
                    {selectable && !p.sent ? (
                        <button
                            type="button"
                            data-doc-review-edit
                            title="Suggest an edit to this paragraph's source"
                            aria-label="Suggest an edit to this paragraph"
                            onClick={edit}
                            className="absolute -left-[26px] top-[6px] hidden cursor-pointer rounded-[5px] p-[3px] text-muted hover:bg-surface-hover hover:text-primary group-hover/para:flex"
                        >
                            <Pencil size={13} strokeWidth={2} aria-hidden />
                        </button>
                    ) : null}
                </div>
            )}
            <div className="flex min-w-0 flex-col gap-[10px]">
                {shown.map((c) =>
                    c.suggestion != null ? (
                        <SuggestionCard
                            key={c.id}
                            comment={c}
                            n={p.numbers.get(c.id) ?? 0}
                            agentId={p.agentId}
                            sent={p.sent}
                            text={text}
                            onSave={save}
                            onCancel={cancel}
                            onEdit={edit}
                        />
                    ) : (
                        <CommentCard
                            key={c.id}
                            comment={c}
                            n={p.numbers.get(c.id) ?? 0}
                            agentId={p.agentId}
                            sent={p.sent}
                        />
                    )
                )}
            </div>
        </div>
    );
}

// A suggested edit beside its paragraph: while editing, Save and Cancel and an optional note; once saved, the change
// word by word and the note, with Edit and remove.
function SuggestionCard(p: {
    comment: ProseComment;
    n: number;
    agentId: string;
    sent: boolean;
    text: string;
    onSave: () => void;
    onCancel: () => void;
    onEdit: () => void;
}) {
    const { comment, n } = p;
    const s = comment.suggestion!;
    const head = (
        <div className="flex items-center gap-2">
            <span className={cn(CHIP, "h-[18px] w-[18px]")}>{n}</span>
            <span className={META_TEXT}>
                {comment.sectionLabel} ¶{comment.paragraph} · suggested edit
            </span>
            <div className="flex-1" />
            {!comment.draft && !p.sent ? (
                <>
                    <button
                        type="button"
                        aria-label={`Edit suggestion ${n}`}
                        onClick={p.onEdit}
                        className="flex cursor-pointer p-[2px] text-muted hover:text-primary"
                    >
                        <Pencil size={12} strokeWidth={2} aria-hidden />
                    </button>
                    <button
                        type="button"
                        aria-label={`Remove suggestion ${n}`}
                        onClick={() => removeComment(p.agentId, comment.id)}
                        className="flex cursor-pointer p-[2px] text-muted hover:text-primary"
                    >
                        <X size={13} strokeWidth={2} aria-hidden />
                    </button>
                </>
            ) : null}
        </div>
    );
    if (!comment.draft || p.sent) {
        return (
            <div
                data-doc-review-card={comment.id}
                data-doc-review-suggestion
                className="flex flex-col gap-[6px] rounded-[8px] border border-edge-mid bg-surface-raised px-3 py-[10px]"
            >
                {head}
                <div className="whitespace-pre-wrap break-words font-mono text-[11.5px] leading-[1.55] text-secondary">
                    {wordDiff(s.from, s.to).map((w, i) => (
                        <span
                            key={i}
                            className={w.op === "delete" ? DELETED : w.op === "insert" ? INSERTED : undefined}
                        >
                            {w.text}
                        </span>
                    ))}
                </div>
                {comment.note !== "" ? (
                    <div className="whitespace-pre-wrap text-[13px] leading-[1.5] text-primary">{comment.note}</div>
                ) : null}
            </div>
        );
    }
    return (
        <div
            data-doc-review-card={comment.id}
            data-doc-review-draft
            className="flex flex-col gap-2 rounded-[8px] border border-accent bg-surface-raised px-3 py-[10px]"
        >
            {head}
            <div className="text-[11.5px] leading-[1.45] text-muted">
                Edit the source on the left. The file is not changed: {formatChordString("Mod:Enter")} saves this as a
                suggestion the agent applies.
            </div>
            <textarea
                rows={2}
                value={comment.note}
                placeholder="A note for the agent (optional)"
                onChange={(e) => updateComment(p.agentId, comment.id, { note: e.target.value })}
                onKeyDown={(e) => {
                    if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) {
                        e.preventDefault();
                        p.onSave();
                    }
                }}
                className="resize-none rounded-[7px] border border-edge-mid bg-background px-[9px] py-[7px] text-[13px] leading-[1.5] text-primary outline-none placeholder:text-muted focus:border-accent"
            />
            <div className="flex gap-2">
                <button
                    type="button"
                    data-doc-review-edit-save
                    disabled={p.text === s.from}
                    onClick={p.onSave}
                    className={cn(ACCENT_BTN, "px-[11px] py-[5px] text-[12px]")}
                >
                    Save suggestion
                </button>
                <button
                    type="button"
                    onClick={p.onCancel}
                    className={cn(SECONDARY_BTN, "px-[11px] py-[5px] text-[12px]")}
                >
                    Cancel
                </button>
            </div>
        </div>
    );
}

function SentenceView(p: {
    change: SentenceChange;
    mark?: SentenceMark;
    last: boolean;
    path: string;
    onLink: (href: string) => void;
}) {
    const { change, mark } = p;
    const figure = imageMark(change);
    if (figure != null) {
        return <ImageFigure mark={figure} path={p.path} afterIndex={change.afterIndex} />;
    }
    let tokens: OpToken[];
    if (change.op === "modify") {
        tokens = (change.words ?? []).map((w) => ({ token: w.token, op: w.op }));
    } else {
        const op = change.op === "insert" ? "insert" : change.op === "delete" ? "delete" : "same";
        tokens = (change.after ?? change.before)!.tokens.map((token) => ({ token, op }));
    }
    const image = (alt: string, src: string) => <InlineImage alt={alt} src={src} path={p.path} />;
    const body = <ProseTokens tokens={tokens} onLink={p.onLink} image={image} />;
    const underline =
        mark != null ? cn("border-b-2 border-accent pb-px", mark.draft ? "border-dashed" : "border-solid") : undefined;
    return (
        <>
            {change.op === "delete" ? (
                // a struck sentence is not in the after-document, so it has no data-s and can't be commented on
                <span data-op="delete" className={DELETED}>
                    {body}
                </span>
            ) : (
                <span data-s={change.afterIndex} data-op={change.op} className={underline}>
                    {body}
                </span>
            )}
            {mark?.chips.map((n) => (
                <span key={n} className={cn(CHIP, "ml-[3px] align-[2px]")}>
                    {n}
                </span>
            ))}
            {p.last ? null : " "}
        </>
    );
}

function useImage(path: string): ImageData | null {
    const [data, setData] = useState<ImageData | null>(null);
    useEffect(() => {
        let alive = true;
        setData(null);
        fireAndForget(async () => {
            const d = await loadImage(path);
            if (alive) {
                setData(d);
            }
        });
        return () => {
            alive = false;
        };
    }, [path]);
    return data;
}

function ImageFallback({ alt, path }: { alt: string; path: string }) {
    return (
        <span
            data-doc-review-image-fallback
            className="inline-flex max-w-full flex-col gap-1 rounded-[8px] border border-edge-mid px-3 py-2 align-top"
        >
            <span className="text-[12.5px] text-secondary">{alt || "Image"}</span>
            <span className="break-all text-[11px] text-muted">{path}</span>
        </span>
    );
}

// An image a note links is read over RPC and drawn as a data URL on the light matte; one that can't be (an unknown
// type, too large, unreadable) shows its alt text and path instead.
function ImageBody({ alt, src, path, added }: { alt: string; src: string; path: string; added: boolean }) {
    const abs = /^https?:/i.test(src) ? src : resolveRelative(path, src);
    const data = useImage(abs);
    if (data != null && !data.ok) {
        return <ImageFallback alt={alt} path={abs} />;
    }
    return (
        <span
            className={cn(
                "block rounded-[8px] bg-imagematte p-[14px]",
                added && "border border-diff-added/55",
                data == null && "min-h-[80px]"
            )}
        >
            {data?.ok ? <img src={data.url} alt={alt} className="block h-auto max-w-full" /> : null}
        </span>
    );
}

function InlineImage({ alt, src, path }: { alt: string; src: string; path: string }) {
    return (
        <span className="my-[6px] inline-block max-w-full align-middle">
            <ImageBody alt={alt} src={src} path={path} added={false} />
        </span>
    );
}

// a sentence that is only an image: a figure, captioned when the image was added or removed
function ImageFigure({ mark, path, afterIndex }: { mark: ImageMark; path: string; afterIndex?: number }) {
    return (
        <span
            data-doc-review-image={mark.kind}
            data-s={mark.kind === "removed" ? undefined : afterIndex}
            className="my-[6px] flex flex-col gap-[6px]"
        >
            {mark.kind === "added" ? (
                <span className="text-[10.5px] text-diff-added">+ image · {mark.src}</span>
            ) : mark.kind === "removed" ? (
                <span className="text-[10.5px] text-diff-removed">− image · {mark.src}</span>
            ) : null}
            {mark.kind !== "removed" ? (
                <ImageBody alt={mark.alt} src={mark.src} path={path} added={mark.kind === "added"} />
            ) : null}
        </span>
    );
}

function CommentCard({
    comment,
    n,
    agentId,
    sent,
}: {
    comment: ProseComment;
    n: number;
    agentId: string;
    sent: boolean;
}) {
    const loc = `${comment.sectionLabel} ¶${comment.paragraph}`;
    const head = (
        <div className="flex items-center gap-2">
            <span className={cn(CHIP, "h-[18px] w-[18px]")}>{n}</span>
            <span className={META_TEXT}>{loc}</span>
            <div className="flex-1" />
            {!comment.draft && !sent ? (
                <button
                    type="button"
                    aria-label={`Remove comment ${n}`}
                    onClick={() => removeComment(agentId, comment.id)}
                    className="flex cursor-pointer p-[2px] text-muted hover:text-primary"
                >
                    <X size={13} strokeWidth={2} aria-hidden />
                </button>
            ) : null}
        </div>
    );
    const quote = <div className="text-[11px] leading-[1.45] text-muted">"{comment.quote}"</div>;
    if (!comment.draft) {
        return (
            <div
                data-doc-review-card={comment.id}
                className="flex flex-col gap-[6px] rounded-[8px] border border-edge-mid bg-surface-raised px-3 py-[10px]"
            >
                {head}
                {quote}
                <div className="whitespace-pre-wrap text-[13px] leading-[1.5] text-primary">{comment.note}</div>
            </div>
        );
    }
    const add = () => {
        if (comment.note.trim() !== "") {
            updateComment(agentId, comment.id, { note: comment.note.trim(), draft: false });
        }
    };
    return (
        <div
            data-doc-review-card={comment.id}
            data-doc-review-draft
            className="flex flex-col gap-2 rounded-[8px] border border-accent bg-surface-raised px-3 py-[10px]"
        >
            {head}
            {quote}
            <label className="flex flex-col gap-1 text-[12px] font-semibold text-secondary">
                What should change here?
                <textarea
                    rows={3}
                    autoFocus
                    value={comment.note}
                    placeholder="Your comment"
                    onChange={(e) => updateComment(agentId, comment.id, { note: e.target.value })}
                    // the tray's Ctrl+Enter stands down inside a draft (data-doc-review-draft), so it adds this one
                    onKeyDown={(e) => {
                        if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) {
                            e.preventDefault();
                            add();
                        }
                    }}
                    className="resize-none rounded-[7px] border border-edge-mid bg-background px-[9px] py-[7px] text-[13px] font-normal leading-[1.5] text-primary outline-none placeholder:text-muted focus:border-accent"
                />
            </label>
            <div className="flex gap-2">
                <button
                    type="button"
                    disabled={comment.note.trim() === ""}
                    onClick={add}
                    className={cn(ACCENT_BTN, "px-[11px] py-[5px] text-[12px]")}
                >
                    Add comment
                </button>
                <button
                    type="button"
                    onClick={() => removeComment(agentId, comment.id)}
                    className={cn(SECONDARY_BTN, "px-[11px] py-[5px] text-[12px]")}
                >
                    Cancel
                </button>
            </div>
        </div>
    );
}

function Tray(p: {
    model: AgentsViewModel;
    agent: AgentVM;
    state: DocReviewState;
    review: DocReview | null;
    sent: boolean;
    narrow: boolean;
}) {
    const { model, agent, state, review } = p;
    const line = sentLine(state.lastSend, p.sent, agent.name);
    if (line != null) {
        const cut = line.indexOf(" · ");
        return (
            <div
                data-doc-review-sent
                className="flex flex-none items-center gap-2 border-t border-border bg-surface px-[22px] py-[14px] text-[12.5px] text-success"
            >
                <Check size={14} strokeWidth={2.2} aria-hidden />
                <span className="font-semibold">{line.slice(0, cut)}</span>
                <span className="text-muted">{line.slice(cut)}</span>
            </div>
        );
    }
    const tray = trayState(state.comments, state.generalNote, agent.name);
    const approveIndex = review?.approveIndex ?? -1;
    const requestIndex = review?.requestIndex ?? -1;
    // the tray records what it tried to send; the sent line waits for the ask to read as sent (sentIdsAtom)
    const approve = () => {
        if (approveIndex < 0) {
            return;
        }
        setLastSend(agent.id, { kind: "approve", comments: 0 });
        if (!globalStore.get(model.answerSelAtom)[agent.id]?.[QI]?.has(approveIndex)) {
            model.toggleAnswer(agent.id, QI, approveIndex);
        }
        model.submitAnswer(agent.id);
    };
    const request = () => {
        if (requestIndex < 0 || !tray.requestEnabled) {
            return;
        }
        setLastSend(agent.id, { kind: "request", comments: tray.saved });
        model.setAnswerText(agent.id, QI, formatRequest(state.comments, state.generalNote));
        model.submitAnswer(agent.id);
    };
    const kbd = <span className={KBD}>{formatChordString("Mod:Enter")}</span>;
    const buttons = (
        <div className="flex flex-none items-center gap-[10px]">
            <AnswerButtons
                tray={tray}
                approveOk={approveIndex >= 0}
                requestOk={requestIndex >= 0}
                kbd={kbd}
                onApprove={approve}
                onRequest={request}
            />
        </div>
    );
    const note = (
        <label className="flex min-w-0 flex-1 flex-col gap-[6px] text-[12px] font-semibold text-secondary">
            General note
            <input
                data-doc-review-note
                value={state.generalNote}
                onChange={(e) => setGeneralNote(agent.id, e.target.value)}
                placeholder="Anything not tied to one passage (optional)"
                className="rounded-[7px] border border-edge-mid bg-surface-raised px-[10px] py-[7px] text-[13px] font-normal text-primary outline-none placeholder:text-muted focus:border-accent"
            />
        </label>
    );
    const hint = <span className="min-w-0 text-[12px] text-muted">{tray.hint}</span>;
    if (p.narrow) {
        return (
            <div
                data-doc-review-tray
                className="flex flex-none flex-col gap-[10px] border-t border-border bg-surface px-[22px] py-[12px]"
            >
                {note}
                <div className="flex items-center gap-[10px]">
                    <div className="flex min-w-0 flex-1">{hint}</div>
                    {buttons}
                </div>
            </div>
        );
    }
    return (
        <div
            data-doc-review-tray
            className="flex flex-none items-start gap-[16px] border-t border-border bg-surface px-[22px] py-[12px]"
        >
            {note}
            <div className="flex flex-none flex-col items-end gap-[6px]">
                {buttons}
                {hint}
            </div>
        </div>
    );
}

// The accent answer carries the Ctrl+Enter chip and data-doc-review-send, which the key clicks.
function AnswerButtons(p: {
    tray: TrayState;
    approveOk: boolean;
    requestOk: boolean;
    kbd: ReactNode;
    onApprove: () => void;
    onRequest: () => void;
}) {
    if (p.tray.accent === "approve") {
        return (
            <>
                <button
                    type="button"
                    data-doc-review-send
                    disabled={!p.approveOk}
                    onClick={p.onApprove}
                    className={ACCENT_BTN}
                >
                    Approve
                    {p.kbd}
                </button>
                <button type="button" disabled className={OFF_BTN}>
                    Request changes
                </button>
            </>
        );
    }
    return (
        <>
            <button type="button" disabled={!p.approveOk} onClick={p.onApprove} className={SECONDARY_BTN}>
                Approve
            </button>
            <button
                type="button"
                data-doc-review-send
                disabled={!p.requestOk}
                onClick={p.onRequest}
                className={ACCENT_BTN}
            >
                Request changes
                <span className="min-w-[16px] rounded-full bg-background px-[5px] text-center text-[10.5px] text-accent-soft">
                    {p.tray.saved}
                </span>
                {p.kbd}
            </button>
        </>
    );
}
