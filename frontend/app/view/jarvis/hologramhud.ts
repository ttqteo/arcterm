// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0
//
// The hologram's HUD, as data: a flat list of screen-space strokes and fills for one frame. Pure, so the form is
// tested here rather than by screenshot; hologramscene.ts packs it onto the GPU.
//
// The form is the kaeltran16 fork's avatar (its avatarscene.ts, from the jarvis-hud-* design studies): three arc planes
// stacked in depth, held together by six struts, around a recessed core whose centre is an empty hexagon. It replaced
// our first HUD (four rings around a lit sphere), whose core, a point sprite and a wireframe ball in a few pixels, blew
// out into a white blob under the bloom. Every primitive here resolves on its own at 132 px.
//
// Taken from the fork as it stood on 2026-11-13: the geometry, its stroke ladder, the idle sway, the breath, the inbound
// pulses along the struts while agents work, and the turn square-on with a sweep while Jarvis speaks. Left out: the
// fork's moods (tone and plane splay per condition), the bearing marker, the ripple and the jolt. Our hologram says
// "something waits on you" by turning into the neural sphere, so the HUD only has to be at rest or at work.

const TAU = Math.PI * 2;

/** Which of the two resolved colours a primitive wants: the body, or the body lightened (hudColours). */
export type HudTone = "body" | "hot";

export interface HudSegment {
    ax: number;
    ay: number;
    bx: number;
    by: number;
    /** -1 (far) .. 1 (near), before projection */
    depth: number;
    tone: HudTone;
    alpha: number;
    /** stroke weight in CSS px at STUDY_PX, one of STROKE_WIDTHS (the renderer draws one batch per weight) */
    width: number;
}

/** A filled convex quad in screen space, drawn as a triangle fan from its first vertex. */
export interface HudFill {
    points: [number, number][];
    depth: number;
    tone: HudTone;
    alpha: number;
}

export interface HudScene {
    segments: HudSegment[];
    fills: HudFill[];
    centreX: number;
    centreY: number;
    /** the largest primitive distance from the centre, px */
    extent: number;
    /** how many inbound pulses this frame drew; 0 with no activity or when still */
    pulses: number;
}

// The named layers, from the inside out: the order the startup loader builds them in (hologrammodel assembleReveal)
export const HUD_PARTS = ["core", "front", "mid", "struts", "outer"] as const;
export type HudPart = (typeof HUD_PARTS)[number];

export interface HudInput {
    /** square viewport, px */
    size: number;
    /** ms on the scene's clock; only read when `still` is false */
    now: number;
    /** orbit phase in radians (hudOrbit), read through its sine as a bounded sway */
    yaw: number;
    /** radians, already bounded by hudOrbit */
    pitch: number;
    /** 0..1 (breathFromPhase) */
    breath: number;
    /** 0..1 (utteranceEnvelope): square-on, the centre lit and the sweep running while Jarvis speaks */
    utterance: number;
    /** nothing to express: dimmer, never smaller */
    quiet: boolean;
    /** reduced motion: no sway, breath, pulses or sweep */
    still: boolean;
    /** 0..1 load (activityLevel): deepens the breath and runs the inbound pulses */
    activity?: number;
    /** accumulated pulse cycles, advanced at pulseRate so a change of load never jumps a pulse */
    pulseClock?: number;
    /** each layer's entrance, 0 not shown yet .. 1 in place (the startup loader); a missing layer is in place */
    reveal?: Partial<Record<HudPart, number>>;
}

/**
 * The four stroke weights the form is drawn with, CSS px at STUDY_PX. A ladder rather than a number per primitive,
 * because a fat line's width is a material uniform: each weight is one draw call.
 */
export const STROKE = { fine: 0.85, base: 1.2, heavy: 1.9, bold: 2.8 } as const;
export const STROKE_WIDTHS: readonly number[] = [STROKE.fine, STROKE.base, STROKE.heavy, STROKE.bold];

// the size the form and its strokes were tuned at
export const STUDY_PX = 132;

type Vec3 = [number, number, number];

/** One layer's rigid transform: a scale, Euler XYZ, then a shift along z. */
interface Placement {
    rx: number;
    ry: number;
    rz: number;
    z: number;
    s: number;
}

const STRUT_COUNT = 6;

