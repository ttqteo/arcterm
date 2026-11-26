// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0
//
// Pure routing model for the pet's Ask box at No folder (docs/superpowers/specs/2026-11-16-jarvis-no-folder-ask-design.md,
// "Quyết định khi xây" D1-D5): the prompt a routing consult is given, the split of its streamed reply into the text the
// person reads and a trailing `arc-route` verdict, the agents a job may go to, and the rule that turns a verdict into
// answer / send / launch / choose. The model only judges; whether a job goes through or waits on a card is decided here,
// where a test can pin it, not by whether the model obeyed. No jotai, no RPC, no React.

import type { AgentVM } from "@/app/view/agents/agentsviewmodel";
import { HOME_NAME, NO_FOLDER_LABEL } from "@/app/view/agents/launcher";

// The verdict's `project` value for No folder (the folder ~/.arc/no-folder, a pick key, not a registered project).
export const NO_FOLDER_PROJECT = "no-folder";

export type RouteProject = { name: string; path: string };
export type RouteAgent = {
    id: string;
    name: string;
    project: string; // a registered project's name, or NO_FOLDER_PROJECT
    state: "working" | "idle";
    sleeping: boolean;
    task: string;
};
// The ideas jobs a verdict may name (docs/superpowers/specs/2026-11-26-session-ideas-design.md, "Jarvis"): go through every
// idea waiting, or discuss one of them. Both open an agent of their own (sessionideaslaunch.ts), never a project's agent.
export type RouteIdeasJob = "go-through" | "discuss";
export type RouteVerdict = {
    project: string;
    agent: string;
    ambiguous: boolean;
    task: string;
    reason: string;
    considered: string[];
    // set for a go-through or discuss job in place of a project or an agent; `idea` is a listed idea's id (discuss only)
    ideas?: RouteIdeasJob;
    idea?: string;
};
export type RouteChoice =
    | { kind: "agent"; agentId: string; project: string; label: string }
    | { kind: "project"; project: string; label: string }
    | { kind: "launch"; project: string; path: string; label: string };
export type RouteAction =
    // `text` is what the errand says instead of the model's own words: a question back that the rule, not the model, asked
    | { kind: "answer"; text?: string }
    | { kind: "send"; agentId: string; project: string; task: string; reason: string }
    | { kind: "launch"; project: string; path: string; task: string; reason: string }
    | { kind: "ideas"; op: RouteIdeasJob; ideaId?: string; reason: string }
    | { kind: "choose"; why: string; task: string; choices: RouteChoice[] };
// An idea waiting for a decision, as the routing prompt lists it: `initiative` is its initiative's title, empty for a new idea.
export type RouteIdea = { id: string; gist: string; project: string; initiative: string };
export type RouteWorld = {
    projects: RouteProject[];
    agents: RouteAgent[];
    ideas: RouteIdea[];
    noFolderPath: string;
};

// The harnesses AgentsAssignCommand reaches: it looks a tab up in the agent roster, which lists only these three
// (`agentHarnesses` in pkg/wshrpc/wshserver/wshserver_agentmsg.go). Keep the two in step: a codex or opencode agent
// is not on that roster, so a job handed to one would fail where launching a fresh agent would not.
export const ROUTABLE_HARNESSES: ReadonlySet<string> = new Set(["claude", "pi", "agy"]);

// What a card row says when the person, not Jarvis, picked the destination (the band's "because" clause, D11).
export const PICKED_REASON = "you picked it";

const UNSURE_WHY = "I could not tell where this goes";
const NO_IDEAS_WAITING = "No ideas from your sessions are waiting for a decision.";
const WHICH_IDEA = "I could not tell which idea you mean. Name one from What's waiting?, or press its Discuss chip.";
const ROUTE_FENCE = "```arc-route";
const TASK_LINE_MAX = 160;

export function routeProjectLabel(project: string): string {
    return project === NO_FOLDER_PROJECT ? NO_FOLDER_LABEL : project;
}

