// kael-ask-keys: a digit or Enter walks an ask of several questions on the Cockpit (docs/superpowers/plans/
// 2026-11-12-kael-sync-small-fixes.md, Task 5; the fork's aa52e979b, F6). The F6 steps of the fork's `cockpit-ask-keys`,
// minus its F3 step (the pi-only dismiss x), which this port skips: ours keeps the dismiss x on a Claude ask.
//
// One fixture roster agent (Claude, asking two single-select questions). Each key is a real CDP key event on the Cockpit
// with the cursor on that agent: a digit picks an option of question 1 and the ask moves to question 2; Enter with
// question 2 still unanswered keeps the Cockpit and shows question 2; a digit answers question 2; Enter sends. The page's
// own answeragent call is recorded and never forwarded, so no real agent gets the answer.
//
// kits is scenarios.mjs's KAEL_KITS ({ rt, code, files, jarvis }); the page-side reads and the key presses are here.

import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { SURFACE_LABEL } from "./attach.mjs";

const AGENT = { id: "fx-kak-agent", name: "ask-walker", blockId: "fx-blk-kak-agent", askId: "fx-kak-ask" };
const VIEW_KEY = "cockpit.view";

const Q1 = { header: "Scope", question: "Which scope should the fix cover?", options: [{ label: "this file" }, { label: "the package" }] };
const Q2 = { header: "Tests", question: "Which tests should prove it?", options: [{ label: "unit" }, { label: "scenario" }] };
const HEADERS = [Q1.header, Q2.header];
const LABELS = [...Q1.options, ...Q2.options].map((o) => o.label);

const roster = () => [
    {
        id: AGENT.id,
        name: AGENT.name,
        project: "verify-kael-ask-keys",
        task: "answer two questions",
        state: "asking",
        agent: "claude",
        model: "opus",
        blockedMs: 60_000,
        blockId: AGENT.blockId,
        ask: { askId: AGENT.askId, oref: `block:${AGENT.blockId}`, questions: [Q1, Q2] },
    },
];

const SURFACE = `document.querySelector('[data-cockpit-surface]')`;
const CARD = `document.querySelector('[data-cockpit-surface] [data-agent-id="${AGENT.id}"]')`;

// what the asking card shows, read off its DOM: the AnswerBar has no data attributes, so the active question tab is the
// one drawn with the asking accent's soft fill (bg-warning/15), a tab's dot is bg-warning once its question is answered,
// and only the active question's options are rendered
const READ = `(() => {
    const card = ${CARD};
    if (!card) return null;
    const flat = (el) => (el?.textContent ?? "").replace(/\\s+/g, " ").trim();
    const buttons = [...card.querySelectorAll("button")];
    const tabs = buttons.filter((b) => ${JSON.stringify(HEADERS)}.includes(flat(b)));
    const label = (b) => flat(b).replace(/^\\d/, "");
    const options = buttons.filter((b) => !tabs.includes(b) && ${JSON.stringify(LABELS)}.includes(label(b)));
    const text = flat(card);
    // the bar's place once the ask is sent: one line, "Answered: <what was picked>" (the hint's "answered" is lowercase)
    const sentEl = [...card.querySelectorAll("div")].find((d) => /^Answered\\b/.test(flat(d)) && !d.querySelector("div"));
    return {
        cursor: /1\\.5px_var\\(--color-warning\\)/.test(String(card.className)),
        activeTab: flat(tabs.find((b) => /bg-warning\\/15/.test(String(b.className)))) || null,
        answeredTabs: tabs.filter((b) => b.querySelector("span.bg-warning")).map(flat),
        shown: options.map(label),
        selected: options.filter((b) => /bg-warning\\/15/.test(String(b.className))).map(label),
        hint: (/\\d\\/\\d answered/.exec(text) ?? [null])[0],
        sentLine: sentEl ? flat(sentEl) : null,
    };
})()`;

