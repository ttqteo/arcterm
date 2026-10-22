// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0
//
// A project's Overview, the Agent surface's `project` centre mode (agentcenter.ts): what in the project waits on you,
// what runs in it, and the buttons that start work there. The rows are projectoverviewmodel.ts's; the Needs you items
// beyond an agent's ask are the Cockpit strip's own (needsyou.ts), scoped to this project.

import { RpcApi } from "@/app/store/wshclientapi";
import { TabRpcClient } from "@/app/store/wshrpcutil";
import { useAtomValue } from "jotai";
import { GitBranch, Plus } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { overviewProjectAtom, showCouncilSetup } from "./agentcenter";
import type { AgentsViewModel } from "./agents";
import { formatAge, type AgentVM } from "./agentsviewmodel";
import { quickTerminal, selectAgentRow } from "./agenttree";
import { diffStatsFromChanges } from "./cardgitstore";
import { parseGitChanges } from "./gitstatus";
import type { LauncherKind } from "./launcher";
import { openLauncher } from "./launcherstore";
import { useNeedsYou } from "./needsyou";
import { NeedsYouRows } from "./needsyoustrip";
import { askLine, changesLabel, doingLine, isQuiet, overviewRows } from "./projectoverviewmodel";
import { projectsAtom } from "./projectsstore";
import { StatusDot } from "./statusdot";

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
const PANEL = "overflow-hidden rounded-[8px] border border-edge-mid bg-surface-raised";
const ROW = "flex w-full items-center gap-[10px] border-t border-edge-mid px-3 py-[9px] text-left first:border-t-0";

function SectionHead({ label, count }: { label: string; count: number }) {
    return (
        <h2 className="text-[12px] font-semibold text-secondary">
            {label} <span className="font-normal tabular-nums text-muted">{count}</span>
        </h2>
    );
}

export function ProjectOverview({ model }: { model: AgentsViewModel }) {
    const project = useAtomValue(overviewProjectAtom);
    const registry = useAtomValue(projectsAtom);
    const path = registry?.[project]?.path;
    const agents = useAtomValue(model.agentsAtom);
    const terminals = useAtomValue(model.terminalsAtom);
    const now = useAtomValue(model.nowAtom);
    const git = useProjectGit(path);
    const rows = useMemo(() => overviewRows(agents, terminals, project), [agents, terminals, project]);
    const ny = useNeedsYou(model, (id) => selectAgentRow(model, id), project);
    if (project === "") {
        return null;
    }
    const launch = (door: LauncherKind) => openLauncher(model, door, undefined, project);
    const since = (a: AgentVM) => (a.stateSince != null ? formatAge(Math.max(0, now - a.stateSince)) : "");
    const waiting = rows.asking.length + ny.rows.length;
    const running = rows.working.length + rows.terminals.length;

    return (
        <div data-project-overview={project} className="min-h-0 flex-1 overflow-y-auto px-8 py-6">
            <div className="mx-auto flex max-w-[760px] flex-col gap-[22px]">
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
                        <button
                            type="button"
                            data-overview-action="run"
                            onClick={() => launch("run")}
                            className={SECONDARY_BTN}
                        >
                            Run
                        </button>
                        {path ? (
                            <button
                                type="button"
                                data-overview-action="council"
                                onClick={() => showCouncilSetup(path)}
                                className={SECONDARY_BTN}
                            >
                                Council
                            </button>
                        ) : null}
                    </div>
                </header>

                {isQuiet(rows, ny.rows.length) ? (
                    <p data-overview-quiet className="rounded-[8px] bg-surface p-3 text-[13px] text-muted">
                        Nothing needs you and nothing is running in {project}.
                    </p>
                ) : null}

                {waiting > 0 ? (
                    <section data-overview-needs aria-label="Needs you" className="flex flex-col gap-2">
                        <SectionHead label="Needs you" count={waiting} />
                        <div className={PANEL}>
                            {rows.asking.map((a) => (
                                <div key={a.id} data-overview-asking={a.id} className={ROW}>
                                    <StatusDot state="asking" pulse />
                                    <div className="flex min-w-0 flex-1 flex-col gap-[2px]">
                                        <span className="truncate text-[13px] text-primary">{a.name}</span>
                                        <span className="truncate text-[12px] text-muted">
                                            <span className="text-asking">asking</span> {askLine(a)}
                                        </span>
                                    </div>
                                    <span className="text-[11px] tabular-nums text-ink-faint">{since(a)}</span>
                                    <button
                                        type="button"
                                        data-overview-answer={a.id}
                                        onClick={() => selectAgentRow(model, a.id)}
                                        className="h-[26px] cursor-pointer rounded-[6px] border border-edge-mid bg-surface px-[10px] text-[12px] text-secondary hover:border-edge-strong"
                                    >
                                        Answer
                                    </button>
                                </div>
                            ))}
                            {ny.rows.length > 0 ? (
                                <div className="px-3">
                                    <NeedsYouRows ny={ny} />
                                </div>
                            ) : null}
                        </div>
                    </section>
                ) : null}

                {running > 0 ? (
                    <section data-overview-running aria-label="Running" className="flex flex-col gap-2">
                        <SectionHead label="Running" count={running} />
                        <div className={PANEL}>
                            {[...rows.working, ...rows.terminals].map((a) => (
                                <button
                                    key={a.id}
                                    type="button"
                                    data-overview-running-row={a.id}
                                    onClick={() => selectAgentRow(model, a.id)}
                                    className={`${ROW} cursor-pointer hover:bg-surface-hover`}
                                >
                                    <StatusDot state="working" pulse />
                                    <span className="w-[160px] flex-none truncate text-[13px] text-primary">
                                        {a.name}
                                    </span>
                                    <span className="min-w-0 flex-1 truncate text-[12px] text-muted">
                                        {doingLine(a)}
                                    </span>
                                    <span className="w-[64px] flex-none text-right text-[11px] tabular-nums text-ink-faint">
                                        {since(a)}
                                    </span>
                                </button>
                            ))}
                        </div>
                    </section>
                ) : null}
            </div>
        </div>
    );
}
