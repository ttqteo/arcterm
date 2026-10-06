// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { describe, expect, it } from "vitest";
import {
    activeRows,
    agentExited,
    ALL_PROJECTS,
    CONVERSATION_PAGE,
    conversationProjects,
    conversationRows,
    effectiveProject,
    endedSessionsByProject,
    scanDue,
    sessionAgeLabel,
    sessionTitle,
    UNTITLED_SESSION,
    type EndedSessionRow,
    type MoreConversationsRow,
} from "./agentsidebarmodel";
import type { AgentVM } from "./agentsviewmodel";
import { buildAgentTree, UNGROUPED_PROJECT, type AgentTreeRow } from "./agenttreemodel";

const MIN = 60_000;
const NOW = 1_800_000_000_000;

const session = (id: string, over: Partial<SessionActivity> = {}): SessionActivity => ({
    id,
    runtime: "claude",
    projectpath: "/p",
    projectname: "waveterm",
    branch: "main",
    task: `prompt ${id}`,
    model: "opus",
    tokenstotal: 0,
    lastactivets: NOW - MIN,
    resumecommand: `claude --resume ${id}`,
    transcriptpath: `/home/u/.claude/projects/home-u-waveterm/${id}.jsonl`,
    status: "done",
    startedts: 0,
    durationms: 0,
    events: [],
    ...over,
});

// n sessions of one project, "<prefix>1" the newest and "<prefix>n" the oldest
const solos = (n: number, project = "waveterm", prefix = "s") =>
    Array.from({ length: n }, (_, i) =>
        session(`${prefix}${i + 1}`, { projectname: project, lastactivets: NOW - (i + 1) * MIN })
    );

const agent = (id: string, path?: string, project = "waveterm"): AgentVM => ({
    id,
    name: id,
    task: "",
    state: "working",
    project,
    transcriptPath: path,
});

const label = (r: AgentTreeRow): string => (r.kind === "group" ? `group:${r.project}` : r.kind);
const labels = (rows: AgentTreeRow[]) => rows.map(label);
const groupsOf = (rows: AgentTreeRow[]) => rows.flatMap((r) => (r.kind === "group" ? [r.project] : []));

// the Conversations list as session ids, a more row as "more:<hidden>"
const ids = (rows: (EndedSessionRow | MoreConversationsRow)[]) =>
    rows.map((r) => (r.kind === "more" ? `more:${r.hidden}` : r.session.id));

const treeOf = (agents: AgentVM[]) =>
    buildAgentTree(
        agents,
        agents.map((a) => a.id)
    );
const endedOf = (list: SessionActivity[], roster: AgentVM[] = []) => endedSessionsByProject(list, roster);

describe("sessionTitle", () => {
    it("is the first prompt with its whitespace collapsed", () => {
        expect(sessionTitle("  fix the\n  race   condition ")).toBe("fix the race condition");
    });
    it("falls back for a blank prompt", () => {
        expect(sessionTitle("")).toBe(UNTITLED_SESSION);
        expect(sessionTitle("\n  \n")).toBe(UNTITLED_SESSION);
    });
});

describe("sessionAgeLabel", () => {
    it("reads minutes, days, and under a minute", () => {
        expect(sessionAgeLabel(NOW - 16 * MIN, NOW)).toBe("16m");
        expect(sessionAgeLabel(NOW - 3 * 24 * 60 * MIN, NOW)).toBe("3d");
        expect(sessionAgeLabel(NOW - 10_000, NOW)).toBe("<1m");
    });
    it("never reads a clock-skewed future stamp as negative", () => {
        expect(sessionAgeLabel(NOW + 5 * MIN, NOW)).toBe("<1m");
    });
});

