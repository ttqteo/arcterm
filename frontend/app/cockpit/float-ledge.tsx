// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

// The strip under the terminal in Float (docs/superpowers/specs/2026-10-10-jarvis-modes-design.md §2), 52px, tall enough
// to hold the whole 48px sprite so Sprout never stands on the terminal's prompt (petledge.ts LedgeBox.holds). On its
// left, the fixed Translate tab (the Translate panel over the terminal), a divider, then the tabs Float can switch to:
// the Agent tree's top level, so a run is one tab (its lead) however many sessions it spawned, then the plain terminals
// (sproutroster.ts floatTabs), their dots pulsing while that agent works or asks. A right-click pins a tab: pinned tabs
// come first, in the order they were pinned, and are never cut (floattabsstore.ts). On its right, the plan usage
// (usagemeters.tsx FloatUsage), since Float has no app bar. What lies between is the floor Sprout walks. The fixed tab
// and the usage keep their width; the tabs take what is left past the floor's least, so a narrow float shows fewer and
// puts the rest under "+N" instead of painting them over their neighbours. A press on the strip, away from a tab, drags
// the window like the float bar.

import { useDimensionsWithCallbackRef } from "@/app/hook/useDimensions";
import { ContextMenuModel } from "@/app/store/contextmenu";
import { useBindingKeys } from "@/app/store/keybindings/store";
import { STATE_LABEL } from "@/app/view/agents/agentheader";
import type { AgentsViewModel } from "@/app/view/agents/agents";
import { askingLabel } from "@/app/view/agents/agentsviewmodel";
import { floatTabPinsAtom, setTabPinned } from "@/app/view/agents/floattabsstore";
import { floatTabs, floatTabUnits, type FloatTab } from "@/app/view/agents/sproutroster";
import { StatusDot } from "@/app/view/agents/statusdot";
import { closeTranslate, toggleTranslate, translateOpenAtom } from "@/app/view/agents/translatestore";
import { FloatUsage } from "@/app/view/agents/usagemeters";
import { formatChordString } from "@/util/keysym";
import { cn } from "@/util/util";
import { useAtomValue } from "jotai";
import { Languages, Pin, SquareTerminal } from "lucide-react";
import { useMemo, type MouseEvent } from "react";

function tabTitle(t: FloatTab): string {
    const a = t.agent;
    const name = t.pinned ? `${t.label} (pinned)` : t.label;
    if (a.kind === "terminal") {
        return name;
    }
    return `${name} · ${a.state === "asking" ? askingLabel(a) : STATE_LABEL[a.state]}`;
}

// the floor's least width: the sprite and a step (its min-w-[64px])
const FLOOR_MIN = 64;

// a fixed tab: icon only, 30px wide; pressed as an agent tab is
function fixedTabClass(on: boolean): string {
    return cn(
        "flex h-[26px] w-[30px] flex-none cursor-pointer items-center justify-center rounded-[7px] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent",
        on
            ? "bg-surface-hover text-primary ring-1 ring-edge-mid"
            : "text-secondary hover:bg-surface-hover hover:text-primary"
    );
}

