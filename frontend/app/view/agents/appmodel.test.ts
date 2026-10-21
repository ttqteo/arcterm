// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { describe, expect, it } from "vitest";
import {
    APP_FRAME_IDLE_MS,
    appFrameName,
    appHost,
    appShows,
    appUrlOk,
    appUrlProblem,
    appWaitLine,
    focusedAppTab,
    isAppTool,
    keptAppFrames,
    pageChordKeyEvent,
    serviceAppState,
} from "./appmodel";

const URL_OK = "http://127.0.0.1:8386";

describe("appUrlOk", () => {
    it("takes http on 127.0.0.1 with a port, and nothing else", () => {
        expect(appUrlOk(URL_OK)).toBe(true);
        expect(appUrlOk(" http://127.0.0.1:8386/dash?x=1 ")).toBe(true);
        expect(appUrlOk("http://127.0.0.1")).toBe(false);
        expect(appUrlOk("http://localhost:8386")).toBe(false);
        expect(appUrlOk("https://127.0.0.1:8386")).toBe(false);
        expect(appUrlOk("http://10.0.0.2:8386")).toBe(false);
        expect(appUrlOk("http://u:p@127.0.0.1:8386")).toBe(false);
        expect(appUrlOk("127.0.0.1:8386")).toBe(false);
    });

    it("says nothing about an empty page field, which is a plain tool", () => {
        expect(appUrlProblem("")).toBeNull();
        expect(appUrlProblem(URL_OK)).toBeNull();
        expect(appUrlProblem("http://localhost:3000")).toMatch(/127\.0\.0\.1/);
    });
});

describe("tools and pages", () => {
    it("is an app with a url, or on a port arcterm picks", () => {
        expect(isAppTool({ url: URL_OK })).toBe(true);
        expect(isAppTool({ port: "auto" })).toBe(true);
        expect(isAppTool({ port: "8386" })).toBe(false);
        expect(isAppTool({})).toBe(false);
        expect(isAppTool(undefined)).toBe(false);
    });

    it("names host and port", () => {
        expect(appHost("http://127.0.0.1:8386/dash")).toBe("127.0.0.1:8386");
    });
});

describe("a service as the app pane shows it", () => {
    const svc = (state: string, over: Partial<ServiceStatus> = {}): ServiceStatus => ({
        id: "hong",
        name: "Hóng",
        command: "npm run dash",
        dir: "~/dev/hong",
        project: "hong",
        state,
        port: 8386,
        url: "http://127.0.0.1:8386/",
        tabid: "t1",
        blockid: "b1",
        startedms: 1_000_000,
        autostart: true,
        ...over,
    });

    it("opens the page of a running service the app started", () => {
        const a = serviceAppState(svc("running"), "page", 0);
        expect(a).toMatchObject({ phase: "open", url: "http://127.0.0.1:8386/", owned: true, toolId: "hong" });
        expect(appShows(a)).toBe("page");
    });

    it("opens the page of a service running elsewhere, which arcterm did not start", () => {
        const a = serviceAppState(svc("elsewhere"), "page", 0);
        expect(a).toMatchObject({ phase: "open", owned: false });
        expect(appShows(a)).toBe("page");
    });

    it("waits while a service starts, with the waiting card in the terminal's place", () => {
        const a = serviceAppState(svc("starting"), "page", 0);
        expect(a.phase).toBe("starting");
        expect(appShows(a)).toBe("waiting");
        expect(appWaitLine(a, 1_005_400)).toBe("Waiting for 127.0.0.1:8386 · 5 s");
    });

    it("fails every other state, which shows the log", () => {
        for (const state of ["crashed", "porttaken", "nopage", "retrying", "sleeping"]) {
            const a = serviceAppState(svc(state, { url: undefined, startedms: undefined }), "page", 0);
            expect(a.phase).toBe("failed");
            expect(a.owned).toBe(true);
            expect(appShows(a)).toBe("terminal");
        }
    });

    it("keeps the person's picks: Log shows the terminal, Home's reloads key the frame", () => {
        const a = serviceAppState(svc("running"), "log", 3);
        expect(a).toMatchObject({ view: "log", reloads: 3 });
        expect(appShows(a)).toBe("terminal");
        expect(appShows(undefined)).toBe("terminal");
    });

    it("counts no seconds before the service has a start time", () => {
        expect(appWaitLine({ url: URL_OK, startedMs: 0 }, 5_000_000)).toBe("Waiting for 127.0.0.1:8386 · 0 s");
    });
});

