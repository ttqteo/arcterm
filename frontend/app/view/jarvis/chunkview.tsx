// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0
//
// A chunk inside the initiative sheet (docs/superpowers/specs/2026-11-05-jarvis-revamp-design.md, decision 9, board
// Chunk.dc.html): picking a chunk swaps the sheet's head and body for it. The head goes back to the initiative, steps
// the plan's chunks, copies the `wsh effort note` command and closes; the body is the label, the one status control
// (a menu of the six statuses, `blocked` asking why) with the move the status most often needs beside it, then the
// trail newest first (chunktrail.ts) and the Add a note box.
//
// The keys are buildInitiativeSheetBindings' chunk-view half (j/k step, s the menu, 1–6 a status, Esc back), activated
// here. The note pieces (NoteRun, RunRecord) are this view's own: chunksidebar.tsx goes with the in-place tracker.

import { SkeletonLine } from "@/app/element/skeleton";
import { buildInitiativeSheetBindings, CHUNK_STATUS_KEYS } from "@/app/store/keybindings/bindings";
import { useKeybindings } from "@/app/store/keybindings/store";
import * as WOS from "@/app/store/wos";
import type { AgentsViewModel } from "@/app/view/agents/agents";
import { runAtom } from "@/app/view/agents/channelsstore";
import { SectionLabel } from "@/app/view/agents/sectionlabel";
import { cn, fireAndForget } from "@/util/util";
import { atom, useAtom, useAtomValue, type Atom } from "jotai";
import { ArrowLeft, ArrowUpRight, ChevronDown, ChevronUp, Copy, X } from "lucide-react";
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { briefingStateAtom } from "./briefingstore";
import { briefUndo, chunkKey, noteKey, pendingDeleteKeysAtom } from "./briefundo";
import { chunkMove, chunkTrail, trailCounts, type TrailBlock, type TrailLine } from "./chunktrail";
import { effortFeed, type FeedEntry } from "./effortfeed";
import { chunkTone, type EffortCardModel } from "./effortmodel";
import {
    advanceChunk,
    appendChunkNote,
    editNote,
    loadEffortDetail,
    removeNote,
    reopenChunk,
    setChunkStatus,
    type ChunkRowModel,
} from "./effortstore";
import type { InitiativeEditsState } from "./initiativeedits";
import { backToPlan, chunkNotesOnlyAtom, openSheetChunk } from "./initiativesheetstore";
import { openAgentFor } from "./initiativework";
import { workOnInitiative } from "./initiativeworkaction";
import { TONE_FG, ToneIcon } from "./inlinetrackerview";
import { openOrPeek, openOrPeekAddress } from "./openref";
import { runRecordRows } from "./runrecord";
import { RunReportView } from "./runreportview";
import { noteRunFace } from "./sidebarnotes";
import { chunkRef } from "./trackeredit";

const FOCUS = "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent";
const ICON_BTN = cn(
    "inline-flex h-6 w-6 flex-none cursor-pointer items-center justify-center rounded-[6px] text-ink-mid hover:text-ink-hi disabled:cursor-default disabled:text-feed-glyph",
    FOCUS
);
const LINK = cn("inline-flex flex-none cursor-pointer items-center gap-1 text-accent-soft hover:underline", FOCUS);
const QUIET = cn("cursor-pointer text-[10.5px] text-muted", FOCUS);

/**
 * The plan's chunks the chunk view steps through, in the server's order: the proposed ones are not part of the plan
 * yet and a chunk waiting out its delete is gone. The head's `chunk n / total` and j/k read the same list.
 */
export function useChunkSteps(oref: string, state: InitiativeEditsState, label: string) {
    const pendingDeletes = useAtomValue(pendingDeleteKeysAtom);
    const labels = useMemo(
        () =>
            state.planChunks
                .filter((c) => c.status !== "proposed" && !pendingDeletes.has(chunkKey(oref, c.label)))
                .map((c) => c.label),
        [state.planChunks, pendingDeletes, oref]
    );
    const at = labels.indexOf(label);
    const to = (delta: 1 | -1): string | null => {
        // a proposed chunk is outside the list: stepping from it lands on the plan's first or last chunk
        const i = at < 0 ? (delta > 0 ? 0 : labels.length - 1) : at + delta;
        return i >= 0 && i < labels.length && i !== at ? labels[i] : null;
    };
    return { n: at + 1, total: labels.length, prev: to(-1), next: to(1) };
}

