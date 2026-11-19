// The bug box: the footer's bug button and Ctrl+Alt+R open a box over the window with its picture and a text field, and
// sending saves a report (docs/superpowers/specs/2026-11-19-bug-report-design.md, "The box"; plan
// docs/superpowers/plans/2026-11-19-bug-report.md).
//
//   Task 4 — bug-report-box: the box opens from the footer button and from Ctrl+Alt+R, shows the thumbnail and the text
//            box, sends, and the count rises.
//   Step 7 — Khoanh vùng (canvas bug-report, boards Region-1-box, Region-2-select, Region-3-marked): the picture over the
//            window, a dragged rectangle, Enter back to the box with the region in the thumb, and a save that keeps it.
//
// This file landed empty with the wire (Task 1) so Task 4 adds its scenario here and never edits scenarios.mjs.
// `kit` is scenarios.mjs's RUN_START_KIT (see scenarios-run-start-choice.mjs for what it holds); this scenario needs none
// of it.
//
// The scenario writes real reports (steps 1 to 3 and 6 use the real status and save commands) and removes them in
// teardown. Every text it types starts with TAG, which is how teardown finds them again even after an interrupted run.
import { rmSync } from "node:fs";
import { basename, dirname } from "node:path";

const TAG = "verify bug-report-box:";
const nap = (ms) => new Promise((r) => setTimeout(r, ms));

async function waitFor(h, expr, ms) {
    for (let waited = 0; waited < ms; waited += 150) {
        if (await h.ev(expr).catch(() => false)) return true;
        await nap(150);
    }
    return false;
}

const BOX = `document.querySelector('[data-bug-report-box]')`;
// the footer draws the button on the global bar and on the Cockpit's own: the one on screen
const BUTTON = `[...document.querySelectorAll('[data-bug-report-button]')].find((b) => b.checkVisibility())`;

// what the box shows, in one evaluate
const FACTS = `(() => {
    const box = ${BOX};
    const btn = ${BUTTON};
    const thumb = box?.querySelector('[data-bug-report-thumb]');
    const img = thumb?.querySelector('img');
    const text = box?.querySelector('[data-bug-report-text]');
    const send = box?.querySelector('[data-bug-report-send]');
    const waiting = box?.querySelector('[data-bug-report-waiting]');
    const r = box?.getBoundingClientRect();
    const b = btn?.getBoundingClientRect();
    const rect = (x) => x && { left: x.left, top: x.top, right: x.right, bottom: x.bottom, width: x.width, height: x.height };
    return {
        open: box != null,
        thumb: thumb?.getAttribute('data-bug-report-thumb') ?? null,
        imgLoaded: img != null && img.complete && img.naturalWidth > 0,
        placeholder: thumb != null && img == null ? thumb.textContent.trim() : null,
        textFocused: text != null && document.activeElement === text,
        textValue: text?.value ?? null,
        sendDisabled: send?.disabled ?? null,
        waitingAttr: waiting?.getAttribute('data-bug-report-waiting') ?? null,
        waitingText: waiting?.textContent.trim() ?? null,
        error: box?.querySelector('[data-bug-report-error]')?.textContent.trim() ?? null,
        buttonPressed: btn?.getAttribute('aria-pressed') ?? null,
        buttonTitle: btn?.getAttribute('title') ?? null,
        box: rect(r),
        button: rect(b),
        win: { width: innerWidth, height: innerHeight },
    };
})()`;

const setText = (value) => `(() => {
    const el = document.querySelector('[data-bug-report-text]');
    if (!el) return false;
    Object.getOwnPropertyDescriptor(Object.getPrototypeOf(el), 'value').set.call(el, ${JSON.stringify(value)});
    el.dispatchEvent(new Event('input', { bubbles: true }));
    return true;
})()`;

// A key press as the page sees it: a keydown on the element that has focus, so it passes the key dispatcher on window
// capture first, as a typed key does. (Not CDP's Input.dispatchKeyEvent: that needs the window focused.)
const keydown = (key, code, mods = {}) =>
    `(() => {
        const target = document.activeElement && document.activeElement !== document.body ? document.activeElement : document;
        target.dispatchEvent(new KeyboardEvent('keydown', { key: ${JSON.stringify(key)}, code: ${JSON.stringify(code)}, ctrlKey: ${!!mods.ctrl}, altKey: ${!!mods.alt}, bubbles: true, cancelable: true }));
        return true;
    })()`;
const ESC = keydown("Escape", "Escape");
const CTRL_ENTER = keydown("Enter", "Enter", { ctrl: true });
const CTRL_ALT_R = keydown("r", "KeyR", { ctrl: true, alt: true });

