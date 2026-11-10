// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { RpcApi } from "@/app/store/wshclientapi";
import { TabRpcClient } from "@/app/store/wshrpcutil";
import { pasteIntoTerm } from "@/app/view/term/termpaste";
import { cn, fireAndForget, stringToBase64 } from "@/util/util";
import { forwardRef, useImperativeHandle, useLayoutEffect, useRef, useState, type RefObject } from "react";
import { wakeAgent, wakeErrorToast } from "./agentsleep";
import type { AgentState, AgentVM } from "./agentsviewmodel";
import { messageWithAttachments, type Attachment } from "./composerattachments";
import { setWakeDraft, useWakeDraft, useWaking } from "./wakingstore";

// one line at 12px (rows={1}: the default two rows would set the floor instead); it grows as text wraps
const ComposerMinH = 32;
const ComposerMaxH = 160; // grows up to here, then the textarea scrolls

/** Pure: a composer can send only with non-empty text AND a live terminal block. Shared by send(), the
 *  Enter guard, and the button's disabled state so all three agree (T4). */
export function canSendComposer(text: string, blockId?: string): boolean {
    return text.trim() !== "" && blockId != null;
}

/** Pure: a Stop button has something to stop: the agent is working or asking, and awake (an asleep agent has no
 *  process to send Esc to). `sleeping` is the roster's record (`AgentVM.sleeping`) or a plain flag. */
export function canStop(state: AgentState, sleeping?: boolean | AgentVM["sleeping"]): boolean {
    return !sleeping && (state === "working" || state === "asking");
}

/** Grows a textarea with its text, between `minH` and `maxH` (px), then lets it scroll. The height is the border box:
 *  scrollHeight leaves out the border, so without it a box of two lines or more came out short and showed a scrollbar.
 *  The 1px more covers scrollHeight's rounding at a page zoom (cockpit.zoom 1.25 left a wrapped placeholder 1px short). */
export function useGrowingTextarea(
    ref: RefObject<HTMLTextAreaElement | null>,
    text: string,
    minH: number,
    maxH: number
): void {
    useLayoutEffect(() => {
        const el = ref.current;
        if (!el) {
            return;
        }
        el.style.height = "auto";
        const border = el.offsetHeight - el.clientHeight;
        el.style.height = `${Math.min(Math.max(el.scrollHeight + border + 1, minH), maxH)}px`;
    }, [text]);
}

/** Types a message into an agent's terminal and presses Enter. A message with a line break (Shift+Enter, or an
 *  attachment's block) goes as a paste, then Enter on its own: typed raw in one chunk, Claude Code reads a multi-line
 *  chunk as a paste and takes the "\r" at its end for one more line, so the message sat in its box unsent. One line,
 *  or a terminal that is not mounted to paste into, is typed with its Enter. */
function typeIntoAgent(blockId: string, message: string): Promise<void> {
    const type = (data: string) =>
        RpcApi.ControllerInputCommand(TabRpcClient, { blockid: blockId, inputdata64: stringToBase64(data) });
    if (message.includes("\n") && pasteIntoTerm(blockId, message)) {
        return type("\r");
    }
    return type(message + "\r");
}

export interface AgentComposerHandle {
    fill: (text: string) => void;
}

/** What a send needs to know of the agent: its tab id (the wake draft's key), its name (the wake error's), and whether
 *  it sleeps. */
export interface AgentSendTarget {
    id: string;
    name?: string;
    sleeping?: AgentVM["sleeping"];
}

export interface AgentSend {
    text: string;
    setText: (text: string) => void;
    /** The exact text a send types: the box's text with its attachments' blocks. */
    message: string;
    /** Something to send (text, or a ready attachment), a live block, and no wake in flight. */
    canSend: boolean;
    /** A wake is relaunching this agent, from this box or from anywhere else. */
    waking: boolean;
    /** Sends the box. Answers whether it did (false when `canSend` is not); the box's text is cleared by it, the
     *  attachments' tray is the caller's. */
    send: () => boolean;
}

