import { describe, expect, it } from "vitest";
import { buildViewData, dagActionError, dagActionRoute, mergeReadyIds, routeSourceLabel } from "./dagstore";

const group = {
    id: "dag-1",
    runid: "run-1",
    parallelism: 2,
    tasks: [
        { id: "t-0", label: "setup", state: "done" },
        { id: "t-1", label: "api", deps: ["t-0"], state: "running", runid: "r-1" },
        { id: "t-2", label: "ship", deps: ["t-1"], gate: true, state: "done" },
        { id: "t-3", label: "perf", deps: ["t-2"], state: "failed" },
    ],
} as any;

const owner = { runtime: "claude", model: "sonnet" } as Run;
const harnesses = [
    { runtime: "claude", routecapabilities: [{ runtime: "claude", model: "sonnet", resolvedmodel: "claude-sonnet-4-6" }, { runtime: "claude", resolvedmodel: "operator default" }] },
    { runtime: "pi", routecapabilities: [{ runtime: "pi", resolvedmodel: "operator default" }] },
] as HarnessInfo[];
const none = new Set<string>();

describe("buildViewData", () => {
    it("maps tasks to nodes and deps to edges", () => {
        const { nodes, edges } = buildViewData(group, owner, harnesses, new Set(["t-0"]));
        expect(nodes).toHaveLength(4);
        expect(edges).toEqual([
            { source: "t-0", target: "t-1" },
            { source: "t-1", target: "t-2" },
            { source: "t-2", target: "t-3" },
        ]);
        // the digest says t-0 can merge -> merge action
        expect(nodes[0].actions).toEqual(["merge"]);
    });
    it("drops the merge action once a task is merged", () => {
        const mergedGroup = {
            ...group,
            tasks: [{ id: "t-0", label: "setup", state: "done", merged: true }],
        } as any;
        const { nodes } = buildViewData(mergedGroup, owner, harnesses, none);
        expect(nodes[0].actions).toEqual([]);
    });

    it("offers merge only where the digest says a lane is ready", () => {
        const lane = {
            ...group,
            tasks: [
                { id: "t-0", label: "schema", state: "done", runid: "r-0" },
                { id: "t-1", label: "api", deps: ["t-0"], state: "done", runid: "r-1" },
            ],
        } as any;
        const { nodes } = buildViewData(lane, owner, harnesses, new Set(["t-1"]));
        expect(nodes[0].actions).toEqual([]);
        expect(nodes[1].actions).toEqual(["merge"]);
    });

    it("flags gate and failure states", () => {
        const { nodes } = buildViewData(group, owner, harnesses, none);
        const ship = nodes.find((n) => n.id === "t-2")!;
        expect(ship.gate).toBe(true);
        expect(ship.actions).toEqual(["approve", "sendback"]);
        const perf = nodes.find((n) => n.id === "t-3")!;
        expect(perf.actions).toEqual(["retry", "skip", "escalate"]);
    });

    it("offers resolve on a failed Verify, which re-runs it through merge --continue", () => {
        const failed = {
            ...group,
            tasks: [{ id: "t-0", label: "setup", state: "verify-failed", merged: true }],
        } as any;
        expect(buildViewData(failed, owner, harnesses, none).nodes[0].actions).toEqual(["resolve"]);
    });

    it("projects pinned, inherited, runtime-default, and unavailable routes", () => {
        const routed = {
            ...group,
            tasks: [
                { id: "pinned", label: "Pinned", state: "running", runspec: { runtime: "claude", model: "sonnet" } },
                { id: "inherited", label: "Inherited", state: "running" },
                { id: "runtimeonly", label: "RuntimeOnly", state: "running", runspec: { runtime: "pi" } },
                { id: "missing", label: "Missing", state: "running", runspec: { runtime: "missing" } },
                { id: "modelonly", label: "ModelOnly", state: "running", runspec: { model: "sonnet" } },
            ],
        } as any;
        const { nodes } = buildViewData(routed, owner, harnesses, none);
        expect(nodes.find((n) => n.id === "pinned")!.route).toEqual({ source: "pinned", runtime: "claude", model: "sonnet", resolvedModel: "claude-sonnet-4-6" });
        expect(nodes.find((n) => n.id === "inherited")!.route).toEqual({ source: "inherited", runtime: "claude", model: "sonnet", resolvedModel: "claude-sonnet-4-6" });
        // a runtime-only pin is that runtime's default, never the owner's model
        expect(nodes.find((n) => n.id === "runtimeonly")!.route).toEqual({ source: "pinned", runtime: "pi", model: "", resolvedModel: "operator default" });
        expect(nodes.find((n) => n.id === "missing")!.route).toEqual({ source: "pinned", runtime: "missing", model: "", resolvedModel: "unavailable" });
        // a model-only pin inherits the owner's runtime
        expect(nodes.find((n) => n.id === "modelonly")!.route).toEqual({ source: "pinned", runtime: "claude", model: "sonnet", resolvedModel: "claude-sonnet-4-6" });
    });
});

