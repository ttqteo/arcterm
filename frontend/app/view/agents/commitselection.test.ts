// frontend/app/view/agents/commitselection.test.ts
import { describe, expect, it } from "vitest";
import {
    NO_TICKS,
    amendAllowed,
    canCommit,
    commitLabel,
    groupTickState,
    isTicked,
    pruneTicks,
    setManyTicked,
    setTicked,
    tickedPaths,
} from "./commitselection";
import type { GitChange } from "./gitstatus";

const f = (path: string, status: string, extra: Partial<GitChange> = {}): GitChange => ({
    path,
    status,
    adds: 1,
    dels: 0,
    ...extra,
});
const a = f("a.ts", "M");
const n = f("new.md", "?");
const repo = f("vendor/tool/", "?", { note: "repo" });
const sub = f("reference/PoCGen", "M", { note: "dirty" });
const mv = f("lib/b.ts", "R", { from: "lib/a.ts" });

describe("commit ticks", () => {
    it("ticks tracked changes and leaves untracked ones off by default", () => {
        expect(isTicked(NO_TICKS, a)).toBe(true);
        expect(isTicked(NO_TICKS, n)).toBe(false);
    });

    it("never ticks a row a commit here cannot carry", () => {
        expect(isTicked(NO_TICKS, sub)).toBe(false);
        expect(isTicked(setTicked(NO_TICKS, repo, true), repo)).toBe(false);
    });

    it("stores only exceptions, so a choice equal to the default leaves nothing behind", () => {
        const t = setTicked(setTicked(NO_TICKS, a, false), a, true);
        expect(t).toEqual(NO_TICKS);
    });

    it("prunes paths that left the list", () => {
        const t = setTicked(setTicked(NO_TICKS, a, false), n, true);
        expect(pruneTicks(t, [a])).toEqual({ off: ["a.ts"], on: [] });
    });

    it("sends both ends of a rename", () => {
        expect(tickedPaths(NO_TICKS, [a, n, mv])).toEqual(["a.ts", "lib/b.ts", "lib/a.ts"]);
    });

    it("reads a group as all, some or none over its committable rows", () => {
        expect(groupTickState(NO_TICKS, [a, sub])).toBe("all");
        expect(groupTickState(setTicked(NO_TICKS, a, false), [a, mv])).toBe("some");
        expect(groupTickState(setManyTicked(NO_TICKS, [a, mv], false), [a, mv])).toBe("none");
    });
});

describe("commit button", () => {
    it("names the count and the verb", () => {
        expect(commitLabel(1, false)).toBe("Commit 1 file");
        expect(commitLabel(3, true)).toBe("Amend with 3 files");
    });

    it("needs a message and a ticked file", () => {
        expect(canCommit("  ", 2)).toBe(false);
        expect(canCommit("fix", 0)).toBe(false);
        expect(canCommit("fix", 1)).toBe(true);
    });

    it("allows amend only while HEAD is unpushed", () => {
        expect(amendAllowed({ head: "abc", upstream: "origin/main", upstreamAhead: 0 })).toBe(false);
        expect(amendAllowed({ head: "abc", upstream: "origin/main", upstreamAhead: 2 })).toBe(true);
        expect(amendAllowed({ head: "abc", upstream: "", upstreamAhead: 0 })).toBe(true);
        expect(amendAllowed({ head: "", upstream: "", upstreamAhead: 0 })).toBe(false);
    });
});
