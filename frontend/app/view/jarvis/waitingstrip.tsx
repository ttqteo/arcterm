// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0
//
// Waiting on you as one strip at the top of the Brief's main column (spec 2026-11-05-jarvis-revamp-design.md decision 2,
// board Main.dc.html): `● Waiting on you N`, the most urgent item's kind chip and title on one line, that item's own
// action, and Show all N, which opens every item under the strip as today's queue rows. Not drawn with nothing waiting.
// Presentational: the lines come in the queue's order (briefingmodel.ts buildAttentionQueue), every act is a prop.

import { cn } from "@/util/util";
import { ChevronDown, ChevronUp } from "lucide-react";
import type { QueueAct } from "./briefingmodel";
import type { BriefLine } from "./briefrows";
import { WaitingRow } from "./briefrowviews";
import { CURSOR_RING, cursorAttrs } from "./briefstyle";

const FOCUS = "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent";

// the kind chip's fill by the tone queueLine gives it, as the queue row draws it (briefrowviews.tsx WaitingRow)
const KIND_CHIP: Partial<Record<BriefLine["kindTone"], string>> = {
    asking: "bg-askingbg text-asking",
    error: "bg-error/12 text-error",
};

export type WaitingStripProps = {
    // every item waiting, in the queue's order; the first is the strip's
    lines: BriefLine[];
    // the whole queue's size, which a filter may make larger than `lines`
    total: number;
    open: boolean;
    onToggle: () => void;
    // every button an item carries: one for most, Unblock and Done for a blocked chunk
    actsOf: (line: BriefLine) => QueueAct[];
    onAct: (line: BriefLine, act: QueueAct) => void;
    onOpen: (line: BriefLine, e?: React.MouseEvent) => void;
    cursor?: string | null;
    // Accept N unverified: the runs to accept are in this queue
    ack?: React.ReactNode;
    // what the queue holds in one line (briefingmodel.ts summarizeAttentionQueue), read as the rows open and on the count
    summary?: string;
};

export function WaitingStrip({
    lines,
    total,
    open,
    onToggle,
    actsOf,
    onAct,
    onOpen,
    cursor,
    ack,
    summary,
}: WaitingStripProps) {
    if (total === 0) {
        return null;
    }
    const head = lines[0] ?? null;
    const acts = head != null ? actsOf(head) : [];
    // with the rows open the strip's own line is the first row too, so the cursor rides the rows instead
    const focused = !open && head != null && cursor === head.id;
    return (
        <section data-jarvis-brief-region="waiting" data-jarvis-waiting-strip className="flex min-w-0 flex-col gap-1.5">
            <div
                data-jarvis-waiting-head
                data-jarvis-waiting-item={head?.id}
                {...cursorAttrs(focused)}
                className={cn(
                    "flex h-11 min-w-0 flex-none items-center gap-3 rounded-[8px] border border-asking/35 bg-asking/6 pl-3.5 pr-2",
                    focused && CURSOR_RING
                )}
            >
                <span className="flex flex-none items-center gap-1.5 text-[12px] font-semibold text-asking">
                    <span aria-hidden className="h-1.5 w-1.5 flex-none pulse-dot-slow rounded-full bg-asking" />
                    Waiting on you
                    <span title={summary || undefined} className="tabular-nums">
                        {total}
                    </span>
                </span>
                {head != null ? (
                    <>
                        <span
                            data-jarvis-waiting-kind
                            className={cn(
                                "flex-none rounded-[4px] px-1.5 py-0.5 text-[10.5px] font-semibold",
                                KIND_CHIP[head.kindTone] ?? "bg-pill text-ink-mid"
                            )}
                        >
                            {head.kind}
                        </span>
                        <button
                            type="button"
                            data-jarvis-waiting-title
                            data-peek={head.target != null ? "" : undefined}
                            title={head.title}
                            onClick={head.target != null ? (e) => onOpen(head, e) : undefined}
                            className={cn(
                                "min-w-0 flex-1 truncate text-left text-[12.5px] text-primary",
                                head.target != null ? "cursor-pointer hover:text-ink-hi" : "cursor-default",
                                FOCUS
                            )}
                        >
                            {head.title}
                        </button>
                        {acts.map((act) => {
                            const go = act.label === "Go to agent";
                            return (
                                <button
                                    key={act.kind}
                                    type="button"
                                    data-jarvis-queue-act={act.kind}
                                    title={go ? "Go to the agent open on this initiative" : undefined}
                                    onClick={() => onAct(head, act)}
                                    className={cn(
                                        "h-[26px] flex-none cursor-pointer whitespace-nowrap rounded-[6px] border px-2.5 text-[11.5px] font-semibold hover:border-edge-strong hover:text-ink-hi",
                                        act.label === "Approve" || go
                                            ? "border-success/35 bg-success/12 text-success"
                                            : "border-edge-strong bg-surface-raised text-primary",
                                        FOCUS
                                    )}
                                >
                                    {act.label}
                                </button>
                            );
                        })}
                    </>
                ) : (
                    <span className="min-w-0 flex-1 truncate text-[12px] text-ink-faint">
                        Nothing waiting matches the filter.
                    </span>
                )}
                {ack}
                {lines.length > 1 || open ? (
                    <button
                        type="button"
                        data-jarvis-strip-show-all={open ? "open" : "shut"}
                        aria-expanded={open}
                        aria-controls="jarvis-attention-details"
                        onClick={onToggle}
                        className={cn(
                            "flex h-[26px] flex-none cursor-pointer items-center gap-1 whitespace-nowrap rounded-[6px] px-2 text-[11.5px] text-secondary hover:text-ink-hi",
                            FOCUS
                        )}
                    >
                        {open ? "Show less" : `Show all ${lines.length}`}
                        {open ? <ChevronUp size={12} aria-hidden /> : <ChevronDown size={12} aria-hidden />}
                    </button>
                ) : null}
            </div>
            {open ? (
                <div
                    id="jarvis-attention-details"
                    data-jarvis-waiting-rows
                    className="flex flex-col rounded-[10px] border border-edge-mid bg-surface p-1"
                >
                    {summary ? (
                        <span data-jarvis-waiting-summary className="px-2 pb-1 pt-0.5 text-[11px] text-ink-mid">
                            {summary}
                        </span>
                    ) : null}
                    {lines.map((l) => (
                        <WaitingRow
                            key={l.id}
                            line={l}
                            focused={cursor === l.id}
                            acts={actsOf(l)}
                            onOpen={l.target != null ? (e) => onOpen(l, e) : undefined}
                            onAct={(act) => onAct(l, act)}
                        />
                    ))}
                </div>
            ) : null}
        </section>
    );
}
