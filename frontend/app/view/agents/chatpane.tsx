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
//
// The message box floats over the conversation (the dock): 24px in from the pane's sides, 20px up from its bottom, as wide
// as the conversation's column. The conversation scrolls under it, a fade under the box (data-chat-fade) lets its last
// lines run out without a hard edge, and the scroller's bottom padding follows the dock's measured height so the last line
// can always rise above the box. Chat's jump-to-latest button (data-chat-jump) rides the dock, centred above the box.

import { KeyCap } from "@/app/element/keycap";
import { layerFade, MOTION, sentRise, springPop } from "@/app/element/motiontokens";
import { RpcApi } from "@/app/store/wshclientapi";
import { TabRpcClient } from "@/app/store/wshrpcutil";
import { formatChordString } from "@/util/keysym";
import { cn, fireAndForget, stringToBase64 } from "@/util/util";
import { useAtom, useAtomValue } from "jotai";
import { ArrowDown, Highlighter } from "lucide-react";
import { AnimatePresence, motion, MotionConfig, useIsPresent, useReducedMotion, type Variants } from "motion/react";
import { useEffect, useLayoutEffect, useMemo, useRef, useState, type RefObject } from "react";
import { goalFromLines } from "../../../../claude/arc-mod/hooks/goal-core";
import { canStop } from "./agentcomposer";
import { getProcExitAtom } from "./agentcontrollerstore";
import { agentDiffScope, openDiff } from "./agentdiffnav";
import type { AgentsViewModel } from "./agents";
import { submitToAgent } from "./agentsubmit";
import type { AgentEntry, AgentVM } from "./agentsviewmodel";
import { procExited } from "./brainstormmodel";
import { brainstormAtom, shownBrainstormFile } from "./brainstormstore";
import { AskRow } from "./channelsprimitives";
import { boxPlaceholder, type BoxState } from "./chatboxstate";
import { openQuestion } from "./chatbrainstorm";
import { brainstormAnswersAtom, recordBrainstormAnswer } from "./chatbrainstormstore";
import { boxAnswerRecord, boxPlaceholderOverride } from "./chatbrainstormwire";
import { ChatComposer } from "./chatcomposer";
import { BtwCard, ChatConversation, youBubbleBox } from "./chatconversation";
import { chatEmptyError, chatEmptyView } from "./chatempty";
import { ChatFileCards } from "./chatfilecards";
import { splitAttachments } from "./chatfiles";
import { ChatGoalStrip } from "./chatgoal";
import { CHAT_JUMP_KEYS, registerChatJump } from "./chatjump";
import { awaitsOwnMessage, narratesThinking, streamsLiveReply } from "./chatlive";
import { liveReplyAtom, startLiveReplyStream, stopLiveReplyStream } from "./chatlivestore";
import { ChatLocalCard } from "./chatlocalcards";
import { closeLocalCard, showLocalCard, useLocalCards } from "./chatlocalstore";
import { chatCapable } from "./chatmode";
import { canSendNow, SEND_NOW_KEYS, turnStatsLabel, workingText } from "./chatmodel";
import { setChatMode, useChatMode } from "./chatmodestore";
import {
    btwQuestion,
    pendingLine,
    pendingStill,
    queuedBubbleUp,
    type PendingKind,
    type PendingMessage,
} from "./chatpending";
import { usePending } from "./chatpendingstore";
import { risesFromBox } from "./chatsentrise";
import { chatSkimOnAtom, refreshSkimMarks } from "./chatskimstore";
import { TaggedPromptText } from "./chattagblock";
import { ChatVisualHost } from "./chatvisualview";
import { startTranscriptStream, stopTranscriptStream } from "./livetranscript";
import { activityAtomFor } from "./livetranscriptatoms";
import { PromptImages, useNow } from "./narrationtimeline";
import { AgentPathLinks } from "./pathlinkcontext";
import { PermissionCard } from "./permissioncard";
import { useTranscriptWindow } from "./railtranscript";
import { runtimeLogo } from "./runtimelogo";
import { runtimeMeta } from "./runtimemeta";
import { useStickToBottom } from "./sticktobottom";
import { turnStats, type TurnStats } from "./transcriptprojection";
import { TranscriptSkeleton } from "./transcriptskeleton";

