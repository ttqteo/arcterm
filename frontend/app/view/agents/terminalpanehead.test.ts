// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { describe, expect, it } from "vitest";
import type { AgentVM } from "./agentsviewmodel";
import { headSubject, previousTab, terminalPaneHead } from "./terminalpanehead";

function tool(over: Partial<ToolStatus> = {}): ToolStatus {
    return {
        id: "lazygit",
        name: "lazygit",
        category: "Git",
        purpose: "",
        command: "lazygit",
        opensin: "agent",
        shows: "centre",
        install: {},
        found: true,
        ...over,
    } as ToolStatus;
}

function vm(over: Partial<AgentVM>): AgentVM {
    return { id: "x", name: "claude", task: "", state: "idle", ...over };
}
const term = (over: Partial<AgentVM> = {}) =>
    vm({ id: "t1", name: "lazygit", kind: "terminal", project: "arcterm", cwd: "D:\\work\\arcterm", ...over });
const roots = new Map([["arcterm", "D:\\work\\arcterm"]]);

describe("terminalPaneHead", () => {
    it("names the terminal and says nothing of a folder that is the project's root", () => {
        expect(terminalPaneHead(term(), undefined, roots)).toEqual({
            name: "lazygit",
            icon: "terminal",
            place: undefined,
            backTo: undefined,
        });
    });

    it("places a terminal that runs in another folder, by that folder's name", () => {
        const head = terminalPaneHead(term({ cwd: "D:\\work\\arcterm\\.worktrees\\fix-login" }), undefined, roots);
        expect(head.place).toBe("fix-login");
    });

    it("has no place for a project with no root, or a terminal with no cwd", () => {
        expect(terminalPaneHead(term({ project: "other" }), undefined, roots).place).toBeUndefined();
        expect(terminalPaneHead(term({ cwd: undefined }), undefined, roots).place).toBeUndefined();
    });

    it("goes back to the agent that was in view before", () => {
        const head = terminalPaneHead(term(), vm({ id: "a1", name: "fix-login" }), roots);
        expect(head.backTo).toBe("fix-login");
    });

    it("has nothing to go back to when the previous tab was a terminal, or there was none", () => {
        expect(
            terminalPaneHead(term(), vm({ id: "t2", name: "btop", kind: "terminal" }), roots).backTo
        ).toBeUndefined();
        expect(terminalPaneHead(term(), undefined, roots).backTo).toBeUndefined();
    });
});

describe("terminalPaneHead for a tool", () => {
    const git = tool({ id: "lazygit", name: "LazyGit", category: "Git", command: "lazygit" });

    it("takes the tool's name and its category's icon while the terminal still carries the launch name", () => {
        const head = terminalPaneHead(term({ name: "Terminal 3", toolId: "lazygit" }), undefined, roots, [git]);
        expect(head.name).toBe("LazyGit");
        expect(head.icon).toBe("git-branch");
        // the shell reports the command line it was handed
        expect(terminalPaneHead(term({ name: "lazygit", toolId: "lazygit" }), undefined, roots, [git]).name).toBe(
            "LazyGit"
        );
    });

    it("keeps the terminal's own name once it was renamed, or the tool has quit and the last command names it", () => {
        const renamed = terminalPaneHead(term({ name: "release", toolId: "lazygit" }), undefined, roots, [git]);
        expect(renamed.name).toBe("release");
        expect(renamed.icon).toBe("git-branch");
    });

    it("is a plain terminal until the library has loaded, or when its tool is gone from it", () => {
        const t = term({ name: "Terminal 3", toolId: "lazygit" });
        expect(terminalPaneHead(t, undefined, roots)).toMatchObject({ name: "Terminal 3", icon: "terminal" });
        expect(
            terminalPaneHead(t, undefined, roots, [tool({ id: "yazi", name: "yazi", category: "Files" })])
        ).toMatchObject({ name: "Terminal 3", icon: "terminal" });
    });

    it("draws a user tool's wrench", () => {
        const mine = tool({ id: "mine", name: "mine", category: "Yours", command: "mine" });
        expect(terminalPaneHead(term({ name: "mine", toolId: "mine" }), undefined, roots, [mine]).icon).toBe("wrench");
    });
});

describe("previousTab", () => {
    const roster = [vm({ id: "a1", name: "fix-login" }), vm({ id: "a2", name: "docs" }), term()];

    it("is the newest recent tab other than the current one", () => {
        expect(previousTab(["t1", "a2", "a1"], "t1", roster)?.id).toBe("a2");
    });

    it("passes over a tab that is no longer on the roster", () => {
        expect(previousTab(["t1", "gone", "a1"], "t1", roster)?.id).toBe("a1");
    });

    it("is undefined when nothing else was in view", () => {
        expect(previousTab(["t1"], "t1", roster)).toBeUndefined();
        expect(previousTab([], "t1", roster)).toBeUndefined();
    });
});

describe("headSubject", () => {
    const a = vm({ id: "a", name: "alpha" });
    const b = vm({ id: "b", name: "beta" });
    const t = term();
    const t2 = term({ id: "t2" });
    const all = [a, b, t, t2];

    it("is the focused agent itself", () => {
        expect(headSubject(a, ["a", "t1"], [], all)).toBe(a);
    });

    it("is a terminal's own when it is alone", () => {
        expect(headSubject(t, ["t1"], ["a"], all)).toBe(t);
    });

    it("is the split's agent while a terminal in it has the focus", () => {
        expect(headSubject(t, ["a", "t1"], [], all)).toBe(a);
    });

    it("is the split's agent seen last, else its first", () => {
        expect(headSubject(t, ["a", "b", "t1"], ["t1", "b", "a"], all)).toBe(b);
        expect(headSubject(t, ["b", "a", "t1"], [], all)).toBe(b);
    });

    it("is the terminal's own in a split of terminals only", () => {
        expect(headSubject(t, ["t1", "t2"], [], all)).toBe(t);
    });
});
