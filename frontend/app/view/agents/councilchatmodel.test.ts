import { describe, expect, it } from "vitest";
import {
    DRAFT_ACTIONS,
    DRAFT_WAIT,
    ROUTER_DECIDES,
    askChips,
    askTooSeats,
    chatMentionKeys,
    chipShort,
    contextLabel,
    councilChannel,
    councilThread,
    foldSettle,
    foldToggle,
    foldView,
    ideaOrder,
    insertAllMention,
    insertChatMention,
    insertFileMention,
    insertMention,
    joinableChats,
    linkIn,
    mentionPicker,
    messageSegments,
    moveIdea,
    namedFile,
    onlyLine,
    pickedChats,
    pickerRows,
    questionPost,
    readsChoice,
    readsFiles,
    readsNote,
    replyReach,
    routerLine,
    seatChips,
    seatLink,
    stepChip,
    threadAsks,
    toolsOfChoice,
    type ChannelItem,
    type IdeaPost,
    type Who,
} from "./councilchatmodel";
import { CHAT_THREAD } from "./councillistmodel";
import { seatMentions, type SeatableAgent } from "./councilmodel";

// local time, so the times of day the chat shows read the same in every time zone
const STARTED = new Date(2026, 9, 31, 14, 0, 0).getTime();
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

function ideaOf(c: Council, id: string): IdeaPost {
    const thread = councilThread(c, id);
    if (thread?.kind !== "idea") {
        throw new Error(`no thread for the idea ${id}`);
    }
    return thread.idea;
}

describe("the question's fold", () => {
    it("opens a folded question and closes an open one, through the phases in which its height moves", () => {
        expect(foldToggle("folded")).toBe("opening");
        expect(foldToggle("open")).toBe("closing");
        expect(foldSettle("opening")).toBe("open");
        expect(foldSettle("closing")).toBe("folded");
    });

    it("ignores a click while the height moves, and settles a phase that is not moving as it is", () => {
        expect(foldToggle("opening")).toBeNull();
        expect(foldToggle("closing")).toBeNull();
        expect(foldSettle("folded")).toBe("folded");
        expect(foldSettle("open")).toBe("open");
    });

    it("draws three lines and two limits only when folded; the label and aria-expanded follow the intent", () => {
        expect(foldView("folded")).toEqual({ expanded: false, clamp: true, allLimits: false });
        // opening: the whole text and every limit are drawn, so the height can grow into them
        expect(foldView("opening")).toEqual({ expanded: true, clamp: false, allLimits: true });
        expect(foldView("open")).toEqual({ expanded: true, clamp: false, allLimits: true });
        // closing: still all of it until the height has come down, but the control already reads Show more
        expect(foldView("closing")).toEqual({ expanded: false, clamp: false, allLimits: true });
    });
});

