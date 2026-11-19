// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { globalStore } from "@/app/store/jotaiStore";
import { beforeEach, describe, expect, it } from "vitest";
import {
    LIBRARY_COUNCIL_HOST,
    libraryCouncilOnlyAtom,
    libraryCouncilSelAtom,
    libraryCouncilViewAtom,
    libraryTabAtom,
} from "../library/librarystore";
import { centerModeAtom } from "./agentcenter";
import { AGENT_COUNCIL_HOST } from "./councilhost";
import { councilOnlyAtom, councilSelAtom, councilViewAtom } from "./councilstore";

beforeEach(() => {
    globalStore.set(centerModeAtom, "terminal");
    globalStore.set(councilSelAtom, "agent-council");
    globalStore.set(councilViewAtom, "map");
    globalStore.set(councilOnlyAtom("agent-council"), "seat-a");
    globalStore.set(libraryCouncilSelAtom, null);
    globalStore.set(libraryCouncilViewAtom, "discussion");
    globalStore.set(libraryTabAtom, "conversations");
});

describe("LIBRARY_COUNCIL_HOST.open", () => {
    it("moves between a council's views on Library's atoms and leaves Agent's untouched", () => {
        LIBRARY_COUNCIL_HOST.open("lib-council", "summary");
        expect(globalStore.get(LIBRARY_COUNCIL_HOST.selAtom)).toBe("lib-council");
        expect(globalStore.get(LIBRARY_COUNCIL_HOST.viewAtom)).toBe("summary");
        LIBRARY_COUNCIL_HOST.open("lib-council", "map");
        expect(globalStore.get(LIBRARY_COUNCIL_HOST.viewAtom)).toBe("map");
        LIBRARY_COUNCIL_HOST.open("lib-council", "discussion", "seat-b");
        expect(globalStore.get(LIBRARY_COUNCIL_HOST.viewAtom)).toBe("discussion");
        expect(globalStore.get(LIBRARY_COUNCIL_HOST.onlyAtom("lib-council"))).toBe("seat-b");

        // the Agent centre kept what it showed: the council, its view, its seat filter, and its mode
        expect(globalStore.get(councilSelAtom)).toBe("agent-council");
        expect(globalStore.get(councilViewAtom)).toBe("map");
        expect(globalStore.get(councilOnlyAtom("agent-council"))).toBe("seat-a");
        expect(globalStore.get(councilOnlyAtom("lib-council"))).toBeNull();
        expect(globalStore.get(centerModeAtom)).toBe("terminal");
    });

    it("keeps the Councils tab showing, with no surface of its own to change", () => {
        LIBRARY_COUNCIL_HOST.open("lib-council", "map");
        expect(globalStore.get(libraryTabAtom)).toBe("councils");
    });

    it("has a Discussion show everyone again when the way in names no seat", () => {
        LIBRARY_COUNCIL_HOST.open("lib-council", "discussion", "seat-b");
        LIBRARY_COUNCIL_HOST.open("lib-council", "summary");
        expect(globalStore.get(libraryCouncilOnlyAtom("lib-council"))).toBeNull();
    });

    it("reads its own atoms, not Agent's", () => {
        expect(LIBRARY_COUNCIL_HOST.selAtom).toBe(libraryCouncilSelAtom);
        expect(LIBRARY_COUNCIL_HOST.viewAtom).toBe(libraryCouncilViewAtom);
        expect(LIBRARY_COUNCIL_HOST.onlyAtom).toBe(libraryCouncilOnlyAtom);
        expect(LIBRARY_COUNCIL_HOST.selAtom).not.toBe(AGENT_COUNCIL_HOST.selAtom);
    });
});

describe("AGENT_COUNCIL_HOST", () => {
    it("reads Agent's global atoms and opens a council in its centre column", () => {
        expect(AGENT_COUNCIL_HOST.selAtom).toBe(councilSelAtom);
        expect(AGENT_COUNCIL_HOST.viewAtom).toBe(councilViewAtom);
        expect(AGENT_COUNCIL_HOST.onlyAtom).toBe(councilOnlyAtom);
        AGENT_COUNCIL_HOST.open("c9", "summary");
        expect(globalStore.get(councilSelAtom)).toBe("c9");
        expect(globalStore.get(councilViewAtom)).toBe("summary");
        expect(globalStore.get(centerModeAtom)).toBe("council");
        expect(globalStore.get(libraryCouncilSelAtom)).toBeNull();
    });
});
