// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0
//
// council-routing (docs/superpowers/plans/2026-11-03-council-reply-routing.md, Tasks 5 and 6; the spec is
// docs/superpowers/specs/2026-11-03-council-reply-routing-design.md): a council whose whole-council messages the router
// takes. A plain message to the channel is no longer sent to every seat: the router picks the seat or two that answer it.
// Task 5, the composer: the Read files switch is the three-way Auto · On · Off control (Auto lets the router decide), the
// line under the box says `Router picks 1–2 seats · ≈ 2–3 calls · ~35k–235k tokens` (a range: the router has not chosen
// yet), and `@all` asks every seat on purpose (an All seats row, first in the `@` list). Task 6, the Discussion: the
// person's routed post opens on a chip row naming the seats the router chose (never Everyone), or that it failed or is
// choosing, its hover the router's line (`Router chose UX: …`, `· reading files`, `Router failed, UX answered`); an answer
// that is not right under its post opens on a quote of it, which jumps to it; an `@RAM` in the person's text is RAM's
// chip; and one `Ask RAM too` chip per seat that was not asked, under the last answer.
//
// The hooks are called by councilscenarios.mjs as arrange(h, fx), assert(h, ctx, fx), teardown(h, ctx, fx). Nothing here
// spends a token or starts an agent: CouncilReplyCommand and CouncilAskTooCommand are replaced in the page (fixtures.mjs
// stubRpc) and read back with rpcCalls, and CouncilEstimateCommand is replaced by an answer of its own (answerEstimates
// below) that prices a message the way wavesrv does, a range for a routed one. The councils are this file's own data: each
// is a fixture council (`done`, `awaiting`) whose seats, ideas, replies and summary `routingCouncil` replaces with three
// role seats, written with seedCouncil's `edit`; the routed messages of Task 6 are added to a done one by `routedCouncil`.
// Each phase seeds a council of its own, so its message-box draft is its own.

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

const shortened = (x) => (typeof x === "string" ? x : JSON.stringify(x));

const CHANNEL = '[data-council-composer="channel"]';
const INPUT = `${CHANNEL} [data-council-composer-input]`;
const HINT = `${CHANNEL} [data-council-composer-hint]`;
const SEND = `${CHANNEL} [data-council-composer-send]`;
const TOOLS = `${CHANNEL} [data-council-tools]`;

// ---- the councils ----

// three role seats and the coordinator: a whole-council message has three seats to choose from
const SEATS = [
    {
        id: "ux",
        name: "UX",
        model: "sonnet",
        brief: "You review the feature as the UX expert. Ask whether someone can find, read and use it without being told how.",
    },
    {
        id: "ram",
        name: "RAM",
        model: "sonnet",
        brief: "You review the feature as the RAM expert. Ask what it keeps in memory, for how long, and what it costs when it is idle.",
    },
    {
        id: "docs",
        name: "Docs",
        model: "sonnet",
        brief: "You review the feature as the docs expert. Ask what a person has to be told and where they would look for it.",
    },
    {
        id: "coordinator",
        name: "Coordinator",
        model: "opus",
        coordinator: true,
        brief: "You are the coordinator. Merge the proposals that say the same thing and rank the directions that remain.",
    },
];

const MINUTE = 60_000;

// the fixture council `c` (already placed on the clock) with this file's seats, ideas and replies; the done one also holds
// the summary. Times run from `c.started`, so the replies come before the summary and the summary before the last save.
function routingCouncil(c, state) {
    const t = c.started;
    c.feature = "Rail apps";
    c.experts = structuredClone(SEATS);
    c.proposals = [
        {
            id: "P1",
            author: "ux",
            title: "Show asleep and waking on the rail icon",
            argument: "A sleeping app looks the same as a running one, so the rail never says an app is asleep.",
            evidence: [{ ref: "railapps.ts:72" }],
            ts: t + MINUTE,
        },
        {
            id: "P2",
            author: "ram",
            title: "Keep the last-used app awake",
            argument: "Waking an app costs a cold start, but a kept-awake one holds its memory the whole session.",
            ts: t + 2 * MINUTE,
        },
        {
            id: "P3",
            author: "docs",
            title: "Say how many pins the rail holds",
            argument: "Nothing tells a person the rail takes three apps before the fourth pin is refused.",
            ts: t + 3 * MINUTE,
        },
    ];
    delete c.failed;
    delete c.skips;
    delete c.activity;
    if (state === "awaiting") {
        // a council waiting on the person shows its pause panel (no message box) unless a held draft waits: that is the
        // chat's, and the box under it is the one a whole-council message is typed in (discussionBody)
        c.proposals[2].draft = "held";
        c.round = 1;
        c.replies = [];
        c.stats = {
            ux: { ms: 250_000, tokens: 90_000, calls: 1 },
            ram: { ms: 280_000, tokens: 85_000, calls: 1 },
            docs: { ms: 260_000, tokens: 80_000, calls: 1 },
        };
        c.tokens = 255_000;
        c.calls = 3;
        return;
    }
    c.round = 3;
    c.replies = [
        { id: "r1", proposalid: "P1", author: "ram", stance: "accept", text: "The state is already in ServiceStatus.", round: 2, ts: t + 4 * MINUTE },
        { id: "r2", proposalid: "P1", author: "docs", stance: "challenge", text: "A third dot needs a legend somewhere.", round: 2, ts: t + 4 * MINUTE + 5_000 },
        { id: "r3", proposalid: "P2", author: "ux", stance: "accept", text: "A cold start is the slowest thing a person feels.", round: 2, ts: t + 5 * MINUTE },
        { id: "r4", proposalid: "P2", author: "docs", stance: "accept", text: "It is one line in the guide.", round: 2, ts: t + 5 * MINUTE + 5_000 },
        { id: "r5", proposalid: "P3", author: "ux", stance: "accept", text: "A hint on the empty slot says it best.", round: 2, ts: t + 6 * MINUTE },
        { id: "r6", proposalid: "P3", author: "ram", stance: "accept", text: "Nothing to measure here.", round: 2, ts: t + 6 * MINUTE + 5_000 },
    ];
    c.stats = {
        ux: { ms: 250_000, tokens: 190_000, calls: 2 },
        ram: { ms: 300_000, tokens: 170_000, calls: 2 },
        docs: { ms: 280_000, tokens: 175_000, calls: 2 },
        coordinator: { ms: 90_000, tokens: 140_000, calls: 1 },
    };
    c.tokens = 675_000;
    c.calls = 7;
    c.summary = {
        text: "Show asleep and waking on the rail icon, and say how many pins the rail holds: both are cheap and nobody objects.",
        directions: [
            {
                rank: 1,
                title: "Show asleep and waking on the rail icon",
                reasoning: "The state is already in ServiceStatus, so this only draws it.",
                from: ["P1"],
                stances: { ram: "accept", docs: "challenge" },
                agreed: true,
            },
            {
                rank: 2,
                title: "Say how many pins the rail holds",
                reasoning: "It teaches the cap before it bites.",
                from: ["P3"],
                stances: { ux: "accept", ram: "accept" },
                agreed: true,
            },
        ],
        outcomes: { P1: "Direction 1", P2: "Not taken up", P3: "Direction 2" },
        asks: [],
        at: t + 8 * MINUTE,
    };
    c.updated = t + 9 * MINUTE;
}

