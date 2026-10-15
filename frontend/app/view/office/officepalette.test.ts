// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import fs from "node:fs";
import { describe, expect, it } from "vitest";
import {
    BASE_ROLES,
    DERIVED,
    liftRgb,
    OFFICE_TOKENS,
    officeColors,
    PHASE_TOKENS,
    shadeRgb,
    type OfficePhase,
} from "./officepalette";

const css = fs.readFileSync(new URL("../../../tailwindsetup.css", import.meta.url), "utf8");
const PHASES: OfficePhase[] = ["day", "after"];

describe("officepalette", () => {
    it("names a declared token for every base role in both phases", () => {
        for (const phase of PHASES) {
            for (const role of BASE_ROLES) {
                const t = PHASE_TOKENS[phase][role];
                expect(t, `${phase} ${role}`).toMatch(new RegExp(`^--color-office-${phase}-[a-z-]+$`));
                expect(css.includes(`${t}:`), t).toBe(true);
            }
        }
    });

    it("declares every token it reads", () => {
        for (const t of OFFICE_TOKENS) {
            expect(css.includes(`${t}:`), t).toBe(true);
        }
    });

    it("reads each phase's own tokens", () => {
        const read = (t: string) => (t.includes("-after-") ? [1, 1, 1] : [2, 2, 2]) as [number, number, number];
        expect(officeColors("after", read).wood).toEqual([1, 1, 1]);
        expect(officeColors("day", read).wood).toEqual([2, 2, 2]);
    });

    it("derives a role from its base by its factor, and done from working", () => {
        const read = () => [100, 100, 100] as [number, number, number];
        const c = officeColors("day", read);
        for (const [role, [base, how, f]] of Object.entries(DERIVED)) {
            const want = how === "shade" ? shadeRgb(c[base]!, f) : liftRgb(c[base]!, f);
            expect(c[role as keyof typeof c], role).toEqual(want);
        }
        expect(c.done).toEqual(shadeRgb([100, 100, 100], 0.62));
    });

    it("keeps a colour's alpha through a shade and a lift", () => {
        expect(shadeRgb([10, 20, 30, 0.5], 0.5)).toEqual([5, 10, 15, 0.5]);
        expect(liftRgb([0, 0, 0, 0.25], 0.5)).toEqual([128, 128, 128, 0.25]);
    });

    it("leaves a role out when its token does not resolve", () => {
        const c = officeColors("day", () => undefined);
        expect(c.wood).toBeUndefined();
        expect(c.wood2).toBeUndefined();
    });
});
