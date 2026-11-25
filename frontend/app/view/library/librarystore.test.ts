// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { globalStore } from "@/app/store/jotaiStore";
import { atom } from "jotai";
import { beforeEach, describe, expect, it } from "vitest";
import { centerModeAtom, pairSelAtom } from "../agents/agentcenter";
import type { AgentsViewModel, SurfaceKey } from "../agents/agents";
import { AGENT_COUNCIL_HOST } from "../agents/councilhost";
import { councilOpenedAtom } from "../agents/councilopened";
import {
    councilAtom,
    councilLastViewAtom,
    councilListAtom,
    councilOnlyAtom,
    councilSelAtom,
    councilViewAtom,
} from "../agents/councilstore";
import { devMockPairsAtom } from "../agents/pairstore";
import { backToOrigin, forgetOrigin } from "../jarvis/returnsurface";
import {
    LIBRARY_COUNCIL_HOST,
    LIBRARY_TABS,
    leaveLibraryDetail,
    libraryBoardSelAtom,
    libraryConvKindsAtom,
    libraryConvViewAtom,
    libraryCouncilOnlyAtom,
    libraryCouncilSelAtom,
    libraryCouncilViewAtom,
    libraryPairSelAtom,
    libraryTabAtom,
    openCouncil,
    openPair,
    setLibraryCouncil,
    showConversationHistory,
    showLibrary,
    showLibraryBoard,
    showLibraryCouncil,
    showLibraryCouncils,
    showLibraryPair,
    showLibrarySession,
} from "./librarystore";

// `member` seeds sessionsMemberAtom, so a test can tell a member that was left alone from one that was set
const stub = (surface: SurfaceKey = "cockpit", member = "lead") =>
    ({
        surfaceAtom: atom<SurfaceKey>(surface),
        sessionsSelAtom: atom("all"),
        sessionsMemberAtom: atom(member),
    }) as unknown as AgentsViewModel;

const DAY = 24 * 60 * 60 * 1000;

const council = (id: string, extra: Partial<Council> = {}): Council =>
    ({
        id,
        project: "/work/a",
        feature: "F",
        experts: [],
        state: "done",
        round: 3,
        updated: Date.now() - 2 * DAY,
        summary: { text: "t", directions: [], outcomes: {}, at: Date.now() - 2 * DAY },
        ...extra,
    }) as Council;

// a mocked pair is as much of a PairView as the lists and openPair read: an id, a state and the synced flag
const mockPair = (id: string, state: string, synced = false) => ({ id, state, synced, project: "/work/a" }) as PairView;

beforeEach(() => {
    forgetOrigin();
    globalStore.set(libraryTabAtom, "conversations");
    globalStore.set(libraryConvViewAtom, "list");
    globalStore.set(libraryCouncilSelAtom, null);
    globalStore.set(libraryCouncilViewAtom, "discussion");
    globalStore.set(libraryPairSelAtom, null);
    globalStore.set(libraryConvKindsAtom, { judge: false, council: false });
    globalStore.set(devMockPairsAtom, null);
    globalStore.set(libraryBoardSelAtom, null);
    globalStore.set(centerModeAtom, "terminal");
    globalStore.set(councilSelAtom, null);
    globalStore.set(councilViewAtom, "discussion");
    globalStore.set(councilListAtom(""), null);
    // a council never opened counts as opened at seededAt, so with it now every council below is read unless a test says otherwise
    globalStore.set(councilOpenedAtom, { seededAt: Date.now(), opened: {} });
});

describe("Library's state", () => {
    it("has the Conversations, Canvases and Boards tabs, in that order, and opens on Conversations", () => {
        expect(LIBRARY_TABS).toEqual(["conversations", "canvases", "boards"]);
        expect(globalStore.get(libraryTabAtom)).toBe("conversations");
        expect(globalStore.get(libraryConvViewAtom)).toBe("list");
        expect(globalStore.get(libraryBoardSelAtom)).toBeNull();
        expect(globalStore.get(libraryCouncilSelAtom)).toBeNull();
        expect(globalStore.get(libraryPairSelAtom)).toBeNull();
        expect(globalStore.get(libraryCouncilViewAtom)).toBe("discussion");
        expect(globalStore.get(libraryCouncilOnlyAtom("c1"))).toBeNull();
        expect(globalStore.get(libraryConvKindsAtom)).toEqual({ judge: false, council: false });
    });
});

