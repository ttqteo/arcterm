// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { describe, expect, it } from "vitest";
import {
    draftIsDirty,
    draftSeedKey,
    parallelismInvalid,
    runAutonomous,
    runMachine,
    runSettingsDraft,
    runSettingsPanelState,
    settingsChangePayload,
    settingsPayload,
    sheetFace,
} from "./runsettings";

function engineRun(over: Partial<Run> = {}): Run {
    return {
        oid: "r1",
        version: 1,
        id: "r1",
        goal: "ship it",
        runtime: "pi",
        mode: "orchestrator",
        orchestration: "engine",
        status: "executing",
        phases: [],
        workspaceid: "ws",
        projectpath: "/repo",
        createdts: 1,
        meta: {},
        ...over,
    } as Run;
}

function submittedGroup(over: Partial<TaskGroup> = {}): TaskGroup {
    return {
        oid: "d1",
        version: 1,
        id: "d1",
        runid: "r1",
        channelid: "c1",
        parallelism: 2,
        tasks: [{ id: "t-1", state: "pending" }],
        status: "running",
        failures: 0,
        createdts: 1,
        updatedts: 1,
        ...over,
    } as TaskGroup;
}

describe("sheetFace", () => {
    it("states unavailability for a run that is gone", () => {
        expect(sheetFace(undefined).kind).toBe("missing");
        expect(sheetFace(null).kind).toBe("missing");
    });

    // a control that changes nothing is worse than its absence
    it("is read-only for terminal runs", () => {
        for (const status of ["done", "cancelled"]) {
            const face = sheetFace(engineRun({ status }));
            expect(face.kind).toBe("readonly");
        }
    });

    it("is read-only for a run with no engine scheduler", () => {
        expect(sheetFace(engineRun({ mode: "pipeline", orchestration: "" })).kind).toBe("readonly");
        expect(sheetFace(engineRun({ orchestration: "adaptive" })).kind).toBe("readonly");
    });

    it("is editable for a live engine run", () => {
        expect(sheetFace(engineRun())).toEqual({ kind: "editable" });
    });
});

describe("runMachine", () => {
    it("takes a stored orchestration at its word", () => {
        expect(runMachine(engineRun({ orchestration: "engine" }))).toBe("engine");
        expect(runMachine(engineRun({ orchestration: "adaptive" }))).toBe("adaptive");
    });

    // a run launched before slice 5c added the control names no machine; the runtime decided then, and
    // only pi led an engine run. Defaulting these to engine would label a stored adaptive run as the one
    // thing it is not, in the same sheet whose settings panel refuses it for being adaptive.
    it("reads a pre-control run from the runtime that led it", () => {
        expect(runMachine(engineRun({ orchestration: "", runtime: "pi" }))).toBe("engine");
        expect(runMachine(engineRun({ orchestration: "", runtime: "claude" }))).toBe("adaptive");
    });

    it("agrees with the face the same run gets", () => {
        const stored = engineRun({ orchestration: "", runtime: "claude" });
        expect(runMachine(stored)).toBe("adaptive");
        expect(sheetFace(stored)).toEqual({ kind: "readonly", reason: "an adaptive lead runs its own subagents" });
    });
});

describe("runSettingsDraft", () => {
    it("reads the run's own launch form before submission", () => {
        const route = { runtime: "pi" } as RoutePin;
        const run = engineRun({ parallelism: 4, workerroute: route });
        expect(runSettingsDraft(run, null)).toEqual({
            parallelism: 4,
            workerRoute: route,
            reviewerPicks: false,
            reviewerRoute: null,
            autonomous: false,
        });
    });

    // the group, not the run, is what the scheduler will read
    it("prefers the group once a dag exists", () => {
        const route = { runtime: "claude" } as RoutePin;
        const run = engineRun({ parallelism: 4 });
        const group = submittedGroup({ parallelism: 2, workerroute: route });
        expect(runSettingsDraft(run, group)).toEqual({
            parallelism: 2,
            workerRoute: route,
            reviewerPicks: false,
            reviewerRoute: null,
            autonomous: false,
        });
    });

    it("seeds Approvals from the owning group over the run, and from the run before a dag", () => {
        const group = (autonomous: boolean) => submittedGroup({ autonomous });
        expect(runSettingsDraft(engineRun({ autonomous: false }), group(true)).autonomous).toBe(true);
        expect(runSettingsDraft(engineRun({ autonomous: true }), group(false)).autonomous).toBe(false);
        expect(runSettingsDraft(engineRun({ autonomous: true }), null).autonomous).toBe(true);
        expect(runSettingsDraft(engineRun(), null).autonomous).toBe(false);
    });
});

