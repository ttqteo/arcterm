// chat-judge-reply: the judge round's mark in the working agent's own Chat (docs/superpowers/specs/
// 2026-11-26-judge-on-reply-design.md, decision 3; frontend/app/view/agents/pairmark.ts, chatpairmark.tsx, chatconversation.tsx).
// A round has a line under the reply it started from and a 2px bar on the left of the turns it covers: from that reply to the
// bottom while it lives, to the round's last worker message once it ended (grey). No agent runs and wavesrv's pair commands are
// never called: the roster is pair-fixtures.mjs's, its worker reading a fixture transcript of six turns (writeRoundsTranscript,
// ROUND_REPLIES), and each round is a PairView in the page's dev mock pairs (roundView) whose first worker message is the text of
// the reply it started from, which is how Chat finds that reply.
//   reading-line  a round whose judge owes its first answer, started from the third reply (an older one): a spinner and "The
//                 judge is reading this reply · N s" under that reply, the seconds ticking, the bar from it to the bottom, and
//                 Open pair at the line's end opening the pair's conversation
//   live-bar      after a judge message the line reads "⚖ The judge round starts here" with Open pair, and the accent bar runs
//                 from that reply to the bottom with no turn missing
//   ended-mark    an ended round: a grey bar from its reply to the reply of its last worker message, and its one-button line
//                 reads "⚖ Judge round HH:MM–HH:MM · N agreed, M open"; pressing it opens the pair's page in Library
//   two-rounds    a reply that started two rounds carries both lines, the older above, and where the bars overlap only the
//                 newer round's is drawn
//   motion        frames, not only end states: the line opens on the spring, the bar's colour eases and the line's text
//                 cross-fades when the round ends; under reduced motion each is at its end state at once
// DOM contract (chatpairmark.tsx): a line is [data-chat-pair-mark=<pair id>] with data-state (reading | live | ended), its text
// [data-chat-pair-mark-text], the spinner [data-chat-pair-mark-spinner], the action [data-chat-pair-mark-open="pair" | "library"];
// a covered row (Chat's [data-chat-item], and a line's own row) carries [data-chat-pair-bar=<pair id>] with
// data-chat-pair-bar-state (live | ended), the bar being its ::before.
// kit is scenarios.mjs's RT_KIT (polishWaitFor, polishNap).

import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { agentPage, focusAgent, restoreRoster, setRoster } from "./agent-page-fixtures.mjs";
import {
    PAIR,
    ROUND_PROJECT,
    ROUND_REPLIES,
    pairRoster,
    restorePairRpc,
    roundView,
    seedPair,
    stubPairRpc,
    writeRoundsTranscript,
} from "./pair-fixtures.mjs";

const NAME = "chat-judge-reply";
const WAIT_MS = 8_000;
const WINDOW_W = 1900;
const MIN = 60_000;
const q = JSON.stringify;
const shot = (h, step) => h.shot(`cdp-shots/${NAME}-${step}.png`);

const HEADER = `document.querySelector("[data-agent-header]")`;
// the worker's own Chat layer (the Agent surface keeps one per agent)
const LAYER = `document.querySelector('[data-agent-chat="${PAIR.worker}"]:not([data-chat-leaving])')`;
const MARK = (pairId) => `[data-chat-pair-mark="${pairId}"]`;

// local HH:MM, as the line writes a round's times
const hhmm = (ts) => new Date(ts).toTimeString().slice(0, 5);

