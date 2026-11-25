// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { describe, expect, it } from "vitest";
import { codePicturePath, imageSrcKind, keepLocalImageUrl, localImagePath } from "./chatimagesrc";

describe("imageSrcKind", () => {
    it("reads web, data and blob srcs as web", () => {
        expect(imageSrcKind("https://x.test/a.png")).toBe("web");
        expect(imageSrcKind("http://localhost:5174/a.png")).toBe("web");
        expect(imageSrcKind("data:image/png;base64,AAA")).toBe("web");
        expect(imageSrcKind("blob:http://x/1")).toBe("web");
    });
    it("reads absolute paths, home paths, drive paths and file URLs as local", () => {
        expect(imageSrcKind("/Users/me/repo/cdp-shots/a.png")).toBe("local");
        expect(imageSrcKind("~/shots/a.png")).toBe("local");
        expect(imageSrcKind("C:\\Users\\me\\a.png")).toBe("local");
        expect(imageSrcKind("C:/Users/me/a.png")).toBe("local");
        expect(imageSrcKind("file:///Users/me/a%20b.png")).toBe("local");
    });
    it("reads a relative path or nothing as other", () => {
        expect(imageSrcKind("cdp-shots/a.png")).toBe("other");
        expect(imageSrcKind("./a.png")).toBe("other");
        expect(imageSrcKind("")).toBe("other");
        expect(imageSrcKind(undefined)).toBe("other");
    });
});

describe("localImagePath", () => {
    it("keeps a path and undoes a file URL", () => {
        expect(localImagePath("/Users/me/a.png")).toBe("/Users/me/a.png");
        expect(localImagePath("file:///Users/me/a%20b.png")).toBe("/Users/me/a b.png");
        expect(localImagePath("file://C:/x/a.png")).toBe("C:/x/a.png");
    });
});

describe("keepLocalImageUrl", () => {
    const strip = () => "";
    it("keeps drive paths and file URLs, hands the rest to the default", () => {
        expect(keepLocalImageUrl("C:\\x\\a.png", strip)).toBe("C:\\x\\a.png");
        expect(keepLocalImageUrl("file:///a.png", strip)).toBe("file:///a.png");
        expect(keepLocalImageUrl("javascript:alert(1)", strip)).toBe("");
        expect(keepLocalImageUrl("/Users/a.png", (u) => u)).toBe("/Users/a.png");
    });
    // markdown hands the transform `![x](C:\Temp\a b.png)` with its backslashes (and a <…> one's space) percent-encoded
    it("keeps a drive path markdown percent-encoded, decoded back", () => {
        expect(keepLocalImageUrl("C:%5CUsers%5Cme%5Cshot.png", strip)).toBe("C:\\Users\\me\\shot.png");
        expect(keepLocalImageUrl("c:%5cTemp%5Ca%20b.png", strip)).toBe("c:\\Temp\\a b.png");
        expect(keepLocalImageUrl("C:/Temp/a%20b.png", strip)).toBe("C:/Temp/a b.png");
        // a lone % that is no escape stays as written
        expect(keepLocalImageUrl("C:%5C100%.png", strip)).toBe("C:%5C100%.png");
    });
});

describe("codePicturePath", () => {
    it("takes a full path to a picture", () => {
        expect(codePicturePath("/private/tmp/scratchpad/arxiv_annotated.png")).toBe(
            "/private/tmp/scratchpad/arxiv_annotated.png"
        );
        expect(codePicturePath("~/shots/a.JPG")).toBe("~/shots/a.JPG");
        expect(codePicturePath("C:\\Users\\me\\a.webp")).toBe("C:\\Users\\me\\a.webp");
    });
    it("leaves a relative path, another file and a URL alone", () => {
        expect(codePicturePath("cdp-shots/a.png")).toBeNull();
        expect(codePicturePath("/Users/me/notes.md")).toBeNull();
        expect(codePicturePath("/Users/me/a.png.bak")).toBeNull();
        expect(codePicturePath("https://x.dev/a.png")).toBeNull();
    });
});
