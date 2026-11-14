// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0
//
// The message box of the chat view (a Claude agent's cell in Chat, and its sleeping overlay): the board's floating pill
// (chatpane.tsx lays it over the conversation) with the text on top and, under it, one row: the round `+` menu
// (chatplusmenu.tsx: add files, a folder, a slash command, MCP servers, plugins) and the model, mode and context pills
// (chatfooter.tsx) on the left, Stop and a round Send on the right. That row's parts fold in place when the agent sleeps
// or wakes. The box is one object that changes shape by state (chatboxstate.ts: idle, running, drop, suggest, bash,
// asleep): its root is `data-chat-box` carrying `data-chat-box-state`, its height springs to its content's measured height,
// and the parts of a state cross-fade on the micro ease: a running agent adds a line of action chips and puts Stop where
// Send was (Send stays beside it once there is a message to send), a finished turn's suggested replies take that line
// while the person types too (chatsuggest.ts), a drag of files turns the box into a dashed drop zone.
// What it sends and how a sleeping agent is woken is
// useAgentSend's (agentcomposer.tsx), the same path as the compact composer; this adds attachments
// (composerattachments.ts: a pasted or dropped image is kept and goes as the "Attached images:" block your bubble draws
// as a picture; Ctrl+U, Cmd+U on a Mac, opens the file dialog), the `/` command menu (slashmenu.tsx) and the `@` file
// picker (filemention.tsx), Stop, and the look. A text that starts with `!` is a bash command (chatmodel.ts `bashMode`): the
// box draws it in a shell well under a "Bash" caption, with the newest `!` command of Claude Code's history that starts so
// as grey ghost text, which → or Tab takes (chatbash.ts has the rules, chatbashstore.ts the history); with no ghost text
// Tab completes the word under the caret (commands, `$variables`, files) in a list over the box (bashcomplete.tsx). Callers key it by agent id:
// its text and its attachments are local to the box.
//
// The text is a small Lexical editor (chateditor.tsx) that draws a file you @-mentioned as a pill, but the plain text
// stays the source of truth: `text` is the message as the agent receives it, and everything here (the menus, recall, the
// insert registry, the send) works on that string and offsets in it, through the editor's handle (`editorRef`), which
// answers like the part of a textarea they use.
//
// While the agent has background work running (shells, Monitors, background subagents), a line at the box's top names it
// and unfolds into the list (chatbgline.tsx).

import { pushToast } from "@/app/cockpit/notificationstore";
import { microFade, MOTION, springReveal, turnTransition } from "@/app/element/motiontokens";
import * as WOS from "@/app/store/wos";
import { RpcApi } from "@/app/store/wshclientapi";
import { TabRpcClient } from "@/app/store/wshrpcutil";
import { focusTerm } from "@/app/view/term/termpaste";
import { isMacOS } from "@/util/platformutil";
import { cn, fireAndForget, stringToBase64 } from "@/util/util";
import { atom, useAtomValue, type Atom } from "jotai";
import {
    ArrowRight,
    ArrowUp,
    ArrowUpFromLine,
    Check,
    CornerDownLeft,
    Diamond,
    FileDiff,
    GitCommitHorizontal,
    Moon,
    Terminal,
    X,
    type LucideIcon,
} from "lucide-react";
import { AnimatePresence, motion, MotionConfig, useReducedMotion } from "motion/react";
import { useEffect, useLayoutEffect, useMemo, useRef, useState, type DragEvent } from "react";
import { canStop, useAgentSend } from "./agentcomposer";
import type { AgentsViewModel } from "./agents";
import { sleepingLine, wakeAgent, wakeErrorToast } from "./agentsleep";
import { submitToAgent } from "./agentsubmit";
import type { AgentEntry, AgentVM } from "./agentsviewmodel";
import { AttachmentTray } from "./attachmenttray";
import { useBashComplete } from "./bashcomplete";
import { bashGhost } from "./chatbash";
import { noteBashRun, useBashHistory } from "./chatbashstore";
import { ChatBgLine } from "./chatbgline";
import { boxState, type BoxState } from "./chatboxstate";
import { ChatEditor, type EditorLike, type KeyLike } from "./chateditor";
import { ChatFooter, Fold, usePartMotion } from "./chatfooter";
import {
    dropSwitchLine,
    holdSwitchLine,
    putBackResultLines,
    takeResultLines,
    usePendingSwitch,
    useSwitchLineHeld,
} from "./chatinitiativestore";
import { insertAt, registerChatBox, registerChatInsert } from "./chatinsert";
import { answersInChat, localCommand, type LocalRoute } from "./chatlocal";
import { clearLocalCards } from "./chatlocalstore";
import { bashMode } from "./chatmodel";
import { setChatMode } from "./chatmodestore";
import {
    holdLine,
    isSendNowKey,
    pendingStill,
    pendsAsBubble,
    recall,
    releasesHeld,
    sendHold,
    type SendFailure,
} from "./chatpending";
import {
    addPending,
    dropPending,
    getPending,
    noteSent,
    sentHistory,
    setHeldSend,
    useHeldSend,
} from "./chatpendingstore";
import { ChatPlusMenu } from "./chatplusmenu";
import {
    rowHold,
    runningActions,
    type ChatChip,
    type ChipKind,
    type ChipRowKind,
    type RunningActions,
} from "./chatsuggest";
import { mergeTaken, takeBackPlan, takenBackOf } from "./chattakeback";
import { noteTakenBack, takeBack } from "./chattakebackstore";
import { attachmentBlocker, useComposerAttachments } from "./composerattachments";
import { fallAsleepLabel } from "./fallasleepstore";
import { useFileMention } from "./filemention";
import { chatFilesRoot, recentMentionPaths } from "./launchermention";
import { isPathsDrag, pathsFromDrop } from "./pathdrop";
import { permissionBoxKey } from "./permissionmodel";
import { permissionCardKey, usePermission } from "./permissionstore";
import { projectsAtom } from "./projectsstore";
import { opensTui } from "./slashcommands";
import { useSlashMenu } from "./slashmenu";

// two lines, as the board's box; grows as the text wraps, then scrolls
const ChatMinH = 38;
const ChatMaxH = 200;
// in bash mode the editor sits in a well with 8px of padding above and below, so one line of it is about the box's height
const ChatBashMinH = 25;

const dragHasFiles = (dt: DataTransfer | null) => Array.from(dt?.types ?? []).includes("Files");
// a drag that may name files by path (pathsFromDrop decides at the drop, when the data is readable)
const dragNamesPaths = (dt: DataTransfer | null) => {
    const types = Array.from(dt?.types ?? []);
    return isPathsDrag(types) || types.includes("text/uri-list");
};

const NO_BLOCK: Atom<Block | undefined> = atom(undefined as Block | undefined);
const NO_CHIPS: ChatChip[] = [];
const NO_ACTS: RunningActions = { diff: false, terminal: false, terminalAt: null };

let picking = false; // the native dialog takes a moment to appear; a second click must not open another

async function pickPaths(): Promise<string[]> {
    if (picking) {
        return [];
    }
    picking = true;
    try {
        const { open } = await import("@tauri-apps/plugin-dialog");
        const picked = await open({ multiple: true, title: "Attach files" });
        return Array.isArray(picked) ? picked : typeof picked === "string" ? [picked] : [];
    } catch (err) {
        console.error("chat composer: file picker failed", err);
        pushToast({ title: "Couldn't open the file picker", message: String(err), level: "error" });
        return [];
    } finally {
        picking = false;
    }
}

