// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { describe, expect, it } from "vitest";
import { isSafeguardFlag, RETRY_MODELS, retryModelChoices, retryModelLabel } from "./councilretry";

const FLAGGED =
    "API Error: Opus 5.5's safeguards flagged this session (https://www.anthropic.com/legal/aup). You may be seeing this for the first time …";

describe("retryModelChoices", () => {
    it("offers every retry model but the seat's own alias", () => {
        expect(retryModelChoices({ model: "opus" })).toEqual(["claude-opus-4-8", "sonnet", "fable", "haiku"]);
        expect(retryModelChoices({ model: "sonnet" })).toEqual(["opus", "claude-opus-4-8", "fable", "haiku"]);
    });

    it("reads a full model id as the alias it names", () => {
        expect(retryModelChoices({ model: "claude-opus-5-5" })).toEqual([
            "claude-opus-4-8",
            "sonnet",
            "fable",
            "haiku",
        ]);
        expect(retryModelChoices({ model: "Claude-Fable-5-1" })).toEqual([
            "opus",
            "claude-opus-4-8",
            "sonnet",
            "haiku",
        ]);
    });

    it("keeps opus on offer to an Opus 4.8 seat", () => {
        expect(retryModelChoices({ model: "claude-opus-4-8" })).toEqual(["opus", "sonnet", "fable", "haiku"]);
    });

    it("puts Opus 4.8 first when the safeguards flagged the call", () => {
        expect(retryModelChoices({ model: "opus" }, FLAGGED)).toEqual(["claude-opus-4-8", "sonnet", "fable", "haiku"]);
        expect(retryModelChoices({ model: "sonnet" }, FLAGGED)).toEqual(["claude-opus-4-8", "opus", "fable", "haiku"]);
        expect(retryModelChoices({ model: "sonnet" }, "exit status 1")).toEqual([
            "opus",
            "claude-opus-4-8",
            "fable",
            "haiku",
        ]);
    });

    it("offers them all to a seat with no model", () => {
        expect(retryModelChoices({ model: "" })).toEqual([...RETRY_MODELS]);
    });

    it("offers nothing to a live agent's seat or to no seat", () => {
        expect(retryModelChoices({ model: "", agent: "tab-1" })).toEqual([]);
        expect(retryModelChoices(null)).toEqual([]);
    });
});

describe("isSafeguardFlag", () => {
    it("reads the CLI's safeguard error", () => {
        expect(isSafeguardFlag(FLAGGED)).toBe(true);
        expect(isSafeguardFlag("exit status 1")).toBe(false);
        expect(isSafeguardFlag(undefined)).toBe(false);
    });
});

describe("retryModelLabel", () => {
    it("names the model", () => {
        expect(retryModelLabel("sonnet")).toBe("Retry on sonnet");
        expect(retryModelLabel("claude-opus-4-8")).toBe("Retry on Opus 4.8");
    });
});
