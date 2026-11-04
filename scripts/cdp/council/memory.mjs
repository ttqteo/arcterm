// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0
//
// council-memory (docs/superpowers/specs/2026-11-05-council-memory-design.md; the plan: docs/superpowers/plans/
// 2026-11-05-council-memory.md, Task 7): the Memory tab of the council's rail drawn as one list, from the boards C-merged
// (the list, a hovered entry with its details), C-add (the Add form, Earlier unfolded) and C-empty (the legend) in
// .superpowers/design/council-memory. The hooks are called by councilscenarios.mjs as arrange(h, fx), assert(h, ctx, fx),
// teardown(h, ctx, fx).
//
// Nothing here calls a model. The council is the finished `done` fixture with fourteen ideas about a made-up caching
// feature and a few posts of the channel, written into the data dir as a JSON file. `CouncilDirectionCommand` and
// `CouncilMemoryCommand` are replaced in the page: each step clicks, asserts the call the stand-in recorded (every field,
// so a stray `from` or `entry` fails it), and then writes the council again with the memory the backend would have saved
// and announces it, so the tab redraws from a real `council:changed` the way it does in the app. Each step's result is
// recorded under its name (`list`, `suggestion`, ...) and every step takes a shot `cdp-shots/council-memory-<name>.png`
// for Final's verifier to judge: against its board where the step draws one, and the in-place editors (`edit`,
// `direction`) with the new text typed, where no board shows them.

import { waitFor } from "../attach.mjs";
import {
    announceCouncil,
    arrangeCouncilProject,
    councilFixtureId,
    openCouncil,
    rpcCalls,
    stubRpc,
    teardownCouncilProject,
    writeCouncil,
} from "./fixtures.mjs";

const WAIT_MS = 10_000;
const DIRECTION_CMD = "CouncilDirectionCommand";
const MEMORY_CMD = "CouncilMemoryCommand";
const RAIL = "[data-council-rail]";
const MEMORY = "[data-council-memory]";
const CHANNEL = "[data-council-channel]";
const MIN = 60_000;
const SEEN_KEY = "council.memory.seen";

const q = (s) => JSON.stringify(s);
const NORM = `.replace(/\\s+/g, " ").trim()`;
const until = (h, expr, ms = WAIT_MS) => waitFor((e) => h.ev(e), expr, ms);
const click = (h, sel) =>
    h.ev(`(() => { const el = document.querySelector(${q(sel)}); if (el == null || el.disabled) return false; el.click(); return true; })()`);
const text = (h, sel) => h.ev(`(document.querySelector(${q(sel)})?.textContent ?? "")${NORM}`);
const pause = (ms) => new Promise((r) => setTimeout(r, ms));
// a React-controlled field takes the native setter and an input event (an <input> or a <textarea>)
const typeInto = (h, sel, value) =>
    h.ev(`(() => {
        const el = document.querySelector(${q(sel)});
        if (!el) return false;
        const set = Object.getOwnPropertyDescriptor(Object.getPrototypeOf(el), "value").set;
        set.call(el, ${q(value)});
        el.dispatchEvent(new Event("input", { bubbles: true }));
        return true;
    })()`);
// focus, not hover: the row's actions and the details popover must show for a keyboard
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
const clone = (o) => JSON.parse(JSON.stringify(o));

// fourteen ideas, P1 to P14, by the four seats in turn, each long enough to fill a few lines of the channel
const SEATS = ["ux", "ram", "newuser", "skeptic"];
const TITLES = [
    "Cache the last ten answers per project",
    "Expire a cached answer after ten minutes",
    "Keep the cache in memory only",
    "Write the cache to disk between launches",
    "Show a cache miss as a short wait, not an error",
    "Let a person clear one cached answer",
    "Count hits and misses in the footer",
    "Warm the cache when a project opens",
    "Name a cached answer by its question",
    "Drop the cache when the model changes",
    "Warn before a cached answer is older than a day",
    "Keep one cache per project, not one for all",
    "Cap the cache at fifty megabytes",
    "Give each cached answer a refresh key",
];
const FILLER =
    "A cached answer saves a model call while the question stays the same, and the seats that read it can still tell how old it is. " +
    "It costs a few lines of state, and the person decides when it matters.";

// the ideas, replies on them, and two posts of the channel (r20 on several lines, which Chốt cuts to one)
function ideasOf(c) {
    c.feature = "Answer cache";
    c.question = "Which changes to how answers are cached are worth making first?";
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
        { id: "r3", proposalid: "P4", author: "skeptic", text: "A stale file with no way to tell.", round: 2, ts: ts(210), stance: "oppose" },
        { id: "r20", proposalid: "", author: "ram", text: "Pin the cache first.\n\nMeasure after.", round: 3, ts: ts(700) },
        { id: "r21", proposalid: "", author: "ux", text: "Ten answers is enough for now.", round: 3, ts: ts(705) },
    ];
}

