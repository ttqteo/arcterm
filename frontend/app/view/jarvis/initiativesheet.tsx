// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0
//
// An initiative in the Brief's sheet (docs/superpowers/specs/2026-11-05-jarvis-revamp-design.md, decision 7, board
// Sheet.dc.html). The head names it (title, project · status · updated, Pin, Previous/Next through the page's order,
// ×), reads its progress (done/total, percent, the segment bar) and offers its moves (Work on / Go to agent, the
// agent's state, Activity ↗, ⋯). The body is its plan, edited in place (inlinetrackerview.tsx variant "sheet"), then
// its sub-initiatives and linked ideas; or its Activity feed (EffortDetailView) with a link back. A chunk picked from
// the plan takes the head and body over (chunkview.tsx, decision 9) until its back goes to the plan again.
//
// InitiativeSheetHead and InitiativeChunkList are exported for the review pass, which draws them in place rather than
// opening the sheet. What the body shows lives in initiativesheetstore.ts; the edits in initiativeedits.ts.

import { ContextMenuModel } from "@/app/store/contextmenu";
import { buildInitiativeSheetBindings } from "@/app/store/keybindings/bindings";
import { useKeybindings } from "@/app/store/keybindings/store";
import type { AgentsViewModel } from "@/app/view/agents/agents";
import { formatAge } from "@/app/view/agents/agentsviewmodel";
import { cn, fireAndForget } from "@/util/util";
import { useAtom, useAtomValue, useSetAtom } from "jotai";
import {
    Archive,
    ArchiveRestore,
    ArrowUpRight,
    ChevronDown,
    ChevronUp,
    Copy,
    Ellipsis,
    Pause,
    Pencil,
    Play,
    SlidersHorizontal,
    Trash2,
    X,
} from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { briefingStateAtom } from "./briefingstore";
import { isArchivedStatus } from "./briefpalette";
import { linkedUnder } from "./briefrows";
import { LinkedInitiatives, SegmentBar } from "./briefrowviews";
import { SheetShell } from "./briefrunsheet";
import { sheetPosition } from "./briefsheetmodel";
import { REGION_LABEL } from "./briefstyle";
import { chunkKey, effortKey, noteKey, pendingDeleteKeysAtom } from "./briefundo";
import { ChunkView, ChunkViewHead } from "./chunkview";
import { EffortCreateForm } from "./effortcreateform";
import { EffortDetailView } from "./effortdetailview";
import { effortFeed, feedNoteCounts } from "./effortfeed";
import { buildEffortCard, chunkTone, type ChunkTone, type EffortCardModel } from "./effortmodel";
import { effortChunkRows, loadEffortDetail, togglePin, type ChunkRowModel } from "./effortstore";
import { useInitiativeEdits, type InitiativeEditsState } from "./initiativeedits";
import {
    backToPlan,
    initiativeCursorAtom,
    initiativeSheetAtom,
    openSheetChunk,
    sheetChunkMoveAtom,
    sheetStageOverridesAtom,
    showInitiativeActivity,
} from "./initiativesheetstore";
import { noteStamp, openAgentFor } from "./initiativework";
import { workOnInitiative, type WorkOnTarget } from "./initiativeworkaction";
import { chunkRowId, initiativeRows, type DetailRow } from "./inlinetracker";
import { IdeaDetail, InitiativeDetail, type TrackerEdits } from "./inlinetrackerview";
import { briefInitiativeListAtom, initiativeSheetRequestAtom } from "./jarvisstore";
import { openOrPeekAddress } from "./openref";
import { STAGE_SCROLLER } from "./stagemeasure";

export { openInitiativeChunk } from "./initiativesheetstore";

const FOCUS = "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent";
const HEAD_BTN = cn(
    "flex h-[26px] flex-none cursor-pointer items-center justify-center rounded-[6px] text-ink-mid hover:text-ink-hi",
    FOCUS
);
const STEP_BTN = cn(
    "inline-flex h-[26px] w-6 cursor-pointer items-center justify-center rounded-[6px] border border-border hover:border-edge-strong",
    FOCUS
);

