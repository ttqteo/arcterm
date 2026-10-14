// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

// The Setup surface's Memory tab: every registered project's Claude Code auto memory, the changes the
// weekly check proposes, and the selected change's evidence and diff with its verdict buttons. All
// derivation is in memorymodel.ts, the atoms and RPCs in memorystore.ts.

import { globalStore } from "@/app/store/jotaiStore";
import { REGION_LABEL } from "@/app/view/jarvis/briefstyle";
import { cn, fireAndForget } from "@/util/util";
import { useAtomValue } from "jotai";
import { TriangleAlert } from "lucide-react";
import { useEffect, type KeyboardEvent } from "react";
import {
    changeGroups,
    checkLine,
    closedText,
    fileLabel,
    indexCards,
    isPending,
    kindLabel,
    LIMIT_BYTES,
    LIMIT_LINES,
    railRow,
    splitText,
    statusOf,
    switchGate,
    toolbarStatus,
    type IndexCard,
} from "./memorymodel";
import {
    checkMemory,
    decideMemory,
    loadMemory,
    memoryBusyAtom,
    memoryErrorAtom,
    memoryProjectsAtom,
    memorySelectedChangeAtom,
    memorySelectedProjectAtom,
    selectMemoryChange,
    selectMemoryProject,
    subscribeMemory,
} from "./memorystore";
import { fmtClock } from "./runcompletion";
import type { Tone } from "./setupmodel";

const SECTION_HEAD = cn(REGION_LABEL, "text-muted");
const BTN_SECONDARY =
    "h-8 flex-none cursor-pointer rounded border border-edge-mid bg-surface-raised px-3 text-[13px] font-semibold text-ink-mid hover:border-edge-strong hover:bg-surface-hover hover:text-primary disabled:cursor-default disabled:text-ink-faint disabled:hover:border-edge-mid disabled:hover:bg-surface-raised";
const BTN_PRIMARY =
    "h-8 cursor-pointer rounded border-0 bg-accent px-[14px] text-[13px] font-bold text-background shadow-inset-highlight hover:bg-accenthover disabled:cursor-default disabled:opacity-40 disabled:hover:bg-accent";
const KIND_CHIP =
    "inline-flex h-[22px] items-center whitespace-nowrap rounded-md border border-edge-mid bg-surface-hover px-2 text-[11px] font-semibold text-ink-mid";
const TABLE_GRID = "grid grid-cols-[148px_minmax(0,1fr)_128px_92px] items-center px-3";

const TONE_DOT: Record<Tone, string> = { ok: "bg-success", warn: "bg-warning", none: "bg-ink-faint" };
const TONE_TEXT: Record<Tone, string> = { ok: "text-ink-mid", warn: "text-warning-soft", none: "text-muted" };

const DIFF_LINE: Record<string, string> = {
    "-": "bg-diff-removed/10 text-diff-removed",
    "+": "bg-diff-added/10 text-diff-added",
};

function toTone(s: string): Tone {
    return s === "ok" || s === "warn" ? s : "none";
}

function Dot({ tone, className }: { tone: Tone; className?: string }) {
    return <span className={cn("h-1.5 w-1.5 flex-none rounded-full", TONE_DOT[tone], className)} />;
}

function Meter({ pct }: { pct: number }) {
    return (
        <span className="block h-1 overflow-hidden rounded-full bg-edge-mid">
            <span className="block h-1 bg-success" style={{ width: `${pct}%` }} />
        </span>
    );
}

function baseName(path: string): string {
    return path.split(/[\\/]/).pop() ?? path;
}

export function MemoryHeader() {
    const projects = useAtomValue(memoryProjectsAtom);
    if (projects == null) {
        return null;
    }
    const s = toolbarStatus(projects);
    return (
        <div className={cn("flex items-center gap-2 text-[12px]", TONE_TEXT[s.tone])}>
            <Dot tone={s.tone} className="h-[7px] w-[7px]" />
            {s.text}
        </div>
    );
}

