// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { atom, type PrimitiveAtom } from "jotai";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const start = vi.hoisted(() => vi.fn());
const openTarget = vi.hoisted(() => vi.fn());

vi.mock("@/app/store/global-atoms", async () => {
    const actual = await vi.importActual<typeof import("@/app/store/global-atoms")>("@/app/store/global-atoms");
    const { atom } = await import("jotai");
    return { ...actual, atoms: { workspaceId: atom("workspace-1") as any } };
});
vi.mock("@/app/store/wshclientapi", () => ({
    RpcApi: { WorkflowScanStartCommand: (...a: unknown[]) => start(...a) },
}));
vi.mock("@/app/store/wshrpcutil", () => ({ TabRpcClient: { client: true } }));
vi.mock("@/app/view/jarvis/openref", () => ({ openTarget: (...a: unknown[]) => openTarget(...a) }));

import { globalStore } from "@/app/store/jotaiStore";
import type { AgentsViewModel } from "@/app/view/agents/agents";
import type { AgentVM } from "@/app/view/agents/agentsviewmodel";
import { rosterHoldsRun, startWorkflowScan } from "./palette-scan";

type TestModel = AgentsViewModel & { agents: PrimitiveAtom<AgentVM[]>; terminals: PrimitiveAtom<AgentVM[]> };

const agentOf = (id: string, runId?: string) => ({ id, runId }) as unknown as AgentVM;

function makeModel(agents: AgentVM[] = [], terminals: AgentVM[] = []): TestModel {
    const agentsAtom = atom(agents);
    const terminalsAtom = atom(terminals);
    return { surfaceAtom: {}, agentsAtom, terminalsAtom, agents: agentsAtom, terminals: terminalsAtom } as any;
}

// a roster that already holds the scan's agent: the start opens it with no wait
const upModel = () => makeModel([agentOf("tab-1", "r-1")]);

beforeEach(() => {
    vi.resetAllMocks();
    openTarget.mockResolvedValue({ ok: true });
});

afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
});

describe("rosterHoldsRun", () => {
    it("holds the run when an entry carries its id", () => {
        expect(rosterHoldsRun([agentOf("a"), agentOf("b", "r-1")], "r-1")).toBe(true);
    });

    it("does not hold it for another run's agent, an agent with no run, or an empty roster", () => {
        expect(rosterHoldsRun([agentOf("a", "r-2"), agentOf("b")], "r-1")).toBe(false);
        expect(rosterHoldsRun([], "r-1")).toBe(false);
    });
});

