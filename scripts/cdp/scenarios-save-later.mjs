// save-later: Save for later on Chat's right-click menu (docs/superpowers/specs/2026-11-27-ask-later-design.md Decisions 3 and
// 7, Builder's calls 6, 8 and 10; plan 2026-11-27-ask-later.md Task 6; board A-direct-when-linked). Text selected in a reply
// opens a menu of Reply, Copy, Save as idea, Save for later and Add note. For an agent linked to an initiative the item names
// it ("to <title>") and a click adds the passage there at once, as a later chunk whose first note holds the passage, the
// agent's `agent:<tab>` and the conversation's id; the toast reads "Saved for later in <title>" with Open and Move to…. Move to…
// opens the picker at the button pressed, leaving out the initiative the chunk is in, and moves the chunk with its note. For an
// agent linked to none the click opens the picker at the pointer: Recent first, then the other projects behind a count and
// "+ New initiative from this session", which makes an idea in the agent's project holding the later chunk.
//
// Two fixture Claude agents over real tabs (one linked to an initiative, one not), each with a fixture roster row (the page's dev
// mock roster) and a fixture transcript; four real initiatives with plan chunks (the picker leaves ideas out): two in the agents'
// project, two in another, so "Other projects" draws whatever else the app holds. No agent is launched. Teardown deletes every
// initiative of the two fixture projects, closes the sheet, puts the roster, the grid and the chat modes back and removes the
// transcripts. kit holds scenarios.mjs's helpers.

import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import * as AC from "./agent-page-fixtures.mjs";

const NAME_A = "later linked";
const NAME_B = "later free";
// the fixture transcripts' stems: the conversation ids the chunk's first note keeps
const SESSION_A = "save-later-linked";
const SESSION_B = "save-later-free";
const PROJECT = "verify-save-later";
const OTHER_PROJECT = "verify-save-later-other";
const TITLE = {
    first: "Save later fixture one",
    second: "Save later fixture two",
    other: "Save later fixture other",
    older: "Save later fixture older",
};
// each initiative's plan chunks: the picker only lists initiatives with a plan, and a saved item is never one of them
const plan = (key) => [`${key} plan one`, `${key} plan two`];

// the four passages the steps select: one sentence each, with no full stop inside, so each is its own title
const P1 = "Decide whether 9306 or 1050 takes audit logs";
const P2 = "Delete the backup branch once DEV is pushed";
const P3 = "Check where the parser branch stands";
const P4 = "Push DEV after the parser lands";
const REPLY_A = `Four things are waiting on you.\n\n${P1}, and talk it over with a colleague first.\n\n${P2}, then close the ticket.`;
const REPLY_B = `Two more are open.\n\n${P3}, and note it on the ticket.\n\n${P4}, so the logs land on one parser.`;
const ASK_A = "what is left before the release?";
const ASK_B = "and on the other branch?";

const FIVE = ["Reply", "Copy", "Save as idea", "Save for later", "Add note"];
const WAIT_MS = 15000;

// Whether the picker's rect sits where floating-ui's bottom-start, offset 6, flip and shift put it for a point. Vertically
// it is below the point (top 6px under it) or, when that overflows, above it (bottom 6px over it). Horizontally it is
// either of two alignments:
//   start  the left edge on the point, shifted in from the right edge to `vw - width - 8`
//   end    the right edge on the point: flip's cross axis picks it when the start alignment would run past the right edge
//          (a press at x 1206 in a 1455px viewport opens a 330px picker over 875..1205)
// Pure, so a node one-liner can call it (the module exports it).
export function placedAt(picker, at) {
    if (picker == null || at == null) return false;
    const { rect, vw } = picker;
    const left = Math.min(Math.max(at.x, 8), vw - rect.width - 8);
    const below = Math.abs(rect.top - (at.y + 6)) <= 6;
    const above = Math.abs(rect.bottom - (at.y - 6)) <= 6;
    const startAligned = Math.abs(rect.left - left) <= 6;
    const endAligned = Math.abs(rect.right - at.x) <= 6;
    return (startAligned || endAligned) && (below || above);
}

