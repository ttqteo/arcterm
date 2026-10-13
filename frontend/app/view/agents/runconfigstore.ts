// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0
//
// The run configuration being composed: shape, which machine fans out, how wide, and the two routes.
// Module-level rather than component state because the controls are in the launcher (the Stage's thread
// slot) while the goal and the Run ⏎ that consume them are in the composer below it — two components, one
// answer. It is also what keeps the choice across a surface switch, which unmounts everything but Agent.

import { globalStore } from "@/app/store/jotaiStore";
import { atom, type PrimitiveAtom } from "jotai";
import {
    DEFAULT_PARALLELISM,
    DEFAULT_START,
    clampParallelism,
    profileRunDefaults,
    type PlanPreview,
    type RunShape,
    type StartFrom,
} from "./runconfig";

// What the launcher shows for a control the channel's profile does not speak for. Hydration restores a
// field the profile has stopped stating to this baseline rather than leaving the value it used to state
// standing; resetRunConfig returns there too, so the two cannot drift.
const LAUNCH_SHAPE: RunShape = "quick";

export const runShapeAtom = atom<RunShape>(LAUNCH_SHAPE) as PrimitiveAtom<RunShape>;
export const runRouteAtom = atom<RoutePin | null>(null) as PrimitiveAtom<RoutePin | null>;
export const workerRouteAtom = atom<RoutePin | null>(null) as PrimitiveAtom<RoutePin | null>;
// the Workers picker's third answer beside Same as lead and a route; never true alongside a worker route
export const reviewerPicksAtom = atom(false) as PrimitiveAtom<boolean>;
export const reviewerRouteAtom = atom<RoutePin | null>(null) as PrimitiveAtom<RoutePin | null>;
// the Approvals field: Autonomous when true, Ask me when false
export const autonomousAtom = atom(false) as PrimitiveAtom<boolean>;
export const parallelismAtom = atom<number>(DEFAULT_PARALLELISM) as PrimitiveAtom<number>;
// Not profile-backed: a plan file belongs to one launch, never to a project's defaults, and a saved default
// that silently started lead-free runs is not a default anyone asked for.
export const startAtom = atom<StartFrom>(DEFAULT_START) as PrimitiveAtom<StartFrom>;
export const planPathAtom = atom<string>("") as PrimitiveAtom<string>;
// The launcher's last reading of planPathAtom; launchBlocker holds a plan start until it matches the path.
export const planPreviewAtom = atom<PlanPreview | null>(null) as PrimitiveAtom<PlanPreview | null>;

// Whether the user has picked a route by hand on this channel. Until they have, the channel's preferred
// route keeps flowing in; after, it must not be overwritten under them. Was a component ref, and has to
// survive the same unmounts the atoms above do.
export const routeTouchedAtom = atom(false) as PrimitiveAtom<boolean>;

// Whether the user has changed any of the launcher's controls by hand on this channel. The channel's saved
// profile hydrates the launcher on arrival; once the user has stated a choice, the profile must not replace
// it under them. One flag for the whole configuration rather than one per control, because hydrating half a
// setup is the failure mode being guarded against.
export const configTouchedAtom = atom(false) as PrimitiveAtom<boolean>;

export function setParallelism(next: number): void {
    globalStore.set(configTouchedAtom, true);
    globalStore.set(parallelismAtom, clampParallelism(next));
}

export function setRunShape(next: RunShape): void {
    globalStore.set(configTouchedAtom, true);
    globalStore.set(runShapeAtom, next);
}

export function setStart(next: StartFrom): void {
    globalStore.set(configTouchedAtom, true);
    globalStore.set(startAtom, next);
}

export function setPlanPath(next: string): void {
    globalStore.set(configTouchedAtom, true);
    globalStore.set(planPathAtom, next);
}

// The server refuses Reviewer picks with a worker route, so choosing one of the Workers picker's answers
// clears the other in the same action.
export function setWorkerRoute(next: RoutePin | null): void {
    globalStore.set(configTouchedAtom, true);
    globalStore.set(workerRouteAtom, next);
    globalStore.set(reviewerPicksAtom, false);
}

export function setReviewerPicks(next: boolean): void {
    globalStore.set(configTouchedAtom, true);
    globalStore.set(reviewerPicksAtom, next);
    if (next) {
        globalStore.set(workerRouteAtom, null);
    }
}

export function setReviewerRoute(next: RoutePin | null): void {
    globalStore.set(configTouchedAtom, true);
    globalStore.set(reviewerRouteAtom, next);
}

export function setAutonomous(next: boolean): void {
    globalStore.set(configTouchedAtom, true);
    globalStore.set(autonomousAtom, next);
}

