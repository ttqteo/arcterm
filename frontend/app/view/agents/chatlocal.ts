// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0
//
// The bare built-ins Chat answers itself. Claude Code draws /usage, /context, /tasks… as a panel on its own screen that
// the transcript never holds, so sent from Chat they showed nothing but a pending card. The numbers those panels show
// are ones the cockpit already keeps (the plan windows, the agent's context and cost, its background tasks and
// subagents, the usage scan, the command list), so a bare one typed in the chat box is not sent: Chat draws a card of
// its own under the conversation (chatlocalcards.tsx), with a way to the real panel in the Terminal. `/diff` opens the
// Diff surface on the agent instead. Pure; the per-agent list is chatlocalstore.ts's.

import { formatTokens } from "./agentsviewmodel";
import type { BackgroundTask } from "./transcriptprojection";

export type LocalPanel = "usage" | "context" | "tasks" | "stats" | "skills" | "help" | "status";

export type LocalRoute = { panel: LocalPanel; command: string } | { open: "diff"; command: string };

// command (no slash) -> what Chat does with it. /cost is Claude Code's alias of /usage, /bashes the old name of /tasks
const ROUTES: Record<string, LocalPanel | "diff"> = {
    usage: "usage",
    cost: "usage",
    context: "context",
    tasks: "tasks",
    bashes: "tasks",
    stats: "stats",
    skills: "skills",
    help: "help",
    status: "status",
    diff: "diff",
};

/** Pure: whether Chat answers the bare command `name` (no slash) itself, with a card or the Diff surface: the `/` menu
 *  lists these first, as In Chat. */
export function answersInChat(name: string): boolean {
    return Object.prototype.hasOwnProperty.call(ROUTES, name);
}

/** Pure: what Chat does with `text` instead of sending it, or null to send it: only a bare command (no argument, an
 *  argument is Claude Code's to read). */
export function localCommand(text: string): LocalRoute | null {
    const found = /^\/([a-z-]+)$/u.exec(text.trim());
    // own keys only: `/constructor` names no route
    if (found == null || !answersInChat(found[1])) {
        return null;
    }
    const to = ROUTES[found[1]];
    const command = `/${found[1]}`;
    return to === "diff" ? { open: "diff", command } : { panel: to, command };
}

export interface LocalCard {
    id: string;
    panel: LocalPanel;
    command: string; // as typed: "/cost" draws the usage card under its own name
    at: number;
}

/** Pure: the agent's cards with `card` shown: one card per panel, so asking again moves it to the end, the newest. */
export function withCard(cards: LocalCard[], card: LocalCard): LocalCard[] {
    return [...cards.filter((c) => c.panel !== card.panel), card];
}

/** Pure: the context card's figures: the percent, the tokens it stands for and the window, as "84k / 200k". Null
 *  before the first reading (a zero would read as an empty window). */
export function contextFigures(
    usage: Pick<AgentUsage, "contextpct" | "contextmax"> | undefined
): { pct: number; used: string | null; max: string | null; left: string | null } | null {
    const pct = usage?.contextpct;
    if (pct == null || !Number.isFinite(pct)) {
        return null;
    }
    const max = usage?.contextmax;
    if (max == null || !(max > 0)) {
        return { pct, used: null, max: null, left: null };
    }
    const used = Math.round((pct / 100) * max);
    return {
        pct,
        used: formatTokens(used),
        max: formatTokens(max),
        left: formatTokens(Math.max(0, max - used)),
    };
}

/** Pure: a cost in dollars as the TUI's /cost line shows it: cents under $10, whole dollars past $1000. */
export function formatUsd(usd: number): string {
    if (!Number.isFinite(usd) || usd <= 0) {
        return "$0.00";
    }
    if (usd >= 1000) {
        return `$${Math.round(usd).toLocaleString("en-US")}`;
    }
    return `$${usd.toFixed(2)}`;
}

export interface TaskGroups {
    running: BackgroundTask[];
    ended: BackgroundTask[];
}

// past this many, the ended ones fold into a count: the card answers "what is still going", the tree keeps the rest
export const ENDED_SHOWN = 5;

/** Pure: the agent's background tasks split into the ones still running (oldest first, as started) and the ones that
 *  ended (newest end first, at most ENDED_SHOWN; `endedMore` counts the rest). */
export function taskGroups(tasks: BackgroundTask[] | undefined): TaskGroups & { endedMore: number } {
    const all = tasks ?? [];
    const running = all.filter((t) => t.status === "running");
    const ended = all
        .filter((t) => t.status !== "running")
        .sort((a, b) => (b.endMs ?? b.startMs ?? 0) - (a.endMs ?? a.startMs ?? 0));
    return { running, ended: ended.slice(0, ENDED_SHOWN), endedMore: Math.max(0, ended.length - ENDED_SHOWN) };
}

/** Pure: the session id a Claude transcript path names (`…/<uuid>.jsonl`), or null. */
export function sessionIdOf(transcriptPath: string | undefined): string | null {
    const found = /([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\.jsonl$/iu.exec(transcriptPath ?? "");
    return found == null ? null : found[1];
}