// the plan's progress as the head reads it: proposed chunks are not part of the work yet, skipped ones leave the count
// (the card's rule, effortmodel.ts buildEffortCard)
function progressOf(chunks: ChunkRowModel[]): { done: number; total: number; pct: number; segments: ChunkTone[] } {
    const counted = chunks.filter((c) => c.status !== "proposed" && c.status !== "skipped");
    const done = counted.filter((c) => c.status === "done").length;
    return {
        done,
        total: counted.length,
        pct: counted.length > 0 ? Math.round((done / counted.length) * 100) : 0,
        segments: counted.map((c) => chunkTone(c.status)),
    };
}

// the initiative's summary card, the one list holding pins and the parent/children links
function useCards(): EffortCardModel[] {
    const briefing = useAtomValue(briefingStateAtom);
    const summaries = briefing.snapshot?.state.efforts;
    return useMemo(() => (summaries ?? []).map(buildEffortCard), [summaries]);
}

/**
 * The sheet's head. `onClose` and `stepping` are the sheet's: the review pass draws the head in place without them,
 * and passes `onActivity`, since the sheet's own Activity toggle would flip the state of a sheet that is not open.
 */
export function InitiativeSheetHead({
    model,
    oref,
    state,
    card,
    onClose,
    stepping = true,
    onActivity,
}: {
    model: AgentsViewModel;
    oref: string;
    state: InitiativeEditsState;
    card: EffortCardModel | null;
    onClose?: () => void;
    stepping?: boolean;
    onActivity?: (e: React.MouseEvent) => void;
}) {
    const { effort, edits, renaming, setRenaming, commitRename, planChunks } = state;
    const agents = useAtomValue(model.agentsAtom);
    const list = useAtomValue(briefInitiativeListAtom);
    const sheet = useAtomValue(initiativeSheetAtom);
    const oid = oref.replace(/^effort:/, "");
    const title = effort?.title ?? card?.title ?? "";
    const status = effort?.status ?? card?.status ?? "";
    const project = effort?.project ?? card?.project ?? "";
    const updated = effort?.updatedts ?? card?.updatedts;
    const meta = [project, status, updated != null ? `updated ${formatAge(Date.now() - updated)}` : ""]
        .filter((s) => s !== "")
        .join(" · ");
    // a pin is read off the briefing's summary, which the pin flow reloads (effortstore.ts togglePin)
    const pinned = (card?.pinnedTs ?? 0) > 0;
    const progress = effort != null ? progressOf(planChunks) : null;
    const done = progress?.done ?? card?.done ?? 0;
    const total = progress?.total ?? (card != null ? card.done + card.remaining : 0);
    const pct = progress?.pct ?? card?.progressPct ?? 0;
    const segments = progress?.segments ?? card?.segments ?? [];
    const agent = openAgentFor(oid, agents);
    const pos = sheetPosition(list, oref);
    const step = (to: string | null, e: React.MouseEvent) => {
        if (to != null) {
            fireAndForget(() => openOrPeekAddress(model, to, e));
        }
    };
    const work = () => {
        const target: WorkOnTarget = { oref, title, project: project || undefined, lastnote: card?.lastnote };
        fireAndForget(() => workOnInitiative(model, target));
    };
    const menu = (e: React.MouseEvent) => (edits != null ? showSheetMenu(e, edits) : undefined);
    return (
        <header
            data-jarvis-initiative-sheet-head={oref}
            className="flex flex-none flex-col gap-2.5 border-b border-edge-faint px-5 pb-3.5 pt-[18px]"
        >
            <div className="flex items-start gap-2.5">
                <div className="flex min-w-0 flex-1 flex-col gap-[3px]">
                    {renaming != null ? (
                        <input
                            autoFocus
                            data-jarvis-rename-input
                            aria-label="Initiative title"
                            value={renaming}
                            onChange={(e) => setRenaming(e.target.value)}
                            onBlur={commitRename}
                            onKeyDown={(e) => {
                                if (e.key === "Enter") {
                                    e.currentTarget.blur();
                                } else if (e.key === "Escape") {
                                    e.stopPropagation();
                                    setRenaming(null);
                                }
                            }}
                            className="min-w-0 rounded-[6px] border border-accent/60 bg-background px-[7px] py-0.5 text-[15px] font-semibold text-ink-hi outline-none"
                        />
                    ) : (
                        <span
                            data-jarvis-initiative-sheet-title
                            title={title}
                            className="line-clamp-2 text-[17px] font-semibold leading-[22px] text-ink-hi"
                        >
                            {title}
                        </span>
                    )}
                    <span data-jarvis-initiative-sheet-meta className="truncate text-[11.5px] text-ink-mid">
                        {meta}
                    </span>
                </div>
                <button
                    type="button"
                    data-jarvis-sheet-pin={pinned ? "pinned" : "pin"}
                    aria-label={pinned ? "Unpin" : "Pin"}
                    title={pinned ? "Unpin from the Brief's cards" : "Pin to the Brief's cards"}
                    onClick={() => fireAndForget(() => togglePin(oref))}
                    className={cn(
                        "h-[26px] flex-none cursor-pointer rounded-[6px] border px-2 text-[11.5px] hover:border-edge-strong hover:text-ink-hi",
                        pinned ? "border-border text-ink-mid" : "border-edge-mid text-secondary",
                        FOCUS
                    )}
                >
                    {pinned ? "Pinned" : "Pin"}
                </button>
                {stepping ? (
                    <div data-jarvis-sheet-step className="flex flex-none items-center gap-1">
                        {pos.total > 0 ? (
                            <span className="mr-0.5 text-[10.5px] tabular-nums text-muted">
                                {pos.n} / {pos.total}
                            </span>
                        ) : null}
                        <button
                            type="button"
                            aria-label="Previous initiative"
                            title="Previous initiative"
                            data-peek={pos.prev ? "" : undefined}
                            disabled={pos.prev == null}
                            onClick={(e) => step(pos.prev, e)}
                            className={cn(STEP_BTN, pos.prev ? "text-secondary" : "cursor-default text-feed-glyph")}
                        >
                            <ChevronUp size={13} aria-hidden />
                        </button>
                        <button
                            type="button"
                            aria-label="Next initiative"
                            title="Next initiative"
                            data-peek={pos.next ? "" : undefined}
                            disabled={pos.next == null}
                            onClick={(e) => step(pos.next, e)}
                            className={cn(STEP_BTN, pos.next ? "text-secondary" : "cursor-default text-feed-glyph")}
                        >
                            <ChevronDown size={13} aria-hidden />
                        </button>
                    </div>
                ) : null}
                {onClose != null ? (
                    <button
                        type="button"
                        aria-label="Close (Esc)"
                        onClick={onClose}
                        className={cn(HEAD_BTN, "w-[26px]")}
                    >
                        <X size={16} aria-hidden />
                    </button>
                ) : null}
            </div>
            <div data-jarvis-initiative-sheet-progress className="flex items-center gap-2.5">
                <span data-jarvis-initiative-sheet-count className="text-[20px] font-semibold tabular-nums text-ink-hi">
                    {done}
                    <span className="text-muted">/{total}</span>
                </span>
                <span className="text-[11.5px] tabular-nums text-ink-mid">{pct}%</span>
                <SegmentBar segments={segments} className="flex-1" />
            </div>
            <div className="flex items-center gap-2">
                <button
                    type="button"
                    data-jarvis-work-on={agent != null ? "go" : "work"}
                    title={
                        agent != null
                            ? "Go to the agent open on this initiative (w)"
                            : "Work on this in a new agent (w)"
                    }
                    onClick={work}
                    className={cn(
                        "flex h-7 flex-none cursor-pointer items-center gap-1.5 rounded-[6px] border border-edge-strong bg-surface-raised px-2.5 text-[12px] font-semibold text-ink-hi hover:border-accent/60",
                        FOCUS
                    )}
                >
                    {agent != null ? "Go to agent" : "Work on"}
                    <span className="font-mono text-[10px] font-normal text-ink-mid">w</span>
                </button>
                <span
                    data-jarvis-sheet-agent={agent?.state ?? "none"}
                    className={cn(
                        "text-[11px] font-semibold",
                        agent == null
                            ? "font-normal text-muted"
                            : agent.state === "asking"
                              ? "text-asking"
                              : "text-success"
                    )}
                >
                    {agent == null ? "no agent open" : `● agent ${agent.state === "idle" ? "open" : agent.state}`}
                </span>
                <span className="flex-1" />
                <button
                    type="button"
                    data-jarvis-sheet-activity
                    aria-pressed={onActivity == null ? sheet.view === "activity" : undefined}
                    onClick={(e) =>
                        onActivity != null
                            ? onActivity(e)
                            : sheet.view === "activity"
                              ? backToPlan()
                              : showInitiativeActivity()
                    }
                    className={cn(
                        "flex h-[26px] cursor-pointer items-center gap-1 px-1 text-[11.5px] hover:text-ink-hi",
                        onActivity == null && sheet.view === "activity" ? "text-ink-hi" : "text-ink-mid",
                        FOCUS
                    )}
                >
                    Activity
                    <ArrowUpRight size={12} aria-hidden />
                </button>
                <button
                    type="button"
                    aria-label="More"
                    title="Rename, edit, pause, archive or delete"
                    data-jarvis-sheet-menu
                    disabled={edits == null}
                    onClick={menu}
                    className={cn(HEAD_BTN, "w-[26px]")}
                >
                    <Ellipsis size={15} aria-hidden />
                </button>
            </div>
        </header>
    );
}

