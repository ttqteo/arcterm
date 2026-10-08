// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { describe, expect, it } from "vitest";
import {
    capacityChipLabel,
    capacityTitle,
    capacityWarnTitle,
    extraWorkers,
    formatGB,
    lowRam,
    newAgentRamWarning,
    overCapacity,
    type WorkerCapacity,
} from "./workercapacity";

const GIB = 1024 ** 3;

function cap(over: Partial<WorkerCapacity> = {}): WorkerCapacity {
    return {
        totalbytes: 8 * GIB,
        availablebytes: 1.3 * GIB,
        perworkerbytes: 1.5 * GIB,
        heavybytes: 3 * GIB,
        measured: true,
        liveworkers: 2,
        reservebytes: 0,
        moreworkers: 1,
        ...over,
    };
}

describe("formatGB", () => {
    it("shows one decimal and drops a trailing .0", () => {
        expect(formatGB(1.3 * GIB)).toBe("1.3 GB");
        expect(formatGB(8 * GIB)).toBe("8 GB");
        expect(formatGB(0)).toBe("0 GB");
    });
});

describe("extraWorkers", () => {
    it("is the launcher's whole width", () => {
        expect(extraWorkers(3)).toBe(3);
    });
    it("is nothing while the launcher's width is unset", () => {
        expect(extraWorkers(null)).toBe(0);
    });
    it("is the width above the tasks already running on a live run", () => {
        expect(extraWorkers(5, 2)).toBe(3);
    });
    it("is nothing when a live run's width is at or below its running tasks", () => {
        expect(extraWorkers(2, 2)).toBe(0);
        expect(extraWorkers(1, 3)).toBe(0);
    });
});

describe("overCapacity", () => {
    it("is over only past moreworkers", () => {
        expect(overCapacity(cap({ moreworkers: 1 }), 1)).toBe(false);
        expect(overCapacity(cap({ moreworkers: 1 }), 2)).toBe(true);
        expect(overCapacity(cap({ moreworkers: 0 }), 0)).toBe(false);
    });
    it("is never over without a reading", () => {
        expect(overCapacity(null, 8)).toBe(false);
    });
});

describe("capacityChipLabel", () => {
    it("says the free RAM", () => {
        expect(capacityChipLabel(cap())).toBe("1.3 GB free");
        expect(capacityChipLabel(cap({ availablebytes: GIB, moreworkers: 0 }))).toBe("1 GB free");
    });
});

describe("lowRam", () => {
    it("is low only below memgate's 512 MB headroom, however many workers fit", () => {
        expect(lowRam(cap({ availablebytes: 1.7 * GIB, moreworkers: 0 }))).toBe(false);
        expect(lowRam(cap({ availablebytes: 512 * 1024 ** 2, moreworkers: 0 }))).toBe(false);
        expect(lowRam(cap({ availablebytes: 0.4 * GIB, moreworkers: 0 }))).toBe(true);
    });
});

describe("tooltips", () => {
    it("the chip's title says one fact per line", () => {
        expect(capacityTitle(cap())).toBe(
            "1.3 GB free of 8 GB\n~1.5 GB per worker, ~3 GB for a heavy job (measured)\n2 running · ~1 more fits"
        );
        expect(capacityTitle(cap({ measured: false }))).toContain("(default)");
        expect(capacityTitle(cap({ moreworkers: 0 }))).toContain("~0 more fit");
    });
    it("the stepper warning says how many fit", () => {
        expect(capacityWarnTitle(cap({ moreworkers: 1 }))).toBe("~1 more fits in RAM (1.3 GB free)");
        expect(capacityWarnTitle(cap({ moreworkers: 0 }))).toBe("~0 more fit in RAM (1.3 GB free)");
    });
});

describe("newAgentRamWarning", () => {
    it("is nothing while one more fits", () => {
        expect(newAgentRamWarning(cap({ moreworkers: 1 }), "claude")).toBeNull();
    });
    it("warns with the numbers when not even one more fits", () => {
        expect(newAgentRamWarning(cap({ moreworkers: 0 }), "pi")).toBe(
            "1.3 GB free of 8 GB. Another agent (~1.5 GB) may make the machine lag."
        );
    });
    it("names a Quick run's worker as a worker", () => {
        expect(newAgentRamWarning(cap({ moreworkers: 0 }), "run", "worker")).toBe(
            "1.3 GB free of 8 GB. Another worker (~1.5 GB) may make the machine lag."
        );
    });
    it("never warns for a plain terminal", () => {
        expect(newAgentRamWarning(cap({ moreworkers: 0 }), "terminal")).toBeNull();
    });
    it("never warns without a reading", () => {
        expect(newAgentRamWarning(null, "claude")).toBeNull();
    });
});
