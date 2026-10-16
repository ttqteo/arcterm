// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { describe, expect, it } from "vitest";
import type { AgentVM } from "./agentsviewmodel";
import type { GridCard } from "./cardgridlayout";
import type { LeadCardVM } from "./leadcardmodel";
import { officeInputs } from "./officeinputs";
import type { Lineage, RunInfo } from "./runlineage";

const agent = (id: string, o: Partial<AgentVM> = {}): AgentVM =>
    ({ id, name: id, task: "", state: "working", project: "p", agent: "claude", ...o }) as AgentVM;

describe("officeinputs", () => {
    it("draws the grid's agents (an idle one is in the Finished window) and the Idle section's", () => {
        const cards: GridCard[] = [
            { kind: "agent", id: "a", agent: agent("a") },
            { kind: "agent", id: "b", agent: agent("b", { state: "idle", idleSince: 5 }) },
        ];
        const parked = [agent("c", { state: "idle", idleSince: 1 }), agent("a")];
        const lineage = { runs: {}, roles: {} } as unknown as Lineage;
        const { agents } = officeInputs(cards, parked, new Map(), [], lineage);
        expect(agents.map((a) => [a.id, a.finished])).toEqual([
            ["a", false],
            ["b", true],
            ["c", false],
        ]);
        expect(agents[0].harness).toBe("claude");
    });

    it("turns a run card into its tasks, with the card's row keys and who is asking", () => {
        const run = {
            runId: "run1",
            title: "Gallery",
            project: "p",
            createdTs: 7,
            dag: {
                tasks: [
                    { id: "t1", label: "Model", state: "running" },
                    { id: "t2", state: "pending" },
                ],
            },
        } as unknown as RunInfo;
        const worker = agent("w1", { state: "asking" });
        const lineage = {
            runs: { run1: run },
            roles: { w1: { kind: "worker", leadRunId: "run1", taskId: "t1" } },
        } as unknown as Lineage;
        const vm = { rows: [{ key: "row:t1", taskId: "t1" }], waiting: [], done: [] } as unknown as LeadCardVM;
        const cards: GridCard[] = [{ kind: "run", id: "card1", run }];
        const { runs } = officeInputs(cards, [], new Map([["card1", vm]]), [worker], lineage);
        expect(runs).toEqual([
            {
                id: "card1",
                title: "Gallery",
                project: "p",
                createdTs: 7,
                done: false,
                landed: false,
                leadAsking: false,
                tasks: [
                    { id: "t1", label: "Model", state: "running", asking: true, key: "row:t1", workerId: "w1" },
                    { id: "t2", label: "t2", state: "pending", asking: false, key: undefined, workerId: undefined },
                ],
            },
        ]);
    });

    it("draws only what it is given: a filtered-out agent or run never appears", () => {
        const a = agent("a");
        const b = agent("b");
        const other = {
            runId: "run2",
            title: "Elsewhere",
            project: "p",
            createdTs: 1,
            dag: { tasks: [{ id: "t1", label: "T", state: "running" }] },
        } as unknown as RunInfo;
        const lineage = {
            runs: { run2: other },
            roles: { b: { kind: "lead", runId: "run2" } },
        } as unknown as Lineage;
        const cards: GridCard[] = [{ kind: "agent", id: "a", agent: a }];
        const { agents, runs } = officeInputs(cards, [agent("c", { state: "idle" })], new Map(), [a, b], lineage);
        expect(agents.map((x) => x.id)).toEqual(["a", "c"]);
        expect(runs).toEqual([]);
    });
});
