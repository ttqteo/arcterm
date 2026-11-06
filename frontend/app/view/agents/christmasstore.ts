// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0
//
// The two Christmas gates as hooks, so no view re-derives the preset check: static decor keys off useChristmasDecor,
// the snow and the lights' blink off useChristmasMotion, and whether the snow shows at all off useChristmasSnow.

import { useAtomValue } from "jotai";
import { useEffect, useState } from "react";

import { christmasMotionOn, christmasSnowShows, hasChristmasDecor } from "./christmas";
import { christmasEffectsOffAtom, christmasSnowOnAtom, themePresetAtom } from "./themestore";

const REDUCED_MOTION_QUERY = "(prefers-reduced-motion: reduce)";

function reducedMotionNow(): boolean {
    return typeof window !== "undefined" && (window.matchMedia?.(REDUCED_MOTION_QUERY).matches ?? false);
}

// prefers-reduced-motion, kept current with a matchMedia listener.
function useReducedMotion(): boolean {
    const [reduced, setReduced] = useState(reducedMotionNow);
    useEffect(() => {
        const mq = window.matchMedia?.(REDUCED_MOTION_QUERY);
        if (!mq) return;
        const onChange = () => setReduced(mq.matches);
        onChange();
        mq.addEventListener("change", onChange);
        return () => mq.removeEventListener("change", onChange);
    }, []);
    return reduced;
}

/** Whether the Christmas decor shows: the Christmas preset with its effects on. */
export function useChristmasDecor(): boolean {
    const preset = useAtomValue(themePresetAtom);
    const effectsOff = useAtomValue(christmasEffectsOffAtom);
    return hasChristmasDecor(preset, effectsOff);
}

/** Whether the snow canvas shows: the decor shows and the Snow switch is on. */
export function useChristmasSnow(): boolean {
    const decorOn = useChristmasDecor();
    const snowOn = useAtomValue(christmasSnowOnAtom);
    return christmasSnowShows(decorOn, snowOn);
}

/** Whether the Christmas motion runs: the decor shows and the OS does not ask for reduced motion. */
export function useChristmasMotion(): boolean {
    const decorOn = useChristmasDecor();
    const reduced = useReducedMotion();
    return christmasMotionOn(decorOn, reduced);
}