// Inbound pulses, one per strut. The seeds are irregular so the packets never read as a chase around the ring, and the
// cycle is longer than the run down the strut, so each is dark part of the time and the number lit keeps changing:
// load reads as traffic, never as a count. Never all dark while agents work: a gap would read as a stall.
const PULSE_SEEDS = [0, 0.53, 0.21, 0.77, 0.38, 0.91];
const PULSE_SPREAD = 3.1;
const PULSE_CYCLE = 1.6;
// packet length, as a fraction of the run from the strut's outer end to the core brackets
const PULSE_LENGTH = 0.16;
const PULSE_CORE_RADIUS = 0.42;
const PULSE_ALPHA = 0.95;

// the breath's depth in glow, at rest and what full load adds: a faster breath that stayed as shallow reads as flicker
const BREATH_DEPTH = 0.16;
const BREATH_DEPTH_LOAD = 0.1;

// how much quiet dims; it never shrinks the form
export const QUIET_DIM = 0.75;

// One form unit as a fraction of the viewport, leaving the bloom room to fall off inside the canvas: a form that
// reaches the edge turns its glow into a visible square where the blur clamps.
const SPHERE_FRACTION = 0.19;

// bounded sway, radians, around the fixed three-quarter attitude
const ORBIT_SWAY = 0.16;

// polyline and quad-strip density: segments per radian per unit radius
const ARC_DETAIL = 18;
const BAND_DETAIL = 10;
const ARC_MAX = 96;
const BAND_MAX = 64;

// ticks on the outer plane: 48 fuse into a band at this size, 24 stay countable
const TICK_COUNT = 24;

// the startup loader grows each layer in from this fraction of its size
const ASSEMBLE_FROM = 0.7;

const clamp01 = (v: number) => (Number.isFinite(v) ? Math.max(0, Math.min(1, v)) : 0);

function rotX(p: Vec3, a: number): Vec3 {
    const c = Math.cos(a);
    const s = Math.sin(a);
    return [p[0], p[1] * c - p[2] * s, p[1] * s + p[2] * c];
}

function rotY(p: Vec3, a: number): Vec3 {
    const c = Math.cos(a);
    const s = Math.sin(a);
    return [p[0] * c + p[2] * s, p[1], -p[0] * s + p[2] * c];
}

function rotZ(p: Vec3, a: number): Vec3 {
    const c = Math.cos(a);
    const s = Math.sin(a);
    return [p[0] * c - p[1] * s, p[0] * s + p[1] * c, p[2]];
}

