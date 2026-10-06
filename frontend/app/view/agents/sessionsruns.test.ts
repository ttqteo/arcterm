// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { describe, expect, it } from "vitest";
import type { LiveSession } from "./sessionsarchivestore";
import {
    defaultMember,
    groupRunSessions,
    LEAD_MEMBER,
    memberOfSession,
    memberSession,
    runView,
    sessionLabel,
    sessionPrimary,
    sessionSelection,
    taskStatus,
} from "./sessionsruns";

const HOUR = 3_600_000;

const mk = (over: Partial<LiveSession> = {}): LiveSession => ({
    id: "x",
    runtime: "claude",
    projectpath: "/p",
    projectname: "proj",
    branch: "main",
    task: "do the thing",
    model: "claude",
    tokenstotal: 0,
    lastactivets: 0,
    resumecommand: "",
    transcriptpath: "",
    status: "done",
    startedts: 0,
    durationms: 0,
    events: [],
    live: false,
    needsAttention: false,
    ...over,
});

const task = (id: string, state: string, over: Partial<TaskNode> = {}): TaskNode => ({
    id,
    label: `label ${id}`,
    state,
    ...over,
});

const dagOf = (tasks: TaskNode[], over: Partial<TaskGroup> = {}): TaskGroup =>
    ({
        oid: "d",
        runid: "r1",
        channelid: "ch",
        title: "Port the header",
        tasks,
        status: "running",
        planpath: "C:\\docs\\plans\\p.md",
        ...over,
    }) as TaskGroup;

describe("groupRunSessions", () => {
    it("folds a run's sessions into one entry and leaves the rest solo", () => {
        const { runs, solos } = groupRunSessions([
            mk({ id: "lead", runid: "r1", channelid: "ch", role: "lead", lastactivets: 5 }),
            mk({ id: "w1", runid: "r1", channelid: "ch", role: "worker", taskid: "t-1", lastactivets: 3 }),
            mk({ id: "w1b", runid: "r1", channelid: "ch", role: "worker", taskid: "t-1", lastactivets: 9, live: true }),
            mk({ id: "solo" }),
        ]);
        expect(solos.map((s) => s.id)).toEqual(["solo"]);
        expect(runs).toHaveLength(1);
        expect(runs[0].lead.map((s) => s.id)).toEqual(["lead"]);
        expect(runs[0].tasks["t-1"].map((s) => s.id)).toEqual(["w1b", "w1"]);
        expect(runs[0].live).toBe(true);
        expect(runs[0].lastactivets).toBe(9);
    });
});

describe("memberSession", () => {
    it("prefers a live session so Jump reaches it", () => {
        const s = memberSession([mk({ id: "rv", role: "review", live: true }), mk({ id: "w", role: "worker" })]);
        expect(s?.id).toBe("rv");
    });
    it("prefers the worker over a newer finished reviewer", () => {
        const s = memberSession([mk({ id: "rv", role: "review" }), mk({ id: "w", role: "worker" })]);
        expect(s?.id).toBe("w");
    });
});

describe("taskStatus", () => {
    it("reads an ask held by you from the digest", () => {
        const digest = { tasks: [{ taskid: "t-3", waitreason: "ask" }] } as DagStatusDigest;
        expect(taskStatus(task("t-3", "running"), undefined, digest)).toEqual({ key: "asking", text: "asking" });
    });
    it("does not count an ask the lead holds as yours", () => {
        const digest = { tasks: [{ taskid: "t-3", waitreason: "lead-ask" }] } as DagStatusDigest;
        expect(taskStatus(task("t-3", "running"), undefined, digest).key).toBe("running");
    });
    it("names what a waiting task still waits on", () => {
        const dag = dagOf([task("t-3", "running"), task("t-5", "pending", { deps: ["t-3"] })]);
        expect(taskStatus(dag.tasks[1], dag, undefined)).toEqual({ key: "pending", text: "waits on 3" });
    });
    it("says landed only for a merged task", () => {
        expect(taskStatus(task("t-1", "done", { merged: true }), undefined, undefined).text).toBe("landed");
        expect(taskStatus(task("t-1", "done"), undefined, undefined).text).toBe("done");
    });
    it("treats every failure state as needing you", () => {
        for (const state of ["failed", "stalled", "review-failed", "blocked-merge", "verify-failed"]) {
            expect(taskStatus(task("t-1", state), undefined, undefined).key).toBe("failed");
        }
    });
});

