// frontend/app/view/agents/committab.tsx
// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

// The panel's Commit tab: the worktree's changes with a tick on each, over a message box and the Commit button. A view
// over commitstore.ts (the state and the write) and commitselection.ts (the rules). Clicking a row, or stepping with
// ↑/↓, opens that file's diff against HEAD at once; Space ticks the row; Ctrl+Enter in the box commits.

import { globalStore } from "@/app/store/jotaiStore";
import { cn } from "@/util/util";
import { useAtomValue } from "jotai";
import { Check, ChevronDown, ChevronRight, CircleAlert, Folder, RefreshCw, X } from "lucide-react";
import { useEffect, useLayoutEffect, useRef, useState, type KeyboardEvent, type MouseEvent } from "react";
import type { AgentVM } from "./agentsviewmodel";
import { TreeModeToggle } from "./changedfilelist";
import {
    amendAllowed,
    canCommit,
    commitLabel,
    committable,
    groupTickState,
    isTicked,
    NO_TICKS,
    tickedCount,
    type CommitTicks,
    type TickState,
} from "./commitselection";
import {
    commitAmendAtom,
    commitDraftAtom,
    commitListAtom,
    commitNow,
    commitRows,
    commitRunAtom,
    commitRunOf,
    commitSelectedAtom,
    commitShownPaths,
    commitTicksAtom,
    dismissCommitFailure,
    loadCommitList,
    selectCommitTabFile,
    setAllTicked,
    setAmend,
    setDraft,
    splitChanges,
    startCommitPoll,
    toggleSelectedTick,
    toggleTick,
    unversionedOpenAtom,
    workingAgents,
    type CommitRow,
} from "./commitstore";
import { panelTabAtom } from "./difflayout";
import { stepFile } from "./filestep";
import { collapsedDirsAtom, treeModeAtom } from "./filetree";
import { CHANGE_NOTE_TITLE, statusColor, type GitChange } from "./gitstatus";
import { agentCwdsAtom } from "./worktreesidebarstore";

const BASE_INDENT_PX = 22; // under the group header's checkbox
const STEP_INDENT_PX = 22;
const AMEND_TITLE = "Rewrite the last commit (not pushed yet)";
const AMEND_LOCKED_TITLE = "Already pushed: amending would need a force push";
const MIN_BOX_PX = 72; // three lines
const MAX_BOX_PX = 198; // ten lines

// A checkbox is a button so a disabled one carries its title and every one can be clicked or read by role. It takes no
// focus from a click (the list keeps it, so Space and the arrows go on working) and none from Tab.
function TickBox({
    state,
    label,
    disabled = false,
    title,
    onToggle,
    attrs,
}: {
    state: TickState;
    label: string;
    disabled?: boolean;
    title?: string;
    onToggle: () => void;
    attrs: Record<string, string>;
}) {
    return (
        <button
            {...attrs}
            type="button"
            role="checkbox"
            aria-checked={state === "some" ? "mixed" : state === "all"}
            aria-label={label}
            disabled={disabled}
            title={title}
            tabIndex={-1}
            onMouseDown={(e: MouseEvent) => e.preventDefault()}
            onClick={(e) => {
                e.stopPropagation();
                onToggle();
            }}
            className={cn(
                "flex h-[14px] w-[14px] flex-none items-center justify-center rounded-[4px] border",
                state === "none" ? "border-edge-strong" : "border-ink-mid bg-ink-mid",
                disabled ? "cursor-default opacity-40" : "cursor-pointer"
            )}
        >
            {state === "all" ? <Check size={10} strokeWidth={4} className="text-background" /> : null}
            {state === "some" ? <span className="h-[2px] w-[7px] rounded-[1px] bg-background" /> : null}
        </button>
    );
}

function CountsOrNote({ change }: { change: GitChange }) {
    if (change.note) {
        return (
            <span title={CHANGE_NOTE_TITLE[change.note]} className="flex-none text-[10.5px] text-muted">
                {change.note}
            </span>
        );
    }
    return (
        <>
            <span className="flex-none text-[10.5px] font-semibold tabular-nums text-diff-added">+{change.adds}</span>
            {change.status === "?" ? null : (
                <span className="flex-none text-[10.5px] font-semibold tabular-nums text-diff-removed">
                    −{change.dels}
                </span>
            )}
        </>
    );
}

