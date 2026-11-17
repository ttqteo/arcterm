import { describe, expect, it } from "vitest";
import { badgeLook, refSpans, refTitle, resolveRef, type RefSources } from "./refbadge";

const src: RefSources = {
    agents: [
        { id: "7cd99627-1111-4a4a-8b8b-000000000001", name: "chat-commit-card", state: "working", agent: "claude" },
        { id: "3fa1c2e0-2222-4a4a-8b8b-000000000002", name: "api-tests", state: "asking", agent: "codex" },
        { id: "3fa1c2ff-3333-4a4a-8b8b-000000000003", name: "docs-sweep", state: "idle", agent: "claude" },
        { id: "9a9a9a9a-6666-4a4a-8b8b-000000000006", name: "odd-one", state: "idle", agent: "nosuchruntime" },
    ],
    runs: [{ oid: "071a8e3b-4444-4a4a-8b8b-000000000004", goal: "Close the tree's picked rows\ntogether" }],
    councils: [{ id: "c41d9e02-5555-4a4a-8b8b-000000000005", feature: "Chat compact work" }],
    project: "D:\\projects\\arcterm",
};

describe("refSpans", () => {
    it("finds a token as its own word, after @ too, and keeps the text as written", () => {
        const text = "có gồm agent:7cd99627 không? @run:071a8e3b, (council:C41D9E02)";
        expect(refSpans(text).map((s) => [s.kind, s.id, s.raw, text.slice(s.start, s.end)])).toEqual([
            ["agent", "7cd99627", "agent:7cd99627", "agent:7cd99627"],
            ["run", "071a8e3b", "@run:071a8e3b", "@run:071a8e3b"],
            ["council", "c41d9e02", "council:C41D9E02", "council:C41D9E02"],
        ]);
    });
    it("reads tab: as agent", () => {
        expect(refSpans("tab:7cd99627")[0].kind).toBe("agent");
    });
    it("leaves glued, too short, non-hex and other kinds as text", () => {
        expect(
            refSpans("xagent:7cd99627 agent:7cd agent:zzzz9999 session:9f31d0b4 effort:e9b20f17 agent:7cd99627x")
        ).toEqual([]);
    });
    it("leaves the token the caret is in or at the end of", () => {
        expect(refSpans("agent:7cd99627", 14)).toEqual([]);
        expect(refSpans("agent:7cd99627 ", 15)).toHaveLength(1);
    });
});

describe("resolveRef", () => {
    it("resolves an agent by unique prefix, with its runtime and state", () => {
        expect(resolveRef("agent", "7cd99627", src)).toEqual({
            status: "resolved",
            kind: "agent",
            id: src.agents[0].id,
            name: "chat-commit-card",
            runtime: "claude",
            state: "working",
        });
    });
    it("names a run by its goal's first line and a council by its feature", () => {
        expect(resolveRef("run", "071a8e3b", src)).toMatchObject({
            status: "resolved",
            name: "Close the tree's picked rows",
        });
        expect(resolveRef("council", "c41d9e02", src)).toMatchObject({ status: "resolved", name: "Chat compact work" });
    });
    it("prefers an exact id over prefixes", () => {
        const exact = {
            ...src,
            agents: [...src.agents, { id: "3fa1", name: "short", state: "idle" as const, agent: "pi" }],
        };
        expect(resolveRef("agent", "3fa1", exact)).toMatchObject({ status: "resolved", name: "short" });
    });
    it("says why it cannot resolve", () => {
        expect(resolveRef("agent", "deadbeef", src)).toEqual({
            status: "unresolved",
            reason: "No agent deadbeef is open",
        });
        expect(resolveRef("agent", "3fa1", src)).toEqual({ status: "unresolved", reason: "agent:3fa1 names 2 agents" });
        expect(resolveRef("run", "deadbeef", src)).toEqual({
            status: "unresolved",
            reason: "No run deadbeef in this project",
        });
        expect(resolveRef("council", "deadbeef", { ...src, project: "" })).toEqual({
            status: "unresolved",
            reason: "This chat has no project to find council deadbeef in",
        });
    });
});

describe("badgeLook and refTitle", () => {
    it("tints an agent by its runtime, a run and a council by their marks", () => {
        expect(badgeLook(resolveRef("agent", "7cd99627", src))).toEqual({
            frame: "border-rt-claude-line bg-rt-claude-soft",
            mark: "runtime",
            dot: "working",
        });
        expect(badgeLook(resolveRef("agent", "3fa1c2e0", src)).dot).toBe("asking");
        expect(badgeLook(resolveRef("agent", "3fa1c2ff", src)).dot).toBeNull();
        expect(badgeLook(resolveRef("run", "071a8e3b", src))).toEqual({
            frame: "border-mark-run-line bg-mark-run-soft",
            mark: "run",
            dot: null,
        });
        expect(badgeLook(resolveRef("council", "c41d9e02", src)).mark).toBe("council");
    });
    it("gives an agent of an unknown runtime runtimeMeta's fallback frame", () => {
        expect(badgeLook(resolveRef("agent", "9a9a9a9a", src))).toEqual({
            frame: "border-border bg-surface-hover",
            mark: "runtime",
            dot: null,
        });
    });
    it("draws an unresolved token dashed with no mark", () => {
        expect(badgeLook(resolveRef("agent", "deadbeef", src))).toEqual({
            frame: "border-dashed border-edge-strong bg-transparent text-muted",
            mark: null,
            dot: null,
        });
    });
    it("titles a badge with name, kind, short id and state, or the reason", () => {
        expect(refTitle(resolveRef("agent", "3fa1c2e0", src))).toBe(
            "api-tests · agent 3fa1c2e0 · asking (click to open)"
        );
        expect(refTitle(resolveRef("run", "071a8e3b", src))).toBe(
            "Close the tree's picked rows · run 071a8e3b (click to open)"
        );
        expect(refTitle(resolveRef("agent", "deadbeef", src))).toBe("No agent deadbeef is open");
    });
});
