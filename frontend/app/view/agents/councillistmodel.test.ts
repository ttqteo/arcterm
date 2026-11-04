import { describe, expect, it } from "vitest";
import {
    CHAT_THREAD,
    chatRow,
    councilList,
    listNavOrder,
    listOrder,
    railMeta,
    railOrderLabel,
    stanceGroups,
    type IdeaRow,
    type StanceGroup,
} from "./councillistmodel";

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

describe("railMeta and railOrderLabel: the Ideas rail's quiet lines", () => {
    const row = (extra: Partial<IdeaRow> = {}): IdeaRow => ({
        id: "P1",
        n: 1,
        author: "ux",
        name: "UX",
        initials: "UX",
        tone: "conn-1",
        title: "title P1",
        label: "idea",
        isNew: false,
        agrees: 0,
        doubts: 0,
        against: 0,
        replies: 0,
        repliesLabel: "no replies",
        draft: false,
        held: false,
        withdrawn: false,
        withdrawnRound: 0,
        cut: false,
        ...extra,
    });

    it("says nothing for an idea nobody answered", () => {
        expect(railMeta(row())).toBe("");
    });

    it("says `withdrawn in round N` for a withdrawn idea, in place of its replies and stances, and `cut by you` for a cut one", () => {
        const answered = { replies: 4, repliesLabel: "4 replies", agrees: 2, against: 1 };
        expect(railMeta(row({ ...answered, withdrawn: true, withdrawnRound: 2 }))).toBe("withdrawn in round 2");
        expect(railMeta(row({ ...answered, cut: true }))).toBe("cut by you");
        // the round is not known: the line still says it was withdrawn
        expect(railMeta(row({ withdrawn: true }))).toBe("withdrawn");
        // the person's pending action stays in sight
        expect(railMeta(row({ withdrawn: true, withdrawnRound: 3, draft: true }))).toBe(
            "withdrawn in round 3 · draft waits"
        );
        // cut at the pause is the person's own act, so it is what the line names
        expect(railMeta(row({ cut: true, withdrawn: true, withdrawnRound: 3 }))).toBe("cut by you");
    });

    it("names the replies, then each stance taken, then a draft that waits", () => {
        expect(railMeta(row({ replies: 4, repliesLabel: "4 replies", agrees: 2, doubts: 1 }))).toBe(
            "4 replies · 2 agree · 1 has doubts"
        );
        expect(railMeta(row({ against: 2, draft: true }))).toBe("2 are against it · draft waits");
        expect(railMeta(row({ agrees: 1, doubts: 2, against: 1 }))).toBe("1 agrees · 2 have doubts · 1 is against it");
    });

    it("captions the grouping: by where the seats stand, with or without a summary", () => {
        expect(railOrderLabel()).toBe("by where the seats stand");
    });
});

describe("councilList: what the Ideas rail needs to group a row", () => {
    it("marks a withdrawn idea with the round of its author's withdrawal, and a cut idea", () => {
        const c = council({
            proposals: [
                prop("P1", "ux", 10, { withdrawn: true }),
                prop("P2", "ram", 20, { withdrawn: true }),
                prop("P3", "sk", 30, { cut: true }),
                prop("P4", "ux", 40),
            ],
            replies: [
                // the author's two revisions: the idea was retitled in round 2 and withdrawn in round 3, the last one
                reply("r1", "ux", 100, { revised: true, round: 2, text: "Retitled." }),
                reply("r2", "ux", 110, { revised: true, round: 3, text: "Withdrawn." }),
                // another seat's reply and a revision of another idea are not P1's withdrawal
                reply("r3", "ram", 120, { revised: true, round: 4 }),
                reply("r4", "ux", 130, { proposalid: "P4", revised: true, round: 4 }),
            ],
        });
        const [p1, p2, p3, p4] = councilList(c, 0).ideas;
        expect(p1).toMatchObject({ withdrawn: true, withdrawnRound: 3, cut: false });
        // P2's author revised nothing in the record: withdrawn, the round unknown
        expect(p2).toMatchObject({ withdrawn: true, withdrawnRound: 0, cut: false });
        expect(p3).toMatchObject({ withdrawn: false, withdrawnRound: 0, cut: true });
        expect(p4).toMatchObject({ withdrawn: false, withdrawnRound: 0, cut: false });
    });

    it("ignores a withdrawal reply that is still held", () => {
        const c = council({
            proposals: [prop("P1", "ux", 10, { withdrawn: true })],
            replies: [reply("r1", "ux", 100, { revised: true, round: 3, draft: "held" })],
        });
        expect(councilList(c, 0).ideas[0]).toMatchObject({ withdrawn: true, withdrawnRound: 0 });
    });
});

