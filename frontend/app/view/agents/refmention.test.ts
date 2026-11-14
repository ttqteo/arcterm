// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { describe, expect, it } from "vitest";
import type { AgentVM } from "./agentsviewmodel";
import {
    agentRefs,
    councilRefs,
    insertRef,
    queryKind,
    REF_MAX_ROWS,
    refMatches,
    refToken,
    runRefs,
    type RefItem,
} from "./refmention";

const agent = (id: string, task: string, extra: Partial<AgentVM> = {}): AgentVM =>
    ({ id, name: "loom", task, state: "idle", project: "arcterm", agent: "claude", ...extra }) as AgentVM;

const run = (oid: string, goal: string, extra: Partial<Run> = {}): Run =>
    ({ oid, goal, status: "done", mode: "orchestrator", createdts: 1, ...extra }) as unknown as Run;

const council = (id: string, feature: string): Council => ({ id, feature, state: "done" }) as unknown as Council;

describe("agentRefs", () => {
    it("lists every agent but the chat's own and plain terminals, in roster order", () => {
        const refs = agentRefs(
            [
                agent("self0000-1", "this chat"),
                agent("aaaa1111-1", "Docs v5"),
                agent("term0000-1", "", { kind: "terminal" }),
                agent("bbbb2222-1", "", { kind: "background", name: "bg" }),
            ],
            "self0000-1"
        );
        expect(refs.map((r) => [r.id, r.label])).toEqual([
            ["aaaa1111-1", "Docs v5"],
            ["bbbb2222-1", "bg"],
        ]);
        expect(refs[0].detail).toBe("arcterm · claude · idle");
    });
});

describe("runRefs", () => {
    it("keeps top-level runs only, newest first", () => {
        const refs = runRefs([
            run("r-old", "old", { createdts: 1 }),
            run("r-task", "a task", { createdts: 5, taskid: "t1" } as Partial<Run>),
            run("r-new", "new", { createdts: 9 }),
        ]);
        expect(refs.map((r) => r.id)).toEqual(["r-new", "r-old"]);
        expect(refs[0].detail).toBe("done · orchestrator");
    });

    it("is empty before the runs load", () => {
        expect(runRefs(null)).toEqual([]);
    });
});

describe("refMatches", () => {
    const items: RefItem[] = [
        ...councilRefs([council("0c28170c368b5ab0", "Sync client retry plan")]),
        ...runRefs([run("fed0d00e-a6df", "Agent chat view, round 3")]),
        ...agentRefs([agent("5065bd8c-1", "Docs rewrite draft"), agent("8e33269b-1", "Math in chat")], ""),
    ];

    it("lists nothing for a bare @ or a path", () => {
        expect(refMatches("", items)).toEqual([]);
        expect(refMatches("src/x", items)).toEqual([]);
        expect(refMatches("README.md", items)).toEqual([]);
    });

    it("lists one kind when the query names it", () => {
        expect(queryKind("cou")).toBe("council");
        expect(queryKind("r")).toBeNull();
        expect(refMatches("council", items).map((r) => r.id)).toEqual(["0c28170c368b5ab0"]);
        expect(refMatches("run", items).map((r) => r.id)).toEqual(["fed0d00e-a6df"]);
        expect(refMatches("agent", items).map((r) => r.id)).toEqual(["5065bd8c-1", "8e33269b-1"]);
    });

    it("matches an id prefix, or every word in the label and detail, agents first", () => {
        expect(refMatches("0c28", items).map((r) => r.kind)).toEqual(["council"]);
        expect(refMatches("docs draft", items).map((r) => r.id)).toEqual(["5065bd8c-1"]);
        expect(refMatches("round 3", items).map((r) => r.kind)).toEqual(["run"]);
        // "chat" is a kind word: it lists the agents, not every label that holds it
        expect(refMatches("chat", items).map((r) => r.kind)).toEqual(["agent", "agent"]);
    });

    it("shows at most REF_MAX_ROWS", () => {
        const many = agentRefs(
            Array.from({ length: 10 }, (_, i) => agent(`a${i}000000`, `task ${i}`)),
            ""
        );
        expect(refMatches("agent", many)).toHaveLength(REF_MAX_ROWS);
    });
});

describe("insertRef", () => {
    it("puts kind and an 8-character id in place of the @query, with one space after", () => {
        expect(refToken({ kind: "council", id: "0c28170c368b5ab0" })).toBe("council:0c28170c");
        expect(insertRef("đọc @coun rồi chốt", 4, 9, { kind: "council", id: "0c28170c368b5ab0" })).toEqual({
            text: "đọc council:0c28170c rồi chốt",
            caret: 21,
        });
        expect(insertRef("đọc @pap", 4, 8, { kind: "agent", id: "5065bd8c-1" })).toEqual({
            text: "đọc agent:5065bd8c ",
            caret: 19,
        });
    });
});
