// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { describe, expect, it } from "vitest";
import { placementFor, type ProjectGrids } from "./agentgrid";
import {
    agentDigits,
    agentExited,
    agentsElsewhere,
    ALL_PROJECTS,
    canResumeCouncil,
    councilInTree,
    councilRowsByProject,
    folderCounts,
    HOME_PROJECT,
    isBoardSplitCell,
    jarvisCountsByProject,
    liveBranches,
    newCouncilRoot,
    notableBranch,
    projectClose,
    projectCloseMessage,
    projectLabel,
    projectTree,
    rosterSessionKeys,
    scanDue,
    terminalPlace,
    terminalRowState,
    terminalShows,
    treeBoards,
    treeNavIds,
    UNTITLED_COUNCIL,
    type CouncilRowVM,
    type ProjectTreeRow,
} from "./agentsidebarmodel";
import type { AgentVM } from "./agentsviewmodel";
import { buildAgentTree, UNGROUPED_PROJECT, type AgentTreeRow } from "./agenttreemodel";
import type { CouncilOpenedMap } from "./councilopened";
import type { Lineage, RunInfo } from "./runlineage";
import { queuedRows } from "./runqueuemodel";
import { treeServiceInput } from "./servicesmodel";
import type { StartingRun } from "./startingrunsmodel";

const MIN = 60_000;
const HOUR = 60 * MIN;
const DAY = 24 * HOUR;
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

const agent = (id: string, path?: string, project = "waveterm"): AgentVM => ({
    id,
    name: id,
    task: "",
    state: "working",
    project,
    transcriptPath: path,
});

const treeOf = (agents: AgentVM[]) =>
    buildAgentTree(
        agents,
        agents.map((a) => a.id)
    );

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