describe("showLibrary", () => {
    it("lands on Library and leaves the tab alone when none is named", () => {
        const model = stub();
        globalStore.set(libraryTabAtom, "boards");
        showLibrary(model);
        expect(globalStore.get(model.surfaceAtom)).toBe("library");
        expect(globalStore.get(libraryTabAtom)).toBe("boards");
    });

    it("opens the tab it is given", () => {
        const model = stub();
        showLibrary(model, "canvases");
        expect(globalStore.get(libraryTabAtom)).toBe("canvases");
        expect(globalStore.get(model.surfaceAtom)).toBe("library");
    });
});

describe("showConversationHistory", () => {
    it("opens Conversations on its list, though a session was left open full width there, and keeps the selection", () => {
        const model = stub();
        showLibrarySession(model, "claude:abc");
        globalStore.set(model.surfaceAtom, "agent");
        globalStore.set(libraryTabAtom, "boards");
        showConversationHistory(model);
        expect(globalStore.get(libraryTabAtom)).toBe("conversations");
        expect(globalStore.get(libraryConvViewAtom)).toBe("list");
        expect(globalStore.get(model.sessionsSelAtom)).toBe("claude:abc");
        expect(globalStore.get(model.surfaceAtom)).toBe("library");
    });
});

describe("showLibraryBoard", () => {
    it("opens Library's Boards tab on the board, from any surface", () => {
        const model = stub("cockpit");
        globalStore.set(libraryTabAtom, "canvases");
        showLibraryBoard(model, "arcterm", "b0a5b001");
        expect(globalStore.get(libraryBoardSelAtom)).toEqual({ project: "arcterm", boardId: "b0a5b001" });
        expect(globalStore.get(libraryTabAtom)).toBe("boards");
        expect(globalStore.get(model.surfaceAtom)).toBe("library");
    });

    it("remembers where the person came from, so Escape returns there", () => {
        const model = stub("jarvis");
        showLibraryBoard(model, "arcterm", "b0a5b001");
        backToOrigin();
        expect(globalStore.get(model.surfaceAtom)).toBe("jarvis");
    });

    it("replaces the board that was open", () => {
        const model = stub();
        showLibraryBoard(model, "arcterm", "b1");
        showLibraryBoard(model, "other", "b2");
        expect(globalStore.get(libraryBoardSelAtom)).toEqual({ project: "other", boardId: "b2" });
    });
});

describe("showLibrarySession", () => {
    it("opens one session full width on Conversations and leaves the member in view alone", () => {
        const model = stub("cockpit", "t-9");
        globalStore.set(libraryTabAtom, "boards");
        showLibrarySession(model, "claude:abc");
        expect(globalStore.get(model.sessionsSelAtom)).toBe("claude:abc");
        expect(globalStore.get(model.sessionsMemberAtom)).toBe("t-9");
        expect(globalStore.get(libraryTabAtom)).toBe("conversations");
        expect(globalStore.get(libraryConvViewAtom)).toBe("session");
        expect(globalStore.get(model.surfaceAtom)).toBe("library");
    });

    it("opens a run in its pane with its member in view", () => {
        const model = stub();
        showLibrarySession(model, "run:r1", "t-2");
        expect(globalStore.get(model.sessionsSelAtom)).toBe("run:r1");
        expect(globalStore.get(model.sessionsMemberAtom)).toBe("t-2");
        expect(globalStore.get(libraryConvViewAtom)).toBe("run");
        expect(globalStore.get(libraryTabAtom)).toBe("conversations");
        expect(globalStore.get(model.surfaceAtom)).toBe("library");
    });

    it("shows the merged feed as the list", () => {
        const model = stub();
        globalStore.set(libraryConvViewAtom, "session");
        showLibrarySession(model, "all");
        expect(globalStore.get(model.sessionsSelAtom)).toBe("all");
        expect(globalStore.get(libraryConvViewAtom)).toBe("list");
        expect(globalStore.get(libraryTabAtom)).toBe("conversations");
    });
});

