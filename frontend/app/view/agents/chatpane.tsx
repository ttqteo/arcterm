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

import { pushToast } from "@/app/cockpit/notificationstore";
import { KeyCap } from "@/app/element/keycap";
import { layerFade, MOTION, sentRise, springPop } from "@/app/element/motiontokens";
import { RpcApi } from "@/app/store/wshclientapi";
import { TabRpcClient } from "@/app/store/wshrpcutil";
import { loadEffortDetail } from "@/app/view/jarvis/effortstore";
import { formatChordString } from "@/util/keysym";
import { cn, fireAndForget, stringToBase64 } from "@/util/util";
import { useAtom, useAtomValue } from "jotai";
import { ArrowDown, Highlighter, X } from "lucide-react";
import {
    animate,
    AnimatePresence,
    motion,
    MotionConfig,
    useIsPresent,
    usePresence,
    useReducedMotion,
    type Variants,
} from "motion/react";
import { useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode, type RefObject } from "react";
import { goalFromLines } from "../../../../claude/arc-mod/hooks/goal-core";
import { confirmCloseSession } from "./agentactions";
import { canStop } from "./agentcomposer";
import { getProcExitAtom } from "./agentcontrollerstore";
import { agentCwd } from "./agentcwd";
import { agentDiffScope, openDiff } from "./agentdiffnav";
import type { AgentsViewModel } from "./agents";
import { sendToAgent, submitToAgent } from "./agentsubmit";
import { askSentKey, type AgentEntry, type AgentVM } from "./agentsviewmodel";
import { answerAgentAsk } from "./askanswer";
import { builderCheckView, procExited, type BuilderCheckView } from "./brainstormmodel";
import { brainstormAtom, brainstormSeenAtom, shownBrainstormFile } from "./brainstormstore";
import { canvasStateAtom } from "./canvasstore";
import { AskRow } from "./channelsprimitives";
import { boxPlaceholder, type BoxState } from "./chatboxstate";
import { answersTopic, brainstormCard, holdCard, type ChatCard } from "./chatbrainstorm";
import { brainstormAnswersAtom, recordBrainstormAnswer } from "./chatbrainstormstore";
import { boxAnswerRecord, boxPlaceholderOverride } from "./chatbrainstormwire";
import { canvasPick } from "./chatcanvaspick";
import { ChatCanvasPickCard } from "./chatcanvaspickcard";
import { ChatComposer } from "./chatcomposer";
import { BtwCard, ChatConversation, youBubbleBox } from "./chatconversation";
import { isDocReviewAsk } from "./chatdocreview";
import { ChatDocReviewCard } from "./chatdocreviewcard";
import { chatEmptyError, chatEmptyView } from "./chatempty";
import { ChatFileCards } from "./chatfilecards";
import { splitAttachments } from "./chatfiles";
import { chatFocusReadOnAtom, chatFocusReadSizeAtom } from "./chatfocusreadstore";
import { FOCUS_LINE_CLASS, FOCUS_LINE_TITLE, useFocusRead } from "./chatfocusreadview";
import { forkShowsSource, turnInFork } from "./chatfork";
import { ChatGoalStrip } from "./chatgoal";
import { isHandoffAsk } from "./chathandoff";
import { ChatHandoffCard } from "./chathandoffcard";
import { holdSwitchLine } from "./chatinitiativestore";
import { cancelQueuedChat, chatBoxText, focusChatBox, replaceChatBox, submitIntoChatBox } from "./chatinsert";
import { choiceTurn, judgedChips, judgeLine, judgeReason } from "./chatjudge";
import { CHAT_JUMP_KEYS, registerChatJump } from "./chatjump";
import { ChatLimitStrip } from "./chatlimitstripview";
import {
    awaitsOwnMessage,
    liveTurn,
    narratesThinking,
    nextWorkingHold,
    QUEUED_TAKEN_MS,
    streamsLiveReply,
    type WorkingHold,
} from "./chatlive";
import { liveReplyAtom, startLiveReplyStream, stopLiveReplyStream } from "./chatlivestore";
import { ChatLocalCard } from "./chatlocalcards";
import { closeLocalCard, showLocalCard, useLocalCards } from "./chatlocalstore";
import { useLostBash } from "./chatlostbashstore";
import { canSendNow, compactingNow, SEND_NOW_KEYS, turnStatsLabel, workingLine } from "./chatmodel";
import { setChatMode, useChatShown } from "./chatmodestore";
import {
    btwQuestion,
    droppedIds,
    landedIds,
    pendingLine,
    pendingStill,
    queuedBubbleUp,
    wakingBubbleUp,
    type PendingKind,
    type PendingMessage,
} from "./chatpending";
import { dropPendingIds, sentHistory, usePending } from "./chatpendingstore";
import { ChatRefLinks } from "./chatrefbadge";
import { risesFromBox } from "./chatsentrise";
import { chatSkimOnAtom, refreshSkimMarks } from "./chatskimstore";
import { SleepRunRows } from "./chatsleepbashrows";
import {
    chatChips,
    closeChip,
    endsWithQuestion,
    initiativeChips,
    lastReply,
    recentPrompts,
    ruleChips,
    suggestKey,
    wantsModelSuggest,
    writesVietnamese,
    yesNoChips,
    yesNoQuestion,
} from "./chatsuggest";
import {
    loadChatJudges,
    markChunkDone,
    requestModelSuggest,
    setLiveJudge,
    stopDeepJudge,
    useChatJudge,
    useEffortDetail,
    useModelSuggest,
} from "./chatsuggeststore";
import { TaggedPromptText } from "./chattagblock";
import { mergeTaken, withoutTakenBack } from "./chattakeback";
import { noteTakenBack, takeBackDropped, useTakenBack } from "./chattakebackstore";
import { VERDICT_TOPIC } from "./chatverdict";
import { ChatVisualHost } from "./chatvisualview";
import { doneSuggestion } from "./donesuggest";
import { FocusReadPill } from "./focusreadpill";
import { switchAgentChunk } from "./initiativebandstore";
import { startTranscriptStream, stopTranscriptStream } from "./livetranscript";
import { activityAtomFor } from "./livetranscriptatoms";
import { PromptImages, useNow } from "./narrationtimeline";
import { AgentPathLinks } from "./pathlinkcontext";
import { PermissionCard } from "./permissioncard";
import { projectsAtom } from "./projectsstore";
import { useTranscriptWindow } from "./railtranscript";
import { runQueueAtom, useBrainstormQueue } from "./runqueuestore";
import { runtimeLogo } from "./runtimelogo";
import { runtimeMeta } from "./runtimemeta";
import { ScreenDialogCard } from "./screendialogcard";
import { shipGitAtom } from "./shipstore";
import { useStickToBottom } from "./sticktobottom";
import { backgroundTasksByIdAtom } from "./subagentsstore";
import { runningBackgroundTasks, turnStats, type TurnStats } from "./transcriptprojection";
import { TranscriptSkeleton } from "./transcriptskeleton";
import { unreadAgentsAtom } from "./unreadagentsstore";
import { useWaking } from "./wakingstore";
import { WorkingGlyph } from "./workingglyph";