// stands in for the two commands the composer calls, then seeds a council of this file's data (`base` is the fixture it
// starts from: done or awaiting) and opens its Discussion. The stand-ins go in first: the composer prices an empty box too
// (the same request as the typed message's, so it is not asked again), and an answer from wavesrv would stay on screen.
async function openRouting(h, ctx, base, suffix) {
    await stubRpc(h, ["CouncilReplyCommand", "CouncilEstimateCommand"]);
    await answerEstimates(h);
    const id = await seedCouncil(h, ctx, base, {
        id: `${councilFixtureId("routing")}-${suffix}`,
        edit: (c) => routingCouncil(c, base),
    });
    await openCouncil(h, id, "discussion");
    if (!(await until(h, `!!document.querySelector(${sel(`[data-council-discussion="${id}"]`)}) && !!document.querySelector("[data-council-channel]")`))) {
        throw new Error(`the Discussion of ${id} did not load within ${WAIT_MS / 1000}s`);
    }
    return id;
}

// What wavesrv prices (pkg/council estimate.go): a follow-up is 20k tokens a role seat, 110k with files; a routed message
// is one router call (15k) and one seat (low end) to two seats (high end). In Auto the low end reads no files and the high
// end does; with Read files On or Off both ends use it. So a range of 2 to 3 calls, 35k to 235k tokens in Auto.
const ROUTER_TOKENS = 15_000;
const TEXT_TOKENS = 20_000;
const FILES_TOKENS = 110_000;

// replaces the estimate stand-in stubRpc put in (which answers a fixed value and records the call) with one that records it
// the same way and answers by what was asked; unstubRpc puts the real command back
async function answerEstimates(h) {
    const ok = await h.ev(`(() => {
        const st = window.__arcCouncilStub;
        if (!st?.api) return false;
        st.api.CouncilEstimateCommand = function (client, data) {
            st.calls.push({ name: "CouncilEstimateCommand", data: data === undefined ? null : JSON.parse(JSON.stringify(data)) });
            const d = data ?? {};
            if (d.routed) {
                const files = !!(d.toolsauto || d.tools);
                return Promise.resolve({
                    calls: 2,
                    callsmax: 3,
                    tokens: ${ROUTER_TOKENS} + (d.toolsauto || !d.tools ? ${TEXT_TOKENS} : ${FILES_TOKENS}),
                    tokensmax: ${ROUTER_TOKENS} + 2 * (files ? ${FILES_TOKENS} : ${TEXT_TOKENS}),
                    minutes: files ? 2 : 1,
                });
            }
            const n = d.followup ?? 1;
            return Promise.resolve({ calls: n, tokens: ${TEXT_TOKENS} * n, minutes: 1 });
        };
        return true;
    })()`);
    if (!ok) throw new Error("the estimate stand-in could not be put in: stubRpc left no stub on the page");
}

const estimates = (h) => rpcCalls(h, "CouncilEstimateCommand");
const lastEstimate = async (h) => (await estimates(h)).at(-1)?.data;
// waits for an estimate request that `test` (a page expression over `d`, the request's data) holds for
const untilEstimate = (h, test) =>
    until(h, `(window.__arcCouncilStub?.calls ?? []).some((c) => c.name === "CouncilEstimateCommand" && ((d) => ${test})(c.data ?? {}))`);