// the initiative's detail kept fresh while a chunk is open: an agent's note moves the briefing's updatedts
function useFreshDetail(oref: string) {
    const briefing = useAtomValue(briefingStateAtom);
    const freshTs = briefing.snapshot?.state.efforts?.find((e) => e.oref === oref)?.updatedts;
    useEffect(() => {
        fireAndForget(() => loadEffortDetail(oref, freshTs));
    }, [oref, freshTs]);
}

/**
 * The chunk view's head, in SheetShell's head slot: back to the initiative, `chunk n / total`, ↑/↓, Work on or Go to
 * agent when an agent can take the chunk, copy the `wsh` command, ×.
 */
export function ChunkViewHead({
    model,
    oref,
    state,
    card,
    chunk,
    onClose,
}: {
    model: AgentsViewModel;
    oref: string;
    state: InitiativeEditsState;
    card: EffortCardModel | null;
    chunk: ChunkRowModel;
    onClose: () => void;
}) {
    const steps = useChunkSteps(oref, state, chunk.label);
    const agents = useAtomValue(model.agentsAtom);
    const oid = oref.replace(/^effort:/, "");
    const title = state.effort?.title ?? card?.title ?? "";
    const handle = `wsh effort note ${oid} "${chunk.label}"`;
    const agent = openAgentFor(oid, agents);
    // a finished or skipped chunk has nothing for a new agent to take; an agent already open is always reachable
    const work =
        agent != null ? "Go to agent" : chunk.status !== "done" && chunk.status !== "skipped" ? "Work on" : null;
    const onWork = () =>
        fireAndForget(() =>
            workOnInitiative(
                model,
                { oref, title, project: state.effort?.project || card?.project, lastnote: card?.lastnote },
                { chunk: chunk.label }
            )
        );
    return (
        <header
            data-jarvis-chunk-head
            className="flex h-[42px] flex-none items-center gap-2 border-b border-edge-faint pl-3 pr-3.5"
        >
            <button
                type="button"
                data-jarvis-chunk-back
                title="Back to the initiative (Esc)"
                onClick={backToPlan}
                className={cn(
                    "flex h-[26px] min-w-0 cursor-pointer items-center gap-1.5 rounded-[6px] px-2 text-[12px] text-secondary hover:text-ink-hi",
                    FOCUS
                )}
            >
                <ArrowLeft size={13} aria-hidden className="flex-none text-ink-mid" />
                <span className="truncate">{title}</span>
            </button>
            <span className="flex-1" />
            <span data-jarvis-chunk-position className="flex-none text-[11px] tabular-nums text-ink-mid">
                {steps.n > 0 ? `chunk ${steps.n} / ${steps.total}` : "proposed"}
            </span>
            <button
                type="button"
                aria-label="Previous chunk (k)"
                title="Previous chunk (k)"
                disabled={steps.prev == null}
                onClick={() => steps.prev != null && openSheetChunk(steps.prev)}
                className={ICON_BTN}
            >
                <ChevronUp size={14} aria-hidden />
            </button>
            <button
                type="button"
                aria-label="Next chunk (j)"
                title="Next chunk (j)"
                disabled={steps.next == null}
                onClick={() => steps.next != null && openSheetChunk(steps.next)}
                className={ICON_BTN}
            >
                <ChevronDown size={14} aria-hidden />
            </button>
            {work != null ? (
                <button
                    type="button"
                    data-jarvis-chunk-work={agent != null ? "go" : "work"}
                    title={
                        agent != null ? "Go to the agent open on this initiative" : "Work on this chunk in a new agent"
                    }
                    onClick={onWork}
                    className={cn(
                        "inline-flex h-6 flex-none cursor-pointer items-center rounded-[6px] border border-accent/45 bg-accentbg px-2.5 text-[11px] font-semibold text-accent-soft hover:text-accent-50",
                        FOCUS
                    )}
                >
                    {work}
                </button>
            ) : null}
            <button
                type="button"
                aria-label="Copy wsh command"
                title={handle}
                onClick={() => void navigator.clipboard?.writeText(handle)}
                className={ICON_BTN}
            >
                <Copy size={13} aria-hidden />
            </button>
            <button type="button" aria-label="Close (Esc)" title="Close" onClick={onClose} className={ICON_BTN}>
                <X size={16} aria-hidden />
            </button>
        </header>
    );
}

