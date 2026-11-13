// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { describe, expect, it } from "vitest";
import {
    acceptDigest,
    cleanupOnly,
    DIGEST_RETRY_MS,
    formatElapsed,
    freshCounts,
    healthView,
    nextStepText,
    nextStepView,
    planShapeText,
    planWarnings,
    reportChips,
    shouldRefreshDigest,
    digestStale,
    lastUpdatedText,
    verifyRowLine,
    type TaskBrief,
} from "./dagdigest";

function digest(version: number): DagStatusDigest {
    return {
        dagversion: version,
        health: "healthy",
        counts: { total: 1, done: 0, running: 1, stalled: 0, dependencywaiting: 0, attention: 0, recoveredretry: 0, mergeready: 0 },
        next: { kind: "dispatch" },
        tasks: [],
        durations: { elapsedms: 0 },
        report: { workerms: 0, answered: 0, forwarded: 0 },
    };
}

describe("acceptDigest", () => {
    it("accepts a response matching the observed version from the newest request", () => {
        expect(acceptDigest(digest(4), 4, 7, 7)).toBe(true);
    });

    it("rejects a response for a stale group version", () => {
        expect(acceptDigest(digest(3), 4, 7, 7)).toBe(false);
    });

    it("rejects an older same-version response after a newer request started", () => {
        expect(acceptDigest(digest(4), 4, 5, 7)).toBe(false);
    });

    it("accepts the newest response even when a request failed in between", () => {
        expect(acceptDigest(digest(4), 4, 9, 9)).toBe(true);
    });
});

describe("shouldRefreshDigest", () => {
    it("refreshes on ask lifecycle events", () => {
        expect(shouldRefreshDigest("child-ask")).toBe(true);
        expect(shouldRefreshDigest("child-answered")).toBe(true);
        expect(shouldRefreshDigest("child-ask-cleared")).toBe(true);
    });

    it("refreshes on the boundaries the run timing derives from", () => {
        expect(shouldRefreshDigest("task-spawned")).toBe(true);
        expect(shouldRefreshDigest("final-step")).toBe(true);
        expect(shouldRefreshDigest("dag-done")).toBe(true);
    });

    it("refreshes when the final stage ends", () => {
        expect(shouldRefreshDigest("final-ended")).toBe(true);
    });

    it("does not refresh on activity ticks or unrelated kinds", () => {
        expect(shouldRefreshDigest(undefined)).toBe(false);
        expect(shouldRefreshDigest("phase-started")).toBe(false);
        expect(shouldRefreshDigest("task-first-activity")).toBe(false);
    });
});

