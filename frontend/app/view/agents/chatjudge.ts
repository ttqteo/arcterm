// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0
//
// The judge for a choice question in Chat: when an agent's reply ends in "A hay B?" written as prose, the chips (the
// model's answers, chatsuggest.ts) get one picked as reasonable, with a reason. The light mark comes with the chips
// (the same haiku call); the deep judge is a fresh session the person starts, which reads the code blind to the agent's
// lean. wavesrv keeps one record per such turn (pkg/chatjudge, ChatJudgeRecord); chatsuggeststore.ts holds it and makes
// the calls. Pure: what the record does to the chips' row, and the line under the agent's message (chatjudgeline.tsx).
// Times in a record (ts, startts, endts) are Unix ms.

import type { ChatItem } from "./chatmodel";
import { endsWithQuestion, suggestKey, yesNoQuestion, type ChatChip } from "./chatsuggest";

/** Pure: the reply ends in a question that is not yes-or-no, the turns that get a judge record. */
export function choiceTurn(reply: string): boolean {
    return endsWithQuestion(reply) && !yesNoQuestion(reply);
}

/** Pure: which agent item each of the agent's judge records belongs under, as item key -> record key. An item holds the
 *  record when one of its prose parts gives a `suggestKey` the records have: the part's text is the message entry's whole
 *  text when the reply holds no ```arc-review block (chatmodel.ts), which is the text the pane's `lastReply` keys the turn
 *  by. A reply split around a review block is not matched; such a reply ends in a verdict, not a choice question. An item
 *  with two such parts keeps the later one. The key names the text's length (`<agent id>:<length>:<hash>`), so only a part
 *  of a length some record names is hashed: this runs on every token of a streaming reply. */
export function judgeKeysByItem(
    agentId: string,
    items: readonly ChatItem[],
    records: Readonly<Record<string, unknown>>
): Map<string, string> {
    const out = new Map<string, string>();
    const prefix = `${agentId}:`;
    const lengths = new Set<number>();
    for (const key of Object.keys(records)) {
        if (key.startsWith(prefix)) {
            lengths.add(Number(key.slice(prefix.length).split(":")[0]));
        }
    }
    if (lengths.size === 0) {
        return out;
    }
    for (const item of items) {
        if (item.kind !== "agent") {
            continue;
        }
        for (const part of item.parts) {
            if (part.kind !== "prose" || !lengths.has(part.text.length)) {
                continue;
            }
            const key = suggestKey(agentId, part.text);
            if (key in records) {
                out.set(item.key, key);
            }
        }
    }
    return out;
}

/** Pure: what a click on the added chip sends: its label, what it does and the facts it rests on, so the agent
 *  understands an option it never named. */
export function addedSend(a: ChatJudgeAdded): string {
    const facts = a.facts ?? [];
    return `${a.label}: ${a.desc}` + (facts.length > 0 ? ` (${facts.join("; ")})` : "");
}

/** the added option as a chip: it sends more than its label says (addedSend) */
function addedChip(a: ChatJudgeAdded, judged: boolean): ChatChip {
    const chip: ChatChip = { text: a.label, kind: "reply", source: "judge", send: addedSend(a) };
    return judged ? { ...chip, judged: true } : chip;
}

/** The pick the record shows: the deep judge's once it is done, else the light mark's. */
function shownPick(rec: ChatJudgeRecord): { pick: string | undefined; reason: string | undefined } {
    const deep = rec.deep;
    return deep?.state === "done" ? { pick: deep.pick, reason: deep.reason } : { pick: rec.pick, reason: rec.reason };
}

/** Pure: the row with the judge's pick first and marked `judged` (the scale), so Cmd/Ctrl+Enter (quickChip) sends it. The
 *  deep judge's pick once it is done, else the light mark's: only one chip is ever judged. An option the deep judge
 *  added becomes a chip of its own: first when it is the pick, else right after the judged chip. A pick that names no
 *  chip (or no record) leaves the row as given. */
export function judgedChips(chips: ChatChip[], rec: ChatJudgeRecord | undefined): ChatChip[] {
    if (rec == null) {
        return chips;
    }
    const { pick } = shownPick(rec);
    if (pick == null || pick === "") {
        return chips;
    }
    const added = rec.deep?.state === "done" ? rec.deep.added : undefined;
    if (added != null && pick === added.label) {
        return [addedChip(added, true), ...chips];
    }
    const at = chips.findIndex((c) => c.text === pick);
    if (at < 0) {
        return chips;
    }
    const rest = chips.filter((_, i) => i !== at);
    const judged: ChatChip = { ...chips[at], judged: true };
    return added != null ? [judged, addedChip(added, false), ...rest] : [judged, ...rest];
}

