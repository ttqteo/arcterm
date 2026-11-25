// pair-conversation: board R1's centre, the pair's conversation (docs/superpowers/specs/2026-11-25-agent-pair-judge-design.md;
// frontend/app/view/agents/pairpane.tsx). No agent runs and wavesrv is never asked: the roster goes in the page's dev mock
// roster and the pair in its dev mock pairs (pair-fixtures.mjs), and the seven RpcApi.Pair*Command methods are stubs that
// record what the page calls, so a click that should reach wavesrv is read back from the stub.
// Narrowing the timeline (a fixed max height) is only how quote-jump gets a conversation longer than the window.
// kit is scenarios.mjs's RT_KIT (polishWaitFor, polishNap).

import { agentPage, focusAgent, restoreRoster, setRoster } from "./agent-page-fixtures.mjs";
import { HELD_COMMAND, PAIR, pairRoster, pairRpcCalls, pairView, restorePairRpc, seedPair, stubPairRpc } from "./pair-fixtures.mjs";

const NAME = "pair-conversation";
const WAIT_MS = 8_000;
const shot = (h, step) => h.shot(`cdp-shots/${NAME}-${step}.png`);

const PANE = `document.querySelector("[data-pair-pane]")`;
const TIMELINE = `document.querySelector("[data-pair-timeline]")`;
const MSG = (id) => `document.querySelector('[data-pair-msg="${id}"]')`;
const SHORT = { worker: PAIR.worker.slice(0, 8), judge: PAIR.judge.slice(0, 8), other: PAIR.other.slice(0, 8) };
const PLACEHOLDER = "Talk to both… · @worker or @judge for one";

// the pane as the steps read it: the bar, and each message's side, head, quote, held lines and where its block sits
const readPane = `(() => {
    const pane = ${PANE};
    if (!pane) return null;
    const flat = (el) => (el?.textContent ?? "").replace(/\\s+/g, " ").trim();
    // the messages sit in Chat's 760px column, centred in the timeline: lean and width are read against that column
    const tl = (pane.querySelector("[data-pair-column]") ?? ${TIMELINE}).getBoundingClientRect();
    // the scroller's content box, its scrollbar left out, which the column is centred in
    const sc = ${TIMELINE};
    const scMid = sc.getBoundingClientRect().left + sc.clientLeft + sc.clientWidth / 2;
    const mid = (tl.left + tl.right) / 2;
    const msgs = [...pane.querySelectorAll("[data-pair-msg]")].map((m) => {
        const art = m.querySelector("article");
        const r = art?.getBoundingClientRect();
        const quote = m.querySelector("[data-pair-quote]");
        return {
            id: m.getAttribute("data-pair-msg"),
            side: m.getAttribute("data-side"),
            // the head's pieces are flex items a gap apart, with no space between them in the text: join them with one
            head: art ? [...art.firstElementChild.children].map(flat).join(" ") : flat(m),
            judge: flat(m.querySelector("[data-pair-judge-name]")),
            quote: quote ? flat(quote) : null,
            quoteTo: quote ? quote.getAttribute("data-pair-quote") : null,
            quoteIsButton: quote ? quote.tagName === "BUTTON" : null,
            held: [...m.querySelectorAll("[data-pair-held]")].map((x) => ({
                state: x.getAttribute("data-pair-held"),
                text: flat(x),
                button: !!x.querySelector("[data-pair-run-now]"),
                dashed: getComputedStyle(x).borderTopStyle === "dashed",
            })),
            leans: r ? (((r.left + r.right) / 2 < mid) ? "left" : "right") : null,
            widthPct: r ? Math.round((r.width / tl.width) * 100) : null,
            reply: !!m.querySelector("[data-pair-reply]"),
        };
    });
    const comp = pane.querySelector("[data-pair-composer]");
    return {
        // the agent header stays over the conversation: its Pair button is lit, and is the way back
        toggle: (() => {
            const b = document.querySelector("[data-agent-header] [data-pair-open]");
            // its words give way to the icon when the header is narrow, so it is read by its label
            return b ? { pressed: b.getAttribute("aria-pressed"), label: b.getAttribute("aria-label") } : null;
        })(),
        back: !!pane.querySelector("[data-pair-back]"),
        title: flat(pane.querySelector("[data-pair-title]")),
        states: [...pane.querySelectorAll("[data-pair-judge-state]")].map(flat),
        unpair: !!pane.querySelector("[data-pair-unpair]"),
        msgs,
        placeholder: comp?.getAttribute("placeholder") ?? null,
        column: { width: Math.round(tl.width), centred: Math.abs((tl.left + tl.right) / 2 - scMid) <= 2 },
        // no round counter anywhere
        rounds: /\\bround\\b/i.test(flat(pane)),
    };
})()`;

