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
// Send was (Send stays beside it once there is a message to send), a drag of files turns the box into a dashed drop zone.
// What it sends and how a sleeping agent is woken is
// useAgentSend's (agentcomposer.tsx), the same path as the compact composer; this adds attachments
// (composerattachments.ts: a pasted or dropped image is kept and goes as the "Attached images:" block your bubble draws
// as a picture; Ctrl+U, Cmd+U on a Mac, opens the file dialog), the `/` command menu (slashmenu.tsx) and the `@` file
// picker (filemention.tsx), Stop, and the look. A text that starts with `!` is a bash command (chatmodel.ts `bashMode`): the
// box draws it in a shell well under a "Bash" caption, with the newest `!` command of Claude Code's history that starts so
// as grey ghost text, which → takes (chatbash.ts has the rules, chatbashstore.ts the history), and Tab completes the word
// under the caret (commands, `$variables`, files) in a list over the box (bashcomplete.tsx). Callers key it by agent id:
// its text and its attachments are local to the box.
//
// The text is a small Lexical editor (chateditor.tsx) that draws a file you @-mentioned as a pill, but the plain text
// stays the source of truth: `text` is the message as the agent receives it, and everything here (the menus, recall, the
// insert registry, the send) works on that string and offsets in it, through the editor's handle (`editorRef`), which
// answers like the part of a textarea they use.

import { pushToast } from "@/app/cockpit/notificationstore";
import { MOTION, turnTransition } from "@/app/element/motiontokens";
import * as WOS from "@/app/store/wos";
import { RpcApi } from "@/app/store/wshclientapi";
import { TabRpcClient } from "@/app/store/wshrpcutil";
import { focusTerm } from "@/app/view/term/termpaste";
import { isMacOS } from "@/util/platformutil";
import { cn, fireAndForget, stringToBase64 } from "@/util/util";
import { atom, useAtomValue, type Atom } from "jotai";
import { ArrowUp, FileDiff, Moon, Terminal, type LucideIcon } from "lucide-react";
import { AnimatePresence, motion, MotionConfig, useReducedMotion } from "motion/react";
import { useEffect, useLayoutEffect, useMemo, useRef, useState, type DragEvent } from "react";
import { canStop, useAgentSend } from "./agentcomposer";
import { submitToAgent } from "./agentsubmit";
import type { AgentEntry, AgentVM } from "./agentsviewmodel";
import { AttachmentTray } from "./attachmenttray";
import { useBashComplete } from "./bashcomplete";
import { bashGhost } from "./chatbash";
import { noteBashRun, useBashHistory } from "./chatbashstore";
import { boxState, type BoxState } from "./chatboxstate";
import { ChatEditor, type EditorLike, type KeyLike } from "./chateditor";
import { ChatFooter, Fold } from "./chatfooter";
import { insertAt, registerChatBox, registerChatInsert } from "./chatinsert";
import { answersInChat, localCommand, type LocalRoute } from "./chatlocal";
import { clearLocalCards } from "./chatlocalstore";
import { bashMode } from "./chatmodel";
import { setChatMode } from "./chatmodestore";
import { holdLine, isSendNowKey, pendingStill, pendsAsBubble, recall, releasesHeld, sendHold } from "./chatpending";
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
import { mergeTaken, takeBackPlan } from "./chattakeback";
import { takeBack } from "./chattakebackstore";
import { attachmentBlocker, useComposerAttachments } from "./composerattachments";
import { useFileMention } from "./filemention";
import { chatFilesRoot, recentMentionPaths } from "./launchermention";
import { isPathsDrag, pathsFromDrop } from "./pathdrop";
import { usePermission } from "./permissionstore";
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

// the box's content height while it is a drop zone: the board's dashed zone is 120px high in an 8px margin
const DropMinH = 136;

