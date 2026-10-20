// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { describe, expect, it } from "vitest";
import {
    canRestart,
    canStart,
    canStop,
    popoverOrder,
    serviceHeaderLine,
    serviceRowWords,
    servicesChip,
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
    it("stopped: a hollow muted dot and Start", () => {
        expect(serviceRowWords(svc("stopped"), NOW)).toEqual({
            words: "stopped",
            tone: "muted",
            dot: "hollow",
            action: "start",
        });
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

    it("stopped", () => {
        expect(serviceHeaderLine(svc("stopped"), NOW)).toBe("Stopped");
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

describe("servicesChip", () => {
    it("is hidden when no service is configured", () => {
        expect(servicesChip([]).hidden).toBe(true);
    });

    it("shows the running count, and the crashed ones in the error tone", () => {
        const chip = servicesChip([
            svc("running", { id: "a" }),
            svc("running", { id: "b" }),
            svc("running", { id: "c" }),
            svc("crashed"),
        ]);
        expect(chip.hidden).toBe(false);
        expect(chip.label).toBe("3 · 1 crashed");
        expect(chip.tone).toBe("error");
    });

    it("counts a retrying service as crashed", () => {
        const chip = servicesChip([svc("running"), svc("retrying")]);
        expect(chip.label).toBe("1 · 1 crashed");
        expect(chip.tone).toBe("error");
    });

    it("turns warning for a service with no page, when none crashed", () => {
        const chip = servicesChip([svc("nopage"), svc("running", { id: "a" }), svc("running", { id: "b" })]);
        expect(chip.label).toBe("2");
        expect(chip.tone).toBe("warning");
    });

    it("turns warning for a taken port", () => {
        expect(servicesChip([svc("porttaken"), svc("running")]).tone).toBe("warning");
    });

    it("stays error when one crashed and another has no page", () => {
        expect(servicesChip([svc("nopage"), svc("crashed")]).tone).toBe("error");
    });

    it("is muted when all is well", () => {
        const chip = servicesChip([svc("running"), svc("stopped")]);
        expect(chip.label).toBe("1");
        expect(chip.tone).toBe("muted");
    });

    it("gives a title that sums the states", () => {
        const chip = servicesChip([svc("running"), svc("stopped"), svc("crashed")]);
        expect(chip.title).toContain("1 running");
        expect(chip.title).toContain("1 crashed");
    });
});

describe("popoverOrder", () => {
    it("puts crashed and retrying first, then porttaken and nopage, then up, then stopped, by name inside each", () => {
        const list = [
            svc("stopped", { id: "s", name: "alpha" }),
            svc("running", { id: "r2", name: "zeta" }),
            svc("nopage", { id: "n", name: "mid" }),
            svc("retrying", { id: "t", name: "zulu" }),
            svc("elsewhere", { id: "e", name: "beta" }),
            svc("crashed", { id: "c", name: "kilo" }),
            svc("porttaken", { id: "p", name: "able" }),
            svc("starting", { id: "g", name: "gamma" }),
            svc("running", { id: "r1", name: "yankee" }),
        ];
        expect(popoverOrder(list).map((s) => s.id)).toEqual(["c", "t", "p", "n", "e", "g", "r1", "r2", "s"]);
    });

    it("does not change the list it is given", () => {
        const list = [svc("stopped", { id: "s" }), svc("crashed", { id: "c" })];
        popoverOrder(list);
        expect(list.map((s) => s.id)).toEqual(["s", "c"]);
    });
});

describe("what a state offers", () => {
    const states = ["stopped", "starting", "running", "elsewhere", "retrying", "crashed", "porttaken", "nopage"];

    it("canStop: running, starting, retrying, nopage", () => {
        expect(states.filter((st) => canStop(svc(st)))).toEqual(["starting", "running", "retrying", "nopage"]);
    });

    it("canStart: stopped, crashed, porttaken, elsewhere (Start probes again)", () => {
        expect(states.filter((st) => canStart(svc(st)))).toEqual(["stopped", "elsewhere", "crashed", "porttaken"]);
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

    it("elsewhere offers Start only", () => {
        const s = svc("elsewhere");
        expect(canStart(s)).toBe(true);
        expect(canStop(s)).toBe(false);
        expect(canRestart(s)).toBe(false);
    });
});

describe("withAutostart", () => {
    const entry: ToolKeywords = { command: "npm", args: "run dev", url: "http://127.0.0.1:8386", dir: "~/proj" };

    it("off writes autostart false and keeps every other key", () => {
        expect(withAutostart(entry, false)).toEqual({ ...entry, autostart: false });
    });

    it("on drops the key and keeps every other key", () => {
        expect(withAutostart({ ...entry, autostart: false }, true)).toEqual(entry);
        expect(withAutostart(entry, true)).toEqual(entry);
    });

    it("does not change the entry it is given", () => {
        const given = { ...entry, autostart: false };
        withAutostart(given, true);
        expect(given.autostart).toBe(false);
    });
});
