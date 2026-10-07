// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { describe, expect, it } from "vitest";
import type { AgentVM } from "./agentsviewmodel";
import { tokenReloads, watchOf } from "./livetokens";

function agent(id: string, state: AgentVM["state"], transcriptPath?: string): AgentVM {
    return { id, name: id, task: "", state, questions: [], transcriptPath } as unknown as AgentVM;
}

describe("tokenReloads", () => {
    it("reads an agent the first time it has a transcript", () => {
        expect(tokenReloads(new Map(), [agent("a", "working", "/t/a.jsonl"), agent("b", "idle")])).toEqual(["a"]);
    });

    it("reads again when a turn ends, and not while it is working", () => {
        const prev = watchOf([agent("a", "working", "/t/a.jsonl")]);
        expect(tokenReloads(prev, [agent("a", "working", "/t/a.jsonl")])).toEqual([]);
        expect(tokenReloads(prev, [agent("a", "idle", "/t/a.jsonl")])).toEqual(["a"]);
        expect(tokenReloads(prev, [agent("a", "asking", "/t/a.jsonl")])).toEqual(["a"]);
    });

    it("does not read an idle agent again until it has worked", () => {
        const prev = watchOf([agent("a", "idle", "/t/a.jsonl")]);
        expect(tokenReloads(prev, [agent("a", "idle", "/t/a.jsonl")])).toEqual([]);
        expect(tokenReloads(prev, [agent("a", "asking", "/t/a.jsonl")])).toEqual([]);
    });

    it("reads an agent that moved to another transcript (/clear, a resume)", () => {
        const prev = watchOf([agent("a", "idle", "/t/a.jsonl")]);
        expect(tokenReloads(prev, [agent("a", "idle", "/t/b.jsonl")])).toEqual(["a"]);
    });
});
