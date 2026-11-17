// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { describe, expect, it } from "vitest";
import {
    nextAskDelay,
    SEARCH_DEBOUNCE_MS,
    SEARCH_REASK_MS,
    searchHint,
    sessionInfoOf,
    snippetParts,
    splitSessionResults,
    titleMatches,
} from "./sessionsearch";

function info(id: string, task: string, over: Partial<SessionInfo> = {}): SessionInfo {
    return {
        id,
        runtime: "claude",
        projectpath: "/p",
        projectname: "p",
        branch: "main",
        task,
        model: "m",
        tokenstotal: 0,
        lastactivets: 1,
        resumecommand: "claude --resume " + id,
        transcriptpath: `/t/${id}.jsonl`,
        ...over,
    };
}

function activity(id: string, task: string, over: Partial<SessionActivity> = {}): SessionActivity {
    return { ...info(id, task), status: "done", startedts: 0, durationms: 0, events: [], ...over } as SessionActivity;
}

function result(id: string, task: string, hits: SessionHit[] = [hit()]): SessionSearchResult {
    return { session: activity(id, task), hits, turnhits: hits.length, eventhits: 0 };
}

function hit(): SessionHit {
    return { kind: "turn", speaker: "user", ord: 0, text: "x", marks: [[0, 1]] };
}

describe("titleMatches", () => {
    it("needs every term in the title, in any order", () => {
        expect(titleMatches("Fix the flaky timeout test", ["timeout", "flaky"])).toBe(true);
        expect(titleMatches("Fix the flaky test", ["timeout", "flaky"])).toBe(false);
    });

    it("ignores case and matches a phrase as one term", () => {
        expect(titleMatches("Dial TIMEOUT in hook", ["dial timeout"])).toBe(true);
        expect(titleMatches("Dial then timeout", ["dial timeout"])).toBe(false);
    });

    it("folds as findRanges does, diacritics and emoji included", () => {
        expect(titleMatches("🙂 Lỗi kết nối", ["lỗi"])).toBe(true);
        expect(titleMatches("LỖI", ["lỗi"])).toBe(true);
        expect(titleMatches("loi ket noi", ["lỗi"])).toBe(false);
    });

    it("holds for no terms, which filters nothing", () => {
        expect(titleMatches("anything", [])).toBe(true);
    });
});

describe("splitSessionResults", () => {
    const terms = ["flaky"];

    it("lists the loaded title matches, in the order loaded", () => {
        const loaded = [info("a", "flaky one"), info("b", "other"), info("c", "Flaky two")];
        const out = splitSessionResults(loaded, null, terms);
        expect(out.title.map((s) => s.id)).toEqual(["a", "c"]);
        expect(out.content).toEqual([]);
    });

    it("with no answer yet shows the title matches alone", () => {
        const out = splitSessionResults([info("a", "flaky")], null, terms);
        expect(out.title).toHaveLength(1);
        expect(out.content).toEqual([]);
    });

    it("adds the answer's title matches that are not loaded to the title group, after the loaded ones", () => {
        const loaded = [info("a", "flaky one")];
        const results = [result("old", "an old flaky session"), result("a", "flaky one")];
        const out = splitSessionResults(loaded, results, terms);
        expect(out.title.map((s) => s.id)).toEqual(["a", "old"]);
        expect(out.content).toEqual([]);
    });

    it("puts a result whose title does not match under content, with its result", () => {
        const loaded = [info("a", "flaky one")];
        const r = result("x", "unrelated title");
        const out = splitSessionResults(loaded, [result("a", "flaky one"), r], terms);
        expect(out.title.map((s) => s.id)).toEqual(["a"]);
        expect(out.content).toHaveLength(1);
        expect(out.content[0].session.id).toBe("x");
        expect(out.content[0].result).toBe(r);
    });

    it("lists a loaded session the search matched by content under content, not title", () => {
        const loaded = [info("a", "some title")];
        const out = splitSessionResults(loaded, [result("a", "some title")], terms);
        expect(out.title).toEqual([]);
        expect(out.content.map((c) => c.session.id)).toEqual(["a"]);
    });

    it("never lists a session twice", () => {
        const loaded = [info("a", "flaky one")];
        const results = [result("a", "flaky one"), result("x", "other"), result("x", "other"), result("o", "flaky o")];
        const out = splitSessionResults(loaded, results, terms);
        const keys = [...out.title.map((s) => s.id), ...out.content.map((c) => c.session.id)];
        expect(keys).toEqual(["a", "o", "x"]);
        expect(new Set(keys).size).toBe(keys.length);
    });

    it("keeps the results' newest-first order within a group", () => {
        const out = splitSessionResults([], [result("n", "zzz"), result("m", "yyy"), result("l", "xxx")], terms);
        expect(out.content.map((c) => c.session.id)).toEqual(["n", "m", "l"]);
    });

    it("tells two runtimes' sessions with one id apart", () => {
        const loaded = [info("a", "flaky", { runtime: "claude" })];
        const r: SessionSearchResult = { ...result("a", "other"), session: activity("a", "other", { runtime: "pi" }) };
        const out = splitSessionResults(loaded, [r], terms);
        expect(out.title.map((s) => s.runtime)).toEqual(["claude"]);
        expect(out.content.map((c) => c.session.runtime)).toEqual(["pi"]);
    });

    it("converts a result's session to a SessionInfo", () => {
        const out = splitSessionResults([], [result("o", "flaky o")], terms);
        expect(out.title[0]).toEqual(info("o", "flaky o"));
    });
});

