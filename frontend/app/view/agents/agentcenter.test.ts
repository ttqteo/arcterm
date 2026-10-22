// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { globalStore } from "@/app/store/jotaiStore";
import { atom, createStore } from "jotai";
import { beforeEach, describe, expect, it } from "vitest";
import {
    centerForSelection,
    centerModeAtom,
    showCanvases,
    showCouncil,
    showCouncilSetup,
    showHistory,
    showSession,
    showTerminal,
} from "./agentcenter";
import type { AgentsViewModel, SurfaceKey } from "./agents";
import { emptyCouncilDraft } from "./councilmodel";
import {
    councilAtom,
    councilListAtom,
    councilSelAtom,
    councilSetupDraftAtom,
    councilSetupProjectAtom,
    councilViewAtom,
} from "./councilstore";

// `member` seeds sessionsMemberAtom, so a test can tell a member that was left alone from one that was set
const stub = (member = "lead") =>
    ({
        surfaceAtom: atom<SurfaceKey>("cockpit"),
        sessionsSelAtom: atom("all"),
        sessionsMemberAtom: atom(member),
    }) as unknown as AgentsViewModel;

beforeEach(() => globalStore.set(centerModeAtom, "terminal"));

describe("centerModeAtom", () => {
    it("starts on the terminal", () => {
        // a fresh store, not globalStore: beforeEach has already set that one
        expect(createStore().get(centerModeAtom)).toBe("terminal");
    });
});

describe("centerForSelection", () => {
    it("reads one session in the session pane", () => {
        expect(centerForSelection("claude:abc")).toBe("session");
        expect(centerForSelection("pi:s9")).toBe("session");
    });
    it("reads a run in the run pane, and leaves the merged feed to History, which draws its detail", () => {
        expect(centerForSelection("run:r1")).toBe("run");
        expect(centerForSelection("all")).toBe("history");
    });
});

describe("openers", () => {
    it("showTerminal returns the centre to the terminal", () => {
        globalStore.set(centerModeAtom, "history");
        showTerminal();
        expect(globalStore.get(centerModeAtom)).toBe("terminal");
    });

    it("showHistory opens History and switches to the Agent surface", () => {
        const model = stub();
        showHistory(model);
        expect(globalStore.get(centerModeAtom)).toBe("history");
        expect(globalStore.get(model.surfaceAtom)).toBe("agent");
    });

    it("showCanvases opens the gallery and switches to the Agent surface", () => {
        const model = stub();
        showCanvases(model);
        expect(globalStore.get(centerModeAtom)).toBe("canvases");
        expect(globalStore.get(model.surfaceAtom)).toBe("agent");
    });

    it("showSession selects the session, opens the session pane and leaves the member in view alone", () => {
        const model = stub("t-9");
        showSession(model, "claude:abc");
        expect(globalStore.get(model.sessionsSelAtom)).toBe("claude:abc");
        expect(globalStore.get(model.sessionsMemberAtom)).toBe("t-9");
        expect(globalStore.get(centerModeAtom)).toBe("session");
        expect(globalStore.get(model.surfaceAtom)).toBe("agent");
    });

    it("showSession opens a run's session in the run pane with its member in view", () => {
        const model = stub();
        showSession(model, "run:r1", "t-2");
        expect(globalStore.get(model.sessionsSelAtom)).toBe("run:r1");
        expect(globalStore.get(model.sessionsMemberAtom)).toBe("t-2");
        expect(globalStore.get(centerModeAtom)).toBe("run");
    });
});

