// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { describe, expect, it } from "vitest";
import {
    currentProject,
    NOT_A_REPO_LABEL,
    sidebarRows,
    worktreeLabel,
    worktreeRelPath,
    type SidebarInput,
    type SidebarRow,
} from "./worktreesidebar";

// the registry spells paths with backslashes, git with forward slashes
const arc = { name: "arcterm", path: "D:\\src\\arcterm" };
const cus = { name: "cuscofi", path: "D:\\src\\cuscofi" };
const main: GitWorktree = { path: "D:/src/arcterm", branch: "main", ismain: true, changed: 3 };
const linked: GitWorktree = { path: "D:/src/arcterm/.waveterm/worktrees/bd2ad781", branch: "wave/bd2ad781" };
const feature: GitWorktree = { path: "D:/wt/arcterm-feature", branch: "feature/sidebar" };
const claude = { id: "a1", name: "claude", state: "working" };
const pi = { id: "a2", name: "pi", state: "waiting" };
const agy = { id: "a3", name: "agy", state: "idle" };

function input(over: Partial<SidebarInput> = {}): SidebarInput {
    return {
        projects: [arc, cus],
        worktrees: { arcterm: [main, linked, feature] },
        errors: {},
        agentCwds: {},
        agents: [],
        expanded: new Set(["arcterm"]),
        current: {},
        query: "",
        ...over,
    };
}

// a compact picture of the rows: "group:arcterm+" (expanded), "wt:main", "agent:claude", "other"; "*" marks current
function shape(rows: SidebarRow[]): string[] {
    return rows.map((r) => {
        switch (r.kind) {
            case "group":
                return `group:${r.project}${r.expanded ? "+" : ""}${r.error ? "!" : ""}`;
            case "worktree":
                return `wt:${r.label}${r.current ? "*" : ""}`;
            case "agent":
                return `agent:${r.agent.name}${r.current ? "*" : ""}`;
            case "other-agents":
                return "other";
        }
    });
}

describe("worktreeLabel", () => {
    it("is the branch, or the commit a detached checkout sits on", () => {
        expect(worktreeLabel(main)).toBe("main");
        expect(worktreeLabel({ path: "D:/x", head: "1a2b3c4" })).toBe("detached 1a2b3c4");
        expect(worktreeLabel({ path: "D:/x" })).toBe("detached");
    });
});

describe("worktreeRelPath", () => {
    it("is the path from the main checkout, else the full path", () => {
        expect(worktreeRelPath(linked, main)).toBe(".waveterm/worktrees/bd2ad781");
        expect(worktreeRelPath(feature, main)).toBe("D:/wt/arcterm-feature");
        expect(worktreeRelPath(feature, undefined)).toBe("D:/wt/arcterm-feature");
    });
});

describe("sidebarRows groups", () => {
    it("lists groups in project order with the main checkout first", () => {
        const rows = sidebarRows(input({ expanded: new Set(["arcterm", "cuscofi"]) }));
        expect(shape(rows)).toEqual([
            "group:arcterm+",
            "wt:main",
            "wt:wave/bd2ad781",
            "wt:feature/sidebar",
            "group:cuscofi+",
            "wt:cuscofi",
        ]);
        expect(rows[0]).toEqual({ kind: "group", project: "arcterm", path: arc.path, expanded: true });
        expect(rows[1]).toMatchObject({ kind: "worktree", project: "arcterm", wt: main });
    });

    it("offers an expanded group not yet loaded as one main row from the project path", () => {
        const rows = sidebarRows(input({ worktrees: {}, expanded: new Set(["cuscofi"]) }));
        expect(shape(rows)).toEqual(["group:arcterm", "group:cuscofi+", "wt:cuscofi"]);
        expect(rows[2]).toEqual({
            kind: "worktree",
            project: "cuscofi",
            wt: { path: cus.path, ismain: true },
            label: "cuscofi",
            current: false,
        });
    });

    it("emits only the header of a collapsed group", () => {
        const rows = sidebarRows(input({ expanded: new Set(), agents: [claude], agentCwds: { a1: "D:/src/arcterm" } }));
        expect(shape(rows)).toEqual(["group:arcterm", "group:cuscofi"]);
    });

    it("collapses the group holding the current source when the user did", () => {
        const rows = sidebarRows(
            input({ expanded: new Set(), current: { origin: { kind: "project", name: "arcterm", path: arc.path } } })
        );
        expect(shape(rows)).toEqual(["group:arcterm", "group:cuscofi"]);
    });
    it("shows a group whose load listed no worktrees as one pickable not-a-repository row", () => {
        const rows = sidebarRows(input({ worktrees: { cuscofi: [] }, expanded: new Set(["cuscofi"]) }));
        expect(rows.slice(1)).toEqual([
            { kind: "group", project: "cuscofi", path: cus.path, expanded: true },
            {
                kind: "worktree",
                project: "cuscofi",
                wt: { path: cus.path, ismain: true },
                label: NOT_A_REPO_LABEL,
                current: false,
            },
        ]);
    });

    it("keeps a rejected group's header with the error and one pickable main row", () => {
        const rows = sidebarRows(input({ errors: { arcterm: "git worktree: boom" } }));
        expect(rows.slice(0, 2)).toEqual([
            { kind: "group", project: "arcterm", path: arc.path, expanded: true, error: "git worktree: boom" },
            {
                kind: "worktree",
                project: "arcterm",
                wt: { path: arc.path, ismain: true },
                label: "arcterm",
                current: false,
            },
        ]);
        expect(shape(rows)).toEqual(["group:arcterm+!", "wt:arcterm", "group:cuscofi"]);
    });
});