/**
 * The chunk view's body: label, status, trail, Add a note. Keyed by the chunk's label where it is drawn, so a chunk
 * stepped to starts with its menu shut and its blocks clamped.
 */
export function ChunkView({
    model,
    oref,
    state,
    chunk,
}: {
    model: AgentsViewModel;
    oref: string;
    state: InitiativeEditsState;
    chunk: ChunkRowModel;
}) {
    useFreshDetail(oref);
    const { effort, edits, planChunks, run, mutateError } = state;
    const pendingDeletes = useAtomValue(pendingDeleteKeysAtom);
    const [notesOnly, setNotesOnly] = useAtom(chunkNotesOnlyAtom);
    const [expanded, setExpanded] = useState<Set<string>>(new Set());
    // the status menu: shut, open on the six statuses, or asking why the chunk is blocked
    const [menu, setMenu] = useState<"shut" | "open" | "reason">("shut");
    const shutMenu = useCallback(() => setMenu("shut"), []);
    const steps = useChunkSteps(oref, state, chunk.label);
    const label = chunk.label;
    const ref = (l: string) => chunkRef(planChunks, l);

    const feed = useMemo(
        () =>
            effort != null ? effortFeed(effort).filter((e) => !pendingDeletes.has(noteKey(oref, e.chunk, e.ts))) : [],
        [effort, pendingDeletes, oref]
    );
    const trail = chunkTrail(feed, label, Date.now(), expanded, notesOnly);
    const counts = trailCounts(chunkTrail(feed, label, Date.now(), expanded, false));
    const isActiveChunk = planChunks.find((c) => c.status === "active")?.label === label;
    const move = chunkMove(chunk.status, isActiveChunk);

    const setStatus = (next: string, note?: string) => {
        const prev = chunk.status;
        if (next === prev && note == null) {
            return;
        }
        if (note == null && edits != null) {
            edits.onSetStatus(label, next);
            return;
        }
        run(() => setChunkStatus(oref, ref(label), next, note));
        briefUndo.notify(`Marked “${label}” ${next}`, () => run(() => setChunkStatus(oref, ref(label), prev)));
    };
    const doMove = () => {
        if (move == null) {
            return;
        }
        const m = move.move;
        if (m.kind === "set") {
            setStatus(m.status);
        } else if (m.kind === "advance") {
            run(() => advanceChunk(oref));
            // reopen is advance's undo: this chunk active again, the one advance started back to pending
            briefUndo.notify(`Marked “${label}” done`, () => run(() => reopenChunk(oref, ref(label))));
        } else {
            const prev = chunk.status;
            run(() => reopenChunk(oref, ref(label)));
            briefUndo.notify(`Reopened “${label}”`, () => run(() => setChunkStatus(oref, ref(label), prev)));
        }
    };
    // a status from the menu or its key: blocked asks why first
    const choose = (next: string) => {
        if (next === "blocked" && chunk.status !== "blocked") {
            setMenu("reason");
            return;
        }
        setMenu("shut");
        setStatus(next);
    };

    // the latest view for the bindings, which are built once
    const live = useRef({ steps, menu, choose });
    live.current = { steps, menu, choose };
    const bindings = useMemo(
        () =>
            buildInitiativeSheetBindings({
                step: (delta) => {
                    const to = delta > 0 ? live.current.steps.next : live.current.steps.prev;
                    if (to != null) {
                        openSheetChunk(to);
                    }
                },
                statusMenu: () => setMenu((m) => (m === "shut" ? "open" : "shut")),
                setStatus: (s) => live.current.choose(s),
                back: () => {
                    if (live.current.menu !== "shut") {
                        setMenu("shut");
                        return;
                    }
                    backToPlan();
                },
            }),
        []
    );
    useKeybindings(bindings);

    const deleteNote = (entry: FeedEntry) => {
        if (entry.noteAt == null) {
            return;
        }
        const at = entry.noteAt;
        briefUndo.schedule([noteKey(oref, entry.chunk, entry.ts)], "Note deleted", () =>
            removeNote(oref, chunkRef(planChunks, entry.chunk), at, entry.ts)
        );
    };
    const tone = chunkTone(chunk.status);

    return (
        <div data-jarvis-chunk-view={label} className="flex min-h-0 flex-1 flex-col bg-background">
            <div className="flex flex-none flex-col gap-2.5 px-5 pb-3.5 pt-4">
                <span
                    data-jarvis-chunk-label
                    className="text-pretty text-[15px] font-semibold leading-[21px] text-ink-hi"
                >
                    {label}
                </span>
                <div className="relative flex items-center gap-2">
                    <button
                        type="button"
                        data-jarvis-chunk-status={chunk.status}
                        aria-haspopup="menu"
                        aria-expanded={menu !== "shut"}
                        title="Change status (s)"
                        onClick={() => setMenu(menu === "shut" ? "open" : "shut")}
                        className={cn(
                            "flex h-7 cursor-pointer items-center gap-1.5 rounded-[6px] border border-edge-mid bg-surface px-2.5 text-[12px] font-semibold hover:border-edge-strong",
                            TONE_FG[tone],
                            FOCUS
                        )}
                    >
                        <ToneIcon tone={tone} />
                        {chunk.status}
                        <ChevronDown size={12} aria-hidden className="text-ink-mid" />
                    </button>
                    {move != null ? (
                        <button
                            type="button"
                            data-jarvis-chunk-move={move.label}
                            onClick={doMove}
                            className={cn(
                                "h-7 cursor-pointer rounded-[6px] border border-border px-2.5 text-[12px] text-secondary hover:border-edge-strong hover:text-ink-hi",
                                FOCUS
                            )}
                        >
                            {move.label}
                        </button>
                    ) : null}
                    <span className="flex-1" />
                    <span data-jarvis-chunk-counts className="text-[11px] tabular-nums text-ink-mid">
                        {counts.statusChanges} status {counts.statusChanges === 1 ? "change" : "changes"} ·{" "}
                        {counts.notes} {counts.notes === 1 ? "note" : "notes"}
                    </span>
                    {menu !== "shut" ? (
                        <StatusMenu
                            status={chunk.status}
                            asking={menu === "reason"}
                            onChoose={choose}
                            onReason={(why) => {
                                setMenu("shut");
                                setStatus("blocked", why);
                            }}
                            onShut={shutMenu}
                        />
                    ) : null}
                </div>
                {mutateError != null ? <p className="m-0 text-[11px] text-error">{mutateError}</p> : null}
            </div>
            <div className="flex min-h-0 flex-1 flex-col overflow-y-auto border-t border-edge-faint px-5 pb-4 pt-1">
                <div className="flex h-[34px] flex-none items-center gap-2">
                    <span className="text-[12.5px] font-semibold text-ink-hi">Trail</span>
                    <span className="flex-1" />
                    <span className="text-[11px] text-ink-mid">Newest first</span>
                    <button
                        type="button"
                        data-jarvis-notes-only={notesOnly ? "on" : "off"}
                        aria-pressed={notesOnly}
                        title="Hide the bare status changes"
                        onClick={() => setNotesOnly(!notesOnly)}
                        className={cn(
                            "cursor-pointer rounded-[6px] border px-[7px] py-0.5 text-[11px] hover:text-ink-hi",
                            notesOnly
                                ? "border-edge-strong bg-surface-selected text-ink-hi"
                                : "border-border text-secondary",
                            FOCUS
                        )}
                    >
                        Notes only
                    </button>
                </div>
                {trail.length === 0 ? (
                    <p className="m-0 py-2 text-[12px] leading-[1.6] text-muted">
                        {notesOnly && counts.statusChanges > 0
                            ? "No notes on this chunk yet; Notes only hides its status changes."
                            : "No notes on this chunk yet. Notes from you or an agent land here."}
                    </p>
                ) : null}
                <div className="flex flex-col gap-1.5">
                    {trail.map((t) =>
                        t.kind === "note" ? (
                            <NoteBlock
                                key={t.key}
                                model={model}
                                block={t}
                                onToggle={() =>
                                    setExpanded((cur) => {
                                        const next = new Set(cur);
                                        if (!next.delete(t.key)) {
                                            next.add(t.key);
                                        }
                                        return next;
                                    })
                                }
                                onEdit={(text) =>
                                    t.entry.noteAt != null &&
                                    run(() =>
                                        editNote(
                                            oref,
                                            chunkRef(planChunks, t.entry.chunk),
                                            t.entry.noteAt!,
                                            t.entry.ts,
                                            text
                                        )
                                    )
                                }
                                onDelete={() => deleteNote(t.entry)}
                            />
                        ) : (
                            <StatusLine key={t.key} line={t} />
                        )
                    )}
                </div>
            </div>
            <AddNote onAdd={(text) => run(() => appendChunkNote(oref, label, text))} />
        </div>
    );
}

