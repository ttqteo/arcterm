// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0
//
// While the float is folded into Sprout, the window is see-through and larger than what it draws. Fifteen times a
// second this asks where the cursor is: over a drawn element ([data-mini-hit]) the window takes the cursor, anywhere
// else it lets it through to the app behind. A window ignoring the cursor gets no mouseenter, so this is also what
// knows Sprout is hovered.

import { globalStore } from "@/app/store/jotaiStore";
import { cursorPosition, getCurrentWindow } from "@tauri-apps/api/window";
import { atom, type PrimitiveAtom } from "jotai";
import { hitAny, toPagePoint } from "./minihit";

const POLL_MS = 1000 / 15;
// the hover chip stays this long after the cursor leaves Sprout, so the cursor can travel to its button
const HOVER_LEAVE_MS = 200;

export const miniHoverAtom = atom(false) as PrimitiveAtom<boolean>;

let timer: ReturnType<typeof setInterval> | null = null;

function boxes(selector: string): DOMRect[] {
    return Array.from(document.querySelectorAll(selector), (el) => el.getBoundingClientRect());
}

export function startClickThrough(): void {
    if (timer != null) {
        return;
    }
    const win = getCurrentWindow();
    let ignoring: boolean | null = null;
    let inFlight = false;
    let leftAt = 0;
    timer = setInterval(async () => {
        if (inFlight) {
            return;
        }
        inFlight = true;
        try {
            const [cursor, inner, scale] = await Promise.all([
                cursorPosition(),
                win.innerPosition(),
                win.scaleFactor(),
            ]);
            const p = toPagePoint(cursor, inner, scale);
            const ignore = !hitAny(p, boxes("[data-mini-hit]"));
            if (ignore !== ignoring) {
                ignoring = ignore;
                await win.setIgnoreCursorEvents(ignore);
            }
            const onSprout = hitAny(p, boxes('[data-mini-hit="sprout"], [data-mini-hit="chip"]'));
            if (onSprout) {
                leftAt = 0;
                if (!globalStore.get(miniHoverAtom)) {
                    globalStore.set(miniHoverAtom, true);
                }
            } else if (globalStore.get(miniHoverAtom)) {
                leftAt ||= Date.now();
                if (Date.now() - leftAt >= HOVER_LEAVE_MS) {
                    leftAt = 0;
                    globalStore.set(miniHoverAtom, false);
                }
            }
        } catch (e) {
            console.error("the folded float's cursor poll failed", e);
        } finally {
            inFlight = false;
        }
    }, POLL_MS);
}

export function stopClickThrough(): void {
    if (timer != null) {
        clearInterval(timer);
        timer = null;
    }
    globalStore.set(miniHoverAtom, false);
}
