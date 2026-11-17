// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0
//
// The commit suggestion as a card in Chat (docs/superpowers/specs/2026-11-17-chat-commit-card-design.md): while the agent
// waits on you, the message in an editable box, one tick per file and Commit, which sends the agent one line holding the
// message and the ticked files (the agent commits in its own turn). Once sent, or once the agent went on or you replied,
// the card folds into its ✓ row. What the card is doing is `commitMode`'s (chatcommit.ts); the line and strings are its too.

import { cn } from "@/util/util";
import { atom, useAtom, type PrimitiveAtom } from "jotai";
import { GitCommitHorizontal } from "lucide-react";
import type { ReactNode } from "react";
import type { AgentVM } from "./agentsviewmodel";
import { ERROR_LINE, FIELD, useAction } from "./brainstormui";
import { CardShell, DoneRow, FOCUS_RING, PRIMARY_BTN, TickBox, type CardState } from "./chatbrainstormparts";
import {
    commitDoneLine,
    commitHead,
    commitLine,
    commitRecord,
    type CommitMode,
    type CommitSuggestion,
} from "./chatcommit";
import { sendCardLine } from "./chatverdictsend";

/** What you changed on a card not yet sent: the message as edited and the files you unticked. */
type CommitDraft = { message: string; off: readonly string[] };

// the drafts, by agent and card key: a card that remounts (a scroll, an agent switch) keeps your edits until it is sent;
// a card nobody touched has none and reads the block as written
const draftsAtom = atom<Record<string, CommitDraft>>({}) as PrimitiveAtom<Record<string, CommitDraft>>;

// the box grows with the message, to a point, then scrolls
const MAX_ROWS = 10;

function CommitBody({
    commitKey,
    commit,
    state,
    agent,
}: {
    commitKey: string;
    commit: CommitSuggestion;
    state: CardState;
    agent?: AgentVM;
}) {
    const act = useAction();
    const [drafts, setDrafts] = useAtom(draftsAtom);
    const waiting = state === "waiting";
    const draftKey = `${agent?.id ?? ""}/${commitKey}`;
    const draft: CommitDraft = drafts[draftKey] ?? { message: commit.message, off: [] };
    const off = new Set(draft.off);
    const ticked = commit.files.filter((f) => !off.has(f));
    const edit = (next: Partial<CommitDraft>): void =>
        setDrafts((prev) => ({ ...prev, [draftKey]: { ...(prev[draftKey] ?? draft), ...next } }));
    const toggle = (file: string): void =>
        edit({ off: off.has(file) ? draft.off.filter((f) => f !== file) : [...draft.off, file] });
    const send = (): void => {
        if (agent == null) {
            return;
        }
        const line = commitLine(draft.message, ticked);
        void act.run(async () => {
            await sendCardLine(agent, line, (seen) => commitRecord(commitKey, ticked.length, line, seen, Date.now()));
            setDrafts(({ [draftKey]: _sent, ...rest }) => rest);
        });
    };
    const disabled = act.busy || agent == null;
    return (
        <CardShell
            kind="commit"
            state={state}
            head={commitHead(commit.files.length)}
            icon={<GitCommitHorizontal size={14} strokeWidth={2} className="flex-none" aria-hidden />}
            extra={{ "data-chat-ccard": commitKey }}
        >
            {waiting ? (
                <textarea
                    data-chat-ccard-message
                    aria-label="Commit message"
                    rows={Math.min(MAX_ROWS, Math.max(2, draft.message.split("\n").length))}
                    value={draft.message}
                    disabled={disabled}
                    onChange={(e) => edit({ message: e.target.value })}
                    className={cn(FIELD, "w-full font-mono text-[12.5px]")}
                />
            ) : (
                <pre
                    data-chat-ccard-message
                    className="m-0 overflow-x-auto rounded-[8px] border border-edge-mid bg-surface px-[12px] py-[9px] font-mono text-[12.5px] leading-[1.5] whitespace-pre-wrap text-primary"
                >
                    {commit.message}
                </pre>
            )}
            <div role="group" aria-label="Files" className="flex flex-col gap-[4px]">
                {commit.files.map((file, i) => (
                    <div
                        key={file}
                        data-chat-ccard-file={file}
                        className="flex min-w-0 items-center overflow-hidden rounded-[8px] border border-edge-mid bg-surface"
                    >
                        {waiting ? (
                            <TickBox
                                i={i}
                                on={!off.has(file)}
                                disabled={disabled}
                                onToggle={() => toggle(file)}
                                attrs={{ "data-chat-ccard-tick": "" }}
                                label={`Include ${file}`}
                            />
                        ) : null}
                        <span
                            className={cn(
                                "min-w-0 truncate px-[12px] py-[6px] font-mono text-[12px]",
                                off.has(file) ? "text-muted line-through" : "text-secondary"
                            )}
                        >
                            {file}
                        </span>
                    </div>
                ))}
            </div>
            {waiting ? (
                <div className="flex flex-wrap items-center gap-[8px] border-t border-edge-mid pt-[10px]">
                    <button
                        type="button"
                        data-chat-ccard-commit
                        disabled={disabled || ticked.length === 0 || draft.message.trim() === ""}
                        onClick={send}
                        className={cn(PRIMARY_BTN, FOCUS_RING)}
                    >
                        Commit
                    </button>
                    <span className="ml-auto text-[12px] text-muted">Or type below to decline</span>
                </div>
            ) : null}
            {act.error ? (
                <div role="alert" data-chat-ccard-error className={ERROR_LINE}>
                    {act.error}
                </div>
            ) : null}
        </CardShell>
    );
}

/** The commit suggestion as Chat draws it: a card while it waits on you (or the agent works, or has exited), its ✓ row
 *  once it folds (`mode`, from `commitMode`). `commitKey` is the part's key, which the send record names; `agent` takes
 *  the Commit line. */
export function ChatCommitCard(p: {
    commitKey: string;
    commit: CommitSuggestion;
    mode: CommitMode;
    agent?: AgentVM;
}): ReactNode {
    if (p.mode.mode === "folded") {
        return <DoneRow kind="commit" head={commitDoneLine(p.commit, p.mode.outcome)} />;
    }
    return <CommitBody commitKey={p.commitKey} commit={p.commit} state={p.mode.mode} agent={p.agent} />;
}
