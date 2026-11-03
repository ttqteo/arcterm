// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0
//
// council-discussion (docs/superpowers/plans/2026-10-21-council.md, Task 14; the plain words and the picks:
// 2026-10-22-council-v1-ui.md, Task 3; Brainstorm and the queue: 2026-10-22-council-v1-room.md, Task 4; the live agents:
// 2026-10-29-council-live-agents.md, Task 8; the list of ideas: 2026-11-03-council-ux.md, Task 7): the Discussion as a
// list of ideas while the seats reply (the seat chips, a Chat row, a row per idea with its stance counts and reply count,
// a thread panel with its stance pills, the seat writing in it and a reply box, a composer, Summarize off while they do),
// the list of a done council (the Chat row's `N new`, New on the ideas since the last opening, a thread and the Chat opened
// by a click, Pin then Pinned), the Seats chip narrowing the rows to one seat, a council whose experts gave their picks,
// a Brainstorm, queued (a line that names the council it waits for), while they first propose (the experts' cards and the
// call bar), at the pause (the ticks, Ask the experts, Continue), stopped at the pause (Summarize), failed (Retry on an
// expert and on the coordinator), not run (Start council), a done council with a follow-up in a thread, its sources (a
// link per cited file in a thread, the Sources panel a click opens, back to the thread, a file not in the project), and
// the `room` fixtures: two live agents seated beside two experts (the seat chips with their context, a failed seat's
// Retry over the list, a Draft on a row whose reply waits for the person, held ideas with Send to the others, Edit and
// Drop in their thread, a thread with its stance pills and its held reply, j / k / Enter / Esc over the rows, the
// composer and its @, a click on an agent's chip), and the images and @files of the message boxes
// (2026-11-02-council-attachments.md, Task 4: paste, drop, remove, the draft kept, the three-group @ list, the locked Let
// them read files switch, the send's `attachments` and `tools`, and the sent message's thumbnail and file chip, in the
// Chat). Each phase seeds its own fixture council and takes its own shot.
//
// The hooks are called by councilscenarios.mjs as arrange(h, fx), assert(h, ctx, fx), teardown(h, ctx, fx). Nothing here
// spends a token or starts an agent: Summarize (on the stopped council), Continue, Retry, Start council, a draft's
// Send / Edit / Drop, the composer's posts and the follow-up's send are clicked with their RpcApi command replaced in the
// page (fixtures.mjs stubRpc) and the call read back with rpcCalls. The one real write is the round 2 reply: that council
// is `running` on disk with no run behind it, so wavesrv only stores the reply. The estimate is a real RPC, but it prices
// and calls no model. The room phases write the room's two agents as the cockpit fixture roster (writeRoomRoster, which
// reloads the page) and put the previous roster back in teardown.

import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { deflateSync } from "node:zlib";
import { waitFor } from "../attach.mjs";
import {
    ATTACHMENT_PLACEHOLDER,
    JOIN_AGENTS,
    arrangeCouncilProject,
    councilFixtureId,
    loadCouncilFixture,
    openCouncil,
    resolveStub,
    restoreRoomRoster,
    rpcCalls,
    seedCouncil,
    stubRpc,
    teardownCouncilProject,
    unstubRpc,
    writeRoomRoster,
} from "./fixtures.mjs";

const WAIT_MS = 8000;

const sel = (s) => JSON.stringify(s);
const NORM = `.replace(/\\s+/g, " ").trim()`;

const until = (h, expr, ms = WAIT_MS) => waitFor((e) => h.ev(e), expr, ms);
const exists = (h, s) => h.ev(`!!document.querySelector(${sel(s)})`);
const count = (h, s) => h.ev(`document.querySelectorAll(${sel(s)}).length`);
const text = (h, s) => h.ev(`(document.querySelector(${sel(s)})?.textContent ?? "")${NORM}`);
const attr = (h, s, name) => h.ev(`document.querySelector(${sel(s)})?.getAttribute(${sel(name)}) ?? null`);
const click = (h, s) =>
    h.ev(`(() => { const e = document.querySelector(${sel(s)}); if (!e) return false; e.click(); return true; })()`);
// a React-controlled field takes the native setter and an input event
const typeInto = (h, s, value) =>
    h.ev(`(() => {
        const el = document.querySelector(${sel(s)});
        if (!el) return false;
        const set = Object.getOwnPropertyDescriptor(Object.getPrototypeOf(el), "value").set;
        set.call(el, ${sel(value)});
        el.dispatchEvent(new Event("input", { bubbles: true }));
        return true;
    })()`);
// a click does not move focus, and the chat's keys are live only with focus inside its channel or thread
const focusOn = (h, s) =>
    h.ev(`(() => { const e = document.querySelector(${sel(s)}); if (!e) return false; e.focus(); return document.activeElement === e; })()`);
// a real key event to where focus is (the dispatcher listens on the window, in capture)
const press = async (h, key, code, keyCode) => {
    for (const type of ["keyDown", "keyUp"]) {
        await h.cdp("Input.dispatchKeyEvent", { type, key, code, windowsVirtualKeyCode: keyCode });
    }
    await new Promise((r) => setTimeout(r, 200));
};
const pressJ = (h) => press(h, "j", "KeyJ", 74);
const pressK = (h) => press(h, "k", "KeyK", 75);
const pressEnter = (h) => press(h, "Enter", "Enter", 13);
// Enter with the character a real key sends: the row the cursor is on holds the focus, and a focused button owns Enter
const pressEnterOnRow = async (h) => {
    await h.cdp("Input.dispatchKeyEvent", { type: "keyDown", key: "Enter", code: "Enter", windowsVirtualKeyCode: 13, text: "\r" });
    await h.cdp("Input.dispatchKeyEvent", { type: "keyUp", key: "Enter", code: "Enter", windowsVirtualKeyCode: 13 });
    await new Promise((r) => setTimeout(r, 200));
};
const pressEscape = (h) => press(h, "Escape", "Escape", 27);

// waits until the element's text equals `want` (a string) or matches it (a RegExp), and answers the text it ended on
async function settledText(h, s, want) {
    const test = want instanceof RegExp ? `${want}.test(t)` : `t === ${sel(want)}`;
    await until(h, `(() => { const t = (document.querySelector(${sel(s)})?.textContent ?? "")${NORM}; return ${test}; })()`);
    return text(h, s);
}

const rootOf = (id) => `[data-council-discussion="${id}"]`;
const shortened = (x) => (typeof x === "string" ? x : JSON.stringify(x));

// seeds a fixture council, opens its Discussion and waits for that council's own root: the root of the one shown before
// is there at once, and carries another id
async function openFixture(h, ctx, name, opts) {
    const id = await seedCouncil(h, ctx, name, opts);
    await openCouncil(h, id, "discussion");
    if (!(await until(h, `!!document.querySelector(${sel(rootOf(id))})`))) {
        throw new Error(`the Discussion of ${id} did not load within ${WAIT_MS / 1000}s`);
    }
    return id;
}

const tokensIn = (label) => {
    const m = /~([\d.]+)([kM])/.exec(label ?? "");
    return m ? Number(m[1]) * (m[2] === "M" ? 1_000_000 : 1000) : NaN;
};

// the replies a person reads as replies on each idea of a fixture: an agreement with nothing to add is a reaction, not one
function readableCounts(name) {
    const fx = loadCouncilFixture(name);
    const out = {};
    for (const r of fx.replies ?? []) {
        if (r.draft || (r.author !== "you" && r.stance === "accept" && (r.text ?? "").trim() === "")) continue;
        if (r.proposalid) out[r.proposalid] = (out[r.proposalid] ?? 0) + 1;
    }
    return out;
}

// each seat's latest stance on each sent idea of a fixture, counted as the list's rows count them: Agrees, Has doubts,
// Is against it (the author's own replies, the person's and a held one take none)
function stanceCounts(fx) {
    const latest = {};
    const author = Object.fromEntries((fx.proposals ?? []).map((p) => [p.id, p.author]));
    for (const r of [...(fx.replies ?? [])].sort((a, b) => a.ts - b.ts)) {
        if (r.draft || r.author === "you" || r.author === author[r.proposalid]) continue;
        if (!["accept", "challenge", "oppose"].includes(r.stance)) continue;
        (latest[r.proposalid] ??= {})[r.author] = r.stance;
    }
    const out = {};
    for (const [id, by] of Object.entries(latest)) {
        const s = Object.values(by);
        out[id] = {
            agrees: s.filter((x) => x === "accept").length,
            doubts: s.filter((x) => x === "challenge").length,
            against: s.filter((x) => x === "oppose").length,
        };
    }
    return out;
}

// ---- the list's parts, as they are drawn: its hooks, never its words ----

const LIST = "[data-council-list]";
const CHAT_ROW = `${LIST} [data-council-row="chat"]`;

// the old channel's parts: none is drawn any more
const oldParts = (h) =>
    count(h, `${LIST} [data-council-item], [data-council-divider], [data-council-skip], ${LIST} [data-council-typing], [data-council-jump]`);

const ideaIds = (h) =>
    h.ev(`[...document.querySelectorAll(${sel(`${LIST} [data-council-idea]`)})].map((e) => e.getAttribute("data-council-idea"))`);

// one idea row as drawn: its number, title, New, Draft, the three stance counts and its replies
const rowOf = (h, id) =>
    h.ev(`(() => {
        const r = document.querySelector(${sel(`${LIST} [data-council-idea="${id}"]`)});
        if (!r) return null;
        const n = (k) => Number(r.querySelector('[data-council-stance="' + k + '"]')?.getAttribute("data-count") ?? NaN);
        return {
            n: Number((r.firstElementChild?.textContent ?? "").trim()),
            title: (r.querySelector("[data-council-row-title]")?.textContent ?? "")${NORM},
            isNew: !!r.querySelector("[data-council-row-new]"),
            draft: !!r.querySelector("[data-council-row-draft]"),
            agrees: n("agrees"),
            doubts: n("doubts"),
            against: n("against"),
            replies: Number(r.getAttribute("data-replies")),
            repliesText: (r.querySelector("[data-council-row-replies]")?.textContent ?? "")${NORM},
            height: Math.round(r.getBoundingClientRect().height),
        };
    })()`);

const chatRowOf = (h) =>
    h.ev(`(() => {
        const r = document.querySelector(${sel(CHAT_ROW)});
        return r && {
            fresh: (r.querySelector("[data-council-chat-new]")?.textContent ?? "")${NORM},
            latest: (r.querySelector("[data-council-chat-latest]")?.textContent ?? "")${NORM},
            count: (r.querySelector("[data-council-chat-count]")?.textContent ?? "")${NORM},
            draft: !!r.querySelector("[data-council-row-draft]"),
            first: r === document.querySelector(${sel(`${LIST} [data-council-row]`)}),
        };
    })()`);

// the replies of the open thread: id, the stance pill's word, whether it is the person's, its text
const threadReplies = (h) =>
    h.ev(`[...document.querySelectorAll("[data-council-thread] [data-council-reply-post]")].map((m) => ({
        id: m.getAttribute("data-council-reply-post"),
        label: m.getAttribute("data-item-label"),
        mine: m.getAttribute("data-item-mine") === "true",
        text: (m.textContent ?? "")${NORM},
    }))`);

// the seats are a stack of avatars in the Discussion's header (one row with the tabs, the title and the cost); a click or
// a hover on it opens the list of every seat, each row a filter, in a popover outside the header
const SEATS = "[data-council-discussion] header [data-council-seats]";
const SEAT_LIST = "[data-council-seat-list]";

// open (true) or close (false) the seat list by a click on the stack, which toggles it; true once it is as asked
async function setSeats(h, want) {
    await until(h, `!!document.querySelector(${sel(SEATS)})`);
    await h.ev(`(() => {
        const b = document.querySelector(${sel(SEATS)});
        if (b && (b.getAttribute("aria-expanded") === "true") !== ${want}) b.click();
    })()`);
    return until(h, want ? `!!document.querySelector(${sel(SEAT_LIST)})` : `!document.querySelector(${sel(SEAT_LIST)})`);
}

const readSeatChips = (h) =>
    h.ev(`[...document.querySelectorAll(${sel(`${SEAT_LIST} [data-council-expert-chip]`)})].map((c) => ({
        id: c.getAttribute("data-council-expert-chip"),
        lit: c.getAttribute("data-lit") === "true",
        dot: c.getAttribute("data-dot"),
        text: (c.textContent ?? "")${NORM},
        doing: (c.querySelector("[data-council-seat-doing]")?.textContent ?? "")${NORM},
        title: c.getAttribute("title"),
        open: c.querySelector("[data-council-chip-open]")?.getAttribute("data-council-chip-open") ?? null,
    }))`);

// every seat's row, read from the opened list, which is closed again after
async function seatChips(h) {
    await setSeats(h, true);
    const chips = await readSeatChips(h);
    await setSeats(h, false);
    return chips;
}

const focusedIdea = (h) => h.ev(`document.querySelector('[data-council-row][data-focused="true"]')?.getAttribute("data-council-row") ?? null`);

const CHANNEL_COMPOSER = '[data-council-composer="channel"]';
const THREAD_COMPOSER = '[data-council-composer="thread"]';

// ---- the experts reply: the channel ----

const REPLY_TEXT = 'Would a "Waking…" label on the rail icon be enough?';

async function round2(h, ctx, rec) {
    const id = await openFixture(h, ctx, "round2");

    const chip = await settledText(h, "[data-council-chip]", "Round 2 of 2");
    rec("round 2: the header chip reads `Round 2 of 2`", chip === "Round 2 of 2", chip);

    await until(h, `!!document.querySelector("[data-council-channel]")`);
    const mode = await text(h, "[data-council-mode]");
    rec("round 2: the mode chip reads `Review`", mode === "Review", mode);

    const chips = await seatChips(h);
    const skeptic = chips.find((c) => c.id === "skeptic");
    rec(
        "round 2: five seat filters replace the header's avatars, two lit, Skeptic's line reads `Replying to UX`, each an `expert · …` on hover",
        chips.length === 5 &&
            chips.filter((c) => c.lit).length === 2 &&
            skeptic?.doing === "Replying to UX" &&
            chips.filter((c) => c.id !== "coordinator").every((c) => /expert · \w+/.test(c.title ?? "")) &&
            (await count(h, "[data-council-avatar]")) === 0,
        chips.map((c) => `${c.id}: ${c.doing}`).join(" ; ")
    );

    const cost = await text(h, "[data-council-cost]");
    rec("round 2: the cost line reads `m:ss · N replies · X.XXM tokens`", /\d+:\d\d · \d+ replies · [\d.]+M tokens/.test(cost), cost);

    // the list: the Chat row on top (every reply of this fixture is on an idea, so it has none), then every idea, the
    // withdrawn P6 too, a 40px row each in the order they arrived, with its reply count and its stance counts; no bubble,
    // round divider, typing row or skipped line, and no proposal id in the text
    const counts = readableCounts("round2");
    const stances = stanceCounts(loadCouncilFixture("round2"));
    const chatRow = await chatRowOf(h);
    const ideas = await ideaIds(h);
    const rows = {};
    for (const p of ideas) rows[p] = await rowOf(h, p);
    const heading = await text(h, `${LIST} [data-council-list-count]`);
    const old = await oldParts(h);
    rec(
        "round 2: the list opens with the Chat row (`No messages yet`), then `6 ideas` and a 40px row per idea in arrival order, each counting the replies a person reads and the seats' latest Agrees / Has doubts / Is against it, with no bubble, divider or typing row and no proposal id in the text",
        chatRow?.first === true &&
            chatRow.count === "No messages yet" &&
            heading === "6 ideas" &&
            ideas.join(",") === "P1,P2,P4,P3,P5,P6" &&
            ideas.every(
                (p, i) =>
                    rows[p]?.n === i + 1 &&
                    Math.abs(rows[p].height - 40) <= 1 &&
                    rows[p].replies === (counts[p] ?? 0) &&
                    rows[p].agrees === (stances[p]?.agrees ?? 0) &&
                    rows[p].doubts === (stances[p]?.doubts ?? 0) &&
                    rows[p].against === (stances[p]?.against ?? 0)
            ) &&
            old === 0 &&
            !/\bP\d+\b/.test(await text(h, LIST)),
        { chatRow, ideas, rows, counts, stances, heading, old }
    );

    // a click on the row of P2 opens its thread: the idea on top, its replies with their stance pills
    await click(h, `${LIST} [data-council-idea="P2"]`);
    const opened = await until(h, `!!document.querySelector('[data-council-thread="P2"] [data-council-post="P2"]')`);
    const openAtom = await h.ev(`window.__arcCouncil.openProposal(${sel(id)})`);
    const highlighted = (await attr(h, '[data-council-idea="P2"]', "data-open")) === "true";
    const replies = await threadReplies(h);
    const labels = replies.map((r) => r.label);
    rec(
        "round 2: a click on P2's row opens its thread with the row marked open, a `has doubts` and an `is against it` reply among its five, and Skeptic typing in it",
        opened &&
            openAtom === "P2" &&
            highlighted &&
            replies.length === counts.P2 &&
            labels.includes("has doubts") &&
            labels.includes("is against it") &&
            replies.some((r) => r.mine) &&
            (await text(h, "[data-council-thread] [data-council-typing]")) === "Skeptic is writing…",
        { openAtom, highlighted, labels }
    );

    // the reply box names who answers: P2's author
    await typeInto(h, `${THREAD_COMPOSER} [data-council-composer-input]`, REPLY_TEXT);
    const hint = await settledText(h, `${THREAD_COMPOSER} [data-council-composer-hint]`, /Answered by/);
    rec("round 2: the thread's reply box names who answers", hint === "Answered by: UX", hint);
    await until(h, `!document.querySelector(${sel(`${THREAD_COMPOSER} [data-council-composer-send]`)})?.disabled`);
    await h.shot("cdp-shots/council-discussion-round2.png");

    // a real reply: the council is running on disk with nothing behind it, so wavesrv stores it and calls no model
    await click(h, `${THREAD_COMPOSER} [data-council-composer-send]`);
    const posted = await until(
        h,
        `[...document.querySelectorAll('[data-council-thread] [data-item-mine="true"]')].some((n) => n.textContent.includes(${sel(REPLY_TEXT)}))`,
        15_000
    );
    const placed = (await threadReplies(h)).find((m) => m.mine && m.text.includes(REPLY_TEXT));
    const cleared = (await h.ev(`document.querySelector(${sel(`${THREAD_COMPOSER} [data-council-composer-input]`)})?.value ?? null`)) === "";
    rec(
        "round 2: sending posts it for real, as a message of the person's in P2's thread that `replies`, and the box empties",
        posted && cleared && placed?.label === "replies",
        placed
    );

    // Summarize: the runner refuses a running council (the synthesis comes by itself when the replies end), so it is off
    const summarize = await h.ev(`(() => {
        const b = document.querySelector("[data-council-summarize]");
        return b ? { disabled: b.disabled === true, title: b.getAttribute("title") } : null;
    })()`);
    rec(
        "round 2: Summarize is disabled, and its title says the summary comes by itself when the experts finish replying",
        summarize?.disabled === true && summarize.title === "The summary comes by itself when the experts finish replying",
        summarize
    );
}

