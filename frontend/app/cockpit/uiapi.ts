// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

// The decisions behind the cockpit UI API (wsh ui): what a worker is told is selected and available, what it
// may run, and when the user is too busy to be interrupted. Pure, so it tests without the store; uiclient.ts
// reads the atoms and acts.

import type { CommandItem } from "@/app/cockpit/palette-commands";
import { SURFACE_ORDER, type SurfaceKey } from "@/app/view/agents/agents";
import { parseAddress } from "@/app/view/jarvis/address";
import type { LibraryTab } from "@/app/view/library/librarystore";
import { sameRepoPath } from "@/util/paths";

// mirrors wshutil.RouteId_Cockpit
export const COCKPIT_ROUTE_ID = "cockpit";

// a keystroke this recent means the user is mid-thought; moving the view now would move it under their hands
export const USER_IDLE_MS = 1500;
export const BUSY_POLL_MS = 200;
// below the wsh caller's 15s timeout with room for a landing's own loads after the wait
export const BUSY_WAIT_MS = 4000;

export const BUSY_ERROR = "the user is busy (typing or in a dialog); retry shortly";
export const AWAITING_CONFIRMATION = "waiting on the user's confirmation";

const UNKNOWN_CALLER = "An agent";
const SURFACE_PREFIX = "surface:";

// setup and settings sit outside the rail order but are still somewhere a worker can send the user
const SURFACES: readonly SurfaceKey[] = [...SURFACE_ORDER, "setup", "settings"];

export interface SelectionSnapshot {
    focusId: string | undefined;
    subject: { kind: string; id: string } | null;
    activeRunIds: Record<string, string | undefined>; // by channel id
    peekRecordId: string | null;
}

// addresses in the openref dialect, so anything reported here can be handed straight back to reveal
export function selectionFor(surface: SurfaceKey, s: SelectionSnapshot): string[] {
    switch (surface) {
        case "agent":
            return s.focusId ? [`agent:${s.focusId}`] : [];
        case "jarvis":
            return jarvisSelection(s);
        default:
            return [];
    }
}

// briefing subjects have no address, so they are not reported
function jarvisSelection(s: SelectionSnapshot): string[] {
    const out: string[] = [];
    const subject = s.subject;
    if (subject?.kind === "channel") {
        out.push(`channel:${subject.id}`);
        const runId = s.activeRunIds[subject.id];
        if (runId) {
            out.push(`run:${runId}`);
        }
    } else if (subject?.kind === "effort") {
        out.push(`effort:${subject.id}`);
    } else if (subject?.kind === "dossier") {
        out.push(`task:${subject.id}`);
    }
    const peek = s.peekRecordId ? `task:${s.peekRecordId}` : null;
    if (peek != null && !out.includes(peek)) {
        out.push(peek);
    }
    return out;
}

export function toUiActions(items: CommandItem[]): UiAction[] {
    return items.map((i) => ({
        id: i.key,
        label: i.title,
        group: i.group,
        ...(i.destructive ? { destructive: true } : {}),
    }));
}

// one message whether the id is misspelled, another surface's, hidden, or guarded off right now: the worker's
// next move is the same in every case
export function resolveAction(
    items: CommandItem[],
    id: string,
    surface: SurfaceKey
): { item: CommandItem } | { error: string } {
    const item = items.find((i) => i.key === id);
    if (item == null) {
        return { error: `"${id}" is not an available action on ${surface} right now; see wsh ui actions` };
    }
    return { item };
}

// Conversation History, the Canvas gallery and Councils are tabs of the Library surface rather than surfaces, so their
// addresses name Library and the tab; "sessions" is the old name of the surface History replaced, kept (and left out of the
// error's list) so a worker following an old instruction still lands somewhere sensible.
const LIBRARY_TAB_ADDRESSES: ReadonlyMap<string, LibraryTab> = new Map<string, LibraryTab>([
    ["history", "conversations"],
    ["sessions", "conversations"],
    ["canvases", "canvases"],
    ["councils", "councils"],
]);
const LIBRARY_TAB_NAMES = ["history", "canvases", "councils"];