// What Chat draws of the rounds, read in one call: every item row (the reply it holds, if any, and the bar it carries with the
// bar's own style) and every line (its state and words, the spinner, the action, the item it sits under, the bar its own row
// carries), and the two colours a bar takes, resolved from the theme tokens the classes use.
const readMarks = `(() => {
    const layer = ${LAYER};
    if (!layer) return null;
    const flat = (el) => (el?.textContent ?? "").replace(/\\s+/g, " ").trim();
    const replies = ${q(ROUND_REPLIES.map((r) => r.text))};
    const replyOf = (el) => {
        const prose = [...el.querySelectorAll("[data-chat-prose]")].map(flat);
        return replies.findIndex((t) => prose.some((p) => p.includes(t))) + 1;
    };
    const rows = [...layer.querySelectorAll("[data-chat-item]")].map((el) => {
        const key = el.getAttribute("data-chat-item");
        const bar = el.getAttribute("data-chat-pair-bar");
        const after = bar == null ? null : getComputedStyle(el, "::before");
        return {
            key,
            kind: key.slice(0, key.indexOf(":")),
            reply: replyOf(el),
            bar,
            barState: el.getAttribute("data-chat-pair-bar-state"),
            before: after == null ? null : { position: after.position, width: after.width, left: after.left, top: after.top, bottom: after.bottom, color: after.backgroundColor },
        };
    });
    const lines = [...layer.querySelectorAll("[data-chat-pair-mark]")].map((el) => {
        const row = el.parentElement;
        let prev = row.previousElementSibling;
        while (prev && !prev.hasAttribute("data-chat-item")) prev = prev.previousElementSibling;
        const open = el.querySelector("[data-chat-pair-mark-open]");
        const texts = [...el.querySelectorAll("[data-chat-pair-mark-text]")].map(flat);
        const rr = row.getBoundingClientRect();
        const pr = prev?.getBoundingClientRect();
        return {
            pair: el.getAttribute("data-chat-pair-mark"),
            state: el.getAttribute("data-state"),
            text: texts.at(-1) ?? "",
            texts: texts.length,
            spinner: el.querySelector("[data-chat-pair-mark-spinner]") != null,
            action: open ? { kind: open.getAttribute("data-chat-pair-mark-open"), text: flat(open) } : null,
            // Open pair stands at the line's end: its right edge is the line's own
            actionAtEnd: open ? Math.abs(open.getBoundingClientRect().right - el.getBoundingClientRect().right) <= 4 : null,
            // the whole ended line is the one button: its text is inside it
            wholeButton: el.querySelector('button[data-chat-pair-mark-open="library"] [data-chat-pair-mark-text]') != null,
            under: prev == null ? null : replyOf(prev),
            gap: pr ? Math.round(rr.top - pr.bottom) : null,
            bar: row.getAttribute("data-chat-pair-bar"),
            barState: row.getAttribute("data-chat-pair-bar-state"),
        };
    });
    const paint = (token) => {
        const probe = document.createElement("div");
        probe.style.backgroundColor = "var(" + token + ")";
        document.body.appendChild(probe);
        const color = getComputedStyle(probe).backgroundColor;
        probe.remove();
        return color;
    };
    return { rows, lines, accent: paint("--color-accent"), grey: paint("--color-ink-faint") };
})()`;

// The rows a round's bar covers, by their index among the item rows: the first and last, how many, and whether no item between
// them is missing. `reply(n)` is the index of the item holding reply n (1 is the first), -1 when it is not drawn.
const replyAt = (m, n) => m.rows.findIndex((r) => r.reply === n);
function barSpan(m, pairId) {
    const covered = m.rows.flatMap((r, i) => (r.bar === pairId ? [i] : []));
    return {
        from: covered[0] ?? -1,
        to: covered.at(-1) ?? -1,
        count: covered.length,
        contiguous: covered.every((i, k) => i === covered[0] + k),
        states: [...new Set(m.rows.filter((r) => r.bar === pairId).map((r) => r.barState))],
        colors: [...new Set(m.rows.filter((r) => r.bar === pairId).map((r) => r.before?.color))],
        drawn: m.rows.filter((r) => r.bar === pairId).every((r) => r.before?.position === "absolute" && r.before.width === "2px" && r.before.left === "-12px" && r.before.top === "0px" && r.before.bottom === "-16px"),
    };
}

