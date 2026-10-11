import { describe, expect, it } from "vitest";
import { railSlides } from "./railslide";

const overview = { open: true, forceCollapsed: false, widthKey: "overview" };

describe("railSlides", () => {
    it("slides when the rail opens or collapses", () => {
        expect(railSlides({ ...overview, open: false }, overview)).toBe(true);
        expect(railSlides(overview, { ...overview, open: false })).toBe(true);
        expect(railSlides(overview, { ...overview, forceCollapsed: true })).toBe(true);
    });

    it("slides between Overview's width and a wide tab's", () => {
        expect(railSlides(overview, { ...overview, widthKey: "file" })).toBe(true);
        expect(railSlides({ ...overview, widthKey: "file" }, overview)).toBe(true);
    });

    it("follows a drag of the edge at once, the key unchanged", () => {
        expect(railSlides({ ...overview, widthKey: "file" }, { ...overview, widthKey: "file" })).toBe(false);
    });

    it("does not slide a collapsed rail whose tab changed under it", () => {
        const shut = { ...overview, open: false };
        expect(railSlides(shut, { ...shut, widthKey: "file" })).toBe(false);
    });
});
