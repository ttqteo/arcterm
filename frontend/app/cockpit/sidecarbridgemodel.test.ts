// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { describe, expect, it, vi } from "vitest";
import {
    EMPTY_FEED,
    EMPTY_NOTES,
    HEAVY_STALE_MS,
    SNAPSHOT_THROTTLE_MS,
    afterClosed,
    afterEmit,
    afterHello,
    answerOlder,
    applyPressure,
    attachNotes,
    heavyPolls,
    machineOf,
    planChange,
    readingFresh,
    readingOf,
    roundHeavy,
    runningJobs,
    sameSnapshot,
    setNote,
    sleepNote,
    stopNote,
    strainOf,
    syncNotes,
    validateAct,
} from "./sidecarbridgemodel";
import { EMPTY_TRACK, strainNow, trackStrain } from "./sidecarstrainmodel";
import type {
    SidecarHeavy,
    SidecarMachine,
    SidecarMessage,
    SidecarSnapshot,
    SidecarStrain,
    SidecarTile,
} from "./sidecartypes";

function tile(id: string, over: Partial<SidecarTile> = {}): SidecarTile {
    return { id, name: id, runtime: "Claude · opus", state: "working", messages: [], ...over };
}

function snap(tiles: SidecarTile[], now = 1000): SidecarSnapshot {
    return { now, counts: { asking: 0, working: tiles.length, idle: 0 }, tiles };
}

const machine: SidecarMachine = { memFree: 2e9, memTotal: 16e9, cpuPct: 40, platform: "windows" };

function strain(over: Partial<SidecarStrain> = {}): SidecarStrain {
    return {
        level: "amber",
        by: "ram",
        ram: { since: 500, critical: false },
        working: 3,
        heavyJobs: 1,
        heavy: [
            { id: "w1", name: "w1", ramBytes: 3e9, process: { pid: 4242, command: "cargo build" } },
            { id: "w2", name: "w2", ramBytes: 1e9 },
        ],
        ...over,
    };
}

function snapWith(over: Partial<SidecarSnapshot>): SidecarSnapshot {
    return { ...snap([tile("w1"), tile("w2")]), ...over };
}

const asking = tile("a1", {
    state: "asking",
    ask: { question: "Pick one", options: ["x", "y", "z"], answerable: true },
});
const elsewhere = tile("a2", {
    state: "asking",
    ask: { question: "Pick several", options: ["x", "y"], answerable: false },
});
const roster = snap([asking, elsewhere, tile("w1")]);

