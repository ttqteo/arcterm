// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0
//
// Pinned apps on the nav rail (spec 2026-10-20-rail-apps-design.md): which held services sit under Radar, what the rail
// item's dot and title say, which service the app surface shows, and the words of its card. Pure: the store keeps the
// pins in localStorage, wavesrv owns the service state. `nowMs` is a parameter, as in servicesmodel.ts.

import { canRestart, serviceHeaderLine, serviceRowWords } from "./servicesmodel";

export const RAIL_APP_MAX = 3;
export const RAIL_FULL_TITLE = "The rail holds 3 apps: unpin one first";

/** The pinned ids out of localStorage; anything that is not a JSON array of strings reads as no pins. */
export function parseRailPins(raw: string | null): string[] {
    if (!raw) {
        return [];
    }
    try {
        const v = JSON.parse(raw);
        return Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : [];
    } catch {
        return [];
    }
}

/** The pinned services that still exist, in pin order, at most three. A gone pin holds no place. */
export function railPins(pins: string[], services: ServiceStatus[]): ServiceStatus[] {
    const shown: ServiceStatus[] = [];
    const seen = new Set<string>();
    for (const id of pins) {
        if (shown.length >= RAIL_APP_MAX) {
            break;
        }
        const s = services.find((x) => x.id === id);
        if (s && !seen.has(id)) {
            seen.add(id);
            shown.push(s);
        }
    }
    return shown;
}

export function railFull(pins: string[], services: ServiceStatus[]): boolean {
    return railPins(pins, services).length >= RAIL_APP_MAX;
}

/** The pins after pinning (`on`) or unpinning `id`. Starts from the shown ids, so gone ones and those past three drop. */
export function withRailPin(pins: string[], id: string, on: boolean, services: ServiceStatus[]): string[] {
    const ids = railPins(pins, services).map((s) => s.id);
    if (!on) {
        return ids.filter((x) => x !== id);
    }
    if (ids.includes(id) || ids.length >= RAIL_APP_MAX) {
        return ids;
    }
    return [...ids, id];
}

/** The pins after moving `id` one place up (-1) or down (1); unchanged at an end or when `id` is not shown. */
export function movedRailPin(pins: string[], id: string, by: -1 | 1, services: ServiceStatus[]): string[] {
    const ids = railPins(pins, services).map((s) => s.id);
    const at = ids.indexOf(id);
    const to = at + by;
    if (at < 0 || to < 0 || to >= ids.length) {
        return ids;
    }
    [ids[at], ids[to]] = [ids[to], ids[at]];
    return ids;
}

/** The rail item's dot: red for a crash, amber for a service that cannot show its page, none for a calm one. */
export function railDot(s: ServiceStatus): "error" | "warning" | null {
    switch (s.state) {
        case "retrying":
        case "crashed":
            return "error";
        case "porttaken":
        case "nopage":
            return "warning";
        default:
            return null;
    }
}

/** The rail item's tooltip: the name and what its row says, the port when the row says nothing. */
export function railItemTitle(s: ServiceStatus, nowMs: number): string {
    const w = serviceRowWords(s, nowMs);
    return `${s.name}: ${w.words || w.port || ""}`;
}

/** The pinned service the app surface shows; null for no id, an unpinned id or a service that is gone. */
export function appSurfaceService(id: string | null, pins: string[], services: ServiceStatus[]): ServiceStatus | null {
    if (id == null) {
        return null;
    }
    return railPins(pins, services).find((s) => s.id === id) ?? null;
}

export type AppSurfaceBody = "page" | "waiting" | "card";

export function appSurfaceBody(s: ServiceStatus): AppSurfaceBody {
    switch (s.state) {
        case "running":
        case "elsewhere":
            return "page";
        case "retrying":
        case "crashed":
        case "porttaken":
        case "nopage":
            return "card";
        default:
            // starting, sleeping, and a state this does not know: showing the app starts it, so there is no stopped card
            return "waiting";
    }
}

/** The waiting card's title: Starting <name>, or, for a sleeping app, <name> is asleep: after a Stop with the app on
 *  screen nothing starts it until it is shown again or its header's Start is pressed, so the card must not say Starting. */
export function appWaitTitle(s: ServiceStatus): string {
    return s.state === "starting" ? `Starting ${s.name}` : `${s.name} is asleep`;
}

export type AppCard = { title: string; line: string; action: "restart" | "start" };

/** The card the app surface draws in place of the page when the service has none to show. */
export function appCard(s: ServiceStatus, nowMs: number): AppCard {
    const action = canRestart(s) ? "restart" : "start";
    switch (s.state) {
        case "crashed":
            return {
                title: `${s.name} stopped after 5 crashes`,
                line: `It last exited with code ${s.exitcode ?? 0}. Its log in Agent shows why.`,
                action,
            };
        case "retrying": {
            const secs = Math.max(0, Math.ceil(((s.retryatms ?? 0) - nowMs) / 1000));
            return {
                title: `${s.name} crashed`,
                line: `It starts again in ${secs} s. Its log in Agent shows why.`,
                action,
            };
        }
        case "porttaken":
            return {
                title: `${s.name} can't start`,
                line: `${s.port ?? ""} is held by ${s.holder || "another program"}.`,
                action,
            };
        case "nopage":
            return {
                title: `${s.name} shows no page`,
                line: "It is running, but nothing answered after 30 s.",
                action,
            };
        default:
            // no state that appSurfaceBody sends here gets this: a total fallback, not a stopped card
            return { title: `${s.name} is ${s.state}`, line: serviceHeaderLine(s, nowMs), action };
    }
}
