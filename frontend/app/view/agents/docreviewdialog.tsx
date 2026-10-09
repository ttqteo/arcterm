// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0
//
// A lead's Spec review / Plan review ask as one dialog: the document (or, for a mockup-settled spec, the canvas)
// on the left, what the lead asks you to accept on the right, the answer at the bottom. Mounted once in
// CockpitShell so it opens over any surface; docReviewAtom names the asking agent. Hiding it leaves the ask open, and it closes itself once the ask is
// answered or cleared.

import { pushToast } from "@/app/cockpit/notificationstore";
import { openFileInCode } from "@/app/cockpit/openfilestore";
import { SkeletonLine } from "@/app/element/skeleton";
import { ModalShell } from "@/app/modals/modalshell";
import { globalStore } from "@/app/store/jotaiStore";
import { formatChordString } from "@/util/keysym";
import { cn, fireAndForget } from "@/util/util";
import { useAtomValue } from "jotai";
import { ArrowUpRight, Check, FileText, SquareDashed, X, type LucideIcon } from "lucide-react";
import { useEffect, useRef, useState, type ReactNode, type RefObject } from "react";
import { openTarget } from "../jarvis/openref";
import { ICON_BTN } from "./agentheader";
import type { AgentsViewModel } from "./agents";
import { askSentKey, type AgentVM } from "./agentsviewmodel";
import { cleanLabel } from "./answerbar";
import { parseCanvasPath } from "./canvasmodel";
import { canvasOwner } from "./canvasstore";
import { docReviewAtom, parseDocReview, type DocReview, type DocReviewKind } from "./docreview";
import { findingRef, taskOfHeading, type FindingRef } from "./docreviewlinks";
import {
    addNote,
    composeAnswer,
    docNotesAtom,
    notesCopy,
    removeNote,
    setNoteText,
    type DocNote,
    type DocNotesState,
    type DocReviewSent,
} from "./docreviewnotes";
import { NoteField, NotesSection, readSelection, useDocHighlights, type PendingPassage } from "./docreviewnotesview";
import { MarkdownMessage } from "./markdownmessage";
import { useFileText } from "./usefiletext";

// a doc review is always the ask's only question
const QI = 0;

// A Doc review has its own view in place of the agent's terminal; the dialog serves Spec review and Plan review.
type DialogKind = Exclude<DocReviewKind, "doc">;
type DialogReview = DocReview & { kind: DialogKind };
const isDialogReview = (r: DocReview | null): r is DialogReview => r != null && r.kind !== "doc";

const COPY: Record<DialogKind, { eyebrow: string; title: string; list: string; approve: string; placeholder: string }> =
    {
        spec: {
            eyebrow: "Spec review",
            title: "Review the spec before I write the plan",
            list: "Decisions in it",
            approve: "Approve",
            placeholder: "What to change in the spec",
        },
        plan: {
            eyebrow: "Plan review · round 2 failed",
            title: "The plan review failed twice. Proceed with these fixes?",
            list: "Findings",
            approve: "Accept all and proceed",
            placeholder: "Which finding to handle differently, and how",
        },
    };

const REQUEST_SENT = "Request changes, with your note";

const PRIMARY_BTN =
    "flex cursor-pointer items-center gap-2 rounded-[8px] bg-accent px-3.5 py-[7px] text-[12.5px] font-semibold text-background hover:bg-accenthover disabled:cursor-default disabled:opacity-50";
const SECONDARY_BTN =
    "flex cursor-pointer items-center gap-2 rounded-[8px] border border-edge-mid bg-surface-raised px-3 py-[6px] text-[12.5px] font-semibold text-secondary hover:border-edge-strong hover:bg-surface-hover";

const closeDialog = () => globalStore.set(docReviewAtom, null);

// a finding shows its place once the pointer rests on it, so sweeping down the list does not scroll the document
const HOVER_DELAY_MS = 120;
const FOCUS_ATTR = "data-doc-focus";
const FOCUSING_ATTR = "data-doc-focusing";
const SCROLL_MARGIN = 12;

const headingLevel = (el: Element) => (/^H[1-6]$/.test(el.tagName) ? Number(el.tagName[1]) : null);