// Send now's key in the chat box (chatpending.ts isSendNowKey), as its button shows it
// read per render: at module load setPlatform has not run yet, so the platform still reads as macOS (⌘⏎ on Windows)
const sendNowChord = () => formatChordString("Mod:Enter");

const NO_ENTRIES: AgentEntry[] = [];

// when the agent last went idle (ms), null while it works; an agent idle at mount counts from the mount
// Whether the transcript at `path` has held a message while this pane showed it: once it has, a re-read that is still
// loading does not send a fork's Chat back to the transcript it resumed.
function useHadMessages(path: string, has: boolean): boolean {
    const seen = useRef<string | null>(null);
    if (has) {
        seen.current = path;
    }
    return has || seen.current === path;
}

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

// The agent's live ask under the conversation: the plan handoff (an AskUserQuestion with header `Handoff`) and a Doc review
// (header `Doc review`, over a `.md` or `.tex` file) as their cards, every other ask as its plain choices. A row of the
// handoff card answers with the index of the agent's own option, through the answer path the cockpit's bars share
// (askanswer.ts), which locks the ask against a second click; the rows go dead once the answer is sent, and for an exited
// agent, whose card is static. The Doc review card answers its Approve the same way and locks it the same way (it reads
// the lock itself); its Review opens the review view, where Request changes is made. Words typed in the box answer the
// ask as for any ask.
function ChatAsk({ model, agent, exited }: { model: AgentsViewModel; agent: AgentVM; exited: boolean }) {
    const sentIds = useAtomValue(model.sentIdsAtom);
    const questions = agent.ask?.questions;
    const question = questions?.[0];
    if (question != null && isDocReviewAsk(questions)) {
        return (
            <ChatDocReviewCard question={question} state={exited ? "static" : "waiting"} agent={agent} model={model} />
        );
    }
    if (question == null || !isHandoffAsk(questions)) {
        return <AskRow model={model} agent={agent} alert />;
    }
    const sent = sentIds.has(askSentKey(agent) ?? "");
    return (
        <ChatHandoffCard
            question={question}
            state={exited ? "static" : "waiting"}
            agent={agent}
            onPick={
                exited || sent
                    ? undefined
                    : (optionIndex) => {
                          answerAgentAsk(model, agent.id, { 0: new Set([optionIndex]) }, {});
                      }
            }
        />
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
// transcript's copy taking its place draws nothing new. What it waits on is PendingLine's, under the last of them. A
// Queued one (sent while Claude works) is dimmed until Claude Code takes it: it waits for minutes, and the full-strength
// transcript row taking its place is the news that it was read. One sent to an idle agent stays full strength, since the
// transcript takes it in a moment and a dim bubble would only blink. It goes when the transcript holds the text
// (pendingStill). `first` is the conversation's first message (the task a session was launched on), with no
// conversation above it to stand clear of.
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
            <div
                data-chat-pending-queued={pending.queued === true ? "" : undefined}
                className={cn("flex max-w-[75%] flex-col items-end gap-2", pending.queued === true && "opacity-55")}
            >
                {body !== "" || said.images.length > 0 ? (
                    <div className={cn("relative", youBubbleBox(said.files.length > 0))}>
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

// The working line, which opens and folds on the spring as a chat row does (Arriving): drawn and dropped at once, the
// conversation stuck to the end jumped by its height as a turn started and again as it ended. `arrive`: it shows on a
// pane already drawn (a turn starting), not on the pane's first render. The tail's gap that goes with it is taken back
// by a margin as it closes, on the side something is drawn (above it, else under it), so nothing jumps as it mounts or
// unmounts. Imperative, as Arriving is: the styles that close it are set before the first paint, and removed at rest.
// The working line to draw: `line`, or the line just gone, held through a queued message's hand-over (chatlive.ts
// nextWorkingHold). `queuedUp` is whether a Queued bubble shows now; one that went within QUEUED_TAKEN_MS still counts.
function useHeldWorking(line: string | null, queuedUp: boolean): string | null {
    const prev = useRef<string | null>(line);
    const queuedAt = useRef(0);
    const hold = useRef<WorkingHold | null>(null);
    const [, redraw] = useState(0);
    const now = Date.now();
    const next = nextWorkingHold(
        prev.current,
        line,
        queuedUp || now - queuedAt.current < QUEUED_TAKEN_MS,
        hold.current,
        now
    );
    useLayoutEffect(() => {
        prev.current = line;
        hold.current = next;
        if (queuedUp) {
            queuedAt.current = Date.now();
        }
    });
    // the hold's end is a draw of its own: nothing else may change by then
    const until = next?.until;
    useEffect(() => {
        if (until == null) {
            return;
        }
        const t = setTimeout(() => redraw((n) => n + 1), Math.max(0, until - Date.now()) + 20);
        return () => clearTimeout(t);
    }, [until]);
    return line ?? next?.line ?? null;
}

function WorkingLine({ arrive, children }: { arrive: boolean; children: ReactNode }) {
    const ref = useRef<HTMLDivElement>(null);
    const reduce = useReducedMotion() ?? false;
    const [isPresent, safeToRemove] = usePresence();
    const fold = (el: HTMLElement): "marginTop" | "marginBottom" | null =>
        el.previousElementSibling != null ? "marginTop" : el.nextElementSibling != null ? "marginBottom" : null;
    const opens = useRef(arrive && !reduce);
    useLayoutEffect(() => {
        const el = ref.current;
        if (!opens.current || el == null) {
            return;
        }
        const full = el.getBoundingClientRect().height;
        const side = fold(el);
        const rest = () => {
            for (const prop of ["height", "margin-top", "margin-bottom", "opacity", "overflow"]) {
                el.style.removeProperty(prop);
            }
        };
        el.style.overflow = "hidden";
        el.style.height = "0px";
        el.style.opacity = "0";
        if (side != null) {
            el.style[side] = `${-LINE_GAP}px`;
        }
        const runs = [
            animate(el, { height: [0, full] }, MOTION.spring),
            animate(el, { opacity: [0, 1] }, { duration: MOTION.durMicro, ease: MOTION.easeFluid }),
            ...(side != null ? [animate(el, { [side]: [-LINE_GAP, 0] }, MOTION.spring)] : []),
        ];
        let over = false;
        const end = () => {
            if (!over) {
                over = true;
                rest();
            }
        };
        void Promise.all(runs.map((run) => run.finished)).then(end, end);
        return () => {
            for (const run of runs) {
                run.stop();
            }
            end();
        };
    }, []);
    useEffect(() => {
        const el = ref.current;
        if (isPresent) {
            return;
        }
        if (el == null || reduce) {
            safeToRemove?.();
            return;
        }
        const full = el.getBoundingClientRect().height;
        const side = fold(el);
        el.style.overflow = "hidden";
        const runs = [
            animate(el, { height: [full, 0] }, MOTION.spring),
            animate(el, { opacity: [1, 0] }, { duration: MOTION.durMicro, ease: MOTION.easeFluid }),
            ...(side != null ? [animate(el, { [side]: [0, -LINE_GAP] }, MOTION.spring)] : []),
        ];
        void Promise.all(runs.map((run) => run.finished)).then(
            () => safeToRemove?.(),
            () => safeToRemove?.()
        );
        return () => {
            for (const run of runs) {
                run.stop();
            }
        };
    }, [isPresent]);
    return (
        <div ref={ref} data-chat-working className="flex flex-none items-center gap-2 text-[12px] text-muted">
            {children}
        </div>
    );
}

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
// after them, so neither a dimmed bubble nor a caption under it blinks out as the transcript's copy replaces it. The ×
// after Send now cancels the queued messages: out of Claude Code's queue, the turn running on.
function PendingLine({
    text,
    starting,
    onSendNow,
    onCancel,
}: {
    text: string;
    starting: boolean;
    onSendNow?: () => void;
    onCancel?: () => void;
}) {
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
            {/* one queued message's line has no words (chatpending.ts pendingLine): Send now alone */}
            {text !== "" ? (
                <span data-chat-pending-label className="flex items-center gap-1.5 text-[11px] text-muted">
                    {starting ? (
                        <span className="h-[6px] w-[6px] flex-none rounded-full bg-accent pulse-dot" aria-hidden />
                    ) : null}
                    {text}
                </span>
            ) : null}
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
            {!starting && onCancel != null ? (
                <button
                    type="button"
                    data-chat-cancel-queued
                    onClick={onCancel}
                    aria-label="Cancel the queued messages"
                    title="Cancel: take the queued messages out of Claude's queue (the turn runs on); ↑ in the empty box brings them back"
                    className="inline-flex h-[16px] w-[16px] cursor-pointer items-center justify-center rounded-[4px] text-muted hover:bg-surface-hover hover:text-primary"
                >
                    <X size={12} strokeWidth={2} />
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
    const shown = useChatShown(agent);
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
// how far above the dock's top the conversation fades out; under the dock the fade is solid, so nothing reads through
// the strips or the chips over the box
const DOCK_FADE = 72;

// The scroller's bottom padding = the dock's height (the box, and the goal strip above it) + its 20px from the bottom + a
// 16px margin, so the last line scrolls to rest above the box whatever its height. It is written to the element, not kept
// in state: the box's height spring is a new height every frame, and a re-render of the pane per frame would redraw the
// conversation. The padding takes height from the scroller's content box, which useStickToBottom's observer sees and
// re-pins a stuck tail on, so the tail rides the box as it grows; a reader scrolled up is left where they are. The
// observer's writes wait a frame: a write inside its own callback would loop the observers.
// The fade under the dock is written the same way: as tall as the dock plus DOCK_FADE, solid from DOCK_FADE down, so a
// dock grown by the usage strip and the chips never stands over the conversation's text.
function useDockPadding(
    scrollRef: RefObject<HTMLDivElement | null>,
    dockRef: RefObject<HTMLDivElement | null>,
    fadeRef: RefObject<HTMLDivElement | null>
) {
    useLayoutEffect(() => {
        const scroller = scrollRef.current;
        const dock = dockRef.current;
        if (scroller == null || dock == null) {
            return;
        }
        // the fade shows only as far as the conversation runs on under the box: at the end the last line rests clear of
        // the box with nothing under it, and a fade there only dimmed that line (the working line most of all)
        const shade = () => {
            const fade = fadeRef.current;
            if (fade != null) {
                const below = scroller.scrollHeight - scroller.scrollTop - scroller.clientHeight;
                fade.style.opacity = String(Math.min(1, Math.max(0, below / DOCK_FADE)));
            }
        };
        const apply = () => {
            // a cell that is not on screen has no size: keep the padding it had, the observer writes the real one when
            // the cell is shown again
            if (dock.offsetHeight > 0) {
                scroller.style.paddingBottom = `${dock.offsetHeight + DOCK_BOTTOM + DOCK_MARGIN}px`;
                const fade = fadeRef.current;
                if (fade != null) {
                    fade.style.height = `${dock.offsetHeight + DOCK_BOTTOM + DOCK_FADE}px`;
                }
            }
            shade();
        };
        apply();
        let frame = 0;
        const ro = new ResizeObserver(() => {
            cancelAnimationFrame(frame);
            frame = requestAnimationFrame(apply);
        });
        ro.observe(dock);
        // the conversation's own growth is not observed: a stuck tail re-pins (a scroll event), and a reader scrolled up
        // past DOCK_FADE has the fade whole already
        ro.observe(scroller);
        scroller.addEventListener("scroll", shade, { passive: true });
        return () => {
            ro.disconnect();
            cancelAnimationFrame(frame);
            scroller.removeEventListener("scroll", shade);
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

// Chat's focus read toggle, under Skim on a narrow pane and beside it on a wide one: one block at a time, the rest dimmed
// (chatfocusreadview.ts). Each agent's own, remembered (chatfocusreadstore.ts); the pill itself is focusreadpill.tsx,
// shared with the markdown Preview. The pane's own width decides (the @container on the scroller's wrapper): from 912px
// the centred 760px column leaves room for the two side by side; narrower, they stack in one 26px column on the right
// edge, the pill's steps growing down from under Skim, and the scroller's right padding keeps only that column clear.
function FocusReadToggle({ agentId, scrollRef }: { agentId: string; scrollRef: RefObject<HTMLDivElement | null> }) {
    const [on, setOn] = useAtom(chatFocusReadOnAtom(agentId));
    return (
        <FocusReadPill
            readerId={agentId}
            on={on}
            setOn={setOn}
            scrollRef={scrollRef}
            onTitle={(keys) => `Focus read: on for this agent (${keys} or click to turn off)`}
            offTitle={(keys) => `Focus read: read this agent's Chat one block at a time (${keys})`}
            quote
            className="right-3 top-10 @min-[912px]:right-[42px] @min-[912px]:top-2"
        />
    );
}

// `barred`: the cell has a grid bar on top (h-[26px], gridcellbar.tsx), which stays visible above the chat.
// What an `agent:`, `run:` or `council:` reference resolves against (chatrefbadge.tsx) wraps the whole pane, so the
// conversation, the pending bubbles and the box's pills all draw their badges from it. The project is the registered
// project's path, which is what runs and councils are kept under: never the agent's cwd, a worktree for a run's worker.
export function ChatPane({ model, agent, barred }: { model: AgentsViewModel; agent: AgentVM; barred: boolean }) {
    const projects = useAtomValue(projectsAtom);
    const project = projects[agent.project ?? ""]?.path ?? "";
    const refLinks = useMemo(() => ({ model, project, selfId: agent.id }), [model, project, agent.id]);
    return (
        <ChatRefLinks value={refLinks}>
            <ChatPaneBody model={model} agent={agent} barred={barred} />
        </ChatRefLinks>
    );
}

function ChatPaneBody({ model, agent, barred }: { model: AgentsViewModel; agent: AgentVM; barred: boolean }) {
    const ownPath = agent.transcriptPath ?? "";
    const surface = useAtomValue(model.surfaceAtom);
    const own = useTranscriptWindow(ownPath, agent.agent);
    // a fork shows the transcript it resumes until its own holds a message (chatfork.ts forkShowsSource): Claude Code
    // writes the history it copies only at the fork's first message. The live stream stays on its own file, which
    // says when that happens.
    const ownHasMessages = useHadMessages(ownPath, (own.view?.entries.length ?? 0) > 0);
    const forkPath = forkShowsSource(agent.forkOf, ownHasMessages) ? agent.forkOf! : "";
    const fork = useTranscriptWindow(forkPath, agent.agent);
    const readsFork = forkPath !== "";
    const path = readsFork ? forkPath : ownPath;
    const { view, catchingUp, error, loadEarlier } = readsFork ? fork : own;
    const requestAppend = own.requestAppend;
    // once its own holds the history the fork is an agent like any other: a later /clear starts a session of its own,
    // never the one it was forked from
    useEffect(() => {
        if (agent.forkOf && ownHasMessages) {
            fireAndForget(() =>
                RpcApi.SetMetaCommand(TabRpcClient, { oref: `tab:${agent.id}`, meta: { "session:forkof": null } })
            );
        }
    }, [agent.forkOf, ownHasMessages, agent.id]);
    // less a message Esc took back after Claude Code wrote it (chattakeback.ts withoutTakenBack): its rewind keeps the
    // record until the next prompt branches off before it
    const taken = useTakenBack(agent.id);
    const shown = useMemo(
        () => withoutTakenBack(view?.entries ?? NO_ENTRIES, taken, Date.now()),
        [view?.entries, taken]
    );
    const entries = shown.entries;
    // the `!` commands arcterm's restart cut short, which the transcript never got (chatlostbash.ts)
    const lostBash = useLostBash(path, entries);
    useEffect(() => {
        if (shown.next != null) {
            noteTakenBack(agent.id, shown.next);
        }
    }, [shown.next]);
    // where the reader left the conversation, kept while the cell shows the terminal or another agent
    const placeId = `chat:${agent.id}:${path}`;
    const { scrollRef, onScroll, atBottom, jumpToBottom } = useStickToBottom(entries, placeId);
    // ⌘↓ on a Mac draws the pill's own ↓ again; Ctrl+End elsewhere says something the arrow does not
    const jumpKeyIsArrow = formatChordString(CHAT_JUMP_KEYS).includes("↓");
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
    // The agent's brainstorm. The card it ends with (the question it waits on, Confirm the design, the builder check, the
    // run) draws at the end of the conversation (chatbrainstormcard.tsx and its siblings); a question's card also words the
    // box's placeholder. What is sent from the box while a question waits is kept as the answer (onBoxSent), which pairs
    // with the message the transcript lands, so that draws as the question's ✓ row (chatbrainstorm.ts pairAnswers). A click
    // on a card's button is recorded by sendBrainstorm itself. Chat never switches to the Brainstorm tab for any of it: the
    // card's own button does.
    const brainstormState = useAtomValue(brainstormAtom(agent.id));
    const sentAnswers = useAtomValue(brainstormAnswersAtom(agent.id));
    const seenMarks = useAtomValue(brainstormSeenAtom);
    const procExit = useAtomValue(getProcExitAtom(agent.blockId ?? ""));
    const exited = procExited(procExit, agent.sleeping);
    const brainstormTopic = brainstormState?.topic ?? "";
    // a closed brainstorm draws no card, but its lines already sent still pair with their messages
    const pairedTopic = answersTopic(brainstormTopic, sentAnswers, VERDICT_TOPIC);
    // the run queue, for the card to find the entry Approve queued (queuedForBrainstorm): it reads Queued where Approve was
    const brainstormQueue = useBrainstormQueue(brainstormState?.path ?? null);
    const nextCard = useMemo(() => {
        const s = brainstormState;
        // the builder check as the Brainstorm tab reads it (brainstormpane.tsx): the card and the tab say one thing
        const check: BuilderCheckView =
            s != null
                ? builderCheckView(agent.builderCheck, s.sentCheckAt, s.file, s.modifiedMs, agent)
                : { kind: "none" };
        return brainstormCard({
            file: shownBrainstormFile(s),
            records: sentAnswers,
            exited,
            topic: brainstormTopic,
            check,
            sent: s?.sent?.kind ?? null,
            seen: s != null ? (seenMarks[s.path] ?? null) : null,
            starting: s?.starting ?? null,
            modifiedMs: s?.modifiedMs ?? null,
            queue: brainstormQueue,
        });
    }, [
        brainstormState,
        sentAnswers,
        exited,
        brainstormTopic,
        seenMarks,
        brainstormQueue,
        agent.builderCheck,
        agent.state,
        agent.idleSince,
    ]);
    // the card the conversation shows: the one the brainstorm makes, else the question shown last while the agent works
    // on (holdCard), so the card never leaves and comes back between two questions
    const shownCard = useRef<ChatCard | null>(null);
    const agentWorking = agent.state === "working";
    const fileGone = brainstormState?.file == null;
    const card = useMemo(
        () => holdCard(shownCard.current, nextCard, agentWorking, fileGone),
        [nextCard, agentWorking, fileGone]
    );
    useLayoutEffect(() => {
        shownCard.current = card;
    }, [card]);
    // the box's state, as the box reports it (chatboxstate.ts); it words the empty box. Until the box has said, what the
    // agent's state already tells.
    const [boxNow, setBoxNow] = useState<BoxState>(() =>
        asleep ? "asleep" : agent.blockId != null && canStop(agent.state, agent.sleeping) ? "running" : "idle"
    );
    const dockRef = useRef<HTMLDivElement>(null);
    const fadeRef = useRef<HTMLDivElement>(null);
    useDockPadding(scrollRef, dockRef, fadeRef);
    // Focus read: the reading line's tick in the gutter; it dims while you follow the agent's work at the bottom too, and
    // lights the new reply when that turn ends
    const focusRead = useAtomValue(chatFocusReadOnAtom(agent.id));
    const focusTickRef = useRef<HTMLDivElement>(null);
    const focusReadSize = useAtomValue(chatFocusReadSizeAtom);
    useFocusRead(agent.id, scrollRef, focusTickRef, focusRead, agentWorking && atBottom, focusReadSize, agentWorking);
    // false while ChatLayer's exit plays: the pane is still drawn (fading) but already gone as far as input goes
    const present = useIsPresent();
    const streaming = surface === "agent";
    const streamId = ownPath ? `chat:${agent.id}:${ownPath}` : "";
    useEffect(() => {
        if (!streaming || !streamId) {
            return;
        }
        if (asleep) {
            requestAppend();
            return;
        }
        startTranscriptStream(streamId, ownPath, agent.agent);
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
        startLiveReplyStream(streamId, ownPath);
        return () => stopLiveReplyStream(streamId);
    }, [liveStreams, streamId]);

    // the skim mod's store is read again whenever the transcript grows: it writes the marks before the transcript line, so
    // the newest reply's marks are there when its text arrives (refreshSkimMarks throttles to one read a second)
    useEffect(() => {
        refreshSkimMarks();
    }, [entries]);

    const working = workingLine(agent.state, agent.activity);
    // the turn's time and output tokens, read back from the loaded lines to its prompt; only while it works, and not
    // while it compacts, which is no turn of its own
    const lines = view?.win.lines;
    const isWorking = working != null && !compactingNow(agent.state, agent.activity);
    // a fork's copied history ends on a prompt of the source session: no turn of the fork's own (turnInFork)
    const turn = useMemo(
        () => (isWorking && lines != null ? turnInFork(turnStats(lines), agent.forkedAt) : null),
        [isWorking, lines, agent.forkedAt]
    );
    // the session's /goal, read from the same lines (goal-core.ts, shared with the arc mod's band in the TUI)
    const goal = useMemo(() => (lines != null ? goalFromLines(lines) : null), [lines]);
    // where the agent works, which the card of a turn's files names folders against: its own, else the transcript's
    // (a Claude record carries one a line or two in; the first 50 bound the parse for a transcript that has none)
    const cwd = useMemo(() => agent.cwd ?? (lines != null ? agentCwd(lines.slice(0, 50)) : null), [agent.cwd, lines]);
    // a held command's card (a Token burn card, an Antigravity question) is answered in its dialog, not here
    const asking = agent.ask != null && !agent.ask.hold;
    // a read that has not landed yet shows a skeleton; an agent switched back to shows its kept window at once while it
    // reads what was written since (ChatConversation draws those rows at once, not one by one on the spring: catchingUp).
    // One that failed (a transcript file that is not written yet, most often) and no transcript at all show the empty
    // conversation, so the box is never behind a skeleton that never ends
    const loading = path !== "" && view == null && error == null;
    const empty = !loading && entries.length === 0;
    const hasEarlier = view != null && view.win.start > 0;

    // the messages sent from the box that the transcript does not hold yet; re-read each second while any shows, for the
    // two-minute limit and the idle one (a message cleared with Esc in the terminal never lands: PENDING_IDLE_MS)
    const sent = usePending(agent.id);
    // a message the transcript took is forgotten, so its bubble never comes back when a rewind later drops its record
    useEffect(() => {
        const landed = landedIds(sent, entries, sentHistory(agent.id));
        if (landed.length > 0) {
            dropPendingIds(agent.id, landed);
        }
    }, [sent, entries, agent.id]);
    // a message a hook dropped (its "Not sent" marker landed, and no record of it will): its bubble goes and its text
    // comes back to the box, out of Claude Code's box when the hook put it back there, so the next send is not typed
    // after that copy (two drops left the @mention four times in the terminal's box)
    useEffect(() => {
        const ids = droppedIds(sent, entries);
        if (ids.length === 0) {
            return;
        }
        const texts = sent.filter((p) => ids.includes(p.id)).map((p) => p.text);
        dropPendingIds(agent.id, ids);
        const put = (back: string[]) => {
            replaceChatBox(agent.id, mergeTaken(back, chatBoxText(agent.id)));
            focusChatBox(agent.id);
        };
        const blockId = agent.blockId;
        if (blockId == null) {
            put(texts);
            return;
        }
        fireAndForget(() => takeBackDropped(agent.id, blockId, texts, put));
    }, [sent, entries, agent.id, agent.blockId]);
    const [now, setNow] = useState(() => Date.now());
    const idleSince = useIdleSince(agent.state === "idle");
    const pending = pendingStill(sent, entries, now, idleSince, sentHistory(agent.id));
    const showsPending = pending.length > 0;
    // the live reply, which ChatConversation reads itself so its ticks redraw only the conversation: held back while the
    // message that started its turn has not landed (its bubble is drawn under the conversation, and the reply belongs
    // after it), and with its thinking blocks only where the session narrates in them
    const narrates = useMemo(() => (lines != null ? narratesThinking(lines) : false), [lines]);
    const awaitsOwn = awaitsOwnMessage(pending);
    // the last turn drawn is over while that message is on its way, so its files card stays put through the send
    const lastTurn = liveTurn(agent.state, pending);
    // a message bubble of yours stood in the tail at the last commit: the row of yours landing now is its twin, drawn at
    // once in its place; with none up, a row of yours that lands opens on the spring as any row does (ChatConversation
    // ownArrives): one whose bubble the idle rule dropped before it landed, or one typed in the terminal
    const bubbleUp = pending.some((p) => p.kind == null);
    const bubbleWasUp = useRef(bubbleUp);
    useLayoutEffect(() => {
        bubbleWasUp.current = bubbleUp;
    });
    const ownArrives = !bubbleUp && !bubbleWasUp.current;
    // the pane has been drawn once: a working line showing from then on opens on the spring (WorkingLine)
    const paneDrawn = useRef(false);
    useEffect(() => {
        paneDrawn.current = true;
    }, []);
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
    // the working line drawn: kept through the idle between a turn and the queued message it takes next (nextWorkingHold)
    const shownWorking = useHeldWorking(working, queuedBubbleUp(pending));
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
    // a message sent to the sleeping agent waits on the wake: its line pulses as the starting line does, with no Send now
    const wakingShown = wakingBubbleUp(pending);
    // a wake under way, from this box or anywhere else: the empty box says so rather than offering to wake it
    const wakingNow = useWaking(agent.id);

    // The replies the box suggests once the turn ends (chatsuggest.ts): the rules' at once, from the header's git read of
    // the repo; the model's when its call answers. Only the agent in focus on the Agent surface makes the call, so an
    // agent nobody looks at costs none; its answer is kept by turn, so a look later finds it.
    const focusId = useAtomValue(model.focusIdAtom);
    const shipGit = useAtomValue(shipGitAtom)[agent.id];
    const reply = useMemo(() => lastReply(entries), [entries]);
    const recent = useMemo(() => recentPrompts(entries), [entries]);
    const question = useMemo(() => reply != null && endsWithQuestion(reply), [reply]);
    const questionWaits = boxPlaceholderOverride(card) != null;
    // The quick pick card (chatcanvaspick.ts): the option boards of the canvas this app opened for the agent in focus,
    // when its last reply asks you to choose between them. While it shows, the model's guessed chips ("A đi") give way
    // to it, and no call is made for them. `pickSent` is the reply a row was sent for, which hides the card at once.
    const canvas = useAtomValue(canvasStateAtom(agent.id));
    const [pickSent, setPickSent] = useState<string | null>(null);
    const pick = useMemo(
        () =>
            canvasPick({
                reply,
                idle: agent.state === "idle" && !asleep && !exited && agent.blockId != null,
                focused: focusId === agent.id,
                brainstorm: brainstormState != null,
                boards: canvas != null && canvas.status !== "removed" ? canvas.boards : null,
                sent: pickSent,
            }),
        [reply, agent.state, asleep, exited, agent.blockId, focusId, agent.id, brainstormState, canvas, pickSent]
    );
    const turnKey = useMemo(() => (reply != null ? suggestKey(agent.id, reply) : null), [agent.id, reply]);
    const modelSuggest = useModelSuggest(turnKey);
    // A turn that ends in a choice question has a judge record (chatjudge.ts, pkg/chatjudge): the judge's pick moves to
    // the row's first place, and the box's Tab line says why. A turn that is not one has none, and its row is as the
    // rules and the model made it. wavesrv keeps the records, so the agent's are read once per app life.
    const choice = useMemo(() => reply != null && choiceTurn(reply), [reply]);
    const judge = useChatJudge(choice ? turnKey : null);
    useEffect(() => {
        loadChatJudges(agent.id);
    }, [agent.id]);
    // a message taken from the box: the chat scrolls to the end so its bubble lands in view, and while a question waits the
    // message is its answer, kept with how many same-text messages the transcript held before it (`entries` is what the
    // pending bubble counts on too). Answering the turn whose deep judge still reads stops it: judging a question that
    // is answered helps nobody (a chip, Cmd/Ctrl+Enter and typed text all come through here).
    const onBoxSent = (text: string) => {
        jumpToBottom();
        const answer = boxAnswerRecord(card, brainstormTopic, text, entries, Date.now());
        if (answer != null) {
            recordBrainstormAnswer(agent.id, answer);
        }
        if (turnKey != null) {
            // does nothing unless the record's deep judge is reading right now
            stopDeepJudge(turnKey);
        }
    };
    // asleep the turn is over too (one read of the transcript holds its reply), so its chips show and a pick wakes it
    const turnOpen = {
        reply,
        idle: agent.state === "idle" || asleep,
        asking,
        questionWaits: questionWaits || pick != null,
        pending: showsPending,
    };
    const askModel = wantsModelSuggest({ ...turnOpen, seen: focusId === agent.id && surface === "agent" });
    useEffect(() => {
        if (askModel && turnKey != null && reply != null) {
            // a Claude agent's arc mod works the replies out in its own claude at the turn's end: wavesrv takes that
            // answer when it comes, and starts a claude of its own only when it does not (pkg/chatsuggest/hook.go)
            requestModelSuggest(turnKey, {
                reply,
                recent,
                question,
                blockid: agent.blockId,
                hook: agent.agent === "claude",
            });
        }
        // the key stands for the reply, and the question with it; the person's messages before it change with the reply
    }, [askModel, turnKey]);
    // The initiative the agent works on, read again at each turn's end (the agent may have ticked its chunk with
    // `wsh effort` meanwhile; the stamp makes an older read stale): its chunk chips (chatsuggest.ts initiativeChips).
    const effortOref = agent.effortId ? `effort:${agent.effortId}` : null;
    const effort = useEffortDetail(effortOref);
    const turnEnded = agent.state === "idle" ? agent.idleSince : undefined;
    useEffect(() => {
        if (effortOref != null && turnEnded != null) {
            loadEffortDetail(effortOref, turnEnded).catch(() => {});
        }
    }, [effortOref, turnEnded]);
    const markDone = (chunk: string) => {
        if (effortOref == null) {
            return;
        }
        fireAndForget(async () => {
            try {
                await markChunkDone(effortOref, chunk, agent.id);
            } catch (e) {
                // markChunkDone can fail after the chunk is done (the agent could not be moved on), so the title is no lie
                pushToast({
                    title: "Mark done didn't finish",
                    message: e instanceof Error ? e.message : String(e),
                    level: "error",
                });
            }
        });
    };
    // The go on with: chip: the agent moves to that chunk first, so the switched line rides in front of the chip's text
    // (spec section 9); a switch that fails sends nothing. A second click while the switch is on its way finds it busy.
    const goingOn = useRef(false);
    const goOn = (chunk: string, text: string) => {
        if (effortOref == null || goingOn.current) {
            return;
        }
        goingOn.current = true;
        // the switch queues its line and the box sends a render later: the waiting line stays hidden until the box has tried
        // the send (it lets go itself, chatcomposer.tsx), so it never draws on this path
        holdSwitchLine(agent.id, true);
        fireAndForget(async () => {
            try {
                await switchAgentChunk(effortOref, agent.id, chunk);
                if (!submitIntoChatBox(agent.id, text)) {
                    // no box took the text: the line waits for the person's next message, as the switch left it
                    holdSwitchLine(agent.id, false);
                }
            } catch (e) {
                holdSwitchLine(agent.id, false);
                pushToast({
                    title: "Could not switch the chunk",
                    message: e instanceof Error ? e.message : String(e),
                    level: "error",
                });
            } finally {
                goingOn.current = false;
            }
        });
    };
    // a cell in a split shows the chips too, from the rules and from an answer already in
    const vi = writesVietnamese(recent);
    // the agent looks finished, by the rule the header's ✓ Close and its sidebar row read (donesuggest.ts): the row
    // offers to close it too, last
    const done = doneSuggestion(
        agent,
        useAtomValue(unreadAgentsAtom).get(agent.id) ?? 0,
        useAtomValue(model.lineageAtom).runs,
        runningBackgroundTasks(useAtomValue(backgroundTasksByIdAtom)[agent.id]).length,
        useAtomValue(runQueueAtom)
    );
    const chips = wantsModelSuggest({ ...turnOpen, seen: true })
        ? judgedChips(
              chatChips({
                  question,
                  rules: question
                      ? []
                      : [
                            ...ruleChips(agent, shipGit, vi),
                            ...initiativeChips(effort, agent.id, agent.committed === true, vi, turnEnded),
                        ],
                  model: modelSuggest,
                  close: closeChip(done, vi),
                  // a yes-or-no question gets its yes and no at once; the model's answers that say more follow them
                  yesNo:
                      question && reply != null && yesNoQuestion(reply)
                          ? yesNoChips(vi || writesVietnamese([reply.slice(-300)]))
                          : undefined,
                  reply: reply ?? undefined,
              }),
              // the judge's pick (the scale) goes first and Cmd/Ctrl+Enter sends it; no record, no change
              judge
          )
        : undefined;
    // The line under the turn's message (chatjudgeline.tsx) is the live one while the chips show: it offers Read the code
    // and pick, Stop or Retry, and with the project known the pane tells the Alt+J key what that is (liveJudgeAtom, which
    // the binding reads: it cannot see this pane's state). The offer goes when the turn changes, the line offers nothing
    // or the pane is gone.
    const liveJudgeKey = chips != null && judge != null ? turnKey : null;
    const liveLine = liveJudgeKey != null && cwd != null ? judgeLine(judge, 0, vi, true) : null;
    const liveAction = liveLine != null && liveLine.state !== "none" ? liveLine.action : undefined;
    useEffect(() => {
        if (liveJudgeKey == null || cwd == null || liveAction == null) {
            return;
        }
        setLiveJudge(agent.id, { key: liveJudgeKey, cwd, action: liveAction });
        return () => setLiveJudge(agent.id, undefined);
    }, [agent.id, liveJudgeKey, cwd, liveAction]);

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
                "absolute bottom-0 left-0 right-0 z-20 flex flex-col bg-background",
                barred ? "top-[26px]" : "top-0"
            )}
        >
            {/* @container: the corner controls stack or sit side by side by this pane's width (FocusReadToggle) */}
            <div className="@container relative min-h-0 flex-1">
                <div
                    ref={scrollRef}
                    onScroll={onScroll}
                    // focusable (not in the Tab order), so a click in the conversation puts the focus there, where focus
                    // read's J/K/Space/Q act (bindings.ts)
                    data-chat-scroller
                    tabIndex={-1}
                    // the bottom padding is the dock's (useDockPadding). The right padding keeps the column (and the pinned
                    // prompt card, which spans it) clear of the Skim and Focus read controls floating in the corner. From a
                    // 912px pane they sit side by side (68px of corner, 76 with a gap), which the centred 760px column already
                    // leaves free, so 22px is enough; narrower they stack in one column (right-3 + 26px = 38px, 46 with a
                    // gap), which the column leaves free down to an 874px pane, the padding growing to 46px as the pane
                    // narrows (874px - 100%), so the text never runs under the stacked pill
                    className="flex h-full flex-col overflow-y-auto pl-[22px] pr-[clamp(22px,calc(874px_-_100%),46px)] outline-none"
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
                                    lostBash={lostBash}
                                    liveReply={liveStreams && !awaitsOwn ? liveReplyAtom(streamId) : undefined}
                                    liveNarrates={narrates}
                                    placeId={placeId}
                                    keyOffset={view!.keyOffset}
                                    catchingUp={catchingUp}
                                    active={lastTurn.active}
                                    working={lastTurn.working}
                                    ownArrives={ownArrives}
                                    onLoadEarlier={hasEarlier ? () => void loadEarlier() : undefined}
                                    onOpenTerminal={asleep ? undefined : () => setChatMode(agent.id, "terminal")}
                                    brainstorm={{
                                        agent,
                                        topic: pairedTopic,
                                        answers: sentAnswers,
                                        card,
                                        state: brainstormState,
                                        model,
                                    }}
                                    model={model}
                                    agent={agent}
                                    cwd={cwd}
                                    liveJudgeKey={liveJudgeKey}
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
                                    starting={startingTitle != null || wakingShown}
                                    onSendNow={sendNow}
                                    onCancel={
                                        sendNow != null && queuedShown ? () => cancelQueuedChat(agent.id) : undefined
                                    }
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
                        {/* the `!` commands run while the agent slept, until a message carries them */}
                        <SleepRunRows agent={agent} entries={entries} />
                        <AnimatePresence initial={false}>
                            {pick != null && reply != null ? (
                                <ChatCanvasPickCard
                                    key={`pick:${reply.length}`}
                                    agent={agent}
                                    pick={pick}
                                    send={(line) => sendToAgent(agent.blockId!, `${line}\r`)}
                                    onSent={() => {
                                        setPickSent(reply);
                                        jumpToBottom();
                                    }}
                                />
                            ) : null}
                        </AnimatePresence>
                        {error != null && view != null ? (
                            <div data-chat-error role="alert" className="text-[12px] leading-[1.5] text-error">
                                Could not read the transcript: {error}
                            </div>
                        ) : null}
                        {/* the empty conversation, or the first message's label, already says the harness is starting */}
                        <AnimatePresence initial={false}>
                            {shownWorking != null && !empty && !opening ? (
                                <WorkingLine key="working" arrive={paneDrawn.current}>
                                    <WorkingGlyph />
                                    <span className="volt-text flex min-w-0">
                                        <span className="min-w-0 truncate shimmer-jarvis">{shownWorking}</span>
                                    </span>
                                    {turn != null ? <TurnStatsText stats={turn} /> : null}
                                </WorkingLine>
                            ) : agent.resuming && agent.state === "idle" && !empty && !opening ? (
                                // a resume still loading: no turn runs, so muted words with the starting dot, not the
                                // working glyph and shimmer
                                <WorkingLine key="resuming" arrive={paneDrawn.current}>
                                    <span
                                        data-chat-resuming
                                        className="flex items-center gap-1.5 text-[12px] text-muted"
                                    >
                                        <span
                                            className="h-[6px] w-[6px] flex-none rounded-full bg-accent pulse-dot"
                                            aria-hidden
                                        />
                                        Resuming…
                                    </span>
                                </WorkingLine>
                            ) : null}
                        </AnimatePresence>
                        <PermissionCard
                            agent={agent}
                            askShown={asking}
                            onOpenTerminal={() => setChatMode(agent.id, "terminal")}
                        />
                        <ScreenDialogCard
                            agent={agent}
                            entries={entries}
                            askShown={asking}
                            onOpenTerminal={() => setChatMode(agent.id, "terminal")}
                        />
                        {asking ? (
                            <div data-chat-ask={agent.id}>
                                <ChatAsk model={model} agent={agent} exited={exited} />
                            </div>
                        ) : null}
                    </div>
                </div>
                {/* floats over the scroller (the pinned prompt bar leaves room for it); not on the loading or empty state */}
                {!loading && !empty ? <SkimToggle /> : null}
                {!loading && !empty ? <FocusReadToggle agentId={agent.id} scrollRef={scrollRef} /> : null}
                {/* focus read's reading line: a short accent tick in the gutter, placed by useFocusRead */}
                {focusRead ? (
                    <div
                        ref={focusTickRef}
                        data-chat-focus-line
                        aria-hidden
                        title={FOCUS_LINE_TITLE}
                        style={{ display: "none" }}
                        className={FOCUS_LINE_CLASS}
                    />
                ) : null}
                {/* the conversation runs out under the box: transparent at the top, the pane's background from DOCK_FADE down
                    (a functional fade, DESIGN.md), clear of the scrollbar so that stays whole; useDockPadding sizes it to
                    the dock, so the strips and chips over the box always sit on the solid part, and shows it only as far as
                    the conversation runs on under the box (none at the end, where it would only dim the last line) */}
                <div
                    ref={fadeRef}
                    data-chat-fade
                    aria-hidden
                    style={{
                        background: `linear-gradient(to bottom, color-mix(in srgb, var(--color-background) 0%, transparent), var(--color-background) ${DOCK_FADE}px)`,
                    }}
                    className="pointer-events-none absolute bottom-0 left-0 right-[10px] h-[190px]"
                />
                {/* The dock: the goal strip and the floating box, the conversation's column. It takes no pointer outside its
                    column. The box is keyed by the agent alone, so its text and its attachments belong to one agent and it
                    is never remounted when the agent sleeps or wakes (its parts fold in place). Asleep its Enter wakes the
                    agent, and it carries data-sleeping-composer on its frame for the scenarios'
                    `[data-sleeping-composer] [data-chat-input]`. */}
                {/* select-none: the dock's strips, chips and labels are chrome, so Cmd+A or a drag over the conversation never
                    paints them; the box itself selects (chateditor.tsx's select-text) */}
                <div
                    ref={dockRef}
                    data-chat-dock
                    className="pointer-events-none absolute inset-x-6 bottom-5 z-10 select-none"
                >
                    <div className="pointer-events-auto relative mx-auto w-full max-w-[720px]">
                        {/* Chat's own jump-to-latest: a ↓ pill naming its key, centred just above the box while the reader is scrolled
                            up; it pops in and out on the spring (the wrapper carries the centring, so the pop's scale is the
                            button's alone). A key that is itself an arrow (⌘↓ on a Mac) would say ↓ twice: the round ↓
                            alone then, its key in the tooltip */}
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
                                        className={cn(
                                            "group flex h-[32px] cursor-pointer items-center justify-center gap-1.5 rounded-full border border-edge-strong bg-surface-raised text-secondary shadow-popover-sm hover:border-accent hover:text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent",
                                            jumpKeyIsArrow ? "w-[32px]" : "pl-[9px] pr-3"
                                        )}
                                    >
                                        <ArrowDown size={14} strokeWidth={2} aria-hidden />
                                        {jumpKeyIsArrow ? null : (
                                            <kbd className="font-sans text-[10.5px] text-muted group-hover:text-secondary">
                                                {formatChordString(CHAT_JUMP_KEYS)}
                                            </kbd>
                                        )}
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
                        {/* the account's usage-limit warning, above the chips (it is about the account,
                            not the turn); only a Claude agent shown in Chat has one */}
                        <ChatLimitStrip model={model} agent={agent} />
                        <ChatComposer
                            key={agent.id}
                            model={model}
                            agent={agent}
                            entries={entries}
                            onSent={onBoxSent}
                            onBoxState={setBoxNow}
                            onShowDiff={() => openDiff(model, agentDiffScope(agent.id, agent.name, agent.agent))}
                            chips={chips}
                            judgeReason={judgeReason(judge)}
                            onMarkDone={markDone}
                            onClose={() => confirmCloseSession(agent, model, "chat chip")}
                            onGoOn={goOn}
                            onSendNow={queuedShown ? sendNow : undefined}
                            questionWaits={questionWaits}
                            onLocal={(route) => {
                                if ("open" in route) {
                                    openDiff(model, agentDiffScope(agent.id, agent.name, agent.agent));
                                } else {
                                    showLocalCard(agent.id, route.panel, route.command);
                                }
                            }}
                            placeholder={boxPlaceholder(boxNow, agent.name, boxPlaceholderOverride(card), wakingNow)}
                            dataAttrs={asleep ? { "data-sleeping-composer": agent.id } : undefined}
                        />
                    </div>
                </div>
            </div>
        </div>
    );
}
