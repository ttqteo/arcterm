// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0
//
// The pure half of the "Wrong project?" band (docs/superpowers/specs/2026-11-16-jarvis-no-folder-ask-design.md 2b, D11):
// the one line the band says, and the rule for which key presses count as typing into the agent, which ends the band.
// The band's state and what its button does are jarvisroutestore.ts; this file draws nothing and reads no atom.

import { routeProjectLabel } from "@/app/view/jarvis/jarvisroute";
import type { RouteBand } from "@/app/view/jarvis/jarvisroutestore";

// "Jarvis chose <project> because <reason>". A reason is one short sentence, but it is the model's text, so any line break
// in it goes (the band is one line). With no reason the "because" clause is left out, not left hanging.
export function routeBandLine(band: Pick<RouteBand, "project" | "reason">): string {
    const reason = band.reason.replace(/\s+/g, " ").trim();
    const chose = `Jarvis chose ${routeProjectLabel(band.project)}`;
    return reason === "" ? chose : `${chose} because ${reason}`;
}

const MODIFIER_KEYS: ReadonlySet<string> = new Set(["Shift", "Control", "Alt", "Meta", "CapsLock"]);

// Whether a key press in the agent's cell is the person typing to the agent, which ends the band (the job has been
// answered by then, so the note about where it went is stale). A modifier pressed on its own is not typing, and neither is
// Escape, which closes things around the agent more often than it reaches it. A chord is: a terminal takes Ctrl and Alt
// chords as input, so the flags are carried to take a KeyboardEvent as it is but do not change the answer.
export function typedIntoAgent(e: { key: string; ctrlKey?: boolean; metaKey?: boolean; altKey?: boolean }): boolean {
    return e.key !== "Escape" && !MODIFIER_KEYS.has(e.key);
}
