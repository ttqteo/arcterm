// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { globalStore } from "@/app/store/jotaiStore";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { memoryErrorAtom, selectMemoryChange, selectMemoryProject } from "./memorystore";

vi.mock("@/app/cockpit/cockpit-actions", () => ({ launchAgent: vi.fn() }));
vi.mock("@/app/store/wps", () => ({ waveEventSubscribeSingle: vi.fn() }));
vi.mock("@/app/store/wshclientapi", () => ({ RpcApi: {} }));
vi.mock("@/app/store/wshrpcutil", () => ({ TabRpcClient: {} }));

describe("the Memory tab's error alert", () => {
    beforeEach(() => globalStore.set(memoryErrorAtom, "Could not undo the change in demo: backup manifest missing"));

    it("clears when j/k or a click moves to another change", () => {
        selectMemoryChange("c2");
        expect(globalStore.get(memoryErrorAtom)).toBeNull();
    });

    it("clears when another project is picked", () => {
        selectMemoryProject("other");
        expect(globalStore.get(memoryErrorAtom)).toBeNull();
    });
});
