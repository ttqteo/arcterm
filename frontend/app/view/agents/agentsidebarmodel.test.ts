// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { describe, expect, it } from "vitest";
import {
    agentExited,
    buildSidebarRows,
    endedSessionsByProject,
    scanDue,
    SESSION_PAGE,
    sessionAgeLabel,
    sessionTitle,
    showMore,
    UNTITLED_SESSION,
    visibleCount,
    type EndedSessionRow,
    type SidebarRow,
} from "./agentsidebarmodel";
import type { AgentVM } from "./agentsviewmodel";
import { buildAgentTree, foldCollapsedProjects, UNGROUPED_PROJECT } from "./agenttreemodel";

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

const label = (r: SidebarRow): string => {
    switch (r.kind) {
        case "group":
            return `group:${r.project}`;
        case "session":
            return `session:${r.session.id}`;
        case "more":
            return `more:${r.project}:${r.hidden}`;
        default:
            return r.kind;
    }
};
const labels = (rows: SidebarRow[]) => rows.map(label);

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
// segment of its cwd. Both are for one project, so the ended sessions must be filed where the live agents are.
describe("endedSessionsByProject project keys", () => {
    const groupsOf = (rows: SidebarRow[]) => rows.filter((r) => r.kind === "group").map((r) => label(r));
    const sidebar = (agents: AgentVM[], ended: Map<string, EndedSessionRow[]>) =>
        buildSidebarRows(treeOf(agents), ended, new Set(), {});

    it("files a session under the registered project its path belongs to, not under its folder's name", () => {
        const launched = agent("a", undefined, "Arc");
        const ended = endedSessionsByProject(
            [session("s", { projectpath: "D:\\projects\\arcterm", projectname: "arcterm" })],
            [launched],
            { Arc: { path: "d:/projects/arcterm/" } }
        );
        expect([...ended.keys()]).toEqual(["Arc"]);
        // one folder, holding the live agent and then its ended session
        const rows = sidebar([launched], ended);
        expect(groupsOf(rows)).toEqual(["group:Arc"]);
        expect(labels(rows)).toEqual(["group:Arc", "parent", "session:s"]);
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
        expect(sidebar([external], new Map()).filter((r) => r.kind === "group")).toMatchObject([{ project: "fork" }]);
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
        expect(groupsOf(sidebar([external], ended))).toEqual(["group:fork"]);
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

describe("buildSidebarRows", () => {
    const noPages = {};
    const noneCollapsed = new Set<string>();

    it("lists a project's ended sessions after its live agents and before the next project", () => {
        const tree = treeOf([agent("a"), agent("b", undefined, "loom")]);
        const ended = endedOf([...solos(2), ...solos(1, "loom", "l")]);
        expect(labels(buildSidebarRows(tree, ended, noneCollapsed, noPages))).toEqual([
            "group:waveterm",
            "parent",
            "session:s1",
            "session:s2",
            "group:loom",
            "parent",
            "session:l1",
        ]);
    });

    it("shows five sessions then a Show more row counting the rest", () => {
        const rows = buildSidebarRows(treeOf([agent("a")]), endedOf(solos(7)), noneCollapsed, noPages);
        expect(labels(rows)).toEqual([
            "group:waveterm",
            "parent",
            "session:s1",
            "session:s2",
            "session:s3",
            "session:s4",
            "session:s5",
            "more:waveterm:2",
        ]);
        expect(SESSION_PAGE).toBe(5);
    });

    it("shows five more per press and drops the row once nothing is hidden", () => {
        const ended = endedOf(solos(12));
        const once = buildSidebarRows(treeOf([agent("a")]), ended, noneCollapsed, { waveterm: 1 });
        expect(labels(once).filter((l) => l.startsWith("session:"))).toHaveLength(10);
        expect(labels(once)[labels(once).length - 1]).toBe("more:waveterm:2");
        const twice = buildSidebarRows(treeOf([agent("a")]), ended, noneCollapsed, { waveterm: 2 });
        expect(labels(twice).filter((l) => l.startsWith("session:"))).toHaveLength(12);
        expect(labels(twice).some((l) => l.startsWith("more:"))).toBe(false);
    });

    it("pages each project on its own", () => {
        const tree = treeOf([agent("a"), agent("b", undefined, "loom")]);
        const ended = endedOf([...solos(7), ...solos(6, "loom", "l")]);
        const rows = labels(buildSidebarRows(tree, ended, noneCollapsed, { waveterm: 1 }));
        expect(rows).toContain("more:loom:1");
        expect(rows.some((l) => l.startsWith("more:waveterm"))).toBe(false);
    });

    it("hides a collapsed project's agents and sessions together, keeping its folder row", () => {
        const rows = buildSidebarRows(treeOf([agent("a")]), endedOf(solos(3)), new Set(["waveterm"]), noPages);
        expect(labels(rows)).toEqual(["group:waveterm"]);
    });

    it("gives a project with ended sessions and no live agent a folder of its own, after the live ones", () => {
        const rows = buildSidebarRows(
            treeOf([agent("a")]),
            endedOf([...solos(1), ...solos(2, "loom", "l")]),
            noneCollapsed,
            noPages
        );
        expect(labels(rows)).toEqual([
            "group:waveterm",
            "parent",
            "session:s1",
            "group:loom",
            "session:l1",
            "session:l2",
        ]);
        expect(rows.find((r) => r.kind === "group" && r.project === "loom")).toMatchObject({ count: 0, attn: 0 });
    });

    it("orders agentless projects by their newest session", () => {
        const ended = endedOf([
            session("a", { projectname: "aaa", lastactivets: NOW - 9 * MIN }),
            session("z", { projectname: "zzz", lastactivets: NOW - MIN }),
        ]);
        expect(labels(buildSidebarRows([], ended, noneCollapsed, noPages))).toEqual([
            "group:zzz",
            "session:z",
            "group:aaa",
            "session:a",
        ]);
    });

    it("breaks a tie between agentless projects on the project name, whatever order they arrived in", () => {
        const mk = (project: string) => session(`${project}-1`, { projectname: project, lastactivets: NOW - MIN });
        const expected = ["group:alpha", "session:alpha-1", "group:beta", "session:beta-1"];
        expect(labels(buildSidebarRows([], endedOf([mk("beta"), mk("alpha")]), noneCollapsed, noPages))).toEqual(
            expected
        );
        expect(labels(buildSidebarRows([], endedOf([mk("alpha"), mk("beta")]), noneCollapsed, noPages))).toEqual(
            expected
        );
    });

    it("gives no folder to an agentless project with no sessions in its list", () => {
        const ended = new Map<string, EndedSessionRow[]>([["loom", []]]);
        expect(buildSidebarRows([], ended, noneCollapsed, noPages)).toEqual([]);
    });

    it("folds only the collapsed projects when the first is collapsed and a later one is not", () => {
        const tree = treeOf([agent("a"), agent("b", undefined, "loom")]);
        const ended = endedOf([...solos(2), ...solos(1, "loom", "l"), ...solos(1, "zeta", "z")]);
        expect(labels(buildSidebarRows(tree, ended, new Set(["waveterm"]), noPages))).toEqual([
            "group:waveterm",
            "group:loom",
            "parent",
            "session:l1",
            "group:zeta",
            "session:z1",
        ]);
    });

    it("keeps a collapsed agentless project's folder row and hides its sessions", () => {
        const ended = endedOf(solos(2, "loom", "l"));
        expect(labels(buildSidebarRows([], ended, new Set(["loom"]), noPages))).toEqual(["group:loom"]);
    });

    it("is exactly the folded tree when there are no sessions", () => {
        const tree = treeOf([agent("a"), agent("b", undefined, "loom")]);
        const collapsed = new Set(["loom"]);
        expect(buildSidebarRows(tree, new Map<string, EndedSessionRow[]>(), collapsed, noPages)).toEqual(
            foldCollapsedProjects(tree, collapsed)
        );
    });
});

describe("paging", () => {
    it("shows one page more per press", () => {
        expect(visibleCount("p", {})).toBe(5);
        expect(visibleCount("p", { p: 2 })).toBe(15);
        expect(showMore({}, "p")).toEqual({ p: 1 });
        expect(showMore({ p: 1, q: 3 }, "p")).toEqual({ p: 2, q: 3 });
    });
    it("does not mutate the map it was given", () => {
        const pages = { p: 1 };
        showMore(pages, "p");
        expect(pages).toEqual({ p: 1 });
    });
    it("counts a project named like an Object property as unpressed until it is", () => {
        for (const name of ["constructor", "toString", "__proto__"]) {
            expect(visibleCount(name, {})).toBe(5);
            const once = showMore({}, name);
            expect(visibleCount(name, once)).toBe(10);
            expect(visibleCount(name, showMore(once, name))).toBe(15);
            expect(Object.getPrototypeOf(once)).toBe(Object.prototype);
            // pressing under one name leaves the others alone
            expect(visibleCount("other", once)).toBe(5);
        }
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
