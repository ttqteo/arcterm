// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

// Best-effort friendly label for a raw model id (e.g. "claude-opus-4-8" -> "Opus 4.8").
// Version is read from the digits after the family word: the first number is the major, and
// a following 1-2 digit number is the minor (an 8-digit date snapshot is ignored). The older
// scheme puts the version before the family ("claude-3-7-sonnet-20250219" -> "Sonnet 3.7"),
// read when no version follows it. Unknown models fall through to the raw id, so the label is
// always at least as informative as before.

const DATE_SNAPSHOT_DIGITS = 8;

function formatVersion(major: string, minor: string | undefined): string {
    if (minor != null && minor.length <= 2) {
        return ` ${major}.${minor}`;
    }
    return ` ${major}`;
}

export function versionAfter(m: string, family: string): string {
    const at = m.indexOf(family);
    const found: string[] = m.slice(at + family.length).match(/\d+/g) ?? [];
    const nums = found.filter((n) => n.length !== DATE_SNAPSHOT_DIGITS);
    if (nums.length > 0) {
        return formatVersion(nums[0], nums[1]);
    }
    // "-3-7-" or "-3-" right before the family; a digit glued to a word ("v2-") is not a version.
    const before = at > 0 ? m.slice(0, at).match(/(?:^|-)(\d+)(?:-(\d+))?-$/) : null;
    return before ? formatVersion(before[1], before[2]) : "";
}

export function prettyModel(id: string): string {
    if (!id) {
        return "—";
    }
    const m = id.toLowerCase();
    if (m.includes("opus")) return `Opus${versionAfter(m, "opus")}`;
    if (m.includes("sonnet")) return `Sonnet${versionAfter(m, "sonnet")}`;
    if (m.includes("haiku")) return `Haiku${versionAfter(m, "haiku")}`;
    if (m.includes("fable")) return `Fable${versionAfter(m, "fable")}`;
    if (m.includes("gpt-5.5")) return "GPT-5.5";
    if (m.includes("codex")) return "Codex";
    if (m.includes("gpt-5")) return "GPT-5";
    return id;
}