// a real mouse at the centre of an element (a hover needs a real move; a click goes through the page's own handlers)
async function mouseAt(h, selectorExpr, type) {
    const at = await h.ev(`(() => {
        const r = (${selectorExpr})?.getBoundingClientRect();
        return r ? { x: r.left + r.width / 2, y: r.top + r.height / 2 } : null;
    })()`);
    if (at == null) return false;
    if (type === "move") {
        await h.cdp("Input.dispatchMouseEvent", { type: "mouseMoved", x: at.x, y: at.y });
    } else {
        for (const t of ["mousePressed", "mouseReleased"]) {
            await h.cdp("Input.dispatchMouseEvent", { type: t, x: at.x, y: at.y, button: "left", clickCount: 1 });
        }
    }
    return true;
}
const click = (h, expr) => mouseAt(h, expr, "click");
const hover = (h, expr) => mouseAt(h, expr, "move");

const pressEnter = async (h) => {
    for (const type of ["keyDown", "keyUp"]) {
        await h.cdp("Input.dispatchKeyEvent", { type, key: "Enter", code: "Enter", windowsVirtualKeyCode: 13, ...(type === "keyDown" ? { text: "\r" } : {}) });
    }
};

const centerMode = (h) => agentPage(h, `const { centerModeAtom } = await mod("app/view/agents/agentcenter.ts"); return globalStore.get(centerModeAtom);`);
const showPair = (h) => agentPage(h, `const { showPair } = await mod("app/view/agents/agentcenter.ts"); showPair(${JSON.stringify(PAIR.id)}); return true;`);
const leave = (h) =>
    agentPage(
        h,
        `const { showTerminal, pairSelAtom } = await mod("app/view/agents/agentcenter.ts");
        const { pairSeenAtom } = await mod("app/view/agents/pairstore.ts");
        showTerminal();
        globalStore.set(pairSelAtom, null);
        globalStore.set(pairSeenAtom(${JSON.stringify(PAIR.id)}), 0);
        return true;`
    );
// the timeline given a fixed height, so a conversation of five messages scrolls; null puts it back
const squeeze = (h, px) => h.ev(`(() => { const t = ${TIMELINE}; if (!t) return false; t.style.flex = ${px == null ? '""' : '"none"'}; t.style.height = ${px == null ? '""' : JSON.stringify(px + "px")}; return true; })()`);
// the pane given a fixed width, as a narrow centre column is, and a fixed height too when asked (which takes it out of the
// column's flex, so only the picture's framing asks); null puts both back
const narrow = (h, px, height) =>
    h.ev(`(() => {
        const p = ${PANE};
        if (!p) return false;
        p.style.width = ${px == null ? '""' : JSON.stringify(px + "px")};
        p.style.height = ${px == null || height == null ? '""' : JSON.stringify(height + "px")};
        p.style.flex = ${px == null || height == null ? '""' : '"none"'};
        return true;
    })()`);

// Watches a change move: `change` (a statement block that runs in the page, with the app's modules at hand) is made, and in
// the same frame the height of `target` (an expression) is read on every animation frame for `ms`. A change drawn in one
// frame reads as one jump; one on the spring reads as a run of heights that settles. `gap` is how far the timeline's end is
// from its bottom edge when it is over.
const frames = (h, change, target, ms = 1000) =>
    agentPage(
        h,
        `const reduced = matchMedia("(prefers-reduced-motion: reduce)").matches;
        const out = [];
        ${change}
        const t0 = performance.now();
        await new Promise((done) => {
            const tick = () => {
                const el = ${target};
                out.push(el ? Math.round(el.getBoundingClientRect().height * 10) / 10 : null);
                if (performance.now() - t0 < ${ms}) requestAnimationFrame(tick); else done();
            };
            requestAnimationFrame(tick);
        });
        const tl = document.querySelector("[data-pair-timeline]");
        return { reduced, out, gap: Math.round(tl.scrollHeight - tl.scrollTop - tl.clientHeight) };`
    );
