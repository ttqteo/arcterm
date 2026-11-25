// pair-decided: board R1's rail, the Decided tab (docs/superpowers/specs/2026-11-25-agent-pair-judge-design.md;
// frontend/app/view/agents/raildecidedpane.tsx, raildecided.ts, agentrailtabs.ts). Over pair-fixtures.mjs: the roster goes in
// the page's dev mock roster, the pair in its dev mock pairs, and the seven RpcApi.Pair*Command methods are stubs that record
// their calls, so no agent runs and wavesrv is never asked about a pair. The fixture agents' blocks are not real ones; the
// rail never reads them.
//
// Steps: decided-tab (the tab beside Overview and Changes with its amber dot, the three sections as R1's rail, the same for
// the judge), answer-chip (a chip press sends PairSayCommand with the item to both; "other…" opens the conversation),
// agreed-link (an agreed item opens the `pair` centre mode and sets pairScrollToAtom to its message; the scroll itself is
// the conversation's), no-asks (nothing waiting on the person, or only answered items: no dot), unpaired (an agent in no pair
// has no Decided tab).
//
// DOM contract: the rail is aside[aria-label="Agent details"]; its tabs [data-rail-tab="…"] with [data-rail-tab-dot]; the pane
// [data-rail-decided="<pair id>"] (or [data-rail-decided-state="reading"]) over sections [data-decided-section="asks|agreed|open"]
// holding items [data-decided-item="<n>"] ([data-decided-answered], [data-decided-answer], [data-decided-chip="<chip>"],
// [data-decided-other], [data-decided-link="<message id>"], [data-decided-reason]).
//
// kit is scenarios.mjs's RT_KIT.

import * as AC from "./agent-page-fixtures.mjs";
import { PAIR, pairRoster, pairRpcCalls, pairView, restorePairRpc, seedPair, stubPairRpc } from "./pair-fixtures.mjs";

const NAME = "pair-decided";
const WAIT_MS = 8_000;
const shot = (h, step) => h.shot(`cdp-shots/${NAME}-${step}.png`);

const ASIDE = `document.querySelector('aside[aria-label="Agent details"]')`;
const TAB = `${ASIDE}?.querySelector('[data-rail-tab="decided"]')`;
const PANE = `${ASIDE}?.querySelector("[data-rail-decided]")`;

// the rail as the steps read it: its tabs in order, the Decided tab's dot, the width, and the pane's three sections
const readRail = `(() => {
    const aside = ${ASIDE};
    if (!aside) return null;
    const flat = (el) => (el?.textContent ?? "").replace(/\\s+/g, " ").trim();
    const tab = aside.querySelector('[data-rail-tab="decided"]');
    const pane = aside.querySelector("[data-rail-decided]");
    const items = (id) => [...(pane?.querySelector('[data-decided-section="' + id + '"]')?.querySelectorAll("[data-decided-item]") ?? [])];
    return {
        tabs: [...aside.querySelectorAll('[role="tab"][data-rail-tab]')].map((t) => t.dataset.railTab),
        shown: aside.querySelector('[role="tab"][aria-selected="true"]')?.dataset.railTab ?? null,
        width: Math.round(aside.getBoundingClientRect().width),
        tab: tab ? { label: tab.getAttribute("aria-label"), dot: tab.querySelector("[data-rail-tab-dot]")?.classList.contains("bg-asking") ?? false, anyDot: !!tab.querySelector("[data-rail-tab-dot]") } : null,
        pairId: pane?.getAttribute("data-rail-decided") ?? null,
        sections: [...(pane?.querySelectorAll("[data-decided-section]") ?? [])].map((s) => ({ id: s.dataset.decidedSection, label: flat(s.firstElementChild), empty: !s.querySelector("[data-decided-item]") ? flat(s.lastElementChild) : null })),
        asks: items("asks").map((el) => ({
            num: el.dataset.decidedItem,
            text: flat(el.children[0]),
            note: flat(el.children[1]),
            chips: [...el.querySelectorAll("[data-decided-chip]")].map(flat),
            other: !!el.querySelector("[data-decided-other]"),
            answer: el.querySelector("[data-decided-answer]") ? flat(el.querySelector("[data-decided-answer]")) : null,
        })),
        agreed: items("agreed").map((el) => ({ num: el.dataset.decidedItem, text: flat(el), link: el.querySelector("[data-decided-link]")?.dataset.decidedLink ?? null, linkText: flat(el.querySelector("[data-decided-link]")) })),
        open: items("open").map((el) => ({ text: flat(el), reason: el.querySelector("[data-decided-reason]") ? flat(el.querySelector("[data-decided-reason]")) : null })),
    };
})()`;

