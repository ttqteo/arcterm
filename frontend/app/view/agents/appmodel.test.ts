// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { describe, expect, it } from "vitest";
import {
    afterProbe,
    APP_START_TIMEOUT_MS,
    appCloseTitle,
    appCwd,
    appFailLine,
    appFrameName,
    focusedAppTab,
    appHost,
    appProjectName,
    appShows,
    appUrlOk,
    appUrlProblem,
    appWaitLine,
    isAppTool,
    startingApp,
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

describe("tools and folders", () => {
    it("is an app only with a url", () => {
        expect(isAppTool({ url: URL_OK })).toBe(true);
        expect(isAppTool({})).toBe(false);
        expect(isAppTool(undefined)).toBe(false);
    });

    it("runs in its own dir, else where the tool would open", () => {
        const ctx = { agentCwd: "/w/agent", projectRoot: "/w", home: "~" };
        expect(appCwd({ opensin: "agent", dir: "~/dev/hong" }, ctx)).toBe("~/dev/hong");
        expect(appCwd({ opensin: "root", dir: " " }, ctx)).toBe("/w");
        expect(appCwd({ opensin: "home" }, ctx)).toBe("~");
    });

    it("files an app with a folder under the project that folder is in, else Home", () => {
        const projects = { arcterm: { path: "D:\\code\\arcterm" }, hong: { path: "/Users/q/dev/hong" } };
        expect(appProjectName("~/dev/hong", projects, "/Users/q", "Home")).toBe("hong");
        expect(appProjectName("/Users/q/dev/hong/web", projects, "/Users/q", "Home")).toBe("hong");
        expect(appProjectName("D:/code/arcterm", projects, "C:/Users/q", "Home")).toBe("arcterm");
        expect(appProjectName("~/dev/other", projects, "/Users/q", "Home")).toBe("Home");
        expect(appProjectName("~/dev/hong", projects, "", "Home")).toBe("Home");
    });

    it("names host and port", () => {
        expect(appHost("http://127.0.0.1:8386/dash")).toBe("127.0.0.1:8386");
    });
});

describe("the app's phases", () => {
    const t0 = 1_000_000;
    const s = startingApp("hong", URL_OK, true, t0);

    it("waits while the page does not answer, with the waiting card in the terminal's place", () => {
        const next = afterProbe(s, false, t0 + 5_000);
        expect(next).toBe(s);
        expect(appShows(next)).toBe("waiting");
        expect(appWaitLine(next, t0 + 5_400)).toBe("Waiting for 127.0.0.1:8386 · 5 s");
    });

    it("opens on the first answer", () => {
        const next = afterProbe(s, true, t0 + 2_000);
        expect(next.phase).toBe("open");
        expect(appShows(next)).toBe("page");
    });

    it("fails past the timeout and shows the terminal with its output", () => {
        const next = afterProbe(s, false, t0 + APP_START_TIMEOUT_MS);
        expect(next.phase).toBe("failed");
        expect(next.view).toBe("log");
        expect(appShows(next)).toBe("terminal");
        expect(appFailLine(next)).toBe("Nothing answered on 127.0.0.1:8386 after 30 s");
    });

    it("leaves an open or failed app alone", () => {
        const open = afterProbe(s, true, t0);
        expect(afterProbe(open, false, t0 + APP_START_TIMEOUT_MS * 2)).toBe(open);
        const failed = afterProbe(s, false, t0 + APP_START_TIMEOUT_MS);
        expect(afterProbe(failed, true, t0 + APP_START_TIMEOUT_MS + 1)).toBe(failed);
    });

    it("shows the terminal when Log is picked, and no state is a plain terminal", () => {
        expect(appShows({ ...afterProbe(s, true, t0), view: "log" })).toBe("terminal");
        expect(appShows(undefined)).toBe("terminal");
    });

    it("stops only a server arcterm started", () => {
        expect(appCloseTitle("Hóng", true)).toBe("Stop Hóng");
        expect(appCloseTitle("Hóng", false)).toMatch(/keeps running/);
        expect(appFailLine({ url: URL_OK, owned: false })).toBe("Nothing answers on 127.0.0.1:8386");
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
