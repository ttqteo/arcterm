// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { globalStore } from "@/app/store/jotaiStore";
import { beforeEach, describe, expect, it } from "vitest";
import { councilRevealAtom, revealCouncilMessage } from "./councilreveal";
import { councilSelAtom, councilViewAtom } from "./councilstore";

beforeEach(() => {
    globalStore.set(councilRevealAtom, null);
    globalStore.set(councilSelAtom, null);
    globalStore.set(councilViewAtom, "summary");
});

describe("revealCouncilMessage", () => {
    it("asks the chat to scroll to the message and leaves the council open on its Discussion", () => {
        revealCouncilMessage("c1", "P2");
        expect(globalStore.get(councilRevealAtom)).toEqual({ councilId: "c1", messageId: "P2" });
        expect(globalStore.get(councilSelAtom)).toBe("c1");
        expect(globalStore.get(councilViewAtom)).toBe("discussion");
    });

    it("takes the Discussion even when the council was last left on its report", () => {
        revealCouncilMessage("c2", "r3");
        revealCouncilMessage("c2", "r4");
        expect(globalStore.get(councilRevealAtom)).toEqual({ councilId: "c2", messageId: "r4" });
        expect(globalStore.get(councilViewAtom)).toBe("discussion");
    });

    it("starts with no request", () => {
        expect(globalStore.get(councilRevealAtom)).toBeNull();
    });
});
