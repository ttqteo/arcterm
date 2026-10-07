// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0
//
// Pure: what the initiative peek body says. Chunk state comes from effortFacts, chunkTone and effortChunkRows;
// nothing here derives it again.

import { effortFacts, type ChunkTone } from "../effortmodel";
import { effortChunkRows } from "../effortstore";
import type { PeekFacts } from "../peekstore";

export type PeekChunk = { n: number; label: string; status: string; tone: ChunkTone; active: boolean };

export type EffortPeekModel = {
    title: string;
    status: string;
    // an initiative has no objective field; its first note is where one is written
    objective: string | null;
    progress: string;
    project: string | null;
    // one per chunk, in plan order
    segments: ChunkTone[];
    doneLine: string | null;
    remaining: PeekChunk[];
};

export function effortPeekModel(effort: Effort): EffortPeekModel {
    const facts = effortFacts(effort, []);
    const rows = effortChunkRows(effort);
    const doneRows = rows.filter((r) => r.tone === "done");
    const stages = [...new Set(doneRows.map((r) => r.stage).filter((s) => s !== ""))];
    const objective = [...(effort.notes ?? [])].sort((a, b) => a.ts - b.ts)[0]?.text;
    return {
        title: effort.title,
        status: effort.status,
        objective: objective ? objective : null,
        progress: `${facts.done} of ${facts.counted} chunks done`,
        project: effort.project ? effort.project : null,
        segments: rows.map((r) => r.tone),
        doneLine: doneRows.length > 0 ? [`${doneRows.length} done`, ...stages].join(" · ") : null,
        remaining: rows
            .map((r, i) => ({ n: i + 1, label: r.label, status: r.status, tone: r.tone, active: r.tone === "active" }))
            .filter((r) => r.tone !== "done" && r.tone !== "skipped"),
    };
}

export function effortPeekFacts(effort: Effort | undefined): PeekFacts {
    return { gone: effort == null };
}
