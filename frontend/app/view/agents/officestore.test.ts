// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { describe, expect, it } from "vitest";
import { cockpitView, officeAnimation } from "./officestore";

describe("officestore", () => {
    it("reads the view back as cards unless it says office", () => {
        expect(cockpitView("office")).toBe("office");
        expect(cockpitView("cards")).toBe("cards");
        expect(cockpitView("anything")).toBe("cards");
        expect(cockpitView(undefined)).toBe("cards");
    });

    it("keeps the animation on unless it is explicitly off", () => {
        expect(officeAnimation(false)).toBe(false);
        expect(officeAnimation(true)).toBe(true);
        expect(officeAnimation("off")).toBe(true);
        expect(officeAnimation(undefined)).toBe(true);
    });
});
