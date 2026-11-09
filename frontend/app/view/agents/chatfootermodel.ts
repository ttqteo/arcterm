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
