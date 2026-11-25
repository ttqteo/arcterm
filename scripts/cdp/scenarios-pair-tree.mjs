// pair-tree: board K1, Pair from the Agent tree and the pairing sheet
// (docs/superpowers/specs/2026-11-25-agent-pair-judge-design.md; frontend/app/view/agents/agenttree.tsx, pairsheet.tsx,
// pairsheetmodel.ts, agenttreemodel.ts pairPickable). Over pair-fixtures.mjs: the roster (a codex agent added, and each agent
// given a folder so Discuss together can seat it) goes in the page's dev mock roster, the pairs in its dev mock pairs, and the
// seven RpcApi.Pair*Command methods are stubs that record their calls, so no agent runs and wavesrv is never asked about a pair.
// The tree is driven with real clicks: a click on the worker's row, Ctrl+click on another, right click.
//
// Steps: tree-menu (two picked, neither in a pair: the menu offers Pair: worker + judge right above Discuss together; not with
// either in a pair, a codex agent among them or three picked), pair-sheet (K1's sheet beside the tree: who works and who
// judges, Swap, the hold box, the note, the cap, Cancel and Pair; Escape and Cancel close it and give the focus back), swap
// (the sides trade, and trade back), pair-sent (a cap out of bounds stops Pair; a refusal reads in the sheet and keeps it open;
// Pair calls PairStartCommand with the sheet's values, closes the sheet, and opens the pair's conversation with the worker chosen).
//
// DOM contract: the tree is [data-agent-tree], its agent rows [data-agent-row="<tab>"] (picked: [data-agent-picked]); the right-click
// menu's rows [data-menu-item="<label>"]; the sheet [data-pair-sheet] (a dialog) holding [data-pair-side="worker|judge"]
// ([data-pair-side-tab]), [data-pair-swap], [data-pair-hold], [data-pair-note], [data-pair-cap] with [data-pair-cap-hint],
// [data-pair-error], [data-pair-cancel] and [data-pair-submit].
//
// kit is scenarios.mjs's RT_KIT.

import * as AC from "./agent-page-fixtures.mjs";
import { PAIR, pairRoster, pairRpcCalls, pairView, restorePairRpc, seedPair, stubPairRpc } from "./pair-fixtures.mjs";

const NAME = "pair-tree";
const WAIT_MS = 8_000;
const shot = (h, step) => h.shot(`cdp-shots/${NAME}-${step}.png`);

const PAIR_ITEM = "Pair: worker + judge";
const DISCUSS_ITEM = "Discuss together";
const CODEX = "c0dec0de-1111-4222-8333-444455556666";
// a folder for each agent: Discuss together seats an agent only where it knows the project's path
const FOLDER = "C:\\arc-verify-pair-fixture";

const MENU_ITEMS = `[...document.querySelectorAll("[data-menu-item]")].map((e) => e.dataset.menuItem)`;
const PICKED = `[...document.querySelectorAll("[data-agent-picked]")].map((e) => e.dataset.agentRow)`;
const SHEET = `document.querySelector("[data-pair-sheet]")`;
const FOLDER_ROW = `document.querySelector('[data-project-folder="${PAIR.project}"]')`;
const rowOf = (id) => `[data-agent-row="${id}"]`;
const sameIds = (got, want) => JSON.stringify([...(got ?? [])].sort()) === JSON.stringify([...want].sort());

// Input.dispatchMouseEvent's modifiers bitmask: Ctrl=2, Meta=4. The tree toggles on Ctrl or Cmd, and Control+click is the right
// click on a Mac, so the toggle is Command there
const TOGGLE_BIT = process.platform === "darwin" ? 4 : 2;