describe("validateAct", () => {
    it("takes hello with no snapshot sent yet", () => {
        expect(validateAct({ kind: "hello" }, null)).toEqual({ ok: true, act: { kind: "hello" } });
    });

    it("refuses what is not an act, and an unknown kind", () => {
        for (const raw of [null, undefined, 3, "open", [], {}, { kind: 4 }, { kind: "close" }]) {
            const r = validateAct(raw, roster);
            expect(r.ok).toBe(false);
            if (r.ok === false) {
                expect(r.reason.length).toBeGreaterThan(0);
            }
        }
        const r = validateAct({ kind: "scroll", id: "a1" }, roster);
        expect(r).toEqual({ ok: false, reason: 'unknown act kind "scroll"' });
    });

    it("takes an open of a tile in the last snapshot", () => {
        expect(validateAct({ kind: "open", id: "w1" }, roster)).toEqual({ ok: true, act: { kind: "open", id: "w1" } });
    });

    it("refuses an open of an unknown id, a missing id, or before any snapshot", () => {
        expect(validateAct({ kind: "open", id: "ghost" }, roster)).toEqual({
            ok: false,
            reason: 'open: no tile "ghost" in the last snapshot',
        });
        expect(validateAct({ kind: "open" }, roster).ok).toBe(false);
        expect(validateAct({ kind: "open", id: 7 }, roster).ok).toBe(false);
        expect(validateAct({ kind: "open", id: "w1" }, null)).toEqual({
            ok: false,
            reason: "open: no snapshot has gone out yet",
        });
    });

    it("takes an answer to an answerable ask, option 0 up to the last one", () => {
        for (const option of [0, 1, 2]) {
            expect(validateAct({ kind: "answer", id: "a1", option }, roster)).toEqual({
                ok: true,
                act: { kind: "answer", id: "a1", option },
            });
        }
    });

    it("refuses an answer to an unknown id", () => {
        const r = validateAct({ kind: "answer", id: "ghost", option: 0 }, roster);
        expect(r).toEqual({ ok: false, reason: 'answer: no tile "ghost" in the last snapshot' });
    });

    it("refuses an answer to a tile with no ask, or an ask the main window answers", () => {
        expect(validateAct({ kind: "answer", id: "w1", option: 0 }, roster)).toEqual({
            ok: false,
            reason: 'answer: "w1" has no ask',
        });
        expect(validateAct({ kind: "answer", id: "a2", option: 0 }, roster)).toEqual({
            ok: false,
            reason: 'answer: the ask of "a2" is not answerable from a tile',
        });
    });

    it("refuses an option out of range or not a whole number", () => {
        for (const option of [-1, 3, 9, 0.5, NaN, Infinity, "1", null, undefined]) {
            const r = validateAct({ kind: "answer", id: "a1", option }, roster);
            expect(r.ok).toBe(false);
            if (r.ok === false) {
                expect(r.reason).toMatch(/^answer: option /);
            }
        }
    });

    it("keeps only the fields of the act it returns", () => {
        const r = validateAct({ kind: "open", id: "w1", extra: "x" }, roster);
        expect(r).toEqual({ ok: true, act: { kind: "open", id: "w1" } });
    });

    describe("older", () => {
        it("takes an older of a tile in the last snapshot, with a cursor or null, count 1 to 50", () => {
            expect(validateAct({ kind: "older", id: "w1", before: null, count: 10 }, roster)).toEqual({
                ok: true,
                act: { kind: "older", id: "w1", before: null, count: 10 },
            });
            expect(validateAct({ kind: "older", id: "a1", before: "m:12", count: 1 }, roster)).toEqual({
                ok: true,
                act: { kind: "older", id: "a1", before: "m:12", count: 1 },
            });
            expect(validateAct({ kind: "older", id: "a1", before: "f:300", count: 50 }, roster)).toEqual({
                ok: true,
                act: { kind: "older", id: "a1", before: "f:300", count: 50 },
            });
        });

        it("refuses an id with no tile, no id, no snapshot, and a before that is neither a string nor null", () => {
            expect(validateAct({ kind: "older", id: "ghost", before: null, count: 10 }, roster)).toEqual({
                ok: false,
                reason: 'older: no tile "ghost" in the last snapshot',
            });
            expect(validateAct({ kind: "older", before: null, count: 10 }, roster)).toEqual({
                ok: false,
                reason: "older: no id",
            });
            expect(validateAct({ kind: "older", id: "w1", before: null, count: 10 }, null)).toEqual({
                ok: false,
                reason: "older: no snapshot has gone out yet",
            });
            for (const before of [undefined, 3, {}, [], true]) {
                const r = validateAct({ kind: "older", id: "w1", before, count: 10 }, roster);
                expect(r).toEqual({
                    ok: false,
                    reason: `older: before ${String(before)} is neither a cursor nor null`,
                });
            }
        });

        it("refuses a count that is not a whole number from 1 to 50", () => {
            for (const count of [0, 51, 1.5, -3, NaN, Infinity, "10", null, undefined]) {
                const r = validateAct({ kind: "older", id: "w1", before: null, count }, roster);
                expect(r.ok).toBe(false);
                if (r.ok === false) {
                    expect(r.reason).toMatch(/^older: count /);
                }
            }
        });

        it("keeps only the fields of an older", () => {
            const r = validateAct({ kind: "older", id: "w1", before: "m:3", count: 5, extra: 1 }, roster);
            expect(r).toEqual({ ok: true, act: { kind: "older", id: "w1", before: "m:3", count: 5 } });
        });
    });

    describe("stop", () => {
        const withStrain = snapWith({ strain: strain() });

        it("takes a stop of the pid a heavy row names", () => {
            expect(validateAct({ kind: "stop", id: "w1", pid: 4242 }, withStrain)).toEqual({
                ok: true,
                act: { kind: "stop", id: "w1", pid: 4242 },
            });
        });

        it("refuses a pid that is not the row's process", () => {
            expect(validateAct({ kind: "stop", id: "w1", pid: 1 }, withStrain)).toEqual({
                ok: false,
                reason: 'stop: pid 1 is not the process of "w1" in the band',
            });
            expect(validateAct({ kind: "stop", id: "w1", pid: "4242" }, withStrain).ok).toBe(false);
            expect(validateAct({ kind: "stop", id: "w1" }, withStrain).ok).toBe(false);
        });

        it("refuses a row with no process (Sleep only) and an agent not in the band", () => {
            expect(validateAct({ kind: "stop", id: "w2", pid: 4242 }, withStrain)).toEqual({
                ok: false,
                reason: 'stop: "w2" has no process to stop',
            });
            expect(validateAct({ kind: "stop", id: "a1", pid: 4242 }, withStrain)).toEqual({
                ok: false,
                reason: 'stop: no heavy row "a1" in the last snapshot',
            });
        });

        it("refuses with no strain in the snapshot, no id, or no snapshot", () => {
            expect(validateAct({ kind: "stop", id: "w1", pid: 4242 }, roster)).toEqual({
                ok: false,
                reason: "stop: the last snapshot has no strain band",
            });
            expect(validateAct({ kind: "stop", pid: 4242 }, withStrain)).toEqual({ ok: false, reason: "stop: no id" });
            expect(validateAct({ kind: "stop", id: "w1", pid: 4242 }, null)).toEqual({
                ok: false,
                reason: "stop: no snapshot has gone out yet",
            });
        });
    });

    describe("sleep", () => {
        const withStrain = snapWith({ strain: strain() });

        it("takes a sleep of any heavy row, with or without a process", () => {
            for (const id of ["w1", "w2"]) {
                expect(validateAct({ kind: "sleep", id }, withStrain)).toEqual({
                    ok: true,
                    act: { kind: "sleep", id },
                });
            }
        });

        it("refuses an agent not in the band, even one with a tile", () => {
            expect(validateAct({ kind: "sleep", id: "a1" }, withStrain)).toEqual({
                ok: false,
                reason: 'sleep: no heavy row "a1" in the last snapshot',
            });
        });

        it("refuses with no strain in the snapshot, no id, or no snapshot", () => {
            expect(validateAct({ kind: "sleep", id: "w1" }, roster)).toEqual({
                ok: false,
                reason: "sleep: the last snapshot has no strain band",
            });
            expect(validateAct({ kind: "sleep" }, withStrain)).toEqual({ ok: false, reason: "sleep: no id" });
            expect(validateAct({ kind: "sleep", id: "w1" }, null)).toEqual({
                ok: false,
                reason: "sleep: no snapshot has gone out yet",
            });
        });

        it("keeps only the fields of a sleep", () => {
            expect(validateAct({ kind: "sleep", id: "w1", pid: 4242 }, withStrain)).toEqual({
                ok: true,
                act: { kind: "sleep", id: "w1" },
            });
        });
    });
});

