// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0
//
// The New launcher's state (docs/superpowers/specs/2026-10-08-new-launcher-design.md, "Open, close and draft"). The
// dialog renders its body only while open, so what a close must keep lives here: the pick, the project and everything
// typed. In memory only, as New agent's state was: a draft outlives a close and a surface switch, not an app restart.

import { globalStore } from "@/app/store/jotaiStore";
import { prefillToLaunch, type NewRunPrefill } from "@/app/view/jarvis/newrun";
import { atom, type PrimitiveAtom } from "jotai";
import type { Runtime } from "./launch";
import { draftShown, type LauncherKind } from "./launcher";
import { planPathAtom, setRunShape, setStart } from "./runconfigstore";

export const launcherKindAtom = atom<LauncherKind>("agent") as PrimitiveAtom<LauncherKind>;
// the agent row; null until the first open defaults it from the harness preference
export const launcherRuntimeAtom = atom<Runtime | null>(null) as PrimitiveAtom<Runtime | null>;
// "" means the first project in recent-first order
export const launcherProjectAtom = atom("") as PrimitiveAtom<string>;
export const launcherTaskAtom = atom("") as PrimitiveAtom<string>;
export const launcherGoalAtom = atom("") as PrimitiveAtom<string>;
// a canvas's board, from Build this…; it only rides an orchestrator run
export const launcherPrototypeAtom = atom("") as PrimitiveAtom<string>;
// a hand-edited command per runtime; a runtime with no entry runs its default
export const launcherCommandAtom = atom<Partial<Record<Runtime, string>>>({}) as PrimitiveAtom<
    Partial<Record<Runtime, string>>
>;
export const launcherWorktreeAtom = atom(false) as PrimitiveAtom<boolean>;
// null follows the project's checked-out branch
export const launcherBranchAtom = atom<string | null>(null) as PrimitiveAtom<string | null>;
// The agent row's two popovers. They live here, not in the fields' state, so the dialog's one key handler can close
// the open one on Escape wherever focus is (the flag menu opens while focus sits in the Task box).
export const launcherFlagMenuAtom = atom(false) as PrimitiveAtom<boolean>;
export const launcherBranchListAtom = atom(false) as PrimitiveAtom<boolean>;
// this open showed a draft a close had kept
export const launcherRestoredAtom = atom(false) as PrimitiveAtom<boolean>;
export const launcherBusyAtom = atom(false) as PrimitiveAtom<boolean>;
// what the next open fills in, read by the dialog once the project list is in
export const launcherPrefillAtom = atom<NewRunPrefill | null>(null) as PrimitiveAtom<NewRunPrefill | null>;

export type LauncherModel = { launcherAtom: PrimitiveAtom<LauncherKind | null> };

function keptDraft() {
    return {
        task: globalStore.get(launcherTaskAtom),
        goal: globalStore.get(launcherGoalAtom),
        planPath: globalStore.get(planPathAtom),
        prototype: globalStore.get(launcherPrototypeAtom),
    };
}

// Every way in. A door picks its own half of the Start list; the agent row and the run shape inside it stay as the
// last open left them. A prefill always opens on the run half.
export function openLauncher(model: LauncherModel, door: LauncherKind, prefill?: NewRunPrefill): void {
    const kind: LauncherKind = prefill != null ? "run" : door;
    globalStore.set(launcherKindAtom, kind);
    globalStore.set(launcherRestoredAtom, prefill == null && draftShown(keptDraft()));
    globalStore.set(launcherPrefillAtom, prefill ?? null);
    globalStore.set(model.launcherAtom, door);
}

// The app bar's one New button: no door of its own, so it opens on whichever half the last open left picked.
export function reopenLauncher(model: LauncherModel): void {
    openLauncher(model, globalStore.get(launcherKindAtom));
}

// Every way out keeps the draft; that is what lets a click outside close the dialog. An open popover is not draft.
export function closeLauncher(model: LauncherModel): void {
    globalStore.set(launcherFlagMenuAtom, false);
    globalStore.set(launcherBranchListAtom, false);
    globalStore.set(model.launcherAtom, null);
}

// The header's Clear: what a close kept goes; the pick, the project and the commands stay. The plan path is set
// directly, not through setPlanPath, which would mark the run config as touched by hand.
export function clearLauncherDraft(): void {
    globalStore.set(launcherTaskAtom, "");
    globalStore.set(launcherGoalAtom, "");
    globalStore.set(planPathAtom, "");
    globalStore.set(launcherPrototypeAtom, "");
    globalStore.set(launcherWorktreeAtom, false);
    globalStore.set(launcherBranchAtom, null);
    globalStore.set(launcherRestoredAtom, false);
}

// A launch consumed the draft. Hand-edited commands go with it; the pick, the project and the flags stay.
export function endLauncherDraft(): void {
    clearLauncherDraft();
    globalStore.set(launcherCommandAtom, {});
}

// A different project re-defaults the worktree branch to that project's checked-out one: a branch typed for one repo
// means nothing in another. `current` is the project on show, which "" in the atom also names.
export function pickLauncherProject(name: string, current: string): void {
    if (name === current) {
        return;
    }
    globalStore.set(launcherProjectAtom, name);
    globalStore.set(launcherBranchAtom, null);
}

// A prefill waits for the project list: read too early, its project would not be found and would be dropped for good.
export function applyLauncherPrefill(projectNames: string[]): boolean {
    const prefill = globalStore.get(launcherPrefillAtom);
    if (prefill == null || projectNames.length === 0) {
        return false;
    }
    globalStore.set(launcherPrefillAtom, null);
    const p = prefillToLaunch(prefill, projectNames);
    if (p.picked != null) {
        pickLauncherProject(p.picked, globalStore.get(launcherProjectAtom));
    }
    setRunShape(p.shape);
    setStart(p.start);
    globalStore.set(launcherGoalAtom, p.goal);
    globalStore.set(launcherPrototypeAtom, p.prototype);
    return true;
}

// One launch at a time: a held Enter repeats the keydown, and each would start another agent.
export function beginLauncherLaunch(): boolean {
    if (globalStore.get(launcherBusyAtom)) {
        return false;
    }
    globalStore.set(launcherBusyAtom, true);
    return true;
}

export function endLauncherLaunch(): void {
    globalStore.set(launcherBusyAtom, false);
}
