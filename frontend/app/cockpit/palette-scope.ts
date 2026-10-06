// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

// Pure scope model for the universal search. Scopes are visible chips; a typed prefix ("r:") or one of
// the old sigils narrows to one when typed into an empty All query. The transitions live here so the
// component only renders them.

import type { SurfaceKey } from "@/app/store/keybindings/types";
import { fuzzyScore } from "./palette-match";

export type ScopeId =
    | "all"
    | "needs"
    | "goto"
    | "agents"
    | "runs"
    | "sessions"
    | "records"
    | "projects"
    | "files"
    | "commands";

// a command row that opens a sub-list instead of acting
export type DrillId = "theme";

export interface ScopeDef {
    id: ScopeId;
    label: string;
    prefix?: string; // typed as "<prefix>:"
    sigil?: string; // still works, no longer shown
    noun: string; // "No <noun> match …"
    placeholder: string;
}

export const SCOPES: ScopeDef[] = [
    { id: "all", label: "All", noun: "results", placeholder: "Search, or type a goal…" },
    { id: "needs", label: "Needs you", prefix: "n", noun: "waiting items", placeholder: "Find what is waiting…" },
    { id: "goto", label: "Go to", prefix: "g", noun: "surfaces", placeholder: "Go to a surface…" },
    { id: "agents", label: "Agents", prefix: "a", sigil: "@", noun: "agents", placeholder: "Find an agent…" },
    { id: "runs", label: "Runs", prefix: "r", noun: "runs", placeholder: "Find a run…" },
    {
        id: "sessions",
        label: "Sessions",
        prefix: "s",
        sigil: "/",
        noun: "sessions",
        placeholder: "Find a session to resume…",
    },
    { id: "records", label: "Records", prefix: "re", noun: "records", placeholder: "Find a record or initiative…" },
    {
        id: "projects",
        label: "Projects",
        prefix: "p",
        sigil: "#",
        noun: "projects",
        placeholder: "Switch project, or project goal…",
    },
    { id: "files", label: "Files", prefix: "f", noun: "files", placeholder: "Open a file, path:line jumps…" },
    { id: "commands", label: "Commands", prefix: "c", sigil: ">", noun: "commands", placeholder: "Run a command…" },
];

// the mockup names a few, not all nine; Needs you and Commands are the ones worth teaching first
const ALL_EMPTY_PLACEHOLDER = "Search, or type a goal · n: r: a: c: … narrow to one kind";

export const DRILL_LABELS: Record<DrillId, string> = { theme: "Theme" };
export const DRILL_PLACEHOLDERS: Record<DrillId, string> = { theme: "Pick a theme…" };

export function scopeDef(id: ScopeId): ScopeDef {
    return SCOPES.find((s) => s.id === id)!;
}

// Code's Ctrl+P was a file finder; it folds in as the Files scope, preselected there
export function initialScope(surface: SurfaceKey): ScopeId {
    return surface === "code" ? "files" : "all";
}

export interface ActionDrillThing {
    key: string;
    title: string;
    noun: string; // "Run", "Agent", … — the drill chip reads `<noun> › <title>`
}

export interface ActionDrill {
    thing: ActionDrillThing;
    back: { scope: ScopeId; query: string; sel: number; asGoal: boolean }; // restored on leave
    input: { actionId: string; label: string } | null; // a second level that takes a value
}

export interface NavState {
    scope: ScopeId;
    query: string;
    drill: DrillId | null;
    asGoal: boolean; // All only: the "Start as a goal" row was chosen, so the launch rows lead
    via: "prefix" | "pick"; // how a narrowed scope was reached; a picked one teaches its prefix
    actions: ActionDrill | null;
}

export function initialNav(surface: SurfaceKey): NavState {
    return { scope: initialScope(surface), query: "", drill: null, asGoal: false, via: "pick", actions: null };
}

function sigilScope(ch: string): ScopeId | null {
    return SCOPES.find((s) => s.sigil === ch)?.id ?? null;
}

// "r:fix" → Runs + "fix". A prefix followed by a slash is a path ("c:\Users", "f:/tmp"), so stays text.
export function parsePrefix(value: string): { scope: ScopeId; rest: string } | null {
    const m = value.match(/^([a-z]{1,2}):/);
    if (m == null) {
        return null;
    }
    const def = SCOPES.find((s) => s.prefix === m[1]);
    const rest = value.slice(m[0].length);
    if (def == null || rest.startsWith("\\") || rest.startsWith("/")) {
        return null;
    }
    return { scope: def.id, rest };
}

// A sigil or prefix typed into an empty All query becomes the chip instead of query text. Checked
// against the previous query rather than the new value's length, so a pasted "@juno" or "r:fix" lands
// narrowed; a prefix also counts while the previous query is still its own start ("r" before "r:"),
// so "fix:" or "xr:" stay text.
export function typeQuery(s: NavState, value: string): NavState {
    if (s.scope === "all" && s.drill == null && s.actions == null) {
        if (s.query === "") {
            const scope = sigilScope(value[0] ?? "");
            if (scope != null) {
                return { ...s, scope, query: value.slice(1), asGoal: false, via: "prefix" };
            }
        }
        const p = parsePrefix(value);
        if (p != null) {
            const typed = `${scopeDef(p.scope).prefix}:`;
            if (s.query.length < typed.length && typed.startsWith(s.query)) {
                return { ...s, scope: p.scope, query: p.rest, asGoal: false, via: "prefix" };
            }
        }
    }
    return { ...s, query: value, asGoal: false };
}

