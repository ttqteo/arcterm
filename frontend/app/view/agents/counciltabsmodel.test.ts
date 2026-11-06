// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { describe, expect, it } from "vitest";
import {
    councilTabs,
    discussionCount,
    fillSlideFrom,
    type CouncilTabId,
    type ShownStrip,
    type TabSpots,
} from "./counciltabsmodel";

const prop = (id: string, extra: Partial<CouncilProposal> = {}): CouncilProposal => ({
    id,
    author: "ux",
    title: `title ${id}`,
    argument: `argument ${id}`,
    ts: 1,
    ...extra,
});

describe("discussionCount", () => {
    it("is empty with no sent idea", () => {
        expect(discussionCount({})).toBe("");
        expect(discussionCount({ proposals: [] })).toBe("");
        expect(discussionCount({ proposals: [prop("P1", { draft: "held" })] })).toBe("");
    });

    it("reads 1 idea", () => {
        expect(discussionCount({ proposals: [prop("P1")] })).toBe("1 idea");
    });

    it("counts every sent idea", () => {
        const proposals = Array.from({ length: 24 }, (_, i) => prop(`P${i + 1}`));
        expect(discussionCount({ proposals })).toBe("24 ideas");
        // a held draft is not an idea sent yet
        expect(discussionCount({ proposals: [...proposals, prop("P25", { draft: "held" })] })).toBe("24 ideas");
    });
});

describe("councilTabs", () => {
    it("lists Report, Discussion and Map, in that order", () => {
        expect(councilTabs({}).map((t) => [t.id, t.label])).toEqual([
            ["summary", "Report"],
            ["discussion", "Discussion"],
            ["map", "Map"],
        ]);
    });

    it("names the Map in the council's language and leaves the other two words alone", () => {
        expect(councilTabs({ lang: "vi" }).map((t) => t.label)).toEqual(["Report", "Discussion", "Bản đồ"]);
        expect(councilTabs({ lang: "en" })[2].label).toBe("Map");
        // a council saved before the language was kept reads as English
        expect(councilTabs({ lang: undefined })[2].label).toBe("Map");
    });

    it("puts the count of ideas on the Discussion tab alone", () => {
        expect(councilTabs({}).map((t) => t.count)).toEqual(["", "", ""]);
        const proposals = [prop("P1"), prop("P2"), prop("P3", { draft: "held" })];
        expect(councilTabs({ proposals }).map((t) => t.count)).toEqual(["", "2 ideas", ""]);
    });

    it("draws the count as a bare number beside the Discussion's icon, and none before an idea is sent", () => {
        expect(councilTabs({}).map((t) => t.badge)).toEqual(["", "", ""]);
        expect(councilTabs({ proposals: [prop("P1", { draft: "held" })] })[1].badge).toBe("");
        const proposals = Array.from({ length: 28 }, (_, i) => prop(`P${i + 1}`));
        expect(councilTabs({ proposals }).map((t) => t.badge)).toEqual(["", "28", ""]);
    });

    it("keeps the Map open whatever state the council is in, with no idea sent yet", () => {
        expect(councilTabs({ proposals: [] }).some((t) => t.id === "map")).toBe(true);
    });
});

describe("fillSlideFrom", () => {
    // the strip as every view's header draws it: Report 32px, Discussion 52px with its count, Map 32px
    const spots: TabSpots = {
        summary: { left: 3, width: 32 },
        discussion: { left: 37, width: 52 },
        map: { left: 91, width: 32 },
    };
    const strip = (view: CouncilTabId, council = "c1"): ShownStrip => ({ council, view, spots });

    it("slides from the Discussion's tab to the Map's, and back", () => {
        expect(fillSlideFrom(strip("discussion"), "c1", "map")).toEqual({ x: -54, scale: 52 / 32 });
        expect(fillSlideFrom(strip("map"), "c1", "discussion")).toEqual({ x: 54, scale: 32 / 52 });
    });

    it("draws the fill in place with no strip before it, or another council's", () => {
        expect(fillSlideFrom(null, "c1", "map")).toBeNull();
        expect(fillSlideFrom(strip("discussion", "c2"), "c1", "map")).toBeNull();
    });

    it("draws the fill in place on the same view", () => {
        expect(fillSlideFrom(strip("map"), "c1", "map")).toBeNull();
    });

    it("slides to and from the Report, whose strip sits in the same header row", () => {
        expect(fillSlideFrom(strip("summary"), "c1", "discussion")).toEqual({ x: -34, scale: 32 / 52 });
        expect(fillSlideFrom(strip("discussion"), "c1", "summary")).toEqual({ x: 34, scale: 52 / 32 });
        expect(fillSlideFrom(strip("map"), "c1", "summary")).toEqual({ x: 88, scale: 1 });
    });

    it("draws the fill in place when a tab was not measured or has no width", () => {
        expect(
            fillSlideFrom({ council: "c1", view: "discussion", spots: { discussion: spots.discussion } }, "c1", "map")
        ).toBeNull();
        expect(
            fillSlideFrom(
                { council: "c1", view: "discussion", spots: { ...spots, map: { left: 91, width: 0 } } },
                "c1",
                "map"
            )
        ).toBeNull();
    });
});