// The six statuses in the order their keys choose them (1–6), then the reason blocked asks for
function StatusMenu({
    status,
    asking,
    onChoose,
    onReason,
    onShut,
}: {
    status: string;
    asking: boolean;
    onChoose: (status: string) => void;
    onReason: (why: string) => void;
    onShut: () => void;
}) {
    const box = useRef<HTMLDivElement>(null);
    const [why, setWhy] = useState("");
    // a click outside shuts it, as a menu does
    useEffect(() => {
        const away = (e: MouseEvent) => {
            const el = e.target as Node | null;
            if (box.current != null && el != null && !box.current.contains(el)) {
                const opener = (el as Element).closest?.("[data-jarvis-chunk-status]");
                if (opener == null) {
                    onShut();
                }
            }
        };
        document.addEventListener("mousedown", away);
        return () => document.removeEventListener("mousedown", away);
    }, [onShut]);
    const submit = () => {
        const text = why.trim();
        if (text !== "") {
            onReason(text);
        }
    };
    return (
        <div
            ref={box}
            role="menu"
            aria-label="Status"
            data-jarvis-chunk-status-menu={asking ? "reason" : "open"}
            className="absolute left-0 top-[34px] z-10 flex w-[230px] flex-col rounded-[8px] border border-edge-mid bg-surface p-1 shadow-[0_12px_34px_var(--color-background)]"
        >
            {CHUNK_STATUS_KEYS.map((s, i) => {
                const tone = chunkTone(s);
                const on = s === status;
                return (
                    <button
                        key={s}
                        type="button"
                        role="menuitemradio"
                        aria-checked={on}
                        data-jarvis-chunk-status-option={s}
                        onClick={() => onChoose(s)}
                        className={cn(
                            "flex h-7 cursor-pointer items-center gap-2 rounded-[5px] px-2 text-left hover:bg-surface-hover",
                            on && "bg-surface-selected",
                            asking && s === "blocked" && "bg-surface-selected",
                            FOCUS
                        )}
                    >
                        <span className="flex w-3 justify-center">
                            <ToneIcon tone={tone} />
                        </span>
                        <span className="flex-1 text-[12px] text-primary">{s}</span>
                        <span className="font-mono text-[10px] text-ink-mid">{i + 1}</span>
                    </button>
                );
            })}
            <div className="mx-0.5 my-1 h-px bg-border" />
            {asking ? (
                <div className="flex flex-col gap-1 px-1.5 pb-1">
                    <input
                        autoFocus
                        data-jarvis-blocked-reason
                        aria-label="Why is it blocked?"
                        placeholder="Why is it blocked?"
                        value={why}
                        onChange={(e) => setWhy(e.target.value)}
                        onKeyDown={(e) => {
                            if (e.key === "Enter") {
                                e.preventDefault();
                                submit();
                            } else if (e.key === "Escape") {
                                e.stopPropagation();
                                onShut();
                            }
                        }}
                        className="h-7 w-full rounded-[6px] border border-accent/60 bg-background px-2 text-[12px] text-primary outline-none"
                    />
                    <span className="text-[10.5px] text-ink-mid">Enter marks it blocked · Esc cancels</span>
                </div>
            ) : (
                <span className="px-2 pb-[5px] pt-1 text-[10.5px] text-ink-mid">Blocked asks for a note: why</span>
            )}
        </div>
    );
}