// ---- project rail ----

function ProjectRail({ projects, selected }: { projects: MemHygieneProject[]; selected: string }) {
    return (
        <aside
            aria-label="Projects"
            className="flex w-[264px] flex-none flex-col gap-1 overflow-y-auto border-r border-border bg-surface px-2.5 py-3.5"
        >
            <div className={cn(SECTION_HEAD, "px-2 pb-1.5")}>Projects</div>
            {projects.map((p) => {
                const row = railRow(p);
                const on = row.name === selected;
                return (
                    <button
                        key={row.name}
                        type="button"
                        data-memory-project={row.name}
                        aria-pressed={on}
                        onClick={() => selectMemoryProject(row.name)}
                        className={cn(
                            "flex w-full cursor-pointer flex-col gap-[5px] rounded border-0 px-2.5 py-[9px] text-left text-secondary",
                            on
                                ? "bg-surface-selected ring-1 ring-edge-strong ring-inset"
                                : "bg-transparent hover:bg-surface-hover"
                        )}
                    >
                        <span className="text-[13px] font-semibold text-primary">{row.name}</span>
                        <span className="mt-0.5">
                            <Meter pct={row.pct} />
                        </span>
                        <span className="font-mono text-[10.5px] text-ink-mid">{row.meter}</span>
                        <span className={cn("flex items-center gap-1.5 text-[11px]", TONE_TEXT[row.tone])}>
                            <Dot tone={row.tone} />
                            {row.status}
                        </span>
                    </button>
                );
            })}
            {projects.length === 0 ? <div className="px-2 text-[12px] text-muted">No registered projects.</div> : null}
            <span className="flex-1" />
            <p className="m-0 px-2 text-[11.5px] leading-[1.5] text-muted">
                Claude Code loads the first {LIMIT_LINES} lines or {LIMIT_BYTES / 1000} KB of a project's MEMORY.md. Arc
                checks every project once a week.
            </p>
        </aside>
    );
}

// ---- center ----

function IndexCardView({ card }: { card: IndexCard }) {
    const stat = (label: string, value: string, pct: number) => (
        <div className="flex flex-col gap-1.5">
            <div className="flex justify-between text-[12px]">
                <span className="text-ink-mid">{label}</span>
                <span className="font-mono text-secondary">{value}</span>
            </div>
            <Meter pct={pct} />
        </div>
    );
    return (
        <div
            data-memory-card
            className="flex flex-col gap-2 rounded border border-edge-mid bg-surface-raised px-3.5 py-3"
        >
            <div className="flex justify-between gap-3 text-[12px]">
                <span className="font-semibold text-secondary">{card.label}</span>
                <span className="text-muted">{card.role}</span>
            </div>
            <div className="grid grid-cols-2 gap-4">
                {stat("Lines", card.lines, card.linesPct)}
                {stat("Size", card.kb, card.kbPct)}
            </div>
            <div className="text-[12px] text-accent-soft">{card.after}</div>
        </div>
    );
}

