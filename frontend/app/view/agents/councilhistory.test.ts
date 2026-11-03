// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { describe, expect, it } from "vitest";
import {
    councilHistoryCount,
    councilHistoryPinAct,
    councilHistoryRows,
    folderName,
    groupCouncilHistory,
    searchCouncilHistory,
} from "./councilhistory";

const HOUR = 60 * 60 * 1000;
const DAY = 24 * HOUR;

const roots = new Map([
    ["waveterm", "D:\\code\\waveterm"],
    ["loom", "/home/u/loom"],
]);

const council = (id: string, project: string, over: Partial<Council> = {}): Council => ({
    id,
    project,
    feature: `feature ${id}`,
    experts: [],
    state: "done",
    round: 3,
    tokens: 0,
    calls: 0,
    created: 1000,
    updated: 2000,
    ...over,
});

describe("folderName", () => {
    it("reads the last folder of either separator, a trailing one ignored", () => {
        expect(folderName("/home/u/notes/")).toBe("notes");
        expect(folderName("D:\\code\\loom")).toBe("loom");
        expect(folderName("solo")).toBe("solo");
    });
});

describe("councilHistoryRows", () => {
    it("lists every council, pinned ones and those of no registered project too, newest message first", () => {
        const rows = councilHistoryRows(
            [
                council("old", "/home/u/loom", { created: 100 }),
                council("shut", "d:/code/waveterm/", { created: 300, pinned: 9 }),
                council("loose", "/tmp/scratch", { created: 200 }),
            ],
            roots
        );
        expect(rows.map((r) => [r.id, r.projectName, r.pinned])).toEqual([
            ["shut", "waveterm", true],
            ["loose", "scratch", false],
            ["old", "loom", false],
        ]);
    });

    it("orders by the newest message, not by when the council was made, a tie broken by id", () => {
        const rows = councilHistoryRows(
            [
                council("b", "/home/u/loom", { created: 50 }),
                council("talked", "/home/u/loom", {
                    created: 10,
                    replies: [{ id: "r1", ts: 900 } as CouncilReply],
                }),
                council("a", "/home/u/loom", { created: 50 }),
            ],
            roots
        );
        expect(rows.map((r) => r.id)).toEqual(["talked", "a", "b"]);
    });

    it("counts a pinned council as pinned in any state, a running one too", () => {
        const rows = councilHistoryRows([council("again", "/home/u/loom", { state: "running", pinned: 5 })], roots);
        expect(rows[0].pinned).toBe(true);
    });

    it("keeps the question, trimmed, for the search and the row's tooltip", () => {
        const rows = councilHistoryRows([council("q", "/home/u/loom", { question: "  Which harness?  " })], roots);
        expect(rows[0].question).toBe("Which harness?");
    });

    it("marks the rows that offer Resume when given the last-opened map and the time", () => {
        const now = 10 * DAY;
        const opened = { seededAt: 0, opened: { old: now - DAY, fresh: now } };
        const list = [
            // ended three days ago and read: off the tree
            council("old", "/home/u/loom", { updated: now - 3 * DAY }),
            // ended an hour ago: the tree keeps it
            council("fresh", "/home/u/loom", { updated: now - HOUR }),
            // off the tree, but of no registered project: the tree has no folder for it
            council("loose", "/tmp/scratch", { updated: now - 3 * DAY }),
        ];
        const rows = councilHistoryRows(list, roots, new Set(), {
            opened: { ...opened, opened: { ...opened.opened, loose: now } },
            now,
        });
        expect(Object.fromEntries(rows.map((r) => [r.id, r.resumable]))).toEqual({
            old: true,
            fresh: false,
            loose: false,
        });
        // without them no row offers it
        expect(councilHistoryRows(list, roots).every((r) => !r.resumable)).toBe(true);
    });

    it("has no rows before the list is loaded", () => {
        expect(councilHistoryRows(null, roots)).toEqual([]);
    });
});

describe("searchCouncilHistory", () => {
    const rows = councilHistoryRows(
        [
            council("h", "/home/u/loom", { feature: "HarnessX", question: "Is it new?" }),
            council("w", "D:\\code\\waveterm", { feature: "Tree rows" }),
        ],
        roots
    );

    it("matches the feature, the question and the project name, case aside", () => {
        expect(searchCouncilHistory(rows, "harnessx").map((r) => r.id)).toEqual(["h"]);
        expect(searchCouncilHistory(rows, "IS IT NEW").map((r) => r.id)).toEqual(["h"]);
        expect(searchCouncilHistory(rows, "waveterm").map((r) => r.id)).toEqual(["w"]);
    });

    it("keeps every row for a blank query", () => {
        expect(searchCouncilHistory(rows, "  ")).toHaveLength(2);
    });
});

describe("groupCouncilHistory", () => {
    it("groups by the day of the newest message, an empty group left out", () => {
        const now = new Date(2026, 10, 2, 15, 0).getTime();
        const rows = councilHistoryRows(
            [
                council("today", "/home/u/loom", { created: new Date(2026, 10, 2, 0, 5).getTime() }),
                council("earlier", "/home/u/loom", { created: new Date(2026, 9, 20).getTime() }),
            ],
            roots
        );
        expect(groupCouncilHistory(rows, now).map((g) => [g.key, g.rows.map((r) => r.id)])).toEqual([
            ["today", ["today"]],
            ["earlier", ["earlier"]],
        ]);
    });

    it("puts last night in Yesterday", () => {
        const now = new Date(2026, 10, 2, 9, 0).getTime();
        const rows = councilHistoryRows(
            [council("night", "/home/u/loom", { created: new Date(2026, 10, 1, 23, 50).getTime() })],
            roots
        );
        expect(groupCouncilHistory(rows, now).map((g) => g.key)).toEqual(["yesterday"]);
    });
});

describe("councilHistoryPinAct", () => {
    it("offers Unpin on a pinned council and Pin on any other, a running or queued one too", () => {
        const rows = councilHistoryRows(
            [
                council("p", "/home/u/loom", { pinned: 7 }),
                council("run", "/home/u/loom", { state: "running" }),
                council("q", "/home/u/loom", { state: "queued" }),
            ],
            roots
        );
        const act = new Map(rows.map((r) => [r.id, councilHistoryPinAct(r)]));
        expect(act.get("p")).toEqual({ act: "unpin", label: "Unpin", pin: false });
        expect(act.get("run")).toEqual({ act: "pin", label: "Pin", pin: true });
        expect(act.get("q")).toEqual({ act: "pin", label: "Pin", pin: true });
    });
});

describe("councilHistoryCount", () => {
    it("names the pinned ones only when there are some", () => {
        const open = councilHistoryRows([council("a", "/home/u/loom")], roots);
        expect(councilHistoryCount(open)).toBe("1");
        const mixed = councilHistoryRows(
            [council("a", "/home/u/loom"), council("b", "/home/u/loom", { pinned: 3 })],
            roots
        );
        expect(councilHistoryCount(mixed)).toBe("2 · 1 pinned");
    });
});