describe("the app frame Reload reaches", () => {
    const el = (tagName: string, attrs: Record<string, string>) => ({
        tagName,
        getAttribute: (name: string) => attrs[name] ?? null,
    });

    it("names the frame by its terminal tab", () => {
        expect(appFrameName("t1")).toBe("arc-app-t1");
    });
    it("finds the app whose frame holds the focus, and none elsewhere", () => {
        expect(focusedAppTab(el("IFRAME", { "data-app-frame": "t1" }))).toBe("t1");
        expect(focusedAppTab(el("IFRAME", {}))).toBeNull(); // a canvas board's frame, not an app's
        expect(focusedAppTab(el("TEXTAREA", { "data-app-frame": "t1" }))).toBeNull();
        expect(focusedAppTab(null)).toBeNull();
    });
});

describe("the pages kept loaded out of sight", () => {
    const now = 1_000_000_000;
    const open = { phase: "open" as const };
    const states = { a: open, b: open, c: { phase: "starting" as const }, d: { phase: "failed" as const } };

    it("keeps the one on screen and each seen within the idle limit, in the states' order", () => {
        const seen = { b: now - APP_FRAME_IDLE_MS / 2, a: now - APP_FRAME_IDLE_MS + 1 };
        expect(keptAppFrames(states, null, seen, now)).toEqual(["a", "b"]);
        expect(keptAppFrames(states, "b", {}, now)).toEqual(["b"]);
    });
    it("drops one past the limit, unless it is on screen", () => {
        const seen = { a: now - APP_FRAME_IDLE_MS, b: now - 1 };
        expect(keptAppFrames(states, null, seen, now)).toEqual(["b"]);
        expect(keptAppFrames(states, "a", seen, now)).toEqual(["a", "b"]);
    });
    it("never keeps a page that is not open", () => {
        expect(keptAppFrames(states, "c", { c: now, d: now }, now)).toEqual([]);
    });
});

describe("pageChordKeyEvent", () => {
    const chord = (vk: number, mods: Partial<{ ctrl: boolean; shift: boolean; alt: boolean }> = {}) =>
        pageChordKeyEvent({ vk, ctrl: false, shift: false, alt: false, ...mods });

    it("names a letter as the browser does, upper case with Shift", () => {
        expect(chord(0x4b, { ctrl: true })).toMatchObject({ key: "k", code: "KeyK", ctrlKey: true, shiftKey: false });
        expect(chord(0x50, { ctrl: true, shift: true })).toMatchObject({ key: "P", code: "KeyP", shiftKey: true });
    });
    it("names digits, Tab, arrows, function keys and brackets", () => {
        expect(chord(0x31, { alt: true })).toMatchObject({ key: "1", code: "Digit1", altKey: true });
        expect(chord(0x09, { ctrl: true })).toMatchObject({ key: "Tab", code: "Tab" });
        expect(chord(0x25, { alt: true })).toMatchObject({ key: "ArrowLeft", code: "ArrowLeft" });
        expect(chord(0x71, { ctrl: true })).toMatchObject({ key: "F2", code: "F2" });
        expect(chord(0xdb, { ctrl: true })).toMatchObject({ key: "[", code: "BracketLeft" });
        expect(chord(0x20, { ctrl: true })).toMatchObject({ key: " ", code: "Space" });
    });
    it("leaves the page its own copy, cut, paste, select all, undo and redo", () => {
        for (const vk of [0x41, 0x43, 0x56, 0x58, 0x59, 0x5a]) {
            expect(chord(vk, { ctrl: true })).toBeNull();
            expect(chord(vk, { ctrl: true, shift: true })).toBeNull();
        }
        expect(chord(0x43, { alt: true })).toMatchObject({ key: "c" });
    });
    it("names no key it does not know", () => {
        expect(chord(0xff, { ctrl: true })).toBeNull();
    });
});
