// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { describe, expect, it } from "vitest";
import { chunkKey } from "./briefundo";
import {
    footerLine,
    groupAge,
    listedKeys,
    neighborKey,
    oldestLine,
    pruneSettled,
    REFUSAL_PROJECTS,
    reviewKey,
    reviewRowKeys,
    startLabel,
    startPlan,
    stripLine,
    TICK_PROMPT,
    tickedKeys,
    unlistedProposals,
    visibleGroups,
} from "./runreview";

const HOUR = 3_600_000;
const DAY = 24 * HOUR;
const NOW = 100 * DAY;

function item(effortoid: string, label: string, over: Partial<RunReviewItem> = {}): RunReviewItem {
    return { effortoid, efforttitle: `Initiative ${effortoid}`, label, proposedts: NOW - DAY, ...over };
}

function group(runid: string, items: RunReviewItem[], over: Partial<RunReviewGroup> = {}): RunReviewGroup {
    return { runid, channelid: "ch-" + runid, goal: `Goal of ${runid}`, createdts: NOW - 3 * DAY, items, ...over };
}

// two runs, oldest first, the way wavesrv sends them
const RUN_A = group("aaaaaaaa", [item("e1", "first issue")], { createdts: NOW - 3 * DAY });
const RUN_B = group("bbbbbbbb", [item("e1", "second issue"), item("e2", "third issue")], { createdts: NOW - 2 * DAY });
const GROUPS = [RUN_A, RUN_B];

const none = new Set<string>();

describe("reviewKey", () => {
    it("is the chunk key briefUndo hides by", () => {
        expect(reviewKey(item("e1", "first issue"))).toBe(chunkKey("effort:e1", "first issue"));
    });
});

describe("listedKeys and unlistedProposals", () => {
    it("lists every row of every group by its key, and nothing without a snapshot", () => {
        expect([...listedKeys(GROUPS)].sort()).toEqual(
            [
                chunkKey("effort:e1", "first issue"),
                chunkKey("effort:e1", "second issue"),
                chunkKey("effort:e2", "third issue"),
            ].sort()
        );
        expect(listedKeys(undefined).size).toBe(0);
        expect(listedKeys([]).size).toBe(0);
    });

    it("keeps the rows a pending Later or Drop hides: they are still proposed until the edit lands", () => {
        // listedKeys reads the snapshot's groups, not visibleGroups: a folded row must not jump back into the count
        const hidden = new Set([chunkKey("effort:e2", "third issue")]);
        expect(visibleGroups(GROUPS, hidden, none).flatMap((g) => g.items)).toHaveLength(2);
        expect(listedKeys(GROUPS).has(chunkKey("effort:e2", "third issue"))).toBe(true);
    });

    it("drops from an initiative's proposed labels the ones To review lists, matched by initiative and label", () => {
        const listed = listedKeys(GROUPS);
        expect(unlistedProposals("effort:e1", ["first issue", "kept here", "second issue"], listed)).toEqual([
            "kept here",
        ]);
        // the same label under another initiative is a different proposal
        expect(unlistedProposals("effort:e3", ["first issue"], listed)).toEqual(["first issue"]);
    });

    it("leaves every label with no To review data", () => {
        expect(unlistedProposals("effort:e1", ["a", "b"], undefined)).toEqual(["a", "b"]);
        expect(unlistedProposals("effort:e1", ["a", "b"], new Set())).toEqual(["a", "b"]);
    });
});

describe("visibleGroups", () => {
    it("keeps the groups and the rows in the order wavesrv sent them (oldest run first)", () => {
        const g = visibleGroups(GROUPS, none, none);
        expect(g.map((x) => x.runid)).toEqual(["aaaaaaaa", "bbbbbbbb"]);
        expect(g[1].items.map((i) => i.label)).toEqual(["second issue", "third issue"]);
    });

    it("gives every row its key", () => {
        const g = visibleGroups(GROUPS, none, none);
        expect(g[0].items[0].key).toBe(chunkKey("effort:e1", "first issue"));
    });

    it("removes a row a pending Later or Drop hides", () => {
        const hidden = new Set([chunkKey("effort:e2", "third issue")]);
        const g = visibleGroups(GROUPS, hidden, none);
        expect(g[1].items.map((i) => i.label)).toEqual(["second issue"]);
    });

    it("removes a row whose commit went through but whose snapshot still lists it (settled)", () => {
        const settled = new Set([chunkKey("effort:e1", "second issue")]);
        const g = visibleGroups(GROUPS, none, settled);
        expect(g[1].items.map((i) => i.label)).toEqual(["third issue"]);
    });

    it("removes a group whose last row is gone", () => {
        const hidden = new Set([chunkKey("effort:e1", "first issue")]);
        const g = visibleGroups(GROUPS, hidden, none);
        expect(g.map((x) => x.runid)).toEqual(["bbbbbbbb"]);
    });

    it("keeps one label on two initiatives apart", () => {
        const twin = group("cccccccc", [item("e1", "same"), item("e2", "same")]);
        const hidden = new Set([chunkKey("effort:e1", "same")]);
        const g = visibleGroups([twin], hidden, none);
        expect(g[0].items.map((i) => i.effortoid)).toEqual(["e2"]);
    });

    it("is empty with nothing to review, and with no snapshot yet", () => {
        expect(visibleGroups([], none, none)).toEqual([]);
        expect(visibleGroups(undefined, none, none)).toEqual([]);
    });
});

