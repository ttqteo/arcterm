// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0
//
// While folded into Sprout, the window is see-through and larger than what it draws. Fifteen times a
// second this asks where the cursor is: over a drawn element ([data-mini-hit]) the window takes the cursor, anywhere
// else it lets it through to the app behind. A window ignoring the cursor gets no mouseenter, so this is also what
// knows Sprout is hovered: once the cursor rests on it (minihit.ts nextHover).

import { globalStore } from "@/app/store/jotaiStore";
import { isMacOS } from "@/util/platformutil";
import { cursorPosition, getCurrentWindow, primaryMonitor } from "@tauri-apps/api/window";
import { atom, type PrimitiveAtom } from "jotai";
import { HOVER_DISMISSED, HOVER_NONE, hitAny, nextHover, toPagePoint, type HoverState } from "./minihit";

const POLL_MS = 1000 / 15;

export const miniHoverAtom = atom(false) as PrimitiveAtom<boolean>;

let timer: ReturnType<typeof setInterval> | null = null;
// bumped by every stop: a tick still awaiting the cursor when the fold ends must not set the window deaf again
let generation = 0;
let hover: HoverState = HOVER_NONE;

function boxes(selector: string): DOMRect[] {
    return Array.from(document.querySelectorAll(selector), (el) => el.getBoundingClientRect());
}

export function startClickThrough(): void {
    if (timer != null) {
        return;
    }
    const win = getCurrentWindow();
    const mac = isMacOS();
    const gen = ++generation;
    let ignoring: boolean | null = null;
    let inFlight = false;
    hover = HOVER_NONE;
    timer = setInterval(async () => {
        if (inFlight) {
            return;
        }
        inFlight = true;
        try {
            const [cursor, inner, scale, primary] = await Promise.all([
                cursorPosition(),
                win.innerPosition(),
                win.scaleFactor(),
                // macOS reports the cursor in the primary monitor's scale (minihit.ts toPagePoint)
                mac ? primaryMonitor() : Promise.resolve(null),
            ]);
            if (gen !== generation) {
                return;
            }
            const p = toPagePoint(cursor, inner, { cursor: primary?.scaleFactor ?? scale, window: scale }, mac);
            const ignore = !hitAny(p, boxes("[data-mini-hit]"));
            if (ignore !== ignoring) {
                ignoring = ignore;
                await win.setIgnoreCursorEvents(ignore);
            }
            // the card opens on a cursor resting on Sprout, and stays while the cursor travels to it
            const over = hitAny(p, boxes('[data-mini-hit="sprout"], [data-mini-hit="agents"]'));
            hover = nextHover(hover, over, Date.now());
            if (globalStore.get(miniHoverAtom) !== hover.shown) {
                globalStore.set(miniHoverAtom, hover.shown);
            }
        } catch (e) {
            console.error("the folded float's cursor poll failed", e);
        } finally {
            inFlight = false;
        }
    }, POLL_MS);
}

// A click on Sprout closed the card (sprout-mini.tsx): the cursor resting on it must not open it again at once.
export function dismissMiniHover(): void {
    hover = HOVER_DISMISSED;
    globalStore.set(miniHoverAtom, false);
}

export function stopClickThrough(): void {
    generation++;
    if (timer != null) {
        clearInterval(timer);
        timer = null;
    }
    globalStore.set(miniHoverAtom, false);
}
