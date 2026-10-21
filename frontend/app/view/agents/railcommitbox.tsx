// frontend/app/view/agents/railcommitbox.tsx
// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

// The rail's commit mode: the Changes tab's uncommitted files with a tick on each, and under them the message box and the
// Commit button. A view over commitstore.ts (the state and the write, keyed by cwd, shared with the Diff surface's Commit
// tab) and commitselection.ts (the rules). No Space or ↑/↓ here: those stay the terminal's.

import { globalStore } from "@/app/store/jotaiStore";
import { cn } from "@/util/util";
import { useAtomValue } from "jotai";
import { ArrowUpRight, RefreshCw } from "lucide-react";
import { useEffect, useLayoutEffect, useRef } from "react";
import type { AgentVM } from "./agentsviewmodel";
import { CommitFailure, growMessageBox } from "./commitbox";
import {
    canCommit,
    commitLabel,
    committable,
    groupTickState,
    isTicked,
    NO_TICKS,
    tickedCount,
} from "./commitselection";
import {
    commitAmendAtom,
    commitDraftAtom,
    commitListAtom,
    commitNow,
    commitRunAtom,
    commitRunOf,
    commitTicksAtom,
    dismissCommitFailure,
    setAllTicked,
    setDraft,
    startCommitPoll,
    toggleTick,
    workingAgents,
} from "./commitstore";
import { CountsOrNote } from "./committab";
import { CHANGE_NOTE_TITLE, statusColor } from "./gitstatus";
import { TickBox } from "./tickbox";
import { agentCwdsAtom } from "./worktreesidebarstore";

// The uncommitted list (working tree against HEAD, whatever range the tab was on): a header with the tick-all box, then a
// row per file. Clicking a row ticks it, like its box.
export function RailCommitFiles({ cwd }: { cwd: string }) {
    const files = useAtomValue(commitListAtom)[cwd]?.changes.files ?? [];
    const ticks = useAtomValue(commitTicksAtom)[cwd] ?? NO_TICKS;
    const allState = groupTickState(ticks, files);
    return (
        <>
            <div
                data-rail-files-header
                className="flex items-center gap-[8px] py-[5px] text-[12px] font-medium text-secondary"
            >
                <TickBox
                    state={allState}
                    label="Commit every changed file"
                    disabled={!files.some(committable)}
                    onToggle={() => setAllTicked(cwd, files, allState !== "all")}
                    attrs={{ "data-rail-commit-tick-all": "" }}
                />
                <span title="What differs from HEAD: the files a commit can take">Uncommitted</span>
                <span className="text-[11px] tabular-nums text-muted">{files.length}</span>
            </div>
            {files.length === 0 ? (
                <div data-rail-commit-empty className="text-[11.5px] text-muted">
                    Nothing to commit
                </div>
            ) : (
                <div className="flex flex-col gap-[7px]">
                    {files.map((f) => {
                        const ok = committable(f);
                        const on = isTicked(ticks, f);
                        return (
                            <div
                                key={f.path}
                                data-rail-commit-row={f.path}
                                title={f.path}
                                onClick={() => {
                                    if (ok) {
                                        toggleTick(cwd, f, !on);
                                    }
                                }}
                                className={cn(
                                    "flex items-center gap-[8px] rounded-sm px-[5px] py-[3px] text-left text-[11.5px] font-medium text-secondary",
                                    ok && "cursor-pointer hover:bg-surface-hover hover:text-primary"
                                )}
                            >
                                <TickBox
                                    state={on ? "all" : "none"}
                                    label={`Commit ${f.path}`}
                                    disabled={!ok}
                                    title={f.note && !ok ? CHANGE_NOTE_TITLE[f.note] : undefined}
                                    onToggle={() => toggleTick(cwd, f, !on)}
                                    attrs={{ "data-rail-commit-tick": f.path }}
                                />
                                <span
                                    className={cn(
                                        "flex-none font-bold",
                                        f.status === "?" ? "text-muted" : statusColor(f.status),
                                        !ok && "opacity-60"
                                    )}
                                >
                                    {f.status}
                                </span>
                                <span className={cn("min-w-0 flex-1 truncate", !ok && "text-muted")}>{f.path}</span>
                                <CountsOrNote change={f} />
                            </div>
                        );
                    })}
                </div>
            )}
        </>
    );
}

