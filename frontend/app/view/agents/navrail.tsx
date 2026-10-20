// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { digitHintAtom } from "@/app/cockpit/digithints";
import { ContextMenuModel } from "@/app/store/contextmenu";
import { globalStore } from "@/app/store/jotaiStore";
import { cn } from "@/util/util";
import { useAtom, useAtomValue, useSetAtom } from "jotai";
import {
    AppWindow,
    Bot,
    Brain,
    FileCode2,
    FileCog,
    Gauge,
    GitCompare,
    LayoutDashboard,
    Radar,
    Settings,
    type LucideIcon,
} from "lucide-react";
import { useEffect, useState } from "react";
import { showTerminal } from "./agentcenter";
import type { AgentsViewModel, SurfaceKey } from "./agents";
import { workingCount } from "./agentsviewmodel";
import { attentionAtom, cockpitWaitingCount, splitAttention } from "./attentionstore";
import { channelMessagesAtom } from "./channelsstore";
import { DigitHint } from "./digithint";
import { answeredAskIdsAcross } from "./jarvisderive";
import { navRailCollapsed } from "./navrailwidth";
import { railDot, railItemTitle, railPins } from "./railapps";
import { appSurfaceIdAtom, moveRailPin, railPinsAtom, setRailPinned } from "./railappsstore";
import { ensureServicesFeed, servicesAtom } from "./servicesstore";
import { focusSubagentAtom } from "./subagentsstore";
import { PanelWeb } from "./themedecorview";
import { latestUnreadId, unreadLabel } from "./unreadagents";
import { unreadAgentsAtom } from "./unreadagentsstore";

// Cockpit navigation icons. Runtime logos stay as image assets; app controls use Lucide components.
const ICON: Record<SurfaceKey, LucideIcon> = {
    cockpit: LayoutDashboard,
    jarvis: Brain,
    agent: Bot,
    radar: Radar,
    files: GitCompare,
    usage: Gauge,
    code: FileCode2,
    setup: FileCog,
    settings: Settings,
    app: AppWindow,
};

// the surfaces used all day, then the tools reached for now and then; Ctrl+1..7 follow this order (SURFACE_ORDER)
export const CORE_ITEMS: { key: SurfaceKey; label: string }[] = [
    { key: "cockpit", label: "Cockpit" },
    { key: "jarvis", label: "Jarvis" },
    { key: "agent", label: "Agent" },
    { key: "usage", label: "Usage" },
];

export const TOOL_ITEMS: { key: SurfaceKey; label: string }[] = [
    { key: "code", label: "Code" },
    { key: "files", label: "Diff" },
    { key: "radar", label: "Radar" },
];

export const ITEMS = [...CORE_ITEMS, ...TOOL_ITEMS];

// a badge says the surface wants you (asking); Agent's says something finished that you have not read, which is news
// rather than a request, so it takes the accent
const BADGE_FILL: Partial<Record<SurfaceKey, string>> = { agent: "bg-accent" };

