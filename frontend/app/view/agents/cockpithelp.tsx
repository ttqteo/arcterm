// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0
//
// The cockpit surface's hints bar. The keyboard-help overlay was removed: the single source of truth is
// now the shared cheat sheet (Shift+?), which documents the cockpit triage keys via buildCockpitBindings.
// The `?` chip here opens that cheat sheet too.

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
            {HINTS.map(([k, d]) => (
                <span key={k} className="flex items-center gap-1">
                    <span className="rounded-[4px] bg-white/[0.06] px-1.5 py-0.5 font-mono text-secondary">
                        {k}
                    </span>
                    {d}
                </span>
            ))}
            <button
                type="button"
                onClick={onOpenHelp}
                className="ml-auto cursor-pointer font-mono hover:text-secondary"
            >
                ?
            </button>
        </div>
    );
}
