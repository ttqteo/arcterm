// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { queuedRows } from "@/app/view/agents/runqueuemodel";
import { describe, expect, it } from "vitest";
import { ACTIVE_CAP } from "./briefingmodel";
import { liveRunCount, queueSheetModel, withQueuedLines } from "./briefqueue";
import type { BriefLine } from "./briefrows";

const NOW = 1_700_000_000_000;

function entry(id: string, over: Partial<RunQueueEntry> = {}): RunQueueEntry {
    return {
        id,
        title: `Plan ${id}`,
        projectpath: "/p/arcterm",
        queuedts: NOW - 4 * 60_000,
        state: "waiting",
        data: { channelid: "ch", workspaceid: "ws", runtime: "claude", mode: "orchestrator", planpath: `/p/${id}.md` },
        ...over,
    } as RunQueueEntry;
}

function runLine(runOid: string, title: string): BriefLine {
    return {
        id: "sessions:run:" + runOid,
        kind: "▶ run",
        kindTone: "active",
        title,
        note: "",
        meta: "",
        state: "working",
        stateTone: "ok",
        progress: null,
        target: { oref: "run:" + runOid },
        why: "",
        age: "",
        detail: "",
        runOid,
    };
}

const rowsOf = (entries: RunQueueEntry[], titles: Record<string, string> = {}, landed = new Set<string>()) =>
    queuedRows(entries, titles, landed);
const ids = (lines: BriefLine[]) => lines.map((l) => l.queued?.entryId ?? l.runOid);
const depthOf = (lines: BriefLine[], id: string) => lines.find((l) => l.queued?.entryId === id)?.depth ?? -1;
const lineOf = (lines: BriefLine[], id: string) => lines.find((l) => l.queued?.entryId === id)!;

