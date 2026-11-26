// Fixtures for the pair scenarios (pair-conversation, pair-decided, pair-header, pair-tree; docs/superpowers/specs/
// 2026-11-25-agent-pair-judge-design.md). No agent runs and wavesrv is never asked: the roster goes in the page's dev mock
// roster (setRoster in agent-page-fixtures.mjs), the pair in the page's dev mock pairs (devMockPairsAtom, pairstore.ts),
// and the eight RpcApi.Pair*Command methods are replaced by stubs that record what the page calls.
//
//   PAIR            the ids: the worker, the judge, and `other`, a live agent in no pair (the second judge of a two-judge view)
//   PAUSE_IDS       the ids of the pause messages pausedPairView writes: the newest and, with olderPause, the earlier one
//   RESUME_ERROR    the text the resume stub fails with while the page's failResume flag is set
//   pairRoster      the dev mock roster: the worker "Plan oracle-tightening", its judge, and `other`, all in mit-thesis
//   pairView        the R1 board's exchange in English, as the PairView wavesrv would send it
//   pausedPairView  the same pair stopped: its last message is a pause that carries the R1 Decided list
//   seedPair        set the page's dev mock pairs (null clears them, and the server's answer shows again)
//   stubPairRpc     replace the eight commands in the page; restorePairRpc puts the generated client's own back
//   setPairResumeFails  make the resume stub fail (or work again) from now on
//   pairRpcCalls    what the page called through the stubs: one command's calls, or every command's
//
// pairView(now, { judges: 1 }) is board R1: five messages (the board's four, and the opening one the first judge message
// quotes), a held `python study_pilot.py --tag benigngate_probe` on the last, one Waits-on-you item with its chip, two
// Agreed and one Still open. With { judges: 2 } the `other` agent joins as a second judge and adds one message, so the
// right-side messages name their judge. The pair relays, and a judge owes an answer to the working agent's newest message.
//
// pausedPairView(now, { reason, canresume, summary, olderPause }) is that pair stopped for `reason` (no-new-points,
// settled, token-cap or judges-gone): one more message, the pause, whose text is the server's "Paused: …" line and whose
// `pause` holds the reason, the judge's `summary` ("" for none) and a copy of the R1 Decided list. `canresume` is what
// the server would say (always false for judges-gone, whose judge is marked gone). `olderPause: true` adds an earlier
// pause message, in the middle of the exchange, with the same Decided list: a pair that paused and went on.

import { agentPage } from "./agent-page-fixtures.mjs";

export const PAIR = {
    id: "pair-fx-1",
    project: "mit-thesis",
    // the agents' tabs; the first eight characters are the short ids the UI shows (61483cd6, 4c6ba858, 9e0f1a2b)
    worker: "61483cd6-5c1e-4b2a-9d3f-1a2b3c4d5e6f",
    judge: "4c6ba858-0d7e-4f31-8a90-b1c2d3e4f5a6",
    other: "9e0f1a2b-3c4d-4e5f-8a6b-7c8d9e0f1a2b",
};

export const PAIR_COMMANDS = [
    "PairListCommand",
    "PairGetCommand",
    "PairBriefCommand",
    "PairStartCommand",
    "PairSayCommand",
    "PairRunNowCommand",
    "PairUnpairCommand",
    "PairResumeCommand",
];

export const HELD_COMMAND = "python study_pilot.py --tag benigngate_probe";

// what the resume stub fails with while window.__pairFx.failResume is set (setPairResumeFails): an error the server's
// refusals read like, so the error line a scenario looks for has real words
export const RESUME_ERROR = "nothing to resume: send a message to go on";

// the ids of the pause messages pausedPairView writes
export const PAUSE_IDS = { newest: "pm-pause", older: "pm-pause-older" };

const MIN = 60_000;

