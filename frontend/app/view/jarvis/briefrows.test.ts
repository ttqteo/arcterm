// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { describe, expect, it } from "vitest";
import type { ActiveWorkRow, DeltaRow, QueueRow, RunRow } from "./briefingmodel";
import {
    behindGroups,
    filterLines,
    initiativeLine,
    initiativeProjects,
    keepsProject,
    keepsRunKind,
    lineOpenTarget,
    linkedUnder,
    nestInitiatives,
    projectName,
    queueLine,
    runKindLegs,
    runRowFace,
    sessionLine,
    sessionWindow,
    settleNesting,
    SHIPPED_EMPTY,
    SHIPPED_LABEL,
    sinceEmptyLine,
    sinceLabel,
    splitIdeas,
    type BriefLine,
} from "./briefrows";
import { buildEffortCard, type EffortCardModel } from "./effortmodel";

const MIN = 60_000;
const DAY = 24 * 60 * MIN;
const NOW = new Date(2026, 8, 15, 12, 0).getTime();

describe("queueLine", () => {
    const q: QueueRow = {
        key: "gate:1",
        kind: "dag gate",
        title: "Approve the plan",
        source: "waveterm",
        detail: "waveterm · #arc",
        ts: NOW - 5 * MIN,
        action: "Review",
        nav: { kind: "channel", channelId: "c1", runId: "r1" },
        tone: "asking",
        attrib: "Orchestrator · S4c",
        why: "2 of 4 done",
        cites: [],
        wireKind: "dag-gate",
        channelId: "c1",
        runId: "r1",
        taskId: "",
        retry: false,
    };

    it("reads kind, title, why, attribution and wait as one line that opens its target", () => {
        expect(queueLine(q, NOW)).toMatchObject({
            id: "waiting:gate:1",
            kind: "gate",
            kindTone: "asking",
            title: "Approve the plan",
            note: "2 of 4 done",
            why: "2 of 4 done",
            meta: "Orchestrator · S4c · waveterm · #arc",
            state: "",
            age: "5m",
            target: { queue: { kind: "channel", channelId: "c1", runId: "r1" } },
        });
    });

    it("stays static when it names nothing to open, and prints no wait it does not know", () => {
        const line = queueLine({ ...q, nav: null, ts: null, tone: "error" }, NOW);
        expect([line.target, line.age, line.kindTone]).toEqual([null, "", "error"]);
    });

    // amber only where an agent or a run waits on your answer, so the column sorts the rows at a glance
    it("tones the kind by who is held up: amber for an answer, red for stuck, grey for a reminder", () => {
        const tone = (wireKind: string, over: Partial<QueueRow> = {}) =>
            queueLine({ ...q, wireKind, ...over }, NOW).kindTone;
        expect(["dag-gate", "ask", "escalation", "plan-review"].map((k) => tone(k))).toEqual([
            "asking",
            "asking",
            "asking",
            "asking",
        ]);
        expect(["chunk-due", "radar-triage", "run-unverified"].map((k) => tone(k))).toEqual([
            "muted",
            "muted",
            "muted",
        ]);
        expect([
            tone("dag-blocked", { tone: "error" }),
            tone("chunk-blocked"),
            tone("blocker"),
            tone("run-land-held"),
        ]).toEqual(["error", "error", "error", "error"]);
    });
});