function oneLine(text: string, max: number): string {
    const flat = text.replace(/\s+/g, " ").trim();
    return flat.length > max ? flat.slice(0, max - 1).trimEnd() + "…" : flat;
}

function agentStateWord(a: Pick<RouteAgent, "state" | "sleeping">): string {
    return a.sleeping ? "asleep" : a.state;
}

// The prompt of a routing consult. The request goes last and verbatim, so nothing after it can be read as the person's
// words; a project path is listed so the model can tell which repository a request names, but the verdict's `project`
// is always a name (D1).
export function buildRoutePrompt(request: string, world: RouteWorld): string {
    const projects = world.projects.length
        ? world.projects.map((p) => `- ${p.name} (${p.path})`).join("\n")
        : "(no projects are registered)";
    const agents = world.agents.length
        ? world.agents
              .map((a) => {
                  const task = oneLine(a.task, TASK_LINE_MAX);
                  return (
                      `- ${a.name} (tab id ${a.id}) · project ${a.project} · ${agentStateWord(a)}` +
                      (task ? ` · last task: ${task}` : "")
                  );
              })
              .join("\n")
        : "(no open agents)";
    const ideas = world.ideas.length
        ? world.ideas
              .map(
                  (i) =>
                      `- ${i.id} · ${oneLine(i.gist, TASK_LINE_MAX)} · project ${i.project} · ` +
                      (i.initiative ? `initiative ${oneLine(i.initiative, TASK_LINE_MAX)}` : "a new idea")
              )
              .join("\n")
        : "(no ideas are waiting)";
    const template = JSON.stringify({
        project: "<project name | no-folder | empty>",
        agent: "<tab id of an open agent of that project | empty>",
        ambiguous: false,
        task: "<the job, for the agent>",
        reason: "<one short clause>",
        considered: ["<project name>"],
        ideas: "<go-through | discuss | empty>",
        idea: "<id of a listed idea | empty>",
    });
    return [
        "You are Jarvis, the assistant inside arcterm. The person is asking from No folder, so no project is chosen: " +
            "decide which project their request belongs to.",
        "",
        "Registered projects:",
        projects,
        "",
        "Open agents:",
        agents,
        "",
        "Ideas from your sessions, waiting for a decision:",
        ideas,
        "",
        "How to answer:",
        "- If the request is a question, answer it in plain prose. Add no arc-route block. A question about the ideas " +
            "waiting is answered from the list above.",
        "- If the request is a job to do, say in a sentence what you are doing, then end your reply with exactly one " +
            "fenced block, and nothing after it:",
        ROUTE_FENCE,
        template,
        "```",
        '- "project": the name of one registered project from the list above, or "no-folder" when the job belongs to no ' +
            "project, or an empty string when you cannot tell. It is never a path.",
        '- "agent": the tab id of one open agent of that project that should take the job, or an empty string.',
        '- "ambiguous": true whenever you are not sure which project the job belongs to.',
        '- "task": what the agent is to do, in the person\'s own words; you may reword it for clarity but not add to it.',
        '- "reason": one short clause on why this project, or why you are unsure.',
        '- "considered": when ambiguous, the project names you weighed; otherwise leave it empty.',
        '- "ideas": set it only when the request is to go through the ideas listed above ("duyệt giúp tôi", "go through ' +
            'them") with "go-through", or to discuss one of them ("bàn ý <x>", "discuss <x>") with "discuss". Such a ' +
            'job opens an agent of its own, so leave "project" and "agent" empty for it. Otherwise leave "ideas" empty.',
        '- "idea": for "discuss", the id of the one listed idea the person means, never its words; if you cannot tell ' +
            "which one, ask in plain prose and add no arc-route block. Otherwise leave it empty.",
        "",
        "The request:",
        request,
    ].join("\n");
}

// A line that opens a fenced block: up to three spaces of indent, then the fence.
const FENCE_LINE = /^ {0,3}```/;
const ROUTE_OPEN_LINE = /^ {0,3}```arc-route/;

