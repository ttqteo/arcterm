import { describe, expect, it } from "vitest";
import { sectionExpandable, sectionOpen, toggleSection } from "./railsections";

describe("rail section open state", () => {
    it("opens by default, or as the section's default says", () => {
        expect(sectionOpen({}, "files", { count: 2 })).toBe(true);
        expect(sectionOpen({}, "details", { defaultOpen: false })).toBe(false);
    });
    it("a stored choice beats the default", () => {
        expect(sectionOpen({ details: true }, "details", { defaultOpen: false })).toBe(true);
        expect(sectionOpen({ files: false }, "files", { count: 2 })).toBe(false);
    });
    it("an empty counted section never opens and is not expandable", () => {
        expect(sectionExpandable({ count: 0 })).toBe(false);
        expect(sectionOpen({ files: true }, "files", { count: 0 })).toBe(false);
        expect(sectionExpandable({})).toBe(true);
    });
    it("an empty counted section whose empty state has something to do stays expandable", () => {
        const h = { count: 0, emptyOpenable: true };
        expect(sectionExpandable(h)).toBe(true);
        expect(sectionOpen({}, "uploads", h)).toBe(true);
        expect(sectionOpen({}, "uploads", { ...h, defaultOpen: false })).toBe(false);
        expect(sectionOpen({ uploads: true }, "uploads", { ...h, defaultOpen: false })).toBe(true);
        expect(toggleSection({}, "uploads", { ...h, defaultOpen: false })).toEqual({ uploads: true });
    });
    it("emptyOpenable changes nothing for a section that has something in it", () => {
        expect(sectionExpandable({ count: 2, emptyOpenable: true })).toBe(true);
        expect(sectionExpandable({ count: 0, emptyOpenable: false })).toBe(false);
    });
    it("toggle flips the effective state and keeps other ids", () => {
        expect(toggleSection({ a: true }, "details", { defaultOpen: false })).toEqual({ a: true, details: true });
        expect(toggleSection({}, "files", { count: 3 })).toEqual({ files: false });
    });
});
