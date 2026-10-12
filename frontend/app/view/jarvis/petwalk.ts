// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0
//
// Where Sprout stands on the ledge and what it is doing there (sprout spec §3). Pure — no React, no atoms,
// no DOM — so the walker can be stepped by a test clock: the renderer measures the ledge and the avoid spans,
// hands them in with the condition, and draws whatever pose comes back at the x that comes back.
//
// All positions are the sprite's LEFT edge in viewport px, and the whole 48 px span stays on the ledge:
// `ledge.left <= x` and `x + 48 <= ledge.right`. Every x the walker returns is a whole px, because the
// sprite is pixel art and a fractional left edge would smear its cells.
//
// The walker is a timer-driven state machine, not a frame loop: each step says how long until it next
// needs stepping (`delayMs`), and says `null` whenever the creature is still, so the loop stops (spec §1
// decision 6). It is also stepped whenever an input changes, at any time, so every timed state remembers
// when its next frame is due and an early step neither moves it nor ends its rest.

import { wearsTired, type PetExpression, type PetPosture } from "./petcondition";
import { PET_CELL_PX, PET_PX, type PetMark, type PetPose } from "./petsprite";

export type WalkerStateName = "walk" | "rest" | "sleep" | "hold" | "hop" | "dragged";

export interface Ledge {
    left: number;
    right: number;
}

export interface WalkerInput {
    ledge: Ledge;
    // horizontal extents of every terminal and composer that touches the ledge, re-measured for each step
    avoid: readonly [number, number][];
    expression: PetExpression["kind"];
    posture: PetPosture;
    // a bubble shows
    speaking: boolean;
    peekOpen: boolean;
    dragging: boolean;
    // prefers-reduced-motion
    reduce: boolean;
    // the last utterance, posture change or interaction (hover, click, drag), on the same clock as `now`
    lastActivityAt: number;
    // where the creature lives, as a 0..1 fraction of the ledge (petstore's petHomeAtom)
    home: number;
    // Spider-Man, with an app bar to hang from, the cursor not on him, and motion allowed: a rest may be a hang
    hangs: boolean;
}

export interface WalkerState {
    name: WalkerStateName;
    // the sprite's left edge
    x: number;
    // facing left, so the renderer mirrors the body (it faces right unmirrored)
    flip: boolean;
    // where a walk is heading (a left edge); null in every other state
    target: number | null;
    // walk: the index of the frame drawn, which picks walk1/walk2; hop: the hop frame drawn
    frame: number;
    // walk and hop: when the next frame is due; rest: when the rest ends
    due: number;
    // what a rest is spent doing when not tired, picked when the rest starts
    restPose: RestPose;
    // the posture seen at the last step, so a posture's arrival can be told from its standing
    posture: PetPosture;
    // a hang rest: when it began, how long it crawls, where it left the ledge and which way it crawls
    hang?: { at: number; crawlMs: number; x0: number; dir: 1 | -1 };
}

export interface WalkerStep {
    state: WalkerState;
    pose: PetPose;
    // every mark the walker draws; `unread` is the renderer's to add
    marks: PetMark[];
    x: number;
    flip: boolean;
    // px the sprite stands above the ledge: HOP_LIFT_PX during a hop, else 0
    lift: number;
    // Spider-Man's app-bar pastime, by phase; null otherwise. The renderer draws the crawl and the hang from their own
    // grids (SPIDEY_CRAWL, SPIDEY_HANG), and the pose stands in for them
    hang: HangPhase | null;
    // when to step again; null while the creature is still, until an input changes
    delayMs: number | null;
}

// 8 fps, one cell per frame: 24 px/s (spec §3). Tired halves the rate, not the step, so it still moves a
// whole cell at a time.
export const FRAME_MS = 125;
export const TIRED_FRAME_MS = 250;
export const STEP_PX = PET_CELL_PX;

// How far a walk goes, from where it starts.
export const TARGET_MIN_PX = 80;
export const TARGET_MAX_PX = 400;

// How long a rest lasts; tired rests twice as long.
export const REST_MIN_MS = 5_000;
export const REST_MAX_MS = 15_000;

