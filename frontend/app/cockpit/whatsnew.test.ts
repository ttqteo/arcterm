// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { buildGlobalBindings } from "@/app/store/keybindings/bindings";
import type { SurfaceKey } from "@/app/view/agents/agents";
import { atom } from "jotai";
import { describe, expect, it } from "vitest";
import changelog from "../../../CHANGELOG.md?raw";
import { postCloseContext } from "./palette-commands";
import {
    compareVersions,
    entryBody,
    entryLead,
    foldLabel,
    formatReleaseDate,
    inlineSpans,
    MAX_HIGHLIGHTS,
    parseChangelog,
    releasesToShow,
    splitHighlights,
    tryIds,
} from "./whatsnew";

const MD = `# Changelog

Intro text with a - dash.

## Unreleased

### Added

- **Not built yet**: hidden.

## 0.2.0 — 2026-10-13

### Added

- **A tool library**: lists tools
  and installs one. <!-- big --> <!-- try: open-tool -->

- A plain entry with no bold lead.

### Changed

- **First change**.

### Fixed

- <!-- try: go:usage --> **A fix**: and how. <!-- big -->

### Changed

- **Second change**, in a repeated Changed list.

## 0.1.0 — 2026-10-01

### Fixed

- **Old fix**.

## 0.0.1 — 2026-09-01

- A bare note with no kind heading.
`;

describe("parseChangelog", () => {
    const releases = parseChangelog(MD);

    it("keeps the dated releases, newest first, and leaves Unreleased out", () => {
        expect(releases.map((r) => [r.version, r.date])).toEqual([
            ["0.2.0", "2026-10-13"],
            ["0.1.0", "2026-10-01"],
            ["0.0.1", "2026-09-01"],
        ]);
    });

    it("reads a release's bare list, with no kind heading, as changes", () => {
        expect(releases[2].sections).toEqual([
            { kind: "Changed", entries: [{ text: "A bare note with no kind heading." }] },
        ]);
    });

    it("joins an entry's continuation lines and lifts its try id and big mark out of the text", () => {
        expect(releases[0].sections[0].entries[0]).toEqual({
            text: "**A tool library**: lists tools and installs one.",
            tryId: "open-tool",
            big: true,
        });
        expect(releases[0].sections[2].entries[0]).toEqual({
            text: "**A fix**: and how.",
            tryId: "go:usage",
            big: true,
        });
        expect(releases[0].sections[0].entries[1]).toEqual({ text: "A plain entry with no bold lead." });
    });

    it("merges a repeated section kind and orders Added, Changed, Fixed", () => {
        const r = releases[0];
        expect(r.sections.map((s) => s.kind)).toEqual(["Added", "Changed", "Fixed"]);
        expect(r.sections[1].entries.map((e) => e.text)).toEqual([
            "**First change**.",
            "**Second change**, in a repeated Changed list.",
        ]);
    });

    it("reads the real CHANGELOG.md", () => {
        const real = parseChangelog(changelog);
        expect(real.length).toBeGreaterThan(5);
        for (const r of real) {
            expect(r.sections.length).toBeGreaterThan(0);
        }
    });

    // the cards are the few lines worth opening the app for; past five they are a wall again
    it.each(parseChangelog(changelog).map((r) => [r.version, r] as const))(
        "%s marks at most MAX_HIGHLIGHTS lines big",
        (_v, r) => {
            expect(splitHighlights(r).highlights.length).toBeLessThanOrEqual(MAX_HIGHLIGHTS);
        }
    );
});

describe("splitHighlights", () => {
    const releases = parseChangelog(MD);

    it("lifts the big entries out, in Added, Changed, Fixed order, and drops a section left empty", () => {
        const { highlights, rest } = splitHighlights(releases[0]);
        expect(highlights.map((e) => e.text)).toEqual([
            "**A tool library**: lists tools and installs one.",
            "**A fix**: and how.",
        ]);
        expect(rest.map((s) => [s.kind, s.entries.length])).toEqual([
            ["Added", 1],
            ["Changed", 2],
        ]);
    });

    it("leaves a release with no big entries whole", () => {
        const { highlights, rest } = splitHighlights(releases[1]);
        expect(highlights).toEqual([]);
        expect(rest).toEqual(releases[1].sections);
    });
});

describe("foldLabel", () => {
    const sec = (kind: "Added" | "Changed" | "Fixed", n: number) => ({ kind, entries: Array(n).fill({ text: "x" }) });

    it("counts changes and fixes, saying more when cards sit above", () => {
        expect(foldLabel([sec("Added", 40), sec("Changed", 18), sec("Fixed", 12)], true)).toBe(
            "58 more changes · 12 fixes"
        );
        expect(foldLabel([sec("Added", 1), sec("Fixed", 1)], false)).toBe("1 change · 1 fix");
        expect(foldLabel([sec("Fixed", 3)], true)).toBe("3 more fixes");
        expect(foldLabel([], true)).toBe("");
    });
});