export function pairRoster(now) {
    const ctx = (contextpct) => ({ contextpct, contextmax: 200000 });
    const said = (text) => [{ kind: "message", text }];
    return [
        {
            id: PAIR.worker,
            name: "Plan oracle-tightening",
            project: PAIR.project,
            task: "Plan oracle-tightening",
            state: "idle",
            agent: "claude",
            model: "sonnet 5.5",
            usage: ctx(58),
            idleSince: now - 12_000,
            blockId: "fx-blk-pair-worker",
            previousInfo: said("Accepted both points. Drafting amendment §16.8."),
        },
        {
            id: PAIR.judge,
            name: "Judge: Plan oracle-tightening",
            project: PAIR.project,
            task: "Judge the oracle-tightening plan",
            state: "working",
            agent: "claude",
            model: "opus 5.5",
            usage: ctx(37),
            activeMs: 12_000,
            activity: "reading study_pilot.py",
            blockId: "fx-blk-pair-judge",
            previousInfo: said("Reading the pilot harness before I answer."),
        },
        {
            id: PAIR.other,
            name: "Pull history and sync",
            project: PAIR.project,
            task: "Pull history and sync",
            state: "idle",
            agent: "claude",
            model: "opus 5.5",
            usage: ctx(42),
            idleSince: now - 60_000,
            blockId: "fx-blk-pair-other",
            previousInfo: said("Synced the pull history."),
        },
    ];
}

const side = (tab, name) => ({ tab, name, harness: "claude" });

const item = (num, kind, text, extra = {}) => ({
    num,
    kind,
    text,
    note: "",
    chips: [],
    msgid: "",
    reopenedby: "",
    newby: "",
    answer: "",
    ...extra,
});

export function pairView(now, { judges = 1 } = {}) {
    if (judges !== 1 && judges !== 2) {
        throw new Error(`pairView: judges is 1 or 2, got ${judges}`);
    }
    const at = now - 12_000; // the working agent's newest message: the judge has been reading it for 12 s
    const msg = (id, from, tab, ts, text, extra = {}) => ({
        id,
        from,
        tab,
        ts,
        text,
        quote: "",
        replyto: "",
        to: "",
        held: [],
        ...extra,
    });
    const messages = [
        msg(
            "pm-opening",
            "worker",
            PAIR.worker,
            at - 17 * MIN,
            "About to run Step 8: 164 cases × two arms, the benign run and the strict one."
        ),
        msg(
            "pm-three-points",
            "judge",
            PAIR.judge,
            at - 14 * MIN,
            "Prompt symmetry holds (`loop.py:177`).\nThree points before you press the button: HIGH, token compliance may swallow the strict signal; MEDIUM, the Docker cost is not estimated yet; MEDIUM, does the gate's reason reach the model?",
            { quote: "About to run Step 8: 164 cases × two arms…", replyto: "pm-opening" }
        ),
        msg(
            "pm-checked",
            "worker",
            PAIR.worker,
            at - 7 * MIN,
            "Checked all three: (1) correct, §14 has `n_benign_ran: 0`; (2) correct, I stopped the run; (3) fine.\nPropose a 6-case probe, then launch.",
            { quote: "Three points before you press the button…", replyto: "pm-three-points" }
        ),
        msg(
            "pm-pilot-first",
            "judge",
            PAIR.judge,
            at - 3 * MIN,
            "Pilot first is right, but two locks are missing: the §16 threshold before measuring; pilot cases outside the 305 test split.",
            { quote: "Propose a 6-case probe, then launch.", replyto: "pm-checked" }
        ),
        msg(
            "pm-accept",
            "worker",
            PAIR.worker,
            at,
            "Accept both. Drafting amendment §16.8: threshold 50%, known-deviation, denominator 164.",
            {
                quote: "Pilot first is right, but two locks are missing…",
                replyto: "pm-pilot-first",
                held: [{ command: HELD_COMMAND, ts: at - 5_000 }],
            }
        ),
    ];
    if (judges === 2) {
        messages.splice(
            4,
            0,
            msg(
                "pm-second-judge",
                "judge",
                PAIR.other,
                at - 2 * MIN,
                "Agree with a probe first. Draw the 6 cases from the dev split, not the 305 test split.",
                { quote: "Propose a 6-case probe, then launch.", replyto: "pm-checked" }
            )
        );
    }
    return {
        id: PAIR.id,
        project: PAIR.project,
        worker: side(PAIR.worker, "Plan oracle-tightening"),
        judges: [
            side(PAIR.judge, "Judge: Plan oracle-tightening"),
            ...(judges === 2 ? [side(PAIR.other, "Pull history and sync")] : []),
        ],
        state: "relaying",
        stopreason: "",
        owed: true,
        messagecount: messages.length,
        lastts: at,
        holdheavy: true,
        tokencap: 3_000_000,
        tokens: 1_240_000,
        note: "",
        createdts: at - 20 * MIN,
        messages,
        decided: {
            asks: [
                item(3, "asks", "Is a 50% compliance threshold fine?", {
                    note: 'The worker proposes 50%; the judge said "for example 50%", it did not settle a number.',
                    chips: ["50%, go on"],
                    msgid: "pm-accept",
                }),
            ],
            agreed: [
                item(1, "agreed", "Write amendment §16.8 (threshold, known-deviation, denominator 164).", {
                    note: "You sign §16.",
                    msgid: "pm-accept",
                }),
                item(2, "agreed", "Pilot of 6 cases outside the test split, measuring token compliance and Docker hours.", {
                    note: "If it passes the threshold, launch the full 164.",
                    msgid: "pm-pilot-first",
                }),
            ],
            open: [item(4, "open", "Does §16.8 cover PREREG §16.5?", { msgid: "pm-accept" })],
        },
    };
}

