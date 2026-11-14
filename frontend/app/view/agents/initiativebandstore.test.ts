// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0
//
// The initiative band's stores (initiativebandstore.ts, chatsuggeststore.ts's markChunkDone): the two writes of a chunk
// switch and its rollback, the switched line it queues, Mark done carrying the agent to the chunk it woke, and the
// band's open state in localStorage. RpcApi is mocked the way jarvis/effortstore.test.ts does.

import { beforeEach, describe, expect, it, vi } from "vitest";

const rpc = vi.hoisted(() => ({
    EffortMutateCommand: vi.fn(),
    EffortGetCommand: vi.fn(),
    EffortListCommand: vi.fn(async () => ({ efforts: [] })),
}));
const ls = vi.hoisted(() => {
    const store = new Map<string, string>();
    const mock = {
        store,
        failWrites: false,
        getItem: (k: string) => (store.has(k) ? store.get(k)! : null),
        setItem: (k: string, v: string) => {
            if (mock.failWrites) {
                throw new Error("storage denied");
            }
            store.set(k, v);
        },
        removeItem: (k: string) => void store.delete(k),
        clear: () => store.clear(),
    };
    (globalThis as any).localStorage = mock;
    // the DEV hook reads window.__initiativeSwitchFail
    (globalThis as any).window = { localStorage: mock };
    return mock;
});

vi.mock("@/app/store/wshclientapi", () => ({ RpcApi: rpc }));
vi.mock("@/app/store/wshrpcutil", () => ({ TabRpcClient: {} }));
vi.mock("@/app/cockpit/notificationstore", () => ({ pushToast: vi.fn() }));
vi.mock("@/app/view/jarvis/briefingstore", async () => {
    const { atom } = await import("jotai");
    return {
        loadBriefingAsync: async () => {},
        stateRpcTimeoutMs: 1000,
        briefingStateAtom: atom({ snapshot: null, loading: false, error: null }),
    };
});

import { globalStore } from "@/app/store/jotaiStore";
import { effortDetailAtom } from "@/app/view/jarvis/effortstore";
import { SWITCH_NOTE } from "./chatinitiative";
import { takeResultLines } from "./chatinitiativestore";
import { registerChatBox } from "./chatinsert";
import { markChunkDone } from "./chatsuggeststore";
import {
    BAND_STORAGE_KEY,
    bandPartsAtom,
    coerceBandOpen,
    setBandPart,
    switchAgentChunk,
    switchAndTell,
    toggleBandPart,
    withBandPart,
} from "./initiativebandstore";

const OREF = "effort:e1";
const TAB = "t1";

type TestChunk = { label: string; status: string; workrefs?: { kind: string; oref: string; ts?: number }[] };
const effortOf = (chunks: TestChunk[]) =>
    ({ oid: "e1", title: "Plan", version: 1, updatedts: 1, chunks }) as unknown as Effort;
const mineRef = [{ kind: "agent", oref: "agent:" + TAB, ts: 1 }];
const otherRef = [{ kind: "agent", oref: "agent:t9", ts: 1 }];

function seed(effort: Effort | null): void {
    const cache = new Map<string, Effort>();
    if (effort != null) {
        cache.set(OREF, effort);
    }
    globalStore.set(effortDetailAtom, cache);
}

// the ops of the nth EffortMutateCommand call
const opsOf = (n: number) => (rpc.EffortMutateCommand.mock.calls[n] as any[])[1].ops;
const reply = (effort: Effort) => ({ effort });

beforeEach(() => {
    rpc.EffortMutateCommand.mockReset();
    rpc.EffortGetCommand.mockReset();
    ls.clear();
    ls.failWrites = false;
    delete (globalThis as any).window.__initiativeSwitchFail;
    takeResultLines(TAB);
    globalStore.set(bandPartsAtom, []);
});

// A is the agent's own active chunk, B and C pending
const own = () =>
    effortOf([
        { label: "A", status: "active", workrefs: mineRef },
        { label: "B", status: "pending" },
        { label: "C", status: "pending" },
    ]);

