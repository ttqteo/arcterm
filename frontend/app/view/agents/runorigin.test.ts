// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { describe, expect, it } from "vitest";
import { runOrigin } from "./runorigin";

describe("runOrigin", () => {
    const roster = [
        { id: "tab-a", name: "fix the job queue" },
        { id: "tab-b", name: "loom" },
    ];
    const ended = {
        id: "s-1",
        runtime: "claude",
        task: "plan the float window",
        transcriptpath: "/t/s-1.jsonl",
    } as SessionActivity;

    it("is nothing for a run started from the cockpit", () => {
        expect(runOrigin({}, roster, [ended])).toBeNull();
        expect(runOrigin(undefined, roster, [ended])).toBeNull();
    });

    it("names the live session that started the run", () => {
        expect(runOrigin({ origintabid: "tab-a", origintranscript: "/t/x.jsonl" }, roster, null)).toEqual({
            kind: "live",
            tabId: "tab-a",
            name: "fix the job queue",
        });
    });

    // its tab is gone, but Conversation History still has the session by its transcript
    it("finds an ended session by its transcript", () => {
        expect(runOrigin({ origintabid: "tab-gone", origintranscript: "/t/s-1.jsonl" }, roster, [ended])).toEqual({
            kind: "ended",
            name: "plan the float window",
            sel: "claude:s-1",
        });
    });

    it("lands an ended run session on its run, with it in view", () => {
        const lead = { ...ended, runid: "r-9", role: "lead" } as SessionActivity;
        expect(runOrigin({ origintabid: "tab-gone", origintranscript: "/t/s-1.jsonl" }, roster, [lead])).toEqual({
            kind: "ended",
            name: "plan the float window",
            sel: "run:r-9",
            member: "lead",
        });
    });

    it("calls an ended session with no task untitled", () => {
        const untitled = { ...ended, task: "" } as SessionActivity;
        expect(runOrigin({ origintabid: "tab-gone", origintranscript: "/t/s-1.jsonl" }, roster, [untitled])).toEqual(
            expect.objectContaining({ kind: "ended", name: "an untitled session" })
        );
    });

    it("says the session is gone when neither the roster nor the history has it", () => {
        expect(runOrigin({ origintabid: "tab-gone", origintranscript: "/t/other.jsonl" }, roster, [ended])).toEqual({
            kind: "gone",
        });
        expect(runOrigin({ origintabid: "tab-gone" }, roster, [ended])).toEqual({ kind: "gone" });
        // history not loaded yet
        expect(runOrigin({ origintabid: "tab-gone", origintranscript: "/t/s-1.jsonl" }, roster, null)).toEqual({
            kind: "gone",
        });
    });
});
