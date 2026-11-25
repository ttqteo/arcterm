// library-pair-open: a judge pair that is not live, opened from another surface, reads in Library's Conversations at full width
// (docs/superpowers/specs/2026-11-25-ended-pairs-readable-design.md, Library; frontend/app/view/library/librarystore.ts
// openPair / showLibraryPair, agents/pairreadpane.tsx). A live pair opened the same way lands on the Agent surface, where it is
// driven. Over pair-fixtures.mjs: no agent runs and wavesrv is never asked about a pair; the pairs go in the page's dev mock
// pairs (devMockPairsAtom), and the Pair*Command methods are stubs. The fixture agents' blocks are not real ones.
//
// Pairs: an ended pair (an answered ask, two Agreed, one Still open, both sides with a session), the same shape synced from
// the other machine, and the live R1 pair of pair-fixtures.mjs. The two reading states (loading, unreadable) clear the mock so
// the stubbed PairGetCommand answers: it never does for one id, and throws "no such pair" for the other.
//
// Steps: pair open read-only, synced pair foot, pair back, live pair opens on Agent, pair loading, pair unreadable.
//
// DOM contract: the view is [data-pair-read="<pair id>"] under Library's Back row [data-library-pair-back]: its header
// [data-pair-read-header] ([data-pair-read-title], [data-pair-read-line]), the thread [data-pair-pane] over [data-pair-msg],
// the Decided column [data-pair-read-decided] > [data-rail-decided] ([data-decided-section], [data-decided-item],
// [data-decided-answer]), the foot [data-pair-read-foot] with [data-pair-read-transcript="<harness>:<session id>"]; while
// reading [data-pair-read-loading], and when the read failed [data-pair-read-error] with a Retry button.
//
// kit is scenarios.mjs's LIBRARY_KIT.

import * as AC from "./agent-page-fixtures.mjs";
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

const ESCAPE = { key: "Escape", code: "Escape", windowsVirtualKeyCode: 27 };

// R1's pair after it ended: nothing relaying, the held command not heavy, an answered ask, both sides with the session they
// worked in, and the time of its last save in `updatedts` (the header reads it)
function endedView(now) {
    const base = pairView(now, { judges: 1 });
    return {
        ...base,
        id: ENDED,
        state: "ended",
        stopreason: "settled",
        owed: false,
        holdheavy: false,
        updatedts: now - 40 * MIN,
        worker: { ...base.worker, session: WORKER_SESSION },
        judges: base.judges.map((j) => ({ ...j, session: JUDGE_SESSION })),
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
                        "pair open read-only: an ended pair opened with openPair from the Cockpit reads at Library's full width under a Back row, with its title and line, the five messages, the Decided column (the answered ask, two Agreed, one Still open), the foot line and both transcript links, and no composer, Reply, Run now or Unpair",
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
    ];
}
