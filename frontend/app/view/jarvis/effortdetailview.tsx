// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0
//
// An initiative's ACTIVITY: the facts, a progress bar over its chunks, the chunk picked up next and its
// child initiatives, then one newest-first feed over the effort's events, divided by day and grouped by
// chunk within a day on a rail, one line per entry (effortfeed.ts).
//
// This is no longer how an initiative is opened. The Brief expands it in place and the plan, its chunks and
// their per-chunk note trails live there (inlinetracker.ts) — so the plan section that used to fold below
// this feed is gone rather than kept in sync with a second copy of itself. What is left is the escape
// hatch the inline tracker links to as "initiative activity": every note on every chunk, in one stream,
// which the per-chunk sidebar deliberately does not show.

import type { AgentsViewModel } from "@/app/view/agents/agents";
import { formatAge } from "@/app/view/agents/agentsviewmodel";
import { SectionLabel } from "@/app/view/agents/sectionlabel";
import { cn, fireAndForget } from "@/util/util";
import { useAtomValue } from "jotai";
import { ChevronRight } from "lucide-react";
import { Fragment, useEffect, useMemo, useState } from "react";
import { briefingStateAtom } from "./briefingstore";
import { FAINT_TEXT, REGION_LABEL } from "./briefstyle";
import {
    codeSegments,
    effortFeed,
    FEED_PAGE,
    feedGroups,
    paragraphs,
    type FeedEntry,
    type FeedGroupRow,
} from "./effortfeed";
import { effortFacts, type ChunkTone, type EffortFacts } from "./effortmodel";
import { effortDetailAtom, loadEffortDetail } from "./effortstore";
import { TONE_FG, ToneIcon } from "./inlinetrackerview";
import { activeSubjectAtom } from "./jarvissubjectstore";
import { openOrPeekAddress } from "./openref";
import { STAGE_SCROLLER } from "./stagemeasure";

const FOCUS = "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent";
const TIME = cn("w-[38px] flex-none", FAINT_TEXT);
const ROW_HOVER = "rounded-[6px] hover:bg-surface-hover";

// pending is the bar's empty track, so it draws no fill of its own; deferred is parked work, so it takes a
// neutral rather than blocked's amber, and the legend words carry the meaning
const BAR_FILL: Record<ChunkTone, string> = {
    done: "bg-success",
    active: "bg-accent",
    blocked: "bg-warning",
    pending: "bg-transparent",
    deferred: "bg-ink-faint",
    skipped: "bg-transparent",
};
const SWATCH: Record<ChunkTone, string> = {
    done: "border-success bg-success",
    active: "border-accent bg-accent",
    blocked: "border-warning bg-warning",
    pending: "border-edge-strong bg-edge-mid",
    deferred: "border-ink-faint bg-ink-faint",
    skipped: "border-edge-strong bg-transparent",
};