function ChangeTable({ p, selected }: { p: MemHygieneProject; selected: string | null }) {
    const groups = changeGroups(p);
    const onKey = (e: KeyboardEvent, id: string) => {
        if (e.key === "Enter" || e.key === " ") {
            e.preventDefault();
            selectMemoryChange(id);
        }
    };
    return (
        <div
            role="table"
            aria-label="Proposed changes"
            className="flex min-h-0 flex-1 flex-col overflow-hidden rounded border border-edge-mid bg-surface"
        >
            <div
                role="row"
                className={cn(
                    TABLE_GRID,
                    "min-h-9 flex-none border-b border-edge-mid bg-surface-raised text-[11px] font-bold tracking-[0.04em] text-ink-mid"
                )}
            >
                <span role="columnheader">Change</span>
                <span role="columnheader">Memory</span>
                <span role="columnheader">Effect</span>
                <span role="columnheader">Status</span>
            </div>
            <div className="min-h-0 flex-1 overflow-y-auto">
                {p.changes.length === 0 ? (
                    <div className="px-3 py-6 text-center text-[12.5px] text-muted">Nothing to review.</div>
                ) : null}
                {groups.map((g) => (
                    <div key={g.key} role="rowgroup" aria-label={g.label || undefined}>
                        {g.label ? (
                            <div className="flex items-baseline gap-2.5 border-b border-edge-faint px-3 pb-1.5 pt-3">
                                <span className={SECTION_HEAD}>{g.label}</span>
                                <span className="text-[11.5px] text-muted">{g.hint}</span>
                            </div>
                        ) : null}
                        {g.changes.map((c) => {
                            const on = c.id === selected;
                            const status = statusOf(c);
                            return (
                                <div
                                    key={c.id}
                                    role="row"
                                    tabIndex={0}
                                    data-memory-change={c.id}
                                    aria-selected={on}
                                    onClick={() => selectMemoryChange(c.id)}
                                    onKeyDown={(e) => onKey(e, c.id)}
                                    className={cn(
                                        TABLE_GRID,
                                        "min-h-[54px] cursor-pointer border-b border-edge-faint outline-none focus-visible:ring-1 focus-visible:ring-accent focus-visible:ring-inset",
                                        on
                                            ? "bg-surface-selected shadow-[inset_2px_0_0_var(--color-accent)]"
                                            : "hover:bg-surface-hover"
                                    )}
                                >
                                    <span role="cell">
                                        <span className={KIND_CHIP}>{kindLabel(p, c)}</span>
                                    </span>
                                    <span role="cell" className="flex min-w-0 flex-col gap-[3px] pr-3">
                                        <span
                                            className={cn(
                                                "text-[13px] font-medium",
                                                isPending(c) ? "text-ink-hi" : "text-muted"
                                            )}
                                        >
                                            {c.title}
                                        </span>
                                        <span className="truncate font-mono text-[10.5px] text-muted">
                                            {fileLabel(c)}
                                        </span>
                                    </span>
                                    <span role="cell" className="font-mono text-[11px] text-ink-mid">
                                        {c.effect}
                                    </span>
                                    <span
                                        role="cell"
                                        className={cn(
                                            "flex items-center gap-1.5 text-[11.5px]",
                                            TONE_TEXT[status.tone]
                                        )}
                                    >
                                        <Dot tone={status.tone} />
                                        {status.text}
                                    </span>
                                </div>
                            );
                        })}
                    </div>
                ))}
            </div>
        </div>
    );
}

function ProjectPane({ p, selected }: { p: MemHygieneProject; selected: string | null }) {
    const busy = useAtomValue(memoryBusyAtom);
    const cards = indexCards(p);
    const split = splitText(p);
    return (
        <main className="flex min-w-0 flex-1 flex-col gap-3.5 px-5 pb-[18px] pt-4">
            <div className="flex items-center gap-3.5">
                <div className="flex min-w-0 flex-col gap-[3px]">
                    <div className="text-[15px] font-semibold text-primary">{p.project}</div>
                    <div className="text-[12px] text-muted">{checkLine(p, Date.now())}</div>
                </div>
                <span className="flex-1" />
                <button
                    type="button"
                    data-memory-check
                    disabled={busy || p.checking}
                    onClick={() => fireAndForget(() => checkMemory(p.project))}
                    className={BTN_SECONDARY}
                >
                    Check now
                </button>
            </div>
            {split ? <p className="m-0 text-[12.5px] leading-[1.5] text-secondary">{split}</p> : null}
            <section
                aria-label="Index size"
                className={cn("grid gap-3", cards.length > 1 ? "grid-cols-2" : "grid-cols-1")}
            >
                {cards.map((c) => (
                    <IndexCardView key={c.label} card={c} />
                ))}
            </section>
            <ChangeTable p={p} selected={selected} />
        </main>
    );
}