describe("stripLine", () => {
    it("counts the things and the runs left", () => {
        expect(stripLine(visibleGroups(GROUPS, none, none))).toBe("3 things 2 runs left");
    });

    it("uses the singular for one thing and for one run", () => {
        expect(stripLine(visibleGroups([RUN_A], none, none))).toBe("1 thing 1 run left");
        expect(stripLine(visibleGroups([RUN_B], none, none))).toBe("2 things 1 run left");
    });

    it("counts only what is still drawn", () => {
        const hidden = new Set([chunkKey("effort:e1", "first issue")]);
        expect(stripLine(visibleGroups(GROUPS, hidden, none))).toBe("2 things 1 run left");
    });
});

describe("ages", () => {
    it("names the age of the oldest proposal", () => {
        const g = visibleGroups(
            [
                group("aaaaaaaa", [item("e1", "old", { proposedts: NOW - 3 * DAY })]),
                group("bbbbbbbb", [item("e1", "new", { proposedts: NOW - HOUR })]),
            ],
            none,
            none
        );
        expect(oldestLine(g, NOW)).toBe("oldest 3d");
    });

    it("reads the oldest among what is drawn, not what is hidden", () => {
        const g = visibleGroups(
            [
                group("aaaaaaaa", [item("e1", "old", { proposedts: NOW - 3 * DAY })]),
                group("bbbbbbbb", [item("e1", "new", { proposedts: NOW - 2 * HOUR })]),
            ],
            new Set([chunkKey("effort:e1", "old")]),
            none
        );
        expect(oldestLine(g, NOW)).toBe("oldest 2h");
    });

    it("says nothing with nothing to review", () => {
        expect(oldestLine([], NOW)).toBe("");
    });

    it("ages a group by its run's start", () => {
        expect(groupAge(RUN_A, NOW)).toBe("3d");
        expect(groupAge(group("x", [], { createdts: NOW - 90 * 60_000 }), NOW)).toBe("1h");
    });
});

describe("ticks", () => {
    const groups = visibleGroups(GROUPS, none, none);
    const k1 = reviewKey(RUN_A.items[0]);
    const k2 = reviewKey(RUN_B.items[0]);
    const k3 = reviewKey(RUN_B.items[1]);

    it("counts the ticked rows in the order they are drawn", () => {
        expect(tickedKeys(groups, new Set([k3, k1]))).toEqual([k1, k3]);
    });

    it("does not count a tick whose row is gone", () => {
        const kept = visibleGroups(GROUPS, new Set([k3]), none);
        expect(tickedKeys(kept, new Set([k1, k3]))).toEqual([k1]);
        expect(tickedKeys(kept, new Set(["chunk:effort:zz:never listed"]))).toEqual([]);
    });

    it("counts a tick again when its row comes back (an Undo)", () => {
        const back = visibleGroups(GROUPS, none, none);
        expect(tickedKeys(back, new Set([k2]))).toEqual([k2]);
    });

    it("words the footer by the count, and tells what to do with none", () => {
        expect(footerLine(0)).toBe(TICK_PROMPT);
        expect(TICK_PROMPT).toBe("Tick what to do, then start one run with it.");
        expect(footerLine(1)).toBe("1 marked to do");
        expect(footerLine(4)).toBe("4 marked to do");
    });

    it("words the start button by the count", () => {
        expect(startLabel(0)).toBe("Start a run with 0 items");
        expect(startLabel(1)).toBe("Start a run with 1 item");
        expect(startLabel(3)).toBe("Start a run with 3 items");
    });
});

