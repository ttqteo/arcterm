// pair-header: board K2, Add judge in the agent's header and the header once paired
// (docs/superpowers/specs/2026-11-25-agent-pair-judge-design.md; frontend/app/view/agents/pairjudgemenu.tsx, pairlaunch.ts).
// No agent runs and wavesrv's pair commands are never called: the roster is pair-fixtures.mjs's, set into the page's dev
// mock roster; the pairs are its views, set into the page's dev mock pairs; the seven RpcApi.Pair*Command methods are the
// fixtures' recording stubs. Open a new judge (a real launch of a claude tab) is not run: pairlaunch.test.ts covers its
// order and its gate over mocks; here a live agent is picked, which is PairStart and the conversation.
// kit is scenarios.mjs's RT_KIT (polishWaitFor, polishNap).

import { agentPage, focusAgent, restoreRoster, setRoster } from "./agent-page-fixtures.mjs";
import { PAIR, pairRoster, pairRpcCalls, pairView, restorePairRpc, seedPair, stubPairRpc } from "./pair-fixtures.mjs";

const NAME = "pair-header";
const WAIT_MS = 8_000;
const WINDOW_W = 1900;
const q = JSON.stringify;
const shot = (h, step) => h.shot(`cdp-shots/${NAME}-${step}.png`);

const HEADER = `document.querySelector("[data-agent-header]")`;
const MENU = `document.querySelector("[data-pair-judge-menu]")`;

// the header as the steps read it: its words level, its name and state, and the pair controls it carries
const readHeader = `(() => {
    const hd = ${HEADER};
    if (!hd) return null;
    const flat = (el) => (el?.innerText ?? "").replace(/\\s+/g, " ").trim();
    const open = hd.querySelector("[data-pair-open]");
    const add = hd.querySelector("[data-pair-add-judge]");
    return {
        labels: hd.getAttribute("data-header-labels"),
        name: flat(hd.querySelector("[data-header-name] .font-semibold")),
        state: flat(hd.querySelector("[data-agent-state-pill]")),
        open: open ? { text: flat(open), label: open.getAttribute("aria-label"), role: open.getAttribute("data-pair-role") } : null,
        add: add ? { text: flat(add), label: add.getAttribute("aria-label"), expanded: add.getAttribute("aria-expanded") } : null,
    };
})()`;

// the open menu: what it lists, where the keys are, and whether it sits inside the window
const readMenu = `(() => {
    const m = ${MENU};
    if (!m) return null;
    const flat = (el) => (el?.innerText ?? "").replace(/\\s+/g, " ").trim();
    const r = m.getBoundingClientRect();
    return {
        newJudge: flat(m.querySelector("[data-pair-new-judge]")),
        section: flat([...m.children].find((c) => c.textContent.startsWith("Or pick"))),
        choices: [...m.querySelectorAll("[data-pair-judge-choice]")].map((b) => ({ id: b.getAttribute("data-pair-judge-choice"), text: flat(b) })),
        empty: !!m.querySelector("[data-pair-no-choices]"),
        keysInMenu: m.contains(document.activeElement),
        firstFocused: document.activeElement?.hasAttribute("data-pair-new-judge") === true,
        inWindow: r.left >= 0 && r.top >= 0 && r.right <= innerWidth && r.bottom <= innerHeight,
    };
})()`;

// The centre column's modes (agentcenter.ts) are recorded as they happen, because the header's part is to set `pair`, and
// what draws it is Task 7's pane: until that pane is wired into the centre, the held pane (heldpane.tsx) sends a mode it was
// not asked for back to the terminal at once. So a step reads the pair shown and the modes the centre went through since the
// last read: the button's work is that `pair` is among them, and it stays true when the conversation holds the mode.
const watchCenter = (h) =>
    agentPage(
        h,
        `const { centerModeAtom } = await mod("app/view/agents/agentcenter.ts");
        window.__pairHdrUnwatch?.();
        const modes = (window.__pairHdrModes = []);
        window.__pairHdrUnwatch = globalStore.sub(centerModeAtom, () => modes.push(globalStore.get(centerModeAtom)));
        return true;`
    );