// one frame of a round's line and bar, read by the sampler: the line row's height and opacity, the colour of the bar on the
// first row it covers, and the opacity each of the line's texts draws at (a state that is leaving fades beside the one coming)
const frameOf = (pairId) => `(() => {
    const layer = ${LAYER};
    const mark = layer?.querySelector('[data-chat-pair-mark="${pairId}"]');
    const row = mark?.parentElement;
    const bar = layer?.querySelector('[data-chat-pair-bar="${pairId}"]');
    const eff = (el) => {
        let o = 1;
        for (let e = el; e && e !== mark; e = e.parentElement) o *= Number(getComputedStyle(e).opacity);
        return Math.round(o * 100) / 100;
    };
    return {
        h: row ? Math.round(row.getBoundingClientRect().height * 10) / 10 : null,
        o: row ? Number(getComputedStyle(row).opacity) : null,
        color: bar ? getComputedStyle(bar, "::before").backgroundColor : null,
        texts: mark ? [...mark.querySelectorAll("[data-chat-pair-mark-text]")].map(eff) : [],
    };
})()`;
// every animation frame of that, from now until stopFrames
const startFrames = (h, pairId) =>
    h.ev(`(() => {
        const frames = (window.__roundFrames = []);
        let on = true;
        window.__roundFramesStop = () => { on = false; };
        const tick = () => {
            if (!on) return;
            frames.push(${frameOf(pairId)});
            requestAnimationFrame(tick);
        };
        requestAnimationFrame(tick);
        return true;
    })()`);
const stopFrames = (h) =>
    h.ev(`(() => { window.__roundFramesStop?.(); const f = window.__roundFrames ?? []; delete window.__roundFrames; delete window.__roundFramesStop; return f; })()`);

// the centre column's modes, recorded as they happen (as pair-header does): Open pair sets `pair`, and the held pane may send a
// mode it was not asked for back to the terminal at once
const watchCenter = (h) =>
    agentPage(
        h,
        `const { centerModeAtom } = await mod("app/view/agents/agentcenter.ts");
        window.__roundUnwatch?.();
        const modes = (window.__roundModes = []);
        window.__roundUnwatch = globalStore.sub(centerModeAtom, () => modes.push(globalStore.get(centerModeAtom)));
        return true;`
    );
const unwatchCenter = (h) =>
    h.ev(`(() => { window.__roundUnwatch?.(); delete window.__roundUnwatch; delete window.__roundModes; return true; })()`);
const readCenter = (h) =>
    agentPage(
        h,
        `const { centerModeAtom, pairSelAtom } = await mod("app/view/agents/agentcenter.ts");
        return {
            mode: globalStore.get(centerModeAtom),
            pair: globalStore.get(pairSelAtom),
            modes: (window.__roundModes ?? []).splice(0),
        };`
    );
const leaveCenter = (h) =>
    agentPage(
        h,
        `const { centerModeAtom } = await mod("app/view/agents/agentcenter.ts");
        globalStore.set(centerModeAtom, "terminal");
        (window.__roundModes ?? []).splice(0);
        return true;`
    );

// Library's selected pair goes back to none, so a later step never starts on a pair page
const clearLibraryPair = (h) =>
    agentPage(
        h,
        `const L = await mod("app/view/library/librarystore.ts");
        globalStore.set(L.libraryPairSelAtom, null);
        return true;`
    );

// prefers-reduced-motion on or off in the page. motion reads it from the media query's change event, which fires on the next
// frame, and a component reads it when it mounts: a line mounted after this is the one that follows it
const reduceMotion = async (h, on) => {
    await h.cdp("Emulation.setEmulatedMedia", { features: [{ name: "prefers-reduced-motion", value: on ? "reduce" : "" }] });
    return h.ev(`new Promise((resolve) => {
        const mq = matchMedia("(prefers-reduced-motion)");
        const t0 = performance.now();
        const poll = () => {
            if (mq.matches === ${on ? "true" : "false"}) requestAnimationFrame(() => requestAnimationFrame(() => resolve(true)));
            else if (performance.now() - t0 > 2000) resolve(false);
            else requestAnimationFrame(poll);
        };
        poll();
    })`);
};

