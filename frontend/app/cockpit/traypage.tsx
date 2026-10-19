// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0
//
// The tray popover's main page, its loading and offline pages, and the parts the subpages share (spec
// 2026-10-15-tray-popover-design.md; boards in .superpowers/design/tray-popover). It draws a TraySnapshot and sends
// TrayActs; frontend/tauri/tray.tsx wires both to the cockpit. traysubpages.tsx draws Free up and Clean up.

import { cn } from "@/util/util";
import { ChevronLeft, Cpu, HardDrive, MemoryStick, Pause, Settings } from "lucide-react";
import type { ReactNode } from "react";
import { formatElapsed, formatLeft, PACE_CHOICES, PAUSE_CHOICES } from "./jobqueue";
import {
    cpuLoad,
    fmtDisk,
    fmtSize,
    LEVEL_DOT,
    LEVEL_TEXT,
    levelWord,
    split,
    swapUsed,
    USAGE_BAR,
    USAGE_TEXT,
} from "./trayformat";
import type { TrayAct, TrayDisk, TrayJob, TrayLevel, TrayPage, TraySnapshot } from "./traytypes";

export type Send = (act: TrayAct) => void;

export const CARD = "flex min-w-0 flex-col gap-2 rounded border border-edge-mid bg-surface-raised px-3 py-2.5";
export const ROW_BUTTON =
    "cursor-pointer rounded border border-edge-mid px-1.5 py-[1px] text-[11px] text-secondary hover:border-edge-strong hover:bg-surface-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent";
export const OPEN_BUTTON =
    "cursor-pointer rounded px-1 text-[12px] text-muted hover:bg-surface-hover hover:text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent";
const SELECT =
    "h-[22px] cursor-pointer rounded-[7px] border border-border bg-surface px-1 text-[11.5px] text-secondary hover:border-edge-mid focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent";
const FOOT_BUTTON =
    "h-7 cursor-pointer rounded border border-edge-mid bg-surface-raised text-[12px] text-secondary hover:border-edge-strong hover:bg-surface-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent";

export function PressureWord({ level, platform }: { level: TrayLevel; platform: TraySnapshot["platform"] }) {
    const word = levelWord(level);
    if (word == null) {
        return null;
    }
    return (
        <span
            data-tray-pressure={level}
            title={
                platform === "win"
                    ? "Windows reads it from the commit charge against the RAM"
                    : "macOS memory pressure, as Activity Monitor reads it"
            }
            className={cn("flex items-center gap-1 text-[11px] font-semibold", LEVEL_TEXT[level])}
        >
            <span className={cn("h-[7px] w-[7px] rounded-full", LEVEL_DOT[level])} />
            {word}
        </span>
    );
}

export function SubHeader({ title, back, right }: { title: string; back: () => void; right?: ReactNode }) {
    return (
        <div className="flex items-center gap-1.5 px-0.5 pt-0.5">
            <button
                type="button"
                aria-label="Back"
                title="Back (Esc)"
                onClick={back}
                className={cn(OPEN_BUTTON, "p-1")}
            >
                <ChevronLeft size={14} className="text-secondary" aria-hidden />
            </button>
            <span className="flex-1 text-[13px] font-semibold text-primary">{title}</span>
            {right}
        </div>
    );
}

