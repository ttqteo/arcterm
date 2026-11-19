import { describe, expect, it } from "vitest";
import { nextMinors, splitUnreleased } from "./changelog-split.mjs";

const HEADER = "# Changelog\n\nAdd one line in the top section.\n\n";

// n items, item i landed at hour i; every third an Added, the rest Fixed
function changelog(n) {
    const added = [];
    const fixed = [];
    for (let i = 0; i < n; i++) {
        (i % 3 === 0 ? added : fixed).push(`- item ${i}`, `  more of ${i}`);
    }
    return `${HEADER}## Unreleased\n\n### Added\n\n${added.join("\n")}\n\n### Fixed\n\n${fixed.join("\n")}\n\n## 1.3.0 — 2026-11-17\n\n### Added\n\n- old\n`;
}
const at = (line) => {
    const m = /^- item (\d+)$/.exec(line);
    return m ? Date.UTC(2026, 10, 18, 0) + Number(m[1]) * 3_600_000 : undefined;
};

describe("nextMinors", () => {
    it("numbers on from the version", () => {
        expect(nextMinors("1.3.0", 2)).toEqual(["1.4.0", "1.5.0"]);
        expect(nextMinors("1.3.4", 1)).toEqual(["1.4.0"]);
    });
});

describe("splitUnreleased", () => {
    it("leaves a short section alone", () => {
        expect(splitUnreleased(changelog(40), at, "1.3.0", 40)).toBeNull();
    });

    it("cuts the lines oldest first into even releases, the newest left Unreleased", () => {
        const split = splitUnreleased(changelog(90), at, "1.3.0", 40);
        expect(split.version).toBe("1.5.0");
        expect(split.report.map((r) => [r.version, r.lines])).toEqual([
            ["1.4.0", 30],
            ["1.5.0", 30],
            ["Unreleased", 30],
        ]);
        const heads = split.text.split("\n").filter((l) => l.startsWith("## "));
        expect(heads[0]).toBe("## Unreleased");
        expect(heads[1]).toMatch(/^## 1\.5\.0 — 2026-11-\d\d$/);
        expect(heads[2]).toMatch(/^## 1\.4\.0 — 2026-11-\d\d$/);
        expect(heads[3]).toBe("## 1.3.0 — 2026-11-17");
        // the newest items stay Unreleased, each with the lines under it
        const unreleased = split.text.slice(split.text.indexOf("## Unreleased"), split.text.indexOf("## 1.5.0"));
        expect(unreleased).toContain("- item 89\n  more of 89");
        expect(unreleased).not.toContain("- item 0\n");
    });

    it("keeps every line, and counts an uncommitted one as newest", () => {
        const md = changelog(90).replace("- item 0\n", "- item 0\n- not committed yet\n");
        const split = splitUnreleased(md, at, "1.3.0", 40);
        const items = (text) => text.split("\n").filter((l) => l.startsWith("- ") || l.startsWith("  ")).sort();
        expect(items(split.text)).toEqual(items(md));
        const unreleased = split.text.slice(0, split.text.indexOf("## 1.5.0"));
        expect(unreleased).toContain("- not committed yet");
    });
});
