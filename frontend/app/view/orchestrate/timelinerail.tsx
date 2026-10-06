// Copyright 2026, Command Line Inc.
//
// The lifecycle timeline rail: one chronological, filterable view of a run's RunEvent log, shared by
// the DAG modal (persistent rail) and narrow layouts (drawer). Bursts, gaps and the activity strip are
// timelinegroups.ts, filtering and click routing timelinefilter.ts; the event projection (title, tone)
// is reused from the run body's runtimeline.ts, so the two timelines cannot describe the same row
// differently.

import { SkeletonLine } from "@/app/element/skeleton";
import { globalStore } from "@/app/store/jotaiStore";
import { RpcApi } from "@/app/store/wshclientapi";
import { TabRpcClient } from "@/app/store/wshrpcutil";
import { cn, fireAndForget } from "@/util/util";
import { atom, useAtom, useAtomValue } from "jotai";
import { ChevronDown, ChevronRight } from "lucide-react";
import { useMemo, useState } from "react";
import { retryRunEvents, useRunEventsState } from "../agents/runeventstore";
import { eventTitle, toneFor, tsLabel } from "../agents/runtimeline";
import { setActiveRunId } from "../jarvis/jarvissubjectstore";
import { dagModalAgentsContextAtom } from "./dagmodalstate";
import { hoveredTaskAtom, selectedTaskIdAtom } from "./dagstore";
import { relaunchLeadAction } from "./relaunchlead";
import { eventClickTarget, type TimelineFilter, type TimelineTarget } from "./timelinefilter";
import {
    eventDetail,
    filterGroups,
    GLYPH_PATHS,
    glyphOf,
    groupEvents,
    groupSnippet,
    railRows,
    stepLabel,
    stripTicks,
    type EventGroup,
} from "./timelinegroups";

const FILTERS: { id: TimelineFilter; label: string }[] = [
    { id: "all", label: "All" },
    { id: "task", label: "Task" },
    { id: "attention", label: "Attention" },
];

const STRIP_H = 26;
const TICK_ATTENTION_H = 20;
const TICK_SUCCESS_H = 12;
const TICK_TONED_H = 9;
const TICK_MUTED_H = 5;
const TICK_FADED_OPACITY = 0.2;

// outside the modal there is no agents context and so no shared clock
const NO_NOW_ATOM = atom(0);

export type TimelineRailProps = {
    channelId: string;
    runId: string;
    layout: "rail" | "drawer";
};

