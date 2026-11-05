// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { describe, expect, it } from "vitest";
import { runMenuChoices } from "./runmenumodel";

const IDLE = { pausing: false, resuming: false };
const keys = (run: Parameters<typeof runMenuChoices>[0], inFlight = IDLE) =>
    runMenuChoices(run, inFlight).map((c) => c.key);

describe("runMenuChoices", () => {
    it("holds only Pause for a run that is working", () => {
        expect(keys({ status: "executing" })).toEqual(["pause"]);
        expect(keys({ status: "planning" })).toEqual(["pause"]);
        expect(keys({ status: "blocked" })).toEqual(["pause"]);
    });
    it("holds only Resume for a paused run", () => {
        expect(keys({ status: "paused" })).toEqual(["resume"]);
    });
    it("holds nothing for a finished run, which then draws no menu", () => {
        expect(keys({ status: "done" })).toEqual([]);
        expect(keys({ status: "cancelled" })).toEqual([]);
    });
    it("holds nothing for a run a lead or the engine started, which is never paused alone", () => {
        expect(keys({ status: "executing", parentleadoref: "tab:1" })).toEqual([]);
        expect(keys({ status: "executing", taskid: "t-1" })).toEqual([]);
        expect(keys({ status: "executing", stagerole: "final" })).toEqual([]);
    });
    it("words and turns off the item whose call is in flight", () => {
        expect(runMenuChoices({ status: "executing" }, { pausing: true, resuming: false })[0]).toMatchObject({
            label: "Pausing…",
            enabled: false,
        });
        expect(runMenuChoices({ status: "paused" }, { pausing: false, resuming: true })[0]).toMatchObject({
            label: "Resuming…",
            enabled: false,
        });
        expect(runMenuChoices({ status: "paused" }, IDLE)[0]).toMatchObject({ label: "Resume", enabled: true });
    });
});
