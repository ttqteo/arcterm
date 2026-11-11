// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0
//
// The message box of the chat view (a Claude agent's cell in Chat, and its sleeping overlay): the board's rounded box
// with the text on top and, under it, one row: the `+` menu (chatplusmenu.tsx: add files, a folder, a slash command, MCP
// servers, plugins) and the model, mode and context chips (chatfooter.tsx) on the left, Stop and Send on the right. That
// row's parts fold in place when the agent sleeps or wakes. What it sends and how a sleeping agent is woken is
// useAgentSend's (agentcomposer.tsx), the same path as the compact composer; this adds attachments
// (composerattachments.ts: a pasted or dropped image is kept and goes as the "Attached images:" block your bubble draws
// as a picture; Ctrl+U, Cmd+U on a Mac, opens the file dialog), the `/` command menu (slashmenu.tsx) and the `@` file
// picker (filemention.tsx), Stop, and the look. Callers key it by agent id: its text and its attachments are local to the
// box.
//
// The text is a small Lexical editor (chateditor.tsx) that draws a file you @-mentioned as a pill, but the plain text
// stays the source of truth: `text` is the message as the agent receives it, and everything here (the menus, recall, the
// insert registry, the send) works on that string and offsets in it, through the editor's handle (`editorRef`), which
// answers like the part of a textarea they use.

import { pushToast } from "@/app/cockpit/notificationstore";
import { turnTransition } from "@/app/element/motiontokens";
import * as WOS from "@/app/store/wos";
import { RpcApi } from "@/app/store/wshclientapi";
import { TabRpcClient } from "@/app/store/wshrpcutil";
import { focusTerm } from "@/app/view/term/termpaste";
import { isMacOS } from "@/util/platformutil";
import { cn, fireAndForget, stringToBase64 } from "@/util/util";
import { atom, useAtomValue, type Atom } from "jotai";
import { ArrowUp, Moon, Square } from "lucide-react";
import { AnimatePresence, MotionConfig } from "motion/react";
import { useEffect, useLayoutEffect, useMemo, useRef, type DragEvent } from "react";
import { canStop, useAgentSend } from "./agentcomposer";
import { submitToAgent } from "./agentsubmit";
import type { AgentEntry, AgentVM } from "./agentsviewmodel";
import { AttachmentTray } from "./attachmenttray";
import { ChatEditor, type EditorLike, type KeyLike } from "./chateditor";
import { ChatFooter, Fold } from "./chatfooter";
import { insertAt, registerChatBox, registerChatInsert } from "./chatinsert";
import { bashMode } from "./chatmodel";
import { setChatMode } from "./chatmodestore";
import { pendsAsBubble, recall, sendHold } from "./chatpending";
import { addPending, dropPending, noteSent, sentHistory } from "./chatpendingstore";
import { ChatPlusMenu } from "./chatplusmenu";
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

