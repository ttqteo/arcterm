import { globalStore } from "@/app/store/jotaiStore";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { diffPairAtom, type DiffPair } from "./diffcontentstore";
import type { DiffRange } from "./diffscope";
import { buildFileTree, treeModeAtom } from "./filetree";
import type { GitChange } from "./gitstatus";
import {
    activeReviewAtom,
    clearReviewed,
    fingerprint,
    markState,
    MAX_REVIEW_SUBJECTS,
    nextUnreviewed,
    noteOpenPair,
    pairHash,
    parseStoredReviews,
    pruneSubjects,
    REVIEW_STORAGE_KEY,
    reviewMarksAtom,
    reviewOrder,
    reviewProgress,
    reviewSubjectFor,
    setReviewed,
    toggleOpenFile,
    toggleReviewed,
    type ReviewStore,
    type SubjectMarks,
} from "./reviewmarks";

const ch = (path: string, status = "M", adds = 1, dels = 0): GitChange => ({ path, status, adds, dels });
const pair = (path: string, original: string, modified: string): DiffPair => ({
    path,
    original,
    modified,
    binary: false,
    tooLarge: false,
    size: 0,
});
const SUBJECT = "/repo|working";

function mockLocalStorage(): { data: Record<string, string>; writes: () => number } {
    const data: Record<string, string> = {};
    let writes = 0;
    (globalThis as any).localStorage = {
        getItem: (k: string) => (k in data ? data[k] : null),
        setItem: (k: string, v: string) => {
            writes++;
            data[k] = v;
        },
        removeItem: (k: string) => {
            delete data[k];
        },
    };
    return { data, writes: () => writes };
}

function reset(): void {
    globalStore.set(reviewMarksAtom, {});
    globalStore.set(activeReviewAtom, null);
    globalStore.set(diffPairAtom, null);
    globalStore.set(treeModeAtom, true);
}

beforeEach(reset);
afterEach(() => {
    delete (globalThis as any).localStorage;
    vi.restoreAllMocks();
    reset();
});

describe("reviewSubjectFor", () => {
    const working: DiffRange = { kind: "working" };
    it("gives every commit and range kind its own key", () => {
        const ranges: DiffRange[] = [
            working,
            { kind: "session", agentId: "a1" },
            { kind: "run", runId: "r1", baseCommit: "abc" },
            { kind: "compare", base: "main", head: "feature", form: "mergebase", from: working },
            { kind: "compare", base: "main", head: "feature", form: "tips", from: working },
        ];
        const keys = [
            ...ranges.map((r) => reviewSubjectFor("/repo", r, null)),
            reviewSubjectFor("/repo", working, "abc"),
        ];
        expect(new Set(keys).size).toBe(keys.length);
        expect(keys).toContain("/repo|commit:abc");
        expect(keys).toContain("/repo|run:r1:abc");
    });

    it("keys a commit the same whichever range lists it", () => {
        const compare: DiffRange = { kind: "compare", base: "main", head: "feature", form: "tips", from: working };
        expect(reviewSubjectFor("/repo", compare, "abc")).toBe(reviewSubjectFor("/repo", working, "abc"));
    });

    it("is null without a cwd or a range", () => {
        expect(reviewSubjectFor(null, working, null)).toBeNull();
        expect(reviewSubjectFor("", working, null)).toBeNull();
        expect(reviewSubjectFor(undefined, working, "abc")).toBeNull();
        expect(reviewSubjectFor("/repo", null, null)).toBeNull();
        expect(reviewSubjectFor("/repo", undefined, "abc")).toBeNull();
    });
});

describe("pairHash", () => {
    it("is 8 hex digits, stable, and separates the two sides", () => {
        expect(pairHash("a", "b")).toMatch(/^[0-9a-f]{8}$/);
        expect(pairHash("a", "b")).toBe(pairHash("a", "b"));
        expect(pairHash("ab", "")).not.toBe(pairHash("a", "b"));
        expect(pairHash("", "")).toBe("050c5d1f"); // FNV-1a of a lone NUL
    });
});