// ---- detail rail ----

function ConflictAlert({ p, change }: { p: MemHygieneProject; change: MemChange }) {
    const busy = useAtomValue(memoryBusyAtom);
    const what = change.conflictfile ? baseName(change.conflictfile) : "A file this change touches";
    return (
        <div
            role="alert"
            data-memory-conflict
            className="flex flex-col gap-2.5 rounded border border-warning/30 bg-warning/10 px-3.5 py-2.5"
        >
            <span className="flex gap-2 text-[12.5px] leading-[1.5] text-secondary">
                <TriangleAlert size={16} strokeWidth={2} className="mt-0.5 flex-none text-warning" />
                <span>
                    <span className="font-semibold text-warning-soft">Changed on disk since the check.</span> {what}{" "}
                    changed after Arc checked it at {fmtClock(p.checkedat)}. Check it again before applying.
                </span>
            </span>
            <span>
                <button
                    type="button"
                    disabled={busy || p.checking}
                    onClick={() => fireAndForget(() => checkMemory(p.project))}
                    className={cn(BTN_SECONDARY, "h-[30px] text-[12.5px]")}
                >
                    Check again
                </button>
            </span>
        </div>
    );
}

function DiffBlock({ diff }: { diff: MemDiff }) {
    return (
        <div className="overflow-hidden rounded border border-edge-mid bg-surface-code">
            <div className="flex h-7 items-center gap-2.5 border-b border-edge-faint px-2.5 font-mono text-[11px] text-muted">
                <span title={diff.path} className="min-w-0 truncate">
                    {diff.path}
                </span>
                <span className="flex-1" />
                <span className="flex-none">{diff.note}</span>
            </div>
            {diff.lines?.length ? (
                <div className="py-1.5">
                    {diff.lines.map((ln, i) => (
                        <div
                            key={i}
                            className={cn(
                                "flex gap-2 px-2.5 py-px font-mono text-[11.5px] leading-[18px]",
                                DIFF_LINE[ln.sign] ?? "text-ink-mid"
                            )}
                        >
                            <span className="w-2 flex-none">{ln.sign}</span>
                            <span className="whitespace-pre-wrap break-words">{ln.text}</span>
                        </div>
                    ))}
                </div>
            ) : null}
        </div>
    );
}

function Verdict({ p, change }: { p: MemHygieneProject; change: MemChange }) {
    const busy = useAtomValue(memoryBusyAtom);
    const decide = (verdict: "apply" | "keep" | "undo" | "reopen") =>
        fireAndForget(() => decideMemory(p.project, change.id, verdict));
    if (!isPending(change)) {
        const status = statusOf(change);
        const applied = change.status === "applied";
        return (
            <div className="flex items-center gap-3">
                <div
                    role="status"
                    className={cn(
                        "flex min-w-0 flex-1 items-start gap-2 text-[12.5px] leading-[1.5]",
                        TONE_TEXT[status.tone]
                    )}
                >
                    <Dot tone={status.tone} className="mt-1.5 h-[7px] w-[7px]" />
                    {closedText(p, change, Date.now())}
                </div>
                <button
                    type="button"
                    data-memory-undo
                    disabled={busy}
                    onClick={() => decide(applied ? "undo" : "reopen")}
                    className={BTN_SECONDARY}
                >
                    {applied ? "Undo" : "Review again"}
                </button>
            </div>
        );
    }
    const gate = switchGate(p, change);
    const blocked = gate.blocked || change.status === "conflict";
    return (
        <>
            {gate.blocked ? (
                <p role="status" data-memory-gate className="m-0 text-[12px] leading-[1.5] text-warning-soft">
                    {gate.text}
                </p>
            ) : null}
            <div className="flex justify-end gap-2">
                <button
                    type="button"
                    data-memory-keep
                    disabled={busy}
                    onClick={() => decide("keep")}
                    className={BTN_SECONDARY}
                >
                    Keep as is
                </button>
                <button
                    type="button"
                    data-memory-apply
                    disabled={busy || blocked}
                    onClick={() => decide("apply")}
                    className={BTN_PRIMARY}
                >
                    {change.applylabel || kindLabel(p, change)}
                </button>
            </div>
        </>
    );
}

