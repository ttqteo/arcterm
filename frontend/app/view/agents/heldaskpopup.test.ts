// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { describe, expect, it } from "vitest";
import type { AgentVM } from "./agentsviewmodel";
import { heldAskKey, heldAskToPop, isHeldAsk, undismissed } from "./heldaskpopup";

const agent = (id: string, ask?: { askId: string; hold?: boolean }, state = "asking"): AgentVM =>
    ({ id, name: id, state, ask: ask ? { ...ask, questions: [] } : undefined }) as unknown as AgentVM;

describe("heldAskToPop", () => {
    it("pops a held command's card", () => {
        const a = agent("a", { askId: "k1", hold: true });
        expect(heldAskToPop([a], new Set())).toBe(a);
    });

    it("leaves an ordinary ask to its own card", () => {
        expect(heldAskToPop([agent("a", { askId: "k1" })], new Set())).toBeNull();
    });

    it("ignores an agent no longer asking", () => {
        expect(heldAskToPop([agent("a", { askId: "k1", hold: true }, "working")], new Set())).toBeNull();
    });

    it("pops the first held ask, the next after it is answered", () => {
        const a = agent("a", { askId: "k1", hold: true });
        const b = agent("b", { askId: "k2", hold: true });
        expect(heldAskToPop([a, b], new Set())).toBe(a);
        expect(heldAskToPop([agent("a", { askId: "k1", hold: true }, "working"), b], new Set())).toBe(b);
    });

    it("does not pop an ask hidden with Later, but pops the next one", () => {
        const a = agent("a", { askId: "k1", hold: true });
        expect(heldAskToPop([a], new Set(["k1"]))).toBeNull();
        const again = agent("a", { askId: "k2", hold: true });
        expect(heldAskToPop([again], new Set(["k1"]))).toBe(again);
    });

    it("brings a hidden ask back, and only that one", () => {
        const a = agent("a", { askId: "k1", hold: true });
        const hidden = new Set(["k1", "k2"]);
        const shown = undismissed(hidden, "k1");
        expect([...shown]).toEqual(["k2"]);
        expect([...hidden]).toEqual(["k1", "k2"]);
        expect(heldAskToPop([a], shown)).toBe(a);
    });

    it("tells a held ask from an ordinary one", () => {
        expect(isHeldAsk(agent("a", { askId: "k1", hold: true }))).toBe(true);
        expect(isHeldAsk(agent("a", { askId: "k1" }))).toBe(false);
        expect(isHeldAsk(agent("a", { askId: "k1", hold: true }, "working"))).toBe(false);
    });

    it("keys an ask by its id", () => {
        expect(heldAskKey(agent("a", { askId: "k1", hold: true }))).toBe("k1");
    });
});
