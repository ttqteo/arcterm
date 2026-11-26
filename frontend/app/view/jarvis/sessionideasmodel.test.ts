// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { describe, expect, it } from "vitest";
import {
    chipsFor,
    coverage,
    ideaChipLogLine,
    keptSince,
    leavingSoonRows,
    reviewRows,
    scanEndToast,
    type IdeaChip,
} from "./sessionideasmodel";

const DAY = 86_400_000;
const NOW = Date.UTC(2026, 10, 26, 12, 0, 0);

function idea(over: Partial<SessionIdea> & { id: string }): SessionIdea {
    return {
        gist: `gist of ${over.id}`,
        project: "arcterm",
        projectpath: "D:/work/arcterm",
        effortoid: "",
        efforttitle: "",
        quotes: [],
        why: "",
        sessionid: `s-${over.id}`,
        sessiontitle: "",
        transcriptpath: "",
        saidts: 0,
        deletests: 0,
        foundts: 0,
        state: "review",
        resolvedts: 0,
        keptas: "",
        ...over,
    };
}

function data(over: Partial<SessionIdeasData> = {}): SessionIdeasData {
    return {
        ideas: [],
        marks: [],
        sessions: [],
        scanned: 0,
        notyet: 0,
        leavingsoon: 0,
        lastscants: 0,
        nextscants: 0,
        seents: 0,
        snoozeduntil: 0,
        firstscandone: true,
        ...over,
    };
}

function scan(over: Partial<SessionIdeasScan> = {}): SessionIdeasScan {
    return {
        done: 0,
        total: 0,
        startedts: 1000,
        endedts: 0,
        forced: false,
        error: "",
        stoppedat: 0,
        newideas: 0,
        tokens: 0,
        ...over,
    };
}

describe("reviewRows", () => {
    it("is empty before the first read and with nothing in review", () => {
        expect(reviewRows(null)).toEqual([]);
        expect(reviewRows(undefined)).toEqual([]);
        expect(
            reviewRows(data({ ideas: [idea({ id: "k", state: "kept" }), idea({ id: "d", state: "dropped" })] }))
        ).toEqual([]);
    });

    it("keeps only the ideas in review, the one deleted soonest first", () => {
        const rows = reviewRows(
            data({
                ideas: [
                    idea({ id: "late", deletests: NOW + 20 * DAY }),
                    idea({ id: "kept", state: "kept", deletests: NOW + 1 * DAY }),
                    idea({ id: "soon", deletests: NOW + 3 * DAY }),
                ],
            })
        );
        expect(rows.map((r) => r.id)).toEqual(["soon", "late"]);
    });

    it("puts an idea with no deletion day last, and breaks a tie by the newest find, then the id", () => {
        const rows = reviewRows(
            data({
                ideas: [
                    idea({ id: "unknown", deletests: 0, foundts: 900 }),
                    idea({ id: "b", deletests: NOW + DAY, foundts: 100 }),
                    idea({ id: "a", deletests: NOW + DAY, foundts: 100 }),
                    idea({ id: "newer", deletests: NOW + DAY, foundts: 500 }),
                ],
            })
        );
        expect(rows.map((r) => r.id)).toEqual(["newer", "a", "b", "unknown"]);
    });

    it("does not reorder the data it was given", () => {
        const ideas = [idea({ id: "late", deletests: NOW + 9 * DAY }), idea({ id: "soon", deletests: NOW + DAY })];
        reviewRows(data({ ideas }));
        expect(ideas.map((i) => i.id)).toEqual(["late", "soon"]);
    });
});

describe("leavingSoonRows", () => {
    it("is the review rows whose transcript is deleted within 7 days, a past day included", () => {
        const d = data({
            ideas: [
                idea({ id: "gone", deletests: NOW - DAY }),
                idea({ id: "edge", deletests: NOW + 7 * DAY }),
                idea({ id: "far", deletests: NOW + 8 * DAY }),
                idea({ id: "unknown", deletests: 0 }),
                idea({ id: "kept", state: "kept", deletests: NOW + DAY }),
            ],
        });
        expect(leavingSoonRows(d, NOW).map((r) => r.id)).toEqual(["gone", "edge"]);
    });
});

describe("coverage", () => {
    it("is zero before the first read", () => {
        expect(coverage(null)).toEqual({ scanned: 0, notYet: 0, leavingSoon: 0, total: 0 });
    });

    it("splits the sessions into three parts that add up: scanned, not yet, leaving within 7 days", () => {
        // leavingsoon is a part of notyet (unscanned with 7 days or less left), so the bar's "not yet" is what is left of it
        expect(coverage(data({ scanned: 12, notyet: 5, leavingsoon: 2 }))).toEqual({
            scanned: 12,
            notYet: 3,
            leavingSoon: 2,
            total: 17,
        });
    });

    // wavesrv keeps leavingsoon inside notyet, so this does not happen; if the two ever disagree the bar must not go negative
    it("never draws a negative part when the counts disagree", () => {
        expect(coverage(data({ scanned: 1, notyet: 1, leavingsoon: 4 }))).toEqual({
            scanned: 1,
            notYet: 0,
            leavingSoon: 4,
            total: 5,
        });
    });
});

