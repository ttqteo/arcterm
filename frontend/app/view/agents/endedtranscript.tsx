// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0
//
// A done task's worker in the Agent surface's center: its session has ended, so it is read back as narration
// from the transcript its session wrote, the way a subagent's is. The transcript is found by the session id
// the engine launched the worker under, so it still reads after the worker's tab is gone.

import { globalStore } from "@/app/store/jotaiStore";
import { useAtomValue } from "jotai";
import { useEffect } from "react";
import type { AgentsViewModel } from "./agents";
import type { AgentVM } from "./agentsviewmodel";
import { startTranscriptStream, stopTranscriptStream } from "./livetranscript";
import { entriesAtomFor } from "./livetranscriptatoms";
import { CompactTranscript } from "./compacttranscript";
import { railVisibleAtom } from "./railstore";
import { leadAgentOf } from "./runlineage";
import { loadRunTranscriptPath, runTranscriptPathsAtom } from "./runlineagestore";
import { endedLine } from "./runrail";
import { JumpToLatestPill, useStickToBottom } from "./sticktobottom";
import { TranscriptSkeleton } from "./transcriptskeleton";

export function EndedTranscript({ model, agent }: { model: AgentsViewModel; agent: AgentVM }) {
    const lineage = useAtomValue(model.lineageAtom);
    const agents = useAtomValue(model.agentsAtom);
    const paths = useAtomValue(runTranscriptPathsAtom);
    const entries = useAtomValue(entriesAtomFor(agent.id));
    const { scrollRef, onScroll, atBottom, jumpToBottom } = useStickToBottom(entries);
    const role = lineage.roles[agent.id];
    const run = role?.kind === "worker" ? lineage.runs[role.leadRunId] : undefined;
    const task = role?.kind === "worker" ? run?.dag?.tasks?.find((t) => t.id === role.taskId) : undefined;
    const childRunId = agent.runId;
    const channelId = run?.channelId;
    const lead = role?.kind === "worker" ? leadAgentOf(lineage, agents, role.leadRunId) : undefined;
    // back to the run: its lead, with the rail open on the run's lanes
    const toRun = () => {
        if (lead == null) {
            return;
        }
        globalStore.set(model.focusIdAtom, lead.id);
        globalStore.set(railVisibleAtom, true);
    };

    useEffect(() => {
        if (channelId && childRunId) {
            loadRunTranscriptPath(channelId, childRunId);
        }
    }, [channelId, childRunId]);

    useEffect(() => {
        if (!agent.transcriptPath) {
            return;
        }
        startTranscriptStream(agent.id, agent.transcriptPath, agent.agent);
        return () => stopTranscriptStream(agent.id);
    }, [agent.id, agent.transcriptPath, agent.agent]);

    const missing = childRunId == null || paths[childRunId] === "";
    return (
        <div className="flex min-h-0 flex-1 flex-col">
            <div className="mx-[22px] mt-[12px] flex flex-none items-center gap-[10px] rounded-[6px] border border-edge-mid bg-surface-raised px-[12px] py-[8px] text-[11px] text-muted">
                <span>●</span>
                <span className="min-w-0 flex-1 truncate">
                    {task ? endedLine(task, run?.digest) : "Session ended · read-only transcript"}
                </span>
                {lead ? (
                    <button
                        type="button"
                        onClick={toRun}
                        className="flex-none cursor-pointer rounded-[6px] px-[6px] py-[2px] font-semibold text-accent-soft hover:bg-surface-hover"
                    >
                        ↑ run
                    </button>
                ) : null}
            </div>
            <div className="relative min-h-0 flex-1">
                <div ref={scrollRef} onScroll={onScroll} className="h-full overflow-y-auto px-[22px] py-[12px]">
                    {entries.length > 0 ? (
                        <CompactTranscript entries={entries} active={false} />
                    ) : missing ? (
                        <div className="flex h-full items-center justify-center text-[12px] text-muted">
                            No transcript found for this session.
                        </div>
                    ) : (
                        <TranscriptSkeleton />
                    )}
                </div>
                {!atBottom ? <JumpToLatestPill onClick={jumpToBottom} /> : null}
            </div>
        </div>
    );
}
