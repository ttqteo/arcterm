// code-review-send and code-review-handoff: review comments on the Code surface sent to an agent as one message, the review
// list, persisted reviews and honest handoffs (docs/superpowers/plans/2026-11-12-kael-sync-code-diff-usage-setup.md, Task 6;
// the fork's f8f185178 and 3016f8235 and their `code-review` / `code-handoff` scenarios).
// kit is scenarios.mjs's KAEL_KITS ({ rt, code, files, jarvis }).
//
// The fork started a comment with Alt+M, which Task 16 binds (`kael-keys` presses it); here a comment starts from the editor's
// context menu ("Add review comment", codeviewer.tsx), on a range dragged with the mouse or on the caret's line after a
// right click. Monaco takes no text a CDP session types, so the note is set on the comment input the way the finder's scenarios
// set theirs, and Enter is dispatched on it.
//
// The agent is a fixture roster entry (public/cockpit-fixtures/active.json, as the line-review scenarios write theirs) on the
// fixture project with a block id no terminal holds: in the send scenario the DEV sink (window.__lineReviewSink, the one the
// Diff's line review reads) receives the message in place of a terminal; in the handoff scenario nothing does, so the send
// goes toward a block that is not a real terminal and fails the way one to a closed agent does (the step asserts the failure
// line and its reason, not the reason's wording).

import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { SURFACE_LABEL } from "./attach.mjs";

const VIEWPORT = { width: 1600, height: 950, deviceScaleFactor: 1, mobile: false };
const FILE = "review.ts";
const AGENT_NAME = "review-fixer";
const MENU_LABEL = "Add review comment";
// a drag that fell short is made again this many times in all (see dragLines)
const DRAG_TRIES = 3;
const line = (n) => `const value_${n} = ${n};`;
const SOURCE = Array.from({ length: 12 }, (_, i) => line(i + 1)).join("\n") + "\n";

const INPUT = `document.querySelector('[data-code-comment-input]')`;
// parenthesised: it is spliced into && and === expressions, where a bare `??` would mix with them
const COUNT = `(document.querySelector("[data-code-review-count]")?.getAttribute("data-code-review-count") ?? null)`;
const MARKERS = `document.querySelectorAll(".monaco-editor .code-comment-marker").length`;
const CARET_LINE = `(() => { const el = document.querySelector(".monaco-editor .active-line-number"); return el ? Number(el.textContent.trim()) : null; })()`;
const ROWS = `[...document.querySelectorAll("[data-code-review-row]")].map((r) => r.getAttribute("data-code-review-row"))`;

// the source lines Monaco draws a selection on (its selected-text boxes sit in the line's overlay row, at the line's top)
const SELECTED_LINES = `(() => {
    const tops = new Set([...document.querySelectorAll('.monaco-editor .view-overlays > div')].filter((r) => r.querySelector('.selected-text')).map((r) => r.style.top));
    return [...document.querySelectorAll('.monaco-editor .view-lines .view-line')].filter((l) => tops.has(l.style.top)).map((l) => l.textContent.replace(/\\u00a0/g, ' ').trim());
})()`;

// Monaco draws its context menu inside a shadow root, so an item is looked for there as well
const menuItem = (label) => `(() => {
    const roots = [document, ...[...document.querySelectorAll('.shadow-root-host')].map((h) => h.shadowRoot).filter(Boolean)];
    return roots.flatMap((r) => [...r.querySelectorAll('.monaco-menu .action-item')]).find((i) => i.textContent.includes(${JSON.stringify(label)})) ?? null;
})()`;