// a bare status change: glyph, → status, time, on one thin line
function StatusLine({ line }: { line: TrailLine }) {
    return (
        <div data-jarvis-trail-line={line.key} className="flex h-[30px] items-center gap-2 px-1">
            <span className="flex w-3 justify-center">
                {line.status != null ? <ToneIcon tone={line.tone} size={11} /> : null}
            </span>
            <span className="text-[11.5px] text-ink-mid">
                {line.status != null ? `→ ${line.status}` : "status changed"}
            </span>
            <span className="flex-1" />
            <span className="text-[10.5px] tabular-nums text-muted">{line.entry.ts > 0 ? line.day : ""}</span>
        </div>
    );
}

// a note: who, time, the status it set, the text clamped to four lines, its session or run, Edit and Delete on yours
function NoteBlock({
    model,
    block,
    onToggle,
    onEdit,
    onDelete,
}: {
    model: AgentsViewModel;
    block: TrailBlock;
    onToggle: () => void;
    onEdit: (text: string) => void;
    onDelete: () => void;
}) {
    const text = useRef<HTMLSpanElement>(null);
    const [clamped, setClamped] = useState(false);
    const [editing, setEditing] = useState<string | null>(null);
    useLayoutEffect(() => {
        const el = text.current;
        if (el != null && !block.expanded) {
            setClamped(el.scrollHeight > el.clientHeight + 1);
        }
    }, [block.text, block.expanded]);
    // the run's report waits behind Show all, so a note from a run offers it even when its text fits
    const hasRun = block.runOid !== "" && block.who === "agent";
    const canShow = clamped || hasRun || block.expanded;
    const source = block.who === "agent" && (block.sessionTab !== "" || block.runOid !== "");
    const save = () => {
        const next = editing?.trim() ?? "";
        if (next === "") {
            return; // Save is disabled on empty text; the server would refuse it too (EC-EMPTY-NOTE)
        }
        setEditing(null);
        if (next !== block.entry.text) {
            onEdit(next);
        }
    };
    const tagTone = block.tag != null ? chunkTone(block.tag) : null;
    return (
        <div
            data-jarvis-trail-block={block.key}
            data-jarvis-trail-tag={block.tag ?? ""}
            className={cn(
                "flex flex-col gap-1.5 rounded-[8px] border bg-surface px-3 py-2.5",
                editing != null ? "border-accent/45" : "border-border"
            )}
        >
            <div className="flex items-center gap-2 text-[10.5px] tabular-nums">
                {block.who !== "" ? (
                    <span className={cn("font-semibold", block.who === "you" ? "text-accent-soft" : "text-success")}>
                        {block.who}
                    </span>
                ) : null}
                <span className="text-ink-mid">
                    {block.day}
                    {block.edited ? " · edited" : ""}
                </span>
                {block.tag != null && tagTone != null ? (
                    <span
                        data-jarvis-trail-status-tag
                        className={cn("rounded-[4px] border border-current/40 px-[5px]", TONE_FG[tagTone])}
                    >
                        → {block.tag}
                    </span>
                ) : null}
                <span className="flex-1" />
                {source ? (
                    <button
                        type="button"
                        data-peek
                        onClick={(e) =>
                            fireAndForget(() =>
                                block.sessionTab !== ""
                                    ? openOrPeek(model, { kind: "agent", tabId: block.sessionTab }, e)
                                    : openOrPeekAddress(model, "run:" + block.runOid, e)
                            )
                        }
                        className={LINK}
                    >
                        {block.sessionTab !== "" ? "Open agent session" : "Open run"}
                        <ArrowUpRight size={11} aria-hidden />
                    </button>
                ) : null}
            </div>
            {editing != null ? (
                <div className="flex flex-col gap-1.5">
                    <textarea
                        autoFocus
                        rows={6}
                        value={editing}
                        onChange={(e) => setEditing(e.target.value)}
                        onKeyDown={(e) => {
                            if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) {
                                save();
                            } else if (e.key === "Escape") {
                                e.stopPropagation();
                                setEditing(null);
                            }
                        }}
                        className="w-full resize-y rounded-[7px] border border-accent/60 bg-background px-2.5 py-2 text-[12.5px] leading-[1.6] text-primary outline-none"
                    />
                    <div className="flex items-center gap-1.5">
                        <span className="flex-1 text-[10.5px] text-muted">ctrl+enter save · esc cancel</span>
                        <button
                            type="button"
                            onClick={() => setEditing(null)}
                            className={cn(
                                "cursor-pointer rounded-[7px] border border-border bg-surface-raised px-[11px] py-1 text-[11px] font-semibold text-secondary",
                                FOCUS
                            )}
                        >
                            Cancel
                        </button>
                        <button
                            type="button"
                            disabled={editing.trim() === ""}
                            onClick={save}
                            className={cn(
                                "cursor-pointer rounded-[7px] bg-accent px-[11px] py-1 text-[11px] font-bold text-background disabled:cursor-default disabled:opacity-40",
                                FOCUS
                            )}
                        >
                            Save
                        </button>
                    </div>
                </div>
            ) : (
                <span
                    ref={text}
                    data-jarvis-trail-text
                    className={cn(
                        "whitespace-pre-wrap break-words text-[12.5px] leading-[19px] text-secondary",
                        !block.expanded && "line-clamp-4"
                    )}
                >
                    {block.text}
                </span>
            )}
            {block.expanded && hasRun && editing == null ? (
                <div className="border-t border-edge-faint pt-2.5">
                    <NoteRun model={model} runOid={block.runOid} />
                </div>
            ) : null}
            {editing == null && (canShow || block.editable) ? (
                <div className="flex items-center gap-3">
                    {canShow ? (
                        <button
                            type="button"
                            data-jarvis-trail-show
                            onClick={onToggle}
                            className={cn(QUIET, "hover:text-ink-hi")}
                        >
                            {block.expanded ? "Show less ▴" : "Show all ▾"}
                        </button>
                    ) : null}
                    <span className="flex-1" />
                    {block.editable ? (
                        <>
                            <button
                                type="button"
                                data-jarvis-note-edit
                                onClick={() => setEditing(block.entry.text)}
                                className={cn(QUIET, "hover:text-accent-soft")}
                            >
                                Edit
                            </button>
                            <button
                                type="button"
                                data-jarvis-note-delete
                                onClick={onDelete}
                                className={cn(QUIET, "hover:text-error")}
                            >
                                Delete
                            </button>
                        </>
                    ) : null}
                </div>
            ) : null}
        </div>
    );
}

