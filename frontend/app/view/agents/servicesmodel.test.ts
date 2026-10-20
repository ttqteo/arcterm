// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { describe, expect, it } from "vitest";
import { RAIL_FULL_TITLE } from "./railapps";
import {
    canRestart,
    canStart,
    canStop,
    serviceHeaderLine,
    serviceMenuChoices,
    serviceRowWords,
    treeServiceInput,
    upFor,
    withAutostart,
} from "./servicesmodel";

const NOW = 1_800_000_000_000;

function svc(state: string, extra: Partial<ServiceStatus> = {}): ServiceStatus {
    return {
        id: extra.id ?? `svc-${state}`,
        name: extra.name ?? `svc-${state}`,
        command: "npm run dev",
        dir: "~/proj",
        project: "proj",
        state,
        autostart: true,
        ...extra,
    };
}

describe("serviceRowWords", () => {
    it("sleeping: a hollow muted dot and no action", () => {
        const w = serviceRowWords(svc("sleeping"), NOW);
        expect(w).toEqual({ words: "sleeping", tone: "muted", dot: "hollow" });
        expect(w).not.toHaveProperty("action");
    });

    it("a state it does not know reads as sleeping (an old wavesrv's stopped included)", () => {
        for (const state of ["stopped", "mystery"]) {
            const w = serviceRowWords(svc(state), NOW);
            expect(w).toEqual({ words: "sleeping", tone: "muted", dot: "hollow" });
            expect(w).not.toHaveProperty("action");
        }
    });

    it("starting: pulsing", () => {
        expect(serviceRowWords(svc("starting"), NOW)).toEqual({
            words: "starting…",
            tone: "working",
            dot: "pulse",
        });
    });

    it("running: the port and no words", () => {
        expect(serviceRowWords(svc("running", { port: 8386, startedms: NOW - 8_040_000 }), NOW)).toEqual({
            words: "",
            port: ":8386",
            tone: "working",
            dot: "solid",
        });
    });

    it("elsewhere: not started by arcterm, a hollow dot, the port", () => {
        expect(serviceRowWords(svc("elsewhere", { port: 8386 }), NOW)).toEqual({
            words: "not started by arcterm",
            port: ":8386",
            tone: "working",
            dot: "hollow",
        });
    });

    it("retrying: the seconds left to the retry", () => {
        expect(serviceRowWords(svc("retrying", { retryatms: NOW + 8_000 }), NOW)).toEqual({
            words: "crashed · retry in 8s",
            tone: "error",
            dot: "solid",
        });
    });

    it("retrying: rounds a part of a second up, and never goes below 0s", () => {
        expect(serviceRowWords(svc("retrying", { retryatms: NOW + 7_200 }), NOW).words).toBe("crashed · retry in 8s");
        expect(serviceRowWords(svc("retrying", { retryatms: NOW - 500 }), NOW).words).toBe("crashed · retry in 0s");
    });

    it("crashed: the exit code and Restart", () => {
        expect(serviceRowWords(svc("crashed", { exitcode: 1 }), NOW)).toEqual({
            words: "crashed · exit 1",
            tone: "error",
            dot: "solid",
            action: "restart",
        });
    });

    it("porttaken: names the holder", () => {
        expect(serviceRowWords(svc("porttaken", { port: 8386, holder: "python3" }), NOW)).toEqual({
            words: "8386 is held by python3",
            tone: "warning",
            dot: "solid",
        });
    });

    it("porttaken: another program when no holder is known", () => {
        expect(serviceRowWords(svc("porttaken", { port: 8386 }), NOW).words).toBe("8386 is held by another program");
    });

    it("nopage: warns", () => {
        expect(serviceRowWords(svc("nopage"), NOW)).toEqual({
            words: "running, no page after 30s",
            tone: "warning",
            dot: "solid",
        });
    });
});