// What a rest is spent doing, picked at random as it starts: standing or sitting still, or a pastime — studying,
// music, work, sport — whose frames loop for the length of the rest.
export const REST_POSES = ["stand", "sit", "read", "music", "work", "ball"] as const;
export type RestPose = (typeof REST_POSES)[number] | "hang";

export const PASTIMES: Partial<Record<RestPose, { frames: readonly PetPose[]; frameMs: number }>> = {
    read: { frames: ["read1", "read2"], frameMs: 1_200 },
    music: { frames: ["music1", "music2"], frameMs: 450 },
    work: { frames: ["work1", "work2"], frameMs: 250 },
    ball: { frames: ["ball1", "ball2"], frameMs: 300 },
};

// Spider-Man's own rest, when WalkerInput.hangs: a strand to the app bar and up it, a crawl along its underside, a hang
// upside down from it, and a rappel back down where the crawl left him. About one rest in HANG_EVERY, never tired.
export const HANG_EVERY = 7;
export const HANG_UP_MS = 400;
export const CRAWL_MIN_MS = 1_500;
export const CRAWL_MAX_MS = 3_000;
// a cell of crawl this often
export const CRAWL_STEP_MS = 250;
export const HANG_MIN_MS = 4_000;
export const HANG_MAX_MS = 8_000;
export const HANG_DOWN_MS = 500;

export type HangPhase = "up" | "crawl" | "hang" | "down";

// No utterance, posture change or interaction for this long, and it goes to sleep.
export const SLEEP_AFTER_MS = 10 * 60_000;

// A posture's arrival lifts the sprite two cells for two frames: the hologram's jolt, as a hop.
export const HOP_FRAMES = 2;
export const HOP_LIFT_PX = 2 * PET_CELL_PX;

// the mark a posture draws over the creature's head, shared with the folded Sprout (petmini.ts)
export const POSTURE_MARK: Record<PetPosture, PetMark | null> = {
    "review-gate": "gate",
    escalation: "escalation",
    "blocked-worker": "blocked",
    none: null,
};

// The whole-px left edges that keep the sprite on the ledge. A ledge narrower than the sprite (a window
// dragged absurdly small) pins it to the left end rather than inverting the range.
function travel(ledge: Ledge): [number, number] {
    const lo = Math.ceil(ledge.left);
    return [lo, Math.max(lo, Math.floor(ledge.right - PET_PX))];
}

function clampX(x: number, ledge: Ledge): number {
    const [lo, hi] = travel(ledge);
    return Math.min(hi, Math.max(lo, Math.round(x)));
}

// Whether the sprite's span at left edge x overlaps an avoid span. Touching edges do not overlap: a creature
// standing flush against a terminal covers none of it.
function blocked(x: number, avoid: readonly [number, number][]): boolean {
    return avoid.some(([a0, a1]) => x < Math.max(a0, a1) && x + PET_PX > Math.min(a0, a1));
}

// The whole-px left edges on the ledge whose span overlaps no avoid span, as closed intervals in order.
function clearIntervals(ledge: Ledge, avoid: readonly [number, number][]): [number, number][] {
    let out: [number, number][] = [travel(ledge)];
    for (const [s0, s1] of avoid) {
        const a0 = Math.min(s0, s1);
        const a1 = Math.max(s0, s1);
        // x is blocked while x < a1 and x + 48 > a0
        const b0 = Math.floor(a0 - PET_PX) + 1;
        const b1 = Math.ceil(a1) - 1;
        if (b1 < b0) {
            continue;
        }
        out = out.flatMap(([lo, hi]): [number, number][] => {
            const left: [number, number][] = lo <= Math.min(hi, b0 - 1) ? [[lo, Math.min(hi, b0 - 1)]] : [];
            const right: [number, number][] = Math.max(lo, b1 + 1) <= hi ? [[Math.max(lo, b1 + 1), hi]] : [];
            return [...left, ...right];
        });
    }
    return out;
}

/** The left edge at `fraction` (0..1) of the ledge's travel: home, placed on a ledge of any width. */
export function homeX(fraction: number, ledge: Ledge): number {
    // petstore never hands over a non-finite fraction; one reads as the left end rather than as NaN px
    const f = Number.isFinite(fraction) ? Math.min(1, Math.max(0, fraction)) : 0;
    return clampX(ledge.left + f * (ledge.right - PET_PX - ledge.left), ledge);
}