// ---- the header: one 52px row ----

// the header's first row, measured: its height, what it holds, and whether the title truncates and the strip scrolls
const headerRow = (h) =>
    h.ev(`(() => {
        const root = document.querySelector("[data-council-discussion]");
        const head = root?.querySelector("header");
        const row = head?.firstElementChild;
        if (!root || !head || !row) return null;
        const rootBox = root.getBoundingClientRect();
        const within = (s) => {
            const e = head.querySelector(s);
            if (!e) return null;
            const b = e.getBoundingClientRect();
            return b.width > 0 && b.left >= rootBox.left - 1 && b.right <= rootBox.right + 1;
        };
        const title = head.querySelector("[data-council-title]");
        const stack = [...head.querySelectorAll("[data-council-seat-avatar]")];
        const last = [...row.querySelectorAll(":scope > div:last-child > *")].pop();
        const lastBox = last?.getBoundingClientRect();
        return {
            height: row.getBoundingClientRect().height,
            tab: !!head.querySelector("[data-council-tab='discussion'][aria-selected='true']"),
            title: !!title,
            truncated: !!title && title.scrollWidth > title.clientWidth,
            titleW: title ? Math.round(title.clientWidth) : 0,
            seats: stack.length,
            seatsShown: stack.filter((e) => e.getBoundingClientRect().width > 0).length,
            seatsIn: within("[data-council-seats]"),
            cost: !!head.querySelector("[data-council-cost]"),
            costIn: within("[data-council-cost]"),
            lastIn: !!lastBox && lastBox.left >= rootBox.left - 1 && lastBox.right <= rootBox.right + 1,
            rootW: Math.round(rootBox.width),
            parts: [...row.querySelectorAll(":scope > *, :scope > div:last-child > *")].map((e) => Math.round(e.getBoundingClientRect().width)),
            oldRow: !!document.querySelector("[data-council-experts]"),
        };
    })()`);

async function header(h, ctx, rec) {
    // a feature longer than the title's floor, so the narrow pane has something to truncate (the fixture's own is 9 letters)
    await openFixture(h, ctx, "round2", {
        id: `${councilFixtureId("round2")}-header`,
        edit: (c) => {
            c.feature = "Which changes to the pinned apps on the nav rail are worth making first, and in what order";
        },
    });
    await until(h, `!!document.querySelector("[data-council-channel]")`);
    const wide = await headerRow(h);
    rec(
        "header: the header is one 52px row holding the tabs, the title, the seats' stack (an avatar for each of the five) and the cost",
        wide != null &&
            Math.abs(wide.height - 52) <= 1 &&
            wide.tab &&
            wide.title &&
            wide.seats === 5 &&
            wide.seatsShown === 5 &&
            wide.cost &&
            !wide.oldRow,
        wide
    );
    await h.shot("cdp-shots/council-discussion-header.png");

    // a narrow window: the row stays 52px, the title truncates and the strip scrolls; the cost and the last control stay in
    // the pane (the council runs, so the last one is Stop). verify.mjs re-pins 1600x950 only between scenarios, so the
    // viewport is put back to that size here, not cleared
    try {
        await h.cdp("Emulation.setDeviceMetricsOverride", { width: 1000, height: 950, deviceScaleFactor: 1, mobile: false });
        await new Promise((r) => setTimeout(r, 400));
        const narrow = await headerRow(h);
        rec(
            "header: at a 1000px window the row is still 52px, the title truncates and keeps at least 60px, the seats' stack stays whole in the pane (no seat cut in half), and the cost and the last control stay in the pane",
            narrow != null &&
                Math.abs(narrow.height - 52) <= 1 &&
                narrow.truncated &&
                narrow.titleW >= 60 &&
                narrow.seatsIn === true &&
                narrow.seatsShown >= 3 &&
                narrow.costIn === true &&
                narrow.lastIn,
            narrow
        );
        await h.shot("cdp-shots/council-discussion-header-narrow.png");
    } finally {
        await h.cdp("Emulation.setDeviceMetricsOverride", { width: 1600, height: 950, deviceScaleFactor: 1, mobile: false });
        await new Promise((r) => setTimeout(r, 400));
    }
}

// ---- the seat filter: a chip in the header, the line and the rows in the list ----

// the ideas of a fixture a seat wrote or replied to (a held reply too), in the order they arrived
function ideasOfSeat(fx, seat) {
    return [...(fx.proposals ?? [])]
        .filter((p) => !p.draft || p.draft === "held")
        .sort((a, b) => a.ts - b.ts)
        .filter(
            (p) =>
                p.author === seat ||
                (fx.replies ?? []).some((r) => r.proposalid === p.id && r.author === seat && r.draft !== "dropped")
        )
        .map((p) => p.id);
}

async function seatFilter(h, ctx, rec) {
    await openFixture(h, ctx, "round2", { id: `${councilFixtureId("round2")}-filter` });
    await until(h, `!!document.querySelector("[data-council-channel]")`);
    // a hover on the stack opens the list, with no click; the pointer moving far off closes it again
    const box = await h.ev(`(() => {
        const r = document.querySelector(${sel(SEATS)})?.getBoundingClientRect();
        return r && r.width > 0 ? { x: Math.round(r.x + r.width / 2), y: Math.round(r.y + r.height / 2) } : null;
    })()`);
    let hovered = false;
    let left = false;
    if (box) {
        await h.cdp("Input.dispatchMouseEvent", { type: "mouseMoved", x: box.x, y: box.y });
        hovered = await until(h, `!!document.querySelector(${sel(SEAT_LIST)})`);
        await h.cdp("Input.dispatchMouseEvent", { type: "mouseMoved", x: box.x, y: box.y + 400 });
        left = await until(h, `!document.querySelector(${sel(SEAT_LIST)})`);
    }
    rec("seat filter: a hover on the seats' stack opens the list of every seat, and the pointer leaving closes it", hovered && left, { box, hovered, left });

    const listed = await setSeats(h, true);
    const chip = `${SEAT_LIST} [data-council-filter='newuser']`;
    const before = await attr(h, chip, "aria-pressed");
    await click(h, chip);
    const shown = await until(h, `!!document.querySelector("[data-council-only='newuser']")`);
    const line = await text(h, "[data-council-only]");
    const pressed = await attr(h, chip, "aria-pressed");
    const stackOnly = await attr(h, SEATS, "data-only");
    // the rows narrow to the ideas New user wrote or replied to, and the header counts them
    const want = ideasOfSeat(loadCouncilFixture("round2"), "newuser");
    const narrowed = await until(h, `[...document.querySelectorAll(${sel(`${LIST} [data-council-idea]`)})].length === ${want.length}`);
    const onlyRows = await ideaIds(h);
    const onlyHeading = await text(h, `${LIST} [data-council-list-count]`);
    await h.shot("cdp-shots/council-discussion-seats.png");
    rec(
        "seat filter: with New user picked the list shows only the ideas New user wrote or replied to, and the header counts them",
        narrowed && want.length > 0 && want.length < 6 && onlyRows.join(",") === want.join(",") && onlyHeading === `${want.length} ideas`,
        { want, onlyRows, onlyHeading }
    );
    // the chip's count is the line's ideas and replies added
    const counted = Number(await h.ev(`/, (\\d+) messages/.exec(document.querySelector(${sel(chip)})?.getAttribute("aria-label") ?? "")?.[1] ?? NaN`));
    const nums = (/^Only .+: (\d+) ideas? and (\d+) repl(?:y|ies)$/.exec(line) ?? []).slice(1).map(Number);
    rec(
        "seat filter: a click on a seat's row in the list presses it, marks the stack with that seat and shows the `Only …` line for it, its ideas and replies adding up to the row's count",
        listed &&
            before === "false" &&
            shown &&
            pressed === "true" &&
            stackOnly === "newuser" &&
            nums.length === 2 &&
            nums[0] + nums[1] === counted,
        { listed, before, shown, line, pressed, stackOnly, counted }
    );
    await click(h, "[data-council-action='show-everyone']");
    const gone = await until(h, `!document.querySelector("[data-council-only]")`);
    const after = await attr(h, chip, "aria-pressed");
    const stackAfter = await attr(h, SEATS, "data-only");
    await setSeats(h, false);
    rec(
        "seat filter: Show everyone releases it, the line goes, the row is not pressed and the stack names no seat",
        gone && after === "false" && stackAfter === null && (await ideaIds(h)).length === 6,
        { gone, after, stackAfter }
    );
}

// ---- the experts' picks: the chip, the reaction ----

// round 2's fixture under another id, with picks (RAM and Skeptic pick P2, New user picks P1; P3 to P6 are unpicked) and
// New user's accept on P2 stripped of its text: agreement with nothing to add
async function picks(h, ctx, rec) {
    await openFixture(h, ctx, "round2", {
        id: `${councilFixtureId("round2")}-picks`,
        edit: (c) => {
            c.picks = { ram: ["P2"], skeptic: ["P2"], newuser: ["P1"] };
            const accept = c.replies.find((r) => r.id === "r17");
            accept.text = "";
        },
    });
    await until(h, `!!document.querySelector(${sel(`${LIST} [data-council-idea="P2"]`)})`);

    // the picks are said in an idea's thread: P2's reads `Picked by 2`, P1's `Picked by 1`, P3's none
    const picksIn = async (p) => {
        await click(h, `${LIST} [data-council-idea="${p}"]`);
        await until(h, `!!document.querySelector(${sel(`[data-council-thread="${p}"] [data-council-post="${p}"]`)})`);
        return h.ev(`(() => {
            const e = document.querySelector("[data-council-thread] [data-council-picks]");
            return e && { text: (e.textContent ?? "")${NORM}, title: e.getAttribute("title") };
        })()`);
    };
    const p1 = await picksIn("P1");
    const p3 = await picksIn("P3");
    const p2 = await picksIn("P2");
    rec(
        "picks: P2's thread carries `Picked by 2` (title `Picked by 2 of 4 experts`), P1's `Picked by 1` and P3's none, and no proposal id shows in the list",
        p2?.text === "Picked by 2" &&
            p2.title === "Picked by 2 of 4 experts" &&
            p1?.text === "Picked by 1" &&
            p3 === null &&
            !/\bP\d+\b/.test(await text(h, LIST)),
        { p1, p2, p3 }
    );

    // P2's thread is open
    const reaction = await h.ev(`[...document.querySelectorAll("[data-council-thread] [data-council-reaction]")].map((e) => (e.textContent ?? "")${NORM})`);
    const counts = readableCounts("round2");
    const rowP2 = await attr(h, `${LIST} [data-council-idea="P2"]`, "data-replies");
    const hidden = !(await exists(h, '[data-council-reply-post="r17"]'));
    rec(
        "picks: New user's blank accept is a `New user agrees` reaction under P2 in its thread, with no reply of its own there and none in its row's count",
        reaction.length === 1 && reaction[0] === "New user agrees" && hidden && Number(rowP2) === counts.P2 - 1,
        { reaction, hidden, rowP2, expected: counts.P2 - 1 }
    );
    await h.shot("cdp-shots/council-discussion-picks.png");
}

// ---- Brainstorm: its labels ----

// round 2's fixture as a Brainstorm: the first idea is a wild one, and the first reply that does not agree builds on its idea
async function brainstorm(h, ctx, rec) {
    await openFixture(h, ctx, "round2", {
        id: `${councilFixtureId("round2")}-brainstorm`,
        edit: (c) => {
            c.mode = "brainstorm";
            c.proposals[0].wild = true;
            c.replies.find((r) => r.stance !== "accept").builds = true;
        },
    });
    await until(h, `document.querySelector("[data-council-mode]")?.textContent === "Brainstorm"`);

    const mode = await text(h, "[data-council-mode]");
    rec("brainstorm: the mode chip reads `Brainstorm`", mode === "Brainstorm", mode);

    const labels = await h.ev(`[...document.querySelectorAll("[data-council-idea]")].map((e) => e.getAttribute("data-item-label"))`);
    rec(
        "brainstorm: the ideas read `wild idea` (the first) and `idea`, never `proposes`",
        labels[0] === "wild idea" && labels.slice(1).every((l) => l === "idea") && !labels.includes("proposes"),
        labels
    );

    // the reply that builds is r4, on P6
    await click(h, '[data-council-thread-open="P6"]');
    await until(h, `!!document.querySelector('[data-council-thread="P6"]')`);
    const replies = await threadReplies(h);
    rec(
        "brainstorm: a reply that builds on its idea is labelled `builds on it`",
        replies.some((r) => r.label === "builds on it"),
        replies.map((r) => r.label)
    );
    await h.shot("cdp-shots/council-discussion-brainstorm.png");
}

// ---- queued: one line ----