function FileRow({
    row,
    ticks,
    selected,
    onSelect,
    onTick,
}: {
    row: CommitRow;
    ticks: CommitTicks;
    selected: boolean;
    onSelect: () => void;
    onTick: (on: boolean) => void;
}) {
    const change = row.change!;
    const ok = committable(change);
    const on = isTicked(ticks, change);
    return (
        <div
            data-commit-row={change.path}
            data-selected={selected || undefined}
            onClick={onSelect}
            style={{ paddingLeft: BASE_INDENT_PX + row.depth * STEP_INDENT_PX }}
            title={change.path}
            className={cn(
                "flex h-[26px] cursor-pointer items-center gap-[8px] rounded-[7px] pr-[8px] transition-colors duration-[140ms] hover:bg-surface-hover",
                selected && "bg-surface-selected"
            )}
        >
            <TickBox
                state={on ? "all" : "none"}
                label={`Commit ${change.path}`}
                disabled={!ok}
                title={change.note && !ok ? CHANGE_NOTE_TITLE[change.note] : undefined}
                onToggle={() => onTick(!on)}
                attrs={{ "data-commit-tick": change.path }}
            />
            <span
                className={cn(
                    "w-[12px] flex-none text-center text-[10.5px] font-bold",
                    change.status === "?" ? "text-muted" : statusColor(change.status),
                    !ok && "opacity-60"
                )}
            >
                {change.status}
            </span>
            <span className="flex min-w-0 flex-1 text-[11.5px]">
                {row.dir ? <span className="min-w-0 truncate text-muted">{row.dir}</span> : null}
                <span
                    className={cn(
                        "truncate",
                        row.dir ? "flex-none" : "min-w-0 flex-1",
                        !ok ? "text-muted" : selected ? "text-ink-hi" : "text-secondary"
                    )}
                >
                    {row.label}
                </span>
            </span>
            <CountsOrNote change={change} />
        </div>
    );
}

function DirRow({
    row,
    ticks,
    collapsed,
    onToggleFold,
    onTick,
}: {
    row: CommitRow;
    ticks: CommitTicks;
    collapsed: boolean;
    onToggleFold: () => void;
    onTick: (on: boolean) => void;
}) {
    const under = row.under ?? [];
    const state = groupTickState(ticks, under);
    return (
        <div
            data-commit-dir={row.id}
            onClick={onToggleFold}
            style={{ paddingLeft: BASE_INDENT_PX + row.depth * STEP_INDENT_PX }}
            title={row.id}
            className="flex h-[24px] cursor-pointer items-center gap-[8px] rounded-[7px] pr-[8px] hover:bg-surface-hover"
        >
            <TickBox
                state={state}
                label={`Commit every file in ${row.id}`}
                disabled={!under.some(committable)}
                onToggle={() => onTick(state !== "all")}
                attrs={{ "data-commit-dir-tick": row.id }}
            />
            {collapsed ? (
                <ChevronRight size={13} className="flex-none text-muted" />
            ) : (
                <Folder size={13} className="flex-none text-muted" />
            )}
            <span className="min-w-0 flex-1 truncate text-[11.5px] font-semibold text-ink-mid">{row.label}</span>
            <span className="flex-none text-[10.5px] tabular-nums text-muted">{under.length}</span>
        </div>
    );
}

// One group's rows. `selected` is the path whose diff is open; clicking a row opens it, ticking never does.
function GroupRows({
    cwd,
    files,
    tree,
    collapsed,
    ticks,
    selected,
    onSelect,
}: {
    cwd: string;
    files: GitChange[];
    tree: boolean;
    collapsed: Set<string>;
    ticks: CommitTicks;
    selected: string | null;
    onSelect: (path: string) => void;
}) {
    return (
        <>
            {commitRows(files, tree, collapsed).map((r) =>
                r.kind === "dir" ? (
                    <DirRow
                        key={`dir:${r.id}`}
                        row={r}
                        ticks={ticks}
                        collapsed={collapsed.has(r.id)}
                        // a new Set every time: jotai compares by reference
                        onToggleFold={() => {
                            const next = new Set(collapsed);
                            if (!next.delete(r.id)) {
                                next.add(r.id);
                            }
                            globalStore.set(collapsedDirsAtom, next);
                        }}
                        onTick={(on) => setAllTicked(cwd, r.under ?? [], on)}
                    />
                ) : (
                    <FileRow
                        key={r.id}
                        row={r}
                        ticks={ticks}
                        selected={r.id === selected}
                        onSelect={() => onSelect(r.id)}
                        onTick={(on) => toggleTick(cwd, r.change!, on)}
                    />
                )
            )}
        </>
    );
}