export function TimelineRail({ channelId, runId, layout }: TimelineRailProps) {
    const { events, status } = useRunEventsState(runId, channelId);
    const selectedTaskId = useAtomValue(selectedTaskIdAtom);
    const [hovered, setHovered] = useAtom(hoveredTaskAtom);
    const agentsCtx = useAtomValue(dagModalAgentsContextAtom);
    const tick = useAtomValue(agentsCtx?.model.nowAtom ?? NO_NOW_ATOM);
    const nowMs = agentsCtx ? tick : Date.now();
    const [filter, setFilter] = useState<TimelineFilter>("all");
    const [openGroupId, setOpenGroupId] = useState<string | null>(null);
    const [drawerOpen, setDrawerOpen] = useState(false);
    const [relaunching, setRelaunching] = useState(false);
    const [relaunchError, setRelaunchError] = useState<string | null>(null);
    // the rail layout is always expanded: its collapse control only exists in the drawer, so a
    // narrow->wide resize must not leave the panel stuck shut with nothing to reopen it.
    const open = layout === "rail" || drawerOpen;

    const groups = useMemo(() => groupEvents(events), [events]);
    const shown = filterGroups(groups, filter, selectedTaskId);
    const rows = railRows(shown);
    const graphHoverId = hovered?.from === "graph" ? hovered.id : null;
    const showNow = filter !== "task" || shown.length > 0;

    const relaunchLead = async () => {
        setRelaunching(true);
        setRelaunchError(null);
        try {
            await RpcApi.DagActionCommand(TabRpcClient, {
                channelid: channelId,
                runid: runId,
                taskid: "",
                action: "relaunch-lead",
            });
        } catch (err) {
            setRelaunchError(err instanceof Error ? err.message : String(err));
        } finally {
            setRelaunching(false);
        }
    };

    return (
        <div
            data-timeline-rail={layout}
            className={
                layout === "rail"
                    ? "flex h-full w-[300px] flex-none flex-col border-l border-border bg-surface"
                    : "flex max-h-[45%] flex-none flex-col border-t border-border bg-surface"
            }
        >
            <RailHeader
                count={events.length}
                status={status}
                layout={layout}
                open={open}
                onToggle={() => setDrawerOpen((o) => !o)}
                onRetry={() => fireAndForget(() => retryRunEvents(runId, channelId))}
            />
            {open && (
                <>
                    <ActivityStrip events={events} nowMs={nowMs} focusTaskId={selectedTaskId ?? graphHoverId} />
                    <div className="flex flex-none gap-1 border-b border-border px-2 py-1.5">
                        {FILTERS.map((f) => {
                            const count = filterGroups(groups, f.id, selectedTaskId).length;
                            const showCount = f.id !== "task" || selectedTaskId != null;
                            return (
                                <button
                                    key={f.id}
                                    type="button"
                                    onClick={() => setFilter(f.id)}
                                    aria-pressed={filter === f.id}
                                    className={cn(
                                        "flex cursor-pointer items-center gap-1.5 rounded-[5px] px-2 py-0.5 text-[10.5px] tabular-nums tracking-[0.04em] focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-accent",
                                        filter === f.id
                                            ? "bg-accent/12 text-accent-soft"
                                            : "text-ink-mid hover:text-ink-hi"
                                    )}
                                >
                                    {f.id === "task" && selectedTaskId ? `Task · ${selectedTaskId}` : f.label}
                                    {showCount && (
                                        <span
                                            className={
                                                f.id === "attention" && count > 0 ? "text-warning" : "text-muted"
                                            }
                                        >
                                            {count}
                                        </span>
                                    )}
                                </button>
                            );
                        })}
                    </div>
                    <div className="min-h-0 flex-1 overflow-y-auto">
                        <div className="relative pt-1.5 pb-3">
                            {rows.length > 0 && (
                                <div
                                    aria-hidden="true"
                                    className="absolute top-3.5 bottom-3 left-[21px] w-px bg-edge-faint"
                                />
                            )}
                            {showNow && <NowMarker nowMs={nowMs} />}
                            {rows.length === 0 ? (
                                <EmptyRows filter={filter} status={status} hasTask={selectedTaskId != null} />
                            ) : (
                                rows.map((row, i) =>
                                    row.kind === "gap" ? (
                                        <GapRow key={`gap:${i}`} minutes={row.minutes} />
                                    ) : (
                                        <GroupRow
                                            key={row.group.id}
                                            group={row.group}
                                            events={events}
                                            open={row.group.id === openGroupId}
                                            selected={selectedTaskId != null && row.group.taskId === selectedTaskId}
                                            graphHovered={graphHoverId != null && row.group.taskId === graphHoverId}
                                            relaunching={relaunching}
                                            relaunchError={relaunchError}
                                            onRelaunch={() => void relaunchLead()}
                                            onToggle={() => {
                                                setOpenGroupId((id) => (id === row.group.id ? null : row.group.id));
                                                applyTarget(eventClickTarget(row.group.head), channelId);
                                            }}
                                            onEnter={() => {
                                                if (row.group.taskId) {
                                                    setHovered({ id: row.group.taskId, from: "timeline" });
                                                }
                                            }}
                                            // a graph hover that began meanwhile is not the rail's to clear
                                            onLeave={() => setHovered((h) => (h?.from === "timeline" ? null : h))}
                                        />
                                    )
                                )
                            )}
                        </div>
                    </div>
                </>
            )}
        </div>
    );
}

