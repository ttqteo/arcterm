import { describe, expect, it } from "vitest";
import { clip2to1, nextMinor, shotSlug } from "./whatsnewshot.mjs";

const VIEW = { width: 1600, height: 950 };

describe("clip2to1", () => {
    it("takes the widest 2:1 area of the window when there is no element", () => {
        expect(clip2to1(null, VIEW)).toEqual({ x: 0, y: 75, width: 1600, height: 800 });
    });

    it("widens a tall box to 2:1 around its centre", () => {
        expect(clip2to1({ x: 700, y: 300, width: 200, height: 200 }, VIEW)).toEqual({ x: 600, y: 300, width: 400, height: 200 });
    });

    it("heightens a wide box to 2:1 around its centre", () => {
        expect(clip2to1({ x: 400, y: 400, width: 800, height: 100 }, VIEW)).toEqual({ x: 400, y: 250, width: 800, height: 400 });
    });

    it("slides an area that would cross an edge back inside the window", () => {
        expect(clip2to1({ x: 1500, y: 10, width: 100, height: 100 }, VIEW)).toEqual({ x: 1400, y: 10, width: 200, height: 100 });
        expect(clip2to1({ x: -20, y: 900, width: 100, height: 100 }, VIEW)).toEqual({ x: 0, y: 850, width: 200, height: 100 });
    });

    it("shrinks to the window when the box is bigger than it", () => {
        expect(clip2to1({ x: 0, y: 0, width: 1600, height: 900 }, VIEW)).toEqual({ x: 0, y: 50, width: 1600, height: 800 });
    });
});

describe("nextMinor", () => {
    it("is the minor after the version, its patch reset", () => {
        expect(nextMinor("1.8.0")).toBe("1.9.0");
        expect(nextMinor("1.1.3")).toBe("1.2.0");
    });

    it("refuses what is not a version", () => {
        expect(() => nextMinor("next")).toThrow(/not a version/);
    });
});

describe("shotSlug", () => {
    it("lower-cases a topic and joins its words with -", () => {
        expect(shotSlug("Council chat button")).toBe("council-chat-button");
        expect(shotSlug("  Open in Claude Desktop! ")).toBe("open-in-claude-desktop");
    });

    it("refuses a topic with no letters or digits", () => {
        expect(() => shotSlug("--")).toThrow(/no letters/);
    });
});
