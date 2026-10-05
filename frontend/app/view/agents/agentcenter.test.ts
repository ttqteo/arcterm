// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { globalStore } from "@/app/store/jotaiStore";
import { atom } from "jotai";
import { beforeEach, describe, expect, it } from "vitest";
import { centerForSelection, centerModeAtom, showHistory, showSession, showTerminal } from "./agentcenter";
import type { AgentsViewModel, SurfaceKey } from "./agents";

const stub = () =>
    ({
        surfaceAtom: atom<SurfaceKey>("cockpit"),
        sessionsSelAtom: atom("all"),
        sessionsMemberAtom: atom("lead"),
    }) as unknown as AgentsViewModel;

beforeEach(() => globalStore.set(centerModeAtom, "terminal"));

describe("centerModeAtom", () => {
    it("starts on the terminal", () => {
        expect(globalStore.get(centerModeAtom)).toBe("terminal");
    });
});

describe("centerForSelection", () => {
    it("reads one session in the session pane", () => {
        expect(centerForSelection("claude:abc")).toBe("session");
        expect(centerForSelection("pi:s9")).toBe("session");
    });
    it("leaves a run and the merged feed to History, which draws their detail", () => {
        expect(centerForSelection("run:r1")).toBe("history");
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

    it("showSession selects the session and opens the session pane", () => {
        const model = stub();
        showSession(model, "claude:abc");
        expect(globalStore.get(model.sessionsSelAtom)).toBe("claude:abc");
        expect(globalStore.get(model.sessionsMemberAtom)).toBe("lead");
        expect(globalStore.get(centerModeAtom)).toBe("session");
        expect(globalStore.get(model.surfaceAtom)).toBe("agent");
    });

    it("showSession sends a run's session to History with its member in view", () => {
        const model = stub();
        showSession(model, "run:r1", "t-2");
        expect(globalStore.get(model.sessionsSelAtom)).toBe("run:r1");
        expect(globalStore.get(model.sessionsMemberAtom)).toBe("t-2");
        expect(globalStore.get(centerModeAtom)).toBe("history");
    });
});
