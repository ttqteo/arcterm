// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

// Projects the live keybinding registry into command-palette rows, so the registry is the single
// source of truth for what the cockpit can do and what it is called — and every row can show the chord
// that runs it. Before this module the palette hand-wrote eleven commands, duplicating a slice of the
// registry's labels and showing no chords at all.

import type { Binding, KeyContext, SurfaceKey } from "@/app/store/keybindings/types";
import { THEMES } from "@/app/view/agents/themes";
import type { DrillId } from "./palette-scope";

export interface CommandItem {
    key: string; // binding id, or "cmd:<slug>" for a chordless extra
    title: string;
    keys?: string; // chord descriptor for formatChord; absent for chordless extras
    group: string;
    destructive?: boolean; // see Binding.destructive
    drill?: DrillId; // opens a picker instead of running
    run: () => void | boolean; // false = the binding did not act (its target is absent)
}

// Binding guards are written against the posture of someone looking at a surface. While the palette is
// open the live context has modalOpen: true and editable: true (its search input holds focus), so
// evaluating guards against it would reject nearly everything worth listing. Applicability is judged
// against the context that exists one frame after the palette closes.
export function postCloseContext(surface: SurfaceKey): KeyContext {
    return { surface, editable: false, modalOpen: false, leader: null };
}

// Prefer the chord a user types deliberately: a leader sequence ("g u") over a modifier chord
// ("Ctrl:Tab") over a bare posture key ("j"), so a row never advertises the key you press without
// thinking when a memorable one exists for the same action.
function chordRank(keys: string): number {
    if (keys.includes(" ")) {
        return 0;
    }
    if (keys.includes(":")) {
        return 1;
    }
    return 2;
}

export function buildCommandItems(bindings: Binding[], ctx: KeyContext): CommandItem[] {
    const byLabel = new Map<string, Binding>();
    for (const b of bindings) {
        if (b.paletteHidden) {
            continue;
        }
        if (b.when != null && !b.when(ctx)) {
            continue;
        }
        const prev = byLabel.get(b.label);
        if (prev == null || chordRank(b.keys) < chordRank(prev.keys)) {
            byLabel.set(b.label, b);
        }
    }
    return [...byLabel.values()].map((b) => ({
        key: b.id,
        title: b.label,
        keys: b.keys,
        group: b.group,
        ...(b.destructive ? { destructive: true } : {}),
        run: () => b.run(ctx),
    }));
}

// The registry's "Go to" bindings are the surfaces; they are their own scope, not commands.
export const GOTO_GROUP = "Go to";

export interface ExtraDeps {
    openNewProject: () => void;
}

// The cockpit actions that have no chord to derive from. A drill opens a picker rather than
// acting, so there is one "Switch theme…" row instead of one row per theme.
export function buildExtraItems(deps: ExtraDeps): CommandItem[] {
    return [
        { key: "cmd:new-project", title: "New project", group: "Global", run: deps.openNewProject },
        { key: "cmd:theme", title: "Switch theme…", group: "Appearance", drill: "theme", run: () => {} },
    ];
}

export type StartId = "run" | "agent" | "initiative";

export interface StartDef {
    id: StartId;
    title: string;
    meta?: string;
    echo: string;
    binding: string; // the registry binding this row stands in for
}

// The Start group: opening a creation window is a row on every surface, not a surface-local key. Each row
// stands in for a registry binding, which Commands leaves out so one action is not listed twice; a Global
// binding lends the row its chord, a surface-local one works only there so lends none.
export const START_DEFS: StartDef[] = [
    {
        id: "run",
        title: "New run…",
        meta: "goal or plan file, workers, models",
        echo: "Opens the New run window",
        binding: "jarvis:new-run",
    },
    { id: "agent", title: "New agent…", echo: "Opens the New agent window", binding: "new-agent" },
    {
        id: "initiative",
        title: "New initiative…",
        echo: "Opens the new initiative form",
        binding: "jarvis:new-initiative",
    },
];

export const START_BINDINGS = new Set(START_DEFS.map((d) => d.binding));

// the registry group holding a surface's own bindings
const SURFACE_GROUP: Partial<Record<SurfaceKey, string>> = {
    cockpit: "Cockpit",
    jarvis: "Jarvis",
    agent: "Agent",
    code: "Code",
    files: "Diff",
};

const GROUP_ORDER = ["Global", "Navigation", "Appearance", "Help"];

// Commands with nothing typed: the current surface's own group first, labelled as such, then the
// fixed groups, then anything else the registry grows, alphabetically, so a new group is never lost.
export function commandGroups<T extends { group: string }>(
    items: T[],
    surface: SurfaceKey
): { key: string; label: string; items: T[] }[] {
    const own = SURFACE_GROUP[surface];
    const present = [...new Set(items.map((it) => it.group))];
    const fixed = [...(own != null ? [own] : []), ...GROUP_ORDER.filter((g) => g !== own)];
    const rest = present.filter((g) => !fixed.includes(g)).sort();
    return [...fixed, ...rest]
        .map((g) => ({
            key: `cmd-group:${g}`,
            label: g === own ? `${g} · this surface` : g,
            items: items.filter((it) => it.group === g),
        }))
        .filter((g) => g.items.length > 0);
}

export interface ThemeItem {
    key: string;
    id: string;
    title: string;
    swatch: string[]; // the theme's own colors, so a row previews what it applies
    current: boolean;
}

export function buildThemeItems(activeId: string): ThemeItem[] {
    return THEMES.map((t) => ({
        key: `theme:${t.id}`,
        id: t.id,
        title: t.name,
        swatch: [t.palette.bg, t.palette.surfaceRaised, t.palette.accent, t.palette.success],
        current: t.id === activeId,
    }));
}
