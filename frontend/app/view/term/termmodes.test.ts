import { describe, expect, it } from "vitest";
import { nextMouseEncoding, withMouseEncoding } from "./termmodes";

describe("nextMouseEncoding", () => {
    it("takes the encoding a TUI sets, alone or among other modes", () => {
        expect(nextMouseEncoding(null, [1006], true)).toBe(1006);
        expect(nextMouseEncoding(null, [1000, 1002, 1003, 1006], true)).toBe(1006);
    });

    it("ignores modes that are not an encoding", () => {
        expect(nextMouseEncoding(null, [1049], true)).toBeNull();
        expect(nextMouseEncoding(1006, [1003], false)).toBe(1006);
    });

    it("drops back to X10 only when the encoding in force is reset", () => {
        expect(nextMouseEncoding(1006, [1006], false)).toBeNull();
        expect(nextMouseEncoding(1006, [1015], false)).toBe(1006);
    });

    it("reads a param given with subparams", () => {
        expect(nextMouseEncoding(null, [[1006]], true)).toBe(1006);
    });
});

describe("withMouseEncoding", () => {
    it("puts the encoding back after the serialized modes", () => {
        expect(withMouseEncoding("screen\x1b[?1003h", 1006)).toBe("screen\x1b[?1003h\x1b[?1006h");
    });

    it("leaves the default encoding unwritten", () => {
        expect(withMouseEncoding("screen", null)).toBe("screen");
    });
});
