// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { describe, expect, it } from "vitest";
import type { RunConfig } from "./newrun";
import {
    initialPick,
    launchGoal,
    launchOptsFromConfig,
    prefillToLaunch,
    radarDraftLanding,
    rankProjects,
    resolveChannelTarget,
} from "./newrun";

const ch = (oid: string, projectpath: string): Channel => ({ oid, projectpath }) as Channel;

describe("resolveChannelTarget", () => {
    it("reuses the channel already bound to the project's path", () => {
        const channels = [ch("c1", "/repo/a"), ch("c2", "/repo/b")];
        expect(resolveChannelTarget(channels, "b", "/repo/b")).toEqual({ kind: "existing", oid: "c2" });
    });

    it("matches across separator styles, so a Windows path does not mint a duplicate", () => {
        const channels = [ch("c1", "C:\\Users\\k\\waveterm")];
        expect(resolveChannelTarget(channels, "waveterm", "C:/Users/k/waveterm")).toEqual({
            kind: "existing",
            oid: "c1",
        });
    });

    it("creates one named after the project when the project has none", () => {
        expect(resolveChannelTarget([ch("c1", "/repo/a")], "b", "/repo/b")).toEqual({
            kind: "create",
            name: "b",
            path: "/repo/b",
        });
    });

    it("creates one when there are no channels at all", () => {
        expect(resolveChannelTarget([], "b", "/repo/b")).toEqual({ kind: "create", name: "b", path: "/repo/b" });
    });

    it("refuses to decide while the channel list is still unread", () => {
        expect(resolveChannelTarget(null, "b", "/repo/b")).toBeNull();
    });
});

describe("radarDraftLanding", () => {
    const draft = { projectName: "b", projectPath: "C:/repo/b" };

    it("lands on the project's existing channel", () => {
        expect(radarDraftLanding([ch("c1", "C:\\repo\\b")], draft)).toEqual({ kind: "existing", oid: "c1" });
    });

    it("mints the channel for a project that has none, instead of dropping the draft", () => {
        expect(radarDraftLanding([ch("c1", "/repo/a")], draft)).toEqual({
            kind: "create",
            name: "b",
            path: "C:/repo/b",
        });
    });

    it("waits for the channel list rather than spending its one attempt on an unread list", () => {
        expect(radarDraftLanding(null, draft)).toBe("wait");
    });

    it("has nowhere to land a draft that names no project", () => {
        expect(radarDraftLanding([], { projectName: "b" })).toBe("none");
        expect(radarDraftLanding([], { projectPath: "C:/repo/b" })).toBe("none");
    });
});

describe("launchOptsFromConfig", () => {
    const base: RunConfig = {
        shape: "quick",
        parallelism: 3,
        workerRoute: null,
        start: "goal",
        planPath: "",
        reviewerPicks: false,
        reviewerRoute: null,
    };
    const workerRoute: RoutePin = { runtime: "claude" };

    it("names the mode rather than leaving the server to default it to quick", () => {
        expect(launchOptsFromConfig(base)).toEqual({ mode: "quick" });
    });

    it("drops every orchestrator dial from quick", () => {
        expect(
            launchOptsFromConfig({ ...base, parallelism: 6, workerRoute, start: "plan", planPath: "/p.md" })
        ).toEqual({
            mode: "quick",
        });
    });

    // spec §1: + Run has two shapes, and its orchestrator is the engine
    it("always launches an orchestrator on the engine, with its width and worker route", () => {
        expect(launchOptsFromConfig({ ...base, shape: "orchestrator", parallelism: 4, workerRoute })).toEqual({
            mode: "orchestrator",
            reviewerPicks: false,
            parallelism: 4,
            workerRoute,
        });
    });

    it("omits a worker route the launcher left inheriting the lead", () => {
        expect(launchOptsFromConfig({ ...base, shape: "orchestrator", parallelism: 2 })).toEqual({
            mode: "orchestrator",
            reviewerPicks: false,
            parallelism: 2,
        });
    });

    it("sends the trimmed plan path for a plan start", () => {
        expect(
            launchOptsFromConfig({ ...base, shape: "orchestrator", start: "plan", planPath: "  /repo/plan.md " })
        ).toEqual({
            mode: "orchestrator",
            reviewerPicks: false,
            parallelism: 3,
            planPath: "/repo/plan.md",
        });
    });

    it("sends no plan path for a goal start, even with one typed", () => {
        expect(launchOptsFromConfig({ ...base, shape: "orchestrator", planPath: "/repo/plan.md" })).not.toHaveProperty(
            "planPath"
        );
    });

    it("carries a canvas prototype on an orchestrator run", () => {
        const prototype = "C:/p/x/project/Main.dc.html";
        expect(launchOptsFromConfig({ ...base, shape: "orchestrator", prototype })).toEqual({
            mode: "orchestrator",
            reviewerPicks: false,
            parallelism: 3,
            prototype,
        });
    });

    // the server rejects a prototype on a quick run
    it("drops the prototype from quick", () => {
        expect(launchOptsFromConfig({ ...base, prototype: "C:/p/x/project/Main.dc.html" })).toEqual({ mode: "quick" });
    });

    it("sends no prototype when none is set", () => {
        expect(launchOptsFromConfig({ ...base, shape: "orchestrator", prototype: "" })).not.toHaveProperty("prototype");
    });
});