async function queued(h, ctx, rec) {
    await openFixture(h, ctx, "round1", {
        id: `${councilFixtureId("round1")}-queued`,
        edit: (c) => {
            c.state = "queued";
            c.round = 0;
        },
    });
    const chip = await settledText(h, "[data-council-chip]", "Queued");
    const line = await text(h, "[data-council-queued-line]");
    const body = await h.ev(`({
        cards: document.querySelectorAll("[data-council-expert-card]").length,
        channel: document.querySelectorAll("[data-council-channel], [data-council-item]").length,
        bar: document.querySelectorAll("[data-council-calls]").length,
        stop: document.querySelectorAll("[data-council-stop]").length,
        mode: (document.querySelector("[data-council-mode]")?.textContent ?? "")${NORM},
    })`);
    rec(
        "queued: the chip reads `Queued` and the body is the one line `Queued`, with no cards, channel or stop",
        chip === "Queued" && line === "Queued" && body.cards === 0 && body.channel === 0 && body.bar === 0 && body.stop === 0 && body.mode === "Review",
        { chip, line, body }
    );
    await h.shot("cdp-shots/council-discussion-queued.png");

    // behind the room: the line names the council that runs, and the agent it waits for
    const room = await seedCouncil(h, ctx, "room");
    const behind = await seedCouncil(h, ctx, "round1", {
        id: `${councilFixtureId("round1")}-queued-behind`,
        edit: (c) => {
            c.state = "queued";
            c.round = 0;
            c.queuedafter = room;
        },
    });
    await openCouncil(h, behind, "discussion");
    await until(h, `!!document.querySelector(${sel(rootOf(behind))})`);
    const named = await settledText(h, "[data-council-queued-line]", /waiting for/);
    rec(
        "queued: behind a room the line reads `Queued · after Rail apps · waiting for Witness synthesis`",
        named === "Queued · after Rail apps · waiting for Witness synthesis",
        named
    );
}

// ---- round 1: the experts' cards ----

async function round1(h, ctx, rec) {
    await openFixture(h, ctx, "round1");
    const chip = await settledText(h, "[data-council-chip]", /^Round 1 of 2/);
    rec("round 1: the header chip reads `Round 1 of 2`", chip === "Round 1 of 2", chip);

    const cards = await h.ev(`[...document.querySelectorAll("[data-council-expert-card]")].map((c) => ({
        id: c.getAttribute("data-council-expert-card"),
        dot: c.querySelector("[data-dot]")?.getAttribute("data-dot") ?? null,
        state: (c.querySelector("[data-council-expert-state]")?.textContent ?? "").trim(),
        stat: (c.querySelector("[data-council-expert-stat]")?.textContent ?? "").trim(),
    }))`);
    const working = cards.filter((c) => c.dot === "working");
    rec(
        "round 1: four expert cards, two with a reading line (RAM greps IdleSleep), each with its time and tokens",
        cards.length === 4 &&
            working.length === 2 &&
            cards.find((c) => c.id === "ram")?.state === 'Grep "IdleSleep" in pkg/services' &&
            cards.every((c) => /\d+ min \d+ s · \d+k tokens/.test(c.stat)),
        cards.map((c) => `${c.id}: ${c.state} | ${c.stat}`).join(" ; ")
    );

    const bar = await h.ev(`({
        all: document.querySelectorAll("[data-council-calls] [data-segment]").length,
        done: document.querySelectorAll('[data-council-calls] [data-segment="done"]').length,
        label: document.querySelector("[data-council-calls]")?.getAttribute("aria-label") ?? null,
    })`);
    rec("round 1: the call bar has 9 segments, 2 done", bar.all === 9 && bar.done === 2, bar);

    const arrived = await h.ev(`[...document.querySelectorAll("[data-council-arrived]")].map((e) => e.getAttribute("data-council-arrived"))`);
    const summarizeOff = await h.ev(`document.querySelector("[data-council-summarize]")?.disabled === true`);
    const arrivedText = await h.ev(`[...document.querySelectorAll("[data-council-arrived]")].map((e) => (e.textContent ?? "")).join(" ")`);
    const heading = await h.ev(`document.body.textContent.includes("Ideas so far")`);
    rec(
        "round 1: `Ideas so far` lists three ideas (ids in the hooks, none in the text), Summarize is disabled and no channel shows yet",
        arrived.join(",") === "P1,P2,P4" &&
            summarizeOff &&
            heading &&
            !/\bP\d+\b/.test(arrivedText) &&
            !(await exists(h, "[data-council-channel]")),
        `${arrived.join(",")} | summarize disabled: ${summarizeOff} | ${arrivedText}`
    );
    await h.shot("cdp-shots/council-discussion-round1.png");

    // no idea yet: the empty state
    await openFixture(h, ctx, "round1", {
        id: `${councilFixtureId("round1")}-empty`,
        edit: (c) => void (c.proposals = []),
    });
    const empty = await settledText(h, "[data-council-discussion] [data-council-expert-card] ~ div", /No ideas yet\./).catch(() => "");
    const body = await text(h, "[data-council-discussion]");
    rec("round 1: with no idea yet the body reads `No ideas yet.`", body.includes("No ideas yet."), empty);
}

// ---- the pause ----

const PAUSE_QUESTION = "Does any of this change on a Mac, where the app frame cannot reload in place yet?";

async function awaiting(h, ctx, rec) {
    const id = await openFixture(h, ctx, "awaiting");
    const chip = await settledText(h, "[data-council-chip]", "Waiting on you");
    const rows = await h.ev(`[...document.querySelectorAll("[data-council-pause-row]")].map((r) => ({
        id: r.getAttribute("data-council-pause-row"),
        kept: r.getAttribute("data-kept") === "true",
        tick: !!r.querySelector('input[type="checkbox"]')?.checked,
    }))`);
    rec(
        "paused: the chip reads `Waiting on you`, with six ideas all ticked",
        chip === "Waiting on you" && rows.length === 6 && rows.every((r) => r.kept && r.tick),
        `${chip} | ${rows.map((r) => r.id).join(",")}`
    );

    const pauseText = await text(h, "[data-council-pause]");
    const continueText = await text(h, "[data-council-continue]");
    rec(
        "paused: the panel reads `Ideas so far` and `Continue: let them argue`, with no proposal id, and no channel",
        pauseText.includes("Ideas so far") &&
            continueText === "Continue: let them argue" &&
            !/\bP\d+\b/.test(pauseText) &&
            !(await exists(h, "[data-council-channel]")),
        continueText
    );

    await click(h, '[data-council-pause-row="P6"] input');
    await until(h, `document.querySelector('[data-council-pause-row="P6"]')?.getAttribute("data-kept") === "false"`);
    const struck = await h.ev(
        `getComputedStyle(document.querySelector('[data-council-pause-row="P6"] [data-council-pause-title]')).textDecorationLine`
    );
    rec("paused: unticking P6 strikes it", struck === "line-through", struck);

    await typeInto(h, "[data-council-pause-ask]", PAUSE_QUESTION);
    const asked = await h.ev(`document.querySelector("[data-council-pause-ask]")?.value ?? null`);
    const remaining = await settledText(h, "[data-council-remaining]", /^The rest:/);
    const stopHere = await text(h, "[data-council-stop-here]");
    rec(
        "paused: the question box takes a question, the line reads `The rest: ≈ 5 calls · ~0.3M tokens`, Stop here is offered",
        asked === PAUSE_QUESTION && remaining === "The rest: ≈ 5 calls · ~0.3M tokens" && stopHere === "Stop here and keep these ideas",
        `${remaining} | ${stopHere}`
    );
    await h.shot("cdp-shots/council-discussion-paused.png");

    await stubRpc(h, ["CouncilContinueCommand"]);
    await click(h, "[data-council-continue]");
    await until(h, `(window.__arcCouncilStub?.calls ?? []).some((c) => c.name === "CouncilContinueCommand")`);
    const calls = await rpcCalls(h, "CouncilContinueCommand");
    const data = calls[0]?.data;
    rec(
        "paused: Continue: let them argue (stubbed) records CouncilContinueCommand with cut [P6] and the question",
        calls.length === 1 && data?.id === id && JSON.stringify(data?.cut) === '["P6"]' && data?.question === PAUSE_QUESTION,
        calls
    );
}

// ---- stopped at the pause ----

// "Stop here and keep these ideas" leaves the paused council stopped with no summary: the runner summarizes it, so
// Summarize is its next step. It is the paused fixture with its state changed, under its own id.
async function stopped(h, ctx, rec) {
    const id = await openFixture(h, ctx, "awaiting", {
        id: `${councilFixtureId("awaiting")}-stopped`,
        edit: (c) => void (c.state = "stopped"),
    });
    const chip = await settledText(h, "[data-council-chip]", "Stopped");
    const label = await text(h, "[data-council-summarize]");
    const on = await h.ev(`document.querySelector("[data-council-summarize]")?.disabled === false`);
    rec(
        "stopped at the pause: the chip reads `Stopped` and Summarize is enabled",
        chip === "Stopped" && label === "Summarize" && on,
        `${chip} | ${label} | enabled: ${on}`
    );

    // no summary yet, so it asks for one (stubbed) and opens the Summary
    await stubRpc(h, ["CouncilSummarizeCommand"]);
    await click(h, "[data-council-summarize]");
    const opened = await until(h, `!!document.querySelector("[data-council-summary]")`);
    const calls = await rpcCalls(h, "CouncilSummarizeCommand");
    rec(
        "stopped at the pause: Summarize (stubbed) records one CouncilSummarizeCommand and opens the Summary",
        calls.length === 1 && calls[0].data?.id === id && opened,
        { calls, opened }
    );
}

// ---- failed ----

async function failed(h, ctx, rec) {
    const id = await openFixture(h, ctx, "failed");
    await settledText(h, "[data-council-chip]", "Failed");

    const skeptic = await text(h, '[data-council-failed="skeptic"]');
    const hasSkepticRetry = await exists(h, '[data-council-retry="skeptic"]');
    rec(
        "failed: Skeptic's failure line over the list reads `Skeptic failed while proposing`, shows its error and has Retry",
        skeptic.includes("Skeptic failed while proposing") && skeptic.includes("claude -p timed out after 10 minutes") && hasSkepticRetry,
        skeptic
    );

    const panel = await text(h, "[data-council-summary-failed]");
    const hasCoordinatorRetry = await exists(h, '[data-council-retry="coordinator"]');
    rec(
        "failed: the coordinator's `Summary failed` panel shows the error with Retry",
        panel.includes("Summary failed") && panel.includes("the reply was not valid JSON") && hasCoordinatorRetry,
        panel
    );
    await h.shot("cdp-shots/council-discussion-failed.png");

    await stubRpc(h, ["CouncilRetryCommand"]);
    await click(h, '[data-council-retry="skeptic"]');
    await click(h, '[data-council-retry="coordinator"]');
    await until(h, `(window.__arcCouncilStub?.calls ?? []).filter((c) => c.name === "CouncilRetryCommand").length >= 2`);
    const calls = await rpcCalls(h, "CouncilRetryCommand");
    rec(
        "failed: each Retry (stubbed) records CouncilRetryCommand with that expert's id",
        calls.length === 2 &&
            calls[0].data?.id === id &&
            calls[0].data?.expertid === "skeptic" &&
            calls[1].data?.id === id &&
            calls[1].data?.expertid === "coordinator",
        calls
    );
}

// ---- Retry all: two failed seats, the bar above the channel ----

async function retryAll(h, ctx, rec) {
    const id = await openFixture(h, ctx, "failed", {
        id: `${councilFixtureId("failed")}-retryall`,
        edit: (c) => void (c.failed.ux = { round: 1, error: "claude -p timed out after 10 minutes" }),
    });
    await settledText(h, "[data-council-chip]", "Failed");
    await until(h, `!!document.querySelector("[data-council-retry-all-bar]")`);
    const bar = await text(h, "[data-council-retry-all-bar]");
    const picks = await h.ev(`[...document.querySelectorAll("[data-council-retry-all-bar] [data-council-retry-pick]")].map((e) => e.getAttribute("data-council-retry-pick"))`);
    const label = await text(h, "[data-council-action='retry-all']");
    const enabled = await h.ev(`document.querySelector("[data-council-action='retry-all']")?.disabled === false`);
    rec(
        "retry all: two failed seats read `2 seats failed` with a model pick each (not the coordinator's) and an enabled `Retry all 2`",
        bar.startsWith("2 seats failed") &&
            picks.includes("skeptic") &&
            picks.includes("ux") &&
            !picks.includes("coordinator") &&
            label === "Retry all 2" &&
            enabled,
        { bar, picks, label, enabled }
    );
    await h.shot("cdp-shots/council-discussion-retry-all.png");

    await stubRpc(h, ["CouncilRetryCommand"]);
    await click(h, "[data-council-action='retry-all']");
    await until(h, `(window.__arcCouncilStub?.calls ?? []).some((c) => c.name === "CouncilRetryCommand")`);
    const calls = await rpcCalls(h, "CouncilRetryCommand");
    rec(
        "retry all: its click (stubbed) records one CouncilRetryCommand with the council's id and `all: true`",
        calls.length === 1 && calls[0].data?.id === id && calls[0].data?.all === true,
        calls
    );
}

// ---- not run ----

async function notRun(h, ctx, rec) {
    const id = await openFixture(h, ctx, "notrun");
    const chip = await settledText(h, "[data-council-chip]", "Not run");
    const estimate = await settledText(h, "[data-council-estimate]", /≈ \d+ calls · ~[\d.]+[kM] tokens · ~\d+ min/);
    const body = await text(h, "[data-council-notrun]");
    const start = await text(h, "[data-council-start]");
    rec(
        "not run: the chip reads `Not run`, the body says the token gate did not run it, with the estimate and Start council",
        chip === "Not run" && body.includes("token gate did not run it") && /≈ \d+ calls/.test(estimate) && start === "Start council",
        `${chip} | ${estimate} | ${start}`
    );
    await h.shot("cdp-shots/council-discussion-notrun.png");

    await stubRpc(h, ["CouncilStartCommand"]);
    await click(h, "[data-council-start]");
    await until(h, `(window.__arcCouncilStub?.calls ?? []).some((c) => c.name === "CouncilStartCommand")`);
    const calls = await rpcCalls(h, "CouncilStartCommand");
    rec(
        "not run: Start council (stubbed) records CouncilStartCommand with the council's id",
        calls.length === 1 && calls[0].data?.id === id,
        calls
    );
}

// ---- a done council: the list, and a follow-up in a thread ----

const FOLLOWUP_TEXT = "Does this hold on a Mac?";

const CHAT_ASK = "Is any of this risky on a Mac?";
const CHAT_ANSWER = "Only the sleep timer: macOS throttles a hidden WKWebView sooner.";

