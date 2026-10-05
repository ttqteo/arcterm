// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { cn } from "@/util/util";
import { useAtom, useAtomValue } from "jotai";
import { Bot, Brain, FileCode2, FileCog, Gauge, GitCompare, LayoutDashboard, Radar, Settings } from "lucide-react";
import { useEffect, useState, type ReactNode } from "react";
import type { AgentsViewModel, SurfaceKey } from "./agents";
import { attentionAtom, splitAttention } from "./attentionstore";
import { navRailCollapsed } from "./navrailwidth";

const iconProps = { size: 20, strokeWidth: 1.8 } as const;

// Cockpit navigation icons. Runtime logos stay as image assets; app controls use Lucide components.
const ICON: Record<SurfaceKey, ReactNode> = {
    cockpit: <LayoutDashboard {...iconProps} />,
    jarvis: <Brain {...iconProps} />,
    agent: <Bot {...iconProps} />,
    radar: <Radar {...iconProps} />,
    files: <GitCompare {...iconProps} />,
    usage: <Gauge {...iconProps} />,
    code: <FileCode2 {...iconProps} />,
    setup: <FileCog {...iconProps} />,
    settings: <Settings {...iconProps} />,
};

export const ITEMS: { key: SurfaceKey; label: string }[] = [
    { key: "cockpit", label: "Cockpit" },
    { key: "jarvis", label: "Jarvis" },
    { key: "agent", label: "Agent" },
    { key: "code", label: "Code" },
    { key: "files", label: "Diff" },
    { key: "radar", label: "Radar" },
    { key: "usage", label: "Usage" },
];

export function NavRail({ model }: { model: AgentsViewModel }) {
    const [active, setActive] = useAtom(model.surfaceAtom);
    // Three disjoint "needs you" badges from one server-computed list: Jarvis counts everything a channel
    // owns (review gates, Gatekeeper escalations, dispatched workers), Cockpit counts standalone agents
    // no channel dispatched, Radar counts projects with untriaged findings. Each sits on the surface that
    // clears it.
    const attention = useAtomValue(attentionAtom);
    const split = splitAttention(attention);
    const badges: Partial<Record<SurfaceKey, number>> = {
        cockpit: split.standalone.length,
        jarvis: split.channel.length,
        radar: split.radar.length,
    };
    const [narrow, setNarrow] = useState(() => navRailCollapsed(window.innerWidth));
    useEffect(() => {
        const onResize = () => setNarrow(navRailCollapsed(window.innerWidth));
        window.addEventListener("resize", onResize);
        return () => window.removeEventListener("resize", onResize);
    }, []);
    const renderItem = (key: SurfaceKey, label: string, badge = 0) => {
        const isActive = active === key;
        return (
            <button
                key={key}
                type="button"
                onClick={() => setActive(key)}
                // the label carries the item's name, so a 56px rail needs the accessible name here
                aria-label={label}
                title={label}
                className={cn(
                    "relative mx-2 flex cursor-pointer flex-col items-center gap-[5px] rounded-[10px] border-0 bg-transparent py-[11px] text-muted hover:text-muted-foreground",
                    isActive && "text-accent-soft"
                )}
            >
                {isActive ? (
                    <>
                        <span className="absolute inset-0 rounded-[10px] bg-accent/10" />
                        <span className="absolute left-[-8px] top-1/2 h-5 w-[3px] -translate-y-1/2 rounded-r-[3px] bg-accent" />
                    </>
                ) : null}
                <span className="relative z-[1]">
                    {ICON[key]}
                    {badge > 0 ? (
                        <span className="absolute -right-2 -top-1.5 flex h-[15px] min-w-[15px] items-center justify-center rounded-full bg-asking px-1 text-[9px] font-bold tabular-nums text-background">
                            {badge}
                        </span>
                    ) : null}
                </span>
                {narrow ? null : <span className="relative z-[1] text-[10px] font-semibold">{label}</span>}
            </button>
        );
    };
    return (
        <nav
            className={cn(
                "flex shrink-0 flex-col gap-[3px] border-r border-border bg-surface py-2.5",
                narrow ? "w-[56px]" : "w-[78px]"
            )}
        >
            {ITEMS.map(({ key, label }) => renderItem(key, label, badges[key] ?? 0))}
            <div className="flex-1" />
            {renderItem("setup", "Setup")}
            {renderItem("settings", "Settings")}
        </nav>
    );
}