export function FloatLedge({ model }: { model: AgentsViewModel }) {
    const focusId = useAtomValue(model.focusIdAtom);
    const translateOpen = useAtomValue(translateOpenAtom);
    const translateKeys = useBindingKeys("translate");
    const translateTitle = translateKeys != null ? `Translate (${formatChordString(translateKeys)})` : "Translate";
    const agents = useAtomValue(model.agentsAtom);
    const terminals = useAtomValue(model.terminalsAtom);
    const lineage = useAtomValue(model.lineageAtom);
    const pins = useAtomValue(floatTabPinsAtom);
    // the tabs and the floor share what the fixed tab and the usage leave
    const [roomRef, , roomRect] = useDimensionsWithCallbackRef<HTMLDivElement>(null);
    const room = roomRect == null ? undefined : roomRect.width - FLOOR_MIN;
    const tabs = useMemo(
        () => floatTabs(agents, terminals, focusId ?? null, lineage, room, pins),
        [agents, terminals, focusId, lineage, room, pins]
    );
    // a tab shows that agent's or terminal's terminal: Float shows the focused one; it closes the Translate panel first,
    // the focused agent's own tab included (no focus change then, so nothing else would close it)
    const show = (id: string) => {
        closeTranslate();
        model.openTerminal(id);
    };
    const pin = (t: FloatTab, on: boolean) => setTabPinned(t.key, on, floatTabUnits(agents, terminals, lineage));
    const showTabMenu = (t: FloatTab, e: MouseEvent) => {
        e.preventDefault();
        ContextMenuModel.getInstance().showContextMenu(
            [
                t.pinned
                    ? { label: "Unpin tab", click: () => pin(t, false) }
                    : { label: "Pin tab", click: () => pin(t, true) },
            ],
            e
        );
    };
    const showRest = (e: MouseEvent) =>
        ContextMenuModel.getInstance().showContextMenu(
            [
                ...tabs.rest.map((t) => ({ label: tabTitle(t), click: () => show(t.agent.id) })),
                { type: "separator" as const },
                {
                    label: "Pin",
                    type: "submenu" as const,
                    submenu: tabs.rest.map((t) => ({ label: t.label, click: () => pin(t, true) })),
                },
            ],
            e
        );
    return (
        <div data-tauri-drag-region className="flex h-[52px] shrink-0 select-none border-t border-border bg-surface">
            <div data-tauri-drag-region className="flex flex-none items-center gap-1 pl-2">
                <button
                    type="button"
                    data-float-fixed="translate"
                    aria-label="Translate"
                    aria-pressed={translateOpen}
                    title={translateTitle}
                    onClick={toggleTranslate}
                    className={fixedTabClass(translateOpen)}
                >
                    <Languages size={14} strokeWidth={2} />
                </button>
                <span className="mx-1 h-4 w-px flex-none bg-edge-mid" aria-hidden />
            </div>
            <div ref={roomRef} data-tauri-drag-region className="flex min-w-0 flex-1">
                {tabs.shown.length > 0 ? (
                    <div
                        data-float-tabs
                        data-tauri-drag-region
                        className="flex min-w-0 items-center gap-1 overflow-hidden pl-1"
                    >
                        {tabs.shown.map((t) => {
                            const on = focusId != null && t.members.includes(focusId) && !translateOpen;
                            return (
                                <button
                                    key={t.key}
                                    type="button"
                                    data-float-tab={t.agent.id}
                                    data-float-tab-pinned={t.pinned ? "" : undefined}
                                    aria-label={tabTitle(t)}
                                    aria-pressed={on}
                                    title={tabTitle(t)}
                                    onClick={() => show(t.agent.id)}
                                    onContextMenu={(e) => showTabMenu(t, e)}
                                    className={cn(
                                        "flex h-[26px] min-w-[44px] max-w-[120px] shrink-0 cursor-pointer items-center gap-1.5 rounded-[7px] px-2 text-[11.5px] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent",
                                        on
                                            ? "bg-surface-hover font-semibold text-primary ring-1 ring-edge-mid"
                                            : "text-secondary hover:bg-surface-hover hover:text-primary"
                                    )}
                                >
                                    {t.agent.kind === "terminal" ? (
                                        <SquareTerminal size={12} strokeWidth={2} className="flex-none text-muted" />
                                    ) : (
                                        <StatusDot state={t.agent.state} pulse={t.agent.state !== "idle"} />
                                    )}
                                    <span className="min-w-0 truncate">{t.label}</span>
                                    {t.pinned ? (
                                        <Pin
                                            data-float-tab-pin
                                            size={10}
                                            strokeWidth={2}
                                            className="flex-none text-muted"
                                            aria-hidden
                                        />
                                    ) : null}
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
            </div>
            <FloatUsage model={model} />
        </div>
    );
}