export default function (kits) {
    const { rt, code } = kits;
    const { TREE_RAIL_FIXTURE, ahReload } = rt;
    const { git, chooseProjectNamed, waitForProjectInConfig, polishWaitFor, polishNap } = code;

    // where a rendered source line is, or null while it is not drawn
    const linePoint = (h, n) =>
        h.ev(`(() => {
            const el = [...document.querySelectorAll(".monaco-editor .view-line")].find((l) => l.textContent.replace(/\\u00a0/g, " ").trim() === ${JSON.stringify(line(n))});
            const b = el?.getBoundingClientRect();
            return b ? { left: b.left, y: b.top + b.height / 2 } : null;
        })()`);

    const mouse = async (h, x, y, button) => {
        for (const type of ["mousePressed", "mouseReleased"]) {
            await h.cdp("Input.dispatchMouseEvent", { type, x, y, button, clickCount: 1 });
        }
    };

    // Drags from the start of one line to the start of another, which selects the lines between; a selection that ends at
    // column 1 of the later line covers only the lines above it (selectionLines). The result is the number of the try that
    // took, or 0 when none did.
    //
    // A drag is not atomic: Monaco stops following it at the first pointer event that is not the scripted one (a pointermove
    // whose buttons differ from the press's, or a click in the editor), and the selection stays where the last scripted move
    // left it, or is cleared. This window shares the desktop with whoever is using the machine, and a page short of CPU holds
    // the gesture open for seconds: the page's own pointer log of a 20x CPU-throttled run held pointer events nobody scripted
    // between the last scripted move and the release, and one such pointermove sent into an otherwise idle page ends the
    // drag at once. The comment then lands on the line right-clicked instead of the range ("Comment on line 3", one gutter
    // bar and a message without the range), the failure a Final run showed in three steps. The context menu is not at fault:
    // the selection was already wrong before it opened. So the drag is checked, as a person looks at what they selected, and
    // made again when it fell short.
    const dragLines = async (h, from, to) => {
        for (let tries = 1; tries <= DRAG_TRIES; tries++) {
            const a = await linePoint(h, from);
            const b = await linePoint(h, to);
            if (a == null || b == null) return 0;
            const at = (type, p, y, buttons) =>
                h.cdp("Input.dispatchMouseEvent", { type, x: p.left + 1, y, button: "left", buttons, clickCount: 1 });
            await at("mousePressed", a, a.y, 1);
            await at("mouseMoved", a, (a.y + b.y) / 2, 1);
            await at("mouseMoved", b, b.y, 1);
            await at("mouseReleased", b, b.y, 0);
            await polishNap(250);
            // the caret sits where the drag ended
            if ((await h.ev(CARET_LINE)) === to) return tries;
        }
        return 0;
    };

    // Monaco moves the caret to a right-clicked spot outside its selection and keeps a selection the click lands inside
    const rightClickLine = async (h, n) => {
        const p = await linePoint(h, n);
        if (p == null) return false;
        await mouse(h, p.left + 60, p.y, "right");
        return true;
    };

    // monaco's menu runs an item on a mouseup over the item it has focused on hover, and attaches that listener 100 ms after it
    // draws, so the pointer settles onto the item before it presses
    const clickMenuItem = async (h, label) => {
        const shown = await polishWaitFor(h, `!!${menuItem(label)}`, 4000);
        if (!shown) return false;
        await polishNap(500);
        const pt = await h.ev(`(() => { const b = ${menuItem(label)}?.getBoundingClientRect(); return b ? { x: b.left + b.width / 2, y: b.top + b.height / 2 } : null; })()`);
        if (pt == null) return false;
        await h.cdp("Input.dispatchMouseEvent", { type: "mouseMoved", x: pt.x, y: pt.y, button: "none" });
        const focused = await polishWaitFor(h, `!!${menuItem(label)}?.classList.contains('focused')`, 1000);
        if (!focused) await polishNap(200);
        await mouse(h, pt.x, pt.y, "left");
        return true;
    };

    // types into the open comment input and presses a key on it, with the input focused as typing leaves it
    const answer = async (h, note, key) => {
        const ok = await h.ev(`(() => {
            const input = ${INPUT};
            if (!input) return false;
            input.focus();
            Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value").set.call(input, ${JSON.stringify(note)});
            input.dispatchEvent(new Event("input", { bubbles: true }));
            return true;
        })()`);
        await polishNap(100);
        await h.ev(`${INPUT}?.dispatchEvent(new KeyboardEvent("keydown", { key: ${JSON.stringify(key)}, code: ${JSON.stringify(key)}, bubbles: true, cancelable: true }))`);
        await polishNap(200);
        return ok === true;
    };

    // a comment on lines from..to through the context menu, then its note; from === to is the caret's line
    const addComment = async (h, from, to, note) => {
        const out = { from, to };
        if (to > from) {
            out.dragTries = await dragLines(h, from, to + 1);
            out.selected = out.dragTries > 0;
            // what the editor draws as selected, before and after the right click: a failure names where the range was lost
            out.afterDrag = await h.ev(SELECTED_LINES);
        }
        const openMenu = async () => {
            const clicked = await rightClickLine(h, from + (to > from ? 1 : 0));
            if (clicked && to > from) out.afterRight = await h.ev(SELECTED_LINES);
            return clicked && (await clickMenuItem(h, MENU_LABEL));
        };
        out.menu = await openMenu();
        out.shown = out.menu && (await polishWaitFor(h, `!!${INPUT}`, 4000));
        if (out.menu && !out.shown) {
            // the one retry goes through the menu again, as the first press may have closed it
            out.retried = true;
            out.menu = await openMenu();
            out.shown = out.menu && (await polishWaitFor(h, `!!${INPUT}`, 4000));
        }
        out.label = await h.ev(`${INPUT}?.getAttribute("aria-label") ?? null`);
        out.typed = out.shown === true && (await answer(h, note, "Enter"));
        out.saved = out.typed && (await polishWaitFor(h, `!${INPUT}`, 3000));
        return out;
    };

    // the folder is gitignored and absent from a fresh checkout
    const writeRoster = (name) => {
        mkdirSync(new URL("./", TREE_RAIL_FIXTURE), { recursive: true });
        writeFileSync(
            TREE_RAIL_FIXTURE,
            JSON.stringify(
                [
                    {
                        id: "fx-cr-agent",
                        name: AGENT_NAME,
                        project: name,
                        task: "fix the review comments",
                        state: "working",
                        agent: "claude",
                        model: "opus",
                        blockId: "fx-blk-cr-agent",
                        activeMs: 20_000,
                        previousInfo: [{ kind: "message", text: "Reading the review." }],
                    },
                ],
                null,
                2
            )
        );
    };

    // a temp repo holding review.ts, registered as a project, with the fixture agent on it
    const arrange = (name) => async (h) => {
        const ctx = { name };
        try {
            ctx.dir = mkdtempSync(join(tmpdir(), `${name}-`));
            git(ctx.dir, "init", "-q", "--initial-branch=main");
            writeFileSync(join(ctx.dir, FILE), SOURCE);
            git(ctx.dir, "add", ".");
            git(ctx.dir, "commit", "-q", "-m", "seed the review fixture");
            await h.rpc("createproject", { name, path: ctx.dir });
            ctx.madeProject = true;
            await waitForProjectInConfig(h, name);
            ctx.prevRoster = existsSync(TREE_RAIL_FIXTURE) ? readFileSync(TREE_RAIL_FIXTURE) : null;
            writeRoster(name);
            ctx.wroteRoster = true;
            await h.ev(`(delete window.__lineReviewSink, delete window.__crSent, true)`);
            await h.reload();
        } catch (e) {
            ctx.arrangeError = String(e?.message ?? e);
        }
        return ctx;
    };

    const teardown = (what) => async (h, ctx) => {
        const step = async (label, fn) => {
            try {
                await fn();
            } catch (e) {
                console.error(`${what} teardown: ${label} failed: ${e?.message ?? e}`);
            }
        };
        await step("clear the DEV hooks", () => h.ev(`(delete window.__lineReviewSink, delete window.__crSent, true)`));
        await step("clear the viewport", () => h.cdp("Emulation.clearDeviceMetricsOverride"));
        await step("leave Code", () => h.goto("cockpit"));
        if (ctx?.wroteRoster) {
            await step("put the roster fixture back", () => {
                if (ctx.prevRoster != null) writeFileSync(TREE_RAIL_FIXTURE, ctx.prevRoster);
                else rmSync(TREE_RAIL_FIXTURE, { force: true });
            });
            await step("reload onto the restored roster", () => ahReload(h));
        }
        if (ctx?.madeProject) await step("delete the project", () => h.rpc("deleteproject", { name: ctx.name }));
        if (ctx?.dir) await step(`remove ${ctx.dir}`, () => rmSync(ctx.dir, { recursive: true, force: true, maxRetries: 20, retryDelay: 500 }));
    };

    // Code, on the fixture project, with review.ts open in the editor
    const openFixtureFile = async (h, ctx, rec) => {
        await h.cdp("Emulation.setDeviceMetricsOverride", VIEWPORT);
        await h.goto("code");
        rec("Code surface is active", (await h.activeSurfaceLabel()) === SURFACE_LABEL.code, `active=${await h.activeSurfaceLabel()}`);
        const onProject = () => h.ev(`(document.querySelector('[data-code-project-picker]')?.textContent ?? '').includes(${JSON.stringify(ctx.name)})`);
        if ((await onProject()) !== true) {
            await h.ev(`document.querySelector('[data-code-project-picker]')?.click()`);
            await polishNap(300);
            await chooseProjectNamed(h, ctx.name);
            await polishWaitFor(h, `(document.querySelector('[data-code-project-picker]')?.textContent ?? '').includes(${JSON.stringify(ctx.name)})`, 8000);
        }
        rec("select the fixture project", await onProject(), `chip names ${ctx.name}`);
        await h.ev(`document.querySelector('[data-code-column-tab="files"]')?.click()`);
        const opened = await polishWaitFor(
            h,
            `(() => {
                const r = [...document.querySelectorAll('[data-code-tree] [role="treeitem"]')].find((x) => x.textContent.trim() === ${JSON.stringify(FILE)});
                if (!r) return false;
                r.click();
                return true;
            })()`,
            10000
        );
        const editor = opened && (await polishWaitFor(h, `!!document.querySelector(".monaco-editor .view-line")`, 10000));
        rec(`open ${FILE} in the editor`, editor === true, `opened=${opened} editor=${editor}`);
        return editor === true;
    };

    const sendScenario = {
        name: "code-review-send",
        surface: "code",
        arrange: arrange("verify-code-review-send"),
        async assert(h, ctx) {
            if (ctx.arrangeError) return [{ step: "arrange the temp repo", ok: false, detail: ctx.arrangeError }];
            const steps = [];
            const rec = (step, ok, detail) => steps.push({ step, ok: ok === true, detail });
            if (!(await openFixtureFile(h, ctx, rec))) return steps;

            const note = "Why two constants? Inline them.";
            const added = await addComment(h, 2, 3, note);
            rec(
                "a range dragged over lines 2 to 4 and Add review comment opens the input on lines 2-3 (a selection ending at column 1 stops above it)",
                added.selected === true && added.menu === true && added.shown === true && added.label === "Comment on line 2-3",
                JSON.stringify(added)
            );
            rec("Enter saves the note", added.saved === true, JSON.stringify(added));

            const marked = await polishWaitFor(h, `${MARKERS} === 2 && ${COUNT} === "1"`, 4000);
            await h.shot("cdp-shots/code-review-send-marker.png");
            rec(
                "the comment shows as a gutter bar on each of lines 2 and 3, and the bar counts 1 comment",
                marked === true,
                `markers=${await h.ev(MARKERS)} count=${await h.ev(COUNT)}`
            );

            await h.ev(`document.querySelector("[data-code-review-send]")?.click()`);
            const row = `document.querySelector('[data-code-agent-picker-row=${JSON.stringify(AGENT_NAME)}]')`;
            const listed = await polishWaitFor(h, `!!${row}`, 6000);
            await polishNap(400);
            await h.shot("cdp-shots/code-review-send-picker.png");
            rec("Send review lists the fixture agent running in this project", listed === true, `listed=${listed}`);

            await h.ev(`(() => { window.__crSent = []; window.__lineReviewSink = (t) => { window.__crSent.push(t); }; return true; })()`);
            await h.ev(`${row}?.click()`);
            const sent = await polishWaitFor(h, `(window.__crSent ?? []).length === 1`, 6000);
            const text = (await h.ev(`(window.__crSent ?? [])[0] ?? ""`)) ?? "";
            const wants = [FILE, `${FILE}:L2-L3`, `> ${line(2)}`, note];
            const missing = wants.filter((w) => !text.includes(w));
            rec(
                "picking the agent sends one message holding the file, the lines, the quoted line and the comment",
                sent === true && missing.length === 0,
                JSON.stringify({ sent, missing, text })
            );

            const cleared = await polishWaitFor(h, `${COUNT} === null && ${MARKERS} === 0`, 4000);
            await h.shot("cdp-shots/code-review-send-sent.png");
            rec("what was sent leaves the review: no count, no gutter bar", cleared === true, `count=${await h.ev(COUNT)} markers=${await h.ev(MARKERS)}`);
            return steps;
        },
        teardown: teardown("code-review-send"),
    };

    const handoffScenario = {
        name: "code-review-handoff",
        surface: "code",
        arrange: arrange("verify-code-review-handoff"),
        async assert(h, ctx) {
            if (ctx.arrangeError) return [{ step: "arrange the temp repo", ok: false, detail: ctx.arrangeError }];
            const steps = [];
            const rec = (step, ok, detail) => steps.push({ step, ok: ok === true, detail });
            if (!(await openFixtureFile(h, ctx, rec))) return steps;

            const first = await addComment(h, 2, 3, "two constants for one string");
            const second = await addComment(h, 8, 8, "name this value");
            rec(
                "two comments, one on lines 2-3 and one on line 8",
                first.saved === true && second.saved === true && first.label === "Comment on line 2-3" && second.label === "Comment on line 8",
                JSON.stringify({ first, second })
            );
            const marked = await polishWaitFor(h, `${COUNT} === "2" && ${MARKERS} === 3`, 4000);
            rec("the bar counts 2 and three lines carry a gutter bar", marked === true, `count=${await h.ev(COUNT)} markers=${await h.ev(MARKERS)}`);

            // leaving Code unmounts the surface; the reviews sit in a module atom
            await h.goto("cockpit");
            await polishNap(400);
            await h.goto("code");
            const back = await polishWaitFor(h, `${COUNT} === "2"`, 8000);
            await h.ev(`document.querySelector("[data-code-review-count]")?.click()`);
            const listed = await polishWaitFor(h, `${ROWS}.length === 2`, 4000);
            await polishNap(400);
            await h.shot("cdp-shots/code-review-list.png");
            const rows = await h.ev(ROWS);
            rec(
                "closing and reopening Code keeps the review: the count opens a list of path:lines rows, by line",
                back === true && listed === true && JSON.stringify(rows) === JSON.stringify([`${FILE}:L2-L3`, `${FILE}:L8`]),
                JSON.stringify({ back, listed, rows })
            );

            await h.ev(`document.querySelector('[data-code-review-row=${JSON.stringify(`${FILE}:L8`)}] button')?.click()`);
            const there = await polishWaitFor(h, `${CARET_LINE} === 8`, 6000);
            const closed = await polishWaitFor(h, `!document.querySelector("[data-code-review-list]")?.offsetParent`, 3000);
            rec("a row opens its line and closes the list", there === true && closed === true, `caret=${await h.ev(CARET_LINE)} listClosed=${closed}`);

            // a reload is a restart as far as module state goes: only what was persisted survives
            await ahReload(h);
            await h.cdp("Emulation.setDeviceMetricsOverride", VIEWPORT);
            await h.goto("code");
            const onProject = () => h.ev(`(document.querySelector('[data-code-project-picker]')?.textContent ?? '').includes(${JSON.stringify(ctx.name)})`);
            if ((await polishWaitFor(h, `(document.querySelector('[data-code-project-picker]')?.textContent ?? '').includes(${JSON.stringify(ctx.name)})`, 6000)) !== true) {
                await h.ev(`document.querySelector('[data-code-project-picker]')?.click()`);
                await polishNap(300);
                await chooseProjectNamed(h, ctx.name);
                await polishWaitFor(h, `(document.querySelector('[data-code-project-picker]')?.textContent ?? '').includes(${JSON.stringify(ctx.name)})`, 8000);
            }
            const persisted = await polishWaitFor(h, `${COUNT} === "2"`, 8000);
            rec("after a reload the review is still there (persisted under code.reviews)", persisted === true && (await onProject()) === true, `count=${await h.ev(COUNT)}`);

            await h.ev(`document.querySelector("[data-code-review-count]")?.click()`);
            await polishWaitFor(h, `${ROWS}.length === 2`, 4000);
            await h.ev(`document.querySelector('[data-code-review-row=${JSON.stringify(`${FILE}:L2-L3`)}] [aria-label="Delete comment"]')?.click()`);
            const deleted = await polishWaitFor(h, `${COUNT} === "1"`, 4000);
            rec("deleting a row from the list removes just that comment", deleted === true, `count=${await h.ev(COUNT)} rows=${JSON.stringify(await h.ev(ROWS))}`);
            await h.ev(`document.querySelector("[data-code-review-count]")?.click()`);
            await polishNap(300);

            // no DEV sink here: the fixture agent's block is not a real terminal, so the send fails the way one to a closed agent does
            await h.ev(`document.querySelector("[data-code-review-send]")?.click()`);
            const row = `document.querySelector('[data-code-agent-picker-row=${JSON.stringify(AGENT_NAME)}]')`;
            await polishWaitFor(h, `!!${row}`, 6000);
            await h.ev(`${row}?.click()`);
            const ERROR = `document.querySelector("[data-code-review-error]")?.textContent ?? ""`;
            const failed = await polishWaitFor(h, `/Could not send the review/.test(${ERROR})`, 6000);
            const errText = await h.ev(ERROR);
            await h.shot("cdp-shots/code-review-handoff-failed.png");
            rec(
                "sending to an agent that cannot take it says so with the reason, and keeps the comment",
                failed === true && /^Could not send the review: \S/.test(errText) && (await h.ev(COUNT)) === "1",
                JSON.stringify({ failed, errText, count: await h.ev(COUNT) })
            );

            // Clear asks before it discards
            await h.ev(`document.querySelector("[data-code-review-clear]")?.click()`);
            const CONFIRM = `[...document.querySelectorAll('[role="dialog"] button')].find((b) => (b.textContent || "").trim().startsWith("Clear"))`;
            const asked = await polishWaitFor(h, `!!${CONFIRM} && document.body.textContent.includes("Discard the 1 comment")`, 4000);
            const stillThere = (await h.ev(COUNT)) === "1";
            await h.shot("cdp-shots/code-review-handoff-clear.png");
            await h.ev(`${CONFIRM}?.click()`);
            const gone = await polishWaitFor(h, `${COUNT} === null && ${MARKERS} === 0`, 4000);
            rec("Clear asks first, then discards the review", asked === true && stillThere && gone === true, JSON.stringify({ asked, stillThere, gone }));
            return steps;
        },
        teardown: teardown("code-review-handoff"),
    };

    return [sendScenario, handoffScenario];
}