function lineStarts(text: string): number[] {
    const starts = [0];
    for (let i = 0; i < text.length; i++) {
        if (text[i] === "\n") {
            starts.push(i + 1);
        }
    }
    return starts;
}

// Where the arc-route block begins in `text` (an index), or -1. A partial opening line at the very end counts too,
// while the fence is still arriving ("`", "```", "```arc"), except a bare fence that closes an ordinary code block.
function routeBlockStart(text: string): number {
    const starts = lineStarts(text);
    let fences = 0; // fence lines seen so far: odd means the next fence line closes a block
    for (let i = 0; i < starts.length; i++) {
        const end = i + 1 < starts.length ? starts[i + 1] - 1 : text.length;
        const line = text.slice(starts[i], end).replace(/\r$/, "");
        if (ROUTE_OPEN_LINE.test(line)) {
            return starts[i];
        }
        const isLast = i === starts.length - 1;
        if (isLast) {
            const bare = line.replace(/^ {0,3}/, "");
            const partialOpen = bare !== "" && ROUTE_FENCE.startsWith(bare);
            // a lone "```" or "`" after an odd number of fences is a closer (or ordinary text), not an opener
            if (partialOpen && fences % 2 === 0) {
                return starts[i];
            }
        }
        if (FENCE_LINE.test(line)) {
            fences++;
        }
    }
    return -1;
}

