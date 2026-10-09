// frontend/app/view/code/codescroll.ts
// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

// Pure: where a rendered document (a markdown or TeX Preview) was scrolled to, so leaving the file or the surface and
// coming back lands where the reader left it. The Source editor keeps its own through Monaco's view state
// (codeviewer.tsx); a preview is plain DOM and unmounts with the surface, so its offset is kept here, keyed by view
// mode and absolute path.

import { remember } from "./codeeditorcache";

const KEPT_SCROLLS = 50;

const scrolls = new Map<string, number>();

export function scrollKey(mode: string, abs: string): string {
    return `${mode}:${abs}`;
}

export function keepScroll(key: string, top: number): void {
    remember(scrolls, key, top, KEPT_SCROLLS);
}

export function keptScroll(key: string): number | null {
    return scrolls.get(key) ?? null;
}

// a document renders over a few frames (images, math, diagrams), so an offset is restored only once the document is
// tall enough to hold it; until then the caller tries again next frame
export function applyScroll(
    el: { scrollTop: number; scrollHeight: number; clientHeight: number },
    top: number
): boolean {
    if (el.scrollHeight - el.clientHeight < top) {
        return false;
    }
    el.scrollTop = top;
    return true;
}

export function clearKeptScrolls(): void {
    scrolls.clear();
}
