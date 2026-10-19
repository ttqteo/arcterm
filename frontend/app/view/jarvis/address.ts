// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0
//
// Cockpit addresses: the strings a card, citation, palette row, graph node or pet act points at, and the one
// place a string becomes a destination. Go emits the canonical dialect. The legacy strings are read here only
// because persisted conversation turns and effort WorkRefs still carry them. Pure and total: malformed input
// is unsupported, never a throw.

export type OpenTarget =
    | { kind: "channel"; channelId: string; runId?: string }
    | { kind: "run"; runId: string }
    | { kind: "agent"; tabId: string }
    | { kind: "record"; dossierId: string; anchor?: string }
    // view "activity" is the initiative's Activity sheet even while a plan waits to review (openref.ts selectEffort)
    | { kind: "effort"; effortId: string; view?: "activity" }
    | { kind: "radar"; reportId: string; findingId?: string }
    | { kind: "note"; noteId: string }
    | { kind: "canvas"; topic: string; board?: string }
    | { kind: "memhygiene"; project: string };

export type Unsupported = { kind: "unsupported"; message: string };

// what a citation knows beyond its address: the source type, and the sub-object to land on within it. A
// reveal from an agent's terminal also knows which agent asked, and where it was standing.
export type AddressHint = { sourceType?: string; anchor?: string; caller?: { blockId: string; cwd: string } };

export const CANNOT_OPEN = "This item can't be opened";
export const CANNOT_LOCATE_RECORD = "This citation can't locate its record";

const MEMHYGIENE_PREFIX = "memhygiene:";

export function parseAddress(address: string, hint?: AddressHint): OpenTarget | Unsupported {
    // a project name may hold ":", so this kind alone splits at the first one
    if (address?.startsWith(MEMHYGIENE_PREFIX)) {
        const project = address.slice(MEMHYGIENE_PREFIX.length);
        return project !== "" ? { kind: "memhygiene", project } : { kind: "unsupported", message: CANNOT_OPEN };
    }
    const parts = (address ?? "").split(":");
    if (parts.length !== 2 || parts[0] === "" || parts[1] === "") {
        return { kind: "unsupported", message: CANNOT_OPEN };
    }
    const [kind, id] = parts;
    const anchor = hint?.anchor || undefined;
    switch (kind) {
        case "run":
            return { kind: "run", runId: id };
        case "channel":
            return { kind: "channel", channelId: id };
        case "tab":
        case "agent":
            return { kind: "agent", tabId: id };
        case "task":
            return { kind: "record", dossierId: id, anchor };
        // memory: and vault:+memory still arrive from persisted turns and effort WorkRefs
        case "memnote":
        case "memory":
            return { kind: "note", noteId: id };
        case "effort":
            return { kind: "effort", effortId: id };
        case "radarreport":
            return { kind: "radar", reportId: id, findingId: anchor };
        case "vault":
            return parseVaultNode(id, hint?.sourceType);
        case "canvas":
            return parseCanvas(id);
        default:
            return { kind: "unsupported", message: CANNOT_OPEN };
    }
}

// vault:<id> named a node without its collection. The card's source type recovers the collection — except for
// a decision, whose record the card never recorded.
function parseVaultNode(id: string, sourceType: string | undefined): OpenTarget | Unsupported {
    if (sourceType == null || sourceType === "" || sourceType === "dossier") {
        return { kind: "record", dossierId: id };
    }
    if (sourceType === "memory") {
        return { kind: "note", noteId: id };
    }
    if (sourceType === "decision") {
        return { kind: "unsupported", message: CANNOT_LOCATE_RECORD };
    }
    return { kind: "unsupported", message: CANNOT_OPEN };
}

// a design-local topic and board are single path segments; anything that could walk the tree is refused here
const CANVAS_SEGMENT = /^[A-Za-z0-9][A-Za-z0-9._-]*$/;
const BOARD_EXT = ".dc.html";

// exported for the router, which also lands canvas targets built in code rather than parsed here
export function isCanvasSegment(s: string): boolean {
    return CANVAS_SEGMENT.test(s) && !s.includes("..");
}

function parseCanvas(id: string): OpenTarget | Unsupported {
    const [topic, board, ...rest] = id.split("/");
    if (rest.length > 0 || !isCanvasSegment(topic)) {
        return { kind: "unsupported", message: CANNOT_OPEN };
    }
    if (board == null) {
        return { kind: "canvas", topic };
    }
    if (!isCanvasSegment(board)) {
        return { kind: "unsupported", message: CANNOT_OPEN };
    }
    return { kind: "canvas", topic, board: board.endsWith(BOARD_EXT) ? board : board + BOARD_EXT };
}
