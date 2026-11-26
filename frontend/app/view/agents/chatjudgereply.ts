// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0
//
// Which replies in Chat carry ⚖ Judge this reply (spec docs/superpowers/specs/2026-11-26-judge-on-reply-design.md,
// decision 1), pure. The button pairs a judge with the reply it sits under: PairStart and PairBrief take that reply's
// transcript record uuid as `from`, and "" is the agent's latest reply (what the header's Add judge always sent).
//
// A reply is the LAST prose part of an agent turn, the part wavesrv's LastAnswer would return as that turn's reply: the
// text between a turn's tool calls is not a reply of its own. A part still being written (`live`) is not one yet, so
// the last finished prose part is the turn's reply so far. Claude's parts carry the uuid of their record, which wavesrv
// finds in the agent's transcript, so only a part with one, and only where Chat draws the agent's own transcript (a fork
// still showing the session it forked from draws records wavesrv would not find). pi's parts carry none: pi gets ⚖ under
// its latest reply only, which pairs with an empty `from`.

import type { AgentPart, ChatItem } from "./chatmodel";

export type JudgeReplyOpts = {
    harness: "claude" | "pi";
    /** Chat draws the agent's own transcript, not the one a fork resumes (chatfork.ts forkShowsSource) */
    ownTranscript: boolean;
};

type ProsePart = Extract<AgentPart, { kind: "prose" }>;

// the index of the item's last finished prose part, -1 when it has none
function lastReplyOf(parts: readonly AgentPart[]): number {
    for (let p = parts.length - 1; p >= 0; p--) {
        const part = parts[p];
        if (part.kind === "prose" && part.live !== true) {
            return p;
        }
    }
    return -1;
}

/** The parts that carry ⚖, by part key (`<item key>#<part index>`, the key Chat draws a part under) and the `from` each
 *  pairs with: the record uuid of a Claude reply, "" for pi's latest. */
export function judgeReplyParts(items: readonly ChatItem[], opts: JudgeReplyOpts): Map<string, string> {
    const out = new Map<string, string>();
    if (!opts.ownTranscript) {
        return out;
    }
    if (opts.harness === "pi") {
        for (let i = items.length - 1; i >= 0; i--) {
            const item = items[i];
            if (item.kind === "agent") {
                const p = lastReplyOf(item.parts);
                if (p >= 0) {
                    out.set(`${item.key}#${p}`, "");
                }
                break;
            }
        }
        return out;
    }
    for (const item of items) {
        if (item.kind !== "agent") {
            continue;
        }
        const p = lastReplyOf(item.parts);
        const uuid = p >= 0 ? (item.parts[p] as ProsePart).uuid : undefined;
        if (uuid) {
            out.set(`${item.key}#${p}`, uuid);
        }
    }
    return out;
}
