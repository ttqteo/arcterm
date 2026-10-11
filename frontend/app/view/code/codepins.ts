// frontend/app/view/code/codepins.ts
// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

// Pure: the Code surface's pinned files, per project, in the order they were pinned. A pin is how a file you keep
// coming back to (a paper's main.tex, its built PDF) stays one click away without remembering where it lives.

import { sameRepoPath } from "@/util/paths";
import { renamedPath } from "./codemutate";

// project path → repo-relative file paths
export type CodePins = Record<string, string[]>;

// the stored key for a project: an existing one in another spelling of the same path, so a respelled path does not
// start a second list
function keyFor(pins: CodePins, project: string): string {
    return Object.keys(pins).find((k) => sameRepoPath(k, project)) ?? project;
}

function withList(pins: CodePins, project: string, list: string[]): CodePins {
    const key = keyFor(pins, project);
    const next = { ...pins };
    if (list.length === 0) {
        delete next[key];
    } else {
        next[key] = list;
    }
    return next;
}

export function pinsFor(pins: CodePins, project: string): string[] {
    return pins[keyFor(pins, project)] ?? [];
}

export function isPinned(pins: CodePins, project: string, rel: string): boolean {
    return pinsFor(pins, project).includes(rel);
}

export function togglePin(pins: CodePins, project: string, rel: string): CodePins {
    const list = pinsFor(pins, project);
    return withList(pins, project, list.includes(rel) ? list.filter((p) => p !== rel) : [...list, rel]);
}

// a rename in the tree carries its pins, a directory's included
export function renamePins(pins: CodePins, project: string, from: string, to: string): CodePins {
    const list = pinsFor(pins, project);
    if (list.length === 0) {
        return pins;
    }
    const next = list.map((p) => renamedPath(p, from, to));
    return withList(
        pins,
        project,
        next.filter((p, i) => next.indexOf(p) === i)
    );
}

// a delete in the tree drops the pins on what it removed; a file gone some other way keeps its pin until unpinned
export function unpinUnder(pins: CodePins, project: string, rel: string): CodePins {
    const list = pinsFor(pins, project);
    const next = list.filter((p) => p !== rel && !p.startsWith(`${rel}/`));
    return next.length === list.length ? pins : withList(pins, project, next);
}

export function parsePins(raw: unknown): CodePins {
    if (raw == null || typeof raw !== "object" || Array.isArray(raw)) {
        return {};
    }
    const out: CodePins = {};
    for (const [k, v] of Object.entries(raw)) {
        if (Array.isArray(v)) {
            const list = v.filter((p): p is string => typeof p === "string" && p !== "");
            if (list.length > 0) {
                out[k] = list;
            }
        }
    }
    return out;
}
