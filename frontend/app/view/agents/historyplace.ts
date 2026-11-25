// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0
//
// The one rule both Histories (the Overview's, Conversations') place a run, a council or a pair by: under the session
// that started it. No time window and no project filter here: the caller decides which sessions it hands in and which
// items it lists. Pure.

import type { LiveSession } from "./sessionsarchivestore";
import { sessionKey } from "./sessionsruns";

// a transcript path as the two sides spell it: a run records the one its origin session was handed, a session the one
// the archive scanned
const normPath = (p: string) => p.replace(/\\/g, "/").toLowerCase();

export interface PlaceInput<T> {
    item: T;
    /** the id of the session that started it (a council's `sessionid`, a pair's worker session) */
    sessionId?: string;
    /** the transcript of the session that started it (a run's origin transcript) */
    transcript?: string;
}

export interface Placed<T> {
    /** the items each session owns, keyed by `sessionKey(owner)`, in the order they came in */
    owned: Map<string, { owner: LiveSession; items: T[] }>;
    /** the items no listed session owns; `named` says whether the item named a session at all */
    loose: { item: T; named: boolean }[];
}

// An item belongs to the session of its `sessionId`, else to the session whose transcript path is its `transcript`
// (slashes and case do not count). One whose session is not in `sessions` is loose: `named` is true when it named a
// session or transcript that is not listed (older than the caller's window, still live, in another project), false when
// it named none (started from the cockpit). Items keep their order; the caller sorts.
export function placeUnderSessions<T>(sessions: readonly LiveSession[], items: readonly PlaceInput<T>[]): Placed<T> {
    const byId = new Map<string, LiveSession>();
    const byTranscript = new Map<string, LiveSession>();
    for (const s of sessions) {
        byId.set(s.id, s);
        if (s.transcriptpath) {
            byTranscript.set(normPath(s.transcriptpath), s);
        }
    }
    const owned: Placed<T>["owned"] = new Map();
    const loose: Placed<T>["loose"] = [];
    for (const { item, sessionId, transcript } of items) {
        const path = transcript ? normPath(transcript) : "";
        const owner =
            (sessionId ? byId.get(sessionId) : undefined) ?? (path !== "" ? byTranscript.get(path) : undefined);
        if (owner == null) {
            loose.push({ item, named: !!sessionId || path !== "" });
            continue;
        }
        const key = sessionKey(owner);
        const mine = owned.get(key);
        if (mine == null) {
            owned.set(key, { owner, items: [item] });
        } else {
            mine.items.push(item);
        }
    }
    return { owned, loose };
}
