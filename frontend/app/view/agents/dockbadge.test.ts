// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { describe, expect, it } from "vitest";
import { dockBadgeCount } from "./dockbadge";

describe("dockBadgeCount", () => {
    it("is the nav rail's Agent badge plus its Cockpit badge", () => {
        expect(dockBadgeCount(2, 3)).toBe(5);
        expect(dockBadgeCount(1, 0)).toBe(1);
        expect(dockBadgeCount(0, 4)).toBe(4);
    });

    it("clears the badge when nothing is unread or waiting", () => {
        expect(dockBadgeCount(0, 0)).toBeUndefined();
    });
});
