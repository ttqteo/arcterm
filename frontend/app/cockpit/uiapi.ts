// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

// The decisions behind the cockpit UI API (wsh ui): what a worker is told is selected and available, what it
// may run, and when the user is too busy to be interrupted. Pure, so it tests without the store; uiclient.ts
// reads the atoms and acts.

import type { CommandItem } from "@/app/cockpit/palette-commands";
import { SURFACE_ORDER, type SurfaceKey } from "@/app/view/agents/agents";
import { parseAddress } from "@/app/view/jarvis/address";

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
    radarReportId: string | undefined;
}

// addresses in the openref dialect, so anything reported here can be handed straight back to reveal
export function selectionFor(surface: SurfaceKey, s: SelectionSnapshot): string[] {
    switch (surface) {
        case "agent":
            return s.focusId ? [`agent:${s.focusId}`] : [];
        case "jarvis":
            return jarvisSelection(s);
        case "radar":
            return s.radarReportId ? [`radarreport:${s.radarReportId}`] : [];
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

// null = not a surface address; the shared router (openAddress) owns every other kind. Conversation History is a mode of the
// Agent surface rather than a surface, so its address names the Agent surface and the mode; "sessions" is the old name of
// the surface it replaced, kept so a worker following an old instruction still lands somewhere sensible.
export function parseSurfaceAddress(
    address: string
): { surface: SurfaceKey; center?: "history" } | { error: string } | null {
    if (!address.startsWith(SURFACE_PREFIX)) {
        return null;
    }
    const key = address.slice(SURFACE_PREFIX.length);
    if (key === "history" || key === "sessions") {
        return { surface: "agent", center: "history" };
    }
    if (!SURFACES.includes(key as SurfaceKey)) {
        return { error: `unknown surface "${key}"; one of ${[...SURFACES, "history"].join(", ")}` };
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

// the busy wait keeps a reveal from moving the view under the user's hands. An agent's canvas reveal moves
// nothing, it only attaches the canvas to that agent, so it lands at once; without a caller it jumps to the
// canvas's agent and waits like any other move.
export function revealWaitsForUser(address: string, callerBlockId: string | undefined): boolean {
    return !(callerBlockId && parseAddress(address).kind === "canvas");
}

// An agent's canvas reveal says so in a toast once. Arc's own hook reveals on every board the agent writes, and
// a toast for each would bury the first, so a reveal of the topic the caller already has attached says nothing:
// the row's canvas tag shows there is something new.
export function revealLeavesTrail(address: string, attachedTopic: string | undefined): boolean {
    const target = parseAddress(address);
    return !(target.kind === "canvas" && target.topic === attachedTopic);
}

export function callerName(roster: readonly { blockId?: string; name: string }[], blockId: string | undefined): string {
    if (!blockId) {
        return UNKNOWN_CALLER;
    }
    return roster.find((a) => a.blockId === blockId)?.name ?? UNKNOWN_CALLER;
}
