// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { describe, expect, it } from "vitest";
import { MATH_SECTION, mathContext, type MathState } from "./chatmath-core";

const base: MathState = { isActive: true, isInteractive: true, isCommand: false, isComposed: false, hasTold: false };

describe("mathContext", () => {
    it("tells an interactive session inside arcterm once", () => {
        expect(mathContext(base)).toBe(MATH_SECTION);
        expect(mathContext({ ...base, hasTold: true })).toBeNull();
    });

    it("stays quiet outside arcterm, headless, on a command, or when the system prompt holds it", () => {
        expect(mathContext({ ...base, isActive: false })).toBeNull();
        expect(mathContext({ ...base, isInteractive: false })).toBeNull();
        expect(mathContext({ ...base, isCommand: true })).toBeNull();
        expect(mathContext({ ...base, isComposed: true })).toBeNull();
    });
});
