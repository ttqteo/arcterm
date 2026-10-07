// frontend/app/view/code/codeside.ts
// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

// The Code surface's side column (docs/superpowers/specs/2026-10-07-code-side-column-design.md): a read-only second
// column beside the editor, showing another file or the same file in another mode. The main column keeps every
// single-file atom in codestore.ts; the side column is this one atom, so nothing there has to know it exists.

import { globalStore } from "@/app/store/jotaiStore";
import { atom, type PrimitiveAtom } from "jotai";
import { isMarkdownPath, isTexPath, resolveViewMode, viewModesFor } from "./codeclassify";
import { codeFileAtom, codeProjectAtom } from "./codestore";

// what a Code tree row carries when dragged: its project-relative path
export const CODE_PATH_MIME = "application/x-arc-code-path";

export type SideMode = "preview" | "source" | "pdf";

// `auto` until the reader picks a mode: the default needs the PDF lookup, which lands after the column opens
export interface CodeSide {
    rel: string;
    mode: SideMode | "auto";
}

export const codeSideAtom = atom<CodeSide | null>(null) as PrimitiveAtom<CodeSide | null>;
// a side file belongs to its project: switching projects closes the column (kept here, not in selectProject, so the
// store needs no import of this module)
let sideProject = globalStore.get(codeProjectAtom)?.path ?? null;
globalStore.sub(codeProjectAtom, () => {
    const next = globalStore.get(codeProjectAtom)?.path ?? null;
    if (next !== sideProject) {
        sideProject = next;
        globalStore.set(codeSideAtom, null);
    }
});

// true from a tree row's dragstart to its dragend, so the drop overlay covers the editor area at once: a PDF iframe
// under the pointer would otherwise swallow the dragover events that would show it
export const codeTreeDragAtom = atom<boolean>(false) as PrimitiveAtom<boolean>;

export const SIDE_MIN_COLUMN = 320;
export const SIDE_HIDE_BELOW = 900;
const SIDE_RATIO_KEY = "code:side-ratio";

export function sideModesFor(path: string, hasPdf: boolean, previewable = true): SideMode[] {
    return viewModesFor(path, hasPdf, previewable).filter((m): m is SideMode => m !== "diff");
}

// a paper beside its source is what the column is for, so a .tex file opens on its PDF when one is built
export function defaultSideMode(path: string, hasPdf: boolean, previewable = true): SideMode {
    if (isTexPath(path) && hasPdf) {
        return "pdf";
    }
    return (isTexPath(path) && previewable) || isMarkdownPath(path) ? "preview" : "source";
}

export function effectiveSideMode(
    path: string,
    mode: SideMode | "auto",
    hasPdf: boolean,
    previewable = true
): SideMode {
    if (mode === "auto") {
        return defaultSideMode(path, hasPdf, previewable);
    }
    return resolveViewMode(path, mode, hasPdf, previewable) as SideMode;
}

// the main column's share of the editor area, so neither column drops under SIDE_MIN_COLUMN
export function clampSideRatio(ratio: number, width: number): number {
    if (width < SIDE_MIN_COLUMN * 2) {
        return 0.5;
    }
    const min = SIDE_MIN_COLUMN / width;
    return Math.min(Math.max(ratio, min), 1 - min);
}

export function parseSideRatio(raw: string | null): number {
    const n = raw == null ? NaN : Number(raw);
    return Number.isFinite(n) && n > 0 && n < 1 ? n : 0.5;
}

export function readSideRatio(): number {
    try {
        return parseSideRatio(localStorage.getItem(SIDE_RATIO_KEY));
    } catch {
        return 0.5;
    }
}

export function writeSideRatio(ratio: number): void {
    try {
        localStorage.setItem(SIDE_RATIO_KEY, String(ratio));
    } catch {
        // a blocked storage only loses the ratio
    }
}

export function sideFits(editorWidth: number): boolean {
    return editorWidth >= SIDE_HIDE_BELOW;
}

// opening a file to the side while one is shown replaces it: there are never more than two columns
export function openSide(rel: string, mode: SideMode | "auto" = "auto"): void {
    globalStore.set(codeSideAtom, { rel, mode });
}

export function closeSide(): void {
    globalStore.set(codeSideAtom, null);
}

export function setSideMode(mode: SideMode): void {
    globalStore.set(codeSideAtom, (s) => (s == null ? s : { ...s, mode }));
}

// Ctrl+\: closes the side column, or opens the main column's file there; false when there is nothing to open
export function toggleSide(): boolean {
    if (globalStore.get(codeSideAtom) != null) {
        closeSide();
        return true;
    }
    const file = globalStore.get(codeFileAtom);
    if (file.kind === "none" || file.kind === "loading") {
        return false;
    }
    openSide(file.path);
    return true;
}
