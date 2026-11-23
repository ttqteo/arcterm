// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { describe, expect, it } from "vitest";
import { formatLongFrame } from "./stallwatch";

describe("formatLongFrame", () => {
    it("names the frame's split and its longest scripts first", () => {
        const line = formatLongFrame({
            startTime: 1520.4,
            duration: 19800,
            styleAndLayoutStart: 1520.4 + 19000,
            scripts: [
                {
                    invokerType: "event-listener",
                    invoker: "WebSocket.onmessage",
                    sourceURL: "tauri://localhost/assets/index-ab12.js?x=1",
                    sourceCharPosition: 4410,
                    sourceFunctionName: "a",
                    duration: 300,
                },
                {
                    invokerType: "classic-script",
                    invoker: "MessagePort.onmessage",
                    sourceURL: "tauri://localhost/assets/index-ab12.js",
                    sourceCharPosition: 99,
                    duration: 18500,
                    forcedStyleAndLayoutDuration: 1200,
                },
            ],
        });
        expect(line).toBe(
            "[stall] frame at 1520ms ran 19800ms script=18800ms forced-layout=1200ms style+layout=800ms" +
                " | 18500ms classic-script:MessagePort.onmessage index-ab12.js:99 (anonymous)" +
                " | 300ms event-listener:WebSocket.onmessage index-ab12.js:4410 a"
        );
    });

    it("caps the scripts it lists and says how many it left out", () => {
        const scripts = [1, 2, 3, 4, 5].map((d) => ({ duration: d * 100, sourceURL: "x.js" }));
        const line = formatLongFrame({ startTime: 0, duration: 2000, scripts });
        expect(line).toContain("| 500ms ?:? x.js:? (anonymous)");
        expect(line).not.toContain("| 100ms");
        expect(line).toMatch(/\| \+2 more$/);
    });

    it("reads a frame with no scripts", () => {
        expect(formatLongFrame({ startTime: 10, duration: 1500 })).toBe(
            "[stall] frame at 10ms ran 1500ms script=0ms forced-layout=0ms style+layout=0ms"
        );
    });
});