export function buildHudScene(input: HudInput): HudScene {
    const still = input.still;
    const now = still ? 0 : input.now;
    const t = now / 1_000;
    const breath = still ? 0 : clamp01(input.breath);
    const utterance = still ? 0 : clamp01(input.utterance);
    const activity = still ? 0 : clamp01(input.activity ?? 0);
    const shown = (part: HudPart) => clamp01(input.reveal?.[part] ?? 1);
    const grown = (part: HudPart) => ASSEMBLE_FROM + (1 - ASSEMBLE_FROM) * shown(part);

    // three-quarters on at rest, square-on while speaking
    const face = utterance;
    const calm = 1 - face;
    const wave = breath * 2 - 1;

    const quietDim = input.quiet ? QUIET_DIM : 1;
    const breathDepth = BREATH_DEPTH + BREATH_DEPTH_LOAD * activity;
    const glow = (1 - breathDepth * calm * (0.5 - 0.5 * wave)) * quietDim;

    // what brightens a layer: the voice lights the centre
    const lift: Record<HudPart, number> = { outer: 1, mid: 1, front: 1, struts: 1, core: 1 };
    if (utterance > 0) {
        lift.core *= 1 + utterance * 0.7;
        lift.front *= 1 + utterance * 0.4;
    }

    const centreX = input.size / 2;
    const centreY = input.size / 2;
    const radius = input.size * SPHERE_FRACTION * (1 + 0.03 * calm * wave);

    const rootRx = 0.2 - face * 0.17 + (still ? 0 : input.pitch);
    const rootRy = -0.28 + face * 0.24 + (still ? 0 : Math.sin(input.yaw) * ORBIT_SWAY);
    const rootRz = -0.06 + face * 0.06;

    // a twist while speaking, which returns as the utterance decays: the form working, not drifting
    const work = face * 0.6;

    const planeBack: Placement = { rx: 0, ry: 0, rz: -work * 0.4, z: -0.38, s: grown("outer") };
    const planeMid: Placement = { rx: 0, ry: 0, rz: work * 0.9, z: 0, s: grown("mid") };
    const planeFront: Placement = { rx: 0, ry: 0, rz: -work * 0.6, z: 0.32 + face * 0.14, s: grown("front") };
    // the struts and the core hang off the root, not off a plane
    const strutsAt: Placement = { rx: 0, ry: 0, rz: 0, z: 0, s: grown("struts") };
    const coreAt: Placement = { rx: 0, ry: 0, rz: 0, z: -0.25, s: grown("core") };

    const segments: HudSegment[] = [];
    const fills: HudFill[] = [];
    let extent = 0;

    // perspective as a divide, so the renderer takes screen-space primitives and never projects a second time
    const project = (p: Vec3, at: Placement): [number, number, number] => {
        const placed = rotX(rotY(rotZ([p[0] * at.s, p[1] * at.s, p[2] * at.s], at.rz), at.ry), at.rx);
        const world = rotX(rotY(rotZ([placed[0], placed[1], placed[2] + at.z], rootRz), rootRy), rootRx);
        const k = 1 / (1 - world[2] * 0.17);
        const x = centreX + world[0] * radius * k;
        const y = centreY - world[1] * radius * k;
        extent = Math.max(extent, Math.hypot(x - centreX, y - centreY));
        return [x, y, world[2]];
    };

    // line work is authored at a base opacity and lit by the glow, then by its layer's lift and entrance
    const bodyAlpha = (base: number, part: HudPart): number =>
        Math.min(1, clamp01(base * glow) * lift[part]) * shown(part);

    const line = (a: Vec3, b: Vec3, at: Placement, tone: HudTone, width: number, alpha: number) => {
        const pa = project(a, at);
        const pb = project(b, at);
        segments.push({ ax: pa[0], ay: pa[1], bx: pb[0], by: pb[1], depth: (pa[2] + pb[2]) / 2, tone, alpha, width });
    };

    const arc = (
        at: Placement,
        r: number,
        start: number,
        length: number,
        tone: HudTone,
        width: number,
        alpha: number
    ) => {
        const steps = Math.max(4, Math.min(ARC_MAX, Math.ceil(Math.abs(length) * r * ARC_DETAIL)));
        let prev = project([Math.cos(start) * r, Math.sin(start) * r, 0], at);
        for (let i = 1; i <= steps; i++) {
            const a = start + (length * i) / steps;
            const next = project([Math.cos(a) * r, Math.sin(a) * r, 0], at);
            segments.push({
                ax: prev[0],
                ay: prev[1],
                bx: next[0],
                by: next[1],
                depth: (prev[2] + next[2]) / 2,
                tone,
                alpha,
                width,
            });
            prev = next;
        }
    };

    // a ring sector as a strip of convex quads: one annular sector is not convex, and a fan would cut across its hole
    const band = (
        at: Placement,
        inner: number,
        outer: number,
        start: number,
        length: number,
        tone: HudTone,
        alpha: number
    ) => {
        const steps = Math.max(2, Math.min(BAND_MAX, Math.ceil(Math.abs(length) * outer * BAND_DETAIL)));
        let ia = project([Math.cos(start) * inner, Math.sin(start) * inner, 0], at);
        let oa = project([Math.cos(start) * outer, Math.sin(start) * outer, 0], at);
        for (let i = 1; i <= steps; i++) {
            const a = start + (length * i) / steps;
            const ib = project([Math.cos(a) * inner, Math.sin(a) * inner, 0], at);
            const ob = project([Math.cos(a) * outer, Math.sin(a) * outer, 0], at);
            fills.push({
                points: [
                    [ia[0], ia[1]],
                    [oa[0], oa[1]],
                    [ob[0], ob[1]],
                    [ib[0], ib[1]],
                ],
                depth: (ia[2] + ob[2]) / 2,
                tone,
                alpha,
            });
            ia = ib;
            oa = ob;
        }
    };

    // the outer plane: six rim arcs over a tick ring, the part of the form furthest from the viewer
    for (let i = 0; i < 6; i++) {
        const start = (i * TAU) / 6 + 0.08;
        arc(planeBack, 1.4, start, 0.78, "body", STROKE.fine, bodyAlpha(0.65, "outer"));
        band(planeBack, 1.32, 1.39, start, 0.78, "body", bodyAlpha(0.18, "outer"));
    }
    for (let i = 0; i < TICK_COUNT; i++) {
        const a = (i * TAU) / TICK_COUNT;
        const len = i % 4 === 0 ? 0.09 : 0.035;
        line(
            [Math.cos(a) * 1.47, Math.sin(a) * 1.47, 0],
            [Math.cos(a) * (1.47 + len), Math.sin(a) * (1.47 + len), 0],
            planeBack,
            "body",
            STROKE.fine,
            bodyAlpha(0.78, "outer")
        );
    }

    // the middle plane: three heavy blades, the layer that carries the form's weight
    for (let i = 0; i < 3; i++) {
        const start = (i * TAU) / 3 + 0.3;
        arc(planeMid, 1.11, start, 1.62, "body", STROKE.heavy, bodyAlpha(1, "mid"));
        band(planeMid, 1.02, 1.1, start, 1.62, "body", bodyAlpha(0.32, "mid"));
    }

    // the front plane: a thin ring with three lit arcs inside it, nearest the viewer
    for (let i = 0; i < 3; i++) {
        arc(planeFront, 0.83, (i * TAU) / 3 + 0.1, 1.3, "hot", STROKE.base, bodyAlpha(0.75, "front"));
    }
    arc(planeFront, 0.91, 0, TAU, "body", STROKE.fine, bodyAlpha(0.5, "front"));

    // the struts, spanning back plane to middle, each carrying work inward to the core while agents run
    const pulseClock = Math.max(0, input.pulseClock ?? 0) || 0;
    let pulses = 0;
    for (let index = 0; index < STRUT_COUNT; index++) {
        const a = (index * TAU) / STRUT_COUNT + 0.45;
        const outer: Vec3 = [Math.cos(a) * 1.4, Math.sin(a) * 1.4, -0.38];
        line(
            outer,
            [Math.cos(a) * 1.11, Math.sin(a) * 1.11, 0],
            strutsAt,
            "body",
            STROKE.fine,
            bodyAlpha(0.45, "struts")
        );
        if (activity <= 0) {
            continue;
        }
        const phase = (pulseClock + PULSE_SEEDS[index] * PULSE_SPREAD) % PULSE_CYCLE;
        if (phase >= 1) {
            continue;
        }
        const core: Vec3 = [Math.cos(a) * PULSE_CORE_RADIUS, Math.sin(a) * PULSE_CORE_RADIUS, coreAt.z];
        const along = (u: number): Vec3 => [
            outer[0] + (core[0] - outer[0]) * u,
            outer[1] + (core[1] - outer[1]) * u,
            outer[2] + (core[2] - outer[2]) * u,
        ];
        line(
            along(phase),
            along(Math.min(1, phase + PULSE_LENGTH)),
            strutsAt,
            "hot",
            STROKE.heavy,
            clamp01(PULSE_ALPHA * Math.sin(Math.PI * phase) * glow) * shown("struts")
        );
        pulses++;
    }

    // the core, recessed behind the middle plane: a lit ring, three brackets, and an empty hexagon at the centre
    arc(coreAt, 0.31, 0, TAU, "hot", STROKE.base, bodyAlpha(0.95, "core"));
    for (let i = 0; i < 3; i++) {
        arc(coreAt, 0.42, (i * TAU) / 3 + 0.1, 1.1, "body", STROKE.base, bodyAlpha(0.95, "core"));
    }
    for (let i = 0; i < 6; i++) {
        const a = (i * TAU) / 6;
        const b = ((i + 1) * TAU) / 6;
        line(
            [Math.cos(a) * 0.17, Math.sin(a) * 0.17, 0],
            [Math.cos(b) * 0.17, Math.sin(b) * 0.17, 0],
            coreAt,
            "body",
            STROKE.fine,
            bodyAlpha(0.9, "core")
        );
    }
    band(coreAt, 0.31, 0.41, 0, TAU, "body", bodyAlpha(0.17, "core"));

    // a bright short arc sweeping the middle plane, only while Jarvis is saying something: the one part that spins on
    // its own clock, so it is never visible at rest, where it would be a loading spinner
    if (face > 0.02) {
        arc(planeMid, 1.11, -0.32 + t * 1.6, 0.64, "hot", STROKE.bold, clamp01(face * glow));
    }

    return { segments, fills, centreX, centreY, extent, pulses };
}

