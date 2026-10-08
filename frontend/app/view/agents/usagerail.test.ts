import { describe, expect, it } from "vitest";
import { mergeRateLimitWindows } from "./ratelimitstore";
import {
    buildUsageRail,
    countReporting,
    defaultTab,
    harnessTotals,
    railRows,
    tabMetaParts,
    tabRows,
    worstWindow,
} from "./usagerail";
import type { DailyUsage } from "./usagestats";

const now = 1_800_000_000_000;

function day(d: string, byHarness: Record<string, { tokens: number; spendUsd: number }>): DailyUsage {
    return { day: d, byHarness };
}

describe("harnessTotals", () => {
    it("sums tokens and spend per harness across every day in the window", () => {
        const daily = [
            day("2026-09-01", { claude: { tokens: 100, spendUsd: 1 }, codex: { tokens: 40, spendUsd: 0.5 } }),
            day("2026-09-02", { claude: { tokens: 60, spendUsd: 2 } }),
        ];
        expect(harnessTotals(daily)).toEqual({
            claude: { tokens: 160, spendUsd: 3 },
            codex: { tokens: 40, spendUsd: 0.5 },
        });
    });
    it("is empty for an empty series", () => {
        expect(harnessTotals([])).toEqual({});
    });
});

describe("buildUsageRail", () => {
    const daily = [
        day("2026-09-01", { claude: { tokens: 1000, spendUsd: 12 }, opencode: { tokens: 30, spendUsd: 0.2 } }),
    ];
    const catalog = ["claude", "codex", "opencode", "pi"];

    it("splits harnesses with a quota reading from those without", () => {
        const donuts = mergeRateLimitWindows(
            [{ provider: "claude", usage: { fivehourpct: 62, weekpct: 41 } }],
            {},
            now
        );
        const groups = buildUsageRail(["claude", "opencode"], daily, donuts, catalog);
        expect(groups.map((g) => [g.key, g.rows.map((r) => r.harness)])).toEqual([
            ["reporting", ["claude"]],
            ["quiet", ["opencode"]],
        ]);
        expect(countReporting(groups)).toBe(1);
    });

    // a harness that owns real spend must keep its row even with no quota reading — dropping it would
    // make the rail's numbers disagree with the surface totals.
    it("keeps a history-only harness and carries its totals", () => {
        const groups = buildUsageRail(["claude", "opencode"], daily, [], catalog);
        const oc = railRows(groups).find((r) => r.harness === "opencode");
        expect(oc).toMatchObject({ state: "none", tokens: 30, spendUsd: 0.2 });
        expect(oc?.fivehour).toEqual({});
    });

    it("marks a saved snapshot as saved and carries its capture time", () => {
        const donuts = mergeRateLimitWindows(
            [],
            { codex: { fivehourpct: 28, fivehourreset: now / 1000 + 3600, capturedAt: now - 60_000 } },
            now
        );
        const row = railRows(buildUsageRail([], daily, donuts, catalog)).find((r) => r.harness === "codex");
        expect(row).toMatchObject({ state: "saved", capturedAt: now - 60_000 });
        expect(row?.fivehour.pct).toBe(28);
    });

    // the rail is a union of three sources; a harness present in only one of them still gets exactly
    // one row. Grouping outranks catalog order — a reporting harness sorts above a quiet one whatever
    // the catalog says — so the catalog only orders WITHIN a group.
    it("unions history, quota, and catalog sources without duplicating a harness", () => {
        const donuts = mergeRateLimitWindows([{ provider: "codex", usage: { fivehourpct: 10 } }], {}, now);
        const groups = buildUsageRail(["opencode", "claude"], daily, donuts, catalog);
        expect(groups.map((g) => [g.key, g.rows.map((r) => r.harness)])).toEqual([
            ["reporting", ["codex"]],
            ["quiet", ["claude", "opencode"]],
        ]);
        expect(railRows(groups)).toHaveLength(3);
    });

    it("sorts harnesses outside the catalog last, alphabetically", () => {
        const rows = railRows(buildUsageRail(["zed", "amp", "claude"], [], [], catalog));
        expect(rows.map((r) => r.harness)).toEqual(["claude", "amp", "zed"]);
    });

    it("omits an empty group rather than rendering a header with no rows", () => {
        const donuts = mergeRateLimitWindows([{ provider: "claude", usage: { fivehourpct: 5 } }], {}, now);
        expect(buildUsageRail(["claude"], [], donuts, catalog).map((g) => g.key)).toEqual(["reporting"]);
        expect(buildUsageRail(["opencode"], [], [], catalog).map((g) => g.key)).toEqual(["quiet"]);
        expect(buildUsageRail([], [], [], catalog)).toEqual([]);
    });
});