describe("stanceGroups: the Ideas rail grouped by where the seats stand", () => {
    const groupsOf = (c: Council, only?: string): StanceGroup[] => stanceGroups(councilList(c, 0, only).ideas);
    const shape = (groups: StanceGroup[]) => groups.map((g) => [g.key, ids(g.rows)]);

    // an idea in every group: P1 agreed, P2 has doubts, P3 someone against it, P4 no stance yet, P5 waits on the person
    // (held), P6 withdrawn by its author in round 2, P7 cut by the person
    const everyGroup = (): Council =>
        council({
            proposals: [
                prop("P1", "ux", 10),
                prop("P2", "ram", 20),
                prop("P3", "sk", 30),
                prop("P4", "ux", 40),
                prop("P5", "ram", 50, { draft: "held" }),
                prop("P6", "sk", 60, { withdrawn: true }),
                prop("P7", "ux", 70, { cut: true }),
            ],
            replies: [
                reply("r1", "ram", 100, { proposalid: "P1", stance: "accept" }),
                reply("r2", "sk", 110, { proposalid: "P2", stance: "challenge" }),
                reply("r3", "ux", 120, { proposalid: "P3", stance: "oppose" }),
                reply("r4", "sk", 130, { proposalid: "P6", revised: true, round: 2, text: "Withdrawn." }),
            ],
        });

    it("groups the ideas in the fixed order, with the colour each is drawn in, and leaves a group with no idea out", () => {
        const groups = groupsOf(everyGroup());
        expect(shape(groups)).toEqual([
            ["waiting", ["P5"]],
            ["agreed", ["P1"]],
            ["doubts", ["P2"]],
            ["against", ["P3"]],
            ["none", ["P4"]],
            ["withdrawn", ["P6", "P7"]],
        ]);
        expect(groups.map((g) => g.label)).toEqual([
            "Waiting on you",
            "Agreed",
            "Has doubts",
            "Someone against it",
            "No stance yet",
            "Withdrawn",
        ]);
        expect(groups.map((g) => g.tone)).toEqual(["muted", "success", "warning", "error", "ink-faint", "edge-strong"]);
        // a council whose ideas all agree has the one group
        const agreed = council({
            proposals: [prop("P1", "ux", 10)],
            replies: [reply("r1", "ram", 100, { stance: "accept" })],
        });
        expect(shape(groupsOf(agreed))).toEqual([["agreed", ["P1"]]]);
        expect(groupsOf(council())).toEqual([]);
    });

    it("rules each group from the seats' latest stances: one accept and nobody else is Agreed", () => {
        const c = council({
            proposals: [prop("P1", "ux", 10), prop("P2", "ram", 20)],
            replies: [
                reply("r1", "ram", 100, { proposalid: "P1", stance: "accept" }),
                reply("r2", "sk", 110, { proposalid: "P1", stance: "accept" }),
                // P2: RAM's own reply takes no stance, and a `proposed` author with no other seat is no stance yet
                reply("r3", "ram", 120, { proposalid: "P2", stance: "accept" }),
            ],
        });
        expect(shape(groupsOf(c))).toEqual([
            ["agreed", ["P1"]],
            ["none", ["P2"]],
        ]);
    });

    it("takes the latest stance of a seat, so an idea moves group as a stance changes", () => {
        const base = [prop("P1", "ux", 10)];
        const challenged = council({ proposals: base, replies: [reply("r1", "ram", 100, { stance: "challenge" })] });
        expect(shape(groupsOf(challenged))).toEqual([["doubts", ["P1"]]]);
        const won = council({
            proposals: base,
            replies: [reply("r1", "ram", 100, { stance: "challenge" }), reply("r2", "ram", 200, { stance: "accept" })],
        });
        expect(shape(groupsOf(won))).toEqual([["agreed", ["P1"]]]);
        const turned = council({
            proposals: base,
            replies: [reply("r1", "ram", 100, { stance: "accept" }), reply("r2", "ram", 200, { stance: "oppose" })],
        });
        expect(shape(groupsOf(turned))).toEqual([["against", ["P1"]]]);
    });

    it("takes the strongest word by precedence: withdrawn, then against, then doubts, then agreed, then no stance", () => {
        const c = council({
            proposals: [
                prop("P1", "ux", 10), // accept + challenge + oppose: against
                prop("P2", "ux", 20), // accept + challenge: doubts
                prop("P3", "ux", 30), // accept: agreed
                prop("P4", "ux", 40, { withdrawn: true }), // withdrawn, whatever the seats said after
                prop("P5", "ux", 50, { cut: true }), // cut, whatever the seats said
            ],
            replies: [
                reply("a1", "ram", 100, { proposalid: "P1", stance: "accept" }),
                reply("a2", "sk", 110, { proposalid: "P1", stance: "challenge" }),
                reply("a3", "coordinator", 120, { proposalid: "P1", stance: "oppose" }),
                reply("b1", "ram", 130, { proposalid: "P2", stance: "accept" }),
                reply("b2", "sk", 140, { proposalid: "P2", stance: "challenge" }),
                reply("c1", "ram", 150, { proposalid: "P3", stance: "accept" }),
                reply("d1", "ram", 160, { proposalid: "P4", stance: "oppose" }),
                reply("d2", "sk", 170, { proposalid: "P4", stance: "accept" }),
                reply("e1", "ram", 180, { proposalid: "P5", stance: "oppose" }),
            ],
        });
        expect(shape(groupsOf(c))).toEqual([
            ["agreed", ["P3"]],
            ["doubts", ["P2"]],
            ["against", ["P1"]],
            ["withdrawn", ["P4", "P5"]],
        ]);
    });

    it("puts a held idea in Waiting on you whatever else is true of it, and an idea with only a held reply stays in its stance group", () => {
        const c = council({
            proposals: [
                prop("P1", "ux", 10),
                prop("P2", "ram", 20, { draft: "held" }),
                prop("P3", "sk", 30, { draft: "held", cut: true }),
            ],
            replies: [reply("r1", "sk", 100, { proposalid: "P1", draft: "held", stance: "oppose" })],
        });
        const groups = groupsOf(c);
        expect(shape(groups)).toEqual([
            ["waiting", ["P2", "P3"]],
            ["none", ["P1"]],
        ]);
        // the held reply is not a stance yet: P1 shows its draft in its meta line instead
        expect(groups[1].rows[0].draft).toBe(true);
    });

    it("keeps arrival order inside a group, and each idea's number as it is for everyone", () => {
        const c = council({
            // P3 arrived before P2 although the record keeps P2 first
            proposals: [prop("P1", "ux", 10), prop("P2", "ram", 40), prop("P3", "sk", 20), prop("P4", "ux", 50)],
            replies: [
                reply("r1", "ram", 100, { proposalid: "P1", stance: "accept" }),
                reply("r2", "ux", 110, { proposalid: "P2", stance: "accept" }),
                reply("r3", "ram", 120, { proposalid: "P3", stance: "accept" }),
                reply("r4", "ram", 130, { proposalid: "P4", stance: "challenge" }),
            ],
        });
        const [agreed, doubts] = groupsOf(c);
        expect(ids(agreed.rows)).toEqual(["P1", "P3", "P2"]);
        expect(agreed.rows.map((r) => r.n)).toEqual([1, 2, 3]);
        expect(ids(doubts.rows)).toEqual(["P4"]);
    });

    it("keeps arrival order inside a group even once a summary puts the list in the Report's order", () => {
        const c = council({
            proposals: [prop("P1", "ux", 10), prop("P2", "ram", 20), prop("P3", "sk", 30)],
            replies: [
                reply("r1", "ram", 100, { proposalid: "P1", stance: "accept" }),
                reply("r2", "ux", 110, { proposalid: "P2", stance: "accept" }),
                reply("r3", "ram", 120, { proposalid: "P3", stance: "accept" }),
            ],
            summary: { text: "", directions: [direction(1, ["P3"])], outcomes: {}, at: at(200) },
        });
        // the list puts the idea the Report's first direction cites first; the group does not
        expect(listOrder(c)).toEqual(["P3", "P1", "P2"]);
        expect(shape(groupsOf(c))).toEqual([["agreed", ["P1", "P2", "P3"]]]);
    });

    it("narrows to a seat first and groups what is left: a group that seat has no idea in is left out", () => {
        const c = everyGroup();
        // RAM wrote P2 and P5 and replied to P1; Skeptic wrote P3 and P6 and replied to P2 and P6
        expect(shape(groupsOf(c, "ram"))).toEqual([
            ["waiting", ["P5"]],
            ["agreed", ["P1"]],
            ["doubts", ["P2"]],
        ]);
        expect(shape(groupsOf(c, "sk"))).toEqual([
            ["doubts", ["P2"]],
            ["against", ["P3"]],
            ["withdrawn", ["P6"]],
        ]);
        expect(groupsOf(c, "coordinator")).toEqual([]);
    });

    it("hands the group's rows on as the list built them, so the counts and the meta line read from the same row", () => {
        const groups = groupsOf(everyGroup());
        const withdrawn = groups.find((g) => g.key === "withdrawn")!;
        expect(withdrawn.rows.map((r) => railMeta(r))).toEqual(["withdrawn in round 2", "cut by you"]);
        const held = groups.find((g) => g.key === "waiting")!;
        expect(held.rows.map((r) => railMeta(r))).toEqual(["draft waits"]);
        expect(groups.find((g) => g.key === "against")!.rows.map((r) => railMeta(r))).toEqual([
            "1 reply · 1 is against it",
        ]);
    });
});
