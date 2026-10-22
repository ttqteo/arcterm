// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0
//
// council-discussion (docs/superpowers/plans/2026-10-21-council.md, Task 14; the plain words and the picks:
// 2026-10-22-council-v1-ui.md, Task 3; the group chat, Brainstorm and the queue: 2026-10-22-council-v1-room.md, Task 4):
// the Discussion while the experts argue (the feed with its step bar, expert chips, labelled messages and typing row, the
// ideas column that narrows it, a real reply, Summarize off while they do), on a council whose experts gave their picks
// (ranked by them, the unpicked folded, agreement a reaction, no id in the column), as a Brainstorm (its steps and
// labels), queued (one line), while they first propose (the experts' cards and the call bar), at the pause (the ticks,
// Ask the experts, Continue), stopped at the pause (Summarize), failed (Retry on an expert and on the coordinator), not
// run (Start council) and as a follow-up on a done council (the thread, the cost label with Let them read code). Each
// phase seeds its own fixture council and takes its own shot.
//
// The hooks are called by councilscenarios.mjs as arrange(h, fx), assert(h, ctx, fx), teardown(h, ctx, fx). Nothing here
// spends a token or starts an agent: Summarize (on the stopped council), Continue, Retry, Start council and the
// follow-up's send are clicked with their RpcApi command replaced in the page (fixtures.mjs stubRpc) and the call read
// back with rpcCalls. The one real write is the round 2 reply: that council is `running` on disk with no run behind it,
// so wavesrv only stores the reply. The estimate is a real RPC, but it prices and calls no model.

