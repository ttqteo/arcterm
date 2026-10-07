// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0
//
// Pure derivations for the Channels surface: the rail's filter and partition, project-path matching, and
// the composer's @mentions.

import { parseMentions, type RosterEntry } from "./channelmessages";

// Case-insensitive substring filter over channel names for the rail search box. A blank query returns
// the list unchanged.
export function filterChannels(channels: Channel[], query: string): Channel[] {
    const q = query.trim().toLowerCase();
    return q ? channels.filter((c) => c.name.toLowerCase().includes(q)) : channels;
}

// Turn a consult reply into a dispatch line: re-pose the consult question as an @runtime task. The
// caller feeds this straight to sendChannelMessage, which routes it through the normal dispatch verb.
export function promoteConsultText(runtime: string, question: string): string {
    return `@${runtime} ${question.trim()}`;
}

// The comparison key for a project path. A channel stores what the user registered (backslashes on
// Windows) while a radar report stores it canonPath'd, so two spellings of one project must land on one
// key or the app mints a duplicate channel for a project that already has one. Mirrors Go's canonPath.
export function normProjectPath(p: string): string {
    return p.replace(/\\/g, "/").replace(/\/+$/, "");
}

// resolveTargetChannel finds the channel a Radar finding should hand off to: the first whose bound
// project path matches. Both paths trace back to the same project registry, but a radar report stores it
// canonPath'd (forward slashes, per pkg/reporadar) while a channel stores it verbatim — so on Windows a
// backslash channel path must be separator-normalized before comparing, mirroring Go's canonPath.
export function resolveTargetChannel(channels: Channel[], projectPath: string | undefined): Channel | undefined {
    if (!projectPath) {
        return undefined;
    }
    const want = normProjectPath(projectPath);
    return channels.find((c) => c.projectpath != null && normProjectPath(c.projectpath) === want);
}

export interface ChannelPartition {
    active: Channel[];
    archived: Channel[];
}

// Split channels into active vs archived by the "archived" meta flag (see wstore.MetaKey_Archived). The
// rail shows active rows and tucks archived ones under a collapsible "Archived · N" disclosure. Order-preserving.
export function partitionChannels(channels: Channel[]): ChannelPartition {
    const active: Channel[] = [];
    const archived: Channel[] = [];
    for (const c of channels) {
        if ((c.meta as Record<string, unknown> | undefined)?.["archived"] === true) {
            archived.push(c);
        } else {
            active.push(c);
        }
    }
    return { active, archived };
}

// --- composer @mentions ------------------------------------------------------
// A single mentionable target for the composer's highlight + suggestion dropdown.
export interface MentionCandidate {
    name: string; // the token inserted after "@" (a lower-case runtime id or a roster name)
    kind: "runtime" | "agent";
}

// Everything a channel can address: dispatch runtimes, then the live roster (for steering). Deduped
// case-insensitively, first-wins — so a runtime beats a same-named roster row, matching planMessage's
// runtime-before-roster precedence.
export function mentionCandidates(installedRuntimes: string[], roster: RosterEntry[]): MentionCandidate[] {
    const out: MentionCandidate[] = [];
    const seen = new Set<string>();
    const add = (name: string, kind: MentionCandidate["kind"]) => {
        const key = name.toLowerCase();
        if (seen.has(key)) {
            return;
        }
        seen.add(key);
        out.push({ name, kind });
    };
    for (const r of installedRuntimes) {
        add(r, "runtime");
    }
    for (const e of roster) {
        add(e.name, "agent");
    }
    return out;
}

// A highlighted-composer segment: a run of plain text, a resolved @mention token, or a command keyword
// (currently the leading "ask" of a consult).
export type SegmentKind = "text" | "mention" | "command";

export interface HighlightSegment {
    text: string;
    kind: SegmentKind;
}

const MENTION_TOKEN = /@[\w./-]+/g;
// The leading "ask" consult keyword: "ask" at the start (after optional whitespace) followed by a space.
const ASK_COMMAND = /^(\s*)(ask)(\s)/i;

// Whether the text after "ask " routes as a consult: a known runtime is named among its leading mentions.
// Mirrors planMessage exactly (parseMentions requires a trailing space, so a bare "ask @claude" is a post).
function isConsultTail(tail: string, runtimes: Set<string>): boolean {
    return parseMentions(tail).mentions.some((m) => runtimes.has(m));
}

// Split composer text into plain / mention / command runs for the backdrop overlay. An "@token" is a
// mention only when it starts the string or follows whitespace AND its name (case-insensitively) is a
// known target — so a typo or an email's "@" stays plain, giving the user real "this resolves" feedback.
// A leading "ask" is a command only when it forms a real consult (a known runtime follows), so highlight
// tracks routing, not just the literal word.
export function highlightSegments(text: string, known: Set<string>, runtimes: Set<string>): HighlightSegment[] {
    if (text === "") {
        return [];
    }
    const segs: HighlightSegment[] = [];
    let last = 0;

    const askM = ASK_COMMAND.exec(text);
    if (askM && isConsultTail(text.slice(askM[0].length), runtimes)) {
        const askStart = askM[1].length; // after any leading whitespace
        if (askStart > 0) {
            segs.push({ text: text.slice(0, askStart), kind: "text" });
        }
        segs.push({ text: askM[2], kind: "command" });
        last = askStart + askM[2].length; // leave the trailing space for the mention/plain pass
    }

    MENTION_TOKEN.lastIndex = last;
    let m: RegExpExecArray | null;
    while ((m = MENTION_TOKEN.exec(text)) !== null) {
        const i = m.index;
        const boundary = i === 0 || /\s/.test(text[i - 1]);
        if (boundary && known.has(m[0].slice(1).toLowerCase())) {
            if (i > last) {
                segs.push({ text: text.slice(last, i), kind: "text" });
            }
            segs.push({ text: m[0], kind: "mention" });
            last = i + m[0].length;
        }
    }
    if (last < text.length) {
        segs.push({ text: text.slice(last), kind: "text" });
    }
    return segs;
}
