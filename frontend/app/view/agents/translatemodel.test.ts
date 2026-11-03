// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { describe, expect, it } from "vitest";
import {
    DEFAULT_PAIR,
    DETECT,
    entryKey,
    HISTORY_MAX,
    historyEntryFor,
    historyView,
    isCurrent,
    langName,
    LANGUAGES,
    looksTranslatable,
    MAX_CHARS,
    PAIR_KEY,
    parseHistory,
    parsePair,
    pasteSuggestion,
    pickVoice,
    recordEntry,
    removeEntry,
    requestFor,
    rowPairLabel,
    speechCodeFor,
    speechLang,
    swap,
    toggleStar,
    TRANSLATE_DEBOUNCE_MS,
    translateErrorLine,
    wordDetails,
    type HistoryEntry,
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
    it("does not promise a retry while Google rests after a 429", () => {
        expect(
            translateErrorLine(new Error("Google answered 429 Too Many Requests; arcterm asks it again after 23:55"))
        ).toBe(
            "Couldn't translate: Google answered 429 Too Many Requests; arcterm asks it again after 23:55. Your text stays here."
        );
        // Apple Translation tried too and failed: the rest is still named
        expect(
            translateErrorLine(
                "Google turned away too many requests; arcterm asks it again after 9:05; Apple Translation: it doesn't translate English into Latin"
            )
        ).toMatch(/Latin\. Your text stays here\.$/);
    });
});

describe("history", () => {
    const entry = (text: string, over: Partial<HistoryEntry> = {}): HistoryEntry => ({
        text,
        translation: `vi:${text}`,
        source: "en",
        target: "vi",
        starred: false,
        at: 1,
        ...over,
    });
    const texts = (h: HistoryEntry[]) => h.map((e) => e.text);

    it("makes an entry from an answer, trimmed, and none for blank text or a blank translation", () => {
        const pair = { source: "en", target: "vi" };
        expect(historyEntryFor("  compaction \n", pair, result({ translation: " sự nén chặt " }), 7)).toEqual({
            text: "compaction",
            translation: "sự nén chặt",
            source: "en",
            target: "vi",
            starred: false,
            at: 7,
        });
        expect(historyEntryFor("   ", pair, result(), 7)).toBeNull();
        expect(historyEntryFor("hello", pair, result({ translation: "  " }), 7)).toBeNull();
    });
    it("files a Detect language answer under the language detected, and under Detect when it is unknown", () => {
        const pair = { source: DETECT, target: "vi" };
        expect(historyEntryFor("hallo", pair, result({ source: "de" }), 1)?.source).toBe("de");
        expect(historyEntryFor("hallo", pair, result({ source: "" }), 1)?.source).toBe(DETECT);
        expect(historyEntryFor("hallo", pair, result({ source: "xx" }), 1)?.source).toBe(DETECT);
    });
    it("records at the top, and the same text through the same pair moves up keeping its star", () => {
        let h = recordEntry([], entry("assess"));
        h = recordEntry(h, entry("council"));
        h = toggleStar(h, entryKey(entry("assess")));
        h = recordEntry(h, entry("assess", { translation: "đánh giá", at: 9 }));
        expect(texts(h)).toEqual(["assess", "council"]);
        expect(h[0]).toMatchObject({ translation: "đánh giá", starred: true, at: 9 });
    });
    it("keeps the same text through another pair as its own entry", () => {
        let h = recordEntry([], entry("hello"));
        h = recordEntry(h, entry("hello", { target: "ja" }));
        expect(h).toHaveLength(2);
    });
    it("keeps HISTORY_MAX unstarred entries and every starred one", () => {
        let h: HistoryEntry[] = [];
        h = recordEntry(h, entry("first"));
        h = toggleStar(h, entryKey(entry("first")));
        for (let i = 0; i < HISTORY_MAX + 5; i++) {
            h = recordEntry(h, entry(`w${i}`));
        }
        expect(h.filter((e) => !e.starred)).toHaveLength(HISTORY_MAX);
        expect(h.at(-1)?.text).toBe("first");
        expect(texts(h)).not.toContain("w0");
        // unstarring it lets the cap drop it
        h = toggleStar(h, entryKey(entry("first")));
        expect(texts(h)).not.toContain("first");
    });
    it("removes one entry", () => {
        const h = [entry("a"), entry("b")];
        expect(texts(removeEntry(h, entryKey(entry("a"))))).toEqual(["b"]);
    });
    it("shows every row, or the starred ones", () => {
        const h = [entry("a"), entry("b", { starred: true })];
        expect(texts(historyView(h, "all"))).toEqual(["a", "b"]);
        expect(texts(historyView(h, "starred"))).toEqual(["b"]);
    });
    it("reads back what it wrote and drops what is malformed", () => {
        const h = [entry("a", { starred: true }), entry("b")];
        expect(parseHistory(JSON.stringify(h))).toEqual(h);
        expect(parseHistory(null)).toEqual([]);
        expect(parseHistory("{not json")).toEqual([]);
        expect(parseHistory(JSON.stringify({ text: "a" }))).toEqual([]);
        expect(
            parseHistory(
                JSON.stringify([null, { text: "", translation: "x", source: "en", target: "vi", at: 1 }, h[1]])
            )
        ).toEqual([h[1]]);
        // a missing star reads as unstarred
        const { starred: _s, ...noStar } = h[1];
        expect(parseHistory(JSON.stringify([noStar]))[0].starred).toBe(false);
    });
    it("names a row's pair only when it is not the pair chosen now", () => {
        expect(rowPairLabel(entry("a"), { source: "en", target: "vi" })).toBeNull();
        expect(rowPairLabel(entry("a", { target: "ja" }), { source: "en", target: "vi" })).toBe("English → Japanese");
        expect(rowPairLabel(entry("a"), { source: DETECT, target: "vi" })).toBeNull();
        expect(rowPairLabel(entry("a", { source: DETECT }), { source: "fr", target: "vi" })).toBe(
            "Detect language → Vietnamese"
        );
    });
});

