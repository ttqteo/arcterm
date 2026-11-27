// proto-rail: the brainstorm rail's opened prototype board: Try on it, the question's slot previewing its options, marks that
// survive Try (docs/superpowers/specs/2026-11-27-prototype-feedback-design.md). The fixture is ./proto-fixtures.mjs: Main.dc.html
// is a prototype of two screens whose slot `list` ("danh sách") has variants A, B and C on the first screen and A and B on the
// second. The brainstorm asks one question about the part that lists that one board, names the slot (`slot: "list"`) and has
// three options, so option i is the slot's letter i, and the chip's letter is the option the pick bar offers.
//
// The board is a cross-origin frame, so nothing here reads its DOM: what it reported is read from the frame's data-canvas-proto /
// data-canvas-screen and from the chips drawn over it, and the board is clicked with real mouse events at the page point the
// fixture draws its switch button at. Every step runs without a Tauri host (drawing a mark never needs the window capture; a
// failed one leaves the mark standing), so no step here depends on one and none sends.
//
// kit is scenarios.mjs's BS_KIT and CANVAS_KIT together.

import { PROTO_MAIN, PROTO_SCREENS, PROTO_SLOT, writeProtoTopic } from "./proto-fixtures.mjs";

const NAME = "proto-rail";
const TOPIC = "verify-proto-rail";
const PART = "list";

// the board's page size and where its switch button is on either screen (the same box: proto-fixtures.mjs)
const PAGE_W = 960;
const GO_BUTTON = { x: 130, y: 462 };

const QUESTION = {
    n: 1,
    text: "Which list should the page use?",
    part: PART,
    slot: PROTO_SLOT.id,
    options: [
        { label: "Cards", detail: "Three cards side by side." },
        { label: "Rows", detail: "One row per item.", pick: true },
        { label: "Compact", detail: "A dense line of items." },
    ],
};
const LETTERS = ["A", "B", "C"];
const BOARD_WAIT_MS = 8000;
const CLOSE_WAIT_MS = 3000;

