// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0
//
// The words of the chat box's footer: the agent's model, how full its context is, and the permission mode Claude Code
// shows on its own footer (read by tuiscreen.ts). Pure; chatfooter.tsx draws them.

import type { ClaudeMode } from "./tuiscreen";

const modeLabels: Record<ClaudeMode, string> = {
    default: "Default",
    acceptEdits: "Accept edits",
    plan: "Plan",
    auto: "Auto",
    bypassPermissions: "Bypass permissions",
};

export function modeLabel(mode: ClaudeMode): string {
    return modeLabels[mode];
}

// the context bar turns to a warning from here, as the plan strip's "warn" band
const CONTEXT_WARN_PCT = 80;

export function contextLabel(pct: number | undefined): string | null {
    if (pct == null || !Number.isFinite(pct)) {
        return null;
    }
    return `ctx ${Math.round(pct)}%`;
}

export function contextWarn(pct: number | undefined): boolean {
    return pct != null && Number.isFinite(pct) && pct >= CONTEXT_WARN_PCT;
}

// the model and context texts that exist, in order: an absent one leaves no separator behind
export function footerParts(
    model: string | undefined,
    contextPct: number | undefined
): { text: string; warn: boolean }[] {
    const parts: { text: string; warn: boolean }[] = [];
    if (model != null && model !== "") {
        parts.push({ text: model, warn: false });
    }
    const ctx = contextLabel(contextPct);
    if (ctx != null) {
        parts.push({ text: ctx, warn: contextWarn(contextPct) });
    }
    return parts;
}

// The model menu's choices: Claude Code's `/model <alias>` switches without opening its own menu.
export const MODEL_CHOICES: { alias: string; label: string }[] = [
    { alias: "opus", label: "Opus" },
    { alias: "sonnet", label: "Sonnet" },
    { alias: "haiku", label: "Haiku" },
];

/** The alias of the model the agent runs, read off its model name, or null when none matches. */
export function currentModelAlias(model: string | undefined): string | null {
    const m = (model ?? "").toLowerCase();
    return MODEL_CHOICES.find((c) => m.includes(c.alias))?.alias ?? null;
}

export function modelCommand(alias: string): string {
    return `/model ${alias}`;
}

// The modes the menu offers. Bypass permissions is left out: Claude Code puts it in the cycle only when it was enabled.
export const MODE_CHOICES: { mode: ClaudeMode; note: string }[] = [
    { mode: "default", note: "Asks before edits and commands" },
    { mode: "acceptEdits", note: "Edits files without asking" },
    { mode: "plan", note: "Reads and plans, changes nothing" },
    { mode: "auto", note: "Decides what needs asking" },
];

const MODE_PRESSES_MAX = 6;
const MODE_READS_MAX = 12;

/**
 * What to do next while pressing Shift+Tab toward `target`. `seen` is what each read found (null for a read with no
 * footer), the first before any press; `presses` the Shift+Tabs sent; `reads` every read made.
 *
 * A read with no footer stops the loop before anything else: a permission dialog or a menu is covering Claude Code's
 * screen, and a Shift+Tab sent into it answers the dialog instead of cycling the mode.
 */
export function modeStep(
    seen: (ClaudeMode | null)[],
    target: ClaudeMode,
    presses: number,
    reads: number
): "done" | "press" | "wait" | "give-up" | "no-footer" {
    const last = seen[seen.length - 1];
    if (last == null) {
        return "no-footer";
    }
    if (last === target) {
        return "done";
    }
    if (presses >= MODE_PRESSES_MAX || reads >= MODE_READS_MAX) {
        return "give-up";
    }
    if (seen.length >= 2 && last === seen[seen.length - 2]) {
        return "wait"; // the TUI has not redrawn since the press
    }
    if (seen.indexOf(last) < seen.length - 1) {
        return "give-up"; // an earlier mode came back: the target is not in this session's cycle
    }
    return "press";
}

/** The stroke length of a context ring of circumference `circ` at `pct`, or null with no percent. */
export function ringDash(pct: number | undefined, circ: number): number | null {
    if (pct == null || !Number.isFinite(pct)) {
        return null;
    }
    return Math.round((Math.min(Math.max(pct, 0), 100) / 100) * circ);
}
