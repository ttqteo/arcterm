import { describe, expect, it } from "vitest";
import {
    STANCE_WORD,
    UNTITLED_COUNCIL,
    agentSeat,
    answerers,
    callSegments,
    canRemoveCouncil,
    canSummarize,
    costLine,
    councilProjectKey,
    councilProjectName,
    countTokens,
    draftFromCouncil,
    draftWithAgents,
    draftsWaitWord,
    emptyCouncilDraft,
    estimateLabel,
    estimateTokens,
    expertStat,
    firstFollowRound,
    flattenThread,
    followupLabel,
    hasAgents,
    headerChip,
    heldDrafts,
    isAgentSeat,
    latestStances,
    matrixRows,
    outdatedCount,
    panel,
    pickCount,
    queuedLine,
    rankedProposals,
    replyLabel,
    roundsOf,
    score,
    summarizeHold,
    summaryChip,
    synthesisRound,
    threadTree,
    treeMeta,
} from "./councilmodel";

const MIN = 60_000;

const experts: CouncilExpert[] = [
    { id: "ux", name: "UX", brief: "", model: "sonnet" },
    { id: "ram", name: "RAM", brief: "", model: "sonnet" },
    { id: "nu", name: "New user", brief: "", model: "sonnet" },
    { id: "sk", name: "Skeptic", brief: "", model: "sonnet" },
    { id: "coordinator", name: "Coordinator", brief: "", model: "opus", coordinator: true },
];

const prop = (id: string, author: string, extra: Partial<CouncilProposal> = {}): CouncilProposal => ({
    id,
    author,
    title: `title ${id}`,
    argument: `argument ${id}`,
    ts: 1,
    ...extra,
});

const reply = (id: string, author: string, extra: Partial<CouncilReply> = {}): CouncilReply => ({
    id,
    proposalid: "P2",
    author,
    text: `text ${id}`,
    round: 2,
    ts: 10,
    ...extra,
});

// a live agent's seat, as agentSeat builds it
const agentOf = (tab: string, name: string, extra: Partial<CouncilExpert> = {}): CouncilExpert => ({
    ...agentSeat({ id: tab, name, project: "D:\\code\\arc", harness: "claude", context: 625_000 }),
    ...extra,
});

const council = (extra: Partial<Council> = {}): Council => ({
    id: "c1",
    project: "D:\\code\\arc",
    feature: "Rail apps",
    experts,
    state: "running",
    round: 2,
    proposals: [
        prop("P1", "ux"),
        prop("P2", "ux"),
        prop("P3", "ram"),
        prop("P4", "nu"),
        prop("P5", "sk"),
        prop("P6", "sk", { withdrawn: true }),
    ],
    tokens: 0,
    calls: 0,
    created: 0,
    updated: 0,
    ...extra,
});

describe("panel", () => {
    it("is every expert but the coordinator", () => {
        expect(panel(council()).map((e) => e.id)).toEqual(["ux", "ram", "nu", "sk"]);
    });
});

describe("latestStances", () => {
    it("keeps each expert's last stance per proposal, the author as proposed", () => {
        const c = council({
            replies: [
                reply("r1", "ram", { stance: "oppose", ts: 5 }),
                reply("r2", "sk", { stance: "challenge", ts: 6 }),
                reply("r3", "ram", { stance: "accept", ts: 9 }),
                reply("r4", "you", { ts: 9 }),
                reply("r5", "nu", { stance: "accept", ts: 7 }),
                reply("r6", "ux", { text: "revised", revised: true, ts: 8 }),
            ],
        });
        const s = latestStances(c);
        expect(s.P2).toEqual({ ux: "proposed", ram: "accept", sk: "challenge", nu: "accept" });
        expect(s.P1).toEqual({ ux: "proposed" });
        expect(s.P6).toEqual({ sk: "proposed" });
    });

    it("orders by time, and a tie by arrival", () => {
        const c = council({
            replies: [
                reply("r1", "ram", { stance: "oppose", ts: 5 }),
                reply("r2", "ram", { stance: "accept", ts: 5 }),
                reply("r3", "sk", { stance: "accept", ts: 9 }),
                reply("r4", "sk", { stance: "oppose", ts: 3 }),
            ],
        });
        expect(latestStances(c).P2).toEqual({ ux: "proposed", ram: "accept", sk: "accept" });
    });

    it("never lets the author's own replies override proposed, and ignores an unknown stance word", () => {
        const c = council({
            replies: [
                reply("r1", "ux", { stance: "accept", ts: 5 }),
                reply("r2", "ram", { stance: "maybe", ts: 6 }),
                reply("r3", "ram", { stance: "accept", proposalid: "P99", ts: 7 }),
            ],
        });
        expect(latestStances(c).P2).toEqual({ ux: "proposed" });
        expect(latestStances(c).P99).toBeUndefined();
    });
});

describe("STANCE_WORD", () => {
    it("is the plain word for each stance", () => {
        expect(STANCE_WORD).toEqual({
            accept: "Agrees",
            challenge: "Has doubts",
            oppose: "Is against it",
            proposed: "Proposed",
        });
    });
});

describe("pickCount and the ranking by picks", () => {
    const picked = council({
        picks: { ux: ["P2", "P3"], ram: ["P2"], sk: ["P3", "P2", "P4"] },
        replies: [reply("r1", "ram", { stance: "oppose", proposalid: "P1", ts: 1 })],
    });

    it("counts the experts whose picks hold the proposal", () => {
        expect(pickCount(picked, "P2")).toBe(3);
        expect(pickCount(picked, "P3")).toBe(2);
        expect(pickCount(picked, "P4")).toBe(1);
        expect(pickCount(picked, "P1")).toBe(0);
    });

    it("is null for a council with no picks at all", () => {
        expect(pickCount(council(), "P2")).toBeNull();
        expect(pickCount(council({ picks: {} }), "P2")).toBeNull();
    });

    it("ranks by picks, a tie by score, withdrawn and cut last, and keeps the score beside them", () => {
        const rows = rankedProposals(picked);
        expect(rows.map((r) => r.proposal.id)).toEqual(["P2", "P3", "P4", "P5", "P1", "P6"]);
        expect(rows.map((r) => r.picks)).toEqual([3, 2, 1, 0, 0, 0]);
        expect(rows.find((r) => r.proposal.id === "P1")!.score).toBe(-1);
    });

    it("leaves picks null on every row of a council with no picks, which ranks by score as before", () => {
        const rows = rankedProposals(council({ replies: [reply("r1", "nu", { stance: "accept", ts: 1 })] }));
        expect(rows.every((r) => r.picks === null)).toBe(true);
        expect(rows[0].proposal.id).toBe("P2");
    });
});

