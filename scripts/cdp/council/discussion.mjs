// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0
//
// council-discussion (docs/superpowers/plans/2026-10-21-council.md, Task 14; the plain words and the picks:
// 2026-10-22-council-v1-ui.md, Task 3; Brainstorm and the queue: 2026-10-22-council-v1-room.md, Task 4; the channel with
// threads and the live agents: 2026-10-29-council-live-agents.md, Task 8): the Discussion as a chat while the seats reply
// (the channel with its seat chips, round dividers, ideas with reply chips, agree reactions, typing rows, a thread panel
// and a composer, Summarize off while they do), on a council whose experts gave their picks, as a Brainstorm, queued (a
// line that names the council it waits for), while they first propose (the experts' cards and the call bar), at the pause
// (the ticks, Ask the experts, Continue), stopped at the pause (Summarize), failed (Retry on an expert and on the
// coordinator), not run (Start council), a done council as a channel with a follow-up in a thread, and the `room`
// fixtures: two live agents seated beside two experts (the seat chips with their context, a skipped turn, a failed seat's
// Retry, drafts waiting for the person with Send to the others, Edit and Drop, a thread with its stance pills and its
// held reply, j / k / Enter / Esc, the composer and its @, a click on an agent's chip or on Open its terminal). Each
// phase seeds its own fixture council and takes its own shot.
//
// The hooks are called by councilscenarios.mjs as arrange(h, fx), assert(h, ctx, fx), teardown(h, ctx, fx). Nothing here
// spends a token or starts an agent: Summarize (on the stopped council), Continue, Retry, Start council, a draft's
// Send / Edit / Drop, the composer's posts and the follow-up's send are clicked with their RpcApi command replaced in the
// page (fixtures.mjs stubRpc) and the call read back with rpcCalls. The one real write is the round 2 reply: that council
// is `running` on disk with no run behind it, so wavesrv only stores the reply. The estimate is a real RPC, but it prices
// and calls no model. The room phases write the room's two agents as the cockpit fixture roster (writeRoomRoster, which
// reloads the page) and put the previous roster back in teardown.

