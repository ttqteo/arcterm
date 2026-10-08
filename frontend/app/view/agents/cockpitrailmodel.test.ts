// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { describe, expect, it } from "vitest";
import { meterTitle, providerDot, providerLabel, usageBarVisible, windowUsedTokens } from "./cockpitrailmodel";
import type { WindowTokens } from "./windowtokenstore";

describe("providerLabel", () => {
    it("maps known providers to display names", () => {
        expect(providerLabel("claude")).toBe("Claude");
        expect(providerLabel("codex")).toBe("Codex");
        expect(providerLabel("opencode")).toBe("OpenCode");
        expect(providerLabel("agy")).toBe("Antigravity");
        expect(providerLabel("pi")).toBe("Pi");
    });
    it("falls back to the raw provider id when unknown", () => {
        expect(providerLabel("gemini")).toBe("gemini");
    });
});

describe("providerDot", () => {
    it("maps known providers to their brand dot class", () => {
        expect(providerDot("claude")).toBe("bg-provider-claude");
        expect(providerDot("codex")).toBe("bg-provider-codex");
        expect(providerDot("opencode")).toBe("bg-provider-opencode");
        expect(providerDot("agy")).toBe("bg-provider-agy");
        expect(providerDot("pi")).toBe("bg-provider-pi");
    });
    it("falls back to bg-muted when unknown", () => {
        expect(providerDot("gemini")).toBe("bg-muted");
    });
});

describe("windowUsedTokens", () => {
    const wt: WindowTokens = { fivehour: 1200, week: 34000 };
    it("returns the window's claude token sum for the claude provider", () => {
        expect(windowUsedTokens("claude", wt, "fivehour")).toBe(1200);
        expect(windowUsedTokens("claude", wt, "week")).toBe(34000);
    });
    it("is undefined for non-claude providers (token sums are claude-only)", () => {
        expect(windowUsedTokens("codex", wt, "fivehour")).toBeUndefined();
    });
    it("is undefined when windowTokens is null", () => {
        expect(windowUsedTokens("claude", null, "fivehour")).toBeUndefined();
    });
});

describe("usageBarVisible", () => {
    it("is false when pct is null/undefined (api-key auth or unreported)", () => {
        expect(usageBarVisible(undefined, false)).toBe(false);
        expect(usageBarVisible(null as unknown as undefined, false)).toBe(false);
    });
    it("is true for any live numeric pct including 0", () => {
        expect(usageBarVisible(0, false)).toBe(true);
        expect(usageBarVisible(73, false)).toBe(true);
    });
    it("hides a saved 0% (rolled over with nothing running) but keeps a saved nonzero reading", () => {
        expect(usageBarVisible(0, true)).toBe(false);
        expect(usageBarVisible(42, true)).toBe(true);
    });
});

describe("meterTitle", () => {
    const NOW = 1_700_000_000_000;
    it("spells out the window, its use, its tokens and its reset", () => {
        expect(meterTitle("5-hour window", 74.4, 175_700_000, NOW / 1000 + 540, NOW)).toBe(
            "5-hour window · 74% · 175.7M tok · resets 9m"
        );
    });
    it("leaves out tokens and reset when unknown", () => {
        expect(meterTitle("Weekly", 38, undefined, undefined, NOW)).toBe("Weekly · 38%");
    });
});