// the done council under its own id, with a question of the person's to everyone and two seats' answers to it (the
// Chat), and the person's last opening of it set between the fourth and the fifth idea, the question and the answers:
// the Chat reads `2 new` and the two ideas that came after are New. Then a click on an idea's row and on the Chat row
// opens each, and the header's Pin reads Pinned once it is saved.
async function doneList(h, ctx, rec) {
    const fx = loadCouncilFixture("done");
    let seenAt = 0;
    const id = `${councilFixtureId("done")}-list`;
    await seedCouncil(h, ctx, "done", {
        id,
        edit: (c) => {
            const byTime = [...c.proposals].sort((a, b) => a.ts - b.ts);
            seenAt = byTime[3].ts + 1000;
            delete c.pinned;
            c.replies.push(
                { id: "c1", proposalid: "", author: "you", text: CHAT_ASK, round: 4, ts: seenAt - 500, to: ["ux", "ram", "newuser", "skeptic"] },
                { id: "c2", proposalid: "", parentid: "c1", author: "ux", text: "Not for the rail icon itself.", round: 4, ts: seenAt + 2000 },
                { id: "c3", proposalid: "", parentid: "c1", author: "ram", text: CHAT_ANSWER, round: 4, ts: seenAt + 3000 }
            );
        },
    });
    // the opened map is set before the council opens: a council the person left marks itself opened as it goes
    const before = await h.ev(`window.__arcCouncil.opened()`);
    const seeded = { seededAt: before?.seededAt ?? 0, opened: { ...(before?.opened ?? {}), [id]: seenAt } };
    await h.ev(`window.__arcCouncil.setOpened(${JSON.stringify(seeded)})`);
    try {
        await openCouncil(h, id, "discussion");
        await until(h, `!!document.querySelector(${sel(`${rootOf(id)} ${CHAT_ROW}`)})`);
        await settledText(h, "[data-council-chip]", "Done");

        const chat = await chatRowOf(h);
        rec(
            "list: the Chat row is the list's first row and reads `2 new`, the newest message (`RAM: …`) and `3 messages`",
            chat?.first === true && chat.fresh === "2 new" && chat.latest === `RAM: ${CHAT_ANSWER}` && chat.count === "3 messages",
            chat
        );

        // after the summary the rows follow the Report's order (P5, P1, then P2 and P3, then P4), the idea no direction
        // cites (P6) last; each keeps its number from the order the ideas came in
        const stances = stanceCounts(fx);
        const counts = readableCounts("done");
        const ideas = await ideaIds(h);
        const rows = {};
        for (const p of ideas) rows[p] = await rowOf(h, p);
        const arrival = [...fx.proposals].sort((a, b) => a.ts - b.ts).map((p) => p.id);
        const fresh = ideas.filter((p) => rows[p]?.isNew);
        rec(
            "list: six idea rows in the Report's order, each with its arrival number, its title, its replies and the seats' latest Agrees / Has doubts / Is against it, New on the two ideas that came since the last opening",
            ideas.join(",") === "P5,P1,P2,P3,P4,P6" &&
                ideas.every(
                    (p) =>
                        rows[p]?.n === arrival.indexOf(p) + 1 &&
                        rows[p].title === fx.proposals.find((x) => x.id === p).title &&
                        rows[p].replies === (counts[p] ?? 0) &&
                        rows[p].agrees === (stances[p]?.agrees ?? 0) &&
                        rows[p].doubts === (stances[p]?.doubts ?? 0) &&
                        rows[p].against === (stances[p]?.against ?? 0)
                ) &&
                fresh.join(",") === "P5,P6" &&
                (await oldParts(h)) === 0,
            { ideas, rows, fresh, stances, counts }
        );
        await h.shot("cdp-shots/council-discussion-list.png");

        // a click on an idea's row opens its thread, named by its number and author
        await click(h, `${LIST} [data-council-idea="P2"]`);
        const opened = await until(h, `!!document.querySelector('[data-council-thread="P2"] [data-council-post="P2"]')`);
        const heading = await text(h, "[data-council-thread-heading]");
        const replies = await threadReplies(h);
        rec(
            "list: a click on P2's row opens its thread (`Idea 2 · by UX`), the row marked open, with its replies and their stance pills",
            opened &&
                heading === `Idea ${arrival.indexOf("P2") + 1} · by UX` &&
                (await attr(h, `${LIST} [data-council-idea="P2"]`, "data-open")) === "true" &&
                replies.length === counts.P2 &&
                replies.some((r) => r.label === "has doubts"),
            { heading, replies: replies.map((r) => r.label) }
        );
        await h.shot("cdp-shots/council-discussion-list-thread.png");

        // a click on the Chat row opens the Chat in the same panel: the question on top, then the three messages
        await click(h, CHAT_ROW);
        const chatOpen = await until(h, `!!document.querySelector('[data-council-thread="chat"]')`);
        const posts = await threadReplies(h);
        rec(
            "list: a click on the Chat row opens the Chat: the person's question, then their message and the two answers, with no reply box of its own",
            chatOpen &&
                (await text(h, "[data-council-thread-heading]")) === "Chat" &&
                (await exists(h, '[data-council-thread="chat"] [data-council-question]')) &&
                posts.map((p) => p.id).join(",") === "c1,c2,c3" &&
                posts[0].mine &&
                !(await exists(h, THREAD_COMPOSER)),
            posts.map((p) => p.id)
        );
        await click(h, "[data-council-thread-close]");
        await until(h, `!document.querySelector("[data-council-thread]")`);

        // the header's Pin, for real: it reads Pinned once wavesrv saved it
        const pin = `${rootOf(id)} header [data-council-pin]`;
        const was = await text(h, pin);
        await click(h, pin);
        const pinned = await until(h, `document.querySelector(${sel(pin)})?.getAttribute("data-council-pin") === "pinned"`);
        const now = await text(h, pin);
        rec("list: the header's Pin reads `Pin`, and `Pinned` after a click", was === "Pin" && pinned && now === "Pinned", { was, now });
        await h.shot("cdp-shots/council-discussion-pinned.png");
    } finally {
        // the map as it was, so the tree's unread councils read as before
        if (before != null) await h.ev(`window.__arcCouncil.setOpened(${JSON.stringify(before)})`);
    }
}

async function done(h, ctx, rec) {
    const id = await openFixture(h, ctx, "done");
    await settledText(h, "[data-council-chip]", "Done");
    const drafts = await count(h, `${LIST} [data-council-row-draft]`);
    rec(
        "done: the council shows as the list (the Chat row, six idea rows), no pause, no draft, no bubble or typing row, with a message box",
        (await exists(h, CHAT_ROW)) &&
            (await ideaIds(h)).length === 6 &&
            (await oldParts(h)) === 0 &&
            drafts === 0 &&
            !(await exists(h, "[data-council-pause]")) &&
            (await exists(h, `${CHANNEL_COMPOSER} [data-council-composer-input]`)),
        { drafts }
    );
    await h.shot("cdp-shots/council-discussion-done.png");

    // the report's questions to ask next are the channel's last line, under the newest message, none of them over the
    // box; a click puts one in the box, @ seat and all
    await h.ev(`(() => { const el = document.querySelector("[data-council-channel]"); el.scrollTop = el.scrollHeight; })()`);
    const asks = await count(h, "[data-council-channel] [data-council-ask]");
    const last = await h.ev(
        `document.querySelector("[data-council-channel] [data-council-asks]")?.parentElement?.lastElementChild?.hasAttribute("data-council-asks") ?? false`
    );
    const overBox = await count(h, `${CHANNEL_COMPOSER} [data-council-ask]`);
    await h.shot("cdp-shots/council-discussion-asknext.png");
    await click(h, '[data-council-channel] [data-council-ask="0"]');
    const box = sel(`${CHANNEL_COMPOSER} [data-council-composer-input]`);
    await until(h, `document.querySelector(${box})?.value !== ""`).catch(() => {});
    const filled = await h.ev(`document.querySelector(${box})?.value ?? ""`);
    const hidden = !(await exists(h, "[data-council-asks]"));
    rec(
        "done: Ask next offers the report's three questions as the list's last line, not over the box, and a click fills the box with the @ seat",
        asks === 3 && last && overBox === 0 && filled.startsWith("@RAM How much RAM") && hidden,
        { asks, last, overBox, filled, hidden }
    );
    // it names a seat, so the router does not take it: Read files stays on Auto and the question decides (the routed Auto
    // case, where the router decides, is council-routing's composer-auto step)
    await typeInto(h, `${CHANNEL_COMPOSER} [data-council-composer-input]`, "@UX What does rail-apps.json hold?");
    const state = await attr(h, `${CHANNEL_COMPOSER} [data-council-tools]`, "data-council-tools-state");
    const readsNow = await attr(h, `${CHANNEL_COMPOSER} [data-council-tools]`, "data-council-tools-on");
    const why = await attr(h, `${CHANNEL_COMPOSER} [data-council-tools]`, "data-council-tools-why");
    rec(
        "done: a question that names a file turns Read files (on Auto) on by itself and says which file",
        state === "auto" && readsNow === "true" && why === "rail-apps.json",
        { state, readsNow, why }
    );
    await h.shot("cdp-shots/council-discussion-readsfiles.png");
    await typeInto(h, `${CHANNEL_COMPOSER} [data-council-composer-input]`, "");

    // a follow-up on P2, in its thread
    const summarize = await text(h, "[data-council-summarize]");
    await click(h, '[data-council-thread-open="P2"]');
    await until(h, `!!document.querySelector("[data-council-thread] [data-council-post]")`);
    const post = await attr(h, "[data-council-thread] [data-council-post]", "data-council-post");

    await typeInto(h, `${THREAD_COMPOSER} [data-council-composer-input]`, FOLLOWUP_TEXT);
    const plain = await settledText(h, `${THREAD_COMPOSER} [data-council-composer-hint]`, /^1 expert answers · ≈ 1 call · ~\d+k tokens$/);

    await click(h, `${THREAD_COMPOSER} [data-council-tools-option="on"]`);
    const reading = await settledText(h, `${THREAD_COMPOSER} [data-council-composer-hint]`, /reading files · ≈ 1 call · ~[\d.]+[kM] tokens$/);
    const on = await attr(h, `${THREAD_COMPOSER} [data-council-tools]`, "data-council-tools-state");
    rec(
        "follow-up: Read files On changes the cost label from `≈ 1 call` to one that says `reading files` with more tokens",
        !plain.includes("reading files") && reading.includes("reading files") && tokensIn(reading) > tokensIn(plain) && on === "on",
        `${plain}  →  ${reading}`
    );
    // the one reply after the summary is the person's own, which leaves it current (spec decision 5): the header draws
    // no Summarize
    rec(
        "follow-up: a summary only the person replied after is current, so the header has no Summarize",
        summarize === "",
        summarize
    );

    await stubRpc(h, ["CouncilReplyCommand"]);
    await h.shot("cdp-shots/council-discussion-followup.png");
    await click(h, `${THREAD_COMPOSER} [data-council-composer-send]`);
    await until(h, `(window.__arcCouncilStub?.calls ?? []).some((c) => c.name === "CouncilReplyCommand")`);
    const calls = await rpcCalls(h, "CouncilReplyCommand");
    const data = calls[0]?.data;
    rec(
        "follow-up: the send (stubbed) records CouncilReplyCommand on the open idea with tools: true",
        calls.length === 1 && data?.id === id && post === "P2" && data?.proposalid === post && data?.text === FOLLOWUP_TEXT && data?.tools === true,
        calls
    );
    await unstubRpc(h);

    // a summary that postdates every reply is current: the header draws no Summarize (there is no call to make), and the
    // Report tab is how a person opens it
    const current = await openFixture(h, ctx, "done", {
        id: `${councilFixtureId("done")}-current`,
        edit: (c) => {
            c.summary.at = Math.max(...(c.replies ?? []).map((r) => r.ts), ...(c.proposals ?? []).map((p) => p.ts)) + 1000;
            delete c.failed;
        },
    });
    await settledText(h, "[data-council-chip]", "Done");
    const noButton = !(await exists(h, "[data-council-summarize]"));
    await click(h, "[data-council-tab='summary']");
    const opened = await until(h, `!!document.querySelector("[data-council-summary]")`);
    rec(
        "done: a summary newer than every reply leaves no Summarize in the header, and the Report tab opens it",
        noButton && opened,
        { current, noButton, opened }
    );
}

// ---- the sources: a message's files as links, and the panel a click opens ----

// writes two of the files the done fixture cites into the council's project, each line naming its own number; the
// third it cites (railappsstore.ts) stays missing
function writeCitedFiles(ctx) {
    const file = (rel, n) => {
        const path = join(ctx.repo, rel);
        mkdirSync(dirname(path), { recursive: true });
        writeFileSync(path, Array.from({ length: n }, (_, i) => `// ${rel} line ${i + 1}`).join("\n") + "\n");
    };
    file("railapps.ts", 80);
    file("pkg/services/model.go", 40);
}

const sourceLinks = (h, scope) =>
    h.ev(`[...document.querySelectorAll(${sel(`${scope} [data-council-source]`)})].map((e) => ({
        path: e.getAttribute("data-council-source"),
        text: (e.textContent ?? "")${NORM},
        title: e.getAttribute("title"),
    }))`);

async function sources(h, ctx, rec) {
    writeCitedFiles(ctx);
    await openFixture(h, ctx, "done");
    // an idea's evidence is in its thread: the row opens it
    const openThread = async (p) => {
        await click(h, `${LIST} [data-council-idea="${p}"]`);
        return until(h, `!!document.querySelector(${sel(`[data-council-thread="${p}"] [data-council-post="${p}"] [data-council-source]`)})`);
    };
    await openThread("P2");
    const P2 = '[data-council-post="P2"] [data-council-source]';
    const links = await sourceLinks(h, '[data-council-post="P2"]');
    rec(
        "sources: an idea's evidence, in its thread, is one link per file, named by the file and its line, its path in the title",
        links.length === 1 &&
            links[0].path === "pkg/services/model.go" &&
            links[0].text === "model.go:38" &&
            links[0].title === "pkg/services/model.go:38",
        links
    );

    await click(h, P2);
    const read = await until(h, `document.querySelector("[data-council-sources-body]")?.getAttribute("data-state") === "ok"`);
    const hunks = await h.ev(
        `[...document.querySelectorAll("[data-council-sources-hunk]")].map((e) => e.getAttribute("data-council-sources-hunk"))`
    );
    const cited = await h.ev(`[...document.querySelectorAll("[data-council-sources] [data-cited]")].map((e) => (e.textContent ?? "")${NORM})`);
    const label = await attr(h, "[data-council-sources-close]", "aria-label");
    rec(
        "sources: a click opens Sources on the file in the thread's place, line 38 lit with a line each side",
        read &&
            hunks.length === 1 &&
            hunks[0] === "37" &&
            cited.length === 1 &&
            cited[0].startsWith("38") &&
            cited[0].endsWith("line 38") &&
            label === "Back to the thread (Esc)" &&
            !(await exists(h, "[data-council-thread]")),
        { hunks, cited, label }
    );
    await h.shot("cdp-shots/council-discussion-sources.png");

    await focusOn(h, "[data-council-sources-close]");
    await pressEscape(h);
    const back = await until(h, `!!document.querySelector('[data-council-thread="P2"]') && !document.querySelector("[data-council-sources]")`);
    rec("sources: Escape closes Sources and goes back to the thread they were opened from", back, back);
    await click(h, "[data-council-thread-close]");
    await until(h, `!document.querySelector("[data-council-thread]")`);

    // a file that is not in the project
    await openThread("P5");
    await click(h, '[data-council-post="P5"] [data-council-source]');
    const missing = await until(h, `!!document.querySelector("[data-council-sources-error]")`);
    rec("sources: a cited file that is not in the project says so in place of its lines", missing);
    await click(h, "[data-council-sources-close]");
}

// ---- the room: two live agents seated beside two experts ----

// writes the room's agents, and the two unseated chats the add-chat phases offer (JOIN_AGENTS), as the cockpit's fixture
// roster once, for every room phase and every add-chat phase (it reloads the page, so no stub can be in place), and goes
// back to the Agent surface; teardown puts the previous roster back, once
async function withRoster(h, ctx) {
    if (ctx.roster == null) {
        ctx.roster = await writeRoomRoster(h, { extra: JOIN_AGENTS });
        // the reload lands on Jarvis; the keys and the focus below are the Agent surface's
        await h.goto("agent");
    }
}

