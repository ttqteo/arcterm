// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { describe, expect, it } from "vitest";
import { cacheMinutes, contextGroups, fmtTok, readAgo, rewriteNow, type CtxBreakdownData } from "./ctxbreakdown";

const B: CtxBreakdownData = {
    model: "claude-opus-5-5",
    windowtokens: 1_000_000,
    readat: 0,
    categories: [
        { name: "System prompt", tokens: 2500 },
        { name: "System tools", tokens: 10100 },
        { name: "MCP tools", tokens: 676 },
        { name: "MCP server instructions", tokens: 1100 },
        { name: "MCP tools (deferred)", tokens: 32700, deferred: true },
        { name: "System tools (deferred)", tokens: 17100, deferred: true },
        { name: "Custom agents", tokens: 423 },
        { name: "Memory files", tokens: 16000 },
        { name: "Skills", tokens: 6500 },
        { name: "Messages", tokens: 1600 },
        { name: "Compact buffer", tokens: 3000 },
        { name: "Free space", tokens: 958100 },
    ],
    memoryfiles: [
        { name: "CLAUDE.md", source: "User", path: "C:\\Users\\me\\.claude\\CLAUDE.md", tokens: 275 },
        { name: "AGENTS.md", source: "Project", path: "D:\\work\\arcterm\\AGENTS.md", tokens: 14800 },
        {
            name: "MEMORY.md",
            source: "AutoMem",
            path: "C:\\Users\\me\\.claude\\projects\\x\\memory\\MEMORY.md",
            tokens: 925,
        },
    ],
    skills: Array.from({ length: 9 }, (_, i) => ({ name: `s${i}`, source: "User", tokens: (i + 1) * 10 })),
    agents: [{ name: "superpowers:code-reviewer", source: "Plugin", path: "/x/code-reviewer.md", tokens: 350 }],
    mcpservers: [{ server: "stitch", tools: 18, tokens: 22900 }],
};

describe("contextGroups", () => {
    const g = contextGroups(B, 70_000);
    it("estimates Messages as the context in use minus what loads every turn", () => {
        // fixed = 2500 + 10100 + 676 + 1100 + 423 + 16000 + 6500 = 37299
        expect(g[0]).toMatchObject({ id: "messages", tokens: 70_000 - 37_299, tag: "Compact shrinks", estimate: true });
    });
    it("orders the every-turn groups and merges the two MCP rows", () => {
        expect(g.map((x) => x.id)).toEqual(["messages", "tools", "memory", "skills", "prompt", "agents", "mcp"]);
        expect(g.find((x) => x.id === "mcp")!.tokens).toBe(1776);
    });
    it("notes the deferred system tools", () => {
        expect(g.find((x) => x.id === "tools")!.note).toBe(
            "Built in. 17.1k more are deferred: a tool search loads them when needed."
        );
    });
    it("shows the six costliest skills and folds the rest into more", () => {
        const s = g.find((x) => x.id === "skills")!;
        expect(s.rows.map((r) => r.name)).toEqual(["s8", "s7", "s6", "s5", "s4", "s3"]);
        expect(s.more.map((r) => r.name)).toEqual(["s2", "s1", "s0"]);
        expect(s.count).toBe(9);
    });
    it("keeps a memory file's path and names its folder", () => {
        const m = g.find((x) => x.id === "memory")!.rows[1];
        expect(m).toMatchObject({
            name: "AGENTS.md",
            detail: "Project · arcterm",
            path: "D:\\work\\arcterm\\AGENTS.md",
        });
    });
    it("words /context's AutoMem type", () => {
        expect(g.find((x) => x.id === "memory")!.rows[2].detail).toBe("Auto memory · memory");
    });
    it("words an MCP server by its tools", () => {
        expect(g.find((x) => x.id === "mcp")!.rows[0]).toMatchObject({
            name: "stitch",
            detail: "18 tools · 22.9k when loaded",
        });
    });
    it("never lets Messages go negative and takes percents of the larger total", () => {
        const low = contextGroups(B, 10_000);
        expect(low[0].tokens).toBe(0);
        expect(low.reduce((a, x) => a + x.pct, 0)).toBeCloseTo(100, 0);
    });
});

describe("figures", () => {
    it("formats tokens", () => {
        expect([fmtTok(231), fmtTok(9100), fmtTok(14_800), fmtTok(927_000)]).toEqual(["231", "9.1k", "14.8k", "927k"]);
        expect([fmtTok(200_000), fmtTok(1_000_000), fmtTok(1_500_000)]).toEqual(["200k", "1M", "1.5M"]);
    });
    it("reads the cache countdown", () => {
        expect([
            cacheMinutes("43m left"),
            cacheMinutes("<1m left"),
            cacheMinutes("expired"),
            cacheMinutes("—"),
        ]).toEqual([43, 0, null, null]);
    });
    it("estimates what compacting now rewrites", () => {
        expect(rewriteNow(70_000, 23_100)).toBe(48_900);
    });
    it("says how long ago it read", () => {
        expect([readAgo(0, 30_000), readAgo(0, 120_000), readAgo(0, 2 * 3_600_000)]).toEqual([
            "just now",
            "2 min ago",
            "2 h ago",
        ]);
    });
});
