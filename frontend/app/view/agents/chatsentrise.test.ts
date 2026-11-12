// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { describe, expect, it } from "vitest";
import { SENT_RISE_WINDOW_MS, risesFromBox } from "./chatsentrise";

describe("risesFromBox", () => {
    it("rises for a bubble mounting as its message is sent", () => {
        expect(risesFromBox(1000, 1000)).toBe(true);
        expect(risesFromBox(1000, 1000 + SENT_RISE_WINDOW_MS - 1)).toBe(true);
    });

    it("shows at once a bubble drawn again later: back to the agent, Terminal back to Chat", () => {
        expect(risesFromBox(1000, 1000 + SENT_RISE_WINDOW_MS)).toBe(false);
        expect(risesFromBox(1000, 1000 + 30_000)).toBe(false);
    });

    it("shows at once a bubble whose send time is ahead of the clock", () => {
        expect(risesFromBox(2000, 1000)).toBe(false);
    });
});
