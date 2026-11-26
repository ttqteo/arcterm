// pair-header: board K2, ⚖ Judge this reply under each reply of the working agent's Chat, and the header once paired
// (docs/superpowers/specs/2026-11-25-agent-pair-judge-design.md and 2026-11-26-judge-on-reply-design.md;
// frontend/app/view/agents/chatconversation.tsx, pairjudgemenu.tsx, pairlaunch.ts). The header of an agent in no pair has no
// pair control: ⚖ is the way in, and its menu starts the pair from the reply it sits under (`from`, the record's uuid).
// No agent runs and wavesrv's pair commands are never called: the roster is pair-fixtures.mjs's, set into the page's dev
// mock roster, its worker reading a fixture transcript of two turns whose replies carry uuids (writeWorkerTranscript); the
// pairs are its views, set into the page's dev mock pairs; the seven RpcApi.Pair*Command methods are the fixtures'
// recording stubs. Open a new judge (a real launch of a claude tab) is not run: pairlaunch.test.ts covers its order and its
// gate over mocks; here a live agent is picked, which is PairStart and the conversation. Waking the resting judge (a
// launched judge asleep after its round, seeded with seedResting) is the menu's first entry: wake-judge.
// kit is scenarios.mjs's RT_KIT (polishWaitFor, polishNap).

import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { agentPage, focusAgent, restoreRoster, setRoster } from "./agent-page-fixtures.mjs";
import {
    PAIR,
    WORKER_REPLIES,
    pairRoster,
    pairRpcCalls,
    pairView,
    restorePairRpc,
    seedPair,
    seedResting,
    stubPairRpc,
    writeWorkerTranscript,
} from "./pair-fixtures.mjs";

const NAME = "pair-header";
const WAIT_MS = 8_000;
const WINDOW_W = 1900;
const q = JSON.stringify;
const shot = (h, step) => h.shot(`cdp-shots/${NAME}-${step}.png`);

const HEADER = `document.querySelector("[data-agent-header]")`;
const MENU = `document.querySelector("[data-pair-judge-menu]")`;

// The replies of the worker's Chat the steps work on, each found by the words it opens with (the text of a reply is its
// prose part's textContent): `older` is the first turn's reply, which has an earlier prose part (`early`) split from it by a
// tool call, and `latest` the second turn's.
const NEEDLE = {
    early: WORKER_REPLIES.early.text.slice(0, 24),
    older: WORKER_REPLIES.older.text.slice(0, 24),
    latest: WORKER_REPLIES.latest.text.slice(0, 24),
};
// the worker's own Chat layer (the Agent surface keeps one per agent), and the prose part of one reply in it
const LAYER = `document.querySelector('[data-agent-chat="${PAIR.worker}"]:not([data-chat-leaving])')`;
const proseOf = (needle) =>
    `[...((${LAYER})?.querySelectorAll("[data-chat-prose]") ?? [])].find((p) => (p.textContent ?? "").includes(${q(needle)}))`;

// a reply as the steps read it: the row under it (its opacity: hover or focus reveals it), the order of its buttons, and its
// ⚖ (null when it has none)
const readReply = (needle) => `(() => {
    const p = ${proseOf(needle)};
    if (!p) return null;
    const row = p.querySelector("[data-chat-copy]");
    const b = row?.querySelector("[data-chat-judge-reply]");
    const kids = [...(row?.children ?? [])].map((c) =>
        c.hasAttribute("data-chat-judge-reply") ? "judge" : c.hasAttribute("data-chat-fork") ? "fork" : c.hasAttribute("data-chat-add-initiative") ? "initiative" : "copy"
    );
    return {
        row: row != null,
        rowOpacity: row ? Number(getComputedStyle(row).opacity) : null,
        kids,
        judge: b
            ? {
                  label: b.getAttribute("aria-label"),
                  title: b.getAttribute("title"),
                  disabled: b.getAttribute("aria-disabled"),
                  expanded: b.getAttribute("aria-expanded"),
                  opacity: Number(getComputedStyle(b).opacity),
              }
            : null,
    };
})()`;

// where the ⚖ under a reply and the open menu are, and whether the menu stands at the button: its left edge on the button's
// (placement bottom-start) and below it
const readAnchor = (needle) => `(() => {
    const b = ${proseOf(needle)}?.querySelector("[data-chat-judge-reply]");
    const m = ${MENU};
    if (!b || !m) return null;
    const rb = b.getBoundingClientRect();
    const rm = m.getBoundingClientRect();
    return {
        button: { left: Math.round(rb.left), bottom: Math.round(rb.bottom) },
        menu: { left: Math.round(rm.left), top: Math.round(rm.top) },
        atButton: Math.abs(rm.left - rb.left) <= 3 && rm.top >= rb.bottom,
    };
})()`;

