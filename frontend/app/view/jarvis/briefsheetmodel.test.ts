// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0
//
// Which subject the Brief's detail sheet owns. The rule under test is a routing one, and it earns a test
// because a kind that silently falls through to "none" loses its only destination now that the Stage is
// gone: dossier and briefing are each rendered by another Brief surface (the peek, the Brief itself), so
// "none" has to mean "someone else draws this", never "nothing does".

import { beforeEach, describe, expect, it, vi } from "vitest";

// the stores below reach the backend on selection; the clearing rules under test are synchronous atom writes
vi.mock("@/app/store/wshclientapi", () => ({
    RpcApi: { GetDossierCommand: vi.fn(async () => null), ResolveFocusScopeCommand: vi.fn(async () => null) },
}));
vi.mock("@/app/store/wshrpcutil", () => ({ TabRpcClient: {} }));

import { globalStore } from "@/app/store/jotaiStore";
import { briefQueueSheetAtom, openQueueSheet } from "./briefqueuestore";
import { sheetFace } from "./briefsheetmodel";
import { councilSheetAtom, openCouncilSheet, yieldToSubject } from "./councilsheetstore";
import { briefSheetOpenAtom } from "./jarvisstore";
import { activeSubjectAtom, type ActiveSubject } from "./jarvissubjectstore";

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

    it("draws a council's report when one is open", () => {
        expect(sheetFace(null, null, null, "cn-1")).toEqual({ kind: "council", councilId: "cn-1" });
        // the ways in clear one another, so a set council is the one opened last
        expect(sheetFace(subject("effort", "e1"), null, "q-a", "cn-1")).toEqual({ kind: "council", councilId: "cn-1" });
    });

    it("draws the subject or the queue entry when no council is open", () => {
        expect(sheetFace(subject("effort", "e1"), null, null, null)).toEqual({ kind: "effort", effortId: "e1" });
        expect(sheetFace(null, null, "q-a", null)).toEqual({ kind: "queued", entryId: "q-a" });
    });
});

describe("the sheet's ways in clear one another", () => {
    beforeEach(() => {
        globalStore.set(activeSubjectAtom, null);
        globalStore.set(briefQueueSheetAtom, null);
        globalStore.set(councilSheetAtom, null);
        globalStore.set(briefSheetOpenAtom, false);
    });

    it("opening a council clears the subject and the queue entry, and opens the sheet", () => {
        globalStore.set(activeSubjectAtom, subject("effort", "e1"));
        globalStore.set(briefQueueSheetAtom, "q-a");
        openCouncilSheet("cn-1");
        expect(globalStore.get(councilSheetAtom)).toBe("cn-1");
        expect(globalStore.get(activeSubjectAtom)).toBeNull();
        expect(globalStore.get(briefQueueSheetAtom)).toBeNull();
        expect(globalStore.get(briefSheetOpenAtom)).toBe(true);
    });

    it("opening a queue entry clears the council", () => {
        openCouncilSheet("cn-1");
        openQueueSheet("q-a");
        expect(globalStore.get(councilSheetAtom)).toBeNull();
        expect(globalStore.get(briefQueueSheetAtom)).toBe("q-a");
    });

    it("a subject opening clears the council and the queue entry", () => {
        openCouncilSheet("cn-1");
        globalStore.set(briefQueueSheetAtom, "q-a");
        yieldToSubject();
        expect(globalStore.get(councilSheetAtom)).toBeNull();
        expect(globalStore.get(briefQueueSheetAtom)).toBeNull();
    });
});
