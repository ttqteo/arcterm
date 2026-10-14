// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { beforeEach, describe, expect, it, vi } from "vitest";

const getDossier = vi.fn();
const resolveScope = vi.fn();
const resolveAmbient = vi.fn();
const appendDecisionRpc = vi.fn();
const detachCmd = vi.fn();
const listDetached = vi.fn();
vi.mock("@/app/store/wshclientapi", () => ({
    RpcApi: {
        GetDossierCommand: (...a: unknown[]) => getDossier(...a),
        ResolveFocusScopeCommand: (...a: unknown[]) => resolveScope(...a),
        ResolveAmbientCommand: (...a: unknown[]) => resolveAmbient(...a),
        AppendDossierDecisionCommand: (...a: unknown[]) => appendDecisionRpc(...a),
        DetachDossierEdgeCommand: (...a: unknown[]) => detachCmd(...a),
        ListDetachedEdgesCommand: (...a: unknown[]) => listDetached(...a),
    },
}));
vi.mock("@/app/store/wshrpcutil", () => ({ TabRpcClient: {} }));
vi.mock("@/app/store/wos", () => ({ loadAndPinWaveObject: vi.fn().mockResolvedValue(null) }));

import { globalStore } from "@/app/store/jotaiStore";
import { recordDetailAtom, recordRunsAtom, recordScopeAtom } from "./jarvissubjectstore";
import { afterRecordWrite, appendDecision, detachedEdgesAtom, detachEdge } from "./recordactions";
import { tasksErrorAtom } from "./tasksstore";

describe("afterRecordWrite", () => {
    beforeEach(() => {
        getDossier.mockResolvedValue({ id: "task-a", status: "completed", decisions: [] });
        resolveScope.mockResolvedValue({ runorefs: [], channeloids: [], tabids: [] });
        resolveAmbient.mockResolvedValue({ tasks: [], edges: [], decisions: [] });
        globalStore.set(recordDetailAtom, { "task-a": { status: "active" } as unknown as DossierDetail });
        globalStore.set(recordScopeAtom, { "task-a": { runorefs: ["run:old"] } as unknown as SpaceScope });
        globalStore.set(recordRunsAtom, { "task-a": [{ id: "old" }] as unknown as Run[] });
    });

    it("replaces the record's detail with a fresh read", async () => {
        await afterRecordWrite("task-a");
        expect(globalStore.get(recordDetailAtom)["task-a"].status).toBe("completed");
    });

    it("re-resolves the record's scope and runs", async () => {
        await afterRecordWrite("task-a");
        expect(globalStore.get(recordScopeAtom)["task-a"].runorefs).toEqual([]);
        expect(globalStore.get(recordRunsAtom)["task-a"]).toEqual([]);
    });

    it("re-reads the whole-vault ambient map", async () => {
        await afterRecordWrite("task-a");
        expect(resolveAmbient).toHaveBeenCalled();
    });
});

describe("appendDecision", () => {
    beforeEach(() => {
        appendDecisionRpc.mockReset();
        getDossier.mockReset().mockResolvedValue({ id: "task-a", status: "active", decisions: [] });
        resolveScope.mockReset().mockResolvedValue({ runorefs: [], channeloids: [], tabids: [] });
        resolveAmbient.mockReset().mockResolvedValue({ tasks: [], edges: [], decisions: [] });
        globalStore.set(tasksErrorAtom, null);
    });

    it("reports a failed decision write and keeps the record cache intact", async () => {
        const cached = { id: "task-a", status: "active", decisions: [] } as unknown as DossierDetail;
        globalStore.set(recordDetailAtom, { "task-a": cached });
        appendDecisionRpc.mockRejectedValue(new Error("disk full"));

        await expect(appendDecision("task-a", "summary", "why", [])).resolves.toBe(false);

        expect(globalStore.get(tasksErrorAtom)).toContain("disk full");
        expect(globalStore.get(recordDetailAtom)["task-a"]).toBe(cached);
    });

    it("reports success only after refreshing the record", async () => {
        appendDecisionRpc.mockResolvedValue({ decisionid: "d1" });
        getDossier.mockResolvedValue({ id: "task-a", status: "completed", decisions: [] });

        await expect(appendDecision("task-a", "summary", "why", [])).resolves.toBe(true);

        expect(globalStore.get(recordDetailAtom)["task-a"].status).toBe("completed");
    });
});

describe("detachEdge", () => {
    beforeEach(() => {
        detachCmd.mockReset().mockResolvedValue(undefined);
        listDetached.mockReset().mockResolvedValue({
            tasks: [{ id: "task-a", label: "Alpha" }],
            edges: [{ oref: "run:r1", dossierid: "task-a", provenance: "", bucket: "", state: "detached" }],
        });
        globalStore.set(detachedEdgesAtom, {});
    });

    it("sends both ids to the backend", async () => {
        detachEdge("task-a", "run:r1");
        await vi.waitFor(() => expect(detachCmd).toHaveBeenCalled());
        expect(detachCmd.mock.calls[0][1]).toEqual({ dossierid: "task-a", runoref: "run:r1" });
    });

    it("refreshes the detached list for the record and for the run", async () => {
        detachEdge("task-a", "run:r1");
        await vi.waitFor(() => expect(globalStore.get(detachedEdgesAtom)["run:r1"]).toBeDefined());
        const row = globalStore.get(detachedEdgesAtom)["task:task-a"][0];
        expect(row.label).toBe("Alpha");
        // both ids survive the projection: the record view needs the run, the band view needs the record
        expect(row.runORef).toBe("run:r1");
        expect(row.dossierId).toBe("task-a");
    });

    it("carries an empty bucket through rather than inventing a strength", async () => {
        detachEdge("task-a", "run:r1");
        await vi.waitFor(() => expect(globalStore.get(detachedEdgesAtom)["task:task-a"]).toBeDefined());
        expect(globalStore.get(detachedEdgesAtom)["task:task-a"][0].bucket).toBe("");
    });
});
