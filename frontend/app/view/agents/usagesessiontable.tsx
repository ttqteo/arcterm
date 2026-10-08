// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0
//
// The Usage surface's By session table (Claude tab): one row per Claude tab in the window, most expensive first,
// with the share of the window's Claude spend, the context it ran at, cold resumes, how much of it was subagents,
// and the deterministic chips that say why it cost what it did. Thin: rows, chips and the 25-row cut come from
// usagesessions.ts. Columns and sizes follow Main.dc.html in the usage-insights prototype.

import { Meter } from "@/app/element/meter";
import { SkeletonLine } from "@/app/element/skeleton";
import { REGION_LABEL } from "@/app/view/jarvis/briefstyle";
import { cn } from "@/util/util";
import { Fragment, useEffect, type ReactNode } from "react";
import { CHIP_LABEL, SESSION_ROWS, type SessionRow } from "./usagesessions";
import { fmt, usd } from "./usagestats";

// title | share bar | spend | context avg / peak | cold | subagents | lifetime
const GRID = "grid grid-cols-[minmax(0,1fr)_150px_78px_104px_52px_64px_56px] items-center gap-3.5 px-[18px]";
const NUM = "text-right text-[11.5px] tabular-nums text-secondary";
const BUTTON_SECONDARY =
    "h-[26px] flex-none cursor-pointer rounded-md border border-edge-mid bg-surface-raised px-2.5 text-[11.5px] font-medium text-ink-mid outline-none hover:border-edge-strong hover:bg-surface-hover focus-visible:ring-2 focus-visible:ring-accent";

function Rule({ meta }: { meta?: string }) {
    return (
        <div className="mb-3 flex items-center gap-2.5">
            <h3 className={cn(REGION_LABEL, "text-muted")}>By session</h3>
            <div className="h-px flex-1 bg-edge-faint" />
            {meta != null ? <span className="text-[10.5px] tabular-nums text-muted">{meta}</span> : null}
        </div>
    );
}

// "9.5%", "12%", "<0.1%"
function shareStr(share: number): string {
    const p = share * 100;
    if (p >= 10) return `${Math.round(p)}%`;
    if (p >= 0.1) return `${p.toFixed(1)}%`;
    return p > 0 ? "<0.1%" : "0%";
}

// "<1m", "40m", "1.5h", "57h"
function lifetime(ms: number): string {
    const mins = ms / 60_000;
    if (mins < 1) return "<1m";
    if (Math.round(mins) < 60) return `${Math.round(mins)}m`;
    const hours = mins / 60;
    return hours < 10 ? `${+hours.toFixed(1)}h` : `${Math.round(hours)}h`;
}

function SessionLine({ row }: { row: SessionRow }) {
    const parts: ReactNode[] = [];
    if (row.liveTabId != null) {
        parts.push(
            <span key="live" data-usage-session-live="" className="inline-flex items-center gap-1 text-success">
                <span className="h-1.5 w-1.5 rounded-full bg-success" />
                open
            </span>
        );
    }
    if (row.project !== "") {
        parts.push(<span key="project">{row.project}</span>);
    }
    if (row.models.length > 0) {
        parts.push(<span key="models">{row.models.join(", ")}</span>);
    }
    return (
        <span className="flex flex-wrap items-center gap-1.5 text-[10.5px] text-muted">
            {parts.map((p, i) => (
                <Fragment key={i}>
                    {i > 0 ? <span>·</span> : null}
                    {p}
                </Fragment>
            ))}
            {row.chips.map((c) => (
                <span
                    key={c}
                    className="rounded-[4px] bg-askingbg px-1.5 py-px text-[10px] font-semibold text-warning-soft"
                >
                    {CHIP_LABEL[c]}
                </span>
            ))}
        </span>
    );
}

function Row({
    row,
    maxShare,
    cursor,
    onOpen,
}: {
    row: SessionRow;
    maxShare: number;
    cursor: boolean;
    onOpen: (row: SessionRow) => void;
}) {
    // the bar is the share relative to the biggest row, so the top row fills it and the rest read against it
    const fill = maxShare > 0 ? (row.share / maxShare) * 100 : 0;
    return (
        <button
            type="button"
            data-usage-session={row.id}
            aria-current={cursor ? "true" : undefined}
            title={row.liveTabId != null ? "Open in Agent" : "Open transcript"}
            onClick={() => onOpen(row)}
            className={cn(
                GRID,
                "w-full cursor-pointer border-0 border-b border-edge-faint py-2.5 text-left outline-none last:border-b-0 focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-accent",
                cursor ? "bg-surface-selected" : "bg-transparent hover:bg-surface-hover"
            )}
        >
            <span className="flex min-w-0 flex-col gap-1">
                <span className="truncate text-[12.5px] font-semibold text-primary">{row.title}</span>
                <SessionLine row={row} />
            </span>
            <span className="flex min-w-0 items-center gap-2">
                <Meter
                    pct={fill}
                    fill="bg-provider-claude"
                    height={5}
                    radius={3}
                    track="bg-edge-mid"
                    className="min-w-0 flex-1"
                />
                <span className="w-[34px] flex-none text-right text-[11px] tabular-nums text-secondary">
                    {shareStr(row.share)}
                </span>
            </span>
            <span className={NUM}>{usd(row.spendUsd)}</span>
            {/* a session with no main turns in the window has no context to average */}
            <span className={NUM}>{row.avgCtx > 0 ? `${fmt(row.avgCtx)} / ${fmt(row.maxCtx)}` : "—"}</span>
            <span className={NUM}>{row.coldResumes}</span>
            <span className={NUM}>
                {row.spendUsd > 0 ? `${Math.round((row.subSpendUsd / row.spendUsd) * 100)}%` : "—"}
            </span>
            <span className={cn(NUM, "text-muted")}>{lifetime(row.lifetimeMs)}</span>
        </button>
    );
}

