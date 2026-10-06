// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { describe, expect, it } from "vitest";
import {
    draftIsDirty,
    draftSeedKey,
    runSettingsDraft,
    settingsChangePayload,
    settingsPayload,
    withWorkers,
    type RunSettingsDraft,
} from "./runsettings";
import { configLine } from "./runsheetmodel";

const WORKER = { runtime: "pi", model: "gpt" } as RoutePin;
const REVIEWER = { runtime: "claude", model: "opus" } as RoutePin;

function engineRun(over: Partial<Run> = {}): Run {
    return {
        oid: "r1",
        version: 1,
        id: "r1",
        goal: "ship it",
        runtime: "claude",
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

function group(over: Partial<TaskGroup> = {}): TaskGroup {
    return {
        oid: "d1",
        version: 1,
        id: "d1",
        runid: "r1",
        channelid: "c1",
        parallelism: 2,
        tasks: [],
        status: "running",
        failures: 0,
        createdts: 1,
        updatedts: 1,
        ...over,
    } as TaskGroup;
}

const DRAFT: RunSettingsDraft = { parallelism: 3, workerRoute: null, reviewerPicks: false, reviewerRoute: null };

describe("settingsPayload for each workers choice", () => {
    it("sends Same as lead as no route and reviewerpicks false", () => {
        expect(settingsPayload("c1", "r1", withWorkers(DRAFT, null))).toEqual({
            channelid: "c1",
            runid: "r1",
            parallelism: 3,
            reviewerpicks: false,
        });
    });

    it("sends a route and clears Reviewer picks", () => {
        const draft = withWorkers({ ...DRAFT, reviewerPicks: true }, WORKER);
        expect(settingsPayload("c1", "r1", draft)).toEqual({
            channelid: "c1",
            runid: "r1",
            parallelism: 3,
            workerroute: WORKER,
            reviewerpicks: false,
        });
    });

    it("sends Reviewer picks with no route", () => {
        const draft = withWorkers({ ...DRAFT, workerRoute: WORKER }, "picks");
        expect(settingsPayload("c1", "r1", draft)).toEqual({
            channelid: "c1",
            runid: "r1",
            parallelism: 3,
            reviewerpicks: true,
        });
    });

    it("carries the reviewer route beside the workers setting", () => {
        expect(settingsPayload("c1", "r1", { ...DRAFT, reviewerPicks: true, reviewerRoute: REVIEWER })).toEqual({
            channelid: "c1",
            runid: "r1",
            parallelism: 3,
            reviewerpicks: true,
            reviewerroute: REVIEWER,
        });
    });
});

// SetRunSettings applies every field, so the lead card's width control must resend the rest as they stand
describe("settingsChangePayload", () => {
    it("keeps the group's worker route and reviewer route once a dag exists", () => {
        const g = group({ workerroute: WORKER, reviewerroute: REVIEWER });
        expect(settingsChangePayload("c1", "r1", null, g, { parallelism: 5 })).toEqual({
            channelid: "c1",
            runid: "r1",
            parallelism: 5,
            workerroute: WORKER,
            reviewerpicks: false,
            reviewerroute: REVIEWER,
        });
    });

    it("keeps the group's Reviewer picks, not the run's launch snapshot", () => {
        const run = engineRun({ workerroute: WORKER, parallelism: 4 });
        expect(settingsChangePayload("c1", "r1", run, group({ reviewerpicks: true }), { parallelism: 1 })).toEqual({
            channelid: "c1",
            runid: "r1",
            parallelism: 1,
            reviewerpicks: true,
        });
    });

    it("reads the run before a dag exists", () => {
        const run = engineRun({ parallelism: 4, reviewerpicks: true, reviewerroute: REVIEWER });
        expect(settingsChangePayload("c1", "r1", run, null, { parallelism: 6 })).toEqual({
            channelid: "c1",
            runid: "r1",
            parallelism: 6,
            reviewerpicks: true,
            reviewerroute: REVIEWER,
        });
        const routed = engineRun({ parallelism: 4, workerroute: WORKER });
        expect(settingsChangePayload("c1", "r1", routed, null, { parallelism: 2 }).workerroute).toEqual(WORKER);
    });
});

describe("the reviewer settings in the sheet's draft", () => {
    it("seeds from the group once a dag exists, else from the run", () => {
        expect(runSettingsDraft(engineRun(), group({ reviewerpicks: true, reviewerroute: REVIEWER }))).toEqual({
            parallelism: 2,
            workerRoute: null,
            reviewerPicks: true,
            reviewerRoute: REVIEWER,
        });
        expect(runSettingsDraft(engineRun({ reviewerroute: REVIEWER }), null)).toEqual({
            parallelism: 0,
            workerRoute: null,
            reviewerPicks: false,
            reviewerRoute: REVIEWER,
        });
    });

    it("is dirty and re-seeds on a picks or reviewer route change", () => {
        expect(draftIsDirty(DRAFT, { ...DRAFT, reviewerPicks: true })).toBe(true);
        expect(draftIsDirty(DRAFT, { ...DRAFT, reviewerRoute: REVIEWER })).toBe(true);
        expect(draftIsDirty(DRAFT, { ...DRAFT })).toBe(false);
        const run = engineRun({ dagoref: "d1" });
        const base = draftSeedKey(run, group());
        expect(draftSeedKey(run, group({ reviewerpicks: true }))).not.toBe(base);
        expect(draftSeedKey(run, group({ reviewerroute: REVIEWER }))).not.toBe(base);
    });

    it("prints Reviewer picks and a set reviewer route on the config line", () => {
        const line = configLine(engineRun(), { ...DRAFT, reviewerPicks: true, reviewerRoute: REVIEWER }, false);
        expect(line).toContain("workers reviewer picks");
        expect(line).toContain("reviewers claude · opus");
        expect(configLine(engineRun(), DRAFT, false)).not.toContain("reviewers");
    });
});
