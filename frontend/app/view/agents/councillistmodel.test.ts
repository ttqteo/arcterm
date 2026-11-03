import { describe, expect, it } from "vitest";
import { CHAT_THREAD, chatRow, councilList, listNavOrder, listOrder } from "./councillistmodel";

const STARTED = new Date(2026, 10, 3, 9, 0, 0).getTime();
const at = (seconds: number) => STARTED + seconds * 1000;

const experts: CouncilExpert[] = [
    { id: "ux", name: "UX", brief: "", model: "sonnet" },
    { id: "ram", name: "RAM", brief: "", model: "sonnet" },
    { id: "sk", name: "Skeptic", brief: "", model: "sonnet" },
    { id: "coordinator", name: "Coordinator", brief: "", model: "opus", coordinator: true },
];

const prop = (id: string, author: string, seconds: number, extra: Partial<CouncilProposal> = {}): CouncilProposal => ({
    id,
    author,
    title: `title ${id}`,
    argument: `argument ${id}`,
    ts: at(seconds),
    ...extra,
});

const reply = (id: string, author: string, seconds: number, extra: Partial<CouncilReply> = {}): CouncilReply => ({
    id,
    proposalid: "P1",
    author,
    text: `text ${id}`,
    round: 2,
    ts: at(seconds),
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
    started: STARTED,
    proposals: [],
    replies: [],
    tokens: 0,
    calls: 0,
    created: 0,
    updated: 0,
    ...extra,
});

const direction = (rank: number, from: string[]): CouncilDirection => ({
    rank,
    title: `direction ${rank}`,
    reasoning: "",
    from,
    stances: {},
    agreed: true,
});

// four ideas, the third posted before the second (arrival is by time, not by record order), with stances on them, and
// a held idea and a dropped one
const ideas = () => [
    prop("P1", "ux", 10),
    prop("P2", "ram", 40),
    prop("P3", "sk", 20),
    prop("P4", "ux", 50),
    prop("P5", "ram", 60, { draft: "held" }),
    prop("P6", "sk", 70, { draft: "dropped" }),
];

const ids = (rows: { id: string }[]) => rows.map((r) => r.id);

describe("councilList: the idea rows", () => {
    it("lists every idea a person sees, a held one too, in arrival order with its number, and leaves a dropped one out", () => {
        const list = councilList(council({ proposals: ideas() }), 0);
        expect(ids(list.ideas)).toEqual(["P1", "P3", "P2", "P4", "P5"]);
        expect(list.ideas.map((r) => r.n)).toEqual([1, 2, 3, 4, 5]);
        expect(list.label).toBe("5 ideas");
        expect(list.ideas[0]).toMatchObject({
            author: "ux",
            name: "UX",
            title: "title P1",
            label: "proposes",
            held: false,
            draft: false,
        });
        expect(councilList(council({ proposals: [prop("P1", "ux", 10)] }), 0).label).toBe("1 idea");
    });

    it("counts Agrees, Has doubts and Is against it from each seat's latest stance, and the replies a person reads", () => {
        const c = council({
            proposals: ideas(),
            replies: [
                reply("r1", "ram", 100, { stance: "challenge" }),
                reply("r2", "ram", 110, { stance: "accept" }), // RAM's latest on P1: it agrees now
                reply("r3", "sk", 120, { stance: "oppose" }),
                reply("r4", "coordinator", 125, { stance: "accept", text: "" }), // an agreement: a stance, no reply
                reply("r5", "you", 130), // the person's: no stance
                reply("r6", "ux", 140, { stance: "accept" }), // the author's own reply takes no stance
                reply("r7", "ux", 150, { proposalid: "P2", stance: "challenge" }),
                reply("r8", "sk", 160, { proposalid: "P2", stance: "oppose", draft: "held" }), // held: no stance yet
            ],
        });
        const [p1, , p2] = councilList(c, 0).ideas;
        expect(p1).toMatchObject({ agrees: 2, doubts: 0, against: 1, replies: 5, repliesLabel: "5 replies" });
        expect(p2).toMatchObject({
            agrees: 0,
            doubts: 1,
            against: 0,
            replies: 1,
            repliesLabel: "1 reply",
            draft: true,
        });
        expect(councilList(c, 0).ideas[1]).toMatchObject({ id: "P3", replies: 0, repliesLabel: "no replies" });
    });

    it("badges New an idea that came after the person last opened the council", () => {
        const rows = councilList(council({ proposals: ideas() }), at(40)).ideas;
        expect(rows.filter((r) => r.isNew).map((r) => r.id)).toEqual(["P4", "P5"]);
    });

    it("flags a Draft on a held idea, and on an idea with a reply held for the person", () => {
        const c = council({
            proposals: ideas(),
            replies: [reply("r1", "sk", 100, { proposalid: "P3", draft: "held" })],
        });
        const rows = councilList(c, 0).ideas;
        expect(rows.filter((r) => r.draft).map((r) => r.id)).toEqual(["P3", "P5"]);
        expect(rows.find((r) => r.id === "P5")?.held).toBe(true);
        expect(rows.find((r) => r.id === "P3")?.held).toBe(false);
    });

    it("labels Brainstorm ideas `idea` and `wild idea`", () => {
        const c = council({
            mode: "brainstorm",
            proposals: [prop("P1", "ux", 10, { wild: true }), prop("P2", "ram", 20)],
        });
        expect(councilList(c, 0).ideas.map((r) => r.label)).toEqual(["wild idea", "idea"]);
    });
});

