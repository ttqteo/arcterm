// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/app/store/wshclientapi", () => ({
    RpcApi: { TranslateCommand: vi.fn(), NoteScratchWriteCommand: vi.fn(), NoteScratchReadCommand: vi.fn() },
}));
vi.mock("@/app/store/wshrpcutil", () => ({ TabRpcClient: {} }));
vi.mock("./floatstore", async () => {
    const { atom } = await import("jotai");
    return { enterFloat: vi.fn(), floatModeAtom: atom(false) };
});

import { globalStore } from "@/app/store/jotaiStore";
import { RpcApi } from "@/app/store/wshclientapi";
import { floatNoteOpenAtom } from "./floatnotestore";
import { floatModeAtom } from "./floatstore";
import {
    DEFAULT_PAIR,
    PAIR_KEY,
    TRANSLATE_DEBOUNCE_MS,
    translateErrorLine,
    type TranslateResult,
} from "./translatemodel";
import {
    clearTranslate,
    closeTranslate,
    openTranslate,
    readStoredPair,
    setPair,
    setTranslateText,
    swapTranslate,
    toggleTranslate,
    translateErrorAtom,
    translateOpenAtom,
    translatePairAtom,
    translateResultAtom,
    translateTextAtom,
} from "./translatestore";

const rpc = vi.mocked(RpcApi.TranslateCommand);

const answer = (translation: string, source = "en"): TranslateResult => ({ translation, source });

// a reply the test settles by hand, so two requests can be answered out of order
function deferred() {
    let resolve!: (r: TranslateResult) => void;
    let reject!: (e: unknown) => void;
    const promise = new Promise<TranslateResult>((res, rej) => {
        resolve = res;
        reject = rej;
    });
    return { promise, resolve, reject };
}

const text = () => globalStore.get(translateTextAtom);
const result = () => globalStore.get(translateResultAtom);
const error = () => globalStore.get(translateErrorAtom);
const pair = () => globalStore.get(translatePairAtom);

beforeEach(() => {
    vi.useFakeTimers();
    vi.resetAllMocks();
    // a request or timer left by the last test must not leak into this one
    clearTranslate();
    closeTranslate();
    globalStore.set(floatModeAtom, false);
    globalStore.set(floatNoteOpenAtom, false);
    globalStore.set(translatePairAtom, { ...DEFAULT_PAIR });
    rpc.mockImplementation(async (_c, req) => answer(`vi:${req.text}`));
});

afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
});

