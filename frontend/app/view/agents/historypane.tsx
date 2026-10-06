// frontend/app/view/agents/historypane.tsx
// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

// Pane 1 of the Diff surface (Wave-git-review.dc.html): commits newest-first, the uncommitted row at
// the top, an optional lane gutter behind them. Rows are left-padded by the gutter width so the SVG
// and the list stay in register without the rows knowing any geometry. The column owns its own
// controls — count, Clear filters, Graph, collapse, and the filter row under them.

import { SkeletonLine } from "@/app/element/skeleton";
import { globalStore } from "@/app/store/jotaiStore";
import { cn } from "@/util/util";
import { useAtomValue } from "jotai";
import { Clock, GitGraph, PanelLeftClose } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { assignLanes, laneCount } from "./gitgraph";
import { graphGeometry } from "./gitgraphgeom";
import {
    clearHistoryFilters,
    graphOnAtom,
    historyFiltersAtom,
    historyLoadStartedAtom,
    retryHistory,
} from "./githistorystore";
import { GraphGutter } from "./graphgutter";
import { HistoryFilterRow } from "./historyfilterrow";
import { HISTORY_PAGE_SIZE, NEAR_BOTTOM_PX, SCROLL_THROTTLE_MS, noMatchSentence, slowSeconds } from "./historyquery";
import { refChipClass, type HistoryRow } from "./historyrows";
import { SubLabel } from "./sectionlabel";

const ROW_H = 34;
const HASH_W = 52;
// lanes past this fold into one grey column; nine concurrent lanes will not fit the history column
const MAX_LANES = 7;
const NO_GRAPH_PAD = 14;
const SLOW_TICK_MS = 1_000;

// SkeletonLine takes only className, so the ragged widths are literal utility classes rather than an
// inline style — Tailwind cannot generate a class from a computed string either, so no template here.
const SKELETON_WIDTHS = ["w-[120px]", "w-[190px]", "w-[150px]", "w-[210px]", "w-[135px]"];

function HistorySkeleton() {
    return (
        <div className="px-[14px]">
            {Array.from({ length: 10 }).map((_, i) => (
                <div key={i} className="flex h-[34px] items-center gap-[10px]">
                    <SkeletonLine className="h-[9px] w-[9px] rounded-full" />
                    <SkeletonLine className={cn("h-[8px]", SKELETON_WIDTHS[i % SKELETON_WIDTHS.length])} />
                    <div className="flex-1" />
                    <SkeletonLine className="h-[8px] w-[34px]" />
                </div>
            ))}
        </div>
    );
}

// A first read past SLOW_HISTORY_MS says so and offers Retry, so a hung git log does not look like an
// endless skeleton. The tick runs only while a read is outstanding.
function SlowNotice({ loading }: { loading: boolean }) {
    const started = useAtomValue(historyLoadStartedAtom);
    const [now, setNow] = useState(() => Date.now());
    useEffect(() => {
        if (!loading || started == null) {
            return;
        }
        setNow(Date.now());
        const id = setInterval(() => setNow(Date.now()), SLOW_TICK_MS);
        return () => clearInterval(id);
    }, [loading, started]);
    const secs = loading ? slowSeconds(started, now) : null;
    if (secs == null) {
        return null;
    }
    return (
        <div className="mx-[12px] mb-[8px] flex items-center gap-[10px] rounded-[9px] border border-edge-mid bg-surface px-[12px] py-[9px]">
            <Clock size={14} className="flex-none text-warning" />
            <div className="min-w-0 flex-1">
                <div className="text-[12.5px] font-semibold text-ink-hi">Still reading history</div>
                <div className="text-[11px] tabular-nums text-muted">
                    <span className="font-mono">git log</span> has been running for {secs}s
                </div>
            </div>
            <button
                onClick={() => retryHistory()}
                className="flex-none rounded-[6px] border border-edge-mid bg-surface-raised px-[10px] py-[4px] text-[11.5px] font-semibold text-ink-hi hover:border-edge-strong"
            >
                Retry
            </button>
        </div>
    );
}

function ClearFiltersButton({ kbd }: { kbd?: boolean }) {
    return (
        <button
            onClick={() => clearHistoryFilters()}
            className="flex flex-none items-center gap-[7px] rounded-[7px] border border-edge-mid bg-surface px-[10px] py-[4px] text-[11.5px] font-semibold text-ink-hi hover:border-edge-strong"
        >
            Clear filters
            {kbd ? <span className="font-mono text-[10.5px] text-muted">esc</span> : null}
        </button>
    );
}

