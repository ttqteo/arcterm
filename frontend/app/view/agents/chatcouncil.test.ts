// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { describe, expect, it } from "vitest";
import {
    COUNCIL_WORD,
    councilCardView,
    councilEndedOnce,
    councilRowView,
    councilStartAnchor,
    placeCouncilCards,
    seatStates,
    type CouncilAnchor,
} from "./chatcouncil";
import { UNTITLED_COUNCIL } from "./councilmodel";

const ID = "9f3a1c04d27b58e6";
const RUNNING = "0a1b2c3d4e5f6071";

// the lines cmd/wsh/cmd/wshcmd-council.go prints (councilStartedLine, councilQueuedLine, councilNotRunText)
const STARTED = `council ${ID} started: Scheduled tasks in one place · review · UI feature panel · 4 experts · ≈ 14 calls · ~0.9M tokens\n`;
const QUEUED = `Queued after ${RUNNING} (Paper §5 draft) · council ${ID} starts by itself when it ends\n`;
const REASON =
    "Not run: the person chose not to start a council now (token budget, about 0.9M tokens). Do not retry a spawn this turn; do the work in this session or ask the person, and say in your report that the spawn was refused.";
const NOT_RUN = `${REASON}\ncouncil ${ID} saved as not run; Start council in the app runs it\n`;

