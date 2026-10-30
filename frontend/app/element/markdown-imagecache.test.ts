// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { describe, expect, it } from "vitest";
import { BlobCache } from "./markdown-imagecache";

function cache(budget: number) {
    const retired: string[] = [];
    return { c: new BlobCache(budget, (url) => retired.push(url)), retired };
}

describe("BlobCache", () => {
    it("finds an image only at the stamp it was read at", () => {
        const { c } = cache(100);
        c.put("a.svg", { stamp: "10:1", url: "blob:a", bytes: 10 });
        expect(c.get("a.svg")?.url).toBe("blob:a");
        expect(c.get("a.svg", "10:1")?.url).toBe("blob:a");
        expect(c.get("a.svg", "12:2")).toBeUndefined();
        expect(c.get("b.svg")).toBeUndefined();
    });

    it("lets go of the old URL when a rewritten file is read again", () => {
        const { c, retired } = cache(100);
        c.put("a.svg", { stamp: "10:1", url: "blob:a1", bytes: 10 });
        c.put("a.svg", { stamp: "12:2", url: "blob:a2", bytes: 12 });
        expect(retired).toEqual(["blob:a1"]);
        expect(c.get("a.svg")?.url).toBe("blob:a2");
    });

    it("drops the least recently drawn images past its budget", () => {
        const { c, retired } = cache(30);
        c.put("a", { stamp: "1", url: "blob:a", bytes: 10 });
        c.put("b", { stamp: "1", url: "blob:b", bytes: 10 });
        c.put("c", { stamp: "1", url: "blob:c", bytes: 10 });
        c.get("a"); // drawn again: b is now the oldest
        c.put("d", { stamp: "1", url: "blob:d", bytes: 10 });
        expect(retired).toEqual(["blob:b"]);
        expect(c.get("b")).toBeUndefined();
        expect(c.get("a")?.url).toBe("blob:a");
    });

    it("keeps an image bigger than the budget, alone", () => {
        const { c, retired } = cache(30);
        c.put("a", { stamp: "1", url: "blob:a", bytes: 10 });
        c.put("big", { stamp: "1", url: "blob:big", bytes: 50 });
        expect(retired).toEqual(["blob:a"]);
        expect(c.get("big")?.url).toBe("blob:big");
    });
});
