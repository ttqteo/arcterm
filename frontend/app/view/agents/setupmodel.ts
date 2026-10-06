// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

// Pure derivations behind the Setup surface's Instructions tab: each harness row's state, the header
// status, the save count, and the editor's conflict transitions. setupstore.ts feeds these the agentsync
// RPC results; setupsurface.tsx renders them.

export type HarnessRowState = "in-sync" | "out-of-date" | "not-written" | "not-set-up";

// "absent" covers a missing file, a file with no arcterm region, and a blank shared doc: in each case
// the harness does not have the shared instructions yet.
export function harnessRowState(h: Pick<AgentSyncHarness, "present" | "steering">): HarnessRowState {
    if (!h.present) {
        return "not-set-up";
    }
    if (h.steering === "current") {
        return "in-sync";
    }
    if (h.steering === "stale") {
        return "out-of-date";
    }
    return "not-written";
}

export function harnessRowLabel(state: HarnessRowState): string {
    switch (state) {
        case "in-sync":
            return "In sync";
        case "out-of-date":
            return "Out of date";
        case "not-written":
            return "Not written yet";
        case "not-set-up":
            return "Not set up";
    }
}

export type Tone = "ok" | "warn" | "none";

export function harnessRowTone(state: HarnessRowState): Tone {
    switch (state) {
        case "in-sync":
            return "ok";
        case "out-of-date":
            return "warn";
        default:
            return "none";
    }
}

// "Save to N harnesses": a save writes every present harness, whatever its state.
export function saveTargetCount(rows: Pick<AgentSyncHarness, "present">[]): number {
    return rows.filter((r) => r.present).length;
}

export interface HeaderStatus {
    text: string;
    tone: Tone;
}

export function headerStatus(rows: Pick<AgentSyncHarness, "present" | "steering">[]): HeaderStatus {
    const present = rows.filter((r) => r.present);
    const n = present.length;
    if (n === 0) {
        return { text: "No harnesses set up", tone: "none" };
    }
    const behind = present.filter((r) => r.steering !== "current").length;
    if (behind === 0) {
        return { text: `${n} ${n === 1 ? "harness" : "harnesses"} in sync`, tone: "ok" };
    }
    return { text: `${behind} of ${n} harnesses out of date`, tone: "warn" };
}

export function lineCount(text: string): number {
    const t = text.replace(/\n+$/, "");
    return t === "" ? 0 : t.split("\n").length;
}

// "N lines changed": lines the draft adds or drops against what was loaded, as a multiset so a moved
// line does not count and an insertion does not shift every line after it.
export function changedLineCount(base: string, draft: string): number {
    if (base === draft) {
        return 0;
    }
    const pool = new Map<string, number>();
    for (const l of base.split("\n")) {
        pool.set(l, (pool.get(l) ?? 0) + 1);
    }
    let added = 0;
    for (const l of draft.split("\n")) {
        const left = pool.get(l) ?? 0;
        if (left > 0) {
            pool.set(l, left - 1);
        } else {
            added++;
        }
    }
    let removed = 0;
    for (const left of pool.values()) {
        removed += left;
    }
    return Math.max(added, removed, 1);
}

// ---- editor: draft, mtime guard, conflict ----

// One editable file: what was read (base, mtime), what the user has typed (draft), and whether the last
// save found the file changed on disk. The shared doc uses it.
export interface DocEditor {
    base: string;
    mtime: number;
    draft: string;
    conflict: boolean;
}

export const EMPTY_EDITOR: DocEditor = { base: "", mtime: 0, draft: "", conflict: false };

export function isDirty(ed: DocEditor): boolean {
    return ed.draft !== ed.base;
}

// A background read. A clean editor takes the disk as is. A draft keeps its base and mtime, so an
// outside edit still surfaces as a conflict on save, unless the text on disk is unchanged and only its
// mtime moved.
export function editorLoaded(ed: DocEditor, content: string, mtime: number): DocEditor {
    if (!isDirty(ed)) {
        return editorReload(content, mtime);
    }
    return content === ed.base ? { ...ed, mtime } : ed;
}

export function editorTyped(ed: DocEditor, draft: string): DocEditor {
    return { ...ed, draft };
}

export function editorDiscard(ed: DocEditor): DocEditor {
    return { ...ed, draft: ed.base, conflict: false };
}

// Reload after a conflict: the disk wins and the draft is lost.
export function editorReload(content: string, mtime: number): DocEditor {
    return { base: content, mtime, draft: content, conflict: false };
}

// The baseMtime a save sends. Overwrite sends 0, which the backend reads as "skip the check".
export function saveBaseMtime(ed: DocEditor, overwrite: boolean): number {
    return overwrite ? 0 : ed.mtime;
}

// The result of writing `written`. A conflict keeps the draft and the old mtime, so a plain save
// conflicts again until the user picks Reload or Overwrite. Typing that landed while the write was in
// flight stays a draft.
export function editorSaved(ed: DocEditor, written: string, res: { mtime: number; conflict: boolean }): DocEditor {
    if (res.conflict) {
        return { ...ed, conflict: true };
    }
    return { base: written, mtime: res.mtime, draft: ed.draft, conflict: false };
}