// --- motion: the form's involuntary movement, advanced by the scene's frame loop ---

// One full turn of the sway's phase, and the pitch bob on a second, coprime-ish period, so the pair never returns to
// the same pose on a short cycle. Slow enough to read as parallax, not as a spinner.
export const ORBIT_MS = 48_000;
export const ORBIT_PITCH_MS = 17_000;
export const ORBIT_PITCH = 0.18;

/** The sway's phase (yaw, taken modulo the period so a long session never quantises it) and the pitch bob. */
export function hudOrbit(now: number): { yaw: number; pitch: number } {
    if (!Number.isFinite(now)) {
        return { yaw: 0, pitch: 0 };
    }
    const turn = (((now % ORBIT_MS) + ORBIT_MS) % ORBIT_MS) / ORBIT_MS;
    return { yaw: turn * TAU, pitch: Math.sin((now / ORBIT_PITCH_MS) * TAU) * ORBIT_PITCH };
}

// How long one utterance keeps the form turned square-on: the bubble appearing is the driver, so it surges at once and
// decays across this window.
export const UTTERANCE_MS = 2_200;

/** 1 at the moment Jarvis spoke, down to 0 across UTTERANCE_MS; a future or missing moment is silence. */
export function utteranceEnvelope(now: number, spokeAt: number | null, durationMs = UTTERANCE_MS): number {
    if (spokeAt == null || !Number.isFinite(spokeAt) || !Number.isFinite(now) || !(durationMs > 0)) {
        return 0;
    }
    const elapsed = now - spokeAt;
    if (!(elapsed >= 0) || elapsed >= durationMs) {
        return 0;
    }
    return 1 - elapsed / durationMs;
}

