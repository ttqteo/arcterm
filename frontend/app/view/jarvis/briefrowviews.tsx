// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0
//
// One row component per Brief region, each drawn to the design's own anatomy
// (docs/prototype/jarvis-brief-editing.dc.html). The regions stopped sharing one LineRow because the
// design gives them different anatomies: Waiting acts in place, Runs is two lines under a type badge,
// Behind you is two lines under a wording column.

import { cn } from "@/util/util";
import { ArrowLeft, ArrowRight, Clock, CornerDownRight, Ellipsis, Lightbulb } from "lucide-react";
import type { ReactNode } from "react";
import type { QueueAct } from "./briefingmodel";
import { initiativeLine, type BriefLine, type RunRowFace } from "./briefrows";
import { CURSOR_RING, cursorAttrs, FAINT_TEXT, REGION_LABEL, ROW_BORDER, SMALL_BTN, TONE_TEXT } from "./briefstyle";
import type { ChunkTone, EffortCardModel } from "./effortmodel";
import type { InitiativeResume } from "./initiativework";
import type { EventTone } from "./reviewmodel";

const PULSE = "pulse-dot-slow";
// a sub-initiative's row is indented this many px per level under the one it is part of
const NEST_INDENT = 20;

// the kind chip's fill for the tone queueLine gives it (briefrows.ts queueTone)
const KIND_CHIP: Partial<Record<BriefLine["kindTone"], string>> = {
    asking: "bg-askingbg text-asking",
    error: "bg-error/12 text-error",
};