describe("nextStepText", () => {
    it("renders each typed next kind deterministically", () => {
        expect(nextStepText({ kind: "human-action", actions: ["approve", "sendback"] })).toBe(
            "waiting on you — approve / sendback"
        );
        expect(nextStepText({ kind: "merge-ready" })).toBe("merge ready for review");
        expect(nextStepText({ kind: "dispatch" })).toBe("dispatching next task");
        expect(nextStepText({ kind: "parallelism-wait" })).toBe("waiting on parallelism limit");
        expect(nextStepText({ kind: "dependency-wait" })).toBe("waiting on dependencies");
        expect(nextStepText({ kind: "cleanup-wait" })).toBe("waiting on worktree cleanup");
        expect(nextStepText({ kind: "terminal", terminalstatus: "done" })).toBe("finished (done)");
    });

    // buildNext always names the status it ended in; a terminal step without one broke the digest contract,
    // and reading it as "done" would tell the human a run finished cleanly when nothing said so
    it("reports a terminal step with no status as a contract error, never as done", () => {
        expect(nextStepText({ kind: "terminal" })).toBe("finished with no status (digest contract error)");
        expect(nextStepText({ kind: "terminal", terminalstatus: "" })).toBe(
            "finished with no status (digest contract error)"
        );
        expect(nextStepText({ kind: "terminal", terminalstatus: "cancelled" })).toBe("finished (cancelled)");
    });

    it("falls back to a refresh cue for an unknown kind rather than inventing a claim", () => {
        expect(nextStepText({ kind: "mystery" })).toBe("refreshing status");
    });
});
describe("degradation views (spec 8)", () => {
    const digest = (health: string): DagStatusDigest =>
        ({
            dagversion: 1,
            health,
            counts: { total: 2, done: 1 } as DagStatusCounts,
            next: { kind: "dispatch" },
            tasks: [],
            durations: { elapsedms: 1000 },
        }) as DagStatusDigest;

    it("never infers healthy when the digest is unavailable", () => {
        const v = healthView({ loading: false, stale: true, error: "boom" });
        expect(v.text).toBe("DAG status unavailable");
        expect(v.tone).not.toContain("success");
    });

    it("hides a stale health claim behind Refreshing status", () => {
        const v = healthView({ loading: false, stale: true, digest: digest("healthy") });
        expect(v.text).toBe("Refreshing status");
        expect(v.tone).not.toContain("success");
    });

    it("shows the digest health when the digest is fresh", () => {
        expect(healthView({ loading: false, stale: false, digest: digest("needs-you") })).toEqual({
            text: "needs-you",
            tone: "text-warning",
        });
        expect(healthView({ loading: false, stale: false, digest: digest("healthy") }).tone).toBe("text-success");
        expect(healthView({ loading: false, stale: false, digest: digest("stalled") }).tone).toBe("text-error");
    });

    it("hides the next move and counts while the digest is stale", () => {
        const stale = { loading: false, stale: true, digest: digest("healthy") };
        expect(nextStepView(stale)).toBeNull();
        expect(freshCounts(stale)).toBeUndefined();
        const fresh = { loading: false, stale: false, digest: digest("healthy") };
        expect(nextStepView(fresh)).toBe("dispatching next task");
        expect(freshCounts(fresh)?.total).toBe(2);
    });
});

// Finding 6: "waiting on dependencies" does not say what has to change. The digest already ships the
// waiting and blocking task ids; the overview just was not reading them.
describe("explicit blockers (finding 6)", () => {
    const briefs = new Map<string, TaskBrief>([
        ["t-a", { label: "scaffold API", state: "done" }],
        ["t-b", { label: "write tests", state: "running" }],
        ["t-c", { label: "ship it", state: "pending" }],
    ]);

    it("names the waiting task and the task it is waiting on", () => {
        expect(nextStepText({ kind: "dependency-wait", taskids: ["t-c"], blockingtaskids: ["t-b"] }, briefs)).toBe(
            "ship it waiting on write tests"
        );
    });

    // a dep that is done yet still blocks its successor is waiting to be integrated, not to finish
    it("distinguishes work still executing from completed work awaiting merge", () => {
        expect(nextStepText({ kind: "dependency-wait", taskids: ["t-c"], blockingtaskids: ["t-a"] }, briefs)).toBe(
            "ship it waiting on scaffold API's merge"
        );
    });

    it("names the tasks holding the parallelism slots", () => {
        expect(nextStepText({ kind: "parallelism-wait", blockingtaskids: ["t-b"] }, briefs)).toBe(
            "waiting for a slot — write tests still running"
        );
    });

    it("names the task a human action is about", () => {
        expect(
            nextStepText({ kind: "human-action", taskids: ["t-a"], actions: ["approve", "sendback"] }, briefs)
        ).toBe("waiting on you — approve / sendback: scaffold API");
    });

    // a question the lead still holds is not the human's: acceptance 4 read "waiting on you" for one
    it("says the lead, not you, when the lead holds the question", () => {
        expect(nextStepText({ kind: "lead-action", taskids: ["t-b"], actions: ["answer"] }, briefs)).toBe(
            "waiting on the lead — answer: write tests"
        );
    });

    it("names merge-ready and cleanup work rather than describing it generically", () => {
        expect(nextStepText({ kind: "merge-ready", taskids: ["t-a"] }, briefs)).toBe(
            "merge ready for review: scaffold API"
        );
        expect(nextStepText({ kind: "cleanup-wait", taskids: ["t-a"] }, briefs)).toBe(
            "waiting on worktree cleanup: scaffold API"
        );
    });

    it("falls back to the task id when no label is known, never inventing one", () => {
        expect(nextStepText({ kind: "dependency-wait", taskids: ["t-x"], blockingtaskids: ["t-y"] })).toBe(
            "t-x waiting on t-y"
        );
    });

    it("summarises a long list instead of overflowing the line", () => {
        expect(nextStepText({ kind: "dispatch", taskids: ["t-a", "t-b", "t-c"] }, briefs)).toBe(
            "dispatching scaffold API, write tests +1 more"
        );
    });
});

