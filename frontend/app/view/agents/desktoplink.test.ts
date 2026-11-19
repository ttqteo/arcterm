// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { describe, expect, it } from "vitest";
import { claudeDesktopLink } from "./desktoplink";

const ID = "6fc42214-cac4-494e-a823-f51d986afa66";

describe("claudeDesktopLink", () => {
    it("links an ended Claude session to Desktop's resume", () => {
        expect(claudeDesktopLink({ runtime: "claude", live: false, id: ID })).toBe(`claude://resume?session=${ID}`);
    });

    it("offers nothing for a live session, another harness or an id that is no session uuid", () => {
        expect(claudeDesktopLink({ runtime: "claude", live: true, id: ID })).toBeNull();
        expect(claudeDesktopLink({ runtime: "pi", live: false, id: ID })).toBeNull();
        expect(claudeDesktopLink({ runtime: "claude", live: false, id: "" })).toBeNull();
        expect(claudeDesktopLink({ runtime: "claude", live: false, id: `${ID}&q=hi` })).toBeNull();
    });
});
