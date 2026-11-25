// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { describe, expect, it } from "vitest";
import {
    composerTarget,
    newCount,
    pairButtonLabel,
    pairOf,
    parseSeen,
    timelineRows,
    waitingOnJudge,
} from "./pairmodel";

const WORKER = "61483cd6-5c1e-4b2a-9d3f-1a2b3c4d5e6f";
const JUDGE = "4c6ba858-0d7e-4f31-8a90-b1c2d3e4f5a6";
const JUDGE2 = "9e0f1a2b-3c4d-4e5f-8a6b-7c8d9e0f1a2b";

const msg = (extra: Partial<PairMessage> & Pick<PairMessage, "id" | "from">): PairMessage => ({
    tab: "",
    ts: 1000,
    text: "",
    quote: "",
    replyto: "",
    to: "",
    held: [],
    ...extra,
});

function view(extra: Partial<PairView> = {}, judges: string[] = [JUDGE]): PairView {
    return {
        id: "p1",
        project: "mit-thesis",
        worker: { tab: WORKER, name: "Plan oracle-tightening", harness: "claude" },
        judges: judges.map((tab) => ({ tab, name: "Judge " + tab.slice(0, 4), harness: "claude" })),
        state: "relaying",
        stopreason: "",
        owed: false,
        messagecount: 0,
        lastts: 0,
        holdheavy: true,
        tokencap: 3_000_000,
        tokens: 0,
        note: "",
        createdts: 0,
        messages: [],
        decided: { asks: [], agreed: [], open: [] },
        ...extra,
    };
}

const conversation = (judges: string[] = [JUDGE]): PairView =>
    view(
        {
            messages: [
                msg({ id: "m1", from: "worker", tab: WORKER, ts: 1, text: "Plan v1" }),
                msg({
                    id: "m2",
                    from: "judge",
                    tab: JUDGE,
                    ts: 2,
                    text: "Finding one",
                    quote: "Plan v1",
                    replyto: "m1",
                }),
                msg({ id: "m3", from: "person", ts: 3, text: "Go on", to: "both" }),
                msg({ id: "m4", from: "system", ts: 4, text: "Paused: both agree" }),
            ],
        },
        judges
    );

describe("timelineRows", () => {
    it("gives one row per message, the worker on the left, the judge on the right, the person wide, a system line alone", () => {
        const rows = timelineRows(conversation());
        expect(rows.map((r) => [r.id, r.side])).toEqual([
            ["m1", "left"],
            ["m2", "right"],
            ["m3", "wide"],
            ["m4", "system"],
        ]);
    });

    it("heads each row with who spoke: the worker's name, Judge, You, and no one for a system line", () => {
        expect(timelineRows(conversation()).map((r) => r.who)).toEqual(["Plan oracle-tightening", "Judge", "You", ""]);
    });

    it("names the judge on a right-side message only when there are several judges", () => {
        expect(timelineRows(conversation())[1].judge).toBeNull();
        const two = timelineRows(
            view(
                {
                    messages: [
                        msg({ id: "a", from: "judge", tab: JUDGE }),
                        msg({ id: "b", from: "judge", tab: JUDGE2 }),
                        msg({ id: "c", from: "worker", tab: WORKER }),
                    ],
                },
                [JUDGE, JUDGE2]
            )
        );
        expect(two.map((r) => r.judge)).toEqual(["4c6ba858", "9e0f1a2b", null]);
    });

    it("carries the quoted line and the id of the message it answers", () => {
        const [first, second] = timelineRows(conversation());
        expect(first.quote).toBeNull();
        expect(first.quoteId).toBeNull();
        expect(second.quote).toBe("Plan v1");
        expect(second.quoteId).toBe("m1");
    });

    it("links no quote to a message that is not in the conversation", () => {
        const rows = timelineRows(
            view({
                messages: [msg({ id: "x", from: "judge", tab: JUDGE, quote: "Gone", replyto: "missing" })],
            })
        );
        expect(rows[0].quote).toBe("Gone");
        expect(rows[0].quoteId).toBeNull();
    });

    it("says whom the person's message went to, and nothing on any other row", () => {
        const toLabels = (to: string) =>
            timelineRows(view({ messages: [msg({ id: "p", from: "person", to })] }))[0].toLabel;
        expect(toLabels("both")).toBe("both");
        expect(toLabels("")).toBe("both");
        expect(toLabels("worker")).toBe("worker");
        expect(toLabels("judge")).toBe("judge");
        expect(toLabels(JUDGE)).toBe("judge 4c6ba858");
        expect(timelineRows(conversation()).map((r) => r.toLabel)).toEqual(["", "", "both", ""]);
    });

    it("keeps the held commands of a message, let through or not", () => {
        const held = [
            { command: "python study_pilot.py --tag benigngate_probe", ts: 5 },
            { command: "make all", ts: 6, runts: 7 },
        ];
        const rows = timelineRows(view({ messages: [msg({ id: "h", from: "worker", tab: WORKER, held })] }));
        expect(rows[0].held).toEqual(held);
    });

    it("reads null lists the wire may send as none", () => {
        const bad = view({
            messages: [{ ...msg({ id: "n", from: "worker", tab: WORKER }), held: null as unknown as PairHeld[] }],
        });
        expect(timelineRows(bad)[0].held).toEqual([]);
    });
});

