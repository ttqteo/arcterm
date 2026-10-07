import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { globalStore } from "@/app/store/jotaiStore";
import {
    mergeRateLimitWindows,
    migrateSaved,
    planDonuts,
    projectActiveAccount,
    rateLimitKey,
    readSavedRateLimits,
    recordRateLimit,
    savedRateLimitsAtom,
    topProviderUsage,
    type SavedSnapshot,
} from "./ratelimitstore";
import { liveWindowAgents, providerPlanUsage, type AgentVM } from "./agentsviewmodel";

describe("per-account claude snapshots", () => {
    it("keys claude by account", () => {
        expect(rateLimitKey("claude", undefined)).toBe("claude:default");
        expect(rateLimitKey("claude", "a1b2c3d4")).toBe("claude:a1b2c3d4");
        expect(rateLimitKey("codex", "a1b2c3d4")).toBe("codex");
    });
    it("migrates a bare claude snapshot to claude:default", () => {
        const s = { capturedAt: 1, fivehourpct: 10 };
        expect(migrateSaved({ claude: s, codex: s })).toEqual({ "claude:default": s, codex: s });
    });
    it("keeps an existing claude:default over a bare claude snapshot", () => {
        const old = { capturedAt: 1, fivehourpct: 10 };
        const cur = { capturedAt: 2, fivehourpct: 20 };
        expect(migrateSaved({ claude: old, "claude:default": cur })).toEqual({ "claude:default": cur });
    });
    it("shows only the active account's snapshot, as claude", () => {
        const a = { capturedAt: 1, fivehourpct: 10 };
        const b = { capturedAt: 2, fivehourpct: 90 };
        const saved = { "claude:default": a, "claude:a1": b, codex: a };
        expect(projectActiveAccount(saved, "a1")).toEqual({ claude: b, codex: a });
        expect(projectActiveAccount(saved, "")).toEqual({ claude: a, codex: a });
    });
    it("planDonuts drops claude agents on another account", () => {
        const agents = [
            { id: "1", state: "working", agent: "claude", usage: { fivehourpct: 97, account: "" } },
            { id: "2", state: "working", agent: "claude", usage: { fivehourpct: 5, account: "a1" } },
        ] as AgentVM[];
        const d = planDonuts(agents, {}, "a1", 0);
        expect(d.find((x) => x.provider === "claude")?.fivehour.pct).toBe(5);
    });
});

describe("topProviderUsage", () => {
    const now = 1_800_000_000_000;
    it("returns the provider with the highest 5-hour pct (so both-provider case is labeled, not a bare max)", () => {
        const donuts = mergeRateLimitWindows(
            [
                { provider: "claude", usage: { fivehourpct: 40 } },
                { provider: "codex", usage: { fivehourpct: 72 } },
            ],
            {},
            now
        );
        expect(topProviderUsage(donuts)).toEqual({ provider: "codex", pct: 72 });
    });
    it("ignores windows with no 5-hour pct and is undefined when none have one", () => {
        const donuts = mergeRateLimitWindows([{ provider: "claude", usage: { weekpct: 30 } }], {}, now);
        expect(topProviderUsage(donuts)).toBeUndefined();
        expect(topProviderUsage([])).toBeUndefined();
    });

    // observed: a day-old codex snapshot pinned at 100% outranked a live claude reading of 63%, so the
    // jarvis avatar reported codex's number — and codex's countdown — as the account's current window.
    // A reading nobody is currently producing must never beat one that is live.
    it("never lets a stale saved reading outrank a live one", () => {
        const donuts = mergeRateLimitWindows(
            [{ provider: "claude", usage: { fivehourpct: 63 } }],
            { codex: { fivehourpct: 100, fivehourreset: now / 1000 + 3600, capturedAt: now - 60_000 } },
            now
        );
        expect(topProviderUsage(donuts)).toEqual({ provider: "claude", pct: 63 });
    });

    it("still reports a saved reading when no provider is live", () => {
        const donuts = mergeRateLimitWindows(
            [],
            { codex: { fivehourpct: 44, fivehourreset: now / 1000 + 3600, capturedAt: now - 60_000 } },
            now
        );
        expect(topProviderUsage(donuts)).toEqual({ provider: "codex", pct: 44 });
    });
});

