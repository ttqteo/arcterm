import { describe, expect, it } from "vitest";
import { bgTaskStatusLabel, planAgentRail, type AgentRailInput } from "./agentrailsections";

const base: AgentRailInput = {
    inSubagent: false,
    needsYou: 0,
    subagents: 0,
    files: 3,
    bgTasks: 1,
    tools: 4,
    hasRun: false,
};
const ids = (i: AgentRailInput) => planAgentRail(i).map((s) => s.id);

describe("planAgentRail", () => {
    it("lists attention first and the facts last, keeping empty counted sections", () => {
        expect(ids(base)).toEqual(["subagents", "files", "bgtasks", "tools", "details", "usage"]);
        expect(planAgentRail(base).find((s) => s.id === "subagents")?.header).toEqual({ count: 0 });
    });
    it("needs-you leads, uncounted, only when something waits", () => {
        expect(ids({ ...base, needsYou: 2 })[0]).toBe("needs");
        expect(planAgentRail({ ...base, needsYou: 2 })[0].header).toBeUndefined();
    });
    it("the run section sits after the counted ones", () => {
        expect(ids({ ...base, hasRun: true })).toEqual([
            "subagents",
            "files",
            "bgtasks",
            "tools",
            "run",
            "details",
            "usage",
        ]);
    });
    it("details and token usage start closed", () => {
        const plan = planAgentRail(base);
        expect(plan.find((s) => s.id === "details")?.header).toEqual({ defaultOpen: false });
        expect(plan.find((s) => s.id === "usage")?.header).toEqual({ defaultOpen: false });
    });
    it("files with no count (loading, not a repo) has a header but no number", () => {
        expect(planAgentRail({ ...base, files: null }).find((s) => s.id === "files")?.header).toEqual({});
    });
    it("a subagent interior shows its head, tools, details and usage only", () => {
        expect(ids({ ...base, inSubagent: true, needsYou: 1, hasRun: true })).toEqual([
            "subagent",
            "tools",
            "details",
            "usage",
        ]);
    });
});

describe("bgTaskStatusLabel", () => {
    it("a running task of a session that is no longer live is unknown", () => {
        expect(bgTaskStatusLabel("running", true)).toBe("running");
        expect(bgTaskStatusLabel("running", false)).toBe("unknown");
        expect(bgTaskStatusLabel("completed", false)).toBe("completed");
    });
});
