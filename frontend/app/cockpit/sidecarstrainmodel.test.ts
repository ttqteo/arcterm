// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { describe, expect, it } from "vitest";
import {
    bandShows,
    bandTitle,
    bandWhy,
    CLEAR_MS,
    CPU_GAP_MS,
    CPU_HOT_MS,
    EMPTY_TRACK,
    formatBytes,
    heavyAgents,
    MachineReading,
    machineReadout,
    MAX_HEAVY,
    nextHidden,
    strainBy,
    strainNow,
    StrainTrack,
    trackStrain,
} from "./sidecarstrainmodel";
import type { SidecarMachine, SidecarStrain, StrainLevel } from "./sidecartypes";

const GB = 2 ** 30;
const MB = 2 ** 20;
const SEC = 1000;
const MIN = 60 * SEC;
const T0 = 1_700_000_000_000;

function reading(secs: number, over: Partial<MachineReading> = {}): MachineReading {
    return { at: T0 + secs * SEC, pressure: "normal", memFree: 8 * GB, memTotal: 32 * GB, cpuPct: 20, ...over };
}

/** Feed readings one after another into a track that starts empty (or at `from`). */
function feed(readings: MachineReading[], from: StrainTrack = EMPTY_TRACK): StrainTrack {
    let t = from;
    for (const r of readings) {
        t = trackStrain(t, r);
    }
    return t;
}

/** Readings every `step` seconds from `from` to `to` (both included) with these overrides. */
function span(from: number, to: number, step: number, over: Partial<MachineReading> = {}): MachineReading[] {
    const out: MachineReading[] = [];
    for (let s = from; s <= to; s += step) {
        out.push(reading(s, over));
    }
    return out;
}

const level = (t: StrainTrack) => strainNow(t)?.level ?? null;

describe("trackStrain: memory pressure", () => {
    it("shows nothing before any reading and at normal pressure", () => {
        expect(strainNow(EMPTY_TRACK)).toBeNull();
        expect(level(feed(span(0, 120, 5)))).toBeNull();
    });

    it("shows amber at once at high pressure, since that reading", () => {
        const t = feed([reading(0), reading(5, { pressure: "high", memFree: 2 * GB })]);
        expect(strainNow(t)).toEqual({ level: "amber", ram: { since: T0 + 5 * SEC, critical: false } });
    });

    it("keeps the RAM streak's start while the pressure stays up", () => {
        const t = feed([...span(0, 60, 10, { pressure: "high" })]);
        expect(strainNow(t)?.ram).toEqual({ since: T0, critical: false });
    });

    it("shows red at once at critical pressure", () => {
        const t = feed([reading(0), reading(5, { pressure: "critical", memFree: 0.5 * GB })]);
        expect(strainNow(t)).toEqual({ level: "red", ram: { since: T0 + 5 * SEC, critical: true } });
    });

    it("rises from amber to red at once", () => {
        const t = feed([reading(0, { pressure: "high" }), reading(5, { pressure: "critical" })]);
        expect(level(t)).toBe("red");
    });

    it("treats a pressure word it does not know as normal", () => {
        expect(level(feed([reading(0, { pressure: "unknown" })]))).toBeNull();
    });
});

