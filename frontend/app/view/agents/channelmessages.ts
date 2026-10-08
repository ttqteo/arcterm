// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import type { Runtime } from "./launch";

const RUNTIMES: Runtime[] = ["claude", "codex", "opencode", "pi", "agy", "terminal"];

export interface ParsedMentions {
    mentions: string[];
    body: string;
}

export function parseMentions(text: string): ParsedMentions {
    const mentions: string[] = [];
    let rest = text.trimStart();
    const re = /^@([\w./-]+)\s+/;
    let m = re.exec(rest);
    while (m) {
        mentions.push(m[1].toLowerCase());
        rest = rest.slice(m[0].length);
        m = re.exec(rest);
    }
    return { mentions, body: rest };
}

export interface RosterEntry {
    id: string;
    name: string;
    blockId?: string;
}

export type MessagePlan =
    | { kind: "dispatch"; runtime: Runtime; text: string }
    | { kind: "steer"; targetId: string; blockId?: string; text: string }
    | { kind: "consult"; runtimes: Runtime[]; text: string }
    | { kind: "post"; text: string };

export function planMessage(text: string, roster: RosterEntry[]): MessagePlan {
    const trimmed = text.trimStart();
    const askMatch = /^ask\s+/i.exec(trimmed);
    if (askMatch) {
        const { mentions, body } = parseMentions(trimmed.slice(askMatch[0].length));
        const runtimes = mentions.filter((m): m is Runtime => (RUNTIMES as string[]).includes(m));
        if (runtimes.length > 0) {
            return { kind: "consult", runtimes, text: body };
        }
        // "ask" with no known runtime -> not a consult; fall through to a plain post of the original text
    }
    const { mentions, body } = parseMentions(text);
    const first = mentions[0];
    if (first && (RUNTIMES as string[]).includes(first)) {
        return { kind: "dispatch", runtime: first as Runtime, text: body };
    }
    if (first) {
        const target = roster.find((r) => r.name.toLowerCase() === first);
        if (target) {
            return { kind: "steer", targetId: target.id, blockId: target.blockId, text: body };
        }
    }
    return { kind: "post", text };
}

export type JarvisTier = "concierge" | "gatekeeper";

// tierFromMeta reads the autonomy tier off a channel's meta. Gatekeeper is the default: only an explicit
// false is concierge, the same rule as the backend's GatekeeperOn (pkg/jarvis/resolve.go).
export function tierFromMeta(meta: Record<string, unknown> | undefined): JarvisTier {
    return meta?.["gatekeeper:enabled"] === false ? "concierge" : "gatekeeper";
}
