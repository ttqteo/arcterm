// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0
//
// Which held services are on screen (spec 2026-10-20-services-sleep-design.md): a service whose tab shows on the Agent
// surface, while that surface is the one showing, is on screen; one that stays off screen for ten minutes sleeps, and
// one that comes back on screen starts. Pure: AgentSurface hands over what it already worked out and reports the result
// (servicesstore.ts reportServicesSeen).

export type ShownPanes = {
    surface: string;
    // the centre shows History, a session or a subagent's interior instead of the terminal stack
    centerHidden: boolean;
    // the tab whose page or waiting card covers the stack in the centre, else null
    appTab: string | null;
    // the grid's visible cells (tab ids), the focused one included
    cells: string[];
    // the terminal in the panel under the agent, else null
    docked: string | null;
    dockFolded: boolean;
    // the panel fills the surface and the cells hide under it
    dockMax: boolean;
};

/** The ids of the services on screen, sorted and unique. An app's page or waiting card covers the stack, so it is the
 * one on screen; else every cell shows (none when the panel is maximized) and the panel when it is not folded. A tab
 * that is no service is dropped. */
export function shownServices(p: ShownPanes, byTab: Record<string, ServiceStatus>): string[] {
    if (p.surface !== "agent" || p.centerHidden) {
        return [];
    }
    const tabs: string[] = [];
    if (p.appTab != null) {
        tabs.push(p.appTab);
    } else {
        if (!p.dockMax) {
            tabs.push(...p.cells);
        }
        if (p.docked != null && !p.dockFolded) {
            tabs.push(p.docked);
        }
    }
    const ids = new Set<string>();
    for (const tab of tabs) {
        const s = byTab[tab];
        if (s != null) {
            ids.add(s.id);
        }
    }
    return [...ids].sort();
}
