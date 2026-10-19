// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { cn } from "@/util/util";
import { Server } from "lucide-react";
import type { ShownState } from "./bgactivity";
import { portsLabel, serverLabel, type DevServerRow } from "./devserversmodel";

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

// The dev servers an agent's background tasks left listening (bgactivity.ts launchedServers). They do not make it
// working, so its dot stays idle; this green server glyph says one still runs, and `ports` adds their ports beside it.
export function ServerMark({ servers, ports }: { servers: DevServerRow[]; ports?: boolean }) {
    if (servers.length === 0) {
        return null;
    }
    const title =
        servers.map((s) => `${portsLabel(s.ports)} ${serverLabel(s)}`).join("\n") + "\nrunning in the background";
    return (
        <span
            data-agent-servers={servers.length}
            role="img"
            aria-label={`${servers.length} ${servers.length === 1 ? "server" : "servers"} running in the background`}
            title={title}
            className="flex flex-none items-center gap-[3px] text-[10.5px] tabular-nums text-success"
        >
            <Server size={11} strokeWidth={2.2} aria-hidden />
            {ports ? portsLabel(servers.flatMap((s) => s.ports)) : null}
        </span>
    );
}
