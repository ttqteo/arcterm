import { describe, expect, it } from "vitest";
import { councilFeed, isQueued, modeWord, showsFeed, stepOf } from "./councilfeedmodel";

const experts: CouncilExpert[] = [
    { id: "ux", name: "UX", brief: "", model: "sonnet" },
    { id: "ram", name: "RAM", brief: "", model: "sonnet" },
    { id: "nu", name: "New user", brief: "", model: "sonnet" },
    { id: "sk", name: "Skeptic", brief: "", model: "sonnet" },
    { id: "coordinator", name: "Coordinator", brief: "", model: "opus", coordinator: true },
];

const STARTED = 1_000_000;
const at = (seconds: number) => STARTED + seconds * 1000;

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
    proposalid: "P2",
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
    state: "running",
    round: 2,
    started: STARTED,
    proposals: [prop("P1", "ux", 60), prop("P2", "ram", 100), prop("P3", "sk", 132)],
    replies: [],
    tokens: 0,
    calls: 0,
    created: 0,
    updated: 0,
    ...extra,
});

const messages = (items: ReturnType<typeof councilFeed>) => items.filter((i) => i.kind === "message");

describe("councilFeed: the goal and the order", () => {
    it("opens with the person's question as a `sets the goal` message of theirs", () => {
        const feed = councilFeed(council());
        expect(feed[0]).toEqual({
            kind: "message",
            author: "you",
            label: "sets the goal",
            text: "Which changes to the rail are worth making first?",
            mine: true,
            at: "0:00",
        });
    });

    it("opens with no goal when the council has no question", () => {
        expect(councilFeed(council({ question: "" })).some((i) => i.label === "sets the goal")).toBe(false);
        expect(councilFeed(council({ question: undefined })).some((i) => i.label === "sets the goal")).toBe(false);
        expect(councilFeed(council({ question: "  \n" })).some((i) => i.label === "sets the goal")).toBe(false);
    });

    it("orders the proposals and the replies by time, a tie by arrival", () => {
        const c = council({
            proposals: [prop("P2", "ram", 100), prop("P1", "ux", 60)],
            replies: [
                reply("r2", "sk", 150),
                reply("r1", "ux", 140, { proposalid: "P1" }),
                reply("r3", "nu", 150, { proposalid: "P1" }),
            ],
        });
        expect(messages(councilFeed(c)).map((i) => i.id)).toEqual([undefined, "P1", "P2", "r1", "r2", "r3"]);
    });

    it("gives a message its time as the council's clock read", () => {
        const c = council({ replies: [reply("r1", "sk", 195)] });
        const items = councilFeed(c);
        expect(items.find((i) => i.id === "P1")?.at).toBe("1:00");
        expect(items.find((i) => i.id === "r1")?.at).toBe("3:15");
    });
});

describe("councilFeed: Review labels", () => {
    it("labels a proposal `proposes` and carries its title, argument and ids", () => {
        const p1 = councilFeed(council()).find((i) => i.id === "P1");
        expect(p1).toMatchObject({
            kind: "message",
            author: "ux",
            label: "proposes",
            title: "title P1",
            text: "argument P1",
            proposalid: "P1",
        });
        expect(p1?.on).toBeUndefined();
        expect(p1?.mine).toBeUndefined();
    });

    it("labels a reply by its stance: doubts, against, anything else a plain reply", () => {
        const c = council({
            replies: [
                reply("r1", "sk", 140, { stance: "challenge" }),
                reply("r2", "ux", 141, { stance: "oppose" }),
                reply("r3", "nu", 142, { stance: "accept" }),
                reply("r4", "ram", 143),
            ],
        });
        const labels = Object.fromEntries(councilFeed(c).map((i) => [i.id, i.label]));
        expect(labels).toMatchObject({ r1: "has doubts", r2: "is against it", r3: "replies", r4: "replies" });
    });

    it("never labels an expert's reply `builds on it`, even if the wire says so", () => {
        const c = council({ replies: [reply("r1", "sk", 140, { builds: true })] });
        expect(councilFeed(c).find((i) => i.id === "r1")?.label).toBe("replies");
    });

    it("carries the title of the proposal a reply is on", () => {
        const c = council({ replies: [reply("r1", "sk", 140), reply("r2", "ux", 141, { proposalid: "P1" })] });
        const items = councilFeed(c);
        expect(items.find((i) => i.id === "r1")?.on).toBe("title P2");
        expect(items.find((i) => i.id === "r2")?.on).toBe("title P1");
        expect(items.find((i) => i.id === "r1")?.proposalid).toBe("P2");
    });
});

