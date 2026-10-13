// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0
//
// A sleeping agent's conversation, laid over its terminal in the agent's cell. Sleep ends the process, and a TUI that
// draws on the terminal's alternate screen takes that screen with it: what the terminal keeps is only what was printed
// before the TUI started, then the kill. The transcript is the conversation as it stood when the agent slept; nothing
// writes to it while it sleeps, so it is read once rather than streamed. The pane stays mounted under it at its size,
// so Wake brings the live terminal back with no remount and no refit. Under the conversation, a composer: its Enter
// wakes the agent and sends what is typed as its next message (AgentComposer's sleeping path).

import { cn } from "@/util/util";
import { AgentComposer } from "./agentcomposer";
import type { AgentEntry, AgentVM } from "./agentsviewmodel";
import { CompactTranscript } from "./compacttranscript";
import { AgentPathLinks } from "./pathlinkcontext";
import { JumpToLatestPill, useStickToBottom } from "./sticktobottom";
import { useTranscriptRead } from "./transcriptread";
import { TranscriptSkeleton } from "./transcriptskeleton";

const NO_ENTRIES: AgentEntry[] = [];

// `barred`: the cell has a grid bar on top (h-[26px], gridcellbar.tsx), which stays visible above the transcript
export function SleepingTranscript({ agent, barred }: { agent: AgentVM; barred: boolean }) {
    const entries = useTranscriptRead(agent.transcriptPath, agent.agent, false);
    const { scrollRef, onScroll, atBottom, jumpToBottom } = useStickToBottom(entries ?? NO_ENTRIES);
    return (
        <div
            data-sleeping-transcript={agent.id}
            className={cn(
                "absolute inset-x-0 bottom-0 z-20 flex flex-col bg-background",
                barred ? "top-[26px]" : "top-0"
            )}
        >
            <div className="relative min-h-0 flex-1">
                <div ref={scrollRef} onScroll={onScroll} className="h-full overflow-y-auto px-[22px] py-[12px]">
                    {entries == null ? (
                        <TranscriptSkeleton />
                    ) : entries.length > 0 ? (
                        <AgentPathLinks agent={agent}>
                            <CompactTranscript entries={entries} active={false} />
                        </AgentPathLinks>
                    ) : (
                        <div className="flex h-full items-center justify-center text-[12px] text-muted">
                            No transcript found for this session.
                        </div>
                    )}
                </div>
                <JumpToLatestPill show={!atBottom} onClick={jumpToBottom} />
            </div>
            {/* the transcript's own column (CompactTranscript), so the box lines up under the last message; keyed, so a
                draft belongs to one agent */}
            <div data-sleeping-composer={agent.id} className="flex-none px-[22px]">
                <AgentComposer
                    key={agent.id}
                    blockId={agent.blockId}
                    agent={agent}
                    placeholder={`message ${agent.name} to wake it… (Enter)`}
                    className="mx-auto w-full max-w-[760px] px-0"
                />
            </div>
        </div>
    );
}
