// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import type { AgentVM } from "@/app/view/agents/agentsviewmodel";
import { describe, expect, it } from "vitest";
import { agentGridRows, agentPeekFacts, changedFilesSummary, sessionLabel } from "./peekagentmodel";

const AGENT: AgentVM = { id: "t1", name: "loom", task: "", state: "idle", project: "waveterm" };

describe("agentGridRows", () => {
    it("is in mockup order", () => {
        const rows = agentGridRows({ session: "s", model: "Opus", cwd: "/w", branch: "main", project: "arc" });
        expect(rows.map((r) => r.label)).toEqual(["project", "branch", "cwd", "model", "session"]);
    });

    it("omits a row whose value is unknown", () => {
        const rows = agentGridRows({ project: "arc", branch: undefined, cwd: "", model: "Opus" });
        expect(rows.map((r) => r.label)).toEqual(["project", "model"]);
        expect(rows.some((r) => r.value.includes("undefined"))).toBe(false);
    });
});

describe("changedFilesSummary", () => {
    it("sums the files", () => {
        const files = [
            { path: "a", status: "M", adds: 28, dels: 2 },
            { path: "b", status: "A", adds: 3, dels: 0 },
        ];
        expect(changedFilesSummary(files)).toBe("2 files · +31 −2");
    });
});

describe("sessionLabel", () => {
    it("prefers the session id, else the transcript's file name", () => {
        expect(sessionLabel({ sessionId: "abc", transcriptPath: "/x/y.jsonl" })).toBe("abc");
        expect(sessionLabel({ transcriptPath: "C:\\x\\9f2.jsonl" })).toBe("9f2");
        expect(sessionLabel({})).toBeUndefined();
    });
});

describe("agentPeekFacts", () => {
    it("is gone when the agent is missing from the roster", () => {
        expect(agentPeekFacts(undefined)).toEqual({ gone: true });
    });
    it("is present for an agent in the roster", () => {
        expect(agentPeekFacts(AGENT)).toEqual({ gone: false });
    });
});
