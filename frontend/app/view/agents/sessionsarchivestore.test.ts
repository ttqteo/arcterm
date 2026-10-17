// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { globalStore } from "@/app/store/jotaiStore";
import { RpcApi } from "@/app/store/wshclientapi";
import { describe, expect, it, vi } from "vitest";
import type { AgentVM } from "./agentsviewmodel";
import {
    filterByStatus,
    groupByRecency,
    loadSessionsArchive,
    mergedFeed,
    overlayLive,
    resolveSelectedSession,
    sessionHolder,
    sessionsArchiveAtom,
    sessionsErrorAtom,
    storedSessionHolders,
    totalEvents,
    type StoredAgentBlock,
} from "./sessionsarchivestore";

vi.mock("@/app/store/wshclientapi", () => ({ RpcApi: { GetSessionsActivityCommand: vi.fn() } }));

const ev = (type: string, ts: number, text = ""): SessionEvent => ({ type, ts, text });

const mk = (over: Partial<SessionActivity> = {}): SessionActivity => ({
    id: "x",
    runtime: "claude",
    projectpath: "/p",
    projectname: "proj",
    branch: "main",
    task: "do the thing",
    model: "claude",
    tokenstotal: 0,
    lastactivets: 0,
    resumecommand: "claude --resume x",
    transcriptpath: "/home/me/.claude/projects/p/x.jsonl",
    status: "done",
    startedts: 0,
    durationms: 0,
    events: [ev("started", 1), ev("finished", 2)],
    ...over,
});

const mkAgent = (over: Partial<AgentVM> = {}): AgentVM =>
    ({ id: "t1", state: "working", transcriptPath: "/home/me/.claude/projects/p/x.jsonl", ...over }) as AgentVM;

describe("overlayLive", () => {
    it("flags a session live when its transcript path matches a roster agent, stripping finished", () => {
        const [s] = overlayLive([mk()], [mkAgent()], 1000);
        expect(s.live).toBe(true);
        expect(s.liveId).toBe("t1");
        expect(s.events.some((e) => e.type === "finished")).toBe(false);
    });
    it("marks needsAttention for a live asking agent", () => {
        const [s] = overlayLive([mk()], [mkAgent({ state: "asking" })], 1000);
        expect(s.needsAttention).toBe(true);
    });
    it("marks needsAttention for an ended waiting session", () => {
        const [s] = overlayLive([mk({ status: "waiting" })], [], 1000);
        expect(s.live).toBe(false);
        expect(s.needsAttention).toBe(true);
    });
});

describe("sessionHolder", () => {
    it("finds the agent whose tab holds the transcript, asleep or awake, whatever the path's case or separators", () => {
        const asleep = mkAgent({ id: "t2", state: "idle", sleeping: { since: 1, freedBytes: 0 } });
        const roster = [mkAgent({ transcriptPath: "/other.jsonl" }), asleep];
        expect(sessionHolder(roster, "/HOME/me/.claude/projects/p/x.jsonl")?.id).toBe("t2");
        expect(sessionHolder([mkAgent()], "\\home\\me\\.claude\\projects\\p\\x.jsonl")?.id).toBe("t1");
    });
    it("finds none for a transcript no tab holds, or no transcript", () => {
        expect(sessionHolder([mkAgent()], "/home/me/.claude/projects/p/y.jsonl")).toBeUndefined();
        expect(sessionHolder([mkAgent({ transcriptPath: undefined })], "")).toBeUndefined();
        expect(sessionHolder([mkAgent()], undefined)).toBeUndefined();
    });
});

