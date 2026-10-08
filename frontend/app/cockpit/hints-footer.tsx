// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

// Always-on keyboard hints footer. Three postures, all in one bar:
//  - leader active (e.g. after Ctrl+G): show the continuation list (the former WhichKeyBar).
//  - otherwise: show visibleHints(ctx) — surface hints at rest, and only editable-surviving chords
//    (dimmed) when focus is in the terminal. In-terminal falls out of the filter, not a special case.
// Mounted in layout flow (reserves ~28px), so it never overlays content.

import { deriveKeyContext } from "@/app/store/keybindings/dispatcher";
import { activeLeaderAtom } from "@/app/store/keybindings/leaderatom";
import { leaderChord } from "@/app/store/keybindings/matcher";
import { bindingsAtom } from "@/app/store/keybindings/store";
import { watchFocusedAgent, whenVersionAtom } from "@/app/store/keybindings/whenstate";
import type { AgentsViewModel } from "@/app/view/agents/agents";
import { formatChordString } from "@/util/keysym";
import { cn } from "@/util/util";
import { useAtomValue } from "jotai";
import { useEffect, useState } from "react";
import { ctrlHeldAtom } from "./ctrlheld";
import { visibleHints } from "./footer-visible";
import { GLOBAL_HINTS, SURFACE_HINTS } from "./footerhints";
import { FooterStatus } from "./footerstatus";

// dim: focus is in the terminal, so the hints step back; the status at the right end (servers, version) does not
function FooterBar({ model, children, dim }: { model: AgentsViewModel; children?: React.ReactNode; dim?: boolean }) {
    return (
        <div
            data-pet-ledge
            className="flex h-7 shrink-0 items-center gap-4 border-t border-edge-strong bg-modalbg px-4"
        >
            <div className={cn("flex min-w-0 flex-1 items-center gap-4", dim && "opacity-60")}>{children}</div>
            <FooterStatus model={model} />
        </div>
    );
}

// One line tall, wrapping onto lines it clips: a narrow window drops the chips that don't fit whole rather than
// pushing the status off the bar or growing the footer (the Cockpit's HintsBar does the same).
const CHIP_ROW = "flex h-[22px] min-w-0 flex-1 flex-wrap content-start items-center gap-x-4 gap-y-8 overflow-hidden";

// lit: the chip's key is held right now (Ctrl for peek), so it reads as armed
function Chip({ glyph, label, lit }: { glyph: string; label: string; lit?: boolean }) {
    return (
        <span
            className={cn(
                "flex h-[22px] shrink-0 items-center gap-1.5 whitespace-nowrap text-[12px]",
                lit ? "text-accent-soft" : "text-secondary"
            )}
        >
            <span
                className={cn(
                    "rounded-[5px] border px-[6px] py-0.5 font-mono text-[10.5px] text-primary",
                    lit ? "border-accent bg-accentbg" : "border-edge-mid"
                )}
            >
                {glyph}
            </span>
            {label}
        </span>
    );
}

export function HintsFooter({ model }: { model: AgentsViewModel }) {
    const surface = useAtomValue(model.surfaceAtom);
    const leader = useAtomValue(activeLeaderAtom);
    const bindings = useAtomValue(bindingsAtom);
    const ctrlHeld = useAtomValue(ctrlHeldAtom);
    // subscribe-only: some when(ctx) predicates read state ctx doesn't carry (see whenstate.ts), so
    // this is what tells React to recompute chips below when that state changes.
    useAtomValue(whenVersionAtom);
    useEffect(() => watchFocusedAgent(model), [model]);
    // `editable` reads document.activeElement (not atom-tracked); recompute on focus moves.
    const [, recomputeOnFocus] = useState(0);
    useEffect(() => {
        const bump = () => recomputeOnFocus((n) => n + 1);
        window.addEventListener("focusin", bump);
        window.addEventListener("focusout", bump);
        return () => {
            window.removeEventListener("focusin", bump);
            window.removeEventListener("focusout", bump);
        };
    }, []);

    // Leader posture: continuations for the active leader (ported from the old WhichKeyBar).
    if (leader != null) {
        const items = bindings
            .filter((b) => b.keys.startsWith(leader + " "))
            .map((b) => ({ next: b.keys.split(" ")[1], label: b.label }));
        return (
            <FooterBar model={model}>
                <span className="shrink-0 font-mono text-[11px] text-accent-soft">{formatChordString(leaderChord(leader))} →</span>
                <div className={CHIP_ROW}>
                    {items.map((it) => (
                        <Chip key={it.next} glyph={it.next} label={it.label} />
                    ))}
                </div>
            </FooterBar>
        );
    }

    // The cockpit surface renders its own consolidated hints bar (cockpitsurface.tsx HINTS), so the
    // footer's rest posture would be a redundant second row here. Leader posture above still shows
    // (the which-key bar must appear on every surface).
    if (surface === "cockpit") {
        return null;
    }

    // Rest / in-terminal posture: both fall out of filtering hints by live when(ctx).
    const ctx = deriveKeyContext();
    const chips = visibleHints(ctx, bindings, SURFACE_HINTS[surface] ?? [], GLOBAL_HINTS);
    return (
        <FooterBar model={model} dim={ctx.editable}>
            <div className={CHIP_ROW}>
                {chips.map((c) => (
                    <Chip
                        key={(c.glyph ?? c.keys) + c.label}
                        glyph={c.glyph ?? formatChordString(c.keys!)}
                        label={c.label}
                        lit={c.ctrlLit && ctrlHeld}
                    />
                ))}
            </div>
        </FooterBar>
    );
}
