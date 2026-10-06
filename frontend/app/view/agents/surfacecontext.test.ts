// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { describe, expect, it } from "vitest";
import type { SurfaceKey } from "./agents";
import { projectControlCopy, SURFACE_CONTEXT } from "./surfacecontext";

const ALL_SURFACES: SurfaceKey[] = [
    "cockpit",
    "jarvis",
    "agent",
    "radar",
    "files",
    "usage",
    "code",
    "settings",
    "setup",
];

describe("surface context capabilities", () => {
    it("classifies every surface", () => {
        expect(Object.keys(SURFACE_CONTEXT).sort()).toEqual([...ALL_SURFACES].sort());
    });

    it("matches the supported project contracts", () => {
        expect(SURFACE_CONTEXT).toEqual({
            cockpit: { project: "filter" },
            jarvis: { project: "subject" },
            agent: { project: "filter" },
            radar: { project: "subject" },
            files: { project: "subject" },
            usage: { project: "unsupported" },
            code: { project: "subject" },
            settings: { project: "unsupported" },
            setup: { project: "unsupported" },
        });
    });

    it("does not describe the project control as a filter on unsupported or explicit-subject surfaces", () => {
        expect(projectControlCopy("cockpit", "waveterm")).toEqual({
            label: "waveterm",
            title: "Filter this surface by project",
        });
        // the Agent surface's sidebar is narrowed by it, so the control names the project plainly there too
        expect(projectControlCopy("agent", "waveterm")).toEqual({
            label: "waveterm",
            title: "Filter this surface by project",
        });
        expect(projectControlCopy("code", "waveterm")).toEqual({
            label: "Default · waveterm",
            title: "Set the project default; this surface keeps its explicit target",
        });
        expect(projectControlCopy("usage", "All projects")).toEqual({
            label: "Default · All projects",
            title: "Set the project default; this surface is not project-filtered",
        });
    });
});