describe("councilStartAnchor", () => {
    const cmd = 'wsh council start --feature "Scheduled tasks" --mode review --files a.ts';

    it("reads the started line of a council that began, and keeps its estimate as text", () => {
        expect(councilStartAnchor(cmd, STARTED)).toEqual({
            kind: "started",
            councilId: ID,
            estimate: "≈ 14 calls · ~0.9M tokens",
        });
    });

    it("keeps the estimate in each shape the token count takes", () => {
        const line = (tokens: string, seats = "4 experts") =>
            `council ${ID} started: Idea · brainstorm · product-ideas · ${seats} · ≈ 9 calls · ~${tokens} tokens\n`;
        expect(councilStartAnchor(cmd, line("850"))).toMatchObject({ estimate: "≈ 9 calls · ~850 tokens" });
        expect(councilStartAnchor(cmd, line("42k"))).toMatchObject({ estimate: "≈ 9 calls · ~42k tokens" });
        expect(councilStartAnchor(cmd, line("13.2M", "2 chats + Bug hunter"))).toMatchObject({
            estimate: "≈ 9 calls · ~13.2M tokens",
        });
    });

    it("reads the estimate at the end of the line, not one the feature quotes", () => {
        const out = `council ${ID} started: Is ≈ 3 calls · ~1M tokens enough? · review · ui-feature · 4 experts · ≈ 14 calls · ~0.9M tokens\n`;
        expect(councilStartAnchor(cmd, out)).toEqual({
            kind: "started",
            councilId: ID,
            estimate: "≈ 14 calls · ~0.9M tokens",
        });
    });

    it("names a started council even when its line holds no estimate", () => {
        const anchor = councilStartAnchor(
            cmd,
            `council ${ID} started: Idea · brainstorm · product-ideas · 4 experts\n`
        );
        expect(anchor).toEqual({ kind: "started", councilId: ID });
        expect(anchor).not.toHaveProperty("estimate");
    });

    it("reads a queued line, with the council it waits for named or not", () => {
        expect(councilStartAnchor(cmd, QUEUED)).toEqual({ kind: "queued", councilId: ID });
        expect(
            councilStartAnchor(cmd, `Queued after ${RUNNING} · council ${ID} starts by itself when it ends\n`)
        ).toEqual({ kind: "queued", councilId: ID });
    });

    it("takes the new council's own id from a queued line, not the running one's", () => {
        const anchor = councilStartAnchor(cmd, QUEUED);
        expect(anchor?.councilId).toBe(ID);
        expect(anchor?.councilId).not.toBe(RUNNING);
    });

    it("reads a refusal: the council saved as not run, with the Not run line kept as its reason", () => {
        expect(councilStartAnchor(cmd, NOT_RUN)).toEqual({ kind: "notrun", councilId: ID, reason: REASON });
    });

    it("keeps the reason when the Token burn hold line is printed before it", () => {
        const hold = "Token burn: waiting for your answer on arcterm's card before the agent may start a council.\n";
        expect(councilStartAnchor(cmd, hold + NOT_RUN)).toEqual({ kind: "notrun", councilId: ID, reason: REASON });
    });

    it("names a council saved as not run even when the reason line is missing", () => {
        expect(councilStartAnchor(cmd, `council ${ID} saved as not run; Start council in the app runs it\n`)).toEqual({
            kind: "notrun",
            councilId: ID,
            reason: "Not run",
        });
    });

    it("reads CRLF output", () => {
        expect(councilStartAnchor(cmd, STARTED.replace(/\n/g, "\r\n"))).toMatchObject({
            kind: "started",
            councilId: ID,
        });
        expect(councilStartAnchor(cmd, QUEUED.replace(/\n/g, "\r\n"))).toEqual({ kind: "queued", councilId: ID });
        expect(councilStartAnchor(cmd, NOT_RUN.replace(/\n/g, "\r\n"))).toEqual({
            kind: "notrun",
            councilId: ID,
            reason: REASON,
        });
    });

    it("finds wsh through a path, an .exe, quotes, a prefix command, a chain and a substitution", () => {
        const anchor = { kind: "started", councilId: ID, estimate: "≈ 14 calls · ~0.9M tokens" };
        expect(councilStartAnchor("~/.arc/bin/wsh council start --feature x", STARTED)).toEqual(anchor);
        expect(councilStartAnchor('"$HOME/.arc/bin/wsh" council start --feature x', STARTED)).toEqual(anchor);
        expect(councilStartAnchor("C:\\Users\\me\\.arc\\bin\\wsh.exe council start --feature x", STARTED)).toEqual(
            anchor
        );
        expect(councilStartAnchor('"C:/Program Files/arc/wsh.exe" council start --feature x', STARTED)).toEqual(anchor);
        expect(councilStartAnchor("cd repo && wsh council start --feature x", STARTED)).toEqual(anchor);
        expect(councilStartAnchor("  wsh   council   start --feature x", STARTED)).toEqual(anchor);
        expect(councilStartAnchor("out=$(wsh council start --feature x)", STARTED)).toEqual(anchor);
        expect(councilStartAnchor("wsh council start", STARTED)).toEqual(anchor);
    });

    it("takes the first council when the output names several", () => {
        const other = "1111222233334444";
        const out = `${STARTED}council ${other} started: Other · review · ui-feature · 4 experts · ≈ 5 calls · ~0.3M tokens\n`;
        expect(councilStartAnchor("wsh council start --feature a; wsh council start --feature b", out)).toMatchObject({
            kind: "started",
            councilId: ID,
        });
        // the earlier line wins whichever kind it is
        expect(councilStartAnchor(cmd, `${QUEUED}${STARTED}`)).toEqual({ kind: "queued", councilId: ID });
        expect(councilStartAnchor(cmd, `${NOT_RUN}${QUEUED}`)).toMatchObject({ kind: "notrun" });
    });

    it("keeps the line when other output comes first or follows", () => {
        const out = `reading the council roles…\n${STARTED}read it back with: wsh council wait ${ID}\n`;
        expect(councilStartAnchor(cmd, out)).toMatchObject({ kind: "started", councilId: ID });
    });

    it("is null for a command that is not wsh council start", () => {
        expect(councilStartAnchor("wsh council wait " + ID, STARTED)).toBeNull();
        expect(councilStartAnchor("wsh council estimate --files a.ts", STARTED)).toBeNull();
        expect(councilStartAnchor("wsh council show " + ID, STARTED)).toBeNull();
        expect(councilStartAnchor("wsh council start-now " + ID, STARTED)).toBeNull();
        expect(councilStartAnchor("wsh council startx", STARTED)).toBeNull();
        expect(councilStartAnchor("wsh runs start --plan p.md", STARTED)).toBeNull();
        expect(councilStartAnchor("wsh agents start", STARTED)).toBeNull();
        expect(councilStartAnchor("git status", STARTED)).toBeNull();
        expect(councilStartAnchor("echo council start", STARTED)).toBeNull();
        expect(councilStartAnchor("", STARTED)).toBeNull();
    });

    it("is null when the output carries none of the three lines", () => {
        expect(councilStartAnchor(cmd, "")).toBeNull();
        expect(councilStartAnchor(cmd, "error: --feature is required: name what the council looks at\n")).toBeNull();
        expect(councilStartAnchor("wsh council start --help", "Usage:\n  wsh council start [flags]\n")).toBeNull();
        expect(councilStartAnchor(cmd, `council ${ID} is waiting on you: it paused after round 1.\n`)).toBeNull();
    });

    it("is null when the output only quotes an id or half a line", () => {
        expect(councilStartAnchor(cmd, `see: wsh council wait ${ID}\n`)).toBeNull();
        expect(councilStartAnchor(cmd, `Queued after ${RUNNING} (Paper §5 draft)\n`)).toBeNull();
        expect(councilStartAnchor(cmd, `error: the earlier council ${ID} started: yesterday\n`)).toBeNull();
        expect(councilStartAnchor(cmd, `the earlier council ${ID} saved as not run\n`)).toBeNull();
    });
});