describe("reactions are no replies", () => {
    const blank = (id: string, author: string, extra: Partial<CouncilReply> = {}) =>
        reply(id, author, { stance: "accept", text: "", ...extra });

    it("leaves an accept with no text out of the thread, the reply count and the cost line", () => {
        const c = council({
            tokens: 1000,
            replies: [blank("r1", "ram", { ts: 1 }), reply("r2", "sk", { stance: "challenge", ts: 2 })],
        });
        expect(flattenThread(threadTree(c, "P2")).map((n) => n.key)).toEqual(["r2"]);
        expect(rankedProposals(c).find((r) => r.proposal.id === "P2")!.replies).toBe(1);
        expect(costLine(c, 0)).toBe("1 reply · 1k tokens");
    });

    it("still counts the accept in the vote", () => {
        const c = council({ replies: [blank("r1", "ram", { ts: 1 })] });
        expect(latestStances(c).P2.ram).toBe("accept");
        expect(score(c, "P2")).toBe(1);
    });

    it("keeps an accept with text, and the person's reply, as replies", () => {
        const c = council({ replies: [reply("r1", "ram", { stance: "accept" }), blank("r2", "you")] });
        expect(flattenThread(threadTree(c, "P2")).map((n) => n.key)).toEqual(["r1", "r2"]);
    });
});

describe("score and rankedProposals", () => {
    const c = council({
        replies: [
            reply("r1", "ram", { stance: "oppose", ts: 1 }),
            reply("r2", "nu", { stance: "accept", ts: 2 }),
            reply("r3", "sk", { stance: "accept", ts: 3 }),
            reply("r4", "ux", { stance: "oppose", proposalid: "P3", ts: 4 }),
            reply("r5", "sk", { stance: "oppose", proposalid: "P3", ts: 5 }),
            reply("r6", "nu", { stance: "accept", proposalid: "P3", ts: 6 }),
            reply("r7", "ux", { stance: "challenge", proposalid: "P4", ts: 7 }),
            reply("r8", "ram", { stance: "accept", proposalid: "P6", ts: 8 }),
            reply("r9", "nu", { stance: "accept", proposalid: "P6", ts: 9 }),
            reply("r10", "ux", { stance: "accept", proposalid: "P6", ts: 10 }),
        ],
        activity: {
            sk: { text: "Replying to UX on P2", proposalid: "P2", parentid: "r1" },
            ux: { text: "Replying to RAM on P3", proposalid: "P3" },
        },
    });

    it("is accepts minus opposes, a challenge counting for nothing", () => {
        expect(score(c, "P2")).toBe(1);
        expect(score(c, "P3")).toBe(-1);
        expect(score(c, "P4")).toBe(0);
        expect(score(c, "P1")).toBe(0);
    });

    it("counts an expert once, by its last stance", () => {
        const flipped = council({
            replies: [reply("r1", "ram", { stance: "oppose", ts: 1 }), reply("r2", "ram", { stance: "accept", ts: 2 })],
        });
        expect(score(flipped, "P2")).toBe(1);
    });

    it("ranks by score with the withdrawn last, ties in arrival order", () => {
        const rows = rankedProposals(c);
        expect(rows.map((r) => r.proposal.id)).toEqual(["P2", "P1", "P4", "P5", "P3", "P6"]);
        expect(rows.map((r) => r.score)).toEqual([1, 0, 0, 0, -1, 3]);
    });

    it("counts the replies on a proposal and the experts writing there", () => {
        const rows = rankedProposals(c);
        const p2 = rows.find((r) => r.proposal.id === "P2")!;
        const p3 = rows.find((r) => r.proposal.id === "P3")!;
        expect(p2.replies).toBe(3);
        expect(p2.replying).toBe(1);
        expect(p3.replies).toBe(3);
        expect(p3.replying).toBe(1);
        expect(rows.find((r) => r.proposal.id === "P1")!.replying).toBe(0);
    });

    it("counts no one as writing once the council is not running", () => {
        const stopped = council({ ...c, state: "stopped" });
        expect(rankedProposals(stopped).every((r) => r.replying === 0)).toBe(true);
    });

    it("puts a proposal the person cut at the pause after the live ones", () => {
        const cut = council({ proposals: [prop("P1", "ux", { cut: true }), prop("P2", "ram")] });
        expect(rankedProposals(cut).map((r) => r.proposal.id)).toEqual(["P2", "P1"]);
    });
});

describe("threadTree", () => {
    const c = council({
        replies: [
            reply("r1", "sk", { stance: "challenge", ts: 20 }),
            reply("r2", "ux", { parentid: "r1", ts: 30 }),
            reply("r3", "ram", { stance: "oppose", ts: 10 }),
            reply("r4", "nu", { stance: "accept", parentid: "r3", ts: 15 }),
            reply("r5", "you", { parentid: "r4", ts: 16 }),
            reply("r6", "ux", { proposalid: "P1", ts: 12 }),
        ],
        activity: {
            sk: { text: "Replying to UX on P2", proposalid: "P2", parentid: "r2" },
            ram: { text: "Replying to UX on P1", proposalid: "P1" },
        },
    });

    it("nests replies under their parent, siblings by time, each with its depth", () => {
        const flat = flattenThread(threadTree(c, "P2"));
        expect(flat.map((n) => [n.key, n.depth])).toEqual([
            ["r3", 0],
            ["r4", 1],
            ["r5", 2],
            ["r1", 0],
            ["r2", 1],
            ["typing:sk", 2],
        ]);
        const roots = threadTree(c, "P2");
        expect(roots.map((n) => n.key)).toEqual(["r3", "r1"]);
        expect(roots[0].children.map((n) => n.key)).toEqual(["r4"]);
    });

    it("adds a typing node under the reply the expert answers", () => {
        const typing = flattenThread(threadTree(c, "P2")).find((n) => n.kind === "typing")!;
        expect(typing.text).toBe("Skeptic is writing a reply…");
        expect(typing.author).toBe("sk");
        expect(typing.reply).toBeUndefined();
    });

    it("puts a typing node with no parent at the end of the proposal's replies", () => {
        const flat = flattenThread(threadTree(c, "P1"));
        expect(flat.map((n) => [n.key, n.depth])).toEqual([
            ["r6", 0],
            ["typing:ram", 0],
        ]);
    });

    it("draws no typing node once the council is not running", () => {
        const stopped = council({ ...c, state: "stopped" });
        expect(flattenThread(threadTree(stopped, "P2")).some((n) => n.kind === "typing")).toBe(false);
    });

    it("roots a reply whose parent is not in the thread, and survives a loop", () => {
        const odd = council({
            replies: [
                reply("r1", "sk", { parentid: "r99", ts: 1 }),
                reply("r2", "ux", { parentid: "r3", ts: 2 }),
                reply("r3", "ram", { parentid: "r2", ts: 3 }),
            ],
        });
        expect(flattenThread(threadTree(odd, "P2")).map((n) => [n.key, n.depth])).toEqual([
            ["r1", 0],
            ["r2", 0],
            ["r3", 1],
        ]);
    });

    it("is empty for a proposal with no replies", () => {
        expect(threadTree(c, "P4")).toEqual([]);
    });
});

