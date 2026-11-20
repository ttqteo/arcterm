// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/app/store/wshclientapi", () => ({
    RpcApi: {
        GetChannelRunsCommand: vi.fn(),
        GetSessionsActivityCommand: vi.fn(),
        GetChannelsCommand: vi.fn(),
        GetChannelMessagesCommand: vi.fn(),
        GetChannelRunChangesCommand: vi.fn(),
        SetChannelReadCommand: vi.fn(),
        CouncilListCommand: vi.fn(),
    },
}));
vi.mock("@/app/store/wshrpcutil", () => ({ TabRpcClient: { client: true } }));
vi.mock("@/app/store/wps", () => ({ waveEventSubscribeSingle: vi.fn(() => () => {}) }));
vi.mock("@/app/store/wos", async () => {
    const { atom } = await import("jotai");
    return {
        getWaveObjectAtom: () => atom(null),
        makeORef: (otype: string, oid: string) => `${otype}:${oid}`,
        loadAndPinWaveObject: vi.fn(),
    };
});

import { globalStore } from "@/app/store/jotaiStore";
import { RpcApi } from "@/app/store/wshclientapi";
import { TabRpcClient } from "@/app/store/wshrpcutil";
import { channelsAtom } from "./channelsstore";
import {
    dropFromProjectSessions,
    loadMoreProjectSessions,
    loadProjectRuns,
    loadProjectSessions,
    PROJECT_SESSIONS_PAGE,
    projectRunsAtom,
    projectSessionList,
    projectSessionsAtom,
} from "./projecthistorystore";

const runsCmd = vi.mocked(RpcApi.GetChannelRunsCommand);
const sessionsCmd = vi.mocked(RpcApi.GetSessionsActivityCommand);

const NOW = 1_800_000_000_000;
const DAY = 86_400_000;

const channel = (oid: string, projectpath: string) => ({ oid, projectpath }) as Channel;
const run = (id: string) => ({ id }) as Run;
const session = (id: string, ago: number, projectpath = "D:/p") =>
    ({
        id,
        runtime: "claude",
        lastactivets: NOW - ago,
        projectpath,
        transcriptpath: `C:\\t\\${id}.jsonl`,
    }) as SessionActivity;

// serves a page per cursor ("" is the first); a page is copied, as the wire gives a fresh array on every read
const servePages = (pages: Record<string, { sessions: SessionActivity[]; nextcursor?: string }>) =>
    sessionsCmd.mockImplementation(async (_client, data) => {
        const page = pages[data.cursor ?? ""] ?? { sessions: [], nextcursor: "" };
        return { ...page, sessions: [...page.sessions] };
    });

// the cursors asked for, in order, with "" for the first page
const asked = () => sessionsCmd.mock.calls.map(([, data]) => data.cursor ?? "");

let pathSeq = 0;
// each test reads its own project, so the atom family's state of another test does not leak in
let P = "";

beforeEach(() => {
    runsCmd.mockReset();
    sessionsCmd.mockReset();
    globalStore.set(channelsAtom, null);
    P = `D:/p${++pathSeq}`;
});

