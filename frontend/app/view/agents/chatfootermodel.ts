// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0
//
// The words of the chat box's footer: the agent's model, how full its context is, and the permission mode Claude Code
// shows on its own footer (read by tuiscreen.ts). Pure; chatfooter.tsx draws them.

import type { ClaudeMode, EffortLevel } from "./tuiscreen";

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

// The model menu's choices, newest family first. A pick types `/model <id>` with the full model id, which Claude Code
// switches to without opening its own menu (a family alias like `fable` may not exist in every Claude Code version).
export type ModelFamily = "fable" | "opus" | "sonnet" | "haiku";

export const MODEL_CHOICES: { alias: ModelFamily; id: string; label: string }[] = [
    { alias: "fable", id: "claude-fable-5-2", label: "Fable 5.2" },
    { alias: "opus", id: "claude-opus-5-5", label: "Opus 5.5" },
    { alias: "sonnet", id: "claude-sonnet-5-5", label: "Sonnet 5.5" },
    { alias: "haiku", id: "claude-haiku-5-5", label: "Haiku 5.5" },
];

// More models: the earlier models Claude Code still takes by id, newest first within each family.
export const MORE_MODEL_CHOICES: { id: string; label: string }[] = [
    { id: "claude-fable-5-1", label: "Fable 5.1" },
    { id: "claude-fable-5", label: "Fable 5" },
    { id: "claude-opus-5", label: "Opus 5" },
    { id: "claude-opus-4-8", label: "Opus 4.8" },
    { id: "claude-opus-4-7", label: "Opus 4.7" },
    { id: "claude-opus-4-6", label: "Opus 4.6" },
    { id: "claude-sonnet-5", label: "Sonnet 5" },
    { id: "claude-sonnet-4-6", label: "Sonnet 4.6" },
    { id: "claude-haiku-4-5", label: "Haiku 4.5" },
];

// a model name or id reduced to its family and version digits: "opus 5.5", "Opus 5.5" and "claude-opus-5-5[1m]" all
// read "opus55", and "Opus 5" reads "opus5", so a version never matches a longer one
function modelKey(s: string): string {
    return s
        .toLowerCase()
        .replace(/\[[^\]]*\]|\([^)]*\)/g, "")
        .replace(/claude/g, "")
        .replace(/[^a-z0-9]/g, "");
}

/**
 * The id of the exact model the agent runs, from the main list or More models, or null when none matches. A bare
 * family ("opus", Claude Code's alias for its newest) reads as that family's row in the main list.
 */
export function currentModelId(model: string | undefined): string | null {
    const k = modelKey(model ?? "");
    if (k === "") {
        return null;
    }
    const all = [...MODEL_CHOICES, ...MORE_MODEL_CHOICES];
    const exact = all.find((c) => modelKey(c.label) === k || modelKey(c.id) === k);
    return exact?.id ?? MODEL_CHOICES.find((c) => c.alias === k)?.id ?? null;
}

/** The chip's name for the model: the menu's label for a known one ("Opus 5.5"), else the name as the agent gave it. */
export function modelChipLabel(model: string | undefined): string {
    const id = currentModelId(model);
    const known = [...MODEL_CHOICES, ...MORE_MODEL_CHOICES].find((c) => c.id === id);
    return known?.label ?? (model || "Model");
}

/** The family of the model the agent runs, read off its model name, or null when none matches. */
export function currentModelAlias(model: string | undefined): ModelFamily | null {
    const m = (model ?? "").toLowerCase();
    return MODEL_CHOICES.find((c) => m.includes(c.alias))?.alias ?? null;
}

export function modelCommand(id: string): string {
    return `/model ${id}`;
}

// The effort menu's choices, with the glyph Claude Code draws for each. A pick types `/effort <level>`; a level the
// model does not take is answered by Claude Code itself.
export const EFFORT_CHOICES: { level: EffortLevel; label: string; glyph: string; note: string }[] = [
    { level: "low", label: "Low", glyph: "○", note: "Quick answers, fewest tokens" },
    { level: "medium", label: "Medium", glyph: "◐", note: "Balanced speed and depth" },
    { level: "high", label: "High", glyph: "●", note: "Thinks longer on hard steps" },
    { level: "xhigh", label: "Extra high", glyph: "◉", note: "Deeper reasoning, slower" },
    { level: "max", label: "Max", glyph: "◈", note: "The most thinking it allows" },
];

export function effortChoice(level: EffortLevel) {
    return EFFORT_CHOICES.find((c) => c.level === level)!;
}

// The effort an agent's Claude hooks last reported (AgentStatusData.effort, set inside a turn), as a level the chip
// names, or null when none came or it is none of the five.
export function reportedEffort(raw: string | undefined): EffortLevel | null {
    const level = (raw ?? "").trim().toLowerCase();
    return EFFORT_CHOICES.some((c) => c.level === level) ? (level as EffortLevel) : null;
}

// The effort the chip names: the level read off the screen or just picked, which is the newest word, else the one the
// hooks reported (ChatFooter drops the screen's when a new report comes, so a silent downgrade shows).
export function chipEffort(seen: EffortLevel | null, reported: EffortLevel | null): EffortLevel | null {
    return seen ?? reported;
}

export function effortCommand(level: EffortLevel | "auto"): string {
    return `/effort ${level}`;
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
