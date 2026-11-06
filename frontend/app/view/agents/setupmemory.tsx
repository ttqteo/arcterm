// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

// The Setup surface's Memory tab: every registered project's Claude Code auto memory and the changes the
// weekly check proposes, reviewed one card at a time (memorycard.tsx) or as the table with the selected
// change's evidence and diff in a rail beside it. All derivation is in memorymodel.ts, the atoms and RPCs
// in memorystore.ts, the pieces both views draw in memoryparts.tsx.

import { KeyCap } from "@/app/element/keycap";
import { widthTween } from "@/app/element/meter";
import { microFade, viewFade } from "@/app/element/motiontokens";
import { globalStore } from "@/app/store/jotaiStore";
import { buildMemoryBindings } from "@/app/store/keybindings/bindings";
import { useKeybindings } from "@/app/store/keybindings/store";
import type { AgentsViewModel } from "@/app/view/agents/agents";
import { cn, fireAndForget } from "@/util/util";
import { useAtomValue } from "jotai";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { useEffect, useMemo, useState, type KeyboardEvent } from "react";
import { MemoryCard, MemoryDoneCard, MemoryQueue } from "./memorycard";
import {
    applyAllIds,
    canApply,
    changeGroups,
    checkLine,
    closedText,
    fileLabel,
    indexCards,
    isPending,
    judgedByText,
    kindLabel,
    LIMIT_BYTES,
    LIMIT_LINES,
    railOrder,
    railRow,
    resolveSelection,
    splitText,
    statusOf,
    switchGate,
    toolbarStatus,
    type ChangeGroup,
    type IndexCard,
    type MemoryView,
} from "./memorymodel";
import {
    BTN_PRIMARY,
    BTN_SECONDARY,
    CheckButton,
    ConflictAlert,
    DiffBlock,
    Dot,
    KindChip,
    SECTION_HEAD,
    TONE_TEXT,
    toTone,
    useFade,
} from "./memoryparts";
import {
    applyMemoryGroup,
    decideMemory,
    ensureMemoryFeed,
    loadMemory,
    memoryBulkAtom,
    memoryBusyAtom,
    memoryCheckResultAtom,
    memoryErrorAtom,
    memoryProjectsAtom,
    memorySelectedChangeAtom,
    memorySelectedProjectAtom,
    memoryViewAtom,
    memoryViewOf,
    selectMemoryChange,
    selectMemoryProject,
    setMemoryView,
    shownCard,
    type MemVerdict,
} from "./memorystore";
import { PathTail } from "./pathtail";
import { DETAIL_RAIL_WIDTH } from "./setupstyles";

const TABLE_GRID = "grid grid-cols-[148px_minmax(0,1fr)_128px_92px] items-center px-3";

function Meter({ pct }: { pct: number }) {
    const reduce = useReducedMotion();
    return (
        <span className="block h-1 overflow-hidden rounded-full bg-edge-mid">
            <span
                data-memory-meter
                className="block h-1 bg-success"
                style={{ width: `${pct}%`, transition: widthTween(reduce) }}
            />
        </span>
    );
}

