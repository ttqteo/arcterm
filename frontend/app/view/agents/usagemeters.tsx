// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0
//
// The app bar's usage button: the free RAM (WorkerCapacityChip), then the plan-usage meters: each provider's logo, then
// its 5-hour and weekly windows as two small bars, and after them any model's own weekly window (a Team seat's Fable
// share) under that model's name (planWindows), each with a tick at how much of its window has passed and coloured by
// how much is used (usageLevel, not by pace: a fast start read red at 27%), and the 5-hour window's countdown. Tokens
// and the time each window resets are on hover. RAM and tokens open the one Consumers panel (consumerspanel.tsx), so
// they are one button: a click on the RAM half ranks it by RAM, anywhere else by tokens. Float has no app bar: its
// ledge shows FloatUsage, each provider's first window alone (the 5-hour one), the rest in its tooltip.

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
    planDonuts,
    planWindows,
    savedRateLimitsAtom,
} from "./ratelimitstore";
import { RuntimeMark } from "./runtimemark";
import { loadWindowTokens, windowTokensAtom, type WindowTokens } from "./windowtokenstore";
import { WorkerCapacityChip } from "./workercapacitychip";
import { useWorkerCapacity } from "./workercapacitystore";

// neutral while ok, as on the Usage surface: amber and red are the signal, and the accent stays the New button's
const LEVEL_BAR: Record<"ok" | "warn" | "hot", string> = { ok: "bg-muted", warn: "bg-warning", hot: "bg-error" };
const LEVEL_TXT: Record<"ok" | "warn" | "hot", string> = {
    ok: "text-primary",
    warn: "text-warning",
    hot: "text-error",
};

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

interface MeterItem {
    key: string;
    provider: string;
    // the provider's first window shown, which carries its logo
    first: boolean;
    short: string;
    pct: number;
    elapsed: number | null;
    countdown: string | null;
    title: string;
}

// Every window worth a bar, each provider's 5-hour one first, with the tokens for the tooltips loaded as windows reset.
function useMeterItems(model: AgentsViewModel): MeterItem[] {
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
    return meterItems(donuts, windowTokens, now);
}

export function HeaderUsage({ model }: { model: AgentsViewModel }) {
    const items = useMeterItems(model);
    const cap = useWorkerCapacity();
    // nothing until there is a reading of either
    if (cap == null && items.length === 0) {
        return null;
    }
    return (
        <button
            type="button"
            data-app-usage
            aria-haspopup="dialog"
            onClick={(e) =>
                toggleConsumers(
                    (e.target as Element).closest("[data-worker-capacity]") != null ? "ram" : "tokens",
                    e.currentTarget
                )
            }
            className="flex h-[26px] shrink-0 cursor-pointer items-center gap-2.5 rounded border border-edge-mid bg-transparent px-2.5 hover:border-edge-strong hover:bg-surface-raised"
        >
            {cap != null ? <WorkerCapacityChip cap={cap} /> : null}
            {cap != null && items.length > 0 ? <span className="h-3.5 w-px bg-edge-mid" /> : null}
            <UsageMeters items={items} />
        </button>
    );
}

/** Float's usage, on the ledge (float-ledge.tsx): each provider's first window, its logo, a short bar, the percent and
 *  the 5-hour countdown, and every window in the tooltip. No border and no button: the float is small, and the
 *  Consumers panel it would open is not. */
export function FloatUsage({ model }: { model: AgentsViewModel }) {
    const items = useMeterItems(model);
    const shown = items.filter((m) => m.first);
    if (shown.length === 0) {
        return null;
    }
    return (
        <span
            data-float-usage
            title={items.map((m) => m.title).join("\n")}
            className="flex flex-none items-center gap-2 pr-3"
        >
            {shown.map((m) => {
                const lvl = usageLevel(m.pct);
                return (
                    <span key={m.key} className="flex items-center gap-1.5">
                        <RuntimeMark
                            runtime={m.provider}
                            imageClassName="h-3 w-3 shrink-0"
                            className={cn("h-1.5 w-1.5 shrink-0 rounded-full", providerDot(m.provider))}
                        />
                        <Meter pct={m.pct} fill={LEVEL_BAR[lvl]} height={4} radius={2} className="w-7" />
                        <span className={cn("text-[11px] font-semibold tabular-nums", LEVEL_TXT[lvl])}>
                            {Math.round(m.pct)}%
                        </span>
                        {m.countdown != null ? (
                            <span className="whitespace-nowrap text-[10.5px] tabular-nums text-muted">
                                {m.countdown}
                            </span>
                        ) : null}
                    </span>
                );
            })}
        </span>
    );
}

function meterItems(
    donuts: ReturnType<typeof planDonuts>,
    windowTokens: WindowTokens | null,
    now: number
): MeterItem[] {
    return donuts.flatMap((d) =>
        planWindows(d)
            .filter((p) => usageBarVisible(p.w.pct, d.stale != null, p.w.reset))
            .map((p, i) => {
                const reset = p.w.reset;
                const used = p.tokens ? windowUsedTokens(d.provider, windowTokens, p.tokens) : undefined;
                return {
                    key: `${d.provider}:${p.key}`,
                    provider: d.provider,
                    first: i === 0,
                    short: p.short,
                    pct: p.w.pct!,
                    elapsed: windowElapsed(reset, p.windowMs, now),
                    // a weekly window is days out and nobody waits it out: its tick says the pace, the tooltip the time
                    countdown: p.key === "fivehour" && reset ? formatResetShort(reset, now) : null,
                    title: meterTitle(p.label, p.w.pct!, used, reset, now),
                };
            })
    );
}

function UsageMeters({ items }: { items: MeterItem[] }) {
    // no refresh button here: the poll keeps the reading current and an account switch asks at once
    // (claudequota.ts); the Usage surface keeps the manual one
    if (items.length === 0) {
        return null;
    }
    return (
        <span
            data-usage-meters
            title={[...items.map((m) => m.title), "Token use by agent"].join("\n")}
            className="flex items-center gap-2.5"
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
        </span>
    );
}