function ListSkeleton() {
    return (
        <div className="flex flex-1 flex-col gap-[7px] px-[14px] py-[12px]">
            {[0, 1, 2, 3].map((i) => (
                <div key={i} className="h-[12px] animate-pulse rounded-[6px] bg-surface-raised" />
            ))}
        </div>
    );
}

function NothingToCommit() {
    return (
        <div data-commit-empty className="flex flex-1 flex-col items-center justify-center gap-[8px] px-[16px]">
            <div className="text-[12.5px] font-semibold text-ink-hi">No uncommitted changes</div>
            <div className="text-[11.5px] text-ink-mid">The working tree matches HEAD.</div>
            <button
                onClick={() => globalStore.set(panelTabAtom, "log")}
                className="text-[11.5px] text-accent hover:text-accenthover"
            >
                Open the Log (Shift+H)
            </button>
        </div>
    );
}

function CommitFailure({ failure, onDismiss }: { failure: GitFailure; onDismiss: () => void }) {
    const hook = /hook/i.test(failure.stderr);
    return (
        <div
            data-commit-failure
            className="flex flex-col gap-[5px] rounded-[8px] border border-edge-mid bg-surface-raised px-[10px] py-[8px]"
        >
            <div className="flex items-center gap-[6px] text-[11.5px] font-semibold text-error">
                <CircleAlert size={12} className="flex-none" />
                <span className="min-w-0 flex-1">
                    {hook ? "A hook stopped the commit" : "The commit did not go through"}
                </span>
                <button
                    onClick={onDismiss}
                    aria-label="Dismiss"
                    className="flex flex-none text-muted hover:text-ink-hi"
                >
                    <X size={12} />
                </button>
            </div>
            <div className="select-text break-words font-mono text-[10.5px] text-muted">
                {failure.command}
                {failure.exitcode >= 0 ? ` · exit ${failure.exitcode}` : ""}
            </div>
            {failure.stderr ? (
                <pre className="max-h-[120px] select-text overflow-auto whitespace-pre-wrap break-words font-mono text-[10.5px] leading-[1.5] text-secondary">
                    {failure.stderr.trim()}
                </pre>
            ) : null}
            <div className="text-[11px] text-ink-mid">Your message and ticks are kept. Fix it, then commit again.</div>
        </div>
    );
}