function NoMatch() {
    const filters = useAtomValue(historyFiltersAtom);
    return (
        <div className="flex flex-col items-center gap-[8px] px-[20px] py-[48px] text-center">
            <div className="text-[13px] font-semibold text-ink-hi">No commits match</div>
            <div className="text-[12px] text-ink-mid">{noMatchSentence(filters)}</div>
            <div className="mt-[4px]">
                <ClearFiltersButton />
            </div>
        </div>
    );
}

function Row({
    row,
    laneIndent,
    selected,
    onSelect,
}: {
    row: HistoryRow;
    laneIndent: number;
    selected: boolean;
    onSelect: () => void;
}) {
    // refs eat the subject's width fast; show the first and collapse the rest into a count
    const chips = row.refs.length > 1 ? row.refs.slice(0, 1) : row.refs;
    const overflow = row.refs.length - chips.length;
    return (
        <button
            onClick={onSelect}
            style={{ height: ROW_H, paddingLeft: laneIndent }}
            className={cn(
                "relative flex w-full items-center gap-[9px] pr-[12px] text-left transition-colors duration-[140ms] hover:bg-surface",
                selected && "bg-surface-selected"
            )}
        >
            {/* no left accent bar: it lands 13px from lane 0's line in the same blue, so a selected row
                grew a second thing that looks like a graph lane. The fill alone marks the selection. */}
            <span style={{ width: HASH_W }} className="flex flex-none items-center font-mono text-[11px] text-muted">
                {row.workingTree ? (
                    <span className="h-[10px] w-[10px] rounded-full border border-dashed border-warning" />
                ) : (
                    row.hash.slice(0, 7)
                )}
            </span>
            {chips.map((r) => (
                <span
                    key={r.label}
                    className={cn(
                        "max-w-[110px] flex-none truncate rounded-[4px] border px-[6px] py-[1px] text-[10.5px] font-semibold",
                        refChipClass(r.kind)
                    )}
                >
                    {r.label}
                </span>
            ))}
            {overflow > 0 ? (
                <span className="flex-none rounded-[4px] border border-edge-mid bg-surface-raised px-[6px] py-[1px] text-[10.5px] font-semibold tabular-nums text-muted">
                    +{overflow}
                </span>
            ) : null}
            <span
                className={cn(
                    "min-w-[140px] flex-1 truncate text-[12.5px]",
                    row.before
                        ? "text-muted"
                        : selected
                          ? "font-semibold text-ink-hi"
                          : row.workingTree
                            ? "text-warning"
                            : "text-foreground"
                )}
            >
                {row.subject}
            </span>
            {row.workingTree ? (
                <span className="flex-none text-[11px] text-muted">
                    {row.fileCount} {row.fileCount === 1 ? "file" : "files"}
                </span>
            ) : row.refs.length === 0 ? (
                <span className="flex-none truncate text-[11px] text-muted" style={{ maxWidth: 92 }}>
                    {row.author}
                </span>
            ) : null}
            <span className="w-[42px] flex-none text-right text-[10.5px] tabular-nums text-muted">{row.when}</span>
        </button>
    );
}

function Divider({ label }: { label: string }) {
    return (
        // z-20 keeps the band above the graph gutter, which sits at z-10 so rows cannot erase it
        <div className="relative z-20 flex items-center gap-[9px] py-[6px] pl-[14px] pr-[12px]" style={{ height: 30 }}>
            <span className="flex-none rounded-[5px] border border-accent/30 bg-accentbg px-[7px] py-[2px] text-xxxs font-bold uppercase tracking-[0.1em] text-accent-soft">
                {label}
            </span>
            <div className="h-px flex-1 bg-accent/30" />
        </div>
    );
}