describe("switchAgentChunk", () => {
    it("sends the detach write, then the attach write, and queues one switched line", async () => {
        seed(own());
        rpc.EffortMutateCommand.mockResolvedValue(reply(own()));
        await switchAgentChunk(OREF, TAB, "B");
        expect(rpc.EffortMutateCommand).toHaveBeenCalledTimes(2);
        expect(opsOf(0)).toEqual([
            { op: "detachWork", chunk: "A", kind: "agent", oref: "agent:t1" },
            { op: "setChunkStatus", chunk: "A", status: "pending" },
        ]);
        expect(opsOf(1)).toEqual([
            { op: "attachWork", chunk: "B", kind: "agent", oref: "agent:t1" },
            { op: "setChunkStatus", chunk: "B", status: "active" },
        ]);
        expect(takeResultLines(TAB)).toEqual(["initiative: switched you to chunk 2 B (effort:e1)"]);
    });

    it("leaves one switched line after two switches: the last", async () => {
        seed(own());
        rpc.EffortMutateCommand.mockResolvedValue(
            reply(
                effortOf([
                    { label: "A", status: "pending" },
                    { label: "B", status: "active", workrefs: mineRef },
                    { label: "C", status: "pending" },
                ])
            )
        );
        await switchAgentChunk(OREF, TAB, "B");
        await switchAgentChunk(OREF, TAB, "C");
        expect(takeResultLines(TAB)).toEqual(["initiative: switched you to chunk 3 C (effort:e1)"]);
    });

    it("sends the rollback and rejects with the attach error when the second write fails, with no line", async () => {
        seed(own());
        rpc.EffortMutateCommand.mockResolvedValueOnce(reply(own()))
            .mockRejectedValueOnce(new Error("refused: chunk held"))
            .mockResolvedValueOnce(reply(own()));
        await expect(switchAgentChunk(OREF, TAB, "B")).rejects.toMatchObject({ message: "refused: chunk held" });
        expect(rpc.EffortMutateCommand).toHaveBeenCalledTimes(3);
        expect(opsOf(2)).toEqual([
            { op: "attachWork", chunk: "A", kind: "agent", oref: "agent:t1" },
            { op: "setChunkStatus", chunk: "A", status: "active" },
        ]);
        expect(takeResultLines(TAB)).toEqual([]);
    });

    it("names the rollback's own failure too when the old chunk could not be restored", async () => {
        seed(own());
        rpc.EffortMutateCommand.mockResolvedValueOnce(reply(own()))
            .mockRejectedValueOnce(new Error("refused"))
            .mockRejectedValueOnce(new Error("boom"));
        await expect(switchAgentChunk(OREF, TAB, "B")).rejects.toMatchObject({
            message: "refused; and the old chunk could not be restored: boom",
        });
        expect(takeResultLines(TAB)).toEqual([]);
    });

    it("with window.__initiativeSwitchFail never sends the second write, rolls back for real and rejects with it", async () => {
        seed(own());
        rpc.EffortMutateCommand.mockResolvedValue(reply(own()));
        (globalThis as any).window.__initiativeSwitchFail = "x";
        await expect(switchAgentChunk(OREF, TAB, "B")).rejects.toMatchObject({ message: "x" });
        // detach and rollback only: the attach write (to B) was never sent
        expect(rpc.EffortMutateCommand).toHaveBeenCalledTimes(2);
        expect(opsOf(0)[0].op).toBe("detachWork");
        expect(opsOf(1)).toEqual([
            { op: "attachWork", chunk: "A", kind: "agent", oref: "agent:t1" },
            { op: "setChunkStatus", chunk: "A", status: "active" },
        ]);
        expect(takeResultLines(TAB)).toEqual([]);
    });

    it("does the second write alone for an agent with no chunk, and has nothing to roll back when it fails", async () => {
        const none = () =>
            effortOf([
                { label: "A", status: "pending" },
                { label: "B", status: "done" },
            ]);
        seed(none());
        rpc.EffortMutateCommand.mockResolvedValueOnce(reply(none()));
        await switchAgentChunk(OREF, TAB, "A");
        expect(rpc.EffortMutateCommand).toHaveBeenCalledTimes(1);
        expect(opsOf(0)).toEqual([
            { op: "attachWork", chunk: "A", kind: "agent", oref: "agent:t1" },
            { op: "setChunkStatus", chunk: "A", status: "active" },
        ]);
        expect(takeResultLines(TAB)).toEqual(["initiative: switched you to chunk 1 A (effort:e1)"]);

        rpc.EffortMutateCommand.mockReset();
        seed(none());
        rpc.EffortMutateCommand.mockRejectedValueOnce(new Error("refused"));
        await expect(switchAgentChunk(OREF, TAB, "A")).rejects.toMatchObject({ message: "refused" });
        expect(rpc.EffortMutateCommand).toHaveBeenCalledTimes(1);
        expect(takeResultLines(TAB)).toEqual([]);
    });

    it("sends nothing for the chunk the agent is already on", async () => {
        seed(own());
        await switchAgentChunk(OREF, TAB, "A");
        expect(rpc.EffortMutateCommand).not.toHaveBeenCalled();
        expect(takeResultLines(TAB)).toEqual([]);
    });

    it("rejects, sending nothing, when the first write fails", async () => {
        seed(own());
        rpc.EffortMutateCommand.mockRejectedValueOnce(new Error("detach refused"));
        await expect(switchAgentChunk(OREF, TAB, "B")).rejects.toMatchObject({ message: "detach refused" });
        expect(rpc.EffortMutateCommand).toHaveBeenCalledTimes(1);
        expect(takeResultLines(TAB)).toEqual([]);
    });

    it("rejects for a chunk the initiative does not have", async () => {
        seed(own());
        await expect(switchAgentChunk(OREF, TAB, "Z")).rejects.toThrow("No chunk “Z” in this initiative");
        expect(rpc.EffortMutateCommand).not.toHaveBeenCalled();
    });

    it("reads the initiative first when it is not cached", async () => {
        seed(null);
        rpc.EffortGetCommand.mockResolvedValueOnce(reply(own()));
        rpc.EffortMutateCommand.mockResolvedValue(reply(own()));
        await switchAgentChunk(OREF, TAB, "B");
        expect(rpc.EffortGetCommand).toHaveBeenCalledTimes(1);
        expect(rpc.EffortMutateCommand).toHaveBeenCalledTimes(2);
    });
});

