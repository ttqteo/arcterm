// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

// A pinned app's pure model. A pinned app is a tool of yours with a page (tools.json `url`, and `dir` for the folder it
// runs in), and wavesrv holds its server as a service (pkg/services): this turns the service's status into what the
// Agent surface shows in its terminal's place, the page or a waiting card (appstore.ts holds the view, AppPane draws
// it). arcterm embeds only what this machine serves: http on 127.0.0.1 with a port (arctools.AppURL).

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

export type AppPhase = "starting" | "open" | "failed";
// what the user picked in the header: the page, or the terminal underneath it (its log)
export type AppView = "page" | "log";

export interface AppState {
    toolId: string;
    url: string;
    phase: AppPhase;
    // arcterm started the server (the service is not `elsewhere`): Stop is offered for it
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

// What a service shows in its terminal's place: running or elsewhere, the page; starting, the waiting card; every other
// state (stopped, sleeping, crashed, retrying, porttaken, nopage) fails, which shows the log: a sleeping service has no
// process, and its frame is dropped like a stopped one's until showing the pane wakes it. `view` and `reloads` are the
// person's picks (Page | Log, Home), kept per tab by appstore.ts.
export function serviceAppState(s: ServiceStatus, view: AppView, reloads: number): AppState {
    const phase: AppPhase =
        s.state === "running" || s.state === "elsewhere" ? "open" : s.state === "starting" ? "starting" : "failed";
    return {
        toolId: s.id,
        url: s.url ?? "",
        phase,
        owned: s.state !== "elsewhere",
        startedMs: s.startedms ?? 0,
        view,
        reloads,
    };
}

export type AppShows = "page" | "waiting" | "terminal";

// what takes the terminal's place: the page, the waiting card, or nothing (the terminal shows)
export function appShows(s: AppState | null | undefined): AppShows {
    if (s == null || s.view === "log" || s.phase === "failed") {
        return "terminal";
    }
    return s.phase === "open" ? "page" : "waiting";
}

// how long an open app's page stays loaded, out of sight, after it was last on screen
export const APP_FRAME_IDLE_MS = 10 * 60_000;

// The apps whose page stays loaded: the one on screen, and each open one seen within the idle limit. A page out of
// sight keeps its place and its scroll; past the limit it is dropped and loads afresh when next shown (its server keeps
// running). In the order of `states`, so a frame already loaded never moves in the DOM, which would reload it.
export function keptAppFrames(
    states: Record<string, Pick<AppState, "phase">>,
    shown: string | null,
    seenMs: Record<string, number>,
    now: number
): string[] {
    return Object.keys(states).filter(
        (id) =>
            states[id].phase === "open" &&
            (id === shown || (seenMs[id] != null && now - seenMs[id] < APP_FRAME_IDLE_MS))
    );
}

export function appWaitLine(s: Pick<AppState, "url" | "startedMs">, now: number): string {
    const secs = s.startedMs > 0 ? Math.max(0, Math.floor((now - s.startedMs) / 1000)) : 0;
    return `Waiting for ${appHost(s.url)} · ${secs} s`;
}
