// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0
//
// The cockpit surface's hints bar. The keyboard-help overlay was removed: the single source of truth is
// now the shared cheat sheet (Shift+?), which documents the cockpit triage keys via buildCockpitBindings.
// The `?` button at the bar's right end (FooterStatus) opens that cheat sheet too, on every surface.

import { FooterStatus } from "@/app/cockpit/footerstatus";
import { formatChordString } from "@/util/keysym";
import { cn } from "@/util/util";
import { useAtomValue } from "jotai";
import type { AgentsViewModel } from "./agents";
import { formatAgeShort } from "./agentsviewmodel";
import type { FooterEvent } from "./cockpitevents";
import { RAIL_KIND } from "./cockpiteventsrail";
import { officeMenuOpenAtom } from "./officestore";

/** What the hints bar shows while the Cockpit shows Office: the office menu's key and the newest event. */
export interface OfficeFooter {
    event: FooterEvent | null;
    onMenu: () => void;
    onEvents: () => void;
}

// in Office the bar teaches one key, m, as a game shows START; the office menu lists the rest, and the chip lights
// while it is open (StartMenu). The newest event sits beside it, so the hidden Events rail still says that something
// happened
function OfficeFooterLine({ model, office }: { model: AgentsViewModel; office: OfficeFooter }) {
    const now = useAtomValue(model.structuralNowAtom);
    const menuOpen = useAtomValue(officeMenuOpenAtom);
    const e = office.event?.event;
    const k = e ? RAIL_KIND[e.kind] : undefined;
    const more = office.event?.moreNew ?? 0;
    return (
        <>
            <button
                type="button"
                data-office-footer-menu=""
                aria-expanded={menuOpen}
                onClick={office.onMenu}
                title="Office menu (m)"
                className="flex h-[22px] shrink-0 cursor-pointer items-center gap-1 border-0 bg-transparent p-0 text-[11px] text-muted hover:text-primary"
            >
                <span
                    className={cn(
                        "rounded-[4px] px-1.5 py-0.5 font-mono",
                        menuOpen ? "bg-surface-selected text-primary" : "bg-pill text-secondary"
                    )}
                >
                    m
                </span>
                menu
            </button>
            {e && k ? (
                <button
                    type="button"
                    data-office-footer-event=""
                    onClick={office.onEvents}
                    title="Show the Events rail"
                    className="flex h-[22px] min-w-0 flex-1 cursor-pointer items-center gap-1.5 border-0 border-l border-solid border-edge-mid bg-transparent py-0 pl-3 pr-0 text-left text-[11px] text-muted hover:text-secondary"
                >
                    <k.icon size={12} aria-hidden className={cn("shrink-0", k.tone)} />
                    <span className="shrink-0 font-medium text-primary">{e.who}</span>
                    <span className="min-w-0 truncate">
                        {k.verb}
                        {e.text ? ` · ${e.text}` : ""}
                    </span>
                    <span className="shrink-0 tabular-nums">{formatAgeShort(now - e.ts)}</span>
                    {more > 0 ? <span className="shrink-0 text-ink-faint">· {more} more new</span> : null}
                </button>
            ) : null}
        </>
    );
}

// One consolidated hints bar for the cockpit surface. The triage keys are cockpit-local (handled by
// the surface's onKeyDown, not the global keybinding registry); the trailing global chips are the same
// ones the global HintsFooter shows elsewhere — folded in here so the cockpit surface renders a single
// bar (the footer suppresses its rest posture on this surface — see hints-footer.tsx).
// hints: false while the roster loads or is empty, where the keys have nothing to act on; the bar still draws its
// status (servers, version), which every surface keeps.
export function HintsBar({ model, hints, office }: { model: AgentsViewModel; hints: boolean; office?: OfficeFooter }) {
    // Built at render (not module-eval) so the platform-aware modifier glyphs resolve after boot.
    const HINTS: [string, string][] = [
        ["↑↓ / j k", "move"],
        ["← → / h l", "column"],
        ["⏎", "open"],
        ["esc", "back"],
        ["1–9", "answer"],
        ["r", "reply"],
        ["t", "terminal"],
        ["b", "background"],
        ["n", "next ask"],
        ["[ ]", "switch surface"],
        [formatChordString("Mod:g"), "go"],
        [formatChordString("Mod:p"), "palette"],
        [formatChordString("Mod:n"), "new"],
    ];
    return (
        <div
            data-cockpit-hints=""
            data-pet-ledge
            className="flex shrink-0 items-center gap-4 border-t border-border bg-background px-[18px] py-1.5 text-[11px] text-muted"
        >
            {/* one line tall, wrapping onto lines it clips: a narrow window drops the hints that don't fit
                whole (the list ends with the least cockpit-specific ones) instead of breaking each chip */}
            <div className="flex h-[22px] min-w-0 flex-1 flex-wrap content-start items-center gap-x-4 gap-y-8 overflow-hidden">
                {office ? (
                    <OfficeFooterLine model={model} office={office} />
                ) : (
                    (hints ? HINTS : []).map(([k, d]) => (
                        <span key={k} className="flex h-[22px] shrink-0 items-center gap-1 whitespace-nowrap">
                            <span className="rounded-[4px] bg-white/[0.06] px-1.5 py-0.5 font-mono text-secondary">
                                {k}
                            </span>
                            {d}
                        </span>
                    ))
                )}
            </div>
            <FooterStatus model={model} />
        </div>
    );
}