// Send now's key in the chat box (chatpending.ts isSendNowKey), as its button shows it
// read per render: at module load setPlatform has not run yet, so the platform still reads as macOS (⌘⏎ on Windows)
const sendNowChord = () => formatChordString("Mod:Enter");

const NO_ENTRIES: AgentEntry[] = [];

// when the agent last went idle (ms), null while it works; an agent idle at mount counts from the mount
function useIdleSince(idle: boolean): number | null {
    const [since, setSince] = useState<number | null>(() => (idle ? Date.now() : null));
    useEffect(() => {
        setSince(idle ? Date.now() : null);
    }, [idle]);
    return since;
}

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

// Whether a pending bubble rises in from the box (sentRise), decided once as it mounts: the message just sent does, one
// drawn again later (back to this agent, Terminal back to Chat) shows at once (chatsentrise.ts)
function useRisesFromBox(sentAt: number): boolean {
    const [rises] = useState(() => risesFromBox(sentAt, Date.now()));
    return rises;
}

// a /btw, a bare panel command or a `! cmd` sent and not in the transcript yet. A /btw is its card asking (BtwCard), the
// side answer the arc mod is asking a fork of the session for still to come. The others are the command, dimmed, as its
// card will draw it, and under it what it waits on: the panel open on Claude Code's own screen (its row lands only once
// it closes), or the command running (its row and output land only once it finishes, or goes to the background at
// 120 s), with a way to the terminal
function PendingCommand({
    text,
    kind,
    sentAt,
    onOpenTerminal,
}: {
    text: string;
    kind: PendingKind;
    sentAt: number;
    onOpenTerminal?: () => void;
}) {
    const rises = useRisesFromBox(sentAt);
    if (kind === "btw") {
        // the card the transcript's copy will draw, asking: only its body changes when the answer lands
        return (
            <motion.div
                data-chat-pending
                data-chat-pending-kind={kind}
                variants={sentRise}
                initial={rises ? "initial" : false}
                animate="animate"
                style={{ transformOrigin: "bottom center" }}
                className="flex flex-col"
            >
                <BtwCard question={btwQuestion(text) ?? text.trim()} btw={null} />
            </motion.div>
        );
    }
    return (
        <motion.div
            data-chat-pending
            data-chat-pending-kind={kind}
            variants={sentRise}
            initial={rises ? "initial" : false}
            animate="animate"
            style={{ transformOrigin: "bottom right" }}
            className="flex flex-col items-end gap-1"
        >
            <div className="max-w-[75%] min-w-[220px] rounded-[12px] border border-edge-mid bg-surface-raised px-[14px] py-[8px] font-mono text-[12.5px] text-primary opacity-60 [overflow-wrap:anywhere]">
                {text.trim()}
            </div>
            <div className="flex items-center gap-2">
                <span className="text-[11px] text-muted">{kind === "bash" ? "Running…" : "Open in Terminal"}</span>
                {onOpenTerminal != null ? (
                    <button
                        type="button"
                        onClick={onOpenTerminal}
                        className="cursor-pointer text-[11px] text-secondary hover:text-primary"
                    >
                        Show Terminal
                    </button>
                ) : null}
            </div>
        </motion.div>
    );
}

