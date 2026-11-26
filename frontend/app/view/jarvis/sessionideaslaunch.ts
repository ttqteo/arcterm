// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0
//
// The two agents Session ideas opens (docs/superpowers/specs/2026-11-26-session-ideas-design.md): Discuss, one sonnet agent
// in the idea's own project, and Go through N, one sonnet agent in No folder that walks the ideas with the person one at a time.
// Both are ordinary Claude Code sessions, not a fan-out. The task text is pure (discussPrompt, goThroughPrompt) and starts with
// SESSION_IDEAS_MARKER, which the scan skips a session by, so the decision talk is never mined for ideas again.
//
// The cockpit's Brief region (sessionideasregion.tsx) and Sprout's popup (petideas.tsx) both start them from here, and both
// read launchedFor to show Go to agent while the agent is open.
//
// DEV hook, for the CDP scenarios: a scenario may not open a real agent (AGENTS.md), so `__waveSessionIdeasLaunch.setHook(true)`
// makes discussIdea and goThroughIdeas record the launch and open nothing, as jarvisroutestore.ts's hook does. `launches()`
// reads what was recorded, `clear()` forgets it. The hook is compiled out of production builds.

import { launchAgent, type LaunchAgentOpts } from "@/app/cockpit/cockpit-actions";
import { pushToast } from "@/app/cockpit/notificationstore";
import { globalStore } from "@/app/store/jotaiStore";
import { RpcApi } from "@/app/store/wshclientapi";
import { TabRpcClient } from "@/app/store/wshrpcutil";
import type { AgentsViewModel } from "@/app/view/agents/agents";
import type { AgentVM, PendingLaunch } from "@/app/view/agents/agentsviewmodel";
import { runtimeStartupCommand } from "@/app/view/agents/launch";
import { HOME_NAME } from "@/app/view/agents/launcher";
import { atom, type PrimitiveAtom } from "jotai";

/** The first line of both agents' task. The scan reads it from a session's first user turn and passes the session over. */
export const SESSION_IDEAS_MARKER = "[arc:session-ideas]";

const neverResume = (sessionId: string): string =>
    `Read more of a session with \`wsh read session:${sessionId}\`; never resume it (resuming a cold session rewrites its whole cache).`;

const KEEP_COMMAND = '`wsh sessionideas keep <id> [--label "<chunk label>"]`';
const DROP_COMMAND = "`wsh sessionideas drop <id>`";

// "> You: …", "> Claude: …": a quote of several lines keeps its quote mark on each
function quoteBlock(q: SessionIdeaQuote): string[] {
    const who = q.who === "you" ? "You" : "Claude";
    return `${who}: ${q.text}`.split("\n").map((line) => `> ${line}`);
}

function sourceLine(i: SessionIdea): string {
    const title = i.sessiontitle ? `session "${i.sessiontitle}" (${i.sessionid})` : `session ${i.sessionid}`;
    const day = i.saidts > 0 ? `, ${new Date(i.saidts).toISOString().slice(0, 10)}` : "";
    return `Source: ${title}${day}. \`wsh read session:${i.sessionid}\``;
}

// where the idea would go: its initiative, or nowhere yet
function initiativeLine(i: SessionIdea): string {
    return i.effortoid
        ? `Initiative: ${i.efforttitle || i.effortoid} (effort:${i.effortoid})`
        : "New idea: no initiative matches it.";
}

// everything an idea carries that a decision needs, as lines
function ideaLines(i: SessionIdea): string[] {
    const lines = [`Idea ${i.id}: ${i.gist}`, initiativeLine(i), `Project: ${i.project}`];
    if (i.why) {
        lines.push(`Why it stayed open: ${i.why}`);
    }
    if (i.quotes.length > 0) {
        lines.push("What was said:", ...i.quotes.flatMap(quoteBlock));
    }
    lines.push(sourceLine(i));
    return lines;
}