const unwatchCenter = (h) =>
    h.ev(`(() => { window.__pairHdrUnwatch?.(); delete window.__pairHdrUnwatch; delete window.__pairHdrModes; return true; })()`);
// the pair shown, the mode now, and the modes since the last read (reading starts the next list)
const readCenter = (h) =>
    agentPage(
        h,
        `const { centerModeAtom, pairSelAtom } = await mod("app/view/agents/agentcenter.ts");
        return {
            mode: globalStore.get(centerModeAtom),
            pair: globalStore.get(pairSelAtom),
            modes: (window.__pairHdrModes ?? []).splice(0),
        };`
    );
const leaveCenter = (h) =>
    agentPage(
        h,
        `const { centerModeAtom } = await mod("app/view/agents/agentcenter.ts");
        globalStore.set(centerModeAtom, "terminal");
        (window.__pairHdrModes ?? []).splice(0);
        return true;`
    );

// how many messages of the pair the person has seen: the header's "N new" counts the rest
const setSeen = (h, pairId, count) =>
    agentPage(
        h,
        `const { pairSeenAtom } = await mod("app/view/agents/pairstore.ts");
        globalStore.set(pairSeenAtom(${q(pairId)}), ${count});
        return true;`
    );
const readSeen = (h, pairId) =>
    agentPage(
        h,
        `const { pairSeenAtom } = await mod("app/view/agents/pairstore.ts");
        return globalStore.get(pairSeenAtom(${q(pairId)}));`
    );

// What wavesrv does on PairStart: the pair exists once the call has been made. The stub answers from the page's mock pairs,
// so the mock gets the pair when the call comes (set before it, the header would turn paired under the open menu).
const pairOnStart = (h, view) =>
    agentPage(
        h,
        `const { RpcApi } = await mod("app/store/wshclientapi.ts");
        const { devMockPairsAtom } = await mod("app/view/agents/pairstore.ts");
        const stub = RpcApi.PairStartCommand;
        RpcApi.PairStartCommand = async (c, d) => {
            globalStore.set(devMockPairsAtom, [${q(view)}]);
            return stub(c, d);
        };
        return true;`
    );

// the header given a fixed width, which its ResizeObserver reads as a 2x2 cell's (null puts it back)
const narrowTo = (h, px) =>
    h.ev(`(() => { const hd = ${HEADER}; if (!hd) return false; hd.style.width = ${px == null ? '""' : q(px + "px")}; return true; })()`);

// The menu's frames while it opens: every animation frame's opacity and width of the panel that popoverReveal moves (the
// menu's parent), null for a frame with no menu. A change drawn in one frame has no frame between (a snap).
const startMotion = (h) =>
    h.ev(`(() => {
        const frames = (window.__pairMotion = []);
        let on = true;
        window.__pairMotionStop = () => { on = false; };
        const tick = () => {
            if (!on) return;
            const p = document.querySelector("[data-pair-judge-menu]")?.parentElement;
            frames.push(p ? { o: Number(getComputedStyle(p).opacity), w: Math.round(p.getBoundingClientRect().width * 10) / 10 } : null);
            requestAnimationFrame(tick);
        };
        requestAnimationFrame(tick);
        return true;
    })()`);
const stopMotion = (h) =>
    h.ev(`(() => { window.__pairMotionStop?.(); const f = window.__pairMotion ?? []; delete window.__pairMotion; delete window.__pairMotionStop; return f; })()`);

const key = (h, name, code) =>
    ["keyDown", "keyUp"].reduce(
        (p, type) => p.then(() => h.cdp("Input.dispatchKeyEvent", { type, key: name, code: name, windowsVirtualKeyCode: code })),
        Promise.resolve()
    );