describe("initiativeLine", () => {
    const summary = (chunks: { label: string; status: string }[], over: Partial<EffortSummary> = {}) =>
        ({
            oref: "effort:e1",
            title: "SIEM",
            status: "active",
            done: chunks.filter((c) => c.status === "done").length,
            total: chunks.length,
            activechunk: chunks.find((c) => c.status !== "done" && c.status !== "skipped")?.label,
            updatedts: NOW,
            project: "cad",
            ticket: "SIEM-1707",
            chunks,
            ...over,
        }) as EffortSummary;

    it("shows progress, segments, the next chunk in full, and ticket and project; plain active says nothing", () => {
        const card = buildEffortCard(
            summary([
                { label: "A", status: "done" },
                { label: "S8 item #2 deep-dive - narration spec", status: "active" },
                { label: "C", status: "skipped" },
                { label: "D", status: "pending" },
            ])
        );
        expect(initiativeLine(card)).toMatchObject({
            id: "initiatives:effort:e1",
            title: "SIEM",
            note: "S8 item #2 deep-dive - narration spec",
            noteLabel: "Next",
            meta: "SIEM-1707 · cad",
            state: "",
            progress: { done: 1, total: 3, pct: 33 },
            segments: ["done", "active", "pending"],
            target: { oref: "effort:e1" },
        });
    });

    it("names the blocked chunk instead of the next one when something is blocked", () => {
        const card = buildEffortCard(
            summary([
                { label: "A", status: "active" },
                { label: "B needs the key", status: "blocked" },
            ])
        );
        expect(initiativeLine(card)).toMatchObject({ noteLabel: "Blocked on", note: "B needs the key" });
    });

    it("says done once every chunk is done", () => {
        const card = buildEffortCard(
            summary([
                { label: "A", status: "done" },
                { label: "B", status: "done" },
                { label: "C", status: "skipped" },
            ])
        );
        expect(initiativeLine(card)).toMatchObject({
            state: "done",
            stateTone: "ok",
            noteLabel: "Done",
            note: "all 2 chunks done",
        });
    });

    it("says deferred when all that is left to pick up is deferred", () => {
        const card = buildEffortCard(
            summary(
                [
                    { label: "A", status: "done" },
                    { label: "M1", status: "deferred" },
                ],
                { project: undefined, ticket: undefined }
            )
        );
        expect(initiativeLine(card)).toMatchObject({ state: "deferred", stateTone: "muted", meta: "no project" });
    });

    it("puts a blocked chunk ahead of everything else it could say", () => {
        const card = buildEffortCard(
            summary([
                { label: "A", status: "active" },
                { label: "B", status: "blocked" },
            ])
        );
        expect(initiativeLine(card)).toMatchObject({ state: "1 blocked", stateTone: "asking" });
    });

    it("reads an archived initiative as archived, faint, ahead of a blocked chunk", () => {
        const card = buildEffortCard(summary([{ label: "B", status: "blocked" }], { status: "archived" }));
        expect(initiativeLine(card)).toMatchObject({ state: "archived", stateTone: "faint" });
    });

    it("reads an initiative with no chunks as an idea: no progress, no 'active' state", () => {
        const line = initiativeLine(buildEffortCard(summary([], { chunks: undefined })));
        expect(line).toMatchObject({ idea: true, progress: null, state: "", meta: "SIEM-1707 · cad" });
        const paused = initiativeLine(buildEffortCard(summary([], { status: "paused" })));
        expect(paused).toMatchObject({ idea: true, state: "paused" });
    });

    it("says how many proposed chunks wait, on a tracker and on an idea, and nothing when none do", () => {
        const four = ["P1", "P2", "P3", "P4"].map((label) => ({ label, status: "proposed" }));
        // the server's summary counts and picks the next chunk over everything but the proposed ones
        const tracker = initiativeLine(
            buildEffortCard(summary([{ label: "A", status: "done" }, ...four], { total: 1, activechunk: undefined }))
        );
        expect(tracker).toMatchObject({ proposed: "4 proposed", progress: { done: 1, total: 1, pct: 100 } });
        expect(tracker.idea).toBeUndefined();
        // an idea whose only chunks are proposed stays an idea
        const idea = initiativeLine(buildEffortCard(summary(four, { total: 0, activechunk: undefined })));
        expect(idea).toMatchObject({ idea: true, progress: null, proposed: "4 proposed" });
        expect(initiativeLine(buildEffortCard(summary([{ label: "A", status: "pending" }]))).proposed).toBeUndefined();
        expect(initiativeLine(buildEffortCard(summary([]))).proposed).toBeUndefined();
    });

    it("keeps a plan of only skipped chunks a tracker, and an archived empty one archived", () => {
        expect(initiativeLine(buildEffortCard(summary([{ label: "A", status: "skipped" }]))).idea).toBeUndefined();
        expect(initiativeLine(buildEffortCard(summary([], { status: "archived" })))).toMatchObject({
            state: "archived",
        });
        expect(initiativeLine(buildEffortCard(summary([], { status: "archived" }))).idea).toBeUndefined();
    });
});

