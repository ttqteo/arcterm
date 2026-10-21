// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { describe, expect, it } from "vitest";
import { placementFor, type ProjectGrids } from "./agentgrid";
import {
    agentDigits,
    agentExited,
    agentsElsewhere,
    ALL_PROJECTS,
    collidingTitles,
    CONVERSATION_PAGE,
    conversationCount,
    conversationProjects,
    conversationTree,
    endedConversationsByProject,
    folderBlocks,
    folderCounts,
    HOME_PROJECT,
    liveBranches,
    notableBranch,
    projectLabel,
    projectTree,
    registeredConversations,
    rosterSessionKeys,
    runTokens,
    scanDue,
    sessionAgeLabel,
    sessionTitle,
    startedLabel,
    startOfDay,
    terminalPlace,
    terminalRowState,
    terminalShows,
    treeNavIds,
    UNTITLED_SESSION,
    type ConversationEntry,
    type ConversationTreeRow,
    type EndedSessionRow,
    type ProjectTreeRow,
} from "./agentsidebarmodel";
import type { AgentVM } from "./agentsviewmodel";
import { buildAgentTree, UNGROUPED_PROJECT, type AgentTreeRow } from "./agenttreemodel";
import { queuedRows } from "./runqueuemodel";
import { treeServiceInput } from "./servicesmodel";

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

describe("notableBranch", () => {
    it("names a branch other than the default", () => {
        expect(notableBranch("feat/quota-guard")).toBe("feat/quota-guard");
        expect(notableBranch(" wave/run-1 ")).toBe("wave/run-1");
    });

    it("is undefined for main, master, a detached HEAD or none", () => {
        expect(notableBranch("main")).toBeUndefined();
        expect(notableBranch("master")).toBeUndefined();
        expect(notableBranch("HEAD")).toBeUndefined();
        expect(notableBranch("")).toBeUndefined();
        expect(notableBranch(undefined)).toBeUndefined();
    });
});

describe("runTokens", () => {
    it("adds up the tokens of every session of the run", () => {
        const group = {
            sessions: [
                session("lead", { tokenstotal: 4_000_000 }),
                session("w1", { tokenstotal: 2_500_000 }),
                session("w2"),
            ],
        } as unknown as Parameters<typeof runTokens>[0];
        expect(runTokens(group)).toBe(6_500_000);
    });
});

