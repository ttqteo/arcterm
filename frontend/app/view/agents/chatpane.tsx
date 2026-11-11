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
import { RpcApi } from "@/app/store/wshclientapi";
import { TabRpcClient } from "@/app/store/wshrpcutil";
import { isMacOS } from "@/util/platformutil";
import { cn, fireAndForget, stringToBase64 } from "@/util/util";
import { useAtom, useAtomValue } from "jotai";
import { Highlighter } from "lucide-react";
import { AnimatePresence, motion, MotionConfig, useIsPresent } from "motion/react";
import { useEffect, useMemo, useState } from "react";
import { goalFromLines } from "../../../../claude/arc-mod/hooks/goal-core";
import { agentDiffScope, openDiff } from "./agentdiffnav";
import type { AgentsViewModel } from "./agents";
import { submitToAgent } from "./agentsubmit";
import type { AgentEntry, AgentVM } from "./agentsviewmodel";
import { AskRow } from "./channelsprimitives";
import { ChatComposer } from "./chatcomposer";
import { ChatConversation } from "./chatconversation";
import { ChatFileCards } from "./chatfilecards";
import { splitAttachments } from "./chatfiles";
import { ChatGoalStrip } from "./chatgoal";
import { ChatLocalCard } from "./chatlocalcards";
import { closeLocalCard, showLocalCard, useLocalCards } from "./chatlocalstore";
import { chatCapable } from "./chatmode";
import { canSendNow, SEND_NOW_KEYS, turnStatsLabel, workingText } from "./chatmodel";
import { setChatMode, useChatMode } from "./chatmodestore";
import { pendingStill, type PendingKind } from "./chatpending";
import { usePending } from "./chatpendingstore";
import { chatSkimOnAtom, refreshSkimMarks } from "./chatskimstore";
import { TaggedPromptText } from "./chattagblock";
import { ChatVisualHost } from "./chatvisualview";
import { startTranscriptStream, stopTranscriptStream } from "./livetranscript";
import { activityAtomFor } from "./livetranscriptatoms";
import { PromptImages, useNow } from "./narrationtimeline";
import { AgentPathLinks } from "./pathlinkcontext";
import { PermissionCard } from "./permissioncard";
import { useTranscriptWindow } from "./railtranscript";
import { JumpToLatestPill, useStickToBottom } from "./sticktobottom";
import { turnStats, type TurnStats } from "./transcriptprojection";
import { TranscriptSkeleton } from "./transcriptskeleton";

// Send now's key in the chat box (chatpending.ts isSendNowKey), as its button shows it
const SEND_NOW_CHORD = isMacOS() ? "⌘↵" : "Ctrl+↵";

const NO_ENTRIES: AgentEntry[] = [];

// when the agent last went idle (ms), null while it works; an agent idle at mount counts from the mount
function useIdleSince(idle: boolean): number | null {
    const [since, setSince] = useState<number | null>(() => (idle ? Date.now() : null));
    useEffect(() => {
        setSince(idle ? Date.now() : null);
    }, [idle]);
    return since;
}

// A message sent and not in the transcript yet: your bubble, dimmed, and under it "Queued" while Claude works (Claude Code
// takes it at the next gap) or "Sending…" otherwise. It goes when the transcript holds the text (pendingStill). It splits
// the text the way your bubble in the transcript does (chatconversation.tsx YouBubble: @mentions as pills, files as cards
// under it), so nothing changes when the transcript's copy replaces it.
// the turn's time and output tokens after the working line, as the TUI's "(1m 11s · ↓ 3.1k tokens)": its own component so
// the second's tick redraws this alone
function TurnStatsText({ stats }: { stats: TurnStats }) {
    const label = turnStatsLabel(stats, useNow(true));
    return label === "" ? null : (
        <span data-chat-turn-stats className="flex-none tabular-nums text-ink-faint">
            ({label})
        </span>
    );
}

// a /btw, a bare panel command or a `! cmd` sent and not in the transcript yet: the command, dimmed, as its card will
// draw it, and under it what it waits on: the side answer the arc mod is asking a fork of the session for, the panel
// open on Claude Code's own screen (its row lands only once it closes), or the command running (its row and output land
// only once it finishes, or goes to the background at 120 s), with a way to the terminal for the last two
function PendingCommand({
    text,
    kind,
    onOpenTerminal,
}: {
    text: string;
    kind: PendingKind;
    onOpenTerminal?: () => void;
}) {
    return (
        <div data-chat-pending data-chat-pending-kind={kind} className="flex flex-col items-end gap-1">
            <div className="max-w-[75%] min-w-[220px] rounded-[12px] border border-edge-mid bg-surface-raised px-[14px] py-[8px] font-mono text-[12.5px] text-primary opacity-60 [overflow-wrap:anywhere]">
                {text.trim()}
            </div>
            <div className="flex items-center gap-2">
                <span className="text-[11px] text-muted">
                    {kind === "btw" ? "Asking on the side…" : kind === "bash" ? "Running…" : "Open in Terminal"}
                </span>
                {kind !== "btw" && onOpenTerminal != null ? (
                    <button
                        type="button"
                        onClick={onOpenTerminal}
                        className="cursor-pointer text-[11px] text-secondary hover:text-primary"
                    >
                        Show Terminal
                    </button>
                ) : null}
            </div>
        </div>
    );
}