// the head's ⋯: today's initiative menu actions (briefsurface.tsx showInitiativeMenu), the plan's own edits behind them
function showSheetMenu(ev: React.MouseEvent, edits: TrackerEdits): void {
    const archived = isArchivedStatus(edits.effortStatus);
    const items: ContextMenuItem[] = [
        { label: "Rename", icon: <Pencil size={15} />, click: () => edits.onRename(edits.title) },
        { label: "Edit details…", icon: <SlidersHorizontal size={15} />, click: edits.onDetails },
    ];
    if (archived) {
        items.push({ label: "Unarchive", icon: <ArchiveRestore size={15} />, click: edits.onUnarchive });
    } else {
        items.push(
            edits.effortStatus === "paused"
                ? { label: "Resume", icon: <Play size={15} />, click: edits.onTogglePause }
                : { label: "Pause", icon: <Pause size={15} />, click: edits.onTogglePause },
            { label: "Archive", icon: <Archive size={15} />, click: edits.onArchive }
        );
    }
    items.push(
        { type: "separator" },
        {
            label: "Copy handle",
            icon: <Copy size={15} />,
            click: () => void navigator.clipboard.writeText("wsh effort show " + edits.oid),
        },
        { type: "separator" },
        // no confirm step: the delete waits out the Brief's undo window like every other delete
        { label: "Delete", icon: <Trash2 size={15} />, danger: true, click: edits.onDelete }
    );
    ContextMenuModel.getInstance().showContextMenu(items, ev);
}

