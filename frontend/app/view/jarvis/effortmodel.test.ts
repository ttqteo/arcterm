import { describe, expect, it } from "vitest";
import {
    buildEffortCard,
    chunkTone,
    effortDeltaRow,
    effortFacts,
    groupChunksByStage,
    partitionEfforts,
    stageOptions,
} from "./effortmodel";

const base = {
    oref: "effort:abc",
    title: "Scenario gate clearance",
    status: "active",
    done: 2,
    total: 8,
    activechunk: "Phase 3",
    updatedts: 1000,
    chunks: [
        { label: "Phase 1", status: "done" },
        { label: "Phase 2", status: "done" },
        { label: "Phase 3", status: "active" },
        { label: "Phase 4", status: "deferred" },
        { label: "Phase 5", status: "blocked" },
        { label: "Phase 6", status: "skipped" },
        { label: "Phase 7", status: "pending" },
        { label: "Phase 8", status: "pending" },
    ],
} as EffortSummary;

describe("buildEffortCard", () => {
    it("carries the newest note, where the initiative was left", () => {
        const lastnote = { ts: 5, text: "merged to LOCAL DEV", session: "agent:t1" };
        expect(buildEffortCard({ ...base, lastnote }).lastnote).toEqual(lastnote);
        expect(buildEffortCard(base).lastnote).toBeUndefined();
    });

    it("projects tones and progress with the skip-shrinking denominator", () => {
        const m = buildEffortCard(base);
        expect(m.done).toBe(2);
        expect(m.remaining).toBe(5); // 8 - 2 done - 1 skipped
        expect(m.progressPct).toBe(29); // round(2/7)
        expect(m.countLine).toBe("2 of 7 · 1 skipped · active: Phase 3");
        expect(m.activeChunk).toBe("Phase 3");
        expect(m.chips.map((c) => c.tone)).toEqual([
            "done", "done", "active", "deferred", "blocked", "skipped", "pending", "pending",
        ]);
        expect(m.blockedChunks).toEqual(["Phase 5"]);
    });

    it("draws every chunk but the skipped ones as a bar segment, in plan order", () => {
        const m = buildEffortCard(base);
        expect(m.segments).toEqual(["done", "done", "active", "deferred", "blocked", "pending", "pending"]);
        const many = Array.from({ length: 30 }, (_, i) => ({ label: `c${i}`, status: "pending" }));
        expect(buildEffortCard({ ...base, total: 30, chunks: many } as EffortSummary).segments).toHaveLength(30);
    });

    it("marks the active chunk's segment even while its stored status is still pending", () => {
        const chunks = [
            { label: "a", status: "done" },
            { label: "b", status: "pending" },
            { label: "c", status: "pending" },
        ];
        const m = buildEffortCard({ ...base, total: 3, done: 1, activechunk: "b", chunks } as EffortSummary);
        expect(m.segments).toEqual(["done", "active", "pending"]);
    });

    it("caps chips at 12 with an overflow count", () => {
        const chunks = Array.from({ length: 15 }, (_, i) => ({ label: `c${i}`, status: "pending" }));
        const m = buildEffortCard({ ...base, total: 15, chunks } as EffortSummary);
        expect(m.chips).toHaveLength(12);
        expect(m.chipOverflow).toBe(3);
    });

    it("reads as complete when all non-skipped chunks are done", () => {
        const m = buildEffortCard({
            ...base, done: 7, total: 8, activechunk: undefined, chunks: base.chunks.map((c) =>
                c.status === "skipped" ? c : { ...c, status: "done" }),
        } as EffortSummary);
        expect(m.progressPct).toBe(100);
        expect(m.countLine).toBe("7 of 7 · 1 skipped");
    });

    it("handles all-skipped edge", () => {
        const m = buildEffortCard({
            ...base, done: 0, total: 2, chunks: [
                { label: "a", status: "skipped" }, { label: "b", status: "skipped" },
            ],
        } as EffortSummary);
        expect(m.progressPct).toBe(100);
        expect(m.countLine).toBe("all skipped");
    });

    it("omits the skipped suffix when nothing is skipped", () => {
        const m = buildEffortCard({
            ...base, chunks: base.chunks.filter((c) => c.status !== "skipped"), total: 7,
        } as EffortSummary);
        expect(m.countLine).toBe("2 of 7 · active: Phase 3");
    });
});

describe("chunkTone", () => {
    it("maps all six statuses and degrades unknown to pending", () => {
        expect(chunkTone("done")).toBe("done");
        expect(chunkTone("active")).toBe("active");
        expect(chunkTone("blocked")).toBe("blocked");
        expect(chunkTone("deferred")).toBe("deferred");
        expect(chunkTone("skipped")).toBe("skipped");
        expect(chunkTone("pending")).toBe("pending");
        expect(chunkTone("weird")).toBe("pending");
    });
});

