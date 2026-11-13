// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0
//
// Pure: what the chat box's background line (chatbgline.tsx) shows for an agent: its running background shell
// commands, its Monitors and its background (async) subagents, newest first, and the words of each. A foreground
// subagent the agent waits on inside its turn is not background work, so a fan-out never makes the line come and go.
// A sleeping agent's Claude Code session has exited, and its background work with it: nothing shows. No React and no
// Wave runtime imports.

import { currentModelAlias } from "./chatfootermodel";
import { shortModel } from "./modelname";
import { backgroundTaskKind, backgroundTaskSubline } from "./monitortasks";
import type { SubagentVM } from "./session-models/sessionviewmodel";
import type { BackgroundTask } from "./transcriptprojection";

interface ItemBase {
    key: string;
    name: string; // a shell command (drawn in mono), a Monitor's description, a subagent's type
    sub: string; // how long it has run, or what it is ("subagent · haiku")
    startMs?: number;
}

export type ChatBgItem =
    | (ItemBase & { kind: "shell" | "monitor"; task: BackgroundTask })
    | (ItemBase & { kind: "subagent"; subagent: SubagentVM });

/** Pure: a background subagent's second line: its kind and the family of its model ("subagent · haiku"). */
export function subagentSubline(s: Pick<SubagentVM, "model">): string {
    if (!s.model) {
        return "subagent";
    }
    return `subagent · ${currentModelAlias(s.model) ?? shortModel(s.model)}`;
}

/** Pure: the agent's running background work, the one started most recently first; one whose start is unknown goes
 *  last, in the order it came. Empty while the agent sleeps. */
export function chatBgItems(input: {
    asleep: boolean;
    tasks: BackgroundTask[] | undefined;
    subagents: SubagentVM[] | undefined;
    now: number;
}): ChatBgItem[] {
    if (input.asleep) {
        return [];
    }
    const items: ChatBgItem[] = [];
    for (const t of input.tasks ?? []) {
        if (t.status !== "running") {
            continue;
        }
        items.push({
            kind: backgroundTaskKind(t),
            key: `task:${t.toolUseId}`,
            name: t.label,
            sub: backgroundTaskSubline(t, input.now),
            startMs: t.startMs,
            task: t,
        });
    }
    for (const s of input.subagents ?? []) {
        if (!s.async || s.state !== "working") {
            continue;
        }
        items.push({
            kind: "subagent",
            key: `sub:${s.id}`,
            name: s.type,
            sub: subagentSubline(s),
            startMs: s.startedAtMs,
            subagent: s,
        });
    }
    // Array.prototype.sort is stable, so equal or unknown starts keep their order
    return items.sort((a, b) => (b.startMs ?? -Infinity) - (a.startMs ?? -Infinity) || 0);
}

/** Pure: the collapsed line: the item it names and how many more are running; null with nothing running. */
export function chatBgLine(items: ChatBgItem[]): { lead: ChatBgItem; more: number } | null {
    return items.length === 0 ? null : { lead: items[0], more: items.length - 1 };
}

/** Pure: "and 2 more", or null when the lead is the only one. */
export function chatBgMore(more: number): string | null {
    return more > 0 ? `and ${more} more` : null;
}

/** Pure: the open list's header. */
export function chatBgHeader(count: number): string {
    return `${count} running in the background`;
}