describe("loadProjectRuns", () => {
    it("reads the runs of the channels bound to the path, in any spelling of it, and no other", async () => {
        globalStore.set(channelsAtom, [
            channel("c1", "D:\\p\\"),
            channel("c2", "d:/P"),
            channel("c3", "D:/q"),
            { oid: "c4" } as Channel,
        ]);
        runsCmd.mockImplementation(async (_client, data) => ({
            runs: data.channelid === "c1" ? [run("r1")] : [run("r2"), run("r3")],
        }));

        await loadProjectRuns("D:/p");

        expect(runsCmd.mock.calls.map(([client, data]) => [client, data.channelid])).toEqual([
            [TabRpcClient, "c1"],
            [TabRpcClient, "c2"],
        ]);
        expect(globalStore.get(projectRunsAtom("D:/p"))).toEqual({
            runs: [run("r1"), run("r2"), run("r3")],
            error: null,
        });
    });

    it("holds an empty list, not null, for a project with no channel", async () => {
        globalStore.set(channelsAtom, [channel("c1", "D:/other")]);
        await loadProjectRuns("D:/none");
        expect(runsCmd).not.toHaveBeenCalled();
        expect(globalStore.get(projectRunsAtom("D:/none"))).toEqual({ runs: [], error: null });
    });

    it("keeps the runs read before when a later read fails, and says why", async () => {
        globalStore.set(channelsAtom, [channel("c1", "D:/keep")]);
        runsCmd.mockResolvedValueOnce({ runs: [run("r1")] });
        await loadProjectRuns("D:/keep");
        runsCmd.mockRejectedValueOnce(new Error("wavesrv gone"));
        await loadProjectRuns("D:/keep");
        expect(globalStore.get(projectRunsAtom("D:/keep"))).toEqual({ runs: [run("r1")], error: "wavesrv gone" });

        runsCmd.mockResolvedValueOnce({ runs: [run("r1"), run("r2")] });
        await loadProjectRuns("D:/keep");
        expect(globalStore.get(projectRunsAtom("D:/keep"))).toEqual({ runs: [run("r1"), run("r2")], error: null });
    });

    it("reads a first load that fails as no runs and the error", async () => {
        globalStore.set(channelsAtom, [channel("c1", "D:/first")]);
        runsCmd.mockRejectedValueOnce("plain string");
        await loadProjectRuns("D:/first");
        expect(globalStore.get(projectRunsAtom("D:/first"))).toEqual({ runs: null, error: "plain string" });
    });
});

describe("loadProjectSessions", () => {
    it("asks for one page of the project's own sessions in the window, never the whole archive", async () => {
        servePages({ "": { sessions: [session("a", DAY)], nextcursor: "c1" } });

        await loadProjectSessions(P);

        expect(sessionsCmd).toHaveBeenCalledTimes(1);
        expect(sessionsCmd.mock.calls[0][1]).toEqual({ projectpath: P, windowdays: 7, limit: PROJECT_SESSIONS_PAGE });
        expect(globalStore.get(projectSessionsAtom(P))).toMatchObject({
            sessions: [session("a", DAY)],
            cursor: "c1",
            error: false,
        });
    });

    it("notes when the page that landed was asked for", async () => {
        servePages({ "": { sessions: [session("a", DAY)], nextcursor: "" } });
        const before = Date.now();
        await loadProjectSessions(P);
        const readAt = globalStore.get(projectSessionsAtom(P)).readAt;
        expect(readAt).toBeGreaterThanOrEqual(before);
        expect(readAt).toBeLessThanOrEqual(Date.now());
    });

    it("keeps the older pages read before when it reads the first again", async () => {
        servePages({
            "": { sessions: [session("a", DAY)], nextcursor: "c1" },
            c1: { sessions: [session("b", 2 * DAY)], nextcursor: "c2" },
        });
        await loadProjectSessions(P);
        await loadMoreProjectSessions(P);

        servePages({ "": { sessions: [session("new", 0), session("a", DAY)], nextcursor: "c1" } });
        await loadProjectSessions(P);

        const st = globalStore.get(projectSessionsAtom(P));
        expect(st.sessions?.map((s) => s.id)).toEqual(["new", "a", "b"]);
        expect(st.cursor).toBe("c2");
    });

    it("reads a failed first load as loaded with an error, keeping what was read", async () => {
        sessionsCmd.mockRejectedValueOnce(new Error("scan failed"));
        await loadProjectSessions(P);
        expect(globalStore.get(projectSessionsAtom(P))).toEqual({ sessions: [], cursor: "", error: true, readAt: 0 });

        servePages({ "": { sessions: [session("a", DAY)], nextcursor: "" } });
        await loadProjectSessions(P);
        expect(globalStore.get(projectSessionsAtom(P)).error).toBe(false);
    });
});

