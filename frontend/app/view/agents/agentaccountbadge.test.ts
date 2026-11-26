// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { describe, expect, it } from "vitest";
import { agentAccountBadges } from "./agentaccountbadge";
import type { ClaudeIdentity } from "./ratelimitstore";

const identity: ClaudeIdentity = {
    loginEmail: "me@home.dev",
    accounts: [
        { id: "a1", label: "Work", email: "me@work.dev" },
        { id: "a2", label: "Spare" },
        { id: "a3", label: "Same as login", email: "me@home.dev" },
    ],
};

describe("agentAccountBadges", () => {
    it("shows nothing while every claude agent runs on one account", () => {
        const agents = [
            { id: "t1", agent: "claude" },
            { id: "t2", agent: "claude", usage: {} },
        ];
        expect(agentAccountBadges(agents, identity, "")).toEqual({});
    });

    it("names each claude agent once two accounts are in play", () => {
        const agents = [
            { id: "t1", agent: "claude", usage: { account: "a1" } },
            { id: "t2", agent: "claude", usage: {} },
            { id: "t3", agent: "codex" },
        ];
        expect(agentAccountBadges(agents, identity, "")).toEqual({
            t1: { text: "Work", title: "Claude account: Work" },
            t2: { text: "me@home.dev", title: "Claude account: me@home.dev" },
        });
    });

    it("reads a launch's pick before the agent reports, and the active account after neither", () => {
        const agents = [
            { id: "t1", agent: "claude", accountPick: "login" },
            { id: "t2", agent: "claude" },
        ];
        const out = agentAccountBadges(agents, identity, "a2");
        expect(out.t1.text).toBe("me@home.dev");
        expect(out.t2.text).toBe("Spare");
    });

    it("counts a token account tied to the /login email as that one account", () => {
        const agents = [
            { id: "t1", agent: "claude", usage: { account: "a3" } },
            { id: "t2", agent: "claude", usage: {} },
        ];
        expect(agentAccountBadges(agents, identity, "")).toEqual({});
    });

    it("tells Default agents apart by the /login email each started on", () => {
        const agents = [
            { id: "t1", agent: "claude", usage: {}, loginEmail: "me@home.dev" },
            { id: "t2", agent: "claude", usage: {}, loginEmail: "old@home.dev" },
        ];
        const out = agentAccountBadges(agents, identity, "");
        expect(out.t1.text).toBe("me@home.dev");
        expect(out.t2.text).toBe("old@home.dev");
    });
});
