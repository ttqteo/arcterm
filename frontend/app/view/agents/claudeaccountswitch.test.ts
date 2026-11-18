// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { describe, expect, it } from "vitest";
import type { AgentVM } from "./agentsviewmodel";
import { switchPlan } from "./claudeaccountswitch";
import type { ClaudeIdentity } from "./ratelimitstore";
import { NO_LINEAGE } from "./runlineage";

const base = { agent: "claude", task: "", state: "idle", usage: {} };
const agent = (id: string, project?: string, extra: Partial<AgentVM> = {}) =>
    ({
        ...base,
        id,
        name: id,
        blockId: `b-${id}`,
        transcriptPath: `/p/s-${id}.jsonl`,
        ...(project != null ? { project } : {}),
        ...extra,
    }) as AgentVM;

const accounts = [
    { id: "a1", label: "Work" },
    { id: "a2", label: "Side", notoken: true },
];
const identity: ClaudeIdentity = { loginEmail: "me@x.com", accounts };
const projects: Record<string, ProjectKeywords> = {
    work: { path: "/w", claudeaccount: "a1" },
    plain: { path: "/p" },
};

const plan = (id: string, over: Partial<Parameters<typeof switchPlan>[1]> = {}) =>
    switchPlan(id, {
        agents: [agent("t1", "plain"), agent("t2", "work"), agent("t3")],
        lineage: NO_LINEAGE,
        projects,
        accounts,
        identity,
        active: "",
        ...over,
    });

describe("switchPlan", () => {
    it("writes the active account when the switch moves it", () => {
        expect(plan("a1").writeActive).toBe(true);
        expect(plan("").writeActive).toBe(false);
    });

    it("writes it when the active account is not known yet", () => {
        expect(plan("a1", { active: null }).writeActive).toBe(true);
    });

    it("writes nothing when the target is already the active account, yet still lists the candidates", () => {
        const p = plan("a1", { active: "a1" });
        expect(p.writeActive).toBe(false);
        expect(p.candidates.map((c) => c.tabId)).toEqual(["t1", "t3"]);
    });

    it("lists the agents not already on the account, leaving out a project pinned to its own account", () => {
        // t2 sits in `work`, which runs on a1 whatever is active
        expect(plan("a1").candidates.map((c) => c.tabId)).toEqual(["t1", "t3"]);
    });

    it("leaves out the excluded tab", () => {
        expect(plan("a1", { exclude: "t1" }).candidates.map((c) => c.tabId)).toEqual(["t3"]);
    });

    it("gives no candidates when none is left", () => {
        const p = plan("a1", { agents: [agent("t2", "work"), agent("t1", "plain")], exclude: "t1" });
        expect(p.candidates).toEqual([]);
        expect(plan("a1", { agents: [] }).candidates).toEqual([]);
    });

    it("keeps an agent already on the target out, as restartCandidates does", () => {
        const agents = [agent("t1", "plain", { usage: { account: "a1" } }), agent("t3")];
        expect(plan("a1", { agents }).candidates.map((c) => c.tabId)).toEqual(["t3"]);
    });

    it("names the account as settings does", () => {
        expect(plan("a1").accountName).toBe("Work");
        expect(plan("").accountName).toBe("me@x.com");
        expect(plan("", { identity: { loginEmail: "", accounts } }).accountName).toBe("Claude login");
        expect(plan("a9").accountName).toBe("a9");
    });

    it("works with no projects loaded", () => {
        expect(plan("a1", { projects: null }).candidates.map((c) => c.tabId)).toEqual(["t1", "t2", "t3"]);
    });
});
