// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0
//
// One row component per Brief region, each drawn to the design's own anatomy
// (docs/prototype/jarvis-brief-editing.dc.html). The regions stopped sharing one LineRow because the
// design gives them different anatomies: Waiting acts in place, Runs is two lines under a type badge,
// Behind you is two lines under a wording column.

import { cn } from "@/util/util";
import { CornerDownRight, Ellipsis, Lightbulb } from "lucide-react";
import type { ReactNode } from "react";
import type { QueueAct } from "./briefingmodel";
import type { BriefLine, RunRowFace } from "./briefrows";
import { CURSOR_RING, cursorAttrs, FAINT_TEXT, ROW_BORDER, SMALL_BTN, TONE_TEXT } from "./briefstyle";
import type { ChunkTone } from "./effortmodel";
import type { InitiativeResume } from "./initiativework";

const PULSE = "pulse-dot-slow";

export function WaitingRow({
    line,
    focused,
    act,
    onOpen,
    onAct,
}: {
    line: BriefLine;
    focused: boolean;
    act: QueueAct;
    onOpen?: (e: React.MouseEvent) => void;
    onAct: () => void;
}) {
    return (
        <div
            data-jarvis-brief-row="queue"
            data-peek={onOpen != null ? "" : undefined}
            {...cursorAttrs(focused)}
            onClick={onOpen}
            className={cn(
                "flex items-center gap-[13px] py-1.5 hover:bg-surface-hover",
                ROW_BORDER,
                onOpen != null && "cursor-pointer",
                focused && CURSOR_RING
            )}
        >
            <span
                className={cn(
                    "w-[92px] flex-none truncate text-[10.5px] font-semibold tracking-[.02em]",
                    TONE_TEXT[line.kindTone]
                )}
            >
                {line.kind}
            </span>
            <span
                title={line.why ? `${line.title} — ${line.why}` : line.title}
                className="min-w-0 flex-1 truncate text-[13px] text-ink-hi"
            >
                {line.title}
                {line.why ? <span className="text-ink-mid"> — {line.why}</span> : null}
            </span>
            <span className="w-[200px] flex-none truncate text-right text-[11px] tabular-nums text-ink-mid">
                {line.meta}
            </span>
            <span
                className={cn(
                    "w-10 flex-none text-right text-[11px] font-semibold tabular-nums",
                    TONE_TEXT[line.kindTone]
                )}
            >
                {line.age}
            </span>
            <button
                type="button"
                data-jarvis-queue-act={act.kind}
                onClick={(e) => {
                    e.stopPropagation();
                    onAct();
                }}
                className={cn(
                    "w-[66px] flex-none cursor-pointer rounded-[6px] border py-[3px] text-[10.5px] font-semibold hover:border-edge-strong hover:text-ink-hi focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent",
                    act.label === "Approve"
                        ? "border-success/35 bg-success/12 text-success"
                        : "border-edge-mid text-secondary"
                )}
            >
                {act.label}
            </button>
        </div>
    );
}

// Work on / Go to agent. In flow at a fixed width and shown by opacity, so the row never reflows under the
// cursor, and a hidden button can still be tabbed to.
function WorkOnButton({
    resume,
    focused,
    onWork,
    always,
}: {
    resume: InitiativeResume;
    focused: boolean;
    onWork: () => void;
    // on an initiative row it is always shown: the row is the place to start
    always?: boolean;
}) {
    const go = resume.kind === "go";
    return (
        <button
            type="button"
            data-jarvis-work-on={resume.kind}
            title={go ? "Go to the agent open on this initiative (w)" : "Work on this in a new agent (w)"}
            onClick={(e) => {
                e.stopPropagation();
                onWork();
            }}
            className={cn(
                "flex w-[92px] flex-none cursor-pointer items-center justify-center gap-1.5 rounded-[6px] border py-[3px] text-[10.5px] font-semibold opacity-0 group-hover:opacity-100 focus-visible:opacity-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent",
                go
                    ? "border-success/45 bg-success/12 text-success"
                    : "border-accent/45 bg-accentbg text-accent-soft hover:text-accent-50",
                (focused || always) && "opacity-100"
            )}
        >
            {go ? "Go to agent" : "Work on"}
            <span className="rounded-[4px] border border-current/35 px-1 text-[9.5px] leading-[14px]">w</span>
        </button>
    );
}

