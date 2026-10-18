// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

// The strip under the terminal in Float (docs/superpowers/specs/2026-10-10-jarvis-modes-design.md §2), 52px, tall enough
// to hold the whole 48px sprite so Sprout never stands on the terminal's prompt (petledge.ts LedgeBox.holds). On its
// left, the two fixed tabs, Note (the global scratch note over the terminal) and Translate (the translate-shell
// terminal), a divider, then the tabs Float can switch to, plain terminals included and a run as its lead
// (sproutroster.ts floatTabs), their dots pulsing while that agent works or asks; the fixed tabs are always there, so
// even one agent shows its tab, the way back from the note. On its right, the plan usage (usagemeters.tsx FloatUsage),
// since Float has no app bar. What lies between is the floor Sprout walks. The fixed tabs and the usage keep their
// width; the tabs take what is left past the floor's least, so a narrow float shows fewer and puts the rest under "+N"
// instead of painting them over their neighbours. A press on the strip, away from a tab, drags the window like the
// float bar.

import { useDimensionsWithCallbackRef } from "@/app/hook/useDimensions";
import { ContextMenuModel } from "@/app/store/contextmenu";
import { useBindingKeys } from "@/app/store/keybindings/store";
import { STATE_LABEL } from "@/app/view/agents/agentheader";
import type { AgentsViewModel } from "@/app/view/agents/agents";
import { askingLabel, type AgentVM } from "@/app/view/agents/agentsviewmodel";
import { isTranslateTerminal } from "@/app/view/agents/floatnote";
import { closeFloatNote, floatNoteOpenAtom, showTranslate, toggleFloatNote } from "@/app/view/agents/floatnotestore";
import { floatTabs } from "@/app/view/agents/sproutroster";
import { StatusDot } from "@/app/view/agents/statusdot";
import { FloatUsage } from "@/app/view/agents/usagemeters";
import { formatChordString } from "@/util/keysym";
import { cn, fireAndForget } from "@/util/util";
import { useAtomValue } from "jotai";
import { Languages, SquareTerminal, StickyNote } from "lucide-react";
import { useMemo, type MouseEvent } from "react";

function tabLabel(a: AgentVM): string {
    if (a.kind === "terminal") {
        return a.name;
    }
    return `${a.name} · ${a.state === "asking" ? askingLabel(a) : STATE_LABEL[a.state]}`;
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
    const noteOpen = useAtomValue(floatNoteOpenAtom);
    const noteKeys = useBindingKeys("float-note");
    const noteTitle = noteKeys != null ? `Note (${formatChordString(noteKeys)})` : "Note";
    const agents = useAtomValue(model.agentsAtom);
    const terminals = useAtomValue(model.terminalsAtom);
    const lineage = useAtomValue(model.lineageAtom);
    // the tabs and the floor share what the fixed tabs and the usage leave
    const [roomRef, , roomRect] = useDimensionsWithCallbackRef<HTMLDivElement>(null);
    const room = roomRect == null ? undefined : roomRect.width - FLOOR_MIN;
    const tabs = useMemo(
        () => floatTabs(agents, terminals, focusId ?? null, lineage, room),
        [agents, terminals, focusId, lineage, room]
    );
    const focused = agents.find((a) => a.id === focusId) ?? terminals.find((a) => a.id === focusId);
    // a tab shows that agent's or terminal's terminal: Float shows the focused one; it closes the note first
    const show = (id: string) => {
        closeFloatNote();
        model.openTerminal(id);
    };
    const showRest = (e: MouseEvent) =>
        ContextMenuModel.getInstance().showContextMenu(
            tabs.rest.map((a) => ({ label: tabLabel(a), click: () => show(a.id) })),
            e
        );
    return (
        <div data-tauri-drag-region className="flex h-[52px] shrink-0 select-none border-t border-border bg-surface">
            <div data-tauri-drag-region className="flex flex-none items-center gap-1 pl-2">
                <button
                    type="button"
                    data-float-fixed="note"
                    aria-label="Note"
                    aria-pressed={noteOpen}
                    title={noteTitle}
                    onClick={() => fireAndForget(() => toggleFloatNote(model))}
                    className={fixedTabClass(noteOpen)}
                >
                    <StickyNote size={14} strokeWidth={2} />
                </button>
                <button
                    type="button"
                    data-float-fixed="translate"
                    aria-label="Translate"
                    aria-pressed={!noteOpen && focused != null && isTranslateTerminal(focused)}
                    title="Translate"
                    onClick={() => fireAndForget(() => showTranslate(model))}
                    className={fixedTabClass(!noteOpen && focused != null && isTranslateTerminal(focused))}
                >
                    <Languages size={14} strokeWidth={2} />
                </button>
                <span className="mx-1 h-4 w-px flex-none bg-edge-mid" aria-hidden />
            </div>
            <div ref={roomRef} data-tauri-drag-region className="flex min-w-0 flex-1">
                {tabs.shown.length > 0 ? (
                    <div data-float-tabs data-tauri-drag-region className="flex min-w-0 items-center gap-1 pl-1">
                        {tabs.shown.map((a) => {
                            const on = a.id === focusId && !noteOpen;
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
            </div>
            <FloatUsage model={model} />
        </div>
    );
}
