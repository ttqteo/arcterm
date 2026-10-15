// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { beforeEach, describe, expect, it, vi } from "vitest";

// each GetObject fetch parks here, tagged with the oref it asked for, until the test settles it with the object
// it "found", or with FAIL
type Answer = ((data: unknown) => void) & { oref: string };
const inflight: Answer[] = [];
const FAIL = "fail";

vi.mock("@/util/fetchutil", () => ({
    fetch: vi.fn(
        (_url: string, init: { body: string }) =>
            new Promise((resolve) => {
                const answer = ((data: unknown) =>
                    resolve(
                        data === FAIL
                            ? { ok: false, status: 502, statusText: "Bad Gateway" }
                            : { ok: true, json: async () => ({ data }) }
                    )) as Answer;
                answer.oref = JSON.parse(init.body).args[0];
                inflight.push(answer);
            })
    ),
}));
vi.mock("@/util/endpoints", () => ({ getWebServerEndpoint: () => "http://wavesrv.test" }));
vi.mock("@/app/store/windowtype", () => ({ isPreviewWindow: () => false }));

import { globalStore } from "./jotaiStore";
import { getWaveObjectValue, loadAndPinWaveObject, reloadCachedWaveObjects, updateWaveObject } from "./wos";

const settle = () => new Promise((r) => setTimeout(r, 0));

let n = 0;
function freshRun(): { oref: string; oid: string } {
    // the WOS cache is module-global: every case gets its own object
    const oid = `00000000-0000-4000-8000-${String(++n).padStart(12, "0")}`;
    return { oref: `run:${oid}`, oid };
}

// the fetches out for oref, in the order they were sent
function sentFor(oref: string): Answer[] {
    return inflight.filter((a) => a.oref === oref);
}

describe("wos pushed update vs in-flight fetch", () => {
    beforeEach(() => {
        inflight.length = 0;
    });

    it("keeps a pushed update when an older fetch resolves null after it", async () => {
        const { oref, oid } = freshRun();
        const wov = getWaveObjectValue(oref);
        const pushed = { otype: "run", oid, version: 1 } as unknown as WaveObj;
        updateWaveObject({ updatetype: "update", otype: "run", oid, obj: pushed } as WaveObjUpdate);
        expect(await loadAndPinWaveObject(oref)).toBe(pushed);
        inflight.shift()(null);
        await settle();
        expect(globalStore.get(wov.dataAtom).value).toBe(pushed);
    });

    it("keeps a pushed delete when an older fetch resolves the object after it", async () => {
        const { oref, oid } = freshRun();
        const wov = getWaveObjectValue(oref);
        updateWaveObject({ updatetype: "delete", otype: "run", oid } as WaveObjUpdate);
        inflight.shift()({ otype: "run", oid, version: 1 });
        await settle();
        expect(globalStore.get(wov.dataAtom).value).toBeNull();
    });

    it("still lands a fetch nothing overtook", async () => {
        const { oref, oid } = freshRun();
        const wov = getWaveObjectValue(oref);
        const found = { otype: "run", oid, version: 3 };
        inflight.shift()(found);
        await settle();
        expect(globalStore.get(wov.dataAtom)).toEqual({ value: found, loading: false, error: false });
    });
});

describe("wos refetch after the socket comes back", () => {
    // a cached run whose first load has landed
    async function loadedRun(version = 1) {
        const { oref, oid } = freshRun();
        const wov = getWaveObjectValue(oref);
        sentFor(oref)[0]({ otype: "run", oid, version });
        await settle();
        return { oref, oid, wov };
    }

    beforeEach(() => {
        inflight.length = 0;
    });

    it("lands the change the socket missed", async () => {
        const { oref, oid, wov } = await loadedRun();
        reloadCachedWaveObjects();
        sentFor(oref)[1]({ otype: "run", oid, version: 4, status: "done" });
        await settle();
        expect(globalStore.get(wov.dataAtom).value).toMatchObject({ version: 4, status: "done" });
    });

    it("clears an object deleted while the socket was down", async () => {
        const { oref, wov } = await loadedRun();
        reloadCachedWaveObjects();
        sentFor(oref)[1](null);
        await settle();
        expect(globalStore.get(wov.dataAtom)).toEqual({ value: null, loading: false, error: false });
    });

    it("keeps an unchanged object's value as it was, so nothing re-renders", async () => {
        const { oref, oid, wov } = await loadedRun(2);
        const before = globalStore.get(wov.dataAtom);
        reloadCachedWaveObjects();
        sentFor(oref)[1]({ otype: "run", oid, version: 2 });
        await settle();
        expect(globalStore.get(wov.dataAtom)).toBe(before);
    });

    it("keeps a change pushed while the refetch was out", async () => {
        const { oref, oid, wov } = await loadedRun();
        reloadCachedWaveObjects();
        const pushed = { otype: "run", oid, version: 3 } as unknown as WaveObj;
        updateWaveObject({ updatetype: "update", otype: "run", oid, obj: pushed } as WaveObjUpdate);
        sentFor(oref)[1]({ otype: "run", oid, version: 2 });
        await settle();
        expect(globalStore.get(wov.dataAtom).value).toBe(pushed);
    });

    it("keeps a delete pushed while the refetch was out", async () => {
        const { oref, oid, wov } = await loadedRun();
        reloadCachedWaveObjects();
        updateWaveObject({ updatetype: "delete", otype: "run", oid } as WaveObjUpdate);
        sentFor(oref)[1]({ otype: "run", oid, version: 2 });
        await settle();
        expect(globalStore.get(wov.dataAtom).value).toBeNull();
    });

    it("lets only the newest refetch land when the socket comes back twice", async () => {
        const { oref, oid, wov } = await loadedRun();
        reloadCachedWaveObjects();
        reloadCachedWaveObjects();
        const [, first, second] = sentFor(oref);
        second({ otype: "run", oid, version: 5 });
        first({ otype: "run", oid, version: 3 });
        await settle();
        expect(globalStore.get(wov.dataAtom).value).toMatchObject({ version: 5 });
    });

    it("keeps the cached copy when the refetch fails", async () => {
        const { oref, wov } = await loadedRun();
        const before = globalStore.get(wov.dataAtom);
        reloadCachedWaveObjects();
        sentFor(oref)[1](FAIL);
        await settle();
        expect(globalStore.get(wov.dataAtom)).toBe(before);
        expect(getWaveObjectValue(oref, false)).toBe(wov);
    });

    it("leaves an object whose first load is still out to that load", async () => {
        const { oref, oid } = freshRun();
        const wov = getWaveObjectValue(oref);
        reloadCachedWaveObjects();
        expect(sentFor(oref)).toHaveLength(1);
        sentFor(oref)[0]({ otype: "run", oid, version: 1 });
        await settle();
        expect(globalStore.get(wov.dataAtom).value).toMatchObject({ version: 1 });
    });
});
