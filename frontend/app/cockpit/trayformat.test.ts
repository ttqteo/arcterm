import { describe, expect, it } from "vitest";
import {
    autoCleanLine,
    fmtDisk,
    fmtSize,
    levelWord,
    memoryCaption,
    pageState,
    sparkPoints,
    split,
    usedPct,
} from "./trayformat";

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
    it("says what the queue does at that level", () => {
        expect(memoryCaption("normal", false)).toBe("Jobs start as RAM allows");
        expect(memoryCaption("unknown", false)).toBe("Jobs start as RAM allows");
        expect(memoryCaption("high", false)).toBe("Jobs run one at a time");
        expect(memoryCaption("critical", false)).toBe("No heavy job starts");
        expect(memoryCaption("critical", true)).toBe("Queue paused");
    });
});

describe("bars", () => {
    it("usedPct is whole and clamped", () => {
        expect(usedPct(16 * GIB, 1.2 * GIB)).toBe(93);
        expect(usedPct(0, 0)).toBe(0);
        expect(usedPct(10, 20)).toBe(0);
    });
    it("split keeps arcterm's share inside the used part", () => {
        expect(split(245, 118, 16.4)).toEqual({ arc: 7, other: 41 });
        expect(split(100, 50, 80)).toEqual({ arc: 50, other: 0 });
        expect(split(0, 0, 5)).toEqual({ arc: 0, other: 0 });
    });
});

describe("sparkPoints", () => {
    it("draws oldest left, 100% at the top", () => {
        expect(sparkPoints([0, 100], 140, 34)).toBe("0,34 140,0");
    });
    it("draws one sample as a flat line and none as nothing", () => {
        expect(sparkPoints([50], 140, 34)).toBe("0,17 140,17");
        expect(sparkPoints([], 140, 34)).toBe("");
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
