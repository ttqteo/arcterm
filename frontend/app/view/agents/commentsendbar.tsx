// frontend/app/view/agents/commentsendbar.tsx
// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

// The bar under the Diff pane that counts the published source's pending comments, names who gets them
// (commentsend.ts decides) and sends them. It reads the stored batch for the source's key, so an ended
// agent's batch still shows with no cwd published; the facts come from the batch's own source.

import * as WOS from "@/app/store/wos";
import { cn } from "@/util/util";
import { atom, useAtomValue, type Atom } from "jotai";
import { Check, CircleAlert, MessageSquare, Plus } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import type { AgentsViewModel } from "./agents";
import { formatAge } from "./agentsviewmodel";
import {
    registerCommentSend,
    resolveRecipient,
    sendBarText,
    sendBatch,
    tauriCommentSendIO,
    type Recipient,
} from "./commentsend";
import { activeCommentSourceAtom, batchSummary, commentStoreAtom, discardBatch, sentNoteAtom } from "./diffcomments";
import { projectListAtom } from "./projectsstore";
import { StatusDot } from "./statusdot";

const NO_RUN: Atom<Run | undefined> = atom(undefined as Run | undefined);
const MINUTE_MS = 60_000;

const barRow = "flex h-[52px] items-center gap-[10px] pl-[18px] pr-[14px]";
const quiet = "text-[12px] text-muted";
const btn = "flex h-[30px] flex-none items-center gap-[8px] rounded-[8px] px-[12px] text-[12px]";

function errText(e: unknown): string {
    return e instanceof Error ? e.message : String(e);
}

// "in 2 files · to", "loom has ended · to", or nothing for a recipient that has to wait
function lead(r: Recipient, files: string): string | null {
    if (r.kind === "wait") {
        return null;
    }
    return r.kind === "new" && r.ended ? `${r.ended} has ended · to` : `${files} · to`;
}

function SentNote({ count, to, at }: { count: number; to: string; at: number }) {
    // the age only moves by the minute
    const [, tick] = useState(0);
    useEffect(() => {
        const id = setInterval(() => tick((n) => n + 1), MINUTE_MS);
        return () => clearInterval(id);
    }, []);
    const age = formatAge(Date.now() - at);
    return (
        <div data-comment-sent-note className={cn(barRow, "gap-[8px]")}>
            <Check size={14} strokeWidth={2.4} className="flex-none text-success" />
            <span className="text-[12.5px] text-ink-hi">
                Sent {count} {count === 1 ? "comment" : "comments"} to {to}
            </span>
            <span className={quiet}>· {age === "just now" ? age : `${age} ago`}</span>
        </div>
    );
}

