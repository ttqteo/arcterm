import { describe, expect, it } from "vitest";
import {
    avatarStackLabel,
    avatarTone,
    callBarLabel,
    canContinue,
    coordinatorFailure,
    discussionBody,
    evidenceChip,
    expertCard,
    expertDoing,
    failedExperts,
    failedWhile,
    headerCost,
    initialOf,
    isFollowUp,
    isLit,
    isQueued,
    keptProposals,
    listNames,
    modeWord,
    reactions,
    retriedOut,
    segmentSummary,
    sinceStart,
    summarizeAction,
    toggleCut,
} from "./councildiscussionmodel";

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
    proposals: [prop("P1", "ux"), prop("P2", "ux"), prop("P3", "ram"), prop("P6", "sk", { withdrawn: true })],
    tokens: 0,
    calls: 0,
    created: 0,
    updated: 0,
    ...extra,
});

describe("avatarTone", () => {
    it("gives each expert of the panel its own slot, the coordinator and the person theirs", () => {
        const c = council();
        expect(["ux", "ram", "nu", "sk"].map((id) => avatarTone(c, id))).toEqual([
            "conn-1",
            "conn-2",
            "conn-3",
            "conn-6",
        ]);
        expect(avatarTone(c, "coordinator")).toBe("coordinator");
        expect(avatarTone(c, "you")).toBe("you");
        expect(avatarTone(c, "gone")).toBe("muted");
    });

    it("wraps around after the sixth expert", () => {
        const many = Array.from(
            { length: 7 },
            (_, i): CouncilExpert => ({ id: `e${i}`, name: `E${i}`, brief: "", model: "sonnet" })
        );
        const c = council({ experts: many });
        expect(avatarTone(c, "e6")).toBe(avatarTone(c, "e0"));
        expect(avatarTone(c, "e5")).toBe("conn-8");
    });
});

describe("initialOf", () => {
    it("is the first letter, upper case", () => {
        expect(initialOf("New user")).toBe("N");
        expect(initialOf("  ux")).toBe("U");
        expect(initialOf("Ánh")).toBe("Á");
        expect(initialOf("")).toBe("?");
    });
});

describe("isLit and expertDoing", () => {
    const running = council({
        activity: {
            ram: { text: "Replying on P4", proposalid: "P4" },
            sk: { text: "Replying to UX on P2", proposalid: "P2", parentid: "r19" },
        },
        replies: [reply("r1", "ux", { stance: "accept" }), reply("r2", "ux", { stance: "accept" })],
    });

    it("lights the experts writing while the council runs, and none when it does not", () => {
        expect(["ux", "ram", "nu", "sk", "coordinator"].map((id) => isLit(running, id))).toEqual([
            false,
            true,
            false,
            true,
            false,
        ]);
        expect(isLit({ ...running, state: "done" }, "ram")).toBe(false);
    });

    it("names the reply or the tool being used", () => {
        const e = (id: string) => running.experts.find((x) => x.id === id)!;
        expect(expertDoing(running, e("sk"))).toBe("Replying to UX on P2");
        expect(expertDoing(running, e("ram"))).toBe("Replying on P4");
    });

    it("says where a resting expert stands while the experts argue", () => {
        expect(expertDoing(running, running.experts[0])).toBe("Replied · 2 replies");
        expect(expertDoing(running, running.experts[2])).toBe("Replied");
        expect(expertDoing(running, running.experts[4])).toBe("Waits for the answer");
    });

    it("counts no reaction as a reply", () => {
        const c = council({
            replies: [reply("r1", "ux", { stance: "accept", text: "" }), reply("r2", "ux", { stance: "accept" })],
        });
        expect(expertDoing(c, c.experts[0])).toBe("Replied · 1 reply");
    });

    it("says where an expert stands while the experts first propose", () => {
        const c = council({ round: 1, stats: { ux: { ms: 1, tokens: 1, calls: 1 } } });
        expect(expertDoing(c, c.experts[0])).toBe("Proposed · 2 ideas");
        expect(expertDoing(c, c.experts[1])).toBe("Waits to start");
    });

    it("counts a settled council's posts, and names a failure", () => {
        const c = council({
            state: "done",
            summary: { text: "", directions: [], outcomes: {}, at: 1 },
            replies: [reply("r1", "ram", { stance: "accept" })],
            failed: { nu: { round: 1, error: "timed out" } },
        });
        expect(expertDoing(c, c.experts[0])).toBe("2 ideas");
        expect(expertDoing(c, c.experts[1])).toBe("1 idea · 1 reply");
        expect(expertDoing(c, c.experts[2])).toBe("Failed while proposing");
        expect(expertDoing(c, c.experts[3])).toBe("1 idea");
        expect(expertDoing(c, c.experts[4])).toBe("Wrote the summary");
        expect(expertDoing({ ...c, proposals: [], replies: [] }, c.experts[3])).toBe("No posts");
    });

    it("counts the ideas that were sent: a held draft and a dropped one are not a post yet", () => {
        const c = council({
            state: "awaiting-you",
            proposals: [
                prop("P1", "ux"),
                prop("P2", "ux", { draft: "held" }),
                prop("P3", "ram", { draft: "dropped" }),
                prop("P4", "nu", { draft: "held" }),
            ],
        });
        expect(expertDoing(c, c.experts[0])).toBe("1 idea");
        expect(expertDoing(c, c.experts[1])).toBe("No posts");
        expect(expertDoing(c, c.experts[2])).toBe("No posts");
    });
});