// ---- the council the cards read ----

const MIN = 60_000;
const STARTED_AT = 1_000_000;

const seats: CouncilExpert[] = [
    { id: "ux", name: "Ease of use", brief: "", model: "sonnet" },
    { id: "ram", name: "Memory watcher", brief: "", model: "sonnet" },
    { id: "nu", name: "New user", brief: "", model: "sonnet" },
    { id: "bug", name: "Bug hunter", brief: "", model: "sonnet" },
    { id: "coordinator", name: "Summarizer", brief: "", model: "opus", coordinator: true },
];

const idea = (id: string, author: string, extra: Partial<CouncilProposal> = {}): CouncilProposal => ({
    id,
    author,
    title: `idea ${id}`,
    argument: "",
    ts: 1,
    ...extra,
});

const said = (id: string, author: string, round: number, extra: Partial<CouncilReply> = {}): CouncilReply => ({
    id,
    proposalid: "P1",
    author,
    text: "a reply",
    round,
    ts: 2,
    ...extra,
});

const summaryOf = (n: number): CouncilSummary => ({
    text: "",
    directions: Array.from({ length: n }, (_, i) => ({ title: `direction ${i}` }) as CouncilDirection),
    outcomes: {},
    at: STARTED_AT + 6 * MIN,
});

const council = (extra: Partial<Council> = {}): Council => ({
    id: ID,
    project: "D:\\code\\arc",
    feature: "Spec: council and Doc review in Chat",
    question: "Does this spec miss a state, or make Chat heavier?\n\nKeep to: no new fetch path; one card shell.",
    mode: "review",
    experts: seats,
    rounds: 3,
    state: "running",
    round: 2,
    started: STARTED_AT,
    runstarted: STARTED_AT,
    tokens: 0,
    calls: 0,
    created: STARTED_AT,
    updated: STARTED_AT,
    ...extra,
});

const started: CouncilAnchor = { kind: "started", councilId: ID, estimate: "≈ 14 calls · ~0.9M tokens" };
const queued: CouncilAnchor = { kind: "queued", councilId: ID };
const notRun: CouncilAnchor = { kind: "notrun", councilId: ID, reason: REASON };

describe("councilEndedOnce", () => {
    it("is true for a council a not-run line named, whatever it is now", () => {
        expect(councilEndedOnce(null, notRun, false)).toBe(true);
        expect(councilEndedOnce(council({ state: "running" }), notRun, false)).toBe(true);
    });

    it("is true for a council in an ended state", () => {
        for (const state of ["done", "stopped", "failed", "not-run"]) {
            expect(councilEndedOnce(council({ state }), started, false)).toBe(true);
        }
    });

    it("is true for a running council that holds a summary (a follow-up after done)", () => {
        expect(councilEndedOnce(council({ state: "running", round: 4, summary: summaryOf(3) }), started, false)).toBe(
            true
        );
    });

    it("is true for a council this app session saw ended, resumed since", () => {
        expect(councilEndedOnce(council({ state: "running" }), started, true)).toBe(true);
        expect(councilEndedOnce(null, started, true)).toBe(true);
    });

    it("is false for a council that runs, waits or is queued and never ended", () => {
        expect(councilEndedOnce(council({ state: "running" }), started, false)).toBe(false);
        expect(councilEndedOnce(council({ state: "awaiting-you", round: 1 }), started, false)).toBe(false);
        expect(councilEndedOnce(council({ state: "queued", round: 0 }), queued, false)).toBe(false);
        expect(councilEndedOnce(null, started, false)).toBe(false);
    });
});

