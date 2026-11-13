// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { describe, expect, it } from "vitest";
import type { AgentVM } from "./agentsviewmodel";
import {
    agentTransitions,
    footerEvent,
    groupRailEvents,
    mergeRailEvents,
    runRailEvents,
    splitUnread,
    type RailEvent,
} from "./cockpitevents";
import type { RunInfo } from "./runlineage";

const a = (over: Partial<AgentVM>) =>
    ({ id: "x", name: "flaky-e2e", task: "fix flake", state: "working", ...over }) as AgentVM;

describe("agentTransitions", () => {
    it("records nothing for an agent seen the first time", () => {
        const { events, next } = agentTransitions({}, [a({})], 100);
        expect(events).toEqual([]);
        expect(next).toEqual({ x: { state: "working" } });
    });
    it("turns state changes into asked, answered and finished", () => {
        const asking = a({ state: "asking", blockedMs: 10, ask: { questions: [{ question: "retry or wait?" }] } });
        expect(agentTransitions({ x: { state: "working" } }, [asking], 100).events).toEqual([
            { key: "x:asked:90", focusId: "x", who: "flaky-e2e", kind: "asked", text: "retry or wait?", ts: 90 },
        ]);
        expect(agentTransitions({ x: { state: "asking" } }, [a({})], 100).events[0]).toMatchObject({
            kind: "answered",
            ts: 100,
        });
        const idle = a({ state: "idle", idleSince: 95, activity: "142 strings extracted" });
        expect(agentTransitions({ x: { state: "working" } }, [idle], 100).events[0]).toMatchObject({
            kind: "finished",
            text: "142 strings extracted",
            ts: 95,
        });
    });
    it("forgets agents that left the roster", () => {
        expect(agentTransitions({ gone: { state: "working" } }, [], 1).next).toEqual({});
    });
});

describe("runRailEvents", () => {
    const run: RunInfo = { runId: "R", channelId: "C", title: "Session auth", project: "p" };
    const ev = (kind: string, ts: number, detail: object = {}): RunEvent => ({
        id: `${kind}${ts}`,
        runid: "R",
        channelid: "C",
        ts,
        kind,
        detail: JSON.stringify(detail),
    });

    it("keeps state changes and drops the rest", () => {
        const out = runRailEvents(
            run,
            [
                ev("child-ask", 1, { taskid: "t3", question: "keep the cookie?" }),
                ev("task-done", 2, { taskid: "t1" }),
                ev("task-review-failed", 3, { taskid: "t7", round: 1, final: false }),
                ev("task-review-failed", 4, { taskid: "t7", round: 2, final: true }),
                ev("task-stalled", 5, { taskid: "t9" }),
                ev("lead-woken", 6),
            ],
            "lead"
        );
        expect(out.map((e) => e.kind)).toEqual(["asked", "finished", "failed", "quiet"]);
        expect(out[0]).toMatchObject({ key: "R:child-ask1", focusId: "lead", who: "Session auth", group: "R" });
    });

    // a finished task has not landed while its merge waits; only the merge lands it
    it("reads a task-done as finished and a task-merged as landed", () => {
        const out = runRailEvents(run, [ev("task-done", 1, { taskid: "t1" }), ev("task-merged", 2, { taskid: "t1" })]);
        expect(out.map((e) => e.kind)).toEqual(["finished", "landed"]);
    });

    it("reads the final stage's end by its outcome", () => {
        const out = runRailEvents(run, [
            ev("final-ended", 1, { round: 1, outcome: "passed" }),
            ev("final-ended", 2, { round: 1, outcome: "unverified" }),
            ev("final-ended", 3, { round: 2, outcome: "failed" }),
            ev("final-ended", 4, { round: 2, outcome: "odd" }),
        ]);
        expect(out.map((e) => [e.kind, e.text])).toEqual([
            ["finished", "final verification passed"],
            ["finished", "final stage unverified"],
            ["failed", "final verification failed"],
        ]);
    });

    it("reads the human's retry, skip, escalate, take-over and rerun as acted", () => {
        const out = runRailEvents(run, [
            ev("task-retried", 1, { taskid: "t1", auto: false, by: "human" }),
            ev("task-skipped", 2, { taskid: "t2", by: "human" }),
            ev("task-escalated", 3, { taskid: "t3", model: "claude-opus-5-5", by: "human" }),
            ev("task-forwarded", 4, { taskid: "t4", by: "human", note: "taken over" }),
            ev("final-rerun", 5, { round: 1 }),
        ]);
        expect(out.map((e) => [e.kind, e.text])).toEqual([
            ["acted", "you retried t1"],
            ["acted", "you skipped t2"],
            ["acted", "you escalated t3 to opus-5-5"],
            ["acted", "you took t4 over from the lead"],
            ["acted", "you reran the final stage"],
        ]);
    });

    it("leaves the lead's actions and the engine's own retries off the rail", () => {
        const out = runRailEvents(run, [
            ev("task-retried", 1, { taskid: "t1", auto: false, by: "lead" }),
            ev("task-skipped", 2, { taskid: "t2", by: "lead" }),
            ev("task-escalated", 3, { taskid: "t3", model: "m", by: "lead" }),
            ev("task-retried", 4, { taskid: "t4", kind: "failed", attempt: 1, auto: true }),
        ]);
        expect(out).toEqual([]);
    });

    it("reads a failure forwarded to the human as asked, with its note", () => {
        const out = runRailEvents(run, [ev("task-forwarded", 1, { taskid: "t4", note: "needs a human call" })], "lead");
        expect(out.map((e) => [e.kind, e.text, e.focusId])).toEqual([
            ["asked", "t4 handed to you · needs a human call", "lead"],
        ]);
    });

    it("reads a failed final stage as failed and leaves other blocks off the rail", () => {
        const out = runRailEvents(run, [
            ev("dag-blocked", 1, { failures: 1, kind: "task-failed" }),
            ev("dag-blocked", 2, { failures: 1, kind: "final-failed" }),
            ev("dag-blocked", 3, { failures: 1 }),
        ]);
        expect(out.map((e) => [e.kind, e.text])).toEqual([["failed", "final stage failed"]]);
    });
});