describe("withQueuedLines", () => {
    it("nests an entry under the run it waits on, right after that run", () => {
        const runs = [runLine("r1", "Board"), runLine("r2", "Other")];
        const out = withQueuedLines(runs, rowsOf([entry("q-a", { after: ["r1"] })], { r1: "Board" }), "all", "", NOW);
        expect(ids(out)).toEqual(["r1", "q-a", "r2"]);
        expect(depthOf(out, "q-a")).toBe(1);
        expect(lineOf(out, "q-a").kind).toBe("↳ queued");
        expect(lineOf(out, "q-a").meta).toBe("after it lands");
    });

    it("nests an entry after two runs under the first one that has not landed", () => {
        const runs = [runLine("r1", "run A"), runLine("r2", "run B")];
        const titles = { r1: "run A", r2: "run B" };
        const e = [entry("q-a", { after: ["r1", "r2"] })];
        const both = withQueuedLines(runs, rowsOf(e, titles), "all", "", NOW);
        expect(ids(both)).toEqual(["r1", "q-a", "r2"]);
        expect(lineOf(both, "q-a").meta).toBe("after it and 1 more land");
        // r1 landed: only r2 is left, so the line sits under it and says what it said for one run
        const second = withQueuedLines(runs, rowsOf(e, titles, new Set(["r1"])), "all", "", NOW);
        expect(ids(second)).toEqual(["r1", "r2", "q-a"]);
        expect(depthOf(second, "q-a")).toBe(1);
        expect(lineOf(second, "q-a").meta).toBe("after it lands");
        // both landed: room only
        const room = withQueuedLines(runs, rowsOf(e, titles, new Set(["r1", "r2"])), "all", "", NOW);
        expect(depthOf(room, "q-a")).toBe(0);
        expect(lineOf(room, "q-a").meta).toBe("waiting for room");
    });

    it("puts an entry after two runs at the top, naming both, when the first one it waits on is not drawn", () => {
        const out = withQueuedLines(
            [runLine("r2", "run B")],
            rowsOf([entry("q-a", { after: ["r1", "r2"] })], { r1: "run A", r2: "run B" }),
            "all",
            "",
            NOW
        );
        expect(depthOf(out, "q-a")).toBe(0);
        expect(lineOf(out, "q-a").meta).toBe("after run A, run B");
    });

    it("nests a chain one level per link", () => {
        const e = [entry("q-a", { after: ["r1"] }), entry("q-b", { after: ["q-a"] }), entry("q-c", { after: ["q-b"] })];
        const out = withQueuedLines([runLine("r1", "Board")], rowsOf(e, { r1: "Board" }), "all", "", NOW);
        expect(ids(out)).toEqual(["r1", "q-a", "q-b", "q-c"]);
        expect([depthOf(out, "q-a"), depthOf(out, "q-b"), depthOf(out, "q-c")]).toEqual([1, 2, 3]);
    });

    it("puts an entry whose run is not drawn at the top, naming the run", () => {
        const out = withQueuedLines([], rowsOf([entry("q-a", { after: ["r9"] })], { r9: "Board" }), "all", "", NOW);
        expect(depthOf(out, "q-a")).toBe(0);
        expect(lineOf(out, "q-a").kind).toBe("⏸ queued");
        expect(lineOf(out, "q-a").meta).toBe("after Board");
    });

    it("puts room-only entries after every run, in queue order", () => {
        const e = [entry("q-a"), entry("q-b", { after: ["r1"] }), entry("q-c")];
        const out = withQueuedLines([runLine("r1", "Board")], rowsOf(e, { r1: "Board" }), "all", "", NOW);
        expect(ids(out)).toEqual(["r1", "q-b", "q-a", "q-c"]);
        expect(lineOf(out, "q-a").meta).toBe("waiting for room");
        expect(lineOf(out, "q-a").state).toBe("#1");
        expect(lineOf(out, "q-c").state).toBe("#3");
    });

    it("treats an entry whose run has landed as waiting for room", () => {
        const out = withQueuedLines(
            [runLine("r1", "Board")],
            rowsOf([entry("q-a", { after: ["r1"] })], { r1: "Board" }, new Set(["r1"])),
            "all",
            "",
            NOW
        );
        expect(ids(out)).toEqual(["r1", "q-a"]);
        expect(depthOf(out, "q-a")).toBe(0);
        expect(lineOf(out, "q-a").meta).toBe("waiting for room");
    });

    it("marks a blocked entry, its reason kept for the tooltip", () => {
        const out = withQueuedLines(
            [],
            rowsOf([entry("q-d", { state: "blocked", reason: "plan is gone" })]),
            "all",
            "",
            NOW
        );
        expect(lineOf(out, "q-d").state).toBe("blocked");
        expect(lineOf(out, "q-d").queued).toEqual({ entryId: "q-d", blocked: true, reason: "plan is gone" });
    });

    it("keeps an entry only when the run-kind toggle keeps its mode", () => {
        const e = [
            entry("q-a"),
            entry("q-q", {
                data: { channelid: "ch", workspaceid: "ws", mode: "quick", goal: "g" } as CommandCreateRunData,
            }),
        ];
        expect(ids(withQueuedLines([], rowsOf(e), "orchestrator", "", NOW))).toEqual(["q-a"]);
        expect(ids(withQueuedLines([], rowsOf(e), "quick", "", NOW))).toEqual(["q-q"]);
    });

    it("filters by the search, and a child of a filtered-out entry stands at the top", () => {
        const e = [entry("q-a", { title: "Board follow-up" }), entry("q-b", { title: "Floors", after: ["q-a"] })];
        const out = withQueuedLines([], rowsOf(e), "all", "floors", NOW);
        expect(ids(out)).toEqual(["q-b"]);
        expect(depthOf(out, "q-b")).toBe(0);
        expect(lineOf(out, "q-b").meta).toBe("after Board follow-up");
    });

    it("targets the entry and leaves the run lines as they were", () => {
        const runs = [runLine("r1", "Board")];
        const out = withQueuedLines(runs, rowsOf([entry("q-a", { after: ["r1"] })], { r1: "Board" }), "all", "", NOW);
        expect(out[0]).toBe(runs[0]);
        expect(lineOf(out, "q-a").target).toEqual({ runQueue: "q-a" });
        expect(lineOf(out, "q-a").id).toBe("sessions:queued:q-a");
    });

    it("returns the run lines untouched when the queue is empty", () => {
        const runs = [runLine("r1", "Board")];
        expect(withQueuedLines(runs, [], "all", "", NOW)).toBe(runs);
    });

    // the Runs window (sessionWindow) caps and folds the runs before the queue joins them, so neither ACTIVE_CAP nor
    // `+N more` sees a queued line; and the region's "N live" counts running work only
    it("draws every queued entry past ACTIVE_CAP, and counts none of them live", () => {
        const runs = [runLine("r1", "Board"), { ...runLine("r2", "Old"), stale: true }];
        const e = Array.from({ length: ACTIVE_CAP + 2 }, (_, i) => entry(`q-${i}`));
        const out = withQueuedLines(runs, rowsOf(e), "all", "", NOW);
        expect(out).toHaveLength(runs.length + ACTIVE_CAP + 2);
        expect(liveRunCount(out)).toBe(1);
        expect(liveRunCount(runs)).toBe(1);
    });
});

