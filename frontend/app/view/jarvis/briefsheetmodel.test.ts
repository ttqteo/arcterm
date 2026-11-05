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
    RpcApi: {
        GetDossierCommand: vi.fn(async () => null),
        ResolveFocusScopeCommand: vi.fn(async () => null),
        EffortGetCommand: vi.fn(async () => ({ effort: { oid: "e1" } })),
    },
}));
vi.mock("@/app/store/wshrpcutil", () => ({ TabRpcClient: {} }));

import { globalStore } from "@/app/store/jotaiStore";
import { briefQueueSheetAtom, openQueueSheet } from "./briefqueuestore";
import { sheetFace, sheetPosition } from "./briefsheetmodel";
import { councilSheetAtom, openCouncilSheet, yieldToSubject } from "./councilsheetstore";
import {
    backToPlan,
    chunkNotesOnlyAtom,
    chunkViewOpenAtom,
    initiativeCursorAtom,
    initiativeSheetAtom,
    initiativeSheetOpenAtom,
    openInitiativeChunk,
    openInitiativeSheet,
    showInitiativeActivity,
} from "./initiativesheetstore";
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

// the sheet head's Previous/Next (the run sheet's arrows and the initiative sheet's) step the list the Brief published
describe("sheetPosition", () => {
    const list = ["effort:a", "effort:b", "effort:c"];

    it("names the item's place and both neighbours in the middle of the list", () => {
        expect(sheetPosition(list, "effort:b")).toEqual({ n: 2, total: 3, prev: "effort:a", next: "effort:c" });
    });

    it("has no previous at the top and no next at the bottom", () => {
        expect(sheetPosition(list, "effort:a")).toEqual({ n: 1, total: 3, prev: null, next: "effort:b" });
        expect(sheetPosition(list, "effort:c")).toEqual({ n: 3, total: 3, prev: "effort:b", next: null });
    });

    it("gives an item outside the list no position and inert arrows", () => {
        expect(sheetPosition(list, "effort:z")).toEqual({ n: 0, total: 0, prev: null, next: null });
        expect(sheetPosition(list, null)).toEqual({ n: 0, total: 0, prev: null, next: null });
        expect(sheetPosition([], "effort:a")).toEqual({ n: 0, total: 0, prev: null, next: null });
    });
});

describe("the initiative sheet's state (initiativesheetstore.ts)", () => {
    beforeEach(() => {
        globalStore.set(activeSubjectAtom, null);
        globalStore.set(briefQueueSheetAtom, null);
        globalStore.set(councilSheetAtom, null);
        globalStore.set(briefSheetOpenAtom, false);
        globalStore.set(initiativeSheetAtom, { view: "plan", chunk: null });
        globalStore.set(initiativeCursorAtom, null);
        globalStore.set(chunkNotesOnlyAtom, false);
    });

    it("opens the sheet on the initiative's plan", () => {
        openInitiativeSheet("effort:e1");
        expect(globalStore.get(activeSubjectAtom)).toEqual({ kind: "effort", id: "e1" });
        expect(globalStore.get(briefSheetOpenAtom)).toBe(true);
        expect(globalStore.get(initiativeSheetAtom)).toEqual({ view: "plan", chunk: null });
        expect(globalStore.get(initiativeSheetOpenAtom)).toBe(true);
        expect(globalStore.get(chunkViewOpenAtom)).toBe(false);
    });

    it("starts the body fresh on every open: a feed or chunk left on one initiative never shows on the next", () => {
        openInitiativeChunk("effort:e1", "Spec");
        expect(globalStore.get(initiativeSheetAtom)).toEqual({ view: "plan", chunk: "Spec" });
        expect(globalStore.get(chunkViewOpenAtom)).toBe(true);
        globalStore.set(initiativeCursorAtom, "Spec");
        openInitiativeSheet("e2");
        expect(globalStore.get(activeSubjectAtom)).toEqual({ kind: "effort", id: "e2" });
        expect(globalStore.get(initiativeSheetAtom)).toEqual({ view: "plan", chunk: null });
        expect(globalStore.get(initiativeCursorAtom)).toBeNull();
        showInitiativeActivity();
        openInitiativeSheet("e1", { view: "activity" });
        expect(globalStore.get(initiativeSheetAtom)).toEqual({ view: "activity", chunk: null });
    });

    it("keeps Notes only across chunks and initiatives", () => {
        openInitiativeChunk("e1", "Spec");
        globalStore.set(chunkNotesOnlyAtom, true);
        openInitiativeSheet("e2");
        openInitiativeChunk("e2", "Build");
        expect(globalStore.get(chunkNotesOnlyAtom)).toBe(true);
    });

    it("goes back from a chunk to the plan with the cursor on that chunk", () => {
        openInitiativeChunk("e1", "Spec");
        globalStore.set(initiativeCursorAtom, null);
        backToPlan();
        expect(globalStore.get(initiativeSheetAtom)).toEqual({ view: "plan", chunk: null });
        expect(globalStore.get(initiativeCursorAtom)).toBe("Spec");
    });

    it("reads closed while the council or a queue entry holds the sheet, as sheetFace draws it", () => {
        openInitiativeSheet("e1");
        globalStore.set(councilSheetAtom, "cn-1");
        expect(globalStore.get(initiativeSheetOpenAtom)).toBe(false);
        globalStore.set(councilSheetAtom, null);
        globalStore.set(briefQueueSheetAtom, "q-a");
        expect(globalStore.get(initiativeSheetOpenAtom)).toBe(false);
        globalStore.set(briefQueueSheetAtom, null);
        globalStore.set(briefSheetOpenAtom, false);
        expect(globalStore.get(initiativeSheetOpenAtom)).toBe(false);
    });
});