describe("chipsFor", () => {
    const two = data({
        ideas: [
            idea({ id: "i-soon", gist: "Let Sprout read the queue aloud", deletests: NOW + 20 * DAY }),
            idea({ id: "i-late", gist: "Pin a chunk to the tab bar", deletests: NOW + 40 * DAY }),
        ],
    });

    it("has no chips with nothing in review", () => {
        expect(chipsFor(null, NOW)).toEqual([]);
        expect(chipsFor(data(), NOW)).toEqual([]);
    });

    it("offers What's waiting, Go through N and Discuss on the first row, in that order", () => {
        expect(chipsFor(two, NOW)).toEqual<IdeaChip[]>([
            { kind: "waiting", text: "What's waiting?" },
            { kind: "go-through", text: "Go through 2 with an agent" },
            { kind: "discuss", text: "Discuss: Let Sprout read the queue aloud", ideaId: "i-soon" },
        ]);
    });

    it("adds Which lose their transcript soon? only while one does, last", () => {
        const withSoon = data({
            ideas: [...two.ideas, idea({ id: "i-leaving", gist: "Cache the digest", deletests: NOW + 2 * DAY })],
        });
        const chips = chipsFor(withSoon, NOW);
        expect(chips.map((c) => c.kind)).toEqual(["waiting", "go-through", "discuss", "leaving"]);
        expect(chips[3].text).toBe("Which lose their transcript soon?");
        // the first row is the one deleted soonest, so Discuss names it
        expect(chips[2]).toEqual({ kind: "discuss", text: "Discuss: Cache the digest", ideaId: "i-leaving" });
    });

    it("counts only the ideas in review in Go through N", () => {
        const mixed = data({ ideas: [...two.ideas, idea({ id: "k", state: "kept" })] });
        expect(chipsFor(mixed, NOW)[1].text).toBe("Go through 2 with an agent");
    });
});

describe("ideaChipLogLine", () => {
    it("writes the chip, its position and its text on one line, in chatsuggest's key=value shape", () => {
        const line = ideaChipLogLine({ kind: "discuss", text: 'Discuss: say "hi"', ideaId: "i-1" }, 3);
        expect(line).toBe('sessionideas: pick chip=discuss at=3 text="Discuss: say \\"hi\\""');
        expect(line).not.toContain("\n");
    });
});

describe("scanEndToast", () => {
    const running = data({ scan: scan({ done: 3, total: 9 }) });
    const ended = (over: Partial<SessionIdeasScan> = {}) =>
        data({ scan: scan({ done: 9, total: 9, endedts: 2000, newideas: 2, ...over }) });

    it("says how many ideas a scan found, and in how many sessions it read, when it ends", () => {
        expect(scanEndToast(running, ended())).toBe("Session scan: 2 ideas to review, from 9 sessions");
    });

    it("uses the singular for one idea in one session", () => {
        expect(scanEndToast(running, ended({ newideas: 1, done: 1, total: 1 }))).toBe(
            "Session scan: 1 idea to review, from 1 session"
        );
    });

    it("says nothing when the scan found nothing", () => {
        expect(scanEndToast(running, ended({ newideas: 0 }))).toBeNull();
    });

    it("says nothing while the scan still runs", () => {
        expect(scanEndToast(data(), running)).toBeNull();
        expect(scanEndToast(running, data({ scan: scan({ done: 5, total: 9, newideas: 1 }) }))).toBeNull();
    });

    it("says nothing for the first read, which only shows a scan that ended before the app looked", () => {
        expect(scanEndToast(null, ended())).toBeNull();
    });

    it("says nothing for a scan it already told about", () => {
        expect(scanEndToast(ended(), ended())).toBeNull();
        // a later write to the store (a Keep) leaves the ended scan as it was
        expect(scanEndToast(ended(), data({ ...ended(), seents: 5 }))).toBeNull();
    });

    it("tells about a scan whose running state no read saw (reads that coalesced)", () => {
        expect(scanEndToast(data(), ended())).toBe("Session scan: 2 ideas to review, from 9 sessions");
        // the one before it ended long ago, and this is a new scan
        expect(scanEndToast(ended({ startedts: 500, endedts: 800 }), ended({ startedts: 5000, endedts: 6000 }))).toBe(
            "Session scan: 2 ideas to review, from 9 sessions"
        );
    });

    it("tells about a scan that stopped part way with ideas found, counting the sessions it read", () => {
        expect(
            scanEndToast(running, ended({ done: 4, total: 9, newideas: 3, error: "overloaded", stoppedat: 4 }))
        ).toBe("Session scan: 3 ideas to review, from 4 sessions");
    });
});

describe("keptSince", () => {
    const review = data({ ideas: [idea({ id: "a", state: "review" }), idea({ id: "b", state: "review" })] });

    it("is news when an idea turned kept", () => {
        const next = data({ ideas: [idea({ id: "a", state: "kept" }), idea({ id: "b", state: "review" })] });
        expect(keptSince(review, next)).toBe(true);
    });

    it("is not news when no idea turned kept: a drop, a scan's progress, or a kept idea already kept", () => {
        expect(
            keptSince(
                review,
                data({ ideas: [idea({ id: "a", state: "dropped" }), idea({ id: "b", state: "review" })] })
            )
        ).toBe(false);
        expect(keptSince(review, data({ ...review, scan: scan({ done: 2 }) }))).toBe(false);
        const kept = data({ ideas: [idea({ id: "a", state: "kept" })] });
        expect(keptSince(kept, kept)).toBe(false);
    });

    it("is not news on the first read", () => {
        expect(keptSince(null, data({ ideas: [idea({ id: "a", state: "kept" })] }))).toBe(false);
    });
});