// Two lines: the title, which may wrap once, over why it waits, where from and how long. The one-line row cut the
// title short and threw its source and age to the far edge of a wide Brief.
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
    const sub = [line.why.replace(/\.$/, ""), line.meta].filter((p) => p !== "").join(" · ");
    const go = act.label === "Go to agent";
    return (
        <div
            data-jarvis-brief-row="queue"
            data-peek={onOpen != null ? "" : undefined}
            {...cursorAttrs(focused)}
            onClick={onOpen}
            className={cn(
                "flex items-center gap-3 py-2 hover:bg-surface-hover",
                ROW_BORDER,
                onOpen != null && "cursor-pointer",
                focused && CURSOR_RING
            )}
        >
            <span
                className={cn(
                    "mt-px w-[68px] flex-none self-start truncate rounded-[5px] px-1.5 py-px text-center text-[10px] font-semibold tracking-[.02em]",
                    KIND_CHIP[line.kindTone] ?? "bg-pill text-ink-mid"
                )}
            >
                {line.kind}
            </span>
            <span className="flex min-w-0 flex-1 flex-col gap-0.5">
                <span title={line.title} className="line-clamp-2 break-words text-[13px] font-medium text-ink-hi">
                    {line.title}
                </span>
                <span className="flex min-w-0 gap-1 text-[11px] tabular-nums text-ink-mid">
                    <span title={sub} className="min-w-0 truncate">
                        {sub}
                    </span>
                    {line.age !== "" ? (
                        <span className="flex-none whitespace-nowrap">
                            {sub !== "" ? "· " : ""}
                            {line.age}
                        </span>
                    ) : null}
                </span>
            </span>
            <button
                type="button"
                data-jarvis-queue-act={act.kind}
                title={go ? "Go to the agent open on this initiative" : undefined}
                onClick={(e) => {
                    e.stopPropagation();
                    onAct();
                }}
                className={cn(
                    "min-w-[66px] flex-none cursor-pointer whitespace-nowrap rounded-[6px] border px-2.5 py-[3px] text-[10.5px] font-semibold hover:border-edge-strong hover:text-ink-hi focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent",
                    act.label === "Approve" || go
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
            title="Rename, edit, pause, archive, link or delete"
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
    changed,
    idle,
    trailing,
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
    // updated since the person last reviewed it: a dot before the title
    changed?: boolean;
    // "idle 3w": still for two weeks or more with nobody on it; the status cell says it when nothing else does
    idle?: string;
    // replaces the Work on and menu buttons at the row's end (a review row's reason)
    trailing?: ReactNode;
    // absent, the row is not a button: the review's open initiative has nothing to open
    onOpen?: () => void;
    onWork?: () => void;
    onContextMenu?: (e: React.MouseEvent) => void;
    // the opened row's detail
    children?: ReactNode;
}) {
    const p = line.progress ?? { done: 0, total: 0, pct: 0 };
    // a paused or archived initiative is not where the next hour goes
    const resting = line.state === "paused" || line.state === "archived";
    // what the cell at the row's end says: stuck, an agent on it, its state (paused, archived), how long it has sat
    // idle, else when it last moved
    const status =
        line.noteLabel === "Blocked on"
            ? { text: "● blocked", tone: "text-asking" }
            : resume?.kind === "go"
              ? { text: "● agent open", tone: "text-success" }
              : line.state !== ""
                ? { text: line.state, tone: TONE_TEXT[line.stateTone] }
                : idle != null
                  ? { text: idle, tone: "text-ink-faint" }
                  : { text: resume?.kind === "work" ? resume.when : "", tone: "text-ink-mid" };
    // a sub-initiative sits under the one it is part of: indented, with an elbow reaching up to it
    const depth = line.depth ?? 0;
    const subCount = line.subCount ?? 0;
    return (
        <div
            data-jarvis-brief-row="initiative"
            data-jarvis-initiative-card={expanded ? "open" : "closed"}
            data-jarvis-initiative-depth={depth}
            {...cursorAttrs(focused)}
            onContextMenu={onContextMenu}
            style={depth > 0 ? { marginLeft: depth * NEST_INDENT } : undefined}
            className={cn(
                "group flex min-w-0 flex-col rounded-[8px] border",
                depth > 0 && "relative",
                expanded ? "border-edge-strong bg-surface-raised" : "border-transparent",
                focused && CURSOR_RING,
                fresh && "fresh-mark"
            )}
        >
            {depth > 0 ? (
                <span
                    aria-hidden
                    data-jarvis-initiative-elbow
                    className="pointer-events-none absolute -left-3 -top-1.5 h-6 w-2.5 rounded-bl-[6px] border-b-[1.5px] border-l-[1.5px] border-edge-strong"
                />
            ) : null}
            <div
                role={onOpen != null ? "button" : undefined}
                tabIndex={onOpen != null ? -1 : undefined}
                aria-expanded={onOpen != null ? expanded : undefined}
                aria-label={onOpen != null ? (expanded ? `Collapse ${line.title}` : `Open ${line.title}`) : undefined}
                onClick={onOpen}
                className={cn(
                    "grid grid-cols-[minmax(0,1.1fr)_150px_minmax(0,1.4fr)_74px_auto] items-center gap-3.5 rounded-[7px] px-2.5 py-[7px]",
                    onOpen != null && "cursor-pointer",
                    !expanded && onOpen != null && "hover:bg-surface-hover",
                    resting && "opacity-60"
                )}
            >
                <div className="flex min-w-0 flex-col gap-px">
                    {titleSlot ?? (
                        <span className="flex min-w-0 items-center gap-1.5">
                            {changed ? (
                                <span
                                    aria-hidden
                                    data-jarvis-changed-dot
                                    title="Changed since you last reviewed it"
                                    className="h-1.5 w-1.5 flex-none rounded-full bg-accent"
                                />
                            ) : null}
                            <span title={line.title} className="truncate text-[13px] font-semibold text-ink-hi">
                                {line.title}
                            </span>
                            {subCount > 0 ? (
                                <span
                                    data-jarvis-initiative-sub
                                    className="ml-0.5 flex-none text-[10.5px] font-medium text-ink-mid"
                                >
                                    +{subCount} sub
                                </span>
                            ) : null}
                        </span>
                    )}
                    <span data-jarvis-initiative-meta className="truncate text-[10.5px] text-muted">
                        {line.meta}
                    </span>
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
                    {trailing ?? (
                        <>
                            {resume != null && onWork != null ? (
                                <WorkOnButton resume={resume} focused={focused} onWork={onWork} always />
                            ) : null}
                            {onContextMenu != null ? <MenuButton title={line.title} onMenu={onContextMenu} /> : null}
                        </>
                    )}
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

const LINKED_ROW =
    "flex h-7 w-full cursor-pointer items-center gap-2.5 rounded-[6px] px-2 text-left hover:bg-surface-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent";

// What is linked under an opened initiative: its sub-initiatives (title, done/total, status), then the ideas linked to it
// (title, and how many chunks wait for a decision). A row opens that initiative's own row on the List; the idea stays in
// the Ideas column as well. Each row reads its card through initiativeLine, so it says what the card's own row says.
export function LinkedInitiatives({
    subs,
    ideas,
    onOpen,
}: {
    subs: EffortCardModel[];
    ideas: EffortCardModel[];
    onOpen: (card: EffortCardModel) => void;
}) {
    if (subs.length === 0 && ideas.length === 0) {
        return null;
    }
    return (
        <div data-jarvis-linked className="flex flex-col gap-2.5 border-t border-edge-mid px-3 py-2.5">
            {subs.length > 0 ? (
                <section data-jarvis-linked-subs className="flex flex-col gap-0.5">
                    <h4 className={cn(REGION_LABEL, "px-2 pb-0.5 text-ink-mid")}>
                        Sub-initiatives <span className="font-normal tabular-nums">{subs.length}</span>
                    </h4>
                    {subs.map((card) => {
                        const line = initiativeLine(card);
                        const p = line.progress ?? { done: 0, total: 0 };
                        const status =
                            line.state !== ""
                                ? { text: line.state, tone: TONE_TEXT[line.stateTone] }
                                : { text: "active", tone: "text-ink-mid" };
                        return (
                            <button
                                key={card.oref}
                                type="button"
                                data-jarvis-linked-sub={card.oref}
                                onClick={() => onOpen(card)}
                                className={LINKED_ROW}
                            >
                                <span title={card.title} className="min-w-0 flex-1 truncate text-[12.5px] text-ink-hi">
                                    {card.title}
                                </span>
                                <span className="flex-none text-[11px] font-semibold tabular-nums text-secondary">
                                    {p.done}/{p.total}
                                </span>
                                <span
                                    className={cn("w-[72px] flex-none truncate text-right text-[10.5px]", status.tone)}
                                >
                                    {status.text}
                                </span>
                            </button>
                        );
                    })}
                </section>
            ) : null}
            {ideas.length > 0 ? (
                <section data-jarvis-linked-ideas className="flex flex-col gap-0.5">
                    <h4 className={cn(REGION_LABEL, "px-2 pb-0.5 text-ink-mid")}>
                        Ideas <span className="font-normal tabular-nums">{ideas.length}</span>
                    </h4>
                    {ideas.map((card) => {
                        const proposed = initiativeLine(card).proposed;
                        return (
                            <button
                                key={card.oref}
                                type="button"
                                data-jarvis-linked-idea={card.oref}
                                onClick={() => onOpen(card)}
                                className={LINKED_ROW}
                            >
                                <Lightbulb size={12} aria-hidden className="flex-none text-muted" />
                                <span title={card.title} className="min-w-0 flex-1 truncate text-[12.5px] text-primary">
                                    {card.title}
                                </span>
                                {proposed != null ? (
                                    <span
                                        data-jarvis-linked-proposed
                                        className="flex-none whitespace-nowrap text-[10.5px] tabular-nums text-asking"
                                    >
                                        {proposed}
                                    </span>
                                ) : null}
                            </button>
                        );
                    })}
                </section>
            ) : null}
        </div>
    );
}

// --- Review mode ---------------------------------------------------------------------------------------------
// The Initiatives region in a review pass: one initiative open at a time, the rest as rows with the reason each is
// there. The model is reviewmodel.ts; the state is reviewstore.ts; briefsurface.tsx wires them to the rows.

const REVIEW_BTN =
    "inline-flex h-[26px] cursor-pointer items-center gap-1.5 whitespace-nowrap rounded-[7px] border bg-surface-raised px-2.5 text-[11.5px] font-semibold hover:border-edge-strong hover:text-ink-hi focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent";
const REVIEW_STEP =
    "flex h-6 w-6 flex-none cursor-pointer items-center justify-center rounded-[6px] border border-border text-ink-mid hover:border-edge-strong hover:text-ink-hi focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent";
const EVENT_TEXT: Record<EventTone, string> = { ok: "text-success", accent: "text-accent-soft", muted: "text-ink-mid" };

// What sits in the Initiatives heading: Review · N while there is something to review, and during a pass where it
// is, with the way to step and to leave.
export function ReviewTools({
    count,
    pass,
    onEnter,
    onStep,
    onExit,
}: {
    // the queue's length
    count: number;
    // the pass, when one is on: where it is and how long it is
    pass: { at: number; total: number } | null;
    onEnter: () => void;
    onStep: (delta: number) => void;
    onExit: () => void;
}) {
    if (pass == null) {
        return count > 0 ? (
            <button
                type="button"
                data-jarvis-review-enter
                title="Review what changed and what sat idle (v)"
                onClick={onEnter}
                className={cn(SMALL_BTN, "flex-none whitespace-nowrap")}
            >
                Review · {count}
            </button>
        ) : null;
    }
    return (
        <div data-jarvis-review-tools className="flex min-w-0 flex-none items-center gap-2.5">
            <span
                data-jarvis-review-pos
                className="flex h-[22px] flex-none items-center whitespace-nowrap rounded-[6px] border border-edge-strong bg-surface-selected px-[9px] text-[11px] font-semibold tabular-nums text-ink-hi"
            >
                Reviewing {pass.at} of {pass.total}
            </span>
            <button
                type="button"
                data-jarvis-review-step="prev"
                aria-label="Previous initiative"
                title="Previous (←, k)"
                onClick={() => onStep(-1)}
                className={REVIEW_STEP}
            >
                <ArrowLeft size={12} aria-hidden />
            </button>
            <button
                type="button"
                data-jarvis-review-step="next"
                aria-label="Next initiative"
                title="Next (→, j)"
                onClick={() => onStep(1)}
                className={REVIEW_STEP}
            >
                <ArrowRight size={12} aria-hidden />
            </button>
            <span className="truncate text-[10.5px] text-ink-mid">changed since you reviewed, then idle</span>
            <button
                type="button"
                data-jarvis-review-exit
                onClick={onExit}
                className={cn(REVIEW_BTN, "flex-none border-edge-mid text-secondary")}
            >
                Exit review
                <kbd className="font-mono text-[10px] font-normal text-ink-mid">Esc</kbd>
            </button>
        </div>
    );
}

export type ReviewEventRow = { glyph: string; text: string; when: string; tone: EventTone };
export type ReviewActionBtn = { id: string; label: string; onClick: () => void };

// The open initiative's body in a pass: what happened since the mark, then what to do about it. The first action is
// the one the initiative most likely needs (Pause and Archive lead for an idle one).
export function ReviewBody({
    since,
    events,
    quiet,
    actions,
    onMark,
}: {
    since: string;
    events: ReviewEventRow[];
    // said in place of the events when there are none
    quiet: string;
    actions: ReviewActionBtn[];
    onMark: () => void;
}) {
    return (
        <>
            <div
                data-jarvis-review-since
                className="mx-2.5 mb-2.5 mt-0.5 flex flex-col gap-[7px] rounded-[7px] bg-surface px-3 py-2.5"
            >
                <div className="flex items-center gap-2">
                    <span className={cn(REGION_LABEL, "text-ink-mid")}>Since you reviewed</span>
                    <span className="text-[10.5px] text-ink-mid">{since}</span>
                </div>
                {events.length === 0 ? (
                    <div data-jarvis-review-quiet className="text-[12px] text-ink-faint">
                        {quiet}
                    </div>
                ) : (
                    events.map((ev, i) => (
                        <div key={i} data-jarvis-review-event className="flex items-baseline gap-[9px] text-[12px]">
                            <span
                                aria-hidden
                                className={cn("w-3 flex-none text-center font-bold", EVENT_TEXT[ev.tone])}
                            >
                                {ev.glyph}
                            </span>
                            <span className="min-w-0 flex-1 text-secondary">{ev.text}</span>
                            <span className="flex-none text-[10.5px] tabular-nums text-ink-mid">{ev.when}</span>
                        </div>
                    ))
                )}
            </div>
            <div className="flex items-center gap-1.5 px-2.5 pb-2.5">
                {actions.map((a, k) => (
                    <button
                        key={a.id}
                        type="button"
                        data-jarvis-review-action={a.id}
                        onClick={a.onClick}
                        className={cn(REVIEW_BTN, "text-secondary", k === 0 ? "border-edge-strong" : "border-edge-mid")}
                    >
                        {a.label}
                    </button>
                ))}
                <span className="flex-1" />
                <button
                    type="button"
                    data-jarvis-review-action="mark"
                    onClick={onMark}
                    className={cn(REVIEW_BTN, "border-edge-strong bg-surface-selected text-primary")}
                >
                    Mark reviewed
                    <kbd className="font-mono text-[10px] font-normal text-ink-mid">↵</kbd>
                </button>
            </div>
        </>
    );
}

// The pass's end: every initiative in it marked
export function ReviewDone({ onBack }: { onBack: () => void }) {
    return (
        <div
            data-jarvis-review-done
            className="flex items-center gap-2.5 rounded-[8px] border border-dashed border-edge-mid p-[18px] text-[12.5px] text-secondary"
        >
            <span aria-hidden className="text-success">
                ✓
            </span>
            All reviewed. Next review lights up when an initiative changes.
            <span className="flex-1" />
            <button type="button" onClick={onBack} className={cn(REVIEW_BTN, "border-edge-mid text-secondary")}>
                Back to the list
            </button>
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

// A plan waiting in the run queue (briefqueue.ts), drawn among the Runs: under the run or the queued plan it waits on,
// one NEST_INDENT per link, a room-only one at the end. No buttons: Start now, Run next and Remove live in the sheet
// the row opens, as every Brief row's actions do. It carries no data-peek: the sheet is all it opens, so a held Ctrl
// has nothing to turn into a peek.
export function QueuedRunRowView({
    line,
    focused,
    selected,
    onOpen,
}: {
    line: BriefLine;
    focused: boolean;
    selected: boolean;
    onOpen: () => void;
}) {
    const q = line.queued!;
    const depth = line.depth ?? 0;
    return (
        <div
            data-jarvis-brief-row="queued"
            data-brief-queued={q.entryId}
            data-brief-queued-depth={depth}
            {...cursorAttrs(focused)}
            onClick={onOpen}
            style={depth > 0 ? { marginLeft: depth * NEST_INDENT } : undefined}
            className={cn(
                "flex cursor-pointer items-center gap-3 py-[7px] hover:bg-surface-hover",
                ROW_BORDER,
                selected && "bg-surface-selected",
                focused && CURSOR_RING
            )}
        >
            <Clock size={11} aria-hidden className={cn("flex-none", q.blocked ? "text-warning" : "text-muted")} />
            <div className="flex min-w-0 flex-1 flex-col gap-0.5">
                <div className="flex min-w-0 items-center gap-2">
                    <span className="flex-none rounded-[5px] border border-edge-mid px-1.5 text-[10.5px] leading-[17px] text-ink-mid">
                        queued
                    </span>
                    <span title={line.title} className="min-w-0 truncate text-[13px] text-ink-mid">
                        {line.title}
                    </span>
                </div>
                <div className={cn("flex min-w-0 items-center gap-2", FAINT_TEXT)}>
                    <span data-brief-queued-meta className="min-w-0 truncate">
                        {line.meta} · {line.age}
                    </span>
                </div>
            </div>
            <span
                data-brief-queued-state
                title={q.blocked && q.reason ? q.reason : undefined}
                className={cn(
                    "w-[62px] flex-none text-right text-[11px] font-semibold tabular-nums",
                    q.blocked ? "text-warning" : "text-muted"
                )}
            >
                {line.state}
            </span>
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