// a real click at the element's centre
async function mouse(h, selector) {
    const at = await h.ev(`(() => {
        const r = document.querySelector(${JSON.stringify(selector)})?.getBoundingClientRect();
        return r ? { x: r.left + r.width / 2, y: r.top + r.height / 2 } : null;
    })()`);
    if (at == null) return false;
    for (const type of ["mousePressed", "mouseReleased"]) {
        await h.cdp("Input.dispatchMouseEvent", { type, x: at.x, y: at.y, button: "left", clickCount: 1 });
    }
    return true;
}
const ASIDE_SEL = 'aside[aria-label="Agent details"]';

// The centre mode, the pair it shows and the message it scrolls to, each value as it was set. Recorded by subscription, not
// read after the click: the conversation scrolls to its message and clears the atom, and a held-agent pane (the `pair` mode
// before the conversation exists) sends the centre back to the terminal, both at once.
const startRec = (h) =>
    AC.agentPage(
        h,
        `const { centerModeAtom, pairSelAtom } = await mod("app/view/agents/agentcenter.ts");
        const { pairScrollToAtom } = await mod("app/view/agents/pairstore.ts");
        window.__decidedRec?.stop();
        // from a clean start: a scenario that ran before may have left a pair chosen, and setting the same value again is no change
        globalStore.set(centerModeAtom, "terminal");
        globalStore.set(pairSelAtom, null);
        globalStore.set(pairScrollToAtom, null);
        const rec = { mode: [], sel: [], scroll: [] };
        const subs = [
            globalStore.sub(centerModeAtom, () => rec.mode.push(globalStore.get(centerModeAtom))),
            globalStore.sub(pairSelAtom, () => rec.sel.push(globalStore.get(pairSelAtom))),
            globalStore.sub(pairScrollToAtom, () => rec.scroll.push(globalStore.get(pairScrollToAtom))),
        ];
        rec.stop = () => subs.forEach((off) => off());
        window.__decidedRec = rec;
        return true;`
    );
const readRec = (h) => AC.agentPage(h, `const r = window.__decidedRec; return r ? { mode: r.mode, sel: r.sel, scroll: r.scroll } : null;`);
// the centre back on the terminal, no pair chosen, nothing to scroll to, and the recorder off
const resetCentre = (h) =>
    AC.agentPage(
        h,
        `const { centerModeAtom, pairSelAtom } = await mod("app/view/agents/agentcenter.ts");
        const { pairScrollToAtom } = await mod("app/view/agents/pairstore.ts");
        window.__decidedRec?.stop();
        delete window.__decidedRec;
        globalStore.set(centerModeAtom, "terminal");
        globalStore.set(pairSelAtom, null);
        globalStore.set(pairScrollToAtom, null);
        return true;`
    );

// A row of the Agreed list, by its item number: the box that opens and folds (the list item motion draws), two levels over
// the item's own marker. null while there is none.
const ROW = (num) => `document.querySelector('${ASIDE_SEL} [data-decided-item="${num}"]')?.parentElement?.parentElement ?? null`;

