// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0
//
// The compact transcript of a sleeping agent that is not a Claude agent (Codex, Pi, …), laid over its terminal in the
// agent's cell. A Claude agent's sleeping conversation is ChatPane's (chatpane.tsx): one chat awake and asleep, so its
// box is never remounted. Sleep ends the process, and a TUI that draws on the terminal's alternate screen takes that
// screen with it: what the terminal keeps is only what was printed before the TUI started, then the kill. The
// transcript is the conversation as it stood when the agent slept; nothing writes to it while it sleeps, so it is read
// once rather than streamed. The pane stays mounted under it at its size, so Wake brings the live terminal back with no
// remount and no refit. Under the transcript, a message box: its Enter wakes the agent and sends what is typed as its
// next message (useAgentSend's sleeping path). An agent put to sleep while it asked keeps its question (liveAsk): the
// ask card sits between the transcript and the box, and once answered the answer shows in its place with the line that
// says it goes in when the agent wakes (sleepheldview.tsx), as in Chat.

import { cn } from "@/util/util";
import { AnimatePresence } from "motion/react";
import { AgentComposer } from "./agentcomposer";
import type { AgentsViewModel } from "./agents";
import type { AgentEntry, AgentVM } from "./agentsviewmodel";
import { AskRow } from "./channelsprimitives";
import { CompactTranscript } from "./compacttranscript";
import { AgentPathLinks } from "./pathlinkcontext";
import { ChatHeldAnswer, useHeldAnswer } from "./sleepheldview";
import { JumpToLatestPill, useStickToBottom } from "./sticktobottom";
import { useTranscriptRead } from "./transcriptread";
import { TranscriptSkeleton } from "./transcriptskeleton";

const NO_ENTRIES: AgentEntry[] = [];

// `barred`: the cell has a grid bar on top (h-[26px], gridcellbar.tsx), which stays visible above the transcript. `model`
// answers the kept question; without it the question is answered where the agent is listed (the rows, Needs you)
export function SleepingTranscript({
    agent,
    barred,
    model,
}: {
    agent: AgentVM;
    barred: boolean;
    model?: AgentsViewModel;
}) {
    const entries = useTranscriptRead(agent.transcriptPath, agent.agent, false);
    // a held command's card (Token burn, an Antigravity question) is answered in its dialog, not here
    const asking = model != null && agent.ask != null && !agent.ask.hold;
    const held = useHeldAnswer(agent);
    // where the reader left this sleep's conversation, kept while another agent takes the cell; a later sleep has more
    // to read, so it opens at the end
    const placeId = `sleeping:${agent.id}:${agent.sleeping?.since ?? 0}`;
    const { scrollRef, onScroll, atBottom, jumpToBottom } = useStickToBottom(entries ?? NO_ENTRIES, placeId);
    return (
        <div
            data-sleeping-transcript={agent.id}
            className={cn(
                "absolute inset-x-0 bottom-0 z-20 flex flex-col bg-background",
                barred ? "top-[26px]" : "top-0"
            )}
        >
            <div className="relative min-h-0 flex-1">
                <div ref={scrollRef} onScroll={onScroll} className="h-full overflow-y-auto px-[22px] pb-[12px]">
                    {entries == null ? (
                        <TranscriptSkeleton />
                    ) : entries.length > 0 ? (
                        <AgentPathLinks agent={agent}>
                            <CompactTranscript entries={entries} active={false} placeId={placeId} />
                        </AgentPathLinks>
                    ) : (
                        <div className="flex h-full items-center justify-center text-[12px] text-muted">
                            No transcript found for this session.
                        </div>
                    )}
                </div>
                <JumpToLatestPill show={!atBottom} onClick={jumpToBottom} />
            </div>
            {/* the kept question, or its answer waiting for the wake: in the transcript's column, scrolling inside
                itself when a tall card would take the transcript's room */}
            {asking || held != null ? (
                <div data-sleeping-ask={agent.id} className="max-h-[50%] flex-none overflow-y-auto px-[22px] pb-2">
                    <div className="mx-auto w-full max-w-[760px]">
                        {asking ? <AskRow model={model} agent={agent} alert /> : null}
                        <AnimatePresence initial={false}>
                            {held != null ? <ChatHeldAnswer key="held" agent={agent} held={held} /> : null}
                        </AnimatePresence>
                    </div>
                </div>
            ) : null}
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
