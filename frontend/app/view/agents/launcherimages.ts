// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0
//
// Images pasted or dropped into the New launcher's Task box: which files count, how many fit, and how their temp
// paths ride the launch (docs/superpowers/specs/2026-10-09-launcher-resume-and-images-design.md). Pure; the temp
// writes are launcherstore.ts's.

import type { Runtime } from "./launch";

export const MAX_TASK_IMAGES = 8;

export interface TaskImage {
    id: string;
    previewUrl: string;
    // set once the temp file is written
    path?: string;
    // set when the write failed; the image stays on show until removed
    error?: string;
}

export function imageFilesOf(files: ArrayLike<File> | null | undefined): File[] {
    return Array.from(files ?? []).filter((f) => f.type.startsWith("image/"));
}

export function imageRoom(existing: number, incoming: number): number {
    return Math.max(0, Math.min(incoming, MAX_TASK_IMAGES - existing));
}

export function imagesPending(images: TaskImage[]): boolean {
    return images.some((i) => i.path == null && i.error == null);
}

export interface TaskWithImages {
    task: string;
    // argv after the prompt
    extraArgs: string[];
}

export function composeTaskWithImages(
    runtime: Runtime,
    task: string,
    paths: string[],
    resuming: boolean
): TaskWithImages {
    const trimmed = task.trim();
    if (paths.length === 0) {
        return { task: trimmed, extraArgs: [] };
    }
    // codex's --image takes a comma list and is variadic, so it goes after the prompt it would otherwise swallow;
    // `codex resume` is not known to take it
    if (runtime === "codex" && !resuming && paths.every((p) => !p.includes(","))) {
        return { task: trimmed, extraArgs: ["--image", paths.join(",")] };
    }
    const block = ["Attached images:", ...paths.map((p) => `- ${p}`)].join("\n");
    return { task: trimmed ? `${trimmed}\n\n${block}` : block, extraArgs: [] };
}