describe("failedWhile", () => {
    it("says where a call failed, by the step it was in", () => {
        const two = council();
        expect([1, 2, 3, 4, 0].map((round) => failedWhile(two, round))).toEqual([
            "Failed while proposing",
            "Failed while replying",
            "Failed while writing the summary",
            "Failed while answering",
            "Failed",
        ]);
    });

    it("moves the summary with the rounds a council runs", () => {
        const three = council({ rounds: 3 });
        expect([2, 3, 4, 5].map((round) => failedWhile(three, round))).toEqual([
            "Failed while replying",
            "Failed while replying",
            "Failed while writing the summary",
            "Failed while answering",
        ]);
        const one = council({ rounds: 1 });
        expect([1, 2, 3].map((round) => failedWhile(one, round))).toEqual([
            "Failed while proposing",
            "Failed while writing the summary",
            "Failed while answering",
        ]);
    });
});

describe("expertCard", () => {
    const c = council({
        round: 1,
        proposals: [prop("P1", "ux"), prop("P2", "ux"), prop("P4", "nu")],
        stats: { ux: { ms: 1, tokens: 1, calls: 1 }, nu: { ms: 1, tokens: 1, calls: 1 } },
        activity: { ram: { text: 'Grep "IdleSleep" in pkg/services' } },
    });

    it("shows the tool in use, then what a finished expert brought", () => {
        expect(expertCard(c, c.experts[1])).toEqual({ dot: "working", text: 'Grep "IdleSleep" in pkg/services' });
        expect(expertCard(c, c.experts[0])).toEqual({ dot: "done", text: "Proposed · 2 ideas" });
        expect(expertCard(c, c.experts[2])).toEqual({ dot: "done", text: "Proposed · 1 idea" });
        expect(expertCard(c, c.experts[3])).toEqual({ dot: "waiting", text: "Waits to start" });
    });

    it("marks a failed call, and an expert a stopped council never ran", () => {
        const failed = { ...c, state: "failed", failed: { sk: { round: 1, error: "exit 1" } } };
        expect(expertCard(failed, failed.experts[3])).toEqual({ dot: "failed", text: "Failed" });
        expect(expertCard(failed, failed.experts[1])).toEqual({ dot: "waiting", text: "Did not run" });
    });

    it("says no proposals for a call that brought none", () => {
        const none = council({ round: 1, proposals: [], stats: { ux: { ms: 1, tokens: 1, calls: 1 } } });
        expect(expertCard(none, none.experts[0])).toEqual({ dot: "done", text: "Proposed · no ideas" });
    });

    it("counts the ideas that were sent, not the held or dropped drafts", () => {
        const drafts = council({
            round: 1,
            proposals: [prop("P1", "ux"), prop("P2", "ux", { draft: "held" }), prop("P3", "nu", { draft: "dropped" })],
            stats: { ux: { ms: 1, tokens: 1, calls: 1 }, nu: { ms: 1, tokens: 1, calls: 1 } },
        });
        expect(expertCard(drafts, drafts.experts[0])).toEqual({ dot: "done", text: "Proposed · 1 idea" });
        expect(expertCard(drafts, drafts.experts[2])).toEqual({ dot: "done", text: "Proposed · no ideas" });
    });
});

describe("the call bar", () => {
    it("counts the segments by state, leaving out those with none", () => {
        expect(
            segmentSummary([
                "done",
                "done",
                "running",
                "running",
                "pending",
                "pending",
                "pending",
                "pending",
                "pending",
            ])
        ).toBe("9 calls: 2 done, 2 running, 5 waiting");
        expect(segmentSummary(["done", "failed", "pending"])).toBe("3 calls: 1 done, 1 failed, 1 waiting");
    });

    it("reads a council's own bar", () => {
        const c = council({ round: 1, calls: 2, activity: { ram: { text: "x" }, sk: { text: "y" } } });
        expect(callBarLabel(c)).toBe("9 calls: 2 done, 2 running, 5 waiting");
    });
});

