// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { describe, expect, it } from "vitest";
import {
    defaultRangeFor,
    historyKey,
    historyOptsFor,
    measuredAgainst,
    originCwd,
    originKey,
    rangeKey,
    scopeKey,
    scopeProjectName,
    type DiffRange,
    type DiffScope,
} from "./diffscope";
import { NO_FILTERS } from "./historyquery";

const agentScope: DiffScope = {
    repo: { origin: { kind: "agent", id: "a1" }, label: "jarvis-recall" },
    range: { kind: "session", agentId: "a1" },
};
const projectScope: DiffScope = {
    repo: { origin: { kind: "project", name: "waveterm", path: "/repo" }, label: "waveterm" },
    range: { kind: "working" },
};
const runScope: DiffScope = {
    repo: { origin: { kind: "run", runId: "r1", cwd: "/repo", baseCommit: "9f2c1de" }, label: "run 9f2c1de" },
    range: { kind: "run", runId: "r1", baseCommit: "9f2c1de" },
};

const worktreeScope: DiffScope = {
    repo: {
        origin: { kind: "worktree", path: "D:\\repo\\.worktrees\\feat", project: "waveterm" },
        label: "feat",
    },
    range: { kind: "working" },
};

describe("scopeKey", () => {
    // Load-bearing: githistorystore compares this against the previous load to tell a remount from a
    // genuine subject change, which is what keeps scroll offset and selection across a nav switch.
    it("is stable for the same scope", () => {
        expect(scopeKey(agentScope)).toBe(scopeKey({ ...agentScope }));
    });

    it("separates an agent, a project and a run that all answer to the same id", () => {
        const keys = new Set([
            scopeKey({ repo: { origin: { kind: "agent", id: "x" }, label: "x" }, range: { kind: "working" } }),
            scopeKey({
                repo: { origin: { kind: "project", name: "x", path: "/x" }, label: "x" },
                range: { kind: "working" },
            }),
            scopeKey({
                repo: { origin: { kind: "run", runId: "x", cwd: "/x", baseCommit: "" }, label: "x" },
                range: { kind: "working" },
            }),
        ]);
        expect(keys.size).toBe(3);
    });

    it("changes when the range changes, so a stale change-list read cannot land on a new range", () => {
        expect(scopeKey(agentScope)).not.toBe(scopeKey({ ...agentScope, range: { kind: "working" } }));
    });
});

describe("historyKey", () => {
    // Decision 5 of the design: the commit list depends on directory and filters only. The anchor
    // never reaches git — it only labels a divider — so it must not sit in the identity that decides
    // whether to blank the list and scroll to the top.
    it("is stable for the same directory and filters", () => {
        expect(historyKey("/repo", NO_FILTERS)).toBe(historyKey("/repo", NO_FILTERS));
    });

    it("changes when a filter changes", () => {
        expect(historyKey("/repo", NO_FILTERS)).not.toBe(historyKey("/repo", { ...NO_FILTERS, author: "kael" }));
    });

    it("changes when the directory changes", () => {
        expect(historyKey("/repo", NO_FILTERS)).not.toBe(historyKey("/other", NO_FILTERS));
    });
});

describe("historyOptsFor", () => {
    it("labels the session anchor and names what the top row counts", () => {
        expect(historyOptsFor({ kind: "session", agentId: "a1" }, "base9")).toEqual({
            anchor: "base9",
            anchorLabel: "session start",
            rowLabel: "Since session start",
        });
    });

    it("labels the run's base commit", () => {
        expect(historyOptsFor({ kind: "run", runId: "r1", baseCommit: "9f2c1de" }, "")).toEqual({
            anchor: "9f2c1de",
            anchorLabel: "run base",
            rowLabel: "Run changes",
        });
    });

    // No label on purpose: in the working-tree range the top row's count really is uncommitted work
    // against HEAD, so naming it would be noise.
    it("gives the working-tree range no anchor and no label", () => {
        expect(historyOptsFor({ kind: "working" }, "")).toEqual({});
    });
});

describe("compare range", () => {
    it("carries the range it interrupted so leaving restores it", () => {
        const interrupted = { kind: "session", agentId: "a1" } as const;
        const compare = { kind: "compare", base: "main", head: "feat", form: "mergebase", from: interrupted } as const;
        expect(compare.from).toEqual(interrupted);
    });

    it("is a distinct scope identity per ref pair", () => {
        const a: DiffScope = {
            ...agentScope,
            range: { kind: "compare", base: "main", head: "feat", form: "mergebase", from: { kind: "working" } },
        };
        const b: DiffScope = {
            ...agentScope,
            range: { kind: "compare", base: "main", head: "other", form: "mergebase", from: { kind: "working" } },
        };
        expect(scopeKey(a)).not.toBe(scopeKey(b));
    });
});

