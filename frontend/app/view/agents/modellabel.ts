// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

// Best-effort friendly label for a raw model id (e.g. "claude-opus-4-8" -> "Opus 4.8").
// Version is read from the digits after the family word: the first number is the major, and
// a following 1-2 digit number is the minor (an 8-digit date snapshot is ignored). Unknown
// models fall through to the raw id, so the label is always at least as informative as before.

export function versionAfter(m: string, family: string): string {
    const rest = m.slice(m.indexOf(family) + family.length);
    const nums = rest.match(/\d+/g);
    if (!nums || nums.length === 0) {
        return "";
    }
    const major = nums[0];
    const minor = nums[1];
    if (minor != null && minor.length <= 2) {
        return ` ${major}.${minor}`;
    }
    return ` ${major}`;
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
