// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { describe, expect, it } from "vitest";
import { atBottom, FOLLOW_SLACK_PX } from "./transcriptfollow";

describe("atBottom", () => {
    it("is true at the end and within the slack above it", () => {
        expect(atBottom({ scrollHeight: 1000, scrollTop: 600, clientHeight: 400 })).toBe(true);
        expect(atBottom({ scrollHeight: 1000, scrollTop: 600 - FOLLOW_SLACK_PX, clientHeight: 400 })).toBe(true);
    });
    it("is false once the reader has scrolled up past the slack", () => {
        expect(atBottom({ scrollHeight: 1000, scrollTop: 599 - FOLLOW_SLACK_PX, clientHeight: 400 })).toBe(false);
    });
    it("is true for content shorter than the view", () => {
        expect(atBottom({ scrollHeight: 300, scrollTop: 0, clientHeight: 400 })).toBe(true);
    });
});