describe("loadMoreProjectSessions", () => {
    it("reads the next older page of the project and moves the cursor", async () => {
        servePages({
            "": { sessions: [session("a", DAY)], nextcursor: "c1" },
            c1: { sessions: [session("b", 2 * DAY)], nextcursor: "" },
        });
        await loadProjectSessions(P);
        await loadMoreProjectSessions(P);

        expect(asked()).toEqual(["", "c1"]);
        expect(sessionsCmd.mock.calls[1][1]).toMatchObject({ projectpath: P, cursor: "c1" });
        const st = globalStore.get(projectSessionsAtom(P));
        expect(st.sessions?.map((s) => s.id)).toEqual(["a", "b"]);
        expect(st.cursor).toBe("");
    });

    it("asks nothing before the first page, or once nothing is left", async () => {
        await loadMoreProjectSessions(P);
        expect(sessionsCmd).not.toHaveBeenCalled();

        servePages({ "": { sessions: [session("a", DAY)], nextcursor: "" } });
        await loadProjectSessions(P);
        await loadMoreProjectSessions(P);
        expect(asked()).toEqual([""]);
    });

    it("asks once while a page is being read", async () => {
        servePages({
            "": { sessions: [session("a", DAY)], nextcursor: "c1" },
            c1: { sessions: [session("b", 2 * DAY)], nextcursor: "c2" },
        });
        await loadProjectSessions(P);
        await Promise.all([loadMoreProjectSessions(P), loadMoreProjectSessions(P)]);
        expect(asked()).toEqual(["", "c1"]);
    });

    it("keeps the cursor when the page fails, so a later scroll asks again", async () => {
        servePages({ "": { sessions: [session("a", DAY)], nextcursor: "c1" } });
        await loadProjectSessions(P);
        sessionsCmd.mockRejectedValueOnce(new Error("scan failed"));
        await loadMoreProjectSessions(P);
        expect(globalStore.get(projectSessionsAtom(P)).cursor).toBe("c1");
    });
});

describe("dropFromProjectSessions", () => {
    it("takes the deleted session out of the project's list, in any spelling of its path", async () => {
        servePages({ "": { sessions: [session("a", DAY), session("b", 2 * DAY)], nextcursor: "" } });
        await loadProjectSessions(P);

        dropFromProjectSessions("c:/T/a.jsonl");

        expect(globalStore.get(projectSessionsAtom(P)).sessions?.map((s) => s.id)).toEqual(["b"]);
    });
});

describe("projectSessionList", () => {
    // read a day and a half ago
    const READ_AT = NOW - 1.5 * DAY;
    const state = (sessions: SessionActivity[] | null, cursor = "") => ({
        sessions,
        cursor,
        error: false,
        readAt: READ_AT,
    });

    it("is null while the first page loads", () => {
        expect(projectSessionList(state(null), [session("a", 0)], "D:/p")).toEqual({ sessions: null, frontier: null });
    });

    it("adds the project's sessions the archive holds that were active since the read, the newer copy kept", () => {
        const read = [session("a", 3 * DAY), session("b", 2 * DAY)];
        const archive = [session("a", DAY), session("c", 0), session("x", 0, "D:/other"), session("b", 4 * DAY)];
        const out = projectSessionList(state(read), archive, "d:\\P\\");
        expect(out.frontier).toBeNull();
        expect(Object.fromEntries(out.sessions!.map((s) => [s.id, s.lastactivets]))).toEqual({
            a: NOW - DAY,
            b: NOW - 2 * DAY,
            c: NOW,
        });
    });

    it("leaves out an archive session older than the read, which the read no longer lists", () => {
        const out = projectSessionList(state([session("a", DAY)]), [session("gone", 2 * DAY)], "D:/p");
        expect(out.sessions!.map((s) => s.id)).toEqual(["a"]);
    });

    it("while older pages are unread, the frontier is the oldest session read", () => {
        const read = [session("a", DAY), session("b", 2 * DAY)];
        const out = projectSessionList(state(read, "c1"), [session("c", 3 * DAY), session("d", 0)], "D:/p");
        expect(out.frontier).toBe(NOW - 2 * DAY);
        expect(out.sessions!.map((s) => s.id).sort()).toEqual(["a", "b", "d"]);
    });
});
