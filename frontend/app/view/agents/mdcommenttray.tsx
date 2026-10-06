// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0
//
// The File tab's comment tray (docs/superpowers/specs/2026-10-06-md-comments-design.md): how many comments wait
// across the agent's files, Copy, and the one Send that pastes them into this agent's terminal as one message (an
// agent with no terminal gets Copy alone). The File tab's Ctrl+Enter presses data-md-send, so every check lives here.

import { formatChordString } from "@/util/keysym";
import { cn, fireAndForget } from "@/util/util";
import { useAtomValue } from "jotai";
import { Check, Plus } from "lucide-react";
import { useState, type ReactNode } from "react";
import type { AgentsViewModel } from "./agents";
import type { AgentVM } from "./agentsviewmodel";
import { sendLineComments } from "./linereviewsend";
import { countLine, formatMdComments } from "./mdcomments";
import { mdCommentAtom, recordSend, sendBlock, type MdSendBlock, type MdSendResult } from "./mdcommentstore";
import { revealMdBox } from "./mddoc";

const TRAY = "flex flex-none border-t border-border bg-surface px-[18px] text-[12.5px]";
const ACCENT_BTN =
    "flex cursor-pointer items-center gap-2 rounded-[8px] border-0 bg-accent px-3.5 py-[7px] text-[12.5px] font-semibold text-background hover:bg-accenthover disabled:cursor-default disabled:opacity-50";
const SECONDARY_BTN =
    "flex cursor-pointer items-center gap-2 rounded-[8px] border border-edge-mid bg-surface-raised px-3 py-[6px] text-[12.5px] font-semibold text-secondary hover:border-edge-strong hover:bg-surface-hover disabled:cursor-default disabled:opacity-50";
const KBD = "rounded-[4px] bg-background/20 px-[5px] font-mono text-[10.5px]";

function plural(n: number, word: string): string {
    return `${n} ${word}${n === 1 ? "" : "s"}`;
}

// the second line: why Send is disabled, else what the last copy or failure did. No terminal has no line: Send is
// not offered at all, and Copy is the one action (spec item 14). An unsaved note's line is a button that shows its box,
// which may sit in another file (spec item 11)
function statusLine(block: MdSendBlock, last: MdSendResult | undefined, showBox: () => void): ReactNode {
    const line = (tone: string, body: ReactNode, title?: string) => (
        <span data-md-tray-line title={title} className={cn("flex min-w-0 items-center gap-[6px] text-[12px]", tone)}>
            {body}
        </span>
    );
    if (block?.kind === "asking") {
        return line(
            "text-muted",
            <>
                <span className="h-1.5 w-1.5 flex-none rounded-full bg-asking" aria-hidden />
                {block.agent} is waiting on a question — answer it first
            </>
        );
    }
    if (block?.kind === "draft") {
        return line(
            "text-muted",
            <button
                type="button"
                data-md-show-box
                title="Show the open comment"
                onClick={showBox}
                className="cursor-pointer border-0 bg-transparent p-0 text-left text-[12px] text-muted underline-offset-2 hover:text-primary hover:underline"
            >
                Add or cancel the open comment first
            </button>
        );
    }
    if (last?.ok === false) {
        const text = last.agent ? `Couldn't reach ${last.agent} — comments kept` : "Couldn't copy — comments kept";
        return line("text-error", text, last.error);
    }
    if (last?.ok === true && last.kind === "copied") {
        return line(
            "text-success",
            <>
                <Check size={13} strokeWidth={2.2} className="flex-none" aria-hidden />
                Copied. The comments stay until you send or delete them.
            </>
        );
    }
    return null;
}

// shownAbs: the file the File tab shows, so the reason line knows whether the open box is here or elsewhere
export function MdCommentTray({
    model,
    agent,
    shownAbs,
}: {
    model: AgentsViewModel;
    agent: AgentVM;
    shownAbs: string | null;
}) {
    const state = useAtomValue(mdCommentAtom(agent.id));
    const [busy, setBusy] = useState(false);
    const n = state.comments.length;
    const last = state.lastSend;
    // the first comment, being written: the tray shows Send blocked rather than the hint (board Compose)
    const drafting = state.box != null && state.box.text.trim() !== "";

    if (n === 0 && !drafting) {
        if (last?.ok === true && last.kind === "sent") {
            return (
                <div data-md-tray className={cn(TRAY, "items-center gap-2 py-[13px] text-success")}>
                    <Check size={14} strokeWidth={2.2} aria-hidden />
                    <span className="font-semibold">Sent {plural(last.count, "comment")}</span>
                    <span className="min-w-0 truncate text-muted">to {last.agent}</span>
                </div>
            );
        }
        return (
            <div data-md-tray className={cn(TRAY, "flex-wrap items-center gap-[6px] py-[11px] text-[12px] text-muted")}>
                Select text and press
                <kbd className="rounded-[4px] border border-edge-mid px-[5px] font-mono text-[10.5px] text-secondary">
                    c
                </kbd>
                , or hover a block and click
                <span className="inline-flex h-4 w-4 items-center justify-center rounded-[5px] bg-accent text-background">
                    <Plus size={10} strokeWidth={3} aria-hidden />
                </span>
                , to comment.
            </div>
        );
    }

    const block = sendBlock(state, agent);
    const run = (work: () => Promise<MdSendResult>) => {
        setBusy(true);
        fireAndForget(async () => {
            try {
                recordSend(agent.id, await work());
            } finally {
                setBusy(false);
            }
        });
    };
    const send = () =>
        run(async () => {
            const r = await sendLineComments(agent, formatMdComments(state.comments));
            if (r.ok === false) {
                console.error(`md comments: couldn't send to ${agent.name}:`, r.error);
                return { ok: false, agent: agent.name, error: r.error };
            }
            return { ok: true, kind: "sent", agent: agent.name, count: n };
        });
    const copy = () =>
        run(async () => {
            try {
                await navigator.clipboard.writeText(formatMdComments(state.comments));
                return { ok: true, kind: "copied" };
            } catch (e) {
                console.error("md comments: couldn't copy:", e);
                return { ok: false, agent: "", error: String((e as Error)?.message ?? e) };
            }
        });
    const chord = formatChordString("Ctrl:Enter");

    return (
        <div data-md-tray className={cn(TRAY, "flex-col gap-[6px] py-[10px]")}>
            <div className="flex items-center gap-2">
                {n > 0 ? (
                    <span className="min-w-0 flex-1 truncate font-semibold text-ink-hi">
                        {countLine(state.comments)}
                    </span>
                ) : (
                    <span className="min-w-0 flex-1 truncate text-[12px] text-muted">No comments yet</span>
                )}
                <button type="button" data-md-copy disabled={busy || n === 0} onClick={copy} className={SECONDARY_BTN}>
                    Copy
                </button>
                {block?.kind !== "noterm" ? (
                    <button
                        type="button"
                        data-md-send
                        disabled={block != null || busy || n === 0}
                        title={`Send to ${agent.name} (${chord})`}
                        onClick={send}
                        className={ACCENT_BTN}
                    >
                        {n > 0 ? `Send ${plural(n, "comment")}` : "Send"}
                        <span className={KBD}>{chord}</span>
                    </button>
                ) : null}
            </div>
            {statusLine(block, last, () => revealMdBox(model, agent.id, shownAbs))}
        </div>
    );
}
