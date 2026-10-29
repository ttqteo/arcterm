// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { describe, expect, it } from "vitest";
import {
    DEFAULT_PAIR,
    DETECT,
    isCurrent,
    langName,
    LANGUAGES,
    MAX_CHARS,
    PAIR_KEY,
    parsePair,
    requestFor,
    swap,
    TRANSLATE_DEBOUNCE_MS,
    translateErrorLine,
    wordDetails,
    type TranslateResult,
} from "./translatemodel";

const result = (over: Partial<TranslateResult> = {}): TranslateResult => ({
    translation: "xin chào",
    source: "en",
    ...over,
});

describe("constants", () => {
    it("defaults to English -> Vietnamese and keeps the pair under translate.pair", () => {
        expect(DEFAULT_PAIR).toEqual({ source: "en", target: "vi" });
        expect(PAIR_KEY).toBe("translate.pair");
        expect(DETECT).toBe("auto");
        expect(MAX_CHARS).toBe(5000);
        expect(TRANSLATE_DEBOUNCE_MS).toBeGreaterThan(0);
    });
});

describe("LANGUAGES", () => {
    it("is sorted by English name", () => {
        const names = LANGUAGES.map((l) => l.name);
        expect(names).toEqual([...names].sort((a, b) => a.localeCompare(b)));
    });
    it("has unique codes and does not offer Detect language", () => {
        const codes = LANGUAGES.map((l) => l.code);
        expect(new Set(codes).size).toBe(codes.length);
        expect(codes).not.toContain(DETECT);
    });
    it("holds the default pair's languages", () => {
        expect(LANGUAGES).toContainEqual({ code: "en", name: "English" });
        expect(LANGUAGES).toContainEqual({ code: "vi", name: "Vietnamese" });
    });
});

describe("langName", () => {
    it("names a language, Detect language, and falls back to the code", () => {
        expect(langName("vi")).toBe("Vietnamese");
        expect(langName("auto")).toBe("Detect language");
        expect(langName("xx")).toBe("xx");
    });
});

describe("parsePair", () => {
    it("reads a saved pair", () => {
        expect(parsePair(JSON.stringify({ source: "fr", target: "de" }))).toEqual({ source: "fr", target: "de" });
    });
    it("keeps Detect language as the source", () => {
        expect(parsePair(JSON.stringify({ source: "auto", target: "ja" }))).toEqual({ source: "auto", target: "ja" });
    });
    it("falls back to the default for null, garbage and the wrong shape", () => {
        expect(parsePair(null)).toEqual(DEFAULT_PAIR);
        expect(parsePair("")).toEqual(DEFAULT_PAIR);
        expect(parsePair("not json")).toEqual(DEFAULT_PAIR);
        expect(parsePair("null")).toEqual(DEFAULT_PAIR);
        expect(parsePair('["en","vi"]')).toEqual(DEFAULT_PAIR);
        expect(parsePair(JSON.stringify({ source: "en" }))).toEqual(DEFAULT_PAIR);
        expect(parsePair(JSON.stringify({ source: 1, target: 2 }))).toEqual(DEFAULT_PAIR);
    });
    it("falls back to the default for an unknown code, on either side", () => {
        expect(parsePair(JSON.stringify({ source: "xx", target: "vi" }))).toEqual(DEFAULT_PAIR);
        expect(parsePair(JSON.stringify({ source: "en", target: "xx" }))).toEqual(DEFAULT_PAIR);
    });
    it("never takes auto as the target", () => {
        expect(parsePair(JSON.stringify({ source: "en", target: "auto" }))).toEqual(DEFAULT_PAIR);
    });
    it("hands out a copy, so a caller cannot change the default", () => {
        parsePair(null).target = "fr";
        expect(DEFAULT_PAIR.target).toBe("vi");
    });
});