describe("markState", () => {
    const c = ch("a.ts", "M", 3, 2);
    const marked = (mark: SubjectMarks["files"][string]): SubjectMarks => ({ at: 1, files: { "a.ts": mark } });

    it("is none with no mark", () => {
        expect(markState(undefined, c)).toBe("none");
        expect(markState({ at: 1, files: {} }, c)).toBe("none");
    });

    it("is ok when the fingerprint matches", () => {
        expect(markState(marked({ fp: fingerprint(c) }), c)).toBe("ok");
    });

    // a compare range whose tip moved keeps its key; the changed counts are what turn it stale
    it("is stale when the status, adds or dels changed", () => {
        const m = marked({ fp: fingerprint(c) });
        expect(markState(m, ch("a.ts", "A", 3, 2))).toBe("stale");
        expect(markState(m, ch("a.ts", "M", 4, 2))).toBe("stale");
        expect(markState(m, ch("a.ts", "M", 3, 1))).toBe("stale");
    });

    it("is stale when flagged, even with a matching fingerprint", () => {
        expect(markState(marked({ fp: fingerprint(c), stale: true }), c)).toBe("stale");
    });
});

describe("reviewProgress", () => {
    it("counts only listed files, and stale as unreviewed", () => {
        const files = [ch("a.ts"), ch("b.ts"), ch("c.ts")];
        const marks: SubjectMarks = {
            at: 1,
            files: {
                "a.ts": { fp: fingerprint(files[0]) },
                "b.ts": { fp: fingerprint(files[1]), stale: true },
                "gone.ts": { fp: "M:1:0" },
            },
        };
        expect(reviewProgress(marks, files)).toEqual({ done: 1, total: 3 });
        expect(reviewProgress(undefined, files)).toEqual({ done: 0, total: 3 });
        expect(reviewProgress(marks, [])).toEqual({ done: 0, total: 0 });
    });
});

describe("reviewOrder", () => {
    const files = [
        ch("README.md"),
        ch("src/retry/policy.go"),
        ch("src/a.ts"),
        ch("docs/x.md"),
        ch("src/retry/backoff.go"),
    ];

    it("follows buildFileTree's file rows in tree mode", () => {
        const expected = buildFileTree(files, new Set())
            .filter((r) => r.kind === "file")
            .map((r) => r.id);
        expect(reviewOrder(files, true)).toEqual(expected);
        expect(reviewOrder(files, true)).toEqual([
            "docs/x.md",
            "src/retry/backoff.go",
            "src/retry/policy.go",
            "src/a.ts",
            "README.md",
        ]);
    });

    it("keeps input order in flat mode", () => {
        expect(reviewOrder(files, false)).toEqual(files.map((c) => c.path));
    });
});

describe("nextUnreviewed", () => {
    const order = ["a", "b", "c", "d"];
    const reviewedOf = (done: string[]) => (p: string) => done.includes(p);

    it("skips reviewed paths", () => {
        expect(nextUnreviewed(order, "a", reviewedOf(["b"]))).toBe("c");
    });

    it("wraps round", () => {
        expect(nextUnreviewed(order, "c", reviewedOf(["d"]))).toBe("a");
    });

    it("never returns from, and is null when everything else is reviewed", () => {
        expect(nextUnreviewed(order, "b", reviewedOf(["a", "c", "d"]))).toBeNull();
        expect(nextUnreviewed(["a"], "a", reviewedOf([]))).toBeNull();
        expect(nextUnreviewed([], "a", reviewedOf([]))).toBeNull();
    });

    it("starts from the top when from is not in the order", () => {
        expect(nextUnreviewed(order, "zz", reviewedOf(["a"]))).toBe("b");
        expect(nextUnreviewed(order, "zz", reviewedOf(order))).toBeNull();
    });
});

