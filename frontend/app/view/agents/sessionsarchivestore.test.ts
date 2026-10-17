// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { globalStore } from "@/app/store/jotaiStore";
import { RpcApi } from "@/app/store/wshclientapi";
import { describe, expect, it, vi } from "vitest";
import type { AgentVM } from "./agentsviewmodel";
import {
    dropFromArchive,
    filterByStatus,
    groupByRecency,
    loadMoreSessionsArchive,
    loadSessionsArchive,
    mergedFeed,
    mergeFreshPage,
    overlayLive,
    paletteSessions,
    resolveSelectedSession,
    sessionHolder,
    sessionsArchiveAtom,
    sessionsCursorAtom,
    sessionsErrorAtom,
    sessionsLoadingMoreAtom,
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

const at = (id: string, ts: number, over: Partial<SessionActivity> = {}) =>
    mk({ id, lastactivets: ts, transcriptpath: `/t/${id}.jsonl`, ...over });

describe("loadSessionsArchive paging", () => {
    it("asks for one page of 100, with no day window and no cursor", async () => {
        const scan = vi.mocked(RpcApi.GetSessionsActivityCommand);
        scan.mockReset();
        scan.mockResolvedValue({ sessions: [at("a", 5)], nextcursor: "c1" });
        globalStore.set(sessionsArchiveAtom, null);
        globalStore.set(sessionsCursorAtom, "");
        await loadSessionsArchive();
        expect(scan).toHaveBeenCalledTimes(1);
        expect(scan.mock.calls[0][1]).toEqual({ limit: 100 });
        expect(globalStore.get(sessionsCursorAtom)).toBe("c1");
        expect(globalStore.get(sessionsArchiveAtom)?.map((s) => s.id)).toEqual(["a"]);
    });
    it("keeps the older pages a refresh does not re-read", async () => {
        const scan = vi.mocked(RpcApi.GetSessionsActivityCommand);
        scan.mockReset();
        globalStore.set(sessionsArchiveAtom, [at("a", 50), at("b", 40), at("c", 10)]);
        globalStore.set(sessionsCursorAtom, "deep");
        scan.mockResolvedValue({ sessions: [at("b", 60), at("a", 50)], nextcursor: "shallow" });
        await loadSessionsArchive();
        expect(globalStore.get(sessionsArchiveAtom)?.map((s) => s.id)).toEqual(["b", "a", "c"]);
        expect(globalStore.get(sessionsCursorAtom)).toBe("deep");
    });
});

describe("mergeFreshPage", () => {
    const ids = (list: SessionActivity[]) => list.map((s) => s.id);
    it("lists every session once, the one that moved up first, and keeps the deeper cursor", () => {
        const kept = [at("a", 90), at("b", 80), at("c", 70), at("d", 60), at("e", 50), at("f", 40)];
        const fresh = [at("e", 100), at("a", 90), at("b", 80)];
        const merged = mergeFreshPage(fresh, "fresh", kept, "deep");
        expect(ids(merged.sessions)).toEqual(["e", "a", "b", "c", "d", "f"]);
        expect(merged.cursor).toBe("deep");
    });
    it("takes the fresh cursor when nothing older is kept", () => {
        const kept = [at("a", 90), at("b", 80)];
        const fresh = [at("b", 100), at("a", 90), at("n", 85)];
        const merged = mergeFreshPage(fresh, "fresh", kept, "deep");
        expect(ids(merged.sessions)).toEqual(["b", "a", "n"]);
        expect(merged.cursor).toBe("fresh");
        expect(mergeFreshPage(fresh, "fresh", [], "").cursor).toBe("fresh");
    });
    it("drops a kept session newer than the fresh page's oldest that it no longer lists (deleted)", () => {
        const kept = [at("a", 90), at("gone", 85), at("b", 80), at("c", 70)];
        const merged = mergeFreshPage([at("a", 90), at("b", 80)], "fresh", kept, "deep");
        expect(ids(merged.sessions)).toEqual(["a", "b", "c"]);
    });
    it("tells sessions of two runtimes with one id apart", () => {
        const kept = [at("x", 50, { runtime: "pi" })];
        const merged = mergeFreshPage([at("x", 60)], "fresh", kept, "deep");
        expect(merged.sessions.map((s) => `${s.runtime}:${s.id}`)).toEqual(["claude:x", "pi:x"]);
    });
});

describe("loadMoreSessionsArchive", () => {
    const scan = vi.mocked(RpcApi.GetSessionsActivityCommand);
    const reset = (cursor: string) => {
        scan.mockReset();
        globalStore.set(sessionsArchiveAtom, [at("a", 90)]);
        globalStore.set(sessionsCursorAtom, cursor);
        globalStore.set(sessionsLoadingMoreAtom, false);
    };
    it("sends the stored cursor and appends the page, skipping a session already listed", async () => {
        reset("c1");
        scan.mockResolvedValue({ sessions: [at("a", 90), at("b", 80)], nextcursor: "c2" });
        await loadMoreSessionsArchive();
        expect(scan.mock.calls[0][1]).toEqual({ limit: 100, cursor: "c1" });
        expect(globalStore.get(sessionsArchiveAtom)?.map((s) => s.id)).toEqual(["a", "b"]);
        expect(globalStore.get(sessionsCursorAtom)).toBe("c2");
        expect(globalStore.get(sessionsLoadingMoreAtom)).toBe(false);
    });
    it("sends nothing while a page is pending", async () => {
        reset("c1");
        let finish!: () => void;
        scan.mockImplementationOnce(
            () => new Promise((resolve) => (finish = () => resolve({ sessions: [], nextcursor: "" }))) as ReturnType<typeof scan>
        );
        const first = loadMoreSessionsArchive();
        expect(globalStore.get(sessionsLoadingMoreAtom)).toBe(true);
        await loadMoreSessionsArchive();
        await loadMoreSessionsArchive();
        expect(scan).toHaveBeenCalledTimes(1);
        finish();
        await first;
        expect(globalStore.get(sessionsLoadingMoreAtom)).toBe(false);
    });
    it("ends for good on an empty last page with cursor '': the refill asking again sends nothing", async () => {
        reset("c1");
        scan.mockResolvedValue({ sessions: [], nextcursor: "" });
        await loadMoreSessionsArchive();
        expect(scan).toHaveBeenCalledTimes(1);
        expect(globalStore.get(sessionsCursorAtom)).toBe("");
        await loadMoreSessionsArchive();
        await loadMoreSessionsArchive();
        expect(scan).toHaveBeenCalledTimes(1);
    });
    it("sends nothing before the first page has loaded", async () => {
        reset("c1");
        globalStore.set(sessionsArchiveAtom, null);
        await loadMoreSessionsArchive();
        expect(scan).not.toHaveBeenCalled();
    });
    it("keeps the rows and the cursor when a page fails, so a later scroll retries", async () => {
        reset("c1");
        scan.mockRejectedValueOnce(new Error("scan failed"));
        await loadMoreSessionsArchive();
        expect(globalStore.get(sessionsArchiveAtom)?.map((s) => s.id)).toEqual(["a"]);
        expect(globalStore.get(sessionsCursorAtom)).toBe("c1");
        expect(globalStore.get(sessionsLoadingMoreAtom)).toBe(false);
    });
});

describe("dropFromArchive", () => {
    it("removes the row of that transcript, whatever the path's case or separators", () => {
        globalStore.set(sessionsArchiveAtom, [at("a", 3), at("b", 2), at("c", 1)]);
        dropFromArchive("\\T\\B.jsonl");
        expect(globalStore.get(sessionsArchiveAtom)?.map((s) => s.id)).toEqual(["a", "c"]);
        dropFromArchive("");
        expect(globalStore.get(sessionsArchiveAtom)?.map((s) => s.id)).toEqual(["a", "c"]);
    });
});

describe("paletteSessions", () => {
    it("keeps a session with no role and a lead; drops workers, reviewers, stage roles and the unresumable", () => {
        const list = [
            at("none", 1),
            at("lead", 2, { role: "lead" }),
            at("worker", 3, { role: "worker" }),
            at("review", 4, { role: "review" }),
            at("verifier", 5, { role: "verifier" }),
            at("plan", 6, { role: "plan-reviewer" }),
            at("norc", 7, { resumecommand: "" }),
        ];
        expect(paletteSessions(list).map((s) => s.id)).toEqual(["none", "lead"]);
    });
});