// Sends free text to an agent's terminal block (typeIntoAgent: "\r" submits, the PTY treats CR as Enter). A sleeping agent has no process to type into: given
// its agent, the message goes through Wake instead, which delivers it once the agent is back, and the text stays in
// the box until then (and for good when the wake fails). A sleeping agent's text is its wake draft (wakingstore), so
// it outlives the box: picking another agent mid-wake and coming back still shows what is being sent.
// The one send path of both composers (this file's and chatcomposer.tsx's): `attachments`, when given, ride the message
// (messageWithAttachments: images as the "Attached images:" block chat draws as pictures, other files as the "read
// these files" block), and alone they make a message.
export function useAgentSend(
    blockId: string | undefined,
    agent: AgentSendTarget | undefined,
    attachments?: Attachment[]
): AgentSend {
    const draftId = agent?.sleeping ? agent.id : undefined;
    const draft = useWakeDraft(draftId);
    const [localText, setLocalText] = useState("");
    const text = draftId != null ? draft : localText;
    const setText = (t: string) => (draftId != null ? setWakeDraft(draftId, t) : setLocalText(t));
    const [sending, setSending] = useState(false);
    // a wake started anywhere else (the card's Wake, a row's menu) holds the box too: a message now would be a second wake
    const waking = useWaking(agent?.id) || sending;
    const message = messageWithAttachments(text.trim(), attachments ?? []);
    const canSend = canSendComposer(message, blockId) && !waking;
    const send = (): boolean => {
        if (!canSend) {
            return false;
        }
        if (agent?.sleeping) {
            const id = agent.id;
            setSending(true);
            fireAndForget(async () => {
                try {
                    await wakeAgent(id, { message });
                    setWakeDraft(id, "");
                } catch (e) {
                    wakeErrorToast(agent.name, e);
                } finally {
                    setSending(false);
                }
            });
            return true;
        }
        fireAndForget(() => typeIntoAgent(blockId!, message));
        setText("");
        return true;
    };
    return { text, setText, message, canSend, waking, send };
}

export const AgentComposer = forwardRef<
    AgentComposerHandle,
    {
        blockId?: string;
        agent?: AgentSendTarget;
        placeholder: string;
        className?: string;
        onEscape?: () => void;
    }
>(function AgentComposer({ blockId, agent, placeholder, className, onEscape }, ref) {
    const { text, setText, canSend, waking, send } = useAgentSend(blockId, agent);
    const draftId = agent?.sleeping ? agent.id : undefined;
    const taRef = useRef<HTMLTextAreaElement>(null);
    useImperativeHandle(
        ref,
        () => ({
            fill: (t: string) => {
                setText(t);
                taRef.current?.focus();
            },
        }),
        [draftId]
    );
    useGrowingTextarea(taRef, text, ComposerMinH, ComposerMaxH);
    return (
        <div
            data-agent-composer
            className={cn("flex shrink-0 items-end gap-2 border-t border-border px-[14px] py-2", className)}
        >
            <textarea
                ref={taRef}
                rows={1}
                value={text}
                readOnly={waking}
                onChange={(e) => setText(e.target.value)}
                onKeyDown={(e) => {
                    if (e.key === "Enter" && !e.shiftKey) {
                        e.preventDefault();
                        send();
                    } else if (e.key === "Escape" && onEscape && !waking) {
                        // not while waking: closing the composer would drop the text a failed wake keeps
                        e.preventDefault();
                        onEscape();
                    }
                }}
                placeholder={placeholder}
                className="min-w-0 flex-1 resize-none overflow-y-auto rounded-sm border border-border bg-transparent px-2.5 py-1.5 text-[12px] leading-[1.4] text-primary outline-none placeholder:text-muted focus:border-accent-700"
            />
            <button
                type="button"
                onClick={() => send()}
                disabled={!canSend}
                className="shrink-0 cursor-pointer rounded-[5px] border border-edge-mid px-2.5 py-1 text-[11px] text-secondary hover:border-edge-strong hover:bg-surface-hover hover:text-primary disabled:cursor-default disabled:opacity-40"
            >
                {waking ? "Waking…" : "Send"}
            </button>
        </div>
    );
});
