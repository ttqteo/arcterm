import { describe, expect, it } from "vitest";
import {
    cardModelTag,
    isWaiting,
    LIGHT_PICK,
    reviewerRouteOf,
    reviewersChip,
    reviewStateText,
    routeSourceLabel,
    stageEntries,
    taskRoute,
    workersChip,
    workersRoute,
    type RouteSource,
} from "./taskroute";

const lead = { runtime: "claude", model: "claude-opus-5-5" } as Run;
const pin = { runtime: "claude", model: "sonnet" };
const workerRoute = { runtime: "pi", model: "haiku" };

const zeroGroup = { tasks: [] } as unknown as TaskGroup;
const workersGroup = { tasks: [], workerroute: workerRoute } as unknown as TaskGroup;
const picksGroup = { tasks: [], reviewerpicks: true } as unknown as TaskGroup;

function task(over: Partial<TaskNode> = {}): TaskNode {
    return { id: "t-1", state: "pending", ...over } as TaskNode;
}

// mirrors Go's TestEffectiveTaskRoutePrecedence: source x pin x group
describe("taskRoute precedence", () => {
    const leadRoute = { runtime: "claude", model: "claude-opus-5-5" };
    const cases: {
        name: string;
        source: string;
        pinned: boolean;
        group: TaskGroup;
        want: { route: RoutePin; source: RouteSource };
    }[] = [
        // zero-value rows: a stored dag with none of the new fields resolves as it did before
        {
            name: "zero, no pin",
            source: "",
            pinned: false,
            group: zeroGroup,
            want: { route: leadRoute, source: "inherited" },
        },
        { name: "zero, pin", source: "", pinned: true, group: zeroGroup, want: { route: pin, source: "pinned" } },
        {
            name: "zero, workers",
            source: "",
            pinned: false,
            group: workersGroup,
            want: { route: workerRoute, source: "workers" },
        },
        {
            name: "typed pin beats workers",
            source: "",
            pinned: true,
            group: workersGroup,
            want: { route: pin, source: "pinned" },
        },
        {
            name: "typed pin on picks",
            source: "",
            pinned: true,
            group: picksGroup,
            want: { route: pin, source: "pinned" },
        },
        {
            name: "empty, no pin, picks",
            source: "",
            pinned: false,
            group: picksGroup,
            want: { route: leadRoute, source: "inherited" },
        },
        // plan and reviewer picks apply only on Reviewer picks
        {
            name: "plan, pin, zero",
            source: "plan",
            pinned: true,
            group: zeroGroup,
            want: { route: leadRoute, source: "inherited" },
        },
        {
            name: "plan, pin, workers",
            source: "plan",
            pinned: true,
            group: workersGroup,
            want: { route: workerRoute, source: "workers" },
        },
        {
            name: "plan, pin, picks",
            source: "plan",
            pinned: true,
            group: picksGroup,
            want: { route: pin, source: "plan" },
        },
        {
            name: "plan, no pin, picks",
            source: "plan",
            pinned: false,
            group: picksGroup,
            want: { route: leadRoute, source: "inherited" },
        },
        {
            name: "reviewer, pin, zero",
            source: "reviewer",
            pinned: true,
            group: zeroGroup,
            want: { route: leadRoute, source: "inherited" },
        },
        {
            name: "reviewer, pin, workers",
            source: "reviewer",
            pinned: true,
            group: workersGroup,
            want: { route: workerRoute, source: "workers" },
        },
        {
            name: "reviewer, pin, picks",
            source: "reviewer",
            pinned: true,
            group: picksGroup,
            want: { route: pin, source: "reviewer" },
        },
        {
            name: "reviewer, no pin, picks",
            source: "reviewer",
            pinned: false,
            group: picksGroup,
            want: { route: leadRoute, source: "inherited" },
        },
        // a human's choice and an escalation always win
        {
            name: "owner, pin, zero",
            source: "owner",
            pinned: true,
            group: zeroGroup,
            want: { route: pin, source: "owner" },
        },
        {
            name: "owner, pin, workers",
            source: "owner",
            pinned: true,
            group: workersGroup,
            want: { route: pin, source: "owner" },
        },
        {
            name: "owner, pin, picks",
            source: "owner",
            pinned: true,
            group: picksGroup,
            want: { route: pin, source: "owner" },
        },
        // an owner source with no pin is the owner putting the task on the lead: workers route, then the lead
        {
            name: "owner, no pin, zero",
            source: "owner",
            pinned: false,
            group: zeroGroup,
            want: { route: leadRoute, source: "inherited" },
        },
        {
            name: "owner, no pin, workers",
            source: "owner",
            pinned: false,
            group: workersGroup,
            want: { route: workerRoute, source: "workers" },
        },
        {
            name: "escalation, pin, zero",
            source: "escalation",
            pinned: true,
            group: zeroGroup,
            want: { route: pin, source: "escalation" },
        },
        {
            name: "escalation, pin, workers",
            source: "escalation",
            pinned: true,
            group: workersGroup,
            want: { route: pin, source: "escalation" },
        },
        {
            name: "escalation, pin, picks",
            source: "escalation",
            pinned: true,
            group: picksGroup,
            want: { route: pin, source: "escalation" },
        },
        {
            name: "escalation, no pin, zero",
            source: "escalation",
            pinned: false,
            group: zeroGroup,
            want: { route: leadRoute, source: "inherited" },
        },
    ];
    for (const c of cases) {
        it(c.name, () => {
            const t = task({ modelsource: c.source || undefined, runspec: c.pinned ? { ...pin } : undefined });
            expect(taskRoute(t, lead, c.group)).toEqual(c.want);
        });
    }

    it("gives a model-only pin the lead's runtime", () => {
        const t = task({ modelsource: "owner", runspec: { model: "sonnet" } });
        expect(taskRoute(t, { runtime: "pi", model: "x" } as Run, zeroGroup).route).toEqual({
            runtime: "pi",
            model: "sonnet",
        });
    });

    it("defaults an empty runtime to claude, as runroute.DefaultRuntime does", () => {
        expect(taskRoute(task(), {} as Run, zeroGroup)).toEqual({ route: { runtime: "claude" }, source: "inherited" });
        const modelOnlyWorkers = { tasks: [], workerroute: { model: "haiku" } } as unknown as TaskGroup;
        expect(taskRoute(task(), lead, modelOnlyWorkers).route).toEqual({ runtime: "claude", model: "haiku" });
    });

    it("ignores an empty worker route", () => {
        const empty = { tasks: [], workerroute: { runtime: "" } } as unknown as TaskGroup;
        expect(taskRoute(task(), lead, empty).source).toBe("inherited");
    });
});

