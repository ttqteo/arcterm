// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0
//
// A project's Overview, the Agent surface's `project` centre mode (agentcenter.ts): the header with the buttons that
// start an agent or a terminal there (a run or a council is started by an agent's session, never on its own) and the
// Activity card (projectactivitycard.tsx: its tokens per day over a year) across the top, then two columns sharing the
// width at 2:3: on the left Now (projectnow.tsx: what waits on you, what runs, what finished unread) with the Branches
// card under it (projectgraphcard.tsx: the newest commits of every branch over the commit graph), on the right History
// (projecthistory.tsx: its sessions of the last 7 days, with the runs and councils each started, loaded a page at a
// time as it scrolls). The page fills the centre pane, with no width cap. It reads the Needs you items (needsyou.ts,
// scoped to this project) and the project's history once and hands them down. Under 1000px wide the columns stack in
// the order Now, Branches, History; with no project path there is no History and the left column takes the row.

import { RpcApi } from "@/app/store/wshclientapi";
import { TabRpcClient } from "@/app/store/wshrpcutil";
import { useAtomValue } from "jotai";
import { GitBranch, Plus } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { overviewProjectAtom } from "./agentcenter";
import type { AgentsViewModel } from "./agents";
import { quickTerminal, selectAgentRow } from "./agenttree";
import { diffStatsFromChanges } from "./cardgitstore";
import { parseGitChanges } from "./gitstatus";
import type { LauncherKind } from "./launcher";
import { openLauncher } from "./launcherstore";
import { useNeedsYou } from "./needsyou";
import { ActivityCard } from "./projectactivitycard";
import { GraphCard } from "./projectgraphcard";
import { HistoryColumn } from "./projecthistory";
import { useProjectHistory } from "./projecthistorystore";
import { NowColumn } from "./projectnow";
import { changesLabel, projectSessions } from "./projectoverviewmodel";
import { projectsAtom } from "./projectsstore";

type ProjectGit = { branch: string; files: number; adds: number; dels: number };

// the branch and the uncommitted change count of the project's checkout, read once per project shown
function useProjectGit(path: string | undefined): ProjectGit | null {
    const [git, setGit] = useState<ProjectGit | null>(null);
    useEffect(() => {
        setGit(null);
        if (!path) {
            return;
        }
        let live = true;
        RpcApi.GitChangesCommand(TabRpcClient, { cwd: path })
            .then((ch) => {
                if (live && ch.isrepo) {
                    setGit({ branch: ch.branch, ...diffStatsFromChanges(parseGitChanges(ch.statusz, ch.numstat)) });
                }
            })
            .catch(() => {});
        return () => {
            live = false;
        };
    }, [path]);
    return git;
}

const PRIMARY_BTN =
    "flex h-[30px] cursor-pointer items-center gap-[6px] rounded-[8px] bg-accent px-3 text-[13px] font-medium text-background hover:bg-accenthover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent";
const SECONDARY_BTN =
    "h-[30px] cursor-pointer rounded-[8px] border border-edge-mid bg-surface-raised px-3 text-[13px] text-muted hover:border-edge-strong hover:bg-surface-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent";
export function ProjectOverview({ model }: { model: AgentsViewModel }) {
    const project = useAtomValue(overviewProjectAtom);
    const registry = useAtomValue(projectsAtom);
    const path = registry?.[project]?.path;
    const git = useProjectGit(path);
    const ny = useNeedsYou(model, (id) => selectAgentRow(model, id), project);
    const history = useProjectHistory(model, path ?? "");
    const now = useAtomValue(model.nowAtom);
    // the footer's session count is the one History lists, without the search; null until its sessions load
    const sessionCount = useMemo(
        () => (history.sessions == null ? null : projectSessions(history.sessions, path ?? "", now, "").length),
        [history.sessions, path, now]
    );
    if (project === "") {
        return null;
    }
    const launch = (door: LauncherKind) => openLauncher(model, door, undefined, project);

    return (
        <div data-project-overview={project} className="@container min-h-0 flex-1 overflow-y-auto px-8 py-6">
            <div className="flex flex-col gap-[22px]">
                <header className="flex flex-col gap-[10px]">
                    <div className="flex flex-wrap items-center gap-3">
                        <h1 className="text-[18px] font-semibold text-primary">{project}</h1>
                        {git != null ? (
                            <span className="flex h-[22px] items-center gap-[5px] rounded-full bg-pill px-2 text-[12px] text-secondary">
                                <GitBranch size={12} aria-hidden className="text-muted" />
                                {git.branch}
                            </span>
                        ) : null}
                        {git != null ? (
                            <span data-overview-changes className="text-[12px] tabular-nums text-muted">
                                {changesLabel(git)}
                                {git.files > 0 ? (
                                    <>
                                        {" · "}
                                        <span className="text-diff-added">+{git.adds}</span>{" "}
                                        <span className="text-diff-removed">−{git.dels}</span>
                                    </>
                                ) : null}
                            </span>
                        ) : null}
                        <span className="flex-1" />
                        {path ? <span className="truncate text-[12px] text-muted">{path}</span> : null}
                    </div>
                    <div className="flex flex-wrap gap-2">
                        <button
                            type="button"
                            data-overview-action="agent"
                            onClick={() => launch("agent")}
                            className={PRIMARY_BTN}
                        >
                            <Plus size={13} aria-hidden />
                            New agent
                        </button>
                        {path ? (
                            <button
                                type="button"
                                data-overview-action="terminal"
                                onClick={() => quickTerminal(model, project, path)}
                                className={SECONDARY_BTN}
                            >
                                Terminal
                            </button>
                        ) : null}
                    </div>
                </header>

                {path ? <ActivityCard path={path} sessions={sessionCount} /> : null}

                <div className="flex flex-col gap-6 @min-[1000px]:flex-row @min-[1000px]:items-start">
                    <div data-overview-left className="flex w-full min-w-0 flex-col gap-[22px] @min-[1000px]:flex-[2]">
                        <NowColumn model={model} project={project} ny={ny} />
                        {path && git != null ? (
                            <GraphCard model={model} project={project} path={path} dirty={git.files} />
                        ) : null}
                    </div>
                    {path ? (
                        <div data-overview-history-col className="w-full min-w-0 @min-[1000px]:flex-[3]">
                            <HistoryColumn model={model} path={path} project={project} history={history} />
                        </div>
                    ) : null}
                </div>
            </div>
        </div>
    );
}