describe("parseStoredReviews", () => {
    it("is empty for null, junk and the wrong shape", () => {
        vi.spyOn(console, "warn").mockImplementation(() => {});
        expect(parseStoredReviews(null)).toEqual({});
        expect(parseStoredReviews("{")).toEqual({});
        expect(parseStoredReviews("[]")).toEqual({});
        expect(parseStoredReviews('"x"')).toEqual({});
        expect(
            parseStoredReviews(
                JSON.stringify({
                    a: null,
                    b: { at: "1", files: {} },
                    c: { at: 1, files: [] },
                    d: { at: 1, files: { "x.ts": { fp: 3 } } },
                    e: { at: 1 },
                })
            )
        ).toEqual({});
    });

    it("keeps the well-formed entries beside malformed ones", () => {
        const raw = JSON.stringify({
            good: { at: 5, files: { "a.ts": { fp: "M:1:0", h: "abc", stale: true }, "b.ts": { h: "x" } } },
            bad: { files: {} },
        });
        expect(parseStoredReviews(raw)).toEqual({
            good: { at: 5, files: { "a.ts": { fp: "M:1:0", h: "abc", stale: true } } },
        });
    });
});

describe("pruneSubjects", () => {
    it("keeps the most recently touched subjects", () => {
        const store: ReviewStore = {};
        for (let i = 0; i < MAX_REVIEW_SUBJECTS + 5; i++) {
            store[`s${i}`] = { at: i, files: { f: { fp: "M:1:0" } } };
        }
        const pruned = pruneSubjects(store, MAX_REVIEW_SUBJECTS);
        expect(Object.keys(pruned)).toHaveLength(MAX_REVIEW_SUBJECTS);
        expect(pruned.s0).toBeUndefined();
        expect(pruned.s4).toBeUndefined();
        expect(pruned.s5).toBeDefined();
        expect(pruned[`s${MAX_REVIEW_SUBJECTS + 4}`]).toBeDefined();
    });

    it("returns the same store when under the cap", () => {
        const store: ReviewStore = { a: { at: 1, files: {} } };
        expect(pruneSubjects(store, 2)).toBe(store);
    });

    it("prunes on write", () => {
        const store: ReviewStore = {};
        for (let i = 0; i < MAX_REVIEW_SUBJECTS; i++) {
            store[`s${i}`] = { at: i, files: { f: { fp: "M:1:0" } } };
        }
        globalStore.set(reviewMarksAtom, store);
        setReviewed(SUBJECT, [ch("a.ts")], true);
        const next = globalStore.get(reviewMarksAtom);
        expect(Object.keys(next)).toHaveLength(MAX_REVIEW_SUBJECTS);
        expect(next.s0).toBeUndefined();
        expect(next[SUBJECT]).toBeDefined();
    });
});

describe("setReviewed", () => {
    it("stores the fingerprint, and the hash only for the file whose pair is loaded", () => {
        globalStore.set(diffPairAtom, pair("a.ts", "old", "new"));
        const a = ch("a.ts", "M", 2, 1);
        const b = ch("b.ts", "A", 5, 0);
        setReviewed(SUBJECT, [a, b], true);
        const files = globalStore.get(reviewMarksAtom)[SUBJECT].files;
        expect(files["a.ts"]).toEqual({ fp: "M:2:1", h: pairHash("old", "new") });
        expect(files["b.ts"]).toEqual({ fp: "A:5:0" });
    });

    it("re-marking a stale file clears the flag and refreshes fp and h", () => {
        globalStore.set(reviewMarksAtom, {
            [SUBJECT]: { at: 1, files: { "a.ts": { fp: "M:1:0", h: "deadbeef", stale: true } } },
        });
        globalStore.set(diffPairAtom, pair("a.ts", "x", "y"));
        setReviewed(SUBJECT, [ch("a.ts", "M", 4, 4)], true);
        const marks = globalStore.get(reviewMarksAtom)[SUBJECT];
        expect(marks.files["a.ts"]).toEqual({ fp: "M:4:4", h: pairHash("x", "y") });
        expect(marks.at).toBeGreaterThan(1);
    });

    it("off deletes the marks, and the subject once it is empty", () => {
        setReviewed(SUBJECT, [ch("a.ts"), ch("b.ts")], true);
        setReviewed(SUBJECT, [ch("a.ts")], false);
        expect(Object.keys(globalStore.get(reviewMarksAtom)[SUBJECT].files)).toEqual(["b.ts"]);
        setReviewed(SUBJECT, [ch("b.ts")], false);
        expect(globalStore.get(reviewMarksAtom)[SUBJECT]).toBeUndefined();
    });
});