describe("placeCouncilCards", () => {
    const at = (key: string, order: number, anchor: CouncilAnchor) => ({ key, anchor, order });
    const idOf = (n: number) => `00000000000000${n}`;
    const idAnchor = (n: number): CouncilAnchor => ({ kind: "started", councilId: idOf(n) });
    const none = new Set<string>();

    it("puts a live council at the end of the conversation", () => {
        const placed = placeCouncilCards({
            anchors: [at("councilstart:3", 3, started)],
            councils: new Map([[ID, council()]]),
            endedOnce: none,
        });
        expect(placed.trailing).toEqual([ID]);
        expect(placed.atCall.size).toBe(0);
    });

    it("puts a queued and a waiting council at the end too", () => {
        const placed = placeCouncilCards({
            anchors: [at("councilstart:3", 3, queued), at("councilstart:7", 7, idAnchor(2))],
            councils: new Map([
                [ID, council({ state: "queued", round: 0 })],
                [idOf(2), council({ id: idOf(2), state: "awaiting-you", round: 1 })],
            ]),
            endedOnce: none,
        });
        expect(placed.trailing).toEqual([ID, idOf(2)]);
    });

    it("puts a council that ended once at its call, and not at the end", () => {
        const placed = placeCouncilCards({
            anchors: [at("councilstart:3", 3, started)],
            councils: new Map([[ID, council({ state: "done" })]]),
            endedOnce: new Set([ID]),
        });
        expect(placed.atCall).toEqual(new Map([["councilstart:3", ID]]));
        expect(placed.trailing).toEqual([]);
    });

    it("keeps a council that runs again after done at its call", () => {
        const placed = placeCouncilCards({
            anchors: [at("councilstart:3", 3, started)],
            councils: new Map([[ID, council({ state: "running", round: 4, summary: summaryOf(4) })]]),
            endedOnce: new Set([ID]),
        });
        expect(placed.atCall.get("councilstart:3")).toBe(ID);
        expect(placed.trailing).toEqual([]);
    });

    it("draws a council once: the first call that names it keeps it", () => {
        const placed = placeCouncilCards({
            anchors: [at("councilstart:9", 9, started), at("councilstart:3", 3, started)],
            councils: new Map([[ID, council({ state: "done" })]]),
            endedOnce: new Set([ID]),
        });
        expect(placed.atCall).toEqual(new Map([["councilstart:3", ID]]));
        const live = placeCouncilCards({
            anchors: [at("councilstart:9", 9, started), at("councilstart:3", 3, started)],
            councils: new Map([[ID, council()]]),
            endedOnce: none,
        });
        expect(live.trailing).toEqual([ID]);
        expect(live.atCall.size).toBe(0);
    });

    it("draws nothing for a council the store does not know", () => {
        const placed = placeCouncilCards({
            anchors: [at("councilstart:3", 3, started), at("councilstart:5", 5, idAnchor(2))],
            councils: new Map<string, Council | null>([[ID, null]]),
            endedOnce: none,
        });
        expect(placed.atCall.size).toBe(0);
        expect(placed.trailing).toEqual([]);
    });

    it("still draws the row of a not-run line whose council the store does not know", () => {
        const placed = placeCouncilCards({
            anchors: [at("councilstart:3", 3, notRun)],
            councils: new Map<string, Council | null>([[ID, null]]),
            endedOnce: none,
        });
        expect(placed.atCall).toEqual(new Map([["councilstart:3", ID]]));
        // and one the map has no entry for at all
        const unlisted = placeCouncilCards({
            anchors: [at("councilstart:3", 3, notRun)],
            councils: new Map(),
            endedOnce: none,
        });
        expect(unlisted.atCall.get("councilstart:3")).toBe(ID);
    });

    it("orders the end of the conversation by call, oldest first", () => {
        const placed = placeCouncilCards({
            anchors: [
                at("councilstart:9", 9, idAnchor(3)),
                at("councilstart:2", 2, idAnchor(1)),
                at("councilstart:5", 5, idAnchor(2)),
            ],
            councils: new Map([
                [idOf(1), council({ id: idOf(1) })],
                [idOf(2), council({ id: idOf(2) })],
                [idOf(3), council({ id: idOf(3) })],
            ]),
            endedOnce: none,
        });
        expect(placed.trailing).toEqual([idOf(1), idOf(2), idOf(3)]);
    });

    it("splits the conversation's councils between their calls and the end", () => {
        const placed = placeCouncilCards({
            anchors: [at("councilstart:2", 2, idAnchor(1)), at("councilstart:5", 5, idAnchor(2))],
            councils: new Map([
                [idOf(1), council({ id: idOf(1), state: "failed" })],
                [idOf(2), council({ id: idOf(2) })],
            ]),
            endedOnce: new Set([idOf(1)]),
        });
        expect(placed.atCall).toEqual(new Map([["councilstart:2", idOf(1)]]));
        expect(placed.trailing).toEqual([idOf(2)]);
    });
});