/** Where left edge x sits along the ledge's travel, 0..1: what petstore persists as home. */
export function homeFraction(x: number, ledge: Ledge): number {
    const span = ledge.right - PET_PX - ledge.left;
    if (!(span > 0)) {
        return 0;
    }
    return Math.min(1, Math.max(0, (x - ledge.left) / span));
}

/**
 * The left edge nearest `target` whose span overlaps no avoid span, or `target` (kept on the ledge) when no
 * spot is clear.
 */
export function clearSpot(target: number, ledge: Ledge, avoid: readonly [number, number][]): number {
    const want = clampX(target, ledge);
    let best: number | null = null;
    for (const [lo, hi] of clearIntervals(ledge, avoid)) {
        const near = Math.min(hi, Math.max(lo, want));
        if (best == null || Math.abs(near - want) < Math.abs(best - want)) {
            best = near;
        }
    }
    return best ?? want;
}

/** The left edge that centres the sprite on the pointer, kept on the ledge: where a drag lands. */
export function dropAt(pointerX: number, ledge: Ledge): number {
    return clampX(pointerX - PET_PX / 2, ledge);
}

/** The delay to schedule the next step with: none while the tab is hidden, so the loop stops there. */
export function nextTick(delayMs: number | null, hidden: boolean): number | null {
    return hidden ? null : delayMs;
}

// A clear left edge 80-400 px from x, uniform over every such whole px; the clear spot nearest home when
// there is none.
function pickTarget(x: number, input: WalkerInput, rand: () => number): number {
    const windows: [number, number][] = [
        [x - TARGET_MAX_PX, x - TARGET_MIN_PX],
        [x + TARGET_MIN_PX, x + TARGET_MAX_PX],
    ];
    const spots: [number, number][] = [];
    for (const [lo, hi] of clearIntervals(input.ledge, input.avoid)) {
        for (const [w0, w1] of windows) {
            const s0 = Math.max(lo, Math.ceil(w0));
            const s1 = Math.min(hi, Math.floor(w1));
            if (s0 <= s1) {
                spots.push([s0, s1]);
            }
        }
    }
    const total = spots.reduce((n, [s0, s1]) => n + s1 - s0 + 1, 0);
    if (total === 0) {
        return clearSpot(homeX(input.home, input.ledge), input.ledge, input.avoid);
    }
    let i = Math.min(total - 1, Math.floor(rand() * total));
    for (const [s0, s1] of spots) {
        if (i <= s1 - s0) {
            return s0 + i;
        }
        i -= s1 - s0 + 1;
    }
    return spots[spots.length - 1][1];
}

function frameMsFor(input: WalkerInput): number {
    return wearsTired(input.expression) ? TIRED_FRAME_MS : FRAME_MS;
}

function isIdle(input: WalkerInput, now: number): boolean {
    return now - input.lastActivityAt >= SLEEP_AFTER_MS;
}

function isHolding(input: WalkerInput): boolean {
    return input.posture !== "none" || input.speaking || input.peekOpen;
}

function still(s: WalkerState, name: WalkerStateName): WalkerState {
    return { ...s, name, target: null, frame: 0 };
}

function rest(s: WalkerState, input: WalkerInput, now: number, rand: () => number): WalkerState {
    // the extra draw only when he can hang, so every other creature's walk is the walk it always was
    if (input.hangs && !wearsTired(input.expression) && rand() < 1 / HANG_EVERY) {
        return startHang(s, input, now, rand);
    }
    const length = REST_MIN_MS + rand() * (REST_MAX_MS - REST_MIN_MS);
    return {
        ...still(s, "rest"),
        due: now + (wearsTired(input.expression) ? 2 * length : length),
        restPose: REST_POSES[Math.min(REST_POSES.length - 1, Math.floor(rand() * REST_POSES.length))],
        hang: undefined,
    };
}

// A rest begun now in this pose, for its longest length: the DEV contract's force({ rest }) (petview.tsx), so a CDP
// step can show every rest pose without waiting on the random pick.
export function restIn(s: WalkerState, pose: (typeof REST_POSES)[number], now: number): WalkerState {
    return { ...still(s, "rest"), due: now + REST_MAX_MS, restPose: pose, hang: undefined };
}