describe("headerCost", () => {
    it("is the cost line, without `0 replies` before any discussion", () => {
        const c = council({ started: 1000, tokens: 313_000, replies: [reply("r1", "ram")] });
        expect(headerCost(c, 441_000)).toBe("7:20 · 1 reply · 0.31M tokens");
        expect(headerCost({ ...c, replies: [] }, 229_000)).toBe("3:48 · 0.31M tokens");
        expect(headerCost({ ...c, replies: undefined, started: undefined }, 0)).toBe("0.31M tokens");
    });
});

describe("sinceStart", () => {
    it("reads the council's clock at a time, empty before it started", () => {
        expect(sinceStart(council({ started: 1000 }), 1000 + 112_000)).toBe("1:52");
        expect(sinceStart(council({ started: 1000 }), 1000 + 3_723_000)).toBe("1:02:03");
        expect(sinceStart(council(), 5000)).toBe("");
    });
});

describe("evidenceChip", () => {
    it("shows a reference as it is, and a weak claim with why", () => {
        expect(evidenceChip({ ref: "pkg/services/model.go:38" })).toEqual({
            text: "pkg/services/model.go:38",
            weak: false,
        });
        expect(evidenceChip({ ref: "", weak: true, note: '"about 3 s" has no measurement' })).toEqual({
            text: 'Weak · "about 3 s" has no measurement',
            weak: true,
        });
        expect(evidenceChip({ ref: "a.ts:1", weak: true })).toEqual({ text: "Weak · a.ts:1", weak: true });
        expect(evidenceChip({ ref: "", weak: true })).toEqual({ text: "Weak · no evidence", weak: true });
    });
});

describe("reactions", () => {
    const blank = (id: string, author: string, extra: Partial<CouncilReply> = {}) =>
        reply(id, author, { stance: "accept", text: "", ...extra });

    it("lists an accept with no text as `<name> agrees`, in the order they came", () => {
        const c = council({ replies: [blank("r1", "nu", { ts: 2 }), blank("r2", "ram", { ts: 1 })] });
        expect(reactions(c, "P2")).toEqual(["RAM agrees", "New user agrees"]);
        expect(reactions(c, "P1")).toEqual([]);
    });

    it("drops one whose author said something else after it, and never lists the person's", () => {
        const c = council({
            replies: [
                blank("r1", "ram", { ts: 1 }),
                reply("r2", "ram", { stance: "challenge", ts: 2 }),
                blank("r3", "sk", { ts: 1 }),
                reply("r4", "sk", { stance: "accept", text: "with a reason", ts: 2 }),
                blank("r5", "you", { ts: 3 }),
            ],
        });
        expect(reactions(c, "P2")).toEqual([]);
    });

    it("lists an expert once, and keeps the reaction through a reply with no stance", () => {
        const c = council({
            replies: [blank("r1", "ram", { ts: 1 }), blank("r2", "ram", { ts: 2 }), reply("r3", "ram", { ts: 3 })],
        });
        expect(reactions(c, "P2")).toEqual(["RAM agrees"]);
    });
});

describe("who answers", () => {
    it("joins names", () => {
        expect(listNames([])).toBe("");
        expect(listNames(["UX"])).toBe("UX");
        expect(listNames(["UX", "RAM"])).toBe("UX and RAM");
        expect(listNames(["UX", "RAM", "Skeptic"])).toBe("UX, RAM and Skeptic");
    });

    it("tells a council that is over from one that is not", () => {
        expect(["done", "stopped", "failed"].map((state) => isFollowUp(council({ state })))).toEqual([
            true,
            true,
            true,
        ]);
        expect(["running", "awaiting-you", "not-run"].map((state) => isFollowUp(council({ state })))).toEqual([
            false,
            false,
            false,
        ]);
    });
});

describe("summarizeAction", () => {
    const summary = { text: "", directions: [], outcomes: {}, at: 100 };

    it("asks for a summary when there is none", () => {
        expect(summarizeAction(council())).toEqual({ label: "Summarize", call: true });
    });

    it("asks for a new one when replies came after it, or its rerun failed", () => {
        expect(summarizeAction(council({ summary, replies: [reply("r1", "you", { ts: 200 })] }))).toEqual({
            label: "Summarize again",
            call: true,
        });
        expect(summarizeAction(council({ summary, failed: { coordinator: { round: 3, error: "x" } } }))).toEqual({
            label: "Summarize again",
            call: true,
        });
    });

    it("only opens a current one", () => {
        expect(summarizeAction(council({ summary, replies: [reply("r1", "ram", { ts: 50 })] }))).toEqual({
            label: "Open summary",
            call: false,
        });
    });
});

