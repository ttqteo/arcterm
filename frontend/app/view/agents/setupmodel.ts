// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

// Pure derivations behind the Setup surface's Instructions tab: each harness row's state, the header
// status, the save count, and the editor's conflict transitions. setupstore.ts feeds these the agentsync
// RPC results; setupsurface.tsx renders them.

export type HarnessRowState = "in-sync" | "out-of-date" | "not-written" | "blank" | "not-set-up";

// "absent" covers a missing file and a file with no arcterm region: in each case the harness does not have
// the shared instructions yet. "blank" is the backend's word for an empty shared doc: there is nothing to
// write, whatever the harness file holds.
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
    if (h.steering === "blank") {
        return "blank";
    }
    return "not-written";
}

export function harnessRowLabel(state: HarnessRowState): string {
    switch (state) {
        case "in-sync":
            return "Up to date";
        case "out-of-date":
            return "Out of date";
        case "not-written":
            return "Not written yet";
        case "blank":
            return "Shared doc is empty";
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
    // an empty doc is not something a harness is behind: say so rather than count every row out of date
    if (present.some((r) => r.steering === "blank")) {
        return { text: "The shared doc is empty", tone: "none" };
    }
    const behind = present.filter((r) => r.steering !== "current").length;
    if (behind === 0) {
        return { text: `${n} ${n === 1 ? "harness" : "harnesses"} up to date`, tone: "ok" };
    }
    return { text: `${behind} of ${n} harnesses out of date`, tone: "warn" };
}

// ---- Sync now ----

type SteeringRow = Pick<AgentSyncHarness, "present" | "steering">;

// Sync now has work to do: a present harness lacks the current doc, and the doc is not empty.
export function needsSync(rows: SteeringRow[]): boolean {
    const states = rows.map(harnessRowState);
    return !states.includes("blank") && states.some((s) => s === "out-of-date" || s === "not-written");
}

// Out of date and not written yet are different things: the first follows an older doc, the second has not
// received one. The header's own text lumps them, so the Sync now line breaks them apart.
export function syncBreakdown(rows: SteeringRow[]): string | null {
    const states = rows.map(harnessRowState);
    if (states.includes("blank")) {
        return null;
    }
    const stale = states.filter((s) => s === "out-of-date").length;
    const unwritten = states.filter((s) => s === "not-written").length;
    const parts = [];
    if (stale > 0) {
        parts.push(`${stale} out of date`);
    }
    if (unwritten > 0) {
        parts.push(`${unwritten} not written yet`);
    }
    return parts.length > 0 ? parts.join(" · ") : null;
}

// What an apply would do, counted from the actions its dry run returns. The kinds are agentsync's own:
// steering-write is a harness file, skill-write and skill-remove a skill copy, and any other skill-* kind
// (unmanaged, a link) is a copy the sync leaves alone. A kind this does not know counts for nothing.
export interface SyncPlan {
    harnessFiles: number;
    skillCopies: number;
    skillsRemoved: number;
    leftAlone: number;
}

export function syncPlan(actions: (Pick<AgentSyncAction, "kind"> & Partial<AgentSyncAction>)[]): SyncPlan {
    const plan: SyncPlan = { harnessFiles: 0, skillCopies: 0, skillsRemoved: 0, leftAlone: 0 };
    for (const a of actions) {
        if (a.kind === "steering-write") {
            plan.harnessFiles++;
        } else if (a.kind === "skill-write") {
            plan.skillCopies++;
        } else if (a.kind === "skill-remove") {
            plan.skillsRemoved++;
        } else if (a.kind.startsWith("skill-")) {
            plan.leftAlone++;
        }
    }
    return plan;
}

function planParts(plan: SyncPlan): string[] {
    const parts: string[] = [];
    if (plan.skillCopies > 0) {
        parts.push(`${plan.skillCopies} skill ${plan.skillCopies === 1 ? "copy" : "copies"} updated`);
    }
    if (plan.skillsRemoved > 0) {
        parts.push(`${plan.skillsRemoved} removed`);
    }
    if (plan.leftAlone > 0) {
        parts.push(`${plan.leftAlone} left alone`);
    }
    return parts;
}

function harnessFiles(n: number): string {
    return `${n} harness ${n === 1 ? "file" : "files"}`;
}

function writesNothing(plan: SyncPlan): boolean {
    return plan.harnessFiles + plan.skillCopies + plan.skillsRemoved === 0;
}

// Shown between the dry run and the write, so the counts are the dry run's and not a guess from the rows.
export function syncPlanText(plan: SyncPlan): string {
    if (writesNothing(plan)) {
        return ["Nothing to write", ...planParts(plan)].join(" · ");
    }
    const head = plan.harnessFiles > 0 ? [`Writing the doc into ${harnessFiles(plan.harnessFiles)}`] : [];
    return [...head, ...planParts(plan)].join(" · ");
}

// Shown once the write is done, from the same plan.
export function syncDoneText(plan: SyncPlan): string {
    if (writesNothing(plan)) {
        return ["Already in sync: nothing to write", ...planParts(plan)].join(" · ");
    }
    const head = plan.harnessFiles > 0 ? [`Synced ${harnessFiles(plan.harnessFiles)}`] : ["Synced"];
    return [...head, ...planParts(plan)].join(" · ");
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

// lines of `from` that `against` lacks, in order, as a multiset (the way changedLineCount counts)
function linesMissing(from: string, against: string): string[] {
    const pool = new Map<string, number>();
    for (const l of against.split("\n")) {
        pool.set(l, (pool.get(l) ?? 0) + 1);
    }
    const out: string[] = [];
    for (const l of from.split("\n")) {
        const left = pool.get(l) ?? 0;
        if (left > 0) {
            pool.set(l, left - 1);
        } else {
            out.push(l);
        }
    }
    return out;
}

// What an outside edit did to the doc against what the editor loaded, listed in the conflict notice.
// Blank lines are left out: an empty entry in the list tells the user nothing.
export function diskChanges(base: string, disk: string): { added: string[]; dropped: string[] } {
    const shown = (l: string) => l.trim() !== "";
    return {
        added: linesMissing(disk, base).filter(shown),
        dropped: linesMissing(base, disk).filter(shown),
    };
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
