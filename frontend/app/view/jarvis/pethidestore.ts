// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0
//
// Jarvis hidden for a while (pethide.ts): jarvis:hiddenuntil is a setting, so a restart keeps it hidden and every window
// reads one value. jarvisHiddenAtom is the one thing the views read (PetView, the Office's boss, the startup loader,
// the palette). The clock is no atom, so useJarvisHideTimer (mounted once, in PetView) ticks hideClockAtom when the
// hide ends, and Jarvis comes back then without a reload; a new value of the setting arms it again.

import { getSettingsKeyAtom } from "@/app/store/global";
import { globalStore } from "@/app/store/jotaiStore";
import { writeConfig } from "@/app/view/agents/settingsui";
import { atom, useAtomValue } from "jotai";
import { useEffect } from "react";
import { hideEndsInMs, jarvisHidden } from "./pethide";
import { petBubbleAtom, petUnreadAtom } from "./petstore";

const hiddenUntilAtom = () => getSettingsKeyAtom("jarvis:hiddenuntil");

// bumped when a hide's time is up, so jarvisHiddenAtom reads the clock again then
const hideClockAtom = atom(0);

export const jarvisHiddenAtom = atom((get) => {
    get(hideClockAtom);
    return jarvisHidden(get(hiddenUntilAtom()), Date.now());
});

/** Arms the timer that shows Jarvis again when its hide ends. Mounted once (PetView, in cockpit-root). */
export function useJarvisHideTimer(): void {
    const until = useAtomValue(hiddenUntilAtom());
    useEffect(() => {
        let timer: ReturnType<typeof setTimeout> | undefined;
        const arm = () => {
            const ms = hideEndsInMs(until, Date.now());
            if (ms == null) {
                globalStore.set(hideClockAtom, (n) => n + 1);
                return;
            }
            // a wait that ends a moment early, or a far end waited out in parts, finds time left and arms again
            timer = setTimeout(arm, ms);
        };
        arm();
        return () => clearTimeout(timer);
    }, [until]);
}

/** Hide Jarvis until then. What it was saying goes, and so does its unread mark, the way opening the peek clears them,
 *  so nothing comes back hours later for news long since dealt with. An open peek stays open. */
export function hideJarvis(until: number): void {
    globalStore.set(petBubbleAtom, null);
    globalStore.set(petUnreadAtom, false);
    writeConfig({ "jarvis:hiddenuntil": until });
}

/** Show Jarvis now (the palette's Show Jarvis). */
export function showJarvis(): void {
    writeConfig({ "jarvis:hiddenuntil": 0 });
}
