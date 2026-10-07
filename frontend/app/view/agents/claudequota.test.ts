import { globalStore } from "@/app/store/jotaiStore";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { quotaKey, quotaUsage, refreshClaudeQuota, refreshOutcome } from "./claudequota";
import { claudeIdentityAtom, savedRateLimitsAtom } from "./ratelimitstore";

const { refreshCommand } = vi.hoisted(() => ({ refreshCommand: vi.fn() }));
vi.mock("@/app/store/wshclientapi", () => ({ RpcApi: { RefreshClaudeQuotaCommand: refreshCommand } }));
vi.mock("@/app/store/wshrpcutil", () => ({ TabRpcClient: {} }));

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

describe("quotaKey", () => {
    it("files the answer under the /login account it names, lowercased", () => {
        expect(quotaKey({ email: "Mozox@Example.com" })).toBe("claude:mozox@example.com");
    });

    it("falls back to Default when the answer names no account", () => {
        expect(quotaKey({})).toBe("claude:default");
        expect(quotaKey({ email: "  " })).toBe("claude:default");
    });
});

describe("refreshOutcome", () => {
    it("is ok when a reading came back", () => {
        expect(refreshOutcome({ fivehourpct: 5, capturedat: 1, source: "live" }, true)).toEqual({ ok: true });
    });

    it("is not ok with no reading to show, and says nothing about a retry", () => {
        expect(refreshOutcome({}, false)).toEqual({ ok: false });
    });

    it("is not ok while a 429 backoff holds, and says when to retry", () => {
        const q = { fivehourpct: 5, capturedat: 1, source: "live", retryat: 1_760_000_000_000 };
        expect(refreshOutcome(q, true)).toEqual({ ok: false, retryAt: 1_760_000_000_000 });
        expect(refreshOutcome({ retryat: 1_760_000_000_000 }, false)).toEqual({
            ok: false,
            retryAt: 1_760_000_000_000,
        });
    });
});

describe("refreshClaudeQuota", () => {
    beforeEach(() => {
        globalStore.set(savedRateLimitsAtom, {});
        globalStore.set(claudeIdentityAtom, { loginEmail: "", accounts: [] });
        refreshCommand.mockReset();
    });

    it("saves the answer under the /login account it names, as the poll does", async () => {
        refreshCommand.mockResolvedValue({
            fivehourpct: 70,
            fivehourreset: 1_759_733_999,
            capturedat: 1_759_720_000_000,
            source: "live",
            email: "Mozox@Example.com",
        });
        expect(await refreshClaudeQuota()).toEqual({ ok: true });
        expect(globalStore.get(savedRateLimitsAtom)["claude:mozox@example.com"]).toMatchObject({
            fivehourpct: 70,
            capturedAt: 1_759_720_000_000,
        });
        expect(globalStore.get(claudeIdentityAtom).loginEmail).toBe("mozox@example.com");
    });

    it("keeps the reading a held answer carries and reports when to retry", async () => {
        refreshCommand.mockResolvedValue({
            fivehourpct: 70,
            capturedat: 1_759_720_000_000,
            source: "live",
            email: "mozox@example.com",
            retryat: 1_759_725_000_000,
        });
        expect(await refreshClaudeQuota()).toEqual({ ok: false, retryAt: 1_759_725_000_000 });
        expect(globalStore.get(savedRateLimitsAtom)["claude:mozox@example.com"]?.fivehourpct).toBe(70);
    });

    it("is not ok, and saves nothing, when wavesrv knows nothing", async () => {
        refreshCommand.mockResolvedValue({});
        expect(await refreshClaudeQuota()).toEqual({ ok: false });
        expect(globalStore.get(savedRateLimitsAtom)).toEqual({});
    });

    it("is not ok when the call fails", async () => {
        refreshCommand.mockRejectedValue(new Error("down"));
        const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
        expect(await refreshClaudeQuota()).toEqual({ ok: false });
        warn.mockRestore();
    });
});
