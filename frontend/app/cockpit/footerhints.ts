// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

// Curated footer hints. Presentation source of truth: each chip supplies a terse glyph + label and
// references the real binding id(s) it stands for. The footer only renders a chip when at least one
// referenced binding is active for the current KeyContext (footer-visible.ts), so a chip can never
// show a key that wouldn't fire. footerhints.test.ts asserts every referenced id exists.

import type { SurfaceKey } from "@/app/store/keybindings/types";
import { peekClickLabel } from "./ctrlheld";

export interface FooterHint {
    ids: string[]; // binding ids this chip represents (>=1); shown if any is active in ctx
    keys?: string; // chord in binding notation ("Mod:p"); glyph computed at render (platform-aware)
    glyph?: string; // literal glyph for composite/non-modifier hints ("↑↓", "[ ]", "esc")
    label: string; // terse action, e.g. "move", "palette"
    ctrlLit?: boolean; // renders lit while the peek key is held (ctrlheld.ts): the key that turns a click into this action
}

// Appended to every surface; each filtered by its binding's live when(ctx).
export const GLOBAL_HINTS: FooterHint[] = [
    { ids: ["leader:enter"], keys: "Mod:g", label: "go" }, // the go-to leader, from anywhere including the terminal
    { ids: ["surface:back-home"], glyph: "esc", label: "home" }, // deep surfaces only (via its when)
    {
        ids: ["list:peek", "cockpit:peek"],
        // a getter, read at render: the platform is not known at module load (keysym.ts)
        get glyph() {
            return `space · ${peekClickLabel()}`;
        },
        label: "peek",
        ctrlLit: true,
    },
    { ids: ["palette"], keys: "Mod:p", label: "palette" },
    { ids: ["new-agent"], keys: "Mod:n", label: "new" },
    { ids: ["help"], glyph: "?", label: "help" }, // Shift+?; drops in the terminal
];

// The agent surface and the Diff surface have surface-specific bindings; the rest fall back to
// GLOBAL_HINTS only.
export const SURFACE_HINTS: Partial<Record<SurfaceKey, FooterHint[]>> = {
    agent: [
        {
            ids: ["agent:prev-up", "agent:next-down", "agent:prev-k", "agent:next-j", "agent:prev", "agent:next"],
            glyph: "↑↓",
            label: "move",
        },
        { ids: ["agent:toggle-rail"], glyph: "d", label: "rail" },
        { ids: ["agent:fullscreen"], glyph: "f", label: "full" },
        { ids: ["agent:fullscreen-chord"], keys: "F11", label: "full" }, // reachable in the terminal
        { ids: ["agent:canvas-open"], glyph: "c", label: "canvas" }, // terminal mode with a canvas
        { ids: ["agent:view-cycle"], keys: "Alt:c", label: "switch view" }, // a canvas or review, also in the terminal
        { ids: ["agent:back"], glyph: "esc", label: "back" },
        { ids: ["agent:leave-center"], glyph: "esc", label: "terminal" }, // History or a session only, via its binding
        { ids: ["cycle-agent-next", "cycle-agent-prev"], keys: "Ctrl:Tab", label: "cycle" },
        { ids: ["agent:return-nav"], keys: "Shift:Escape", label: "leave" }, // editable-only via its binding
        // canvas mode hides every chip above but leave; this order serves both canvas mode and marking
        { ids: ["agent:canvas-send"], keys: "Mod:Enter", label: "send" },
        { ids: ["agent:mark-stop"], glyph: "m", label: "stop marking" },
        { ids: ["agent:canvas-close"], glyph: "c", label: "terminal" },
        { ids: ["agent:canvas-prev", "agent:canvas-next"], glyph: "[ ]", label: "board" },
        { ids: ["agent:mark-start"], glyph: "m", label: "mark" },
        // review mode: Ctrl+Enter names the tray's accent answer
        { ids: ["agent:review-approve"], keys: "Mod:Enter", label: "approve" },
        { ids: ["agent:review-request"], keys: "Mod:Enter", label: "request changes" },
        { ids: ["agent:review-comment"], glyph: "c", label: "comment" },
        { ids: ["agent:review-close"], glyph: "r", label: "terminal" },
        { ids: ["agent:review-prev", "agent:review-next"], glyph: "[ ]", label: "tab" },
    ],
    // ↑↓, ⏎ and g g left the footer for room; they still work and are in ? help.
    files: [
        // first, so a narrow footer keeps it: shown only while line comments wait to be sent
        { ids: ["files:review-send"], keys: "Mod:Enter", label: "send comments" },
        { ids: ["files:filter"], glyph: "/", label: "filter" },
        { ids: ["files:toggle-graph"], keys: "Shift:g", label: "graph" },
        { ids: ["files:change-refs"], glyph: "c", label: "change refs" }, // compare-only via its binding
        { ids: ["files:swap-refs"], keys: "Shift:s", label: "swap" }, // compare-only via its binding
        { ids: ["files:next-change", "files:prev-change"], keys: "Shift:n Shift:p", label: "next / prev change" },
        { ids: ["files:commit-tab"], keys: "Shift:c", label: "commit" },
        { ids: ["files:toggle-history"], keys: "Shift:h", label: "log" },
        { ids: ["files:toggle-sidebar"], keys: "Shift:b", label: "panel" },
        { ids: ["files:compare"], glyph: "c", label: "compare" }, // history-only via its binding
        { ids: ["files:refresh"], glyph: "r", label: "refresh" },
        { ids: ["files:switch-side"], glyph: "⇥", label: "side" }, // compare-only via its binding
        { ids: ["files:clear-filters"], glyph: "esc", label: "clear filters" }, // filtered-only via its binding
        { ids: ["files:exit-compare"], glyph: "esc", label: "leave compare" }, // compare-only via its binding
    ],
};
