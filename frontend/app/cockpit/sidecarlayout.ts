// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0
//
// Which of Sidecar's two layouts the window shows, and the small form's own rules (spec 2026-11-13-sidecar-design.md,
// section 1a; board F-small-asks): the width that splits the wall from the small form, the asks the small form lists,
// what its keys do, and what the S and pin buttons ask of the host. Pure; sidecarsmall.tsx and the title bar draw it.

import type { SidecarForm, SidecarSnapshot, SidecarTile } from "./sidecartypes";
import { answerAct, moveSelection, wallKey } from "./sidecarwallmodel";

/** From this window width (CSS px) the wall shows; narrower, the small form. */
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

/**
 * The small form's cards: the asking tiles, oldest ask first (smallest `since`). The snapshot already lists them longest
 * blocked first, so this keeps that order; a tile with no `since` cannot be placed by age and goes last. A stable sort,
 * so equal ages keep the snapshot's order.
 */
export function smallAsks(snap: Pick<SidecarSnapshot, "tiles">): SidecarTile[] {
    return snap.tiles
        .filter((t) => t.state === "asking")
        .sort((x, y) => (x.since ?? Infinity) - (y.since ?? Infinity) || 0);
}

export type SmallKeyAction =
    | { kind: "select"; index: number }
    | { kind: "open"; id: string }
    | { kind: "answer"; id: string; option: number; key: string };

/**
 * What a key does on the small form, with the card at index `selected` selected (-1: none). Arrow up and down move
 * through the cards and stop at the ends; Enter opens the selected agent in the main window; 1-9 answers the selected
 * card's ask when it takes that option. Left and right, and every other key, are not its own (null).
 */
export function smallKey(key: string, cards: readonly SidecarTile[], selected: number): SmallKeyAction | null {
    const action = wallKey(key);
    if (action == null || cards.length === 0) {
        return null;
    }
    if (action.kind === "move") {
        if (action.key !== "ArrowUp" && action.key !== "ArrowDown") {
            return null;
        }
        // one column: a row is a card
        return { kind: "select", index: selected < 0 ? 0 : moveSelection(selected, action.key, 1, cards.length) };
    }
    const card = cards[selected];
    if (card == null) {
        return null;
    }
    if (action.kind === "open") {
        return { kind: "open", id: card.id };
    }
    return answerAct(card, action.option);
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