// each chunk in plan order, coloured by where it stands. Past SEGMENT_GAP_LIMIT chunks the gaps would eat
// the segments, so the bar reads as one strip of the same colours.
const SEGMENT_GAP_LIMIT = 24;
const SEGMENT_BG: Record<ChunkTone, string> = {
    done: "bg-success/45",
    active: "bg-working",
    blocked: "bg-asking",
    deferred: "bg-ink-faint",
    skipped: "bg-ink-faint",
    pending: "bg-edge-strong",
};

export function SegmentBar({ segments, className }: { segments: ChunkTone[]; className?: string }) {
    const gapless = segments.length > SEGMENT_GAP_LIMIT;
    return (
        <span
            aria-hidden
            data-jarvis-segment-bar
            className={cn(
                "flex h-1.5 min-w-0",
                gapless ? "gap-0 overflow-hidden rounded-[2px]" : "gap-[3px]",
                className
            )}
        >
            {segments.map((tone, i) => (
                <span key={i} className={cn("min-w-0 flex-1", !gapless && "rounded-[2px]", SEGMENT_BG[tone])} />
            ))}
        </span>
    );
}

const NOTE_LABEL_TEXT: Record<NonNullable<BriefLine["noteLabel"]>, string> = {
    Next: "text-accent",
    "Blocked on": "text-asking",
    Done: "text-success",
};

function MenuButton({
    title,
    onMenu,
    className,
}: {
    title: string;
    onMenu: (e: React.MouseEvent) => void;
    className?: string;
}) {
    return (
        <button
            type="button"
            data-jarvis-initiative-menu
            title="Rename, edit, pause, archive or delete"
            aria-label={`Actions for ${title}`}
            onClick={(e) => {
                e.stopPropagation();
                onMenu(e);
            }}
            className={cn(
                "flex h-[26px] w-[26px] flex-none cursor-pointer items-center justify-center rounded-[6px] text-muted hover:bg-surface-hover hover:text-ink-hi focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent",
                className
            )}
        >
            <Ellipsis size={14} aria-hidden />
        </button>
    );
}

// "4 proposed": the chunks an agent put forward that wait for a decision, in the asking tone. Drawn right-aligned in
// the column before a row's actions; the opened row decides them (inlinetrackerview's ProposedGroup).
function ProposedCount({ text, className }: { text?: string; className?: string }) {
    if (text == null) {
        return null;
    }
    return (
        <span
            data-jarvis-proposed-count
            className={cn("whitespace-nowrap text-right text-[10.5px] tabular-nums text-asking", className)}
        >
            {text}
        </span>
    );
}