export default function (kits) {
    const { rt, files } = kits;
    const { TREE_RAIL_FIXTURE, polishWaitFor, polishNap, ahReload } = rt;
    const { restoreLocalStorage } = files;

    // a real key event: the dispatcher sees what a key press gives it. A digit carries its text; a named key (n, Enter) does
    // too only where the app's handler reads `key`, which CDP sets either way
    const key = async (h, k, code, vk, text) => {
        await h.cdp("Input.dispatchKeyEvent", { type: "keyDown", key: k, code, windowsVirtualKeyCode: vk, ...(text ? { text } : {}) });
        await h.cdp("Input.dispatchKeyEvent", { type: "keyUp", key: k, code, windowsVirtualKeyCode: vk });
    };
    // the Cockpit's keys are its container's own onKeyDown, so the press needs focus inside it
    const press = async (h, ...args) => {
        await h.ev(`${SURFACE}?.focus()`);
        await key(h, ...args);
        await polishNap(450);
    };
    const answers = async (h) => JSON.parse(await h.ev("JSON.stringify(window.__kakAnswers || [])"));

    const scenario = {
        name: "kael-ask-keys",
        surface: "cockpit",
        async arrange(h) {
            const ctx = {};
            try {
                // the Cockpit draws cards or the office; the keys below are the cards'. The view is stored, so a profile that
                // last left it on the office would put the agent in a room with no answer bar
                ctx.prevView = await h.ev(`localStorage.getItem(${JSON.stringify(VIEW_KEY)})`);
                await h.ev(`localStorage.setItem(${JSON.stringify(VIEW_KEY)}, ${JSON.stringify(JSON.stringify("cards"))})`);
                ctx.prevFixture = existsSync(TREE_RAIL_FIXTURE) ? readFileSync(TREE_RAIL_FIXTURE, "utf8") : null;
                mkdirSync(new URL("./", TREE_RAIL_FIXTURE), { recursive: true });
                writeFileSync(TREE_RAIL_FIXTURE, JSON.stringify(roster(), null, 2));
                ctx.wroteFixture = true;
                // the roster is read once at boot
                if (!(await ahReload(h))) throw new Error("the app did not come back from the reload");
                await h.goto("cockpit");
                // the page's own answeragent call is recorded and resolved here, never forwarded
                await h.ev(`(() => {
                    const c = window.TabRpcClient;
                    if (!c.__kakOrig) {
                        c.__kakOrig = c.wshRpcCall;
                        const call = c.wshRpcCall.bind(c);
                        c.wshRpcCall = (command, data, opts) => {
                            if (command !== "answeragent") return call(command, data, opts);
                            window.__kakAnswers.push(data);
                            return Promise.resolve(null);
                        };
                    }
                    window.__kakAnswers = [];
                })()`);
                const ready = await polishWaitFor(h, `!!${CARD} && ${READ}?.shown?.length === 2`, 15000);
                if (!ready) ctx.arrangeError = "the fixture agent's card never showed its first question";
            } catch (e) {
                ctx.arrangeError = String(e?.message ?? e);
            }
            return ctx;
        },
        async assert(h, ctx) {
            if (ctx.arrangeError != null) {
                return [{ step: "0. the fixture roster with one agent asking two questions", ok: false, detail: ctx.arrangeError }];
            }
            const steps = [];
            const rec = (step, ok, detail) => steps.push({ step, ok: ok === true, detail });
            const shot = (name) => h.shot(`cdp-shots/kael-ask-keys-${name}.png`);
            const surface = () => h.activeSurfaceLabel();

            try {
                await h.cdp("Emulation.setDeviceMetricsOverride", { width: 1600, height: 950, deviceScaleFactor: 1, mobile: false });
                await polishNap(500);

                // 1. n puts the cursor on the asking agent; the ask opens on its first question
                const start = await h.ev(READ);
                await press(h, "n", "KeyN", 78, "n");
                const placed = await polishWaitFor(h, `${READ}?.cursor === true`, 4000);
                const at1 = await h.ev(READ);
                await shot("start");
                rec(
                    "1. n puts the cursor on the asking agent, whose ask shows question 1 (Scope) with no answer yet",
                    start != null &&
                        placed === true &&
                        at1.activeTab === "Scope" &&
                        at1.shown.join() === "this file,the package" &&
                        at1.selected.length === 0 &&
                        at1.answeredTabs.length === 0,
                    JSON.stringify({ placed, at1 })
                );

                // 2. a digit picks an option of question 1 and the ask moves on to question 2, without sending
                await press(h, "1", "Digit1", 49, "1");
                const afterDigit = await h.ev(READ);
                await shot("digit");
                rec(
                    "2. digit 1 picks 'this file' for question 1 and moves the ask to question 2 (Tests), unsent",
                    afterDigit.activeTab === "Tests" &&
                        afterDigit.shown.join() === "unit,scenario" &&
                        afterDigit.selected.length === 0 &&
                        afterDigit.answeredTabs.join() === "Scope" &&
                        afterDigit.hint === "1/2 answered" &&
                        afterDigit.sentLine == null &&
                        (await answers(h)).length === 0 &&
                        (await surface()) === SURFACE_LABEL.cockpit,
                    JSON.stringify({ afterDigit, answers: (await answers(h)).length, surface: await surface() })
                );

                // 3. Enter with question 2 still unanswered keeps the Cockpit (it does not open the Agent surface over a partial
                // answer) and leaves question 2 showing
                await press(h, "Enter", "Enter", 13);
                const afterEnter = await h.ev(READ);
                await shot("enter-partial");
                rec(
                    "3. Enter with question 2 unanswered stays on the Cockpit and shows question 2, sending nothing",
                    (await surface()) === SURFACE_LABEL.cockpit &&
                        afterEnter != null &&
                        afterEnter.activeTab === "Tests" &&
                        afterEnter.shown.join() === "unit,scenario" &&
                        afterEnter.hint === "1/2 answered" &&
                        afterEnter.sentLine == null &&
                        (await answers(h)).length === 0,
                    JSON.stringify({ afterEnter, answers: (await answers(h)).length, surface: await surface() })
                );

                // 4. a digit answers question 2: picked, every question answered, and still not sent (Enter is the confirm step)
                await press(h, "2", "Digit2", 50, "2");
                const afterSecond = await h.ev(READ);
                await shot("second-digit");
                rec(
                    "4. digit 2 picks 'scenario' for question 2: both questions answered (2/2), the ask still unsent",
                    afterSecond.activeTab === "Tests" &&
                        afterSecond.selected.join() === "scenario" &&
                        afterSecond.answeredTabs.join() === "Scope,Tests" &&
                        afterSecond.hint === "2/2 answered" &&
                        afterSecond.sentLine == null &&
                        (await answers(h)).length === 0 &&
                        (await surface()) === SURFACE_LABEL.cockpit,
                    JSON.stringify({ afterSecond, answers: (await answers(h)).length, surface: await surface() })
                );

                // 5. Enter sends: the answer is recorded once, for both questions, and the card says it was answered
                await press(h, "Enter", "Enter", 13);
                await polishWaitFor(h, `${READ}?.sentLine != null`, 4000);
                const sent = await answers(h);
                const afterSend = await h.ev(READ);
                await shot("sent");
                rec(
                    "5. Enter with every question answered sends once: this file, scenario (recorded, never forwarded)",
                    sent.length === 1 &&
                        sent[0].oref === `block:${AGENT.blockId}` &&
                        JSON.stringify(sent[0].answers) === JSON.stringify([{ selectedindexes: [0] }, { selectedindexes: [1] }]) &&
                        afterSend?.sentLine === "Answered: this file, scenario",
                    JSON.stringify({ sent, afterSend })
                );
            } catch (e) {
                rec("scenario aborted", false, String(e?.stack ?? e?.message ?? e));
            }
            return steps;
        },
        async teardown(h, ctx) {
            const step = async (what, fn) => {
                try {
                    await fn();
                } catch (e) {
                    console.error(`kael-ask-keys teardown: ${what} failed: ${e?.message ?? e}`);
                }
            };
            await step("clear the page's hooks", () =>
                h.ev(`(() => {
                    const c = window.TabRpcClient;
                    if (c?.__kakOrig) { c.wshRpcCall = c.__kakOrig; delete c.__kakOrig; }
                    delete window.__kakAnswers;
                    document.activeElement?.blur?.();
                })()`)
            );
            await step("clear the viewport", () => h.cdp("Emulation.clearDeviceMetricsOverride"));
            await step("put the view back", () => h.ev(restoreLocalStorage(VIEW_KEY, ctx.prevView ?? null)));
            if (ctx.wroteFixture) {
                await step("put the roster fixture back", () => {
                    if (ctx.prevFixture != null) writeFileSync(TREE_RAIL_FIXTURE, ctx.prevFixture);
                    else rmSync(TREE_RAIL_FIXTURE, { force: true });
                });
            }
            // onto the live roster again, with the fixture's answer state gone with the page
            await step("reload onto the live roster", async () => {
                if (!(await ahReload(h))) throw new Error("the app did not come back from the reload");
            });
        },
    };
    return [scenario];
}
