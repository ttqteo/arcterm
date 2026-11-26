// pair-tree: board K1, Pair from the Agent tree and the pairing sheet
// (docs/superpowers/specs/2026-11-25-agent-pair-judge-design.md; frontend/app/view/agents/agenttree.tsx, pairsheet.tsx,
// pairsheetmodel.ts, agenttreemodel.ts pairPickable). Over pair-fixtures.mjs: the roster (a codex agent added, and each agent
// given a folder so Discuss together can seat it) goes in the page's dev mock roster, the pairs in its dev mock pairs, and the
// eight RpcApi.Pair*Command methods are stubs that record their calls, so no agent runs and wavesrv is never asked about a pair.
// The tree is driven with real clicks: a click on the worker's row, Ctrl+click on another, right click, and a real pointer over a
// pair's row for the buttons that show on hover.
//
// Steps: tree-menu (two picked, neither in a pair: the menu offers Pair: worker + judge right above Discuss together; not with
// either in a pair, a codex agent among them or three picked), pair-sheet (K1's sheet beside the tree: who works and who
// judges, Swap, the hold box, the note, the cap, Cancel and Pair; Escape and Cancel close it and give the focus back), swap
// (the sides trade, and trade back), pair-sent (a cap out of bounds stops Pair; a refusal reads in the sheet and keeps it open;
// Pair calls PairStartCommand with the sheet's values, closes the sheet, and opens the pair's conversation with the worker chosen),
// line-live (a relaying pair is a ⚖ line inside the worker's row: the judge's state in words and its tokens, no row of the
// judge's own; a click on the line opens the conversation, a click elsewhere on the row the worker), line-stopped (a stopped
// pair's line says why in the pause card's words, and its Judge again and Resume show on hover; docs/superpowers/specs/
// 2026-11-26-pair-judge-round-design.md), line-asking (a judge that asks is the line in the warning tone, and a click opens
// the judge's own view), round-ended (with no active pair a resting judge that sleeps has no row and the worker's row no line,
// and a woken judge is a plain row again), then the line's buttons in detail (pausedPairView): row-resume (Resume is faded
// out until the pointer is on the row, a press calls PairResumeCommand once and the button leaves, the line stays and the
// conversation does not open), row-resume-fails (the line's error text and the button's tooltip), row-judge-again (a pair
// stopped on no new points offers Judge again, a press opens the conversation with `@judge ` in the composer), row-relaying (a
// relaying line has neither).
//
// DOM contract: the tree is [data-agent-tree], its agent rows [data-agent-row="<tab>"] (picked: [data-agent-picked]); the right-click
// menu's rows [data-menu-item="<label>"]; the sheet [data-pair-sheet] (a dialog) holding [data-pair-side="worker|judge"]
// ([data-pair-side-tab]), [data-pair-swap], [data-pair-hold], [data-pair-note], [data-pair-cap] with [data-pair-cap-hint],
// [data-pair-error], [data-pair-cancel] and [data-pair-submit]. The ⚖ line is [data-pair-judge-line="<pair id>"] inside the
// working agent's row ([data-pair-judge-tone] "normal" or "warning"), holding the button that opens it [data-pair-judge-open],
// [data-pair-judge-words], [data-pair-judge-tokens] and [data-pair-judge-new]; on a stopped pair of this machine its floating
// buttons are [data-pair-judge-resume] and [data-pair-judge-rerun] (faded in by the row's hover or the focus inside them), and
// under it a live region [aria-live] holds [data-pair-judge-error] after a failed Resume.
//
// kit is scenarios.mjs's RT_KIT.

import * as AC from "./agent-page-fixtures.mjs";
import {
    PAIR,
    pairRoster,
    pairRpcCalls,
    pairView,
    pausedPairView,
    RESUME_ERROR,
    restorePairRpc,
    seedPair,
    seedResting,
    setPairResumeFails,
    stubPairRpc,
} from "./pair-fixtures.mjs";

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