describe("switchAndTell", () => {
    // a chat box for the agent: `draft` is its text, `submitted` what it was asked to send
    function fakeBox(draft = "") {
        const box = {
            submitted: [] as string[],
            text: () => draft,
            submit: (t: string) => {
                box.submitted.push(t);
                return true;
            },
            append: () => true,
            replace: () => true,
            focus: () => true,
            interrupt: () => false,
        };
        return { box, unregister: registerChatBox(TAB, box) };
    }

    it("sends the switch note through an empty box of an awake agent, with the line still queued for that send", async () => {
        seed(own());
        rpc.EffortMutateCommand.mockResolvedValue(reply(own()));
        const { box, unregister } = fakeBox();
        await switchAndTell(OREF, TAB, "B", true);
        expect(box.submitted).toEqual([SWITCH_NOTE]);
        expect(takeResultLines(TAB)).toEqual([expect.stringMatching(/^initiative: switched you to chunk 2 B/)]);
        unregister();
    });

    it("leaves the line waiting, sending nothing, when the box holds a draft or the agent sleeps", async () => {
        for (const [draft, awake] of [
            ["half a thought", true],
            ["", false],
        ] as const) {
            seed(own());
            rpc.EffortMutateCommand.mockResolvedValue(reply(own()));
            const { box, unregister } = fakeBox(draft);
            await switchAndTell(OREF, TAB, "B", awake);
            expect(box.submitted).toEqual([]);
            expect(takeResultLines(TAB)).toHaveLength(1);
            unregister();
        }
    });

    it("sends nothing when the agent is on that chunk already, and nothing after a failed switch", async () => {
        seed(own());
        const { box, unregister } = fakeBox();
        await switchAndTell(OREF, TAB, "A", true);
        rpc.EffortMutateCommand.mockRejectedValueOnce(new Error("refused"));
        await expect(switchAndTell(OREF, TAB, "B", true)).rejects.toThrow("refused");
        expect(box.submitted).toEqual([]);
        unregister();
    });
});

