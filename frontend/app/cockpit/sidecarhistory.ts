// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0
//
// What a Sidecar tile reads beyond the rows of its snapshot (spec 2026-11-13-sidecar-design.md, section 3; plan
// decision 5): the pages above a tile's rows when it is scrolled up (`older`). Pure functions plus a thin RPC reader; the
// bridge (sidecarbridge.tsx) decides which to call and what to answer when one fails. (Decision 7's one-time tail read,
// for an agent the main window does not stream, went when the wall came to hold only streamed agents, 2026-11-16.)
//
// A cursor is an opaque string the bridge mints and reads back: `m:<row index>` into the rows the main window holds for
// an agent (oldest first, indexed from the start so new rows at the bottom do not move it), `f:<line index>` into the
// agent's transcript file (the index `GetAgentTranscriptCommand`'s `before` takes). A cursor that does not parse, is for
// the other source, or no longer fits answers `{ rows: [], next: null }`, never an error: the page then shows "Start of
// what arcterm holds" and stops asking.

import { RpcApi } from "@/app/store/wshclientapi";
import { TabRpcClient } from "@/app/store/wshrpcutil";
import { projectorFor } from "@/app/view/agents/transcriptregistry";
import { messageRows } from "./sidecarsnapshot";
import type { SidecarMessage } from "./sidecartypes";

/** A page read from a transcript file is this many lines (decision 5): a file-backed agent costs one read per page. */
export const OLDER_FILE_LINES = 400;

/** One page of scrollback: rows oldest first, and the cursor of the page above it (null: nothing is earlier). */
export interface OlderPage {
    rows: SidecarMessage[];
    next: string | null;
}

const NOTHING_EARLIER: OlderPage = { rows: [], next: null };

// the index of a cursor with this prefix, or null: a canonical non-negative integer only ("m:07" and "m:1e3" are not
// cursors this module minted)
function cursorIndex(cursor: string, prefix: "m" | "f"): number | null {
    const m = new RegExp(`^${prefix}:(0|[1-9]\\d*)$`).exec(cursor);
    if (m == null) {
        return null;
    }
    const n = Number(m[1]);
    return Number.isSafeInteger(n) ? n : null;
}

/**
 * The page above `before` from the rows the main window holds for an agent (`all`, oldest first). With `before` null
 * the page ends just above the last `shownCount` rows, the ones the snapshot already carries. `count` rows at most; `next`
 * is the index of the page's first row, null when that is row 0. A cursor past the rows held (the 4,000-line cap
 * trimmed the front, so indexes moved) answers nothing.
 */
export function olderFromMemory(
    all: SidecarMessage[],
    shownCount: number,
    before: string | null,
    count: number
): OlderPage {
    let end: number;
    if (before == null) {
        end = Math.max(0, all.length - Math.max(0, shownCount));
    } else {
        const at = cursorIndex(before, "m");
        if (at == null || at > all.length) {
            return NOTHING_EARLIER;
        }
        end = at;
    }
    const take = Number.isFinite(count) ? Math.max(0, Math.floor(count)) : 0;
    const start = Math.max(0, end - take);
    return { rows: all.slice(start, end), next: start > 0 ? `m:${start}` : null };
}

function sameRow(a: SidecarMessage, b: SidecarMessage): boolean {
    return (
        a.say === b.say &&
        a.tool?.verb === b.tool?.verb &&
        a.tool?.target === b.tool?.target &&
        a.tool?.outcome === b.tool?.outcome
    );
}

// `rows` without the rows at its end that `shown` ends with, compared by value: the tile already draws those
function withoutShown(rows: SidecarMessage[], shown: SidecarMessage[]): SidecarMessage[] {
    let k = 0;
    while (k < rows.length && k < shown.length && sameRow(rows[rows.length - 1 - k], shown[shown.length - 1 - k])) {
        k++;
    }
    return rows.slice(0, rows.length - k);
}

// the rows of the lines read, by the same rule a tile's own rows follow (no cap)
function rowsOfLines(lines: string[], agent: string | undefined, path: string): SidecarMessage[] {
    return messageRows(projectorFor(agent, path).project(lines), Infinity);
}

/**
 * One page read from the transcript file at `path`: OLDER_FILE_LINES lines before the cursor, or the file's tail for
 * null (then without the rows `shown` already carries at its end), projected for `agent`. `next` is the answer's first
 * line index, null at the start of the file. A window cuts a turn at its edge, so a page may open with a row that is
 * only a tool, the rest of the row that closes the page below it. Rejects when the read fails, and the page may hold no
 * rows while `next` still points on: the caller decides what the person sees then.
 */
export async function readOlderFromFile(
    path: string,
    agent: string | undefined,
    before: string | null,
    shown: SidecarMessage[]
): Promise<OlderPage> {
    let limit: number | undefined;
    if (before != null) {
        const at = cursorIndex(before, "f");
        if (at == null || at === 0) {
            return NOTHING_EARLIER;
        }
        limit = at;
    }
    const answer = await RpcApi.GetAgentTranscriptCommand(
        TabRpcClient,
        limit == null ? { path, maxlines: OLDER_FILE_LINES } : { path, maxlines: OLDER_FILE_LINES, before: limit }
    );
    // the server clamps a `before` past the file to its tail: that is not the page the cursor named
    if (limit != null && limit > answer.total) {
        return NOTHING_EARLIER;
    }
    const rows = rowsOfLines(answer.lines ?? [], agent, path);
    return {
        rows: before == null ? withoutShown(rows, shown) : rows,
        next: answer.start > 0 ? `f:${answer.start}` : null,
    };
}