export function CommentSendBar({ model }: { model: AgentsViewModel }) {
    const source = useAtomValue(activeCommentSourceAtom);
    const store = useAtomValue(commentStoreAtom);
    const notes = useAtomValue(sentNoteAtom);
    const agents = useAtomValue(model.agentsAtom);
    const projects = useAtomValue(projectListAtom);
    const io = useMemo(() => tauriCommentSendIO(model), [model]);
    const [sending, setSending] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [checked, setChecked] = useState<{ cwd: string; ok: boolean } | null>(null);

    const key = source?.key;
    const batch = key != null ? store[key] : undefined;
    const stored = batch?.source;
    const agent = stored?.kind === "agent" ? agents.find((a) => a.id === stored.agentId) : undefined;
    const runId = stored?.kind === "run" ? stored.runId : (agent?.runId ?? stored?.runId);
    const run = useAtomValue(runId ? WOS.getWaveObjectAtom<Run>(WOS.makeORef("run", runId)) : NO_RUN);

    const cwd = stored?.cwd ?? "";
    useEffect(() => {
        if (!cwd) {
            return;
        }
        let live = true;
        void io.exists(cwd).then((ok) => live && setChecked({ cwd, ok }));
        return () => {
            live = false;
        };
    }, [cwd, io]);
    useEffect(() => setError(null), [key]);

    const recipient =
        batch == null
            ? null
            : resolveRecipient(batch, {
                  agent,
                  run,
                  projectPath: projects.find((p) => p.name === stored?.project)?.path,
                  folderExists: checked?.cwd === cwd ? checked.ok : null,
              });

    const send = (): boolean => {
        if (batch == null || recipient == null || recipient.kind === "wait" || sending) {
            return false;
        }
        setSending(true);
        setError(null);
        sendBatch(batch, recipient, io)
            .catch((e) => setError(errText(e)))
            .finally(() => setSending(false));
        return true;
    };
    // Shift+Enter on the surface reaches the latest render's send
    const sendRef = useRef(send);
    useEffect(() => {
        sendRef.current = send;
    });
    useEffect(() => registerCommentSend(() => sendRef.current()), []);

    if (source == null) {
        return null;
    }
    const shell = "flex-none border-t border-border bg-surface font-sans";
    if (batch == null || recipient == null) {
        const note = notes[source.key];
        return (
            <div data-comment-send-bar data-recipient-kind="none" className={shell}>
                {note != null ? (
                    <SentNote {...note} />
                ) : (
                    <div data-comment-hint className="flex h-[32px] items-center px-[18px] text-[11.5px] text-muted">
                        <span>
                            Press <kbd className="font-mono text-ink-mid">m</kbd> or click a line's + to comment for{" "}
                            {source.label}
                        </span>
                    </div>
                )}
            </div>
        );
    }

    const t = sendBarText(batchSummary(batch), recipient);
    // count is "3 comments in 2 files": the bar sets the comments apart from the files
    const cut = t.count.indexOf(" in ");
    const comments = t.count.slice(0, cut);
    const before = lead(recipient, t.count.slice(cut + 1));
    const waiting = recipient.kind === "wait";
    return (
        <div data-comment-send-bar data-recipient-kind={recipient.kind} className={shell}>
            {error != null ? (
                <div
                    data-comment-error
                    className="flex items-center gap-[8px] border-b border-border bg-error/10 px-[18px] py-[8px]"
                >
                    <CircleAlert size={13} className="flex-none text-error" />
                    <span className="text-[12px] text-error-soft">
                        {error.replace(/\.$/, "")}. Your {comments} are kept.
                    </span>
                </div>
            ) : null}
            <div className={barRow}>
                <MessageSquare size={14} className="flex-none text-accent-soft" />
                <span data-comment-count className="flex-none text-[12.5px] font-semibold text-ink-hi">
                    {comments}
                </span>
                {before != null ? <span className={cn(quiet, "flex-none")}>{before}</span> : null}
                {recipient.kind === "live" ? (
                    <span
                        data-comment-recipient
                        className="flex flex-none items-center gap-[6px] text-[12px] text-ink-hi"
                    >
                        {agent != null ? <StatusDot state={agent.state} className="!h-[7px] !w-[7px]" /> : null}
                        {recipient.name}
                    </span>
                ) : recipient.kind === "new" ? (
                    <span
                        data-comment-recipient
                        className="flex flex-none items-center gap-[6px] text-[12px] text-ink-hi"
                    >
                        <Plus size={12} strokeWidth={2.2} className="text-ink-mid" />a new agent
                    </span>
                ) : null}
                <span data-comment-detail className={cn(quiet, "min-w-0 truncate")}>
                    {t.detail}
                </span>
                <span className="flex-1" />
                <button
                    data-comment-discard
                    onClick={() => discardBatch(batch.source.key)}
                    disabled={sending}
                    className={cn(
                        btn,
                        "border border-edge-mid bg-surface-raised font-semibold text-ink-mid hover:text-ink-hi"
                    )}
                >
                    Discard
                </button>
                <button
                    data-comment-send
                    onClick={send}
                    disabled={waiting || sending}
                    title={waiting ? t.detail : undefined}
                    className={cn(
                        btn,
                        "font-bold",
                        waiting || sending
                            ? "cursor-default bg-surface-selected text-ink-faint"
                            : "bg-accent text-background"
                    )}
                >
                    {error != null ? "Send again" : t.action}
                    {waiting ? null : <kbd className="font-mono text-[10.5px] font-normal">⇧↵</kbd>}
                </button>
            </div>
        </div>
    );
}