describe("setTranslateText", () => {
    it("sends one request, TRANSLATE_DEBOUNCE_MS after the last keystroke", async () => {
        setTranslateText("c");
        await vi.advanceTimersByTimeAsync(300);
        setTranslateText("compaction");
        await vi.advanceTimersByTimeAsync(TRANSLATE_DEBOUNCE_MS - 1);
        expect(rpc).not.toHaveBeenCalled();
        await vi.advanceTimersByTimeAsync(1);
        expect(rpc).toHaveBeenCalledTimes(1);
        expect(rpc).toHaveBeenCalledWith({}, { source: "en", target: "vi", text: "compaction" });
        expect(result()).toEqual(answer("vi:compaction"));
    });
    it("shows the text at once, before any request", () => {
        setTranslateText("hello");
        expect(text()).toBe("hello");
        expect(rpc).not.toHaveBeenCalled();
    });
    it("never lets a stale reply overwrite a newer one", async () => {
        const first = deferred();
        const second = deferred();
        rpc.mockReturnValueOnce(first.promise).mockReturnValueOnce(second.promise);
        setTranslateText("one");
        await vi.advanceTimersByTimeAsync(TRANSLATE_DEBOUNCE_MS);
        setTranslateText("two");
        await vi.advanceTimersByTimeAsync(TRANSLATE_DEBOUNCE_MS);
        expect(rpc).toHaveBeenCalledTimes(2);
        second.resolve(answer("hai"));
        await vi.advanceTimersByTimeAsync(0);
        first.resolve(answer("mot"));
        await vi.advanceTimersByTimeAsync(0);
        expect(result()).toEqual(answer("hai"));
    });
    it("drops a stale failure as well", async () => {
        const first = deferred();
        const second = deferred();
        rpc.mockReturnValueOnce(first.promise).mockReturnValueOnce(second.promise);
        setTranslateText("one");
        await vi.advanceTimersByTimeAsync(TRANSLATE_DEBOUNCE_MS);
        setTranslateText("two");
        await vi.advanceTimersByTimeAsync(TRANSLATE_DEBOUNCE_MS);
        second.resolve(answer("hai"));
        await vi.advanceTimersByTimeAsync(0);
        first.reject(new Error("late"));
        await vi.advanceTimersByTimeAsync(0);
        expect(error()).toBeNull();
        expect(result()).toEqual(answer("hai"));
    });
    it("drops a reply that arrives after the box was emptied", async () => {
        const reply = deferred();
        rpc.mockReturnValueOnce(reply.promise);
        setTranslateText("one");
        await vi.advanceTimersByTimeAsync(TRANSLATE_DEBOUNCE_MS);
        setTranslateText("");
        reply.resolve(answer("mot"));
        await vi.advanceTimersByTimeAsync(0);
        expect(result()).toBeNull();
    });
    it("treats whitespace as blank: nothing is sent and the translation goes", async () => {
        setTranslateText("one");
        await vi.advanceTimersByTimeAsync(TRANSLATE_DEBOUNCE_MS);
        expect(result()).not.toBeNull();
        setTranslateText("   ");
        await vi.advanceTimersByTimeAsync(TRANSLATE_DEBOUNCE_MS);
        expect(rpc).toHaveBeenCalledTimes(1);
        expect(result()).toBeNull();
    });
    it("cancels the request a blank text overtakes", async () => {
        setTranslateText("one");
        setTranslateText("");
        await vi.advanceTimersByTimeAsync(TRANSLATE_DEBOUNCE_MS * 2);
        expect(rpc).not.toHaveBeenCalled();
    });
});

describe("clearTranslate", () => {
    it("empties the input, the translation and the error", async () => {
        setTranslateText("one");
        await vi.advanceTimersByTimeAsync(TRANSLATE_DEBOUNCE_MS);
        clearTranslate();
        expect(text()).toBe("");
        expect(result()).toBeNull();
        expect(error()).toBeNull();
    });
    it("drops a reply still out, so a late one never refills the cleared result", async () => {
        const reply = deferred();
        rpc.mockReturnValueOnce(reply.promise);
        setTranslateText("one");
        await vi.advanceTimersByTimeAsync(TRANSLATE_DEBOUNCE_MS);
        clearTranslate();
        reply.resolve(answer("mot"));
        await vi.advanceTimersByTimeAsync(0);
        expect(result()).toBeNull();
    });
    it("cancels a request still waiting on the debounce", async () => {
        setTranslateText("one");
        clearTranslate();
        await vi.advanceTimersByTimeAsync(TRANSLATE_DEBOUNCE_MS * 2);
        expect(rpc).not.toHaveBeenCalled();
    });
});