describe("splitIdeas", () => {
    const card = (oref: string, done: number, remaining: number) =>
        ({ oref, status: "active", done, remaining, skipped: 0 }) as EffortCardModel;

    it("separates trackers from ideas, each group in its own order", () => {
        const out = splitIdeas([card("i1", 0, 0), card("t1", 1, 2), card("i2", 0, 0), card("t2", 0, 3)]);
        expect(out.trackers.map((c) => c.oref)).toEqual(["t1", "t2"]);
        expect(out.ideas.map((c) => c.oref)).toEqual(["i1", "i2"]);
    });
});

describe("parent and child initiatives", () => {
    // oref "effort:<oid>"; a child names its parent by the bare oid, as the wire's parentoid does
    const card = (oid: string, over: Partial<EffortCardModel> = {}) =>
        ({
            oref: "effort:" + oid,
            title: oid.toUpperCase(),
            status: "active",
            done: 1,
            remaining: 2,
            skipped: 0,
            ...over,
        }) as EffortCardModel;
    const shape = (rows: { oref: string; depth: number }[]) => rows.map((r) => `${r.oref.slice(7)}:${r.depth}`);

    describe("nestInitiatives", () => {
        it("puts each child right after its parent, a grandchild one level deeper, parents keeping their order", () => {
            const out = nestInitiatives([
                card("c1", { parentoid: "p1" }),
                card("p2"),
                card("g1", { parentoid: "c1" }),
                card("p1"),
                card("c2", { parentoid: "p1" }),
                card("p3"),
            ]);
            // the parents are p2, p1, p3 as given; c1 and c2 (and c1's g1) move under p1 in their own order
            expect(shape(out)).toEqual(["p2:0", "p1:0", "c1:1", "g1:2", "c2:1", "p3:0"]);
        });

        it("counts a parent's direct children as subCount, and names the parent a child sits under", () => {
            const out = nestInitiatives([
                card("p1", { title: "Jarvis 2.0" }),
                card("c1", { parentoid: "p1" }),
                card("g1", { parentoid: "c1" }),
                card("c2", { parentoid: "p1" }),
            ]);
            const by = Object.fromEntries(out.map((r) => [r.oref.slice(7), r]));
            expect([by.p1.subCount, by.c1.subCount, by.g1.subCount, by.c2.subCount]).toEqual([2, 1, 0, 0]);
            expect(by.c1).toMatchObject({ parentOref: "effort:p1", parentTitle: "Jarvis 2.0" });
            expect(by.p1.parentOref).toBeUndefined();
        });

        it("treats a child whose parent is not in the list as top level", () => {
            // the parent is archived or filtered out of the list, or the oid no longer names an initiative at all
            const out = nestInitiatives([card("a"), card("c1", { parentoid: "gone" }), card("b")]);
            expect(shape(out)).toEqual(["a:0", "c1:0", "b:0"]);
            expect(out[1].subCount).toBe(0);
            expect(out[1].parentOref).toBeUndefined();
            expect(out[1].parentTitle).toBeUndefined();
        });

        it("keeps every row when the data holds a cycle or a self-link", () => {
            const out = nestInitiatives([
                card("a", { parentoid: "b" }),
                card("b", { parentoid: "a" }),
                card("s", { parentoid: "s" }),
                card("z"),
            ]);
            expect(out.map((r) => r.oref.slice(7)).sort()).toEqual(["a", "b", "s", "z"]);
            expect(out.filter((r) => r.depth === 0).length).toBeGreaterThan(0);
        });

        it("leaves the cards' own fields alone and an empty list empty", () => {
            expect(nestInitiatives([])).toEqual([]);
            const p = card("p1", { title: "P" });
            expect(nestInitiatives([p])[0]).toMatchObject({ oref: "effort:p1", title: "P", done: 1, depth: 0 });
        });
    });

    describe("linkedUnder", () => {
        it("splits the live cards under a parent into sub-initiatives and ideas, each in the given order", () => {
            const out = linkedUnder("effort:p1", [
                card("i1", { parentoid: "p1", done: 0, remaining: 0 }),
                card("c1", { parentoid: "p1" }),
                card("other", { parentoid: "p2" }),
                card("i2", { parentoid: "p1", done: 0, remaining: 0 }),
                card("c2", { parentoid: "p1" }),
                card("p1"),
            ]);
            expect(out.subs.map((c) => c.oref)).toEqual(["effort:c1", "effort:c2"]);
            expect(out.ideas.map((c) => c.oref)).toEqual(["effort:i1", "effort:i2"]);
        });

        it("leaves an archived child out", () => {
            const out = linkedUnder("effort:p1", [
                card("c1", { parentoid: "p1", status: "archived" }),
                card("c2", { parentoid: "p1", status: "archived", done: 0, remaining: 0 }),
            ]);
            expect(out).toEqual({ subs: [], ideas: [] });
        });

        it("finds nothing under an initiative nobody links to", () => {
            expect(linkedUnder("effort:p1", [card("c1", { parentoid: "p2" }), card("p1")])).toEqual({
                subs: [],
                ideas: [],
            });
        });
    });

    describe("settleNesting", () => {
        const line = (oref: string, depth: number, parentOref?: string) =>
            ({ id: "initiatives:" + oref, oref, depth, parentOref, target: { oref } }) as unknown as BriefLine;
        const depths = (lines: BriefLine[]) => lines.map((l) => l.depth ?? 0);

        it("keeps the depths of rows whose parent is still drawn", () => {
            const rows = [line("effort:p", 0), line("effort:c", 1, "effort:p"), line("effort:g", 2, "effort:c")];
            expect(depths(settleNesting(rows))).toEqual([0, 1, 2]);
        });

        it("lifts a child to top level when its parent left the list (a filter, a delete waiting out its undo)", () => {
            const rows = [line("effort:c", 1, "effort:p"), line("effort:g", 2, "effort:c")];
            // the child is now a root, so its own child sits one level under it
            expect(depths(settleNesting(rows))).toEqual([0, 1]);
        });

        it("returns the same rows when nothing is nested", () => {
            const rows = [line("effort:a", 0), line("effort:b", 0)];
            expect(settleNesting(rows)).toBe(rows);
        });
    });

    describe("initiativeLine on a nested card", () => {
        const base = buildEffortCard({
            oref: "effort:c1",
            title: "Brief redesign",
            status: "active",
            done: 1,
            total: 3,
            activechunk: "B",
            updatedts: NOW,
            project: "arcterm",
            chunks: [
                { label: "A", status: "done" },
                { label: "B", status: "pending" },
                { label: "C", status: "pending" },
            ],
        } as EffortSummary);

        it("reads '↳ Part of <parent>' on a child and carries its depth", () => {
            const line = initiativeLine({
                ...base,
                depth: 1,
                subCount: 0,
                parentOref: "effort:p1",
                parentTitle: "Jarvis 2.0",
            });
            expect(line).toMatchObject({ meta: "↳ Part of Jarvis 2.0", depth: 1, parentOref: "effort:p1" });
        });

        it("counts the sub-initiatives on a parent's meta line and carries subCount for the title's +N sub", () => {
            const line = initiativeLine({ ...base, depth: 0, subCount: 2 });
            expect(line).toMatchObject({ meta: "arcterm · 2 sub-initiatives", subCount: 2 });
            expect(initiativeLine({ ...base, depth: 0, subCount: 1 }).meta).toBe("arcterm · 1 sub-initiative");
        });

        it("says nothing extra on a card that is not nested", () => {
            const line = initiativeLine(base);
            expect(line.meta).toBe("arcterm");
            expect(line.depth).toBeUndefined();
            expect(line.subCount).toBeUndefined();
        });
    });
});

