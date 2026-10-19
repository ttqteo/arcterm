// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { globalStore } from "@/app/store/jotaiStore";
import { afterEach, describe, expect, it, vi } from "vitest";

const runChanges = vi.fn();
const channelMessages = vi.fn();
vi.mock("@/app/store/wshclientapi", () => ({
    RpcApi: {
        GetChannelRunChangesCommand: (...a: any[]) => runChanges(...a),
        GetChannelMessagesCommand: (...a: any[]) => channelMessages(...a),
    },
}));
vi.mock("@/app/store/wshrpcutil", () => ({ TabRpcClient: {} }));
vi.mock("@/app/store/wos", async () => {
    const { atom } = await import("jotai");
    return {
        getWaveObjectAtom: () => atom(null),
        makeORef: (otype: string, oid: string) => `${otype}:${oid}`,
        loadAndPinWaveObject: vi.fn(),
    };
});

import {
    activeChannelIdAtom,
    activeChannelMessagesAtom,
    activeChannelRunsAtom,
    loadActiveChannelStreams,
} from "./channelsstore";

const run = (id: string, version: number, createdts: number) => ({ id, version, createdts }) as Run;
const msg = (oid: string) => ({ oid }) as unknown as ChannelMessage;

afterEach(() => {
    runChanges.mockReset();
    channelMessages.mockReset();
    globalStore.set(activeChannelIdAtom, undefined);
    globalStore.set(activeChannelRunsAtom, []);
    globalStore.set(activeChannelMessagesAtom, []);
});

// each test names its own channel ids: the store remembers which channel its run list was last filled for
describe("loadActiveChannelStreams", () => {
    it("asks for the channel's run changes and messages and fills both lists", async () => {
        globalStore.set(activeChannelIdAtom, "c-fill");
        runChanges.mockResolvedValue({ runids: ["r1", "r2"], runs: [run("r2", 1, 20), run("r1", 3, 10)] });
        channelMessages.mockResolvedValue({ messages: [msg("m1"), msg("m2")] });

        await loadActiveChannelStreams("c-fill");

        expect(runChanges).toHaveBeenCalledTimes(1);
        expect(runChanges.mock.calls[0][1]).toStrictEqual({ channelid: "c-fill", known: {} });
        expect(channelMessages).toHaveBeenCalledTimes(1);
        expect(channelMessages.mock.calls[0][1]).toStrictEqual({ channelid: "c-fill" });
        expect(globalStore.get(activeChannelRunsAtom)).toStrictEqual([run("r1", 3, 10), run("r2", 1, 20)]);
        expect(globalStore.get(activeChannelMessagesAtom)).toStrictEqual([msg("m1"), msg("m2")]);
    });

    it("reads a reply with no fields as empty lists", async () => {
        globalStore.set(activeChannelIdAtom, "c-empty");
        globalStore.set(activeChannelRunsAtom, [run("stale", 1, 1)]);
        globalStore.set(activeChannelMessagesAtom, [msg("stale")]);
        runChanges.mockResolvedValue({});
        channelMessages.mockResolvedValue({});

        await loadActiveChannelStreams("c-empty");

        expect(globalStore.get(activeChannelRunsAtom)).toStrictEqual([]);
        expect(globalStore.get(activeChannelMessagesAtom)).toStrictEqual([]);
    });

    it("sends the versions it holds on a refresh of the same channel and keeps the unchanged rows", async () => {
        globalStore.set(activeChannelIdAtom, "c-same");
        runChanges.mockResolvedValue({ runids: ["r1"], runs: [run("r1", 1, 10)] });
        channelMessages.mockResolvedValue({ messages: [] });
        await loadActiveChannelStreams("c-same");

        runChanges.mockResolvedValue({ runids: ["r1", "r2"], runs: [run("r2", 1, 20)] });
        await loadActiveChannelStreams("c-same");

        expect(runChanges.mock.calls[1][1]).toStrictEqual({ channelid: "c-same", known: { r1: 1 } });
        expect(globalStore.get(activeChannelRunsAtom)).toStrictEqual([run("r1", 1, 10), run("r2", 1, 20)]);
    });

    // one channel's versions sent for another would make the server skip rows the new list never had
    it("sends no versions when the list it holds was filled for another channel", async () => {
        globalStore.set(activeChannelIdAtom, "c-first");
        runChanges.mockResolvedValue({ runids: ["r1"], runs: [run("r1", 7, 10)] });
        channelMessages.mockResolvedValue({ messages: [] });
        await loadActiveChannelStreams("c-first");

        globalStore.set(activeChannelIdAtom, "c-second");
        runChanges.mockResolvedValue({ runids: ["r2"], runs: [run("r2", 1, 20)] });
        await loadActiveChannelStreams("c-second");

        expect(runChanges.mock.calls[1][1]).toStrictEqual({ channelid: "c-second", known: {} });
        expect(globalStore.get(activeChannelRunsAtom)).toStrictEqual([run("r2", 1, 20)]);
    });

    it("drops a reply for a channel the user has already left", async () => {
        const held = [run("kept", 1, 1)];
        const heldMessages = [msg("kept")];
        globalStore.set(activeChannelIdAtom, "c-elsewhere");
        globalStore.set(activeChannelRunsAtom, held);
        globalStore.set(activeChannelMessagesAtom, heldMessages);
        runChanges.mockResolvedValue({ runids: ["r9"], runs: [run("r9", 1, 9)] });
        channelMessages.mockResolvedValue({ messages: [msg("m9")] });

        await loadActiveChannelStreams("c-left");

        expect(globalStore.get(activeChannelRunsAtom)).toBe(held);
        expect(globalStore.get(activeChannelMessagesAtom)).toBe(heldMessages);
    });
});
