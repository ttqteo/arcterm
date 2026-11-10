// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0
//
// The conversation of a Claude agent as chat draws it: your messages as bubbles, the agent's prose and the work between
// two pieces of it as one group behind its avatar, and a prompt arcterm typed (a run's launch prompt, a wake, a message
// from another agent) as a card of its own naming who sent it, never as something you said. Built on groupCompact
// (compacttimeline.ts), so a stretch of tools folds into one "Worked for 38s · 5 tools" line and a file edited many
// times into one `+a −d` count exactly as the compact view does. Pure; chatview.tsx draws it.
//
// The prompts are recognized by their opening, with the arc view mod's own readers (claude/arc-view-mod/hooks, pure and
// import-free), so the engine's wording is pinned once, by the fixtures in that mod's testdata.

import {
    cardHeader,
    parseRunPrompt,
    parseStreamPrompt,
    pointerPath,
    type Card,
} from "../../../../claude/arc-view-mod/hooks/prompt-core";
import { parseWake, recapLine, wakeSummary, type Wake } from "../../../../claude/arc-view-mod/hooks/wake-core";
import type { AgentEntry, AgentState, EditFile, ShellResult } from "./agentsviewmodel";
import { groupCompact, type CompactItem, type WorkItem } from "./compacttimeline";

/** One piece of what the agent did between two of your messages. */
export type AgentPart =
    | { kind: "prose"; text: string }
    | { kind: "work"; work: WorkItem }
    // the files that work edited, once per path with the summed counts; follows its work part
    | { kind: "files"; files: EditFile[]; adds: number; dels: number };

/** Who sent a prompt arcterm typed into the session. */
export type SentFrom = "run" | "cockpit";

/** What stands between two agent groups without being said by either: a compaction, an interruption, a finished task. */
export type ChatMarker = Extract<CompactItem, { kind: "compaction" | "interrupted" | "notification" }>;

export type ChatItem =
    // a message you typed; `images` is what you pasted with it (data URLs), left off when there were none
    | { kind: "you"; key: string; text: string; images?: string[] }
    // a slash command or skill you typed, as "/name args" (check with `"command" in item`); a bash-mode command reads
    // "! cmd", with `shell` its output once that lands
    | { kind: "you"; key: string; command: string; shell?: ShellResult }
    // a prompt arcterm typed: `header` names it, `lines` are its fields as "label value" and its body (at most SENT_LINES)
    | { kind: "sent"; key: string; from: SentFrom; header: string; lines: string[] }
    // everything the agent said and did between two of the items around it
    | { kind: "agent"; key: string; parts: AgentPart[] }
    | { kind: "marker"; key: string; item: ChatMarker };

/** The most lines a sent card carries. */
export const SENT_LINES = 6;

/** Header of the card for a launch prompt too long for a command line, which reached the session as a pointer to a file. */
const POINTER_HEADER = "run prompt · from a file";

// a key is the first entry's index (entries are append-only, so it never changes as the transcript grows), prefixed by
// the item's kind so a glance at a key says what it is
function keyOf(kind: ChatItem["kind"], index: number): string {
    return `${kind}:${index}`;
}

function cardLines(card: Card): string[] {
    return [...card.fields.map((f) => `${f.label} ${f.value}`), ...card.body].slice(0, SENT_LINES);
}

// a wake draws as one line per event, what passed unverified, and the recaps it folds away, as its row in the TUI does
function wakeLines(wake: Wake): string[] {
    return [
        ...wake.events.map((e) => e.headline),
        ...wake.caveats.map((c) => `unverified ${c}`),
        ...(wake.recaps > 0 ? [recapLine(wake.recaps)] : []),
    ].slice(0, SENT_LINES);
}

type Sent = { from: SentFrom; header: string; lines: string[] };

// what arcterm typed, or null for text a person wrote. The text is trimmed to be read only: a trailing newline must not
// hide a line the parsers anchor to its end, and the bubble keeps the text as it was.
function readSent(text: string): Sent | null {
    const t = text.trim();
    const run = parseRunPrompt(t);
    if (run != null) {
        return { from: "run", header: cardHeader(run), lines: cardLines(run) };
    }
    const file = pointerPath(t);
    if (file != null) {
        return { from: "run", header: POINTER_HEADER, lines: [file] };
    }
    const wake = parseWake(t);
    if (wake != null) {
        return { from: "cockpit", header: wakeSummary(wake), lines: wakeLines(wake) };
    }
    const sent = parseStreamPrompt(t);
    if (sent != null) {
        return { from: "cockpit", header: cardHeader(sent), lines: cardLines(sent) };
    }
    return null;
}