describe("sessionLine", () => {
    const run: ActiveWorkRow = {
        key: "run:run:r1",
        kind: "run",
        oref: "run:r1",
        name: "execute the plan",
        meta: "waveterm · executing",
        chip: { label: "executing", tone: "running" },
        ts: NOW - 10 * DAY,
    };

    it("folds a run silent past seven days, and dates it by its age", () => {
        expect(sessionLine(run, NOW)).toMatchObject({
            id: "sessions:run:run:r1",
            kind: "▶ run",
            title: "execute the plan",
            meta: "waveterm · executing",
            state: "10d",
            stale: true,
            target: { oref: "run:r1" },
            runOid: "r1",
        });
        expect(sessionLine({ ...run, ts: NOW - DAY }, NOW).stale).toBe(false);
    });

    it("never folds what needs eyes, and names its state instead of its age", () => {
        const agent: ActiveWorkRow = {
            key: "agent:t1",
            kind: "agent",
            oref: "agent:t1",
            name: "lead · SIEM status",
            meta: "claude · cad",
            chip: { label: "asking", tone: "asking" },
            ts: NOW - 20 * DAY,
        };
        expect(sessionLine(agent, NOW)).toMatchObject({
            kind: "! agent",
            kindTone: "asking",
            state: "asking",
            stateTone: "asking",
            stale: false,
            target: null,
            agentId: "t1",
        });
    });
});

