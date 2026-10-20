// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { describe, expect, it } from "vitest";
import { shownServices, type ShownPanes } from "./serviceseen";

function svc(id: string, tabid: string): ServiceStatus {
    return {
        id,
        name: id,
        command: "npm run dev",
        dir: "~/proj",
        project: "proj",
        state: "running",
        autostart: false,
        tabid,
    };
}

// tabs t-docs and t-api are services; t-agent and t-shell are not
const byTab: Record<string, ServiceStatus> = {
    "t-docs": svc("docs", "t-docs"),
    "t-api": svc("api", "t-api"),
};

const panes = (over: Partial<ShownPanes> = {}): ShownPanes => ({
    surface: "agent",
    centerHidden: false,
    appTab: null,
    cells: [],
    docked: null,
    dockFolded: false,
    dockMax: false,
    ...over,
});

describe("shownServices", () => {
    it("gives the focused service tab in the centre", () => {
        expect(shownServices(panes({ appTab: "t-docs" }), byTab)).toEqual(["docs"]);
    });

    it("gives the page's tab alone, though cells and the panel sit behind it", () => {
        expect(shownServices(panes({ appTab: "t-docs", cells: ["t-agent", "t-api"], docked: "t-api" }), byTab)).toEqual(
            ["docs"]
        );
    });

    it("gives every service in the cells and the unfolded panel, dropping tabs that are no service", () => {
        const p = panes({ cells: ["t-agent", "t-docs"], docked: "t-api" });
        expect(shownServices(p, byTab)).toEqual(["api", "docs"]);
        expect(shownServices(panes({ cells: ["t-agent", "t-shell"], docked: "t-shell" }), byTab)).toEqual([]);
    });

    it("a service in an unfocused grid cell is on screen", () => {
        expect(shownServices(panes({ cells: ["t-agent", "t-docs", "t-shell"] }), byTab)).toEqual(["docs"]);
    });

    it("a folded panel is off screen", () => {
        expect(shownServices(panes({ cells: ["t-agent"], docked: "t-api", dockFolded: true }), byTab)).toEqual([]);
        expect(shownServices(panes({ cells: ["t-docs"], docked: "t-api", dockFolded: true }), byTab)).toEqual(["docs"]);
    });

    it("dockMax shows only the panel", () => {
        expect(shownServices(panes({ cells: ["t-docs"], docked: "t-api", dockMax: true }), byTab)).toEqual(["api"]);
    });

    it("History in the centre counts as off screen", () => {
        const p = panes({ centerHidden: true, appTab: "t-docs", cells: ["t-docs"], docked: "t-api" });
        expect(shownServices(p, byTab)).toEqual([]);
    });

    it("another surface counts as off screen", () => {
        expect(shownServices(panes({ surface: "cockpit", cells: ["t-docs"], appTab: "t-api" }), byTab)).toEqual([]);
    });

    it("is sorted and unique", () => {
        expect(shownServices(panes({ cells: ["t-docs", "t-api", "t-docs"], docked: "t-api" }), byTab)).toEqual([
            "api",
            "docs",
        ]);
    });
});
