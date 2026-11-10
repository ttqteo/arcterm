// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0
//
// The chat view's permission card: the permission prompt Claude Code is showing in the agent's terminal, drawn with
// Allow and Deny. The queue is wavesrv's (permissionstore.ts); the card draws its head, with "N more waiting" under it.
// Allow types `1` into the terminal and Deny types Esc, through one command that refuses a request that is no longer the
// head, so a late click types nothing. A request the card may not allow (plan approval, an MCP tool...) offers only
// "Answer in Terminal", because its first option can grant more than the person chose. The line of an answer that did not
// go through belongs to the agent, not to a request (the refused request has left the queue by then), so the card draws
// it even on an empty queue, as a shell holding that line alone.

import { cn, fireAndForget } from "@/util/util";
import { useEffect, useState } from "react";
import { readTermLines } from "../term/termpaste";
import type { AgentVM } from "./agentsviewmodel";
import {
    cardShown,
    moreWaiting,
    permissionSummaryLine,
    permissionTitle,
    secondChoice,
    waitingFor,
} from "./permissionmodel";
import { answerPermission, usePermission, usePermissionRequestState } from "./permissionstore";
import { tuiPermissionOptions } from "./tuiscreen";

const PRIMARY_BTN =
    "flex-none cursor-pointer rounded-[7px] bg-accent px-[14px] py-[6px] text-[12.5px] font-semibold text-background hover:bg-accenthover disabled:cursor-default disabled:opacity-50";
const SECONDARY_BTN =
    "flex-none cursor-pointer rounded-[7px] border border-edge-mid bg-surface-raised px-[14px] py-[6px] text-[12.5px] font-semibold text-muted hover:border-edge-strong hover:bg-surface-hover disabled:cursor-default disabled:opacity-50";
const TEXT_BTN = "flex-none cursor-pointer text-[12px] text-accent-soft hover:underline";

// the clock that "waiting 4s" counts against, ticking only while a card is on screen
function useNow(active: boolean): number {
    const [now, setNow] = useState(() => Date.now());
    useEffect(() => {
        if (!active) {
            return;
        }
        setNow(Date.now());
        const timer = setInterval(() => setNow(Date.now()), 1000);
        return () => clearInterval(timer);
    }, [active]);
    return now;
}

// how many rows off the bottom of the terminal hold the dialog, and how often the card re-reads them while it shows
const SCREEN_ROWS = 30;
const SECOND_POLL_MS = 1000;
// the first read waits this long, so the TUI has drawn the dialog of a request that just became the head
const SECOND_FIRST_READ_MS = 250;

// The label of the prompt's own second "Yes, and …" option, read off the terminal under the chat while answerable
// request `headId` is up; null otherwise. A new head starts with no label and reads its own dialog: the one before it
// may still be on screen for a moment, and its option 2 is not this request's.
function useSecondChoice(blockId: string | undefined, headId: string | undefined): string | null {
    const [label, setLabel] = useState<string | null>(null);
    useEffect(() => {
        setLabel(null);
        if (headId == null || blockId == null) {
            return;
        }
        const read = () => {
            const lines = readTermLines(blockId, SCREEN_ROWS);
            setLabel(lines == null ? null : secondChoice(tuiPermissionOptions(lines)));
        };
        const first = setTimeout(read, SECOND_FIRST_READ_MS);
        const timer = setInterval(read, SECOND_POLL_MS);
        return () => {
            clearTimeout(first);
            clearInterval(timer);
        };
    }, [blockId, headId]);
    return label;
}

export function PermissionCard({ agent, onOpenTerminal }: { agent: AgentVM; onOpenTerminal: () => void }) {
    const oref = agent.blockId != null ? `block:${agent.blockId}` : undefined;
    const requests = usePermission(oref);
    const head = requests[0];
    const { busy, error } = usePermissionRequestState(oref, head?.id);
    // A refusal outlives the request it refused (wavesrv refuses only one that has left the queue), so the card also
    // draws for the error line alone once the queue is empty.
    const shown = oref != null && (head != null || error != null) && cardShown(agent);
    const now = useNow(shown && head != null);
    const second = useSecondChoice(agent.blockId, shown && head?.answerable ? head.id : undefined);
    if (!shown) {
        return null;
    }
    const errorLine = error != null && (
        <div data-permission-error role="alert" className={cn("text-[12px] text-error", head != null && "mt-2")}>
            {error}
        </div>
    );
    if (head == null) {
        return (
            <div
                role="group"
                aria-label="Permission answer not sent"
                data-permission-card={agent.id}
                className="rounded-[9px] border border-asking/45 bg-askingbg p-3"
            >
                {errorLine}
            </div>
        );
    }
    const answer = (allow: boolean, choice?: 2) =>
        fireAndForget(() => answerPermission(oref, head.id, { allow, choice }));
    const more = moreWaiting(requests.length - 1);
    return (
        <div
            role="group"
            aria-label={permissionTitle(head.toolname)}
            data-permission-card={agent.id}
            className="rounded-[9px] border border-asking/45 bg-askingbg p-3"
        >
            <div className="flex items-center gap-2 text-[12.5px]">
                <span className="h-[7px] w-[7px] flex-none rounded-full bg-asking pulse-dot" />
                <span className="font-semibold text-primary">{permissionTitle(head.toolname)}</span>
                <span className="text-muted">·</span>
                <span className="tabular-nums text-muted">{waitingFor(head.ts, now)}</span>
            </div>
            <div
                data-permission-summary
                className="mt-2 max-h-[160px] overflow-auto whitespace-pre-wrap break-words rounded-[7px] bg-surface-code px-3 py-2 font-mono text-[12px] leading-[1.5] text-primary"
            >
                {permissionSummaryLine(head)}
            </div>
            <div className="mt-3 flex flex-wrap items-center gap-2">
                {head.answerable ? (
                    <>
                        <button
                            type="button"
                            data-permission-allow
                            disabled={busy}
                            title="Allow this once"
                            className={PRIMARY_BTN}
                            onClick={() => answer(true)}
                        >
                            Allow
                        </button>
                        {second != null && (
                            <button
                                type="button"
                                data-perm-second
                                disabled={busy}
                                title={second}
                                className={cn(SECONDARY_BTN, "min-w-0 max-w-[320px] truncate")}
                                onClick={() => answer(true, 2)}
                            >
                                {second}
                            </button>
                        )}
                        <button
                            type="button"
                            data-permission-deny
                            disabled={busy}
                            title="Deny this request; the agent's turn ends"
                            className={SECONDARY_BTN}
                            onClick={() => answer(false)}
                        >
                            Deny
                        </button>
                        <button
                            type="button"
                            data-permission-terminal
                            className={cn(TEXT_BTN, "ml-1")}
                            onClick={onOpenTerminal}
                        >
                            More options in Terminal
                        </button>
                    </>
                ) : (
                    <button type="button" data-permission-terminal className={SECONDARY_BTN} onClick={onOpenTerminal}>
                        Answer in Terminal
                    </button>
                )}
            </div>
            {more !== "" && (
                <div data-permission-more className="mt-2 text-[11.5px] text-muted">
                    {more}
                </div>
            )}
            {errorLine}
        </div>
    );
}
