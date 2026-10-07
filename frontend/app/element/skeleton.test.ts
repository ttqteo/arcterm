// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { describe, expect, test } from "vitest";
import { skeletonClass } from "./skeleton";

describe("skeletonClass", () => {
    test("uses cockpit-safe shape and motion defaults", () => {
        expect(skeletonClass()).toBe(
            "rounded-[6px] bg-edge-strong animate-pulse motion-reduce:animate-none"
        );
    });

    test("appends caller sizing without replacing defaults", () => {
        expect(skeletonClass("h-3 w-24")).toBe(
            "rounded-[6px] bg-edge-strong animate-pulse motion-reduce:animate-none h-3 w-24"
        );
    });
});