describe("setPair", () => {
    it("translates the current text into the new pair at once, without the debounce pause", async () => {
        setTranslateText("hello");
        await vi.advanceTimersByTimeAsync(TRANSLATE_DEBOUNCE_MS);
        rpc.mockClear();
        setPair({ source: "en", target: "fr" });
        await vi.advanceTimersByTimeAsync(0);
        expect(rpc).toHaveBeenCalledTimes(1);
        expect(rpc).toHaveBeenCalledWith({}, { source: "en", target: "fr", text: "hello" });
        expect(pair()).toEqual({ source: "en", target: "fr" });
    });
    it("sends nothing for a blank box", async () => {
        setPair({ source: "en", target: "fr" });
        await vi.advanceTimersByTimeAsync(TRANSLATE_DEBOUNCE_MS);
        expect(rpc).not.toHaveBeenCalled();
    });
    it("round-trips through localStorage", () => {
        const store = new Map<string, string>();
        vi.stubGlobal("localStorage", {
            getItem: (k: string) => store.get(k) ?? null,
            setItem: (k: string, v: string) => void store.set(k, v),
        });
        setPair({ source: "auto", target: "ja" });
        expect(JSON.parse(store.get(PAIR_KEY) ?? "null")).toEqual({ source: "auto", target: "ja" });
        expect(readStoredPair()).toEqual({ source: "auto", target: "ja" });
    });
    it("reads the default when storage is missing, throws or holds garbage", () => {
        expect(readStoredPair()).toEqual(DEFAULT_PAIR);
        vi.stubGlobal("localStorage", {
            getItem: () => {
                throw new Error("blocked");
            },
            setItem: () => {
                throw new Error("blocked");
            },
        });
        expect(readStoredPair()).toEqual(DEFAULT_PAIR);
        setPair({ source: "en", target: "de" });
        expect(pair()).toEqual({ source: "en", target: "de" });
        vi.stubGlobal("localStorage", { getItem: () => "{not json", setItem: () => {} });
        expect(readStoredPair()).toEqual(DEFAULT_PAIR);
    });
});

describe("swapTranslate", () => {
    it("flips the pair, moves the translation into the input and translates it back at once", async () => {
        setTranslateText("hello");
        await vi.advanceTimersByTimeAsync(TRANSLATE_DEBOUNCE_MS);
        rpc.mockClear();
        swapTranslate();
        expect(pair()).toEqual({ source: "vi", target: "en" });
        expect(text()).toBe("vi:hello");
        expect(result()).toBeNull();
        await vi.advanceTimersByTimeAsync(0);
        expect(rpc).toHaveBeenCalledWith({}, { source: "vi", target: "en", text: "vi:hello" });
        expect(result()).toEqual(answer("vi:vi:hello"));
    });
    it("uses the detected language as the target when the source is Detect language", async () => {
        globalStore.set(translatePairAtom, { source: "auto", target: "vi" });
        rpc.mockResolvedValueOnce(answer("xin chao", "fr"));
        setTranslateText("bonjour");
        await vi.advanceTimersByTimeAsync(TRANSLATE_DEBOUNCE_MS);
        swapTranslate();
        expect(pair()).toEqual({ source: "vi", target: "fr" });
        expect(text()).toBe("xin chao");
    });
    it("does nothing from Detect language before anything is detected", async () => {
        globalStore.set(translatePairAtom, { source: "auto", target: "vi" });
        setTranslateText("bonjour");
        swapTranslate();
        await vi.advanceTimersByTimeAsync(TRANSLATE_DEBOUNCE_MS);
        expect(pair()).toEqual({ source: "auto", target: "vi" });
        expect(text()).toBe("bonjour");
        // the one request is the typed text's own
        expect(rpc).toHaveBeenCalledTimes(1);
    });
});

describe("the engine", () => {
    it("falls through the native stub to the RPC", async () => {
        setTranslateText("hello");
        await vi.advanceTimersByTimeAsync(TRANSLATE_DEBOUNCE_MS);
        expect(rpc).toHaveBeenCalledTimes(1);
        expect(result()).toEqual(answer("vi:hello"));
    });
    it("asks a scenario's stub first, and never the RPC", async () => {
        const stub = vi.fn(async (req: { text: string }) => answer(`stub:${req.text}`));
        vi.stubGlobal("window", { __arcTranslateStub: stub });
        setTranslateText("hello");
        await vi.advanceTimersByTimeAsync(TRANSLATE_DEBOUNCE_MS);
        expect(stub).toHaveBeenCalledWith({ source: "en", target: "vi", text: "hello" });
        expect(rpc).not.toHaveBeenCalled();
        expect(result()).toEqual(answer("stub:hello"));
    });
});