describe("trackStrain: clearing", () => {
    it("steps red to amber only after 30 s under it, then off after 30 s more", () => {
        let t = feed([reading(0, { pressure: "critical" }), reading(10)]);
        expect(level(t)).toBe("red");
        t = feed([reading(39)], t); // 29 s under red
        expect(level(t)).toBe("red");
        t = feed([reading(40)], t); // 30 s under red
        expect(level(t)).toBe("amber");
        t = feed([reading(69)], t); // 29 s since the step
        expect(level(t)).toBe("amber");
        t = feed([reading(70)], t); // 30 s since the step
        expect(level(t)).toBeNull();
    });

    it("steps red to amber when the pressure falls to high, and keeps amber while it stays high", () => {
        const t = feed([reading(0, { pressure: "critical" }), ...span(5, 200, 5, { pressure: "high" })]);
        expect(level(t)).toBe("amber");
    });

    it("clears amber only after 30 s under it", () => {
        let t = feed([reading(0, { pressure: "high" }), reading(10)]);
        t = feed([reading(39)], t);
        expect(level(t)).toBe("amber");
        t = feed([reading(40)], t);
        expect(level(t)).toBeNull();
    });

    it("keeps the band through a dip shorter than 30 s", () => {
        const t = feed([
            reading(0, { pressure: "high" }),
            reading(10),
            reading(20),
            reading(30, { pressure: "high" }),
            ...span(35, 55, 5), // under the line again from 35: 20 s by 55
        ]);
        expect(level(t)).toBe("amber");
    });

    it("forgets a dip when the level comes back, so the next dip counts from its own start", () => {
        const t = feed([
            reading(0, { pressure: "critical" }),
            reading(10), // under red from 10
            reading(20, { pressure: "critical" }), // back: the count starts over
            reading(25), // under red from 25
            reading(54), // 29 s
        ]);
        expect(level(t)).toBe("red");
        expect(level(feed([reading(55)], t))).toBe("amber");
    });

    it("holds what the band showed while it waits to clear", () => {
        const t = feed([reading(0, { pressure: "critical" }), reading(10)]);
        expect(strainNow(t)).toEqual({ level: "red", ram: { since: T0, critical: true } });
    });

    it("names RAM as high, not critical, once it steps down from red", () => {
        const t = feed([reading(0, { pressure: "critical" }), ...span(5, 40, 5)]);
        expect(strainNow(t)).toEqual({ level: "amber", ram: { since: T0, critical: false } });
    });

    it("has the clear time it documents", () => {
        expect(CLEAR_MS).toBe(30_000);
    });
});

describe("trackStrain: CPU", () => {
    it("shows nothing at 95% for 119 s, amber at 120 s since the streak's start", () => {
        let t = feed(span(0, 115, 5, { cpuPct: 95 }));
        expect(level(t)).toBeNull();
        t = feed([reading(119, { cpuPct: 95 })], t);
        expect(level(t)).toBeNull();
        t = feed([reading(120, { cpuPct: 95 })], t);
        expect(strainNow(t)).toEqual({ level: "amber", cpu: { since: T0, pct: 95 } });
    });

    it("needs the readings to be over 90, not at it", () => {
        expect(level(feed(span(0, 300, 5, { cpuPct: 90 })))).toBeNull();
        expect(level(feed(span(0, 300, 5, { cpuPct: 91 })))).toBe("amber");
    });

    it("takes the streak's latest reading as its percent", () => {
        const t = feed([...span(0, 115, 5, { cpuPct: 95 }), reading(120, { cpuPct: 98 })]);
        expect(strainNow(t)?.cpu).toEqual({ since: T0, pct: 98 });
    });

    it("restarts the streak at one reading at 85%", () => {
        let t = feed([
            ...span(0, 60, 5, { cpuPct: 95 }),
            reading(65, { cpuPct: 85 }),
            ...span(70, 185, 5, { cpuPct: 95 }),
        ]);
        expect(level(t)).toBeNull(); // 115 s since 70
        t = feed([reading(190, { cpuPct: 95 })], t);
        expect(strainNow(t)?.cpu).toEqual({ since: T0 + 70 * SEC, pct: 95 });
    });

    it("restarts the streak after a gap over 15 s: no data is not proof", () => {
        let t = feed([...span(0, 60, 5, { cpuPct: 95 }), ...span(80, 195, 5, { cpuPct: 95 })]);
        expect(level(t)).toBeNull(); // 115 s since 80
        t = feed([reading(200, { cpuPct: 95 })], t);
        expect(strainNow(t)?.cpu?.since).toBe(T0 + 80 * SEC);
    });

    it("keeps the streak through a gap of exactly 15 s", () => {
        expect(CPU_GAP_MS).toBe(15_000);
        const t = feed([reading(0, { cpuPct: 95 }), reading(15, { cpuPct: 95 }), ...span(30, 120, 15, { cpuPct: 95 })]);
        expect(strainNow(t)?.cpu?.since).toBe(T0);
    });

    it("restarts the streak at a reading with no CPU figure", () => {
        let t = feed([...span(0, 60, 5, { cpuPct: 95 }), reading(65, { cpuPct: undefined })]);
        t = feed(span(70, 185, 5, { cpuPct: 95 }), t);
        expect(level(t)).toBeNull();
        t = feed([reading(190, { cpuPct: 95 })], t);
        expect(strainNow(t)?.cpu?.since).toBe(T0 + 70 * SEC);
    });

    it("clears 30 s after the CPU falls under the line, like RAM", () => {
        let t = feed(span(0, 120, 5, { cpuPct: 95 }));
        expect(level(t)).toBe("amber");
        t = feed(span(125, 150, 5, { cpuPct: 40 }), t);
        expect(level(t)).toBe("amber");
        t = feed([reading(155, { cpuPct: 40 })], t);
        expect(level(t)).toBeNull();
    });

    it("shows both parts when RAM and CPU are up", () => {
        const t = feed([
            ...span(0, 115, 5, { cpuPct: 95, pressure: "high" }),
            reading(120, { cpuPct: 96, pressure: "high" }),
        ]);
        expect(strainNow(t)).toEqual({
            level: "amber",
            ram: { since: T0, critical: false },
            cpu: { since: T0, pct: 96 },
        });
    });

    it("has the windows it documents", () => {
        expect(CPU_HOT_MS).toBe(120_000);
    });
});

