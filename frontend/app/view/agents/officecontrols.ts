// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0
//
// The Office's controls, a Game Boy's: the arrows, ↵ as A and Esc as B, with m opening the office menu as START does
// (canvas .superpowers/design/office-controls), plus the lift's PageUp / PageDown and g to carry a room (canvas
// .superpowers/design/office-floors). Pure: what a key does over the layer that is up, the office menu's items, how the
// ▶ steps, and which edge the dialog box takes. No React, no Wave runtime imports.

import type { Dir } from "./officeboss";
import { newFloor, stepSlot, type Placements, type RoomPlace } from "./officelayout";

/** What is up over the office: nothing (the boss walks), the desk's dialog box, the desk's full card, or a room the boss
 *  carries (g), which takes every key until it is dropped or put back. */
export type OfficeLayer = "walk" | "dialog" | "card" | "carry";

export type OfficeKeyAction =
    | { do: "walk"; dir: Dir }
    | { do: "move"; delta: -1 | 1 }
    | { do: "tab"; delta: -1 | 1 }
    | { do: "activate" }
    | { do: "talk" }
    | { do: "card" }
    | { do: "sound" }
    | { do: "back" }
    | { do: "menu" }
    | { do: "desk"; delta: -1 | 1 }
    | { do: "nextAsk" }
    | { do: "floor"; delta: -1 | 1 }
    | { do: "grab" }
    | { do: "slot"; dir: Dir }
    | { do: "drop" }
    | { do: "cancel" }
    | { do: "none" }
    | { do: "pass" };

export interface KeyMods {
    meta?: boolean;
    ctrl?: boolean;
    alt?: boolean;
}

const ARROWS: Record<string, Dir> = { ArrowUp: "up", ArrowDown: "down", ArrowLeft: "left", ArrowRight: "right" };

/** Pure: what a key does in the office. A chord (Cmd, Ctrl or Alt held) is never the office's; then a carried room
 *  takes every key (arrows to a neighbouring slot, PageUp / PageDown to another floor, ↵ drops, Esc and g put it back,
 *  nothing else acts); then the open menu takes every key; then the layer decides. "pass" leaves the key to the
 *  Cockpit's own (1–9, t, r, b, Space, and Enter on the full card). */
export function officeKey(layer: OfficeLayer, menuOpen: boolean, key: string, mods: KeyMods = {}): OfficeKeyAction {
    if (mods.meta || mods.ctrl || mods.alt) {
        return { do: "pass" };
    }
    const dir = ARROWS[key];
    if (layer === "carry") {
        if (dir) {
            return { do: "slot", dir };
        }
        if (key === "PageUp" || key === "PageDown") {
            return { do: "floor", delta: key === "PageUp" ? 1 : -1 };
        }
        if (key === "Enter") {
            return { do: "drop" };
        }
        return key === "Escape" || key === "g" ? { do: "cancel" } : { do: "none" };
    }
    if (menuOpen) {
        if (dir === "up" || dir === "down") {
            return { do: "move", delta: dir === "up" ? -1 : 1 };
        }
        if (key === "Enter") {
            return { do: "activate" };
        }
        if (key === "Escape" || key === "m") {
            return { do: "menu" };
        }
        return { do: "none" };
    }
    if (key === "Escape") {
        return { do: "back" };
    }
    if (key === "m") {
        return { do: "menu" };
    }
    if (key === "j" || key === "k") {
        return { do: "desk", delta: key === "j" ? 1 : -1 };
    }
    if (key === "n") {
        return { do: "nextAsk" };
    }
    if (key === "f") {
        return { do: "card" };
    }
    if (key === "s") {
        return { do: "sound" };
    }
    if (key === "h" || key === "l") {
        return { do: "tab", delta: key === "h" ? -1 : 1 };
    }
    // the lift and carrying a room belong to the walking boss: no ride while a box or the card is up
    if (layer === "walk") {
        if (key === "PageUp" || key === "PageDown") {
            return { do: "floor", delta: key === "PageUp" ? 1 : -1 };
        }
        if (key === "g") {
            return { do: "grab" };
        }
    }
    if (layer === "dialog") {
        if (dir === "up" || dir === "down") {
            return { do: "move", delta: dir === "up" ? -1 : 1 };
        }
        if (dir) {
            return { do: "tab", delta: dir === "left" ? -1 : 1 };
        }
        return key === "Enter" ? { do: "activate" } : { do: "pass" };
    }
    if (dir) {
        return { do: "walk", dir };
    }
    return key === "Enter" && layer === "walk" ? { do: "talk" } : { do: "pass" };
}

