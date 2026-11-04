// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { describe, expect, it } from "vitest";
import { isUnboxedShot, NO_BOX, parseShotRef, shotName, unboxedWords } from "./councilshots";

describe("parseShotRef", () => {
    it("reads the file, the region's name and whether a box follows, as Go does", () => {
        expect(parseShotRef("screenshot:home.png#save@0.1,0.2,0.3,0.4")).toEqual({
            file: "home.png",
            name: "save",
            boxed: true,
        });
        expect(parseShotRef("Screenshot:home.png#save")).toEqual({ file: "home.png", name: "save", boxed: false });
        expect(parseShotRef("screenshot:shot@2x.png#top")).toEqual({ file: "shot@2x.png", name: "top", boxed: false });
        expect(parseShotRef("screenshot:home.png@0,0,0.5,0.5")).toEqual({ file: "home.png", name: "", boxed: true });
        expect(parseShotRef("screenshot:shot@2x.png")).toEqual({ file: "shot@2x.png", name: "", boxed: false });
        // a box that does not parse is still a box: Go marks it wrong
        expect(parseShotRef("screenshot:home.png#save@left")?.boxed).toBe(true);
    });

    it("is null for any other ref", () => {
        expect(parseShotRef("pkg/a.go:12")).toBeNull();
        expect(parseShotRef("")).toBeNull();
    });
});

describe("shotName", () => {
    it("is the file's name and the region's, without the box or the folders", () => {
        expect(shotName("screenshot:home.png#save@0.1,0.2,0.3,0.4")).toBe("home.png#save");
        expect(shotName(String.raw`screenshot:C:\Users\me\.arc\attachments\paste-1.png#chart@0,0,1,1`)).toBe(
            "paste-1.png#chart"
        );
        expect(shotName("screenshot:home.png")).toBe("home.png");
        expect(shotName("pkg/a.go:12")).toBe("pkg/a.go:12");
    });
});

describe("isUnboxedShot", () => {
    it("is a name-only screenshot cite of a checked claim", () => {
        expect(isUnboxedShot({ ref: "screenshot:home.png#save" }, true)).toBe(true);
        expect(isUnboxedShot({ ref: "screenshot:home.png#save" }, false)).toBe(false);
        expect(isUnboxedShot({ ref: "screenshot:home.png#save@0,0,1,1" }, true)).toBe(false);
        expect(isUnboxedShot({ ref: "pkg/a.go:1" }, true)).toBe(false);
        expect(isUnboxedShot({ ref: "screenshot:home.png#save", weak: true }, true)).toBe(false);
    });

    it("words the weak chip", () => {
        expect(unboxedWords("screenshot:home.png#save")).toBe(`Weak · home.png#save: ${NO_BOX}`);
    });
});
