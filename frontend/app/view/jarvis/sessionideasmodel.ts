// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0
//
// Session ideas as the cockpit reads them (docs/superpowers/specs/2026-11-26-session-ideas-design.md): what a scan found in
// past sessions and nobody decided, as rows, a coverage bar, Sprout's fixed chips and the toast a scan's end earns. Pure over
// the SessionIdeasData wavesrv sends (sessionideasstore.ts holds it): no atoms, no RPC. The Brief's region and Sprout's popup
// draw from here, so the two never disagree about which idea is first or which are leaving.

const DAY_MS = 86_400_000;

/** A transcript deleted within this many days is "leaving soon": the chip and the region's warning line say so. */
export const LEAVING_SOON_DAYS = 7;

const plural = (n: number, word: string): string => `${n} ${word}${n === 1 ? "" : "s"}`;

/** The ideas waiting for a decision, the one whose transcript is deleted soonest first (it is the one that loses its source
 *  first); an idea with no deletion day last. A tie goes to the newest find, then the id, so the order never shuffles. */
export function reviewRows(data: SessionIdeasData | null | undefined): SessionIdea[] {
    const day = (i: SessionIdea): number => (i.deletests > 0 ? i.deletests : Infinity);
    return (data?.ideas ?? [])
        .filter((i) => i.state === "review")
        .sort((a, b) => {
            if (day(a) !== day(b)) {
                return day(a) < day(b) ? -1 : 1;
            }
            if (a.foundts !== b.foundts) {
                return b.foundts - a.foundts;
            }
            return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
        });
}

/** The review rows whose transcript is deleted within LEAVING_SOON_DAYS (one already past its day counts: its source may be
 *  gone any moment), in reviewRows' order. */
export function leavingSoonRows(data: SessionIdeasData | null | undefined, now: number): SessionIdea[] {
    const horizon = now + LEAVING_SOON_DAYS * DAY_MS;
    return reviewRows(data).filter((i) => i.deletests > 0 && i.deletests <= horizon);
}

export type Coverage = { scanned: number; notYet: number; leavingSoon: number; total: number };

/** The Sessions scanned fold's bar: the sessions of the last 90 days in three parts that add up to `total`. wavesrv counts
 *  `leavingsoon` inside `notyet` (an unscanned session with 7 days or less left is both), so the bar's "not yet" is what is
 *  left of `notyet` once those are taken out, and no part is drawn twice. */
export function coverage(data: SessionIdeasData | null | undefined): Coverage {
    const scanned = data?.scanned ?? 0;
    const leavingSoon = data?.leavingsoon ?? 0;
    const notYet = Math.max(0, (data?.notyet ?? 0) - leavingSoon);
    return { scanned, notYet, leavingSoon, total: scanned + notYet + leavingSoon };
}

export type IdeaChipKind = "waiting" | "go-through" | "discuss" | "leaving";

/** One of Sprout's fixed chips under the ideas line. `ideaId` is the idea Discuss opens. */
export type IdeaChip = { kind: IdeaChipKind; text: string; ideaId?: string };

/** The chips, in the order the popup draws them, or none with nothing in review (the popup hides the line then). Each does
 *  one thing and none waits on a model: What's waiting? and Which lose their transcript soon? open a list, Go through N and
 *  Discuss open an agent. Discuss names the first row, the one deleted soonest. */
export function chipsFor(data: SessionIdeasData | null | undefined, now: number): IdeaChip[] {
    const rows = reviewRows(data);
    if (rows.length === 0) {
        return [];
    }
    const chips: IdeaChip[] = [
        { kind: "waiting", text: "What's waiting?" },
        { kind: "go-through", text: `Go through ${rows.length} with an agent` },
        { kind: "discuss", text: `Discuss: ${rows[0].gist}`, ideaId: rows[0].id },
    ];
    if (leavingSoonRows(data, now).length > 0) {
        chips.push({ kind: "leaving", text: "Which lose their transcript soon?" });
    }
    return chips;
}

/** The waveapp.log line a chip press leaves (`position` is its place in the row, from 1), so a chip nobody presses can be
 *  dropped on numbers, as the chatsuggest council asked of Chat's chips (chatsuggest.ts chipPickLogLine). One line. */
export function ideaChipLogLine(chip: IdeaChip, position: number): string {
    return `sessionideas: pick chip=${chip.kind} at=${position} text=${JSON.stringify(chip.text)}`;
}

/** The toast a scan's end earns, or null. `prev` is what the feed held before this read, `next` what it holds now. A scan has
 *  ended when `next` carries one with an end time, and it is news when `prev` did not already hold that very scan ended: the
 *  scan was running, or `prev` held another scan, or none (reads that coalesce can skip the running state, so only the
 *  scan's start time tells two scans apart). The first read (`prev` null) is never news: it shows a scan that ended before the
 *  app looked. A scan that stopped part way tells too, when it found something. */
export function scanEndToast(prev: SessionIdeasData | null, next: SessionIdeasData | null | undefined): string | null {
    const scan = next?.scan;
    if (prev == null || scan == null || scan.endedts <= 0 || scan.newideas <= 0) {
        return null;
    }
    const before = prev.scan;
    if (before != null && before.startedts === scan.startedts && before.endedts > 0) {
        return null;
    }
    return `Session scan: ${plural(scan.newideas, "idea")} to review, from ${plural(scan.done, "session")}`;
}
