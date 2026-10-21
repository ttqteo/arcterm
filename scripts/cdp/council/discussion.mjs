// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0
//
// council-discussion (docs/superpowers/plans/2026-10-21-council.md, Task 14): the Discussion in round 2 (the thread, the
// avatars, the proposals column, a real reply, Summarize off while the round runs), round 1 (the experts' cards and the
// call bar), at the pause (the ticks, Ask the experts, Continue), stopped at the pause (Summarize), failed (Retry on an
// expert and on the coordinator), not run (Start council) and as a follow-up on a done council (the cost label with Let
// them read code). Each phase seeds its own fixture council and takes its own shot.
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

const tokensIn = (label) => {
    const m = /~([\d.]+)([kM])/.exec(label ?? "");
    return m ? Number(m[1]) * (m[2] === "M" ? 1_000_000 : 1000) : NaN;
};

// ---- round 2: the thread ----

const REPLY_TEXT = 'Would a "Waking…" label on the rail icon be enough?';

async function round2(h, ctx, rec) {
    await openFixture(h, ctx, "round2");

    const chip = await settledText(h, "[data-council-chip]", "Round 2 of 3 · 2 replying");
    rec("round 2: the header chip reads `Round 2 of 3 · 2 replying`", chip === "Round 2 of 3 · 2 replying", chip);

    const avatars = await h.ev(`({
        all: document.querySelectorAll("[data-council-avatar]").length,
        lit: document.querySelectorAll('[data-council-avatar][data-lit="true"]').length,
        skeptic: document.querySelector('[data-council-avatar="skeptic"]')?.getAttribute("title") ?? null,
    })`);
    rec(
        "round 2: five avatars, two lit, Skeptic's hover reads `Skeptic: Replying to UX on P2`",
        avatars.all === 5 && avatars.lit === 2 && avatars.skeptic === "Skeptic: Replying to UX on P2",
        avatars
    );

    const cost = await text(h, "[data-council-cost]");
    rec("round 2: the cost line reads `m:ss · N replies · X.XXM tokens`", /\d+:\d\d · \d+ replies · [\d.]+M tokens/.test(cost), cost);

    const col = await h.ev(`[...document.querySelectorAll("[data-council-proposal]")].map((e) => ({
        id: e.getAttribute("data-council-proposal"),
        selected: e.getAttribute("data-selected") === "true",
        withdrawn: e.getAttribute("data-withdrawn") === "true",
    }))`);
    rec(
        "round 2: the proposals column lists six, the top-ranked open, the withdrawn P6 last",
        col.length === 6 && col[0].selected && col.slice(0, 5).every((p) => !p.withdrawn) && col[5].id === "P6" && col[5].withdrawn,
        col.map((p) => p.id + (p.selected ? "*" : "") + (p.withdrawn ? "(w)" : "")).join(" ")
    );

    await click(h, '[data-council-proposal="P2"]');
    await until(h, `!!document.querySelector('[data-council-post="P2"]')`);
    const title = await text(h, "[data-council-post-title]");
    rec("round 2: opening P2 shows its post, `Keep the last-used pinned app awake`", title === "Keep the last-used pinned app awake", title);

    const nodes = await h.ev(`[...document.querySelectorAll("[data-council-node]")].map((n) => ({
        key: n.getAttribute("data-council-node"),
        kind: n.getAttribute("data-node-kind"),
        depth: Number(n.getAttribute("data-node-depth")),
    }))`);
    const typing = await text(h, "[data-council-typing]");
    rec(
        "round 2: the thread nests to depth 2, and a typing row reads `Skeptic is writing a reply…`",
        nodes.some((n) => n.depth === 2) && typing === "Skeptic is writing a reply…",
        `${nodes.map((n) => `${n.depth}${n.kind === "typing" ? "t" : ""}:${n.key}`).join(" ")} | ${typing}`
    );

    const mine = await text(h, '[data-council-node="r18"]');
    rec("round 2: the person's reply is labelled `Answered after the summary`", mine.includes("Answered after the summary"), mine);

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
        `[...document.querySelectorAll('[data-council-node][data-node-mine="true"]')].some((n) => n.textContent.includes(${sel(REPLY_TEXT)}))`,
        15_000
    );
    const placed = await h.ev(`(() => {
        const nodes = [...document.querySelectorAll("[data-council-node]")];
        const i = nodes.findIndex((n) => n.getAttribute("data-node-mine") === "true" && n.textContent.includes(${sel(REPLY_TEXT)}));
        if (i < 0) return null;
        const depth = Number(nodes[i].getAttribute("data-node-depth"));
        let parent = null;
        for (let j = i - 1; j >= 0; j--) {
            if (Number(nodes[j].getAttribute("data-node-depth")) === depth - 1) { parent = nodes[j].getAttribute("data-council-node"); break; }
        }
        return { depth, parent, label: nodes[i].textContent.includes("Answered after the summary") };
    })()`);
    const closed = !(await exists(h, "[data-council-composer]"));
    rec(
        "round 2: sending posts it for real, in the branch it answered (under r17, depth 2), labelled, and the composer closes",
        posted && closed && placed?.parent === "r17" && placed.depth === 2 && placed.label === true,
        placed
    );

    // Summarize: the runner refuses a running council (the synthesis comes by itself when round 2 ends), so it is off
    const summarize = await h.ev(`(() => {
        const b = document.querySelector("[data-council-summarize]");
        return b ? { disabled: b.disabled === true, title: b.getAttribute("title") } : null;
    })()`);
    rec(
        "round 2: Summarize is disabled, and its title says the summary comes by itself when round 2 ends",
        summarize?.disabled === true && summarize.title === "The summary comes by itself when round 2 ends",
        summarize
    );
}