// the entries: two Agreed (m1 automatic, round 3, resting on r21; m2 yours), two Ruled out (m3 yours with a why; m4
// automatic, round 2), two Open (m5 automatic, round 3; m6 yours). In arrival order: the list sorts them newest first
const E = {
    m1: { id: "m1", kind: "agreed", text: "A cached answer expires after ten minutes", by: "auto", round: 3, messages: ["r21"], at: at(-8) },
    m2: { id: "m2", kind: "agreed", text: "The cache lives in memory only", by: "you", at: at(-30) },
    m3: { id: "m3", kind: "ruledout", text: "Keep a copy of the cache on disk", why: "A stale file outlives the code that wrote it.", by: "you", at: at(-22) },
    m4: { id: "m4", kind: "ruledout", text: "Share one cache across projects", by: "auto", round: 2, messages: ["P4"], at: at(-45) },
    m5: { id: "m5", kind: "open", text: "What a cache miss looks like to the person", by: "auto", round: 3, messages: ["P5"], at: at(-6) },
    m6: { id: "m6", kind: "open", text: "Who clears the cache on logout", by: "you", at: at(-15) },
};
const ORDER = ["m5", "m1", "m6", "m3", "m2", "m4"]; // newest first
const NEW_IDS = ["m5", "m1", "m6"]; // after SEEN: the tab was last open at SEEN, so these carry the new dot and the rest do not
const SEEN = at(-18);

const DIRECTION = "Keep the last ten answers in memory and expire them after ten minutes";
const EDITED = "Keep the last twenty answers in memory and expire them after ten minutes";
const CHOSEN = { text: DIRECTION, how: "pin", from: "P3", at: at(-35) };
const EARLIER = { text: "Cache every answer on disk", how: "written", at: at(-80), replaced: at(-35), ended: "edited" };
const SUGGESTION = {
    kind: "suggestion",
    text: "Measure the hit rate before widening the cache",
    reason: "Skeptic and RAM both said to measure first.",
    source: "check",
    round: 3,
    messages: ["P1", "r21"],
    at: at(-5),
};
const heldOf = (entry) => ({
    kind: "held",
    text: entry.text,
    reason: "Three seats agreed on a cache in memory only (Idea 3), and this may clash with it.",
    how: "pin",
    entry: entry.id,
    at: at(-2),
});

// the badge words and what each means: verbatim from the spec, not read back from the page's own table
const BADGES = {
    direction: { word: "Direction", meaning: "What the council will do. The seats follow it over the Report." },
    agreed: { word: "Agreed", meaning: "Settled as true. The seats do not argue it again." },
    ruledout: { word: "Ruled out", meaning: "Dropped. The seats do not bring it back without something new." },
    open: { word: "Open", meaning: "Still to settle. The seats work on it next." },
};
const EMPTY_LINE = "Nothing yet. What the seats agree on, rule out or leave open shows up here after each round.";

// the memory the backend would save: the pure moves each step makes on it, as the Go side makes them
const memory = (parts) => {
    const m = clone(parts);
    if (m.chosen != null) m.changed = m.chosen.at;
    m.nextentry = Math.max(0, ...(m.entries ?? []).map((e) => Number(e.id.replace(/^\D+/, "")) || 0));
    return m;
};
const base = () =>
    memory({ chosen: CHOSEN, replaced: [EARLIER], entries: Object.values(E), suggestion: SUGGESTION });
// a new direction: the old one moves to the top of replaced, ended `replaced` or `edited` or `unpinned`
function setChosen(m, chosen, ended, t) {
    if (m.chosen != null) m.replaced = [{ ...m.chosen, replaced: t, ended }, ...(m.replaced ?? [])];
    if (chosen == null) delete m.chosen;
    else m.chosen = chosen;
    m.changed = t;
    return m;
}
const without = (m, id) => ({ ...m, entries: m.entries.filter((e) => e.id !== id) });
const entryOf = (m, id) => m.entries.find((e) => e.id === id);

// ---- what the page draws ----

// the rail's tabs: which one shows, the Memory tab's label and dot, and whether + Add is in the strip
const readRail = (h) =>
    h.ev(`(() => {
        const rail = document.querySelector(${q(RAIL)});
        if (!rail) return null;
        const norm = (e) => (e?.textContent ?? "")${NORM};
        const tab = rail.querySelector('[data-council-rail-tab="memory"]');
        const dot = tab?.querySelector("[data-council-memory-dot]");
        const add = rail.querySelector("[data-council-memory-open-add]");
        return {
            shows: rail.getAttribute("data-rail-tab"),
            tabs: [...rail.querySelectorAll("[data-council-rail-tab]")].map((t) => t.getAttribute("data-council-rail-tab")),
            memoryLabel: norm(tab),
            memoryOn: tab?.getAttribute("aria-selected") === "true",
            dot: !!dot,
            dotColour: dot ? getComputedStyle(dot).backgroundColor : null,
            add: add ? { label: norm(add), open: add.getAttribute("aria-expanded") === "true" } : null,
        };
    })()`);

