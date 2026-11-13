// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0
//
// Pure: what fills a Claude agent's context, as the rows the Agent details rail draws under its session block. It
// turns the breakdown wavesrv read from Claude Code's /context, plus the context in use now, into groups (Messages,
// System tools, Memory files, …), and holds the small figures the rail words around them (token labels, the cache
// countdown, what compacting now rewrites). No React, no Wave runtime imports.

// The input mirrors wavesrv's ContextBreakdown JSON (pkg/wshrpc) with its own types, so this file does not wait for the
// generated ones; the store hands the generated value over, which fits. The arrays are optional: Go leaves a missing
// table empty and may send null.
export interface CtxCategory {
    name: string;
    tokens: number;
    deferred?: boolean;
}

export interface CtxItem {
    name: string;
    source: string;
    path?: string;
    tokens: number;
}

export interface CtxMcp {
    server: string;
    tools: number;
    tokens: number;
}

export interface CtxBreakdownData {
    model: string;
    windowtokens: number;
    readat: number;
    categories?: CtxCategory[] | null;
    memoryfiles?: CtxItem[] | null;
    skills?: CtxItem[] | null;
    agents?: CtxItem[] | null;
    mcpservers?: CtxMcp[] | null;
}

export type CtxGroupId = "messages" | "tools" | "memory" | "skills" | "prompt" | "agents" | "mcp" | "other";

export interface CtxRow {
    name: string;
    detail: string;
    tokens?: number;
    // the file behind the row, when one resolved (a built-in skill or an MCP server has none)
    path?: string;
}

export interface CtxGroup {
    id: CtxGroupId;
    label: string;
    tokens: number;
    // of the larger of the context in use and what loads every turn, so the groups always add up to 100
    pct: number;
    tag: "Compact shrinks" | "every turn";
    // the Tailwind background class of its swatch and bar segment
    fill: string;
    note?: string;
    rows: CtxRow[];
    // the rows past the first SHOWN_ROWS, behind "+N more"
    more: CtxRow[];
    count?: number;
    estimate?: boolean;
}

// existing tokens only (frontend/tailwindsetup.css)
const FILL: Record<CtxGroupId, string> = {
    messages: "bg-conn-1",
    tools: "bg-cacheread",
    memory: "bg-mem-feedback",
    skills: "bg-skill",
    prompt: "bg-ink-faint",
    agents: "bg-graphlane-5",
    mcp: "bg-graphlane-2",
    other: "bg-edge-strong",
};

const LABEL: Record<CtxGroupId, string> = {
    messages: "Messages",
    tools: "System tools",
    memory: "Memory files",
    skills: "Skills",
    prompt: "System prompt",
    agents: "Custom agents",
    mcp: "MCP",
    other: "Other",
};

// /context's category names (lowercased) to the group each one fills; a category not listed sums into Other
const CATEGORY_GROUP: Record<string, CtxGroupId> = {
    "system prompt": "prompt",
    "system tools": "tools",
    "mcp tools": "mcp",
    "mcp server instructions": "mcp",
    "custom agents": "agents",
    "memory files": "memory",
    skills: "skills",
};

const GROUP_ORDER: CtxGroupId[] = ["messages", "tools", "memory", "skills", "prompt", "agents", "mcp", "other"];

// how many skills or agents a group lists before "+N more"
const SHOWN_ROWS = 6;

const SKILLS_NOTE = "Only each skill's description is in context; its file loads when it runs.";

// fmtTok words a token count: 231, 9.1k, 14.8k, 927k, 1M, 1.5M.
export function fmtTok(n: number): string {
    const r = Math.round(n);
    if (r < 1000) {
        return `${r}`;
    }
    if (n < 100_000) {
        return `${+(n / 1000).toFixed(1)}k`;
    }
    if (n < 1_000_000 && Math.round(n / 1000) < 1000) {
        return `${Math.round(n / 1000)}k`;
    }
    return `${+(n / 1_000_000).toFixed(1)}M`;
}

// cacheMinutes reads the minutes out of the rail's cache countdown ("43m left", "<1m left"); null when the cache has
// no countdown ("expired", "—", an hour-long cache's "1h 5m left").
export function cacheMinutes(countdown: string): number | null {
    if (countdown === "<1m left") {
        return 0;
    }
    const m = /^(\d+)m left$/.exec(countdown);
    return m ? Number(m[1]) : null;
}

// the cache is worth a warning once under this many minutes of it are left
const CACHE_WARN_MINUTES = 5;

export function cacheWarn(countdown: string): boolean {
    const m = cacheMinutes(countdown);
    return m != null && m < CACHE_WARN_MINUTES;
}

// the summary compacting leaves in place of the conversation, assumed: the model writes it, so its size is a guess
const ASSUMED_SUMMARY_TOKENS = 2000;

// rewriteNow estimates what the next turn writes to the cache if the conversation is compacted now: the context with
// Messages replaced by an assumed summary.
export function rewriteNow(live: number, messages: number): number {
    return live - messages + ASSUMED_SUMMARY_TOKENS;
}

export function freeTokens(window: number, live: number): number {
    return Math.max(0, window - live);
}

// compactBuffer is the room autocompact keeps back: /context's Compact buffer row.
export function compactBuffer(b: CtxBreakdownData): number {
    let tokens = 0;
    for (const c of b.categories ?? []) {
        if (!isDeferred(c) && isCompactBuffer(c.name)) {
            tokens += c.tokens;
        }
    }
    return tokens;
}

