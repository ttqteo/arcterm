// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { globalStore } from "@/app/store/jotaiStore";
import type { RunConfig } from "@/app/view/jarvis/newrun";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { createChannel } from "./channelsstore";
import { startLauncherRun } from "./launcherrun";
import { noteRecentProject } from "./projectsstore";
import { createRun, resolveChannelLaunchRoute, resolvedProfileAtom } from "./runactions";
import { endRunConfigDraft } from "./runconfigstore";

vi.mock("./channelsstore", () => ({ createChannel: vi.fn() }));
vi.mock("./projectsstore", () => ({ noteRecentProject: vi.fn() }));
vi.mock("./runconfigstore", () => ({ endRunConfigDraft: vi.fn() }));
vi.mock("./runactions", async () => {
    const { atom } = await import("jotai");
    return { createRun: vi.fn(), resolveChannelLaunchRoute: vi.fn(), resolvedProfileAtom: atom({}) };
});

const quick: RunConfig = {
    shape: "quick",
    parallelism: 3,
    workerRoute: null,
    start: "goal",
    planPath: "",
    reviewerPicks: false,
    reviewerRoute: null,
};
const route = { runtime: "claude", model: "opus" } as RoutePin;
const run = { id: "run-1" } as Run;

beforeEach(() => {
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
});
