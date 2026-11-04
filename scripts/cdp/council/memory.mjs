// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0
//
// council-memory (docs/superpowers/specs/2026-11-04-council-ideas-memory-design.md, section 2; the plan: docs/superpowers/
// plans/2026-11-04-council-ideas-memory.md, Task 9): the Memory tab of the council's rail and Chốt, drawn from the boards
// Memory-tab and Memory-held (.superpowers/design/council-ideas-memory). The hooks are called by councilscenarios.mjs as
// arrange(h, fx), assert(h, ctx, fx), teardown(h, ctx, fx).
//
// Nothing here calls a model. The council is the finished `done` fixture with fourteen ideas (a channel tall enough that
// the first one is out of sight at its end) and two posts of the channel, written into the data dir as a JSON file.
// `CouncilDirectionCommand` is replaced in the page: each step clicks, asserts the call the stand-in recorded (action,
// text, from), and then writes the council again with the memory the backend would have saved and announces it, so the tab
// redraws from a real `council:changed` the way it does in the app.

import { waitFor } from "../attach.mjs";
import {
    announceCouncil,
    arrangeCouncilProject,
    councilFixtureId,
    openCouncil,
    resolveStub,
    rpcCalls,
    stubRpc,
    teardownCouncilProject,
    writeCouncil,
} from "./fixtures.mjs";

const WAIT_MS = 10_000;
const COMMAND = "CouncilDirectionCommand";
const RAIL = "[data-council-rail]";
const MEMORY = "[data-council-memory]";
const CHANNEL = "[data-council-channel]";
const MIN = 60_000;

const q = (s) => JSON.stringify(s);
const NORM = `.replace(/\\s+/g, " ").trim()`;
const until = (h, expr, ms = WAIT_MS) => waitFor((e) => h.ev(e), expr, ms);
const click = (h, sel) =>
    h.ev(`(() => { const el = document.querySelector(${q(sel)}); if (el == null || el.disabled) return false; el.click(); return true; })()`);
const exists = (h, sel) => h.ev(`!!document.querySelector(${q(sel)})`);
const text = (h, sel) => h.ev(`(document.querySelector(${q(sel)})?.textContent ?? "")${NORM}`);
const pause = (ms) => new Promise((r) => setTimeout(r, ms));
// a React-controlled field takes the native setter and an input event
const typeInto = (h, sel, value) =>
    h.ev(`(() => {
        const el = document.querySelector(${q(sel)});
        if (!el) return false;
        const set = Object.getOwnPropertyDescriptor(Object.getPrototypeOf(el), "value").set;
        set.call(el, ${q(value)});
        el.dispatchEvent(new Event("input", { bubbles: true }));
        return true;
    })()`);
// a click does not move focus, and the chat's keys are live only with focus inside its channel or thread
const focusOn = (h, sel) =>
    h.ev(`(() => { const e = document.querySelector(${q(sel)}); if (!e) return false; e.focus(); return document.activeElement === e; })()`);
// a real key event to where focus is (the dispatcher listens on the window, in capture)
const press = async (h, key, code, keyCode) => {
    for (const type of ["keyDown", "keyUp"]) {
        await h.cdp("Input.dispatchKeyEvent", { type, key, code, windowsVirtualKeyCode: keyCode });
    }
    await pause(200);
};

// ---- the fixture ----

// wall-clock times of the rows, in minutes before this module loaded: what a row says is the HH:MM of its instant, read
// the way the page reads it (councilsummarymodel.clockTime), so no step depends on the hour it runs in
const T0 = Date.now();
const at = (minutes) => T0 + minutes * MIN;
const hhmm = (ms) => {
    const d = new Date(ms);
    return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
};

// fourteen ideas, P1 to P14, by the four seats in turn, each long enough to fill a few lines of the channel
const SEATS = ["ux", "ram", "newuser", "skeptic"];
const TITLES = [
    "Show asleep and waking on the rail icon",
    "Keep the last-used pinned app awake",
    "Cap the rail at three apps",
    "Move the rail pins from localStorage to settings",
    "Measure a woken app before keeping any awake",
    "Let a pinned app open from the palette",
    "Draw the rail in two columns",
    "Show the empty rail slots with a pin hint",
    "Name a pinned app by its tool, not its port",
    "Close a service the rail stopped showing",
    "Warn before the third app is pinned",
    "Keep the pins per project, not per window",
    "Open the last app again on a cold start",
    "Give each app a keyboard chord",
];
const FILLER =
    "The rail stays quiet while the number of apps grows, and the seats that read the pins can still tell which one is open. " +
    "It costs a few lines of state, and the person decides when it matters.";