describe("councilFeed: Brainstorm labels", () => {
    it("labels a proposal `idea`, and a `Wild` one `wild idea`", () => {
        const c = council({
            mode: "brainstorm",
            proposals: [prop("P1", "ux", 60), prop("P2", "ram", 100, { wild: true })],
        });
        const labels = Object.fromEntries(councilFeed(c).map((i) => [i.id, i.label]));
        expect(labels.P1).toBe("idea");
        expect(labels.P2).toBe("wild idea");
    });

    it("labels a `Builds` reply `builds on it`, the others by stance", () => {
        const c = council({
            mode: "brainstorm",
            replies: [
                reply("r1", "sk", 140, { builds: true }),
                reply("r2", "ux", 141, { builds: true, stance: "challenge" }),
                reply("r3", "nu", 142, { stance: "challenge" }),
                reply("r4", "ram", 143, { stance: "oppose" }),
                reply("r5", "sk", 144),
            ],
        });
        const labels = Object.fromEntries(councilFeed(c).map((i) => [i.id, i.label]));
        expect(labels).toMatchObject({
            r1: "builds on it",
            r2: "builds on it",
            r3: "has doubts",
            r4: "is against it",
            r5: "replies",
        });
    });

    it("reads a council with no mode, an empty one or an unknown one as Review", () => {
        for (const mode of [undefined, "", "review", "other"]) {
            const c = council({ mode, proposals: [prop("P1", "ux", 60, { wild: true })] });
            expect(councilFeed(c).find((i) => i.id === "P1")?.label).toBe("proposes");
        }
    });
});

describe("councilFeed: the person's messages", () => {
    it("labels a reply of the person's on an idea `replies` and one to the whole council `steers`", () => {
        const c = council({
            replies: [reply("r1", "you", 140), reply("r2", "you", 141, { proposalid: "", text: "Look at Mac too" })],
        });
        const items = councilFeed(c);
        const r1 = items.find((i) => i.id === "r1");
        const r2 = items.find((i) => i.id === "r2");
        expect(r1).toMatchObject({ author: "you", label: "replies", mine: true, on: "title P2" });
        expect(r2).toMatchObject({ author: "you", label: "steers", mine: true, text: "Look at Mac too" });
        expect(r2?.on).toBeUndefined();
    });

    it("keeps `mine` off an expert's messages", () => {
        const c = council({ replies: [reply("r1", "sk", 140)] });
        expect(councilFeed(c).find((i) => i.id === "r1")?.mine).toBeUndefined();
    });
});

describe("councilFeed: agreement and evidence", () => {
    it("draws an expert's accept with no text as a reaction on its proposal's message, not as an item", () => {
        const c = council({
            replies: [
                reply("r1", "nu", 140, { stance: "accept", text: "" }),
                reply("r2", "sk", 141, { stance: "challenge" }),
            ],
        });
        const items = councilFeed(c);
        expect(items.some((i) => i.id === "r1")).toBe(false);
        expect(items.find((i) => i.id === "P2")?.reactions).toEqual(["New user agrees"]);
        expect(items.find((i) => i.id === "P1")?.reactions).toBeUndefined();
        expect(items.find((i) => i.id === "r2")?.reactions).toBeUndefined();
    });

    it("keeps an accept that has text as a reply, with no reaction", () => {
        const c = council({ replies: [reply("r1", "nu", 140, { stance: "accept", text: "Yes, because X" })] });
        const items = councilFeed(c);
        expect(items.find((i) => i.id === "r1")?.label).toBe("replies");
        expect(items.find((i) => i.id === "P2")?.reactions).toBeUndefined();
    });

    it("carries the evidence refs, and a weak claim as its own chip text", () => {
        const c = council({
            proposals: [
                prop("P1", "ux", 60, {
                    evidence: [
                        { ref: "pkg/services/model.go:38" },
                        { ref: "", weak: true, note: '"about 3 s" has no measurement' },
                    ],
                }),
                prop("P2", "ram", 100),
            ],
            replies: [reply("r1", "sk", 140, { evidence: [{ ref: "railapps.ts:10" }] })],
        });
        const items = councilFeed(c);
        const p1 = items.find((i) => i.id === "P1");
        expect(p1?.evidence).toEqual(["pkg/services/model.go:38"]);
        expect(p1?.weak).toBe('Weak · "about 3 s" has no measurement');
        expect(items.find((i) => i.id === "r1")?.evidence).toEqual(["railapps.ts:10"]);
        expect(items.find((i) => i.id === "r1")?.weak).toBeUndefined();
        expect(items.find((i) => i.id === "P2")?.evidence).toBeUndefined();
        expect(items.find((i) => i.id === "P2")?.weak).toBeUndefined();
    });
});