// Sets the seeded pairs inside the page, then reads the row of item `num` on every animation frame for `ms`: its height and
// opacity, null in a frame where there is no such row. `views` and each step's views are arrays of PairView (what the mock
// holds); `steps` are [wait ms, views] pairs applied after the first set, for a press cut short. Doing it all in the page keeps the frames honest: no round trip separates the change from the first read.
const watchRow = (h, num, views, ms, steps = []) =>
    AC.agentPage(
        h,
        `const { devMockPairsAtom } = await mod("app/view/agents/pairstore.ts");
        const row = () => ${ROW(num)};
        const frames = [];
        globalStore.set(devMockPairsAtom, ${JSON.stringify(views)});
        const t0 = performance.now();
        for (const [wait, next] of ${JSON.stringify(steps)}) {
            setTimeout(() => globalStore.set(devMockPairsAtom, next), wait);
        }
        await new Promise((done) => {
            const tick = () => {
                const el = row();
                frames.push(el ? { h: Math.round(el.getBoundingClientRect().height * 10) / 10, o: Number(getComputedStyle(el).opacity) } : null);
                if (performance.now() - t0 < ${ms}) requestAnimationFrame(tick);
                else done();
            };
            requestAnimationFrame(tick);
        });
        return frames;`
    );

const setRail = (h, visible) =>
    AC.agentPage(
        h,
        `const { railVisibleAtom } = await mod("app/view/agents/railstore.ts");
        globalStore.set(railVisibleAtom, ${JSON.stringify(visible)});
        return true;`
    );

