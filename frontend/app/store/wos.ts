// Copyright 2025, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

// WaveObjectStore

import { isPreviewWindow } from "@/app/store/windowtype";
import { waveEventSubscribeSingle } from "@/app/store/wps";
import { getWebServerEndpoint } from "@/util/endpoints";
import { fetch } from "@/util/fetchutil";
import { fireAndForget } from "@/util/util";
import { atom, Atom, Getter, PrimitiveAtom, Setter, useAtomValue } from "jotai";
import { globalStore } from "./jotaiStore";
import { ObjectService } from "./services";
import debug from "debug";

const dlog = debug("wave:wos");

type WaveObjectDataItemType<T extends WaveObj> = {
    value: T;
    loading: boolean;
    error: boolean;
};

type WaveObjectValue<T extends WaveObj> = {
    pendingPromise: Promise<T>;
    dataAtom: PrimitiveAtom<WaveObjectDataItemType<T>>;
    retryTimer?: ReturnType<typeof setTimeout>; // the next try of a first load that failed
};

// How long a failed first load waits before each next try; once they run out, the next reader to ask starts again.
const LOAD_RETRY_MS = [1000, 2000, 5000, 10000, 30000];

function splitORef(oref: string): [string, string] {
    const parts = oref.split(":");
    if (parts.length != 2) {
        throw new Error("invalid oref");
    }
    return [parts[0], parts[1]];
}

function isBlank(str: string): boolean {
    return str == null || str == "";
}

function isBlankNum(num: number): boolean {
    return num == null || isNaN(num) || num == 0;
}

function isValidWaveObj(val: WaveObj): boolean {
    if (val == null) {
        return false;
    }
    if (isBlank(val.otype) || isBlank(val.oid) || isBlankNum(val.version)) {
        return false;
    }
    return true;
}

function makeORef(otype: string, oid: string): string {
    if (isBlank(otype) || isBlank(oid)) {
        return null;
    }
    return `${otype}:${oid}`;
}

const previewMockObjects: Map<string, WaveObj> = new Map();

function mockObjectForPreview<T extends WaveObj>(oref: string, obj: T): void {
    if (!isPreviewWindow()) {
        throw new Error("mockObjectForPreview can only be called in a preview window");
    }
    previewMockObjects.set(oref, obj);
}

function GetObject<T>(oref: string): Promise<T> {
    if (isPreviewWindow()) {
        return Promise.resolve((previewMockObjects.get(oref) as T) ?? null);
    }
    return callBackendService("object", "GetObject", [oref], true);
}

function debugLogBackendCall(methodName: string, durationStr: string, args: any[]) {
    durationStr = "| " + durationStr;
    if (methodName == "object.UpdateObject" && args.length > 0) {
        dlog("[service] object.UpdateObject", args[0].otype, args[0].oid, durationStr, args[0]);
        return;
    }
    if (methodName == "object.GetObject" && args.length > 0) {
        dlog("[service] object.GetObject", args[0], durationStr);
        return;
    }
    if (methodName == "file.StatFile" && args.length >= 2) {
        dlog("[service] file.StatFile", args[1], durationStr);
        return;
    }
    dlog("[service]", methodName, durationStr);
}

function wpsSubscribeToObject(oref: string): () => void {
    return waveEventSubscribeSingle({
        eventType: "waveobj:update",
        scope: oref,
        handler: (event) => {
            updateWaveObject(event.data);
        },
    });
}

