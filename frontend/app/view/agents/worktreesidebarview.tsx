// frontend/app/view/agents/worktreesidebarview.tsx
// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

// The source tree the panel's dropdown opens (sourcepicker.tsx): every registered project with its checkouts, and each
// agent under the checkout it runs in. The one place a source is picked. Rows come from worktreesidebar.ts, the reads
// from worktreesidebarstore.ts; this file only draws them and turns clicks into picks.

import { globalStore } from "@/app/store/jotaiStore";
import { REGION_LABEL } from "@/app/view/jarvis/briefstyle";
import { cn, fireAndForget } from "@/util/util";
import { useAtomValue } from "jotai";
import { ChevronRight, Folder, FolderGit2, GitBranch, Search, TriangleAlert } from "lucide-react";
import { useEffect, useState } from "react";
import type { AgentVM } from "./agentsviewmodel";
import { scopeKey, type DiffScope } from "./diffscope";
import type { FilesProject, FilesState } from "./filesstore";
import { StatusDot } from "./statusdot";
import {
    currentProject,
    NOT_A_REPO_LABEL,
    sidebarRows,
    worktreeRelPath,
    type SidebarInput,
    type SidebarRow,
} from "./worktreesidebar";
import {
    agentCwdsAtom,
    loadProjectWorktrees,
    refreshSidebar,
    resolveAgentCwds,
    sidebarExpandedAtom,
    withLiveCount,
    worktreeErrorsAtom,
    worktreesByProjectAtom,
} from "./worktreesidebarstore";

type WorktreeRow = Extract<SidebarRow, { kind: "worktree" }>;

function expand(project: FilesProject): void {
    globalStore.set(sidebarExpandedAtom, (prev) => new Set(prev).add(project.name));
    fireAndForget(() => loadProjectWorktrees(project));
}

function rowClass(current: boolean): string {
    return cn(
        "flex w-full items-center gap-[8px] text-left hover:bg-surface-hover",
        current ? "bg-surface-selected text-ink-hi" : "text-ink-mid"
    );
}

// a main checkout picks its project (the project origin); a linked one is picked by its branch
function sourceOption(row: WorktreeRow): string {
    return row.wt.ismain ? row.project : row.wt.branch || row.label;
}

function CheckoutIcon({ row, size }: { row: WorktreeRow; size: number }) {
    if (row.label === NOT_A_REPO_LABEL && row.wt.ismain) {
        return <Folder size={size} className="flex-none text-muted" />;
    }
    const Icon = row.wt.ismain ? GitBranch : FolderGit2;
    return <Icon size={size} className="flex-none text-muted" />;
}

function Divergence({ wt }: { wt: GitWorktree }) {
    const ahead = wt.ahead ?? 0;
    const behind = wt.behind ?? 0;
    if (!wt.hasbase || (ahead === 0 && behind === 0)) {
        return null;
    }
    return (
        <span
            data-worktree-divergence
            title={`${ahead} ahead, ${behind} behind the main checkout's branch`}
            className="flex-none text-[10.5px] tabular-nums text-muted"
        >
            {[ahead > 0 ? `↑${ahead}` : "", behind > 0 ? `↓${behind}` : ""].filter(Boolean).join(" ")}
        </span>
    );
}

function CheckoutRow({ row, main, onPick }: { row: WorktreeRow; main?: GitWorktree; onPick: () => void }) {
    const changed = row.wt.changed ?? 0;
    return (
        <button
            data-worktree-row={row.wt.path}
            data-files-source-option={sourceOption(row)}
            title={row.wt.path}
            onClick={onPick}
            className={cn(rowClass(row.current), "flex-col items-stretch gap-[1px] py-[5px] pl-[26px] pr-[10px]")}
        >
            <span className="flex min-w-0 items-center gap-[7px]">
                <CheckoutIcon row={row} size={12} />
                <span className="min-w-0 flex-1 truncate text-[12px]">{row.label}</span>
                {row.wt.error ? (
                    <span data-worktree-error title={row.wt.error} className="flex flex-none text-warning">
                        <TriangleAlert size={12} aria-label="Couldn't read this worktree" />
                    </span>
                ) : null}
                <Divergence wt={row.wt} />
                {changed > 0 ? (
                    <span
                        data-worktree-changed
                        title={`${changed} uncommitted ${changed === 1 ? "file" : "files"}`}
                        className="flex-none rounded-full bg-pill px-[6px] text-[10px] font-semibold tabular-nums text-ink-mid"
                    >
                        {changed}
                    </span>
                ) : null}
            </span>
            {!row.wt.ismain ? (
                // the path from the main checkout, clipped from the left so the worktree's own name stays
                <span dir="rtl" className="min-w-0 truncate pl-[19px] text-left text-[10.5px] text-muted">
                    <bdi dir="ltr">{worktreeRelPath(row.wt, main)}</bdi>
                </span>
            ) : null}
        </button>
    );
}

