// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { globalStore } from "@/app/store/jotaiStore";
import { RpcApi } from "@/app/store/wshclientapi";
import type { RunConfig } from "@/app/view/jarvis/newrun";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { createChannel } from "./channelsstore";
import { handBack, queueAddPayload, queueLauncherRun, startLauncherRun } from "./launcherrun";
import { noteRecentProject } from "./projectsstore";
import { buildCreateRunData, createRun, resolveChannelLaunchRoute, resolvedProfileAtom } from "./runactions";
import { endRunConfigDraft } from "./runconfigstore";

vi.mock("@/app/store/wshclientapi", () => ({ RpcApi: { RunQueueAddCommand: vi.fn() } }));
vi.mock("@/app/store/wshrpcutil", () => ({ TabRpcClient: {} }));
vi.mock("./channelsstore", () => ({ createChannel: vi.fn() }));
vi.mock("./projectsstore", () => ({ noteRecentProject: vi.fn() }));
vi.mock("./runconfigstore", () => ({ endRunConfigDraft: vi.fn() }));
vi.mock("./runactions", async () => {
    const { atom } = await import("jotai");
    return {
        buildCreateRunData: vi.fn(),
        createRun: vi.fn(),
        resolveChannelLaunchRoute: vi.fn(),
        resolvedProfileAtom: atom({}),
    };
});

const quick: RunConfig = {
    shape: "quick",
    parallelism: 3,
    workerRoute: null,
    start: "goal",
    planPath: "",
    reviewerPicks: false,
    reviewerRoute: null,
    lightReviewerRoute: null,
    autonomous: false,
};
const route = { runtime: "claude", model: "opus" } as RoutePin;
const run = { id: "run-1" } as Run;

const queueAdd = vi.mocked(RpcApi.RunQueueAddCommand);
const entry = { id: "q-1", state: "waiting" } as RunQueueEntry;
const createData = {
    channelid: "ch-1",
    workspaceid: "ws-1",
    goal: "fix it",
    runtime: "claude",
} as CommandCreateRunData;
const brainstorm: RunQueueBrainstorm = { tab: "tab-1", path: "C:/p/.superpowers/brainstorm/x/brainstorm.json" };

beforeEach(() => {
    queueAdd.mockReset().mockResolvedValue(entry);
    vi.mocked(buildCreateRunData).mockReset().mockReturnValue(createData);
    vi.mocked(createChannel).mockReset();
    vi.mocked(createRun).mockReset().mockResolvedValue(run);
    vi.mocked(resolveChannelLaunchRoute).mockReset().mockResolvedValue(route);
    vi.mocked(noteRecentProject).mockReset();
    vi.mocked(endRunConfigDraft).mockReset();
    globalStore.set(resolvedProfileAtom, {});
});

