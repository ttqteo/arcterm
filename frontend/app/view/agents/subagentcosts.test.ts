import { describe, expect, it } from "vitest";
import { costRows } from "./subagentcosts";

describe("costRows", () => {
    it("keeps the server's order and marks the rows the Token burn card prices from", () => {
        const rows = costRows([
            { type: "general-purpose", samples: 14, mean: 2_800_000, p25: 300_000, p50: 900_000, p90: 6_100_000 },
            { type: "web-fetch", samples: 2, mean: 100_000, p25: 80_000, p50: 90_000, p90: 420_000 },
            { type: "all", samples: 4, mean: 1_900_000, p25: 90_000, p50: 200_000, p90: 6_100_000 },
        ]);
        expect(rows.map((r) => [r.label, r.samples, r.avg, r.range, r.prices, r.all])).toEqual([
            ["general-purpose", 14, "2.8M", "300K–6.1M", true, false],
            ["web-fetch", 2, "100K", "80K–420K", false, false],
            ["All types", 4, "1.9M", "90K–6.1M", false, true],
        ]);
    });
    it("is empty with no costs", () => {
        expect(costRows([])).toEqual([]);
    });
});
