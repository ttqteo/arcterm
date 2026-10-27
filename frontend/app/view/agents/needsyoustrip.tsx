// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0
//
// "Needs you": what waits on you in the Cockpit that is not a card. Asks are cards below it; this lists the review
// gates, blocked tasks, runs to acknowledge or land, and escalations that Jarvis's Waiting list used to be the only
// place to act on. The model is needsyoustripmodel.ts and the rows and their acts are useNeedsYou's (needsyou.ts, shared
// with the Office's notice board); the button and its call are the Brief's own (attentionact.ts, attentionrun.ts). A
// proposed learned rule has no such button: it is Accept, Edit or Dismiss (LearnDecide), with the words that raised it
// behind a Why toggle. Hidden when nothing waits.

import { REGION_LABEL, ROW_BORDER, SMALL_BTN, TONE_TEXT } from "@/app/view/jarvis/briefstyle";
import { cn, fireAndForget } from "@/util/util";
import { useState } from "react";
import type { AgentsViewModel } from "./agents";
import { useNeedsYou, type NeedsYou } from "./needsyou";
import {
    foldNeedsYouRows,
    groupAge,
    stripAge,
    whyLines,
    type NeedsYouEntry,
    type StripRow,
} from "./needsyoustripmodel";

const ACT_BTN =
    "min-w-[66px] flex-none cursor-pointer rounded-[6px] border px-2 py-[3px] text-[10.5px] font-semibold hover:border-edge-strong hover:text-ink-hi focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent disabled:cursor-default disabled:opacity-50";

const openTitle = (row: StripRow) =>
    row.open?.kind === "agent"
        ? "Go to the asking agent's card"
        : row.open?.kind === "effort"
          ? "Open the initiative"
          : "Open the run";

// A learned rule's row: the rule, where it would go, and what to do with it. Why folds the user's own words that
// raised it; Edit swaps the rule for an input (Enter accepts the edited line, Escape cancels). onDecide resolves true
// once the call went through, so a failed accept (a skill at its 20 additions) leaves the card and the input as they were.
function LearnRow({
    row,
    now,
    busy,
    onDecide,
}: {
    row: StripRow;
    now: number;
    busy: boolean;
    onDecide: (row: StripRow, accept: boolean, text?: string) => Promise<boolean>;
}) {
    const [whyOpen, setWhyOpen] = useState(false);
    const [draft, setDraft] = useState<string | null>(null);
    const accept = () => {
        const text = draft?.trim();
        if (draft != null && !text) {
            return;
        }
        fireAndForget(() => onDecide(row, true, text));
    };
    const btn = cn(SMALL_BTN, "disabled:cursor-default disabled:opacity-50");
    return (
        <div
            data-needs-you-row={row.key}
            data-learn-id={row.learnId}
            className={cn("flex flex-col py-1.5 hover:bg-surface-hover", ROW_BORDER)}
        >
            <div className="flex items-center gap-[13px]">
                <span
                    className={cn(
                        "w-[116px] flex-none truncate text-[10.5px] font-semibold tracking-[.02em]",
                        TONE_TEXT[row.tone]
                    )}
                >
                    {row.kindLabel}
                </span>
                <span title={row.source} className="w-[140px] flex-none truncate text-[11px] text-ink-mid">
                    {row.source}
                </span>
                {draft != null ? (
                    <input
                        type="text"
                        data-testid="learn-edit-input"
                        aria-label="Edit the learned rule"
                        autoFocus
                        maxLength={200}
                        value={draft}
                        disabled={busy}
                        onChange={(e) => setDraft(e.target.value)}
                        onKeyDown={(e) => {
                            if (e.key === "Escape") {
                                e.preventDefault();
                                e.stopPropagation();
                                setDraft(null);
                            } else if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
                                e.preventDefault();
                                e.stopPropagation();
                                accept();
                            }
                        }}
                        className="min-w-0 flex-1 rounded-[6px] border border-accent bg-background px-2 py-[3px] text-[13px] text-primary outline-none disabled:opacity-50"
                    />
                ) : (
                    <span title={row.text} className="min-w-0 flex-1 truncate text-[13px] text-ink-hi">
                        {row.text}
                    </span>
                )}
                <span
                    className={cn(
                        "w-10 flex-none text-right text-[11px] font-semibold tabular-nums",
                        TONE_TEXT[row.tone]
                    )}
                >
                    {stripAge(row.waitingSince, now)}
                </span>
                <div className="flex flex-none items-center gap-1.5">
                    {row.why ? (
                        <button
                            type="button"
                            data-testid="learn-why"
                            aria-expanded={whyOpen}
                            title="What you said that raised this"
                            onClick={() => setWhyOpen((o) => !o)}
                            className="cursor-pointer rounded-[6px] px-1.5 py-[3px] text-[10.5px] font-semibold text-ink-mid hover:text-ink-hi focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
                        >
                            Why {whyOpen ? "▾" : "▸"}
                        </button>
                    ) : null}
                    <button type="button" data-testid="learn-accept" disabled={busy} onClick={accept} className={btn}>
                        Accept
                    </button>
                    {draft != null ? null : (
                        <button
                            type="button"
                            data-testid="learn-edit"
                            disabled={busy}
                            onClick={() => setDraft(row.text)}
                            className={btn}
                        >
                            Edit
                        </button>
                    )}
                    <button
                        type="button"
                        data-testid="learn-dismiss"
                        disabled={busy}
                        title="Never propose this again"
                        onClick={() => fireAndForget(() => onDecide(row, false))}
                        className={btn}
                    >
                        Dismiss
                    </button>
                </div>
            </div>
            {whyOpen && row.why ? (
                <p data-testid="learn-why-quotes" className="pb-0.5 pl-[282px] pt-1 text-[11.5px] text-ink-mid">
                    {row.why}
                </p>
            ) : null}
        </div>
    );
}

