// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

// The models a failed council call can be retried on instead of its seat's own: the claude aliases `claude --model`
// takes. A retry on one of them runs once on it; the seat keeps its model for the calls after it.
export const RETRY_MODELS: readonly string[] = ["opus", "sonnet", "fable", "haiku"];

/** The models to offer in "Retry with…" for a seat: every retry model but the seat's own (an alias, or a full id that
 *  names it, as `claude-opus-5-5` names opus). A live agent's seat answers with its own session, so it gets none. */
export function retryModelChoices(expert: Pick<CouncilExpert, "model" | "agent"> | null | undefined): string[] {
    if (expert == null || (expert.agent ?? "") !== "") {
        return [];
    }
    const own = (expert.model ?? "").toLowerCase();
    return RETRY_MODELS.filter((m) => own !== m && !own.split(/[-_.\s]/).includes(m));
}

/** The menu label of one retry model: "Retry on sonnet". */
export function retryModelLabel(model: string): string {
    return `Retry on ${model}`;
}