describe("queueSheetModel", () => {
    const slots = { maxActive: 3, active: 3 };

    it("words an entry waiting on a run, with the run's stage", () => {
        const [row] = rowsOf([entry("q-a", { after: ["r1"] })], { r1: "Board" });
        const m = queueSheetModel(row, { ...slots, afterStage: "working 2/5", now: NOW });
        expect(m.chip).toBe("Waiting on a run");
        expect(m.waits).toEqual({ text: "Board · working 2/5", runId: "r1" });
        expect(m.plan).toBe("/p/q-a.md");
        expect(m.route).toBe("Lead claude · Workers same as lead");
        expect(m.queued).toBe("queued 4m ago");
        expect(m.runNext).toBe(false); // #1 has nowhere to go
    });

    it("words an entry waiting on another queued entry", () => {
        const rows = rowsOf([entry("q-a"), entry("q-b", { after: ["q-a"] })]);
        const m = queueSheetModel(rows[1], { ...slots, now: NOW });
        expect(m.chip).toBe("Waiting on a run");
        expect(m.waits).toEqual({ text: "Plan q-a", entryId: "q-a" });
        expect(m.runNext).toBe(true);
    });

    it("words an entry waiting on two runs: both titles, one link each, the stage on the first still going", () => {
        const titles = { r1: "run A", r2: "run B" };
        const [row] = rowsOf([entry("q-a", { after: ["r1", "r2"] })], titles);
        const m = queueSheetModel(row, { ...slots, afterStage: "working 2/5", now: NOW });
        expect(m.chip).toBe("Waiting on a run");
        expect(m.waits.text).toBe("run A · working 2/5, run B");
        expect(m.waits.runId).toBe("r1");
        expect(m.waits.list).toEqual([
            { text: "run A · working 2/5", runId: "r1" },
            { text: "run B", runId: "r2" },
        ]);
        // r1 landed: the stage is r2's, and r2 is the link that stands for the entry
        const [landed] = rowsOf([entry("q-a", { after: ["r1", "r2"] })], titles, new Set(["r1"]));
        const m2 = queueSheetModel(landed, { ...slots, afterStage: "working 1/3", now: NOW });
        expect(m2.waits.text).toBe("run A, run B · working 1/3");
        expect(m2.waits.runId).toBe("r2");
        expect(m2.waits.list?.map((w) => w.runId)).toEqual(["r1", "r2"]);
    });

    it("words an entry waiting on a run and a queued entry, each linking to its own sheet or run", () => {
        const rows = rowsOf([entry("q-a"), entry("q-b", { after: ["r1", "q-a"] })], { r1: "run A" });
        const m = queueSheetModel(rows[1], { ...slots, now: NOW });
        expect(m.waits.text).toBe("run A, Plan q-a");
        expect(m.waits.list).toEqual([
            { text: "run A", runId: "r1" },
            { text: "Plan q-a", entryId: "q-a" },
        ]);
    });

    it("names the short ids of two runs whose titles are not known", () => {
        const [row] = rowsOf([entry("q-a", { after: ["4f2a9c1e-7b3d", "9c1d0b7e-5a4f"] })]);
        expect(queueSheetModel(row, { ...slots, now: NOW }).waits.text).toBe("4f2a9c1e, 9c1d0b7e");
    });

    it("gives a waiting entry its reason too, not only a blocked one's", () => {
        const waiting = entry("q-a", {
            after: ["r1", "r2"],
            reason: "Waiting for run B too: both edit pkg/orchestrate/land.go",
        });
        const [row] = rowsOf([waiting], { r1: "run A", r2: "run B" });
        const m = queueSheetModel(row, { ...slots, now: NOW });
        expect(m.blocked).toBe(false);
        expect(m.reason).toBe("Waiting for run B too: both edit pkg/orchestrate/land.go");
        expect(queueSheetModel(rowsOf([entry("q-b")])[0], { ...slots, now: NOW }).reason).toBeNull();
    });

    it("words a room-only entry by the slots", () => {
        const [row] = rowsOf([entry("q-a")]);
        expect(queueSheetModel(row, { ...slots, now: NOW }).waits).toEqual({ text: "a free slot (3 of 3 running)" });
        expect(queueSheetModel(row, { maxActive: 0, active: 2, now: NOW }).waits).toEqual({ text: "a free slot" });
        expect(queueSheetModel(row, { ...slots, now: NOW }).chip).toBe("Queued #1");
    });

    it("gives a blocked entry its whole reason", () => {
        const [row] = rowsOf([entry("q-d", { state: "blocked", reason: "the plan file is gone" })]);
        const m = queueSheetModel(row, { ...slots, now: NOW });
        expect(m.chip).toBe("Blocked");
        expect(m.blocked).toBe(true);
        expect(m.reason).toBe("the plan file is gone");
    });

    it("names the session that queued it when that tab is known", () => {
        const data = { ...entry("q-a").data, origintabid: "tab-1" } as CommandCreateRunData;
        const [row] = rowsOf([entry("q-a", { data })]);
        expect(queueSheetModel(row, { ...slots, originName: "arcterm · lead", now: NOW }).queuedBy).toEqual({
            tabId: "tab-1",
            name: "arcterm · lead",
        });
        // a tab no longer in the roster, or an entry queued from no session, names none
        expect(queueSheetModel(row, { ...slots, originName: null, now: NOW }).queuedBy).toBeNull();
        expect(queueSheetModel(rowsOf([entry("q-b")])[0], { ...slots, originName: "x", now: NOW }).queuedBy).toBeNull();
    });

    it("shows a quick run's goal where a plan would be", () => {
        const [row] = rowsOf([
            entry("q-q", {
                data: {
                    channelid: "ch",
                    workspaceid: "ws",
                    mode: "quick",
                    goal: "fix the tray",
                } as CommandCreateRunData,
            }),
        ]);
        const m = queueSheetModel(row, { ...slots, now: NOW });
        expect(m.plan).toBeNull();
        expect(m.goal).toBe("fix the tray");
    });
});