async function room(h, ctx, rec) {
    await withRoster(h, ctx);
    const id = await openFixture(h, ctx, "room");

    const chip = await settledText(h, "[data-council-chip]", "Round 2 of 2 · 1 draft waits for you");
    rec("room: the chip reads `Round 2 of 2 · 1 draft waits for you`", chip === "Round 2 of 2 · 1 draft waits for you", chip);

    await until(h, `!!document.querySelector(${sel(LIST)})`);
    const chips = await seatChips(h);
    const byId = Object.fromEntries(chips.map((c) => [c.id, c]));
    rec(
        "room: five seat filters; the agents read `agent · 625k` and `agent · 210k` on hover, an expert `expert · sonnet`, Witness waits for its own task, Security's failure line over the list has Retry, and an agent's terminal opens beside its filter",
        chips.length === 5 &&
            byId.witness?.title.includes("agent · 625k") &&
            byId.uxaudit?.title.includes("agent · 210k") &&
            byId.security?.title.includes("expert · sonnet") &&
            byId.witness.doing === "Waiting for Witness synthesis to finish its task" &&
            byId.witness.dot === "waiting" &&
            (await exists(h, '[data-council-failed="security"] [data-council-retry="security"]')) &&
            byId.witness.open === "fx-room-witness" &&
            byId.uxaudit.open === "fx-room-uxaudit" &&
            byId.security.open === null,
        chips.map((c) => `${c.id}: ${c.text}`).join(" ; ")
    );

    // the rows: four ideas as they came (the dropped P5 is gone), P1 with Skeptic's agreement as an Agrees and no reply,
    // P2 with its one reply, P4 with a Draft for Skeptic's held reply; the Chat row holds the person's post to everyone
    const ideas = await ideaIds(h);
    const p1 = await rowOf(h, "P1");
    const p2 = await rowOf(h, "P2");
    const p4 = await rowOf(h, "P4");
    const chatRow = await chatRowOf(h);
    rec(
        "room: four idea rows as they came (the dropped P5 is gone): P1 `no replies` with one Agrees, P2 `1 reply`, P4 a Draft for its held reply; the Chat row reads `1 message` with the person's post, and no skipped line or typing row is drawn",
        ideas.join(",") === "P1,P2,P3,P4" &&
            p1?.repliesText === "no replies" &&
            p1.agrees === 1 &&
            p2?.repliesText === "1 reply" &&
            !p2.draft &&
            p4?.draft === true &&
            chatRow?.count === "1 message" &&
            chatRow.latest.startsWith("You: ") &&
            !chatRow.draft &&
            (await oldParts(h)) === 0,
        { ideas, p1, p2, p4, chatRow }
    );

    const failure = await text(h, '[data-council-failed="security"]');
    rec(
        "room: Security's failure is one line over the list with its error",
        failure.includes("Security failed while replying") && failure.includes("the reply was not valid JSON"),
        failure
    );
    await h.shot("cdp-shots/council-discussion-room.png");

    // a failed seat's Retry, on its failure line, is off while the council runs (a retry then is refused: one job at a
    // time), and its title says why; a click does nothing. A Retry that works is the `failed` phase's.
    const retry = '[data-council-failed="security"] [data-council-retry="security"]';
    const retryOff = await h.ev(`(() => {
        const line = document.querySelector(${sel(retry)});
        return { line: line && { disabled: line.disabled, title: line.getAttribute("title") } };
    })()`);
    await stubRpc(h, ["CouncilRetryCommand"]);
    await click(h, retry);
    // nothing is awaited: a disabled button runs no handler, so a call that came would already be recorded
    const retries = await rpcCalls(h, "CouncilRetryCommand");
    rec(
        "room: while the council runs, Security's Retry on its failure line is disabled (its title says why), and a click records no CouncilRetryCommand",
        retryOff.line?.disabled === true &&
            retryOff.line.title === "The council is running: retry once it is done" &&
            retries.length === 0,
        { retryOff, retries }
    );
    await unstubRpc(h);

    // a thread opens with its replies, stance pills and the held reply draft
    await click(h, `${LIST} [data-council-idea="P4"]`);
    await until(h, `!!document.querySelector('[data-council-thread="P4"] [data-council-post="P4"]')`);
    const draft = await text(h, '[data-council-thread] [data-council-draft="r4"]');
    const replies = await threadReplies(h);
    const mine = replies.find((r) => r.id === "r5");
    const hint = await text(h, `${THREAD_COMPOSER} [data-council-composer-hint]`);
    rec(
        "room: P4's thread holds the person's @ to Witness, Skeptic's held `has doubts` challenge as a draft with its three buttons, the row marked open, and a reply box naming UX audit",
        replies.length === 1 &&
            mine?.mine === true &&
            mine.text.includes("For Witness synthesis") &&
            draft.includes("Waiting for you") &&
            draft.includes("has doubts") &&
            (await text(h, '[data-council-thread] [data-council-draft="r4"] [data-council-draft-send]')) === "Send to the others" &&
            (await text(h, '[data-council-thread] [data-council-draft="r4"] [data-council-draft-edit]')) === "Edit" &&
            (await text(h, '[data-council-thread] [data-council-draft="r4"] [data-council-draft-drop]')) === "Drop" &&
            (await attr(h, `${LIST} [data-council-idea="P4"]`, "data-open")) === "true" &&
            hint === "Answered by: UX audit",
        { replies, draft, hint }
    );
    await click(h, `${LIST} [data-council-idea="P2"]`);
    await until(h, `!!document.querySelector('[data-council-thread="P2"]')`);
    const builds = (await threadReplies(h)).find((r) => r.id === "r3");
    rec(
        "room: P2's thread shows Skeptic's reply as `builds on it`, marked edited",
        builds?.label === "builds on it" && builds.text.includes("edited"),
        builds
    );
    await h.shot("cdp-shots/council-discussion-room-thread.png");

    // the Chat: the person's post to everyone as a message that steers, and Witness's wait for its own task
    await click(h, CHAT_ROW);
    await until(h, `!!document.querySelector('[data-council-thread="chat"]')`);
    const steers = (await threadReplies(h)).find((r) => r.id === "r1");
    const waits = await text(h, '[data-council-thread="chat"] [data-council-typing-row="witness"] [data-council-typing]');
    rec(
        "room: the Chat holds the person's post to everyone as a `steers` message, and Witness's wait for its own task",
        steers?.label === "steers" && steers.mine && waits === "Waiting for Witness synthesis to finish its task",
        { steers, waits }
    );

    // Escape closes the thread from inside it, and the council stays open
    await focusOn(h, "[data-council-thread]");
    await pressEscape(h);
    const closed = await until(h, `!document.querySelector("[data-council-thread]")`);
    rec(
        "room: Esc, with focus in the thread, closes it (the open thread is null) and the council stays on screen",
        closed && (await h.ev(`window.__arcCouncil.openProposal(${sel(id)})`)) === null && (await exists(h, LIST)),
        closed
    );
}

// j and k over the rows, Enter into a thread; they are the list's only while focus is inside the list or the thread
async function roomKeys(h, ctx, rec) {
    await withRoster(h, ctx);
    // under its own id, so the list mounts afresh with no cursor
    await openFixture(h, ctx, "room", { id: `${councilFixtureId("room")}-keys` });
    await until(h, `!!document.querySelector(${sel(LIST)})`);

    // focus outside the list: j moves nothing
    await h.ev(`document.activeElement?.blur()`);
    await pressJ(h);
    const idle = await focusedIdea(h);

    await focusOn(h, LIST);
    const seen = [];
    for (const press of [pressJ, pressJ, pressK, pressJ, pressJ, pressJ, pressJ, pressJ]) {
        await press(h);
        seen.push(await focusedIdea(h));
    }
    rec(
        "keys: j moves nothing with focus outside the list; in it j / k move over the rows in the list's order (the Chat, P1, the Chat, P1, P2, P3, P4) and stop at the last",
        idle === null && seen.join(",") === "chat,P1,chat,P1,P2,P3,P4,P4",
        { idle, seen }
    );

    // the cursor is on P4, the last row, which holds the focus
    const onRow = await h.ev(`document.activeElement?.getAttribute("data-council-row") ?? null`);
    await pressEnterOnRow(h);
    const opened = await until(h, `!!document.querySelector('[data-council-thread="P4"]')`);
    rec(
        "keys: the cursor's row holds the focus, and Enter opens its thread (P4)",
        onRow === "P4" && opened && (await attr(h, `${LIST} [data-council-idea="P4"]`, "data-open")) === "true",
        { onRow, opened }
    );
    await pressEscape(h);
    const closed = await until(h, `!document.querySelector("[data-council-thread]")`);
    await pressK(h);
    rec(
        "keys: Esc closes it, and k moves the cursor again (to P3, the row before P4)",
        closed && (await focusedIdea(h)) === "P3",
        { closed, focused: await focusedIdea(h) }
    );
}

// the composer posts to everyone, an @ picks one seat
async function roomComposer(h, ctx, rec) {
    await withRoster(h, ctx);
    const id = await openFixture(h, ctx, "room");
    await until(h, `!!document.querySelector("[data-council-channel]")`);
    await stubRpc(h, ["CouncilReplyCommand"]);

    // a plain message goes to the router now; `@all` is how a message asks everyone
    const input = `${CHANNEL_COMPOSER} [data-council-composer-input]`;
    const ASK_ALL = `@all ${FOLLOWUP_TEXT}`;
    await typeInto(h, input, ASK_ALL);
    const everyone = await settledText(h, `${CHANNEL_COMPOSER} [data-council-composer-hint]`, /Everyone answers/);
    await click(h, `${CHANNEL_COMPOSER} [data-council-composer-send]`);
    await until(h, `(window.__arcCouncilStub?.calls ?? []).filter((c) => c.name === "CouncilReplyCommand").length >= 1`);
    const first = (await rpcCalls(h, "CouncilReplyCommand"))[0]?.data;
    rec(
        "composer: an `@all` message to the box posts to everyone (`Everyone answers`): CouncilReplyCommand (stubbed) carries its text and no idea",
        everyone === "Everyone answers" &&
            first?.id === id &&
            first.text === ASK_ALL &&
            first.proposalid === undefined &&
            first.tools === undefined,
        first
    );

    // an @ opens the seat picker; a pick puts the name in, and the post is for that seat alone
    await typeInto(h, input, "@Sec");
    const picker = await until(h, `!!document.querySelector('[data-council-mention="security"]')`);
    const offered = await count(h, "[data-council-mention]");
    await h.ev(`document.querySelector('[data-council-mention="security"]')?.dispatchEvent(new MouseEvent("mousedown", { bubbles: true, cancelable: true }))`);
    await until(h, `document.querySelector(${sel(input)})?.value === "@Security "`);
    const closed = !(await exists(h, "[data-council-mentions]"));
    await typeInto(h, input, "@Security is this safe?");
    const only = await settledText(h, `${CHANNEL_COMPOSER} [data-council-composer-hint]`, /Answered by/);
    await click(h, `${CHANNEL_COMPOSER} [data-council-composer-send]`);
    await until(h, `(window.__arcCouncilStub?.calls ?? []).filter((c) => c.name === "CouncilReplyCommand").length >= 2`);
    const second = (await rpcCalls(h, "CouncilReplyCommand"))[1]?.data;
    rec(
        "composer: `@Sec` lists Security alone, a pick writes `@Security ` and closes the list, and the post (stubbed) names it: `Answered by: Security`",
        picker && offered === 1 && closed && only === "Answered by: Security" && second?.text === "@Security is this safe?" && second.proposalid === undefined,
        { picker, offered, closed, only, second }
    );
}

// a click on the terminal button of an agent's row in the seat list lands on that agent's terminal
async function roomTerminals(h, ctx, rec) {
    await withRoster(h, ctx);
    const terminalOf = (tab) =>
        until(
            h,
            `(() => { const p = document.querySelector('[data-agent-terminal="${tab}"]'); return p != null && !p.classList.contains("hidden") && !document.querySelector("[data-council-discussion]"); })()`
        );

    await openFixture(h, ctx, "room");
    await setSeats(h, true);
    await until(h, `!!document.querySelector('[data-council-chip-open="fx-room-witness"]')`);
    await click(h, '[data-council-chip-open="fx-room-witness"]');
    const viaChip = await terminalOf("fx-room-witness");
    rec("room: a click on the terminal button of Witness synthesis's row in the seat list lands on its terminal", viaChip, viaChip);
}

// two held ideas: the list shows, with no pause and no Continue, a Draft on each held idea's row, and Send to the others,
// Edit and Drop in its thread each call the draft command
const EDITED = "Bind to 127.0.0.1 and ::1 only, and say so in the pin dialog.";

// a held idea's draft in the thread its row opens: what it says, its buttons and its tint
const openDraft = async (h, p) => {
    await click(h, `${LIST} [data-council-idea="${p}"]`);
    await until(h, `!!document.querySelector(${sel(`[data-council-thread="${p}"] [data-council-draft="${p}"]`)})`);
    return h.ev(`(() => {
        const d = document.querySelector(${sel(`[data-council-thread="${p}"] [data-council-draft="${p}"]`)});
        return d && {
            of: d.getAttribute("data-draft-of"),
            label: d.getAttribute("aria-label"),
            text: (d.textContent ?? "")${NORM},
            buttons: ["send", "edit", "drop"].map((k) => (d.querySelector("[data-council-draft-" + k + "]")?.textContent ?? "")${NORM}),
            tint: getComputedStyle(d).backgroundColor,
            kind: document.querySelector("[data-council-thread]")?.getAttribute("data-thread-kind") ?? null,
        };
    })()`);
};

async function roomAwaiting(h, ctx, rec) {
    await withRoster(h, ctx);
    const id = await openFixture(h, ctx, "room-awaiting");

    const chip = await settledText(h, "[data-council-chip]", "Round 1 of 2 · 2 drafts wait for you");
    await until(h, `!!document.querySelector(${sel(LIST)})`);
    rec(
        "room waiting on drafts: the list is shown with no pause panel and no Continue, and the chip reads `Round 1 of 2 · 2 drafts wait for you`",
        chip === "Round 1 of 2 · 2 drafts wait for you" &&
            (await attr(h, "[data-council-discussion]", "data-council-state")) === "awaiting-you" &&
            !(await exists(h, "[data-council-pause]")) &&
            !(await exists(h, "[data-council-continue]")),
        chip
    );

    const rows = {};
    for (const p of ["P1", "P2", "P3"]) rows[p] = await rowOf(h, p);
    rec(
        "room waiting on drafts: the sent P1 and the two held ideas are rows, an amber Draft on the held P2 and P3 alone",
        (await ideaIds(h)).join(",") === "P1,P2,P3" && !rows.P1?.draft && rows.P2?.draft === true && rows.P3?.draft === true,
        rows
    );
    await h.shot("cdp-shots/council-discussion-room-awaiting.png");

    const p2 = await openDraft(h, "P2");
    const p3 = await openDraft(h, "P3");
    rec(
        "room waiting on drafts: a held idea's row opens its draft in the thread panel, amber, marked `Waiting for you`, with Send to the others, Edit and Drop",
        [p2, p3].every(
            (d) =>
                d?.kind === "held" &&
                d.of === "idea" &&
                d.label === "Draft waiting for you" &&
                d.text.includes("Waiting for you") &&
                d.buttons.join("|") === "Send to the others|Edit|Drop" &&
                d.tint !== "rgba(0, 0, 0, 0)"
        ) && !(await exists(h, THREAD_COMPOSER)),
        { p2, p3 }
    );
    await h.shot("cdp-shots/council-discussion-room-draft.png");

    // a sent idea is something to summarize: the held drafts around it do not switch Summarize off
    const withSent = await h.ev(`document.querySelector("[data-council-summarize]")?.disabled === false`);
    rec("room waiting on drafts: with the sent P1 among the drafts, Summarize is enabled", withSent, `enabled: ${withSent}`);

    await stubRpc(h, ["CouncilDraftCommand"]);
    const calls = () => rpcCalls(h, "CouncilDraftCommand");
    await openDraft(h, "P2");
    await click(h, '[data-council-draft="P2"] [data-council-draft-send]');
    await until(h, `(window.__arcCouncilStub?.calls ?? []).filter((c) => c.name === "CouncilDraftCommand").length >= 1`);

    await openDraft(h, "P3");
    await click(h, '[data-council-draft="P3"] [data-council-draft-edit]');
    await until(h, `!!document.querySelector('[data-council-draft="P3"] [data-council-draft-input]')`);
    const prefilled = await h.ev(`document.querySelector('[data-council-draft="P3"] [data-council-draft-input]')?.value ?? null`);
    await typeInto(h, '[data-council-draft="P3"] [data-council-draft-input]', EDITED);
    await click(h, '[data-council-draft="P3"] [data-council-draft-save]');
    await until(h, `(window.__arcCouncilStub?.calls ?? []).filter((c) => c.name === "CouncilDraftCommand").length >= 2`);

    await openDraft(h, "P2");
    await click(h, '[data-council-draft="P2"] [data-council-draft-drop]');
    await until(h, `(window.__arcCouncilStub?.calls ?? []).filter((c) => c.name === "CouncilDraftCommand").length >= 3`);
    const got = await calls();
    rec(
        "room waiting on drafts: Send to the others, Edit then send and Drop (stubbed) record CouncilDraftCommand with the council, the item, the action and, for the edit, the new text (the box opened on the idea's own)",
        got.length === 3 &&
            got.every((c) => c.data?.id === id) &&
            got[0].data.itemid === "P2" &&
            got[0].data.action === "send" &&
            got[0].data.text === undefined &&
            got[1].data.itemid === "P3" &&
            got[1].data.action === "edit" &&
            got[1].data.text === EDITED &&
            typeof prefilled === "string" &&
            prefilled !== "" &&
            prefilled !== EDITED &&
            got[2].data.itemid === "P2" &&
            got[2].data.action === "drop" &&
            got[2].data.text === undefined,
        got
    );

    // every idea held: none reached a seat, so there is nothing to summarize (the runner refuses it) and Summarize is
    // off. The fixture keeps P1 sent, so this is its copy with P1 held too.
    await unstubRpc(h);
    await openFixture(h, ctx, "room-awaiting", {
        id: `${councilFixtureId("room-awaiting")}-all-held`,
        edit: (c) => c.proposals.forEach((p) => void (p.draft = "held")),
    });
    await settledText(h, "[data-council-chip]", "Round 1 of 2 · 3 drafts wait for you");
    const allHeld = await h.ev(`(() => {
        const b = document.querySelector("[data-council-summarize]");
        return b ? { disabled: b.disabled === true, title: b.getAttribute("title") } : null;
    })()`);
    rec(
        "room waiting on drafts, every idea held: Summarize is disabled, and its title says to send or drop the drafts first",
        allHeld?.disabled === true && allHeld.title === "Send or drop the drafts first",
        allHeld
    );
}

