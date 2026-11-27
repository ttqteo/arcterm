// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0
//
// An agent's sidebar row answering its permission prompt (spec 2026-11-27-sidebar-permission-row-design.md): the second
// line reads what the head of its queue asks in place of "asking" (PermissionRowNote), and a third line under it holds
// Allow and Deny, "+N more · waiting 1m" or the refusal line (PermissionRowLine), with no hover needed. A head the row may
// not allow (plan approval, an MCP tool) offers "Answer in chat" instead. The queue and the answer are the chat card's
// (permissionstore.ts), and the rules what the row shows are permissionmodel.ts's (rowPermission).

import { composerReveal } from "@/app/element/motiontokens";
import { cn, fireAndForget } from "@/util/util";
import { AnimatePresence, motion } from "motion/react";
import type React from "react";
import type { AgentVM } from "./agentsviewmodel";
import {
    cardShown,
    choiceAnswer,
    permissionRowLabel,
    permissionSummaryLine,
    permissionTitle,
    rowPermission,
    rowWaitLine,
    transformMoves,
    type PermissionChoice,
    type RowPermission,
} from "./permissionmodel";
import { answerPermission, usePermission, usePermissionRequestState } from "./permissionstore";

// 22 px, the prototype's size (A-third-line.dc.html)
const BTN =
    "flex h-[22px] flex-none cursor-pointer items-center rounded-[5px] px-[10px] text-[11.5px] font-semibold disabled:cursor-default disabled:opacity-50";
const ALLOW_BTN = cn(BTN, "bg-accent text-background hover:bg-accenthover");
const DENY_BTN = cn(
    BTN,
    "border border-edge-mid bg-surface-raised text-muted hover:border-edge-strong hover:bg-surface-hover"
);

export type RowPermissionState = {
    oref: string | undefined;
    row: RowPermission | null;
    behind: number; // how many requests wait behind the head
    busy: boolean;
    error?: string;
};

/** The row's view of agent's permission queue. `otherAsk`: another ask holds the row (a held card such as Token burn, a
 *  doc review, a brainstorm's ask), so the row offers no Allow. Only a row whose agent is awake and not idle reads the
 *  queue: an idle row (most of the tree) loads none, and the event still fills the atom for when it is read. */
export function useRowPermission(agent: AgentVM, otherAsk: boolean): RowPermissionState {
    const shown = cardShown(agent);
    const oref = agent.blockId != null && shown ? `block:${agent.blockId}` : undefined;
    const requests = usePermission(oref);
    const { busy, error } = usePermissionRequestState(oref, requests[0]?.id);
    const row = oref != null ? rowPermission(requests, { shown, otherAsk, refused: error != null }) : null;
    return { oref, row, behind: Math.max(0, requests.length - 1), busy, error };
}

/** The second line's words for a head the row shows, in place of "asking"; null when the row shows none. */
export function PermissionRowNote({ perm }: { perm: RowPermissionState }) {
    const row = perm.row;
    if (row == null || row.kind === "refusal") {
        return null;
    }
    const label = permissionRowLabel(row.head);
    return (
        <span
            data-agent-perm-note
            title={row.kind === "answer" ? permissionSummaryLine(row.head) : permissionTitle(row.head.toolname)}
            className={cn(
                "min-w-0 max-w-[55%] truncate font-semibold text-warning",
                label.mono && "font-mono text-[10.5px]"
            )}
        >
            {label.text}
        </span>
    );
}

// a row re-sorting slides on a transform of the row or one of its wrappers, up to the tree
function rowMoving(el: HTMLElement): boolean {
    for (let n: HTMLElement | null = el; n != null && !n.hasAttribute("data-agent-tree"); n = n.parentElement) {
        if (transformMoves(getComputedStyle(n).transform)) {
            return true;
        }
    }
    return false;
}

// a press on one of the line's buttons is the button's: it never selects or opens the row, even on a disabled button;
// the line's blank space still selects the row as the rest of it does
const stopOnButton = (e: React.SyntheticEvent) => {
    if ((e.target as HTMLElement).closest("button") != null) {
        e.stopPropagation();
    }
};

/** The third line: Allow and Deny with the wait at the right, "Answer in chat" for a head the row may not allow, or the
 *  refusal line alone. It opens and closes on the tree's reveal motion. `now` is the tree's clock. */
export function PermissionRowLine({
    agentId,
    perm,
    now,
    onOpenChat,
}: {
    agentId: string;
    perm: RowPermissionState;
    now: number;
    onOpenChat: () => void;
}) {
    const { row, oref, busy, error } = perm;
    // a click aimed at the row's button while the row slides into place is dropped
    const guarded = (fn: () => void) => (e: React.MouseEvent<HTMLButtonElement>) => {
        e.stopPropagation();
        if (!rowMoving(e.currentTarget)) {
            fn();
        }
    };
    const answer = (choice: PermissionChoice) => {
        if (oref != null && row?.kind === "answer") {
            const id = row.head.id;
            const screen = row.screen;
            fireAndForget(() => answerPermission(oref, id, choiceAnswer(choice, screen)));
        }
    };
    const errorLine =
        error != null ? (
            <span
                data-agent-perm-error
                role="alert"
                title={error}
                className="min-w-0 truncate text-[10.5px] text-error"
            >
                {error}
            </span>
        ) : null;
    let body: React.ReactNode = null;
    if (row?.kind === "answer") {
        body = (
            <>
                <button
                    type="button"
                    data-agent-perm-allow
                    disabled={busy}
                    title={row.screen ? "Pick the dialog's Yes" : "Allow this once"}
                    className={ALLOW_BTN}
                    onClick={guarded(() => answer("allow"))}
                >
                    Allow
                </button>
                <button
                    type="button"
                    data-agent-perm-deny
                    disabled={busy}
                    title="Deny this request; the agent's turn ends"
                    className={DENY_BTN}
                    onClick={guarded(() => answer("deny"))}
                >
                    Deny
                </button>
                <span className="min-w-0 flex-1" />
                {errorLine ?? (
                    <span
                        data-agent-perm-wait
                        className="flex-none whitespace-nowrap text-[10.5px] tabular-nums text-muted"
                    >
                        {rowWaitLine(perm.behind, row.head.ts, now)}
                    </span>
                )}
            </>
        );
    } else if (row?.kind === "chat") {
        body = (
            <>
                <button
                    type="button"
                    data-agent-perm-chat
                    title="This prompt has choices of its own: answer it in the agent's chat"
                    className="flex-none cursor-pointer text-[11.5px] text-accent-soft hover:underline"
                    onClick={guarded(onOpenChat)}
                >
                    Answer in chat ↗
                </button>
                <span className="min-w-0 flex-1" />
                {errorLine}
            </>
        );
    } else if (row?.kind === "refusal") {
        body = errorLine;
    }
    return (
        <AnimatePresence initial={false}>
            {body != null ? (
                <motion.div
                    key="perm"
                    variants={composerReveal}
                    initial="initial"
                    animate="animate"
                    exit="exit"
                    className="overflow-hidden"
                >
                    {/* draggable only to cancel a drag begun here: the row is the drag source otherwise */}
                    <div
                        data-agent-perm-line={agentId}
                        draggable
                        onDragStart={(e) => {
                            e.preventDefault();
                            e.stopPropagation();
                        }}
                        onClick={stopOnButton}
                        onDoubleClick={stopOnButton}
                        onMouseDown={stopOnButton}
                        className="mt-[6px] flex min-w-0 items-center gap-[6px]"
                    >
                        {body}
                    </div>
                </motion.div>
            ) : null}
        </AnimatePresence>
    );
}
