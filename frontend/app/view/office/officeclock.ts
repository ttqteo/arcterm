// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0
//
// The Cockpit office's two clocks and what they cost (cockpit office spec, "Motion" and "Its cost in the RAM panel").
// The frame clock flips two-frame poses every 450 ms; the walk loop moves people on animation frames. Each runs only
// while something needs it, both stop when the window is hidden, under reduced motion, or with the animation off,
// and every step is timed into the meter the RAM panel's Office line reads.

import { globalStore } from "@/app/store/jotaiStore";
import { atom, type PrimitiveAtom } from "jotai";
import { useCallback, useEffect, useRef } from "react";

export const FRAME_MS = 450;
export const METER_WINDOW_MS = 10_000;
// a longer gap than this (a hidden window, a long task) moves people as if this much time passed, not the whole gap
const MAX_STEP_MS = 100;

/** Counts up every frame; a two-frame pose shows frame tick % 2. */
export const officeTickAtom = atom(0) as PrimitiveAtom<number>;

export interface OfficeCounts {
    people: number;
    walking: number;
    animated: number;
}
/** What the office draws; null while it is not mounted, so the RAM panel has no Office line. */
export const officeMeterAtom = atom<OfficeCounts | null>(null) as PrimitiveAtom<OfficeCounts | null>;

export function clockShouldRun(o: { need: boolean; on: boolean; hidden: boolean; reduced: boolean }): boolean {
    return o.need && o.on && !o.hidden && !o.reduced;
}

/** The office's own JS time, sample by sample, kept for the last ten seconds. */
export class OfficeMeter {
    private samples: { at: number; ms: number }[] = [];

    record(at: number, ms: number): void {
        this.samples.push({ at, ms });
        this.trim(at);
    }

    /** JS time over the window as a percent of one core, to 0.1. */
    share(now: number): number {
        this.trim(now);
        const ms = this.samples.reduce((s, x) => s + x.ms, 0);
        return Math.round((ms / METER_WINDOW_MS) * 1000) / 10;
    }

    private trim(now: number): void {
        const from = now - METER_WINDOW_MS;
        let i = 0;
        while (i < this.samples.length && this.samples[i].at < from) {
            i++;
        }
        if (i > 0) {
            this.samples.splice(0, i);
        }
    }
}
export const officeMeter = new OfficeMeter();

const clocks = { frame: false, walk: false };
let root: HTMLElement | null = null;

/** Whether each clock runs, for the probe and the Office line. */
export function officeClocks(): { frame: boolean; walk: boolean } {
    return { ...clocks };
}

export function setOfficeRoot(el: HTMLElement | null): void {
    root = el;
}

/** The office's DOM nodes, counted when asked: the RAM panel asks once a second while it is open. */
export function officeDomNodes(): number {
    return root ? root.getElementsByTagName("*").length : 0;
}

function timed(fn: () => void): void {
    const t = performance.now();
    try {
        fn();
    } finally {
        officeMeter.record(Date.now(), performance.now() - t);
    }
}

function resetTick(): void {
    if (globalStore.get(officeTickAtom) !== 0) {
        globalStore.set(officeTickAtom, 0);
    }
}

/** The frame clock: ticks while `need` and `on`, the window shows, and motion is allowed. */
export function useFrameClock(need: boolean, on: boolean): void {
    useEffect(() => {
        const reduce = window.matchMedia("(prefers-reduced-motion: reduce)");
        let timer: number | undefined;
        const sync = () => {
            const run = clockShouldRun({ need, on, hidden: document.hidden, reduced: reduce.matches });
            if (run && timer == null) {
                timer = window.setInterval(
                    () => timed(() => globalStore.set(officeTickAtom, globalStore.get(officeTickAtom) + 1)),
                    FRAME_MS
                );
            } else if (!run) {
                if (timer != null) {
                    window.clearInterval(timer);
                    timer = undefined;
                }
                resetTick();
            }
            clocks.frame = timer != null;
        };
        sync();
        document.addEventListener("visibilitychange", sync);
        reduce.addEventListener("change", sync);
        return () => {
            document.removeEventListener("visibilitychange", sync);
            reduce.removeEventListener("change", sync);
            if (timer != null) {
                window.clearInterval(timer);
            }
            // a stale odd tick would hold every pose on frame 1 once the clock is off or the office remounts
            resetTick();
            clocks.frame = false;
        };
    }, [need, on]);
}

/** The walk loop: step(dt) on animation frames while it returns true. The returned kick starts it again; a kick
 * while it runs does nothing. */
export function useWalkLoop(step: (dtMs: number) => boolean): () => void {
    const stepRef = useRef(step);
    stepRef.current = step;
    const raf = useRef<number | undefined>(undefined);
    useEffect(
        () => () => {
            if (raf.current != null) {
                cancelAnimationFrame(raf.current);
            }
            raf.current = undefined;
            clocks.walk = false;
        },
        []
    );
    return useCallback(() => {
        if (raf.current != null) {
            return;
        }
        let last = performance.now();
        const frame = (t: number) => {
            const dt = Math.min(MAX_STEP_MS, t - last);
            last = t;
            let more = false;
            timed(() => {
                more = stepRef.current(dt);
            });
            raf.current = more ? requestAnimationFrame(frame) : undefined;
            clocks.walk = raf.current != null;
        };
        raf.current = requestAnimationFrame(frame);
        clocks.walk = true;
    }, []);
}
