// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0
//
// Ask agent, on a row of the Brief's Later section (spec 2026-11-27-ask-later-design.md decision 6, Builder's call 12):
// goes to the agent the item was saved from and quotes the item into its chat box, as Reply does. The agent may be gone
// by now, so the target is looked for in order: a live agent whose conversation is the note's, the note's own tab, and
// only then a resume of the conversation in a new tab. Pure: the jump, the resume, the quote and the error toast come in
// as dependencies, and the roster as data.

import { withChatQuote } from "../agents/chatquote";
import { sessionIdFromTranscript } from "../agents/launch";
import { quotedPassage } from "./laterchunk";

/** What Ask agent needs of a Later item. */
export type AskItem = {
    label: string;
    /** the first note's text: its `> ` lines are the passage that was saved */
    note: string;
    /** `agent:<tabid>` of the agent it was saved from */
    session?: string;
    /** that agent's conversation id, which survives a resume */
    conversation?: string;
};

/** What Ask agent reads of a roster agent: its tab id and the transcript its conversation is written to. */
export type AskAgent = { id: string; transcriptPath?: string };

export type AskTarget =
    | { kind: "live"; agentId: string }
    | { kind: "resume"; conversation: string }
    | { kind: "ended" };

export const ENDED_MESSAGE = "That agent session has ended";

const AGENT_PREFIX = "agent:";

/**
 * Where Ask agent goes. A live agent whose conversation (the stem of its transcript path) is the note's comes first: it
 * is the same conversation even when it was resumed into a new tab. Then the note's tab, which is all a note written
 * before the conversation id was kept has. With neither live, the conversation is resumed; with no conversation either,
 * the session has ended.
 */
export function askTarget(item: Pick<AskItem, "session" | "conversation">, roster: readonly AskAgent[]): AskTarget {
    const conversation = item.conversation || undefined;
    if (conversation != null) {
        const held = roster.find((a) => sessionIdFromTranscript(a.transcriptPath) === conversation);
        if (held != null) {
            return { kind: "live", agentId: held.id };
        }
    }
    const tab = item.session?.startsWith(AGENT_PREFIX) ? item.session.slice(AGENT_PREFIX.length) : "";
    if (tab !== "" && roster.some((a) => a.id === tab)) {
        return { kind: "live", agentId: tab };
    }
    return conversation != null ? { kind: "resume", conversation } : { kind: "ended" };
}

export type AskDeps = {
    /** brings the agent's own cell forward (channelsprimitives.ts jumpToAgent) */
    jump: (agentId: string) => void;
    /** opens the conversation again in a tab of its own, which the launch foregrounds (cockpit-actions.ts
     *  reopenSessionById): the tab, or why it could not */
    reopen: (conversation: string) => Promise<{ tabId: string; title: string } | { error: string }>;
    /** puts the quote into the agent's chat box now, or when the box mounts (chatinsert.ts quoteWhenReady) */
    quote: (agentId: string, make: (box: string) => string | null) => void;
    error: (message: string) => void;
};

/**
 * Asks the agent about an item: goes to the agent, or resumes its conversation in a new tab, and quotes the item into its
 * box (the passage the note quotes, else the label). True when a quote was handed to an agent; false when the session
 * could not be reached, which the error dependency has been told. The resumed tab's box is mounted later, so its quote
 * waits for it.
 */
export async function askAgent(item: AskItem, roster: readonly AskAgent[], deps: AskDeps): Promise<boolean> {
    const target = askTarget(item, roster);
    const text = quotedPassage(item.note) ?? item.label;
    const make = (box: string) => withChatQuote(box, text);
    if (target.kind === "live") {
        deps.jump(target.agentId);
        deps.quote(target.agentId, make);
        return true;
    }
    if (target.kind === "ended") {
        deps.error(ENDED_MESSAGE);
        return false;
    }
    try {
        const opened = await deps.reopen(target.conversation);
        if ("error" in opened) {
            deps.error(opened.error);
            return false;
        }
        deps.quote(opened.tabId, make);
        return true;
    } catch (e) {
        deps.error(e instanceof Error ? e.message : String(e));
        return false;
    }
}