describe("questionPost", () => {
    it("is the person's question as a message of theirs, at the time the council started", () => {
        expect(questionPost(council())).toEqual({
            kind: "question",
            id: "question",
            author: "you",
            name: "You",
            initials: "Y",
            tone: "you",
            tag: "",
            tab: "",
            transcript: "",
            label: "asked",
            text: "Which changes to the rail are worth making first?",
            limits: [],
            at: "14:00",
            when: "Oct 31 14:00 · 0:00 into the council",
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
            replies: [
                reply("r1", "sk", 150, { round: 2, proposalid: "" }),
                reply("r2", "sk", 250, { round: 3, proposalid: "" }),
            ],
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

    it("leaves out the divider of a round whose replies are all on ideas, in their threads", () => {
        const c = council({
            rounds: 3,
            round: 3,
            state: "done",
            proposals: [prop("P1", "sec", 60)],
            replies: [reply("r1", "sk", 150, { round: 2 }), reply("r2", "sk", 250, { round: 3, proposalid: "" })],
        });
        expect(ids(councilChannel(c))).toEqual(["question", "round:1", "P1", "round:3", "r2"]);
        expect(ids(councilChannel(c, "sk"))).toEqual(["question", "round:2", "r1", "round:3", "r2"]);
    });

    it("puts the person's post of a round after that round's divider", () => {
        const items = councilChannel(room());
        const ordered = ids(items);
        expect(ordered.indexOf("round:2")).toBeLessThan(ordered.indexOf("r1"));
        expect(ordered.indexOf("P4")).toBeLessThan(ordered.indexOf("round:2"));
    });
});

describe("councilChannel: an idea", () => {
    it("is a message with its author, evidence and the time it came", () => {
        const items = councilChannel(room());
        expect(byId(items, "P1")).toMatchObject({
            kind: "idea",
            author: "sec",
            name: "Security",
            tag: "expert",
            label: "proposes",
            title: "title P1",
            text: "argument P1",
            claim: { evidence: [{ ref: "pkg/services/model.go:38" }], label: "", lang: "en" },
            wild: false,
            edited: false,
            at: "14:01",
            when: "Oct 31 14:01 · 1:00 into the council",
        });
    });

    it("carries the person's thumb, and none when there is none or the word is unknown", () => {
        const c = room();
        c.proposals[0].thumb = "like";
        c.proposals[1].thumb = "love";
        const items = councilChannel(c);
        expect(byId(items, "P1")).toMatchObject({ thumb: "like" });
        expect(byId(items, "P2")).toMatchObject({ thumb: "" });
        expect(byId(items, "P3")).toMatchObject({ thumb: "" });
    });

    it("tags a live agent's idea as an agent's", () => {
        expect(byId(councilChannel(room()), "P3")).toMatchObject({
            author: "ux",
            name: "UX audit · t-u",
            tag: "agent",
        });
    });

    it("carries its evidence as Go checked it, its check label and the council's language, for the chips under it", () => {
        const c = room({ lang: "vi" });
        c.proposals[1].label = "read";
        c.proposals[1].evidence = [
            { ref: "a.ts:1", cite: "ok" },
            { ref: "b.ts:900", cite: "wrong", citenote: "line 900 is past the end (412 lines)" },
            { ref: "", weak: true, note: "no measurement" },
        ];
        expect(ideaOf(c, "P2").claim).toEqual({ evidence: c.proposals[1].evidence, label: "read", lang: "vi" });
        // a council with no language reads as English, and an idea Go did not label has none
        expect(ideaOf(room(), "P2").claim).toMatchObject({ label: "", lang: "en" });
    });

    it("carries the claim of a seat's reply and of a held draft, idea or reply", () => {
        const c = room({ lang: "vi" });
        c.replies.find((r) => r.id === "r3")!.label = "guess";
        c.replies.find((r) => r.id === "r6")!.label = "ran";
        c.proposals.find((p) => p.id === "P4")!.label = "disproved";
        const items = councilThread(c, "P1")!.items;
        expect(byId(items, "r3")).toMatchObject({ claim: { label: "guess", lang: "vi" } });
        // a reply Go did not label has no badge
        expect(byId(items, "r4")).toMatchObject({ claim: { label: "", lang: "vi" } });
        expect(byId(items, "r6")).toMatchObject({ kind: "draft", claim: { label: "ran", lang: "vi" } });
        expect(councilThread(c, "P4")!).toMatchObject({ draft: { kind: "draft", claim: { label: "disproved" } } });
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

    it("marks an idea its author withdrew, and its withdrawal reply with a pill and the reason as its words", () => {
        const c = council({
            proposals: [prop("P1", "sec", 60, { withdrawn: true }), prop("P2", "sk", 100)],
            replies: [
                reply("r1", "sk", 150, { stance: "challenge", text: "Too broad." }),
                reply("r2", "sec", 160, { revised: true, withdraws: true, text: "Skeptic's idea covers it." }),
                // a withdrawal with no reason has no words, and is no agreement
                reply("r3", "sk", 170, { proposalid: "P2", revised: true, withdraws: true, text: "" }),
                // one from before Go marked it reads Go's old fixed line, which says nothing the pill does not
                reply("r4", "sec", 180, { proposalid: "P2", revised: true, text: "Withdrawn." }),
                reply("r5", "sec", 190, { proposalid: "P2", revised: true, text: "Retitled: Smaller." }),
            ],
        });
        expect(byId(councilChannel(c), "P1")).toMatchObject({ withdrawn: true });
        expect(byId(councilChannel(c), "P2")).toMatchObject({ withdrawn: false, agrees: [] });
        const p1 = councilThread(c, "P1")!.items;
        expect(byId(p1, "r1")).toMatchObject({ label: "has doubts", pill: "challenge" });
        expect(byId(p1, "r2")).toMatchObject({ label: "withdrew it", pill: "out", text: "Skeptic's idea covers it." });
        const p2 = councilThread(c, "P2")!.items;
        expect(byId(p2, "r3")).toMatchObject({ kind: "reply", label: "withdrew it", pill: "out", text: "" });
        expect(byId(p2, "r4")).toMatchObject({ label: "withdrew it", pill: "out", text: "" });
        expect(byId(p2, "r5")).toMatchObject({ label: "replies", pill: "neutral", text: "Retitled: Smaller." });
    });

    it("marks a held withdrawal draft with the pill too", () => {
        const c = council({
            proposals: [prop("P1", "sec", 60)],
            replies: [
                reply("r1", "sec", 160, {
                    revised: true,
                    withdraws: true,
                    text: "Covered elsewhere.",
                    draft: "held",
                    revision: { withdraw: true },
                }),
            ],
        });
        expect(byId(councilThread(c, "P1")!.items, "r1")).toMatchObject({
            kind: "draft",
            label: "withdrew it",
            pill: "out",
            text: "Covered elsewhere.",
        });
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
            thread: {
                count: 3,
                label: "3 replies",
                last: "Last reply 14:03",
                lastWhen: "Oct 31 14:03 · 3:10 into the council",
                drafts: 1,
            },
        });
        const repliers = (idea as { thread: { repliers: { author: string; name: string; tag: string }[] } }).thread
            .repliers;
        expect(repliers.map((r) => [r.author, r.name, r.tag])).toEqual([
            ["witness", "Witness synthesis · t-w", "agent"],
            ["ux", "UX audit · t-u", "agent"],
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

    it("gives the time of the last reply for a council with no start too, with no council clock in its tooltip", () => {
        const c = council({
            started: undefined,
            proposals: [prop("P1", "sec", 60)],
            replies: [reply("r1", "sk", 150)],
        });
        expect(byId(councilChannel(c), "P1")).toMatchObject({
            thread: { count: 1, last: "Last reply 14:02", lastWhen: "Oct 31 14:02" },
        });
    });

    it("has no time of a last reply with no replies", () => {
        const c = council({ proposals: [prop("P1", "sec", 60)] });
        expect(byId(councilChannel(c), "P1")).toMatchObject({ thread: { count: 0, last: "", lastWhen: "" } });
    });

    it("keeps a sent reply to an idea in its thread alone, the person's too, and only a held one in the channel", () => {
        const items = ids(councilChannel(room()));
        for (const id of ["r2", "r3", "r4", "r5"]) {
            expect(items).not.toContain(id);
        }
        expect(items).toContain("r6");
        expect(ids(councilThread(room(), "P1")!.items)).toEqual(expect.arrayContaining(["r3", "r4", "r5", "r6"]));
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
            at: "14:02",
            when: "Oct 31 14:02 · 2:11 into the council",
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

    it("shows a held reply to an idea as a draft in the channel, and the chip counts it", () => {
        const items = councilChannel(room());
        expect(byId(items, "r6")).toMatchObject({ kind: "draft", of: "reply", on: "title P1" });
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
    it("never carries a thumb on the person's own post, and does on a seat's reply", () => {
        const c = room();
        c.replies[0].thumb = "like"; // r1, the person's
        c.replies[7].thumb = "dislike"; // r8, Skeptic's answer to r1
        const items = councilChannel(c);
        expect(byId(items, "r1")).toMatchObject({ mine: true, thumb: "" });
        expect(byId(items, "r8")).toMatchObject({ mine: false, thumb: "dislike" });
    });

    it("shows a post to the whole council as a message of theirs that steers, and reaches everyone", () => {
        expect(byId(councilChannel(room()), "r1")).toMatchObject({
            kind: "reply",
            author: "you",
            name: "You",
            tone: "you",
            label: "steers",
            mine: true,
            to: null,
            pending: "Answered after the summary",
            at: "14:02",
            when: "Oct 31 14:02 · 2:30 into the council",
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
        expect(byId(items, "r1")).toMatchObject({
            to: {
                by: "you",
                seats: [{ author: "witness", name: "Witness synthesis · t-w" }, { author: "ux" }],
                everyone: false,
                title: "For Witness synthesis · t-w and UX audit · t-u",
            },
        });
        expect(byId(items, "r2")).toMatchObject({ to: { by: "you", seats: [{ author: "sk" }], title: "For Skeptic" } });
        expect(byId(items, "r3")).toMatchObject({ to: null });
    });

    it("knows when a post reaches whom it would anyway: everyone from the channel, the idea's seat in its thread", () => {
        const c = room({
            replies: [
                ...room().replies,
                reply("r10", "you", 240, { to: ["sec"] }),
                reply("r11", "you", 250, { proposalid: "", to: ["sk"] }),
            ],
        });
        const items = councilChannel(c);
        expect(byId(items, "r1")).toMatchObject({ to: null });
        expect(byId(items, "r11")).toMatchObject({ to: { by: "you", title: "For Skeptic" } });
        const thread = councilThread(c, "P1")!.items;
        // P1 is Security's: a reply to Witness is worth saying, one to Security goes without saying
        expect(thread.find((i) => i.id === "r5")).toMatchObject({
            to: { by: "you", seats: [{ author: "witness" }], title: "For Witness synthesis · t-w" },
        });
        expect(thread.find((i) => i.id === "r10")).toMatchObject({ to: null });
        // a seat's reply carries none
        expect(thread.find((i) => i.id === "r3")).toMatchObject({ to: null, asks: [] });
    });

    it("says a post waits for the next step while the council waits on the person", () => {
        const c = council({
            state: "awaiting-you",
            round: 1,
            replies: [reply("r1", "you", 150, { proposalid: "", round: 1, to: ["sk"] })],
        });
        expect(byId(councilChannel(c), "r1")).toMatchObject({ pending: "Queued for the next step" });
    });

    it("shows the seats that answered a post with no words as `agrees` under the first answer with words", () => {
        const c = council({
            state: "done",
            replies: [
                reply("r1", "you", 150, { proposalid: "", to: ["witness", "ux", "sec", "sk"] }),
                reply("r2", "sec", 160, { proposalid: "", parentid: "r1", round: 3 }),
                reply("r3", "sk", 170, { proposalid: "", parentid: "r1", round: 3, text: "" }),
                reply("r4", "ux", 170, { proposalid: "", parentid: "r1", round: 3, text: "Only this part is new." }),
                reply("r5", "witness", 171, { proposalid: "", parentid: "r1", round: 3, text: " " }),
            ],
        });
        const items = councilChannel(c);
        expect(ids(items.filter((i) => i.kind === "reply"))).toEqual(["r1", "r2", "r4"]);
        expect(byId(items, "r2")).toMatchObject({ agrees: ["Skeptic agrees", "Witness synthesis · t-w agrees"] });
        expect(byId(items, "r4")).toMatchObject({ agrees: [] });
        expect(byId(items, "r1")).toMatchObject({ agrees: [] });
    });

    it("keeps the `agrees` under the post itself while its first answer waits as a draft", () => {
        const c = council({
            replies: [
                reply("r1", "you", 150, { proposalid: "", to: ["witness", "sk"] }),
                reply("r2", "witness", 160, { proposalid: "", parentid: "r1", round: 3, draft: "held" }),
                reply("r3", "sk", 170, { proposalid: "", parentid: "r1", round: 3, text: "" }),
            ],
        });
        expect(byId(councilChannel(c), "r1")).toMatchObject({ agrees: ["Skeptic agrees"] });
    });

    it("shows a seat's answer to the whole council in the channel, with no `mine` and no reach", () => {
        expect(byId(councilChannel(room()), "r8")).toMatchObject({
            kind: "reply",
            author: "sk",
            label: "replies",
            mine: false,
            to: null,
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
            text: `Witness synthesis · t-w skipped round 2: ${SKIP_REASON}.`,
            at: "14:03",
            when: "Oct 31 14:03 · 3:00 into the council",
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

    it("draws a seat's failure under the post it failed on, not under the posts sent after it", () => {
        const limit = "You've hit your 5-hour limit · resets 6:50pm";
        const c = room({
            activity: {},
            failed: { sk: { round: 4, error: limit } },
            replies: [
                reply("h1", "you", 300, { proposalid: "", round: 4, to: ["sk"], answered: true }),
                reply("h2", "you", 400, { proposalid: "", round: 5, to: ["sec"] }),
            ],
        });
        const items = councilChannel(c);
        const order = ids(items);
        expect(order.indexOf("failed:sk")).toBe(order.indexOf("h1") + 1);
        expect(order.indexOf("failed:sk")).toBeLessThan(order.indexOf("h2"));
        // the line says it, so the post does not say it again
        expect(byId(items, "h1")).toMatchObject({ pending: "" });
        expect(byId(items, "failed:sk")).toMatchObject({ error: limit });
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
            text: "UX audit · t-u is writing…",
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
        expect(ideaOf(room(), "P1")).toMatchObject({ id: "P1", kind: "idea", title: "title P1", thread: { count: 3 } });
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
        expect(ideaOf(room(), "P1").agrees).toEqual(["Skeptic agrees"]);
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
            at: "14:03",
            when: "Oct 31 14:03 · 3:20 into the council",
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
            to: { by: "you", title: "For Witness synthesis · t-w" },
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

    it("opens a held idea on its draft alone, and has no thread for one dropped or not there", () => {
        expect(councilThread(room(), "P4")).toMatchObject({ kind: "held", draft: { of: "idea" }, items: [] });
        expect(councilThread(room(), "P5")).toBeNull();
        expect(councilThread(room(), "P99")).toBeNull();
    });
});

describe("ideaOrder and moveIdea", () => {
    it("lists the ideas in the order the channel draws them, a held or dropped one left out", () => {
        expect(ideaOrder(councilChannel(room()))).toEqual(["P1", "P2", "P3"]);
        expect(ideaOrder(councilChannel(council()))).toEqual([]);
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

    it("opens a live chat seat's terminal from its name, its session's title on hover", () => {
        const items = councilChannel(room());
        const idea = byId(items, "P3") as Who; // UX audit's, a chat seat on tab t-u
        expect(idea).toMatchObject({ name: "UX audit · t-u", tab: "t-u" });
        expect(seatLink(idea, [{ id: "t-u", task: "Audit the rail's spacing" }])).toEqual({
            tab: "t-u",
            title: "Audit the rail's spacing · click to go to it",
            reopen: "",
        });
        expect(seatLink(idea, [{ id: "t-u" }])).toEqual({
            tab: "t-u",
            title: "Go to UX audit · t-u",
            reopen: "",
        });
        // a chat whose tab is gone and whose session the council never kept, and a role expert, open nothing
        expect(seatLink(idea, [])).toBeNull();
        expect(seatLink(byId(items, "P1") as Who, [{ id: "t-u" }])).toBeNull();
    });

    it("follows a closed chat seat's session to the tab that holds it now, or opens it again", () => {
        const seat = { tab: "t-old", name: "notes · t-old", transcript: "/s/notes.jsonl" };
        // its session reopened in another tab (Resume, Open asleep): that tab opens
        expect(seatLink(seat, [{ id: "t-new", task: "Ideas", transcript: "/s/notes.jsonl" }])).toEqual({
            tab: "t-new",
            title: "Ideas · click to go to it",
            reopen: "",
        });
        // open nowhere: a click opens its session again, so Retry finds it there
        expect(seatLink(seat, [{ id: "t-other", transcript: "/s/other.jsonl" }])).toEqual({
            tab: "",
            title: "notes · t-old's tab closed · click to open its session again",
            reopen: "/s/notes.jsonl",
        });
        // its own tab, still live, wins over another holding the same session
        expect(
            seatLink(seat, [
                { id: "t-new", transcript: "/s/notes.jsonl" },
                { id: "t-old", transcript: "/s/notes.jsonl" },
            ])?.tab
        ).toBe("t-old");
        // a council synced from another computer keeps that machine's path: the tab holding this disk's copy opens
        expect(
            seatLink({ ...seat, transcript: "/Users/me/.claude/projects/-x/notes.jsonl" }, [
                { id: "t-here", transcript: "C:\\u\\.claude\\projects\\d--x\\notes.jsonl" },
            ])?.tab
        ).toBe("t-here");
    });

    it("gives an agent its tab for a click on its chip, and a role expert none", () => {
        const s = chips(room());
        expect(s.witness).toMatchObject({
            agent: true,
            tab: "t-w",
            title: "Witness synthesis · t-w (live agent). Click to go to it.",
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

describe("chipShort", () => {
    it("draws the round as N/M and the summary step in a word", () => {
        expect(chipShort("Round 1 of 2")).toBe("Round 1/2");
        expect(chipShort("Writing the summary")).toBe("Summarizing");
    });

    it("keeps the drafts' count and drops the words the amber tone already says", () => {
        expect(chipShort("Round 2 of 2 · 3 drafts wait for you")).toBe("Round 2/2 · 3 drafts");
        expect(chipShort("Done · 1 draft waits for you")).toBe("Done · 1 draft");
    });

    it("leaves the other states as they are", () => {
        for (const t of ["Waiting on you", "Done", "Failed", "Queued", "Follow-up · 2 answering"]) {
            expect(chipShort(t)).toBe(t);
        }
    });
});

describe("replyReach", () => {
    it("says everyone answers a post to the whole council", () => {
        expect(replyReach(room(), "", "", "")).toEqual({
            names: ["Witness synthesis · t-w", "UX audit · t-u", "Security", "Skeptic"],
            label: "Everyone answers",
        });
    });

    it("names the seats an @ picks", () => {
        expect(replyReach(room(), "", "", "@Skeptic what do you think?")).toEqual({
            names: ["Skeptic"],
            label: "Answered by: Skeptic",
        });
        expect(replyReach(room(), "", "", "@Witness synthesis and @ux").names).toEqual([
            "Witness synthesis · t-w",
            "UX audit · t-u",
        ]);
    });

    it("names an idea's author in its thread, and the seats on the path to the reply it answers", () => {
        expect(replyReach(room(), "P1", "", "a question")).toEqual({
            names: ["Security"],
            label: "Answered by: Security",
        });
        expect(replyReach(room(), "P1", "r3", "a question")).toEqual({
            names: ["Witness synthesis · t-w", "Security"],
            label: "Answered by: Witness synthesis · t-w, Security",
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
        expect(replyReach(room(), "", "", text).names).toEqual(["Witness synthesis · t-w"]);
    });
});

// live chats: tab ids are UUIDs, whose 9th character is a `-`
const SEATED = "5b7c1d90-4e2a-4f6b-9a31-0c8d2e7f6a15";
const FAR = "82faafca-3b1c-4d0e-8a57-9c1e6f0d2b44";
const NEAR_A = "3e19c0d2-a1c4-4b7e-9d20-5f8a6c3e1b07";
const NEAR_B = "3e19c0d2-b7e0-4a91-8c3d-2e6f1a9b5d08";
const chat = (id: string, name: string, extra: Partial<SeatableAgent> = {}): SeatableAgent => ({
    id,
    name,
    project: "D:\\code\\arc",
    harness: "claude",
    context: 182_000,
    ...extra,
});
const far = chat(FAR, "Design review", { project: "D:\\code\\wave", harness: "pi", context: 48_000 });
const nearA = chat(NEAR_A, "Perf notes");
const nearB = chat(NEAR_B, "Perf notes");
// the room with one of its chats on a UUID tab id, so a mention key can reach it
const withSeatedChat = (extra: Partial<Council> = {}) =>
    room({ experts: [agent("witness", SEATED, "Witness synthesis", 625_000), ...experts.slice(1)], ...extra });

describe("chatMentionKeys", () => {
    it("is the first 8 characters of a lone chat's tab id", () => {
        expect([...chatMentionKeys([FAR])]).toEqual([[FAR, "82faafca"]]);
    });

    it("lengthens a key past the - until no other chat starts with it", () => {
        const keys = chatMentionKeys([NEAR_A, NEAR_B, FAR]);
        expect(keys.get(NEAR_A)).toBe("3e19c0d2-a");
        expect(keys.get(NEAR_B)).toBe("3e19c0d2-b");
        expect(keys.get(FAR)).toBe("82faafca");
    });

    it("tells apart ids that share their first 8 characters without a -", () => {
        const keys = chatMentionKeys(["3e19c0d2a1c4", "3e19c0d2b7e0"]);
        expect(keys.get("3e19c0d2a1c4")).toBe("3e19c0d2a");
        expect(keys.get("3e19c0d2b7e0")).toBe("3e19c0d2b");
    });

    it("reads case and a repeated id as one chat, and keeps a short or shadowed id whole", () => {
        expect(chatMentionKeys([FAR, FAR.toUpperCase()]).get(FAR)).toBe(FAR);
        expect(chatMentionKeys([FAR, FAR]).get(FAR)).toBe("82faafca");
        expect(chatMentionKeys(["t-w"]).get("t-w")).toBe("t-w");
        const keys = chatMentionKeys(["82faafca-1", "82faafca-1234"]);
        expect(keys.get("82faafca-1")).toBe("82faafca-1");
        expect(keys.get("82faafca-1234")).toBe("82faafca-12");
    });

    it("is empty for no chats", () => {
        expect(chatMentionKeys([]).size).toBe(0);
    });
});

describe("joinableChats and contextLabel", () => {
    it("leaves out the chats a seat holds", () => {
        const seated = chat("t-w", "Witness synthesis");
        expect(joinableChats(room(), [seated, far, nearA]).map((a) => a.id)).toEqual([FAR, NEAR_A]);
        expect(joinableChats(room(), [])).toEqual([]);
    });

    it("words a context as the Agent tree does", () => {
        expect(contextLabel(182_000)).toBe("182k");
        expect(contextLabel(1_200_000)).toBe("1.2M");
    });
});

describe("mentionPicker: the live chats under the seats", () => {
    const seated = chat("t-w", "Witness synthesis");

    it("lists the seats, then the chats no seat holds, each with its key", () => {
        const picker = mentionPicker(room(), "@", 1, [seated, far, nearA])!;
        expect(picker.start).toBe(0);
        expect(picker.seats.map((e) => e.id)).toEqual(["witness", "ux", "sec", "sk"]);
        expect(picker.chats).toEqual([
            { chat: far, key: "82faafca" },
            { chat: nearA, key: "3e19c0d2" },
        ]);
    });

    it("keys a chat against the chats seated too", () => {
        const c = withSeatedChat({
            experts: [agent("near", NEAR_B, "Perf notes", 1), ...experts.slice(1)],
        });
        expect(mentionPicker(c, "@", 1, [nearA])!.chats).toEqual([{ chat: nearA, key: "3e19c0d2-a" }]);
    });

    it("keys the chats it lists against each other", () => {
        const picker = mentionPicker(room(), "@", 1, [nearA, nearB, far])!;
        expect(picker.chats.map((x) => x.key)).toEqual(["3e19c0d2-a", "3e19c0d2-b", "82faafca"]);
    });

    it("filters both lists by what follows the @: a key, a name or a project", () => {
        const c = withSeatedChat();
        expect(mentionPicker(c, "@5b7", 4, [far, nearA])).toMatchObject({ seats: [{ id: "witness" }], chats: [] });
        expect(mentionPicker(c, "@82f", 4, [far, nearA])).toMatchObject({ seats: [], chats: [{ chat: far }] });
        expect(mentionPicker(c, "@design", 7, [far, nearA])!.chats.map((x) => x.chat.id)).toEqual([FAR]);
        expect(mentionPicker(c, "@wave", 5, [far, nearA])!.chats.map((x) => x.chat.id)).toEqual([FAR]);
        expect(mentionPicker(c, "@PERF", 5, [far, nearA])!.chats.map((x) => x.chat.id)).toEqual([NEAR_A]);
    });

    it("lists only chats when no seat matches, and stays shut when neither list does", () => {
        expect(mentionPicker(room(), "@82f", 4, [far])).toMatchObject({ seats: [], chats: [{ chat: far }] });
        expect(mentionPicker(room(), "@zzz", 4, [far, nearA])).toBeNull();
        expect(mentionPicker(room(), "@zzz", 4)).toBeNull();
        expect(mentionPicker(room(), "@zzz", 4, [seated])).toBeNull();
        expect(mentionPicker(room(), "mail a@b", 8, [far])).toBeNull();
    });

    it("lists only seats when no chat is passed", () => {
        expect(mentionPicker(room(), "@", 1)!.chats).toEqual([]);
        expect(mentionPicker(room(), "@wit", 4, [])!.chats).toEqual([]);
    });

    it("closes after a whole chat key and a space, or a chat seat's key and a space", () => {
        expect(mentionPicker(room(), "@82faafca ", 10, [far])).toBeNull();
        expect(mentionPicker(room(), "@82faafca", 9, [far])).toMatchObject({ chats: [{ chat: far }] });
        expect(mentionPicker(room(), "@3e19c0d2-a ", 12, [nearA, nearB])).toBeNull();
        expect(mentionPicker(withSeatedChat(), "@5b7c1d90 ", 10, [far])).toBeNull();
        // a whole seat name still closes it, chats or not
        expect(mentionPicker(room(), "@Witness synthesis ", 19, [far])).toBeNull();
    });

    it("puts @<key> and a space where the @ was, and the caret after it", () => {
        expect(insertChatMention("hi @82f", 3, 7, "82faafca")).toEqual({ text: "hi @82faafca ", caret: 13 });
        expect(insertChatMention("@", 0, 1, "3e19c0d2-a")).toEqual({ text: "@3e19c0d2-a ", caret: 12 });
        expect(insertChatMention("hi @82f about it", 3, 7, "82faafca")).toEqual({
            text: "hi @82faafca about it",
            caret: 13,
        });
    });
});

describe("pickedChats", () => {
    it("holds the chat while its key is in the message, and drops it once the mention is deleted", () => {
        const draft = insertChatMention("@82f", 0, 4, "82faafca").text;
        expect(pickedChats(room(), draft, [far, nearA]).map((a) => a.id)).toEqual([FAR]);
        expect(pickedChats(room(), "what do you think?", [far, nearA])).toEqual([]);
        expect(pickedChats(room(), "@82faafca", [far]).map((a) => a.id)).toEqual([FAR]);
    });

    it("counts two picks, whichever the message names first", () => {
        const both = "@82faafca and @3e19c0d2-b: which first?";
        expect(pickedChats(room(), both, [far, nearA, nearB]).map((a) => a.id)).toEqual([FAR, NEAR_B]);
        expect(pickedChats(room(), "@3e19c0d2-b then @82faafca", [far, nearA, nearB]).map((a) => a.id)).toEqual([
            FAR,
            NEAR_B,
        ]);
    });

    it("does not read a key that two chats share, a short word, or an address", () => {
        expect(pickedChats(room(), "@3e19c0d2", [nearA, nearB])).toEqual([]);
        expect(pickedChats(room(), "@3e19c0d2-", [nearA, nearB])).toEqual([]);
        expect(pickedChats(room(), "@82faafc", [far])).toEqual([]);
        expect(pickedChats(room(), "mail a@82faafca", [far])).toEqual([]);
        expect(pickedChats(room(), "@82faafcaX", [far])).toEqual([]);
    });

    it("reads a longer start of the tab id, the whole id included, and any case", () => {
        expect(pickedChats(room(), "@82faafca-3b1c", [far]).map((a) => a.id)).toEqual([FAR]);
        expect(pickedChats(room(), `@${FAR}`, [far]).map((a) => a.id)).toEqual([FAR]);
        expect(pickedChats(room(), "@82FAAFCA", [far]).map((a) => a.id)).toEqual([FAR]);
        expect(pickedChats(room(), "@3e19c0d2-a, @3e19c0d2-b.", [nearA, nearB]).map((a) => a.id)).toEqual([
            NEAR_A,
            NEAR_B,
        ]);
    });

    it("leaves out a chat a seat holds, and a prefix a seated chat shares with it", () => {
        const seatedChat = chat(SEATED, "Witness synthesis");
        const c = withSeatedChat();
        expect(pickedChats(c, `@5b7c1d90 @82faafca`, [seatedChat, far]).map((a) => a.id)).toEqual([FAR]);
        const clash = chat("82faafca-9999-4000-8000-000000000001", "Other");
        const holder = withSeatedChat({
            experts: [agent("held", clash.id, "Other", 1), ...experts.slice(1)],
        });
        expect(pickedChats(holder, "@82faafca", [far])).toEqual([]);
        expect(pickedChats(holder, "@82faafca-3", [far]).map((a) => a.id)).toEqual([FAR]);
    });
});

describe("replyReach: the chats a message adds and the chats it names", () => {
    it("names a picked chat among the answerers", () => {
        expect(replyReach(room(), "", "", "@82faafca", [far])).toEqual({
            names: ["Design review · 82faafca"],
            label: "Answered by: Design review · 82faafca",
        });
        expect(replyReach(room(), "", "", "@Skeptic and @82faafca", [far]).names).toEqual([
            "Skeptic",
            "Design review · 82faafca",
        ]);
        expect(replyReach(room(), "", "", "@Skeptic and @82faafca", [far]).label).toBe(
            "Answered by: Skeptic, Design review · 82faafca"
        );
    });

    it("never says everyone answers while a chat is joining", () => {
        const names = "@Witness synthesis @UX audit @Security @Skeptic @82faafca";
        expect(replyReach(room(), "", "", names, [far]).label).toBe(
            "Answered by: Witness synthesis · t-w, UX audit · t-u, Security, Skeptic, Design review · 82faafca"
        );
        expect(replyReach(room(), "", "", "@Witness synthesis @UX audit @Security", [far]).label).toBe(
            "Answered by: Witness synthesis · t-w, UX audit · t-u, Security, Design review · 82faafca"
        );
        expect(replyReach(room(), "", "", "").label).toBe("Everyone answers");
    });

    it("reaches a seated chat by its key, and two chats of one name apart", () => {
        const c = withSeatedChat();
        expect(replyReach(c, "", "", "@5b7c1d90 why?")).toEqual({
            names: ["Witness synthesis · 5b7c1d90"],
            label: "Answered by: Witness synthesis · 5b7c1d90",
        });
        const twins = withSeatedChat({
            experts: [agent("a", NEAR_A, "Perf notes", 1), agent("b", NEAR_B, "Perf notes", 1), ...experts.slice(2)],
        });
        // two chats of one project read apart by the key that tells them apart
        expect(replyReach(twins, "", "", "@3e19c0d2-a why?").names).toEqual(["Perf notes · 3e19c0d2-a"]);
        expect(replyReach(twins, "", "", "@3e19c0d2-b why?").names).toEqual(["Perf notes · 3e19c0d2-b"]);
        expect(replyReach(twins, "", "", "@3e19c0d2 why?").label).toBe("Everyone answers");
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
        // the replies are in their ideas' threads; the round at work still shows its divider over the seat writing
        expect(ids(items)).toEqual(["question", "round:1", "P1", "P2", "P3", "round:2", "typing:ram"]);
        expect(byId(items, "P1")).toMatchObject({
            thread: { count: 1, label: "1 reply", last: "Last reply 14:02", drafts: 0 },
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

    it("reads as a finished council: the summary's round is no divider, a follow-up in the channel or its thread", () => {
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
            thread: { count: 2, last: "Last reply 14:07" },
        });
        expect(byId(items, "P3")).toMatchObject({ picks: null });
        expect(byId(items, "r2")).toMatchObject({ label: "steers", to: null, pending: "" });
        expect(byId(items, "r3")).toMatchObject({ author: "ux", parentid: "r2", label: "replies" });
        expect(councilThread(c, "P1")!.items.map((i) => i.id)).toEqual(["r1", "r4"]);
        expect(councilThread(c, "P1")!.items[1]).toMatchObject({
            mine: true,
            to: { by: "you", title: "For RAM" },
            pending: "",
        });
        expect(stepChip(c)).toEqual({ text: "Done", dot: "idle" });
    });

    it("holds nothing and draws nothing for drafts, skips or an agent", () => {
        const items = councilChannel(old({ state: "done", round: 3 }));
        expect(items.some((i) => i.kind === "draft" || i.kind === "skip")).toBe(false);
        expect(stepChip(old({ state: "done", round: 3 }))).toEqual({ text: "Done", dot: "idle" });
        expect(councilThread(old(), "P1")!.items.map((i) => i.id)).toEqual(["r1"]);
        expect(ideaOrder(councilChannel(old()))).toEqual(["P1", "P2", "P3"]);
    });
});

describe("councilChannel: the seats take turns", () => {
    // each seat sends a round in one call: UX three ideas at 0:39, RAM two at 0:56, New user one at 1:02; in round 2 RAM
    // answers at 1:46 and New user at 1:57, each on two ideas
    const turns = (extra: Partial<Council> = {}): Council =>
        council({
            experts: oldExperts,
            proposals: [
                prop("P1", "ux", 39),
                prop("P2", "ux", 39),
                prop("P3", "ux", 39),
                prop("P4", "ram", 56),
                prop("P5", "ram", 56),
                prop("P6", "nu", 62),
            ],
            replies: [
                reply("r1", "ram", 106, { proposalid: "P6", stance: "challenge" }),
                reply("r2", "ram", 106, { proposalid: "P1", stance: "accept", builds: true }),
                reply("r3", "nu", 117, { proposalid: "P4", stance: "oppose" }),
                reply("r4", "nu", 117, { proposalid: "P1", stance: "challenge" }),
            ],
            ...extra,
        });
    const messages = (c: Council) =>
        ids(councilChannel(c)).filter((id) => /^[Pr]\d+$/.test(id ?? "") || id?.startsWith("round:"));

    it("deals the ideas round by round, each seat's first, then each one's second, once their round is over", () => {
        expect(messages(turns()).slice(0, 7)).toEqual(["round:1", "P1", "P4", "P6", "P2", "P5", "P3"]);
    });

    it("keeps the replies on ideas out of the whole channel, the person's among them, round 2's divider too", () => {
        const c = turns({
            state: "done",
            round: 3,
            replies: [...turns().replies, reply("r5", "you", 110, { proposalid: "P4", to: ["ram"] })],
        });
        expect(messages(c)).toEqual(["round:1", "P1", "P4", "P6", "P2", "P5", "P3"]);
    });

    it("keeps one seat's replies in its own channel as they came, each naming the idea it is on", () => {
        const only = (c: Council, seat: string) =>
            ids(councilChannel(c, seat)).filter((id) => /^[Pr]\d+$/.test(id ?? "") || id?.startsWith("round:"));
        const done = turns({ state: "done", round: 3 });
        expect(only(done, "ram")).toEqual(["round:1", "P4", "P5", "round:2", "r1", "r2"]);
        expect(only(done, "nu")).toEqual(["round:1", "P6", "round:2", "r3", "r4"]);
        const items = councilChannel(done, "nu");
        expect(byId(items, "r3")).toMatchObject({ on: "title P4" });
        expect(byId(items, "r4")).toMatchObject({ on: "title P1" });
    });

    it("keeps a round at work in the order its messages came, so nothing moves above the reader", () => {
        expect(messages(turns({ round: 1, replies: [] }))).toEqual(["round:1", "P1", "P2", "P3", "P4", "P5", "P6"]);
        expect(ids(councilChannel(turns({ round: 2 }), "ram")).filter((id) => /^r\d+$/.test(id ?? ""))).toEqual([
            "r1",
            "r2",
        ]);
    });
});

describe("councilChannel with only one seat", () => {
    const shown = (c: Council, id: string) => {
        const items = councilChannel(c, id);
        return { items, ids: items.filter((i) => i.kind !== "divider").map((i) => i.id) };
    };

    it("keeps the question, the seat's ideas and every reply it wrote, a thread's named by its idea", () => {
        // Skeptic wrote P2, agreed with P1 with nothing to add (no message), holds a reply on P1 for the person (r6) and
        // answered the person's post (r8)
        const sk = shown(room(), "sk");
        expect(sk.ids).toEqual(["question", "P2", "r6", "r8"]);
        expect(byId(sk.items, "r6")).toMatchObject({ kind: "draft", on: "title P1" });
        // UX audit wrote P3 and built on P1 in its thread (r4)
        const ux = shown(room(), "ux");
        expect(ux.ids.slice(0, 3)).toEqual(["question", "P3", "r4"]);
        expect(byId(ux.items, "r4")).toMatchObject({ kind: "reply", proposalid: "P1", on: "title P1" });
    });

    it("keeps a seat's held idea and held thread reply, skipped turn and typing row, but no one else's", () => {
        const witness = shown(room(), "witness").ids;
        expect(witness).toContain("P4");
        expect(witness).toContain("r3");
        expect(witness).not.toContain("P1");
        expect(witness.some((id) => id?.startsWith("skip:witness:"))).toBe(true);
        expect(witness).toContain("typing:witness");
        expect(witness).not.toContain("typing:ux");
        expect(shown(room(), "sec").ids).toContain("failed:sec");
    });

    it("leaves out a round's divider when nothing of the seat's sits in that round", () => {
        const { items } = shown(room(), "sk");
        items.forEach((item, i) => {
            if (item.kind === "divider") {
                expect(i).toBeLessThan(items.length - 1);
                expect(items[i + 1].kind).not.toBe("divider");
            }
        });
    });

    it("draws a thread's reply in one seat's channel but not the whole one, and a post's answer names no idea", () => {
        expect(byId(councilChannel(room(), "ux"), "r4")).toMatchObject({ kind: "reply", proposalid: "P1" });
        expect(byId(councilChannel(room()), "r4")).toBeUndefined();
        expect(byId(councilChannel(room()), "r8")).toMatchObject({ proposalid: "", on: "" });
    });
});

describe("the question's limits, a seat's letters and the seat filters", () => {
    it("splits the limits the question set off the question", () => {
        const [first] = councilChannel(council({ question: "Which first? Keep to: the rail only; no new tokens." }));
        expect(first).toMatchObject({
            kind: "question",
            text: "Which first?",
            limits: ["the rail only", "no new tokens"],
        });
    });

    it("gives each message its seat's letters", () => {
        const items = councilChannel(room());
        expect(byId(items, "P1")).toMatchObject({ author: "sec", initials: "SE" });
        expect(byId(items, "P3")).toMatchObject({ author: "ux", initials: "UA" });
    });

    it("counts each seat's ideas and readable replies, and names them while its filter is on", () => {
        const chips = seatChips(room());
        const sk = chips.find((c) => c.id === "sk")!;
        expect([sk.short, sk.initials, sk.ideas, sk.replies]).toEqual(["Skeptic", "SK", 1, 1]);
        expect(onlyLine(sk)).toBe("Only Skeptic: 1 idea and 1 reply");
        expect(onlyLine({ short: "Định vị", ideas: 7, replies: 12 })).toBe("Only Định vị: 7 ideas and 12 replies");
    });
});

describe("askChips: the questions to ask next", () => {
    const base = {
        id: "c1",
        project: "/p",
        feature: "Idle sleep",
        state: "done",
        round: 3,
        tokens: 0,
        calls: 0,
        created: 0,
        updated: 0,
        experts: [
            { id: "ux", name: "UX", brief: "", model: "sonnet" },
            { id: "skeptic", name: "Skeptic", brief: "", model: "sonnet" },
            { id: "coordinator", name: "Coordinator", brief: "", model: "opus", coordinator: true },
        ],
    } as Council;
    const summary = (asks: CouncilAsk[]) => ({ text: "", directions: [], outcomes: {}, at: 0, asks });

    it("puts the seat's @ name before a question for one seat, and none before one for everyone", () => {
        const c = {
            ...base,
            summary: summary([
                { text: "Does one minute hold on a Mac?", to: "skeptic" },
                { text: "What do we log first?" },
            ]),
        };
        expect(askChips(c)).toEqual([
            { text: "Does one minute hold on a Mac?", to: "skeptic", fill: "@Skeptic Does one minute hold on a Mac?" },
            { text: "What do we log first?", to: "", fill: "What do we log first?" },
        ]);
    });

    it("sends a question for a seat that is not on the panel, or the coordinator, to everyone", () => {
        const c = {
            ...base,
            summary: summary([
                { text: "Why?", to: "gone" },
                { text: "Who writes it?", to: "coordinator" },
            ]),
        };
        expect(askChips(c).map((a) => a.fill)).toEqual(["Why?", "Who writes it?"]);
    });

    it("leaves out a question the person has already asked, and has none without a report", () => {
        const c = {
            ...base,
            summary: summary([{ text: "Why?", to: "ux" }, { text: "What next?" }]),
            replies: [{ id: "r1", proposalid: "", author: "you", text: "@UX Why?", round: 4, ts: 1 }],
        } as Council;
        expect(askChips(c).map((a) => a.text)).toEqual(["What next?"]);
        expect(askChips(base)).toEqual([]);
    });
});

describe("namedFile and readsFiles: a follow-up reads files when the question names one", () => {
    it.each([
        ["Trong rail-apps.json, app nào được ghim?", "rail-apps.json"],
        ["Look at pkg/services/idle.go first", "pkg/services/idle.go"],
        ["check pkg/services/idle before", "pkg/services/idle"],
        ["what does ./run.sh do", "./run.sh"],
        ["see ~/notes/plan", "~/notes/plan"],
        ["is `cfg.timeout` read anywhere?", "cfg.timeout"],
        ["(adaptive.json) holds it", "adaptive.json"],
    ])("%s names %s", (text, file) => {
        expect(namedFile(text)).toBe(file);
    });

    it.each([
        "Tuần này mình chỉ có 5 tiếng, làm hướng 1 hay hướng 3?",
        "Is the pass/fail split by mac/windows fair?",
        "Does 1.5 s matter here? e.g. on a Mac.",
        "What about plan-a vs plan-b?",
    ])("%s names no file", (text) => {
        expect(namedFile(text)).toBe("");
    });

    it("is on when the question names a file, says which, and the person's own choice wins", () => {
        expect(readsFiles(null, "Trong rail-apps.json có gì?")).toEqual({
            on: true,
            why: "rail-apps.json",
            locked: false,
        });
        expect(readsFiles(null, "Làm hướng nào trước?")).toEqual({ on: false, why: "", locked: false });
        expect(readsFiles(null, "Sửa TourVideo.astro chưa?").why).toBe("TourVideo.astro");
        expect(readsFiles(null, "xem App.vue và Nav.svelte").why).toBe("App.vue");
        expect(readsFiles(false, "Trong rail-apps.json có gì?")).toEqual({ on: false, why: "", locked: false });
        expect(readsFiles(true, "Làm hướng nào trước?")).toEqual({ on: true, why: "", locked: false });
    });

    it("is on and locked for an attached image, whatever the person chose and the text says", () => {
        const image = { on: true, why: "an image", locked: true };
        expect(readsFiles(null, "Làm hướng nào trước?", 1)).toEqual(image);
        expect(readsFiles(false, "Làm hướng nào trước?", 2)).toEqual(image);
        expect(readsFiles(true, "", 1)).toEqual(image);
        expect(readsFiles(null, "Làm hướng nào trước?", 0)).toEqual({ on: false, why: "", locked: false });
    });

    it("is on and locked for an @file mention, naming the first file", () => {
        const first = { on: true, why: "ux/plan.md", locked: true };
        expect(readsFiles(null, "see @ux/plan.md and @b.go")).toEqual(first);
        expect(readsFiles(false, "see @ux/plan.md")).toEqual(first);
        expect(readsFiles(false, "@ux/plan.md", 1)).toEqual(first);
    });

    it("is on and locked for a web address, naming its host, so the seats can open the page", () => {
        const live = { on: true, why: "blackdiamond.biglabs.net", locked: true };
        expect(readsFiles(false, "hiện tại các cập nhật đã lên https://blackdiamond.biglabs.net/")).toEqual(live);
        expect(readsFiles(null, "see https://blackdiamond.biglabs.net/video?t=1", 0, true)).toEqual(live);
        expect(readsFiles(false, "see @ux/plan.md and https://x.com/a").why).toBe("ux/plan.md");
        expect(readsFiles(false, "blackdiamond.biglabs.net has no scheme").locked).toBe(false);
    });

    it("finds a link the way Go's linkMentioned does", () => {
        // the same table as TestLinkMentioned in pkg/council/runner_test.go
        expect(linkIn("hiện tại các cập nhật đã lên https://blackdiamond.biglabs.net/")).toBe(
            "blackdiamond.biglabs.net"
        );
        expect(linkIn("see http://localhost:5174/x?y=1.")).toBe("localhost:5174");
        expect(linkIn("(HTTPS://Example.com)")).toBe("Example.com");
        expect(linkIn("blackdiamond.biglabs.net with no scheme")).toBe("");
        expect(linkIn("ftp://files.example.com")).toBe("");
        expect(linkIn("xhttps://not.one")).toBe("");
        expect(linkIn("https://")).toBe("");
        expect(linkIn("")).toBe("");
    });

    it("is not locked by an @ that names a seat, or by a file named without an @", () => {
        expect(readsFiles(false, "@UX. what next?")).toEqual({ on: false, why: "", locked: false });
        expect(readsFiles(false, "mail a@ram.com")).toEqual({ on: false, why: "", locked: false });
        expect(readsFiles(false, "see ux/plan.md")).toEqual({ on: false, why: "", locked: false });
    });

    describe("for a message the router takes", () => {
        it("leaves the decision to the router in Auto, `on` staying the file-naming guess", () => {
            expect(readsFiles(null, "Review the v5.1 we just fixed", 0, true)).toEqual({
                on: false,
                why: ROUTER_DECIDES,
                locked: false,
            });
            expect(readsFiles(null, "Trong rail-apps.json có gì?", 0, true)).toEqual({
                on: true,
                why: ROUTER_DECIDES,
                locked: false,
            });
            expect(ROUTER_DECIDES).toBe("the router decides");
        });

        it("keeps the person's On or Off: the router never changes it", () => {
            expect(readsFiles(true, "Làm hướng nào trước?", 0, true)).toEqual({ on: true, why: "", locked: false });
            expect(readsFiles(false, "Trong rail-apps.json có gì?", 0, true)).toEqual({
                on: false,
                why: "",
                locked: false,
            });
        });

        it("is still on and locked for an image or an @file, whatever the router says", () => {
            expect(readsFiles(null, "what next?", 1, true)).toEqual({ on: true, why: "an image", locked: true });
            expect(readsFiles(null, "see @ux/plan.md", 0, true)).toEqual({ on: true, why: "ux/plan.md", locked: true });
            expect(readsFiles(false, "see @ux/plan.md", 1, true)).toEqual({
                on: true,
                why: "ux/plan.md",
                locked: true,
            });
        });

        it("reads the same as before for a message it does not take", () => {
            expect(readsFiles(null, "Trong rail-apps.json có gì?", 0, false)).toEqual(
                readsFiles(null, "Trong rail-apps.json có gì?")
            );
        });
    });
});

describe("the Read files control: Auto, On, Off", () => {
    it("presses the person's pick, and On while an image or an @file locks it", () => {
        expect(readsChoice(null, false)).toBe("auto");
        expect(readsChoice(true, false)).toBe("on");
        expect(readsChoice(false, false)).toBe("off");
        expect(readsChoice(null, true)).toBe("on");
        expect(readsChoice(false, true)).toBe("on");
    });

    it("sets drafts.tools from an option: null for Auto", () => {
        expect(toolsOfChoice("auto")).toBeNull();
        expect(toolsOfChoice("on")).toBe(true);
        expect(toolsOfChoice("off")).toBe(false);
    });

    it("notes what the router or the question decided, and nothing otherwise", () => {
        expect(readsNote({ why: ROUTER_DECIDES })).toBe("the router decides");
        expect(readsNote({ why: "rail-apps.json" })).toBe("it names rail-apps.json");
        expect(readsNote({ why: "an image" })).toBe("it names an image");
        expect(readsNote({ why: "" })).toBe("");
    });
});

describe("mentionPicker: the All seats row", () => {
    const seatIds = (p: ReturnType<typeof mentionPicker>) => p!.seats.map((e) => e.id);

    it("lists All seats for a bare @, before the seats", () => {
        const picker = mentionPicker(room(), "@", 1)!;
        expect(picker.all).toBe(true);
        expect(seatIds(picker)).toEqual(["witness", "ux", "sec", "sk"]);
        expect(pickerRows(picker).map((r) => r.kind)).toEqual(["all", "seat", "seat", "seat", "seat"]);
        expect(pickerRows(picker)[0]).toEqual({ kind: "all" });
    });

    it("lists it while what follows the @ starts `all` or `everyone`, in any case", () => {
        for (const typed of ["a", "al", "all", "ALL", "e", "ev", "Everyone", "everyone"]) {
            expect(mentionPicker(room(), `@${typed}`, typed.length + 1)?.all, typed).toBe(true);
        }
    });

    it("is the only row for `@all`, which no seat's name holds, and sits among the seats that match `@a`", () => {
        const all = mentionPicker(room(), "@all", 4)!;
        expect(all.all).toBe(true);
        expect(pickerRows(all)).toEqual([{ kind: "all" }]);
        const a = mentionPicker(room(), "@a", 2)!;
        expect(pickerRows(a)[0]).toEqual({ kind: "all" });
        expect(seatIds(a)).toEqual(["ux"]); // "UX audit"
    });

    it("does not list it once the word is something else, and finds no match for `@alx`", () => {
        for (const typed of ["ux", "wit", "sec", "ec", "x", "allx", "everyonex"]) {
            expect(mentionPicker(room(), `@${typed}`, typed.length + 1)?.all ?? false, typed).toBe(false);
        }
        expect(mentionPicker(room(), "@alx", 4)).toBeNull();
    });

    it("closes after `@all ` or `@everyone `, as it does after a whole seat name", () => {
        expect(mentionPicker(room(), "@all ", 5)).toBeNull();
        expect(mentionPicker(room(), "@everyone ", 10)).toBeNull();
        expect(mentionPicker(room(), "@Witness synthesis ", 19)).toBeNull();
    });

    it("is listed with no files and no chats of its own, and with the live chats a bare @ offers", () => {
        const bare = mentionPicker(room(), "@", 1, [far], ["ux/plan.md"])!;
        expect(bare.all).toBe(true);
        expect(bare.files).toEqual([]);
        expect(pickerRows(bare).map((r) => r.kind)).toEqual(["all", "seat", "seat", "seat", "seat", "chat"]);
        expect(mentionPicker(room(), "@ux", 3, [far], [])!.all).toBe(false);
    });

    it("has pickerRows list it only when the picker says so", () => {
        expect(pickerRows({ all: true, seats: [], files: [], chats: [] })).toEqual([{ kind: "all" }]);
        expect(pickerRows({ all: false, seats: [], files: [], chats: [] })).toEqual([]);
    });
});

describe("insertAllMention", () => {
    it("replaces what was typed with `@all` and a space, and puts the caret after it", () => {
        expect(insertAllMention("@", 0, 1)).toEqual({ text: "@all ", caret: 5 });
        expect(insertAllMention("hi @ev", 3, 6)).toEqual({ text: "hi @all ", caret: 8 });
        expect(insertAllMention("@ what next?", 0, 1)).toEqual({ text: "@all what next?", caret: 5 });
    });

    it("makes an @ that replyReach reads as everyone, and that closes the picker", () => {
        const put = insertAllMention("@", 0, 1);
        expect(replyReach(room(), "", "", put.text).label).toBe("Everyone answers");
        expect(mentionPicker(room(), put.text, put.caret)).toBeNull();
    });
});

describe("mentionPicker: the project's files between the seats and the chats", () => {
    const FILES = ["ux/plan.md", "src/ux.ts", "docs/readme.md", "Makefile", "app/[id]/page.tsx", "a b/c.ts", "go.mod"];
    const paths = (picker: ReturnType<typeof mentionPicker>) => picker!.files;

    // a live chat that "ux" also matches, so one query lists all three kinds
    const uxChat = chat("9a8b7c6d-1111-4222-8333-444455556666", "UX review");

    it("lists the files that match what follows the @, with the seats and the chats", () => {
        const picker = mentionPicker(room(), "@ux", 3, [far], FILES)!;
        expect(picker.seats.map((e) => e.id)).toEqual(["ux"]);
        expect([...picker.files].sort()).toEqual(["src/ux.ts", "ux/plan.md"]);
        expect(picker.chats).toEqual([]);
        expect(picker.start).toBe(0);
    });

    it("lists the seats, then the files, then the chats through pickerRows, one row each", () => {
        const picker = mentionPicker(room(), "@ux", 3, [uxChat, far], FILES)!;
        const rows = pickerRows(picker);
        expect(rows.map((r) => r.kind)).toEqual(["seat", "file", "file", "chat"]);
        expect(rows[0]).toEqual({ kind: "seat", seat: picker.seats[0] });
        expect(rows[1]).toEqual({ kind: "file", path: picker.files[0] });
        expect(rows[2]).toEqual({ kind: "file", path: picker.files[1] });
        expect(rows[3]).toEqual({ kind: "chat", chat: { chat: uxChat, key: "9a8b7c6d" } });
    });

    it("has pickerRows hold every pick of the picker once, and none for an empty one", () => {
        const picker = mentionPicker(room(), "@wit", 4, [], [])!;
        expect(pickerRows(picker)).toEqual([{ kind: "seat", seat: picker.seats[0] }]);
        expect(pickerRows({ seats: [], files: [], chats: [] })).toEqual([]);
        const onlyFiles = mentionPicker(room(), "@plan.", 6, [uxChat], FILES)!;
        expect(pickerRows(onlyFiles)).toEqual([{ kind: "file", path: "ux/plan.md" }]);
    });

    it("starts on a seat when any matches, else on the first file", () => {
        expect(pickerRows(mentionPicker(room(), "@sec", 4, [], FILES)!)[0]).toMatchObject({ kind: "seat" });
        expect(pickerRows(mentionPicker(room(), "@docs", 5, [], FILES)!)[0]).toEqual({
            kind: "file",
            path: "docs/readme.md",
        });
    });

    it("lists only files for a query that holds a / or a .", () => {
        const picker = mentionPicker(room(), "@ux/", 4, [far], FILES)!;
        expect(picker.seats).toEqual([]);
        expect(picker.chats).toEqual([]);
        expect(picker.files).toEqual(["ux/plan.md"]);
        expect(paths(mentionPicker(room(), "@foo/", 5, [], ["foo/a.ts", "foo/b.ts", "bar/c.ts"]))).toEqual([
            "foo/a.ts",
            "foo/b.ts",
        ]);
        // the finder's ranking is fuzzy: the file whose name holds the dot comes first
        const dotted = mentionPicker(room(), "@ux.", 4, [uxChat], FILES)!;
        expect(dotted.seats).toEqual([]);
        expect(dotted.chats).toEqual([]);
        expect(dotted.files[0]).toBe("src/ux.ts");
        expect(mentionPicker(room(), "@wit.", 5, [], ["x.md"])).toBeNull();
    });

    it("stays shut with no match anywhere, and lists no file for a bare @", () => {
        expect(mentionPicker(room(), "@zzz", 4, [far], FILES)).toBeNull();
        const bare = mentionPicker(room(), "@", 1, [far], FILES)!;
        expect(bare.files).toEqual([]);
        expect(bare.seats.map((e) => e.id)).toEqual(["witness", "ux", "sec", "sk"]);
        expect(mentionPicker(room(), "mail a@b.md", 11, [], ["b.md"])).toBeNull();
    });

    it("lists only files the @ rule can name whole", () => {
        // a bracket or a space would cut the path short, and a name with no / or . is no file mention: not listed
        expect(mentionPicker(room(), "@page", 5, [], FILES)).toBeNull();
        expect(mentionPicker(room(), "@a b", 4, [], FILES)).toBeNull();
        expect(mentionPicker(room(), "@make", 5, [], FILES)).toBeNull();
        expect(paths(mentionPicker(room(), "@go", 3, [], FILES))).toEqual(["go.mod"]);
    });

    it("caps the files at the New dialog's limit", () => {
        const many = Array.from({ length: 30 }, (_, i) => `src/file${i}.ts`);
        expect(paths(mentionPicker(room(), "@file", 5, [], many))).toHaveLength(8);
    });

    it("keeps listing files while a long path is typed", () => {
        const long = "frontend/app/view/agents/councilchatmodel.ts";
        const text = `@${long.slice(0, 43)}`;
        expect(text.length).toBeGreaterThan(41);
        expect(paths(mentionPicker(room(), text, text.length, [], [long, "other.ts"]))).toEqual([long]);
    });

    it("closes after an inserted path and a space, and while no file matches a path with a space after it", () => {
        const put = insertFileMention("@ux", 0, 3, "ux/plan.md");
        expect(put).toEqual({ text: "@ux/plan.md ", caret: 12 });
        expect(mentionPicker(room(), put.text, put.caret, [far], FILES)).toBeNull();
        expect(mentionPicker(room(), "@ux/plan.md", 11, [], FILES)).toMatchObject({ files: ["ux/plan.md"] });
        expect(mentionPicker(room(), "@ux/plan.md read", 16, [], FILES)).toBeNull();
    });

    it("puts @<path> and a space where the @ was, the rest of the word too", () => {
        expect(insertFileMention("see @ux/pl now", 4, 10, "ux/plan.md")).toEqual({
            text: "see @ux/plan.md now",
            caret: 16,
        });
        expect(insertFileMention("@ux/pl|an.md", 0, 6, "ux/plan.md").text).toBe("@ux/plan.md ");
    });

    it("makes a mention that replyReach reads as no seat and readsFiles reads as a file", () => {
        const text = insertFileMention("@ux", 0, 3, "ux/plan.md").text;
        expect(replyReach(room(), "", "", text).names).toEqual([
            "Witness synthesis · t-w",
            "UX audit · t-u",
            "Security",
            "Skeptic",
        ]);
        expect(readsFiles(false, text).why).toBe("ux/plan.md");
    });

    it("keeps today's cases: no files passed, no files listed", () => {
        expect(mentionPicker(room(), "@ux", 3)!.files).toEqual([]);
        expect(mentionPicker(room(), "@ux", 3, [far], [])!.files).toEqual([]);
        expect(mentionPicker(room(), "@zzz", 4, [], [])).toBeNull();
    });
});

describe("messageSegments: a sent message cut at its file mentions", () => {
    it("cuts `see @ux/plan.md now` into text, file, text", () => {
        expect(messageSegments("see @ux/plan.md now")).toEqual([
            { kind: "text", text: "see " },
            { kind: "file", path: "ux/plan.md" },
            { kind: "text", text: " now" },
        ]);
    });

    it("starts and ends on a file with no empty text around it, and keeps a sentence's dot", () => {
        expect(messageSegments("@a.ts")).toEqual([{ kind: "file", path: "a.ts" }]);
        expect(messageSegments("@a.ts @b/c.go")).toEqual([
            { kind: "file", path: "a.ts" },
            { kind: "text", text: " " },
            { kind: "file", path: "b/c.go" },
        ]);
        expect(messageSegments("read @src/a.ts.")).toEqual([
            { kind: "text", text: "read " },
            { kind: "file", path: "src/a.ts" },
            { kind: "text", text: "." },
        ]);
    });

    it("leaves a seat's @ and an address in the text", () => {
        expect(messageSegments("@UX what about a@ram.com?")).toEqual([
            { kind: "text", text: "@UX what about a@ram.com?" },
        ]);
        expect(messageSegments("")).toEqual([]);
    });

    it("joins back to the text it was cut from", () => {
        const text = "A @x/y.ts, then (@z.md) and @UX.. done";
        const back = messageSegments(text)
            .map((s) => (s.kind === "file" ? `@${s.path}` : s.text))
            .join("");
        expect(back).toBe(text);
    });
});

describe("councilChannel: a person's reply with attachments", () => {
    const IMG = "C:\\Users\\me\\.arc\\attachments\\ab12\\shot.png";
    const IMG2 = "C:\\Users\\me\\.arc\\attachments\\cd34\\other.png";

    it("builds a ReplyPost holding the attachments, in the reply's order", () => {
        const c = council({
            replies: [reply("r1", "you", 150, { proposalid: "", attachments: [IMG, IMG2], text: "see @ux/plan.md" })],
        });
        expect(byId(councilChannel(c), "r1")).toMatchObject({ kind: "reply", attachments: [IMG, IMG2] });
    });

    it("holds none for a reply with none, a seat's and an old council's", () => {
        const c = council({
            replies: [
                reply("r1", "you", 150, { proposalid: "", to: ["sk"] }),
                reply("r2", "sk", 160, { proposalid: "", parentid: "r1", round: 3 }),
            ],
        });
        const items = councilChannel(c);
        expect(byId(items, "r1")).toMatchObject({ attachments: [] });
        expect(byId(items, "r2")).toMatchObject({ attachments: [] });
    });

    it("carries them into the idea's thread too", () => {
        const c = council({
            proposals: [prop("P1", "sec", 60)],
            replies: [reply("r1", "you", 150, { attachments: [IMG] })],
        });
        const thread = councilThread(c, "P1")!;
        expect(thread.items[0]).toMatchObject({ kind: "reply", attachments: [IMG] });
    });
});

describe("threadAsks", () => {
    const followUp = (replies: ReturnType<typeof reply>[]) =>
        councilThread(
            council({ proposals: [prop("P1", "sec", 60)], replies, activity: { sec: { text: "", proposalid: "P1" } } }),
            "P1"
        )!.items;

    it("offers what the newest seat answer suggests while it is the thread's last post", () => {
        const items = followUp([
            reply("r1", "you", 150, { to: ["sec"] }),
            reply("r2", "sec", 160, { parentid: "r1", asks: ["Run it on M5?", "Which tier first?"] }),
        ]);
        expect(threadAsks(items)).toEqual(["Run it on M5?", "Which tier first?"]);
    });

    it("offers nothing once the person replied after it, or for an answer that suggests none", () => {
        expect(
            threadAsks(
                followUp([
                    reply("r1", "you", 150, { to: ["sec"] }),
                    reply("r2", "sec", 160, { parentid: "r1", asks: ["Run it on M5?"] }),
                    reply("r3", "you", 170, { to: ["sec"] }),
                ])
            )
        ).toEqual([]);
        expect(threadAsks(followUp([reply("r1", "you", 150, { to: ["sec"] }), reply("r2", "sec", 160)]))).toEqual([]);
        expect(threadAsks([])).toEqual([]);
    });
});

describe("a message the router took up: its chips, its line and Ask <seat> too", () => {
    // a done council of role seats (UX, RAM, New user); the person's message r1 is routed and the answers hang on it
    const done = (extra: Partial<Council> = {}) => council({ experts: oldExperts, state: "done", round: 4, ...extra });
    const routedReply = (routed: CouncilRouted, extra: Partial<CouncilReply> = {}) =>
        reply("r1", "you", 150, { proposalid: "", round: 4, to: ["ux"], routed, ...extra });
    const answer = (id: string, author: string, seconds: number, extra: Partial<CouncilReply> = {}) =>
        reply(id, author, seconds, { proposalid: "", parentid: "r1", round: 4, ...extra });
    const items = (c: Council) => councilThread(c, CHAT_THREAD)!.items;

    describe("routerLine", () => {
        const line = (routed: CouncilRouted, extra: Partial<CouncilReply> = {}) =>
            routerLine(done(), routedReply(routed, extra));

        it("names the one seat the router chose and why", () => {
            expect(line({ chose: ["ux"], reason: "It is about the rail's layout." })).toBe(
                "Router chose UX: It is about the rail's layout."
            );
        });

        it("names both seats when it chose two", () => {
            expect(line({ chose: ["ux", "ram"], reason: "Layout and memory." }, { to: ["ux", "ram"] })).toBe(
                "Router chose UX and RAM: Layout and memory."
            );
        });

        it("says it reads files when the router decided that (autotools) and the reply reads them", () => {
            expect(
                line({ chose: ["ux"], reason: "v5.1 is not in the thread.", autotools: true }, { tools: true })
            ).toBe("Router chose UX · reading files: v5.1 is not in the thread.");
            expect(
                line({ chose: ["ux", "ram"], reason: "Both.", autotools: true }, { tools: true, to: ["ux", "ram"] })
            ).toBe("Router chose UX and RAM · reading files: Both.");
        });

        it("says nothing of files when the router left them off, or the person's On or Off decided", () => {
            expect(line({ chose: ["ux"], reason: "Why.", autotools: true }, { tools: false })).toBe(
                "Router chose UX: Why."
            );
            expect(line({ chose: ["ux"], reason: "Why." }, { tools: true })).toBe("Router chose UX: Why.");
        });

        it("says the router failed and which seat answered, with no reason", () => {
            expect(line({ chose: ["ux"], failed: true, reason: "claude exited 1" })).toBe("Router failed, UX answered");
            expect(line({ chose: ["ux"], failed: true, reason: "" })).toBe("Router failed, UX answered");
        });

        it("leaves the reason out when it is empty", () => {
            expect(line({ chose: ["ux"], reason: "" })).toBe("Router chose UX");
            expect(line({ chose: ["ux"], reason: "   " })).toBe("Router chose UX");
            expect(line({ chose: ["ux"] })).toBe("Router chose UX");
        });

        it("keeps naming the seats the router chose after Ask <seat> too adds one to `to`", () => {
            expect(line({ chose: ["ux"], reason: "Why." }, { to: ["ux", "ram"] })).toBe("Router chose UX: Why.");
        });

        it("is empty while the router has not chosen, and for a message it did not take up", () => {
            expect(line({ pending: true }, { to: [] })).toBe("");
            expect(routerLine(done(), reply("r1", "you", 150, { proposalid: "", to: ["ux"] }))).toBe("");
            expect(routerLine(done(), reply("r2", "ux", 160, { routed: { chose: ["ux"] } }))).toBe("");
        });
    });

    describe("askTooSeats", () => {
        it("lists the panel seats that are not in `to`, in panel order, never the coordinator", () => {
            expect(askTooSeats(done(), routedReply({ chose: ["ram"] }, { to: ["ram"] }))).toEqual([
                { id: "ux", name: "UX" },
                { id: "nu", name: "New user" },
            ]);
            expect(askTooSeats(done(), routedReply({ chose: ["ux"] }))).toEqual([
                { id: "ram", name: "RAM" },
                { id: "nu", name: "New user" },
            ]);
        });

        it("leaves out a seat added with Ask <seat> too, and has none left once everyone answers", () => {
            expect(askTooSeats(done(), routedReply({ chose: ["ux"] }, { to: ["ux", "ram"] }))).toEqual([
                { id: "nu", name: "New user" },
            ]);
            expect(askTooSeats(done(), routedReply({ chose: ["ux"] }, { to: ["ux", "ram", "nu"] }))).toEqual([]);
        });

        it("leaves out a seat whose call failed: a follow-up would call nobody", () => {
            const c = done({ failed: { ram: { round: 4, error: "x" } } });
            expect(askTooSeats(c, routedReply({ chose: ["ux"] }))).toEqual([{ id: "nu", name: "New user" }]);
        });

        it("is empty while the router has not chosen, and on an unrouted message or a seat's reply", () => {
            expect(askTooSeats(done(), routedReply({ pending: true }, { to: [] }))).toEqual([]);
            expect(askTooSeats(done(), reply("r1", "you", 150, { proposalid: "", to: ["ux"] }))).toEqual([]);
            expect(askTooSeats(done(), reply("r2", "ux", 160, { routed: { chose: ["ux"] } }))).toEqual([]);
        });
    });

    describe("the person's post", () => {
        it("names the seats the router chose, never everyone, with the router's line as its hover", () => {
            const c = done({ replies: [routedReply({ chose: ["ux"], reason: "Why." }), answer("r2", "ux", 160)] });
            expect(byId(items(c), "r1")).toMatchObject({
                to: {
                    by: "router",
                    seats: [{ author: "ux", name: "UX" }],
                    everyone: false,
                    title: "Router chose UX: Why.",
                },
                pending: "",
            });
        });

        it("names UX and RAM even when the two are the whole panel", () => {
            const two = council({
                experts: [
                    { id: "ux", name: "UX", brief: "", model: "sonnet" },
                    { id: "ram", name: "RAM", brief: "", model: "sonnet" },
                    { id: "coordinator", name: "Coordinator", brief: "", model: "opus", coordinator: true },
                ],
                state: "done",
                round: 4,
                replies: [routedReply({ chose: ["ux", "ram"], reason: "Both." }, { to: ["ux", "ram"] })],
            });
            expect(byId(items(two), "r1")).toMatchObject({
                to: { by: "router", seats: [{ author: "ux" }, { author: "ram" }], everyone: false },
            });
            // the same two seats on a message nobody routed (an @all) are everyone, as before
            const all = council({
                experts: two.experts,
                state: "done",
                round: 4,
                replies: [reply("r1", "you", 150, { proposalid: "", round: 4, to: ["ux", "ram"] })],
            });
            expect(byId(items(all), "r1")).toMatchObject({ to: null });
        });

        it("says the router is choosing, with no seat and no wait line, while it has not chosen", () => {
            const c = done({ replies: [routedReply({ pending: true }, { to: [] })] });
            // its chips say so, at the top of its bubble: the line under it says nothing
            expect(byId(items(c), "r1")).toMatchObject({
                to: { by: "choosing", seats: [], everyone: false, title: "" },
                pending: "",
            });
        });
    });

    describe("a seat's answer", () => {
        it("carries the chips on the last answer only, and no quote on answers right under their message", () => {
            const c = done({
                replies: [
                    routedReply({ chose: ["ux", "ram"], reason: "Layout and memory." }, { to: ["ux", "ram"] }),
                    answer("r2", "ux", 160),
                    answer("r3", "ram", 170),
                ],
            });
            const list = items(c);
            expect(byId(list, "r2")).toMatchObject({
                quote: null,
                askToo: [],
                routedReply: "",
            });
            expect(byId(list, "r3")).toMatchObject({
                quote: null,
                askToo: [{ id: "nu", name: "New user" }],
                routedReply: "r1",
            });
        });

        it("puts the chips on the one answer when there is only one", () => {
            const c = done({ replies: [routedReply({ chose: ["ux"], reason: "Why." }), answer("r2", "ux", 160)] });
            expect(byId(items(c), "r2")).toMatchObject({
                quote: null,
                askToo: [
                    { id: "ram", name: "RAM" },
                    { id: "nu", name: "New user" },
                ],
                routedReply: "r1",
            });
        });

        it("finds the first and the last answer by time, whatever order they were saved in", () => {
            const c = done({
                replies: [
                    routedReply({ chose: ["ux", "ram"], reason: "Both." }, { to: ["ux", "ram"] }),
                    answer("r3", "ram", 170),
                    answer("r2", "ux", 160),
                ],
            });
            const list = items(c);
            expect(byId(list, "r2")).toMatchObject({ quote: null, askToo: [] });
            expect(byId(list, "r3")).toMatchObject({ quote: null, routedReply: "r1" });
        });

        it("skips a seat's answer with no words: it is a reaction, no post", () => {
            const c = done({
                replies: [
                    routedReply({ chose: ["ux", "ram"], reason: "Both." }, { to: ["ux", "ram"] }),
                    answer("r2", "ux", 160),
                    answer("r3", "ram", 170, { text: "" }),
                ],
            });
            const list = items(c);
            expect(byId(list, "r3")).toBeUndefined();
            expect(byId(list, "r2")).toMatchObject({
                quote: null,
                askToo: [{ id: "nu", name: "New user" }],
                routedReply: "r1",
            });
        });

        it("has no chips once every seat answers, and none while the router is still choosing", () => {
            const everyone = done({
                replies: [
                    routedReply({ chose: ["ux"], reason: "Why." }, { to: ["ux", "ram", "nu"] }),
                    answer("r2", "ux", 160),
                ],
            });
            expect(byId(items(everyone), "r2")).toMatchObject({ askToo: [], routedReply: "" });
            const pending = done({ replies: [routedReply({ pending: true }, { to: [] }), answer("r2", "ux", 160)] });
            expect(byId(items(pending), "r2")).toMatchObject({ quote: null, askToo: [], routedReply: "" });
        });

        it("carries nothing on an answer to a message the router did not take up, or on the person's own post", () => {
            const c = done({
                replies: [
                    reply("r1", "you", 150, { proposalid: "", round: 4, to: ["ux", "ram", "nu"] }),
                    answer("r2", "ux", 160),
                ],
            });
            expect(byId(items(c), "r2")).toMatchObject({ quote: null, askToo: [], routedReply: "" });
            expect(byId(items(c), "r1")).toMatchObject({ quote: null, askToo: [], routedReply: "" });
        });
    });
});

describe("an answer quotes the person's post it answers, when it is not right under it", () => {
    const done = (replies: CouncilReply[], extra: Partial<Council> = {}) =>
        council({ experts: oldExperts, state: "done", round: 4, replies, ...extra });
    const post = (id: string, seconds: number, extra: Partial<CouncilReply> = {}) =>
        reply(id, "you", seconds, { proposalid: "", round: 4, to: ["ux"], answered: true, ...extra });
    const answer = (id: string, author: string, parent: string, seconds: number, extra: Partial<CouncilReply> = {}) =>
        reply(id, author, seconds, { proposalid: "", parentid: parent, round: 4, ...extra });

    it("quotes each post on its answer when three were sent in a row, on one line, with a jump to it", () => {
        const c = done([
            post("q1", 100, { text: "First\n  question?" }),
            post("q2", 110, { text: "Second?", to: ["ram"] }),
            post("q3", 120, { text: "Third?" }),
            answer("a1", "ux", "q1", 130),
            answer("a3", "ux", "q3", 140),
            answer("a2", "ram", "q2", 150),
        ]);
        const items = councilChannel(c);
        expect(byId(items, "a1")).toMatchObject({ quote: { id: "q1", text: "First question?", jump: true } });
        expect(byId(items, "a3")).toMatchObject({ quote: { id: "q3", text: "Third?", jump: true } });
        expect(byId(items, "a2")).toMatchObject({ quote: { id: "q2", text: "Second?", jump: true } });
        expect(byId(items, "q1")).toMatchObject({ quote: null });
    });

    it("quotes nothing on an answer right under its post, nor on a second answer right under the first", () => {
        const c = done([
            post("q1", 100, { to: ["ux", "ram"] }),
            answer("a1", "ux", "q1", 110),
            answer("a2", "ram", "q1", 120),
        ]);
        const items = councilChannel(c);
        expect(byId(items, "a1")).toMatchObject({ quote: null });
        expect(byId(items, "a2")).toMatchObject({ quote: null });
    });

    it("looks past the failure line under a post: the answer after it is still right under it", () => {
        const c = done([post("q1", 100, { to: ["ux", "ram"] }), answer("a1", "ux", "q1", 110)], {
            failed: { ram: { round: 4, error: "claude exited with status 1" } },
        });
        const items = councilChannel(c);
        expect(items.map((i) => i.id).slice(-3)).toEqual(["q1", "failed:ram", "a1"]);
        expect(byId(items, "a1")).toMatchObject({ quote: null });
    });

    it("keeps the quote with no jump in one seat's view, which leaves the person's posts out", () => {
        const c = done([post("q1", 100), answer("a1", "ux", "q1", 110)]);
        expect(byId(councilChannel(c, "ux"), "a1")).toMatchObject({ quote: { id: "q1", jump: false } });
    });

    it("quotes in an idea's thread too, and nothing on a seat's reply that answers no post of the person's", () => {
        const c = done(
            [
                post("q1", 100, { proposalid: "P1" }),
                reply("x1", "ram", 105, { round: 4 }),
                answer("a1", "ux", "q1", 110, { proposalid: "P1" }),
            ],
            { proposals: [prop("P1", "ux", 50)] }
        );
        const thread = councilThread(c, "P1")!.items;
        expect(thread.find((i) => i.id === "a1")).toMatchObject({ quote: { id: "q1", jump: true } });
        expect(thread.find((i) => i.id === "x1")).toMatchObject({ quote: null });
    });
});

describe("the person's post: its chips and the seats its text names", () => {
    const done = (replies: CouncilReply[]) => council({ experts: oldExperts, state: "done", round: 4, replies });
    const post = (id: string, seconds: number, extra: Partial<CouncilReply> = {}) =>
        reply(id, "you", seconds, { proposalid: "", round: 4, answered: true, ...extra });

    it("draws no chips when its text names whom it reaches: the names are chips in its text", () => {
        const items = councilChannel(
            done([
                post("q1", 100, { text: "@RAM how much?", to: ["ram"] }),
                post("q2", 110, { text: "@all thoughts?", to: ["ux", "ram", "nu"] }),
            ])
        );
        expect(byId(items, "q1")).toMatchObject({
            to: null,
            parts: [
                { kind: "seat", text: "@RAM", who: { author: "ram", name: "RAM" } },
                { kind: "text", text: " how much?" },
            ],
        });
        expect(byId(items, "q2")).toMatchObject({
            to: null,
            parts: [
                { kind: "seat", text: "@all", who: null },
                { kind: "text", text: " thoughts?" },
            ],
        });
    });

    it("says the router failed, and names the seat that answered instead, with no reason", () => {
        const failed = post("q1", 100, {
            to: ["ux"],
            routed: { chose: ["ux"], failed: true, reason: "claude exited with status 1" },
        });
        expect(byId(councilChannel(done([failed])), "q1")).toMatchObject({
            to: { by: "failed", seats: [{ author: "ux" }], title: "Router failed, UX answered" },
        });
    });

    it("cuts no text of a seat's reply: its parts are empty", () => {
        const items = councilChannel(
            done([
                post("q1", 100, { to: ["ux"] }),
                reply("a1", "ux", 110, { proposalid: "", parentid: "q1", round: 4, text: "@RAM agrees" }),
            ])
        );
        expect(byId(items, "a1")).toMatchObject({ parts: [], to: null });
    });
});

describe("seatMentions: the seats a message names", () => {
    const c = council({ experts: oldExperts });

    it("finds a seat by name or id, not inside an address nor at the start of a file", () => {
        expect(seatMentions(c, "@UX and @ram, not a@nu.com nor @ux/plan.md")).toEqual([
            { start: 0, end: 3, id: "ux" },
            { start: 8, end: 12, id: "ram" },
        ]);
        expect(seatMentions(c, "@uxx and @rams")).toEqual([]);
    });

    it("reads @all and @everyone as every seat", () => {
        expect(seatMentions(c, "hey @all, and @Everyone")).toEqual([
            { start: 4, end: 8, id: null },
            { start: 14, end: 23, id: null },
        ]);
    });

    it("takes the longer of two names that start at one @", () => {
        const two = council({
            experts: [
                { id: "new", name: "New", brief: "", model: "sonnet" },
                { id: "nu", name: "New user", brief: "", model: "sonnet" },
            ],
        });
        expect(seatMentions(two, "@New user, hi @New")).toEqual([
            { start: 0, end: 9, id: "nu" },
            { start: 14, end: 18, id: "new" },
        ]);
    });

    it("finds a chat seat by its mention key, and not the coordinator", () => {
        const chats = council({
            experts: [
                agent("notes", "0976023f-1111", "notes", 0),
                agent("other", "1a2b3c4d-2222", "other", 0),
                { id: "coordinator", name: "Coordinator", brief: "", model: "opus", coordinator: true },
            ],
        });
        expect(seatMentions(chats, "@0976023f look, @1a2b3c4d too, @coordinator no")).toEqual([
            { start: 0, end: 9, id: "notes" },
            { start: 16, end: 25, id: "other" },
        ]);
    });
});

describe("messageSegments with its council: the seats it names are chips", () => {
    it("cuts at seats and files in the order they sit, and joins back to the text", () => {
        const c = council({ experts: oldExperts });
        const text = "@RAM see @a.ts, @UX";
        const parts = messageSegments(text, c);
        expect(parts).toMatchObject([
            { kind: "seat", text: "@RAM", who: { author: "ram" } },
            { kind: "text", text: " see " },
            { kind: "file", path: "a.ts" },
            { kind: "text", text: ", " },
            { kind: "seat", text: "@UX", who: { author: "ux" } },
        ]);
        expect(parts.map((p) => (p.kind === "file" ? `@${p.path}` : p.text)).join("")).toBe(text);
    });
});