describe("seatStates", () => {
    const states = (c: Council) => Object.fromEntries(seatStates(c).map((s) => [s.id, s.state]));

    it("lists the panel without the coordinator, by the name the council shows", () => {
        expect(seatStates(council()).map((s) => s.name)).toEqual([
            "Ease of use",
            "Memory watcher",
            "New user",
            "Bug hunter",
        ]);
    });

    it("reads round 1 from the ideas a seat sent", () => {
        const c = council({
            round: 1,
            proposals: [idea("P1", "ux"), idea("P2", "ram", { draft: "held" })],
            activity: { nu: { text: "Writing an idea" } },
        });
        expect(states(c)).toEqual({ ux: "done", ram: "waiting", nu: "working", bug: "waiting" });
    });

    it("reads a later round from the replies a seat sent in it", () => {
        const c = council({
            round: 2,
            proposals: [idea("P1", "ux")],
            replies: [
                said("r1", "ux", 2),
                said("r2", "ram", 1),
                said("r3", "nu", 2, { draft: "held" }),
                said("r4", "bug", 2),
            ],
            activity: { bug: { text: "Writing a reply", proposalid: "P1" } },
        });
        expect(states(c)).toEqual({ ux: "done", ram: "waiting", nu: "waiting", bug: "working" });
    });

    it("shows a seat as working while it has activity, even after it sent", () => {
        const c = council({ round: 1, proposals: [idea("P1", "ux")], activity: { ux: { text: "Writing" } } });
        expect(states(c).ux).toBe("working");
    });

    it("reads the summary round by the last round the seats answered", () => {
        // rounds 3: the summary is round 4
        const c = council({ round: 4, rounds: 3, replies: [said("r1", "ux", 3), said("r2", "ram", 3)] });
        expect(states(c)).toEqual({ ux: "done", ram: "done", nu: "waiting", bug: "waiting" });
    });
});

