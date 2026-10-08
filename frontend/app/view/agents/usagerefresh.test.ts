import { describe, expect, it } from "vitest";
import { retryHint, showUsageRefresh } from "./usagerefresh";

describe("showUsageRefresh", () => {
    it("shows when a claude window is shown", () => {
        expect(showUsageRefresh(["claude"], "a1")).toBe(true);
        expect(showUsageRefresh(["codex", "claude"], "a1")).toBe(true);
    });

    it("shows for the Default account even when nothing is shown yet: the refresh is how it gets a first reading", () => {
        expect(showUsageRefresh([], "")).toBe(true);
        expect(showUsageRefresh(["codex"], "")).toBe(true);
    });

    it("hides for a token account with no claude window, which the usage endpoint refuses", () => {
        expect(showUsageRefresh([], "a1")).toBe(false);
        expect(showUsageRefresh(["codex"], "a1")).toBe(false);
    });
});

describe("retryHint", () => {
    it("names the local time of day, zero-padded", () => {
        expect(retryHint(new Date(2026, 9, 7, 9, 5).getTime())).toBe("retry at 09:05");
        expect(retryHint(new Date(2026, 9, 7, 23, 41, 59).getTime())).toBe("retry at 23:41");
    });
});
