// Two scenarios of Library's Conversations and the judge pairs (docs/superpowers/specs/2026-11-25-ended-pairs-readable-design.md,
// Library; frontend/app/view/library/librarystore.ts, agents/conversationhistory.tsx, agents/pairreadpane.tsx). Over
// pair-fixtures.mjs: no agent runs and wavesrv is never asked about a pair; the pairs go in the page's dev mock pairs
// (devMockPairsAtom), and the Pair*Command methods are stubs. The fixture agents' blocks are not real ones.
//
// library-pair-open: a judge pair that is not live, opened from another surface, reads in Library's Conversations at full width.
// A live pair opened the same way lands on the Agent surface, where it is driven.
//
// Pairs: an ended pair (an answered ask, two Agreed, one Still open, both sides with a session), the same shape synced from
// the other machine, and the live R1 pair of pair-fixtures.mjs. The two reading states (loading, unreadable) clear the mock so
// the stubbed PairGetCommand answers: it never does for one id, and throws "no such pair" for the other.
//
// Steps: pair open read-only, synced pair foot, pair back, live pair opens on Agent, pair loading, pair unreadable.
//
// library-pairs: Conversations' list holds the pairs and councils (agents/conversationhistory.tsx; its rows are
// agents/conversationrows.ts). Sessions come through a stand-in for GetSessionsActivityCommand and transcripts written to a temp
// folder, councils are files in the data dir, pairs the page's dev mock pairs. An ended pair under its worker's session beside a
// council that session started, a relaying pair under another session, a synced pair under a third, a pair with no session id and
// a council with none. Steps: pair nested under its session, relaying pair nested, council nested, loose pair top-level, judge
// chip, council chip, both chips, pair in the detail pane, live pair in the detail pane, transcript link, search finds a council.
// DOM contract: a nested row is [data-history-nested="pair|council"] in [data-history-nested-group] under its card; a pair standing
// alone is a card [data-history-pair="<id>"] ([data-history-pair-line], and in a chip's list [data-history-pair-from]); a council is
// [data-council-history-item="<id>"] ([data-council-history-from] in a chip's list, [data-council-history-act="pin"] on hover); the
// chips are [data-history-chip="judge|council"] (aria-pressed), the benchmark sits in [data-library-bench] over [data-history-list],
// and a search's councils and pairs are under [data-history-items-head].
//
// DOM contract: the view is [data-pair-read="<pair id>"] under Library's Back row [data-library-pair-back]: its header
// [data-pair-read-header] ([data-pair-read-title], [data-pair-read-line]), the thread [data-pair-pane] over [data-pair-msg],
// the Decided column [data-pair-read-decided] > [data-rail-decided] ([data-decided-section], [data-decided-item],
// [data-decided-answer]), the foot [data-pair-read-foot] with [data-pair-read-transcript="<harness>:<session id>"]; while
// reading [data-pair-read-loading], and when the read failed [data-pair-read-error] with a Retry button.
//
// kit is scenarios.mjs's RT_KIT: the waits (polishWaitFor, polishNap) are all these scenarios take of it.

import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import * as AC from "./agent-page-fixtures.mjs";
import { announceCouncil, COUNCIL_ID_PREFIX, seedCouncil, stubRpc, unstubRpc } from "./council/fixtures.mjs";
import { PAIR, pairRoster, pairView, restorePairRpc, seedPair, stubPairRpc } from "./pair-fixtures.mjs";

const NAME = "library-pair-open";
const WAIT_MS = 10_000;
const MIN = 60_000;
const shot = (h, step) => h.shot(`cdp-shots/${NAME}-${step}.png`);
const q = JSON.stringify;

const ENDED = "lpo-ended";
const SYNCED = "lpo-synced";
const LOADING = "lpo-loading";
const UNREADABLE = "lpo-unreadable";
const WORKER_SESSION = "lpo-worker-session";
const JUDGE_SESSION = "lpo-judge-session";
const ANSWER = "50%, go on";
// the Decided column of a read-only pair, top to bottom, as `wsh read`'s Document prints it (section id:heading)
const READ_ONLY_SECTIONS = "agreed:Agreed|asks:Your answers|open:Still open";

const ESCAPE = { key: "Escape", code: "Escape", windowsVirtualKeyCode: 27 };

// R1's pair after it ended: nothing relaying, the held command not heavy, an answered ask, both sides with the session they
// worked in (`worker` and `judge` are session ids; a side given none has none), and the time of its last save in `updatedts`
// (the header reads it)
function endedView(now, { id = ENDED, worker = WORKER_SESSION, judge = JUDGE_SESSION } = {}) {
    const base = pairView(now, { judges: 1 });
    const withSession = (side, session) => {
        const { session: _none, ...rest } = side;
        return session ? { ...rest, session } : rest;
    };
    return {
        ...base,
        id,
        state: "ended",
        stopreason: "settled",
        owed: false,
        holdheavy: false,
        updatedts: now - 40 * MIN,
        worker: withSession(base.worker, worker),
        judges: base.judges.map((j) => withSession(j, judge)),
        decided: { ...base.decided, asks: base.decided.asks.map((a) => ({ ...a, chips: [], answer: ANSWER })) },
    };
}

// the same pair as the other machine's sync left it: its words say so
function syncedView(now) {
    return { ...endedView(now), id: SYNCED, stopreason: "no-new-points", synced: true };
}

