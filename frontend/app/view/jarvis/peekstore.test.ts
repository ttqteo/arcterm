// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { globalStore } from "@/app/store/jotaiStore";
import { beforeEach, describe, expect, it } from "vitest";
import {
    backToHub,
    clearLoadingPeek,
    closePeek,
    peekFactsAtom,
    peekItemAtom,
    reportPeekFacts,
    settlePeek,
    startPeek,
    type PeekFacts,
    type PeekItem,
} from "./peekstore";
import { petPeekOpenAtom } from "./petstore";

const RUN: PeekItem["target"] = { kind: "run", runId: "r1" };
const AGENT: PeekItem["target"] = { kind: "agent", tabId: "t1" };

beforeEach(() => {
    globalStore.set(peekItemAtom, null);
    globalStore.set(petPeekOpenAtom, false);
});

describe("leaving an item", () => {
    it("Back returns to the hub and keeps the popup open", () => {
        globalStore.set(peekItemAtom, { target: RUN, status: "ready" });
        globalStore.set(petPeekOpenAtom, true);
        backToHub();
        expect(globalStore.get(peekItemAtom)).toBeNull();
        expect(globalStore.get(petPeekOpenAtom)).toBe(true);
    });

    it("close drops the item and the popup", () => {
        globalStore.set(peekItemAtom, { target: RUN, status: "ready" });
        globalStore.set(petPeekOpenAtom, true);
        closePeek();
        expect(globalStore.get(peekItemAtom)).toBeNull();
        expect(globalStore.get(petPeekOpenAtom)).toBe(false);
    });
});

describe("a peek's lifecycle", () => {
    it("starts loading from a closed popup and settles ready", () => {
        const item = startPeek(RUN);
        expect(globalStore.get(peekItemAtom)).toEqual({ target: RUN, status: "loading" });
        expect(globalStore.get(petPeekOpenAtom)).toBe(true);
        settlePeek(item);
        expect(globalStore.get(peekItemAtom)).toEqual({ target: RUN, status: "ready" });
    });

    it("an item left behind by a popup closed some other way counts as closed", () => {
        globalStore.set(peekItemAtom, { target: AGENT, status: "ready" });
        startPeek(RUN);
        clearLoadingPeek();
        expect(globalStore.get(peekItemAtom)).toBeNull();
        expect(globalStore.get(petPeekOpenAtom)).toBe(false);
    });

    it("clearing a loading peek restores what it replaced, through a second loading peek", () => {
        const shown: PeekItem = { target: AGENT, status: "ready" };
        globalStore.set(peekItemAtom, shown);
        globalStore.set(petPeekOpenAtom, true);
        startPeek(RUN);
        startPeek({ kind: "effort", effortId: "e-1" });
        clearLoadingPeek();
        expect(globalStore.get(peekItemAtom)).toEqual(shown);
        expect(globalStore.get(petPeekOpenAtom)).toBe(true);
    });

    it("clearing leaves a settled item alone", () => {
        settlePeek(startPeek(RUN));
        clearLoadingPeek();
        expect(globalStore.get(peekItemAtom)?.status).toBe("ready");
    });

    it("a load landing after the popup closed does not reopen it", () => {
        const item = startPeek(RUN);
        closePeek();
        settlePeek(item);
        expect(globalStore.get(peekItemAtom)).toBeNull();
        expect(globalStore.get(petPeekOpenAtom)).toBe(false);
    });

    it("a replaced peek does not settle over its replacement", () => {
        const first = startPeek(RUN);
        startPeek(AGENT);
        settlePeek(first);
        expect(globalStore.get(peekItemAtom)).toEqual({ target: AGENT, status: "loading" });
    });
});

describe("the facts a body reports", () => {
    const FACTS: PeekFacts = { gone: false };

    it("are kept for the current item, through its settle", () => {
        const item = startPeek(RUN);
        settlePeek(item);
        reportPeekFacts({ kind: "run", runId: "r1" }, FACTS);
        expect(globalStore.get(peekFactsAtom)).toEqual(FACTS);
        settlePeek(item);
        expect(globalStore.get(peekFactsAtom)).toEqual(FACTS);
    });

    it("from a stale target are ignored", () => {
        settlePeek(startPeek(RUN));
        reportPeekFacts(AGENT, { gone: true });
        expect(globalStore.get(peekFactsAtom)).toBeNull();
        reportPeekFacts({ kind: "record", dossierId: "d1" }, { gone: true });
        closePeek();
        reportPeekFacts(RUN, FACTS);
        expect(globalStore.get(peekFactsAtom)).toBeNull();
    });

    it("reset when the item changes target, however it is set", () => {
        settlePeek(startPeek(RUN));
        reportPeekFacts(RUN, FACTS);
        startPeek(AGENT);
        expect(globalStore.get(peekFactsAtom)).toBeNull();
        reportPeekFacts(AGENT, FACTS);
        globalStore.set(peekItemAtom, { target: RUN, status: "ready" });
        expect(globalStore.get(peekFactsAtom)).toBeNull();
    });

    it("a record anchor is part of the target", () => {
        globalStore.set(peekItemAtom, { target: { kind: "record", dossierId: "d1" }, status: "ready" });
        reportPeekFacts({ kind: "record", dossierId: "d1", anchor: "a" }, FACTS);
        expect(globalStore.get(peekFactsAtom)).toBeNull();
    });
});
