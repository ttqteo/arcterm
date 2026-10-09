// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { describe, expect, it } from "vitest";
import type { AgentVM } from "./agentsviewmodel";
import { heldAskKey, heldAskToPop } from "./heldaskpopup";

const agent = (id: string, ask?: { askId: string; hold?: boolean }, state = "asking"): AgentVM =>
    ({ id, name: id, state, ask: ask ? { ...ask, questions: [] } : undefined }) as unknown as AgentVM;

describe("heldAskToPop", () => {
    it("pops a held command's card", () => {
        const a = agent("a", { askId: "k1", hold: true });
        expect(heldAskToPop([a], new Set(), null)).toBe(a);
    });

    it("leaves an ordinary ask to its own card", () => {
        expect(heldAskToPop([agent("a", { askId: "k1" })], new Set(), null)).toBeNull();
    });

    it("ignores an agent no longer asking", () => {
        expect(heldAskToPop([agent("a", { askId: "k1", hold: true }, "working")], new Set(), null)).toBeNull();
    });

    it("skips the agent whose card is on screen, but not the others", () => {
        const a = agent("a", { askId: "k1", hold: true });
        const b = agent("b", { askId: "k2", hold: true });
        expect(heldAskToPop([a], new Set(), "a")).toBeNull();
        expect(heldAskToPop([a, b], new Set(), "a")).toBe(b);
    });

    it("does not pop an ask hidden with Later, but pops the next one", () => {
        const a = agent("a", { askId: "k1", hold: true });
        expect(heldAskToPop([a], new Set(["k1"]), null)).toBeNull();
        const again = agent("a", { askId: "k2", hold: true });
        expect(heldAskToPop([again], new Set(["k1"]), null)).toBe(again);
    });

    it("keys an ask by its id", () => {
        expect(heldAskKey(agent("a", { askId: "k1", hold: true }))).toBe("k1");
    });
});
