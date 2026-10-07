// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { describe, expect, it } from "vitest";
import {
    activeView,
    agentExited,
    ALL_PROJECTS,
    CONVERSATION_PAGE,
    conversationCount,
    conversationProjects,
    conversationTree,
    runsBesideOrigins,
    endedConversationsByProject,
    liveBranches,
    registeredConversations,
    scanDue,
    sessionAgeLabel,
    sessionTitle,
    splitActive,
    startOfDay,
    terminalTree,
    UNTITLED_SESSION,
    type ConversationEntry,
    type ConversationTreeRow,
    type EndedSessionRow,
} from "./agentsidebarmodel";
import type { AgentVM } from "./agentsviewmodel";
import { buildAgentTree, UNGROUPED_PROJECT, type AgentTreeRow } from "./agenttreemodel";

const MIN = 60_000;
const DAY = 24 * 60 * MIN;
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

// an entry as its session id, or "run:<id>" for a run
const entryId = (r: ConversationEntry) => (r.kind === "run" ? `run:${r.group.runId}` : r.session.id);

// the Conversations section as entry ids, a folder row as "folder:<project>", a more row as "more:<project>:<hidden>"
const rowId = (r: ConversationTreeRow) =>
    r.kind === "folder" ? `folder:${r.project}` : r.kind === "more" ? `more:${r.project}:${r.hidden}` : entryId(r);
const rowIds = (rows: ConversationTreeRow[]) => rows.map(rowId);

const treeOf = (agents: AgentVM[]) =>
    buildAgentTree(
        agents,
        agents.map((a) => a.id)
    );
const endedOf = (list: SessionActivity[], roster: AgentVM[] = []) => endedConversationsByProject(list, roster);

describe("sessionTitle", () => {
    it("is the first prompt with its whitespace collapsed", () => {
        expect(sessionTitle("  fix the\n  race   condition ")).toBe("fix the race condition");
    });
    it("falls back for a blank prompt", () => {
        expect(sessionTitle("")).toBe(UNTITLED_SESSION);
        expect(sessionTitle("\n  \n")).toBe(UNTITLED_SESSION);
    });
});

describe("liveBranches", () => {
    it("reads each live agent's branch from the session it is writing", () => {
        const scan = [
            session("s1", { branch: "feat/x" }),
            session("s2", { branch: "" }),
            session("s3", { branch: "main" }),
        ];
        const roster = [
            agent("a1", "/home/u/.claude/projects/home-u-waveterm/s1.jsonl"),
            agent("a2", "/home/u/.claude/projects/home-u-waveterm/s2.jsonl"),
            agent("a3"),
        ];
        // s3 is ended (no agent writes it), a2's session names no branch, a3 has no transcript yet
        expect(liveBranches(scan, roster)).toEqual(new Map([["a1", "feat/x"]]));
    });
    it("is empty until the scan loads", () => {
        expect(liveBranches(null, [agent("a1", "/x.jsonl")]).size).toBe(0);
    });
});