// how long after an Esc that stopped a turn another Esc is swallowed, while the agent's state catches up
const INTERRUPT_SETTLE_MS = 1_500;

// the box's content height while it is a drop zone: the board's dashed zone is 120px high in an 8px margin
const DropMinH = 136;

/** The box, with the line that waits over it after the initiative band moved the agent to another chunk. The line is not
 *  in the box: the box's height is its content's, and this line is no part of what the box holds. */
export function ChatComposer(props: Parameters<typeof ComposerBox>[0]) {
    return (
        <>
            <SwitchLine agent={props.agent} />
            <ComposerBox {...props} />
        </>
    );
}

// The switched line (chatinitiativestore.ts) goes in front of the next plain message, which is the person's next send, so
// it shows over the box until then; ✕ drops it and leaves the switch in place. A wake send leaves the waiting lines for the
// next message (takeResultLines in ComposerBox), so an asleep box says nothing yet. A `go on with:` click switches the chunk
// and sends the chip's text at once, so its line is held back (holdSwitchLine) and never draws on that path.
function SwitchLine({ agent }: { agent: AgentVM }) {
    const switched = usePendingSwitch(agent.id);
    const held = useSwitchLineHeld(agent.id);
    const part = usePartMotion(springReveal);
    return (
        <AnimatePresence initial={false}>
            {switched != null && !held && agent.sleeping == null ? (
                <motion.div key="switch" {...part} className="overflow-hidden">
                    <div
                        data-chat-switch-line=""
                        role="status"
                        className="flex items-center gap-2 pb-2 pl-[18px] pr-3 text-[12px] text-muted"
                    >
                        <Diamond size={12} strokeWidth={1.8} aria-hidden className="flex-none" />
                        <span className="min-w-0 truncate">
                            Goes with your next message: switched to chunk {switched.n} {switched.label}
                        </span>
                        <button
                            type="button"
                            data-chat-switch-drop=""
                            aria-label="Drop the switch line"
                            title="Drop it: the agent is not told of the switch"
                            onClick={() => dropSwitchLine(agent.id)}
                            className="flex size-[20px] flex-none cursor-pointer items-center justify-center rounded-[5px] border-0 bg-transparent p-0 text-ink-mid hover:text-primary"
                        >
                            <X size={12} strokeWidth={1.8} aria-hidden />
                        </button>
                    </div>
                </motion.div>
            ) : null}
        </AnimatePresence>
    );
}