/**
 * The plan, edited in place: the rows initiativeRows lays out, drawn as the sheet's variant. An initiative with no plan
 * yet (an idea) offers the ways to give it one instead.
 */
export function InitiativeChunkList({
    model,
    oref,
    state,
    card,
    cursor,
    onCursor,
    onOpenChunk,
}: {
    model: AgentsViewModel;
    oref: string;
    state: InitiativeEditsState;
    card: EffortCardModel | null;
    // the cursor chunk's label, and where a click moves it
    cursor: string | null;
    onCursor: (label: string) => void;
    onOpenChunk?: (label: string) => void;
}) {
    const rows = useSheetRows(oref, state.effort);
    const [overrides, setOverrides] = useAtom(sheetStageOverridesAtom);
    const { edits, effort } = state;
    if (effort == null || edits == null) {
        return null;
    }
    const labelOf = (id: string): string | null => {
        const row = rows.find((r) => r.id === id);
        return row?.kind === "chunk" ? row.row.label : null;
    };
    const planned = rows.some((r) => r.kind === "chunk" || r.kind === "stage");
    if (!planned) {
        const proposed = rows.find((r): r is Extract<DetailRow, { kind: "proposed" }> => r.kind === "proposed");
        return (
            <IdeaDetail
                jotted={noteStamp(effort.createdts)}
                edits={edits}
                proposed={proposed?.rows}
                onPlan={() =>
                    fireAndForget(() =>
                        workOnInitiative(
                            model,
                            { oref, title: effort.title, project: effort.project, lastnote: card?.lastnote },
                            "plan"
                        )
                    )
                }
            />
        );
    }
    return (
        <InitiativeDetail
            rows={rows}
            cursor={cursor != null ? chunkRowId(oref, cursor) : undefined}
            edits={edits}
            onSelectChunk={(id) => {
                const label = labelOf(id);
                if (label != null) {
                    onCursor(label);
                }
            }}
            onOpenChunk={
                onOpenChunk != null
                    ? (id) => {
                          const label = labelOf(id);
                          if (label != null) {
                              onOpenChunk(label);
                          }
                      }
                    : undefined
            }
            onToggleStage={(id, open) => setOverrides({ ...overrides, [id]: open })}
        />
    );
}

