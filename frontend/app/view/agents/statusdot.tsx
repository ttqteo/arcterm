// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { cn } from "@/util/util";
import type { ShownState } from "./bgactivity";

// Single source of truth for the in-view dot. Working is the status green, never the accent: the accent is focus and
// the primary action, so a working dot in it read as selected. Waiting (its turn ended, background work it started
// only watches) is the same green on the slow pulse.
const COLOR: Record<ShownState, string> = {
    asking: "var(--color-warning)",
    working: "var(--color-working)",
    waiting: "var(--color-working)",
    idle: "var(--color-muted)",
};

export function StatusDot({
    state,
    quiet,
    pulse,
    className,
}: {
    state: ShownState;
    quiet?: boolean;
    pulse?: boolean;
    className?: string;
}) {
    const hollow = state === "working" && quiet;
    return (
        <span
            className={cn(
                "h-2 w-2 shrink-0 rounded-full transition-colors duration-200",
                hollow ? "border border-muted bg-transparent" : "",
                pulse && !hollow ? (state === "waiting" ? "pulse-dot-slow" : "pulse-dot") : "",
                className
            )}
            style={hollow ? undefined : { backgroundColor: COLOR[state] }}
        />
    );
}