// A message sent and not in the transcript yet: your bubble, drawn as the transcript will draw it and where
// (chatconversation.tsx YouBubble's box, spacing and letter spacing; @mentions as pills, files as cards under it), so the
// transcript's copy taking its place draws nothing new. What it waits on is PendingLine's, under the last of them. It
// goes when the transcript holds the text (pendingStill). `first` is the conversation's first message (the task a
// session was launched on), with no conversation above it to stand clear of.
function PendingBubble({ pending, first }: { pending: PendingMessage; first: boolean }) {
    const said = splitAttachments(pending.text);
    const body = said.text.trim();
    const rises = useRisesFromBox(pending.sentAt);
    return (
        <motion.div
            data-chat-pending
            variants={sentRise}
            initial={rises ? "initial" : false}
            animate="animate"
            style={{ transformOrigin: "bottom right" }}
            // where its transcript row lands: mt-2 over the conversation's pb-2 is the conversation's gap-4 above it,
            // and -mb-1 under the bubble's mb-1 leaves the tail's gap-3 as the row's mb-1 + pb-2 under it
            className={cn("-mb-1 flex flex-col items-end tracking-[-0.01em]", first ? undefined : "mt-2")}
        >
            <div className="flex max-w-[75%] flex-col items-end gap-2">
                {body !== "" || said.images.length > 0 ? (
                    <div className={youBubbleBox(said.files.length > 0)}>
                        {body !== "" ? <TaggedPromptText text={body} /> : null}
                        {said.images.length > 0 ? <PromptImages paths={said.images} /> : null}
                    </div>
                ) : null}
                {said.files.length > 0 ? <ChatFileCards paths={said.files} /> : null}
            </div>
        </motion.div>
    );
}

// the tail's gap above PendingLine, which its margin takes back as it folds
const LINE_GAP = 12;

// PendingLine opens and folds on the spring like a chat row (springReveal), and as it folds its margin takes back the
// tail's gap above it, so what is under it closes up with no jump when it unmounts. At rest it sits 4px under the bubble
function pendingLineVariants(reduce: boolean): Variants {
    const shape = reduce ? { duration: 0 } : MOTION.spring;
    const fade = { duration: MOTION.durMicro, ease: MOTION.easeFluid };
    const t = { height: shape, marginTop: shape, opacity: fade };
    return {
        initial: { opacity: 0, height: 0, marginTop: -LINE_GAP },
        animate: { opacity: 1, height: "auto", marginTop: -8, transition: t },
        exit: { opacity: 0, height: 0, marginTop: -LINE_GAP, transition: t },
    };
}

// What the pending messages wait on, under the last of them (chatpending.ts pendingLine): the harness's starting line
// while a session starts, else Queued while Claude works (Claude Code takes them at the next gap), with Send now. One
// line, not one per bubble, and its own row: the bubbles go the moment the transcript takes them, and this folds away
// after them, so neither a dimmed bubble nor a caption under it blinks out as the transcript's copy replaces it.
function PendingLine({ text, starting, onSendNow }: { text: string; starting: boolean; onSendNow?: () => void }) {
    const reduce = useReducedMotion() ?? false;
    const chord = sendNowChord();
    return (
        <motion.div
            data-chat-pending-line
            variants={pendingLineVariants(reduce)}
            initial="initial"
            animate="animate"
            exit="exit"
            className="flex flex-none items-center justify-end gap-2 overflow-hidden"
        >
            <span data-chat-pending-label className="flex items-center gap-1.5 text-[11px] text-muted">
                {starting ? (
                    <span className="h-[6px] w-[6px] flex-none rounded-full bg-accent pulse-dot" aria-hidden />
                ) : null}
                {text}
            </span>
            {!starting && onSendNow != null ? (
                <button
                    type="button"
                    data-chat-send-now
                    onClick={onSendNow}
                    title={`Send it now (${chord} in the empty box): Claude moves its running tools to the background and reads your queued messages at once`}
                    className="inline-flex cursor-pointer items-center gap-1.5 text-[11px] text-secondary hover:text-primary"
                >
                    Send now
                    <kbd className="font-sans text-[10.5px] text-muted">{chord}</kbd>
                </button>
            ) : null}
        </motion.div>
    );
}