describe("sameSnapshot", () => {
    it("ignores now", () => {
        expect(sameSnapshot(snap([asking], 1), snap([asking], 99999))).toBe(true);
    });

    it("sees a changed tile, a changed message, a changed order and a changed count", () => {
        const base = snap([tile("a"), tile("b")]);
        expect(sameSnapshot(base, snap([tile("a"), tile("b", { state: "idle" })]))).toBe(false);
        expect(sameSnapshot(base, snap([tile("a"), tile("b", { messages: [{ say: "hi" }] })]))).toBe(false);
        expect(sameSnapshot(base, snap([tile("b"), tile("a")]))).toBe(false);
        expect(sameSnapshot(base, snap([tile("a")]))).toBe(false);
        expect(sameSnapshot(base, { ...base, counts: { asking: 1, working: 1, idle: 0 } })).toBe(false);
    });

    it("sees a changed since, ctxPct and sent flag", () => {
        const base = snap([tile("a", { since: 5, ctxPct: 10 })]);
        expect(sameSnapshot(base, snap([tile("a", { since: 6, ctxPct: 10 })]))).toBe(false);
        expect(sameSnapshot(base, snap([tile("a", { since: 5, ctxPct: 11 })]))).toBe(false);
        expect(sameSnapshot(base, snap([tile("a", { since: 5, ctxPct: 10, sent: true })]))).toBe(false);
    });

    it("sees a changed strain level and a changed machine reading", () => {
        const base = snapWith({ machine, strain: strain() });
        expect(sameSnapshot(base, snapWith({ machine, strain: strain() }))).toBe(true);
        expect(sameSnapshot(base, snapWith({ machine, strain: strain({ level: "red" }) }))).toBe(false);
        expect(sameSnapshot(base, snapWith({ machine: { ...machine, cpuPct: 41 }, strain: strain() }))).toBe(false);
        expect(sameSnapshot(base, snapWith({ machine: { ...machine, memFree: 1e9 }, strain: strain() }))).toBe(false);
    });

    it("sees a strain that appears or goes, and a heavy row's note", () => {
        const base = snapWith({ machine, strain: strain() });
        expect(sameSnapshot(base, snapWith({ machine }))).toBe(false);
        expect(sameSnapshot(snapWith({ machine }), base)).toBe(false);
        expect(sameSnapshot(snapWith({}), snapWith({ machine }))).toBe(false);
        const noted = strain();
        noted.heavy[0].note = "Not run (fixture)";
        expect(sameSnapshot(base, snapWith({ machine, strain: noted }))).toBe(false);
    });

    it("still ignores now with a machine and a strain in it", () => {
        expect(
            sameSnapshot(
                snapWith({ now: 1, machine, strain: strain() }),
                snapWith({ now: 9, machine, strain: strain() })
            )
        ).toBe(true);
    });

    it("treats nothing sent as different from any snapshot", () => {
        expect(sameSnapshot(null, snap([]))).toBe(false);
        expect(sameSnapshot(snap([]), null)).toBe(false);
    });
});