describe("endedSessionsByProject", () => {
    it("is empty until the scan has loaded", () => {
        expect(endedSessionsByProject(null, []).size).toBe(0);
    });

    it("groups ended sessions by project, newest first", () => {
        const out = endedOf([
            session("old", { lastactivets: NOW - 9 * MIN }),
            session("new", { lastactivets: NOW - MIN }),
            session("other", { projectname: "loom", lastactivets: NOW - 2 * MIN }),
        ]);
        expect([...out.keys()].sort()).toEqual(["loom", "waveterm"]);
        expect(out.get("waveterm")!.map((r) => r.session.id)).toEqual(["new", "old"]);
    });

    it("breaks a tie on the time by session key, whatever order the scan listed them in", () => {
        const a = session("a", { lastactivets: NOW - MIN });
        const b = session("b", { lastactivets: NOW - MIN });
        const c = session("c", { lastactivets: NOW - MIN });
        const ids = (list: SessionActivity[]) =>
            endedOf(list)
                .get("waveterm")!
                .map((r) => r.session.id);
        expect(ids([c, a, b])).toEqual(["a", "b", "c"]);
        expect(ids([b, c, a])).toEqual(["a", "b", "c"]);
    });

    it("leaves out a session a live agent is running, joined by normalized transcript path", () => {
        const ended = session("w", { transcriptpath: "C:\\Users\\U\\.claude\\projects\\home-u-waveterm\\w.jsonl" });
        const liveAgent = agent("t1", "c:/users/u/.claude/projects/home-u-waveterm/w.jsonl");
        expect(endedOf([ended], [liveAgent]).size).toBe(0);
        // the same session with that agent gone is ended again
        expect(endedOf([ended], []).get("waveterm")).toHaveLength(1);
    });

    it("leaves out a session an orchestrator run launched", () => {
        const out = endedOf([session("a"), session("b", { runid: "r1", role: "worker", taskid: "t-1" })]);
        expect(out.get("waveterm")!.map((r) => r.session.id)).toEqual(["a"]);
    });

    it("files a session with no project under ungrouped, like a live agent with none", () => {
        expect([...endedOf([session("a", { projectname: "" })]).keys()]).toEqual([UNGROUPED_PROJECT]);
    });

    it("titles a row with the first prompt and keeps the full text for the tooltip", () => {
        const [row] = endedOf([session("a", { task: "fix the\n  race" })]).get("waveterm")!;
        expect(row).toMatchObject({
            kind: "session",
            project: "waveterm",
            key: "claude:a",
            title: "fix the race",
            tooltip: "fix the\n  race",
        });
    });
});

// The tree files a live agent under projectOf(agent): the registered project name it was launched into
// (session:project), else the last hyphen segment of its transcript folder. The scan names a session by the last
// segment of its cwd. Both are for one project, so a conversation must carry the name its live agents' folder does.
describe("endedSessionsByProject project keys", () => {
    it("files a session under the registered project its path belongs to, not under its folder's name", () => {
        const launched = agent("a", undefined, "Arc");
        const ended = endedSessionsByProject(
            [session("s", { projectpath: "D:\\projects\\arcterm", projectname: "arcterm" })],
            [launched],
            { Arc: { path: "d:/projects/arcterm/" } }
        );
        expect([...ended.keys()]).toEqual(["Arc"]);
        // the name the live agent's folder in Active carries
        expect(groupsOf(treeOf([launched]))).toEqual(["Arc"]);
    });

    it("gives a registered project with only ended sessions its registered name", () => {
        const ended = endedSessionsByProject(
            [session("s", { projectpath: "/work/arcterm", projectname: "arcterm" })],
            [],
            { Arc: { path: "/work/arcterm" } }
        );
        expect([...ended.keys()]).toEqual(["Arc"]);
    });

    it("ignores a registered project with no path, and a session with no path", () => {
        const ended = endedSessionsByProject([session("s", { projectpath: "", projectname: "loom" })], [], {
            Arc: {},
            Odd: { path: "" },
        });
        expect([...ended.keys()]).toEqual(["loom"]);
    });

    it("files a session in a live agent's transcript folder under that agent's project", () => {
        // an agent started in a terminal has no session:project, so its key is the lossy last hyphen segment
        const external = {
            ...agent("a", "C:\\Users\\U\\.claude\\projects\\D--projects-arcterm-fork\\live.jsonl"),
            project: undefined,
        };
        expect(groupsOf(treeOf([external]))).toEqual(["fork"]);
        const ended = endedSessionsByProject(
            [
                session("s", {
                    projectpath: "D:\\projects\\arcterm-fork",
                    projectname: "arcterm-fork",
                    transcriptpath: "c:/users/u/.claude/projects/d--projects-arcterm-fork/old.jsonl",
                }),
            ],
            [external],
            // the registered name would say otherwise, but the live agent's folder is where the eye is
            { "arc fork": { path: "D:\\projects\\arcterm-fork" } }
        );
        expect([...ended.keys()]).toEqual(["fork"]);
    });

    it("does not read two sessions as one project because their transcripts share a date folder", () => {
        // codex writes one folder per day, whatever the project
        const codexAgent = agent("a", "/home/u/.codex/sessions/2026/10/05/rollout-live.jsonl", "waveterm");
        const ended = endedSessionsByProject(
            [
                session("s", {
                    runtime: "codex",
                    projectname: "loom",
                    transcriptpath: "/home/u/.codex/sessions/2026/10/05/rollout-old.jsonl",
                }),
            ],
            [codexAgent]
        );
        expect([...ended.keys()]).toEqual(["loom"]);
    });

    it("falls back to the scan's folder name for a project that is neither registered nor live", () => {
        const ended = endedSessionsByProject(
            [session("s", { projectpath: "/elsewhere/loom", projectname: "loom" })],
            [agent("a")],
            { Arc: { path: "/work/arcterm" } }
        );
        expect([...ended.keys()]).toEqual(["loom"]);
    });
});