export default function (kit) {
    const { polishWaitFor, polishNap } = kit;

    // the app's own modules and model, with Library's store at hand as L
    const page = (h, body) =>
        AC.agentPage(
            h,
            `const L = await mod("app/view/library/librarystore.ts");
            const C = await mod("app/view/agents/agentcenter.ts");
            const model = agentsModel();
            ${body}`
        );
    const openPair = (h, id) => page(h, `L.openPair(model, ${q(id)}); return true;`);
    const libraryState = (h) =>
        page(
            h,
            `return {
                tab: globalStore.get(L.libraryTabAtom),
                conv: globalStore.get(L.libraryConvViewAtom),
                pair: globalStore.get(L.libraryPairSelAtom),
                centre: globalStore.get(C.centerModeAtom),
                centrePair: globalStore.get(C.pairSelAtom),
            };`
        );
    const surface = (h) => h.activeSurfaceLabel();
    const press = async (h, key) => {
        await h.ev("document.activeElement?.blur?.()");
        for (const type of ["keyDown", "keyUp"]) {
            await h.cdp("Input.dispatchKeyEvent", { type, ...key });
        }
        await polishNap(300);
    };

    // the open pair view as a step reads it: its header, thread, Decided column, foot and which controls it must not hold
    const readView = `(() => {
        const flat = (el) => (el?.textContent ?? "").replace(/\\s+/g, " ").trim();
        const root = document.querySelector("[data-library] [data-pair-read]");
        if (!root) return null;
        const decided = root.querySelector("[data-pair-read-decided]");
        const foot = root.querySelector("[data-pair-read-foot]");
        const lib = document.querySelector("[data-library]").getBoundingClientRect().width;
        const has = (sel) => root.querySelector(sel) != null;
        return {
            id: root.getAttribute("data-pair-read"),
            width: Math.round(root.getBoundingClientRect().width),
            libWidth: Math.round(lib),
            list: document.querySelector("[data-agent-history]") != null,
            back: document.querySelector("[data-library-pair-back]") != null,
            title: flat(root.querySelector("[data-pair-read-title]")),
            line: flat(root.querySelector("[data-pair-read-line]")),
            msgs: [...root.querySelectorAll("[data-pair-msg]")].map((m) => m.getAttribute("data-pair-msg")),
            asks: [...(decided?.querySelectorAll('[data-decided-section="asks"] [data-decided-item]') ?? [])].map((el) => ({
                num: el.getAttribute("data-decided-item"),
                answered: el.hasAttribute("data-decided-answered"),
                answer: flat(el.querySelector("[data-decided-answer]")),
            })),
            agreed: decided?.querySelectorAll('[data-decided-section="agreed"] [data-decided-item]').length ?? 0,
            open: decided?.querySelectorAll('[data-decided-section="open"] [data-decided-item]').length ?? 0,
            // each section's id and heading, top to bottom: read-only, Agreed comes first and the asks read Your answers
            sections: [...(decided?.querySelectorAll("[data-decided-section]") ?? [])].map(
                (s) => s.getAttribute("data-decided-section") + ":" + flat(s.firstElementChild)
            ),
            foot: flat(foot?.firstElementChild),
            transcripts: [...(foot?.querySelectorAll("[data-pair-read-transcript]") ?? [])].map((b) => ({ sel: b.getAttribute("data-pair-read-transcript"), label: flat(b) })),
            held: has("[data-pair-held]"),
            controls: ["[data-pair-bar]", "[data-pair-composer]", "[data-pair-send]", "[data-pair-reply]", "[data-pair-run-now]", "[data-pair-unpair]", "[data-pair-ended]", "[data-decided-chip]", "[data-decided-other]"].filter(has),
        };
    })()`;

    return [
        {
            name: NAME,
            surface: "cockpit",
            async arrange(h) {
                const ctx = { now: Date.now() };
                try {
                    await h.goto("cockpit");
                    await AC.setRoster(h, pairRoster(ctx.now));
                    await seedPair(h, [endedView(ctx.now), syncedView(ctx.now), pairView(ctx.now, { judges: 1 })]);
                    await stubPairRpc(h);
                    await page(
                        h,
                        `globalStore.set(L.libraryTabAtom, "conversations");
                        globalStore.set(L.libraryConvViewAtom, "list");
                        globalStore.set(L.libraryPairSelAtom, null);
                        C.showTerminal();
                        globalStore.set(C.pairSelAtom, null);
                        return true;`
                    );
                    ctx.ready = true;
                } catch (e) {
                    ctx.arrangeError = String(e?.message ?? e);
                }
                return ctx;
            },
            async assert(h, ctx) {
                const steps = [];
                const rec = (step, ok, detail) =>
                    steps.push({ step, ok: ok === true, detail: typeof detail === "string" ? detail : JSON.stringify(detail) });
                // a thrown call (the page went away, a CDP timeout) must not discard the steps recorded so far
                try {
                    rec(
                        "0. the roster, an ended pair, a synced pair and a live pair were seeded, and the pair RPCs stubbed",
                        ctx.arrangeError == null && ctx.ready === true,
                        ctx.arrangeError ?? { ready: ctx.ready }
                    );
                    if (ctx.arrangeError != null || ctx.ready !== true) return steps;
                    const ready = (id) =>
                        polishWaitFor(h, `document.querySelector('[data-library] [data-pair-read="${id}"] [data-pair-read-title]') != null`, WAIT_MS);
                    // open pair `id` from the Cockpit, so there is a surface to go back to
                    const openFromCockpit = async (id) => {
                        await h.goto("cockpit");
                        await openPair(h, id);
                        return ready(id);
                    };

                    // 1. pair open read-only: an ended pair opened from the Cockpit reads at Library's full width under a Back row
                    const ok1 = await openFromCockpit(ENDED);
                    await polishWaitFor(h, `document.querySelectorAll("[data-library] [data-pair-msg]").length === 5`, WAIT_MS);
                    await polishNap(300);
                    const ended = await h.ev(readView);
                    const state1 = await libraryState(h);
                    await shot(h, "1-read-only");
                    rec(
                        "pair open read-only: an ended pair opened with openPair from the Cockpit reads at Library's full width under a Back row, with its title and line, the five messages, the Decided column (two Agreed first, then Your answers with the answered ask, then one Still open), the foot line and both transcript links, and no composer, Reply, Run now or Unpair",
                        ok1 &&
                            (await surface(h)) === "Library" &&
                            state1.tab === "conversations" &&
                            state1.conv === "pair" &&
                            state1.pair === ENDED &&
                            ended?.id === ENDED &&
                            ended.back === true &&
                            ended.list === false &&
                            ended.width >= ended.libWidth * 0.95 &&
                            ended.title === "Plan oracle-tightening with judge 4c6ba858" &&
                            /^Ended \d\d\/\d\d \d\d:\d\d · both sides settled · 1\.2M tokens$/.test(ended.line) &&
                            ended.msgs.join() === "pm-opening,pm-three-points,pm-checked,pm-pilot-first,pm-accept" &&
                            ended.asks.length === 1 &&
                            ended.asks[0].answered === true &&
                            ended.asks[0].answer.includes(ANSWER) &&
                            ended.agreed === 2 &&
                            ended.open === 1 &&
                            ended.sections.join("|") === READ_ONLY_SECTIONS &&
                            ended.foot === "This pair is over. Read-only." &&
                            JSON.stringify(ended.transcripts) ===
                                JSON.stringify([
                                    { sel: `claude:${WORKER_SESSION}`, label: "Plan oracle-tightening" },
                                    { sel: `claude:${JUDGE_SESSION}`, label: "Judge 4c6ba858" },
                                ]) &&
                            ended.held === true &&
                            ended.controls.length === 0,
                        { ended, state1 }
                    );

                    // 2. synced pair foot: a pair synced from the other machine reads the same, and its foot and header say so
                    const ok2 = await openFromCockpit(SYNCED);
                    await polishNap(300);
                    const synced = await h.ev(readView);
                    await shot(h, "2-synced");
                    rec(
                        "synced pair foot: a pair synced from the other machine reads read-only the same, its foot line says it was synced from another machine, its header line says it is as of the last sync, and it keeps both transcript links",
                        ok2 &&
                            synced?.id === SYNCED &&
                            synced.foot === "Synced from another machine. Read-only." &&
                            /^Ended \d\d\/\d\d \d\d:\d\d · no new points · as of the last sync · 1\.2M tokens$/.test(synced.line) &&
                            synced.transcripts.length === 2 &&
                            synced.controls.length === 0,
                        { synced }
                    );

                    // 3. pair back: Back and Escape both return to the surface the pair was opened from, and the list is on
                    // Conversations when Library is next shown
                    const backs = [];
                    for (const how of ["click", "escape"]) {
                        await openFromCockpit(ENDED);
                        if (how === "click") {
                            await h.ev(`document.querySelector("[data-library-pair-back]")?.click()`);
                        } else {
                            await press(h, ESCAPE);
                        }
                        const left = await polishWaitFor(h, `document.querySelector("[data-library]") == null`, WAIT_MS);
                        backs.push({ how, left, surface: await surface(h), state: await libraryState(h) });
                    }
                    await h.goto("library");
                    const listBack = await polishWaitFor(
                        h,
                        `document.querySelector("[data-agent-history]") != null && document.querySelector("[data-pair-read]") == null`,
                        WAIT_MS
                    );
                    rec(
                        "pair back: Back and Escape each leave the pair for the Cockpit it was opened from, with Conversations back on its list and no pair selected, and Library shows the list when it is next opened",
                        backs.every(
                            (b) =>
                                b.left &&
                                b.surface === "Cockpit" &&
                                b.state.tab === "conversations" &&
                                b.state.conv === "list" &&
                                b.state.pair === null
                        ) && listBack,
                        { backs, listBack }
                    );

                    // 4. live pair opens on Agent: a pair the live list holds is driven on the Agent surface, not read here
                    await h.goto("cockpit");
                    await openPair(h, PAIR.id);
                    const onAgent = await polishWaitFor(
                        h,
                        `document.querySelector("[data-pair-pane] [data-pair-composer]") != null`,
                        WAIT_MS
                    );
                    const live = await libraryState(h);
                    await shot(h, "4-live");
                    rec(
                        "live pair opens on Agent: a relaying pair opened with openPair lands on the Agent surface's centre in its pair mode with its composer, and Library's pair view is not used",
                        onAgent &&
                            (await surface(h)) === "Agent" &&
                            live.centre === "pair" &&
                            live.centrePair === PAIR.id &&
                            live.conv !== "pair" &&
                            live.pair === null &&
                            (await h.ev(`document.querySelector("[data-pair-read]") == null`)),
                        { live }
                    );
                    await page(h, `C.showTerminal(); globalStore.set(C.pairSelAtom, null); return true;`);

                    // 5. pair loading: a pair nothing mocks is read from wavesrv; while the read has no answer the view says it
                    // is loading. The mock is cleared and the stubbed PairGetCommand never answers; the client is put back after
                    await seedPair(h, null);
                    await stubPairRpc(h);
                    await AC.agentPage(
                        h,
                        `const { RpcApi } = await mod("app/store/wshclientapi.ts");
                        RpcApi.PairGetCommand = () => new Promise(() => {});
                        return true;`
                    );
                    await h.goto("cockpit");
                    await openPair(h, LOADING);
                    const loading = await polishWaitFor(h, `document.querySelector("[data-library] [data-pair-read-loading]") != null`, WAIT_MS);
                    await polishNap(500);
                    const loadingNow = await h.ev(`(() => ({
                        text: (document.querySelector("[data-pair-read-loading]")?.textContent ?? "").trim(),
                        error: document.querySelector("[data-pair-read-error]") != null,
                        thread: document.querySelector("[data-library] [data-pair-pane]") != null,
                    }))()`);
                    await shot(h, "5-loading");
                    await restorePairRpc(h);
                    rec(
                        "pair loading: while the read of a pair has no answer Library's pair view says it is loading the conversation, with no error and no thread",
                        loading &&
                            loadingNow.text === "Loading the conversation…" &&
                            !loadingNow.error &&
                            !loadingNow.thread,
                        { loading, loadingNow }
                    );

                    // 6. pair unreadable: a read that fails is shown, with a way to try again, never left loading. With the mock
                    // clear the stub's own "no such pair" throw is the failure
                    await stubPairRpc(h);
                    await h.goto("cockpit");
                    await openPair(h, UNREADABLE);
                    const failed = await polishWaitFor(h, `document.querySelector("[data-library] [data-pair-read-error]") != null`, WAIT_MS);
                    const failedNow = await h.ev(`(() => {
                        const el = document.querySelector("[data-pair-read-error]");
                        return {
                            text: (el?.textContent ?? "").replace(/\\s+/g, " ").trim(),
                            alert: el?.getAttribute("role") ?? null,
                            retry: [...(el?.querySelectorAll("button") ?? [])].map((b) => b.textContent.trim()),
                            loading: document.querySelector("[data-pair-read-loading]") != null,
                        };
                    })()`);
                    await shot(h, "6-unreadable");
                    await restorePairRpc(h);
                    rec(
                        "pair unreadable: a pair whose read fails shows a message that starts with 'This pair did not read:' and holds the error, as an alert with a Retry button, and no longer says loading",
                        failed &&
                            failedNow.text.startsWith("This pair did not read:") &&
                            failedNow.text.includes(`no such pair ${UNREADABLE}`) &&
                            failedNow.alert === "alert" &&
                            failedNow.retry.join() === "Retry" &&
                            !failedNow.loading,
                        { failed, failedNow }
                    );
                } catch (e) {
                    rec("the scenario stopped early: a page call failed", false, String(e?.message ?? e));
                }
                return steps;
            },
            async teardown(h, ctx) {
                const step = async (what, fn) => {
                    try {
                        await fn();
                    } catch (e) {
                        console.error(`${NAME} teardown: ${what} failed: ${e?.message ?? e}`);
                    }
                };
                await step("restore the pair client", () => restorePairRpc(h));
                await step("clear the seeded pairs", () => seedPair(h, null));
                await step("restore the roster", () => AC.restoreRoster(h));
                await step("reset Library and Agent's centre", () =>
                    page(
                        h,
                        `globalStore.set(L.libraryTabAtom, "conversations");
                        globalStore.set(L.libraryConvViewAtom, "list");
                        globalStore.set(L.libraryPairSelAtom, null);
                        C.showTerminal();
                        globalStore.set(C.pairSelAtom, null);
                        return true;`
                    )
                );
                await step("leave on the Cockpit", () => h.goto("cockpit"));
            },
        },
        libraryPairs(kit),
    ];
}