// the plan's rows as the sheet lays them out, the chunks and notes waiting out a delete left out
function useSheetRows(oref: string, effort: Effort | null): DetailRow[] {
    const pendingDeletes = useAtomValue(pendingDeleteKeysAtom);
    const overrides = useAtomValue(sheetStageOverridesAtom);
    return useMemo(() => {
        if (effort == null) {
            return [];
        }
        const feed = effortFeed(effort).filter((e) => !pendingDeletes.has(noteKey(oref, e.chunk, e.ts)));
        return initiativeRows({
            oref,
            chunks: effortChunkRows(effort).filter((r) => !pendingDeletes.has(chunkKey(oref, r.label))),
            noteCounts: feedNoteCounts(feed),
            stageOverrides: overrides,
        });
    }, [oref, effort, pendingDeletes, overrides]);
}

// The plan view's keys and cursor: j/k step the chunk cursor over the chunks drawn, Enter opens the one under it,
// Alt+↑/↓ move it within its stage (sheetChunkMoveAtom, read by jarvis:chunk-up / jarvis:chunk-down).
function usePlanKeys(oref: string, state: InitiativeEditsState) {
    const rows = useSheetRows(oref, state.effort);
    const [cursor, setCursor] = useAtom(initiativeCursorAtom);
    const setMove = useSetAtom(sheetChunkMoveAtom);
    const chunks = rows.filter((r): r is Extract<DetailRow, { kind: "chunk" }> => r.kind === "chunk");
    const labels = chunks.map((c) => c.row.label);
    const at = cursor != null ? labels.indexOf(cursor) : -1;
    // the latest plan for the bindings, which are built once
    const live = useRef({ labels, at, next: chunks.find((c) => c.next)?.row.label ?? null, cursor });
    live.current = { labels, at, next: chunks.find((c) => c.next)?.row.label ?? null, cursor };
    const bindings = useMemo(
        () =>
            buildInitiativeSheetBindings({
                step: (delta) => {
                    const { labels, at, next } = live.current;
                    if (labels.length === 0) {
                        return false;
                    }
                    // with no cursor yet, the first press lands on the chunk picked up next
                    const from = at >= 0 ? at + delta : Math.max(0, labels.indexOf(next ?? ""));
                    setCursor(labels[Math.min(labels.length - 1, Math.max(0, from))]);
                },
                open: () => {
                    const { at, labels } = live.current;
                    if (at < 0) {
                        return false;
                    }
                    openSheetChunk(labels[at]);
                },
            }),
        [setCursor]
    );
    useKeybindings(bindings);
    const edits = state.edits;
    const onCursorChunk = at >= 0 ? labels[at] : null;
    useEffect(() => {
        if (edits == null || onCursorChunk == null) {
            setMove(null);
            return;
        }
        setMove(() => (dir: "up" | "down") => edits.onMoveChunk(onCursorChunk, dir));
        return () => setMove(null);
    }, [edits, onCursorChunk, setMove]);
    // the body scrolls, so a cursor moved off-screen is brought back
    useEffect(() => {
        document
            .querySelector('[data-jarvis-brief-sheet="effort"] [data-jarvis-tracker-chunk][aria-pressed="true"]')
            ?.scrollIntoView({ block: "nearest" });
    }, [cursor]);
    return { cursor, setCursor };
}

