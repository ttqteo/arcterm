// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { atom } from "jotai";
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

import { startWorkflowScan } from "@/app/cockpit/palette-scan";
import { globalStore } from "@/app/store/jotaiStore";
import type { AgentsViewModel } from "./agents";
import { usageLensAtom } from "./usagestore";
import {
    createWorkflowScan,
    followWorkflowScan,
    startWorkflowScanFromLens,
    workflowScanRunAtom,
} from "./workflowscanstart";

// a roster that already holds the scan's agent, so the palette's start opens with no wait
function model(): AgentsViewModel {
    return {
        agentsAtom: atom([{ id: "tab-1", runId: "r-1" }]),
        terminalsAtom: atom([]),
    } as unknown as AgentsViewModel;
}

beforeEach(() => {
    vi.resetAllMocks();
    openTarget.mockResolvedValue({ ok: true });
    globalStore.set(workflowScanRunAtom, null);
    globalStore.set(usageLensAtom, "provider");
});

describe("createWorkflowScan", () => {
    it("starts the scan in the project's channel and the workspace, then follows its run", async () => {
        start.mockResolvedValue({ run: { id: "r-1" } });
        await expect(createWorkflowScan("c-1")).resolves.toEqual({ id: "r-1" });
        expect(start).toHaveBeenCalledWith(
            { client: true },
            { channelid: "c-1", workspaceid: "workspace-1" },
            { timeout: 60_000 }
        );
        expect(globalStore.get(workflowScanRunAtom)).toBe("r-1");
    });

    it("rethrows a start error and keeps the run it already followed", async () => {
        followWorkflowScan("r-0");
        start.mockRejectedValue(new Error("a workflow scan is already picking"));
        await expect(createWorkflowScan("c-1")).rejects.toThrow("a workflow scan is already picking");
        expect(globalStore.get(workflowScanRunAtom)).toBe("r-0");
    });

    it("refuses a reply with no run and follows nothing", async () => {
        start.mockResolvedValue({});
        await expect(createWorkflowScan("c-1")).rejects.toThrow("starting the scan returned no run");
        expect(globalStore.get(workflowScanRunAtom)).toBeNull();
    });
});

describe("startWorkflowScanFromLens", () => {
    it("follows the run, puts the surface on the Workflow lens and opens nothing", async () => {
        start.mockResolvedValue({ run: { id: "r-1" } });
        await startWorkflowScanFromLens("c-1");
        expect(globalStore.get(workflowScanRunAtom)).toBe("r-1");
        expect(globalStore.get(usageLensAtom)).toBe("workflow");
        expect(openTarget).not.toHaveBeenCalled();
    });

    it("leaves the lens as it was when the start fails", async () => {
        start.mockRejectedValue(new Error("boom"));
        await expect(startWorkflowScanFromLens("c-1")).rejects.toThrow("boom");
        expect(globalStore.get(usageLensAtom)).toBe("provider");
    });
});

describe("the palette's start", () => {
    it("makes the lens follow the scan it started, without switching the Usage lens", async () => {
        start.mockResolvedValue({ run: { id: "r-1" } });
        await startWorkflowScan(model(), "c-1");
        expect(globalStore.get(workflowScanRunAtom)).toBe("r-1");
        expect(globalStore.get(usageLensAtom)).toBe("provider");
        // and still opens the scan through the router, which lands on its agent
        expect(openTarget).toHaveBeenCalledWith(expect.anything(), { kind: "workflowscan", runId: "r-1" });
    });
});