// the Read files control as drawn: the option pressed, whether the seats read files, what decided it, the lock, the note
const readFiles = (h) =>
    h.ev(`(() => {
        const g = document.querySelector(${sel(TOOLS)});
        if (!g) return null;
        const opts = [...g.querySelectorAll("[data-council-tools-option]")];
        return {
            label: (g.firstElementChild?.textContent ?? "")${NORM},
            options: opts.map((b) => (b.textContent ?? "")${NORM}),
            pressed: opts.filter((b) => b.getAttribute("aria-pressed") === "true").map((b) => b.getAttribute("data-council-tools-option")),
            state: g.getAttribute("data-council-tools-state"),
            on: g.getAttribute("data-council-tools-on"),
            why: g.getAttribute("data-council-tools-why"),
            locked: g.getAttribute("data-council-tools-locked"),
            note: (g.querySelector("[data-council-tools-note]")?.textContent ?? "")${NORM},
        };
    })()`);

// ---- the phases ----

// a plain message in a done council goes to the router: Read files is Auto and says so, and the line under the box shows a range
async function composerAuto(h, ctx, rec) {
    await openRouting(h, ctx, "done", "auto");
    await typeInto(h, INPUT, "What should we do about the rail first?");
    const hint = await settledText(h, HINT, /^Router picks 1–2 seats · ≈ /);
    const reads = await readFiles(h);
    await untilEstimate(h, `d.routed === true`);
    const asked = await lastEstimate(h);
    rec(
        "composer-auto: a plain message to the whole council shows Read files with Auto pressed and the note `· the router decides`",
        reads?.label === "Read files" &&
            reads.options.join(",") === "Auto,On,Off" &&
            reads.pressed.join(",") === "auto" &&
            reads.state === "auto" &&
            reads.why === "the router decides" &&
            reads.on === "false" &&
            reads.note === "· the router decides",
        reads
    );
    rec(
        "composer-auto: the line under the box reads `Router picks 1–2 seats · ≈ 2–3 calls · ~35k–235k tokens`, from an estimate asked with `routed` and `toolsauto`",
        hint === "Router picks 1–2 seats · ≈ 2–3 calls · ~35k–235k tokens" &&
            asked?.routed === true &&
            asked.toolsauto === true &&
            asked.tools === false &&
            asked.id != null &&
            asked.followup === undefined &&
            asked.agents === undefined,
        { hint, asked }
    );
    await h.shot("cdp-shots/council-routing-composer-auto.png");
}

// in a council that waits on the person no follow-up is priced, so the line only says the router picks; a message that names a
// seat keeps the old reach line
async function composerAwaiting(h, ctx, rec) {
    await openRouting(h, ctx, "awaiting", "awaiting");
    await typeInto(h, INPUT, "What should we do about the rail first?");
    const hint = await settledText(h, HINT, "The router picks who answers");
    const noSwitch = !(await exists(h, TOOLS));
    const priced = (await estimates(h)).length;
    rec(
        "composer-awaiting: in a council waiting on the person, a plain message shows `The router picks who answers`, with no Read files control and no estimate asked",
        hint === "The router picks who answers" && noSwitch && priced === 0,
        { hint, noSwitch, priced }
    );
    await h.shot("cdp-shots/council-routing-composer-awaiting.png");
    await typeInto(h, INPUT, "@UX why?");
    const reach = await settledText(h, HINT, /^Answered by/);
    rec(
        "composer-awaiting: `@UX why?` keeps the old reach line `Answered by: UX`",
        reach === "Answered by: UX",
        reach
    );
}

// On and Off are the person's own choice: the router does not decide, and the range narrows to that branch
async function composerOnOff(h, ctx, rec) {
    await openRouting(h, ctx, "done", "onoff");
    await typeInto(h, INPUT, "What should we do about the rail first?");
    await settledText(h, HINT, /^Router picks 1–2 seats · ≈ 2–3 calls · ~35k–235k tokens$/);
    const autoHint = await text(h, HINT);

    await click(h, `${TOOLS} [data-council-tools-option="on"]`);
    const onHint = await settledText(h, HINT, /^Router picks 1–2 seats · ≈ 2–3 calls · ~125k–235k tokens$/);
    const on = await readFiles(h);
    await untilEstimate(h, `d.routed === true && d.tools === true && d.toolsauto === undefined`);
    await h.shot("cdp-shots/council-routing-composer-on.png");

    await click(h, `${TOOLS} [data-council-tools-option="off"]`);
    const offHint = await settledText(h, HINT, /^Router picks 1–2 seats · ≈ 2–3 calls · ~35k–55k tokens$/);
    const off = await readFiles(h);
    await untilEstimate(h, `d.routed === true && d.tools === false && d.toolsauto === undefined`);
    await h.shot("cdp-shots/council-routing-composer-off.png");
    rec(
        "composer-on-off: On presses On with no router note and prices both ends with files (`~125k–235k`); Off presses Off and prices both without (`~35k–55k`), against Auto's `~35k–235k`",
        autoHint.includes("~35k–235k") &&
            onHint.includes("~125k–235k") &&
            on?.pressed.join(",") === "on" &&
            on.state === "on" &&
            on.on === "true" &&
            on.why === "" &&
            on.note === "" &&
            offHint.includes("~35k–55k") &&
            off?.pressed.join(",") === "off" &&
            off.state === "off" &&
            off.on === "false" &&
            off.why === "" &&
            off.note === "",
        { autoHint, onHint, offHint, on, off }
    );
}

