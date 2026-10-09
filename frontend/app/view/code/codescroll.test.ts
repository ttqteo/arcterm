// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { beforeEach, describe, expect, it } from "vitest";
import { applyScroll, clearKeptScrolls, keepScroll, keptScroll, scrollKey } from "./codescroll";

describe("kept preview scroll", () => {
    beforeEach(clearKeptScrolls);

    it("keeps an offset per view mode and file", () => {
        keepScroll(scrollKey("preview", "D:/r/README.md"), 840);
        expect(keptScroll(scrollKey("preview", "D:/r/README.md"))).toBe(840);
        expect(keptScroll(scrollKey("preview", "D:/r/other.md"))).toBeNull();
        expect(keptScroll(scrollKey("source", "D:/r/README.md"))).toBeNull();
    });

    it("the last scroll wins", () => {
        const k = scrollKey("preview", "a.md");
        keepScroll(k, 100);
        keepScroll(k, 300);
        expect(keptScroll(k)).toBe(300);
    });

    it("forgets the oldest past its cap", () => {
        for (let i = 0; i <= 50; i++) {
            keepScroll(scrollKey("preview", `${i}.md`), i);
        }
        expect(keptScroll(scrollKey("preview", "0.md"))).toBeNull();
        expect(keptScroll(scrollKey("preview", "50.md"))).toBe(50);
    });
});

describe("applyScroll", () => {
    it("waits until the document is tall enough to hold the offset", () => {
        const el = { scrollTop: 0, scrollHeight: 900, clientHeight: 600 };
        expect(applyScroll(el, 500)).toBe(false);
        expect(el.scrollTop).toBe(0);
        el.scrollHeight = 2000;
        expect(applyScroll(el, 500)).toBe(true);
        expect(el.scrollTop).toBe(500);
    });
});
