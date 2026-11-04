import { describe, expect, it } from "vitest";
import {
    cardKicker,
    chosenLine,
    chotText,
    directionHow,
    memoryDot,
    memoryEmpty,
    replacedRows,
    shownCard,
} from "./councilmemorymodel";

const clock = (h: number, m: number) => new Date(2026, 10, 4, h, m).getTime();

const experts: CouncilExpert[] = [
    { id: "ux", name: "UX", brief: "", model: "sonnet" },
    { id: "ram", name: "RAM", brief: "", model: "sonnet" },
    { id: "coordinator", name: "Coordinator", brief: "", model: "opus", coordinator: true },
];

const prop = (id: string, author: string, extra: Partial<CouncilProposal> = {}): CouncilProposal => ({
    id,
    author,
    title: `title ${id}`,
    argument: `argument ${id}`,
    ts: clock(9, 0),
    ...extra,
});

const reply = (id: string, author: string, extra: Partial<CouncilReply> = {}): CouncilReply => ({
    id,
    proposalid: "",
    author,
    text: `text ${id}`,
    round: 2,
    ts: clock(9, 30),
    ...extra,
});

const council = (extra: Partial<Council> = {}): Council => ({
    id: "c1",
    project: "D:\\code\\arc",
    feature: "Rail apps",
    question: "Which changes to the rail are worth making first?",
    experts,
    rounds: 2,
    state: "done",
    round: 2,
    started: clock(9, 0),
    proposals: [],
    replies: [],
    tokens: 0,
    calls: 0,
    created: 0,
    updated: 0,
    ...extra,
});

const direction = (extra: Partial<CouncilMemoryDirection> = {}): CouncilMemoryDirection => ({
    text: "Ship B first",
    how: "pin",
    at: clock(10, 5),
    ...extra,
});

const suggestion = (extra: Partial<CouncilMemoryCard> = {}): CouncilMemoryCard => ({
    kind: "suggestion",
    text: "Go with B",
    source: "check",
    round: 2,
    at: clock(10, 20),
    ...extra,
});

const held = (extra: Partial<CouncilMemoryCard> = {}): CouncilMemoryCard => ({
    kind: "held",
    text: "Drop the rail",
    reason: "the seats agreed to keep it",
    how: "written",
    at: clock(10, 30),
    ...extra,
});

describe("shownCard, memoryDot and memoryEmpty", () => {
    it("shows no card, no dot and the empty state for a council with no memory", () => {
        const c = council();
        expect(shownCard(c)).toBeUndefined();
        expect(memoryDot(c)).toBe(false);
        expect(memoryEmpty(c)).toBe(true);
    });

    it("shows the suggestion when only a suggestion waits", () => {
        const c = council({ memory: { suggestion: suggestion() } });
        expect(shownCard(c)?.kind).toBe("suggestion");
        expect(memoryDot(c)).toBe(true);
        expect(memoryEmpty(c)).toBe(false);
    });

    it("shows the held card when only a held card waits", () => {
        const c = council({ memory: { held: held() } });
        expect(shownCard(c)?.kind).toBe("held");
        expect(memoryDot(c)).toBe(true);
        expect(memoryEmpty(c)).toBe(false);
    });

    it("shows the held card first, and keeps the suggestion behind it", () => {
        const c = council({ memory: { held: held(), suggestion: suggestion() } });
        expect(shownCard(c)?.text).toBe("Drop the rail");
        expect(memoryDot(c)).toBe(true);
        // once the held card is settled the suggestion that waited behind it shows
        const settled = council({ memory: { suggestion: suggestion() } });
        expect(shownCard(settled)?.text).toBe("Go with B");
    });

    it("has no dot with only a chosen direction, and is not empty", () => {
        const c = council({ memory: { chosen: direction() } });
        expect(shownCard(c)).toBeUndefined();
        expect(memoryDot(c)).toBe(false);
        expect(memoryEmpty(c)).toBe(false);
    });

    it("is empty again once the direction was unpinned and nothing waits, however many it replaced", () => {
        const c = council({
            memory: { changed: clock(11, 0), replaced: [direction({ replaced: clock(11, 0), ended: "unpinned" })] },
        });
        expect(memoryEmpty(c)).toBe(true);
        expect(memoryDot(c)).toBe(false);
        expect(memoryEmpty(council({ memory: {} }))).toBe(true);
    });

    it("is not empty with a card waiting and no direction", () => {
        expect(memoryEmpty(council({ memory: { held: held() } }))).toBe(false);
    });
});