describe("answerers", () => {
    const c = council({
        replies: [
            reply("r1", "sk", { ts: 1 }),
            reply("r2", "you", { parentid: "r1", ts: 2 }),
            reply("r3", "ram", { parentid: "r2", ts: 3 }),
        ],
    });
    const ids = (list: CouncilExpert[]) => list.map((e) => e.id);

    it("is the proposal's author and every expert on the path to the reply", () => {
        expect(ids(answerers(c, "P2", "r3", "why?"))).toEqual(["ux", "ram", "sk"]);
        expect(ids(answerers(c, "P2", "r1", "why?"))).toEqual(["ux", "sk"]);
    });

    it("is the proposal's author alone for a reply to the post itself", () => {
        expect(ids(answerers(c, "P3", "", "why?"))).toEqual(["ram"]);
    });

    it("is only the @-mentioned experts, by name or id, in any case", () => {
        expect(ids(answerers(c, "P2", "r1", "@RAM what do you think"))).toEqual(["ram"]);
        expect(ids(answerers(c, "P2", "r1", "@ram and @new user?"))).toEqual(["ram", "nu"]);
        expect(ids(answerers(c, "P2", "r1", "ask @nu, please"))).toEqual(["nu"]);
        expect(ids(answerers(c, "", "", "@Skeptic: is it true"))).toEqual(["sk"]);
    });

    it("does not read a longer word or an address as a mention", () => {
        expect(ids(answerers(c, "P2", "r1", "@RAMS and mail a@ram.com"))).toEqual(["ux", "sk"]);
    });

    it("ignores a mention of the coordinator or of no one", () => {
        expect(ids(answerers(c, "P2", "r1", "@coordinator @bob"))).toEqual(["ux", "sk"]);
    });

    it("is every non-coordinator expert with no proposal", () => {
        expect(ids(answerers(c, "", "", "anyone?"))).toEqual(["ux", "ram", "nu", "sk"]);
    });
});

describe("replyLabel", () => {
    const mine = (extra: Partial<CouncilReply>) => reply("r1", "you", extra);

    it("queues a reply posted in round 1 or while awaiting for round 2", () => {
        expect(replyLabel(council({ round: 1 }), mine({ round: 1 }))).toBe("Queued for the next step");
        expect(replyLabel(council({ round: 1, state: "awaiting-you" }), mine({ round: 1 }))).toBe(
            "Queued for the next step"
        );
        expect(replyLabel(council({ round: 2, state: "awaiting-you" }), mine({ round: 2 }))).toBe(
            "Queued for the next step"
        );
    });

    it("says a reply posted in round 2 or 3 is answered after the summary", () => {
        expect(replyLabel(council(), mine({ round: 2 }))).toBe("Answered after the summary");
        expect(replyLabel(council({ round: 3 }), mine({ round: 3 }))).toBe("Answered after the summary");
    });

    it("says a follow-up is being answered while its calls run", () => {
        expect(replyLabel(council({ state: "running", round: 3 }), mine({ round: 4 }))).toBe("Answering…");
        expect(replyLabel(council({ state: "done", round: 3 }), mine({ round: 4 }))).toBe("");
    });

    it("says nothing once it is answered, or of anyone else's reply", () => {
        expect(replyLabel(council(), mine({ round: 2, answered: true }))).toBe("");
        expect(replyLabel(council(), reply("r2", "ram", { round: 2 }))).toBe("");
    });

    it("queues a reply for the seats' next round until the last one", () => {
        const three = council({ rounds: 3, round: 2 });
        expect(replyLabel(three, mine({ round: 2 }))).toBe("Queued for the next step");
        expect(replyLabel(three, mine({ round: 3 }))).toBe("Answered after the summary");
        const one = council({ rounds: 1, round: 1 });
        expect(replyLabel(one, mine({ round: 1 }))).toBe("Answered after the summary");
    });

    it("says a follow-up is answered once the summary's round is past, whatever the rounds", () => {
        const three = (state: Council["state"]) => council({ rounds: 3, state, round: 4 });
        expect(replyLabel(three("running"), mine({ round: 4 }))).toBe("Answered after the summary");
        expect(replyLabel(three("running"), mine({ round: 5 }))).toBe("Answering…");
        expect(replyLabel(three("done"), mine({ round: 5 }))).toBe("");
        expect(replyLabel(council({ rounds: 1, state: "running", round: 3 }), mine({ round: 3 }))).toBe("Answering…");
    });
});

describe("token labels", () => {
    it("counts a council's tokens in k, then in hundredths of a million", () => {
        expect(countTokens(0)).toBe("0");
        expect(countTokens(999)).toBe("999");
        expect(countTokens(84_000)).toBe("84k");
        expect(countTokens(71_400)).toBe("71k");
        expect(countTokens(310_000)).toBe("0.31M");
        expect(countTokens(550_000)).toBe("0.55M");
        expect(countTokens(1_500_000)).toBe("1.50M");
    });

    it("rounds an estimate to a tenth of a million from 100k up, as wsh prints it", () => {
        expect(estimateTokens(500)).toBe("500");
        expect(estimateTokens(40_000)).toBe("40k");
        expect(estimateTokens(84_000)).toBe("84k");
        expect(estimateTokens(180_000)).toBe("0.2M");
        expect(estimateTokens(260_000)).toBe("0.3M");
        expect(estimateTokens(820_000)).toBe("0.8M");
        expect(estimateTokens(1_000_000)).toBe("1M");
        expect(estimateTokens(1_200_000)).toBe("1.2M");
    });
});

