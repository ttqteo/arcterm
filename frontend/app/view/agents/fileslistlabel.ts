// frontend/app/view/agents/fileslistlabel.ts
// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

// Pure: the words over a commit's file list. A list that has not loaded, or failed to, is not an empty
// one, so it never reads as `0 files` and carries no +/- totals.

import type { ChangesStatus } from "./changesstatus";
import type { GitChanges } from "./gitstatus";

export interface FilesListLabel {
    text: string;
    // true when the +adds −dels totals beside the label are real
    counts: boolean;
}

export function filesListLabel(status: ChangesStatus, changes: GitChanges | null): FilesListLabel {
    if (status === "loading") {
        return { text: "Reading this commit's files…", counts: false };
    }
    if (status === "failed") {
        return { text: "Couldn't read this commit's files", counts: false };
    }
    const count = changes?.files.length ?? 0;
    return { text: `${count} ${count === 1 ? "file" : "files"}`, counts: true };
}