describe("markChunkDone", () => {
    it("advances from the first active chunk, then attaches the agent to the chunk that woke", async () => {
        seed(own());
        rpc.EffortMutateCommand.mockResolvedValueOnce(
            reply(
                effortOf([
                    { label: "A", status: "done", workrefs: mineRef },
                    { label: "B", status: "active" },
                    { label: "C", status: "pending" },
                ])
            )
        ).mockResolvedValueOnce(reply(own()));
        await markChunkDone(OREF, "A", TAB);
        expect(rpc.EffortMutateCommand).toHaveBeenCalledTimes(2);
        expect(opsOf(0)).toEqual([{ op: "advance" }]);
        expect(opsOf(1)).toEqual([{ op: "attachWork", chunk: "B", kind: "agent", oref: "agent:t1" }]);
    });

    it("does not attach the agent when the chunk that woke is held by another tab", async () => {
        seed(own());
        rpc.EffortMutateCommand.mockResolvedValueOnce(
            reply(
                effortOf([
                    { label: "A", status: "done", workrefs: mineRef },
                    { label: "B", status: "active", workrefs: otherRef },
                    { label: "C", status: "pending" },
                ])
            )
        );
        await markChunkDone(OREF, "A", TAB);
        expect(rpc.EffortMutateCommand).toHaveBeenCalledTimes(1);
        expect(opsOf(0)).toEqual([{ op: "advance" }]);
    });

    it("sets a non-first active chunk done instead of advancing, which would finish the other one", async () => {
        seed(
            effortOf([
                { label: "A", status: "active", workrefs: otherRef },
                { label: "B", status: "active", workrefs: mineRef },
            ])
        );
        rpc.EffortMutateCommand.mockResolvedValueOnce(
            reply(
                effortOf([
                    { label: "A", status: "active", workrefs: otherRef },
                    { label: "B", status: "done", workrefs: mineRef },
                ])
            )
        );
        await markChunkDone(OREF, "B", TAB);
        expect(rpc.EffortMutateCommand).toHaveBeenCalledTimes(1);
        expect(opsOf(0)).toEqual([{ op: "setChunkStatus", chunk: "B", status: "done" }]);
    });

    it("moves on with advance only when no chunk is active after setting a non-active chunk done", async () => {
        seed(
            effortOf([
                { label: "A", status: "pending", workrefs: otherRef },
                { label: "B", status: "pending", workrefs: mineRef },
            ])
        );
        rpc.EffortMutateCommand.mockResolvedValueOnce(
            reply(
                effortOf([
                    { label: "A", status: "pending", workrefs: otherRef },
                    { label: "B", status: "done", workrefs: mineRef },
                ])
            )
        ).mockResolvedValueOnce(
            reply(
                effortOf([
                    { label: "A", status: "active", workrefs: otherRef },
                    { label: "B", status: "done", workrefs: mineRef },
                ])
            )
        );
        await markChunkDone(OREF, "B", TAB);
        expect(rpc.EffortMutateCommand).toHaveBeenCalledTimes(2);
        expect(opsOf(0)).toEqual([{ op: "setChunkStatus", chunk: "B", status: "done" }]);
        expect(opsOf(1)).toEqual([{ op: "advance" }]);
    });

    it("says the chunk is done when only carrying the agent forward failed", async () => {
        seed(own());
        rpc.EffortMutateCommand.mockResolvedValueOnce(
            reply(
                effortOf([
                    { label: "A", status: "done", workrefs: mineRef },
                    { label: "B", status: "active" },
                ])
            )
        ).mockRejectedValueOnce(new Error("refused"));
        await expect(markChunkDone(OREF, "A", TAB)).rejects.toThrow(/marked done.*“B”.*refused/i);
    });

    it("does nothing for a chunk the initiative does not have, or one that is not loaded", async () => {
        seed(own());
        await markChunkDone(OREF, "Z", TAB);
        seed(null);
        await markChunkDone(OREF, "A", TAB);
        expect(rpc.EffortMutateCommand).not.toHaveBeenCalled();
    });
});