describe("storedSessionHolders", () => {
    const path = "/Users/me/.claude/projects/-p/s1.jsonl";
    const block = (meta: Record<string, unknown>, tabId = "t1"): StoredAgentBlock => ({
        tabId,
        name: "p",
        blockId: `b-${tabId}`,
        meta: { controller: "cmd", cmd: "claude", ...meta },
    });
    it("finds a block by the transcript its hooks stamped, whatever the path's case or separators", () => {
        const blocks = [
            block({ "agent:transcriptpath": "/other.jsonl" }),
            block({ "agent:transcriptpath": path }, "t2"),
        ];
        expect(storedSessionHolders(blocks, path.toUpperCase()).map((b) => b.tabId)).toEqual(["t2"]);
        expect(storedSessionHolders(blocks, path.replace(/\//g, "\\")).map((b) => b.tabId)).toEqual(["t2"]);
    });
    it("finds a block by the session its cmd:args resume, before a hook stamped it (an agent brought back at boot)", () => {
        const blocks = [block({ "cmd:args": ["--resume", "s1", "--model", "opus"] })];
        expect(storedSessionHolders(blocks, path).map((b) => b.tabId)).toEqual(["t1"]);
    });
    it("finds a pi block by the transcript path its --session takes", () => {
        const pi = "/Users/me/.pi/agent/sessions/x/2026_s1.jsonl";
        const blocks = [block({ cmd: "pi", "cmd:args": ["--session", pi] })];
        expect(storedSessionHolders(blocks, pi).map((b) => b.tabId)).toEqual(["t1"]);
    });
    it("finds none for a plain terminal, another session, a bare --resume, or no transcript", () => {
        const blocks = [
            block({ controller: "shell", "agent:transcriptpath": path }),
            block({ "cmd:args": ["--resume", "s2"] }, "t2"),
            block({ "cmd:args": ["--resume", "--settings", "s1"] }, "t3"),
            block({ cmd: "bash", "cmd:args": ["--resume", "s1"] }, "t4"),
        ];
        expect(storedSessionHolders(blocks, path)).toEqual([]);
        expect(storedSessionHolders([block({ "agent:transcriptpath": path })], undefined)).toEqual([]);
    });
});

describe("session filters and selection", () => {
    const list = overlayLive(
        [
            mk({ id: "a", projectname: "alpha", status: "done", transcriptpath: "/other.jsonl" }),
            mk({ id: "b", projectname: "beta", status: "waiting", transcriptpath: "/nope.jsonl" }),
            mk({ id: "c", projectname: "alpha" }), // live (matches mkAgent path)
        ],
        [mkAgent()],
        1000
    );

    it("live keeps only live sessions", () => {
        expect(filterByStatus(list, "live").map((s) => s.id)).toEqual(["c"]);
    });

    it("done excludes live and non-done", () => {
        expect(filterByStatus(list, "done").map((s) => s.id)).toEqual(["a"]);
    });

    it("needs keeps waiting/asking", () => {
        expect(filterByStatus(list, "needs").map((s) => s.id)).toEqual(["b"]);
    });

    it("resolves an explicit detail selection from the unfiltered set", () => {
        const shown = filterByStatus(list, "done");
        expect(shown.map((s) => s.id)).not.toContain("b");
        expect(resolveSelectedSession(list, "claude:b")?.id).toBe("b");
        expect(resolveSelectedSession(list, "all")).toBeUndefined();
    });
});

describe("groupByRecency", () => {
    it("splits into live / today / earlier and drops empties", () => {
        const now = new Date("2026-07-10T12:00:00Z").getTime();
        const startToday = new Date("2026-07-10T01:00:00Z").getTime();
        const yesterday = new Date("2026-07-09T12:00:00Z").getTime();
        const list = overlayLive(
            [
                mk({ id: "live", transcriptpath: "/home/me/.claude/projects/p/x.jsonl" }),
                mk({ id: "today", lastactivets: startToday, transcriptpath: "/t.jsonl" }),
                mk({ id: "old", lastactivets: yesterday, transcriptpath: "/o.jsonl" }),
            ],
            [mkAgent()],
            now
        );
        const groups = groupByRecency(list, now);
        expect(groups.map((g) => g.key)).toEqual(["live", "today", "earlier"]);
        expect(groups[0].items.map((s) => s.id)).toEqual(["live"]);
    });
});

describe("mergedFeed + totalEvents", () => {
    it("interleaves events newest-first with session context", () => {
        const list = overlayLive(
            [mk({ id: "a", task: "A task", events: [ev("started", 10, "a-start")] }, ), mk({ id: "b", task: "B task", transcriptpath: "/b.jsonl", events: [ev("committed", 20, "b-commit")] })],
            [],
            1000
        );
        const feed = mergedFeed(list);
        expect(feed[0].ts).toBe(20);
        expect(feed[0].sessionTitle).toBe("B task");
        expect(totalEvents(list)).toBe(2);
    });
});

describe("loadSessionsArchive", () => {
    it("runs once more when a refresh was asked for during a scan, however many were", async () => {
        const scan = vi.mocked(RpcApi.GetSessionsActivityCommand);
        scan.mockReset();
        let finishFirst!: () => void;
        scan.mockImplementationOnce(
            () => new Promise((resolve) => (finishFirst = () => resolve({ sessions: [] }))) as ReturnType<typeof scan>
        );
        scan.mockResolvedValue({ sessions: [mk()] });

        const first = loadSessionsArchive();
        // an agent exits mid-scan: the scan under way may have read its transcript before it ended
        await loadSessionsArchive();
        await loadSessionsArchive();
        expect(scan).toHaveBeenCalledTimes(1);

        finishFirst();
        await first;
        expect(scan).toHaveBeenCalledTimes(2);
        await vi.waitFor(() => expect(globalStore.get(sessionsArchiveAtom)).toHaveLength(1));
        // nothing was asked for during the second scan, so it does not go round again
        await new Promise((resolve) => setTimeout(resolve, 0));
        expect(scan).toHaveBeenCalledTimes(2);
    });

    it("runs once more after a failed scan too, keeping the last good data and flagging the error", async () => {
        const scan = vi.mocked(RpcApi.GetSessionsActivityCommand);
        scan.mockReset();
        const good = [mk({ id: "good" })];
        globalStore.set(sessionsArchiveAtom, good);
        globalStore.set(sessionsErrorAtom, false);
        let failFirst!: () => void;
        const firstScan = new Promise<never>((_, reject) => (failFirst = () => reject(new Error("scan failed"))));
        scan.mockImplementationOnce(() => firstScan);
        scan.mockRejectedValue(new Error("scan failed"));

        const first = loadSessionsArchive();
        await loadSessionsArchive();
        failFirst();
        await first;
        expect(scan).toHaveBeenCalledTimes(2);
        // the second scan fails as well and nothing was asked for during it: it stops there
        await new Promise((resolve) => setTimeout(resolve, 0));
        expect(scan).toHaveBeenCalledTimes(2);
        expect(globalStore.get(sessionsArchiveAtom)).toBe(good);
        expect(globalStore.get(sessionsErrorAtom)).toBe(true);
    });
});
