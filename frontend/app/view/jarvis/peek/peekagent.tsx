// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { RpcApi } from "@/app/store/wshclientapi";
import { TabRpcClient } from "@/app/store/wshrpcutil";
import { resolveCwd } from "@/app/view/agents/agentcwdresolve";
import type { AgentsViewModel } from "@/app/view/agents/agents";
import { displayAgeMs, formatAgeShort, type AgentVM } from "@/app/view/agents/agentsviewmodel";
import { ensureSessionStart } from "@/app/view/agents/agentsessionstore";
import { capFiles, parseGitChanges, statusColor, type GitChanges } from "@/app/view/agents/gitstatus";
import { prettyModel } from "@/app/view/agents/modellabel";
import { agentProject } from "@/app/view/agents/runlineage";
import { cn } from "@/util/util";
import { useAtomValue } from "jotai";
import { Terminal } from "lucide-react";
import { useEffect, useState } from "react";
import { reportPeekFacts, type PeekTarget } from "../peekstore";
import { agentGridRows, agentPeekFacts, changedFilesSummary, sessionLabel } from "./peekagentmodel";

const FILES_CAP = 8;

const STATE_DOT: Record<AgentVM["state"], string> = {
    asking: "bg-warning",
    working: "bg-accent",
    idle: "bg-muted",
};

type GitView = { cwd: string | null; branch: string; changes: GitChanges | null };

// loaded here rather than through railstore: that atom belongs to the Agent surface's focused agent
function useAgentGit(agent: AgentVM | undefined): GitView | null {
    const [git, setGit] = useState<GitView | null>(null);
    const id = agent?.id;
    const transcriptPath = agent?.transcriptPath;
    const blockId = agent?.blockId;
    const cwdHint = agent?.cwd;
    useEffect(() => {
        let live = true;
        const load = async () => {
            const cwd = cwdHint ?? (await resolveCwd(transcriptPath, blockId));
            if (!cwd) {
                return { cwd: null, branch: "", changes: null };
            }
            const startTs = await ensureSessionStart(transcriptPath);
            const ch = await RpcApi.GitChangesCommand(TabRpcClient, { cwd, sessionstartts: startTs ?? undefined });
            return {
                cwd,
                branch: ch.branch,
                changes: ch.isrepo ? parseGitChanges(ch.statusz, ch.numstat) : null,
            };
        };
        // the git facts are decoration: a failed read leaves the rows it could not fill out
        load()
            .then((v) => live && setGit(v))
            .catch(() => live && setGit({ cwd: null, branch: "", changes: null }));
        return () => {
            live = false;
        };
    }, [id, transcriptPath, blockId, cwdHint]);
    return git;
}

const KEY = "pt-[2px] text-[10.5px] text-muted";

export function PeekAgentBody({ model, target }: { model: AgentsViewModel; target: PeekTarget }) {
    const agents = useAtomValue(model.agentsAtom);
    const terminals = useAtomValue(model.terminalsAtom);
    const lineage = useAtomValue(model.lineageAtom);
    const now = useAtomValue(model.nowAtom);
    const id = target.kind === "agent" ? target.tabId : "";
    const agent = [...agents, ...terminals].find((a) => a.id === id);
    const git = useAgentGit(agent);
    useEffect(() => {
        reportPeekFacts(target, agentPeekFacts(agent));
    }, [target, agent]);
    if (agent == null) {
        return null;
    }
    const rows = agentGridRows({
        project: agentProject(lineage, agents, agent),
        branch: git?.branch,
        cwd: git?.cwd ?? undefined,
        model: agent.model ? prettyModel(agent.model) : undefined,
        session: sessionLabel(agent),
    });
    const files = git?.changes?.files ?? [];
    const { shown } = capFiles(files, FILES_CAP);
    const age = formatAgeShort(displayAgeMs(agent, now));
    return (
        <div className="flex flex-col">
            <div className="flex items-center gap-2.5 px-3.5 py-3">
                <span className="flex-none text-[10.5px] font-bold uppercase tracking-[0.1em] text-accent-soft">
                    Agent
                </span>
                <span className="min-w-0 flex-1 truncate text-[14px] font-semibold text-ink-hi">{agent.name}</span>
                <span className="inline-flex flex-none items-center gap-1.5 rounded-[6px] border border-border bg-surface-raised px-2 py-[2px] text-[10.5px] font-semibold tabular-nums text-ink-mid">
                    <span className={cn("h-1.5 w-1.5 rounded-full", STATE_DOT[agent.state])} />
                    {agent.state}
                    {age ? ` · ${age}` : ""}
                </span>
            </div>
            <div className="flex flex-col gap-3.5 px-3.5 pb-3.5">
                {rows.length > 0 ? (
                    <div className="grid grid-cols-[74px_minmax(0,1fr)] gap-x-3 gap-y-2 text-[12.5px]">
                        {rows.map((r) => (
                            <PeekGridRow key={r.label} label={r.label} value={r.value} mono={r.mono} />
                        ))}
                    </div>
                ) : null}
                {files.length > 0 ? (
                    <div className="flex flex-col overflow-hidden rounded-[9px] border border-border bg-surface-code">
                        <div className="flex items-center gap-2.5 border-b border-border px-3 py-2">
                            <span className="flex-none text-[10.5px] font-bold uppercase tracking-[0.1em] text-ink-mid">
                                Changed files
                            </span>
                            <span className="h-px flex-1 bg-border" />
                            <span className="flex-none text-[10.5px] tabular-nums text-muted">
                                {changedFilesSummary(files)}
                            </span>
                        </div>
                        {shown.map((f) => (
                            <div
                                key={f.path}
                                className="grid grid-cols-[14px_minmax(0,1fr)_auto_auto] items-center gap-2.5 px-3 py-1.5"
                            >
                                <span className={cn("text-[10.5px] font-bold", statusColor(f.status))}>
                                    {f.status}
                                </span>
                                <span className="truncate text-[11.5px] text-secondary">{f.path}</span>
                                <span className="text-[10.5px] tabular-nums text-diff-added">+{f.adds}</span>
                                <span className="text-[10.5px] tabular-nums text-diff-removed">−{f.dels}</span>
                            </div>
                        ))}
                    </div>
                ) : null}
                <div className="flex items-center gap-2.5 rounded-[9px] border border-dashed border-edge-mid px-3 py-[11px]">
                    <Terminal aria-hidden="true" size={15} strokeWidth={1.8} className="flex-none text-muted" />
                    <span className="text-[12.5px] text-ink-mid">
                        The terminal stays on the Agent surface. Open agent takes you to it.
                    </span>
                </div>
            </div>
        </div>
    );
}

function PeekGridRow({ label, value, mono }: { label: string; value: string; mono: boolean }) {
    return (
        <>
            <span className={KEY}>{label}</span>
            <span className={cn("min-w-0 truncate text-secondary", mono && "font-mono text-[12px]")} title={value}>
                {value}
            </span>
        </>
    );
}
