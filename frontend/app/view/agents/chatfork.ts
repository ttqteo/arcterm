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

/** The launch that starts a fork: a new tab of its own (no resumeOf), named as a fork of the agent's task. */
export function chatForkLaunchOpts(
    agent: Pick<AgentVM, "task" | "project">,
    rtn: { command: string; projectpath: string }
): LaunchAgentOpts {
    const title = agent.task?.trim();
    return {
        runtime: "claude",
        startupCommand: rtn.command,
        task: "",
        projectPath: rtn.projectpath,
        projectName: agent.project || folderName(rtn.projectpath) || "agent",
        label: title ? `${title} (fork)` : "Fork",
    };
}

/** What a fork reaches outside Chat; chatforkaction.ts binds the real ones, the test fakes. */
export type ChatForkDeps = {
    fork: (data: CommandForkAgentSessionData) => Promise<{ command: string; projectpath: string }>;
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