describe("cardKicker", () => {
    it("names a check suggestion by its round, and says the chat may have moved", () => {
        expect(cardKicker(suggestion({ source: "check", round: 2 }))).toBe(
            "Suggested after round 2 · the chat may have moved"
        );
        expect(cardKicker(suggestion({ source: "check", round: 1 }))).toBe(
            "Suggested after round 1 · the chat may have moved"
        );
    });

    it("leaves the round out of a check suggestion that holds none", () => {
        expect(cardKicker(suggestion({ source: "check", round: undefined }))).toBe(
            "Suggested · the chat may have moved"
        );
        expect(cardKicker(suggestion({ source: "check", round: 0 }))).toBe("Suggested · the chat may have moved");
    });

    it("says every seat agreed for an all green suggestion", () => {
        expect(cardKicker(suggestion({ source: "green", round: undefined, from: "P3" }))).toBe(
            "Suggested · every seat agreed"
        );
    });

    it("says a held card may clash with what the seats agreed, whatever it was set by", () => {
        expect(cardKicker(held())).toBe("Held · this may clash with what the seats agreed");
        expect(cardKicker(held({ how: "pin", from: "r7", edited: true }))).toBe(
            "Held · this may clash with what the seats agreed"
        );
    });

    it("falls back to a plain Suggested for a suggestion of no known source", () => {
        expect(cardKicker(suggestion({ source: undefined, round: undefined }))).toBe("Suggested");
    });
});

describe("directionHow", () => {
    it("says who set a pinned and a written direction", () => {
        expect(directionHow(direction({ how: "pin" }))).toBe("Pinned by you");
        expect(directionHow(direction({ how: "written" }))).toBe("Written by you");
    });

    it("names the round of an accepted check suggestion", () => {
        expect(directionHow(direction({ how: "suggested", source: "check", round: 3 }))).toBe(
            "Accepted from the check after round 3"
        );
        expect(directionHow(direction({ how: "suggested", source: "check" }))).toBe("Accepted from the check");
    });

    it("says every seat agreed for an accepted all green suggestion", () => {
        expect(directionHow(direction({ how: "suggested", source: "green", from: "P3" }))).toBe(
            "Accepted: every seat agreed"
        );
    });

    it("never leaves a direction of an unknown way unnamed", () => {
        expect(directionHow(direction({ how: "suggested" }))).toBe("Accepted");
        expect(directionHow(direction({ how: "" }))).toBe("Set by you");
    });
});

describe("chosenLine", () => {
    const c = council({
        proposals: [prop("P1", "ux"), prop("P2", "ram", { ts: clock(9, 5) }), prop("P3", "ux", { ts: clock(9, 10) })],
        replies: [
            reply("r7", "ram", { proposalid: "P2" }),
            reply("r8", "you"),
            reply("r9", "ux", { proposalid: "P1", draft: "dropped" }),
        ],
    });

    it("gives the way it was set, its time and the idea it came from", () => {
        expect(chosenLine(c, direction({ how: "pin", from: "P2", at: clock(10, 5) }))).toEqual({
            how: "Pinned by you",
            time: "10:05",
            source: { kind: "idea", id: "P2", thread: "P2", label: "Idea 2" },
        });
    });

    it("links a message by the thread it sits in, and the Chat for one tied to no idea", () => {
        expect(chosenLine(c, direction({ from: "r7" })).source).toEqual({
            kind: "message",
            id: "r7",
            thread: "P2",
            label: "RAM's message",
        });
        expect(chosenLine(c, direction({ from: "r8" })).source).toEqual({
            kind: "message",
            id: "r8",
            thread: "chat",
            label: "Your message",
        });
    });

    it("has no source for a written direction, nor one whose item is gone", () => {
        expect(chosenLine(c, direction({ how: "written" })).source).toBeNull();
        expect(chosenLine(c, direction({ from: "P9" })).source).toBeNull();
        // a dropped reply is no message a person can reach
        expect(chosenLine(c, direction({ from: "r9" })).source).toBeNull();
    });

    it("words an accepted check suggestion and an all green one", () => {
        expect(chosenLine(c, direction({ how: "suggested", source: "check", round: 2, from: "r7" })).how).toBe(
            "Accepted from the check after round 2"
        );
        const green = chosenLine(c, direction({ how: "suggested", source: "green", from: "P3" }));
        expect(green.how).toBe("Accepted: every seat agreed");
        expect(green.source?.label).toBe("Idea 3");
    });
});