// ---- round 1: the experts' cards ----

async function round1(h, ctx, rec) {
    await openFixture(h, ctx, "round1");
    await settledText(h, "[data-council-chip]", /^Round 1 of 3/);

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
    rec(
        "round 1: `Proposals so far` lists P1, P2, P4, and Summarize is disabled",
        arrived.join(",") === "P1,P2,P4" && summarizeOff,
        `${arrived.join(",")} | summarize disabled: ${summarizeOff}`
    );
    await h.shot("cdp-shots/council-discussion-round1.png");
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
        "paused: the chip reads `Waiting on you`, with six proposals all ticked",
        chip === "Waiting on you" && rows.length === 6 && rows.every((r) => r.kept && r.tick),
        `${chip} | ${rows.map((r) => r.id).join(",")}`
    );

    await click(h, '[data-council-pause-row="P6"] input');
    await until(h, `document.querySelector('[data-council-pause-row="P6"]')?.getAttribute("data-kept") === "false"`);
    const struck = await h.ev(
        `getComputedStyle(document.querySelector('[data-council-pause-row="P6"] [data-council-pause-title]')).textDecorationLine`
    );
    rec("paused: unticking P6 strikes it", struck === "line-through", struck);

    await typeInto(h, "[data-council-pause-ask]", PAUSE_QUESTION);
    const asked = await h.ev(`document.querySelector("[data-council-pause-ask]")?.value ?? null`);
    const remaining = await settledText(h, "[data-council-remaining]", /Rounds 2 and 3/);
    const stopHere = await text(h, "[data-council-stop-here]");
    rec(
        "paused: the question box takes a question, the line reads `Rounds 2 and 3: ≈ 5 calls · ~0.3M tokens`, Stop here is offered",
        asked === PAUSE_QUESTION && remaining === "Rounds 2 and 3: ≈ 5 calls · ~0.3M tokens" && stopHere === "Stop here and keep round 1",
        `${remaining} | ${stopHere}`
    );
    await h.shot("cdp-shots/council-discussion-paused.png");

    await stubRpc(h, ["CouncilContinueCommand"]);
    await click(h, "[data-council-continue]");
    await until(h, `(window.__arcCouncilStub?.calls ?? []).some((c) => c.name === "CouncilContinueCommand")`);
    const calls = await rpcCalls(h, "CouncilContinueCommand");
    const data = calls[0]?.data;
    rec(
        "paused: Continue to round 2 (stubbed) records CouncilContinueCommand with cut [P6] and the question",
        calls.length === 1 && data?.id === id && JSON.stringify(data?.cut) === '["P6"]' && data?.question === PAUSE_QUESTION,
        calls
    );
}

// ---- stopped at the pause ----

// "Stop here and keep round 1" leaves the paused council stopped at round 1 with no summary: the runner summarizes it, so
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
        "stopped at round 1: the chip reads `Stopped` and Summarize is enabled",
        chip === "Stopped" && label === "Summarize" && on,
        `${chip} | ${label} | enabled: ${on}`
    );

    // no summary yet, so it asks for one (stubbed) and opens the Summary
    await stubRpc(h, ["CouncilSummarizeCommand"]);
    await click(h, "[data-council-summarize]");
    const opened = await until(h, `!!document.querySelector("[data-council-summary]")`);
    const calls = await rpcCalls(h, "CouncilSummarizeCommand");
    rec(
        "stopped at round 1: Summarize (stubbed) records one CouncilSummarizeCommand and opens the Summary",
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
