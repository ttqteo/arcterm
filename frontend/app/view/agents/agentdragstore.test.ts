// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { globalStore } from "@/app/store/jotaiStore";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { agentDragAtom, beginAgentDrag, endAgentDrag } from "./agentdragstore";
import { AGENT_DRAG_MIME } from "./griddrop";

const fakeEvent = () => ({ dataTransfer: { setData: vi.fn(), effectAllowed: "uninitialized" as string } });

beforeEach(() => {
    endAgentDrag();
});

describe("agent drag state", () => {
    it("carries the agent id under the custom MIME and marks a drag as active", () => {
        const e = fakeEvent();
        beginAgentDrag(e, "tab1");
        expect(e.dataTransfer.setData).toHaveBeenCalledWith(AGENT_DRAG_MIME, "tab1");
        expect(e.dataTransfer.effectAllowed).toBe("move");
        expect(globalStore.get(agentDragAtom)).toEqual({ id: "tab1" });
    });
    it("does not start a drag that has no dataTransfer", () => {
        beginAgentDrag({ dataTransfer: null }, "tab1");
        expect(globalStore.get(agentDragAtom)).toBeNull();
    });
    it("ends", () => {
        beginAgentDrag(fakeEvent(), "tab1");
        endAgentDrag();
        expect(globalStore.get(agentDragAtom)).toBeNull();
    });
    it("a second begin replaces the first", () => {
        beginAgentDrag(fakeEvent(), "tab1");
        beginAgentDrag(fakeEvent(), "tab2");
        expect(globalStore.get(agentDragAtom)).toEqual({ id: "tab2" });
    });
});
