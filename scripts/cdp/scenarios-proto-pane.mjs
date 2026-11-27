// proto-pane: the canvas pane's Try | Mark toggle, marks across a prototype's screens and variants, and the header readout
// (docs/superpowers/plans/2026-11-27-prototype-feedback.md, Task 6). The fixture is ./proto-fixtures.mjs: Main.dc.html is a
// prototype of two screens ("Trang chủ", "Để sau") whose slot `list` ("danh sách") has variants A, B and C on the first
// screen and A and B on the second; Later.dc.html is the second screen as a file of its own (part_of Main), and
// Static.dc.html is a board with no screen and no slot.
//
// The board is a cross-origin frame, so nothing here reads its DOM: what it reported is read from the frame's data-canvas-
// proto / data-canvas-screen, from its chip's data-slot-shown and from the header's readout; the board is clicked with real
// mouse events at the page point the fixture draws its switch button at, and marked with a drag over the mark layer. No draw
// step needs the host's window capture (a mark stands with no picture when it fails), so steps 0 to 6 and 8 run in the
// browser app too; only Send does (step 7), and it says so when the host is missing.
//
// kit is scenarios.mjs's CANVAS_KIT.

import { readdirSync } from "node:fs";
import { join } from "node:path";
import { PROTO_MAIN, PROTO_SCREEN_FILE, PROTO_SCREENS, PROTO_SLOT, PROTO_STATIC } from "./proto-fixtures.mjs";

const NAME = "proto-pane";
const TOPIC = "verify-proto-pane";
const PROJECT = "verify-proto-pane";

// the board's page size, the slot's box in it and the switch button's centre (proto-fixtures.mjs: the same on both screens)
const PAGE_W = 960;
const SLOT = { x: 80, y: 120, w: 400, h: 280 };
const GO_BUTTON = { x: 130, y: 462 };
// the boxes a mark is dragged over, in page points: right of the slot, clear of its chip (on the slot's top-right edge), and
// of the switch button
const BOX_ONE = [
    { x: 540, y: 150 },
    { x: 780, y: 330 },
];
const BOX_TWO = [
    { x: 540, y: 360 },
    { x: 780, y: 540 },
];
// a mark's window capture, when there is a host, is under way for about this long after it is drawn: a variant swapped or a
// screen left before it ends drops the picture (the layer keeps only a picture of the context it was drawn on)
const CAPTURE_MS = 1500;

const PANE = "[data-canvas-pane]";
const VIEWER = '[data-canvas-viewer-state="board"]';
const frameSel = `${PANE} [data-canvas-frame="${PROTO_MAIN}"]`;
const chipSel = `${frameSel} [data-slot-chip="${PROTO_SLOT.id}"]`;

const home = PROTO_SCREENS.home;
const later = PROTO_SCREENS.later;
const label = PROTO_SLOT.label;
// the header's readout and the tray's name for a context, as protomodel.ts words them
const readoutOf = (screen, letter) => `${screen} · ${label} ${letter}`;
const phraseOf = (screen, letter) => `screen ${JSON.stringify(screen)}, slot ${label} = ${letter}`;

const mouse = (h, type, x, y, held = false) =>
    h.cdp("Input.dispatchMouseEvent", {
        type,
        x: Math.round(x),
        y: Math.round(y),
        button: type === "mouseMoved" && !held ? "none" : "left",
        buttons: type === "mousePressed" || (type === "mouseMoved" && held) ? 1 : 0,
        clickCount: type === "mousePressed" || type === "mouseReleased" ? 1 : 0,
    });