function PlanView({
    model,
    oref,
    state,
    card,
}: {
    model: AgentsViewModel;
    oref: string;
    state: InitiativeEditsState;
    card: EffortCardModel | null;
}) {
    const { cursor, setCursor } = usePlanKeys(oref, state);
    const cards = useCards();
    const pendingDeletes = useAtomValue(pendingDeleteKeysAtom);
    const { subs, ideas } = linkedUnder(
        oref,
        cards.filter((c) => !pendingDeletes.has(effortKey(c.oref)))
    );
    return (
        <>
            <span className={cn(REGION_LABEL, "px-2 pb-1.5 text-ink-mid")}>Chunks</span>
            <InitiativeChunkList
                model={model}
                oref={oref}
                state={state}
                card={card}
                cursor={cursor}
                onCursor={setCursor}
                // the sheet then draws the chunk (InitiativeSheet, chunkview.tsx) in place of this plan
                onOpenChunk={openSheetChunk}
            />
            <LinkedInitiatives
                subs={subs}
                ideas={ideas}
                onOpen={(c: EffortCardModel) => fireAndForget(() => openOrPeekAddress(model, c.oref))}
            />
        </>
    );
}

/**
 * The initiative sheet: its head in SheetShell's head slot (briefsheet.tsx), its body the plan or the Activity feed.
 */
export function InitiativeSheetBody({
    model,
    oref,
    state,
    card,
}: {
    model: AgentsViewModel;
    oref: string;
    state: InitiativeEditsState;
    card: EffortCardModel | null;
}) {
    const sheet = useAtomValue(initiativeSheetAtom);
    const briefing = useAtomValue(briefingStateAtom);
    const freshTs = briefing.snapshot?.state.efforts?.find((e) => e.oref === oref)?.updatedts;
    const [error, setError] = useState<string | null>(null);
    const load = () => {
        setError(null);
        loadEffortDetail(oref, freshTs).catch((e) => setError(e instanceof Error ? e.message : String(e)));
    };
    // the subject's selection warms the cache; this covers a retry and an initiative ticked from outside the app
    // (loadEffortDetail decides whether the cached copy still stands)
    useEffect(() => {
        let cancelled = false;
        setError(null);
        loadEffortDetail(oref, freshTs).catch((e) => {
            if (!cancelled) {
                setError(e instanceof Error ? e.message : String(e));
            }
        });
        return () => {
            cancelled = true;
        };
    }, [oref, freshTs]);
    const { effort, detailsOpen, setDetailsOpen, mutateError } = state;

    if (sheet.view === "activity") {
        return (
            <div data-jarvis-initiative-sheet-body="activity" className="flex min-h-0 flex-1 flex-col bg-background">
                <EffortDetailView model={model} onBack={backToPlan} />
            </div>
        );
    }
    return (
        <div
            data-jarvis-initiative-sheet-body="plan"
            className={cn(STAGE_SCROLLER, "min-h-0 flex-1 bg-background")}
            aria-live="polite"
        >
            <div className="flex flex-col px-3 pt-3">
                {mutateError != null ? <p className="px-2 pb-2 text-[11px] text-error">{mutateError}</p> : null}
                {error != null && effort == null ? (
                    <div className="mx-2 flex flex-col gap-2 rounded-[10px] border border-border bg-surface px-4 py-3">
                        <span className="text-[13px] font-semibold text-primary">Couldn't load this initiative.</span>
                        <span className="text-[12px] text-secondary">{error}</span>
                        <button
                            type="button"
                            onClick={load}
                            className="mt-1 w-fit cursor-pointer rounded-[7px] border border-border bg-surface-raised px-2.5 py-1 text-[11px] font-semibold text-secondary hover:text-primary"
                        >
                            Retry
                        </button>
                    </div>
                ) : effort == null ? (
                    <div data-jarvis-initiative-sheet-body="loading" className="flex flex-col gap-2 px-2">
                        {[0, 1, 2, 3].map((k) => (
                            <span
                                key={k}
                                className="h-8 animate-pulse rounded-[6px] bg-edge-strong motion-reduce:animate-none"
                            />
                        ))}
                    </div>
                ) : (
                    <PlanView model={model} oref={oref} state={state} card={card} />
                )}
            </div>
            {detailsOpen && effort != null ? (
                <EffortCreateForm
                    onClose={() => setDetailsOpen(false)}
                    edit={{
                        oref,
                        details: {
                            title: effort.title,
                            project: effort.project ?? "",
                            ticket: effort.ticket ?? "",
                            parent: effort.parentoid ?? "",
                        },
                    }}
                />
            ) : null}
        </div>
    );
}