describe("trackStrain: late readings", () => {
    it("ignores a reading older than the last one, so a late event cannot rewind the track", () => {
        const t = feed([reading(100, { pressure: "high" })]);
        expect(trackStrain(t, reading(50))).toEqual(t);
        expect(level(trackStrain(t, reading(50)))).toBe("amber");
    });

    it("ignores a reading at the last one's own time", () => {
        const t = feed([reading(100, { pressure: "high" })]);
        expect(trackStrain(t, reading(100, { pressure: "critical" }))).toEqual(t);
    });

    it("does not touch the track it was given", () => {
        const t = feed([reading(0, { pressure: "high" })]);
        const before = JSON.parse(JSON.stringify(t));
        trackStrain(t, reading(10));
        expect(JSON.parse(JSON.stringify(t))).toEqual(before);
    });
});

describe("strainBy", () => {
    it("is RAM when both are up", () => {
        expect(strainBy({ level: "amber", ram: { since: 1, critical: false }, cpu: { since: 1, pct: 95 } })).toBe(
            "ram"
        );
    });

    it("is RAM when only RAM is up, CPU when only CPU is", () => {
        expect(strainBy({ level: "amber", ram: { since: 1, critical: false } })).toBe("ram");
        expect(strainBy({ level: "amber", cpu: { since: 1, pct: 95 } })).toBe("cpu");
    });
});

