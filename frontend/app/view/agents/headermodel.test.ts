// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { describe, expect, it } from "vitest";
import {
    foldsIntoMore,
    headerLayout,
    headerWidth,
    initiativeTitle,
    initiativeTitleShown,
    modelShown,
    nextHeaderLabels,
    runLink,
    runMenuSections,
    unlinkedText,
} from "./headermodel";

const RUN = "094a3c28-1111-2222-3333-444455556666";
const OTHER = "7f3e91aa-1111-2222-3333-444455556666";

describe("headerWidth", () => {
    it("reads wide, narrow and very narrow from the header's width", () => {
        expect(headerWidth(1280)).toBe("wide");
        expect(headerWidth(720)).toBe("wide");
        expect(headerWidth(719)).toBe("narrow");
        expect(headerWidth(560)).toBe("narrow");
        expect(headerWidth(479)).toBe("tiny");
        expect(headerWidth(460)).toBe("tiny");
    });

    it("reads a header not laid out yet as wide", () => {
        expect(headerWidth(0)).toBe("wide");
    });
});

describe("nextHeaderLabels", () => {
    const shown = { shown: true, need: null };

    it("keeps the words while everything fits, a sub-pixel overflow included", () => {
        expect(nextHeaderLabels(shown, 900, 0)).toEqual(shown);
        expect(nextHeaderLabels(shown, 900, 0.4)).toEqual(shown);
    });

    it("drops to icons once the left side runs under the buttons, and remembers the width the words need", () => {
        expect(nextHeaderLabels(shown, 760, 42)).toEqual({ shown: false, need: 802 });
    });

    it("stays on icons until the header is as wide as the words need, a pixel to spare", () => {
        const icons = { shown: false, need: 802 };
        // whatever still overflows with the icons does not move the width the words need
        expect(nextHeaderLabels(icons, 760, 10)).toEqual(icons);
        expect(nextHeaderLabels(icons, 802, 0)).toEqual(icons);
        expect(nextHeaderLabels(icons, 803, 0)).toEqual(shown);
    });

    it("ignores a header not laid out yet", () => {
        expect(nextHeaderLabels(shown, 0, 50)).toEqual(shown);
    });
});

describe("initiativeTitle", () => {
    it("is the title alone, with no ◇ of its own (the header draws the icon)", () => {
        expect(initiativeTitle("some ai title", { title: "Curve trading" })).toBe("Curve trading");
    });

    it("says initiative when the title is the agent's name or not loaded", () => {
        expect(initiativeTitle("Curve trading", { title: "Curve trading" })).toBe("initiative");
        expect(initiativeTitle("x", undefined)).toBe("initiative");
    });
});

describe("the narrow levels' strings", () => {
    it("keeps the name's share and narrows the cluster gap", () => {
        expect(headerLayout("wide")).toEqual({ nameMax: undefined, clusterGap: 18 });
        expect(headerLayout("narrow")).toEqual({ nameMax: "42%", clusterGap: 10 });
        expect(headerLayout("tiny")).toEqual({ nameMax: "34%", clusterGap: 10 });
    });

    it("shows the model's family below wide", () => {
        expect(modelShown("opus 4.5", "wide")).toBe("opus 4.5");
        expect(modelShown("opus 4.5", "narrow")).toBe("opus");
        expect(modelShown("sonnet", "tiny")).toBe("sonnet");
    });

    it("drops the unlinked word below wide and the initiative title at very narrow", () => {
        expect(unlinkedText("wide")).toBe("initiative");
        expect(unlinkedText("narrow")).toBe("");
        expect(initiativeTitleShown("narrow")).toBe(true);
        expect(initiativeTitleShown("tiny")).toBe(false);
    });

    it("folds Split, Float and Fullscreen into More below wide", () => {
        expect(foldsIntoMore("wide")).toBe(false);
        expect(foldsIntoMore("narrow")).toBe(true);
        expect(foldsIntoMore("tiny")).toBe(true);
    });
});

describe("runLink", () => {
    it("is null for a session with no run", () => {
        expect(runLink({ started: [] })).toBeNull();
    });

    it("points a worker at its lead, and says so when the lead is not open", () => {
        expect(runLink({ lineage: { kind: "worker", leadName: "Schedule runs" }, started: [] })).toMatchObject({
            icon: "up",
            text: "Schedule runs",
            short: "lead",
            click: { kind: "lead" },
        });
        expect(runLink({ lineage: { kind: "stage", runTitle: "Ship it" }, started: [] })).toMatchObject({
            text: "Ship it",
            click: { kind: "none" },
        });
        expect(runLink({ lineage: { kind: "worker" }, started: [] })?.text).toBe("no lead");
    });

    it("shows a lead's own run id, even when it started runs, and opens the menu", () => {
        const link = runLink({ ownRunId: RUN, started: [{ oid: OTHER, status: "running" }] });
        expect(link).toMatchObject({
            icon: "workflow",
            text: "run 094a3c28",
            short: "094a3c28",
            mono: true,
            click: { kind: "menu" },
        });
    });

    it("opens the one run a plain session started", () => {
        expect(runLink({ started: [{ oid: RUN, goal: "Fix it", status: "running" }] })).toMatchObject({
            text: "run 094a3c28",
            short: "094a3c28",
            mono: true,
            click: { kind: "open", runId: RUN },
        });
    });

    it("counts several started runs and the active ones, and opens the menu", () => {
        const runs = [
            { oid: RUN, status: "running" },
            { oid: OTHER, status: "done" },
        ];
        expect(runLink({ started: runs })).toMatchObject({
            text: "2 runs · 1 active",
            short: "2",
            mono: false,
            click: { kind: "menu" },
        });
        expect(runLink({ started: runs.map((r) => ({ ...r, status: "done" })) })?.text).toBe("2 runs");
    });
});

describe("runMenuSections", () => {
    it("lists this run, the session it came from and the runs started, in that order", () => {
        const sections = runMenuSections(
            { oid: RUN, goal: "Schedule runs\nmore", status: "running" },
            { kind: "live", tabId: "tab-1", name: "Pull history" },
            [
                { oid: OTHER, goal: "Second", status: "running" },
                { oid: RUN, goal: "Schedule runs", status: "running" },
            ]
        );
        expect(sections.map((s) => s.head)).toEqual(["This run", "Started from", "Started runs"]);
        expect(sections[0].rows[0]).toEqual({
            label: "run 094a3c28 · Schedule runs",
            meta: "running",
            target: { kind: "run", runId: RUN },
        });
        expect(sections[1].rows[0]).toMatchObject({ label: "Pull history", meta: "session" });
        // its own run is not listed again among the ones it started
        expect(sections[2].rows.map((r) => r.label)).toEqual(["Second"]);
    });

    it("says a closed session without a way to it, and leaves empty sections out", () => {
        const sections = runMenuSections(null, { kind: "gone" }, []);
        expect(sections).toEqual([
            { head: "Started from", rows: [{ label: "a closed session", meta: "closed", target: null }] },
        ]);
        expect(runMenuSections(null, null, [])).toEqual([]);
    });
});
