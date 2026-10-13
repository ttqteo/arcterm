// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0
//
// Pure: what the Agent details rail says in its context row, its footer action, its tool chips, its files summary
// and the worktree line under its branch. No React.

import { usageLevel, type AgentVM } from "./agentsviewmodel";

// a tool used this few times reads dimmer, so the verbs doing the work stand out
const TOOL_DIM_AT = 3;

function tokensLabel(n: number): string {
    if (n >= 1_000_000) {
        return `${+(n / 1_000_000).toFixed(1)}M`;
    }
    return `${Math.round(n / 1000)}k`;
}

type Level = ReturnType<typeof usageLevel>;

// every turn re-reads the whole context from cache, so its size is the per-turn cost however much window is left:
// a 1M window at 18% is as costly as a 200k window at 91%
const CONTEXT_WARN_TOKENS = 150_000;
const CONTEXT_HOT_TOKENS = 300_000;
const LEVEL_RANK: Record<Level, number> = { ok: 0, warn: 1, hot: 2 };

function tokenLevel(tokens: number): Level {
    if (tokens >= CONTEXT_HOT_TOKENS) {
        return "hot";
    }
    return tokens >= CONTEXT_WARN_TOKENS ? "warn" : "ok";
}

// contextLevel colors the context gauge: the worse of how full the window is and how many tokens every turn
// re-reads. Fullness alone when the window size is unknown.
export function contextLevel(pct: number, max: number | undefined): Level {
    const byFullness = usageLevel(pct);
    if (!max) {
        return byFullness;
    }
    const byTokens = tokenLevel((pct / 100) * max);
    return LEVEL_RANK[byTokens] > LEVEL_RANK[byFullness] ? byTokens : byFullness;
}

// contextTokens labels how many tokens are in context. Undefined when the window size is unknown.
export function contextTokens(pct: number, max: number | undefined): string | undefined {
    return max ? tokensLabel((pct / 100) * max) : undefined;
}

// contextNote is the line under the context bar: a warning once the window is nearly full, what every turn re-reads
// once that is costly, else how much of the window is used. Empty when the window size is unknown.
export function contextNote(pct: number, max: number | undefined): string {
    if (usageLevel(pct) === "hot") {
        return "Near the limit.";
    }
    if (!max) {
        return "";
    }
    const tokens = (pct / 100) * max;
    if (tokenLevel(tokens) !== "ok") {
        return `${tokensLabel(tokens)} re-read every turn`;
    }
    return `${tokensLabel(tokens)} of ${tokensLabel(max)} tokens`;
}

// offersContextReset says when the rail offers Compact and Clear: they type a slash command into the terminal, which
// only Claude takes and which mid-turn would queue into the agent's input instead of running.
export function offersContextReset(o: {
    isClaude: boolean;
    state: AgentVM["state"];
    level: Level;
    live: boolean;
}): boolean {
    return o.isClaude && o.live && o.state === "idle" && o.level !== "ok";
}

// cacheRewriteTitle is the Session line's tooltip: an expired cache makes the next turn write the whole context again.
export function cacheRewriteTitle(pct: number | undefined, max: number | undefined): string | undefined {
    const tokens = pct != null ? contextTokens(pct, max) : undefined;
    return tokens ? `if the cache expires, the next turn rewrites ~${tokens}` : undefined;
}

export type RailAction = { kind: "resume" | "stop"; hint: string };

// railAction is the rail footer's one control: Resume nudges an idle agent, Stop interrupts a turn. An agent with
// no live terminal has nothing to drive.
export function railAction(state: AgentVM["state"], age: string, live: boolean): RailAction | null {
    if (!live) {
        return null;
    }
    if (state === "idle") {
        return { kind: "resume", hint: `idle ${age} · nudge to continue` };
    }
    if (state === "asking") {
        return { kind: "stop", hint: "waiting on you · Esc in the terminal also stops" };
    }
    return { kind: "stop", hint: `working ${age} · Esc also stops` };
}

export function toolChips(byVerb: { verb: string; count: number }[]): { verb: string; count: number; dim: boolean }[] {
    return [...byVerb].sort((a, b) => b.count - a.count).map((t) => ({ ...t, dim: t.count <= TOOL_DIM_AT }));
}

export function filesSummary(files: { adds: number; dels: number }[]): string {
    const adds = files.reduce((n, f) => n + f.adds, 0);
    const dels = files.reduce((n, f) => n + f.dels, 0);
    return `${files.length} ${files.length === 1 ? "file" : "files"} · +${adds} −${dels}`;
}

const slashed = (p: string) => p.replace(/\\/g, "/").replace(/\/+$/, "");
// windows paths compare case-insensitively
const samePath = (p: string) => slashed(p).toLowerCase();
const isUnder = (p: string, root: string) => samePath(p).startsWith(samePath(root) + "/");

// linkedWorktree names the linked worktree cwd is inside, relative to the main checkout when it sits under it, else
// by its full path. Undefined in the main checkout or outside every listed worktree.
export function linkedWorktree(cwd: string, worktrees: GitWorktree[]): string | undefined {
    const own = worktrees
        .filter((wt) => samePath(cwd) === samePath(wt.path) || isUnder(cwd, wt.path))
        .sort((a, b) => b.path.length - a.path.length)[0];
    if (own == null || own.ismain) {
        return undefined;
    }
    const main = worktrees.find((wt) => wt.ismain);
    if (main == null || !isUnder(own.path, main.path)) {
        return slashed(own.path);
    }
    return slashed(own.path).slice(slashed(main.path).length + 1);
}
