// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { describe, expect, it } from "vitest";
import type { AgentVM } from "./agentsviewmodel";
import type { AgentTreeRow } from "./agenttreemodel";
import {
    agentRefs,
    boardRefs,
    councilRefs,
    effortRefs,
    insertRef,
    queryKind,
    REF_MAX_ROWS,
    refHitMask,
    refMatches,
    refToken,
    runRefs,
    sessionRefs,
    topLevelAgentIds,
    type RefItem,
} from "./refmention";

const agent = (id: string, task: string, extra: Partial<AgentVM> = {}): AgentVM =>
    ({ id, name: "loom", task, state: "idle", project: "arcterm", agent: "claude", ...extra }) as AgentVM;

const run = (oid: string, goal: string, extra: Partial<Run> = {}): Run =>
    ({ oid, goal, status: "done", mode: "orchestrator", createdts: 1, ...extra }) as unknown as Run;

const council = (id: string, feature: string): Council => ({ id, feature, state: "done" }) as unknown as Council;

const NOW = 1_800_000_000_000;
const HOUR = 3_600_000;
const DAY = 24 * HOUR;

const session = (id: string, task: string, agoMs: number, extra: Partial<SessionActivity> = {}): SessionActivity =>
    ({
        id,
        runtime: "claude",
        projectpath: "D:\\projects\\arcterm",
        projectname: "arcterm",
        task,
        lastactivets: NOW - agoMs,
        resumecommand: `claude --resume ${id}`,
        ...extra,
    }) as SessionActivity;

const effort = (oid: string, title: string, extra: Partial<EffortSummary> = {}): EffortSummary =>
    ({
        oref: `effort:${oid}`,
        title,
        project: "arcterm",
        status: "active",
        done: 4,
        total: 9,
        updatedts: 1,
        ...extra,
    }) as EffortSummary;

describe("agentRefs", () => {
    it("lists every agent but the chat's own and plain terminals, in roster order", () => {
        const refs = agentRefs(
            [
                agent("self0000-1", "this chat"),
                agent("aaaa1111-1", "Docs v5"),
                agent("term0000-1", "", { kind: "terminal" }),
                agent("bbbb2222-1", "", { kind: "background", name: "bg" }),
            ],
            "self0000-1"
        );
        expect(refs.map((r) => [r.id, r.label])).toEqual([
            ["aaaa1111-1", "Docs v5"],
            ["bbbb2222-1", "bg"],
        ]);
        expect(refs[0].detail).toBe("arcterm · claude · idle");
    });

    it("puts the agents of the chat's own project first, each group in roster order", () => {
        const refs = agentRefs(
            [
                agent("aaaa1111-1", "other one", { project: "arcterm" }),
                agent("self0000-1", "this chat", { project: "mit-thesis" }),
                agent("bbbb2222-1", "other two", { project: "SIEM" }),
                agent("cccc3333-1", "same one", { project: "mit-thesis" }),
                agent("dddd4444-1", "same two", { project: "mit-thesis" }),
            ],
            "self0000-1"
        );
        expect(refs.map((r) => r.id)).toEqual(["cccc3333-1", "dddd4444-1", "aaaa1111-1", "bbbb2222-1"]);
        // the cap keeps a same-project agent that sits last in the roster
        const many = agentRefs(
            [
                ...Array.from({ length: 8 }, (_, i) => agent(`a${i}000000`, `task ${i}`, { project: "arcterm" })),
                agent("self0000-1", "this chat", { project: "mit-thesis" }),
                agent("b9b1b3ba-1", "Tiềm năng", { project: "mit-thesis" }),
            ],
            "self0000-1"
        );
        expect(refMatches("agent", many)[0].id).toBe("b9b1b3ba-1");
    });
});

describe("agentRefs and the runs listed", () => {
    it("leaves out the lead of a run the picker lists, and keeps a worker of it and the lead of a run it does not", () => {
        const refs = agentRefs(
            [
                agent("lead-1", "Build Library", { runId: "run-a" }),
                agent("worker-1", "Task 3", { runId: "run-a-t-3" }),
                agent("lead-2", "Old run", { runId: "run-b" }),
            ],
            "",
            new Set(["run-a"])
        );
        expect(refs.map((r) => r.id)).toEqual(["worker-1", "lead-2"]);
    });

    it("keeps only the Agent tree's top-level agents when given them", () => {
        const refs = agentRefs(
            [
                agent("lead-1", "Build Library", { runId: "run-a" }),
                agent("worker-1", "Task 3", { runId: "run-a-t-3" }),
                agent("reviewer-1", "You are the plan reviewer for run run-a", { runId: "run-a-pr" }),
                agent("plain-1", "Docs v5"),
            ],
            "",
            new Set(),
            new Set(["lead-1", "plain-1"])
        );
        expect(refs.map((r) => r.id)).toEqual(["lead-1", "plain-1"]);
    });
});

