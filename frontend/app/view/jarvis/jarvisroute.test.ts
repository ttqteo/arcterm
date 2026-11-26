// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import type { AgentVM } from "@/app/view/agents/agentsviewmodel";
import { HOME_NAME, NO_FOLDER_LABEL } from "@/app/view/agents/launcher";
import { describe, expect, it } from "vitest";
import {
    allProjectChoices,
    buildRoutePrompt,
    decideForProject,
    decideRoute,
    NO_FOLDER_PROJECT,
    openAgentsForRouting,
    resolveChoice,
    ROUTABLE_HARNESSES,
    routeProjectLabel,
    splitRouteReply,
    type RouteAgent,
    type RouteIdea,
    type RouteVerdict,
    type RouteWorld,
} from "./jarvisroute";

const NO_FOLDER_PATH = "C:/Users/me/.arc/no-folder";
const LOOM = { name: "loom", path: "D:/work/loom" };
const ATLAS = { name: "atlas", path: "D:/work/atlas" };

function agent(over: Partial<RouteAgent> & { id: string }): RouteAgent {
    return { name: over.id, project: "loom", state: "idle", sleeping: false, task: "", ...over };
}

function idea(over: Partial<RouteIdea> & { id: string }): RouteIdea {
    return { gist: `gist of ${over.id}`, project: "loom", initiative: "", ...over };
}

function world(agents: RouteAgent[] = [], ideas: RouteIdea[] = []): RouteWorld {
    return { projects: [LOOM, ATLAS], agents, ideas, noFolderPath: NO_FOLDER_PATH };
}

function verdict(over: Partial<RouteVerdict> = {}): RouteVerdict {
    return {
        project: "loom",
        agent: "",
        ambiguous: false,
        task: "do the job",
        reason: "it is loom's",
        considered: [],
        ...over,
    };
}

const ok = (v: RouteVerdict) => ({ verdict: v, malformed: false });

function block(json: string): string {
    return "```arc-route\n" + json + "\n```";
}

describe("routeProjectLabel", () => {
    it("names No folder by its label and a project by its name", () => {
        expect(routeProjectLabel(NO_FOLDER_PROJECT)).toBe(NO_FOLDER_LABEL);
        expect(routeProjectLabel("loom")).toBe("loom");
    });
});