// A row's buttons: its act, the second act of a blocked queue entry, and Open beside an act that is not Open itself.
function RowActs({ row, ny }: { row: StripRow; ny: NeedsYou }) {
    const { busy, open, act } = ny;
    return (
        <div className="flex flex-none items-center gap-1.5">
            {row.act.kind === "open" && row.open == null ? null : (
                <button
                    type="button"
                    data-needs-you-act={row.act.kind}
                    data-strip-act={row.act.kind}
                    title={row.act.kind === "open" ? openTitle(row) : undefined}
                    disabled={busy.has(row.key)}
                    onClick={(e) => act(row, row.act, e)}
                    className={cn(
                        ACT_BTN,
                        row.act.label === "Approve"
                            ? "border-success/35 bg-success/12 text-success"
                            : "border-edge-mid text-secondary"
                    )}
                >
                    {row.act.label}
                </button>
            )}
            {row.secondAct != null ? (
                <button
                    type="button"
                    data-strip-act={row.secondAct.kind}
                    disabled={busy.has(row.key)}
                    onClick={(e) => act(row, row.secondAct!, e)}
                    className={cn(ACT_BTN, "border-edge-mid text-secondary")}
                >
                    {row.secondAct.label}
                </button>
            ) : null}
            {row.act.kind !== "open" && row.open != null ? (
                <button
                    type="button"
                    data-needs-you-open={row.open.kind}
                    title={openTitle(row)}
                    onClick={(e) => open(row, e)}
                    className={SMALL_BTN}
                >
                    Open
                </button>
            ) : null}
        </div>
    );
}