export default function (kit) {
    const { polishWaitFor, polishNap } = kit;

    // where the element `selector` names has its middle, or null when none is drawn
    const centreOf = (h, selector) =>
        h.ev(`(() => {
            const r = document.querySelector(${q(selector)})?.getBoundingClientRect();
            return r && r.width > 0 && r.height > 0 ? { x: Math.round(r.x + r.width / 2), y: Math.round(r.y + r.height / 2) } : null;
        })()`);

    // a real mouse click at the element's middle now; false when none is drawn
    async function tap(h, selector) {
        const box = await centreOf(h, selector);
        if (box == null) return false;
        await h.cdp("Input.dispatchMouseEvent", { type: "mouseMoved", x: box.x, y: box.y });
        for (const type of ["mousePressed", "mouseReleased"]) {
            await h.cdp("Input.dispatchMouseEvent", { type, x: box.x, y: box.y, button: "left", clickCount: 1 });
        }
        return true;
    }

    // Chat scrolls so the element is in the middle of its pane (a real press needs it on screen); false when none is drawn
    const scrollTo = (h, selector) =>
        h.ev(`(() => {
            const el = (${LAYER})?.querySelector(${q(selector)});
            el?.scrollIntoView({ block: "center" });
            return !!el;
        })()`);

    // The fixture's blocks are not real ones. arrange marks the roster a fixture's (setFixtureRoster) before it sets it, so a
    // pane's refused controller start is never "failed to start" (pair-header does the same); a step reads Chat once the header
    // holds its words
    async function show(h, id) {
        await focusAgent(h, id);
        await polishWaitFor(
            h,
            `!${HEADER}?.querySelector("[data-agent-start-error]") && ${HEADER}?.getAttribute("data-header-labels") === "words"`,
            WAIT_MS
        );
    }
    const markFixture = (h, on) =>
        agentPage(
            h,
            `const { setFixtureRoster } = await mod("app/view/agents/agentcontrollerstore.ts");
            const { devMockAgentsAtom } = await mod("app/view/agents/devmock.ts");
            setFixtureRoster(${on ? "true" : "globalStore.get(devMockAgentsAtom) != null"});
            return true;`
        );
    // the six replies of the transcript are drawn
    const repliesDrawn = (h) =>
        polishWaitFor(
            h,
            `(() => { const l = ${LAYER}; return !!l && ${q(ROUND_REPLIES.map((r) => r.text))}.every((t) => [...l.querySelectorAll("[data-chat-prose]")].some((p) => (p.textContent ?? "").includes(t))); })()`,
            WAIT_MS
        );
    const read = (h) => h.ev(readMarks);
    const lineOf = (m, pairId) => m?.lines.find((l) => l.pair === pairId);
    const waitLine = (h, pairId, state) =>
        polishWaitFor(h, `!!${LAYER}?.querySelector('${MARK(pairId)}[data-state="${state}"]')`, WAIT_MS);
    // a line has settled on one state: its previous text has finished fading out and its row has stopped opening
    const waitSettled = async (h, pairId, state) => {
        await waitLine(h, pairId, state);
        return polishWaitFor(
            h,
            `(() => { const m = ${LAYER}?.querySelector('${MARK(pairId)}'); return !!m && m.querySelectorAll("[data-chat-pair-mark-text]").length === 1 && !m.parentElement.classList.contains("overflow-hidden"); })()`,
            WAIT_MS
        );
    };
    const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);

    return [
        {
            name: NAME,
            surface: "agent",
            async arrange(h) {
                // the worker's transcript is a file of the scenario's own, so nothing is written into ~/.claude/projects
                const ctx = { dir: mkdtempSync(join(tmpdir(), "verify-chat-judge-reply-")) };
                try {
                    await h.goto("agent");
                    // a window wide enough for the header's words (a narrower one turns every label into its icon)
                    await h.cdp("Emulation.setDeviceMetricsOverride", { width: WINDOW_W, height: 950, deviceScaleFactor: 1, mobile: false });
                    ctx.sized = true;
                    await watchCenter(h);
                    ctx.now = Date.now();
                    // the flag goes first: a pane starts as soon as the roster names its block
                    await markFixture(h, true);
                    ctx.transcript = writeRoundsTranscript(ctx.dir, ctx.now);
                    // an unregistered project: Chat reads the ended pairs of the agent's registered project path, and the mock keeps every
                    // pair, so none is left out for a name that is somebody's real project
                    await setRoster(
                        h,
                        pairRoster(ctx.now, { workerTranscript: ctx.transcript }).map((a) => ({ ...a, project: ROUND_PROJECT }))
                    );
                    await stubPairRpc(h);
                    await seedPair(h, []);
                    await agentPage(h, `const M = await mod("app/view/agents/chatmodestore.ts"); M.setChatMode(${q(PAIR.worker)}, "chat"); return true;`);
                    ctx.ready = await polishWaitFor(h, `!!document.querySelector('[data-agent-row="${PAIR.worker}"]')`, WAIT_MS);
                } catch (e) {
                    ctx.arrangeError = String(e?.message ?? e);
                }
                return ctx;
            },
            async assert(h, ctx) {
                const steps = [];
                const rec = (step, ok, detail) => steps.push({ step, ok: ok === true, detail: typeof detail === "string" ? detail : JSON.stringify(detail) });
                // a step that throws is a failed step, not the end of the run
                const run = async (name, fn) => {
                    try {
                        await fn();
                    } catch (e) {
                        rec(name, false, `the step threw: ${String(e?.message ?? e)}`);
                    }
                };
                rec("0. the roster, the worker's six-reply transcript, the stubs and an empty pair list were set", ctx.arrangeError == null && ctx.ready === true, ctx.arrangeError ?? { ready: ctx.ready });
                if (ctx.arrangeError != null) return steps;

                const now = () => Date.now();
                // the reply the rounds below start from: the third, an older one (three replies come after it)
                const FROM = 3;

                await run("reading-line", async () => {
                    // a round whose judge owes its first answer, started from the third reply: its line under that reply holds a
                    // spinner and the seconds, which tick; the bar runs from that reply to the bottom; Open pair is at the line's
                    // end and opens the pair's conversation
                    await show(h, PAIR.worker);
                    const drawn = await repliesDrawn(h);
                    await seedPair(h, [roundView(now(), { id: "round-a", from: FROM - 1, startedAgo: 12_000 })]);
                    await waitSettled(h, "round-a", "reading");
                    await scrollTo(h, MARK("round-a"));
                    await polishNap(500);
                    const m = await read(h);
                    const first = lineOf(m, "round-a");
                    const secs = (l) => Number(/(\d+) s$/.exec(l?.text ?? "")?.[1] ?? NaN);
                    await shot(h, "reading-line");
                    await polishNap(2300);
                    const later = lineOf(await read(h), "round-a");
                    const span = barSpan(m, "round-a");
                    const at = replyAt(m, FROM);
                    const before = m.rows[at - 1];
                    const tapped = await tap(h, `${MARK("round-a")} [data-chat-pair-mark-open="pair"]`);
                    let center;
                    const modes = [];
                    for (let i = 0; i < 12; i++) {
                        center = await readCenter(h);
                        modes.push(...center.modes);
                        if (modes.includes("pair")) break;
                        await polishNap(250);
                    }
                    await leaveCenter(h);
                    await polishWaitFor(h, `!!${LAYER}?.querySelector('${MARK("round-a")}')`, WAIT_MS);
                    rec(
                        "reading-line: a round whose judge has not answered yet has its line right under the third reply (8px below it): the spinner and \"The judge is reading this reply · N s\" with N from 12 and ticking up by the next read, Open pair at the line's end; the accent bar (2px, hung 12px left, reaching 16px below the row) is on every row from that reply to the last with none missing and none before it, the line's row included; pressing Open pair opens that pair's conversation",
                        drawn === true &&
                            first?.state === "reading" &&
                            first.spinner === true &&
                            /^The judge is reading this reply · \d+ s$/.test(first.text) &&
                            secs(first) >= 12 &&
                            secs(first) < 60 &&
                            secs(later) >= secs(first) + 2 &&
                            first.under === FROM &&
                            Math.abs(first.gap - 8) <= 2 &&
                            same(first.action, { kind: "pair", text: "Open pair" }) &&
                            first.actionAtEnd === true &&
                            at >= 0 &&
                            span.from === at &&
                            span.to === m.rows.length - 1 &&
                            span.contiguous &&
                            span.drawn &&
                            same(span.states, ["live"]) &&
                            same(span.colors, [m.accent]) &&
                            before?.bar == null &&
                            first.bar === "round-a" &&
                            tapped === true &&
                            modes.includes("pair") &&
                            center.pair === "round-a",
                        { drawn, first, later: later?.text, span, at, before, accent: m.accent, tapped, modes, pair: center?.pair }
                    );
                });

                await run("live-bar", async () => {
                    // the judge has answered: the line reads "⚖ The judge round starts here" (no spinner) with Open pair, and the
                    // accent bar still runs from the third reply to the bottom, every turn between and after it covered
                    await seedPair(h, [roundView(now(), { id: "round-a", from: FROM - 1, judged: true, startedAgo: 3 * MIN })]);
                    await waitSettled(h, "round-a", "live");
                    await scrollTo(h, MARK("round-a"));
                    await polishNap(500);
                    const m = await read(h);
                    const line = lineOf(m, "round-a");
                    const span = barSpan(m, "round-a");
                    const at = replyAt(m, FROM);
                    await shot(h, "live-bar");
                    rec(
                        "live-bar: after a judge message the line under the third reply reads \"⚖ The judge round starts here\" (no spinner, no seconds) with Open pair at its end, and the accent bar covers the item rows from that reply to the last one, the rows of the three replies after it and their asks included",
                        line?.state === "live" &&
                            line.text === "⚖ The judge round starts here" &&
                            line.spinner === false &&
                            line.texts === 1 &&
                            same(line.action, { kind: "pair", text: "Open pair" }) &&
                            line.actionAtEnd === true &&
                            line.under === FROM &&
                            line.bar === "round-a" &&
                            line.barState === "live" &&
                            span.from === at &&
                            span.to === m.rows.length - 1 &&
                            span.count === m.rows.length - at &&
                            span.contiguous &&
                            span.drawn &&
                            same(span.states, ["live"]) &&
                            same(span.colors, [m.accent]) &&
                            m.rows.slice(0, at).every((r) => r.bar == null),
                        { line, span, at, rows: m.rows.length, accent: m.accent }
                    );
                });

                await run("ended-mark", async () => {
                    // the round ended after the worker's fourth reply: a grey bar from the third reply to the fourth (the ask of
                    // the fourth between them), none on the turns after; the line is one button that reads the round's times and
                    // counts; pressing it opens the pair's page in Library
                    const view = roundView(now(), { id: "round-a", from: FROM - 1, last: FROM, ended: true, startedAgo: 25 * MIN, agreed: 3, open: 0 });
                    await seedPair(h, [view]);
                    await waitSettled(h, "round-a", "ended");
                    // the bar's colour eases for 360 ms
                    await polishNap(700);
                    await scrollTo(h, MARK("round-a"));
                    await polishNap(400);
                    const m = await read(h);
                    const line = lineOf(m, "round-a");
                    const span = barSpan(m, "round-a");
                    const at = replyAt(m, FROM);
                    const lastAt = replyAt(m, FROM + 1);
                    await shot(h, "ended-mark");
                    // the times of the round: when it began (the pair's createdts) to its last message
                    const want = `⚖ Judge round ${hhmm(view.createdts)}–${hhmm(view.lastts)} · 3 agreed, 0 open`;
                    const tapped = await tap(h, `${MARK("round-a")} [data-chat-pair-mark-open="library"]`);
                    const opened = await polishWaitFor(h, `!!document.querySelector('[data-library] [data-pair-read="round-a"]')`, WAIT_MS);
                    const surface = await h.activeSurfaceLabel();
                    await clearLibraryPair(h);
                    await show(h, PAIR.worker);
                    await polishWaitFor(h, `!!${LAYER}?.querySelector('${MARK("round-a")}')`, WAIT_MS);
                    rec(
                        "ended-mark: an ended round's grey bar covers the third reply to the fourth and nothing after it; its line under the third reply is one button reading \"⚖ Judge round HH:MM–HH:MM · 3 agreed, 0 open\" (the round's first and last times), with no spinner and no Open pair; pressing it goes to Library and opens that pair's page",
                        line?.state === "ended" &&
                            line.text === want &&
                            line.spinner === false &&
                            same(line.action, { kind: "library", text: line.text }) &&
                            line.wholeButton === true &&
                            line.under === FROM &&
                            line.bar === "round-a" &&
                            line.barState === "ended" &&
                            at >= 0 &&
                            lastAt === at + 2 &&
                            span.from === at &&
                            span.to === lastAt &&
                            span.contiguous &&
                            span.drawn &&
                            same(span.states, ["ended"]) &&
                            same(span.colors, [m.grey]) &&
                            m.rows.slice(lastAt + 1).every((r) => r.bar == null) &&
                            tapped === true &&
                            opened === true &&
                            surface === "Library",
                        { line, want, span, at, lastAt, grey: m.grey, tapped, opened, surface }
                    );
                });

                await run("two-rounds", async () => {
                    // the third reply started two rounds, an ended one and a live one: both lines sit under it, the older above;
                    // the bars overlap on the third and fourth replies, where only the newer round's (accent) is drawn
                    const older = roundView(now(), { id: "round-a", from: FROM - 1, last: FROM, ended: true, startedAgo: 40 * MIN, agreed: 2, open: 1 });
                    const newer = roundView(now(), { id: "round-b", from: FROM - 1, judged: true, startedAgo: 5 * MIN });
                    await seedPair(h, [older, newer]);
                    await waitSettled(h, "round-a", "ended");
                    await waitSettled(h, "round-b", "live");
                    await polishNap(700);
                    await scrollTo(h, MARK("round-b"));
                    await polishNap(400);
                    const m = await read(h);
                    const lines = m.lines.filter((l) => l.under === FROM);
                    const olderLine = lineOf(m, "round-a");
                    const newerLine = lineOf(m, "round-b");
                    const spanA = barSpan(m, "round-a");
                    const spanB = barSpan(m, "round-b");
                    const at = replyAt(m, FROM);
                    await shot(h, "two-rounds");
                    rec(
                        "two-rounds: the third reply carries both lines, the older round's (\"⚖ Judge round HH:MM–HH:MM · 2 agreed, 1 open\") above the newer's (\"⚖ The judge round starts here\"); every row from the third reply to the last carries the newer round's accent bar, and none carries the older round's, the lines' own rows included",
                        same(lines.map((l) => l.pair), ["round-a", "round-b"]) &&
                            olderLine?.state === "ended" &&
                            /^⚖ Judge round \d\d:\d\d–\d\d:\d\d · 2 agreed, 1 open$/.test(olderLine.text) &&
                            newerLine?.state === "live" &&
                            newerLine.text === "⚖ The judge round starts here" &&
                            olderLine.bar === "round-b" &&
                            newerLine.bar === "round-b" &&
                            olderLine.barState === "live" &&
                            spanA.count === 0 &&
                            spanB.from === at &&
                            spanB.to === m.rows.length - 1 &&
                            spanB.contiguous &&
                            spanB.drawn &&
                            same(spanB.states, ["live"]) &&
                            same(spanB.colors, [m.accent]),
                        { lines, spanA, spanB, at, accent: m.accent }
                    );
                });

                await run("motion", async () => {
                    // Frames, not end states. (1) a round starting under a reply already drawn: its line's row opens on the spring
                    // (height and opacity pass through values between closed and open). (2) the round ends: the bar's colour eases
                    // from the accent to the grey over frames, and the line's text cross-fades (two texts at once, in between). (3)
                    // the same two under reduced motion are at their end state at once: no frame between.
                    const empty = async () => {
                        await seedPair(h, []);
                        await polishWaitFor(h, `!${LAYER}?.querySelector("[data-chat-pair-mark]")`, WAIT_MS);
                        await polishNap(300);
                    };
                    const opening = async (id) => {
                        await startFrames(h, id);
                        await seedPair(h, [roundView(now(), { id, from: 3, startedAgo: 2_000 })]);
                        await waitSettled(h, id, "reading");
                        await polishNap(600);
                        return stopFrames(h);
                    };
                    const ending = async (id) => {
                        await startFrames(h, id);
                        await seedPair(h, [roundView(now(), { id, from: 3, last: 4, ended: true, startedAgo: 20 * MIN, agreed: 1, open: 0 })]);
                        await waitSettled(h, id, "ended");
                        await polishNap(700);
                        return stopFrames(h);
                    };
                    const drawnFrames = (frames) => frames.filter((f) => f.h != null);
                    const colorsOf = (frames) => [...new Set(frames.map((f) => f.color).filter((c) => c != null))];
                    const between = (frames, lo, hi) => frames.filter((f) => f.h != null && f.h > lo && f.h < hi);

                    await empty();
                    const openFrames = await opening("round-c");
                    const rowsOpen = drawnFrames(openFrames);
                    const fullH = rowsOpen.at(-1)?.h ?? 0;
                    const midOpen = between(rowsOpen, 2, fullH - 2);
                    const heightsOpen = [...new Set(rowsOpen.map((f) => f.h))];
                    await scrollTo(h, MARK("round-c"));
                    await polishNap(300);
                    const endFrames = await ending("round-c");
                    const colors = colorsOf(endFrames);
                    const m = await read(h);
                    const swap = endFrames.filter((f) => f.texts.length >= 2 || f.texts.some((o) => o > 0 && o < 1));
                    await shot(h, "motion");
                    rec(
                        "motion: a round starting under a reply already drawn opens its line on the spring: the row's height passes through values between closed and open over several frames, and its opacity rises through 0..1; when the round ends the bar's colour eases from the accent through colours between to the grey, and the line's text cross-fades (a frame with two texts, or one between 0 and 1) ending on one text",
                        rowsOpen.length >= 3 &&
                            (rowsOpen[0].h ?? 99) < fullH - 2 &&
                            fullH > 10 &&
                            midOpen.length >= 2 &&
                            heightsOpen.length >= 4 &&
                            rowsOpen.some((f) => f.o > 0.05 && f.o < 0.95) &&
                            rowsOpen.at(-1).o === 1 &&
                            colors.length >= 4 &&
                            colors[0] === m.accent &&
                            colors.at(-1) === m.grey &&
                            swap.length >= 1 &&
                            endFrames.at(-1).texts.length === 1 &&
                            lineOf(m, "round-c")?.state === "ended",
                        {
                            open: { frames: rowsOpen.length, fullH, first: rowsOpen[0], mid: midOpen.length, heights: heightsOpen.length, opacities: rowsOpen.slice(0, 8).map((f) => f.o) },
                            end: { colors, accent: m.accent, grey: m.grey, swap: swap.length, lastTexts: endFrames.at(-1)?.texts },
                        }
                    );

                    const reduced = await reduceMotion(h, true);
                    await empty();
                    const reducedOpen = drawnFrames(await opening("round-d"));
                    await scrollTo(h, MARK("round-d"));
                    await polishNap(300);
                    const reducedEnd = await ending("round-d");
                    const reducedColors = colorsOf(reducedEnd);
                    const reducedSwap = reducedEnd.filter((f) => f.texts.some((o) => o > 0 && o < 1));
                    const settledH = reducedOpen.at(-1)?.h ?? 0;
                    await reduceMotion(h, false);
                    rec(
                        "motion (reduced): with prefers-reduced-motion on, a new round's line is at its full height in the first frame it is drawn (no frame between), the bar goes from the accent to the grey with no colour between, and no text is caught half-faded",
                        reduced === true &&
                            reducedOpen.length >= 1 &&
                            settledH > 10 &&
                            reducedOpen.every((f) => Math.abs(f.h - settledH) <= 1 && f.o === 1) &&
                            reducedColors.length === 2 &&
                            reducedSwap.length === 0 &&
                            reducedEnd.at(-1).texts.length === 1,
                        { reduced, open: { frames: reducedOpen.length, settledH, heights: [...new Set(reducedOpen.map((f) => f.h))] }, end: { colors: reducedColors, swap: reducedSwap.length } }
                    );
                });

                return steps;
            },
            async teardown(h, ctx) {
                const failures = [];
                const attempt = async (what, fn) => {
                    try {
                        await fn();
                    } catch (e) {
                        failures.push(`${what}: ${e?.message ?? e}`);
                    }
                };
                await attempt("stop sampling frames", () => stopFrames(h));
                await attempt("reduced motion back", () => h.cdp("Emulation.setEmulatedMedia", { media: "", features: [{ name: "prefers-reduced-motion", value: "" }] }));
                await attempt("leave the pair centre mode", () => leaveCenter(h));
                await attempt("stop recording the centre modes", () => unwatchCenter(h));
                await attempt("close Library's pair", () => clearLibraryPair(h));
                if (ctx.sized) await attempt("restore the window size", () => h.cdp("Emulation.clearDeviceMetricsOverride", {}));
                await attempt("put the generated pair commands back", () => restorePairRpc(h));
                await attempt("clear the pair mocks", () => seedPair(h, null));
                await attempt("drop the pair roster", () => restoreRoster(h));
                await attempt("put the fixture flag back", () => markFixture(h, false));
                await attempt("remove the worker's fixture transcript", () =>
                    rmSync(ctx.dir, { recursive: true, force: true, maxRetries: 20, retryDelay: 500 })
                );
                if (failures.length > 0) throw new Error(failures.join("; "));
            },
        },
    ];
}