describe("leaveLibraryDetail", () => {
    it("goes back to the list and to the surface that opened the session", () => {
        const model = stub("jarvis");
        showLibrarySession(model, "claude:abc");
        expect(globalStore.get(model.surfaceAtom)).toBe("library");
        leaveLibraryDetail();
        expect(globalStore.get(libraryConvViewAtom)).toBe("list");
        expect(globalStore.get(model.surfaceAtom)).toBe("jarvis");
    });

    it("stays on Library when nothing sent the person there", () => {
        const model = stub("library");
        globalStore.set(libraryConvViewAtom, "session");
        leaveLibraryDetail();
        expect(globalStore.get(libraryConvViewAtom)).toBe("list");
        expect(globalStore.get(model.surfaceAtom)).toBe("library");
    });

    it("stays on Library after the person moved on by hand and came back", () => {
        const model = stub("usage");
        showLibrarySession(model, "run:r1");
        globalStore.set(model.surfaceAtom, "cockpit"); // a rail click clears the trail
        globalStore.set(model.surfaceAtom, "library");
        leaveLibraryDetail();
        expect(globalStore.get(model.surfaceAtom)).toBe("library");
        expect(globalStore.get(libraryConvViewAtom)).toBe("list");
    });
});

describe("setLibraryCouncil", () => {
    it("opens the council on its Discussion in Library's atoms and leaves Agent's alone", () => {
        globalStore.set(councilSelAtom, "keep");
        globalStore.set(councilViewAtom, "summary");
        globalStore.set(libraryTabAtom, "boards");
        setLibraryCouncil("c1");
        expect(globalStore.get(libraryCouncilSelAtom)).toBe("c1");
        expect(globalStore.get(libraryCouncilViewAtom)).toBe("discussion");
        // the full-width council view of Conversations, not a tab of its own
        expect(globalStore.get(libraryTabAtom)).toBe("conversations");
        expect(globalStore.get(libraryConvViewAtom)).toBe("council");
        expect(globalStore.get(councilSelAtom)).toBe("keep");
        expect(globalStore.get(councilViewAtom)).toBe("summary");
        expect(globalStore.get(centerModeAtom)).toBe("terminal");
    });

    it("opens the view it is told to, and the report of a finished council when the way in names none", () => {
        globalStore.set(councilAtom("d1"), council("d1"));
        setLibraryCouncil("d1");
        expect(globalStore.get(libraryCouncilViewAtom)).toBe("summary");
        setLibraryCouncil("d1", "map");
        expect(globalStore.get(libraryCouncilViewAtom)).toBe("map");
        globalStore.set(councilAtom("d1"), null);
    });

    it("reopens a council on the view it was left on, reading the kept view councilLastViewAtom shares with Agent", () => {
        globalStore.set(councilAtom("d2"), council("d2"));
        setLibraryCouncil("d2", "discussion");
        expect(globalStore.get(councilLastViewAtom("d2"))).toEqual({
            view: "discussion",
            summaryAt: globalStore.get(councilAtom("d2"))!.summary!.at,
        });
        setLibraryCouncil("d2");
        expect(globalStore.get(libraryCouncilViewAtom)).toBe("discussion");
        globalStore.set(councilAtom("d2"), null);
        globalStore.set(councilLastViewAtom("d2"), null);
    });

    it("finds a council it only has in the list", () => {
        globalStore.set(councilListAtom(""), [council("l1")]);
        setLibraryCouncil("l1");
        expect(globalStore.get(libraryCouncilViewAtom)).toBe("summary");
    });

    it("shows one seat's messages only when asked, and everyone on any other way in", () => {
        setLibraryCouncil("c3", "discussion", "ux");
        expect(globalStore.get(libraryCouncilOnlyAtom("c3"))).toBe("ux");
        expect(globalStore.get(councilOnlyAtom("c3"))).toBeNull();
        setLibraryCouncil("c3", "summary");
        expect(globalStore.get(libraryCouncilOnlyAtom("c3"))).toBeNull();
    });
});

