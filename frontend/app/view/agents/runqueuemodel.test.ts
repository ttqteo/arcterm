// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { describe, expect, it } from "vitest";
import { queuedMeta, queuedRows, queuedTooltip, queueProject, runLanded } from "./runqueuemodel";

const NOW = 1_800_000_000_000;
const MIN = 60_000;

const entry = (
    id: string,
    over: Partial<RunQueueEntry> = {},
    data: Partial<CommandCreateRunData> = {}
): RunQueueEntry => ({
    id,
    title: `Plan ${id}`,
    projectpath: "D:\\code\\waveterm",
    queuedts: NOW - 5 * MIN,
    state: "waiting",
    data: {
        channelid: "ch",
        workspaceid: "ws",
        goal: "g",
        runtime: "claude",
        planpath: `docs/plans/${id}.md`,
        ...data,
    },
    ...over,
});

describe("queueProject", () => {
    it("is the last path segment of the entry's project path, whatever the separator", () => {
        expect(queueProject(entry("q-1"))).toBe("waveterm");
        expect(queueProject(entry("q-1", { projectpath: "/home/u/loom/" }))).toBe("loom");
        expect(queueProject(entry("q-1", { projectpath: "" }))).toBe("");
    });
});

const run = (over: Partial<Run> = {}): Run =>
    ({ id: "run-1", goal: "g", workspaceid: "ws", projectpath: "/p", status: "running", phases: [], ...over }) as Run;

describe("runLanded", () => {
    it("is true for a landed land, and for a done run with no branch to merge", () => {
        expect(runLanded(run({ status: "done", land: { state: "landed" } }))).toBe(true);
        expect(runLanded(run({ status: "done" }))).toBe(true);
    });

    it("is false while the run is going, its land is pending, or it is cancelled", () => {
        expect(runLanded(run())).toBe(false);
        expect(runLanded(run({ status: "done", land: { state: "pending" } }))).toBe(false);
        expect(runLanded(run({ status: "cancelled" }))).toBe(false);
    });

    it("is false for a held land, dirty or not, and for a done run whose branch has not landed", () => {
        expect(runLanded(run({ status: "done", land: { state: "held", reason: "conflict" } }))).toBe(false);
        expect(runLanded(run({ status: "done", land: { state: "held", dirty: true } }))).toBe(false);
        expect(runLanded(run({ status: "done", landpath: "/wt/wave-run-1" }))).toBe(false);
    });
});

describe("queuedRows", () => {
    it("numbers the waiting entries across projects, in queue order", () => {
        const rows = queuedRows(
            [
                entry("q-a"),
                entry("q-b", { projectpath: "/code/loom" }),
                entry("q-c"),
                entry("q-d", { projectpath: "/code/loom" }),
            ],
            {}
        );
        expect(rows.map((r) => [r.entry.id, r.project, r.place])).toEqual([
            ["q-a", "waveterm", 1],
            ["q-b", "loom", 2],
            ["q-c", "waveterm", 3],
            ["q-d", "loom", 4],
        ]);
    });

    it("gives a blocked entry no place and leaves the places after it unshifted", () => {
        const rows = queuedRows([entry("q-a", { state: "blocked", reason: "x" }), entry("q-b"), entry("q-c")], {});
        expect(rows.map((r) => r.place)).toEqual([null, 1, 2]);
    });

    it("keeps the place of an entry that waits on another, so the ones behind it count it", () => {
        const rows = queuedRows([entry("q-a"), entry("q-b", { after: "q-a" }), entry("q-c")], {});
        expect(rows.map((r) => r.place)).toEqual([1, 2, 3]);
    });

    it("names what an entry waits on: a run by its title, a queued entry by its own", () => {
        const rows = queuedRows(
            [
                entry("q-a", { title: "Learned additions" }),
                entry("q-b", { after: "q-a" }),
                entry("q-c", { after: "run-1" }),
            ],
            { "run-1": "Setup tab" }
        );
        expect(rows.map((r) => r.afterTitle)).toEqual([undefined, "Learned additions", "Setup tab"]);
    });

    it("leaves the title out when the run it waits on is not known", () => {
        const [row] = queuedRows([entry("q-a", { after: "run-9" })], {});
        expect(row.afterTitle).toBeUndefined();
    });

    it("marks an After met only for a run that has landed, never for a queued entry", () => {
        const rows = queuedRows(
            [
                entry("q-a"),
                entry("q-b", { after: "q-a" }),
                entry("q-c", { after: "run-1" }),
                entry("q-d", { after: "run-2" }),
            ],
            { "run-1": "Setup tab", "run-2": "Other" },
            new Set(["run-1", "q-a"])
        );
        expect(rows.map((r) => r.afterMet)).toEqual([undefined, undefined, true, undefined]);
    });

    it("is empty for an empty queue", () => {
        expect(queuedRows([], {})).toEqual([]);
    });
});