describe("estimateLabel and followupLabel", () => {
    it("words the whole-council estimate", () => {
        expect(estimateLabel({ calls: 9, tokens: 820_000, minutes: 6 })).toBe("≈ 9 calls · ~0.8M tokens · ~6 min");
        expect(estimateLabel({ calls: 5, tokens: 260_000, minutes: 3 }, false)).toBe("≈ 5 calls · ~0.3M tokens");
        expect(estimateLabel({ calls: 1, tokens: 20_000, minutes: 1 })).toBe("≈ 1 call · ~20k tokens · ~1 min");
    });

    it("names who answers and what it costs", () => {
        const text = { calls: 2, tokens: 40_000, minutes: 1 };
        const code = { calls: 2, tokens: 180_000, minutes: 2 };
        expect(followupLabel(text, 2, false)).toBe("2 experts answer · ≈ 2 calls · ~40k tokens");
        expect(followupLabel(code, 2, true)).toBe("2 experts answer, reading code · ≈ 2 calls · ~0.2M tokens");
        expect(followupLabel({ calls: 1, tokens: 20_000, minutes: 1 }, 1, false)).toBe(
            "1 expert answers · ≈ 1 call · ~20k tokens"
        );
    });

    it("names the experts alone while the estimate is not in", () => {
        expect(followupLabel(null, 3, false)).toBe("3 experts answer");
        expect(followupLabel(null, 1, true)).toBe("1 expert answers, reading code");
        expect(followupLabel(null, 0, false)).toBe("");
    });
});

describe("headerChip and treeMeta", () => {
    it("reads the round of the seats while they answer, whoever has finished and whoever is at work", () => {
        const c = council({
            round: 1,
            stats: { ux: { ms: 1, tokens: 1, calls: 1 }, nu: { ms: 1, tokens: 1, calls: 1 } },
            activity: { ram: { text: "Grep" }, sk: { text: "Read" } },
        });
        expect(headerChip(c)).toBe("Round 1 of 2");
        expect(headerChip(council({ round: 0 }))).toBe("Round 1 of 2");
        const replying = council({
            activity: {
                ram: { text: "Replying to UX on P2", proposalid: "P2" },
                sk: { text: "Replying to UX on P2", proposalid: "P2" },
                coordinator: { text: "Waiting" },
            },
        });
        expect(headerChip(replying)).toBe("Round 2 of 2");
        expect(headerChip(council())).toBe("Round 2 of 2");
    });

    it("counts the rounds the council has", () => {
        expect(headerChip(council({ rounds: 3, round: 3 }))).toBe("Round 3 of 3");
        expect(headerChip(council({ rounds: 1, round: 1 }))).toBe("Round 1 of 1");
        expect(headerChip(council({ rounds: 9, round: 2 }))).toBe("Round 2 of 2");
    });

    it("says the summary is being written once the last round is over, whoever is still at work", () => {
        expect(headerChip(council({ round: 3 }))).toBe("Writing the summary");
        expect(headerChip(council({ round: 3, activity: { ux: { text: "Answering" } } }))).toBe("Writing the summary");
        expect(headerChip(council({ rounds: 3, round: 4 }))).toBe("Writing the summary");
        expect(headerChip(council({ rounds: 1, round: 2 }))).toBe("Writing the summary");
    });

    it("counts the seats answering a follow-up", () => {
        expect(headerChip(council({ round: 4, activity: { ux: { text: "a" }, ram: { text: "b" } } }))).toBe(
            "Follow-up · 2 answering"
        );
        expect(headerChip(council({ round: 4 }))).toBe("Follow-up");
        expect(headerChip(council({ rounds: 3, round: 5 }))).toBe("Follow-up");
    });

    it("appends the drafts that wait for the person to the step", () => {
        const held = council({
            round: 2,
            proposals: [prop("P1", "ux", { draft: "held" })],
            replies: [
                reply("r1", "ram", { draft: "held" }),
                reply("r2", "sk", { draft: "dropped" }),
                reply("r3", "nu"),
            ],
        });
        expect(headerChip(held)).toBe("Round 2 of 2 · 2 drafts wait for you");
        expect(headerChip({ ...held, replies: [] })).toBe("Round 2 of 2 · 1 draft waits for you");
        expect(headerChip({ ...held, round: 3 })).toBe("Writing the summary · 2 drafts wait for you");
        // dropped and sent drafts wait for no one
        expect(headerChip({ ...held, proposals: [], replies: [reply("r2", "sk", { draft: "dropped" })] })).toBe(
            "Round 2 of 2"
        );
    });

    it("reads the step, not Waiting on you, once a round ends on held drafts", () => {
        const c = council({ state: "awaiting-you", round: 1, replies: [reply("r1", "ram", { draft: "held" })] });
        expect(headerChip(c)).toBe("Round 1 of 2 · 1 draft waits for you");
        expect(headerChip({ ...c, replies: [] })).toBe("Waiting on you");
    });

    it("tells a done council it holds a follow-up answer, and no other ended council", () => {
        const held = [reply("r1", "ram", { draft: "held", round: 4 })];
        expect(headerChip(council({ state: "done", round: 3, replies: held }))).toBe("Done · 1 draft waits for you");
        expect(headerChip(council({ state: "stopped", round: 2, replies: held }))).toBe("Stopped");
        expect(headerChip(council({ state: "failed", round: 2, replies: held }))).toBe("Failed");
    });

    it("words every other state", () => {
        expect(headerChip(council({ state: "awaiting-you", round: 1 }))).toBe("Waiting on you");
        expect(headerChip(council({ state: "done", round: 3 }))).toBe("Done");
        expect(headerChip(council({ state: "not-run", round: 0 }))).toBe("Not run");
        expect(headerChip(council({ state: "stopped" }))).toBe("Stopped");
        expect(headerChip(council({ state: "failed", round: 3 }))).toBe("Failed");
    });

    it("words a council waiting for the one that runs", () => {
        expect(headerChip(council({ state: "queued", round: 0 }))).toBe("Queued");
        expect(treeMeta(council({ state: "queued", round: 0 }))).toEqual({ text: "Queued", tone: "muted" });
    });

    it("gives the tree row its word and tone", () => {
        expect(treeMeta(council({ round: 2 }))).toEqual({ text: "Running", tone: "working" });
        expect(treeMeta(council({ round: 3 }))).toEqual({ text: "Running", tone: "working" });
        expect(treeMeta(council({ round: 4 }))).toEqual({ text: "Answering", tone: "working" });
        expect(treeMeta(council({ rounds: 3, round: 4 }))).toEqual({ text: "Running", tone: "working" });
        expect(treeMeta(council({ rounds: 3, round: 5 }))).toEqual({ text: "Answering", tone: "working" });
        expect(treeMeta(council({ state: "awaiting-you" }))).toEqual({ text: "Waiting on you", tone: "asking" });
        expect(treeMeta(council({ state: "done" }))).toEqual({ text: "Done", tone: "muted" });
        expect(treeMeta(council({ state: "not-run" }))).toEqual({ text: "Not run", tone: "muted" });
        expect(treeMeta(council({ state: "stopped" }))).toEqual({ text: "Stopped", tone: "muted" });
        expect(treeMeta(council({ state: "failed" }))).toEqual({ text: "Failed", tone: "error" });
    });

    it("reads a council with held drafts as the person's move, whether it runs, waits or is done", () => {
        const held = [reply("r1", "ram", { draft: "held" }), reply("r2", "sk", { draft: "held" })];
        const waits = { text: "2 drafts wait for you", tone: "asking" };
        expect(treeMeta(council({ replies: held }))).toEqual(waits);
        expect(treeMeta(council({ state: "awaiting-you", replies: held }))).toEqual(waits);
        expect(treeMeta(council({ state: "done", round: 3, replies: held }))).toEqual(waits);
        expect(treeMeta(council({ replies: held.slice(0, 1) }))).toEqual({
            text: "1 draft waits for you",
            tone: "asking",
        });
        // a stopped or failed council has no one to answer to, and a dropped draft waits for no one
        expect(treeMeta(council({ state: "stopped", replies: held }))).toEqual({ text: "Stopped", tone: "muted" });
        expect(treeMeta(council({ state: "failed", replies: held }))).toEqual({ text: "Failed", tone: "error" });
        expect(treeMeta(council({ replies: [reply("r3", "ram", { draft: "dropped" })] }))).toEqual({
            text: "Running",
            tone: "working",
        });
    });
});

