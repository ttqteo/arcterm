// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0
//
// The Brief's For later region (spec 2026-11-13-jarvis-later-design.md): every session marked for later, in one flat
// list, newest mark first, whatever its project or age. A mark is a session id (latermodel.ts); its name and project
// come from the sessions looked up by id (sessionsarchivestore.ts lookupSessions), so a mark older than History's week
// still names its session. A mark the lookup found no session for still shows, so it can be cleared with Done. Pure:
// the region (forlaterregion.tsx) draws what this derives.

import { laterKey, type LaterMarks } from "@/app/view/agents/latermodel";

// the rows the region opens at; the rest open in place behind "+N more"
export const LATER_CAP = 5;

// the cursor id of a row: region-prefixed as every Brief row's is (briefnav.ts)
export const laterNavId = (key: string) => `later:${key}`;

// the key a Done waiting out its undo window hides the row under (briefundo.ts pendingDeleteKeysAtom)
export const laterDoneKey = (key: string) => `later-done:${key}`;

// the length of a session id shown while its lookup has not answered
const SHORT_ID = 8;

/** What a row reads of a session: the scanned fields and the live overlay (sessionsarchivestore.ts LiveSession). */
export type LaterSession = {
    runtime: string;
    id: string;
    task: string;
    projectname: string;
    transcriptpath: string;
    resumecommand: string;
    live: boolean;
};

export type LaterRow<S extends LaterSession = LaterSession> = {
    key: string; // the mark's key, the session id
    navId: string;
    markedAt: number;
    age: string;
    // found: its session is known; looking: the lookup has not answered for it yet; missing: it answered with none
    state: "found" | "looking" | "missing";
    session?: S;
    title: string;
    project: string;
    // a click opens the session: a live one's agent, an ended one's transcript
    canOpen: boolean;
    // an ended session with a resume command offers Resume
    canResume: boolean;
};

/**
 * Pure: the marks as rows, newest mark first (the key breaks a tie, so the order is total). `lookedUp` is the ids the
 * last finished lookup asked for: an id it covered with no session is missing, one it did not cover is still looking.
 * `hidden` holds laterDoneKey of each mark whose Done waits out its undo window. `age` formats a duration ("3d").
 */
export function laterRows<S extends LaterSession>(
    marks: LaterMarks,
    sessions: readonly S[],
    lookedUp: readonly string[],
    hidden: ReadonlySet<string>,
    now: number,
    age: (ms: number) => string
): LaterRow<S>[] {
    const byKey = new Map<string, S>();
    for (const s of sessions) {
        const k = laterKey(s.transcriptpath);
        if (k != null && !byKey.has(k)) {
            byKey.set(k, s);
        }
    }
    const covered = new Set(lookedUp);
    const rows: LaterRow<S>[] = [];
    for (const [key, markedAt] of Object.entries(marks)) {
        if (hidden.has(laterDoneKey(key))) {
            continue;
        }
        const session = byKey.get(key);
        const state = session != null ? "found" : covered.has(key) ? "missing" : "looking";
        rows.push({
            key,
            navId: laterNavId(key),
            markedAt,
            age: age(Math.max(0, now - markedAt)),
            state,
            session,
            title:
                session != null
                    ? session.task || "(untitled session)"
                    : state === "missing"
                      ? "(session not found)"
                      : key.slice(0, SHORT_ID),
            project: session?.projectname ?? "",
            canOpen: session != null,
            canResume: session != null && !session.live && session.resumecommand !== "",
        });
    }
    rows.sort((a, b) => b.markedAt - a.markedAt || (a.key < b.key ? -1 : a.key > b.key ? 1 : 0));
    return rows;
}

/** Pure: the rows the Brief's search keeps: its words in the name or the project, ignoring case. */
export function filterLaterRows<S extends LaterSession>(rows: LaterRow<S>[], query: string): LaterRow<S>[] {
    const q = query.trim().toLowerCase();
    if (q === "") {
        return rows;
    }
    return rows.filter((r) => r.title.toLowerCase().includes(q) || r.project.toLowerCase().includes(q));
}