describe("councilFeed: who is writing", () => {
    it("yields a typing item for each expert with live activity, the proposal it is on named", () => {
        const c = council({
            activity: {
                sk: { text: "Replying to UX", proposalid: "P2", parentid: "r1" },
                coordinator: { text: "Writing the summary" },
            },
        });
        const typing = councilFeed(c).filter((i) => i.kind === "typing");
        expect(typing).toEqual([
            {
                kind: "typing",
                id: "typing:sk",
                author: "sk",
                text: "Skeptic is writing…",
                on: "title P2",
                proposalid: "P2",
            },
            { kind: "typing", id: "typing:coordinator", author: "coordinator", text: "Coordinator is writing…" },
        ]);
    });

    it("puts the typing items last, after every message", () => {
        const c = council({
            activity: { sk: { text: "Replying", proposalid: "P2" } },
            replies: [reply("r1", "ux", 140)],
        });
        const kinds = councilFeed(c).map((i) => i.kind);
        expect(kinds[kinds.length - 1]).toBe("typing");
        expect(kinds.indexOf("typing")).toBe(kinds.lastIndexOf("typing"));
    });

    it("yields none when the council is not running", () => {
        const c = council({ state: "done", activity: { sk: { text: "Replying", proposalid: "P2" } } });
        expect(councilFeed(c).some((i) => i.kind === "typing")).toBe(false);
    });
});

describe("councilFeed: the step boundaries", () => {
    it("opens the argue step with a system line: the time, the ideas and who gave them", () => {
        const c = council({ replies: [reply("r1", "sk", 140)] });
        const items = councilFeed(c);
        const system = items.filter((i) => i.kind === "system");
        expect(system).toEqual([
            { kind: "system", text: "2:12 · 3 ideas from 3 experts · now they argue", at: "2:12" },
        ]);
        // after the last idea, before the first reply
        const order = items.map((i) => i.id ?? i.kind);
        expect(order.indexOf("system")).toBeGreaterThan(order.indexOf("P3"));
        expect(order.indexOf("system")).toBeLessThan(order.indexOf("r1"));
    });

    it("words the Brainstorm boundary `now they build on each other`", () => {
        const c = council({ mode: "brainstorm", replies: [reply("r1", "sk", 140)] });
        expect(councilFeed(c).find((i) => i.kind === "system")?.text).toBe(
            "2:12 · 3 ideas from 3 experts · now they build on each other"
        );
    });

    it("counts one idea from one expert in the singular", () => {
        const c = council({
            proposals: [prop("P1", "ux", 60)],
            replies: [reply("r1", "sk", 140, { proposalid: "P1" })],
        });
        expect(councilFeed(c).find((i) => i.kind === "system")?.text).toBe(
            "1:00 · 1 idea from 1 expert · now they argue"
        );
    });

    it("counts only the ideas that came before the first reply of the argument", () => {
        const c = council({
            proposals: [prop("P1", "ux", 60), prop("P2", "ram", 100), prop("P3", "sk", 200)],
            replies: [reply("r1", "sk", 140, { proposalid: "P1" })],
        });
        const items = councilFeed(c);
        expect(items.find((i) => i.kind === "system")?.text).toBe("1:40 · 2 ideas from 2 experts · now they argue");
        const order = items.map((i) => i.id ?? i.kind);
        // the late idea (a retried call) lands in time order after the boundary
        expect(order.indexOf("P3")).toBeGreaterThan(order.indexOf("system"));
    });

    it("has no boundary while the experts first propose", () => {
        const c = council({ round: 1 });
        expect(councilFeed(c).some((i) => i.kind === "system")).toBe(false);
    });

    it("opens the answer step with a second line once the council is in step 3", () => {
        const c = council({
            round: 3,
            replies: [
                reply("r1", "sk", 140),
                reply("r2", "ux", 170),
                reply("r3", "nu", 180, { text: "", stance: "accept" }),
            ],
        });
        const system = councilFeed(c).filter((i) => i.kind === "system");
        expect(system.map((i) => i.text)).toEqual([
            "2:12 · 3 ideas from 3 experts · now they argue",
            "3:00 · 2 replies · now the coordinator writes the answer",
        ]);
    });

    it("words the Brainstorm answer step `picks the best`", () => {
        const c = council({ mode: "brainstorm", round: 3, replies: [reply("r1", "sk", 140)] });
        expect(councilFeed(c).filter((i) => i.kind === "system")[1].text).toBe(
            "2:20 · 1 reply · now the coordinator picks the best"
        );
    });

    it("drops the time from a line when the council has no start", () => {
        const c = council({ started: undefined, replies: [reply("r1", "sk", 140)] });
        expect(councilFeed(c).find((i) => i.kind === "system")?.text).toBe("3 ideas from 3 experts · now they argue");
    });
});

