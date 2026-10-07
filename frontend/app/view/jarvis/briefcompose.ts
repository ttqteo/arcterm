// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0
//
// The words on the Brief's composer, which exists only on a session sheet with a live lead
// (briefcomposertarget.ts). The user must never be unsure a keystroke reaches a running worker.

import { formatChordString } from "@/util/keysym";

export interface ComposerLabels {
    scope: string;
    hint: string;
    action: string;
    // the second thing Enter could do here, absent when there is no second thing
    alt?: string;
}

export function resolveComposerLabels(project?: string): ComposerLabels {
    const p = project?.trim();
    return {
        scope: "scoped to this session",
        hint: "Message the lead of this session",
        action: "Send ⏎",
        // a standing rule outlives the session, so it needs a project to stand for: no project, no offer.
        ...(p ? { alt: `${formatChordString("Shift:Enter")} standing rule for ${p}` } : {}),
    };
}
