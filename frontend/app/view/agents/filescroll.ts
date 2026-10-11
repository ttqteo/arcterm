// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0
//
// Where the reader left each file the Agent panel's File tab holds, per view, so switching agents, tabs or Back and
// Forward comes back to it instead of the top. Keyed by the FileRef itself: a fresh open of the same file is a new ref
// and starts where its link points, and a ref dropped from the panel takes its places with it.

import type { FileRef, FileView } from "./agentrailtabs";

const places = new WeakMap<FileRef, Partial<Record<FileView, number>>>();

export function savedScroll(ref: FileRef, view: FileView): number | undefined {
    return places.get(ref)?.[view];
}

export function saveScroll(ref: FileRef, view: FileView, top: number): void {
    places.set(ref, { ...places.get(ref), [view]: top });
}
