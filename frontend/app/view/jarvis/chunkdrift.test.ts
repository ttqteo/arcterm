// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { describe, expect, it } from "vitest";
import { chunkDriftLine } from "./chunkdrift";

const base = "0123456789abcdef0123456789abcdef01234567";
const ts = new Date(2026, 10, 2, 9, 0).getTime();

describe("chunkDriftLine", () => {
    it("counts the commits since an open chunk was written", () => {
        const line = chunkDriftLine("pending", { known: true, base, behind: 23, basets: ts });
        expect(line?.text).toBe("Written 23 commits ago (Nov 2): check it still holds");
        expect(line?.title).toContain("012345678");
    });

    it("says one commit in the singular", () => {
        expect(chunkDriftLine("blocked", { known: true, base, behind: 1 })?.text).toBe(
            "Written 1 commit ago: check it still holds"
        );
    });

    it("draws nothing when there is nothing to check", () => {
        expect(chunkDriftLine("pending", { known: true, base, behind: 0 })).toBeNull(); // the code has not moved
        expect(chunkDriftLine("pending", { known: false, behind: 0 })).toBeNull(); // no base, or no checkout
        expect(chunkDriftLine("done", { known: true, base, behind: 9 })).toBeNull(); // settled
        expect(chunkDriftLine("skipped", { known: true, base, behind: 9 })).toBeNull();
        expect(chunkDriftLine("pending", null)).toBeNull(); // not read yet
    });
});