export default function (kit) {
    const { polishWaitFor, polishNap } = kit;

    // where the element `selector` names has its middle, or null when none is drawn
    const centreOf = (h, selector) =>
        h.ev(`(() => {
            const r = document.querySelector(${q(selector)})?.getBoundingClientRect();
            return r && r.width > 0 && r.height > 0 ? { x: Math.round(r.x + r.width / 2), y: Math.round(r.y + r.height / 2) } : null;
        })()`);

    // a real mouse click at the element's middle now: a press that does not wait for anything to settle; false when none is drawn
    async function tap(h, selector) {
        const box = await centreOf(h, selector);
        if (box == null) return false;
        await h.cdp("Input.dispatchMouseEvent", { type: "mouseMoved", x: box.x, y: box.y });
        for (const type of ["mousePressed", "mouseReleased"]) {
            await h.cdp("Input.dispatchMouseEvent", { type, x: box.x, y: box.y, button: "left", clickCount: 1 });
        }
        return true;
    }

    // a click once the element has stopped moving (a menu springs into its place)
    async function click(h, selector) {
        let box = await centreOf(h, selector);
        for (let i = 0; i < 8 && box != null; i++) {
            await polishNap(120);
            const again = await centreOf(h, selector);
            const steady = again != null && again.x === box.x && again.y === box.y;
            box = again;
            if (steady) break;
        }
        return box == null ? false : tap(h, selector);
    }

    // The fixture's blocks are not real ones, so the pane's controller start fails and the header reads "failed to start",
    // which rightly wins over the state the steps read. Once the pane has tried, that refusal is cleared (as
    // scenarios-agent-header.mjs does), and the header says what the fixture says.
    async function show(h, id, blockId) {
        await focusAgent(h, id);
        await polishWaitFor(h, `!!${HEADER}?.querySelector("[data-agent-start-error]")`, 3_000);
        await agentPage(
            h,
            `const { getStartErrorAtom } = await mod("app/view/agents/agentcontrollerstore.ts");
            globalStore.set(getStartErrorAtom(${q(blockId)}), undefined);
            return true;`
        );
        await polishWaitFor(h, `!${HEADER}?.querySelector("[data-agent-start-error]")`, 3_000);
        // That refusal's long text overflowed the header for a moment, and the header keeps its icons until it has the width
        // that overflow needed (headermodel.nextHeaderLabels): give it the room, then take it back. Only the fixture's
        // fake blocks do this; a real agent's header never shows the refusal.
        await narrowTo(h, 3_000);
        await polishWaitFor(h, `${HEADER}?.getAttribute("data-header-labels") === "words"`, WAIT_MS);
        await narrowTo(h, null);
        await polishNap(200);
    }
    const waitHeader = (h, name, extra = "true") =>
        polishWaitFor(h, `(${HEADER}?.querySelector("[data-header-name] .font-semibold")?.textContent ?? "").includes(${q(name)}) && (${extra})`, WAIT_MS);
    const waitMenu = (h) => polishWaitFor(h, `!!${MENU}`, WAIT_MS);
    const menuGone = (h) => polishWaitFor(h, `!${MENU}`, WAIT_MS);
    const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);

    return [
        {
            name: NAME,
            surface: "agent",
            async arrange(h) {
                const ctx = { worker: "Plan oracle-tightening" };
                try {
                    await h.goto("agent");
                    // a window wide enough for the header's words (a narrower one turns every label into its icon:
                    // narrow-header is that case, made on purpose)
                    await h.cdp("Emulation.setDeviceMetricsOverride", { width: WINDOW_W, height: 950, deviceScaleFactor: 1, mobile: false });
                    ctx.sized = true;
                    ctx.prevSeen = await h.ev(`localStorage.getItem("agent.pairseen")`);
                    await watchCenter(h);
                    ctx.now = Date.now();
                    await setRoster(h, pairRoster(ctx.now));
                    await stubPairRpc(h);
                    await seedPair(h, []);
                    ctx.ready = await polishWaitFor(h, `!!document.querySelector('[data-agent-row="${PAIR.worker}"]')`, WAIT_MS);
                } catch (e) {
                    ctx.arrangeError = String(e?.message ?? e);
                }
                return ctx;
            },
            async assert(h, ctx) {
                const steps = [];
                const rec = (step, ok, detail) => steps.push({ step, ok: ok === true, detail: typeof detail === "string" ? detail : JSON.stringify(detail) });
                // a step that throws is a failed step, not the end of the run
                const run = async (name, fn) => {
                    try {
                        await fn();
                    } catch (e) {
                        rec(name, false, `the step threw: ${String(e?.message ?? e)}`);
                    }
                };
                rec("0. the pair roster, the stubs and an empty pair list were set", ctx.arrangeError == null && ctx.ready === true, ctx.arrangeError ?? { ready: ctx.ready });
                if (ctx.arrangeError != null) return steps;

                const workerBlock = "fx-blk-pair-worker";
                const view = pairView(ctx.now);

                await run("add-judge-menu", async () => {
                    // an agent in no pair: the Add judge button, and under it K2's menu
                    await show(h, PAIR.worker, workerBlock);
                    await waitHeader(h, ctx.worker, `!!${HEADER}.querySelector("[data-pair-add-judge]")`);
                    const header = await h.ev(readHeader);
                    await click(h, "[data-agent-header] [data-pair-add-judge]");
                    await waitMenu(h);
                    await polishNap(400);
                    const menu = await h.ev(readMenu);
                    const opened = await h.ev(readHeader);
                    await shot(h, "add-judge-menu");
                    // Escape closes it and hands the keys back to the button
                    await key(h, "Escape", 27);
                    const closed = await menuGone(h);
                    const back = await h.ev(`document.activeElement?.hasAttribute("data-pair-add-judge") === true`);
                    rec(
                        "add-judge-menu: an unpaired agent's header has Add judge; its menu opens on Open a new judge (new tab in the same project, reads the plan and the latest reply · opus), then the project's live agents that are in no pair (name, short id, state), keys in the menu from the first row, inside the window; Escape closes it and the keys return to the button",
                        header?.labels === "words" &&
                            header.open == null &&
                            header.add?.text === "Add judge" &&
                            header.add.label === "Add judge" &&
                            opened?.add?.expanded === "true" &&
                            menu?.newJudge === "Open a new judge new tab in the same project, reads the plan and the latest reply · opus" &&
                            menu.section === "Or pick a live agent" &&
                            same(menu.choices, [
                                { id: PAIR.judge, text: "Judge: Plan oracle-tightening 4c6ba858 · working" },
                                { id: PAIR.other, text: "Pull history and sync 9e0f1a2b · idle" },
                            ]) &&
                            menu.keysInMenu &&
                            menu.firstFocused &&
                            menu.inWindow &&
                            closed === true &&
                            back === true,
                        { header, menu, closed, back }
                    );
                });

                await run("menu-motion", async () => {
                    // the menu opens and leaves on popoverReveal (opacity and scale over frames, never a snap), and a second press
                    // 70 ms after the first, mid-motion, ends as a slow press does: closed, and no second copy drawn
                    const add = "[data-agent-header] [data-pair-add-judge]";
                    await startMotion(h);
                    await click(h, add);
                    await waitMenu(h);
                    await polishNap(500);
                    await key(h, "Escape", 27);
                    await menuGone(h);
                    await polishNap(100);
                    const frames = (await stopMotion(h)).filter((f) => f != null);
                    const full = frames.findIndex((f) => f.o === 1);
                    const between = (list) => list.filter((f) => f.o > 0 && f.o < 1).length;
                    const opening = full < 0 ? 0 : between(frames.slice(0, full));
                    const leaving = full < 0 ? 0 : between(frames.slice(full));
                    await tap(h, add);
                    await polishNap(70);
                    await tap(h, add);
                    await polishNap(900);
                    const quick = await h.ev(`({
                        copies: document.querySelectorAll("[data-pair-judge-menu]").length,
                        expanded: document.querySelector("[data-pair-add-judge]")?.getAttribute("aria-expanded"),
                    })`);
                    rec(
                        "menu-motion: the menu opens and leaves over frames (opacity between 0 and 1 each way, fully opaque in between), and a second press 70 ms after the first leaves it closed with no copy of it drawn",
                        full >= 0 && opening >= 1 && leaving >= 1 && frames.at(-1)?.o !== 1 && quick.copies === 0 && quick.expanded === "false",
                        { frames: frames.length, opening, leaving, quick }
                    );
                });

                await run("pick-live-judge", async () => {
                    // picking a live agent is PairStart (hold on, the default cap, not briefed) and the conversation
                    const picked = { ...view, judges: [{ tab: PAIR.other, name: "Pull history and sync", harness: "claude" }] };
                    await pairOnStart(h, picked);
                    await click(h, "[data-agent-header] [data-pair-add-judge]");
                    await waitMenu(h);
                    await polishNap(300);
                    await click(h, `[data-pair-judge-choice="${PAIR.other}"]`);
                    await polishWaitFor(h, `!${MENU}`, WAIT_MS);
                    const calls = await pairRpcCalls(h, "PairStartCommand");
                    // the menu closes at the click and the conversation opens when PairStart answers: wait for it
                    const modes = [];
                    let center;
                    for (let i = 0; i < 12; i++) {
                        center = await readCenter(h);
                        modes.push(...center.modes);
                        if (modes.includes("pair")) break;
                        await polishNap(250);
                    }
                    center = { ...center, modes };
                    rec(
                        "pick-live-judge: picking a live agent calls PairStart with the worker and that agent (heavy commands held, tokencap 0 for the default, not briefed), opens the conversation (the pair centre mode on that pair) and closes the menu",
                        calls.length === 1 &&
                            same(calls[0], { workertab: PAIR.worker, judgetab: PAIR.other, holdheavy: true, tokencap: 0, note: "", briefed: false }) &&
                            center.modes.includes("pair") &&
                            center.pair === PAIR.id,
                        { calls, center }
                    );
                    await leaveCenter(h);
                    await stubPairRpc(h);
                });

                await run("paired-button", async () => {
                    // the pair is seeded and the person has seen 3 of its 5 messages
                    await seedPair(h, [view]);
                    await setSeen(h, PAIR.id, 3);
                    // still the focused agent, its start refusal already cleared by the first step
                    await focusAgent(h, PAIR.worker);
                    await waitHeader(h, ctx.worker, `!!${HEADER}.querySelector("[data-pair-open]")`);
                    await polishNap(300);
                    const header = await h.ev(readHeader);
                    await shot(h, "paired-button");
                    // the small icon is the same menu, for another judge: the judge already in the pair is not offered again
                    await click(h, "[data-agent-header] [data-pair-add-judge]");
                    await waitMenu(h);
                    await polishNap(300);
                    const menu = await h.ev(readMenu);
                    await shot(h, "paired-add-another");
                    await key(h, "Escape", 27);
                    await menuGone(h);
                    rec(
                        'paired-button: the working agent\'s header reads "Paired with judge 4c6ba858 · 2 new" and its state line "waiting on judge", beside a small Add judge icon (no words) whose menu offers the agents in no pair, not the judge already paired',
                        header?.labels === "words" &&
                            header.open?.text === "Paired with judge 4c6ba858 · 2 new" &&
                            header.open.label === "Paired with judge 4c6ba858 · 2 new" &&
                            header.open.role === "worker" &&
                            header.state === "waiting on judge" &&
                            header.add?.text === "" &&
                            header.add.label === "Add another judge" &&
                            same(menu?.choices, [{ id: PAIR.other, text: "Pull history and sync 9e0f1a2b · idle" }]),
                        { header, menu }
                    );
                });

                await run("paired-opens", async () => {
                    await click(h, "[data-agent-header] [data-pair-open]");
                    await polishNap(300);
                    const center = await readCenter(h);
                    const seen = await readSeen(h, PAIR.id);
                    rec(
                        "paired-opens: the Paired button opens the pair centre mode on its pair and counts its messages as seen (the 2 new are gone)",
                        center.modes.includes("pair") && center.pair === PAIR.id && seen === view.messages.length,
                        { center, seen }
                    );
                    await leaveCenter(h);
                });

                await run("judge-header", async () => {
                    // the judge's own header: Judging, opening the same conversation, and no Add judge
                    await show(h, PAIR.judge, "fx-blk-pair-judge");
                    await waitHeader(h, "Judge: Plan oracle-tightening", `!!${HEADER}.querySelector("[data-pair-open]")`);
                    await polishNap(300);
                    const header = await h.ev(readHeader);
                    await shot(h, "judge-header");
                    await click(h, "[data-agent-header] [data-pair-open]");
                    await polishNap(300);
                    const center = await readCenter(h);
                    rec(
                        'judge-header: the judge\'s own header reads "Judging 61483cd6", has no Add judge, and its button opens the same conversation',
                        header?.labels === "words" &&
                            header.open?.text === "Judging 61483cd6" &&
                            header.open.role === "judge" &&
                            header.add == null &&
                            center.modes.includes("pair") &&
                            center.pair === PAIR.id,
                        { header, center }
                    );
                    await leaveCenter(h);
                });

                await run("no-judge-left", async () => {
                    // two judges in the pair: the label counts them, and no live agent of the project is left to add
                    await seedPair(h, [pairView(ctx.now, { judges: 2 })]);
                    await show(h, PAIR.worker, workerBlock);
                    await waitHeader(h, ctx.worker, `!!${HEADER}.querySelector("[data-pair-open]")`);
                    await polishNap(300);
                    const header = await h.ev(readHeader);
                    await click(h, "[data-agent-header] [data-pair-add-judge]");
                    await waitMenu(h);
                    await polishNap(300);
                    const menu = await h.ev(readMenu);
                    await shot(h, "no-judge-left");
                    await key(h, "Escape", 27);
                    await menuGone(h);
                    rec(
                        'no-judge-left: with two judges paired the label reads "Paired with 2 judges · 1 new"; the menu still offers Open a new judge, and says no other agent is running where the live list would be',
                        header?.open?.text === "Paired with 2 judges · 1 new" &&
                            menu?.newJudge.startsWith("Open a new judge") &&
                            menu.choices.length === 0 &&
                            menu.empty === true &&
                            menu.inWindow === true,
                        { header, menu }
                    );
                });

                await run("narrow-header", async () => {
                    // a header as narrow as a 2x2 cell's: the words give way to the icon and the count, the label stays its aria-label
                    await narrowTo(h, 560);
                    await polishWaitFor(h, `${HEADER}?.getAttribute("data-header-labels") === "icons"`, WAIT_MS);
                    await polishNap(300);
                    const header = await h.ev(readHeader);
                    await shot(h, "narrow-header");
                    await narrowTo(h, null);
                    rec(
                        "narrow-header: at 560px the paired button is its icon and the count of new messages (1), its aria-label still the whole label, and the Add judge icon has no words",
                        header?.labels === "icons" &&
                            header.open?.text === "1" &&
                            header.open.label === "Paired with 2 judges · 1 new" &&
                            header.add?.text === "",
                        header
                    );
                });

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
                await attempt("restore the header width", () => narrowTo(h, null));
                await attempt("leave the pair centre mode", () => leaveCenter(h));
                await attempt("stop recording the centre modes", () => unwatchCenter(h));
                if (ctx.sized) await attempt("restore the window size", () => h.cdp("Emulation.clearDeviceMetricsOverride", {}));
                await attempt("put the generated pair commands back", () => restorePairRpc(h));
                await attempt("clear the pair mocks", () => seedPair(h, null));
                await attempt("drop the pair roster", () => restoreRoster(h));
                // the seen counts are kept in localStorage: the page's own value goes back
                await attempt("restore what was seen", () =>
                    h.ev(
                        `(() => { try { ${ctx.prevSeen == null ? `localStorage.removeItem("agent.pairseen")` : `localStorage.setItem("agent.pairseen", ${q(ctx.prevSeen)})`}; } catch {} return true; })()`
                    )
                );
                if (failures.length > 0) throw new Error(failures.join("; "));
            },
        },
    ];
}