describe("roundsOf, synthesisRound and firstFollowRound", () => {
    it("reads 0, nothing and a count out of range as the 2 rounds a council had before rounds", () => {
        expect(roundsOf(council())).toBe(2);
        expect(roundsOf(council({ rounds: 0 }))).toBe(2);
        expect(roundsOf(council({ rounds: 4 }))).toBe(2);
        expect(roundsOf(council({ rounds: -1 }))).toBe(2);
        expect(roundsOf(null)).toBe(2);
        expect(roundsOf(undefined)).toBe(2);
    });

    it("keeps 1, 2 and 3", () => {
        expect([1, 2, 3].map((rounds) => roundsOf(council({ rounds })))).toEqual([1, 2, 3]);
    });

    it("puts the summary one round after the seats, and the follow-ups two", () => {
        for (const [rounds, summary, follow] of [
            [undefined, 3, 4],
            [0, 3, 4],
            [1, 2, 3],
            [2, 3, 4],
            [3, 4, 5],
        ] as const) {
            const c = council({ rounds });
            expect([synthesisRound(c), firstFollowRound(c)], `rounds ${rounds}`).toEqual([summary, follow]);
        }
    });
});

describe("isAgentSeat and hasAgents", () => {
    it("knows a seat that names an agent's tab", () => {
        expect(isAgentSeat(agentOf("t1", "Witness synthesis"))).toBe(true);
        expect(isAgentSeat(experts[0])).toBe(false);
        expect(isAgentSeat({ agent: "" })).toBe(false);
    });

    it("knows a council an agent sits in", () => {
        expect(hasAgents(council())).toBe(false);
        expect(hasAgents(council({ experts: [agentOf("t1", "Witness synthesis"), ...experts] }))).toBe(true);
        expect(hasAgents(null)).toBe(false);
    });
});

describe("heldDrafts", () => {
    it("lists the held ideas and replies in the order they were written, an idea before a reply of the same time", () => {
        const c = council({
            proposals: [
                prop("P1", "ux", { ts: 30, draft: "held" }),
                prop("P2", "ram", { ts: 10, draft: "held" }),
                prop("P3", "nu", { ts: 5 }),
                prop("P4", "sk", { ts: 6, draft: "dropped" }),
            ],
            replies: [
                reply("r1", "sk", { ts: 30, draft: "held" }),
                reply("r2", "ux", { ts: 20, draft: "held" }),
                reply("r3", "nu", { ts: 25 }),
                reply("r4", "ram", { ts: 26, draft: "dropped" }),
            ],
        });
        expect(heldDrafts(c).map((d) => [d.kind, d.id, d.ts])).toEqual([
            ["idea", "P2", 10],
            ["reply", "r2", 20],
            ["idea", "P1", 30],
            ["reply", "r1", 30],
        ]);
        const first = heldDrafts(c)[0];
        expect(first.kind === "idea" && first.proposal.id).toBe("P2");
    });

    it("is empty for a council that holds nothing, and for one with no ideas or replies yet", () => {
        expect(heldDrafts(council())).toEqual([]);
        expect(heldDrafts({})).toEqual([]);
    });
});

describe("draftsWaitWord", () => {
    it("counts the drafts, and says nothing for none", () => {
        expect(draftsWaitWord(2)).toBe("2 drafts wait for you");
        expect(draftsWaitWord(1)).toBe("1 draft waits for you");
        expect(draftsWaitWord(0)).toBe("");
    });
});

