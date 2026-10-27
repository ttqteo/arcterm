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
    resumeLaunchOpts,
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

    it("leaves a builder-check or judge session solo with no run row, while a plan reviewer groups under its run", () => {
        const { runs, solos } = groupRunSessions([
            mk({ id: "bc", runid: "rb", channelid: "ch", role: "builder-check" }),
            mk({ id: "bj", runid: "rj", channelid: "ch", role: "brainstorm-judge" }),
            mk({ id: "pr", runid: "r1", channelid: "ch", role: "plan-reviewer" }),
        ]);
        expect(solos.map((s) => s.id)).toEqual(["bc", "bj"]);
        expect(runs.map((r) => r.runId)).toEqual(["r1"]);
        expect(runs[0].stages["plan-reviewer"].map((s) => s.id)).toEqual(["pr"]);
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

    it("reads a plan reviewer of the current round by its own verdict, and an earlier one by the round's", () => {
        const statusOf = (stagerunid: string, review: PlanReviewStage) => {
            const group = groupRunSessions([
                mk({ id: "lead", runid: "r1", role: "lead" }),
                mk({ id: "pr", runid: "r1", role: "plan-reviewer", stagerunid }),
            ]).runs[0];
            const v = runView({ group, dag: { ...dag, planreview: review }, now: 0 });
            return v.members.find((m) => m.key === "plan-reviewer")?.status;
        };
        const failedRound: PlanReviewStage = {
            state: "failed",
            round: 1,
            reviewers: [
                { lens: "full", state: "passed", runid: "rv-full" },
                { lens: "spec", state: "failed", runid: "rv-spec" },
                { lens: "order", state: "lost", runid: "rv-order" },
            ],
        };
        expect(statusOf("rv-full", failedRound)).toEqual({ key: "done", text: "passed" });
        expect(statusOf("rv-spec", failedRound)).toEqual({ key: "failed", text: "failed" });
        expect(statusOf("rv-order", failedRound)).toEqual({ key: "failed", text: "failed" });
        // not in this round: the round's own state, as before
        expect(statusOf("rv-gone", { ...failedRound, state: "passed" })).toEqual({ key: "done", text: "passed" });
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

    describe("a land resolver", () => {
        const resolver = (over: Partial<LiveSession> = {}) =>
            mk({ id: "lr", runid: "r1", role: "land-resolver", lastactivets: 10, tokenstotal: 9, ...over });
        const grouped = (list: LiveSession[]) => groupRunSessions([...sessions, ...list]).runs[0];
        const view = (list: LiveSession[], land?: RunLand) =>
            runView({ group: grouped(list), run: { land } as Run, dag, now: 0 });
        const member = (v: ReturnType<typeof runView>) => v.members.find((m) => m.key === "land-resolver");

        it("groups as a stage member after the verification, not under the lead", () => {
            const group = grouped([resolver()]);
            expect(group.stages["land-resolver"].map((s) => s.id)).toEqual(["lr"]);
            expect(group.lead.map((s) => s.id)).toEqual(["lead"]);
            const v = view([resolver()], { state: "queued" } as RunLand);
            expect(v.members.map((m) => m.key)).toEqual([
                LEAD_MEMBER,
                "t-1",
                "plan-reviewer",
                "verifier",
                "land-resolver",
            ]);
            expect(member(v)).toMatchObject({ label: "Conflict resolver", tokens: 9, session: { id: "lr" } });
            // it is a stage, not a task: the run's counts and needs-you rows stay its tasks'
            expect(v.total).toBe(1);
            expect(v.needs).toEqual([]);
        });

        it("places and labels its session by its stage", () => {
            expect(memberOfSession({ role: "land-resolver" })).toBe("land-resolver");
            expect(sessionLabel(resolver(), { r1: "Port the header" })).toBe("Port the header · conflict resolver");
        });

        it("reads a live one as resolving, never reviewing", () => {
            const land = { state: "resolving", resolver: "rs1", resolvertried: true } as RunLand;
            expect(member(view([resolver({ live: true })], land))?.status).toEqual({
                key: "review",
                text: "resolving",
            });
            // live with no land read yet: still its own word
            expect(member(view([resolver({ live: true })]))?.status).toEqual({ key: "review", text: "resolving" });
        });

        it("reads an ended one from the run's land, as the tree does", () => {
            const status = (land: RunLand) => member(view([resolver()], land))?.status;
            expect(status({ state: "resolving", resolver: "rs1" } as RunLand)).toEqual({
                key: "review",
                text: "resolving",
            });
            expect(status({ state: "held", resolvertried: true } as RunLand)).toEqual({
                key: "failed",
                text: "failed",
            });
            for (const state of ["queued", "pending", "landed"]) {
                expect(status({ state, resolvertried: true } as RunLand)).toEqual({ key: "done", text: "passed" });
            }
        });

        it("reads an ended one with no land loaded as done, like a stage the dag has no verdict for", () => {
            expect(member(view([resolver()]))?.status).toEqual({ key: "done", text: "done" });
        });

        it("leaves the other stages as the dag reads them", () => {
            const v = view([resolver()], { state: "held", resolvertried: true } as RunLand);
            expect(v.members.find((m) => m.key === "plan-reviewer")?.status).toEqual({ key: "done", text: "passed" });
            expect(v.members.find((m) => m.key === "verifier")?.status).toEqual({ key: "failed", text: "failed" });
        });
    });
});

describe("sessionPrimary", () => {
    it("jumps to a live session, resumes an ended resumable one, and offers nothing otherwise", () => {
        expect(sessionPrimary(mk({ live: true, liveId: "tab-1" }))).toBe("jump");
        expect(sessionPrimary(mk({ resumecommand: "claude --resume x" }))).toBe("resume");
        expect(sessionPrimary(mk())).toBeNull();
    });
});

describe("resumeLaunchOpts", () => {
    it("names the resumed tab after the session it resumes", () => {
        const opts = resumeLaunchOpts(mk({ task: "fix the login bug", resumecommand: "claude --resume x" }));
        expect(opts.label).toBe("fix the login bug");
        expect(opts.startupCommand).toBe("claude --resume x");
        expect(opts.task).toBe("");
    });
    it("leaves an untitled session to the tab's own fallback name", () => {
        expect(resumeLaunchOpts(mk({ task: "  ", resumecommand: "claude --resume x" })).label).toBeUndefined();
    });
    it("resumes pi by its exact argv and transcript path", () => {
        const opts = resumeLaunchOpts(
            mk({
                runtime: "pi",
                resumecommand: "pi",
                resumeargs: ["--session", "/t.jsonl"],
                transcriptpath: "/t.jsonl",
            })
        );
        expect(opts.startupArgs).toEqual(["--session", "/t.jsonl"]);
        expect(opts.resumePath).toBe("/t.jsonl");
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

describe("groupRunSessions folding details", () => {
    it("takes the run's channel from the first session that has one and keeps it", () => {
        const { runs } = groupRunSessions([
            mk({ id: "a", runid: "r1", role: "lead" }),
            mk({ id: "b", runid: "r1", role: "worker", taskid: "t-1", channelid: "ch" }),
            mk({ id: "c", runid: "r1", role: "worker", taskid: "t-2", channelid: "other" }),
        ]);
        expect(runs[0].channelId).toBe("ch");
    });

    it("leaves a run no session gave a channel on an empty channel id", () => {
        expect(groupRunSessions([mk({ runid: "r1", role: "lead" })]).runs[0].channelId).toBe("");
    });

    it("keeps a session with no lead or stage role and no task id out of the task map", () => {
        const { runs } = groupRunSessions([
            mk({ id: "lead", runid: "r1", role: "lead" }),
            mk({ id: "orphan", runid: "r1", role: "worker" }),
        ]);
        expect(runs[0].tasks).toEqual({});
        expect(runs[0].sessions.map((s) => s.id)).toEqual(["lead", "orphan"]);
    });

    it("lists a run's lead sessions newest first", () => {
        const { runs } = groupRunSessions([
            mk({ id: "old", runid: "r1", role: "lead", lastactivets: 1 }),
            mk({ id: "new", runid: "r1", role: "lead", lastactivets: 9 }),
            mk({ id: "mid", runid: "r1", role: "lead", lastactivets: 5 }),
        ]);
        expect(runs[0].lead.map((s) => s.id)).toEqual(["new", "mid", "old"]);
    });
});

describe("runView members", () => {
    const viewOf = (list: LiveSession[], over: Partial<Parameters<typeof runView>[0]> = {}) =>
        runView({ group: groupRunSessions(list).runs[0], now: 0, ...over });
    const lead = (over: Partial<LiveSession> = {}) => mk({ id: "lead", runid: "r1", role: "lead", ...over });

    it("sums each member's tokens and duration over its own sessions", () => {
        const v = viewOf(
            [
                lead({ id: "l1", tokenstotal: 100, durationms: 1000 }),
                lead({ id: "l2", tokenstotal: 20, durationms: 300 }),
                mk({ id: "w1", runid: "r1", role: "worker", taskid: "t-1", tokenstotal: 7, durationms: 50 }),
                mk({ id: "w1b", runid: "r1", role: "worker", taskid: "t-1", tokenstotal: 5, durationms: 40 }),
                mk({ id: "pr1", runid: "r1", role: "plan-reviewer", tokenstotal: 3, durationms: 11 }),
                mk({ id: "pr2", runid: "r1", role: "plan-reviewer", tokenstotal: 4, durationms: 22 }),
            ],
            { dag: dagOf([task("t-1", "done")]) }
        );
        expect(v.members.map((m) => [m.key, m.tokens, m.durationMs])).toEqual([
            [LEAD_MEMBER, 120, 1300],
            ["t-1", 12, 90],
            ["plan-reviewer", 7, 33],
        ]);
    });

    it("lists the tasks of a run with no dag in task id order, whatever order its sessions arrived in", () => {
        const v = viewOf([
            lead(),
            mk({ id: "w3", runid: "r1", role: "worker", taskid: "t-3" }),
            mk({ id: "w1", runid: "r1", role: "worker", taskid: "t-1" }),
        ]);
        expect(v.members.map((m) => m.key)).toEqual([LEAD_MEMBER, "t-1", "t-3"]);
    });

    it("names a task by its label, else by its id", () => {
        const v = viewOf([lead()], {
            dag: dagOf([task("t-1", "done", { label: "Port it" }), task("t-2", "done", { label: "" })]),
        });
        expect(v.members.map((m) => m.label)).toEqual(["Lead", "Port it", "t-2"]);
    });

    it("carries a task's child run id, and none when it has none", () => {
        const v = viewOf([lead()], {
            dag: dagOf([
                task("t-1", "done", { runid: "child-1" }),
                task("t-2", "done", { runid: "" }),
                task("t-3", "done"),
            ]),
        });
        expect(v.members.map((m) => m.childRunId)).toEqual([undefined, "child-1", undefined, undefined]);
    });

    it("reads the asking task's summary out of the digest by task id", () => {
        const digest = {
            tasks: [
                { taskid: "t-1", waitreason: "lead-ask", asksummary: "not yours" },
                { taskid: "t-3", waitreason: "ask", asksummary: "Keep the rail?" },
            ],
        } as DagStatusDigest;
        const v = viewOf([lead()], { dag: dagOf([task("t-1", "running"), task("t-3", "running")]), digest });
        expect(v.ask).toEqual({ member: "t-3", num: "3", text: "Keep the rail?" });
    });

    it("has no ask when nothing asks, even with a digest", () => {
        const digest = { tasks: [{ taskid: "t-1", waitreason: "lead-ask", asksummary: "x" }] } as DagStatusDigest;
        const v = viewOf([lead()], { dag: dagOf([task("t-1", "running")]), digest });
        expect(v.ask).toBeUndefined();
    });

    it("takes the project from the run's path, else the lead's, else nothing", () => {
        const w = mk({ id: "w", runid: "r1", role: "worker", taskid: "t-1", projectname: "workerproj" });
        const named = [lead({ projectname: "leadproj" })];
        expect(viewOf(named, { run: { projectpath: "C:\\code\\arc" } as Run }).project).toBe("arc");
        expect(viewOf(named, { run: {} as Run }).project).toBe("leadproj");
        expect(viewOf(named).project).toBe("leadproj");
        expect(viewOf([w]).project).toBe("");
    });

    it("takes the runtime from the run, else the lead, else claude", () => {
        const w = mk({ id: "w", runid: "r1", role: "worker", taskid: "t-1", runtime: "pi" });
        const codex = [lead({ runtime: "codex" })];
        expect(viewOf(codex, { run: { runtime: "pi" } as Run }).runtime).toBe("pi");
        expect(viewOf(codex, { run: {} as Run }).runtime).toBe("codex");
        expect(viewOf(codex).runtime).toBe("codex");
        expect(viewOf([w]).runtime).toBe("claude");
    });

    it("starts a run when its run record was created, else with its earliest session", () => {
        const list = [
            lead({ id: "a", startedts: 300, lastactivets: 400 }),
            mk({ id: "b", runid: "r1", role: "worker", taskid: "t-1", startedts: 0, lastactivets: 150 }),
            mk({ id: "c", runid: "r1", role: "worker", taskid: "t-2", startedts: 200, lastactivets: 50 }),
        ];
        expect(viewOf(list, { run: { createdts: 500 } as Run }).startedts).toBe(500);
        expect(viewOf(list).startedts).toBe(150);
    });
});

describe("runView lead status", () => {
    const statusOf = (over: Partial<LiveSession>, input: Partial<Parameters<typeof runView>[0]> = {}) =>
        runView({
            group: groupRunSessions([mk({ id: "l", runid: "r1", role: "lead", live: true, ...over })]).runs[0],
            now: 0,
            ...input,
        }).members[0].status;
    const open = dagOf([], { status: "running" });

    it("asks for you when the live lead needs attention, even at its prompt with the dag open", () => {
        expect(statusOf({ needsAttention: true }, { dag: open, leadAtPrompt: true })).toEqual({
            key: "asking",
            text: "asking",
        });
    });

    it("waits on the engine only at its prompt with the dag still open", () => {
        expect(statusOf({}, { dag: open, leadAtPrompt: true })).toEqual({ key: "idle", text: "waiting on engine" });
        const working = { key: "running", text: "working" };
        expect(statusOf({}, { dag: open, leadAtPrompt: false })).toEqual(working);
        expect(statusOf({}, { dag: open })).toEqual(working);
        expect(statusOf({}, { leadAtPrompt: true })).toEqual(working);
        expect(statusOf({}, { dag: dagOf([], { status: "done" }), leadAtPrompt: true })).toEqual(working);
        expect(statusOf({}, { dag: dagOf([], { status: "cancelled" }), leadAtPrompt: true })).toEqual(working);
    });
});

describe("runView head status", () => {
    const headOf = (list: LiveSession[], over: Partial<Parameters<typeof runView>[0]> = {}) =>
        runView({ group: groupRunSessions(list).runs[0], now: 0, ...over }).head;
    const lead = (over: Partial<LiveSession> = {}) => mk({ id: "lead", runid: "r1", role: "lead", ...over });

    it("says how many tasks need you, singular or plural", () => {
        const two = dagOf([task("t-1", "done"), task("t-2", "failed"), task("t-3", "stalled")]);
        expect(headOf([lead()], { dag: two })).toEqual({ key: "failed", text: "2 need you" });
        const one = dagOf([task("t-1", "done"), task("t-2", "failed")]);
        expect(headOf([lead()], { dag: one })).toEqual({ key: "failed", text: "1 needs you" });
    });

    it("counts a task in review or verifying as running", () => {
        const dag = dagOf([task("t-1", "done"), task("t-2", "reviewing"), task("t-3", "verifying")]);
        expect(headOf([lead()], { dag })).toEqual({ key: "running", text: "2 running" });
    });

    it("counts a task in review alone as running", () => {
        const dag = dagOf([task("t-1", "done"), task("t-2", "reviewing")]);
        expect(headOf([lead()], { dag })).toEqual({ key: "running", text: "1 running" });
    });

    it("reads a cancelled dag as cancelled, even while the lead is live", () => {
        const dag = dagOf([task("t-1", "done")], { status: "cancelled" });
        expect(headOf([lead({ live: true })], { dag })).toEqual({ key: "muted", text: "cancelled" });
    });

    it("reads a live run with nothing running as working, or planning before it has a dag", () => {
        const dag = dagOf([task("t-1", "done")], { status: "running" });
        expect(headOf([lead({ live: true })], { dag })).toEqual({ key: "running", text: "working" });
        expect(headOf([lead({ live: true })])).toEqual({ key: "running", text: "planning" });
    });

    it("gives an ended run the time since its last activity", () => {
        const dag = dagOf([task("t-1", "done")], { status: "done" });
        expect(headOf([lead({ lastactivets: HOUR })], { dag, now: 3 * HOUR })).toEqual({ key: "done", text: "2h" });
    });
});

describe("resumeLaunchOpts launch shape", () => {
    const base = {
        id: "s1",
        projectpath: "/p",
        projectname: "proj",
        task: "fix it",
        resumecommand: "claude --resume s1",
        transcriptpath: "/t.jsonl",
    };

    it("opens a claude session by its resume command alone, whatever argv the session carries", () => {
        const s = mk({ ...base, runtime: "claude", resumeargs: ["--session", "/t.jsonl"] });
        expect(resumeLaunchOpts(s)).toStrictEqual({
            runtime: "claude",
            startupCommand: "claude --resume s1",
            task: "",
            projectPath: "/p",
            projectName: "proj",
            label: "fix it",
        });
    });

    it("opens a pi session with no argv, or an empty one, by its command alone", () => {
        const want = {
            runtime: "pi",
            startupCommand: "claude --resume s1",
            task: "",
            projectPath: "/p",
            projectName: "proj",
            label: "fix it",
        };
        expect(resumeLaunchOpts(mk({ ...base, runtime: "pi" }))).toStrictEqual(want);
        expect(resumeLaunchOpts(mk({ ...base, runtime: "pi", resumeargs: [] }))).toStrictEqual(want);
    });

    it("names a project-less session's agent 'agent', and keeps a named project's name", () => {
        expect(resumeLaunchOpts(mk({ ...base, projectname: "" })).projectName).toBe("agent");
        expect(resumeLaunchOpts(mk({ ...base })).projectName).toBe("proj");
    });
});
