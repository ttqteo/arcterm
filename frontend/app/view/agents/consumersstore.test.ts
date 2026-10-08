// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/app/store/wshclientapi", () => ({ RpcApi: { GetConsumersCommand: vi.fn() } }));
vi.mock("@/app/store/wshrpcutil", () => ({ TabRpcClient: {} }));

import { globalStore } from "@/app/store/jotaiStore";
import { consumersOpenAtom, consumersReadingAtom, loadConsumers, toggleConsumers } from "./consumersstore";

const reading: CommandGetConsumersRtnData = { totalbytes: 8, availablebytes: 2, windowms: 600_000, agents: [] };

describe("loadConsumers", () => {
    beforeEach(() => globalStore.set(consumersReadingAtom, { data: null, lastOkMs: null, failed: false }));

    it("stores a reading with when it landed", async () => {
        await loadConsumers(
            async () => reading,
            () => 1000
        );
        expect(globalStore.get(consumersReadingAtom)).toEqual({ data: reading, lastOkMs: 1000, failed: false });
    });

    it("keeps the last reading when a poll fails", async () => {
        await loadConsumers(
            async () => reading,
            () => 1000
        );
        await loadConsumers(async () => {
            throw new Error("wavesrv restarting");
        });
        expect(globalStore.get(consumersReadingAtom)).toEqual({ data: reading, lastOkMs: 1000, failed: true });
    });
});

describe("toggleConsumers", () => {
    beforeEach(() => globalStore.set(consumersOpenAtom, null));

    it("opens on a sort, closes on the same opener, and switches sort from the other", () => {
        toggleConsumers("ram");
        expect(globalStore.get(consumersOpenAtom)).toBe("ram");
        toggleConsumers("tokens");
        expect(globalStore.get(consumersOpenAtom)).toBe("tokens");
        toggleConsumers("tokens");
        expect(globalStore.get(consumersOpenAtom)).toBeNull();
    });
});
