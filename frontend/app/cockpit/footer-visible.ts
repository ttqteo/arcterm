// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

// Pure. No DOM, no atoms. Given the live KeyContext, the active registry, and the curated hint
// tables, returns the ordered chips to render. A hint shows only if at least one referenced binding
// is currently active (its when(ctx) passes) — so the footer inherits the dispatcher's posture rules
// and can never show a key that wouldn't fire. Surface hints first, then global; de-duped by id.

import type { Binding, KeyContext } from "@/app/store/keybindings/types";
import type { FooterHint } from "./footerhints";

export interface HintChip {
    glyph?: string; // literal glyph for composite/non-modifier hints
    keys?: string; // chord in binding notation; the renderer computes the platform-aware glyph
    label: string;
    ctrlLit?: boolean;
    rangeTo?: number; // keys is the 1 of a digit run that ends here: Ctrl+1–7
}

export function visibleHints(
    ctx: KeyContext,
    bindings: Binding[],
    surfaceHints: FooterHint[],
    globalHints: FooterHint[]
): HintChip[] {
    const activeIds = new Set(bindings.filter((b) => (b.when ? b.when(ctx) : true)).map((b) => b.id));
    const shown = new Set<string>();
    const out: HintChip[] = [];
    for (const h of [...surfaceHints, ...globalHints]) {
        if (!h.ids.some((id) => activeIds.has(id))) {
            continue;
        }
        if (h.ids.some((id) => shown.has(id))) {
            continue; // already rendered (id referenced by both tables)
        }
        h.ids.forEach((id) => shown.add(id));
        out.push({ glyph: h.glyph, keys: h.keys, label: h.label, ctrlLit: h.ctrlLit });
    }
    return out;
}

// heldHints is the footer while Ctrl (Command on a Mac) or Alt is held on its own: every chord on that modifier that
// would fire right now, in registry order. Inside the terminal that is all that reaches the cockpit, so it is the list
// of ways out. The digit jumps collapse into one chip (their numbers already show where they land: the rail's
// surfaces, the Active list's agents). On a Mac the held key is Command, so a Control chord (Ctrl+Tab) is not its own.
export function heldHints(ctx: KeyContext, bindings: Binding[], mod: "ctrl" | "alt", mac: boolean): HintChip[] {
    const own = (m: string) => (mod === "alt" ? m === "Alt" : m === "Mod" || (!mac && m === "Ctrl"));
    const other = (m: string) => (mod === "alt" ? m === "Mod" || m === "Ctrl" : m === "Alt");
    const out: HintChip[] = [];
    let digits: HintChip | null = null;
    for (const b of bindings) {
        if (b.keys.includes(" ") || (b.when && !b.when(ctx))) {
            continue;
        }
        const parts = b.keys.split(":");
        const key = parts.pop()!;
        if (!parts.some(own) || parts.some(other)) {
            continue;
        }
        if (/^[1-9]$/.test(key) && parts.length === 1) {
            if (digits == null) {
                digits = {
                    keys: `${parts[0]}:1`,
                    label: mod === "alt" ? "Jump to agent" : "Jump to surface",
                    rangeTo: 1,
                };
                out.push(digits);
            }
            digits.rangeTo = Math.max(digits.rangeTo!, Number(key));
            continue;
        }
        out.push({ keys: b.keys, label: b.label });
    }
    return out;
}