// a message that names a seat is not the router's: the line counts that seat alone and no router hint shows
async function composerMention(h, ctx, rec) {
    await openRouting(h, ctx, "done", "mention");
    await typeInto(h, INPUT, "@UX why?");
    const hint = await settledText(h, HINT, /^1 expert answers · /);
    await untilEstimate(h, `d.followup === 1`);
    const asked = await lastEstimate(h);
    const reads = await readFiles(h);
    rec(
        "composer-mention: `@UX why?` shows `1 expert answers` and no router hint, priced as a follow-up of one seat (not routed), and Read files makes no router note",
        hint === "1 expert answers · ≈ 1 call · ~20k tokens" &&
            !hint.includes("Router") &&
            asked?.followup === 1 &&
            asked.routed === undefined &&
            asked.toolsauto === undefined &&
            reads?.state === "auto" &&
            reads.why === "" &&
            reads.note === "",
        { hint, asked, reads }
    );
    await h.shot("cdp-shots/council-routing-composer-mention.png");
}

// `@` lists All seats first; choosing it puts `@all ` in the box, and the line counts every seat answering
async function pickerAll(h, ctx, rec) {
    await openRouting(h, ctx, "done", "all");
    await typeInto(h, INPUT, "@");
    const opened = await until(h, `!!document.querySelector("[data-council-mentions] [data-council-mention-all]")`);
    const rows = await h.ev(`[...document.querySelectorAll("[data-council-mentions] [role='option']")].map((e) => ({
        all: e.hasAttribute("data-council-mention-all"),
        seat: e.getAttribute("data-council-mention"),
        selected: e.getAttribute("data-selected") === "true",
        text: (e.textContent ?? "")${NORM},
    }))`);
    const seatIds = rows.filter((r) => r.seat != null).map((r) => r.seat);
    rec(
        "picker-all: `@` lists All seats first, selected, then the three seats",
        opened &&
            rows[0]?.all === true &&
            rows[0].selected === true &&
            rows[0].text.startsWith("All seats") &&
            seatIds.join(",") === "ux,ram,docs" &&
            rows.filter((r) => r.selected).length === 1,
        rows
    );
    await h.shot("cdp-shots/council-routing-picker-all.png");

    await h.ev(`document.querySelector("[data-council-mentions] [data-council-mention-all]")?.dispatchEvent(new MouseEvent("mousedown", { bubbles: true, cancelable: true }))`);
    await until(h, `document.querySelector(${sel(INPUT)})?.value === "@all "`);
    const closed = !(await exists(h, "[data-council-mentions]"));
    const hint = await settledText(h, HINT, /^3 experts answer · /);
    await untilEstimate(h, `d.followup === 3`);
    const asked = await lastEstimate(h);
    const reads = await readFiles(h);
    rec(
        "picker-all: choosing it puts `@all ` in the box and closes the list, and the line counts all three seats answering (`3 experts answer`), not routed",
        closed &&
            hint === "3 experts answer · ≈ 3 calls · ~60k tokens" &&
            asked?.followup === 3 &&
            asked.routed === undefined &&
            reads?.why === "" &&
            reads.note === "",
        { closed, hint, asked, reads }
    );
    await h.shot("cdp-shots/council-routing-picker-all-chosen.png");
}

// Send in Auto tells wavesrv the router decides Read files (`toolsauto`); the person's On or Off goes as it is, never `toolsauto`
async function sendAuto(h, ctx, rec) {
    const id = await openRouting(h, ctx, "done", "send");
    const sendOne = async (body, then) => {
        await typeInto(h, INPUT, body);
        await settledText(h, HINT, /^Router picks 1–2 seats/);
        await then?.();
        const before = (await rpcCalls(h, "CouncilReplyCommand")).length;
        await click(h, SEND);
        await until(h, `(window.__arcCouncilStub?.calls ?? []).filter((c) => c.name === "CouncilReplyCommand").length > ${before}`);
        await until(h, `document.querySelector(${sel(INPUT)})?.value === ""`);
        return (await rpcCalls(h, "CouncilReplyCommand")).at(-1)?.data;
    };
    const auto = await sendOne("What should we do about the rail first?");
    await h.shot("cdp-shots/council-routing-send-auto.png");
    const after = await readFiles(h);
    rec(
        "send-auto: Send in Auto records CouncilReplyCommand (stubbed) with `toolsauto: true` and the text, no `tools` for a question that names no file, and Read files goes back to Auto",
        auto?.id === id &&
            auto.text === "What should we do about the rail first?" &&
            auto.toolsauto === true &&
            auto.tools === undefined &&
            auto.proposalid === undefined &&
            after?.state === "auto",
        { auto, after }
    );
    const on = await sendOne("What should we do about the rail second?", () => click(h, `${TOOLS} [data-council-tools-option="on"]`));
    const off = await sendOne("What should we do about the rail third?", () => click(h, `${TOOLS} [data-council-tools-option="off"]`));
    rec(
        "send-auto: the person's On sends `tools: true` and Off sends neither, and neither sends `toolsauto`: the router never overrides them",
        on?.tools === true &&
            on.toolsauto === undefined &&
            off?.tools === undefined &&
            off.toolsauto === undefined &&
            on.text.endsWith("second?") &&
            off.text.endsWith("third?"),
        { on, off }
    );
}

// ---- the routed messages (Task 6) ----