export default function (kit) {
    const { polishWaitFor, polishNap } = kit;
    // the Decided tab selected on the focused agent, its pane drawn
    const openTab = async (h) => {
        await polishWaitFor(h, `!!${TAB}`, WAIT_MS);
        await mouse(h, `${ASIDE_SEL} [data-rail-tab="decided"]`);
        return polishWaitFor(h, `!!${PANE}`, WAIT_MS);
    };
    return [
        {
            name: NAME,
            surface: "agent",
            async arrange(h) {
                const ctx = {};
                try {
                    await h.goto("agent");
                    const now = Date.now();
                    ctx.view = pairView(now, { judges: 1 });
                    ctx.prev = await AC.agentPage(
                        h,
                        `const { railVisibleAtom } = await mod("app/view/agents/railstore.ts");
                        const { railPanelsAtom } = await mod("app/view/agents/agentrailstore.ts");
                        return { visible: globalStore.get(railVisibleAtom), panels: globalStore.get(railPanelsAtom) };`
                    );
                    await AC.setRoster(h, pairRoster(now));
                    await seedPair(h, [ctx.view]);
                    await stubPairRpc(h);
                    await setRail(h, true);
                    await AC.focusAgent(h, PAIR.worker);
                    ctx.ready = await polishWaitFor(h, `!!document.querySelector('[data-agent-row="${PAIR.worker}"]') && !!${TAB}`, WAIT_MS);
                } catch (e) {
                    ctx.arrangeError = String(e?.message ?? e);
                }
                return ctx;
            },
            async assert(h, ctx) {
                const steps = [];
                const rec = (step, ok, detail) => steps.push({ step, ok: ok === true, detail: typeof detail === "string" ? detail : JSON.stringify(detail) });
                rec("0. the fixture roster and its pair were seeded, and the worker's rail shows the Decided tab", ctx.arrangeError == null && ctx.ready === true, ctx.arrangeError ?? { ready: ctx.ready });
                if (ctx.arrangeError != null || ctx.ready !== true) return steps;
                const ask = ctx.view.decided.asks[0];
                const [agreed1, agreed2] = ctx.view.decided.agreed;
                const open1 = ctx.view.decided.open[0];

                // 1. decided-tab: the tab beside Overview and Changes with its amber dot while an item waits on the person; its
                // pane is R1's rail (Waits on you with its chips, Agreed numbered with a link each, Still open) at the rail's fixed
                // width; the judge's own rail has the tab too
                await polishNap(600); // the rail's own opening is over
                const overviewWidth = (await h.ev(readRail))?.width;
                await openTab(h);
                await polishNap(300);
                const worker = await h.ev(readRail);
                await shot(h, "1-decided");
                const workerTabs = worker?.tabs ?? [];
                await AC.focusAgent(h, PAIR.judge);
                await openTab(h);
                const judge = await h.ev(readRail);
                await AC.focusAgent(h, PAIR.worker);
                await polishWaitFor(h, `!!${PANE}`, WAIT_MS);
                rec(
                    "decided-tab: the Decided tab sits right after Changes with its amber dot, its pane is Waits on you / Agreed / Still open as R1 draws them at the rail's own width, and the judge's rail has the tab too",
                    workerTabs[0] === "overview" &&
                        workerTabs.indexOf("changes") > 0 &&
                        workerTabs.indexOf("decided") === workerTabs.indexOf("changes") + 1 &&
                        worker.tab?.label === "Decided" &&
                        worker.tab.dot === true &&
                        worker.shown === "decided" &&
                        worker.width === overviewWidth &&
                        worker.pairId === PAIR.id &&
                        worker.sections.map((s) => `${s.id}:${s.label}`).join("|") === "asks:Waits on you|agreed:Agreed|open:Still open" &&
                        worker.asks.length === 1 &&
                        worker.asks[0].num === String(ask.num) &&
                        worker.asks[0].text === ask.text &&
                        worker.asks[0].note === ask.note &&
                        worker.asks[0].chips.join("|") === ask.chips.join("|") &&
                        worker.asks[0].other === true &&
                        worker.asks[0].answer == null &&
                        worker.agreed.map((a) => a.num).join(",") === `${agreed1.num},${agreed2.num}` &&
                        worker.agreed[0].text.includes(agreed1.text) &&
                        worker.agreed[0].text.includes(agreed1.note) &&
                        worker.agreed.every((a) => /^\d\d:\d\d$/.test(a.linkText)) &&
                        worker.open.length === 1 &&
                        worker.open[0].text.includes(open1.text) &&
                        judge?.tab?.label === "Decided" &&
                        judge.tab.dot === true &&
                        judge.shown === "decided" &&
                        judge.pairId === PAIR.id,
                    { overviewWidth, worker, judge }
                );

                // 2. answer-chip: a chip press calls the stubbed PairSayCommand with the item, to both and replying to no
                // message; "other…" leaves the typing to the conversation, which it opens
                await startRec(h);
                await mouse(h, `${ASIDE_SEL} [data-decided-chip="${ask.chips[0]}"]`);
                await polishWaitFor(h, `!document.querySelector('${ASIDE_SEL} [data-decided-chip]')?.disabled`, WAIT_MS);
                const said = await pairRpcCalls(h, "PairSayCommand");
                const afterChip = await h.ev(readRail);
                const recAfterChip = await readRec(h);
                await mouse(h, `${ASIDE_SEL} [data-decided-other]`);
                await polishNap(200);
                const recAfterOther = await readRec(h);
                await resetCentre(h);
                rec(
                    "answer-chip: pressing the chip sends PairSayCommand with the A item, the chip's words, to both and no reply-to, leaves the centre alone, and the chips come back; \"other…\" opens the pair's conversation",
                    said.length === 1 &&
                        JSON.stringify(said[0]) === JSON.stringify({ pairid: PAIR.id, text: ask.chips[0], to: "both", replyto: "", item: ask.num }) &&
                        recAfterChip?.mode.length === 0 &&
                        afterChip?.asks[0]?.chips.length === 1 &&
                        recAfterOther?.mode[0] === "pair" &&
                        recAfterOther.sel[0] === PAIR.id &&
                        recAfterOther.scroll.length === 0,
                    { said, recAfterChip, recAfterOther }
                );

                // 3. agreed-link: an agreed item opens the pair's conversation and names the message where it was settled
                await startRec(h);
                await mouse(h, `${ASIDE_SEL} [data-decided-link="${agreed2.msgid}"]`);
                await polishNap(200);
                const recLink = await readRec(h);
                await resetCentre(h);
                rec(
                    "agreed-link: an agreed item's time link sets the `pair` centre mode, the pair and pairScrollToAtom to the message where it was settled",
                    recLink?.mode[0] === "pair" && recLink.sel[0] === PAIR.id && recLink.scroll[0] === agreed2.msgid,
                    recLink
                );

                // 4. no-asks: nothing waiting on the person leaves the tab with no dot, whether the pair has no A item or the
                // person has answered each; an answered item shows the answer in place of its chips
                const noAsks = { ...ctx.view, decided: { ...ctx.view.decided, asks: [] } };
                await seedPair(h, [noAsks]);
                await polishWaitFor(h, `${PANE}?.querySelector('[data-decided-section="asks"] [data-decided-item]') == null`, WAIT_MS);
                await polishNap(700); // the rows' spring has settled, so the shot is the end state
                const none = await h.ev(readRail);
                await shot(h, "4a-no-asks");
                const answered = { ...ctx.view, decided: { ...ctx.view.decided, asks: [{ ...ask, answer: ask.chips[0] }] } };
                await seedPair(h, [answered]);
                await polishWaitFor(h, `!!${PANE}?.querySelector("[data-decided-answer]")`, WAIT_MS);
                await polishNap(700);
                const done = await h.ev(readRail);
                await shot(h, "4b-answered");
                await seedPair(h, [ctx.view]);
                rec(
                    "no-asks: with no A item, or only answered ones, the Decided tab stays (the pair is still paired) with no dot; the empty Waits on you says so, an answered item says what was answered and offers no chip",
                    none?.tab?.label === "Decided" &&
                        none.tab.anyDot === false &&
                        none.asks.length === 0 &&
                        none.sections[0].empty === "Nothing waits on you" &&
                        none.agreed.length === 2 &&
                        done?.tab?.anyDot === false &&
                        done.asks.length === 1 &&
                        done.asks[0].chips.length === 0 &&
                        done.asks[0].other === false &&
                        done.asks[0].answer === `You answered ${ask.chips[0]}`,
                    { none, done }
                );

                // 4c. rows-move: a row arriving or leaving opens or folds on the spring over several frames, never in one, with no
                // overshoot and nothing left behind; a press cut short (it comes, goes, comes again) ends as a slow one does, one row at
                // full height and opacity; under reduced motion the row is at its end state in its first frame
                const extra = { ...agreed1, num: 5, text: "A third agreed line, long enough to wrap onto a second line in the rail.", note: "", msgid: agreed1.msgid };
                const withExtra = { ...ctx.view, decided: { ...ctx.view.decided, agreed: [...ctx.view.decided.agreed, extra] } };
                const settled = (frames) => frames.filter(Boolean);
                const grows = (hs) => hs.every((f, i) => i === 0 || f.h >= hs[i - 1].h - 0.6);
                const folds = (hs) => hs.every((f, i) => i === 0 || f.h <= hs[i - 1].h + 0.6);
                const comes = settled(await watchRow(h, 5, [withExtra], 900));
                const full = comes.at(-1)?.h ?? 0;
                const comeShape = {
                    frames: comes.length,
                    first: comes[0],
                    last: comes.at(-1),
                    distinct: new Set(comes.map((f) => f.h)).size,
                    peak: Math.max(0, ...comes.map((f) => f.h)),
                    settled: comes.slice(-3).every((f) => f.h === full),
                };
                const goes = await watchRow(h, 5, [ctx.view], 900);
                const goesHs = settled(goes);
                const goShape = {
                    frames: goesHs.length,
                    first: goesHs[0],
                    distinct: new Set(goesHs.map((f) => f.h)).size,
                    gone: goes.at(-1) === null,
                };
                // cut short: in, out after 120ms, in again after another 120ms
                const cut = await watchRow(h, 5, [withExtra], 1400, [[120, [ctx.view]], [240, [withExtra]]]);
                const cutEnd = await h.ev(`(() => {
                    const rows = document.querySelectorAll('${ASIDE_SEL} [data-decided-item="5"]');
                    const el = rows[0]?.parentElement?.parentElement;
                    return { rows: rows.length, h: el ? Math.round(el.getBoundingClientRect().height * 10) / 10 : null, o: el ? Number(getComputedStyle(el).opacity) : null };
                })()`);
                await seedPair(h, [ctx.view]);
                await polishWaitFor(h, `!document.querySelector('${ASIDE_SEL} [data-decided-item="5"]')`, WAIT_MS);
                // the preference is read when a part mounts, so the pane is mounted again under it: Overview, then Decided
                await h.cdp("Emulation.setEmulatedMedia", { features: [{ name: "prefers-reduced-motion", value: "reduce" }] });
                await mouse(h, `${ASIDE_SEL} [data-rail-tab="overview"]`);
                await polishWaitFor(h, `!${PANE}`, WAIT_MS);
                await openTab(h);
                await polishNap(200);
                const still = settled(await watchRow(h, 5, [withExtra], 600));
                await seedPair(h, [ctx.view]);
                await polishWaitFor(h, `!document.querySelector('${ASIDE_SEL} [data-decided-item="5"]')`, WAIT_MS);
                await h.cdp("Emulation.setEmulatedMedia", { features: [] });
                rec(
                    "rows-move: a row opens on the spring over several frames from folded to its full height with no overshoot and folds away leaving nothing; a press cut short ends as a slow one (one row, full height and opacity); under reduced motion the row is at its end state in its first frame",
                    full > 20 &&
                        comeShape.frames >= 4 &&
                        comeShape.first.h < full * 0.5 &&
                        comeShape.first.o < 1 &&
                        comeShape.distinct >= 4 &&
                        comeShape.peak <= full + 0.6 &&
                        comeShape.settled &&
                        comeShape.last.o === 1 &&
                        grows(comes) &&
                        goShape.frames >= 4 &&
                        goShape.first.h >= full * 0.9 &&
                        goShape.distinct >= 4 &&
                        goShape.gone &&
                        folds(goesHs) &&
                        cutEnd.rows === 1 &&
                        Math.abs(cutEnd.h - full) <= 0.6 &&
                        cutEnd.o === 1 &&
                        still.length >= 1 &&
                        Math.abs(still[0].h - full) <= 0.6 &&
                        still[0].o === 1,
                    { full, comeShape, goShape, cutEnd, cutFrames: cut.length, still: { frames: still.length, first: still[0] } }
                );

                // 5. unpaired: an agent in no pair has no Decided tab
                await AC.focusAgent(h, PAIR.other);
                await polishWaitFor(h, `!!document.querySelector('${ASIDE_SEL} [data-rail-tab="overview"]') && !${TAB}`, WAIT_MS);
                await polishNap(200);
                const other = await h.ev(readRail);
                await AC.focusAgent(h, PAIR.worker);
                rec(
                    "unpaired: an agent in no pair has no Decided tab and no Decided pane",
                    other != null && other.tab == null && !other.tabs.includes("decided") && other.pairId == null && other.tabs[0] === "overview",
                    other
                );
                return steps;
            },
            async teardown(h, ctx) {
                const failures = [];
                const attempt = async (what, fn) => {
                    try {
                        await fn();
                    } catch (e) {
                        failures.push(`${what}: ${e?.message ?? e}`);
                    }
                };
                await attempt("put the centre back", () => resetCentre(h));
                await attempt("forget what the fixture pair showed as seen", () =>
                    AC.agentPage(
                        h,
                        `const { pairSeenAtom } = await mod("app/view/agents/pairstore.ts");
                        globalStore.set(pairSeenAtom(${JSON.stringify(PAIR.id)}), 0);
                        return true;`
                    )
                );
                await attempt("drop the stubbed pair commands", () => restorePairRpc(h));
                await attempt("drop the fixture pair", () => seedPair(h, null));
                await attempt("drop the fixture roster", () => AC.restoreRoster(h));
                if (ctx.prev != null) {
                    await attempt("restore the rail", () =>
                        AC.agentPage(
                            h,
                            `const { railVisibleAtom } = await mod("app/view/agents/railstore.ts");
                            const { railPanelsAtom } = await mod("app/view/agents/agentrailstore.ts");
                            globalStore.set(railVisibleAtom, ${JSON.stringify(ctx.prev.visible)});
                            globalStore.set(railPanelsAtom, ${JSON.stringify(ctx.prev.panels)});
                            return true;`
                        )
                    );
                }
                if (failures.length > 0) throw new Error(failures.join("; "));
            },
        },
    ];
}