describe("clearReviewed", () => {
    it("drops only the given subject", () => {
        setReviewed(SUBJECT, [ch("a.ts")], true);
        setReviewed("/repo|commit:abc", [ch("a.ts")], true);
        clearReviewed(SUBJECT);
        expect(Object.keys(globalStore.get(reviewMarksAtom))).toEqual(["/repo|commit:abc"]);
    });
});

describe("noteOpenPair", () => {
    function seed(mark: SubjectMarks["files"][string] | null): ReviewStore {
        const store: ReviewStore = mark ? { [SUBJECT]: { at: 1, files: { "a.ts": mark } } } : {};
        globalStore.set(reviewMarksAtom, store);
        return store;
    }

    it("flags the mark stale when the hash differs, and persists it", () => {
        const ls = mockLocalStorage();
        seed({ fp: "M:1:0", h: "11111111" });
        noteOpenPair(SUBJECT, "a.ts", "22222222");
        expect(globalStore.get(reviewMarksAtom)[SUBJECT].files["a.ts"]).toEqual({
            fp: "M:1:0",
            h: "11111111",
            stale: true,
        });
        expect(JSON.parse(ls.data[REVIEW_STORAGE_KEY])[SUBJECT].files["a.ts"].stale).toBe(true);
    });

    // the working-tree poll re-reads the open pair every few seconds
    it.each([
        ["the same hash", { fp: "M:1:0", h: "11111111" }],
        ["a mark without a hash", { fp: "M:1:0" }],
        ["an already stale mark", { fp: "M:1:0", h: "00000000", stale: true }],
        ["no mark", null],
    ])("is a no-op for %s", (_name, mark) => {
        const ls = mockLocalStorage();
        const store = seed(mark);
        noteOpenPair(SUBJECT, "a.ts", "11111111");
        expect(globalStore.get(reviewMarksAtom)).toBe(store);
        expect(ls.writes()).toBe(0);
    });
});

describe("toggleReviewed", () => {
    const files = [ch("README.md"), ch("src/retry/policy.go"), ch("src/retry/backoff.go")];

    function publish(open: string | null, subject = SUBJECT) {
        const select = vi.fn();
        globalStore.set(activeReviewAtom, { subject, files, open, select });
        return select;
    }

    it("marking the open file opens the next unreviewed one, wrapping in tree order", () => {
        const select = publish("README.md");
        toggleReviewed(SUBJECT, files[0]);
        expect(markState(globalStore.get(reviewMarksAtom)[SUBJECT], files[0])).toBe("ok");
        expect(select).toHaveBeenCalledWith("src/retry/backoff.go");
    });

    it("follows flat order in flat mode", () => {
        globalStore.set(treeModeAtom, false);
        const select = publish("README.md");
        toggleReviewed(SUBJECT, files[0]);
        expect(select).toHaveBeenCalledWith("src/retry/policy.go");
    });

    it("skips files already reviewed", () => {
        setReviewed(SUBJECT, [files[2]], true);
        const select = publish("README.md");
        toggleReviewed(SUBJECT, files[0]);
        expect(select).toHaveBeenCalledWith("src/retry/policy.go");
    });

    it("re-marks a stale file", () => {
        globalStore.set(reviewMarksAtom, { [SUBJECT]: { at: 1, files: { "README.md": { fp: "D:0:0" } } } });
        toggleReviewed(SUBJECT, files[0]);
        expect(markState(globalStore.get(reviewMarksAtom)[SUBJECT], files[0])).toBe("ok");
    });

    it("unmarking stays put", () => {
        setReviewed(SUBJECT, [files[0]], true);
        const select = publish("README.md");
        toggleReviewed(SUBJECT, files[0]);
        expect(markState(globalStore.get(reviewMarksAtom)[SUBJECT], files[0])).toBe("none");
        expect(select).not.toHaveBeenCalled();
    });

    it("marking a row that is not the open file stays put", () => {
        const select = publish("src/retry/policy.go");
        toggleReviewed(SUBJECT, files[0]);
        expect(select).not.toHaveBeenCalled();
    });

    it("marking in another subject stays put", () => {
        const select = publish("README.md", "/repo|commit:abc");
        toggleReviewed(SUBJECT, files[0]);
        expect(select).not.toHaveBeenCalled();
    });

    it("stays put when every other file is reviewed", () => {
        setReviewed(SUBJECT, files.slice(1), true);
        const select = publish("README.md");
        toggleReviewed(SUBJECT, files[0]);
        expect(select).not.toHaveBeenCalled();
    });
});

