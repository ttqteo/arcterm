// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { describe, expect, it } from "vitest";
import { discussionCount } from "./counciltabsmodel";

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
