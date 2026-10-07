// frontend/app/view/code/codepreviewable.ts
// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

// Whether a file has anything for Preview to draw. Only a .tex file can come up empty (a generated macros file); the
// answer parses the whole file, and the path bar, the viewer and the side column all ask for the same text, so the
// last few answers are kept.

import { texHasProse } from "@/app/view/agents/docprose";
import { isTexPath } from "./codeclassify";

const KEEP = 4;
const answers = new Map<string, boolean>();

export function isPreviewable(path: string, text: string): boolean {
    if (!isTexPath(path)) {
        return true;
    }
    const known = answers.get(text);
    if (known != null) {
        return known;
    }
    const ok = texHasProse(text);
    answers.set(text, ok);
    if (answers.size > KEEP) {
        answers.delete(answers.keys().next().value as string);
    }
    return ok;
}