// the person's message to the whole council, as wavesrv saves it once the router has chosen (council.CouncilRouted: `chose`,
// `reason`, `failed`, `autotools`; `to` the seats that answer) and the answers under it; the replies are `r7` and on
const ROUTED = {
    // the router chose UX: one answer, two seats left to ask
    line: {
        text: "Where should the asleep state show up on the rail?",
        chose: ["ux"],
        reason: "It is about what the rail icon shows.",
        answers: [["ux", "On the icon: a dimmed ring says asleep, and the ring fills while the app wakes."]],
    },
    // the router chose UX and RAM: the first answer carries the line, the last the chips
    two: {
        text: "Should the rail show asleep, and what does waking cost?",
        chose: ["ux", "ram"],
        reason: "It asks about the icon and about what an awake app costs.",
        answers: [
            ["ux", "Yes: a dimmed ring on the icon says asleep."],
            ["ram", "Waking is a cold start, and the app gives its heap back while it sleeps."],
        ],
    },
    // a council of two seats where the router chose both: the post still does not read `For everyone`
    twoseats: {
        seats: ["ux", "ram"],
        text: "Should the rail show asleep, and what does waking cost?",
        chose: ["ux", "ram"],
        reason: "It asks about the icon and about what an awake app costs.",
        answers: [
            ["ux", "Yes: a dimmed ring on the icon says asleep."],
            ["ram", "Waking is a cold start, and the app gives its heap back while it sleeps."],
        ],
    },
    // Read files was Auto and the router turned it on
    files: {
        text: "Review the v5.1 we just fixed.",
        chose: ["ux"],
        reason: "v5.1 is not in the Discussion.",
        autotools: true,
        tools: true,
        answers: [["ux", "In v5.1 the ring is drawn from ServiceStatus, so asleep and waking each have their own state."]],
    },
    // the router's call failed: the first seat answered alone, and the reason is not shown
    failed: {
        text: "Where should the asleep state show up on the rail?",
        chose: ["ux"],
        reason: "claude exited with status 1",
        failed: true,
        answers: [["ux", "On the icon: a dimmed ring says asleep."]],
    },
    // the router has not chosen yet: no seat, no answer
    pending: {
        text: "Where should the asleep state show up on the rail?",
        pending: true,
    },
    // two posts sent in a row, then their answers: the routed one (UX) and an `@RAM` one; each answer quotes its post
    stacked: {
        text: "Where should the asleep state show up on the rail?",
        chose: ["ux"],
        reason: "It is about what the rail icon shows.",
        follow: { text: "@RAM what does waking cost?", to: ["ram"] },
        answers: [
            ["ux", "On the icon: a dimmed ring says asleep.", "r7"],
            ["ram", "A cold start: the app gives its heap back while it sleeps.", "r20"],
        ],
    },
    // as `line`, but Docs' call failed: it is left out of the chips, a follow-up would call nobody
    failedseat: {
        text: "Where should the asleep state show up on the rail?",
        chose: ["ux"],
        reason: "It is about what the rail icon shows.",
        failedSeat: "docs",
        answers: [["ux", "On the icon: a dimmed ring says asleep, and the ring fills while the app wakes."]],
    },
};

// a done council of this file's data with the routed message `key` of ROUTED and the answers to it
function routedCouncil(c, key) {
    const spec = ROUTED[key];
    routingCouncil(c, "done");
    if (spec.seats != null) {
        // a council of fewer seats: what the others wrote goes with them
        const keep = new Set(spec.seats);
        c.experts = c.experts.filter((e) => e.coordinator || keep.has(e.id));
        c.proposals = c.proposals.filter((p) => keep.has(p.author));
        const ideas = new Set(c.proposals.map((p) => p.id));
        c.replies = c.replies.filter((r) => keep.has(r.author) && ideas.has(r.proposalid));
        for (const id of Object.keys(c.stats)) {
            if (id !== "coordinator" && !keep.has(id)) delete c.stats[id];
        }
        c.summary.directions = c.summary.directions.filter((d) => d.from.every((p) => ideas.has(p)));
        for (const d of c.summary.directions) {
            d.stances = Object.fromEntries(Object.entries(d.stances).filter(([seat]) => keep.has(seat)));
        }
        c.summary.outcomes = Object.fromEntries(Object.entries(c.summary.outcomes).filter(([p]) => ideas.has(p)));
    }
    const t = c.started + 10 * MINUTE;
    c.replies.push({
        id: "r7",
        proposalid: "",
        author: "you",
        text: spec.text,
        to: spec.pending ? [] : (spec.to ?? spec.chose),
        ...(spec.tools ? { tools: true } : {}),
        ...(spec.pending ? {} : { answered: true }),
        round: 4,
        ts: t,
        routed: spec.pending
            ? { pending: true }
            : {
                  chose: spec.chose,
                  reason: spec.reason,
                  ...(spec.failed ? { failed: true } : {}),
                  ...(spec.autotools ? { autotools: true } : {}),
              },
    });
    if (spec.follow != null) {
        c.replies.push({
            id: "r20",
            proposalid: "",
            author: "you",
            text: spec.follow.text,
            to: spec.follow.to,
            answered: true,
            round: 4,
            ts: t + 10_000,
        });
    }
    (spec.answers ?? []).forEach(([author, body, parent], i) =>
        c.replies.push({
            id: `r${8 + i}`,
            proposalid: "",
            parentid: parent ?? "r7",
            author,
            text: body,
            round: 4,
            ts: t + 25_000 + i * 15_000,
        })
    );
    if (spec.failedSeat != null) {
        c.failed = { [spec.failedSeat]: { round: 4, error: "claude exited with status 1" } };
    }
    c.updated = t + MINUTE;
}