describe("runAutonomous", () => {
    // a child run carries its parent's dag oref; the parent's group says nothing about the child
    it("ignores a group another run owns", () => {
        const child = engineRun({ id: "r2", autonomous: false });
        expect(runAutonomous(child, submittedGroup({ autonomous: true }))).toBe(false);
    });

    it("reads the group alone when the caller has no run", () => {
        expect(runAutonomous(null, submittedGroup({ autonomous: true }))).toBe(true);
        expect(runAutonomous(null, null)).toBe(false);
    });
});

describe("draftIsDirty", () => {
    it("compares the effective values", () => {
        const base = {
            parallelism: 2,
            workerRoute: null,
            reviewerPicks: false,
            reviewerRoute: null,
            autonomous: false,
        };
        expect(draftIsDirty(base, { ...base })).toBe(false);
        expect(draftIsDirty(base, { ...base, parallelism: 3 })).toBe(true);
        expect(draftIsDirty(base, { ...base, workerRoute: { runtime: "pi" } as RoutePin })).toBe(true);
        expect(draftIsDirty(base, { ...base, autonomous: true })).toBe(true);
    });
});

describe("settingsPayload", () => {
    it("sends only the mutable settings, addressed to the run", () => {
        const draft = {
            parallelism: 3,
            workerRoute: { runtime: "pi" } as RoutePin,
            reviewerPicks: false,
            reviewerRoute: null,
            autonomous: false,
        };
        expect(settingsPayload("c1", "r1", draft, { ...draft, parallelism: 2 })).toEqual({
            channelid: "c1",
            runid: "r1",
            parallelism: 3,
            workerroute: { runtime: "pi" },
            reviewerpicks: false,
        });
    });

    it("sends the width only when the draft changes it", () => {
        const saved = {
            parallelism: 0,
            workerRoute: null,
            reviewerPicks: false,
            reviewerRoute: null,
            autonomous: false,
        };
        // a stored 0 means no width yet: the server refuses 0, so an Approvals-only save must leave it out
        const approvalsOnly = settingsPayload("c1", "r1", { ...saved, autonomous: true }, saved);
        expect(approvalsOnly).not.toHaveProperty("parallelism");
        expect(approvalsOnly.autonomous).toBe(true);
        expect(settingsPayload("c1", "r1", { ...saved, parallelism: 4 }, saved).parallelism).toBe(4);
    });

    it("sends Approvals only when the draft changes it", () => {
        const draft = {
            parallelism: 3,
            workerRoute: null,
            reviewerPicks: false,
            reviewerRoute: null,
            autonomous: true,
        };
        const off = { ...draft, autonomous: false };
        expect(settingsPayload("c1", "r1", draft, off).autonomous).toBe(true);
        expect(settingsPayload("c1", "r1", off, draft).autonomous).toBe(false);
        // a save about the other dials never writes back a value the palette may since have flipped
        expect(settingsPayload("c1", "r1", draft, draft)).not.toHaveProperty("autonomous");
    });
});

describe("settingsChangePayload and Approvals", () => {
    it("sends Approvals only when the change sets it", () => {
        const group = submittedGroup({ autonomous: true });
        expect(settingsChangePayload("c1", "r1", null, group, { parallelism: 4 })).not.toHaveProperty("autonomous");
        expect(settingsChangePayload("c1", "r1", null, group, { autonomous: false }).autonomous).toBe(false);
        expect(settingsChangePayload("c1", "r1", engineRun(), null, { autonomous: true }).autonomous).toBe(true);
    });

    it("sends the width only when the change sets it", () => {
        // the palette toggle over a run stored with no width yet: a 0 here would make the server refuse the save
        const palette = settingsChangePayload("c1", "r1", engineRun({ parallelism: 0 }), null, { autonomous: true });
        expect(palette).not.toHaveProperty("parallelism");
        expect(palette.autonomous).toBe(true);
        // the lead card's width control
        expect(settingsChangePayload("c1", "r1", null, submittedGroup(), { parallelism: 3 }).parallelism).toBe(3);
    });
});