describe("composerTarget", () => {
    const v = view({}, [JUDGE, JUDGE2]);

    it("sends to both when no @ starts the text", () => {
        expect(composerTarget("  keep going  ", v)).toEqual({ to: "both", text: "keep going" });
        expect(composerTarget("ask @worker later", v)).toEqual({ to: "both", text: "ask @worker later" });
    });

    it("reads @worker and @judge at the start", () => {
        expect(composerTarget("@worker run it", v)).toEqual({ to: "worker", text: "run it" });
        expect(composerTarget("@judge is 50% ok?", v)).toEqual({ to: "judge", text: "is 50% ok?" });
        expect(composerTarget("@WORKER hi", v)).toEqual({ to: "worker", text: "hi" });
    });

    it("reads @<judge short id> as that judge's tab", () => {
        expect(composerTarget("@9e0f1a2b look again", v)).toEqual({ to: JUDGE2, text: "look again" });
        expect(composerTarget("@4c6ba858\nand here", v)).toEqual({ to: JUDGE, text: "and here" });
    });

    it("leaves an @ it does not know in the text, for both", () => {
        expect(composerTarget("@nobody hi", v)).toEqual({ to: "both", text: "@nobody hi" });
        expect(composerTarget("@judges hi", v)).toEqual({ to: "both", text: "@judges hi" });
    });

    it("leaves no text after a bare target", () => {
        expect(composerTarget("@worker", v)).toEqual({ to: "worker", text: "" });
    });
});

describe("newCount", () => {
    const v = conversation();

    it("counts the messages past the ones the person saw, not their own", () => {
        expect(newCount(v, 0)).toBe(3);
        expect(newCount(v, 1)).toBe(2);
        expect(newCount(v, 2)).toBe(1);
        expect(newCount(v, 3)).toBe(1);
        expect(newCount(v, 4)).toBe(0);
    });

    it("is zero when the person has seen more than there is", () => {
        expect(newCount(v, 9)).toBe(0);
    });
});

describe("pairButtonLabel", () => {
    const v = conversation();

    it("names the judge and the new messages on the working agent's button", () => {
        expect(pairButtonLabel(v, "worker", 2)).toBe("Paired with judge 4c6ba858 · 1 new");
        expect(pairButtonLabel(v, "worker", 0)).toBe("Paired with judge 4c6ba858 · 3 new");
    });

    it("leaves the count off when nothing is new", () => {
        expect(pairButtonLabel(v, "worker", 4)).toBe("Paired with judge 4c6ba858");
    });

    it("counts the judges when there are several", () => {
        expect(pairButtonLabel(conversation([JUDGE, JUDGE2]), "worker", 4)).toBe("Paired with 2 judges");
    });

    it("names the working agent on a judge's button, with no count", () => {
        expect(pairButtonLabel(v, "judge", 0)).toBe("Judging 61483cd6");
    });
});

describe("waitingOnJudge", () => {
    const info = (extra: Partial<PairInfo>): PairInfo => view(extra);

    it("is true while a judge owes an answer, relaying or stopped (the hold applies to both)", () => {
        expect(waitingOnJudge(info({ owed: true }))).toBe(true);
        expect(waitingOnJudge(info({ owed: true, state: "stopped", stopreason: "token-cap" }))).toBe(true);
    });

    it("is false when no judge owes, or the pair has ended", () => {
        expect(waitingOnJudge(info({ owed: false }))).toBe(false);
        expect(waitingOnJudge(info({ owed: false, state: "stopped", stopreason: "settled" }))).toBe(false);
        expect(waitingOnJudge(info({ owed: true, state: "ended" }))).toBe(false);
    });
});

describe("parseSeen", () => {
    it("keeps the counts that are whole numbers", () => {
        expect(parseSeen({ p1: 3, p2: 0 })).toEqual({ p1: 3, p2: 0 });
    });

    it("drops anything else, and reads a value that is no object as nothing seen", () => {
        expect(parseSeen({ p1: 3, p2: -1, p3: 1.5, p4: "2", p5: null })).toEqual({ p1: 3 });
        expect(parseSeen(null)).toEqual({});
        expect(parseSeen([4])).toEqual({});
        expect(parseSeen("p1")).toEqual({});
    });
});

describe("pairOf", () => {
    const pairs: PairInfo[] = [view({ id: "ended", state: "ended" }, [JUDGE]), view({ id: "live" }, [JUDGE, JUDGE2])];

    it("finds the pair a tab works in, with its role", () => {
        expect(pairOf(pairs, WORKER)).toEqual({ pair: pairs[1], role: "worker" });
    });

    it("finds the pair a tab judges in, with its role", () => {
        expect(pairOf(pairs, JUDGE2)).toEqual({ pair: pairs[1], role: "judge" });
    });

    it("skips an ended pair, and finds none for a tab in no pair or no tab", () => {
        expect(pairOf([pairs[0]], WORKER)).toBeNull();
        expect(pairOf(pairs, "somebody")).toBeNull();
        expect(pairOf(pairs, null)).toBeNull();
        expect(pairOf(pairs, "")).toBeNull();
    });
});
