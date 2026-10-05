// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { globalStore } from "@/app/store/jotaiStore";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { agentDragAtom, beginAgentDrag, endAgentDrag } from "./agentdragstore";
import { AGENT_DRAG_MIME } from "./griddrop";

const fakeEvent = () => ({ dataTransfer: { setData: vi.fn(), effectAllowed: "uninitialized" as string } });

// only the timers the store uses: performance.now stays real unless a test spies on it
beforeEach(() => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    endAgentDrag();
});

// the drag is ended before the window stub goes, so its listeners come off the stub that carries them
afterEach(() => {
    endAgentDrag();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
    vi.useRealTimers();
});

describe("agent drag state", () => {
    it("carries the agent id under the custom MIME at once, and marks the drag active a tick later", () => {
        const e = fakeEvent();
        beginAgentDrag(e, "tab1");
        expect(e.dataTransfer.setData).toHaveBeenCalledWith(AGENT_DRAG_MIME, "tab1");
        expect(e.dataTransfer.effectAllowed).toBe("move");
        expect(globalStore.get(agentDragAtom)).toBeNull();
        vi.runAllTimers();
        expect(globalStore.get(agentDragAtom)).toEqual({ id: "tab1" });
    });
    it("does not start a drag that has no dataTransfer", () => {
        beginAgentDrag({ dataTransfer: null }, "tab1");
        expect(vi.getTimerCount()).toBe(0);
        vi.runAllTimers();
        expect(globalStore.get(agentDragAtom)).toBeNull();
    });
    it("ends", () => {
        beginAgentDrag(fakeEvent(), "tab1");
        vi.runAllTimers();
        endAgentDrag();
        expect(globalStore.get(agentDragAtom)).toBeNull();
    });
    it("a drag that ends before the tick is not brought back by it", () => {
        beginAgentDrag(fakeEvent(), "tab1");
        endAgentDrag();
        expect(vi.getTimerCount()).toBe(0);
        vi.runAllTimers();
        expect(globalStore.get(agentDragAtom)).toBeNull();
    });
    it("a second begin replaces the first", () => {
        beginAgentDrag(fakeEvent(), "tab1");
        beginAgentDrag(fakeEvent(), "tab2");
        expect(vi.getTimerCount()).toBe(1);
        vi.runAllTimers();
        expect(globalStore.get(agentDragAtom)).toEqual({ id: "tab2" });
    });
});

// The failsafe for a source that unmounts mid-drag: vitest has no window, so a bare EventTarget stands in for it,
// and the clock is a variable the tests move.
describe("agent drag failsafe", () => {
    let clock = 0;
    let win: EventTarget;
    beforeEach(() => {
        clock = 0;
        vi.spyOn(performance, "now").mockImplementation(() => clock);
        win = new EventTarget();
        vi.stubGlobal("window", win);
    });
    const begin = (id = "tab1") => {
        beginAgentDrag(fakeEvent(), id);
        vi.runAllTimers();
    };
    const fire = (type: string, props: object = {}) => win.dispatchEvent(Object.assign(new Event(type), props));
    const active = () => globalStore.get(agentDragAtom) != null;

    it("dragend ends the drag, and so does drop", () => {
        begin();
        expect(active()).toBe(true);
        fire("dragend");
        expect(active()).toBe(false);
        begin();
        fire("drop");
        expect(active()).toBe(false);
    });
    it("a pointermove inside the grace period does not end it", () => {
        begin();
        clock = 299;
        fire("pointermove", { buttons: 0 });
        expect(active()).toBe(true);
    });
    it("a pointermove with a button held does not end it, however late", () => {
        begin();
        clock = 5000;
        fire("pointermove", { buttons: 1 });
        expect(active()).toBe(true);
    });
    it("a pointermove with no button held after the grace period ends it", () => {
        begin();
        clock = 301;
        fire("pointermove", { buttons: 0 });
        expect(active()).toBe(false);
    });
    it("a keydown ends it only after the grace period", () => {
        begin();
        clock = 100;
        fire("keydown");
        expect(active()).toBe(true);
        clock = 301;
        fire("keydown");
        expect(active()).toBe(false);
    });
    it("a second begin while armed starts the grace period again", () => {
        begin("tab1");
        clock = 250;
        begin("tab2");
        clock = 400; // 400 after the first begin, 150 after the second
        fire("pointermove", { buttons: 0 });
        expect(globalStore.get(agentDragAtom)).toEqual({ id: "tab2" });
        clock = 551;
        fire("pointermove", { buttons: 0 });
        expect(active()).toBe(false);
    });
    it("takes its listeners off when the drag ends", () => {
        begin();
        endAgentDrag();
        // were a listener left, one of these would end this stand-in drag
        globalStore.set(agentDragAtom, { id: "other" });
        clock = 5000;
        fire("dragend");
        fire("drop");
        fire("pointermove", { buttons: 0 });
        fire("keydown");
        expect(globalStore.get(agentDragAtom)).toEqual({ id: "other" });
    });
});