/** The task of the Discuss agent: the one idea, what was said, where it came from, and how to record the decision. */
export function discussPrompt(idea: SessionIdea): string {
    return [
        SESSION_IDEAS_MARKER,
        "Discuss one idea with me. It was floated in an earlier session and never decided.",
        "",
        ...ideaLines(idea),
        "",
        neverResume(idea.sessionid),
        "",
        "Talk it through with me. When I decide, record it:",
        `- ${KEEP_COMMAND.replace("<id>", idea.id)} keeps it: a pending chunk on its initiative, or a new idea when none matches.`,
        `- ${DROP_COMMAND.replace("<id>", idea.id)} drops it; the scan will not propose it again.`,
        "Record nothing until I have said which.",
    ].join("\n");
}

/** The task of the Go through agent: every idea waiting, each with what a quick pass needs, and how to record decisions. */
export function goThroughPrompt(ideas: readonly SessionIdea[]): string {
    return [
        SESSION_IDEAS_MARKER,
        `Go through these ${ideas.length} ideas from my earlier sessions with me, one at a time. Each was floated in a session and never decided.`,
        "",
        "For each: say what it is in a sentence, show what was said, and ask me whether to keep it, drop it, or leave it for now. " +
            "Record my decision when I give it, then go on to the next. An idea that needs code read to decide is left as it is: " +
            "tell me, and I will open a Discuss on it.",
        "",
        "Record a decision with:",
        `- ${KEEP_COMMAND}: a pending chunk on its initiative, or a new idea when none matches.`,
        `- ${DROP_COMMAND}: the scan will not propose it again.`,
        neverResume("<session id>"),
        "Record nothing until I have said which.",
        "",
        "Ideas:",
        ...ideas.flatMap((i, n) => ["", `${n + 1}. ${ideaLines(i).join("\n")}`]),
    ].join("\n");
}

const GIST_LABEL_MAX = 40;

// the agent's name in the roster
function discussLabel(i: SessionIdea): string {
    const gist = i.gist.length > GIST_LABEL_MAX ? `${i.gist.slice(0, GIST_LABEL_MAX - 1)}…` : i.gist;
    return `Idea: ${gist}`;
}

function goThroughLabel(n: number): string {
    return `Ideas: ${n} to go through`;
}

/** idea id -> the tab of the agent opened for it from here. Memory only: after a reload the row reads Discuss again. A Go through
 *  agent is remembered for each idea it was given. Read it through launchedFor, which drops a tab that has closed. */
export const ideaLaunchesAtom = atom<Record<string, string>>({}) as PrimitiveAtom<Record<string, string>>;

/** tab -> what opened it from here, so the popup's Discuss chip tells its own agent from a Go through holding the idea. */
export const ideaLaunchKindsAtom = atom<Record<string, IdeaLaunchRecord["kind"]>>({}) as PrimitiveAtom<
    Record<string, IdeaLaunchRecord["kind"]>
>;

// fake tabs the DEV hook handed out: they are on no roster, so openTabIds counts them as open itself
const hookTabs = new Set<string>();

/** The tabs that count as open for launchedFor: the roster's agents, and the launches still booting (a tab joins the roster
 *  only when its first status reports in, so a roster alone would read Discuss again for the first seconds of its agent). */
export function openTabIds(
    agents: readonly Pick<AgentVM, "id">[],
    pending: readonly Pick<PendingLaunch, "tabId">[]
): Set<string> {
    return new Set([...agents.map((a) => a.id), ...pending.map((p) => p.tabId), ...hookTabs]);
}

/** The tab of the agent opened for `ideaId` while it is open (the row reads Go to agent then), else undefined. */
export function launchedFor(
    ideaId: string,
    launches: Readonly<Record<string, string>>,
    open: ReadonlySet<string>
): string | undefined {
    const tab = launches[ideaId];
    return tab !== undefined && open.has(tab) ? tab : undefined;
}

export type IdeaLaunchRecord = {
    kind: "discuss" | "go-through";
    ideaIds: string[];
    projectPath: string;
    task: string;
};

