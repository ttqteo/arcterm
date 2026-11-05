import { describe, expect, it } from "vitest";
import {
    activityCouncils,
    activityMeta,
    activityRunKind,
    buildActivity,
    EARLIER_CAP,
    keepsShipped,
    queuedCount,
    type ActivityCouncilInput,
    type ActivityFilter,
    type ActivityRunInput,
} from "./briefactivity";
import type { CouncilLine } from "./briefcouncils";
import type { BriefLine } from "./briefrows";

const MIN = 60 * 1000;
const DAY = 24 * 60 * MIN;
const NOW = 100 * DAY;

function line(id: string, over: Partial<BriefLine> = {}): BriefLine {
    return {
        id,
        kind: "▶ run",
        kindTone: "active",
        title: id,
        note: "",
        meta: "arcterm · executing",
        state: "executing",
        stateTone: "ok",
        progress: null,
        target: { oref: "run:" + id },
        why: "",
        age: "",
        detail: "",
        runOid: id,
        ...over,
    };
}

function run(id: string, over: Partial<ActivityRunInput> & { stale?: boolean } = {}): ActivityRunInput {
    const { stale, ...rest } = over;
    return {
        line: { ...line(id), stale: stale ?? false },
        mode: "quick",
        status: "executing",
        ts: NOW - 10 * MIN,
        ...rest,
    };
}

function council(id: string, state: string, ts: number): ActivityCouncilInput {
    const live = state === "running" || state === "awaiting-you" || state === "queued";
    const l: CouncilLine = {
        ...line("councils:" + id, { runOid: undefined, target: { oref: "council:" + id } }),
        kind: "council",
        title: "council " + id,
        meta: "arcterm · 3 experts",
        state,
        age: "1h",
        dot: live ? "live" : "done",
        live,
    };
    return { line: l, ts };
}

const build = (
    runs: ActivityRunInput[],
    councils: ActivityCouncilInput[],
    filter: ActivityFilter = "all",
    earlierOpen = false
) => buildActivity({ runs, councils, filter, earlierOpen, now: NOW });

