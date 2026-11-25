// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { globalStore } from "@/app/store/jotaiStore";
import { beforeEach, describe, expect, it } from "vitest";
import {
    LIBRARY_COUNCIL_HOST,
    libraryConvViewAtom,
    libraryCouncilSelAtom,
    libraryCouncilViewAtom,
} from "../library/librarystore";
import { AGENT_COUNCIL_HOST } from "./councilhost";
import { councilRevealAtom, revealCouncilMessage } from "./councilreveal";
import { councilSelAtom, councilViewAtom } from "./councilstore";

beforeEach(() => {
    globalStore.set(councilRevealAtom, null);
    globalStore.set(councilSelAtom, null);
    globalStore.set(councilViewAtom, "summary");
    globalStore.set(libraryCouncilSelAtom, null);
    globalStore.set(libraryCouncilViewAtom, "summary");
    globalStore.set(libraryConvViewAtom, "list");
});

describe("revealCouncilMessage", () => {
    it("asks the chat to scroll to the message and leaves the council open on its Discussion", () => {
        revealCouncilMessage(AGENT_COUNCIL_HOST, "c1", "P2");
        expect(globalStore.get(councilRevealAtom)).toEqual({ councilId: "c1", messageId: "P2" });
        expect(globalStore.get(councilSelAtom)).toBe("c1");
        expect(globalStore.get(councilViewAtom)).toBe("discussion");
    });

    it("takes the Discussion even when the council was last left on its report", () => {
        revealCouncilMessage(AGENT_COUNCIL_HOST, "c2", "r3");
        revealCouncilMessage(AGENT_COUNCIL_HOST, "c2", "r4");
        expect(globalStore.get(councilRevealAtom)).toEqual({ councilId: "c2", messageId: "r4" });
        expect(globalStore.get(councilViewAtom)).toBe("discussion");
    });

    it("opens the Discussion in the host it is given: Library's, with Agent's selection left alone", () => {
        globalStore.set(councilSelAtom, "other");
        revealCouncilMessage(LIBRARY_COUNCIL_HOST, "c3", "P1");
        expect(globalStore.get(councilRevealAtom)).toEqual({ councilId: "c3", messageId: "P1" });
        expect(globalStore.get(libraryCouncilSelAtom)).toBe("c3");
        expect(globalStore.get(libraryCouncilViewAtom)).toBe("discussion");
        // and Conversations shows that council full width, where a reveal from a message's link lands
        expect(globalStore.get(libraryConvViewAtom)).toBe("council");
        expect(globalStore.get(councilSelAtom)).toBe("other");
        expect(globalStore.get(councilViewAtom)).toBe("summary");
    });

    it("starts with no request", () => {
        expect(globalStore.get(councilRevealAtom)).toBeNull();
    });
});
