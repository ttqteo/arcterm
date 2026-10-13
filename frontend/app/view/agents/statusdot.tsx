// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { cn } from "@/util/util";
import type { AgentState } from "./agentsviewmodel";

// Single source of truth for the in-view dot. Colors mirror the sidebar STATUS_COLOR map (Wave @theme tokens).
const COLOR: Record<AgentState, string> = {
    asking: "var(--color-warning)",
    working: "var(--color-accent)",
    idle: "var(--color-muted)",
};

export function StatusDot({
    state,
    quiet,
    pulse,
    className,
}: {
    state: AgentState;
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
                pulse && !hollow ? "pulse-dot" : "",
                className
            )}
            style={hollow ? undefined : { backgroundColor: COLOR[state] }}
        />
    );
}