describe("mergeRailEvents / splitUnread", () => {
    const e = (key: string, ts: number) => ({ key, who: "w", kind: "asked" as const, text: "", ts });
    it("merges newest first, dedupes by key and caps", () => {
        expect(
            mergeRailEvents(
                [
                    [e("a", 1), e("b", 3)],
                    [e("b", 3), e("c", 2)],
                ],
                2
            ).map((x) => x.key)
        ).toEqual(["b", "c"]);
    });
    it("splits on the seen timestamp", () => {
        const { fresh, old } = splitUnread([e("b", 3), e("a", 1)], 2);
        expect(fresh.map((x) => x.key)).toEqual(["b"]);
        expect(old.map((x) => x.key)).toEqual(["a"]);
    });
});

describe("groupRailEvents", () => {
    const e = (key: string, group?: string) => ({
        key,
        who: group ? "auth-lead" : "w",
        kind: "asked" as const,
        text: "",
        ts: 0,
        group,
    });
    const list = [e("a", "R"), e("p"), e("b", "R"), e("c", "R")];
    it("shows a run's newest event with a count of the rest, and plain agents' events as they are", () => {
        const rows = groupRailEvents(list, {});
        expect(rows.map((r) => r.key)).toEqual(["a", "p"]);
        expect(rows[0].more).toBe("+2 more from auth-lead");
        expect(rows[1].more).toBeUndefined();
    });
    it("lists every event of an opened run, the first offering to fold them again", () => {
        const rows = groupRailEvents(list, { R: true });
        expect(rows.map((r) => r.key)).toEqual(["a", "p", "b", "c"]);
        expect(rows[0].more).toBe("show less from auth-lead");
        expect(rows[2].more).toBeUndefined();
    });
    it("offers nothing for a run with a single event", () => {
        expect(groupRailEvents([e("a", "R")], {})[0].more).toBeUndefined();
    });
});

describe("footerEvent", () => {
    const ev = (key: string, ts: number): RailEvent => ({ key, who: "loom", kind: "finished", text: "", ts });

    it("is nothing while there are no events", () => {
        expect(footerEvent([], [])).toBeNull();
    });

    it("gives the newest event and how many more came since the rail was last read", () => {
        const a = ev("a", 3);
        const b = ev("b", 2);
        const c = ev("c", 1);
        expect(footerEvent([a, b, c], [a, b, c])).toEqual({ event: a, moreNew: 2 });
        expect(footerEvent([a, b, c], [a])).toEqual({ event: a, moreNew: 0 });
    });

    it("counts none more when everything was read", () => {
        const a = ev("a", 3);
        expect(footerEvent([a], [])).toEqual({ event: a, moreNew: 0 });
    });
});