// The resting breath; load shortens it toward BREATH_MIN_MS, reached at ACTIVITY_FULL working agents
export const BREATH_MS = 4_800;
export const BREATH_MIN_MS = 1_900;
export const ACTIVITY_FULL = 6;
// concave, so the first few agents are felt: 2 working already sits near half load
const ACTIVITY_CURVE = 0.66;
// pulse-clock speed in cycles a second at the lightest load, and what full load adds
const PULSE_RATE_BASE = 0.25;
const PULSE_RATE_SPAN = 0.75;
// a hidden window can hand back a multi-second step on its first frame
export const MAX_STEP_MS = 1_000;

/** 0..1 load from the working-agent count: 0 at none, 1 at ACTIVITY_FULL or more. */
export function activityLevel(working: number): number {
    if (!Number.isFinite(working) || working <= 0) {
        return 0;
    }
    return (Math.min(working, ACTIVITY_FULL) / ACTIVITY_FULL) ** ACTIVITY_CURVE;
}

export function breathPeriodMs(activity: number): number {
    return BREATH_MS - (BREATH_MS - BREATH_MIN_MS) * clamp01(activity);
}

/** Pulse-clock cycles a second; 0 at rest, so an idle form draws no pulses rather than slow ones. */
export function pulseRate(activity: number): number {
    if (!Number.isFinite(activity) || activity <= 0) {
        return 0;
    }
    return PULSE_RATE_BASE + Math.min(activity, 1) * PULSE_RATE_SPAN;
}

/** 0 at rest, 1 at full inhale, back to 0: a raised cosine, so the loop point has no seam. */
export function breathFromPhase(phase: number): number {
    if (!Number.isFinite(phase)) {
        return 0;
    }
    return (1 - Math.cos(phase * TAU)) / 2;
}

/** The motion the loop carries between frames: accumulated, so a change of load changes the tempo, never the place. */
export interface HudMotion {
    breathPhase: number;
    pulseClock: number;
    /** when the current utterance began (ms on the scene's clock), or null */
    spokeAt: number | null;
    speaking: boolean;
}

export const HUD_MOTION_START: HudMotion = { breathPhase: 0, pulseClock: 0, spokeAt: null, speaking: false };

