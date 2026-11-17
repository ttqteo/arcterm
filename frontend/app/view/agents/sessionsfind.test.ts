// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { globalStore } from "@/app/store/jotaiStore";
import { atom } from "jotai";
import { afterEach, describe, expect, it } from "vitest";
import type { AgentsViewModel } from "./agents";
import type { LiveSession } from "./sessionsarchivestore";
import {
    findEnded,
    findRanges,
    findTerms,
    foldedText,
    foundSession,
    hitSelection,
    needsCentre,
    openSessionHit,
    sessionFindAtom,
    sessionFoundAtom,
    stepFind,
    type SessionFind,
} from "./sessionsfind";
import { LEAD_MEMBER, sessionKey, sessionSelection } from "./sessionsruns";

function fakeModel() {
    return {
        sessionsSelAtom: atom<string>("all"),
        sessionsMemberAtom: atom<string>("lead"),
        sessionsViewAtom: atom<"transcript" | "activity">("transcript"),
    } as unknown as AgentsViewModel;
}

function session(over: Partial<SessionActivity> = {}): SessionActivity {
    return {
        id: "s1",
        runtime: "claude",
        projectpath: "/p",
        projectname: "p",
        lastactivets: 1,
        status: "done",
        startedts: 0,
        durationms: 0,
        events: [],
        ...over,
    } as SessionActivity;
}

function hit(kind: "turn" | "event", ord: number): SessionHit {
    return { kind, speaker: kind === "turn" ? "agent" : "committed", ord, text: "x", marks: [[0, 1]] };
}

function result(s: SessionActivity, hits: SessionHit[]): SessionSearchResult {
    return {
        session: s,
        hits,
        turnhits: hits.filter((h) => h.kind === "turn").length,
        eventhits: hits.filter((h) => h.kind === "event").length,
    };
}

afterEach(() => {
    globalStore.set(sessionFindAtom, null);
    globalStore.set(sessionFoundAtom, null);
});

describe("hitSelection", () => {
    it("selects a solo session's key and reads a turn hit on the transcript", () => {
        const r = result(session(), [hit("turn", 0), hit("turn", 1), hit("turn", 2), hit("event", 0)]);
        expect(hitSelection(r, r.hits[2])).toEqual({
            sel: "claude:s1",
            view: "transcript",
            target: { kind: "turn", ord: 2 },
        });
    });

    it("defaults to the first hit", () => {
        const r = result(session(), [hit("turn", 4), hit("turn", 9)]);
        expect(hitSelection(r).target).toEqual({ kind: "turn", ord: 4 });
    });

    it("opens the activity view when the first hit is an event", () => {
        const r = result(session(), [hit("event", 3), hit("turn", 0)]);
        const to = hitSelection(r);
        expect(to.view).toBe("activity");
        expect(to.target).toEqual({ kind: "event", ord: 3 });
    });

    it("targets turn 0 on the transcript when there are no hits", () => {
        const to = hitSelection(result(session(), []));
        expect(to.view).toBe("transcript");
        expect(to.target).toEqual({ kind: "turn", ord: 0 });
    });

    it("an explicit hit wins over the first one", () => {
        const r = result(session(), [hit("turn", 0), hit("event", 5)]);
        const to = hitSelection(r, r.hits[1]);
        expect(to.view).toBe("activity");
        expect(to.target).toEqual({ kind: "event", ord: 5 });
    });

    it("selects a run worker's session through its run and member", () => {
        const r = result(session({ runid: "r9", role: "worker", taskid: "t-2" }), [hit("turn", 0)]);
        const to = hitSelection(r);
        expect(to.sel).toBe("run:r9");
        expect(to.member).toBe("t-2");
    });

    it("leaves a solo session's member unset", () => {
        expect("member" in hitSelection(result(session(), [hit("turn", 0)]))).toBe(false);
    });
});

