// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { describe, expect, it } from "vitest";
import { buildAttentionQueue, type ActiveWorkRow, type DeltaRow, type QueueRow, type RunRow } from "./briefingmodel";
import {
    filterAsMenu,
    filterLines,
    foldOpen,
    initiativeLine,
    initiativeProjects,
    keepsProject,
    keepsRunKind,
    lineOpenTarget,
    linkedUnder,
    nestInitiatives,
    plainSummary,
    projectCounts,
    projectName,
    queueLine,
    quietCount,
    RECORDS_SUMMARY_ID,
    runKindCounts,
    runKindLegs,
    runRowFace,
    sessionLine,
    sessionWindow,
    settleNesting,
    SHIPPED_EMPTY,
    shippedBriefLines,
    SINCE_CAP,
    sinceEmptyLine,
    sinceLabel,
    sinceSections,
    sinceWindow,
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

    it("reads a blocked chunk as what it needs, its age and a newer note, still opening its initiative", () => {
        const latest = { ts: NOW - 2 * 60 * MIN, text: "the blocker is gone on DEV", chunk: "S6" };
        const [row] = buildAttentionQueue({
            attention: [],
            efforts: [
                {
                    oref: "effort:e1",
                    title: "Nav rail",
                    blockedChunks: ["S6"],
                    blockedDetail: { S6: { since: NOW - 3 * DAY, needs: "needs: a DEV soak", latest } },
                } as unknown as EffortCardModel,
            ],
        });
        expect(queueLine(row, NOW)).toMatchObject({
            id: "waiting:chunk:effort:e1:S6",
            kind: "blocked",
            title: "S6",
            note: "needs: a DEV soak",
            why: "needs: a DEV soak",
            meta: "Nav rail",
            age: "3d",
            detail: "latest 2h · the blocker is gone on DEV",
            target: { queue: { kind: "oref", oref: "effort:e1" } },
        });
    });

    it("says no newer note, and no age, for a block nothing recorded", () => {
        const [row] = buildAttentionQueue({
            attention: [],
            efforts: [
                {
                    oref: "effort:e1",
                    title: "Nav rail",
                    blockedChunks: ["S6"],
                    blockedDetail: { S6: { since: null, needs: "" } },
                } as unknown as EffortCardModel,
            ],
        });
        expect(queueLine(row, NOW)).toMatchObject({ why: "", age: "", detail: "" });
    });

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

    // queueLine colours by the wire kind, never by QueueRow.tone alone: a council row is amber, not the red fallthrough
    it("reads a council row as one line that opens its council, in the asking tone", () => {
        const line = queueLine(
            {
                ...q,
                key: "council:c1",
                kind: "Council",
                title: "Council waiting on you: Rail apps",
                action: "Open",
                nav: { kind: "council", oref: "council:c1" },
                wireKind: "council",
                channelId: "",
                runId: null,
                why: "",
                attrib: "",
                detail: "",
            },
            NOW
        );
        expect(line).toMatchObject({
            kind: "council",
            kindTone: "asking",
            title: "Council waiting on you: Rail apps",
            target: { queue: { kind: "oref", oref: "council:c1" } },
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
        expect(["dag-gate", "ask", "escalation", "plan-review", "council"].map((k) => tone(k))).toEqual([
            "asking",
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

    it("keeps a topic with the trackers: it has no chunks because its sub-initiatives hold them", () => {
        const topic = { ...card("top", 0, 0), topic: true };
        const out = splitIdeas([topic, card("i1", 0, 0)]);
        expect(out.trackers.map((c) => c.oref)).toEqual(["top"]);
        expect(out.ideas.map((c) => c.oref)).toEqual(["i1"]);
    });
});

describe("a topic's line", () => {
    const topic = (over: Partial<EffortCardModel> = {}) =>
        ({
            ...buildEffortCard({
                oref: "effort:top",
                title: "Chat",
                status: "active",
                done: 0,
                total: 0,
                updatedts: 1,
            } as EffortSummary),
            topic: true,
            ...over,
        }) as EffortCardModel;

    it("is a tracker with no progress, not an idea", () => {
        const line = initiativeLine(topic());
        expect(line.idea).toBeUndefined();
        expect(line.progress).toBeNull();
    });

    it("is never counted quiet, however long since it was touched", () => {
        expect(quietCount([topic()], 30 * 24 * 3_600_000)).toBe(0);
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

    it("folds a run blocked past seven days too, and keeps a week-old ask in view", () => {
        const blocked: ActiveWorkRow = { ...run, chip: { label: "blocked", tone: "blocked" } };
        expect(sessionLine(blocked, NOW).stale).toBe(true);
        expect(sessionLine({ ...blocked, ts: NOW - 2 * DAY }, NOW).stale).toBe(false);
        // an asking run's question is still open, however long ago it was asked
        expect(sessionLine({ ...run, chip: { label: "asking", tone: "asking" } }, NOW).stale).toBe(false);
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

describe("sinceSections", () => {
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
    const record = (key: string, ts: number, status: string): DeltaRow =>
        delta({
            key,
            ts,
            kind: "dossier",
            title: "Record " + key,
            wording: "Record updated · current status: " + status,
            detail: "status: " + status,
            oref: "task:" + key,
        });

    it("splits the window into runs, one row per initiative, then records, whatever the day", () => {
        const sections = sinceSections(
            [
                record("d1", NOW - MIN, "active"),
                delta({ key: "1", ts: NOW - 2 * MIN, kind: "chunk-added", detail: "B · " }),
                delta({
                    key: "r",
                    ts: NOW - 3 * MIN,
                    kind: "run-done",
                    title: "execute plan",
                    wording: "Run completed",
                    detail: "summary",
                    oref: "run:r1",
                }),
                // yesterday's events of the same initiative join today's row
                delta({ key: "2", ts: NOW - DAY, detail: "A · Shipped the fold. Then more." }),
                delta({ key: "3", ts: NOW - DAY - MIN, kind: "chunk-done", detail: "A · plan written" }),
            ],
            NOW
        );
        expect(sections.map((s) => [s.kind, s.label])).toEqual([
            ["runs", "Runs"],
            ["initiatives", "Initiatives"],
            ["records", "Records"],
        ]);
        expect(sections[0].lines.map((l) => [l.id, l.kind, l.title, l.detail, l.state])).toEqual([
            ["behind:r", "Run completed", "execute plan", "summary", "3m"],
        ]);
        expect(sections[1].lines.map((l) => [l.id, l.title, l.note, l.detail, l.state])).toEqual([
            [
                "behind:effort:effort:e1",
                "SIEM",
                "Shipped the fold.",
                // a chunk's done note is a note too
                "2 notes · 1 chunk done · 1 chunk added",
                "2m",
            ],
        ]);
        expect(sections[1].lines[0].target).toEqual({ oref: "effort:e1" });
    });

    it("orders the initiatives by their newest event, even when the rows come in unsorted", () => {
        const [inits] = sinceSections(
            [
                delta({ key: "a", ts: NOW - 3 * MIN, title: "Old", oref: "effort:old" }),
                delta({ key: "b", ts: NOW - MIN, title: "New", oref: "effort:new" }),
                delta({ key: "c", ts: NOW - 2 * MIN, title: "Mid", oref: "effort:mid" }),
            ],
            NOW
        );
        expect(inits.lines.map((l) => l.title)).toEqual(["New", "Mid", "Old"]);
    });

    it("folds the records into one summary row that counts them by status", () => {
        const sections = sinceSections(
            [
                record("a", NOW - MIN, "active"),
                record("b", NOW - 2 * MIN, "completed"),
                record("c", NOW - 3 * MIN, "active"),
                delta({
                    key: "d",
                    ts: NOW - 4 * MIN,
                    kind: "decision",
                    title: "chose sqlite",
                    detail: null,
                    oref: null,
                }),
            ],
            NOW
        );
        const records = sections.find((s) => s.kind === "records")!;
        expect(records.summary).toMatchObject({
            id: RECORDS_SUMMARY_ID,
            title: "4 records updated",
            detail: "2 active · 1 completed · 1 decision",
            state: "1m",
            target: null,
        });
        expect(records.lines.map((l) => [l.title, l.kindTone, l.detail])).toEqual([
            ["Record a", "muted", "current status: active"],
            ["Record b", "muted", "current status: completed"],
            ["Record c", "muted", "current status: active"],
            ["chose sqlite", "muted", ""],
        ]);
    });

    it("says what an initiative did when it wrote no note", () => {
        const [inits] = sinceSections(
            [
                delta({ key: "1", kind: "effort-status", detail: "paused" }),
                delta({ key: "2", kind: "effort-created", detail: "3 chunks" }),
            ],
            NOW
        );
        expect([inits.lines[0].note, inits.lines[0].detail]).toEqual(["", "created · marked paused"]);
    });

    it("folds a run into its initiative's row, by the title the events or the index give it", () => {
        const run = (key: string, ts: number, kind: string, effortOid: string): DeltaRow =>
            delta({
                key,
                ts,
                kind,
                title: "Run goal " + key,
                wording: "Run",
                detail: kind === "run-done" ? "summary" : "status: executing",
                oref: "run:" + key,
                effortOid,
            });
        const efforts = new Map([["e2", { oref: "effort:e2", title: "Radar", chunkStages: {} }]]);
        const sections = sinceSections(
            [
                run("r1", NOW - MIN, "run-created", "e1"),
                delta({ key: "n", ts: NOW - 2 * MIN, detail: "A · wrote the fold" }),
                run("r1", NOW - 3 * MIN, "run-done", "e1"),
                run("r2", NOW - 4 * MIN, "run-created", "e2"),
                run("r3", NOW - 5 * MIN, "run-created", "gone"),
                run("r4", NOW - 6 * MIN, "run-created", ""),
            ],
            NOW,
            { efforts }
        );
        expect(sections.map((s) => s.lines.map((l) => [l.id, l.title, l.detail]))).toEqual([
            [
                ["behind:r3", "Run goal r3", "executing"],
                ["behind:r4", "Run goal r4", "executing"],
            ],
            [
                ["behind:effort:effort:e1", "SIEM", "1 note · 1 run"],
                ["behind:effort:effort:e2", "Radar", "1 run"],
            ],
        ]);
    });

    it("keeps one row for a run that started and finished inside the window: its finish", () => {
        const [runs] = sinceSections(
            [
                delta({ key: "done", ts: NOW - MIN, kind: "run-done", title: "g", detail: "sealed", oref: "run:r1" }),
                delta({
                    key: "start",
                    ts: NOW - 9 * MIN,
                    kind: "run-created",
                    title: "g",
                    detail: "status: executing",
                    oref: "run:r1",
                }),
                delta({
                    key: "other",
                    ts: NOW - 5 * MIN,
                    kind: "run-created",
                    title: "h",
                    detail: "status: executing",
                    oref: "run:r2",
                }),
            ],
            NOW
        );
        expect(runs.lines.map((l) => l.id)).toEqual(["behind:done", "behind:other"]);
    });

    it("names a row's project, takes a goal's first sentence and a summary's first line of prose", () => {
        const [runs] = sinceSections(
            [
                delta({
                    key: "a",
                    kind: "run-done",
                    title: "Wire the fold. Then ship the rest\nof a long goal.",
                    wording: "Run completed",
                    detail: "# Run report: wire\n\n## Tasks\n- t-1: **wire** the `fold`",
                    oref: "run:a",
                    project: "D:\\work\\waveterm",
                }),
                delta({
                    key: "b",
                    ts: NOW - MIN,
                    kind: "run-created",
                    title: "next",
                    wording: "Run started",
                    detail: "status: executing",
                    oref: "run:b",
                    project: "D:\\work\\waveterm",
                }),
            ],
            NOW,
            { projects: { arcterm: { path: "D:/work/waveterm" } } }
        );
        expect(runs.lines.map((l) => [l.title, l.detail])).toEqual([
            ["Wire the fold.", "arcterm · t-1: wire the fold"],
            ["next", "arcterm · executing"],
        ]);
    });

    it("returns no section for an empty window", () => {
        expect(sinceSections([], NOW)).toEqual([]);
    });
});

describe("sinceWindow", () => {
    const notes = (n: number): DeltaRow[] =>
        Array.from({ length: n }, (_, i) => ({
            key: "k" + i,
            ts: NOW - i * MIN,
            kind: "effort-note",
            title: i === n - 1 ? "the hidden radar initiative" : `initiative ${i}`,
            wording: "",
            detail: "A · note",
            oref: "effort:e" + i,
        }));

    it("shows SINCE_CAP rows of a section and counts the rest; open shows them all", () => {
        const [inits] = sinceSections(notes(SINCE_CAP + 3), NOW);
        expect(sinceWindow(inits, false, "")).toMatchObject({ summary: null, more: 3, total: SINCE_CAP + 3 });
        expect(sinceWindow(inits, false, "").lines).toHaveLength(SINCE_CAP);
        expect(sinceWindow(inits, true, "")).toMatchObject({ more: 0 });
        expect(sinceWindow(inits, true, "").lines).toHaveLength(SINCE_CAP + 3);
    });

    it("finds a row behind the fold when searched", () => {
        const [inits] = sinceSections(notes(SINCE_CAP + 3), NOW);
        expect(sinceWindow(inits, false, "").lines.map((l) => l.title)).not.toContain("the hidden radar initiative");
        expect(sinceWindow(inits, false, "radar").lines.map((l) => l.title)).toEqual(["the hidden radar initiative"]);
    });

    it("shows the records' summary closed, its rows under it open, and only matching rows when searched", () => {
        const rows: DeltaRow[] = ["alpha", "beta"].map((t, i) => ({
            key: t,
            ts: NOW - i * MIN,
            kind: "dossier",
            title: t,
            wording: "",
            detail: "status: active",
            oref: "task:" + t,
        }));
        const [records] = sinceSections(rows, NOW);
        const closed = sinceWindow(records, false, "");
        expect([closed.summary?.title, closed.lines.length, closed.total]).toEqual(["2 records updated", 0, 2]);
        const open = sinceWindow(records, true, "");
        expect([open.summary?.id, open.lines.map((l) => l.title)]).toEqual([RECORDS_SUMMARY_ID, ["alpha", "beta"]]);
        const searched = sinceWindow(records, false, "beta");
        expect([searched.summary, searched.lines.map((l) => l.title)]).toEqual([null, ["beta"]]);
    });
});

describe("shippedBriefLines", () => {
    it("draws a shipped run with its project, its summary's first sentence and its report", () => {
        const [line] = shippedBriefLines(
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
        expect(line).toMatchObject({
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
    // paused is the Agent tree's words, said whole: the row is the one place a paused run's Resume sits
    it("reads a paused run as paused, faint and idle, offers Resume, and can still be stopped", () => {
        const paused = { ...run, status: "paused" } as Run;
        const dag = { status: "paused", tasks: [] } as unknown as TaskGroup;
        for (const d of [undefined, dag]) {
            const f = runRowFace({ line, run: paused, dag: d, asking: false, project: "p" });
            expect(f).toMatchObject({
                state: "Paused · resumes when memory frees",
                stateTone: "faint",
                dot: "idle",
                paused: true,
                canStop: true,
                stopped: false,
            });
        }
    });
    it("offers Resume on a paused run only", () => {
        for (const status of ["executing", "blocked", "done", "cancelled"]) {
            const f = runRowFace({ line, run: { ...run, status } as Run, asking: false, project: "p" });
            expect(f.paused, status).toBe(false);
        }
        const direct = { ...line, runOid: undefined, agentId: "a1", meta: "claude · waveterm", state: "working" };
        expect(runRowFace({ line: direct, asking: false, project: "" }).paused).toBe(false);
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

describe("filter counts", () => {
    it("counts initiatives per project, the unnamed ones under the empty name", () => {
        const got = projectCounts([{ project: "opal" }, { project: "waveterm" }, { project: "opal" }, {}]);
        expect([...got]).toEqual([
            ["opal", 2],
            ["waveterm", 1],
            ["", 1],
        ]);
    });

    it("counts runs per kind, reading every other mode as quick, and direct agents only under all", () => {
        expect(runKindCounts(["orchestrator", "quick", "pipeline", ""], 2)).toEqual({
            all: 6,
            orchestrator: 1,
            quick: 3,
        });
    });
});

describe("filterAsMenu", () => {
    it("keeps a line of chips up to six choices besides all, and a menu past that", () => {
        expect(filterAsMenu(3)).toBe(false);
        expect(filterAsMenu(7)).toBe(false);
        expect(filterAsMenu(8)).toBe(true);
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

describe("a search reaches every fold", () => {
    it("opens a fold for a typed query, and for nothing else", () => {
        expect(foldOpen(false, "")).toBe(false);
        expect(foldOpen(false, "   ")).toBe(false);
        expect(foldOpen(false, "radar")).toBe(true);
        expect(foldOpen(true, "")).toBe(true);
    });
});

describe("quietCount", () => {
    const card = (over: Partial<EffortCardModel>) =>
        ({
            oref: "effort:x",
            status: "active",
            done: 1,
            remaining: 2,
            skipped: 0,
            updatedts: NOW,
            ...over,
        }) as EffortCardModel;

    it("counts live trackers untouched for seven days or more, not paused, finished, ideas or archived ones", () => {
        const week = NOW - 7 * DAY;
        expect(
            quietCount(
                [
                    card({ updatedts: NOW - DAY }),
                    card({ updatedts: week }),
                    card({ updatedts: NOW - 30 * DAY }),
                    card({ updatedts: NOW - 30 * DAY, status: "paused" }),
                    card({ updatedts: NOW - 30 * DAY, status: "archived" }),
                    card({ updatedts: NOW - 30 * DAY, remaining: 0, done: 3 }),
                    card({ updatedts: NOW - 30 * DAY, done: 0, remaining: 0 }),
                ],
                NOW
            )
        ).toBe(2);
        expect(quietCount([], NOW)).toBe(0);
    });
});

describe("plainSummary", () => {
    it("takes a report's first line of prose, not its headings, markers, emphasis or link targets", () => {
        expect(plainSummary("# Run report\n\n---\n1. **Wire** [the fold](http://x/y) in `place`. More.")).toBe(
            "Wire the fold in place."
        );
        expect(plainSummary("# only a heading")).toBe("");
        expect(plainSummary("")).toBe("");
    });
});
