// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { beforeEach, describe, expect, it, vi } from "vitest";

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

import type { AgentsViewModel } from "@/app/view/agents/agents";
import { startWorkflowScan } from "./palette-scan";

const model = { surfaceAtom: {} } as unknown as AgentsViewModel;

beforeEach(() => {
    vi.resetAllMocks();
    openTarget.mockResolvedValue({ ok: true });
});

describe("startWorkflowScan", () => {
    it("starts the scan in the project's channel and the workspace, with room for the agent's tab to start", async () => {
        start.mockResolvedValue({ run: { id: "r-1" } });
        await startWorkflowScan(model, "c-1");
        expect(start).toHaveBeenCalledWith(
            { client: true },
            { channelid: "c-1", workspaceid: "workspace-1" },
            { timeout: 60_000 }
        );
    });

    it("opens the run it started through the router, then returns it", async () => {
        const run = { id: "r-1" };
        start.mockResolvedValue({ run });
        await expect(startWorkflowScan(model, "c-1")).resolves.toBe(run);
        expect(openTarget).toHaveBeenCalledTimes(1);
        expect(openTarget).toHaveBeenCalledWith(model, { kind: "workflowscan", runId: "r-1" });
    });

    it("rethrows a start error and opens nothing, so the palette shows it", async () => {
        start.mockRejectedValue(new Error("a scan is already running"));
        await expect(startWorkflowScan(model, "c-1")).rejects.toThrow("a scan is already running");
        expect(openTarget).not.toHaveBeenCalled();
    });

    it("refuses a reply with no run rather than opening nothing in silence", async () => {
        start.mockResolvedValue({});
        await expect(startWorkflowScan(model, "c-1")).rejects.toThrow("starting the scan returned no run");
        expect(openTarget).not.toHaveBeenCalled();
    });
});