// A tracker: an initiative with a plan, one dense row in the Initiatives box. Opened, it expands where it is:
// the chunk editor renders under the row inside the same raised box, so nothing jumps and no hole is left.
export function InitiativeRow({
    line,
    focused,
    fresh,
    expanded,
    titleSlot,
    resume,
    onOpen,
    onWork,
    onContextMenu,
    children,
}: {
    line: BriefLine;
    focused: boolean;
    fresh: boolean;
    expanded: boolean;
    // the rename input replaces the title in place
    titleSlot?: ReactNode;
    // where the initiative was left and what Work on does; absent on an archived initiative
    resume?: InitiativeResume;
    onOpen: () => void;
    onWork?: () => void;
    onContextMenu?: (e: React.MouseEvent) => void;
    // the opened row's detail
    children?: ReactNode;
}) {
    const p = line.progress ?? { done: 0, total: 0, pct: 0 };
    // a paused or archived initiative is not where the next hour goes
    const resting = line.state === "paused" || line.state === "archived";
    // what the cell at the row's end says: stuck, an agent on it, its state (paused, archived), else when it last moved
    const status =
        line.noteLabel === "Blocked on"
            ? { text: "● blocked", tone: "text-asking" }
            : resume?.kind === "go"
              ? { text: "● agent open", tone: "text-success" }
              : line.state !== ""
                ? { text: line.state, tone: TONE_TEXT[line.stateTone] }
                : { text: resume?.kind === "work" ? resume.when : "", tone: "text-ink-mid" };
    return (
        <div
            data-jarvis-brief-row="initiative"
            data-jarvis-initiative-card={expanded ? "open" : "closed"}
            {...cursorAttrs(focused)}
            onContextMenu={onContextMenu}
            className={cn(
                "group flex min-w-0 flex-col rounded-[8px] border",
                expanded ? "border-edge-strong bg-surface-raised" : "border-transparent",
                focused && CURSOR_RING,
                fresh && "fresh-mark"
            )}
        >
            <div
                role="button"
                tabIndex={-1}
                aria-expanded={expanded}
                aria-label={expanded ? `Collapse ${line.title}` : `Open ${line.title}`}
                onClick={onOpen}
                className={cn(
                    "grid cursor-pointer grid-cols-[minmax(0,1.1fr)_150px_minmax(0,1.4fr)_74px_auto] items-center gap-3.5 rounded-[7px] px-2.5 py-[7px]",
                    !expanded && "hover:bg-surface-hover",
                    resting && "opacity-60"
                )}
            >
                <div className="flex min-w-0 flex-col gap-px">
                    {titleSlot ?? (
                        <span title={line.title} className="truncate text-[13px] font-semibold text-ink-hi">
                            {line.title}
                        </span>
                    )}
                    <span className="truncate text-[10.5px] text-muted">{line.meta}</span>
                </div>
                <div className="flex items-center gap-2">
                    <SegmentBar segments={line.segments ?? []} className="flex-1" />
                    <span className="w-[34px] flex-none text-right text-[11px] font-semibold tabular-nums text-secondary">
                        {p.done}/{p.total}
                    </span>
                </div>
                {line.noteLabel != null ? (
                    <div className="flex min-w-0 items-baseline gap-2">
                        <span className={cn("flex-none text-[10.5px] font-semibold", NOTE_LABEL_TEXT[line.noteLabel])}>
                            {line.noteLabel}
                        </span>
                        <span title={line.note} className="min-w-0 truncate text-[12px] text-secondary">
                            {line.note}
                        </span>
                    </div>
                ) : (
                    <span />
                )}
                {/* the column before the actions: what the row's state says, and under it the plan waiting for
                    a decision. The state's span is empty (no height) on a row with nothing to say. */}
                <div className="flex min-w-0 flex-col items-end">
                    <span
                        data-jarvis-initiative-status
                        className={cn(
                            "max-w-full truncate whitespace-nowrap text-right text-[10.5px] tabular-nums",
                            status.tone
                        )}
                    >
                        {status.text}
                    </span>
                    <ProposedCount text={line.proposed} className="max-w-full truncate" />
                </div>
                <div className="flex min-w-[122px] items-center justify-end gap-1">
                    {resume != null && onWork != null ? (
                        <WorkOnButton resume={resume} focused={focused} onWork={onWork} always />
                    ) : null}
                    {onContextMenu != null ? <MenuButton title={line.title} onMenu={onContextMenu} /> : null}
                </div>
            </div>
            {expanded && children != null ? (
                // the editor's own clicks must not fold the row
                <div className="border-t border-edge-mid" onClick={(e) => e.stopPropagation()}>
                    {children}
                </div>
            ) : null}
        </div>
    );
}