// Memory and CPU are one line each, as a system menu bar app draws them: the queue's rules and the CPU's minute are in
// Heavy jobs and Activity Monitor
function MemoryCard({ s, onFreeUp }: { s: TraySnapshot; onFreeUp: () => void }) {
    const m = s.machine;
    const level = m?.pressure ?? "unknown";
    return (
        <div data-tray-card="memory" className={CARD}>
            <div className="flex items-center gap-1.5">
                <MemoryStick size={13} className="text-muted" aria-hidden />
                <span className="flex-1 text-[12px] font-semibold text-secondary">Memory</span>
                <PressureWord level={level} platform={s.platform} />
            </div>
            {/* wraps: "12.4 GB free of 31.8 GB" is wider than the half-width card */}
            <span className="text-[12px] tabular-nums text-muted">
                {m ? (
                    <>
                        <span className="font-semibold text-primary">{fmtSize(m.memAvailable)}</span> free of{" "}
                        {fmtSize(m.memTotal)}
                    </>
                ) : (
                    "—"
                )}
            </span>
            <div className="mt-auto flex items-center gap-1.5">
                {/* swap is apart from the RAM above: on a full Mac it is what makes everything slow */}
                <span
                    data-tray-swap
                    title={
                        s.platform === "win"
                            ? "Memory Windows has moved out to its paging file; it is not in the figure above"
                            : "Memory macOS has moved out to disk; it is not in the figure above"
                    }
                    className="min-w-0 flex-1 truncate text-[11px] tabular-nums text-muted"
                >
                    {/* no "used": beside Free up, "Swap: 12.4 GB used" is cut short in the half card */}
                    {m ? (
                        <>
                            Swap: <span className="text-secondary">{swapUsed(m.swapUsed, m.swapTotal)}</span>
                        </>
                    ) : null}
                </span>
                <button
                    type="button"
                    data-tray-freeup
                    title="See what arcterm holds in memory and stop the heaviest"
                    onClick={onFreeUp}
                    className={ROW_BUTTON}
                >
                    Free up
                </button>
            </div>
        </div>
    );
}

function CpuCard({ s }: { s: TraySnapshot }) {
    return (
        <div data-tray-card="cpu" className={CARD}>
            <div className="flex items-center gap-1.5">
                <Cpu size={13} className="text-muted" aria-hidden />
                <span className="flex-1 text-[12px] font-semibold text-secondary">CPU</span>
            </div>
            <span title="The whole machine, over the last second" className="text-[12px] tabular-nums text-muted">
                Load: <span className="font-semibold text-primary">{cpuLoad(s.machine?.cpuPct ?? null)}</span>
            </span>
        </div>
    );
}

function DiskRow({ d }: { d: TrayDisk }) {
    const bar = split(d.total, d.total - d.free, d.arcBytes);
    return (
        <div data-tray-disk={d.root} className="flex flex-col gap-1">
            <div className="flex items-baseline gap-1.5">
                <span className="min-w-0 flex-1 truncate text-[11.5px] text-secondary">{d.name}</span>
                <span className="whitespace-nowrap text-[11px] tabular-nums text-muted">
                    <span className="text-[12.5px] font-semibold text-primary">{fmtDisk(d.free)}</span> free of{" "}
                    {fmtDisk(d.total)}
                </span>
            </div>
            <div className="flex h-[5px] overflow-hidden rounded-[3px] bg-background">
                <div
                    title={`arcterm and its agents: ${fmtDisk(d.arcBytes)}`}
                    className="h-full bg-secondary"
                    style={{ width: `${bar.arc}%` }}
                />
                <div title="Everything else" className="h-full bg-ink-faint" style={{ width: `${bar.other}%` }} />
            </div>
        </div>
    );
}

function StorageCard({ s, onCleanUp }: { s: TraySnapshot; onCleanUp: () => void }) {
    const disks = s.machine?.disks ?? [];
    const st = s.storage;
    return (
        <div data-tray-card="storage" className={CARD}>
            <div className="flex items-center gap-1.5">
                <HardDrive size={13} className="text-muted" aria-hidden />
                <span className="flex-1 text-[12px] font-semibold text-secondary">Storage</span>
                <button
                    type="button"
                    data-tray-cleanup
                    title="See what arcterm and its agents leave on disk, and clean it"
                    onClick={onCleanUp}
                    className={ROW_BUTTON}
                >
                    Clean up
                </button>
            </div>
            {disks.length === 0 ? (
                <span className="text-[12px] text-muted">—</span>
            ) : (
                disks.map((d) => <DiskRow key={d.root} d={d} />)
            )}
            <span className="flex items-center gap-1 text-[10.5px] tabular-nums text-muted">
                {st ? (
                    <>
                        <span className="h-[5px] w-2 rounded-[2px] bg-secondary" />
                        arcterm {fmtDisk(st.arcBytes)} · {fmtDisk(st.cleanableBytes)} can be cleaned
                    </>
                ) : (
                    "Not scanned yet"
                )}
            </span>
        </div>
    );
}