function ComposerBox({
    model,
    agent,
    placeholder,
    dataAttrs,
    entries,
    onSent,
    onBoxState,
    onShowDiff,
    chips,
    onMarkDone,
    onGoOn,
    onLocal,
    onSendNow,
    questionWaits,
}: {
    model: AgentsViewModel;
    agent: AgentVM;
    placeholder: string;
    /** the conversation as drawn: a send of an awake agent is shown as a pending bubble until the transcript holds it.
     *  The sleeping overlay passes none (a wake delivers the message, no bubble stands in for it). */
    entries?: AgentEntry[];
    /** called as soon as a message is taken (a wake send too), before its pending bubble is added, with the text that
     *  went to the agent (a bare panel command Chat answers itself, and a command the + menu types, pass theirs): the chat
     *  scrolls to the end, so the bubble lands in view even when the reader had scrolled up */
    onSent?: (text: string) => void;
    /** the box's state (chatboxstate.ts) whenever it changes, and once as the box mounts: the pane words the empty box's
     *  placeholder from it */
    onBoxState?: (state: BoxState) => void;
    /** the running agent's "Show the diff" chip; left out, the chip is not drawn */
    onShowDiff?: () => void;
    /** the replies suggested once the turn ended (chatsuggest.ts chatChips), drawn as chips, typing or not; a
     *  click sends one (asking first over typed text). Left out, none. */
    chips?: ChatChip[];
    /** a chunk's done chip: ticks it on the agent's initiative. Left out, that chip is not drawn. */
    onMarkDone?: (chunk: string) => void;
    /** a "go on with: <chunk>" chip: moves the agent to the chunk, then sends the chip's text (the caller does both, so a
     *  switch that fails sends nothing). Left out, that chip is sent as typed. */
    onGoOn?: (chunk: string, text: string) => void;
    /** a bare /usage, /tasks, /diff… typed in the box (chatlocal.ts): Chat answers it instead of sending it. Left out,
     *  every command is sent. */
    onLocal?: (route: LocalRoute) => void;
    /** a queued message's Send now, while one shows: Ctrl+Enter (Cmd+Enter on a Mac) in an empty box presses it. A box
     *  with text sends it as Enter does: the chord could reach the terminal before the text was typed in */
    onSendNow?: () => void;
    /** a brainstorm question's card waits on an answer (chatbrainstormwire.ts boxPlaceholderOverride): what is typed is that
     *  answer, which the card pairs with the transcript by exact text, so no initiative result line goes in front of it */
    questionWaits?: boolean;
    /** extra data attributes on the box: the sleeping overlay keeps `data-sleeping-composer` there */
    dataAttrs?: Record<`data-${string}`, string>;
}) {
    const asleep = agent.sleeping != null;
    // the text and the chips are kept per agent outside the box, so switching to another agent or surface (which
    // unmounts it) and back finds what you were writing
    const att = useComposerAttachments({ keep: true, draftKey: agent.id });
    // flips the pane to the agent's terminal with the keyboard in it
    const showTerminal = () => {
        setChatMode(agent.id, "terminal");
        const blockId = agent.blockId;
        if (blockId != null) {
            requestAnimationFrame(() => focusTerm(blockId));
        }
    };
    // Asleep the attachments ride the wake's message as they ride any other: a pasted file is already on disk (wavesrv
    // wrote it), and the message reaches the agent once it is back. Their chips go only when the wake took the message,
    // so a wake that failed keeps them with the text. `wakeSent` is the chips that went with the wake in flight.
    const wakeSent = useRef<string[]>([]);
    const { text, setText, message, canSend, waking, fallingAsleep, send } = useAgentSend(
        agent.blockId,
        agent,
        att.attachments,
        {
            onWoken: () => {
                for (const id of wakeSent.current) {
                    att.remove(id);
                }
                wakeSent.current = [];
            },
            keepDraft: true,
            // a /btw no mod took was typed into the terminal, where Claude Code answers it on its own screen: show that
            onBtwTyped: (sent) => {
                dropPending(agent.id, sent);
                showTerminal();
            },
        }
    );
    // a Sleep under way (fallasleepstore): the box is shut until the agent sleeps, and says what is happening
    const dozing = fallingAsleep != null;
    // asleep with nothing to send, Send is Wake: it relaunches the agent with no message (the card over the terminal
    // that offered it gave its place to this box)
    const wakeOnly = asleep && !waking && message === "";
    const wakeBare = () =>
        fireAndForget(async () => {
            try {
                await wakeAgent(agent.id);
            } catch (e) {
                wakeErrorToast(agent.name, e);
            }
        });
    // `!` first: Claude Code runs the text as a bash command, so the box says so as its own box does (chatmodel.ts)
    const bash = bashMode(text);
    const editorRef = useRef<EditorLike>(null);
    // The text the box was last given or said (every edit goes out through `onChange`, which skips a call that changes
    // nothing: a click that only moves the caret says the same text again), and the caret an outside change asks for
    // (setTextAt): the editor places it as it draws the text, and a mention it ends stays text rather than a pill.
    const told = useRef(text);
    told.current = text;
    const outsideCaret = useRef<{ text: string; caret: number } | null>(null);
    const setTextAt = (t: string, caret?: number) => {
        outsideCaret.current = caret == null ? null : { text: t, caret };
        told.current = t;
        setText(t);
    };
    const block = useAtomValue(
        agent.blockId ? WOS.getWaveObjectAtom<Block>(WOS.makeORef("block", agent.blockId)) : NO_BLOCK
    );
    const projects = useAtomValue(projectsAtom);
    // ↑ / ↓ walk what was sent from this box. `at` is the place in the history; `shown` the text recall put in the box,
    // so an edit (the text no longer equal to it) ends the recall.
    const recalled = useRef<{ at: number | null; shown: string }>({ at: null, shown: "" });
    // the whole message box: the frosted suggestion panels (the `/` and `@` lists) stand just above it as wide as it is,
    // and Tab's list in bash mode opens over it
    const boxRef = useRef<HTMLDivElement>(null);
    // a `/` as the box's first character lists Claude Code's commands; a recalled "/compact" is a message to resend, not
    // a command being typed, so the menu stays closed over it until it is edited
    const slash = useSlashMenu({
        text,
        setText: setTextAt,
        cwd: block?.meta?.["cmd:cwd"] ?? "",
        blockId: agent.blockId,
        inputRef: editorRef,
        off: recalled.current.at != null && text === recalled.current.shown,
        look: "frosted",
        frame: boxRef,
        // the box answers /usage, /context… itself only when Chat takes local commands, and a pick of one runs it at once:
        // it goes through the one send path, as Enter on the typed command would
        inChat: onLocal != null ? answersInChat : undefined,
        onRun: (name) => {
            const typed = `/${name}`;
            if (typed === text) {
                submitRef.current();
                return;
            }
            submitNext.current = true;
            setTextAt(typed);
        },
    });
    const cwd = block?.meta?.["cmd:cwd"];
    // Bash mode's ghost text (as Claude Code's TUI has it): the newest `!` command from its history that starts with what
    // is typed, shown after the caret at the end of the text. `saidCaret` is the caret the editor last said, with its text;
    // a text that came from outside (a recall, a pick, the ghost taken) has the caret where setTextAt put it, or at the end.
    const [saidCaret, setSaidCaret] = useState({ text, caret: text.length });
    const bashHistory = useBashHistory(cwd, bash);
    const caretNow =
        saidCaret.text === text
            ? saidCaret.caret
            : outsideCaret.current?.text === text
              ? outsideCaret.current.caret
              : text.length;
    // Tab completes the word under the caret in bash mode: one answer is put in the text, several open a list over the box
    const bashList = useBashComplete({ text, setText: setTextAt, cwd, inputRef: editorRef, boxRef, on: bash });
    // the ghost text steps aside while the Tab list is open, so → and Tab do not offer two things at once
    const ghost = bash && !waking && !bashList.shown ? bashGhost(bashHistory, text, caretNow) : "";
    const filesRoot = chatFilesRoot(cwd, agent.project, projects);
    // the files this agent read or wrote lead the `@` list, newest first
    const recentFiles = useMemo(() => recentMentionPaths(entries, filesRoot), [entries, filesRoot]);
    const mention = useFileMention({
        // a bash command has no @mentions: the picker is shut while the text starts with `!`
        text: bash ? "" : text,
        setText: setTextAt,
        filesRoot,
        cwd,
        inputRef: editorRef,
        name: "chat",
        recent: recentFiles,
        look: "frosted",
        frame: boxRef,
    });
    // An Alt-drop's @mention lands here (chatinsert.ts): at the caret, through the text state, which the editor draws
    // from; the caret is put after it once the new text is drawn.
    const latest = useRef({ text, setText: setTextAt });
    latest.current = { text, setText: setTextAt };
    const caretAfter = useRef<number | null>(null);
    useEffect(
        () =>
            registerChatInsert(agent.id, (insert) => {
                const box = editorRef.current;
                if (box == null || box.readOnly) {
                    return false;
                }
                const next = insertAt(latest.current.text, box.selectionStart, box.selectionEnd, insert);
                caretAfter.current = next.caret;
                latest.current.setText(next.text, next.caret);
                box.focus({ preventScroll: true });
                return true;
            }),
        [agent.id]
    );
    useLayoutEffect(() => {
        const caret = caretAfter.current;
        const box = editorRef.current;
        if (caret != null && box != null) {
            caretAfter.current = null;
            box.setSelectionRange(caret, caret);
            // the menus read the caret from events, and a caret set from code may raise none before the next key: a `/`
            // put in the box by the + menu opens the `/` list at once
            slash.onCaret(box);
            mention.onCaret(box);
        }
    }, [text]);
    // A visual in the conversation (chatvisualview.tsx) reads the box, sends a text through it and appends to it. A send
    // puts the text in the box and submits once the box shows it, so it takes the one send path below (wake, holds,
    // pending bubble, scroll); `submitNext` is set only when the text will change, so it never outlives that render.
    const submitNext = useRef(false);
    const submitRef = useRef<() => void>(() => {});
    const interruptRef = useRef<() => boolean>(() => false);
    useEffect(
        () =>
            registerChatBox(agent.id, {
                text: () => latest.current.text,
                submit: (sent) => {
                    const box = editorRef.current;
                    if (box == null || box.readOnly) {
                        return false;
                    }
                    if (sent === latest.current.text) {
                        submitRef.current();
                        // the send was tried: a `go on with:` click's hold on the waiting line ends (a line the send did
                        // not take is the one that waits for the next message)
                        holdSwitchLine(agent.id, false);
                        return true;
                    }
                    submitNext.current = true;
                    latest.current.setText(sent);
                    return true;
                },
                append: (added) => {
                    const box = editorRef.current;
                    if (box == null || box.readOnly) {
                        return false;
                    }
                    // the end of the box, never the caret: the person may be typing elsewhere in it
                    const cur = latest.current.text;
                    latest.current.setText(cur.trim() ? cur.replace(/\s+$/, "") + "\n" + added : added);
                    return true;
                },
                focus: () => {
                    const box = editorRef.current;
                    if (box == null || box.readOnly) {
                        return false;
                    }
                    box.focus({ preventScroll: true });
                    return true;
                },
                replace: (t) => {
                    const box = editorRef.current;
                    if (box == null || box.readOnly) {
                        return false;
                    }
                    recalled.current = { at: null, shown: "" };
                    caretAfter.current = t.length;
                    latest.current.setText(t, t.length);
                    box.focus({ preventScroll: true });
                    return true;
                },
                interrupt: () => interruptRef.current(),
            }),
        [agent.id]
    );
    // appendAttachments leaves out an upload in flight and a failed one: sending past them would drop a file unannounced
    const blocker = attachmentBlocker(att.attachments);
    // Typed into a permission prompt or a question, a message's first digit would pick an option: the send waits. Send
    // then queues the message (`held`, kept per agent while the box unmounts for the terminal), and it goes by itself
    // once the prompt is answered.
    const permissionOref = agent.blockId != null ? `block:${agent.blockId}` : undefined;
    const permission = usePermission(permissionOref);
    const hold = asleep ? null : sendHold(permission.length > 0, agent.ask != null && !agent.ask.hold);
    const held = useHeldSend(agent.id);
    const ready = canSend && blocker == null;
    const sendable = ready && hold == null;
    const holdText = holdLine(hold, held);
    // a bare /model, /config… draws a menu on Claude Code's own screen: show that screen to answer it
    const flipIfTui = (sent: string) => {
        if (opensTui(sent, slash.commands)) {
            showTerminal();
        }
    };
    const submit = () => {
        // a bare /usage, /tasks… is Chat's to answer (chatlocal.ts): nothing goes to the agent, so it needs no process
        // and wakes no sleeping one, and the attachments stay for the next message
        const local = onLocal != null && att.attachments.length === 0 ? localCommand(text) : null;
        if (local != null && !waking) {
            onSent?.(local.command);
            recalled.current = { at: null, shown: "" };
            noteSent(agent.id, local.command);
            setTextAt("");
            onLocal(local);
            return;
        }
        if (hold != null && ready) {
            setHeldSend(agent.id, true);
            return;
        }
        if (wakeOnly && att.attachments.length === 0) {
            wakeBare();
            return;
        }
        if (!sendable) {
            return;
        }
        const sent = message;
        const riding = att.attachments.map((a) => a.id);
        // What became of the cards the person handled (chatinitiativestore.ts) goes in front of their next plain message
        // only: a /command or /btw (a line before one breaks it), a `!` command, a wake send, and an answer typed while a
        // brainstorm question waits (its record pairs with the transcript by exact text) leave the lines queued for the
        // next one. `sent` and everything kept of it (recall, the pending bubble, onSent) stay the person's own text.
        const lines = !asleep && !questionWaits && !bash && !sent.startsWith("/") ? takeResultLines(agent.id) : [];
        // the paths of the files riding the message, put back as chips if it never reaches Claude Code
        const ridingPaths = att.attachments.map((a) => a.path).filter((p): p is string => p != null);
        const agentId = agent.id;
        // a send that failed on its way to Claude Code (useAgentSend put the text back and toasted): its Queued bubble
        // goes, and what rode along comes back, unless the text waits in Claude Code's box (only the Enter failed)
        const onFailed = (f: SendFailure) => {
            dropPending(agentId, sent);
            if (!f.restore) {
                return;
            }
            if (lines.length > 0) {
                putBackResultLines(agentId, lines);
            }
            if (ridingPaths.length > 0) {
                att.addPaths(ridingPaths);
            }
        };
        const taken = send(lines, onFailed);
        if (!taken && lines.length > 0) {
            putBackResultLines(agent.id, lines);
        }
        if (taken) {
            if (asleep) {
                wakeSent.current = riding;
            }
            onSent?.(sent);
            recalled.current = { at: null, shown: "" };
            noteSent(agent.id, sent);
            // a command run moves to the front of the ghost text's list, as Claude Code moves it in its own history
            if (bash) {
                noteBashRun(cwd, text.slice(1).trim());
            }
            // going on closes Chat's own cards, as a panel on Claude Code's screen closes
            clearLocalCards(agent.id);
            if (!asleep) {
                // a /command is no bubble of yours: the transcript draws it as a command row, which would leave the
                // pending bubble up beside it for minutes. A /btw, a bare panel command and a `! cmd` are: nothing of
                // them lands until the side answer comes, the panel closes or the command finishes (chatpending.ts
                // pendingKind)
                if (entries != null && pendsAsBubble(sent)) {
                    addPending(agent.id, sent, entries, agent.state !== "idle");
                }
                flipIfTui(sent);
                for (const a of att.attachments) {
                    att.remove(a.id);
                }
            }
        }
    };
    submitRef.current = submit;
    useEffect(() => {
        if (submitNext.current) {
            submitNext.current = false;
            submit();
            holdSwitchLine(agent.id, false);
        }
    }, [text]);
    // the queued message goes as soon as its prompt is answered; a box emptied meanwhile has nothing left to queue
    useEffect(() => {
        if (releasesHeld(held, hold, sendable)) {
            setHeldSend(agent.id, false);
            submit();
        } else if (held && !waking && text.trim() === "" && att.attachments.length === 0) {
            setHeldSend(agent.id, false);
        }
    }, [held, hold, sendable, text, att.attachments.length]);
    // The + menu's MCP servers and Plugins rows: a one-line command typed into the terminal, as the send path types it
    // (useAgentSend), without touching the box's own text or its attachments. It waits behind a permission prompt or a
    // question as Send does.
    const sendCommand = (command: string) => {
        const blockid = agent.blockId;
        if (asleep || waking || dozing || blockid == null) {
            return;
        }
        if (hold != null) {
            pushToast({ title: "Not sent", message: hold, level: "info" });
            return;
        }
        fireAndForget(() => submitToAgent(blockid, command));
        onSent?.(command);
        noteSent(agent.id, command);
        flipIfTui(command);
    };
    // A suggested reply's chip: its text goes through the box's own send, as Enter on it typed would (the pending bubble,
    // the card results in front of it, the wait behind a prompt), so the chips leave at once and a second click finds none
    // Over text the person has typed it sends nothing yet: a warning toast says that text would go, and its Send sends.
    const sendNow = (t: string) => {
        submitNext.current = true;
        setTextAt(t);
    };
    const sendSuggested = (t: string) => {
        if (text.trim() === "") {
            sendNow(t);
            return;
        }
        pushToast({
            title: "Replace what you typed?",
            message: `Sending “${t}” drops the text in the box.`,
            level: "warn",
            action: { label: "Send", run: () => sendNow(t) },
        });
    };
    // The + menu's Add folder and Slash commands rows: an empty box becomes `t`; a box that already starts with `/` is
    // a command being written and stays as it is; any other text gets `t` put before it. The box takes the focus, the
    // caret right after `t` when it was put in (so a lone `/` opens the `/` menu), where it was otherwise.
    const putText = (t: string) => {
        const box = editorRef.current;
        if (box == null || box.readOnly) {
            return;
        }
        if (!text.startsWith("/")) {
            recalled.current = { at: null, shown: "" };
            caretAfter.current = t.length;
            setTextAt(text === "" ? t : t + text, t.length);
        }
        box.focus();
    };
    // ↑ in an empty box (or one still showing a recalled text, unedited, with the caret on its first line) puts back the
    // last message sent; ↓ walks forward and back to empty. True when the key was taken.
    const recallKey = (e: KeyLike): boolean => {
        const dir = e.key === "ArrowUp" ? "up" : e.key === "ArrowDown" ? "down" : null;
        const box = e.currentTarget;
        if (
            dir == null ||
            e.shiftKey ||
            e.altKey ||
            e.ctrlKey ||
            e.metaKey ||
            box.readOnly ||
            e.nativeEvent.isComposing
        ) {
            return false;
        }
        // ↑ in an empty box takes back the messages queued in Claude Code first, as ↑ in its own box does
        if (dir === "up" && text === "" && takeBackKey("ArrowUp")) {
            return true;
        }
        const r = recalled.current;
        const empty = text === "";
        const editing = r.at != null && text === r.shown;
        if (!empty && !editing) {
            return false;
        }
        if (!empty) {
            const caretLine =
                dir === "up"
                    ? !text.slice(0, box.selectionStart).includes("\n")
                    : !text.slice(box.selectionEnd).includes("\n");
            if (!caretLine) {
                return false;
            }
        }
        const history = sentHistory(agent.id);
        if (history.length === 0) {
            return false;
        }
        const next = recall(history, r.at, dir);
        recalled.current = { at: next.at, shown: next.text };
        setTextAt(next.text);
        return true;
    };
    // Esc, or ↑ in an empty box: a message Claude has not taken or answered yet comes back into the box
    // (chattakeback.ts), put ahead of what the box holds. False when there is none: the key keeps its old job
    const takeBackKey = (key: "Escape" | "ArrowUp"): boolean => {
        const blockid = agent.blockId;
        if (blockid == null || asleep) {
            return false;
        }
        const plan = takeBackPlan(
            key,
            pendingStill(getPending(agent.id), entries ?? [], Date.now()),
            entries,
            agent.state
        );
        if (plan == null) {
            return false;
        }
        // an Esc's message may be in the transcript already: the record is kept as the text comes back, in the same tick,
        // so its bubble goes as the text lands in the box (chattakeback.ts withoutTakenBack)
        const held = entries ?? [];
        fireAndForget(async () => {
            await takeBack(agent.id, blockid, plan, (texts) => {
                if (plan.kind === "interrupt") {
                    noteTakenBack(agent.id, takenBackOf(plan, held, Date.now()));
                    // a message that had landed still has its sent record: with the record hidden it would read as not
                    // arrived and draw its pending bubble again (a pending one went with plan.ids)
                    if (plan.ids.length === 0) {
                        for (const t of texts) {
                            dropPending(agent.id, t);
                        }
                    }
                }
                latest.current.setText(mergeTaken(texts, latest.current.text), texts.join("\n").length);
            });
        });
        return true;
    };
    const stop = () => {
        const blockid = agent.blockId;
        if (blockid == null) {
            return;
        }
        fireAndForget(() =>
            RpcApi.ControllerInputCommand(TabRpcClient, { blockid, inputdata64: stringToBase64("\x1b") })
        );
    };
    // Esc while Claude works stops the turn, as Esc in Claude Code's own box does: a message it has not taken or answered
    // yet comes back into the box (chattakeback.ts), else the turn just stops. A second Esc while the first one lands is
    // swallowed: two reaching Claude Code once it is idle would open its rewind menu. False when it is not working, so
    // the key keeps its old job (the box lets go of the keys, or the surface goes back).
    const interruptedAt = useRef(0);
    const interrupt = (): boolean => {
        if (agent.state !== "working" || asleep || agent.blockId == null) {
            return false;
        }
        const now = Date.now();
        if (now - interruptedAt.current < INTERRUPT_SETTLE_MS) {
            return true;
        }
        interruptedAt.current = now;
        if (!takeBackKey("Escape")) {
            stop();
        }
        return true;
    };
    interruptRef.current = interrupt;
    const attach = () => {
        fireAndForget(async () => {
            const paths = await pickPaths();
            if (paths.length > 0) {
                att.addPaths(paths);
            }
            editorRef.current?.focus();
        });
    };
    // A drag of files over the box, awake or asleep, turns it into the drop zone. dragenter and dragleave fire for every
    // child the drag crosses, so `dragDepth` counts the enters not yet left: the zone goes when the count is back to zero
    // (the drag left the box), and a drop or a dragend ends it at once. A dragover alone starts it too, so a box that
    // missed the enter (the drag began over it) still shows the zone.
    const [dragging, setDragging] = useState(false);
    const dragDepth = useRef(0);
    const endDrag = () => {
        dragDepth.current = 0;
        setDragging(false);
    };
    useEffect(() => {
        if (!dragging) {
            return;
        }
        // a drop elsewhere, or a drag cancelled with Escape, may never raise a dragleave on the box
        window.addEventListener("drop", endDrag, true);
        window.addEventListener("dragend", endDrag, true);
        return () => {
            window.removeEventListener("drop", endDrag, true);
            window.removeEventListener("dragend", endDrag, true);
        };
    }, [dragging]);
    const offersFiles = (dt: DataTransfer | null) => dragHasFiles(dt) || dragNamesPaths(dt);
    const onDragEnter = (e: DragEvent<HTMLElement>) => {
        if (offersFiles(e.dataTransfer)) {
            dragDepth.current++;
            setDragging(true);
        }
    };
    const onDragLeave = () => {
        if (dragDepth.current > 0 && --dragDepth.current === 0) {
            setDragging(false);
        }
    };
    // the webview's own drag-drop is off, so a file dropped unhandled would navigate it to the file: any drag that holds
    // files is taken here
    const onDragOver = (e: DragEvent<HTMLElement>) => {
        if (offersFiles(e.dataTransfer)) {
            e.preventDefault();
            e.dataTransfer.dropEffect = "copy";
            dragDepth.current = Math.max(dragDepth.current, 1);
            setDragging(true);
        }
    };
    // Explorer hands over real files (copied, as a paste is); arcterm's tree, VS Code, Obsidian and "Copy as path"
    // hand over paths as text, which the box would otherwise take as typed text: those attach in place
    const onDrop = (e: DragEvent<HTMLElement>) => {
        endDrag();
        const dt = e.dataTransfer;
        if (dragHasFiles(dt)) {
            e.preventDefault();
            att.addFiles(Array.from(dt.files));
            return;
        }
        const paths = pathsFromDrop(Array.from(dt.types), (type) => dt.getData(type));
        if (paths == null || paths.length === 0) {
            return;
        }
        e.preventDefault();
        e.stopPropagation();
        att.addPaths(paths);
        editorRef.current?.focus();
    };
    // not while a Sleep is under way: Esc would cut short the compaction the sleep waits on
    const showStop = !asleep && !dozing && agent.blockId != null && canStop(agent.state, agent.sleeping);
    // the finished turn's suggested replies: they stay while the person types (a click over typed text asks first,
    // sendSuggested) and step aside once an attachment goes in
    const suggested = chips != null && !asleep && !waking && !dozing && att.attachments.length === 0 ? chips : NO_CHIPS;
    // the running agent's actions that have something to show (chatsuggest.ts runningActions): the diff once the turn
    // edited a file, the terminal once a command has run a while; read again when a running command gets there
    const acts = showStop ? runningActions(entries ?? [], Date.now()) : NO_ACTS;
    const [, tick] = useState(0);
    useEffect(() => {
        if (acts.terminalAt == null) {
            return;
        }
        const t = setTimeout(() => tick((n) => n + 1), Math.max(0, acts.terminalAt - Date.now()) + 50);
        return () => clearTimeout(t);
    }, [acts.terminalAt]);
    // the chip line: those actions while the agent works, else the replies; a change to or from the actions shows once
    // the agent's state has held it (chatsuggest.ts rowHold), so a state that flips and comes back leaves the line alone
    const row = useChipRow({
        kind: showStop && (acts.diff || acts.terminal) ? "actions" : suggested.length > 0 ? "suggest" : "none",
        chips: suggested,
        diff: acts.diff,
        terminal: acts.terminal,
    });
    // Send is a word asleep and while the wake is in flight. The word stays what it last was while it fades out, so a
    // finished wake does not swap "Waking…" for "Send" under the eye.
    const showWord = asleep || waking;
    const sendWord = useRef("Send");
    if (showWord) {
        sendWord.current = waking ? "Waking…" : wakeOnly ? "Wake" : "Send";
    }
    // Stop takes Send's place while the agent works and there is nothing to send; a message ready to go brings Send back
    // beside it (a running agent queues what is sent), so a box with text never loses its way to send
    const showSend = !(showStop && !ready);
    // the box's shape (chatboxstate.ts): the root says it, and the pane words the empty box from it
    const state = boxState({
        asleep,
        running: showStop,
        dragging,
        suggesting: slash.shown || mention.shown,
        bash,
    });
    useLayoutEffect(() => {
        onBoxState?.(state);
    }, [state]);
    // The box's height springs to its content's measured height, so a state that adds or drops a line (the action chips,
    // the drop zone, a wrapping text) opens and closes the box instead of snapping it. The content sits at the bottom of
    // the box (justify-end), so Send and the row stay put while the top edge moves; the box clips only while it moves, so
    // a menu or a focus ring past its edge shows once it has settled. Reduced motion snaps it. Until the first
    // measure the height is auto.
    const reduceMotion = useReducedMotion();
    const innerRef = useRef<HTMLDivElement>(null);
    const [contentH, setContentH] = useState<number | null>(null);
    const [moving, setMoving] = useState(false);
    useLayoutEffect(() => {
        const el = innerRef.current;
        if (el == null) {
            return;
        }
        const ro = new ResizeObserver((entries) => {
            const h = entries[entries.length - 1]?.borderBoxSize?.[0]?.blockSize ?? el.offsetHeight;
            setContentH((cur) => (cur != null && Math.abs(cur - h) < 0.01 ? cur : h));
        });
        ro.observe(el);
        return () => ro.disconnect();
    }, []);
    return (
        <motion.div
            {...dataAttrs}
            ref={boxRef}
            data-chat-box=""
            data-chat-box-state={state}
            data-agent-chat-composer={agent.id}
            data-chat-bash-mode={bash ? "" : undefined}
            onDragEnter={onDragEnter}
            onDragOver={onDragOver}
            onDragLeave={onDragLeave}
            onDrop={onDrop}
            initial={false}
            animate={{ height: contentH ?? "auto" }}
            transition={contentH == null || reduceMotion ? { duration: 0 } : MOTION.spring}
            onAnimationStart={() => setMoving(true)}
            onAnimationComplete={() => setMoving(false)}
            // box-content: the animated height is the content's, the border comes on top
            className={cn(
                "relative box-content flex w-full flex-col justify-end rounded-[22px] border border-edge-mid bg-surface-raised shadow-popover-soft transition-colors duration-[140ms] focus-within:border-edge-strong motion-reduce:transition-none",
                moving && "overflow-hidden"
            )}
        >
            <div
                ref={innerRef}
                aria-hidden={dragging ? true : undefined}
                style={{ ...turnTransition, minHeight: dragging ? DropMinH : undefined }}
                className={cn(
                    "flex flex-none flex-col gap-2 pb-[10px] pl-[18px] pr-[12px] pt-[14px] transition-opacity motion-reduce:transition-none",
                    dragging && "opacity-0"
                )}
            >
                {/* a prompt holds the send: says so in the box itself (a disabled Send said it only in its tooltip), and once
                Send was pressed, that the message waits for the answer */}
                {holdText != null ? (
                    <div
                        data-chat-hold={held ? "queued" : "waiting"}
                        role="status"
                        className="flex items-center gap-1.5 whitespace-nowrap text-[12px] text-muted"
                    >
                        <span
                            aria-hidden
                            className={cn("h-[6px] w-[6px] flex-none rounded-full bg-asking", held && "pulse-dot")}
                        />
                        <span className="min-w-0 truncate">{holdText}</span>
                        {held ? (
                            <button
                                type="button"
                                data-chat-hold-cancel
                                onClick={() => setHeldSend(agent.id, false)}
                                className="ml-auto flex-none cursor-pointer text-accent-soft hover:underline"
                            >
                                Cancel
                            </button>
                        ) : null}
                    </div>
                ) : null}
                {/* the agent's background work still running (chatbgline.tsx): under the queued-message line, which asks
                the person to act */}
                <ChatBgLine model={model} agent={agent} />
                <AttachmentTray items={att.attachments} onRemove={att.remove} onRetry={att.retry} />
                {/* a bash command says what it is above its well: it runs in the agent's shell, and its output joins the chat */}
                {bash ? (
                    <div data-chat-bash-caption="" className="flex items-center gap-1.5 whitespace-nowrap text-[12px]">
                        <Terminal size={13} strokeWidth={2} aria-hidden className="flex-none text-accent" />
                        <span className="font-medium text-primary">Bash</span>
                        <span className="min-w-0 truncate text-muted">
                            · runs in the agent's shell, output joins the chat
                        </span>
                        {ghost !== "" ? (
                            <span data-chat-bash-accept="" className="ml-auto flex-none text-ink-faint">
                                <span className="font-mono text-muted">→</span> or{" "}
                                <span className="font-mono text-muted">Tab</span> accept
                            </span>
                        ) : null}
                    </div>
                ) : null}
                {/* always this wrapper, so the editor is not remounted when the well comes and goes */}
                <div data-chat-well="" className={cn("min-w-0", bash && "rounded-[8px] bg-surface-code px-2.5 py-2")}>
                    <ChatEditor
                        ref={editorRef}
                        value={text}
                        outsideCaret={outsideCaret.current}
                        readOnly={waking || dozing}
                        minHeight={bash ? ChatBashMinH : ChatMinH}
                        maxHeight={ChatMaxH}
                        placeholder={placeholder}
                        bash={bash}
                        ghost={ghost}
                        // a shell command line is mono (DESIGN.md)
                        className={cn("text-primary", bash ? "font-mono text-[13px]" : "text-[14px]")}
                        // also called when only the caret moved (a click, an arrow), with the same text: that is no edit, so it
                        // neither ends a recall nor sets the text again
                        onChange={(t, caret) => {
                            if (t !== recalled.current.shown) {
                                recalled.current = { at: null, shown: "" };
                            }
                            if (t !== told.current) {
                                told.current = t;
                                setText(t);
                            }
                            setSaidCaret((cur) => (cur.text === t && cur.caret === caret ? cur : { text: t, caret }));
                            const box = editorRef.current;
                            if (box != null) {
                                slash.onCaret(box);
                                mention.onCaret(box);
                                bashList.onCaret(box);
                            }
                        }}
                        // a click outside the box closes bash mode's Tab list (a click on a row keeps the focus here)
                        onBlur={bashList.onBlur}
                        onPasteFiles={(e) => {
                            // att.onPaste takes the files and calls preventDefault, or leaves the paste to the editor
                            att.onPaste(e as never);
                            return e.defaultPrevented;
                        }}
                        onKeyDown={(e) => {
                            // → or Tab at the end of a bash command with the ghost text showing takes it, as Claude Code's does;
                            // the ghost is never shown while the Tab list is open, so this Tab is not a completion's
                            if (
                                ghost !== "" &&
                                (e.key === "ArrowRight" || e.key === "Tab") &&
                                !e.shiftKey &&
                                !e.altKey &&
                                !e.ctrlKey &&
                                !e.metaKey &&
                                !e.nativeEvent.isComposing
                            ) {
                                const box = e.currentTarget;
                                if (
                                    !box.readOnly &&
                                    box.selectionStart === text.length &&
                                    box.selectionEnd === text.length
                                ) {
                                    e.preventDefault();
                                    recalled.current = { at: null, shown: "" };
                                    setTextAt(text + ghost, text.length + ghost.length);
                                    return;
                                }
                            }
                            // the Tab list's keys (bash mode), the `/` menu's and the `@` picker's (↑↓, Enter and Tab to pick,
                            // Escape to close) come first; at most one of them has a list open (the `/` and `@` lists are shut
                            // while the text starts with `!`)
                            if (bash) {
                                bashList.onKeyDown(e);
                            }
                            if (!e.defaultPrevented) {
                                slash.onKeyDown(e);
                            }
                            if (!e.defaultPrevented) {
                                mention.onKeyDown(e);
                            }
                            if (e.defaultPrevented) {
                                return;
                            }
                            // a Tab the Tab list had nothing to do with stays in the box: in bash mode
                            // Tab is for completing, never for moving the focus out
                            if (
                                bash &&
                                e.key === "Tab" &&
                                !e.shiftKey &&
                                !e.altKey &&
                                !e.ctrlKey &&
                                !e.metaKey &&
                                !e.nativeEvent.isComposing
                            ) {
                                e.preventDefault();
                                return;
                            }
                            // Ctrl+U (Cmd+U on a Mac, where Ctrl+U is the text field's own delete-to-line-start) is Add files; an
                            // open `/` or `@` list leaves it alone. Asleep it attaches too, though the + menu is not drawn.
                            const addFilesKey =
                                e.key.toLowerCase() === "u" &&
                                !e.altKey &&
                                !e.shiftKey &&
                                (isMacOS() ? e.metaKey && !e.ctrlKey : e.ctrlKey && !e.metaKey);
                            if (addFilesKey) {
                                if (!waking && !slash.shown && !mention.shown) {
                                    e.preventDefault();
                                    attach();
                                }
                                return;
                            }
                            // the chat's permission card, while it can answer its prompt: from an empty box ↑ and ↓ move its
                            // highlight and Enter sends the highlighted choice, as the prompt's own list does in the terminal
                            const cardKey = permissionBoxKey(
                                {
                                    key: e.key,
                                    shiftKey: e.shiftKey,
                                    altKey: e.altKey,
                                    ctrlKey: e.ctrlKey,
                                    metaKey: e.metaKey,
                                    isComposing: e.nativeEvent.isComposing,
                                },
                                text === ""
                            );
                            if (
                                cardKey != null &&
                                permissionOref != null &&
                                !e.currentTarget.readOnly &&
                                permissionCardKey(permissionOref, cardKey)
                            ) {
                                e.preventDefault();
                                return;
                            }
                            if (recallKey(e)) {
                                e.preventDefault();
                                return;
                            }
                            if (
                                onSendNow != null &&
                                text.trim() === "" &&
                                !e.nativeEvent.isComposing &&
                                isSendNowKey(e, isMacOS())
                            ) {
                                e.preventDefault();
                                onSendNow();
                                return;
                            }
                            if (e.key === "Enter" && !e.shiftKey) {
                                // Enter that commits an IME composition (Telex, Pinyin…) is not a send
                                if (e.nativeEvent.isComposing) {
                                    return;
                                }
                                e.preventDefault();
                                submit();
                            } else if (e.key === "Escape") {
                                // while Claude works Esc stops the turn, as in Claude Code's box; else the box lets go of
                                // the keys
                                e.preventDefault();
                                if (!interrupt()) {
                                    e.currentTarget.blur();
                                }
                            }
                        }}
                    />
                </div>
                {slash.list}
                {bashList.list}
                {mention.list}
                {/* A line of chips under the text (chatsuggest.ts): while the agent works, the two things Chat can show of
                    it once they hold something (the diff of what it changed, the terminal of a command running a while);
                    once its turn ends, the replies the person would
                    likely send next, in their words, which a click sends (asking first over typed text). One
                    line goes before the next comes, so the box never holds both, and the actions come and go only once
                    the agent's state has held (useChipRow). */}
                <AnimatePresence initial={false} mode="wait">
                    {row.kind === "actions" ? (
                        <ActionChips
                            key="actions"
                            onShowDiff={row.diff ? onShowDiff : undefined}
                            onOpenTerminal={row.terminal ? showTerminal : undefined}
                        />
                    ) : row.kind === "suggest" ? (
                        <SuggestChips
                            key="suggest"
                            chips={row.chips}
                            onSend={sendSuggested}
                            onMarkDone={onMarkDone}
                            onGoOn={onGoOn}
                        />
                    ) : null}
                </AnimatePresence>
                {/* one row through a sleep and a wake: its parts fold and crossfade in place (reduced motion snaps them) */}
                <MotionConfig reducedMotion="user">
                    <div className="flex items-center gap-1.5">
                        <AnimatePresence initial={false}>
                            {asleep ? null : (
                                <Fold key="attach">
                                    <ChatPlusMenu
                                        onAttach={attach}
                                        onText={putText}
                                        onSend={sendCommand}
                                        onFocusBox={() => editorRef.current?.focus()}
                                        disabled={waking || dozing}
                                    />
                                </Fold>
                            )}
                        </AnimatePresence>
                        <AnimatePresence initial={false}>
                            {/* one part from the Sleep to the wake, so going to sleep and asleep swap words in place */}
                            {asleep || dozing ? (
                                <Fold key="asleep">
                                    <div
                                        data-chat-asleep={asleep ? "" : undefined}
                                        data-chat-falling-asleep={dozing && !asleep ? fallingAsleep : undefined}
                                        role="status"
                                        className="flex h-[28px] items-center gap-1.5 whitespace-nowrap pl-0.5 pr-1 text-[12px] text-muted"
                                    >
                                        <Moon
                                            size={13}
                                            strokeWidth={1.8}
                                            aria-hidden
                                            className={cn(!asleep && "pulse-dot")}
                                        />
                                        {asleep
                                            ? sleepingLine("Asleep", agent.sleeping!)
                                            : fallAsleepLabel(fallingAsleep!)}
                                    </div>
                                </Fold>
                            ) : null}
                        </AnimatePresence>
                        {/* takes the row's free width, so Stop and Send stay at the far right */}
                        <ChatFooter agent={agent} />
                        {/* the round Stop where Send is while the agent works; Send folds out beside it with nothing to send */}
                        <AnimatePresence initial={false}>
                            {showStop ? (
                                <Fold key="stop">
                                    <button
                                        type="button"
                                        data-chat-stop
                                        aria-label="Stop (Esc)"
                                        title="Stop the agent (sends Esc)"
                                        onClick={stop}
                                        className="flex size-[34px] flex-none cursor-pointer items-center justify-center rounded-full bg-primary hover:opacity-90 focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-surface-raised"
                                    >
                                        <span aria-hidden className="size-[11px] rounded-[3px] bg-background" />
                                    </button>
                                </Fold>
                            ) : null}
                        </AnimatePresence>
                        <AnimatePresence initial={false}>
                            {showSend ? (
                                <Fold key="send">
                                    {/* Asleep (and while a wake is in flight) the button widens to its word, the arrow and the
                                    word crossfading: Waking… is the one sign that the message was taken. The widths are the
                                    board's (CSS cannot transition to auto). */}
                                    <button
                                        type="button"
                                        data-chat-send
                                        title={
                                            blocker ??
                                            (hold != null
                                                ? held
                                                    ? "Queued: sends once you answer"
                                                    : `${hold}: Send queues your message until then`
                                                : bash
                                                  ? "Run in the agent's shell"
                                                  : wakeOnly
                                                    ? "Wake: relaunch the agent where its conversation left off"
                                                    : "Send")
                                        }
                                        aria-label={hold != null ? "Queue" : showWord ? undefined : "Send"}
                                        onClick={submit}
                                        disabled={!(ready || wakeOnly) || held}
                                        style={turnTransition}
                                        className={cn(
                                            "relative flex h-[34px] flex-none cursor-pointer items-center justify-center overflow-hidden rounded-full bg-accent text-background shadow-inset-highlight transition-[width] hover:opacity-90 focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-surface-raised disabled:cursor-default disabled:opacity-40 disabled:hover:opacity-40 motion-reduce:transition-none",
                                            waking ? "w-[84px]" : asleep ? "w-[64px]" : "w-[34px]"
                                        )}
                                    >
                                        <span
                                            aria-hidden
                                            style={turnTransition}
                                            className={cn(
                                                "absolute flex transition-opacity motion-reduce:transition-none",
                                                showWord ? "opacity-0" : "opacity-100"
                                            )}
                                        >
                                            <ArrowUp size={15} strokeWidth={2.4} aria-hidden />
                                        </span>
                                        <span
                                            aria-hidden={!showWord}
                                            style={turnTransition}
                                            className={cn(
                                                "whitespace-nowrap text-[12px] font-semibold transition-opacity motion-reduce:transition-none",
                                                showWord ? "opacity-100" : "opacity-0"
                                            )}
                                        >
                                            {sendWord.current}
                                        </span>
                                    </button>
                                </Fold>
                            ) : null}
                        </AnimatePresence>
                    </div>
                </MotionConfig>
            </div>
            {/* the drop zone: the box's content fades out under it while files are dragged over (the content stays
                mounted, so the text and the attachments are as they were when the drag ends) */}
            <div
                data-chat-drop=""
                aria-hidden={dragging ? undefined : true}
                style={turnTransition}
                className={cn(
                    "pointer-events-none absolute inset-2 flex flex-col items-center justify-center gap-1 rounded-[16px] border-[1.5px] border-dashed border-edge-strong bg-accent/6 px-4 text-center opacity-0 transition-opacity motion-reduce:transition-none",
                    dragging && "opacity-100"
                )}
            >
                <span className="text-[14px] font-medium text-primary">Drop files to attach</span>
                <span className="text-[12px] text-muted">Images, text files, folders · they go in as @ mentions</span>
            </div>
        </motion.div>
    );
}