// the header as the steps read it: its words level, its name and state, and the pair controls it carries
const readHeader = `(() => {
    const hd = ${HEADER};
    if (!hd) return null;
    const flat = (el) => (el?.innerText ?? "").replace(/\\s+/g, " ").trim();
    const open = hd.querySelector("[data-pair-open]");
    const add = hd.querySelector("[data-pair-add-judge]");
    const link = hd.querySelector("[data-pair-worker-link]");
    return {
        // an agent in no pair has no Add judge, as a button or as words
        addJudgeWords: /Add judge/i.test(hd.textContent ?? "") || [...hd.querySelectorAll("[aria-label],[title]")].some((e) => /Add judge/i.test((e.getAttribute("aria-label") ?? "") + (e.getAttribute("title") ?? ""))),
        labels: hd.getAttribute("data-header-labels"),
        name: flat(hd.querySelector("[data-header-name] .font-semibold")),
        state: flat(hd.querySelector("[data-agent-state-pill]")),
        // the Pair button's words with spaces dropped ("Pair" and its count are separate flex items)
        open: open
            ? {
                  text: flat(open).replace(/\\s+/g, ""),
                  label: open.getAttribute("aria-label"),
                  role: open.getAttribute("data-pair-role"),
                  pressed: open.getAttribute("aria-pressed"),
                  // it stands right after the Chat / Terminal control it switches with
                  besideView: !!open.previousElementSibling?.querySelector?.("[role=group]"),
              }
            : null,
        link: link ? { label: link.getAttribute("aria-label"), to: link.getAttribute("data-pair-worker-link") } : null,
        add: add ? { text: flat(add), label: add.getAttribute("aria-label"), expanded: add.getAttribute("aria-expanded") } : null,
    };
})()`;

// the open menu: what it lists, where the keys are, and whether it sits inside the window
const readMenu = `(() => {
    const m = ${MENU};
    if (!m) return null;
    const flat = (el) => (el?.innerText ?? "").replace(/\\s+/g, " ").trim();
    const r = m.getBoundingClientRect();
    const wake = m.querySelector("[data-pair-wake-judge]");
    return {
        newJudge: flat(m.querySelector("[data-pair-new-judge]")),
        // the resting judge's entry: its tab, its words, whether it is the menu's first item and holds the opening focus
        wake: wake ? { tab: wake.getAttribute("data-pair-wake-judge"), text: flat(wake) } : null,
        wakeFirst: m.querySelector("[role=menuitem]")?.hasAttribute("data-pair-wake-judge") === true,
        wakeFocused: document.activeElement?.hasAttribute("data-pair-wake-judge") === true,
        section: flat([...m.children].find((c) => c.textContent.startsWith("Or pick"))),
        choices: [...m.querySelectorAll("[data-pair-judge-choice]")].map((b) => ({ id: b.getAttribute("data-pair-judge-choice"), text: flat(b) })),
        empty: !!m.querySelector("[data-pair-no-choices]"),
        keysInMenu: m.contains(document.activeElement),
        firstFocused: document.activeElement?.hasAttribute("data-pair-new-judge") === true,
        inWindow: r.left >= 0 && r.top >= 0 && r.right <= innerWidth && r.bottom <= innerHeight,
    };
})()`;

// The centre column's modes (agentcenter.ts) are recorded as they happen, because the header's part is to set `pair`, and
// what draws it is Task 7's pane: until that pane is wired into the centre, the held pane (heldpane.tsx) sends a mode it was
// not asked for back to the terminal at once. So a step reads the pair shown and the modes the centre went through since the
// last read: the button's work is that `pair` is among them, and it stays true when the conversation holds the mode.
const watchCenter = (h) =>
    agentPage(
        h,
        `const { centerModeAtom } = await mod("app/view/agents/agentcenter.ts");
        window.__pairHdrUnwatch?.();
        const modes = (window.__pairHdrModes = []);
        window.__pairHdrUnwatch = globalStore.sub(centerModeAtom, () => modes.push(globalStore.get(centerModeAtom)));
        return true;`
    );
const unwatchCenter = (h) =>
    h.ev(`(() => { window.__pairHdrUnwatch?.(); delete window.__pairHdrUnwatch; delete window.__pairHdrModes; return true; })()`);
// the pair shown, the mode now, and the modes since the last read (reading starts the next list)
const readCenter = (h) =>
    agentPage(
        h,
        `const { centerModeAtom, pairSelAtom } = await mod("app/view/agents/agentcenter.ts");
        return {
            mode: globalStore.get(centerModeAtom),
            pair: globalStore.get(pairSelAtom),
            modes: (window.__pairHdrModes ?? []).splice(0),
        };`
    );
const leaveCenter = (h) =>
    agentPage(
        h,
        `const { centerModeAtom } = await mod("app/view/agents/agentcenter.ts");
        globalStore.set(centerModeAtom, "terminal");
        (window.__pairHdrModes ?? []).splice(0);
        return true;`
    );

// how many messages of the pair the person has seen: the header's "N new" counts the rest
const setSeen = (h, pairId, count) =>
    agentPage(
        h,
        `const { pairSeenAtom } = await mod("app/view/agents/pairstore.ts");
        globalStore.set(pairSeenAtom(${q(pairId)}), ${count});
        return true;`
    );
const readSeen = (h, pairId) =>
    agentPage(
        h,
        `const { pairSeenAtom } = await mod("app/view/agents/pairstore.ts");
        return globalStore.get(pairSeenAtom(${q(pairId)}));`
    );