describe("swap", () => {
    it("flips the pair and moves the translation into the input", () => {
        const s = swap({ pair: { source: "en", target: "vi" }, input: "hello", result: result() });
        expect(s).toEqual({ pair: { source: "vi", target: "en" }, input: "xin chào", result: null });
    });
    it("keeps the input when there is no translation yet", () => {
        const s = swap({ pair: { source: "en", target: "vi" }, input: "hello", result: null });
        expect(s).toEqual({ pair: { source: "vi", target: "en" }, input: "hello", result: null });
    });
    it("keeps the input when the translation is empty", () => {
        const s = swap({ pair: { source: "en", target: "vi" }, input: "hello", result: result({ translation: "" }) });
        expect(s.input).toBe("hello");
        expect(s.result).toBeNull();
    });
    it("from Detect language, the old target becomes the source and the detected language the target", () => {
        const s = swap({
            pair: { source: DETECT, target: "vi" },
            input: "bonjour",
            result: result({ translation: "xin chào", source: "fr" }),
        });
        expect(s).toEqual({ pair: { source: "vi", target: "fr" }, input: "xin chào", result: null });
    });
    it("from Detect language with nothing detected, comes back unchanged", () => {
        const none = { pair: { source: DETECT, target: "vi" }, input: "hello", result: null };
        expect(swap(none)).toBe(none);
        const blank = { pair: { source: DETECT, target: "vi" }, input: "hello", result: result({ source: "" }) };
        expect(swap(blank)).toBe(blank);
        const stillAuto = {
            pair: { source: DETECT, target: "vi" },
            input: "hello",
            result: result({ source: DETECT }),
        };
        expect(swap(stillAuto)).toBe(stillAuto);
    });
    it("from Detect language, a detected code the lists do not hold comes back unchanged", () => {
        const s = { pair: { source: DETECT, target: "vi" }, input: "hello", result: result({ source: "xx" }) };
        expect(swap(s)).toBe(s);
    });
    it("does not change the state it is given", () => {
        const s = { pair: { source: "en", target: "vi" }, input: "hello", result: result() };
        swap(s);
        expect(s.pair).toEqual({ source: "en", target: "vi" });
        expect(s.input).toBe("hello");
    });
});

describe("requestFor", () => {
    const pair = { source: "en", target: "vi" };
    it("is null for blank text", () => {
        expect(requestFor("", pair)).toBeNull();
        expect(requestFor("  \n\t ", pair)).toBeNull();
    });
    it("is the pair and the text otherwise", () => {
        expect(requestFor("hello", pair)).toEqual({ source: "en", target: "vi", text: "hello" });
    });
    it("still sends text over the limit, so wavesrv's refusal reaches the panel", () => {
        const long = "a".repeat(MAX_CHARS + 1);
        expect(requestFor(long, pair)).toEqual({ source: "en", target: "vi", text: long });
    });
});

describe("isCurrent", () => {
    it("is true only for the latest request", () => {
        expect(isCurrent(3, 3)).toBe(true);
        expect(isCurrent(2, 3)).toBe(false);
        expect(isCurrent(4, 3)).toBe(false);
    });
});

describe("wordDetails", () => {
    it("lists the word, its phonetic and its word classes", () => {
        const r = result({
            translation: "sự nén",
            phonetics: "kəmˈpakSHən",
            classes: [{ pos: "noun", words: ["sự nén"] }],
        });
        expect(wordDetails("compaction", r)).toEqual(["compaction", "kəmˈpakSHən", "Noun"]);
    });
    it("trims the input and lists every class in order", () => {
        const r = result({
            classes: [
                { pos: "noun", words: ["a"] },
                { pos: "verb", words: ["b"] },
            ],
        });
        expect(wordDetails("  run \n", r)).toEqual(["run", "Noun", "Verb"]);
    });
    it("works with a phonetic and no classes, or classes and no phonetic", () => {
        expect(wordDetails("cat", result({ phonetics: "kat" }))).toEqual(["cat", "kat"]);
        expect(wordDetails("cat", result({ classes: [{ pos: "noun", words: ["mèo"] }] }))).toEqual(["cat", "Noun"]);
    });
    it("is null for a sentence", () => {
        const r = result({ phonetics: "x", classes: [{ pos: "noun", words: ["y"] }] });
        expect(wordDetails("hello world", r)).toBeNull();
    });
    it("is null when the result has no details, or there is no result", () => {
        expect(wordDetails("cat", result())).toBeNull();
        expect(wordDetails("cat", result({ phonetics: "", classes: [] }))).toBeNull();
        expect(wordDetails("cat", null)).toBeNull();
    });
    it("is null for a blank input", () => {
        expect(wordDetails("   ", result({ phonetics: "x" }))).toBeNull();
    });
});

describe("translateErrorLine", () => {
    it("says what failed, that the text stays and that the next edit tries again", () => {
        const line = translateErrorLine(new Error("Error: Google answered 429."));
        expect(line).toBe(
            "Couldn't translate: Google answered 429. Your text stays here, and your next edit tries again."
        );
    });
    it("reads a string failure, as an RPC rejection gives", () => {
        expect(translateErrorLine("text is over 5000 characters")).toBe(
            "Couldn't translate: text is over 5000 characters. Your text stays here, and your next edit tries again."
        );
    });
    it("is one line, and drops an empty reason", () => {
        expect(translateErrorLine(new Error(""))).toBe(
            "Couldn't translate. Your text stays here, and your next edit tries again."
        );
        expect(translateErrorLine(new Error("bad\nthing"))).not.toContain("\n");
    });
});