// The chip line as shown: the one the agent's state asks for, once it has held as long as rowHold says (chatsuggest.ts).
// While a change waits, the line shown stays with its chips as they last were: the replies kept while a turn starts are
// still the finished turn's, and a click on one sends it as before.
function useChipRow<T extends { kind: ChipRowKind }>(target: T): T {
    const shown = useRef(target);
    const latest = useRef(target);
    latest.current = target;
    const [, redraw] = useState(0);
    const hold = rowHold(shown.current.kind, target.kind);
    if (hold === 0) {
        shown.current = target;
    }
    const shownKind = shown.current.kind;
    useEffect(() => {
        if (hold === 0) {
            return;
        }
        const t = setTimeout(() => {
            shown.current = latest.current;
            redraw((n) => n + 1);
        }, hold);
        return () => clearTimeout(t);
    }, [shownKind, target.kind, hold]);
    return shown.current;
}

// The running agent's actions: what Chat already offers (no new commands), as chips with their names, each drawn only
// when given (it has something to show). They fade in on the micro ease; the box's own height spring makes room for them.
function ActionChips({ onShowDiff, onOpenTerminal }: { onShowDiff?: () => void; onOpenTerminal?: () => void }) {
    const part = usePartMotion(microFade);
    return (
        <motion.div {...part} className="flex flex-wrap items-center gap-1.5">
            <AnimatePresence initial={false}>
                {onShowDiff != null ? (
                    <motion.div key="diff" {...part}>
                        <Chip
                            icon={FileDiff}
                            label="Show the diff"
                            onClick={onShowDiff}
                            data={{ "data-chat-action-chip": "diff" }}
                        />
                    </motion.div>
                ) : null}
                {onOpenTerminal != null ? (
                    <motion.div key="terminal" {...part}>
                        <Chip
                            icon={Terminal}
                            label="Open the terminal"
                            onClick={onOpenTerminal}
                            data={{ "data-chat-action-chip": "terminal" }}
                        />
                    </motion.div>
                ) : null}
            </AnimatePresence>
        </motion.div>
    );
}

