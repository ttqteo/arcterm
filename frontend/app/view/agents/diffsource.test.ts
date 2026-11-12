// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { describe, expect, it } from "vitest";
import type { DiffScope } from "./diffscope";
import { defaultFocusId, endedAgentScope, focusFollowAgent, subjectState } from "./diffsource";

const agents = [
    { id: "a1", name: "jarvis-recall" },
    { id: "a2", name: "diff-parity" },
];

const agentScope = (id: string): DiffScope => ({
    repo: { origin: { kind: "agent", id }, label: id },
    range: { kind: "session", agentId: id },
});
const projectScope: DiffScope = {
    repo: { origin: { kind: "project", name: "waveterm", path: "/repo" }, label: "waveterm" },
    range: { kind: "working" },
};
const runScope: DiffScope = {
    repo: { origin: { kind: "run", runId: "r1", cwd: "/repo", baseCommit: "" }, label: "run r1" },
    range: { kind: "run", runId: "r1", baseCommit: "" },
};
const worktreeScope: DiffScope = {
    repo: { origin: { kind: "worktree", path: "/repo/.worktrees/feat", project: "waveterm" }, label: "feat" },
    range: { kind: "working" },
};

describe("run beats project beats agent", () => {
    it("adopts the focused agent when the surface is unscoped", () => {
        expect(focusFollowAgent(null, "a2", agents)).toEqual({ id: "a2", name: "diff-parity" });
    });

    it("leaves a pinned project or a run where it is", () => {
        expect(focusFollowAgent(projectScope, "a1", agents)).toBeNull();
        expect(focusFollowAgent(runScope, "a1", agents)).toBeNull();
    });

    it("leaves a picked worktree where it is", () => {
        expect(focusFollowAgent(worktreeScope, "a1", agents)).toBeNull();
    });

    it("does not re-scope to the agent it is already showing", () => {
        expect(focusFollowAgent(agentScope("a1"), "a1", agents)).toBeNull();
    });

    it("follows focus from one agent to another", () => {
        expect(focusFollowAgent(agentScope("a1"), "a2", agents)).toEqual({ id: "a2", name: "diff-parity" });
    });

    // focus can name an agent that has since exited; the surface keeps showing what it has
    it("ignores a focus id no agent answers to", () => {
        expect(focusFollowAgent(agentScope("a1"), "gone", agents)).toBeNull();
        expect(focusFollowAgent(null, "", agents)).toBeNull();
    });

    // the Agent surface moves focus to the first agent when the focused one leaves, which must not carry the
    // surface off the ended agent's state before it can be read
    it("holds an agent scope whose agent has left the roster", () => {
        expect(focusFollowAgent(agentScope("gone"), "a1", agents)).toBeNull();
    });
});

describe("subjectState", () => {
    it("is empty with no agents, no projects and no scope", () => {
        expect(subjectState(null, [], [])).toBe("empty");
    });

    it("asks to pick when sources exist but nothing is scoped", () => {
        expect(subjectState(null, agents, [])).toBe("pick");
        expect(subjectState(null, [], [{ name: "waveterm" }])).toBe("pick");
    });

    it("is ended for an agent scope whose agent is not in the roster", () => {
        expect(subjectState(agentScope("gone"), agents, [])).toBe("ended");
    });

    it("is ready for a live agent, a project, a worktree and a run", () => {
        expect(subjectState(agentScope("a1"), agents, [])).toBe("ready");
        expect(subjectState(projectScope, [], [])).toBe("ready");
        expect(subjectState(worktreeScope, [], [])).toBe("ready");
        expect(subjectState(runScope, [], [])).toBe("ready");
    });
});

describe("endedAgentScope", () => {
    const projects = [{ name: "waveterm", path: "D:\\repo\\waveterm" }];

    it("re-scopes to the registered project at the agent's folder", () => {
        const s = endedAgentScope("D:/repo/waveterm", projects);
        expect(s?.repo.origin).toEqual({ kind: "project", name: "waveterm", path: "D:\\repo\\waveterm" });
        expect(s?.range).toEqual({ kind: "working" });
    });

    it("falls back to the folder itself as a project named after it", () => {
        const s = endedAgentScope("/work/scratch", projects);
        expect(s?.repo.origin).toEqual({ kind: "project", name: "scratch", path: "/work/scratch" });
    });

    it("has nothing to re-scope to without a remembered folder", () => {
        expect(endedAgentScope(undefined, projects)).toBeNull();
        expect(endedAgentScope("", projects)).toBeNull();
    });
});

describe("the first agent, so opening the surface is useful", () => {
    it("focuses the first agent when nothing is scoped or focused", () => {
        expect(defaultFocusId(null, "", agents)).toBe("a1");
    });

    it("defaults nothing once there is a scope, a focus, or no agents", () => {
        expect(defaultFocusId(projectScope, "", agents)).toBeNull();
        expect(defaultFocusId(null, "a2", agents)).toBeNull();
        expect(defaultFocusId(null, "", [])).toBeNull();
    });
});