describe("effortDeltaRow", () => {
    it("maps effort events to title + meta and ignores others", () => {
        const ev = { ts: 1, kind: "chunk-done", title: "Scenario gate clearance", detail: "Phase 3 · marked done", navtarget: "effort:abc" } as TimelineEvent;
        expect(effortDeltaRow(ev)).toEqual({ title: "Scenario gate clearance", meta: "Phase 3 · marked done" });
        expect(effortDeltaRow({ ts: 1, kind: "run-done", title: "x", detail: "y" } as TimelineEvent)).toBeNull();
    });
});

describe("partitionEfforts", () => {
    const of = (oref: string, status: string) => ({ ...base, oref, status }) as EffortSummary;

    it("splits archived out of the active list", () => {
        const p = partitionEfforts([of("effort:a", "active"), of("effort:b", "archived"), of("effort:c", "done")]);
        expect(p.active.map((e) => e.oref)).toEqual(["effort:a", "effort:c"]);
        expect(p.archived.map((e) => e.oref)).toEqual(["effort:b"]);
    });

    it("preserves the wire order within each group", () => {
        const p = partitionEfforts([
            of("effort:a", "archived"),
            of("effort:b", "active"),
            of("effort:c", "archived"),
            of("effort:d", "paused"),
        ]);
        expect(p.active.map((e) => e.oref)).toEqual(["effort:b", "effort:d"]);
        expect(p.archived.map((e) => e.oref)).toEqual(["effort:a", "effort:c"]);
    });

    it("returns an empty archived group when nothing is archived", () => {
        const p = partitionEfforts([of("effort:a", "active")]);
        expect(p.archived).toEqual([]);
        expect(p.active).toHaveLength(1);
    });

    it("projects each row through buildEffortCard", () => {
        const p = partitionEfforts([of("effort:a", "active")]);
        expect(p.active[0].countLine).toBe("2 of 7 · 1 skipped · active: Phase 3");
    });
});

describe("groupChunksByStage", () => {
    const row = (stage: string, status: string, label: string) => ({ stage, status, label });

    it("groups consecutive chunks that share a stage", () => {
        const groups = groupChunksByStage([
            row("Evidence pipeline", "done", "S1"),
            row("Evidence pipeline", "active", "S2"),
            row("S6 weak-signal rollout", "done", "S6-P0"),
            row("S6 weak-signal rollout", "pending", "S6-P1"),
        ]);
        expect(groups.map((g) => [g.stage, g.rows.length])).toEqual([
            ["Evidence pipeline", 2],
            ["S6 weak-signal rollout", 2],
        ]);
    });

    it("keeps unstaged chunks in their own unlabelled run", () => {
        const groups = groupChunksByStage([
            row("", "done", "a"),
            row("Rollout", "active", "b"),
            row("", "pending", "c"),
        ]);
        expect(groups.map((g) => g.stage)).toEqual(["", "Rollout", ""]);
    });

    // chunk order is the plan's order; a global group-by would silently reorder it.
    it("reprints a stage header rather than gathering scattered chunks", () => {
        const groups = groupChunksByStage([row("A", "done", "1"), row("B", "active", "2"), row("A", "pending", "3")]);
        expect(groups.map((g) => g.stage)).toEqual(["A", "B", "A"]);
        expect(groups.flatMap((g) => g.rows.map((r) => r.label))).toEqual(["1", "2", "3"]);
    });

    it("counts done over the non-skipped denominator", () => {
        const groups = groupChunksByStage([
            row("A", "done", "1"),
            row("A", "skipped", "2"),
            row("A", "pending", "3"),
            row("A", "blocked", "4"),
        ]);
        expect(groups[0].fraction).toBe("1/3");
    });

    it("reads an all-skipped stage as 0/0, never NaN", () => {
        expect(groupChunksByStage([row("A", "skipped", "1"), row("A", "skipped", "2")])[0].fraction).toBe("0/0");
    });

    it("returns no groups for no chunks", () => {
        expect(groupChunksByStage([])).toEqual([]);
    });
});

