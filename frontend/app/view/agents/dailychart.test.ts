// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { describe, expect, it } from "vitest";
import { dayLabel, peakRow, toRows } from "./dailychart";
import type { DailyUsage } from "./usagestats";

const daily: DailyUsage[] = [
    {
        day: "2026-08-10",
        byHarness: {
            claude: { tokens: 10, spendUsd: 1 },
            codex: { tokens: 20, spendUsd: 2 },
            opencode: { tokens: 30, spendUsd: 3 },
        },
    },
];

describe("toRows", () => {
    it("keys rows by harness in the given order and totals them", () => {
        expect(toRows(daily, "tokens", ["claude", "codex", "opencode"])).toEqual([
            {
                day: "08-10",
                date: "2026-08-10",
                values: { claude: 10, codex: 20, opencode: 30 },
                total: 60,
            },
        ]);
    });

    it("selects the spend metric", () => {
        expect(toRows(daily, "spend", ["claude", "codex", "opencode"])).toEqual([
            {
                day: "08-10",
                date: "2026-08-10",
                values: { claude: 1, codex: 2, opencode: 3 },
                total: 6,
            },
        ]);
    });

    it("defaults absent harnesses to zero", () => {
        expect(toRows(daily, "tokens", ["claude", "opencode", "jarvis"])).toEqual([
            {
                day: "08-10",
                date: "2026-08-10",
                values: { claude: 10, opencode: 30, jarvis: 0 },
                total: 40,
            },
        ]);
    });

    it("shortens the day key to MM-DD for the axis", () => {
        expect(toRows(daily, "tokens", ["claude"])[0].day).toBe("08-10");
    });
});

describe("dayLabel", () => {
    it("keeps the day of the month alone for the axis", () => {
        expect(dayLabel("08-10")).toBe("10");
        expect(dayLabel("12-02")).toBe("02");
    });
});

describe("toRows date", () => {
    it("keeps the full date for the tooltip beside the MM-DD key", () => {
        const [row] = toRows(daily, "tokens", ["claude"]);
        expect([row.day, row.date]).toEqual(["08-10", "2026-08-10"]);
    });
});

describe("peakRow", () => {
    const rows = toRows(
        [
            { day: "2026-08-10", byHarness: { claude: { tokens: 10, spendUsd: 1 } } },
            { day: "2026-08-11", byHarness: { claude: { tokens: 90, spendUsd: 0.5 } } },
            { day: "2026-08-12", byHarness: { claude: { tokens: 40, spendUsd: 4 } } },
        ],
        "tokens",
        ["claude"]
    );

    it("names the busiest day of the metric drawn", () => {
        expect(peakRow(rows)?.day).toBe("08-11");
        expect(
            peakRow(
                toRows(
                    [
                        { day: "2026-08-10", byHarness: { claude: { tokens: 10, spendUsd: 1 } } },
                        { day: "2026-08-11", byHarness: { claude: { tokens: 90, spendUsd: 0.5 } } },
                    ],
                    "spend",
                    ["claude"]
                )
            )?.day
        ).toBe("08-10");
    });

    it("is null when nothing was spent", () => {
        expect(peakRow([])).toBeNull();
        expect(peakRow(toRows([{ day: "2026-08-10", byHarness: {} }], "tokens", ["claude"]))).toBeNull();
    });
});