describe("startOfDay", () => {
    const today = startOfDay(NOW);
    it("starts the day at local midnight", () => {
        expect(new Date(today).getHours()).toBe(0);
        expect(today).toBeLessThanOrEqual(NOW);
        expect(NOW - today).toBeLessThan(DAY + 60 * MIN);
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

describe("endedConversationsByProject", () => {
    it("is empty until the scan has loaded", () => {
        expect(endedConversationsByProject(null, []).size).toBe(0);
    });

    it("groups ended sessions by project, newest first", () => {
        const out = endedOf([
            session("old", { lastactivets: NOW - 9 * MIN }),
            session("new", { lastactivets: NOW - MIN }),
            session("other", { projectname: "loom", lastactivets: NOW - 2 * MIN }),
        ]);
        expect([...out.keys()].sort()).toEqual(["loom", "waveterm"]);
        expect(out.get("waveterm")!.map(entryId)).toEqual(["new", "old"]);
    });

    it("breaks a tie on the time by session key, whatever order the scan listed them in", () => {
        const a = session("a", { lastactivets: NOW - MIN });
        const b = session("b", { lastactivets: NOW - MIN });
        const c = session("c", { lastactivets: NOW - MIN });
        const ids = (list: SessionActivity[]) => endedOf(list).get("waveterm")!.map(entryId);
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

    it("folds the sessions an orchestrator run launched into one entry, filed under its lead's project", () => {
        const out = endedOf([
            session("a", { lastactivets: NOW - 5 * MIN }),
            session("lead", { runid: "r1", role: "lead", projectname: "loom", lastactivets: NOW - 9 * MIN }),
            session("w", { runid: "r1", role: "worker", taskid: "t-1", lastactivets: NOW - 2 * MIN }),
        ]);
        expect(out.get("waveterm")!.map(entryId)).toEqual(["a"]);
        const [run] = out.get("loom")!;
        expect(run).toMatchObject({ kind: "run", project: "loom", key: "run:r1", lastactivets: NOW - 2 * MIN });
        expect(run.kind === "run" && run.group.sessions.map((s) => s.id).sort()).toEqual(["lead", "w"]);
    });

    it("files a leadless run under its newest session's project", () => {
        const out = endedOf([
            session("w1", { runid: "r1", taskid: "t-1", projectname: "old", lastactivets: NOW - 9 * MIN }),
            session("w2", { runid: "r1", taskid: "t-2", projectname: "new", lastactivets: NOW - MIN }),
        ]);
        expect([...out.keys()]).toEqual(["new"]);
    });

    it("leaves out a run while any of its sessions is live: Active holds it", () => {
        const w = session("w", { runid: "r1", role: "worker", taskid: "t-1" });
        const lead = session("lead", { runid: "r1", role: "lead" });
        expect(endedOf([w, lead], [agent("t1", w.transcriptpath)]).size).toBe(0);
        expect(endedOf([w, lead]).get("waveterm")!.map(entryId)).toEqual(["run:r1"]);
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
describe("endedConversationsByProject project keys", () => {
    // the engine runs each task in <project>/.waveterm/worktrees/<run id>-<task>, and the scan names the session for that
    // last segment
    const WT = "D:\\projects\\arcterm\\.waveterm\\worktrees\\75a28a71-1888-4c17-8feb-2ec031b5e3a4-t-1";
    const worker = (id: string, over: Partial<SessionActivity> = {}) =>
        session(id, { projectpath: WT, projectname: "75a28a71-1888-4c17-8feb-2ec031b5e3a4-t-1", ...over });

    it("files a session in an engine worktree under the project the tree was made from", () => {
        expect([...endedOf([worker("w")]).keys()]).toEqual(["arcterm"]);
        const ended = endedConversationsByProject([worker("w")], [], { Arc: { path: "d:/projects/arcterm" } });
        expect([...ended.keys()]).toEqual(["Arc"]);
    });

    it("files a leadless run under its workers' project, not their worktree's name", () => {
        const ended = endedConversationsByProject(
            [worker("w1", { runid: "r1", taskid: "t-1" }), worker("w2", { runid: "r1", taskid: "t-2" })],
            [],
            { arcterm: { path: "D:/projects/arcterm" } }
        );
        expect([...ended.keys()]).toEqual(["arcterm"]);
        expect(ended.get("arcterm")!.map(entryId)).toEqual(["run:r1"]);
    });

    it("files a session under the registered project its path belongs to, not under its folder's name", () => {
        const launched = agent("a", undefined, "Arc");
        const ended = endedConversationsByProject(
            [session("s", { projectpath: "D:\\projects\\arcterm", projectname: "arcterm" })],
            [launched],
            { Arc: { path: "d:/projects/arcterm/" } }
        );
        expect([...ended.keys()]).toEqual(["Arc"]);
        // the name the live agent's folder in Active carries
        expect(groupsOf(treeOf([launched]))).toEqual(["Arc"]);
    });

    it("gives a registered project with only ended sessions its registered name", () => {
        const ended = endedConversationsByProject(
            [session("s", { projectpath: "/work/arcterm", projectname: "arcterm" })],
            [],
            { Arc: { path: "/work/arcterm" } }
        );
        expect([...ended.keys()]).toEqual(["Arc"]);
    });

    it("ignores a registered project with no path, and a session with no path", () => {
        const ended = endedConversationsByProject([session("s", { projectpath: "", projectname: "loom" })], [], {
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
        const ended = endedConversationsByProject(
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
        const ended = endedConversationsByProject(
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
        const ended = endedConversationsByProject(
            [session("s", { projectpath: "/elsewhere/loom", projectname: "loom" })],
            [agent("a")],
            { Arc: { path: "/work/arcterm" } }
        );
        expect([...ended.keys()]).toEqual(["loom"]);
    });
});

describe("splitActive", () => {
    const roster = [agent("a"), agent("b"), agent("c", undefined, "loom"), agent("d")];
    const tree = treeOf(roster);

    it("lifts the split's agents out of their folders, in cell order", () => {
        const v = splitActive(tree, ["c", "a"], roster);
        expect(v.split.map((x) => x.id)).toEqual(["c", "a"]);
        expect(labels(v.rows)).toEqual(["group:waveterm", "parent", "parent"]);
        expect(v.rows.flatMap((r) => (r.kind === "parent" ? [r.agent.id] : []))).toEqual(["b", "d"]);
    });
    it("is no split with fewer than two cells", () => {
        expect(splitActive(tree, ["a"], roster)).toEqual({ split: [], rows: tree });
        expect(splitActive(tree, [], roster)).toEqual({ split: [], rows: tree });
    });
    it("skips a cell whose agent left the roster, and drops the split when one agent is left", () => {
        expect(splitActive(tree, ["a", "gone", "b"], roster).split.map((x) => x.id)).toEqual(["a", "b"]);
        expect(splitActive(tree, ["a", "gone"], roster)).toEqual({ split: [], rows: tree });
    });
    it("takes a lifted agent out of its folder's count and asking badge", () => {
        const asking = { ...agent("b"), state: "asking" as const };
        const list = [agent("a"), asking, agent("d")];
        const v = splitActive(treeOf(list), ["b", "c"], [...list, agent("c", undefined, "loom")]);
        expect(v.rows[0]).toMatchObject({ kind: "group", project: "waveterm", count: 2, attn: 0 });
    });
    it("lifts from the whole tree, so a collapsed folder's badge drops too and an emptied one goes", () => {
        const asking = { ...agent("e", undefined, "loom"), state: "asking" as const };
        const list = [...roster, asking];
        const v = splitActive(treeOf(list), ["e", "a"], list);
        const folded = activeView(v.rows, ALL_PROJECTS, new Set(["loom"])).rows;
        expect(labels(folded)).toEqual(["group:waveterm", "parent", "parent", "group:loom"]);
        expect(folded[3]).toMatchObject({ count: 1, attn: 0 });
        // the split emptied loom: collapsed or not, it goes
        const emptied = splitActive(treeOf(roster), ["c", "a"], roster);
        expect(labels(activeView(emptied.rows, ALL_PROJECTS, new Set(["loom"])).rows)).toEqual([
            "group:waveterm",
            "parent",
            "parent",
        ]);
    });
});

describe("activeView", () => {
    const noneCollapsed = new Set<string>();
    const view = (tree: AgentTreeRow[], filter = ALL_PROJECTS, collapsed: ReadonlySet<string> = noneCollapsed) =>
        activeView(tree, filter, collapsed);

    it("is the tree as it is when no project is collapsed", () => {
        const tree = treeOf([agent("a"), agent("b", undefined, "loom")]);
        expect(view(tree).rows).toEqual(tree);
        expect(labels(view(tree).rows)).toEqual(["group:waveterm", "parent", "group:loom", "parent"]);
    });

    it("hides a collapsed project's rows, keeping its folder row", () => {
        const tree = treeOf([agent("a"), agent("b", undefined, "loom")]);
        expect(labels(view(tree, ALL_PROJECTS, new Set(["waveterm"])).rows)).toEqual([
            "group:waveterm",
            "group:loom",
            "parent",
        ]);
        expect(labels(view(tree, ALL_PROJECTS, new Set(["loom"])).rows)).toEqual([
            "group:waveterm",
            "parent",
            "group:loom",
        ]);
        expect(labels(view(tree, ALL_PROJECTS, new Set(["waveterm", "loom"])).rows)).toEqual([
            "group:waveterm",
            "group:loom",
        ]);
    });

    it("keeps the count and attention a collapsed folder row carries", () => {
        const asking: AgentVM = { ...agent("a"), state: "asking" };
        const rows = view(treeOf([asking, agent("b")]), ALL_PROJECTS, new Set(["waveterm"])).rows;
        expect(rows).toHaveLength(1);
        expect(rows[0]).toMatchObject({ kind: "group", project: "waveterm", count: 2, attn: 1 });
    });

    it("ignores a collapsed name no live project has, and is empty with no live agent", () => {
        const tree = treeOf([agent("a")]);
        expect(view(tree, ALL_PROJECTS, new Set(["loom"])).rows).toEqual(tree);
        expect(view([], ALL_PROJECTS, new Set(["loom"]))).toEqual({
            rows: [],
            count: 0,
            elsewhere: { agents: 0, asking: 0 },
        });
    });

    it("counts every folder's agents, a collapsed one included, with nothing elsewhere", () => {
        const tree = treeOf([agent("a"), agent("b"), agent("c", undefined, "loom")]);
        expect(view(tree, ALL_PROJECTS, new Set(["waveterm"]))).toMatchObject({
            count: 3,
            elsewhere: { agents: 0, asking: 0 },
        });
    });

    it("narrows to the chosen project's rows, flat: one project needs no folder row", () => {
        const tree = treeOf([agent("a"), agent("b", undefined, "loom"), agent("c")]);
        const v = view(tree, "waveterm");
        expect(labels(v.rows)).toEqual(["parent", "parent"]);
        expect(v.rows.map((r) => (r.kind === "parent" ? r.agent.id : r.kind))).toEqual(["a", "c"]);
        expect(v.count).toBe(2);
    });

    it("counts the agents a filter hides, and how many of them are asking", () => {
        const asking = (id: string, project: string): AgentVM => ({
            ...agent(id, undefined, project),
            state: "asking",
        });
        const tree = treeOf([agent("a"), asking("b", "loom"), agent("c", undefined, "loom"), asking("d", "zeta")]);
        expect(view(tree, "waveterm").elsewhere).toEqual({ agents: 3, asking: 2 });
        // an agent with no project is in none of them, so a filter hides it too
        expect(view(treeOf([agent("a"), agent("u", undefined, "")]), "waveterm").elsewhere).toEqual({
            agents: 1,
            asking: 0,
        });
    });

    it("unfolds the chosen project even when its folder was collapsed: with no folder row it could not be opened", () => {
        const tree = treeOf([agent("a"), agent("b", undefined, "loom")]);
        expect(labels(view(tree, "waveterm", new Set(["waveterm"])).rows)).toEqual(["parent"]);
    });

    it("is empty for a project with no live agent, which still counts the others", () => {
        const tree = treeOf([agent("a"), agent("b", undefined, "loom")]);
        expect(view(tree, "nowhere")).toEqual({ rows: [], count: 0, elsewhere: { agents: 2, asking: 0 } });
    });
});

describe("runsBesideOrigins", () => {
    const path = (id: string) => `/home/u/.claude/projects/home-u-waveterm/${id}.jsonl`;
    // newest first: the run, an unrelated session, then the session that started the run
    const rows = conversationTree(
        endedOf([
            session("lead", { runid: "r1", role: "lead", lastactivets: NOW - MIN }),
            session("other", { lastactivets: NOW - 2 * MIN }),
            session("origin", { lastactivets: NOW - 3 * MIN }),
        ]),
        ALL_PROJECTS,
        new Set(),
        new Map()
    );

    it("moves a run to just after the session that started it, marked under", () => {
        const out = runsBesideOrigins(rows, new Map([["r1", path("origin")]]));
        expect(rowIds(out)).toEqual(["folder:waveterm", "other", "origin", "run:r1"]);
        expect(out.find((r) => r.kind === "run")).toMatchObject({ under: true });
    });

    it("leaves a run whose session is not shown where it was", () => {
        const out = runsBesideOrigins(rows, new Map([["r1", path("gone")]]));
        expect(out).toEqual(rows);
    });
});

describe("conversationTree", () => {
    const open = new Set<string>();
    const unpressed = new Map<string, number>();
    const tree = (
        ended: ReadonlyMap<string, ConversationEntry[]>,
        filter = ALL_PROJECTS,
        collapsed: ReadonlySet<string> = open,
        presses: ReadonlyMap<string, number> = unpressed
    ) => conversationTree(ended, filter, collapsed, presses);

    it("files each project's ended sessions under its folder, the folder with the newest conversation first", () => {
        const ended = endedOf([
            session("w-old", { lastactivets: NOW - 9 * MIN }),
            session("l-mid", { projectname: "loom", lastactivets: NOW - 5 * MIN }),
            session("w-new", { lastactivets: NOW - MIN }),
            session("z-newest", { projectname: "zeta", lastactivets: NOW - 10_000 }),
            session("l-old", { projectname: "loom", lastactivets: NOW - 30 * MIN }),
        ]);
        expect(rowIds(tree(ended))).toEqual([
            "folder:zeta",
            "z-newest",
            "folder:waveterm",
            "w-new",
            "w-old",
            "folder:loom",
            "l-mid",
            "l-old",
        ]);
    });

    it("counts a folder's conversations and those waiting on you, and says whether it is open", () => {
        const ended = endedOf([
            session("a", { status: "waiting" }),
            session("b", { lastactivets: NOW - 2 * MIN }),
            session("c", { projectname: "loom", lastactivets: NOW - 5 * MIN }),
        ]);
        expect(tree(ended).filter((r) => r.kind === "folder")).toEqual([
            { kind: "folder", project: "waveterm", count: 2, attn: 1, open: true },
            { kind: "folder", project: "loom", count: 1, attn: 0, open: true },
        ]);
    });

    it("folds a collapsed project to its folder row, which keeps its count", () => {
        const ended = endedOf([...solos(2), ...solos(2, "zeta", "l")]);
        const rows = tree(ended, ALL_PROJECTS, new Set(["waveterm"]));
        expect(rowIds(rows)).toEqual(["folder:waveterm", "folder:zeta", "l1", "l2"]);
        expect(rows[0]).toEqual({ kind: "folder", project: "waveterm", count: 2, attn: 0, open: false });
    });

    it("narrows to the chosen project, flat, and to nothing for a project with no conversation", () => {
        const ended = endedOf([...solos(2), ...solos(2, "loom", "l")]);
        expect(rowIds(tree(ended, "loom"))).toEqual(["l1", "l2"]);
        expect(rowIds(tree(ended, "waveterm"))).toEqual(["s1", "s2"]);
        // the app bar offers every registered project, not only those with a conversation: the list stays empty
        expect(tree(ended, "nowhere")).toEqual([]);
    });

    it("unfolds the chosen project even when its folder was collapsed, and pages it", () => {
        const ended = endedOf([...solos(14), ...solos(2, "loom", "l")]);
        const rows = tree(ended, "waveterm", new Set(["waveterm"]));
        expect(rowIds(rows)).toEqual([
            ...rowIds(tree(ended, "waveterm")).slice(0, CONVERSATION_PAGE),
            "more:waveterm:4",
        ]);
        expect(rowIds(tree(ended, "waveterm", open, new Map([["waveterm", 1]])))).toHaveLength(14);
    });

    it("is empty when nothing has ended, or the scan has not loaded", () => {
        expect(tree(new Map())).toEqual([]);
        expect(tree(endedConversationsByProject(null, []))).toEqual([]);
        expect(tree(new Map([["loom", []]]))).toEqual([]);
    });

    it("shows a page of each project then a more row counting the rest", () => {
        expect(CONVERSATION_PAGE).toBe(10);
        const rows = tree(endedOf([...solos(14), ...solos(3, "zeta", "l")]));
        const ids = rowIds(rows);
        expect(ids[0]).toBe("folder:waveterm");
        expect(ids.slice(1, 4)).toEqual(["s1", "s2", "s3"]);
        expect(ids[CONVERSATION_PAGE]).toBe("s10");
        expect(rows[CONVERSATION_PAGE + 1]).toEqual({ kind: "more", project: "waveterm", hidden: 4 });
        expect(ids.slice(CONVERSATION_PAGE + 2)).toEqual(["folder:zeta", "l1", "l2", "l3"]);
    });

    it("has no more row when everything fits, a page exactly included", () => {
        expect(rowIds(tree(endedOf(solos(3))))).toEqual(["folder:waveterm", "s1", "s2", "s3"]);
        const exact = tree(endedOf(solos(CONVERSATION_PAGE)));
        expect(exact).toHaveLength(CONVERSATION_PAGE + 1);
        expect(exact.some((r) => r.kind === "more")).toBe(false);
    });

    it("shows one page more per press of that project, and drops the more row once nothing is hidden", () => {
        const ended = endedOf([...solos(25), ...solos(12, "zeta", "l")]);
        const inWaveterm = (rows: ConversationTreeRow[]) =>
            rows.filter((r) => r.kind !== "folder" && r.project === "waveterm");
        const once = tree(ended, ALL_PROJECTS, open, new Map([["waveterm", 1]]));
        expect(inWaveterm(once)).toHaveLength(2 * CONVERSATION_PAGE + 1);
        expect(inWaveterm(once).at(-1)).toEqual({ kind: "more", project: "waveterm", hidden: 5 });
        // zeta was not pressed, so it still shows one page
        expect(once.at(-1)).toEqual({ kind: "more", project: "zeta", hidden: 2 });
        const twice = tree(ended, ALL_PROJECTS, open, new Map([["waveterm", 2]]));
        expect(inWaveterm(twice)).toHaveLength(25);
        expect(inWaveterm(twice).some((r) => r.kind === "more")).toBe(false);
        // pressing past the end changes nothing
        expect(tree(ended, ALL_PROJECTS, open, new Map([["waveterm", 9]]))).toEqual(twice);
    });

    it("reads a press count below zero as none", () => {
        const rows = tree(endedOf(solos(25)), ALL_PROJECTS, open, new Map([["waveterm", -3]]));
        expect(rows).toHaveLength(CONVERSATION_PAGE + 2);
    });

    it("breaks a tie on the time by key within a folder, and between folders by name, whatever the input order", () => {
        const mk = (id: string, project: string) =>
            session(id, { projectname: project, lastactivets: NOW - MIN, transcriptpath: `/t/${project}/${id}.jsonl` });
        const a = mk("a", "zeta");
        const b = mk("b", "alpha");
        const c = mk("c", "alpha");
        for (const order of [
            [a, b, c],
            [c, b, a],
            [b, c, a],
            [c, a, b],
        ]) {
            expect(rowIds(tree(endedOf(order)))).toEqual(["folder:alpha", "b", "c", "folder:zeta", "a"]);
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
        expect(rowIds(tree(ended))).toEqual(["folder:p", "new", "old"]);
        expect(list.map(entryId)).toEqual(["old", "new"]);
    });

    it("takes a project named like an Object property for what it is", () => {
        for (const name of ["constructor", "toString", "__proto__", "hasOwnProperty"]) {
            const ended = endedOf([...solos(2, name, "p"), ...solos(1, "loom", "l")]);
            expect(rowIds(tree(ended, name))).toEqual(["p1", "p2"]);
            expect(rowIds(tree(ended, "loom"))).toEqual(["l1"]);
            // the two folders tie on time, so their order is the names'; what matters is that only this one folded
            const folded = rowIds(tree(ended, ALL_PROJECTS, new Set([name])));
            expect([...folded].sort()).toEqual([`folder:${name}`, "folder:loom", "l1"].sort());
            expect(rowIds(tree(ended, ALL_PROJECTS, open, new Map([[name, 0]])))).toHaveLength(5);
        }
        // and one that is not there is not read off the Map's or Object's own members
        const ended = endedOf(solos(1));
        for (const name of ["constructor", "toString", "__proto__", "size"]) {
            expect(tree(ended, name)).toEqual([]);
        }
    });
});

describe("conversationCount", () => {
    it("counts the ended conversations the filter keeps", () => {
        const ended = endedOf([...solos(3), ...solos(2, "loom", "l")]);
        expect(conversationCount(ended, ALL_PROJECTS)).toBe(5);
        expect(conversationCount(ended, "loom")).toBe(2);
        expect(conversationCount(ended, "nowhere")).toBe(0);
        expect(conversationCount(endedConversationsByProject(null, []), ALL_PROJECTS)).toBe(0);
    });
});

describe("registeredConversations", () => {
    it("keeps the folders of projects added to arcterm and counts the rest for History", () => {
        const ended = endedOf([...solos(3), ...solos(2, "loom", "l"), ...solos(4, "website", "w")]);
        const { ended: kept, elsewhere } = registeredConversations(ended, {
            waveterm: { path: "/p" },
            loom: { path: "/loom" },
        });
        expect([...kept.keys()].sort()).toEqual(["loom", "waveterm"]);
        expect(elsewhere).toBe(4);
        expect(conversationCount(kept, ALL_PROJECTS)).toBe(5);
    });

    it("keeps every folder while nothing is registered", () => {
        const ended = endedOf([...solos(3), ...solos(2, "loom", "l")]);
        const { ended: kept, elsewhere } = registeredConversations(ended, {});
        expect(kept.size).toBe(2);
        expect(elsewhere).toBe(0);
    });
});

describe("terminalTree", () => {
    const term = (id: string, project = "waveterm"): AgentVM => ({
        ...agent(id, undefined, project),
        kind: "terminal",
    });
    const shape = (rows: ReturnType<typeof terminalTree>) =>
        rows.map((r) => (r.kind === "folder" ? `folder:${r.project}:${r.count}:${r.open}` : r.terminal.id));

    it("files each terminal under its project's folder, the projects in the roster's order", () => {
        const rows = terminalTree([term("t1"), term("t2", "loom"), term("t3")], ALL_PROJECTS, new Set());
        expect(shape(rows)).toEqual(["folder:waveterm:2:true", "t1", "t3", "folder:loom:1:true", "t2"]);
    });

    it("folds a collapsed project to its folder row, which keeps its count", () => {
        const rows = terminalTree([term("t1"), term("t2", "loom")], ALL_PROJECTS, new Set(["waveterm"]));
        expect(shape(rows)).toEqual(["folder:waveterm:1:false", "folder:loom:1:true", "t2"]);
    });

    it("files a terminal with no project under ungrouped, like an agent with none", () => {
        expect(shape(terminalTree([term("t1", "")], ALL_PROJECTS, new Set()))).toEqual([
            `folder:${UNGROUPED_PROJECT}:1:true`,
            "t1",
        ]);
    });

    it("narrows to the chosen project's terminals, flat and unfolded, keeping one that names no project", () => {
        const terminals = [term("t1"), term("t2", "loom"), term("u", ""), term("t3")];
        expect(shape(terminalTree(terminals, "waveterm", new Set(["waveterm"])))).toEqual(["t1", "u", "t3"]);
        expect(shape(terminalTree(terminals, "zeta", new Set()))).toEqual(["u"]);
    });

    it("is empty with no terminal", () => {
        expect(terminalTree([], ALL_PROJECTS, new Set(["waveterm"]))).toEqual([]);
        expect(terminalTree([], "waveterm", new Set())).toEqual([]);
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
        expect(conversationProjects(endedConversationsByProject(null, []))).toEqual([]);
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
