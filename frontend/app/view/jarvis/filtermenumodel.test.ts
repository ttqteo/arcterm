// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { describe, expect, it } from "vitest";
import { matchingOptions, searchable, startCursor } from "./filtermenumodel";

const opts = ["all", "mit-thesis", "SIEM/src", "SIEM/apps/website", "vnstock-js", "~"].map((label, i) => ({
    value: i === 0 ? null : label,
    label,
}));

describe("filtermenumodel", () => {
    it("opens the picker from nine options, a context menu below", () => {
        expect([searchable(8), searchable(9), searchable(30)]).toEqual([false, true, true]);
    });

    it("keeps the options holding every typed word, without case, in their order", () => {
        expect(matchingOptions(opts, "siem").map((o) => o.label)).toEqual(["SIEM/src", "SIEM/apps/website"]);
        expect(matchingOptions(opts, "  web  siem ").map((o) => o.label)).toEqual(["SIEM/apps/website"]);
        expect(matchingOptions(opts, "thesis").map((o) => o.label)).toEqual(["mit-thesis"]);
        expect(matchingOptions(opts, "nothing like it")).toEqual([]);
    });

    it("matches a project's full path too, so a name its label leaves out still finds it", () => {
        const site = {
            value: "w",
            label: "website/apps/website",
            search: "D:\\Workspace\\SIEM\\website\\apps\\website",
        };
        expect(matchingOptions([...opts, site], "siem").map((o) => o.label)).toEqual([
            "SIEM/src",
            "SIEM/apps/website",
            "website/apps/website",
        ]);
    });

    it("shows every option for a blank query", () => {
        expect(matchingOptions(opts, "   ")).toEqual(opts);
    });

    it("starts on the picked option while it shows, else on the first", () => {
        expect(startCursor(opts, "vnstock-js")).toBe(4);
        expect(startCursor(opts, null)).toBe(0);
        expect(startCursor(matchingOptions(opts, "siem"), "vnstock-js")).toBe(0);
    });
});
