// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { describe, expect, it } from "vitest";
import { chunkDriftLine, staleByLabel, staleChip } from "./chunkdrift";

const base = "0123456789abcdef0123456789abcdef01234567";
const ts = new Date(2026, 10, 2, 9, 0).getTime();

describe("chunkDriftLine", () => {
    it("counts the commits since an open chunk was written", () => {
        const line = chunkDriftLine("pending", { known: true, base, behind: 23, basets: ts });
        expect(line?.text).toBe("Written 23 commits ago (Nov 2): check it still holds");
        expect(line?.title).toContain("Written against 012345678.");
        expect(line?.gone).toBe(false);
    });

    it("says one commit in the singular", () => {
        expect(chunkDriftLine("blocked", { known: true, base, behind: 1 })?.text).toBe(
            "Written 1 commit ago: check it still holds"
        );
    });

    it("says an older chunk's base is where it was added", () => {
        expect(chunkDriftLine("pending", { known: true, base, behind: 3, inferred: true })?.title).toContain(
            "Written around 012345678, when it was added."
        );
    });

    it("names a changed file in place of the count", () => {
        const line = chunkDriftLine("pending", {
            known: true,
            base,
            behind: 40,
            basets: ts,
            files: [
                { mention: "store.ts", path: "src/store.ts", changes: 4 },
                { mention: "a.go", path: "a.go", changes: 1 },
            ],
        });
        expect(line?.text).toBe(
            "store.ts changed 4 times (+1 more) since this was written (Nov 2): check it still holds"
        );
        expect(line?.title).toContain("store.ts changed 4 times\na.go changed once\n");
        expect(line?.gone).toBe(false);
    });

    it("asks to rewrite or skip a chunk whose file went away", () => {
        const line = chunkDriftLine("pending", {
            known: true,
            base,
            behind: 2,
            files: [{ mention: "old.ts", path: "src/old.ts", changes: 1, gone: true, renamedto: "src/new.ts" }],
        });
        expect(line?.text).toBe("old.ts moved to src/new.ts since this was written: rewrite or skip it");
        expect(line?.gone).toBe(true);
    });

    it("draws nothing when there is nothing to check", () => {
        expect(chunkDriftLine("pending", { known: true, base, behind: 0 })).toBeNull(); // the code has not moved
        expect(chunkDriftLine("pending", { known: false, behind: 0 })).toBeNull(); // no base, or no checkout
        expect(chunkDriftLine("done", { known: true, base, behind: 9 })).toBeNull(); // settled
        expect(chunkDriftLine("skipped", { known: true, base, behind: 9 })).toBeNull();
        expect(chunkDriftLine("pending", null)).toBeNull(); // not read yet
    });
});

describe("staleChip", () => {
    const stale = (files: EffortStaleFile[]): EffortChunkStale => ({ chunk: "c", index: 1, landed: 5, files });

    it("reads changed since, or file gone when any file went away", () => {
        const changed = staleChip("pending", stale([{ mention: "x.ts", path: "x.ts", changes: 2 }]));
        expect(changed).toMatchObject({ text: "changed since", gone: false });
        expect(changed?.title).toBe(
            "x.ts changed 2 times\nsince this chunk was written (5 commits landed). Open it to check it still holds."
        );
        expect(
            staleChip(
                "blocked",
                stale([
                    { mention: "x.ts", path: "x.ts", changes: 2 },
                    { mention: "y.md", path: "y.md", changes: 1, gone: true },
                ])
            )
        ).toMatchObject({ text: "file gone", gone: true });
    });

    it("draws nothing for a settled or unflagged chunk", () => {
        expect(staleChip("done", stale([{ mention: "x.ts", path: "x.ts", changes: 2 }]))).toBeNull();
        expect(staleChip("pending", stale([]))).toBeNull();
        expect(staleChip("pending", undefined)).toBeNull();
    });
});

describe("staleByLabel", () => {
    it("indexes the flagged chunks by label", () => {
        const m = staleByLabel([
            { effortoid: "e", title: "T", chunks: [{ chunk: "a", index: 1, landed: 1, files: [] }] },
        ]);
        expect([...m.keys()]).toEqual(["a"]);
        expect(staleByLabel(null).size).toBe(0);
    });
});