// stands in for the three commands the Discussion and its composer call (`reject` makes CouncilAskTooCommand refuse with that
// message), seeds the routed council `key` under an id of its phase's own, opens its Discussion and waits for the person's
// message. Answers the council's id.
async function openRouted(h, ctx, phase, key, reject) {
    await stubRpc(
        h,
        ["CouncilReplyCommand", "CouncilEstimateCommand", "CouncilAskTooCommand"],
        reject == null ? {} : { CouncilAskTooCommand: { reject } }
    );
    await answerEstimates(h);
    const id = await seedCouncil(h, ctx, "done", {
        id: `${councilFixtureId("routing")}-${phase}-${key}`,
        edit: (c) => routedCouncil(c, key),
    });
    await openCouncil(h, id, "discussion");
    // the person's messages to the whole council and the answers to them are in the channel
    if (!(await until(h, `!!document.querySelector(${sel(`[data-council-channel] ${POST("r7")}`)})`))) {
        throw new Error(`the person's message of ${id} did not show in the channel within ${WAIT_MS / 1000}s`);
    }
    return id;
}

const POST = (id) => `[data-council-reply-post="${id}"]`;
const CHIPS = "[data-council-ask-too]";

// what a post draws: the old router line above an answer (gone: null), the chips at the top of the person's bubble (whom it
// reaches, `by` router, failed, choosing or you, the router's line as their hover), the quote at the top of a seat's
// bubble (the post it answers, a button when it jumps), the seats its own text names as chips, its wait line, the Ask
// <seat> too chips under it and a refusal. `top` says the chips or the quote are the bubble's first row. null when the
// post is not on screen.
const postOf = (h, id) =>
    h.ev(`(() => {
        const p = document.querySelector(${sel(POST(id))});
        if (!p) return null;
        const norm = (e) => (e?.textContent ?? "")${NORM};
        const router = p.querySelector("[data-council-router]");
        const bubble = p.querySelector("[data-council-bubble]");
        const reach = p.querySelector("[data-council-reach]");
        const quote = p.querySelector("[data-council-quote]");
        const waits = p.querySelector("[data-council-waits]");
        const alert = p.querySelector("[role='alert']");
        const seatsOf = (e) => [...(e?.querySelectorAll("[data-council-seat-chip]") ?? [])].map((x) => x.getAttribute("data-council-seat-chip")).join(",");
        const named = [...(bubble?.querySelectorAll("p [data-council-seat-chip]") ?? [])];
        return {
            router: router ? norm(router) : null,
            reach: reach
                ? { by: reach.getAttribute("data-council-reach"), seats: seatsOf(reach), text: norm(reach), title: reach.getAttribute("title"), top: bubble?.firstElementChild === reach }
                : null,
            quote: quote
                ? { id: quote.getAttribute("data-council-quote"), text: norm(quote), jump: quote.tagName === "BUTTON", top: bubble?.firstElementChild === quote }
                : null,
            named: named.map((x) => ({ seat: x.getAttribute("data-council-seat-chip"), text: norm(x) })),
            waits: waits ? norm(waits) : null,
            chips: [...p.querySelectorAll(${sel(CHIPS)})].map((b) => ({ seat: b.getAttribute("data-council-ask-too"), text: norm(b), disabled: b.disabled })),
            alert: alert ? norm(alert) : null,
        };
    })()`);

const countOf = (h, s) => h.ev(`document.querySelectorAll(${sel(s)}).length`);
const chipSeats = (post) => (post?.chips ?? []).map((c) => c.seat).join(",");

// the router chose UX: the person's bubble opens on the UX chip, the router's line its hover; the answer right under it
// carries no line and no quote
async function routerLine(h, ctx, rec) {
    await openRouted(h, ctx, "line", "line");
    const mine = await postOf(h, "r7");
    const first = await postOf(h, "r8");
    const lines = await countOf(h, "[data-council-router]");
    rec(
        "router-line: the person's bubble opens on the router's chip row naming UX, its hover `Router chose UX: <reason>`, with no line under it; UX's answer right under it has no router line above it and no quote",
        mine?.reach?.by === "router" &&
            mine.reach.seats === "ux" &&
            mine.reach.top === true &&
            mine.reach.title === `Router chose UX: ${ROUTED.line.reason}` &&
            mine.waits === null &&
            first?.router === null &&
            first.quote === null &&
            first.reach === null &&
            lines === 0,
        { mine, first, lines }
    );
    await h.shot("cdp-shots/council-routing-router-line.png");
}

// two seats chosen: the line sits on the first answer only, and the post names both, also when they are the whole panel
async function routerTwo(h, ctx, rec) {
    await openRouted(h, ctx, "two", "two");
    const mine = await postOf(h, "r7");
    const first = await postOf(h, "r8");
    const second = await postOf(h, "r9");
    const lines = await countOf(h, "[data-council-router]");
    rec(
        "router-two: the person's chips name UX and RAM, their hover `Router chose UX and RAM: <reason>`; neither answer, each right under the post or the other answer, carries a line or a quote",
        mine?.reach?.by === "router" &&
            mine.reach.seats === "ux,ram" &&
            mine.reach.title === `Router chose UX and RAM: ${ROUTED.two.reason}` &&
            first?.router === null &&
            first.quote === null &&
            second?.router === null &&
            second.quote === null &&
            lines === 0,
        { mine, first, second, lines }
    );
    await h.shot("cdp-shots/council-routing-router-two.png");

    await openRouted(h, ctx, "two", "twoseats");
    const small = await postOf(h, "r7");
    const smallFirst = await postOf(h, "r8");
    const smallLast = await postOf(h, "r9");
    rec(
        "router-two: on a council of two seats where the router chose both, the chips name UX and RAM, not Everyone, and no Ask too chip is left to press",
        small?.reach?.by === "router" &&
            small.reach.seats === "ux,ram" &&
            !small.reach.text.includes("Everyone") &&
            small.reach.title === `Router chose UX and RAM: ${ROUTED.twoseats.reason}` &&
            smallFirst?.router === null &&
            smallLast?.router === null &&
            smallLast.chips.length === 0 &&
            smallFirst.chips.length === 0,
        { small, smallFirst, smallLast }
    );
    await h.shot("cdp-shots/council-routing-router-two-seats.png");
}

