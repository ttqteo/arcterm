// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { describe, expect, it } from "vitest";
import {
    BUSY_CPU_PCT,
    busyLine,
    busyReason,
    keepReadings,
    MAX_CHUNK_LABEL,
    parkedChunk,
    parkedMeta,
    parkedTitle,
    parkedTooltip,
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

    it("reads Parked, the agent, the images and the age", () => {
        expect(parkedMeta(pk("a", { ts: 0 }), 3 * HOUR)).toBe("Parked · claude · 3h");
        expect(parkedMeta(pk("a", { images: ["/x.png"] }), 0)).toBe("Parked · claude · 1 image · <1m");
        expect(parkedMeta(pk("a", { images: ["/x.png", "/y.png"] }), 0)).toBe("Parked · claude · 2 images · <1m");
    });

    it("tooltips the whole task and why it waited", () => {
        expect(parkedTooltip(pk("a", { task: "line one\nline two", reason: "CPU is 90% busy" }))).toBe(
            "line one\nline two\n\nParked: CPU is 90% busy"
        );
        expect(parkedTooltip(pk("a", { task: "" }))).toBe("New claude agent\n\nParked for later");
    });

    it("tells the launcher's two ways on", () => {
        expect(busyLine("Memory pressure is high", "Enter", "⌘Enter")).toBe(
            "Memory pressure is high: Enter parks this agent for later, ⌘Enter starts it anyway."
        );
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
                "Parked from New agent (claude).",
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