const SUGGEST_ICONS: Record<ChipKind, LucideIcon> = {
    commit: GitCommitHorizontal,
    push: ArrowUpFromLine,
    reply: CornerDownLeft,
    done: Check,
    next: ArrowRight,
};

// The finished turn's suggested replies (chatsuggest.ts), a click sends one as typed; a chunk's done chip ticks it on
// the initiative instead, as the band's Mark done does, and a go on with: chip moves the agent to its chunk first, then
// sends its text (onGoOn). A chip the model adds a few seconds after the rules' fades in beside them.
function SuggestChips({
    chips,
    onSend,
    onMarkDone,
    onGoOn,
}: {
    chips: ChatChip[];
    onSend: (text: string) => void;
    onMarkDone?: (chunk: string) => void;
    onGoOn?: (chunk: string, text: string) => void;
}) {
    const part = usePartMotion(microFade);
    return (
        <motion.div {...part} data-chat-suggest="" className="flex flex-wrap items-center gap-1.5">
            <AnimatePresence initial={false}>
                {chips.map((c) => {
                    const ticks = c.kind === "done" && c.chunk != null;
                    if (ticks && onMarkDone == null) {
                        return null;
                    }
                    const goes = c.kind === "next" && c.chunk != null && onGoOn != null;
                    return (
                        <motion.div key={c.text} {...part} className="min-w-0">
                            <Chip
                                icon={SUGGEST_ICONS[c.kind]}
                                label={c.text}
                                title={
                                    ticks
                                        ? `Mark “${c.chunk}” done and move on to the next chunk`
                                        : goes
                                          ? `Move this agent to “${c.chunk}” and send “${c.text}”`
                                          : `Send “${c.text}”`
                                }
                                onClick={() =>
                                    ticks ? onMarkDone!(c.chunk!) : goes ? onGoOn!(c.chunk!, c.text) : onSend(c.text)
                                }
                                data={{ "data-chat-suggest-chip": c.source, "data-chat-suggest-kind": c.kind }}
                            />
                        </motion.div>
                    );
                })}
            </AnimatePresence>
        </motion.div>
    );
}

function Chip({
    icon: Icon,
    label,
    title,
    onClick,
    data,
}: {
    icon: LucideIcon;
    label: string;
    title?: string;
    onClick: () => void;
    data: Record<`data-${string}`, string>;
}) {
    return (
        <button
            type="button"
            {...data}
            title={title}
            onClick={onClick}
            className="flex h-[28px] max-w-[340px] cursor-pointer items-center gap-1.5 rounded-full border border-edge-mid bg-surface px-[11px] text-[12.5px] text-secondary transition-colors hover:border-edge-strong hover:text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent motion-reduce:transition-none"
        >
            <Icon size={13} strokeWidth={1.8} aria-hidden className="flex-none" />
            <span className="min-w-0 truncate">{label}</span>
        </button>
    );
}
