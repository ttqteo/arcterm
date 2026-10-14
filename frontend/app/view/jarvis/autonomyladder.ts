// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0
//
// The autonomy ladder's shape. The tiers are nested, not alternatives: gatekeeper implies concierge.
// Rendering it as accumulation is the whole point — separate buttons would misrepresent the backend.

import type { JarvisTier } from "@/app/view/agents/channelmessages";
import { atom } from "jotai";

// The panel's open state, global because the keybinding layer has to see it: Escape on a deep surface is
// bound to "back to Cockpit" (bindings.ts surface:back-home), and the app's dispatcher runs on window
// CAPTURE — so floating-ui's own Escape handling can never pre-empt it. Without this guard, dismissing the
// panel also throws you out of Jarvis.
export const autonomyPanelOpenAtom = atom(false);

export const LADDER: { tier: JarvisTier; label: string; blurb: string }[] = [
    {
        tier: "concierge",
        label: "Concierge",
        blurb: "Jarvis watches and narrates. Every ask reaches you.",
    },
    {
        tier: "gatekeeper",
        label: "Gatekeeper",
        blurb: "implies Concierge, and answers routine single-choice asks itself. The rest reach you.",
    },
];

const RANK: Record<JarvisTier, number> = { concierge: 0, gatekeeper: 1 };

export function rungState(tier: JarvisTier, rung: JarvisTier): "active" | "implied" | "off" {
    if (rung === tier) return "active";
    return RANK[rung] < RANK[tier] ? "implied" : "off";
}

// One source for the bar heights, because two draw them: the header chip's glyph and the popover's rows.
// A rung that is taller in one place than the other stops reading as the same ladder.
export const RUNG_BAR_PX: readonly number[] = [3, 6];
