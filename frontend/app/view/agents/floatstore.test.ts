// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { afterEach, describe, expect, it, vi } from "vitest";

const win = vi.hoisted(() => ({
    isFullscreen: vi.fn(async () => false),
    isMaximized: vi.fn(async () => true),
    outerPosition: vi.fn(async () => ({ x: 0, y: 0 })),
    innerSize: vi.fn(async () => ({ width: 2560, height: 1400 })),
    unmaximize: vi.fn(async () => {}),
    setMinSize: vi.fn(async () => {}),
    setSize: vi.fn(async () => {}),
    setPosition: vi.fn(async () => {}),
    setAlwaysOnTop: vi.fn(async () => {}),
}));

vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn(async () => {}) }));
vi.mock("@tauri-apps/api/event", () => ({ listen: vi.fn(async () => () => {}) }));
vi.mock("@tauri-apps/api/window", () => {
    const monitor = { scaleFactor: 1.5, workArea: { position: { x: 0, y: 0 }, size: { width: 2560, height: 1400 } } };
    class Pair {
        constructor(
            public a: number,
            public b: number
        ) {}
    }
    return {
        getCurrentWindow: () => win,
        currentMonitor: async () => monitor,
        availableMonitors: async () => [monitor],
        cursorPosition: vi.fn(),
        primaryMonitor: vi.fn(),
        LogicalPosition: Pair,
        LogicalSize: Pair,
        PhysicalPosition: Pair,
        PhysicalSize: Pair,
    };
});
vi.mock("@/app/store/global", async () => {
    const { atom } = await import("jotai");
    return { getApi: vi.fn(), getSettingsKeyAtom: () => atom(null) };
});
vi.mock("@/app/view/jarvis/peekstore", () => ({ closePeek: vi.fn() }));
vi.mock("@/app/view/jarvis/petstore", async () => {
    const { atom } = await import("jotai");
    return { petPeekOpenAtom: atom(false) };
});
vi.mock("@/app/view/jarvis/teleportstore", () => ({
    clearTeleports: vi.fn(),
    hidePet: vi.fn(),
    playTeleport: vi.fn(),
}));
vi.mock("./railstore", async () => {
    const { atom } = await import("jotai");
    return { terminalFullscreenAtom: atom(false) };
});

import { globalStore } from "@/app/store/jotaiStore";
import { setPlatform } from "@/util/platformutil";
import { atom } from "jotai";
import type { AgentsViewModel } from "./agents";
// imported while the platform still reads as macOS, as the app does: setPlatform only runs later, in bootWaveCore
import { enterFloat, floatModeAtom } from "./floatstore";

describe("floatstore platform", () => {
    afterEach(() => {
        setPlatform("darwin");
        globalStore.set(floatModeAtom, false);
        vi.clearAllMocks();
    });

    it("takes a maximized window out of maximized on Windows, with the platform set after the module loaded", async () => {
        setPlatform("win32");
        await enterFloat({ surfaceAtom: atom("cockpit") } as unknown as AgentsViewModel);
        expect(globalStore.get(floatModeAtom)).toBe(true);
        expect(win.unmaximize).toHaveBeenCalledTimes(1);
    });

    it("leaves macOS's zoom to the frame set next", async () => {
        await enterFloat({ surfaceAtom: atom("cockpit") } as unknown as AgentsViewModel);
        expect(globalStore.get(floatModeAtom)).toBe(true);
        expect(win.unmaximize).not.toHaveBeenCalled();
    });
});