describe("launchGoal", () => {
    it("sends the trimmed goal", () => {
        expect(launchGoal({ shape: "quick", start: "plan" }, "  fix the flake ")).toBe("fix the flake");
        expect(launchGoal({ shape: "orchestrator", start: "goal" }, " ship it ")).toBe("ship it");
    });

    // the goal field is hidden for a plan start, so a goal typed before switching must not name the run
    it("sends none for a plan start, which the run's plan names", () => {
        expect(launchGoal({ shape: "orchestrator", start: "plan" }, "an old goal")).toBe("");
    });
});

describe("rankProjects", () => {
    const names = ["git-compare-parity", "waveterm", "wave-docs", "waveterm-b6"];

    it("keeps the registry's own order when nothing is typed", () => {
        expect(rankProjects(names, "")).toEqual(names);
        expect(rankProjects(names, "   ")).toEqual(names);
    });

    it("drops projects the query cannot match", () => {
        expect(rankProjects(names, "wave")).not.toContain("git-compare-parity");
    });

    it("ranks the tightest match first", () => {
        expect(rankProjects(names, "waveterm")[0]).toBe("waveterm");
    });

    it("matches on subsequences, not just prefixes", () => {
        expect(rankProjects(names, "wdocs")).toContain("wave-docs");
    });

    it("returns nothing when the query matches no project", () => {
        expect(rankProjects(names, "zzzz")).toEqual([]);
    });

    it("has nothing to rank in an empty registry", () => {
        expect(rankProjects([], "wave")).toEqual([]);
    });
});

describe("initialPick", () => {
    const names = ["arc", "waveterm", "scratch"];

    it("reopens on the project you last started work in", () => {
        expect(initialPick(names, "waveterm")).toBe("waveterm");
    });

    it("falls back when the remembered project is no longer registered", () => {
        expect(initialPick(names, "unregistered")).toBeNull();
        expect(initialPick(["only"], "unregistered")).toBe("only");
    });

    it("preselects the only project there is, remembered or not", () => {
        expect(initialPick(["only"], null)).toBe("only");
    });

    it("picks nothing when there is a choice and nothing is remembered", () => {
        expect(initialPick(names, null)).toBeNull();
        expect(initialPick([], null)).toBeNull();
    });
});

describe("prefillToLaunch", () => {
    const prefill = {
        projectName: "waveterm",
        goal: "Build the design in C:/p/.superpowers/design/t/project (boards: Main)",
        shape: "orchestrator" as const,
        prototype: "C:/p/.superpowers/design/t/project/Main.dc.html",
    };

    it("opens an orchestrator goal start on the canvas's project, goal and prototype", () => {
        expect(prefillToLaunch(prefill, ["waveterm", "other"])).toEqual({
            picked: "waveterm",
            shape: "orchestrator",
            start: "goal",
            goal: prefill.goal,
            prototype: prefill.prototype,
        });
    });

    it("picks no project when the canvas's project is not registered", () => {
        expect(prefillToLaunch(prefill, ["other"])).toEqual({
            picked: null,
            shape: "orchestrator",
            start: "goal",
            goal: prefill.goal,
            prototype: prefill.prototype,
        });
    });

    it("picks no project when the agent has none", () => {
        expect(prefillToLaunch({ ...prefill, projectName: "" }, ["waveterm", ""]).picked).toBeNull();
    });

    it("takes the shape from the prefill", () => {
        expect(prefillToLaunch({ projectName: "p", goal: "g", shape: "quick" }, ["p"])).toMatchObject({
            shape: "quick",
            prototype: "",
            picked: "p",
        });
    });

    it("a prototype keeps the run an orchestrator run", () => {
        expect(
            prefillToLaunch({ projectName: "p", goal: "g", shape: "quick", prototype: "/x.html" }, ["p"]).shape
        ).toBe("orchestrator");
    });

    it("an unregistered project is not picked", () => {
        expect(prefillToLaunch({ projectName: "gone", goal: "g", shape: "orchestrator" }, ["p"]).picked).toBeNull();
    });
});
