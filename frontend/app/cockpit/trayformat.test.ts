import { describe, expect, it } from "vitest";
import { autoCleanLine, cpuLoad, fmtDisk, fmtSize, levelWord, pageState, split, swapUsed } from "./trayformat";

const MIB = 1024 * 1024;
const GIB = 1024 * MIB;
const MB = 1000 * 1000;
const GB = 1000 * MB;

describe("fmtSize", () => {
    it("reads in binary units, one decimal under 100 GB, none when it is .0", () => {
        expect(fmtSize(12 * MIB)).toBe("12 MB");
        expect(fmtSize(0.05 * GIB)).toBe("51 MB");
        expect(fmtSize(0.3 * GIB)).toBe("0.3 GB");
        expect(fmtSize(0.8 * GIB)).toBe("0.8 GB");
        expect(fmtSize(1.2 * GIB)).toBe("1.2 GB");
        expect(fmtSize(16 * GIB)).toBe("16 GB");
        expect(fmtSize(127.4 * GIB)).toBe("127 GB");
    });
});

describe("fmtDisk", () => {
    it("reads in decimal units, as Finder and System Settings count a disk", () => {
        expect(fmtDisk(245.11 * GB)).toBe("245 GB");
        expect(fmtDisk(45.14 * GB)).toBe("45.1 GB");
        expect(fmtDisk(0.3 * GB)).toBe("0.3 GB");
        expect(fmtDisk(51 * MB)).toBe("51 MB");
    });
});

describe("the memory card's words", () => {
    it("names each level, and none with no reading", () => {
        expect(levelWord("normal")).toBe("Normal");
        expect(levelWord("high")).toBe("High");
        expect(levelWord("critical")).toBe("Critical");
        expect(levelWord("unknown")).toBeNull();
    });
});

describe("swapUsed", () => {
    it("reads the swap in use, and none with no swap file", () => {
        expect(swapUsed(6.3 * GIB, 7 * GIB)).toBe("6.3 GB");
        expect(swapUsed(0, 2 * GIB)).toBe("0 MB");
        expect(swapUsed(0, 0)).toBe("none");
    });
});

describe("cpuLoad", () => {
    it("reads the last second's load whole, and a dash before the first reading", () => {
        expect(cpuLoad(37.6)).toBe("38%");
        expect(cpuLoad(0)).toBe("0%");
        expect(cpuLoad(null)).toBe("—");
    });
});

describe("bars", () => {
    it("split keeps arcterm's share inside the used part", () => {
        expect(split(245, 118, 16.4)).toEqual({ arc: 7, other: 41 });
        expect(split(100, 50, 80)).toEqual({ arc: 50, other: 0 });
        expect(split(0, 0, 5)).toEqual({ arc: 0, other: 0 });
    });
});

describe("pageState", () => {
    it("offline wins, then loading until the first snapshot", () => {
        expect(pageState(null, true)).toBe("offline");
        expect(pageState({}, true)).toBe("offline");
        expect(pageState(null, false)).toBe("loading");
        expect(pageState({}, false)).toBe("ready");
    });
});

describe("autoCleanLine", () => {
    const at = new Date(2026, 9, 15, 9, 12).getTime();
    const noon = new Date(2026, 9, 15, 12, 0).getTime();
    it("says today for today's clean and nothing for none", () => {
        expect(autoCleanLine({ bytes: 1.1 * GB, ts: at, error: "" }, noon)).toBe(
            "auto-clean took 1.1 GB today at 09:12"
        );
        expect(autoCleanLine(null, noon)).toBeNull();
    });
    it("names the date of an earlier clean and carries its error", () => {
        const next = new Date(2026, 9, 16, 8, 0).getTime();
        const line = autoCleanLine({ bytes: 12 * MB, ts: at, error: "trash busy" }, next);
        expect(line).toMatch(/^auto-clean took 12 MB .+ at 09:12 · trash busy$/);
        expect(line).not.toContain("today");
    });
});
