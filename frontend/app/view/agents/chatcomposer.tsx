// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0
//
// The message box of the chat view (a Claude agent's cell in Chat, and its sleeping overlay): the board's rounded box
// with the text on top and, under it, the attach button on the left and Stop and Send on the right. What it sends and
// how a sleeping agent is woken is useAgentSend's (agentcomposer.tsx), the same path as the compact composer; this adds
// attachments (composerattachments.ts: a pasted or dropped image is kept and goes as the "Attached images:" block your
// bubble draws as a picture), the `@` file picker (filemention.tsx), Stop, and the look. Callers key it by agent id: its
// text and its attachments are local to the box.

import { pushToast } from "@/app/cockpit/notificationstore";
import * as WOS from "@/app/store/wos";
import { RpcApi } from "@/app/store/wshclientapi";
import { TabRpcClient } from "@/app/store/wshrpcutil";
import { cn, fireAndForget, stringToBase64 } from "@/util/util";
import { atom, useAtomValue, type Atom } from "jotai";
import { ArrowUp, Square } from "lucide-react";
import { useEffect, useLayoutEffect, useRef, type DragEvent } from "react";
import { canStop, useAgentSend, useGrowingTextarea } from "./agentcomposer";
import type { AgentVM } from "./agentsviewmodel";
import { AttachButton, AttachmentTray } from "./attachmenttray";
import { insertAt, registerChatInsert } from "./chatinsert";
import { attachmentBlocker, useComposerAttachments } from "./composerattachments";
import { useFileMention } from "./filemention";
import { chatFilesRoot } from "./launchermention";
import { projectsAtom } from "./projectsstore";

// two lines, as the board's box; grows as the text wraps, then scrolls
const ChatMinH = 38;
const ChatMaxH = 200;

const dragHasFiles = (dt: DataTransfer | null) => Array.from(dt?.types ?? []).includes("Files");

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
}: {
    agent: AgentVM;
    placeholder: string;
    /** extra data attributes on the box: the sleeping overlay keeps `data-sleeping-composer` there */
    dataAttrs?: Record<`data-${string}`, string>;
}) {
    const asleep = agent.sleeping != null;
    const att = useComposerAttachments({ keep: true });
    // an asleep agent takes text only: the wake carries a message, and there is no process to read a file yet
    const { text, setText, canSend, waking, send } = useAgentSend(
        agent.blockId,
        agent,
        asleep ? undefined : att.attachments
    );
    const taRef = useRef<HTMLTextAreaElement>(null);
    useGrowingTextarea(taRef, text, ChatMinH, ChatMaxH);
    const block = useAtomValue(
        agent.blockId ? WOS.getWaveObjectAtom<Block>(WOS.makeORef("block", agent.blockId)) : NO_BLOCK
    );
    const projects = useAtomValue(projectsAtom);
    const mention = useFileMention({
        text,
        setText,
        filesRoot: chatFilesRoot(block?.meta?.["cmd:cwd"], agent.project, projects),
        inputRef: taRef,
        name: "chat",
    });
    // An Alt-drop's @mention lands here (chatinsert.ts): at the caret, through the text state, which a write to the
    // textarea's value would lose to the next render; the caret is put after it once the new text is drawn.
    const latest = useRef({ text, setText });
    latest.current = { text, setText };
    const caretAfter = useRef<number | null>(null);
    useEffect(
        () =>
            registerChatInsert(agent.id, (insert) => {
                const ta = taRef.current;
                if (ta == null || ta.readOnly) {
                    return false;
                }
                const next = insertAt(latest.current.text, ta.selectionStart, ta.selectionEnd, insert);
                caretAfter.current = next.caret;
                latest.current.setText(next.text);
                ta.focus({ preventScroll: true });
                return true;
            }),
        [agent.id]
    );
    useLayoutEffect(() => {
        const caret = caretAfter.current;
        if (caret != null && taRef.current != null) {
            caretAfter.current = null;
            taRef.current.setSelectionRange(caret, caret);
        }
    }, [text]);
    // appendAttachments leaves out an upload in flight and a failed one: sending past them would drop a file unannounced
    const blocker = asleep ? null : attachmentBlocker(att.attachments);
    const sendable = canSend && blocker == null;
    const submit = () => {
        if (sendable && send() && !asleep) {
            for (const a of att.attachments) {
                att.remove(a.id);
            }
        }
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
            taRef.current?.focus();
        });
    };
    // the webview's own drag-drop is off, so a file dropped unhandled would navigate it to the file: any drag that holds
    // files is taken here, and kept only by an awake agent
    const onDragOver = (e: DragEvent<HTMLElement>) => {
        if (dragHasFiles(e.dataTransfer)) {
            e.preventDefault();
            e.dataTransfer.dropEffect = asleep ? "none" : "copy";
        }
    };
    const onDrop = (e: DragEvent<HTMLElement>) => {
        if (!dragHasFiles(e.dataTransfer)) {
            return;
        }
        e.preventDefault();
        if (!asleep) {
            att.addFiles(Array.from(e.dataTransfer.files));
        }
    };
    const showStop = !asleep && agent.blockId != null && canStop(agent.state, agent.sleeping);
    return (
        <div
            {...dataAttrs}
            data-agent-chat-composer={agent.id}
            onDragOver={onDragOver}
            onDrop={onDrop}
            className="mx-auto flex w-full max-w-[760px] flex-col gap-2 rounded-[12px] border border-edge-mid bg-surface-raised px-3 py-[10px] focus-within:border-edge-strong"
        >
            {asleep ? null : <AttachmentTray items={att.attachments} onRemove={att.remove} onRetry={att.retry} />}
            <textarea
                ref={taRef}
                rows={2}
                value={text}
                readOnly={waking}
                aria-label="Message"
                onChange={(e) => {
                    setText(e.target.value);
                    mention.onCaret(e.target);
                }}
                onSelect={(e) => mention.onCaret(e.currentTarget)}
                onPaste={asleep ? undefined : att.onPaste}
                onKeyDown={(e) => {
                    // the `@` picker's keys (↑↓, Enter and Tab to pick, Escape to close) come first
                    mention.onKeyDown(e);
                    if (e.defaultPrevented) {
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
                placeholder={placeholder}
                className="block min-w-0 resize-none overflow-y-auto bg-transparent text-[13px] leading-[19px] text-primary outline-none placeholder:text-muted"
            />
            {mention.list}
            <div className="flex items-center gap-1.5">
                {asleep ? null : <AttachButton onClick={attach} />}
                <div className="flex-1" />
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
                {/* asleep (and while a wake is in flight) the button says what it is doing in words: Waking… is the one
                    sign that the message was taken */}
                <button
                    type="button"
                    data-chat-send
                    title={blocker ?? "Send"}
                    aria-label={asleep || waking ? undefined : "Send"}
                    onClick={submit}
                    disabled={!sendable}
                    className={cn(
                        "flex flex-none cursor-pointer items-center justify-center rounded-[8px] bg-accent text-background hover:opacity-90 focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-surface-raised disabled:cursor-default disabled:opacity-40 disabled:hover:opacity-40",
                        asleep || waking ? "h-[30px] px-3 text-[12px] font-semibold" : "h-[30px] w-[30px]"
                    )}
                >
                    {waking ? "Waking…" : asleep ? "Send" : <ArrowUp size={15} strokeWidth={2.2} aria-hidden />}
                </button>
            </div>
        </div>
    );
}