describe("activeRows", () => {
    const noneCollapsed = new Set<string>();

    it("is the tree as it is when no project is collapsed", () => {
        const tree = treeOf([agent("a"), agent("b", undefined, "loom")]);
        expect(activeRows(tree, noneCollapsed)).toEqual(tree);
        expect(labels(activeRows(tree, noneCollapsed))).toEqual(["group:waveterm", "parent", "group:loom", "parent"]);
    });

    it("hides a collapsed project's rows, keeping its folder row", () => {
        const tree = treeOf([agent("a"), agent("b", undefined, "loom")]);
        expect(labels(activeRows(tree, new Set(["waveterm"])))).toEqual(["group:waveterm", "group:loom", "parent"]);
        expect(labels(activeRows(tree, new Set(["loom"])))).toEqual(["group:waveterm", "parent", "group:loom"]);
        expect(labels(activeRows(tree, new Set(["waveterm", "loom"])))).toEqual(["group:waveterm", "group:loom"]);
    });

    it("keeps the count and attention a collapsed folder row carries", () => {
        const asking: AgentVM = { ...agent("a"), state: "asking" };
        const rows = activeRows(treeOf([asking, agent("b")]), new Set(["waveterm"]));
        expect(rows).toHaveLength(1);
        expect(rows[0]).toMatchObject({ kind: "group", project: "waveterm", count: 2, attn: 1 });
    });

    it("ignores a collapsed name no live project has, and is empty with no live agent", () => {
        const tree = treeOf([agent("a")]);
        expect(activeRows(tree, new Set(["loom"]))).toEqual(tree);
        expect(activeRows([], new Set(["loom"]))).toEqual([]);
    });
});

