// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { describe, expect, it } from "vitest";
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
    folderCounts,
    HOME_PROJECT,
    liveBranches,
    notableBranch,
    projectLabel,
    projectTree,
    registeredConversations,
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
    // a row as a short string: "group:<project>:<agents>a:<terminals>t[:closed]", "split:<ids>[:cross]",
    // "divider:<project>", "t:<id>", "a:<id>" for a plain agent row
    const shape = (rows: ProjectTreeRow[]) =>
        rows.map((r) => {
            switch (r.kind) {
                case "group":
                    return `group:${r.project}:${r.agents}a:${r.terminals}t${r.open ? "" : ":closed"}`;
                case "split":
                    return `split:${r.cells.map((c) => c.id).join("+")}${r.crossProject ? ":cross" : ""}`;
                case "divider":
                    return `divider:${r.project}`;
                case "terminal":
                    return `t:${r.terminal.id}`;
                case "parent":
                    return `a:${r.agent.id}`;
                default:
                    return r.kind;
            }
        });
    const build = (agents: AgentVM[], terminals: AgentVM[], over: Partial<Parameters<typeof projectTree>[0]> = {}) =>
        projectTree({
            tree: treeOf(agents),
            terminals,
            cells: [],
            roster: [...agents, ...terminals],
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

    describe("split", () => {
        const agents = [agent("a1"), agent("a2"), agent("b", undefined, "loom")];
        const terminals = [term("t1"), term("t2", "loom")];

        it("sits first in a project's body when every cell is in it, agents and terminals alike", () => {
            const rows = build(agents, terminals, { cells: ["a1", "t1"] });
            expect(shape(rows)).toEqual([
                "group:waveterm:1a:0t",
                "split:a1+t1",
                "a:a2",
                "group:loom:1a:1t",
                "a:b",
                "divider:loom",
                "t:t2",
            ]);
            expect(rows[1]).toMatchObject({ kind: "split", project: "waveterm", crossProject: false });
        });

        it("puts a split across projects at the very top, crossProject", () => {
            const rows = build(agents, terminals, { cells: ["a1", "t2", "b"] });
            expect(shape(rows)).toEqual([
                "split:a1+t2+b:cross",
                "group:waveterm:1a:1t",
                "a:a2",
                "divider:waveterm",
                "t:t1",
            ]);
            expect(rows[0]).toMatchObject({ kind: "split", project: null, crossProject: true });
        });

        it("is no split with fewer than two cells on the roster", () => {
            const plain = shape(build(agents, terminals));
            expect(shape(build(agents, terminals, { cells: ["a1"] }))).toEqual(plain);
            expect(shape(build(agents, terminals, { cells: [] }))).toEqual(plain);
            expect(shape(build(agents, terminals, { cells: ["a1", "gone"] }))).toEqual(plain);
        });

        it("skips a cell that left the roster and still splits the rest", () => {
            const rows = build(agents, terminals, { cells: ["a1", "gone", "a2"] });
            expect(shape(rows)[1]).toBe("split:a1+a2");
        });

        it("keeps a project the split emptied when it still holds a terminal, and drops one it left bare", () => {
            // a2 and t1 stay: waveterm keeps its terminal. loom lost its only agent to the split and has no terminal
            const kept = build([agent("a1"), agent("b", undefined, "loom")], [term("t1")], { cells: ["a1", "b"] });
            expect(shape(kept)).toEqual(["split:a1+b:cross", "group:waveterm:0a:1t", "t:t1"]);
            // the split took every row of the project it sits in: the group stays as its host
            const host = build([agent("a1"), agent("a2")], [], { cells: ["a1", "a2"] });
            expect(shape(host)).toEqual(["group:waveterm:0a:0t", "split:a1+a2"]);
        });

        it("takes a lifted agent out of its project's asking count", () => {
            const asking = { ...agent("a1"), state: "asking" as const };
            const rows = build([asking, agent("a2")], [], { cells: ["a1", "a2"], collapsed: ["waveterm"] });
            expect(rows[0]).toMatchObject({ kind: "group", agents: 0, attn: 0, open: false });
        });

        it("is not folded away with its project", () => {
            const rows = build(agents, terminals, { cells: ["a1", "t1"], collapsed: ["waveterm", "loom"] });
            expect(shape(rows)).toEqual(["group:waveterm:1a:0t:closed", "split:a1+t1", "group:loom:1a:1t:closed"]);
        });

        it("is the first row under a project filter, wherever its cells are", () => {
            expect(shape(build(agents, terminals, { cells: ["a1", "t1"], filter: "waveterm" }))).toEqual([
                "split:a1+t1",
                "a:a2",
            ]);
            // cells in another project than the filter's: still shown, as the surface shows it
            expect(shape(build(agents, terminals, { cells: ["b", "t2"], filter: "waveterm" }))).toEqual([
                "split:b+t2",
                "a:a1",
                "a:a2",
                "divider:waveterm",
                "t:t1",
            ]);
        });

        it("puts a divider under the split when terminals remain and nothing else is above them", () => {
            const rows = build([agent("a1"), agent("a2")], [term("t1"), term("t2")], { cells: ["a1", "a2"] });
            expect(shape(rows)).toEqual(["group:waveterm:0a:2t", "split:a1+a2", "divider:waveterm", "t:t1", "t:t2"]);
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
});

describe("terminalShows", () => {
    it("says panel for the docked terminal", () => {
        expect(terminalShows("t1", [], "t1")).toBe("panel");
        expect(terminalShows("t1", ["a", "t1"], "t1")).toBe("panel");
    });
    it("says split for a cell of a split, and nothing for the one cell of a grid that is not split", () => {
        expect(terminalShows("t1", ["a", "t1"], null)).toBe("split");
        expect(terminalShows("t1", ["t1"], null)).toBeUndefined();
    });
    it("is nothing for a terminal that is neither", () => {
        expect(terminalShows("t1", ["a", "b"], "t2")).toBeUndefined();
        expect(terminalShows("t1", [], undefined)).toBeUndefined();
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
    const tree = (cells: string[] = []) =>
        projectTree({
            tree: treeOf(agents),
            terminals,
            cells,
            roster: [...agents, ...terminals],
            filter: ALL_PROJECTS,
            collapsed: [],
            roots: new Map(),
        });

    it("walks agents and terminals the way the tree reads", () => {
        expect(treeNavIds(tree())).toEqual(["a", "b", "t1", "c", "t2"]);
    });
    it("puts the split's cells first, in cell order, as the agent keys have always walked them", () => {
        expect(treeNavIds(tree(["c", "t1"]))).toEqual(["c", "t1", "a", "b", "t2"]);
    });
    it("skips a folded project's rows", () => {
        const folded = projectTree({
            tree: treeOf(agents),
            terminals,
            cells: [],
            roster: [...agents, ...terminals],
            filter: ALL_PROJECTS,
            collapsed: ["waveterm"],
            roots: new Map(),
        });
        expect(treeNavIds(folded)).toEqual(["c", "t2"]);
    });
    it("skips a worker row whose session is gone, and rows that are not a session", () => {
        const gone = { kind: "worker", project: "p", run: {}, task: {} } as unknown as ProjectTreeRow;
        const rows: ProjectTreeRow[] = [
            { kind: "group", project: "p", agents: 1, terminals: 0, attn: 0, open: true },
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
