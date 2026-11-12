// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0
//
// The hologram form of Jarvis (Settings → Jarvis → Form): what it shows and how fast it draws. Pure; the pixels are
// hologramscene.ts's and the corner it sits in is hologramview.tsx's.
//
// Two forms of one presence, from the 2026-09-11 avatar study (jarvis-avatar-comparison): the orbital HUD while nothing
// waits on you, and the neural sphere while something does (a question, a gate, an escalation). The HUD's core beats
// while agents work or Jarvis is speaking.

export type PetForm = "sprout" | "hologram";

export const DEFAULT_PET_FORM: PetForm = "sprout";

export const PET_FORM_NAME: Record<PetForm, string> = {
    sprout: "Sprout",
    hologram: "Hologram",
};

/** A stored choice, or Sprout for anything that is not one of the two (a hand-edited value). */
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
    // things waiting on you: the peek's queue (useWaitingCount)
    waiting: number;
    // agents working (useWorkingCount)
    working: number;
    // a bubble is up
    speaking: boolean;
    peekOpen: boolean;
}

export interface HologramPose {
    // 0 is the HUD, 1 the neural sphere: the target the crossfade eases toward
    sphere: 0 | 1;
    // the HUD's core beats
    busy: boolean;
    // faint: nothing to express, as Sprout is faint at rest
    quiet: boolean;
}

export function hologramPose(i: HologramInputs): HologramPose {
    const asking = i.waiting > 0;
    const busy = i.working > 0 || i.speaking;
    return {
        sphere: asking ? 1 : 0,
        busy,
        quiet: !asking && !busy && !i.peekOpen,
    };
}

// The crossfade between the two forms, in ms
export const HOLOGRAM_FADE_MS = 700;

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

// The startup loader (startuploader.tsx) builds the HUD before it turns: the core lights first, then the four rings
// from the inside out, each fading and growing into place. Seconds on the scene's clock, which starts at its first frame.
export const ASSEMBLE_START_S = 0.1;
export const ASSEMBLE_STAGGER_S = 0.2;
export const ASSEMBLE_PART_S = 0.5;
// the core and the four rings
export const ASSEMBLE_PARTS = 5;
export const ASSEMBLE_DONE_S = ASSEMBLE_START_S + (ASSEMBLE_PARTS - 1) * ASSEMBLE_STAGGER_S + ASSEMBLE_PART_S;

/** How far part `part` (0 the core, 1 to 4 the rings from the inside out) is into its entrance `t` seconds in: 0 not
 * shown yet, 1 in place, eased out so it settles rather than stops. */
export function assembleReveal(t: number, part: number): number {
    const p = (t - ASSEMBLE_START_S - part * ASSEMBLE_STAGGER_S) / ASSEMBLE_PART_S;
    if (!(p > 0)) {
        return 0;
    }
    return p >= 1 ? 1 : 1 - (1 - p) ** 3;
}

// Frames a second: a calm HUD needs few; the sphere's pulses, a beating core and a crossfade need more
export const HOLOGRAM_IDLE_FPS = 15;
export const HOLOGRAM_LIVE_FPS = 30;

export function hologramFps(pose: HologramPose, mix: number): number {
    const fading = mix !== pose.sphere;
    return fading || pose.busy || pose.sphere === 1 ? HOLOGRAM_LIVE_FPS : HOLOGRAM_IDLE_FPS;
}