// ---- library-pairs ----

const LP = "library-pairs";
const HOUR = 60 * MIN;
const DAY = 24 * HOUR;
const lpShot = (h, step) => h.shot(`cdp-shots/${LP}-${step}.png`);

const LP_ENDED = "lp-ended"; // ended, settled: its worker's and its judge's sessions are both listed
const LP_RELAY = "lp-relay"; // relaying, under another session
const LP_LOOSE = "lp-loose"; // ended, no session id on either side
const LP_SYNCED = "lp-synced"; // synced from the other machine, under a third session
const LP_IDS = [LP_RELAY, LP_ENDED, LP_LOOSE, LP_SYNCED]; // newest first
const S_WORKER = "lp-worker";
const S_JUDGE = "lp-judge";
const S_RELAY = "lp-relay-host";
const S_SYNC = "lp-sync-host";
const S_OLD = "lp-old"; // three days back: no pair or council is older than the oldest session the list holds
const TASKS = {
    [S_WORKER]: "lp worker session: tighten the oracle",
    [S_JUDGE]: "lp judge session: judge the oracle plan",
    [S_RELAY]: "lp relay host session",
    [S_SYNC]: "lp sync host session",
    [S_OLD]: "lp old session",
};
const SESSION_AGO = { [S_RELAY]: 10 * MIN, [S_WORKER]: 30 * MIN, [S_JUDGE]: 35 * MIN, [S_SYNC]: 3 * HOUR, [S_OLD]: 3 * DAY };
const SESSION_ANSWER = "library pairs seed answer";
const C_NESTED = `${COUNCIL_ID_PREFIX}lp-nested`;
const C_LOOSE = `${COUNCIL_ID_PREFIX}lp-loose`;
const FROM_COCKPIT = "Started from the cockpit, not a session";
const BENCH_OPEN_KEY = "council.benchOpen";

