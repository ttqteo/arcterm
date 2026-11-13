// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { describe, expect, it } from "vitest";
import {
    BUSY_CPU_PCT,
    busyLine,
    busyReason,
    heldLine,
    keepReadings,
    machineNow,
    matchWords,
    MAX_CHUNK_LABEL,
    parkedAge,
    parkedChunk,
    parkedMeta,
    parkedTitle,
    suggestInitiative,
    withoutParked,
    withParked,
    withParkedAt,
} from "./parkedmodel";

const HOUR = 3_600_000;

const pk = (id: string, over: Partial<ParkedLaunch> = {}): ParkedLaunch => ({
    id,
    project: "arcterm",
    runtime: "claude",
    task: `task ${id}`,
    ts: 0,
    ...over,
});

describe("busyReason", () => {
    it("reads no reading as calm", () => {
        expect(busyReason([])).toBeNull();
    });

    it("parks on high or critical memory pressure from a single reading", () => {
        expect(busyReason([{ pressure: "high" }])).toBe("Memory pressure is high");
        expect(busyReason([{ pressure: "normal" }, { pressure: "critical" }])).toBe("Memory pressure is critical");
    });

    it("goes by the latest pressure: one that eased is calm", () => {
        expect(busyReason([{ pressure: "critical" }, { pressure: "normal" }])).toBeNull();
        expect(busyReason([{ pressure: "" }])).toBeNull();
    });

    it("parks on the CPU only when the last two readings are both busy", () => {
        const busy = BUSY_CPU_PCT + 7;
        expect(busyReason([{ pressure: "normal", cpupct: busy }])).toBeNull();
        expect(
            busyReason([
                { pressure: "normal", cpupct: 20 },
                { pressure: "normal", cpupct: busy },
            ])
        ).toBeNull();
        expect(
            busyReason([
                { pressure: "normal", cpupct: busy },
                { pressure: "normal", cpupct: 91.6 },
            ])
        ).toBe("CPU is 92% busy");
        expect(
            busyReason([
                { pressure: "normal", cpupct: BUSY_CPU_PCT },
                { pressure: "normal", cpupct: BUSY_CPU_PCT },
            ])
        ).toBe(`CPU is ${BUSY_CPU_PCT}% busy`);
    });

    it("never parks on a CPU reading that is missing", () => {
        expect(busyReason([{ pressure: "normal" }, { pressure: "normal", cpupct: 99 }])).toBeNull();
    });

    it("names the pressure first when both are busy", () => {
        expect(
            busyReason([
                { pressure: "high", cpupct: 99 },
                { pressure: "high", cpupct: 99 },
            ])
        ).toBe("Memory pressure is high");
    });
});

describe("keepReadings", () => {
    it("keeps the last two, the newest last", () => {
        let r = keepReadings([], { pressure: "normal", cpupct: 1 });
        r = keepReadings(r, { pressure: "normal", cpupct: 2 });
        r = keepReadings(r, { pressure: "high", cpupct: 3 });
        expect(r).toEqual([
            { pressure: "normal", cpupct: 2 },
            { pressure: "high", cpupct: 3 },
        ]);
    });
});

describe("the parked list", () => {
    it("adds a new entry last", () => {
        expect(withParked([pk("a")], pk("b")).map((p) => p.id)).toEqual(["a", "b"]);
    });

    it("replaces an entry parked again where it stood", () => {
        const next = withParked([pk("a"), pk("b"), pk("c")], pk("b", { task: "edited" }));
        expect(next.map((p) => p.id)).toEqual(["a", "b", "c"]);
        expect(next[1].task).toBe("edited");
    });

    it("removes by id, and leaves the list be for an unknown one", () => {
        expect(withoutParked([pk("a"), pk("b")], "a").map((p) => p.id)).toEqual(["b"]);
        expect(withoutParked([pk("a")], "zz").map((p) => p.id)).toEqual(["a"]);
    });

    it("puts an undone removal back at its index, clamped, and never twice", () => {
        const list = [pk("a"), pk("c")];
        expect(withParkedAt(list, pk("b"), 1).map((p) => p.id)).toEqual(["a", "b", "c"]);
        expect(withParkedAt(list, pk("b"), 9).map((p) => p.id)).toEqual(["a", "c", "b"]);
        expect(withParkedAt(list, pk("b"), -1).map((p) => p.id)).toEqual(["b", "a", "c"]);
        expect(withParkedAt(list, pk("a"), 1).map((p) => p.id)).toEqual(["a", "c"]);
    });
});

describe("the row's words", () => {
    it("names the row by the task's first line, else by the agent", () => {
        expect(parkedTitle(pk("a", { task: "\n  Tighten the tree's spacing  \nmore detail" }))).toBe(
            "Tighten the tree's spacing"
        );
        expect(parkedTitle(pk("a", { task: "  ", runtime: "pi" }))).toBe("New pi agent");
    });

    it("reads what held it and the images, the age apart", () => {
        expect(parkedMeta(pk("a", { reason: "Memory pressure is high" }))).toBe("held for RAM");
        expect(parkedMeta(pk("a", { reason: "CPU is 92% busy", images: ["/x.png"] }))).toBe("held for CPU · 1 image");
        expect(parkedMeta(pk("a", { images: ["/x.png", "/y.png"] }))).toBe("held for RAM · 2 images");
        expect(parkedAge(pk("a", { ts: 0 }), 3 * HOUR)).toBe("3h");
        expect(parkedAge(pk("a", { ts: 0 }), 0)).toBe("<1m");
    });

    it("tells the launcher that Launch agent holds it", () => {
        expect(busyLine("Memory pressure is high")).toBe(
            "Memory pressure is high: arcterm will hold this agent until you start it from its row."
        );
    });
});