describe("splitRouteReply", () => {
    it("treats a reply with no block as an answer and keeps all of its text", () => {
        const text = "Use `git rebase --onto`.\n\n```sh\ngit rebase --onto a b\n```\nThat is all.";
        expect(splitRouteReply(text)).toEqual({ visible: text, verdict: null, malformed: false });
    });

    it("hides a complete block and parses it", () => {
        const json = JSON.stringify({
            project: "loom",
            agent: "t1",
            ambiguous: false,
            task: "fix the race",
            reason: "it names loom",
            considered: ["loom", "atlas"],
        });
        const split = splitRouteReply(`On it.\n\n${block(json)}\n`);
        expect(split.visible).toBe("On it.");
        expect(split.malformed).toBe(false);
        expect(split.verdict).toEqual({
            project: "loom",
            agent: "t1",
            ambiguous: false,
            task: "fix the race",
            reason: "it names loom",
            considered: ["loom", "atlas"],
        });
    });

    it("hides a block that is still open mid-stream", () => {
        const split = splitRouteReply('Sending it.\n```arc-route\n{"project": "lo');
        expect(split.visible).toBe("Sending it.");
        expect(split.verdict).toBeNull();
        expect(split.malformed).toBe(true);
    });

    it("hides a partial opening line at the very end", () => {
        for (const tail of ["`", "``", "```", "```a", "```arc", "```arc-rou", "```arc-route"]) {
            expect(splitRouteReply(`Sending it.\n${tail}`).visible).toBe("Sending it.");
        }
        expect(splitRouteReply("```").visible).toBe("");
    });

    it("keeps a closing fence of an ordinary code block at the end", () => {
        const text = "Run:\n```sh\nls\n```";
        expect(splitRouteReply(text).visible).toBe(text);
    });

    it("keeps a code fence that is not an arc-route opener", () => {
        const text = "A:\n```js\nconst x = 1;\n```\nB.";
        expect(splitRouteReply(text).visible).toBe(text);
    });

    it("defaults the optional fields", () => {
        const split = splitRouteReply(block('{"task": "do it"}'));
        expect(split.verdict).toEqual({
            project: "",
            agent: "",
            ambiguous: false,
            task: "do it",
            reason: "",
            considered: [],
        });
    });

    it("reads a block whose closing fence is missing when its JSON is whole", () => {
        const split = splitRouteReply('Done.\n```arc-route\n{"project": "loom", "task": "go"}');
        expect(split.malformed).toBe(false);
        expect(split.verdict?.project).toBe("loom");
        expect(split.visible).toBe("Done.");
    });

    it("cuts everything from the block on, text after it included", () => {
        const split = splitRouteReply(`Hi.\n${block('{"task": "x"}')}\nTrailing words.`);
        expect(split.visible).toBe("Hi.");
    });

    it("flags a block that is not valid JSON", () => {
        const split = splitRouteReply("Hi.\n" + block("{project: loom"));
        expect(split).toEqual({ visible: "Hi.", verdict: null, malformed: true });
    });

    it("flags a block that is not an object", () => {
        expect(splitRouteReply(block('["loom"]')).malformed).toBe(true);
        expect(splitRouteReply(block('"loom"')).malformed).toBe(true);
        expect(splitRouteReply(block("null")).malformed).toBe(true);
    });

    it("flags a block with no task, an empty task or a task that is not text", () => {
        expect(splitRouteReply(block('{"project": "loom"}')).malformed).toBe(true);
        expect(splitRouteReply(block('{"project": "loom", "task": "   "}')).malformed).toBe(true);
        expect(splitRouteReply(block('{"project": "loom", "task": 3}')).malformed).toBe(true);
    });

    it("ignores wrongly typed optional fields instead of failing", () => {
        const split = splitRouteReply(
            block(
                '{"project": 4, "agent": null, "ambiguous": "yes", "task": "t", "reason": [], "considered": ["loom", 5, ""]}'
            )
        );
        expect(split.verdict).toEqual({
            project: "",
            agent: "",
            ambiguous: false,
            task: "t",
            reason: "",
            considered: ["loom"],
        });
    });

    it("reads the ideas job a verdict names and the idea it points at", () => {
        const go = splitRouteReply(block('{"ideas": "go-through", "task": "duyệt giúp tôi"}'));
        expect(go.verdict).toMatchObject({ ideas: "go-through", task: "duyệt giúp tôi" });
        expect(go.verdict?.idea).toBeUndefined();
        const discuss = splitRouteReply(block('{"ideas": "discuss", "idea": " idea-2 ", "task": "bàn ý search"}'));
        expect(discuss.verdict).toMatchObject({ ideas: "discuss", idea: "idea-2" });
    });

    it("ignores an ideas value that is neither job, and an empty idea", () => {
        for (const bad of ['"keep"', '""', "3", "null"]) {
            const split = splitRouteReply(block(`{"project": "loom", "ideas": ${bad}, "idea": "", "task": "t"}`));
            expect(split.verdict).not.toBeNull();
            expect(split.verdict?.ideas).toBeUndefined();
            expect(split.verdict?.idea).toBeUndefined();
        }
    });
});