describe("a failed request", () => {
    it("sets the error line and keeps the text", async () => {
        const err = new Error("text is over 5000 characters");
        rpc.mockRejectedValueOnce(err);
        setTranslateText("hello");
        await vi.advanceTimersByTimeAsync(TRANSLATE_DEBOUNCE_MS);
        expect(error()).toBe(translateErrorLine(err));
        expect(text()).toBe("hello");
        expect(result()).toBeNull();
    });
    it("is cleared by the next answer", async () => {
        rpc.mockRejectedValueOnce(new Error("offline"));
        setTranslateText("hello");
        await vi.advanceTimersByTimeAsync(TRANSLATE_DEBOUNCE_MS);
        expect(error()).not.toBeNull();
        setTranslateText("hello!");
        await vi.advanceTimersByTimeAsync(TRANSLATE_DEBOUNCE_MS);
        expect(error()).toBeNull();
        expect(result()).toEqual(answer("vi:hello!"));
    });
    it("is cleared by emptying the box", async () => {
        rpc.mockRejectedValueOnce(new Error("offline"));
        setTranslateText("hello");
        await vi.advanceTimersByTimeAsync(TRANSLATE_DEBOUNCE_MS);
        clearTranslate();
        expect(error()).toBeNull();
    });
});

describe("the panel", () => {
    it("opens, closes and toggles", () => {
        openTranslate();
        expect(globalStore.get(translateOpenAtom)).toBe(true);
        closeTranslate();
        expect(globalStore.get(translateOpenAtom)).toBe(false);
        toggleTranslate();
        expect(globalStore.get(translateOpenAtom)).toBe(true);
        toggleTranslate();
        expect(globalStore.get(translateOpenAtom)).toBe(false);
    });
    it("keeps the text and the translation across a close", async () => {
        openTranslate();
        setTranslateText("hello");
        await vi.advanceTimersByTimeAsync(TRANSLATE_DEBOUNCE_MS);
        closeTranslate();
        expect(text()).toBe("hello");
        expect(result()).toEqual(answer("vi:hello"));
    });
});

describe("Float", () => {
    const open = () => globalStore.get(translateOpenAtom);
    const noteOpen = () => globalStore.get(floatNoteOpenAtom);
    it("closes the panel when Float starts, so the rail's panel does not turn into Float's", () => {
        openTranslate();
        globalStore.set(floatModeAtom, true);
        expect(open()).toBe(false);
    });
    it("closes the panel when Float ends, so Float's panel does not turn into the rail's", () => {
        globalStore.set(floatModeAtom, true);
        openTranslate();
        expect(open()).toBe(true);
        globalStore.set(floatModeAtom, false);
        expect(open()).toBe(false);
    });
    it("keeps the text and the translation across a Float round trip", async () => {
        setTranslateText("hello");
        await vi.advanceTimersByTimeAsync(TRANSLATE_DEBOUNCE_MS);
        globalStore.set(floatModeAtom, true);
        globalStore.set(floatModeAtom, false);
        expect(text()).toBe("hello");
        expect(result()).toEqual(answer("vi:hello"));
    });
    it("opening the panel closes the note", () => {
        globalStore.set(floatModeAtom, true);
        globalStore.set(floatNoteOpenAtom, true);
        toggleTranslate();
        expect(open()).toBe(true);
        expect(noteOpen()).toBe(false);
    });
    it("opening the note closes the panel", () => {
        globalStore.set(floatModeAtom, true);
        openTranslate();
        globalStore.set(floatNoteOpenAtom, true);
        expect(open()).toBe(false);
        expect(noteOpen()).toBe(true);
    });
    it("closing the panel leaves a closed note closed and Float on", () => {
        globalStore.set(floatModeAtom, true);
        openTranslate();
        closeTranslate();
        expect(open()).toBe(false);
        expect(noteOpen()).toBe(false);
        expect(globalStore.get(floatModeAtom)).toBe(true);
    });
});
