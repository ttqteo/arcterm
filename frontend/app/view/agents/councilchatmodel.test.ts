import { describe, expect, it } from "vitest";
import {
    DRAFT_ACTIONS,
    DRAFT_WAIT,
    councilChannel,
    councilThread,
    ideaOrder,
    insertMention,
    mentionPicker,
    moveIdea,
    replyReach,
    seatChips,
    stepChip,
    type ChannelItem,
} from "./councilchatmodel";

const STARTED = 1_000_000;
const at = (seconds: number) => STARTED + seconds * 1000;

const agent = (id: string, tab: string, name: string, context: number, harness = "claude"): CouncilExpert => ({
    id,
    name,
    brief: "",
    model: "",
    agent: tab,
    harness,
    context,
});

// a room: two live agents beside two role experts and the coordinator
const experts: CouncilExpert[] = [
    agent("witness", "t-w", "Witness synthesis", 625_000),
    agent("ux", "t-u", "UX audit", 210_000, "pi"),
    { id: "sec", name: "Security", brief: "", model: "sonnet" },
    { id: "sk", name: "Skeptic", brief: "", model: "sonnet" },
    { id: "coordinator", name: "Coordinator", brief: "", model: "opus", coordinator: true },
];

// today's council: role experts only, no rounds, no drafts
const oldExperts: CouncilExpert[] = [
    { id: "ux", name: "UX", brief: "", model: "sonnet" },
    { id: "ram", name: "RAM", brief: "", model: "sonnet" },
    { id: "nu", name: "New user", brief: "", model: "sonnet" },
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
    state: "running",
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

const ids = (items: { id?: string }[]) => items.map((i) => i.id);
const byId = (items: ChannelItem[], id: string) => items.find((i) => i.id === id);

const SKIP_REASON = "still working on its own task after 10 min";

// the room of the CDP fixture, in a test: held ideas and replies, a dropped one, an edited one, a skip, a failure, a seat
// at work and one waiting for an agent to finish its task
const room = (extra: Partial<Council> = {}): Council =>
    council({
        proposals: [
            prop("P1", "sec", 60, { evidence: [{ ref: "pkg/services/model.go:38" }] }),
            prop("P2", "sk", 100, {
                evidence: [{ ref: "a.ts:1" }, { ref: "b.ts:2", weak: true, note: "no measurement" }],
            }),
            prop("P3", "ux", 130, { edited: true }),
            prop("P4", "witness", 131, { draft: "held" }),
            prop("P5", "ux", 132, { draft: "dropped" }),
        ],
        replies: [
            reply("r1", "you", 150, { proposalid: "", to: ["witness", "ux", "sec", "sk"] }),
            reply("r2", "sk", 160, { stance: "accept", text: "" }),
            reply("r3", "witness", 170, { stance: "challenge" }),
            reply("r4", "ux", 175, { stance: "accept", builds: true, edited: true }),
            reply("r5", "you", 190, { to: ["witness"] }),
            reply("r6", "sk", 200, { stance: "oppose", draft: "held" }),
            reply("r7", "witness", 210, { proposalid: "P2", draft: "dropped" }),
            reply("r8", "sk", 220, { proposalid: "", parentid: "r1" }),
            reply("r9", "ux", 230, { proposalid: "", draft: "held", revised: true }),
        ],
        skips: [{ expert: "witness", round: 2, reason: SKIP_REASON, ts: at(180) }],
        activity: {
            witness: { text: "Waiting for Witness synthesis to finish its task" },
            ux: { text: "Replying to Security", proposalid: "P1" },
        },
        failed: { sec: { round: 2, error: "the reply was not valid JSON" } },
        ...extra,
    });

describe("councilChannel: the goal, the rounds and the order", () => {
    it("opens with the person's question as a message of theirs, with the council's clock", () => {
        const [first] = councilChannel(council());
        expect(first).toEqual({
            kind: "question",
            id: "question",
            author: "you",
            name: "You",
            tone: "you",
            tag: "",
            label: "sets the goal",
            text: "Which changes to the rail are worth making first?",
            at: "0:00",
        });
    });

    it("has no question message when the council has none, and nothing at all before it has run", () => {
        expect(councilChannel(council({ question: "  \n" })).some((i) => i.kind === "question")).toBe(false);
        expect(
            ids(councilChannel(council({ state: "not-run", round: 0, question: "Q?", started: undefined })))
        ).toEqual(["question"]);
    });

    it("puts the ideas and the whole-council posts in time order, a tie as they arrived", () => {
        const c = council({
            proposals: [prop("P2", "sk", 100), prop("P1", "sec", 60)],
            replies: [
                reply("r2", "sk", 150, { proposalid: "" }),
                reply("r1", "you", 140, { proposalid: "" }),
                reply("r3", "sec", 150, { proposalid: "" }),
            ],
        });
        expect(ids(councilChannel(c)).filter((id) => /^[Pr]\d+$/.test(id ?? ""))).toEqual([
            "P1",
            "P2",
            "r1",
            "r2",
            "r3",
        ]);
    });

    it("draws one divider per round reached: the first after the question, the next where its first reply came", () => {
        const c = council({
            proposals: [prop("P1", "sec", 60), prop("P2", "sk", 100)],
            replies: [reply("r1", "sk", 150, { proposalid: "" }), reply("r2", "sec", 160, { proposalid: "" })],
        });
        const items = councilChannel(c);
        expect(ids(items)).toEqual(["question", "round:1", "P1", "P2", "round:2", "r1", "r2"]);
        expect(byId(items, "round:1")).toMatchObject({ kind: "divider", round: 1, text: "Round 1 · ideas" });
        expect(byId(items, "round:2")).toMatchObject({ kind: "divider", round: 2, text: "Round 2 · replies" });
    });

    it("has only the first divider while round 1 runs, and puts a round nothing was posted in yet last", () => {
        const one = council({ round: 1, proposals: [prop("P1", "sec", 60)] });
        expect(ids(councilChannel(one))).toEqual(["question", "round:1", "P1"]);
        const fresh = council({
            round: 2,
            proposals: [prop("P1", "sec", 60)],
            failed: { sk: { round: 1, error: "x" } },
        });
        expect(ids(councilChannel(fresh))).toEqual(["question", "round:1", "P1", "round:2", "failed:sk"]);
    });

    it("counts the rounds the council has: a third round's divider, and no second one in a one-round council", () => {
        const three = council({
            rounds: 3,
            round: 3,
            proposals: [prop("P1", "sec", 60)],
            replies: [reply("r1", "sk", 150, { round: 2 }), reply("r2", "sk", 250, { round: 3, proposalid: "" })],
        });
        const items = councilChannel(three);
        expect(items.filter((i) => i.kind === "divider").map((i) => (i as { text: string }).text)).toEqual([
            "Round 1 · ideas",
            "Round 2 · replies",
            "Round 3 · replies",
        ]);
        const synthesis = council({ rounds: 1, round: 2, proposals: [prop("P1", "sec", 60)] });
        expect(ids(councilChannel(synthesis))).toEqual(["question", "round:1", "P1"]);
    });

    it("puts the person's post of a round after that round's divider", () => {
        const items = councilChannel(room());
        const ordered = ids(items);
        expect(ordered.indexOf("round:2")).toBeLessThan(ordered.indexOf("r1"));
        expect(ordered.indexOf("P4")).toBeLessThan(ordered.indexOf("round:2"));
    });
});

describe("councilChannel: an idea", () => {
    it("is a message with its author, evidence and the council's clock", () => {
        const items = councilChannel(room());
        expect(byId(items, "P1")).toMatchObject({
            kind: "idea",
            author: "sec",
            name: "Security",
            tag: "expert",
            label: "proposes",
            title: "title P1",
            text: "argument P1",
            evidence: ["pkg/services/model.go:38"],
            weak: "",
            wild: false,
            edited: false,
            at: "1:00",
        });
    });

    it("tags a live agent's idea as an agent's", () => {
        expect(byId(councilChannel(room()), "P3")).toMatchObject({ author: "ux", name: "UX audit", tag: "agent" });
    });

    it("keeps a weak claim apart from the evidence, as the chip reads", () => {
        expect(byId(councilChannel(room()), "P2")).toMatchObject({
            evidence: ["a.ts:1"],
            weak: "Weak · no measurement",
        });
    });

    it("says an idea the person edited before sending was edited", () => {
        expect(byId(councilChannel(room()), "P3")).toMatchObject({ edited: true });
    });

    it("lists the seats that agreed with nothing to add, and not one whose last word was a held reply", () => {
        const items = councilChannel(room());
        // r2: Skeptic agreed with P1; its later opposition (r6) is held, so it has not reached anyone
        expect(byId(items, "P1")).toMatchObject({ agrees: ["Skeptic agrees"] });
        expect(byId(items, "P2")).toMatchObject({ agrees: [] });
    });

    it("words a Brainstorm idea `idea`, and a wild one `wild idea` with a pill", () => {
        const c = council({
            mode: "brainstorm",
            proposals: [prop("P1", "sec", 60), prop("P2", "sk", 100, { wild: true })],
        });
        const items = councilChannel(c);
        expect(byId(items, "P1")).toMatchObject({ label: "idea", wild: false });
        expect(byId(items, "P2")).toMatchObject({ label: "wild idea", wild: true });
    });

    it("gives a Review idea no wild pill", () => {
        const c = council({ proposals: [prop("P1", "sec", 60, { wild: true })] });
        expect(byId(councilChannel(c), "P1")).toMatchObject({ label: "proposes", wild: false });
    });

    it("says how many seats picked an idea in the picks, and nothing for one no seat picked or for no picks at all", () => {
        const picks = { ux: ["P1", "P2"], sec: ["P1"], sk: [] };
        const c = council({ proposals: [prop("P1", "sec", 60), prop("P2", "sk", 100), prop("P3", "ux", 130)], picks });
        const items = councilChannel(c);
        expect(byId(items, "P1")).toMatchObject({
            picks: { count: 2, label: "Picked by 2", title: "Picked by 2 of 4 experts" },
        });
        expect(byId(items, "P2")).toMatchObject({ picks: { count: 1, label: "Picked by 1" } });
        expect(byId(items, "P3")).toMatchObject({ picks: null });
        expect(byId(councilChannel(council({ proposals: [prop("P1", "sec", 60)] })), "P1")).toMatchObject({
            picks: null,
        });
    });
});

describe("councilChannel: the reply chip", () => {
    it("counts the replies a person reads, names who wrote them and when the last came", () => {
        const idea = byId(councilChannel(room()), "P1");
        expect(idea).toMatchObject({
            thread: { count: 3, label: "3 replies", last: "Last reply 3:10", drafts: 1 },
        });
        const repliers = (idea as { thread: { repliers: { author: string; name: string; tag: string }[] } }).thread
            .repliers;
        expect(repliers.map((r) => [r.author, r.name, r.tag])).toEqual([
            ["witness", "Witness synthesis", "agent"],
            ["ux", "UX audit", "agent"],
            ["you", "You", ""],
        ]);
    });

    it("counts a reaction, a held reply and a dropped one for nothing", () => {
        // P2's only reply is dropped; P1's reaction (r2) and held reply (r6) are not in its count of 3
        expect(byId(councilChannel(room()), "P2")).toMatchObject({
            thread: { count: 0, label: "No replies yet", repliers: [], last: "", drafts: 0 },
        });
    });

    it("says `1 reply`, and lists an author once", () => {
        const c = council({
            proposals: [prop("P1", "sec", 60)],
            replies: [reply("r1", "sk", 150)],
        });
        expect(byId(councilChannel(c), "P1")).toMatchObject({ thread: { count: 1, label: "1 reply" } });
        const twice = council({
            proposals: [prop("P1", "sec", 60)],
            replies: [reply("r1", "sk", 150), reply("r2", "sk", 160)],
        });
        const chip = (byId(councilChannel(twice), "P1") as { thread: { repliers: unknown[]; label: string } }).thread;
        expect(chip.label).toBe("2 replies");
        expect(chip.repliers).toHaveLength(1);
    });

    it("leaves the time of the last reply out for a council with no start", () => {
        const c = council({
            started: undefined,
            proposals: [prop("P1", "sec", 60)],
            replies: [reply("r1", "sk", 150)],
        });
        expect(byId(councilChannel(c), "P1")).toMatchObject({ thread: { count: 1, last: "" } });
    });

    it("keeps a reply to an idea out of the channel: it is in the thread", () => {
        const items = ids(councilChannel(room()));
        for (const id of ["r2", "r3", "r4", "r5", "r6"]) {
            expect(items).not.toContain(id);
        }
    });
});

describe("councilChannel: held drafts", () => {
    it("shows a held idea as a draft waiting for the person, with Send to the others, Edit and Drop", () => {
        const draft = byId(councilChannel(room()), "P4");
        expect(draft).toMatchObject({
            kind: "draft",
            of: "idea",
            author: "witness",
            tag: "agent",
            label: "proposes",
            title: "title P4",
            text: "argument P4",
            on: "",
            at: "2:11",
        });
        expect(DRAFT_WAIT).toBe("Waiting for you");
        expect((draft as { actions: typeof DRAFT_ACTIONS }).actions.map((a) => [a.action, a.label])).toEqual([
            ["send", "Send to the others"],
            ["edit", "Edit"],
            ["drop", "Drop"],
        ]);
    });

    it("leaves a dropped idea out of the channel", () => {
        expect(ids(councilChannel(room()))).not.toContain("P5");
    });

    it("keeps a held reply to an idea out of the channel: it sits in the thread, and the chip counts it", () => {
        const items = councilChannel(room());
        expect(ids(items)).not.toContain("r6");
        expect(byId(items, "P1")).toMatchObject({ thread: { drafts: 1 } });
    });

    it("shows a held reply that has no idea as a draft in the channel, and says when it revises", () => {
        expect(byId(councilChannel(room()), "r9")).toMatchObject({
            kind: "draft",
            of: "reply",
            author: "ux",
            label: "replies",
            on: "",
            revised: true,
        });
    });

    it("names the idea a channel draft replies on when the council has it", () => {
        const c = council({
            proposals: [prop("P1", "sec", 60, { draft: "dropped" })],
            replies: [reply("r1", "sk", 150, { draft: "held" })],
        });
        expect(byId(councilChannel(c), "r1")).toMatchObject({ kind: "draft", of: "reply", on: "title P1" });
    });

    it("leaves a dropped reply with no idea out of the channel", () => {
        const c = council({ replies: [reply("r1", "sk", 150, { proposalid: "", draft: "dropped" })] });
        expect(ids(councilChannel(c))).not.toContain("r1");
    });
});

describe("councilChannel: the person's posts", () => {
    it("shows a post to the whole council as a message of theirs that steers, and reaches everyone", () => {
        expect(byId(councilChannel(room()), "r1")).toMatchObject({
            kind: "reply",
            author: "you",
            name: "You",
            tone: "you",
            label: "steers",
            mine: true,
            reaches: "For everyone",
            pending: "Answered after the summary",
            at: "2:30",
        });
    });

    it("names the seats a post reaches when it does not reach everyone, and none when it names no one", () => {
        const c = council({
            replies: [
                reply("r1", "you", 150, { proposalid: "", to: ["witness", "ux"] }),
                reply("r2", "you", 160, { proposalid: "", to: ["sk"] }),
                reply("r3", "you", 170, { proposalid: "" }),
            ],
        });
        const items = councilChannel(c);
        expect(byId(items, "r1")).toMatchObject({ reaches: "For Witness synthesis and UX audit" });
        expect(byId(items, "r2")).toMatchObject({ reaches: "For Skeptic" });
        expect(byId(items, "r3")).toMatchObject({ reaches: "" });
    });

    it("says a post waits for the next step while the council waits on the person", () => {
        const c = council({
            state: "awaiting-you",
            round: 1,
            replies: [reply("r1", "you", 150, { proposalid: "", round: 1, to: ["sk"] })],
        });
        expect(byId(councilChannel(c), "r1")).toMatchObject({ pending: "Queued for the next step" });
    });

    it("shows a seat's answer to the whole council in the channel, with no `mine` and no reach", () => {
        expect(byId(councilChannel(room()), "r8")).toMatchObject({
            kind: "reply",
            author: "sk",
            label: "replies",
            mine: false,
            reaches: "",
            pending: "",
            parentid: "r1",
        });
    });
});

describe("councilChannel: skipped turns, failures and seats at work", () => {
    it("draws a skipped turn as a line with the seat, the reason and its terminal", () => {
        const items = councilChannel(room());
        expect(byId(items, `skip:witness:2:${at(180)}`)).toMatchObject({
            kind: "skip",
            author: "witness",
            tab: "t-w",
            round: 2,
            reason: SKIP_REASON,
            text: `Witness synthesis skipped round 2: ${SKIP_REASON}.`,
            at: "3:00",
        });
        const order = ids(items);
        expect(order.indexOf("r1")).toBeLessThan(order.indexOf(`skip:witness:2:${at(180)}`));
        expect(order.indexOf(`skip:witness:2:${at(180)}`)).toBeLessThan(order.indexOf("r8"));
    });

    it("keeps a skip of a seat the council no longer has, with no terminal to open", () => {
        const c = council({
            skips: [{ expert: "gone", round: 1, reason: "gave no answer within 20 min", ts: at(70) }],
        });
        expect(councilChannel(c).find((i) => i.kind === "skip")).toMatchObject({
            tab: "",
            name: "gone",
            text: "gone skipped round 1: gave no answer within 20 min.",
        });
    });

    it("draws a failed seat as a line with its error, after the rest and before the typing rows", () => {
        const items = councilChannel(room());
        expect(byId(items, "failed:sec")).toMatchObject({
            kind: "failure",
            author: "sec",
            round: 2,
            error: "the reply was not valid JSON",
            text: "Security failed while replying",
        });
        const order = ids(items);
        expect(order.indexOf("r9")).toBeLessThan(order.indexOf("failed:sec"));
        expect(order.indexOf("failed:sec")).toBeLessThan(order.indexOf("typing:witness"));
    });

    it("says where a failure failed by the council's own rounds", () => {
        const failureText = (c: Council, round: number) =>
            councilChannel({ ...c, failed: { sk: { round, error: "x" } } }).find((i) => i.kind === "failure");
        const two = council();
        expect(failureText(two, 1)).toMatchObject({ text: "Skeptic failed while proposing" });
        expect(failureText(two, 2)).toMatchObject({ text: "Skeptic failed while replying" });
        expect(failureText(two, 3)).toMatchObject({ text: "Skeptic failed while writing the summary" });
        expect(failureText(two, 4)).toMatchObject({ text: "Skeptic failed while answering" });
        const three = council({ rounds: 3 });
        expect(failureText(three, 3)).toMatchObject({ text: "Skeptic failed while replying" });
        expect(failureText(three, 4)).toMatchObject({ text: "Skeptic failed while writing the summary" });
        expect(failureText(three, 5)).toMatchObject({ text: "Skeptic failed while answering" });
    });

    it("draws a typing row for each seat at work, last, and what a seat waiting on an agent waits on", () => {
        const items = councilChannel(room());
        expect(ids(items).slice(-2)).toEqual(["typing:witness", "typing:ux"]);
        expect(byId(items, "typing:ux")).toMatchObject({
            kind: "typing",
            author: "ux",
            text: "UX audit is writing…",
            waiting: false,
            on: "title P1",
            proposalid: "P1",
        });
        expect(byId(items, "typing:witness")).toMatchObject({
            text: "Waiting for Witness synthesis to finish its task",
            waiting: true,
            on: "",
        });
    });

    it("draws no typing row for a council that is not running", () => {
        expect(councilChannel(room({ state: "awaiting-you" })).some((i) => i.kind === "typing")).toBe(false);
    });
});

describe("councilThread", () => {
    it("has the idea on top and its replies in the order they were posted, a held one among them as a draft", () => {
        const thread = councilThread(room(), "P1")!;
        expect(thread.idea).toMatchObject({ id: "P1", kind: "idea", title: "title P1", thread: { count: 3 } });
        expect(thread.items.map((i) => [i.kind, i.id])).toEqual([
            ["reply", "r3"],
            ["reply", "r4"],
            ["reply", "r5"],
            ["draft", "r6"],
            ["typing", "typing:ux"],
        ]);
    });

    it("words a reply by its stance: has doubts, builds on it, is against it, replies", () => {
        const c = council({
            proposals: [prop("P1", "sec", 60)],
            replies: [
                reply("r1", "sk", 150, { stance: "challenge" }),
                reply("r2", "ux", 160, { stance: "accept", builds: true }),
                reply("r3", "witness", 170, { stance: "oppose" }),
                reply("r4", "sk", 180, { stance: "accept" }),
                reply("r5", "ux", 190),
            ],
        });
        const labels = councilThread(c, "P1")!.items.map((i) => [
            i.id,
            (i as { label: string }).label,
            (i as { pill: string }).pill,
        ]);
        expect(labels).toEqual([
            ["r1", "has doubts", "challenge"],
            ["r2", "builds on it", "accept"],
            ["r3", "is against it", "oppose"],
            ["r4", "replies", "neutral"],
            ["r5", "replies", "neutral"],
        ]);
    });

    it("leaves the agreements out, as the idea's message carries them", () => {
        const thread = councilThread(room(), "P1")!;
        expect(thread.items.map((i) => i.id)).not.toContain("r2");
        expect(thread.idea.agrees).toEqual(["Skeptic agrees"]);
    });

    it("shows a held reply as a draft with its three actions, and leaves a dropped one out", () => {
        const thread = councilThread(room(), "P1")!;
        const draft = thread.items.find((i) => i.id === "r6");
        expect(draft).toMatchObject({
            kind: "draft",
            of: "reply",
            author: "sk",
            label: "is against it",
            pill: "oppose",
            on: "title P1",
            at: "3:20",
        });
        expect((draft as { actions: typeof DRAFT_ACTIONS }).actions).toBe(DRAFT_ACTIONS);
        expect(councilThread(room(), "P2")!.items).toEqual([]);
    });

    it("says an edited reply was edited, and the person's reply who it reaches and what it waits for", () => {
        const items = councilThread(room(), "P1")!.items;
        expect(items.find((i) => i.id === "r4")).toMatchObject({ edited: true, mine: false });
        expect(items.find((i) => i.id === "r5")).toMatchObject({
            author: "you",
            mine: true,
            label: "replies",
            reaches: "For Witness synthesis",
            pending: "Answered after the summary",
        });
    });

    it("has a typing row only for the seats replying on this idea", () => {
        expect(councilThread(room(), "P1")!.items.some((i) => i.kind === "typing")).toBe(true);
        expect(councilThread(room(), "P3")!.items.some((i) => i.kind === "typing")).toBe(false);
        expect(councilThread(room({ state: "awaiting-you" }), "P1")!.items.some((i) => i.kind === "typing")).toBe(
            false
        );
    });

    it("has no thread for an idea that is held, dropped or not there", () => {
        expect(councilThread(room(), "P4")).toBeNull();
        expect(councilThread(room(), "P5")).toBeNull();
        expect(councilThread(room(), "P99")).toBeNull();
    });
});

describe("ideaOrder and moveIdea", () => {
    it("lists the ideas in the order the channel draws them, a held or dropped one left out", () => {
        expect(ideaOrder(room())).toEqual(["P1", "P2", "P3"]);
        expect(ideaOrder(council())).toEqual([]);
    });

    it("moves down and up, stops at the ends, and starts at the first (or last) with none focused", () => {
        const order = ["P1", "P2", "P3"];
        expect(moveIdea(order, null, 1)).toBe("P1");
        expect(moveIdea(order, null, -1)).toBe("P3");
        expect(moveIdea(order, "P1", 1)).toBe("P2");
        expect(moveIdea(order, "P2", -1)).toBe("P1");
        expect(moveIdea(order, "P3", 1)).toBe("P3");
        expect(moveIdea(order, "P1", -1)).toBe("P1");
        expect(moveIdea(order, "gone", 1)).toBe("P1");
        expect(moveIdea([], "P1", 1)).toBeNull();
    });
});

describe("seatChips", () => {
    const chips = (c: Council) => Object.fromEntries(seatChips(c).map((s) => [s.id, s]));

    it("names each seat's kind: an agent's context, an expert's model, in the council's order", () => {
        const all = seatChips(room());
        expect(all.map((s) => [s.id, s.kind])).toEqual([
            ["witness", "agent · 625k"],
            ["ux", "agent · 210k"],
            ["sec", "expert · sonnet"],
            ["sk", "expert · sonnet"],
            ["coordinator", "expert · opus"],
        ]);
    });

    it("writes a context of a million or more in millions, and none of an unknown one", () => {
        const c = council({ experts: [agent("a", "t-a", "Big", 1_200_000), agent("b", "t-b", "Unknown", 0)] });
        expect(seatChips(c).map((s) => s.kind)).toEqual(["agent · 1.2M", "agent"]);
        const bare = council({ experts: [{ id: "x", name: "X", brief: "", model: "" }] });
        expect(seatChips(bare)[0].kind).toBe("expert");
    });

    it("gives an agent its tab for a click on its chip, and a role expert none", () => {
        const s = chips(room());
        expect(s.witness).toMatchObject({
            agent: true,
            tab: "t-w",
            title: "Witness synthesis (live agent). Click to open its terminal.",
        });
        expect(s.sec).toMatchObject({
            agent: false,
            tab: "",
            title: "Role expert, a fresh session that sees only this chat.",
        });
        expect(s.coordinator.title).toBe("Writes the summary at the end.");
    });

    it("says what a seat at work is doing, a seat waiting on an agent in amber", () => {
        const s = chips(room());
        expect(s.ux).toMatchObject({ dot: "working", doing: "Replying to Security", retry: false });
        expect(s.witness).toMatchObject({ dot: "waiting", doing: "Waiting for Witness synthesis to finish its task" });
    });

    it("marks a failed seat red with Retry", () => {
        expect(chips(room()).sec).toMatchObject({ dot: "failed", doing: "Failed while replying", retry: true });
    });

    it("says a seat holding drafts has drafts waiting for the person", () => {
        const c = room({ activity: {}, failed: {} });
        const s = chips(c);
        expect(s.witness).toMatchObject({ dot: "waiting", doing: "1 draft waits for you" });
        expect(s.sk).toMatchObject({ dot: "waiting", doing: "1 draft waits for you" });
        expect(s.ux).toMatchObject({ dot: "waiting", doing: "1 draft waits for you" });
        expect(s.sec.dot).toBe("idle");
    });

    it("says a seat skipped the round it is in", () => {
        const c = room({ activity: {}, failed: {}, replies: [], proposals: [prop("P1", "sec", 60)] });
        expect(chips(c).witness).toMatchObject({ dot: "idle", doing: "Skipped round 2" });
        expect(chips({ ...c, round: 3 }).witness.doing).not.toBe("Skipped round 2");
    });

    it("falls back to where the seat stands, the coordinator waiting for the answer", () => {
        const c = council({ proposals: [prop("P1", "sec", 60)] });
        expect(chips(c).coordinator).toMatchObject({ dot: "idle", doing: "Waits for the answer" });
        expect(chips({ ...c, state: "done", round: 3 }).sec).toMatchObject({ dot: "idle", doing: "1 idea" });
    });

    it("counts only the sent ideas in what a seat has posted", () => {
        const c = council({
            state: "done",
            round: 3,
            proposals: [prop("P1", "sec", 60), prop("P2", "sec", 70, { draft: "dropped" }), prop("P3", "sk", 80)],
        });
        expect(chips(c).sec.doing).toBe("1 idea");
    });
});

describe("stepChip", () => {
    it("reads the round and the drafts that wait, in amber", () => {
        expect(stepChip(room())).toEqual({ text: "Round 2 of 2 · 3 drafts wait for you", dot: "waiting" });
    });

    it("is green while the council runs with nothing held", () => {
        const c = council({ proposals: [prop("P1", "sec", 60)] });
        expect(stepChip(c)).toEqual({ text: "Round 2 of 2", dot: "working" });
        expect(stepChip({ ...c, round: 3 })).toEqual({ text: "Writing the summary", dot: "working" });
        expect(stepChip(council({ rounds: 3, round: 3 }))).toEqual({ text: "Round 3 of 3", dot: "working" });
    });

    it("is amber for a council that waits on the person, grey once it is done, red when it failed", () => {
        expect(stepChip(council({ state: "awaiting-you", round: 1 }))).toEqual({
            text: "Waiting on you",
            dot: "waiting",
        });
        expect(stepChip(council({ state: "done", round: 3 }))).toEqual({ text: "Done", dot: "idle" });
        expect(stepChip(council({ state: "failed" }))).toEqual({ text: "Failed", dot: "failed" });
    });

    it("keeps a done council's held follow-up answer in the chip", () => {
        const c = council({
            state: "done",
            round: 4,
            proposals: [prop("P1", "sec", 60)],
            replies: [reply("r1", "sk", 300, { round: 4, draft: "held" })],
        });
        expect(stepChip(c)).toEqual({ text: "Done · 1 draft waits for you", dot: "waiting" });
    });
});

describe("replyReach", () => {
    it("says everyone answers a post to the whole council", () => {
        expect(replyReach(room(), "", "", "")).toEqual({
            names: ["Witness synthesis", "UX audit", "Security", "Skeptic"],
            label: "Everyone answers",
        });
    });

    it("names the seats an @ picks", () => {
        expect(replyReach(room(), "", "", "@Skeptic what do you think?")).toEqual({
            names: ["Skeptic"],
            label: "Answered by: Skeptic",
        });
        expect(replyReach(room(), "", "", "@Witness synthesis and @ux").names).toEqual([
            "Witness synthesis",
            "UX audit",
        ]);
    });

    it("names an idea's author in its thread, and the seats on the path to the reply it answers", () => {
        expect(replyReach(room(), "P1", "", "a question")).toEqual({
            names: ["Security"],
            label: "Answered by: Security",
        });
        expect(replyReach(room(), "P1", "r3", "a question")).toEqual({
            names: ["Witness synthesis", "Security"],
            label: "Answered by: Witness synthesis, Security",
        });
    });

    it("asks for an @ when no seat would answer", () => {
        const c = council({ proposals: [prop("P1", "gone", 60)] });
        expect(replyReach(c, "P1", "", "hm")).toEqual({
            names: [],
            label: "Name a seat with @ to choose who answers",
        });
    });
});

describe("mentionPicker and insertMention", () => {
    it("lists every seat but the coordinator for a bare @", () => {
        const picker = mentionPicker(room(), "@", 1)!;
        expect(picker.start).toBe(0);
        expect(picker.seats.map((e) => e.id)).toEqual(["witness", "ux", "sec", "sk"]);
    });

    it("narrows to the seats whose name or id holds what was typed after the @", () => {
        expect(mentionPicker(room(), "hi @wit", 7)).toMatchObject({ start: 3, seats: [{ id: "witness" }] });
        expect(mentionPicker(room(), "ask @se about it", 7)).toMatchObject({ start: 4, seats: [{ id: "sec" }] });
        expect(mentionPicker(room(), "@UX", 3)!.seats.map((e) => e.id)).toEqual(["ux"]);
    });

    it("stays shut away from an @, inside a word, when nothing matches, and after a whole name and a space", () => {
        expect(mentionPicker(room(), "no mention", 10)).toBeNull();
        expect(mentionPicker(room(), "mail a@b", 8)).toBeNull();
        expect(mentionPicker(room(), "@zzz", 4)).toBeNull();
        expect(mentionPicker(room(), "@Witness synthesis ", 19)).toBeNull();
        expect(mentionPicker(room(), "@Witness s", 10)).toMatchObject({ seats: [{ id: "witness" }] });
    });

    it("replaces what was typed with the seat's name and a space, and puts the caret after it", () => {
        expect(insertMention("hi @wit", 3, 7, { name: "Witness synthesis" })).toEqual({
            text: "hi @Witness synthesis ",
            caret: 22,
        });
        expect(insertMention("ask @se about it", 4, 7, { name: "Security" })).toEqual({
            text: "ask @Security about it",
            caret: 14,
        });
    });

    it("makes an @ that replyReach reads as the seat", () => {
        const text = insertMention("@wit", 0, 4, { name: "Witness synthesis" }).text;
        expect(replyReach(room(), "", "", text).names).toEqual(["Witness synthesis"]);
    });
});

// a council saved before live agents: no rounds, no drafts, no agents, no skips, in today's round 2 and done shapes
describe("a council saved before live agents", () => {
    const old = (extra: Partial<Council> = {}): Council => ({
        id: "old",
        project: "D:\\code\\arc",
        feature: "Rail apps",
        question: "Which changes to the rail are worth making first?",
        experts: oldExperts,
        state: "running",
        round: 2,
        started: STARTED,
        proposals: [prop("P1", "ux", 60), prop("P2", "ram", 100), prop("P3", "nu", 132)],
        replies: [
            reply("r1", "ram", 150, { stance: "challenge" }),
            reply("r2", "nu", 151, { stance: "accept", text: "" }),
            reply("r3", "ux", 152, { proposalid: "P2", stance: "accept" }),
        ],
        tokens: 0,
        calls: 0,
        created: 0,
        updated: 0,
        ...extra,
    });

    it("reads as today's two rounds in round 2: a divider for each, the ideas, a chip for the replies", () => {
        const c = old({ activity: { ram: { text: "Replying to UX", proposalid: "P1" } } });
        const items = councilChannel(c);
        expect(ids(items)).toEqual(["question", "round:1", "P1", "P2", "P3", "round:2", "typing:ram"]);
        expect(byId(items, "P1")).toMatchObject({
            thread: { count: 1, label: "1 reply", last: "Last reply 2:30", drafts: 0 },
            agrees: ["New user agrees"],
            tag: "expert",
            picks: null,
        });
        expect(byId(items, "P2")).toMatchObject({ thread: { count: 1 } });
        expect(byId(items, "typing:ram")).toMatchObject({ text: "RAM is writing…", on: "title P1" });
        expect(stepChip(c)).toEqual({ text: "Round 2 of 2", dot: "working" });
        expect(seatChips(c).map((s) => [s.agent, s.kind, s.retry])).toEqual([
            [false, "expert · sonnet", false],
            [false, "expert · sonnet", false],
            [false, "expert · sonnet", false],
            [false, "expert · opus", false],
        ]);
    });

    it("reads as a finished council: the summary's round is no divider, a follow-up is in the channel and its thread", () => {
        const c = old({
            state: "done",
            round: 4,
            summary: { text: "", directions: [], outcomes: {}, at: at(300) },
            picks: { ux: ["P1"], ram: ["P1"], nu: ["P2"] },
            replies: [
                reply("r1", "ram", 150, { stance: "challenge" }),
                reply("r2", "you", 400, { round: 4, proposalid: "", to: ["ux", "ram", "nu"] }),
                reply("r3", "ux", 410, { round: 4, proposalid: "", parentid: "r2" }),
                reply("r4", "you", 420, { round: 4, to: ["ram"], answered: true }),
            ],
        });
        const items = councilChannel(c);
        expect(ids(items)).toEqual(["question", "round:1", "P1", "P2", "P3", "round:2", "r2", "r3"]);
        expect(byId(items, "P1")).toMatchObject({
            picks: { count: 2, title: "Picked by 2 of 3 experts" },
            thread: { count: 2, last: "Last reply 7:00" },
        });
        expect(byId(items, "P3")).toMatchObject({ picks: null });
        expect(byId(items, "r2")).toMatchObject({ label: "steers", reaches: "For everyone", pending: "" });
        expect(byId(items, "r3")).toMatchObject({ author: "ux", parentid: "r2", label: "replies" });
        expect(councilThread(c, "P1")!.items.map((i) => i.id)).toEqual(["r1", "r4"]);
        expect(councilThread(c, "P1")!.items[1]).toMatchObject({ mine: true, reaches: "For RAM", pending: "" });
        expect(stepChip(c)).toEqual({ text: "Done", dot: "idle" });
    });

    it("holds nothing and draws nothing for drafts, skips or an agent", () => {
        const items = councilChannel(old({ state: "done", round: 3 }));
        expect(items.some((i) => i.kind === "draft" || i.kind === "skip")).toBe(false);
        expect(stepChip(old({ state: "done", round: 3 }))).toEqual({ text: "Done", dot: "idle" });
        expect(councilThread(old(), "P1")!.items.map((i) => i.id)).toEqual(["r1"]);
        expect(ideaOrder(old())).toEqual(["P1", "P2", "P3"]);
    });
});
