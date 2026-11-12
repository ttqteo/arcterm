// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { describe, expect, it } from "vitest";
import { jumpChatToLatest, registerChatJump } from "./chatjump";

describe("chat jump registry", () => {
    it("runs the agent's jump and answers what it did", () => {
        let atEnd = false;
        let jumped = 0;
        const off = registerChatJump("a1", () => {
            if (atEnd) {
                return false;
            }
            jumped++;
            atEnd = true;
            return true;
        });
        expect(jumpChatToLatest("a1")).toBe(true);
        expect(jumped).toBe(1);
        // at the end now: nothing to jump to, so the key passes
        expect(jumpChatToLatest("a1")).toBe(false);
        expect(jumped).toBe(1);
        off();
    });

    it("answers false for an agent with no Chat mounted", () => {
        expect(jumpChatToLatest("nobody")).toBe(false);
    });

    it("an old pane's unregister leaves a newer registration alone", () => {
        const offOld = registerChatJump("a2", () => true);
        const offNew = registerChatJump("a2", () => true);
        offOld();
        expect(jumpChatToLatest("a2")).toBe(true);
        offNew();
        expect(jumpChatToLatest("a2")).toBe(false);
    });
});