describe("queuedMeta", () => {
    const row = (e: RunQueueEntry, runTitles: Record<string, string> = {}, others: RunQueueEntry[] = []) =>
        queuedRows([...others, e], runTitles).find((r) => r.entry.id === e.id)!;

    it("reads Queued #N for an entry waiting for room", () => {
        expect(queuedMeta(row(entry("q-b"), {}, [entry("q-a")]))).toBe("Queued #2");
    });

    it("reads After <title> for an entry whose After is unmet", () => {
        expect(queuedMeta(row(entry("q-b", { after: "run-1" }), { "run-1": "Learned additions" }))).toBe(
            "After Learned additions"
        );
        expect(queuedMeta(row(entry("q-b", { after: "q-a" }), {}, [entry("q-a", { title: "Brainstorm ideas" })]))).toBe(
            "After Brainstorm ideas"
        );
    });

    it("reads Queued #N for an entry whose After run has landed: only room is left to wait for", () => {
        const e = entry("q-b", { after: "run-1" });
        const [first, second] = queuedRows([entry("q-a"), e], { "run-1": "Learned additions" }, new Set(["run-1"]));
        expect(queuedMeta(first)).toBe("Queued #1");
        expect(queuedMeta(second)).toBe("Queued #2");
    });

    it("reads After <title> for an entry whose After run is still going, held or not landed", () => {
        const e = entry("q-b", { after: "run-1" });
        expect(queuedMeta(queuedRows([e], { "run-1": "Learned additions" }, new Set())[0])).toBe(
            "After Learned additions"
        );
        expect(queuedMeta(queuedRows([e], { "run-1": "Learned additions" }, new Set(["run-2"]))[0])).toBe(
            "After Learned additions"
        );
    });

    it("reads After <title> for an entry that waits on a queued entry, whatever the landed set holds", () => {
        const rows = queuedRows(
            [entry("q-a", { title: "Brainstorm ideas" }), entry("q-b", { after: "q-a" })],
            {},
            new Set(["q-a"])
        );
        expect(queuedMeta(rows[1])).toBe("After Brainstorm ideas");
    });

    it("falls back to a short id when the title of what it waits on is not known", () => {
        expect(queuedMeta(row(entry("q-b", { after: "4f2a9c1e-7b3d-4e5a-8c6f-1a2b3c4d5e6f" })))).toBe("After 4f2a9c1e");
    });

    it("reads Blocked · <reason> for a blocked entry, even one that has an After", () => {
        expect(queuedMeta(row(entry("q-b", { state: "blocked", reason: "Learned additions was held" })))).toBe(
            "Blocked · Learned additions was held"
        );
        expect(
            queuedMeta(
                row(entry("q-b", { state: "blocked", reason: "Setup was cancelled", after: "run-1" }), {
                    "run-1": "Setup",
                })
            )
        ).toBe("Blocked · Setup was cancelled");
        expect(queuedMeta(row(entry("q-b", { state: "blocked" })))).toBe("Blocked");
    });
});

describe("queuedTooltip", () => {
    it("is three lines: the plan path, the lead and the worker route, and the age", () => {
        const e = entry(
            "q-a",
            {},
            { runtime: "claude", model: "opus", workerroute: { runtime: "codex", model: "gpt-5" } }
        );
        expect(queuedTooltip(e, NOW).split("\n")).toEqual([
            "docs/plans/q-a.md",
            "Lead claude · opus · Workers codex · gpt-5",
            "Queued 5m ago",
        ]);
    });

    it("says the workers are the same as the lead when no worker route is set", () => {
        const e = entry("q-a", {}, { runtime: "pi" });
        expect(queuedTooltip(e, NOW).split("\n")).toEqual([
            "docs/plans/q-a.md",
            "Lead pi · Workers same as lead",
            "Queued 5m ago",
        ]);
    });

    it("leaves a worker route's model out when it pins none", () => {
        const e = entry("q-a", {}, { runtime: "claude", model: "sonnet", workerroute: { runtime: "agy" } });
        expect(queuedTooltip(e, NOW).split("\n")[1]).toBe("Lead claude · sonnet · Workers agy");
    });

    it("says just now for an entry queued under a minute ago, and falls back to the title with no plan path", () => {
        const e = entry("q-a", { queuedts: NOW - 20_000 }, { planpath: undefined });
        const lines = queuedTooltip(e, NOW).split("\n");
        expect(lines[0]).toBe("Plan q-a");
        expect(lines[2]).toBe("Queued just now");
    });
});