let hookOn = false;
const recorded: IdeaLaunchRecord[] = [];

// a press made while the same launch is still starting would open a second agent
const starting = new Set<string>();

const errText = (e: unknown): string => (e instanceof Error ? e.message : String(e));

// No folder: the empty folder an agent that belongs to no project starts in (the launcher's last row). Asked of wavesrv at each
// launch, as the launcher does: it is idempotent.
async function noFolder(): Promise<{ name: string; path: string }> {
    const rtn = await RpcApi.EnsureNoFolderCommand(TabRpcClient);
    if (!rtn?.path) {
        throw new Error("Could not set up No folder");
    }
    return { name: HOME_NAME, path: rtn.path };
}

async function start(
    model: AgentsViewModel,
    key: string,
    spec: {
        kind: IdeaLaunchRecord["kind"];
        ideas: readonly SessionIdea[];
        task: string;
        label: string;
        folder: () => Promise<{ name: string; path: string }>;
    }
): Promise<string | null> {
    if (starting.has(key)) {
        return null;
    }
    starting.add(key);
    try {
        const folder = await spec.folder();
        const ideaIds = spec.ideas.map((i) => i.id);
        let tab: string;
        if (hookOn) {
            tab = `hook-idea-tab-${recorded.length + 1}`;
            hookTabs.add(tab);
            recorded.push({ kind: spec.kind, ideaIds, projectPath: folder.path, task: spec.task });
        } else {
            const opts: LaunchAgentOpts = {
                runtime: "claude",
                startupCommand: runtimeStartupCommand("claude"),
                extraArgs: ["--model", "sonnet"],
                task: spec.task,
                projectPath: folder.path,
                projectName: folder.name,
                label: spec.label,
            };
            tab = await launchAgent(model, opts);
        }
        globalStore.set(ideaLaunchesAtom, (prev) => ({
            ...prev,
            ...Object.fromEntries(ideaIds.map((id) => [id, tab])),
        }));
        globalStore.set(ideaLaunchKindsAtom, (prev) => ({ ...prev, [tab]: spec.kind }));
        return tab;
    } catch (e) {
        pushToast({ level: "error", title: "Couldn't open an agent for the ideas", message: errText(e) });
        return null;
    } finally {
        starting.delete(key);
    }
}

/** Discuss: a sonnet claude agent in the idea's project (No folder when the idea carries none: an agent with no folder would
 *  open in the wrong place). Resolves to its tab, or null when it did not start (a toast says why) or a press is still starting. */
export function discussIdea(model: AgentsViewModel, idea: SessionIdea): Promise<string | null> {
    return start(model, `discuss:${idea.id}`, {
        kind: "discuss",
        ideas: [idea],
        task: discussPrompt(idea),
        label: discussLabel(idea),
        folder: async () => (idea.projectpath ? { name: idea.project, path: idea.projectpath } : noFolder()),
    });
}

/** Go through N: one sonnet claude agent in No folder, for all of `ideas` (they span projects, and a quick pass needs no
 *  project's AGENTS.md, memory or skills). Resolves to its tab, or null as discussIdea does; opens nothing for no ideas. */
export function goThroughIdeas(model: AgentsViewModel, ideas: readonly SessionIdea[]): Promise<string | null> {
    if (ideas.length === 0) {
        return Promise.resolve(null);
    }
    return start(model, "go-through", {
        kind: "go-through",
        ideas,
        task: goThroughPrompt(ideas),
        label: goThroughLabel(ideas.length),
        folder: noFolder,
    });
}

if (import.meta.env.DEV) {
    (globalThis as Record<string, unknown>).__waveSessionIdeasLaunch = {
        setHook: (on: boolean) => {
            hookOn = !!on;
        },
        launches: (): IdeaLaunchRecord[] => [...recorded],
        clear: () => {
            recorded.length = 0;
            hookTabs.clear();
        },
    };
}