describe("sidebarRows agents", () => {
    it("nests an agent under the deepest checkout holding its cwd, whatever the slashes and case", () => {
        const rows = sidebarRows(
            input({
                agents: [claude, pi, agy],
                agentCwds: {
                    a1: "d:\\SRC\\arcterm\\.waveterm\\worktrees\\bd2ad781\\pkg",
                    a2: "D:\\src\\arcterm",
                    a3: "D:/WT/arcterm-feature/",
                },
            })
        );
        expect(shape(rows)).toEqual([
            "group:arcterm+",
            "wt:main",
            "agent:pi",
            "wt:wave/bd2ad781",
            "agent:claude",
            "wt:feature/sidebar",
            "agent:agy",
            "group:cuscofi",
        ]);
    });

    it("does not count a sibling directory sharing a prefix as inside a checkout", () => {
        const rows = sidebarRows(input({ agents: [claude], agentCwds: { a1: "D:/src/arcterm2" } }));
        expect(shape(rows).slice(-2)).toEqual(["other", "agent:claude"]);
    });

    it("puts unresolved, unknown and outside agents under Other agents", () => {
        const rows = sidebarRows(input({ agents: [claude, pi, agy], agentCwds: { a1: null, a3: "C:/elsewhere" } }));
        expect(shape(rows)).toEqual([
            "group:arcterm+",
            "wt:main",
            "wt:wave/bd2ad781",
            "wt:feature/sidebar",
            "group:cuscofi",
            "other",
            "agent:claude",
            "agent:pi",
            "agent:agy",
        ]);
        expect(rows[5]).toEqual({ kind: "other-agents" });
    });

    it("omits Other agents when every agent has a checkout", () => {
        const rows = sidebarRows(input({ agents: [claude], agentCwds: { a1: main.path } }));
        expect(rows.some((r) => r.kind === "other-agents")).toBe(false);
    });

    it("nests under an unloaded group's main row from the project path", () => {
        const rows = sidebarRows(
            input({ agents: [claude], agentCwds: { a1: "D:/src/cuscofi/web" }, expanded: new Set(["cuscofi"]) })
        );
        expect(shape(rows)).toEqual(["group:arcterm", "group:cuscofi+", "wt:cuscofi", "agent:claude"]);
    });
});