function callBackendService(service: string, method: string, args: any[], noUIContext?: boolean): Promise<any> {
    const startTs = Date.now();
    let uiContext: UIContext = null;
    if (!noUIContext && globalThis.window != null) {
        uiContext = globalStore.get(((window as any).globalAtoms as GlobalAtomsType).uiContext);
    }
    const waveCall: WebCallType = {
        service: service,
        method: method,
        args: args,
        uicontext: uiContext,
    };
    // usp is just for debugging (easier to filter URLs)
    const methodName = `${service}.${method}`;
    const usp = new URLSearchParams();
    usp.set("service", service);
    usp.set("method", method);
    const webEndpoint = getWebServerEndpoint();
    if (webEndpoint == null) throw new Error(`cannot call ${methodName}: no web endpoint`);
    const url = webEndpoint + "/wave/service?" + usp.toString();
    const fetchPromise = fetch(url, {
        method: "POST",
        body: JSON.stringify(waveCall),
    });
    const prtn = fetchPromise
        .then((resp) => {
            if (!resp.ok) {
                throw new Error(`call ${methodName} failed: ${resp.status} ${resp.statusText}`);
            }
            return resp.json();
        })
        .then((respData: WebReturnType) => {
            if (respData == null) {
                return null;
            }
            if (respData.updates != null) {
                updateWaveObjects(respData.updates);
            }
            if (respData.error != null) {
                throw new Error(`call ${methodName} error: ${respData.error}`);
            }
            const durationStr = Date.now() - startTs + "ms";
            debugLogBackendCall(methodName, durationStr, args);
            return respData.data;
        });
    return prtn;
}

const waveObjectValueCache = new Map<string, WaveObjectValue<any>>();

function reloadWaveObject<T extends WaveObj>(oref: string): Promise<T> {
    let wov = waveObjectValueCache.get(oref);
    if (wov === undefined) {
        wov = getWaveObjectValue<T>(oref, true);
        return wov.pendingPromise;
    }
    const prtn = GetObject<T>(oref);
    prtn.then((val) => {
        globalStore.set(wov.dataAtom, { value: val, loading: false, error: false });
    }).catch((err) => {
        // the entry stays (see loadInto): the next reader to ask loads it again
        globalStore.set(wov.dataAtom, { value: null, loading: false, error: true });
        dlog("WaveObj reload failed", oref, err);
    });
    return prtn;
}

// the newest refetch per oref; a pushed change drops it, so a refetch answered after the push cannot put back
// the older copy
const refetchTokens = new Map<string, number>();

// reloadCachedWaveObjects refetches every object the cache holds, each time the socket comes back. A
// waveobj:update pushed while it was down never arrives, and an object that changes no more (a finished run,
// its dag) kept the copy from before the drop for good: the Agent tree read a landed run as working.
function reloadCachedWaveObjects(): void {
    if (isPreviewWindow()) {
        return;
    }
    for (const [oref, wov] of waveObjectValueCache) {
        if (wov.pendingPromise != null) {
            // its first load is still out and lands what the backend holds
            continue;
        }
        const token = (refetchTokens.get(oref) ?? 0) + 1;
        refetchTokens.set(oref, token);
        GetObject<WaveObj>(oref)
            .then((val) => {
                if (refetchTokens.get(oref) !== token) {
                    return;
                }
                refetchTokens.delete(oref);
                const cur = globalStore.get(wov.dataAtom);
                // unchanged: keep the value as it was, or every object on screen re-renders at once
                const unchanged =
                    val == null ? cur.value == null : cur.value != null && val.version <= cur.value.version;
                if (unchanged && !cur.error) {
                    return;
                }
                globalStore.set(wov.dataAtom, { value: val, loading: false, error: false });
            })
            .catch((err) => {
                // the cached copy stays: it is no staler than before the refetch
                dlog("WaveObj refetch failed", oref, err);
            });
    }
}

function createWaveValueObject<T extends WaveObj>(oref: string, shouldFetch: boolean): WaveObjectValue<T> {
    const wov = { pendingPromise: null, dataAtom: null };
    wov.dataAtom = atom({ value: null, loading: true, error: false });
    if (shouldFetch) {
        loadInto(oref, wov, 0);
    }
    return wov;
}