function ChangeDetail({ p, change }: { p: MemHygieneProject; change: MemChange }) {
    return (
        <aside
            aria-label="Change detail"
            data-memory-detail
            className="flex w-[400px] flex-none flex-col gap-3.5 overflow-y-auto border-l border-border bg-surface p-4"
        >
            <div className="flex flex-col gap-1.5">
                <span>
                    <span className={KIND_CHIP}>{kindLabel(p, change)}</span>
                </span>
                <div className="text-[14px] font-semibold text-primary">{change.title}</div>
                <div className="break-all font-mono text-[10.5px] text-muted">{fileLabel(change)}</div>
            </div>
            {change.status === "conflict" ? <ConflictAlert p={p} change={change} /> : null}
            {change.evidence?.length ? (
                <div className="flex flex-col gap-2">
                    <div className={SECTION_HEAD}>Why</div>
                    {change.evidence.map((e, i) => (
                        <div key={i} className="flex items-start gap-2 text-[12px] leading-[1.5] text-secondary">
                            <Dot tone={toTone(e.tone)} className="mt-1.5" />
                            <span>
                                {e.text}
                                {e.code ? <span className="font-mono text-[11px] text-ink-hi">{e.code}</span> : null}
                            </span>
                        </div>
                    ))}
                </div>
            ) : null}
            {change.diffs?.length || change.note ? (
                <div className="flex flex-col gap-2">
                    <div className={SECTION_HEAD}>Change</div>
                    {(change.diffs ?? []).map((d, i) => (
                        <DiffBlock key={i} diff={d} />
                    ))}
                    {change.note ? <p className="m-0 text-[11.5px] leading-[1.5] text-muted">{change.note}</p> : null}
                </div>
            ) : null}
            <span className="flex-1" />
            <Verdict p={p} change={change} />
        </aside>
    );
}

// ---- tab ----

// with nothing chosen yet, open the first change still to review
function pickChange(p: MemHygieneProject, id: string | null): MemChange | null {
    return p.changes.find((c) => c.id === id) ?? p.changes.find(isPending) ?? p.changes[0] ?? null;
}

export function MemoryTab() {
    const projects = useAtomValue(memoryProjectsAtom);
    const selectedName = useAtomValue(memorySelectedProjectAtom);
    const selectedChange = useAtomValue(memorySelectedChangeAtom);
    const error = useAtomValue(memoryErrorAtom);
    // re-read on every visit, and on every state write while the tab is open. a failure from an earlier
    // visit must not leave its banner over fresh data.
    useEffect(() => {
        globalStore.set(memoryErrorAtom, null);
        fireAndForget(loadMemory);
        return subscribeMemory();
    }, []);
    const p = projects?.find((x) => x.project === selectedName) ?? projects?.[0] ?? null;
    const change = p == null ? null : pickChange(p, selectedChange);
    return (
        <div className="flex min-w-0 flex-1 flex-col">
            {error ? (
                <div
                    role="alert"
                    data-memory-error
                    className="flex-none border-b border-error/30 bg-error/10 px-5 py-2 text-[12.5px] text-error-soft"
                >
                    {error}
                </div>
            ) : null}
            <div className="flex min-h-0 flex-1">
                {projects == null ? (
                    <div className="flex flex-1 items-center justify-center text-[13px] text-muted">Reading…</div>
                ) : (
                    <>
                        <ProjectRail projects={projects} selected={p?.project ?? ""} />
                        {p != null ? <ProjectPane p={p} selected={change?.id ?? null} /> : null}
                        {p != null && change != null ? <ChangeDetail p={p} change={change} /> : null}
                    </>
                )}
            </div>
        </div>
    );
}
