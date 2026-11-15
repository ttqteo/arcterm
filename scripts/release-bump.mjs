// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

// How big a release is, read from the top `## Unreleased` section of CHANGELOG.md (release-build.mjs, BUMP=auto):
//
//   minor  a line under `### Added`, or a line marked `<!-- big -->`: something new to try
//   patch  only `### Changed` / `### Fixed` lines
//   none   no Unreleased section, or one with no lines: nothing a user would notice
//
// major is never picked: whether a release breaks something for the person (a feature removed, a config format
// changed without migrating it, a `wsh` command or hook contract that old agents rely on) is a judgement, so it is
// passed by hand, BUMP=major.

const RANK = { none: 0, patch: 1, minor: 2, major: 3 };

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

// The bump the Unreleased lines call for, with the counts behind it.
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
    const bump = counts.added > 0 || counts.big > 0 ? "minor" : lines > 0 ? "patch" : "none";
    return { bump, counts };
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
