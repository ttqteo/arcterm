import { describe, expect, it } from "vitest";
import type { AgentVM } from "./agentsviewmodel";
import { projectFocusTarget, railTerminals } from "./railterminals";

const term = (id: string, project?: string): AgentVM => ({
    id,
    name: id,
    task: "",
    state: "idle",
    kind: "terminal",
    agent: "terminal",
    project,
});
const ids = (r: { rows: AgentVM[] }) => r.rows.map((t) => t.id);
const all = [term("a1", "alpha"), term("b1", "beta"), term("a2", "alpha"), term("loose")];

describe("railTerminals", () => {
    it("narrows to the agent's project, keeping the roster's order and the terminals that name no project", () => {
        const r = railTerminals(all, "alpha", false);
        expect(ids(r)).toEqual(["a1", "a2", "loose"]);
        expect(r).toMatchObject({ other: 1, scoped: true });
    });
    it("lists every terminal on request, still counting the other project's", () => {
        const r = railTerminals(all, "alpha", true);
        expect(ids(r)).toEqual(["a1", "b1", "a2", "loose"]);
        expect(r).toMatchObject({ other: 1, scoped: false });
    });
    it("lists every terminal when the focused item's project is unknown", () => {
        const r = railTerminals(all, "", false);
        expect(ids(r)).toEqual(["a1", "b1", "a2", "loose"]);
        expect(r).toMatchObject({ other: 0, scoped: false });
    });
    it("a project with no terminals of its own is empty, with the others counted", () => {
        const r = railTerminals([term("b1", "beta")], "alpha", false);
        expect(r).toMatchObject({ rows: [], other: 1, scoped: true });
    });
    it("no terminals at all", () => {
        expect(railTerminals([], "alpha", false)).toEqual({ rows: [], other: 0, scoped: true });
    });
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
