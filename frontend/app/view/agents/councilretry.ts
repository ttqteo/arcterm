// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

// The models a failed council call can be retried on instead of its seat's own: the claude aliases `claude --model`
// takes, and Opus 4.8 by its full id. A retry on one of them runs once on it; the seat keeps its model for the calls
// after it.
export const RETRY_MODELS: readonly string[] = ["opus", "claude-opus-4-8", "sonnet", "fable", "haiku"];

/** The model Claude Code itself falls back to when its safeguards flag a call: Opus 4.8, which the newer models'
 *  stronger safeguards (Opus 5.5, Sonnet 5.5) do not cover. A flagged call offers it first. */
export const SAFEGUARD_FALLBACK = "claude-opus-4-8";

const NAMES: Record<string, string> = { "claude-opus-4-8": "Opus 4.8" };

/** A failure Claude's safeguards caused: the CLI's "API Error: Opus 5.5's safeguards flagged this session …". */
export function isSafeguardFlag(error: string | null | undefined): boolean {
    return /safeguards flagged/i.test(error ?? "");
}

/** Whether the seat's own model is m: the same alias or id, or a full id that names the alias (`claude-opus-5-5`
 *  names opus; `claude-opus-4-8` is its own entry, so it does not). */
function isOwn(own: string, m: string): boolean {
    if (own === m) {
        return true;
    }
    if (m.includes("-") || own === SAFEGUARD_FALLBACK) {
        return false;
    }
    return own.split(/[-_.\s]/).includes(m);
}

/** The models to offer in "Retry with…" for a seat: every retry model but the seat's own. A call the safeguards
 *  flagged gets Opus 4.8 first, the model Claude Code falls back to. A live agent's seat answers with its own session,
 *  so it gets none. */
export function retryModelChoices(
    expert: Pick<CouncilExpert, "model" | "agent"> | null | undefined,
    error?: string | null
): string[] {
    if (expert == null || (expert.agent ?? "") !== "") {
        return [];
    }
    const own = (expert.model ?? "").toLowerCase();
    const choices = RETRY_MODELS.filter((m) => !isOwn(own, m));
    if (isSafeguardFlag(error) && choices.includes(SAFEGUARD_FALLBACK)) {
        return [SAFEGUARD_FALLBACK, ...choices.filter((m) => m !== SAFEGUARD_FALLBACK)];
    }
    return choices;
}

/** The menu label of one retry model: "Retry on sonnet", "Retry on Opus 4.8". */
export function retryModelLabel(model: string): string {
    return `Retry on ${NAMES[model] ?? model}`;
}