describe("planChange", () => {
    const next = snap([tile("a")]);

    it("emits at once the first time", () => {
        expect(planChange(EMPTY_FEED, next, false, 10_000)).toEqual({ kind: "emit" });
    });

    it("says nothing for a snapshot equal to the last one sent, ignoring now", () => {
        const feed = afterEmit(snap([tile("a")], 1), 10_000);
        expect(planChange(feed, snap([tile("a")], 99), false, 20_000)).toEqual({ kind: "none" });
    });

    it("emits at once when the last emit is a throttle window or more ago", () => {
        const feed = afterEmit(snap([]), 10_000);
        expect(planChange(feed, next, false, 10_000 + SNAPSHOT_THROTTLE_MS)).toEqual({ kind: "emit" });
        expect(planChange(feed, next, false, 10_000 + SNAPSHOT_THROTTLE_MS + 700)).toEqual({ kind: "emit" });
    });

    it("schedules the trailing emit for what is left of the window", () => {
        const feed = afterEmit(snap([]), 10_000);
        expect(planChange(feed, next, false, 10_100)).toEqual({ kind: "later", delayMs: SNAPSHOT_THROTTLE_MS - 100 });
        expect(planChange(feed, next, false, 10_000)).toEqual({ kind: "later", delayMs: SNAPSHOT_THROTTLE_MS });
    });

    it("coalesces into a trailing emit already scheduled", () => {
        const feed = afterEmit(snap([]), 10_000);
        expect(planChange(feed, next, true, 10_200)).toEqual({ kind: "none" });
    });

    it("a trailing emit that fires after the window asks again with no timer pending, and emits", () => {
        const feed = afterEmit(snap([]), 10_000);
        const first = planChange(feed, next, false, 10_100);
        expect(first).toEqual({ kind: "later", delayMs: SNAPSHOT_THROTTLE_MS - 100 });
        // the timer fires at 10_500 and clears its own flag
        expect(planChange(feed, next, false, 10_500)).toEqual({ kind: "emit" });
    });

    it("still emits a change right after one whose snapshot differs, once the window is up", () => {
        expect(planChange(afterEmit(snap([tile("a")]), 10_000), snap([tile("a"), tile("b")]), false, 10_900)).toEqual({
            kind: "emit",
        });
    });

    it("a trailing emit whose change was undone by the time it fires says nothing", () => {
        const feed = afterEmit(snap([tile("a")]), 10_000);
        expect(planChange(feed, snap([tile("a")]), false, 10_500)).toEqual({ kind: "none" });
    });
});

