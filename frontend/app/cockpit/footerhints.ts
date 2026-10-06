// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

// Curated footer hints. Presentation source of truth: each chip supplies a terse glyph + label and
// references the real binding id(s) it stands for. The footer only renders a chip when at least one
// referenced binding is active for the current KeyContext (footer-visible.ts), so a chip can never
// show a key that wouldn't fire. footerhints.test.ts asserts every referenced id exists.

import type { SurfaceKey } from "@/app/store/keybindings/types";

export interface FooterHint {
    ids: string[]; // binding ids this chip represents (>=1); shown if any is active in ctx
    keys?: string; // chord in binding notation ("Ctrl:p"); glyph computed at render (platform-aware)
    glyph?: string; // literal glyph for composite/non-modifier hints ("↑↓", "[ ]", "esc")
    label: string; // terse action, e.g. "move", "palette"
    ctrlLit?: boolean; // renders lit while Ctrl is held (ctrlheld.ts): the key that turns a click into this action
}

// Appended to every surface; each filtered by its binding's live when(ctx).
export const GLOBAL_HINTS: FooterHint[] = [
    { ids: ["go:cockpit"], glyph: "g", label: "go" }, // bare g-leader; drops in the terminal
    { ids: ["leader:enter"], keys: "Ctrl:g", label: "go" }, // the same tree, reachable in the terminal
    { ids: ["surface:back-home"], glyph: "esc", label: "home" }, // deep surfaces only (via its when)
    { ids: ["list:peek", "cockpit:peek"], glyph: "space · ctrl+click", label: "peek", ctrlLit: true },
    { ids: ["palette"], keys: "Ctrl:p", label: "palette" },
    { ids: ["new-agent"], keys: "Ctrl:n", label: "new" },
    { ids: ["help"], glyph: "?", label: "help" }, // Shift+?; drops in the terminal
];

// The agent surface and the Diff surface have surface-specific bindings; the rest fall back to
// GLOBAL_HINTS only.
export const SURFACE_HINTS: Partial<Record<SurfaceKey, FooterHint[]>> = {
    agent: [
        { ids: ["agent:prev-k", "agent:next-j", "agent:prev", "agent:next"], glyph: "↑↓", label: "move" },
        { ids: ["agent:toggle-rail"], glyph: "d", label: "rail" },
        { ids: ["agent:fullscreen"], glyph: "f", label: "full" },
        { ids: ["agent:fullscreen-chord"], keys: "F11", label: "full" }, // reachable in the terminal
        { ids: ["agent:canvas-open"], glyph: "c", label: "canvas" }, // terminal mode with a canvas
        { ids: ["agent:back"], glyph: "esc", label: "back" },
        { ids: ["agent:leave-center"], glyph: "esc", label: "terminal" }, // History or a session only, via its binding
        { ids: ["cycle-agent-next", "cycle-agent-prev"], keys: "Ctrl:Tab", label: "cycle" },
        { ids: ["agent:return-nav"], keys: "Shift:Escape", label: "leave" }, // editable-only via its binding
        // canvas mode hides every chip above but leave; this order serves both canvas mode and marking
        { ids: ["agent:canvas-send"], keys: "Ctrl:Enter", label: "send" },
        { ids: ["agent:mark-stop"], glyph: "m", label: "stop marking" },
        { ids: ["agent:canvas-close"], glyph: "c", label: "terminal" },
        { ids: ["agent:canvas-prev", "agent:canvas-next"], glyph: "[ ]", label: "board" },
        { ids: ["agent:mark-start"], glyph: "m", label: "mark" },
        // review mode: Ctrl+Enter names the tray's accent answer
        { ids: ["agent:review-approve"], keys: "Ctrl:Enter", label: "approve" },
        { ids: ["agent:review-request"], keys: "Ctrl:Enter", label: "request changes" },
        { ids: ["agent:review-comment"], glyph: "c", label: "comment" },
        { ids: ["agent:review-close"], glyph: "r", label: "terminal" },
        { ids: ["agent:review-prev", "agent:review-next"], glyph: "[ ]", label: "tab" },
    ],
    // ↑↓, ⏎ and g g left the footer for room; they still work and are in ? help.
    files: [
        // first, so a narrow footer keeps it: shown only while line comments wait to be sent
        { ids: ["files:review-send"], keys: "Ctrl:Enter", label: "send comments" },
        { ids: ["files:filter"], glyph: "/", label: "filter" },
        { ids: ["files:toggle-graph"], glyph: "⇧G", label: "graph" },
        { ids: ["files:change-refs"], glyph: "c", label: "change refs" }, // compare-only via its binding
        { ids: ["files:swap-refs"], glyph: "⇧S", label: "swap" }, // compare-only via its binding
        { ids: ["files:next-change", "files:prev-change"], glyph: "⇧N ⇧P", label: "next / prev change" },
        { ids: ["files:toggle-history"], glyph: "⇧H", label: "history" },
        { ids: ["files:compare"], glyph: "c", label: "compare" }, // history-only via its binding
        { ids: ["files:refresh"], glyph: "r", label: "refresh" },
        { ids: ["files:switch-side"], glyph: "⇥", label: "side" }, // compare-only via its binding
        { ids: ["files:clear-filters"], glyph: "esc", label: "clear filters" }, // filtered-only via its binding
        { ids: ["files:exit-compare"], glyph: "esc", label: "leave compare" }, // compare-only via its binding
    ],
};
