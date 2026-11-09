// layer 1 of the skim TL;DR bench over the committed cases: prints each criterion's pass rate and fails when one drops
// below the saved baseline (`node scripts/skim-bench.mjs --baseline`), or when the median line ratio rises more than 10
// points over it
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { type Baseline, type Case, problems, regressions, report, scoreAll, summarize } from "./bench-core";

const dir = dirname(fileURLToPath(import.meta.url));
const cases: Record<string, Case> = Object.fromEntries(
    readdirSync(join(dir, "cases"))
        .filter((name) => name.endsWith(".json"))
        .map((name) => [
            name.replace(/\.json$/, ""),
            JSON.parse(readFileSync(join(dir, "cases", name), "utf8")) as Case,
        ])
);
const baselinePath = join(dir, "baseline.json");
const baseline = existsSync(baselinePath) ? (JSON.parse(readFileSync(baselinePath, "utf8")) as Baseline) : null;

describe("skim bench cases", () => {
    it.each(Object.entries(cases))("%s can be scored", (_, c) => {
        expect(problems(c)).toEqual([]);
    });
});

describe("skim bench, layer 1", () => {
    it("is no lower than the baseline", () => {
        const scored = scoreAll(cases);
        const scores = Object.fromEntries(Object.entries(scored).map(([id, { score }]) => [id, score]));
        console.log(report(summarize(Object.values(scores))));
        if (baseline === null) {
            console.log("  no baseline saved: node scripts/skim-bench.mjs --baseline");
            return;
        }
        expect(regressions(scores, baseline)).toEqual([]);
    });
});