// An idea: a title written down to come back to, with no plan yet. One quiet row in the ideas column; the
// title wraps to two lines because the column is narrow.
export function IdeaRow({
    line,
    focused,
    fresh,
    expanded,
    titleSlot,
    onOpen,
    onContextMenu,
    children,
}: {
    line: BriefLine;
    focused: boolean;
    fresh: boolean;
    expanded: boolean;
    titleSlot?: ReactNode;
    onOpen: () => void;
    onContextMenu?: (e: React.MouseEvent) => void;
    children?: ReactNode;
}) {
    return (
        <div
            data-jarvis-brief-row="initiative"
            data-jarvis-idea-row={expanded ? "open" : "closed"}
            {...cursorAttrs(focused)}
            onContextMenu={onContextMenu}
            className={cn(
                "group flex flex-col border-b border-edge-faint last:border-b-0",
                expanded && "rounded-[8px] bg-surface-selected",
                focused && CURSOR_RING,
                fresh && "fresh-mark"
            )}
        >
            <div
                role="button"
                tabIndex={-1}
                aria-expanded={expanded}
                aria-label={expanded ? `Collapse ${line.title}` : `Open ${line.title}`}
                onClick={onOpen}
                className="flex cursor-pointer items-start gap-[9px] rounded-[8px] py-[9px] pl-2.5 pr-1.5 hover:bg-surface-hover"
            >
                <Lightbulb size={13} aria-hidden className="mt-0.5 flex-none text-muted" />
                <div className="flex min-w-0 flex-1 flex-col gap-[3px]">
                    {titleSlot ?? (
                        // opened, the whole title: the idea's detail has nothing else to read
                        <span
                            title={line.title}
                            className={cn(
                                "text-[12.5px] leading-[17px] text-primary",
                                expanded ? "whitespace-pre-wrap break-words" : "line-clamp-2"
                            )}
                        >
                            {line.title}
                        </span>
                    )}
                    <span className="truncate text-[11px] text-muted">
                        {line.meta}
                        {line.state !== "" ? ` · ${line.state}` : ""}
                    </span>
                </div>
                {/* the leading keeps it on the first line of the title beside it */}
                <ProposedCount text={line.proposed} className="mt-px flex-none leading-[17px]" />
                {onContextMenu != null ? <MenuButton title={line.title} onMenu={onContextMenu} /> : null}
            </div>
            {expanded && children != null ? <div onClick={(e) => e.stopPropagation()}>{children}</div> : null}
        </div>
    );
}

const DOT = {
    live: cn("bg-success", PULSE),
    asking: cn("bg-asking", PULSE),
    done: "bg-success/45",
    idle: "bg-feed-glyph",
};
const TYPE_BADGE = {
    orchestrator: "border-accent-soft/35 text-accent-soft",
    agent: "border-edge-mid text-ink-mid",
    "quick run": "border-edge-mid text-secondary",
};

export function RunRowView({
    line,
    face,
    focused,
    selected,
    onOpenSheet,
    onOpenChunk,
    onAnswer,
    onOpenAgent,
    onStop,
}: {
    line: BriefLine;
    face: RunRowFace;
    focused: boolean;
    selected: boolean;
    onOpenSheet?: (e: React.MouseEvent) => void;
    onOpenChunk: () => void;
    onAnswer: () => void;
    onOpenAgent: () => void;
    onStop: () => void;
}) {
    const stop = (fn: () => void) => (e: React.MouseEvent) => {
        e.stopPropagation();
        fn();
    };
    return (
        <div
            data-jarvis-brief-row="session"
            data-peek={onOpenSheet != null ? "" : undefined}
            {...cursorAttrs(focused)}
            onClick={onOpenSheet}
            className={cn(
                "flex items-center gap-3 py-[7px] hover:bg-surface-hover",
                ROW_BORDER,
                onOpenSheet != null && "cursor-pointer",
                selected && "bg-surface-selected",
                focused && CURSOR_RING
            )}
        >
            <span className={cn("h-[7px] w-[7px] flex-none rounded-full", DOT[face.dot])} />
            <div className="flex min-w-0 flex-1 flex-col gap-0.5">
                <div className="flex min-w-0 items-center gap-2">
                    <span
                        className={cn(
                            "flex-none rounded-[5px] border px-1.5 text-[10.5px] leading-[17px]",
                            TYPE_BADGE[face.type]
                        )}
                    >
                        {face.type}
                    </span>
                    <span
                        title={line.title}
                        className={cn("min-w-0 truncate text-[13px]", face.stopped ? "text-ink-mid" : "text-ink-hi")}
                    >
                        {line.title}
                    </span>
                </div>
                <div className={cn("flex min-w-0 items-center gap-2", FAINT_TEXT)}>
                    <span className="flex-none whitespace-nowrap">
                        {face.meta} · {face.elapsed}
                    </span>
                    {face.chunkLabel !== "" ? (
                        <button
                            type="button"
                            title="Open this chunk"
                            onClick={stop(onOpenChunk)}
                            className="flex min-w-0 cursor-pointer items-center gap-1 text-[10.5px] text-muted hover:text-accent-soft"
                        >
                            <CornerDownRight size={11} aria-hidden className="flex-none" />
                            <span className="truncate">{face.chunkLabel}</span>
                        </button>
                    ) : null}
                </div>
            </div>
            <span
                className={cn(
                    "w-[62px] flex-none text-right text-[11px] font-semibold tabular-nums",
                    TONE_TEXT[face.stateTone]
                )}
            >
                {face.state}
            </span>
            <div className="flex flex-none justify-end gap-1">
                {face.asking ? (
                    <button
                        type="button"
                        onClick={stop(onAnswer)}
                        className="cursor-pointer rounded-[6px] border border-asking/35 bg-asking/12 px-2 py-[3px] text-[10.5px] font-bold text-asking hover:bg-asking/20"
                    >
                        Answer
                    </button>
                ) : null}
                <button type="button" onClick={stop(onOpenAgent)} className={SMALL_BTN}>
                    Open
                </button>
                {face.canStop ? (
                    <button
                        type="button"
                        title="Stop this session"
                        onClick={stop(onStop)}
                        className={cn(SMALL_BTN, "text-ink-mid hover:border-error/50 hover:text-error")}
                    >
                        Stop
                    </button>
                ) : null}
            </div>
        </div>
    );
}