const center = (b) => ({ x: (b.left + b.right) / 2, y: (b.top + b.bottom) / 2 });
async function click(h, p) {
    await mouse(h, "mouseMoved", p.x, p.y);
    await mouse(h, "mousePressed", p.x, p.y);
    await mouse(h, "mouseReleased", p.x, p.y);
}
// a drag with real mouse events (the mark layer takes pointer capture)
async function drag(h, a, b) {
    await mouse(h, "mouseMoved", a.x, a.y);
    await mouse(h, "mousePressed", a.x, a.y);
    await mouse(h, "mouseMoved", (a.x + b.x) / 2, (a.y + b.y) / 2, true);
    await mouse(h, "mouseMoved", b.x, b.y, true);
    await mouse(h, "mouseReleased", b.x, b.y);
}

// what the page shows of the pane: the toggle, the layer's marks, the tray, the header's line, and what the board reported
const stateExpr = `(() => {
    const pane = document.querySelector(${JSON.stringify(PANE)});
    if (!pane) return null;
    const f = pane.querySelector(${JSON.stringify(`[data-canvas-frame="${PROTO_MAIN}"]`)});
    const tray = pane.querySelector("[data-canvas-tray]");
    const box = (r) => ({ left: r.left, top: r.top, right: r.right, bottom: r.bottom });
    return {
        group: !!pane.querySelector('[role="group"][aria-label="Board mode"]'),
        modes: [...pane.querySelectorAll("[data-canvas-mode]")].map((b) => [b.getAttribute("data-canvas-mode"), b.getAttribute("aria-pressed")]),
        markTitle: pane.querySelector('[data-canvas-mode="mark"]')?.getAttribute("title") ?? null,
        layer: !!pane.querySelector("[data-canvas-mark-layer]"),
        marks: [...pane.querySelectorAll("[data-canvas-mark]")].map((m) => m.getAttribute("data-canvas-mark")),
        tray: !!tray,
        notes: tray ? tray.querySelectorAll('input[aria-label^="Note for mark"]').length : 0,
        contexts: tray ? [...tray.querySelectorAll("[data-canvas-mark-context]")].map((c) => [c.getAttribute("data-canvas-mark-context"), (c.textContent || "").trim()]) : [],
        meta: (pane.querySelector("[data-canvas-meta]")?.textContent || "").trim(),
        screen: f?.getAttribute("data-canvas-screen") ?? null,
        proto: f?.getAttribute("data-canvas-proto") ?? null,
        chips: f ? [...f.querySelectorAll("[data-slot-chip]")].map((c) => ({
            shown: c.getAttribute("data-slot-shown"),
            letters: [...c.querySelectorAll("[data-slot-letter]")].map((b) => ({
                letter: b.getAttribute("data-slot-letter"),
                pressed: b.getAttribute("aria-pressed") === "true",
                box: box(b.getBoundingClientRect()),
            })),
        })) : [],
    };
})()`;

// What Send writes to the agent's terminal. Canvas Send types its line through sendToAgent (agentsubmit.ts: the line, then
// Enter as a write of its own), which is controllerinput calls, never the agentprompt call that scenarios.mjs's
// BS_TYPED_INSTALL records. So this records controllerinput: each write as the block it went to and its text (a resize
// carries no input). Installed for Send's step, removed in teardown.
const WRITES_INSTALL = `(() => {
    const c = window.TabRpcClient;
    if (!c) return false;
    window.__protoWrites = [];
    if (c.__protoOrig) return true;
    c.__protoOrig = c.wshRpcCall;
    const call = c.wshRpcCall.bind(c);
    c.__protoWrap = (command, data, opts) => {
        if (command === "controllerinput" && data?.inputdata64 && window.__protoWrites) {
            try {
                const bytes = Uint8Array.from(atob(data.inputdata64), (ch) => ch.charCodeAt(0));
                window.__protoWrites.push({ block: data.blockid, text: new TextDecoder().decode(bytes) });
            } catch {
                // an undecodable write is not Send's line
            }
        }
        return call(command, data, opts);
    };
    c.wshRpcCall = c.__protoWrap;
    return true;
})()`;
const WRITES_REMOVE = `(() => {
    const c = window.TabRpcClient;
    window.__protoWrites = undefined;
    if (c?.__protoOrig) {
        if (c.wshRpcCall === c.__protoWrap) c.wshRpcCall = c.__protoOrig;
        delete c.__protoOrig;
        delete c.__protoWrap;
    }
    return true;
})()`;
const writesSince = (h, mark) => h.ev(`(window.__protoWrites ?? []).slice(${mark})`);
// what the terminal itself writes back as its input (a pasted text's brackets, its focus reports) is not what Send typed
const ESC = String.fromCharCode(27);
const TERM_NOISE = new RegExp(`${ESC}\\[(?:20[01]~|[IO])`, "g");
const typedTo = (writes, blockId) =>
    writes
        .filter((w) => w.block === blockId)
        .map((w) => w.text)
        .join("")
        .replace(TERM_NOISE, "");