describe("conversationRows", () => {
    it("lists every project's ended sessions in one list, newest first", () => {
        const ended = endedOf([
            session("w-old", { lastactivets: NOW - 9 * MIN }),
            session("l-mid", { projectname: "loom", lastactivets: NOW - 5 * MIN }),
            session("w-new", { lastactivets: NOW - MIN }),
            session("z-newest", { projectname: "zeta", lastactivets: NOW - 10_000 }),
            session("l-old", { projectname: "loom", lastactivets: NOW - 30 * MIN }),
        ]);
        expect(ids(conversationRows(ended, ALL_PROJECTS, 0))).toEqual(["z-newest", "w-new", "l-mid", "w-old", "l-old"]);
    });

    it("keeps each row's own project, which is what its second line names", () => {
        const ended = endedOf([session("w"), session("l", { projectname: "loom", lastactivets: NOW - 2 * MIN })]);
        const rows = conversationRows(ended, ALL_PROJECTS, 0);
        expect(rows.map((r) => (r.kind === "session" ? r.project : r.kind))).toEqual(["waveterm", "loom"]);
    });

    it("narrows to one project, and to nothing for a project with no conversation", () => {
        const ended = endedOf([...solos(2), ...solos(2, "loom", "l")]);
        expect(ids(conversationRows(ended, "loom", 0))).toEqual(["l1", "l2"]);
        expect(ids(conversationRows(ended, "waveterm", 0))).toEqual(["s1", "s2"]);
        expect(conversationRows(ended, "nowhere", 0)).toEqual([]);
    });

    it("is empty when nothing has ended, or the scan has not loaded", () => {
        expect(conversationRows(new Map(), ALL_PROJECTS, 0)).toEqual([]);
        expect(conversationRows(endedSessionsByProject(null, []), ALL_PROJECTS, 0)).toEqual([]);
        expect(conversationRows(new Map([["loom", []]]), ALL_PROJECTS, 0)).toEqual([]);
    });

    it("shows a page then a more row counting the rest", () => {
        const rows = conversationRows(endedOf(solos(25)), ALL_PROJECTS, 0);
        expect(CONVERSATION_PAGE).toBe(20);
        expect(rows).toHaveLength(CONVERSATION_PAGE + 1);
        expect(ids(rows).slice(0, 3)).toEqual(["s1", "s2", "s3"]);
        expect(ids(rows)[CONVERSATION_PAGE - 1]).toBe("s20");
        expect(rows[CONVERSATION_PAGE]).toEqual({ kind: "more", hidden: 5 });
    });

    it("has no more row when everything fits, a page exactly included", () => {
        expect(ids(conversationRows(endedOf(solos(3)), ALL_PROJECTS, 0))).toEqual(["s1", "s2", "s3"]);
        const exact = conversationRows(endedOf(solos(CONVERSATION_PAGE)), ALL_PROJECTS, 0);
        expect(exact).toHaveLength(CONVERSATION_PAGE);
        expect(exact.some((r) => r.kind === "more")).toBe(false);
    });

    it("shows one page more per press and drops the more row once nothing is hidden", () => {
        const ended = endedOf(solos(45));
        const once = conversationRows(ended, ALL_PROJECTS, 1);
        expect(once).toHaveLength(2 * CONVERSATION_PAGE + 1);
        expect(once[once.length - 1]).toEqual({ kind: "more", hidden: 5 });
        const twice = conversationRows(ended, ALL_PROJECTS, 2);
        expect(twice).toHaveLength(45);
        expect(twice.some((r) => r.kind === "more")).toBe(false);
        // pressing past the end changes nothing
        expect(conversationRows(ended, ALL_PROJECTS, 9)).toEqual(twice);
    });

    it("pages the filtered list, not the whole archive", () => {
        const ended = endedOf([...solos(30), ...solos(7, "loom", "l")]);
        expect(ids(conversationRows(ended, "loom", 0))).toEqual(["l1", "l2", "l3", "l4", "l5", "l6", "l7"]);
        const waveterm = conversationRows(ended, "waveterm", 0);
        expect(waveterm[waveterm.length - 1]).toEqual({ kind: "more", hidden: 10 });
    });

    it("reads a press count below zero as none", () => {
        expect(conversationRows(endedOf(solos(25)), ALL_PROJECTS, -3)).toHaveLength(CONVERSATION_PAGE + 1);
    });

    it("breaks a tie on the time by key, whatever order the sessions arrived in", () => {
        const mk = (id: string, project: string) =>
            session(id, { projectname: project, lastactivets: NOW - MIN, transcriptpath: `/t/${project}/${id}.jsonl` });
        const a = mk("a", "zeta");
        const b = mk("b", "alpha");
        const c = mk("c", "mid");
        for (const order of [
            [a, b, c],
            [c, b, a],
            [b, c, a],
            [c, a, b],
        ]) {
            expect(ids(conversationRows(endedOf(order), ALL_PROJECTS, 0))).toEqual(["a", "b", "c"]);
        }
    });

    it("sorts a hand-built map without touching its lists", () => {
        const rowOf = (id: string, at: number): EndedSessionRow => ({
            kind: "session",
            project: "p",
            key: `claude:${id}`,
            title: id,
            tooltip: id,
            lastactivets: at,
            session: { ...session(id), lastactivets: at } as EndedSessionRow["session"],
        });
        const list = [rowOf("old", NOW - 5 * MIN), rowOf("new", NOW - MIN)];
        const ended = new Map([["p", list]]);
        expect(ids(conversationRows(ended, ALL_PROJECTS, 0))).toEqual(["new", "old"]);
        expect(list.map((r) => r.session.id)).toEqual(["old", "new"]);
    });

    it("takes a project named like an Object property for what it is", () => {
        for (const name of ["constructor", "toString", "__proto__", "hasOwnProperty"]) {
            const ended = endedOf([...solos(2, name, "p"), ...solos(1, "loom", "l")]);
            expect(ids(conversationRows(ended, name, 0))).toEqual(["p1", "p2"]);
            expect(ids(conversationRows(ended, "loom", 0))).toEqual(["l1"]);
            expect(ids(conversationRows(ended, ALL_PROJECTS, 0))).toEqual(["l1", "p1", "p2"]);
        }
        // and one that is not there is not read off the Map's or Object's own members
        const ended = endedOf(solos(1));
        for (const name of ["constructor", "toString", "__proto__", "size"]) {
            expect(conversationRows(ended, name, 0)).toEqual([]);
        }
    });
});