// ---- add a live chat: @ in a council's message box ----

// The roster holds JOIN_AGENTS beside the room's two agents (withRoster); no fixture council seats them. Every phase stubs
// CouncilReplyCommand and CouncilEstimateCommand, so nothing seats a chat, posts a message or spends a token: what
// wavesrv does with `agents` is covered in Go.
const [RECAP, CHARTS] = JOIN_AGENTS;
const keyOf = (a) => a.tabId.slice(0, 8);
const CHAT_INPUT = `${CHANNEL_COMPOSER} [data-council-composer-input]`;
const CHAT_HINT = `${CHANNEL_COMPOSER} [data-council-composer-hint]`;
const CHAT_SEND = `${CHANNEL_COMPOSER} [data-council-composer-send]`;
const pressArrowDown = (h) => press(h, "ArrowDown", "ArrowDown", 40);

const selectedChat = (h) =>
    h.ev(`document.querySelector('[data-council-mentions] [data-council-chat-row][data-selected="true"]')?.getAttribute("data-council-chat-row") ?? null`);

// ArrowDown over the picker's rows (the seats, then the chats, one list) until the chat row `tab` is the one selected
async function arrowToChat(h, tab) {
    for (let i = 0; i < 12; i++) {
        if ((await selectedChat(h)) === tab) return true;
        await pressArrowDown(h);
    }
    return (await selectedChat(h)) === tab;
}

const seatRowIds = (h) =>
    h.ev(`[...document.querySelectorAll("[data-council-mentions] [data-council-mention]")].map((e) => e.getAttribute("data-council-mention"))`);

const chatRows = (h) =>
    h.ev(`[...document.querySelectorAll("[data-council-mentions] [data-council-chat-row]")].map((e) => ({
        id: e.getAttribute("data-council-chat-row"),
        selected: e.getAttribute("data-selected") === "true",
        key: (e.querySelector("[data-council-chat-key]")?.textContent ?? "")${NORM},
        name: (e.querySelector("[data-council-chat-name]")?.textContent ?? "")${NORM},
        meta: (e.querySelector("[data-council-chat-meta]")?.textContent ?? "")${NORM},
    }))`);

const selectedRows = (h) => count(h, '[data-council-mentions] [data-selected="true"]');

// the seat a reply's `agents` seats a chat as (Reply stores it as councilAgentSeats gives it: Id `agent-<tab>`)
const joinedSeat = (a) => ({
    id: `agent-${a.tabId}`,
    name: a.name,
    brief: "",
    model: "",
    agent: a.tabId,
    harness: a.harness,
    context: a.context,
});

async function openRoomToChat(h, ctx, suffix, stubs) {
    await withRoster(h, ctx);
    const id = await openFixture(h, ctx, "room", { id: `${councilFixtureId("room")}-${suffix}` });
    await until(h, `!!document.querySelector("[data-council-channel]")`);
    await stubRpc(h, ["CouncilReplyCommand", "CouncilEstimateCommand"], stubs);
    await focusOn(h, CHAT_INPUT);
    return id;
}

// `@` lists the seats, then the live chats no seat holds under Add a live chat, each with its key, name, harness, project
// and context; the arrow keys move over both lists as one
async function addChatPicker(h, ctx, rec) {
    await openRoomToChat(h, ctx, "addchat-picker");
    await typeInto(h, CHAT_INPUT, "@");
    const opened = await until(h, `!!document.querySelector("[data-council-add-chat]")`);
    const first = await arrowToChat(h, RECAP.tabId);

    const seats = await seatRowIds(h);
    const rows = await chatRows(h);
    const picker = await text(h, "[data-council-mentions]");
    const want = [
        [RECAP, "claude", "council-fixture", "182k"],
        [CHARTS, "pi", "vnstock-js", "21k"],
    ];
    const selected = await selectedRows(h);
    rec(
        "add-chat-picker: @ lists the four seats, then Add a live chat with both joinable chats, each with its key, title, harness, project and context size; one row is selected, a chat's, and no seated chat has a row",
        opened &&
            first &&
            seats.join(",") === "witness,uxaudit,security,skeptic" &&
            picker.includes("Seats") &&
            picker.includes("Add a live chat") &&
            rows.length === 2 &&
            want.every(
                ([a, harness, project, context], i) =>
                    rows[i].id === a.tabId &&
                    rows[i].key === keyOf(a) &&
                    rows[i].name === a.name &&
                    rows[i].meta === `${harness} · ${project} · ${context}`
            ) &&
            selected === 1 &&
            rows[0].selected === true &&
            !(await exists(h, '[data-council-chat-row="fx-room-witness"]')) &&
            !(await exists(h, '[data-council-chat-row="fx-room-uxaudit"]')),
        { opened, first, seats, rows, selected }
    );
    await h.shot("cdp-shots/council-discussion-add-chat-picker.png");

    // the arrow keys run on from the last chat row back to the first row, All seats, and on to the first seat
    const selectedMention = () =>
        h.ev(`(() => {
            const r = document.querySelector('[data-council-mentions] [data-selected="true"]');
            return r?.hasAttribute("data-council-mention-all") ? "all" : (r?.getAttribute("data-council-mention") ?? null);
        })()`);
    for (let i = 0; i < 2; i++) await pressArrowDown(h);
    const toAll = await selectedMention();
    await pressArrowDown(h);
    const wrapped = await selectedMention();
    rec(
        "add-chat-picker: the arrow keys wrap from the last chat row to the first row, All seats, then the first seat",
        toAll === "all" && wrapped === "witness",
        { toAll, wrapped }
    );
    await typeInto(h, CHAT_INPUT, "");
}

// picking both chats puts `@<key>` in the message and names them as the only answerers; Send carries both tab ids as
// `agents`; once they are seated they are on the seat bar and `@` lists them under Seats, not as chats
async function addChatSend(h, ctx, rec) {
    const id = await openRoomToChat(h, ctx, "addchat-send");
    await typeInto(h, CHAT_INPUT, "@");
    await until(h, `!!document.querySelector("[data-council-add-chat]")`);
    await arrowToChat(h, RECAP.tabId);
    await pressEnter(h);
    const firstPick = await h.ev(`document.querySelector(${sel(CHAT_INPUT)})?.value ?? ""`);
    const closed = !(await exists(h, "[data-council-mentions]"));

    // the second: another @ after the first, and the other chat's row
    await typeInto(h, CHAT_INPUT, `${firstPick}@`);
    await until(h, `!!document.querySelector("[data-council-add-chat]")`);
    const second = await arrowToChat(h, CHARTS.tabId);
    await pressEnter(h);
    const both = await h.ev(`document.querySelector(${sel(CHAT_INPUT)})?.value ?? ""`);
    rec(
        "add-chat-send: Enter on a chat row writes `@<key> ` and closes the list; a second @ and the other chat's row write both keys",
        firstPick === `@${keyOf(RECAP)} ` && closed && second && both === `@${keyOf(RECAP)} @${keyOf(CHARTS)} `,
        { firstPick, closed, second, both }
    );

    const BODY = `@${keyOf(RECAP)} @${keyOf(CHARTS)} v5 is out, pick up from the report and weigh in`;
    await typeInto(h, CHAT_INPUT, BODY);
    const hint = await settledText(h, CHAT_HINT, /^Answered by/);
    rec(
        "add-chat-send: before Send the line under the box names the two chats and no other seat: `Answered by: <chat>, <chat>`",
        hint === `Answered by: ${RECAP.name}, ${CHARTS.name}`,
        hint
    );

    await click(h, CHAT_SEND);
    await until(h, `(window.__arcCouncilStub?.calls ?? []).some((c) => c.name === "CouncilReplyCommand")`);
    const calls = await rpcCalls(h, "CouncilReplyCommand");
    const data = calls[0]?.data;
    const cleared = await until(h, `document.querySelector(${sel(CHAT_INPUT)})?.value === ""`);
    rec(
        "add-chat-send: the send (stubbed) records CouncilReplyCommand with both tab ids as `agents` and the text, and the box empties",
        calls.length === 1 &&
            data?.id === id &&
            data.text === BODY &&
            data.proposalid === undefined &&
            JSON.stringify(data.agents) === JSON.stringify([RECAP.tabId, CHARTS.tabId]) &&
            cleared,
        { calls, cleared }
    );

    // wavesrv would now hold the council with the two chats seated before the coordinator
    await seedCouncil(h, ctx, "room", {
        id,
        edit: (c) => {
            c.experts.splice(
                c.experts.findIndex((e) => e.coordinator),
                0,
                ...JOIN_AGENTS.map(joinedSeat)
            );
        },
    });
    await setSeats(h, true);
    await until(h, `document.querySelectorAll(${sel(`${SEAT_LIST} [data-council-expert-chip]`)}).length === 7`);
    const chips = await seatChips(h);
    const byId = Object.fromEntries(chips.map((c) => [c.id, c]));
    rec(
        "add-chat-send: the seat bar shows both chats as seats of their own, after the four seats and before the coordinator, each an agent with its context",
        chips.map((c) => c.id).join(",") ===
            `witness,uxaudit,security,skeptic,agent-${RECAP.tabId},agent-${CHARTS.tabId},coordinator` &&
            byId[`agent-${RECAP.tabId}`].open === RECAP.tabId &&
            byId[`agent-${CHARTS.tabId}`].open === CHARTS.tabId &&
            byId[`agent-${RECAP.tabId}`].title.includes(`${RECAP.name} · agent · 182k`) &&
            byId[`agent-${CHARTS.tabId}`].title.includes(`${CHARTS.name} · agent · 21k`),
        chips.map((c) => `${c.id}: ${c.text}`).join(" ; ")
    );
    await h.shot("cdp-shots/council-discussion-add-chat-seated.png");

    // now seats: `@` lists them under Seats and offers no chat to add; their key reaches each one
    await focusOn(h, CHAT_INPUT);
    await typeInto(h, CHAT_INPUT, "@");
    await until(h, `!!document.querySelector("[data-council-mentions]")`);
    const seats = await seatRowIds(h);
    const noChats = !(await exists(h, "[data-council-add-chat]")) && (await count(h, "[data-council-chat-row]")) === 0;
    await typeInto(h, CHAT_INPUT, `@${keyOf(CHARTS)} and now?`);
    const reached = await settledText(h, CHAT_HINT, /^Answered by/);
    rec(
        "add-chat-send: once seated, @ lists the two chats under Seats with no Add a live chat section, and `@<key>` reaches only its own seat",
        seats.includes(`agent-${RECAP.tabId}`) && seats.includes(`agent-${CHARTS.tabId}`) && noChats && reached === `Answered by: ${CHARTS.name}`,
        { seats, noChats, reached }
    );
    await typeInto(h, CHAT_INPUT, "");
}

// on a council that has met the line under the box counts the picked chat among the answerers and prices it at its
// context: the estimate request names its tab id
async function addChatFollowup(h, ctx, rec) {
    await withRoster(h, ctx);
    const id = await openFixture(h, ctx, "done", { id: `${councilFixtureId("done")}-addchat` });
    await until(h, `!!document.querySelector("[data-council-channel]")`);
    // the stub answers what the flat 20k of the expert and the chat's whole context would come to
    await stubRpc(h, ["CouncilReplyCommand", "CouncilEstimateCommand"], {
        CouncilEstimateCommand: { value: { calls: 2, tokens: 20_000 + RECAP.context, minutes: 3 } },
    });
    await focusOn(h, CHAT_INPUT);

    await typeInto(h, CHAT_INPUT, "@UX @");
    await until(h, `!!document.querySelector("[data-council-add-chat]")`);
    const onRow = await arrowToChat(h, RECAP.tabId);
    await pressEnter(h);
    const picked = await h.ev(`document.querySelector(${sel(CHAT_INPUT)})?.value ?? ""`);
    await typeInto(h, CHAT_INPUT, `${picked}Does this hold on a Mac?`);
    const hint = await settledText(h, CHAT_HINT, /^1 expert and 1 chat answer · /);
    await until(h, `(window.__arcCouncilStub?.calls ?? []).some((c) => c.name === "CouncilEstimateCommand" && (c.data?.agents ?? []).length > 0)`);
    const asked = (await rpcCalls(h, "CouncilEstimateCommand")).filter((c) => (c.data?.agents ?? []).length > 0);
    const req = asked[asked.length - 1]?.data;
    rec(
        "add-chat-followup: on a council that has met, the line under the box counts the picked chat (`1 expert and 1 chat answer`) at the chat-priced figure, and the estimate request names its tab id in `agents`",
        onRow &&
            picked === `@UX @${keyOf(RECAP)} ` &&
            hint === "1 expert and 1 chat answer · ≈ 2 calls · ~0.2M tokens" &&
            req?.id === id &&
            req.followup === 1 &&
            JSON.stringify(req.agents) === JSON.stringify([RECAP.tabId]),
        { onRow, picked, hint, req }
    );
    await h.shot("cdp-shots/council-discussion-add-chat-followup.png");

    // deleting the mention drops the pick: the chat is no answerer and the request no longer names it
    await typeInto(h, CHAT_INPUT, "@UX Does this hold on a Mac?");
    const dropped = await settledText(h, CHAT_HINT, /^1 expert answers · /);
    rec("add-chat-followup: deleting the chat's mention drops it from the answerers (`1 expert answers`)", /^1 expert answers · /.test(dropped), dropped);
    await typeInto(h, CHAT_INPUT, "");
}

// a send wavesrv refuses (an unknown chat: its error lists the live ones over several lines) shows whole in the box's
// error line, and the message stays in the box to send again
async function addChatRefused(h, ctx, rec) {
    const id = await openRoomToChat(h, ctx, "addchat-refused", {
        CouncilReplyCommand: {
            reject: `no live agent tab starts with "${keyOf(RECAP)}"\nlive claude and pi tabs: fx-room-witness, fx-room-uxaudit`,
        },
    });
    const BODY = `@${keyOf(RECAP)} join us and pick up from the report`;
    await typeInto(h, CHAT_INPUT, BODY);
    await settledText(h, CHAT_HINT, /^Answered by/);
    await click(h, CHAT_SEND);
    const errorLine = `${CHANNEL_COMPOSER} [data-council-composer-error]`;
    const shown = await until(h, `!!document.querySelector(${sel(errorLine)})`);
    const lines = await h.ev(
        `(document.querySelector(${sel(errorLine)})?.innerText ?? "").split("\\n").map((l) => l.trim()).filter(Boolean)`
    );
    const calls = await rpcCalls(h, "CouncilReplyCommand");
    const kept = await h.ev(`document.querySelector(${sel(CHAT_INPUT)})?.value ?? ""`);
    const sendEnabled = await h.ev(`!document.querySelector(${sel(CHAT_SEND)})?.disabled`);
    rec(
        "add-chat-refused: a refused send shows both lines of the error in the box's error line, keeps the message in the box and leaves Send ready",
        shown &&
            calls.length === 1 &&
            calls[0].data?.id === id &&
            JSON.stringify(calls[0].data?.agents) === JSON.stringify([RECAP.tabId]) &&
            lines.length === 2 &&
            lines[0] === `no live agent tab starts with "${keyOf(RECAP)}"` &&
            lines[1] === "live claude and pi tabs: fx-room-witness, fx-room-uxaudit" &&
            kept === BODY &&
            sendEnabled,
        { shown, lines, kept, sendEnabled }
    );
    await h.shot("cdp-shots/council-discussion-add-chat-refused.png");
}

// ---- images and @file in the message boxes ----

