// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { describe, expect, it } from "vitest";
import {
    appCard,
    appSurfaceBody,
    appSurfaceService,
    appWaitTitle,
    movedRailPin,
    parseRailPins,
    railDot,
    railFull,
    railItemTitle,
    railPins,
    withRailPin,
} from "./railapps";

const NOW = 1_800_000_000_000;
const STATES = ["starting", "running", "elsewhere", "retrying", "crashed", "porttaken", "nopage", "sleeping"];

function svc(id: string, state = "running", extra: Partial<ServiceStatus> = {}): ServiceStatus {
    return {
        id,
        name: extra.name ?? id,
        command: "npm run dev",
        dir: "~/proj",
        project: "proj",
        state,
        autostart: true,
        ...extra,
    };
}

const ids = (list: ServiceStatus[]) => list.map((s) => s.id);

describe("parseRailPins", () => {
    it("reads an array of ids and nothing else", () => {
        expect(parseRailPins(null)).toEqual([]);
        expect(parseRailPins("[]")).toEqual([]);
        expect(parseRailPins('["a","b"]')).toEqual(["a", "b"]);
        expect(parseRailPins("oops")).toEqual([]);
        expect(parseRailPins('{"a":1}')).toEqual([]);
    });

    it("drops entries that are not strings", () => {
        expect(parseRailPins('["a",3,null,"b"]')).toEqual(["a", "b"]);
    });
});

describe("railPins", () => {
    const five = ["a", "b", "c", "d", "e"].map((id) => svc(id));

    it("railPins keeps three", () => {
        expect(ids(railPins(["a", "b", "c", "d", "e"], five))).toEqual(["a", "b", "c"]);
    });

    it("keeps pin order, not the services' order", () => {
        expect(ids(railPins(["c", "a"], five))).toEqual(["c", "a"]);
    });

    it("drops a removed service", () => {
        expect(ids(railPins(["a", "gone", "b"], five))).toEqual(["a", "b"]);
    });

    it("a gone pin holds no place among the three", () => {
        expect(ids(railPins(["gone", "a", "b", "c"], five))).toEqual(["a", "b", "c"]);
    });

    it("shows a duplicated id once", () => {
        expect(ids(railPins(["a", "a", "b"], five))).toEqual(["a", "b"]);
    });
});

describe("railFull", () => {
    const list = ["a", "b", "c", "d"].map((id) => svc(id));

    it("is full at three live pins", () => {
        expect(railFull(["a", "b", "c"], list)).toBe(true);
    });

    it("is not full with two live pins and a gone one", () => {
        expect(railFull(["a", "gone", "b"], list)).toBe(false);
    });
});

describe("withRailPin", () => {
    const list = ["a", "b", "c", "d"].map((id) => svc(id));

    it("appends a pin", () => {
        expect(withRailPin(["a"], "b", true, list)).toEqual(["a", "b"]);
    });

    it("refuses a fourth", () => {
        expect(withRailPin(["a", "b", "c"], "d", true, list)).toEqual(["a", "b", "c"]);
    });

    it("removes a pin", () => {
        expect(withRailPin(["a", "b", "c"], "b", false, list)).toEqual(["a", "c"]);
    });

    it("ignores a duplicate", () => {
        expect(withRailPin(["a", "b"], "a", true, list)).toEqual(["a", "b"]);
    });

    it("withRailPin prunes a gone pin", () => {
        const three = ["a", "b", "c"].map((id) => svc(id));
        expect(withRailPin(["a", "gone", "b"], "c", true, three)).toEqual(["a", "b", "c"]);
    });

    it("drops the pins past three", () => {
        expect(withRailPin(["a", "b", "c", "d"], "d", false, list)).toEqual(["a", "b", "c"]);
    });
});

describe("movedRailPin", () => {
    const list = ["a", "b", "c"].map((id) => svc(id));

    it("moves up", () => {
        expect(movedRailPin(["a", "b", "c"], "b", -1, list)).toEqual(["b", "a", "c"]);
    });

    it("moves down", () => {
        expect(movedRailPin(["a", "b", "c"], "b", 1, list)).toEqual(["a", "c", "b"]);
    });

    it("stays at the ends", () => {
        expect(movedRailPin(["a", "b", "c"], "a", -1, list)).toEqual(["a", "b", "c"]);
        expect(movedRailPin(["a", "b", "c"], "c", 1, list)).toEqual(["a", "b", "c"]);
    });

    it("swaps with the neighbour that shows, past a gone pin", () => {
        expect(movedRailPin(["a", "gone", "b"], "b", -1, list)).toEqual(["b", "a"]);
    });
});