describe("the last-sent memory", () => {
    it("starts with nothing sent and no emit time", () => {
        expect(EMPTY_FEED).toEqual({ lastSent: null, lastEmitAt: null });
    });

    it("afterEmit keeps the snapshot and when it went out", () => {
        const s = snap([tile("a")]);
        expect(afterEmit(s, 5)).toEqual({ lastSent: s, lastEmitAt: 5 });
    });

    it("a hello forgets the last snapshot sent, so an unchanged roster still goes out again", () => {
        const s = snap([tile("a")]);
        const feed = afterEmit(s, 10_000);
        expect(planChange(feed, snap([tile("a")]), false, 20_000)).toEqual({ kind: "none" });
        const reset = afterHello(feed);
        expect(reset.lastSent).toBeNull();
        expect(planChange(reset, snap([tile("a")]), false, 20_000)).toEqual({ kind: "emit" });
    });

    it("a hello leaves the act check with nothing to validate against until the answering emit", () => {
        const s = snap([tile("a")]);
        const reset = afterHello(afterEmit(s, 10_000));
        expect(validateAct({ kind: "open", id: "a" }, reset.lastSent).ok).toBe(false);
        const sent = afterEmit(s, 10_001);
        expect(validateAct({ kind: "open", id: "a" }, sent.lastSent).ok).toBe(true);
    });

    it("sidecar:closed forgets everything, so the next page's first snapshot goes out at once", () => {
        const feed = afterEmit(snap([tile("a")]), 10_000);
        const closed = afterClosed();
        expect(closed).toEqual(EMPTY_FEED);
        expect(planChange(closed, snap([tile("a")]), false, 10_001)).toEqual({ kind: "emit" });
        expect(feed.lastSent).not.toBeNull(); // the old memory is not mutated
    });
});

const GB = 2 ** 30;
const MB = 2 ** 20;

function stats(over: Partial<MachineStatsData> = {}): MachineStatsData {
    return {
        memtotal: 32 * GB,
        memavailable: 2.13 * GB,
        pressure: "high",
        cpupct: 93.4,
        swaptotal: 16 * GB,
        swapused: 9.24 * GB,
        disks: [],
        ...over,
    };
}

describe("machineOf", () => {
    it("rounds the memory figures to a tenth of a GiB and the CPU to a whole percent", () => {
        const m = machineOf(stats(), "windows");
        expect(m.memFree / GB).toBeCloseTo(2.1, 6);
        expect(m.memTotal / GB).toBeCloseTo(32, 6);
        expect(m.swapUsed! / GB).toBeCloseTo(9.2, 6);
        expect(m.cpuPct).toBe(93);
        expect(m.platform).toBe("windows");
    });

    it("gives the same machine for readings that only jitter, so a poll does not re-emit the snapshot", () => {
        const a = machineOf(stats({ memavailable: 2.11 * GB, cpupct: 93.2, swapused: 9.21 * GB }), "macos");
        const b = machineOf(stats({ memavailable: 2.14 * GB, cpupct: 92.6, swapused: 9.24 * GB }), "macos");
        expect(a).toEqual(b);
        expect(machineOf(stats({ memavailable: 2.2 * GB }), "macos")).not.toEqual(a);
    });

    it("leaves swapUsed out when nothing is in swap and cpuPct out before the first CPU reading", () => {
        const m = machineOf(stats({ swapused: 0.02 * GB, cpupct: undefined }), "other");
        expect(Object.keys(m).sort()).toEqual(["memFree", "memTotal", "platform"]);
    });
});

describe("readingOf and applyPressure", () => {
    it("reads the pressure word, the memory and the CPU of a machine reading", () => {
        expect(readingOf(stats(), 1234)).toEqual({
            at: 1234,
            pressure: "high",
            memFree: 2.13 * GB,
            memTotal: 32 * GB,
            cpuPct: 93.4,
        });
        expect("cpuPct" in readingOf(stats({ cpupct: undefined }), 1)).toBe(false);
    });

    it("a memorypressure event moves the level and the memory and keeps the last poll's CPU and total", () => {
        const next = applyPressure(stats(), { level: "critical", memavailable: 0.6 * GB });
        expect(next).toEqual(stats({ pressure: "critical", memavailable: 0.6 * GB }));
        expect(readingOf(next!, 9)).toMatchObject({ pressure: "critical", memTotal: 32 * GB, cpuPct: 93.4 });
    });

    it("an event between two polls does not restart the 120 s CPU streak", () => {
        // 25 polls 5 s apart at 95% CPU: the streak starts at the first and is 120 s old at the last
        let track = EMPTY_TRACK;
        let s = stats({ pressure: "normal", cpupct: 95 });
        for (let i = 0; i < 25; i++) {
            track = trackStrain(track, readingOf(s, 1_000_000 + i * 5_000));
        }
        expect(strainNow(track)?.cpu?.since).toBe(1_000_000);
        // an event 2 s after the last poll
        s = applyPressure(s, { level: "normal", memavailable: 3 * GB })!;
        track = trackStrain(track, readingOf(s, 1_000_000 + 24 * 5_000 + 2_000));
        expect(strainNow(track)?.cpu?.since).toBe(1_000_000);
    });

    it("answers nothing for an event heard before any poll: there is no total or CPU to carry", () => {
        expect(applyPressure(null, { level: "high", memavailable: GB })).toBeNull();
    });

    it("ignores the fields of a malformed event", () => {
        expect(applyPressure(stats(), undefined)).toEqual(stats());
        expect(applyPressure(stats(), { level: 3 as unknown as string, memavailable: NaN })).toEqual(stats());
    });
});