describe("serviceHeaderLine", () => {
    it("running: the address and how long it has been up", () => {
        const s = svc("running", { port: 8386, startedms: NOW - 8_040_000 });
        expect(serviceHeaderLine(s, NOW)).toBe("Running on 127.0.0.1:8386 · up 2h 14m");
    });

    it("starting: the address it waits for", () => {
        expect(serviceHeaderLine(svc("starting", { port: 41207 }), NOW)).toBe("Starting… waiting for 127.0.0.1:41207");
    });

    it("elsewhere", () => {
        expect(serviceHeaderLine(svc("elsewhere", { port: 8386 }), NOW)).toBe(
            "Not started by arcterm · 127.0.0.1:8386"
        );
    });

    it("retrying", () => {
        expect(serviceHeaderLine(svc("retrying", { retryatms: NOW + 8_000 }), NOW)).toBe("Crashed · retry in 8s");
    });

    it("crashed", () => {
        expect(serviceHeaderLine(svc("crashed", { exitcode: 1 }), NOW)).toBe("Crashed · exit 1");
    });

    it("porttaken", () => {
        expect(serviceHeaderLine(svc("porttaken", { port: 8386, holder: "python3" }), NOW)).toBe(
            "8386 is held by python3"
        );
    });

    it("nopage", () => {
        expect(serviceHeaderLine(svc("nopage"), NOW)).toBe("Running, no page after 30s");
    });

    it("sleeping", () => {
        expect(serviceHeaderLine(svc("sleeping"), NOW)).toBe("Sleeping · starts when shown");
    });

    it("a state it does not know reads as sleeping does", () => {
        expect(serviceHeaderLine(svc("stopped"), NOW)).toBe("Sleeping · starts when shown");
        expect(serviceHeaderLine(svc("mystery"), NOW)).toBe("Sleeping · starts when shown");
    });
});

describe("upFor", () => {
    it("seconds under a minute, minutes under an hour, then hours and minutes", () => {
        expect(upFor(40_000)).toBe("40s");
        expect(upFor(300_000)).toBe("5m");
        expect(upFor(8_040_000)).toBe("2h 14m");
    });

    it("never goes negative", () => {
        expect(upFor(-5_000)).toBe("0s");
    });
});

describe("what a state offers", () => {
    const states = ["starting", "running", "elsewhere", "retrying", "crashed", "porttaken", "nopage", "sleeping"];

    it("canStop: running, starting, retrying, nopage", () => {
        expect(states.filter((st) => canStop(svc(st)))).toEqual(["starting", "running", "retrying", "nopage"]);
    });

    it("canStart: crashed, porttaken, sleeping, elsewhere (Start probes again); a stopped service is not a state", () => {
        expect(states.filter((st) => canStart(svc(st)))).toEqual(["elsewhere", "crashed", "porttaken", "sleeping"]);
        expect(canStart(svc("stopped"))).toBe(false);
    });

    it("canRestart: running, starting, retrying, nopage, crashed", () => {
        expect(states.filter((st) => canRestart(svc(st)))).toEqual([
            "starting",
            "running",
            "retrying",
            "crashed",
            "nopage",
        ]);
    });

    it("sleeping offers Start only (a shown pane starts it); no stop, no restart", () => {
        const s = svc("sleeping");
        expect(canStart(s)).toBe(true);
        expect(canStop(s)).toBe(false);
        expect(canRestart(s)).toBe(false);
    });

    it("elsewhere offers Start only", () => {
        const s = svc("elsewhere");
        expect(canStart(s)).toBe(true);
        expect(canStop(s)).toBe(false);
        expect(canRestart(s)).toBe(false);
    });
});

describe("treeServiceInput", () => {
    const ids = (list: ServiceStatus[], selected: string | null) =>
        treeServiceInput(list, selected).services.map((s) => s.id);

    it("lists a service that is up or in trouble, in the order given, and not a sleeping one", () => {
        const list = [
            svc("running", { id: "run" }),
            svc("sleeping", { id: "sleep" }),
            svc("crashed", { id: "crash" }),
            svc("starting", { id: "start" }),
            svc("retrying", { id: "retry" }),
            svc("porttaken", { id: "port" }),
            svc("nopage", { id: "nopage" }),
            svc("elsewhere", { id: "else" }),
        ];
        expect(ids(list, null)).toEqual(["run", "crash", "start", "retry", "port", "nopage", "else"]);
    });

    it("keeps a sleeping service whose tab is the selected row, and no other", () => {
        const list = [
            svc("sleeping", { id: "a", tabid: "tab-a" }),
            svc("sleeping", { id: "b", tabid: "tab-b" }),
            svc("running", { id: "c", tabid: "tab-c" }),
        ];
        expect(ids(list, "tab-b")).toEqual(["b", "c"]);
        expect(ids(list, "tab-c")).toEqual(["c"]);
        expect(ids(list, null)).toEqual(["c"]);
    });

    it("hands projectTree the fields it reads", () => {
        const list = [svc("running", { id: "web", name: "Web", project: "loom", tabid: "tab-web" })];
        expect(treeServiceInput(list, null).services).toEqual([
            { id: "web", name: "Web", project: "loom", tabId: "tab-web" },
        ]);
    });

    it("holds every service's tab, sleeping ones too, and none for a service with no tab", () => {
        const list = [
            svc("sleeping", { id: "a", tabid: "tab-a" }),
            svc("running", { id: "b", tabid: "tab-b" }),
            svc("sleeping", { id: "c" }),
            svc("running", { id: "d" }),
        ];
        expect([...treeServiceInput(list, null).serviceTabs].sort()).toEqual(["tab-a", "tab-b"]);
    });

    it("is empty for no services", () => {
        const none = treeServiceInput([], "tab-x");
        expect(none.services).toEqual([]);
        expect(none.serviceTabs.size).toBe(0);
    });
});