// Read files was Auto and the router turned it on: the chips' hover says so
async function routerFiles(h, ctx, rec) {
    await openRouted(h, ctx, "files", "files");
    const mine = await postOf(h, "r7");
    rec(
        "router-files: when the router decided to read files the chips' hover reads `Router chose UX · reading files: <reason>`",
        mine?.reach?.title === `Router chose UX · reading files: ${ROUTED.files.reason}` && mine.reach.seats === "ux",
        mine
    );
    await h.shot("cdp-shots/council-routing-router-files.png");
}

// the router's call failed: the fallback seat answered, and the chips say so without the error
async function routerFailed(h, ctx, rec) {
    await openRouted(h, ctx, "failed", "failed");
    const mine = await postOf(h, "r7");
    const first = await postOf(h, "r8");
    rec(
        "router-failed: the person's chip row reads `Router failed` and names UX, its hover `Router failed, UX answered` with the failure's reason left out, and the answer has no line above it",
        mine?.reach?.by === "failed" &&
            mine.reach.text === "Router failed UX" &&
            mine.reach.seats === "ux" &&
            mine.reach.title === "Router failed, UX answered" &&
            !`${mine.reach.text} ${mine.reach.title}`.includes("exited") &&
            first?.router === null,
        { mine, first }
    );
    await h.shot("cdp-shots/council-routing-router-failed.png");
}

// the router has not chosen: the chip row at the top of the post says so, names no one, and nothing else shows yet
async function routerPending(h, ctx, rec) {
    await openRouted(h, ctx, "pending", "pending");
    const mine = await postOf(h, "r7");
    const lines = await countOf(h, "[data-council-router]");
    const chips = await countOf(h, CHIPS);
    const everyone = await h.ev(`(document.querySelector('[data-council-channel]')?.textContent ?? "").includes("everyone")`);
    rec(
        "router-pending: the person's bubble opens on `Router is choosing a seat…` with no seat chip and no wait line under it, and no router line, Ask too chip or `everyone` shows",
        mine?.reach?.by === "choosing" &&
            mine.reach.text === "Router is choosing a seat…" &&
            mine.reach.seats === "" &&
            mine.reach.top === true &&
            mine.waits === null &&
            !everyone &&
            lines === 0 &&
            chips === 0,
        { mine, lines, chips, everyone }
    );
    await h.shot("cdp-shots/council-routing-router-pending.png");
}

// two posts sent in a row, then the answers: each answer opens on a quote of the post it answers, which jumps to it; the
// `@RAM` post draws its seat as a chip in its text and no chip row
async function quoteStacked(h, ctx, rec) {
    await openRouted(h, ctx, "stacked", "stacked");
    await until(h, `!!document.querySelector(${sel(POST("r9"))})`);
    const routed = await postOf(h, "r7");
    const named = await postOf(h, "r20");
    const ux = await postOf(h, "r8");
    const ram = await postOf(h, "r9");
    rec(
        "quote-stacked: with two posts sent before the answers, UX's answer opens on a quote of the routed post (`You` and its text) and RAM's on the `@RAM` post, each a jump button at the top of its bubble",
        ux?.quote?.id === "r7" &&
            ux.quote.text === `You ${ROUTED.stacked.text}` &&
            ux.quote.jump === true &&
            ux.quote.top === true &&
            ram?.quote?.id === "r20" &&
            ram.quote.text === `You ${ROUTED.stacked.follow.text}` &&
            ram.quote.jump === true &&
            routed?.quote === null,
        { ux, ram, routed }
    );
    rec(
        "quote-stacked: the `@RAM` post draws `@RAM` as RAM's chip in its text and no chip row; the routed post keeps its UX chip",
        named?.reach === null &&
            named.named.length === 1 &&
            named.named[0].seat === "ram" &&
            named.named[0].text === "@RAM" &&
            routed?.reach?.seats === "ux",
        { named, routed }
    );
    await h.shot("cdp-shots/council-routing-quote-stacked.png");
    // a press on the quote brings the post it quotes into view
    await h.ev(`document.querySelector(${sel(POST("r9"))})?.scrollIntoView({ block: "end" })`);
    await click(h, `${POST("r8")} [data-council-quote]`);
    const seen = await until(
        h,
        `(() => {
            const r = document.querySelector(${sel(POST("r7"))})?.getBoundingClientRect();
            const box = document.querySelector("[data-council-channel]")?.getBoundingClientRect();
            return !!r && !!box && r.top >= box.top - 1 && r.bottom <= box.bottom + 1;
        })()`
    );
    const ring = await h.ev(`(() => {
        const p = document.querySelector(${sel(POST("r7"))});
        const b = p?.querySelector("[data-council-bubble]");
        return { flash: p?.dataset.flash ?? null, shadow: b ? getComputedStyle(b).boxShadow : null };
    })()`);
    rec(
        "quote-stacked: pressing UX's quote brings the routed post into view in the channel and rings its bubble (`data-flash`, a box-shadow) for a moment",
        seen && ring?.flash === "true" && ring.shadow != null && ring.shadow !== "none",
        { seen, ring }
    );
    const faded = await until(h, `document.querySelector(${sel(POST("r7"))})?.dataset.flash == null`, 4000);
    rec("quote-stacked: the ring is gone about two seconds later", faded, { faded });
}