describe("startLauncherRun", () => {
    it("runs in the project's channel on its route, then notes the project and ends the draft", async () => {
        const profile = { defaultmode: "quick" } as JarvisProfile;
        globalStore.set(resolvedProfileAtom, { "ch-1": profile });
        const out = await startLauncherRun({
            target: { kind: "existing", oid: "ch-1" },
            projectName: "arcterm",
            config: quick,
            goal: "  fix it  ",
            pickedRoute: null,
        });
        expect(resolveChannelLaunchRoute).toHaveBeenCalledWith("ch-1");
        expect(createRun).toHaveBeenCalledWith("ch-1", "fix it", route, { mode: "quick" });
        expect(noteRecentProject).toHaveBeenCalledWith("arcterm");
        expect(endRunConfigDraft).toHaveBeenCalledWith(profile);
        expect(out).toEqual({ channelId: "ch-1", run });
    });

    it("mints the channel for a project that has none", async () => {
        vi.mocked(createChannel).mockResolvedValue("ch-new");
        await startLauncherRun({
            target: { kind: "create", name: "thesis", path: "/w/thesis" },
            projectName: "thesis",
            config: quick,
            goal: "g",
            pickedRoute: null,
        });
        expect(createChannel).toHaveBeenCalledWith("thesis", "/w/thesis");
        expect(createRun).toHaveBeenCalledWith("ch-new", "g", route, { mode: "quick" });
    });

    it("uses a lead route picked by hand as is", async () => {
        const picked = { runtime: "claude", model: "sonnet" } as RoutePin;
        await startLauncherRun({
            target: { kind: "existing", oid: "ch-1" },
            projectName: "arcterm",
            config: quick,
            goal: "g",
            pickedRoute: picked,
        });
        expect(resolveChannelLaunchRoute).not.toHaveBeenCalled();
        expect(createRun).toHaveBeenCalledWith("ch-1", "g", picked, { mode: "quick" });
    });

    it("leaves the project unnoted and the draft alive when the run is not created", async () => {
        vi.mocked(createRun).mockRejectedValue(new Error("Choose a route"));
        await expect(
            startLauncherRun({
                target: { kind: "existing", oid: "ch-1" },
                projectName: "arcterm",
                config: quick,
                goal: "g",
                pickedRoute: null,
            })
        ).rejects.toThrow("Choose a route");
        expect(noteRecentProject).not.toHaveBeenCalled();
        expect(endRunConfigDraft).not.toHaveBeenCalled();
    });

    it("hands the spec path to the run it creates", async () => {
        await startLauncherRun({
            target: { kind: "existing", oid: "ch-1" },
            projectName: "arcterm",
            config: quick,
            goal: "g",
            pickedRoute: null,
            specPath: "C:/p/spec.md",
        });
        expect(createRun).toHaveBeenCalledWith("ch-1", "g", route, { mode: "quick", specPath: "C:/p/spec.md" });
    });

    it("hands the ticked chunks to the run it creates, and none when there are none", async () => {
        const chunks: RunEffortRef[] = [{ effortoid: "eff-1", chunklabel: "Fix the lag" }];
        const base = {
            target: { kind: "existing", oid: "ch-1" } as const,
            projectName: "arcterm",
            config: quick,
            goal: "g",
            pickedRoute: null,
        };
        await startLauncherRun({ ...base, chunks });
        expect(createRun).toHaveBeenLastCalledWith("ch-1", "g", route, { mode: "quick", chunks });
        await startLauncherRun({ ...base, chunks: [] });
        expect(createRun).toHaveBeenLastCalledWith("ch-1", "g", route, { mode: "quick" });
    });
});

describe("queueLauncherRun", () => {
    const input = {
        target: { kind: "existing", oid: "ch-1" } as const,
        projectName: "arcterm",
        config: quick,
        goal: "  fix it  ",
        pickedRoute: null,
        after: [] as string[],
    };

    it("queues the data a start would send, with the spec path, instead of creating a run", async () => {
        const profile = { defaultmode: "quick" } as JarvisProfile;
        globalStore.set(resolvedProfileAtom, { "ch-1": profile });
        const out = await queueLauncherRun({ ...input, specPath: "C:/p/spec.md", after: ["r-1"] });
        expect(resolveChannelLaunchRoute).toHaveBeenCalledWith("ch-1");
        // the same builder, with the same options a start passes to createRun
        expect(buildCreateRunData).toHaveBeenCalledWith("ch-1", "fix it", route, {
            mode: "quick",
            specPath: "C:/p/spec.md",
        });
        expect(queueAdd).toHaveBeenCalledWith(expect.anything(), { data: createData, after: ["r-1"] });
        expect(createRun).not.toHaveBeenCalled();
        expect(noteRecentProject).toHaveBeenCalledWith("arcterm");
        expect(endRunConfigDraft).toHaveBeenCalledWith(profile);
        expect(out).toEqual({ channelId: "ch-1", entry });
    });

    it("builds the queued data with the ticked chunks, as a start does, and none when there are none", async () => {
        const chunks: RunEffortRef[] = [
            { effortoid: "eff-1", chunklabel: "Fix the lag" },
            { effortoid: "eff-2", chunklabel: "Hand-check the sheet" },
        ];
        await queueLauncherRun({ ...input, chunks });
        expect(buildCreateRunData).toHaveBeenLastCalledWith("ch-1", "fix it", route, { mode: "quick", chunks });
        await queueLauncherRun({ ...input, chunks: [] });
        expect(buildCreateRunData).toHaveBeenLastCalledWith("ch-1", "fix it", route, { mode: "quick" });
    });

    it("sends every run ticked in After to the queue, in order: the entry waits for all of them", async () => {
        await queueLauncherRun({ ...input, after: ["r-1", "r-2"] });
        expect(queueAdd).toHaveBeenCalledWith(expect.anything(), { data: createData, after: ["r-1", "r-2"] });
    });

    it("carries the brainstorm that is waiting for the run", async () => {
        await queueLauncherRun({ ...input, brainstorm });
        expect(queueAdd).toHaveBeenCalledWith(expect.anything(), { data: createData, brainstorm });
    });

    it("mints the channel for a project that has none, on the picked route", async () => {
        vi.mocked(createChannel).mockResolvedValue("ch-new");
        const picked = { runtime: "claude", model: "sonnet" } as RoutePin;
        await queueLauncherRun({
            ...input,
            target: { kind: "create", name: "thesis", path: "/w/thesis" },
            pickedRoute: picked,
        });
        expect(createChannel).toHaveBeenCalledWith("thesis", "/w/thesis");
        expect(resolveChannelLaunchRoute).not.toHaveBeenCalled();
        expect(buildCreateRunData).toHaveBeenCalledWith("ch-new", "fix it", picked, { mode: "quick" });
    });

    it("leaves the project unnoted and the draft alive when the queue refuses", async () => {
        queueAdd.mockRejectedValue(new Error("a goal or a planpath is required"));
        await expect(queueLauncherRun(input)).rejects.toThrow("a goal or a planpath is required");
        expect(noteRecentProject).not.toHaveBeenCalled();
        expect(endRunConfigDraft).not.toHaveBeenCalled();
    });
});