describe("heavyAgents", () => {
    const tiles = [
        { id: "a", name: "alpha" },
        { id: "b", name: "beta" },
        { id: "c", name: "gamma" },
        { id: "d", name: "delta" },
        { id: "e", name: "epsilon" },
    ];
    const blocks: Record<string, string> = { a: "blk-a", b: "blk-b", c: "blk-c", d: "blk-d", e: "blk-e" };
    const blockOf = (id: string) => blocks[id];

    function consumer(tabid: string, rambytes?: number, heaviest?: ConsumerProcess): ConsumerAgent {
        return { tabid, blockid: `blk-${tabid}`, rambytes, tokensread: false, heaviest };
    }
    function consumers(agents: ConsumerAgent[]): CommandGetConsumersRtnData {
        return { totalbytes: 32 * GB, availablebytes: 2 * GB, windowms: 0, agents, swapusedbytes: 0 };
    }
    function cpuAgent(blockid: string, cpu: number, top?: AgentCpuProcess): AgentCpuAgent {
        return { blockid, cpu, top };
    }

    it("picks the top 3 by RAM, heaviest first", () => {
        const c = consumers([
            consumer("a", 1 * GB),
            consumer("b", 3 * GB),
            consumer("c", 2 * GB),
            consumer("d", 5 * GB),
            consumer("e", 4 * GB),
        ]);
        const rows = heavyAgents("ram", tiles, c, null, blockOf, {});
        expect(rows.map((r) => r.id)).toEqual(["d", "e", "b"]);
        expect(rows.map((r) => r.name)).toEqual(["delta", "epsilon", "beta"]);
        expect(rows.map((r) => r.ramBytes)).toEqual([5 * GB, 4 * GB, 3 * GB]);
        expect(rows).toHaveLength(MAX_HEAVY);
    });

    it("skips terminals (ids that are not tiles), zeros and missing readings", () => {
        const c = consumers([
            consumer("term-1", 9 * GB),
            consumer("a", 0),
            consumer("b", undefined),
            consumer("c", 1 * GB),
        ]);
        expect(heavyAgents("ram", tiles, c, null, blockOf, {}).map((r) => r.id)).toEqual(["c"]);
    });

    it("carries the heaviest process as what Stop ends, or none", () => {
        const c = consumers([
            consumer("a", 3 * GB, { pid: 4242, command: "node next build", bytes: 2.9 * GB }),
            consumer("b", 2 * GB),
        ]);
        const rows = heavyAgents("ram", tiles, c, null, blockOf, {});
        expect(rows[0].process).toEqual({ pid: 4242, command: "node next build", ramBytes: 2.9 * GB });
        expect("process" in rows[1]).toBe(false);
    });

    it("attaches a note by id, and only where there is one", () => {
        const c = consumers([consumer("a", 3 * GB), consumer("b", 2 * GB)]);
        const rows = heavyAgents("ram", tiles, c, null, blockOf, { b: "Already going to sleep" });
        expect("note" in rows[0]).toBe(false);
        expect(rows[1].note).toBe("Already going to sleep");
    });

    it("lists an agent once when the reading names it twice", () => {
        const c = consumers([consumer("a", 3 * GB), consumer("a", 1 * GB)]);
        expect(heavyAgents("ram", tiles, c, null, blockOf, {})).toHaveLength(1);
    });

    it("picks the top 3 by CPU through the tile's block, heaviest first", () => {
        const cpu: AgentCpuData = {
            supported: true,
            ready: true,
            agents: [
                cpuAgent("blk-a", 10),
                cpuAgent("blk-b", 40),
                cpuAgent("blk-c", 25),
                cpuAgent("blk-d", 55),
                cpuAgent("blk-e", 5),
            ],
        };
        const rows = heavyAgents("cpu", tiles, null, cpu, blockOf, {});
        expect(rows.map((r) => r.id)).toEqual(["d", "b", "c"]);
        expect(rows.map((r) => r.cpuPct)).toEqual([55, 40, 25]);
        expect("ramBytes" in rows[0]).toBe(false);
    });

    it("skips a block no tile owns, a tile with no block, zeros and a missing reading by CPU", () => {
        const cpu: AgentCpuData = {
            supported: true,
            ready: true,
            agents: [cpuAgent("blk-term", 80), cpuAgent("blk-a", 0), cpuAgent("blk-c", 7)],
        };
        const noBlockForB = (id: string) => (id === "b" ? undefined : blocks[id]);
        const rows = heavyAgents("cpu", tiles, null, cpu, noBlockForB, {});
        expect(rows.map((r) => r.id)).toEqual(["c"]);
    });

    it("carries the busiest process by CPU as what Stop ends", () => {
        const cpu: AgentCpuData = {
            supported: true,
            ready: true,
            agents: [
                cpuAgent("blk-a", 30, { pid: 77, command: "latexmk -pdf main.tex", cpu: 22 }),
                cpuAgent("blk-b", 20),
            ],
        };
        const rows = heavyAgents("cpu", tiles, null, cpu, blockOf, {});
        expect(rows[0].process).toEqual({ pid: 77, command: "latexmk -pdf main.tex", cpuPct: 22 });
        expect("process" in rows[1]).toBe(false);
    });

    it("answers nothing while the reading is not in", () => {
        expect(heavyAgents("ram", tiles, null, null, blockOf, {})).toEqual([]);
        expect(heavyAgents("cpu", tiles, null, null, blockOf, {})).toEqual([]);
        const notReady: AgentCpuData = { supported: true, ready: false, agents: [] };
        expect(heavyAgents("cpu", tiles, null, notReady, blockOf, {})).toEqual([]);
    });
});

describe("nextHidden and bandShows (the × memory)", () => {
    it("shows the band at any level when nothing is hidden", () => {
        expect(bandShows("amber", null)).toBe(true);
        expect(bandShows("red", null)).toBe(true);
    });

    it("shows nothing when there is no strain", () => {
        expect(bandShows(null, null)).toBe(false);
        expect(bandShows(null, "amber")).toBe(false);
    });

    it("keeps a band hidden at amber hidden at amber, shows it at red and again back at amber", () => {
        let hidden: StrainLevel | null = "amber"; // × pressed at amber
        expect(bandShows("amber", hidden)).toBe(false);
        hidden = nextHidden(hidden, "amber");
        expect(hidden).toBe("amber");
        expect(bandShows("amber", hidden)).toBe(false);
        expect(bandShows("red", hidden)).toBe(true);
        hidden = nextHidden(hidden, "red");
        expect(bandShows("red", hidden)).toBe(true);
        expect(bandShows("amber", hidden)).toBe(true); // back at amber: the earlier × is forgotten
    });

    it("clears the memory when the band goes", () => {
        expect(nextHidden("amber", null)).toBeNull();
        expect(nextHidden("red", null)).toBeNull();
        expect(nextHidden(null, "amber")).toBeNull();
    });
});