describe("serviceMenuChoices", () => {
    const open = { pinned: false, railFull: false };
    const url = "http://127.0.0.1:8386/";
    const choice = (s: ServiceStatus, key: string, o = open) => serviceMenuChoices(s, o).find((c) => c.key === key);

    it("lists Stop, Restart, the browser, Keep running, Pin and Edit, with a separator between the groups", () => {
        expect(serviceMenuChoices(svc("running", { url }), open).map((c) => c.key)).toEqual([
            "stop",
            "restart",
            "separator",
            "browser",
            "keepRunning",
            "pin",
            "separator",
            "edit",
        ]);
    });

    it("has no browser entry for a service with no url", () => {
        expect(choice(svc("running"), "browser")).toBeUndefined();
        expect(choice(svc("running", { url }), "browser")).toMatchObject({
            label: "Open in the browser",
            enabled: true,
        });
    });

    it("never offers Start, whatever the state", () => {
        for (const st of [
            "starting",
            "running",
            "elsewhere",
            "retrying",
            "crashed",
            "porttaken",
            "nopage",
            "sleeping",
        ]) {
            expect(serviceMenuChoices(svc(st), open).map((c) => c.key)).not.toContain("start");
        }
    });

    it("enables Stop and Restart as the state allows", () => {
        for (const st of [
            "starting",
            "running",
            "elsewhere",
            "retrying",
            "crashed",
            "porttaken",
            "nopage",
            "sleeping",
        ]) {
            expect(choice(svc(st), "stop")).toMatchObject({ label: "Stop", enabled: canStop(svc(st)) });
            expect(choice(svc(st), "restart")).toMatchObject({ label: "Restart", enabled: canRestart(svc(st)) });
        }
    });

    it("checks Keep running as autostart says", () => {
        expect(choice(svc("running", { autostart: true }), "keepRunning")).toMatchObject({
            label: "Keep running",
            enabled: true,
            checked: true,
        });
        expect(choice(svc("running", { autostart: false }), "keepRunning")).toMatchObject({ checked: false });
    });

    it("pins and unpins", () => {
        expect(choice(svc("running"), "pin")).toMatchObject({ label: "Pin to the rail", enabled: true });
        expect(choice(svc("running"), "pin", { pinned: true, railFull: false })).toMatchObject({
            label: "Unpin from the rail",
            enabled: true,
        });
    });

    it("disables Pin with the full-rail title when the rail is full and the service is not on it", () => {
        const pin = choice(svc("running"), "pin", { pinned: false, railFull: true });
        expect(pin).toMatchObject({ label: "Pin to the rail", enabled: false, title: RAIL_FULL_TITLE });
    });

    it("lets a pinned service unpin from a full rail, with no title", () => {
        const pin = choice(svc("running"), "pin", { pinned: true, railFull: true });
        expect(pin).toMatchObject({ label: "Unpin from the rail", enabled: true });
        expect(pin).not.toHaveProperty("title");
    });

    it("ends with the entry for Setup → Tools", () => {
        expect(serviceMenuChoices(svc("sleeping"), open).at(-1)).toMatchObject({
            key: "edit",
            label: "Edit in Setup → Tools",
            enabled: true,
        });
    });
});

describe("withAutostart", () => {
    const entry: ToolKeywords = { command: "npm", args: "run dev", url: "http://127.0.0.1:8386", dir: "~/proj" };

    it("on writes autostart true and keeps every other key", () => {
        expect(withAutostart(entry, true)).toEqual({ ...entry, autostart: true });
    });

    it("off drops the key and keeps every other key", () => {
        expect(withAutostart({ ...entry, autostart: true }, false)).toEqual(entry);
        expect(withAutostart(entry, false)).toEqual(entry);
    });

    it("does not change the entry it is given", () => {
        const given = { ...entry, autostart: true };
        withAutostart(given, false);
        expect(given.autostart).toBe(true);
    });
});