describe("sessionWindow", () => {
    const runs = (n: number, ageMs: number, tag: string): RunRow[] =>
        Array.from({ length: n }, (_, i) => ({
            oref: `run:${tag}${i}`,
            oid: `${tag}${i}`,
            goal: `${tag} ${i}`,
            project: "waveterm",
            status: "executing",
            workerOrefs: [],
            mode: "quick",
            ts: NOW - ageMs - i * MIN,
        }));
    const legs = (activeRuns: RunRow[]) => ({ activeRuns, directAgents: [] });

    // capped first, a window of week-quiet runs showed nothing but the fold, and its "+N more" only fed the fold
    it("takes stale runs out before the cap, so the live ones still show", () => {
        const w = sessionWindow(legs([...runs(9, 10 * DAY, "old"), ...runs(2, 30 * MIN, "live")]), false, NOW);
        expect(w.rows.filter((r) => !sessionLine(r, NOW).stale).map((r) => r.name)).toEqual(["live 0", "live 1"]);
        expect(w.rows.filter((r) => sessionLine(r, NOW).stale)).toHaveLength(9);
        expect(w.more).toBe(0);
    });

    it("caps the live rows per kind and counts what the cap hid", () => {
        const closed = sessionWindow(legs(runs(10, 30 * MIN, "live")), false, NOW);
        expect(closed.rows).toHaveLength(8);
        expect(closed.more).toBe(2);
        const open = sessionWindow(legs(runs(10, 30 * MIN, "live")), true, NOW);
        expect(open.rows).toHaveLength(10);
        expect(open.more).toBe(0);
    });
});

describe("behindGroups", () => {
    const delta = (over: Partial<DeltaRow>): DeltaRow => ({
        key: "k",
        ts: NOW,
        kind: "effort-note",
        title: "SIEM",
        wording: "effort-note",
        detail: "A · note",
        oref: "effort:e1",
        ...over,
    });

    it("folds an initiative's events into one digest that leads with its newest note", () => {
        const groups = behindGroups(
            [
                {
                    label: "Today",
                    rows: [
                        delta({ key: "1", ts: NOW - MIN, kind: "chunk-added", detail: "B · " }),
                        delta({ key: "2", ts: NOW - 2 * MIN, detail: "A · Shipped the fold. Then more." }),
                        delta({
                            key: "3",
                            ts: NOW - 3 * MIN,
                            kind: "run-done",
                            title: "execute plan",
                            wording: "Run completed",
                            detail: "summary",
                            oref: "run:r1",
                        }),
                        delta({ key: "4", ts: NOW - 4 * MIN, kind: "chunk-done", detail: "A · plan written" }),
                    ],
                },
            ],
            [],
            NOW
        );
        expect(groups.map((g) => g.label)).toEqual(["Today"]);
        expect(groups[0].lines.map((l) => [l.id, l.kind, l.title, l.note, l.detail, l.state])).toEqual([
            [
                "behind:effort:Today:effort:e1",
                "Initiative",
                "SIEM",
                "Shipped the fold.",
                "2 notes · 1 chunk done · 1 chunk added",
                "1m",
            ],
            ["behind:3", "Run completed", "execute plan", "", "summary", "3m"],
        ]);
        expect(groups[0].lines[0].target).toEqual({ oref: "effort:e1" });
        expect(groups[0].lines.map((l) => [l.group, l.kindTone])).toEqual([
            ["delta", "muted"],
            ["delta", "ok"],
        ]);
    });

    it("keeps a record's event in the kind column and its status in the detail", () => {
        const [group] = behindGroups(
            [
                {
                    label: "Today",
                    rows: [
                        delta({
                            key: "d",
                            kind: "dossier",
                            title: "Clear the gate",
                            wording: "Record updated · current status: blocked",
                            detail: "status: blocked",
                            oref: "task:d1",
                        }),
                    ],
                },
            ],
            [],
            NOW
        );
        expect(group.lines[0]).toMatchObject({
            kind: "Record updated",
            kindTone: "asking",
            detail: "current status: blocked",
        });
    });

    it("says what an initiative did when it wrote no note", () => {
        const [group] = behindGroups(
            [
                {
                    label: "Yesterday",
                    rows: [
                        delta({ key: "1", kind: "effort-status", detail: "paused" }),
                        delta({ key: "2", kind: "effort-created", detail: "3 chunks" }),
                    ],
                },
            ],
            [],
            NOW
        );
        expect([group.lines[0].note, group.lines[0].detail]).toEqual(["", "created · marked paused"]);
    });

    it("keeps shipped runs as their own group", () => {
        const groups = behindGroups(
            [],
            [
                {
                    oref: "run:r2",
                    goal: "ship it",
                    project: "waveterm",
                    summary: "Shipped the fold. Then more.",
                    completedTs: NOW - 2 * 60 * MIN,
                    fresh: true,
                    hasReport: true,
                    effortOid: "",
                    chunkLabel: "",
                    mode: "orchestrator",
                },
            ],
            NOW
        );
        expect(groups).toHaveLength(1);
        // the Brief tells this group from the delta groups by this label, so the test names the constant
        expect(groups[0].label).toBe(SHIPPED_LABEL);
        expect(groups[0].lines[0]).toMatchObject({
            id: "behind:shipped:run:r2",
            kind: "Shipped",
            kindTone: "ok",
            title: "ship it",
            meta: "",
            detail: "waveterm · Shipped the fold.",
            state: "2h",
            target: { oref: "run:r2" },
            hasReport: true,
            fresh: true,
            group: "shipped",
        });
    });
});