export function DeltaRowView({
    line,
    focused,
    onOpen,
}: {
    line: BriefLine;
    focused: boolean;
    onOpen?: (e: React.MouseEvent) => void;
}) {
    return (
        <div
            data-jarvis-brief-row="delta"
            data-peek={onOpen != null ? "" : undefined}
            {...cursorAttrs(focused)}
            onClick={onOpen}
            className={cn(
                "flex flex-col gap-0.5 py-1.5",
                ROW_BORDER,
                onOpen != null && "cursor-pointer hover:bg-surface-hover",
                focused && CURSOR_RING
            )}
        >
            <div className="flex items-baseline gap-2">
                <span
                    data-jarvis-delta-kind
                    className={cn("flex-none text-[10.5px] font-semibold", TONE_TEXT[line.kindTone])}
                >
                    {line.kind}
                </span>
                <span className="ml-auto flex-none text-[11px] tabular-nums text-ink-mid">{line.state}</span>
            </div>
            <span data-jarvis-delta-title title={line.title} className="truncate text-[13px] text-ink-hi">
                {line.title}
            </span>
            {line.detail ? <span className={cn("truncate", FAINT_TEXT)}>{line.detail}</span> : null}
        </div>
    );
}

export function ShippedRowView({
    line,
    focused,
    selected,
    onOpen,
}: {
    line: BriefLine;
    focused: boolean;
    selected: boolean;
    onOpen?: (e: React.MouseEvent) => void;
}) {
    return (
        <div
            data-jarvis-brief-row="shipped"
            data-peek={onOpen != null ? "" : undefined}
            {...cursorAttrs(focused)}
            onClick={onOpen}
            className={cn(
                "flex items-center gap-3 py-[7px] hover:bg-surface-hover",
                ROW_BORDER,
                onOpen != null ? "cursor-pointer" : "cursor-default",
                selected && "bg-surface-selected",
                focused && CURSOR_RING
            )}
        >
            <span className="h-[7px] w-[7px] flex-none rounded-full bg-success/45" />
            <div className="flex min-w-0 flex-1 flex-col gap-0.5">
                <div className="flex min-w-0 items-center gap-2">
                    <span title={line.title} className="min-w-0 truncate text-[13px] text-ink-hi">
                        {line.title}
                    </span>
                    {line.fresh ? (
                        <span className="flex-none rounded-[5px] border border-accent/40 px-1.5 text-[10.5px] leading-4 text-accent-soft">
                            new
                        </span>
                    ) : null}
                </div>
                {line.detail ? <span className={cn("truncate", FAINT_TEXT)}>{line.detail}</span> : null}
            </div>
            {line.hasReport ? <span className="flex-none text-[10.5px] text-ink-mid">report</span> : null}
            <span className="w-12 flex-none text-right text-[11px] tabular-nums text-ink-mid">{line.state}</span>
        </div>
    );
}
