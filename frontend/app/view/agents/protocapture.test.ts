// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { withOverlaysHidden } from "./protocapture";
import { CAPTURE_ATTR } from "./protomodel";

// a frame is only asked to set and remove one attribute
function fakeFrame() {
    const attrs = new Map<string, string>();
    const el = {
        setAttribute: (k: string, v: string) => void attrs.set(k, v),
        removeAttribute: (k: string) => void attrs.delete(k),
        hasAttribute: (k: string) => attrs.has(k),
    };
    return { el: el as unknown as HTMLElement, capturing: () => attrs.has(CAPTURE_ATTR) };
}

// animation frames the test runs by hand, so "waits two frames" is something it can see
let queued: FrameRequestCallback[] = [];
function runFrame() {
    const now = queued;
    queued = [];
    now.forEach((cb) => cb(0));
}

beforeEach(() => {
    queued = [];
    vi.useFakeTimers();
    vi.stubGlobal("requestAnimationFrame", (cb: FrameRequestCallback) => queued.push(cb));
});

afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
});

describe("withOverlaysHidden", () => {
    it("marks the frame, waits two animation frames, runs the capture, then unmarks and returns its value", async () => {
        const { el, capturing } = fakeFrame();
        const seen: boolean[] = [];
        const run = withOverlaysHidden(el, async () => {
            seen.push(capturing());
            return "picture";
        });
        expect(capturing()).toBe(true);
        await vi.advanceTimersByTimeAsync(0);
        expect(seen).toEqual([]);
        runFrame();
        await vi.advanceTimersByTimeAsync(0);
        expect(seen).toEqual([]);
        runFrame();
        await expect(run).resolves.toBe("picture");
        expect(seen).toEqual([true]);
        expect(capturing()).toBe(false);
    });

    it("unmarks the frame and rethrows when the capture fails", async () => {
        const { el, capturing } = fakeFrame();
        const run = withOverlaysHidden(el, async () => {
            throw new Error("no screen recording");
        });
        const settled = expect(run).rejects.toThrow("no screen recording");
        runFrame();
        await vi.advanceTimersByTimeAsync(0);
        runFrame();
        await settled;
        expect(capturing()).toBe(false);
    });

    it("keeps the frame marked until the last of two overlapping captures is done", async () => {
        const { el, capturing } = fakeFrame();
        let finishSecond: () => void = () => {};
        const first = withOverlaysHidden(el, async () => "one");
        const second = withOverlaysHidden(
            el,
            () =>
                new Promise<string>((resolve) => {
                    finishSecond = () => resolve("two");
                })
        );
        runFrame();
        await vi.advanceTimersByTimeAsync(0);
        runFrame();
        await expect(first).resolves.toBe("one");
        // the first one is done, the second's capture is still under way
        expect(capturing()).toBe(true);
        finishSecond();
        await expect(second).resolves.toBe("two");
        expect(capturing()).toBe(false);
    });

    it("does not hang when the window draws no frames (a hidden window)", async () => {
        const { el, capturing } = fakeFrame();
        const run = withOverlaysHidden(el, async () => "picture");
        // no frame ever runs
        await vi.advanceTimersByTimeAsync(1000);
        await expect(run).resolves.toBe("picture");
        expect(capturing()).toBe(false);
    });
});