describe("filterLines", () => {
    const line = (id: string, over: Partial<BriefLine>): BriefLine => ({
        id,
        kind: "",
        kindTone: "muted",
        title: "",
        note: "",
        meta: "",
        state: "",
        stateTone: "muted",
        progress: null,
        target: null,
        why: "",
        age: "",
        detail: "",
        ...over,
    });

    it("matches any column the line shows, ignoring case", () => {
        const lines = [line("a", { title: "SIEM", meta: "cad" }), line("b", { title: "Radar", note: "trust fixes" })];
        expect(filterLines(lines, "TRUST").map((l) => l.id)).toEqual(["b"]);
        expect(filterLines(lines, "cad").map((l) => l.id)).toEqual(["a"]);
        expect(filterLines(lines, "  ").map((l) => l.id)).toEqual(["a", "b"]);
        expect(filterLines([line("c", { detail: "waveterm · shipped" })], "waveterm").map((l) => l.id)).toEqual(["c"]);
    });
});

describe("design row helpers", () => {
    it("names a project by its registry key, else the path's last segment", () => {
        expect(projectName("C:/x/waveterm", { waveterm: { path: "C:/x/waveterm" } } as never)).toBe("waveterm");
        expect(projectName("C:\\x\\orch-demo", {} as never)).toBe("orch-demo");
        expect(projectName("", {} as never)).toBe("");
    });
    it("says since when the delta runs", () => {
        const now = new Date(2026, 8, 23, 10, 0).getTime();
        expect(sinceLabel(new Date(2026, 8, 22, 18, 40).getTime(), now, false)).toBe("since yesterday 18:40");
        expect(sinceLabel(new Date(2026, 8, 23, 9, 5).getTime(), now, false)).toBe("since today 09:05");
        expect(sinceLabel(new Date(2026, 8, 12, 9, 5).getTime(), now, false)).toBe("since Sep 12");
        expect(sinceLabel(0, now, true)).toBe("the last 7 days");
    });
});