// the ideas, two replies on them, and two posts of the channel (r20 on several lines, which Chốt cuts to one)
function ideasOf(c) {
    const ts = (s) => c.started + s * 1000;
    c.proposals = TITLES.map((title, i) => ({
        id: `P${i + 1}`,
        author: SEATS[i % SEATS.length],
        title,
        argument: `${title}. ${FILLER}`,
        ts: ts(100 + i * 5),
    }));
    c.replies = [
        { id: "r1", proposalid: "P3", author: "ux", text: "Fine, if the number decides.", round: 2, ts: ts(200), stance: "accept" },
        { id: "r2", proposalid: "P3", author: "ram", text: "No cost on my side.", round: 2, ts: ts(205), stance: "accept" },
        { id: "r3", proposalid: "P4", author: "skeptic", text: "A migration with no rollback.", round: 2, ts: ts(210), stance: "oppose" },
        { id: "r20", proposalid: "", author: "ram", text: "Pin the rail apps first.\n\nMeasure after.", round: 3, ts: ts(700) },
        { id: "r21", proposalid: "", author: "ux", text: "A cap of three is enough for now.", round: 3, ts: ts(705) },
    ];
}

// the memory the backend would save in each state the steps move through
const WRITTEN = "Ship the rail pins first";
const DIRECTION = "Cap the rail at three apps and keep the last-used one awake";
const EDITED = "Cap the rail at four apps and keep the last-used one awake";
const CHOSEN = { text: DIRECTION, how: "pin", from: "P3", at: at(-30) };
const REPLACED_NEW = { text: "Keep every pinned app awake", how: "suggested", source: "check", round: 2, at: at(-50), replaced: at(-30), ended: "replaced" };
const REPLACED_OLD = { text: "Let the rail show any number of apps", how: "pin", from: "P1", at: at(-70), replaced: at(-50), ended: "edited" };
const SUGGESTION = {
    kind: "suggestion",
    text: "Measure a woken app before keeping any awake",
    reason: "Skeptic and RAM both said to measure first, and two seats accepted Idea 5.",
    source: "check",
    round: 3,
    messages: ["P1", "r21"],
    at: at(-5),
};
const HELD = {
    kind: "held",
    text: "Keep every app awake and drop the cap",
    reason: "Three seats agreed on the cap of three (Idea 3), and Skeptic says awake apps cost memory.",
    how: "written",
    at: at(-3),
};

const memory = (parts) => {
    const m = { ...parts };
    if (m.chosen != null) m.changed = m.chosen.at;
    return m;
};
const STATES = {
    empty: null,
    written: memory({ chosen: { text: WRITTEN, how: "written", at: at(-1) } }),
    waiting: memory({ chosen: CHOSEN, replaced: [REPLACED_NEW, REPLACED_OLD], suggestion: SUGGESTION }),
    settled: memory({ chosen: CHOSEN, replaced: [REPLACED_NEW, REPLACED_OLD] }),
    // accept made the suggestion the direction and moved the old one to Replaced
    accepted: memory({
        chosen: { text: SUGGESTION.text, how: "suggested", source: "check", round: 3, at: at(-1) },
        replaced: [{ ...CHOSEN, replaced: at(-1), ended: "replaced" }, REPLACED_NEW, REPLACED_OLD],
    }),
    // the suggestion points at messages that are gone
    gone: memory({ chosen: CHOSEN, replaced: [REPLACED_NEW, REPLACED_OLD], suggestion: { ...SUGGESTION, messages: ["P99"] } }),
    // a held direction, with a suggestion waiting behind it (the held card shows first)
    held: memory({ chosen: CHOSEN, replaced: [REPLACED_NEW, REPLACED_OLD], held: HELD, suggestion: SUGGESTION }),
    // what the backend saved once the held text was set (typed, or Set anyway): the old direction is Replaced
    heldSet: memory({
        chosen: { text: HELD.text, how: "written", at: at(-1) },
        replaced: [{ ...CHOSEN, replaced: at(-1), ended: "replaced" }, REPLACED_NEW, REPLACED_OLD],
        suggestion: SUGGESTION,
    }),
    // the held card thrown away: the chosen direction and the suggestion behind it stay
    heldOut: memory({ chosen: CHOSEN, replaced: [REPLACED_NEW, REPLACED_OLD], suggestion: SUGGESTION }),
    edited: memory({
        chosen: { text: EDITED, how: "written", at: at(-1) },
        replaced: [{ ...CHOSEN, replaced: at(-1), ended: "edited" }, REPLACED_NEW, REPLACED_OLD],
    }),
    // Unpin leaves no direction and the three it replaced
    unpinned: memory({
        replaced: [
            { text: EDITED, how: "written", at: at(-1), replaced: at(-1), ended: "unpinned" },
            { ...CHOSEN, replaced: at(-1), ended: "edited" },
            REPLACED_NEW,
            REPLACED_OLD,
        ],
        changed: at(-1),
    }),
};