describe("showLibraryCouncil", () => {
    it("sets the council like setLibraryCouncil and lands on Library", () => {
        const model = stub();
        showLibraryCouncil(model, "c1", "summary", undefined);
        expect(globalStore.get(libraryCouncilSelAtom)).toBe("c1");
        expect(globalStore.get(libraryCouncilViewAtom)).toBe("summary");
        expect(globalStore.get(libraryTabAtom)).toBe("conversations");
        expect(globalStore.get(libraryConvViewAtom)).toBe("council");
        expect(globalStore.get(model.surfaceAtom)).toBe("library");
    });

    it("keeps the view and the seat it is given", () => {
        const model = stub();
        showLibraryCouncil(model, "c2", "discussion", "ux");
        expect(globalStore.get(libraryCouncilViewAtom)).toBe("discussion");
        expect(globalStore.get(libraryCouncilOnlyAtom("c2"))).toBe("ux");
        expect(globalStore.get(libraryConvViewAtom)).toBe("council");
    });
});

describe("leaveLibraryDetail from a council", () => {
    it("returns Conversations to its list, clears the council and goes back to the surface that opened it", () => {
        const model = stub("cockpit");
        showLibraryCouncil(model, "c1");
        leaveLibraryDetail();
        expect(globalStore.get(libraryCouncilSelAtom)).toBeNull();
        expect(globalStore.get(libraryConvViewAtom)).toBe("list");
        expect(globalStore.get(libraryTabAtom)).toBe("conversations");
        expect(globalStore.get(model.surfaceAtom)).toBe("cockpit");
    });

    it("stays on Library when nothing sent the person there", () => {
        const model = stub("library");
        globalStore.set(libraryConvViewAtom, "council");
        globalStore.set(libraryCouncilSelAtom, "c1");
        leaveLibraryDetail();
        expect(globalStore.get(libraryCouncilSelAtom)).toBeNull();
        expect(globalStore.get(libraryConvViewAtom)).toBe("list");
        expect(globalStore.get(model.surfaceAtom)).toBe("library");
    });
});

describe("showLibraryCouncils", () => {
    it("opens Conversations' list with the Council chip alone on, whatever was open", () => {
        const model = stub();
        globalStore.set(libraryTabAtom, "boards");
        globalStore.set(libraryConvViewAtom, "council");
        globalStore.set(libraryConvKindsAtom, { judge: true, council: false });
        showLibraryCouncils(model);
        expect(globalStore.get(libraryConvKindsAtom)).toEqual({ judge: false, council: true });
        expect(globalStore.get(libraryTabAtom)).toBe("conversations");
        expect(globalStore.get(libraryConvViewAtom)).toBe("list");
        expect(globalStore.get(model.surfaceAtom)).toBe("library");
    });

    it("remembers where the person came from, so Escape returns there", () => {
        const model = stub("jarvis");
        showLibraryCouncils(model);
        backToOrigin();
        expect(globalStore.get(model.surfaceAtom)).toBe("jarvis");
    });
});

