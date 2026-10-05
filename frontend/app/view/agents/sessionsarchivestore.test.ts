// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { globalStore } from "@/app/store/jotaiStore";
import { RpcApi } from "@/app/store/wshclientapi";
import { describe, expect, it, vi } from "vitest";
import type { AgentVM } from "./agentsviewmodel";
import {
    filterByProject,
    filterByStatus,
    groupByRecency,
    loadSessionsArchive,
    mergedFeed,
    overlayLive,
    resolveSelectedSession,
    sessionsArchiveAtom,
    sessionsErrorAtom,
    totalEvents,
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

    it("filters by the session's existing project name", () => {
        expect(filterByProject(list, "alpha").map((s) => s.id)).toEqual(["a", "c"]);
        expect(filterByProject(list, "all")).toBe(list);
    });

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
        const shown = filterByProject(list, "alpha");
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