// What the phases below paste, drop and seed. Nothing reaches the person's disk or wavesrv's temp store: WriteTempFileCommand
// is replaced in the page (stubRpc) and answers the path of a PNG this file wrote under the scenario's own temp folder (so
// a thumbnail can load it), or stays pending, or rejects, as a step says; CouncilReplyCommand is replaced as everywhere
// else in this file, so a Send writes no council. The sent-message steps open a seeded council (room-attached) instead.

// a flat-colour PNG, 320 x 200: the bubble's thumbnail is at most 160 px tall, so its full size (200) tells the two apart
const CRC_TABLE = (() => {
    const table = new Uint32Array(256);
    for (let n = 0; n < 256; n++) {
        let c = n;
        for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
        table[n] = c >>> 0;
    }
    return table;
})();
const crc32 = (buf) => {
    let c = 0xffffffff;
    for (const b of buf) c = CRC_TABLE[(c ^ b) & 0xff] ^ (c >>> 8);
    return (c ^ 0xffffffff) >>> 0;
};
function pngChunk(type, data) {
    const body = Buffer.concat([Buffer.from(type, "latin1"), data]);
    const out = Buffer.alloc(12 + data.length);
    out.writeUInt32BE(data.length, 0);
    body.copy(out, 4);
    out.writeUInt32BE(crc32(body), 8 + data.length);
    return out;
}
function makePng(w, h, [r, g, b]) {
    const ihdr = Buffer.alloc(13);
    ihdr.writeUInt32BE(w, 0);
    ihdr.writeUInt32BE(h, 4);
    ihdr[8] = 8; // bit depth
    ihdr[9] = 2; // colour type: RGB
    const row = Buffer.alloc(1 + w * 3); // filter 0, then the pixels
    for (let x = 0; x < w; x++) row.set([r, g, b], 1 + x * 3);
    const raw = Buffer.concat(Array.from({ length: h }, () => row));
    const signature = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
    return Buffer.concat([signature, pngChunk("IHDR", ihdr), pngChunk("IDAT", deflateSync(raw)), pngChunk("IEND", Buffer.alloc(0))]);
}
const PNG = makePng(320, 200, [64, 140, 200]);
const PNG_B64 = PNG.toString("base64");

// the project file the picker offers and the sent message names; each line names its own number
// (its name holds `ec`, which the Security seat and the recap chat hold too, so one `@ec` lists all three groups)
const ATTACH_FILE = "docs/recap-notes.md";
const TEN_MB = 10 * 1024 * 1024;

// writes the PNG under the scenario's temp folder (teardown removes it with the rest) and the project file; answers the
// PNG's path as WriteTempFileCommand would
function writeAttachFiles(ctx) {
    if (ctx.attach == null) {
        const dir = join(ctx.base, "attach");
        mkdirSync(dir, { recursive: true });
        const path = join(dir, "shot.png");
        writeFileSync(path, PNG);
        ctx.attach = { path };
    }
    const file = join(ctx.repo, ATTACH_FILE);
    mkdirSync(dirname(file), { recursive: true });
    writeFileSync(file, Array.from({ length: 30 }, (_, i) => `${ATTACH_FILE} line ${i + 1}`).join("\n") + "\n");
    return ctx.attach;
}

// page side: a File made from the PNG (padded past a limit, or not an image at all) and the events a browser makes for a
// paste, a drag over and a drop; dispatchEvent answers false when the handler took the event (preventDefault)
const attachPage = `(() => {
    const png = (name, pad) => {
        const bytes = Uint8Array.from(atob(${sel(PNG_B64)}), (c) => c.charCodeAt(0));
        return new File(pad > 0 ? [bytes, new Uint8Array(pad)] : [bytes], name, { type: "image/png" });
    };
    const holding = (...files) => {
        const dt = new DataTransfer();
        for (const f of files) dt.items.add(f);
        return dt;
    };
    const on = (el, event) => el.dispatchEvent(event);
    return {
        png,
        holding,
        paste: (el, dt) => on(el, new ClipboardEvent("paste", { clipboardData: dt, bubbles: true, cancelable: true })),
        over: (el, dt) => on(el, new DragEvent("dragover", { dataTransfer: dt, bubbles: true, cancelable: true })),
        drop: (el, dt) => on(el, new DragEvent("drop", { dataTransfer: dt, bubbles: true, cancelable: true })),
    };
})()`;

// a paste of the PNG (`pad` bytes of it over, for a file past a limit) into the input at `input`
const pasteImage = (h, input, pad = 0) =>
    h.ev(`(() => {
        const p = ${attachPage};
        const el = document.querySelector(${sel(input)});
        if (!el) return null;
        el.focus();
        return { notPrevented: p.paste(el, p.holding(p.png("shot.png", ${pad}))) };
    })()`);

// a drag of `kind` ("image" or "text": a notes.txt) over the input, then its drop; answers whether each was taken
const dropOn = (h, input, kind) =>
    h.ev(`(() => {
        const p = ${attachPage};
        const el = document.querySelector(${sel(input)});
        if (!el) return null;
        const file = ${sel(kind)} === "image" ? p.png("dropped.png", 0) : new File(["hello"], "notes.txt", { type: "text/plain" });
        const before = location.href;
        const overTaken = !p.over(el, p.holding(file));
        const dropTaken = !p.drop(el, p.holding(file));
        return { overTaken, dropTaken, stayed: location.href === before };
    })()`);

// the chips of a box: where each is on its way, whether its thumbnail drew, its spinner
const chipsOf = (h, scope) =>
    h.ev(`[...document.querySelectorAll(${sel(`${scope} [data-council-image]`)})].map((e) => ({
        state: e.getAttribute("data-council-image-state"),
        spinner: !!e.querySelector("[data-council-image-spinner]"),
        shows: (e.querySelector("img")?.naturalWidth ?? 0) > 0,
    }))`);
const chipErrors = (h, scope) =>
    h.ev(`[...document.querySelectorAll(${sel(`${scope} [data-council-image-error]`)})].map((e) => (e.textContent ?? "")${NORM})`);
const chipsOnly = (h, scope, state) => count(h, `${scope} [data-council-image-state="${state}"]`);
const clearChips = (h, scope) =>
    h.ev(`document.querySelectorAll(${sel(`${scope} [data-council-image-remove]`)}).forEach((b) => b.click())`);
const sendDisabled = (h, send = CHAT_SEND) => h.ev(`document.querySelector(${sel(send)})?.disabled ?? null`);
const valueOf = (h, input) => h.ev(`document.querySelector(${sel(input)})?.value ?? ""`);
// the Read files control of a box: `state` is the option pressed (auto / on / off), `on` whether the seats read files now,
// `disabled` whether an image or an @file locks it (Auto and Off cannot be pressed), `why` what decided it
const toolsSwitch = (h, scope) =>
    h.ev(`(() => {
        const g = document.querySelector(${sel(`${scope} [data-council-tools]`)});
        return g
            ? {
                  state: g.getAttribute("data-council-tools-state"),
                  on: g.getAttribute("data-council-tools-on") === "true",
                  disabled: g.getAttribute("data-council-tools-locked") === "true",
                  why: g.getAttribute("data-council-tools-why"),
              }
            : null;
    })()`);
const replyCalls = (h) => rpcCalls(h, "CouncilReplyCommand");

// opens a fixture as its own council (an id of its own, so its draft is its own), with the upload and the post stood in for
async function openForAttach(h, ctx, name, suffix, stubs = {}) {
    const files = writeAttachFiles(ctx);
    const id = await openFixture(h, ctx, name, { id: `${councilFixtureId(name)}-${suffix}` });
    await until(h, `!!document.querySelector("[data-council-channel]")`);
    await stubRpc(h, ["WriteTempFileCommand", "CouncilReplyCommand", "CouncilEstimateCommand"], {
        WriteTempFileCommand: { value: files.path },
        CouncilEstimateCommand: { value: { calls: 1, tokens: 20_000, minutes: 1 } },
        ...stubs,
    });
    await focusOn(h, CHAT_INPUT);
    return { id, files };
}

// a paste into the channel's box, a chip with its thumbnail, from uploading to ready, in the box above the text
async function attachPaste(h, ctx, rec) {
    const { id, files } = await openForAttach(h, ctx, "done", "attach");
    const placeholder = await attr(h, CHAT_INPUT, "placeholder");
    const pasted = await pasteImage(h, CHAT_INPUT);
    await until(h, `!!document.querySelector(${sel(`${CHANNEL_COMPOSER} [data-council-image-state="ready"]`)})`);
    const chips = await chipsOf(h, CHANNEL_COMPOSER);
    const writes = await rpcCalls(h, "WriteTempFileCommand");
    const above = await h.ev(`(() => {
        const box = document.querySelector(${sel(`${CHANNEL_COMPOSER} [data-council-images]`)})?.getBoundingClientRect();
        const input = document.querySelector(${sel(CHAT_INPUT)})?.getBoundingClientRect();
        return !!box && !!input && box.bottom <= input.top + 1;
    })()`);
    rec(
        "attach-paste: a pasted image waits above the text as a thumbnail chip that reaches ready, its upload (stubbed) is kept (`keep`), and the placeholder says `paste an image · @ for a file`",
        pasted?.notPrevented === false &&
            chips.length === 1 &&
            chips[0].state === "ready" &&
            chips[0].shows &&
            above &&
            writes.length === 1 &&
            writes[0].data?.keep === true &&
            /^waveterm_paste_/.test(writes[0].data?.filename ?? "") &&
            (placeholder ?? "").includes("paste an image · @ for a file"),
        { pasted, chips, above, writes: writes.map((w) => w.data?.filename), keep: writes[0]?.data?.keep, placeholder }
    );
    await h.shot("cdp-shots/council-discussion-attach-paste.png");
    await clearChips(h, CHANNEL_COMPOSER);

    // while the write is out the chip spins and Send waits; once it lands the chip is ready and Send takes the message
    await stubRpc(h, ["WriteTempFileCommand"], { WriteTempFileCommand: { pending: true } });
    await typeInto(h, CHAT_INPUT, "What does this show?");
    await pasteImage(h, CHAT_INPUT);
    await until(h, `!!document.querySelector(${sel(`${CHANNEL_COMPOSER} [data-council-image-state="pending"]`)})`);
    const during = { chips: await chipsOf(h, CHANNEL_COMPOSER), disabled: await sendDisabled(h) };
    await h.shot("cdp-shots/council-discussion-attach-uploading.png");
    await resolveStub(h, "WriteTempFileCommand", files.path);
    await until(h, `!!document.querySelector(${sel(`${CHANNEL_COMPOSER} [data-council-image-state="ready"]`)})`);
    const after = { chips: await chipsOf(h, CHANNEL_COMPOSER), disabled: await sendDisabled(h) };
    rec(
        "attach-uploading: with the upload pending the chip shows its spinner and Send is disabled; once it resolves the chip is ready and Send is enabled",
        during.chips.length === 1 &&
            during.chips[0].state === "pending" &&
            during.chips[0].spinner &&
            during.disabled === true &&
            after.chips.length === 1 &&
            after.chips[0].state === "ready" &&
            !after.chips[0].spinner &&
            after.disabled === false,
        { during, after }
    );
    await clearChips(h, CHANNEL_COMPOSER);
    await typeInto(h, CHAT_INPUT, "");

    // a file over 10 MB is refused before any upload; an upload that fails says why on its chip
    await stubRpc(h, ["WriteTempFileCommand"], { WriteTempFileCommand: { value: files.path } });
    const before = (await rpcCalls(h, "WriteTempFileCommand")).length;
    await pasteImage(h, CHAT_INPUT, TEN_MB);
    await until(h, `!!document.querySelector(${sel(`${CHANNEL_COMPOSER} [data-council-image-error]`)})`);
    const big = {
        chips: await chipsOf(h, CHANNEL_COMPOSER),
        errors: await chipErrors(h, CHANNEL_COMPOSER),
        writes: (await rpcCalls(h, "WriteTempFileCommand")).length - before,
    };
    await h.shot("cdp-shots/council-discussion-attach-oversize.png");
    await clearChips(h, CHANNEL_COMPOSER);
    await stubRpc(h, ["WriteTempFileCommand"], { WriteTempFileCommand: { reject: "disk full" } });
    await typeInto(h, CHAT_INPUT, "Is this readable?");
    await pasteImage(h, CHAT_INPUT);
    await until(h, `!!document.querySelector(${sel(`${CHANNEL_COMPOSER} [data-council-image-error]`)})`);
    const failed = {
        chips: await chipsOf(h, CHANNEL_COMPOSER),
        errors: await chipErrors(h, CHANNEL_COMPOSER),
        disabled: await sendDisabled(h),
    };
    rec(
        "attach-oversize: a paste over 10 MB shows an error chip that says so and makes no WriteTempFileCommand call; a paste whose upload rejects shows the error chip with its message and leaves Send ready",
        big.chips.length === 1 &&
            big.chips[0].state === "error" &&
            big.errors.length === 1 &&
            /10 MB/.test(big.errors[0]) &&
            big.writes === 0 &&
            failed.chips.length === 1 &&
            failed.chips[0].state === "error" &&
            failed.errors.join("|") === "disk full" &&
            failed.disabled === false,
        { big, failed }
    );
    await clearChips(h, CHANNEL_COMPOSER);
    await typeInto(h, CHAT_INPUT, "");
    await stubRpc(h, ["WriteTempFileCommand"], { WriteTempFileCommand: { value: files.path } });

    // the chip's x takes it away
    await pasteImage(h, CHAT_INPUT);
    await until(h, `!!document.querySelector(${sel(`${CHANNEL_COMPOSER} [data-council-image-state="ready"]`)})`);
    const had = (await chipsOf(h, CHANNEL_COMPOSER)).length;
    await clearChips(h, CHANNEL_COMPOSER);
    const gone = await until(h, `!document.querySelector(${sel(`${CHANNEL_COMPOSER} [data-council-image]`)})`);
    rec(
        "attach-remove: the chip's x removes the image, and the strip above the text goes with it",
        had === 1 && gone && !(await exists(h, `${CHANNEL_COMPOSER} [data-council-images]`)),
        { had, gone }
    );

    // an image dropped on the box is kept; a file that is no image is ignored, and the page stays on the council
    const image = await dropOn(h, CHAT_INPUT, "image");
    await until(h, `!!document.querySelector(${sel(`${CHANNEL_COMPOSER} [data-council-image-state="ready"]`)})`);
    const dropped = await chipsOf(h, CHANNEL_COMPOSER);
    await clearChips(h, CHANNEL_COMPOSER);
    const notes = await dropOn(h, CHAT_INPUT, "text");
    await new Promise((r) => setTimeout(r, 300));
    const none = await count(h, `${CHANNEL_COMPOSER} [data-council-image]`);
    rec(
        "attach-drop: dropping an image on the box adds a chip (the drag over it is allowed); dropping a text file adds none, is still taken so the webview does not navigate, and the page stays on the council",
        image?.overTaken === true &&
            image.dropTaken === true &&
            dropped.length === 1 &&
            dropped[0].state === "ready" &&
            notes?.overTaken === true &&
            notes.dropTaken === true &&
            notes.stayed === true &&
            none === 0 &&
            (await exists(h, rootOf(id))),
        { image, dropped, notes, none }
    );
    await h.shot("cdp-shots/council-discussion-attach-drop.png");

    // a paste into an idea's thread box lands in that box, not in the channel's
    await click(h, '[data-council-thread-open="P2"]');
    await until(h, `!!document.querySelector(${sel(`${THREAD_COMPOSER} [data-council-composer-input]`)})`);
    const threadInput = `${THREAD_COMPOSER} [data-council-composer-input]`;
    await pasteImage(h, threadInput);
    await until(h, `!!document.querySelector(${sel(`${THREAD_COMPOSER} [data-council-image-state="ready"]`)})`);
    const inThread = await chipsOf(h, THREAD_COMPOSER);
    const inChannel = await chipsOf(h, CHANNEL_COMPOSER);
    const threadPlaceholder = await attr(h, threadInput, "placeholder");
    rec(
        "attach-thread: a paste into an idea thread's box adds a chip there and none in the channel's box",
        inThread.length === 1 && inThread[0].state === "ready" && inThread[0].shows && inChannel.length === 0,
        { inThread, inChannel, threadPlaceholder }
    );
    await h.shot("cdp-shots/council-discussion-attach-thread.png");
    await clearChips(h, THREAD_COMPOSER);
    await click(h, "[data-council-thread-close]");

    // leaving the council keeps the draft: its text and its chip are there when it is opened again
    await typeInto(h, CHAT_INPUT, "Keep this draft");
    await pasteImage(h, CHAT_INPUT);
    await until(h, `!!document.querySelector(${sel(`${CHANNEL_COMPOSER} [data-council-image-state="ready"]`)})`);
    await openFixture(h, ctx, "notrun", { id: `${councilFixtureId("notrun")}-attach` });
    const left = !(await exists(h, rootOf(id)));
    await openCouncil(h, id, "discussion");
    await until(h, `!!document.querySelector(${sel(rootOf(id))}) && !!document.querySelector(${sel(CHAT_INPUT)})`);
    const kept = { chips: await chipsOf(h, CHANNEL_COMPOSER), text: await valueOf(h, CHAT_INPUT) };
    rec(
        "attach-draft-kept: with a chip in the channel box, opening another council and coming back finds the chip (its thumbnail drawn) and the text still there",
        left && kept.chips.length === 1 && kept.chips[0].state === "ready" && kept.chips[0].shows && kept.text === "Keep this draft",
        { left, kept }
    );
    await h.shot("cdp-shots/council-discussion-attach-draft-kept.png");

    // Send: the post (stubbed) carries the image's path as `attachments`, reads files, and the box empties
    await focusOn(h, CHAT_INPUT);
    await click(h, CHAT_SEND);
    await until(h, `(window.__arcCouncilStub?.calls ?? []).some((c) => c.name === "CouncilReplyCommand")`);
    const sent = (await replyCalls(h))[0]?.data;
    const emptied = await until(
        h,
        `document.querySelector(${sel(CHAT_INPUT)})?.value === "" && !document.querySelector(${sel(`${CHANNEL_COMPOSER} [data-council-image]`)})`
    );
    rec(
        "attach-send-call: Send (stubbed) records CouncilReplyCommand with the image's path in `attachments` and `tools: true`, and the box (text and chips) is empty after",
        sent?.id === id &&
            sent.text === "Keep this draft" &&
            JSON.stringify(sent.attachments) === JSON.stringify([files.path]) &&
            sent.tools === true &&
            sent.proposalid === undefined &&
            emptied,
        { sent, emptied }
    );
}

