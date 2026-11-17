// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0
//
// Which of Sidecar's two layouts the window shows, and what the S and pin buttons ask of the host (spec
// 2026-11-13-sidecar-design.md, section 1a; spec 2026-11-17-sidecar-orbit-dashboard-design.md): the width that splits the
// full window (P, "wall") from the small form (Q), and the two buttons' changes. Pure; the page and the title bar use it.

import type { SidecarForm } from "./sidecartypes";

/** From this window width (CSS px) the full window (P) shows; narrower, the small form (Q). */
export const SMALL_BREAK_PX = 1100;
/** A window this close to its screen's whole width (CSS px) fills it: maximized or full screen. */
export const FILL_SLACK_PX = 16;

export type SidecarLayout = "wall" | "small";

/**
 * The layout for a window `width` CSS px wide on a screen `screenWidth` CSS px wide (its available width; unknown:
 * width alone). No hysteresis: a drag across the line just switches. A window that fills its screen shows the wall
 * whatever its width: a 1920 px screen at 175% is 1097 CSS px, and a maximized or full-screen Sidecar there is the wall
 * the person put on that screen, not the small form.
 */
export function layoutFor(width: number, screenWidth?: number): SidecarLayout {
    if (width >= SMALL_BREAK_PX) {
        return "wall";
    }
    const fills = screenWidth != null && screenWidth > 0 && width >= screenWidth - FILL_SLACK_PX;
    return fills ? "wall" : "small";
}

/** What the page asks of the host's `sidecar_form`; a field left out changes nothing. */
export interface FormChange {
    small?: boolean;
    pinned?: boolean;
}

/** The S button: the other form (the host shrinks and pins, or puts the frame back and unpins). */
export function smallButtonChange(form: SidecarForm): FormChange {
    return { small: !form.small };
}

/** The pin button: the pin alone, whichever form the window is in. */
export function pinButtonChange(form: SidecarForm): FormChange {
    return { pinned: !form.pinned };
}