// ": narrows to Runs" after a lone "r" in All; the caller decides when to render it
export function ghostHint(query: string): string | null {
    const def = SCOPES.find((s) => s.prefix != null && s.prefix === query);
    return def ? `: narrows to ${def.label}` : null;
}

export function placeholderFor(nav: NavState): string {
    if (nav.actions != null) {
        return nav.actions.input ? `${nav.actions.input.label}…` : `Filter ${nav.actions.thing.noun} actions…`;
    }
    if (nav.drill != null) {
        return DRILL_PLACEHOLDERS[nav.drill];
    }
    if (nav.scope === "all") {
        return ALL_EMPTY_PLACEHOLDER;
    }
    const def = scopeDef(nav.scope);
    if (nav.via === "pick" && def.prefix != null) {
        return `${def.placeholder.replace(/…$/, "")} · next time, ${def.prefix}: from All jumps here`;
    }
    return def.placeholder;
}

// leaving an action drill by any route but Backspace/← drops its filter along with it
function withoutActions(s: NavState): NavState {
    return s.actions == null ? s : leaveActions(s).nav;
}

export function cycleScope(s: NavState, dir: 1 | -1): NavState {
    const base = withoutActions(s);
    const i = SCOPES.findIndex((d) => d.id === base.scope);
    const next = SCOPES[(i + dir + SCOPES.length) % SCOPES.length].id;
    return { ...base, scope: next, drill: null, asGoal: false, via: "pick" };
}

export function pickScope(s: NavState, scope: ScopeId): NavState {
    return { ...withoutActions(s), scope, drill: null, asGoal: false, via: "pick" };
}

// Backspace on an empty query: leave an action input, then the action drill, then a command drill,
// then drop the scope back to All. null means there is nothing to leave, so the key keeps its
// ordinary meaning.
export function backspaceEmpty(s: NavState): NavState | null {
    if (s.query !== "") {
        return null;
    }
    if (s.actions?.input != null) {
        return { ...s, actions: { ...s.actions, input: null } };
    }
    if (s.actions != null) {
        return leaveActions(s).nav;
    }
    if (s.drill != null) {
        return { ...s, drill: null };
    }
    if (s.scope !== "all") {
        return { ...s, scope: "all", asGoal: false };
    }
    return null;
}

export function openDrill(s: NavState, drill: DrillId): NavState {
    return { scope: "commands", query: "", drill, asGoal: false, via: s.via, actions: null };
}

export function openActions(s: NavState, thing: ActionDrillThing, sel: number): NavState {
    return {
        ...s,
        query: "",
        asGoal: false,
        actions: { thing, back: { scope: s.scope, query: s.query, sel, asGoal: s.asGoal }, input: null },
    };
}

export function openActionInput(s: NavState, input: { actionId: string; label: string }): NavState {
    if (s.actions == null) {
        return s;
    }
    return { ...s, query: "", actions: { ...s.actions, input } };
}

// null: not in an action drill
export function leaveActions(s: NavState): { nav: NavState; sel: number } | null {
    if (s.actions == null) {
        return null;
    }
    const { back } = s.actions;
    return {
        nav: { ...s, scope: back.scope, query: back.query, asGoal: back.asGoal, actions: null },
        sel: back.sel,
    };
}

// → opens a row's actions only with the caret at the end; mid-query it moves the caret as usual.
// A null caret (no selection info) counts as the end.
export function caretAtEnd(query: string, caret: number | null): boolean {
    return caret == null || caret >= query.length;
}

export interface ChannelLaunch {
    token: string; // project selector (first whitespace token)
    goal: string; // trimmed goal text after the token
}

// Projects scope: "backend fix the auth bug" starts a goal in #backend. A lone token, or a token with
// only trailing space, is still picking a project.
export function parseProjectLaunch(query: string): ChannelLaunch | null {
    const m = query.replace(/^\s+/, "").match(/^(\S+)\s+([\s\S]+)$/);
    if (m == null || m[2].trim() === "") {
        return null;
    }
    return { token: m[1], goal: m[2].trim() };
}

// Resolve a channel selector token to a channel: exact (case-insensitive) name first,
// else the best fuzzy match, else undefined.
export function resolveChannelToken<T extends { name: string }>(token: string, channels: T[]): T | undefined {
    const t = token.toLowerCase();
    const exact = channels.find((c) => c.name.toLowerCase() === t);
    if (exact) {
        return exact;
    }
    let best: T | undefined;
    let bestScore = -Infinity;
    for (const c of channels) {
        const s = fuzzyScore(token, c.name);
        if (s != null && s > bestScore) {
            bestScore = s;
            best = c;
        }
    }
    return best;
}