describe("projectTree", () => {
    // null names no project (a default parameter would swallow undefined)
    const term = (id: string, project: string | null = "waveterm", cwd?: string): AgentVM => ({
        ...agent(id, undefined, project ?? ""),
        kind: "terminal",
        ...(project === null ? { project: undefined } : {}),
        ...(cwd != null ? { cwd } : {}),
    });
    // a row as a short string: "group:<project>:<agents>a:<terminals>t[:closed]", "divider:<project>", "t:<id>",
    // "a:<id>" for a plain agent row, "q:<entry id>:<place>" for a queued entry (place "-" when blocked), and
    // "c:<id>:<meta>" for a council row
    const shape = (rows: ProjectTreeRow[]) =>
        rows.map((r) => {
            switch (r.kind) {
                case "council":
                    return `c:${r.id}:${r.meta}`;
                case "group":
                    return `group:${r.project}:${r.agents}a:${r.terminals}t${r.open ? "" : ":closed"}`;
                case "divider":
                    return `divider:${r.project}`;
                case "terminal":
                    return `t:${r.terminal.id}`;
                case "parent":
                    return `a:${r.agent.id}`;
                case "check":
                    return `check:${r.agent.id}:${r.stageRole}`;
                case "queuedentry":
                    return `q:${r.entry.id}:${r.place ?? "-"}`;
                case "split":
                    return `split:${r.project}:${r.shown ? "shown" : "saved"}:${r.cells.map((c) => c.id).join(",")}`;
                case "board":
                    return `board:${r.boardId}:${r.chat}`;
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

    it("files an agent with no project in Home with the terminals that have none, one folder, last", () => {
        const rows = build([agent("x", undefined, ""), agent("a")], [term("h", null), term("t1", "ops")]);
        expect(shape(rows)).toEqual([
            "group:waveterm:1a:0t",
            "a:a",
            "group:ops:0a:1t",
            "t:t1",
            `group:${HOME_PROJECT}:1a:1t`,
            "a:x",
            `divider:${HOME_PROJECT}`,
            "t:h",
        ]);
        expect(rows.some((r) => r.project === UNGROUPED_PROJECT)).toBe(false);
    });

    it("files a No folder launch (stamped Home) in No folder, one folder with the ones that have no project", () => {
        const rows = build(
            [agent("x", undefined, ""), agent("y", undefined, "Home"), agent("a")],
            [term("h", null), term("n", "Home")]
        );
        expect(shape(rows)).toEqual([
            "group:waveterm:1a:0t",
            "a:a",
            `group:${HOME_PROJECT}:2a:2t`,
            "a:x",
            "a:y",
            `divider:${HOME_PROJECT}`,
            "t:h",
            "t:n",
        ]);
    });

    it("keeps a registered project named Home a folder of its own", () => {
        const rows = build([agent("y", undefined, "Home")], [term("h", null), term("n", "Home")], {
            roots: new Map([["Home", "C:/code/Home"]]),
        });
        expect(shape(rows)).toEqual([
            "group:Home:1a:1t",
            "a:y",
            "divider:Home",
            "t:n",
            `group:${HOME_PROJECT}:0a:1t`,
            "t:h",
        ]);
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

    describe("a brainstorm's builder check and judge", () => {
        // the brainstorming agent's tab names the runs of its two sessions; each session's tab is its run's
        const brainstorming: AgentVM = {
            ...agent("bs"),
            builderCheck: { state: "reading", ts: 1, runId: "chk-1" },
            brainstormJudge: { state: "answered", ts: 2, runId: "jdg-1" },
        };
        const checker: AgentVM = { ...agent("rv"), runId: "chk-1" };
        const judge: AgentVM = { ...agent("jd"), runId: "jdg-1" };

        it("sit right under their agent in its folder, ahead of the divider and the terminals", () => {
            const rows = build([brainstorming, checker, judge, agent("other")], [term("t1")]);
            expect(shape(rows)).toEqual([
                "group:waveterm:4a:1t",
                "a:bs",
                "check:rv:builder-check",
                "check:jd:brainstorm-judge",
                "a:other",
                "divider:waveterm",
                "t:t1",
            ]);
        });

        it("stay under their agent when the project filter narrows the tree to it", () => {
            const rows = build([brainstorming, checker, judge], [], { filter: "waveterm" });
            expect(shape(rows)).toEqual(["a:bs", "check:rv:builder-check", "check:jd:brainstorm-judge"]);
        });

        it("go with their agent when its folder is folded, and count in the folder", () => {
            const rows = build([brainstorming, checker, judge], [], { collapsed: ["waveterm"] });
            expect(shape(rows)).toEqual(["group:waveterm:3a:0t:closed"]);
        });
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
            expect(rows[0]).toMatchObject({
                kind: "group",
                project: "ops",
                agents: 0,
                terminals: 0,
                services: 1,
                open: true,
            });
        });

        it("a folded folder of only services counts them, so it does not read empty", () => {
            const rows = build([], [], { services: [svc("web", "ops"), svc("docs", "ops")], collapsed: ["ops"] });
            expect(rows).toHaveLength(1);
            expect(rows[0]).toMatchObject({ kind: "group", project: "ops", terminals: 0, services: 2, open: false });
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
            const hidden = new Set(["web"]);

            it("stays a row, in its folder, when it went to sleep on its own", () => {
                const rows = build(
                    [agent("a")],
                    [term("tab-web", "ops")],
                    treeServiceInput([status("sleeping")], null)
                );
                expect(shapeS(rows)).toEqual(["group:waveterm:1a:0t", "a:a", "group:ops:0a:0t", "s:web"]);
            });

            it("hidden, has no row, no terminal row for its tab, and leaves no folder that holds nothing else", () => {
                const rows = build(
                    [agent("a")],
                    [term("tab-web", "ops")],
                    treeServiceInput([status("sleeping")], null, hidden)
                );
                expect(shapeS(rows)).toEqual(["group:waveterm:1a:0t", "a:a"]);
            });

            it("is a row, in its folder, while it runs", () => {
                const rows = build([agent("a")], [term("tab-web", "ops")], treeServiceInput([status("running")], null));
                expect(shapeS(rows)).toEqual(["group:waveterm:1a:0t", "a:a", "group:ops:0a:0t", "s:web"]);
            });

            it("hidden, keeps the folder of the project's agents, with no divider for a row that is not there", () => {
                const rows = build(
                    [agent("a")],
                    [term("tab-web", "waveterm")],
                    treeServiceInput([status("sleeping", "waveterm")], null, hidden)
                );
                expect(shapeS(rows)).toEqual(["group:waveterm:1a:0t", "a:a"]);
            });

            it("hidden, stays a row while its tab is the selected one", () => {
                const rows = build(
                    [agent("a")],
                    [term("tab-web", "ops")],
                    treeServiceInput([status("sleeping")], "tab-web", hidden)
                );
                expect(shapeS(rows)).toEqual(["group:waveterm:1a:0t", "a:a", "group:ops:0a:0t", "s:web"]);
            });

            it("hidden, hides its tab's terminal under a project filter too", () => {
                const rows = build([agent("a")], [term("tab-web", "waveterm"), term("t1")], {
                    ...treeServiceInput([status("sleeping", "waveterm")], null, hidden),
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

    describe("councils", () => {
        const roots = new Map([
            ["waveterm", "D:\\code\\waveterm"],
            ["loom", "D:\\code\\loom"],
            ["ops", "D:\\code\\ops"],
        ]);
        const cvm = (id: string, created: number, over: Partial<CouncilRowVM> = {}): CouncilRowVM => ({
            id,
            feature: `feature ${id}`,
            created,
            meta: "Done",
            tone: "muted",
            seats: [],
            dot: null,
            lastAt: created,
            unread: false,
            pinned: false,
            ...over,
        });
        // the council input of a project name -> councils object, over the roots the registry holds
        const withCouncils = (
            byProject: Record<string, CouncilRowVM[]> = {},
            over: Partial<Parameters<typeof projectTree>[0]> = {}
        ) => ({ roots, councils: new Map(Object.entries(byProject)), ...over });

        it("lists the councils newest first, with no label, after the agents and before the divider", () => {
            const councils = {
                waveterm: [cvm("old", 1), cvm("new", 3, { meta: "Round 2", tone: "working" }), cvm("mid", 2)],
            };
            expect(shape(build([agent("a")], [term("t1")], withCouncils(councils)))).toEqual([
                "group:waveterm:1a:1t",
                "a:a",
                "c:new:Round 2",
                "c:mid:Done",
                "c:old:Done",
                "divider:waveterm",
                "t:t1",
            ]);
        });

        it("carries what a row draws: the feature, the meta and its tone", () => {
            const rows = build(
                [agent("a")],
                [],
                withCouncils({ waveterm: [cvm("c1", 1, { meta: "Waiting on you", tone: "asking" })] })
            );
            expect(rows.find((r) => r.kind === "council")).toMatchObject({
                kind: "council",
                project: "waveterm",
                id: "c1",
                feature: "feature c1",
                meta: "Waiting on you",
                tone: "asking",
            });
        });

        it("puts the pinned councils at the top of their folder, above the agents; the rest follow the agents", () => {
            const councils = {
                waveterm: [cvm("p1", 1, { pinned: true }), cvm("c2", 2), cvm("p3", 3, { pinned: true }), cvm("c4", 4)],
            };
            expect(shape(build([agent("a")], [term("t1")], withCouncils(councils)))).toEqual([
                "group:waveterm:1a:1t",
                "c:p3:Done",
                "c:p1:Done",
                "a:a",
                "c:c4:Done",
                "c:c2:Done",
                "divider:waveterm",
                "t:t1",
            ]);
        });

        it("puts the pinned councils first in a view filtered to the project too", () => {
            const rows = build(
                [agent("a")],
                [term("t1")],
                withCouncils({ waveterm: [cvm("p", 1, { pinned: true }), cvm("c", 2)] }, { filter: "waveterm" })
            );
            expect(shape(rows)).toEqual(["c:p:Done", "a:a", "c:c:Done", "divider:waveterm", "t:t1"]);
        });

        it("breaks a tie in created by id, so the order never depends on the input's", () => {
            const rows = build([agent("a")], [], withCouncils({ waveterm: [cvm("b", 5), cvm("a", 5), cvm("c", 5)] }));
            expect(shape(rows).filter((s) => s.startsWith("c:"))).toEqual(["c:a:Done", "c:b:Done", "c:c:Done"]);
        });

        it("gives a project with no council no block: New council is in the New dialog, not the tree", () => {
            const rows = build([agent("a")], [term("t2", "loom")], withCouncils({ waveterm: [cvm("c1", 1)] }));
            expect(shape(rows)).toEqual(["group:waveterm:1a:0t", "a:a", "c:c1:Done", "group:loom:0a:1t", "t:t2"]);
        });

        it("gives a project whose only content is a council a folder, after the agents' projects", () => {
            const rows = build([agent("a")], [term("h", null)], withCouncils({ ops: [cvm("c1", 1)] }));
            expect(shape(rows)).toEqual([
                "group:waveterm:1a:0t",
                "a:a",
                "group:ops:0a:0t",
                "c:c1:Done",
                `group:${HOME_PROJECT}:0a:1t`,
                "t:h",
            ]);
            // a project with no council and nothing else has no folder
            expect(shape(build([agent("a")], [], withCouncils())).some((s) => s.includes("ops"))).toBe(false);
        });

        it("draws nothing for a project with no root to start a council in, and nothing without the input", () => {
            // scratch is no registered project; Home has no root either
            const rows = build([agent("a", undefined, "scratch")], [term("h", null)], withCouncils());
            expect(shape(rows)).toEqual(["group:scratch:1a:0t", "a:a", `group:${HOME_PROJECT}:0a:1t`, "t:h"]);
            expect(shape(build([agent("a")], [term("t1")], { roots }))).toEqual([
                "group:waveterm:1a:1t",
                "a:a",
                "divider:waveterm",
                "t:t1",
            ]);
        });

        it("lists a council of no registered project in Home, which gets a folder for it alone", () => {
            const home = withCouncils({ [HOME_PROJECT]: [cvm("c1", 1)] });
            expect(shape(build([agent("a")], [], home))).toEqual([
                "group:waveterm:1a:0t",
                "a:a",
                `group:${HOME_PROJECT}:0a:0t`,
                "c:c1:Done",
            ]);
            // with Home's terminals: the council sits above the divider, as in any project
            expect(shape(build([agent("a")], [term("h", null)], home))).toEqual([
                "group:waveterm:1a:0t",
                "a:a",
                `group:${HOME_PROJECT}:0a:1t`,
                "c:c1:Done",
                `divider:${HOME_PROJECT}`,
                "t:h",
            ]);
        });

        it("folds the council rows with the rest of the folder", () => {
            const rows = build(
                [agent("a")],
                [],
                withCouncils({ waveterm: [cvm("c1", 1)] }, { collapsed: ["waveterm"] })
            );
            expect(shape(rows)).toEqual(["group:waveterm:1a:0t:closed"]);
        });

        it("narrows to one project's councils, after its agents and before the divider and terminals", () => {
            const councils = { waveterm: [cvm("c1", 1)], loom: [cvm("c2", 2)] };
            const rows = build([agent("a"), agent("b", undefined, "loom")], [term("t1"), term("t2", "loom")], {
                ...withCouncils(councils),
                filter: "waveterm",
                collapsed: ["waveterm"],
            });
            expect(shape(rows)).toEqual(["a:a", "c:c1:Done", "divider:waveterm", "t:t1"]);
        });

        it("shows a project its councils when the filter narrows to it, and nothing when it has none", () => {
            expect(shape(build([agent("a")], [], { ...withCouncils({ ops: [cvm("c1", 1)] }), filter: "ops" }))).toEqual(
                ["c:c1:Done"]
            );
            expect(shape(build([agent("a")], [], { ...withCouncils(), filter: "ops" }))).toEqual([]);
            // and nothing for a project with no root
            expect(shape(build([agent("a")], [], { ...withCouncils(), filter: "scratch" }))).toEqual([]);
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

        const sr = (id: string, project: string): StartingRun => ({
            id,
            project,
            title: id,
            ts: 0,
            state: "starting",
        });

        it("puts a starting run ahead of the queued plans, uncounted, and gives its project a folder", () => {
            const rows = build([agent("a")], [term("t1")], {
                queue: queued(qe("q-1")),
                starting: [sr("s-1", "waveterm"), sr("s-2", "ops")],
            });
            expect(rows.map((r) => (r.kind === "startingrun" ? `s:${r.id}` : shape([r])[0]))).toEqual([
                "group:waveterm:1a:1t",
                "a:a",
                "s:s-1",
                "q:q-1:1",
                "divider:waveterm",
                "t:t1",
                "group:ops:0a:0t",
                "s:s-2",
            ]);
        });

        const pk = (id: string, project: string): ParkedLaunch => ({ id, project, runtime: "claude", task: id, ts: 0 });
        const withParked = (rows: ProjectTreeRow[]) =>
            rows.map((r) =>
                r.kind === "parked" ? `p:${r.parked.id}` : r.kind === "startingrun" ? `s:${r.id}` : shape([r])[0]
            );

        it("puts a held agent right under its project's agents, uncounted, and Home's in the Home folder last", () => {
            const rows = build([agent("a")], [term("t1")], {
                queue: queued(qe("q-1")),
                starting: [sr("s-1", "waveterm")],
                parked: [pk("p-1", "waveterm"), pk("p-2", "Home"), pk("p-3", "ops")],
            });
            expect(withParked(rows)).toEqual([
                "group:waveterm:1a:1t",
                "a:a",
                "p:p-1",
                "s:s-1",
                "q:q-1:1",
                "divider:waveterm",
                "t:t1",
                "group:ops:0a:0t",
                "p:p-3",
                `group:${HOME_PROJECT}:0a:0t`,
                "p:p-2",
            ]);
        });

        it("narrows to the filtered project's held agents and hides a collapsed folder's", () => {
            const parked = [pk("p-1", "waveterm"), pk("p-2", "ops")];
            expect(withParked(build([agent("a")], [], { filter: "waveterm", parked }))).toEqual(["a:a", "p:p-1"]);
            expect(withParked(build([agent("a")], [], { parked, collapsed: ["waveterm", "ops"] }))).toEqual([
                "group:waveterm:1a:0t:closed",
                "group:ops:0a:0t:closed",
            ]);
        });
    });

    describe("boards", () => {
        const grids = (project: string | null, all: Record<string, string[]>) => ({
            project,
            grids: Object.fromEntries(Object.entries(all).map(([p, ids]) => [p, { ids, focused: ids[0] }])),
        });
        const withSplits = (agents: AgentVM[], terminals: AgentVM[], splits: ProjectGrids, over = {}) =>
            build(agents, terminals, { splits, roster: [...agents, ...terminals], ...over });
        const board = (id: string, agenttabid: string, activets = 1): BoardInfo => ({
            id,
            name: `name-${id}`,
            project: "waveterm",
            path: `/b/${id}`,
            createdts: 1,
            activets,
            agenttabid,
        });
        const tb = (id: string, chatId = "a", chat = `name-${chatId}`, boardProject = "waveterm") => ({
            boardProject,
            boardId: id,
            name: `name-${id}`,
            chatId,
            chat,
        });

        describe("treeBoards", () => {
            const agents = [
                { id: "a", name: "alpha" },
                { id: "b", name: "beta" },
            ];
            it("lists each live chat's latest board, and every open one", () => {
                const list = [board("b3", "a", 9), board("b2", "a", 5), board("b1", "b", 3), board("b0", "gone", 1)];
                expect(treeBoards(list, new Set(), agents).map((b) => b.boardId)).toEqual(["b3", "b1"]);
                const open = new Set(["waveterm/b2", "waveterm/b0"]);
                expect(treeBoards(list, open, agents).map((b) => b.boardId)).toEqual(["b3", "b2", "b1", "b0"]);
            });
            it("names the chat from the roster, else the board's own title", () => {
                const gone = { ...board("b0", "gone"), agenttitle: "claude · old" };
                const [live, ended] = treeBoards([board("b3", "a"), gone], new Set(["waveterm/b0"]), agents);
                expect(live).toMatchObject({ chatId: "a", chat: "alpha" });
                expect(ended).toMatchObject({ chatId: "gone", chat: "claude · old" });
            });
        });

        it("puts the boards after the folder's agents, as peers of them, not under one", () => {
            const rows = build([agent("a"), agent("b")], [term("t1")], { boards: [tb("b2"), tb("b1", "b")] });
            expect(shape(rows)).toEqual([
                "group:waveterm:2a:1t",
                "a:a",
                "a:b",
                "board:b2:name-a",
                "board:b1:name-b",
                "divider:waveterm",
                "t:t1",
            ]);
            expect(rows.find((r) => r.kind === "board")).toMatchObject({
                kind: "board",
                project: "waveterm",
                boardProject: "waveterm",
                boardId: "b2",
                chatId: "a",
            });
        });

        it("lists a board in a filtered project too", () => {
            const rows = build([agent("a")], [], { filter: "waveterm", boards: [tb("b1")] });
            expect(shape(rows)).toEqual(["a:a", "board:b1:name-a"]);
        });

        it("folds a board whose cell is in a split into the split row, beside the agents", () => {
            const rows = withSplits(
                [agent("a"), agent("b")],
                [],
                grids("waveterm", { waveterm: ["a", "b", "board:waveterm/b1"] }),
                { boards: [tb("b1"), tb("b9")] }
            );
            expect(shape(rows)).toEqual([
                "group:waveterm:2a:0t",
                "split:waveterm:shown:a,b,board:waveterm/b1",
                "board:b9:name-a",
            ]);
            const split = rows.find((r) => r.kind === "split");
            const cell = split?.kind === "split" ? split.cells.find((c) => isBoardSplitCell(c)) : undefined;
            expect(cell).toMatchObject({ id: "board:waveterm/b1", board: { boardId: "b1", chat: "name-a" } });
        });

        it("makes [agent | board] a split of its own", () => {
            const rows = withSplits(
                [agent("a"), agent("b")],
                [],
                grids("waveterm", { waveterm: ["a", "board:waveterm/b1"] }),
                {
                    boards: [tb("b1")],
                }
            );
            expect(shape(rows)).toEqual(["group:waveterm:2a:0t", "split:waveterm:shown:a,board:waveterm/b1", "a:b"]);
        });

        it("is no nav id, in a split or not: j/k and Ctrl+Tab step over it", () => {
            const rows = build([agent("a"), agent("b")], [term("t1")], { boards: [tb("b1")] });
            expect(treeNavIds(rows)).toEqual(["a", "b", "t1"]);
            const split = withSplits(
                [agent("a"), agent("b")],
                [],
                grids("waveterm", { waveterm: ["a", "board:waveterm/b1"] }),
                {
                    boards: [tb("b1")],
                }
            );
            expect(treeNavIds(split)).toEqual(["a", "b"]);
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

        it("folds a No folder split, whose grid is keyed by the Home a launch there is stamped with", () => {
            // gridProjects keys the grid by the project the tabs name ("Home"); the tree files them under No folder
            const rows = withSplits(
                [agent("y", undefined, "Home")],
                [term("n", "Home")],
                grids("Home", { Home: ["y", "n"] })
            );
            expect(shape(rows)).toEqual([`group:${HOME_PROJECT}:1a:1t`, `split:${HOME_PROJECT}:shown:y,n`]);
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
                    ? split.cells.map((c) => (isBoardSplitCell(c) ? c.id : `${c.id}:${c.menu}:${c.run?.runId ?? "-"}`))
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

        it("pulls a brainstorm's check row out when its session is a cell, with the task menu", () => {
            const brainstorming: AgentVM = {
                ...agent("bs"),
                builderCheck: { state: "reading", ts: 1, runId: "chk-1" },
            };
            const checker: AgentVM = { ...agent("rv"), runId: "chk-1" };
            const rows = withSplits(
                [brainstorming, checker, agent("a")],
                [],
                grids("waveterm", { waveterm: ["a", "rv"] })
            );
            expect(shape(rows)).toEqual(["group:waveterm:3a:0t", "a:bs", "split:waveterm:shown:a,rv"]);
            const split = rows.find((r) => r.kind === "split");
            expect(
                split?.kind === "split"
                    ? split.cells.map((c) => (isBoardSplitCell(c) ? c.id : `${c.id}:${c.menu}`))
                    : null
            ).toEqual(["a:agent", "rv:task"]);
        });
    });
});

describe("councilInTree", () => {
    const council = (over: Partial<Council> = {}): Council => ({
        id: "c",
        project: "/home/u/loom",
        feature: "f",
        experts: [],
        state: "done",
        round: 3,
        tokens: 0,
        calls: 0,
        created: NOW - 30 * DAY,
        updated: NOW - 2 * DAY,
        ...over,
    });
    // opened at the start of the tests' world, and council "c" opened after it ended (read)
    const read: CouncilOpenedMap = { seededAt: NOW - 20 * DAY, opened: { c: NOW - DAY } };

    it("keeps a council that runs, waits on the person or is queued, however long ago it last saved", () => {
        for (const state of ["running", "awaiting-you", "queued"] as const) {
            expect(councilInTree(council({ state, updated: NOW - 9 * DAY }), read, NOW)).toBe(true);
        }
    });

    it("keeps a pinned council, ended long ago and read", () => {
        expect(councilInTree(council({ pinned: NOW - 5 * DAY }), read, NOW)).toBe(true);
    });

    it("keeps an ended council the person has not opened since it ended (unread)", () => {
        expect(councilInTree(council({ id: "other" }), read, NOW)).toBe(true);
        expect(councilInTree(council(), { ...read, opened: { c: NOW - 3 * DAY } }, NOW)).toBe(true);
    });

    it("keeps an ended council for a day after it ended, read or not", () => {
        expect(councilInTree(council({ updated: NOW - DAY + MIN }), read, NOW)).toBe(true);
        expect(councilInTree(council({ updated: NOW - 2 * DAY, summary: summaryAt(NOW - 5 * MIN) }), read, NOW)).toBe(
            true
        );
    });

    it("drops an ended, unpinned, read council a day after it ended", () => {
        for (const state of ["done", "failed", "stopped", "not-run"] as const) {
            expect(councilInTree(council({ state }), read, NOW)).toBe(false);
        }
        expect(councilInTree(council({ updated: NOW - DAY }), read, NOW)).toBe(false);
        // its summary's time is when it ended, not a later save
        expect(councilInTree(council({ updated: NOW - MIN, summary: summaryAt(NOW - 2 * DAY) }), read, NOW)).toBe(
            false
        );
    });

    it("drops it once it is unpinned", () => {
        expect(councilInTree(council({ pinned: 0 }), read, NOW)).toBe(false);
    });

    it("keeps a pinned stopped council with no summary, ended three days ago and read, and drops it unpinned", () => {
        // with no summary its ended time is `updated`, which the pin leaves as it was
        const stopped = { state: "stopped", updated: NOW - 3 * DAY } as const;
        expect(councilInTree(council({ ...stopped, pinned: NOW - 2 * DAY }), read, NOW)).toBe(true);
        expect(councilInTree(council({ ...stopped, pinned: 0 }), read, NOW)).toBe(false);
    });

    it("drops a council closed after it ended at once, even within the day or unread", () => {
        const fresh = council({ updated: NOW - MIN });
        const closed: CouncilOpenedMap = { ...read, closed: { c: NOW } };
        expect(councilInTree(fresh, read, NOW)).toBe(true);
        expect(councilInTree(fresh, closed, NOW)).toBe(false);
        expect(
            councilInTree(council({ updated: NOW - MIN }), { seededAt: 0, opened: {}, closed: { c: NOW } }, NOW)
        ).toBe(false);
    });

    it("keeps a closed council that runs again, ends again after the close, or is pinned", () => {
        const closed: CouncilOpenedMap = { ...read, closed: { c: NOW - HOUR } };
        expect(councilInTree(council({ state: "running", updated: NOW - 2 * HOUR }), closed, NOW)).toBe(true);
        expect(councilInTree(council({ updated: NOW - MIN }), closed, NOW)).toBe(true);
        expect(councilInTree(council({ updated: NOW - 2 * HOUR, pinned: NOW }), closed, NOW)).toBe(true);
    });

    it("keeps a council ended long ago for a day after the person resumed it, and drops it after", () => {
        const resumed: CouncilOpenedMap = { ...read, opened: { c: NOW - HOUR }, resumed: { c: NOW - HOUR } };
        expect(councilInTree(council({ updated: NOW - 5 * DAY }), resumed, NOW)).toBe(true);
        expect(councilInTree(council({ updated: NOW - 5 * DAY }), resumed, NOW + DAY)).toBe(false);
    });

    it("drops a resumed council closed after the resume", () => {
        const map: CouncilOpenedMap = { ...read, resumed: { c: NOW - HOUR }, closed: { c: NOW - MIN } };
        expect(councilInTree(council({ updated: NOW - 5 * DAY }), map, NOW)).toBe(false);
    });
});

describe("canResumeCouncil", () => {
    const roots = new Map([["loom", "/home/u/loom/"]]);
    const council = (over: Partial<Council> = {}): Council => ({
        id: "c",
        project: "/home/u/loom",
        feature: "f",
        experts: [],
        state: "stopped",
        round: 3,
        tokens: 0,
        calls: 0,
        created: NOW - 30 * DAY,
        updated: NOW - 3 * DAY,
        ...over,
    });
    const read: CouncilOpenedMap = { seededAt: NOW - 20 * DAY, opened: { c: NOW - DAY } };

    it("offers Resume on an ended council the tree no longer keeps, in a registered project", () => {
        for (const state of ["done", "stopped", "failed"] as const) {
            expect(canResumeCouncil(council({ state }), read, NOW, roots)).toBe(true);
        }
    });

    it("offers none while the tree keeps it: within the day, unread, pinned, resumed, or not ended", () => {
        expect(canResumeCouncil(council({ updated: NOW - HOUR }), read, NOW, roots)).toBe(false);
        expect(canResumeCouncil(council({ id: "unread" }), read, NOW, roots)).toBe(false);
        expect(canResumeCouncil(council({ pinned: NOW }), read, NOW, roots)).toBe(false);
        expect(canResumeCouncil(council(), { ...read, resumed: { c: NOW - MIN } }, NOW, roots)).toBe(false);
        for (const state of ["running", "awaiting-you", "queued", "not-run"] as const) {
            expect(canResumeCouncil(council({ state }), read, NOW, roots)).toBe(false);
        }
    });

    it("offers it on a council the person closed within the day", () => {
        const closed: CouncilOpenedMap = { ...read, closed: { c: NOW - MIN } };
        expect(canResumeCouncil(council({ updated: NOW - HOUR }), closed, NOW, roots)).toBe(true);
    });

    it("offers none for a council of a folder that is no registered project: the tree has no folder for it", () => {
        expect(canResumeCouncil(council({ project: "/elsewhere" }), read, NOW, roots)).toBe(false);
    });
});

// a summary written at `at`, its text aside
function summaryAt(at: number): CouncilSummary {
    return { at } as CouncilSummary;
}

describe("councilRowsByProject", () => {
    const roots = new Map([
        ["waveterm", "D:\\code\\waveterm\\"],
        ["loom", "/home/u/loom"],
    ]);
    const council = (id: string, project: string, over: Partial<Council> = {}): Council => ({
        id,
        project,
        feature: `feature ${id}`,
        experts: [],
        state: "running",
        round: 2,
        tokens: 0,
        calls: 0,
        created: 1000,
        updated: 2000,
        ...over,
    });
    // a council with no seats and no message: no picture, timed from when it was created; and not pinned
    const noPicture = (created: number) => ({ seats: [], dot: null, lastAt: created, pinned: false });
    // the tree rule's inputs that keep every council above: each ended (updated 2000) less than a day before AT, and
    // none of them unread (all seeded as opened after they ended)
    const READ: CouncilOpenedMap = { seededAt: 5000, opened: {} };
    const AT = 3000;

    it("keeps only the councils the tree rule keeps (councilInTree), the pinned ones flagged", () => {
        const old = { updated: NOW - 2 * DAY };
        const opened: CouncilOpenedMap = { seededAt: NOW - 10 * DAY, opened: { read: NOW - DAY } };
        const rows = councilRowsByProject(
            [
                council("live", "/home/u/loom", { state: "running", ...old }),
                council("pin", "/home/u/loom", { state: "done", pinned: 5, ...old }),
                council("fresh", "/home/u/loom", { state: "done", updated: NOW - MIN }),
                council("unseen", "/home/u/loom", { state: "done", ...old }),
                council("read", "/home/u/loom", { state: "done", ...old }),
            ],
            roots,
            opened,
            NOW
        );
        expect(rows.get("loom")?.map((r) => [r.id, r.pinned])).toEqual([
            ["live", false],
            ["pin", true],
            ["fresh", false],
            ["unseen", false],
        ]);
    });

    it("drops a project's folder entry when the rule keeps none of its councils", () => {
        const rows = councilRowsByProject(
            [council("read", "/home/u/loom", { state: "failed", updated: NOW - 2 * DAY })],
            roots,
            { seededAt: NOW, opened: {} },
            NOW
        );
        expect(rows.has("loom")).toBe(false);
    });

    it("files each council under the registered project whose root it ran in, however the path is spelled", () => {
        const rows = councilRowsByProject(
            [
                council("a", "d:/code/waveterm"),
                council("b", "D:\\code\\waveterm\\"),
                council("c", "/home/u/loom/"),
                council("d", "/home/u/Loom"),
            ],
            roots,
            READ,
            AT
        );
        expect([...rows.keys()]).toEqual(["waveterm", "loom", HOME_PROJECT]);
        expect(rows.get("waveterm")?.map((r) => r.id)).toEqual(["a", "b"]);
        // a POSIX path is case-sensitive; only a drive path is compared without case, so /home/u/Loom is no project's
        expect(rows.get("loom")?.map((r) => r.id)).toEqual(["c"]);
        expect(rows.get(HOME_PROJECT)?.map((r) => r.id)).toEqual(["d"]);
    });

    it("keeps a pinned council in the tree as any other, ended or running", () => {
        const rows = councilRowsByProject(
            [
                council("pinned", "/home/u/loom", { state: "failed", pinned: 5 }),
                council("again", "/home/u/loom", { state: "running", pinned: 5 }),
                council("plain", "/home/u/loom", { state: "done" }),
            ],
            roots,
            READ,
            AT
        );
        expect(rows.get("loom")?.map((r) => r.id)).toEqual(["pinned", "again", "plain"]);
    });

    it("words each row's meta and tone as treeMeta does, and keeps created for the tree's order", () => {
        const rows = councilRowsByProject(
            [
                council("run", "/home/u/loom", { state: "running", round: 2, created: 7 }),
                council("ask", "/home/u/loom", { state: "awaiting-you", round: 1 }),
                council("done", "/home/u/loom", { state: "done", round: 3 }),
                council("nr", "/home/u/loom", { state: "not-run", round: 0 }),
                council("bad", "/home/u/loom", { state: "failed", round: 3 }),
            ],
            roots,
            READ,
            AT
        );
        expect(rows.get("loom")).toEqual([
            {
                ...noPicture(7),
                id: "run",
                feature: "feature run",
                created: 7,
                meta: "Running",
                tone: "working",
                unread: false,
            },
            {
                ...noPicture(1000),
                id: "ask",
                feature: "feature ask",
                created: 1000,
                meta: "Waiting on you",
                tone: "asking",
                unread: false,
            },
            {
                ...noPicture(1000),
                id: "done",
                feature: "feature done",
                created: 1000,
                meta: "Done",
                tone: "muted",
                unread: false,
                removable: true,
            },
            {
                ...noPicture(1000),
                id: "nr",
                feature: "feature nr",
                created: 1000,
                meta: "Not run",
                tone: "muted",
                unread: false,
                removable: true,
            },
            {
                ...noPicture(1000),
                id: "bad",
                feature: "feature bad",
                created: 1000,
                meta: "Failed",
                tone: "error",
                unread: false,
                removable: true,
            },
        ]);
    });

    it("marks only the councils nothing works on as removable", () => {
        const states: Council["state"][] = [
            "running",
            "awaiting-you",
            "queued",
            "done",
            "failed",
            "stopped",
            "not-run",
        ];
        const rows = councilRowsByProject(
            states.map((state) => council(state, "/home/u/loom", { state })),
            roots,
            READ,
            AT
        );
        expect(
            rows
                .get("loom")
                ?.filter((r) => r.removable)
                .map((r) => r.id)
        ).toEqual(["done", "failed", "stopped", "not-run"]);
    });

    it("files a council of a folder that is no registered project under Home, and has nothing before the list loads", () => {
        const rows = councilRowsByProject([council("x", "/elsewhere"), council("y", "/home/u/loom")], roots, READ, AT);
        expect(rows.get(HOME_PROJECT)?.map((r) => r.id)).toEqual(["x"]);
        expect(rows.get("loom")?.map((r) => r.id)).toEqual(["y"]);
        expect(councilRowsByProject(null, roots, READ, AT).size).toBe(0);
        expect(councilRowsByProject(undefined, roots, READ, AT).size).toBe(0);
    });

    it("marks the councils in the unread set, and keeps their meta", () => {
        const rows = councilRowsByProject(
            [
                council("a", "/home/u/loom", { state: "done", round: 3 }),
                council("b", "/home/u/loom", { state: "done", round: 3 }),
            ],
            roots,
            READ,
            AT,
            new Set(["a"])
        );
        expect(rows.get("loom")?.map((r) => [r.id, r.unread, r.meta])).toEqual([
            ["a", true, "Done"],
            ["b", false, "Done"],
        ]);
    });

    it("names a council whose feature is blank", () => {
        const rows = councilRowsByProject([council("x", "/home/u/loom", { feature: "  " })], roots, READ, AT);
        expect(rows.get("loom")?.[0].feature).toBe(UNTITLED_COUNCIL);
    });

    describe("a queued council", () => {
        it("reads `Queued · after <feature>` of the council it waits on, in the muted tone, and is marked queued", () => {
            const rows = councilRowsByProject(
                [
                    council("run", "/home/u/loom", { feature: "Rail apps", state: "running" }),
                    council("wait", "/home/u/loom", { state: "queued", round: 0, queuedafter: "run" }),
                ],
                roots,
                READ,
                AT
            );
            const queued = rows.get("loom")?.find((r) => r.id === "wait");
            expect(queued).toEqual({
                ...noPicture(1000),
                id: "wait",
                feature: "feature wait",
                created: 1000,
                meta: "Queued · after Rail apps",
                tone: "muted",
                unread: false,
                queued: true,
            });
        });

        it("finds the council it waits on in another project's folder", () => {
            const rows = councilRowsByProject(
                [
                    council("run", "D:\\code\\waveterm", { feature: "Pinned apps", state: "running" }),
                    council("wait", "/home/u/loom", { state: "queued", round: 0, queuedafter: "run" }),
                ],
                roots,
                READ,
                AT
            );
            expect(rows.get("loom")?.[0].meta).toBe("Queued · after Pinned apps");
        });

        it("reads `Queued` alone when the council it waits on is not in the list, or none is named", () => {
            const rows = councilRowsByProject(
                [
                    council("gone", "/home/u/loom", { state: "queued", round: 0, queuedafter: "missing" }),
                    council("none", "/home/u/loom", { state: "queued", round: 0 }),
                ],
                roots,
                READ,
                AT
            );
            expect(rows.get("loom")?.map((r) => [r.id, r.meta, r.queued])).toEqual([
                ["gone", "Queued", true],
                ["none", "Queued", true],
            ]);
        });

        it("names a blank feature of the council it waits on as the tree does", () => {
            const rows = councilRowsByProject(
                [
                    council("run", "/home/u/loom", { feature: " ", state: "running" }),
                    council("wait", "/home/u/loom", { state: "queued", round: 0, queuedafter: "run" }),
                ],
                roots,
                READ,
                AT
            );
            expect(rows.get("loom")?.[1].meta).toBe(`Queued · after ${UNTITLED_COUNCIL}`);
        });

        it("marks no other row queued", () => {
            const rows = councilRowsByProject(
                [council("a", "/home/u/loom", { state: "running" }), council("b", "/home/u/loom", { state: "done" })],
                roots,
                READ,
                AT
            );
            expect(rows.get("loom")?.some((r) => r.queued)).toBe(false);
        });

        it("names the agent the council it waits on is waiting for, as queuedLine does", () => {
            const rows = councilRowsByProject(
                [
                    council("run", "/home/u/loom", {
                        feature: "Rail apps",
                        state: "running",
                        activity: {
                            uxaudit: { text: "Replying to Security", proposalid: "P1" },
                            witness: { text: "Waiting for Witness synthesis to finish its task" },
                        },
                    }),
                    council("wait", "/home/u/loom", { state: "queued", round: 0, queuedafter: "run" }),
                ],
                roots,
                READ,
                AT
            );
            const queued = rows.get("loom")?.find((r) => r.id === "wait");
            expect(queued?.meta).toBe("Queued · after Rail apps · waiting for Witness synthesis");
            expect(queued?.tone).toBe("muted");
            expect(queued?.queued).toBe(true);
        });

        it("names two busy agents, and reads the plain line once that council waits on none", () => {
            const run = (activity: Council["activity"]) =>
                councilRowsByProject(
                    [
                        council("run", "/home/u/loom", { feature: "Rail apps", state: "running", activity }),
                        council("wait", "/home/u/loom", { state: "queued", round: 0, queuedafter: "run" }),
                    ],
                    roots,
                    READ,
                    AT
                )
                    .get("loom")
                    ?.find((r) => r.id === "wait")?.meta;
            expect(
                run({
                    a: { text: "Waiting for Witness synthesis to finish its task" },
                    b: { text: "Waiting for UX audit to finish its task" },
                })
            ).toBe("Queued · after Rail apps · waiting for Witness synthesis and UX audit");
            expect(run({ a: { text: "Reading pkg/services" } })).toBe("Queued · after Rail apps");
            expect(run(undefined)).toBe("Queued · after Rail apps");
        });

        it("reads the plain line when the council it waits on waits on you instead of an agent", () => {
            const rows = councilRowsByProject(
                [
                    council("held", "/home/u/loom", {
                        feature: "Rail apps",
                        state: "awaiting-you",
                        activity: { w: { text: "Waiting for Witness synthesis to finish its task" } },
                    }),
                    council("wait", "/home/u/loom", { state: "queued", round: 0, queuedafter: "held" }),
                ],
                roots,
                READ,
                AT
            );
            expect(rows.get("loom")?.find((r) => r.id === "wait")?.meta).toBe("Queued · after Rail apps");
        });
    });

    describe("a council with held drafts", () => {
        const idea = (id: string, draft?: string): CouncilProposal => ({
            id,
            author: "skeptic",
            title: id,
            argument: "arg",
            ts: 10,
            draft,
        });
        const reply = (id: string, draft?: string): CouncilReply => ({
            id,
            proposalid: "P1",
            author: "skeptic",
            text: "t",
            round: 2,
            ts: 20,
            draft,
        });

        it("reads `N drafts wait for you` in the asking tone, whether it runs, waits or is done", () => {
            const rows = councilRowsByProject(
                [
                    council("run", "/home/u/loom", {
                        state: "running",
                        proposals: [idea("P1", "held"), idea("P2")],
                        replies: [reply("r1", "held")],
                    }),
                    council("ask", "/home/u/loom", { state: "awaiting-you", proposals: [idea("P1", "held")] }),
                    council("done", "/home/u/loom", { state: "done", round: 3, replies: [reply("r1", "held")] }),
                ],
                roots,
                READ,
                AT
            );
            expect(rows.get("loom")?.map((r) => [r.id, r.meta, r.tone])).toEqual([
                ["run", "2 drafts wait for you", "asking"],
                ["ask", "1 draft waits for you", "asking"],
                ["done", "1 draft waits for you", "asking"],
            ]);
        });

        it("does not count a sent or dropped draft", () => {
            const rows = councilRowsByProject(
                [
                    council("run", "/home/u/loom", {
                        state: "running",
                        proposals: [idea("P1", "dropped"), idea("P2")],
                        replies: [reply("r1")],
                    }),
                ],
                roots,
                READ,
                AT
            );
            expect(rows.get("loom")?.[0]).toMatchObject({ meta: "Running", tone: "working" });
        });
    });

    describe("the chat-list picture and time", () => {
        const seat = (id: string, name: string, coordinator = false): CouncilExpert => ({
            id,
            name,
            brief: "",
            model: "sonnet",
            ...(coordinator ? { coordinator } : {}),
        });
        const one = (over: Partial<Council>) =>
            councilRowsByProject([council("x", "/home/u/loom", over)], roots, READ, AT).get("loom")![0];
        const five = [
            seat("co", "Coordinator", true),
            seat("sk", "Skeptic"),
            seat("nu", "New user"),
            seat("sec", "Security"),
            seat("ops", "Operator"),
            seat("ux", "Designer"),
        ];

        it("shows the first two panel seats, in order, never the coordinator, however many sit", () => {
            expect(one({ experts: five }).seats).toEqual([
                { name: "Skeptic", initials: "SK", tone: "conn-1" },
                { name: "New user", initials: "NU", tone: "conn-2" },
            ]);
            expect(one({ experts: five.slice(0, 3) }).seats.map((s) => s.name)).toEqual(["Skeptic", "New user"]);
        });

        it("takes the coordinator as the second circle when the panel has one seat", () => {
            expect(one({ experts: [seat("co", "Coordinator", true), seat("sk", "Skeptic")] }).seats).toEqual([
                { name: "Skeptic", initials: "SK", tone: "conn-1" },
                { name: "Coordinator", initials: "CO", tone: "coordinator" },
            ]);
        });

        it("shows one circle for a council of a single seat", () => {
            expect(one({ experts: [seat("sk", "Skeptic")] }).seats).toEqual([
                { name: "Skeptic", initials: "SK", tone: "conn-1" },
            ]);
        });

        it("dots the picture green while any seat writes, red when a call failed, and not otherwise", () => {
            const busy = { nu: { text: "Replying to Skeptic" } };
            const fail = { sec: { round: 2, error: "timeout" } };
            expect(one({ experts: five, state: "running", activity: busy }).dot).toBe("working");
            expect(one({ experts: five, state: "running", activity: busy, failed: fail }).dot).toBe("working");
            expect(one({ experts: five, state: "failed", failed: fail }).dot).toBe("failed");
            // activity left on a council that no longer runs is no one writing
            expect(one({ experts: five, state: "done", activity: busy }).dot).toBeNull();
            expect(one({ experts: five, state: "done" }).dot).toBeNull();
        });

        it("times the row from the newest message, not from the file's last save", () => {
            const idea = (ts: number) =>
                ({ id: `P${ts}`, author: "sk", title: "t", argument: "a", ts }) as CouncilProposal;
            const reply = (ts: number) =>
                ({ id: `r${ts}`, proposalid: "P1", author: "nu", text: "x", round: 2, ts }) as CouncilReply;
            // no message yet: when it started, else when it was created
            expect(one({ created: 100, updated: 9000 }).lastAt).toBe(100);
            expect(one({ created: 100, started: 300, updated: 9000 }).lastAt).toBe(300);
            // ideas and replies: the newest of them
            expect(
                one({ started: 300, proposals: [idea(500), idea(400)], replies: [reply(700), reply(600)] }).lastAt
            ).toBe(700);
            expect(one({ started: 300, proposals: [idea(800)], replies: [reply(700)] }).lastAt).toBe(800);
            // a summary after them
            const summary = { text: "s", directions: [], outcomes: {}, at: 950 } as CouncilSummary;
            expect(one({ started: 300, proposals: [idea(800)], summary, updated: 9999 }).lastAt).toBe(950);
        });
    });
});

describe("newCouncilRoot", () => {
    const projects = { waveterm: { path: "D:\\code\\waveterm" }, loom: { path: "D:\\code\\loom" }, bare: {} };

    it("is the root of the project of the agent or terminal in focus", () => {
        expect(newCouncilRoot(agent("a", undefined, "loom"), projects)).toBe("D:\\code\\loom");
    });
    it("falls back to the first registered project with a path when nothing is in focus or its project is not registered", () => {
        expect(newCouncilRoot(undefined, projects)).toBe("D:\\code\\waveterm");
        expect(newCouncilRoot(agent("a", undefined, "scratch"), projects)).toBe("D:\\code\\waveterm");
        // a registered project with no path is no root
        expect(newCouncilRoot(agent("a", undefined, "bare"), projects)).toBe("D:\\code\\waveterm");
        expect(newCouncilRoot(undefined, { bare: {}, loom: { path: "/loom" } })).toBe("/loom");
    });
    it("is empty when no project is registered", () => {
        expect(newCouncilRoot(undefined, {})).toBe("");
        expect(newCouncilRoot(agent("a"), { bare: {} })).toBe("");
    });
});

describe("projectLabel", () => {
    it("calls the terminals with no project Home, and names every other folder as it is", () => {
        expect(projectLabel(HOME_PROJECT)).toBe("No folder");
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
        expect(folderCounts(0, 0, 0)).toBe("");
    });
    it("counts the held services as apps, last", () => {
        expect(folderCounts(0, 0, 1)).toBe("1 app");
        expect(folderCounts(1, 2, 2)).toBe("1 agent · 2 terminals · 2 apps");
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
    it("skips the council rows: they are no focus target, so j/k and Alt+digit never land on them", () => {
        const rows = projectTree({
            tree: treeOf(agents),
            terminals,
            filter: ALL_PROJECTS,
            collapsed: [],
            roots: new Map([
                ["waveterm", "/code/waveterm"],
                ["loom", "/code/loom"],
            ]),
            councils: new Map([
                [
                    "waveterm",
                    [
                        {
                            id: "c1",
                            feature: "f",
                            created: 1,
                            meta: "Done",
                            tone: "muted" as const,
                            seats: [],
                            dot: null,
                            lastAt: 1,
                            unread: false,
                            pinned: false,
                        },
                    ],
                ],
            ]),
        });
        expect(rows.filter((r) => r.kind === "council")).toHaveLength(1);
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
    it("reaches a brainstorm's check and judge sessions right after their agent", () => {
        const brainstorming: AgentVM = {
            ...agent("bs"),
            builderCheck: { state: "reading", ts: 1, runId: "chk-1" },
            brainstormJudge: { state: "reading", ts: 2, runId: "jdg-1" },
        };
        const rows = projectTree({
            tree: treeOf([
                { ...agent("rv"), runId: "chk-1" },
                { ...agent("jd"), runId: "jdg-1" },
                brainstorming,
                agent("b"),
            ]),
            terminals: [],
            filter: ALL_PROJECTS,
            collapsed: [],
            roots: new Map(),
        });
        expect(treeNavIds(rows)).toEqual(["bs", "rv", "jd", "b"]);
    });
    it("skips a worker row whose session is gone, and rows that are not a session", () => {
        const gone = { kind: "worker", project: "p", run: {}, task: {} } as unknown as ProjectTreeRow;
        const rows: ProjectTreeRow[] = [
            { kind: "group", project: "p", agents: 1, terminals: 0, services: 0, attn: 0, running: 0, open: true },
            gone,
            { kind: "divider", project: "p" },
        ];
        expect(treeNavIds(rows)).toEqual([]);
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

describe("jarvisCountsByProject", () => {
    const item = (over: Partial<AttentionItem>): AttentionItem => ({
        kind: "dag-gate",
        key: Math.random().toString(),
        source: "",
        text: "",
        action: "Review",
        phaseidx: 0,
        waitingsince: 0,
        ...over,
    });
    const run = (runId: string, project: string) => ({ runId, channelId: "", title: "", project }) as RunInfo;

    it("files an item under its run's project, from the lineage first, then an agent of that run", () => {
        const worker = { ...agent("w", undefined, "arcterm"), runId: "r2" };
        const counts = jarvisCountsByProject(
            [item({ runid: "r1" }), item({ runid: "r1" }), item({ runid: "r2" })],
            { r1: run("r1", "portal") },
            [worker]
        );
        expect(Object.fromEntries(counts)).toEqual({ portal: 2, arcterm: 1 });
    });

    it("files a blocked queue entry under its queued row's folder, and leaves out what names no run", () => {
        const queue = [{ project: "portal", entry: { id: "q1" } as RunQueueEntry, place: 1, afters: [] }];
        const counts = jarvisCountsByProject(
            [item({ queueid: "q1" }), item({ kind: "learn-proposal" }), item({ runid: "gone" })],
            {},
            [],
            queue
        );
        expect(Object.fromEntries(counts)).toEqual({ portal: 1 });
    });
});

describe("projectClose: what Close project closes", () => {
    const term = (id: string, project = "arc"): AgentVM => ({ ...agent(id, undefined, project), kind: "terminal" });
    const run = { runId: "run-1", project: "arc" } as RunInfo;
    // a worker's own project is its tree's folder name, which a run in a worktree reads as something else
    const lineage: Lineage = {
        roles: {
            w1: { kind: "worker", leadRunId: "run-1", taskId: "t1" },
            s1: { kind: "stage", leadRunId: "run-1", stageRole: "verifier" },
        },
        runs: { "run-1": run },
    };
    const input = {
        project: "arc",
        agents: [
            { ...agent("a1", undefined, "arc"), state: "working" },
            { ...agent("a2", undefined, "arc"), state: "sleeping" },
            { ...agent("w1", undefined, "arc-wt-1f04"), state: "working" },
            { ...agent("s1", undefined, "arc-wt-1f04"), state: "idle" },
            agent("o1", undefined, "notes"),
        ] as AgentVM[],
        terminals: [term("t1"), term("t2"), term("svc"), term("t3", "notes")],
        lineage,
        serviceTabs: new Set(["svc"]),
    };

    it("takes Home's agents with no project along with its terminals with none", () => {
        const got = projectClose({
            ...input,
            project: HOME_PROJECT,
            agents: [agent("loose", undefined, ""), agent("a1", undefined, "arc")],
            terminals: [term("h", ""), term("t1")],
        });
        expect(got.agents.map((a) => a.id)).toEqual(["loose"]);
        expect(got.terminals.map((t) => t.id)).toEqual(["h"]);
    });

    it("closes a registered project named Home without the No folder launches", () => {
        const all = {
            ...input,
            agents: [agent("mine", undefined, "Home"), agent("loose", undefined, "")],
            terminals: [term("h", "")],
        };
        const home = projectClose({ ...all, project: "Home", roots: new Map([["Home", "C:/code/Home"]]) });
        expect(home.agents.map((a) => a.id)).toEqual(["mine"]);
        expect(home.terminals).toEqual([]);
        // with no project named Home, a launch stamped Home is No folder's
        const none = projectClose({ ...all, project: HOME_PROJECT });
        expect(none.agents.map((a) => a.id)).toEqual(["mine", "loose"]);
    });

    it("takes the folder's agents with its run's workers and stage sessions, and its terminals but a service's", () => {
        const close = projectClose(input);
        expect(close.agents.map((a) => a.id)).toEqual(["a1", "a2", "w1", "s1"]);
        expect(close.terminals.map((t) => t.id)).toEqual(["t1", "t2"]);
        expect(close.working).toBe(2);
    });

    it("takes nothing from another folder", () => {
        const close = projectClose({ ...input, project: "notes" });
        expect(close.agents.map((a) => a.id)).toEqual(["o1"]);
        expect(close.terminals.map((t) => t.id)).toEqual(["t3"]);
    });

    it("words the confirm with what it closes, what will stop and what stays", () => {
        expect(projectCloseMessage("arc", projectClose(input))).toBe(
            'Close "arc" and its 4 agents and 2 terminals? 2 are working and will stop. Their conversations stay in Conversations.'
        );
        expect(projectCloseMessage("notes", projectClose({ ...input, project: "notes" }))).toBe(
            'Close "notes" and its 1 agent and 1 terminal? 1 is working and will stop. Their conversations stay in Conversations.'
        );
        expect(projectCloseMessage("arc", { agents: [], terminals: [term("t1")], working: 0 })).toBe(
            'Close "arc" and its 1 terminal?'
        );
        expect(projectCloseMessage("arc", { agents: [], terminals: [], working: 0 })).toBe("");
    });
});