export function ChatComposer({
    agent,
    placeholder,
    dataAttrs,
    entries,
    onSent,
    onBoxState,
    onShowDiff,
    onLocal,
    onSendNow,
}: {
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
    /** the running agent's "Show the diff" icon; left out, the icon is not drawn */
    onShowDiff?: () => void;
    /** a bare /usage, /tasks, /diff… typed in the box (chatlocal.ts): Chat answers it instead of sending it. Left out,
     *  every command is sent. */
    onLocal?: (route: LocalRoute) => void;
    /** a queued message's Send now, while one shows: Ctrl+Enter (Cmd+Enter on a Mac) in an empty box presses it. A box
     *  with text sends it as Enter does: the chord could reach the terminal before the text was typed in */
    onSendNow?: () => void;
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
    // an asleep agent takes text only: the wake carries a message, and there is no process to read a file yet
    const { text, setText, message, canSend, waking, send } = useAgentSend(
        agent.blockId,
        agent,
        asleep ? undefined : att.attachments,
        {
            keepDraft: true,
            // a /btw no mod took was typed into the terminal, where Claude Code answers it on its own screen: show that
            onBtwTyped: (sent) => {
                dropPending(agent.id, sent);
                showTerminal();
            },
        }
    );
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
            }),
        [agent.id]
    );
    // appendAttachments leaves out an upload in flight and a failed one: sending past them would drop a file unannounced
    const blocker = asleep ? null : attachmentBlocker(att.attachments);
    // Typed into a permission prompt or a question, a message's first digit would pick an option: the send waits. Send
    // then queues the message (`held`, kept per agent while the box unmounts for the terminal), and it goes by itself
    // once the prompt is answered.
    const permission = usePermission(agent.blockId != null ? `block:${agent.blockId}` : undefined);
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
        if (!sendable) {
            return;
        }
        const sent = message;
        if (send()) {
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
        if (asleep || waking || blockid == null) {
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
        fireAndForget(async () => {
            await takeBack(agent.id, blockid, plan, (texts) => {
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
    const attach = () => {
        fireAndForget(async () => {
            const paths = await pickPaths();
            if (paths.length > 0) {
                att.addPaths(paths);
            }
            editorRef.current?.focus();
        });
    };
    // A drag of files over an awake agent's box turns it into the drop zone. dragenter and dragleave fire for every child
    // the drag crosses, so `dragDepth` counts the enters not yet left: the zone goes when the count is back to zero (the
    // drag left the box), and a drop, a dragend or a sleep ends it at once. A dragover alone starts it too, so a box
    // that missed the enter (the drag began over it) still shows the zone.
    const [dragging, setDragging] = useState(false);
    const dragDepth = useRef(0);
    const endDrag = () => {
        dragDepth.current = 0;
        setDragging(false);
    };
    useEffect(() => {
        if (asleep) {
            endDrag();
        }
    }, [asleep]);
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
        if (!asleep && offersFiles(e.dataTransfer)) {
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
    // files is taken here, and kept only by an awake agent
    const onDragOver = (e: DragEvent<HTMLElement>) => {
        if (offersFiles(e.dataTransfer)) {
            e.preventDefault();
            e.dataTransfer.dropEffect = asleep ? "none" : "copy";
            if (!asleep) {
                dragDepth.current = Math.max(dragDepth.current, 1);
                setDragging(true);
            }
        }
    };
    // Explorer hands over real files (copied, as a paste is); arcterm's tree, VS Code, Obsidian and "Copy as path"
    // hand over paths as text, which the box would otherwise take as typed text: those attach in place
    const onDrop = (e: DragEvent<HTMLElement>) => {
        endDrag();
        const dt = e.dataTransfer;
        if (dragHasFiles(dt)) {
            e.preventDefault();
            if (!asleep) {
                att.addFiles(Array.from(dt.files));
            }
            return;
        }
        const paths = pathsFromDrop(Array.from(dt.types), (type) => dt.getData(type));
        if (paths == null || paths.length === 0) {
            return;
        }
        e.preventDefault();
        e.stopPropagation();
        if (!asleep) {
            att.addPaths(paths);
            editorRef.current?.focus();
        }
    };
    const showStop = !asleep && agent.blockId != null && canStop(agent.state, agent.sleeping);
    // Send is a word asleep and while the wake is in flight. The word stays what it last was while it fades out, so a
    // finished wake does not swap "Waking…" for "Send" under the eye.
    const showWord = asleep || waking;
    const sendWord = useRef("Send");
    if (showWord) {
        sendWord.current = waking ? "Waking…" : "Send";
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
                {asleep ? null : <AttachmentTray items={att.attachments} onRemove={att.remove} onRetry={att.retry} />}
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
                                <span className="font-mono text-muted">→</span> accept
                            </span>
                        ) : null}
                    </div>
                ) : null}
                {/* always this wrapper, so the editor is not remounted when the well comes and goes */}
                <div className={cn("min-w-0", bash && "rounded-[8px] bg-surface-code px-2.5 py-2")}>
                    <ChatEditor
                        ref={editorRef}
                        value={text}
                        outsideCaret={outsideCaret.current}
                        readOnly={waking}
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
                        onPasteFiles={
                            asleep
                                ? undefined
                                : (e) => {
                                      // att.onPaste takes the files and calls preventDefault, or leaves the paste to the editor
                                      att.onPaste(e as never);
                                      return e.defaultPrevented;
                                  }
                        }
                        onKeyDown={(e) => {
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
                            // a Tab the Tab list had nothing to do with (the caret before the `!`) stays in the box: in bash mode
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
                            // → at the end of a bash command with the ghost text showing takes it, as Claude Code's does
                            if (
                                ghost !== "" &&
                                e.key === "ArrowRight" &&
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
                            // Ctrl+U (Cmd+U on a Mac, where Ctrl+U is the text field's own delete-to-line-start) is Add files; an
                            // open `/` or `@` list leaves it alone. An asleep agent takes text only, as its + is not drawn.
                            const addFilesKey =
                                e.key.toLowerCase() === "u" &&
                                !e.altKey &&
                                !e.shiftKey &&
                                (isMacOS() ? e.metaKey && !e.ctrlKey : e.ctrlKey && !e.metaKey);
                            if (addFilesKey) {
                                if (!asleep && !waking && !slash.shown && !mention.shown) {
                                    e.preventDefault();
                                    attach();
                                }
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
                                // a message Claude has not taken or answered yet comes back into the box; else the box
                                // lets go of the keys: Stop is its own button, so a stray Esc never stops a turn under way
                                e.preventDefault();
                                if (!takeBackKey("Escape")) {
                                    e.currentTarget.blur();
                                }
                            }
                        }}
                    />
                </div>
                {slash.list}
                {bashList.list}
                {mention.list}
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
                                        disabled={waking}
                                    />
                                </Fold>
                            )}
                        </AnimatePresence>
                        <AnimatePresence initial={false}>
                            {asleep ? (
                                <Fold key="asleep">
                                    <div
                                        data-chat-asleep
                                        className="flex h-[28px] items-center gap-1.5 whitespace-nowrap pl-0.5 pr-1 text-[12px] text-muted"
                                    >
                                        <Moon size={13} strokeWidth={1.8} aria-hidden />
                                        Asleep
                                    </div>
                                </Fold>
                            ) : null}
                        </AnimatePresence>
                        {/* takes the row's free width, so Stop and Send stay at the far right */}
                        <ChatFooter agent={agent} />
                        {/* a running agent: the two things Chat can show for it (the diff of what it is changing, its
                            terminal), as icons beside Stop, so the box grows no row for them */}
                        <AnimatePresence initial={false}>
                            {showStop && onShowDiff != null ? (
                                <Fold key="diff">
                                    <ActionIcon icon={FileDiff} label="Show the diff" onClick={onShowDiff} />
                                </Fold>
                            ) : null}
                        </AnimatePresence>
                        <AnimatePresence initial={false}>
                            {showStop ? (
                                <Fold key="terminal">
                                    <ActionIcon icon={Terminal} label="Open the terminal" onClick={showTerminal} />
                                </Fold>
                            ) : null}
                        </AnimatePresence>
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
                                                  : "Send")
                                        }
                                        aria-label={hold != null ? "Queue" : showWord ? undefined : "Send"}
                                        onClick={submit}
                                        disabled={!ready || held}
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

// One of the running agent's actions (what Chat already offers, no new commands): a bare icon the size of the `+`, its
// name in the tooltip
function ActionIcon({ icon: Icon, label, onClick }: { icon: LucideIcon; label: string; onClick: () => void }) {
    return (
        <button
            type="button"
            data-chat-action=""
            aria-label={label}
            title={label}
            onClick={onClick}
            className="flex size-[28px] flex-none cursor-pointer items-center justify-center rounded-[8px] text-muted transition-colors hover:bg-surface-hover hover:text-secondary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent motion-reduce:transition-none"
        >
            <Icon size={15} strokeWidth={1.8} aria-hidden />
        </button>
    );
}
