// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0
//
// Which subject the Brief's detail sheet owns. The rule under test is a routing one, and it earns a test
// because a kind that silently falls through to "none" loses its only destination now that the Stage is
// gone: dossier and briefing are each rendered by another Brief surface (the peek, the Brief itself), so
// "none" has to mean "someone else draws this", never "nothing does".

import { describe, expect, it } from "vitest";
import { sheetFace } from "./briefsheetmodel";
import type { ActiveSubject } from "./jarvissubjectstore";

const subject = (kind: ActiveSubject["kind"], id = "s1"): ActiveSubject => ({ kind, id });
const run = { id: "r1" } as Run;

describe("sheetFace", () => {
    it("draws nothing with no subject selected", () => {
        expect(sheetFace(null, null)).toEqual({ kind: "none" });
    });

    it("draws the run body for a channel that has one", () => {
        expect(sheetFace(subject("channel", "ch1"), run)).toEqual({
            kind: "channel",
            channelId: "ch1",
            body: "run",
        });
    });

    it("draws the launcher for a channel whose first run does not exist yet", () => {
        // a channel with no run is not an empty sheet: the launcher is the only place a run starts from
        // in the Brief, so it has to be reachable by selecting the channel.
        expect(sheetFace(subject("channel", "ch1"), null)).toEqual({
            kind: "channel",
            channelId: "ch1",
            body: "launcher",
        });
    });

    it("draws the initiative detail for an effort", () => {
        expect(sheetFace(subject("effort", "e1"), null)).toEqual({ kind: "effort", effortId: "e1" });
    });

    it("draws a queue entry when one is open, whatever the subject", () => {
        expect(sheetFace(null, null, "q-a")).toEqual({ kind: "queued", entryId: "q-a" });
        expect(sheetFace(subject("effort", "e1"), null, "q-a")).toEqual({ kind: "queued", entryId: "q-a" });
    });

    it("draws the subject when no queue entry is open", () => {
        expect(sheetFace(subject("effort", "e1"), null, null)).toEqual({ kind: "effort", effortId: "e1" });
    });

    // the sheet must not become a second renderer for a subject that already has one
    it.each(["dossier", "briefing"] as const)("leaves %s to its own Brief destination", (kind) => {
        expect(sheetFace(subject(kind), run)).toEqual({ kind: "none" });
    });
});
