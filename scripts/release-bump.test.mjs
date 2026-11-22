import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { MAX_BIG_LINES, MIN_RELEASE_LINES, bumpTooSmall, describeCounts, suggestBump, unreleasedSection } from "./release-bump.mjs";

const HEADER = "# Changelog\n\nAdd one line under `### Added` in the top section.\n\n";

describe("unreleasedSection", () => {
    it("returns the top section's body when it is Unreleased", () => {
        const md = `${HEADER}## Unreleased\n\n### Fixed\n\n- a fix\n\n## 1.1.3 — 2026-11-14\n\n### Added\n\n- old\n`;
        expect(unreleasedSection(md)).toBe("\n### Fixed\n\n- a fix\n");
    });

    it("is null when the top section is already dated", () => {
        expect(unreleasedSection(`${HEADER}## 1.1.3 — 2026-11-14\n\n### Added\n\n- x\n`)).toBeNull();
    });

    it("reads CRLF files", () => {
        expect(unreleasedSection("## Unreleased\r\n\r\n- a\r\n")).toBe("\n- a\n");
    });
});

describe("suggestBump", () => {
    const items = (n, prefix) => Array.from({ length: n }, (_, i) => `- ${prefix} ${i}`).join("\n");

    it("waits when a few lines add something but none is big", () => {
        const md = `${HEADER}## Unreleased\n\n### Added\n\n- new thing\n\n### Fixed\n\n- a fix\n\n## 1.1.3 — 2026-11-14\n`;
        expect(suggestBump(md)).toEqual({
            bump: "none",
            counts: { added: 1, changed: 0, fixed: 1, other: 0, big: 0 },
            lines: 2,
        });
    });

    it("is minor once the lines reach the threshold, whatever their sections", () => {
        const md = `## Unreleased\n\n### Changed\n\n${items(5, "c")}\n\n### Fixed\n\n${items(MIN_RELEASE_LINES - 5, "f")}\n`;
        expect(suggestBump(md)).toMatchObject({ bump: "minor", lines: MIN_RELEASE_LINES });
        const short = `## Unreleased\n\n### Added\n\n${items(MIN_RELEASE_LINES - 1, "a")}\n`;
        expect(suggestBump(short)).toMatchObject({ bump: "none", lines: MIN_RELEASE_LINES - 1 });
    });

    it("waits on a big line below the threshold: it ships with the next minor", () => {
        expect(suggestBump(`## Unreleased\n\n### Changed\n\n- reworked <!-- big -->\n`).bump).toBe("none");
        const four = `## Unreleased\n\n### Added\n\n${items(MAX_BIG_LINES - 1, "big <!-- big -->")}\n`;
        expect(suggestBump(four).bump).toBe("none");
    });

    it("is minor once the big lines fill What's new's cards, below the threshold and even outside Added", () => {
        const full = `## Unreleased\n\n### Changed\n\n${items(MAX_BIG_LINES, "reworked <!-- big -->")}\n`;
        expect(suggestBump(full)).toMatchObject({ bump: "minor", lines: MAX_BIG_LINES });
    });

    it("needs many more lines than a day of work makes", () => {
        expect(MIN_RELEASE_LINES).toBe(60);
    });

    it("never picks patch, counting wrapped lines once", () => {
        const md = `## Unreleased\n\n### Changed\n\n- one\n  wrapped onto two\n\n### Fixed\n\n- two\n- three\n\n## 1.0.0 — 2026-11-04\n\n### Added\n\n- old\n`;
        expect(suggestBump(md)).toEqual({
            bump: "none",
            counts: { added: 0, changed: 1, fixed: 2, other: 0, big: 0 },
            lines: 3,
        });
    });

    it("ignores the lines and big marks of an older release", () => {
        const md = `## Unreleased\n\n### Fixed\n\n- f\n\n## 1.1.3 — 2026-11-14\n\n### Added\n\n- old <!-- big -->\n${items(30, "o")}\n`;
        expect(suggestBump(md)).toMatchObject({ bump: "none", lines: 1 });
    });

    it("is none with nothing unreleased", () => {
        expect(suggestBump(`${HEADER}## Unreleased\n\n## 1.1.3 — 2026-11-14\n\n- x\n`).bump).toBe("none");
        expect(suggestBump(`${HEADER}## 1.1.3 — 2026-11-14\n\n### Added\n\n- x\n`).bump).toBe("none");
    });

    it("reads the repo's own CHANGELOG.md", () => {
        const md = readFileSync(fileURLToPath(new URL("../CHANGELOG.md", import.meta.url)), "utf8");
        expect(["none", "minor"]).toContain(suggestBump(md).bump);
    });
});

describe("bumpTooSmall", () => {
    it("refuses a patch for a release that adds something", () => {
        expect(bumpTooSmall("patch", "minor")).toMatch(/call for minor/);
    });

    it("lets an equal or bigger bump through", () => {
        expect(bumpTooSmall("minor", "minor")).toBeNull();
        expect(bumpTooSmall("minor", "patch")).toBeNull();
        expect(bumpTooSmall("major", "minor")).toBeNull();
        expect(bumpTooSmall("patch", "none")).toBeNull();
    });

    it("never stops a build with no bump", () => {
        expect(bumpTooSmall("none", "minor")).toBeNull();
    });
});

describe("describeCounts", () => {
    it("lists the non-zero counts", () => {
        expect(describeCounts({ added: 2, changed: 0, fixed: 1, other: 0, big: 1 })).toBe("2 Added, 1 Fixed, 1 big");
        expect(describeCounts({ added: 0, changed: 0, fixed: 0, other: 0, big: 0 })).toBe("no lines");
    });
});