describe("openAgentsForRouting", () => {
    const projects = [LOOM, ATLAS];
    function vm(over: Partial<AgentVM> & { id: string }): AgentVM {
        return { name: over.id, task: "", state: "idle", agent: "claude", project: "loom", ...over };
    }

    it("keeps a claude, pi and agy agent in a registered project", () => {
        const out = openAgentsForRouting(
            [
                vm({ id: "a", project: "loom", state: "working", task: "fix race" }),
                vm({ id: "b", project: "atlas", agent: "pi" }),
                vm({ id: "c", project: "loom", agent: "agy" }),
            ],
            new Set(),
            projects
        );
        expect(out).toEqual([
            { id: "a", name: "a", project: "loom", state: "working", sleeping: false, task: "fix race" },
            { id: "b", name: "b", project: "atlas", state: "idle", sleeping: false, task: "" },
            { id: "c", name: "c", project: "loom", state: "idle", sleeping: false, task: "" },
        ]);
    });

    it("mirrors the harnesses AgentsAssignCommand reaches", () => {
        expect([...ROUTABLE_HARNESSES].sort()).toEqual(["agy", "claude", "pi"]);
    });

    it("drops a codex and an opencode agent, and one with no harness", () => {
        const out = openAgentsForRouting(
            [
                vm({ id: "x", agent: "codex" }),
                vm({ id: "y", agent: "opencode" }),
                vm({ id: "z", agent: undefined }),
                vm({ id: "ok", agent: "claude" }),
            ],
            new Set(),
            projects
        );
        expect(out.map((a) => a.id)).toEqual(["ok"]);
    });

    it("a project whose only agent is codex decides launch, not send", () => {
        const open = openAgentsForRouting([vm({ id: "x", agent: "codex", project: "loom" })], new Set(), projects);
        const action = decideForProject("loom", "do it", "r", world(open));
        expect(action.kind).toBe("launch");
    });

    it("drops run agents, council seats, asking agents, terminals and background agents", () => {
        const out = openAgentsForRouting(
            [
                vm({ id: "run", runId: "run-1" }),
                vm({ id: "seat" }),
                vm({ id: "ask", state: "asking" }),
                vm({ id: "term", kind: "terminal" }),
                vm({ id: "bg", kind: "background" }),
                vm({ id: "keep", kind: "agent" }),
                vm({ id: "keep2", kind: undefined }),
            ],
            new Set(["seat"]),
            projects
        );
        expect(out.map((a) => a.id)).toEqual(["keep", "keep2"]);
    });

    it("keeps a sleeper and marks it", () => {
        const out = openAgentsForRouting(
            [vm({ id: "zzz", sleeping: { since: 1, freedBytes: 2 } })],
            new Set(),
            projects
        );
        expect(out).toHaveLength(1);
        expect(out[0].sleeping).toBe(true);
        expect(out[0].state).toBe("idle");
    });

    it("files a No folder agent under no-folder and drops one outside every project", () => {
        const out = openAgentsForRouting(
            [
                vm({ id: "home", project: HOME_NAME }),
                vm({ id: "other", project: "elsewhere" }),
                vm({ id: "none", project: undefined }),
            ],
            new Set(),
            projects
        );
        expect(out).toEqual([
            { id: "home", name: "home", project: NO_FOLDER_PROJECT, state: "idle", sleeping: false, task: "" },
        ]);
    });
});

describe("allProjectChoices", () => {
    it("lists every project, then a new agent in No folder", () => {
        expect(allProjectChoices(world())).toEqual([
            { kind: "project", project: "loom", label: "loom" },
            { kind: "project", project: "atlas", label: "atlas" },
            {
                kind: "launch",
                project: NO_FOLDER_PROJECT,
                path: NO_FOLDER_PATH,
                label: "Open a new agent in No folder",
            },
        ]);
    });

    it("is just the No folder row when no project is registered", () => {
        const w: RouteWorld = { projects: [], agents: [], ideas: [], noFolderPath: NO_FOLDER_PATH };
        expect(allProjectChoices(w).map((c) => c.kind)).toEqual(["launch"]);
    });
});