// a real click `dx` px in from the left edge of the first element `selector` matches, at `dy` px below its top (its vertical
// middle when `dy` is left out): where the line's floating buttons, which cover its right end while the row is hovered, are not
async function mouseNear(h, selector, { dx = 14, dy = null, button = "left", modifiers = 0 } = {}) {
    const box = await h.ev(`(() => {
        const el = document.querySelector(${JSON.stringify(selector)});
        el?.scrollIntoView({ block: "nearest" });
        const r = el?.getBoundingClientRect();
        return r && r.width > 0 ? { x: Math.round(r.x + ${dx}), y: Math.round(r.y + (${dy} ?? r.height / 2)) } : null;
    })()`);
    if (box == null) return false;
    const held = button === "right" ? 2 : 1;
    await h.cdp("Input.dispatchMouseEvent", { type: "mouseMoved", x: box.x, y: box.y, modifiers });
    for (const [type, buttons] of [["mousePressed", held], ["mouseReleased", 0]]) {
        await h.cdp("Input.dispatchMouseEvent", { type, x: box.x, y: box.y, button, buttons, clickCount: 1, modifiers });
    }
    return true;
}

// a click on an agent row's name line, above the ⚖ line a paired working agent's row carries under it (a click there is the line's
// own and would open the conversation, not select the row)
const NAME_LINE = { dx: 60, dy: 12 };

// a real pointer moved to the middle of the first element `selector` matches, with no click (a hover needs a real move); false when
// it is not on screen
async function hoverOn(h, selector) {
    const box = await h.ev(`(() => {
        const el = document.querySelector(${JSON.stringify(selector)});
        el?.scrollIntoView({ block: "nearest" });
        const r = el?.getBoundingClientRect();
        return r && r.width > 0 ? { x: Math.round(r.x + r.width / 2), y: Math.round(r.y + r.height / 2) } : null;
    })()`);
    if (box == null) return false;
    await h.cdp("Input.dispatchMouseEvent", { type: "mouseMoved", x: box.x, y: box.y });
    return true;
}