describe("the band's open part", () => {
    const part = (id: string, p: "initiative" | "brainstorm") => ({ id, part: p });

    it("toggleBandPart opens one agent's part and writes chat.initiative.band, the others untouched", () => {
        toggleBandPart("a1", "initiative");
        expect(globalStore.get(bandPartsAtom)).toEqual([part("a1", "initiative")]);
        expect(ls.store.get(BAND_STORAGE_KEY)).toBe('[{"id":"a1","part":"initiative"}]');
        expect(BAND_STORAGE_KEY).toBe("chat.initiative.band");
        toggleBandPart("a2", "brainstorm");
        expect(globalStore.get(bandPartsAtom)).toEqual([part("a1", "initiative"), part("a2", "brainstorm")]);
        // the same part again closes it
        toggleBandPart("a1", "initiative");
        expect(globalStore.get(bandPartsAtom)).toEqual([part("a2", "brainstorm")]);
        expect(ls.store.get(BAND_STORAGE_KEY)).toBe('[{"id":"a2","part":"brainstorm"}]');
    });

    it("toggleBandPart opens one part at a time: the other part's open one is replaced, not joined", () => {
        toggleBandPart("a1", "brainstorm");
        toggleBandPart("a2", "initiative");
        // a1 goes from the brainstorm part to the initiative part
        toggleBandPart("a1", "initiative");
        expect(globalStore.get(bandPartsAtom)).toEqual([part("a2", "initiative"), part("a1", "initiative")]);
        // and back, the initiative part's own toggle closing nothing here
        toggleBandPart("a1", "brainstorm");
        expect(globalStore.get(bandPartsAtom)).toEqual([part("a2", "initiative"), part("a1", "brainstorm")]);
        toggleBandPart("a1", "brainstorm");
        expect(globalStore.get(bandPartsAtom)).toEqual([part("a2", "initiative")]);
    });

    it("setBandPart opens a named part or closes with null, and persists what it set", () => {
        setBandPart("a1", "brainstorm");
        expect(globalStore.get(bandPartsAtom)).toEqual([part("a1", "brainstorm")]);
        // the persisted shape round-trips into the same list
        expect(coerceBandOpen(ls.store.get(BAND_STORAGE_KEY))).toEqual(globalStore.get(bandPartsAtom));
        setBandPart("a1", null);
        expect(globalStore.get(bandPartsAtom)).toEqual([]);
        expect(ls.store.get(BAND_STORAGE_KEY)).toBe("[]");
    });

    it("still toggles when localStorage throws", () => {
        ls.failWrites = true;
        const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
        expect(() => toggleBandPart("a3", "initiative")).not.toThrow();
        expect(globalStore.get(bandPartsAtom)).toEqual([part("a3", "initiative")]);
        expect(() => toggleBandPart("a3", "initiative")).not.toThrow();
        expect(globalStore.get(bandPartsAtom)).toEqual([]);
        warn.mockRestore();
    });

    it("keeps the 200 newest open agents, dropping the oldest", () => {
        for (let i = 0; i < 201; i++) {
            setBandPart("agent" + i, i % 2 === 0 ? "initiative" : "brainstorm");
        }
        const list = globalStore.get(bandPartsAtom);
        expect(list).toHaveLength(200);
        expect(list[0]).toEqual(part("agent1", "brainstorm"));
        expect(list[199]).toEqual(part("agent200", "initiative"));
    });

    it("setBandPart to the state it already has changes and writes nothing", () => {
        setBandPart("a1", "initiative");
        const before = globalStore.get(bandPartsAtom);
        ls.store.delete(BAND_STORAGE_KEY);
        setBandPart("a1", "initiative");
        setBandPart("never-open", null);
        expect(globalStore.get(bandPartsAtom)).toBe(before);
        expect(ls.store.has(BAND_STORAGE_KEY)).toBe(false);
    });

    it("withBandPart puts the opened agent last and leaves the list alone when nothing changes", () => {
        const list = [part("a", "initiative"), part("b", "brainstorm")];
        expect(withBandPart(list, "b", "brainstorm")).toBe(list);
        expect(withBandPart(list, "zzz", null)).toBe(list);
        expect(withBandPart(list, "a", "brainstorm")).toEqual([part("b", "brainstorm"), part("a", "brainstorm")]);
        expect(withBandPart(list, "b", "initiative")).toEqual([part("a", "initiative"), part("b", "initiative")]);
        expect(withBandPart(list, "a", null)).toEqual([part("b", "brainstorm")]);
    });

    it("reads the landed shape, a list of bare ids, as the initiative part open", () => {
        expect(coerceBandOpen('["a1","a2"]')).toEqual([part("a1", "initiative"), part("a2", "initiative")]);
        // a band open before the update stays open on the same part
        ls.store.set(BAND_STORAGE_KEY, '["a1","a2"]');
        expect(coerceBandOpen(ls.store.get(BAND_STORAGE_KEY))).toEqual([
            part("a1", "initiative"),
            part("a2", "initiative"),
        ]);
    });

    it("reads the new shape, and anything else as none", () => {
        expect(coerceBandOpen('[{"id":"a","part":"brainstorm"},{"id":"b","part":"initiative"}]')).toEqual([
            part("a", "brainstorm"),
            part("b", "initiative"),
        ]);
        // both shapes in one list, an entry with a part it does not know or none, and repeats, are dealt with one by one
        expect(
            coerceBandOpen(
                '["a",{"id":"b","part":"brainstorm"},{"id":"c","part":"bogus"},{"id":"d"},{"part":"initiative"},"a",{"id":"b","part":"initiative"}]'
            )
        ).toEqual([part("a", "initiative"), part("b", "brainstorm")]);
        expect(coerceBandOpen(null)).toEqual([]);
        expect(coerceBandOpen("not json")).toEqual([]);
        expect(coerceBandOpen('{"a":true}')).toEqual([]);
        expect(coerceBandOpen('["a",3,"","a","b",null,[]]')).toEqual([
            part("a", "initiative"),
            part("b", "initiative"),
        ]);
        const many = JSON.stringify(Array.from({ length: 250 }, (_, i) => "id" + i));
        const kept = coerceBandOpen(many);
        expect(kept).toHaveLength(200);
        expect(kept[0]).toEqual(part("id50", "initiative"));
    });
});