describe("topLevelAgentIds", () => {
    it("takes the plain and lead rows, nested waiters included, and leaves workers, stages and checks", () => {
        const a = (id: string) => agent(id, id);
        const rows = [
            { kind: "group", project: "arcterm", count: 5, attn: 0, running: 0 },
            { kind: "lead", agent: a("lead-1"), project: "arcterm", run: {}, open: true, live: 1 },
            { kind: "worker", agent: a("worker-1"), project: "arcterm" },
            { kind: "stage", agent: a("reviewer-1"), project: "arcterm" },
            { kind: "parent", agent: a("plain-1"), project: "arcterm" },
            { kind: "parent", agent: a("waiter-1"), project: "arcterm", nested: true },
            { kind: "check", agent: a("check-1"), project: "arcterm", stageRole: "builder-check", state: "running" },
        ] as unknown as AgentTreeRow[];
        expect([...topLevelAgentIds(rows)]).toEqual(["lead-1", "plain-1", "waiter-1"]);
    });
});

describe("runRefs", () => {
    it("keeps top-level runs only, newest first", () => {
        const refs = runRefs([
            run("r-old", "old", { createdts: 1 }),
            run("r-task", "a task", { createdts: 5, taskid: "t1" } as Partial<Run>),
            run("r-new", "new", { createdts: 9 }),
        ]);
        expect(refs.map((r) => r.id)).toEqual(["r-new", "r-old"]);
        expect(refs[0].detail).toBe("done · orchestrator");
    });

    it("leaves out the sessions a run started: plan reviewers, verifiers, reviewers", () => {
        const refs = runRefs([
            run("r-lead", "Kael sync 11-19", { createdts: 1 }),
            run("r-pr", "You are the plan reviewer for run r-lead.", {
                createdts: 2,
                mode: "quick",
                stagerole: "plan-reviewer",
            }),
            run("r-rev", "review task 2", { createdts: 3, review: true }),
        ]);
        expect(refs.map((r) => r.id)).toEqual(["r-lead"]);
    });

    it("is empty before the runs load", () => {
        expect(runRefs(null)).toEqual([]);
    });
});

describe("sessionRefs", () => {
    it("lists the conversations newest first, with the task's first line, project, runtime and age", () => {
        const refs = sessionRefs(
            [
                session("older000-1", "Older chat", 3 * DAY),
                session("newer000-1", "Fix CDP fails\nsecond line", 2 * HOUR),
                session("blank000-1", "", 5 * DAY, { projectname: "mit-thesis" }),
            ],
            "",
            NOW
        );
        expect(refs.map((r) => r.id)).toEqual(["newer000-1", "older000-1", "blank000-1"]);
        expect(refs.every((r) => r.kind === "session")).toBe(true);
        // the label is the task's first line, else the project name
        expect(refs.map((r) => r.label)).toEqual(["Fix CDP fails", "Older chat", "mit-thesis"]);
        expect(refs[0].detail).toBe("arcterm · claude · 2h ago");
        expect(refs[1].detail).toBe("arcterm · claude · 3d ago");
        // ts = -index, so refMatches' ts sort keeps this order
        expect(refs.map((r) => -r.ts)).toEqual([0, 1, 2]);
    });

    it("puts the chat's project first by its path, each group newest first", () => {
        const refs = sessionRefs(
            [
                session("other000-1", "newest elsewhere", HOUR, {
                    projectpath: "D:\\projects\\mit",
                    projectname: "mit",
                }),
                session("same-old0", "older here", 4 * DAY),
                session("other000-2", "older elsewhere", 2 * DAY, { projectpath: "D:\\projects\\mit" }),
                // the same folder written with / and another case
                session("same-new0", "newer here", 3 * HOUR, { projectpath: "d:/projects/ArcTerm/" }),
            ],
            "D:\\projects\\arcterm",
            NOW
        );
        expect(refs.map((r) => r.id)).toEqual(["same-new0", "same-old0", "other000-1", "other000-2"]);
        expect(refs.map((r) => -r.ts)).toEqual([0, 1, 2, 3]);
    });

    it("orders before it cuts to 20: the project's one old conversation is still listed", () => {
        const others = Array.from({ length: 25 }, (_, i) =>
            session(`o${String(i).padStart(7, "0")}`, `other ${i}`, (i + 1) * HOUR, {
                projectpath: "D:\\projects\\mit",
            })
        );
        const mine = session("mine0000-1", "the one here", 30 * DAY);
        const refs = sessionRefs([...others, mine], "D:\\projects\\arcterm", NOW);
        expect(refs).toHaveLength(20);
        expect(refs[0].id).toBe("mine0000-1");
        expect(refs[1].id).toBe("o0000000");
        // without a project path the newest 20 are all that is listed
        expect(sessionRefs([...others, mine], "", NOW).map((r) => r.id)).not.toContain("mine0000-1");
    });

    it("lists only what the palette lists: no engine worker, reviewer or stage, nor one that cannot resume", () => {
        const refs = sessionRefs(
            [
                session("plain000-1", "a conversation", HOUR),
                session("lead0000-1", "a run's lead", HOUR, { role: "lead" }),
                session("worker00-1", "a worker", HOUR, { role: "worker" }),
                session("review00-1", "a reviewer", HOUR, { role: "reviewer" }),
                session("noresume-1", "cannot resume", HOUR, { resumecommand: "" }),
            ],
            "",
            NOW
        );
        expect(refs.map((r) => r.id)).toEqual(["plain000-1", "lead0000-1"]);
    });

    it("is empty before the archive loads", () => {
        expect(sessionRefs(null, "D:\\x", NOW)).toEqual([]);
    });
});