describe("decideRoute", () => {
    const ALL = allProjectChoices(world());

    it("answers when there is no block", () => {
        expect(decideRoute({ verdict: null, malformed: false }, "what is a rebase?", world())).toEqual({
            kind: "answer",
        });
    });

    it("offers every project when the block is malformed, keeping the request as the task", () => {
        expect(decideRoute({ verdict: null, malformed: true }, "fix the thing", world())).toEqual({
            kind: "choose",
            why: "I could not tell where this goes",
            task: "fix the thing",
            choices: ALL,
        });
    });

    it("offers only the projects it considered, plus No folder, when it is unsure", () => {
        const action = decideRoute(
            ok(verdict({ ambiguous: true, project: "loom", considered: ["atlas"], reason: "two repos fit" })),
            "req",
            world()
        );
        expect(action).toEqual({
            kind: "choose",
            why: "two repos fit",
            task: "do the job",
            choices: [
                { kind: "project", project: "atlas", label: "atlas" },
                {
                    kind: "launch",
                    project: NO_FOLDER_PROJECT,
                    path: NO_FOLDER_PATH,
                    label: "Open a new agent in No folder",
                },
            ],
        });
    });

    it("drops considered names that are not registered, and falls back to every project when none is left", () => {
        const some = decideRoute(
            ok(verdict({ ambiguous: true, considered: ["ghost", "loom", "no-folder", "loom"] })),
            "r",
            world()
        );
        expect(some.kind === "choose" && some.choices.map((c) => c.label)).toEqual([
            "loom",
            "Open a new agent in No folder",
        ]);
        const none = decideRoute(ok(verdict({ ambiguous: true, considered: ["ghost"] })), "r", world());
        expect(none.kind === "choose" && none.choices).toEqual(ALL);
    });

    it("says it is unsure in its own words only when it gave a reason", () => {
        const withReason = decideRoute(ok(verdict({ ambiguous: true, reason: "two fit" })), "r", world());
        const without = decideRoute(ok(verdict({ ambiguous: true, reason: "" })), "r", world());
        expect(withReason.kind === "choose" && withReason.why).toBe("two fit");
        expect(without.kind === "choose" && without.why).toBe("I could not tell where this goes");
    });

    it("treats an empty project as unsure", () => {
        const action = decideRoute(ok(verdict({ project: "", considered: ["atlas"] })), "r", world());
        expect(action.kind === "choose" && action.choices.map((c) => c.label)).toEqual([
            "atlas",
            "Open a new agent in No folder",
        ]);
    });

    it("offers every project for a project it does not know", () => {
        const action = decideRoute(ok(verdict({ project: "D:/work/loom" })), "r", world());
        expect(action).toEqual({
            kind: "choose",
            why: "I could not tell where this goes",
            task: "do the job",
            choices: ALL,
        });
    });

    it("matches a project name ignoring case and spaces around it", () => {
        const action = decideRoute(ok(verdict({ project: " Loom " })), "r", world());
        expect(action.kind).toBe("launch");
        expect(action.kind === "launch" && action.project).toBe("loom");
    });

    it("launches in a project with no open agent", () => {
        expect(decideRoute(ok(verdict()), "r", world())).toEqual({
            kind: "launch",
            project: "loom",
            path: LOOM.path,
            task: "do the job",
            reason: "it is loom's",
        });
    });

    it("sends to the one open agent, even a working one", () => {
        const w = world([agent({ id: "t1", state: "working" }), agent({ id: "t9", project: "atlas" })]);
        expect(decideRoute(ok(verdict()), "r", w)).toEqual({
            kind: "send",
            agentId: "t1",
            project: "loom",
            task: "do the job",
            reason: "it is loom's",
        });
    });

    it("lets the person choose among two open agents, the named one first, with a new-agent row", () => {
        const w = world([
            agent({ id: "t1", name: "first", state: "working" }),
            agent({ id: "t2", name: "second", sleeping: true }),
            agent({ id: "t3", project: "atlas" }),
        ]);
        const action = decideRoute(ok(verdict({ agent: "t2" })), "r", w);
        expect(action.kind).toBe("choose");
        if (action.kind !== "choose") {
            return;
        }
        expect(action.task).toBe("do the job");
        expect(action.choices).toEqual([
            { kind: "agent", agentId: "t2", project: "loom", label: "second · asleep" },
            { kind: "agent", agentId: "t1", project: "loom", label: "first · working" },
            { kind: "launch", project: "loom", path: LOOM.path, label: "Open a new agent in loom" },
        ]);
    });

    it("keeps the roster order when the named agent is not one of the project's", () => {
        const w = world([
            agent({ id: "t1", name: "first" }),
            agent({ id: "t2", name: "second" }),
            agent({ id: "t3", project: "atlas" }),
        ]);
        const action = decideRoute(ok(verdict({ agent: "t3" })), "r", w);
        expect(action.kind === "choose" && action.choices.map((c) => c.label)).toEqual([
            "first",
            "second",
            "Open a new agent in loom",
        ]);
    });

    it("launches in No folder when no agent is open there, at the No folder path", () => {
        const action = decideRoute(
            ok(verdict({ project: "no-folder", reason: "" })),
            "r",
            world([agent({ id: "t1" })])
        );
        expect(action).toEqual({
            kind: "launch",
            project: NO_FOLDER_PROJECT,
            path: NO_FOLDER_PATH,
            task: "do the job",
            reason: "",
        });
    });

    it("counts an agent filed under No folder for no-folder", () => {
        const open = openAgentsForRouting(
            [{ id: "h1", name: "h1", task: "", state: "idle", agent: "claude", project: HOME_NAME }],
            new Set(),
            [LOOM, ATLAS]
        );
        const action = decideRoute(ok(verdict({ project: "no-folder" })), "r", world(open));
        expect(action.kind === "send" && action.agentId).toBe("h1");
    });
});