// A load into an entry that is never replaced: the atoms already handed out for it (getWaveObjectAtom, the loading and
// error atoms) read its dataAtom, so a failed load is tried again into the same entry, never a new one in its place.
// Dropping the entry stranded them: a tab whose load failed at boot stayed out of the Agent roster for good.
function loadInto<T extends WaveObj>(oref: string, wov: WaveObjectValue<T>, attempt: number) {
    clearTimeout(wov.retryTimer);
    wov.retryTimer = undefined;
    const localPromise = GetObject<T>(oref);
    wov.pendingPromise = localPromise;
    localPromise
        .then((val) => {
            if (wov.pendingPromise != localPromise) {
                return;
            }
            const [otype, oid] = splitORef(oref);
            if (val != null) {
                if (val["otype"] != otype) {
                    throw new Error("GetObject returned wrong type");
                }
                if (val["oid"] != oid) {
                    throw new Error("GetObject returned wrong id");
                }
            }
            wov.pendingPromise = null;
            dlog("WaveObj resolved", oref);
            globalStore.set(wov.dataAtom, { value: val, loading: false, error: false });
        })
        .catch((err) => {
            // a transient backend failure must not leave the atom loading forever
            if (wov.pendingPromise != localPromise) {
                return;
            }
            wov.pendingPromise = null;
            globalStore.set(wov.dataAtom, { value: null, loading: false, error: true });
            dlog("WaveObj load failed", oref, err);
            const delay = LOAD_RETRY_MS[attempt];
            if (delay == null) {
                return;
            }
            wov.retryTimer = setTimeout(() => {
                wov.retryTimer = undefined;
                // a push or a socket-back refetch landed it meanwhile, or one is out
                if (wov.pendingPromise != null || !globalStore.get(wov.dataAtom).error) {
                    return;
                }
                loadInto(oref, wov, attempt + 1);
            }, delay);
        });
}

function getWaveObjectValue<T extends WaveObj>(oref: string, createIfMissing = true): WaveObjectValue<T> {
    let wov = waveObjectValueCache.get(oref);
    if (wov === undefined && createIfMissing) {
        wov = createWaveValueObject(oref, true);
        waveObjectValueCache.set(oref, wov);
    } else if (
        wov !== undefined &&
        wov.pendingPromise == null &&
        wov.retryTimer == null &&
        globalStore.get(wov.dataAtom).error
    ) {
        // its load failed and its retries ran out: a reader asking (a remount) tries again
        loadInto(oref, wov, 0);
    }
    return wov;
}

function loadAndPinWaveObject<T extends WaveObj>(oref: string): Promise<T> {
    const wov = getWaveObjectValue<T>(oref);
    if (wov.pendingPromise == null) {
        const dataValue = globalStore.get(wov.dataAtom);
        return Promise.resolve(dataValue.value);
    }
    return wov.pendingPromise;
}

const waveObjectDerivedAtomCache = new Map<string, Atom<any>>();

function getWaveObjectAtom<T extends WaveObj>(oref: string): Atom<T> {
    const cacheKey = oref + ":value";
    let cachedAtom = waveObjectDerivedAtomCache.get(cacheKey) as Atom<T>;
    if (cachedAtom != null) {
        return cachedAtom;
    }
    const wov = getWaveObjectValue<T>(oref);
    cachedAtom = atom((get) => get(wov.dataAtom).value);
    waveObjectDerivedAtomCache.set(cacheKey, cachedAtom);
    return cachedAtom;
}

function getWaveObjectLoadingAtom(oref: string): Atom<boolean> {
    const cacheKey = oref + ":loading";
    let cachedAtom = waveObjectDerivedAtomCache.get(cacheKey) as Atom<boolean>;
    if (cachedAtom != null) {
        return cachedAtom;
    }
    const wov = getWaveObjectValue(oref);
    cachedAtom = atom((get) => {
        const dataValue = get(wov.dataAtom);
        return dataValue.loading;
    });
    waveObjectDerivedAtomCache.set(cacheKey, cachedAtom);
    return cachedAtom;
}

// The load flag's sibling. A failed fetch clears `loading` and stores a null value, so a reader that only
// sees loading/value cannot tell "still reading" from "could not read" and treats the failure as pending.
function getWaveObjectErrorAtom(oref: string): Atom<boolean> {
    const cacheKey = oref + ":error";
    let cachedAtom = waveObjectDerivedAtomCache.get(cacheKey) as Atom<boolean>;
    if (cachedAtom != null) {
        return cachedAtom;
    }
    const wov = getWaveObjectValue(oref);
    cachedAtom = atom((get) => get(wov.dataAtom).error);
    waveObjectDerivedAtomCache.set(cacheKey, cachedAtom);
    return cachedAtom;
}