describe("councilCardView", () => {
    const now = STARTED_AT + 2 * MIN + 14_000;

    it("reads a running council: head, title, the question alone, the step, elapsed and the line's estimate", () => {
        const v = councilCardView(council({ proposals: [idea("P1", "ux")] }), started, null, now);
        expect(v.state).toBe("running");
        expect(v.head).toBe("Council · review");
        expect(v.title).toBe("Spec: council and Doc review in Chat");
        expect(v.question).toBe("Does this spec miss a state, or make Chat heavier?");
        expect(v.tag).toBe("Round 2 of 3");
        expect(v.elapsed).toBe("2 min 14 s");
        expect(v.estimate).toBe("≈ 14 calls · ~0.9M tokens");
        expect(v.seats).toHaveLength(4);
        expect(v.line).toBeUndefined();
    });

    it("heads a brainstorm council as one", () => {
        expect(councilCardView(council({ mode: "brainstorm" }), started, null, now).head).toBe("Council · brainstorm");
        expect(councilCardView(council({ mode: undefined }), started, null, now).head).toBe("Council · review");
    });

    it("words the step the way the Discussion does", () => {
        expect(councilCardView(council({ round: 1, rounds: 2 }), started, null, now).tag).toBe("Round 1 of 2");
        expect(councilCardView(council({ round: 3, rounds: 2 }), started, null, now).tag).toBe("Writing the summary");
        expect(councilCardView(council({ round: 4, rounds: 2 }), started, null, now).tag).toBe("Follow-up");
    });

    it("leaves the estimate out when the line quoted none or the start was queued", () => {
        expect(councilCardView(council(), { kind: "started", councilId: ID }, null, now).estimate).toBeUndefined();
        expect(councilCardView(council(), queued, null, now).estimate).toBeUndefined();
    });

    it("names an untitled council", () => {
        expect(councilCardView(council({ feature: "  " }), started, null, now).title).toBe(UNTITLED_COUNCIL);
    });

    it("reads a council paused after round 1: how many experts sent how many ideas", () => {
        const c = council({
            state: "awaiting-you",
            round: 1,
            pauseafterround1: true,
            proposals: [
                idea("P1", "ux"),
                idea("P2", "ux"),
                idea("P3", "ram"),
                idea("P4", "nu"),
                idea("P5", "nu"),
                idea("P6", "bug"),
                // dropped: an unsent idea reached nobody, and a council the agent started never holds one
                idea("P7", "bug", { draft: "dropped" }),
                idea("P8", "coordinator"),
            ],
        });
        const v = councilCardView(c, started, null, now);
        expect(v.state).toBe("awaiting");
        expect(v.tag).toBe("Waiting on you");
        expect(v.line).toBe("Paused after round 1 · 4 experts sent 6 ideas. Read them in the room, or go on.");
    });

    it("says expert and idea in the singular", () => {
        const c = council({ state: "awaiting-you", round: 1, proposals: [idea("P1", "ux")] });
        expect(councilCardView(c, started, null, now).line).toBe(
            "Paused after round 1 · 1 expert sent 1 idea. Read them in the room, or go on."
        );
    });

    it("reads a queued council by the one it waits for", () => {
        const waiting = council({ state: "queued", round: 0, queuedafter: "0a1b2c3d4e5f6071", started: undefined });
        const holder = council({ id: "0a1b2c3d4e5f6071", feature: "Paper §5 draft" });
        const v = councilCardView(waiting, queued, holder, now);
        expect(v.state).toBe("queued");
        expect(v.tag).toBe('Queued after "Paper §5 draft" · starts by itself');
        expect(v.title).toBe("Spec: council and Doc review in Chat");
    });

    it("reads a queued council with no holder known, or an untitled one", () => {
        const waiting = council({ state: "queued", round: 0, queuedafter: "0a1b2c3d4e5f6071" });
        expect(councilCardView(waiting, queued, null, now).tag).toBe("Queued · starts by itself");
        expect(councilCardView(waiting, queued, council({ feature: "" }), now).tag).toBe(
            `Queued after "${UNTITLED_COUNCIL}" · starts by itself`
        );
    });
});

