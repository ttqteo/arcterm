// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0
//
// The rows of a routing choice, one component for both places a person picks where a job goes (D7, D11): the chooser card
// in the Ask popover and the "Wrong project?" band on the Agent surface. The rows come from jarvisroute.ts, the pick is
// carried out by jarvisroutestore.ts; this only draws them. A pick is awaited, so its row reads pending and a refusal
// lands on that same row, in words, where the person is looking.

import { cn } from "@/util/util";
import { Bot, Folder, Plus } from "lucide-react";
import { useEffect, useState } from "react";
import type { RouteChoice } from "./jarvisroute";
import type { RouteOutcome } from "./jarvisroutestore";

const KIND_ICON = { agent: Bot, project: Folder, launch: Plus } as const;

export function RouteChoiceList({
    choices,
    onPick,
}: {
    choices: RouteChoice[];
    onPick: (choice: RouteChoice) => Promise<RouteOutcome>;
}) {
    const [pending, setPending] = useState<number | null>(null);
    const [errors, setErrors] = useState<Record<number, string>>({});

    // another list is another question: what the old one said about its rows is not about these
    useEffect(() => {
        setPending(null);
        setErrors({});
    }, [choices]);

    const pick = async (index: number) => {
        if (pending != null) {
            return;
        }
        setPending(index);
        setErrors((prev) => {
            const { [index]: _cleared, ...rest } = prev;
            return rest;
        });
        let outcome: RouteOutcome;
        try {
            outcome = await onPick(choices[index]);
        } catch (e) {
            outcome = { ok: false, message: e instanceof Error ? e.message : String(e) };
        }
        setPending(null);
        if ("message" in outcome) {
            const { message } = outcome;
            setErrors((prev) => ({ ...prev, [index]: message }));
        }
    };

    return (
        <ul className="flex flex-col gap-1">
            {choices.map((choice, index) => {
                const Icon = KIND_ICON[choice.kind];
                const busy = pending === index;
                const error = errors[index];
                return (
                    <li key={`${choice.kind}:${choice.label}`}>
                        <button
                            type="button"
                            data-route-choice
                            data-route-choice-kind={choice.kind}
                            data-route-choice-state={busy ? "pending" : error != null ? "error" : "idle"}
                            aria-busy={busy}
                            disabled={pending != null}
                            onClick={() => void pick(index)}
                            className={cn(
                                "flex w-full items-center gap-2 rounded-[8px] border bg-surface px-2.5 py-1.5 text-left text-[11.5px] text-secondary hover:bg-surface-hover hover:text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent disabled:cursor-default disabled:opacity-70",
                                error != null ? "border-error" : "border-border"
                            )}
                        >
                            <Icon aria-hidden="true" size={12} strokeWidth={2} className="flex-none text-muted" />
                            <span className="min-w-0 flex-1 truncate">{choice.label}</span>
                            {busy ? <span className="pulse-soft flex-none font-mono text-accent">…</span> : null}
                        </button>
                        {error != null ? (
                            <p
                                role="alert"
                                data-route-choice-error
                                className="px-2.5 pt-0.5 text-[10.5px] leading-[1.4] text-error [overflow-wrap:anywhere]"
                            >
                                {error}
                            </p>
                        ) : null}
                    </li>
                );
            })}
        </ul>
    );
}