describe("listOrder: the order is fixed", () => {
    it("is arrival order until there is a summary, whatever the stances", () => {
        const c = council({
            proposals: ideas(),
            replies: [reply("r1", "ram", 100, { proposalid: "P4", stance: "accept" })],
        });
        expect(listOrder(c)).toEqual(["P1", "P3", "P2", "P4", "P5"]);
    });

    it("follows the Report's order once there is a summary, the uncited, later and held ideas after it in arrival order", () => {
        const c = council({
            proposals: [...ideas(), prop("P7", "ux", 300)],
            summary: {
                text: "",
                directions: [direction(1, ["P4"]), direction(2, ["P2", "P1"])],
                outcomes: {},
                at: at(200),
            },
        });
        // P4 (direction 1), then P1 and P2 (direction 2, in the Report's order: the record's), then P3 (cited by no
        // direction), P5 (held) and P7 (after the summary), as they arrived
        expect(listOrder(c)).toEqual(["P4", "P1", "P2", "P3", "P5", "P7"]);
    });

    it("never re-sorts on a stance after a summary either", () => {
        const base = {
            proposals: ideas(),
            summary: { text: "", directions: [direction(1, ["P2", "P1"])], outcomes: {}, at: at(200) },
        };
        const before = listOrder(council(base));
        const after = listOrder(
            council({ ...base, replies: [reply("r1", "sk", 300, { proposalid: "P3", stance: "accept" })] })
        );
        expect(after).toEqual(before);
    });
});

describe("chatRow: the replies tied to no idea", () => {
    const chat = () =>
        council({
            proposals: [prop("P1", "ux", 10)],
            replies: [
                reply("r1", "you", 100, { proposalid: "" }),
                reply("r2", "ux", 110, { proposalid: "", parentid: "r1", text: "We could ship it\nthis week." }),
                reply("r3", "ram", 120, { proposalid: "", parentid: "r1", text: "" }), // an agreement: no message
                reply("r4", "sk", 130, { proposalid: "", parentid: "r1", text: "Not before the RAM check." }),
                reply("r5", "sk", 140), // on P1: in its thread, not the Chat
                reply("r6", "ram", 150, { proposalid: "", draft: "dropped" }),
            ],
        });

    it("counts the messages, quotes the newest on one line, and counts the seats' new ones since the last opening", () => {
        expect(chatRow(chat(), at(105))).toEqual({
            count: 3,
            label: "3 messages",
            latest: "Skeptic: Not before the RAM check.",
            fresh: 2,
            freshLabel: "2 new",
            draft: false,
        });
        // the person's own message is never new to them
        expect(chatRow(chat(), at(90)).fresh).toBe(2);
        expect(chatRow(chat(), at(200))).toMatchObject({ fresh: 0, freshLabel: "" });
    });

    it("reads `No messages yet` with none, and `1 message` with one", () => {
        expect(chatRow(council(), 0)).toEqual({
            count: 0,
            label: "No messages yet",
            latest: "",
            fresh: 0,
            freshLabel: "",
            draft: false,
        });
        const one = council({ replies: [reply("r1", "you", 10, { proposalid: "", text: "Any risk?" })] });
        expect(chatRow(one, 0)).toMatchObject({ label: "1 message", latest: "You: Any risk?" });
    });

    it("flags a Draft when a seat's reply tied to no idea waits for the person", () => {
        const c = council({ replies: [reply("r1", "ux", 10, { proposalid: "", draft: "held" })] });
        expect(chatRow(c, 0)).toMatchObject({ draft: true, count: 0 });
    });
});

describe("councilList with one seat chosen", () => {
    const c = () =>
        council({
            proposals: ideas(),
            replies: [
                reply("r1", "sk", 100, { stance: "challenge" }), // Skeptic on P1
                reply("r2", "ram", 110, { proposalid: "P4", stance: "accept", text: "" }), // RAM agrees with P4
                reply("r3", "you", 120, { proposalid: "" }),
                reply("r4", "ux", 130, { proposalid: "", parentid: "r3" }),
                reply("r5", "ram", 140, { proposalid: "", parentid: "r3", text: "RAM fits." }),
            ],
        });

    it("lists only the ideas that seat wrote or replied to, an agreement or a held reply included", () => {
        expect(ids(councilList(c(), 0, "sk").ideas)).toEqual(["P1", "P3"]);
        expect(ids(councilList(c(), 0, "ram").ideas)).toEqual(["P2", "P4", "P5"]);
        const held = council({
            proposals: ideas(),
            replies: [reply("r1", "sk", 100, { proposalid: "P2", draft: "held" })],
        });
        expect(ids(councilList(held, 0, "sk").ideas)).toEqual(["P3", "P2"]);
        expect(councilList(c(), 0, "sk").label).toBe("2 ideas");
    });

    it("keeps each idea's number and counts as they are for everyone", () => {
        const all = councilList(c(), 0).ideas.find((r) => r.id === "P4");
        expect(councilList(c(), 0, "ram").ideas.find((r) => r.id === "P4")).toEqual(all);
    });

    it("counts only that seat's lines in the Chat row", () => {
        expect(councilList(c(), 0, "ram").chat).toMatchObject({ count: 1, latest: "RAM: RAM fits.", fresh: 1 });
        expect(councilList(c(), 0, "sk").chat).toMatchObject({ count: 0, label: "No messages yet" });
        expect(councilList(c(), 0).chat.count).toBe(3);
    });
});

describe("listNavOrder", () => {
    it("is the Chat row, then the ideas as the list draws them", () => {
        const list = councilList(council({ proposals: ideas() }), 0);
        expect(listNavOrder(list)).toEqual([CHAT_THREAD, "P1", "P3", "P2", "P4", "P5"]);
    });
});
