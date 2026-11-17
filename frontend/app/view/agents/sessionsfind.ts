// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

// Opening a session at a search hit, and the find the opened session's detail draws: a find bar over its transcript
// (a turn hit) or the event outlined in its activity (an event hit). Ported from the kael fork's sessionsfind.ts; the
// find lives in one module-level atom here, where the fork kept it on the view model.

import { globalStore } from "@/app/store/jotaiStore";
import { atom, type PrimitiveAtom } from "jotai";
import type { AgentsViewModel } from "./agents";
import type { LiveSession } from "./sessionsarchivestore";
import { sessionKey, sessionSelection } from "./sessionsruns";

export interface SessionFind {
    sessionKey: string; // `${runtime}:${id}`
    query: string; // as typed, shown in the bar
    terms: string[]; // CommandSearchSessionsRtnData.terms
    target: { kind: "turn" | "event"; ord: number };
    at: { sel: string; member?: string }; // the selection that puts sessionKey in view
}

// the find a result was opened with; null once the bar is closed or another session is selected
export const sessionFindAtom = atom<SessionFind | null>(null) as PrimitiveAtom<SessionFind | null>;

// The session a find opened, kept after the bar is closed: Esc ends the bar, not the reading, so a run member whose
// default session is another one keeps showing the session the hit was in. Set by openSessionHit alongside the find;
// the detail clears it when findEnded says the selection moved on.
export type SessionFound = Pick<SessionFind, "sessionKey" | "at">;
export const sessionFoundAtom = atom<SessionFound | null>(null) as PrimitiveAtom<SessionFound | null>;

export interface HitSelection {
    sel: string;
    member?: string;
    view: "transcript" | "activity";
    target: SessionFind["target"];
}

// Where a result's hit lands: the selection History uses for its session (sessionSelection: a solo session's key, or
// its run with the member in view), the view that shows the hit (an event is in the Activity list, a turn in the
// transcript) and the hit's own place. hit omitted = the first hit, or a turn at ord 0 when the result has none.
export function hitSelection(r: SessionSearchResult, hit?: SessionHit): HitSelection {
    const h = hit ?? r.hits?.[0];
    const target: SessionFind["target"] = h
        ? { kind: h.kind as "turn" | "event", ord: h.ord }
        : { kind: "turn", ord: 0 };
    const to = sessionSelection(r.session);
    return { ...to, view: target.kind === "event" ? "activity" : "transcript", target };
}

// Selects the result's session as History selects one, shows the view the hit is in and sets the find. It does not
// change surface or centre mode: the caller is already looking at History.
export function openSessionHit(
    model: AgentsViewModel,
    r: SessionSearchResult,
    query: string,
    terms: string[],
    hit?: SessionHit
): void {
    const to = hitSelection(r, hit);
    const at: SessionFind["at"] = to.member != null ? { sel: to.sel, member: to.member } : { sel: to.sel };
    globalStore.set(model.sessionsSelAtom, to.sel);
    if (to.member != null) {
        globalStore.set(model.sessionsMemberAtom, to.member);
    }
    globalStore.set(model.sessionsViewAtom, to.view);
    globalStore.set(sessionFindAtom, { sessionKey: sessionKey(r.session), query, terms, target: to.target, at });
    globalStore.set(sessionFoundAtom, { sessionKey: sessionKey(r.session), at });
}

// The session a find was opened on, while the selection still shows its run member. A member's detail otherwise
// shows its default session (live, else newest non-review), and a hit can sit in another one: the task's reviewer,
// an older attempt, an earlier lead session. Undefined when no find applies or the run does not hold that session.
// Pass the found mark to keep the session in view after the bar is closed, or the find itself to end with it.
export function foundSession(
    found: SessionFound | null,
    sel: string,
    member: string,
    sessions: LiveSession[]
): LiveSession | undefined {
    if (found == null || found.at.member == null || findEnded(found, sel, member)) {
        return undefined;
    }
    return sessions.find((s) => sessionKey(s) === found.sessionKey);
}

