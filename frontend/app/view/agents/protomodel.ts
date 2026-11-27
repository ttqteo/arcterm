// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

// Pure: what a clickable prototype's board tells Arc (its screen, its variant slots) and what Arc tells it back (the
// picks), and the context a mark keeps (docs/superpowers/specs/2026-11-27-prototype-feedback-design.md). The board side
// is the script wavesrv appends to every board page (pkg/canvasserve/boardscript.js).

// board -> Arc: the screen showing and every slot with the letter it shows
export const PROTO_REPORT_MSG = "arc-canvas-proto";
// Arc -> board: the whole map of picks, slot id -> letter
export const SLOT_PICK_MSG = "arc-canvas-slot-pick";

// set on a board's frame while Arc captures it: every overlay inside the frame hides (HIDE_WHILE_CAPTURING)
export const CAPTURE_ATTR = "data-canvas-capturing";
// the class an Arc overlay inside a board frame wears (a chip, a mark, a draft box, the mark layer's outline). Written
// out in full: Tailwind finds a class by its text. invisible, not hidden, so no overlay's box moves while it is gone
export const HIDE_WHILE_CAPTURING = "in-data-[canvas-capturing]:invisible";

export type ProtoSlot = {
    id: string;
    label: string;
    // the variants' letters in the board's order, A first
    letters: string[];
    // the letter the board says it shows; read it through shownLetter
    picked: string;
    // the slot's first visible element, in the board's page CSS px
    rect: { x: number; y: number; w: number; h: number };
};

export type ProtoReport = { screen: string | null; slots: ProtoSlot[] };

export type SlotPicks = Readonly<Record<string, string>>;

export type MarkContext = {
    screen: string | null;
    slots: { id: string; label: string; letter: string }[];
};

function isRecord(v: unknown): v is Record<string, unknown> {
    return typeof v === "object" && v !== null && !Array.isArray(v);
}

function hasOwn(o: object, key: string): boolean {
    return Object.prototype.hasOwnProperty.call(o, key);
}

function slotOf(v: unknown): ProtoSlot | null {
    if (!isRecord(v) || typeof v.id !== "string" || v.id === "" || typeof v.picked !== "string") {
        return null;
    }
    const { letters, rect } = v;
    if (!Array.isArray(letters) || letters.length === 0 || !letters.every((l) => typeof l === "string" && l !== "")) {
        return null;
    }
    if (!isRecord(rect)) {
        return null;
    }
    const { x, y, w, h } = rect;
    if (
        ![x, y, w, h].every((n) => typeof n === "number" && Number.isFinite(n)) ||
        (w as number) < 0 ||
        (h as number) < 0
    ) {
        return null;
    }
    return {
        id: v.id,
        label: typeof v.label === "string" && v.label !== "" ? v.label : v.id,
        letters: [...(letters as string[])],
        picked: v.picked,
        rect: { x: x as number, y: y as number, w: w as number, h: h as number },
    };
}

// null for anything that is not a proto report; a slot that is malformed is left out of an otherwise good report
export function protoReport(data: unknown): ProtoReport | null {
    if (!isRecord(data) || data.type !== PROTO_REPORT_MSG || !Array.isArray(data.slots)) {
        return null;
    }
    const slots: ProtoSlot[] = [];
    for (const raw of data.slots) {
        const s = slotOf(raw);
        if (s != null) {
            slots.push(s);
        }
    }
    return { screen: typeof data.screen === "string" && data.screen !== "" ? data.screen : null, slots };
}

export function slotPickMessage(picks: SlotPicks): { type: typeof SLOT_PICK_MSG; picks: Record<string, string> } {
    return { type: SLOT_PICK_MSG, picks: { ...picks } };
}

// What the board shows in a slot. The stored pick never leads: a chip's pressed letter follows the board's report, so a
// click that did not reach the board (it reloaded, or the slot lacks that letter) does not light the wrong letter
export function shownLetter(slot: Pick<ProtoSlot, "letters" | "picked">): string {
    return slot.letters.includes(slot.picked) ? slot.picked : (slot.letters[0] ?? "");
}

// True when a stored pick that a reported slot could show is not what that slot shows (the board reloaded and lost
// it), so the frame sends the picks again. A pick the slot lacks is not one: the board keeps its default for it
export function picksToResend(report: ProtoReport | null, picks: SlotPicks): boolean {
    if (report == null) {
        return false;
    }
    return report.slots.some(
        (s) => hasOwn(picks, s.id) && s.letters.includes(picks[s.id]) && picks[s.id] !== shownLetter(s)
    );
}

export function markContext(report: ProtoReport | null): MarkContext {
    if (report == null) {
        return { screen: null, slots: [] };
    }
    return {
        screen: report.screen,
        slots: report.slots.map((s) => ({ id: s.id, label: s.label, letter: shownLetter(s) })),
    };
}

// two contexts are the same place when they name the same screen and the same letter in each slot, however the board
// ordered or labeled its slots
export function contextKey(ctx: MarkContext): string {
    const slots = ctx.slots.map((s) => [s.id, s.letter]).sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0));
    return JSON.stringify([ctx.screen, slots]);
}

// what the handoff line says about where a mark was drawn: screen "Để sau", slot danh sách = B
export function contextPhrase(ctx: MarkContext): string {
    const parts: string[] = [];
    if (ctx.screen != null) {
        parts.push(`screen ${JSON.stringify(ctx.screen)}`);
    }
    for (const s of ctx.slots) {
        parts.push(`slot ${s.label || s.id} = ${s.letter}`);
    }
    return parts.join(", ");
}

// the header's short form: Để sau · danh sách B
export function protoReadout(report: ProtoReport | null): string {
    const ctx = markContext(report);
    const parts: string[] = [];
    if (ctx.screen != null) {
        parts.push(ctx.screen);
    }
    for (const s of ctx.slots) {
        parts.push(`${s.label || s.id} ${s.letter}`);
    }
    return parts.join(" · ");
}

// where a board's picks are kept: its URL without the query and the hash (the cache-busting ?v= changes on every edit,
// the serve token is stable per folder), so the gallery and an agent's pane share them
export function boardPicksKey(src: string): string {
    return src.replace(/[?#][\s\S]*$/, "");
}