describe("councilFeed: onProposal", () => {
    const c = council({
        round: 3,
        activity: { sk: { text: "Replying", proposalid: "P2" }, ux: { text: "Replying", proposalid: "P1" } },
        replies: [
            reply("r1", "sk", 140),
            reply("r2", "ux", 141, { proposalid: "P1" }),
            reply("r3", "nu", 142, { stance: "accept", text: "" }),
            reply("r4", "you", 143, { proposalid: "" }),
            reply("r5", "ux", 144, { parentid: "r1" }),
        ],
    });

    it("keeps only that proposal's message, its replies and the typing on it", () => {
        const items = councilFeed(c, "P2");
        expect(items.map((i) => i.id)).toEqual(["P2", "r1", "r5", "typing:sk"]);
        expect(items.find((i) => i.id === "P2")?.reactions).toEqual(["New user agrees"]);
        expect(items.every((i) => i.kind !== "system")).toBe(true);
    });

    it("carries the proposal's title as the `on` line of every one of its replies and none on its own message", () => {
        const items = councilFeed(c, "P2");
        expect(items.find((i) => i.id === "P2")?.on).toBeUndefined();
        for (const i of items.filter((x) => x.id !== "P2")) {
            expect(i.on).toBe("title P2");
        }
    });

    it("shows the whole feed for an empty filter, and no message for a proposal that is not there", () => {
        const all = councilFeed(c).length;
        expect(councilFeed(c, "").length).toBe(all);
        expect(councilFeed(c, undefined).length).toBe(all);
        expect(messages(councilFeed(c, "P9"))).toEqual([]);
    });
});

describe("stepOf", () => {
    it("reads the step off the round and words the three parts of a Review", () => {
        const review: [string, string, string] = ["Read and propose", "Argue", "Write the answer"];
        expect(stepOf(council({ round: 0 }))).toEqual({ step: 1, words: review });
        expect(stepOf(council({ round: 1 }))).toEqual({ step: 1, words: review });
        expect(stepOf(council({ round: 2 }))).toEqual({ step: 2, words: review });
        expect(stepOf(council({ round: 3 }))).toEqual({ step: 3, words: review });
    });

    it("words the three parts of a Brainstorm", () => {
        const brainstorm: [string, string, string] = ["Ideas", "Build on each other", "Pick the best"];
        for (const [round, step] of [
            [1, 1],
            [2, 2],
            [3, 3],
        ] as const) {
            expect(stepOf(council({ mode: "brainstorm", round }))).toEqual({ step, words: brainstorm });
        }
    });

    it("keeps a follow-up on the last part", () => {
        expect(stepOf(council({ round: 4 })).step).toBe(3);
    });
});

describe("showsFeed, isQueued and modeWord", () => {
    it("shows the feed only while a council with ideas is running its step 2 or 3", () => {
        expect(showsFeed(council({ round: 2 }))).toBe(true);
        expect(showsFeed(council({ round: 3 }))).toBe(true);
        expect(showsFeed(council({ round: 1 }))).toBe(false);
        expect(showsFeed(council({ round: 4 }))).toBe(false);
        for (const state of ["awaiting-you", "done", "stopped", "failed", "not-run", "queued"]) {
            expect(showsFeed(council({ state, round: 2 }))).toBe(false);
        }
        expect(showsFeed(council({ round: 2, proposals: [] }))).toBe(false);
        expect(showsFeed(council({ round: 2, proposals: undefined }))).toBe(false);
    });

    it("knows a queued council", () => {
        expect(isQueued(council({ state: "queued", round: 0 }))).toBe(true);
        expect(isQueued(council())).toBe(false);
    });

    it("names the mode, Review when there is none", () => {
        expect(modeWord(council({ mode: "brainstorm" }))).toBe("Brainstorm");
        expect(modeWord(council({ mode: "review" }))).toBe("Review");
        expect(modeWord(council({ mode: undefined }))).toBe("Review");
        expect(modeWord(council({ mode: "" }))).toBe("Review");
    });
});