// The Commit tab's box, pinned to the foot of the Changes tab. Cancel and a commit that went through both hand the mode
// back to the rail; a refusal leaves it open with the failure under the button.
export function RailCommitBox({
    cwd,
    agents,
    onDone,
    onCancel,
    onMore,
}: {
    cwd: string;
    agents: AgentVM[];
    onDone: () => void;
    onCancel: () => void;
    onMore: () => void;
}) {
    const draft = useAtomValue(commitDraftAtom)[cwd] ?? "";
    const files = useAtomValue(commitListAtom)[cwd]?.changes.files ?? [];
    const ticks = useAtomValue(commitTicksAtom)[cwd] ?? NO_TICKS;
    const run = commitRunOf(useAtomValue(commitRunAtom), cwd);
    // amend is turned on only in the Diff surface's Commit tab; the label says so when it is
    const amend = useAtomValue(commitAmendAtom)[cwd] === true;
    const agentCwds = useAtomValue(agentCwdsAtom);
    const boxRef = useRef<HTMLTextAreaElement>(null);
    const n = tickedCount(ticks, files);
    const ready = canCommit(draft, n) && !run.running;
    const working = workingAgents(cwd, agents, agentCwds);

    // the list is read every 10 s while the mode is open
    useEffect(() => startCommitPoll(cwd), [cwd]);

    // the box grows from three lines to ten with what is typed
    useLayoutEffect(() => {
        const el = boxRef.current;
        if (el != null) {
            growMessageBox(el);
        }
    }, [draft, cwd]);

    const commit = async () => {
        if (run.running || !canCommit(draft, n)) {
            return;
        }
        await commitNow(cwd);
        // commitNow clears the draft only on success; a refusal leaves it, with the failure under the button
        const after = commitRunOf(globalStore.get(commitRunAtom), cwd);
        if (after.failure == null && (globalStore.get(commitDraftAtom)[cwd] ?? "") === "") {
            onDone();
        }
    };

    return (
        <div
            data-rail-commit-box
            className="flex flex-none flex-col gap-[8px] border-t border-border bg-surface p-[10px]"
        >
            <textarea
                ref={boxRef}
                data-rail-commit-message
                aria-label="Commit message"
                placeholder="Commit message"
                value={draft}
                rows={3}
                onChange={(e) => setDraft(cwd, e.target.value)}
                onKeyDown={(e) => {
                    if ((e.ctrlKey || e.metaKey) && e.key === "Enter") {
                        e.preventDefault();
                        void commit();
                    }
                }}
                className="resize-none rounded-[8px] border border-edge-mid bg-surface-raised px-[10px] py-[8px] text-[12px] leading-[18px] text-ink-hi outline-none placeholder:text-muted focus:border-edge-strong"
            />
            <div className="flex items-center gap-[8px]">
                {working.length > 0 ? (
                    <span data-rail-commit-agents title={working.join(", ")} className="text-[10.5px] text-muted">
                        {working.length} {working.length === 1 ? "agent" : "agents"} running here
                    </span>
                ) : null}
                <span className="flex-1" />
                <button
                    type="button"
                    data-rail-commit-more
                    onClick={onMore}
                    title="Amend, folders and unversioned files"
                    className="inline-flex cursor-pointer items-center gap-[3px] rounded-[7px] px-[6px] py-[3px] text-[10.5px] font-semibold text-accent-soft hover:bg-surface-hover"
                >
                    More in Diff
                    <ArrowUpRight size={11} aria-hidden />
                </button>
            </div>
            <div className="flex items-center gap-[8px]">
                <button
                    type="button"
                    data-rail-commit-cancel
                    onClick={onCancel}
                    className="h-[32px] flex-none cursor-pointer rounded-[8px] border border-edge-mid bg-surface-raised px-[12px] text-[12px] font-semibold text-ink-mid hover:border-edge-strong"
                >
                    Cancel
                </button>
                <button
                    type="button"
                    data-rail-commit-button
                    disabled={!ready}
                    onClick={() => void commit()}
                    title="Commit the ticked files (Ctrl+Enter)"
                    className={cn(
                        "flex h-[32px] min-w-0 flex-1 items-center justify-center gap-[10px] rounded-[8px] text-[12px] font-semibold",
                        ready
                            ? "cursor-pointer bg-accent text-background hover:bg-accenthover"
                            : "cursor-default border border-edge-mid bg-surface-raised text-ink-faint"
                    )}
                >
                    {run.running ? <RefreshCw size={13} className="flex-none animate-spin" /> : null}
                    <span className="truncate">{commitLabel(n, amend)}</span>
                    <span className="flex-none font-mono text-[10px] opacity-70">Ctrl+Enter</span>
                </button>
            </div>
            {run.failure ? <CommitFailure failure={run.failure} onDismiss={() => dismissCommitFailure(cwd)} /> : null}
        </div>
    );
}