describe("queueAddPayload", () => {
    it("sends every run to wait for, in order", () => {
        expect(queueAddPayload(createData, ["r-1", "r-2"], undefined)).toEqual({ data: createData, after: ["r-1", "r-2"] });
    });

    it("sends no after for a queue that waits for no run", () => {
        const payload = queueAddPayload(createData, [], undefined);
        expect(payload).toEqual({ data: createData });
        expect(payload).not.toHaveProperty("after");
        expect(payload).not.toHaveProperty("brainstorm");
    });

    it("carries the brainstorm as it is", () => {
        expect(queueAddPayload(createData, [], brainstorm)).toEqual({ data: createData, brainstorm });
    });
});

describe("handBack", () => {
    it("tells the caller the queue entry its start became", () => {
        const h = { started: vi.fn(), queued: vi.fn() };
        handBack(h, { kind: "queued", entryId: "q-1" });
        expect(h.queued).toHaveBeenCalledWith("q-1");
        expect(h.started).not.toHaveBeenCalled();
    });

    it("does not need a caller that never hears of a queue", () => {
        expect(() => handBack({ started: vi.fn() }, { kind: "queued", entryId: "q-1" })).not.toThrow();
    });

    it("tells the caller that filled the dialog each step of its run's start", () => {
        const h = { handedOff: vi.fn(), started: vi.fn(), stopped: vi.fn() };
        handBack(h, { kind: "handedOff" });
        expect(h.handedOff).toHaveBeenCalledTimes(1);
        handBack(h, { kind: "started", runId: "run-1" });
        expect(h.started).toHaveBeenCalledTimes(1);
        expect(h.started).toHaveBeenCalledWith("run-1");
        handBack(h, { kind: "stopped" });
        expect(h.stopped).toHaveBeenCalledTimes(1);
    });

    it("does nothing for a start no caller follows, or a step the caller does not hear", () => {
        expect(() => handBack(null, { kind: "started", runId: "run-1" })).not.toThrow();
        expect(() => handBack(undefined, { kind: "handedOff" })).not.toThrow();
        expect(() => handBack({ started: vi.fn() }, { kind: "stopped" })).not.toThrow();
    });

    it("swallows a handback that throws: the run exists either way", () => {
        const started = vi.fn(() => {
            throw new Error("agent gone");
        });
        expect(() => handBack({ started }, { kind: "started", runId: "run-1" })).not.toThrow();
        expect(started).toHaveBeenCalledWith("run-1");
    });
});
