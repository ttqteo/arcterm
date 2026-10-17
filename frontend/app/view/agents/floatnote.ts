// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0
//
// The ledge's two fixed tabs in Float (docs/superpowers/specs/2026-10-17-float-note-translate-design.md): the pure
// parts of Note, the one global scratch note, and Translate, the translate-shell terminal. What the Translate tab does
// with the terminals and the tool catalog, how a failed save reads, and which terminal is the Translate tab's. The
// state and the actions are floatnotestore.ts.

import type { AgentVM } from "./agentsviewmodel";

// the built-in tool's id (pkg/arctools): its terminal is the Translate tab's, not an agent or terminal tab
export const TRANSLATE_TOOL_ID = "trans";

// how long after the last keystroke the note saves
export const SCRATCH_SAVE_MS = 500;

export function isTranslateTerminal(a: Pick<AgentVM, "toolId">): boolean {
    return a.toolId === TRANSLATE_TOOL_ID;
}

export type TranslateStep =
    | { kind: "show"; id: string }
    | { kind: "open"; tool: ToolStatus }
    | { kind: "install"; tool: ToolStatus }
    | { kind: "missing" };

/** What pressing Translate does: focus the trans terminal if one exists, else open the tool when its command is on
 *  PATH, else install it; "missing" when the catalog is unread or does not list the tool. */
export function translateStep(terminals: readonly AgentVM[], tools: readonly ToolStatus[] | null): TranslateStep {
    const open = terminals.find(isTranslateTerminal);
    if (open != null) {
        return { kind: "show", id: open.id };
    }
    const tool = tools?.find((t) => t.id === TRANSLATE_TOOL_ID);
    if (tool == null) {
        return { kind: "missing" };
    }
    return tool.found ? { kind: "open", tool } : { kind: "install", tool };
}

/** The one line under the note when a save failed. */
export function scratchErrorLine(err: unknown): string {
    const raw = err instanceof Error ? err.message : String(err);
    const message = raw.replace(/^Error: /, "").replace(/\.$/, "");
    return `Couldn't save the note: ${message}. Your text stays here, and your next edit tries again.`;
}
