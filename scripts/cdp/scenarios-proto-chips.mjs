// proto-chips: the A/B/C chips Arc draws on a clickable prototype's variant slots, on every board opened large
// (docs/superpowers/plans/2026-11-27-prototype-feedback.md, Task 4). The fixture is ./proto-fixtures.mjs: Main.dc.html is a
// prototype of two screens whose slot `list` ("danh sách") has variants A, B and C on the first screen and only A and B on
// the second; Static.dc.html has no slot. Each variant is drawn in its own color, so a screenshot says which one shows.
//
// The board is a cross-origin frame, so nothing here reads its DOM. What the board reported is read from the frame's data-
// canvas-proto / data-canvas-screen and from the chips drawn over it; what the board shows is read from the pixels of a
// window screenshot; the board is clicked with real mouse events at the page point the fixture draws its buttons at. None of
// it needs the host's window capture (the chips' own capture, canvasthumb.ts and canvascopy.ts, is a unit test's), so every
// step runs in the browser app too.
//
// kit is scenarios.mjs's CANVAS_KIT.

import { PROTO_MAIN, PROTO_SCREENS, PROTO_SLOT, PROTO_STATIC } from "./proto-fixtures.mjs";

const NAME = "proto-chips";
const TOPIC = "verify-proto-chips";
const PROJECT = "verify-proto-chips";

// the board's page size and the slot's box in it (proto-fixtures.mjs: the same on both screens)
const PAGE_W = 960;
const SLOT = { x: 80, y: 120, w: 400, h: 280 };
// the chip sits this far above the slot's top edge and in from its right edge (slotchips.tsx)
const CHIP_RISE = 12;
const CHIP_INSET = 12;
// page points the pixel reads and the clicks use: inside the slot at its bottom right, clear of the chip and of the
// variants' own drawing; just under the slot, where a variant that was not hidden would overflow; and the switch button
// ([data-proto-go]) of either screen, the same box on both, which the cross-origin board lets us click but not query
const INSIDE = { x: SLOT.x + SLOT.w - 24, y: SLOT.y + SLOT.h - 24 };
const BELOW = { x: 280, y: SLOT.y + SLOT.h + 12 };
const GO_BUTTON = { x: 130, y: 462 };
// each variant's background, and the page's white where no variant is
const COLORS = { A: [219, 234, 254], B: [220, 252, 231], C: [255, 237, 213], none: [255, 255, 255] };
const COLOR_TOLERANCE = 8;

const PANE = "[data-canvas-pane]";
const VIEWER = '[data-canvas-viewer-state="board"]';
const frameSel = (root, board) => `${root} [data-canvas-frame="${board}"]`;
const chipSel = (root, board) => `${frameSel(root, board)} [data-slot-chip="${PROTO_SLOT.id}"]`;

// what the page shows of a board: the frame's report attributes and each chip drawn over it, the iframe's box (the board's
// scale is its width over the page's), and the hover outline
const readExpr = (root, board) => `(() => {
    const f = document.querySelector(${JSON.stringify(frameSel(root, board))});
    if (!f) return null;
    const box = (r) => ({ left: r.left, top: r.top, right: r.right, bottom: r.bottom, width: r.width, height: r.height });
    const ifr = f.querySelector("iframe");
    const ir = ifr ? ifr.getBoundingClientRect() : null;
    const o = f.querySelector("[data-slot-outline]");
    return {
        proto: f.getAttribute("data-canvas-proto"),
        screen: f.getAttribute("data-canvas-screen"),
        iframe: ir ? box(ir) : null,
        scale: ir ? ir.width / ${PAGE_W} : null,
        chips: [...f.querySelectorAll("[data-slot-chip]")].map((c) => ({
            id: c.getAttribute("data-slot-chip"),
            shown: c.getAttribute("data-slot-shown"),
            visibility: getComputedStyle(c).visibility,
            box: box(c.getBoundingClientRect()),
            letters: [...c.querySelectorAll("[data-slot-letter]")].map((b) => ({
                letter: b.getAttribute("data-slot-letter"),
                pressed: b.getAttribute("aria-pressed") === "true",
                box: box(b.getBoundingClientRect()),
            })),
        })),
        outline: o ? { box: box(o.getBoundingClientRect()), style: getComputedStyle(o).borderTopStyle, events: getComputedStyle(o).pointerEvents, visibility: getComputedStyle(o).visibility } : null,
    };
})()`;