export default function (kit) {
    const { waveService, polishWaitFor, polishNap, ahReload, GRID_KEY, GRID_EMPTY } = kit;
    const { makeTab, closeTabs } = AC.tabFixtures({ waveService });

    const prose = (id, n) => `document.querySelectorAll('[data-agent-chat="${id}"] [data-chat-prose]')[${n}]`;
    const center = (expr) =>
        `(() => { const el = ${expr}; if (!el) return null; const r = el.getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 }; })()`;
    const menuOpen = `!!document.querySelector("[data-context-menu]")`;
    const laterItem = `document.querySelector("[data-context-menu] [data-save-later]")`;
    // a toast by a text in it; its buttons are its body's siblings (a toast with two actions keeps them in the body's column)
    const toastBody = (text) =>
        `([...document.querySelectorAll("[data-notification-toast]")].find((t) => (t.textContent || "").includes(${JSON.stringify(text)})) ?? null)`;
    const toastButton = (text, sel) => `(${toastBody(text)}?.parentElement?.querySelector(${JSON.stringify(sel)}) ?? null)`;
    const pickerSel = (title) => `[data-initiative-picker][aria-label=${JSON.stringify(title)}]`;
    // the picker's row of an initiative, as an expression
    const rowOf = (ref) => `document.querySelector(${JSON.stringify(`[data-initiative-picker] [data-picker-row="${ref}"]`)})`;
    const oref = (oid) => `effort:${oid}`;

    async function until(fn, ms = 8000) {
        const end = Date.now() + ms;
        while (Date.now() < end) {
            try {
                const v = await fn();
                if (v) return v;
            } catch {
                // the next poll tries again
            }
            await polishNap(200);
        }
        return null;
    }
    async function shot(h, name) {
        try {
            await h.shot(`cdp-shots/save-later-${name}.png`);
        } catch (e) {
            console.error(`save-later: the shot ${name} failed: ${e?.message ?? e}`);
        }
    }
    const key = (h, k) => h.cdp("Input.dispatchKeyEvent", k);
    async function escape(h) {
        for (const type of ["keyDown", "keyUp"]) await key(h, { type, key: "Escape", code: "Escape", windowsVirtualKeyCode: 27 });
    }
    // a real press and release (a click), and a right-click; the menu reads the selection from the press
    async function pressAt(h, at, button = "left") {
        if (at == null) return false;
        const x = Math.round(at.x);
        const y = Math.round(at.y);
        await h.cdp("Input.dispatchMouseEvent", { type: "mouseMoved", x, y });
        for (const type of ["mousePressed", "mouseReleased"]) {
            await h.cdp("Input.dispatchMouseEvent", { type, x, y, button, clickCount: 1 });
        }
        return true;
    }
    // presses the element `expr` names at its centre (scrolled into its list's view first); the point it pressed, or null
    // when there was no such element
    async function pressElement(h, expr) {
        await h.ev(`(() => { ${expr}?.scrollIntoView?.({ block: "nearest" }); return true; })()`);
        const at = await h.ev(center(expr));
        return (await pressAt(h, at)) ? { x: Math.round(at.x), y: Math.round(at.y) } : null;
    }
    // selects `phrase` inside the element `elExpr` names as a drag would; true when it was found
    const select = (h, elExpr, phrase) =>
        h.ev(`(() => {
            const el = ${elExpr};
            if (!el) return false;
            const sel = window.getSelection();
            sel.removeAllRanges();
            const range = document.createRange();
            const phrase = ${JSON.stringify(phrase)};
            const walk = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
            for (let n = walk.nextNode(); n; n = walk.nextNode()) {
                const i = n.data.indexOf(phrase);
                if (i >= 0) {
                    range.setStart(n, i);
                    range.setEnd(n, i + phrase.length);
                    sel.addRange(range);
                    return true;
                }
            }
            return false;
        })()`);
    // right-clicks the middle of the selection's first line and waits for the menu; the point it clicked
    async function openMenu(h) {
        const at = await h.ev(`(() => {
            const s = window.getSelection();
            const r = s.rangeCount ? s.getRangeAt(0).getClientRects()[0] : null;
            return r ? { x: r.left + Math.min(r.width / 2, 40), y: r.top + r.height / 2 } : null;
        })()`);
        if (at == null) return { at: null, up: false };
        await pressAt(h, at, "right");
        const up = await polishWaitFor(h, `!!${laterItem}`, 3000);
        return { at: { x: Math.round(at.x), y: Math.round(at.y) }, up };
    }
    // the menu's items in order, and what the Save for later row says beside its label (null: nothing)
    const readMenu = (h) =>
        h.ev(`(() => {
            const items = [...document.querySelectorAll("[data-context-menu] [data-menu-item]")].map((el) => el.getAttribute("data-menu-item"));
            const later = ${laterItem};
            return { items, later: later ? { sublabel: later.querySelector(".ml-auto")?.textContent ?? null } : null };
        })()`);
    const readToast = (h, text) =>
        h.ev(`(() => {
            const t = ${toastBody(text)};
            if (!t) return null;
            const box = t.parentElement;
            return {
                text: (t.textContent || "").replace(/\\s+/g, " ").trim(),
                open: box.querySelector("[data-notification-action]")?.textContent.trim() ?? null,
                move: box.querySelector("[data-notification-action-alt]")?.textContent.trim() ?? null,
            };
        })()`);
    const clearToasts = (h) =>
        AC.agentPage(
            h,
            `const S = await mod("app/cockpit/notificationstore.ts"); globalStore.set(S.toastsAtom, []); return true;`
        );
    const effortOf = async (h, oid) => (await h.rpc("effortget", { effortoid: oid }))?.effort ?? null;
    const chunkOf = (effort, label) => (effort?.chunks ?? []).find((c) => c.label === label) ?? null;
    // the first note of a saved item: where it was said (the conversation's id is kept, so no tab address), then the passage
    const wantBody = (name, text) => new RegExp(`^From agent "${name}", \\d{4}-\\d{2}-\\d{2}\\n\\n> ${text}$`);
    // the open picker: its place, its children in order (the Recent heading, each row by oref, the project's heading, the
    // actions), its filter's placeholder
    const readPicker = (h, title) =>
        h.ev(`(() => {
            const p = document.querySelector(${JSON.stringify(pickerSel(title))});
            const list = p?.querySelector('[role="listbox"]');
            if (!p || !list) return null;
            const r = p.getBoundingClientRect();
            const kids = [...list.children].map((el) =>
                el.hasAttribute("data-picker-recent") ? "recent"
                : el.hasAttribute("data-picker-row") ? "row:" + el.getAttribute("data-picker-row")
                : el.hasAttribute("data-picker-new") ? "new:" + el.textContent.trim()
                : el.hasAttribute("data-picker-others") ? "others:" + el.textContent.replace(/[▴▾]/g, "").trim()
                : el.getAttribute("aria-hidden") === "true" ? "sep"
                : "text:" + el.textContent.trim());
            return {
                rect: { left: r.left, top: r.top, right: r.right, bottom: r.bottom, width: r.width },
                vw: window.innerWidth,
                kids,
                placeholder: p.querySelector("input")?.getAttribute("placeholder") ?? null,
                count: document.querySelectorAll("[data-initiative-picker]").length,
            };
        })()`);
    async function deleteFixtures(h) {
        const efforts = (await h.rpc("effortlist", {}))?.efforts ?? [];
        for (const e of efforts.filter((x) => x.project === PROJECT || x.project === OTHER_PROJECT)) {
            await h.rpc("effortdelete", { effortoid: e.oref.replace(/^effort:/, "") }).catch(() => {});
        }
    }

    // the roster: the agent linked to the first initiative, and the one that is linked to none
    function roster(ctx) {
        const now = Date.now();
        const base = {
            project: PROJECT,
            state: "idle",
            idleSince: now - 3_600_000,
            task: "Save for later",
            agent: "claude",
            model: "opus",
            sleeping: { since: now - 3_600_000, freedBytes: 0 },
        };
        return [
            { ...base, id: ctx.tabs.a.tabId, name: NAME_A, blockId: ctx.tabs.a.blockId, transcriptPath: ctx.files.a, effortId: ctx.oid.first },
            { ...base, id: ctx.tabs.b.tabId, name: NAME_B, blockId: ctx.tabs.b.blockId, transcriptPath: ctx.files.b },
        ];
    }

    const scenario = {
        name: "save-later",
        surface: "agent",
        async arrange(h) {
            const ctx = {
                dir: mkdtempSync(join(tmpdir(), "verify-save-later-")),
                prevGrid: await h.ev(`localStorage.getItem(${JSON.stringify(GRID_KEY)})`),
                prevModes: await h.ev(`localStorage.getItem("agent.chatmode")`),
                oid: {},
            };
            let at = "clearing what an earlier run left";
            try {
                await deleteFixtures(h);
                at = "writing the transcripts";
                const base = Date.now() - 7_200_000;
                const o = (sec) => ({ cwd: ctx.dir, ts: new Date(base + sec * 1000).toISOString() });
                ctx.files = {
                    a: AC.writeTranscript(ctx.dir, SESSION_A, [AC.userText(ASK_A, o(0)), AC.assistantText(REPLY_A, o(2))]),
                    b: AC.writeTranscript(ctx.dir, SESSION_B, [AC.userText(ASK_B, o(0)), AC.assistantText(REPLY_B, o(2))]),
                };
                at = "making the initiatives";
                // oldest first, a beat apart: Recent orders by the last write, and the picker leaves out what has no plan
                for (const [key, project] of [
                    ["older", OTHER_PROJECT],
                    ["other", OTHER_PROJECT],
                    ["second", PROJECT],
                    ["first", PROJECT],
                ]) {
                    const made = await h.rpc("effortcreate", {
                        title: TITLE[key],
                        project,
                        chunks: plan(key).map((label) => ({ label })),
                    });
                    ctx.oid[key] = made.effortoid;
                    await polishNap(40);
                }
                at = "resetting the grid";
                await h.ev(`localStorage.setItem(${JSON.stringify(GRID_KEY)}, ${JSON.stringify(JSON.stringify(GRID_EMPTY))})`);
                await h.ev(`localStorage.removeItem("agent.chatmode")`);
                if (!(await ahReload(h))) throw new Error("the page did not come back after the reload");
                // the suggested replies' model call is answered with none: no haiku call runs
                await h.ev(`(() => { window.__chatSuggestFake = () => []; return true; })()`);
                await h.goto("agent");
                at = "making the tabs";
                ctx.tabs = { a: await makeTab(h, ctx, { label: NAME_A }), b: await makeTab(h, ctx, { label: NAME_B }) };
                at = "setting the roster";
                await AC.setRoster(h, roster(ctx));
            } catch (e) {
                ctx.arrangeError = `${at}: ${String(e?.message ?? e)}`;
            }
            return ctx;
        },

        async assert(h, ctx) {
            const steps = [];
            const rec = (step, ok, detail) => steps.push({ step, ok: ok === true, detail: typeof detail === "string" ? detail : JSON.stringify(detail) });
            if (ctx.arrangeError != null) {
                rec("0. the fixture agents, transcripts and initiatives", false, ctx.arrangeError);
                return steps;
            }
            const A = ctx.tabs.a.tabId;
            const B = ctx.tabs.b.tabId;
            const O = ctx.oid;
            const run = async (name, fn) => {
                try {
                    await fn(name);
                } catch (e) {
                    rec(name, false, `the step threw: ${String(e?.message ?? e)}`);
                }
            };
            // selects `phrase` in the agent's reply, right-clicks it, and reads the menu
            const menuOn = async (agent, phrase) => {
                await clearToasts(h);
                const sel = await select(h, prose(agent, 0), phrase);
                const opened = await openMenu(h);
                return { sel, ...opened, menu: opened.up ? await readMenu(h) : null };
            };
            // the later chunk `label` of the initiative, once the server has it
            const savedChunk = async (oid, label) => until(async () => chunkOf(await effortOf(h, oid), label));
            // the picker of `title`, once it has loaded its rows and its reveal is over
            const pickerUp = async (title) => {
                const up = await polishWaitFor(h, `!!document.querySelector(${JSON.stringify(pickerSel(title) + " [data-picker-row]")})`, 8000);
                await polishNap(500);
                return { up, picker: up ? await readPicker(h, title) : null };
            };
            try {
                await h.cdp("Emulation.setFocusEmulationEnabled", { enabled: true });
                await AC.focusAgent(h, A);
                const loaded = await polishWaitFor(h, `!!${prose(A, 0)}`, WAIT_MS);

                // 1. a linked agent: right-clicking a selection opens the five items in order, with "to <title>" on Save for later
                await run("1. the menu: Reply, Copy, Save as idea, Save for later, Add note, the Save for later row naming the agent's initiative", async (name) => {
                    const m = await menuOn(A, P1);
                    await polishNap(300);
                    await shot(h, "1-menu");
                    rec(
                        name,
                        loaded && m.sel && m.up && JSON.stringify(m.menu?.items) === JSON.stringify(FIVE) && m.menu?.later?.sublabel === `to ${TITLE.first}`,
                        { loaded, sel: m.sel, up: m.up, menu: m.menu }
                    );
                });

                // 2. Save for later adds a later chunk at once: its first note holds the passage, the tab and the conversation
                await run("2. Save for later adds a later chunk to the linked initiative: its first note holds the passage, `agent:<tab>` and the conversation id; the toast reads Saved for later in <title> with Open and Move to…", async (name) => {
                    const pressed = await pressElement(h, laterItem);
                    const toast = await polishWaitFor(h, `!!${toastBody(`Saved for later in ${TITLE.first}`)}`, 8000);
                    const chunk = await savedChunk(O.first, P1);
                    const effort = await effortOf(h, O.first);
                    const note = chunk?.notes?.[0];
                    const t = await readToast(h, `Saved for later in ${TITLE.first}`);
                    await polishNap(400);
                    await shot(h, "2-toast");
                    rec(
                        name,
                        pressed != null &&
                            toast &&
                            !(await h.ev(menuOpen)) &&
                            chunk?.later === true &&
                            chunk?.status === "pending" &&
                            effort?.chunks?.filter((c) => !c.later).length === 2 &&
                            note?.session === `agent:${A}` &&
                            note?.conversation === SESSION_A &&
                            note?.author === "you" &&
                            wantBody(NAME_A, P1).test(note?.text ?? "") &&
                            t?.text.includes(P1) &&
                            t?.open === "Open" &&
                            t?.move === "Move to…",
                        { pressed, toast, chunk, plan: effort?.chunks?.filter((c) => !c.later).map((c) => c.label), t }
                    );
                });

                // 3. Move to… opens the picker at the button, without the initiative the chunk is in; picking the second moves it
                await run("3. Move to… opens the picker at the button pressed (not listing the first initiative, no New row); picking the second initiative moves the chunk there with its note, and a toast names it", async (name) => {
                    const pressed = await pressElement(h, toastButton(`Saved for later in ${TITLE.first}`, "[data-notification-action-alt]"));
                    const { up, picker } = await pickerUp("Move to…");
                    await shot(h, "3-move-picker");
                    const rows = (picker?.kids ?? []).filter((k) => k.startsWith("row:"));
                    const picked = up ? await pressElement(h, rowOf(oref(O.second))) : null;
                    const toast = picked != null && (await polishWaitFor(h, `!!${toastBody(`Moved to ${TITLE.second}`)}`, 8000));
                    const moved = await savedChunk(O.second, P1);
                    const gone = await until(async () => chunkOf(await effortOf(h, O.first), P1) == null);
                    const note = moved?.notes?.[0];
                    const t = await readToast(h, `Moved to ${TITLE.second}`);
                    await polishNap(300);
                    await shot(h, "3-moved");
                    rec(
                        name,
                        pressed != null &&
                            up &&
                            picker?.count === 1 &&
                            placedAt(picker, pressed) &&
                            !rows.includes(`row:${oref(O.first)}`) &&
                            rows.includes(`row:${oref(O.second)}`) &&
                            !picker.kids.some((k) => k.startsWith("new:")) &&
                            picker.placeholder === "Move to…" &&
                            picked != null &&
                            toast &&
                            moved?.later === true &&
                            note?.session === `agent:${A}` &&
                            note?.conversation === SESSION_A &&
                            wantBody(NAME_A, P1).test(note?.text ?? "") &&
                            gone === true &&
                            t?.open === "Open",
                        { pressed, up, picker, picked, toast, moved, gone, t }
                    );
                });

                // 4. Open on a fresh save's toast lands on that initiative
                await run("4. Open on the toast of a fresh save lands on that initiative: the Brief's sheet shows the first initiative", async (name) => {
                    const m = await menuOn(A, P2);
                    const pressed = m.up ? await pressElement(h, laterItem) : null;
                    const toast = pressed != null && (await polishWaitFor(h, `!!${toastBody(`Saved for later in ${TITLE.first}`)}`, 8000));
                    const chunk = await savedChunk(O.first, P2);
                    const opened = toast ? await pressElement(h, toastButton(`Saved for later in ${TITLE.first}`, "[data-notification-action]")) : null;
                    const sheet = await polishWaitFor(
                        h,
                        `(document.querySelector('[data-jarvis-brief-sheet="effort"] [data-jarvis-initiative-sheet-title]')?.textContent ?? "").includes(${JSON.stringify(TITLE.first)})`,
                        10000
                    );
                    await polishNap(500);
                    await shot(h, "4-open");
                    rec(
                        name,
                        m.sel && m.up && pressed != null && toast && chunk?.later === true && opened != null && sheet,
                        { sel: m.sel, up: m.up, pressed, toast, chunk: chunk && { label: chunk.label, later: chunk.later }, opened, sheet }
                    );
                    // back to the Agent surface, the sheet closed, on the agent linked to no initiative
                    await AC.agentPage(
                        h,
                        `const J = await mod("app/view/jarvis/jarvisstore.ts"); globalStore.set(J.briefSheetOpenAtom, false); return true;`
                    );
                    await h.goto("agent");
                    await AC.focusAgent(h, B);
                    await polishWaitFor(h, `!!${prose(B, 0)}`, WAIT_MS);
                });

                // 5. an unlinked agent: the click opens the picker at the pointer, Recent first; a Recent row takes the chunk
                await run("5. an agent linked to none: Save for later names no initiative and opens the picker at the pointer, Recent first, then \"Other projects · N\" and \"+ New initiative from this session\"; picking a Recent row adds the chunk there", async (name) => {
                    const m = await menuOn(B, P3);
                    const pressed = m.up ? await pressElement(h, laterItem) : null;
                    const { up, picker } = pressed != null ? await pickerUp("Save for later in…") : { up: false, picker: null };
                    await shot(h, "5-picker");
                    const kids = picker?.kids ?? [];
                    const recentEnd = kids.findIndex((k, i) => i > 0 && !k.startsWith("row:"));
                    const recentRows = kids.slice(1, recentEnd < 0 ? kids.length : recentEnd);
                    const newAt = kids.findIndex((k) => k.startsWith("new:"));
                    const othersAt = kids.findIndex((k) => k.startsWith("others:"));
                    const others = Number(/Other projects · (\d+)/.exec(kids[othersAt] ?? "")?.[1] ?? 0);
                    // a fixture among the Recent rows, the second initiative first
                    const target = [O.second, O.first, O.other].find((oid) => recentRows.includes(`row:${oref(oid)}`));
                    const title = target != null ? TITLE[Object.keys(O).find((k) => O[k] === target)] : null;
                    const picked = target != null ? await pressElement(h, rowOf(oref(target))) : null;
                    const toast = title != null && (await polishWaitFor(h, `!!${toastBody(`Saved for later in ${title}`)}`, 8000));
                    const chunk = target != null ? await savedChunk(target, P3) : null;
                    const note = chunk?.notes?.[0];
                    rec(
                        name,
                        m.sel &&
                            m.up &&
                            JSON.stringify(m.menu?.items) === JSON.stringify(FIVE) &&
                            m.menu?.later != null &&
                            m.menu.later.sublabel == null &&
                            pressed != null &&
                            up &&
                            picker?.count === 1 &&
                            placedAt(picker, m.at) &&
                            picker.placeholder === "Save for later in…" &&
                            kids[0] === "recent" &&
                            recentRows.length >= 1 &&
                            recentRows.length <= 3 &&
                            newAt > recentEnd &&
                            kids[newAt] === "new:+ New initiative from this session" &&
                            othersAt > newAt &&
                            others >= 1 &&
                            target != null &&
                            picked != null &&
                            toast &&
                            chunk?.later === true &&
                            note?.session === `agent:${B}` &&
                            note?.conversation === SESSION_B &&
                            note?.author === "you" &&
                            wantBody(NAME_B, P3).test(note?.text ?? ""),
                        { sel: m.sel, up: m.up, at: m.at, menu: m.menu, pressed, picker, recentRows, others, target, picked, toast, chunk }
                    );
                });

                // 6. "+ New initiative from this session" makes an initiative in the agent's project holding the later chunk, in Ideas
                await run("6. \"+ New initiative from this session\" makes an initiative in the agent's project, named by the passage, holding the later chunk, and it stays in Ideas", async (name) => {
                    const m = await menuOn(B, P4);
                    const pressed = m.up ? await pressElement(h, laterItem) : null;
                    const { up, picker } = pressed != null ? await pickerUp("Save for later in…") : { up: false, picker: null };
                    const picked = up ? await pressElement(h, `document.querySelector("[data-initiative-picker] [data-picker-new]")`) : null;
                    const toast = picked != null && (await polishWaitFor(h, `!!${toastBody(`Saved for later in ${P4}`)}`, 8000));
                    const made = await until(async () => {
                        const e = ((await h.rpc("effortlist", {}))?.efforts ?? []).find((x) => x.title === P4 && x.project === PROJECT);
                        const full = e != null ? await effortOf(h, e.oref.replace(/^effort:/, "")) : null;
                        return full != null && chunkOf(full, P4) != null ? { oref: e.oref, full } : null;
                    });
                    const chunk = chunkOf(made?.full, P4);
                    const note = chunk?.notes?.[0];
                    // an initiative of later items only has no plan: the Brief's Ideas column keeps it
                    const idea = made != null
                        ? await AC.agentPage(
                              h,
                              `const { RpcApi } = await mod("app/store/wshclientapi.ts");
                              const { TabRpcClient } = await mod("app/store/wshrpcutil.ts");
                              const { buildEffortCards } = await mod("app/view/jarvis/effortmodel.ts");
                              const { isIdea } = await mod("app/view/jarvis/briefrows.ts");
                              const r = await RpcApi.EffortListCommand(TabRpcClient, {});
                              const card = buildEffortCards(r.efforts ?? []).find((c) => c.oref === ${JSON.stringify(made.oref)});
                              return card ? isIdea(card) : null;`
                          )
                        : null;
                    await polishNap(400);
                    await shot(h, "6-new");
                    rec(
                        name,
                        m.sel &&
                            m.up &&
                            pressed != null &&
                            up &&
                            picked != null &&
                            toast &&
                            made != null &&
                            made.full.chunks.length === 1 &&
                            chunk?.later === true &&
                            note?.session === `agent:${B}` &&
                            note?.conversation === SESSION_B &&
                            wantBody(NAME_B, P4).test(note?.text ?? "") &&
                            made.full.notes?.[0]?.session === `agent:${B}` &&
                            idea === true,
                        { sel: m.sel, up: m.up, pressed, picker: picker?.kids, picked, toast, made: made && { oref: made.oref, project: made.full.project, chunks: made.full.chunks.map((c) => ({ label: c.label, later: c.later })) }, idea }
                    );
                });
            } catch (e) {
                rec("the scenario threw", false, String(e?.stack ?? e));
            }
            return steps;
        },

        async teardown(h, ctx) {
            const step = async (what, fn) => {
                try {
                    await fn();
                } catch (e) {
                    console.error(`save-later teardown: ${what} failed: ${e?.message ?? e}`);
                }
            };
            // an Escape with nothing open would leave the Agent surface ("Esc back"), so only when something is
            await step("close a menu or picker left open", async () => {
                if (await h.ev(`!!document.querySelector("[data-context-menu], [data-initiative-picker]")`)) await escape(h);
            });
            await step("clear the toasts and the selection", () =>
                AC.agentPage(
                    h,
                    `const S = await mod("app/cockpit/notificationstore.ts");
                    globalStore.set(S.toastsAtom, []);
                    window.getSelection()?.removeAllRanges();
                    return true;`
                )
            );
            await step("close the sheet", () =>
                AC.agentPage(h, `const J = await mod("app/view/jarvis/jarvisstore.ts"); globalStore.set(J.briefSheetOpenAtom, false); return true;`)
            );
            // every initiative of the two fixture projects: the four made here and the one step 6 made
            await step("delete the initiatives", () => deleteFixtures(h));
            await step("remove the probe", () => h.ev(`(() => { delete window.__chatSuggestFake; return true; })()`));
            await step("restore the roster", () => AC.restoreRoster(h));
            await step("close the fixture tabs", () => closeTabs(h, ctx));
            await step("restore the grid and the chat modes", () =>
                h.ev(`(() => {
                    for (const [key, prev] of [[${JSON.stringify(GRID_KEY)}, ${JSON.stringify(ctx.prevGrid)}], ["agent.chatmode", ${JSON.stringify(ctx.prevModes)}]]) {
                        if (prev == null) localStorage.removeItem(key);
                        else localStorage.setItem(key, prev);
                    }
                    return true;
                })()`)
            );
            await step("reload onto the live roster", () => ahReload(h));
            if (ctx.dir) await step(`remove ${ctx.dir}`, () => rmSync(ctx.dir, { recursive: true, force: true, maxRetries: 20, retryDelay: 500 }));
            await step("go home", () => h.goto("cockpit"));
        },
    };

    return [scenario];
}
