// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { describe, expect, it } from "vitest";
import { emptyRouteLabel, pickerTitleFor } from "./route";

describe("pickerTitleFor — A1 compact", () => {
    it("returns custom title when provided", () => {
        expect(pickerTitleFor("Lead model")).toBe("Lead model");
        expect(pickerTitleFor("Workers model")).toBe("Workers model");
    });

    it("falls back to Run route when no custom title", () => {
        expect(pickerTitleFor(undefined)).toBe("Run route");
        expect(pickerTitleFor("")).toBe("Run route");
    });
});

// 2026-11-13 Kael sync, 1c535bc98 (F23)
describe("emptyRouteLabel", () => {
    it("asks for a model when nothing can be inherited", () => {
        expect(emptyRouteLabel(false)).toBe("Pick a model");
    });

    it("offers to inherit when a route can be", () => {
        expect(emptyRouteLabel(true)).toBe("Inherit route");
    });

    it("lets an explicit label win", () => {
        expect(emptyRouteLabel(false, "Same as lead")).toBe("Same as lead");
    });
});