// Any other row: one line, and its act. A row with a why unfolds on a click of its text: the source in full, then
// each line of the why (a run to confirm lists what it left unverified, so you know what to check before Accept).
function ActRow({ row, ny }: { row: StripRow; ny: NeedsYou }) {
    const { now } = ny;
    const [expanded, setExpanded] = useState(false);
    const lines = whyLines(row);
    return (
        <div data-needs-you-row={row.key} className={cn("flex flex-col py-1.5 hover:bg-surface-hover", ROW_BORDER)}>
            <div className="flex items-center gap-[13px]">
                <span
                    className={cn(
                        "w-[116px] flex-none truncate text-[10.5px] font-semibold tracking-[.02em]",
                        TONE_TEXT[row.tone]
                    )}
                >
                    {row.kindLabel}
                </span>
                <span title={row.source} className="w-[140px] flex-none truncate text-[11px] text-ink-mid">
                    {row.source}
                </span>
                {lines.length > 0 ? (
                    <button
                        type="button"
                        data-needs-you-expand
                        aria-expanded={expanded}
                        title={expanded ? "Fold" : "Show the details"}
                        onClick={() => setExpanded((o) => !o)}
                        className="min-w-0 flex-1 cursor-pointer truncate text-left text-[13px] text-ink-hi focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
                    >
                        <span className="text-ink-mid">{expanded ? "▾" : "▸"} </span>
                        {row.text}
                        {expanded ? null : <span className="text-ink-mid"> — {row.why}</span>}
                    </button>
                ) : (
                    <span title={row.text} className="min-w-0 flex-1 truncate text-[13px] text-ink-hi">
                        {row.text}
                    </span>
                )}
                <span
                    className={cn(
                        "w-10 flex-none text-right text-[11px] font-semibold tabular-nums",
                        TONE_TEXT[row.tone]
                    )}
                >
                    {stripAge(row.waitingSince, now)}
                </span>
                <RowActs row={row} ny={ny} />
            </div>
            {expanded && lines.length > 0 ? (
                <div data-needs-you-detail className="pb-0.5 pl-[282px] pr-2 pt-1 text-[11.5px] text-ink-mid">
                    <p className="text-ink-hi">{row.source}</p>
                    <ul className="mt-1 flex flex-col gap-0.5">
                        {lines.map((line, i) => (
                            <li key={i} className="flex gap-1.5">
                                <span aria-hidden="true">·</span>
                                <span className="min-w-0 whitespace-pre-wrap break-words">{line}</span>
                            </li>
                        ))}
                    </ul>
                </div>
            ) : null}
        </div>
    );
}

// the strip's rows without its frame, for a page that frames them itself (a project's Overview)
export function NeedsYouRows({ ny }: { ny: NeedsYou }) {
    const { rows, now, busy, decideLearn } = ny;
    return (
        <>
            {rows.map((row) =>
                row.learnId != null ? (
                    <LearnRow key={row.key} row={row} now={now} busy={busy.has(row.key)} onDecide={decideLearn} />
                ) : (
                    <ActRow key={row.key} row={row} ny={ny} />
                )
            )}
        </>
    );
}

// The strip's one-line row does not fit a 420px column, so a project's Overview draws it in two tiers: the kind, the
// source, the age and the buttons, then the text, which unfolds like ActRow's.
function CompactRow({ row, ny }: { row: StripRow; ny: NeedsYou }) {
    const [expanded, setExpanded] = useState(false);
    const lines = whyLines(row);
    return (
        <div
            data-needs-you-row={row.key}
            className={cn("flex flex-col gap-[3px] py-1.5 hover:bg-surface-hover", ROW_BORDER)}
        >
            <div className="flex items-center gap-2">
                <span className={cn("flex-none text-[10.5px] font-semibold tracking-[.02em]", TONE_TEXT[row.tone])}>
                    {row.kindLabel}
                </span>
                <span title={row.source} className="min-w-0 truncate text-[11px] text-ink-mid">
                    {row.source}
                </span>
                <span className="flex-1" />
                <span
                    className={cn("flex-none text-right text-[11px] font-semibold tabular-nums", TONE_TEXT[row.tone])}
                >
                    {stripAge(row.waitingSince, ny.now)}
                </span>
                <RowActs row={row} ny={ny} />
            </div>
            {lines.length > 0 ? (
                <button
                    type="button"
                    data-needs-you-expand
                    aria-expanded={expanded}
                    title={expanded ? "Fold" : "Show the details"}
                    onClick={() => setExpanded((o) => !o)}
                    className="min-w-0 cursor-pointer truncate text-left text-[13px] text-ink-hi focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
                >
                    <span className="text-ink-mid">{expanded ? "▾" : "▸"} </span>
                    {row.text}
                    {expanded ? null : <span className="text-ink-mid"> — {row.why}</span>}
                </button>
            ) : (
                <span title={row.text} className="min-w-0 truncate text-[13px] text-ink-hi">
                    {row.text}
                </span>
            )}
            {expanded && lines.length > 0 ? (
                <div data-needs-you-detail className="pb-0.5 pr-2 pt-0.5 text-[11.5px] text-ink-mid">
                    <p className="text-ink-hi">{row.source}</p>
                    <ul className="mt-1 flex flex-col gap-0.5">
                        {lines.map((line, i) => (
                            <li key={i} className="flex gap-1.5">
                                <span aria-hidden="true">·</span>
                                <span className="min-w-0 whitespace-pre-wrap break-words">{line}</span>
                            </li>
                        ))}
                    </ul>
                </div>
            ) : null}
        </div>
    );
}