describe("conversationProjects", () => {
    it("lists the projects with an ended conversation, the newest conversation first", () => {
        const ended = endedOf([
            session("a", { projectname: "alpha", lastactivets: NOW - 9 * MIN }),
            session("b", { projectname: "beta", lastactivets: NOW - MIN }),
            session("b2", { projectname: "beta", lastactivets: NOW - 20 * MIN }),
            session("g", { projectname: "gamma", lastactivets: NOW - 3 * MIN }),
        ]);
        expect(conversationProjects(ended)).toEqual(["beta", "gamma", "alpha"]);
    });

    it("breaks a tie on the project name, whatever order they arrived in", () => {
        const mk = (project: string) => session(`${project}-1`, { projectname: project, lastactivets: NOW - MIN });
        expect(conversationProjects(endedOf([mk("beta"), mk("alpha")]))).toEqual(["alpha", "beta"]);
        expect(conversationProjects(endedOf([mk("alpha"), mk("beta")]))).toEqual(["alpha", "beta"]);
    });

    it("leaves out a project whose list is empty, and is empty until the scan has loaded", () => {
        expect(conversationProjects(new Map([["loom", []]]))).toEqual([]);
        expect(conversationProjects(endedSessionsByProject(null, []))).toEqual([]);
    });

    it("finds the newest conversation of a list that is not sorted", () => {
        const rowOf = (id: string, at: number) =>
            ({ kind: "session", project: "x", key: id, lastactivets: at }) as EndedSessionRow;
        const ended = new Map([
            ["x", [rowOf("x1", NOW - 9 * MIN), rowOf("x2", NOW - MIN)]],
            ["y", [rowOf("y1", NOW - 5 * MIN)]],
        ]);
        expect(conversationProjects(ended)).toEqual(["x", "y"]);
    });
});

describe("effectiveProject", () => {
    it("keeps no filter, and a project that has conversations", () => {
        expect(effectiveProject(ALL_PROJECTS, ["loom"])).toBe(ALL_PROJECTS);
        expect(effectiveProject("loom", ["loom", "alpha"])).toBe("loom");
    });

    it("falls back to every project when the chosen one has no conversation left or nothing has loaded", () => {
        expect(effectiveProject("loom", ["alpha"])).toBe(ALL_PROJECTS);
        expect(effectiveProject("loom", [])).toBe(ALL_PROJECTS);
    });
});

describe("agentExited", () => {
    it("is true when an id left the roster", () => {
        expect(agentExited(new Set(["a", "b"]), new Set(["a"]))).toBe(true);
    });
    it("is false for a roster that only grew or stayed", () => {
        expect(agentExited(new Set(["a"]), new Set(["a", "b"]))).toBe(false);
        expect(agentExited(new Set(), new Set())).toBe(false);
    });
});

describe("scanDue", () => {
    it("scans on the first arrival", () => {
        expect(scanDue(0, 10_000, "enter")).toBe(true);
    });
    it("reads a last scan of 0 as never scanned, against a real clock", () => {
        expect(scanDue(0, NOW, "enter")).toBe(true);
        expect(scanDue(0, NOW, "exit")).toBe(true);
    });
    it("is due exactly when the gap has passed, not a moment before", () => {
        expect(scanDue(5_000, 10_000, "enter")).toBe(true);
        expect(scanDue(5_001, 10_000, "enter")).toBe(false);
        expect(scanDue(9_000, 10_000, "exit")).toBe(true);
        expect(scanDue(9_001, 10_000, "exit")).toBe(false);
    });
    it("does not rescan on a quick re-entry", () => {
        expect(scanDue(8_000, 10_000, "enter")).toBe(false);
        expect(scanDue(4_000, 10_000, "enter")).toBe(true);
    });
    it("rescans soon after an exit, since the ended session just landed", () => {
        expect(scanDue(8_000, 10_000, "exit")).toBe(true);
        expect(scanDue(9_500, 10_000, "exit")).toBe(false);
    });
});