describe("failures", () => {
    const c = council({
        state: "failed",
        round: 3,
        failed: { sk: { round: 1, error: "timed out" }, coordinator: { round: 3, error: "not JSON" } },
    });

    it("lists the panel's failed calls apart from the coordinator's", () => {
        expect(failedExperts(c).map((f) => [f.expert.id, f.round, f.error])).toEqual([["sk", 1, "timed out"]]);
        expect(coordinatorFailure(c)).toMatchObject({ round: 3, error: "not JSON", expert: { id: "coordinator" } });
        expect(coordinatorFailure({ ...c, failed: undefined })).toBeNull();
    });

    it("knows when a failed council has nothing left to retry", () => {
        expect(retriedOut(c)).toBe(false);
        expect(retriedOut({ ...c, failed: {} })).toBe(true);
        expect(retriedOut({ ...c, failed: undefined })).toBe(true);
        expect(retriedOut({ ...c, state: "done", failed: {} })).toBe(false);
    });
});

describe("discussionBody", () => {
    it("starts with the cards while round 1 runs, and when no expert brought a proposal", () => {
        expect(discussionBody(council({ round: 1 }))).toBe("experts");
        expect(discussionBody(council({ state: "failed", round: 1, proposals: [] }))).toBe("experts");
        expect(discussionBody(council({ state: "done", round: 3, proposals: undefined }))).toBe("experts");
    });

    it("gives the pause and the not-run council their own panels", () => {
        expect(discussionBody(council({ state: "awaiting-you", round: 1 }))).toBe("pause");
        expect(discussionBody(council({ state: "not-run", round: 0, proposals: [] }))).toBe("not-run");
    });

    it("shows the chat from round 2 on, and for a council stopped or failed with proposals", () => {
        expect(discussionBody(council({ round: 2 }))).toBe("chat");
        expect(discussionBody(council({ state: "done", round: 3 }))).toBe("chat");
        expect(discussionBody(council({ state: "stopped", round: 1 }))).toBe("chat");
        expect(discussionBody(council({ state: "failed", round: 3 }))).toBe("chat");
    });

    it("shows the chat instead of the pause while the person has drafts to settle, in any round", () => {
        const held = council({
            state: "awaiting-you",
            round: 1,
            proposals: [prop("P1", "ux", { draft: "held" }), prop("P2", "ram")],
        });
        expect(discussionBody(held)).toBe("chat");
        const heldReply = council({
            state: "awaiting-you",
            round: 2,
            replies: [reply("r1", "ram", { draft: "held" })],
        });
        expect(discussionBody(heldReply)).toBe("chat");
        // a dropped draft is settled: nothing waits, so the pause is back
        const dropped = council({
            state: "awaiting-you",
            round: 1,
            proposals: [prop("P1", "ux", { draft: "dropped" })],
        });
        expect(discussionBody(dropped)).toBe("pause");
    });

    it("keeps the queued and not-run councils off the chat", () => {
        expect(discussionBody(council({ state: "not-run", round: 0 }))).toBe("not-run");
        expect(discussionBody(council({ state: "queued", round: 0, proposals: [] }))).toBe("experts");
    });
});

describe("isQueued and modeWord", () => {
    it("knows a council that waits for the running one", () => {
        expect(isQueued(council({ state: "queued", round: 0 }))).toBe(true);
        expect(isQueued(council({ state: "running" }))).toBe(false);
    });

    it("reads an empty or unknown mode as Review", () => {
        expect(modeWord(council())).toBe("Review");
        expect(modeWord(council({ mode: "brainstorm" }))).toBe("Brainstorm");
        expect(modeWord(council({ mode: "debate" }))).toBe("Review");
    });
});

describe("avatarStackLabel", () => {
    it("names the panel and who is writing", () => {
        expect(avatarStackLabel(council())).toBe("UX, RAM, New user, Skeptic, Coordinator");
        const busy = council({ activity: { ram: { text: "a" }, sk: { text: "b" } } });
        expect(avatarStackLabel(busy)).toBe("UX, RAM, New user, Skeptic, Coordinator; RAM and Skeptic are writing");
        expect(avatarStackLabel(council({ activity: { ux: { text: "a" } } }))).toMatch(/; UX is writing$/);
    });
});

describe("the pause", () => {
    const c = council({ state: "awaiting-you", round: 1 });

    it("keeps every proposal but the ones unticked, withdrawn ones aside", () => {
        expect(keptProposals(c, [])).toEqual(["P1", "P2", "P3"]);
        expect(keptProposals(c, ["P2"])).toEqual(["P1", "P3"]);
    });

    it("ticks and unticks", () => {
        expect(toggleCut([], "P6")).toEqual(["P6"]);
        expect(toggleCut(["P6", "P2"], "P6")).toEqual(["P2"]);
    });

    it("needs a proposal to carry on with", () => {
        expect(canContinue(c, ["P1", "P2"])).toBe(true);
        expect(canContinue(c, ["P1", "P2", "P3"])).toBe(false);
    });
});
