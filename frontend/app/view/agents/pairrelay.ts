// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0
//
// What arcterm's pair relays between a working agent and its judge, read back for Chat
// (docs/superpowers/specs/2026-11-26-chat-pair-relay-design.md). The texts are pkg/agentpair's, each inside
// agentmsg.PairEnvelope: RelayPrompt's parts under relayHead lines and WorkerBrief's opening (brief.go), JudgeBrief, and
// EndedNotice (hold.go). Go writes them as fixtures (pkg/orchestrate/viewmod_fixtures_test.go) and pairrelay.test.ts
// parses those, so a wording change there fails here.

export type RelayFrom = "judge" | "worker" | "person" | "arcterm";

/** One relayed message: who sent it (`name` is "" for the person and arcterm), its `15:04` time, the line it answers
 *  (`> line`, lifted out), the A item a person's answer names, its text without those, and the part as relayed. */
export interface RelayMessage {
    from: RelayFrom;
    name: string;
    time: string | null;
    quote: string | null;
    answers: number | null;
    text: string;
    raw: string;
}

export type PairRelay =
    | { kind: "relay"; brief: string | null; messages: RelayMessage[] }
    | { kind: "judgeBrief"; workerName: string; workerTab: string; brief: string; reply: RelayMessage | null }
    | { kind: "ended"; commands: string[] };