// Finding 7: staleness was a stored flag set when a request *returned*, so a digest for an already
// superseded dag version kept being presented as current for the whole load.
describe("freshness (finding 7)", () => {
    it("is stale the moment the observed dag version moves past it, not when the reload returns", () => {
        expect(digestStale(digest(4), 5)).toBe(true);
        expect(digestStale(digest(4), 4)).toBe(false);
    });

    it("is stale when the last refresh failed, even at an unchanged version", () => {
        // refreshes also run on events that leave the version alone (a child's ask), so a failed one leaves the held
        // digest possibly behind
        expect(digestStale(digest(4), 4, "timeout")).toBe(true);
        expect(digestStale(digest(4), 4, undefined)).toBe(false);
        expect(digestStale(undefined, 4, "timeout")).toBe(false);
    });

    it("waits longer before each automatic retry of a failed refresh", () => {
        expect(DIGEST_RETRY_MS.length).toBeGreaterThan(0);
        expect([...DIGEST_RETRY_MS].sort((a, b) => a - b)).toEqual(DIGEST_RETRY_MS);
    });

    it("treats a missing digest as unavailable rather than stale", () => {
        expect(digestStale(undefined, 4)).toBe(false);
        expect(healthView({ loading: false, stale: false })).toEqual({
            text: "DAG status unavailable",
            tone: "text-muted",
        });
    });

    it("distinguishes a refresh in flight from one that failed", () => {
        const held = digest(3);
        expect(healthView({ digest: held, stale: true, loading: true }).text).toBe("Refreshing status");
        const failed = healthView({ digest: held, stale: true, loading: false, error: "boom" });
        expect(failed.text).toBe("Status update failed");
        expect(failed.tone).toBe("text-warning");
    });

    it("reports when the shown status was last confirmed current", () => {
        expect(lastUpdatedText({ loading: false, stale: false }, 100_000)).toBeNull();
        const state = { loading: false, stale: false, digest: digest(1), lastUpdatedTs: 40_000 };
        expect(lastUpdatedText(state, 70_000)).toBe("updated 30s ago");
        expect(lastUpdatedText(state, 400_000)).toBe("updated 6m ago");
    });
});

describe("reportChips", () => {
    it("shows only the numbers that carry news, and flags an untested run", () => {
        expect(reportChips(undefined)).toEqual([]);
        expect(
            reportChips({
                workerms: 34 * 60_000,
                commits: [{ taskid: "t-0", commit: "abc" }],
                answered: 1,
                forwarded: 0,
                unverified: true,
            })
        ).toEqual(["workers 34m", "landed 1", "answered 1", "unverified"]);
    });
});

describe("formatElapsed", () => {
    it("renders seconds, minutes and hours", () => {
        expect(formatElapsed(45_000)).toBe("45s");
        expect(formatElapsed(12 * 60_000)).toBe("12m");
        expect(formatElapsed(65 * 60_000)).toBe("1h5m");
    });
});

describe("nextStepText verify-wait", () => {
    it("names the task whose Verify is running", () => {
        const briefs = new Map([["t-0", { label: "scaffold", state: "verifying" }]]);
        expect(nextStepText({ kind: "verify-wait", taskids: ["t-0"] }, briefs)).toBe("running Verify after scaffold");
    });
});