export function CommitTab({
    cwd,
    agents,
    onRevealFile,
}: {
    cwd: string | undefined;
    agents: AgentVM[];
    onRevealFile: (path: string) => void;
}) {
    const lists = useAtomValue(commitListAtom);
    const allTicks = useAtomValue(commitTicksAtom);
    const drafts = useAtomValue(commitDraftAtom);
    const amends = useAtomValue(commitAmendAtom);
    const selecteds = useAtomValue(commitSelectedAtom);
    const runs = useAtomValue(commitRunAtom);
    const unvOpen = useAtomValue(unversionedOpenAtom);
    const tree = useAtomValue(treeModeAtom);
    const collapsed = useAtomValue(collapsedDirsAtom);
    const agentCwds = useAtomValue(agentCwdsAtom);
    const listRef = useRef<HTMLDivElement>(null);
    const boxRef = useRef<HTMLTextAreaElement>(null);
    const [refreshing, setRefreshing] = useState(false);

    // read now and on the change poll's cadence while the tab is on screen
    useEffect(() => (cwd ? startCommitPoll(cwd) : undefined), [cwd]);

    const entry = cwd ? lists[cwd] : undefined;
    const files = entry?.changes.files ?? [];
    const ticks = (cwd && allTicks[cwd]) || NO_TICKS;
    const draft = (cwd && drafts[cwd]) || "";
    const amend = (cwd && amends[cwd]) === true;
    const selected = (cwd && selecteds[cwd]) || null;
    const run = commitRunOf(runs, cwd);
    const groups = splitChanges(files);
    const n = tickedCount(ticks, files);
    const ready = canCommit(draft, n) && !run.running;
    const amendOk = entry != null && amendAllowed(entry);
    const working = cwd ? workingAgents(cwd, agents, agentCwds) : [];

    // The selected row stays in view as ↑/↓ walk the list; found by attribute value, since a path may hold any character.
    useEffect(() => {
        if (selected == null) {
            return;
        }
        for (const el of listRef.current?.querySelectorAll<HTMLElement>("[data-commit-row]") ?? []) {
            if (el.dataset.commitRow === selected) {
                el.scrollIntoView({ block: "nearest" });
                return;
            }
        }
    }, [selected, entry, tree]);

    // the box is drawn once the list has files; it grows from three lines to ten with what is typed
    const boxShown = entry != null && files.length > 0;
    useLayoutEffect(() => {
        const el = boxRef.current;
        if (el == null) {
            return;
        }
        el.style.height = "auto";
        el.style.height = `${Math.min(MAX_BOX_PX, Math.max(MIN_BOX_PX, el.scrollHeight + 2))}px`;
    }, [draft, cwd, boxShown]);

    if (cwd == null || entry == null) {
        return <ListSkeleton />;
    }
    if (files.length === 0) {
        return <NothingToCommit />;
    }

    const open = (path: string) => {
        selectCommitTabFile(cwd, path);
        onRevealFile(path);
    };

    // Only a bare arrow or Space, and only on the list itself: a modified key belongs to a binding elsewhere, and the
    // buttons inside take no focus. The cockpit's own ↑/↓ list cursor stands down while focus is in this list (bindings.ts
    // list:next / list:prev).
    const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
        if (e.target !== e.currentTarget || e.shiftKey || e.altKey || e.ctrlKey || e.metaKey) {
            return;
        }
        if (e.key === "ArrowDown" || e.key === "ArrowUp") {
            e.preventDefault();
            const next = stepFile(
                commitShownPaths(files, tree, collapsed, unvOpen),
                selected,
                e.key === "ArrowDown" ? 1 : -1
            );
            if (next != null && next !== selected) {
                open(next);
            }
        } else if (e.key === " ") {
            e.preventDefault();
            toggleSelectedTick(cwd);
        }
    };

    const allState = groupTickState(ticks, files);
    const refresh = () => {
        setRefreshing(true);
        void loadCommitList(cwd).finally(() => setRefreshing(false));
    };

    return (
        <div className="flex min-h-0 flex-1 flex-col">
            <div className="flex min-h-0 flex-1 flex-col px-[6px] pt-[6px]">
                <div className="flex h-[26px] flex-none items-center gap-[8px] px-[6px]">
                    <TickBox
                        state={allState}
                        label="Commit every changed file"
                        disabled={!files.some(committable)}
                        onToggle={() => setAllTicked(cwd, files, allState !== "all")}
                        attrs={{ "data-commit-tick-all": "" }}
                    />
                    <span className="text-[11.5px] font-semibold text-ink-hi">Changes</span>
                    <span className="text-[10.5px] tabular-nums text-muted">{groups.tracked.length}</span>
                    <span className="flex-1" />
                    <TreeModeToggle />
                    <button
                        data-commit-refresh
                        onClick={refresh}
                        aria-label="Refresh"
                        title="Read the working tree again (r)"
                        className="flex h-[22px] w-[22px] flex-none items-center justify-center rounded-[6px] text-ink-mid hover:bg-surface-hover hover:text-ink-hi"
                    >
                        <RefreshCw size={13} className={cn(refreshing && "animate-spin")} />
                    </button>
                </div>
                <div
                    ref={listRef}
                    data-commit-list
                    tabIndex={0}
                    onKeyDown={onKeyDown}
                    aria-label="Changed files"
                    className="min-h-0 flex-1 overflow-y-auto rounded-[7px] pb-[8px] outline-none focus-visible:ring-1 focus-visible:ring-edge-strong"
                >
                    <GroupRows
                        cwd={cwd}
                        files={groups.tracked}
                        tree={tree}
                        collapsed={collapsed}
                        ticks={ticks}
                        selected={selected}
                        onSelect={open}
                    />
                    <button
                        data-commit-unversioned
                        type="button"
                        aria-expanded={unvOpen}
                        tabIndex={-1}
                        onMouseDown={(e) => e.preventDefault()}
                        onClick={() => globalStore.set(unversionedOpenAtom, !unvOpen)}
                        className="mt-[6px] flex h-[26px] w-full cursor-pointer items-center gap-[6px] px-[6px] text-left"
                    >
                        {unvOpen ? (
                            <ChevronDown size={12} className="flex-none text-muted" />
                        ) : (
                            <ChevronRight size={12} className="flex-none text-muted" />
                        )}
                        <span className="text-[11.5px] font-semibold text-ink-mid">Unversioned files</span>
                        <span className="text-[10.5px] tabular-nums text-muted">{groups.unversioned.length}</span>
                    </button>
                    {unvOpen ? (
                        <GroupRows
                            cwd={cwd}
                            files={groups.unversioned}
                            tree={tree}
                            collapsed={collapsed}
                            ticks={ticks}
                            selected={selected}
                            onSelect={open}
                        />
                    ) : null}
                </div>
            </div>

            <div
                data-commit-box
                className="flex flex-none flex-col gap-[8px] border-t border-border bg-surface p-[10px]"
            >
                <textarea
                    ref={boxRef}
                    data-commit-message
                    aria-label="Commit message"
                    placeholder="Commit message"
                    value={draft}
                    rows={3}
                    onChange={(e) => setDraft(cwd, e.target.value)}
                    onKeyDown={(e) => {
                        if ((e.ctrlKey || e.metaKey) && e.key === "Enter") {
                            e.preventDefault();
                            void commitNow(cwd);
                        }
                    }}
                    className="resize-none rounded-[8px] border border-edge-mid bg-surface-raised px-[10px] py-[8px] text-[12px] leading-[18px] text-ink-hi outline-none placeholder:text-muted focus:border-edge-strong"
                />
                <div className="flex items-center gap-[8px]">
                    <div
                        title={amendOk ? AMEND_TITLE : AMEND_LOCKED_TITLE}
                        className={cn(
                            "flex items-center gap-[7px] text-[11.5px]",
                            amendOk ? "text-ink-mid" : "text-ink-faint"
                        )}
                    >
                        <TickBox
                            state={amend ? "all" : "none"}
                            label="Amend the last commit"
                            disabled={!amendOk}
                            title={amendOk ? AMEND_TITLE : AMEND_LOCKED_TITLE}
                            onToggle={() => void setAmend(cwd, !amend)}
                            attrs={{ "data-commit-amend": "" }}
                        />
                        <span
                            className={amendOk ? "cursor-pointer" : "cursor-default"}
                            onClick={() => {
                                if (amendOk) {
                                    void setAmend(cwd, !amend);
                                }
                            }}
                        >
                            Amend
                        </span>
                    </div>
                    <div className="flex-1" />
                    {working.length > 0 ? (
                        <span data-commit-agents-note title={working.join(", ")} className="text-[10.5px] text-muted">
                            {working.length} {working.length === 1 ? "agent" : "agents"} running here
                        </span>
                    ) : null}
                </div>
                <button
                    data-commit-button
                    disabled={!ready}
                    onClick={() => void commitNow(cwd)}
                    title="Commit the ticked files (Ctrl+Enter)"
                    className={cn(
                        "flex h-[32px] items-center justify-center gap-[10px] rounded-[8px] text-[12px] font-semibold",
                        ready
                            ? "bg-accent text-background hover:bg-accenthover"
                            : "cursor-default border border-edge-mid bg-surface-raised text-ink-faint"
                    )}
                >
                    {run.running ? <RefreshCw size={13} className="animate-spin" /> : null}
                    <span>{commitLabel(n, amend)}</span>
                    <span className="font-mono text-[10px] opacity-70">Ctrl+Enter</span>
                </button>
                {run.failure ? (
                    <CommitFailure failure={run.failure} onDismiss={() => dismissCommitFailure(cwd)} />
                ) : null}
            </div>
        </div>
    );
}