describe("sessionInfoOf", () => {
    it("keeps the SessionInfo fields and drops the activity ones", () => {
        const a = activity("a", "t", { resumeargs: ["--session", "/x"], runid: "r1", role: "lead", events: [] });
        expect(sessionInfoOf(a)).toEqual({ ...info("a", "t"), resumeargs: ["--session", "/x"] });
        expect(Object.keys(sessionInfoOf(a)).sort()).toEqual(
            [
                "branch",
                "id",
                "lastactivets",
                "model",
                "projectname",
                "projectpath",
                "resumeargs",
                "resumecommand",
                "runtime",
                "task",
                "tokenstotal",
                "transcriptpath",
            ].sort()
        );
    });

    it("leaves resumeargs out when the session has none", () => {
        expect("resumeargs" in sessionInfoOf(activity("a", "t"))).toBe(false);
    });
});

describe("snippetParts", () => {
    it("splits on marks including a mark at the start and end", () => {
        expect(
            snippetParts("abc def ghi", [
                [0, 3],
                [8, 11],
            ])
        ).toEqual([
            { text: "abc", mark: true },
            { text: " def ", mark: false },
            { text: "ghi", mark: true },
        ]);
    });

    it("returns the whole text unmarked when there are no marks", () => {
        expect(snippetParts("no marks", [])).toEqual([{ text: "no marks", mark: false }]);
        expect(snippetParts("", [])).toEqual([]);
    });

    it("reads marks as UTF-16 offsets, so an emoji before a mark counts two units", () => {
        expect(snippetParts("😀 lỗi here", [[3, 6]])).toEqual([
            { text: "😀 ", mark: false },
            { text: "lỗi", mark: true },
            { text: " here", mark: false },
        ]);
    });

    it("keeps touching marks apart and survives overlapping or out-of-range ones", () => {
        expect(
            snippetParts("aaaa", [
                [0, 2],
                [2, 4],
            ])
        ).toEqual([
            { text: "aa", mark: true },
            { text: "aa", mark: true },
        ]);
        expect(
            snippetParts("abcdef", [
                [0, 3],
                [2, 5],
            ]).map((p) => p.text)
        ).toEqual(["abc", "de", "f"]);
        expect(snippetParts("abc", [[1, 99]])).toEqual([
            { text: "a", mark: false },
            { text: "bc", mark: true },
        ]);
        expect(snippetParts("abc", [[50, 60]])).toEqual([{ text: "abc", mark: false }]);
    });
});

describe("searchHint", () => {
    it("counts the title and content groups", () => {
        expect(searchHint(1, 2, false)).toBe("1 title · 2 content");
        expect(searchHint(0, 0, false)).toBe("0 titles · 0 content");
        expect(searchHint(3, 1, false)).toBe("3 titles · 1 content");
    });

    it("says indexing while the answer is incomplete", () => {
        expect(searchHint(1, 2, true)).toBe("1 title · 2 content · indexing…");
    });
});

describe("nextAskDelay", () => {
    it("asks a new query after the debounce", () => {
        expect(nextAskDelay(["flaky"], "fresh")).toBe(SEARCH_DEBOUNCE_MS);
        expect(SEARCH_DEBOUNCE_MS).toBe(250);
    });

    it("asks again every 3 s while the answer is incomplete", () => {
        expect(nextAskDelay(["flaky"], "incomplete")).toBe(SEARCH_REASK_MS);
        expect(SEARCH_REASK_MS).toBe(3000);
    });

    it("stops once the answer is complete or failed", () => {
        expect(nextAskDelay(["flaky"], "settled")).toBeNull();
    });

    it("asks nothing for a query with no terms", () => {
        expect(nextAskDelay([], "fresh")).toBeNull();
        expect(nextAskDelay([], "incomplete")).toBeNull();
    });
});