describe("routeSourceLabel", () => {
    it("names every source", () => {
        expect(routeSourceLabel("plan")).toBe("plan's pick");
        expect(routeSourceLabel("reviewer")).toBe("reviewer's pick");
        expect(routeSourceLabel("owner")).toBe("your pick");
        expect(routeSourceLabel("escalation")).toBe("escalated");
        expect(routeSourceLabel("pinned")).toBe("pinned");
        expect(routeSourceLabel("workers")).toBe("workers route");
        expect(routeSourceLabel("inherited")).toBe("same as lead");
    });
});

describe("workersRoute", () => {
    it("is the group's worker route, else the lead's", () => {
        expect(workersRoute(workersGroup, lead)).toEqual(workerRoute);
        expect(workersRoute(zeroGroup, lead)).toEqual({ runtime: "claude", model: "claude-opus-5-5" });
    });
});

describe("cardModelTag", () => {
    it("is null when the task runs the workers model", () => {
        const t = task({ modelsource: "reviewer", runspec: { runtime: "claude", model: "claude-opus-5-5" } });
        expect(cardModelTag(t, lead, picksGroup)).toBeNull();
    });
    it("names a reviewer's sonnet pick on an opus lead", () => {
        const t = task({ modelsource: "reviewer", runspec: { ...LIGHT_PICK } });
        expect(cardModelTag(t, lead, picksGroup)).toBe("sonnet · review");
    });
    it("names each pin source", () => {
        const on = (modelsource: string | undefined) => task({ modelsource, runspec: { ...pin } });
        expect(cardModelTag(on("plan"), lead, picksGroup)).toBe("sonnet · plan");
        expect(cardModelTag(on("owner"), lead, zeroGroup)).toBe("sonnet · you");
        expect(cardModelTag(on("escalation"), lead, zeroGroup)).toBe("sonnet · escalated");
        expect(cardModelTag(on(undefined), lead, zeroGroup)).toBe("sonnet · pinned");
    });
    it("shortens a claude id", () => {
        const t = task({ modelsource: "owner", runspec: { model: "claude-sonnet-5-5" } });
        expect(cardModelTag(t, lead, zeroGroup)).toBe("sonnet-5-5 · you");
    });
    it("names a harness's default model by the harness when the lead runs another", () => {
        const claudeDefault = { runtime: "claude" } as Run;
        const t = task({ modelsource: "plan", runspec: { runtime: "codex" } });
        expect(cardModelTag(t, claudeDefault, picksGroup)).toBe("codex · plan");
    });
    it("names a harness's pinned model by the model", () => {
        const t = task({ modelsource: "plan", runspec: { runtime: "codex", model: "gpt-5.5" } });
        expect(cardModelTag(t, { runtime: "claude" } as Run, picksGroup)).toBe("gpt-5.5 · plan");
    });
    it("tags a route that differs from the workers route in runtime alone", () => {
        const t = task({ modelsource: "plan", runspec: { runtime: "pi", model: "haiku" } });
        expect(cardModelTag(t, { runtime: "claude", model: "haiku" } as Run, picksGroup)).toBe("haiku · plan");
    });
    it("is null when the runtime and the model both match the workers route", () => {
        const piLead = { runtime: "pi", model: "haiku" } as Run;
        const pinned = task({ modelsource: "plan", runspec: { runtime: "pi", model: "haiku" } });
        expect(cardModelTag(pinned, piLead, picksGroup)).toBeNull();
        // a harness with no model on a lead of that harness with no model: the same route
        const bare = task({ modelsource: "plan", runspec: { runtime: "codex" } });
        expect(cardModelTag(bare, { runtime: "codex" } as Run, picksGroup)).toBeNull();
    });
    it("is null on the workers route or the lead's", () => {
        expect(cardModelTag(task(), lead, workersGroup)).toBeNull();
        expect(cardModelTag(task(), lead, zeroGroup)).toBeNull();
        // a pick the setting ignores is not a tag
        expect(cardModelTag(task({ modelsource: "reviewer", runspec: { ...pin } }), lead, zeroGroup)).toBeNull();
    });
});

