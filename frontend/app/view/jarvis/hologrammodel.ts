// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0
//
// The hologram form of Jarvis (Settings → Jarvis → Form): what it shows and how fast it draws. Pure; the pixels are
// hologramscene.ts's and the corner it sits in is hologramview.tsx's.
//
// Two forms of one presence: the HUD (hologramhud.ts, the kaeltran16 fork's avatar), and the neural sphere of the
// 2026-09-11 avatar study (jarvis-avatar-comparison) while an agent asks you something. Gates, escalations and runs to
// land stay on the HUD: they wait in Jarvis's queue and badge, not on the hologram. While agents work the HUD breathes
// faster and pulses run in along its struts; when Jarvis speaks it turns square-on and sweeps.

import { activityLevel } from "./hologramhud";

export type PetForm = "sprout" | "hologram";

export const DEFAULT_PET_FORM: PetForm = "hologram";

export const PET_FORM_NAME: Record<PetForm, string> = {
    sprout: "Sprout",
    hologram: "Hologram",
};

/** A stored choice, or the hologram (the default) for anything that is not one of the two (a hand-edited value). */
export function petForm(value: unknown): PetForm {
    return value === "sprout" || value === "hologram" ? value : DEFAULT_PET_FORM;
}

// How big the hologram draws (Settings → Jarvis & Office → Hologram size). L is the study's corner size.
export type HologramSize = "s" | "m" | "l";

export const DEFAULT_HOLOGRAM_SIZE: HologramSize = "l";

export const HOLOGRAM_SIZE_PX: Record<HologramSize, number> = { s: 80, m: 104, l: 132 };

export const HOLOGRAM_SIZE_NAME: Record<HologramSize, string> = { s: "S", m: "M", l: "L" };

/** A stored choice, or L for anything that is not one of the three. */
export function hologramSize(value: unknown): HologramSize {
    return value === "s" || value === "m" || value === "l" ? value : DEFAULT_HOLOGRAM_SIZE;
}

export interface HologramInputs {
    // agents asking you something (hologramview's useAskingCount)
    asking: number;
    // agents working (useWorkingCount)
    working: number;
    // a bubble is up
    speaking: boolean;
    peekOpen: boolean;
}

export interface HologramPose {
    // 0 is the HUD, 1 the neural sphere: the target the crossfade eases toward
    sphere: 0 | 1;
    // agents work or Jarvis speaks: the form moves, so it draws at the live rate
    busy: boolean;
    // 0..1 load from the working count (hologramhud activityLevel)
    activity: number;
    // a bubble is up
    speaking: boolean;
    // faint: it sits over the corner of whatever is on screen, so it stays faint while agents work or ask (the form
    // and its motion say that) and is solid only under the pointer (hologramview) or while its peek is open
    quiet: boolean;
}

export function hologramPose(i: HologramInputs): HologramPose {
    const asking = i.asking > 0;
    const busy = i.working > 0 || i.speaking;
    return {
        sphere: asking ? 1 : 0,
        busy,
        activity: activityLevel(i.working),
        speaking: i.speaking,
        quiet: !i.peekOpen,
    };
}

// The morph between the two forms, in ms: long enough to watch the HUD fold into the sphere, under a second and a half
export const HOLOGRAM_FADE_MS = 1100;

export interface MorphPose {
    // the HUD's group: drawn down toward its core as the sphere comes
    hudScale: number;
    // the HUD's extra turn about its axis, winding in as it goes (radians)
    hudTwist: number;
    // the sphere's group: grown out of the core, a touch past full size midway through before it settles
    sphereScale: number;
    // the bloom's strength against its resting value: a flare at the crossing, 1 at either end
    flare: number;
}

/** How the two forms stand at an eased mix (easeMix): 0 is the HUD at rest, 1 the sphere at rest. */
export function morphPose(mix: number): MorphPose {
    const m = Math.min(1, Math.max(0, mix));
    const crossing = Math.sin(Math.PI * m);
    return {
        hudScale: 1 - 0.62 * m,
        hudTwist: 1.6 * m,
        sphereScale: 0.38 + 0.62 * m + 0.1 * crossing,
        flare: 1 + 2.4 * crossing * crossing,
    };
}

/** One step of the crossfade from `mix` toward `target`, linear, never past it. */
export function stepMix(mix: number, target: number, dtMs: number, fadeMs = HOLOGRAM_FADE_MS): number {
    const step = fadeMs <= 0 ? 1 : Math.max(0, dtMs) / fadeMs;
    if (mix < target) {
        return Math.min(target, mix + step);
    }
    return Math.max(target, mix - step);
}

/** The ease applied to the linear mix before it weighs the two forms. */
export function easeMix(mix: number): number {
    const m = Math.min(1, Math.max(0, mix));
    return m * m * (3 - 2 * m);
}

// The startup loader (startuploader.tsx) builds the HUD before it turns: the core lights first, then the front ring,
// the blades, the struts and the outer ring (hologramhud HUD_PARTS), each fading and growing into place. Seconds on the scene's clock, which starts at its first frame.
export const ASSEMBLE_START_S = 0.1;
export const ASSEMBLE_STAGGER_S = 0.2;
export const ASSEMBLE_PART_S = 0.5;
// the HUD's layers (hologramhud HUD_PARTS)
export const ASSEMBLE_PARTS = 5;
export const ASSEMBLE_DONE_S = ASSEMBLE_START_S + (ASSEMBLE_PARTS - 1) * ASSEMBLE_STAGGER_S + ASSEMBLE_PART_S;

/** How far part `part` (0 the core, 1 to 4 the layers from the inside out) is into its entrance `t` seconds in: 0 not
 * shown yet, 1 in place, eased out so it settles rather than stops. */
export function assembleReveal(t: number, part: number): number {
    const p = (t - ASSEMBLE_START_S - part * ASSEMBLE_STAGGER_S) / ASSEMBLE_PART_S;
    if (!(p > 0)) {
        return 0;
    }
    return p >= 1 ? 1 : 1 - (1 - p) ** 3;
}

// Frames a second: a calm HUD (a slow sway and breath) needs few; the sphere's pulses, a HUD at work and a crossfade
// need more
export const HOLOGRAM_IDLE_FPS = 15;
export const HOLOGRAM_LIVE_FPS = 30;

export function hologramFps(pose: HologramPose, mix: number): number {
    const fading = mix !== pose.sphere;
    return fading || pose.busy || pose.sphere === 1 ? HOLOGRAM_LIVE_FPS : HOLOGRAM_IDLE_FPS;
}

// A lost WebGL context (a GPU reset, or Chromium dropping the oldest of too many contexts: every terminal's xterm holds
// one too) takes the hologram away. Sprout stands in, and the hologram comes back on a fresh canvas after
// HOLOGRAM_RETRY_MS, as a terminal's WebGL comes back. HOLOGRAM_MAX_FAILS failures inside HOLOGRAM_FAIL_WINDOW_MS stop
// the retries, so a GPU that keeps failing (or no WebGL at all) cannot loop: Sprout stays until the form is picked again.
export const HOLOGRAM_RETRY_MS = 5_000;
export const HOLOGRAM_MAX_FAILS = 3;
export const HOLOGRAM_FAIL_WINDOW_MS = 120_000;

/** Pure: after a failure at `now`, the failures still inside the window and whether to try the hologram again. */
export function hologramRetry(fails: readonly number[], now: number): { fails: number[]; retry: boolean } {
    const kept = [...fails.filter((t) => now - t < HOLOGRAM_FAIL_WINDOW_MS), now];
    return { fails: kept, retry: kept.length < HOLOGRAM_MAX_FAILS };
}