describe("reading aloud", () => {
    it("reads Google's codes as BCP 47, and nothing for Detect language", () => {
        expect(speechLang("vi")).toBe("vi");
        expect(speechLang("zh-CN")).toBe("zh-CN");
        expect(speechLang("iw")).toBe("he");
        expect(speechLang("jw")).toBe("jv");
        expect(speechLang(DETECT)).toBeNull();
        expect(speechLang("")).toBeNull();
    });
    it("reads the input in the source, the detected one under Detect language, and the translation in the target", () => {
        const pair = { source: "en", target: "vi" };
        expect(speechCodeFor("input", pair, null)).toBe("en");
        expect(speechCodeFor("output", pair, null)).toBe("vi");
        const detect = { source: DETECT, target: "vi" };
        expect(speechCodeFor("input", detect, result({ source: "de" }))).toBe("de");
        expect(speechCodeFor("input", detect, null)).toBeNull();
    });
    it("picks the exact tag before the base language, then the default, then an on-device voice", () => {
        const v = (name: string, lang: string, extra: { default?: boolean; localService?: boolean } = {}) => ({
            name,
            lang,
            ...extra,
        });
        const voices = [
            v("Tingting", "zh_CN", { localService: true }),
            v("Meijia", "zh-TW", { localService: true }),
            v("Samantha", "en-US", { default: true, localService: true }),
            v("Daniel", "en-GB", { localService: true }),
            v("Google US", "en-US"),
            v("Linh", "vi-VN", { localService: true }),
        ];
        expect(pickVoice(voices, "zh-TW")?.name).toBe("Meijia");
        expect(pickVoice(voices, "zh-CN")?.name).toBe("Tingting");
        expect(pickVoice(voices, "en")?.name).toBe("Samantha");
        expect(pickVoice(voices, "en-GB")?.name).toBe("Daniel");
        expect(pickVoice(voices, "vi")?.name).toBe("Linh");
        expect(pickVoice(voices, "ja")).toBeNull();
        expect(pickVoice([], "en")).toBeNull();
    });
});

describe("looksTranslatable", () => {
    it("takes a word, a phrase or a short sentence in any script", () => {
        for (const t of [
            "serendipity",
            "At a glance",
            "  well-known  ",
            "don't",
            "Trong nháy mắt",
            "お疲れ様です",
            "The build is orchestrated by Task, a make replacement.",
            "## At a glance",
            "two lines\nof prose",
        ]) {
            expect(looksTranslatable(t), t).toBe(true);
        }
    });

    it("refuses links, addresses and paths", () => {
        for (const t of [
            "https://example.com/a",
            "see https://example.com for more",
            "www.example.com",
            "mailto:me@example.com",
            "me@example.com",
            "/Users/me/notes.md",
            "~/Downloads",
            "./scripts/verify.mjs",
            "C:\\Users\\me",
            "frontend/app",
        ]) {
            expect(looksTranslatable(t), t).toBe(false);
        }
    });

    it("refuses file names, identifiers, hashes and numbers", () => {
        for (const t of [
            "photo.png",
            "translatemodel.ts",
            "translate_model",
            "pasteSuggestion",
            "6e31e2e04",
            "a3f9c2d1-77b0-4c1e-9d2a-0b8f1e2c3d4e",
            "v0.15.11",
            "1,234.56",
            "(555) 123-4567",
            "#12345",
        ]) {
            expect(looksTranslatable(t), t).toBe(false);
        }
    });

    it("refuses commands and code", () => {
        for (const t of [
            "git status",
            "npm run build",
            "$ ls -la",
            "task dev --watch",
            "const x = { a: 1 }",
            "return a && b",
            "<div>hi</div>",
            "`code`",
            "doThing();",
        ]) {
            expect(looksTranslatable(t), t).toBe(false);
        }
    });

    it("refuses blank, long and many-line text", () => {
        expect(looksTranslatable("")).toBe(false);
        expect(looksTranslatable("   \n ")).toBe(false);
        expect(looksTranslatable("word ".repeat(70))).toBe(false);
        expect(looksTranslatable("one\ntwo\nthree\nfour")).toBe(false);
    });
});

describe("pasteSuggestion", () => {
    it("offers the copied text, trimmed", () => {
        expect(pasteSuggestion("  At a glance\n", "", "")).toBe("At a glance");
    });

    it("offers nothing for no text or text that is not words", () => {
        expect(pasteSuggestion(null, "", "")).toBeNull();
        expect(pasteSuggestion("https://example.com", "", "")).toBeNull();
    });

    it("offers nothing the box already holds or the translation just made", () => {
        expect(pasteSuggestion("At a glance", " At a glance ", "")).toBeNull();
        expect(pasteSuggestion("Trong nháy mắt", "At a glance", "Trong nháy mắt")).toBeNull();
        expect(pasteSuggestion("serendipity", "At a glance", "Trong nháy mắt")).toBe("serendipity");
    });
});