// the panel's facts, as one expression a step can ask once (readPanel) or poll (panelWhere)
const PANEL_JS = `() => {
    const root = document.querySelector(${q(MEMORY)});
    const norm = (e) => (e?.textContent ?? "")${NORM};
    const top = (e) => (e ? Math.round(e.getBoundingClientRect().top) : null);
    const badgeOf = (scope) => {
        const b = scope?.querySelector("[data-council-memory-badge]");
        return b ? { kind: b.getAttribute("data-council-memory-badge"), word: norm(b), title: b.getAttribute("title") } : null;
    };
    const labels = (scope) => [...scope.querySelectorAll("[data-council-memory-action]")].map((b) => b.getAttribute("aria-label") ?? norm(b));
    const dir = root.querySelector("[data-council-memory-direction]");
    const card = root.querySelector("[data-council-memory-card]");
    const add = root.querySelector("[data-council-memory-add]");
    const legend = root.querySelector("[data-council-memory-legend]");
    const first = root.querySelector("[data-council-memory-entry]");
    const entries = [...root.querySelectorAll("[data-council-memory-entry]")].map((e) => {
        const chot = e.querySelector('[data-council-memory-action="chot"]');
        const pop = e.querySelector("[data-council-memory-popover]");
        return {
            id: e.getAttribute("data-council-memory-entry"),
            kind: e.getAttribute("data-kind"),
            text: norm(e.querySelector("[data-council-memory-entry-text]")),
            why: e.querySelector("[data-council-memory-entry-why]") ? norm(e.querySelector("[data-council-memory-entry-why]")) : null,
            badge: badgeOf(e),
            dot: !!e.querySelector("[data-council-memory-new]"),
            editing: !!e.querySelector("[data-council-memory-editor]"),
            editText: e.querySelector("[data-council-memory-edit-text]")?.value ?? null,
            editWhy: e.querySelector("[data-council-memory-edit-why]")?.value ?? null,
            save: e.querySelector('[data-council-memory-action="save"]') ? { disabled: e.querySelector('[data-council-memory-action="save"]').disabled } : null,
            actionsOpacity: chot ? getComputedStyle(chot.parentElement).opacity : null,
            actions: chot ? labels(chot.parentElement) : [],
            popover: pop ? { text: norm(pop), messages: [...pop.querySelectorAll("[data-council-memory-message]")].map((a) => a.getAttribute("data-council-memory-message")) } : null,
            focusInside: e.matches(":focus-within"),
            top: top(e),
        };
    });
    return {
        ids: entries.map((e) => e.id),
        entries,
        direction: dir == null ? null : {
            text: norm(dir.querySelector("[data-council-memory-direction-text]")),
            badge: badgeOf(dir),
            editing: !!dir.querySelector("[data-council-memory-editor]"),
            editText: dir.querySelector("[data-council-memory-edit-text]")?.value ?? null,
            earlier: dir.querySelector('[data-council-memory-action="earlier"]') ? norm(dir.querySelector('[data-council-memory-action="earlier"]')) : null,
            earlierOpen: dir.querySelector('[data-council-memory-action="earlier"]')?.getAttribute("aria-expanded") === "true",
            rows: [...dir.querySelectorAll("[data-council-memory-earlier-row]")].map((r) => ({
                parts: [...r.children].map((s) => norm(s)),
                struck: [...r.children].some((s) => getComputedStyle(s).textDecorationLine.includes("line-through")),
            })),
            top: top(dir),
        },
        card: card == null ? null : {
            kind: card.getAttribute("data-council-memory-card"),
            kicker: norm(card.querySelector("[data-council-memory-kicker]")),
            text: norm(card.querySelector("[data-council-memory-card-text]")),
            reason: card.querySelector("[data-council-memory-reason]") ? norm(card.querySelector("[data-council-memory-reason]")) : null,
            links: [...card.querySelectorAll("[data-council-memory-reason-link]")].map((a) => a.getAttribute("data-council-memory-reason-link")),
            buttons: labels(card),
            gone: card.querySelector("[data-council-memory-gone]") ? norm(card.querySelector("[data-council-memory-gone]")) : null,
            top: top(card),
        },
        add: add == null ? null : {
            kind: add.querySelector('[data-council-memory-kind][aria-checked="true"]')?.getAttribute("data-council-memory-kind") ?? null,
            kinds: [...add.querySelectorAll("[data-council-memory-kind]")].map((b) => b.getAttribute("data-council-memory-kind")),
            text: add.querySelector("[data-council-memory-add-text]")?.value ?? null,
            why: add.querySelector("[data-council-memory-add-why]")?.value ?? null,
        },
        empty: root.querySelector("[data-council-memory-empty]") ? norm(root.querySelector("[data-council-memory-empty]")) : null,
        legend: legend == null ? null : [...legend.children].map((row) => ({
            badge: badgeOf(row),
            meaning: norm(row.querySelector("dd")),
        })),
        error: root.querySelector("[data-council-memory-error]") ? norm(root.querySelector("[data-council-memory-error]")) : null,
        badges: [...root.querySelectorAll("[data-council-memory-badge]")].map((b) => ({
            kind: b.getAttribute("data-council-memory-badge"),
            height: Math.round(b.getBoundingClientRect().height * 10) / 10,
            fontSize: parseFloat(getComputedStyle(b).fontSize),
        })),
        firstEntryTop: top(first),
        directionBeforeEntries: dir != null && first != null ? !!(dir.compareDocumentPosition(first) & Node.DOCUMENT_POSITION_FOLLOWING) : null,
    };
}`;
const readPanel = (h) => h.ev(`(${PANEL_JS})()`);
// waits for the panel to show `test` (a page expression over `m`, the panel's facts) and answers the facts it ended on
async function panelWhere(h, test) {
    await until(
        h,
        `(() => { if (!document.querySelector(${q(MEMORY)})) return false; const m = (${PANEL_JS})(); return ${test}; })()`
    );
    return readPanel(h);
}

const entry = (m, id) => m?.entries.find((e) => e.id === id);
const badgeOk = (b, kind) => b?.kind === kind && b.word === BADGES[kind].word && b.title === BADGES[kind].meaning;
// no badge wraps: each is one line of its own text
const oneLine = (badges) => badges.length > 0 && badges.every((b) => b.height <= Math.ceil(b.fontSize * 1.7) + 4);

// the rail's Memory tab, shown
async function showMemory(h) {
    await click(h, `${RAIL} [data-council-rail-tab="memory"]`);
    await until(h, `!!document.querySelector(${q(MEMORY)})`);
}