function PendingBubble({ text, queued, onSendNow }: { text: string; queued: boolean; onSendNow?: () => void }) {
    const said = splitAttachments(text);
    const body = said.text.trim();
    return (
        <div data-chat-pending className="flex flex-col items-end gap-1">
            {body !== "" || said.images.length > 0 ? (
                <div className="max-w-[75%] rounded-[12px] bg-surface-raised px-[14px] py-[9px] text-[13.5px] leading-[1.55] text-primary opacity-60">
                    {body !== "" ? <TaggedPromptText text={body} /> : null}
                    {said.images.length > 0 ? <PromptImages paths={said.images} /> : null}
                </div>
            ) : null}
            {said.files.length > 0 ? (
                <div className="mt-1 max-w-[75%] opacity-60">
                    <ChatFileCards paths={said.files} />
                </div>
            ) : null}
            <div className="flex items-center gap-2">
                <span className="text-[11px] text-muted">{queued ? "Queued" : "Sending…"}</span>
                {queued && onSendNow != null ? (
                    <button
                        type="button"
                        data-chat-send-now
                        onClick={onSendNow}
                        title={`Send it now (${SEND_NOW_CHORD} in the empty box): Claude moves its running tools to the background and reads your queued messages at once`}
                        className="inline-flex cursor-pointer items-center gap-1.5 text-[11px] text-secondary hover:text-primary"
                    >
                        Send now
                        <kbd className="font-sans text-[10.5px] text-muted">{SEND_NOW_CHORD}</kbd>
                    </button>
                ) : null}
            </div>
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

// Chat's skim toggle, in the pane's top-right corner over the scroller: whether the sentences the skim mod marked draw
// highlighted (chatskimstore.ts); a long reply folds to them only when Settings → Appearance → Chat's fold switch is on
// too. It is Chat's own and global; the terminal's /skim is a separate, per-session fold.
function SkimToggle() {
    const [on, setOn] = useAtom(chatSkimOnAtom);
    return (
        <button
            type="button"
            data-chat-skim-toggle
            aria-pressed={on}
            aria-label="Skim"
            title={`Skim highlights in Chat: ${on ? "on (click to turn off)" : "off (click to turn on)"}`}
            onClick={() => setOn(!on)}
            className={cn(
                "absolute right-3 top-2 z-20 flex h-[26px] w-[26px] cursor-pointer items-center justify-center rounded-[8px] border border-edge-mid bg-surface-raised hover:bg-surface-hover",
                on ? "text-warning" : "text-muted"
            )}
        >
            <Highlighter size={13} strokeWidth={2} aria-hidden />
        </button>
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

    // the skim mod's store is read again whenever the transcript grows: it writes the marks before the transcript line, so
    // the newest reply's marks are there when its text arrives (refreshSkimMarks throttles to one read a second)
    useEffect(() => {
        refreshSkimMarks();
    }, [entries]);

    const working = workingText(agent.state, agent.activity, entries);
    // the turn's time and output tokens, read back from the loaded lines to its prompt; only while it works
    const lines = view?.win.lines;
    const isWorking = working != null;
    const turn = useMemo(() => (isWorking && lines != null ? turnStats(lines) : null), [isWorking, lines]);
    // the session's /goal, read from the same lines (goal-core.ts, shared with the arc mod's band in the TUI)
    const goal = useMemo(() => (lines != null ? goalFromLines(lines) : null), [lines]);
    // a held command's card (a Token burn card, an Antigravity question) is answered in its dialog, not here
    const asking = agent.ask != null && !agent.ask.hold;
    // a read that has not landed yet shows a skeleton; one that failed (a transcript file that is not written yet, most
    // often) and no transcript at all show the empty conversation, so the box is never behind a skeleton that never ends
    const loading = path !== "" && view == null && error == null;
    const empty = !loading && entries.length === 0;
    const hasEarlier = view != null && view.win.start > 0;

    // the messages sent from the box that the transcript does not hold yet; re-read each second while any shows, for the
    // two-minute limit and the idle one (a message cleared with Esc in the terminal never lands: PENDING_IDLE_MS)
    const sent = usePending(agent.id);
    const [now, setNow] = useState(() => Date.now());
    const idleSince = useIdleSince(agent.state === "idle");
    const pending = pendingStill(sent, entries, now, idleSince);
    const showsPending = pending.length > 0;
    // the cards Chat drew for a bare /usage, /tasks… (chatlocal.ts)
    const localCards = useLocalCards(agent.id);
    // a queued message's Send now: Claude Code's own send-now chord in the agent's terminal, which sends every queued
    // message at once
    const blockid = agent.blockId;
    const sendNow =
        blockid != null && canSendNow(agent.state)
            ? () =>
                  fireAndForget(() =>
                      RpcApi.ControllerInputCommand(TabRpcClient, {
                          blockid,
                          inputdata64: stringToBase64(SEND_NOW_KEYS),
                      })
                  )
            : undefined;
    // a message bubble captioned Queued is up (PendingBubble's queued): Ctrl+Enter in the empty box is its Send now
    const queuedShown = agent.state !== "idle" && pending.some((p) => p.kind == null);
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
                <div
                    ref={scrollRef}
                    onScroll={onScroll}
                    className="flex h-full flex-col overflow-y-auto px-[22px] pb-[12px]"
                >
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
                        <ChatVisualHost agentId={agent.id}>
                            <AgentPathLinks agent={agent}>
                                <ChatConversation
                                    key={`${view!.path}:${view!.epoch}`}
                                    entries={entries}
                                    placeId={placeId}
                                    active={agent.state !== "idle"}
                                    working={agent.state === "working"}
                                    onLoadEarlier={hasEarlier ? () => void loadEarlier() : undefined}
                                    onOpenTerminal={asleep ? undefined : () => setChatMode(agent.id, "terminal")}
                                />
                            </AgentPathLinks>
                        </ChatVisualHost>
                    )}
                    {/* always drawn, so it is one of the scroller's children from the first render: the scroll stays at
                        the end when a card arrives or the working line changes its height */}
                    <div data-chat-tail className="mx-auto flex w-full max-w-[760px] flex-none flex-col gap-3 pb-2">
                        {/* its own provider: a pill or card in a pending bubble opens as it will in the transcript's copy */}
                        <AgentPathLinks agent={agent}>
                            {pending.map((p) =>
                                p.kind != null ? (
                                    <PendingCommand
                                        key={p.id}
                                        text={p.text}
                                        kind={p.kind}
                                        onOpenTerminal={asleep ? undefined : () => setChatMode(agent.id, "terminal")}
                                    />
                                ) : (
                                    <PendingBubble
                                        key={p.id}
                                        text={p.text}
                                        queued={agent.state !== "idle"}
                                        onSendNow={sendNow}
                                    />
                                )
                            )}
                        </AgentPathLinks>
                        {localCards.map((c) => (
                            <ChatLocalCard
                                key={c.id}
                                model={model}
                                agent={agent}
                                card={c}
                                onClose={() => closeLocalCard(agent.id, c.id)}
                            />
                        ))}
                        {error != null && view != null ? (
                            <div data-chat-error role="alert" className="text-[12px] leading-[1.5] text-error">
                                Could not read the transcript: {error}
                            </div>
                        ) : null}
                        {working != null ? (
                            <div data-chat-working className="flex items-center gap-2 text-[12px] text-muted">
                                <span
                                    className="h-[7px] w-[7px] flex-none rounded-full bg-accent pulse-dot"
                                    aria-hidden
                                />
                                <span className="min-w-0 truncate">{working}</span>
                                {turn != null ? <TurnStatsText stats={turn} /> : null}
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
                {/* floats over the scroller (the pinned prompt bar leaves room for it); not on the loading or empty state */}
                {!loading && !empty ? <SkimToggle /> : null}
                <JumpToLatestPill show={!atBottom} onClick={jumpToBottom} />
            </div>
            {/* the conversation's own column (760px), so the box lines up under the last message; keyed by the agent
                alone, so its text and its attachments belong to one agent and the box is never remounted when the agent
                sleeps or wakes (its parts fold in place). Asleep its Enter wakes the agent, and it carries
                data-sleeping-composer on its frame for the scenarios' `[data-sleeping-composer] [data-chat-input]`. */}
            <div className="flex-none px-[22px] pb-4 pt-3">
                <div className="mx-auto w-full max-w-[760px]">
                    <ChatGoalStrip
                        goal={goal}
                        onClear={() => {
                            if (agent.blockId != null) {
                                fireAndForget(() => submitToAgent(agent.blockId!, "/goal clear"));
                            }
                        }}
                        onOpenTerminal={() => setChatMode(agent.id, "terminal")}
                    />
                </div>
                <ChatComposer
                    key={agent.id}
                    agent={agent}
                    entries={entries}
                    onSent={jumpToBottom}
                    onSendNow={queuedShown ? sendNow : undefined}
                    onLocal={(route) => {
                        if ("open" in route) {
                            openDiff(model, agentDiffScope(agent.id, agent.name));
                        } else {
                            showLocalCard(agent.id, route.panel, route.command);
                        }
                    }}
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