/** Pure: the reason of the pick that is shown (the deep judge's once done, else the light mark's), or null. */
export function judgeReason(rec: ChatJudgeRecord | undefined): string | null {
    if (rec == null) {
        return null;
    }
    const { pick, reason } = shownPick(rec);
    return pick != null && pick !== "" && reason != null && reason.trim() !== "" ? reason : null;
}

/** The line under the agent's message, as chatjudgeline.tsx draws it: `head`, the `name` (the pick: the hover target,
 *  whose tooltip holds `reason` and, dim under it, `source`), the dim `hint` or the `note`, the `tail` at the line's end,
 *  and the one `action` the person can take. None means no line. */
export type JudgeLine =
    | { state: "none" }
    | {
          state: "light" | "reading" | "done" | "failed";
          head?: string;
          name?: string;
          hint?: string;
          tail?: string;
          note?: string;
          reason?: string;
          source?: string;
          action?: "judge" | "stop" | "retry";
      };

/** whole seconds in `ms`, never below 0 */
function seconds(ms: number): number {
    return Math.max(0, Math.floor(ms / 1000));
}

/** the light mark's part of a line: its head, the pick and why, or nothing when haiku wrote no pick */
function lightMark(rec: ChatJudgeRecord, vi: boolean) {
    if (rec.pick == null || rec.pick === "") {
        return null;
    }
    return {
        head: vi ? "Gợi ý" : "Suggested",
        name: rec.pick,
        ...(rec.reason ? { reason: rec.reason } : {}),
        source: vi ? "haiku, chỉ đọc reply" : "haiku, read the reply only",
    };
}

/** Pure: the line under the message holding the question, from its record. `now` (ms) ticks the reading time, `vi` is
 *  the person's language, and `live` says it is the pane's current turn, the only one whose action (judge, stop, retry)
 *  still helps: an old turn's line shows what was judged and nothing to press. A record with no pick of haiku's and no
 *  deep result is the action alone on the live turn (the deep judge stays reachable), and no line on an old one. A
 *  stopped judge reads as the light mark. */
export function judgeLine(rec: ChatJudgeRecord | undefined, now: number, vi: boolean, live: boolean): JudgeLine {
    if (rec == null) {
        return { state: "none" };
    }
    const deep = rec.deep;
    switch (deep?.state) {
        case "reading":
            return {
                state: "reading",
                head: vi
                    ? "Judge đang đọc code, không thấy agent khuyên gì"
                    : "Judge is reading the code, blind to the agent's lean",
                tail: `${seconds(now - deep.startts)} s`,
                ...(live ? { action: "stop" as const } : {}),
            };
        case "done": {
            const files = deep.files ?? 0;
            const parts = [
                deep.model ?? "",
                `${files} ${vi || files === 1 ? "file" : "files"}`,
                deep.endts != null && deep.endts > 0 ? `${seconds(deep.endts - deep.startts)} s` : "",
            ].filter((p) => p !== "");
            const cost = parts.join(" · ");
            const addedPicked = deep.added != null && deep.pick === deep.added.label;
            return {
                state: "done",
                head: vi ? "Judge chọn" : "Judge picks",
                ...(deep.pick ? { name: deep.pick } : {}),
                ...(addedPicked ? { note: vi ? "agent không nêu" : "the agent did not name it" } : {}),
                tail: cost,
                ...(deep.reason ? { reason: deep.reason } : {}),
                source: cost,
            };
        }
        case "failed": {
            const failed = vi ? "Judge không xong" : "Judge failed";
            return {
                state: "failed",
                ...lightMark(rec, vi),
                note: deep.error ? `${failed}: ${deep.error}` : failed,
                ...(live ? { action: "retry" as const } : {}),
            };
        }
        default: {
            const mark = lightMark(rec, vi);
            if (mark == null) {
                return live ? { state: "light", action: "judge" } : { state: "none" };
            }
            return {
                state: "light",
                ...mark,
                hint: vi ? "rê vào để xem lý do" : "hover for why",
                ...(live ? { action: "judge" as const } : {}),
            };
        }
    }
}