// The rendered markdown's top-level blocks a finding names: each task's heading through the line before the next
// heading at its level or above, or else the first block that mentions one of its code terms.
function focusBlocks(md: Element, ref: FindingRef): Element[] {
    const top = [...md.children];
    const out: Element[] = [];
    for (const n of ref.tasks) {
        const at = top.findIndex((el) => headingLevel(el) != null && taskOfHeading(el.textContent ?? "") === n);
        if (at < 0) {
            continue;
        }
        const level = headingLevel(top[at]);
        out.push(top[at]);
        for (const el of top.slice(at + 1)) {
            const l = headingLevel(el);
            if (l != null && l <= level) {
                break;
            }
            out.push(el);
        }
    }
    if (out.length > 0) {
        return out;
    }
    for (const term of ref.terms) {
        const block = top.find((el) => el.textContent?.includes(term));
        if (block) {
            return [block];
        }
    }
    return [];
}

function scrollToBlock(scroller: HTMLElement, el: Element) {
    const box = scroller.getBoundingClientRect();
    // the dialog scales while it opens, and rects are measured scaled
    const scale = box.width / scroller.offsetWidth || 1;
    const top = (el.getBoundingClientRect().top - box.top) / scale + scroller.scrollTop - SCROLL_MARGIN;
    scroller.scrollTo({ top: Math.max(0, top), behavior: "smooth" });
}

// The finding in focus keeps its blocks and dims the rest of the document (tailwindsetup.css), scrolled to them.
function useFindingFocus(
    scrollRef: RefObject<HTMLElement | null>,
    docRef: RefObject<HTMLElement | null>,
    focus: string | null,
    textKey: string
) {
    useEffect(() => {
        const md = docRef.current?.firstElementChild;
        const scroller = scrollRef.current;
        if (focus == null || md == null || scroller == null) {
            return;
        }
        const blocks = focusBlocks(md, findingRef(focus));
        if (blocks.length === 0) {
            return;
        }
        md.setAttribute(FOCUSING_ATTR, "");
        blocks.forEach((b) => b.setAttribute(FOCUS_ATTR, ""));
        scrollToBlock(scroller, blocks[0]);
        return () => {
            md.removeAttribute(FOCUSING_ATTR);
            blocks.forEach((b) => b.removeAttribute(FOCUS_ATTR));
        };
    }, [focus, textKey]);
}

const NO_NOTES: DocNote[] = [];

function patchNotes(askId: string, patch: Partial<DocNotesState>) {
    const all = globalStore.get(docNotesAtom);
    globalStore.set(docNotesAtom, { ...all, [askId]: { notes: NO_NOTES, ...all[askId], ...patch } });
}

// what the document pane needs to quote passages; the canvas pane has nothing to quote
interface Quoting {
    notes: DocNote[];
    pending: PendingPassage | null;
    draft: string;
    onSelect: (p: PendingPassage) => void;
    onDraft: (v: string) => void;
    onAdd: () => void;
    onCancel: () => void;
}

// Lands on the agent that already shows the canvas. When none does, the lead's terminal attaches it first, as
// the lead's own `wsh ui reveal` would, so the open has an agent to land on.
async function openCanvasBoard(model: AgentsViewModel, lead: AgentVM, path: string): Promise<void> {
    const canvas = parseCanvasPath(path);
    if (canvas == null) {
        pushToast({ title: `Not a design canvas board: ${path}`, message: "", level: "warn" });
        return;
    }
    const target = { kind: "canvas", topic: canvas.topic, board: canvas.board } as const;
    if (canvasOwner(canvas.topic) == null && lead.blockId != null) {
        const attached = await openTarget(model, target, undefined, { blockId: lead.blockId, cwd: canvas.cwd });
        if ("reason" in attached) {
            return;
        }
    }
    await openTarget(model, target);
}