// the foot: Ctrl+Enter adds, Esc clears a draft (and, with nothing typed, goes back to the initiative)
function AddNote({ onAdd }: { onAdd: (text: string) => void }) {
    const [draft, setDraft] = useState("");
    const submit = () => {
        const text = draft.trim();
        if (text !== "") {
            onAdd(text);
            setDraft("");
        }
    };
    return (
        <div className="flex-none border-t border-border bg-background px-3.5 pb-3 pt-2.5">
            <div className="flex flex-col gap-1.5 rounded-[8px] border border-border bg-background py-2 pl-2.5 pr-2">
                <textarea
                    rows={2}
                    value={draft}
                    data-jarvis-chunk-note-input
                    onChange={(e) => setDraft(e.target.value)}
                    onKeyDown={(e) => {
                        if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) {
                            submit();
                        } else if (e.key === "Escape") {
                            // a typing box takes no binding: its Esc clears a draft, or goes back as the view's Esc does,
                            // rather than reaching the sheet's own Esc and closing it
                            e.stopPropagation();
                            if (draft !== "") {
                                setDraft("");
                            } else {
                                e.currentTarget.blur();
                                backToPlan();
                            }
                        }
                    }}
                    placeholder="Add a note…"
                    aria-label="New note"
                    className="w-full resize-none bg-transparent text-[12.5px] leading-[1.6] text-primary outline-none"
                />
                <div className="flex items-center gap-2">
                    <span className="flex-1 text-[10.5px] text-ink-mid">Ctrl+Enter adds · Esc clears</span>
                    <button
                        type="button"
                        disabled={draft.trim() === ""}
                        onClick={submit}
                        className={cn(
                            "cursor-pointer rounded-[6px] bg-accent px-2.5 py-1 text-[11px] font-bold text-background disabled:cursor-default disabled:bg-border disabled:text-ink-mid",
                            FOCUS
                        )}
                    >
                        Add note
                    </button>
                </div>
            </div>
        </div>
    );
}