// one chip per seat that was not asked, under the last answer
async function askTooChips(h, ctx, rec) {
    await openRouted(h, ctx, "chips", "line");
    const mine = await postOf(h, "r7");
    const answer = await postOf(h, "r8");
    rec(
        "ask-too-chips: UX answered alone, so the last answer holds one chip per other seat, `Ask RAM too` and `Ask Docs too`, in panel order, enabled, and the person's post has none",
        chipSeats(answer) === "ram,docs" &&
            answer.chips.map((c) => c.text).join(",") === "Ask RAM too,Ask Docs too" &&
            answer.chips.every((c) => !c.disabled) &&
            mine?.chips.length === 0,
        { mine, answer }
    );
    await h.shot("cdp-shots/council-routing-ask-too-chips.png");

    await openRouted(h, ctx, "chips", "two");
    const first = await postOf(h, "r8");
    const last = await postOf(h, "r9");
    rec(
        "ask-too-chips: with two seats answering, the chips sit under the last answer only, and are the one seat left (`Ask Docs too`)",
        first?.chips.length === 0 && chipSeats(last) === "docs" && last.chips[0].text === "Ask Docs too",
        { first, last }
    );
    await h.shot("cdp-shots/council-routing-ask-too-chips-last.png");

    await openRouted(h, ctx, "chips", "failedseat");
    const left = await postOf(h, "r8");
    rec(
        "ask-too-chips: a seat whose call failed (Docs) is left out of the chips: only `Ask RAM too` shows",
        chipSeats(left) === "ram",
        left
    );
    await h.shot("cdp-shots/council-routing-ask-too-chips-failed.png");
}

// a press calls CouncilAskTooCommand (stubbed) with the council, the person's message and the seat, and the chips go off
async function askTooPress(h, ctx, rec) {
    const id = await openRouted(h, ctx, "press", "line");
    await click(h, `${POST("r8")} [data-council-ask-too="ram"]`);
    await until(h, `(window.__arcCouncilStub?.calls ?? []).some((c) => c.name === "CouncilAskTooCommand")`);
    await until(h, `[...document.querySelectorAll(${sel(CHIPS)})].length > 0 && [...document.querySelectorAll(${sel(CHIPS)})].every((b) => b.disabled)`);
    const calls = await rpcCalls(h, "CouncilAskTooCommand");
    const answer = await postOf(h, "r8");
    // a second press on a disabled chip reaches nothing
    await click(h, `${POST("r8")} [data-council-ask-too="docs"]`);
    const after = await rpcCalls(h, "CouncilAskTooCommand");
    rec(
        "ask-too-press: pressing `Ask RAM too` calls CouncilAskTooCommand (stubbed) with `{id, replyid: r7, expertid: ram}` once, and both chips go disabled with no error",
        calls.length === 1 &&
            JSON.stringify(calls[0].data) === JSON.stringify({ id, replyid: "r7", expertid: "ram" }) &&
            answer.chips.length === 2 &&
            answer.chips.every((c) => c.disabled) &&
            answer.alert === null &&
            after.length === 1,
        { calls, answer, after: after.length }
    );
    await h.shot("cdp-shots/council-routing-ask-too-press.png");
}

// a refusal shows under the chips, and the chips can be pressed again
async function askTooRefused(h, ctx, rec) {
    const why = "seat ram already has reply r7";
    await openRouted(h, ctx, "refused", "line", why);
    await click(h, `${POST("r8")} [data-council-ask-too="ram"]`);
    await until(h, `!!document.querySelector("[data-council-ask-too-error]")`);
    const answer = await postOf(h, "r8");
    const role = await attr(h, "[data-council-ask-too-error]", "role");
    const calls = await rpcCalls(h, "CouncilAskTooCommand");
    rec(
        "ask-too-refused: when the command refuses, the error shows inline as an alert (`Ask RAM too failed: …`) and the chips are enabled again",
        answer?.alert === `Ask RAM too failed: ${why}` &&
            role === "alert" &&
            calls.length === 1 &&
            answer.chips.length === 2 &&
            answer.chips.every((c) => !c.disabled),
        { answer, role, calls: calls.length }
    );
    await h.shot("cdp-shots/council-routing-ask-too-refused.png");
}

// ---- the hooks ----

const PHASES = [
    ["composer-auto", composerAuto],
    ["composer-awaiting", composerAwaiting],
    ["composer-on-off", composerOnOff],
    ["composer-mention", composerMention],
    ["picker-all", pickerAll],
    ["send-auto", sendAuto],
    ["router-line", routerLine],
    ["router-two", routerTwo],
    ["router-files", routerFiles],
    ["router-failed", routerFailed],
    ["router-pending", routerPending],
    ["quote-stacked", quoteStacked],
    ["ask-too-chips", askTooChips],
    ["ask-too-press", askTooPress],
    ["ask-too-refused", askTooRefused],
];

export const councilRouting = {
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