describe("startedLabel", () => {
    it("reads the clock alone for a session started today", () => {
        const today = new Date(NOW);
        today.setHours(9, 5, 0, 0);
        expect(startedLabel(today.getTime(), Math.max(NOW, today.getTime()))).toBe("started 09:05");
    });

    it("adds the date for one started before today", () => {
        const earlier = new Date(startOfDay(NOW) - DAY);
        earlier.setHours(14, 30, 0, 0);
        const date = earlier.toLocaleDateString("en-US", { month: "short", day: "numeric" });
        expect(startedLabel(earlier.getTime(), NOW)).toBe(`started ${date} 14:30`);
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

    it("files a run in the shared tree root under the checkout wavesrv names, not the tree's key", () => {
        // <cache>/arc-wt/<key>: the path names no project, so wavesrv sends the run's checkout as projectroot
        const shared = (id: string, key: string, over: Partial<SessionActivity> = {}) =>
            session(id, {
                projectpath: `C:\\Users\\me\\AppData\\Local\\arc-wt\\${key}`,
                projectname: key,
                projectroot: "D:\\projects\\arcterm\\",
                ...over,
            });
        const runs = [
            shared("lead", "75a28a71", { runid: "r1", role: "lead" }),
            shared("w1", "75a28a71-t-1", { runid: "r1", taskid: "t-1" }),
        ];
        expect([...endedOf(runs).keys()]).toEqual(["arcterm"]);
        const ended = endedConversationsByProject(runs, [], { Arc: { path: "d:/projects/arcterm" } });
        expect([...ended.keys()]).toEqual(["Arc"]);
        expect(ended.get("Arc")!.map(entryId)).toEqual(["run:r1"]);
        // with no projectroot (a run this store never saw) it keeps the tree's key, as before
        expect([...endedOf([shared("x", "9f00aa11-t-2", { projectroot: undefined })]).keys()]).toEqual([
            "9f00aa11-t-2",
        ]);
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

describe("agentsElsewhere", () => {
    const asking = (id: string, project: string): AgentVM => ({ ...agent(id, undefined, project), state: "asking" });

    it("counts nothing with no filter", () => {
        const tree = treeOf([agent("a"), agent("b", undefined, "loom")]);
        expect(agentsElsewhere(tree, ALL_PROJECTS)).toEqual({ agents: 0, asking: 0 });
        expect(agentsElsewhere([], ALL_PROJECTS)).toEqual({ agents: 0, asking: 0 });
    });

    it("counts the agents a filter hides, and how many of them are asking", () => {
        const tree = treeOf([agent("a"), asking("b", "loom"), agent("c", undefined, "loom"), asking("d", "zeta")]);
        expect(agentsElsewhere(tree, "waveterm")).toEqual({ agents: 3, asking: 2 });
        // an agent with no project is in none of them, so a filter hides it too
        expect(agentsElsewhere(treeOf([agent("a"), agent("u", undefined, "")]), "waveterm")).toEqual({
            agents: 1,
            asking: 0,
        });
    });

    it("counts every other project for a project with no live agent", () => {
        const tree = treeOf([agent("a"), agent("b", undefined, "loom")]);
        expect(agentsElsewhere(tree, "nowhere")).toEqual({ agents: 2, asking: 0 });
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
        const pressed = rowIds(tree(ended, "waveterm", open, new Map([["waveterm", 1]])));
        // every one of the 14, then Show less alone
        expect(pressed).toHaveLength(15);
        expect(pressed.at(-1)).toBe("more:waveterm:0");
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
        expect(rows[CONVERSATION_PAGE + 1]).toEqual({ kind: "more", project: "waveterm", hidden: 4, less: false });
        expect(ids.slice(CONVERSATION_PAGE + 2)).toEqual(["folder:zeta", "l1", "l2", "l3"]);
    });

    it("has no more row when everything fits, a page exactly included", () => {
        expect(rowIds(tree(endedOf(solos(3))))).toEqual(["folder:waveterm", "s1", "s2", "s3"]);
        const exact = tree(endedOf(solos(CONVERSATION_PAGE)));
        expect(exact).toHaveLength(CONVERSATION_PAGE + 1);
        expect(exact.some((r) => r.kind === "more")).toBe(false);
    });

    it("shows one page more per press of that project, and keeps only Show less once nothing is hidden", () => {
        const ended = endedOf([...solos(25), ...solos(12, "zeta", "l")]);
        const inWaveterm = (rows: ConversationTreeRow[]) =>
            rows.filter((r) => r.kind !== "folder" && r.project === "waveterm");
        const once = tree(ended, ALL_PROJECTS, open, new Map([["waveterm", 1]]));
        expect(inWaveterm(once)).toHaveLength(2 * CONVERSATION_PAGE + 1);
        expect(inWaveterm(once).at(-1)).toEqual({ kind: "more", project: "waveterm", hidden: 5, less: true });
        // zeta was not pressed, so it still shows one page
        expect(once.at(-1)).toEqual({ kind: "more", project: "zeta", hidden: 2, less: false });
        const twice = tree(ended, ALL_PROJECTS, open, new Map([["waveterm", 2]]));
        expect(inWaveterm(twice)).toHaveLength(26);
        expect(inWaveterm(twice).at(-1)).toEqual({ kind: "more", project: "waveterm", hidden: 0, less: true });
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

    it("keeps a list's order, so a session laterFirst put ahead stays above Show more", () => {
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
        expect(rowIds(tree(ended))).toEqual(["folder:p", "old", "new"]);
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

describe("collidingTitles", () => {
    it("marks the shown sessions of a project whose title another of them has", () => {
        const ended = endedConversationsByProject(
            [
                session("a", { task: "Same title", lastactivets: NOW - MIN }),
                session("b", { task: "Same   title", lastactivets: NOW - 2 * MIN }),
                session("c", { task: "Other", lastactivets: NOW - 3 * MIN }),
            ],
            []
        );
        const rows = conversationTree(ended, ALL_PROJECTS, new Set(), new Map());
        expect([...collidingTitles(rows)].sort()).toEqual(
            rows
                .filter((r) => r.kind === "session" && r.title === "Same title")
                .map((r) => (r as EndedSessionRow).key)
                .sort()
        );
        expect(collidingTitles(rows).size).toBe(2);
    });

    it("does not mark the same title in two projects", () => {
        const ended = endedConversationsByProject(
            [
                session("a", { task: "Same", projectname: "waveterm" }),
                session("b", { task: "Same", projectname: "loom", transcriptpath: "/t/loom/b.jsonl" }),
            ],
            []
        );
        expect(collidingTitles(conversationTree(ended, ALL_PROJECTS, new Set(), new Map())).size).toBe(0);
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

describe("projectTree", () => {
    // null names no project (a default parameter would swallow undefined)
    const term = (id: string, project: string | null = "waveterm", cwd?: string): AgentVM => ({
        ...agent(id, undefined, project ?? ""),
        kind: "terminal",
        ...(project === null ? { project: undefined } : {}),
        ...(cwd != null ? { cwd } : {}),
    });
    // a row as a short string: "group:<project>:<agents>a:<terminals>t[:closed]", "divider:<project>", "t:<id>",
    // "a:<id>" for a plain agent row, "q:<entry id>:<place>" for a queued entry (place "-" when blocked)
    const shape = (rows: ProjectTreeRow[]) =>
        rows.map((r) => {
            switch (r.kind) {
                case "group":
                    return `group:${r.project}:${r.agents}a:${r.terminals}t${r.open ? "" : ":closed"}`;
                case "divider":
                    return `divider:${r.project}`;
                case "terminal":
                    return `t:${r.terminal.id}`;
                case "parent":
                    return `a:${r.agent.id}`;
                case "queuedentry":
                    return `q:${r.entry.id}:${r.place ?? "-"}`;
                case "split":
                    return `split:${r.project}:${r.shown ? "shown" : "saved"}:${r.cells.map((c) => c.id).join(",")}`;
                default:
                    return r.kind;
            }
        });
    const build = (agents: AgentVM[], terminals: AgentVM[], over: Partial<Parameters<typeof projectTree>[0]> = {}) =>
        projectTree({
            tree: treeOf(agents),
            terminals,
            filter: ALL_PROJECTS,
            collapsed: [],
            roots: new Map(),
            ...over,
        });

    it("lists a project's agents, a divider, then its terminals in the order given", () => {
        const rows = build([agent("a"), agent("b", undefined, "loom")], [term("t1"), term("t2", "loom"), term("t3")]);
        expect(shape(rows)).toEqual([
            "group:waveterm:1a:2t",
            "a:a",
            "divider:waveterm",
            "t:t1",
            "t:t3",
            "group:loom:1a:1t",
            "a:b",
            "divider:loom",
            "t:t2",
        ]);
    });

    it("has no divider for a project with no terminals", () => {
        expect(shape(build([agent("a")], []))).toEqual(["group:waveterm:1a:0t", "a:a"]);
    });

    it("gives a project with only terminals a group row and its terminals, after the agents' projects", () => {
        const rows = build([agent("a")], [term("t1", "ops"), term("t2", "ops")]);
        expect(shape(rows)).toEqual(["group:waveterm:1a:0t", "a:a", "group:ops:0a:2t", "t:t1", "t:t2"]);
    });

    it("files a terminal with no project under Home, last", () => {
        const rows = build([agent("a")], [term("h", null), term("t1", "ops"), term("t2")]);
        expect(shape(rows)).toEqual([
            "group:waveterm:1a:1t",
            "a:a",
            "divider:waveterm",
            "t:t2",
            "group:ops:0a:1t",
            "t:t1",
            `group:${HOME_PROJECT}:0a:1t`,
            "t:h",
        ]);
        // a blank project is no project either
        expect(shape(build([], [term("h", "")]))).toEqual([`group:${HOME_PROJECT}:0a:1t`, "t:h"]);
    });

    it("folds a project to its group row, which keeps the agent and terminal counts", () => {
        const rows = build([agent("a"), agent("b", undefined, "loom")], [term("t1"), term("t2")], {
            collapsed: ["waveterm"],
        });
        expect(shape(rows)).toEqual(["group:waveterm:1a:2t:closed", "group:loom:1a:0t", "a:b"]);
        // Home folds like any project
        expect(shape(build([], [term("h", null)], { collapsed: [HOME_PROJECT] }))).toEqual([
            `group:${HOME_PROJECT}:0a:1t:closed`,
        ]);
    });

    it("carries the agents waiting on you into the group row", () => {
        const asking = { ...agent("a"), state: "asking" as const };
        const rows = build([asking, agent("b")], [term("t1")], { collapsed: ["waveterm"] });
        expect(rows[0]).toMatchObject({ kind: "group", agents: 2, terminals: 1, attn: 1, open: false });
    });

    it("narrows to one project's rows with no group row, keeping a terminal that names no project", () => {
        const agents = [agent("a"), agent("b", undefined, "loom")];
        const terminals = [term("t1"), term("h", null), term("t2", "loom"), term("t3")];
        // the fold does not apply to a filtered project
        const rows = build(agents, terminals, { filter: "waveterm", collapsed: ["waveterm"] });
        expect(shape(rows)).toEqual(["a:a", "divider:waveterm", "t:t1", "t:h", "t:t3"]);
        expect(shape(build(agents, terminals, { filter: "zeta" }))).toEqual(["t:h"]);
        expect(shape(build(agents, [term("t2", "loom")], { filter: "zeta" }))).toEqual([]);
    });

    describe("services", () => {
        const svc = (id: string, project = "waveterm", tabId?: string) => ({
            id,
            name: id,
            project,
            ...(tabId != null ? { tabId } : {}),
        });
        // the shape above, with a service row as "s:<id>"
        const shapeS = (rows: ProjectTreeRow[]) =>
            rows.map((r) => (r.kind === "service" ? `s:${r.serviceId}` : shape([r])[0]));

        it("services after divider", () => {
            const rows = build([agent("a")], [term("t1")], { services: [svc("web")] });
            expect(shapeS(rows)).toEqual(["group:waveterm:1a:1t", "a:a", "divider:waveterm", "s:web", "t:t1"]);
        });

        it("service tab is not a terminal row", () => {
            const rows = build([agent("a")], [term("tab-web"), term("t1")], {
                services: [svc("web", "waveterm", "tab-web")],
            });
            expect(shapeS(rows)).toEqual(["group:waveterm:1a:1t", "a:a", "divider:waveterm", "s:web", "t:t1"]);
            expect(rows.find((r) => r.kind === "service")).toMatchObject({ tabId: "tab-web" });
        });

        it("folder with only a service", () => {
            const rows = build([], [], { services: [svc("web", "ops")] });
            expect(rows.map((r) => r.kind)).toEqual(["group", "service"]);
            expect(rows[0]).toMatchObject({ kind: "group", project: "ops", agents: 0, terminals: 0, open: true });
        });

        it("service without a tab still has a row", () => {
            const rows = build([agent("a")], [], { services: [svc("web")] });
            const row = rows.find((r) => r.kind === "service");
            expect(row).toMatchObject({ kind: "service", project: "waveterm", serviceId: "web" });
            expect(row && "tabId" in row ? row.tabId : undefined).toBeUndefined();
        });

        it("files a service of Home under the Home folder, last", () => {
            const rows = build([agent("a")], [term("h", null)], { services: [svc("web", "Home")] });
            expect(shapeS(rows)).toEqual([
                "group:waveterm:1a:0t",
                "a:a",
                `group:${HOME_PROJECT}:0a:1t`,
                "s:web",
                "t:h",
            ]);
        });

        it("filter matches a service name", () => {
            // the project filter keeps the filtered project's services, after the divider and before its terminals
            const services = [svc("web"), svc("api", "loom")];
            const rows = build([agent("a")], [term("t1")], { services, filter: "waveterm" });
            expect(shapeS(rows)).toEqual(["a:a", "divider:waveterm", "s:web", "t:t1"]);
            expect(build([], [], { services, filter: "loom" }).map((r) => r.kind)).toEqual(["service"]);
            expect(build([], [], { services, filter: "zeta" })).toEqual([]);
        });

        it("folds a project's services with the rest of its rows", () => {
            const rows = build([agent("a")], [], { services: [svc("web")], collapsed: ["waveterm"] });
            expect(rows.map((r) => r.kind)).toEqual(["group"]);
        });

        describe("a sleeping service (treeServiceInput)", () => {
            const status = (state: string, project = "ops"): ServiceStatus => ({
                id: "web",
                name: "web",
                command: "npm run dev",
                dir: "~/ops",
                project,
                state,
                autostart: false,
                tabid: "tab-web",
            });

            it("has no row, no terminal row for its tab, and leaves no folder that holds nothing else", () => {
                const rows = build(
                    [agent("a")],
                    [term("tab-web", "ops")],
                    treeServiceInput([status("sleeping")], null)
                );
                expect(shapeS(rows)).toEqual(["group:waveterm:1a:0t", "a:a"]);
            });

            it("is a row, in its folder, while it runs", () => {
                const rows = build([agent("a")], [term("tab-web", "ops")], treeServiceInput([status("running")], null));
                expect(shapeS(rows)).toEqual(["group:waveterm:1a:0t", "a:a", "group:ops:0a:0t", "s:web"]);
            });

            it("keeps the folder of the project's agents, with no divider for a row that is not there", () => {
                const rows = build(
                    [agent("a")],
                    [term("tab-web", "waveterm")],
                    treeServiceInput([status("sleeping", "waveterm")], null)
                );
                expect(shapeS(rows)).toEqual(["group:waveterm:1a:0t", "a:a"]);
            });

            it("stays a row while its tab is the selected one", () => {
                const rows = build(
                    [agent("a")],
                    [term("tab-web", "ops")],
                    treeServiceInput([status("sleeping")], "tab-web")
                );
                expect(shapeS(rows)).toEqual(["group:waveterm:1a:0t", "a:a", "group:ops:0a:0t", "s:web"]);
            });

            it("hides its tab's terminal under a project filter too", () => {
                const rows = build([agent("a")], [term("tab-web", "waveterm"), term("t1")], {
                    ...treeServiceInput([status("sleeping", "waveterm")], null),
                    filter: "waveterm",
                });
                expect(shapeS(rows)).toEqual(["a:a", "divider:waveterm", "t:t1"]);
            });
        });

        it("keeps services in the order given, and adds nothing when there are none", () => {
            expect(shapeS(build([agent("a")], [], { services: [svc("web"), svc("api")] }))).toEqual([
                "group:waveterm:1a:0t",
                "a:a",
                "divider:waveterm",
                "s:web",
                "s:api",
            ]);
            expect(shapeS(build([agent("a")], [], { services: [] }))).toEqual(["group:waveterm:1a:0t", "a:a"]);
        });
    });

    it("names where a terminal runs when it is not at its project's root", () => {
        const roots = new Map([["waveterm", "D:\\code\\waveterm\\"]]);
        const rows = build(
            [agent("a")],
            [
                term("at", "waveterm", "d:/code/waveterm"),
                term("wt", "waveterm", "D:\\code\\waveterm\\.waveterm\\worktrees\\fix-login-agent"),
                term("home", null, "C:\\Users\\u"),
                term("unreg", "ops", "C:\\ops\\x"),
            ],
            { roots }
        );
        const places = rows.flatMap((r) => (r.kind === "terminal" ? [[r.terminal.id, r.place]] : []));
        expect(places).toEqual([
            ["at", undefined],
            ["wt", "fix-login-agent"],
            ["unreg", undefined],
            ["home", undefined],
        ]);
    });

    it("leaves every row where it is: the surface's split takes nothing out of its folder", () => {
        // what the tree reads does not depend on the grid at all; the rows of the split's cells carry a mark instead
        const rows = build([agent("a1"), agent("b", undefined, "loom")], [term("t1"), term("h", null)]);
        expect(shape(rows)).toEqual([
            "group:waveterm:1a:1t",
            "a:a1",
            "divider:waveterm",
            "t:t1",
            "group:loom:1a:0t",
            "a:b",
            `group:${HOME_PROJECT}:0a:1t`,
            "t:h",
        ]);
    });
    describe("queued entries", () => {
        const qe = (id: string, projectpath = "/code/waveterm", over: Partial<RunQueueEntry> = {}): RunQueueEntry => ({
            id,
            title: `Plan ${id}`,
            projectpath,
            queuedts: NOW,
            state: "waiting",
            data: { channelid: "ch", workspaceid: "ws", goal: "g", runtime: "claude" },
            ...over,
        });
        const queued = (...entries: RunQueueEntry[]) => queuedRows(entries, {});

        it("puts a project's queued rows after its agent rows and before its divider and terminals", () => {
            const rows = build([agent("a"), agent("b", undefined, "loom")], [term("t1")], {
                queue: queued(qe("q-1"), qe("q-2", "/code/loom"), qe("q-3")),
            });
            expect(shape(rows)).toEqual([
                "group:waveterm:1a:1t",
                "a:a",
                "q:q-1:1",
                "q:q-3:3",
                "divider:waveterm",
                "t:t1",
                "group:loom:1a:0t",
                "a:b",
                "q:q-2:2",
            ]);
        });

        it("gives a project with only queued entries a folder, after the agents' projects and before Home", () => {
            const rows = build([agent("a")], [term("h", null)], { queue: queued(qe("q-1", "/code/ops")) });
            expect(shape(rows)).toEqual([
                "group:waveterm:1a:0t",
                "a:a",
                "group:ops:0a:0t",
                "q:q-1:1",
                `group:${HOME_PROJECT}:0a:1t`,
                "t:h",
            ]);
        });

        it("does not count the queued entries as the folder's agents", () => {
            const rows = build([agent("a")], [], { queue: queued(qe("q-1"), qe("q-2")) });
            expect(rows[0]).toMatchObject({ kind: "group", project: "waveterm", agents: 1, terminals: 0 });
        });

        it("hides a collapsed project's queued rows with the rest of its rows", () => {
            const rows = build([agent("a")], [term("t1")], { queue: queued(qe("q-1")), collapsed: ["waveterm"] });
            expect(shape(rows)).toEqual(["group:waveterm:1a:1t:closed"]);
            // a folder holding only queued entries folds too, to its group row
            expect(shape(build([], [], { queue: queued(qe("q-1", "/code/ops")), collapsed: ["ops"] }))).toEqual([
                "group:ops:0a:0t:closed",
            ]);
        });

        it("separates a project's terminals from its queued rows with the divider, as it does from its agents", () => {
            const rows = build([], [term("t1")], { queue: queued(qe("q-1")) });
            expect(shape(rows)).toEqual(["group:waveterm:0a:1t", "q:q-1:1", "divider:waveterm", "t:t1"]);
        });

        it("shows a blocked entry with no place, in queue order", () => {
            const rows = build([agent("a")], [], {
                queue: queued(qe("q-1", "/code/waveterm", { state: "blocked", reason: "x" }), qe("q-2")),
            });
            expect(shape(rows)).toEqual(["group:waveterm:1a:0t", "a:a", "q:q-1:-", "q:q-2:1"]);
        });

        it("narrows to the filtered project's queued rows, after its agent rows and before its terminals", () => {
            const queue = queued(qe("q-1"), qe("q-2", "/code/loom"));
            const agents = [agent("a"), agent("b", undefined, "loom")];
            expect(shape(build(agents, [term("t1")], { filter: "waveterm", queue }))).toEqual([
                "a:a",
                "q:q-1:1",
                "divider:waveterm",
                "t:t1",
            ]);
            expect(shape(build(agents, [], { filter: "zeta", queue }))).toEqual([]);
        });

        it("leaves the tree as it was with no queue given", () => {
            expect(shape(build([agent("a")], [term("t1")]))).toEqual(
                shape(build([agent("a")], [term("t1")], { queue: [] }))
            );
        });
    });

    describe("splits", () => {
        const grids = (project: string | null, all: Record<string, string[]>) => ({
            project,
            grids: Object.fromEntries(Object.entries(all).map(([p, ids]) => [p, { ids, focused: ids[0] }])),
        });
        const withSplits = (agents: AgentVM[], terminals: AgentVM[], splits: ProjectGrids, over = {}) =>
            build(agents, terminals, { splits, roster: [...agents, ...terminals], ...over });

        it("puts one split row where the topmost cell's row was, and drops the cells' rows", () => {
            const rows = withSplits(
                [agent("a"), agent("b"), agent("c")],
                [term("t1")],
                grids("waveterm", { waveterm: ["c", "a"] })
            );
            expect(shape(rows)).toEqual([
                "group:waveterm:3a:1t",
                "split:waveterm:shown:c,a",
                "a:b",
                "divider:waveterm",
                "t:t1",
            ]);
        });

        it("takes an agent and a terminal together, and drops a divider left with nothing on one side", () => {
            const rows = withSplits([agent("a")], [term("t1")], grids("waveterm", { waveterm: ["a", "t1"] }));
            expect(shape(rows)).toEqual(["group:waveterm:1a:1t", "split:waveterm:shown:a,t1"]);
        });

        it("draws another project's saved split too, not shown", () => {
            const rows = withSplits(
                [agent("a"), agent("b"), agent("c", undefined, "loom"), agent("d", undefined, "loom")],
                [],
                grids("waveterm", { waveterm: ["a", "b"], loom: ["c", "d"] })
            );
            expect(shape(rows)).toEqual([
                "group:waveterm:2a:0t",
                "split:waveterm:shown:a,b",
                "group:loom:2a:0t",
                "split:loom:saved:c,d",
            ]);
        });

        it("leaves a grid of one cell as plain rows", () => {
            const rows = withSplits([agent("a"), agent("b")], [], grids("waveterm", { waveterm: ["a"] }));
            expect(shape(rows)).toEqual(["group:waveterm:2a:0t", "a:a", "a:b"]);
        });

        it("draws nothing for a collapsed folder", () => {
            const rows = withSplits([agent("a"), agent("b")], [], grids("waveterm", { waveterm: ["a", "b"] }), {
                collapsed: ["waveterm"],
            });
            expect(shape(rows)).toEqual(["group:waveterm:2a:0t:closed"]);
        });

        it("puts a split whose cells have no row at the top of the folder's body, from the roster", () => {
            // "x" and "y" are live cells the tree draws no row for (workers of a folded run, say)
            const rows = build([agent("a")], [], {
                splits: grids("waveterm", { waveterm: ["x", "y"] }),
                roster: [agent("a"), agent("x"), agent("y")],
            });
            expect(shape(rows)).toEqual(["group:waveterm:1a:0t", "split:waveterm:shown:x,y", "a:a"]);
        });

        it("folds the filtered project's split", () => {
            const rows = withSplits(
                [agent("a"), agent("b")],
                [term("t1")],
                grids("waveterm", { waveterm: ["b", "t1"] }),
                { filter: "waveterm" }
            );
            expect(shape(rows)).toEqual(["a:a", "split:waveterm:shown:b,t1"]);
        });

        const placesIn = (rows: ProjectTreeRow[]) => {
            const split = rows.find((r) => r.kind === "split");
            return split?.kind === "split" ? split.cells.map((c) => c.place) : null;
        };

        it("places each cell as the grid does on screen: 2 side by side, 3 and 4 by the template", () => {
            const four = [agent("a"), agent("b"), agent("c"), agent("d")];
            for (const n of [2, 3, 4]) {
                const ids = four.slice(0, n).map((a) => a.id);
                expect(placesIn(withSplits(four, [], grids("waveterm", { waveterm: ids })))).toEqual(placementFor(n));
            }
            const rows = withSplits(four, [], grids("waveterm", { waveterm: ["a", "b", "c", "d"] }));
            expect(shape(rows)).toEqual(["group:waveterm:4a:0t", "split:waveterm:shown:a,b,c,d"]);
        });

        it("keeps a grid's stored places: one tall cell and two stacked", () => {
            const places = [
                { row: 1, col: 1, rowSpan: 2, colSpan: 1 },
                { row: 1, col: 2, rowSpan: 1, colSpan: 1 },
                { row: 2, col: 2, rowSpan: 1, colSpan: 1 },
            ];
            const rows = withSplits([agent("a"), agent("b"), agent("c")], [], {
                project: "waveterm",
                grids: { waveterm: { ids: ["a", "b", "c"], focused: "a", places } },
            });
            expect(placesIn(rows)).toEqual(places);
        });

        describe("a cell inside a run", () => {
            // a hand-made tree: the run's lead, its worker (only while the run is unfolded), then a plain agent
            const run = { runId: "r1" };
            const lead = agent("l");
            const w = { ...agent("w"), runId: "r1" };
            const tree = (open: boolean) =>
                [
                    { kind: "group", project: "waveterm", count: 3, attn: 0, running: 0 },
                    { kind: "lead", agent: lead, project: "waveterm", run, open, live: 1 },
                    ...(open ? [{ kind: "worker", agent: w, project: "waveterm", run, task: {} }] : []),
                    { kind: "parent", agent: agent("a"), project: "waveterm" },
                ] as unknown as AgentTreeRow[];
            const menus = (rows: ProjectTreeRow[]) => {
                const split = rows.find((r) => r.kind === "split");
                return split?.kind === "split"
                    ? split.cells.map((c) => `${c.id}:${c.menu}:${c.run?.runId ?? "-"}`)
                    : null;
            };

            it("pulls an unfolded run's worker row out, the split at the worker's place, with the task menu", () => {
                const rows = build([], [], {
                    tree: tree(true),
                    splits: grids("waveterm", { waveterm: ["a", "w"] }),
                    roster: [lead, w, agent("a")],
                });
                expect(shape(rows)).toEqual(["group:waveterm:3a:0t", "lead", "split:waveterm:shown:a,w"]);
                expect(menus(rows)).toEqual(["a:agent:-", "w:task:-"]);
            });

            it("takes a folded run's worker from the roster, with the task menu; the lead's cell has the run's", () => {
                const rows = build([], [], {
                    tree: tree(false),
                    splits: grids("waveterm", { waveterm: ["l", "w"] }),
                    roster: [lead, w, agent("a")],
                });
                expect(shape(rows)).toEqual(["group:waveterm:3a:0t", "split:waveterm:shown:l,w", "a:a"]);
                expect(menus(rows)).toEqual(["l:lead:r1", "w:task:-"]);
            });
        });
    });
});

describe("projectLabel", () => {
    it("calls the terminals with no project Home, and names every other folder as it is", () => {
        expect(projectLabel(HOME_PROJECT)).toBe("Home");
        expect(projectLabel("arcterm")).toBe("arcterm");
        // the agents with no project keep their own folder and its own name
        expect(projectLabel(UNGROUPED_PROJECT)).toBe(UNGROUPED_PROJECT);
    });
});

describe("folderCounts", () => {
    it("says what a folded folder holds, agents then terminals", () => {
        expect(folderCounts(2, 1)).toBe("2 agents · 1 terminal");
        expect(folderCounts(1, 2)).toBe("1 agent · 2 terminals");
    });
    it("names only the terminals of a folder with no agents, and only the agents of one with no terminals", () => {
        expect(folderCounts(0, 2)).toBe("2 terminals");
        expect(folderCounts(0, 1)).toBe("1 terminal");
        expect(folderCounts(3, 0)).toBe("3 agents");
    });
    it("is empty for a folder that holds nothing", () => {
        expect(folderCounts(0, 0)).toBe("");
    });
});

describe("terminalRowState", () => {
    // tool id -> the tab of its install terminal (toolsstore's installingAtom and failedAtom)
    it("reads installing for the tab of a running install, failed for one that exited non-zero", () => {
        expect(terminalRowState("t1", { glow: "t1" }, {})).toBe("installing");
        expect(terminalRowState("t2", {}, { k9s: "t2" })).toBe("failed");
    });
    it("is nothing for any other terminal", () => {
        expect(terminalRowState("t3", { glow: "t1" }, { k9s: "t2" })).toBeUndefined();
        expect(terminalRowState("t3", {}, {})).toBeUndefined();
    });
    it("finds the tab whichever tool it belongs to", () => {
        expect(terminalRowState("t5", { glow: "t1", btop: "t5" }, { k9s: "t2" })).toBe("installing");
    });
    it("reads failed when both name the tab: the exit is the later fact", () => {
        expect(terminalRowState("t1", { glow: "t1" }, { glow: "t1" })).toBe("failed");
    });
    it("reads removed for a terminal whose folder is gone (worktreegone.ts), an install's own state first", () => {
        expect(terminalRowState("t1", {}, {}, ["t1"])).toBe("removed");
        expect(terminalRowState("t2", {}, {}, ["t1"])).toBeUndefined();
        expect(terminalRowState("t1", { glow: "t1" }, {}, ["t1"])).toBe("installing");
        expect(terminalRowState("t1", {}, { glow: "t1" }, ["t1"])).toBe("failed");
    });
});

describe("terminalShows", () => {
    it("says panel for the docked terminal", () => {
        expect(terminalShows("t1", "t1")).toBe("panel");
    });
    it("is nothing for a terminal that is not the docked one", () => {
        expect(terminalShows("t1", "t2")).toBeUndefined();
        expect(terminalShows("t1", null)).toBeUndefined();
        expect(terminalShows("t1", undefined)).toBeUndefined();
    });
});

describe("terminalPlace", () => {
    it("is nothing at the project's root, however either path is written", () => {
        expect(terminalPlace("D:\\Code\\WaveTerm", "d:/code/waveterm")).toBeUndefined();
        expect(terminalPlace("d:/code/waveterm/", "D:\\Code\\WaveTerm")).toBeUndefined();
        expect(terminalPlace("/home/u/p//", "/home/u/p")).toBeUndefined();
    });
    it("is the last folder of the cwd anywhere else", () => {
        expect(terminalPlace("D:\\code\\wt\\.waveterm\\worktrees\\fix-login-agent", "D:\\code\\wt")).toBe(
            "fix-login-agent"
        );
        expect(terminalPlace("/home/u/p/src/", "/home/u/p")).toBe("src");
        // a folder that only shares the root's name as a prefix is another folder
        expect(terminalPlace("/home/u/p2", "/home/u/p")).toBe("p2");
    });
    it("is nothing with no cwd, or no root to compare against", () => {
        expect(terminalPlace(undefined, "/home/u/p")).toBeUndefined();
        expect(terminalPlace("", "/home/u/p")).toBeUndefined();
        expect(terminalPlace("/home/u/p/src", undefined)).toBeUndefined();
    });
});

describe("treeNavIds", () => {
    const agents = [agent("a"), agent("b"), agent("c", undefined, "loom")];
    const terminals: AgentVM[] = [
        { ...agent("t1"), kind: "terminal" },
        { ...agent("t2", undefined, "loom"), kind: "terminal" },
    ];
    const tree = () =>
        projectTree({
            tree: treeOf(agents),
            terminals,
            filter: ALL_PROJECTS,
            collapsed: [],
            roots: new Map(),
        });

    it("walks agents and terminals the way the tree reads", () => {
        expect(treeNavIds(tree())).toEqual(["a", "b", "t1", "c", "t2"]);
    });
    it("reaches a service by its tab id, and skips one with no tab", () => {
        const rows = projectTree({
            tree: treeOf(agents),
            terminals: [...terminals, { ...agent("tab-web"), kind: "terminal" }],
            filter: ALL_PROJECTS,
            collapsed: [],
            roots: new Map(),
            services: [
                { id: "web", name: "web", project: "waveterm", tabId: "tab-web" },
                { id: "idle", name: "idle", project: "waveterm" },
            ],
        });
        expect(treeNavIds(rows)).toEqual(["a", "b", "tab-web", "t1", "c", "t2"]);
    });
    it("skips a folded project's rows", () => {
        const folded = projectTree({
            tree: treeOf(agents),
            terminals,
            filter: ALL_PROJECTS,
            collapsed: ["waveterm"],
            roots: new Map(),
        });
        expect(treeNavIds(folded)).toEqual(["c", "t2"]);
    });
    it("skips a queued entry: it selects nothing, so j/k and Alt+digit never land on it", () => {
        const queue = queuedRows(
            [
                {
                    id: "q-1",
                    title: "Plan",
                    projectpath: "/code/waveterm",
                    queuedts: NOW,
                    state: "waiting",
                    data: { channelid: "ch", workspaceid: "ws", goal: "g", runtime: "claude" },
                },
            ],
            {}
        );
        const rows = projectTree({
            tree: treeOf(agents),
            terminals,
            filter: ALL_PROJECTS,
            collapsed: [],
            roots: new Map(),
            queue,
        });
        expect(rows.some((r) => r.kind === "queuedentry")).toBe(true);
        expect(treeNavIds(rows)).toEqual(["a", "b", "t1", "c", "t2"]);
    });
    it("walks a split row's cells in reading order where the row sits", () => {
        const rows = projectTree({
            tree: treeOf(agents),
            terminals,
            filter: ALL_PROJECTS,
            collapsed: [],
            roots: new Map(),
            splits: { project: "waveterm", grids: { waveterm: { ids: ["t1", "a"], focused: "a" } } },
            roster: [...agents, ...terminals],
        });
        expect(treeNavIds(rows)).toEqual(["t1", "a", "b", "c", "t2"]);
    });
    it("skips a worker row whose session is gone, and rows that are not a session", () => {
        const gone = { kind: "worker", project: "p", run: {}, task: {} } as unknown as ProjectTreeRow;
        const rows: ProjectTreeRow[] = [
            { kind: "group", project: "p", agents: 1, terminals: 0, attn: 0, running: 0, open: true },
            gone,
            { kind: "divider", project: "p" },
        ];
        expect(treeNavIds(rows)).toEqual([]);
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
    it("is true when a tab stays but its session moved on", () => {
        const before = rosterSessionKeys([{ id: "t1", transcriptPath: "C:\\p\\one.jsonl" }]);
        expect(agentExited(before, rosterSessionKeys([{ id: "t1", transcriptPath: "C:\\p\\two.jsonl" }]))).toBe(true);
        expect(agentExited(before, rosterSessionKeys([{ id: "t1" }]))).toBe(true);
    });
    it("is false when a tab only starts writing its transcript, or the path's case or slashes differ", () => {
        const before = rosterSessionKeys([{ id: "t1" }]);
        const after = rosterSessionKeys([{ id: "t1", transcriptPath: "C:\\p\\one.jsonl" }]);
        expect(agentExited(before, after)).toBe(false);
        expect(agentExited(after, rosterSessionKeys([{ id: "t1", transcriptPath: "c:/P/one.jsonl" }]))).toBe(false);
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

describe("agentDigits", () => {
    it("numbers the first nine agents from 1, in list order, and leaves the rest without one", () => {
        const ids = Array.from({ length: 11 }, (_, i) => `a${i}`);
        const digits = agentDigits(ids);
        expect(digits.get("a0")).toBe(1);
        expect(digits.get("a8")).toBe(9);
        expect(digits.has("a9")).toBe(false);
        expect(digits.size).toBe(9);
        expect(agentDigits([]).size).toBe(0);
    });
});

describe("folderBlocks", () => {
    type Row = { kind: "folder" | "item"; id: string };
    const f = (id: string): Row => ({ kind: "folder", id });
    const i = (id: string): Row => ({ kind: "item", id });

    it("gives each folder the rows under it", () => {
        expect(folderBlocks([f("a"), i("1"), i("2"), f("b"), i("3")])).toEqual([
            { head: f("a"), body: [i("1"), i("2")] },
            { head: f("b"), body: [i("3")] },
        ]);
    });

    it("leaves a collapsed folder an empty body", () => {
        expect(folderBlocks([f("a"), f("b"), i("1")])).toEqual([
            { head: f("a"), body: [] },
            { head: f("b"), body: [i("1")] },
        ]);
    });

    it("makes a flat list one block with no head", () => {
        expect(folderBlocks([i("1"), i("2")])).toEqual([{ head: null, body: [i("1"), i("2")] }]);
        expect(folderBlocks([])).toEqual([]);
    });
});