const mouse = (h, type, x, y) =>
    h.cdp("Input.dispatchMouseEvent", {
        type,
        x: Math.round(x),
        y: Math.round(y),
        button: type === "mouseMoved" ? "none" : "left",
        buttons: type === "mousePressed" ? 1 : 0,
        clickCount: type === "mouseMoved" ? 0 : 1,
    });

const center = (b) => ({ x: (b.left + b.right) / 2, y: (b.top + b.bottom) / 2 });

export default function (kit) {
    const {
        CANVAS_SWAP,
        UI_ROUTE,
        arrangeProtoCanvas,
        cgLeaveGallery,
        cgPress,
        cgTeardown,
        clickCanvasSwap,
        clickCanvasTab,
        openLibraryTab,
        polishNap,
        polishWaitFor,
        skipStep,
        teardownCanvasBoards,
        waitForProjectInConfig,
    } = kit;

    const read = (h, root, board) => h.ev(readExpr(root, board));
    const hover = async (h, p) => mouse(h, "mouseMoved", p.x, p.y);
    async function click(h, p) {
        await mouse(h, "mouseMoved", p.x, p.y);
        await mouse(h, "mousePressed", p.x, p.y);
        await mouse(h, "mouseReleased", p.x, p.y);
    }

    // the viewport points of these page points of a board, its pane scrolled first so that they are all in view
    const pointsExpr = (root, board, pts) => `(() => {
        const f = document.querySelector(${JSON.stringify(frameSel(root, board))});
        const ifr = f?.querySelector("iframe");
        const pane = f?.closest("[data-canvas-scroll], [data-canvas-viewer-scroll]");
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
    })()`;
    const points = (h, root, board, pts) => h.ev(pointsExpr(root, board, pts));

    // The color of the window's pixel at each viewport point, from one screenshot (decoded in the page, which has no
    // cross-origin frame to read here: the screenshot is the page's own picture of it)
    async function pixels(h, pts) {
        const { data } = await h.cdp("Page.captureScreenshot", { format: "png" });
        return h.ev(`(async () => {
            const bin = atob(${JSON.stringify(data)});
            const bytes = new Uint8Array(bin.length);
            for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
            const bmp = await createImageBitmap(new Blob([bytes], { type: "image/png" }));
            const c = new OffscreenCanvas(bmp.width, bmp.height);
            const g = c.getContext("2d");
            g.drawImage(bmp, 0, 0);
            const dpr = bmp.width / window.innerWidth;
            return ${JSON.stringify(pts)}.map((p) => [...g.getImageData(Math.round(p.x * dpr), Math.round(p.y * dpr), 1, 1).data].slice(0, 3));
        })()`);
    }
    const nameOf = (rgb) => {
        const hit = Object.entries(COLORS).find(([, c]) => c.every((v, i) => Math.abs(v - rgb[i]) <= COLOR_TOLERANCE));
        return hit ? hit[0] : `rgb(${rgb.join(",")})`;
    };
    // what the slot shows: the variant whose color is inside it, and whether anything shows under it (it must not: the
    // variants that are not picked are hidden, not stacked)
    async function shows(h, root, board) {
        const pts = await points(h, root, board, [INSIDE, BELOW]);
        if (pts == null) return null;
        const [inside, below] = (await pixels(h, pts)).map(nameOf);
        return { inside, below };
    }

    const lettersOf = (chip) => chip?.letters.map((l) => l.letter).join("") ?? null;
    const pressedOf = (chip) => chip?.letters.filter((l) => l.pressed).map((l) => l.letter) ?? null;
    const near = (a, b, tol = 2) => a != null && b != null && Math.abs(a - b) <= tol;
    const shownIs = (root, board, letter) =>
        `document.querySelector(${JSON.stringify(chipSel(root, board))})?.getAttribute("data-slot-shown") === ${JSON.stringify(letter)}`;
    const screenIs = (root, board, name) =>
        `document.querySelector(${JSON.stringify(frameSel(root, board))})?.getAttribute("data-canvas-screen") === ${JSON.stringify(name)}`;

    // a click on the board's own switch button (inside its frame, at a page point of it), then the wait for the report that
    // names the screen it leads to
    async function goTo(h, root, board, screen) {
        const [p] = (await points(h, root, board, [GO_BUTTON])) ?? [];
        if (p == null) return false;
        await click(h, p);
        return polishWaitFor(h, screenIs(root, board, screen), 6000);
    }
    // a click on a letter of the slot's chip
    async function pick(h, root, board, letter) {
        const r = await read(h, root, board);
        const b = r?.chips[0]?.letters.find((l) => l.letter === letter)?.box;
        if (b == null) return false;
        await click(h, center(b));
        return true;
    }

    return [
        {
            name: NAME,
            surface: "agent",
            arrange: (h) => arrangeProtoCanvas(h, "verify-proto-chips-", TOPIC),
            async assert(h, ctx) {
                if (ctx.launchError != null) {
                    return [skipStep("proto chips", `could not verify: ${ctx.launchError}`)];
                }
                if (ctx.focusError != null) {
                    return [skipStep("proto chips", `could not verify: focusing the terminal failed: ${ctx.focusError}`)];
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

                // 1. the chip shows on the slot with A pressed, on the slot's top-right edge
                const up = await polishWaitFor(h, `!!document.querySelector(${JSON.stringify(chipSel(PANE, PROTO_MAIN))})`, 12000);
                const s1 = await read(h, PANE, PROTO_MAIN);
                const chip1 = s1?.chips[0];
                const px1 = up ? await shows(h, PANE, PROTO_MAIN) : null;
                await h.shot("cdp-shots/proto-chips-1.png");
                const want = s1?.iframe == null ? null : { right: s1.iframe.left + (SLOT.x + SLOT.w) * s1.scale - CHIP_INSET, top: s1.iframe.top + SLOT.y * s1.scale - CHIP_RISE };
                rec(
                    `1. in the agent's canvas pane the chip shows on the slot ("${PROTO_SLOT.label}") with A pressed, and A is what the board shows`,
                    up &&
                        s1?.proto === "1" &&
                        s1.screen === PROTO_SCREENS.home &&
                        s1.chips.length === 1 &&
                        lettersOf(chip1) === "ABC" &&
                        JSON.stringify(pressedOf(chip1)) === '["A"]' &&
                        chip1.shown === "A" &&
                        px1?.inside === "A" &&
                        px1?.below === "none",
                    { up, proto: s1?.proto, screen: s1?.screen, letters: lettersOf(chip1), pressed: pressedOf(chip1), px: px1 }
                );
                rec(
                    "1b. the chip sits on the slot's top-right edge, half above it, in from the corner",
                    want != null && chip1 != null && near(chip1.box.right, want.right) && near(chip1.box.top, want.top),
                    { chip: chip1?.box, want }
                );

                // 1c. a window capture hides every overlay: with the frame carrying the capture attribute, the chip is invisible
                // (and takes no room, so the picture is the board's alone), and it is back when the attribute goes
                const during = await h.ev(`(() => {
                    const f = document.querySelector(${JSON.stringify(frameSel(PANE, PROTO_MAIN))});
                    const c = f.querySelector("[data-slot-chip]");
                    const before = getComputedStyle(c).visibility;
                    f.setAttribute("data-canvas-capturing", "");
                    const during = getComputedStyle(c).visibility;
                    f.removeAttribute("data-canvas-capturing");
                    return { before, during, after: getComputedStyle(c).visibility };
                })()`);
                rec(
                    "1c. while the frame is captured (data-canvas-capturing) the chip is invisible, and visible again after",
                    during.before === "visible" && during.during === "hidden" && during.after === "visible",
                    during
                );

                // 2. hovering the chip outlines the slot region dashed, and it goes with the pointer
                const c1 = chip1 == null ? null : center(chip1.box);
                if (c1 != null) await hover(h, c1);
                const hot = await polishWaitFor(h, `!!document.querySelector(${JSON.stringify(`${frameSel(PANE, PROTO_MAIN)} [data-slot-outline]`)})`, 3000);
                const s2 = await read(h, PANE, PROTO_MAIN);
                const o = s2?.outline;
                await h.shot("cdp-shots/proto-chips-2-hover.png");
                const wantBox =
                    s2?.iframe == null
                        ? null
                        : {
                              left: s2.iframe.left + SLOT.x * s2.scale,
                              top: s2.iframe.top + SLOT.y * s2.scale,
                              width: SLOT.w * s2.scale,
                              height: SLOT.h * s2.scale,
                          };
                const hidden2 = await h.ev(`(() => {
                    const f = document.querySelector(${JSON.stringify(frameSel(PANE, PROTO_MAIN))});
                    f.setAttribute("data-canvas-capturing", "");
                    const v = getComputedStyle(f.querySelector("[data-slot-outline]")).visibility;
                    f.removeAttribute("data-canvas-capturing");
                    return v;
                })()`);
                await hover(h, { x: 5, y: 5 });
                const gone = await polishWaitFor(h, `!document.querySelector("[data-slot-outline]")`, 3000);
                rec(
                    "2. hovering the chip outlines the slot region dashed (it takes no pointer, hides for a capture, and goes when the pointer leaves)",
                    hot &&
                        o != null &&
                        o.style === "dashed" &&
                        o.events === "none" &&
                        hidden2 === "hidden" &&
                        wantBox != null &&
                        near(o.box.left, wantBox.left, 3) &&
                        near(o.box.top, wantBox.top, 3) &&
                        near(o.box.width, wantBox.width, 3) &&
                        near(o.box.height, wantBox.height, 3) &&
                        gone,
                    { hot, outline: o, wantBox, hiddenForCapture: hidden2, gone }
                );

                // 3. clicking B: the next report shows B (the chip's pressed letter follows the report), and the region
                // is the B variant alone
                const clicked3 = await pick(h, PANE, PROTO_MAIN, "B");
                const swapped = await polishWaitFor(h, shownIs(PANE, PROTO_MAIN, "B"), 5000);
                await polishNap(300);
                const s3 = await read(h, PANE, PROTO_MAIN);
                const px3 = await shows(h, PANE, PROTO_MAIN);
                await h.shot("cdp-shots/proto-chips-3-b.png");
                rec(
                    "3. clicking B swaps the region: the chip shows B pressed (as the board reported it), the region is the B variant, and no other variant shows under it",
                    clicked3 &&
                        swapped &&
                        JSON.stringify(pressedOf(s3?.chips[0])) === '["B"]' &&
                        px3?.inside === "B" &&
                        px3?.below === "none",
                    { clicked3, swapped, pressed: pressedOf(s3?.chips[0]), px: px3 }
                );

                // 4. moving to the second screen keeps B (its slot has A and B)
                const went = await goTo(h, PANE, PROTO_MAIN, PROTO_SCREENS.later);
                const kept = await polishWaitFor(h, shownIs(PANE, PROTO_MAIN, "B"), 5000);
                await polishNap(300);
                const s4 = await read(h, PANE, PROTO_MAIN);
                const px4 = await shows(h, PANE, PROTO_MAIN);
                await h.shot("cdp-shots/proto-chips-4-screen2.png");
                rec(
                    `4. moving to the second screen ("${PROTO_SCREENS.later}") keeps B: the slot there has A and B, B pressed and showing`,
                    went &&
                        kept &&
                        s4?.screen === PROTO_SCREENS.later &&
                        lettersOf(s4.chips[0]) === PROTO_SLOT.letters.later.join("") &&
                        JSON.stringify(pressedOf(s4.chips[0])) === '["B"]' &&
                        px4?.inside === "B" &&
                        px4?.below === "none",
                    { went, kept, screen: s4?.screen, letters: lettersOf(s4?.chips[0]), pressed: pressedOf(s4?.chips[0]), px: px4 }
                );

                // 4b. a pick of C on screen one, then screen two, whose slot lacks C: its first variant A shows, the other is
                // hidden, and the chip offers A and B with A pressed
                const back1 = await goTo(h, PANE, PROTO_MAIN, PROTO_SCREENS.home);
                const pickedC = await pick(h, PANE, PROTO_MAIN, "C");
                const cShown = await polishWaitFor(h, shownIs(PANE, PROTO_MAIN, "C"), 5000);
                await polishNap(300);
                const pxC = await shows(h, PANE, PROTO_MAIN);
                const went2 = await goTo(h, PANE, PROTO_MAIN, PROTO_SCREENS.later);
                const aShown = await polishWaitFor(h, shownIs(PANE, PROTO_MAIN, "A"), 5000);
                await polishNap(300);
                const s4b = await read(h, PANE, PROTO_MAIN);
                const px4b = await shows(h, PANE, PROTO_MAIN);
                await h.shot("cdp-shots/proto-chips-4b-no-c.png");
                rec(
                    "4b. C picked on screen one, screen two (A and B only) shows its first variant A with the other hidden, and its chip has A pressed and no C",
                    back1 &&
                        pickedC &&
                        cShown &&
                        pxC?.inside === "C" &&
                        pxC?.below === "none" &&
                        went2 &&
                        aShown &&
                        lettersOf(s4b?.chips[0]) === "AB" &&
                        JSON.stringify(pressedOf(s4b?.chips[0])) === '["A"]' &&
                        px4b?.inside === "A" &&
                        px4b?.below === "none",
                    { back1, pickedC, cShown, pxC, went2, aShown, letters: lettersOf(s4b?.chips[0]), pressed: pressedOf(s4b?.chips[0]), px: px4b }
                );

                // 4c. back on screen one the pick of C was held through screen two; then B again, the pick the gallery step reads
                const back2 = await goTo(h, PANE, PROTO_MAIN, PROTO_SCREENS.home);
                const cHeld = await polishWaitFor(h, shownIs(PANE, PROTO_MAIN, "C"), 5000);
                await polishNap(300);
                const pxHeld = await shows(h, PANE, PROTO_MAIN);
                const pickedB = await pick(h, PANE, PROTO_MAIN, "B");
                const bBack = await polishWaitFor(h, shownIs(PANE, PROTO_MAIN, "B"), 5000);
                rec(
                    "4c. back on screen one the pick of C still holds (it showed A on screen two only because that slot lacks C); B picked again",
                    back2 && cHeld && pxHeld?.inside === "C" && pickedB && bBack,
                    { back2, cHeld, px: pxHeld, pickedB, bBack }
                );

                // 7. a static board shows no chip: its page reported no slot (the frame says it reported, 0 slots)
                await clickCanvasTab(h, "Static");
                const staticReported = await polishWaitFor(
                    h,
                    `document.querySelector(${JSON.stringify(frameSel(PANE, PROTO_STATIC))})?.getAttribute("data-canvas-proto") === "0"`,
                    10000
                );
                await polishNap(400);
                const staticChips = await h.ev(`document.querySelectorAll("[data-slot-chip]").length`);
                await h.shot("cdp-shots/proto-chips-7-static.png");
                rec(
                    "7. a static board shows no chip: its page reported no slot, and the pane draws none",
                    staticReported && staticChips === 0,
                    { staticReported, chips: staticChips }
                );

                // 5. under All no tile shows a chip, though the prototype's tile (a fresh page: the Static tab had unmounted it)
                // has reported its slot
                await clickCanvasTab(h, "All");
                const tileReported = await polishWaitFor(
                    h,
                    `document.querySelector(${JSON.stringify(frameSel(PANE, PROTO_MAIN))})?.getAttribute("data-canvas-proto") === "1"`,
                    10000
                );
                await polishNap(600);
                const all = await h.ev(`(() => ({
                    frames: [...document.querySelectorAll("${PANE} [data-canvas-frame]")].map((f) => f.getAttribute("data-canvas-frame")),
                    covers: document.querySelectorAll('${PANE} [data-canvas-frame] button[aria-label^="Open "]').length,
                    chips: document.querySelectorAll("[data-slot-chip]").length,
                    outlines: document.querySelectorAll("[data-slot-outline]").length,
                }))()`);
                await h.shot("cdp-shots/proto-chips-5-all.png");
                rec(
                    "5. under All every board is a tile and no tile shows a chip, though the prototype's tile has reported its slot",
                    tileReported && all.frames.length === 2 && all.covers === 2 && all.chips === 0 && all.outlines === 0,
                    { tileReported, ...all }
                );

                // 6. the Canvas gallery's viewer for the same topic shows the chip with B (the picks are shared by the board's
                // URL, so a fresh page that reports A is sent B again)
                ctx.registered = true;
                await h.rpc("createproject", { name: PROJECT, path: ctx.cwd });
                await waitForProjectInConfig(h, PROJECT);
                // the grid reads the list when its tab mounts, so come to it from another tab
                await openLibraryTab(h, "conversations");
                await polishNap(400);
                await openLibraryTab(h, "canvases");
                const carded = await polishWaitFor(h, `!!document.querySelector('[data-canvas-card="${TOPIC}"]')`, 10000);
                await h.ev(`document.querySelector('[data-canvas-card="${TOPIC}"]')?.click()`);
                const viewer = await polishWaitFor(h, `document.querySelector('${VIEWER}') != null`, 15000);
                const chipUp = await polishWaitFor(h, `!!document.querySelector(${JSON.stringify(chipSel(VIEWER, PROTO_MAIN))})`, 12000);
                const bInViewer = await polishWaitFor(h, shownIs(VIEWER, PROTO_MAIN, "B"), 10000);
                await polishNap(300);
                const s6 = await read(h, VIEWER, PROTO_MAIN);
                const px6 = chipUp ? await shows(h, VIEWER, PROTO_MAIN) : null;
                await h.shot("cdp-shots/proto-chips-6-gallery.png");
                rec(
                    "6. the Canvas gallery's viewer for the same topic shows the chip with B pressed, and B is what the board shows",
                    carded &&
                        viewer &&
                        chipUp &&
                        bInViewer &&
                        lettersOf(s6?.chips[0]) === "ABC" &&
                        JSON.stringify(pressedOf(s6?.chips[0])) === '["B"]' &&
                        px6?.inside === "B" &&
                        px6?.below === "none",
                    { carded, viewer, chipUp, bInViewer, letters: lettersOf(s6?.chips[0]), pressed: pressedOf(s6?.chips[0]), px: px6 }
                );

                // back to the agent's canvas, where teardown leaves it
                await cgPress(h, "Escape");
                await cgLeaveGallery(h);
                await h.goto("agent");
                return steps;
            },
            async teardown(h, ctx) {
                await teardownCanvasBoards(h, ctx, NAME);
                if (ctx.registered) await cgTeardown(h, ctx, NAME, PROJECT);
            },
        },
    ];
}