describe("replacedRows", () => {
    it("lists the replaced directions newest first, each with how it was set, how it ended and when", () => {
        const c = council({
            memory: {
                chosen: direction({ text: "C" }),
                replaced: [
                    direction({ text: "A", how: "pin", at: clock(9, 0), replaced: clock(9, 40), ended: "replaced" }),
                    direction({
                        text: "B",
                        how: "suggested",
                        source: "check",
                        round: 1,
                        at: clock(9, 40),
                        replaced: clock(10, 5),
                        ended: "edited",
                    }),
                ],
            },
        });
        expect(replacedRows(c)).toEqual([
            {
                text: "B",
                how: "Accepted from the check after round 1",
                ended: "edited",
                time: "10:05",
                line: "Accepted from the check after round 1 · edited 10:05",
            },
            {
                text: "A",
                how: "Pinned by you",
                ended: "replaced",
                time: "09:40",
                line: "Pinned by you · replaced 09:40",
            },
        ]);
    });

    it("sorts by when it left, whatever order the record keeps, and keeps a tie in the record's order", () => {
        const c = council({
            memory: {
                replaced: [
                    direction({ text: "old", replaced: clock(9, 0), ended: "replaced" }),
                    direction({ text: "new", replaced: clock(10, 0), ended: "unpinned" }),
                    direction({ text: "tie 1", replaced: clock(9, 30), ended: "replaced" }),
                    direction({ text: "tie 2", replaced: clock(9, 30), ended: "replaced" }),
                ],
            },
        });
        expect(replacedRows(c).map((r) => r.text)).toEqual(["new", "tie 1", "tie 2", "old"]);
        expect(replacedRows(c)[0]).toMatchObject({ ended: "unpinned", line: "Pinned by you · unpinned 10:00" });
    });

    it("calls a direction that left with no recorded end replaced, and is empty with nothing replaced", () => {
        const c = council({ memory: { replaced: [direction({ text: "A", replaced: clock(9, 0) })] } });
        expect(replacedRows(c)[0]).toMatchObject({ ended: "replaced", time: "09:00" });
        expect(replacedRows(council())).toEqual([]);
        expect(replacedRows(council({ memory: { chosen: direction() } }))).toEqual([]);
    });
});

describe("chotText", () => {
    it("is an idea's title", () => {
        expect(chotText(prop("P1", "ux", { title: "  Pin apps to the rail  " }))).toBe("Pin apps to the rail");
    });

    it("is a message's text on one line", () => {
        expect(chotText(reply("r1", "ram", { text: "Ship B first.\n\nIt costs less,\n  and the seats agree." }))).toBe(
            "Ship B first. It costs less, and the seats agree."
        );
    });

    it("cuts a long message to one line with an ellipsis, and leaves a short one whole", () => {
        const long = reply("r1", "ram", { text: "word ".repeat(100) });
        const cut = chotText(long);
        expect(cut.length).toBeLessThanOrEqual(200);
        expect(cut.endsWith("…")).toBe(true);
        expect(cut).not.toContain("\n");
        const edge = "x".repeat(200);
        expect(chotText(reply("r2", "ram", { text: edge }))).toBe(edge);
    });

    it("is empty for a message with no text, such as an agreement with nothing to add", () => {
        expect(chotText(reply("r1", "ram", { text: "  \n " }))).toBe("");
    });
});