// What wavesrv does on PairStart: the pair exists once the call has been made. The stub answers from the page's mock pairs,
// so the mock gets the pair when the call comes (set before it, the header would turn paired under the open menu).
const pairOnStart = (h, view) =>
    agentPage(
        h,
        `const { RpcApi } = await mod("app/store/wshclientapi.ts");
        const { devMockPairsAtom } = await mod("app/view/agents/pairstore.ts");
        const stub = RpcApi.PairStartCommand;
        RpcApi.PairStartCommand = async (c, d) => {
            globalStore.set(devMockPairsAtom, [${q(view)}]);
            return stub(c, d);
        };
        return true;`
    );

// the header given a fixed width, which its ResizeObserver reads as a 2x2 cell's (null puts it back)
const narrowTo = (h, px) =>
    h.ev(`(() => { const hd = ${HEADER}; if (!hd) return false; hd.style.width = ${px == null ? '""' : q(px + "px")}; return true; })()`);

// The menu's frames while it opens: every animation frame's opacity and width of the panel that popoverReveal moves (the
// menu's parent), null for a frame with no menu. A change drawn in one frame has no frame between (a snap).
const startMotion = (h) =>
    h.ev(`(() => {
        const frames = (window.__pairMotion = []);
        let on = true;
        window.__pairMotionStop = () => { on = false; };
        const tick = () => {
            if (!on) return;
            const p = document.querySelector("[data-pair-judge-menu]")?.parentElement;
            frames.push(p ? { o: Number(getComputedStyle(p).opacity), w: Math.round(p.getBoundingClientRect().width * 10) / 10 } : null);
            requestAnimationFrame(tick);
        };
        requestAnimationFrame(tick);
        return true;
    })()`);
const stopMotion = (h) =>
    h.ev(`(() => { window.__pairMotionStop?.(); const f = window.__pairMotion ?? []; delete window.__pairMotion; delete window.__pairMotionStop; return f; })()`);

const key = (h, name, code) =>
    ["keyDown", "keyUp"].reduce(
        (p, type) => p.then(() => h.cdp("Input.dispatchKeyEvent", { type, key: name, code: name, windowsVirtualKeyCode: code })),
        Promise.resolve()
    );

