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

    it("matches the supported project and Space contracts", () => {
        expect(SURFACE_CONTEXT).toEqual({
            cockpit: { project: "filter", space: "filter" },
            jarvis: { project: "subject", space: "unsupported" },
            agent: { project: "subject", space: "subject" },
            radar: { project: "subject", space: "unsupported" },
            files: { project: "subject", space: "subject" },
            usage: { project: "unsupported", space: "unsupported" },
            code: { project: "subject", space: "subject" },
            settings: { project: "unsupported", space: "unsupported" },
            setup: { project: "unsupported", space: "unsupported" },
        });
    });

    it("does not describe the project control as a filter on unsupported or explicit-subject surfaces", () => {
        expect(projectControlCopy("cockpit", "waveterm")).toEqual({
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