// the shell's pty can break a long row with a hard newline, so rows are compared with every space dropped (as bsCount does)
const squash = (s) => s.replace(/\s+/g, "");
const countIn = (hay, line) => squash(hay).split(squash(line)).length - 1;
// Send takes the window's picture of each marked screen before it types, then waits on the box's echo (agentsubmit.ts)
const SEND_WAIT_MS = 10000;
const TERM_WAIT_MS = 5000;

const lettersOf = (chip) => chip?.letters.map((l) => l.letter).join("") ?? null;
const pressed = (s, mode) => s?.modes.find(([m]) => m === mode)?.[1] === "true";
const modeNames = (s) => (s?.modes ?? []).map(([m]) => m).join(",");
const shownIs = (letter) =>
    `document.querySelector(${JSON.stringify(chipSel)})?.getAttribute("data-slot-shown") === ${JSON.stringify(letter)}`;
const screenIs = (name) =>
    `document.querySelector(${JSON.stringify(frameSel)})?.getAttribute("data-canvas-screen") === ${JSON.stringify(name)}`;

export default function (kit) {
    const {
        CANVAS_SWAP,
        UI_ROUTE,
        arrangeProtoCanvas,
        bsTermText,
        canvasTabFrames,
        cgLeaveGallery,
        cgPress,
        cgTeardown,
        clickCanvasSwap,
        clickCanvasTab,
        openLibraryTab,
        polishNap,
        polishWaitFor,
        pressCanvasKey,
        skipStep,
        teardownCanvasBoards,
        waitForProjectInConfig,
    } = kit;

    const read = (h) => h.ev(stateExpr);
    // the viewport points of these page points of the board, its pane scrolled first so that they are all in view
    const points = (h, pts) =>
        h.ev(`(() => {
            const f = document.querySelector(${JSON.stringify(frameSel)});
            const ifr = f?.querySelector("iframe");
            const pane = f?.closest("[data-canvas-scroll]");
            if (!ifr || !pane) return null;
            const pts = ${JSON.stringify(pts)};
            const s = ifr.getBoundingClientRect().width / ${PAGE_W};
            const lo = Math.min(...pts.map((p) => p.y)) * s;
            const hi = Math.max(...pts.map((p) => p.y)) * s;
            const top = ifr.getBoundingClientRect().top;
            const pr = pane.getBoundingClientRect();
            if (top + lo < pr.top + 8 || top + hi > pr.bottom - 8) {
                pane.scrollTop += top + (lo + hi) / 2 - (pr.top + pr.height / 2);
            }
            const r = ifr.getBoundingClientRect();
            return pts.map((p) => ({ x: Math.round(r.left + p.x * s), y: Math.round(r.top + p.y * s) }));
        })()`);
    const pressMode = (h, mode) => h.ev(`document.querySelector(${JSON.stringify(`${PANE} [data-canvas-mode="${mode}"]`)})?.click()`);
    // a box dragged over the board with the mark layer up
    async function mark(h, box) {
        const pts = await points(h, box);
        if (pts == null) return false;
        await drag(h, pts[0], pts[1]);
        return true;
    }
    // a click on the board's own switch button, then the wait for the report that names the screen it leads to
    async function goTo(h, screen) {
        const [p] = (await points(h, [GO_BUTTON])) ?? [];
        if (p == null) return false;
        await click(h, p);
        return polishWaitFor(h, screenIs(screen), 6000);
    }
    // a click on a letter of the slot's chip (the slot's region scrolled into view first)
    async function pick(h, letter) {
        await points(h, [
            { x: SLOT.x, y: SLOT.y - 24 },
            { x: SLOT.x + SLOT.w, y: SLOT.y + SLOT.h },
        ]);
        const s = await read(h);
        const b = s?.chips[0]?.letters.find((l) => l.letter === letter)?.box;
        if (b == null) return false;
        await click(h, center(b));
        return polishWaitFor(h, shownIs(letter), 6000);
    }

    return [
        {
            name: NAME,
            surface: "agent",
            arrange: (h) => arrangeProtoCanvas(h, "verify-proto-pane-", TOPIC),
            async assert(h, ctx) {
                if (ctx.launchError != null) {
                    return [skipStep("proto pane", `could not verify: ${ctx.launchError}`)];
                }
                if (ctx.focusError != null) {
                    return [skipStep("proto pane", `could not verify: focusing the terminal failed: ${ctx.focusError}`)];
                }
                const steps = [];
                const rec = (step, ok, detail) => steps.push({ step, ok, detail: typeof detail === "string" ? detail : JSON.stringify(detail) });
                rec("0. the launched terminal is in the roster", ctx.inRoster === true, `tab=${ctx.tabId}`);
                if (!ctx.inRoster) return steps;

                await h.rpc(
                    "uireveal",
                    { address: `canvas:${TOPIC}`, callerblockid: ctx.blockId, callercwd: ctx.cwd },
                    UI_ROUTE
                );
                await polishWaitFor(h, `!!${CANVAS_SWAP}`, 3000);
                await clickCanvasSwap(h, "Canvas");
                const up = await polishWaitFor(h, `!!document.querySelector(${JSON.stringify(chipSel)})`, 12000);

                // 1. the tabs name the main and the static board and no screen file; under All the same two boards
                const first = await canvasTabFrames(h);
                const all = await clickCanvasTab(h, "All");
                await h.shot("cdp-shots/proto-pane-1-all.png");
                const noScreen = (names) => names.every((n) => !/later/i.test(n) && !n.includes(PROTO_SCREEN_FILE));
                rec(
                    "1. the tabs name the main and the static board and no screen file (All and the first tab too)",
                    up &&
                        JSON.stringify(first.tabs) === JSON.stringify(["All", "Main", "Static"]) &&
                        JSON.stringify(first.frames) === JSON.stringify([PROTO_MAIN]) &&
                        JSON.stringify(all.frames) === JSON.stringify([PROTO_MAIN, PROTO_STATIC]) &&
                        noScreen([...first.tabs, ...first.frames, ...all.frames]),
                    { up, first, all }
                );

                // 2. the interactive board shows Try pressed and Mark; the static board only Mark. Done before any mark: a board
                // switch drops the marks
                await clickCanvasTab(h, "Static");
                const stat = await read(h);
                await h.shot("cdp-shots/proto-pane-2-static.png");
                await clickCanvasTab(h, "Main");
                const upAgain = await polishWaitFor(h, `!!document.querySelector(${JSON.stringify(chipSel)})`, 12000);
                const live = await read(h);
                await h.shot("cdp-shots/proto-pane-2-toggle.png");
                rec(
                    "2. the interactive board shows the Try | Mark toggle with Try pressed; the static board only the Mark button, titled as before",
                    upAgain &&
                        live?.group === true &&
                        modeNames(live) === "try,mark" &&
                        pressed(live, "try") &&
                        !pressed(live, "mark") &&
                        stat?.group === false &&
                        modeNames(stat) === "mark" &&
                        !pressed(stat, "mark") &&
                        (stat.markTitle ?? "").startsWith("Mark parts of the board ("),
                    { interactive: live && { group: live.group, modes: live.modes }, static: stat && { group: stat.group, modes: stat.modes, title: stat.markTitle } }
                );

                // 3. the header's line leads with the screen and the slot's letter, then the age and the zoom
                const led = await polishWaitFor(
                    h,
                    `(document.querySelector(${JSON.stringify(`${PANE} [data-canvas-meta]`)})?.textContent || "").startsWith(${JSON.stringify(readoutOf(home, "A"))})`,
                    6000
                );
                const s3 = await read(h);
                rec(
                    `3. the readout reads the screen and the slot ("${readoutOf(home, "A")}") before the age and the zoom`,
                    led && s3.meta.startsWith(readoutOf(home, "A")) && /\d+%$/.test(s3.meta) && s3.meta.length > readoutOf(home, "A").length,
                    { meta: s3?.meta }
                );

                // 4. Mark: a box draws mark 1 and the tray comes up; the board takes no click; a click on a chip swaps the variant
                // and starts no mark
                await pressMode(h, "mark");
                const layerUp = await polishWaitFor(h, `!!document.querySelector(${JSON.stringify(`${PANE} [data-canvas-mark-layer]`)})`, 3000);
                const drew1 = layerUp && (await mark(h, BOX_ONE));
                const marked1 = await polishWaitFor(h, `!!document.querySelector(${JSON.stringify(`${PANE} [data-canvas-mark="1"]`)})`, 3000);
                await polishNap(CAPTURE_MS);
                const s4 = await read(h);
                await h.shot("cdp-shots/proto-pane-4-mark.png");
                // a click on the board's own switch button, over the layer: it is the layer's, so the screen stays and no mark starts
                const [goPoint] = (await points(h, [GO_BUTTON])) ?? [];
                if (goPoint != null) await click(h, goPoint);
                await polishNap(800);
                const s4a = await read(h);
                rec(
                    "4. in Mark a box draws mark 1 (the tray holds its note), and a click on the board's own button goes nowhere: the screen stays and no mark starts",
                    layerUp &&
                        drew1 &&
                        marked1 &&
                        pressed(s4, "mark") &&
                        !pressed(s4, "try") &&
                        s4.layer &&
                        JSON.stringify(s4.marks) === '["1"]' &&
                        s4.tray &&
                        s4.notes === 1 &&
                        goPoint != null &&
                        s4a.screen === home &&
                        s4a.notes === 1 &&
                        JSON.stringify(s4a.marks) === '["1"]',
                    { layerUp, drew1, marked1, marks: s4?.marks, notes: s4?.notes, screenAfterClick: s4a?.screen, notesAfterClick: s4a?.notes, marksAfterClick: s4a?.marks }
                );

                // 4b. a chip is above the layer: B swaps the region and starts no mark (mark 1 was drawn on A, so the layer hides
                // it while B shows, and the tray keeps it); A again brings it back
                const gotB = await pick(h, "B");
                await polishNap(400);
                const s4b = await read(h);
                await h.shot("cdp-shots/proto-pane-4b-b.png");
                const gotA = await pick(h, "A");
                await polishNap(400);
                const s4c = await read(h);
                rec(
                    "4b. in Mark a click on chip B swaps the variant and starts no mark (mark 1, drawn on A, leaves the layer and stays in the tray); A again brings it back",
                    gotB &&
                        s4b.chips[0]?.shown === "B" &&
                        s4b.layer &&
                        s4b.marks.length === 0 &&
                        s4b.notes === 1 &&
                        s4b.meta.startsWith(readoutOf(home, "B")) &&
                        gotA &&
                        s4c.chips[0]?.shown === "A" &&
                        JSON.stringify(s4c.marks) === '["1"]' &&
                        s4c.notes === 1,
                    { gotB, onB: { shown: s4b?.chips[0]?.shown, marks: s4b?.marks, notes: s4b?.notes, meta: s4b?.meta }, gotA, backOnA: { shown: s4c?.chips[0]?.shown, marks: s4c?.marks, notes: s4c?.notes } }
                );

                // 5. Try: the layer goes, the board takes clicks again, and mark 1 stays in the tray through a move to the second
                // screen and a swap to B
                await pressMode(h, "try");
                const layerGone = await polishWaitFor(h, `!document.querySelector(${JSON.stringify(`${PANE} [data-canvas-mark-layer]`)})`, 3000);
                const s5a = await read(h);
                const went = await goTo(h, later);
                await polishNap(300);
                const s5b = await read(h);
                const swapped = await pick(h, "B");
                await polishNap(300);
                const s5c = await read(h);
                await h.shot("cdp-shots/proto-pane-5-try.png");
                rec(
                    `5. Try: the layer goes and the toggle shows Try; a move to "${later}" and a swap to B (its slot has A and B) keep mark 1 in the tray, with no mark on the layer`,
                    layerGone &&
                        pressed(s5a, "try") &&
                        !pressed(s5a, "mark") &&
                        s5a.tray &&
                        s5a.notes === 1 &&
                        went &&
                        s5b.screen === later &&
                        lettersOf(s5b.chips[0]) === PROTO_SLOT.letters.later.join("") &&
                        s5b.meta.startsWith(readoutOf(later, "A")) &&
                        swapped &&
                        s5c.chips[0]?.shown === "B" &&
                        s5c.meta.startsWith(readoutOf(later, "B")) &&
                        s5c.tray &&
                        s5c.notes === 1 &&
                        !s5c.layer &&
                        s5c.marks.length === 0,
                    {
                        layerGone,
                        tryPressed: pressed(s5a, "try"),
                        trayAfterTry: s5a?.notes,
                        went,
                        screen: s5b?.screen,
                        letters: lettersOf(s5b?.chips[0]),
                        readoutOnTwo: s5b?.meta,
                        swapped,
                        readoutOnB: s5c?.meta,
                        notes: s5c?.notes,
                        layer: s5c?.layer,
                    }
                );

                // 6. Mark again: the layer holds no mark 1 (it was drawn on the first screen); mark 2 on this one, and the tray
                // names both contexts
                await pressMode(h, "mark");
                const layerBack = await polishWaitFor(h, `!!document.querySelector(${JSON.stringify(`${PANE} [data-canvas-mark-layer]`)})`, 3000);
                await polishNap(300);
                const s6a = await read(h);
                const drew2 = layerBack && (await mark(h, BOX_TWO));
                const marked2 = await polishWaitFor(h, `!!document.querySelector(${JSON.stringify(`${PANE} [data-canvas-mark="2"]`)})`, 3000);
                await polishNap(CAPTURE_MS);
                const s6b = await read(h);
                await h.shot("cdp-shots/proto-pane-6-two-marks.png");
                // the picture for the What's new card: the toggle, the marked board and the tray naming both screens. A failed
                // capture is no failed step
                let picture = null;
                try {
                    picture = (await h.whatsnewShot?.("proto-pane", { selector: PANE, pad: 0 }))?.comment ?? null;
                } catch (e) {
                    picture = `no picture: ${String(e?.message ?? e)}`;
                }
                rec(
                    "6. Mark again: the layer hides mark 1 (drawn on the first screen); mark 2 on this screen takes number 2, and the tray names both contexts",
                    layerBack &&
                        s6a.marks.length === 0 &&
                        s6a.notes === 1 &&
                        drew2 &&
                        marked2 &&
                        JSON.stringify(s6b.marks) === '["2"]' &&
                        s6b.notes === 2 &&
                        JSON.stringify(s6b.contexts) === JSON.stringify([["1", phraseOf(home, "A")], ["2", phraseOf(later, "B")]]),
                    { layerBack, layerBefore: s6a?.marks, notesBefore: s6a?.notes, drew2, marked2, layerMarks: s6b?.marks, notes: s6b?.notes, contexts: s6b?.contexts, picture }
                );

                // 8. m toggles the mode (shown here, before Send, which leaves the canvas). Whether CDP keys reach the page is
                // probed first, as canvas-swap does
                await h.ev(`(() => {
                    document.activeElement?.blur?.();
                    window.__protoSeen = [];
                    window.__protoProbe = (e) => window.__protoSeen.push(e.key);
                    window.addEventListener("keydown", window.__protoProbe, true);
                    return true;
                })()`);
                const mKey = { key: "m", code: "KeyM", keyCode: 77 };
                await pressCanvasKey(h, mKey);
                const delivered = await h.ev(`window.__protoSeen.includes("m")`);
                const s8a = await read(h);
                await pressCanvasKey(h, mKey);
                const s8b = await read(h);
                await h.ev(`window.removeEventListener("keydown", window.__protoProbe, true)`);
                if (!delivered) {
                    steps.push(skipStep("8. m toggles the mode", "CDP key events do not reach this page, so the key cannot be pressed"));
                } else {
                    rec(
                        "8. m toggles the mode: Mark to Try (the layer goes, both marks stay in the tray) and back to Mark (mark 2 is on the layer again)",
                        pressed(s8a, "try") &&
                            !pressed(s8a, "mark") &&
                            !s8a.layer &&
                            s8a.notes === 2 &&
                            pressed(s8b, "mark") &&
                            !pressed(s8b, "try") &&
                            s8b.layer &&
                            JSON.stringify(s8b.marks) === '["2"]' &&
                            s8b.notes === 2,
                        { afterM: { modes: s8a?.modes, layer: s8a?.layer, notes: s8a?.notes }, afterMAgain: { modes: s8b?.modes, layer: s8b?.layer, marks: s8b?.marks, notes: s8b?.notes } }
                    );
                }

                // 7. Send, where the window can be captured: two pictures (one per screen) and one line naming both screens and
                // the slot's letter in each. The marks' own pictures were taken as they were drawn
                const host = await h.ev(`!!window.__TAURI_INTERNALS__`);
                if (!host) {
                    steps.push(skipStep("7. Send writes one picture per screen and one line naming both", "no Tauri host to capture the window in (the pictures Send saves); steps 1 to 6 and 8 did not need it"));
                } else {
                    await h.ev(WRITES_INSTALL);
                    const feedback = (n) => `.superpowers/design/${TOPIC}/feedback/${n}.png`;
                    const line =
                        `look at ${feedback("001")} — marks on ${PROTO_MAIN}, ${phraseOf(home, "A")}: 1 (no note)` +
                        ` | look at ${feedback("002")} — marks on ${PROTO_MAIN}, ${phraseOf(later, "B")}: 2 (no note)`;
                    const before = countIn(await bsTermText(h, ctx).catch(() => ""), line);
                    const mark = await h.ev(`(window.__protoWrites ?? []).length`);
                    await h.ev(`document.querySelector(${JSON.stringify(`${PANE} [data-canvas-send]`)})?.click()`);
                    // Send is done when its Enter is written after the line; a moment more shows whether the line went twice
                    let writes = [];
                    for (let waited = 0; waited < SEND_WAIT_MS; waited += 250) {
                        writes = await writesSince(h, mark);
                        const soFar = typedTo(writes, ctx.blockId);
                        const i = soFar.indexOf(line);
                        if (i >= 0 && soFar.slice(i + line.length).includes("\r")) break;
                        await polishNap(250);
                    }
                    await polishNap(500);
                    writes = await writesSince(h, mark);
                    let shown = before;
                    let termError = null;
                    for (let waited = 0; waited < TERM_WAIT_MS && shown <= before; waited += 250) {
                        try {
                            shown = countIn(await bsTermText(h, ctx), line);
                        } catch (e) {
                            termError = String(e?.message ?? e);
                        }
                        if (shown <= before) await polishNap(250);
                    }
                    let files = [];
                    try {
                        files = readdirSync(join(ctx.cwd, ".superpowers", "design", TOPIC, "feedback")).sort();
                    } catch (e) {
                        files = [`unreadable: ${String(e?.message ?? e)}`];
                    }
                    // the line goes once, to the agent's own block and to no other, and Enter follows it; the shell shows it. The
                    // terminal's count is "more than before", not "one more": the shell runs the line and its error echoes it again
                    const own = typedTo(writes, ctx.blockId);
                    const at = own.indexOf(line);
                    const once = at >= 0 && own.indexOf(line, at + 1) < 0;
                    const entered = once && own.slice(at + line.length).includes("\r");
                    const elsewhere = writes.filter((w) => w.block !== ctx.blockId && w.text.includes(line)).length;
                    rec(
                        "7. Send writes two pictures (001.png, 002.png: one per screen marked) and types one line into the agent's terminal naming both screens and slot danh sách = B",
                        once &&
                            entered &&
                            elsewhere === 0 &&
                            shown > before &&
                            JSON.stringify(files) === JSON.stringify(["001.png", "002.png"]),
                        { files, want: line, once, entered, elsewhere, inTerminal: shown > before, termError, writes: writes.map((w) => ({ block: w.block === ctx.blockId ? "agent" : w.block, text: w.text })) }
                    );
                }

                // 1b. the Canvas gallery's card and viewer for the topic hold no screen. The gallery lists the topic only for a
                // registered project, and its grid reads the list when its tab mounts, so it is reached from another tab
                ctx.registered = true;
                await h.rpc("createproject", { name: PROJECT, path: ctx.cwd });
                await waitForProjectInConfig(h, PROJECT);
                await openLibraryTab(h, "conversations");
                await polishNap(400);
                await openLibraryTab(h, "canvases");
                const carded = await polishWaitFor(h, `!!document.querySelector('[data-canvas-card="${TOPIC}"]')`, 10000);
                const cardText = await h.ev(`(document.querySelector('[data-canvas-card="${TOPIC}"]')?.textContent || "").replace(/\\s+/g, " ").trim()`);
                // the count is its own element on the card (the preview's corner chip), read there: in the card's whole text it
                // runs into the board names before it and the topic after it ("…open it2 boardsverify-proto-pane")
                const counts = await h.ev(`[...(document.querySelector('[data-canvas-card="${TOPIC}"]')?.querySelectorAll("span") ?? [])]
                    .map((s) => (s.textContent || "").trim())
                    .filter((t) => /^\\d+ boards?$/.test(t))`);
                await h.ev(`document.querySelector('[data-canvas-card="${TOPIC}"]')?.click()`);
                const viewer = await polishWaitFor(h, `document.querySelector('${VIEWER}') != null`, 15000);
                const tabs = await h.ev(`[...document.querySelectorAll("[data-canvas-viewer-tab]")].map((b) => b.getAttribute("data-canvas-viewer-tab"))`);
                await h.shot("cdp-shots/proto-pane-1b-gallery.png");
                rec(
                    "1b. the Canvas gallery's card counts two boards and its viewer has a tab for the main and the static board and none for the screen file",
                    carded &&
                        JSON.stringify(counts) === '["2 boards"]' &&
                        viewer &&
                        tabs.length === 2 &&
                        noScreen(tabs),
                    { carded, counts, cardText, viewer, tabs }
                );

                // back to the agent's canvas, where teardown leaves it
                await cgPress(h, "Escape");
                await cgLeaveGallery(h);
                await h.goto("agent");
                return steps;
            },
            async teardown(h, ctx) {
                try {
                    await h.ev(WRITES_REMOVE);
                } catch (e) {
                    console.error(`${NAME} teardown: removing the terminal-write recorder failed: ${e?.message ?? e}`);
                }
                await teardownCanvasBoards(h, ctx, NAME);
                if (ctx.registered) await cgTeardown(h, ctx, NAME, PROJECT);
            },
        },
    ];
}