describe("councilRowView", () => {
    const now = STARTED_AT + 99 * MIN;
    const ended = { runstarted: undefined };

    it("reads a done council: ✓, mode, count of directions, elapsed, the feature, Open report", () => {
        const c = council({ state: "done", round: 4, ranms: 6 * MIN + 40_000, ...ended, summary: summaryOf(4) });
        expect(councilRowView(c, started, now)).toEqual({
            end: "done",
            mark: "✓",
            head: "Council · review · 4 directions · 6 min 40 s",
            text: "Spec: council and Doc review in Chat",
            action: "report",
        });
    });

    it("counts ideas for a brainstorm, and says one in the singular", () => {
        const done = (mode: string, n: number) =>
            council({ state: "done", mode, ranms: 4 * MIN, ...ended, summary: summaryOf(n) });
        expect(councilRowView(done("brainstorm", 3), started, now).head).toBe("Council · brainstorm · 3 ideas · 4 min");
        expect(councilRowView(done("brainstorm", 1), started, now).head).toBe("Council · brainstorm · 1 idea · 4 min");
        expect(councilRowView(done("review", 1), started, now).head).toBe("Council · review · 1 direction · 4 min");
    });

    it("leaves the count out with no summary and the elapsed out when nothing was timed", () => {
        const c = council({ state: "done", ranms: 40_000, ...ended });
        expect(councilRowView(c, started, now).head).toBe("Council · review · 40 s");
        const untimed = council({
            state: "done",
            started: undefined,
            ranms: undefined,
            ...ended,
            summary: summaryOf(2),
        });
        expect(councilRowView(untimed, started, now).head).toBe("Council · review · 2 directions");
    });

    it("reads a stopped council that holds its summary as done", () => {
        const c = council({ state: "stopped", round: 4, ranms: MIN, ...ended, summary: summaryOf(2) });
        const v = councilRowView(c, started, now);
        expect(v.end).toBe("done");
        expect(v.action).toBe("report");
    });

    it("reads a stopped council: ■, the round, what is kept, Open council", () => {
        const c = council({ state: "stopped", round: 2, ...ended });
        expect(councilRowView(c, started, now)).toEqual({
            end: "stopped",
            mark: "■",
            head: "Council · stopped in round 2",
            text: "The rounds that finished are kept",
            action: "open",
        });
        const closed = council({ state: "stopped", round: 2, ...ended, error: "arcterm closed during round 2" });
        expect(councilRowView(closed, started, now).text).toBe("arcterm closed during round 2");
    });

    it("reads a failed council: !, the round, the error in one line, Open council", () => {
        const c = council({
            state: "failed",
            round: 1,
            error: "No expert answered round 1.\nTry again with another model.",
        });
        expect(councilRowView(c, started, now)).toEqual({
            end: "failed",
            mark: "!",
            head: "Council · failed in round 1",
            text: "No expert answered round 1. Try again with another model.",
            action: "open",
        });
    });

    it("says round 1 for a failure before any round and leaves the reason out when there is none", () => {
        const v = councilRowView(council({ state: "failed", round: 0 }), started, now);
        expect(v.head).toBe("Council · failed in round 1");
        expect(v.text).toBeUndefined();
    });

    it("reads a council the gate refused from its anchor alone: –, not run, the first sentence of the refusal", () => {
        expect(councilRowView(null, notRun, now)).toEqual({
            end: "not-run",
            mark: "–",
            head: "Council · not run",
            text: "the person chose not to start a council now (token budget, about 0.9M tokens)",
            action: "open",
        });
    });

    it("reads a not-run council from the store, with the council's error when the refusal was cut", () => {
        const bare: CouncilAnchor = { kind: "notrun", councilId: ID, reason: "Not run" };
        const c = council({ state: "not-run", round: 0, started: undefined, ...ended, error: "cost over budget" });
        expect(councilRowView(c, bare, now).text).toBe("cost over budget");
        expect(councilRowView(null, bare, now).text).toBeUndefined();
    });

    it("reads a council running again as a working row with its header chip, keeping Open council", () => {
        const again = council({ state: "running", round: 4, rounds: 2, summary: summaryOf(3) });
        expect(councilRowView(again, started, now)).toEqual({
            end: "running",
            mark: "working",
            head: "Council · running again",
            text: "Follow-up",
            action: "open",
        });
        expect(councilRowView(council({ state: "running", round: 1, rounds: 3 }), started, now).text).toBe(
            "Round 1 of 3"
        );
        expect(councilRowView(council({ state: "awaiting-you", round: 1 }), notRun, now).text).toBe("Waiting on you");
    });

    it("starts every head with the one word the row draws strong, and keeps the rest of the head after it", () => {
        expect(COUNCIL_WORD).toBe("Council");
        const heads = [
            councilRowView(council({ state: "done", ranms: 4 * MIN, ...ended, summary: summaryOf(2) }), started, now),
            councilRowView(council({ state: "stopped", round: 2, ...ended }), started, now),
            councilRowView(council({ state: "failed", round: 1 }), started, now),
            councilRowView(council({ state: "not-run", round: 0, ...ended }), started, now),
            councilRowView(council({ state: "running", round: 1, rounds: 3 }), started, now),
            councilRowView(null, notRun, now),
        ].map((v) => v.head);
        for (const head of heads) {
            expect(head.startsWith(`${COUNCIL_WORD} · `)).toBe(true);
        }
        expect(councilCardView(council({ state: "running", round: 1, rounds: 3 }), started, null, now).head).toBe(
            `${COUNCIL_WORD} · review`
        );
    });
});
