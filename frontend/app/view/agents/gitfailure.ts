// frontend/app/view/agents/gitfailure.ts
// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

// git often prints warnings (CRLF conversion, hints) ahead of the line that says why it stopped, and a one-line notice
// that shows the first line shows the warning instead of the failure.
const ERROR_PREFIXES = ["fatal:", "error:"];
const NOISE_PREFIXES = ["warning:", "hint:"];

// The one line of stderr that best says why git failed: its error line, else the first line that is not a warning or a
// hint, else the first line, so a warnings-only stderr still shows something.
export function failureHeadline(stderr: string): string {
    const lines = stderr
        .split(/\r?\n/)
        .map((line) => line.trim())
        .filter((line) => line !== "");
    return (
        lines.find((line) => ERROR_PREFIXES.some((p) => line.startsWith(p))) ??
        lines.find((line) => !NOISE_PREFIXES.some((p) => line.startsWith(p))) ??
        lines[0] ??
        ""
    );
}