describe("reviewStateText", () => {
    it("reads every review state", () => {
        expect(reviewStateText(task())).toBe("not started");
        expect(reviewStateText(task({ reviewrunid: "r-1" }))).toBe("reviewing");
        expect(reviewStateText(task({ reviewrunid: "r-1", reviewverdict: "pass" }))).toBe("passed first time");
        expect(reviewStateText(task({ reviewverdict: "pass", reviewround: 2 }))).toBe("passed after 2 failed");
        expect(reviewStateText(task({ reviewrunid: "r-1", reviewverdict: "fail", reviewround: 1 }))).toBe("failed");
    });
});

describe("reviewerRouteOf", () => {
    it("is the lead's route when the group has no reviewer route", () => {
        expect(reviewerRouteOf(zeroGroup, lead)).toEqual({
            route: { runtime: "claude", model: "claude-opus-5-5" },
            custom: false,
        });
        const empty = { tasks: [], reviewerroute: { runtime: "" } } as unknown as TaskGroup;
        expect(reviewerRouteOf(empty, lead).custom).toBe(false);
    });
    it("is the group's route when it names a runtime or a model", () => {
        const set = { tasks: [], reviewerroute: { runtime: "pi", model: "gpt" } } as unknown as TaskGroup;
        expect(reviewerRouteOf(set, lead)).toEqual({ route: { runtime: "pi", model: "gpt" }, custom: true });
        // a model with no runtime runs on the default runtime, not the lead's
        const modelOnly = { tasks: [], reviewerroute: { model: "sonnet" } } as unknown as TaskGroup;
        expect(reviewerRouteOf(modelOnly, { runtime: "pi" } as Run)).toEqual({
            route: { runtime: "claude", model: "sonnet" },
            custom: true,
        });
    });
});