/** A hang rest starting now, crawling toward the roomier side. Exported for the DEV force (petview.tsx). */
export function startHang(s: WalkerState, input: WalkerInput, now: number, rand: () => number): WalkerState {
    const crawlMs = CRAWL_MIN_MS + rand() * (CRAWL_MAX_MS - CRAWL_MIN_MS);
    const hangMs = HANG_MIN_MS + rand() * (HANG_MAX_MS - HANG_MIN_MS);
    const [lo, hi] = travel(input.ledge);
    const dir = hi - s.x >= s.x - lo ? 1 : -1;
    return {
        ...still(s, "rest"),
        restPose: "hang",
        flip: dir < 0,
        hang: { at: now, crawlMs, x0: s.x, dir },
        due: now + HANG_UP_MS + crawlMs + hangMs + HANG_DOWN_MS,
    };
}

/** Which phase of his hang a state is in at `now`, or null when he is not hanging. */
export function hangPhase(s: WalkerState, now: number): HangPhase | null {
    if (s.name !== "rest" || s.restPose !== "hang" || s.hang == null) {
        return null;
    }
    const t = now - s.hang.at;
    if (t < HANG_UP_MS) {
        return "up";
    }
    if (t < HANG_UP_MS + s.hang.crawlMs) {
        return "crawl";
    }
    return now >= s.due - HANG_DOWN_MS ? "down" : "hang";
}

// where the crawl has taken him by now: a cell every CRAWL_STEP_MS from where he went up, kept on the ledge's span
function hangX(s: WalkerState, input: WalkerInput, now: number): number {
    const h = s.hang!;
    const t = Math.min(Math.max(0, now - h.at - HANG_UP_MS), h.crawlMs);
    return clampX(h.x0 + h.dir * Math.floor(t / CRAWL_STEP_MS) * STEP_PX, input.ledge);
}

// A rest's pastime, unless tired (which rests in its own still pose).
function pastimeOf(s: WalkerState, input: WalkerInput) {
    return wearsTired(input.expression) ? undefined : PASTIMES[s.restPose];
}

// A pastime's frame is counted back from the rest's end, so it needs no clock of its own and an early step
// draws the frame already showing.
function restPoseAt(s: WalkerState, input: WalkerInput, now: number): PetPose {
    const phase = hangPhase(s, now);
    if (phase != null) {
        // hands on the strand going up and coming down; the crawl and the hang are drawn from their own grids
        return phase === "up" || phase === "down" ? "dangle" : "stand";
    }
    const pastime = pastimeOf(s, input);
    if (pastime == null) {
        return wearsTired(input.expression) ? "tired" : (s.restPose as "stand" | "sit");
    }
    const i = Math.floor(Math.max(0, s.due - now) / pastime.frameMs) % pastime.frames.length;
    return pastime.frames[i];
}

// Until the rest ends, or until a pastime's next frame when that comes first.
function restDelay(s: WalkerState, input: WalkerInput, now: number): number {
    if (s.restPose === "hang" && s.hang != null) {
        const h = s.hang;
        const crawlEnd = h.at + HANG_UP_MS + h.crawlMs;
        const bounds = [h.at + HANG_UP_MS, crawlEnd, s.due - HANG_DOWN_MS, s.due];
        if (now >= h.at + HANG_UP_MS && now < crawlEnd) {
            const into = now - h.at - HANG_UP_MS;
            bounds.push(h.at + HANG_UP_MS + (Math.floor(into / CRAWL_STEP_MS) + 1) * CRAWL_STEP_MS);
        }
        const next = bounds.filter((b) => b > now);
        return next.length === 0 ? 0 : Math.min(...next) - now;
    }
    const left = Math.max(0, s.due - now);
    const pastime = pastimeOf(s, input);
    if (pastime == null || left === 0) {
        return left;
    }
    return Math.min(left, left % pastime.frameMs || pastime.frameMs);
}

// A walk starts by drawing its first frame where it stands, and moves on the next: whatever it was doing
// before (the drop, the rest) is shown landing in place rather than a cell along.
function startWalk(s: WalkerState, target: number, input: WalkerInput, now: number): WalkerState {
    return {
        ...s,
        name: "walk",
        target,
        frame: 0,
        due: now + frameMsFor(input),
        flip: target === s.x ? s.flip : target < s.x,
    };
}