// on a council that has met, an image or an @file locks Let them read files on, and the estimate counts the reading
async function attachLocked(h, ctx, rec) {
    await openForAttach(h, ctx, "done", "attach-locked");
    // one expert is named, so the line under the box prices a follow-up and the switch shows
    await typeInto(h, CHAT_INPUT, "@UX Does this hold on a Mac?");
    await settledText(h, CHAT_HINT, /^1 expert answers · /);
    const plain = await toolsSwitch(h, CHANNEL_COMPOSER);

    await pasteImage(h, CHAT_INPUT);
    await until(h, `!!document.querySelector(${sel(`${CHANNEL_COMPOSER} [data-council-image-state="ready"]`)})`);
    const image = await toolsSwitch(h, CHANNEL_COMPOSER);
    // a click on Off (disabled while the image is in) leaves it on
    await h.ev(`document.querySelector(${sel(`${CHANNEL_COMPOSER} [data-council-tools-option="off"]`)})?.click()`);
    const afterClick = await toolsSwitch(h, CHANNEL_COMPOSER);
    const priced = await until(
        h,
        `(window.__arcCouncilStub?.calls ?? []).some((c) => c.name === "CouncilEstimateCommand" && c.data?.tools === true)`
    );
    await h.shot("cdp-shots/council-discussion-attach-locked-switch.png");
    await clearChips(h, CHANNEL_COMPOSER);
    const released = await toolsSwitch(h, CHANNEL_COMPOSER);

    await typeInto(h, CHAT_INPUT, `Look at @${ATTACH_FILE} for this`);
    const file = await toolsSwitch(h, CHANNEL_COMPOSER);
    rec(
        "attach-locked-switch: Read files is Auto, off and free for a plain question; with an image attached, or an @file in the text, it is On and locked (a click on Off leaves it on), the estimate is asked with `tools: true`, and without them it is free again",
        plain?.state === "auto" &&
            plain.on === false &&
            plain.disabled === false &&
            image?.state === "on" &&
            image.on === true &&
            image.disabled === true &&
            image.why === "an image" &&
            afterClick?.on === true &&
            afterClick.state === "on" &&
            priced &&
            released?.state === "auto" &&
            released.on === false &&
            released.disabled === false &&
            file?.state === "on" &&
            file.on === true &&
            file.disabled === true &&
            file.why === ATTACH_FILE,
        { plain, image, afterClick, priced, released, file }
    );
    await typeInto(h, CHAT_INPUT, "");
}

// `@` lists Seats, then Files, then Add a live chat; the arrows cross the three, Enter and Tab pick a file's row
async function attachPicker(h, ctx, rec) {
    writeAttachFiles(ctx);
    const id = await openRoomToChat(h, ctx, "attach-picker");
    const rowsOf = () =>
        h.ev(`[...document.querySelectorAll("[data-council-mentions] [role='option']")].map((e) => ({
            kind: e.hasAttribute("data-council-mention") ? "seat" : e.hasAttribute("data-council-file-row") ? "file" : "chat",
            id: e.getAttribute("data-council-mention") ?? e.getAttribute("data-council-file-row") ?? e.getAttribute("data-council-chat-row"),
            selected: e.getAttribute("data-selected") === "true",
        }))`);
    const selectedRow = async () => (await rowsOf()).find((r) => r.selected) ?? null;
    // ArrowDown until the row `rowId` is the selected one
    const arrowToRow = async (rowId) => {
        for (let i = 0; i < 12; i++) {
            if ((await selectedRow())?.id === rowId) return true;
            await pressArrowDown(h);
        }
        return (await selectedRow())?.id === rowId;
    };
    const pressTab = () => press(h, "Tab", "Tab", 9);
    // `@ec` is in Security's name, the recap chat's title and docs/recap-notes.md
    const openFor = async () => {
        await typeInto(h, CHAT_INPUT, "@ec");
        // the project's files are listed on the first @, so the Files group lands a moment after the seats
        return until(h, `!!document.querySelector("[data-council-file-row]")`);
    };

    const listed = await openFor();
    const rows = await rowsOf();
    const kinds = rows.map((r) => r.kind);
    const picker = await text(h, "[data-council-mentions]");
    const heading = await text(h, "[data-council-files-heading]");
    rec(
        "attach-file-picker: `@ec` lists the Seats group (Security), then a Files heading with docs/recap-notes.md, then Add a live chat (the recap chat), in that order, with the first row selected",
        listed &&
            /^s+f+c+$/.test(kinds.map((k) => k[0]).join("")) &&
            rows[0].id === "security" &&
            rows.some((r) => r.kind === "file" && r.id === ATTACH_FILE) &&
            rows.some((r) => r.kind === "chat" && r.id === RECAP.tabId) &&
            rows.filter((r) => r.selected).length === 1 &&
            rows[0].selected &&
            heading === "Files" &&
            picker.indexOf("Seats") >= 0 &&
            picker.indexOf("Seats") < picker.indexOf("Files") &&
            picker.indexOf("Files") < picker.indexOf("Add a live chat"),
        { rows, heading }
    );
    await h.shot("cdp-shots/council-discussion-attach-file-picker.png");

    // one ArrowDown per row walks every row in the order drawn and comes round to the first; ArrowUp from it goes to the last
    const walk = [(await selectedRow())?.kind];
    for (let i = 0; i < rows.length; i++) {
        await pressArrowDown(h);
        walk.push((await selectedRow())?.kind);
    }
    await press(h, "ArrowUp", "ArrowUp", 38);
    const back = (await selectedRow())?.kind;
    rec(
        "attach-file-picker: the arrow keys cross the groups (seat, files, chat, then round to the seat), and ArrowUp from the seat goes round to the chat",
        walk.join(",") === [...kinds, kinds[0]].join(",") && back === "chat" && kinds[kinds.length - 1] === "chat",
        { walk, back }
    );

    // Enter on the file row writes `@<path> ` and closes the list
    await typeInto(h, CHAT_INPUT, "");
    await openFor();
    const onFile = await arrowToRow(ATTACH_FILE);
    const fileKind = (await selectedRow())?.kind;
    await pressEnter(h);
    const byEnter = await valueOf(h, CHAT_INPUT);
    const closedByEnter = !(await exists(h, "[data-council-mentions]"));
    // Tab on a file row does the same
    await typeInto(h, CHAT_INPUT, "");
    await openFor();
    await arrowToRow(ATTACH_FILE);
    await pressTab();
    const byTab = await valueOf(h, CHAT_INPUT);
    const closedByTab = !(await exists(h, "[data-council-mentions]"));
    rec(
        "attach-file-picker: Enter on the file row inserts `@docs/recap-notes.md ` and closes the list, and Tab on it does the same",
        onFile &&
            fileKind === "file" &&
            byEnter === `@${ATTACH_FILE} ` &&
            closedByEnter &&
            byTab === `@${ATTACH_FILE} ` &&
            closedByTab,
        { onFile, fileKind, byEnter, closedByEnter, byTab, closedByTab }
    );

    // a message that names a file is sent with the seats reading it, in a round as in a follow-up, and it names no seat
    // (`@all` asks everyone: a plain message would go to the router)
    const BODY = `@all @${ATTACH_FILE} what do you make of this plan?`;
    await typeInto(h, CHAT_INPUT, BODY);
    const hint = await settledText(h, CHAT_HINT, /^Everyone answers/);
    await click(h, CHAT_SEND);
    await until(h, `(window.__arcCouncilStub?.calls ?? []).some((c) => c.name === "CouncilReplyCommand")`);
    const sent = (await replyCalls(h))[0]?.data;
    rec(
        "attach-send-call: in a round, an `@all` message that names @docs/recap-notes.md reaches everyone, and Send (stubbed) records `tools: true` with the text as typed and no attachments",
        hint === "Everyone answers" &&
            sent?.id === id &&
            sent.text === BODY &&
            sent.tools === true &&
            sent.attachments === undefined &&
            sent.proposalid === undefined,
        { hint, sent }
    );
}

// the person's sent message: the image as a thumbnail under the text, the @file as a chip in place of its path; a click
// on the thumbnail shows it full size, a click on the chip opens the file in Sources
async function attachSent(h, ctx, rec) {
    const files = writeAttachFiles(ctx);
    const id = await openFixture(h, ctx, "room-attached", {
        edit: (c) => {
            for (const r of c.replies ?? []) {
                r.attachments = (r.attachments ?? []).map((p) => (p === ATTACHMENT_PLACEHOLDER ? files.path : p));
            }
        },
    });
    // the person's message to everyone is in the Chat, which its row opens
    await until(h, `!!document.querySelector(${sel(CHAT_ROW)})`);
    await click(h, CHAT_ROW);
    const post = '[data-council-thread="chat"] [data-council-reply-post="r1"]';
    await until(h, `!!document.querySelector(${sel(post)})`);
    const loaded = await until(h, `(document.querySelector(${sel(`${post} [data-prompt-images] img`)})?.naturalWidth ?? 0) > 0`);
    const bubble = await h.ev(`(() => {
        const post = document.querySelector(${sel(post)});
        const chip = post?.querySelector("[data-council-file-chip]");
        const img = post?.querySelector("[data-prompt-images] img");
        return {
            thumbs: post?.querySelectorAll("[data-prompt-images] img").length ?? 0,
            thumbH: Math.round(img?.getBoundingClientRect().height ?? 0),
            text: (post?.textContent ?? "")${NORM},
            chip: chip?.getAttribute("data-council-file-chip") ?? null,
            chipText: (chip?.textContent ?? "")${NORM},
            chipInLine: chip?.parentElement?.tagName === "P",
            gone: !!post?.querySelector("[data-prompt-image-gone]"),
        };
    })()`);
    const pngName = files.path.split(/[\\/]/).pop();
    rec(
        "attach-sent-bubble: the person's message, in the Chat, shows its image as a thumbnail under the text (no attachment path in the text), and its @docs/recap-notes.md as a file chip in the line in place of `@path`",
        loaded &&
            bubble.thumbs === 1 &&
            bubble.thumbH > 0 &&
            bubble.thumbH <= 160 &&
            !bubble.gone &&
            !bubble.text.includes(files.path) &&
            !bubble.text.includes(pngName) &&
            !bubble.text.includes("@docs") &&
            !bubble.text.includes(ATTACHMENT_PLACEHOLDER) &&
            bubble.chip === ATTACH_FILE &&
            bubble.chipText === "recap-notes.md" &&
            bubble.chipInLine &&
            bubble.text.includes("my notes in recap-notes.md. Judge each idea"),
        { loaded, bubble }
    );
    await h.shot("cdp-shots/council-discussion-attach-sent-bubble.png");

    // a click on the thumbnail shows it at its own size (200 px tall), another click shrinks it back
    const thumb = `${post} [data-prompt-images] img`;
    const heightOf = () => h.ev(`Math.round(document.querySelector(${sel(thumb)})?.getBoundingClientRect().height ?? 0)`);
    await click(h, thumb);
    await until(h, `document.querySelector(${sel(thumb)})?.classList.contains("cursor-zoom-out")`);
    const open = await heightOf(); // the PNG's 200 and the border, or less where the panel is narrower than the PNG
    await h.shot("cdp-shots/council-discussion-attach-bubble-open.png");
    await click(h, thumb);
    await until(h, `!document.querySelector(${sel(thumb)})?.classList.contains("cursor-zoom-out")`);
    const shut = await heightOf();
    // a click on the file chip opens the file in Sources, its first lines drawn
    await click(h, `${post} [data-council-file-chip]`);
    const read = await until(h, `document.querySelector("[data-council-sources-body]")?.getAttribute("data-state") === "ok"`);
    const lines = await text(h, "[data-council-sources-body]");
    rec(
        "attach-bubble-open: a click on the thumbnail opens it larger, up to its own size (200 px and its 1 px border) as the Chat panel fits it, and another shrinks it back; a click on the file chip opens docs/recap-notes.md in Sources, its lines drawn",
        open > bubble.thumbH && open <= 204 && shut === bubble.thumbH && read && lines.includes(`${ATTACH_FILE} line 1`),
        { open, shut, read, lines: lines.slice(0, 80) }
    );
    await click(h, "[data-council-sources-close]");
}

// ---- the hooks ----

const PHASES = [
    ["round 2", round2],
    ["list", doneList],
    ["header", header],
    ["seat filter", seatFilter],
    ["picks", picks],
    ["brainstorm", brainstorm],
    ["queued", queued],
    ["round 1", round1],
    ["paused", awaiting],
    ["stopped", stopped],
    ["failed", failed],
    ["retry all", retryAll],
    ["not run", notRun],
    ["done", done],
    ["sources", sources],
    ["room", room],
    ["room keys", roomKeys],
    ["room composer", roomComposer],
    ["room waiting on drafts", roomAwaiting],
    ["room terminals", roomTerminals],
    ["add-chat-picker", addChatPicker],
    ["add-chat-send", addChatSend],
    ["add-chat-followup", addChatFollowup],
    ["add-chat-refused", addChatRefused],
    ["attach-paste", attachPaste],
    ["attach-locked-switch", attachLocked],
    ["attach-file-picker", attachPicker],
    ["attach-sent", attachSent],
];

export const councilDiscussion = {
    async arrange(h, fx) {
        return arrangeCouncilProject(h, fx);
    },
    async assert(h, ctx) {
        const steps = [];
        const rec = (step, ok, detail) => steps.push({ step, ok: !!ok, detail: detail == null ? undefined : shortened(detail) });
        for (const [name, run] of PHASES) {
            try {
                await run(h, ctx, rec);
            } catch (e) {
                rec(`${name}: the phase ran to its end`, false, e?.message ?? String(e));
            } finally {
                // a stand-in must not carry into the next phase's clicks
                await unstubRpc(h).catch(() => {});
            }
        }
        return steps;
    },
    async teardown(h, ctx) {
        // the roster first: it reloads the page, and teardownCouncilProject reloads again onto the restored state
        if (ctx.roster != null) {
            await restoreRoomRoster(ctx.roster).catch((e) => console.error(`restore the room roster failed: ${e?.message ?? e}`));
        }
        await teardownCouncilProject(h, ctx);
    },
};