describe("the held view's words", () => {
    it("says when, why and what it costs on the divider", () => {
        expect(heldLine(pk("a", { ts: 0, reason: "Memory pressure is critical" }), 3 * HOUR)).toEqual({
            when: "Held 3h ago",
            why: "memory pressure was critical",
            cost: "uses no memory until you start it",
        });
        expect(heldLine(pk("a", { ts: 0, reason: "CPU is 91% busy" }), 10_000).when).toBe("Held just now");
        expect(heldLine(pk("a", { reason: "CPU is 91% busy" }), 0).why).toBe("the CPU was busy");
        expect(heldLine(pk("a"), 0).why).toBe("the machine was busy");
    });

    it("words the machine now: busy still, calm with its free memory, nothing without a reading", () => {
        const gb = (b: number) => `${b / 1e9} GB`;
        expect(machineNow("Memory pressure is high", 1e9, gb)).toEqual({
            tone: "busy",
            text: "Memory pressure is high still: starting it may make the machine lag",
        });
        expect(machineNow(null, 2.4e9, gb)).toEqual({ tone: "calm", text: "Memory normal now · 2.4 GB free" });
        expect(machineNow(null, null, gb)).toBeNull();
    });
});

describe("suggestInitiative", () => {
    const eff = (oid: string, over: Partial<EffortSummary> = {}): EffortSummary => ({
        oref: `effort:${oid}`,
        title: oid,
        project: "arcterm",
        status: "active",
        done: 0,
        total: 0,
        updatedts: 0,
        ...over,
    });

    it("matches words in titles and chunk labels, Vietnamese too, leaving common words out", () => {
        expect([...matchWords("Fix the Agent tree's row spacing, đổi màu")].sort()).toEqual(
            ["agent", "màu", "row", "spacing", "tree", "đổi"].sort()
        );
    });

    it("picks the project's open initiative sharing the most words with the task", () => {
        const efforts = [
            eff("a", { title: "Usage lens", updatedts: 9 }),
            eff("b", { title: "Agent tree polish", chunks: [{ label: "Row spacing in folders", status: "todo" }] }),
            eff("c", { title: "Agent tree rewrite", project: "other" }),
        ];
        expect(suggestInitiative("Tighten the Agent tree's row spacing", "arcterm", efforts)).toEqual({
            oref: "effort:b",
            title: "Agent tree polish",
        });
    });

    it("falls back to the most recently updated when no word is shared", () => {
        const efforts = [eff("a", { updatedts: 1 }), eff("b", { updatedts: 5 })];
        expect(suggestInitiative("zzz qqq", "arcterm", efforts)?.oref).toBe("effort:b");
    });

    it("leaves out done, archived and topic initiatives, and has none for a project without one", () => {
        const efforts = [
            eff("topic", { title: "tree spacing", updatedts: 9 }),
            eff("child", { title: "unrelated", parentoid: "topic", updatedts: 1 }),
            eff("done", { title: "tree spacing", status: "done" }),
            eff("arch", { title: "tree spacing", status: "archived" }),
        ];
        expect(suggestInitiative("tree spacing", "arcterm", efforts)?.oref).toBe("effort:child");
        expect(suggestInitiative("tree spacing", "elsewhere", efforts)).toBeNull();
    });
});

describe("parkedChunk", () => {
    it("is the task alone when one line says it all", () => {
        expect(parkedChunk(pk("a", { task: "  Tighten the tree's spacing " }))).toEqual({
            label: "Tighten the tree's spacing",
            note: null,
        });
    });

    it("keeps the rest of the task and the screenshots in the note", () => {
        const p = pk("a", { task: "Tighten the spacing\nrows sit 2px too close", images: ["/a/1.png", "/a/2.png"] });
        expect(parkedChunk(p)).toEqual({
            label: "Tighten the spacing",
            note: [
                "Tighten the spacing\nrows sit 2px too close",
                "Screenshots:\n- /a/1.png\n- /a/2.png",
                "Held from New agent (claude).",
            ].join("\n\n"),
        });
    });

    it("clips a long first line to wavesrv's label limit and keeps the whole of it in the note", () => {
        const long = "x".repeat(MAX_CHUNK_LABEL + 50);
        const { label, note } = parkedChunk(pk("a", { task: long }));
        expect(label).toHaveLength(MAX_CHUNK_LABEL);
        expect(label.endsWith("…")).toBe(true);
        expect(note).toContain(long);
    });

    it("names the agent when there is no task", () => {
        expect(parkedChunk(pk("a", { task: "", runtime: "pi" }))).toEqual({ label: "New pi agent", note: null });
    });
});
