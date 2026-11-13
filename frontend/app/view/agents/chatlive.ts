// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0
//
// The reply a Claude agent is writing, in Chat, the pure half (chatlivestore.ts holds the stream). The arc mod's
// turn.step hook (claude/arc-mod/hooks/live-core.ts) keeps the text of each block of the response under way in
// ~/.arc/live/<session id>.json, and wavesrv streams that file here. A block draws as a prose part at the end of the
// conversation until the transcript holds it: then the transcript's copy, drawn the same way in the same place, takes over.
//
// Text cut mid-stream is made safe to draw: a code fence still open is closed (an arc-visual one is left out until it
// closes: its body names a file that is not whole yet), and a highlight mark still open is dropped until it closes.

import { parseMarks } from "../../../../claude/skim-mod/hooks/highlight-core";
import type { AgentPart, ChatItem } from "./chatmodel";
import type { PendingMessage } from "./chatpending";
import { VISUAL_LANG } from "./chatvisual";

/** A done reply stays this long for the transcript's copy of it to land (the append read waits up to 3 s). */
export const LIVE_LINGER_MS = 8000;

/** A reply still streaming that has not changed for this long is a session that stopped mid-write. */
export const LIVE_STALE_MS = 60_000;

export type LiveKind = "text" | "thinking";

export interface LiveBlock {
    index: number;
    kind: LiveKind;
    text: string;
}

/** The live reply file's content: live-core.ts LiveReply. */
export interface LiveReply {
    turn: string;
    step: number;
    blocks: LiveBlock[];
    done: boolean;
    at: number;
}

/** Pure: whether the agent has a live reply to stream: a Claude agent (only its arc mod writes one) with a transcript. */
export function streamsLiveReply(agent: { agent?: string; transcriptPath?: string }): boolean {
    return (agent.agent || "claude").toLowerCase() === "claude" && !!agent.transcriptPath?.endsWith(".jsonl");
}

/** Pure: the file's text as a reply, or null when it is none (empty, not JSON, another shape). */
export function parseLiveReply(text: string): LiveReply | null {
    if (text.trim() === "") {
        return null;
    }
    let raw: any;
    try {
        raw = JSON.parse(text);
    } catch {
        return null;
    }
    if (raw == null || typeof raw !== "object" || !Array.isArray(raw.blocks) || typeof raw.at !== "number") {
        return null;
    }
    const blocks: LiveBlock[] = raw.blocks.filter(
        (b: any) =>
            b != null &&
            typeof b.index === "number" &&
            (b.kind === "text" || b.kind === "thinking") &&
            typeof b.text === "string"
    );
    return {
        turn: typeof raw.turn === "string" ? raw.turn : "",
        step: typeof raw.step === "number" ? raw.step : 0,
        blocks,
        done: raw.done === true,
        at: raw.at,
    };
}

/** Pure: whether a reply read at `now` is still worth drawing: one streaming that has moved in LIVE_STALE_MS, or one
 *  done less than LIVE_LINGER_MS ago. */
export function liveFresh(reply: LiveReply, now: number): boolean {
    return now - reply.at < (reply.done ? LIVE_LINGER_MS : LIVE_STALE_MS);
}

/** Pure: when a reply stops being fresh (liveFresh), for the store's timer. */
export function liveExpiresAt(reply: LiveReply): number {
    return reply.at + (reply.done ? LIVE_LINGER_MS : LIVE_STALE_MS);
}

/** Pure: whether the session records what Claude says between tool calls as a summary in a thinking block
 *  (thinkingDisplay "updates"; transcriptprojection.ts isNarration): read from the last assistant record of `lines`
 *  that says. Only then does a thinking block of the live reply draw, since real thinking streams no text there. */
export function narratesThinking(lines: readonly string[]): boolean {
    for (let i = lines.length - 1; i >= 0; i--) {
        const line = lines[i];
        if (!line.includes('"thinkingDisplay"')) {
            continue;
        }
        try {
            const rec = JSON.parse(line);
            if (rec?.type === "assistant" && typeof rec.thinkingDisplay === "string") {
                return rec.thinkingDisplay === "updates";
            }
        } catch {
            // a line that does not parse says nothing
        }
    }
    return false;
}