// two of council-bench-chart's rows (council/figures.mjs): enough scored Review runs for the benchmark to draw
const BENCH_RESULTS = {
    harness: "2026-11-12.1",
    runs: [
        { harness: "2026-11-12.1", mode: "review", variant: "council", runs: 5, scored: 5, recall: 7, keys: 33, wrong: 4, tokens: 7_500_000, recallperm: 0.9333, recall3: 0, judged: 30, recall5: 5, allscored: 5 },
        { harness: "2026-11-05.1", mode: "review", variant: "solo", runs: 5, scored: 5, recall: 13, keys: 33, wrong: 6, tokens: 1_500_000, recallperm: 8.7, recall3: 0, judged: 40, recall5: 9, allscored: 5 },
    ],
    results: [],
    ratings: [],
};

const turn = (type, content) => JSON.stringify({ type, message: { role: type, content } }) + "\n";

// the sessions the scan answers with, newest first, each with a transcript in `dir` whose stem is its id
function sessionsOf(dir, now) {
    const base = {
        runtime: "claude",
        projectpath: dir,
        projectname: "lp-proj",
        branch: "main",
        model: "opus",
        tokenstotal: 1200,
        status: "done",
        durationms: 60_000,
        events: [],
    };
    return Object.keys(TASKS)
        .map((id) => ({
            ...base,
            id,
            task: TASKS[id],
            startedts: now - SESSION_AGO[id] - HOUR,
            lastactivets: now - SESSION_AGO[id],
            resumecommand: `claude --resume ${id}`,
            transcriptpath: join(dir, `${id}.jsonl`),
        }))
        .sort((a, b) => b.lastactivets - a.lastactivets);
}

// the four pairs, newest first (the dev mock keeps its order): R1's relaying pair under S_RELAY, the ended one under S_WORKER
// (its judge under S_JUDGE), one with no session id, and one synced from the other machine under S_SYNC
function pairsOf(now) {
    const base = pairView(now, { judges: 1 });
    const relaying = { ...base, id: LP_RELAY, updatedts: now - 5 * MIN, worker: { ...base.worker, session: S_RELAY } };
    const ended = endedView(now, { id: LP_ENDED, worker: S_WORKER, judge: S_JUDGE });
    const loose = endedView(now, { id: LP_LOOSE, worker: null, judge: null });
    loose.stopreason = "token-cap";
    loose.updatedts = now - 90 * MIN;
    loose.worker = { ...loose.worker, name: "Loose pair worker" };
    const synced = endedView(now, { id: LP_SYNCED, worker: S_SYNC, judge: null });
    synced.stopreason = "no-new-points";
    synced.synced = true;
    synced.updatedts = now - 2 * HOUR;
    return [relaying, ended, loose, synced];
}

// text with its whitespace folded, as the page's expressions read an element
const FLAT = `const flat = (el) => (el?.textContent ?? "").replace(/\\s+/g, " ").trim();`;

