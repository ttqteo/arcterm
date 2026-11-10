// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0
//
// The chat view of a Claude agent's cell: its conversation with a message box, laid over the cell. The pane under it
// (the live xterm) stays mounted at its size, never re-parented or refitted, so flipping to Terminal is only this layer
// fading out (layerFade). It is the one chat awake and asleep: a sleeping Claude agent's cell draws this same pane
// whatever its stored chat mode (its terminal holds only the kill), so the box is one instance that is never remounted
// and its parts fold in place as the agent sleeps and wakes; asleep it reads the transcript once instead of streaming
// it, and its box wakes the agent (useAgentSend's sleeping path). The messages are the transcript the rail reads
// (railtranscript.tsx's useTranscriptWindow, no second reader), kept current by the same live stream's stamps; what the
// person types goes into the PTY as the compact composer's does (chatcomposer.tsx). Under the last message: the working
// line, the permission card for a prompt Claude Code is showing (its answer is typed into the TUI), and an
// AskUserQuestion's choices.

import { layerFade } from "@/app/element/motiontokens";
import { cn } from "@/util/util";
import { useAtomValue } from "jotai";
import { AnimatePresence, MotionConfig, motion, useIsPresent } from "motion/react";
import { useEffect, useState } from "react";
import type { AgentsViewModel } from "./agents";
import type { AgentEntry, AgentVM } from "./agentsviewmodel";
import { AskRow } from "./channelsprimitives";
import { workingText } from "./chatmodel";
import { ChatComposer } from "./chatcomposer";
import { ChatConversation } from "./chatconversation";
import { chatCapable } from "./chatmode";
import { pendingStill } from "./chatpending";
import { usePending } from "./chatpendingstore";
import { setChatMode, useChatMode } from "./chatmodestore";
import { startTranscriptStream, stopTranscriptStream } from "./livetranscript";
import { activityAtomFor } from "./livetranscriptatoms";
import { splitAttachedImages } from "./launcherimages";
import { PromptImages, PromptText } from "./narrationtimeline";
import { AgentPathLinks } from "./pathlinkcontext";
import { PermissionCard } from "./permissioncard";
import { useTranscriptWindow } from "./railtranscript";
import { JumpToLatestPill, useStickToBottom } from "./sticktobottom";
import { TranscriptSkeleton } from "./transcriptskeleton";

const NO_ENTRIES: AgentEntry[] = [];

// A message sent and not in the transcript yet: your bubble, dimmed, and under it "Queued" while Claude works (Claude Code
// takes it at the next gap) or "Sending…" otherwise. It goes when the transcript holds the text (pendingStill).
function PendingBubble({ text, queued }: { text: string; queued: boolean }) {
    const said = splitAttachedImages(text);
    return (
        <div data-chat-pending className="flex flex-col items-end gap-1">
            <div className="max-w-[75%] rounded-[12px] bg-surface-raised px-[14px] py-[9px] text-[13.5px] leading-[1.55] text-primary opacity-60">
                {said.text ? <PromptText text={said.text} /> : null}
                {said.paths.length > 0 ? <PromptImages paths={said.paths} /> : null}
            </div>
            <span className="text-[11px] text-muted">{queued ? "Queued" : "Sending…"}</span>
        </div>
    );
}