export function DocReviewDialog({ model }: { model: AgentsViewModel }) {
    const id = useAtomValue(docReviewAtom);
    const agents = useAtomValue(model.agentsAtom);
    const sentIds = useAtomValue(model.sentIdsAtom);
    const selections = useAtomValue(model.answerSelAtom);
    const texts = useAtomValue(model.answerTextAtom);
    const agent = id != null ? agents.find((a) => a.id === id) : undefined;
    const parsed = parseDocReview(agent?.ask);
    const review = isDialogReview(parsed) ? parsed : null;
    const askId = agent?.ask?.askId;
    const notesEntry = useAtomValue(docNotesAtom)[askId ?? ""];
    const notes = notesEntry?.notes ?? NO_NOTES;
    const [requesting, setRequesting] = useState(false);
    const [note, setNote] = useState("");
    const [pending, setPending] = useState<PendingPassage | null>(null);
    const [draft, setDraft] = useState("");
    const [openId, setOpenId] = useState<string | null>(null);
    const [collapsed, setCollapsed] = useState(false);
    const [hoverIdx, setHoverIdx] = useState<number | null>(null);
    const [pinIdx, setPinIdx] = useState<number | null>(null);
    const focusIdx = hoverIdx ?? pinIdx;

    // the ask was answered or cleared (or the agent is gone, or it is a Doc review): nothing left for the dialog
    useEffect(() => {
        if (id != null && review == null) {
            closeDialog();
        }
    }, [id, review == null]);

    const dropPending = () => {
        setPending(null);
        setDraft("");
    };

    useEffect(() => {
        setRequesting(false);
        setNote("");
        dropPending();
        setOpenId(null);
        setCollapsed(false);
        setHoverIdx(null);
        setPinIdx(null);
    }, [askId]);

    const sent = agent != null && sentIds.has(askSentKey(agent) ?? "");
    const approveLabel = cleanLabel(
        agent?.ask?.questions?.[QI]?.options?.[review?.approveIndex ?? -1]?.label ??
            (review ? COPY[review.kind].approve : "")
    );
    const copy = notesCopy({
        count: notes.length,
        approveLabel,
        placeholder: review ? COPY[review.kind].placeholder : "",
    });

    // the passage still in the note field joins the notes, so adding it and sending both keep its draft
    const takePending = (): DocNote[] => {
        if (pending == null || askId == null) {
            return notes;
        }
        const next = addNote(notes, { ...pending, note: draft });
        patchNotes(askId, { notes: next });
        dropPending();
        return next;
    };
    const submit = (agentId: string, kind: DocReviewSent) => {
        model.submitAnswer(agentId);
        if (askId != null && globalStore.get(model.sentIdsAtom).has(askId)) {
            patchNotes(askId, { sent: kind });
        }
        setRequesting(false);
    };
    const approve = () => {
        if (!agent || !review || sent || review.approveIndex < 0) {
            return;
        }
        const all = takePending();
        if (all.length > 0) {
            model.setAnswerText(
                agent.id,
                QI,
                composeAnswer({ kind: "approve", approveLabel, message: "", notes: all })
            );
        } else if (!selections[agent.id]?.[QI]?.has(review.approveIndex)) {
            model.toggleAnswer(agent.id, QI, review.approveIndex);
        }
        submit(agent.id, "approve");
    };
    const sendNote = () => {
        if (!agent || sent) {
            return;
        }
        const text = composeAnswer({ kind: "request", approveLabel, message: note, notes: takePending() });
        if (!text) {
            return;
        }
        model.setAnswerText(agent.id, QI, text);
        submit(agent.id, "request");
    };

    let sentLabel = "";
    if (sent && agent && review) {
        const text = (texts[agent.id]?.[QI] ?? "").trim();
        const oi = [...(selections[agent.id]?.[QI] ?? [])][0];
        if (notes.length > 0 && notesEntry?.sent != null) {
            sentLabel = notesEntry.sent === "approve" ? copy.sentApprove : copy.sentRequest;
        } else {
            sentLabel = text ? REQUEST_SENT : cleanLabel(agent.ask?.questions?.[QI]?.options?.[oi]?.label ?? "");
        }
    }

    const quoting: Quoting = {
        notes,
        pending: sent ? null : pending,
        draft,
        onSelect: (p) => {
            if (sent || askId == null) {
                return;
            }
            setPending(p);
            setDraft("");
        },
        onDraft: setDraft,
        onAdd: takePending,
        onCancel: dropPending,
    };

    return (
        <ModalShell
            open={agent != null && review != null}
            onClose={closeDialog}
            onSubmit={requesting ? sendNote : approve}
            variant="dialog"
            align="center"
            className="flex h-[min(870px,calc(100vh-5rem))] w-[min(1240px,calc(100vw-5rem))] flex-col"
        >
            {agent && review ? (
                <>
                    <Header agent={agent} review={review} />
                    <div className="flex min-h-0 flex-1">
                        {review.doc === "canvas" ? (
                            <CanvasPane
                                path={review.path}
                                onOpen={() => {
                                    closeDialog();
                                    fireAndForget(() => openCanvasBoard(model, agent, review.path));
                                }}
                            />
                        ) : (
                            <DocumentPane
                                path={review.path}
                                quoting={quoting}
                                focus={focusIdx != null ? (review.items[focusIdx] ?? null) : null}
                                onOpen={() => {
                                    closeDialog();
                                    fireAndForget(() => openFileInCode(model, review.path));
                                }}
                            />
                        )}
                        <AskPane
                            review={review}
                            focusIdx={review.doc === "canvas" ? null : focusIdx}
                            pinIdx={pinIdx}
                            onHover={setHoverIdx}
                            onPin={(i) => setPinIdx((pin) => (pin === i ? null : i))}
                        >
                            {review.doc === "canvas" || askId == null ? null : (
                                <NotesSection
                                    notes={notes}
                                    openId={openId}
                                    collapsed={collapsed}
                                    locked={sent}
                                    onCollapse={setCollapsed}
                                    onOpen={setOpenId}
                                    onText={(noteId, v) => patchNotes(askId, { notes: setNoteText(notes, noteId, v) })}
                                    onRemove={(noteId) => {
                                        patchNotes(askId, { notes: removeNote(notes, noteId) });
                                        // ids are reused, so a later note must not inherit the open row
                                        setOpenId((open) => (open === noteId ? null : open));
                                    }}
                                />
                            )}
                        </AskPane>
                    </div>
                    <Footer
                        review={review}
                        copy={copy}
                        canSend={note.trim() !== "" || notes.length > 0}
                        sentLabel={sent ? sentLabel || "Answered" : null}
                        requesting={requesting}
                        note={note}
                        onNote={setNote}
                        onApprove={approve}
                        onRequest={() => setRequesting(true)}
                        onCancel={() => setRequesting(false)}
                        onSend={sendNote}
                    />
                </>
            ) : null}
        </ModalShell>
    );
}

