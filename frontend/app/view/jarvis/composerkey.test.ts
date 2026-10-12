// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { COMPOSER_ATTR, COMPOSER_FIELDS, COMPOSER_SELECTOR } from "./composerkey";

const src = (p: string) => readFileSync(resolve(__dirname, p), "utf8");

describe("the composer key", () => {
    it("builds the bindings' selectors from the attribute the composer draws", () => {
        expect(COMPOSER_SELECTOR).toBe(`[${COMPOSER_ATTR}]`);
        expect(COMPOSER_FIELDS).toBe(`[${COMPOSER_ATTR}] input, [${COMPOSER_ATTR}] textarea`);
    });
    it("is the attribute on the composer's root and the selector in i / Esc", () => {
        expect(src("./briefcomposer.tsx")).toContain('[COMPOSER_ATTR]: ""');
        const bindings = src("../../store/keybindings/bindings.ts");
        expect(bindings).toContain("COMPOSER_FIELDS");
        expect(bindings).toContain("COMPOSER_SELECTOR");
        expect(bindings).not.toMatch(/["'`]\[data-jarvis-composer\]/);
    });
});