describe("heavyPolls", () => {
    it("runs no poll while there is no strain", () => {
        expect(heavyPolls(null)).toEqual({ consumers: false, cpu: false });
    });

    it("polls the consumers when the band measures by RAM, the CPU reading when by CPU", () => {
        expect(heavyPolls({ level: "amber", ram: { since: 1, critical: false } })).toEqual({
            consumers: true,
            cpu: false,
        });
        expect(heavyPolls({ level: "red", ram: { since: 1, critical: true } })).toEqual({
            consumers: true,
            cpu: false,
        });
        expect(heavyPolls({ level: "amber", cpu: { since: 1, pct: 95 } })).toEqual({ consumers: false, cpu: true });
    });

    it("polls only the consumers when both are up: RAM is the one that kills processes", () => {
        expect(heavyPolls({ level: "amber", ram: { since: 1, critical: false }, cpu: { since: 1, pct: 95 } })).toEqual({
            consumers: true,
            cpu: false,
        });
    });
});

describe("readingFresh", () => {
    it("takes a reading younger than HEAVY_STALE_MS, up to and including it", () => {
        expect(readingFresh(100_000, 100_000)).toBe(true);
        expect(readingFresh(100_000 - HEAVY_STALE_MS, 100_000)).toBe(true);
    });

    it("refuses an older one and one that never landed: a panel read from an hour ago names no one", () => {
        expect(readingFresh(100_000 - HEAVY_STALE_MS - 1, 100_000)).toBe(false);
        expect(readingFresh(null, 100_000)).toBe(false);
    });
});

describe("roundHeavy", () => {
    it("rounds RAM as the band prints it and CPU to a whole percent, the process's figures too", () => {
        const rows: SidecarHeavy[] = [
            {
                id: "a",
                name: "a",
                ramBytes: 1.26 * GB,
                process: { pid: 7, command: "cargo", ramBytes: 312.4 * MB },
            },
            { id: "b", name: "b", cpuPct: 41.6, process: { pid: 8, command: "node", cpuPct: 38.2 } },
        ];
        const out = roundHeavy(rows);
        expect(out[0].ramBytes! / GB).toBeCloseTo(1.3, 6);
        expect(out[0].process!.ramBytes).toBe(312 * MB);
        expect(out[1].cpuPct).toBe(42);
        expect(out[1].process!.cpuPct).toBe(38);
        expect(out[0].process!.pid).toBe(7);
        expect(out[1].process!.command).toBe("node");
    });

    it("gives two readings that jitter the same rows, so a poll does not re-emit the snapshot", () => {
        const row = (ram: number, cpu: number): SidecarHeavy[] => [
            { id: "a", name: "a", ramBytes: ram, cpuPct: cpu, process: { pid: 1, command: "x", ramBytes: ram - MB } },
        ];
        expect(roundHeavy(row(1.51 * GB, 40.2))).toEqual(roundHeavy(row(1.54 * GB, 39.6)));
        expect(roundHeavy(row(700 * MB, 40.2))).toEqual(roundHeavy(row(700.3 * MB, 40.4)));
    });

    it("keeps a positive CPU share at 1% at least, and leaves absent fields absent", () => {
        const out = roundHeavy([{ id: "a", name: "a", cpuPct: 0.3, process: { pid: 1, command: "x", cpuPct: 0.2 } }]);
        expect(out[0].cpuPct).toBe(1);
        expect(out[0].process!.cpuPct).toBe(1);
        const bare = roundHeavy([{ id: "b", name: "b", ramBytes: 2 * GB }]);
        expect(Object.keys(bare[0]).sort()).toEqual(["id", "name", "ramBytes"]);
    });

    it("does not touch the rows it is given", () => {
        const rows: SidecarHeavy[] = [{ id: "a", name: "a", cpuPct: 41.6 }];
        roundHeavy(rows);
        expect(rows[0].cpuPct).toBe(41.6);
    });
});