describe("parallelismInvalid", () => {
    it("accepts 1 through the engine ceiling", () => {
        expect(parallelismInvalid(1)).toBe(false);
        expect(parallelismInvalid(8)).toBe(false);
    });

    it("rejects everything else, including a blank field", () => {
        expect(parallelismInvalid(0)).toBe(true);
        expect(parallelismInvalid(9)).toBe(true);
        expect(parallelismInvalid(2.5)).toBe(true);
        expect(parallelismInvalid(Number.NaN)).toBe(true);
    });
});

describe("runSettingsPanelState", () => {
    // a run that links a dag has mutable settings, but not from the launch snapshot: until the group
    // arrives the sheet cannot know what the scheduler is running at.
    it("waits while a linked group is being read", () => {
        expect(runSettingsPanelState(engineRun({ dagoref: "d1" }), null, "loading")).toEqual({ kind: "loading" });
    });

    // a failed read used to be classified as loading forever, which left the panel counting on a group
    // that would never arrive instead of saying so.
    it("states unavailability when the linked group could not be read", () => {
        expect(runSettingsPanelState(engineRun({ dagoref: "d1" }), null, "error")).toEqual({
            kind: "unavailable",
            reason: "error",
        });
    });

    it("states unavailability when the linked group is gone", () => {
        expect(runSettingsPanelState(engineRun({ dagoref: "d1" }), null, "missing")).toEqual({
            kind: "unavailable",
            reason: "missing",
        });
    });

    it("is editable once the linked group is here", () => {
        expect(runSettingsPanelState(engineRun({ dagoref: "d1" }), submittedGroup(), "ready")).toEqual({
            kind: "editable",
        });
    });

    it("treats a run with no dag as pre-submission, not as loading", () => {
        expect(runSettingsPanelState(engineRun(), null, "ready")).toEqual({ kind: "editable" });
    });

    it("still states unavailability for a missing run", () => {
        expect(runSettingsPanelState(null, null, "loading")).toEqual({ kind: "missing" });
    });
});

// The key the sheet re-seeds its draft on. It has to move for every mutable setting and stay put for
// everything else, or a live status tick wipes what the user typed.
describe("draftSeedKey", () => {
    it("changes on a route-only group update", () => {
        const linked = engineRun({ dagoref: "d1" });
        const before = draftSeedKey(linked, submittedGroup());
        const after = draftSeedKey(linked, submittedGroup({ workerroute: { runtime: "pi" } as RoutePin }));
        expect(after).not.toBe(before);
    });

    it("changes when Approvals flips, before a dag and after", () => {
        const linked = engineRun({ dagoref: "d1" });
        expect(draftSeedKey(linked, submittedGroup({ autonomous: true }))).not.toBe(
            draftSeedKey(linked, submittedGroup())
        );
        expect(draftSeedKey(engineRun({ autonomous: true }), null)).not.toBe(draftSeedKey(engineRun(), null));
    });

    it("changes on a pre-dag width or worker route", () => {
        const base = draftSeedKey(engineRun(), null);
        expect(draftSeedKey(engineRun({ parallelism: 6 }), null)).not.toBe(base);
        expect(draftSeedKey(engineRun({ workerroute: { runtime: "pi" } as RoutePin }), null)).not.toBe(
            base
        );
    });

    it("ignores an update that leaves the effective settings alone", () => {
        const run = engineRun({ dagoref: "d1" });
        expect(draftSeedKey(run, submittedGroup({ status: "executing" }))).toBe(
            draftSeedKey(run, submittedGroup({ status: "done" }))
        );
    });
});
