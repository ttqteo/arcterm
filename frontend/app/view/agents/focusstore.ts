// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0
//
// Active-focus (Presence C) state. Module-scope atoms so focus survives the surface unmount on nav-switch
// (only the agent surface stays mounted). Lives under view/agents/ so the scoped surfaces (roster,
// channels) read it without importing the jarvis view (the one-directional import rule).

import { pushToast } from "@/app/cockpit/notificationstore";
import { globalStore } from "@/app/store/jotaiStore";
import { RpcApi } from "@/app/store/wshclientapi";
import { TabRpcClient } from "@/app/store/wshrpcutil";
import { fireAndForget } from "@/util/util";
import { atom, type PrimitiveAtom } from "jotai";
import { atomWithStorage } from "jotai/utils";
import type { SurfaceKey } from "./agents";
import { SURFACE_CONTEXT } from "./surfacecontext";

export type FocusKind = "task" | "agent" | "run";

export interface FocusRef {
    kind: FocusKind;
    id: string;
}

// label and project travel with the ref because every caller already holds both — a task from
// SpaceSummary.objective, an agent from projectOf(agent), a run from its Goal and ProjectPath.
// Resolving them server-side would be a second copy to keep in sync.
export interface ActiveFocus {
    ref: FocusRef;
    label: string;
    project: string; // "" when unresolvable; the project write is then skipped
}

// null = Global (Presence D). An ActiveFocus = the focused task, agent or run.
export const activeFocusAtom = atom<ActiveFocus | null>(null) as PrimitiveAtom<ActiveFocus | null>;
// Persisted so a reopened cockpit is where you left it. getOnInit for the same reason
// lastCodeProjectAtom uses it: without it the stored value arrives one render after the first read
// and the app bar flashes "Global" before the restore lands.
export const persistedFocusAtom = atomWithStorage<ActiveFocus | null>("cockpit.focus.last", null, undefined, {
    getOnInit: true,
}) as PrimitiveAtom<ActiveFocus | null>;
// the resolved scope bundle for the active focus; null when Global or while a resolve is in flight.
export const focusScopeAtom = atom<SpaceScope | null>(null) as PrimitiveAtom<SpaceScope | null>;
// which scoped surfaces the user clicked "Show all" on; reset on every switch.
// a surface, or the Agent surface's Conversation History pane, which is scoped on its own
export type RevealKey = SurfaceKey | "history";
export const focusRevealAtom = atom<Set<RevealKey>>(new Set<RevealKey>());
// true while the focus on screen is the one restored at launch, so the banner can say why a filter
// is on that the user did not set this session. Any explicit enter or exit clears it.
export const focusRestoredAtom = atom<boolean>(false) as PrimitiveAtom<boolean>;
// the switcher/palette task list (active+paused), newest-updated first.
export const focusesAtom = atom<SpaceSummary[]>([]);

export function loadFocuses(): void {
    fireAndForget(async () => {
        const rtn = await RpcApi.ListDossiersCommand(TabRpcClient);
        globalStore.set(focusesAtom, rtn?.spaces ?? []);
    });
}

function sameRef(a: FocusRef | undefined, b: FocusRef | undefined): boolean {
    return a != null && b != null && a.kind === b.kind && a.id === b.id;
}

// enterFocus flips the indicator immediately, clears prior reveals, then resolves the bundle. A
// resolve that lands after the user moved on is discarded — the whole ref is compared, not just the
// id, because two kinds can carry the same id string.
export function enterFocus(focus: ActiveFocus): void {
    globalStore.set(activeFocusAtom, focus);
    globalStore.set(focusRestoredAtom, false);
    globalStore.set(focusRevealAtom, new Set<RevealKey>());
    globalStore.set(focusScopeAtom, null);
    fireAndForget(async () => {
        const scope = await RpcApi.ResolveFocusScopeCommand(TabRpcClient, focus.ref);
        if (!sameRef(globalStore.get(activeFocusAtom)?.ref, focus.ref)) {
            return;
        }
        globalStore.set(focusScopeAtom, scope ?? null);
    });
    globalStore.set(persistedFocusAtom, focus);
}

export function exitFocus(): void {
    globalStore.set(activeFocusAtom, null);
    globalStore.set(focusRestoredAtom, false);
    globalStore.set(focusScopeAtom, null);
    globalStore.set(focusRevealAtom, new Set<RevealKey>());
    globalStore.set(persistedFocusAtom, null);
}

// degradeFocus drops to project-only when the focused entity no longer exists. It reports once, the
// same posture openTarget takes: a focus that silently stops applying is worse than one that says
// why it went away. The project set by enterFocusFor deliberately stays.
export function degradeFocus(reason: string): void {
    if (globalStore.get(activeFocusAtom) == null) {
        return;
    }
    exitFocus();
    pushToast({ title: reason, message: "", level: "warn" });
}

// Focus implies project: without this the user can hold a contradictory pair (project A, focus on an
// entity in B) and every filter surface correctly renders empty, which reads as a bug. Exiting focus
// deliberately leaves the project alone — this task, to this project, to everything.
export function enterFocusFor(model: { projectFilterAtom: PrimitiveAtom<string> }, focus: ActiveFocus): void {
    if (focus.project !== "") {
        globalStore.set(model.projectFilterAtom, focus.project);
    }
    enterFocus(focus);
}

// The bundle is a snapshot: a focused agent spawns workers, a new run gets attributed to a focused
// task, a focused entity exits. Re-resolving on arrival at a surface that actually consumes the
// bundle is bounded and lands exactly when it matters. A poller would burn the same RPC while nobody
// is looking at a filtered list.
export function reresolveFocus(surface: SurfaceKey): void {
    const focus = globalStore.get(activeFocusAtom);
    if (focus == null || SURFACE_CONTEXT[surface].space === "unsupported") {
        return;
    }
    fireAndForget(async () => {
        let scope: SpaceScope | null;
        try {
            scope = await RpcApi.ResolveFocusScopeCommand(TabRpcClient, focus.ref);
        } catch {
            // the resolver errors when the target is gone (a deleted run, an unknown kind). Only
            // degrade if this is still the focus the user is on — a rejection for a focus they
            // already left must not clear the one they moved to.
            if (sameRef(globalStore.get(activeFocusAtom)?.ref, focus.ref)) {
                degradeFocus(`That ${focus.ref.kind} is no longer available`);
            }
            return;
        }
        if (!sameRef(globalStore.get(activeFocusAtom)?.ref, focus.ref)) {
            return;
        }
        globalStore.set(focusScopeAtom, scope ?? null);
    });
}

export function revealSurface(key: RevealKey): void {
    const next = new Set(globalStore.get(focusRevealAtom));
    next.add(key);
    globalStore.set(focusRevealAtom, next);
}

export function concealSurface(key: RevealKey): void {
    const next = new Set(globalStore.get(focusRevealAtom));
    next.delete(key);
    globalStore.set(focusRevealAtom, next);
}