describe("review", () => {
    it("splits the review's state from its route, same as lead", () => {
        const reviewed = { ...group, tasks: [{ id: "t-0", label: "x", state: "done", reviewverdict: "pass" }] } as any;
        expect(buildViewData(reviewed, owner, harnesses, none).nodes[0].review).toEqual({
            state: "passed first time",
            route: "same as lead · claude-sonnet-4-6",
        });
    });
    it("names a custom reviewer route and its model", () => {
        const custom = {
            ...group,
            reviewerroute: { runtime: "pi" },
            tasks: [{ id: "t-0", label: "x", state: "pending" }],
        } as any;
        expect(buildViewData(custom, owner, harnesses, none).nodes[0].review).toEqual({
            state: "not started",
            route: "reviewer route · operator default",
        });
    });
});

describe("worker routes", () => {
    const withWorkerRoute = { ...group, workerroute: { runtime: "claude", model: "haiku" } } as any;
    it("gives an unpinned task the dag's worker route, as the engine does", () => {
        const { nodes } = buildViewData(withWorkerRoute, owner, harnesses, new Set());
        expect(nodes[1].route).toMatchObject({ source: "workers", runtime: "claude", model: "haiku" });
    });
    it("keeps a task's own pin ahead of the worker route", () => {
        const pinned = { ...withWorkerRoute, tasks: [{ id: "t-0", label: "x", state: "pending", runspec: { runtime: "pi" } }] } as any;
        expect(buildViewData(pinned, owner, harnesses, new Set()).nodes[0].route.source).toBe("pinned");
    });
    it("falls back to the owner's route only when the dag has no worker route", () => {
        const { nodes } = buildViewData(group, owner, harnesses, new Set());
        expect(nodes[1].route).toMatchObject({ source: "inherited", model: "sonnet" });
    });
    it("names each source", () => {
        expect(routeSourceLabel("pinned")).toBe("pinned");
        expect(routeSourceLabel("workers")).toBe("workers route");
        expect(routeSourceLabel("inherited")).toBe("same as lead");
    });
});

describe("node actions", () => {
    it("opens the route picker for escalate: the server needs a model", () => {
        expect(dagActionRoute("escalate")).toBe("pick-route");
        expect(dagActionRoute("merge")).toBe("merge");
        expect(dagActionRoute("resolve")).toBe("continue");
        expect(dagActionRoute("retry")).toBe("action");
    });
    it("words a refused action with its task and the server's reason", () => {
        expect(dagActionError("retry", "t-3", new Error("task t-3 is running"))).toBe("retry t-3 failed: task t-3 is running");
    });
});

describe("mergeReadyIds", () => {
    const digest = {
        tasks: [
            { taskid: "t-0", waitreason: "terminal", mergestate: "waiting", cleanupstate: "clear" },
            { taskid: "t-1", waitreason: "terminal", mergestate: "ready", cleanupstate: "clear" },
        ],
    } as DagStatusDigest;

    it("reads the rows the digest marks ready", () => {
        expect([...mergeReadyIds(digest, false)]).toEqual(["t-1"]);
    });

    it("offers nothing from a stale or missing digest", () => {
        expect(mergeReadyIds(digest, true).size).toBe(0);
        expect(mergeReadyIds(undefined, false).size).toBe(0);
    });
});

describe("buildViewData for a failed review", () => {
    it("offers the lead's review actions", () => {
        const reviewGroup = {
            id: "dag-2",
            runid: "run-1",
            parallelism: 1,
            tasks: [{ id: "t-0", label: "x", state: "review-failed" }],
        } as any;
        const { nodes } = buildViewData(reviewGroup, owner, harnesses, none);
        expect(nodes[0].actions).toEqual(["approve", "sendback", "retry", "skip", "escalate"]);
    });
});