// null = not a surface address; the shared router (openAddress) owns every other kind. `surface:library` is a surface like any
// other (it opens on the tab it was left on); a name in LIBRARY_TAB_ADDRESSES opens Library on that tab.
export function parseSurfaceAddress(
    address: string
): { surface: SurfaceKey; tab?: LibraryTab } | { error: string } | null {
    if (!address.startsWith(SURFACE_PREFIX)) {
        return null;
    }
    const key = address.slice(SURFACE_PREFIX.length);
    const tab = LIBRARY_TAB_ADDRESSES.get(key);
    if (tab != null) {
        return { surface: "library", tab };
    }
    if (!SURFACES.includes(key as SurfaceKey)) {
        return { error: `unknown surface "${key}"; one of ${[...SURFACES, ...LIBRARY_TAB_NAMES].join(", ")}` };
    }
    return { surface: key as SurfaceKey };
}

// the router's messages are written for a toast at the user; these two need rewording for the worker
export function revealError(address: string, reason: string, message: string): string {
    if (reason === "superseded") {
        return "superseded by a newer navigation";
    }
    if (reason === "unsupported") {
        return `unsupported address "${address}"; see wsh ui reveal --help`;
    }
    return message;
}

export function isBusy(now: number, lastKeyTs: number, modalOpen: boolean): boolean {
    return modalOpen || now - lastKeyTs < USER_IDLE_MS;
}

export interface IdleDeps {
    now: () => number;
    lastKeyTs: () => number;
    modalOpen: () => boolean;
    sleep: (ms: number) => Promise<void>;
}

// true once the user is idle; false if they stayed busy for BUSY_WAIT_MS
export async function waitUntilIdle(deps: IdleDeps): Promise<boolean> {
    const deadline = deps.now() + BUSY_WAIT_MS;
    while (isBusy(deps.now(), deps.lastKeyTs(), deps.modalOpen())) {
        if (deps.now() >= deadline) {
            return false;
        }
        await deps.sleep(BUSY_POLL_MS);
    }
    return true;
}

// the busy wait keeps a reveal from moving the view under the user's hands. An agent's canvas or brainstorm
// reveal moves nothing, it only attaches it to that agent, so it lands at once; without a caller it jumps to the
// agent that has it and waits like any other move.
export function revealWaitsForUser(address: string, callerBlockId: string | undefined): boolean {
    const kind = parseAddress(address).kind;
    return !(callerBlockId && (kind === "canvas" || kind === "brainstorm"));
}

// An agent's canvas or brainstorm reveal says so in a toast once. arcterm's own hook reveals on every write, and a
// toast for each would bury the first, so a reveal of the topic the caller already has attached says nothing:
// the row's tag shows there is something new.
export function revealLeavesTrail(address: string, attached: { canvas?: string; brainstorm?: string }): boolean {
    const target = parseAddress(address);
    if (target.kind === "canvas") {
        return target.topic !== attached.canvas;
    }
    if (target.kind === "brainstorm") {
        return target.topic !== attached.brainstorm;
    }
    return true;
}

export function callerName(roster: readonly { blockId?: string; name: string }[], blockId: string | undefined): string {
    if (!blockId) {
        return UNKNOWN_CALLER;
    }
    return roster.find((a) => a.blockId === blockId)?.name ?? UNKNOWN_CALLER;
}

export type BrainstormCloseVerdict =
    | { kind: "close"; topic: string; message: string }
    | { kind: "none"; message: string }
    | { kind: "error"; message: string };

// `wsh brainstorm close <file>` closes the brainstorm the caller has attached, and only that one: a path naming another
// is a mistake to report, not a different brainstorm to close. With none attached there is nothing to do, which is no
// failure: the agent may be closing one the user already closed from the header.
export function brainstormCloseVerdict(
    attached: { topic: string; path: string } | null,
    file: string
): BrainstormCloseVerdict {
    if (attached == null) {
        return { kind: "none", message: "No brainstorm is open in this agent; nothing to close." };
    }
    if (!sameRepoPath(attached.path, file)) {
        return { kind: "error", message: `This agent has ${attached.path} open, not ${file}` };
    }
    return {
        kind: "close",
        topic: attached.topic,
        message: `Closed the brainstorm ${attached.topic}. The file stays; writing it again reopens the pane.`,
    };
}
