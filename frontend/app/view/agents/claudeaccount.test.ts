// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { describe, expect, it } from "vitest";
import type { AgentVM } from "./agentsviewmodel";
import {
    addAccountStep,
    defaultAccountName,
    knownClaudeEmails,
    quotaLine,
    restartCandidates,
    rowQuota,
} from "./claudeaccount";

describe("restartCandidates", () => {
    it("lists resumable claude agents not on the new account; idle pre-checked, working and asking not", () => {
        const base = { agent: "claude", task: "", usage: {} };
        const agents = [
            { ...base, id: "t1", name: "loom", state: "idle", blockId: "b1", transcriptPath: "/p/s1.jsonl" },
            { ...base, id: "t2", name: "kite", state: "working", blockId: "b2", transcriptPath: "/p/s2.jsonl" },
            { ...base, id: "t6", name: "fern", state: "asking", blockId: "b6", transcriptPath: "/p/s6.jsonl" },
            {
                ...base,
                id: "t3",
                name: "on-a1",
                state: "idle",
                blockId: "b3",
                transcriptPath: "/p/s3.jsonl",
                usage: { account: "a1" },
            },
            {
                ...base,
                id: "t4",
                name: "codex",
                agent: "codex",
                state: "idle",
                blockId: "b4",
                transcriptPath: "/p/s4.jsonl",
            },
            { ...base, id: "t5", name: "no-transcript", state: "idle", blockId: "b5" },
            { ...base, id: "t7", name: "no-block", state: "idle", transcriptPath: "/p/s7.jsonl" },
            {
                ...base,
                id: "t8",
                name: "bg",
                kind: "background",
                state: "idle",
                blockId: "b8",
                transcriptPath: "/p/s8.jsonl",
            },
            {
                ...base,
                id: "t9",
                name: "shell",
                kind: "terminal",
                state: "idle",
                blockId: "b9",
                transcriptPath: "/p/s9.jsonl",
            },
        ] as AgentVM[];
        expect(restartCandidates(agents, "a1")).toEqual([
            { tabId: "t1", blockId: "b1", name: "loom", sessionId: "s1", checked: true, state: "idle" },
            { tabId: "t2", blockId: "b2", name: "kite", sessionId: "s2", checked: false, state: "working" },
            { tabId: "t6", blockId: "b6", name: "fern", sessionId: "s6", checked: false, state: "asking" },
        ]);
    });

    it("treats a missing usage.account as Default", () => {
        const a = {
            id: "t1",
            name: "loom",
            task: "",
            agent: "claude",
            state: "idle",
            blockId: "b1",
            transcriptPath: "/p/s1.jsonl",
        } as AgentVM;
        expect(restartCandidates([a], "")).toEqual([]);
        expect(restartCandidates([a], "a1")).toHaveLength(1);
    });
});

describe("rowQuota", () => {
    const now = 10 * 60 * 60 * 1000;

    it("null when the account was never used", () => {
        expect(rowQuota({}, "claude:a1", now)).toBeNull();
    });

    it("reads a current snapshot", () => {
        const saved = { "claude:a1": { capturedAt: now - 60_000, fivehourpct: 97, weekpct: 40 } };
        expect(rowQuota(saved, "claude:a1", now)).toEqual({ fivehourpct: 97, weekpct: 40, capturedAt: now - 60_000 });
    });

    it("a window past its reset reads 0", () => {
        const saved = {
            "claude:default": {
                capturedAt: now - 60_000,
                fivehourpct: 97,
                fivehourreset: (now - 1000) / 1000,
                weekpct: 40,
            },
        };
        expect(rowQuota(saved, "claude:default", now)).toEqual({
            fivehourpct: 0,
            weekpct: 40,
            capturedAt: now - 60_000,
        });
    });
});