const summary = (r) => {
    const hs = r.out.filter((x) => x != null);
    const last = hs.at(-1);
    return { reduced: r.reduced, first: hs[0], last, distinct: new Set(hs).size, settled: hs.slice(-5).every((x) => x === last), gap: r.gap };
};
// what moved well: it changed by at least `min` px, settled, and ran through several heights on the way (a single jump is a
// snap) or, under reduced motion, jumped at once
const movedWell = (m, min) =>
    m.settled && Math.abs(m.last - m.first) >= min && (m.reduced ? m.distinct <= 2 : m.distinct >= 3);

export default function (kit) {
    const { polishWaitFor, polishNap } = kit;
    return [
        {
            name: NAME,
            surface: "agent",
            async arrange(h) {
                const ctx = { now: Date.now() };
                try {
                    await h.goto("agent");
                    await setRoster(h, pairRoster(ctx.now));
                    await stubPairRpc(h);
                    await seedPair(h, [pairView(ctx.now)]);
                    await focusAgent(h, PAIR.worker);
                    ctx.ready = await polishWaitFor(h, `!!document.querySelector('[data-agent-row="${PAIR.worker}"]')`, WAIT_MS);
                } catch (e) {
                    ctx.arrangeError = String(e?.message ?? e);
                }
                return ctx;
            },
            async assert(h, ctx) {
                const steps = [];
                const rec = (step, ok, detail) => steps.push({ step, ok: ok === true, detail: typeof detail === "string" ? detail : JSON.stringify(detail) });
                rec("0. the fixture roster and pair were set, and the pair RPCs stubbed", ctx.arrangeError == null && ctx.ready === true, ctx.arrangeError ?? { ready: ctx.ready });
                if (ctx.arrangeError != null || ctx.ready !== true) return steps;

                // conversation: the R1 centre. Worker left, judge right, heads, quotes, the held line, one composer, no rounds
                await showPair(h);
                await polishWaitFor(h, `${PANE}?.querySelectorAll("[data-pair-msg]").length === 5`, WAIT_MS);
                await polishNap(400);
                const convo = await h.ev(readPane);
                const byId = Object.fromEntries((convo?.msgs ?? []).map((m) => [m.id, m]));
                await shot(h, "1-conversation");
                // the What's new picture is 2:1 and the pane is taller than that, so it is shaped to 2:1 for the picture alone
                // (its bar, the newest messages and the composer in one frame), with the timeline at its end, and let go after
                await narrow(h, 1040, 520);
                await h.ev(`(() => { const t = ${TIMELINE}; t.scrollTop = t.scrollHeight; })()`);
                await polishNap(400);
                const picture = await h.whatsnewShot("agent-pair", { selector: "[data-pair-pane]" }).catch((e) => ({ error: String(e?.message ?? e) }));
                await narrow(h, null);
                await h.ev(`(() => { const t = ${TIMELINE}; t.scrollTop = t.scrollHeight; })()`);
                rec(
                    "conversation: five messages in time order, in Chat's centred column of at most 760px, the working agent's on the left and the judge's on the right (70% of it, each with a head of who and the time), the judge's answers quoting what they answer with the quoted author, the held command as one dashed line with Run now, one composer reading its placeholder, the agent header kept over it with its Pair button lit (no back button of the pane's own), the pair's line naming the judge and its state, and no round counter",
                    convo != null &&
                        convo.msgs.map((m) => m.id).join() === "pm-opening,pm-three-points,pm-checked,pm-pilot-first,pm-accept" &&
                        convo.msgs.map((m) => `${m.side}/${m.leans}`).join() === "left/left,right/right,left/left,right/right,left/left" &&
                        convo.msgs.every((m) => m.widthPct >= 40 && m.widthPct <= 75) &&
                        convo.column.width <= 760 &&
                        convo.column.centred === true &&
                        /^Plan oracle-tightening \d\d:\d\d/.test(byId["pm-opening"].head) &&
                        /^Judge \d\d:\d\d/.test(byId["pm-three-points"].head) &&
                        byId["pm-opening"].quote === null &&
                        byId["pm-three-points"].quote === "Plan oracle-tightening About to run Step 8: 164 cases × two arms…" &&
                        byId["pm-three-points"].quoteTo === "pm-opening" &&
                        byId["pm-three-points"].quoteIsButton === true &&
                        byId["pm-accept"].quoteTo === "pm-pilot-first" &&
                        byId["pm-accept"].held.length === 1 &&
                        byId["pm-accept"].held[0].state === "held" &&
                        byId["pm-accept"].held[0].text.includes(HELD_COMMAND) &&
                        byId["pm-accept"].held[0].button === true &&
                        byId["pm-accept"].held[0].dashed === true &&
                        convo.msgs.filter((m) => m.held.length > 0).length === 1 &&
                        convo.placeholder === PLACEHOLDER &&
                        convo.toggle?.pressed === "true" &&
                        convo.toggle.label === `Paired with judge ${SHORT.judge}` &&
                        convo.back === false &&
                        convo.title === `Paired with judge ${SHORT.judge}` &&
                        convo.states.length === 1 &&
                        convo.states[0] === "judge reading · 12 s" &&
                        convo.unpair === true &&
                        convo.rounds === false &&
                        picture?.error == null,
                    { convo, picture }
                );

                // two-judges: with a second judge each right-side message names its judge, the left ones name none
                await seedPair(h, [pairView(ctx.now, { judges: 2 })]);
                await polishWaitFor(h, `!!${MSG("pm-second-judge")}`, WAIT_MS);
                await polishNap(300);
                const two = await h.ev(readPane);
                const twoById = Object.fromEntries((two?.msgs ?? []).map((m) => [m.id, m]));
                await shot(h, "2-two-judges");
                rec(
                    "two-judges: each right-side message names its judge by its short id (the first judge's two, the second's one), the left-side messages name none, the bar reads Paired with 2 judges with both judges' state",
                    two != null &&
                        twoById["pm-three-points"].judge === SHORT.judge &&
                        twoById["pm-pilot-first"].judge === SHORT.judge &&
                        twoById["pm-second-judge"].judge === SHORT.other &&
                        two.msgs.filter((m) => m.side === "left").every((m) => m.judge === "") &&
                        two.title === "Paired with 2 judges" &&
                        two.states.length === 2 &&
                        two.states[0].startsWith(`judge ${SHORT.judge} reading`) &&
                        two.states[1].startsWith(`judge ${SHORT.other} idle`),
                    two
                );
                await seedPair(h, [pairView(ctx.now)]);
                await polishWaitFor(h, `!${MSG("pm-second-judge")}`, WAIT_MS);

                // quote-jump: with the timeline too short for the conversation, a quote click scrolls its message into view
                await squeeze(h, 230);
                await h.ev(`(() => { const t = ${TIMELINE}; t.scrollTop = t.scrollHeight; })()`);
                await polishNap(300);
                const inView = (id) => `(() => {
                    const t = ${TIMELINE}.getBoundingClientRect();
                    const r = ${MSG(id)}?.getBoundingClientRect();
                    return !!r && r.top >= t.top - 1 && r.bottom <= t.bottom + 1;
                })()`;
                const beforeJump = await h.ev(inView("pm-pilot-first"));
                await click(h, `${MSG("pm-accept")}.querySelector("[data-pair-quote]")`);
                // the mark lasts about a second: read in the same poll that sees the message land
                const marked = `(${MSG("pm-pilot-first")}?.querySelector("article")?.className ?? "").includes("border-accent")`;
                const landed = await polishWaitFor(h, `${inView("pm-pilot-first")} && ${marked}`, WAIT_MS);
                const flashed = landed;
                await shot(h, "3-quote-jump");
                rec(
                    "quote-jump: with the timeline cut to 230px and scrolled to the end, the message pm-pilot-first is out of view; clicking the quote in pm-accept scrolls it fully into view and marks it for a moment",
                    beforeJump === false && landed === true && flashed === true,
                    { beforeJump, landed, flashed }
                );
                await squeeze(h, null);

                // reply-hover: Reply shows on hover only, and puts the quote of that message in the composer
                await hover(h, `document.querySelector("[data-pair-composer]")`);
                await polishNap(250);
                const replyOpacity = (id) => `getComputedStyle(${MSG(id)}.querySelector("[data-pair-reply]")).opacity`;
                const idleOpacity = await h.ev(replyOpacity("pm-pilot-first"));
                await hover(h, `${MSG("pm-pilot-first")}.querySelector("article")`);
                const shown = await polishWaitFor(h, `${replyOpacity("pm-pilot-first")} === "1"`, WAIT_MS);
                await click(h, `${MSG("pm-pilot-first")}.querySelector("[data-pair-reply]")`);
                await polishWaitFor(h, `!!document.querySelector("[data-pair-reply-chip]")`, WAIT_MS);
                const chip = await h.ev(`(document.querySelector("[data-pair-reply-chip]")?.textContent ?? "").replace(/\\s+/g, " ").trim()`);
                const focusedComposer = await h.ev(`document.activeElement === document.querySelector("[data-pair-composer]")`);
                // the chip opens on the spring: the shot waits for it to settle
                await polishNap(600);
                await shot(h, "4-reply");
                rec(
                    "reply-hover: Reply is invisible until the message is hovered, then a click puts \"Replying to Judge: Pilot first is right…\" in the composer and focuses it",
                    idleOpacity === "0" &&
                        shown === true &&
                        chip.startsWith("Replying to Judge: Pilot first is right, but two locks are missing") &&
                        focusedComposer === true,
                    { idleOpacity, shown, chip, focusedComposer }
                );

                // send: Enter sends the reply to both with the message it answers; @judge sends to the judge alone
                await h.cdp("Input.insertText", { text: "Use the dev split." });
                await pressEnter(h);
                await polishWaitFor(h, `!document.querySelector("[data-pair-reply-chip]") && document.querySelector("[data-pair-composer]").value === ""`, WAIT_MS);
                await h.cdp("Input.insertText", { text: "@judge is 50% safe?" });
                await pressEnter(h);
                await polishWaitFor(h, `document.querySelector("[data-pair-composer]").value === ""`, WAIT_MS);
                await h.cdp("Input.insertText", { text: "@worker" });
                await pressEnter(h);
                await polishNap(300);
                const bare = await h.ev(`document.querySelector("[data-pair-composer]").value`);
                const said = await pairRpcCalls(h, "PairSayCommand");
                await h.ev(`(() => { const c = document.querySelector("[data-pair-composer]"); c.focus(); })()`);
                rec(
                    "send: Enter sends \"Use the dev split.\" to both with replyto pm-pilot-first and clears the reply; \"@judge is 50% safe?\" goes to the judge as \"is 50% safe?\" with no reply; a bare @worker sends nothing and stays in the box",
                    said.length === 2 &&
                        JSON.stringify(said[0]) === JSON.stringify({ pairid: PAIR.id, text: "Use the dev split.", to: "both", replyto: "pm-pilot-first" }) &&
                        JSON.stringify(said[1]) === JSON.stringify({ pairid: PAIR.id, text: "is 50% safe?", to: "judge", replyto: "" }) &&
                        bare === "@worker",
                    { said, bare }
                );
                await h.ev(`(() => { const c = document.querySelector("[data-pair-composer]"); const set = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value").set; set.call(c, ""); c.dispatchEvent(new Event("input", { bubbles: true })); })()`);

                // run-now: Run now calls the command with the message and the held command, and the line reads let through
                await h.ev(`${MSG("pm-accept")}?.scrollIntoView({ block: "end" })`);
                await polishNap(300);
                await click(h, `${MSG("pm-accept")}.querySelector("[data-pair-run-now]")`);
                await polishWaitFor(h, `${MSG("pm-accept")}?.querySelector("[data-pair-held]")?.getAttribute("data-pair-held") === "through"`, WAIT_MS);
                const through = (await h.ev(readPane)).msgs.find((m) => m.id === "pm-accept").held[0];
                const runs = await pairRpcCalls(h, "PairRunNowCommand");
                await shot(h, "5-run-now");
                rec(
                    "run-now: Run now calls PairRunNowCommand once with the pair, pm-accept and the held command, then the dashed line has no button and reads let through",
                    runs.length === 1 &&
                        JSON.stringify(runs[0]) === JSON.stringify({ pairid: PAIR.id, msgid: "pm-accept", command: HELD_COMMAND }) &&
                        through.state === "through" &&
                        through.button === false &&
                        through.text.includes("let through") &&
                        through.text.includes(HELD_COMMAND),
                    { runs, through }
                );

                // arrives: a message that comes in while the person is at the end grows in on the spring (several heights, not
                // one jump), and the timeline follows its end all the way
                await h.ev(`(() => { const t = ${TIMELINE}; t.scrollTop = t.scrollHeight; })()`);
                await polishNap(250);
                const late = await frames(
                    h,
                    `const { devMockPairsAtom } = await mod("app/view/agents/pairstore.ts");
                    const view = structuredClone(globalStore.get(devMockPairsAtom)[0]);
                    view.messages.push({
                        id: "pm-late", from: "judge", tab: ${JSON.stringify(PAIR.judge)}, ts: Date.now(), quote: "", replyto: "", to: "", held: [],
                        text: "One more thing before the pilot.\\nDraw the 6 cases with a fixed seed, and write the seed into §16.8 before the first one runs.",
                    });
                    view.messagecount = view.messages.length;
                    globalStore.set(devMockPairsAtom, [view]);`,
                    `document.querySelector('[data-pair-msg="pm-late"]')`
                );
                const arrived = summary(late);
                rec(
                    "arrives: a judge's message added while the timeline is at its end grows from nothing through several heights and settles, and the timeline's end stays at its bottom edge (reduced motion: it appears at once)",
                    arrived.first < arrived.last && movedWell(arrived, 30) && arrived.gap <= 4,
                    { arrived, frames: late.out.slice(0, 40) }
                );
                await seedPair(h, [pairView(ctx.now)]);
                await polishWaitFor(h, `!${MSG("pm-late")}`, WAIT_MS);

                // reply-chip-motion: the chip a Reply puts in the composer opens the box on the spring, and folds it the same way
                await polishNap(200);
                const chipIn = summary(await frames(h, `document.querySelector('[data-pair-msg="pm-pilot-first"] [data-pair-reply]').click();`, `document.querySelector("[data-pair-composer-box]")`));
                const chipOut = summary(await frames(h, `document.querySelector("[data-pair-reply-cancel]").click();`, `document.querySelector("[data-pair-composer-box]")`));
                rec(
                    "reply-chip-motion: the composer box grows by the chip through several heights and settles, and folds back the same way on Cancel (reduced motion: at once)",
                    chipIn.last > chipIn.first && movedWell(chipIn, 15) && chipOut.last < chipOut.first && movedWell(chipOut, 15),
                    { chipIn, chipOut }
                );

                // edges: the states nobody opens. No messages says so; a 400-character command and a
                // 300-character word break nothing, in the pane and in a 520px column
                const fit = () =>
                    h.ev(`(() => {
                        const p = ${PANE};
                        const tl = ${TIMELINE};
                        const bar = p.querySelector("[data-pair-bar]").getBoundingClientRect();
                        const un = p.querySelector("[data-pair-unpair]").getBoundingClientRect();
                        const art = ${MSG("pm-accept")}.querySelector("article").getBoundingClientRect();
                        const held = ${MSG("pm-accept")}.querySelector("[data-pair-held]").getBoundingClientRect();
                        return {
                            timelineScrollsSideways: tl.scrollWidth > tl.clientWidth + 1,
                            paneScrollsSideways: p.scrollWidth > p.clientWidth + 1,
                            unpairInBar: un.left >= bar.left && un.right <= bar.right + 1,
                            heldInBlock: held.right <= art.right + 1,
                            blockInTimeline: art.right <= tl.getBoundingClientRect().right + 1,
                        };
                    })()`);
                await seedPair(h, [{ ...structuredClone(pairView(ctx.now)), messages: [], messagecount: 0 }]);
                await polishWaitFor(h, `!!document.querySelector("[data-pair-empty]")`, WAIT_MS);
                const emptyText = await h.ev(`document.querySelector("[data-pair-empty]")?.textContent ?? null`);
                const long = structuredClone(pairView(ctx.now));
                long.messages[4].held = [{ command: `python study_pilot.py --tag ${"benigngate_probe_".repeat(24)}`, ts: ctx.now }];
                long.messages[4].text += ` ${"x".repeat(300)}`;
                await seedPair(h, [long]);
                await polishWaitFor(h, `(${MSG("pm-accept")}?.textContent ?? "").includes("xxxxxxxxxx")`, WAIT_MS);
                await polishNap(300);
                const wideFit = await fit();
                await narrow(h, 520);
                await polishNap(400);
                const narrowFit = await fit();
                await shot(h, "6-edges-narrow");
                await narrow(h, null);
                await seedPair(h, [pairView(ctx.now)]);
                await polishWaitFor(h, `!!${MSG("pm-accept")} && !${MSG("pm-accept")}.textContent.includes("xxxxxxxxxx")`, WAIT_MS);
                const okFit = (f) => f.timelineScrollsSideways === false && f.paneScrollsSideways === false && f.unpairInBar && f.heldInBlock && f.blockInTimeline;
                rec(
                    "edges: a conversation with no messages reads \"No messages yet.\"; a very long held command and unbroken word push nothing out of the pane, the bar keeps Unpair, and the same holds in a 520px column",
                    emptyText === "No messages yet." && okFit(wideFit) && okFit(narrowFit),
                    { emptyText, wideFit, narrowFit }
                );

                // pair-toggle: the header's lit Pair button leaves the pair mode, to the agent's own view, and is unlit there
                const modeIn = await centerMode(h);
                await click(h, `document.querySelector("[data-agent-header] [data-pair-open]")`);
                await polishWaitFor(h, `!${PANE}`, WAIT_MS);
                const modeOut = await centerMode(h);
                const unlit = await h.ev(`document.querySelector("[data-agent-header] [data-pair-open]")?.getAttribute("aria-pressed") ?? null`);
                rec(
                    "pair-toggle: with the pair shown the centre mode is pair; the header's Pair button makes it terminal, the conversation is gone and the button is no longer pressed",
                    modeIn === "pair" && modeOut === "terminal" && (await h.ev(`!${PANE}`)) === true && unlit === "false",
                    { modeIn, modeOut, unlit }
                );

                // unpair: Unpair calls PairUnpairCommand for the pair, then the centre is the agent's Chat again
                await showPair(h);
                await polishWaitFor(h, `!!document.querySelector("[data-pair-unpair]")`, WAIT_MS);
                await click(h, `document.querySelector("[data-pair-unpair]")`);
                await polishWaitFor(h, `!${PANE}`, WAIT_MS);
                const unpaired = await pairRpcCalls(h, "PairUnpairCommand");
                rec(
                    "unpair: Unpair calls PairUnpairCommand once with the pair id, and the centre goes back to terminal",
                    unpaired.length === 1 && JSON.stringify(unpaired[0]) === JSON.stringify({ pairid: PAIR.id }) && (await centerMode(h)) === "terminal",
                    { unpaired }
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
                await attempt("put the timeline's height back", () => squeeze(h, null));
                await attempt("put the pane's width back", () => narrow(h, null));
                await attempt("leave the pair mode", () => leave(h));
                await attempt("restore the pair RPCs", () => restorePairRpc(h));
                await attempt("drop the seeded pairs", () => seedPair(h, null));
                await attempt("drop the fixture roster", () => restoreRoster(h));
                if (failures.length > 0) throw new Error(failures.join("; "));
            },
        },
    ];
}