import { waitFor } from "../attach.mjs";
import {
    arrangeCouncilProject,
    councilFixtureId,
    openCouncil,
    rpcCalls,
    seedCouncil,
    stubRpc,
    teardownCouncilProject,
    unstubRpc,
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

// the visible words the person reads: none of them is the word `round` (a step is "Step 2 of 3", an argument "argue")
const noRound = async (h, root) => {
    const t = await text(h, root);
    return { ok: t !== "" && !/\brounds?\b/i.test(t), found: /.{0,30}\brounds?\b.{0,30}/i.exec(t)?.[0] ?? null };
};

const tokensIn = (label) => {
    const m = /~([\d.]+)([kM])/.exec(label ?? "");
    return m ? Number(m[1]) * (m[2] === "M" ? 1_000_000 : 1000) : NaN;
};

// ---- the experts argue: the feed ----

const REPLY_TEXT = 'Would a "Waking…" label on the rail icon be enough?';
const P2_TITLE = "Keep the last-used pinned app awake";

// the messages of the feed as they are drawn: its hooks, never its words
const feedMessages = (h) =>
    h.ev(`[...document.querySelectorAll('[data-feed-kind="message"]')].map((m) => ({
        id: m.getAttribute("data-feed-id"),
        label: m.getAttribute("data-feed-label"),
        on: m.getAttribute("data-feed-on"),
        mine: m.getAttribute("data-feed-mine") === "true",
        text: (m.textContent ?? "")${NORM},
    }))`);

const stepBar = (h) =>
    h.ev(`({
        words: [...document.querySelectorAll("[data-council-step]")].map((e) => (e.textContent ?? "")${NORM}),
        current: (document.querySelector('[data-council-step][data-current="true"]')?.textContent ?? "")${NORM},
    })`);

async function round2(h, ctx, rec) {
    await openFixture(h, ctx, "round2");

    const chip = await settledText(h, "[data-council-chip]", "Step 2 of 3 · 2 replying");
    rec("round 2: the header chip reads `Step 2 of 3 · 2 replying`", chip === "Step 2 of 3 · 2 replying", chip);

    await until(h, `!!document.querySelector("[data-council-feed]")`);
    const steps = await stepBar(h);
    const nothing = await text(h, "[data-council-nothing]");
    rec(
        "round 2: the step bar names the three steps with the second, `Argue`, marked, and a line says there is nothing to do now",
        steps.words.join("|") === "Read and propose|Argue|Write the answer" &&
            steps.current === "Argue" &&
            nothing === "Nothing to do now. The answer opens here when it finishes; you can leave.",
        { steps, nothing }
    );

    const mode = await text(h, "[data-council-mode]");
    rec("round 2: the mode chip reads `Review`", mode === "Review", mode);

    const chips = await h.ev(`({
        all: document.querySelectorAll("[data-council-expert-chip]").length,
        lit: document.querySelectorAll('[data-council-expert-chip][data-lit="true"]').length,
        skeptic: document.querySelector('[data-council-expert-chip="skeptic"]')?.getAttribute("title") ?? null,
        avatars: document.querySelectorAll("[data-council-avatar]").length,
    })`);
    rec(
        "round 2: five expert chips replace the header's avatars, two lit, Skeptic's title reads `Skeptic: Replying to UX`",
        chips.all === 5 && chips.lit === 2 && chips.skeptic === "Skeptic: Replying to UX" && chips.avatars === 0,
        chips
    );

    const cost = await text(h, "[data-council-cost]");
    rec("round 2: the cost line reads `m:ss · N replies · X.XXM tokens`", /\d+:\d\d · \d+ replies · [\d.]+M tokens/.test(cost), cost);

    const col = await h.ev(`[...document.querySelectorAll("[data-council-proposal]")].map((e) => ({
        id: e.getAttribute("data-council-proposal"),
        selected: e.getAttribute("data-selected") === "true",
        withdrawn: e.getAttribute("data-withdrawn") === "true",
    }))`);
    rec(
        "round 2: the ideas column lists six, none narrowing the feed, the withdrawn P6 last (no picks: ranked by score as before)",
        col.length === 6 && col.every((p) => !p.selected) && col.slice(0, 5).every((p) => !p.withdrawn) && col[5].id === "P6" && col[5].withdrawn,
        col.map((p) => p.id + (p.selected ? "*" : "") + (p.withdrawn ? "(w)" : "")).join(" ")
    );

    const all = await feedMessages(h);
    const goal = all.find((m) => m.label === "sets the goal");
    const system = await h.ev(`[...document.querySelectorAll('[data-feed-kind="system"]')].map((e) => (e.textContent ?? "")${NORM})`);
    rec(
        "round 2: the feed opens with the question as `sets the goal`, and a line marks where they start to argue",
        all[0] === goal &&
            goal?.mine === true &&
            goal.text.includes("Which changes to pinned apps on the nav rail are worth making first?") &&
            system.some((t) => t.includes("now they argue")),
        { first: all[0]?.label, system }
    );

    const doubts = all.find((m) => m.label === "has doubts" && m.on != null && m.on !== "");
    const typing = await h.ev(`[...document.querySelectorAll("[data-council-typing]")].map((e) => (e.textContent ?? "")${NORM})`);
    rec(
        "round 2: a message labelled `has doubts` names the idea it is on, and a typing row reads `Skeptic is writing…`",
        doubts != null && typing.includes("Skeptic is writing…"),
        { doubts: doubts?.on, typing }
    );

    const words = await noRound(h, rootOf(await attr(h, "[data-council-discussion]", "data-council-discussion")));
    rec("round 2: no visible text holds the word `round`", words.ok, words.found);

    // a click on P2 in the ideas column narrows the feed to P2's message and what was said on it
    await click(h, '[data-council-proposal="P2"]');
    await until(h, `document.querySelector('[data-council-proposal="P2"]')?.getAttribute("data-selected") === "true"`);
    const narrowed = await feedMessages(h);
    const others = narrowed.filter((m) => m.id !== "P2");
    rec(
        "round 2: opening P2 narrows the feed to its message, and every other message is on `Keep the last-used pinned app awake`",
        narrowed.some((m) => m.id === "P2" && m.on === null) &&
            others.length > 0 &&
            others.every((m) => m.on === P2_TITLE) &&
            narrowed.length < all.length,
        `${all.length} → ${narrowed.length}: ${narrowed.map((m) => m.id).join(",")}`
    );

    // Reply on New user's answer (r17): the proposal's author and the experts on the path to it answer
    await click(h, '[data-council-reply="r17"]');
    const composerShown = await until(h, `!!document.querySelector('[data-composer-for="P2:r17"]')`);
    const hint = await settledText(h, "[data-council-composer-hint]", /answer it/);
    rec(
        "round 2: Reply opens the composer and names who answers",
        composerShown && hint === "UX, RAM and New user answer it after the summary",
        hint
    );

    await typeInto(h, "[data-council-composer-input]", REPLY_TEXT);
    await until(h, `!document.querySelector("[data-council-composer-send]")?.disabled`);
    await h.shot("cdp-shots/council-discussion-round2.png");

    // a real reply: the council is running on disk with nothing behind it, so wavesrv stores it and calls no model
    await click(h, "[data-council-composer-send]");
    const posted = await until(
        h,
        `[...document.querySelectorAll("[data-feed-mine]")].some((n) => n.textContent.includes(${sel(REPLY_TEXT)}))`,
        15_000
    );
    const placed = (await feedMessages(h)).find((m) => m.mine && m.text.includes(REPLY_TEXT));
    const closed = !(await exists(h, "[data-council-composer]"));
    rec(
        "round 2: sending posts it for real, as a message of the person's on P2 that `replies`, and the composer closes",
        posted && closed && placed?.on === P2_TITLE && placed.label === "replies",
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

// ---- the experts' picks: ranking, the fold, reactions ----

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
    await until(h, `!!document.querySelector("[data-council-folded]")`);

    const column = await text(h, "[data-council-proposals]");
    rec("picks: the ideas column shows no proposal id", !/\bP\d+\b/.test(column), column);

    const shown = await h.ev(`[...document.querySelectorAll("[data-council-proposal]")].map((e) => e.getAttribute("data-council-proposal"))`);
    const folded = await text(h, "[data-council-folded]");
    rec(
        "picks: P2 ranks first, P1 second, and the other four fold under `4 more with no picks`",
        shown.join(",") === "P2,P1" && folded === "4 more with no picks",
        `${shown.join(",")} | ${folded}`
    );

    const up = await h.ev(`({
        title: document.querySelector('[data-council-proposal="P2"] [data-council-proposal-score]')?.parentElement?.getAttribute("title") ?? null,
        row: document.querySelector('[data-council-proposal="P2"] [data-council-proposal-score]')?.textContent ?? null,
    })`);
    rec(
        "picks: P2's ↑ in the column reads 2 and its title `Picked by 2 of 4 experts`",
        up.title === "Picked by 2 of 4 experts" && up.row === "2",
        up
    );

    const reaction = await h.ev(`[...document.querySelectorAll("[data-council-reaction]")].map((e) => ({
        text: (e.textContent ?? "")${NORM},
        under: e.closest("[data-feed-id]")?.getAttribute("data-feed-id") ?? null,
    }))`);
    const hidden = !(await exists(h, '[data-feed-id="r17"]'));
    rec(
        "picks: New user's blank accept is a `New user agrees` reaction under P2's message, with no message of its own",
        reaction.length === 1 && reaction[0].text === "New user agrees" && reaction[0].under === "P2" && hidden,
        `${JSON.stringify(reaction)} | message hidden: ${hidden}`
    );

    await click(h, "[data-council-folded]");
    await until(h, `document.querySelectorAll("[data-council-proposal]").length === 6`);
    const all = await h.ev(`[...document.querySelectorAll("[data-council-proposal]")].map((e) => e.getAttribute("data-council-proposal"))`);
    const expanded = await attr(h, "[data-council-folded]", "aria-expanded");
    const unfoldedColumn = await text(h, "[data-council-proposals]");
    rec(
        "picks: the fold unfolds to all six, P2 still first, still with no id in the text",
        all.length === 6 && all[0] === "P2" && all[1] === "P1" && expanded === "true" && !/\bP\d+\b/.test(unfoldedColumn),
        `${all.join(",")} | ${expanded}`
    );
    await h.shot("cdp-shots/council-discussion-picks.png");
}

// ---- Brainstorm: its steps, its labels ----

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

    const steps = await stepBar(h);
    rec(
        "brainstorm: the step bar names `Ideas`, `Build on each other` and `Pick the best`, with the second marked",
        steps.words.join("|") === "Ideas|Build on each other|Pick the best" && steps.current === "Build on each other",
        steps
    );

    const mode = await text(h, "[data-council-mode]");
    rec("brainstorm: the mode chip reads `Brainstorm`", mode === "Brainstorm", mode);

    const messages = await feedMessages(h);
    const labels = new Set(messages.map((m) => m.label));
    const system = await h.ev(`[...document.querySelectorAll('[data-feed-kind="system"]')].map((e) => (e.textContent ?? "")${NORM})`);
    rec(
        "brainstorm: the labels are `idea`, `wild idea` and `builds on it`, never `proposes`, and a line marks where they build on each other",
        labels.has("idea") &&
            labels.has("wild idea") &&
            labels.has("builds on it") &&
            !labels.has("proposes") &&
            system.some((t) => t.includes("now they build on each other")),
        { labels: [...labels], system }
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
    const line = await text(h, "[data-council-queued]");
    const body = await h.ev(`({
        cards: document.querySelectorAll("[data-council-expert-card]").length,
        feed: document.querySelectorAll("[data-council-feed], [data-council-feed-item]").length,
        bar: document.querySelectorAll("[data-council-calls], [data-council-steps]").length,
        stop: document.querySelectorAll("[data-council-stop]").length,
        mode: (document.querySelector("[data-council-mode]")?.textContent ?? "")${NORM},
    })`);
    rec(
        "queued: the chip reads `Queued` and the body is the one line `Queued: it starts when the running council ends.`",
        chip === "Queued" &&
            line === "Queued: it starts when the running council ends." &&
            body.cards === 0 &&
            body.feed === 0 &&
            body.bar === 0 &&
            body.stop === 0 &&
            body.mode === "Review",
        { chip, line, body }
    );
    await h.shot("cdp-shots/council-discussion-queued.png");
}

// ---- round 1: the experts' cards ----

async function round1(h, ctx, rec) {
    await openFixture(h, ctx, "round1");
    await settledText(h, "[data-council-chip]", /^Step 1 of 3/);

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
        "round 1: `Ideas so far` lists three ideas (ids in the hooks, none in the text), and Summarize is disabled",
        arrived.join(",") === "P1,P2,P4" && summarizeOff && heading && !/\bP\d+\b/.test(arrivedText),
        `${arrived.join(",")} | summarize disabled: ${summarizeOff} | ${arrivedText}`
    );
    const words = await noRound(h, "[data-council-discussion]");
    rec("round 1: no visible text holds the word `round`", words.ok, words.found);
    await h.shot("cdp-shots/council-discussion-round1.png");

    // no idea yet: the empty state
    await openFixture(h, ctx, "round1", {
        id: `${councilFixtureId("round1")}-empty`,
        edit: (c) => void (c.proposals = []),
    });
    const empty = await settledText(h, "[data-council-discussion] [data-council-expert-card] ~ div", /No ideas yet\./).catch(() => "");
    const body = await text(h, "[data-council-discussion]");
    const emptyWords = await noRound(h, "[data-council-discussion]");
    rec(
        "round 1: with no idea yet the body reads `No ideas yet.` and holds no `round`",
        body.includes("No ideas yet.") && emptyWords.ok,
        `${empty} | ${emptyWords.found}`
    );
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
    const pauseWords = await noRound(h, "[data-council-pause]");
    const continueText = await text(h, "[data-council-continue]");
    rec(
        "paused: the panel reads `Ideas so far` and `Continue: let them argue`, with no proposal id and no `round`",
        pauseText.includes("Ideas so far") && continueText === "Continue: let them argue" && !/\bP\d+\b/.test(pauseText) && pauseWords.ok,
        `${continueText} | ${pauseWords.found}`
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
        "failed: Skeptic's card shows its error with Retry",
        skeptic.includes("claude -p timed out after 10 minutes") && hasSkepticRetry,
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

// ---- a follow-up on a done council ----

const FOLLOWUP_TEXT = "Does this hold on a Mac?";

async function followUp(h, ctx, rec) {
    const id = await openFixture(h, ctx, "done");
    await settledText(h, "[data-council-chip]", "Done");
    const summarize = await text(h, "[data-council-summarize]");
    const post = await attr(h, "[data-council-post]", "data-council-post");

    await click(h, '[data-council-reply="post"]');
    await until(h, `!!document.querySelector("[data-council-composer]")`);
    const plain = await settledText(h, "[data-council-composer-hint]", /^1 expert answers · ≈ 1 call · ~\d+k tokens$/);

    await click(h, "[data-council-tools]");
    const reading = await settledText(h, "[data-council-composer-hint]", /reading code · ≈ 1 call · ~[\d.]+[kM] tokens$/);
    const on = await attr(h, "[data-council-tools]", "aria-checked");
    rec(
        "follow-up: Let them read code changes the cost label from `≈ 1 call` to one that says `reading code` with more tokens",
        !plain.includes("reading code") && reading.includes("reading code") && tokensIn(reading) > tokensIn(plain) && on === "true",
        `${plain}  →  ${reading}`
    );
    rec("follow-up: the outdated summary reads `Summarize again`", summarize === "Summarize again", summarize);

    await stubRpc(h, ["CouncilReplyCommand"]);
    await typeInto(h, "[data-council-composer-input]", FOLLOWUP_TEXT);
    await until(h, `!document.querySelector("[data-council-composer-send]")?.disabled`);
    await h.shot("cdp-shots/council-discussion-followup.png");
    await click(h, "[data-council-composer-send]");
    await until(h, `(window.__arcCouncilStub?.calls ?? []).some((c) => c.name === "CouncilReplyCommand")`);
    const calls = await rpcCalls(h, "CouncilReplyCommand");
    const data = calls[0]?.data;
    rec(
        "follow-up: the send (stubbed) records CouncilReplyCommand with tools: true",
        calls.length === 1 && data?.id === id && data?.proposalid === post && data?.text === FOLLOWUP_TEXT && data?.tools === true,
        calls
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
    ["follow-up", followUp],
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
        await teardownCouncilProject(h, ctx);
    },
};