/**
 * The Brief's sheet on an initiative (briefsheet.tsx's effort face): the head in SheetShell's head slot, the body under
 * it, sharing one edits hook so the head's Rename and Edit details act on the plan the body draws.
 */
export function InitiativeSheet({
    model,
    effortId,
    onClose,
}: {
    model: AgentsViewModel;
    effortId: string;
    onClose: () => void;
}) {
    const oref = "effort:" + effortId.replace(/^effort:/, "");
    const opts = useMemo(() => ({ onDeleted: onClose }), [onClose]);
    const state = useInitiativeEdits(oref, opts);
    const cards = useCards();
    const card = cards.find((c) => c.oref === oref) ?? null;
    const sheet = useAtomValue(initiativeSheetAtom);
    // a chunk open in the sheet (decision 9) takes its head and body; until the detail holds it, the plan shows
    const chunk = sheet.view === "plan" ? state.selectedChunk : null;
    // a chunk that was open and went (deleted, here or elsewhere) returns the sheet to its plan
    const shownChunk = useRef<string | null>(null);
    useEffect(() => {
        if (chunk != null) {
            shownChunk.current = chunk.label;
        } else if (sheet.chunk != null && shownChunk.current === sheet.chunk && state.effort != null) {
            shownChunk.current = null;
            backToPlan();
        }
    }, [chunk, sheet.chunk, state.effort]);
    // the Brief's initiative menu opened the sheet to rename it or to edit its details: done once its plan is loaded
    const [request, setRequest] = useAtom(initiativeSheetRequestAtom);
    const { effort, setRenaming, setDetailsOpen } = state;
    useEffect(() => {
        if (request == null || request.oref !== oref || effort == null) {
            return;
        }
        setRequest(null);
        if (request.action === "rename") {
            setRenaming(effort.title);
        } else {
            setDetailsOpen(true);
        }
    }, [request, oref, effort, setRequest, setRenaming, setDetailsOpen]);
    return (
        <SheetShell
            face="effort"
            label="initiative"
            title={state.effort?.title ?? card?.title ?? ""}
            head={
                chunk != null ? (
                    <ChunkViewHead
                        model={model}
                        oref={oref}
                        state={state}
                        card={card}
                        chunk={chunk}
                        onClose={onClose}
                    />
                ) : (
                    <InitiativeSheetHead model={model} oref={oref} state={state} card={card} onClose={onClose} />
                )
            }
            onClose={onClose}
        >
            {chunk != null ? (
                <ChunkView key={chunk.label} model={model} oref={oref} state={state} chunk={chunk} />
            ) : (
                <InitiativeSheetBody model={model} oref={oref} state={state} card={card} />
            )}
        </SheetShell>
    );
}