export function MemoryHeader() {
    const projects = useAtomValue(memoryProjectsAtom);
    if (projects == null) {
        return null;
    }
    const s = toolbarStatus(projects);
    return (
        <div data-memory-status className={cn("flex items-center gap-2 text-[12px]", TONE_TEXT[s.tone])}>
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
            {railOrder(projects).map((p) => {
                const row = railRow(p);
                const on = row.name === selected;
                const pick = () => selectMemoryProject(row.name);
                if (row.empty) {
                    return (
                        <button
                            key={row.name}
                            type="button"
                            data-memory-project={row.name}
                            data-memory-empty
                            aria-pressed={on}
                            onClick={pick}
                            className={cn(
                                "flex w-full cursor-pointer items-center gap-2 rounded border-0 px-2.5 py-1.5 text-left",
                                on
                                    ? "bg-surface-selected ring-1 ring-edge-strong ring-inset"
                                    : "bg-transparent hover:bg-surface-hover"
                            )}
                        >
                            <span className="min-w-0 flex-1 truncate text-[12.5px] text-ink-mid">{row.name}</span>
                            <span className="flex-none text-[11px] text-muted">No memory yet</span>
                        </button>
                    );
                }
                return (
                    <button
                        key={row.name}
                        type="button"
                        data-memory-project={row.name}
                        aria-pressed={on}
                        onClick={pick}
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
                        {row.meter ? (
                            <span className="tabular-nums text-[10.5px] text-ink-mid">{row.meter}</span>
                        ) : null}
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
                <span className="tabular-nums text-secondary">{value}</span>
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

// first click arms, second applies: a split group runs to dozens of changes, each undone on its own
function ApplyAll({ p, group }: { p: MemHygieneProject; group: ChangeGroup }) {
    const busy = useAtomValue(memoryBusyAtom);
    const bulk = useAtomValue(memoryBulkAtom);
    const [armed, setArmed] = useState(false);
    const ids = applyAllIds(group);
    const running = bulk?.project === p.project && bulk.group === group.key;
    if (ids.length === 0 && !running) {
        return null;
    }
    if (running) {
        return (
            <span
                role="status"
                data-memory-bulk
                className="ml-auto flex-none whitespace-nowrap text-[11.5px] text-ink-mid"
            >
                Applying {bulk.done + 1} of {bulk.total}…
            </span>
        );
    }
    const apply = () => {
        setArmed(false);
        fireAndForget(() => applyMemoryGroup(p.project, group.key, ids));
    };
    return (
        <span className="ml-auto flex flex-none items-center gap-1.5 whitespace-nowrap">
            {armed ? (
                <button
                    type="button"
                    onClick={() => setArmed(false)}
                    className={cn(BTN_SECONDARY, "h-[26px] px-2.5 text-[12px]")}
                >
                    Cancel
                </button>
            ) : null}
            <button
                type="button"
                data-memory-apply-all={group.key}
                disabled={busy}
                onClick={armed ? apply : () => setArmed(true)}
                className={cn(armed ? BTN_PRIMARY : BTN_SECONDARY, "h-[26px] px-2.5 text-[12px]")}
            >
                {armed ? `Apply ${ids.length} changes` : `Apply all ${ids.length}`}
            </button>
        </span>
    );
}

function ChangeTable({ p, selected }: { p: MemHygieneProject; selected: string | null }) {
    const fade = useFade();
    const groups = changeGroups(p);
    // j and k, and the move to the next change after a verdict, can land on a row scrolled out of view
    useEffect(() => {
        if (selected != null) {
            document
                .querySelector(`[data-memory-change="${CSS.escape(selected)}"]`)
                ?.scrollIntoView({ block: "nearest" });
        }
    }, [selected]);
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
                            <div className="flex items-center gap-2.5 border-b border-edge-faint px-3 pb-1.5 pt-3">
                                <span className={cn(SECTION_HEAD, "flex-none")}>{g.label}</span>
                                <span className="min-w-0 truncate text-[11.5px] text-muted">{g.hint}</span>
                                {/* keyed by project: an armed button must not carry over to the next project's group */}
                                <ApplyAll key={p.project} p={p} group={g} />
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
                                        <KindChip p={p} change={c} />
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
                                        <PathTail path={fileLabel(c)} />
                                    </span>
                                    <span role="cell" className="tabular-nums text-[11px] text-ink-mid">
                                        {c.effect}
                                    </span>
                                    <motion.span
                                        key={status.text}
                                        {...fade(microFade)}
                                        role="cell"
                                        className={cn(
                                            "flex items-center gap-1.5 text-[11.5px]",
                                            TONE_TEXT[status.tone]
                                        )}
                                    >
                                        <Dot tone={status.tone} />
                                        {status.text}
                                    </motion.span>
                                </div>
                            );
                        })}
                    </div>
                ))}
            </div>
        </div>
    );
}

// the pane right of the rail: the project's header line and index meter, then the card view's card or the
// table, whichever view the project is in. the card view's queue strip sits left of it (MemoryTab).
function ProjectPane({
    model,
    p,
    view,
    selected,
}: {
    model: AgentsViewModel;
    p: MemHygieneProject;
    view: MemoryView;
    selected: string | null;
}) {
    const fade = useFade();
    const result = useAtomValue(memoryCheckResultAtom);
    const cards = indexCards(p);
    const split = splitText(p);
    const judged = judgedByText(p);
    const shown = view === "cards" ? shownCard(p, selected) : null;
    return (
        // keyed by project: switching it fades the whole pane in rather than cutting to the next one's
        <motion.main
            key={p.project}
            data-memory-pane
            data-memory-view={view}
            {...fade(viewFade)}
            className="flex min-w-0 flex-1 flex-col gap-3.5 px-5 pb-[18px] pt-4"
        >
            <div className="flex items-center gap-3.5">
                <div className="flex min-w-0 flex-col gap-[3px]">
                    <div className="text-[15px] font-semibold text-primary">{p.project}</div>
                    <div className="text-[12px] text-muted">
                        {checkLine(p, Date.now())}
                        {judged ? (
                            <>
                                {" · "}
                                <span data-memory-judged-by>{judged}</span>
                            </>
                        ) : null}
                    </div>
                </div>
                <span className="flex-1" />
                <AnimatePresence>
                    {result?.project === p.project ? (
                        <motion.span
                            key="result"
                            {...fade(microFade, true)}
                            role="status"
                            data-memory-check-result
                            className={cn("flex items-center gap-1.5 text-[12px]", TONE_TEXT[result.tone])}
                        >
                            <Dot tone={result.tone} />
                            {result.text}
                        </motion.span>
                    ) : null}
                </AnimatePresence>
                <CheckButton p={p} label="Check now" marked />
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
            {view === "cards" ? (
                // the card scrolls, never truncated; the header line stays put above it
                <div data-memory-card-scroll className="-mx-1 min-h-0 flex-1 overflow-y-auto px-1">
                    {shown != null ? <MemoryCard model={model} p={p} change={shown} /> : <MemoryDoneCard p={p} />}
                </div>
            ) : (
                <>
                    <div className="-mb-2 flex flex-none justify-end">
                        <button
                            type="button"
                            data-memory-view-toggle="cards"
                            onClick={() => setMemoryView(p.project, "cards")}
                            className="cursor-pointer border-0 bg-transparent p-0 text-[12px] text-accent hover:text-accenthover"
                        >
                            Review one at a time
                        </button>
                    </div>
                    <ChangeTable p={p} selected={selected} />
                </>
            )}
        </motion.main>
    );
}