// a real click (or right click) at the middle of the first element `selector` matches, with the modifiers held; false when it is
// not on screen
async function mouseOn(h, selector, { button = "left", modifiers = 0 } = {}) {
    const box = await h.ev(`(() => {
        const el = document.querySelector(${JSON.stringify(selector)});
        el?.scrollIntoView({ block: "nearest" });
        const r = el?.getBoundingClientRect();
        return r && r.width > 0 ? { x: Math.round(r.x + r.width / 2), y: Math.round(r.y + r.height / 2) } : null;
    })()`);
    if (box == null) return false;
    const held = button === "right" ? 2 : 1;
    await h.cdp("Input.dispatchMouseEvent", { type: "mouseMoved", x: box.x, y: box.y, modifiers });
    for (const [type, buttons] of [["mousePressed", held], ["mouseReleased", 0]]) {
        await h.cdp("Input.dispatchMouseEvent", { type, x: box.x, y: box.y, button, buttons, clickCount: 1, modifiers });
    }
    return true;
}

async function pressEscape(h) {
    for (const type of ["keyDown", "keyUp"]) {
        await h.cdp("Input.dispatchKeyEvent", { type, key: "Escape", code: "Escape", windowsVirtualKeyCode: 27 });
    }
}

// the right-click menu's item `label`, clicked as the council scenarios do; false when it is not offered
const chooseItem = (h, label) =>
    h.ev(`(() => {
        const row = [...document.querySelectorAll("[data-menu-item]")].find((r) => r.dataset.menuItem === ${JSON.stringify(label)});
        if (!row) return false;
        row.click();
        return true;
    })()`);

// React reads a field's value through its own setter, so a typed value goes in through the prototype's
const typeInto = (h, selector, value) =>
    h.ev(`(() => {
        const el = document.querySelector(${JSON.stringify(selector)});
        if (!el) return false;
        const proto = el instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
        Object.getOwnPropertyDescriptor(proto, "value").set.call(el, ${JSON.stringify(value)});
        el.dispatchEvent(new Event("input", { bubbles: true }));
        return true;
    })()`);

// the sheet as the steps read it
const readSheet = `(() => {
    const s = ${SHEET};
    if (!s) return null;
    const flat = (el) => (el?.textContent ?? "").replace(/\\s+/g, " ").trim();
    // as the person reads it: separate blocks and flex items (a name and its id, a label and its hint) are apart
    const read = (el) => (el?.innerText ?? "").replace(/\\s+/g, " ").trim();
    const side = (role) => {
        const el = s.querySelector('[data-pair-side="' + role + '"]');
        return el ? { tab: el.dataset.pairSideTab, text: read(el) } : null;
    };
    const hold = s.querySelector("[data-pair-hold]");
    const note = s.querySelector("[data-pair-note]");
    const cap = s.querySelector("[data-pair-cap]");
    const submit = s.querySelector("[data-pair-submit]");
    const cancel = s.querySelector("[data-pair-cancel]");
    const box = s.getBoundingClientRect();
    const tree = document.querySelector("[data-agent-tree]").getBoundingClientRect();
    return {
        role: s.getAttribute("role"),
        label: s.getAttribute("aria-label"),
        ownsKeys: s.hasAttribute("data-owns-keys"),
        title: flat(s.firstElementChild),
        labels: [...s.querySelectorAll("dt")].map(flat),
        worker: side("worker"),
        judge: side("judge"),
        swap: flat(s.querySelector("[data-pair-swap]")),
        hold: hold ? { checked: hold.checked, text: read(hold.closest("label")) } : null,
        noteLabel: flat(note?.closest("label")?.firstElementChild),
        noteValue: note?.value ?? null,
        cap: cap?.value ?? null,
        capInvalid: cap?.getAttribute("aria-invalid") ?? null,
        capHint: flat(s.querySelector("[data-pair-cap-hint]")),
        error: s.querySelector("[data-pair-error]") ? flat(s.querySelector("[data-pair-error]")) : null,
        cancel: { text: flat(cancel), disabled: cancel?.disabled ?? null },
        submit: { text: flat(submit), disabled: submit?.disabled ?? null },
        focusOnSubmit: document.activeElement === submit,
        // beside the tree: its left edge past the tree's right and near it, its top level with the tree's, all on screen
        beside: box.left >= tree.right && box.left - tree.right <= 60 && Math.abs(box.top - tree.top) <= 24,
        onScreen: box.top >= 0 && box.left >= 0 && box.right <= window.innerWidth && box.bottom <= window.innerHeight,
        box: { left: Math.round(box.left), top: Math.round(box.top), width: Math.round(box.width), height: Math.round(box.height) },
        tree: { right: Math.round(tree.right), top: Math.round(tree.top) },
    };
})()`;