// the pointer off the tree (the window's top-left corner), so no row is hovered
const leaveTree = (h) => h.cdp("Input.dispatchMouseEvent", { type: "mouseMoved", x: 2, y: 2 });

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
        await mouseNear(h, rowOf(PAIR.worker), NAME_LINE);
        await clearPicks(h);
        await mouseNear(h, rowOf(second), { ...NAME_LINE, modifiers: TOGGLE_BIT });
        return until(h, `${PICKED}.length === 2`);
    };
    // the picked row's menu, by a real right click; the items it lists
    const openMenu = async (h, id) => {
        await mouseNear(h, rowOf(id), { ...NAME_LINE, button: "right" });
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

                // the worker is paired (its judge has no row of its own to pick: the ⚖ line speaks for it)
                await seedPair(h, [pairView(ctx.now, { judges: 1 })]);
                await pick(h, PAIR.other);
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
                    "tree-menu: with the worker and another claude agent picked, in no pair, the right-click menu has Pair: worker + judge, its label whole beside the hint \"they talk it through\" and \"the two talk it through, you get what they settled\" as its tooltip, first and right above Discuss together; with the worker in a pair, with a codex agent picked or with three picked it has no Pair item",
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

                // ---- the ⚖ line inside the working agent's row (docs/superpowers/specs/2026-11-26-pair-judge-round-design.md) ----
                await stopRec(h);
                const WORKER_ROW = rowOf(PAIR.worker);
                const LINE = `${WORKER_ROW} [data-pair-judge-line="${PAIR.id}"]`;
                const OPEN = `${LINE} [data-pair-judge-open]`;
                const WORDS = `${LINE} [data-pair-judge-words]`;
                const BTN_RESUME = `${LINE} [data-pair-judge-resume]`;
                const BTN_AGAIN = `${LINE} [data-pair-judge-rerun]`;
                // the line as a step reads it: its words, tokens, tone and new-message count, whether the button that opens it reads as
                // selected and whether the working agent's row does, how many lines the tree draws, and the agent rows in the order drawn
                // (the judge has none of its own while the line speaks for it)
                const readLine = `(() => {
                    const row = document.querySelector('${WORKER_ROW}');
                    const line = row?.querySelector("[data-pair-judge-line]");
                    const flat = (el) => (el?.innerText ?? "").replace(/\\s+/g, " ").trim();
                    return {
                        row: row != null,
                        line: line != null,
                        words: line ? flat(line.querySelector("[data-pair-judge-words]")) : null,
                        tokens: line?.querySelector("[data-pair-judge-tokens]") ? flat(line.querySelector("[data-pair-judge-tokens]")) : null,
                        fresh: line?.querySelector("[data-pair-judge-new]")?.getAttribute("data-pair-judge-new") ?? null,
                        tone: line?.getAttribute("data-pair-judge-tone") ?? null,
                        selected: line?.querySelector("[data-pair-judge-open]")?.className.includes("bg-surface-selected") ?? null,
                        rowSelected: row?.className.includes("bg-surface-selected") ?? null,
                        lines: document.querySelectorAll("[data-agent-tree] [data-pair-judge-line]").length,
                        order: [...document.querySelectorAll("[data-agent-tree] [data-agent-row]")].map((el) => el.getAttribute("data-agent-row")),
                    };
                })()`;
                // the centre, the agent chosen and whether the rail is on Decided, as the conversation's opening leaves them
                const readCentre = () =>
                    AC.agentPage(
                        h,
                        `const { centerModeAtom, pairSelAtom } = await mod("app/view/agents/agentcenter.ts");
                        const tab = document.querySelector('aside[aria-label="Agent details"] [data-rail-tab="decided"]');
                        return {
                            mode: globalStore.get(centerModeAtom),
                            sel: globalStore.get(pairSelAtom),
                            focus: globalStore.get(agentsModel().focusIdAtom),
                            decided: tab?.getAttribute("aria-selected") ?? null,
                        };`
                    );
                const centreNow = () => readCentre().then(({ mode, sel }) => ({ mode, sel }));
                // what the pause card's words offer a view, worked out in the page by the one function that words them (pairpause.ts), so
                // no label is written here to drift from the app's
                const offered = (view) =>
                    AC.agentPage(
                        h,
                        `const { pauseActions } = await mod("app/view/agents/pairpause.ts");
                        return pauseActions(${JSON.stringify(view)}, { local: true });`
                    );
                const forgetSeen = () =>
                    AC.agentPage(
                        h,
                        `const { pairSeenAtom } = await mod("app/view/agents/pairstore.ts");
                        globalStore.set(pairSeenAtom(${JSON.stringify(PAIR.id)}), 0);
                        return true;`
                    );
                // the roster with the judge changed: asking you (its ask card is the page's), or asleep, or as it was
                const withJudge = (change) => ctx.roster.map((a) => (a.id === PAIR.judge ? { ...a, ...change } : a));

                // 5. line-live: a relaying pair is a ⚖ line inside its working agent's row, under the name: "judge reviewing" with the
                // judges' tokens (1.2M) and the 5 messages not read yet; the judge has no row of its own. A click on the line opens the
                // conversation (the centre on the pair, the working agent chosen, the rail on Decided) and the line reads selected, with
                // no new count; a click on the row's name line opens the working agent's terminal again
                await seedPair(h, [pairView(ctx.now, { judges: 1 })]);
                await forgetSeen();
                await AC.focusAgent(h, PAIR.other);
                const there5 = await until(h, `!!document.querySelector('${LINE}')`);
                await polishNap(500); // the line has grown in
                const live5 = await h.ev(readLine);
                await shot(h, "5-line-live");
                await startRec(h);
                await mouseNear(h, OPEN);
                const opened5 = await until(h, `!!document.querySelector("[data-pair-pane]")`);
                await polishNap(300);
                const shown5 = await readCentre();
                const onLine5 = await h.ev(readLine);
                await shot(h, "5-line-live-opened");
                await mouseNear(h, WORKER_ROW, NAME_LINE);
                const back5 = await until(h, `!document.querySelector("[data-pair-pane]")`);
                const centre5 = await readCentre();
                rec(
                    "line-live: a relaying pair is one [data-pair-judge-line] inside its working agent's row, saying \"judge reviewing\" with the judges' 1.2M tokens and 5 new messages in the normal tone, and the judge has no agent row of its own; a click on the line opens the conversation (centre on the pair, the working agent chosen, the rail on Decided) and the line reads selected with no new count, and a click on the row's name line opens the working agent's terminal again",
                    there5 &&
                        live5.row &&
                        live5.line &&
                        live5.lines === 1 &&
                        live5.words === "judge reviewing" &&
                        live5.tokens === "1.2M" &&
                        live5.fresh === "5" &&
                        live5.tone === "normal" &&
                        live5.selected === false &&
                        live5.order.includes(PAIR.worker) &&
                        !live5.order.includes(PAIR.judge) &&
                        opened5 &&
                        shown5.mode === "pair" &&
                        shown5.sel === PAIR.id &&
                        shown5.focus === PAIR.worker &&
                        shown5.decided === "true" &&
                        onLine5.selected === true &&
                        onLine5.fresh === null &&
                        back5 &&
                        centre5.mode === "terminal" &&
                        centre5.focus === PAIR.worker,
                    { there5, live5, shown5, onLine5, back5, centre5 }
                );

                // the buttons on the line of a stopped pair (the pair of pair-fixtures, stopped by pausedPairView)
                const resumeCalls = async () => (await pairRpcCalls(h, "PairResumeCommand")).length;
                // the line's buttons as a step reads them: each one's words, state, tooltip and name, whether its floating box is faded
                // in and takes the pointer, and whether it sits level with the line's words; the live region, and the error text with the
                // region that holds it. The tooltip is read from `title` or, while the pointer is on the button, from `data-arc-title`:
                // TitleTipHost (titletiphost.tsx) lifts a hovered element's `title` into that attribute while its tip shows, so `title`
                // alone reads null under the pointer, though the words are the app's
                const readActions = (h2) =>
                    h2.ev(`(() => {
                        const line = document.querySelector('${LINE}');
                        if (!line) return null;
                        const flat = (el) => (el?.textContent ?? "").replace(/\\s+/g, " ").trim();
                        const words = line.querySelector("[data-pair-judge-words]").getBoundingClientRect();
                        const btn = (sel) => {
                            const b = line.querySelector(sel);
                            if (!b) return null;
                            const box = getComputedStyle(b.parentElement);
                            const r = b.getBoundingClientRect();
                            return {
                                text: flat(b),
                                tag: b.tagName,
                                disabled: b.disabled,
                                title: b.getAttribute("title") ?? b.getAttribute("data-arc-title"),
                                label: b.getAttribute("aria-label"),
                                opacity: box.opacity,
                                events: box.pointerEvents,
                                onLine: Math.abs((r.top + r.bottom) / 2 - (words.top + words.bottom) / 2) <= 6,
                            };
                        };
                        const err = line.querySelector("[data-pair-judge-error]");
                        return {
                            resume: btn("[data-pair-judge-resume]"),
                            judgeAgain: btn("[data-pair-judge-rerun]"),
                            live: line.querySelector("[aria-live]")?.getAttribute("aria-live") ?? null,
                            error: err ? { text: flat(err), inLive: err.closest("[aria-live]") != null } : null,
                            selected: document.querySelector('${WORKER_ROW}').className.includes("bg-surface-selected"),
                        };
                    })()`);
                // a stopped pair's line, the centre on the terminal of another agent and the pointer off the tree: the pair seeded stopped
                // for `opts`, and the line there once `wait` is true: its words are `wait.words`, or its button `wait.button` is drawn
                const showStopped = async (opts, wait) => {
                    await stopRec(h);
                    await startRec(h);
                    const view = pausedPairView(ctx.now, opts);
                    await seedPair(h, [view]);
                    await AC.focusAgent(h, PAIR.other);
                    const there = await until(
                        h,
                        wait.words != null
                            ? `document.querySelector('${WORDS}')?.innerText.trim() === ${JSON.stringify(wait.words)}`
                            : `!!document.querySelector('${wait.button}')`
                    );
                    await leaveTree(h);
                    await polishNap(300);
                    return { there, view };
                };
                // the pointer over the line's words (the buttons float over the line's right end), then the buttons are in
                const hoverRow = async (buttonSel) => {
                    const over = await hoverOn(h, WORDS);
                    await polishNap(300);
                    return over && (await until(h, `getComputedStyle(document.querySelector('${buttonSel}').parentElement).opacity === "1"`));
                };

                // 6. line-stopped: a stopped pair's line says why in the pause card's words (no new points, both agree, token cap, no
                // judge left) whatever the judge's own state: the roster's judge is at work, yet the pair is stopped. With no new points
                // the pointer on the row brings Judge again, with the words pauseActions gives; at the token cap with something queued
                // Resume shows with the words pauseActions gives (worked out in the page), and a press records one PairResumeCommand
                const STOP_WORDS = {
                    "no-new-points": "judge paused: no new points",
                    settled: "judge paused: both agree",
                    "token-cap": "judge paused: token cap",
                    "judges-gone": "judge paused: no judge left",
                };
                const stopWords = {};
                for (const reason of Object.keys(STOP_WORDS)) {
                    await showStopped({ reason, canresume: reason === "token-cap" }, { words: STOP_WORDS[reason] });
                    stopWords[reason] = (await h.ev(readLine)).words;
                }
                const { there: there6a, view: view6a } = await showStopped({ reason: "no-new-points" }, { button: BTN_AGAIN });
                const want6a = await offered(view6a);
                const idle6a = await readActions(h);
                const hovered6a = await hoverRow(BTN_AGAIN);
                const hover6a = await readActions(h);
                await shot(h, "6-line-stopped");
                const { there: there6b, view: view6b } = await showStopped({ reason: "token-cap", canresume: true }, { button: BTN_RESUME });
                const want6b = await offered(view6b);
                const words6b = (await h.ev(readLine)).words;
                const hovered6b = await hoverRow(BTN_RESUME);
                const hover6b = await readActions(h);
                const before6b = await resumeCalls();
                await mouseNear(h, BTN_RESUME);
                const gone6b = await until(h, `!document.querySelector('${BTN_RESUME}')`);
                const sent6b = (await pairRpcCalls(h, "PairResumeCommand")).slice(before6b);
                rec(
                    "line-stopped: a stopped pair's line reads \"judge paused: no new points\", \"…: both agree\", \"…: token cap\" and \"…: no judge left\" for each stop though the roster's judge is at work; with no new points the pointer on the row brings an enabled Judge again with the words pauseActions gives and no Resume; at the token cap with something queued it brings an enabled Resume with the words pauseActions gives, and a press records exactly one PairResumeCommand for the pair and takes the button away",
                    JSON.stringify(stopWords) === JSON.stringify(STOP_WORDS) &&
                        there6a &&
                        want6a.judgeAgain != null &&
                        want6a.resume === null &&
                        hovered6a &&
                        hover6a?.judgeAgain?.text === want6a.judgeAgain &&
                        hover6a.judgeAgain.disabled === false &&
                        hover6a.resume === null &&
                        there6b &&
                        want6b.resume != null &&
                        words6b === "judge paused: token cap" &&
                        hovered6b &&
                        hover6b?.resume?.text === want6b.resume &&
                        hover6b.resume.disabled === false &&
                        sent6b.length === 1 &&
                        JSON.stringify(sent6b[0]) === JSON.stringify({ pairid: PAIR.id }) &&
                        gone6b,
                    { stopWords, there6a, want6a, idle6a, hover6a, there6b, want6b, words6b, hover6b, sent6b, gone6b }
                );

                // 7. line-asking: a judge that asks you is the line in the warning tone ("judge is asking you"), and a click on it opens
                // the judge's own view (the judge chosen, the terminal in the centre), not the conversation
                await stopRec(h);
                await startRec(h);
                await seedPair(h, [pairView(ctx.now, { judges: 1 })]);
                await AC.setRoster(
                    h,
                    withJudge({
                        state: "asking",
                        blockedMs: 60_000,
                        ask: {
                            askId: "fx-pair-ask-1",
                            oref: "block:fx-blk-pair-judge",
                            questions: [
                                {
                                    header: "Threshold",
                                    question: "Is a 50% compliance threshold fine?",
                                    options: [{ label: "50%" }, { label: "60%" }],
                                },
                            ],
                        },
                    })
                );
                await AC.focusAgent(h, PAIR.other);
                const there7 = await until(h, `document.querySelector('${LINE}')?.getAttribute("data-pair-judge-tone") === "warning"`);
                await leaveTree(h);
                await polishNap(400);
                const asking7 = await h.ev(readLine);
                await shot(h, "7-line-asking");
                await mouseNear(h, OPEN);
                await polishNap(500);
                const rec7a = await readRec(h);
                const centre7 = await readCentre();
                rec(
                    "line-asking: with the judge asking you the line is in the warning tone saying \"judge is asking you\", the judge still without an agent row; a click on it chooses the judge (its own view) with the terminal in the centre and never opens the conversation",
                    there7 &&
                        asking7.words === "judge is asking you" &&
                        asking7.tone === "warning" &&
                        !asking7.order.includes(PAIR.judge) &&
                        centre7.focus === PAIR.judge &&
                        centre7.mode === "terminal" &&
                        centre7.sel === null &&
                        rec7a?.mode.length === 0,
                    { there7, asking7, centre7, rec7a }
                );
                await AC.setRoster(h, ctx.roster);

                // 8. round-ended: with no active pair the worker's row has no line; the judge, resting (its newest pair ended) and asleep,
                // has no row of its own while the worker is in the roster; once anything wakes it (the roster's `sleeping` cleared) it is
                // a plain agent row again, with no line
                await seedPair(h, [pairView(ctx.now, { judges: 1 })]);
                await AC.focusAgent(h, PAIR.other);
                await until(h, `!!document.querySelector('${LINE}')`);
                const during8 = await h.ev(readLine);
                const judgeName = ctx.roster.find((a) => a.id === PAIR.judge).name;
                await seedResting(h, [{ tab: PAIR.judge, name: judgeName, workertab: PAIR.worker, pairid: PAIR.id }]);
                await AC.setRoster(h, withJudge({ state: "idle", sleeping: { since: ctx.now - 60_000, freedBytes: 250 * 1024 * 1024 } }));
                await seedPair(h, []);
                const gone8 = await until(h, `!document.querySelector('[data-agent-tree] [data-pair-judge-line]')`);
                await leaveTree(h);
                await polishNap(500); // the line has folded away
                const ended8 = await h.ev(readLine);
                await shot(h, "8-round-ended");
                await AC.setRoster(h, withJudge({ state: "idle" }));
                const woken8 = await until(h, `!!document.querySelector('${rowOf(PAIR.judge)}')`);
                await polishNap(500);
                const after8 = await h.ev(readLine);
                await shot(h, "8-round-ended-woken");
                await seedResting(h, null);
                await AC.setRoster(h, ctx.roster);
                rec(
                    "round-ended: while the pair is active the worker's row has the line and the judge no row; with no active pair and the judge resting and asleep the worker's row has no line, the judge has no row either and no agent row is lost but the judge's; once the judge is awake it is a plain agent row again, still with no line",
                    during8.line === true &&
                        !during8.order.includes(PAIR.judge) &&
                        gone8 &&
                        ended8.row === true &&
                        ended8.line === false &&
                        ended8.lines === 0 &&
                        ended8.order.includes(PAIR.worker) &&
                        !ended8.order.includes(PAIR.judge) &&
                        JSON.stringify(ended8.order) === JSON.stringify(during8.order) &&
                        woken8 &&
                        after8.line === false &&
                        after8.order.includes(PAIR.judge),
                    { during8, gone8, ended8, woken8, after8 }
                );

                // 9. row-resume: a pair stopped at the token cap with something queued has Resume on its line, level with the words, faded
                // out until the pointer comes; hovered it reads what pauseActions says (worked out in the page) and takes the pointer. A
                // press on it calls PairResumeCommand once for the pair, leaves the conversation closed and the row unselected (the
                // click is the button's, not the row's), and once the flipped view draws the button is gone and the line stays
                const { there: there9, view: view9 } = await showStopped({ reason: "token-cap", canresume: true }, { button: BTN_RESUME });
                const label9 = (await offered(view9)).resume;
                const idle9 = await readActions(h);
                const hovered9 = await hoverRow(BTN_RESUME);
                const hover9 = await readActions(h);
                await shot(h, "9-row-resume-hover");
                const resumeBefore = await resumeCalls();
                await mouseNear(h, BTN_RESUME);
                const gone9 = await until(h, `!document.querySelector('${BTN_RESUME}')`);
                await polishNap(300);
                const resumed9 = (await pairRpcCalls(h, "PairResumeCommand")).slice(resumeBefore);
                const after9 = await readActions(h);
                const rec9 = await readRec(h);
                const centre9 = await centreNow();
                await shot(h, "9-row-resume-after");
                rec(
                    "row-resume: a pair stopped at the token cap with something queued has an enabled Resume button (the words pauseActions gives) on its line, level with the words, faded out (opacity 0, no pointer) until the pointer is over the row and then in (opacity 1); a press records exactly one PairResumeCommand for the pair, opens nothing (the centre stays on the terminal, the row not selected), and once the flipped view draws the button is gone, the line is still there, with no error text",
                    there9 &&
                        label9 != null &&
                        idle9?.resume?.text === label9 &&
                        idle9.resume.tag === "BUTTON" &&
                        idle9.resume.disabled === false &&
                        idle9.resume.opacity === "0" &&
                        idle9.resume.events === "none" &&
                        idle9.resume.onLine === true &&
                        idle9.judgeAgain === null &&
                        hovered9 &&
                        hover9?.resume?.opacity === "1" &&
                        hover9.resume.events === "auto" &&
                        resumed9.length === 1 &&
                        JSON.stringify(resumed9[0]) === JSON.stringify({ pairid: PAIR.id }) &&
                        gone9 &&
                        after9 != null &&
                        after9.resume === null &&
                        after9.judgeAgain === null &&
                        after9.error === null &&
                        after9.selected === false &&
                        rec9?.mode.length === 0 &&
                        centre9.mode === "terminal" &&
                        centre9.sel === null,
                    { there9, label9, idle9, hover9, resumed9, gone9, after9, rec9, centre9 }
                );

                // 10. row-resume-fails: with the resume stub failing, one press records one PairResumeCommand and the line says so under
                // itself, in a polite live region ("Resume failed: <the server's words>"), the button's tooltip says it too, and the
                // button stays, enabled; with the stub working a second press takes the text and the button away
                const { there: there10, view: view10 } = await showStopped({ reason: "token-cap", canresume: true }, { button: BTN_RESUME });
                const label10 = (await offered(view10)).resume;
                await setPairResumeFails(h, true);
                await hoverRow(BTN_RESUME);
                const failBefore = await resumeCalls();
                await mouseNear(h, BTN_RESUME);
                await until(h, `!!document.querySelector('${LINE} [data-pair-judge-error]')`);
                await polishNap(500);
                const failed10 = await readActions(h);
                const failedCalls = (await resumeCalls()) - failBefore;
                await shot(h, "10-row-resume-failed");
                await setPairResumeFails(h, false);
                await hoverRow(BTN_RESUME);
                await mouseNear(h, BTN_RESUME);
                const retried10 = await until(
                    h,
                    `!document.querySelector('${BTN_RESUME}') && !document.querySelector('${LINE} [data-pair-judge-error]')`
                );
                const rec10 = await readRec(h);
                rec(
                    "row-resume-fails: with the stub failing, one press records one PairResumeCommand and the line reads \"Resume failed: " + RESUME_ERROR + "\" in a polite live region while the button's tooltip carries the same words and the button stays, enabled; once the stub works a second press takes the text and the button away, and the conversation never opened",
                    there10 &&
                        label10 != null &&
                        failedCalls === 1 &&
                        failed10?.live === "polite" &&
                        failed10.error?.text === `Resume failed: ${RESUME_ERROR}` &&
                        failed10.error.inLive === true &&
                        failed10.resume?.text === label10 &&
                        failed10.resume.disabled === false &&
                        failed10.resume.title === `Resume failed: ${RESUME_ERROR}` &&
                        retried10 &&
                        rec10?.mode.length === 0,
                    { there10, label10, failedCalls, failed10, retried10, rec10 }
                );

                // 11. row-judge-again: a pair stopped on no new points has Judge again on its line (nothing is queued, so no Resume); a
                // press opens the pair's conversation under the working agent, the rail on Decided, with "@judge " in the focused
                // composer, and sends nothing to wavesrv
                const { there: there11, view: view11 } = await showStopped({ reason: "no-new-points" }, { button: BTN_AGAIN });
                const label11 = (await offered(view11)).judgeAgain;
                const idle11 = await readActions(h);
                const hovered11 = await hoverRow(BTN_AGAIN);
                const hover11 = await readActions(h);
                await shot(h, "11-row-judge-again-hover");
                const saidBefore = (await pairRpcCalls(h, "PairSayCommand")).length;
                const resumeBefore11 = await resumeCalls();
                await startRec(h);
                await mouseNear(h, BTN_AGAIN);
                await until(h, `document.querySelector("[data-pair-pane] [data-pair-composer]")?.value === "@judge "`);
                await polishNap(300);
                const typed11 = await h.ev(`(() => {
                    const c = document.querySelector("[data-pair-pane] [data-pair-composer]");
                    return { value: c?.value ?? null, focused: c != null && document.activeElement === c, start: c?.selectionStart ?? null, end: c?.selectionEnd ?? null };
                })()`);
                const shown11 = await AC.agentPage(
                    h,
                    `const { centerModeAtom, pairSelAtom } = await mod("app/view/agents/agentcenter.ts");
                    const { pairDraftAtom } = await mod("app/view/agents/pairstore.ts");
                    const tab = document.querySelector('aside[aria-label="Agent details"] [data-rail-tab="decided"]');
                    return {
                        mode: globalStore.get(centerModeAtom),
                        sel: globalStore.get(pairSelAtom),
                        focus: globalStore.get(agentsModel().focusIdAtom),
                        decided: tab?.getAttribute("aria-selected") ?? null,
                        draft: globalStore.get(pairDraftAtom(${JSON.stringify(PAIR.id)})),
                    };`
                );
                const said11 = (await pairRpcCalls(h, "PairSayCommand")).length - saidBefore;
                const resumed11 = (await resumeCalls()) - resumeBefore11;
                await shot(h, "11-row-judge-again-opened");
                rec(
                    "row-judge-again: a pair stopped on no new points has an enabled Judge again button (the words pauseActions gives) on its line, level with the words, faded out until the pointer is over the row, and no Resume; a press opens the pair's conversation with the working agent chosen and the rail on Decided, \"@judge \" in the focused composer with the caret at its end and the draft taken, and calls neither PairSayCommand nor PairResumeCommand",
                    there11 &&
                        label11 != null &&
                        idle11?.judgeAgain?.text === label11 &&
                        idle11.judgeAgain.tag === "BUTTON" &&
                        idle11.judgeAgain.disabled === false &&
                        idle11.judgeAgain.opacity === "0" &&
                        idle11.judgeAgain.onLine === true &&
                        idle11.resume === null &&
                        hovered11 &&
                        hover11?.judgeAgain?.opacity === "1" &&
                        shown11.mode === "pair" &&
                        shown11.sel === PAIR.id &&
                        shown11.focus === PAIR.worker &&
                        shown11.decided === "true" &&
                        shown11.draft === null &&
                        typed11.value === "@judge " &&
                        typed11.focused === true &&
                        typed11.start === 7 &&
                        typed11.end === 7 &&
                        said11 === 0 &&
                        resumed11 === 0,
                    { there11, label11, idle11, hover11, shown11, typed11, said11, resumed11 }
                );

                // 12. row-relaying: a relaying pair's line has neither button, even with the pointer over the row
                await stopRec(h);
                await seedPair(h, [pairView(ctx.now, { judges: 1 })]);
                await AC.focusAgent(h, PAIR.other);
                await until(h, `document.querySelector('${WORDS}')?.innerText.trim() === "judge reviewing"`);
                await leaveTree(h);
                await polishNap(300);
                await hoverOn(h, WORDS);
                await polishNap(300);
                const relaying12 = await readActions(h);
                await shot(h, "12-row-relaying");
                rec(
                    "row-relaying: a relaying pair's line, with the pointer over its row, has no Resume, no Judge again and no error text",
                    relaying12 != null && relaying12.resume === null && relaying12.judgeAgain === null && relaying12.error === null,
                    { relaying12 }
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
                        globalStore.set(pairSeenAtom(${JSON.stringify(PAIR.id)}), 0);
                        return true;`
                    )
                );
                await attempt("drop the stubbed pair commands", () => restorePairRpc(h));
                await attempt("drop the fixture pairs", () => seedPair(h, null));
                await attempt("drop the fixture resting judges", () => seedResting(h, null));
                await attempt("drop the fixture roster", () => AC.restoreRoster(h));
                if (failures.length > 0) throw new Error(failures.join("; "));
            },
        },
    ];
}