describe("showLibraryPair and openPair", () => {
    it("showLibraryPair opens the pair in Conversations' full-width pair view and remembers the way back", () => {
        const model = stub("jarvis");
        globalStore.set(libraryTabAtom, "boards");
        showLibraryPair(model, "p1");
        expect(globalStore.get(libraryPairSelAtom)).toBe("p1");
        expect(globalStore.get(libraryTabAtom)).toBe("conversations");
        expect(globalStore.get(libraryConvViewAtom)).toBe("pair");
        expect(globalStore.get(model.surfaceAtom)).toBe("library");
        leaveLibraryDetail();
        expect(globalStore.get(libraryConvViewAtom)).toBe("list");
        expect(globalStore.get(libraryPairSelAtom)).toBeNull();
        expect(globalStore.get(model.surfaceAtom)).toBe("jarvis");
    });

    it("openPair sends a pair of the live list to Agent's centre", () => {
        const model = stub("cockpit");
        globalStore.set(devMockPairsAtom, [mockPair("live1", "relaying")]);
        openPair(model, "live1");
        expect(globalStore.get(pairSelAtom)).toBe("live1");
        expect(globalStore.get(centerModeAtom)).toBe("pair");
        expect(globalStore.get(model.surfaceAtom)).toBe("agent");
        expect(globalStore.get(libraryPairSelAtom)).toBeNull();
        globalStore.set(centerModeAtom, "terminal");
    });

    it("openPair sends an ended pair, a synced one and one nobody lists to Library's pair view", () => {
        for (const [id, mock] of [
            ["ended1", mockPair("ended1", "ended")],
            ["synced1", mockPair("synced1", "relaying", true)],
            ["unknown1", null],
        ] as const) {
            const model = stub("cockpit");
            globalStore.set(devMockPairsAtom, mock == null ? [] : [mock]);
            globalStore.set(libraryConvViewAtom, "list");
            openPair(model, id);
            expect(globalStore.get(libraryPairSelAtom)).toBe(id);
            expect(globalStore.get(libraryConvViewAtom)).toBe("pair");
            expect(globalStore.get(libraryTabAtom)).toBe("conversations");
            expect(globalStore.get(model.surfaceAtom)).toBe("library");
            expect(globalStore.get(centerModeAtom)).toBe("terminal");
        }
    });
});

describe("openCouncil", () => {
    it("sends a running council to Agent", () => {
        const model = stub();
        globalStore.set(councilListAtom(""), [council("r1", { state: "running" })]);
        openCouncil(model, "r1");
        expect(globalStore.get(councilSelAtom)).toBe("r1");
        expect(globalStore.get(centerModeAtom)).toBe("council");
        expect(globalStore.get(model.surfaceAtom)).toBe("agent");
        expect(globalStore.get(libraryCouncilSelAtom)).toBeNull();
    });

    it("sends a council that waits on the person, or waits its turn, to Agent", () => {
        for (const state of ["awaiting-you", "queued"]) {
            const model = stub();
            globalStore.set(councilAtom(`s-${state}`), council(`s-${state}`, { state }));
            openCouncil(model, `s-${state}`);
            expect(globalStore.get(model.surfaceAtom)).toBe("agent");
            globalStore.set(councilAtom(`s-${state}`), null);
        }
    });

    it("sends a pinned council to Agent however old it is", () => {
        const model = stub();
        globalStore.set(councilAtom("p1"), council("p1", { pinned: 1 }));
        openCouncil(model, "p1");
        expect(globalStore.get(councilSelAtom)).toBe("p1");
        expect(globalStore.get(model.surfaceAtom)).toBe("agent");
        globalStore.set(councilAtom("p1"), null);
    });

    it("sends a council that is not loaded at all to Agent: it is new, so live", () => {
        const model = stub();
        openCouncil(model, "nobody");
        expect(globalStore.get(councilSelAtom)).toBe("nobody");
        expect(globalStore.get(centerModeAtom)).toBe("council");
        expect(globalStore.get(model.surfaceAtom)).toBe("agent");
        expect(globalStore.get(libraryCouncilSelAtom)).toBeNull();
    });

    it("sends a council that ended a day ago and was read to Conversations' full-width council view", () => {
        const model = stub();
        globalStore.set(councilAtom("old"), council("old"));
        openCouncil(model, "old");
        expect(globalStore.get(libraryCouncilSelAtom)).toBe("old");
        expect(globalStore.get(libraryCouncilViewAtom)).toBe("summary");
        expect(globalStore.get(libraryTabAtom)).toBe("conversations");
        expect(globalStore.get(libraryConvViewAtom)).toBe("council");
        expect(globalStore.get(model.surfaceAtom)).toBe("library");
        // Agent's own selection is not touched
        expect(globalStore.get(councilSelAtom)).toBeNull();
        expect(globalStore.get(centerModeAtom)).toBe("terminal");
        globalStore.set(councilAtom("old"), null);
    });

    it("finds the council in the list when it is not loaded by id, and passes the view and the seat on", () => {
        const model = stub();
        globalStore.set(councilListAtom(""), [council("l2")]);
        openCouncil(model, "l2", "discussion", "ux");
        expect(globalStore.get(libraryCouncilSelAtom)).toBe("l2");
        expect(globalStore.get(libraryCouncilViewAtom)).toBe("discussion");
        expect(globalStore.get(libraryCouncilOnlyAtom("l2"))).toBe("ux");
        const agentModel = stub();
        globalStore.set(councilListAtom(""), [council("l3", { state: "running" })]);
        openCouncil(agentModel, "l3", "map", "ux");
        expect(globalStore.get(councilViewAtom)).toBe("map");
        expect(globalStore.get(councilOnlyAtom("l3"))).toBe("ux");
    });

    it("keeps a council the person has not read since it ended on Agent", () => {
        const model = stub();
        globalStore.set(councilAtom("u1"), council("u1"));
        // the map was seeded before it ended and it was never opened since: unread, so the tree still lists it
        globalStore.set(councilOpenedAtom, { seededAt: Date.now() - 5 * DAY, opened: {} });
        openCouncil(model, "u1");
        expect(globalStore.get(model.surfaceAtom)).toBe("agent");
        globalStore.set(councilAtom("u1"), null);
    });
});

