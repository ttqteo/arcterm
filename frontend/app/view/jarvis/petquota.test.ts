import { describe, expect, it } from "vitest";
import type { ProviderDonuts } from "../agents/ratelimitstore";
import { pruneSaid, quotaCrossings, quotaEvent, quotaReadings, tightestWindow } from "./petquota";

const RESET_5H = 1_800_003_600;
const RESET_WK = 1_800_400_000;

function donut(provider: string, five?: number, week?: number, stale = false): ProviderDonuts {
    return {
        provider,
        fivehour: { pct: five, reset: RESET_5H },
        week: { pct: week, reset: RESET_WK },
        stale: stale ? { capturedAt: 1 } : undefined,
    };
}

describe("tightestWindow", () => {
    it("picks the 5-hour window when it is the tighter one", () => {
        expect(tightestWindow([donut("claude", 70, 40)])).toEqual({
            provider: "claude",
            window: "5h",
            pct: 70,
            resetAt: RESET_5H,
        });
    });

    // the weekly window was never read, so a week at 95% left the creature fresh
    it("picks the weekly window when it is the tighter one", () => {
        expect(tightestWindow([donut("claude", 20, 95)])).toEqual({
            provider: "claude",
            window: "week",
            pct: 95,
            resetAt: RESET_WK,
        });
    });

    it("picks the tightest window across providers", () => {
        expect(tightestWindow([donut("claude", 30, 50), donut("codex", 88, 10)])?.provider).toBe("codex");
    });

    it("prefers a live reading over a saved snapshot, and falls back to the snapshot when nothing is live", () => {
        expect(tightestWindow([donut("claude", 99, 0, true), donut("codex", 40, 0)])?.provider).toBe("codex");
        expect(tightestWindow([donut("claude", 99, 0, true)])?.provider).toBe("claude");
    });

    it("is undefined when no window has a reading", () => {
        expect(tightestWindow([donut("claude")])).toBeUndefined();
        expect(tightestWindow([])).toBeUndefined();
    });
});

describe("quotaReadings", () => {
    it("lists every live window that has a reading", () => {
        expect(quotaReadings([donut("claude", 87, 40), donut("codex", undefined, 12)])).toEqual([
            { provider: "claude", window: "5h", pct: 87, resetAt: RESET_5H },
            { provider: "claude", window: "week", pct: 40, resetAt: RESET_WK },
            { provider: "codex", window: "week", pct: 12, resetAt: RESET_WK },
        ]);
    });

    // a snapshot from an earlier session is not news: speaking it would announce a window that may have reset
    it("never lists a saved snapshot", () => {
        expect(quotaReadings([donut("claude", 99, 99, true)])).toEqual([]);
    });
});

describe("quotaCrossings — once at 85%, once at 100%, per window per cycle", () => {
    const at87 = { provider: "claude", window: "5h" as const, pct: 87, resetAt: RESET_5H };

    it("speaks a window past 85%", () => {
        const out = quotaCrossings([at87], new Set());
        expect(out).toEqual([{ key: `claude:5h:${RESET_5H}:85`, mark: 85, reading: at87 }]);
    });

    it("stays quiet at 85% exactly, the cockpit's red band starts past it", () => {
        expect(quotaCrossings([{ ...at87, pct: 85 }], new Set())).toEqual([]);
    });

    it("does not speak a mark twice in one cycle", () => {
        expect(quotaCrossings([at87], new Set([`claude:5h:${RESET_5H}:85`]))).toEqual([]);
    });

    it("speaks the 100% mark after the 85% one was said", () => {
        const spent = { ...at87, pct: 100 };
        const out = quotaCrossings([spent], new Set([`claude:5h:${RESET_5H}:85`]));
        expect(out.map((c) => c.mark)).toEqual([100]);
    });

    // a window first seen already spent says that it is spent, not that it is running low and then spent
    it("speaks only the highest mark reached, and counts the lower one as said", () => {
        const out = quotaCrossings([{ ...at87, pct: 100 }], new Set());
        expect(out.map((c) => c.key)).toEqual([`claude:5h:${RESET_5H}:100`]);
        expect(out[0].alsoSaid).toEqual([`claude:5h:${RESET_5H}:85`]);
    });

    it("speaks again in the next cycle, which has a new reset", () => {
        const next = { ...at87, resetAt: RESET_5H + 18_000 };
        expect(quotaCrossings([next], new Set([`claude:5h:${RESET_5H}:85`]))).toHaveLength(1);
    });
});

describe("quotaEvent", () => {
    const now = RESET_5H * 1000 - 3_600_000; // an hour before the reset

    it("says a crossed window in the condition's own words, as a warning", () => {
        const ev = quotaEvent(
            { key: "k", mark: 85, reading: { provider: "claude", window: "5h", pct: 87, resetAt: RESET_5H } },
            now
        );
        expect(ev).toEqual({
            id: "quota:k",
            at: now,
            kind: "notify",
            level: "warn",
            text: "Running low on Claude: 87% of the 5-hour window used, back in 1h 0m.",
        });
    });

    it("says a spent window as an error", () => {
        const ev = quotaEvent(
            { key: "k", mark: 100, reading: { provider: "claude", window: "week", pct: 100, resetAt: RESET_5H } },
            now
        );
        expect(ev.level).toBe("error");
        expect(ev.text).toBe("Claude's weekly window is spent. Back in 1h 0m.");
    });
});

describe("pruneSaid", () => {
    it("keeps only the newest keys", () => {
        const keys = Array.from({ length: 60 }, (_, i) => `k${i}`);
        const kept = pruneSaid(keys, 50);
        expect(kept).toHaveLength(50);
        expect(kept[0]).toBe("k10");
        expect(kept[49]).toBe("k59");
    });
});
