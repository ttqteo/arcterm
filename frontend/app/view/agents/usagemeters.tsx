// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0
//
// The cockpit header's plan-usage meters: each provider's 5-hour and weekly windows as two small bars. Tokens
// and resets are on hover; the button opens the Usage surface for the rest.

import { Meter } from "@/app/element/meter";
import { cn } from "@/util/util";
import { Fragment } from "react";
import { usageLevel } from "./agentsviewmodel";
import { meterTitle, providerDot, usageBarVisible, windowUsedTokens } from "./cockpitrailmodel";
import type { mergeRateLimitWindows } from "./ratelimitstore";
import type { WindowTokens } from "./windowtokenstore";

const LEVEL_BAR: Record<"ok" | "warn" | "hot", string> = { ok: "bg-accent", warn: "bg-warning", hot: "bg-error" };
const LEVEL_TXT: Record<"ok" | "warn" | "hot", string> = { ok: "text-accent", warn: "text-warning", hot: "text-error" };

const WINDOWS = [
    ["fivehour", "5h", "5-hour window"],
    ["week", "wk", "Weekly"],
] as const;

export function UsageMeters({
    donuts,
    windowTokens,
    now,
    onOpen,
}: {
    donuts: ReturnType<typeof mergeRateLimitWindows>;
    windowTokens: WindowTokens | null;
    now: number;
    onOpen: () => void;
}) {
    const items = donuts.flatMap((d) =>
        WINDOWS.filter(([w]) => usageBarVisible(d[w].pct, d.stale != null)).map(([w, short, label], i) => ({
            key: `${d.provider}:${w}`,
            provider: d.provider,
            first: i === 0,
            short,
            pct: d[w].pct!,
            title: meterTitle(label, d[w].pct!, windowUsedTokens(d.provider, windowTokens, w), d[w].reset, now),
        }))
    );
    if (items.length === 0) {
        return null;
    }
    const multi = new Set(items.map((m) => m.provider)).size > 1;
    return (
        <button
            type="button"
            onClick={onOpen}
            title={[...items.map((m) => m.title), "Open Usage"].join("\n")}
            className="flex h-[30px] cursor-pointer items-center gap-2.5 rounded border border-edge-mid bg-transparent px-2.5 hover:border-edge-strong hover:bg-surface-raised"
        >
            {items.map((m, i) => {
                const lvl = usageLevel(m.pct);
                return (
                    <Fragment key={m.key}>
                        {i > 0 ? <span className="h-3.5 w-px bg-edge-mid" /> : null}
                        {multi && m.first ? (
                            <span className={cn("h-1.5 w-1.5 rounded-full", providerDot(m.provider))} />
                        ) : null}
                        <span className="text-[10.5px] text-muted">{m.short}</span>
                        <Meter pct={m.pct} fill={LEVEL_BAR[lvl]} height={5} radius={3} className="w-11" />
                        <span className={cn("text-[11px] font-semibold tabular-nums", LEVEL_TXT[lvl])}>
                            {Math.round(m.pct)}%
                        </span>
                    </Fragment>
                );
            })}
        </button>
    );
}