describe("account-level donut ignores idle agents' stale snapshots", () => {
    const now = 1_800_000_000_000;
    const active = { id: "a", name: "A", task: "", state: "working", agent: "claude", usage: { fivehourpct: 80, weekpct: 50 } } as AgentVM;
    const idleStale = { id: "b", name: "B", task: "", state: "idle", agent: "claude", usage: { fivehourpct: 20, weekpct: 10 } } as AgentVM;

    it("shows the active session's live window, not the idle snapshot, regardless of roster order", () => {
        for (const roster of [[active, idleStale], [idleStale, active]]) {
            const claude = mergeRateLimitWindows(providerPlanUsage(liveWindowAgents(roster)), {}, now).find(
                (d) => d.provider === "claude"
            );
            expect(claude?.fivehour.pct).toBe(80);
        }
    });

    it("falls back to the saved reading (marked stale) when every claude session is idle", () => {
        const saved: Record<string, SavedSnapshot> = { claude: { fivehourpct: 63, capturedAt: now } };
        const claude = mergeRateLimitWindows(providerPlanUsage(liveWindowAgents([idleStale])), saved, now).find(
            (d) => d.provider === "claude"
        );
        expect(claude?.fivehour.pct).toBe(63);
        expect(claude?.stale?.capturedAt).toBe(now);
    });
});

function mockLocalStorage(): Record<string, string> {
    const store: Record<string, string> = {};
    (globalThis as any).localStorage = {
        getItem: (k: string) => (k in store ? store[k] : null),
        setItem: (k: string, v: string) => {
            store[k] = v;
        },
        removeItem: (k: string) => {
            delete store[k];
        },
        clear: () => {
            for (const k of Object.keys(store)) delete store[k];
        },
        key: () => null,
        length: 0,
    };
    return store;
}

describe("mergeRateLimitWindows", () => {
    const now = 1_800_000_000_000; // fixed epoch ms
    const live = (provider: string, usage: AgentUsage) => ({ provider, usage });

    it("prefers live and sets no stale flag", () => {
        const out = mergeRateLimitWindows([live("claude", { fivehourpct: 62, fivehourreset: 100, weekpct: 41 })], {}, now);
        expect(out).toHaveLength(1);
        expect(out[0].fivehour).toEqual({ pct: 62, reset: 100 });
        expect(out[0].week).toEqual({ pct: 41, reset: undefined });
        expect(out[0].stale).toBeUndefined();
    });

    it("falls back to a saved snapshot and marks it stale", () => {
        const saved: Record<string, SavedSnapshot> = {
            claude: { fivehourpct: 50, fivehourreset: now / 1000 + 600, weekpct: 30, capturedAt: now - 5000 },
        };
        const out = mergeRateLimitWindows([], saved, now);
        expect(out[0].fivehour).toEqual({ pct: 50, reset: now / 1000 + 600 });
        expect(out[0].stale).toEqual({ capturedAt: now - 5000 });
    });

    it("rolls a window over to empty once its reset has passed", () => {
        const saved: Record<string, SavedSnapshot> = {
            claude: { fivehourpct: 80, fivehourreset: now / 1000 - 10, weekpct: 30, weekreset: now / 1000 + 600, capturedAt: now - 5000 },
        };
        const out = mergeRateLimitWindows([], saved, now);
        expect(out[0].fivehour).toEqual({ pct: 0, reset: undefined }); // rolled over
        expect(out[0].week).toEqual({ pct: 30, reset: now / 1000 + 600 }); // still valid
    });

    // The reset-passed check above cannot catch a reset that is simply wrong. Observed: a codex snapshot
    // captured 24h earlier carried a "five-hour" reset almost six days out, so it never rolled and stayed
    // pinned at 100% for days. A capture older than the window it describes has rolled at least once,
    // whatever its reset claims.
    it("expires a five-hour window captured more than five hours ago, however far out its reset claims to be", () => {
        const saved: Record<string, SavedSnapshot> = {
            codex: { fivehourpct: 100, fivehourreset: now / 1000 + 115 * 3600, capturedAt: now - 24 * 3600_000 },
        };
        const out = mergeRateLimitWindows([], saved, now);
        expect(out[0].fivehour).toEqual({ pct: 0, reset: undefined });
    });

    it("keeps a weekly window captured a day ago — a week has not passed", () => {
        const saved: Record<string, SavedSnapshot> = {
            claude: { weekpct: 40, weekreset: now / 1000 + 6 * 24 * 3600, capturedAt: now - 24 * 3600_000 },
        };
        const out = mergeRateLimitWindows([], saved, now);
        expect(out[0].week).toEqual({ pct: 40, reset: now / 1000 + 6 * 24 * 3600 });
    });

    it("expires a weekly window captured more than a week ago", () => {
        const saved: Record<string, SavedSnapshot> = {
            claude: { weekpct: 40, weekreset: now / 1000 + 30 * 24 * 3600, capturedAt: now - 8 * 24 * 3600_000 },
        };
        const out = mergeRateLimitWindows([], saved, now);
        expect(out[0].week).toEqual({ pct: 0, reset: undefined });
    });

    it("unions live + saved providers, claude first", () => {
        const out = mergeRateLimitWindows(
            [live("codex", { fivehourpct: 10 })],
            { claude: { fivehourpct: 5, capturedAt: now } },
            now
        );
        expect(out.map((p) => p.provider)).toEqual(["claude", "codex"]);
    });
});