describe("nextStepText final-wait", () => {
    it("says the merged result is being verified", () => {
        expect(nextStepText({ kind: "final-wait" })).toBe("verifying the merged result");
    });
});

describe("planShapeText", () => {
    it("reads tasks, lanes and the longest chain", () => {
        expect(planShapeText({ tasks: 5, lanes: 2, longestchain: 3 })).toBe("5 tasks · 2 lanes · longest chain 3");
        expect(planShapeText({ tasks: 1, lanes: 1, longestchain: 1 })).toBe("1 task · 1 lane · longest chain 1");
    });

    it("says nothing for a digest that carries no shape", () => {
        expect(planShapeText(undefined)).toBeNull();
        expect(planShapeText({ tasks: 0, lanes: 0, longestchain: 0 })).toBeNull();
    });
});

describe("planWarnings", () => {
    it("calls a multi-task plan that runs in one lane serial", () => {
        expect(planWarnings({ tasks: 3, lanes: 1, longestchain: 3 }, "task test")).toEqual(["serial"]);
    });

    it("does not call a one-task plan serial", () => {
        expect(planWarnings({ tasks: 1, lanes: 1, longestchain: 1 }, "task test")).toEqual([]);
    });

    it("calls a plan with no Verify line unverified", () => {
        expect(planWarnings({ tasks: 3, lanes: 3, longestchain: 1 }, "")).toEqual(["unverified"]);
        expect(planWarnings({ tasks: 3, lanes: 3, longestchain: 1 }, undefined)).toEqual(["unverified"]);
    });

    it("says both for a plan with neither", () => {
        expect(planWarnings({ tasks: 3, lanes: 1, longestchain: 3 }, "")).toEqual(["serial", "unverified"]);
    });
});

describe("verifyRowLine", () => {
    it("carries the age and the latest output line the digest derived", () => {
        const td = { taskid: "t-0", verifystartedts: 1_000, verifylastline: "running pkg/two" } as DagTaskDigest;
        expect(verifyRowLine(td, 241_000)).toBe("Verify running · 4m · running pkg/two");
    });

    it("says it is running before anything is printed", () => {
        const td = { taskid: "t-0", verifystartedts: 1_000 } as DagTaskDigest;
        expect(verifyRowLine(td, 61_000)).toBe("Verify running · 1m");
    });

    // a digest that has not arrived yet must not invent a clock
    it("names it without an age when the digest carries none", () => {
        expect(verifyRowLine(undefined, 61_000)).toBe("Verify running");
    });
});

describe("cleanupOnly", () => {
    const task = (taskid: string, humanactions?: string[]) => ({ taskid, humanactions }) as DagTaskDigest;
    const digest = (health: string, tasks: DagTaskDigest[]) => ({ health, tasks }) as DagStatusDigest;

    it("is true when every task asking the human only needs its worktree removed", () => {
        expect(cleanupOnly(digest("needs-you", [task("t-1"), task("t-2", ["retry-cleanup"])]))).toBe(true);
    });
    it("is false when a question, gate or failure also needs the human", () => {
        expect(cleanupOnly(digest("needs-you", [task("t-1", ["answer"]), task("t-2", ["retry-cleanup"])]))).toBe(false);
        expect(cleanupOnly(digest("needs-you", [task("t-1", ["retry", "skip", "escalate"])]))).toBe(false);
    });
    it("is false for a healthy digest, a blocked dag with no task actions, or none at all", () => {
        expect(cleanupOnly(digest("healthy", [task("t-1", ["retry-cleanup"])]))).toBe(false);
        expect(cleanupOnly(digest("needs-you", [task("t-1")]))).toBe(false);
        expect(cleanupOnly(undefined)).toBe(false);
    });
});

it("names worktree cleanup as what it is", () => {
    expect(nextStepText({ kind: "human-action", taskids: ["t-2", "t-3"], actions: ["retry-cleanup"] })).toBe(
        "worktrees not removed: t-2, t-3 — wsh jarvis dag retry-cleanup"
    );
});
