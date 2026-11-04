import { describe, expect, it } from "vitest";
import {
    ADD_KINDS,
    cardKicker,
    cardLinks,
    chosenLine,
    chotLine,
    chotText,
    directionHow,
    directionSource,
    entryDetails,
    KIND_LABEL,
    KIND_MEANING,
    kindTakesWhy,
    latestEntryAt,
    memoryCount,
    memoryDotOn,
    memoryEntries,
    memoryIsEmpty,
    memoryTabLabel,
    newEntryIds,
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

describe("shownCard, the dot and the empty state", () => {
    it("shows no card, no dot and the empty state for a council with no memory", () => {
        const c = council();
        expect(shownCard(c)).toBeUndefined();
        expect(memoryDotOn(c, undefined)).toBe(false);
        expect(memoryIsEmpty(c)).toBe(true);
    });

    it("shows the suggestion when only a suggestion waits", () => {
        const c = council({ memory: { suggestion: suggestion() } });
        expect(shownCard(c)?.kind).toBe("suggestion");
        expect(memoryDotOn(c, undefined)).toBe(true);
        expect(memoryIsEmpty(c)).toBe(false);
    });

    it("shows the held card when only a held card waits", () => {
        const c = council({ memory: { held: held() } });
        expect(shownCard(c)?.kind).toBe("held");
        expect(memoryDotOn(c, undefined)).toBe(true);
        expect(memoryIsEmpty(c)).toBe(false);
    });

    it("shows the held card first, and keeps the suggestion behind it", () => {
        const c = council({ memory: { held: held(), suggestion: suggestion() } });
        expect(shownCard(c)?.text).toBe("Drop the rail");
        expect(memoryDotOn(c, undefined)).toBe(true);
        // once the held card is settled the suggestion that waited behind it shows
        const settled = council({ memory: { suggestion: suggestion() } });
        expect(shownCard(settled)?.text).toBe("Go with B");
    });

    it("has no dot with only a chosen direction, and is not empty", () => {
        const c = council({ memory: { chosen: direction() } });
        expect(shownCard(c)).toBeUndefined();
        expect(memoryDotOn(c, undefined)).toBe(false);
        expect(memoryIsEmpty(c)).toBe(false);
    });

    it("is empty again once the direction was unpinned and nothing waits, however many it replaced", () => {
        const c = council({
            memory: { changed: clock(11, 0), replaced: [direction({ replaced: clock(11, 0), ended: "unpinned" })] },
        });
        expect(memoryIsEmpty(c)).toBe(true);
        expect(memoryDotOn(c, undefined)).toBe(false);
        expect(memoryIsEmpty(council({ memory: {} }))).toBe(true);
    });

    it("is not empty with a card waiting and no direction", () => {
        expect(memoryIsEmpty(council({ memory: { held: held() } }))).toBe(false);
    });
});

describe("cardKicker", () => {
    it("calls a check suggestion a suggested direction", () => {
        expect(cardKicker(suggestion({ source: "check", round: 2 }))).toBe("Suggested direction");
        expect(cardKicker(suggestion({ source: "check", round: 1 }))).toBe("Suggested direction");
    });

    it("reads the same for a check suggestion that holds no round", () => {
        expect(cardKicker(suggestion({ source: "check", round: undefined }))).toBe("Suggested direction");
        expect(cardKicker(suggestion({ source: "check", round: 0 }))).toBe("Suggested direction");
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
            "Accepted · auto after round 3"
        );
        expect(directionHow(direction({ how: "suggested", source: "check" }))).toBe("Accepted · auto");
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
            "Accepted · auto after round 2"
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
                how: "Accepted · auto after round 1",
                ended: "edited",
                time: "10:05",
                line: "edited 10:05",
            },
            {
                text: "A",
                how: "Pinned by you",
                ended: "replaced",
                time: "09:40",
                line: "replaced 09:40",
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
        expect(replacedRows(c)[0]).toMatchObject({ ended: "unpinned", line: "unpinned 10:00" });
    });

    it("calls a direction that left with no recorded end replaced, and is empty with nothing replaced", () => {
        const c = council({ memory: { replaced: [direction({ text: "A", replaced: clock(9, 0) })] } });
        expect(replacedRows(c)[0]).toMatchObject({ ended: "replaced", time: "09:00" });
        expect(replacedRows(council())).toEqual([]);
        expect(replacedRows(council({ memory: { chosen: direction() } }))).toEqual([]);
    });
});

const entry = (id: string, kind: string, extra: Partial<CouncilMemoryEntry> = {}): CouncilMemoryEntry => ({
    id,
    kind,
    text: `text ${id}`,
    by: "you",
    at: clock(10, 0),
    ...extra,
});

