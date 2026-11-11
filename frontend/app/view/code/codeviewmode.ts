// frontend/app/view/code/codeviewmode.ts
// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

// Pure: whether the open text file is up in the source editor. Blame and review comments only exist beside that
// editor, so whatever turns them on asks this first. The mode is the atom's chosen one; it is resolved the way the
// viewer resolves it (codeclassify.ts resolveViewMode), so a Go file on "preview" is on Source and a README on
// "preview" is on its rendered document.

import { resolveViewMode, type ViewMode } from "./codeclassify";

export function showsSourceEditor(
    mode: ViewMode,
    path: string,
    opts: { hasPdf?: boolean; previewable?: boolean } = {}
): boolean {
    return resolveViewMode(path, mode, opts.hasPdf ?? false, opts.previewable ?? true) === "source";
}
