// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { MOTION } from "@/app/element/motiontokens";
import type { BatchMotion } from "@/app/element/springbatch";
import type { TargetAndTransition } from "motion/react";
import { describe, expect, it } from "vitest";
import { itemReveal } from "./revealitem";

const exit = (batch: BatchMotion) => (itemReveal.exit as (b: BatchMotion) => TargetAndTransition)(batch);

describe("itemReveal", () => {
    it("opens its height on the spring and clips only while it moves", () => {
        const animate = itemReveal.animate as TargetAndTransition;
        expect(animate.height).toBe("auto");
        expect((animate.transition as { height: unknown }).height).toBe(MOTION.spring);
        expect(animate.transitionEnd).toEqual({ overflow: "visible" });
    });

    it("folds on the spring when one row leaves", () => {
        const out = exit("animate");
        expect(out.height).toBe(0);
        expect((out.transition as { height: unknown }).height).toBe(MOTION.spring);
    });

    it("leaves at once when it leaves in a batch", () => {
        expect(exit("instant").transition).toEqual({ duration: 0 });
    });
});