function JobRow({ j, send }: { j: TrayJob; send: Send }) {
    return (
        <div
            data-tray-job={j.id}
            data-state={j.running ? "running" : "queued"}
            className="flex flex-col gap-[2px] py-1"
        >
            <div className="flex items-center gap-2">
                {j.running ? (
                    <span aria-label="running" className="h-[7px] w-[7px] flex-none rounded-full bg-working" />
                ) : (
                    <span
                        title={`Number ${j.position ?? "?"} in the queue`}
                        className="w-[7px] flex-none text-[10.5px] tabular-nums text-muted"
                    >
                        {j.position ?? ""}
                    </span>
                )}
                <span className="min-w-0 flex-1 truncate text-[12.5px] text-primary" title={j.name}>
                    {j.name}
                </span>
                <span title="Its peak RAM" className="text-[12px] tabular-nums text-secondary">
                    {fmtSize(j.bytes)}
                </span>
                <span className="whitespace-nowrap text-[12px] tabular-nums text-secondary">
                    {j.running ? formatElapsed(j.elapsedMs) : `waiting ${formatElapsed(j.elapsedMs)}`}
                </span>
                {j.canOpen ? (
                    <button
                        type="button"
                        aria-label={`Open ${j.source} in arcterm`}
                        title={`Open ${j.source}`}
                        onClick={() => send({ kind: "open-job", id: j.id })}
                        className={OPEN_BUTTON}
                    >
                        ↗
                    </button>
                ) : null}
            </div>
            <div className="flex items-center gap-1.5 pl-[15px]">
                <span className="min-w-0 flex-1 truncate text-[11px] text-muted">
                    {j.source}
                    {j.reason ? ` · ${j.reason}` : ""}
                </span>
                {j.running ? null : (
                    <>
                        <button
                            type="button"
                            data-tray-run-now
                            title="Start it now, whatever is running and whatever RAM is free"
                            onClick={() => send({ kind: "run-now", id: j.id })}
                            className={ROW_BUTTON}
                        >
                            Run now
                        </button>
                        {j.engine ? null : (
                            <button
                                type="button"
                                data-tray-skip
                                title="Drop it from the queue; its agent is told it was skipped"
                                onClick={() => send({ kind: "skip", id: j.id })}
                                className={cn(ROW_BUTTON, "text-error")}
                            >
                                Skip
                            </button>
                        )}
                    </>
                )}
            </div>
        </div>
    );
}

