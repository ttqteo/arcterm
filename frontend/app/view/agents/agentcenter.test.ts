// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { globalStore } from "@/app/store/jotaiStore";
import { atom, createStore } from "jotai";
import { beforeEach, describe, expect, it } from "vitest";
import { centerForSelection, centerModeAtom, showHistory, showSession, showTerminal } from "./agentcenter";
import type { AgentsViewModel, SurfaceKey } from "./agents";

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