function Header({ agent, review }: { agent: AgentVM; review: DialogReview }) {
    const copy = COPY[review.kind];
    return (
        <div
            data-doc-review={review.kind}
            className="flex flex-none flex-col gap-2 border-b border-edge-mid px-[22px] pb-3.5 pt-4"
        >
            <div className="flex items-center gap-2">
                <span className="h-[7px] w-[7px] rounded-full bg-warning" aria-hidden />
                <span className="text-[10.5px] font-bold uppercase tracking-[0.1em] text-warning">{copy.eyebrow}</span>
                <span className="truncate text-[10.5px] text-muted">· waiting on you · {agent.name}</span>
                <div className="flex-1" />
                <button
                    type="button"
                    onClick={closeDialog}
                    aria-label="Hide the review (Esc)"
                    title="Hide the review (Esc)"
                    className={cn(ICON_BTN, "leading-none")}
                >
                    <X size={14} aria-hidden />
                </button>
            </div>
            <div className="text-[18px] font-semibold leading-[1.35] text-primary">{copy.title}</div>
        </div>
    );
}

function splitPath(path: string): { file: string; dir: string } {
    const cut = Math.max(path.lastIndexOf("/"), path.lastIndexOf("\\"));
    return { file: path.slice(cut + 1), dir: cut > 0 ? path.slice(0, cut) : "" };
}

function FileCard(p: { path: string; icon: LucideIcon; action: string; onOpen: () => void }) {
    const { file, dir } = splitPath(p.path);
    return (
        <div className="flex-none border-b border-edge-faint px-[22px] py-3">
            <div className="flex items-center gap-2.5 rounded-[7px] border border-edge-mid bg-background px-2.5 py-2">
                <p.icon size={15} strokeWidth={1.8} aria-hidden className="flex-none text-ink-mid" />
                <div className="min-w-0 flex-1">
                    <div className="truncate text-[12px] font-semibold text-primary">{file}</div>
                    <div className="truncate text-[10.5px] text-muted">{dir}</div>
                </div>
                <button
                    type="button"
                    onClick={p.onOpen}
                    className="inline-flex h-[25px] shrink-0 cursor-pointer items-center gap-[5px] rounded-[6px] border border-accent/45 bg-transparent px-2.5 text-[11.5px] font-semibold text-accent-soft hover:bg-accent/10"
                >
                    {p.action}
                    <ArrowUpRight size={11} aria-hidden />
                </button>
            </div>
        </div>
    );
}