describe("effortRefs", () => {
    it("skips archived ones and puts the chat's project first, each group by updatedts newest first", () => {
        const refs = effortRefs(
            [
                effort("e0000001", "elsewhere new", { project: "mit", updatedts: 9 }),
                effort("e0000002", "here old", { updatedts: 2 }),
                effort("e0000003", "archived", { status: "archived", updatedts: 99 }),
                effort("e0000004", "here new", { updatedts: 5, done: 9, total: 9, status: "done" }),
                effort("e0000005", "elsewhere old", { project: "mit", updatedts: 1 }),
            ],
            "arcterm"
        );
        expect(refs.map((r) => r.id)).toEqual(["e0000004", "e0000002", "e0000001", "e0000005"]);
        expect(refs.every((r) => r.kind === "effort")).toBe(true);
        expect(refs[0].label).toBe("here new");
        expect(refs[0].detail).toBe("9/9 chunks · done");
        expect(refs[1].detail).toBe("4/9 chunks · active");
        expect(refs.map((r) => -r.ts)).toEqual([0, 1, 2, 3]);
    });

    it("keeps the oid, without effort:, as the id", () => {
        expect(effortRefs([effort("e9b20f17", "Chat polish")], "")[0].id).toBe("e9b20f17");
    });

    it("is empty before the list loads", () => {
        expect(effortRefs(null, "arcterm")).toEqual([]);
    });
});

