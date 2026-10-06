import { describe, expect, it } from "vitest";
import { quotaUsage } from "./claudequota";

describe("quotaUsage", () => {
    it("is the windows as AgentUsage spells them", () => {
        expect(
            quotaUsage({
                fivehourpct: 50,
                fivehourreset: 1_759_733_999,
                weekpct: 41,
                weekreset: 1_760_187_599,
                capturedat: 1_759_720_000_000,
                source: "live",
            })
        ).toEqual({ fivehourpct: 50, fivehourreset: 1_759_733_999, weekpct: 41, weekreset: 1_760_187_599 });
    });

    it("keeps a window the answer left out unknown", () => {
        expect(quotaUsage({ weekpct: 3, capturedat: 1, source: "cache" })).toEqual({ weekpct: 3 });
    });

    it("is null when nothing is known", () => {
        expect(quotaUsage({})).toBeNull();
        expect(quotaUsage({ fivehourpct: 50 })).toBeNull();
    });
});
