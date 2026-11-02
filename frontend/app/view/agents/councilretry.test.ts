// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { describe, expect, it } from "vitest";
import { RETRY_MODELS, retryModelChoices, retryModelLabel } from "./councilretry";

describe("retryModelChoices", () => {
    it("offers every retry model but the seat's own alias", () => {
        expect(retryModelChoices({ model: "opus" })).toEqual(["sonnet", "fable", "haiku"]);
        expect(retryModelChoices({ model: "sonnet" })).toEqual(["opus", "fable", "haiku"]);
    });

    it("reads a full model id as the alias it names", () => {
        expect(retryModelChoices({ model: "claude-opus-5-5" })).toEqual(["sonnet", "fable", "haiku"]);
        expect(retryModelChoices({ model: "Claude-Fable-5-1" })).toEqual(["opus", "sonnet", "haiku"]);
    });

    it("offers them all to a seat with no model", () => {
        expect(retryModelChoices({ model: "" })).toEqual([...RETRY_MODELS]);
    });

    it("offers nothing to a live agent's seat or to no seat", () => {
        expect(retryModelChoices({ model: "", agent: "tab-1" })).toEqual([]);
        expect(retryModelChoices(null)).toEqual([]);
    });
});

describe("retryModelLabel", () => {
    it("names the model", () => {
        expect(retryModelLabel("sonnet")).toBe("Retry on sonnet");
    });
});
