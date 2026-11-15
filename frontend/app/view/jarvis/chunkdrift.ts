// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0
//
// A chunk not yet done was written against the code of its day. The server keeps the commit it was written at
// (EffortChunk.basecommit, or for an older chunk the commit HEAD was at when it was added), counts the commits since
// (EffortChunkDriftCommand) and names the files the chunk mentions that changed or went away since (the stale scan,
// EffortStaleCommand). This words both for the chunk view, with the Mark checked that moves the base to today's HEAD,
// and for the chip on a plan row. Pure: no React, no Wave runtime imports.

import { shortDate } from "./initiativework";

export type ChunkDriftLine = { text: string; title: string; gone: boolean };

const settled = (status: string) => status === "done" || status === "skipped";

// "IMAGE.md was deleted", "old.ts moved to src/new.ts", "store.ts changed 4 times"
function fileWords(f: EffortStaleFile): string {
    if (f.gone && f.renamedto) {
        return `${f.mention} moved to ${f.renamedto}`;
    }
    if (f.gone) {
        return `${f.mention} was deleted`;
    }
    return f.changes === 1 ? `${f.mention} changed once` : `${f.mention} changed ${f.changes} times`;
}

// every file, one per line, for a title
function filesTitle(files: EffortStaleFile[]): string {
    return files.map(fileWords).join("\n");
}

// a settled chunk has nothing left to go stale, and a count of zero says nothing worth a line
export function chunkDriftLine(
    status: string,
    drift:
        | Pick<CommandEffortChunkDriftRtnData, "known" | "base" | "behind" | "basets" | "inferred" | "files">
        | null
        | undefined
): ChunkDriftLine | null {
    if (drift == null || !drift.known || drift.behind <= 0 || settled(status)) {
        return null;
    }
    const when = drift.basets ? ` (${shortDate(drift.basets)})` : "";
    const base = (drift.base ?? "").slice(0, 9);
    const against = drift.inferred ? `Written around ${base}, when it was added.` : `Written against ${base}.`;
    const files = drift.files ?? [];
    if (files.length > 0) {
        const gone = files.some((f) => f.gone);
        const lead = fileWords(files[0]);
        const more = files.length > 1 ? ` (+${files.length - 1} more)` : "";
        return {
            text: `${lead}${more} since this was written${when}: ${gone ? "rewrite or skip it" : "check it still holds"}`,
            title: `${filesTitle(files)}\n${against} Mark checked once it is right for today's code.`,
            gone,
        };
    }
    const n = drift.behind === 1 ? "1 commit" : `${drift.behind} commits`;
    return {
        text: `Written ${n} ago${when}: check it still holds`,
        title: `${against} Mark checked once it is right for today's code.`,
        gone: false,
    };
}

export type StaleChip = { text: string; title: string; gone: boolean };

// the chip on a plan row the stale scan flagged: "file gone" outranks "changed since"
export function staleChip(status: string, stale: EffortChunkStale | null | undefined): StaleChip | null {
    if (stale == null || settled(status) || (stale.files?.length ?? 0) === 0) {
        return null;
    }
    const gone = stale.files.some((f) => f.gone);
    return {
        text: gone ? "file gone" : "changed since",
        title: `${filesTitle(stale.files)}\nsince this chunk was written (${stale.landed} ${stale.landed === 1 ? "commit" : "commits"} landed). Open it to check it still holds.`,
        gone,
    };
}

// the scan's flagged chunks of one initiative, by label
export function staleByLabel(entries: EffortStaleEntry[] | null | undefined): Map<string, EffortChunkStale> {
    const out = new Map<string, EffortChunkStale>();
    for (const e of entries ?? []) {
        for (const c of e.chunks ?? []) {
            out.set(c.chunk, c);
        }
    }
    return out;
}