describe("bandTitle", () => {
    const base: SidecarStrain = { level: "amber", by: "ram", working: 0, heavyJobs: 0, heavy: [] };

    it("has board E's two titles", () => {
        expect(bandTitle(base)).toBe("The machine is strained");
        expect(bandTitle({ ...base, level: "red" })).toBe("The machine is about to run out of memory");
    });
});

describe("bandWhy", () => {
    const now = T0 + 10 * MIN;
    const windows: SidecarMachine = { memFree: 2.1 * GB, memTotal: 32 * GB, platform: "windows" };

    function strain(over: Partial<SidecarStrain> = {}): SidecarStrain {
        return { level: "amber", by: "ram", working: 0, heavyJobs: 0, heavy: [], ...over };
    }

    it("reads like board E's amber line", () => {
        const s = strain({
            ram: { since: now - 3 * MIN, critical: false },
            cpu: { since: now - 2 * MIN, pct: 93 },
            working: 7,
            heavyJobs: 2,
        });
        expect(bandWhy(s, windows, now)).toBe(
            "RAM high for 3 min (2.1 GB free of 32 GB) · CPU over 90% for 2 min · 7 agents working, 2 heavy jobs running"
        );
    });

    it("reads like board E's red line, with no agent count", () => {
        const s = strain({
            level: "red",
            ram: { since: now - 3 * MIN, critical: true },
            cpu: { since: now - 4 * MIN, pct: 98 },
            working: 7,
            heavyJobs: 2,
        });
        const m: SidecarMachine = { memFree: 0.6 * GB, memTotal: 32 * GB, swapUsed: 9.2 * GB, platform: "windows" };
        expect(bandWhy(s, m, now)).toBe(
            "RAM critical (0.6 GB free, swap 9.2 GB) · CPU at 98% for 4 min · Windows may start killing processes"
        );
    });

    it("leaves out the swap when there is none", () => {
        const s = strain({ level: "red", ram: { since: now - MIN, critical: true } });
        const noSwap: SidecarMachine = { memFree: 0.6 * GB, memTotal: 32 * GB, swapUsed: 0, platform: "windows" };
        expect(bandWhy(s, noSwap, now)).toBe("RAM critical (0.6 GB free) · Windows may start killing processes");
        const none: SidecarMachine = { memFree: 0.6 * GB, memTotal: 32 * GB, platform: "windows" };
        expect(bandWhy(s, none, now)).toBe("RAM critical (0.6 GB free) · Windows may start killing processes");
    });

    it("leaves out the CPU part when CPU is not up", () => {
        const s = strain({ level: "red", ram: { since: now - MIN, critical: true } });
        const m: SidecarMachine = { ...windows, memFree: 0.6 * GB, swapUsed: 9.2 * GB };
        expect(bandWhy(s, m, now)).toBe(
            "RAM critical (0.6 GB free, swap 9.2 GB) · Windows may start killing processes"
        );
    });

    it("names the OS from the platform", () => {
        const s = strain({ level: "red", ram: { since: now - MIN, critical: true } });
        const mac: SidecarMachine = { memFree: 0.6 * GB, memTotal: 8 * GB, platform: "macos" };
        const other: SidecarMachine = { memFree: 0.6 * GB, memTotal: 8 * GB, platform: "other" };
        expect(bandWhy(s, mac, now)).toBe("RAM critical (0.6 GB free) · macOS may start killing processes");
        expect(bandWhy(s, other, now)).toBe("RAM critical (0.6 GB free) · The system may start killing processes");
        expect(bandWhy(s, undefined, now)).toBe("RAM critical · The system may start killing processes");
    });

    it("reads a CPU-only amber band", () => {
        const s = strain({ by: "cpu", cpu: { since: now - 2 * MIN, pct: 93 }, working: 3 });
        expect(bandWhy(s, { ...windows, cpuPct: 93 }, now)).toBe("CPU over 90% for 2 min · 3 agents working");
    });

    it("leaves out the free figure when the machine is not known", () => {
        const s = strain({ ram: { since: now - 3 * MIN, critical: false } });
        expect(bandWhy(s, undefined, now)).toBe("RAM high for 3 min");
    });

    it("leaves out a count of 0 and says one in the singular", () => {
        const ram = { since: now - 3 * MIN, critical: false };
        expect(bandWhy(strain({ ram, working: 7, heavyJobs: 0 }), windows, now)).toBe(
            "RAM high for 3 min (2.1 GB free of 32 GB) · 7 agents working"
        );
        expect(bandWhy(strain({ ram, working: 0, heavyJobs: 2 }), windows, now)).toBe(
            "RAM high for 3 min (2.1 GB free of 32 GB) · 2 heavy jobs running"
        );
        expect(bandWhy(strain({ ram, working: 1, heavyJobs: 1 }), windows, now)).toBe(
            "RAM high for 3 min (2.1 GB free of 32 GB) · 1 agent working, 1 heavy job running"
        );
    });

    it("words ages in minutes, and in the wall's hours-and-minutes past an hour", () => {
        const at = (ms: number) => bandWhy(strain({ ram: { since: now - ms, critical: false } }), undefined, now);
        expect(at(20 * SEC)).toBe("RAM high for <1 min");
        expect(at(3 * MIN + 59 * SEC)).toBe("RAM high for 3 min");
        expect(at(65 * MIN)).toBe("RAM high for 1h 05m");
        expect(at(-5 * SEC)).toBe("RAM high for <1 min");
    });
});

