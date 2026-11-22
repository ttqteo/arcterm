// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

// How big a release is, read from the top `## Unreleased` section of CHANGELOG.md (release-build.mjs, BUMP=auto):
//
//   minor  MIN_RELEASE_LINES lines or more of any kind, or as many big lines (`<!-- big -->`) as What's new has
//          cards (MAX_BIG_LINES): one more would break its cap, so those lines ship first
//   none   fewer lines: they wait in Unreleased for the next minor, a big line among them too (the person's ask,
//          2026-11-22: versions went 1.7.0 to 1.14.0 in four days when one big line or 20 lines made a minor); also
//          with no lines at all
//
// patch is never picked: a build for the person makes no patch release, fix-only lines ship under the next minor.
//
// major is never picked: whether a release breaks something for the person (a feature removed, a config format
// changed without migrating it, a `wsh` command or hook contract that old agents rely on) is a judgement, so it is
// passed by hand, BUMP=major.

const RANK = { none: 0, patch: 1, minor: 2, major: 3 };

// The fewest Unreleased lines that make a release of their own.
export const MIN_RELEASE_LINES = 60;

// What's new draws at most this many big lines of a release as cards (MAX_HIGHLIGHTS in
// frontend/app/cockpit/whatsnew.ts): Unreleased holding as many makes a release, so the next big line starts another.
export const MAX_BIG_LINES = 5;

// The body of the top `## ` section when it is Unreleased, without its heading; null when the top section is dated
// (a release already took its lines) or the file has no sections.
export function unreleasedSection(changelog) {
    const lines = changelog.replace(/\r\n/g, "\n").split("\n");
    const start = lines.findIndex((l) => l.startsWith("## "));
    if (start < 0 || lines[start].trim() !== "## Unreleased") {
        return null;
    }
    const rest = lines.slice(start + 1);
    const end = rest.findIndex((l) => l.startsWith("## "));
    return (end < 0 ? rest : rest.slice(0, end)).join("\n");
}

// The bump the Unreleased lines call for, with the counts behind it and their total.
export function suggestBump(changelog) {
    const section = unreleasedSection(changelog);
    const counts = { added: 0, changed: 0, fixed: 0, other: 0, big: 0 };
    if (section != null) {
        let heading = "other";
        for (const line of section.split("\n")) {
            const h = /^###\s+(\w+)/.exec(line);
            if (h) {
                const name = h[1].toLowerCase();
                heading = name in counts && name !== "big" ? name : "other";
                continue;
            }
            if (/^[-*]\s/.test(line)) {
                counts[heading]++;
            }
            if (line.includes("<!-- big -->")) {
                counts.big++;
            }
        }
    }
    const lines = counts.added + counts.changed + counts.fixed + counts.other;
    const bump = lines >= MIN_RELEASE_LINES || counts.big >= MAX_BIG_LINES ? "minor" : "none";
    return { bump, counts, lines };
}

// Why a bump passed by hand is too small for the Unreleased lines, or null when it is big enough. A bigger bump than
// suggested is the person's call (major always is) and passes.
export function bumpTooSmall(requested, suggested) {
    if (requested === "none" || RANK[requested] >= RANK[suggested]) {
        return null;
    }
    return `BUMP=${requested}, but CHANGELOG.md's Unreleased lines call for ${suggested}`;
}

export function describeCounts(counts) {
    const parts = [];
    for (const [key, label] of [
        ["added", "Added"],
        ["changed", "Changed"],
        ["fixed", "Fixed"],
        ["other", "other"],
    ]) {
        if (counts[key] > 0) parts.push(`${counts[key]} ${label}`);
    }
    if (counts.big > 0) parts.push(`${counts.big} big`);
    return parts.length > 0 ? parts.join(", ") : "no lines";
}