const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? "" : "s"}`;

// the icon in the 14px box every row aligns its first column to
function Tone({ tone }: { tone: ChunkTone }) {
    return (
        <span className="flex w-[14px] flex-none justify-center">
            <ToneIcon tone={tone} />
        </span>
    );
}

function Segments({ text }: { text: string }) {
    return (
        <>
            {codeSegments(text).map((s, i) =>
                s.code ? (
                    <span key={i} className="font-mono text-[11.5px] text-accent-soft">
                        {s.text}
                    </span>
                ) : (
                    <Fragment key={i}>{s.text}</Fragment>
                )
            )}
        </>
    );
}

function NoteParagraphs({ body }: { body: string }) {
    return (
        <>
            {paragraphs(body).map((p, i) => (
                <span key={i} className={cn("block", p.level === 1 && "pl-[14px]", p.level === 2 && "pl-[28px]")}>
                    {p.segs.map((s, j) =>
                        s.code ? (
                            <span key={j} className="font-mono text-[11.5px] text-accent-soft">
                                {s.text}
                            </span>
                        ) : (
                            <Fragment key={j}>{s.text}</Fragment>
                        )
                    )}
                </span>
            ))}
        </>
    );
}

// the status an entry moved its chunk to
function MarkPill({ tone }: { tone: ChunkTone }) {
    return (
        <span
            className={cn(
                "mr-1.5 inline-flex items-center gap-1 rounded-full bg-pill pl-[3px] pr-1.5 align-[1px] text-[10.5px] font-semibold leading-[17px]",
                TONE_FG[tone]
            )}
        >
            <Tone tone={tone} />
            {tone}
        </span>
    );
}

function Progress({ facts }: { facts: EffortFacts }) {
    const { done, counted, skipped, segments } = facts;
    if (counted + skipped === 0) {
        return null;
    }
    return (
        <div className="flex flex-col gap-2">
            <div className="flex items-baseline gap-2">
                <span className="text-[13px] font-semibold text-ink-hi">
                    {done} of {counted} done
                </span>
                {skipped > 0 ? <span className={FAINT_TEXT}>{skipped} skipped, not counted</span> : null}
            </div>
            <div
                role="img"
                aria-label={segments.map((s) => `${s.n} ${s.tone}`).join(", ")}
                className="flex h-1.5 gap-[2px] overflow-hidden rounded-[3px] bg-edge-mid"
            >
                {segments.map((s) => (
                    <span key={s.tone} className={BAR_FILL[s.tone]} style={{ flexGrow: s.n, flexBasis: 0 }} />
                ))}
            </div>
            <div className="flex flex-wrap gap-x-3.5 gap-y-1">
                {segments.map((s) => (
                    <span
                        key={s.tone}
                        className="inline-flex items-center gap-1.5 text-[10.5px] tabular-nums text-ink-mid"
                    >
                        <span className={cn("box-border h-2 w-2 rounded-[2px] border", SWATCH[s.tone])} />
                        {s.n} {s.tone}
                    </span>
                ))}
            </div>
        </div>
    );
}

function NextCard({ facts }: { facts: EffortFacts }) {
    const { next } = facts;
    return (
        <div
            data-jarvis-effort-section="next"
            className="flex flex-col gap-1.5 rounded-[10px] border border-edge-mid bg-surface-raised px-[13px] py-[11px]"
        >
            <div className="flex items-baseline gap-2.5">
                <span className={cn(REGION_LABEL, "text-accent-soft")}>Next</span>
                {next?.stage ? (
                    <span className={cn("min-w-0 flex-1 truncate", FAINT_TEXT)}>stage · {next.stage}</span>
                ) : null}
            </div>
            {next != null ? (
                <div className="flex items-center gap-2">
                    <Tone tone={next.tone} />
                    <span className="text-[13px] font-medium leading-[1.45] text-ink-hi">{next.label}</span>
                </div>
            ) : (
                <span className="text-[13px] leading-[1.45] text-ink-mid">{facts.idle}</span>
            )}
        </div>
    );
}

function ChildInitiatives({
    facts,
    onOpen,
}: {
    facts: EffortFacts;
    onOpen: (oref: string, e: React.MouseEvent) => void;
}) {
    if (facts.children.length === 0) {
        return null;
    }
    return (
        <section data-jarvis-effort-section="children" className="flex flex-col gap-0.5">
            <SectionLabel className="mb-1.5">Child initiatives</SectionLabel>
            {facts.children.map((k) => (
                <button
                    key={k.oref}
                    type="button"
                    title="Open this initiative"
                    data-peek
                    onClick={(e) => onOpen(k.oref, e)}
                    className={cn(
                        "flex w-full min-w-0 cursor-pointer items-center gap-2.5 rounded-t-[6px] border-b border-edge-faint px-1.5 py-[5px] text-left hover:bg-surface-hover",
                        FOCUS
                    )}
                >
                    <span className="min-w-0 flex-1 truncate text-[12.5px] text-secondary">{k.title}</span>
                    <span className="h-1 w-14 flex-none overflow-hidden rounded-[2px] bg-edge-mid">
                        <span
                            className="block h-full bg-success"
                            style={{ width: `${k.total > 0 ? (k.done / k.total) * 100 : 0}%` }}
                        />
                    </span>
                    {/* wide enough for "34 of 41", so the columns line up down the list */}
                    <span className={cn("w-[52px] flex-none", FAINT_TEXT)}>
                        {k.done} of {k.total}
                    </span>
                    <span
                        className={cn(
                            "inline-flex flex-none items-center gap-[5px] text-[10.5px] font-semibold",
                            TONE_FG[k.tone]
                        )}
                    >
                        <Tone tone={k.tone} />
                        {k.status}
                    </span>
                    <ChevronRight size={11} strokeWidth={2.4} aria-hidden className="flex-none text-muted" />
                </button>
            ))}
        </section>
    );
}

// one segment of the rail that runs down a chunk's entries; consecutive entries join into one line
const Rail = () => <span aria-hidden className="absolute bottom-0 left-[7px] top-0 w-px bg-edge-mid" />;

function FeedGroupLine({
    row,
    open,
    onToggle,
    onOnly,
}: {
    row: FeedGroupRow;
    open: boolean;
    onToggle: () => void;
    onOnly: (chunk: string, tone: ChunkTone) => void;
}) {
    switch (row.kind) {
        case "day":
            return (
                <div className="sticky top-0 z-[1] flex items-center gap-2.5 bg-background pb-1 pt-3">
                    <span className={cn(REGION_LABEL, "text-ink-mid")}>{row.label}</span>
                    <span className="flex-1 border-t border-edge-faint" />
                </div>
            );
        case "head":
            return (
                <button
                    type="button"
                    onClick={() => onOnly(row.chunk, row.tone)}
                    title="Show only this chunk"
                    className={cn(
                        "mt-1.5 flex w-full min-w-0 cursor-pointer items-center gap-2 py-1 pr-1.5 text-left",
                        ROW_HOVER,
                        FOCUS
                    )}
                >
                    <Tone tone={row.tone} />
                    <span className="min-w-0 flex-1 truncate text-[12.5px] font-semibold text-ink-hi">{row.chunk}</span>
                    {row.added !== "" ? <span className={cn("flex-none", FAINT_TEXT)}>added {row.added}</span> : null}
                    <span className={cn("flex-none text-[10.5px] font-semibold", TONE_FG[row.tone])}>{row.status}</span>
                </button>
            );
        case "note":
            return (
                <div className="relative pl-[22px]">
                    <Rail />
                    <button
                        type="button"
                        onClick={onToggle}
                        aria-expanded={open}
                        data-jarvis-effort-note={row.key}
                        className={cn(
                            "flex w-full min-w-0 cursor-pointer items-baseline gap-2.5 py-[3px] pr-1.5 text-left",
                            ROW_HOVER,
                            open && "bg-surface-hover",
                            FOCUS
                        )}
                    >
                        <span className={TIME}>{row.time}</span>
                        <span
                            className={cn(
                                "line-clamp-2 min-w-0 flex-1 text-[12.5px] leading-[1.5]",
                                open ? "text-ink-hi" : "text-ink-mid"
                            )}
                        >
                            {row.mark != null ? <MarkPill tone={row.mark} /> : null}
                            <Segments text={row.head} />
                        </span>
                        <ChevronRight
                            size={11}
                            strokeWidth={2.4}
                            aria-hidden
                            className={cn("flex-none self-center text-muted", open && "rotate-90")}
                        />
                    </button>
                    {open ? (
                        <div className="mb-2 ml-[48px] mt-0.5 flex flex-col gap-1.5 rounded-lg border border-edge-faint bg-surface px-3 py-2.5 text-[12.5px] leading-[1.65] text-secondary">
                            <NoteParagraphs body={row.body} />
                        </div>
                    ) : null}
                </div>
            );
        case "event":
            return (
                <div className="relative flex items-baseline gap-2.5 py-[3px] pl-[22px]">
                    <Rail />
                    <span className={TIME}>{row.time}</span>
                    <span className="min-w-0 flex-1 truncate text-[12.5px] leading-[1.5]">
                        {row.mark != null ? (
                            <MarkPill tone={row.mark} />
                        ) : (
                            <span className={FAINT_TEXT}>{row.text}</span>
                        )}
                    </span>
                </div>
            );
    }
}

function NotesFeed({ feed }: { feed: FeedEntry[] }) {
    const [only, setOnly] = useState<{ chunk: string; tone: ChunkTone } | null>(null);
    const [limit, setLimit] = useState(FEED_PAGE);
    const [opened, setOpened] = useState<Record<string, boolean>>({});
    const { rows, left } = feedGroups(feed, { only: only?.chunk ?? null, limit, now: Date.now() });
    const notes = feed.filter((e) => e.text !== "").length;
    const narrow = (next: { chunk: string; tone: ChunkTone } | null) => {
        setOnly(next);
        setOpened({});
    };
    return (
        <section data-jarvis-effort-section="notes" className="flex flex-col">
            <div className="flex items-baseline gap-2.5 pb-1">
                <SectionLabel>Notes</SectionLabel>
                <span className={FAINT_TEXT}>
                    {feed.length === 0 ? "none yet" : `${plural(notes, "note")} · newest first`}
                </span>
            </div>
            {only != null ? (
                <div className="mb-0.5 mt-1 flex items-center gap-2 rounded-lg bg-pill py-1.5 pl-2.5 pr-2">
                    <span className={cn("flex-none", FAINT_TEXT)}>only</span>
                    <Tone tone={only.tone} />
                    <span className="min-w-0 flex-1 truncate text-[12px] font-semibold text-ink-hi">{only.chunk}</span>
                    <button
                        type="button"
                        onClick={() => narrow(null)}
                        className={cn(
                            "flex-none cursor-pointer px-1 py-0.5 text-[10.5px] text-accent hover:text-accenthover",
                            FOCUS
                        )}
                    >
                        show all
                    </button>
                </div>
            ) : null}
            {rows.map((row) => {
                const open = opened[row.key] === true;
                return (
                    <FeedGroupLine
                        key={row.key}
                        row={row}
                        open={open}
                        onToggle={() => setOpened({ ...opened, [row.key]: !open })}
                        onOnly={(chunk, tone) => narrow({ chunk, tone })}
                    />
                );
            })}
            {left > 0 ? (
                <button
                    type="button"
                    onClick={() => setLimit(limit + FEED_PAGE)}
                    className={cn(
                        // lines up with the entry text, past the rail indent and the time column
                        "ml-[70px] mt-2.5 cursor-pointer self-start rounded-[6px] border border-border px-2.5 py-1 text-[10.5px] text-ink-mid hover:text-ink-hi",
                        FOCUS
                    )}
                >
                    Show {Math.min(left, FEED_PAGE)} older · {left} left
                </button>
            ) : null}
        </section>
    );
}

export function EffortDetailView({ model }: { model: AgentsViewModel }) {
    const subject = useAtomValue(activeSubjectAtom);
    const cache = useAtomValue(effortDetailAtom);
    const briefing = useAtomValue(briefingStateAtom);
    const oref = subject?.kind === "effort" ? "effort:" + subject.id : null;
    const effort = oref != null ? (cache.get(oref) ?? null) : null;
    // the one list holding every effort: the freshest updatedts the app knows, and the parent and children
    const summaries = briefing.snapshot?.state.efforts;
    const freshTs = summaries?.find((e) => e.oref === oref)?.updatedts;
    const [error, setError] = useState<string | null>(null);
    const feed = useMemo(() => (effort != null ? effortFeed(effort) : []), [effort]);

    // the subject selection warms the cache; this effect covers direct mounts, retries, and an effort
    // ticked from outside the app — loadEffortDetail decides whether the cached copy still stands.
    useEffect(() => {
        if (oref == null) {
            return;
        }
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

    const retry = (): void => {
        if (oref == null) {
            return;
        }
        setError(null);
        void loadEffortDetail(oref, freshTs).catch((e) => setError(e instanceof Error ? e.message : String(e)));
    };

    const facts = effort != null ? effortFacts(effort, summaries ?? []) : null;
    const openChild = (child: string, e: React.MouseEvent) => fireAndForget(() => openOrPeekAddress(model, child, e));

    return (
        <div className={cn(STAGE_SCROLLER, "min-h-0 flex-1")} aria-live="polite">
            <div className="flex flex-col gap-5 px-5 pb-7 pt-5">
                {error != null ? (
                    <div className="flex flex-col gap-2 rounded-[10px] border border-border bg-surface px-4 py-3">
                        <span className="text-[13px] font-semibold text-primary">Couldn't load this initiative.</span>
                        <span className="text-[12px] text-secondary">{error}</span>
                        <button
                            type="button"
                            onClick={retry}
                            className="mt-1 w-fit cursor-pointer rounded-[7px] border border-border bg-surface-raised px-2.5 py-1 text-[11px] font-semibold text-secondary hover:text-primary"
                        >
                            Retry
                        </button>
                    </div>
                ) : null}
                {effort == null && error == null ? (
                    <div className="flex flex-col gap-4">
                        {["title", "facts", "notes"].map((k) => (
                            <div
                                key={k}
                                className="h-10 animate-pulse rounded-[10px] bg-surface motion-reduce:animate-none"
                            />
                        ))}
                    </div>
                ) : null}
                {effort != null && facts != null ? (
                    <>
                        <div className="flex flex-col gap-1.5">
                            <h1 className="m-0 text-pretty text-[19px] font-semibold leading-[1.3] tracking-[-.01em] text-ink-hi">
                                {effort.title}
                            </h1>
                            <div className="flex flex-wrap gap-x-3.5 gap-y-1 text-[10.5px] tabular-nums text-ink-mid">
                                {[...facts.meta, ["updated", formatAge(Date.now() - effort.updatedts) + " ago"]].map(
                                    ([k, v], i) => (
                                        <span key={k + ":" + i}>
                                            <span className="text-muted">{k}</span> {v}
                                        </span>
                                    )
                                )}
                            </div>
                        </div>
                        <Progress facts={facts} />
                        <NextCard facts={facts} />
                        <ChildInitiatives facts={facts} onOpen={openChild} />
                        <NotesFeed key={"notes:" + effort.oid} feed={feed} />
                    </>
                ) : null}
            </div>
        </div>
    );
}