describe("startPlan", () => {
    const withProject = (g: RunReviewGroup, oid: string, project: string) =>
        group(
            g.runid,
            g.items.map((i) => (i.effortoid === oid ? { ...i, project } : i))
        );

    it("does nothing with nothing ticked", () => {
        const groups = visibleGroups(GROUPS, none, none);
        expect(startPlan(groups, none)).toEqual({ kind: "none" });
    });

    it("makes a quick run of one item, its goal the label and the initiative", () => {
        const groups = visibleGroups(GROUPS, none, none);
        const plan = startPlan(groups, new Set([reviewKey(RUN_A.items[0])]));
        expect(plan.kind).toBe("start");
        if (plan.kind !== "start") {
            return;
        }
        expect(plan.prefill.shape).toBe("quick");
        expect(plan.prefill.goal).toBe("- first issue (Initiative e1)");
        expect(plan.prefill.chunks).toEqual([{ effortoid: "e1", chunklabel: "first issue" }]);
    });

    it("makes an orchestrator run of several, one goal line each, in the order drawn", () => {
        const groups = visibleGroups(GROUPS, none, none);
        const ticks = new Set([reviewKey(RUN_B.items[1]), reviewKey(RUN_A.items[0])]);
        const plan = startPlan(groups, ticks);
        expect(plan.kind).toBe("start");
        if (plan.kind !== "start") {
            return;
        }
        expect(plan.prefill.shape).toBe("orchestrator");
        expect(plan.prefill.goal).toBe("- first issue (Initiative e1)\n- third issue (Initiative e2)");
        expect(plan.prefill.chunks).toEqual([
            { effortoid: "e1", chunklabel: "first issue" },
            { effortoid: "e2", chunklabel: "third issue" },
        ]);
    });

    it("picks the project the ticked items share", () => {
        const groups = visibleGroups([withProject(withProject(RUN_B, "e1", "proj-x"), "e2", "proj-x")], none, none);
        const plan = startPlan(groups, new Set(groups[0].items.map((i) => i.key)));
        expect(plan.kind === "start" && plan.prefill.projectName).toBe("proj-x");
    });

    it("lets an initiative with no project fit the project of the others", () => {
        const groups = visibleGroups([withProject(RUN_B, "e2", "proj-y")], none, none);
        const plan = startPlan(groups, new Set(groups[0].items.map((i) => i.key)));
        expect(plan.kind === "start" && plan.prefill.projectName).toBe("proj-y");
    });

    it("leaves the project to the launcher when none of the ticked has one", () => {
        const groups = visibleGroups(GROUPS, none, none);
        const plan = startPlan(groups, new Set(groups.flatMap((g) => g.items.map((i) => i.key))));
        expect(plan.kind === "start" && plan.prefill.projectName).toBe("");
    });

    it("refuses items from two different projects, with no prefill", () => {
        const groups = visibleGroups([withProject(withProject(RUN_B, "e1", "proj-x"), "e2", "proj-y")], none, none);
        const plan = startPlan(groups, new Set(groups[0].items.map((i) => i.key)));
        expect(plan).toEqual({ kind: "refuse", line: REFUSAL_PROJECTS });
        expect(REFUSAL_PROJECTS).toBe("Tick items from one project to start a run");
    });

    it("does not refuse a project-less item beside two items of one project", () => {
        const g = group("dddddddd", [
            item("e1", "a", { project: "proj-x" }),
            item("e2", "b"),
            item("e3", "c", { project: "proj-x" }),
        ]);
        const groups = visibleGroups([g], none, none);
        const plan = startPlan(groups, new Set(groups[0].items.map((i) => i.key)));
        expect(plan.kind === "start" && plan.prefill.projectName).toBe("proj-x");
    });

    it("ignores a tick whose row is gone", () => {
        const groups = visibleGroups(GROUPS, new Set([reviewKey(RUN_A.items[0])]), none);
        expect(startPlan(groups, new Set([reviewKey(RUN_A.items[0])]))).toEqual({ kind: "none" });
    });
});

describe("pruneSettled", () => {
    const k1 = reviewKey(RUN_A.items[0]);
    const k2 = reviewKey(RUN_B.items[0]);

    it("keeps a settled key while the snapshot still lists its chunk", () => {
        const next = pruneSettled(new Set([k1]), GROUPS);
        expect([...next]).toEqual([k1]);
    });

    it("drops a settled key once the snapshot no longer lists its chunk", () => {
        const next = pruneSettled(new Set([k1, k2]), [RUN_B]);
        expect([...next]).toEqual([k2]);
    });

    it("drops every key from a snapshot with no To review, or none at all", () => {
        expect(pruneSettled(new Set([k1]), []).size).toBe(0);
        expect(pruneSettled(new Set([k1]), undefined).size).toBe(0);
    });

    it("returns the same set when nothing was dropped, so the atom does not churn", () => {
        const s = new Set([k1]);
        expect(pruneSettled(s, GROUPS)).toBe(s);
    });
});

describe("the sheet's cursor", () => {
    const groups = visibleGroups(GROUPS, none, none);
    const keys = reviewRowKeys(groups);

    it("lists the row keys in the order drawn", () => {
        expect(keys).toEqual([reviewKey(RUN_A.items[0]), reviewKey(RUN_B.items[0]), reviewKey(RUN_B.items[1])]);
    });

    it("moves to the next row when its row folds away, else the one before", () => {
        expect(neighborKey(keys, keys[0])).toBe(keys[1]);
        expect(neighborKey(keys, keys[1])).toBe(keys[2]);
        expect(neighborKey(keys, keys[2])).toBe(keys[1]);
    });

    it("has none when the folded row was the only one", () => {
        expect(neighborKey([keys[0]], keys[0])).toBeUndefined();
        expect(neighborKey(keys, "gone")).toBeUndefined();
    });
});
