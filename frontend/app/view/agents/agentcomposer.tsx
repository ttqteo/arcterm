// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { RpcApi } from "@/app/store/wshclientapi";
import { TabRpcClient } from "@/app/store/wshrpcutil";
import { cn, fireAndForget, stringToBase64 } from "@/util/util";
import { forwardRef, useImperativeHandle, useLayoutEffect, useRef, useState } from "react";
import { wakeAgent, wakeErrorToast } from "./agentsleep";
import type { AgentVM } from "./agentsviewmodel";

const ComposerMinH = 64; // ~3 lines at 12px
const ComposerMaxH = 160; // grows up to here, then the textarea scrolls

/** Pure: a composer can send only with non-empty text AND a live terminal block. Shared by send(), the
 *  Enter guard, and the button's disabled state so all three agree (T4). */
export function canSendComposer(text: string, blockId?: string): boolean {
    return text.trim() !== "" && blockId != null;
}

export interface AgentComposerHandle {
    fill: (text: string) => void;
}

// Sends free text to an agent's terminal block. "\r" submits (the PTY treats CR as Enter), mirroring
// how term-model writes xterm input via ControllerInputCommand. A sleeping agent has no process to type into: given
// its agent, the message goes through Wake instead, which delivers it once the agent is back, and the text stays in
// the box until then (and for good when the wake fails).
export const AgentComposer = forwardRef<
    AgentComposerHandle,
    {
        blockId?: string;
        agent?: { id: string; name?: string; sleeping?: AgentVM["sleeping"] };
        placeholder: string;
        className?: string;
        onEscape?: () => void;
    }
>(function AgentComposer({ blockId, agent, placeholder, className, onEscape }, ref) {
    const [text, setText] = useState("");
    const [waking, setWaking] = useState(false);
    const taRef = useRef<HTMLTextAreaElement>(null);
    useImperativeHandle(
        ref,
        () => ({
            fill: (t: string) => {
                setText(t);
                taRef.current?.focus();
            },
        }),
        []
    );
    useLayoutEffect(() => {
        const el = taRef.current;
        if (!el) {
            return;
        }
        el.style.height = "auto";
        el.style.height = `${Math.min(Math.max(el.scrollHeight, ComposerMinH), ComposerMaxH)}px`;
    }, [text]);
    const canSend = canSendComposer(text, blockId) && !waking;
    const send = () => {
        if (!canSend) {
            return;
        }
        if (agent?.sleeping) {
            setWaking(true);
            fireAndForget(async () => {
                try {
                    await wakeAgent(agent.id, { message: text.trim() });
                    setText("");
                } catch (e) {
                    wakeErrorToast(agent.name, e);
                } finally {
                    setWaking(false);
                }
            });
            return;
        }
        fireAndForget(() =>
            RpcApi.ControllerInputCommand(TabRpcClient, {
                blockid: blockId!,
                inputdata64: stringToBase64(text.trim() + "\r"),
            })
        );
        setText("");
    };
    return (
        <div
            data-agent-composer
            className={cn("flex shrink-0 items-end gap-2 border-t border-border px-[14px] py-2", className)}
        >
            <textarea
                ref={taRef}
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
                className="min-w-0 flex-1 resize-none overflow-y-auto rounded-sm border border-border bg-transparent px-2.5 py-1.5 text-[12px] leading-[1.4] text-primary outline-none placeholder:text-secondary"
            />
            <button
                type="button"
                onClick={send}
                disabled={!canSend}
                className="shrink-0 cursor-pointer rounded-[5px] border border-border px-2.5 py-1 text-[11px] text-secondary hover:bg-white/[0.04] disabled:opacity-40"
            >
                {waking ? "Waking…" : "Send"}
            </button>
        </div>
    );
});
