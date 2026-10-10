// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

// The strip under the terminal in Float (docs/superpowers/specs/2026-10-10-jarvis-modes-design.md §2), 52px, tall enough
// to hold the whole 48px sprite so Sprout never stands on the terminal's prompt (petledge.ts LedgeBox.holds). On its
// left, the tabs Float can switch to, plain terminals included (sproutroster.ts floatTabs), when there is more than one,
// their dots pulsing while that agent works or asks; on its right, the plan usage (usagemeters.tsx FloatUsage), since
// Float has no app bar. What lies between is the floor Sprout walks. A press on the strip, away from a tab, drags the
// window like the float bar.

import { ContextMenuModel } from "@/app/store/contextmenu";
import { STATE_LABEL } from "@/app/view/agents/agentheader";
import type { AgentsViewModel } from "@/app/view/agents/agents";
import { askingLabel, type AgentVM } from "@/app/view/agents/agentsviewmodel";
import { floatTabs } from "@/app/view/agents/sproutroster";
import { StatusDot } from "@/app/view/agents/statusdot";
import { FloatUsage } from "@/app/view/agents/usagemeters";
import { cn } from "@/util/util";
import { useAtomValue } from "jotai";
import { SquareTerminal } from "lucide-react";
import { useMemo, type MouseEvent } from "react";

function tabLabel(a: AgentVM): string {
    if (a.kind === "terminal") {
        return a.name;
    }
    return `${a.name} · ${a.state === "asking" ? askingLabel(a) : STATE_LABEL[a.state]}`;
}

export function FloatLedge({ model }: { model: AgentsViewModel }) {
    const focusId = useAtomValue(model.focusIdAtom);
    const agents = useAtomValue(model.agentsAtom);
    const terminals = useAtomValue(model.terminalsAtom);
    const tabs = useMemo(() => floatTabs(agents, terminals, focusId ?? null), [agents, terminals, focusId]);
    // a tab shows that agent's or terminal's terminal: Float shows the focused one
    const show = (id: string) => model.openTerminal(id);
    const showRest = (e: MouseEvent) =>
        ContextMenuModel.getInstance().showContextMenu(
            tabs.rest.map((a) => ({ label: tabLabel(a), click: () => show(a.id) })),
            e
        );
    return (
        <div data-tauri-drag-region className="flex h-[52px] shrink-0 border-t border-border bg-surface">
            {tabs.shown.length > 0 ? (
                <div data-float-tabs data-tauri-drag-region className="flex min-w-0 items-center gap-1 pl-2">
                    {tabs.shown.map((a) => {
                        const on = a.id === focusId;
                        return (
                            <button
                                key={a.id}
                                type="button"
                                data-float-tab={a.id}
                                aria-label={tabLabel(a)}
                                aria-pressed={on}
                                title={tabLabel(a)}
                                onClick={() => show(a.id)}
                                className={cn(
                                    "flex h-[26px] min-w-[44px] max-w-[120px] cursor-pointer items-center gap-1.5 rounded-[7px] px-2 text-[11.5px] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent",
                                    on
                                        ? "bg-surface-hover font-semibold text-primary ring-1 ring-edge-mid"
                                        : "text-secondary hover:bg-surface-hover hover:text-primary"
                                )}
                            >
                                {a.kind === "terminal" ? (
                                    <SquareTerminal size={12} strokeWidth={2} className="flex-none text-muted" />
                                ) : (
                                    <StatusDot state={a.state} pulse={a.state !== "idle"} />
                                )}
                                <span className="min-w-0 truncate">{a.name}</span>
                            </button>
                        );
                    })}
                    {tabs.rest.length > 0 ? (
                        <button
                            type="button"
                            data-float-tabs-more
                            aria-label={`${tabs.rest.length} more`}
                            onClick={showRest}
                            className="flex h-[26px] flex-none cursor-pointer items-center rounded-[7px] px-1.5 text-[11px] text-muted tabular-nums hover:bg-surface-hover hover:text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
                        >
                            +{tabs.rest.length}
                        </button>
                    ) : null}
                </div>
            ) : null}
            {/* the floor Sprout walks: what the tabs and the usage leave, never less than the sprite and a step */}
            <div data-pet-ledge data-pet-ledge-holds data-tauri-drag-region className="min-w-[64px] flex-1" />
            <FloatUsage model={model} />
        </div>
    );
}