describe("strainOf and runningJobs", () => {
    const heavy: SidecarHeavy[] = [{ id: "a", name: "a", ramBytes: GB }];

    it("builds the snapshot's strain from the model's state, the counts and the heavy rows", () => {
        const s = strainOf({ level: "amber", ram: { since: 5, critical: false } }, 7, 2, heavy);
        expect(s).toEqual({
            level: "amber",
            by: "ram",
            ram: { since: 5, critical: false },
            working: 7,
            heavyJobs: 2,
            heavy,
        });
        expect("cpu" in s).toBe(false);
    });

    it("names the measure the band's heavy rows came from, and rounds the CPU percent it says", () => {
        const s = strainOf({ level: "amber", cpu: { since: 6, pct: 95.4 } }, 3, 0, []);
        expect(s.by).toBe("cpu");
        expect(s.cpu).toEqual({ since: 6, pct: 95 });
        expect("ram" in s).toBe(false);
    });

    it("counts the running jobs of the queue, none when it has not been read", () => {
        expect(runningJobs(null)).toBe(0);
        const job = (running?: boolean) => ({
            id: "j",
            name: "j",
            bytes: 1,
            queuedts: 1,
            ...(running === undefined ? {} : { running }),
        });
        const q = { slots: 2, mode: "auto", jobs: [job(true), job(false), job(), job(true)] } as JobQueueData;
        expect(runningJobs(q)).toBe(2);
    });
});

describe("a heavy row's note", () => {
    it("starts empty and is kept while the band's level and the agent's place in it stay", () => {
        let n = syncNotes(EMPTY_NOTES, "amber", ["a", "b"]);
        expect(n).toEqual({ level: "amber", byId: {} });
        n = setNote(n, "a", "Not run (fixture)");
        expect(syncNotes(n, "amber", ["b", "a"]).byId).toEqual({ a: "Not run (fixture)" });
    });

    it("is cleared when the band's level changes, and when the band goes", () => {
        const n = setNote(syncNotes(EMPTY_NOTES, "amber", ["a"]), "a", "x");
        expect(syncNotes(n, "red", ["a"])).toEqual({ level: "red", byId: {} });
        expect(syncNotes(n, null, [])).toEqual({ level: null, byId: {} });
    });

    it("is dropped when its agent leaves the band, the others kept", () => {
        const n = setNote(setNote(syncNotes(EMPTY_NOTES, "amber", ["a", "b"]), "a", "x"), "b", "y");
        expect(syncNotes(n, "amber", ["b", "c"]).byId).toEqual({ b: "y" });
    });

    it("is replaced by the next outcome of the same row, and setNote does not mutate", () => {
        const n = syncNotes(EMPTY_NOTES, "amber", ["a"]);
        const one = setNote(n, "a", "first");
        const two = setNote(one, "a", "second");
        expect(one.byId.a).toBe("first");
        expect(two.byId.a).toBe("second");
        expect(n.byId).toEqual({});
    });

    it("attaches to the rows that have one and leaves the others without a note field", () => {
        const rows: SidecarHeavy[] = [
            { id: "a", name: "a" },
            { id: "b", name: "b" },
        ];
        const out = attachNotes(rows, { b: "Already going to sleep" });
        expect("note" in out[0]).toBe(false);
        expect(out[1].note).toBe("Already going to sleep");
        expect("note" in rows[1]).toBe(false);
    });
});