/** Pure: whether a message you sent starts the turn under way and has not landed: a plain message (no command) sent
 *  while the agent was idle. The reply then belongs after its bubble, which is drawn under the conversation until it
 *  lands, so the reply waits for it rather than draw above it. */
export function awaitsOwnMessage(pending: readonly PendingMessage[]): boolean {
    return pending.some((p) => p.kind == null && !p.queued);
}

const FENCE = /^\s*(`{3,}|~{3,})\s*([^\s`]*)/;
const VISUAL_INFO = new RegExp(`^${VISUAL_LANG}$`);

/** Pure: text cut mid-stream made safe to draw. An open fence is closed, or, for an arc-visual one, left out; an open
 *  `==` mark on the last line is dropped. */
export function tidyLiveText(text: string): string {
    const lines = text.split("\n");
    let open: { at: number; fence: string; visual: boolean } | null = null;
    lines.forEach((line, i) => {
        const m = FENCE.exec(line);
        if (m == null) {
            return;
        }
        if (open == null) {
            open = { at: i, fence: m[1], visual: VISUAL_INFO.test(m[2]) };
        } else if (m[1][0] === open.fence[0] && m[1].length >= open.fence.length && m[2] === "") {
            open = null;
        }
    });
    const fence = open as { at: number; fence: string; visual: boolean } | null;
    if (fence != null) {
        if (fence.visual) {
            return lines.slice(0, fence.at).join("\n").trimEnd();
        }
        return `${text}${text.endsWith("\n") ? "" : "\n"}${fence.fence}`;
    }
    return dropOpenMark(text);
}

// the last line's marks pair up; an odd one out is a mark still being written: it goes, and its text stays
function dropOpenMark(text: string): string {
    const nl = text.lastIndexOf("\n");
    const head = text.slice(0, nl + 1);
    const last = text.slice(nl + 1);
    const count = last.split("==").length - 1;
    if (count % 2 === 0) {
        return text;
    }
    const at = last.lastIndexOf("==");
    return head + last.slice(0, at) + last.slice(at + 2);
}

// what two copies of one reply share: the text without its marks (the transcript's copy is stored without them) and
// with its whitespace runs as one space
function sameText(s: string): string {
    return parseMarks(s).clean.replace(/\s+/g, " ").trim();
}

/** Pure: the reply's blocks to draw, as text, in order: each with text, a thinking one only where the session narrates
 *  in thinking blocks. */
export function liveTexts(reply: LiveReply | null, narrates: boolean): string[] {
    if (reply == null) {
        return [];
    }
    return reply.blocks.filter((b) => b.text.trim() !== "" && (b.kind === "text" || narrates)).map((b) => b.text);
}

/** Pure: `items` with the live texts that the transcript does not hold yet drawn at the end, as prose parts of the last
 *  agent group, or of a group of their own after your message. A text counts as held when a prose part of the
 *  conversation's last agent group reads the same. `nextIndex` (the number of entries) keys a new group as the
 *  transcript's will be keyed once its first entry lands, so the row stays the same element. */
export function withLiveReply(items: ChatItem[], texts: readonly string[], nextIndex: number): ChatItem[] {
    if (texts.length === 0) {
        return items;
    }
    const last = items[items.length - 1];
    const group = last?.kind === "agent" ? last : null;
    const held = new Set(
        (group?.parts ?? []).flatMap((p) => (p.kind === "prose" && p.live !== true ? [sameText(p.text)] : []))
    );
    const parts: AgentPart[] = texts
        .filter((t) => !held.has(sameText(t)))
        .map((text) => ({ kind: "prose", text: tidyLiveText(text), live: true }));
    if (parts.length === 0) {
        return items;
    }
    if (group != null) {
        return [...items.slice(0, -1), { ...group, parts: [...group.parts, ...parts] }];
    }
    return [...items, { kind: "agent", key: `agent:${nextIndex}`, parts }];
}