describe("runRowFace", () => {
    const line = { id: "sessions:run:r1", title: "N1 box upgrade", age: "2h", runOid: "r1" } as BriefLine;
    const run = {
        id: "r1",
        mode: "orchestrator",
        status: "executing",
        runtime: "claude",
        createdts: 0,
        effortref: { effortoid: "e1", chunklabel: "N1 box upgrade" },
    } as unknown as Run;
    const effort = {
        oref: "effort:e1",
        title: "Scenario gate clearance",
        chunkStages: { "N1 box upgrade": "Phase 2 · upgrade" },
    };
    it("reads an orchestrator run as the design does", () => {
        const f = runRowFace({ line, run, asking: false, project: "arc-infra", effort });
        expect(f).toMatchObject({
            type: "orchestrator",
            meta: "lead · arc-infra",
            elapsed: "2h",
            state: "working",
            stateTone: "ok",
            dot: "live",
            canStop: true,
            chunkLabel: "Scenario gate clearance · Phase 2 · upgrade",
        });
    });
    it("an asking quick run shows asking and can be answered", () => {
        const f = runRowFace({
            line,
            run: { ...run, mode: "", runtime: "claude" } as Run,
            asking: true,
            project: "arc-infra",
        });
        expect(f).toMatchObject({
            type: "quick run",
            meta: "claude · arc-infra",
            state: "asking",
            stateTone: "asking",
            dot: "asking",
            chunkLabel: "",
        });
    });
    it("a direct agent has no Stop", () => {
        const f = runRowFace({
            line: { ...line, runOid: undefined, agentId: "a1", meta: "claude · waveterm", state: "working" },
            asking: false,
            project: "",
        });
        expect(f).toMatchObject({ type: "agent", meta: "claude · waveterm", canStop: false, state: "running" });
    });
    it("takes a run-less row's tone from its own state, so blocked is never green", () => {
        const blocked = { ...line, state: "blocked", stateTone: "asking", meta: "waveterm" } as BriefLine;
        expect(runRowFace({ line: blocked, asking: false, project: "waveterm" })).toMatchObject({
            type: "agent",
            state: "blocked",
            stateTone: "asking",
            dot: "asking",
        });
    });
    it("a cancelled run reads stopped, faint, and cannot be stopped again", () => {
        const f = runRowFace({ line, run: { ...run, status: "cancelled" } as Run, asking: false, project: "p" });
        expect(f).toMatchObject({ state: "stopped", stateTone: "faint", dot: "idle", canStop: false, stopped: true });
    });
    it("reads a run's final stage in blue, from the dag the lineage holds", () => {
        const dag = { status: "finalizing", tasks: [] } as unknown as TaskGroup;
        const f = runRowFace({ line, run, dag, asking: false, project: "p" });
        expect(f).toMatchObject({ state: "final check", stateTone: "running", dot: "live", canStop: true });
    });
    it("reads a done run whose land is held as waiting on you, not done", () => {
        const held = { ...run, status: "done", land: { state: "held", reason: "staged changes" } } as unknown as Run;
        const f = runRowFace({ line, run: held, asking: false, project: "p" });
        expect(f).toMatchObject({ state: "land held", stateTone: "asking", dot: "asking", canStop: false });
    });
    it("reads a landed run as done and a done run still landing as live", () => {
        const done = { ...run, status: "done" } as Run;
        const landed = { ...done, land: { state: "landed" } } as unknown as Run;
        const landing = { ...done, land: { state: "pending" } } as unknown as Run;
        expect(runRowFace({ line, run: landed, asking: false, project: "p" })).toMatchObject({
            state: "landed",
            stateTone: "ok",
            dot: "done",
        });
        expect(runRowFace({ line, run: landing, asking: false, project: "p" })).toMatchObject({
            state: "landing",
            stateTone: "running",
            dot: "live",
        });
    });
    it("keeps the word blocked for a run whose worker died", () => {
        const f = runRowFace({ line, run: { ...run, status: "blocked" } as Run, asking: false, project: "p" });
        expect(f).toMatchObject({ state: "blocked", stateTone: "asking", dot: "asking" });
    });
});

describe("sessionLine age", () => {
    it("carries the row's age for the Runs meta line", () => {
        const now = 10 * DAY;
        const row = {
            kind: "run",
            key: "run:r1",
            oref: "run:r1",
            name: "x",
            meta: "",
            ts: now - 2 * 60 * MIN,
        } as ActiveWorkRow;
        expect(sessionLine(row, now).age).toBe("2h");
    });
});

