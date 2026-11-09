// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0
//
// The chat view of a Claude agent's cell: its conversation as bubbles with a message box, laid over the cell the way
// SleepingTranscript is laid over a sleeping one. The pane under it (the live xterm) stays mounted at its size, never
// re-parented or refitted, so flipping to Terminal is only this layer leaving. The messages are the transcript the rail
// reads (railtranscript.tsx's useTranscriptWindow, no second reader), kept current by the same live stream's stamps;
// what the person types goes into the PTY as the compact composer's does (chatcomposer.tsx). Under the last message:
// the working line, the permission card for a prompt Claude Code is showing (its answer is typed into the TUI), and an
// AskUserQuestion's choices.

import { cn } from "@/util/util";
import { useAtomValue } from "jotai";
import { useEffect } from "react";
import type { AgentsViewModel } from "./agents";
import type { AgentEntry, AgentVM } from "./agentsviewmodel";
import { AskRow } from "./channelsprimitives";
import { workingLine } from "./chatmodel";
import { ChatComposer } from "./chatcomposer";
import { ChatConversation } from "./chatconversation";
import { setChatMode, useChatMode } from "./chatmodestore";
import { startTranscriptStream, stopTranscriptStream } from "./livetranscript";
import { activityAtomFor } from "./livetranscriptatoms";
import { AgentPathLinks } from "./pathlinkcontext";
import { PermissionCard } from "./permissioncard";
import { useTranscriptWindow } from "./railtranscript";
import { JumpToLatestPill, useStickToBottom } from "./sticktobottom";
import { TranscriptSkeleton } from "./transcriptskeleton";

const NO_ENTRIES: AgentEntry[] = [];

// The cell's chat layer while the agent's cell shows Chat. Its own component so a cell in Terminal never reads the
// transcript or opens the stream: the layer, and everything it holds, exists only while it is shown.
export function ChatLayer({ model, agent, barred }: { model: AgentsViewModel; agent: AgentVM; barred: boolean }) {
    return useChatMode(agent) === "chat" ? <ChatPane model={model} agent={agent} barred={barred} /> : null;
}

// `barred`: the cell has a grid bar on top (h-[26px], gridcellbar.tsx), which stays visible above the chat
export function ChatPane({ model, agent, barred }: { model: AgentsViewModel; agent: AgentVM; barred: boolean }) {
    const path = agent.transcriptPath ?? "";
    const surface = useAtomValue(model.surfaceAtom);
    const { view, error, loadEarlier, requestAppend } = useTranscriptWindow(path, agent.agent);
    const entries = view?.entries ?? NO_ENTRIES;
    // where the reader left the conversation, kept while the cell shows the terminal or another agent
    const placeId = `chat:${agent.id}:${path}`;
    const { scrollRef, onScroll, atBottom, jumpToBottom } = useStickToBottom(entries, placeId);

    // The live stream only says the file grew: each stamp asks for an append read (the RailTranscript pattern). It runs
    // while the Agent surface is the one seen, and what was written while it was not is read when it is seen again.
    const streaming = surface === "agent";
    const streamId = path ? `chat:${agent.id}:${path}` : "";
    useEffect(() => {
        if (!streaming || !streamId) {
            return;
        }
        startTranscriptStream(streamId, path, agent.agent);
        requestAppend();
        return () => stopTranscriptStream(streamId);
    }, [streaming, streamId]);
    const stamp = useAtomValue(activityAtomFor(streamId));
    useEffect(() => {
        if (stamp != null && streaming) {
            requestAppend();
        }
    }, [stamp]);

    const working = workingLine(agent.state, agent.activity);
    // a held command's card (a Token burn card, an Antigravity question) is answered in its dialog, not here
    const asking = agent.ask != null && !agent.ask.hold;
    // a read that has not landed yet shows a skeleton; one that failed (a transcript file that is not written yet, most
    // often) and no transcript at all show the empty conversation, so the box is never behind a skeleton that never ends
    const loading = path !== "" && view == null && error == null;
    const empty = !loading && entries.length === 0;
    const hasEarlier = view != null && view.win.start > 0;

    return (
        <div
            data-agent-chat={agent.id}
            className={cn(
                "absolute inset-x-0 bottom-0 z-20 flex flex-col bg-background",
                barred ? "top-[26px]" : "top-0"
            )}
        >
            <div className="relative min-h-0 flex-1">
                <div ref={scrollRef} onScroll={onScroll} className="flex h-full flex-col overflow-y-auto px-[22px] pb-[12px]">
                    {loading ? (
                        <TranscriptSkeleton />
                    ) : empty ? (
                        <div
                            data-chat-empty
                            className="flex min-h-[120px] flex-1 flex-col items-center justify-center gap-1 text-[12px] text-muted"
                        >
                            <span>No messages yet</span>
                            {error != null ? (
                                <span data-chat-error className="max-w-[420px] text-center text-[11.5px]">
                                    Could not read the transcript: {error}
                                </span>
                            ) : null}
                        </div>
                    ) : (
                        <AgentPathLinks agent={agent}>
                            <ChatConversation
                                key={`${view!.path}:${view!.epoch}`}
                                entries={entries}
                                placeId={placeId}
                                active={agent.state !== "idle"}
                                onLoadEarlier={hasEarlier ? () => void loadEarlier() : undefined}
                            />
                        </AgentPathLinks>
                    )}
                    {/* always drawn, so it is one of the scroller's children from the first render: the scroll stays at
                        the end when a card arrives or the working line changes its height */}
                    <div data-chat-tail className="mx-auto flex w-full max-w-[760px] flex-none flex-col gap-3 pb-2">
                        {error != null && view != null ? (
                            <div data-chat-error role="alert" className="text-[12px] leading-[1.5] text-error">
                                Could not read the transcript: {error}
                            </div>
                        ) : null}
                        {working != null ? (
                            <div data-chat-working className="flex items-center gap-2 text-[12px] text-muted">
                                <span className="h-[7px] w-[7px] flex-none rounded-full bg-accent pulse-dot" aria-hidden />
                                <span className="min-w-0 truncate">{working}</span>
                            </div>
                        ) : null}
                        <PermissionCard agent={agent} onOpenTerminal={() => setChatMode(agent.id, "terminal")} />
                        {asking ? (
                            <div data-chat-ask={agent.id}>
                                <AskRow model={model} agent={agent} alert />
                            </div>
                        ) : null}
                    </div>
                </div>
                <JumpToLatestPill show={!atBottom} onClick={jumpToBottom} />
            </div>
            {/* the conversation's own column (760px), so the box lines up under the last message; keyed, so its text and
                its attachments belong to one agent */}
            <div className="flex-none px-[22px] pb-4 pt-3">
                <ChatComposer key={agent.id} agent={agent} placeholder={`Reply to ${agent.name}, / for commands`} />
            </div>
        </div>
    );
}
