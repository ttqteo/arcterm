import { describe, expect, it } from "vitest";
import { councilLines, councilsMeta, isLiveCouncil } from "./briefcouncils";

const DAY = 24 * 60 * 60 * 1000;
const NOW = 100 * DAY;

function council(over: Partial<Council>): Council {
    return {
        id: "c1",
        project: "D:\\work\\arcterm",
        feature: "Pick a cache",
        experts: [
            { id: "e1", role: "Skeptic" } as unknown as CouncilExpert,
            { id: "e2", role: "Builder" } as unknown as CouncilExpert,
            { id: "co", role: "Coordinator", coordinator: true } as unknown as CouncilExpert,
        ],
        state: "done",
        round: 3,
        tokens: 0,
        calls: 0,
        created: NOW - DAY,
        updated: NOW - DAY,
        ...over,
    };
}

const PROJECTS = { arcterm: { path: "d:/work/arcterm" } };

describe("councilLines", () => {
    it("keeps live councils however old and drops ended ones past seven days", () => {
        const lines = councilLines(
            [
                council({ id: "old-done", updated: NOW - 8 * DAY }),
                council({ id: "old-running", state: "running", round: 1, updated: NOW - 30 * DAY }),
                council({ id: "fresh-done", updated: NOW - 6 * DAY }),
            ],
            PROJECTS,
            NOW
        );
        expect(lines.map((l) => l.id)).toEqual(["councils:old-running", "councils:fresh-done"]);
    });

    it("orders waiting on you, running, queued, then ended newest first", () => {
        const lines = councilLines(
            [
                council({ id: "done-old", updated: NOW - 3 * DAY }),
                council({ id: "queued", state: "queued" }),
                council({ id: "done-new", updated: NOW - DAY }),
                council({ id: "running", state: "running", round: 1 }),
                council({ id: "waiting", state: "awaiting-you" }),
            ],
            PROJECTS,
            NOW
        );
        expect(lines.map((l) => l.id.replace("councils:", ""))).toEqual([
            "waiting",
            "running",
            "queued",
            "done-new",
            "done-old",
        ]);
    });

    it("reads the project name, the panel size and the tree's state word", () => {
        const [line] = councilLines([council({ state: "awaiting-you", summary: undefined })], PROJECTS, NOW);
        expect(line.meta).toBe("arcterm · 2 experts");
        expect(line.state).toBe("Waiting on you");
        expect(line.stateTone).toBe("asking");
        expect(line.dot).toBe("asking");
        expect(line.target).toEqual({ oref: "council:c1" });
        expect(line.hasReport).toBe(false);
    });

    it("names an untitled council and marks a finished one's report", () => {
        const [line] = councilLines([council({ feature: "  ", summary: { at: 1 } as CouncilSummary })], PROJECTS, NOW);
        expect(line.title).toBe("(untitled council)");
        expect(line.state).toBe("Done");
        expect(line.dot).toBe("done");
        expect(line.hasReport).toBe(true);
    });

    it("reads a failed council in red", () => {
        const [line] = councilLines([council({ state: "failed" })], PROJECTS, NOW);
        expect(line.stateTone).toBe("error");
        expect(line.live).toBe(false);
    });

    it("is empty before the list loads", () => {
        expect(councilLines(null, PROJECTS, NOW)).toEqual([]);
    });

    it("leaves a closed council out", () => {
        const lines = councilLines(
            [council({ id: "closed", closed: NOW - DAY }), council({ id: "open" })],
            PROJECTS,
            NOW
        );
        expect(lines.map((l) => l.id)).toEqual(["councils:open"]);
    });
});

describe("councilsMeta", () => {
    it("counts the live ones, or names the window", () => {
        const lines = councilLines(
            [council({ id: "a", state: "running", round: 1 }), council({ id: "b" })],
            PROJECTS,
            NOW
        );
        expect(councilsMeta(lines)).toBe("1 live");
        expect(councilsMeta(lines.filter((l) => !l.live))).toBe("7 days");
    });
});

describe("isLiveCouncil", () => {
    it("is live while running, waiting or queued", () => {
        expect(["running", "awaiting-you", "queued"].every((state) => isLiveCouncil({ state }))).toBe(true);
        expect(["done", "failed", "stopped", "not-run"].some((state) => isLiveCouncil({ state }))).toBe(false);
    });
});
