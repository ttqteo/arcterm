// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import type { ProviderDonuts } from "@/app/view/agents/ratelimitstore";
import type { RunInfo, RunRole } from "@/app/view/agents/runlineage";
import { describe, expect, it } from "vitest";
import {
    EMPTY_FEED,
    EMPTY_NOTES,
    HEAVY_STALE_MS,
    SNAPSHOT_THROTTLE_MS,
    afterClosed,
    afterEmit,
    afterHello,
    applyPressure,
    attachNotes,
    decorateTiles,
    dueLabel,
    heavyPolls,
    machineOf,
    newestActiveRun,
    planChange,
    readingFresh,
    readingOf,
    roundHeavy,
    runBoxOf,
    runFailed,
    runLeadId,
    runningJobs,
    sameSnapshot,
    setNote,
    sleepNote,
    stampSince,
    stopNote,
    strainOf,
    syncNotes,
    usageOf,
    validateAct,
} from "./sidecarbridgemodel";
import { EMPTY_TRACK, strainNow, trackStrain } from "./sidecarstrainmodel";
import type {
    SidecarHeavy,
    SidecarMachine,
    SidecarNeed,
    SidecarResources,
    SidecarRunBox,
    SidecarSnapshot,
    SidecarStrain,
    SidecarTile,
    SidecarUsage,
} from "./sidecartypes";

function tile(id: string, over: Partial<SidecarTile> = {}): SidecarTile {
    return { id, name: id, runtime: "Claude · opus", state: "working", ...over };
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
    ask: { question: "Pick one", options: ["x", "y", "z"], answerable: true, key: "ask-a1" },
});
const elsewhere = tile("a2", {
    state: "asking",
    ask: { question: "Pick several", options: ["x", "y"], answerable: false },
});
// the Needs you list the answer, need and open acts are checked against: an answerable ask, one the main window answers,
// a finished agent's question and a Jarvis row; "far" is an agent past the orbit's eight, so it is no tile of the snapshot
const askNeed: SidecarNeed = {
    key: "ask:a1",
    kind: "ask",
    id: "a1",
    who: "a1",
    since: 10,
    text: "Pick one",
    options: ["x", "y", "z"],
    answerable: true,
    askKey: "ask-a1",
};
const elsewhereNeed: SidecarNeed = {
    key: "ask:a2",
    kind: "ask",
    id: "a2",
    who: "a2",
    since: 20,
    text: "Pick several",
    options: ["x", "y"],
    answerable: false,
};
const questionNeed: SidecarNeed = {
    key: "q:far",
    kind: "question",
    id: "far",
    who: "far",
    since: 30,
    text: "Ship it?",
};
const farAskNeed: SidecarNeed = {
    key: "ask:far2",
    kind: "ask",
    id: "far2",
    who: "far2",
    since: 40,
    text: "Which?",
    options: ["a", "b"],
    answerable: true,
    askKey: "ask-far2",
};
const jarvisNeed: SidecarNeed = {
    key: "gate:run1:2",
    kind: "jarvis",
    who: "Plan run",
    since: 50,
    text: "Review the plan",
    word: "gate",
};
const needs = [askNeed, elsewhereNeed, questionNeed, farAskNeed, jarvisNeed];
const roster: SidecarSnapshot = { ...snap([asking, elsewhere, tile("w1")]), needs };

