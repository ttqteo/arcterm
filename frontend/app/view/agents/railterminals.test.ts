import { describe, expect, it } from "vitest";
import type { AgentVM } from "./agentsviewmodel";
import { projectFocusTarget } from "./railterminals";

const term = (id: string, project?: string): AgentVM => ({
    id,
    name: id,
    task: "",
    state: "idle",
    kind: "terminal",
    agent: "terminal",
    project,
});

describe("projectFocusTarget", () => {
    const agent = (id: string, project: string): AgentVM => ({ ...term(id, project), kind: "agent", agent: "claude" });
    it("prefers the project's first agent", () => {
        const target = projectFocusTarget([agent("a1", "alpha"), agent("b1", "beta")], [term("t1", "alpha")], "alpha");
        expect(target?.id).toBe("a1");
    });
    it("falls back to the project's first terminal when it has no agent", () => {
        const target = projectFocusTarget([agent("b1", "beta")], [term("t0", "beta"), term("t1", "alpha")], "alpha");
        expect(target?.id).toBe("t1");
    });
    it("does not take a terminal that names no project", () => {
        expect(projectFocusTarget([], [term("loose")], "alpha")).toBeUndefined();
    });
    it("is undefined when the project has neither", () => {
        expect(projectFocusTarget([agent("b1", "beta")], [term("t0", "beta")], "alpha")).toBeUndefined();
    });
});
