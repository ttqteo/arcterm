import { describe, expect, it } from "vitest";
import {
    STANCE_WORD,
    UNTITLED_COUNCIL,
    agentSeat,
    answerers,
    askedParts,
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
    fileMentions,
    firstFollowRound,
    flattenThread,
    followupLabel,
    hasAgents,
    headerChip,
    heldDrafts,
    isAgentSeat,
    isMentionablePath,
    isSent,
    latestStances,
    matrixRows,
    mentionsChat,
    nextThumb,
    outdatedCount,
    panel,
    pickCount,
    proseOf,
    queuedLine,
    rankedProposals,
    readableReplies,
    replyLabel,
    roundsOf,
    score,
    sentProposals,
    sentReplies,
    summarizeHold,
    summaryFacts,
    synthesisRound,
    threadTree,
    thumbOf,
    treeMeta,
    withThumb,
    type SeatableAgent,
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

// live chats: tab ids are UUIDs, whose 9th character is a `-`
describe("answerers: live chats by their mention key", () => {
    const SEATED = "5b7c1d90-4e2a-4f6b-9a31-0c8d2e7f6a15";
    const NEAR_A = "3e19c0d2-a1c4-4b7e-9d20-5f8a6c3e1b07";
    const NEAR_B = "3e19c0d2-b7e0-4a91-8c3d-2e6f1a9b5d08";
    const FAR = "82faafca-3b1c-4d0e-8a57-9c1e6f0d2b44";
    const seatable = (id: string, name: string): SeatableAgent => ({
        id,
        name,
        project: "D:\\code\\arc",
        harness: "pi",
        context: 48_000,
    });
    const far = seatable(FAR, "Design review");
    const ids = (list: CouncilExpert[]) => list.map((e) => e.id);
    const withChats = (...tabs: [string, string][]) =>
        council({
            experts: [...experts.slice(0, 4), ...tabs.map(([tab, name]) => agentOf(tab, name)), experts[4]],
        });
    const one = withChats([SEATED, "Witness synthesis"]);
    const twins = withChats([NEAR_A, "Perf notes"], [NEAR_B, "Perf notes"]);

    it("reaches a chat seat by @ and a whole word of 8 characters or more that starts its tab id", () => {
        expect(ids(answerers(one, "", "", "@5b7c1d90 why?"))).toEqual([`agent-${SEATED}`]);
        expect(ids(answerers(one, "", "", "@5B7C1D90, why?"))).toEqual([`agent-${SEATED}`]);
        expect(ids(answerers(one, "", "", "@5b7c1d90-4e2a why?"))).toEqual([`agent-${SEATED}`]);
        expect(ids(answerers(one, "", "", `@${SEATED}`))).toEqual([`agent-${SEATED}`]);
        expect(ids(answerers(one, "P2", "r1", "@RAM and @5b7c1d90"))).toEqual(["ram", `agent-${SEATED}`]);
    });

    it("does not read a short word, a word that is not its start, a longer word or an address", () => {
        const everyone = ["ux", "ram", "nu", "sk", `agent-${SEATED}`];
        expect(ids(answerers(one, "", "", "@5b7c1d9 why?"))).toEqual(everyone);
        expect(ids(answerers(one, "", "", "@b7c1d90f why?"))).toEqual(everyone);
        expect(ids(answerers(one, "", "", "@5b7c1d90x why?"))).toEqual(everyone);
        expect(ids(answerers(one, "", "", "mail a@5b7c1d90"))).toEqual(everyone);
    });

    it("keeps two chats whose tab ids share their first 8 characters apart", () => {
        expect(ids(answerers(twins, "", "", "@3e19c0d2-a what do you think?"))).toEqual([`agent-${NEAR_A}`]);
        expect(ids(answerers(twins, "", "", "@3e19c0d2-b, and you?"))).toEqual([`agent-${NEAR_B}`]);
        expect(ids(answerers(twins, "", "", `@${NEAR_A} @${NEAR_B}`))).toEqual([`agent-${NEAR_A}`, `agent-${NEAR_B}`]);
    });

    it("reads a word both chats start with as no mention", () => {
        const everyone = ["ux", "ram", "nu", "sk", `agent-${NEAR_A}`, `agent-${NEAR_B}`];
        expect(ids(answerers(twins, "", "", "@3e19c0d2 which of you?"))).toEqual(everyone);
        expect(ids(answerers(twins, "", "", "@3e19c0d2- which of you?"))).toEqual(everyone);
    });

    it("counts the chats a message adds as named, after the seats", () => {
        expect(answerers(council(), "", "", "@82faafca", [far])).toEqual([agentSeat(far)]);
        expect(ids(answerers(council(), "", "", "@RAM and @82faafca", [far]))).toEqual(["ram", `agent-${FAR}`]);
        expect(ids(answerers(council(), "P2", "r1", "@82faafca", [far]))).toEqual([`agent-${FAR}`]);
        expect(ids(answerers(one, "", "", "@82faafca and @5b7c1d90", [far]))).toEqual([
            `agent-${SEATED}`,
            `agent-${FAR}`,
        ]);
    });

    it("builds the seat of a joining chat as wavesrv does", () => {
        const [seat] = answerers(council(), "", "", "@82faafca", [far]);
        expect(seat).toEqual({
            id: `agent-${FAR}`,
            name: "Design review",
            brief: "",
            model: "",
            agent: FAR,
            harness: "pi",
            context: 48_000,
        });
        expect(isAgentSeat(seat)).toBe(true);
    });

    it("names two joining chats in the order given, and a chat that is a seat once", () => {
        const other = seatable("c0ffee00-1111-4222-8333-444455556666", "Other");
        expect(ids(answerers(council(), "", "", "@c0ffee00 @82faafca", [far, other]))).toEqual([
            `agent-${FAR}`,
            `agent-${other.id}`,
        ]);
        expect(ids(answerers(one, "", "", "@5b7c1d90", [seatable(SEATED, "Witness synthesis")]))).toEqual([
            `agent-${SEATED}`,
        ]);
    });

    it("counts a joining chat's tab id when it asks whether a prefix is one seat's", () => {
        const sibling = seatable("3e19c0d2-a9ff-4000-8000-000000000001", "Sibling");
        const c = withChats([NEAR_A, "Perf notes"]);
        expect(ids(answerers(c, "", "", "@3e19c0d2-a"))).toEqual([`agent-${NEAR_A}`]);
        // once the sibling is seated too, that prefix is no longer the one seat's: only the joining chat is named
        expect(ids(answerers(c, "", "", "@3e19c0d2-a", [sibling]))).toEqual([`agent-${sibling.id}`]);
        expect(ids(answerers(c, "", "", "@3e19c0d2-a1", [sibling]))).toEqual([
            `agent-${NEAR_A}`,
            `agent-${sibling.id}`,
        ]);
    });
});

// the one example table the Go tests (pkg/council) read too: what an `@…` is, a file or a name
const TWIN_A = "3e19c0d2-a1c4-4b7e-9d20-5f8a6c3e1b07";
const TWIN_B = "3e19c0d2-b7e0-4a91-8c3d-2e6f1a9b5d08";
const FILE_TABLE: { text: string; file: string; names: "" | "ux" | "ram" | "chat" }[] = [
    { text: "@ux/plan.md", file: "ux/plan.md", names: "" },
    { text: "@ram.go", file: "ram.go", names: "" },
    { text: "@./x", file: "./x", names: "" },
    { text: "@~/x", file: "~/x", names: "" },
    { text: "@3e19c0d2-a/x.ts", file: "3e19c0d2-a/x.ts", names: "" },
    { text: "@UX", file: "", names: "ux" },
    { text: "@UX.", file: "", names: "ux" },
    { text: "@UX..", file: "", names: "ux" },
    { text: "@UX,", file: "", names: "ux" },
    { text: "@3e19c0d2-a", file: "", names: "chat" },
];

describe("fileMentions: an @ that names a file", () => {
    it.each(FILE_TABLE)("$text is the file `$file` (or none)", ({ text, file }) => {
        expect(fileMentions(text).map((m) => m.path)).toEqual(file === "" ? [] : [file]);
    });

    it("says where each one sits, the @ included, the path without it", () => {
        expect(fileMentions("see @ux/plan.md now")).toEqual([{ start: 4, end: 15, path: "ux/plan.md" }]);
        expect(fileMentions("@a.ts and @b/c.go")).toEqual([
            { start: 0, end: 5, path: "a.ts" },
            { start: 10, end: 17, path: "b/c.go" },
        ]);
    });

    it("leaves the dots that end a sentence out of the path", () => {
        expect(fileMentions("read @src/a.ts.")).toEqual([{ start: 5, end: 14, path: "src/a.ts" }]);
        expect(fileMentions("read @src/a.ts..")).toEqual([{ start: 5, end: 14, path: "src/a.ts" }]);
        expect(fileMentions("read @src/a.ts, then @b.md.")).toMatchObject([{ path: "src/a.ts" }, { path: "b.md" }]);
    });

    it("stops the path at whatever is not a path character", () => {
        expect(fileMentions("(@src/a.ts)")).toEqual([{ start: 1, end: 10, path: "src/a.ts" }]);
        expect(fileMentions('"@a.ts"')).toEqual([{ start: 1, end: 6, path: "a.ts" }]);
        expect(fileMentions("@a.ts:12")).toEqual([{ start: 0, end: 5, path: "a.ts" }]);
        // a space ends the path: what follows is no part of it
        expect(fileMentions("@src/my file.ts")).toEqual([{ start: 0, end: 7, path: "src/my" }]);
        const path = "trước/kế-hoạch.md";
        expect(fileMentions(`@${path}`)).toEqual([{ start: 0, end: 1 + path.length, path }]);
    });

    it("does not read an address, or an @ inside a word, as one", () => {
        expect(fileMentions("mail a@ram.com")).toEqual([]);
        expect(fileMentions("é@x.io and 3@a.b and _@c.d")).toEqual([]);
        expect(fileMentions("@@a.ts")).toEqual([{ start: 1, end: 6, path: "a.ts" }]);
        expect(fileMentions("@a/b@c/d")).toEqual([{ start: 0, end: 4, path: "a/b" }]);
    });

    it("reads an @ that follows a path's own dot or slash as a new one", () => {
        expect(fileMentions("@a/b.@c/d")).toEqual([
            { start: 0, end: 4, path: "a/b" },
            { start: 5, end: 9, path: "c/d" },
        ]);
    });

    it("is empty for a bare @, a lone dot run and no text", () => {
        expect(fileMentions("")).toEqual([]);
        expect(fileMentions("@")).toEqual([]);
        expect(fileMentions("@.. @...")).toEqual([]);
        expect(fileMentions("@-")).toEqual([]);
    });

    it("reads a path from `isMentionablePath` the way it reads the whole mention", () => {
        const paths = [
            "a/b.ts",
            "x.md",
            "./x",
            "~/x",
            "src/trước.md",
            "a/b/",
            "Makefile",
            "app/[id]/p.tsx",
            "a b.ts",
            "a.",
        ];
        for (const path of paths) {
            expect(isMentionablePath(path)).toBe(fileMentions(`@${path}`).some((m) => m.path === path));
        }
        expect(isMentionablePath("a/b.ts")).toBe(true);
        expect(isMentionablePath("Makefile")).toBe(false);
        expect(isMentionablePath("app/[id]/p.tsx")).toBe(false);
    });
});

describe("a file mention names no seat and no chat", () => {
    const c = council();
    const ids = (list: CouncilExpert[]) => list.map((e) => e.id);
    const everyone = ["ux", "ram", "nu", "sk"];
    const withTwins = council({
        experts: [...experts.slice(0, 4), agentOf(TWIN_A, "Perf notes"), agentOf(TWIN_B, "Perf notes"), experts[4]],
    });

    it.each(FILE_TABLE.filter((row) => row.names !== "chat"))("$text reaches the seat it names, if any", (row) => {
        expect(ids(answerers(c, "", "", row.text))).toEqual(row.names === "" ? everyone : [row.names]);
    });

    it.each(FILE_TABLE.filter((row) => row.names === "chat" || row.file.startsWith("3e19")))(
        "$text reaches the chat it names, if any",
        (row) => {
            const got = ids(answerers(withTwins, "", "", row.text));
            expect(got).toEqual(
                row.names === "chat" ? [`agent-${TWIN_A}`] : [...everyone, `agent-${TWIN_A}`, `agent-${TWIN_B}`]
            );
        }
    );

    it.each(FILE_TABLE)("$text: mentionsChat says the same", (row) => {
        expect(mentionsChat(row.text, TWIN_A, [TWIN_A, TWIN_B])).toBe(row.names === "chat");
    });

    it("keeps a seat's own mention beside a file mention", () => {
        expect(ids(answerers(c, "", "", "@RAM read @ux/plan.md and @src/a.ts"))).toEqual(["ram"]);
        expect(ids(answerers(c, "", "", "@ux/plan.md and @RAM"))).toEqual(["ram"]);
        expect(ids(answerers(withTwins, "", "", "@3e19c0d2-a read @3e19c0d2-b/x.ts"))).toEqual([`agent-${TWIN_A}`]);
    });

    it("reads an @ that sits right after a file mention's end as a word of its own", () => {
        expect(ids(answerers(c, "", "", "@a/b.@RAM"))).toEqual(["ram"]);
        expect(ids(answerers(c, "", "", "@a/b@RAM"))).toEqual(everyone);
    });

    it("falls back to the thread's path when only files are named", () => {
        const thread = council({ replies: [reply("r1", "sk", { ts: 1 })] });
        expect(ids(answerers(thread, "P2", "r1", "@ux/plan.md"))).toEqual(["ux", "sk"]);
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
        expect(followupLabel(code, 2, true)).toBe("2 experts answer, reading files · ≈ 2 calls · ~0.2M tokens");
        expect(followupLabel({ calls: 1, tokens: 20_000, minutes: 1 }, 1, false)).toBe(
            "1 expert answers · ≈ 1 call · ~20k tokens"
        );
    });

    it("names the experts alone while the estimate is not in", () => {
        expect(followupLabel(null, 3, false)).toBe("3 experts answer");
        expect(followupLabel(null, 1, true)).toBe("1 expert answers, reading files");
        expect(followupLabel(null, 0, false)).toBe("");
    });

    it("counts the chats beside the experts, and words the verb for the whole", () => {
        expect(followupLabel(null, 1, false, 1)).toBe("1 expert and 1 chat answer");
        expect(followupLabel(null, 2, false, 3)).toBe("2 experts and 3 chats answer");
        expect(followupLabel(null, 2, false, 0)).toBe("2 experts answer");
        expect(followupLabel(null, 1, false, 0)).toBe("1 expert answers");
        expect(followupLabel(null, 0, false, 1)).toBe("1 chat answers");
        expect(followupLabel(null, 0, false, 2)).toBe("2 chats answer");
        expect(followupLabel(null, 0, false, 0)).toBe("");
    });

    it("keeps the files and the estimate after the chats", () => {
        const est = { calls: 3, tokens: 84_000, minutes: 2 };
        expect(followupLabel(est, 1, false, 1)).toBe("1 expert and 1 chat answer · ≈ 3 calls · ~84k tokens");
        expect(followupLabel(est, 2, true, 1)).toBe(
            "2 experts and 1 chat answer, reading files · ≈ 3 calls · ~84k tokens"
        );
        expect(followupLabel(est, 0, true, 2)).toBe("2 chats answer, reading files · ≈ 3 calls · ~84k tokens");
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

// a council whose seats' answers were held: every figure below reads the sent items only, as the Go synthesis does
describe("held and dropped items count for nothing", () => {
    const withDrafts = (extra: Partial<Council> = {}) =>
        council({
            state: "done",
            round: 3,
            started: 1_000,
            tokens: 0,
            proposals: [
                prop("P1", "ux", { ts: 1 }),
                prop("P2", "ram", { ts: 2 }),
                prop("P7", "nu", { ts: 3, draft: "held" }),
                prop("P8", "sk", { ts: 4, draft: "dropped" }),
            ],
            replies: [
                reply("r1", "ram", {
                    proposalid: "P1",
                    stance: "accept",
                    text: "The state is in ServiceStatus.",
                    ts: 10,
                }),
                reply("r2", "sk", { proposalid: "P1", stance: "challenge", text: "A third dot state?", ts: 11 }),
                reply("r3", "nu", { proposalid: "P1", stance: "accept", text: "Agreed, held.", ts: 12, draft: "held" }),
                reply("r4", "ram", {
                    proposalid: "P1",
                    stance: "oppose",
                    text: "No, dropped.",
                    ts: 13,
                    draft: "dropped",
                }),
                reply("r5", "ux", { proposalid: "P1", stance: "oppose", text: "No, held.", ts: 14, draft: "held" }),
                reply("r6", "you", { proposalid: "P1", text: "hm", ts: 15 }),
            ],
            ...extra,
        });

    it("tells a sent item from a held or a dropped one, as Go's Sent does", () => {
        expect(isSent({})).toBe(true);
        expect(isSent({ draft: "" })).toBe(true);
        expect(isSent({ draft: "held" })).toBe(false);
        expect(isSent({ draft: "dropped" })).toBe(false);
        expect(sentProposals(withDrafts()).map((p) => p.id)).toEqual(["P1", "P2"]);
        expect(sentReplies(withDrafts()).map((r) => r.id)).toEqual(["r1", "r2", "r6"]);
        expect(sentProposals({}).length).toBe(0);
        expect(sentReplies({}).length).toBe(0);
    });

    it("leaves a held and a dropped reply out of the readable replies", () => {
        expect(readableReplies(withDrafts()).map((r) => r.id)).toEqual(["r1", "r2", "r6"]);
    });

    it("takes no stance from a held or a dropped reply, and gives a held or a dropped idea no entry", () => {
        const stances = latestStances(withDrafts());
        expect(stances.P1).toEqual({ ux: "proposed", ram: "accept", sk: "challenge" });
        expect(Object.keys(stances)).toEqual(["P1", "P2"]);
    });

    it("scores from the sent replies only", () => {
        expect(score(withDrafts(), "P1")).toBe(1);
        expect(score(withDrafts(), "P7")).toBe(0);
        expect(score(withDrafts(), "P8")).toBe(0);
    });

    it("ranks the sent ideas, with only their sent replies counted", () => {
        const rows = rankedProposals(withDrafts());
        expect(rows.map((r) => r.proposal.id)).toEqual(["P1", "P2"]);
        expect(rows[0]).toMatchObject({ score: 1, replies: 3 });
    });

    it("leaves a held and a dropped reply out of the thread", () => {
        const ids = flattenThread(threadTree(withDrafts(), "P1")).map((n) => n.key);
        expect(ids).toEqual(["r1", "r2", "r6"]);
    });

    it("counts only the sent replies in the cost line", () => {
        expect(costLine(withDrafts({ state: "running" }), 1_000 + 60_000)).toBe("1:00 · 3 replies · 0 tokens");
    });

    it("counts only the replies sent after the summary as outdating it", () => {
        const c = withDrafts({ summary: { text: "", directions: [], outcomes: {}, at: 9 } });
        expect(outdatedCount(c)).toBe(3);
        expect(outdatedCount(withDrafts({ summary: { text: "", directions: [], outcomes: {}, at: 12 } }))).toBe(1);
    });

    it("gives the matrix no row for a held or a dropped idea and no reason from a held or a dropped reply", () => {
        const c = withDrafts({ summary: { text: "", directions: [], outcomes: {}, at: 50 } });
        const rows = matrixRows(c);
        expect(rows.map((r) => r.proposal.id)).toEqual(["P1", "P2"]);
        const p1 = rows[0];
        expect(p1.cells.map((x) => [x.expert.id, x.stance, x.reason])).toEqual([
            ["ux", "proposed", "argument P1"],
            ["ram", "accept", "The state is in ServiceStatus."],
            ["nu", "", ""],
            ["sk", "challenge", "A third dot state?"],
        ]);
    });

    it("reads a council that holds nothing as it did before", () => {
        const plain = council({ proposals: [prop("P1", "ux"), prop("P2", "ram")], replies: [reply("r1", "ram")] });
        expect(sentProposals(plain)).toEqual(plain.proposals);
        expect(sentReplies(plain)).toEqual(plain.replies);
        expect(readableReplies(plain)).toEqual(plain.replies);
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

describe("summaryFacts and costLine", () => {
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
        expect(summaryFacts(c, started + 99 * MIN)).toEqual({
            state: "Done",
            facts: "4 experts · 11 min · 0.86M tokens",
        });
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
        expect(summaryFacts(stopped, started + 90 * MIN)).toEqual({
            state: "Stopped",
            facts: "4 experts · 3 min · 0 tokens",
        });
    });

    it("runs past the hour, and leaves the time out of a council that never started", () => {
        const long = council({ started, tokens: 1_000, replies: [reply("r1", "ram")] });
        expect(costLine(long, started + 61 * MIN + 5_000)).toBe("1:01:05 · 1 reply · 1k tokens");
        const notRun = council({ state: "not-run", round: 0 });
        expect(costLine(notRun, started)).toBe("0 replies · 0 tokens");
        expect(summaryFacts(notRun, started)).toEqual({ state: "Not run", facts: "4 experts · 0 tokens" });
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

    // Runner.summarizeLocked refuses a council with no sent idea: a held draft and a dropped one reached no seat
    it("holds Summarize while every idea is a held or dropped draft", () => {
        const held = [prop("P1", "ux", { draft: "held" }), prop("P2", "ram", { draft: "held" })];
        for (const state of ["awaiting-you", "done", "stopped", "failed"] as const) {
            expect(canSummarize(council({ state, round: 2, proposals: held }))).toBe(false);
        }
        const dropped = [prop("P1", "ux", { draft: "dropped" }), prop("P2", "ram", { draft: "held" })];
        expect(canSummarize(council({ state: "awaiting-you", round: 2, proposals: dropped }))).toBe(false);
    });

    it("lets Summarize through with one sent idea among the drafts", () => {
        const mixed = [prop("P1", "ux", { draft: "held" }), prop("P2", "ram", { draft: "dropped" }), prop("P3", "sk")];
        expect(canSummarize(council({ state: "awaiting-you", round: 2, proposals: mixed }))).toBe(true);
        expect(canSummarize(council({ state: "done", round: 3, proposals: [prop("P1", "ux", { draft: "" })] }))).toBe(
            true
        );
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

    it("says to send or drop the drafts when every idea is a held draft", () => {
        const held = [prop("P1", "ux", { draft: "held" }), prop("P2", "ram", { draft: "held" })];
        expect(summarizeHold(council({ state: "awaiting-you", round: 2, proposals: held }))).toBe(
            "Send or drop the drafts first"
        );
        // a held draft among dropped ones still waits for the person
        const some = [prop("P1", "ux", { draft: "dropped" }), prop("P2", "ram", { draft: "held" })];
        expect(summarizeHold(council({ state: "awaiting-you", round: 2, proposals: some }))).toBe(
            "Send or drop the drafts first"
        );
    });

    it("says there is no proposal when the drafts are all dropped: nothing is left to send", () => {
        const dropped = [prop("P1", "ux", { draft: "dropped" })];
        expect(summarizeHold(council({ state: "awaiting-you", round: 2, proposals: dropped }))).toBe(
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

    it("keeps only the words of a message with a table, a diagram or a list, for a cell has no room for them", () => {
        const rich = council({
            state: "done",
            round: 3,
            proposals: [
                prop("P1", "ux", {
                    argument:
                        "I compare two checks:\n\n| | A | B |\n|---|---|---|\n| patch | yes | no |\n\nB covers more.",
                }),
            ],
            replies: [
                reply("r1", "ram", {
                    proposalid: "P1",
                    stance: "challenge",
                    text: "Two steps:\n\n1. Swap the value.\n2. Trace the sink.\n\n```mermaid\nflowchart LR\n  A --> B\n```",
                    ts: 1,
                }),
            ],
            summary: { text: "", directions: [dir(1, ["P1"])], outcomes: { P1: "Direction 1" }, at: 50 },
        });
        const cells = matrixRows(rich)[0].cells;
        expect(cells.find((x) => x.expert.id === "ux")!.reason).toBe("I compare two checks: B covers more.");
        expect(cells.find((x) => x.expert.id === "ram")!.reason).toBe("Two steps:\n\nSwap the value.\nTrace the sink.");
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

describe("askedParts", () => {
    it("splits the limits after Keep to: at semicolons, a closing period dropped", () => {
        expect(
            askedParts(
                "Which way next? Keep to: a side project, ~5-10h a week; no new dependency; npm first, PyPI later."
            )
        ).toEqual({
            question: "Which way next?",
            limits: ["a side project, ~5-10h a week", "no new dependency", "npm first, PyPI later"],
        });
    });

    it("is the whole question with no Keep to:, its line breaks kept, and empty with none", () => {
        expect(askedParts("  Which changes first?\nThe rail only.  ")).toEqual({
            question: "Which changes first?\nThe rail only.",
            limits: [],
        });
        expect(askedParts(undefined)).toEqual({ question: "", limits: [] });
        expect(askedParts("   ")).toEqual({ question: "", limits: [] });
    });

    it("keeps a question that is only limits whole, and drops empty limits", () => {
        expect(askedParts("Keep to: a; ; b.")).toEqual({ question: "Keep to: a; ; b.", limits: ["a", "b"] });
    });
});

describe("proseOf", () => {
    it("leaves plain words as they are", () => {
        expect(proseOf("One idea. Two lines\nhere.")).toBe("One idea. Two lines\nhere.");
    });

    it("drops a table, a fenced block and a list's markers", () => {
        expect(
            proseOf("Look:\n\n| a | b |\n|---|---|\n| 1 | 2 |\n\n```mermaid\nA --> B\n```\n\n- first\n2) second")
        ).toBe("Look:\n\nfirst\nsecond");
    });

    it("is empty for a message that is only a table", () => {
        expect(proseOf("| a |\n|---|\n| 1 |")).toBe("");
    });
});

describe("thumbs", () => {
    it("reads a known thumb and nothing else", () => {
        expect(thumbOf({ thumb: "like" })).toBe("like");
        expect(thumbOf({ thumb: "dislike" })).toBe("dislike");
        expect(thumbOf({})).toBe("");
        expect(thumbOf({ thumb: "love" })).toBe("");
    });

    it("a press puts the thumb on, swaps the other one, and a second press takes it back", () => {
        expect(nextThumb("", "like")).toBe("like");
        expect(nextThumb("dislike", "like")).toBe("like");
        expect(nextThumb("like", "like")).toBe("");
        expect(nextThumb("dislike", "dislike")).toBe("");
    });

    it("sets one idea's or reply's thumb and leaves the rest of the record alone", () => {
        const c = council({ replies: [reply("r1", "ram"), reply("r2", "sk", { thumb: "like" })] });
        const liked = withThumb(c, "P3", "like");
        expect(liked.proposals.find((p) => p.id === "P3")?.thumb).toBe("like");
        expect(liked.proposals.filter((p) => p.thumb != null)).toHaveLength(1);
        expect(liked.replies).toBe(c.replies);
        expect(c.proposals.find((p) => p.id === "P3")?.thumb).toBeUndefined();

        const off = withThumb(c, "r2", "");
        expect(off.replies.find((r) => r.id === "r2")?.thumb).toBeUndefined();
        expect(off.replies.find((r) => r.id === "r1")).toBe(c.replies[0]);
        expect(off.proposals).toBe(c.proposals);

        expect(withThumb(c, "P9", "like")).toBe(c);
    });
});