describe("sleepNote and stopNote", () => {
    it("words what each Sleep outcome did, as the row says it", () => {
        expect(sleepNote("busy")).toBe("Already going to sleep");
        expect(sleepNote("asked")).toBe("Confirm in the main window");
        expect(sleepNote("slept")).toBe("Put to sleep");
        expect(sleepNote("compacting")).toBe("Compacting first · it sleeps once the summary lands");
        expect(sleepNote("failed")).toBe("Couldn't put it to sleep · see the main window");
    });

    it("takes the server's text from a refused Stop", () => {
        expect(stopNote(new Error("pid 4242 is not a descendant of this agent"))).toBe(
            "pid 4242 is not a descendant of this agent"
        );
        expect(stopNote("access denied")).toBe("access denied");
    });

    it("says something for a refusal with no text, and cuts a long one", () => {
        expect(stopNote(new Error(""))).toBe("Couldn't stop it");
        const long = stopNote(new Error("x".repeat(500)));
        expect(long.length).toBeLessThanOrEqual(160);
        expect(long.endsWith("…")).toBe(true);
    });
});

describe("answerOlder", () => {
    const rows = (n: number, from = 0): SidecarMessage[] =>
        Array.from({ length: n }, (_, i) => ({ say: `m${from + i}` }));
    const shown = rows(3, 100);
    const act = (before: string | null, count = 10) => ({ id: "a1", before, count });

    function readers() {
        return { memory: vi.fn(), file: vi.fn() };
    }

    it("pages the rows the main window holds for an agent that has some, past what the tile shows", async () => {
        const r = readers();
        const all = rows(30);
        r.memory.mockReturnValue({ rows: rows(10, 17), next: "m:17" });
        const out = await answerOlder(act(null), { all, shown }, r, vi.fn());
        expect(out).toEqual({ id: "a1", before: null, rows: rows(10, 17), next: "m:17" });
        expect(r.memory).toHaveBeenCalledWith(all, shown.length, null, 10);
        expect(r.file).not.toHaveBeenCalled();
    });

    it("hands the cursor back to the page unchanged in the answer, and to the reader", async () => {
        const r = readers();
        r.memory.mockReturnValue({ rows: [], next: null });
        const out = await answerOlder(act("m:17", 25), { all: rows(30), shown }, r, vi.fn());
        expect(out).toEqual({ id: "a1", before: "m:17", rows: [], next: null });
        expect(r.memory).toHaveBeenCalledWith(expect.anything(), shown.length, "m:17", 25);
    });

    it("reads the transcript file for an agent with nothing in memory", async () => {
        const r = readers();
        r.file.mockResolvedValue({ rows: rows(4), next: "f:100" });
        const out = await answerOlder(
            act("f:500"),
            { all: [], shown, path: "C:/t/a.jsonl", agent: "claude" },
            r,
            vi.fn()
        );
        expect(out).toEqual({ id: "a1", before: "f:500", rows: rows(4), next: "f:100" });
        expect(r.file).toHaveBeenCalledWith("C:/t/a.jsonl", "claude", "f:500", shown);
        expect(r.memory).not.toHaveBeenCalled();
    });

    it("answers rows [] and next null when the read fails, and logs it: no error loop", async () => {
        const r = readers();
        r.file.mockRejectedValue(new Error("no transcript file yet at C:/t/a.jsonl"));
        const log = vi.fn();
        const out = await answerOlder(act(null), { all: [], shown, path: "C:/t/a.jsonl" }, r, log);
        expect(out).toEqual({ id: "a1", before: null, rows: [], next: null });
        expect(log).toHaveBeenCalledTimes(1);
        expect(log.mock.calls[0][0]).toContain("a1");
        expect(log.mock.calls[0][0]).toContain("no transcript file yet");
    });

    it("answers nothing earlier for an agent with neither entries in memory nor a transcript path", async () => {
        const r = readers();
        for (const path of [undefined, ""]) {
            const out = await answerOlder(act(null), { all: [], shown, path }, r, vi.fn());
            expect(out).toEqual({ id: "a1", before: null, rows: [], next: null });
        }
        expect(r.memory).not.toHaveBeenCalled();
        expect(r.file).not.toHaveBeenCalled();
    });

    it("prefers memory over the file when both exist: the main window's rows are the ones the tile shows", async () => {
        const r = readers();
        r.memory.mockReturnValue({ rows: [], next: null });
        await answerOlder(act(null), { all: rows(5), shown, path: "C:/t/a.jsonl" }, r, vi.fn());
        expect(r.memory).toHaveBeenCalledTimes(1);
        expect(r.file).not.toHaveBeenCalled();
    });
});
