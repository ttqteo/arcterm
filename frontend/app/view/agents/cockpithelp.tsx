// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0
//
// The cockpit surface's hints bar. The keyboard-help overlay was removed: the single source of truth is
// now the shared cheat sheet (Shift+?), which documents the cockpit triage keys via buildCockpitBindings.
// The `?` chip here opens that cheat sheet too.

import { VersionTag } from "@/app/cockpit/versiontag";
import { formatChordString } from "@/util/keysym";

// One consolidated hints bar for the cockpit surface. The triage keys are cockpit-local (handled by
// the surface's onKeyDown, not the global keybinding registry); the trailing global chips are the same
// ones the global HintsFooter shows elsewhere — folded in here so the cockpit surface renders a single
// bar (the footer suppresses its rest posture on this surface — see hints-footer.tsx).
export function HintsBar({ onOpenHelp }: { onOpenHelp: () => void }) {
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
        ["g", "go"],
        [formatChordString("Ctrl:p"), "palette"],
        [formatChordString("Ctrl:n"), "new"],
    ];
    return (
        <div
            data-pet-ledge
            className="flex shrink-0 items-center gap-4 border-t border-border bg-background px-[18px] py-1.5 text-[11px] text-muted"
        >
            {/* one line tall, wrapping onto lines it clips: a narrow window drops the hints that don't fit
                whole (the list ends with the least cockpit-specific ones) instead of breaking each chip */}
            <div className="flex h-[22px] min-w-0 flex-1 flex-wrap content-start items-center gap-x-4 gap-y-8 overflow-hidden">
                {HINTS.map(([k, d]) => (
                    <span key={k} className="flex h-[22px] shrink-0 items-center gap-1 whitespace-nowrap">
                        <span className="rounded-[4px] bg-white/[0.06] px-1.5 py-0.5 font-mono text-secondary">
                            {k}
                        </span>
                        {d}
                    </span>
                ))}
            </div>
            <button
                type="button"
                onClick={onOpenHelp}
                className="shrink-0 cursor-pointer font-mono hover:text-secondary"
            >
                ?
            </button>
            <VersionTag />
        </div>
    );
}