function JobsCard({ s, send }: { s: TraySnapshot; send: Send }) {
    return (
        <div data-tray-card="jobs" className={cn(CARD, "gap-1")}>
            <div className="flex items-center gap-1.5 pb-0.5">
                <span className="flex-1 text-[12px] font-semibold text-secondary">Heavy jobs</span>
                <select
                    aria-label="Slots"
                    title="How many heavy jobs run at once. Auto starts each as soon as the RAM it needs is free; Off never makes one wait"
                    value={s.jobsMode}
                    onChange={(e) => send({ kind: "slots", value: e.target.value })}
                    className={SELECT}
                >
                    {PACE_CHOICES.map((c) => (
                        <option key={c.value} value={c.value}>
                            {c.label}
                        </option>
                    ))}
                </select>
                {s.pausedLeftMs == null ? (
                    <select
                        aria-label="Pause the queue"
                        title="Start every heavy job at once for a while, whatever RAM is free, then queue them again"
                        value=""
                        onChange={(e) => {
                            const c = PAUSE_CHOICES.find((p) => p.label === e.target.value);
                            if (c) {
                                send({ kind: "pause", ms: c.ms });
                            }
                        }}
                        className={SELECT}
                    >
                        <option value="">Pause…</option>
                        {PAUSE_CHOICES.map((c) => (
                            <option key={c.label} value={c.label}>
                                {c.label}
                            </option>
                        ))}
                    </select>
                ) : null}
            </div>
            {s.pausedLeftMs != null ? (
                <div data-tray-paused className="flex items-center gap-1.5 pb-1 pt-0.5 text-[11.5px] text-muted">
                    <Pause size={11} aria-hidden className="flex-none" />
                    <span className="flex-1 tabular-nums">
                        Paused, {formatLeft(s.pausedLeftMs)} left: every job starts at once
                    </span>
                    <button
                        type="button"
                        title="Queue heavy jobs again"
                        onClick={() => send({ kind: "pause", ms: null })}
                        className={ROW_BUTTON}
                    >
                        Resume
                    </button>
                </div>
            ) : null}
            {s.jobs.length === 0 ? (
                <span className="py-1 text-[12px] text-muted">No heavy jobs running.</span>
            ) : (
                s.jobs.map((j) => <JobRow key={j.id} j={j} send={send} />)
            )}
        </div>
    );
}

function WaitsCard({ s, send }: { s: TraySnapshot; send: Send }) {
    const total = s.waits.length + s.waitsMore;
    return (
        <div data-tray-card="waits" className={cn(CARD, "gap-0.5")}>
            <div className="flex items-center gap-1.5 pb-1">
                <span className="text-[12px] font-semibold text-secondary">Waiting on you</span>
                <span className="flex-1 text-[11px] tabular-nums text-muted">{total > 0 ? total : ""}</span>
                {s.working > 0 ? (
                    <span className="flex items-center gap-1 text-[10.5px] tabular-nums text-muted">
                        <span className="h-1.5 w-1.5 rounded-full bg-working" />
                        {s.working === 1 ? "1 agent working" : `${s.working} agents working`}
                    </span>
                ) : null}
            </div>
            {total === 0 ? <span className="py-1 text-[12px] text-muted">Nothing is waiting on you.</span> : null}
            {s.waits.map((w) => (
                <button
                    key={w.key}
                    type="button"
                    data-tray-wait={w.key}
                    title="Open it in arcterm"
                    onClick={() => send({ kind: "open-wait", key: w.key })}
                    className="flex w-full cursor-pointer items-center gap-2 rounded py-1 text-left hover:bg-surface-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
                >
                    <span
                        className={cn(
                            "min-w-8 flex-none text-[11px]",
                            w.ask ? "font-semibold text-asking" : "text-muted"
                        )}
                    >
                        {w.kind}
                    </span>
                    <span className="min-w-0 flex-1 truncate text-[12.5px] text-primary">
                        {w.title} {w.tail ? <span className="text-[11px] text-muted">{w.tail}</span> : null}
                    </span>
                    <span aria-hidden className="text-[12px] text-muted">
                        ↗
                    </span>
                </button>
            ))}
            {s.waitsMore > 0 ? (
                <button
                    type="button"
                    data-tray-more
                    onClick={() => send({ kind: "open-more" })}
                    className="cursor-pointer py-1 text-left text-[11.5px] text-muted hover:text-primary"
                >
                    {s.waitsMore} more
                </button>
            ) : null}
        </div>
    );
}