describe("refMatches", () => {
    const items: RefItem[] = [
        ...councilRefs([council("0c28170c368b5ab0", "Sync client retry plan")]),
        ...runRefs([run("fed0d00e-a6df", "Agent chat view, round 3")]),
        ...agentRefs([agent("5065bd8c-1", "Docs rewrite draft"), agent("8e33269b-1", "Math in chat")], ""),
    ];

    it("lists nothing for a bare @ or a path", () => {
        expect(refMatches("", items)).toEqual([]);
        expect(refMatches("src/x", items)).toEqual([]);
        expect(refMatches("README.md", items)).toEqual([]);
    });

    it("lists one kind when the query names it", () => {
        expect(queryKind("cou")).toBe("council");
        expect(queryKind("r")).toBeNull();
        expect(refMatches("council", items).map((r) => r.id)).toEqual(["0c28170c368b5ab0"]);
        expect(refMatches("run", items).map((r) => r.id)).toEqual(["fed0d00e-a6df"]);
        expect(refMatches("agent", items).map((r) => r.id)).toEqual(["5065bd8c-1", "8e33269b-1"]);
    });

    it("matches an id prefix, or every word in the label and detail, agents first", () => {
        expect(refMatches("0c28", items).map((r) => r.kind)).toEqual(["council"]);
        expect(refMatches("docs draft", items).map((r) => r.id)).toEqual(["5065bd8c-1"]);
        expect(refMatches("round 3", items).map((r) => r.kind)).toEqual(["run"]);
        // "chat" is a kind word: it lists the agents, not every label that holds it
        expect(refMatches("chat", items).map((r) => r.kind)).toEqual(["agent", "agent"]);
    });

    it("matches a query written as kind:<id> by the id after the colon", () => {
        expect(refMatches("agent:5065", items).map((r) => r.id)).toEqual(["5065bd8c-1"]);
        expect(refMatches("tab:8e33269b", items).map((r) => r.id)).toEqual(["8e33269b-1"]);
        expect(refMatches("council:0c28170c", items).map((r) => r.id)).toEqual(["0c28170c368b5ab0"]);
        expect(refMatches("agent:", items).map((r) => r.id)).toEqual(["5065bd8c-1", "8e33269b-1"]);
        // the id is checked against its kind only
        expect(refMatches("run:5065", items)).toEqual([]);
    });

    it("names the conversation and initiative kinds by their words", () => {
        expect(queryKind("sess")).toBe("session");
        expect(queryKind("conv")).toBe("session");
        expect(queryKind("hội th")).toBe("session");
        expect(queryKind("init")).toBe("effort");
        expect(queryKind("eff")).toBe("effort");
        // a bare "hội" still reaches council's "hội đồng" first
        expect(queryKind("hội")).toBe("council");
    });

    it("lists conversations and initiatives by kind word or by kind:<id>", () => {
        const all: RefItem[] = [
            ...sessionRefs([session("9f31d0b4-aaaa", "Fix CDP fails", 3 * DAY)], "", NOW),
            ...effortRefs([effort("e9b20f17", "Chat polish")], ""),
            ...agentRefs([agent("5065bd8c-1", "Docs rewrite draft")], ""),
        ];
        expect(refMatches("session", all).map((r) => r.id)).toEqual(["9f31d0b4-aaaa"]);
        expect(refMatches("conv", all).map((r) => r.id)).toEqual(["9f31d0b4-aaaa"]);
        expect(refMatches("initiative", all).map((r) => r.id)).toEqual(["e9b20f17"]);
        expect(refMatches("session:9f31", all).map((r) => r.id)).toEqual(["9f31d0b4-aaaa"]);
        expect(refMatches("effort:e9b2", all).map((r) => r.id)).toEqual(["e9b20f17"]);
        expect(refMatches("session:", all)).toHaveLength(1);
        // the id is checked against its kind only
        expect(refMatches("effort:9f31", all)).toEqual([]);
        expect(refMatches("session:e9b2", all)).toEqual([]);
        expect(refToken(all[0])).toBe("session:9f31d0b4");
        expect(refToken(all[1])).toBe("effort:e9b20f17");
    });

    it("lists agents, runs and councils first, then conversations, then initiatives", () => {
        const all: RefItem[] = [
            ...effortRefs([effort("e0000001", "polish the chat")], ""),
            ...sessionRefs([session("s0000001-1", "polish the chat", HOUR)], "", NOW),
            ...councilRefs([council("c0000001aaaa", "polish the chat")]),
            ...runRefs([run("r0000001-aaaa", "polish the chat")]),
            ...agentRefs([agent("a0000001-1", "polish the chat")], ""),
        ];
        expect(refMatches("polish", all).map((r) => r.kind)).toEqual(["agent", "run", "council", "session", "effort"]);
    });

    it("matches a query typed with no spaces against a label that has them", () => {
        const all: RefItem[] = [
            ...runRefs([run("a73099e9-d931", "Build Library: trang riêng cho History")]),
            ...agentRefs([agent("d51ce43b-1", "Builder check · Nút báo lỗi")], ""),
        ];
        expect(refMatches("buildl", all).map((r) => r.id)).toEqual(["a73099e9-d931"]);
        expect(refMatches("buildlib", all).map((r) => r.id)).toEqual(["a73099e9-d931"]);
        expect(refMatches("buil", all).map((r) => r.kind)).toEqual(["agent", "run"]);
        expect(refMatches("buildx", all)).toEqual([]);
    });

    it("matches Vietnamese whichever vowel the tone was typed on, and without the marks", () => {
        const all: RefItem[] = [
            ...runRefs([run("fdfa9bad-0fca", "Build Nút báo lỗi tại chỗ")]),
            ...agentRefs([agent("4e0c5dfb-1", "SIEM-1746 báo cáo bảo mật web")], ""),
        ];
        // "baó": the tone on the o, as a new-style input method puts it; the labels have it on the a
        expect(refMatches("baó", all).map((r) => r.kind)).toEqual(["agent", "run"]);
        expect(refMatches("báo lỗi", all).map((r) => r.id)).toEqual(["fdfa9bad-0fca"]);
        expect(refMatches("bao loi", all).map((r) => r.id)).toEqual(["fdfa9bad-0fca"]);
        expect(refMatches("baoloi", all).map((r) => r.id)).toEqual(["fdfa9bad-0fca"]);
        expect(refMatches("chô", all).map((r) => r.id)).toEqual(["fdfa9bad-0fca"]);
    });

    it("shows at most REF_MAX_ROWS", () => {
        const many = agentRefs(
            Array.from({ length: 10 }, (_, i) => agent(`a${i}000000`, `task ${i}`)),
            ""
        );
        expect(refMatches("agent", many)).toHaveLength(REF_MAX_ROWS);
    });
});