describe("openSessionHit", () => {
    it("opens a solo turn hit on the transcript", () => {
        const m = fakeModel();
        const r = result(session(), [hit("turn", 0), hit("turn", 1), hit("turn", 2), hit("event", 0)]);
        openSessionHit(m, r, "flaky test", ["flaky", "test"], r.hits[2]);
        expect(globalStore.get(m.sessionsSelAtom)).toBe("claude:s1");
        expect(globalStore.get(m.sessionsViewAtom)).toBe("transcript");
        expect(globalStore.get(sessionFindAtom)).toEqual({
            sessionKey: "claude:s1",
            query: "flaky test",
            terms: ["flaky", "test"],
            target: { kind: "turn", ord: 2 },
            at: { sel: "claude:s1" },
        });
    });

    it("opens an event hit on the activity view", () => {
        const m = fakeModel();
        const r = result(session(), [hit("event", 3)]);
        openSessionHit(m, r, "fix", ["fix"], r.hits[0]);
        expect(globalStore.get(m.sessionsViewAtom)).toBe("activity");
        expect(globalStore.get(sessionFindAtom)?.target).toEqual({ kind: "event", ord: 3 });
    });

    it("opens a run member inside its run", () => {
        const m = fakeModel();
        const r = result(session({ runid: "r9", role: "worker", taskid: "t-2" }), [hit("turn", 0)]);
        openSessionHit(m, r, "fix", ["fix"]);
        expect(globalStore.get(m.sessionsSelAtom)).toBe("run:r9");
        expect(globalStore.get(m.sessionsMemberAtom)).toBe("t-2");
        expect(globalStore.get(sessionFindAtom)?.sessionKey).toBe("claude:s1");
    });

    it("leaves the member alone for a solo session", () => {
        const m = fakeModel();
        globalStore.set(m.sessionsMemberAtom, "t-7");
        openSessionHit(m, result(session(), [hit("turn", 0)]), "fix", ["fix"]);
        expect(globalStore.get(m.sessionsMemberAtom)).toBe("t-7");
    });

    it("shows the run member's session the hit is in, not its default one", () => {
        const m = fakeModel();
        const worker = session({ id: "w2", runid: "r9", role: "worker", taskid: "t-2" });
        const reviewer = session({ id: "rv", runid: "r9", role: "review", taskid: "t-2" });
        openSessionHit(m, result(reviewer, [hit("turn", 0)]), "fix", ["fix"]);
        const find = globalStore.get(sessionFindAtom);
        const sel = globalStore.get(m.sessionsSelAtom);
        const member = globalStore.get(m.sessionsMemberAtom);
        expect(foundSession(find, sel, member, [worker, reviewer] as LiveSession[])).toBe(reviewer);
        // another member selected: the find no longer applies
        expect(foundSession(find, sel, "t-3", [worker, reviewer] as LiveSession[])).toBeUndefined();
    });

    it("keeps the hit's session in view once the find bar is closed", () => {
        const m = fakeModel();
        const worker = session({ id: "w2", runid: "r9", role: "worker", taskid: "t-2" });
        const reviewer = session({ id: "rv", runid: "r9", role: "review", taskid: "t-2" });
        openSessionHit(m, result(reviewer, [hit("turn", 0)]), "fix", ["fix"]);
        globalStore.set(sessionFindAtom, null);
        const sel = globalStore.get(m.sessionsSelAtom);
        const member = globalStore.get(m.sessionsMemberAtom);
        expect(foundSession(globalStore.get(sessionFoundAtom), sel, member, [worker, reviewer] as LiveSession[])).toBe(
            reviewer
        );
    });

    it("with no hits targets turn 0 on the transcript", () => {
        const m = fakeModel();
        globalStore.set(m.sessionsViewAtom, "activity");
        openSessionHit(m, result(session(), []), "fix", ["fix"]);
        expect(globalStore.get(m.sessionsViewAtom)).toBe("transcript");
        expect(globalStore.get(sessionFindAtom)?.target).toEqual({ kind: "turn", ord: 0 });
    });
});

describe("foundSession", () => {
    it("is undefined for a solo session, which shows itself", () => {
        const m = fakeModel();
        const solo = session();
        openSessionHit(m, result(solo, [hit("turn", 0)]), "fix", ["fix"]);
        expect(foundSession(globalStore.get(sessionFindAtom), "claude:s1", "lead", [solo] as LiveSession[])).toBe(
            undefined
        );
    });

    it("is undefined with no find, and when the run does not hold the session", () => {
        const worker = session({ id: "w2", runid: "r9", role: "worker", taskid: "t-2" });
        expect(foundSession(null, "run:r9", "t-2", [worker] as LiveSession[])).toBeUndefined();
        const m = fakeModel();
        openSessionHit(m, result(worker, [hit("turn", 0)]), "fix", ["fix"]);
        expect(foundSession(globalStore.get(sessionFindAtom), "run:r9", "t-2", [])).toBeUndefined();
    });
});

describe("stepFind", () => {
    it("wraps both ways", () => {
        expect(stepFind(1, 4, 1)).toBe(2);
        expect(stepFind(3, 4, 1)).toBe(0);
        expect(stepFind(0, 4, -1)).toBe(3);
        expect(stepFind(2, 4, -1)).toBe(1);
    });

    it("with no matches stays 0", () => {
        expect(stepFind(0, 0, 1)).toBe(0);
        expect(stepFind(0, 0, -1)).toBe(0);
    });
});

