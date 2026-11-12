// frontend/app/view/code/codependingjump.ts
// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

// Pure: what a pending jump does against the file showing. The jump carries its path because it is set
// before the read, and the file showing stays up until the new one is ready (openPath), so a bare line
// would land on whatever file happened to be showing when the viewer looked.

import { slugHeadings } from "./codelink";
import type { CodeFile } from "./codestore";

export type PendingJump = { path: string; line: number } | { path: string; anchor: string };

export type JumpResolution = { kind: "wait" } | { kind: "line"; line: number } | { kind: "drop" };

export function resolvePendingJump(
    p: PendingJump,
    file: CodeFile,
    headings: readonly { name: string; line: number }[]
): JumpResolution {
    if (file.kind === "none" || file.kind === "loading" || file.path !== p.path) {
        return { kind: "wait" };
    }
    // binary, too large, a PDF or image, missing or unreadable: there is no line to land on, and keeping it
    // would fire later on another file
    if (file.kind !== "text") {
        return { kind: "drop" };
    }
    if ("line" in p) {
        return { kind: "line", line: p.line };
    }
    const at = slugHeadings(headings.map((h) => h.name)).indexOf(p.anchor.toLowerCase());
    return at === -1 ? { kind: "drop" } : { kind: "line", line: headings[at].line };
}
