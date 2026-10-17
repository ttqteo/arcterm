import { describe, expect, it } from "vitest";
import { nearListEnd } from "./listend";

describe("nearListEnd", () => {
    it("is true for a list with no scrollbar", () => {
        expect(nearListEnd({ scrollHeight: 300, scrollTop: 0, clientHeight: 300 })).toBe(true);
    });
    it("is false at the top of a long list", () => {
        expect(nearListEnd({ scrollHeight: 2000, scrollTop: 0, clientHeight: 400 })).toBe(false);
    });
    it("is true with 100 px left", () => {
        expect(nearListEnd({ scrollHeight: 2000, scrollTop: 1500, clientHeight: 400 })).toBe(true);
    });
    it("is false with 200 px left", () => {
        expect(nearListEnd({ scrollHeight: 2000, scrollTop: 1400, clientHeight: 400 })).toBe(false);
    });
});