describe("council openers", () => {
    beforeEach(() => {
        globalStore.set(councilSelAtom, null);
        globalStore.set(councilViewAtom, "discussion");
        globalStore.set(councilSetupProjectAtom, null);
        globalStore.set(councilSetupDraftAtom("/work/a"), null);
        globalStore.set(councilSetupDraftAtom("/work/b"), null);
    });

    it("showCouncil opens the council on its Discussion, and on the Summary when asked", () => {
        showCouncil("c1");
        expect(globalStore.get(councilSelAtom)).toBe("c1");
        expect(globalStore.get(councilViewAtom)).toBe("discussion");
        expect(globalStore.get(centerModeAtom)).toBe("council");
        showCouncil("c2", "summary");
        expect(globalStore.get(councilSelAtom)).toBe("c2");
        expect(globalStore.get(councilViewAtom)).toBe("summary");
    });

    describe("with no view", () => {
        const done = (id: string, extra: Partial<Council> = {}): Council =>
            ({
                id,
                project: "/work/a",
                feature: "F",
                experts: [],
                state: "done",
                round: 3,
                summary: { text: "t", directions: [], outcomes: {}, at: 1 },
                ...extra,
            }) as Council;

        beforeEach(() => {
            globalStore.set(councilAtom("d1"), null);
            globalStore.set(councilAtom("r1"), null);
            globalStore.set(councilListAtom(""), null);
        });

        it("opens the report of a finished council it has by id", () => {
            globalStore.set(councilAtom("d1"), done("d1"));
            showCouncil("d1");
            expect(globalStore.get(councilViewAtom)).toBe("summary");
        });

        it("opens the report of a finished council it only has in the list", () => {
            globalStore.set(councilListAtom(""), [done("d1")]);
            showCouncil("d1");
            expect(globalStore.get(councilViewAtom)).toBe("summary");
        });

        it("opens the discussion of a running council, of a finished one with no summary, and of one it does not know", () => {
            globalStore.set(councilListAtom(""), [
                done("r1", { state: "running" }),
                done("n1", { summary: undefined }),
            ]);
            showCouncil("r1");
            expect(globalStore.get(councilViewAtom)).toBe("discussion");
            showCouncil("n1");
            expect(globalStore.get(councilViewAtom)).toBe("discussion");
            showCouncil("nobody");
            expect(globalStore.get(councilViewAtom)).toBe("discussion");
        });

        it("keeps the view it is told to open", () => {
            globalStore.set(councilAtom("d1"), done("d1"));
            showCouncil("d1", "discussion");
            expect(globalStore.get(councilViewAtom)).toBe("discussion");
        });
    });

    it("showCouncil leaves the surface alone without a model, and lands on Agent with one", () => {
        const model = stub();
        showCouncil("c1");
        expect(globalStore.get(model.surfaceAtom)).toBe("cockpit");
        showCouncil("c1", "discussion", model);
        expect(globalStore.get(model.surfaceAtom)).toBe("agent");
    });

    it("showCouncilSetup opens Setup on a blank draft for the project", () => {
        showCouncilSetup("/work/a");
        expect(globalStore.get(councilViewAtom)).toBe("setup");
        expect(globalStore.get(centerModeAtom)).toBe("council");
        expect(globalStore.get(councilSetupProjectAtom)).toBe("/work/a");
        expect(globalStore.get(councilSetupDraftAtom("/work/a"))).toEqual(emptyCouncilDraft("/work/a"));
    });

    it("showCouncilSetup keeps the draft the person left, and starts again from a prefill over a blank one", () => {
        showCouncilSetup("/work/a", { feature: "Rail apps", files: ["a.ts"] });
        expect(globalStore.get(councilSetupDraftAtom("/work/a"))).toEqual({
            ...emptyCouncilDraft("/work/a"),
            feature: "Rail apps",
            files: ["a.ts"],
        });
        showCouncil("c1");
        showCouncilSetup("/work/a");
        expect(globalStore.get(councilSetupDraftAtom("/work/a"))?.feature).toBe("Rail apps");
        // a prefill replaces the draft rather than merging into it: Run again must not inherit the old files
        showCouncilSetup("/work/a", { question: "Why?" });
        expect(globalStore.get(councilSetupDraftAtom("/work/a"))).toEqual({
            ...emptyCouncilDraft("/work/a"),
            question: "Why?",
        });
    });

    it("showCouncilSetup keeps each project's draft apart and lands on Agent with a model", () => {
        const model = stub();
        showCouncilSetup("/work/a", { feature: "A" });
        showCouncilSetup("/work/b", { feature: "B" }, model);
        expect(globalStore.get(councilSetupProjectAtom)).toBe("/work/b");
        expect(globalStore.get(councilSetupDraftAtom("/work/a"))?.feature).toBe("A");
        expect(globalStore.get(councilSetupDraftAtom("/work/b"))?.feature).toBe("B");
        expect(globalStore.get(model.surfaceAtom)).toBe("agent");
    });
});
