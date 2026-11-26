// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { cn } from "@/util/util";
import { Server } from "lucide-react";
import { useLayoutEffect, useRef, useState } from "react";
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

// The ports beside the glyph, as many whole ones as the line has room for and `+N` for the rest. The ports sit in a
// one-line wrapping box that clips its later lines, so a port that does not fit wraps out of sight instead of being
// cut or pushing the line past its row; a ResizeObserver counts the ones that wrapped. The box shrinks only after the
// words beside it (a tiny flex-shrink), so on a wide row every port shows.
function MarkPorts({ ports }: { ports: number[] }) {
    const boxRef = useRef<HTMLSpanElement>(null);
    const [hidden, setHidden] = useState(0);
    const key = ports.join(",");
    useLayoutEffect(() => {
        const box = boxRef.current;
        if (box == null) {
            return;
        }
        const measure = () => {
            const kids = Array.from(box.children) as HTMLElement[];
            const top = kids[0]?.offsetTop ?? 0;
            setHidden(kids.filter((k) => k.offsetTop > top).length);
        };
        measure();
        const ro = new ResizeObserver(measure);
        ro.observe(box);
        return () => ro.disconnect();
    }, [key]);
    return (
        <>
            <span
                ref={boxRef}
                data-agent-server-ports
                className="flex h-[14px] min-w-0 flex-wrap gap-x-[4px] overflow-hidden leading-[14px]"
            >
                {ports.map((p) => (
                    <span key={p}>{portsLabel([p])}</span>
                ))}
            </span>
            {hidden > 0 ? (
                <span data-agent-server-ports-more={hidden} className="flex-none">
                    +{hidden}
                </span>
            ) : null}
        </>
    );
}

// The dev servers an agent's background tasks left listening (bgactivity.ts launchedServers). They do not make it
// working, so its dot stays idle; this green server glyph says one still runs, and `ports` adds their ports beside it.
// `ports` writes every port that fits beside the glyph and `+N` for the rest (MarkPorts); `count` writes only how many
// (a narrow header); the title lists every port with the command that holds it
export function ServerMark({ servers, ports, count }: { servers: DevServerRow[]; ports?: boolean; count?: boolean }) {
    if (servers.length === 0) {
        return null;
    }
    const title =
        servers.map((s) => `${portsLabel(s.ports)} ${serverLabel(s)}`).join("\n") + "\nrunning in the background";
    const all = servers.flatMap((s) => s.ports);
    return (
        <span
            data-agent-servers={servers.length}
            role="img"
            aria-label={`${servers.length} ${servers.length === 1 ? "server" : "servers"} running in the background`}
            title={title}
            className={cn(
                "flex items-center gap-[3px] whitespace-nowrap text-[10.5px] tabular-nums text-success",
                ports && all.length > 0 ? "min-w-0 shrink-[0.05]" : "flex-none"
            )}
        >
            <Server size={11} strokeWidth={2.2} aria-hidden className="flex-none" />
            {ports ? <MarkPorts ports={all} /> : count ? all.length || servers.length : null}
        </span>
    );
}
