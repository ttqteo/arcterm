// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const startNow = vi.fn();
const runNext = vi.fn();
const remove = vi.fn();
const toast = vi.fn();
const pushModal = vi.fn();

vi.mock("@/app/store/wshclientapi", () => ({
    RpcApi: {
        RunQueueStartNowCommand: (...a: any[]) => startNow(...a),
        RunQueueRunNextCommand: (...a: any[]) => runNext(...a),
        RunQueueRemoveCommand: (...a: any[]) => remove(...a),
    },
}));
vi.mock("@/app/store/wshrpcutil", () => ({ TabRpcClient: {} }));
vi.mock("@/app/cockpit/notificationstore", () => ({ pushToast: (...a: any[]) => toast(...a) }));
vi.mock("@/app/store/modalmodel", () => ({ modalsModel: { pushModal: (...a: any[]) => pushModal(...a) } }));

import { globalStore } from "@/app/store/jotaiStore";
import { attachBrainstorm, brainstormsAtom, getBrainstorm, setStartingRun } from "./brainstormstore";
import { brainstormAnswers, brainstormSentAtom } from "./chatbrainstormstore";
import {
    applyQueueChanged,
    confirmRemoveQueued,
    removedEntryIds,
    runQueueAtom,
    runQueuedNext,
    runQueueStartedAtom,
    startedBrainstorms,
    startQueuedNow,
} from "./runqueuestore";

const entry = (over: Partial<RunQueueEntry> = {}): RunQueueEntry => ({
    id: "q-3f2a",
    title: "Learned additions",
    projectpath: "/code/waveterm",
    queuedts: 0,
    state: "waiting",
    data: { channelid: "ch", workspaceid: "ws", goal: "g", runtime: "claude" },
    ...over,
});

afterEach(() => vi.resetAllMocks());

describe("startQueuedNow", () => {
    it("starts the entry by id, with a timeout that outlasts a worktree and a Setup, and says nothing on success", async () => {
        startNow.mockResolvedValue(undefined);
        await startQueuedNow(entry());
        expect(startNow).toHaveBeenCalledWith({}, { id: "q-3f2a" }, { timeout: 10 * 60_000 });
        expect(toast).not.toHaveBeenCalled();
    });

    it("shows the server's refusal to the person instead of swallowing it, while another entry is starting", async () => {
        startNow.mockRejectedValue(new Error("another queued run is starting; try again in a moment"));
        await expect(startQueuedNow(entry())).resolves.toBeUndefined();
        expect(toast).toHaveBeenCalledTimes(1);
        expect(toast.mock.calls[0][0]).toMatchObject({
            title: "Couldn't start Learned additions",
            message: "another queued run is starting; try again in a moment",
            level: "error",
        });
        // it is the person's to retry: nothing else is done to the entry
        expect(remove).not.toHaveBeenCalled();
        expect(runNext).not.toHaveBeenCalled();
    });

    it("shows the error of a start that failed, which the server has already blocked the entry for", async () => {
        startNow.mockRejectedValue(new Error("reading plan: no such file"));
        await startQueuedNow(entry());
        expect(toast.mock.calls[0][0]).toMatchObject({ message: "reading plan: no such file", level: "error" });
    });
});

describe("runQueuedNext", () => {
    it("moves the entry up by id", async () => {
        runNext.mockResolvedValue(undefined);
        await runQueuedNext(entry());
        expect(runNext).toHaveBeenCalledWith({}, { id: "q-3f2a" });
        expect(toast).not.toHaveBeenCalled();
    });

    it("shows why it could not", async () => {
        runNext.mockRejectedValue(new Error("no such queued entry: q-3f2a"));
        await runQueuedNext(entry());
        expect(toast.mock.calls[0][0]).toMatchObject({
            title: "Couldn't move Learned additions up",
            message: "no such queued entry: q-3f2a",
            level: "error",
        });
    });
});

