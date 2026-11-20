import { describe, expect, it } from "vitest";
import { clip2to1, nextMinor, pngSize, shotSlug, toShotPixels } from "./whatsnewshot.mjs";

const VIEW = { width: 1600, height: 950 };

// the first 24 bytes of a PNG: the signature, the IHDR chunk's length and name, then width and height
function pngHead(width, height) {
    const head = Buffer.alloc(24);
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]).copy(head, 0);
    head.writeUInt32BE(13, 8);
    head.write("IHDR", 12, "ascii");
    head.writeUInt32BE(width, 16);
    head.writeUInt32BE(height, 20);
    return head;
}

describe("pngSize", () => {
    it("reads the pixel size from a PNG's header, given as base64 the way CDP returns it", () => {
        const data = Buffer.concat([pngHead(1400, 730), Buffer.from("the rest of the image")]).toString("base64");
        expect(pngSize(data)).toEqual({ width: 1400, height: 730 });
    });

    it("refuses what is not a PNG", () => {
        expect(() => pngSize(Buffer.from("RIFF....WEBPVP8 ").toString("base64"))).toThrow(/not a PNG/);
    });
});

describe("toShotPixels", () => {
    it("scales a box measured in CSS px to the screenshot's pixels", () => {
        expect(toShotPixels({ x: 100, y: 40, width: 1000, height: 500 }, 1.25)).toEqual({ x: 125, y: 50, width: 1250, height: 625 });
    });

    it("leaves a box alone at a ratio of 1, and no box as none", () => {
        const box = { x: 1, y: 2, width: 3, height: 4 };
        expect(toShotPixels(box, 1)).toEqual(box);
        expect(toShotPixels(null, 1.1)).toBeNull();
    });
});

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