function isWaveObjectNullAtom(oref: string): Atom<boolean> {
    const cacheKey = oref + ":isnull";
    let cachedAtom = waveObjectDerivedAtomCache.get(cacheKey) as Atom<boolean>;
    if (cachedAtom != null) {
        return cachedAtom;
    }
    cachedAtom = atom((get) => get(getWaveObjectAtom(oref)) == null);
    waveObjectDerivedAtomCache.set(cacheKey, cachedAtom);
    return cachedAtom;
}

function useWaveObjectValue<T extends WaveObj>(oref: string): [T, boolean] {
    const wov = getWaveObjectValue<T>(oref);
    const atomVal = useAtomValue(wov.dataAtom);
    return [atomVal.value, atomVal.loading];
}

function updateWaveObject(update: WaveObjUpdate) {
    if (update == null) {
        return;
    }
    const oref = makeORef(update.otype, update.oid);
    const wov = getWaveObjectValue(oref);
    if (update.updatetype == "delete") {
        dlog("WaveObj deleted", oref);
        // a pushed change is newer than any fetch still in flight: drop that fetch, or a late read of
        // the object before it existed overwrites the change and nothing refetches
        wov.pendingPromise = null;
        refetchTokens.delete(oref);
        globalStore.set(wov.dataAtom, { value: null, loading: false, error: false });
    } else {
        if (!isValidWaveObj(update.obj)) {
            dlog("invalid wave object update", update);
            return;
        }
        const curValue: WaveObjectDataItemType<WaveObj> = globalStore.get(wov.dataAtom);
        if (curValue.value != null && curValue.value.version >= update.obj.version) {
            return;
        }
        dlog("WaveObj updated", oref);
        wov.pendingPromise = null;
        refetchTokens.delete(oref);
        globalStore.set(wov.dataAtom, { value: update.obj, loading: false, error: false });
    }
    return;
}

function updateWaveObjects(vals: WaveObjUpdate[]) {
    for (const val of vals) {
        updateWaveObject(val);
    }
}

// gets the value of a WaveObject from the cache.
// should provide getFn if it is available (e.g. inside of a jotai atom)
// otherwise it will use the globalStore.get function
function getObjectValue<T extends WaveObj>(oref: string, getFn?: Getter): T {
    const wov = getWaveObjectValue<T>(oref);
    if (getFn == null) {
        getFn = globalStore.get;
    }
    const atomVal = getFn(wov.dataAtom);
    return atomVal.value;
}

// sets the value of a WaveObject in the cache.
// should provide setFn if it is available (e.g. inside of a jotai atom)
// otherwise it will use the globalStore.set function
function setObjectValue<T extends WaveObj>(value: T, setFn?: Setter, pushToServer?: boolean) {
    const oref = makeORef(value.otype, value.oid);
    const wov = getWaveObjectValue(oref, false);
    if (wov === undefined) {
        return;
    }
    if (setFn === undefined) {
        setFn = globalStore.set;
    }
    setFn(wov.dataAtom, { value: value, loading: false, error: false });
    if (pushToServer) {
        fireAndForget(() => ObjectService.UpdateObject(value, false));
    }
}

export {
    callBackendService,
    getObjectValue,
    getWaveObjectAtom,
    getWaveObjectErrorAtom,
    getWaveObjectLoadingAtom,
    getWaveObjectValue,
    isWaveObjectNullAtom,
    loadAndPinWaveObject,
    makeORef,
    mockObjectForPreview,
    reloadCachedWaveObjects,
    reloadWaveObject,
    setObjectValue,
    splitORef,
    updateWaveObject,
    updateWaveObjects,
    useWaveObjectValue,
    wpsSubscribeToObject,
};
