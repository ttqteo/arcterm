// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import type { SurfaceKey } from "@/app/view/agents/agents";

export type { SurfaceKey };

// Evaluated fresh on every keydown. `leader` is the active leader prefix (e.g. "g") or null.
export interface KeyContext {
    surface: SurfaceKey;
    editable: boolean; // focus is in an input/textarea/select/contenteditable (covers the terminal textarea)
    modalOpen: boolean; // command palette / new-agent / new-project / any modalsModel modal is open
    leader: string | null;
}

// keys syntax reuses keyutil descriptors:
//   single: "Ctrl:1" | "j" | "Enter" | "Shift:Tab"
//   leader sequence: "g a" (space-separated: <leader> <next>)
export interface Binding {
    id: string;
    keys: string;
    group: string; // cheat-sheet section, e.g. "Global" | "Navigation" | "Agent"
    label: string; // human text for cheat sheet + which-key bar
    when?: (ctx: KeyContext) => boolean; // default: always active
    // Excluded from the command palette's derived command list (the cheat sheet still shows it). Set on
    // postures — keys pressed while looking at the screen rather than actions searched by name — on
    // multi-press gestures a single row cannot express, and on chords that duplicate a better-labelled
    // binding. See palette-commands.ts.
    paletteHidden?: boolean;
    // Irreversible, and its run() does not already ask for confirmation. The keyboard runs it directly —
    // the user pressed the key — but a remote caller (wsh ui do, cockpit/uiclient.ts) must get the user's
    // confirmation first.
    destructive?: boolean;
    // Return false to explicitly NOT consume the key (let it pass through, e.g. first Ctrl+C to the PTY).
    // Any other return (including void) consumes it.
    run: (ctx: KeyContext) => void | boolean;
}

export type MatchResult =
    | { kind: "none" }
    | { kind: "enterLeader"; leader: string }
    | { kind: "reset" } // invalid continuation: clear leader, consume the key
    | { kind: "resetAndProcess"; result: MatchResult } // clear leader, then act on the re-matched result
    | { kind: "run"; binding: Binding };