export default function (kit) {
    const { polishWaitFor, polishNap } = kit;

    // where the element `selector` names has its middle, or null when none is drawn
    const centreOf = (h, selector) =>
        h.ev(`(() => {
            const r = document.querySelector(${q(selector)})?.getBoundingClientRect();
            return r && r.width > 0 && r.height > 0 ? { x: Math.round(r.x + r.width / 2), y: Math.round(r.y + r.height / 2) } : null;
        })()`);

    // a real mouse click at the element's middle now: a press that does not wait for anything to settle; false when none is drawn
    async function tap(h, selector) {
        const box = await centreOf(h, selector);
        if (box == null) return false;
        await h.cdp("Input.dispatchMouseEvent", { type: "mouseMoved", x: box.x, y: box.y });
        for (const type of ["mousePressed", "mouseReleased"]) {
            await h.cdp("Input.dispatchMouseEvent", { type, x: box.x, y: box.y, button: "left", clickCount: 1 });
        }
        return true;
    }

    // a real mouse press at a point: the move first, so what the pointer is over (a reply's row) reveals before the press
    async function tapAt(h, box) {
        await h.cdp("Input.dispatchMouseEvent", { type: "mouseMoved", x: box.x, y: box.y });
        for (const type of ["mousePressed", "mouseReleased"]) {
            await h.cdp("Input.dispatchMouseEvent", { type, x: box.x, y: box.y, button: "left", clickCount: 1 });
        }
    }

    // the pointer over a reply (its prose part, scrolled to the middle of Chat): the row of buttons under it fades in. False
    // when the reply is not drawn
    async function hoverReply(h, needle) {
        const box = await h.ev(`(() => {
            const p = ${proseOf(needle)};
            if (!p) return null;
            p.scrollIntoView({ block: "center" });
            const r = p.getBoundingClientRect();
            return { x: Math.round(r.x + Math.min(r.width / 2, 160)), y: Math.round(r.y + r.height / 2) };
        })()`);
        if (box == null) return false;
        await polishNap(250);
        // the scroll may have moved the part: its middle again, then the pointer there
        const again = await h.ev(`(() => { const r = ${proseOf(needle)}?.getBoundingClientRect(); return r ? { x: Math.round(r.x + Math.min(r.width / 2, 160)), y: Math.round(r.y + r.height / 2) } : null; })()`);
        await h.cdp("Input.dispatchMouseEvent", { type: "mouseMoved", x: (again ?? box).x, y: (again ?? box).y });
        return true;
    }

    // where the ⚖ under a reply has its middle now, or null when the reply has none
    const judgeBox = (h, needle) =>
        h.ev(`(() => {
            const r = ${proseOf(needle)}?.querySelector("[data-chat-judge-reply]")?.getBoundingClientRect();
            return r && r.width > 0 && r.height > 0 ? { x: Math.round(r.x + r.width / 2), y: Math.round(r.y + r.height / 2) } : null;
        })()`);

    // a real press on the ⚖ under a reply: the pointer over the reply first (the row is hidden until then), then on the
    // button. False when the reply is not drawn or has no ⚖
    async function pressJudge(h, needle) {
        if (!(await hoverReply(h, needle))) return false;
        await polishNap(300);
        const box = await judgeBox(h, needle);
        if (box == null) return false;
        await tapAt(h, box);
        return true;
    }

    // a click once the element has stopped moving (a menu springs into its place)
    async function click(h, selector) {
        let box = await centreOf(h, selector);
        for (let i = 0; i < 8 && box != null; i++) {
            await polishNap(120);
            const again = await centreOf(h, selector);
            const steady = again != null && again.x === box.x && again.y === box.y;
            box = again;
            if (steady) break;
        }
        return box == null ? false : tap(h, selector);
    }

    // The fixture's blocks are not real ones. arrange marks the roster a fixture's (setFixtureRoster) before it sets it, so
    // a pane's refused controller start is never "failed to start": a refusal's long text would overflow the header, and
    // the header keeps its icons until it has the width that overflow needed (headermodel.nextHeaderLabels). Clearing the
    // refusal after it showed raced a pane that tried late. A step reads the header once it holds its words.
    async function show(h, id) {
        await focusAgent(h, id);
        await polishWaitFor(
            h,
            `!${HEADER}?.querySelector("[data-agent-start-error]") && ${HEADER}?.getAttribute("data-header-labels") === "words"`,
            WAIT_MS
        );
    }
    // on while the pair roster stands in; put back to what a fixture loaded at boot says (devmock.loadDevMockRoster)
    const markFixture = (h, on) =>
        agentPage(
            h,
            `const { setFixtureRoster } = await mod("app/view/agents/agentcontrollerstore.ts");
            const { devMockAgentsAtom } = await mod("app/view/agents/devmock.ts");
            setFixtureRoster(${on ? "true" : "globalStore.get(devMockAgentsAtom) != null"});
            return true;`
        );
    const waitHeader = (h, name, extra = "true") =>
        polishWaitFor(h, `(${HEADER}?.querySelector("[data-header-name] .font-semibold")?.textContent ?? "").includes(${q(name)}) && (${extra})`, WAIT_MS);
    const waitMenu = (h) => polishWaitFor(h, `!!${MENU}`, WAIT_MS);
    const menuGone = (h) => polishWaitFor(h, `!${MENU}`, WAIT_MS);
    const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);

    return [
        {
            name: NAME,
            surface: "agent",
            async arrange(h) {
                // the worker's transcript is a file of the scenario's own, so nothing is written into ~/.claude/projects
                const ctx = { worker: "Plan oracle-tightening", dir: mkdtempSync(join(tmpdir(), "verify-pair-header-")) };
                try {
                    await h.goto("agent");
                    // a window wide enough for the header's words (a narrower one turns every label into its icon:
                    // narrow-header is that case, made on purpose)
                    await h.cdp("Emulation.setDeviceMetricsOverride", { width: WINDOW_W, height: 950, deviceScaleFactor: 1, mobile: false });
                    ctx.sized = true;
                    ctx.prevSeen = await h.ev(`localStorage.getItem("agent.pairseen")`);
                    await watchCenter(h);
                    ctx.now = Date.now();
                    // the flag goes first: a pane starts as soon as the roster names its block
                    await markFixture(h, true);
                    ctx.transcript = writeWorkerTranscript(ctx.dir, ctx.now);
                    await setRoster(h, pairRoster(ctx.now, { workerTranscript: ctx.transcript }));
                    await stubPairRpc(h);
                    await seedPair(h, []);
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
                rec("0. the pair roster, the stubs and an empty pair list were set", ctx.arrangeError == null && ctx.ready === true, ctx.arrangeError ?? { ready: ctx.ready });
                if (ctx.arrangeError != null) return steps;

                const view = pairView(ctx.now);
                // the roster with the worker reading its fixture transcript (every step that sets the roster sets this one)
                const workerRoster = () => pairRoster(ctx.now, { workerTranscript: ctx.transcript });

                await run("reply-judge-hover", async () => {
                    // an agent in no pair: no Add judge in its header. Under each reply of its Chat, on hover, ⚖ sits in the
                    // row with Copy, Add to initiative and Fork; a part of the same turn that a tool call split from the reply
                    // has none
                    await show(h, PAIR.worker);
                    await waitHeader(h, ctx.worker);
                    const drawn = await polishWaitFor(
                        h,
                        `!!(${proseOf(NEEDLE.older)}) && !!(${proseOf(NEEDLE.early)}) && !!(${proseOf(NEEDLE.latest)})`,
                        WAIT_MS
                    );
                    const header = await h.ev(readHeader);
                    const hovered = await hoverReply(h, NEEDLE.older);
                    await polishNap(400);
                    const older = await h.ev(readReply(NEEDLE.older));
                    await shot(h, "reply-judge-hover");
                    await hoverReply(h, NEEDLE.early);
                    await polishNap(300);
                    const early = await h.ev(readReply(NEEDLE.early));
                    await hoverReply(h, NEEDLE.latest);
                    await polishNap(300);
                    const latest = await h.ev(readReply(NEEDLE.latest));
                    rec(
                        "reply-judge-hover: the header of an agent in no pair has no Add judge (no button, no words); hovering an older reply shows ⚖ \"Judge this reply\" in its row after Copy and Fork; the earlier prose part of the same turn (split by a tool call) has no ⚖, and the newest reply has one",
                        drawn === true &&
                            header?.labels === "words" &&
                            header.add == null &&
                            header.open == null &&
                            header.addJudgeWords === false &&
                            hovered === true &&
                            older?.rowOpacity === 1 &&
                            older.judge?.label === "Judge this reply" &&
                            older.kids[0] === "copy" &&
                            older.kids.at(-2) === "fork" &&
                            older.kids.at(-1) === "judge" &&
                            early?.row === true &&
                            early.judge === null &&
                            latest?.judge?.label === "Judge this reply",
                        { drawn, header, older, early, latest }
                    );
                });

                await run("reply-judge-menu", async () => {
                    // pressing ⚖ opens the menu at the button: Open a new judge (this reply), then the project's live agents
                    // that are in no pair, the keys in it from the first row, inside the window; Escape closes it and the keys
                    // go back to ⚖. Picking a live agent is PairStart (hold on, the default cap, not briefed) with `from` the
                    // uuid of that reply's record, and the conversation
                    await pressJudge(h, NEEDLE.older);
                    await waitMenu(h);
                    await polishNap(400);
                    const menu = await h.ev(readMenu);
                    const anchor = await h.ev(readAnchor(NEEDLE.older));
                    const opened = await h.ev(readReply(NEEDLE.older));
                    await shot(h, "reply-judge-menu");
                    await key(h, "Escape", 27);
                    const closed = await menuGone(h);
                    const back = await h.ev(`document.activeElement?.hasAttribute("data-chat-judge-reply") === true`);

                    const picked = { ...view, judges: [{ tab: PAIR.other, name: "Pull history and sync", harness: "claude" }] };
                    await pairOnStart(h, picked);
                    const before = (await pairRpcCalls(h, "PairStartCommand")).length;
                    await pressJudge(h, NEEDLE.older);
                    await waitMenu(h);
                    await polishNap(300);
                    await click(h, `[data-pair-judge-choice="${PAIR.other}"]`);
                    await polishWaitFor(h, `!${MENU}`, WAIT_MS);
                    const calls = (await pairRpcCalls(h, "PairStartCommand")).slice(before);
                    // the menu closes at the click and the conversation opens when PairStart answers: wait for it
                    const modes = [];
                    let center;
                    for (let i = 0; i < 12; i++) {
                        center = await readCenter(h);
                        modes.push(...center.modes);
                        if (modes.includes("pair")) break;
                        await polishNap(250);
                    }
                    center = { ...center, modes };
                    rec(
                        "reply-judge-menu: pressing ⚖ under the older reply opens the menu at the button (its left edge on the button's, below it) on Open a new judge (new tab in the same project, reads the plan and this reply · opus), then the project's live agents that are in no pair (name, short id, state), keys in the menu from the first row, inside the window, ⚖ expanded; Escape closes it and the keys return to ⚖; picking a live agent calls PairStart once with the worker, that agent and from = that reply's uuid (heavy commands held, tokencap 0, not briefed), opens the conversation and closes the menu",
                        menu?.newJudge === "Open a new judge new tab in the same project, reads the plan and this reply · opus" &&
                            menu.wake === null &&
                            menu.section === "Or pick a live agent" &&
                            same(menu.choices, [
                                { id: PAIR.judge, text: "Judge: Plan oracle-tightening 4c6ba858 · working" },
                                { id: PAIR.other, text: "Pull history and sync 9e0f1a2b · idle" },
                            ]) &&
                            menu.keysInMenu &&
                            menu.firstFocused &&
                            menu.inWindow &&
                            anchor?.atButton === true &&
                            opened?.judge?.expanded === "true" &&
                            closed === true &&
                            back === true &&
                            calls.length === 1 &&
                            same(calls[0], {
                                workertab: PAIR.worker,
                                judgetab: PAIR.other,
                                holdheavy: true,
                                tokencap: 0,
                                note: "",
                                briefed: false,
                                launched: false,
                                from: WORKER_REPLIES.older.uuid,
                            }) &&
                            center.modes.includes("pair") &&
                            center.pair === PAIR.id,
                        { menu, anchor, opened, closed, back, calls, center }
                    );
                    await leaveCenter(h);
                    await stubPairRpc(h);
                    await seedPair(h, []);
                });

                await run("menu-motion", async () => {
                    // the menu opens and leaves on popoverReveal (opacity and scale over frames, never a snap), and a second press
                    // 70 ms after the first, mid-motion, ends as a slow press does: closed, and no second copy drawn
                    await show(h, PAIR.worker);
                    await startMotion(h);
                    await pressJudge(h, NEEDLE.older);
                    await waitMenu(h);
                    await polishNap(500);
                    await key(h, "Escape", 27);
                    await menuGone(h);
                    await polishNap(100);
                    const frames = (await stopMotion(h)).filter((f) => f != null);
                    const full = frames.findIndex((f) => f.o === 1);
                    const between = (list) => list.filter((f) => f.o > 0 && f.o < 1).length;
                    const opening = full < 0 ? 0 : between(frames.slice(0, full));
                    const leaving = full < 0 ? 0 : between(frames.slice(full));
                    // the pointer is already over the reply and its button: two presses on the button where it stands
                    const box = await judgeBox(h, NEEDLE.older);
                    if (box != null) {
                        await tapAt(h, box);
                        await polishNap(70);
                        await tapAt(h, box);
                    }
                    await polishNap(900);
                    const quick = await h.ev(`({
                        copies: document.querySelectorAll("[data-pair-judge-menu]").length,
                        expanded: ${proseOf(NEEDLE.older)}?.querySelector("[data-chat-judge-reply]")?.getAttribute("aria-expanded"),
                    })`);
                    rec(
                        "menu-motion: the menu opens and leaves over frames (opacity between 0 and 1 each way, fully opaque in between), and a second press 70 ms after the first leaves it closed with no copy of it drawn",
                        box != null && full >= 0 && opening >= 1 && leaving >= 1 && frames.at(-1)?.o !== 1 && quick.copies === 0 && quick.expanded === "false",
                        { frames: frames.length, opening, leaving, quick }
                    );
                });

                await run("wake-judge", async () => {
                    // A launched judge whose round ended rests: asleep, hidden under its worker's row. The menu of ⚖ under a
                    // reply offers it first, as Wake, ahead of Open a new judge; it is not listed again among the live agents.
                    // Pressing it is PairStart with launched (so it rests again after this round) and not briefed (the send of
                    // the brief wakes it), with `from` the uuid of the reply the ⚖ sat under, and the conversation opens. The
                    // pair exists once PairStart answers (pairOnStart).
                    const now = Date.now();
                    const judgeName = "Judge: Plan oracle-tightening";
                    const sleepingJudge = (a) =>
                        a.id === PAIR.judge ? { ...a, state: "idle", sleeping: { since: now - 60_000, freedBytes: 250_000_000 } } : a;
                    await seedPair(h, []);
                    await leaveCenter(h);
                    await setRoster(h, workerRoster().map(sleepingJudge));
                    await seedResting(h, [{ tab: PAIR.judge, name: judgeName, workertab: PAIR.worker, pairid: "pair-fx-ended" }]);
                    const before = (await pairRpcCalls(h, "PairStartCommand")).length;
                    await show(h, PAIR.worker);
                    await waitHeader(h, ctx.worker, `!${HEADER}.querySelector("[data-pair-open]")`);
                    await polishWaitFor(h, `!!(${proseOf(NEEDLE.older)})`, WAIT_MS);
                    await pressJudge(h, NEEDLE.older);
                    await waitMenu(h);
                    await polishNap(400);
                    const menu = await h.ev(readMenu);
                    await shot(h, "wake-judge");
                    const picked = { ...view, judges: [{ tab: PAIR.judge, name: judgeName, harness: "claude" }] };
                    await pairOnStart(h, picked);
                    await click(h, `[data-pair-wake-judge="${PAIR.judge}"]`);
                    await polishWaitFor(h, `!${MENU}`, WAIT_MS);
                    const calls = (await pairRpcCalls(h, "PairStartCommand")).slice(before);
                    const modes = [];
                    let center;
                    for (let i = 0; i < 12; i++) {
                        center = await readCenter(h);
                        modes.push(...center.modes);
                        if (modes.includes("pair")) break;
                        await polishNap(250);
                    }
                    center = { ...center, modes };
                    rec(
                        "wake-judge: with a resting judge asleep on the roster, the menu of ⚖ under the older reply opens on Wake <its name> (judge of your earlier rounds, keeps what it read · asleep) as its first item with the keys, then Open a new judge, and the live list does not list that judge again; pressing Wake calls PairStart once with the worker, that judge and from = that reply's uuid (heavy commands held, tokencap 0, not briefed, launched), opens the conversation and closes the menu",
                        menu?.wake?.tab === PAIR.judge &&
                            menu.wake.text === `Wake ${judgeName} judge of your earlier rounds, keeps what it read · asleep` &&
                            menu.wakeFirst === true &&
                            menu.wakeFocused === true &&
                            menu.keysInMenu === true &&
                            menu.newJudge.startsWith("Open a new judge") &&
                            same(menu.choices, [{ id: PAIR.other, text: "Pull history and sync 9e0f1a2b · idle" }]) &&
                            menu.inWindow === true &&
                            calls.length === 1 &&
                            same(calls[0], {
                                workertab: PAIR.worker,
                                judgetab: PAIR.judge,
                                holdheavy: true,
                                tokencap: 0,
                                note: "",
                                briefed: false,
                                launched: true,
                                from: WORKER_REPLIES.older.uuid,
                            }) &&
                            center.modes.includes("pair") &&
                            center.pair === PAIR.id,
                        { menu, calls, center }
                    );
                    await leaveCenter(h);
                    await stubPairRpc(h);
                    await seedResting(h, null);
                    await seedPair(h, []);
                    await setRoster(h, workerRoster());
                });

                await run("reply-judge-dimmed", async () => {
                    // While the agent is in a pair that has not ended, ⚖ under every reply is dimmed and does nothing: the
                    // tooltip says a judge round is running (Unpair or let the round end), a press opens no menu and calls no
                    // PairStart. When the pair ends, ⚖ under the same reply is live again with no reload
                    await seedPair(h, [view]);
                    await show(h, PAIR.worker);
                    await waitHeader(h, ctx.worker, `!!${HEADER}.querySelector("[data-pair-open]")`);
                    await polishWaitFor(h, `!!(${proseOf(NEEDLE.older)})`, WAIT_MS);
                    const before = (await pairRpcCalls(h, "PairStartCommand")).length;
                    await hoverReply(h, NEEDLE.older);
                    await polishNap(400);
                    const dimmed = await h.ev(readReply(NEEDLE.older));
                    await shot(h, "reply-judge-dimmed");
                    const box = await judgeBox(h, NEEDLE.older);
                    if (box != null) await tapAt(h, box);
                    await polishNap(600);
                    const pressedMenu = await h.ev(`!!${MENU}`);
                    const pressedCalls = (await pairRpcCalls(h, "PairStartCommand")).length - before;
                    // the pair ends (a mocked pair that is ended leaves the active list): the same ⚖ is live again
                    await seedPair(h, [{ ...view, state: "ended" }]);
                    await polishWaitFor(
                        h,
                        `${proseOf(NEEDLE.older)}?.querySelector("[data-chat-judge-reply]")?.getAttribute("aria-disabled") == null`,
                        WAIT_MS
                    );
                    await hoverReply(h, NEEDLE.older);
                    await polishNap(400);
                    const live = await h.ev(readReply(NEEDLE.older));
                    await pressJudge(h, NEEDLE.older);
                    const reopened = await waitMenu(h);
                    await key(h, "Escape", 27);
                    await menuGone(h);
                    rec(
                        "reply-judge-dimmed: with the agent in a live pair ⚖ under the older reply is dimmed (aria-disabled, opacity under 1) with the tooltip \"A judge round is running: Unpair or let the round end\", and a press opens no menu and calls no PairStart; when that pair ends, ⚖ under the same reply is live again (not disabled, full opacity, its own tooltip) without a reload, and a press opens the menu",
                        dimmed?.judge?.disabled === "true" &&
                            dimmed.judge.opacity < 1 &&
                            dimmed.judge.title === "A judge round is running: Unpair or let the round end" &&
                            pressedMenu === false &&
                            pressedCalls === 0 &&
                            live?.judge != null &&
                            live.judge.disabled === null &&
                            live.judge.opacity === 1 &&
                            live.judge.title.startsWith("Judge this reply") &&
                            reopened === true,
                        { dimmed, pressedMenu, pressedCalls, live, reopened }
                    );
                    await seedPair(h, []);
                });

                await run("paired-button", async () => {
                    // the pair is seeded and the person has seen 3 of its 5 messages
                    await seedPair(h, [view]);
                    await setSeen(h, PAIR.id, 3);
                    // still the focused agent, its start refusal already cleared by the first step
                    await focusAgent(h, PAIR.worker);
                    await waitHeader(h, ctx.worker, `!!${HEADER}.querySelector("[data-pair-open]")`);
                    await polishNap(300);
                    const header = await h.ev(readHeader);
                    await shot(h, "paired-button");
                    // the small icon is the same menu, for another judge: the judge already in the pair is not offered again
                    await click(h, "[data-agent-header] [data-pair-add-judge]");
                    await waitMenu(h);
                    await polishNap(300);
                    const menu = await h.ev(readMenu);
                    await shot(h, "paired-add-another");
                    await key(h, "Escape", 27);
                    await menuGone(h);
                    rec(
                        'paired-button: the working agent\'s header has a Pair button with its 2 new right after the Chat / Terminal control, not pressed, labelled "Paired with judge 4c6ba858 · 2 new", its state line "waiting on judge", and beside it a small + whose menu offers the agents in no pair, not the judge already paired',
                        header?.labels === "words" &&
                            header.open?.text === "Pair2" &&
                            header.open.label === "Paired with judge 4c6ba858 · 2 new" &&
                            header.open.role === "worker" &&
                            header.open.pressed === "false" &&
                            header.open.besideView === true &&
                            header.state === "waiting on judge" &&
                            header.add?.text === "" &&
                            header.add.label === "Add another judge" &&
                            same(menu?.choices, [{ id: PAIR.other, text: "Pull history and sync 9e0f1a2b · idle" }]),
                        { header, menu }
                    );
                });

                await run("paired-opens", async () => {
                    await click(h, "[data-agent-header] [data-pair-open]");
                    await polishNap(300);
                    const center = await readCenter(h);
                    const seen = await readSeen(h, PAIR.id);
                    const lit = await h.ev(readHeader);
                    const railTab = await h.ev(
                        `document.querySelector('aside[aria-label="Agent details"] [data-rail-tab="decided"]')?.getAttribute("aria-selected") ?? null`
                    );
                    await shot(h, "paired-lit");
                    // pressed again, it goes back to the agent's own view
                    await click(h, "[data-agent-header] [data-pair-open]");
                    await polishNap(300);
                    const back = await readCenter(h);
                    const unlit = await h.ev(readHeader);
                    rec(
                        "paired-opens: the Pair button opens the pair centre mode on its pair under the same header, lit, its 2 new gone (counted as seen), and the rail on Decided; pressed again it goes back to the agent's own view, unlit",
                        center.modes.includes("pair") &&
                            center.pair === PAIR.id &&
                            seen === view.messages.length &&
                            lit?.open?.pressed === "true" &&
                            lit.open.text === "Pair" &&
                            railTab === "true" &&
                            !back.modes.includes("pair") &&
                            unlit?.open?.pressed === "false",
                        { center, seen, lit, railTab, back, unlit }
                    );
                    await leaveCenter(h);
                });

                await run("judge-header", async () => {
                    // the judge's own header: Judging, opening the same conversation, and no Add judge
                    await show(h, PAIR.judge);
                    await waitHeader(h, "Judge: Plan oracle-tightening", `!!${HEADER}.querySelector("[data-pair-open]")`);
                    await polishNap(300);
                    const header = await h.ev(readHeader);
                    await shot(h, "judge-header");
                    await click(h, "[data-agent-header] [data-pair-open]");
                    await polishNap(300);
                    const center = await readCenter(h);
                    rec(
                        'judge-header: the judge\'s own header has a Pair button labelled "Judging 61483cd6" with no count, no Add judge but a link to the agent it judges, and its button opens the same conversation',
                        header?.labels === "words" &&
                            header.open?.text === "Pair" &&
                            header.open.label === "Judging 61483cd6" &&
                            header.open.role === "judge" &&
                            header.add == null &&
                            header.link?.to === PAIR.worker &&
                            header.link.label === "Open Plan oracle-tightening, the agent you judge" &&
                            center.modes.includes("pair") &&
                            center.pair === PAIR.id,
                        { header, center }
                    );
                    await leaveCenter(h);
                });

                await run("no-judge-left", async () => {
                    // two judges in the pair: the label counts them, and no live agent of the project is left to add
                    await seedPair(h, [pairView(ctx.now, { judges: 2 })]);
                    await show(h, PAIR.worker);
                    await waitHeader(h, ctx.worker, `!!${HEADER}.querySelector("[data-pair-open]")`);
                    await polishNap(300);
                    const header = await h.ev(readHeader);
                    await click(h, "[data-agent-header] [data-pair-add-judge]");
                    await waitMenu(h);
                    await polishNap(300);
                    const menu = await h.ev(readMenu);
                    await shot(h, "no-judge-left");
                    await key(h, "Escape", 27);
                    await menuGone(h);
                    rec(
                        'no-judge-left: with two judges paired the Pair button\'s label reads "Paired with 2 judges · 1 new"; the menu still offers Open a new judge, and says no other agent is running where the live list would be',
                        header?.open?.label === "Paired with 2 judges · 1 new" &&
                            menu?.newJudge.startsWith("Open a new judge") &&
                            menu.choices.length === 0 &&
                            menu.empty === true &&
                            menu.inWindow === true,
                        { header, menu }
                    );
                });

                await run("narrow-header", async () => {
                    // a header as narrow as a 2x2 cell's: the words give way to the icon and the count, the label stays its aria-label
                    await narrowTo(h, 560);
                    await polishWaitFor(h, `${HEADER}?.getAttribute("data-header-labels") === "icons"`, WAIT_MS);
                    await polishNap(300);
                    const header = await h.ev(readHeader);
                    await shot(h, "narrow-header");
                    await narrowTo(h, null);
                    rec(
                        "narrow-header: at 560px the paired button is its icon and the count of new messages (1), its aria-label still the whole label, and the + icon has no words",
                        header?.labels === "icons" &&
                            header.open?.text === "1" &&
                            header.open.label === "Paired with 2 judges · 1 new" &&
                            header.add?.text === "",
                        header
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
                await attempt("restore the header width", () => narrowTo(h, null));
                await attempt("leave the pair centre mode", () => leaveCenter(h));
                await attempt("stop recording the centre modes", () => unwatchCenter(h));
                if (ctx.sized) await attempt("restore the window size", () => h.cdp("Emulation.clearDeviceMetricsOverride", {}));
                await attempt("put the generated pair commands back", () => restorePairRpc(h));
                await attempt("clear the pair mocks", () => seedPair(h, null));
                await attempt("clear the resting judges", () => seedResting(h, null));
                await attempt("drop the pair roster", () => restoreRoster(h));
                await attempt("put the fixture flag back", () => markFixture(h, false));
                await attempt("remove the worker's fixture transcript", () =>
                    rmSync(ctx.dir, { recursive: true, force: true, maxRetries: 20, retryDelay: 500 })
                );
                // the seen counts are kept in localStorage: the page's own value goes back
                await attempt("restore what was seen", () =>
                    h.ev(
                        `(() => { try { ${ctx.prevSeen == null ? `localStorage.removeItem("agent.pairseen")` : `localStorage.setItem("agent.pairseen", ${q(ctx.prevSeen)})`}; } catch {} return true; })()`
                    )
                );
                if (failures.length > 0) throw new Error(failures.join("; "));
            },
        },
    ];
}