/** One frame of motion, `dtMs` after the last, at `now` ms on the scene's clock. */
export function stepHudMotion(m: HudMotion, now: number, dtMs: number, activity: number, speaking: boolean): HudMotion {
    const dt = Number.isFinite(dtMs) ? Math.max(0, Math.min(MAX_STEP_MS, dtMs)) : 0;
    const next = (m.breathPhase + dt / breathPeriodMs(activity)) % 1;
    return {
        breathPhase: next < 0 ? next + 1 : next,
        pulseClock: m.pulseClock + (dt / 1_000) * pulseRate(activity),
        // a bubble that comes up is an utterance; one that stays up does not keep the form surged
        spokeAt: speaking && !m.speaking ? now : m.spokeAt,
        speaking,
    };
}

// --- colour and packing: what the GPU gets ---

export type Rgb = [number, number, number];

// how far the hot tone lightens the body toward white
export const HOT_LIGHTEN = 0.62;

/** The body and its lit tone, in display (sRGB) values 0..1. */
export function hudColours(body: Rgb): { body: Rgb; hot: Rgb } {
    const hot = body.map((c) => c + (1 - c) * HOT_LIGHTEN) as Rgb;
    return { body, hot };
}

function srgbToLinear(v: number): number {
    return v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
}

/**
 * Segments -> fat-line positions and colours, written into the caller's arrays from index 0 (six floats a segment);
 * returns the count. Positions go to a [-1,1] box, y up. The alpha is folded into the colour, which under additive
 * blending is exact, and the result is handed over in linear light: the scene ends in OutputPass, which encodes to
 * sRGB, so a stroke shows exactly the fork's colour x alpha.
 */
export function packHudLines(
    segments: readonly HudSegment[],
    size: number,
    colours: { body: Rgb; hot: Rgb },
    positions: Float32Array,
    colors: Float32Array
): number {
    const nx = (x: number) => (x / size) * 2 - 1;
    const ny = (y: number) => 1 - (y / size) * 2;
    for (let i = 0; i < segments.length; i++) {
        const s = segments[i];
        const rgb = colours[s.tone];
        const a = clamp01(s.alpha);
        const p = i * 6;
        positions[p] = nx(s.ax);
        positions[p + 1] = ny(s.ay);
        positions[p + 2] = 0;
        positions[p + 3] = nx(s.bx);
        positions[p + 4] = ny(s.by);
        positions[p + 5] = 0;
        for (let c = 0; c < 3; c++) {
            colors[p + c] = colors[p + 3 + c] = srgbToLinear(rgb[c] * a);
        }
    }
    return segments.length;
}

export function hudFillTriangles(fills: readonly HudFill[]): number {
    let triangles = 0;
    for (const f of fills) {
        triangles += Math.max(0, f.points.length - 2);
    }
    return triangles;
}

/** Fills -> one triangle soup fanned from each quad's first vertex (nine floats a triangle); returns the count. */
export function packHudFills(
    fills: readonly HudFill[],
    size: number,
    colours: { body: Rgb; hot: Rgb },
    positions: Float32Array,
    colors: Float32Array
): number {
    const nx = (x: number) => (x / size) * 2 - 1;
    const ny = (y: number) => 1 - (y / size) * 2;
    let at = 0;
    for (const f of fills) {
        const rgb = colours[f.tone];
        const a = clamp01(f.alpha);
        const lit: Rgb = [srgbToLinear(rgb[0] * a), srgbToLinear(rgb[1] * a), srgbToLinear(rgb[2] * a)];
        for (let i = 1; i + 1 < f.points.length; i++) {
            for (const v of [f.points[0], f.points[i], f.points[i + 1]]) {
                positions[at] = nx(v[0]);
                positions[at + 1] = ny(v[1]);
                positions[at + 2] = 0;
                colors[at] = lit[0];
                colors[at + 1] = lit[1];
                colors[at + 2] = lit[2];
                at += 3;
            }
        }
    }
    return at / 9;
}

// The form is rebuilt every frame, so its buffers live across frames; one that is outgrown is replaced with headroom,
// so a count that wobbles (the pulses come and go) does not reallocate each frame.
const MIN_CAPACITY = 64;
const CAPACITY_GROWTH = 2;

export function growCapacity(needed: number, current: number): number {
    if (current > 0 && needed <= current) {
        return current;
    }
    return Math.max(MIN_CAPACITY, Math.ceil(needed * CAPACITY_GROWTH));
}
