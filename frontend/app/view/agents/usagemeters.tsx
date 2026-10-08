// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0
//
// The app bar's plan-usage meters, beside the RAM chip: each provider's logo, then its 5-hour and weekly windows as two
// small bars, each with a tick at how much of its window has passed and coloured by how much is used (usageLevel, not
// by pace: a fast start read red at 27%), and the 5-hour window's countdown. Tokens and the weekly reset are on hover;
// the button opens the Consumers panel sorted by tokens (consumerspanel.tsx).

import { Meter } from "@/app/element/meter";
import { cn, fireAndForget } from "@/util/util";
import { useAtomValue } from "jotai";
import { Fragment, useEffect } from "react";
import type { AgentsViewModel } from "./agents";
import { usageLevel } from "./agentsviewmodel";
import {
    formatResetShort,
    meterTitle,
    providerDot,
    usageBarVisible,
    windowElapsed,
    windowUsedTokens,
} from "./cockpitrailmodel";
import { toggleConsumers } from "./consumersstore";
import {
    activeClaudeKeyAtom,
    claudeIdentityAtom,
    FIVE_HOUR_MS,
    planDonuts,
    savedRateLimitsAtom,
    WEEK_MS,
} from "./ratelimitstore";
import { RuntimeMark } from "./runtimemark";
import { loadWindowTokens, windowTokensAtom, type WindowTokens } from "./windowtokenstore";

const LEVEL_BAR: Record<"ok" | "warn" | "hot", string> = { ok: "bg-accent", warn: "bg-warning", hot: "bg-error" };
const LEVEL_TXT: Record<"ok" | "warn" | "hot", string> = { ok: "text-accent", warn: "text-warning", hot: "text-error" };

const WINDOWS = [
    ["fivehour", "5h", "5-hour window", FIVE_HOUR_MS],
    ["week", "wk", "Weekly", WEEK_MS],
] as const;

// The app bar is always mounted, so this reads everything itself rather than borrowing a surface's state.
// Rate-limit windows are account-scoped, not per-agent: every agent's live reading collapses to one block
// per provider (last live wins), merged over the saved snapshot so it survives idle — the aggregation the
// Usage surface uses. Only running agents count as live (liveWindowAgents): an idle one holds the reading
// frozen at its last turn and would pin the meter to that old value. Claude's windows are the active Claude
// account's only (planDonuts). The 1s clock rolls a window over the moment it resets.
/** The plan windows the app bar shows: every live agent's reading merged over the saved snapshot (planDonuts). */
export function usePlanDonuts(model: AgentsViewModel): ReturnType<typeof planDonuts> {
    const agents = useAtomValue(model.agentsAtom);
    const saved = useAtomValue(savedRateLimitsAtom);
    const activeKey = useAtomValue(activeClaudeKeyAtom);
    const identity = useAtomValue(claudeIdentityAtom);
    const now = useAtomValue(model.nowAtom);
    return planDonuts(agents, saved, activeKey, identity, now);
}

export function HeaderUsageMeters({ model }: { model: AgentsViewModel }) {
    const windowTokens = useAtomValue(windowTokensAtom);
    const now = useAtomValue(model.nowAtom);
    const donuts = usePlanDonuts(model);
    const claude = donuts.find((d) => d.provider === "claude");
    useEffect(() => {
        if (claude == null) {
            return;
        }
        fireAndForget(() => loadWindowTokens(claude.fivehour.reset, claude.week.reset));
    }, [claude?.fivehour.reset, claude?.week.reset]);
    return (
        <UsageMeters
            donuts={donuts}
            windowTokens={windowTokens}
            now={now}
            onOpen={(opener) => toggleConsumers("tokens", opener)}
        />
    );
}

function UsageMeters({
    donuts,
    windowTokens,
    now,
    onOpen,
}: {
    donuts: ReturnType<typeof planDonuts>;
    windowTokens: WindowTokens | null;
    now: number;
    onOpen: (opener: Element) => void;
}) {
    const items = donuts.flatMap((d) =>
        WINDOWS.filter(([w]) => usageBarVisible(d[w].pct, d.stale != null)).map(([w, short, label, windowMs], i) => {
            const reset = d[w].reset;
            return {
                key: `${d.provider}:${w}`,
                provider: d.provider,
                first: i === 0,
                short,
                pct: d[w].pct!,
                elapsed: windowElapsed(reset, windowMs, now),
                // the weekly window is days out and nobody waits it out: its tick says the pace, the tooltip the time
                countdown: w === "fivehour" && reset ? formatResetShort(reset, now) : null,
                title: meterTitle(label, d[w].pct!, windowUsedTokens(d.provider, windowTokens, w), reset, now),
            };
        })
    );
    // no refresh button here: the poll keeps the reading current and an account switch asks at once
    // (claudequota.ts); the Usage surface keeps the manual one
    if (items.length === 0) {
        return null;
    }
    return (
        <button
            type="button"
            data-usage-meters
            aria-haspopup="dialog"
            onClick={(e) => onOpen(e.currentTarget)}
            title={[...items.map((m) => m.title), "Token use by agent"].join("\n")}
            className="flex h-[30px] shrink-0 cursor-pointer items-center gap-2.5 rounded border border-edge-mid bg-transparent px-2.5 hover:border-edge-strong hover:bg-surface-raised"
        >
            {items.map((m, i) => {
                const lvl = usageLevel(m.pct);
                return (
                    <Fragment key={m.key}>
                        {i > 0 ? <span className="h-3.5 w-px bg-edge-mid" /> : null}
                        {m.first ? (
                            <RuntimeMark
                                runtime={m.provider}
                                imageClassName="h-3 w-3 shrink-0"
                                className={cn("h-1.5 w-1.5 shrink-0 rounded-full", providerDot(m.provider))}
                            />
                        ) : null}
                        <span className="text-[10.5px] text-muted">{m.short}</span>
                        <span className="relative">
                            <Meter pct={m.pct} fill={LEVEL_BAR[lvl]} height={5} radius={3} className="w-11" />
                            {m.elapsed != null ? (
                                <span
                                    data-usage-pace
                                    className="absolute -top-0.5 -ml-px h-[9px] w-0.5 rounded-[1px] bg-ink-hi"
                                    style={{ left: `${m.elapsed * 100}%` }}
                                />
                            ) : null}
                        </span>
                        <span className={cn("text-[11px] font-semibold tabular-nums", LEVEL_TXT[lvl])}>
                            {Math.round(m.pct)}%
                        </span>
                        {m.countdown != null ? (
                            <span className="whitespace-nowrap text-[10.5px] tabular-nums text-muted">
                                {m.countdown}
                            </span>
                        ) : null}
                    </Fragment>
                );
            })}
        </button>
    );
}