// Arriving: asleep if it has been idle long enough, else a fresh rest.
function arrive(s: WalkerState, input: WalkerInput, now: number, rand: () => number): WalkerState {
    return isIdle(input, now) ? still(s, "sleep") : rest(s, input, now, rand);
}

// Done holding, being dragged, hopping or sleeping: it stays where it is when that spot is clear (or nothing
// is), and otherwise walks off to the nearest clear spot — it may stop over a terminal, but not stay there.
function settle(s: WalkerState, input: WalkerInput, now: number, rand: () => number): WalkerState {
    const spot = clearSpot(s.x, input.ledge, input.avoid);
    return spot === s.x ? arrive(s, input, now, rand) : startWalk(s, spot, input, now);
}

// One walk frame, if one is due: a cell toward the target, or the arrival (`land`) when it is within a cell
// of it.
function advance(s: WalkerState, input: WalkerInput, now: number, land: (s: WalkerState) => WalkerState): WalkerState {
    if (now < s.due) {
        return s;
    }
    const target = s.target ?? s.x;
    const dx = target - s.x;
    if (Math.abs(dx) <= STEP_PX) {
        return land({ ...s, x: target });
    }
    const x = clampX(s.x + Math.sign(dx) * STEP_PX, input.ledge);
    return { ...s, x, flip: dx < 0, frame: s.frame + 1, due: now + frameMsFor(input) };
}

function poseOf(s: WalkerState, input: WalkerInput, now: number): PetPose {
    switch (s.name) {
        case "walk":
            return Math.floor(s.frame / 2) % 2 === 0 ? "walk1" : "walk2";
        case "rest":
            return restPoseAt(s, input, now);
        case "sleep":
            return "sleep";
        case "hold":
            return input.speaking ? "speak" : "stand";
        case "hop":
            return "stand";
        case "dragged":
            return "dangle";
    }
}

function view(s: WalkerState, input: WalkerInput, now: number, delayMs: number | null): WalkerStep {
    const pose = poseOf(s, input, now);
    const marks: PetMark[] = [];
    const postureMark = POSTURE_MARK[input.posture];
    if (postureMark != null) {
        marks.push(postureMark);
    }
    if (pose === "tired") {
        marks.push("drop");
    }
    if (s.name === "sleep") {
        marks.push("z");
    }
    return {
        state: s,
        pose,
        marks,
        x: s.x,
        flip: s.flip,
        lift: s.name === "hop" ? HOP_LIFT_PX : 0,
        hang: hangPhase(s, now),
        delayMs,
    };
}

/**
 * How far the drawn sprite slides back to where it stood when the walker moved it more than a walk step without
 * walking: the ledge narrowed under it (in Float a tab or the usage grew, or the window shrank) and the clamp placed
 * it at once. The renderer starts the sprite that far off and eases it in, so it is never seen to jump. A drop is
 * placed where the pointer let go, so it never slides. 0 when nothing jumped.
 */
export function slideFrom(prev: { x: number; name: WalkerStateName } | null, nextX: number): number {
    if (prev == null || prev.name === "dragged") {
        return 0;
    }
    const dx = prev.x - nextX;
    return Math.abs(dx) > STEP_PX ? dx : 0;
}

/**
 * The walker at boot: at home, walking toward a clear target — or, under reduced motion, standing at the
 * clear spot nearest home.
 */
export function initialWalker(input: WalkerInput, now: number, rand: () => number): WalkerState {
    const home = homeX(input.home, input.ledge);
    const base: WalkerState = {
        name: "rest",
        x: home,
        flip: false,
        target: null,
        frame: 0,
        due: now,
        restPose: "stand",
        // a posture already standing at boot did not just arrive, so boot never hops
        posture: input.posture,
    };
    if (input.reduce) {
        return { ...base, x: clearSpot(home, input.ledge, input.avoid) };
    }
    return startWalk(base, pickTarget(home, input, rand), input, now);
}