// The conversation before its first message (chatempty.ts): the harness's mark over its state. Starting, the mark
// breathes and a flow bar runs under the line saying where it starts; at its prompt, the session's facts and how to
// begin; failed, the controller's reason in the error tone.
function ChatEmpty({ agent, error }: { agent: AgentVM; error: string | null }) {
    const v = chatEmptyView(agent);
    const logo = runtimeLogo(agent.agent);
    const starting = v.phase === "starting";
    const shownError = chatEmptyError(error, v.phase);
    return (
        <div
            data-chat-empty={v.phase}
            className="flex min-h-[160px] flex-1 flex-col items-center justify-center gap-3 px-6 text-center"
        >
            <div
                className={cn(
                    "flex h-[44px] w-[44px] items-center justify-center rounded-[12px] border border-edge-mid bg-surface-raised",
                    starting && "pulse-dot"
                )}
                aria-hidden
            >
                {logo ? (
                    <img src={logo} alt="" className="h-[22px] w-[22px]" draggable={false} />
                ) : (
                    <span className={cn("text-[18px]", runtimeMeta(agent.agent).text)}>
                        {runtimeMeta(agent.agent).glyph}
                    </span>
                )}
            </div>
            <div className="flex max-w-[440px] flex-col items-center gap-1">
                <span className="text-[14px] font-medium text-primary">{v.title}</span>
                {v.detail ? (
                    <span
                        className={cn("text-[12px] leading-[1.5]", v.phase === "failed" ? "text-error" : "text-muted")}
                    >
                        {v.detail}
                    </span>
                ) : null}
                {v.facts ? <span className="font-mono text-[11px] text-muted">{v.facts}</span> : null}
            </div>
            {starting ? (
                <div className="h-[2px] w-[120px] overflow-hidden rounded-full bg-lane" aria-hidden>
                    <div className="h-full w-[40%] animate-[flowBar_1.9s_linear_infinite] bg-gradient-to-r from-transparent via-accent to-transparent motion-reduce:animate-none" />
                </div>
            ) : null}
            {v.phase === "ready" ? (
                <div className="flex flex-wrap items-center justify-center gap-x-3 gap-y-1 text-[11.5px] text-muted">
                    <span>Type below to start</span>
                    <span className="flex items-center gap-1">
                        <KeyCap chord="@" variant="inline" /> mentions a file
                    </span>
                    <span className="flex items-center gap-1">
                        <KeyCap chord="/" variant="inline" /> runs a command
                    </span>
                </div>
            ) : v.hint ? (
                <span className="text-[11.5px] text-muted">{v.hint}</span>
            ) : null}
            {/* a transcript the harness has not written yet is the normal start, not an error to show */}
            {shownError != null ? (
                <span data-chat-error className="max-w-[420px] text-[11.5px] text-muted">
                    Could not read the transcript: {shownError}
                </span>
            ) : null}
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

// the dock's place in the pane, and the room kept between the last line and the box (px)
const DOCK_BOTTOM = 20;
const DOCK_MARGIN = 16;

// The scroller's bottom padding = the dock's height (the box, and the goal strip above it) + its 20px from the bottom + a
// 16px margin, so the last line scrolls to rest above the box whatever its height. It is written to the element, not kept
// in state: the box's height spring is a new height every frame, and a re-render of the pane per frame would redraw the
// conversation. The padding takes height from the scroller's content box, which useStickToBottom's observer sees and
// re-pins a stuck tail on, so the tail rides the box as it grows; a reader scrolled up is left where they are. The
// observer's writes wait a frame: a write inside its own callback would loop the observers.
function useDockPadding(scrollRef: RefObject<HTMLDivElement | null>, dockRef: RefObject<HTMLDivElement | null>) {
    useLayoutEffect(() => {
        const scroller = scrollRef.current;
        const dock = dockRef.current;
        if (scroller == null || dock == null) {
            return;
        }
        const apply = () => {
            // a cell that is not on screen has no size: keep the padding it had, the observer writes the real one when
            // the cell is shown again
            if (dock.offsetHeight > 0) {
                scroller.style.paddingBottom = `${dock.offsetHeight + DOCK_BOTTOM + DOCK_MARGIN}px`;
            }
        };
        apply();
        let frame = 0;
        const ro = new ResizeObserver(() => {
            cancelAnimationFrame(frame);
            frame = requestAnimationFrame(apply);
        });
        ro.observe(dock);
        return () => {
            ro.disconnect();
            cancelAnimationFrame(frame);
        };
    }, []);
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
    // the jump-to-latest key (agent:chat-jump-latest) presses the ↓ below, and passes while the ↓ is not drawn
    const jumpState = useRef({ atBottom, jumpToBottom });
    jumpState.current = { atBottom, jumpToBottom };
    useEffect(
        () =>
            registerChatJump(agent.id, () => {
                if (jumpState.current.atBottom) {
                    return false;
                }
                jumpState.current.jumpToBottom();
                return true;
            }),
        [agent.id]
    );

    // The live stream only says the file grew: each stamp asks for an append read (the RailTranscript pattern). It runs
    // while the Agent surface is the one seen, and what was written while it was not is read when it is seen again. A
    // sleeping agent has no process writing to its transcript, so there is no stream: one read as it falls asleep (or as
    // the pane is first seen asleep) puts its last turn in the log.
    const asleep = agent.sleeping != null;
    // The agent's brainstorm. The question it waits on draws as a card at the end of the conversation (chatbrainstormcard.tsx)
    // and words the box's placeholder; what is sent from the box while it waits is kept as the answer (onBoxSent), which
    // pairs with the message the transcript lands, so that draws as the question's ✓ row (chatbrainstorm.ts pairAnswers).
    // A click on a card's option is recorded by sendBrainstorm itself. Chat never switches to the Brainstorm tab for any of
    // it: the card's own button does.
    const brainstormState = useAtomValue(brainstormAtom(agent.id));
    const sentAnswers = useAtomValue(brainstormAnswersAtom(agent.id));
    const procExit = useAtomValue(getProcExitAtom(agent.blockId ?? ""));
    const exited = procExited(procExit, agent.sleeping);
    const brainstormTopic = brainstormState?.topic ?? "";
    const question = useMemo(
        () => openQuestion(shownBrainstormFile(brainstormState), sentAnswers, exited, brainstormTopic),
        [brainstormState, sentAnswers, exited, brainstormTopic]
    );
    // the box's state, as the box reports it (chatboxstate.ts); it words the empty box. Until the box has said, what the
    // agent's state already tells.
    const [boxNow, setBoxNow] = useState<BoxState>(() =>
        asleep ? "asleep" : agent.blockId != null && canStop(agent.state, agent.sleeping) ? "running" : "idle"
    );
    const dockRef = useRef<HTMLDivElement>(null);
    useDockPadding(scrollRef, dockRef);
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
    // the reply Claude is writing (chatlive.ts), from the arc mod's live file: a stream of its own, open while the
    // transcript's is, for a Claude agent that is awake
    const liveStreams = streaming && !!streamId && !asleep && streamsLiveReply(agent);
    useEffect(() => {
        if (!liveStreams) {
            return;
        }
        startLiveReplyStream(streamId, path);
        return () => stopLiveReplyStream(streamId);
    }, [liveStreams, streamId]);

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
    // the live reply, which ChatConversation reads itself so its ticks redraw only the conversation: held back while the
    // message that started its turn has not landed (its bubble is drawn under the conversation, and the reply belongs
    // after it), and with its thinking blocks only where the session narrates in them
    const narrates = useMemo(() => (lines != null ? narratesThinking(lines) : false), [lines]);
    const awaitsOwn = awaitsOwnMessage(pending);
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
    // a message bubble captioned Queued is up (sent while the agent worked, which it still does): Ctrl+Enter in the
    // empty box is its Send now
    const queuedShown = agent.state !== "idle" && queuedBubbleUp(pending);
    useEffect(() => {
        if (!showsPending) {
            return;
        }
        setNow(Date.now());
        const t = setInterval(() => setNow(Date.now()), 1000);
        return () => clearInterval(t);
    }, [showsPending]);
    // a conversation with no message yet but one on its way (the task a session was launched on, most often): that
    // message is what the pane shows, under it what the harness is doing
    const opening = (loading || empty) && showsPending;
    const startingView = opening && !asleep ? chatEmptyView(agent) : null;
    const startingTitle = startingView?.phase === "starting" ? startingView.title : undefined;
    const line = pendingLine(pending, startingTitle);

    // a message taken from the box: the chat scrolls to the end so its bubble lands in view, and while a question waits the
    // message is its answer, kept with how many same-text messages the transcript held before it (`entries` is what the
    // pending bubble counts on too)
    const onBoxSent = (text: string) => {
        jumpToBottom();
        const answer = boxAnswerRecord(question, brainstormTopic, text, entries, Date.now());
        if (answer != null) {
            recordBrainstormAnswer(agent.id, answer);
        }
    };

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
                    // the bottom padding is the dock's (useDockPadding)
                    className="flex h-full flex-col overflow-y-auto px-[22px]"
                >
                    {opening ? (
                        // the first message stands for the conversation: no skeleton or empty state over it
                        <div data-chat-opening className="flex-none pt-4" />
                    ) : loading ? (
                        <TranscriptSkeleton />
                    ) : empty ? (
                        <ChatEmpty agent={agent} error={error} />
                    ) : (
                        <ChatVisualHost agentId={agent.id}>
                            <AgentPathLinks agent={agent}>
                                <ChatConversation
                                    key={`${view!.path}:${view!.epoch}`}
                                    entries={entries}
                                    liveReply={liveStreams && !awaitsOwn ? liveReplyAtom(streamId) : undefined}
                                    liveNarrates={narrates}
                                    placeId={placeId}
                                    active={agent.state !== "idle"}
                                    working={agent.state === "working"}
                                    onLoadEarlier={hasEarlier ? () => void loadEarlier() : undefined}
                                    onOpenTerminal={asleep ? undefined : () => setChatMode(agent.id, "terminal")}
                                    brainstorm={{ agent, topic: brainstormTopic, answers: sentAnswers, question }}
                                    model={model}
                                    agent={agent}
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
                                        sentAt={p.sentAt}
                                        onOpenTerminal={asleep ? undefined : () => setChatMode(agent.id, "terminal")}
                                    />
                                ) : (
                                    <PendingBubble key={p.id} pending={p} first={opening} />
                                )
                            )}
                        </AgentPathLinks>
                        <AnimatePresence initial={false}>
                            {line != null ? (
                                <PendingLine
                                    key="line"
                                    text={line}
                                    starting={startingTitle != null}
                                    onSendNow={sendNow}
                                />
                            ) : null}
                        </AnimatePresence>
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
                        {/* the empty conversation, or the first message's label, already says the harness is starting */}
                        {working != null && !empty && !opening ? (
                            <div data-chat-working className="flex items-center gap-2 text-[12px] text-muted">
                                <span
                                    className="h-[7px] w-[7px] flex-none rounded-full jarvis-dot pulse-dot"
                                    aria-hidden
                                />
                                <span className="min-w-0 truncate shimmer-jarvis">{working}</span>
                                {turn != null ? <TurnStatsText stats={turn} /> : null}
                            </div>
                        ) : null}
                        <PermissionCard
                            agent={agent}
                            askShown={asking}
                            onOpenTerminal={() => setChatMode(agent.id, "terminal")}
                        />
                        {asking ? (
                            <div data-chat-ask={agent.id}>
                                <AskRow model={model} agent={agent} alert />
                            </div>
                        ) : null}
                    </div>
                </div>
                {/* floats over the scroller (the pinned prompt bar leaves room for it); not on the loading or empty state */}
                {!loading && !empty ? <SkimToggle /> : null}
                {/* the conversation runs out under the box: transparent at the top, the pane's background at the foot (a
                    functional fade, DESIGN.md), clear of the scrollbar so that stays whole */}
                <div
                    data-chat-fade
                    aria-hidden
                    style={{
                        background:
                            "linear-gradient(to bottom, color-mix(in srgb, var(--color-background) 0%, transparent), var(--color-background) 62%)",
                    }}
                    className="pointer-events-none absolute bottom-0 left-0 right-[10px] h-[190px]"
                />
                {/* The dock: the goal strip and the floating box, the conversation's column. It takes no pointer outside its
                    column. The box is keyed by the agent alone, so its text and its attachments belong to one agent and it
                    is never remounted when the agent sleeps or wakes (its parts fold in place). Asleep its Enter wakes the
                    agent, and it carries data-sleeping-composer on its frame for the scenarios'
                    `[data-sleeping-composer] [data-chat-input]`. */}
                <div ref={dockRef} data-chat-dock className="pointer-events-none absolute inset-x-6 bottom-5 z-10">
                    <div className="pointer-events-auto relative mx-auto w-full max-w-[720px]">
                        {/* Chat's own jump-to-latest: a ↓ pill naming its key, centred just above the box while the reader is scrolled
                            up; it pops in and out on the spring (the wrapper carries the centring, so the pop's scale is the
                            button's alone) */}
                        <div className="absolute bottom-full left-1/2 z-10 mb-4 -translate-x-1/2">
                            <AnimatePresence initial={false}>
                                {!atBottom ? (
                                    <motion.button
                                        key="jump"
                                        type="button"
                                        data-chat-jump
                                        variants={springPop}
                                        initial="initial"
                                        animate="animate"
                                        exit="exit"
                                        style={{ transformOrigin: "bottom" }}
                                        onClick={jumpToBottom}
                                        title={`Jump to latest (${formatChordString(CHAT_JUMP_KEYS)})`}
                                        aria-label="Jump to latest"
                                        className="group flex h-[32px] cursor-pointer items-center justify-center gap-1.5 rounded-full border border-edge-strong bg-surface-raised pl-[9px] pr-3 text-secondary shadow-popover-sm hover:border-accent hover:text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
                                    >
                                        <ArrowDown size={14} strokeWidth={2} aria-hidden />
                                        <kbd className="font-sans text-[10.5px] text-muted group-hover:text-secondary">
                                            {formatChordString(CHAT_JUMP_KEYS)}
                                        </kbd>
                                    </motion.button>
                                ) : null}
                            </AnimatePresence>
                        </div>
                        <ChatGoalStrip
                            goal={goal}
                            onClear={() => {
                                if (agent.blockId != null) {
                                    fireAndForget(() => submitToAgent(agent.blockId!, "/goal clear"));
                                }
                            }}
                            onOpenTerminal={() => setChatMode(agent.id, "terminal")}
                        />
                        <ChatComposer
                            key={agent.id}
                            agent={agent}
                            entries={entries}
                            onSent={onBoxSent}
                            onBoxState={setBoxNow}
                            onShowDiff={() => openDiff(model, agentDiffScope(agent.id, agent.name))}
                            onSendNow={queuedShown ? sendNow : undefined}
                            onLocal={(route) => {
                                if ("open" in route) {
                                    openDiff(model, agentDiffScope(agent.id, agent.name));
                                } else {
                                    showLocalCard(agent.id, route.panel, route.command);
                                }
                            }}
                            placeholder={boxPlaceholder(boxNow, agent.name, boxPlaceholderOverride(question))}
                            dataAttrs={asleep ? { "data-sleeping-composer": agent.id } : undefined}
                        />
                    </div>
                </div>
            </div>
        </div>
    );
}