export function ChatComposer({
    agent,
    placeholder,
    dataAttrs,
    entries,
    onSent,
}: {
    agent: AgentVM;
    placeholder: string;
    /** the conversation as drawn: a send of an awake agent is shown as a pending bubble until the transcript holds it.
     *  The sleeping overlay passes none (a wake delivers the message, no bubble stands in for it). */
    entries?: AgentEntry[];
    /** called as soon as a message is taken (a wake send too), before its pending bubble is added: the chat scrolls to
     *  the end, so the bubble lands in view even when the reader had scrolled up */
    onSent?: () => void;
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
    // a `/` as the box's first character lists Claude Code's commands; a recalled "/compact" is a message to resend, not
    // a command being typed, so the menu stays closed over it until it is edited
    const slash = useSlashMenu({
        text,
        setText: setTextAt,
        cwd: block?.meta?.["cmd:cwd"] ?? "",
        blockId: agent.blockId,
        inputRef: editorRef,
        off: recalled.current.at != null && text === recalled.current.shown,
    });
    const cwd = block?.meta?.["cmd:cwd"];
    const filesRoot = chatFilesRoot(cwd, agent.project, projects);
    // the files this agent read or wrote lead the `@` list, newest first
    const recentFiles = useMemo(() => recentMentionPaths(entries, filesRoot), [entries, filesRoot]);
    const mention = useFileMention({
        text,
        setText: setTextAt,
        filesRoot,
        cwd,
        inputRef: editorRef,
        name: "chat",
        recent: recentFiles,
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
            }),
        [agent.id]
    );
    // appendAttachments leaves out an upload in flight and a failed one: sending past them would drop a file unannounced
    const blocker = asleep ? null : attachmentBlocker(att.attachments);
    // Typed into a permission prompt or a question, a message's first digit would pick an option: the send waits
    const permission = usePermission(agent.blockId != null ? `block:${agent.blockId}` : undefined);
    const hold = asleep ? null : sendHold(permission.length > 0, agent.ask != null && !agent.ask.hold);
    const sendable = canSend && blocker == null && hold == null;
    // a bare /model, /config… draws a menu on Claude Code's own screen: show that screen to answer it
    const flipIfTui = (sent: string) => {
        if (opensTui(sent, slash.commands)) {
            showTerminal();
        }
    };
    const submit = () => {
        if (!sendable) {
            return;
        }
        const sent = message;
        if (send()) {
            onSent?.();
            recalled.current = { at: null, shown: "" };
            noteSent(agent.id, sent);
            if (!asleep) {
                // a /command is no bubble of yours: the transcript draws it as a command row, which would leave the
                // pending bubble up beside it for minutes. A /btw and a bare panel command are: nothing of them lands
                // until the side answer comes or the panel closes (chatpending.ts pendingKind)
                if (entries != null && pendsAsBubble(sent)) {
                    addPending(agent.id, sent, entries);
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
        onSent?.();
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
    // the webview's own drag-drop is off, so a file dropped unhandled would navigate it to the file: any drag that holds
    // files is taken here, and kept only by an awake agent
    const onDragOver = (e: DragEvent<HTMLElement>) => {
        if (dragHasFiles(e.dataTransfer) || dragNamesPaths(e.dataTransfer)) {
            e.preventDefault();
            e.dataTransfer.dropEffect = asleep ? "none" : "copy";
        }
    };
    // Explorer hands over real files (copied, as a paste is); arcterm's tree, VS Code, Obsidian and "Copy as path"
    // hand over paths as text, which the box would otherwise take as typed text: those attach in place
    const onDrop = (e: DragEvent<HTMLElement>) => {
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
    return (
        <div
            {...dataAttrs}
            data-agent-chat-composer={agent.id}
            data-chat-bash-mode={bash ? "" : undefined}
            onDragOver={onDragOver}
            onDrop={onDrop}
            className={cn(
                "mx-auto flex w-full max-w-[760px] flex-col gap-2 rounded-[12px] border bg-surface-raised px-3 py-[10px] transition-colors duration-[140ms] motion-reduce:transition-none",
                bash ? "border-accent/60" : "border-edge-mid focus-within:border-edge-strong"
            )}
        >
            {asleep ? null : <AttachmentTray items={att.attachments} onRemove={att.remove} onRetry={att.retry} />}
            <ChatEditor
                ref={editorRef}
                value={text}
                outsideCaret={outsideCaret.current}
                readOnly={waking}
                minHeight={ChatMinH}
                maxHeight={ChatMaxH}
                placeholder={placeholder}
                className="text-[13px] text-primary"
                // also called when only the caret moved (a click, an arrow), with the same text: that is no edit, so it
                // neither ends a recall nor sets the text again
                onChange={(t) => {
                    if (t !== recalled.current.shown) {
                        recalled.current = { at: null, shown: "" };
                    }
                    if (t !== told.current) {
                        told.current = t;
                        setText(t);
                    }
                    const box = editorRef.current;
                    if (box != null) {
                        slash.onCaret(box);
                        mention.onCaret(box);
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
                    // the `/` menu's and the `@` picker's keys (↑↓, Enter and Tab to pick, Escape to close) come first; at
                    // most one of them has a list open
                    slash.onKeyDown(e);
                    if (!e.defaultPrevented) {
                        mention.onKeyDown(e);
                    }
                    if (e.defaultPrevented) {
                        return;
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
                    if (e.key === "Enter" && !e.shiftKey) {
                        // Enter that commits an IME composition (Telex, Pinyin…) is not a send
                        if (e.nativeEvent.isComposing) {
                            return;
                        }
                        e.preventDefault();
                        submit();
                    } else if (e.key === "Escape") {
                        // the box lets go of the keys; Stop is its own button, so a stray Esc never interrupts the agent
                        e.preventDefault();
                        e.currentTarget.blur();
                    }
                }}
            />
            {slash.list}
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
                        {bash ? (
                            <Fold key="bash">
                                <div
                                    data-chat-bash
                                    title="Bash mode: runs in the agent's shell, and what it prints joins the conversation"
                                    className="flex h-[28px] items-center gap-1.5 whitespace-nowrap pl-1 pr-1 text-[12px] text-accent"
                                >
                                    <span aria-hidden className="font-mono font-semibold">
                                        !
                                    </span>
                                    Bash mode
                                </div>
                            </Fold>
                        ) : null}
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
                    {showStop ? (
                        <button
                            type="button"
                            data-chat-stop
                            title="Stop the agent (sends Esc)"
                            onClick={stop}
                            className="flex cursor-pointer items-center gap-1.5 rounded-[8px] border border-edge-mid px-2.5 py-1 text-[12px] text-secondary hover:border-edge-strong hover:bg-surface-hover hover:text-primary focus-visible:ring-2 focus-visible:ring-accent"
                        >
                            <Square size={10} fill="currentColor" aria-hidden />
                            Stop
                        </button>
                    ) : null}
                    {/* Asleep (and while a wake is in flight) the button widens to its word, the arrow and the word
                        crossfading: Waking… is the one sign that the message was taken. The widths are the board's
                        (CSS cannot transition to auto). */}
                    <button
                        type="button"
                        data-chat-send
                        title={hold ?? blocker ?? (bash ? "Run in the agent's shell" : "Send")}
                        aria-label={hold ?? (showWord ? undefined : "Send")}
                        onClick={submit}
                        disabled={!sendable}
                        style={turnTransition}
                        className={cn(
                            "relative flex h-[30px] flex-none cursor-pointer items-center justify-center overflow-hidden rounded-[8px] bg-accent text-background transition-[width] hover:opacity-90 focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-surface-raised disabled:cursor-default disabled:opacity-40 disabled:hover:opacity-40 motion-reduce:transition-none",
                            waking ? "w-[78px]" : asleep ? "w-[58px]" : "w-[30px]"
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
                            <ArrowUp size={15} strokeWidth={2.2} aria-hidden />
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
                </div>
            </MotionConfig>
        </div>
    );
}
