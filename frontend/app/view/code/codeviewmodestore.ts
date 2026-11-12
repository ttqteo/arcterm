// frontend/app/view/code/codeviewmodestore.ts
// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

// The atom-reading side of codeviewmode.ts: whether the file open right now is up in the source editor. The path bar and
// the viewer resolve the chosen mode from the same four atoms (file, drafts, built PDF, mode), so this reads them the
// same way, for what runs outside a component (a key, a store action).

import { globalStore } from "@/app/store/jotaiStore";
import { isPreviewable } from "./codepreviewable";
import {
    codeDraftsAtom,
    codeFileAtom,
    codeProjectAtom,
    codeTexPdfAtom,
    codeViewModeAtom,
    draftKey,
    texPdfFor,
} from "./codestore";
import { showsSourceEditor } from "./codeviewmode";

// false with no text file open: an image, a binary or an empty surface has no source editor either
export function sourceEditorShowing(): boolean {
    const project = globalStore.get(codeProjectAtom);
    const file = globalStore.get(codeFileAtom);
    if (project == null || file.kind !== "text") {
        return false;
    }
    const abs = draftKey(project, file.path);
    return showsSourceEditor(globalStore.get(codeViewModeAtom), file.path, {
        hasPdf: texPdfFor(globalStore.get(codeTexPdfAtom), abs) != null,
        previewable: isPreviewable(file.path, globalStore.get(codeDraftsAtom).get(abs)?.text ?? file.text),
    });
}