describe("decideRoute: the ideas jobs", () => {
    const IDEAS = [idea({ id: "idea-1", gist: "Sidecar card" }), idea({ id: "idea-2", gist: "Search 90 days" })];

    it("turns a go-through verdict into the ideas action, whatever project it also named", () => {
        const v = verdict({ project: "", ideas: "go-through", reason: "they asked to review" });
        expect(decideRoute(ok(v), "duyệt giúp tôi", world([], IDEAS))).toEqual({
            kind: "ideas",
            op: "go-through",
            reason: "they asked to review",
        });
        // the project and the open agents of that project play no part in it
        const named = verdict({ project: "loom", agent: "t1", ideas: "go-through" });
        expect(decideRoute(ok(named), "r", world([agent({ id: "t1" })], IDEAS)).kind).toBe("ideas");
    });

    it("turns a discuss verdict naming a listed idea into the ideas action with that id", () => {
        const v = verdict({ project: "", ideas: "discuss", idea: "idea-2", reason: "it names the search idea" });
        expect(decideRoute(ok(v), "bàn ý search", world([], IDEAS))).toEqual({
            kind: "ideas",
            op: "discuss",
            ideaId: "idea-2",
            reason: "it names the search idea",
        });
    });

    it("asks back instead of discussing an idea that is not listed, or none at all", () => {
        for (const idea of ["idea-9", undefined]) {
            const v = verdict({ project: "", ideas: "discuss", idea });
            const action = decideRoute(ok(v), "bàn ý x", world([], IDEAS));
            expect(action.kind).toBe("answer");
            expect(action.kind === "answer" && action.text).toMatch(/which idea/i);
        }
    });

    it("says nothing is waiting when there is nothing to go through or discuss", () => {
        for (const v of [verdict({ ideas: "go-through" }), verdict({ ideas: "discuss", idea: "idea-1" })]) {
            const action = decideRoute(ok(v), "duyệt giúp tôi", world());
            expect(action.kind).toBe("answer");
            expect(action.kind === "answer" && action.text).toMatch(/no ideas/i);
        }
    });

    it("leaves a verdict with no ideas job to the project rule", () => {
        expect(decideRoute(ok(verdict()), "r", world([], IDEAS)).kind).toBe("launch");
    });
});

describe("decideForProject", () => {
    it("runs the same rule as a clear verdict", () => {
        expect(decideForProject("atlas", "t", "why", world()).kind).toBe("launch");
        expect(decideForProject("atlas", "t", "why", world([agent({ id: "a", project: "atlas" })])).kind).toBe("send");
    });

    it("offers every project for a name that is not registered", () => {
        const action = decideForProject("ghost", "t", "why", world());
        expect(action.kind === "choose" && action.choices).toEqual(allProjectChoices(world()));
    });
});

describe("resolveChoice", () => {
    it("sends for an agent row", () => {
        const action = resolveChoice({ kind: "agent", agentId: "t1", project: "loom", label: "x" }, "job", world());
        expect(action).toEqual({ kind: "send", agentId: "t1", project: "loom", task: "job", reason: "you picked it" });
    });

    it("launches for a launch row", () => {
        const action = resolveChoice(
            { kind: "launch", project: "loom", path: LOOM.path, label: "x" },
            "job",
            world([agent({ id: "t1" })])
        );
        expect(action).toEqual({
            kind: "launch",
            project: "loom",
            path: LOOM.path,
            task: "job",
            reason: "you picked it",
        });
    });

    it("applies the project rule for a project row", () => {
        expect(resolveChoice({ kind: "project", project: "atlas", label: "atlas" }, "job", world()).kind).toBe(
            "launch"
        );
        const two = world([agent({ id: "a" }), agent({ id: "b" })]);
        expect(resolveChoice({ kind: "project", project: "loom", label: "loom" }, "job", two).kind).toBe("choose");
        const one = world([agent({ id: "a" })]);
        expect(resolveChoice({ kind: "project", project: "loom", label: "loom" }, "job", one)).toMatchObject({
            kind: "send",
            agentId: "a",
            reason: "you picked it",
        });
    });
});