// a mockup's board is a live canvas: its HTML source rendered as markdown would be noise
function CanvasPane({ path, onOpen }: { path: string; onOpen: () => void }) {
    return (
        <div data-doc-review-canvas className="flex min-w-0 flex-1 flex-col border-r border-edge-mid">
            <FileCard path={path} icon={SquareDashed} action="Open canvas" onOpen={onOpen} />
            <div className="flex flex-col gap-1.5 px-7 pt-[18px]">
                <span className="text-[14px] leading-[1.65] text-secondary">
                    The mockup settles this design, so there is no spec document: the decisions on the right are the
                    ones made beyond it. Open the canvas to review its boards.
                </span>
                <span className="break-all text-[11px] text-muted">{path}</span>
            </div>
        </div>
    );
}

function DocumentPane(p: { path: string; quoting: Quoting; focus: string | null; onOpen: () => void }) {
    const { path, quoting, onOpen } = p;
    const [load] = useFileText(path);
    const { file } = splitPath(path);
    const scrollRef = useRef<HTMLDivElement>(null);
    const docRef = useRef<HTMLDivElement>(null);
    useDocHighlights(docRef, quoting.notes, quoting.pending, load.text);
    useFindingFocus(scrollRef, docRef, p.focus, load.text);
    const onMouseUp = () => {
        const passage = readSelection(docRef.current);
        if (passage) {
            quoting.onSelect(passage);
        }
    };
    return (
        <div className="flex min-w-0 flex-1 flex-col border-r border-edge-mid">
            <FileCard path={path} icon={FileText} action="Open in Code" onOpen={onOpen} />
            <div
                ref={scrollRef}
                onMouseUp={onMouseUp}
                className="sc relative min-h-0 flex-1 overflow-y-auto px-7 pb-7 pt-[18px]"
            >
                {load.status === "loading" ? (
                    <div aria-hidden="true" className="flex flex-col gap-2.5 pt-1">
                        {["w-[45%]", "w-[85%]", "w-[75%]", "w-[60%]", "w-[80%]"].map((w, i) => (
                            <SkeletonLine key={i} className={cn("h-[12px]", w)} />
                        ))}
                    </div>
                ) : load.status === "error" ? (
                    <div className="flex flex-col gap-1">
                        <span className="text-[13px] text-secondary">Couldn't read {file}</span>
                        <span className="break-all text-[11px] text-muted">{path}</span>
                    </div>
                ) : (
                    <>
                        <div ref={docRef} data-doc-review-doc>
                            <MarkdownMessage text={load.text} className="text-[14px] leading-[1.65] text-secondary" />
                        </div>
                        {quoting.pending ? (
                            <NoteField
                                scrollRef={scrollRef}
                                docRef={docRef}
                                pending={quoting.pending}
                                draft={quoting.draft}
                                onDraft={quoting.onDraft}
                                onAdd={quoting.onAdd}
                                onCancel={quoting.onCancel}
                            />
                        ) : null}
                    </>
                )}
            </div>
        </div>
    );
}