const NO_RUN = atom<Run | undefined>(undefined);
const NO_FLAG = atom(false);

// the report a finished run left on this chunk: the structured report when the lead filed one, else the sealed
// summary; then the dag's record sealed with it
function NoteRun({ model, runOid }: { model: AgentsViewModel; runOid: string }) {
    const oref = WOS.makeORef("run", runOid);
    const run = useAtomValue((runOid ? runAtom(runOid) : NO_RUN) as Atom<Run | undefined>);
    const loading = useAtomValue(runOid ? WOS.getWaveObjectLoadingAtom(oref) : NO_FLAG);
    const error = useAtomValue(runOid ? WOS.getWaveObjectErrorAtom(oref) : NO_FLAG);
    const face = noteRunFace({ run, loading, error });
    if (face === "loading") {
        return (
            <div aria-hidden="true" className="flex flex-col gap-2">
                <SkeletonLine className="h-[10px] w-[85%]" />
                <SkeletonLine className="h-[10px] w-[60%]" />
            </div>
        );
    }
    if (run == null) {
        return <p className="m-0 text-[11.5px] text-muted">The run's report is no longer available.</p>;
    }
    return (
        <div className="flex flex-col gap-3">
            {(run.report ?? "").trim() !== "" ? (
                <RunReportView model={model} run={run} compact />
            ) : (
                <p className="m-0 text-[12px] leading-[1.55] text-secondary">
                    {run.evidence?.summary || "The run finished without a report."}
                </p>
            )}
            <RunRecord dag={run.evidence?.dag} />
        </div>
    );
}

function RunRecord({ dag }: { dag: EvidenceDag | undefined }) {
    const rows = runRecordRows(dag);
    if (rows.length === 0) {
        return null;
    }
    return (
        <div data-jarvis-run-record className="flex flex-col gap-1">
            <SectionLabel>record</SectionLabel>
            {rows.map((row, n) => (
                <div
                    key={n}
                    className={cn(
                        "whitespace-pre-wrap break-words",
                        row.kind === "task" && "pt-1 text-[11px] text-ink-hi",
                        row.kind === "section" && "pl-3 text-[12px] leading-[1.5] text-secondary",
                        row.kind === "run" && "pt-1 text-[11px] tabular-nums text-ink-mid"
                    )}
                >
                    {row.kind !== "task" && row.label != null ? (
                        <span className="text-[10.5px] text-muted">{row.label}: </span>
                    ) : null}
                    {row.text}
                </div>
            ))}
        </div>
    );
}