describe("the council hosts", () => {
    it("Library's host reads and writes Library's atoms, and opening through it changes no surface", () => {
        expect(LIBRARY_COUNCIL_HOST.kind).toBe("library");
        expect(LIBRARY_COUNCIL_HOST.selAtom).toBe(libraryCouncilSelAtom);
        expect(LIBRARY_COUNCIL_HOST.viewAtom).toBe(libraryCouncilViewAtom);
        expect(LIBRARY_COUNCIL_HOST.onlyAtom("c1")).toBe(libraryCouncilOnlyAtom("c1"));
        LIBRARY_COUNCIL_HOST.open("c9", "map", "ux");
        expect(globalStore.get(libraryCouncilSelAtom)).toBe("c9");
        expect(globalStore.get(libraryCouncilViewAtom)).toBe("map");
        expect(globalStore.get(libraryCouncilOnlyAtom("c9"))).toBe("ux");
        expect(globalStore.get(libraryTabAtom)).toBe("conversations");
        expect(globalStore.get(libraryConvViewAtom)).toBe("council");
        expect(globalStore.get(councilSelAtom)).toBeNull();
    });

    it("Agent's host is the global council atoms, and opening through it shows the council in the centre", () => {
        expect(AGENT_COUNCIL_HOST.kind).toBe("agent");
        expect(AGENT_COUNCIL_HOST.selAtom).toBe(councilSelAtom);
        expect(AGENT_COUNCIL_HOST.viewAtom).toBe(councilViewAtom);
        expect(AGENT_COUNCIL_HOST.onlyAtom("c1")).toBe(councilOnlyAtom("c1"));
        AGENT_COUNCIL_HOST.open("c8", "summary", "ux");
        expect(globalStore.get(councilSelAtom)).toBe("c8");
        expect(globalStore.get(councilViewAtom)).toBe("summary");
        expect(globalStore.get(councilOnlyAtom("c8"))).toBe("ux");
        expect(globalStore.get(centerModeAtom)).toBe("council");
        expect(globalStore.get(libraryCouncilSelAtom)).toBeNull();
    });
});