describe("runView", () => {
    const sessions = [
        mk({ id: "lead", runid: "r1", role: "lead", live: true, tokenstotal: 100 }),
        mk({ id: "w1", runid: "r1", role: "worker", taskid: "t-1", tokenstotal: 40 }),
        mk({ id: "w3", runid: "r1", role: "worker", taskid: "t-3", live: true, tokenstotal: 60 }),
    ];
    const dag = dagOf([
        task("t-1", "done", { merged: true }),
        task("t-2", "running"),
        task("t-3", "running"),
        task("t-4", "pending", { deps: ["t-3"] }),
    ]);
    const digest = {
        tasks: [{ taskid: "t-3", waitreason: "ask", asksummary: "Keep the 78px rail?" }],
    } as DagStatusDigest;

    it("lists the lead and every task, and surfaces only the ones that need you", () => {
        const v = runView({ group: groupRunSessions(sessions).runs[0], dag, digest, leadAtPrompt: true, now: 0 });
        expect(v.title).toBe("Port the header");
        expect(v.plan).toBe("p.md");
        expect(v.members.map((m) => m.key)).toEqual([LEAD_MEMBER, "t-1", "t-2", "t-3", "t-4"]);
        expect(v.members[0].status).toEqual({ key: "idle", text: "waiting on engine" });
        expect(v.needs.map((m) => m.key)).toEqual(["t-3"]);
        expect(v.ask).toEqual({ member: "t-3", num: "3", text: "Keep the 78px rail?" });
        expect(v.head).toEqual({ key: "asking", text: "1 asking" });
        expect(v.segs).toEqual(["done", "running", "asking", "pending"]);
        expect(v.landed).toBe(1);
        expect(v.tokens).toBe(200);
        expect(defaultMember(v)).toBe("t-3");
    });

    it("opens a run with no lead session on its first member that has one", () => {
        const leadless = groupRunSessions([
            mk({ id: "w2", runid: "r9", role: "worker", taskid: "t-2", lastactivets: 4 }),
            mk({ id: "w3", runid: "r9", role: "worker", taskid: "t-3", lastactivets: 6 }),
        ]).runs[0];
        const done = dagOf([task("t-1", "done"), task("t-2", "done"), task("t-3", "done")], { status: "done" });
        expect(defaultMember(runView({ group: leadless, dag: done, now: 0 }))).toBe("t-2");
        // and on the lead when no member has a session at all
        expect(defaultMember(runView({ group: { ...leadless, tasks: {}, sessions: [] }, dag: done, now: 0 }))).toBe(
            LEAD_MEMBER
        );
    });

    it("opens a run with nothing asking on its lead", () => {
        const v = runView({ group: groupRunSessions(sessions).runs[0], dag, now: 0 });
        expect(v.head).toEqual({ key: "running", text: "2 running" });
        expect(defaultMember(v)).toBe(LEAD_MEMBER);
    });

    it("gives a finished run its age", () => {
        const ended = sessions.map((s) => ({ ...s, live: false, lastactivets: 0 }));
        const done = dagOf(
            dag.tasks.map((t) => ({ ...t, state: "done" })),
            { status: "done" }
        );
        const v = runView({ group: groupRunSessions(ended).runs[0], dag: done, now: 2 * HOUR });
        expect(v.head).toEqual({ key: "done", text: "2h" });
        expect(v.members[0].status).toEqual({ key: "done", text: "done" });
    });

    // the Agents tree's green check: the plan done, the lead finished and the branch landed
    it("is complete only once the run itself is done and landed", () => {
        const ended = sessions.map((s) => ({ ...s, live: false }));
        const done = dagOf(
            dag.tasks.map((t) => ({ ...t, state: "done", merged: true })),
            { status: "done" }
        );
        const complete = (run: Partial<Run>) =>
            runView({ group: groupRunSessions(ended).runs[0], run: run as Run, dag: done, now: 0 }).complete;
        expect(complete({ status: "done", land: { state: "landed" } as RunLand })).toBe(true);
        expect(complete({ status: "finalizing" })).toBe(false);
        expect(complete({ status: "done", land: { state: "held" } as RunLand })).toBe(false);
        expect(runView({ group: groupRunSessions(ended).runs[0], dag, now: 0 }).complete).toBe(false);
    });

    it("lists the tasks its sessions worked when the dag is missing", () => {
        const v = runView({ group: groupRunSessions(sessions).runs[0], now: 0 });
        expect(v.members.map((m) => m.key)).toEqual([LEAD_MEMBER, "t-1", "t-3"]);
        expect(v.title).toBe("do the thing");
    });
});