// the "Paused: …" line the server's stop() writes as a pause message's text, per reason (a token cap names its 3.0M)
const PAUSED_LINE = {
    "no-new-points": "Paused: the judge has no new points",
    settled: "Paused: both agree",
    "token-cap": "Paused: token cap reached (3.0M)",
    "judges-gone": "Paused: no judge is left",
};

// The R1 pair stopped for `reason`. The newest message is the pause the server's stop() writes: from "system", its text the
// Paused line, `pause` the reason, the judge's summary and the Decided list at that moment (a copy of R1's: one ask with its
// chip, one open, two agreed). A token cap has spent the cap (tokens past tokencap). `canresume` says whether a resume
// would deliver anything; a judges-gone pair is never resumable and its judge is gone. With `olderPause`, an earlier pause
// sits between the judge's first message and the worker's reply to it, with the same Decided list and no summary.
export function pausedPairView(
    now,
    { reason = "no-new-points", canresume = false, summary = "", olderPause = false } = {}
) {
    if (!(reason in PAUSED_LINE)) {
        throw new Error(`pausedPairView: reason is one of ${Object.keys(PAUSED_LINE).join(", ")}, got ${reason}`);
    }
    const view = pairView(now, { judges: 1 });
    const pause = (id, ts, why, said) => ({
        id,
        from: "system",
        tab: "",
        ts,
        text: PAUSED_LINE[why],
        quote: "",
        replyto: "",
        to: "",
        held: [],
        pause: { reason: why, summary: said, decided: structuredClone(view.decided) },
    });
    const messages = [...view.messages];
    if (olderPause) {
        const at = messages.findIndex((m) => m.id === "pm-checked");
        messages.splice(at, 0, pause(PAUSE_IDS.older, messages[at].ts - 3 * MIN, "no-new-points", ""));
    }
    const last = messages[messages.length - 1].ts + 4_000;
    messages.push(pause(PAUSE_IDS.newest, last, reason, summary));
    const gone = reason === "judges-gone";
    return {
        ...view,
        judges: gone ? view.judges.map((j) => ({ ...j, gone: true })) : view.judges,
        state: "stopped",
        stopreason: reason,
        owed: false,
        messagecount: messages.length,
        lastts: last,
        tokens: reason === "token-cap" ? view.tokencap + 12_000 : view.tokens,
        messages,
        canresume: gone ? false : canresume,
    };
}

// ---- page side ----

const q = JSON.stringify;