/** Pure: one step back, as B does: the full card goes back to the dialog box, the dialog box to walking, and a carried
 *  room is put down and the boss walks on. */
export function backFrom(layer: OfficeLayer): OfficeLayer {
    return layer === "card" ? "dialog" : "walk";
}

/** Pure: the layer the keys act on. The dialog layer with no box drawn at the boss's desk (a HUD chip filtered the
 *  desk out, the agent left, the boss is still walking to a clicked desk) is walking; the keys never act on a box that
 *  is not drawn. */
export function boxLayer(layer: OfficeLayer, boxShown: boolean): OfficeLayer {
    return layer === "dialog" && !boxShown ? "walk" : layer;
}

/** Pure: the ▶ moved one step, over the items it cannot rest on; at either end it stays put. */
export function stepSel(sel: number, delta: -1 | 1, enabled: readonly boolean[]): number {
    for (let i = sel + delta; i >= 0 && i < enabled.length; i += delta) {
        if (enabled[i]) {
            return i;
        }
    }
    return sel;
}

/** Pure: where the ▶ starts: the first item it can rest on, 0 when there is none. */
export function firstSel(enabled: readonly boolean[]): number {
    const i = enabled.indexOf(true);
    return i < 0 ? 0 : i;
}

/** The HUD bar's space at the head of the office's view: 10 px from the top, 46 px tall, and a 10 px gap under it. A
 *  dialog box at the head starts under it. */
export const HUD_SPACE_PX = 66;
/** A dialog box at the foot stands this far above the view's bottom. */
export const DIALOG_FOOT_PX = 12;
/** The plate on the box's top edge stands this far over it. */
export const DIALOG_PLATE_PX = 15;
/** The dialog box's full height: its 262 px inside, a 2 px border and a 2 px gap each side (officedialog.tsx). */
export const DIALOG_MAX_PX = 270;

/** Pure: which edge of the office's view the dialog box takes, so it never hides the desk it talks about: the foot
 *  while the boss stands clear above a box there, else the head while it stands clear below one there; in a view too
 *  short for either, the edge farther from the boss. bossTop and bossBottom are the boss's sprite, in px from the
 *  view's top; boxH the box's height, its plate not counted. */
export function dialogEdge(
    bossTop: number,
    bossBottom: number,
    viewH: number,
    boxH: number = DIALOG_MAX_PX
): "top" | "bottom" {
    if (bossBottom <= viewH - DIALOG_FOOT_PX - boxH - DIALOG_PLATE_PX) {
        return "bottom";
    }
    if (bossTop >= HUD_SPACE_PX + boxH) {
        return "top";
    }
    return (bossTop + bossBottom) / 2 > viewH / 2 ? "top" : "bottom";
}

export type OfficeMenuId =
    | "nextAsk"
    | "needsYou"
    | "nextDesk"
    | "prevDesk"
    | "lift"
    | "move"
    | "arrange"
    | "events"
    | "background"
    | "sound"
    | "cards"
    | "keys";

export interface OfficeMenuItem {
    id: OfficeMenuId;
    label: string;
    key?: string;
    // a count beside the label: the desks asking or the notice board's rows (drawn in the asking colour), or the events
    // not yet seen
    count?: string;
    ask?: boolean;
    rule?: boolean;
    // drawn dimmed: the ▶ passes over it and ↵ does nothing
    disabled?: boolean;
}