// ---- detail rail ----

function Verdict({ p, change }: { p: MemHygieneProject; change: MemChange }) {
    const busy = useAtomValue(memoryBusyAtom);
    const decide = (verdict: MemVerdict) => fireAndForget(() => decideMemory(p.project, change.id, verdict));
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
    return (
        <div className="flex flex-col items-end gap-2">
            {/* left, clear of the avatar over the rail's bottom-right corner */}
            <span aria-hidden data-memory-keys className="flex items-center gap-1.5 self-start text-[11px] text-muted">
                <KeyCap chord="a" variant="inline" />
                apply
                <KeyCap chord="x" variant="inline" />
                keep
                <KeyCap chord="j" variant="inline" />
                <KeyCap chord="k" variant="inline" />
                move
            </span>
            <div className="flex gap-2">
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
                    disabled={busy || !canApply(p, change)}
                    onClick={() => decide("apply")}
                    className={BTN_PRIMARY}
                >
                    {change.applylabel || kindLabel(p, change)}
                </button>
            </div>
        </div>
    );
}

function ChangeDetail({ p, change }: { p: MemHygieneProject; change: MemChange }) {
    const fade = useFade();
    // up by the title with the conflict alert, not above the buttons: the avatar's bottom-right corner
    // sits over the rail's foot
    const gate = switchGate(p, change);
    return (
        // keyed by change: picking another fades its detail in
        <motion.aside
            key={change.id}
            {...fade(viewFade)}
            aria-label="Change detail"
            data-memory-detail
            className={cn(
                "flex flex-none flex-col gap-3.5 overflow-y-auto border-l border-border bg-surface p-4",
                DETAIL_RAIL_WIDTH
            )}
        >
            <div className="flex flex-col gap-1.5">
                <span>
                    <KindChip p={p} change={change} />
                </span>
                <div className="text-[14px] font-semibold text-primary">{change.title}</div>
                <div className="break-all text-[10.5px] text-muted">{fileLabel(change)}</div>
            </div>
            {change.status === "conflict" ? <ConflictAlert p={p} change={change} /> : null}
            {isPending(change) && gate.blocked ? (
                <p role="status" data-memory-gate className="m-0 text-[12px] leading-[1.5] text-warning-soft">
                    {gate.text}
                </p>
            ) : null}
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
        </motion.aside>
    );
}

// ---- tab ----

export function MemoryTab({ model }: { model: AgentsViewModel }) {
    const projects = useAtomValue(memoryProjectsAtom);
    const selectedName = useAtomValue(memorySelectedProjectAtom);
    const selectedChange = useAtomValue(memorySelectedChangeAtom);
    const error = useAtomValue(memoryErrorAtom);
    const views = useAtomValue(memoryViewAtom);
    // re-read on every visit; the feed the nav rail started re-reads on every state write. a failure from an
    // earlier visit must not leave its banner over fresh data.
    useEffect(() => {
        globalStore.set(memoryErrorAtom, null);
        ensureMemoryFeed();
        fireAndForget(loadMemory);
    }, []);
    const bindings = useMemo(() => buildMemoryBindings(), []);
    useKeybindings(bindings);
    const { project: p, change } = resolveSelection(projects, selectedName, selectedChange);
    const view = p != null ? memoryViewOf(p, views) : "table";
    const shown = p != null && view === "cards" ? shownCard(p, selectedChange) : null;
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
                        {p != null && view === "cards" ? (
                            <>
                                <MemoryQueue p={p} shown={shown?.id ?? null} />
                                <ProjectPane model={model} p={p} view={view} selected={selectedChange} />
                            </>
                        ) : null}
                        {p != null && view === "table" ? (
                            <ProjectPane model={model} p={p} view={view} selected={change?.id ?? null} />
                        ) : null}
                        {p != null && view === "table" && change != null ? (
                            <ChangeDetail p={p} change={change} />
                        ) : null}
                    </>
                )}
            </div>
        </div>
    );
}