describe("queuedLine", () => {
    const holder = (extra: Partial<Council> = {}) => council({ id: "room", feature: "room", ...extra });

    it("is Queued while the council it waits on is not known", () => {
        expect(queuedLine(undefined)).toBe("Queued");
        expect(queuedLine(null)).toBe("Queued");
    });

    it("names the council that runs", () => {
        expect(queuedLine(holder({ feature: "  Rail apps " }))).toBe("Queued · after Rail apps");
        expect(queuedLine(holder({ feature: " " }))).toBe(`Queued · after ${UNTITLED_COUNCIL}`);
        expect(queuedLine(holder({ activity: { ux: { text: "Reading pkg/services" } } }))).toBe("Queued · after room");
    });

    it("names the agent the running council waits on", () => {
        const waiting = holder({
            activity: {
                "agent-t1": { text: "Waiting for Witness synthesis to finish its task" },
                ux: { text: "Replying to UX on P2", proposalid: "P2" },
            },
        });
        expect(queuedLine(waiting)).toBe("Queued · after room · waiting for Witness synthesis");
    });

    it("names every agent it waits on once", () => {
        const two = holder({
            activity: {
                a: { text: "Waiting for Witness synthesis to finish its task" },
                b: { text: "Waiting for UX audit to finish its task" },
                c: { text: "Waiting for UX audit to finish its task" },
            },
        });
        expect(queuedLine(two)).toBe("Queued · after room · waiting for Witness synthesis and UX audit");
        const three = holder({
            activity: {
                a: { text: "Waiting for A to finish its task" },
                b: { text: "Waiting for B to finish its task" },
                c: { text: "Waiting for C to finish its task" },
            },
        });
        expect(queuedLine(three)).toBe("Queued · after room · waiting for A, B and C");
    });

    it("names no agent once the council no longer runs", () => {
        const idle = holder({
            state: "awaiting-you",
            activity: { a: { text: "Waiting for Witness synthesis to finish its task" } },
        });
        expect(queuedLine(idle)).toBe("Queued · after room");
    });
});

describe("summaryChip and costLine", () => {
    const started = 1_000_000;

    it("sums up a done council", () => {
        const c = council({
            state: "done",
            round: 3,
            tokens: 860_000,
            started,
            updated: started + 40 * MIN,
            summary: { text: "", directions: [], outcomes: {}, at: started + 11 * MIN },
        });
        expect(summaryChip(c, started + 99 * MIN)).toBe("Done · 4 experts · 11 min · 0.86M tokens");
    });

    it("times a running council to now and a finished one to its summary or last save", () => {
        const running = council({
            started,
            tokens: 550_000,
            replies: Array.from({ length: 19 }, (_, i) => reply(`r${i}`, "ram")),
        });
        expect(costLine(running, started + 7 * MIN + 20_000)).toBe("7:20 · 19 replies · 0.55M tokens");
        const stopped = council({ state: "stopped", started, updated: started + 3 * MIN, tokens: 0 });
        expect(costLine(stopped, started + 90 * MIN)).toBe("3:00 · 0 replies · 0 tokens");
        expect(summaryChip(stopped, started + 90 * MIN)).toBe("Stopped · 4 experts · 3 min · 0 tokens");
    });

    it("runs past the hour, and leaves the time out of a council that never started", () => {
        const long = council({ started, tokens: 1_000, replies: [reply("r1", "ram")] });
        expect(costLine(long, started + 61 * MIN + 5_000)).toBe("1:01:05 · 1 reply · 1k tokens");
        const notRun = council({ state: "not-run", round: 0 });
        expect(costLine(notRun, started)).toBe("0 replies · 0 tokens");
        expect(summaryChip(notRun, started)).toBe("Not run · 4 experts · 0 tokens");
    });
});

describe("expertStat", () => {
    it("words an expert's time and tokens", () => {
        const c = council({
            stats: {
                ux: { ms: 112_000, tokens: 84_000, calls: 1 },
                ram: { ms: 52_000, tokens: 700, calls: 1 },
                nu: { ms: 120_000, tokens: 310_000, calls: 2 },
            },
        });
        expect(expertStat(c, "ux")).toBe("1 min 52 s · 84k tokens");
        expect(expertStat(c, "ram")).toBe("52 s · 700 tokens");
        expect(expertStat(c, "nu")).toBe("2 min · 0.31M tokens");
        expect(expertStat(c, "sk")).toBe("");
    });
});

describe("callSegments", () => {
    it("has one segment per call of the whole council", () => {
        expect(callSegments(council({ state: "not-run", round: 0 }))).toEqual(Array(9).fill("pending"));
        const two = council({ experts: experts.slice(0, 2).concat(experts[4]) });
        expect(callSegments(two)).toHaveLength(5);
    });

    it("has one more call per seat for each round the council has", () => {
        expect(callSegments(council({ rounds: 3, state: "not-run", round: 0 }))).toHaveLength(13);
        expect(callSegments(council({ rounds: 1, state: "not-run", round: 0 }))).toHaveLength(5);
        const seated = council({ experts: [agentOf("t1", "Witness synthesis"), ...experts] });
        expect(callSegments(seated)).toHaveLength(11);
    });

    it("runs done, running, then waiting", () => {
        const c = council({
            round: 1,
            calls: 2,
            activity: { ram: { text: "Grep" }, sk: { text: "Read" } },
        });
        expect(callSegments(c)).toEqual([
            "done",
            "done",
            "running",
            "running",
            "pending",
            "pending",
            "pending",
            "pending",
            "pending",
        ]);
    });

    it("shows a failed call between the done ones and the rest", () => {
        const c = council({
            state: "failed",
            round: 3,
            calls: 6,
            failed: { coordinator: { round: 3, error: "bad json" } },
        });
        expect(callSegments(c)).toEqual([
            "done",
            "done",
            "done",
            "done",
            "done",
            "done",
            "failed",
            "pending",
            "pending",
        ]);
    });

    it("keeps what a stopped council did not reach waiting, and shows nothing running", () => {
        const c = council({ state: "stopped", round: 2, calls: 4, activity: { ux: { text: "x" } } });
        expect(callSegments(c)).toEqual([
            "done",
            "done",
            "done",
            "done",
            "pending",
            "pending",
            "pending",
            "pending",
            "pending",
        ]);
    });

    it("counts the round 2 calls a failed expert skipped as done once the council is", () => {
        const c = council({
            state: "done",
            round: 3,
            calls: 7,
            failed: { sk: { round: 1, error: "timeout" } },
        });
        expect(callSegments(c)).toEqual(["done", "done", "done", "done", "done", "done", "done", "failed", "done"]);
    });

    it("never runs past the number of calls", () => {
        const c = council({ state: "done", round: 3, calls: 14 });
        expect(callSegments(c)).toEqual(Array(9).fill("done"));
    });
});