const ENVELOPE = /^\[Message from agent "arcterm pair" \(relayed by arcterm's pair[^\n]*\]\n([\s\S]*)$/;
// relayHead's four shapes; a name is Go's %q, so a quote in it is escaped
const QUOTED = String.raw`"((?:[^"\\]|\\.)*)"`;
const HEAD = new RegExp(
    String.raw`^From (?:the judge ${QUOTED}|the working agent ${QUOTED}|(the person) \(typed in arcterm, not an agent\)|(arcterm))(?:, (\d{2}:\d{2}))?:$`
);
const WORKER_BRIEF = "arcterm has paired you with ";
const JUDGE_BRIEF = new RegExp(
    String.raw`^You are the judge of another agent's work\. arcterm pairs the two of you: the agent is ${QUOTED} \(tab (\S+)\)\.`
);
const REPLY = /\n?--- the agent's latest reply ---\n([\s\S]*?)\n--- end of the reply ---\n?/;
const ENDED = "The pair has ended:";
const HELD = /^- `(.+)` was held: you may run it now\.$/;
const ANSWER = /^Answer to A(\d+): /;

function unquote(s: string): string {
    return s.replace(/\\(["\\])/g, "$1");
}

/** The text under a pair's envelope line, or null for any other prompt. */
export function pairEnvelopeText(prompt: string): string | null {
    const m = ENVELOPE.exec(prompt.trim());
    return m ? (m[1] ?? "") : null;
}

/** Pure: what a pair's prompt holds, or null when it is none of its three texts (the caller shows it whole). */
export function parsePairRelay(text: string): PairRelay | null {
    const t = text.trim();
    const judge = JUDGE_BRIEF.exec(t);
    if (judge != null) {
        const workerName = unquote(judge[1] ?? "");
        const reply = REPLY.exec(t);
        const said = reply != null ? (reply[1] ?? "").trim() : "";
        return {
            kind: "judgeBrief",
            workerName,
            workerTab: judge[2] ?? "",
            brief: (reply != null ? t.replace(reply[0], "\n") : t).trim(),
            reply:
                said !== ""
                    ? { from: "worker", name: workerName, time: null, raw: said, ...bodyOf("worker", said) }
                    : null,
        };
    }
    if (t.startsWith(ENDED)) {
        return { kind: "ended", commands: t.split("\n").flatMap((l) => HELD.exec(l.trim())?.slice(1, 2) ?? []) };
    }
    return relayOf(t);
}

// RelayPrompt joins its parts with a blank line, so a head opens the text or follows a blank line; a line shaped like a
// head anywhere else is a message's own text
function relayOf(t: string): PairRelay | null {
    const lines = t.split("\n");
    const heads = lines.flatMap((line, i) => ((i === 0 || lines[i - 1]?.trim() === "") && HEAD.test(line) ? [i] : []));
    if (heads.length === 0) {
        return null;
    }
    const before = lines.slice(0, heads[0]).join("\n").trim();
    if (before !== "" && !before.startsWith(WORKER_BRIEF)) {
        return null;
    }
    const messages = heads.map((at, n) => {
        const head = lines[at] ?? "";
        const body = lines
            .slice(at + 1, heads[n + 1] ?? lines.length)
            .join("\n")
            .trim();
        return messageOf(head, body);
    });
    return { kind: "relay", brief: before === "" ? null : before, messages };
}

function messageOf(head: string, body: string): RelayMessage {
    const m = HEAD.exec(head);
    const from: RelayFrom =
        m?.[1] != null ? "judge" : m?.[2] != null ? "worker" : m?.[3] != null ? "person" : "arcterm";
    const name = unquote(m?.[1] ?? m?.[2] ?? "");
    return { from, name, time: m?.[5] ?? null, raw: `${head}\n${body}`, ...bodyOf(from, body) };
}

// a message's leading `> line` (the line it answers) and a person's `Answer to A<n>: `, lifted out of its text
function bodyOf(from: RelayFrom, body: string): Pick<RelayMessage, "quote" | "answers" | "text"> {
    let rest = body;
    let quote: string | null = null;
    if (rest.startsWith("> ")) {
        const nl = rest.indexOf("\n");
        quote = (nl < 0 ? rest : rest.slice(0, nl)).slice(2).trim();
        rest = nl < 0 ? "" : rest.slice(nl + 1);
    }
    const a = from === "person" ? ANSWER.exec(rest) : null;
    if (a != null) {
        rest = rest.slice(a[0].length);
    }
    return { quote, answers: a != null ? Number(a[1]) : null, text: rest.trim() };
}

/** The judges a working agent's brief pairs it with: the quoted names of its first sentence. */
export function briefJudges(brief: string): string[] {
    const end = brief.indexOf(". ");
    const first = end < 0 ? brief : brief.slice(0, end);
    return [...first.matchAll(new RegExp(QUOTED, "g"))].map((m) => unquote(m[1] ?? ""));
}

interface PairSides {
    worker: { name: string; tab: string };
    judges?: { name: string; tab: string }[] | null;
}

/** The tab a relayed message's sender has in the live pair, or null: no pair, the person or arcterm, or a judge's name
 *  that two judges share. */
export function relaySenderTab(pair: PairSides | null, msg: Pick<RelayMessage, "from" | "name">): string | null {
    if (pair == null) {
        return null;
    }
    if (msg.from === "worker") {
        return pair.worker.name === msg.name ? pair.worker.tab : null;
    }
    if (msg.from !== "judge") {
        return null;
    }
    const named = (pair.judges ?? []).filter((j) => j.name === msg.name);
    return named.length === 1 ? (named[0]?.tab ?? null) : null;
}

/** The key the n-th message of a relay item is drawn under, as an agent's prose part is (stepsPartKey): Chat's pair
 *  cards find their place by it. */
export function relayPartKey(itemKey: string, n: number): string {
    return `${itemKey}#relay${n}`;
}

/** The working agent's texts a relay item holds, keyed as its card draws them: in the judge's Chat, the only way the
 *  working agent's arc-pair lists arrive. */
export function relayWorkerTexts(itemKey: string, relay: PairRelay): { key: string; text: string }[] {
    if (relay.kind === "judgeBrief") {
        return relay.reply != null ? [{ key: relayPartKey(itemKey, 0), text: relay.reply.text }] : [];
    }
    if (relay.kind !== "relay") {
        return [];
    }
    return relay.messages.flatMap((m, n) =>
        m.from === "worker" ? [{ key: relayPartKey(itemKey, n), text: m.text }] : []
    );
}