const waitingNow = async (h) => (await h.rpc("bugreportstatus", null))?.waiting;
const listWaiting = async (h) => (await h.rpc("bugreportlist", { state: "waiting" })) ?? [];

// the box has drawn (or gone), and the capture has settled: the box only draws once its picture came back
const boxShown = (h) => waitFor(h, `${BOX} != null`, 10000);
const boxGone = (h) => waitFor(h, `${BOX} == null`, 4000);

// closes whatever is open and removes the test's fakes, so one step's leftovers never reach the next
async function reset(h) {
    await h.ev(`delete window.__bugReportCaptureFake; delete window.__bugReportSaveFake; true`).catch(() => {});
    if (await h.ev(`${BOX} != null`).catch(() => false)) {
        await h.ev(ESC).catch(() => {});
        await boxGone(h);
    }
}

const bugReportBoxScenario = () => ({
    name: "bug-report-box",
    surface: "cockpit",
    async arrange(h) {
        const ctx = { arrangeError: null, dirs: [] };
        try {
            await reset(h);
            ctx.base = await waitingNow(h);
            if (typeof ctx.base !== "number") throw new Error(`bugreportstatus answered ${JSON.stringify(ctx.base)}`);
        } catch (e) {
            ctx.arrangeError = String(e?.message ?? e);
        }
        return ctx;
    },
    async assert(h, ctx) {
        const steps = [];
        const rec = (step, ok, detail) => steps.push({ step, ok: !!ok, detail });
        rec(
            "0. the report store answers: bugreportstatus gives the waiting count",
            ctx.arrangeError == null,
            ctx.arrangeError ?? JSON.stringify({ waiting: ctx.base })
        );
        if (ctx.arrangeError != null) return steps;
        const host = await h.ev(`!!window.__TAURI_INTERNALS__`);
        await h.goto("cockpit");

        // 1. the footer's bug button opens the box above the footer, with the capture, an empty focused text box and
        //    Gửi disabled (the B-footer board)
        const pressedBefore = await h.ev(`${BUTTON}?.getAttribute('aria-pressed') ?? null`);
        const clicked = await h.ev(`(() => { const b = ${BUTTON}; if (!b) return false; b.click(); return true; })()`);
        const shown1 = clicked && (await boxShown(h));
        await nap(500); // the picture's object URL loads a frame after the box draws
        let f = await h.ev(FACTS);
        await h.shot("cdp-shots/bug-report-box-1-open.png");
        const above =
            f.box != null &&
            f.button != null &&
            f.box.bottom <= f.button.top &&
            f.box.left >= 0 &&
            f.box.right <= f.win.width &&
            f.box.width >= 300;
        rec(
            "1. the footer's bug button opens the box above the footer: the thumbnail is the capture (an img with a Tauri host, none under the browser shim), the text box is focused and empty, Gửi is disabled and the count reads the waiting number",
            shown1 &&
                above &&
                f.thumb === (host ? "img" : "none") &&
                (host ? f.imgLoaded : f.placeholder === "Không có ảnh") &&
                f.textFocused &&
                f.textValue === "" &&
                f.sendDisabled === true &&
                f.waitingAttr === String(ctx.base) &&
                f.waitingText === (ctx.base > 0 ? `${ctx.base} đang chờ Jarvis` : "") &&
                pressedBefore === "false" &&
                f.buttonPressed === "true" &&
                (f.buttonTitle ?? "").startsWith("Báo lỗi arcterm"),
            JSON.stringify({ host, clicked, f })
        );
        if (!shown1) {
            await reset(h);
            return steps;
        }

        // 2. Esc closes it and keeps nothing
        await h.ev(ESC);
        const gone2 = await boxGone(h);
        const after2 = await waitingNow(h);
        rec(
            "2. Esc closes the box and the waiting count is unchanged",
            gone2 && after2 === ctx.base,
            JSON.stringify({ gone2, base: ctx.base, after2 })
        );

        // 3. Ctrl+Alt+R opens it again, Huỷ closes it
        await h.ev(CTRL_ALT_R);
        const shown3 = await boxShown(h);
        const f3 = await h.ev(FACTS);
        const cancelled = await h.ev(`(() => { const b = ${BOX}?.querySelector('[data-bug-report-cancel]'); if (!b) return false; b.click(); return true; })()`);
        const gone3 = await boxGone(h);
        const after3 = await waitingNow(h);
        rec(
            "3. Ctrl+Alt+R opens the box again, Huỷ closes it, and the waiting count is unchanged",
            shown3 && f3.textFocused && cancelled && gone3 && after3 === ctx.base,
            JSON.stringify({ shown3, textFocused: f3.textFocused, cancelled, gone3, base: ctx.base, after3 })
        );

        // 4. a capture that fails: the box still opens, with "Không có ảnh"
        await h.ev(`window.__bugReportCaptureFake = () => Promise.reject(new Error('no capture here')); true`);
        await h.ev(`${BUTTON}?.click()`);
        const shown4 = await boxShown(h);
        await nap(300);
        const f4 = await h.ev(FACTS);
        await h.shot("cdp-shots/bug-report-box-4-no-picture.png");
        rec(
            "4. a capture that fails opens the box with no picture: the thumbnail is none and reads Không có ảnh",
            shown4 && f4.thumb === "none" && f4.placeholder === "Không có ảnh" && f4.textFocused,
            JSON.stringify({ shown4, f4 })
        );
        await reset(h);

        // 5. a save that fails: the box stays open and says why, the count is unchanged
        const KNOWN = "the store said no (verify)";
        await h.ev(`window.__bugReportSaveFake = () => Promise.reject(new Error(${JSON.stringify(KNOWN)})); true`);
        await h.ev(`${BUTTON}?.click()`);
        const shown5 = await boxShown(h);
        await h.ev(setText(`${TAG} a save that fails`));
        await nap(150);
        const sendable5 = (await h.ev(FACTS)).sendDisabled === false;
        await h.ev(CTRL_ENTER);
        const errored = await waitFor(h, `${BOX}?.querySelector('[data-bug-report-error]') != null`, 5000);
        await nap(300);
        const f5 = await h.ev(FACTS);
        const after5 = await waitingNow(h);
        await h.shot("cdp-shots/bug-report-box-5-save-failed.png");
        rec(
            "5. a save that fails keeps the box open with the error under the text box, the typed text still there, and the waiting count unchanged",
            shown5 &&
                sendable5 &&
                errored &&
                f5.open &&
                (f5.error ?? "").includes(KNOWN) &&
                f5.textValue === `${TAG} a save that fails` &&
                f5.sendDisabled === false &&
                after5 === ctx.base,
            JSON.stringify({ shown5, sendable5, errored, f5, base: ctx.base, after5 })
        );
        await reset(h);

        // 6. a real save: the box closes, the toast names the new count, the store holds one more, and the box says so
        //    when it opens again
        await h.ev(`${BUTTON}?.click()`);
        const shown6 = await boxShown(h);
        const typed = `${TAG} the box saves a real report`;
        await h.ev(setText(typed));
        await nap(150);
        await h.ev(CTRL_ENTER);
        const closed6 = await boxGone(h);
        const now = await waitingNow(h);
        const toast = `Đã gửi báo lỗi · ${ctx.base + 1} đang chờ Jarvis`;
        const toasted = await waitFor(h, `document.body.innerText.includes(${JSON.stringify(toast)})`, 5000);
        const mine = (await listWaiting(h)).filter((r) => (r.text ?? "").startsWith(TAG));
        for (const r of mine) if (r.dir) ctx.dirs.push(r.dir);
        const saved = mine.find((r) => r.text === typed);
        await h.ev(`${BUTTON}?.click()`);
        const shownAgain = await boxShown(h);
        await nap(500);
        const f6 = await h.ev(FACTS);
        await h.shot("cdp-shots/bug-report-box-6-sent.png");
        rec(
            "6. Ctrl+Enter on a typed text saves it: the box closes, the toast reads Đã gửi báo lỗi · N đang chờ Jarvis with N the new count, the store's waiting count rose by 1 and the reopened box shows it",
            shown6 &&
                closed6 &&
                toasted &&
                now === ctx.base + 1 &&
                saved != null &&
                saved.state === "waiting" &&
                shownAgain &&
                f6.waitingAttr === String(ctx.base + 1) &&
                f6.waitingText === `${ctx.base + 1} đang chờ Jarvis`,
            JSON.stringify({
                shown6,
                closed6,
                toast,
                toasted,
                base: ctx.base,
                now,
                saved: saved && { id: saved.id, state: saved.state, surface: saved.surface, hasscreen: saved.hasscreen },
                shownAgain,
                waitingAttr: f6.waitingAttr,
                waitingText: f6.waitingText,
            })
        );
        await reset(h);

        // 7. Khoanh vùng: a picture the page draws itself (so the region's scale is known), the button under the thumb,
        //    the picture over the window, a drag, Enter, the region in the thumb, and a save that keeps it in report.json
        await h.ev(`window.__bugReportCaptureFake = () => new Promise((resolve) => {
            const c = document.createElement('canvas');
            c.width = innerWidth * devicePixelRatio;
            c.height = innerHeight * devicePixelRatio;
            const g = c.getContext('2d');
            g.fillStyle = '#2a2a2a';
            g.fillRect(0, 0, c.width, c.height);
            c.toBlob(resolve, 'image/png');
        }); true`);
        await h.ev(`${BUTTON}?.click()`);
        const shown7 = await boxShown(h);
        const startShown = await waitFor(h, `${BOX}?.querySelector('[data-bug-report-region-start]') != null`, 5000);
        await h.shot("cdp-shots/bug-report-box-7-region-button.png");
        await h.ev(`${BOX}?.querySelector('[data-bug-report-region-start]')?.click()`);
        const picker = await waitFor(h, `document.querySelector('[data-bug-report-picker]') != null`, 3000);
        const boxHidden = await h.ev(`!(${BOX}?.checkVisibility() ?? false)`);
        const mouse = (type, x, y, buttons) =>
            h.cdp("Input.dispatchMouseEvent", { type, x, y, button: "left", buttons, clickCount: type === "mouseMoved" ? 0 : 1 });
        await mouse("mouseMoved", 300, 200, 0);
        await mouse("mousePressed", 300, 200, 1);
        await mouse("mouseMoved", 450, 240, 1);
        await mouse("mouseMoved", 600, 280, 1);
        await mouse("mouseReleased", 600, 280, 0);
        await nap(200);
        const rectAttr = await h.ev(`document.querySelector('[data-bug-report-picker-rect]')?.getAttribute('data-bug-report-picker-rect') ?? null`);
        await h.shot("cdp-shots/bug-report-box-7-region-drag.png");
        await h.ev(keydown("Enter", "Enter"));
        const back = await waitFor(h, `document.querySelector('[data-bug-report-picker]') == null && (${BOX}?.checkVisibility() ?? false)`, 3000);
        const dpr = await h.ev(`devicePixelRatio`);
        const thumbRegion = await h.ev(`${BOX}?.querySelector('[data-bug-report-region]')?.getAttribute('data-bug-report-region') ?? null`);
        const marked = await h.ev(`!!${BOX}?.querySelector('[data-bug-report-region-again]') && !!${BOX}?.querySelector('[data-bug-report-region-clear]')`);
        await h.shot("cdp-shots/bug-report-box-7-region-marked.png");
        const typed7 = `${TAG} a framed region`;
        await h.ev(setText(typed7));
        await nap(150);
        await h.ev(CTRL_ENTER);
        const closed7 = await boxGone(h);
        const mine7 = (await listWaiting(h)).filter((r) => (r.text ?? "").startsWith(TAG));
        for (const r of mine7) if (r.dir) ctx.dirs.push(r.dir);
        const saved7 = mine7.find((r) => r.text === typed7);
        const wantW = Math.round(300 * dpr);
        const wantH = Math.round(80 * dpr);
        rec(
            "7. Khoanh vùng: the button under the thumb lays the picture over the window with the box hidden, a drag frames 300 × 80, Enter brings the box back with the region in the thumb and Khoanh lại / Bỏ vùng, and the saved report keeps the region in the picture's pixels with its screen.png",
            shown7 &&
                startShown &&
                picker &&
                boxHidden &&
                rectAttr === "300x80" &&
                back &&
                thumbRegion === `${wantW}x${wantH}` &&
                marked &&
                closed7 &&
                saved7 != null &&
                saved7.hasscreen === true &&
                saved7.region != null &&
                saved7.region.w === wantW &&
                saved7.region.h === wantH,
            JSON.stringify({
                shown7,
                startShown,
                picker,
                boxHidden,
                rectAttr,
                back,
                dpr,
                thumbRegion,
                marked,
                closed7,
                saved: saved7 && { id: saved7.id, hasscreen: saved7.hasscreen, region: saved7.region },
            })
        );
        return steps;
    },
    async teardown(h, ctx) {
        const failures = [];
        const attempt = async (what, fn) => {
            try {
                await fn();
            } catch (e) {
                failures.push(`${what}: ${String(e?.message ?? e)}`);
            }
        };
        await attempt("close the box and remove the fakes", () => reset(h));
        // the folders of the reports this run made, and any an interrupted run of it left: by their text, under a
        // `reports` folder, and never anything else
        await attempt("delete the reports it created", async () => {
            const dirs = new Set(ctx.dirs ?? []);
            for (const r of await listWaiting(h)) {
                if ((r.text ?? "").startsWith(TAG) && r.dir) dirs.add(r.dir);
            }
            for (const dir of dirs) {
                if (basename(dirname(dir)) !== "reports") {
                    throw new Error(`not deleting ${dir}: it is not a folder under reports/`);
                }
                rmSync(dir, { recursive: true, force: true });
            }
        });
        if (failures.length > 0) throw new Error(failures.join("; "));
    },
});

export default function (kit) {
    return [bugReportBoxScenario(kit)];
}
