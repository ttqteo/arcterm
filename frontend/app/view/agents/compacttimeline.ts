// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0
//
// The compact read of an old transcript, as Antigravity lays it out: your message in a box, the agent's prose as plain
// text, and everything it did between two pieces of prose folded into one "Worked for 24s" line that opens to the
// tool lines. The files that stretch edited become one "N files changed +a −d" bar after it. Pure; compacttranscript.tsx
// renders it. The live feed keeps groupTimeline's finer folding (agentsviewmodel.ts).

import {
    groupTimeline,
    isEditAction,
    type AgentActionEntry,
    type AgentEntry,
    type EditFile,
    type TimelineItem,
} from "./agentsviewmodel";

// one stretch of consecutive tool calls, keyed by the first one's entry index (stable: entries are append-only)
export interface WorkItem {
    kind: "work";
    startIndex: number;
    actions: AgentActionEntry[];
    durationMs: number; // the tools' wall time added up; 0 when the transcript carried no timestamps
    failed: number;
    files: EditFile[]; // the files its edits touched, one entry per path
    adds: number;
    dels: number;
}

export type CompactItem = Exclude<TimelineItem, { kind: "action" | "group" | "edit-burst" }> | WorkItem;

/** Pure: edits of the same path in one stretch as one file: first badge, summed counts, diff lines in order. */
export function mergeEditFiles(files: EditFile[]): EditFile[] {
    const byPath = new Map<string, EditFile>();
    for (const f of files) {
        const seen = byPath.get(f.path);
        if (seen == null) {
            byPath.set(f.path, { ...f, lines: [...f.lines] });
        } else {
            seen.adds += f.adds;
            seen.dels += f.dels;
            seen.lines.push(...f.lines);
        }
    }
    return [...byPath.values()];
}

function workOf(startIndex: number, actions: AgentActionEntry[]): WorkItem {
    const edits: EditFile[] = [];
    for (const a of actions) {
        if (isEditAction(a) && a.detail?.kind === "edit") {
            edits.push(...a.detail.files);
        }
    }
    const files = mergeEditFiles(edits);
    return {
        kind: "work",
        startIndex,
        actions,
        durationMs: actions.reduce((n, a) => n + (a.durationMs ?? 0), 0),
        failed: actions.filter((a) => a.outcome === "fail").length,
        files,
        adds: files.reduce((n, f) => n + f.adds, 0),
        dels: files.reduce((n, f) => n + f.dels, 0),
    };
}

/** Pure: the transcript's render items with every run of tool calls, however short, folded into one WorkItem. */
export function groupCompact(entries: AgentEntry[]): CompactItem[] {
    const out: CompactItem[] = [];
    let run: Extract<TimelineItem, { kind: "action" }>[] = [];
    const flush = () => {
        if (run.length > 0) {
            out.push(
                workOf(
                    run[0].index,
                    run.map((r) => r.action)
                )
            );
            run = [];
        }
    };
    // an unreachable threshold keeps every action a single item, so the folding here is the only one
    for (const item of groupTimeline(entries, Infinity)) {
        if (item.kind === "action") {
            run.push(item);
            continue;
        }
        flush();
        if (item.kind !== "group" && item.kind !== "edit-burst") {
            out.push(item);
        }
    }
    flush();
    return out;
}

/** Pure: "Worked for 24s", "Worked for 3m 12s", "Worked for 1h 5m"; plain "Worked" under a second or with no times. */
export function workedFor(durationMs: number): string {
    const s = Math.round(durationMs / 1000);
    if (s < 1) {
        return "Worked";
    }
    if (s < 60) {
        return `Worked for ${s}s`;
    }
    const m = Math.floor(s / 60);
    if (m < 60) {
        return s % 60 ? `Worked for ${m}m ${s % 60}s` : `Worked for ${m}m`;
    }
    const h = Math.floor(m / 60);
    return m % 60 ? `Worked for ${h}h ${m % 60}m` : `Worked for ${h}h`;
}

/** Pure: how many tool calls a work line holds, as the word the line shows after its title. */
export function toolCountLabel(n: number): string {
    return `${n} ${n === 1 ? "tool" : "tools"}`;
}

// a message past either bound shows six lines and a "Show more", so one pasted log does not push the rest off screen
export const USER_CLAMP_LINES = 6;
const USER_CLAMP_CHARS = 480;

/** Pure: is a user message long enough to show clamped? */
export function userNeedsClamp(text: string): boolean {
    return text.length > USER_CLAMP_CHARS || text.split("\n").length > USER_CLAMP_LINES;
}

/** Pure: the changed-files bar's title. */
export function filesChangedLabel(n: number): string {
    return `${n} ${n === 1 ? "file" : "files"} changed`;
}