describe("originCwd", () => {
    // An agent's directory is resolved asynchronously from its transcript, so it is the one origin
    // that cannot answer synchronously.
    it("answers for a project and a run, and defers for an agent", () => {
        expect(originCwd({ kind: "project", name: "waveterm", path: "/repo" })).toBe("/repo");
        expect(originCwd({ kind: "run", runId: "r1", cwd: "/repo", baseCommit: "x" })).toBe("/repo");
        expect(originCwd({ kind: "agent", id: "a1" })).toBeNull();
    });
});

describe("defaultRangeFor", () => {
    it("opens an agent on its session, a project on its working tree, and a run on the run", () => {
        expect(defaultRangeFor({ kind: "agent", id: "a1" })).toEqual({ kind: "session", agentId: "a1" });
        expect(defaultRangeFor({ kind: "project", name: "w", path: "/r" })).toEqual({ kind: "working" });
        expect(defaultRangeFor({ kind: "run", runId: "r1", cwd: "/r", baseCommit: "9f2c1de" })).toEqual({
            kind: "run",
            runId: "r1",
            baseCommit: "9f2c1de",
        });
    });
});

describe("compare range form", () => {
    const mergebase: DiffRange = {
        kind: "compare",
        base: "main",
        head: "feature",
        form: "mergebase",
        from: { kind: "working" },
    };

    // the key is what drops stale reads, so two forms of the same pair must not share one
    it("distinguishes the two forms in rangeKey", () => {
        expect(rangeKey(mergebase)).not.toBe(rangeKey({ ...mergebase, form: "tips" }));
    });
});

describe("worktree origin", () => {
    // git hands back forward slashes, the registry backslashes, and NTFS ignores case: one checkout
    // must be one scope however its path arrived
    it("keys two spellings of one Windows path alike", () => {
        expect(originKey({ kind: "worktree", path: "D:\\Repo\\.worktrees\\feat\\", project: "waveterm" })).toBe(
            originKey({ kind: "worktree", path: "d:/repo/.worktrees/feat", project: "waveterm" })
        );
        expect(originKey(worktreeScope.repo.origin)).toBe("worktree:d:/repo/.worktrees/feat");
    });

    it("answers its directory synchronously and opens on the working tree", () => {
        expect(originCwd(worktreeScope.repo.origin)).toBe("D:\\repo\\.worktrees\\feat");
        expect(defaultRangeFor(worktreeScope.repo.origin)).toEqual({ kind: "working" });
    });
});

describe("scopeProjectName", () => {
    const projects = [
        { name: "waveterm", path: "D:\\repo" },
        { name: "other", path: "D:\\other" },
    ];

    // a linked worktree is not registered, so a path match would find nothing and Send no agents
    it("names a worktree's own project even when its path matches none", () => {
        expect(scopeProjectName(worktreeScope.repo.origin, projects, "D:/repo/.worktrees/feat")).toBe("waveterm");
    });

    it("names a project by its origin", () => {
        expect(scopeProjectName(projectScope.repo.origin, projects, "D:/other")).toBe("waveterm");
    });

    it("matches a run or an agent to a project by path", () => {
        expect(scopeProjectName(runScope.repo.origin, projects, "d:/other/")).toBe("other");
        expect(scopeProjectName(agentScope.repo.origin, projects, "D:\\repo")).toBe("waveterm");
        expect(scopeProjectName(agentScope.repo.origin, projects, "D:/elsewhere")).toBe("");
        expect(scopeProjectName(undefined, projects, "")).toBe("");
    });
});

