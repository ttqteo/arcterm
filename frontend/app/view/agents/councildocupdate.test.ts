// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { describe, expect, it } from "vitest";
import type { AgentVM } from "./agentsviewmodel";
import { docUpdateAgents, docUpdatePrompt } from "./councildocupdate";

const council = (memory: Partial<CouncilMemory> | undefined, extra: Partial<Council> = {}): Council =>
    ({
        id: "c1",
        project: "/Users/me/thesis",
        feature: "Settle the  problem\nafter M5",
        docpath: "/Users/me/thesis/docs/council/2026-11-04-settle.md",
        memory,
        ...extra,
    }) as unknown as Council;

const entry = (id: string, kind: string, text: string, why = ""): CouncilMemoryEntry =>
    ({ id, kind, text, why, by: "auto", at: Number(id.slice(1)) }) as CouncilMemoryEntry;

const agent = (id: string, extra: Partial<AgentVM>): AgentVM =>
    ({ id, name: id, agent: "claude", kind: "agent", blockId: `b-${id}`, project: "thesis", ...extra }) as AgentVM;

describe("docUpdatePrompt", () => {
    it("names the council and its report, lists what it settled, and keeps the agent off the block", () => {
        const p = docUpdatePrompt(
            council({
                chosen: { text: "Read the paper before citing it" } as CouncilMemoryDirection,
                entries: [
                    entry("m1", "agreed", "It is a benchmark."),
                    entry("m2", "ruledout", "Cite it as proof", "it measures another task"),
                    entry("m3", "open", "What does human-engineered mean?"),
                ],
            })
        );
        expect(p).toContain('The council "Settle the problem after M5" (docs/council/2026-11-04-settle.md)');
        expect(p).toContain("Direction: Read the paper before citing it");
        expect(p).toContain("Agreed: It is a benchmark.");
        expect(p).toContain("Ruled out: Cite it as proof (why: it measures another task)");
        expect(p).toContain("Open: What does human-engineered mean?");
        expect(p).toContain("arc:council-decisions");
        expect(p).toContain("Show me the diff");
        expect(p).not.toContain("\n");
    });

    it("is empty when the memory settles nothing", () => {
        expect(docUpdatePrompt(council(undefined))).toBe("");
        expect(docUpdatePrompt(council({ entries: [] }))).toBe("");
    });

    it("names a report outside the project by its full path, and leaves out one it does not have", () => {
        const settled = { entries: [entry("m1", "agreed", "A.")] };
        expect(docUpdatePrompt(council(settled, { docpath: "/elsewhere/r.md" }))).toContain("(/elsewhere/r.md)");
        expect(docUpdatePrompt(council(settled, { docpath: "" }))).toContain(
            'The council "Settle the problem after M5" settled'
        );
    });
});

describe("docUpdateAgents", () => {
    const registry = { thesis: { path: "/Users/me/thesis" }, other: { path: "/Users/me/other" } };

    it("keeps the live Claude agent tabs of the council's project", () => {
        const roster = [
            agent("a", {}),
            agent("pi", { agent: "pi" }),
            agent("term", { kind: "terminal" as AgentVM["kind"] }),
            agent("gone", { blockId: undefined }),
            agent("elsewhere", { project: "other" }),
            agent("bycwd", { project: "", cwd: "/Users/me/thesis/" }),
        ];
        expect(docUpdateAgents(roster, registry, "/Users/me/thesis").map((a) => a.id)).toEqual(["a", "bycwd"]);
    });

    it("has none for a project no agent is in", () => {
        expect(docUpdateAgents([agent("a", {})], registry, "/Users/me/new")).toEqual([]);
    });
});