describe("sidebarRows current", () => {
    const agents = { agents: [claude, pi], agentCwds: { a1: linked.path, a2: null } };

    it("marks the agent row for an agent origin, nested or other", () => {
        expect(shape(sidebarRows(input({ ...agents, current: { origin: { kind: "agent", id: "a1" } } })))).toContain(
            "agent:claude*"
        );
        const rows = shape(sidebarRows(input({ ...agents, current: { origin: { kind: "agent", id: "a2" } } })));
        expect(rows.slice(-2)).toEqual(["other", "agent:pi*"]);
        expect(rows.filter((r) => r.endsWith("*"))).toHaveLength(1);
    });

    it("marks the main checkout for a project origin", () => {
        const rows = shape(
            sidebarRows(input({ current: { origin: { kind: "project", name: "arcterm", path: arc.path } } }))
        );
        expect(rows.filter((r) => r.endsWith("*"))).toEqual(["wt:main*"]);
    });

    it("marks the not-a-repository row for its project origin", () => {
        const rows = shape(
            sidebarRows(
                input({
                    worktrees: { cuscofi: [] },
                    expanded: new Set(["cuscofi"]),
                    current: { origin: { kind: "project", name: "cuscofi", path: cus.path } },
                })
            )
        );
        expect(rows.slice(-2)).toEqual(["group:cuscofi+", `wt:${NOT_A_REPO_LABEL}*`]);
    });

    it("marks the linked checkout for a worktree origin by path", () => {
        const origin = {
            kind: "worktree" as const,
            path: "d:\\src\\arcterm\\.waveterm\\worktrees\\bd2ad781\\",
            project: "arcterm",
        };
        const rows = shape(sidebarRows(input({ current: { origin } })));
        expect(rows.filter((r) => r.endsWith("*"))).toEqual(["wt:wave/bd2ad781*"]);
    });

    it("marks the checkout a run origin's resolved cwd is", () => {
        const origin = { kind: "run" as const, runId: "r1", cwd: "D:/wt/arcterm-feature", baseCommit: "abc" };
        expect(shape(sidebarRows(input({ current: { origin } }))).filter((r) => r.endsWith("*"))).toEqual([
            "wt:feature/sidebar*",
        ]);
        const resolved = shape(
            sidebarRows(input({ current: { origin, cwd: "D:\\src\\arcterm\\.waveterm\\worktrees\\bd2ad781" } }))
        );
        expect(resolved.filter((r) => r.endsWith("*"))).toEqual(["wt:wave/bd2ad781*"]);
    });

    it("marks nothing without an origin", () => {
        expect(shape(sidebarRows(input(agents))).some((r) => r.endsWith("*"))).toBe(false);
    });
});

describe("sidebarRows filter", () => {
    const base = {
        agents: [claude, pi, agy],
        agentCwds: { a1: linked.path, a2: main.path, a3: null },
        expanded: new Set<string>(),
    };

    it("keeps a group whose project name matches, expanded, with all its rows", () => {
        expect(shape(sidebarRows(input({ ...base, query: "ARC" })))).toEqual([
            "group:arcterm+",
            "wt:main",
            "agent:pi",
            "wt:wave/bd2ad781",
            "agent:claude",
            "wt:feature/sidebar",
        ]);
    });

    it("keeps only the checkout whose branch matches", () => {
        expect(shape(sidebarRows(input({ ...base, query: "feature" })))).toEqual([
            "group:arcterm+",
            "wt:feature/sidebar",
        ]);
    });

    it("matches a worktree path whatever the slashes", () => {
        expect(shape(sidebarRows(input({ ...base, query: "worktrees\\bd2" })))).toEqual([
            "group:arcterm+",
            "wt:wave/bd2ad781",
        ]);
    });

    it("keeps a matching agent under its checkout, and in Other agents", () => {
        expect(shape(sidebarRows(input({ ...base, query: "claude" })))).toEqual([
            "group:arcterm+",
            "wt:wave/bd2ad781",
            "agent:claude",
        ]);
        expect(shape(sidebarRows(input({ ...base, query: "agy" })))).toEqual(["other", "agent:agy"]);
    });

    it("leaves nothing when nothing matches", () => {
        expect(sidebarRows(input({ ...base, query: "zzz" }))).toEqual([]);
    });
});

describe("currentProject", () => {
    it("names the group holding the current checkout or agent, expanded or not", () => {
        const collapsed = { expanded: new Set<string>() };
        expect(
            currentProject(
                input({ ...collapsed, current: { origin: { kind: "project", name: "arcterm", path: arc.path } } })
            )
        ).toBe("arcterm");
        expect(
            currentProject(
                input({
                    ...collapsed,
                    agents: [claude],
                    agentCwds: { a1: linked.path },
                    current: { origin: { kind: "agent", id: "a1" } },
                })
            )
        ).toBe("arcterm");
        const run = { kind: "run" as const, runId: "r1", cwd: "D:/src/cuscofi", baseCommit: "" };
        expect(currentProject(input({ current: { origin: run } }))).toBe("cuscofi");
    });

    it("is undefined for an agent no checkout holds, or no origin", () => {
        const current = { origin: { kind: "agent" as const, id: "a2" } };
        expect(currentProject(input({ agents: [pi], agentCwds: { a2: null }, current }))).toBeUndefined();
        expect(currentProject(input())).toBeUndefined();
    });
});
