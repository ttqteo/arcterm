// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { describe, expect, it } from "vitest";
import { fmtBytes, fmtDuration, needsEvidenceSeal, verifCounts } from "./runcompletion";

describe("runcompletion derivations", () => {
    it("formats duration and bytes", () => {
        expect(fmtDuration(848000)).toBe("14m 08s");
        expect(fmtDuration(9000)).toBe("9s");
        expect(fmtBytes(214 * 1024)).toBe("214 KB");
    });
    it("counts verifications by result", () => {
        const counts = verifCounts([
            { cmd: "a", result: "pass" },
            { cmd: "b", result: "fail" },
            { cmd: "c", result: "pass" },
        ] as EvidenceVerif[]);
        expect(counts).toEqual({ pass: 2, fail: 1, unknown: 0 });
    });
    it("flags a done run without evidence for backfill", () => {
        expect(needsEvidenceSeal({ status: "done" } as Run)).toBe(true);
        expect(needsEvidenceSeal({ status: "done", evidence: {} } as unknown as Run)).toBe(false);
        expect(needsEvidenceSeal({ status: "executing" } as Run)).toBe(false);
    });
});