function AgentRow({
    row,
    indent,
    onPick,
}: {
    row: Extract<SidebarRow, { kind: "agent" }>;
    indent: boolean;
    onPick: () => void;
}) {
    return (
        <button
            data-files-source-option={row.agent.name}
            onClick={onPick}
            className={cn(rowClass(row.current), "h-[26px] pr-[10px]", indent ? "pl-[45px]" : "pl-[26px]")}
        >
            <StatusDot state={row.agent.state as AgentVM["state"]} className="!h-[7px] !w-[7px]" />
            <span className="min-w-0 flex-1 truncate text-[12px]">{row.agent.name}</span>
            <span className="flex-none text-[10.5px] text-muted">{row.agent.state}</span>
        </button>
    );
}

export function SourceTree({
    agents,
    projects,
    scope,
    focusId,
    filesState,
    onPickAgent,
    onPickProject,
    onPickWorktree,
    onPicked,
}: {
    agents: AgentVM[];
    projects: FilesProject[];
    scope: DiffScope | null;
    focusId: string | undefined;
    filesState: FilesState | null;
    onPickAgent: (id: string) => void;
    onPickProject: (p: FilesProject) => void;
    onPickWorktree: (project: string, wt: GitWorktree) => void;
    // called after any pick, so the dropdown that holds the tree closes
    onPicked: () => void;
}) {
    const expanded = useAtomValue(sidebarExpandedAtom);
    const byProject = useAtomValue(worktreesByProjectAtom);
    const errors = useAtomValue(worktreeErrorsAtom);
    const agentCwds = useAtomValue(agentCwdsAtom);
    const [query, setQuery] = useState("");
    const searching = query.trim() !== "";

    // only the loaded lists are defined: undefined is what tells the model a group has not been read
    const worktrees: Record<string, GitWorktree[]> = {};
    for (const [name, list] of Object.entries(byProject)) {
        if (list != null) {
            worktrees[name] = withLiveCount(list, filesState);
        }
    }
    const input: SidebarInput = {
        projects,
        worktrees,
        errors,
        agentCwds,
        agents,
        expanded,
        // with nothing scoped, the focused agent is what the surface shows
        current: {
            origin: scope?.repo.origin ?? (focusId ? { kind: "agent", id: focusId } : undefined),
            cwd: filesState?.cwd,
        },
        query,
    };
    const rows = sidebarRows(input);
    const holder = currentProject(input);

    useEffect(() => {
        fireAndForget(() => refreshSidebar());
    }, []);

    const agentKey = agents.map((a) => `${a.id}|${a.transcriptPath ?? ""}|${a.blockId ?? ""}`).join(",");
    useEffect(() => {
        fireAndForget(() =>
            resolveAgentCwds(agents.map((a) => ({ id: a.id, transcriptPath: a.transcriptPath, blockId: a.blockId })))
        );
    }, [agentKey]);

    // a new source opens its group; the user may still fold it afterwards
    useEffect(() => {
        const p = projects.find((x) => x.name === holder);
        if (p != null && !globalStore.get(sidebarExpandedAtom).has(p.name)) {
            expand(p);
        }
    }, [scope ? scopeKey(scope) : "", holder]);

    // A filter searches branches and worktree paths, which a group never read does not have yet: read those groups
    // once, without counting them as expanded.
    useEffect(() => {
        if (!searching) {
            return;
        }
        const read = globalStore.get(worktreesByProjectAtom);
        for (const p of projects) {
            if (read[p.name] == null) {
                fireAndForget(() => loadProjectWorktrees(p));
            }
        }
    }, [searching]);

    // the user's set, never the query-forced state a row reports while filtering
    const toggleGroup = (p: FilesProject) => {
        if (expanded.has(p.name)) {
            globalStore.set(sidebarExpandedAtom, (prev) => {
                const next = new Set(prev);
                next.delete(p.name);
                return next;
            });
        } else {
            expand(p);
        }
    };
    const pickCheckout = (row: WorktreeRow) => {
        const p = projects.find((x) => x.name === row.project);
        if (row.wt.ismain) {
            if (p != null) {
                onPickProject(p);
                onPicked();
            }
            return;
        }
        onPickWorktree(row.project, row.wt);
        onPicked();
    };
    const mainOf = (project: string) => worktrees[project]?.find((wt) => wt.ismain);
    const otherAt = rows.findIndex((r) => r.kind === "other-agents");

    return (
        <div data-source-tree className="flex w-full flex-col">
            <label className="mb-[4px] flex h-[28px] flex-none items-center gap-[7px] rounded-[7px] border border-edge-strong px-[8px] focus-within:border-accent">
                <Search size={12} className="flex-none text-muted" />
                <input
                    data-worktree-filter
                    // the tree mounts only while the dropdown is open, so this is the "focus the filter on open"
                    autoFocus
                    value={query}
                    onChange={(e) => setQuery(e.target.value)}
                    onKeyDown={(e) => {
                        if (e.key === "Escape") {
                            e.preventDefault();
                            if (query) {
                                setQuery("");
                            } else {
                                e.currentTarget.blur();
                            }
                        }
                    }}
                    placeholder="Filter worktrees and agents"
                    aria-label="Filter worktrees and agents"
                    className="min-w-0 flex-1 bg-transparent text-[11.5px] text-ink-hi outline-none placeholder:text-ink-faint"
                />
            </label>
            <div className="max-h-[60vh] min-h-0 overflow-y-auto">
                {rows.map((r, i) => {
                    switch (r.kind) {
                        case "group": {
                            const p = projects.find((x) => x.name === r.project);
                            return (
                                <div key={`g:${r.project}`} className={cn(i > 0 && "mt-[4px]")}>
                                    <button
                                        data-worktree-group={r.project}
                                        aria-expanded={r.expanded}
                                        title={r.path}
                                        onClick={() => p && toggleGroup(p)}
                                        className="flex h-[28px] w-full items-center gap-[6px] px-[8px] text-left hover:bg-surface-hover"
                                    >
                                        <ChevronRight
                                            size={12}
                                            className={cn("flex-none text-muted", r.expanded && "rotate-90")}
                                        />
                                        <span className="max-w-[140px] flex-none truncate text-[12px] font-semibold text-ink-hi">
                                            {r.project}
                                        </span>
                                        {/* clipped from the left: the folder's own name is the useful end */}
                                        <span dir="rtl" className="min-w-0 truncate text-left text-[10.5px] text-muted">
                                            <bdi dir="ltr">{r.path}</bdi>
                                        </span>
                                    </button>
                                    {r.error ? (
                                        <div
                                            data-worktree-group-error
                                            title={r.error}
                                            className="flex items-center gap-[6px] py-[3px] pl-[26px] pr-[10px] text-[11px] text-error"
                                        >
                                            <TriangleAlert size={12} className="flex-none" />
                                            <span className="min-w-0 truncate">Couldn't read worktrees</span>
                                        </div>
                                    ) : null}
                                </div>
                            );
                        }
                        case "worktree":
                            return (
                                <CheckoutRow
                                    key={`w:${r.project}:${r.wt.path}`}
                                    row={r}
                                    main={mainOf(r.project)}
                                    onPick={() => pickCheckout(r)}
                                />
                            );
                        case "agent":
                            return (
                                <AgentRow
                                    key={`a:${r.agent.id}`}
                                    row={r}
                                    // Other agents trails every group, so an agent before it sits under a checkout
                                    indent={otherAt < 0 || i < otherAt}
                                    onPick={() => {
                                        onPickAgent(r.agent.id);
                                        onPicked();
                                    }}
                                />
                            );
                        case "other-agents":
                            return (
                                <div
                                    key="other"
                                    data-worktree-other-agents
                                    className={cn(REGION_LABEL, "px-[12px] pb-[3px] pt-[10px] text-muted")}
                                >
                                    Other agents
                                </div>
                            );
                    }
                })}
                {rows.length === 0 ? (
                    <div className="px-[12px] py-[7px] text-[11.5px] text-muted">
                        {searching ? "No match" : "No projects"}
                    </div>
                ) : null}
            </div>
        </div>
    );
}
