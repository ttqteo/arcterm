// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0
//
// Which [Image #N] each pasted image is. A paste into an agent's terminal is a temp file (termwrap.ts's pasteHandler)
// recorded in Uploads as "Pasted image"; Claude Code numbers it in the prompt ("[Image #2]") and records two user
// records under one promptId: the prompt, whose imagePasteIds lists the numbers in order, and an isMeta companion with
// one "[Image: source: <path>]" text block per image, in the same order. Zipping the two names each file. A prompt
// queued mid-turn reaches the transcript as an attachment with no companion, so its files keep the generic name. Before
// any of that, the paste is named off the terminal screen, where Claude Code shows "[Image #N]" in its prompt. Pure.

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

const NUMBERED_RE = /^Image #(\d+)$/;

const SCREEN_RE = /\[Image #(\d+)\]/g;

/** Pure: every [Image #N] a terminal's lines show. Claude Code draws a paste's number in its prompt as soon as the paste
 *  lands, long before the prompt reaches the transcript. */
export function screenImageNumbers(lines: readonly string[]): Set<number> {
    const out = new Set<number>();
    for (const line of lines) {
        for (const m of line.matchAll(SCREEN_RE)) {
            out.add(Number(m[1]));
        }
    }
    return out;
}

/** Pure: the number a paste was given, from the screen before and after it: the lowest one that is new and not taken by
 *  another paste (two pastes back to back can both be on screen by the time the first looks). */
export function newScreenNumber(
    before: ReadonlySet<number>,
    after: ReadonlySet<number>,
    taken: ReadonlySet<number>
): number | undefined {
    let best: number | undefined;
    for (const n of after) {
        if (!before.has(n) && !taken.has(n) && (best == null || n < best)) {
            best = n;
        }
    }
    return best;
}

/** Pure: the numbers this agent's other pastes made since `since` already hold. */
export function takenPasteNumbers(list: readonly UploadRecord[], path: string, since: number): Set<number> {
    const out = new Set<number>();
    for (const r of list) {
        const m = r.source === "paste" && r.path !== path && r.ts >= since ? NUMBERED_RE.exec(r.name) : null;
        if (m) {
            out.add(Number(m[1]));
        }
    }
    return out;
}

/** Pure: the list with the paste at `path` named "Image #n", unless something already numbered it. */
export function nameScreenPaste(list: UploadRecord[], path: string, n: number): UploadRecord[] {
    let changed = false;
    const out = list.map((r) => {
        if (r.source !== "paste" || r.path !== path || NUMBERED_RE.test(r.name)) {
            return r;
        }
        changed = true;
        return { ...r, name: `Image #${n}` };
    });
    return changed ? out : list;
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

// a prompt that went out with pasted images: when, the numbers it carried, and the files its companion names
export interface SentImagePrompt {
    ts: number;
    numbers: ReadonlySet<number>;
    sources: ReadonlySet<string>; // normImagePath
}

/** Pure: every prompt in a Claude transcript's raw lines that carried pasted images, with its companion's files. */
export function sentImagePrompts(lines: readonly string[]): SentImagePrompt[] {
    const prompts = new Map<string, { ts: number; numbers: Set<number> }>();
    const sources = new Map<string, Set<string>>();
    for (const line of lines) {
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
            const ts = Date.parse(rec.timestamp);
            const numbers = new Set<number>(rec.imagePasteIds.filter((n: unknown) => Number.isInteger(n)));
            if (Number.isFinite(ts) && numbers.size > 0) {
                prompts.set(rec.promptId, { ts, numbers });
            }
        } else if (rec.isMeta) {
            sources.set(rec.promptId, new Set(companionSources(rec.message?.content).map(normImagePath)));
        }
    }
    return [...prompts].map(([promptId, p]) => ({ ...p, sources: sources.get(promptId) ?? new Set() }));
}

/** Pure: the list without the pastes deleted from the prompt before it was sent. Claude Code numbers a paste as it lands
 *  and never reuses the number, so a paste named "Image #N" that a later prompt with images went out without (neither its
 *  number nor its file) was taken back out of the prompt. A prompt with no images, or one queued mid-turn that has no
 *  numbers, says nothing either way. The same list when nothing goes, so the caller can skip a store write. */
export function dropUnsentPastes(list: UploadRecord[], prompts: readonly SentImagePrompt[]): UploadRecord[] {
    if (prompts.length === 0) {
        return list;
    }
    const out = list.filter((r) => {
        const m = r.source === "paste" ? NUMBERED_RE.exec(r.name) : null;
        if (m == null) {
            return true;
        }
        const n = Number(m[1]);
        const path = normImagePath(r.path);
        return !prompts.some((p) => p.ts > r.ts && !p.numbers.has(n) && !p.sources.has(path));
    });
    return out.length === list.length ? list : out;
}

/** Pure: was anything pasted since `since`? Until a prompt goes out, a paste may still be taken back out of it. */
export function hasRecentPaste(list: readonly UploadRecord[], since: number): boolean {
    return list.some((r) => r.source === "paste" && r.ts >= since);
}