describe("rowQuota by email key", () => {
    const now = 10 * 60 * 60 * 1000;

    it("reads the snapshot saved under an email, with its age", () => {
        const saved = { "claude:mozox@example.com": { capturedAt: now - 3_600_000, fivehourpct: 100, weekpct: 62 } };
        expect(rowQuota(saved, "claude:mozox@example.com", now)).toEqual({
            fivehourpct: 100,
            weekpct: 62,
            capturedAt: now - 3_600_000,
        });
    });

    it("rolls a window over once its reset has passed", () => {
        const saved = {
            "claude:mozox@example.com": {
                capturedAt: now - 3_600_000,
                fivehourpct: 100,
                fivehourreset: (now - 1000) / 1000,
                weekpct: 62,
            },
        };
        expect(rowQuota(saved, "claude:mozox@example.com", now)?.fivehourpct).toBe(0);
    });
});

describe("knownClaudeEmails", () => {
    const snap = { capturedAt: 1, fivehourpct: 1 };

    it("is the login email plus every email a snapshot was saved under, sorted, without duplicates", () => {
        const saved = {
            "claude:zed@x.io": snap,
            "claude:me@x.io": snap,
            "claude:default": snap,
            "claude:a1b2c3d4": snap,
            codex: snap,
            "codex:odd@x.io": snap,
        };
        expect(knownClaudeEmails(saved, { loginEmail: "Me@x.io", accounts: [] })).toEqual(["me@x.io", "zed@x.io"]);
    });

    it("is empty when nothing is known", () => {
        expect(knownClaudeEmails({}, { loginEmail: "", accounts: [] })).toEqual([]);
    });
});

describe("defaultAccountName", () => {
    it("names Default by its /login email, else Claude login", () => {
        expect(defaultAccountName("quang.tt@mozox.com")).toBe("quang.tt@mozox.com");
        expect(defaultAccountName(undefined)).toBe("Claude login");
        expect(defaultAccountName("  ")).toBe("Claude login");
    });
});

describe("quotaLine", () => {
    const now = 1_000_000;
    it("reads 5h, week and age, and warns at 90% or more in either window", () => {
        expect(quotaLine({ fivehourpct: 54, weekpct: 99, capturedAt: now - 60_000 }, now)).toEqual({
            text: "5h 54% · week 99% · 1m ago",
            warn: true,
        });
        expect(quotaLine({ fivehourpct: 36.4, weekpct: 58, capturedAt: now - 5_000 }, now)).toEqual({
            text: "5h 36% · week 58% · <1m ago",
            warn: false,
        });
    });
    it("says Not used yet without a snapshot, and — for a missing window", () => {
        expect(quotaLine(null, now)).toEqual({ text: "Not used yet", warn: false });
        expect(quotaLine({ fivehourpct: undefined, weekpct: 91, capturedAt: now }, now).text).toBe(
            "5h — · week 91% · <1m ago"
        );
    });
});

describe("addAccountStep", () => {
    const acct = { id: "a1", label: "Account 2" } as ClaudeAccountData;
    it("starts on sign-in, opens paste, and goes back", () => {
        let s = addAccountStep(undefined, { type: "init" });
        expect(s).toEqual({ kind: "signin" });
        s = addAccountStep(s, { type: "paste" });
        expect(s).toEqual({ kind: "paste", busy: false, error: null });
        expect(addAccountStep(s, { type: "back" })).toEqual({ kind: "signin" });
    });
    it("keeps a refused token on the paste screen with its reason, and names an accepted one", () => {
        let s = addAccountStep({ kind: "paste", busy: false, error: null }, { type: "saving" });
        expect(s).toEqual({ kind: "paste", busy: true, error: null });
        s = addAccountStep(s, { type: "refused", message: "token refused (401)" });
        expect(s).toEqual({ kind: "paste", busy: false, error: "token refused (401)" });
        expect(addAccountStep(s, { type: "added", account: acct })).toEqual({ kind: "name", account: acct });
    });
    it("goes from sign-in to name when the printed token is stored, or to error when storing fails", () => {
        expect(addAccountStep({ kind: "signin" }, { type: "added", account: acct })).toEqual({
            kind: "name",
            account: acct,
        });
        expect(addAccountStep({ kind: "signin" }, { type: "failed", message: "boom" })).toEqual({
            kind: "error",
            message: "boom",
        });
    });
});