describe("startWorkflowScan", () => {
    it("starts the scan in the project's channel and the workspace, with room for the agent's tab to start", async () => {
        start.mockResolvedValue({ run: { id: "r-1" } });
        await startWorkflowScan(upModel(), "c-1");
        expect(start).toHaveBeenCalledWith(
            { client: true },
            { channelid: "c-1", workspaceid: "workspace-1" },
            { timeout: 60_000 }
        );
    });

    it("opens the run it started through the router, then returns it", async () => {
        const run = { id: "r-1" };
        const model = upModel();
        start.mockResolvedValue({ run });
        await expect(startWorkflowScan(model, "c-1")).resolves.toBe(run);
        expect(openTarget).toHaveBeenCalledTimes(1);
        expect(openTarget).toHaveBeenCalledWith(model, { kind: "workflowscan", runId: "r-1" });
    });

    it("rethrows a start error and opens nothing, so the palette shows it", async () => {
        start.mockRejectedValue(new Error("a scan is already running"));
        await expect(startWorkflowScan(makeModel(), "c-1")).rejects.toThrow("a scan is already running");
        expect(openTarget).not.toHaveBeenCalled();
    });

    it("refuses a reply with no run rather than opening nothing in silence", async () => {
        start.mockResolvedValue({});
        await expect(startWorkflowScan(makeModel(), "c-1")).rejects.toThrow("starting the scan returned no run");
        expect(openTarget).not.toHaveBeenCalled();
    });

    describe("waiting for the scan's agent", () => {
        beforeEach(() => {
            vi.useFakeTimers();
        });

        it("opens at once, with nothing subscribed, when the agent is already in the roster", async () => {
            const sub = vi.spyOn(globalStore, "sub");
            start.mockResolvedValue({ run: { id: "r-1" } });
            await startWorkflowScan(upModel(), "c-1");
            expect(openTarget).toHaveBeenCalledTimes(1);
            expect(sub).not.toHaveBeenCalled();
            expect(vi.getTimerCount()).toBe(0);
        });

        it("opens at once when the agent is in the terminals roster", async () => {
            start.mockResolvedValue({ run: { id: "r-1" } });
            await startWorkflowScan(makeModel([], [agentOf("tab-1", "r-1")]), "c-1");
            expect(openTarget).toHaveBeenCalledTimes(1);
        });

        it("opens only after the agent appears, landing on it", async () => {
            const model = makeModel();
            const rosterAtOpen: string[][] = [];
            openTarget.mockImplementation(async () => {
                rosterAtOpen.push(globalStore.get(model.agentsAtom).map((a) => a.id));
                return { ok: true };
            });
            start.mockResolvedValue({ run: { id: "r-1" } });
            const started = startWorkflowScan(model, "c-1");
            await vi.advanceTimersByTimeAsync(5_000);
            expect(openTarget).not.toHaveBeenCalled();

            // another run's agent joining does not release the wait
            globalStore.set(model.agents, [agentOf("tab-9", "r-2")]);
            await vi.advanceTimersByTimeAsync(0);
            expect(openTarget).not.toHaveBeenCalled();

            globalStore.set(model.agents, [agentOf("tab-9", "r-2"), agentOf("tab-1", "r-1")]);
            await expect(started).resolves.toEqual({ id: "r-1" });
            expect(openTarget).toHaveBeenCalledTimes(1);
            expect(openTarget).toHaveBeenCalledWith(model, { kind: "workflowscan", runId: "r-1" });
            expect(rosterAtOpen).toEqual([["tab-9", "tab-1"]]);
        });

        it("opens when the agent appears as a terminal", async () => {
            const model = makeModel();
            start.mockResolvedValue({ run: { id: "r-1" } });
            const started = startWorkflowScan(model, "c-1");
            await vi.advanceTimersByTimeAsync(0);
            expect(openTarget).not.toHaveBeenCalled();

            globalStore.set(model.terminals, [agentOf("tab-1", "r-1")]);
            await started;
            expect(openTarget).toHaveBeenCalledTimes(1);
        });

        it("opens after 15 s when no agent appears, so it lands on the run's sheet as before", async () => {
            const model = makeModel();
            start.mockResolvedValue({ run: { id: "r-1" } });
            const started = startWorkflowScan(model, "c-1");
            await vi.advanceTimersByTimeAsync(14_999);
            expect(openTarget).not.toHaveBeenCalled();

            await vi.advanceTimersByTimeAsync(1);
            await expect(started).resolves.toEqual({ id: "r-1" });
            expect(openTarget).toHaveBeenCalledTimes(1);
            expect(openTarget).toHaveBeenCalledWith(model, { kind: "workflowscan", runId: "r-1" });
        });

        it("unsubscribes and clears its timer when the agent appears", async () => {
            const unsubs: ReturnType<typeof vi.fn>[] = [];
            const realSub = globalStore.sub.bind(globalStore);
            vi.spyOn(globalStore, "sub").mockImplementation(((a: any, cb: () => void) => {
                const unsub = vi.fn(realSub(a, cb));
                unsubs.push(unsub);
                return unsub;
            }) as any);
            const model = makeModel();
            start.mockResolvedValue({ run: { id: "r-1" } });
            const started = startWorkflowScan(model, "c-1");
            await vi.advanceTimersByTimeAsync(0);
            expect(unsubs).toHaveLength(2);
            unsubs.forEach((u) => expect(u).not.toHaveBeenCalled());

            globalStore.set(model.agents, [agentOf("tab-1", "r-1")]);
            await started;
            unsubs.forEach((u) => expect(u).toHaveBeenCalled());
            expect(vi.getTimerCount()).toBe(0);
        });

        it("unsubscribes when it times out", async () => {
            const unsubs: ReturnType<typeof vi.fn>[] = [];
            const realSub = globalStore.sub.bind(globalStore);
            vi.spyOn(globalStore, "sub").mockImplementation(((a: any, cb: () => void) => {
                const unsub = vi.fn(realSub(a, cb));
                unsubs.push(unsub);
                return unsub;
            }) as any);
            start.mockResolvedValue({ run: { id: "r-1" } });
            const started = startWorkflowScan(makeModel(), "c-1");
            await vi.advanceTimersByTimeAsync(15_000);
            await started;
            expect(unsubs).toHaveLength(2);
            unsubs.forEach((u) => expect(u).toHaveBeenCalled());
        });

        it("does not wait for the agent when the start fails", async () => {
            start.mockRejectedValue(new Error("a scan is already running"));
            const sub = vi.spyOn(globalStore, "sub");
            await expect(startWorkflowScan(makeModel(), "c-1")).rejects.toThrow("a scan is already running");
            expect(sub).not.toHaveBeenCalled();
            expect(vi.getTimerCount()).toBe(0);
        });
    });
});
