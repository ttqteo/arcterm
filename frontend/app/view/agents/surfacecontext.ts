// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0
//
// Pure shell-context capabilities. "filter" narrows the surface's collection, "subject" supplies a
// default or describes an explicit target without hiding it, and "unsupported" makes no attribution claim.

import type { SurfaceKey } from "./agents";

export type ScopeSupport = "filter" | "subject" | "unsupported";

export interface SurfaceContextSupport {
    project: ScopeSupport;
    space: ScopeSupport;
}

export const SURFACE_CONTEXT = {
    cockpit: { project: "filter", space: "filter" },
    jarvis: { project: "subject", space: "unsupported" },
    agent: { project: "subject", space: "subject" },
    radar: { project: "subject", space: "unsupported" },
    files: { project: "subject", space: "subject" },
    usage: { project: "unsupported", space: "unsupported" },
    code: { project: "subject", space: "subject" },
    setup: { project: "unsupported", space: "unsupported" },
    settings: { project: "unsupported", space: "unsupported" },
} satisfies Record<SurfaceKey, SurfaceContextSupport>;

export function projectControlCopy(surface: SurfaceKey, projectLabel: string): { label: string; title: string } {
    const support = SURFACE_CONTEXT[surface].project;
    if (support === "filter") {
        return { label: projectLabel, title: "Filter this surface by project" };
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