/** Pure: the office menu (m), START's list. It names each item's own key, so it is where the keys are learnt. `inRoom`
 *  is whether the boss stands in a project room: Move this room picks that room up, so it is disabled anywhere else.
 *  `background` is the agents no room draws (backgrounded ones and detached `claude --bg` sessions): Background shows
 *  them under the office, and is left out while there are none and they are hidden. `muted` is whether the office's
 *  sound is muted: the sound item names what it will do, Mute sound or Sound on. */
export function officeMenuItems(
    asks: number,
    newEvents: number,
    eventsOpen: boolean,
    boardRows: number,
    inRoom: boolean,
    background = 0,
    backgroundOpen = false,
    muted = false
): OfficeMenuItem[] {
    return [
        { id: "nextAsk", label: "Next Needs you", key: "n", count: asks > 0 ? String(asks) : undefined, ask: true },
        {
            id: "needsYou",
            label: "Notice board",
            count: boardRows > 0 ? String(boardRows) : undefined,
            ask: true,
        },
        { id: "nextDesk", label: "Next desk", key: "j" },
        { id: "prevDesk", label: "Previous desk", key: "k" },
        { id: "lift", label: "Lift", key: "PgUp PgDn" },
        { id: "move", label: "Move this room", key: "g", ...(inRoom ? {} : { disabled: true }) },
        { id: "arrange", label: "Arrange automatically" },
        {
            id: "events",
            label: eventsOpen ? "Hide events" : "Events",
            count: !eventsOpen && newEvents > 0 ? `${newEvents} new` : undefined,
            rule: true,
        },
        ...(background > 0 || backgroundOpen
            ? [
                  {
                      id: "background" as const,
                      label: backgroundOpen ? "Hide background" : "Background",
                      count: !backgroundOpen && background > 0 ? String(background) : undefined,
                  },
              ]
            : []),
        { id: "sound", label: muted ? "Sound on" : "Mute sound", key: "s" },
        { id: "cards", label: "Cards view", key: "o" },
        { id: "keys", label: "All keys", key: "?" },
    ];
}

/** The floors a carried room can go to, as the lift's summaries give them. */
export interface CarryFloor {
    floor: number;
    rooms: readonly string[];
}

/** Pure: whether the carried room may build a new floor above the top one: only while the top floor holds another room,
 *  since the room carried alone off its own top floor would only empty it. */
export function canBuildFloor(floors: readonly CarryFloor[], project: string): boolean {
    const top = floors.reduce<CarryFloor | undefined>((t, f) => (t == null || f.floor > t.floor ? f : t), undefined);
    return top != null && top.rooms.some((r) => r !== project);
}

/** Pure: where the carried room's target goes for an arrow (a neighbouring slot of the floor shown; none on a new floor)
 *  or PageUp / PageDown (the next floor that holds a room, in the same slot; past the top, a new floor; and back from a
 *  new floor, the top floor in the slot the room came from). At an end it stays put. */
export function carryTarget(
    target: RoomPlace | "new",
    act: { do: "slot"; dir: Dir } | { do: "floor"; delta: -1 | 1 },
    ctx: { floors: readonly CarryFloor[]; project: string; fromSlot: number }
): RoomPlace | "new" {
    const shown = ctx.floors.map((f) => f.floor).sort((a, b) => a - b);
    if (act.do === "slot") {
        return target === "new" ? target : { floor: target.floor, slot: stepSlot(target.slot, act.dir) };
    }
    if (target === "new") {
        return act.delta < 0 && shown.length > 0 ? { floor: shown[shown.length - 1], slot: ctx.fromSlot } : target;
    }
    const next =
        act.delta > 0 ? shown.find((f) => f > target.floor) : [...shown].reverse().find((f) => f < target.floor);
    if (next != null) {
        return { floor: next, slot: target.slot };
    }
    return act.delta > 0 && canBuildFloor(ctx.floors, ctx.project) ? "new" : target;
}

/** Pure: the place a drop puts the room: its target, or for a new floor the first slot of the floor above the top one. */
export function carryPlace(target: RoomPlace | "new", at: Placements): RoomPlace {
    return target === "new" ? { floor: newFloor(at), slot: 0 } : target;
}
