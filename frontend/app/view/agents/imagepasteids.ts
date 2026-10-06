// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0
//
// Which [Image #N] each pasted image is. A paste into an agent's terminal is a temp file (termwrap.ts's pasteHandler)
// recorded in Uploads as "Pasted image"; Claude Code numbers it in the prompt ("[Image #2]") and records two user
// records under one promptId: the prompt, whose imagePasteIds lists the numbers in order, and an isMeta companion with
// one "[Image: source: <path>]" text block per image, in the same order. Zipping the two names each file. A prompt
// queued mid-turn reaches the transcript as an attachment with no companion, so its files keep the generic name. Pure.

import type { UploadRecord } from "./uploadsstore";

const SOURCE_RE = /^\[Image: source: (.+)\]$/;

/** Pure: a path as the comparison sees it, separators and case aside (Windows paths, written two ways). */
export function normImagePath(path: string): string {
    return path.replace(/\\/g, "/").toLowerCase();
}

function companionSources(content: unknown): string[] {
    if (!Array.isArray(content)) {
        return [];
    }
    const out: string[] = [];
    for (const block of content) {
        const m = block?.type === "text" && typeof block.text === "string" ? SOURCE_RE.exec(block.text.trim()) : null;
        if (m == null) {
            return []; // not a source list
        }
        out.push(m[1]);
    }
    return out;
}

/** Pure: normalized path (normImagePath) -> its paste number, from a Claude transcript's raw lines. A prompt whose
 *  companion lists a different number of files than it has numbers is left out, since the order could not be trusted. */
export function imagePasteNumbers(lines: readonly string[]): Map<string, number> {
    const numbers = new Map<string, number[]>();
    const sources = new Map<string, string[]>();
    for (const line of lines) {
        // most lines are neither, and a transcript window runs to thousands of them
        if (!line.includes('"imagePasteIds"') && !line.includes("[Image: source: ")) {
            continue;
        }
        let rec: any;
        try {
            rec = JSON.parse(line);
        } catch {
            continue;
        }
        if (rec?.type !== "user" || typeof rec.promptId !== "string") {
            continue;
        }
        if (Array.isArray(rec.imagePasteIds)) {
            numbers.set(
                rec.promptId,
                rec.imagePasteIds.filter((n: unknown) => Number.isInteger(n))
            );
        } else if (rec.isMeta) {
            const paths = companionSources(rec.message?.content);
            if (paths.length > 0) {
                sources.set(rec.promptId, paths);
            }
        }
    }
    const out = new Map<string, number>();
    for (const [promptId, nums] of numbers) {
        const paths = sources.get(promptId);
        if (paths == null || paths.length !== nums.length) {
            continue;
        }
        paths.forEach((p, i) => out.set(normImagePath(p), nums[i]));
    }
    return out;
}

/** Pure: do two path -> number maps say the same? */
export function samePasteNumbers(a: ReadonlyMap<string, number> | undefined, b: ReadonlyMap<string, number>): boolean {
    if (a == null || a.size !== b.size) {
        return false;
    }
    for (const [path, n] of b) {
        if (a.get(path) !== n) {
            return false;
        }
    }
    return true;
}

/** Pure: an agent's upload records with each pasted image named by its number ("Image #2"). The same list when no
 *  name changes, so the caller can skip a store write. */
export function imagePasteNames(list: UploadRecord[], numbers: ReadonlyMap<string, number>): UploadRecord[] {
    if (numbers.size === 0) {
        return list;
    }
    let changed = false;
    const out = list.map((r) => {
        const n = r.source === "paste" ? numbers.get(normImagePath(r.path)) : undefined;
        const name = n == null ? r.name : `Image #${n}`;
        if (name === r.name) {
            return r;
        }
        changed = true;
        return { ...r, name };
    });
    return changed ? out : list;
}