// children is the notes section, pinned under the decisions, which keep their own scroll. Resting on an item
// shows its place in the document; a click pins it there while you read, and a second click lets go.
function AskPane(p: {
    review: DialogReview;
    focusIdx: number | null;
    pinIdx: number | null;
    onHover: (i: number | null) => void;
    onPin: (i: number) => void;
    children?: ReactNode;
}) {
    const { review, children } = p;
    const numbered = review.kind === "spec";
    const timer = useRef<ReturnType<typeof setTimeout>>(undefined);
    useEffect(() => () => clearTimeout(timer.current), []);
    const hover = (i: number | null) => {
        clearTimeout(timer.current);
        if (i == null) {
            p.onHover(null);
        } else {
            timer.current = setTimeout(() => p.onHover(i), HOVER_DELAY_MS);
        }
    };
    return (
        <div className="flex w-[460px] flex-none flex-col bg-surface-raised">
            <div className="sc flex min-h-0 flex-1 flex-col gap-2.5 overflow-y-auto px-5 pb-5 pt-4">
                <div className="text-[10.5px] font-bold uppercase tabular-nums tracking-[0.1em] text-muted">
                    {COPY[review.kind].list} · {review.items.length}
                </div>
                {review.intro.length > 0 ? (
                    <MarkdownMessage
                        text={review.intro.join("\n\n")}
                        className="text-[12.5px] leading-[1.5] text-secondary"
                    />
                ) : null}
                <ol className={cn("m-0 flex list-none flex-col p-0", numbered ? "gap-2.5" : "gap-3")}>
                    {review.items.map((item, i) => (
                        <li
                            key={i}
                            data-doc-finding={i}
                            data-pinned={p.pinIdx === i || undefined}
                            onMouseEnter={() => hover(i)}
                            onMouseLeave={() => hover(null)}
                            onClick={() => p.onPin(i)}
                            className={cn(
                                "-mx-2 cursor-pointer rounded-[6px] px-2 py-1 hover:bg-surface-hover",
                                p.pinIdx === i && "bg-surface-selected hover:bg-surface-selected",
                                p.focusIdx === i && "shadow-[inset_2px_0_0_var(--color-accent)]",
                                numbered && "grid grid-cols-[22px_minmax(0,1fr)]"
                            )}
                        >
                            {numbered ? (
                                <span className="pt-0.5 text-[11px] tabular-nums text-muted">{i + 1}</span>
                            ) : null}
                            <MarkdownMessage text={item} className="text-[13px] leading-[1.5] text-secondary" />
                        </li>
                    ))}
                </ol>
            </div>
            {children}
        </div>
    );
}

function Footer(p: {
    review: DialogReview;
    copy: ReturnType<typeof notesCopy>;
    canSend: boolean;
    sentLabel: string | null;
    requesting: boolean;
    note: string;
    onNote: (v: string) => void;
    onApprove: () => void;
    onRequest: () => void;
    onCancel: () => void;
    onSend: () => void;
}) {
    if (p.sentLabel != null) {
        return (
            <div className="flex flex-none items-center gap-2 border-t border-edge-mid bg-modalbg px-[22px] pb-3.5 pt-3 text-[12.5px] text-success">
                <Check size={14} strokeWidth={2.2} aria-hidden />
                <span className="font-semibold">Sent: {p.sentLabel}</span>
                <span className="text-muted">· this closes when the lead picks it up</span>
            </div>
        );
    }
    return (
        <div className="flex flex-none flex-col gap-2.5 border-t border-edge-mid bg-modalbg px-[22px] pb-3.5 pt-3">
            {p.requesting ? (
                <div className="flex flex-col gap-1.5">
                    <label htmlFor="doc-review-note" className="text-[12px] font-semibold text-secondary">
                        {p.copy.noteLabel}
                    </label>
                    <textarea
                        id="doc-review-note"
                        rows={3}
                        autoFocus
                        value={p.note}
                        onChange={(e) => p.onNote(e.target.value)}
                        placeholder={p.copy.notePlaceholder}
                        className="w-full resize-none rounded-[7px] border border-accent bg-background px-2.5 py-2 text-[13px] leading-[1.5] text-primary outline-none placeholder:text-muted"
                    />
                </div>
            ) : null}
            <div className="flex items-center gap-2">
                {p.requesting ? (
                    <>
                        <button type="button" onClick={p.onSend} disabled={!p.canSend} className={PRIMARY_BTN}>
                            {p.copy.send}
                        </button>
                        <button type="button" onClick={p.onCancel} className={SECONDARY_BTN}>
                            Cancel
                        </button>
                    </>
                ) : (
                    <>
                        <button
                            type="button"
                            onClick={p.onApprove}
                            disabled={p.review.approveIndex < 0}
                            className={PRIMARY_BTN}
                        >
                            {p.copy.approve}
                            <span className="rounded-[4px] bg-background/20 px-[5px] font-mono text-[10.5px]">
                                {formatChordString("Mod:Enter")}
                            </span>
                        </button>
                        <button type="button" onClick={p.onRequest} className={SECONDARY_BTN}>
                            {p.copy.request}
                        </button>
                    </>
                )}
                <div className="flex-1" />
                <span className="text-[11.5px] text-muted">Esc hides this; the question stays open</span>
            </div>
        </div>
    );
}
