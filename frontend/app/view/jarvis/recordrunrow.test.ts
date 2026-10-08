// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { describe, expect, it } from "vitest";
import { runRow } from "./recordrunrow";

const NOW = 1_700_000_000_000;
const HOUR = 3_600_000;

const run = (over: Partial<Run>): Run =>
    ({
        id: "a7c7c6cd-1111-2222-3333-444444444444",
        goal: "the goal",
        status: "done",
        createdts: NOW - 2 * HOUR,
        ...over,
    }) as unknown as Run;

const harnesses: HarnessInfo[] = [
    { runtime: "claude", label: "Claude Code", installed: true, consultcapable: true, runworkercapable: true, leadcapable: true },
    { runtime: "opencode", label: "OpenCode", installed: true, consultcapable: true, runworkercapable: true, leadcapable: false },
];

const evidence = (over: Partial<RunEvidence>): RunEvidence =>
    ({
        summary: "",
        files: [],
        addtotal: 0,
        deltotal: 0,
        durationms: 0,
        capturedts: NOW,
        hash: "",
        ...over,
    }) as unknown as RunEvidence;

describe("runRow", () => {
    it("prefers the run's own evidence summary over its goal", () => {
        const r = run({ evidence: evidence({ summary: "Moved the scope into an atom." }) });
        expect(runRow(r, "the goal", NOW, harnesses).headline).toBe("Moved the scope into an atom.");
    });

    it("drops the goal when it is the record's objective repeated", () => {
        expect(runRow(run({}), "the goal", NOW, harnesses).headline).toBeNull();
    });

    it("ignores incidental whitespace and case when comparing goal to objective", () => {
        expect(runRow(run({ goal: "  The   Goal " }), "the goal", NOW, harnesses).headline).toBeNull();
    });

    it("keeps the goal when it genuinely differs from the objective", () => {
        expect(runRow(run({ goal: "a different goal" }), "the goal", NOW, harnesses).headline).toBe("a different goal");
    });

    it("shortens the id to eight characters", () => {
        expect(runRow(run({}), "the goal", NOW, harnesses).shortId).toBe("a7c7c6cd");
    });

    it("reports age, duration and the change stat for a sealed run", () => {
        const r = run({
            evidence: evidence({
                summary: "s",
                durationms: 252_000,
                addtotal: 212,
                deltotal: 48,
                files: [{ path: "a", stat: "M", add: 1, del: 1 }] as unknown as RunEvidence["files"],
            }),
        });
        expect(runRow(r, "o", NOW, harnesses).meta).toEqual(["Claude · legacy", "2h ago", "4m 12s", "+212/−48 across 1 file"]);
    });

    it("pluralizes the file count", () => {
        const r = run({
            evidence: evidence({
                summary: "s",
                addtotal: 1,
                deltotal: 0,
                files: [{ path: "a" }, { path: "b" }] as unknown as RunEvidence["files"],
            }),
        });
        expect(runRow(r, "o", NOW, harnesses).meta).toContain("+1/−0 across 2 files");
    });

    it("omits every part it has no source for rather than defaulting it", () => {
        expect(runRow(run({ status: "running", evidence: undefined }), "o", NOW, harnesses).meta).toEqual([
            "Claude · legacy",
            "2h ago",
        ]);
    });

    it("omits the change stat when a sealed run touched no files", () => {
        const r = run({ evidence: evidence({ summary: "s", durationms: 1000 }) });
        expect(runRow(r, "o", NOW, harnesses).meta).toEqual(["Claude · legacy", "2h ago", "1s"]);
    });

    it("labels an explicit runtime and an unknown runtime from the catalog", () => {
        const explicit = run({ runtime: "opencode" });
        expect(runRow(explicit, "o", NOW, harnesses).meta[0]).toBe("OpenCode");
        const unknown = run({ runtime: "mystery" });
        expect(runRow(unknown, "o", NOW, harnesses).meta[0]).toBe("Unknown: mystery");
    });
});