describe("validateAct", () => {
    it("takes hello with no snapshot sent yet", () => {
        expect(validateAct({ kind: "hello" }, null)).toEqual({ ok: true, act: { kind: "hello" } });
    });

    it("takes the resource panel's open and close, keeping only whole positive pids", () => {
        expect(validateAct({ kind: "resources", open: true, pids: [12, -1, 3.5, "x", 40] }, null)).toEqual({
            ok: true,
            act: { kind: "resources", open: true, pids: [12, 40] },
        });
        expect(validateAct({ kind: "resources", open: false }, null)).toEqual({
            ok: true,
            act: { kind: "resources", open: false, pids: [] },
        });
        expect(validateAct({ kind: "resources" }, null).ok).toBe(false);
        expect(validateAct({ kind: "visible", visible: false, extra: 1 }, null)).toEqual({
            ok: true,
            act: { kind: "visible", visible: false },
        });
        expect(validateAct({ kind: "visible" }, null).ok).toBe(false);
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

    it("takes an open of a question or ask row's agent that is no tile (past the orbit's eight)", () => {
        expect(validateAct({ kind: "open", id: "far" }, roster)).toEqual({
            ok: true,
            act: { kind: "open", id: "far" },
        });
        expect(validateAct({ kind: "open", id: "far2" }, roster)).toEqual({
            ok: true,
            act: { kind: "open", id: "far2" },
        });
        // a Jarvis row has no agent: its key is no id to open
        expect(validateAct({ kind: "open", id: "gate:run1:2" }, roster).ok).toBe(false);
    });

    it("takes an answer to an answerable ask in needs, option 0 up to the last one", () => {
        for (const option of [0, 1, 2]) {
            expect(validateAct({ kind: "answer", id: "a1", option, key: "ask-a1" }, roster)).toEqual({
                ok: true,
                act: { kind: "answer", id: "a1", option, key: "ask-a1" },
            });
        }
    });

    it("takes an answer to an ask row whose agent is no tile of the snapshot", () => {
        expect(validateAct({ kind: "answer", id: "far2", option: 1, key: "ask-far2" }, roster)).toEqual({
            ok: true,
            act: { kind: "answer", id: "far2", option: 1, key: "ask-far2" },
        });
    });

    it("refuses an answer that names another ask than the row's, or none", () => {
        // the page showed ask-old; a snapshot since brought ask-a1, so the number was picked for another question
        for (const key of ["ask-old", undefined, 7]) {
            expect(validateAct({ kind: "answer", id: "a1", option: 0, key }, roster)).toEqual({
                ok: false,
                reason: 'answer: the ask of "a1" changed since the page showed it',
            });
        }
    });

    it("refuses an answer to an id that is not in needs, a tile that has no ask row included", () => {
        const ghost = validateAct({ kind: "answer", id: "ghost", option: 0 }, roster);
        expect(ghost).toEqual({ ok: false, reason: 'answer: "ghost" has no ask in the last snapshot' });
        // w1 is a tile, but nothing of it waits on you
        expect(validateAct({ kind: "answer", id: "w1", option: 0 }, roster)).toEqual({
            ok: false,
            reason: 'answer: "w1" has no ask in the last snapshot',
        });
        // a tile that still holds an ask the needs no longer list: the answer is checked against needs, not the tile
        const gone: SidecarSnapshot = { ...roster, needs: needs.filter((n) => n.key !== "ask:a1") };
        expect(validateAct({ kind: "answer", id: "a1", option: 0, key: "ask-a1" }, gone).ok).toBe(false);
        // a question row is no ask, so no number answers it
        expect(validateAct({ kind: "answer", id: "far", option: 0, key: "x" }, roster).ok).toBe(false);
        expect(validateAct({ kind: "answer", id: "a1", option: 0, key: "ask-a1" }, snap([asking]))).toEqual({
            ok: false,
            reason: 'answer: "a1" has no ask in the last snapshot',
        });
        expect(validateAct({ kind: "answer", id: "a1", option: 0, key: "ask-a1" }, null)).toEqual({
            ok: false,
            reason: "answer: no snapshot has gone out yet",
        });
    });

    it("refuses an answer to an ask the main window answers", () => {
        expect(validateAct({ kind: "answer", id: "a2", option: 0 }, roster)).toEqual({
            ok: false,
            reason: 'answer: the ask of "a2" is not answerable from the list',
        });
    });

    it("refuses an option out of range or not a whole number", () => {
        // 3 is options.length: the last option is 2
        for (const option of [-1, 3, 9, 0.5, NaN, Infinity, "1", null, undefined]) {
            const r = validateAct({ kind: "answer", id: "a1", option, key: "ask-a1" }, roster);
            expect(r.ok).toBe(false);
            if (r.ok === false) {
                expect(r.reason).toMatch(/^answer: option /);
            }
        }
    });

    describe("need", () => {
        it("takes a need of a Jarvis row's key in the last snapshot", () => {
            expect(validateAct({ kind: "need", key: "gate:run1:2" }, roster)).toEqual({
                ok: true,
                act: { kind: "need", key: "gate:run1:2" },
            });
        });

        it("refuses a key that is not a Jarvis row, an ask or question row's key included", () => {
            expect(validateAct({ kind: "need", key: "nope" }, roster)).toEqual({
                ok: false,
                reason: 'need: "nope" is not waiting',
            });
            expect(validateAct({ kind: "need", key: "ask:a1" }, roster)).toEqual({
                ok: false,
                reason: 'need: "ask:a1" is not waiting',
            });
            expect(validateAct({ kind: "need", key: "q:far" }, roster).ok).toBe(false);
        });

        it("refuses a missing or non-string key, no needs in the snapshot, and no snapshot", () => {
            expect(validateAct({ kind: "need" }, roster)).toEqual({ ok: false, reason: "need: no key" });
            expect(validateAct({ kind: "need", key: 4 }, roster).ok).toBe(false);
            expect(validateAct({ kind: "need", key: "gate:run1:2" }, snap([tile("w1")])).ok).toBe(false);
            expect(validateAct({ kind: "need", key: "gate:run1:2" }, null)).toEqual({
                ok: false,
                reason: "need: no snapshot has gone out yet",
            });
        });

        it("keeps only the fields of the act it returns", () => {
            expect(validateAct({ kind: "need", key: "gate:run1:2", extra: 1 }, roster)).toEqual({
                ok: true,
                act: { kind: "need", key: "gate:run1:2" },
            });
        });
    });

    it("keeps only the fields of the act it returns", () => {
        const r = validateAct({ kind: "open", id: "w1", extra: "x" }, roster);
        expect(r).toEqual({ ok: true, act: { kind: "open", id: "w1" } });
    });

    it("refuses the scrollback's older act, which the dashboard no longer has", () => {
        expect(validateAct({ kind: "older", id: "w1", before: null, count: 10 }, roster)).toEqual({
            ok: false,
            reason: 'unknown act kind "older"',
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

    it("sees a changed tile, a changed ask, a changed order and a changed count", () => {
        const base = snap([tile("a"), tile("b")]);
        expect(sameSnapshot(base, snap([tile("a"), tile("b", { state: "idle" })]))).toBe(false);
        const ask = { question: "Q?", options: [], answerable: false };
        expect(sameSnapshot(base, snap([tile("a"), tile("b", { ask })]))).toBe(false);
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

    // the dashboard's four fields: each one alone makes a different snapshot
    const run: SidecarRunBox = { id: "r1", title: "Build it", done: 1, total: 4, failed: false };
    const usage: SidecarUsage = { fiveHourPct: 40, weekPct: 12 };
    const full = snapWith({ needs: [askNeed, jarvisNeed], run, usage, more: 2 });
    const again = () =>
        snapWith({ needs: [{ ...askNeed }, { ...jarvisNeed }], run: { ...run }, usage: { ...usage }, more: 2 });

    it("is the same when needs, run, usage and more are equal by value", () => {
        expect(sameSnapshot(full, again())).toBe(true);
        expect(sameSnapshot(snapWith({}), snapWith({}))).toBe(true);
    });

    it("sees a changed needs alone", () => {
        expect(sameSnapshot(full, { ...again(), needs: [askNeed] })).toBe(false);
        expect(sameSnapshot(full, { ...again(), needs: [{ ...askNeed, since: 11 }, jarvisNeed] })).toBe(false);
        expect(sameSnapshot(full, { ...again(), needs: undefined })).toBe(false);
        expect(sameSnapshot(snapWith({}), { ...snapWith({}), needs: [askNeed] })).toBe(false);
    });

    it("sees a changed run alone", () => {
        expect(sameSnapshot(full, { ...again(), run: { ...run, done: 2 } })).toBe(false);
        expect(sameSnapshot(full, { ...again(), run: { ...run, failed: true } })).toBe(false);
        expect(sameSnapshot(full, { ...again(), run: undefined })).toBe(false);
    });

    it("sees a changed usage alone", () => {
        expect(sameSnapshot(full, { ...again(), usage: { ...usage, fiveHourPct: 41 } })).toBe(false);
        expect(sameSnapshot(full, { ...again(), usage: { fiveHourPct: 40 } })).toBe(false);
        expect(sameSnapshot(full, { ...again(), usage: undefined })).toBe(false);
    });

    it("sees a changed more alone", () => {
        expect(sameSnapshot(full, { ...again(), more: 3 })).toBe(false);
        expect(sameSnapshot(full, { ...again(), more: undefined })).toBe(false);
    });

    // the resource panel's reading rides on the snapshot: a poll that changes nothing else must still go out, or the
    // panel would stay on "Measuring…" until some other field moved
    it("sees a changed resources alone, and the panel opening or closing", () => {
        const row = { key: "sidecar", label: "Sidecar", kind: "sidecar" as const, cpu: 1.5, mem: 40 * 1024 * 1024 };
        const reading = (cpu: number, history = [{ t: 1, cpu: 10, mem: 50 }]): SidecarResources => ({
            state: "ready",
            rows: [{ ...row, cpu }],
            others: [],
            history,
        });
        const withRes = (r: SidecarResources | undefined) => ({ ...again(), resources: r });
        const base = withRes(reading(1.5));
        expect(sameSnapshot(base, withRes(reading(1.5)))).toBe(true);
        expect(sameSnapshot(base, withRes(reading(2.5)))).toBe(false);
        // a new point on a chart, though every row read the same
        const longer = [
            { t: 1, cpu: 10, mem: 50 },
            { t: 3, cpu: 12, mem: 50 },
        ];
        expect(sameSnapshot(base, withRes(reading(1.5, longer)))).toBe(false);
        // the first reading after "measuring", the panel opening and the panel closing
        expect(sameSnapshot(withRes({ state: "measuring", rows: [], others: [], history: [] }), base)).toBe(false);
        expect(sameSnapshot(withRes(undefined), base)).toBe(false);
        expect(sameSnapshot(base, withRes(undefined))).toBe(false);
        expect(sameSnapshot(withRes(undefined), withRes(undefined))).toBe(true);
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

describe("stampSince", () => {
    it("leaves a tile that has a since alone, and returns the same tiles when none lacks one", () => {
        const tiles = [tile("a", { since: 5 }), tile("b", { since: 9, state: "idle" })];
        const r = stampSince(tiles, new Map(), 100);
        expect(r.tiles).toBe(tiles);
        expect(r.seen.size).toBe(0);
    });

    it("gives a tile with no since the build that first saw it, and the same one on every build after", () => {
        const tiles = [tile("a", { state: "idle" })];
        const first = stampSince(tiles, new Map(), 100);
        expect(first.tiles[0].since).toBe(100);
        const later = stampSince(tiles, first.seen, 9000);
        expect(later.tiles[0].since).toBe(100);
        // so a need built from it is the same row on the next build
        expect(sameSnapshot({ ...snap(first.tiles), needs: [] }, { ...snap(later.tiles), needs: [] })).toBe(true);
    });

    it("starts over when the tile's state changes, and forgets a tile that has left", () => {
        const first = stampSince([tile("a", { state: "idle" }), tile("b", { state: "idle" })], new Map(), 100);
        const next = stampSince([tile("a", { state: "review" })], first.seen, 200);
        expect(next.tiles[0].since).toBe(200);
        expect([...next.seen.keys()]).toEqual(["a:review"]);
    });

    it("does not change the tiles it was given", () => {
        const tiles = [tile("a", { state: "idle" })];
        stampSince(tiles, new Map(), 100);
        expect(tiles[0].since).toBeUndefined();
    });
});

function runInfo(runId: string, over: Partial<RunInfo> = {}): RunInfo {
    return { runId, channelId: `ch-${runId}`, title: `Run ${runId}`, project: "arcterm", ...over };
}

describe("newestActiveRun", () => {
    it("is the newest run that has not ended", () => {
        const runs = {
            old: runInfo("old", { createdTs: 100, status: "running" }),
            mid: runInfo("mid", { createdTs: 200, status: "running" }),
            done: runInfo("done", { createdTs: 900, status: "done" }),
        };
        expect(newestActiveRun(runs)?.runId).toBe("mid");
    });

    it("skips a quick run, a done or cancelled run (by its dag too), and is null with none left", () => {
        const runs = {
            quick: runInfo("quick", { createdTs: 500, mode: "quick", status: "running" }),
            cancelled: runInfo("cancelled", { createdTs: 400, status: "cancelled" }),
            dagDone: runInfo("dagDone", {
                createdTs: 300,
                status: "running",
                dag: { status: "done", tasks: [] } as never,
            }),
        };
        expect(newestActiveRun(runs)).toBeNull();
        expect(newestActiveRun({})).toBeNull();
    });

    it("counts a blocked run, which waits on you, as active; a run with no createdTs is oldest; ties go by id", () => {
        const runs = {
            b: runInfo("b", { createdTs: 50, status: "blocked" }),
            a: runInfo("a", { createdTs: 50, status: "blocked" }),
            none: runInfo("none", { status: "running" }),
        };
        expect(newestActiveRun(runs)?.runId).toBe("a");
        expect(newestActiveRun({ none: runs.none })?.runId).toBe("none");
    });
});

describe("runLeadId", () => {
    it("is the agent whose role is lead of that run, not a worker or stage of it", () => {
        const roles: Record<string, RunRole> = {
            w1: { kind: "worker", leadRunId: "r1", taskId: "t1" },
            s1: { kind: "stage", leadRunId: "r1", stageRole: "final" },
            lead2: { kind: "lead", runId: "r2" },
            lead1: { kind: "lead", runId: "r1" },
        };
        expect(runLeadId(roles, "r1")).toBe("lead1");
        expect(runLeadId(roles, "r2")).toBe("lead2");
        expect(runLeadId(roles, "r3")).toBeUndefined();
    });
});

describe("runFailed", () => {
    const failedNeed: SidecarNeed = { ...jarvisNeed, key: "unverified:r1", failed: true };
    const items = new Map([
        ["unverified:r1", { runid: "r1" }],
        ["gate:run1:2", { runid: "r1" }],
    ]);

    it("is true while a failed need's attention item names the run", () => {
        expect(runFailed([failedNeed], items, "r1")).toBe(true);
    });

    it("is false for another run, for a need that is not failed, and for a failed need whose item has no run", () => {
        expect(runFailed([failedNeed], items, "r2")).toBe(false);
        expect(runFailed([jarvisNeed], items, "r1")).toBe(false);
        expect(runFailed([{ ...failedNeed, key: "orphan" }], new Map([["orphan", {}]]), "r1")).toBe(false);
        expect(runFailed([failedNeed], new Map(), "r1")).toBe(false);
        expect(runFailed([], items, "r1")).toBe(false);
    });
});

describe("dueLabel", () => {
    const item = (kind: string, chunklabel?: string) => ({ kind, chunklabel }) as AttentionItem;

    it("is the first chunk-due item's label, and none when there is none", () => {
        expect(dueLabel([item("dag-gate", "x"), item("chunk-due", "Re-measure RAM"), item("chunk-due", "Later")])).toBe(
            "Re-measure RAM"
        );
        expect(dueLabel([item("dag-gate"), item("chunk-due")])).toBeUndefined();
        expect(dueLabel([item("chunk-due", "")])).toBeUndefined();
        expect(dueLabel([])).toBeUndefined();
    });
});

describe("runBoxOf", () => {
    const dag = {
        status: "running",
        tasks: [{ state: "done" }, { state: "skipped" }, { state: "running" }, { state: "pending" }],
    } as never;

    it("carries the title, the progress, when it began and what it was given", () => {
        expect(
            runBoxOf(runInfo("r1", { createdTs: 70, dag }), { leadId: "L", failed: false, due: "Re-measure" })
        ).toEqual({
            id: "r1",
            leadId: "L",
            title: "Run r1",
            done: 2,
            total: 4,
            failed: false,
            since: 70,
            due: "Re-measure",
        });
    });

    it("leaves out the lead, since and due it has none of, and counts 0 of 0 before a dag", () => {
        const box = runBoxOf(runInfo("r2"), { failed: true });
        expect(box).toEqual({ id: "r2", title: "Run r2", done: 0, total: 0, failed: true });
        expect("leadId" in box || "since" in box || "due" in box).toBe(false);
    });
});

describe("usageOf", () => {
    const donut = (provider: string, five?: number, week?: number): ProviderDonuts => ({
        provider,
        fivehour: { pct: five },
        week: { pct: week },
    });

    it("is the claude provider's two windows, in whole percents", () => {
        expect(usageOf([donut("codex", 90, 90), donut("claude", 41.6, 12.2)])).toEqual({
            fiveHourPct: 42,
            weekPct: 12,
        });
    });

    it("leaves a window out when it has no reading, and is empty with no claude provider", () => {
        expect(usageOf([donut("claude", 30)])).toEqual({ fiveHourPct: 30 });
        expect(usageOf([donut("claude", undefined, 5)])).toEqual({ weekPct: 5 });
        expect(usageOf([donut("claude", NaN, Infinity)])).toEqual({});
        expect(usageOf([donut("codex", 50, 50)])).toEqual({});
        expect(usageOf([])).toEqual({});
    });
});

describe("decorateTiles", () => {
    it("marks the lead of a failed run failed, and no one else", () => {
        const tiles = [tile("L"), tile("w")];
        const out = decorateTiles(tiles, { failedLead: "L", diffs: {} });
        expect(out[0].failed).toBe(true);
        expect(out[1].failed).toBeUndefined();
    });

    it("gives a review tile its diff, and only a review tile with lines changed", () => {
        const diffs = {
            r: { files: 2, adds: 12, dels: 3 },
            zero: { files: 0, adds: 0, dels: 0 },
            w: { files: 1, adds: 5, dels: 5 },
        };
        const out = decorateTiles(
            [
                tile("r", { state: "review" }),
                tile("zero", { state: "review" }),
                tile("w"),
                tile("none", { state: "review" }),
            ],
            { diffs }
        );
        expect(out[0].diff).toEqual({ adds: 12, dels: 3 });
        expect(out[1].diff).toBeUndefined();
        expect(out[2].diff).toBeUndefined();
        expect(out[3].diff).toBeUndefined();
    });

    it("returns tiles it did not change as they were, and never changes the ones it was given", () => {
        const tiles = [tile("a"), tile("b", { state: "review" })];
        const out = decorateTiles(tiles, { diffs: { b: { files: 1, adds: 1, dels: 0 } } });
        expect(out[0]).toBe(tiles[0]);
        expect(out[1]).not.toBe(tiles[1]);
        expect(tiles[1].diff).toBeUndefined();
    });
});
