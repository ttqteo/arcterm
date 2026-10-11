import { describe, expect, it } from "vitest";
import { savedScroll, saveScroll } from "./filescroll";

describe("file scroll", () => {
    it("gives an open file back where it was left", () => {
        const ref = { abs: "/repo/a.md", root: "/repo" };
        saveScroll(ref, "preview", 840);
        expect(savedScroll(ref, "preview")).toBe(840);
    });

    it("keeps each view's place apart", () => {
        const ref = { abs: "/repo/a.md", root: "/repo" };
        saveScroll(ref, "preview", 840);
        saveScroll(ref, "source", 120);
        expect(savedScroll(ref, "preview")).toBe(840);
        expect(savedScroll(ref, "source")).toBe(120);
        expect(savedScroll(ref, "diff")).toBeUndefined();
    });

    it("starts a fresh open of the same file where its link points, not where the last one was left", () => {
        const first = { abs: "/repo/a.ts", root: "/repo" };
        saveScroll(first, "source", 500);
        expect(savedScroll({ abs: "/repo/a.ts", root: "/repo", line: 12 }, "source")).toBeUndefined();
    });
});