describe("buildActivity", () => {
    it("merges live runs and live councils newest first, and ended ones into Earlier newest first", () => {
        const m = build(
            [
                run("r-old", { ts: NOW - 3 * 60 * MIN }),
                run("r-new", { ts: NOW - 5 * MIN }),
                run("r-failed", { status: "failed", ts: NOW - 2 * DAY }),
            ],
            [council("c-run", "running", NOW - 30 * MIN), council("c-done", "done", NOW - DAY)]
        );
        expect(m.live.map((i) => i.id)).toEqual(["r-new", "councils:c-run", "r-old"]);
        expect(m.earlier.map((i) => i.id)).toEqual(["councils:c-done", "r-failed"]);
        expect(activityMeta(m)).toBe("3 live");
    });

    it("draws an awaiting-you and a queued council as live cards, with their stage word", () => {
        const m = build([], [council("ask", "awaiting-you", NOW - MIN), council("q", "queued", NOW - 2 * MIN)]);
        expect(m.live.map((i) => [i.id, i.kind, i.stage])).toEqual([
            ["councils:ask", "council", "awaiting-you"],
            ["councils:q", "council", "queued"],
        ]);
        expect(m.earlier).toEqual([]);
    });

    it("puts failed and cancelled runs in Earlier and keeps the rest live; shipped runs are never an input", () => {
        const m = build(
            [run("f", { status: "failed" }), run("c", { status: "cancelled" }), run("live", { status: "blocked" })],
            []
        );
        expect(m.live.map((i) => i.id)).toEqual(["live"]);
        expect(m.earlier.map((i) => [i.id, i.stage, i.stageTone])).toEqual([
            ["f", "failed", "error"],
            ["c", "cancelled", "error"],
        ]);
    });

    it("cuts Earlier at seven days and folds week-quiet runs behind the older toggle", () => {
        const m = build(
            [
                run("f-recent", { status: "failed", ts: NOW - 6 * DAY }),
                run("f-old", { status: "failed", ts: NOW - 8 * DAY }),
                run("quiet", { stale: true, ts: NOW - 9 * DAY }),
            ],
            [council("c-recent", "done", NOW - 6 * DAY), council("c-old", "done", NOW - 8 * DAY)]
        );
        expect(m.earlier.map((i) => i.id)).toEqual(["f-recent", "councils:c-recent"]);
        expect(m.older.map((i) => i.id)).toEqual(["f-old", "quiet"]);
        expect(m.live).toEqual([]);
        // the tabs count live and Earlier, never the folded runs
        expect(m.counts.all).toBe(2);
    });

    it("windows Earlier at five with the rest behind +N more, and lifts the window when open", () => {
        const councils = Array.from({ length: 8 }, (_, i) => council("c" + i, "done", NOW - (i + 1) * 60 * MIN));
        const shut = build([], councils);
        expect(shut.earlier).toHaveLength(EARLIER_CAP);
        expect(shut.earlierMore).toBe(3);
        expect(shut.earlierAll).toHaveLength(8);
        const open = build([], councils, "all", true);
        expect(open.earlier).toHaveLength(8);
        expect(open.earlierMore).toBe(0);
    });

    it("filters by tab: orchestrator and quick keep runs of that kind, councils only councils", () => {
        const runs = [
            run("orch", { mode: "orchestrator" }),
            run("quick", { mode: "quick" }),
            run("agent", { mode: "", line: { ...line("agent", { runOid: undefined, target: null }), agentId: "a1" } }),
            run("orch-failed", { mode: "orchestrator", status: "failed" }),
        ];
        const councils = [council("live", "running", NOW - MIN), council("done", "done", NOW - DAY)];
        const ids = (f: ActivityFilter) => {
            const m = build(runs, councils, f);
            return [...m.live, ...m.earlier].map((i) => i.id).sort();
        };
        expect(ids("all")).toEqual(["agent", "councils:done", "councils:live", "orch", "orch-failed", "quick"]);
        expect(ids("orchestrator")).toEqual(["orch", "orch-failed"]);
        expect(ids("quick")).toEqual(["quick"]);
        expect(ids("councils")).toEqual(["councils:done", "councils:live"]);
        expect(build(runs, councils).counts).toEqual({ all: 6, orchestrator: 2, quick: 1, councils: 2 });
    });

    it("names a card's kind and builds its meta as runtime · project · age, from the run's face when given", () => {
        const m = build(
            [
                run("orch", {
                    mode: "orchestrator",
                    ts: NOW - 2 * 60 * MIN,
                    face: { stage: "final check", stageTone: "running", meta: "lead · arcterm" },
                }),
            ],
            []
        );
        const [card] = m.live;
        expect(card.kind).toBe("run · orchestrator");
        expect(card.chip).toBe("orchestrator");
        expect(card.stage).toBe("final check");
        expect(card.stageTone).toBe("running");
        expect(card.meta).toBe("lead · arcterm · 2h");
    });
});

describe("Shipped and the queue under the tab", () => {
    it("narrows Shipped by the tab, and under councils keeps no run", () => {
        expect(keepsShipped("all", "quick")).toBe(true);
        expect(keepsShipped("orchestrator", "quick")).toBe(false);
        expect(keepsShipped("orchestrator", "orchestrator")).toBe(true);
        expect(keepsShipped("quick", "")).toBe(true);
        expect(keepsShipped("councils", "orchestrator")).toBe(false);
        expect(activityRunKind("councils")).toBeNull();
    });

    it("counts the queued plans the tab keeps", () => {
        const modes = ["orchestrator", "quick", "orchestrator"];
        expect(queuedCount(modes, "all")).toBe(3);
        expect(queuedCount(modes, "orchestrator")).toBe(2);
        expect(queuedCount(modes, "quick")).toBe(1);
        expect(queuedCount(modes, "councils")).toBe(0);
    });
});

describe("activityCouncils", () => {
    it("pairs each council line with its council's last save", () => {
        const base = {
            project: "",
            feature: "",
            experts: [],
            round: 1,
            tokens: 0,
            calls: 0,
        };
        const out = activityCouncils(
            [
                { ...base, id: "a", feature: "A", state: "running", created: NOW - DAY, updated: NOW - MIN },
                { ...base, id: "b", feature: "B", state: "done", created: NOW - 2 * DAY, updated: 0 },
            ] as Council[],
            null,
            NOW
        );
        expect(out.map((c) => [c.line.id, c.ts])).toEqual([
            ["councils:a", NOW - MIN],
            ["councils:b", NOW - 2 * DAY],
        ]);
    });
});