describe("outdatedCount and canSummarize", () => {
    it("counts the replies after the summary", () => {
        const c = council({
            summary: { text: "", directions: [], outcomes: {}, at: 100 },
            replies: [
                reply("r1", "ram", { ts: 90 }),
                reply("r2", "ram", { ts: 100 }),
                reply("r3", "you", { ts: 110 }),
                reply("r4", "ux", { ts: 120 }),
            ],
        });
        expect(outdatedCount(c)).toBe(2);
        expect(outdatedCount(council({ replies: [reply("r1", "ram")] }))).toBe(0);
    });

    // Runner.summarizeLocked: it refuses a council the runner is running, and accepts one at rest in any round
    it.each(["awaiting-you", "done", "stopped", "failed"] as const)(
        "lets Summarize through a %s council, in any round",
        (state) => {
            for (const round of [1, 2, 3]) {
                expect(canSummarize(council({ state, round }))).toBe(true);
            }
        }
    );

    it("lets Summarize through a council stopped at the pause or failed in round 1", () => {
        expect(canSummarize(council({ state: "stopped", round: 1 }))).toBe(true);
        expect(canSummarize(council({ state: "failed", round: 1 }))).toBe(true);
    });

    it("holds Summarize while the council runs, in any round: round 2 ends in a synthesis by itself", () => {
        for (const round of [1, 2, 3]) {
            expect(canSummarize(council({ state: "running", round }))).toBe(false);
        }
    });

    it("holds Summarize for a council that has not run", () => {
        expect(canSummarize(council({ state: "not-run", round: 0 }))).toBe(false);
    });

    it("holds Summarize with nothing to summarize", () => {
        expect(canSummarize(council({ state: "done", round: 3, proposals: [] }))).toBe(false);
        expect(canSummarize(council({ state: "failed", round: 3, proposals: undefined }))).toBe(false);
        expect(canSummarize(council({ state: "stopped", round: 1, proposals: [] }))).toBe(false);
        expect(canSummarize(council({ state: "awaiting-you", round: 1, proposals: [] }))).toBe(false);
    });
});

describe("summarizeHold", () => {
    it("says a running round 2 is summarized by itself when it ends", () => {
        expect(summarizeHold(council({ state: "running", round: 2 }))).toBe(
            "The summary comes by itself when the experts finish replying"
        );
    });

    it("keeps round 1's words, and says the others are still working", () => {
        expect(summarizeHold(council({ state: "running", round: 1 }))).toBe(
            "Summarize unlocks after the experts' first ideas"
        );
        expect(summarizeHold(council({ state: "running", round: 3 }))).toBe(
            "Summarize is on again when the council stops"
        );
    });

    it("follows the rounds the council has: every reply pass is summarized by itself, the summary's round is not", () => {
        const by = "The summary comes by itself when the experts finish replying";
        expect(summarizeHold(council({ rounds: 3, state: "running", round: 2 }))).toBe(by);
        expect(summarizeHold(council({ rounds: 3, state: "running", round: 3 }))).toBe(by);
        expect(summarizeHold(council({ rounds: 3, state: "running", round: 4 }))).toBe(
            "Summarize is on again when the council stops"
        );
        expect(summarizeHold(council({ rounds: 1, state: "running", round: 2 }))).toBe(
            "Summarize is on again when the council stops"
        );
    });

    it("says a council that has not run has not run, and one with no proposal has nothing to summarize", () => {
        expect(summarizeHold(council({ state: "not-run", round: 0, proposals: undefined }))).toBe(
            "This council has not run"
        );
        expect(summarizeHold(council({ state: "stopped", round: 1, proposals: [] }))).toBe(
            "There is no proposal to summarize"
        );
    });
});

describe("matrixRows", () => {
    const dir = (rank: number, from: string[]): CouncilDirection => ({
        rank,
        title: `direction ${rank}`,
        reasoning: "",
        from,
        stances: {},
        agreed: true,
    });
    const c = council({
        state: "done",
        round: 3,
        proposals: [
            prop("P1", "ux", { argument: "A sleeping app looks the same as a running one. More." }),
            prop("P2", "ux"),
            prop("P3", "ram"),
            prop("P4", "nu"),
            prop("P5", "sk"),
            prop("P6", "sk", { withdrawn: true }),
        ],
        replies: [
            reply("r1", "ram", {
                proposalid: "P1",
                stance: "accept",
                text: "The state is already in ServiceStatus.",
                ts: 1,
            }),
            reply("r2", "sk", { proposalid: "P1", stance: "oppose", text: "no", ts: 2 }),
            reply("r3", "sk", { proposalid: "P1", stance: "challenge", text: "A third dot state: name it.", ts: 3 }),
            reply("r4", "you", { proposalid: "P1", text: "hm", ts: 4 }),
        ],
        summary: {
            text: "",
            directions: [dir(1, ["P5"]), dir(2, ["P1"]), dir(3, ["P2", "P3"]), dir(4, ["P4"])],
            outcomes: {
                P5: "Direction 1",
                P1: "Direction 2",
                P2: "Merged into direction 3",
                P3: "Merged into direction 3",
                P4: "Direction 4",
                P6: "Withdrawn in round 2",
            },
            at: 50,
        },
    });

    it("lists the proposals by the direction they went into, the withdrawn last", () => {
        expect(matrixRows(c).map((r) => r.proposal.id)).toEqual(["P5", "P1", "P2", "P3", "P4", "P6"]);
    });

    it("gives each proposal a cell per expert and its outcome", () => {
        const p1 = matrixRows(c).find((r) => r.proposal.id === "P1")!;
        expect(p1.cells.map((x) => [x.expert.id, x.stance, x.reason])).toEqual([
            ["ux", "proposed", "A sleeping app looks the same as a running one."],
            ["ram", "accept", "The state is already in ServiceStatus."],
            ["nu", "", ""],
            ["sk", "challenge", "A third dot state: name it."],
        ]);
        expect(p1.outcome).toBe("Direction 2");
        expect(matrixRows(c).find((r) => r.proposal.id === "P6")!.outcome).toBe("Withdrawn in round 2");
    });

    it("says what became of a proposal the summary left out", () => {
        const gap = council({
            proposals: [prop("P1", "ux", { cut: true }), prop("P2", "ram", { withdrawn: true }), prop("P3", "nu")],
            summary: { text: "", directions: [], outcomes: {}, at: 1 },
        });
        expect(matrixRows(gap).map((r) => r.outcome)).toEqual(["Cut at the pause", "Withdrawn", ""]);
    });

    it("has no rows without a summary", () => {
        expect(matrixRows(council())).toEqual([]);
    });
});