export default function (kit) {
    const {
        BS_PANE,
        bsArrangeAgent,
        bsFile,
        bsKey,
        bsKeysArrive,
        bsMouseClick,
        bsShowFile,
        bsTeardownAgent,
        bsUntil,
        polishNap,
        polishWaitFor,
        skipStep,
    } = kit;

    const FILE = bsFile({
        canvas: TOPIC,
        question: QUESTION,
        parts: [{ id: PART, title: "The list", state: "asked", body: "", boards: [PROTO_MAIN] }],
    });

    const tile = `document.querySelector('[data-brainstorm-board-rail] [data-brainstorm-rail-board="${PROTO_MAIN}"] button')`;
    const DIALOG = `${BS_PANE}?.querySelector("[data-brainstorm-board-dialog]")`;
    const WIDE = `${DIALOG}?.querySelector("[data-brainstorm-rail-widened]")`;
    const FRAME = `${WIDE}?.querySelector('[data-canvas-frame="${PROTO_MAIN}"]')`;
    const MODE = (m) => `${WIDE}?.querySelector('[data-canvas-mode="${m}"]')`;
    const NOTE = `input[aria-label="Note for mark 1"]`;
    const letterBtn = (letter) => `${FRAME}?.querySelector('[data-slot-chip="${PROTO_SLOT.id}"] [data-slot-letter="${letter}"]')`;

    // everything a step judges, in one read: the rail's tiles, the dialog and the board it shows (what it reported), the
    // toggle, the mark layer and tray, the pick bar and which option rows are lit (data-linked)
    const READ = `(() => {
        const flat = (el) => (el?.innerText ?? "").replace(/\\s+/g, " ").trim();
        const pane = ${BS_PANE};
        const dialog = ${DIALOG};
        const wide = ${WIDE};
        const frame = ${FRAME};
        const mode = (m) => wide?.querySelector('[data-canvas-mode="' + m + '"]');
        const pick = dialog?.querySelector("[data-brainstorm-board-pick]");
        const note = dialog?.querySelector(${JSON.stringify(NOTE)});
        const send = dialog?.querySelector("[data-canvas-send]");
        return {
            tiles: [...document.querySelectorAll("[data-brainstorm-board-rail] [data-brainstorm-rail-board]")].map((t) => ({
                name: t.getAttribute("data-brainstorm-rail-board"),
                frame: !!t.querySelector("iframe"),
            })),
            dialog: !!dialog,
            board: frame?.getAttribute("data-canvas-frame") ?? null,
            proto: frame?.getAttribute("data-canvas-proto") ?? null,
            screen: frame?.getAttribute("data-canvas-screen") ?? null,
            chip: frame?.querySelector("[data-slot-chip]")?.getAttribute("data-slot-shown") ?? null,
            letters: [...(frame?.querySelectorAll("[data-slot-letter]") ?? [])].map((b) => b.getAttribute("data-slot-letter")).join(""),
            toggle: !!wide?.querySelector('[role="group"][aria-label="Board mode"]'),
            tryPressed: mode("try")?.getAttribute("aria-pressed") ?? null,
            markPressed: mode("mark")?.getAttribute("aria-pressed") ?? null,
            markHook: mode("mark")?.hasAttribute("data-brainstorm-rail-mark") ?? false,
            cover: !!wide?.querySelector("[data-brainstorm-rail-unwiden]"),
            layer: !!wide?.querySelector("[data-canvas-mark-layer]"),
            drawn: wide?.querySelectorAll("[data-canvas-mark]").length ?? 0,
            tray: !!dialog?.querySelector("[data-canvas-tray]"),
            noteField: !!note,
            sendReady: !!send && !send.disabled,
            pickBar: !!dialog?.querySelector("[data-brainstorm-board-pick-bar]"),
            pick: flat(pick),
            pickOption: pick?.getAttribute("data-brainstorm-board-pick") ?? null,
            lit: [0, 1, 2].map((i) => pane?.querySelector('[data-brainstorm-option-row="' + i + '"]')?.hasAttribute("data-linked") ?? null),
        };
    })()`;
    const read = (h) => h.ev(READ);
    // polls the pane until want(read) holds; the last read and whether it did
    async function until(h, want, ms = BOARD_WAIT_MS) {
        const start = Date.now();
        let r;
        do {
            r = await read(h).catch((e) => ({ error: String(e?.message ?? e), tiles: [] }));
            if (r.error == null && want(r)) return { ...r, ok: true };
            await polishNap(200);
        } while (Date.now() - start < ms);
        return { ...r, ok: false };
    }

    const mouse = (h, type, x, y, buttons = 0) =>
        h.cdp("Input.dispatchMouseEvent", {
            type,
            x: Math.round(x),
            y: Math.round(y),
            button: type === "mouseMoved" && buttons === 0 ? "none" : "left",
            buttons: type === "mousePressed" ? 1 : buttons,
            clickCount: type === "mouseMoved" ? 0 : 1,
        });

    // a click on the board's own switch button (inside its frame, at a page point of it, its scroll area moved first so
    // the point is in view), then the wait for the report that names the screen it leads to
    async function goTo(h, screen) {
        const p = await h.ev(`(() => {
            const ifr = ${FRAME}?.querySelector("iframe");
            const pane = ${WIDE}?.querySelector("[data-canvas-scroll]");
            if (!ifr || !pane) return null;
            const s = ifr.getBoundingClientRect().width / ${PAGE_W};
            const top = ifr.getBoundingClientRect().top + ${GO_BUTTON.y} * s;
            const pr = pane.getBoundingClientRect();
            if (top < pr.top + 8 || top > pr.bottom - 8) pane.scrollTop += top - (pr.top + pr.height / 2);
            const r = ifr.getBoundingClientRect();
            return { x: Math.round(r.left + ${GO_BUTTON.x} * s), y: Math.round(r.top + ${GO_BUTTON.y} * s) };
        })()`);
        if (p == null) return false;
        await mouse(h, "mouseMoved", p.x, p.y);
        await mouse(h, "mousePressed", p.x, p.y);
        await mouse(h, "mouseReleased", p.x, p.y);
        return polishWaitFor(h, `${FRAME}?.getAttribute("data-canvas-screen") === ${JSON.stringify(screen)}`, 6000);
    }

    // a box dragged over the mark layer with real mouse events
    async function drawBox(h) {
        const box = await h.ev(`(() => {
            const r = ${WIDE}?.querySelector("[data-canvas-mark-layer]")?.getBoundingClientRect();
            return r && r.width > 0 ? { x: r.left, y: r.top, w: r.width, h: r.height } : null;
        })()`);
        if (box == null) return false;
        const from = { x: box.x + box.w * 0.15, y: box.y + box.h * 0.3 };
        const to = { x: box.x + box.w * 0.6, y: box.y + box.h * 0.7 };
        await mouse(h, "mouseMoved", from.x, from.y);
        await mouse(h, "mousePressed", from.x, from.y);
        await mouse(h, "mouseMoved", (from.x + to.x) / 2, (from.y + to.y) / 2, 1);
        await mouse(h, "mouseMoved", to.x, to.y, 1);
        await mouse(h, "mouseReleased", to.x, to.y);
        return true;
    }

    // Esc as the user presses it from the page's focus; a keydown on the document when CDP keys do not reach the page
    async function escape(h) {
        if (await bsKeysArrive(h)) {
            await bsKey(h, null, "Escape", "keys");
            return "keys";
        }
        await h.ev(`document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", code: "Escape", bubbles: true, cancelable: true }))`);
        await polishNap(300);
        return "event";
    }

    const openBoard = async (h) => {
        const clicked = await bsMouseClick(h, tile);
        const r = await until(h, (s) => s.dialog && s.board === PROTO_MAIN && s.proto === "1" && s.chip != null);
        return { clicked, ...r };
    };

    return [
        {
            name: NAME,
            surface: "agent",
            async arrange(h) {
                const ctx = await bsArrangeAgent(h, TOPIC, FILE);
                if (ctx.launchError != null || ctx.cwd == null) return ctx;
                // the canvas the file names (.superpowers/design/<topic>/project), written before the pane's reveal attaches it
                try {
                    writeProtoTopic(ctx.cwd, TOPIC);
                } catch (e) {
                    ctx.launchError = String(e?.message ?? e);
                }
                return ctx;
            },
            async assert(h, ctx) {
                const missing = await bsShowFile(h, ctx);
                if (missing != null) return [skipStep(NAME, `could not verify: ${missing}`)];
                const steps = [];
                const rec = (step, ok, detail) => steps.push({ step, ok, detail: typeof detail === "string" ? detail : JSON.stringify(detail) });

                // 0. the question is up with its three options and the prototype's tile in the rail
                const asked = await bsUntil(h, ctx, (s) => s.question.includes(QUESTION.text) && s.options.length === 3);
                const rail = await until(h, (r) => r.tiles.length === 1 && r.tiles[0].frame);
                rec(
                    "0. the question is up with its three answers and the prototype's live tile in the rail, no board open",
                    asked.ok && rail.ok && rail.tiles[0].name === PROTO_MAIN && !rail.dialog,
                    { question: asked.ok, tiles: rail.tiles, dialog: rail.dialog }
                );
                if (!asked.ok || !rail.ok) return steps;

                // 1. the board opens in Try, with nothing over it: a click runs it (the screen changes, the dialog stays)
                const opened = await openBoard(h);
                await h.shot("cdp-shots/proto-rail-1-try.png");
                const onHome = opened.screen === PROTO_SCREENS.home;
                const there = onHome ? await goTo(h, PROTO_SCREENS.later) : false;
                const away = await read(h);
                const back = there ? await goTo(h, PROTO_SCREENS.home) : false;
                const home = await read(h);
                rec(
                    "1. the opened prototype shows Try pressed beside Mark and no cover over the board, and a click on it runs it: the screen moves on and back with the dialog still open",
                    opened.ok &&
                        opened.toggle &&
                        opened.tryPressed === "true" &&
                        opened.markPressed === "false" &&
                        opened.markHook &&
                        !opened.cover &&
                        !opened.layer &&
                        onHome &&
                        there &&
                        away.dialog &&
                        away.screen === PROTO_SCREENS.later &&
                        back &&
                        home.dialog &&
                        home.screen === PROTO_SCREENS.home,
                    {
                        opened: opened.ok,
                        toggle: opened.toggle,
                        tryPressed: opened.tryPressed,
                        markPressed: opened.markPressed,
                        markHook: opened.markHook,
                        cover: opened.cover,
                        layer: opened.layer,
                        screens: [opened.screen, away.screen, home.screen],
                        dialog: [away.dialog, home.dialog],
                    }
                );
                if (!opened.ok || !home.dialog) return steps;

                // 2. the question's slot previews its options: the pick bar offers the option whose letter the chip shows
                // (A before any pick), and a chip pick lights that option's row, the answer still being given by picking the row
                const wantBar = (i) => `Pick ${LETTERS[i]} · ${QUESTION.options[i].label}`;
                const first = await read(h);
                const clickedC = await bsMouseClick(h, letterBtn("C"));
                const c = await until(h, (r) => r.chip === "C" && r.pick === wantBar(2) && r.lit[2] === true);
                await h.shot("cdp-shots/proto-rail-2-chip-c.png");
                const clickedB = await bsMouseClick(h, letterBtn("B"));
                const b = await until(h, (r) => r.chip === "B" && r.pick === wantBar(1) && r.lit[1] === true);
                rec(
                    "2. before any pick the bar offers A (Pick A · Cards); chip C lights option row C and the bar reads Pick C · Compact; chip B moves the light to row B and the bar to Pick B · Rows",
                    first.pick === wantBar(0) &&
                        first.pickOption === "0" &&
                        first.lit.every((x) => x === false) &&
                        clickedC !== false &&
                        c.ok &&
                        c.pickOption === "2" &&
                        JSON.stringify(c.lit) === "[false,false,true]" &&
                        clickedB !== false &&
                        b.ok &&
                        b.pickOption === "1" &&
                        JSON.stringify(b.lit) === "[false,true,false]",
                    {
                        first: { pick: first.pick, option: first.pickOption, lit: first.lit },
                        c: { ok: c.ok, chip: c.chip, pick: c.pick, option: c.pickOption, lit: c.lit },
                        b: { ok: b.ok, chip: b.chip, pick: b.pick, option: b.pickOption, lit: b.lit },
                    }
                );

                // 3. Mark freezes the board and draws a mark; Try runs it again and the tray keeps the mark and its note field
                const markClicked = await bsMouseClick(h, MODE("mark"));
                const layerUp = await polishWaitFor(h, `!!${WIDE}?.querySelector("[data-canvas-mark-layer]")`, 3000);
                const drew = layerUp ? await drawBox(h) : false;
                const marked = drew ? await polishWaitFor(h, `!!${WIDE}?.querySelector("[data-canvas-mark='1']")`, 3000) : false;
                const marking = await read(h);
                await h.shot("cdp-shots/proto-rail-3-mark.png");
                const tryClicked = await bsMouseClick(h, MODE("try"));
                const layerGone = await polishWaitFor(h, `!${WIDE}?.querySelector("[data-canvas-mark-layer]")`, 3000);
                const kept = await read(h);
                await h.shot("cdp-shots/proto-rail-3-try-kept.png");
                rec(
                    "3. Mark draws mark 1 over the frozen board with its tray under it, and after Try the layer is gone, the board runs again and the tray still holds the mark's note field and Send, in the pick's place",
                    markClicked !== false &&
                        layerUp &&
                        drew &&
                        marked &&
                        marking.markPressed === "true" &&
                        marking.tryPressed === "false" &&
                        marking.drawn === 1 &&
                        marking.tray &&
                        marking.noteField &&
                        !marking.pickBar &&
                        tryClicked !== false &&
                        layerGone &&
                        kept.tryPressed === "true" &&
                        kept.markPressed === "false" &&
                        !kept.cover &&
                        kept.drawn === 0 &&
                        kept.tray &&
                        kept.noteField &&
                        kept.sendReady &&
                        !kept.pickBar,
                    {
                        markClicked,
                        layerUp,
                        drew,
                        marked,
                        marking: { mark: marking.markPressed, try: marking.tryPressed, drawn: marking.drawn, tray: marking.tray, note: marking.noteField, pickBar: marking.pickBar },
                        tryClicked,
                        layerGone,
                        kept: { try: kept.tryPressed, mark: kept.markPressed, cover: kept.cover, drawn: kept.drawn, tray: kept.tray, note: kept.noteField, send: kept.sendReady, pickBar: kept.pickBar },
                    }
                );

                // 3b. Esc closes the opened board from Try with the mark kept (focus is on the Try button, in the page), and
                // closing drops the mark and puts the previewed row back: the board opens again with no tray and no row lit
                const via = await escape(h);
                const closed = await until(h, (r) => !r.dialog, CLOSE_WAIT_MS);
                await polishNap(500);
                const reopened = await openBoard(h);
                await h.shot("cdp-shots/proto-rail-3b-reopened.png");
                rec(
                    "3b. Esc closes the opened board from Try with a mark kept; the board opened again has no tray and no mark, Try pressed, and no option row left lit",
                    closed.ok &&
                        reopened.ok &&
                        !reopened.tray &&
                        reopened.drawn === 0 &&
                        reopened.tryPressed === "true" &&
                        reopened.markPressed === "false" &&
                        reopened.lit.every((x) => x === false),
                    { via, closed: closed.ok, reopened: reopened.ok, tray: reopened.tray, drawn: reopened.drawn, try: reopened.tryPressed, lit: reopened.lit }
                );

                // leave the dialog closed, as the other rail scenarios do
                await h.ev(`${DIALOG}?.querySelector("[data-brainstorm-rail-close]")?.click()`);
                await until(h, (r) => !r.dialog, CLOSE_WAIT_MS);
                return steps;
            },
            async teardown(h, ctx) {
                await bsTeardownAgent(h, ctx, NAME);
            },
        },
    ];
}