export function HistoryPane({
    rows,
    selected,
    graphOn,
    loading,
    countLabel,
    filtered,
    initialScroll,
    hasMore,
    appendState,
    onSelect,
    onScroll,
    onLoadMore,
    onCollapse,
}: {
    rows: HistoryRow[];
    selected: string | null;
    graphOn: boolean;
    loading: boolean;
    countLabel: string;
    // the empty state's wording and the header's filtered look — the graph is suppressed by the
    // surface passing graphOn=false
    filtered: boolean;
    initialScroll: number;
    hasMore: boolean;
    appendState: "idle" | "loading" | "failed";
    onSelect: (hash: string) => void;
    onScroll: (top: number) => void;
    onLoadMore: () => void;
    // the collapse button renders only when the surface can collapse the column
    onCollapse?: () => void;
}) {
    const laned = assignLanes(rows);
    const lanes = Math.min(Math.max(laneCount(laned), 1), MAX_LANES);
    const geom = graphGeometry(laned, { rowH: ROW_H, maxLanes: lanes });
    const indent = graphOn ? geom.gutter : NO_GRAPH_PAD;
    const scrollRef = useRef<HTMLDivElement>(null);
    const restored = useRef(false);
    const lastWrite = useRef(0);
    // the stored preference, not the graphOn prop: the surface forces the prop off under a filter, and
    // the toggle must still show what the user chose
    const graphPref = useAtomValue(graphOnAtom);

    // Restore once, on the first render that actually has rows to scroll through — setting scrollTop
    // before then would be clamped to 0 by a zero-height container. The surface unmounts on every nav
    // switch, so this runs on every return.
    useEffect(() => {
        const el = scrollRef.current;
        if (el == null || restored.current || rows.length === 0) {
            return;
        }
        restored.current = true;
        el.scrollTop = initialScroll;
    }, [rows.length, initialScroll]);

    const handleScroll = () => {
        const el = scrollRef.current;
        if (el == null) {
            return;
        }
        // Throttled: this fires per frame while scrolling and every write re-renders the surface.
        const now = Date.now();
        if (now - lastWrite.current >= SCROLL_THROTTLE_MS) {
            lastWrite.current = now;
            onScroll(el.scrollTop);
        }
        if (hasMore && appendState !== "loading" && el.scrollHeight - el.scrollTop - el.clientHeight < NEAR_BOTTOM_PX) {
            onLoadMore();
        }
    };

    return (
        <div className="flex min-h-0 flex-1 flex-col">
            <div className="flex flex-none items-center gap-[9px] px-[14px] pb-[8px] pt-[10px]">
                <SubLabel>History</SubLabel>
                {filtered ? (
                    <span data-filter-count className="text-[10.5px] font-semibold tabular-nums text-accent-soft">
                        {countLabel}
                    </span>
                ) : (
                    <span className="text-[10.5px] tabular-nums text-muted">{countLabel}</span>
                )}
                {graphOn && geom.foldedCount > 0 ? (
                    <span className="rounded-[5px] border border-edge-mid bg-surface-raised px-[7px] py-[2px] text-[10.5px] font-semibold tabular-nums text-graphlane-fold">
                        {laneCount(laned)} lanes · {geom.foldedCount} folded
                    </span>
                ) : null}
                <div className="flex-1" />
                {filtered ? <ClearFiltersButton kbd /> : null}
                <button
                    onClick={() => globalStore.set(graphOnAtom, !graphPref)}
                    className={cn(
                        "flex flex-none items-center gap-[6px] rounded-[7px] border px-[9px] py-[4px] text-[11.5px] font-semibold",
                        graphPref ? "border-accent/30 bg-accentbg text-ink-hi" : "border-edge-mid bg-surface text-muted"
                    )}
                >
                    <GitGraph size={13} />
                    Graph
                    <span className="font-mono text-[10.5px] text-muted">⇧G</span>
                </button>
                {onCollapse ? (
                    <button
                        onClick={onCollapse}
                        title="Collapse history"
                        aria-label="Collapse history"
                        className="flex h-[26px] w-[26px] flex-none items-center justify-center rounded-[6px] text-muted hover:bg-surface hover:text-foreground"
                    >
                        <PanelLeftClose size={15} />
                    </button>
                ) : null}
            </div>
            <HistoryFilterRow />
            <div
                ref={scrollRef}
                onScroll={handleScroll}
                data-history-scroll
                className="min-h-0 flex-1 overflow-y-auto pb-[24px]"
            >
                {loading ? (
                    <>
                        <SlowNotice loading={loading} />
                        <HistorySkeleton />
                    </>
                ) : rows.length === 0 ? (
                    filtered ? (
                        <NoMatch />
                    ) : (
                        <div className="px-[14px] py-[6px] text-[12px] text-ink-mid">No commits</div>
                    )
                ) : (
                    <div className="relative">
                        {graphOn ? (
                            <GraphGutter geom={geom} selectedIndex={laned.findIndex((r) => r.hash === selected)} />
                        ) : null}
                        {laned.map((row) => (
                            <div key={row.hash || "__wt__"} data-history-row>
                                <Row
                                    row={row}
                                    laneIndent={indent}
                                    selected={selected === row.hash}
                                    onSelect={() => onSelect(row.hash)}
                                />
                                {row.divider ? <Divider label={row.divider} /> : null}
                            </div>
                        ))}
                        {appendState === "failed" ? (
                            <button
                                onClick={onLoadMore}
                                className="flex h-[34px] w-full items-center gap-[8px] px-[14px] text-left text-[12px] text-error hover:text-foreground"
                            >
                                Couldn’t load more commits — retry
                            </button>
                        ) : appendState === "loading" ? (
                            <div className="flex h-[34px] items-center px-[14px] text-[11px] tabular-nums text-muted">
                                {`loading commits ${rows.length + 1}–${rows.length + HISTORY_PAGE_SIZE}…`}
                            </div>
                        ) : null}
                    </div>
                )}
            </div>
        </div>
    );
}
