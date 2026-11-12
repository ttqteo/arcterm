// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0
//
// Pure shell-context capabilities. "filter" narrows the surface's collection, "subject" supplies a
// default or describes an explicit target without hiding it, and "unsupported" makes no attribution claim.
// Agent's collection is its sidebar (agentsidebarmodel.ts), which the project narrows; its centre still keeps the
// agent you chose, and says when that agent is in another project (the divergence banner, agentsurface.tsx).

import type { SurfaceKey } from "./agents";

export type ScopeSupport = "filter" | "subject" | "unsupported";

export interface SurfaceContextSupport {
    project: ScopeSupport;
}

export const SURFACE_CONTEXT = {
    cockpit: { project: "filter" },
    jarvis: { project: "subject" },
    agent: { project: "filter" },
    radar: { project: "subject" },
    files: { project: "subject" },
    usage: { project: "unsupported" },
    code: { project: "subject" },
    setup: { project: "unsupported" },
    settings: { project: "unsupported" },
    app: { project: "unsupported" },
} satisfies Record<SurfaceKey, SurfaceContextSupport>;

// Surfaces that open the project when the switcher changes while they show (Code: codefollow.ts), so their
// subject is not kept; the switcher's title says so.
export const FOLLOWS_PROJECT: ReadonlySet<SurfaceKey> = new Set<SurfaceKey>(["code"]);

export function projectControlCopy(
    surface: SurfaceKey,
    projectLabel: string,
    follows = false
): { label: string; title: string } {
    const support = SURFACE_CONTEXT[surface].project;
    if (support === "filter") {
        return { label: projectLabel, title: "Filter this surface by project" };
    }
    if (follows && FOLLOWS_PROJECT.has(surface)) {
        return { label: `Default · ${projectLabel}`, title: "Set the project default; Code opens it" };
    }
    if (support === "subject") {
        return {
            label: `Default · ${projectLabel}`,
            title: "Set the project default; this surface keeps its explicit target",
        };
    }
    return {
        label: `Default · ${projectLabel}`,
        title: "Set the project default; this surface is not project-filtered",
    };
}