// Fills the launcher from a channel's resolved profile, applying only what the profile actually states and
// only while the user has not touched the configuration here. Called whenever the resolved profile arrives
// (mount, a save, a switch back to this channel), which is what makes a saved default drive the next launch
// rather than only the next fresh surface.
//
// Untouched controls return to their launch baselines first: a field the profile used to state and no
// longer states has to revert, or the launcher would keep offering a setup the saved profile abandoned.
export function hydrateRunConfigFromProfile(profile: JarvisProfile | null | undefined): void {
    if (globalStore.get(configTouchedAtom)) {
        return;
    }
    const defaults = profileRunDefaults(profile);
    globalStore.set(runShapeAtom, defaults.shape ?? LAUNCH_SHAPE);
    globalStore.set(parallelismAtom, defaults.parallelism ?? DEFAULT_PARALLELISM);
    globalStore.set(startAtom, DEFAULT_START);
    globalStore.set(planPathAtom, "");
    globalStore.set(workerRouteAtom, defaults.workerRoute ?? null);
    globalStore.set(reviewerPicksAtom, defaults.reviewerPicks);
    globalStore.set(reviewerRouteAtom, defaults.reviewerRoute);
    globalStore.set(autonomousAtom, defaults.autonomous);
}

// A launch or a discarded draft ends the configuration the user's manual choices belonged to. Manual choices
// are draft-scoped, so the touched flag clears and the next draft starts from the channel's saved profile
// again. Without this the flag stayed set for the channel's lifetime and every later profile save was
// silently ignored.
//
// The lead route is not part of this: it is the channel's preference, carried by routeTouchedAtom, and a
// launch never consumed the user's choice of it.
export function endRunConfigDraft(profile: JarvisProfile | null | undefined): void {
    globalStore.set(configTouchedAtom, false);
    hydrateRunConfigFromProfile(profile);
}

// The stepper's two buttons. A delta rather than a computed value on purpose: clicks batch, so
// `set(atom, clamp(par + 1))` from a render closure re-reads the same stale `par` for every click in
// the batch and a fast double-click advances one step. Measured over CDP — twelve clicks moved 4 -> 5.
export function stepParallelism(delta: number): void {
    globalStore.set(configTouchedAtom, true);
    globalStore.set(parallelismAtom, (prev) => clampParallelism(prev + delta));
}

// Picking a lead route by hand is what stops the channel's preferred route flowing in over it, so the
// two writes are one action — a caller that set the atom alone would have its choice replaced on the
// next preference tick.
export function setRunRoute(next: RoutePin | null): void {
    globalStore.set(configTouchedAtom, true);
    globalStore.set(routeTouchedAtom, true);
    globalStore.set(runRouteAtom, next);
}

// A launch blocked for want of a usable route. The composer pairs this with revealing the launcher (the
// picker only exists while the launcher is on the Stage), and RoutePicker's open effect runs on mount, so
// a bump that lands before the picker exists still opens it.
export const routeOpenRequestAtom = atom(0) as PrimitiveAtom<number>;

export function requestRouteOpen(): void {
    globalStore.set(routeOpenRequestAtom, (n) => n + 1);
}

// Every control is per-channel: carrying an orchestrator-with-6-workers setup onto the next channel
// would silently arm a dispatch the user configured somewhere else.
export function resetRunConfig(): void {
    globalStore.set(runShapeAtom, LAUNCH_SHAPE);
    globalStore.set(runRouteAtom, null);
    globalStore.set(workerRouteAtom, null);
    globalStore.set(reviewerPicksAtom, false);
    globalStore.set(reviewerRouteAtom, null);
    globalStore.set(autonomousAtom, false);
    globalStore.set(parallelismAtom, DEFAULT_PARALLELISM);
    globalStore.set(startAtom, DEFAULT_START);
    globalStore.set(planPathAtom, "");
    globalStore.set(planPreviewAtom, null);
    globalStore.set(routeTouchedAtom, false);
    // a fresh channel has no user choices yet, which is what lets its profile hydrate in
    globalStore.set(configTouchedAtom, false);
}

// The channel the current configuration was built for. Module-level, so a remount does not read as a
// channel change: every surface but Agent unmounts when you switch away, and a mount-keyed reset would
// throw away a configured-but-unlaunched run for the cost of a glance at Usage.
let configuredChannel: string | null | undefined;

//
// `keepTouched` separates the two things a channel can be. On the sheet it is the subject you navigated to,
// so arriving at another one is a change of subject and the reset above is right. In + Run it is a FIELD of
// the form you are filling in, and changing a field must not rewrite the ones you already filled: picking
// the project discarded a shape you had chosen by hand, and the project's saved defaultmode hydrated over
// it — a Quick you selected launched an orchestrator with a lead. An UNtouched draft still follows the
// project you pick, which is what makes a saved default the starting point.
export function resetRunConfigForChannel(channelId: string | null, keepTouched = false): void {
    if (configuredChannel === channelId) {
        return;
    }
    configuredChannel = channelId;
    if (keepTouched && globalStore.get(configTouchedAtom)) {
        return;
    }
    resetRunConfig();
}

// test seam: resetRunConfig alone cannot clear the remembered channel, and a test that set one would
// otherwise leak it into the next test's first resetRunConfigForChannel call
export function forgetConfiguredChannel(): void {
    configuredChannel = undefined;
}
