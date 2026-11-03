// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { describe, expect, it } from "vitest";
import { councilTabs, discussionCount } from "./counciltabsmodel";

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

    it("keeps the Map open whatever state the council is in, with no idea sent yet", () => {
        expect(councilTabs({ proposals: [] }).some((t) => t.id === "map")).toBe(true);
    });
});