// readAgo says how long ago the breakdown was read.
export function readAgo(readAt: number, now: number): string {
    const secs = Math.max(0, Math.floor((now - readAt) / 1000));
    if (secs < 60) {
        return "just now";
    }
    if (secs < 3600) {
        return `${Math.floor(secs / 60)} min ago`;
    }
    return `${Math.floor(secs / 3600)} h ago`;
}

function lower(s: string): string {
    return s.trim().toLowerCase();
}

function isDeferred(c: CtxCategory): boolean {
    return !!c.deferred || /deferred/i.test(c.name);
}

function isCompactBuffer(name: string): boolean {
    return lower(name).includes("compact buffer");
}

// the folder a file sits in, for "Project · arcterm"; empty for a bare file name
function parentDirName(path: string): string {
    const parts = path.split(/[\\/]+/).filter(Boolean);
    return parts.length >= 2 ? parts[parts.length - 2] : "";
}

// /context types a memory file User, Project, AutoMem, …; AutoMem reads "Auto memory", as on the board
function memoryType(source: string): string {
    return source === "AutoMem" ? "Auto memory" : source;
}

function itemRow(i: CtxItem, detail: string): CtxRow {
    const row: CtxRow = { name: i.name, detail, tokens: i.tokens };
    if (i.path) {
        row.path = i.path;
    }
    return row;
}

function memoryRow(i: CtxItem): CtxRow {
    const folder = i.path ? parentDirName(i.path) : "";
    const type = memoryType(i.source);
    return itemRow(i, folder ? `${type} · ${folder}` : type);
}

function mcpRow(s: CtxMcp): CtxRow {
    const tools = `${s.tools} ${s.tools === 1 ? "tool" : "tools"}`;
    // the figure is what the server costs once loaded: /context's MCP table mixes loaded and deferred tools, so it is
    // not what the server costs now, and the row carries no tokens of its own
    return { name: s.server, detail: s.tokens > 0 ? `${tools} · ${fmtTok(s.tokens)} when loaded` : tools };
}

function byCost(items: CtxItem[]): CtxItem[] {
    return [...items].sort((a, b) => b.tokens - a.tokens);
}

// contextGroups lays out what fills the context in use now (live tokens): Messages first, an estimate (the context in
// use minus what loads every turn), then the every-turn groups from the headless /context run. A group with no tokens
// and no rows is left out; Messages never is.
export function contextGroups(b: CtxBreakdownData, live: number): CtxGroup[] {
    const sums: Partial<Record<CtxGroupId, number>> = {};
    let deferredTools = 0;
    let fixed = 0;
    for (const c of b.categories ?? []) {
        const name = lower(c.name);
        if (isDeferred(c)) {
            if (lower(c.name.replace(/\s*\(deferred\)\s*$/i, "")) === "system tools") {
                deferredTools += c.tokens;
            }
            continue;
        }
        if (name === "messages" || name === "free space" || isCompactBuffer(name)) {
            continue;
        }
        const id = CATEGORY_GROUP[name] ?? "other";
        sums[id] = (sums[id] ?? 0) + c.tokens;
        fixed += c.tokens;
    }

    const messages = Math.max(0, live - fixed);
    const total = Math.max(live, fixed);
    const pct = (tokens: number) => (total > 0 ? (tokens / total) * 100 : 0);

    const memory = (b.memoryfiles ?? []).map(memoryRow);
    const skills = byCost(b.skills ?? []).map((i) => itemRow(i, i.source));
    const agents = byCost(b.agents ?? []).map((i) => itemRow(i, i.source));
    const mcp = (b.mcpservers ?? []).map(mcpRow);

    const make = (id: CtxGroupId, tokens: number, rest: Partial<CtxGroup> = {}): CtxGroup => ({
        id,
        label: LABEL[id],
        tokens,
        pct: pct(tokens),
        tag: id === "messages" ? "Compact shrinks" : "every turn",
        fill: FILL[id],
        rows: [],
        more: [],
        ...rest,
    });
    // skills and agents list their costliest rows and fold the rest behind "+N more"
    const listed = (rows: CtxRow[]): Partial<CtxGroup> => ({
        rows: rows.slice(0, SHOWN_ROWS),
        more: rows.slice(SHOWN_ROWS),
        count: rows.length,
    });

    const groups: Record<CtxGroupId, CtxGroup> = {
        messages: make("messages", messages, { estimate: true }),
        tools: make("tools", sums.tools ?? 0, {
            note: `Built in.${
                deferredTools > 0
                    ? ` ${fmtTok(deferredTools)} more are deferred: a tool search loads them when needed.`
                    : ""
            }`,
        }),
        memory: make("memory", sums.memory ?? 0, { rows: memory, count: memory.length }),
        skills: make("skills", sums.skills ?? 0, { ...listed(skills), note: SKILLS_NOTE }),
        prompt: make("prompt", sums.prompt ?? 0),
        agents: make("agents", sums.agents ?? 0, listed(agents)),
        mcp: make("mcp", sums.mcp ?? 0, { rows: mcp, count: mcp.length }),
        other: make("other", sums.other ?? 0),
    };
    return GROUP_ORDER.map((id) => groups[id]).filter((g) => g.id === "messages" || g.tokens > 0 || g.rows.length > 0);
}
