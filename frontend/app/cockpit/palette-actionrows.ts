// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

// Pure pieces of the palette's actions: a thing's action list (→ on a row), how one action's row reads, and
// the rule for when a verb row ("Cancel run · <run>") counts as matching what was typed.

import {
    ACTION_GROUPS,
    actionsFor,
    type ActionGroup,
    type ThingAction,
    type ThingEntry,
    type ThingKindDef,
} from "./actions/types";
import { meetsNameFloor } from "./palette-groups";
import { rankPaletteItems } from "./palette-match";
import type { StatusTone } from "./palette-rows";

const GROUP_LABELS: Record<ActionGroup, string> = { open: "Open", steer: "Steer", stop: "Stop" };

// A thing's actions as palette sections. What does not apply now is named, unfiltered, so a missing
// action reads as unavailable rather than nonexistent.
export function actionListGroups<T>(
    def: ThingKindDef<T>,
    entry: ThingEntry<T>,
    query: string
): { groups: { key: string; label: string; actions: ThingAction<T>[] }[]; notNow: string | null } {
    const list = actionsFor(def.actions, entry.thing);
    const groups = ACTION_GROUPS.map((g) => ({
        key: g,
        label: GROUP_LABELS[g],
        actions: rankPaletteItems(
            list.available[g].map((action) => ({ search: action.label, action })),
            query
        ).map((r) => r.action),
    })).filter((g) => g.actions.length > 0);
    const notNow = list.notNow.length > 0 ? `Not now: ${list.notNow.map((a) => a.label).join(", ")}` : null;
    return { groups, notNow };
}

// the input level's chip and placeholder add their own "…"
export const bareLabel = (a: ThingAction<any>) => a.label.replace(/…$/, "");

export interface ActionRowView {
    title: string;
    verb: string; // what Enter does, shown on the selected row
    status?: { label: string; tone: StatusTone };
    echo: string; // the footer line
}

// How an action's row reads for one thing. An action that does not say otherwise is named by its label,
// Enter's verb is "Write" or "Pick" when it takes a value, else the label's own first word.
export function resolveActionRow<T>(action: ThingAction<T>, entry: ThingEntry<T>): ActionRowView {
    const { thing } = entry;
    const bare = bareLabel(action);
    let verb = action.label.split(" ", 1)[0];
    let echo = `${bare}: “${entry.title}”`;
    if (action.input?.kind === "pick") {
        verb = "Pick";
        echo = `Lists the choices, for “${entry.title}”`;
    } else if (action.input?.kind === "text") {
        verb = "Write";
        echo = `Takes the text here, for “${entry.title}”`;
    }
    return {
        title: action.title?.(thing) ?? (action.input?.kind === "text" ? `${bare}…` : action.label),
        verb: action.verb?.(thing) ?? verb,
        status: action.status?.(thing),
        echo: action.echo?.(thing) ?? echo,
    };
}

// A verb row's search text is its label plus the thing's title, so the title alone would match it too,
// and typing a run's name would list every action on that run beside the run itself. A verb row counts
// only when the query's first word is the verb.
export function verbLeads(query: string, label: string): boolean {
    const first = query.trim().split(/\s+/, 1)[0];
    return first !== "" && meetsNameFloor(first, label);
}

// "Actions · Cancel run" when every row is the same action, as typing a verb usually leaves them
export function verbGroupLabel(rows: { action: { label: string } }[]): string {
    const labels = new Set(rows.map((r) => r.action.label));
    return labels.size === 1 ? `Actions · ${[...labels][0]}` : "Actions";
}
