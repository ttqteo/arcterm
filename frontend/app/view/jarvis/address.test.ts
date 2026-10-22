// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { describe, expect, it } from "vitest";
import { CANNOT_LOCATE_RECORD, CANNOT_OPEN, parseAddress, type AddressHint, type OpenTarget } from "./address";

describe("parseAddress", () => {
    // memory: still arrives from persisted conversation turns and effort WorkRefs
    it("reads a memory note, whichever spelling it arrives in", () => {
        for (const address of ["memnote:m-1", "memory:m-1"]) {
            expect(parseAddress(address)).toEqual({ kind: "note", noteId: "m-1" });
        }
    });

    it.each<[string, AddressHint | undefined, OpenTarget]>([
        ["run:r-1", undefined, { kind: "run", runId: "r-1" }],
        ["channel:c-1", undefined, { kind: "channel", channelId: "c-1" }],
        ["tab:t-1", undefined, { kind: "agent", tabId: "t-1" }],
        // effort WorkRefs persist the older agent: spelling
        ["agent:t-1", undefined, { kind: "agent", tabId: "t-1" }],
        ["task:d-1", undefined, { kind: "record", dossierId: "d-1" }],
        [
            "task:d-1",
            { sourceType: "decision", anchor: "dec-1" },
            { kind: "record", dossierId: "d-1", anchor: "dec-1" },
        ],
        // an empty anchor is no anchor, not a highlight of nothing
        ["task:d-1", { anchor: "" }, { kind: "record", dossierId: "d-1" }],
        ["effort:e-1", undefined, { kind: "effort", effortId: "e-1" }],
        ["radarreport:rr-1", undefined, { kind: "radar", reportId: "rr-1" }],
        [
            "radarreport:rr-1",
            { sourceType: "radar", anchor: "f-1" },
            { kind: "radar", reportId: "rr-1", findingId: "f-1" },
        ],
    ])("reads %s with hint %j", (address, hint, want) => {
        expect(parseAddress(address, hint)).toEqual(want);
    });

    // a pre-canonical vault: citation named a node without its collection; the card's source type recovers it
    describe("the legacy vault: dialect", () => {
        it("opens a dossier, or a card with no source type, as a record", () => {
            expect(parseAddress("vault:d-1", { sourceType: "dossier" })).toEqual({
                kind: "record",
                dossierId: "d-1",
            });
            expect(parseAddress("vault:d-1")).toEqual({ kind: "record", dossierId: "d-1" });
        });

        it("reads a memory node as a note", () => {
            expect(parseAddress("vault:m-1", { sourceType: "memory" })).toEqual({ kind: "note", noteId: "m-1" });
        });

        // the card never recorded which record the decision sits in, so there is nowhere honest to land
        it("refuses a decision it has no record for", () => {
            expect(parseAddress("vault:dec-1", { sourceType: "decision" })).toEqual({
                kind: "unsupported",
                message: CANNOT_LOCATE_RECORD,
            });
        });

        it("does not guess at any other source type", () => {
            expect(parseAddress("vault:x", { sourceType: "status" })).toEqual({
                kind: "unsupported",
                message: CANNOT_OPEN,
            });
        });
    });

    describe("canvas:", () => {
        it("reads a topic alone", () => {
            expect(parseAddress("canvas:agent-canvas-mode")).toEqual({ kind: "canvas", topic: "agent-canvas-mode" });
        });

        it("appends the board extension to a bare board name, and keeps a full one", () => {
            expect(parseAddress("canvas:t/States")).toEqual({ kind: "canvas", topic: "t", board: "States.dc.html" });
            expect(parseAddress("canvas:t/States.dc.html")).toEqual({
                kind: "canvas",
                topic: "t",
                board: "States.dc.html",
            });
        });

        // a topic and board become path segments, so anything that could walk the tree never parses
        it.each(["canvas:", "canvas:../x", "canvas:a/b/c", "canvas:a/..", "canvas:.hidden", "canvas:a b", "canvas:a/"])(
            "refuses %s",
            (address) => {
                expect(parseAddress(address)).toEqual({ kind: "unsupported", message: CANNOT_OPEN });
            }
        );
    });

    describe("council:", () => {
        it("reads a council id", () => {
            expect(parseAddress("council:c-1")).toEqual({ kind: "council", councilId: "c-1" });
        });

        it("refuses an empty id", () => {
            expect(parseAddress("council:")).toEqual({ kind: "unsupported", message: CANNOT_OPEN });
        });
    });

    describe("memhygiene:", () => {
        it("reads a project", () => {
            expect(parseAddress("memhygiene:waveterm")).toEqual({ kind: "memhygiene", project: "waveterm" });
        });

        // a project name may hold ":", so this kind alone splits at the first one
        it("keeps a ':' in the project name", () => {
            expect(parseAddress("memhygiene:a:b")).toEqual({ kind: "memhygiene", project: "a:b" });
        });

        it("refuses an empty project", () => {
            expect(parseAddress("memhygiene:")).toEqual({ kind: "unsupported", message: CANNOT_OPEN });
        });

        it("leaves every other kind on the two-part rule, and memory: a note", () => {
            expect(parseAddress("run:a:b")).toEqual({ kind: "unsupported", message: CANNOT_OPEN });
            expect(parseAddress("memory:abc")).toEqual({ kind: "note", noteId: "abc" });
        });
    });

    // radar: is the attachment namespace (resolveAttached), not an address
    it.each(["commit:abc", "session:s-1", "radar:f-1", "decision:dec-1"])("leaves %s unsupported", (address) => {
        expect(parseAddress(address)).toEqual({ kind: "unsupported", message: CANNOT_OPEN });
    });

    it("is total on malformed input (never throws)", () => {
        const malformed = ["", "nope", "run:", ":x", "run:a:b", undefined, null] as unknown as string[];
        for (const address of malformed) {
            expect(parseAddress(address).kind).toBe("unsupported");
        }
    });
});