// writes the council again with the memory the backend would save and tells the page, as `council:changed` does
async function swap(h, ctx, state) {
    writeCouncil(ctx, "done", {
        id: ctx.id,
        edit: (c) => {
            ideasOf(c);
            if (STATES[state] != null) c.memory = STATES[state];
        },
    });
    await announceCouncil(h, ctx, ctx.id);
}

// ---- what the page draws ----

// the tab: the rail's tabs, which one shows, and whether the dot is on
const readRail = (h) =>
    h.ev(`(() => {
        const rail = document.querySelector(${q(RAIL)});
        if (!rail) return null;
        const norm = (e) => (e?.textContent ?? "")${NORM};
        const tab = rail.querySelector('[data-council-rail-tab="memory"]');
        return {
            shows: rail.getAttribute("data-rail-tab"),
            tabs: [...rail.querySelectorAll("[data-council-rail-tab]")].map((t) => t.getAttribute("data-council-rail-tab")),
            memoryLabel: norm(tab),
            memoryOn: tab?.getAttribute("aria-selected") === "true",
            dot: !!tab?.querySelector("[data-council-memory-dot]"),
            dotColour: tab?.querySelector("[data-council-memory-dot]") ? getComputedStyle(tab.querySelector("[data-council-memory-dot]")).backgroundColor : null,
        };
    })()`);

// the panel: caption, input and Set, the one card, the chosen direction and the Replaced rows, in the order drawn
const readMemory = (h) =>
    h.ev(`(() => {
        const root = document.querySelector(${q(MEMORY)});
        if (!root) return null;
        const norm = (e) => (e?.textContent ?? "")${NORM};
        const act = (name, scope = root) => scope.querySelector('[data-council-memory-action="' + name + '"]');
        const buttons = (scope) => [...scope.querySelectorAll("[data-council-memory-action]")].map((b) => ({ a: b.getAttribute("data-council-memory-action"), label: norm(b), disabled: b.disabled }));
        const card = root.querySelector("[data-council-memory-card]");
        const chosen = root.querySelector("[data-council-memory-chosen]");
        const replaced = root.querySelector("[data-council-memory-replaced]");
        const input = root.querySelector("[data-council-memory-input]");
        const top = (e) => (e ? Math.round(e.getBoundingClientRect().top) : null);
        const source = chosen?.querySelector("[data-council-memory-source]");
        const edit = chosen?.querySelector("[data-council-memory-edit-input]");
        return {
            caption: norm(root.querySelector("[data-council-memory-caption]")),
            placeholder: input?.getAttribute("placeholder") ?? null,
            input: input?.value ?? null,
            inputFocused: document.activeElement === input,
            set: { label: norm(act("set")), disabled: act("set")?.disabled ?? null },
            empty: root.querySelector("[data-council-memory-empty]") ? norm(root.querySelector("[data-council-memory-empty]")) : null,
            error: root.querySelector("[data-council-memory-error]") ? norm(root.querySelector("[data-council-memory-error]")) : null,
            cards: root.querySelectorAll("[data-council-memory-card]").length,
            card: card == null ? null : {
                kind: card.getAttribute("data-council-memory-card"),
                kicker: norm(card.querySelector("[data-council-memory-kicker]")),
                kickerColour: getComputedStyle(card.querySelector("[data-council-memory-kicker]")).color,
                text: norm(card.querySelector("[data-council-memory-card-text]")),
                reason: card.querySelector("[data-council-memory-reason]") ? norm(card.querySelector("[data-council-memory-reason]")) : null,
                buttons: buttons(card),
                gone: card.querySelector("[data-council-memory-gone]") ? norm(card.querySelector("[data-council-memory-gone]")) : null,
            },
            chosen: chosen == null ? null : {
                text: norm(chosen.querySelector("[data-council-memory-chosen-text]")),
                line: norm(chosen.querySelector("[data-council-memory-chosen-line]")),
                source: source ? { id: source.getAttribute("data-council-memory-source"), label: norm(source) } : null,
                buttons: buttons(chosen),
                editing: edit ? edit.value : null,
            },
            replaced: replaced == null ? [] : [...replaced.querySelectorAll("[data-council-memory-replaced-row]")].map((r) => ({
                text: norm(r.querySelector("[data-council-memory-replaced-text]")),
                line: norm(r.querySelector("[data-council-memory-replaced-line]")),
                struck: getComputedStyle(r.querySelector("[data-council-memory-replaced-text]")).textDecorationLine.includes("line-through"),
            })),
            tops: { input: top(input), card: top(card), chosen: top(chosen), replaced: top(replaced) },
        };
    })()`);