describe("entryBody", () => {
    it("is the note after its bold lead, its joining punctuation dropped", () => {
        expect(entryBody("**Open a tool**: in the focused agent's folder.")).toBe("in the focused agent's folder.");
        expect(entryBody("**Resource Manager** (from a fork): the footer")).toBe("(from a fork): the footer");
    });

    it("is the whole note with no lead, and empty when the lead is all of it", () => {
        expect(entryBody("A plain entry.")).toBe("A plain entry.");
        expect(entryBody("**A fix**.")).toBe("");
    });
});

describe("versions", () => {
    it("orders numerically, not as text", () => {
        expect(compareVersions("0.15.10", "0.15.9")).toBeGreaterThan(0);
        expect(compareVersions("v0.15.9", "0.15.9")).toBe(0);
        expect(compareVersions("0.16.0", "0.15.11")).toBeGreaterThan(0);
    });
});

describe("releasesToShow", () => {
    const rel = (version: string) => ({ version, date: "2026-10-01", sections: [] });
    const all = ["0.5.0", "0.4.0", "0.3.0", "0.2.0", "0.1.0"].map(rel);

    it("lists the latest few, and nothing newer than the running build", () => {
        expect(releasesToShow(all, "0.4.0", 2).map((r) => r.version)).toEqual(["0.4.0", "0.3.0"]);
        expect(releasesToShow(all, "0.5.0", 3).map((r) => r.version)).toEqual(["0.5.0", "0.4.0", "0.3.0"]);
    });

    it("lists from the newest when the running version is unknown", () => {
        expect(releasesToShow(all, "unknown", 2).map((r) => r.version)).toEqual(["0.5.0", "0.4.0"]);
    });
});

describe("inlineSpans", () => {
    it("splits bold and code out of the text", () => {
        expect(inlineSpans("**Open a tool** (`Ctrl+Shift+T`) here")).toEqual([
            { kind: "bold", text: "Open a tool" },
            { kind: "text", text: " (" },
            { kind: "code", text: "Ctrl+Shift+T" },
            { kind: "text", text: ") here" },
        ]);
        expect(inlineSpans("an *n/m reviewed* bar")).toEqual([
            { kind: "text", text: "an " },
            { kind: "em", text: "n/m reviewed" },
            { kind: "text", text: " bar" },
        ]);
        // a lone star is not emphasis
        expect(inlineSpans("5 * 3 and `a*b`")).toEqual([
            { kind: "text", text: "5 * 3 and " },
            { kind: "code", text: "a*b" },
        ]);
        expect(inlineSpans("plain")).toEqual([{ kind: "text", text: "plain" }]);
    });
});

describe("entryLead", () => {
    it("is the bold lead of an entry that says more", () => {
        expect(entryLead("**Open a tool**: in the focused agent's folder.")).toBe("Open a tool");
        expect(entryLead("**Agent rows are calmer.** Background commands no longer mark a row.")).toBe(
            "Agent rows are calmer."
        );
    });

    it("is null with no lead, or nothing past it", () => {
        expect(entryLead("A plain entry with no bold lead.")).toBeNull();
        expect(entryLead("**A fix**.")).toBeNull();
        expect(entryLead("Ends with **bold**: not a lead.")).toBeNull();
    });
});

describe("formatReleaseDate", () => {
    it("reads the date as a calendar day", () => {
        expect(formatReleaseDate("2026-10-13")).toBe("Oct 13");
        expect(formatReleaseDate("soon")).toBe("soon");
    });
});

// A try id names a global binding (always registered, whatever surface is up) that can run from any surface the
// sheet opens over. Renaming a binding breaks its button; this says which line to fix.
describe("CHANGELOG.md try ids", () => {
    const bindings = buildGlobalBindings({ surfaceAtom: atom<SurfaceKey>("cockpit") } as any);
    const ids = [...new Set(tryIds(parseChangelog(changelog)))];

    it.each(ids.length > 0 ? ids : ["(none)"])("%s is a global binding that runs from the Cockpit", (id) => {
        if (id === "(none)") {
            return;
        }
        const b = bindings.find((x) => x.id === id);
        expect(b, `no global binding "${id}"`).toBeDefined();
        expect(b!.when == null || b!.when(postCloseContext("cockpit"))).toBe(true);
    });
});
