import type { AgentsViewModel } from "@/app/view/agents/agents";
import type { Getter } from "jotai";
import type { StatusTone } from "../palette-rows";

export type ThingKind = "run" | "agent" | "session" | "record" | "effort" | "channel"; // matches GroupKind names
export type ActionGroup = "open" | "steer" | "stop"; // the action list's sections, in this order

export const ACTION_GROUPS: ActionGroup[] = ["open", "steer", "stop"];

export interface ActionDeps {
    model: AgentsViewModel;
}

export type ActionInput<T> =
    | { kind: "text"; placeholder: string }
    | { kind: "pick"; placeholder: string; options: (thing: T) => { value: string; label: string }[] };

export interface ThingAction<T> {
    id: string; // "run:cancel"
    label: string; // "Cancel run" — also the verb-search text
    group: ActionGroup;
    applies: (thing: T) => boolean; // pure; the owning view's own condition
    input?: ActionInput<T>; // present: Enter opens a second level that collects `value`
    run: (thing: T, deps: ActionDeps, value?: string) => void | Promise<void>;
    destructive?: boolean; // red; the handler owns its confirm
    // a toggle reads differently per thing; `label` stays its search and Not-now text
    title?: (thing: T) => string;
    verb?: (thing: T) => string; // what Enter does, in place of the label's first word
    status?: (thing: T) => { label: string; tone: StatusTone };
    echo?: (thing: T) => string;
}

// one listable thing; key MUST equal the palette row key command-palette.tsx gives the same thing today
// (run:<id>, agent:<id>, session:<runtime>:<id>, record:<id>, effort:<oref>, channel:<oid>)
export interface ThingEntry<T> {
    key: string;
    title: string;
    thing: T;
}

export interface ThingKindDef<T> {
    kind: ThingKind;
    noun: string; // "Run" — the drill chip reads `Run › <title>`
    actions: ThingAction<T>[];
    entries: (get: Getter, model: AgentsViewModel) => ThingEntry<T>[];
}

export interface ThingActionList<T> {
    available: Record<ActionGroup, ThingAction<T>[]>; // registry order kept inside each group
    notNow: ThingAction<T>[]; // defined for the kind, not applicable now ("Not now" line)
}

export function actionsFor<T>(actions: ThingAction<T>[], thing: T): ThingActionList<T> {
    const list: ThingActionList<T> = { available: { open: [], steer: [], stop: [] }, notNow: [] };
    for (const action of actions) {
        if (action.applies(thing)) list.available[action.group].push(action);
        else list.notNow.push(action);
    }
    return list;
}

export interface VerbRow<T> {
    key: string; // `action:<action.id>:<entry.key>`
    search: string; // `${action.label} ${entry.title}`
    action: ThingAction<T>;
    entry: ThingEntry<T>;
}

// one row per (action, entry) the action applies to — "cancel" lists Cancel run once per cancellable run
export function verbRows<T>(def: ThingKindDef<T>, entries: ThingEntry<T>[]): VerbRow<T>[] {
    const rows: VerbRow<T>[] = [];
    for (const action of def.actions) {
        for (const entry of entries) {
            if (!action.applies(entry.thing)) continue;
            rows.push({
                key: `action:${action.id}:${entry.key}`,
                search: `${action.label} ${entry.title}`,
                action,
                entry,
            });
        }
    }
    return rows;
}