describe("railDot", () => {
    const want: Record<string, "error" | "warning" | null> = {
        starting: null,
        running: null,
        elsewhere: null,
        retrying: "error",
        crashed: "error",
        porttaken: "warning",
        nopage: "warning",
        sleeping: null,
    };

    it.each(STATES)("%s", (state) => {
        expect(railDot(svc("x", state))).toBe(want[state]);
    });
});

describe("railItemTitle", () => {
    it("running: the name and the port", () => {
        expect(railItemTitle(svc("svc", "running", { port: 4321 }), NOW)).toBe("svc: :4321");
    });

    it("sleeping: the name and the words", () => {
        expect(railItemTitle(svc("svc", "sleeping"), NOW)).toBe("svc: sleeping");
    });

    it("crashed: the name and the row words", () => {
        expect(railItemTitle(svc("svc", "crashed", { exitcode: 1 }), NOW)).toBe("svc: crashed · exit 1");
    });
});

describe("appSurfaceService", () => {
    const list = [svc("a"), svc("b")];

    it("is null for no id, an unpinned id and a gone id", () => {
        expect(appSurfaceService(null, ["a"], list)).toBeNull();
        expect(appSurfaceService("b", ["a"], list)).toBeNull();
        expect(appSurfaceService("gone", ["gone"], list)).toBeNull();
    });

    it("is the service when it is pinned and present", () => {
        expect(appSurfaceService("b", ["a", "b"], list)).toBe(list[1]);
    });

    it("is null for a pin past the third", () => {
        const four = ["a", "b", "c", "d"].map((id) => svc(id));
        expect(appSurfaceService("d", ["a", "b", "c", "d"], four)).toBeNull();
    });
});

describe("appSurfaceBody", () => {
    const want: Record<string, "page" | "waiting" | "card"> = {
        starting: "waiting",
        running: "page",
        elsewhere: "page",
        retrying: "card",
        crashed: "card",
        porttaken: "card",
        nopage: "card",
        sleeping: "waiting",
    };

    it.each(STATES)("%s", (state) => {
        expect(appSurfaceBody(svc("x", state))).toBe(want[state]);
    });

    it("waits for a state it does not know, with no stopped card to fall to", () => {
        expect(appSurfaceBody(svc("x", "stopped"))).toBe("waiting");
        expect(appSurfaceBody(svc("x", "mystery"))).toBe("waiting");
    });
});

describe("appWaitTitle", () => {
    it("starting: Starting <name>", () => {
        expect(appWaitTitle(svc("svc", "starting"))).toBe("Starting svc");
    });

    it("sleeping: <name> is asleep, since after a Stop nothing starts it until it is shown again", () => {
        expect(appWaitTitle(svc("svc", "sleeping"))).toBe("svc is asleep");
    });

    it("a state it does not know reads as sleeping does", () => {
        expect(appWaitTitle(svc("svc", "stopped"))).toBe("svc is asleep");
    });
});

describe("appCard", () => {
    it("crashed: the exit code, Restart", () => {
        expect(appCard(svc("svc", "crashed", { exitcode: 1 }), NOW)).toEqual({
            title: "svc stopped after 5 crashes",
            line: "It last exited with code 1. Its log in Agent shows why.",
            action: "restart",
        });
    });

    it("retrying: the seconds left, Restart", () => {
        expect(appCard(svc("svc", "retrying", { retryatms: NOW + 8_000 }), NOW)).toEqual({
            title: "svc crashed",
            line: "It starts again in 8 s. Its log in Agent shows why.",
            action: "restart",
        });
    });

    it("a state no card names: its state and its header line, Start", () => {
        // unreachable from appSurfaceBody; the total fallback of appCard
        expect(appCard(svc("svc", "sleeping"), NOW)).toEqual({
            title: "svc is sleeping",
            line: "Sleeping · starts when shown",
            action: "start",
        });
    });

    it("porttaken: who holds the port, Start", () => {
        expect(appCard(svc("svc", "porttaken", { port: 4321, holder: "node" }), NOW)).toEqual({
            title: "svc can't start",
            line: "4321 is held by node.",
            action: "start",
        });
        expect(appCard(svc("svc", "porttaken", { port: 4321 }), NOW).line).toBe("4321 is held by another program.");
    });

    it("nopage: Restart", () => {
        expect(appCard(svc("svc", "nopage", { port: 4321 }), NOW)).toEqual({
            title: "svc shows no page",
            line: "It is running, but nothing answered after 30 s.",
            action: "restart",
        });
    });
});