describe("toggleOpenFile", () => {
    it("is false with no active review, no open file, or an open file not listed", () => {
        expect(toggleOpenFile()).toBe(false);
        const select = vi.fn();
        globalStore.set(activeReviewAtom, { subject: SUBJECT, files: [ch("a.ts")], open: null, select });
        expect(toggleOpenFile()).toBe(false);
        globalStore.set(activeReviewAtom, { subject: SUBJECT, files: [ch("a.ts")], open: "gone.ts", select });
        expect(toggleOpenFile()).toBe(false);
        expect(globalStore.get(reviewMarksAtom)).toEqual({});
    });

    it("toggles the open file and moves on", () => {
        const select = vi.fn();
        const files = [ch("a.ts"), ch("b.ts")];
        globalStore.set(activeReviewAtom, { subject: SUBJECT, files, open: "a.ts", select });
        expect(toggleOpenFile()).toBe(true);
        expect(markState(globalStore.get(reviewMarksAtom)[SUBJECT], files[0])).toBe("ok");
        expect(select).toHaveBeenCalledWith("b.ts");
    });
});

describe("persistence", () => {
    it("writes the store to localStorage", () => {
        const ls = mockLocalStorage();
        setReviewed(SUBJECT, [ch("a.ts")], true);
        expect(parseStoredReviews(ls.data[REVIEW_STORAGE_KEY])).toEqual(globalStore.get(reviewMarksAtom));
    });

    it("keeps the marks in memory and logs when the write throws", () => {
        (globalThis as any).localStorage = {
            getItem: () => null,
            setItem: () => {
                throw new Error("QuotaExceededError");
            },
        };
        const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
        expect(() => setReviewed(SUBJECT, [ch("a.ts")], true)).not.toThrow();
        expect(globalStore.get(reviewMarksAtom)[SUBJECT].files["a.ts"]).toEqual({ fp: "M:1:0" });
        expect(warn).toHaveBeenCalled();
    });

    it("works with no localStorage at all", () => {
        expect((globalThis as any).localStorage).toBeUndefined();
        setReviewed(SUBJECT, [ch("a.ts")], true);
        expect(markState(globalStore.get(reviewMarksAtom)[SUBJECT], ch("a.ts"))).toBe("ok");
        clearReviewed(SUBJECT);
        expect(globalStore.get(reviewMarksAtom)).toEqual({});
    });

    it("seeds the atom from localStorage at module load", async () => {
        const ls = mockLocalStorage();
        const saved: ReviewStore = { [SUBJECT]: { at: 7, files: { "a.ts": { fp: "M:1:0" } } } };
        ls.data[REVIEW_STORAGE_KEY] = JSON.stringify(saved);
        vi.resetModules();
        const store = await import("@/app/store/jotaiStore");
        const fresh = await import("./reviewmarks");
        expect(store.globalStore.get(fresh.reviewMarksAtom)).toEqual(saved);
    });

    it("starts empty and logs when the stored marks are junk", async () => {
        mockLocalStorage().data[REVIEW_STORAGE_KEY] = "{not json";
        const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
        vi.resetModules();
        const store = await import("@/app/store/jotaiStore");
        const fresh = await import("./reviewmarks");
        expect(store.globalStore.get(fresh.reviewMarksAtom)).toEqual({});
        expect(warn).toHaveBeenCalled();
    });
});