// Three or more rows of one kind (foldNeedsYouRows): one line that unfolds to them, with how long they have waited.
function CompactGroup({ entry, ny }: { entry: Extract<NeedsYouEntry, { kind: "group" }>; ny: NeedsYou }) {
    const [open, setOpen] = useState(false);
    const noun = entry.rows.every((r) => r.run.wireKind.startsWith("run-")) ? "runs" : "items";
    return (
        <div data-needs-you-group={entry.kindLabel} className="flex flex-col">
            <button
                type="button"
                aria-expanded={open}
                title={open ? "Fold" : "Show them"}
                onClick={() => setOpen((o) => !o)}
                className={cn(
                    "flex cursor-pointer items-center gap-2 py-1.5 text-left hover:bg-surface-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent",
                    ROW_BORDER
                )}
            >
                <span
                    className={cn(
                        "min-w-0 truncate text-[10.5px] font-semibold tracking-[.02em]",
                        TONE_TEXT[entry.tone]
                    )}
                >
                    {open ? "▾" : "▸"} {entry.kindLabel} · {entry.rows.length} {noun}
                </span>
                <span className="flex-1" />
                <span
                    data-needs-you-group-age
                    className={cn("flex-none text-[11px] font-semibold tabular-nums", TONE_TEXT[entry.tone])}
                >
                    {groupAge(entry.rows, ny.now)}
                </span>
            </button>
            {open ? (
                <div className="pl-3">
                    {entry.rows.map((row) => (
                        <CompactRow key={row.key} row={row} ny={ny} />
                    ))}
                </div>
            ) : null}
        </div>
    );
}

// the same rows in the two-tier form, with three or more of a kind folded into one; a learned rule never reaches a
// project's Overview (useNeedsYou leaves them out), so there is no LearnRow here
export function CompactNeedsYouRows({ ny }: { ny: NeedsYou }) {
    return (
        <>
            {foldNeedsYouRows(ny.rows).map((entry) =>
                entry.kind === "group" ? (
                    <CompactGroup key={entry.key} entry={entry} ny={ny} />
                ) : (
                    <CompactRow key={entry.row.key} row={entry.row} ny={ny} />
                )
            )}
        </>
    );
}

export function NeedsYouStrip({
    model,
    onFocusAgent,
}: {
    model: AgentsViewModel;
    // an escalation's Open, when its asking agent is in the roster: the Cockpit knows where that card is
    onFocusAgent: (agentId: string) => void;
}) {
    const ny = useNeedsYou(model, onFocusAgent);
    if (ny.rows.length === 0) {
        return null;
    }

    return (
        <section
            data-cockpit-needs-you
            aria-label="Needs you"
            className="shrink-0 border-b border-border bg-background px-5 pb-1.5 pt-2"
        >
            <div className="flex items-center gap-2 pb-1">
                <span aria-hidden="true" className="h-[7px] w-[7px] rounded-full bg-asking" />
                <span className={cn(REGION_LABEL, "text-asking")}>Needs you</span>
                <span className="text-[10.5px] font-semibold tabular-nums text-ink-mid">{ny.rows.length}</span>
            </div>
            <div className="flex max-h-[30vh] flex-col overflow-y-auto">
                <NeedsYouRows ny={ny} />
            </div>
        </section>
    );
}
