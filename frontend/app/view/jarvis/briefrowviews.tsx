// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0
//
// One row component per Brief region, each drawn to the design's own anatomy
// (docs/prototype/jarvis-brief-editing.dc.html). The regions stopped sharing one LineRow because the
// design gives them different anatomies: Waiting acts in place, Runs is two lines under a type badge,
// Behind you is two lines under a wording column.

import { cn } from "@/util/util";
import { ChevronDown, ChevronRight, CornerDownRight } from "lucide-react";
import type { ReactNode } from "react";
import type { QueueAct } from "./briefingmodel";
import type { BriefLine, RunRowFace } from "./briefrows";
import { CURSOR_RING, cursorAttrs, FAINT_TEXT, ROW_BORDER, SMALL_BTN, TONE_TEXT } from "./briefstyle";
import type { InitiativeResume } from "./initiativework";
import { ProgressBar } from "./progressbar";

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

// Work on / Go to it. In flow at a fixed width and shown by opacity, so the row never reflows under the
// cursor, and a hidden button can still be tabbed to.
function WorkOnButton({ resume, focused, onWork }: { resume: InitiativeResume; focused: boolean; onWork: () => void }) {
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
                "flex w-[84px] flex-none cursor-pointer items-center justify-center gap-1.5 rounded-[6px] border py-[3px] text-[10.5px] font-semibold opacity-0 group-hover:opacity-100 focus-visible:opacity-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent",
                go
                    ? "border-success/45 bg-success/12 text-success"
                    : "border-accent/45 bg-accentbg text-accent-soft hover:text-accent-50",
                focused && "opacity-100"
            )}
        >
            {go ? "Go to it" : "Work on"}
            <span className="rounded-[4px] border border-current/35 px-1 text-[9.5px] leading-[14px]">w</span>
        </button>
    );
}

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
}: {
    line: BriefLine;
    focused: boolean;
    fresh: boolean;
    expanded: boolean;
    // the rename input replaces the title in place, keeping the progress, meta and state columns
    titleSlot?: ReactNode;
    // where the initiative was left and what Work on does; absent on an archived initiative
    resume?: InitiativeResume;
    onOpen: () => void;
    onWork?: () => void;
    onContextMenu?: (e: React.MouseEvent) => void;
}) {
    const p = line.progress ?? { done: 0, total: 0, pct: 0 };
    return (
        <div
            role="button"
            tabIndex={-1}
            aria-expanded={expanded}
            aria-label={expanded ? `Collapse ${line.title}` : `Open ${line.title}`}
            data-jarvis-brief-row="initiative"
            {...cursorAttrs(focused)}
            onClick={onOpen}
            onContextMenu={onContextMenu}
            className={cn(
                "group relative flex cursor-pointer flex-col gap-[3px] border px-[11px] py-[7px]",
                expanded
                    ? "rounded-t-[10px] border-border bg-surface-selected"
                    : "rounded-[9px] border-transparent border-b-edge-faint hover:bg-surface-hover",
                focused && CURSOR_RING,
                fresh && "fresh-mark"
            )}
        >
            <div className="flex min-w-0 items-center gap-[13px]">
                <span className="flex w-[92px] flex-none items-center gap-[7px]">
                    <ProgressBar
                        pct={p.pct}
                        tone={line.stateTone === "asking" ? "asking" : "success"}
                        className="h-1 min-w-0 flex-1 rounded-[2px]"
                    />
                    <span className="flex-none text-[10.5px] tabular-nums text-ink-mid">
                        {p.done}/{p.total}
                    </span>
                </span>
                {titleSlot ?? (
                    <span
                        title={line.note ? `${line.title} — ${line.note}` : line.title}
                        className="min-w-0 flex-1 truncate text-[13px] text-ink-hi"
                    >
                        {line.title}
                        {line.note ? <span className="text-ink-mid"> — {line.note}</span> : null}
                    </span>
                )}
                <span className="w-[190px] flex-none truncate text-right text-[11px] tabular-nums text-ink-mid">
                    {line.meta}
                </span>
                <span
                    className={cn(
                        "w-[76px] flex-none truncate text-right text-[11px] font-semibold tabular-nums",
                        TONE_TEXT[line.stateTone]
                    )}
                >
                    {line.state}
                </span>
                {resume != null && onWork != null ? (
                    <WorkOnButton resume={resume} focused={focused} onWork={onWork} />
                ) : null}
                {expanded ? (
                    <ChevronDown size={12} aria-hidden className="flex-none text-muted" />
                ) : (
                    <ChevronRight size={12} aria-hidden className="flex-none text-muted" />
                )}
            </div>
            {resume != null ? (
                // lined up under the title, past the progress column
                <div className={cn("flex min-w-0 items-baseline gap-2 pl-[105px] pr-[110px]", FAINT_TEXT)}>
                    <span
                        className={cn(
                            "flex flex-none items-center gap-[5px]",
                            resume.kind === "go" ? "text-success" : "text-ink-mid"
                        )}
                    >
                        <span
                            className={cn(
                                "h-1.5 w-1.5 rounded-full",
                                resume.kind === "go" ? "bg-success" : "bg-ink-faint"
                            )}
                        />
                        {resume.status}
                    </span>
                    {resume.kind === "work" && resume.when !== "" ? (
                        <>
                            <span className="flex-none text-ink-mid">{resume.when}</span>
                            <span title={resume.note} className="min-w-0 truncate">
                                {resume.note}
                            </span>
                        </>
                    ) : null}
                </div>
            ) : null}
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
                "flex items-center gap-[13px] py-[7px]",
                ROW_BORDER,
                onOpen != null && "cursor-pointer hover:bg-surface-hover",
                focused && CURSOR_RING
            )}
        >
            <span className={cn("w-28 flex-none truncate text-[10.5px] font-semibold", TONE_TEXT[line.kindTone])}>
                {line.kind}
            </span>
            <div className="flex min-w-0 flex-1 flex-col gap-0.5">
                <span title={line.title} className="truncate text-[13px] text-ink-hi">
                    {line.title}
                </span>
                {line.detail ? <span className={cn("truncate", FAINT_TEXT)}>{line.detail}</span> : null}
            </div>
            <span className="w-12 flex-none text-right text-[11px] tabular-nums text-ink-mid">{line.state}</span>
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