describe("confirmRemoveQueued", () => {
    const modal = () =>
        pushModal.mock.calls[0][1] as { title: string; message: string; destructive: boolean; onConfirm: () => void };

    it("asks first, naming the entry, and removes nothing until the person confirms", () => {
        confirmRemoveQueued(entry());
        expect(pushModal).toHaveBeenCalledTimes(1);
        expect(pushModal.mock.calls[0][0]).toBe("ConfirmModal");
        expect(modal().message).toContain("Learned additions");
        expect(modal().destructive).toBe(true);
        expect(remove).not.toHaveBeenCalled();
    });

    it("removes the entry by id on confirm", async () => {
        remove.mockResolvedValue(undefined);
        confirmRemoveQueued(entry());
        modal().onConfirm();
        await vi.waitFor(() => expect(remove).toHaveBeenCalledWith({}, { id: "q-3f2a" }));
        expect(toast).not.toHaveBeenCalled();
    });

    it("shows why a removal failed", async () => {
        remove.mockRejectedValue(new Error("no such queued entry: q-3f2a"));
        confirmRemoveQueued(entry());
        modal().onConfirm();
        await vi.waitFor(() => expect(toast).toHaveBeenCalled());
        expect(toast.mock.calls[0][0]).toMatchObject({ title: "Couldn't remove Learned additions", level: "error" });
    });
});

describe("startedBrainstorms", () => {
    const withBrainstorm = entry({ id: "q-1", brainstorm: { tab: "a1", path: "/p/brainstorm.json" } });

    it("finds the brainstorm each started entry carried, in the list held before the event", () => {
        expect(startedBrainstorms([entry({ id: "q-0" }), withBrainstorm], [{ entryid: "q-1", runid: "r-9" }])).toEqual([
            { tab: "a1", path: "/p/brainstorm.json", runId: "r-9" },
        ]);
    });

    it("leaves out a started entry with no brainstorm, one the list never held, and an empty tab", () => {
        const started = [
            { entryid: "q-0", runid: "r-1" },
            { entryid: "q-gone", runid: "r-2" },
            { entryid: "q-2", runid: "r-3" },
        ];
        const noTab = entry({ id: "q-2", brainstorm: { tab: "", path: "/p/b.json" } });
        expect(startedBrainstorms([entry({ id: "q-0" }), noTab], started)).toEqual([]);
        expect(startedBrainstorms([withBrainstorm], undefined)).toEqual([]);
    });
});

describe("removedEntryIds", () => {
    it("holds the entries that left the list with no run made of them", () => {
        const before = [entry({ id: "q-1" }), entry({ id: "q-2" }), entry({ id: "q-3" })];
        const after = [entry({ id: "q-3" })];
        expect([...removedEntryIds(before, after, { "q-2": "r-2" })]).toEqual(["q-1"]);
    });

    it("holds nothing for an entry the list never held", () => {
        expect(removedEntryIds([], [entry({ id: "q-1" })], {}).size).toBe(0);
    });
});

