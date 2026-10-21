import { describe, expect, it } from "vitest";
import {
    answerers,
    callSegments,
    canSummarize,
    costLine,
    councilProjectKey,
    countTokens,
    draftFromCouncil,
    emptyCouncilDraft,
    estimateLabel,
    estimateTokens,
    expertStat,
    flattenThread,
    followupLabel,
    headerChip,
    latestStances,
    matrixRows,
    outdatedCount,
    panel,
    rankedProposals,
    replyLabel,
    score,
    summarizeHold,
    summaryChip,
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
        expect(replyLabel(council({ round: 1 }), mine({ round: 1 }))).toBe("Queued for round 2");
        expect(replyLabel(council({ round: 1, state: "awaiting-you" }), mine({ round: 1 }))).toBe("Queued for round 2");
        expect(replyLabel(council({ round: 2, state: "awaiting-you" }), mine({ round: 2 }))).toBe("Queued for round 2");
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
    it("counts the experts whose round 1 call is over, a failed one included", () => {
        const c = council({
            round: 1,
            stats: {
                ux: { ms: 1, tokens: 1, calls: 1 },
                nu: { ms: 1, tokens: 1, calls: 1 },
                ram: { ms: 9, tokens: 0, calls: 0 },
            },
            activity: { ram: { text: "Grep" }, sk: { text: "Read" } },
        });
        expect(headerChip(c)).toBe("Round 1 of 3 · 2 of 4 experts done");
        const failed = council({
            ...c,
            stats: { ux: { ms: 1, tokens: 1, calls: 1 } },
            failed: { sk: { round: 1, error: "timeout" } },
        });
        expect(headerChip(failed)).toBe("Round 1 of 3 · 2 of 4 experts done");
    });

    it("counts the experts replying in round 2, not the coordinator", () => {
        const c = council({
            activity: {
                ram: { text: "Replying to UX on P2", proposalid: "P2" },
                sk: { text: "Replying to UX on P2", proposalid: "P2" },
                coordinator: { text: "Waiting" },
            },
        });
        expect(headerChip(c)).toBe("Round 2 of 3 · 2 replying");
        expect(headerChip(council())).toBe("Round 2 of 3");
    });

    it("words the last round and a follow-up", () => {
        expect(headerChip(council({ round: 3 }))).toBe("Round 3 of 3 · summarizing");
        expect(headerChip(council({ round: 3, activity: { ux: { text: "Answering" } } }))).toBe(
            "Round 3 of 3 · 1 answering"
        );
        expect(headerChip(council({ round: 4, activity: { ux: { text: "a" }, ram: { text: "b" } } }))).toBe(
            "Follow-up · 2 answering"
        );
    });

    it("words every other state", () => {
        expect(headerChip(council({ state: "awaiting-you", round: 1 }))).toBe("Waiting on you");
        expect(headerChip(council({ state: "done", round: 3 }))).toBe("Done");
        expect(headerChip(council({ state: "not-run", round: 0 }))).toBe("Not run");
        expect(headerChip(council({ state: "stopped" }))).toBe("Stopped");
        expect(headerChip(council({ state: "failed", round: 3 }))).toBe("Failed");
    });

    it("gives the tree row its word and tone", () => {
        expect(treeMeta(council({ round: 2 }))).toEqual({ text: "Round 2", tone: "working" });
        expect(treeMeta(council({ round: 3 }))).toEqual({ text: "Round 3", tone: "working" });
        expect(treeMeta(council({ round: 4 }))).toEqual({ text: "Answering", tone: "working" });
        expect(treeMeta(council({ state: "awaiting-you" }))).toEqual({ text: "Waiting on you", tone: "asking" });
        expect(treeMeta(council({ state: "done" }))).toEqual({ text: "Done", tone: "muted" });
        expect(treeMeta(council({ state: "not-run" }))).toEqual({ text: "Not run", tone: "muted" });
        expect(treeMeta(council({ state: "stopped" }))).toEqual({ text: "Stopped", tone: "muted" });
        expect(treeMeta(council({ state: "failed" }))).toEqual({ text: "Failed", tone: "error" });
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
        expect(summaryChip(c, started + 99 * MIN)).toBe("Done · 4 experts · 3 rounds · 11 min · 0.86M tokens");
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
        expect(summaryChip(stopped, started + 90 * MIN)).toBe("Stopped · 4 experts · 2 rounds · 3 min · 0 tokens");
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
            "The summary comes by itself when round 2 ends"
        );
    });

    it("keeps round 1's words, and says the others are still working", () => {
        expect(summarizeHold(council({ state: "running", round: 1 }))).toBe("Summarize unlocks after round 1");
        expect(summarizeHold(council({ state: "running", round: 3 }))).toBe(
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
        expect(matrixRows(gap).map((r) => r.outcome)).toEqual(["Cut at the pause", "Withdrawn in round 2", ""]);
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
            pause: true,
            sessionId: "s1",
            suggestState: "idle",
            groupPicked: true,
        });
        expect(d.experts).not.toBe(c.experts);
        expect(d.files).not.toBe(c.files);
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
            pause: false,
            suggestState: "idle",
            groupPicked: false,
        });
    });
});

describe("councilProjectKey", () => {
    it("reads two spellings of one project as one", () => {
        expect(councilProjectKey("D:\\Code\\Arc\\")).toBe(councilProjectKey("d:/code/arc"));
        expect(councilProjectKey("/Users/me/Arc/")).toBe("/Users/me/Arc");
        expect(councilProjectKey("")).toBe("");
    });
});