describe("stageOptions", () => {
    it("lists each stage once, in first-seen order", () => {
        expect(
            stageOptions([{ stage: "Rollout" }, { stage: "Evidence" }, { stage: "Rollout" }, { stage: "Keying" }])
        ).toEqual(["Rollout", "Evidence", "Keying"]);
    });

    it("omits unstaged chunks so the picker never offers a blank", () => {
        expect(stageOptions([{ stage: "" }, { stage: "Rollout" }, { stage: "" }])).toEqual(["Rollout"]);
    });

    it("has nothing to offer on an effort with no stages", () => {
        expect(stageOptions([{ stage: "" }, { stage: "" }])).toEqual([]);
    });
});

describe("effortFacts", () => {
    const chunk = (label: string, status: string, stage = "") => ({ label, status, stage, updatedts: 0 });
    const effort = (over: Partial<Effort>): Effort =>
        ({
            oid: "e1",
            otype: "effort",
            version: 1,
            meta: {},
            title: "SIEM",
            status: "active",
            createdts: 0,
            updatedts: 0,
            chunks: [],
            ...over,
        }) as Effort;

    it("states the project, the ticket and the parent as the meta line", () => {
        const all = [
            { oref: "effort:p1", title: "Part III", status: "active", done: 19, total: 34, updatedts: 0 },
        ] as EffortSummary[];
        const { meta } = effortFacts(effort({ project: "cad", ticket: "SIEM-1707", parentoid: "p1" }), all);
        expect(meta).toEqual([
            ["project", "cad"],
            ["ticket", "SIEM-1707"],
            ["parent", "Part III"],
        ]);
    });

    // the row's progress and the stage headers shrink the denominator by skips; the sheet must name the same total
    it("counts done over the chunks not skipped, and draws only the statuses present in bar order", () => {
        const f = effortFacts(
            effort({
                chunks: [
                    chunk("A", "pending"),
                    chunk("B", "done"),
                    chunk("C", "skipped"),
                    chunk("D", "deferred"),
                    chunk("E", "done"),
                    chunk("F", "active"),
                ],
            }),
            []
        );
        expect([f.done, f.counted, f.skipped]).toEqual([2, 5, 1]);
        expect(f.segments).toEqual([
            { tone: "done", n: 2 },
            { tone: "active", n: 1 },
            { tone: "pending", n: 1 },
            { tone: "deferred", n: 1 },
        ]);
    });

    it("names the next chunk with its stage and tone, a deferred one included", () => {
        const staged = effortFacts(
            effort({ chunks: [chunk("A", "done", "S1"), chunk("B", "active", "S2 engine")] }),
            []
        );
        expect(staged.next).toEqual({ label: "B", stage: "S2 engine", tone: "active" });
        expect(staged.idle).toBe("");
        expect(effortFacts(effort({ chunks: [chunk("A", "done"), chunk("M1", "deferred")] }), []).next).toEqual({
            label: "M1",
            stage: "",
            tone: "deferred",
        });
    });

    it("lists the children still in play with their progress, a paused one parked", () => {
        const all = [
            { oref: "effort:k1", title: "Scoring", status: "active", parentoid: "e1", done: 5, total: 8, updatedts: 0 },
            { oref: "effort:k2", title: "Old", status: "archived", parentoid: "e1", done: 1, total: 1, updatedts: 0 },
            { oref: "effort:k3", title: "Cards", status: "paused", parentoid: "e1", done: 7, total: 8, updatedts: 0 },
            { oref: "effort:x", title: "Other", status: "active", parentoid: "e9", done: 0, total: 1, updatedts: 0 },
        ] as EffortSummary[];
        expect(effortFacts(effort({}), all).children).toEqual([
            { oref: "effort:k1", title: "Scoring", status: "active", tone: "active", done: 5, total: 8 },
            { oref: "effort:k3", title: "Cards", status: "paused", tone: "deferred", done: 7, total: 8 },
        ]);
    });

    it("says when there is nothing left to pick up", () => {
        expect(effortFacts(effort({}), [])).toMatchObject({ next: null, idle: "No chunks yet." });
        expect(effortFacts(effort({ chunks: [chunk("A", "done"), chunk("B", "skipped")] }), [])).toMatchObject({
            next: null,
            idle: "No open chunk.",
        });
    });
});

describe("groupChunksByStage fractions", () => {
    const row = (stage: string, status: string) => ({ stage, status, label: stage + status + Math.random() });
    it("prints done/total with a slash, skips out of the denominator", () => {
        const [g] = groupChunksByStage([row("A", "done"), row("A", "pending"), row("A", "skipped")]);
        expect(g.fraction).toBe("1/2");
        expect([g.done, g.total]).toEqual([1, 2]);
    });
    it("an all-skipped stage is 0/0, never a word that wraps", () => {
        const [g] = groupChunksByStage([row("A", "skipped")]);
        expect(g.fraction).toBe("0/0");
    });
});
