// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { describe, expect, it } from "vitest";
import { agentRamBytes, needsConsumersPoll, runRamBytes } from "./agentram";

const MB = 1024 * 1024;

const group = (key: string, ownerid: string | undefined, mem: number): ResMonGroup => ({
    key,
    ownerkind: ownerid != null ? "block" : "arc",
    ownerid,
    label: key,
    killable: false,
    cpu: 0,
    mem,
    rows: [],
});

const snap = (supported: boolean, groups: ResMonGroup[] = []): ResMonSnapshotData => ({
    supported,
    ready: true,
    ts: 0,
    cpu: 0,
    mem: 0,
    totalmem: 0,
    busycpu: false,
    busymem: false,
    groups,
});

const consumers = (agents: { blockid: string; rambytes?: number }[]): CommandGetConsumersRtnData =>
    ({
        totalbytes: 0,
        availablebytes: 0,
        windowms: 0,
        swapusedbytes: 0,
        agents: agents.map((a) => ({ tabid: "t", tokensread: false, ...a })),
    }) as CommandGetConsumersRtnData;

describe("agentRamBytes", () => {
    it("reads the agent's group in the Resource Manager's snapshot", () => {
        const s = snap(true, [group("arc", "b1", 900 * MB), group("g1", "b1", 412 * MB), group("g2", "b2", 5 * MB)]);
        expect(agentRamBytes("b1", s, null)).toBe(412 * MB);
        expect(agentRamBytes("b2", s, null)).toBe(5 * MB);
    });

    it("prefers the snapshot over the Consumers reading where the Resource Manager runs", () => {
        const s = snap(true, [group("g1", "b1", 412 * MB)]);
        expect(agentRamBytes("b1", s, consumers([{ blockid: "b1", rambytes: 99 }]))).toBe(412 * MB);
    });

    it("has nothing for an agent the snapshot does not hold, or a figure it could not read", () => {
        const s = snap(true, [group("g1", "b1", -1)]);
        expect(agentRamBytes("b1", s, null)).toBeNull();
        expect(agentRamBytes("b9", s, null)).toBeNull();
        expect(agentRamBytes(undefined, s, null)).toBeNull();
        expect(agentRamBytes("", s, null)).toBeNull();
    });

    it("reads the Consumers reading where the Resource Manager does not run", () => {
        const c = consumers([{ blockid: "b1", rambytes: 300 * MB }, { blockid: "b2" }]);
        expect(agentRamBytes("b1", snap(false), c)).toBe(300 * MB);
        expect(agentRamBytes("b2", snap(false), c)).toBeNull();
        expect(agentRamBytes("b1", null, c)).toBe(300 * MB);
        expect(agentRamBytes("b1", snap(false), null)).toBeNull();
    });
});

describe("runRamBytes", () => {
    it("sums every tab of the run a reading names", () => {
        const s = snap(true, [
            group("g1", "lead", 1024 * MB),
            group("g2", "w1", 1024 * MB),
            group("g3", "w2", 512 * MB),
        ]);
        expect(runRamBytes(["lead", "w1", "w2"], s, null)).toBe(2560 * MB);
    });

    it("skips a tab no reading names, and has nothing when none is named", () => {
        const s = snap(true, [group("g1", "lead", 412 * MB), group("g2", "w1", -1)]);
        expect(runRamBytes(["lead", "w1", "w9"], s, null)).toBe(412 * MB);
        expect(runRamBytes(["w1", "w9"], s, null)).toBeNull();
        expect(runRamBytes([], s, null)).toBeNull();
    });

    it("sums the Consumers reading where the Resource Manager does not run", () => {
        const c = consumers([
            { blockid: "lead", rambytes: 300 * MB },
            { blockid: "w1", rambytes: 200 * MB },
        ]);
        expect(runRamBytes(["lead", "w1"], snap(false), c)).toBe(500 * MB);
    });
});

describe("needsConsumersPoll", () => {
    it("polls only with the field on and a snapshot that says the Resource Manager does not run", () => {
        expect(needsConsumersPoll(true, snap(false))).toBe(true);
        expect(needsConsumersPoll(true, snap(true))).toBe(false);
        expect(needsConsumersPoll(true, null)).toBe(false);
        expect(needsConsumersPoll(false, snap(false))).toBe(false);
    });
});