describe("findRanges", () => {
    const slices = (text: string, terms: string[]) => findRanges(text, terms).map(([s, e]) => text.slice(s, e));

    it("finds every term case-insensitively in order", () => {
        const text = "Timeout in the HOOK, then another timeout";
        expect(findRanges(text, ["hook", "timeout"])).toEqual([
            [0, 7],
            [15, 19],
            [34, 41],
        ]);
        expect(findRanges(text, ["zebra"])).toEqual([]);
    });

    it("treats a phrase as one term", () => {
        expect(slices("Dial timeout, then timeout dial", ["dial timeout"])).toEqual(["Dial timeout"]);
    });

    it("keeps offsets right after an emoji and with diacritics", () => {
        const text = "🙂 Lỗi kết nối, lỗi";
        expect(slices(text, ["lỗi"])).toEqual(["Lỗi", "lỗi"]);
        expect(findRanges(text, ["lỗi"])[0]).toEqual([3, 6]);
    });

    it("merges overlapping terms", () => {
        expect(findRanges("a timeout", ["time", "timeout"])).toEqual([[2, 9]]);
    });

    it("resumes past each occurrence and keeps touching ranges apart", () => {
        expect(findRanges("aaaa", ["aa"])).toEqual([
            [0, 2],
            [2, 4],
        ]);
        expect(findRanges("aaa", ["aa"])).toEqual([[0, 2]]);
    });

    it("skips an empty term", () => {
        expect(findRanges("abc", [""])).toEqual([]);
    });

    it("keeps offsets right past a character whose fold is longer (İ)", () => {
        const text = "İstanbul istanbul";
        expect(findRanges(text, ["istanbul"])).toEqual([[9, 17]]);
        expect(slices(text, ["stan"])).toEqual(["stan", "stan"]);
    });

    it("folds a word-final Σ to σ, as Go does, and leaves a written ς alone", () => {
        expect(slices("ΟΔΟΣ οδος", ["οδοσ"])).toEqual(["ΟΔΟΣ"]);
        expect(slices("ΟΔΟΣ οδος", ["οδος"])).toEqual(["οδος"]);
    });

    it("folds the whole text as a fold one character at a time does", () => {
        const perChar = (s: string) => [...s].map((c) => c.toLowerCase()).join("");
        for (const s of ["ΟΔΟΣ Σ ΑΣ.", "Lỗi KẾT nối 🙂 ẞ Ǆ", "İ and I", "plain ascii TEXT", "ὈΔΥΣΣΕΎΣ"]) {
            expect(foldedText(s)).toBe(perChar(s));
        }
    });
});

describe("findTerms", () => {
    it("splits words and keeps a quoted phrase", () => {
        expect(findTerms("Hook  Timeout")).toEqual(["hook", "timeout"]);
        expect(findTerms('"dial timeout" warm')).toEqual(["dial timeout", "warm"]);
        expect(findTerms('"open')).toEqual(["open"]);
        // as ParseQuery: an unclosed quote is dropped and the rest read as words, not one phrase
        expect(findTerms('"dial timeout')).toEqual(["dial", "timeout"]);
        expect(findTerms('"a b" "dial timeout')).toEqual(["a b", "dial", "timeout"]);
    });

    it("of an empty or bare-quote query is empty", () => {
        for (const q of ["", "   ", '"', '""']) {
            expect(findTerms(q)).toEqual([]);
        }
    });
});

describe("findEnded", () => {
    const worker = session({ id: "w1", runid: "r9", role: "worker", taskid: "t-2" });
    const solo = session({ id: "a" });
    const findOf = (s: SessionActivity): SessionFind => {
        openSessionHit(fakeModel(), result(s, [hit("turn", 0)]), "fix", ["fix"]);
        return globalStore.get(sessionFindAtom)!;
    };

    it("keeps a find whose run member was just selected", () => {
        const to = sessionSelection(worker);
        expect(findEnded(findOf(worker), to.sel, to.member!)).toBe(false);
    });

    it("keeps a find whose solo was just selected", () => {
        // the member atom keeps whatever run member was last in view; a solo selection ignores it
        expect(findEnded(findOf(solo), sessionSelection(solo).sel, "t-7")).toBe(false);
    });

    it("ends a find when another session is selected", () => {
        expect(findEnded(findOf(solo), sessionKey(session({ id: "b" })), "lead")).toBe(true);
        expect(findEnded(findOf(worker), sessionSelection(worker).sel, LEAD_MEMBER)).toBe(true);
        expect(findEnded(findOf(worker), sessionKey(solo), "t-2")).toBe(true);
    });

    it("leaves a find set on the merged feed", () => {
        expect(findEnded(findOf(solo), "all", "lead")).toBe(false);
    });

    it("is false with no find", () => {
        expect(findEnded(null, "claude:a", "lead")).toBe(false);
    });
});

describe("needsCentre", () => {
    const find = { sessionKey: "s", query: "auth", terms: ["auth"] } as unknown as SessionFind;
    const mark = { find, terms: '["auth"]', pos: 2, limit: 2000 };

    it("centres the first time a match is drawn", () => {
        expect(needsCentre(null, mark)).toBe(true);
    });

    it("leaves the view alone when a reread redraws the same match", () => {
        expect(needsCentre(mark, { ...mark })).toBe(false);
    });

    it("moves to a stepped match, refined terms or a new find", () => {
        expect(needsCentre(mark, { ...mark, pos: 3 })).toBe(true);
        expect(needsCentre(mark, { ...mark, terms: '["auth","token"]' })).toBe(true);
        expect(needsCentre(mark, { ...mark, find: { ...find } })).toBe(true);
    });

    it("re-centres when a longer read replaces the transcript under the same match position", () => {
        expect(needsCentre(mark, { ...mark, limit: -1 })).toBe(true);
    });
});
