// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

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
import {
    getWaveObjectAtom,
    getWaveObjectValue,
    loadAndPinWaveObject,
    reloadCachedWaveObjects,
    updateWaveObject,
} from "./wos";

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

    it("refetches an object whose first load failed", async () => {
        const { oref, oid } = freshRun();
        const wov = getWaveObjectValue(oref);
        sentFor(oref)[0](FAIL);
        await settle();
        reloadCachedWaveObjects();
        sentFor(oref)[1]({ otype: "run", oid, version: 1 });
        await settle();
        expect(globalStore.get(wov.dataAtom)).toMatchObject({ value: { version: 1 }, error: false });
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

// A failed first load used to drop the cache entry, while the atoms already handed out (getWaveObjectAtom, the loading
// and error atoms) stayed bound to it: every later load and push landed in a new entry those atoms never read, so a tab
// whose load failed at boot stayed out of the Agent roster for good.
describe("wos failed first load", () => {
    beforeEach(() => {
        inflight.length = 0;
        vi.useFakeTimers();
    });
    afterEach(() => {
        vi.useRealTimers();
    });

    const tick = (ms = 0) => vi.advanceTimersByTimeAsync(ms);

    it("retries into the entry the handed-out atoms read", async () => {
        const { oref, oid } = freshRun();
        const valueAtom = getWaveObjectAtom(oref);
        sentFor(oref)[0](FAIL);
        await tick();
        expect(sentFor(oref)).toHaveLength(1);
        await tick(1000);
        expect(sentFor(oref)).toHaveLength(2);
        sentFor(oref)[1]({ otype: "run", oid, version: 1 });
        await tick();
        expect(globalStore.get(valueAtom)).toMatchObject({ version: 1 });
    });

    it("lands a push on the entry the handed-out atoms read, and retries no more", async () => {
        const { oref, oid } = freshRun();
        const valueAtom = getWaveObjectAtom(oref);
        sentFor(oref)[0](FAIL);
        await tick();
        const pushed = { otype: "run", oid, version: 2 } as unknown as WaveObj;
        updateWaveObject({ updatetype: "update", otype: "run", oid, obj: pushed } as WaveObjUpdate);
        expect(globalStore.get(valueAtom)).toBe(pushed);
        await tick(60_000);
        expect(sentFor(oref)).toHaveLength(1);
    });

    it("keeps retrying, further apart, while the load keeps failing", async () => {
        const { oref } = freshRun();
        getWaveObjectAtom(oref);
        sentFor(oref)[0](FAIL);
        await tick();
        await tick(1000);
        sentFor(oref)[1](FAIL);
        await tick();
        await tick(1000);
        expect(sentFor(oref)).toHaveLength(2);
        await tick(1000);
        expect(sentFor(oref)).toHaveLength(3);
    });

    it("starts a load again for a reader that asks after the retries ran out", async () => {
        const { oref, oid } = freshRun();
        const wov = getWaveObjectValue(oref);
        for (let i = 0; i < 20 && sentFor(oref).length > i; i++) {
            sentFor(oref)[i](FAIL);
            await tick(60_000);
        }
        const sent = sentFor(oref).length;
        expect(getWaveObjectValue(oref)).toBe(wov);
        expect(sentFor(oref)).toHaveLength(sent + 1);
        sentFor(oref)[sent]({ otype: "run", oid, version: 1 });
        await tick();
        expect(globalStore.get(wov.dataAtom).value).toMatchObject({ version: 1 });
    });
});
