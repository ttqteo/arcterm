import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { harnessCheck, missingCells, parseHarnessVersion, scoredRuns } from "./council-bench-all.mjs";

const NEW = "2026-11-12.1";
const OLD = "2026-11-06.1"; // round 1's harness

const plan = { cases: ["a", "b"], variants: ["council", "brainstorm"], runs: 2 };

// a run row of the results file
function row(caseId, variant, state, harness = NEW) {
    return { kind: "run", case: caseId, variant, state, harness };
}

describe("parseHarnessVersion", () => {
    it("reads the constant", () => {
        expect(parseHarnessVersion('package council\n\nconst HarnessVersion = "2026-11-12.1"\n')).toBe("2026-11-12.1");
    });

    it("refuses a source with no version, or one not in <date>.<n> form", () => {
        expect(() => parseHarnessVersion("package council\n")).toThrow(/HarnessVersion/);
        expect(() => parseHarnessVersion('const HarnessVersion = "v2"\n')).toThrow(/HarnessVersion/);
    });

    it("reads the real pkg/council/prompts.go", () => {
        const src = readFileSync(fileURLToPath(new URL("../pkg/council/prompts.go", import.meta.url)), "utf8");
        expect(parseHarnessVersion(src)).toMatch(/^\d{4}-\d{2}-\d{2}\.\d+$/);
    });
});

describe("scoredRuns", () => {
    it("keeps the done rows of this case, variant and harness", () => {
        const rows = [
            row("a", "council", "done"),
            row("a", "council", "done", OLD),
            row("a", "brainstorm", "done"),
            row("b", "council", "done"),
            row("a", "council", "failed"),
        ];
        expect(scoredRuns(rows, NEW, "a", "council")).toEqual([rows[0]]);
    });
});

describe("missingCells", () => {
    it("never fills a cell with a row of an older harness", () => {
        const rows = [row("a", "council", "done", OLD), row("a", "council", "done", OLD), row("a", "council", "done", OLD)];
        expect(missingCells(rows, plan, NEW)).toEqual([
            { case: "a", variant: "council", need: 2 },
            { case: "a", variant: "brainstorm", need: 2 },
            { case: "b", variant: "council", need: 2 },
            { case: "b", variant: "brainstorm", need: 2 },
        ]);
    });

    it("does not count a row that did not end done", () => {
        const rows = [row("a", "council", "failed"), row("a", "council", "stopped"), row("a", "brainstorm", "done"), row("a", "brainstorm", "failed")];
        const cells = missingCells(rows, plan, NEW);
        expect(cells).toContainEqual({ case: "a", variant: "council", need: 2 });
        expect(cells).toContainEqual({ case: "a", variant: "brainstorm", need: 1 });
    });

    it("closes a cell with two done rows, and leaves the others in plan order", () => {
        const rows = [row("a", "council", "done"), row("a", "council", "done"), row("b", "council", "done")];
        expect(missingCells(rows, plan, NEW)).toEqual([
            { case: "a", variant: "brainstorm", need: 2 },
            { case: "b", variant: "council", need: 1 },
            { case: "b", variant: "brainstorm", need: 2 },
        ]);
    });

    it("needs nothing once every cell is closed, extra rows included", () => {
        const rows = [];
        for (const c of plan.cases) for (const v of plan.variants) rows.push(row(c, v, "done"), row(c, v, "done"), row(c, v, "done"));
        expect(missingCells(rows, plan, NEW)).toEqual([]);
    });
});

describe("harnessCheck", () => {
    it("accepts the checkout's own version", () => {
        expect(harnessCheck(NEW, NEW)).toEqual({ ok: true, message: "" });
    });

    it("refuses an absent version: an older wavesrv answers without one", () => {
        for (const absent of [undefined, null, ""]) {
            const r = harnessCheck(absent, NEW);
            expect(r.ok).toBe(false);
            expect(r.message).toContain("install the new build first");
        }
    });

    it("refuses a different version and names both", () => {
        const r = harnessCheck(OLD, NEW);
        expect(r.ok).toBe(false);
        expect(r.message).toContain(OLD);
        expect(r.message).toContain(NEW);
        expect(r.message).toContain("install the new build first");
    });
});