describe("recordRateLimit + readSavedRateLimits round-trip", () => {
    beforeEach(() => mockLocalStorage());
    afterEach(() => {
        delete (globalThis as any).localStorage;
    });

    it("persists only window fields (+capturedAt), dropping context/cost", () => {
        recordRateLimit("claude:default", {
            fivehourpct: 62,
            fivehourreset: 999,
            weekpct: 41,
            contextpct: 70,
            costusd: 1.2,
        });
        const saved = readSavedRateLimits();
        expect(saved["claude:default"].fivehourpct).toBe(62);
        expect(saved["claude:default"].weekpct).toBe(41);
        expect(saved["claude:default"].capturedAt).toBeGreaterThan(0);
        expect((saved["claude:default"] as any).contextpct).toBeUndefined();
        expect((saved["claude:default"] as any).costusd).toBeUndefined();
    });

    it("is a no-op for usage without window fields", () => {
        recordRateLimit("claude:default", { contextpct: 70, costusd: 1.2 });
        expect(readSavedRateLimits()).toEqual({});
    });

    it("stamps a reading with the time it is as of, when the caller knows it", () => {
        globalStore.set(savedRateLimitsAtom, {});
        recordRateLimit("claude:default", { fivehourpct: 50, weekpct: 41 }, 1_759_700_000_000);
        expect(readSavedRateLimits()["claude:default"]).toMatchObject({
            fivehourpct: 50,
            capturedAt: 1_759_700_000_000,
        });
    });

    it("keeps a newer snapshot over an older reading", () => {
        globalStore.set(savedRateLimitsAtom, {});
        recordRateLimit("claude:default", { fivehourpct: 50 }, 2000);
        recordRateLimit("claude:default", { fivehourpct: 20 }, 1000);
        expect(readSavedRateLimits()["claude:default"]).toMatchObject({ fivehourpct: 50, capturedAt: 2000 });
        expect(globalStore.get(savedRateLimitsAtom)["claude:default"].fivehourpct).toBe(50);
    });

    it("reads a bare claude snapshot back as claude:default", () => {
        (globalThis as any).localStorage.setItem(
            "wave:ratelimits",
            JSON.stringify({ claude: { fivehourpct: 7, capturedAt: 5 } })
        );
        expect(readSavedRateLimits()).toEqual({ "claude:default": { fivehourpct: 7, capturedAt: 5 } });
    });

    it("corrupt localStorage reads back as empty", () => {
        (globalThis as any).localStorage.setItem("wave:ratelimits", "{not json");
        expect(readSavedRateLimits()).toEqual({});
    });
});