// "/review PR #402"; a skill's name carries no slash of its own, a slash command's does
function commandText(c: { name: string; args?: string; isSkill?: boolean }): string {
    const name = c.isSkill ? `/${c.name}` : c.name;
    return c.args ? `${name} ${c.args}` : name;
}

/**
 * Pure: the transcript as chat items. Every agent-side item (a message, a stretch of tools) between two of your
 * messages, a sent card or a marker joins one group; a marker splits the agent's side in two, since it is a point in the
 * conversation of its own.
 */
export function chatItems(entries: AgentEntry[]): ChatItem[] {
    const out: ChatItem[] = [];
    let group: Extract<ChatItem, { kind: "agent" }> | null = null;
    // the group the next agent-side item joins, opened by that item's own entry index
    const agentParts = (index: number): AgentPart[] => {
        if (group == null) {
            group = { kind: "agent", key: keyOf("agent", index), parts: [] };
            out.push(group);
        }
        return group.parts;
    };
    for (const item of groupCompact(entries)) {
        switch (item.kind) {
            case "user": {
                group = null;
                const sent = readSent(item.text);
                if (sent != null) {
                    out.push({ kind: "sent", key: keyOf("sent", item.index), ...sent });
                } else if (item.images != null) {
                    out.push({ kind: "you", key: keyOf("you", item.index), text: item.text, images: item.images });
                } else {
                    out.push({ kind: "you", key: keyOf("you", item.index), text: item.text });
                }
                break;
            }
            case "command":
                group = null;
                out.push({
                    kind: "you",
                    key: keyOf("you", item.index),
                    command: commandText(item),
                    ...(item.shell != null ? { shell: item.shell } : {}),
                });
                break;
            case "message":
                agentParts(item.index).push({ kind: "prose", text: item.text });
                break;
            case "work": {
                const parts = agentParts(item.startIndex);
                parts.push({ kind: "work", work: item });
                if (item.files.length > 0) {
                    parts.push({ kind: "files", files: item.files, adds: item.adds, dels: item.dels });
                }
                break;
            }
            case "compaction":
            case "interrupted":
            case "notification":
                group = null;
                out.push({ kind: "marker", key: keyOf("marker", item.index), item });
                break;
        }
    }
    return out;
}

/** Pure: whether the box's text runs as a bash command: it starts with `!`, which Claude Code's own box reads as bash
 *  mode when the text is typed into it, so the command runs in the agent's shell and its output joins the
 *  conversation. A `!` after a leading space is plain text there too. */
export function bashMode(text: string): boolean {
    return text.startsWith("!");
}

/** Pure: the agent side's "working" line while the agent works, null otherwise. */
export function workingLine(state: AgentState, activity: string | undefined): string | null {
    if (state !== "working") {
        return null;
    }
    const what = activity?.trim();
    return what ? `Working · ${what}` : "Working…";
}

/** Pure: the working line, naming the running tool's own description when the last entry is a tool with no result yet. */
export function workingText(state: AgentState, activity: string | undefined, entries: AgentEntry[]): string | null {
    const line = workingLine(state, activity);
    if (line == null) {
        return null;
    }
    const last = entries[entries.length - 1];
    if (last?.kind === "action" && last.outcome == null && last.target.trim() !== "") {
        return `Working · ${last.target.trim()}`;
    }
    return line;
}

/** How many more items a "Show earlier" reveals, and how many the view starts with. */
export const CHAT_RENDER_STEP = 120;

/** Pure: the last `shown` items, so a long conversation draws its newest part and reveals earlier ones on request. */
export function shownItems<T>(items: T[], shown: number): T[] {
    const n = Math.floor(shown);
    if (!(n > 0)) {
        return [];
    }
    return n >= items.length ? items : items.slice(items.length - n);
}