// does `trigger` and answers the call the `name` stand-in took for it: the call's data, or null when none came
async function callAfter(h, name, trigger) {
    const before = (await rpcCalls(h, name)).length;
    await trigger();
    const came = await until(h, `(window.__arcCouncilStub?.calls ?? []).filter((c) => c.name === ${q(name)}).length > ${before}`);
    return came ? ((await rpcCalls(h, name)).at(-1)?.data ?? null) : null;
}
// the call is exactly `want`: every field, in no order, so a stray `from`, `entry` or `why` fails it
const canon = (o) => JSON.stringify(Object.fromEntries(Object.entries(o).sort(([a], [b]) => (a < b ? -1 : 1))));
const isCall = (data, want) => data != null && canon(data) === canon(want);

// where an element sits in the channel: inside its visible box or not
const inView = (h, id) =>
    h.ev(`(() => {
        const box = document.querySelector(${q(CHANNEL)});
        const el = box?.querySelector('[data-council-idea=${q(id)}]');
        if (!box || !el) return null;
        const b = box.getBoundingClientRect(), r = el.getBoundingClientRect();
        return { shown: r.top >= b.top - 2 && r.bottom <= b.bottom + 2, top: Math.round(r.top - b.top), scrollTop: Math.round(box.scrollTop), focused: el.getAttribute("data-focused") === "true" };
    })()`);
