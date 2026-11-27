// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0
//
// Chat's Fork and Fork from here, as pure decisions: which agents can fork, where a fork from an item cuts, and the
// launch that starts it. ForkAgentSessionCommand (wavesrv) cuts the transcript and builds the command line.

import type { LaunchAgentOpts } from "@/app/cockpit/cockpit-actions";
import type { AgentVM } from "./agentsviewmodel";
import type { AgentPart, ChatItem } from "./chatmodel";

/** Where a fork from one Chat item cuts: before your message (its text goes back in the fork's box) or through a reply. */
export type ForkPoint = { uuid: string; keep: "before"; draft: string } | { uuid: string; keep: "through" };

/** Whether Chat offers Fork for this agent: Claude only (the one harness with --fork-session), with a transcript. An
 *  agent with no harness set is Claude, as chatCapable (chatmode.ts) takes it. */
export function canForkInChat(agent: Pick<AgentVM, "agent" | "transcriptPath">): boolean {
    return (agent.agent || "claude").toLowerCase() === "claude" && !!agent.transcriptPath?.endsWith(".jsonl");
}

/** A fork from one of your messages: everything before it, its text back in the box. None for a command or no uuid. */
export function forkPointOfYou(item: Extract<ChatItem, { kind: "you" }>): ForkPoint | null {
    if (!("text" in item) || !item.uuid) {
        return null;
    }
    return { uuid: item.uuid, keep: "before", draft: item.text };
}

/** A fork from a reply: everything up to and including it. */
export function forkPointOfProse(part: Extract<AgentPart, { kind: "prose" }>): ForkPoint | null {
    return part.uuid ? { uuid: part.uuid, keep: "through" } : null;
}

function folderName(p: string): string {
    return p.split(/[\\/]/).filter(Boolean).pop() ?? "";
}

/** What ForkAgentSessionCommand answers: the command, where it starts, and the transcript it resumes. */
export type ForkRtn = { command: string; projectpath: string; resumedpath?: string };

/** The name a fork's tab goes by: "Fork: <title>", the word first so a fork reads as one at the start of its row, or
 *  "Fork" for an untitled one. A fork of a fork is named once: a "Fork: " already in front, or the " (fork)" forks were
 *  named with before, is dropped first. */
export function forkLabel(title: string | undefined): string {
    let t = (title ?? "").trim();
    for (let prev = ""; prev !== t; ) {
        prev = t;
        t = t
            .replace(/^fork:\s*/i, "")
            .replace(/\s*\(fork\)$/i, "")
            .trim();
    }
    return t ? `Fork: ${t}` : "Fork";
}

/** The launch that starts a fork: a new tab of its own (no resumeOf), named as a fork of the agent (forkLabel). A live
 *  agent's task is empty (liveToVM), so its name, the title its row shows, names it then. It carries the transcript it
 *  resumes (forkOf), which Chat shows until the fork writes its own. */
export function chatForkLaunchOpts(
    agent: Pick<AgentVM, "task" | "project"> & Partial<Pick<AgentVM, "name">>,
    rtn: ForkRtn,
    now: number = Date.now()
): LaunchAgentOpts {
    return {
        runtime: "claude",
        startupCommand: rtn.command,
        task: "",
        projectPath: rtn.projectpath,
        projectName: agent.project || folderName(rtn.projectpath) || "agent",
        label: forkLabel(agent.task?.trim() || agent.name),
        ...(rtn.resumedpath ? { forkOf: rtn.resumedpath, forkedAt: now } : {}),
    };
}

/** Whether Chat shows the transcript a fork resumes (session:forkof) rather than its own: until its own holds a message.
 *  Claude Code writes a --fork-session's file at launch with its hook lines only, and the history it copies at the
 *  fork's first message, so before that its own reads as a new conversation. */
export function forkShowsSource(forkOf: string | undefined, ownHasMessages: boolean): boolean {
    return !!forkOf && !ownHasMessages;
}

/** The turn under way, or null when the prompt it was read back to is older than the fork (session:forkedat): that is
 *  a prompt of the history the fork copied, its own not written yet, and its time would read as hours of work. */
export function turnInFork<T extends { startedAt: number }>(stats: T | null, forkedAt: number | undefined): T | null {
    if (stats == null || forkedAt == null || !Number.isFinite(stats.startedAt)) {
        return stats;
    }
    return stats.startedAt < forkedAt ? null : stats;
}

/** What a fork reaches outside Chat; chatforkaction.ts binds the real ones, the test fakes. */
export type ChatForkDeps = {
    fork: (data: CommandForkAgentSessionData) => Promise<ForkRtn>;
    launch: (opts: LaunchAgentOpts) => Promise<string>;
    setDraft: (agentId: string, text: string) => void;
    toast: (t: { title: string; message: string; level: "error" }) => void;
};

/** Forks the agent's session (the whole of it, or from `point`) into a new tab; a fork from your message opens with
 *  that message's text in its box. A failure shows as a toast and launches nothing. */
export async function runChatFork(
    deps: ChatForkDeps,
    agent: Pick<AgentVM, "name" | "task" | "project" | "transcriptPath">,
    point?: ForkPoint
): Promise<void> {
    try {
        const rtn = await deps.fork({
            transcriptpath: agent.transcriptPath!,
            ...(point ? { uuid: point.uuid, keep: point.keep } : {}),
        });
        const id = await deps.launch(chatForkLaunchOpts(agent, rtn));
        if (point?.keep === "before" && point.draft) {
            deps.setDraft(id, point.draft);
        }
    } catch (e) {
        deps.toast({
            title: `Couldn't fork ${agent.name}`,
            message: e instanceof Error ? e.message : String(e),
            level: "error",
        });
    }
}