describe("KIND_LABEL and KIND_MEANING", () => {
    it("words the four kinds as the badges and tooltips read", () => {
        expect(KIND_LABEL).toEqual({ direction: "Direction", agreed: "Agreed", ruledout: "Ruled out", open: "Open" });
        expect(KIND_MEANING.direction).toBe("What the council will do. The seats follow it over the Report.");
        expect(KIND_MEANING.agreed).toBe("Settled as true. The seats do not argue it again.");
        expect(KIND_MEANING.ruledout).toBe("Dropped. The seats do not bring it back without something new.");
        expect(KIND_MEANING.open).toBe("Still to settle. The seats work on it next.");
    });
});

describe("memoryEntries", () => {
    it("lists the entries newest first, a tie by the later id", () => {
        const c = council({
            memory: {
                entries: [
                    entry("m1", "agreed", { at: clock(10, 0) }),
                    entry("m2", "open", { at: clock(10, 30) }),
                    entry("m3", "ruledout", { at: clock(10, 0) }),
                    entry("m10", "agreed", { at: clock(10, 0) }),
                ],
            },
        });
        expect(memoryEntries(c).map((e) => e.id)).toEqual(["m2", "m10", "m3", "m1"]);
    });

    it("leaves out an entry of a kind it does not know, and does not touch the record's order", () => {
        const entries = [
            entry("m1", "agreed", { at: 1 }),
            entry("m2", "weird", { at: 2 }),
            entry("m3", "open", { at: 3 }),
        ];
        const c = council({ memory: { entries } });
        expect(memoryEntries(c).map((e) => e.id)).toEqual(["m3", "m1"]);
        expect(entries.map((e) => e.id)).toEqual(["m1", "m2", "m3"]);
    });

    it("is empty for a council with no entries", () => {
        expect(memoryEntries(council())).toEqual([]);
        expect(memoryEntries(council({ memory: {} }))).toEqual([]);
    });
});

describe("memoryCount", () => {
    it("counts the entries and one for a chosen direction", () => {
        const entries = [entry("m1", "agreed"), entry("m2", "open")];
        expect(memoryCount(council({ memory: { entries } }))).toBe(2);
        expect(memoryCount(council({ memory: { entries, chosen: direction() } }))).toBe(3);
        expect(memoryCount(council({ memory: { chosen: direction() } }))).toBe(1);
    });

    it("does not count a card, an earlier direction or an entry of an unknown kind", () => {
        const c = council({
            memory: {
                suggestion: suggestion(),
                replaced: [direction({ replaced: clock(9, 0) })],
                entries: [entry("m1", "weird")],
            },
        });
        expect(memoryCount(c)).toBe(0);
    });
});

describe("newEntryIds and memoryDotOn", () => {
    const c = council({
        memory: {
            entries: [entry("m1", "agreed", { at: clock(10, 0) }), entry("m2", "open", { at: clock(10, 30) })],
        },
    });

    it("names the entries that came in after the tab was last open", () => {
        expect([...newEntryIds(c, clock(10, 10))]).toEqual(["m2"]);
        expect([...newEntryIds(c, clock(10, 30))]).toEqual([]);
        expect(newEntryIds(c, undefined).size).toBe(2);
    });

    it("has no new entries for a council with none", () => {
        expect(newEntryIds(council(), undefined).size).toBe(0);
    });

    it("turns the dot on for a new entry, or for a card that waits", () => {
        expect(memoryDotOn(c, clock(10, 10))).toBe(true);
        expect(memoryDotOn(c, clock(10, 30))).toBe(false);
        expect(memoryDotOn(council({ memory: { held: held() } }), clock(23, 0))).toBe(true);
        expect(memoryDotOn(council({ memory: { suggestion: suggestion() } }), undefined)).toBe(true);
    });

    it("keeps the dot off for a council with no entries and no card", () => {
        expect(memoryDotOn(council(), undefined)).toBe(false);
        expect(memoryDotOn(council({ memory: { chosen: direction() } }), undefined)).toBe(false);
    });
});

describe("entryDetails", () => {
    it("says Auto · round N for an entry the round check made, with the messages it rests on", () => {
        expect(
            entryDetails(entry("m1", "agreed", { by: "auto", round: 3, messages: ["r19"], at: clock(22, 31) }))
        ).toEqual({
            who: "Auto · round 3",
            messages: ["r19"],
            time: "22:31",
        });
    });

    it("says only Auto when no round was recorded", () => {
        expect(entryDetails(entry("m1", "open", { by: "auto", round: 0 })).who).toBe("Auto");
        expect(entryDetails(entry("m1", "open", { by: "auto" })).who).toBe("Auto");
    });

    it("leaves who null for the person's own entry, whose view writes You and the time", () => {
        expect(entryDetails(entry("m1", "agreed", { by: "you", at: clock(22, 40) }))).toEqual({
            who: null,
            messages: [],
            time: "22:40",
        });
    });
});