/**
 * Advance the walker to `now`. Safe to call at any time: the renderer calls it when the last `delayMs`
 * elapses and again whenever an input changes, and a step before a frame or a rest is due changes nothing
 * but the delay.
 *
 * A drag hands the creature to the pointer; on release the renderer persists the drop as home
 * (`setPetHome(homeFraction(dropAt(pointerX, ledge), ledge))`) before stepping, and the walker lands it at
 * that home.
 */
export function stepWalker(state: WalkerState, input: WalkerInput, now: number, rand: () => number): WalkerStep {
    const { ledge, avoid } = input;
    const arrived = input.posture !== "none" && input.posture !== state.posture;
    let s: WalkerState = {
        ...state,
        x: clampX(state.x, ledge),
        target: state.target == null ? null : clampX(state.target, ledge),
        posture: input.posture,
    };

    if (input.dragging) {
        return view(still(s, "dragged"), input, now, null);
    }
    if (state.name === "dragged") {
        s = { ...s, x: homeX(input.home, ledge) };
    }

    // Reduced motion: placed, never walked, never hopped; pose and marks still follow the condition.
    if (input.reduce) {
        const x = clearSpot(homeX(input.home, ledge), ledge, avoid);
        const name = isHolding(input) ? "hold" : isIdle(input, now) ? "sleep" : "rest";
        return view({ ...still(s, name), x, restPose: "stand" }, input, now, null);
    }

    const frameMs = frameMsFor(input);
    if (isHolding(input)) {
        if (arrived) {
            return view({ ...still(s, "hop"), due: now + frameMs }, input, now, frameMs);
        }
        if (s.name === "hop") {
            if (now < s.due) {
                return view(s, input, now, s.due - now);
            }
            if (s.frame < HOP_FRAMES - 1) {
                return view({ ...s, frame: s.frame + 1, due: now + frameMs }, input, now, frameMs);
            }
        }
        // A posture can stand for minutes, so it is not held on a terminal: hopped in place, the creature walks
        // off the span to the nearest clear spot and holds there. So does a bubble, which follows it there: a toast
        // drawn over the pet hides the bubble with it, and a bubble over a terminal covers its last lines. Only the
        // peek holds it where it is, since it is a panel you are working in.
        const spot = clearSpot(s.x, ledge, avoid);
        if (!input.peekOpen && spot !== s.x) {
            s = s.name === "walk" ? { ...s, target: spot } : startWalk(s, spot, input, now);
            s = advance(s, input, now, (s) => still(s, "hold"));
            if (s.name === "walk") {
                return view(s, input, now, Math.max(0, s.due - now));
            }
        }
        return view(still(s, "hold"), input, now, null);
    }

    if (isIdle(input, now)) {
        // it sleeps where it stands when that is clear, and walks off the span to sleep when it is not
        const spot = clearSpot(s.x, ledge, avoid);
        if (spot === s.x) {
            return view(still(s, "sleep"), input, now, null);
        }
        s = s.name === "walk" ? { ...s, target: spot } : startWalk(s, spot, input, now);
    } else if (s.name === "rest") {
        if (s.restPose === "hang" && s.hang != null) {
            if (input.hangs) {
                s = { ...s, x: hangX(s, input, now) };
            } else {
                // the cursor came onto him, or the app bar went: he comes down where he is and rests the rest standing
                s = { ...s, restPose: "stand", hang: undefined };
            }
        }
        if (s.restPose !== "hang" && blocked(s.x, avoid) && clearSpot(s.x, ledge, avoid) !== s.x) {
            // a terminal opened under it: a rest is never spent on one
            s = startWalk(s, clearSpot(s.x, ledge, avoid), input, now);
        } else if (now < s.due) {
            return view(s, input, now, restDelay(s, input, now));
        } else {
            s = startWalk(s, pickTarget(s.x, input, rand), input, now);
        }
    } else if (s.name === "walk") {
        if (s.target != null && blocked(s.target, avoid)) {
            s = { ...s, target: clearSpot(s.target, ledge, avoid) };
        }
    } else {
        s = settle(s, input, now, rand);
    }

    if (s.name === "walk") {
        s = advance(s, input, now, (s) => arrive(s, input, now, rand));
    }
    switch (s.name) {
        case "walk":
            return view(s, input, now, Math.max(0, s.due - now));
        case "rest":
            return view(s, input, now, restDelay(s, input, now));
        default:
            return view(s, input, now, null);
    }
}