describe("tabRows / defaultTab", () => {
    const daily = [
        day("2026-09-01", {
            claude: { tokens: 900, spendUsd: 9 },
            codex: { tokens: 400, spendUsd: 4 },
            opencode: { tokens: 400, spendUsd: 1 },
            pi: { tokens: 5, spendUsd: 0 },
        }),
    ];
    const rows = railRows(buildUsageRail(["claude", "codex", "opencode", "pi"], daily, [], []));

    it("orders the tabs by window tokens, descending", () => {
        expect(tabRows(rows).map((r) => r.harness)).toEqual(["claude", "codex", "opencode", "pi"]);
        const flipped = railRows(
            buildUsageRail(
                [],
                [day("2026-09-01", { pi: { tokens: 50, spendUsd: 0 }, claude: { tokens: 10, spendUsd: 0 } })],
                [],
                ["claude", "pi"]
            )
        );
        expect(tabRows(flipped).map((r) => r.harness)).toEqual(["pi", "claude"]);
    });

    // equal tokens fall back to the label people read, not the harness id: "Antigravity" is agy
    it("breaks a tie by provider label", () => {
        const tied = railRows(
            buildUsageRail(
                [],
                [day("2026-09-01", { opencode: { tokens: 7, spendUsd: 0 }, agy: { tokens: 7, spendUsd: 0 } })],
                [],
                []
            )
        );
        expect(tabRows(tied).map((r) => r.harness)).toEqual(["agy", "opencode"]);
    });

    it("does not reorder the rows it is given", () => {
        const before = rows.map((r) => r.harness);
        tabRows([...rows].reverse());
        expect(rows.map((r) => r.harness)).toEqual(before);
    });

    it("defaults to the harness with the most tokens, or all when there are none", () => {
        expect(defaultTab(rows)).toBe("claude");
        expect(defaultTab(tabRows(rows).slice().reverse())).toBe("claude");
        expect(defaultTab([])).toBe("all");
    });
});

describe("tabMetaParts", () => {
    const daily = [
        day("2026-09-01", {
            claude: { tokens: 1000, spendUsd: 12 },
            codex: { tokens: 2_500_000, spendUsd: 3 },
            pi: { tokens: 18_000_000, spendUsd: 1 },
        }),
    ];
    const partsOf = (harness: string, donuts: ReturnType<typeof mergeRateLimitWindows>) =>
        tabMetaParts(railRows(buildUsageRail([], daily, donuts, [])).find((r) => r.harness === harness)!);
    const metaOf = (harness: string, donuts: ReturnType<typeof mergeRateLimitWindows>): string =>
        partsOf(harness, donuts)
            .map((p) => p.text)
            .join(" · ");

    it("shows both windows for a provider that reports them", () => {
        const donuts = mergeRateLimitWindows(
            [{ provider: "claude", usage: { fivehourpct: 41.2, weekpct: 72 } }],
            {},
            now
        );
        expect(metaOf("claude", donuts)).toBe("5h 41% · wk 72%");
    });

    // the tab colours a window by its own pct, so each window keeps it unrounded; the token fallback has none
    it("carries each window's pct, and none on the token fallback", () => {
        const donuts = mergeRateLimitWindows(
            [{ provider: "claude", usage: { fivehourpct: 91.6, weekpct: 72 } }],
            {},
            now
        );
        expect(partsOf("claude", donuts).map((p) => p.pct)).toEqual([91.6, 72]);
        expect(partsOf("pi", [])).toEqual([{ text: "18M tok" }]);
    });

    it("shows only the window a provider reports", () => {
        const donuts = mergeRateLimitWindows([{ provider: "codex", usage: { weekpct: 11 } }], {}, now);
        expect(metaOf("codex", donuts)).toBe("wk 11%");
    });

    it("falls back to tokens for a provider with no quota reading", () => {
        expect(metaOf("pi", [])).toBe("18M tok");
    });

    // a reading with neither window filled in says nothing about quota, so the tab names tokens instead
    it("falls back to tokens when the reading carries no window", () => {
        const donuts = mergeRateLimitWindows([{ provider: "claude", usage: {} }], {}, now);
        expect(metaOf("claude", donuts)).toBe("1K tok");
    });
});

describe("worstWindow", () => {
    const rows = railRows(
        buildUsageRail(
            [],
            [],
            mergeRateLimitWindows(
                [
                    { provider: "claude", usage: { fivehourpct: 40, fivehourreset: 111, weekpct: 90 } },
                    { provider: "codex", usage: { fivehourpct: 72, fivehourreset: 222, weekpct: 30 } },
                ],
                {},
                now
            ),
            ["claude", "codex"]
        )
    );

    // an average would read "fine" while one account sits at 98%, so the aggregate reports the window
    // closest to its cap and names which harness it came from.
    it("returns the highest reading per window with its source harness and reset", () => {
        expect(worstWindow(rows, "fivehour")).toEqual({ pct: 72, reset: 222, harness: "codex" });
        expect(worstWindow(rows, "week")).toEqual({ pct: 90, reset: undefined, harness: "claude" });
    });

    it("is empty when nothing reports that window", () => {
        expect(worstWindow([], "fivehour")).toEqual({});
        const noQuota = railRows(buildUsageRail(["opencode"], [], [], ["opencode"]));
        expect(worstWindow(noQuota, "week")).toEqual({});
    });
});