describe("insertRef", () => {
    it("puts kind and an 8-character id in place of the @query, with one space after", () => {
        expect(refToken({ kind: "council", id: "0c28170c368b5ab0" })).toBe("council:0c28170c");
        expect(insertRef("đọc @coun rồi chốt", 4, 9, { kind: "council", id: "0c28170c368b5ab0" })).toEqual({
            text: "đọc council:0c28170c rồi chốt",
            caret: 21,
        });
        expect(insertRef("đọc @pap", 4, 8, { kind: "agent", id: "5065bd8c-1" })).toEqual({
            text: "đọc agent:5065bd8c ",
            caret: 19,
        });
    });
});

describe("refHitMask", () => {
    const marked = (query: string, label: string) =>
        refHitMask(query, label)
            .map((hit, i) => (hit ? label[i] : "_"))
            .join("");

    it("marks each word of the query where it sits in the label", () => {
        expect(marked("buil", "Build Library")).toBe("Buil_________");
        expect(marked("docs draft", "Docs rewrite draft")).toBe("Docs_________draft");
    });

    it("marks a query typed with no spaces across the label's spaces", () => {
        expect(marked("buildl", "Build Library")).toBe("Build_L______");
    });

    it("marks a word whichever vowel its tone was typed on", () => {
        expect(marked("baó", "Nút báo lỗi")).toBe("____báo____");
        expect(marked("baoloi", "Nút báo lỗi")).toBe("____báo_lỗi");
    });

    it("marks nothing for a kind word, an address, an id or no match", () => {
        expect(marked("run", "run the tests")).toBe("_____________");
        expect(marked("agent:5065", "agent 5065")).toBe("__________");
        expect(marked("zzz", "Build")).toBe("_____");
        expect(marked("", "Build")).toBe("_____");
    });
});

describe("boardRefs", () => {
    const board = (id: string, name: string, project: string, activets: number, extra: Partial<BoardInfo> = {}) =>
        ({ id, name, project, path: "", createdts: 0, activets, ...extra }) as BoardInfo;
    const boards = [
        board("aaaa0001", "Auth flow", "thesis", 100, { shapes: 4 }),
        board("aaaa0002", "huong-luan-van", "thesis", 300, { shapes: 19, agenttitle: "Đồng bộ history" }),
        board("aaaa0003", "Deploy", "arcterm", 900),
        board("aaaa0004", "Broken", "thesis", 999, { loaderror: "bad json" }),
    ];

    it("lists the chat project's boards newest first, the one open beside Chat at the top", () => {
        expect(boardRefs(boards, "thesis").map((r) => r.id)).toEqual(["aaaa0002", "aaaa0001"]);
        const open = boardRefs(boards, "thesis", "aaaa0001");
        expect(open.map((r) => r.id)).toEqual(["aaaa0001", "aaaa0002"]);
        expect(open[0].detail).toBe("open · 4 shapes");
        expect(open[1]).toMatchObject({
            kind: "board",
            label: "huong-luan-van",
            detail: "19 shapes · Đồng bộ history",
        });
    });

    it("lists none for a chat outside a project", () => {
        expect(boardRefs(boards, "")).toEqual([]);
    });

    it("is what @board, @draw and board:<id> find, and a pick writes board:<id>", () => {
        const items = boardRefs(boards, "thesis");
        expect(queryKind("draw")).toBe("board");
        expect(refMatches("board", items)).toHaveLength(2);
        expect(refMatches("board:aaaa0001", items).map((r) => r.id)).toEqual(["aaaa0001"]);
        expect(refMatches("huong", items).map((r) => r.id)).toEqual(["aaaa0002"]);
        expect(refToken(items[0])).toBe("board:aaaa0002");
    });
});