describe("measuredAgainst", () => {
    const working: DiffRange = { kind: "working" };
    const session: DiffRange = { kind: "session", agentId: "a1" };
    const compare = (form: "mergebase" | "tips"): DiffRange => ({
        kind: "compare",
        base: "main",
        head: "feat/x",
        form,
        from: working,
    });

    it("names a selected commit by its short hash", () => {
        expect(measuredAgainst({ range: working, commit: "310d518abcdef" })).toBe("in 310d518");
        expect(measuredAgainst({ range: session, commit: "310d518abcdef" })).toBe("in 310d518");
    });

    it("says what a working-tree file is measured against", () => {
        expect(measuredAgainst({ range: working, commit: null })).toBe("vs HEAD");
    });

    it("says a session row reaches back to the session start", () => {
        expect(measuredAgainst({ range: session, commit: null })).toBe("since session start");
    });

    it("says a run row reaches back to the run's base", () => {
        expect(measuredAgainst({ range: { kind: "run", runId: "r1", baseCommit: "9f2c1de0" }, commit: null })).toBe(
            "since run base 9f2c1de"
        );
        expect(measuredAgainst({ range: { kind: "run", runId: "r1", baseCommit: "" }, commit: null })).toBe("vs HEAD");
    });

    it("names both refs of a comparison, head first, as the compare bar does", () => {
        expect(measuredAgainst({ range: compare("mergebase"), commit: null })).toBe("feat/x vs main");
        expect(measuredAgainst({ range: compare("tips"), commit: null })).toBe("feat/x vs main, tip to tip");
    });

    it("names a compare commit by its hash, not the comparison", () => {
        expect(measuredAgainst({ range: compare("mergebase"), commit: "abcdef1234" })).toBe("in abcdef1");
    });
});

// A landed run is bounded at its own tip: the key, the default range and the history walk all carry it, and an
// unbounded run reads exactly as it always has.
describe("a landed run's tip", () => {
    const landedOrigin = {
        kind: "run",
        runId: "r1",
        cwd: "/repo",
        baseCommit: "9f2c1de",
        headCommit: "c0ffee1",
    } as const;

    // review marks persist by this key, so an unbounded run must keep the key it always had
    it("keeps today's rangeKey for an unbounded run and appends the tip for a landed one", () => {
        expect(rangeKey({ kind: "run", runId: "r1", baseCommit: "9f2c1de" })).toBe("run:r1:9f2c1de");
        expect(rangeKey({ kind: "run", runId: "r1", baseCommit: "9f2c1de", headCommit: "c0ffee1" })).toBe(
            "run:r1:9f2c1de:c0ffee1"
        );
        expect(rangeKey({ kind: "run", runId: "r1", baseCommit: "9f2c1de", headCommit: "" })).toBe("run:r1:9f2c1de");
    });

    it("carries the tip into the run's default range, and leaves it out when there is none", () => {
        expect(defaultRangeFor(landedOrigin)).toEqual({
            kind: "run",
            runId: "r1",
            baseCommit: "9f2c1de",
            headCommit: "c0ffee1",
        });
        expect(defaultRangeFor({ kind: "run", runId: "r1", cwd: "/r", baseCommit: "9f2c1de" })).toStrictEqual({
            kind: "run",
            runId: "r1",
            baseCommit: "9f2c1de",
        });
    });

    it("gives a bounded run a scope key of its own", () => {
        const bounded: DiffScope = {
            repo: { origin: landedOrigin, label: "run" },
            range: defaultRangeFor(landedOrigin),
        };
        expect(scopeKey(bounded)).not.toBe(scopeKey(runScope));
    });

    // --all would list the commits that landed after the run above its base; the run's own tip does not
    it("walks a landed run's history from its tip", () => {
        expect(historyOptsFor({ kind: "run", runId: "r1", baseCommit: "9f2c1de", headCommit: "c0ffee1" }, "")).toEqual({
            anchor: "9f2c1de",
            anchorLabel: "run base",
            rowLabel: "Run changes",
            ref: "c0ffee1",
        });
        expect(historyOptsFor({ kind: "run", runId: "r1", baseCommit: "", headCommit: "c0ffee1" }, "")).toEqual({
            ref: "c0ffee1",
        });
    });

    it("walks every ref for an unbounded run, a session, the working tree and a comparison", () => {
        expect(historyOptsFor({ kind: "run", runId: "r1", baseCommit: "9f2c1de" }, "")).not.toHaveProperty("ref");
        expect(historyOptsFor({ kind: "session", agentId: "a1" }, "base9")).not.toHaveProperty("ref");
        expect(historyOptsFor({ kind: "working" }, "")).toStrictEqual({});
    });
});

describe("historyKey with a ref", () => {
    // walking every ref and walking from a tip are different answers from git
    it("changes when the walked ref changes and keeps today's key when there is none", () => {
        expect(historyKey("/repo", NO_FILTERS, "c0ffee1")).not.toBe(historyKey("/repo", NO_FILTERS));
        expect(historyKey("/repo", NO_FILTERS, "c0ffee1")).not.toBe(historyKey("/repo", NO_FILTERS, "d00d123"));
        expect(historyKey("/repo", NO_FILTERS, "")).toBe(historyKey("/repo", NO_FILTERS));
        expect(historyKey("/repo", NO_FILTERS)).toBe(`/repo|${NO_FILTERS.author}|${NO_FILTERS.path}|${NO_FILTERS.text}`);
    });
});