// Selecting another session ends a find. Read from the selection, never from the session a detail pane
// renders: while the pane animates from one detail to another, the outgoing one still renders the old session.
// The merged feed ("all") selects no session, so it leaves the find set.
export function findEnded(find: Pick<SessionFind, "at"> | null, sel: string, member: string): boolean {
    if (find == null || sel === "all") {
        return false;
    }
    return sel !== find.at.sel || (find.at.member != null && member !== find.at.member);
}

// The match the transcript was last centred on. A live session is reread every few seconds, which redraws every
// range; re-centring on each reread would snap the reader back to the match while they scroll away to read. Only
// a different match (another find, refined terms, a step) moves the view. limit is the line limit the transcript
// was read under: a longer read (the whole file replacing the tail) renumbers the matches, so the same pos is another
// match.
export type FindMark = { find: SessionFind | null; terms: string; pos: number; limit: number };

export function needsCentre(last: FindMark | null, next: FindMark): boolean {
    return (
        last == null ||
        last.find !== next.find ||
        last.terms !== next.terms ||
        last.pos !== next.pos ||
        last.limit !== next.limit
    );
}

// the find bar's next position, wrapping; 0 when there is nothing to step through
export function stepFind(pos: number, total: number, dir: 1 | -1): number {
    return total > 0 ? (pos + dir + total) % total : 0;
}

// Folds case one code point at a time, so a folding that changes a character's length (İ) cannot shift the
// offsets: at[i] is the original [start, end) of the character folded[i] came from.
function foldText(text: string): { folded: string; at: [number, number][] } {
    let folded = "";
    const at: [number, number][] = [];
    let i = 0;
    for (const ch of text) {
        const low = ch.toLowerCase();
        folded += low;
        for (let k = 0; k < low.length; k++) {
            at.push([i, i + ch.length]);
        }
        i += ch.length;
    }
    return { folded, at };
}

// text folded the way findRanges folds it, for a match that must agree with the ranges (a title against the terms)
export function foldedText(text: string): string {
    return foldText(text).folded;
}

// Every occurrence of every term in text, as sorted UTF-16 [start, end) ranges, with overlapping ones merged:
// the same rule the Go matcher counts turn hits by, so a turn's ranges here are its hits there.
export function findRanges(text: string, terms: string[]): [number, number][] {
    const { folded, at } = foldText(text);
    const found: [number, number][] = [];
    for (const term of terms) {
        const t = term.toLowerCase();
        if (t === "") {
            continue;
        }
        // resumes past each occurrence, as the Go matcher does, so "aa" in "aaaa" is two touching ranges
        for (let i = folded.indexOf(t); i >= 0; i = folded.indexOf(t, i + t.length)) {
            found.push([at[i][0], at[i + t.length - 1][1]]);
        }
    }
    found.sort((a, b) => a[0] - b[0] || a[1] - b[1]);
    const merged: [number, number][] = [];
    for (const r of found) {
        const last = merged[merged.length - 1];
        if (last != null && r[0] < last[1]) {
            last[1] = Math.max(last[1], r[1]);
        } else {
            merged.push([r[0], r[1]]);
        }
    }
    return merged;
}

// The terms of a query the user refines in the find bar, by the search's own rule (ParseQuery,
// pkg/agentsessions): lower-cased words, and double-quoted text as one term; an unclosed quote runs to the end.
export function findTerms(query: string): string[] {
    const parts = query.split('"');
    // an even count of parts is an odd count of quotes: ParseQuery drops the unclosed one and reads what follows
    // it as separate words, not a phrase
    const unclosed = parts.length % 2 === 0 ? parts.length - 1 : -1;
    return parts.flatMap((part, i) => {
        const words = part.toLowerCase().split(/\s+/).filter(Boolean);
        return i % 2 === 1 && i !== unclosed ? (words.length ? [words.join(" ")] : []) : words;
    });
}
