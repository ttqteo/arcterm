// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0
//
// What Chat shows while a conversation holds no message yet (chatpane.tsx's ChatEmpty). A new session spends a few
// seconds starting its harness before it takes a message: that reads as the harness starting, with the project it
// starts in, not as "No messages yet" over a separate "Working…" line. Once it waits at its prompt it reads as a new
// conversation with its facts and how to begin; a controller that refused to start reads as that, with its reason.

import type { AgentVM } from "./agentsviewmodel";
import { runtimeMeta } from "./runtimemeta";

export type ChatEmptyPhase = "starting" | "ready" | "asleep" | "failed";

export interface ChatEmptyView {
    phase: ChatEmptyPhase;
    title: string;
    // one line under the title: where it starts, or why it failed
    detail?: string;
    // the session's facts on one line (model · project), only once it is up
    facts?: string;
    // how to begin, only when the box below takes a message
    hint?: string;
}

/** Pure: the empty conversation's state, title and lines for an agent with no message in its transcript. */
export function chatEmptyView(
    agent: Pick<AgentVM, "agent" | "state" | "project" | "model" | "startError" | "sleeping">
): ChatEmptyView {
    const rt = runtimeMeta(agent.agent);
    const harness = rt.id === "unknown" ? "the agent" : rt.label;
    const project = agent.project?.trim() || undefined;
    if (agent.startError) {
        return {
            phase: "failed",
            title: `${capitalize(harness)} did not start`,
            detail: agent.startError,
        };
    }
    if (agent.sleeping != null) {
        return {
            phase: "asleep",
            title: "No messages yet",
            detail: "Asleep",
            hint: "Send a message below to wake it.",
        };
    }
    if (agent.state === "working") {
        return {
            phase: "starting",
            title: `Starting ${harness}…`,
            detail: project ? `Setting up a new conversation in ${project}` : "Setting up a new conversation",
        };
    }
    const facts = [agent.model?.trim(), project].filter((s): s is string => !!s).join(" · ");
    return {
        phase: "ready",
        title: "New conversation",
        facts: facts || undefined,
        hint: "Type below to start · @ mentions a file · / runs a command",
    };
}

// The words wavesrv starts a read's error with when the transcript file is not there (transcript.go's noTranscriptFile).
// A session's path is known before its file is: Claude Code writes the file at its first message, and a run's lead or
// worker has its path from launch, minutes before (a run's Setup), so a read in that time is the normal start.
export const NO_TRANSCRIPT_FILE = "no transcript file yet at";

/** Pure: the read error the empty conversation shows, or null. A transcript not written yet is no error, in any phase,
 * and a harness that is starting says so itself. */
export function chatEmptyError(error: string | null, phase: ChatEmptyPhase): string | null {
    if (error == null || phase === "starting" || error.includes(NO_TRANSCRIPT_FILE)) {
        return null;
    }
    return error;
}

function capitalize(s: string): string {
    return s.charAt(0).toUpperCase() + s.slice(1);
}