function Header() {
    return (
        <div className={cn(GRID, "border-b border-edge-faint py-2.5 text-[10.5px] whitespace-nowrap text-muted")}>
            <span>Tab</span>
            <span>Share of window</span>
            <span className="text-right">Spend</span>
            <span className="text-right">Context avg / peak</span>
            <span className="text-right">Cold</span>
            <span className="text-right">Subagents</span>
            <span className="text-right">Lived</span>
        </div>
    );
}

function SkeletonRows() {
    return (
        <div aria-hidden="true">
            {[0, 1, 2, 3, 4].map((i) => (
                <div key={i} className={cn(GRID, "border-b border-edge-faint py-3.5 last:border-b-0")}>
                    <SkeletonLine className="h-[11px] w-[55%]" />
                    <SkeletonLine className="h-[5px] w-full rounded-[3px]" />
                    <SkeletonLine className="ml-auto h-[10px] w-[40px]" />
                    <SkeletonLine className="ml-auto h-[10px] w-[64px]" />
                    <SkeletonLine className="ml-auto h-[10px] w-[16px]" />
                    <SkeletonLine className="ml-auto h-[10px] w-[28px]" />
                    <SkeletonLine className="ml-auto h-[10px] w-[28px]" />
                </div>
            ))}
        </div>
    );
}

// `rows` is every session in the window and `visible` the ones drawn (visibleSessionRows), so the footer can say
// how much of the window the drawn rows account for. `windowName` reads "7 days" or "all time".
export function UsageSessionTable({
    rows,
    visible,
    loaded,
    windowName,
    showAll,
    onToggleAll,
    cursorId,
    onOpen,
}: {
    rows: SessionRow[];
    visible: SessionRow[];
    loaded: boolean;
    windowName: string;
    showAll: boolean;
    onToggleAll: () => void;
    cursorId: string | undefined;
    onOpen: (row: SessionRow) => void;
}) {
    // j / k move the cursor through rows that can sit below the fold of the scrolling pane
    useEffect(() => {
        if (cursorId == null) {
            return;
        }
        document
            .querySelector<HTMLElement>(`[data-usage-session="${CSS.escape(cursorId)}"]`)
            ?.scrollIntoView({ block: "nearest" });
    }, [cursorId]);

    const maxShare = rows.reduce((m, r) => Math.max(m, r.share), 0);
    const covered = visible.reduce((sum, r) => sum + r.share, 0);
    const cut = visible.length < rows.length;
    return (
        <section data-usage-sessions="" className="mb-[22px] min-w-0">
            <Rule
                meta={
                    loaded ? `${rows.length} tab${rows.length === 1 ? "" : "s"} · ${windowName} · by spend` : undefined
                }
            />
            <div className="overflow-hidden rounded-[14px] border border-border bg-surface-raised">
                <div className="overflow-x-auto">
                    <div className="min-w-[720px]">
                        <Header />
                        {loaded ? (
                            visible.map((r) => (
                                <Row
                                    key={r.id}
                                    row={r}
                                    maxShare={maxShare}
                                    cursor={r.id === cursorId}
                                    onOpen={onOpen}
                                />
                            ))
                        ) : (
                            <SkeletonRows />
                        )}
                    </div>
                </div>
                {loaded ? (
                    <div className="flex items-center justify-between gap-3 border-t border-edge-faint px-[18px] py-2.5">
                        <span className="text-[11px] tabular-nums text-muted">
                            {cut
                                ? `Top ${visible.length} of ${rows.length} · ${shareStr(covered)} of the window`
                                : `All ${rows.length} · ${shareStr(covered)} of the window`}
                        </span>
                        {rows.length > SESSION_ROWS ? (
                            <button type="button" onClick={onToggleAll} className={BUTTON_SECONDARY}>
                                {showAll ? `Show top ${SESSION_ROWS}` : `Show all ${rows.length}`}
                            </button>
                        ) : null}
                    </div>
                ) : null}
            </div>
        </section>
    );
}