describe("the Runs kind filter", () => {
    const row = (oid: string, mode: string): RunRow => ({
        oref: "run:" + oid,
        oid,
        goal: oid,
        project: "waveterm",
        status: "executing",
        workerOrefs: [],
        mode,
        ts: NOW,
    });
    const agent = {
        oref: "agent:a1",
        id: "a1",
        name: "a1",
        task: "t",
        runtime: "claude",
        project: null,
        state: "working" as const,
        startedTs: NOW,
    };
    const legs = {
        activeRuns: [row("lead", "orchestrator"), row("q", "quick"), row("legacy", "pipeline"), row("old", "")],
        directAgents: [agent],
    };

    it("keeps everything on all", () => {
        expect(runKindLegs(legs, "all")).toBe(legs);
    });

    it("keeps only orchestrator runs, and no direct agent", () => {
        const got = runKindLegs(legs, "orchestrator");
        expect(got.activeRuns.map((r) => r.oid)).toEqual(["lead"]);
        expect(got.directAgents).toEqual([]);
    });

    it("reads every other mode as a quick run", () => {
        const got = runKindLegs(legs, "quick");
        expect(got.activeRuns.map((r) => r.oid)).toEqual(["q", "legacy", "old"]);
        expect(got.directAgents).toEqual([]);
    });

    it("filters a shipped run by its mode the same way", () => {
        expect(keepsRunKind("orchestrator", "orchestrator")).toBe(true);
        expect(keepsRunKind("orchestrator", "quick")).toBe(false);
        expect(keepsRunKind("quick", "orchestrator")).toBe(false);
        expect(keepsRunKind("all", "quick")).toBe(true);
    });
});

describe("lineOpenTarget", () => {
    it("is the target a row's click opens: a queue channel, a queue address, or the row's own address", () => {
        expect(lineOpenTarget({ queue: { kind: "channel", channelId: "c1", runId: "r1" } })).toEqual({
            kind: "channel",
            channelId: "c1",
            runId: "r1",
        });
        expect(lineOpenTarget({ queue: { kind: "channel", channelId: "c1", runId: null } })).toEqual({
            kind: "channel",
            channelId: "c1",
            runId: undefined,
        });
        expect(lineOpenTarget({ queue: { kind: "oref", oref: "run:r2" } })).toEqual({ kind: "run", runId: "r2" });
        expect(lineOpenTarget({ oref: "effort:e1" })).toEqual({ kind: "effort", effortId: "e1" });
    });

    it("is null for a row with no target or an address the router cannot open", () => {
        expect(lineOpenTarget(null)).toBeNull();
        expect(lineOpenTarget({ oref: "" })).toBeNull();
        expect(lineOpenTarget({ oref: "nonsense:x" })).toBeNull();
    });
});

describe("sinceEmptyLine", () => {
    it("never says 'since you last looked' on a first visit, where there was no last look", () => {
        expect(sinceEmptyLine(true)).toBe("Runs that land show up here.");
        expect(sinceEmptyLine(false)).toBe("Nothing new since you last looked.");
    });
});

describe("SHIPPED_EMPTY", () => {
    it("says the window it looked at", () => {
        expect(SHIPPED_EMPTY).toBe("Nothing shipped in the last seven days.");
    });
});

describe("initiativeProjects", () => {
    it("names each project once, alphabetically, with the no-project bucket last", () => {
        expect(
            initiativeProjects([
                { project: "waveterm" },
                {},
                { project: "opal" },
                { project: "waveterm" },
                { project: "" },
            ])
        ).toEqual(["opal", "waveterm", ""]);
    });

    it("is empty when there are no initiatives", () => {
        expect(initiativeProjects([])).toEqual([]);
    });
});

describe("keepsProject", () => {
    it("keeps every initiative under all, and only the picked project's otherwise", () => {
        expect(keepsProject(null, "opal")).toBe(true);
        expect(keepsProject(null, undefined)).toBe(true);
        expect(keepsProject("opal", "opal")).toBe(true);
        expect(keepsProject("opal", "waveterm")).toBe(false);
        expect(keepsProject("opal", undefined)).toBe(false);
    });

    it("picks the initiatives without a project with the empty name", () => {
        expect(keepsProject("", undefined)).toBe(true);
        expect(keepsProject("", "")).toBe(true);
        expect(keepsProject("", "opal")).toBe(false);
    });
});
