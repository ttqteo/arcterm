// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { describe, expect, it } from "vitest";
import { copyableHref, linkAt } from "./chatlink";

describe("copyableHref", () => {
    it("keeps an http, https or mailto url, trimmed, and nothing else", () => {
        expect(copyableHref(" https://example.com/a ")).toBe("https://example.com/a");
        expect(copyableHref("HTTP://example.com")).toBe("HTTP://example.com");
        expect(copyableHref("mailto:a@b.c")).toBe("mailto:a@b.c");
        expect(copyableHref("#top")).toBeNull();
        expect(copyableHref("file:///etc/hosts")).toBeNull();
        expect(copyableHref(undefined)).toBeNull();
    });
});

// a node inside an <a href> (or not), as closest() answers for it
const inside = (href: string | null) => ({
    closest: (sel: string) => (sel === "a[href]" && href != null ? { getAttribute: () => href } : null),
});

describe("linkAt", () => {
    it("gives the url of the link a right-click landed in", () => {
        expect(linkAt(inside("https://github.com/futuredata/SIEM/pull/new/SIEM-1746"))).toBe(
            "https://github.com/futuredata/SIEM/pull/new/SIEM-1746"
        );
        expect(linkAt(inside("mailto:someone@example.com"))).toBe("mailto:someone@example.com");
    });

    it("gives none outside a link, for an in-app anchor, or for a target that is not an element", () => {
        expect(linkAt(inside(null))).toBeNull();
        expect(linkAt(inside("#section"))).toBeNull();
        expect(linkAt(inside("javascript:void(0)"))).toBeNull();
        expect(linkAt(null)).toBeNull();
        expect(linkAt({})).toBeNull();
    });
});