function libraryPairs(kit) {
    const { polishWaitFor, polishNap } = kit;
    const wait = (h, expr, ms = WAIT_MS) => polishWaitFor(h, expr, ms);
    const click = (h, sel) =>
        h.ev(`(() => { const el = document.querySelector(${q(sel)}); if (el == null) return false; el.click(); return true; })()`);
    // the app's own modules and model, with Library's store at hand as L
    const page = (h, body) =>
        AC.agentPage(
            h,
            `const L = await mod("app/view/library/librarystore.ts");
            const model = agentsModel();
            ${body}`
        );
    const resetLibrary = (h) =>
        page(
            h,
            `globalStore.set(L.libraryTabAtom, "conversations");
            globalStore.set(L.libraryConvViewAtom, "list");
            globalStore.set(L.libraryConvKindsAtom, { judge: false, council: false });
            globalStore.set(L.libraryPairSelAtom, null);
            globalStore.set(model.sessionsSelAtom, "all");
            globalStore.set(model.sessionsStatusFilterAtom, "all");
            return true;`
        );
    const chips = (h) =>
        h.ev(
            `(() => Object.fromEntries([...document.querySelectorAll("[data-history-chip]")].map((c) => [c.getAttribute("data-history-chip"), c.getAttribute("aria-pressed")])))()`
        );
    // the chip `kind` set to `on`, by a click when it is not that already
    const setChip = async (h, kind, on) => {
        const now = (await chips(h))[kind];
        if (now !== String(on)) await click(h, `[data-history-chip="${kind}"]`);
        await polishNap(300);
    };
    const showList = async (h) => {
        await h.goto("library");
        await resetLibrary(h);
        return wait(h, `document.querySelector('[data-history-item="pair:${LP_ENDED}"]') != null`);
    };
    // what a nested row, or the card of a pair or council standing alone, sits under: its entry's card, and the kinds of row
    // that card carries
    const placed = (sel) => `(() => {
        ${FLAT}
        const el = document.querySelector(${q(sel)});
        if (el == null) return null;
        const group = el.closest("[data-history-nested-group]");
        return {
            text: flat(el),
            nested: group != null,
            card: group != null ? flat(group.previousElementSibling) : null,
            kinds: [...(group?.querySelectorAll("[data-history-nested]") ?? [])].map((n) => n.getAttribute("data-history-nested")),
        };
    })()`;
    // the list as a chip leaves it: which of the scenario's pairs and councils it draws, in order, and the session each names
    const flatList = `(() => {
        ${FLAT}
        const list = document.querySelector("[data-history-list]");
        const pairs = [...(list?.querySelectorAll("[data-history-pair]") ?? [])].map((c) => ({
            id: c.getAttribute("data-history-pair"),
            title: flat(c.querySelector("[data-history-pair-title]")),
            line: flat(c.querySelector("[data-history-pair-line]")),
            from: flat(c.querySelector("[data-history-pair-from]")),
        }));
        const councils = [...(list?.querySelectorAll("[data-council-history-item]") ?? [])].map((c) => ({
            id: c.getAttribute("data-council-history-item"),
            from: flat(c.querySelector("[data-council-history-from]")),
        }));
        return {
            pairs: pairs.filter((p) => ${q(LP_IDS)}.includes(p.id)),
            councils: councils.filter((c) => [${q(C_NESTED)}, ${q(C_LOOSE)}].includes(c.id)),
            nested: list?.querySelectorAll("[data-history-nested]").length ?? 0,
            status: document.querySelector('[data-agent-history] [aria-label="Status filter"]') != null,
            kinds: Object.fromEntries([...document.querySelectorAll("[data-history-chip]")].map((c) => [c.getAttribute("data-history-chip"), c.getAttribute("aria-pressed")])),
            bench: document.querySelector("[data-library-bench] [data-council-figure='bench']") != null,
            benchOver: document.querySelector("[data-library-bench] ~ [data-history-list]") != null,
            benchFolded: document.querySelector("[data-library-bench] [data-bench-toggle]")?.getAttribute("aria-expanded") === "false",
        };
    })()`;
    // the pair in the detail pane: its header, thread, Decided column, foot and which controls it must not hold
    const paneView = `(() => {
        ${FLAT}
        const root = document.querySelector("[data-history-detail] [data-pair-read]");
        if (!root) return null;
        const decided = root.querySelector("[data-pair-read-decided]");
        const foot = root.querySelector("[data-pair-read-foot]");
        const has = (sel) => root.querySelector(sel) != null;
        const id = root.getAttribute("data-pair-read");
        return {
            id,
            width: Math.round(root.getBoundingClientRect().width),
            decidedWidth: Math.round(decided?.getBoundingClientRect().width ?? 0),
            list: document.querySelector("[data-history-list]") != null,
            back: document.querySelector("[data-library-pair-back]") != null,
            selected: document.querySelector('[data-history-item="pair:' + id + '"]')?.getAttribute("aria-current") ?? null,
            title: flat(root.querySelector("[data-pair-read-title]")),
            line: flat(root.querySelector("[data-pair-read-line]")),
            msgs: [...root.querySelectorAll("[data-pair-msg]")].map((m) => m.getAttribute("data-pair-msg")),
            asks: [...(decided?.querySelectorAll('[data-decided-section="asks"] [data-decided-item]') ?? [])].map((el) => ({
                answered: el.hasAttribute("data-decided-answered"),
                answer: flat(el.querySelector("[data-decided-answer]")),
            })),
            agreed: decided?.querySelectorAll('[data-decided-section="agreed"] [data-decided-item]').length ?? 0,
            open: decided?.querySelectorAll('[data-decided-section="open"] [data-decided-item]').length ?? 0,
            // each section's id and heading, top to bottom: read-only, Agreed comes first and the asks read Your answers
            sections: [...(decided?.querySelectorAll("[data-decided-section]") ?? [])].map(
                (s) => s.getAttribute("data-decided-section") + ":" + flat(s.firstElementChild)
            ),
            foot: flat(foot?.firstElementChild),
            transcripts: [...(foot?.querySelectorAll("[data-pair-read-transcript]") ?? [])].map((b) => ({ sel: b.getAttribute("data-pair-read-transcript"), label: flat(b) })),
            controls: ["[data-pair-bar]", "[data-pair-composer]", "[data-pair-send]", "[data-pair-reply]", "[data-pair-run-now]", "[data-pair-unpair]", "[data-pair-ended]", "[data-decided-chip]", "[data-decided-other]"].filter(has),
        };
    })()`;
    // a real pointer over the element (the row's hover buttons show on hover), scrolled into the middle of the list first
    const centerOf = (sel) => `(() => {
        const el = document.querySelector(${q(sel)});
        if (el == null) return null;
        const r = el.getBoundingClientRect();
        return r.width > 0 && r.height > 0 ? { x: Math.round(r.x + r.width / 2), y: Math.round(r.y + r.height / 2) } : null;
    })()`;
    const hoverOver = async (h, sel) => {
        await h.ev(`document.querySelector(${q(sel)})?.scrollIntoView({ block: "center", inline: "nearest" })`);
        await polishNap(150);
        const at = await h.ev(centerOf(sel));
        if (at == null) return false;
        await h.cdp("Input.dispatchMouseEvent", { type: "mouseMoved", x: at.x, y: at.y });
        return true;
    };
    // the box takes the text through the input pipeline, so React sees the change
    const typeQuery = async (h, text) => {
        await h.ev(`(() => { const el = document.querySelector("[data-history-search]"); el.focus(); el.select(); return true; })()`);
        await h.cdp("Input.insertText", { text });
    };
    // Escape in the box empties it, and the nested list comes back
    const clearQuery = async (h) => {
        await h.ev(`document.querySelector("[data-history-search]")?.focus()`);
        for (const type of ["keyDown", "keyUp"]) {
            await h.cdp("Input.dispatchKeyEvent", { type, key: "Escape", code: "Escape", windowsVirtualKeyCode: 27 });
        }
        await polishNap(300);
    };

    return {
        name: LP,
        surface: "cockpit",
        async arrange(h) {
            const ctx = { now: Date.now() };
            try {
                ctx.dir = mkdtempSync(join(tmpdir(), "verify-library-pairs-"));
                ctx.dataDir = (await h.rpc("waveinfo", null)).datadir;
                // the councils are written with the transcripts' folder as their project: no registered project holds them
                ctx.repo = ctx.dir;
                ctx.written = {};
                for (const [id, task] of Object.entries(TASKS)) {
                    writeFileSync(
                        join(ctx.dir, `${id}.jsonl`),
                        turn("user", task) + turn("assistant", [{ type: "text", text: `${SESSION_ANSWER} ${id}` }])
                    );
                }
                ctx.sessions = sessionsOf(ctx.dir, ctx.now);
                await h.goto("cockpit");
                await seedPair(h, pairsOf(ctx.now));
                await stubPairRpc(h);
                await stubRpc(h, ["GetSessionsActivityCommand", "CouncilBenchResultsCommand"], {
                    GetSessionsActivityCommand: { value: { sessions: ctx.sessions } },
                    CouncilBenchResultsCommand: { value: BENCH_RESULTS },
                });
                // the council the worker's session started, and one no session started
                await seedCouncil(h, ctx, "done", {
                    id: C_NESTED,
                    now: ctx.now - 15 * MIN,
                    edit: (c) => {
                        c.sessionid = S_WORKER;
                        c.feature = "LP nested council";
                    },
                });
                await seedCouncil(h, ctx, "done", {
                    id: C_LOOSE,
                    now: ctx.now - 45 * MIN,
                    edit: (c) => {
                        delete c.sessionid;
                        c.feature = "LP loose council";
                    },
                });
                // the benchmark starts folded, as it does for a person who never opened it
                await h.ev(`(() => { try { window.localStorage.removeItem(${q(BENCH_OPEN_KEY)}); } catch {} })()`);
                await resetLibrary(h);
                ctx.ready = true;
            } catch (e) {
                ctx.arrangeError = String(e?.message ?? e);
            }
            return ctx;
        },
        async assert(h, ctx) {
            const steps = [];
            const rec = (step, ok, detail) =>
                steps.push({ step, ok: ok === true, detail: typeof detail === "string" ? detail : JSON.stringify(detail) });
            // a thrown call (the page went away, a CDP timeout) must not discard the steps recorded so far
            try {
                rec(
                    "0. the sessions with their transcripts, two councils and four pairs (ended, relaying, with no session, synced) were seeded",
                    ctx.arrangeError == null && ctx.ready === true,
                    ctx.arrangeError ?? { ready: ctx.ready }
                );
                if (ctx.arrangeError != null || ctx.ready !== true) return steps;

                // 1. pair nested under its session: the ended pair is a `└` line under the card of its worker's session
                const listed = await showList(h);
                await wait(h, `document.querySelector('[data-history-nested="council"]') != null`);
                await polishNap(400);
                const ended = await h.ev(placed(`[data-history-item="pair:${LP_ENDED}"]`));
                await lpShot(h, "1-nested");
                rec(
                    "pair nested under its session: the ended pair is one tree line, `└ Pair with judge 4c6ba858 · both sides settled`, in the group under the card of its worker's session, not a card of its own",
                    listed &&
                        ended?.nested === true &&
                        ended.text.startsWith("└") &&
                        ended.text.endsWith("Pair with judge 4c6ba858 · both sides settled") &&
                        ended.card.includes(TASKS[S_WORKER]) &&
                        ended.kinds.includes("pair") &&
                        (await h.ev(`document.querySelector('[data-history-pair="${LP_ENDED}"]') == null`)),
                    { listed, ended }
                );

                // 2. relaying pair nested: a pair still relaying reads so, under its own session; the synced one under its
                // session says it is as of the last sync
                const relay = await h.ev(placed(`[data-history-item="pair:${LP_RELAY}"]`));
                const synced = await h.ev(placed(`[data-history-item="pair:${LP_SYNCED}"]`));
                rec(
                    "relaying pair nested: a pair still relaying is a tree line under the card of its worker's session that says `still relaying`, and the synced pair is one under its own session that says `as of the last sync`",
                    relay?.nested === true &&
                        relay.text.endsWith("Pair with judge 4c6ba858 · still relaying") &&
                        relay.card.includes(TASKS[S_RELAY]) &&
                        synced?.nested === true &&
                        synced.text.endsWith("Pair with judge 4c6ba858 · no new points · as of the last sync") &&
                        synced.card.includes(TASKS[S_SYNC]),
                    { relay, synced }
                );

                // 3. council nested: the council the worker's session started is a tree line under the same card, beside its pair
                const council = await h.ev(placed(`[data-history-nested="council"][data-council-history-item="${C_NESTED}"]`));
                rec(
                    "council nested: the council that session started is one tree line, `└ Council: LP nested council`, under the same card as its pair",
                    council?.nested === true &&
                        council.text === "└Council: LP nested council" &&
                        council.card.includes(TASKS[S_WORKER]) &&
                        council.kinds.includes("pair") &&
                        council.kinds.includes("council") &&
                        council.card === ended?.card,
                    { council, ended: ended?.card }
                );

                // 4. loose pair top-level: a pair with no session id, and a council with none, are cards of their own
                const loosePair = await h.ev(placed(`[data-history-pair="${LP_LOOSE}"]`));
                const looseCouncil = await h.ev(placed(`[data-council-history-item="${C_LOOSE}"]`));
                rec(
                    "loose pair top-level: a pair with no session id is a card of its own (its worker's name, then `Judge 4c6ba858 · token cap reached`) outside every nested group, and so is the council no session started",
                    loosePair?.nested === false &&
                        loosePair.text.includes("Loose pair worker") &&
                        loosePair.text.includes("Judge 4c6ba858 · token cap reached") &&
                        looseCouncil?.nested === false &&
                        looseCouncil.text.includes("LP loose council"),
                    { loosePair, looseCouncil }
                );

                // 5. judge chip: the Judge chip alone shows the pairs flat, newest first, each naming the session that started
                // it, and the status filter is not there
                await setChip(h, "judge", true);
                await wait(h, `document.querySelector('[data-history-list] [data-history-pair="${LP_RELAY}"]') != null`);
                await polishNap(400);
                const judge = await h.ev(flatList);
                await lpShot(h, "5-judge-chip");
                const judgePair = (id) => judge.pairs.find((p) => p.id === id);
                rec(
                    "judge chip: the Judge chip alone is pressed and the list is the four pairs flat, newest first, each naming its session (the synced one as of the last sync, the one with no session `Started from the cockpit, not a session`), with no nested row, no councils, no benchmark and no status filter",
                    JSON.stringify(judge.pairs.map((p) => p.id)) === JSON.stringify(LP_IDS) &&
                        judgePair(LP_ENDED)?.from === TASKS[S_WORKER] &&
                        judgePair(LP_RELAY)?.from === TASKS[S_RELAY] &&
                        judgePair(LP_SYNCED)?.from === TASKS[S_SYNC] &&
                        judgePair(LP_LOOSE)?.from === FROM_COCKPIT &&
                        judgePair(LP_ENDED)?.title === "Plan oracle-tightening" &&
                        judgePair(LP_ENDED)?.line === "Judge 4c6ba858 · both sides settled" &&
                        judgePair(LP_SYNCED)?.line === "Judge 4c6ba858 · no new points · as of the last sync" &&
                        judge.councils.length === 0 &&
                        judge.nested === 0 &&
                        judge.status === false &&
                        judge.kinds.judge === "true" &&
                        judge.kinds.council === "false" &&
                        judge.bench === false,
                    judge
                );

                // 6. council chip: the Council chip alone shows the councils flat, the benchmark folded over them, each council
                // naming its session, and a pin button on hover
                await setChip(h, "judge", false);
                await setChip(h, "council", true);
                await wait(h, `document.querySelector('[data-history-list] [data-council-history-item="${C_NESTED}"]') != null`);
                await wait(h, `document.querySelector("[data-library-bench] [data-council-figure='bench']") != null`);
                await polishNap(400);
                const councils = await h.ev(flatList);
                const hovered = await hoverOver(h, `[data-council-history-item="${C_LOOSE}"] [data-council-history-row]`);
                const pin = await wait(
                    h,
                    `(() => {
                        const el = document.querySelector('[data-council-history-item="${C_LOOSE}"] [data-council-history-act="pin"]');
                        return el != null && getComputedStyle(el.parentElement).opacity === "1";
                    })()`
                );
                await lpShot(h, "6-council-chip");
                const councilFrom = (id) => councils.councils.find((c) => c.id === id)?.from;
                rec(
                    "council chip: the Council chip alone is pressed and the list is the councils flat, each naming its session (`Started from the cockpit, not a session` for the loose one), with the benchmark folded to one line in the box over the list, no pair, no nested row and no status filter, and a Pin button on a row under the pointer",
                    JSON.stringify(councils.councils.map((c) => c.id).sort()) === JSON.stringify([C_LOOSE, C_NESTED].sort()) &&
                        councilFrom(C_NESTED) === TASKS[S_WORKER] &&
                        councilFrom(C_LOOSE) === FROM_COCKPIT &&
                        councils.pairs.length === 0 &&
                        councils.nested === 0 &&
                        councils.status === false &&
                        councils.kinds.council === "true" &&
                        councils.kinds.judge === "false" &&
                        councils.bench === true &&
                        councils.benchOver === true &&
                        councils.benchFolded === true &&
                        hovered &&
                        pin,
                    { councils, hovered, pin }
                );

                // 7. both chips: both kinds in one flat list, still no nesting
                await setChip(h, "judge", true);
                await wait(h, `document.querySelector('[data-history-list] [data-history-pair="${LP_RELAY}"]') != null`);
                await polishNap(400);
                const both = await h.ev(flatList);
                await lpShot(h, "7-both-chips");
                rec(
                    "both chips: with Judge and Council both pressed the list holds the four pairs and the two councils, none nested, with the benchmark over it and no status filter",
                    both.kinds.judge === "true" &&
                        both.kinds.council === "true" &&
                        both.pairs.length === 4 &&
                        both.councils.length === 2 &&
                        both.nested === 0 &&
                        both.status === false &&
                        both.bench === true,
                    both
                );

                // 8. pair in the detail pane: with the chips off the nested list is back, and a click on the ended pair's line
                // reads it beside the list, read-only
                await setChip(h, "judge", false);
                await setChip(h, "council", false);
                const nestedBack = await wait(h, `document.querySelector('[data-history-item="pair:${LP_ENDED}"]') != null`);
                const filterBack = await h.ev(`document.querySelector('[data-agent-history] [aria-label="Status filter"]') != null`);
                await click(h, `[data-history-item="pair:${LP_ENDED}"]`);
                const open = await wait(
                    h,
                    `document.querySelector('[data-history-detail] [data-pair-read="${LP_ENDED}"] [data-pair-read-title]') != null`
                );
                await wait(h, `document.querySelectorAll("[data-history-detail] [data-pair-msg]").length === 5`);
                await polishNap(400);
                const pane = await h.ev(paneView);
                await lpShot(h, "8-pair-pane");
                rec(
                    "pair in the detail pane: with the chips off the nested list is back with its status filter, and a click on the ended pair's line reads it beside the list, read-only, the line marked as the open one: its header (title and line), the five messages, the Decided column (two Agreed first, then Your answers with the answered ask, then one Still open) at the rail's width, the foot line and both transcript links, and no composer, Reply, Run now or Unpair and no Back row",
                    nestedBack &&
                        filterBack &&
                        open &&
                        pane?.id === LP_ENDED &&
                        pane.list === true &&
                        pane.back === false &&
                        pane.selected === "true" &&
                        pane.width >= 500 &&
                        pane.decidedWidth === 300 &&
                        pane.title === "Plan oracle-tightening with judge 4c6ba858" &&
                        /^Ended \d\d\/\d\d \d\d:\d\d · both sides settled · 1\.2M tokens$/.test(pane.line) &&
                        pane.msgs.join() === "pm-opening,pm-three-points,pm-checked,pm-pilot-first,pm-accept" &&
                        pane.asks.length === 1 &&
                        pane.asks[0].answered === true &&
                        pane.asks[0].answer.includes(ANSWER) &&
                        pane.agreed === 2 &&
                        pane.open === 1 &&
                        pane.sections.join("|") === READ_ONLY_SECTIONS &&
                        pane.foot === "This pair is over. Read-only." &&
                        JSON.stringify(pane.transcripts) ===
                            JSON.stringify([
                                { sel: `claude:${S_WORKER}`, label: "Plan oracle-tightening" },
                                { sel: `claude:${S_JUDGE}`, label: "Judge 4c6ba858" },
                            ]) &&
                        pane.controls.length === 0,
                    { nestedBack, filterBack, open, pane }
                );

                // 9. live pair in the detail pane: the relaying pair reads the same, and its foot says it relays on Agent
                await click(h, `[data-history-item="pair:${LP_RELAY}"]`);
                const openLive = await wait(
                    h,
                    `document.querySelector('[data-history-detail] [data-pair-read="${LP_RELAY}"] [data-pair-read-title]') != null`
                );
                await wait(h, `document.querySelectorAll("[data-history-detail] [data-pair-msg]").length === 5`);
                await polishNap(400);
                const live = await h.ev(paneView);
                await lpShot(h, "9-live-pair-pane");
                rec(
                    "live pair in the detail pane: a click on the relaying pair's line reads it read-only the same, its header line begins `Relaying since`, its foot says `Read-only here; it relays on the Agent surface.`, only its worker has a transcript link, and there is no composer, Reply, Run now or Unpair",
                    openLive &&
                        live?.id === LP_RELAY &&
                        live.selected === "true" &&
                        /^Relaying since \d\d\/\d\d \d\d:\d\d · still relaying · 1\.2M tokens$/.test(live.line) &&
                        live.foot === "Read-only here; it relays on the Agent surface." &&
                        JSON.stringify(live.transcripts) ===
                            JSON.stringify([{ sel: `claude:${S_RELAY}`, label: "Plan oracle-tightening" }]) &&
                        live.controls.length === 0,
                    { openLive, live }
                );

                // 10. transcript link: a link in the foot selects that session in the list, and the pair gives way to it
                await click(h, `[data-history-item="pair:${LP_ENDED}"]`);
                await wait(
                    h,
                    `document.querySelector('[data-history-detail] [data-pair-read="${LP_ENDED}"] [data-pair-read-transcript]') != null`
                );
                const linked = await click(h, `[data-history-detail] [data-pair-read-transcript="claude:${S_WORKER}"]`);
                const left = await wait(h, `document.querySelector("[data-history-detail] [data-pair-read]") == null`);
                await polishNap(400);
                const after = await h.ev(`(() => {
                    ${FLAT}
                    return {
                        selectedCard: flat(document.querySelector("[data-history-list] .bg-surface-selected")),
                        pairMarked: document.querySelector("[data-history-list] [aria-current]") != null,
                        detail: flat(document.querySelector("[data-history-detail]")).slice(0, 200),
                    };
                })()`);
                const sel = await page(h, `return globalStore.get(model.sessionsSelAtom);`);
                await lpShot(h, "10-transcript-link");
                rec(
                    "transcript link: the worker's link in the foot selects that session, so the list marks its card and no line of a pair, and the detail pane no longer shows the pair",
                    linked &&
                        left &&
                        sel === `claude:${S_WORKER}` &&
                        after.selectedCard.includes(TASKS[S_WORKER]) &&
                        after.pairMarked === false,
                    { linked, left, sel, after }
                );

                // 11. search finds a council: a query for a council's feature lists it above the sessions' results under
                // "Councils and pairs", and one for a pair's worker lists that pair
                await typeQuery(h, "LP nested");
                const foundCouncil = await wait(
                    h,
                    `document.querySelector("[data-history-items-head]") != null && document.querySelector('[data-history-list] [data-council-history-item="${C_NESTED}"]') != null`
                );
                await polishNap(400);
                const head = await h.ev(`(() => { ${FLAT} return flat(document.querySelector("[data-history-items-head]")); })()`);
                const councilHits = await h.ev(
                    `[...document.querySelectorAll("[data-history-list] [data-council-history-item]")].map((c) => c.getAttribute("data-council-history-item"))`
                );
                await lpShot(h, "11-search");
                await clearQuery(h);
                await typeQuery(h, "Loose pair worker");
                const foundPair = await wait(h, `document.querySelector('[data-history-list] [data-history-pair="${LP_LOOSE}"]') != null`);
                const pairHits = await h.ev(
                    `[...document.querySelectorAll("[data-history-list] [data-history-pair]")].map((c) => c.getAttribute("data-history-pair"))`
                );
                await clearQuery(h);
                const restored = await wait(
                    h,
                    `document.querySelector('[data-history-item="pair:${LP_ENDED}"]') != null && document.querySelector("[data-history-items-head]") == null`
                );
                rec(
                    "search finds a council: a query for a council's feature lists that council under a `Councils and pairs` head, a query for a pair's worker lists that pair, and clearing the box brings the nested list back",
                    foundCouncil &&
                        /^Councils and pairs/.test(head) &&
                        councilHits.includes(C_NESTED) &&
                        !councilHits.includes(C_LOOSE) &&
                        foundPair &&
                        pairHits.includes(LP_LOOSE) &&
                        !pairHits.includes(LP_ENDED) &&
                        restored,
                    { foundCouncil, head, councilHits, foundPair, pairHits, restored }
                );
            } catch (e) {
                rec("the scenario stopped early: a page call failed", false, String(e?.message ?? e));
            }
            return steps;
        },
        async teardown(h, ctx) {
            const step = async (what, fn) => {
                try {
                    await fn();
                } catch (e) {
                    console.error(`${LP} teardown: ${what} failed: ${e?.message ?? e}`);
                }
            };
            await step("restore the stand-in commands", () => unstubRpc(h));
            await step("restore the pair client", () => restorePairRpc(h));
            await step("clear the seeded pairs", () => seedPair(h, null));
            await step("remove the councils", async () => {
                for (const id of Object.keys(ctx.written ?? {})) {
                    rmSync(join(ctx.dataDir, "councils", `${id}.json`), { force: true, maxRetries: 5, retryDelay: 200 });
                    await announceCouncil(h, ctx, id);
                }
            });
            await step("clear the benchmark's open mark", () =>
                h.ev(`(() => { try { window.localStorage.removeItem(${q(BENCH_OPEN_KEY)}); } catch {} })()`)
            );
            await step("reset Library", () => resetLibrary(h));
            await step("remove the temp dir", async () => {
                if (ctx.dir) rmSync(ctx.dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
            });
            await step("leave on the Cockpit", () => h.goto("cockpit"));
        },
    };
}
