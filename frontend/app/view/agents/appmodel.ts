// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

// A pinned app's pure model. A pinned app is a tool of yours with a url (tools.json `url`, and `dir` for the folder it
// runs in): opening it runs its command in a terminal of its own, waits for the page to answer, and shows the page in
// place of that terminal (appstore.ts holds the state, AppPane draws it). A page already answering is shown without
// running anything. arcterm embeds only what this machine serves: http on 127.0.0.1 with a port (arctools.AppURL).

import { registeredProjectFor } from "./projectlabel";
import { toolCwd, type ToolCwdContext } from "./toolsmodel";

// how long a started app has to answer before its terminal is shown, with its output, in the page's place
export const APP_START_TIMEOUT_MS = 30_000;
export const APP_PROBE_INTERVAL_MS = 500;

export function isAppTool(tool: Pick<ToolStatus, "url"> | null | undefined): boolean {
    return !!tool?.url;
}

// the frontend's copy of arctools.AppURL, for the add form to say so before saving
export function appUrlOk(raw: string): boolean {
    let u: URL;
    try {
        u = new URL(raw.trim());
    } catch {
        return false;
    }
    return u.protocol === "http:" && u.hostname === "127.0.0.1" && u.port !== "" && !u.username && !u.password;
}

// the add form's line for its Page field: null when it is empty (a plain tool) or one arcterm can show
export function appUrlProblem(raw: string): string | null {
    if (raw.trim() === "" || appUrlOk(raw)) {
        return null;
    }
    return "The page must be on this machine, as http://127.0.0.1:<port>";
}

// host:port, the line the waiting card and the failure name
export function appHost(url: string): string {
    try {
        return new URL(url).host;
    } catch {
        return url;
    }
}

// the folder the app runs in: its own dir when it has one, else where any tool would open
export function appCwd(tool: Pick<ToolStatus, "opensin" | "dir">, ctx: ToolCwdContext): string {
    return tool.dir?.trim() || toolCwd(tool, ctx);
}

// The project an app with a folder of its own is filed under in the tree: the registered project that folder is in,
// else Home, never the project of whatever agent had the focus when it was opened. `home` expands a leading ~.
export function appProjectName(
    dir: string,
    projects: Record<string, { path?: string }>,
    home: string,
    homeName: string
): string {
    const d = dir.trim();
    const full = home && (d === "~" || d.startsWith("~/") || d.startsWith("~\\")) ? home + d.slice(1) : d;
    return registeredProjectFor(full, projects) || homeName;
}

export type AppPhase = "starting" | "open" | "failed";
// what the user picked in the header: the page, or the terminal underneath it (its log)
export type AppView = "page" | "log";

export interface AppState {
    toolId: string;
    url: string;
    phase: AppPhase;
    // arcterm ran the command in this terminal: closing it stops the server. False when the page already answered and
    // the terminal is only a shell in the app's folder, so closing it leaves that server alone.
    owned: boolean;
    startedMs: number;
    view: AppView;
    // bumped by Home: the frame is keyed on it, so it loads the app's own url afresh (the cockpit cannot reload a
    // cross-origin page where it is; Reload asks the host, appstore.ts reloadAppPage)
    reloads: number;
}

// the app frame's name, by which the host finds it to reload it or step its history (pagekeys.rs app_frame_action)
export function appFrameName(tabId: string): string {
    return `arc-app-${tabId}`;
}

// The terminal tab of the pinned app whose frame holds the focus, else null: a cross-origin frame that holds the
// focus is the document's activeElement.
export function focusedAppTab(active: Pick<Element, "tagName" | "getAttribute"> | null): string | null {
    return active?.tagName === "IFRAME" ? active.getAttribute("data-app-frame") : null;
}

export function startingApp(toolId: string, url: string, owned: boolean, now: number): AppState {
    return { toolId, url, phase: "starting", owned, startedMs: now, view: "page", reloads: 0 };
}

// One probe's answer. An answer opens the page; no answer past the timeout fails it and shows the log; an open or
// failed app stays as it is.
export function afterProbe(s: AppState, answered: boolean, now: number): AppState {
    if (s.phase !== "starting") {
        return s;
    }
    if (answered) {
        return { ...s, phase: "open", view: "page" };
    }
    if (now - s.startedMs >= APP_START_TIMEOUT_MS) {
        return { ...s, phase: "failed", view: "log" };
    }
    return s;
}

export type AppShows = "page" | "waiting" | "terminal";

// what takes the terminal's place: the page, the waiting card, or nothing (the terminal shows)
export function appShows(s: AppState | null | undefined): AppShows {
    if (s == null || s.view === "log" || s.phase === "failed") {
        return "terminal";
    }
    return s.phase === "open" ? "page" : "waiting";
}

export function appWaitLine(s: Pick<AppState, "url" | "startedMs">, now: number): string {
    const secs = Math.max(0, Math.floor((now - s.startedMs) / 1000));
    return `Waiting for ${appHost(s.url)} · ${secs} s`;
}

export function appFailLine(s: Pick<AppState, "url" | "owned">): string {
    return s.owned
        ? `Nothing answered on ${appHost(s.url)} after ${APP_START_TIMEOUT_MS / 1000} s`
        : `Nothing answers on ${appHost(s.url)}`;
}

// the header's close button: closing the terminal stops a server arcterm started, and only that one
export function appCloseTitle(name: string, owned: boolean): string {
    return owned ? `Stop ${name}` : `Close ${name} (its server keeps running: arcterm did not start it)`;
}