const labels = (buttons) => (buttons ?? []).map((b) => b.label).join("|");
const rowsOf = (m) => (m?.replaced ?? []).map((r) => r.line);

// the Replaced lines the fixture's directions read
const LINE_NEW = `Accepted from the check after round 2 · replaced ${hhmm(REPLACED_NEW.replaced)}`;
const LINE_OLD = `Pinned by you · edited ${hhmm(REPLACED_OLD.replaced)}`;
const LINE_CHOSEN = `Pinned by you · ${hhmm(CHOSEN.at)} · from Idea 3`;
const KICKER_SUGGESTION = "Suggested after round 3 · the chat may have moved";
const KICKER_HELD = "Held · this may clash with what the seats agreed";

// waits for the panel to show `test` (a page expression over `m`, the panel's facts) and answers the facts it ended on
async function memoryWhere(h, test) {
    await until(
        h,
        `(() => { const root = document.querySelector(${q(MEMORY)}); if (!root) return false; const m = (${readMemoryExpr})(); return ${test}; })()`
    );
    return readMemory(h);
}
// the facts reader as an expression, so memoryWhere can ask it in one evaluate (readMemory without its call)
const readMemoryExpr = `() => {
    const root = document.querySelector(${q(MEMORY)});
    const norm = (e) => (e?.textContent ?? "")${NORM};
    const card = root.querySelector("[data-council-memory-card]");
    const chosen = root.querySelector("[data-council-memory-chosen]");
    return {
        card: card?.getAttribute("data-council-memory-card") ?? null,
        cardText: card ? norm(card.querySelector("[data-council-memory-card-text]")) : null,
        chosen: chosen ? norm(chosen.querySelector("[data-council-memory-chosen-text]")) : null,
        empty: !!root.querySelector("[data-council-memory-empty]"),
        rows: root.querySelectorAll("[data-council-memory-replaced-row]").length,
        input: root.querySelector("[data-council-memory-input]")?.value ?? null,
        editing: chosen?.querySelector("[data-council-memory-edit-input]") != null,
    };
}`;

// the rail's Memory tab, shown
async function showMemory(h) {
    await click(h, `${RAIL} [data-council-rail-tab="memory"]`);
    await until(h, `!!document.querySelector(${q(MEMORY)})`);
}

// clicks (or does `trigger`) and answers the call the stand-in took for it: the call's data, or null when none came
async function callAfter(h, trigger) {
    const before = (await rpcCalls(h, COMMAND)).length;
    await trigger();
    const came = await until(h, `(window.__arcCouncilStub?.calls ?? []).filter((c) => c.name === ${q(COMMAND)}).length > ${before}`);
    return came ? ((await rpcCalls(h, COMMAND)).at(-1)?.data ?? null) : null;
}
// the call is the one asked for: this council, the action, and the text and source it carried (null for none)
const isCall = (data, id, action, text = null, from = null) =>
    data != null && data.id === id && data.action === action && (data.text ?? null) === text && (data.from ?? null) === from;

// where an element sits in the channel: inside its visible box or not
const inView = (h, id) =>
    h.ev(`(() => {
        const box = document.querySelector(${q(CHANNEL)});
        const el = box?.querySelector('[data-council-idea=${q(id)}]');
        if (!box || !el) return null;
        const b = box.getBoundingClientRect(), r = el.getBoundingClientRect();
        return { shown: r.top >= b.top - 2 && r.bottom <= b.bottom + 2, top: Math.round(r.top - b.top), scrollTop: Math.round(box.scrollTop), focused: el.getAttribute("data-focused") === "true" };
    })()`);