// One pinned app. It reads the 1s clock itself (the title says how long a crash has lasted), so the tick re-renders the
// three pins, not the whole rail.
function RailAppItem({
    model,
    s,
    at,
    count,
    narrow,
    isActive,
}: {
    model: AgentsViewModel;
    s: ServiceStatus;
    at: number;
    count: number;
    narrow: boolean;
    isActive: boolean;
}) {
    const now = useAtomValue(model.nowAtom);
    const setAppId = useSetAtom(appSurfaceIdAtom);
    const setActive = useSetAtom(model.surfaceAtom);
    const dot = railDot(s);
    const menu = (e: React.MouseEvent) => {
        ContextMenuModel.getInstance().showContextMenu(
            [
                { label: "Unpin from the rail", click: () => setRailPinned(s.id, false) },
                { label: "Move up", enabled: at > 0, click: () => moveRailPin(s.id, -1) },
                {
                    label: "Move down",
                    enabled: at >= 0 && at < count - 1,
                    click: () => moveRailPin(s.id, 1),
                },
            ],
            e
        );
    };
    return (
        <button
            type="button"
            data-nav-app={s.id}
            onClick={() => {
                setAppId(s.id);
                setActive("app");
            }}
            onContextMenu={menu}
            aria-label={s.name}
            title={railItemTitle(s, now)}
            className={cn(
                "relative mx-2 flex cursor-pointer flex-col items-center gap-[5px] rounded-[10px] border-0 bg-transparent py-[8px] text-muted hover:text-muted-foreground",
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
                <AppWindow size={16} strokeWidth={1.8} />
                {dot ? (
                    <span
                        data-nav-app-dot={dot}
                        className={cn(
                            "absolute -right-1 -top-1 h-2 w-2 rounded-full ring-2 ring-surface",
                            dot === "error" ? "bg-error" : "bg-warning"
                        )}
                    />
                ) : null}
            </span>
            {narrow ? null : (
                <span className="relative z-[1] max-w-full truncate px-1 text-[10px] font-semibold">{s.name}</span>
            )}
        </button>
    );
}

export function NavRail({ model }: { model: AgentsViewModel }) {
    const [active, setActive] = useAtom(model.surfaceAtom);
    // Three disjoint "needs you" badges from one server-computed list: Cockpit counts the agents that need you
    // (its cards), Jarvis the rest of what waits on you (gates, runs to confirm or land, escalations: its Brief
    // queue), Radar the projects with untriaged findings. Each sits on the surface that clears it. Agent counts
    // the agents that finished a turn you have not looked at yet (unreadagents.ts).
    const attention = useAtomValue(attentionAtom);
    const split = splitAttention(attention);
    const unread = useAtomValue(unreadAgentsAtom);
    // Agent also says how many agents are working, so a run doing its work is visible from Code or Diff, and the count
    // stays on Agent itself, where the focused terminal can hide the rows that show it
    const agents = useAtomValue(model.agentsAtom);
    const answered = answeredAskIdsAcross(Object.values(useAtomValue(channelMessagesAtom)));
    const badges: Partial<Record<SurfaceKey, number>> = {
        cockpit: cockpitWaitingCount(split.cockpit, agents, answered),
        jarvis: split.jarvis.length,
        agent: unread.size, // agents with something unread, not turns: the rows carry each agent's count
        radar: split.radar.length,
    };
    const working = workingCount(agents);
    // On Agent itself the badge is a shortcut: it opens the agent that finished last, as choosing its row does, and
    // viewing it marks it read, so each click takes the next one
    const jumpToUnread = (e: React.MouseEvent) => {
        const id = latestUnreadId(unread, agents);
        if (id == null) {
            return;
        }
        e.stopPropagation();
        globalStore.set(model.focusIdAtom, id);
        globalStore.set(model.focusReplyAtom, false);
        globalStore.set(focusSubagentAtom, null);
        showTerminal();
    };
    // while Ctrl is held each surface shows the digit Ctrl+1..7 jumps to (ITEMS is SURFACE_ORDER; digithints.ts)
    const ctrlHeld = useAtomValue(digitHintAtom) === "ctrl";
    // the apps pinned under Radar: the pins that still name a held service, at most three (railapps.ts)
    const services = useAtomValue(servicesAtom);
    const pinIds = useAtomValue(railPinsAtom);
    const pinned = services == null ? [] : railPins(pinIds, services);
    const appId = useAtomValue(appSurfaceIdAtom);
    useEffect(() => {
        ensureServicesFeed();
    }, []);
    const [narrow, setNarrow] = useState(() => navRailCollapsed(window.innerWidth));
    useEffect(() => {
        const onResize = () => setNarrow(navRailCollapsed(window.innerWidth));
        window.addEventListener("resize", onResize);
        return () => window.removeEventListener("resize", onResize);
    }, []);
    const renderItem = (key: SurfaceKey, label: string, badge = 0, tool = false) => {
        const Icon = ICON[key];
        const isActive = active === key;
        const busy = key === "agent" ? working : 0;
        const jumps = key === "agent" && isActive;
        const at = ITEMS.findIndex((it) => it.key === key);
        const digit = ctrlHeld && at >= 0 ? at + 1 : undefined;
        return (
            <button
                key={key}
                type="button"
                onClick={() => setActive(key)}
                // the label carries the item's name, so a 56px rail needs the accessible name here
                aria-label={label}
                title={busy > 0 ? `${label} — ${busy} working` : label}
                className={cn(
                    "relative mx-2 flex cursor-pointer flex-col items-center gap-[5px] rounded-[10px] border-0 bg-transparent text-muted hover:text-muted-foreground",
                    tool ? "py-[8px]" : "py-[11px]",
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
                    <DigitHint digit={digit}>
                        <Icon size={tool ? 16 : 20} strokeWidth={1.8} />
                    </DigitHint>
                    {badge > 0 ? (
                        <span
                            data-nav-badge={key}
                            onClick={jumps ? jumpToUnread : undefined}
                            title={jumps ? "Open the agent that finished last" : undefined}
                            className={cn(
                                "absolute -right-2 -top-1.5 flex h-[15px] min-w-[15px] items-center justify-center rounded-full px-1 text-[9px] font-bold tabular-nums text-background",
                                BADGE_FILL[key] ?? "bg-asking",
                                jumps && "hover:brightness-110"
                            )}
                        >
                            {unreadLabel(badge)}
                        </span>
                    ) : null}
                    {/* the digit hint takes the same bottom-right corner, so the count steps aside while Ctrl is held */}
                    {busy > 0 && digit == null ? (
                        <span
                            data-nav-working={key}
                            className="absolute -bottom-1.5 -right-2.5 flex h-[13px] items-center gap-[2px] rounded-full bg-surface px-[3px] text-[9px] font-bold tabular-nums text-working"
                        >
                            <span className="h-[5px] w-[5px] shrink-0 rounded-full bg-working pulse-dot" />
                            {unreadLabel(busy)}
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
                "relative isolate flex shrink-0 select-none flex-col gap-[3px] border-r border-border bg-surface py-2.5",
                narrow ? "w-[56px]" : "w-[78px]"
            )}
        >
            <PanelWeb />
            {CORE_ITEMS.map(({ key, label }) => renderItem(key, label, badges[key] ?? 0))}
            {/* a div, not a button: CDP scenarios count the surfaces as `nav button` */}
            <div data-nav-divider aria-hidden="true" className="mx-auto my-1.5 h-px w-8 shrink-0 bg-edge-mid" />
            {TOOL_ITEMS.map(({ key, label }) => renderItem(key, label, badges[key] ?? 0, true))}
            {pinned.length > 0 ? (
                <>
                    <div data-nav-divider aria-hidden="true" className="mx-auto my-1.5 h-px w-8 shrink-0 bg-edge-mid" />
                    {pinned.map((s, at) => (
                        <RailAppItem
                            key={`app:${s.id}`}
                            model={model}
                            s={s}
                            at={at}
                            count={pinned.length}
                            narrow={narrow}
                            isActive={active === "app" && appId === s.id}
                        />
                    ))}
                </>
            ) : null}
            <div className="flex-1" />
            {renderItem("setup", "Setup")}
            {renderItem("settings", "Settings")}
        </nav>
    );
}