describe("session placement", () => {
    it("puts a lead or unplaced session on the lead, a child on its task", () => {
        expect(memberOfSession({ role: "lead" })).toBe(LEAD_MEMBER);
        expect(memberOfSession({ role: "worker" })).toBe(LEAD_MEMBER);
        expect(memberOfSession({ role: "review", taskid: "t-2" })).toBe("t-2");
    });
    it("labels a feed event by its run and place", () => {
        const titles = { r1: "Port the header" };
        expect(sessionLabel(mk({ runid: "r1", role: "worker", taskid: "t-3" }), titles)).toBe(
            "Port the header · task 3"
        );
        expect(sessionLabel(mk({ runid: "r1", role: "review", taskid: "t-3" }), titles)).toBe(
            "Port the header · task 3 review"
        );
        expect(sessionLabel(mk({ task: "solo work" }), titles)).toBe("solo work");
    });
});

describe("stage sessions", () => {
    const sessions = [
        mk({ id: "lead", runid: "r1", role: "lead", tokenstotal: 100 }),
        mk({ id: "pr1", runid: "r1", role: "plan-reviewer", lastactivets: 1, tokenstotal: 5 }),
        mk({ id: "pr2", runid: "r1", role: "plan-reviewer", lastactivets: 2, tokenstotal: 7 }),
        mk({ id: "w1", runid: "r1", role: "worker", taskid: "t-1", tokenstotal: 40 }),
        mk({ id: "fv", runid: "r1", role: "verifier", lastactivets: 9, tokenstotal: 20 }),
    ];
    const dag = dagOf([task("t-1", "done", { merged: true })], {
        status: "done",
        planreview: { state: "passed", round: 2 },
        final: { state: "failed", round: 1 },
    });

    it("lists the plan review and the final verification after the tasks, newest session first", () => {
        const v = runView({ group: groupRunSessions(sessions).runs[0], dag, now: 0 });
        expect(v.members.map((m) => m.key)).toEqual([LEAD_MEMBER, "t-1", "plan-reviewer", "verifier"]);
        const [, , review, verify] = v.members;
        expect(review.label).toBe("Plan review");
        expect(review.session?.id).toBe("pr2");
        expect(review.tokens).toBe(12);
        expect(review.status).toEqual({ key: "done", text: "passed" });
        expect(verify.label).toBe("Final verification");
        expect(verify.status).toEqual({ key: "failed", text: "failed" });
    });

    it("leaves the run's task counts and needs-you rows to its tasks", () => {
        const v = runView({ group: groupRunSessions(sessions).runs[0], dag, now: 0 });
        expect(v.total).toBe(1);
        expect(v.landed).toBe(1);
        expect(v.segs).toEqual(["done"]);
        expect(v.needs).toEqual([]);
    });

    it("reads a live stage session as judging, and one with no dag as done", () => {
        const live = sessions.map((s) => (s.id === "fv" ? { ...s, live: true } : s));
        const running = runView({ group: groupRunSessions(live).runs[0], dag, now: 0 });
        expect(running.members[3].status).toEqual({ key: "review", text: "verifying" });
        const bare = runView({ group: groupRunSessions(sessions).runs[0], now: 0 });
        expect(bare.members.slice(2).map((m) => m.status)).toEqual([
            { key: "done", text: "done" },
            { key: "done", text: "done" },
        ]);
    });

    it("places and labels a stage session by its stage", () => {
        expect(memberOfSession({ role: "verifier" })).toBe("verifier");
        expect(sessionLabel(mk({ runid: "r1", role: "plan-reviewer" }), { r1: "Port the header" })).toBe(
            "Port the header · plan review"
        );
    });
});

describe("sessionPrimary", () => {
    it("jumps to a live session, resumes an ended resumable one, and offers nothing otherwise", () => {
        expect(sessionPrimary(mk({ live: true, liveId: "tab-1" }))).toBe("jump");
        expect(sessionPrimary(mk({ resumecommand: "claude --resume x" }))).toBe("resume");
        expect(sessionPrimary(mk())).toBeNull();
    });
});

describe("sessionSelection", () => {
    it("lands a run member on its run with it in view", () => {
        expect(sessionSelection(mk({ runid: "r1", role: "task", taskid: "t-2" }))).toEqual({
            sel: "run:r1",
            member: "t-2",
        });
    });
    it("lands a session on its own entry", () => {
        expect(sessionSelection(mk({ id: "s9", runtime: "pi" }))).toEqual({ sel: "pi:s9" });
    });
});
