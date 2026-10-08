// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { describe, expect, it } from "vitest";
import type { DiffScope } from "./diffscope";
import { defaultFocusId, focusFollowAgent } from "./diffsource";

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