describe("machineReadout", () => {
    const m: SidecarMachine = { memFree: 2.1 * GB, memTotal: 32 * GB, cpuPct: 93, platform: "windows" };

    it("shortens to the numbers", () => {
        expect(machineReadout(m, undefined)).toEqual({
            ram: "2.1 GB",
            cpu: "93%",
            ramTone: "normal",
            cpuTone: "normal",
        });
    });

    it("tones RAM amber when RAM is up, red when it is critical", () => {
        const amber: SidecarStrain = {
            level: "amber",
            by: "ram",
            ram: { since: 1, critical: false },
            working: 0,
            heavyJobs: 0,
            heavy: [],
        };
        expect(machineReadout(m, amber)).toMatchObject({ ramTone: "amber", cpuTone: "normal" });
        const red: SidecarStrain = { ...amber, level: "red", ram: { since: 1, critical: true } };
        expect(machineReadout(m, red)).toMatchObject({ ramTone: "red", cpuTone: "normal" });
    });

    it("tones CPU amber when CPU is up", () => {
        const s: SidecarStrain = {
            level: "amber",
            by: "cpu",
            cpu: { since: 1, pct: 95 },
            working: 0,
            heavyJobs: 0,
            heavy: [],
        };
        expect(machineReadout(m, s)).toMatchObject({ ramTone: "normal", cpuTone: "amber" });
    });

    it("shows a dash where there is no reading", () => {
        expect(machineReadout(undefined, undefined)).toEqual({
            ram: "—",
            cpu: "—",
            ramTone: "normal",
            cpuTone: "normal",
        });
        const noCpu: SidecarMachine = { memFree: 300 * MB, memTotal: 8 * GB, platform: "macos" };
        expect(machineReadout(noCpu, undefined)).toMatchObject({ ram: "300 MB", cpu: "—" });
    });

    it("rounds the CPU to a whole percent", () => {
        expect(machineReadout({ ...m, cpuPct: 92.6 }, undefined).cpu).toBe("93%");
    });
});

describe("formatBytes", () => {
    it("says GB with one decimal, dropping a trailing .0", () => {
        expect(formatBytes(2.1 * GB)).toBe("2.1 GB");
        expect(formatBytes(0.6 * GB)).toBe("0.6 GB");
        expect(formatBytes(32 * GB)).toBe("32 GB");
        expect(formatBytes(9.8 * GB)).toBe("9.8 GB");
        expect(formatBytes(1 * GB)).toBe("1 GB");
    });

    it("says MB under half a gigabyte", () => {
        expect(formatBytes(300 * MB)).toBe("300 MB");
        expect(formatBytes(450 * MB)).toBe("450 MB");
        expect(formatBytes(0.5 * GB)).toBe("0.5 GB");
        expect(formatBytes(0.6 * GB)).toBe("0.6 GB"); // board E's red line
    });

    it("never says a thousand MB", () => {
        expect(formatBytes(1023.8 * MB)).toBe("1 GB");
        expect(formatBytes(0)).toBe("0 MB");
        expect(formatBytes(-5)).toBe("0 MB");
        expect(formatBytes(Number.NaN)).toBe("0 MB");
    });
});