describe("memoryIsEmpty", () => {
    it("is empty with no direction, no entry and no card", () => {
        expect(memoryIsEmpty(council())).toBe(true);
        expect(memoryIsEmpty(council({ memory: {} }))).toBe(true);
        expect(memoryIsEmpty(council({ memory: { replaced: [direction({ replaced: clock(9, 0) })] } }))).toBe(true);
    });

    it("is not empty with a direction, an entry or a card", () => {
        expect(memoryIsEmpty(council({ memory: { chosen: direction() } }))).toBe(false);
        expect(memoryIsEmpty(council({ memory: { entries: [entry("m1", "open")] } }))).toBe(false);
        expect(memoryIsEmpty(council({ memory: { held: held() } }))).toBe(false);
        expect(memoryIsEmpty(council({ memory: { suggestion: suggestion() } }))).toBe(false);
    });
});

describe("old council with no entries", () => {
    it("loads: counts the direction alone, has no dot from entries and lists nothing", () => {
        const c = council({ memory: { chosen: direction() } });
        expect(memoryCount(c)).toBe(1);
        expect(memoryEntries(c)).toEqual([]);
        expect(memoryDotOn(c, undefined)).toBe(false);
        expect(newEntryIds(c, undefined).size).toBe(0);
        expect(memoryCount(council())).toBe(0);
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

describe("chotLine", () => {
    it("is what chotText gives the same text as a message, for the post the channel already drew", () => {
        const text = "Ship B first.\n\nIt costs less,\n  and the seats agree.";
        expect(chotLine(text)).toBe(chotText(reply("r1", "ram", { text })));
        const long = "word ".repeat(100);
        expect(chotLine(long)).toBe(chotText(reply("r2", "ram", { text: long })));
        expect(chotLine("  Pin apps to the rail  ")).toBe("Pin apps to the rail");
        expect(chotLine(" \n ")).toBe("");
    });
});

describe("cardLinks", () => {
    it("links the messages a suggestion rests on", () => {
        expect(cardLinks(suggestion({ messages: ["r21", "r22"], from: "P2" }))).toEqual(["r21", "r22"]);
    });

    it("falls back to the idea an all green suggestion came from, else none", () => {
        expect(cardLinks(suggestion({ source: "green", from: "P2" }))).toEqual(["P2"]);
        expect(cardLinks(suggestion({ messages: [] }))).toEqual([]);
        expect(cardLinks(held())).toEqual([]);
    });
});

describe("the Add form's kinds", () => {
    it("offers Direction, Agreed, Ruled out, Open in that order, and a why only for Ruled out", () => {
        expect(ADD_KINDS).toEqual(["direction", "agreed", "ruledout", "open"]);
        expect(ADD_KINDS.filter(kindTakesWhy)).toEqual(["ruledout"]);
    });
});

describe("memoryTabLabel", () => {
    it("counts the entries and the direction, and says plain Memory with nothing", () => {
        expect(memoryTabLabel(council())).toBe("Memory");
        expect(memoryTabLabel(council({ memory: {} }))).toBe("Memory");
        expect(memoryTabLabel(council({ memory: { chosen: direction() } }))).toBe("Memory · 1");
        expect(
            memoryTabLabel(
                council({ memory: { chosen: direction(), entries: [entry("m1", "open"), entry("m2", "agreed")] } })
            )
        ).toBe("Memory · 3");
    });
});

describe("directionSource", () => {
    it("names an idea or a message by id, and nothing for an empty or unknown id", () => {
        const c = council({ proposals: [prop("P3", "ux")], replies: [reply("r7", "ram", { proposalid: "P3" })] });
        expect(directionSource(c, "P3")?.kind).toBe("idea");
        expect(directionSource(c, "r7")?.kind).toBe("message");
        expect(directionSource(c, "r7")?.thread).toBe("P3");
        expect(directionSource(c, "")).toBeNull();
        expect(directionSource(c, undefined)).toBeNull();
        expect(directionSource(c, "r99")).toBeNull();
    });
});

describe("latestEntryAt", () => {
    it("is 0 with no entry", () => {
        expect(latestEntryAt(council())).toBe(0);
    });

    it("moves when a round drops one entry and adds one, though the count stays", () => {
        const before = council({
            memory: {
                entries: [entry("m1", "open", { at: clock(10, 0) }), entry("m2", "agreed", { at: clock(10, 5) })],
            },
        });
        const after = council({
            memory: {
                entries: [
                    entry("m2", "agreed", { at: clock(10, 5) }),
                    entry("m3", "agreed", { by: "auto", at: clock(10, 9) }),
                ],
            },
        });
        expect(memoryEntries(after)).toHaveLength(memoryEntries(before).length);
        expect(latestEntryAt(after)).toBe(clock(10, 9));
        expect(latestEntryAt(after)).not.toBe(latestEntryAt(before));
        // seen written at the newest arrival leaves the dot off, as the open tab does
        expect(memoryDotOn(after, latestEntryAt(after))).toBe(false);
        expect(memoryDotOn(after, latestEntryAt(before))).toBe(true);
    });
});
