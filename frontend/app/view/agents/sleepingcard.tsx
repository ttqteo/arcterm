// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { cn, fireAndForget } from "@/util/util";
import { Moon, TriangleAlert } from "lucide-react";
import { useState } from "react";
import { confirmCloseSession } from "./agentactions";
import { wakeAgent } from "./agentsleep";
import type { AgentVM } from "./agentsviewmodel";
import { ramLabel } from "./consumers";

const BTN =
    "shrink-0 cursor-pointer rounded-sm px-2 py-1 text-[12px] font-medium focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent disabled:cursor-default disabled:opacity-60";
const BTN_PRIMARY = cn(BTN, "text-accent-soft hover:text-accent-100");
const BTN_QUIET = cn(BTN, "text-muted hover:text-primary");

function since(ts: number): string {
    return new Date(ts).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", hour12: false });
}

// A sleeping agent's card over its terminal: the old output stays below, and the terminal itself takes no input (its
// process is gone), so Wake is how to get it back. When the wake fails (here, or from another place: the server keeps
// the agent asleep and sets the reason) the card says why and offers a fresh start or Close instead: --resume has
// nothing to reopen.
export function SleepingCard({ agent }: { agent: AgentVM }) {
    // the wake this card started and is waiting on; the failure is tied to the sleep it came from, so it does not
    // show on the next sleep of the same agent
    const [pending, setPending] = useState<"wake" | "fresh" | null>(null);
    const [failure, setFailure] = useState<{ since: number; reason: string } | null>(null);
    const sleeping = agent.sleeping;
    if (!sleeping) {
        return null;
    }
    const reason = (failure?.since === sleeping.since ? failure.reason : undefined) ?? sleeping.wakeFailed;
    const wake = (fresh: boolean) => {
        setPending(fresh ? "fresh" : "wake");
        fireAndForget(async () => {
            try {
                await wakeAgent(agent.id, fresh ? { fresh: true } : {});
                setFailure(null);
            } catch (e) {
                setFailure({ since: sleeping.since, reason: e instanceof Error ? e.message : String(e) });
            } finally {
                setPending(null);
            }
        });
    };
    const freed = sleeping.freedBytes > 0 ? ` · freed ${ramLabel(sleeping.freedBytes)}` : "";
    const failed = reason != null || pending === "fresh";
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
                        disabled={pending != null}
                        onClick={() => wake(true)}
                        className={BTN_PRIMARY}
                    >
                        {pending === "fresh" ? "Starting…" : "Start fresh"}
                    </button>
                    <button
                        type="button"
                        data-sleeping-close
                        disabled={pending != null}
                        onClick={() => confirmCloseSession(agent)}
                        className={BTN_QUIET}
                    >
                        Close
                    </button>
                </>
            ) : (
                <>
                    <Moon size={14} strokeWidth={1.8} aria-hidden className="shrink-0 text-muted" />
                    <span className="min-w-0 flex-1 truncate text-ink-mid">
                        Sleeping since {since(sleeping.since)}
                        {freed}
                    </span>
                    <button
                        type="button"
                        data-sleeping-wake
                        disabled={pending != null}
                        onClick={() => wake(false)}
                        className={BTN_PRIMARY}
                    >
                        {pending === "wake" ? "Waking…" : "Wake"}
                    </button>
                </>
            )}
        </div>
    );
}
