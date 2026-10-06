// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { describe, expect, it, vi } from "vitest";

vi.mock("@/app/store/wshclientapi", () => ({ RpcApi: {} }));
vi.mock("@/app/store/wshrpcutil", () => ({ TabRpcClient: {} }));

import type { WorkerCapacity } from "../agents/workercapacity";
import { overCapacityEvent, overCapacitySpeech } from "./petcapacity";

const GIB = 1024 ** 3;

function cap(over: Partial<WorkerCapacity> = {}): WorkerCapacity {
    return {
        totalbytes: 8 * GIB,
        availablebytes: 1.2 * GIB,
        perworkerbytes: 1.5 * GIB,
        heavybytes: 3 * GIB,
        measured: true,
        liveworkers: 0,
        reservebytes: 0,
        moreworkers: 1,
        ...over,
    };
}

describe("overCapacitySpeech", () => {
    it("warns a new run that starts more workers than fit", () => {
        expect(overCapacitySpeech(cap(), { picked: 3, extra: 3, live: false })).toBe(
            "Starting 3 workers, but RAM fits ~1 more (1.2 GB free) — expect swapping."
        );
    });

    it("warns a live run raised past what fits, naming the new width", () => {
        expect(overCapacitySpeech(cap({ moreworkers: 0 }), { picked: 5, extra: 3, live: true })).toBe(
            "Raising to 5 workers, but RAM fits ~0 more (1.2 GB free) — expect swapping."
        );
    });

    it("says nothing when the pick fits, or without a reading", () => {
        expect(overCapacitySpeech(cap(), { picked: 1, extra: 1, live: false })).toBeNull();
        expect(overCapacitySpeech(null, { picked: 8, extra: 8, live: false })).toBeNull();
    });
});

describe("overCapacityEvent", () => {
    it("is a warning notice the creature says once", () => {
        expect(overCapacityEvent(cap(), { picked: 3, extra: 3, live: false }, 1_000)).toEqual({
            id: "ram-over:1000",
            at: 1_000,
            kind: "notify",
            level: "warn",
            text: "Starting 3 workers, but RAM fits ~1 more (1.2 GB free) — expect swapping.",
        });
    });

    it("is nothing when the pick fits", () => {
        expect(overCapacityEvent(cap(), { picked: 1, extra: 1, live: false }, 1_000)).toBeNull();
    });
});