function RailHeader({
    count,
    status,
    layout,
    open,
    onToggle,
    onRetry,
}: {
    count: number;
    status: "loading" | "live" | "error";
    layout: "rail" | "drawer";
    open: boolean;
    onToggle: () => void;
    onRetry: () => void;
}) {
    return (
        <div className="flex flex-none items-center gap-2 border-b border-border px-3 py-2">
            {layout === "drawer" && (
                <button
                    type="button"
                    onClick={onToggle}
                    aria-expanded={open}
                    aria-label={open ? "Collapse lifecycle" : "Expand lifecycle"}
                    className="cursor-pointer text-muted focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-accent"
                >
                    {open ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
                </button>
            )}
            <span className="text-[10.5px] font-bold uppercase tracking-[0.1em] text-ink-mid">Lifecycle</span>
            <span className="text-[11.5px] text-secondary">{count} events</span>
            <StatusPill status={status} onRetry={onRetry} />
        </div>
    );
}

// StatusPill always carries text, never color alone (spec 6.4), and never claims "live" for a load
// that has not returned.
function StatusPill({ status, onRetry }: { status: "loading" | "live" | "error"; onRetry: () => void }) {
    if (status === "error") {
        return (
            <button
                type="button"
                onClick={onRetry}
                className="ml-auto cursor-pointer text-[10.5px] text-warning underline decoration-dotted focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-accent"
            >
                load failed · retry
            </button>
        );
    }
    return (
        <span className={"ml-auto text-[10.5px] " + (status === "live" ? "text-success" : "text-muted")}>
            {status === "live" ? "● live" : "loading…"}
        </span>
    );
}

// tick height ranks an event by its tone, so attention stands out and plain bookkeeping recedes
function tickHeight(kind: string, attention: boolean): number {
    if (attention) {
        return TICK_ATTENTION_H;
    }
    const tone = toneFor(kind);
    if (tone === "text-success") {
        return TICK_SUCCESS_H;
    }
    return tone === "text-muted" ? TICK_MUTED_H : TICK_TONED_H;
}

function tickOpacity(kind: string, taskId: string, focusTaskId: string | null): number {
    if (focusTaskId != null) {
        return taskId === focusTaskId ? 1 : TICK_FADED_OPACITY;
    }
    return toneFor(kind) === "text-muted" ? 0.5 : 0.85;
}

function ActivityStrip({
    events,
    nowMs,
    focusTaskId,
}: {
    events: RunEvent[];
    nowMs: number;
    focusTaskId: string | null;
}) {
    if (events.length === 0) {
        return null;
    }
    // stripTicks maps events one to one and in order, so a tick's kind is its event's
    const ticks = stripTicks(events, nowMs);
    const start = Math.min(...events.map((e) => e.ts));
    const spanMin = Math.max(0, Math.round((nowMs - start) / 60_000));
    const label = `${events.length} events from ${tsLabel(start)} to ${tsLabel(nowMs)}; amber marks need attention`;
    return (
        <div className="flex-none border-b border-border px-3 pt-2.5 pb-2">
            {/* the right padding holds a tick at the very end of the axis, which is drawn 2px wide from its x */}
            <div className="pr-[2px]">
                <svg role="img" aria-label={label} width="100%" height={STRIP_H} className="block overflow-visible">
                    <line x1="0" x2="100%" y1={STRIP_H - 0.5} y2={STRIP_H - 0.5} stroke="var(--color-edge-mid)" />
                    {ticks.map((t, i) => {
                        const kind = events[i].kind;
                        const h = tickHeight(kind, t.attention);
                        return (
                            <rect
                                key={t.id}
                                className={toneFor(kind)}
                                x={`${t.frac * 100}%`}
                                y={STRIP_H - 1 - h}
                                width={2}
                                height={h}
                                rx={1}
                                fill="currentColor"
                                opacity={tickOpacity(kind, t.taskId, focusTaskId)}
                            />
                        );
                    })}
                    <line x1="100%" x2="100%" y1={0} y2={STRIP_H} stroke="var(--color-accent)" />
                </svg>
            </div>
            <div className="mt-1 flex justify-between text-[10.5px] tabular-nums text-muted">
                <span>{tsLabel(start)}</span>
                <span>{spanMin} min</span>
                <span>now {tsLabel(nowMs)}</span>
            </div>
        </div>
    );
}

function NowMarker({ nowMs }: { nowMs: number }) {
    return (
        <div className="relative flex items-center gap-2 pt-0.5 pr-2.5 pb-1.5 pl-[11px]">
            <span className="flex w-5 flex-none justify-center">
                <span className="size-2 rounded-full bg-accent pulse-dot" />
            </span>
            <span className="text-[10.5px] tabular-nums text-accent-soft">now · {tsLabel(nowMs)}</span>
        </div>
    );
}

function GapRow({ minutes }: { minutes: number }) {
    return (
        <div className="relative flex items-center gap-2 py-1 pr-2.5 pl-[11px]">
            <span className="flex w-5 flex-none justify-center">
                <span className="size-[5px] rounded-full bg-edge-mid" />
            </span>
            <span className="flex-1 border-t border-dashed border-edge-mid" />
            <span className="text-[10.5px] tabular-nums text-muted">{minutes} min quiet</span>
            <span className="flex-1 border-t border-dashed border-edge-mid" />
        </div>
    );
}

function EmptyRows({
    filter,
    status,
    hasTask,
}: {
    filter: TimelineFilter;
    status: "loading" | "live" | "error";
    hasTask: boolean;
}) {
    if (status === "loading") {
        return (
            <div aria-hidden="true" className="flex flex-col gap-2 px-3 py-3">
                {["w-[75%]", "w-[55%]", "w-[65%]"].map((w, i) => (
                    <SkeletonLine key={i} className={cn("h-[10px]", w)} />
                ))}
            </div>
        );
    }
    let text = "No lifecycle events yet";
    if (status === "error") {
        text = "History unavailable";
    } else if (filter === "task") {
        text = hasTask ? "No events for this task" : "Select a task to filter";
    } else if (filter === "attention") {
        text = "Nothing needs attention";
    }
    return <div className="py-2.5 pr-3 pl-10 text-[11.5px] text-muted">{text}</div>;
}

// the burst's lifecycle icon on the spine; compact is the run sheet's one-line row
export function SpineGlyph({ kind, attention, compact }: { kind: string; attention: boolean; compact?: boolean }) {
    const tone = toneFor(kind);
    let fill = "border-edge-mid bg-surface-raised";
    if (attention) {
        fill = "border-warning/55 bg-warning/10";
    } else if (tone === "text-success") {
        fill = "border-edge-mid bg-success/12";
    }
    const glyph = compact ? 9 : 11;
    return (
        <span className="relative flex w-5 flex-none justify-center">
            <span
                className={cn(
                    "flex items-center justify-center rounded-full border",
                    compact ? "size-4" : "mt-2 size-5",
                    fill,
                    tone
                )}
            >
                <svg
                    width={glyph}
                    height={glyph}
                    viewBox="0 0 24 24"
                    aria-hidden="true"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth={compact ? 2.4 : 2.2}
                    strokeLinecap="round"
                    strokeLinejoin="round"
                >
                    <path d={GLYPH_PATHS[glyphOf(kind)]} />
                </svg>
            </span>
        </span>
    );
}

export function groupTime(group: EventGroup): string {
    const first = tsLabel(group.first);
    const last = tsLabel(group.last);
    return first === last ? first : `${first}–${last}`;
}

function GroupRow({
    group,
    events,
    open,
    selected,
    graphHovered,
    relaunching,
    relaunchError,
    onRelaunch,
    onToggle,
    onEnter,
    onLeave,
}: {
    group: EventGroup;
    events: RunEvent[];
    open: boolean;
    selected: boolean;
    graphHovered: boolean;
    relaunching: boolean;
    relaunchError: string | null;
    onRelaunch: () => void;
    onToggle: () => void;
    onEnter: () => void;
    onLeave: () => void;
}) {
    const snippet = groupSnippet(group);
    let rowTone = "border-transparent hover:bg-surface-hover";
    if (open) {
        rowTone = "border-edge-mid bg-surface-raised";
    } else if (graphHovered) {
        rowTone = "border-transparent bg-surface-hover";
    } else if (group.attention) {
        rowTone = "border-warning/30 bg-warning/5 hover:bg-surface-hover";
    }
    return (
        <div className="relative flex gap-2 py-0.5 pr-2.5 pl-[11px]">
            <SpineGlyph kind={group.head.kind} attention={group.attention} />
            <div className="flex min-w-0 flex-1 flex-col">
                <button
                    type="button"
                    data-timeline-row
                    data-timeline-task={group.taskId || undefined}
                    aria-expanded={open}
                    onClick={onToggle}
                    onPointerEnter={onEnter}
                    onPointerLeave={onLeave}
                    className={cn(
                        "my-0.5 flex w-full cursor-pointer flex-col gap-1 rounded-lg border px-2 py-1.5 text-left focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-accent",
                        rowTone
                    )}
                >
                    <span className="flex w-full items-center gap-1.5">
                        <span
                            className={cn(
                                "min-w-0 truncate text-[12px] font-semibold",
                                group.attention ? "text-warning" : "text-ink-hi"
                            )}
                        >
                            {eventTitle(group.head)}
                        </span>
                        {group.taskId && (
                            <span
                                className={cn(
                                    "flex-none rounded px-1.5 text-[10.5px] leading-4",
                                    selected ? "bg-accent/12 text-accent-soft" : "bg-pill text-ink-mid"
                                )}
                            >
                                {group.taskId}
                            </span>
                        )}
                        <span className="ml-auto flex-none text-[10.5px] tabular-nums text-ink-mid">
                            {groupTime(group)}
                        </span>
                    </span>
                    {group.steps.length > 1 && (
                        <span className="flex flex-wrap gap-[3px]">
                            {group.steps.map((e) => (
                                <span
                                    key={e.id}
                                    className={cn(
                                        "rounded bg-pill px-1.5 text-[10.5px] leading-4",
                                        toneFor(e.kind)
                                    )}
                                >
                                    {stepLabel(e)}
                                </span>
                            ))}
                        </span>
                    )}
                    {snippet && (
                        <span
                            className={cn(
                                "block truncate text-[10.5px]",
                                group.attention ? "text-warning-soft" : "text-ink-mid"
                            )}
                        >
                            {snippet}
                        </span>
                    )}
                </button>
                {open && (
                    <GroupDetail
                        group={group}
                        events={events}
                        relaunching={relaunching}
                        relaunchError={relaunchError}
                        onRelaunch={onRelaunch}
                    />
                )}
            </div>
        </div>
    );
}

function GroupDetail({
    group,
    events,
    relaunching,
    relaunchError,
    onRelaunch,
}: {
    group: EventGroup;
    events: RunEvent[];
    relaunching: boolean;
    relaunchError: string | null;
    onRelaunch: () => void;
}) {
    const relaunch = group.items.map((e) => relaunchLeadAction(e, events, relaunching)).find((a) => a != null) ?? null;
    return (
        <div className="mb-1.5 flex flex-col gap-1.5 rounded-lg border border-edge-faint bg-surface-code p-2">
            {[...group.items].reverse().map((e) => {
                const detail = eventDetail(e);
                return (
                    <div key={e.id} className="flex flex-col gap-0.5">
                        <div className="flex gap-1.5 text-[10.5px] tabular-nums">
                            <span className="text-muted">{tsLabel(e.ts)}</span>
                            <span className={toneFor(e.kind)}>{eventTitle(e)}</span>
                        </div>
                        {detail.text && (
                            <div className="whitespace-pre-line break-words text-[10.5px] leading-[14px] text-secondary">
                                {detail.text}
                            </div>
                        )}
                        {detail.pre && (
                            <pre className="m-0 max-h-[160px] overflow-auto whitespace-pre-wrap break-all font-mono text-[10.5px] leading-[14px] text-warning">
                                {detail.pre}
                            </pre>
                        )}
                    </div>
                );
            })}
            {relaunch && (
                <button
                    type="button"
                    onClick={onRelaunch}
                    disabled={relaunch.disabled}
                    className="self-start cursor-pointer rounded border border-edge-mid px-2 py-0.5 text-[11px] font-semibold text-secondary hover:border-accent hover:text-accent focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-accent disabled:cursor-not-allowed disabled:opacity-50"
                >
                    {relaunch.disabled ? "Relaunching…" : "Relaunch lead"}
                </button>
            )}
            {relaunch && relaunchError && <div className="text-[11px] text-warning">{relaunchError}</div>}
        </div>
    );
}

// applyTarget routes a selected row. Task-scoped targets go through selectedTaskIdAtom — the single
// DAG selection source (spec 6.3) — so the graph, the worker rail and the timeline stay in step. A
// worker row selects its task rather than jumping: selection surfaces the graph rail's existing
// "Open in Agent" action, and a second navigation path is exactly what spec 6.2 forbids.
function applyTarget(target: TimelineTarget, channelId: string): void {
    switch (target.kind) {
        case "worker":
        case "dag-task":
        case "gate":
        case "merge":
            globalStore.set(selectedTaskIdAtom, target.taskId);
            return;
        case "child-run":
            setActiveRunId(channelId, target.runId);
            return;
        case "evidence":
            document.querySelector("[data-evidence-block]")?.scrollIntoView({ behavior: "smooth", block: "start" });
            return;
        default:
            return;
    }
}
