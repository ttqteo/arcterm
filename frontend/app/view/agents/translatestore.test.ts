// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/app/store/wshclientapi", () => ({
    RpcApi: { TranslateCommand: vi.fn(), NoteScratchWriteCommand: vi.fn(), NoteScratchReadCommand: vi.fn() },
}));
vi.mock("@/app/store/wshrpcutil", () => ({ TabRpcClient: {} }));
vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn() }));
vi.mock("./floatstore", async () => {
    const { atom } = await import("jotai");
    return { enterFloat: vi.fn(), floatModeAtom: atom(false) };
});

import { globalStore } from "@/app/store/jotaiStore";
import { RpcApi } from "@/app/store/wshclientapi";
import { invoke } from "@tauri-apps/api/core";
import { floatNoteOpenAtom } from "./floatnotestore";
import { floatModeAtom } from "./floatstore";
import {
    DEFAULT_PAIR,
    entryKey,
    HISTORY_KEY,
    HISTORY_SETTLE_MS,
    PAIR_KEY,
    TRANSLATE_DEBOUNCE_MS,
    translateErrorLine,
    type TranslateResult,
} from "./translatemodel";
import {
    acceptClipSuggestion,
    checkClipboard,
    clearTranslate,
    closeTranslate,
    openTranslate,
    readStoredHistory,
    readStoredPair,
    removeHistoryEntry,
    reuseHistoryEntry,
    setPair,
    setTranslateText,
    swapTranslate,
    toggleHistoryStar,
    toggleTranslate,
    translateClipAtom,
    translateClipBlockedAtom,
    translateErrorAtom,
    translateHistoryAtom,
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
    globalStore.set(translateHistoryAtom, []);
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

describe("history", () => {
    const history = () => globalStore.get(translateHistoryAtom);
    const texts = () => history().map((e) => e.text);
    // types a text and lets its answer arrive
    async function translateText(t: string) {
        setTranslateText(t);
        await vi.advanceTimersByTimeAsync(TRANSLATE_DEBOUNCE_MS);
    }

    it("records an answer once it has stood HISTORY_SETTLE_MS with no edit", async () => {
        await translateText("compaction");
        expect(history()).toEqual([]);
        await vi.advanceTimersByTimeAsync(HISTORY_SETTLE_MS);
        expect(history()).toEqual([
            expect.objectContaining({ text: "compaction", translation: "vi:compaction", source: "en", target: "vi" }),
        ]);
    });
    it("drops the answer to a half-typed word when typing goes on", async () => {
        await translateText("compa");
        await vi.advanceTimersByTimeAsync(HISTORY_SETTLE_MS / 2);
        await translateText("compaction");
        await vi.advanceTimersByTimeAsync(HISTORY_SETTLE_MS);
        expect(texts()).toEqual(["compaction"]);
    });
    it("records at once when the panel closes, the box is cleared, the pair changes or ⇄ is pressed", async () => {
        openTranslate();
        await translateText("close");
        closeTranslate();
        expect(texts()).toEqual(["close"]);
        await translateText("clear");
        clearTranslate();
        expect(texts()).toEqual(["clear", "close"]);
        await translateText("pair");
        setPair({ source: "en", target: "fr" });
        expect(texts()).toEqual(["pair", "clear", "close"]);
        await vi.advanceTimersByTimeAsync(HISTORY_SETTLE_MS);
        expect(history()[0]).toMatchObject({ text: "pair", target: "fr" });
        setPair({ ...DEFAULT_PAIR });
        await translateText("swap");
        swapTranslate();
        expect(history()[0]).toMatchObject({ text: "swap", target: "vi" });
    });
    it("records nothing for a failed request", async () => {
        rpc.mockRejectedValue(new Error("offline"));
        await translateText("hello");
        await vi.advanceTimersByTimeAsync(HISTORY_SETTLE_MS);
        closeTranslate();
        expect(history()).toEqual([]);
    });
    it("a row brings its pair and text back and translates them at once", async () => {
        await translateText("hello");
        closeTranslate();
        const [entry] = history();
        clearTranslate();
        setPair({ source: "en", target: "ja" });
        rpc.mockClear();
        reuseHistoryEntry(entry);
        expect(pair()).toEqual({ source: "en", target: "vi" });
        expect(text()).toBe("hello");
        // no debounce: the request is out before the debounce would have fired
        await vi.advanceTimersByTimeAsync(0);
        expect(rpc).toHaveBeenCalledTimes(1);
        expect(result()).toEqual(answer("vi:hello"));
    });
    it("stars, unstars and removes a row", async () => {
        await translateText("assess");
        closeTranslate();
        const key = entryKey(history()[0]);
        toggleHistoryStar(key);
        expect(history()[0].starred).toBe(true);
        toggleHistoryStar(key);
        expect(history()[0].starred).toBe(false);
        removeHistoryEntry(key);
        expect(history()).toEqual([]);
    });
    it("round-trips through localStorage", async () => {
        const store = new Map<string, string>();
        vi.stubGlobal("localStorage", {
            getItem: (k: string) => store.get(k) ?? null,
            setItem: (k: string, v: string) => void store.set(k, v),
        });
        await translateText("flashy");
        closeTranslate();
        toggleHistoryStar(entryKey(history()[0]));
        expect(readStoredHistory()).toEqual(history());
        expect(JSON.parse(store.get(HISTORY_KEY) ?? "[]")[0]).toMatchObject({ text: "flashy", starred: true });
    });
    it("holds the history for the session when storage is blocked", async () => {
        vi.stubGlobal("localStorage", {
            getItem: () => {
                throw new Error("blocked");
            },
            setItem: () => {
                throw new Error("blocked");
            },
        });
        expect(readStoredHistory()).toEqual([]);
        await translateText("skeptic");
        closeTranslate();
        expect(texts()).toEqual(["skeptic"]);
    });
});

describe("the paste suggestion", () => {
    const host = vi.mocked(invoke);
    const clip = () => globalStore.get(translateClipAtom);
    // the clipboard's change counter outlives a test in the store, so every copy here is newer than the last
    let change = 1000;
    function copy(text: string | null, blocked = false): number {
        change += 1;
        const now = change;
        host.mockImplementation(async (_cmd, args) => ({
            change: now,
            text: (args as { since: number }).since === now ? null : text,
            blocked,
        }));
        return now;
    }

    it("offers a copied word when the panel opens", async () => {
        openTranslate();
        copy("serendipity");
        await checkClipboard();
        expect(host).toHaveBeenCalledWith("clipboard_text", { since: expect.any(Number) });
        expect(clip()).toBe("serendipity");
    });
    it("offers nothing for a link or a file name", async () => {
        openTranslate();
        copy("https://example.com/a");
        await checkClipboard();
        expect(clip()).toBeNull();
        copy("photo.png");
        await checkClipboard();
        expect(clip()).toBeNull();
    });
    it("offers each copy once: closing passes it over, and reopening reads nothing new", async () => {
        openTranslate();
        const now = copy("glance");
        await checkClipboard();
        expect(clip()).toBe("glance");
        closeTranslate();
        expect(clip()).toBeNull();
        openTranslate();
        await checkClipboard();
        expect(host).toHaveBeenLastCalledWith("clipboard_text", { since: now });
        expect(clip()).toBeNull();
    });
    it("leaves a copy unread when the panel closed before the answer", async () => {
        openTranslate();
        copy("later");
        const check = checkClipboard();
        closeTranslate();
        await check;
        expect(clip()).toBeNull();
        openTranslate();
        await checkClipboard();
        expect(clip()).toBe("later");
    });
    it("taking it fills the box and translates at once, no debounce", async () => {
        openTranslate();
        copy("At a glance");
        await checkClipboard();
        acceptClipSuggestion();
        expect(text()).toBe("At a glance");
        expect(clip()).toBeNull();
        // the engine asks once its on-device check has passed: a tick, far short of TRANSLATE_DEBOUNCE_MS
        await vi.advanceTimersByTimeAsync(0);
        expect(rpc).toHaveBeenCalledWith({}, { source: "en", target: "vi", text: "At a glance" });
        expect(result()).toEqual(answer("vi:At a glance"));
    });
    it("replaces the text the box held", async () => {
        openTranslate();
        setTranslateText("old words");
        copy("new words");
        await checkClipboard();
        acceptClipSuggestion();
        expect(text()).toBe("new words");
    });
    it("typing passes it over", async () => {
        openTranslate();
        copy("glance");
        await checkClipboard();
        setTranslateText("g");
        expect(clip()).toBeNull();
        acceptClipSuggestion();
        expect(text()).toBe("g");
    });
    it("is not the text the box holds or the translation just copied", async () => {
        openTranslate();
        setTranslateText("flashy");
        await vi.advanceTimersByTimeAsync(TRANSLATE_DEBOUNCE_MS);
        copy("vi:flashy");
        await checkClipboard();
        expect(clip()).toBeNull();
        copy("flashy");
        await checkClipboard();
        expect(clip()).toBeNull();
    });
    it("says when macOS denies the clipboard, and stops saying it once allowed", async () => {
        openTranslate();
        copy(null, true);
        await checkClipboard();
        expect(globalStore.get(translateClipBlockedAtom)).toBe(true);
        expect(clip()).toBeNull();
        copy("allowed");
        await checkClipboard();
        expect(globalStore.get(translateClipBlockedAtom)).toBe(false);
        expect(clip()).toBe("allowed");
    });
    it("survives a host that cannot answer", async () => {
        openTranslate();
        host.mockRejectedValue(new Error("the browser app answers no Tauri command clipboard_text"));
        const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
        await checkClipboard();
        expect(clip()).toBeNull();
        warn.mockRestore();
    });
});
