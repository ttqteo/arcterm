// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0
//
// The footer of the chat box: the agent's model, how full its context is, and a chip with Claude Code's permission
// mode. The mode is read off the terminal that stays mounted under the chat (tuiscreen.ts) and a click on the chip
// presses Shift+Tab there, which is how Claude Code cycles it. A dialog or a menu covers Claude Code's footer for a
// while: a read that finds none keeps the last mode seen, and until one is read the chip is not drawn.

import { RpcApi } from "@/app/store/wshclientapi";
import { TabRpcClient } from "@/app/store/wshrpcutil";
import { readTermLines } from "@/app/view/term/termpaste";
import { cn, fireAndForget, stringToBase64 } from "@/util/util";
import { Fragment, useCallback, useEffect, useRef, useState } from "react";
import type { AgentVM } from "./agentsviewmodel";
import { footerParts, modeLabel } from "./chatfootermodel";
import { tuiMode, type ClaudeMode } from "./tuiscreen";

// the bottom rows of the screen hold the footer, even under a notice or the effort line
const SCREEN_ROWS = 12;
const POLL_MS = 1000;
const AFTER_CLICK_MS = 250;
const SHIFT_TAB = "\x1b[Z";

// The last mode Claude Code's footer named, read on mount, each second while the page is visible and shortly after a
// click; `refresh` reads now. A read that finds no footer leaves the mode as it was.
function useTuiMode(blockId: string | undefined): { mode: ClaudeMode | null; refresh: (delayMs: number) => void } {
    const [mode, setMode] = useState<ClaudeMode | null>(null);
    const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
    const read = useCallback(() => {
        if (blockId == null) {
            return;
        }
        const lines = readTermLines(blockId, SCREEN_ROWS);
        const next = lines == null ? null : tuiMode(lines);
        if (next != null) {
            setMode(next);
        }
    }, [blockId]);
    useEffect(() => {
        setMode(null);
        read();
        const poll = setInterval(() => {
            if (document.visibilityState === "visible") {
                read();
            }
        }, POLL_MS);
        return () => {
            clearInterval(poll);
            if (timer.current != null) {
                clearTimeout(timer.current);
                timer.current = null;
            }
        };
    }, [read]);
    const refresh = useCallback(
        (delayMs: number) => {
            if (timer.current != null) {
                clearTimeout(timer.current);
            }
            timer.current = setTimeout(() => {
                timer.current = null;
                read();
            }, delayMs);
        },
        [read]
    );
    return { mode, refresh };
}

export function ChatFooter({ agent }: { agent: AgentVM }) {
    const asleep = agent.sleeping != null;
    const { mode, refresh } = useTuiMode(asleep ? undefined : agent.blockId);
    if (asleep) {
        return null;
    }
    const pct = agent.usage?.contextpct;
    const parts = footerParts(agent.model, pct);
    if (parts.length === 0 && mode == null) {
        return null;
    }
    const cycle = () => {
        const blockid = agent.blockId;
        if (blockid == null) {
            return;
        }
        fireAndForget(() =>
            RpcApi.ControllerInputCommand(TabRpcClient, { blockid, inputdata64: stringToBase64(SHIFT_TAB) })
        );
        refresh(AFTER_CLICK_MS);
    };
    return (
        <div data-chat-footer className="flex min-w-0 items-center gap-2 text-[11.5px] text-muted">
            {parts.map((part, i) => (
                <Fragment key={i}>
                    {i > 0 ? <span aria-hidden>·</span> : null}
                    <span className={cn("truncate", part.warn && "text-warning")}>{part.text}</span>
                </Fragment>
            ))}
            {mode != null ? (
                <button
                    type="button"
                    data-chat-mode={mode}
                    title="Cycles the mode, as Shift+Tab in the terminal"
                    onClick={cycle}
                    className="flex-none cursor-pointer rounded-[6px] border border-edge-mid px-2 py-[2px] hover:border-edge-strong focus-visible:ring-2 focus-visible:ring-accent"
                >
                    {modeLabel(mode)}
                </button>
            ) : null}
        </div>
    );
}