function Footer({ s, send }: { s: TraySnapshot; send: Send }) {
    const u = s.usage;
    const gear = s.platform === "mac" ? "Menu bar settings" : "Tray settings";
    return (
        <div className="flex items-center gap-2">
            <button
                type="button"
                data-tray-open
                onClick={() => send({ kind: "open-arcterm" })}
                className={cn(FOOT_BUTTON, "flex-1")}
            >
                Open arcterm
            </button>
            {u ? (
                <span
                    data-tray-usage
                    title={u.title}
                    className="flex h-7 items-center gap-2 rounded border border-edge-mid bg-surface-raised px-2.5"
                >
                    <span className="text-[11.5px] text-secondary">Claude 5h</span>
                    <span className="relative h-[5px] w-[52px] rounded-[3px] bg-background">
                        <span
                            className={cn("absolute inset-y-0 left-0 rounded-[3px]", USAGE_BAR[u.level])}
                            style={{ width: `${Math.min(100, u.pct)}%` }}
                        />
                        {u.elapsedPct != null ? (
                            <span
                                className="absolute -top-0.5 -ml-px h-[9px] w-0.5 rounded-[1px] bg-ink-hi"
                                style={{ left: `${u.elapsedPct}%` }}
                            />
                        ) : null}
                    </span>
                    <span className={cn("text-[12px] font-semibold tabular-nums", USAGE_TEXT[u.level])}>
                        {Math.round(u.pct)}%
                    </span>
                </span>
            ) : null}
            <button
                type="button"
                aria-label={gear}
                title={gear}
                onClick={() => send({ kind: "open-tray-settings" })}
                className={cn(FOOT_BUTTON, "flex w-7 items-center justify-center")}
            >
                <Settings size={14} className="text-muted" aria-hidden />
            </button>
        </div>
    );
}

export function MainPage({ s, send, setPage }: { s: TraySnapshot; send: Send; setPage: (p: TrayPage) => void }) {
    return (
        <div className="flex flex-col gap-2">
            <div className="grid grid-cols-2 gap-2">
                <MemoryCard s={s} onFreeUp={() => setPage("freeup")} />
                <CpuCard s={s} />
            </div>
            <StorageCard s={s} onCleanUp={() => setPage("storage")} />
            <JobsCard s={s} send={send} />
            <WaitsCard s={s} send={send} />
            <Footer s={s} send={send} />
        </div>
    );
}

export function LoadingPage() {
    return (
        <div className={CARD}>
            <span className="text-[12px] text-muted">Reading…</span>
        </div>
    );
}

function clock(ms: number): string {
    return new Date(ms).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", hour12: false });
}

export function OfflinePage({ lastHeard, send }: { lastHeard: number | null; send: Send }) {
    return (
        <div className="flex flex-col gap-2">
            <div role="alert" data-tray-offline className={cn(CARD, "gap-1.5 p-3")}>
                <div className="flex items-center gap-1.5">
                    <span className="h-[7px] w-[7px] rounded-full bg-error" />
                    <span className="text-[12.5px] font-semibold text-primary">arcterm's server is not answering</span>
                </div>
                <span className="text-[11.5px] leading-normal text-muted">
                    Memory, jobs and what waits on you come from it. Restart arcterm to start it again; its last lines
                    are in waveapp.log.
                </span>
                {lastHeard != null ? (
                    <span className="text-[10.5px] tabular-nums text-muted">Last heard {clock(lastHeard)}</span>
                ) : null}
            </div>
            <div className="flex items-center gap-2">
                <button
                    type="button"
                    data-tray-restart
                    onClick={() => send({ kind: "restart" })}
                    className="h-7 flex-1 cursor-pointer rounded bg-accent text-[12px] font-semibold text-background shadow-inset-highlight hover:bg-accenthover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
                >
                    Restart arcterm
                </button>
                <button type="button" onClick={() => send({ kind: "showlog" })} className={cn(FOOT_BUTTON, "px-3")}>
                    Show log
                </button>
                <button type="button" onClick={() => send({ kind: "quit" })} className={cn(FOOT_BUTTON, "px-3")}>
                    Quit
                </button>
            </div>
        </div>
    );
}