// The centre mode and the pair it shows, each value as it was set, recorded by subscription: the conversation itself is another
// task's, and a pane that is not there yet sends the centre back to the terminal at once
const startRec = (h) =>
    AC.agentPage(
        h,
        `const { centerModeAtom, pairSelAtom } = await mod("app/view/agents/agentcenter.ts");
        window.__treeRec?.stop();
        // from a clean start: setting the same value again is no change
        globalStore.set(centerModeAtom, "terminal");
        globalStore.set(pairSelAtom, null);
        const rec = { mode: [], sel: [] };
        const subs = [
            globalStore.sub(centerModeAtom, () => rec.mode.push(globalStore.get(centerModeAtom))),
            globalStore.sub(pairSelAtom, () => rec.sel.push(globalStore.get(pairSelAtom))),
        ];
        rec.stop = () => subs.forEach((off) => off());
        window.__treeRec = rec;
        return true;`
    );
const readRec = (h) => AC.agentPage(h, `const r = window.__treeRec; return r ? { mode: r.mode, sel: r.sel } : null;`);
const stopRec = (h) =>
    AC.agentPage(
        h,
        `const { centerModeAtom, pairSelAtom } = await mod("app/view/agents/agentcenter.ts");
        window.__treeRec?.stop();
        delete window.__treeRec;
        globalStore.set(centerModeAtom, "terminal");
        globalStore.set(pairSelAtom, null);
        return true;`
    );

const focusedId = (h) => AC.agentPage(h, `return globalStore.get(agentsModel().focusIdAtom);`);
const clearPicks = (h) =>
    AC.agentPage(
        h,
        `const { rowSelectionAtom } = await mod("app/view/agents/agenttree.tsx");
        globalStore.set(rowSelectionAtom, { ids: [], anchor: null });
        return true;`
    );

// the roster of pair-fixtures.mjs, a folder on every agent, and a codex agent that cannot be paired
function treeRoster(now) {
    const roster = pairRoster(now).map((a) => ({ ...a, cwd: FOLDER }));
    roster.push({
        id: CODEX,
        name: "Codex review",
        project: PAIR.project,
        task: "Review the pilot harness",
        state: "idle",
        agent: "codex",
        model: "gpt 5",
        usage: { contextpct: 20, contextmax: 200000 },
        idleSince: now - 90_000,
        blockId: "fx-blk-pair-codex",
        previousInfo: [{ kind: "message", text: "Reviewed the harness." }],
        cwd: FOLDER,
    });
    return roster;
}

// the pair wavesrv would answer PairStart with for the worker and the judge the sheet named: a fresh one, no message yet
function madePair(now, roster, workerTab, judgeTab) {
    const side = (tab) => ({ tab, name: roster.find((a) => a.id === tab).name, harness: "claude" });
    return {
        ...pairView(now, { judges: 1 }),
        id: "pair-fx-tree",
        worker: side(workerTab),
        judges: [side(judgeTab)],
        messages: [],
        messagecount: 0,
        decided: { asks: [], agreed: [], open: [] },
    };
}