describe("buildRoutePrompt", () => {
    const REQUEST = 'Fix the "race" in the sync loop,\nthen add a test. Use `npm test`.';
    const w = world([
        agent({ id: "tab-aaa", name: "loom-1", project: "loom", state: "working", task: "Fix duplicate-session race" }),
        agent({ id: "tab-bbb", name: "atlas-1", project: "atlas", sleeping: true, task: "Index the map" }),
        agent({ id: "tab-ccc", name: "home-1", project: NO_FOLDER_PROJECT, task: "" }),
    ]);
    const prompt = buildRoutePrompt(REQUEST, w);

    it("says it routes from No folder", () => {
        expect(prompt).toContain("No folder");
        expect(prompt).toContain("Jarvis");
    });

    it("lists every project with its path", () => {
        for (const p of w.projects) {
            expect(prompt).toContain(p.name);
            expect(prompt).toContain(p.path);
        }
    });

    it("lists every open agent with its tab id, project, state and last task", () => {
        for (const a of w.agents) {
            expect(prompt).toContain(a.name);
            expect(prompt).toContain(a.id);
        }
        expect(prompt).toContain("Fix duplicate-session race");
        expect(prompt).toContain("Index the map");
        expect(prompt).toContain("working");
        expect(prompt).toContain("asleep");
        expect(prompt).toContain("idle");
    });

    it("contains the request verbatim", () => {
        expect(prompt).toContain(REQUEST);
    });

    it("asks for one arc-route fence, only for a job", () => {
        expect(prompt).toContain("```arc-route");
        expect(prompt.match(/```arc-route/g)).toHaveLength(1);
        expect(prompt).toMatch(/question/i);
        for (const key of ["project", "agent", "ambiguous", "task", "reason", "considered"]) {
            expect(prompt).toContain(`"${key}"`);
        }
    });

    it("never offers a path as a project value", () => {
        expect(prompt).toContain("no-folder");
        expect(prompt).toMatch(/never a path/i);
        const template = /```arc-route\n([^\n]*)\n```/.exec(prompt)?.[1] ?? "";
        expect(template).not.toBe("");
        for (const p of w.projects) {
            expect(template).not.toContain(p.path);
        }
        expect(template).not.toMatch(/[A-Za-z]:[\\/]|[\\/]/);
    });

    it("notes when nothing is registered or open", () => {
        const empty = buildRoutePrompt("hi", { projects: [], agents: [], ideas: [], noFolderPath: NO_FOLDER_PATH });
        expect(empty).toContain("hi");
        expect(empty).toMatch(/no projects/i);
        expect(empty).toMatch(/no open agents/i);
        expect(empty).toMatch(/no ideas/i);
    });

    it("lists the ideas waiting under their own heading, with id, gist, project and initiative", () => {
        const withIdeas = buildRoutePrompt(
            "ý nào liên quan Sidecar?",
            world(
                [],
                [
                    idea({
                        id: "idea-1",
                        gist: "A Sidecar card for a council",
                        project: "loom",
                        initiative: "Sidecar",
                    }),
                    idea({ id: "idea-2", gist: "Search back\n90 days", project: "atlas" }),
                ]
            )
        );
        const heading = withIdeas.indexOf("Ideas from your sessions, waiting for a decision:");
        expect(heading).toBeGreaterThan(-1);
        // before the request, which stays last
        expect(heading).toBeLessThan(withIdeas.indexOf("The request:"));
        const first = withIdeas.split("\n").find((l) => l.includes("idea-1")) ?? "";
        expect(first).toContain("A Sidecar card for a council");
        expect(first).toContain("loom");
        expect(first).toContain("Sidecar");
        const second = withIdeas.split("\n").find((l) => l.includes("idea-2")) ?? "";
        expect(second).toContain("Search back 90 days");
        expect(second).toMatch(/new idea/i);
    });

    it("tells Jarvis to set ideas and idea for a go-through or discuss job, and leave project and agent empty", () => {
        for (const key of ["ideas", "idea"]) {
            expect(prompt).toContain(`"${key}"`);
        }
        expect(prompt).toContain("go-through");
        expect(prompt).toContain("discuss");
        expect(prompt).toMatch(/duyệt giúp tôi/);
    });

    it("keeps an agent's multi-line task on one line", () => {
        const long = "first line\nsecond line " + "x".repeat(400);
        const p = buildRoutePrompt("r", world([agent({ id: "t1", task: long })]));
        const line = p.split("\n").find((l) => l.includes("t1")) ?? "";
        expect(line).toContain("first line second line");
        expect(line.length).toBeLessThan(400);
    });
});