export const councilMemory = {
    async arrange(h, fx) {
        const ctx = await arrangeCouncilProject(h, fx);
        try {
            // a fresh start: the rail shows unless the person folded it
            await h.ev(`(() => { try { localStorage.removeItem("council.ideasRail.folded"); } catch {} })()`);
            ctx.id = writeCouncil(ctx, "done", { id: `${councilFixtureId("done")}-memory`, edit: (c) => ideasOf(c) });
        } catch (e) {
            await teardownCouncilProject(h, ctx).catch(() => {});
            throw e;
        }
        return ctx;
    },

    async assert(h, ctx) {
        const steps = [];
        const rec = (step, ok, detail) => steps.push({ step, ok, detail: JSON.stringify(detail) });
        const id = ctx.id;

        // the stand-in answers at once; it records every call (action, text, from) for the steps to read
        await stubRpc(h, [COMMAND]);

        // 1. the Memory tab of a council with no memory: the empty tab
        await openCouncil(h, id, "discussion");
        await until(h, `document.querySelectorAll(${q(`${RAIL} [data-council-rail-idea]`)}).length === ${TITLES.length}`);
        await showMemory(h);
        const one = await readMemory(h);
        const railOne = await readRail(h);
        rec(
            "1. clicking the Memory tab (next to Ideas, always there) shows the empty tab: the caption `the seats read this before the Report`, the Set the direction… input with a Set that waits for text, and the muted line `Pin a message with Chốt, or write the direction here.`, no card, no direction, no dot",
            railOne?.shows === "memory" &&
                railOne.memoryOn &&
                railOne.tabs.join() === "ideas,memory" &&
                railOne.memoryLabel === "Memory" &&
                !railOne.dot &&
                one?.caption === "the seats read this before the Report" &&
                one.placeholder === "Set the direction…" &&
                one.input === "" &&
                one.set.label === "Set" &&
                one.set.disabled === true &&
                one.empty === "Pin a message with Chốt, or write the direction here." &&
                one.card == null &&
                one.chosen == null &&
                one.replaced.length === 0,
            { rail: railOne, memory: one }
        );

        // 2. typing a direction and clicking Set calls `set` with the text; while the check runs the button waits
        await stubRpc(h, [COMMAND], { [COMMAND]: { pending: true } });
        await typeInto(h, "[data-council-memory-input]", `  ${WRITTEN}  `);
        await until(h, `document.querySelector('[data-council-memory-action="set"]')?.disabled === false`);
        const setCall = await callAfter(h, () => click(h, '[data-council-memory-action="set"]'));
        const checking = await memoryWhere(h, `m.input !== null`);
        rec(
            "2. typing in Set the direction… and clicking Set calls `set` with the text (trimmed, no source), and while the check runs the button reads Checking… and stays off",
            isCall(setCall, id, "set", WRITTEN) && checking?.set.label === "Checking…" && checking.set.disabled === true,
            { call: setCall, set: checking?.set }
        );
        await resolveStub(h, COMMAND);
        const cleared = await memoryWhere(h, `m.input === ""`);
        await stubRpc(h, [COMMAND]);
        await swap(h, ctx, "written");
        const written = await memoryWhere(h, `m.chosen === ${q(WRITTEN)}`);
        rec(
            "2. once the call answers the input is empty again, and the council the backend saved shows its Chosen direction `Written by you · HH:MM` with no source link and no muted line",
            cleared?.input === "" &&
                written?.chosen?.line === `Written by you · ${hhmm(STATES.written.chosen.at)}` &&
                written.chosen.source == null &&
                written.empty == null &&
                labels(written.chosen.buttons) === "Edit|Unpin",
            { chosen: written?.chosen, empty: written?.empty }
        );

        // 3. a chosen direction with two Replaced and a waiting suggestion
        await swap(h, ctx, "waiting");
        const three = await memoryWhere(h, `m.card === "suggestion" && m.rows === 2`);
        const railThree = await readRail(h);
        await h.shot("cdp-shots/council-memory-suggestion.png");
        rec(
            "3. a chosen direction with two Replaced and a waiting suggestion: the tab's dot is on (accent-soft), the card reads `Suggested after round 3 · the chat may have moved` with its text, its reason and Make it the direction / Dismiss / Show the messages, above Chosen direction",
            railThree?.dot === true &&
                three?.cards === 1 &&
                three.card.kind === "suggestion" &&
                three.card.kicker === KICKER_SUGGESTION &&
                three.card.text === SUGGESTION.text &&
                three.card.reason === SUGGESTION.reason &&
                labels(three.card.buttons) === "Make it the direction|Dismiss|Show the messages" &&
                three.tops.input < three.tops.card &&
                three.tops.card < three.tops.chosen,
            { dot: railThree?.dot, card: three?.card, tops: three?.tops }
        );
        rec(
            "3. the Chosen direction shows its text and `Pinned by you · HH:MM · from Idea 3` with Idea 3 as a link, Edit and Unpin; Replaced lists the two earlier directions newest first, struck through, each with how it was set and `replaced` / `edited` and when",
            three?.chosen?.text === DIRECTION &&
                three.chosen.line === LINE_CHOSEN &&
                three.chosen.source?.id === "P3" &&
                three.chosen.source.label === "Idea 3" &&
                labels(three.chosen.buttons) === "Edit|Unpin" &&
                rowsOf(three).join("|") === `${LINE_NEW}|${LINE_OLD}` &&
                three.replaced.map((r) => r.text).join("|") === `${REPLACED_NEW.text}|${REPLACED_OLD.text}` &&
                three.replaced.every((r) => r.struck) &&
                three.tops.chosen < three.tops.replaced,
            { chosen: three?.chosen, replaced: three?.replaced }
        );

        // the source link opens the thread of the idea the direction came from; the Memory tab is one click back
        await click(h, "[data-council-memory-source]");
        const opened = await until(h, `document.querySelector(${q(RAIL)})?.getAttribute("data-rail-tab") === "thread" && !!document.querySelector('[data-council-thread="P3"]')`);
        await showMemory(h);
        rec(
            "3. a click on the source link `Idea 3` opens Idea 3's thread on the rail, and the Memory tab brings the panel back",
            opened && (await exists(h, MEMORY)),
            { opened }
        );

        // 4. Make it the direction accepts, Dismiss dismisses
        const acceptCall = await callAfter(h, () => click(h, '[data-council-memory-action="accept"]'));
        await swap(h, ctx, "accepted");
        const four = await memoryWhere(h, `m.chosen === ${q(SUGGESTION.text)} && m.card === null`);
        const railFour = await readRail(h);
        rec(
            "4. Make it the direction calls `accept` (no text, no source); the saved council shows the suggestion as the chosen direction `Accepted from the check after round 3`, the old one at the top of Replaced, no card and no dot",
            isCall(acceptCall, id, "accept") &&
                four?.chosen?.line === `Accepted from the check after round 3 · ${hhmm(STATES.accepted.chosen.at)}` &&
                four.chosen.source == null &&
                four.replaced.length === 3 &&
                four.replaced[0].text === DIRECTION &&
                !railFour?.dot &&
                four.cards === 0,
            { call: acceptCall, chosen: four?.chosen, rows: four?.replaced.length, dot: railFour?.dot }
        );
        await swap(h, ctx, "waiting");
        await memoryWhere(h, `m.card === "suggestion"`);
        const dismissCall = await callAfter(h, () => click(h, '[data-council-memory-action="dismiss"]'));
        await swap(h, ctx, "settled");
        const dismissed = await memoryWhere(h, `m.card === null && m.chosen === ${q(DIRECTION)}`);
        const railDismissed = await readRail(h);
        rec(
            "4. Dismiss calls `dismiss`; the card and the dot are gone once the backend has dropped the suggestion, and the chosen direction stays",
            isCall(dismissCall, id, "dismiss") && dismissed?.cards === 0 && !railDismissed?.dot,
            { call: dismissCall, cards: dismissed?.cards, dot: railDismissed?.dot }
        );

        // 5. Show the messages scrolls the channel to the suggestion's first message
        await swap(h, ctx, "waiting");
        await memoryWhere(h, `m.card === "suggestion"`);
        // the channel starts at its end, so the first idea is out of sight: put it there to be sure
        await h.ev(`(() => { const box = document.querySelector(${q(CHANNEL)}); if (box) box.scrollTop = box.scrollHeight; })()`);
        await pause(300);
        const before = await inView(h, "P1");
        await click(h, '[data-council-memory-action="show"]');
        await pause(500);
        const after = await inView(h, "P1");
        rec(
            "5. Show the messages scrolls the channel so the suggestion's first message (Idea 1, out of sight at the end of the channel) is in view, and puts the j / k cursor on it",
            before != null && before.shown === false && after?.shown === true && after.scrollTop < before.scrollTop && after.focused === true,
            { before, after }
        );
        // messages that are gone say so, and nothing scrolls
        await swap(h, ctx, "gone");
        await memoryWhere(h, `m.card === "suggestion"`);
        await h.ev(`(() => { const box = document.querySelector(${q(CHANNEL)}); if (box) box.scrollTop = box.scrollHeight; })()`);
        await pause(200);
        const stillAt = await h.ev(`document.querySelector(${q(CHANNEL)})?.scrollTop ?? null`);
        await click(h, '[data-council-memory-action="show"]');
        await pause(300);
        const goneShown = await readMemory(h);
        const stayed = await h.ev(`document.querySelector(${q(CHANNEL)})?.scrollTop ?? null`);
        rec(
            "5. messages that are no longer in the channel (a dropped idea) leave it where it was and the card says `Those messages are not in the channel now.`",
            goneShown?.card?.gone === "Those messages are not in the channel now." && stayed === stillAt,
            { gone: goneShown?.card?.gone, stillAt, stayed }
        );

        // 6. a held direction above a chosen direction with two Replaced (board Memory-held)
        await swap(h, ctx, "held");
        const six = await memoryWhere(h, `m.card === "held"`);
        await h.shot("cdp-shots/council-memory-held.png");
        rec(
            "6. a held direction: one card only (the suggestion behind it waits), `Held · this may clash with what the seats agreed`, in the warning colour, with the held text, the check's reason and Edit / Set anyway / Discard, above the chosen direction and the two Replaced rows",
            six?.cards === 1 &&
                six.card.kind === "held" &&
                six.card.kicker === KICKER_HELD &&
                six.card.kickerColour !== (await readCardColour(h, "accent-soft")) &&
                six.card.kickerColour === (await readCardColour(h, "warning-soft")) &&
                six.card.text === HELD.text &&
                six.card.reason === HELD.reason &&
                labels(six.card.buttons) === "Edit|Set anyway|Discard" &&
                six.chosen?.text === DIRECTION &&
                six.chosen.line === LINE_CHOSEN &&
                rowsOf(six).join("|") === `${LINE_NEW}|${LINE_OLD}` &&
                six.tops.card < six.tops.chosen &&
                six.tops.chosen < six.tops.replaced,
            { card: six?.card, chosen: six?.chosen, rows: rowsOf(six), tops: six?.tops }
        );

        // 7. Edit puts the held text back into the input; Set anyway and Discard
        await click(h, '[data-council-memory-action="edit-held"]');
        const edited = await memoryWhere(h, `m.input === ${q(HELD.text)}`);
        const refined = await callAfter(h, () => click(h, '[data-council-memory-action="set"]'));
        await swap(h, ctx, "heldSet");
        const sevenSet = await memoryWhere(h, `m.chosen === ${q(HELD.text)} && m.card === "suggestion"`);
        rec(
            "7. Edit on the held card puts its text into the input and focuses it; Set then calls `set` with that text (no source), and once the backend has set it the held card is gone, the suggestion behind it shows and the old direction is Replaced",
            edited?.input === HELD.text &&
                edited.inputFocused === true &&
                isCall(refined, id, "set", HELD.text) &&
                sevenSet?.cards === 1 &&
                sevenSet.card.kind === "suggestion" &&
                sevenSet.replaced.length === 3,
            { input: edited?.input, focused: edited?.inputFocused, call: refined, card: sevenSet?.card?.kind, rows: sevenSet?.replaced.length }
        );
        await swap(h, ctx, "held");
        await memoryWhere(h, `m.card === "held"`);
        const anywayCall = await callAfter(h, () => click(h, '[data-council-memory-action="setanyway"]'));
        await swap(h, ctx, "heldSet");
        await memoryWhere(h, `m.chosen === ${q(HELD.text)}`);
        await swap(h, ctx, "held");
        await memoryWhere(h, `m.card === "held"`);
        const discardCall = await callAfter(h, () => click(h, '[data-council-memory-action="discard"]'));
        await swap(h, ctx, "heldOut");
        const discarded = await memoryWhere(h, `m.card === "suggestion" && m.chosen === ${q(DIRECTION)}`);
        rec(
            "7. Set anyway calls `setanyway` and Discard calls `discard`, each with no text and no source; after Discard the chosen direction is as it was",
            isCall(anywayCall, id, "setanyway") && isCall(discardCall, id, "discard") && discarded?.chosen?.text === DIRECTION,
            { anyway: anywayCall, discard: discardCall, chosen: discarded?.chosen?.text }
        );

        // 8. Edit on the chosen direction, with new text, calls `edit`; Unpin calls `unpin`
        await swap(h, ctx, "settled");
        await memoryWhere(h, `m.card === null && m.chosen === ${q(DIRECTION)}`);
        await click(h, '[data-council-memory-action="edit"]');
        const editing = await memoryWhere(h, `m.editing`);
        const unchanged = await h.ev(`document.querySelector('[data-council-memory-action="save"]')?.disabled ?? null`);
        await typeInto(h, "[data-council-memory-edit-input]", `  ${EDITED}  `);
        await until(h, `document.querySelector('[data-council-memory-action="save"]')?.disabled === false`);
        const editCall = await callAfter(h, () => click(h, '[data-council-memory-action="save"]'));
        await swap(h, ctx, "edited");
        const eight = await memoryWhere(h, `m.chosen === ${q(EDITED)} && !m.editing`);
        rec(
            "8. Edit on the chosen direction opens its text for editing (Save waits until it changes), and Save with new text calls `edit` with the trimmed text; the saved council shows the new direction, the old one at the top of Replaced as `edited`",
            editing?.chosen?.editing === DIRECTION &&
                unchanged === true &&
                isCall(editCall, id, "edit", EDITED) &&
                eight?.replaced[0]?.line === `Pinned by you · edited ${hhmm(at(-1))}` &&
                eight.replaced.length === 3,
            { editing: editing?.chosen?.editing, saveWhileUnchanged: unchanged, call: editCall, first: eight?.replaced[0] }
        );
        const unpinCall = await callAfter(h, () => click(h, '[data-council-memory-action="unpin"]'));
        await swap(h, ctx, "unpinned");
        const unpinned = await memoryWhere(h, `m.chosen === null && m.empty`);
        rec(
            "8. Unpin calls `unpin`; with no direction left the tab is the input and the muted line again, and the four Replaced rows still show under it",
            isCall(unpinCall, id, "unpin") &&
                unpinned?.chosen == null &&
                unpinned.empty === "Pin a message with Chốt, or write the direction here." &&
                unpinned.replaced.length === 4 &&
                unpinned.replaced[0].line === `Written by you · unpinned ${hhmm(at(-1))}`,
            { empty: unpinned?.empty, rows: unpinned?.replaced.length, first: unpinned?.replaced[0] }
        );

        // 9. the stand-in failing shows the action's error where it was clicked
        const REFUSED = "the check did not answer: model timeout";
        await stubRpc(h, [COMMAND], { [COMMAND]: { reject: REFUSED } });
        await typeInto(h, "[data-council-memory-input]", "Open the rail on a cold start");
        await until(h, `document.querySelector('[data-council-memory-action="set"]')?.disabled === false`);
        const failedCall = await callAfter(h, () => click(h, '[data-council-memory-action="set"]'));
        await until(h, `!!document.querySelector("[data-council-memory-error]")`);
        const nine = await readMemory(h);
        const header = await text(h, "[data-council-error]");
        rec(
            "9. when the command fails, the panel says `Set the direction failed: <why>` under the input and the discussion's header says the same, the typed text is kept, and Set is ready again",
            isCall(failedCall, id, "set", "Open the rail on a cold start") &&
                nine?.error === `Set the direction failed: ${REFUSED}` &&
                header === `Set the direction failed: ${REFUSED}` &&
                nine.input === "Open the rail on a cold start" &&
                nine.set.label === "Set" &&
                nine.set.disabled === false,
            { call: failedCall, error: nine?.error, header, input: nine?.input, set: nine?.set }
        );
        await stubRpc(h, [COMMAND]);

        // 10. Chốt on a message, on an idea, and the key on the idea under the cursor
        const R20 = "Pin the rail apps first. Measure after.";
        const msgCall = await callAfter(h, () => click(h, '[data-council-reply-post="r20"] [data-council-chot="r20"]'));
        const ideaCall = await callAfter(h, () => click(h, '[data-council-idea="P2"] [data-council-chot="P2"]'));
        rec(
            "10. Chốt in a seat's message calls `pin` with the message cut to one line and its id (r20); Chốt in an idea's action row calls `pin` with the idea's title and id (P2)",
            isCall(msgCall, id, "pin", R20, "r20") && isCall(ideaCall, id, "pin", TITLES[1], "P2"),
            { message: msgCall, idea: ideaCall }
        );
        // the key: a rail row puts the cursor on P4, focus goes into the channel, p pins that idea
        await click(h, `${RAIL} [data-council-rail-tab="ideas"]`);
        await until(h, `!!document.querySelector(${q(`${RAIL} [data-council-rail-idea="P4"]`)})`);
        await click(h, `${RAIL} [data-council-rail-idea="P4"]`);
        await until(h, `document.querySelector('[data-council-idea="P4"]')?.getAttribute("data-focused") === "true"`);
        await focusOn(h, CHANNEL);
        const keyCall = await callAfter(h, () => press(h, "p", "KeyP", 80));
        rec(
            "10. the `council:chot` key (p), with focus in the channel and the cursor on idea P4, calls `pin` with P4's title and id",
            isCall(keyCall, id, "pin", TITLES[3], "P4"),
            { call: keyCall }
        );

        return steps;
    },

    async teardown(h, ctx) {
        await teardownCouncilProject(h, ctx);
    },
};

// the colour a theme token resolves to, read through a probe element so a theme override is followed
function readCardColour(h, token) {
    return h.ev(`(() => {
        const probe = document.createElement("i");
        probe.style.color = "var(--color-${token})";
        document.body.appendChild(probe);
        const v = getComputedStyle(probe).color;
        probe.remove();
        return v;
    })()`);
}
