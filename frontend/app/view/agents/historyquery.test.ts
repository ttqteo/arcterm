// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { describe, expect, it } from "vitest";
import {
    HISTORY_PAGE_SIZE,
    HISTORY_RPC_TIMEOUT_MS,
    NO_FILTERS,
    RESTORE_THRESHOLD_MS,
    SLOW_HISTORY_MS,
    activeFilterCount,
    anyFilterActive,
    countLabel,
    hasMorePages,
    noMatchSentence,
    restoreNotice,
    slowSeconds,
    toHistoryQuery,
} from "./historyquery";

describe("activeFilterCount / anyFilterActive", () => {
    it("counts only non-blank fields", () => {
        expect(activeFilterCount(NO_FILTERS)).toBe(0);
        expect(anyFilterActive(NO_FILTERS)).toBe(false);
        expect(activeFilterCount({ author: "dana", path: "", text: "" })).toBe(1);
        expect(activeFilterCount({ author: "dana", path: "src/**", text: "refund" })).toBe(3);
    });

    it("treats whitespace as blank, so a stray space does not read as a filter", () => {
        expect(activeFilterCount({ author: "   ", path: "", text: "" })).toBe(0);
        expect(anyFilterActive({ author: "   ", path: "", text: "" })).toBe(false);
    });
});

describe("toHistoryQuery", () => {
    it("omits blank fields rather than sending empty strings", () => {
        expect(toHistoryQuery(NO_FILTERS)).toEqual({});
        expect(toHistoryQuery({ author: "dana", path: "", text: "" })).toEqual({ author: "dana" });
    });

    it("maps free text onto grep and trims every field", () => {
        expect(toHistoryQuery({ author: " dana ", path: " src/** ", text: " refund " })).toEqual({
            author: "dana",
            path: "src/**",
            grep: "refund",
        });
    });
});

describe("countLabel", () => {
    it("reports what is loaded, never a repository total the surface has not counted", () => {
        expect(countLabel(NO_FILTERS, 50, false)).toBe("50 commits loaded");
        expect(countLabel(NO_FILTERS, 1, false)).toBe("1 commit loaded");
        expect(countLabel({ author: "dana", path: "", text: "" }, 4, false)).toBe("4 matching commits");
        expect(countLabel(NO_FILTERS, 0, true)).toBe("");
    });
});

describe("hasMorePages", () => {
    it("assumes more only when the page came back full", () => {
        expect(hasMorePages(HISTORY_PAGE_SIZE)).toBe(true);
        expect(hasMorePages(HISTORY_PAGE_SIZE - 1)).toBe(false);
        expect(hasMorePages(0)).toBe(false);
    });
});

describe("restoreNotice", () => {
    const away = RESTORE_THRESHOLD_MS + 1;

    it("stays silent for a quick flip away and back, however much was restored", () => {
        expect(
            restoreNotice({
                awayMs: RESTORE_THRESHOLD_MS - 1,
                commit: "c41d8ecafe",
                scroll: 420,
                filters: { author: "dana", path: "", text: "" },
                topRowHash: "aaaaaaa",
            })
        ).toBeNull();
    });

    it("stays silent when nothing but the default came back", () => {
        expect(
            restoreNotice({ awayMs: away, commit: "aaaaaaa", scroll: 0, filters: NO_FILTERS, topRowHash: "aaaaaaa" })
        ).toBeNull();
    });

    it("names the short hash, the scroll offset and the filter count", () => {
        expect(
            restoreNotice({
                awayMs: away,
                commit: "c41d8ecafe0011",
                scroll: 420,
                filters: { author: "dana", path: "src/**", text: "" },
                topRowHash: "aaaaaaa",
            })
        ).toBe("Back where you left off: commit c41d8ec, your scroll position and 2 filters.");
    });

    it("uses the singular for one filter and no list separator for a single item", () => {
        expect(
            restoreNotice({
                awayMs: away,
                commit: null,
                scroll: 0,
                filters: { author: "dana", path: "", text: "" },
                topRowHash: "aaa",
            })
        ).toBe("Back where you left off: 1 filter.");
    });

    // the working-tree row's hash is "" and it is the default selection on a dirty tree, so it must
    // never count as "you were somewhere unusual"
    it("does not count the uncommitted row as a restored selection", () => {
        expect(restoreNotice({ awayMs: away, commit: "", scroll: 0, filters: NO_FILTERS, topRowHash: "" })).toBeNull();
    });
});

describe("noMatchSentence", () => {
    it("reads the author and the text together", () => {
        expect(noMatchSentence({ author: "Kael", path: "", text: "workerr" })).toBe(
            "No commit by Kael mentions “workerr”."
        );
    });
    it("reads one filter alone", () => {
        expect(noMatchSentence({ author: "Kael", path: "", text: "" })).toBe("No commit by Kael.");
        expect(noMatchSentence({ author: "", path: "", text: "workerr" })).toBe("No commit mentions “workerr”.");
    });
    it("adds the path as its own clause", () => {
        expect(noMatchSentence({ author: "", path: "pkg/", text: "" })).toBe("No commit touches pkg/.");
        expect(noMatchSentence({ author: "Kael", path: "pkg/", text: "x" })).toBe(
            "No commit by Kael mentions “x” and touches pkg/."
        );
    });
});

describe("slowSeconds", () => {
    it("is silent for the first ten seconds", () => {
        expect(slowSeconds(1_000, 1_000 + SLOW_HISTORY_MS - 1)).toBeNull();
    });
    it("counts whole seconds once the read is slow", () => {
        expect(slowSeconds(1_000, 1_000 + 14_400)).toBe(14);
    });
    it("is silent when nothing is loading", () => {
        expect(slowSeconds(null, 99_000)).toBeNull();
    });
});

describe("the history read's RPC budget", () => {
    // gitinfo's own git timeout is 10 s: the RPC must outlast it so git's error, which names the command,
    // ends a hung read instead of the RPC's bare 5 s default
    it("outlasts git's 10 s timeout", () => {
        expect(HISTORY_RPC_TIMEOUT_MS).toBe(15_000);
        expect(HISTORY_RPC_TIMEOUT_MS).toBeGreaterThan(10_000);
    });
});
