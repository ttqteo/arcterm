// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0
//
// The run part of a run row's right-click menu in the agent tree (a lead's row, or a run with no lead there): the
// palette's run actions (cockpit/actions/run.ts) that fit a menu, so the menu, the palette and the run sheet cannot
// disagree about when an action exists. An action with a pick becomes a submenu of its options; one that collects
// typed text (Message the lead, End final stage) has no place in a menu and stays with the palette and the sheet.

import type { RunThing } from "@/app/cockpit/actions/run";
import type { ThingAction } from "@/app/cockpit/actions/types";

export type RunMenuEntry =
    | { kind: "action"; action: ThingAction<RunThing> }
    | { kind: "pick"; action: ThingAction<RunThing>; options: { value: string; label: string }[] };

// runMenuEntries is the actions that apply to the run now, in the registry's order, less the ids in skip (what the
// row's own menu already offers)
export function runMenuEntries(
    actions: ThingAction<RunThing>[],
    thing: RunThing,
    skip: ReadonlySet<string>
): RunMenuEntry[] {
    const out: RunMenuEntry[] = [];
    for (const action of actions) {
        if (skip.has(action.id) || !action.applies(thing)) {
            continue;
        }
        if (action.input == null) {
            out.push({ kind: "action", action });
        } else if (action.input.kind === "pick") {
            const options = action.input.options(thing);
            if (options.length > 0) {
                out.push({ kind: "pick", action, options });
            }
        }
    }
    return out;
}