import { waitFor } from "../attach.mjs";
import {
    arrangeCouncilProject,
    councilFixtureId,
    loadCouncilFixture,
    openCouncil,
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

// ---- the chat's parts, as they are drawn: its hooks, never its words ----

const channelKinds = (h) =>
    h.ev(`[...document.querySelectorAll("[data-council-channel] [data-council-item]")].map((e) => e.getAttribute("data-item-kind"))`);

const dividers = (h) =>
    h.ev(`[...document.querySelectorAll("[data-council-divider]")].map((e) => (e.textContent ?? "")${NORM})`);

const ideaIds = (h) =>
    h.ev(`[...document.querySelectorAll("[data-council-idea]")].map((e) => e.getAttribute("data-council-idea"))`);

const typingLines = (h) =>
    h.ev(`[...document.querySelectorAll("[data-council-typing]")].map((e) => (e.textContent ?? "")${NORM})`);

// the replies of the open thread: id, the stance pill's word, whether it is the person's, its text
const threadReplies = (h) =>
    h.ev(`[...document.querySelectorAll("[data-council-thread] [data-council-reply-post]")].map((m) => ({
        id: m.getAttribute("data-council-reply-post"),
        label: m.getAttribute("data-item-label"),
        mine: m.getAttribute("data-item-mine") === "true",
        text: (m.textContent ?? "")${NORM},
    }))`);

const seatChips = (h) =>
    h.ev(`[...document.querySelectorAll("[data-council-expert-chip]")].map((c) => ({
        id: c.getAttribute("data-council-expert-chip"),
        lit: c.getAttribute("data-lit") === "true",
        dot: c.getAttribute("data-dot"),
        text: (c.textContent ?? "")${NORM},
        doing: (c.querySelector("[data-council-seat-doing]")?.textContent ?? "")${NORM},
        title: c.getAttribute("title"),
        retry: !!c.querySelector("[data-council-chip-retry]"),
        open: c.querySelector("[data-council-chip-open]")?.getAttribute("data-council-chip-open") ?? null,
    }))`);

const focusedIdea = (h) => h.ev(`document.querySelector('[data-council-idea][data-focused="true"]')?.getAttribute("data-council-idea") ?? null`);

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
        "round 2: five seat chips replace the header's avatars, two lit, Skeptic's line reads `Replying to UX`, each an `expert · …`",
        chips.length === 5 &&
            chips.filter((c) => c.lit).length === 2 &&
            skeptic?.doing === "Replying to UX" &&
            chips.filter((c) => c.id !== "coordinator").every((c) => /expert · \w+/.test(c.text)) &&
            (await count(h, "[data-council-avatar]")) === 0,
        chips.map((c) => `${c.id}: ${c.doing}`).join(" ; ")
    );

    const cost = await text(h, "[data-council-cost]");
    rec("round 2: the cost line reads `m:ss · N replies · X.XXM tokens`", /\d+:\d\d · \d+ replies · [\d.]+M tokens/.test(cost), cost);

    const kinds = await channelKinds(h);
    const goal = await text(h, '[data-item-kind="question"]');
    const marks = await dividers(h);
    rec(
        "round 2: the channel opens with the question (`sets the goal`), then a divider for each round, `Round 1 · ideas` and `Round 2 · replies`",
        kinds[0] === "question" &&
            goal.includes("Which changes to pinned apps on the nav rail are worth making first?") &&
            goal.includes("sets the goal") &&
            marks.join("|") === "Round 1 · ideas|Round 2 · replies",
        { kinds: kinds.slice(0, 3), marks }
    );

    // every idea is a message with a reply chip, and the withdrawn P6 is one too; a reply is in its idea's thread only
    const counts = readableCounts("round2");
    const ideas = await ideaIds(h);
    const chipsOf = await h.ev(`[...document.querySelectorAll("[data-council-thread-open]")].map((b) => [b.getAttribute("data-council-thread-open"), b.getAttribute("data-replies")])`);
    const replyPosts = await count(h, "[data-council-channel] [data-council-reply-post]");
    rec(
        "round 2: six ideas in the channel (in the order they were posted), each with a reply chip counting the replies a person reads, and no reply of its own in the channel",
        [...ideas].sort().join(",") === "P1,P2,P3,P4,P5,P6" &&
            chipsOf.length === 6 &&
            chipsOf.every(([p, n]) => Number(n) === (counts[p] ?? 0)) &&
            replyPosts === 0,
        { ideas, chipsOf, counts, replyPosts }
    );

    const typing = await typingLines(h);
    rec(
        "round 2: a typing row reads `Skeptic is writing…`, and no visible text holds a proposal id",
        typing.includes("Skeptic is writing…") && !/\bP\d+\b/.test(await text(h, "[data-council-channel]")),
        typing
    );

    // a click on the reply chip of P2 opens its thread: the idea on top, its replies with their stance pills
    await click(h, '[data-council-thread-open="P2"]');
    const opened = await until(h, `!!document.querySelector('[data-council-thread="P2"] [data-council-post="P2"]')`);
    const openAtom = await h.ev(`window.__arcCouncil.openProposal(${sel(id)})`);
    const highlighted = (await attr(h, '[data-council-idea="P2"]', "data-open")) === "true";
    const replies = await threadReplies(h);
    const labels = replies.map((r) => r.label);
    rec(
        "round 2: the reply chip of P2 opens its thread with the idea highlighted in the channel, a `has doubts` and an `is against it` reply among its five, and Skeptic typing in it",
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
    await until(h, `!!document.querySelector("[data-council-picks]")`);

    const chips = await h.ev(`[...document.querySelectorAll("[data-council-picks]")].map((e) => ({
        on: e.closest("[data-council-idea]")?.getAttribute("data-council-idea") ?? null,
        text: (e.textContent ?? "")${NORM},
        title: e.getAttribute("title"),
    }))`);
    const channel = await text(h, "[data-council-channel]");
    rec(
        "picks: P2 carries `Picked by 2` (title `Picked by 2 of 4 experts`) and P1 `Picked by 1`, the other four none, and no proposal id shows",
        chips.length === 2 &&
            chips.find((c) => c.on === "P2")?.text === "Picked by 2" &&
            chips.find((c) => c.on === "P2")?.title === "Picked by 2 of 4 experts" &&
            chips.find((c) => c.on === "P1")?.text === "Picked by 1" &&
            !/\bP\d+\b/.test(channel),
        chips
    );

    const reaction = await h.ev(`[...document.querySelectorAll("[data-council-reaction]")].map((e) => ({
        text: (e.textContent ?? "")${NORM},
        under: e.closest("[data-council-idea]")?.getAttribute("data-council-idea") ?? null,
    }))`);
    const counts = readableCounts("round2");
    const chipP2 = await attr(h, '[data-council-thread-open="P2"]', "data-replies");
    await click(h, '[data-council-thread-open="P2"]');
    await until(h, `!!document.querySelector('[data-council-thread="P2"]')`);
    const hidden = !(await exists(h, '[data-council-reply-post="r17"]'));
    rec(
        "picks: New user's blank accept is a `New user agrees` reaction under P2's message, with no reply of its own in P2's thread and none in its count",
        reaction.length === 1 &&
            reaction[0].text === "New user agrees" &&
            reaction[0].under === "P2" &&
            hidden &&
            Number(chipP2) === counts.P2 - 1,
        { reaction, hidden, chipP2, expected: counts.P2 - 1 }
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
        "failed: Skeptic's failure line in the channel reads `Skeptic failed while proposing`, shows its error and has Retry",
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

// ---- a done council: a channel, and a follow-up in a thread ----

const FOLLOWUP_TEXT = "Does this hold on a Mac?";

async function done(h, ctx, rec) {
    const id = await openFixture(h, ctx, "done");
    await settledText(h, "[data-council-chip]", "Done");
    const kinds = await channelKinds(h);
    const typing = await count(h, '[data-council-channel] [data-item-kind="typing"]');
    const drafts = await count(h, "[data-council-draft]");
    rec(
        "done: the council shows as a channel (the question, two dividers, six ideas with reply chips), no pause, no draft and no typing row, with a message box",
        kinds[0] === "question" &&
            (await ideaIds(h)).length === 6 &&
            (await dividers(h)).length === 2 &&
            typing === 0 &&
            drafts === 0 &&
            !(await exists(h, "[data-council-pause]")) &&
            (await exists(h, `${CHANNEL_COMPOSER} [data-council-composer-input]`)),
        { kinds: kinds.slice(0, 3), typing, drafts }
    );
    await h.shot("cdp-shots/council-discussion-done.png");

    // a follow-up on P2, in its thread
    const summarize = await text(h, "[data-council-summarize]");
    await click(h, '[data-council-thread-open="P2"]');
    await until(h, `!!document.querySelector("[data-council-thread] [data-council-post]")`);
    const post = await attr(h, "[data-council-thread] [data-council-post]", "data-council-post");

    await typeInto(h, `${THREAD_COMPOSER} [data-council-composer-input]`, FOLLOWUP_TEXT);
    const plain = await settledText(h, `${THREAD_COMPOSER} [data-council-composer-hint]`, /^1 expert answers · ≈ 1 call · ~\d+k tokens$/);

    await click(h, `${THREAD_COMPOSER} [data-council-tools]`);
    const reading = await settledText(h, `${THREAD_COMPOSER} [data-council-composer-hint]`, /reading code · ≈ 1 call · ~[\d.]+[kM] tokens$/);
    const on = await attr(h, `${THREAD_COMPOSER} [data-council-tools]`, "aria-checked");
    rec(
        "follow-up: Let them read code changes the cost label from `≈ 1 call` to one that says `reading code` with more tokens",
        !plain.includes("reading code") && reading.includes("reading code") && tokensIn(reading) > tokensIn(plain) && on === "true",
        `${plain}  →  ${reading}`
    );
    rec("follow-up: the outdated summary reads `Summarize again`", summarize === "Summarize again", summarize);

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
}

// ---- the room: two live agents seated beside two experts ----

// writes the room's agents as the cockpit's fixture roster once, for every room phase (it reloads the page, so no stub
// can be in place), and goes back to the Agent surface; teardown puts the previous roster back
async function withRoster(h, ctx) {
    if (ctx.roster == null) {
        ctx.roster = await writeRoomRoster(h);
        // the reload lands on Jarvis; the keys and the focus below are the Agent surface's
        await h.goto("agent");
    }
}

async function room(h, ctx, rec) {
    await withRoster(h, ctx);
    const id = await openFixture(h, ctx, "room");

    const chip = await settledText(h, "[data-council-chip]", "Round 2 of 2 · 1 draft waits for you");
    rec("room: the chip reads `Round 2 of 2 · 1 draft waits for you`", chip === "Round 2 of 2 · 1 draft waits for you", chip);

    await until(h, `!!document.querySelector("[data-council-channel]")`);
    const chips = await seatChips(h);
    const byId = Object.fromEntries(chips.map((c) => [c.id, c]));
    rec(
        "room: five seat chips; the agents read `agent · 625k` and `agent · 210k`, an expert `expert · sonnet`, Witness waits for its own task, Security has Retry, and an agent's chip opens its terminal",
        chips.length === 5 &&
            byId.witness?.text.includes("agent · 625k") &&
            byId.uxaudit?.text.includes("agent · 210k") &&
            byId.security?.text.includes("expert · sonnet") &&
            byId.witness.doing === "Waiting for Witness synthesis to finish its task" &&
            byId.witness.dot === "waiting" &&
            byId.security.retry === true &&
            byId.witness.open === "fx-room-witness" &&
            byId.uxaudit.open === "fx-room-uxaudit" &&
            byId.security.open === null,
        chips.map((c) => `${c.id}: ${c.text}`).join(" ; ")
    );

    const marks = await dividers(h);
    const ideas = await ideaIds(h);
    rec(
        "room: dividers `Round 1 · ideas` and `Round 2 · replies`, four ideas (the dropped P5 is gone), and the person's post to everyone as a `steers` message",
        marks.join("|") === "Round 1 · ideas|Round 2 · replies" &&
            ideas.join(",") === "P1,P2,P3,P4" &&
            (await attr(h, '[data-council-channel] [data-council-reply-post="r1"]', "data-item-label")) === "steers",
        { marks, ideas }
    );

    // the reply chips: P2's one reply (Skeptic builds on it), P1 only a reaction, P4's reply and its held draft
    const p2 = await h.ev(`(() => {
        const b = document.querySelector('[data-council-thread-open="P2"]');
        return b && { replies: b.getAttribute("data-replies"), repliers: [...b.querySelectorAll("[data-council-replier]")].map((a) => a.getAttribute("data-council-replier")), text: (b.textContent ?? "")${NORM} };
    })()`);
    const p1 = await h.ev(`(() => {
        const b = document.querySelector('[data-council-thread-open="P1"]');
        return b && { replies: b.getAttribute("data-replies"), text: (b.textContent ?? "")${NORM} };
    })()`);
    const p4 = await text(h, '[data-council-thread-open="P4"]');
    const agrees = await h.ev(`[...document.querySelectorAll('[data-council-idea="P1"] [data-council-reaction]')].map((e) => (e.textContent ?? "")${NORM})`);
    rec(
        "room: P2's chip reads `1 reply` with Skeptic's avatar and its last time, P1's `No replies yet` with a `Skeptic agrees` reaction, P4's names its waiting draft",
        p2?.replies === "1" &&
            p2.text.includes("1 reply") &&
            /Last reply \d+:\d\d/.test(p2.text) &&
            JSON.stringify(p2.repliers) === '["skeptic"]' &&
            p1?.replies === "0" &&
            p1.text.includes("No replies yet") &&
            agrees.join("|") === "Skeptic agrees" &&
            p4.includes("1 draft waits for you") &&
            !(await exists(h, '[data-council-channel] [data-council-draft="r4"]')),
        { p2, p1, p4, agrees }
    );

    const skip = await text(h, '[data-council-skip="witness"]');
    const skipButton = await text(h, "[data-council-open-terminal]");
    const typing = await typingLines(h);
    const failure = await text(h, '[data-council-channel] [data-council-failed="security"]');
    rec(
        "room: the skipped turn reads `Witness synthesis skipped round 1: still working on its own task after 10 min.` with Open its terminal, the typing rows name UX audit and Witness's wait, and Security's failure line has its error",
        skip.includes("Witness synthesis skipped round 1: still working on its own task after 10 min.") &&
            skipButton === "Open its terminal" &&
            typing.includes("UX audit is writing…") &&
            typing.includes("Waiting for Witness synthesis to finish its task") &&
            failure.includes("Security failed while replying") &&
            failure.includes("the reply was not valid JSON"),
        { skip, skipButton, typing, failure }
    );
    await h.shot("cdp-shots/council-discussion-room.png");

    // a failed seat's Retry, on its chip and on its failure line
    await stubRpc(h, ["CouncilRetryCommand"]);
    await click(h, '[data-council-chip-retry="security"]');
    await click(h, '[data-council-channel] [data-council-retry="security"]');
    await until(h, `(window.__arcCouncilStub?.calls ?? []).filter((c) => c.name === "CouncilRetryCommand").length >= 2`);
    const retries = await rpcCalls(h, "CouncilRetryCommand");
    rec(
        "room: Security's Retry, on its chip and on its failure line (stubbed), records CouncilRetryCommand with its expert id",
        retries.length === 2 && retries.every((c) => c.data?.id === id && c.data?.expertid === "security"),
        retries
    );
    await unstubRpc(h);

    // a thread opens with its replies, stance pills and the held reply draft
    await click(h, '[data-council-thread-open="P4"]');
    await until(h, `!!document.querySelector('[data-council-thread="P4"] [data-council-post="P4"]')`);
    const draft = await text(h, '[data-council-thread] [data-council-draft="r4"]');
    const replies = await threadReplies(h);
    const mine = replies.find((r) => r.id === "r5");
    const hint = await text(h, `${THREAD_COMPOSER} [data-council-composer-hint]`);
    rec(
        "room: P4's thread holds the person's @ to Witness, Skeptic's held `has doubts` challenge as a draft with its three buttons, the idea highlighted in the channel, and a reply box naming UX audit",
        replies.length === 1 &&
            mine?.mine === true &&
            mine.text.includes("For Witness synthesis") &&
            draft.includes("Waiting for you") &&
            draft.includes("has doubts") &&
            (await text(h, '[data-council-thread] [data-council-draft="r4"] [data-council-draft-send]')) === "Send to the others" &&
            (await text(h, '[data-council-thread] [data-council-draft="r4"] [data-council-draft-edit]')) === "Edit" &&
            (await text(h, '[data-council-thread] [data-council-draft="r4"] [data-council-draft-drop]')) === "Drop" &&
            (await attr(h, '[data-council-idea="P4"]', "data-open")) === "true" &&
            hint === "Answered by: UX audit",
        { replies, draft, hint }
    );
    await click(h, '[data-council-thread-open="P2"]');
    await until(h, `!!document.querySelector('[data-council-thread="P2"]')`);
    const builds = (await threadReplies(h)).find((r) => r.id === "r3");
    rec(
        "room: P2's thread shows Skeptic's reply as `builds on it`, marked edited",
        builds?.label === "builds on it" && builds.text.includes("edited"),
        builds
    );
    await h.shot("cdp-shots/council-discussion-room-thread.png");

    // Escape closes the thread from inside it, and the council stays open
    await focusOn(h, "[data-council-thread]");
    await pressEscape(h);
    const closed = await until(h, `!document.querySelector("[data-council-thread]")`);
    rec(
        "room: Esc, with focus in the thread, closes it (the open idea is null) and the council stays on screen",
        closed && (await h.ev(`window.__arcCouncil.openProposal(${sel(id)})`)) === null && (await exists(h, "[data-council-channel]")),
        closed
    );
}

// j and k over the ideas, Enter into a thread; they are the chat's only while focus is inside the channel or thread
async function roomKeys(h, ctx, rec) {
    await withRoster(h, ctx);
    // under its own id, so the chat mounts afresh with no cursor
    await openFixture(h, ctx, "room", { id: `${councilFixtureId("room")}-keys` });
    await until(h, `!!document.querySelector("[data-council-channel]")`);

    // focus outside the channel: j moves nothing
    await h.ev(`document.activeElement?.blur()`);
    await pressJ(h);
    const idle = await focusedIdea(h);

    await focusOn(h, "[data-council-channel]");
    const seen = [];
    for (const press of [pressJ, pressJ, pressK, pressJ, pressJ, pressJ, pressJ]) {
        await press(h);
        seen.push(await focusedIdea(h));
    }
    rec(
        "keys: j moves nothing with focus outside the channel; in it j / k move over the ideas (P1, P2, P1, P2, P3, P4) and stop at the last",
        idle === null && seen.join(",") === "P1,P2,P1,P2,P3,P4,P4",
        { idle, seen }
    );

    await pressEnter(h);
    const opened = await until(h, `!!document.querySelector('[data-council-thread="P4"]')`);
    rec(
        "keys: Enter opens the thread of the idea under the cursor (P4)",
        opened && (await attr(h, '[data-council-idea="P4"]', "data-open")) === "true",
        opened
    );
    await pressEscape(h);
    const closed = await until(h, `!document.querySelector("[data-council-thread]")`);
    await pressK(h);
    rec(
        "keys: Esc closes it, and k moves the cursor again (to P3)",
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

    const input = `${CHANNEL_COMPOSER} [data-council-composer-input]`;
    await typeInto(h, input, FOLLOWUP_TEXT);
    const everyone = await settledText(h, `${CHANNEL_COMPOSER} [data-council-composer-hint]`, /Everyone answers/);
    await click(h, `${CHANNEL_COMPOSER} [data-council-composer-send]`);
    await until(h, `(window.__arcCouncilStub?.calls ?? []).filter((c) => c.name === "CouncilReplyCommand").length >= 1`);
    const first = (await rpcCalls(h, "CouncilReplyCommand"))[0]?.data;
    rec(
        "composer: a message to the box posts to everyone (`Everyone answers`): CouncilReplyCommand (stubbed) carries its text and no idea",
        everyone === "Everyone answers" &&
            first?.id === id &&
            first.text === FOLLOWUP_TEXT &&
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

// a click on an agent's chip and on Open its terminal each land on that agent's terminal
async function roomTerminals(h, ctx, rec) {
    await withRoster(h, ctx);
    const terminalOf = (tab) =>
        until(
            h,
            `(() => { const p = document.querySelector('[data-agent-terminal="${tab}"]'); return p != null && !p.classList.contains("hidden") && !document.querySelector("[data-council-discussion]"); })()`
        );

    await openFixture(h, ctx, "room");
    await until(h, `!!document.querySelector('[data-council-chip-open="fx-room-witness"]')`);
    await click(h, '[data-council-chip-open="fx-room-witness"]');
    const viaChip = await terminalOf("fx-room-witness");
    rec("room: a click on Witness synthesis's chip lands on its terminal", viaChip, viaChip);

    await openFixture(h, ctx, "room");
    await until(h, `!!document.querySelector('[data-council-open-terminal="fx-room-witness"]')`);
    await click(h, '[data-council-open-terminal="fx-room-witness"]');
    const viaSkip = await terminalOf("fx-room-witness");
    rec("room: Open its terminal on Witness synthesis's skipped line lands on its terminal", viaSkip, viaSkip);
}

// two held ideas: the chat shows, with no pause and no Continue, and Send to the others, Edit and Drop each call the draft command
const EDITED = "Bind to 127.0.0.1 and ::1 only, and say so in the pin dialog.";

async function roomAwaiting(h, ctx, rec) {
    await withRoster(h, ctx);
    const id = await openFixture(h, ctx, "room-awaiting");

    const chip = await settledText(h, "[data-council-chip]", "Round 1 of 2 · 2 drafts wait for you");
    await until(h, `!!document.querySelector("[data-council-channel]")`);
    rec(
        "room waiting on drafts: the chat is shown with no pause panel and no Continue, and the chip reads `Round 1 of 2 · 2 drafts wait for you`",
        chip === "Round 1 of 2 · 2 drafts wait for you" &&
            (await attr(h, "[data-council-discussion]", "data-council-state")) === "awaiting-you" &&
            !(await exists(h, "[data-council-pause]")) &&
            !(await exists(h, "[data-council-continue]")),
        chip
    );

    const drafts = await h.ev(`[...document.querySelectorAll("[data-council-channel] [data-council-draft]")].map((d) => ({
        id: d.getAttribute("data-council-draft"),
        of: d.getAttribute("data-draft-of"),
        label: d.getAttribute("aria-label"),
        text: (d.textContent ?? "")${NORM},
        buttons: [...d.querySelectorAll("button")].map((b) => (b.textContent ?? "")${NORM}),
        tint: getComputedStyle(d).backgroundColor,
    }))`);
    rec(
        "room waiting on drafts: the two held ideas (P2, P3) are amber drafts marked `Waiting for you`, each with Send to the others, Edit and Drop, and the sent P1 is a plain message",
        drafts.map((d) => d.id).join(",") === "P2,P3" &&
            drafts.every(
                (d) =>
                    d.of === "idea" &&
                    d.label === "Draft waiting for you" &&
                    d.text.includes("Waiting for you") &&
                    d.buttons.join("|") === "Send to the others|Edit|Drop" &&
                    d.tint !== "rgba(0, 0, 0, 0)"
            ) &&
            (await ideaIds(h)).join(",") === "P1",
        drafts.map((d) => `${d.id}: ${d.buttons.join("/")} ${d.tint}`).join(" ; ")
    );
    await h.shot("cdp-shots/council-discussion-room-awaiting.png");

    // a sent idea is something to summarize: the held drafts around it do not switch Summarize off
    const withSent = await h.ev(`document.querySelector("[data-council-summarize]")?.disabled === false`);
    rec("room waiting on drafts: with the sent P1 among the drafts, Summarize is enabled", withSent, `enabled: ${withSent}`);

    await stubRpc(h, ["CouncilDraftCommand"]);
    const calls = () => rpcCalls(h, "CouncilDraftCommand");
    await click(h, '[data-council-draft="P2"] [data-council-draft-send]');
    await until(h, `(window.__arcCouncilStub?.calls ?? []).filter((c) => c.name === "CouncilDraftCommand").length >= 1`);

    await click(h, '[data-council-draft="P3"] [data-council-draft-edit]');
    await until(h, `!!document.querySelector('[data-council-draft="P3"] [data-council-draft-input]')`);
    const prefilled = await h.ev(`document.querySelector('[data-council-draft="P3"] [data-council-draft-input]')?.value ?? null`);
    await typeInto(h, '[data-council-draft="P3"] [data-council-draft-input]', EDITED);
    await click(h, '[data-council-draft="P3"] [data-council-draft-save]');
    await until(h, `(window.__arcCouncilStub?.calls ?? []).filter((c) => c.name === "CouncilDraftCommand").length >= 2`);

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

// ---- the hooks ----

const PHASES = [
    ["round 2", round2],
    ["picks", picks],
    ["brainstorm", brainstorm],
    ["queued", queued],
    ["round 1", round1],
    ["paused", awaiting],
    ["stopped", stopped],
    ["failed", failed],
    ["not run", notRun],
    ["done", done],
    ["room", room],
    ["room keys", roomKeys],
    ["room composer", roomComposer],
    ["room waiting on drafts", roomAwaiting],
    ["room terminals", roomTerminals],
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