// The JSON text of the block that starts at `start`: the lines after its opening line up to the first closing fence, or
// to the end when the fence has not arrived.
function blockBody(text: string, start: number): string {
    const nl = text.indexOf("\n", start);
    if (nl === -1) {
        return "";
    }
    const lines: string[] = [];
    for (const line of text.slice(nl + 1).split("\n")) {
        if (/^ {0,3}```\s*$/.test(line.replace(/\r$/, ""))) {
            break;
        }
        lines.push(line);
    }
    return lines.join("\n");
}

function stringField(o: Record<string, unknown>, key: string): string {
    const v = o[key];
    return typeof v === "string" ? v.trim() : "";
}

function parseVerdict(body: string): RouteVerdict | null {
    let raw: unknown;
    try {
        raw = JSON.parse(body);
    } catch {
        return null;
    }
    if (raw == null || typeof raw !== "object" || Array.isArray(raw)) {
        return null;
    }
    const o = raw as Record<string, unknown>;
    const task = stringField(o, "task");
    if (task === "") {
        return null;
    }
    const considered = Array.isArray(o.considered)
        ? o.considered.filter((c): c is string => typeof c === "string" && c.trim() !== "").map((c) => c.trim())
        : [];
    const verdict: RouteVerdict = {
        project: stringField(o, "project"),
        agent: stringField(o, "agent"),
        ambiguous: o.ambiguous === true,
        task,
        reason: stringField(o, "reason"),
        considered,
    };
    // present only when set: a verdict for a project reads exactly as it did before the ideas jobs
    const ideas = stringField(o, "ideas");
    if (ideas === "go-through" || ideas === "discuss") {
        verdict.ideas = ideas;
        const idea = stringField(o, "idea");
        if (idea !== "") {
            verdict.idea = idea;
        }
    }
    return verdict;
}

// Splits a (possibly still streaming) reply into the text the person reads and the verdict it ends with. Everything
// from the opening of the arc-route block on is cut from `visible`, a block still open included. No block is a question
// that was answered; a block that does not read is `malformed`, which the rule turns into the chooser card.
export function splitRouteReply(text: string): { visible: string; verdict: RouteVerdict | null; malformed: boolean } {
    const start = routeBlockStart(text);
    if (start === -1) {
        return { visible: text, verdict: null, malformed: false };
    }
    const visible = text.slice(0, start).trimEnd();
    const verdict = parseVerdict(blockBody(text, start));
    return { visible, verdict, malformed: verdict == null };
}

// The agents a job may be handed to (D4 and the harness amendment): agents the person opened themselves, in a registered
// project or in No folder, that are not asking, not an engine's or a council's, and that AgentsAssignCommand can reach.
// A sleeper stays: the hand-off wakes it. A registered project wins over No folder if one is itself named "Home".
export function openAgentsForRouting(
    agents: AgentVM[],
    councilSeatTabs: ReadonlySet<string>,
    projects: RouteProject[]
): RouteAgent[] {
    const names = new Set(projects.map((p) => p.name));
    const out: RouteAgent[] = [];
    for (const a of agents) {
        if (a.kind != null && a.kind !== "agent") {
            continue;
        }
        if (a.runId || councilSeatTabs.has(a.id) || a.state === "asking") {
            continue;
        }
        if (!a.agent || !ROUTABLE_HARNESSES.has(a.agent)) {
            continue;
        }
        const project = a.project ?? "";
        const filed = names.has(project) ? project : project === HOME_NAME ? NO_FOLDER_PROJECT : "";
        if (filed === "") {
            continue;
        }
        out.push({
            id: a.id,
            name: a.name,
            project: filed,
            state: a.state === "working" ? "working" : "idle",
            sleeping: a.sleeping != null,
            task: a.task,
        });
    }
    return out;
}

function noFolderLaunchChoice(world: RouteWorld): RouteChoice {
    return launchChoice(NO_FOLDER_PROJECT, world.noFolderPath);
}

function launchChoice(project: string, path: string): RouteChoice {
    return { kind: "launch", project, path, label: `Open a new agent in ${routeProjectLabel(project)}` };
}

function projectChoice(name: string): RouteChoice {
    return { kind: "project", project: name, label: name };
}

// Every project, then a new agent in No folder: the card for a verdict that named no usable project, and the band's
// "Wrong project?" list (Task 5). The caller supplies a non-empty `noFolderPath`.
export function allProjectChoices(world: RouteWorld): RouteChoice[] {
    return [...world.projects.map((p) => projectChoice(p.name)), noFolderLaunchChoice(world)];
}

// A verdict's project as a key: a registered project's own name, NO_FOLDER_PROJECT, or null for anything else. The match
// ignores case and the spaces around the name, since the model writes the name from a list but not always letter for letter.
function resolveProject(value: string, world: RouteWorld): string | null {
    const v = value.trim();
    if (v === "") {
        return null;
    }
    const exact = world.projects.find((p) => p.name === v);
    if (exact) {
        return exact.name;
    }
    const lower = v.toLowerCase();
    const loose = world.projects.find((p) => p.name.toLowerCase() === lower);
    if (loose) {
        return loose.name;
    }
    return lower.replace(/[\s_]+/g, "-") === NO_FOLDER_PROJECT ? NO_FOLDER_PROJECT : null;
}

function projectPath(project: string, world: RouteWorld): string {
    return project === NO_FOLDER_PROJECT
        ? world.noFolderPath
        : (world.projects.find((p) => p.name === project)?.path ?? "");
}

function agentChoice(a: RouteAgent): RouteChoice {
    const word = a.sleeping ? "asleep" : a.state === "working" ? "working" : "";
    return { kind: "agent", agentId: a.id, project: a.project, label: word ? `${a.name} · ${word}` : a.name };
}

// The rule for a clear project (D5): no open agent there launches one, one is sent the job (a working one queues it),
// several go to a card, the named agent first, with a row for a new agent beside them.
export function decideForProject(
    project: string,
    task: string,
    reason: string,
    world: RouteWorld,
    preferAgent?: string
): RouteAction {
    const key = resolveProject(project, world);
    if (key == null) {
        return { kind: "choose", why: UNSURE_WHY, task, choices: allProjectChoices(world) };
    }
    const open = world.agents.filter((a) => a.project === key);
    if (open.length === 0) {
        return { kind: "launch", project: key, path: projectPath(key, world), task, reason };
    }
    if (open.length === 1) {
        return { kind: "send", agentId: open[0].id, project: key, task, reason };
    }
    const first = preferAgent ? open.find((a) => a.id === preferAgent) : undefined;
    const ordered = first ? [first, ...open.filter((a) => a !== first)] : open;
    return {
        kind: "choose",
        why: `More than one agent is open in ${routeProjectLabel(key)}`,
        task,
        choices: [...ordered.map(agentChoice), launchChoice(key, projectPath(key, world))],
    };
}

// The projects a verdict weighed, as card rows: registered names only, once each, in the order it gave them. Empty when
// it named none that exists.
function consideredChoices(considered: string[], world: RouteWorld): RouteChoice[] {
    const seen = new Set<string>();
    const out: RouteChoice[] = [];
    for (const c of considered) {
        const key = resolveProject(c, world);
        if (key == null || key === NO_FOLDER_PROJECT || seen.has(key)) {
            continue;
        }
        seen.add(key);
        out.push(projectChoice(key));
    }
    return out;
}

// A go-through or discuss job. It names no project and no agent, so none of the project rule applies: the ideas action opens
// its own agent. A discuss that names no listed idea (an id Jarvis made up, or one decided since it was listed) is a question
// back, and so is any job with no idea waiting: the rule asks, since opening an agent for nothing would cost tokens.
function decideIdeas(v: RouteVerdict & { ideas: RouteIdeasJob }, world: RouteWorld): RouteAction {
    if (world.ideas.length === 0) {
        return { kind: "answer", text: NO_IDEAS_WAITING };
    }
    if (v.ideas === "go-through") {
        return { kind: "ideas", op: "go-through", reason: v.reason };
    }
    const named = world.ideas.find((i) => i.id === v.idea);
    if (named == null) {
        return { kind: "answer", text: WHICH_IDEA };
    }
    return { kind: "ideas", op: "discuss", ideaId: named.id, reason: v.reason };
}

// What to do with a finished reply (D5). No block is an answer; an ideas job opens its own agent (decideIdeas); a block that
// did not read, or named a project that is not registered, offers every project; an unsure verdict offers the projects it
// weighed (every project when it named none) and a new agent in No folder; a clear project follows the open-agent rule.
export function decideRoute(
    split: { verdict: RouteVerdict | null; malformed: boolean },
    request: string,
    world: RouteWorld
): RouteAction {
    if (split.malformed) {
        return { kind: "choose", why: UNSURE_WHY, task: request, choices: allProjectChoices(world) };
    }
    const v = split.verdict;
    if (v == null) {
        return { kind: "answer" };
    }
    if (v.ideas != null) {
        return decideIdeas({ ...v, ideas: v.ideas }, world);
    }
    const key = resolveProject(v.project, world);
    if (v.ambiguous || v.project.trim() === "") {
        const weighed = consideredChoices(v.considered, world);
        const choices = weighed.length > 0 ? [...weighed, noFolderLaunchChoice(world)] : allProjectChoices(world);
        return { kind: "choose", why: v.reason || UNSURE_WHY, task: v.task, choices };
    }
    if (key == null) {
        return { kind: "choose", why: UNSURE_WHY, task: v.task, choices: allProjectChoices(world) };
    }
    return decideForProject(key, v.task, v.reason, world, v.agent || undefined);
}

// A card row that was picked: an agent row sends, a launch row launches, a project row runs the project rule. The person
// chose it, so that is the reason the receiving agent's band gives.
export function resolveChoice(choice: RouteChoice, task: string, world: RouteWorld): RouteAction {
    switch (choice.kind) {
        case "agent":
            return { kind: "send", agentId: choice.agentId, project: choice.project, task, reason: PICKED_REASON };
        case "launch":
            return { kind: "launch", project: choice.project, path: choice.path, task, reason: PICKED_REASON };
        case "project":
            return decideForProject(choice.project, task, PICKED_REASON, world);
    }
}