// the page's dev mock pairs: what the views read instead of wavesrv's answer. null clears them.
export const seedPair = (h, views) =>
    agentPage(
        h,
        `const { devMockPairsAtom } = await mod("app/view/agents/pairstore.ts");
        globalStore.set(devMockPairsAtom, ${q(views)});
        return true;`
    );

// Replaces the page's RpcApi.Pair*Command methods and records each call (its data, as the page passed it). The seeded views
// (devMockPairsAtom) are what the stubs answer from: PairList their infos, PairGet the one named, PairStart the pair whose
// working agent is `workertab`, else the first. PairBrief answers a fixed text. PairResume throws RESUME_ERROR while the
// page's failResume flag is set (setPairResumeFails), and otherwise flips the pair it names to relaying (state, stopreason
// and canresume in the seeded view), as the server does, so the next read of it draws no Resume; the rest answer nothing.
export const stubPairRpc = (h) =>
    agentPage(
        h,
        `const { RpcApi } = await mod("app/store/wshclientapi.ts");
        const { devMockPairsAtom } = await mod("app/view/agents/pairstore.ts");
        const fx = (window.__pairFx ??= {});
        const calls = (fx.calls ??= {});
        const record = (name, data) => (calls[name] ??= []).push(structuredClone(data ?? null));
        const views = () => globalStore.get(devMockPairsAtom) ?? [];
        const info = (v) => ({
            id: v.id, project: v.project, worker: v.worker, judges: v.judges, state: v.state, stopreason: v.stopreason,
            owed: v.owed, messagecount: v.messagecount, lastts: v.lastts,
        });
        RpcApi.PairListCommand = async () => {
            record("PairListCommand", null);
            return structuredClone({ pairs: views().map(info) });
        };
        RpcApi.PairGetCommand = async (_c, d) => {
            record("PairGetCommand", d);
            const v = views().find((p) => p.id === d.pairid);
            if (v == null) throw new Error("no such pair " + d.pairid);
            return structuredClone(v);
        };
        RpcApi.PairBriefCommand = async (_c, d) => {
            record("PairBriefCommand", d);
            return { text: "You judge the work of agent " + d.workertab + ". Read the real code before you conclude." };
        };
        RpcApi.PairStartCommand = async (_c, d) => {
            record("PairStartCommand", d);
            const v = views().find((p) => p.worker.tab === d.workertab) ?? views()[0];
            if (v == null) throw new Error("no pair to start");
            return structuredClone(v);
        };
        RpcApi.PairResumeCommand = async (_c, d) => {
            record("PairResumeCommand", d);
            if (fx.failResume) throw new Error(${q(RESUME_ERROR)});
            globalStore.set(
                devMockPairsAtom,
                views().map((v) => (v.id === d.pairid ? { ...v, state: "relaying", stopreason: "", canresume: false } : v))
            );
        };
        for (const name of ["PairSayCommand", "PairRunNowCommand", "PairUnpairCommand"]) {
            RpcApi[name] = async (_c, d) => {
                record(name, d);
            };
        }
        return true;`
    );

// While `on` is true, the resume stub fails with RESUME_ERROR (the call is still recorded); false makes it work again. Safe
// before or after stubPairRpc; restorePairRpc clears it with the recorded calls.
export const setPairResumeFails = (h, on) =>
    agentPage(
        h,
        `(window.__pairFx ??= {}).failResume = ${q(on === true)};
        return true;`
    );

// the commands go back to the generated client's own, and the recorded calls go
export const restorePairRpc = (h) =>
    agentPage(
        h,
        `const { RpcApi } = await mod("app/store/wshclientapi.ts");
        for (const name of ${q(PAIR_COMMANDS)}) delete RpcApi[name];
        delete window.__pairFx;
        return true;`
    );

// what the page called through the stubs, in order: the calls of one command (an empty list for none), or with no name
// every command that was called, by name
export const pairRpcCalls = (h, name) =>
    agentPage(
        h,
        `const calls = window.__pairFx?.calls ?? {};
        return ${name == null ? "calls" : `calls[${q(name)}] ?? []`};`
    );