const scrollChannelToEnd = async (h) => {
    await h.ev(`(() => { const box = document.querySelector(${q(CHANNEL)}); if (box) box.scrollTop = box.scrollHeight; })()`);
    await pause(300);
};

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

        // writes the council again with `m` as its memory (none when null) and tells the page, as `council:changed` does
        const swap = async (m) => {
            writeCouncil(ctx, "done", {
                id,
                edit: (c) => {
                    ideasOf(c);
                    if (m != null) c.memory = clone(m);
                },
            });
            await announceCouncil(h, ctx, id);
        };
        const dirCall = (trigger) => callAfter(h, DIRECTION_CMD, trigger);
        const memCall = (trigger) => callAfter(h, MEMORY_CMD, trigger);
        // the stand-ins answer at once and record every call
        await stubRpc(h, [DIRECTION_CMD, MEMORY_CMD]);

        // the tab was last open at SEEN: the entries after it are new. Written where the page reads it as the rail mounts,
        // and announced to an atom that already mounted (a `storage` event is what a second window's write raises)
        const seed = JSON.stringify({ [id]: SEEN });
        await h.ev(`(() => { try { localStorage.setItem(${q(SEEN_KEY)}, ${q(seed)}); } catch {} })()`);
        await swap(base());

        // 1. list (board C-merged)
        await openCouncil(h, id, "discussion");
        await until(h, `document.querySelectorAll(${q(`${RAIL} [data-council-rail-idea]`)}).length === ${TITLES.length}`);
        await h.ev(`window.dispatchEvent(new StorageEvent("storage", { key: ${q(SEEN_KEY)}, newValue: ${q(seed)}, storageArea: localStorage }))`);
        await pause(200);
        // read before opening the tab: opening it marks everything seen
        const railIdeas = await readRail(h);
        await showMemory(h);
        const railMemory = await readRail(h);
        const list = await panelWhere(h, `m.ids.length === ${ORDER.length} && m.direction !== null`);
        await h.shot("cdp-shots/council-memory-list.png");
        const byId = Object.fromEntries(list.entries.map((e) => [e.id, e]));
        rec(
            "list: the Direction pinned on top, then the six entries newest first (m5, m1, m6, m3, m2, m4), each badge's word and `title` the meaning of its kind",
            list.directionBeforeEntries === true &&
                list.direction.text === DIRECTION &&
                badgeOk(list.direction.badge, "direction") &&
                list.ids.join() === ORDER.join() &&
                list.entries.every((e) => badgeOk(e.badge, e.kind)) &&
                list.entries.every((e) => BADGES[e.kind] != null) &&
                list.entries.map((e) => e.badge.word).join() === ORDER.map((m) => BADGES[E[m].kind].word).join() &&
                list.entries.map((e) => e.text).join("|") === ORDER.map((m) => E[m].text).join("|") &&
                byId.m3.why === E.m3.why &&
                byId.m4.why === null &&
                list.card?.kind === "suggestion",
            { ids: list.ids, direction: list.direction?.text, badges: list.entries.map((e) => e.badge), why: [byId.m3?.why, byId.m4?.why] }
        );
        rec(
            "list: the new dot shows on the entries after the seen time (m5, m1, m6) and not on the older ones; the tab reads `Memory · 7` with its dot, and `+ Add` is in the tab strip only while Memory shows",
            list.entries.filter((e) => e.dot).map((e) => e.id).join() === NEW_IDS.join() &&
                railIdeas?.shows === "ideas" &&
                railIdeas.memoryLabel === "Memory · 7" &&
                railIdeas.dot === true &&
                railIdeas.add == null &&
                railMemory?.shows === "memory" &&
                railMemory.memoryLabel === "Memory · 7" &&
                railMemory.dot === true &&
                railMemory.add?.label === "Add" &&
                railMemory.add.open === false,
            { dots: list.entries.filter((e) => e.dot).map((e) => e.id), ideas: railIdeas, memory: railMemory }
        );

        // 2. suggestion: the card, and its reason's links into the channel
        await scrollChannelToEnd(h);
        const before = await inView(h, "P1");
        await h.shot("cdp-shots/council-memory-suggestion.png");
        rec(
            "suggestion: the card's kicker reads `Suggested direction`, its reason (with Make it the direction and Dismiss) is followed by two message links, P1 and r21",
            list.card?.kicker === "Suggested direction" &&
                list.card.text === SUGGESTION.text &&
                list.card.reason === `${SUGGESTION.reason} P1 r21` &&
                list.card.links.join() === "P1,r21" &&
                list.card.buttons.join("|") === "Make it the direction|Dismiss" &&
                list.card.top < list.direction.top,
            { card: list.card }
        );
        await click(h, '[data-council-memory-reason-link="P1"]');
        await pause(500);
        const after = await inView(h, "P1");
        rec(
            "suggestion: a click on the link `P1` brings that message into view in the channel (it was out of sight at the end of the channel) and puts the j / k cursor on it",
            before != null && before.shown === false && after?.shown === true && after.scrollTop < before.scrollTop && after.focused === true,
            { before, after }
        );

        // 3. details (board C-merged, the hovered entry): reached by focus, not by hover
        await focusOn(h, '[data-council-memory-entry="m6"] [data-council-memory-details]');
        await until(h, `!!document.querySelector('[data-council-memory-entry="m6"] [data-council-memory-popover]')`);
        const yours = await readPanel(h);
        await focusOn(h, '[data-council-memory-entry="m1"] [data-council-memory-details]');
        await until(h, `!!document.querySelector('[data-council-memory-entry="m1"] [data-council-memory-popover]') && !document.querySelector('[data-council-memory-entry="m6"] [data-council-memory-popover]')`);
        await pause(250);
        const auto = await readPanel(h);
        await h.shot("cdp-shots/council-memory-details.png");
        const focused = await h.ev(`document.activeElement?.matches('[data-council-memory-entry="m1"] [data-council-memory-details]') ?? false`);
        rec(
            "details: with focus (not hover) on the auto Agreed's details button, its actions (Chốt, Edit, Remove) and the popover show, reading `Auto · round 3` and a link to r21; an entry nobody focuses keeps its actions hidden",
            focused === true &&
                entry(auto, "m1").focusInside === true &&
                entry(auto, "m1").actionsOpacity === "1" &&
                entry(auto, "m1").actions.join("|") === "Chốt|Edit|Remove" &&
                entry(auto, "m1").popover?.text.startsWith("Auto · round 3") &&
                entry(auto, "m1").popover.messages.join() === "r21" &&
                entry(auto, "m2").actionsOpacity === "0" &&
                entry(auto, "m2").popover == null,
            { m1: entry(auto, "m1"), m2: entry(auto, "m2") }
        );
        rec(
            "details: the yours entry's popover reads `You · <time>` with the time it was added; no badge on the badge line wraps",
            entry(yours, "m6").popover?.text === `You · ${hhmm(E.m6.at)}` &&
                entry(yours, "m6").popover.messages.length === 0 &&
                oneLine(auto.badges) &&
                auto.badges.length === ORDER.length + 1,
            { m6: entry(yours, "m6"), badges: auto.badges }
        );
        await h.ev(`document.activeElement?.blur()`);

        // 4. add (board C-add): + Add, Ruled out, a text and a why
        const WHY = "A cached answer from another project is a wrong answer.";
        const ADDED = "Cache answers across projects";
        await click(h, "[data-council-memory-open-add]");
        await until(h, `!!document.querySelector("[data-council-memory-add]")`);
        const form = await readPanel(h);
        await click(h, '[data-council-memory-kind="ruledout"]');
        await until(h, `!!document.querySelector("[data-council-memory-add-why]")`);
        await typeInto(h, "[data-council-memory-add-text]", `  ${ADDED}  `);
        await typeInto(h, "[data-council-memory-add-why]", `  ${WHY}  `);
        await until(h, `document.querySelector('[data-council-memory-add] [data-council-memory-action="add"]')?.disabled === false`);
        await h.shot("cdp-shots/council-memory-add.png");
        const addCall = await memCall(() => click(h, '[data-council-memory-add] [data-council-memory-action="add"]'));
        const cur4 = base();
        cur4.entries.push({ id: "m7", kind: "ruledout", text: ADDED, why: WHY, by: "you", at: at(-1) });
        cur4.nextentry = 7;
        await swap(cur4);
        const added = await panelWhere(h, `m.ids[0] === "m7" && m.add === null`);
        rec(
            "add: + Add opens the form on Agreed with the four kinds; Ruled out, the text and a why, Add calls `add` with kind, text and why (trimmed), the form closes and the new entry shows first with its why",
            form.add?.kind === "agreed" &&
                form.add.kinds.join() === "direction,agreed,ruledout,open" &&
                isCall(addCall, { id, action: "add", kind: "ruledout", text: ADDED, why: WHY }) &&
                added.ids.join() === ["m7", ...ORDER].join() &&
                entry(added, "m7").text === ADDED &&
                entry(added, "m7").why === WHY &&
                badgeOk(entry(added, "m7").badge, "ruledout"),
            { form: form.add, call: addCall, ids: added.ids, m7: entry(added, "m7") }
        );

        // 5. edit: the yours Ruled out, in place
        const NEWTEXT = "Keep a copy of the cache on disk between launches";
        const NEWWHY = "A stale file outlives the code that wrote it, whatever its age.";
        await click(h, '[data-council-memory-entry="m3"] [data-council-memory-action="edit"]');
        await until(h, `!!document.querySelector('[data-council-memory-entry="m3"] [data-council-memory-edit-text]')`);
        const editing = await readPanel(h);
        await typeInto(h, '[data-council-memory-entry="m3"] [data-council-memory-edit-text]', `  ${NEWTEXT}  `);
        await typeInto(h, '[data-council-memory-entry="m3"] [data-council-memory-edit-why]', `  ${NEWWHY}  `);
        await until(h, `document.querySelector('[data-council-memory-entry="m3"] [data-council-memory-action="save"]')?.disabled === false`);
        await pause(250);
        await h.shot("cdp-shots/council-memory-edit.png");
        const editCall = await memCall(() => click(h, '[data-council-memory-entry="m3"] [data-council-memory-action="save"]'));
        const cur5 = clone(cur4);
        Object.assign(entryOf(cur5, "m3"), { text: NEWTEXT, why: NEWWHY });
        await swap(cur5);
        const edited = await panelWhere(h, `m.entries.find((e) => e.id === "m3")?.text === ${q(NEWTEXT)} && !m.entries.find((e) => e.id === "m3").editing`);
        rec(
            "edit: Edit on the yours Ruled out opens its text and why in place (Save waits until one changes); Save calls `edit` with the entry, text and why, and the new text shows",
            entry(editing, "m3").editText === E.m3.text &&
                entry(editing, "m3").editWhy === E.m3.why &&
                entry(editing, "m3").save?.disabled === true &&
                isCall(editCall, { id, action: "edit", entry: "m3", text: NEWTEXT, why: NEWWHY }) &&
                entry(edited, "m3").text === NEWTEXT &&
                entry(edited, "m3").why === NEWWHY,
            { editing: entry(editing, "m3"), call: editCall, m3: entry(edited, "m3") }
        );

        // 6. chot: an Agreed entry becomes the direction and leaves the list
        const chotCall = await dirCall(() => click(h, '[data-council-memory-entry="m2"] [data-council-memory-action="chot"]'));
        const cur6 = without(cur5, "m2");
        setChosen(cur6, { text: E.m2.text, how: "pin", at: at(-1) }, "replaced", at(-1));
        await swap(cur6);
        const chot = await panelWhere(h, `m.direction?.text === ${q(E.m2.text)} && !m.ids.includes("m2")`);
        await pause(250);
        await h.shot("cdp-shots/council-memory-chot.png");
        rec(
            "chot: Chốt on the Agreed entry calls `pin` with its text and entry id (no from); once the saved direction is announced the entry is gone from the list and its text is the direction",
            isCall(chotCall, { id, action: "pin", text: E.m2.text, entry: "m2" }) &&
                chot.ids.join() === ["m7", ...ORDER].filter((m) => m !== "m2").join() &&
                chot.direction.text === E.m2.text &&
                chot.direction.earlier === "Earlier · 2",
            { call: chotCall, ids: chot.ids, direction: chot.direction?.text, earlier: chot.direction?.earlier }
        );

        // 7. held: a pin that clashes comes back held; Edit, Set anyway and Discard
        const pinHeld = async (m, entryId) => {
            const call = await dirCall(() => click(h, `[data-council-memory-entry="${entryId}"] [data-council-memory-action="chot"]`));
            const held = { ...clone(m), held: heldOf(entryOf(m, entryId)) };
            await swap(held);
            return { call, held, panel: await panelWhere(h, `m.card?.kind === "held"`) };
        };
        const one = await pinHeld(cur6, "m1");
        await h.shot("cdp-shots/council-memory-held.png");
        await click(h, '[data-council-memory-action="edit-held"]');
        const heldEdit = await panelWhere(h, `m.add !== null`);
        rec(
            "held: Chốt on another entry comes back held: the card shows `Held · this may clash with what the seats agreed` with the entry still listed; its Edit opens the Add form with Direction picked and the held text in it",
            isCall(one.call, { id, action: "pin", text: E.m1.text, entry: "m1" }) &&
                one.panel.card.kicker === "Held · this may clash with what the seats agreed" &&
                one.panel.card.text === E.m1.text &&
                one.panel.card.buttons.join("|") === "Edit|Set anyway|Discard" &&
                one.panel.ids.includes("m1") &&
                heldEdit.add?.kind === "direction" &&
                heldEdit.add.text === E.m1.text,
            { call: one.call, card: one.panel.card, add: heldEdit.add }
        );
        // the form's Add is a plain `set`: no entry, so the entry stays
        const setCall = await dirCall(() => click(h, '[data-council-memory-add] [data-council-memory-action="add"]'));
        await panelWhere(h, `m.add === null`);
        const cur7 = clone(one.held);
        const anywayCall = await dirCall(() => click(h, '[data-council-memory-action="setanyway"]'));
        const afterAnyway = without(cur7, "m1");
        delete afterAnyway.held;
        setChosen(afterAnyway, { text: E.m1.text, how: "pin", from: "r21", at: at(-1) }, "replaced", at(-1));
        await swap(afterAnyway);
        const anyway = await panelWhere(h, `m.direction?.text === ${q(E.m1.text)} && m.card?.kind === "suggestion" && !m.ids.includes("m1")`);
        rec(
            "held: the form's Add is a `set` with the text and no entry; Set anyway calls `setanyway` with nothing else, and once announced the entry is gone from the list and the held card with it (the suggestion behind it shows)",
            isCall(setCall, { id, action: "set", text: E.m1.text }) &&
                isCall(anywayCall, { id, action: "setanyway" }) &&
                anyway.card?.kind === "suggestion" &&
                !anyway.ids.includes("m1") &&
                anyway.direction.text === E.m1.text,
            { set: setCall, setanyway: anywayCall, ids: anyway.ids }
        );
        const two = await pinHeld(afterAnyway, "m6");
        const discardCall = await dirCall(() => click(h, '[data-council-memory-action="discard"]'));
        const afterDiscard = clone(afterAnyway);
        await swap(afterDiscard);
        const discarded = await panelWhere(h, `m.card?.kind === "suggestion" && m.ids.includes("m6")`);
        rec(
            "held: on a second held pin Discard calls `discard` with nothing else; after the announce the held card is gone (the suggestion behind it shows) and the entry is still listed",
            two.panel.card.kind === "held" &&
                isCall(discardCall, { id, action: "discard" }) &&
                discarded.card?.kind === "suggestion" &&
                discarded.ids.includes("m6") &&
                discarded.direction.text === E.m1.text,
            { call: discardCall, ids: discarded.ids }
        );

        // 8. remove
        const removeCall = await memCall(() => click(h, '[data-council-memory-entry="m4"] [data-council-memory-action="remove"]'));
        const cur8 = without(afterDiscard, "m4");
        await swap(cur8);
        const removed = await panelWhere(h, `!m.ids.includes("m4")`);
        await pause(250);
        await h.shot("cdp-shots/council-memory-remove.png");
        rec(
            "remove: Remove on an entry calls `remove` with its id and nothing else, and it leaves the list",
            isCall(removeCall, { id, action: "remove", entry: "m4" }) &&
                !removed.ids.includes("m4") &&
                removed.ids.length === discarded.ids.length - 1,
            { call: removeCall, ids: removed.ids }
        );

        // 9. direction: edit it, then unpin it
        await click(h, '[data-council-memory-direction] [data-council-memory-action="edit"]');
        await until(h, `!!document.querySelector('[data-council-memory-direction] [data-council-memory-edit-text]')`);
        const dirEditing = await readPanel(h);
        await typeInto(h, "[data-council-memory-direction] [data-council-memory-edit-text]", `  ${EDITED}  `);
        await until(h, `document.querySelector('[data-council-memory-direction] [data-council-memory-action="save"]')?.disabled === false`);
        await pause(250);
        await h.shot("cdp-shots/council-memory-direction.png");
        const dirEditCall = await dirCall(() => click(h, '[data-council-memory-direction] [data-council-memory-action="save"]'));
        const cur9 = clone(cur8);
        setChosen(cur9, { text: EDITED, how: "written", at: at(-1) }, "edited", at(-1));
        await swap(cur9);
        const dirEdited = await panelWhere(h, `m.direction?.text === ${q(EDITED)} && !m.direction.editing`);
        const unpinCall = await dirCall(() => click(h, '[data-council-memory-direction] [data-council-memory-action="unpin"]'));
        const cur9b = clone(cur9);
        setChosen(cur9b, null, "unpinned", at(-1));
        await swap(cur9b);
        const unpinned = await panelWhere(h, `m.direction === null`);
        rec(
            "direction: the direction's Edit opens its text; Save with new text calls `edit` with the trimmed text and nothing else; Unpin then calls `unpin` and the direction row is gone",
            dirEditing.direction?.editText === E.m1.text &&
                isCall(dirEditCall, { id, action: "edit", text: EDITED }) &&
                dirEdited.direction.text === EDITED &&
                isCall(unpinCall, { id, action: "unpin" }) &&
                unpinned.direction === null &&
                unpinned.ids.length === removed.ids.length,
            { editing: dirEditing.direction?.editText, edit: dirEditCall, unpin: unpinCall, ids: unpinned.ids.length }
        );

        // 10. earlier (board C-add, Earlier unfolded): a chosen direction with the one it edited away
        await swap(base());
        await panelWhere(h, `m.direction !== null && m.ids.length === ${ORDER.length} && m.direction.earlier === "Earlier · 1"`);
        // the button shows with the row hovered or focused: focus it, as a keyboard does, then click
        await focusOn(h, '[data-council-memory-direction] [data-council-memory-action="earlier"]');
        await click(h, '[data-council-memory-direction] [data-council-memory-action="earlier"]');
        const earlier = await panelWhere(h, `m.direction?.earlierOpen === true && m.direction.rows.length === 1`);
        await click(h, "[data-council-memory-open-add]");
        await until(h, `!!document.querySelector("[data-council-memory-add]")`);
        await pause(250);
        await h.shot("cdp-shots/council-memory-earlier.png");
        const row = earlier.direction.rows[0];
        rec(
            "earlier: Earlier · 1 unfolds the direction the edit replaced, reading its text and `edited <time>` (not struck through)",
            earlier.direction.earlier === "Earlier · 1" &&
                row.parts[0] === EARLIER.text &&
                row.parts[1] === `edited ${hhmm(EARLIER.replaced)}` &&
                row.struck === false,
            { direction: earlier.direction }
        );
        await click(h, '[data-council-memory-add] [data-council-memory-action="cancel"]');
        await until(h, `!document.querySelector("[data-council-memory-add]")`);

        // 11. empty (board C-empty): nothing, and a memory from before entries existed
        await swap(null);
        const empty = await panelWhere(h, `m.empty !== null`);
        const railEmpty = await readRail(h);
        await h.shot("cdp-shots/council-memory-empty.png");
        rec(
            "empty: a council with nothing shows the empty line verbatim and a legend of the four badges with their meanings; the tab reads plain `Memory` with no dot",
            empty.empty === EMPTY_LINE &&
                empty.direction === null &&
                empty.card === null &&
                empty.ids.length === 0 &&
                empty.legend?.length === 4 &&
                ["direction", "agreed", "ruledout", "open"].every((k, i) => badgeOk(empty.legend[i].badge, k) && empty.legend[i].meaning === BADGES[k].meaning) &&
                railEmpty?.memoryLabel === "Memory" &&
                railEmpty.dot === false,
            { empty: empty.empty, legend: empty.legend, rail: railEmpty }
        );
        // a council saved before entries existed: no `entries`, no `nextentry`, just the direction
        await swap({ chosen: CHOSEN, changed: CHOSEN.at });
        const legacy = await panelWhere(h, `m.direction !== null && m.empty === null`);
        const railLegacy = await readRail(h);
        rec(
            "empty: a council saved before entries existed (a direction and nothing else) shows the direction with no entries and no legend, and the tab reads `Memory · 1`",
            legacy.direction.text === DIRECTION &&
                legacy.ids.length === 0 &&
                legacy.legend === null &&
                railLegacy?.memoryLabel === "Memory · 1",
            { direction: legacy.direction?.text, ids: legacy.ids, rail: railLegacy }
        );

        // kept from the steps before this one was redrawn: Make it the direction and Dismiss on the suggestion
        await swap(base());
        await panelWhere(h, `m.card?.kind === "suggestion"`);
        const acceptCall = await dirCall(() => click(h, '[data-council-memory-action="accept"]'));
        const accepted = base();
        delete accepted.suggestion;
        setChosen(accepted, { text: SUGGESTION.text, how: "suggested", source: "check", round: 3, at: at(-1) }, "replaced", at(-1));
        await swap(accepted);
        const acc = await panelWhere(h, `m.direction?.text === ${q(SUGGESTION.text)} && m.card === null`);
        await swap(base());
        await panelWhere(h, `m.card?.kind === "suggestion"`);
        const dismissCall = await dirCall(() => click(h, '[data-council-memory-action="dismiss"]'));
        const dismissed = base();
        delete dismissed.suggestion;
        await swap(dismissed);
        const dis = await panelWhere(h, `m.card === null && m.direction?.text === ${q(DIRECTION)}`);
        rec(
            "accept: Make it the direction calls `accept` and Dismiss calls `dismiss`, each with nothing else; the card is gone after each and the direction is the suggestion after the first",
            isCall(acceptCall, { id, action: "accept" }) &&
                acc.direction.text === SUGGESTION.text &&
                isCall(dismissCall, { id, action: "dismiss" }) &&
                dis.card === null,
            { accept: acceptCall, dismiss: dismissCall }
        );

        // kept: a refused command shows its error under the form and in the discussion's header
        const REFUSED = "no room for a forty-first entry";
        await swap(base());
        await panelWhere(h, `m.ids.length === ${ORDER.length}`);
        await stubRpc(h, [MEMORY_CMD], { [MEMORY_CMD]: { reject: REFUSED } });
        await click(h, "[data-council-memory-open-add]");
        await until(h, `!!document.querySelector("[data-council-memory-add]")`);
        await typeInto(h, "[data-council-memory-add-text]", "One more thing");
        await until(h, `document.querySelector('[data-council-memory-add] [data-council-memory-action="add"]')?.disabled === false`);
        const failedCall = await memCall(() => click(h, '[data-council-memory-add] [data-council-memory-action="add"]'));
        await until(h, `!!document.querySelector("[data-council-memory-error]")`);
        const failed = await readPanel(h);
        const header = await text(h, "[data-council-error]");
        rec(
            "error: when the command fails the panel says `Add to memory failed: <why>` under the form and the discussion's header says the same; the form stays open with its text",
            isCall(failedCall, { id, action: "add", kind: "agreed", text: "One more thing" }) &&
                failed.error === `Add to memory failed: ${REFUSED}` &&
                header === `Add to memory failed: ${REFUSED}` &&
                failed.add?.text === "One more thing",
            { call: failedCall, error: failed.error, header, add: failed.add }
        );
        await stubRpc(h, [MEMORY_CMD]);
        await click(h, '[data-council-memory-add] [data-council-memory-action="cancel"]');

        // kept: Chốt on a message, on an idea, and the key on the idea under the cursor
        const R20 = "Pin the cache first. Measure after.";
        const msgCall = await dirCall(() => click(h, '[data-council-reply-post="r20"] [data-council-chot="r20"]'));
        const ideaCall = await dirCall(() => click(h, '[data-council-idea="P2"] [data-council-chot="P2"]'));
        await click(h, `${RAIL} [data-council-rail-tab="ideas"]`);
        await until(h, `!!document.querySelector(${q(`${RAIL} [data-council-rail-idea="P4"]`)})`);
        await click(h, `${RAIL} [data-council-rail-idea="P4"]`);
        await until(h, `document.querySelector('[data-council-idea="P4"]')?.getAttribute("data-focused") === "true"`);
        await focusOn(h, CHANNEL);
        const keyCall = await dirCall(() => press(h, "p", "KeyP", 80));
        rec(
            "channel: Chốt in a seat's message calls `pin` with the message cut to one line and its id (r20), in an idea's action row with its title and id (P2), and the `p` key with the cursor on P4 does the same for P4",
            isCall(msgCall, { id, action: "pin", text: R20, from: "r20" }) &&
                isCall(ideaCall, { id, action: "pin", text: TITLES[1], from: "P2" }) &&
                isCall(keyCall, { id, action: "pin", text: TITLES[3], from: "P4" }),
            { message: msgCall, idea: ideaCall, key: keyCall }
        );

        return steps;
    },

    async teardown(h, ctx) {
        await h.ev(`(() => { try { localStorage.removeItem(${q(SEEN_KEY)}); } catch {} })()`);
        await teardownCouncilProject(h, ctx);
    },
};