describe("header chips", () => {
    it("words the workers setting", () => {
        expect(workersChip(zeroGroup, lead)).toBe("workers · same as lead");
        expect(workersChip(picksGroup, lead)).toBe("workers · reviewer picks");
        expect(workersChip(workersGroup, lead)).toBe("workers · haiku");
    });
    it("names a harness with no model by the harness", () => {
        const codexDefault = { tasks: [], workerroute: { runtime: "codex" } } as unknown as TaskGroup;
        expect(workersChip(codexDefault, lead)).toBe("workers · codex");
        const codexModel = { tasks: [], workerroute: { runtime: "codex", model: "gpt-5.5" } } as unknown as TaskGroup;
        expect(workersChip(codexModel, lead)).toBe("workers · gpt-5.5");
    });
    it("words the reviewer route", () => {
        expect(reviewersChip(zeroGroup, lead)).toBe("reviewers · same as lead");
        const harnessOnly = { tasks: [], reviewerroute: { runtime: "pi" } } as unknown as TaskGroup;
        expect(reviewersChip(harnessOnly, lead)).toBe("reviewers · pi");
        const set = {
            tasks: [],
            reviewerroute: { runtime: "claude", model: "claude-sonnet-5-5" },
        } as unknown as TaskGroup;
        expect(reviewersChip(set, lead)).toBe("reviewers · sonnet-5-5");
    });
});

describe("stageEntries", () => {
    it("names each stage's state and the reviewer route's model", () => {
        const g = { tasks: [], planreview: { state: "passed", round: 1 } } as unknown as TaskGroup;
        expect(stageEntries(g, lead, 0)).toEqual([
            { key: "planreview", text: "plan review · passed · opus-5-5", tone: "done" },
            { key: "final", text: "final verify · waiting · opus-5-5", tone: "open" },
        ]);
    });
    it("leaves out a plan review that never ran, and uses the reviewer route", () => {
        const g = {
            tasks: [],
            reviewerroute: { model: "sonnet" },
            final: { state: "failed", round: 1 },
        } as unknown as TaskGroup;
        expect(stageEntries(g, lead, 0)).toEqual([
            { key: "final", text: "final verify · failed · sonnet", tone: "failed" },
        ]);
    });
    it("names a running final stage's step and how long it has run, with the plan's command and output as detail", () => {
        const g = {
            tasks: [],
            verify: "pytest -q",
            final: { state: "checking", round: 1, step: "verify", stepts: 1_000, output: "collected 40 items" },
        } as unknown as TaskGroup;
        expect(stageEntries(g, lead, 1_000 + 3 * 60_000)).toEqual([
            {
                key: "final",
                text: "final verify · running Verify 3m · opus-5-5",
                tone: "open",
                detail: "pytest -q\n\ncollected 40 items",
            },
        ]);
    });
    it("keeps only the last lines of a long output tail in the detail", () => {
        const output = Array.from({ length: 30 }, (_, i) => `line ${i}`).join("\n");
        const g = {
            tasks: [],
            finalcmd: "make e2e",
            final: { state: "final", round: 1, step: "final", stepts: 1, output },
        } as unknown as TaskGroup;
        const [entry] = stageEntries(g, lead, 1);
        expect(entry.detail?.startsWith("make e2e\n\nline 18\n")).toBe(true);
        expect(entry.detail?.endsWith("line 29")).toBe(true);
    });
    it("shows the verifier once the commands passed", () => {
        const g = { tasks: [], final: { state: "verifying", round: 1 } } as unknown as TaskGroup;
        expect(stageEntries(g, lead, 0)[0].text).toBe("final verify · verifier reviewing · opus-5-5");
    });
});

describe("isWaiting", () => {
    it("is a pending or ready task nothing has touched", () => {
        expect(isWaiting(task())).toBe(true);
        expect(isWaiting(task({ state: "ready" }))).toBe(true);
    });
    it("is false once the task has started or failed", () => {
        expect(isWaiting(task({ state: "running" }))).toBe(false);
        expect(isWaiting(task({ runid: "r-1" }))).toBe(false);
        expect(isWaiting(task({ attempts: 1 }))).toBe(false);
        expect(isWaiting(task({ escalations: 1 }))).toBe(false);
        expect(isWaiting(task({ firstactivity: 1 }))).toBe(false);
    });
});
