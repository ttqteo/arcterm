// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { describe, expect, it } from "vitest";
import { NO_PANES, nextPaneMounts, type PaneMounts } from "./panemounts";

// one render after another, as the surface sees them
function run(...renders: { live: string[]; shown?: string[]; seeded: boolean }[]): PaneMounts {
    return renders.reduce((prev, r) => nextPaneMounts(prev, { shown: [], ...r }), NO_PANES);
}
const mounted = (m: PaneMounts) => [...m.mounted].sort();

describe("nextPaneMounts", () => {
    it("does not mount the panes the app loads with until they show", () => {
        const m = run(
            { live: ["a1"], seeded: false },
            { live: ["a1", "a2", "t1", "t2"], seeded: false },
            { live: ["a1", "a2", "t1", "t2"], shown: ["a1"], seeded: true }
        );
        expect(mounted(m)).toEqual(["a1"]);
    });

    it("mounts a pane the first time it shows and keeps it once hidden", () => {
        const m = run(
            { live: ["a1", "t1"], shown: ["a1"], seeded: true },
            { live: ["a1", "t1"], shown: ["a1", "t1"], seeded: true },
            { live: ["a1", "t1"], shown: ["a1"], seeded: true }
        );
        expect(mounted(m)).toEqual(["a1", "t1"]);
    });

    it("mounts a pane that opens after the first load at once, shown or not", () => {
        const m = run(
            { live: ["a1"], shown: ["a1"], seeded: true },
            { live: ["a1", "t9"], shown: ["a1"], seeded: true }
        );
        expect(mounted(m)).toEqual(["a1", "t9"]);
    });

    it("counts what the surface first sees as loaded with the app, even when the roster was seeded before it", () => {
        const m = run({ live: ["a1", "a2", "t1"], shown: ["a1"], seeded: true });
        expect(mounted(m)).toEqual(["a1"]);
    });

    it("drops a pane whose terminal closed, and mounts it again if it comes back", () => {
        const closed = run(
            { live: ["a1", "t1"], shown: ["a1", "t1"], seeded: true },
            { live: ["a1"], shown: ["a1"], seeded: true }
        );
        expect(mounted(closed)).toEqual(["a1"]);
        expect(mounted(nextPaneMounts(closed, { live: ["a1", "t1"], shown: ["a1"], seeded: true }))).toEqual([
            "a1",
            "t1",
        ]);
    });

    it("ignores a shown id with no pane to mount", () => {
        const m = run({ live: ["a1"], shown: ["a1", "launching"], seeded: true });
        expect(mounted(m)).toEqual(["a1"]);
    });

    it("returns the same value when nothing changed, so the surface can store it without looping", () => {
        const prev = run({ live: ["a1", "t1"], shown: ["a1"], seeded: true });
        expect(nextPaneMounts(prev, { live: ["t1", "a1"], shown: ["a1"], seeded: true })).toBe(prev);
    });
});