export default function (kit) {
    const { polishWaitFor, polishNap } = kit;
    const until = (h, expr, ms = WAIT_MS) => polishWaitFor(h, expr, ms);

    // the picks are the worker's row (plain click) and `second`'s (Ctrl+click): the worker is the first picked
    const pick = async (h, second) => {
        await mouseOn(h, rowOf(PAIR.worker));
        await clearPicks(h);
        await mouseOn(h, rowOf(second), { modifiers: TOGGLE_BIT });
        return until(h, `${PICKED}.length === 2`);
    };
    // the picked row's menu, by a real right click; the items it lists
    const openMenu = async (h, id) => {
        await mouseOn(h, rowOf(id), { button: "right" });
        await until(h, `${MENU_ITEMS}.length > 0`);
        return h.ev(MENU_ITEMS);
    };
    const closeMenu = async (h) => {
        await pressEscape(h);
        return until(h, `!document.querySelector("[data-menu-item]")`);
    };
    // the sheet, opened from the menu of the picked rows. With a tree element holding the focus first, so that a Cancel has
    // somewhere to give it back to: the menu is raised by a synthetic contextmenu event (a real right click would move the focus
    // to the page, since the tree's rows take none), which reaches the row's own handler as the click does
    const openSheet = async (h, id) => {
        await h.ev(`${FOLDER_ROW}?.focus()`);
        await h.ev(`(() => {
            const r = document.querySelector(${JSON.stringify(rowOf(id))}).getBoundingClientRect();
            document.querySelector(${JSON.stringify(rowOf(id))}).dispatchEvent(
                new MouseEvent("contextmenu", { bubbles: true, cancelable: true, button: 2, clientX: r.x + r.width / 2, clientY: r.y + r.height / 2 })
            );
        })()`);
        await until(h, `${MENU_ITEMS}.includes(${JSON.stringify(PAIR_ITEM)})`);
        await chooseItem(h, PAIR_ITEM);
        return until(h, `!!${SHEET}`);
    };
    const sheetGone = (h) => until(h, `!${SHEET}`);

    return [
        {
            name: NAME,
            surface: "agent",
            async arrange(h) {
                const ctx = {};
                try {
                    await h.goto("agent");
                    ctx.now = Date.now();
                    ctx.roster = treeRoster(ctx.now);
                    await AC.setRoster(h, ctx.roster);
                    await seedPair(h, []);
                    await stubPairRpc(h);
                    await AC.focusAgent(h, PAIR.worker);
                    ctx.ready = await until(
                        h,
                        [PAIR.worker, PAIR.judge, PAIR.other, CODEX].map((id) => `!!document.querySelector('${rowOf(id)}')`).join(" && ")
                    );
                } catch (e) {
                    ctx.arrangeError = String(e?.message ?? e);
                }
                return ctx;
            },
            async assert(h, ctx) {
                const steps = [];
                const rec = (step, ok, detail) => steps.push({ step, ok: ok === true, detail: typeof detail === "string" ? detail : JSON.stringify(detail) });
                rec("0. the fixture roster (the pair's agents, one more claude agent and a codex one) was seeded with no pair", ctx.arrangeError == null && ctx.ready === true, ctx.arrangeError ?? { ready: ctx.ready });
                if (ctx.arrangeError != null || ctx.ready !== true) return steps;

                // 1. tree-menu: the worker's row clicked and another claude agent's Ctrl+clicked, neither in a pair: the right-click
                // menu offers Pair: worker + judge, first and right above Discuss together (which is still there). Not offered with
                // either one in a pair, with a codex agent among them or with three picked.
                const picked = await pick(h, PAIR.other);
                const pickedIds = await h.ev(PICKED);
                const items = await openMenu(h, PAIR.worker);
                const pairAt = items.indexOf(PAIR_ITEM);
                // the row's words, its tooltip, and whether its label was cut to make room for the hint
                const row = await h.ev(`(() => {
                    const el = document.querySelector('[data-menu-item="${PAIR_ITEM}"]');
                    const label = el?.querySelector("span.truncate");
                    return el
                        ? { text: el.innerText.replace(/\\s+/g, " ").trim(), title: el.getAttribute("title"), cut: label.scrollWidth > label.clientWidth }
                        : null;
                })()`);
                await shot(h, "1-menu");
                await closeMenu(h);

                await seedPair(h, [pairView(ctx.now, { judges: 1 })]); // the worker and the judge are paired
                await pick(h, PAIR.judge);
                const paired = await openMenu(h, PAIR.worker);
                await closeMenu(h);
                await seedPair(h, []);

                await pick(h, CODEX);
                const withCodex = await openMenu(h, PAIR.worker);
                await closeMenu(h);

                await pick(h, PAIR.other);
                await mouseOn(h, rowOf(PAIR.judge), { modifiers: TOGGLE_BIT }); // a third
                const three = await h.ev(PICKED);
                const withThree = await openMenu(h, PAIR.worker);
                await closeMenu(h);
                rec(
                    "tree-menu: with the worker and another claude agent picked, in no pair, the right-click menu has Pair: worker + judge, its label whole beside the hint \"they talk it through\" and \"the two talk it through, you get what they settled\" as its tooltip, first and right above Discuss together; with either one in a pair, with a codex agent picked or with three picked it has no Pair item",
                    picked &&
                        sameIds(pickedIds, [PAIR.worker, PAIR.other]) &&
                        pairAt === 0 &&
                        items[pairAt + 1] === DISCUSS_ITEM &&
                        row?.text === `${PAIR_ITEM} they talk it through` &&
                        row.title === "The two talk it through, you get what they settled" &&
                        row.cut === false &&
                        !paired.includes(PAIR_ITEM) &&
                        paired.includes(DISCUSS_ITEM) &&
                        !withCodex.includes(PAIR_ITEM) &&
                        three.length === 3 &&
                        !withThree.includes(PAIR_ITEM) &&
                        withThree.includes(DISCUSS_ITEM),
                    { pickedIds, items, row, paired, withCodex, three, withThree }
                );

                // 2. pair-sheet: the two picked again; Pair: worker + judge opens K1's sheet beside the tree, the worker first picked
                // working and the other judging, each with its short id, Swap, the hold box ticked ("tests, builds, Docker, long
                // commands"), the note, the cap at 3 million, Cancel and Pair, with the focus on Pair. Escape closes it and so does
                // Cancel, each giving the focus back to the tree element that held it.
                await mouseOn(h, rowOf(PAIR.judge), { modifiers: TOGGLE_BIT }); // the third off again
                await until(h, `${PICKED}.length === 2`);
                const opened = await openSheet(h, PAIR.worker);
                await polishNap(500); // the sheet has popped in
                const sheet = await h.ev(readSheet);
                const picksKept = sameIds(await h.ev(PICKED), [PAIR.worker, PAIR.other]);
                await shot(h, "2-sheet");
                await pressEscape(h);
                const escGone = await sheetGone(h);
                const escFocus = await h.ev(`document.activeElement === ${FOLDER_ROW}`);
                const escPicks = sameIds(await h.ev(PICKED), [PAIR.worker, PAIR.other]);
                const reopened = await openSheet(h, PAIR.worker);
                await mouseOn(h, "[data-pair-sheet] [data-pair-cancel]");
                const cancelGone = await sheetGone(h);
                const cancelFocus = await h.ev(`document.activeElement === ${FOLDER_ROW}`);
                const noCalls = (await pairRpcCalls(h, "PairStartCommand")).length === 0;
                rec(
                    "pair-sheet: Pair: worker + judge opens the pairing sheet beside the tree: Works the first picked and Judges the other, each with its short id, Swap, the hold box ticked with its words, the note, the token cap at 3 million, Cancel and Pair focused; Escape and Cancel each close it, give the focus back to the tree and leave the picks and PairStart alone",
                    opened &&
                        sheet?.role === "dialog" &&
                        sheet.label === PAIR_ITEM &&
                        sheet.ownsKeys === true &&
                        sheet.title === PAIR_ITEM &&
                        sheet.labels.join("|") === "Works|Judges" &&
                        sheet.worker?.tab === PAIR.worker &&
                        sheet.worker.text === "Plan oracle-tightening 61483cd6" &&
                        sheet.judge?.tab === PAIR.other &&
                        sheet.judge.text === "Pull history and sync 9e0f1a2b" &&
                        sheet.swap === "Swap" &&
                        sheet.hold?.checked === true &&
                        sheet.hold.text === "Hold heavy commands until the judge answers tests, builds, Docker, long commands" &&
                        sheet.noteLabel === "Note to the judge (optional)" &&
                        sheet.noteValue === "" &&
                        sheet.cap === "3" &&
                        sheet.capInvalid === "false" &&
                        sheet.cancel.text === "Cancel" &&
                        sheet.submit.text === "Pair" &&
                        sheet.submit.disabled === false &&
                        sheet.focusOnSubmit === true &&
                        sheet.beside === true &&
                        sheet.onScreen === true &&
                        picksKept &&
                        escGone &&
                        escFocus &&
                        escPicks &&
                        reopened &&
                        cancelGone &&
                        cancelFocus &&
                        noCalls,
                    { opened, sheet, picksKept, escGone, escFocus, escPicks, reopened, cancelGone, cancelFocus, noCalls }
                );

                // 3. swap: Swap trades the sides, the names and the short ids with them, and trades back; nothing else in the sheet moves
                const open3 = await openSheet(h, PAIR.worker);
                await mouseOn(h, "[data-pair-sheet] [data-pair-swap]");
                await until(h, `${SHEET}?.querySelector('[data-pair-side="worker"]')?.dataset.pairSideTab === "${PAIR.other}"`);
                await polishNap(700); // the names have faded in
                const swapped = await h.ev(readSheet);
                await shot(h, "3-swapped");
                await mouseOn(h, "[data-pair-sheet] [data-pair-swap]");
                await until(h, `${SHEET}?.querySelector('[data-pair-side="worker"]')?.dataset.pairSideTab === "${PAIR.worker}"`);
                await polishNap(700);
                const back = await h.ev(readSheet);
                rec(
                    "swap: Swap puts the other agent on Works and the first picked on Judges, each with its own short id, and a second press puts them back; the hold box, the note and the cap stay as they were",
                    open3 &&
                        swapped?.worker?.tab === PAIR.other &&
                        swapped.worker.text === "Pull history and sync 9e0f1a2b" &&
                        swapped.judge?.tab === PAIR.worker &&
                        swapped.judge.text === "Plan oracle-tightening 61483cd6" &&
                        swapped.hold?.checked === true &&
                        swapped.cap === "3" &&
                        back?.worker?.tab === PAIR.worker &&
                        back.worker.text === "Plan oracle-tightening 61483cd6" &&
                        back.judge?.tab === PAIR.other &&
                        back.judge.text === "Pull history and sync 9e0f1a2b",
                    { open3, swapped: swapped && { worker: swapped.worker, judge: swapped.judge }, back: back && { worker: back.worker, judge: back.judge } }
                );

                // 4. pair-sent: a cap out of bounds stops Pair and says so; a refusal from wavesrv reads in the sheet and leaves it
                // open; then Pair calls the stubbed PairStartCommand with the sheet's values (the sides as swapped, the hold unticked,
                // the note, the cap in tokens), closes the sheet, clears the picks, chooses the working agent and opens the pair's
                // conversation
                await mouseOn(h, "[data-pair-sheet] [data-pair-swap]"); // the other agent works, the first picked judges
                await until(h, `${SHEET}?.querySelector('[data-pair-side="worker"]')?.dataset.pairSideTab === "${PAIR.other}"`);
                await mouseOn(h, "[data-pair-sheet] [data-pair-hold]");
                await typeInto(h, "[data-pair-sheet] [data-pair-note]", "Judge the oracle plan, read the real code");
                await typeInto(h, "[data-pair-sheet] [data-pair-cap]", "0");
                await until(h, `${SHEET}?.querySelector("[data-pair-submit]")?.disabled === true`);
                const badCap = await h.ev(readSheet);
                await shot(h, "4a-bad-cap");
                await typeInto(h, "[data-pair-sheet] [data-pair-cap]", "2,5");
                await until(h, `${SHEET}?.querySelector("[data-pair-submit]")?.disabled === false`);
                const goodCap = await h.ev(readSheet);
                const expected = {
                    workertab: PAIR.other,
                    judgetab: PAIR.worker,
                    holdheavy: false,
                    tokencap: 2_500_000,
                    note: "Judge the oracle plan, read the real code",
                    briefed: false,
                };

                // the refusal: PairStart rejects, as wavesrv does for an agent already in a pair
                const refusal = "agent 4c6ba858 is already in a pair";
                await AC.agentPage(
                    h,
                    `const { RpcApi } = await mod("app/store/wshclientapi.ts");
                    RpcApi.PairStartCommand = async (_c, d) => {
                        ((window.__pairFx ??= { calls: {} }).calls.PairStartCommand ??= []).push(structuredClone(d));
                        throw new Error(${JSON.stringify(refusal)});
                    };
                    return true;`
                );
                await startRec(h);
                await mouseOn(h, "[data-pair-sheet] [data-pair-submit]");
                await until(h, `!!${SHEET}?.querySelector("[data-pair-error]")`);
                await polishNap(200);
                const refused = await h.ev(readSheet);
                const refusedRec = await readRec(h);
                await shot(h, "4b-refused");

                // the pair is made: wavesrv lists it, and PairStart answers with it
                await stubPairRpc(h);
                await seedPair(h, [madePair(ctx.now, ctx.roster, PAIR.other, PAIR.worker)]);
                await mouseOn(h, "[data-pair-sheet] [data-pair-submit]");
                const closed = await sheetGone(h);
                await polishNap(300);
                const calls = await pairRpcCalls(h, "PairStartCommand");
                const sent = await readRec(h);
                const focus = await focusedId(h);
                const stillPicked = await h.ev(PICKED);
                rec(
                    "pair-sent: a cap of 0 disables Pair and says the range, 2,5 enables it; a refusal reads in the sheet and keeps it open with the centre alone; Pair then calls PairStartCommand with the swapped sides, the hold unticked, the note and 2,500,000 tokens, closes the sheet, clears the picks, chooses the working agent and opens the pair's conversation",
                    badCap?.submit.disabled === true &&
                        badCap.capInvalid === "true" &&
                        badCap.capHint === "A number from 0.5 to 100" &&
                        goodCap?.submit.disabled === false &&
                        goodCap.capInvalid === "false" &&
                        refused?.error === refusal &&
                        refused.submit.disabled === false &&
                        refused.submit.text === "Pair" &&
                        refused.cancel.disabled === false &&
                        refusedRec?.mode.length === 0 &&
                        calls.length === 2 &&
                        JSON.stringify(calls[0]) === JSON.stringify(expected) &&
                        JSON.stringify(calls[1]) === JSON.stringify(expected) &&
                        closed &&
                        sent?.mode[0] === "pair" &&
                        sent.sel[0] === "pair-fx-tree" &&
                        focus === PAIR.other &&
                        stillPicked.length === 0,
                    { badCap: badCap && { submit: badCap.submit, capInvalid: badCap.capInvalid, capHint: badCap.capHint }, goodCap: goodCap && goodCap.submit, refused: refused && { error: refused.error, submit: refused.submit, cancel: refused.cancel }, refusedRec, calls, closed, sent, focus, stillPicked }
                );
                return steps;
            },
            async teardown(h) {
                const failures = [];
                const attempt = async (what, fn) => {
                    try {
                        await fn();
                    } catch (e) {
                        failures.push(`${what}: ${e?.message ?? e}`);
                    }
                };
                await attempt("close the sheet", async () => {
                    if (await h.ev(`!!${SHEET}`)) {
                        await pressEscape(h);
                    }
                });
                await attempt("put the centre back and stop recording", () => stopRec(h));
                await attempt("clear the picks", () => clearPicks(h));
                await attempt("forget what the fixture pair showed as seen", () =>
                    AC.agentPage(
                        h,
                        `const { pairSeenAtom } = await mod("app/view/agents/pairstore.ts");
                        globalStore.set(pairSeenAtom("pair-fx-tree"), 0);
                        return true;`
                    )
                );
                await attempt("drop the stubbed pair commands", () => restorePairRpc(h));
                await attempt("drop the fixture pairs", () => seedPair(h, null));
                await attempt("drop the fixture roster", () => AC.restoreRoster(h));
                if (failures.length > 0) throw new Error(failures.join("; "));
            },
        },
    ];
}