describe("draftFromCouncil and emptyCouncilDraft", () => {
    it("carries a council into the draft Run again opens", () => {
        const c = council({
            feature: "Rail apps",
            question: "Keep one awake?",
            files: ["pkg/services"],
            screenshots: ["C:\\shots\\a.png"],
            group: "ui",
            pauseafterround1: true,
            sessionid: "s1",
        });
        const d = draftFromCouncil(c);
        expect(d).toEqual({
            project: "D:\\code\\arc",
            feature: "Rail apps",
            question: "Keep one awake?",
            files: ["pkg/services"],
            screenshots: ["C:\\shots\\a.png"],
            group: "ui",
            experts,
            agents: [],
            rounds: 2,
            pause: true,
            sessionId: "s1",
            suggestState: "idle",
            groupPicked: true,
            mode: "review",
            modePicked: true,
        });
        expect(d.experts).not.toBe(c.experts);
        expect(d.files).not.toBe(c.files);
    });

    it("seats a council's agents apart from its role experts, in the council's project, with its rounds", () => {
        const witness = agentOf("t1", "Witness synthesis");
        const audit = agentOf("t2", "UX audit", { harness: "pi", context: 210_000 });
        const d = draftFromCouncil(council({ rounds: 3, experts: [witness, audit, ...experts] }));
        expect(d.experts).toEqual(experts);
        expect(d.agents).toEqual([
            { seat: witness, project: "D:\\code\\arc" },
            { seat: audit, project: "D:\\code\\arc" },
        ]);
        expect(d.agents[0].seat).not.toBe(witness);
        expect(d.rounds).toBe(3);
        expect(draftFromCouncil(council({ rounds: 0 })).rounds).toBe(2);
    });

    it("takes the council's mode, and reads a council with none as Review", () => {
        expect(draftFromCouncil(council({ mode: "brainstorm" })).mode).toBe("brainstorm");
        expect(draftFromCouncil(council({ mode: "brainstorm" })).modePicked).toBe(true);
        expect(draftFromCouncil(council({ mode: "review" })).mode).toBe("review");
        expect(draftFromCouncil(council()).mode).toBe("review");
        expect(draftFromCouncil(council()).modePicked).toBe(true);
    });

    it("fills what an old council leaves out", () => {
        const d = draftFromCouncil(council());
        expect(d.question).toBe("");
        expect(d.files).toEqual([]);
        expect(d.screenshots).toEqual([]);
        expect(d.group).toBe("");
        expect(d.pause).toBe(false);
        expect(d.sessionId).toBeUndefined();
    });

    it("starts empty for a project", () => {
        expect(emptyCouncilDraft("D:\\code\\arc")).toEqual({
            project: "D:\\code\\arc",
            feature: "",
            question: "",
            files: [],
            screenshots: [],
            group: "",
            experts: [],
            agents: [],
            rounds: 2,
            pause: false,
            suggestState: "idle",
            groupPicked: false,
            mode: "review",
            modePicked: false,
        });
    });
});

describe("agentSeat and draftWithAgents", () => {
    const witness = {
        id: "tab-1",
        name: "Witness synthesis",
        project: "D:\\code\\council-fixture",
        harness: "claude",
        context: 625_000,
    };
    const audit = { id: "tab-2", name: "UX audit", project: "D:\\code\\other", harness: "pi", context: 210_000 };

    it("seats an agent under an id of its own, naming its tab, harness and context", () => {
        expect(agentSeat(witness)).toEqual({
            id: "agent-tab-1",
            name: "Witness synthesis",
            brief: "",
            model: "",
            agent: "tab-1",
            harness: "claude",
            context: 625_000,
        });
        expect(isAgentSeat(agentSeat(audit))).toBe(true);
    });

    it("builds a draft with the agents seated and the first one's project as the council's", () => {
        const d = draftWithAgents([witness, audit]);
        expect(d.project).toBe("D:\\code\\council-fixture");
        expect(d.agents).toEqual([
            { seat: agentSeat(witness), project: "D:\\code\\council-fixture" },
            { seat: agentSeat(audit), project: "D:\\code\\other" },
        ]);
        expect(d.experts).toEqual([]);
        expect(d.rounds).toBe(2);
        expect(d).toEqual({ ...emptyCouncilDraft("D:\\code\\council-fixture"), agents: d.agents });
    });

    it("keeps each agent's own project when they come from two projects, whichever is first", () => {
        expect(draftWithAgents([audit, witness]).project).toBe("D:\\code\\other");
        expect(draftWithAgents([audit, witness]).agents.map((a) => a.project)).toEqual([
            "D:\\code\\other",
            "D:\\code\\council-fixture",
        ]);
    });

    it("takes one agent too, and refuses none", () => {
        expect(draftWithAgents([audit]).agents).toHaveLength(1);
        expect(() => draftWithAgents([])).toThrow("at least one agent");
    });
});

describe("councilProjectName", () => {
    it("names the registered project whose root is the council's path, however it is spelled", () => {
        const registry = { arc: { path: "D:\\code\\Arc" }, loom: { path: "/home/u/loom" }, bare: {} };
        expect(councilProjectName(registry, "d:/code/arc/")).toBe("arc");
        expect(councilProjectName(registry, "/home/u/loom")).toBe("loom");
        expect(councilProjectName(registry, "/elsewhere")).toBeNull();
        expect(councilProjectName(null, "/home/u/loom")).toBeNull();
    });
});

describe("canRemoveCouncil", () => {
    it("is true only for a council nothing works on", () => {
        const states: Council["state"][] = [
            "running",
            "awaiting-you",
            "queued",
            "done",
            "failed",
            "stopped",
            "not-run",
        ];
        expect(states.filter((state) => canRemoveCouncil({ state }))).toEqual(["done", "failed", "stopped", "not-run"]);
    });
});

describe("councilProjectKey", () => {
    it("reads two spellings of one project as one", () => {
        expect(councilProjectKey("D:\\Code\\Arc\\")).toBe(councilProjectKey("d:/code/arc"));
        expect(councilProjectKey("/Users/me/Arc/")).toBe("/Users/me/Arc");
        expect(councilProjectKey("")).toBe("");
    });
});