describe("applyQueueChanged: a brainstorm that queued its run", () => {
    const TAB = "a1";
    const path = () => getBrainstorm(TAB)!.path;
    const queued = (over: Partial<RunQueueEntry> = {}) =>
        entry({ id: "q-1", brainstorm: { tab: TAB, path: path() }, ...over });

    beforeEach(() => {
        attachBrainstorm(TAB, { topic: "lag", cwd: "/p" }, 0);
        setStartingRun(TAB, path(), { runId: null, entryId: "q-1" });
    });

    afterEach(() => {
        globalStore.set(runQueueAtom, []);
        globalStore.set(runQueueStartedAtom, {});
        globalStore.set(brainstormsAtom, {});
        globalStore.set(brainstormSentAtom, {});
    });

    it("keeps the list, and the run each started entry became", () => {
        applyQueueChanged({ entries: [queued()] });
        expect(globalStore.get(runQueueAtom).map((e) => e.id)).toEqual(["q-1"]);
        applyQueueChanged({ entries: [], started: [{ entryid: "q-1", runid: "r-9" }] });
        expect(globalStore.get(runQueueAtom)).toEqual([]);
        expect(globalStore.get(runQueueStartedAtom)).toEqual({ "q-1": "r-9" });
    });

    it("records a run answer for the agent when its entry starts, so Chat pairs the server's line with it", () => {
        applyQueueChanged({ entries: [queued()] });
        applyQueueChanged({ entries: [], started: [{ entryid: "q-1", runid: "r-9" }] }, 5000);
        expect(brainstormAnswers(TAB)).toEqual([
            {
                topic: "lag",
                n: 0,
                part: "",
                text: "brainstorm: run r-9",
                sentAt: 5000,
                seen: 0,
                kind: "run",
                runId: "r-9",
            },
        ]);
    });

    it("records it once, however many feeds hear the event", () => {
        applyQueueChanged({ entries: [queued()] });
        const started = { entries: [], started: [{ entryid: "q-1", runid: "r-9" }] };
        applyQueueChanged(started, 5000);
        // a second mounted feed finds the entry gone from the list it holds, and the record already there
        applyQueueChanged(started, 5001);
        expect(brainstormAnswers(TAB)).toHaveLength(1);
        // the same event heard against a list that still holds the entry is no second record either
        globalStore.set(runQueueAtom, [queued()]);
        applyQueueChanged(started, 5002);
        expect(brainstormAnswers(TAB)).toHaveLength(1);
    });

    it("records nothing for an entry with no brainstorm, or a brainstorm attached in the approved one's place", () => {
        applyQueueChanged({ entries: [entry({ id: "q-1" })] });
        applyQueueChanged({ entries: [], started: [{ entryid: "q-1", runid: "r-9" }] });
        expect(brainstormAnswers(TAB)).toEqual([]);
        globalStore.set(runQueueAtom, [queued()]);
        attachBrainstorm(TAB, { topic: "other", cwd: "/p" }, 0);
        applyQueueChanged({ entries: [], started: [{ entryid: "q-1", runid: "r-9" }] });
        expect(brainstormAnswers(TAB)).toEqual([]);
    });

    it("records nothing for an agent with no brainstorm attached", () => {
        const attached = path();
        globalStore.set(brainstormsAtom, {});
        applyQueueChanged({ entries: [entry({ id: "q-1", brainstorm: { tab: TAB, path: attached } })] });
        applyQueueChanged({ entries: [], started: [{ entryid: "q-1", runid: "r-9" }] });
        expect(brainstormAnswers(TAB)).toEqual([]);
    });

    it("clears the start mark of an entry that was removed without starting, which turns Approve back on", () => {
        applyQueueChanged({ entries: [queued()] });
        expect(getBrainstorm(TAB)!.starting).toEqual({ runId: null, entryId: "q-1" });
        applyQueueChanged({ entries: [] });
        expect(getBrainstorm(TAB)!.starting).toBeNull();
        expect(brainstormAnswers(TAB)).toEqual([]);
    });

    it("keeps the mark of a started entry, which still reads the run it became", () => {
        applyQueueChanged({ entries: [queued()] });
        applyQueueChanged({ entries: [], started: [{ entryid: "q-1", runid: "r-9" }] });
        expect(getBrainstorm(TAB)!.starting).toEqual({ runId: null, entryId: "q-1" });
    });

    it("keeps the mark while the entry is not in a list yet, and the launcher's own mark always", () => {
        // the launcher handed the entry back before the event that lists it
        applyQueueChanged({ entries: [] });
        expect(getBrainstorm(TAB)!.starting).toEqual({ runId: null, entryId: "q-1" });
        setStartingRun(TAB, path(), { runId: null });
        applyQueueChanged({ entries: [queued()] });
        applyQueueChanged({ entries: [] });
        expect(getBrainstorm(TAB)!.starting).toEqual({ runId: null });
    });
});
