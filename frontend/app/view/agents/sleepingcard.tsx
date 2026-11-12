// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { cn, fireAndForget } from "@/util/util";
import { Moon, TriangleAlert } from "lucide-react";
import { useState } from "react";
import { confirmCloseSession } from "./agentactions";
import { sleepingLine, wakeAgent } from "./agentsleep";
import type { AgentVM } from "./agentsviewmodel";
import { failureOfSleep, useWakeFailure, useWaking } from "./wakingstore";

const BTN =
    "shrink-0 cursor-pointer rounded-sm px-2 py-1 text-[12px] font-medium focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent disabled:cursor-default disabled:opacity-60";
const BTN_PRIMARY = cn(BTN, "text-accent-soft hover:text-accent-100");
const BTN_QUIET = cn(BTN, "text-muted hover:text-primary");

// A sleeping agent's card over its terminal: its conversation shows below in the terminal's place
// (chatpane.tsx for a Claude agent, sleepingtranscript.tsx for another harness), and the terminal itself takes no input
// (its process is gone), so Wake is how to get it back. When the wake fails (here, or from another place: the server keeps
// the agent asleep and sets the reason) the card says why and offers a fresh start or Close instead: --resume has
// nothing to reopen. `failureOnly`: the agent's Chat box already says it sleeps and wakes it on Send (chatcomposer.tsx),
// so the card shows only for a failed wake.
export function SleepingCard({ agent, failureOnly = false }: { agent: AgentVM; failureOnly?: boolean }) {
    // the wake this card started and is waiting on
    const [pending, setPending] = useState<"wake" | "fresh" | null>(null);
    // a wake started anywhere (the composer below, a row's menu) holds the card's buttons too, and its failure shows here
    const waking = useWaking(agent.id);
    const failure = useWakeFailure(agent.id);
    const busy = pending != null || waking;
    const sleeping = agent.sleeping;
    if (!sleeping) {
        return null;
    }
    const reason = failureOfSleep(failure, sleeping.since) ?? sleeping.wakeFailed;
    const wake = (fresh: boolean) => {
        setPending(fresh ? "fresh" : "wake");
        fireAndForget(async () => {
            try {
                // wakeAgent keeps a failure in wakingstore, which this card reads
                await wakeAgent(agent.id, fresh ? { fresh: true } : {});
            } catch {
                // shown by the card itself
            } finally {
                setPending(null);
            }
        });
    };
    const failed = reason != null || pending === "fresh";
    if (failureOnly && !failed) {
        return null;
    }
    return (
        <div
            data-sleeping-card={agent.id}
            className="mx-1 mb-2 flex shrink-0 items-center gap-2.5 rounded-[8px] border border-edge-strong bg-surface py-1 pl-3 pr-1.5 text-[12.5px]"
        >
            {failed ? (
                <>
                    <TriangleAlert size={14} strokeWidth={1.8} aria-hidden className="shrink-0 text-error" />
                    <span
                        data-sleeping-error
                        role="alert"
                        title={reason}
                        className="min-w-0 flex-1 truncate text-ink-mid"
                    >
                        {reason ?? "Couldn't wake the agent"}
                    </span>
                    <button
                        type="button"
                        data-sleeping-fresh
                        disabled={busy}
                        onClick={() => wake(true)}
                        className={BTN_PRIMARY}
                    >
                        {pending === "fresh" ? "Starting…" : "Start fresh"}
                    </button>
                    <button
                        type="button"
                        data-sleeping-close
                        disabled={busy}
                        onClick={() => confirmCloseSession(agent, undefined, "sleeping card")}
                        className={BTN_QUIET}
                    >
                        Close
                    </button>
                </>
            ) : (
                <>
                    <Moon size={14} strokeWidth={1.8} aria-hidden className="shrink-0 text-muted" />
                    <span className="min-w-0 flex-1 truncate text-ink-mid">{sleepingLine("Sleeping", sleeping)}</span>
                    <button
                        type="button"
                        data-sleeping-wake
                        disabled={busy}
                        onClick={() => wake(false)}
                        className={BTN_PRIMARY}
                    >
                        {busy ? "Waking…" : "Wake"}
                    </button>
                </>
            )}
        </div>
    );
}