// The cell's chat layer while the agent's cell shows Chat, or while a Claude agent sleeps (its terminal holds only the
// kill, so the conversation is what the cell shows, whatever its stored chat mode). Its own component so a cell in
// Terminal never reads the transcript or opens the stream: the layer, and everything it holds, exists only while it is
// shown. It fades in over the terminal and out again (layerFade); the pane stays mounted for the exit, and the exit
// stops taking pointer events at once, so a key or a click meant for the terminal under it is never swallowed (the
// pane's root sets no pointer-events of its own, so it inherits the wrapper's none). The wrapper has no position or
// size (ChatPane is absolute against the cell), only z-20: the cell is a flex column, so the z-index counts on this
// flex item, and the layer keeps ChatPane's own z-20 place in the cell while it fades (opacity < 1 makes the wrapper a
// stacking context, which would otherwise drop it to z-auto).
export function ChatLayer({ model, agent, barred }: { model: AgentsViewModel; agent: AgentVM; barred: boolean }) {
    const shown = useChatMode(agent) === "chat" || (agent.sleeping != null && chatCapable(agent));
    return (
        <MotionConfig reducedMotion="user">
            <AnimatePresence initial={false}>
                {shown ? (
                    <motion.div
                        key="chat"
                        className="z-20"
                        variants={layerFade}
                        initial="initial"
                        animate="animate"
                        exit="exit"
                    >
                        <ChatPane model={model} agent={agent} barred={barred} />
                    </motion.div>
                ) : null}
            </AnimatePresence>
        </MotionConfig>
    );
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
    // while the Agent surface is the one seen, and what was written while it was not is read when it is seen again. A
    // sleeping agent has no process writing to its transcript, so there is no stream: one read as it falls asleep (or as
    // the pane is first seen asleep) puts its last turn in the log.
    const asleep = agent.sleeping != null;
    // false while ChatLayer's exit plays: the pane is still drawn (fading) but already gone as far as input goes
    const present = useIsPresent();
    const streaming = surface === "agent";
    const streamId = path ? `chat:${agent.id}:${path}` : "";
    useEffect(() => {
        if (!streaming || !streamId) {
            return;
        }
        if (asleep) {
            requestAppend();
            return;
        }
        startTranscriptStream(streamId, path, agent.agent);
        requestAppend();
        return () => stopTranscriptStream(streamId);
    }, [streaming, streamId, asleep]);
    const stamp = useAtomValue(activityAtomFor(streamId));
    useEffect(() => {
        if (stamp != null && streaming) {
            requestAppend();
        }
    }, [stamp]);

    const working = workingText(agent.state, agent.activity, entries);
    // a held command's card (a Token burn card, an Antigravity question) is answered in its dialog, not here
    const asking = agent.ask != null && !agent.ask.hold;
    // a read that has not landed yet shows a skeleton; one that failed (a transcript file that is not written yet, most
    // often) and no transcript at all show the empty conversation, so the box is never behind a skeleton that never ends
    const loading = path !== "" && view == null && error == null;
    const empty = !loading && entries.length === 0;
    const hasEarlier = view != null && view.win.start > 0;

    // the messages sent from the box that the transcript does not hold yet; re-read each second while any shows, for the
    // two-minute limit
    const sent = usePending(agent.id);
    const [now, setNow] = useState(() => Date.now());
    const pending = pendingStill(sent, entries, now);
    const showsPending = pending.length > 0;
    useEffect(() => {
        if (!showsPending) {
            return;
        }
        setNow(Date.now());
        const t = setInterval(() => setNow(Date.now()), 1000);
        return () => clearInterval(t);
    }, [showsPending]);

    return (
        <div
            data-agent-chat={agent.id}
            // asleep, the scenarios and the launcher's resume check read the cover by this attribute, as they did the
            // overlay that held the sleeping conversation before this pane did
            data-sleeping-transcript={asleep ? agent.id : undefined}
            // A pane on its way out (to Terminal) is inert: its box takes no focus and drops the one it held, and
            // cellInputOf (cellinput.ts) skips it, so the keyboard goes to the xterm at once, not to the fading box.
            data-chat-leaving={present ? undefined : ""}
            inert={!present}
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
                                working={agent.state === "working"}
                                onLoadEarlier={hasEarlier ? () => void loadEarlier() : undefined}
                            />
                        </AgentPathLinks>
                    )}
                    {/* always drawn, so it is one of the scroller's children from the first render: the scroll stays at
                        the end when a card arrives or the working line changes its height */}
                    <div data-chat-tail className="mx-auto flex w-full max-w-[760px] flex-none flex-col gap-3 pb-2">
                        {pending.map((p) => (
                            <PendingBubble key={p.id} text={p.text} queued={agent.state !== "idle"} />
                        ))}
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
            {/* the conversation's own column (760px), so the box lines up under the last message; keyed by the agent
                alone, so its text and its attachments belong to one agent and the box is never remounted when the agent
                sleeps or wakes (its parts fold in place). Asleep its Enter wakes the agent, and it carries
                data-sleeping-composer for the scenarios' `[data-sleeping-composer] textarea`. */}
            <div className="flex-none px-[22px] pb-4 pt-3">
                <ChatComposer
                    key={agent.id}
                    agent={agent}
                    entries={entries}
                    placeholder={
                        asleep
                            ? `message ${agent.name} to wake it… (Enter)`
                            : `Reply to ${agent.name}, @ to mention, / for commands`
                    }
                    dataAttrs={asleep ? { "data-sleeping-composer": agent.id } : undefined}
                />
            </div>
        </div>
    );
}
