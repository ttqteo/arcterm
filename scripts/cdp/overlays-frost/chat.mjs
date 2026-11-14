// overlays-frost-chat: Chat's and the council's popovers, frosted (docs/superpowers/plans/2026-11-14-overlays-chat-look.md,
// Task 4). One step per changed site: it opens the panel, runs frostVerdict on it (the frost class's blur over the panel
// colour, no backdrop root above it) and screenshots. The sites, by phase:
//   chat      the footer's model menu, its Effort and More models submenus (each a sibling of the menu's panel, picked with a
//             real click), the permission mode menu, the + menu, and the initiative card's chunk list
//   outline   the document Outline popover (the file tab of an agent's panel)
//   route     the route picker (Settings > Runs & limits), reusing route-picker-flat's catalog mock
//   harness   the harness picker (the Jarvis peek's consult destination)
//   review    the line review tray's Send menu (the Diff surface, two live agents), reusing the line-review fixtures
//   council   the seats popover, an idea's files list, the @ mention list, a message's More menu, the memory entry's Details
//             popover and Setup's Add expert menu, over the council fixtures
// Not changed, so not here: linereviewtray's strip, sticktobottom.tsx's and councilchat's scroll-to-end buttons, the cards,
// strips and docked panels that only carry shadow-popover* (the plan's Task 4 report lists them).
//
// A phase that cannot open its site records a failed step (never a skip). kit is scenarios.mjs's OF_KIT: the Chat redesign's
// kit plus scenario(name), the registered scenario of that name, whose arrange / teardown a phase runs for the fixtures
// that live in scenarios.mjs (route-picker-flat, line-review, council-discussion).

import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import * as AC from "../agent-page-fixtures.mjs";
import * as CF from "../council/fixtures.mjs";
import { frostProbe, frostVerdict } from "./frostcheck.mjs";

const NAME = "overlays frost chat";
const PROJECT = "arcterm";
const WAIT_MS = 15000;
const SHORT_MS = 6000;
const LS_KEYS_EXTRA = ["agent.chatmode", "chat.initiative.handled", "chat.initiative.cards", "chat.initiative.drafts", "chat.initiative.pending"];
// the screens a Claude Code footer draws (the same fixtures agent-chat writes into the terminal)
const SCREENS = JSON.parse(readFileSync(new URL("../../../frontend/app/view/agents/tuiscreen.fixtures.json", import.meta.url), "utf8"));

const q = (s) => JSON.stringify(s);
const layerOf = (id) => `document.querySelector('[data-agent-chat="${id}"]')`;
// the element that holds `inner` as a direct child: a popover's panel when the panel's own box is what the caller styled
const parentOf = (inner) => `*:has(> ${inner})`;
const menuOf = (label) => `[role="menu"][aria-label="${label}"]`;

const KEYS = {
    escape: { key: "Escape", code: "Escape", windowsVirtualKeyCode: 27 },
    enter: { key: "Enter", code: "Enter", windowsVirtualKeyCode: 13 },
};

// --- the fixtures -------------------------------------------------------------------------------------------------

const OID = "c1a00000-0000-4000-8000-000000000001";
const TITLE = "Sync client retries";
const CHUNKS = ["Add retries to the sync client", "Back off between attempts", "Log each retry attempt"];
const NOTE = "Backoff is capped at 30 seconds and jittered by 20%, so two clients never retry in step.";
const fence = (body) => "```arc-initiative\n" + body + "\n```";
const REPLY = ["Three follow-ups are yours to decide, so one is a card:", "", fence(JSON.stringify({ kind: "note", effort: OID, text: NOTE }))].join("\n");

const effortSummary = () => {
    const now = Date.now();
    return {
        oref: `effort:${OID}`,
        title: TITLE,
        project: PROJECT,
        status: "active",
        chunks: CHUNKS.map((label, i) => ({ label, status: i === 0 ? "done" : "pending" })),
        done: 1,
        total: CHUNKS.length,
        activechunk: CHUNKS[1],
        updatedts: now - 3_600_000,
    };
};
const effortDetail = () => {
    const now = Date.now();
    return {
        otype: "effort",
        oid: OID,
        version: 1,
        meta: {},
        title: TITLE,
        project: PROJECT,
        status: "active",
        chunks: CHUNKS.map((label, i) => ({ label, status: i === 0 ? "done" : "pending", updatedts: now - 3_600_000 })),
        notes: [],
        createdts: now - 86_400_000,
        updatedts: now - 3_600_000,
    };
};

// a markdown file with headings, for the Outline popover
const OUTLINE_MD = ["# Retry notes", "", "Intro.", "", "## Backoff", "", "Wait twice as long each time.", "", "## Jitter", "", "Add 20% noise.", "", "### Cap", "", "30 seconds."].join("\n");

export default function (kit) {
    const { waveService, polishWaitFor, polishNap, ahReload, GRID_KEY, GRID_EMPTY, scenario } = kit;
    const { makeTab, closeTabs } = AC.tabFixtures({ waveService });

    // --- page helpers -----------------------------------------------------------------------------------------------

    async function press(h, k) {
        for (const type of ["keyDown", "keyUp"]) await h.cdp("Input.dispatchKeyEvent", { type, ...k });
    }
    const centerOf = (h, selector) =>
        h.ev(`(() => {
            const r = document.querySelector(${q(selector)})?.getBoundingClientRect();
            return r && r.width > 0 && r.height > 0 ? { x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2) } : null;
        })()`);
    const moveTo = (h, x, y) => h.cdp("Input.dispatchMouseEvent", { type: "mouseMoved", x, y });
    // a real pointer click (pointerdown, then up), so a handler on pointerdown or mousedown sees it as a person's
    async function clickReal(h, selector) {
        const at = await centerOf(h, selector);
        if (at == null) return false;
        await moveTo(h, at.x, at.y);
        await h.cdp("Input.dispatchMouseEvent", { type: "mousePressed", x: at.x, y: at.y, button: "left", buttons: 1, clickCount: 1 });
        await h.cdp("Input.dispatchMouseEvent", { type: "mouseReleased", x: at.x, y: at.y, button: "left", buttons: 0, clickCount: 1 });
        return true;
    }
    const click = (h, selector) => h.ev(`(() => { const e = document.querySelector(${q(selector)}); if (!e || e.disabled) return false; e.click(); return true; })()`);
    const exists = (h, selector) => h.ev(`!!document.querySelector(${q(selector)})`);
    const until = (h, expr, ms = SHORT_MS) => polishWaitFor(h, expr, ms);
    const shot = async (h, name) => {
        try {
            await h.shot(`cdp-shots/overlays-frost-chat-${name}.png`);
        } catch (e) {
            console.error(`overlays-frost-chat: the shot ${name} failed: ${e?.message ?? e}`);
        }
    };
    // Probes `selector` once it is on screen, again while an ancestor is still fading (a PopoverReveal's own opacity makes its
    // motion.div a backdrop root until the fade ends), up to 2 s; answers the last probe's verdict.
    // A panel that is not on screen (zero size: a hidden surface, a closed menu) is a failure, whatever its classes say.
    async function probePanel(h, selector) {
        const shown = await until(
            h,
            `(() => { const el = document.querySelector(${q(selector)}); if (!el) return false; const r = el.getBoundingClientRect(); return r.width > 0 && r.height > 0 && getComputedStyle(el).opacity === "1"; })()`
        );
        let r = null;
        for (let i = 0; i < 14; i++) {
            await polishNap(150);
            r = await h.ev(frostProbe(selector));
            if (!r?.found || r.blockedBy == null) break;
        }
        const v = frostVerdict(r);
        return shown ? { r, ...v } : { r, ok: false, detail: `the panel is not on screen (${v.detail})` };
    }
    const typedInputs = async (h) =>
        (await CF.rpcCalls(h, "ControllerInputCommand")).map((c) => Buffer.from(c.data?.inputdata64 ?? "", "base64").toString("latin1"));
    // a native value written to a controlled field, as typing would (the framework's tracker sees the change)
    const typeInto = (h, selector, value) =>
        h.ev(`(() => {
            const el = document.querySelector(${q(selector)});
            if (!el) return false;
            const proto = el.tagName === "TEXTAREA" ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
            Object.getOwnPropertyDescriptor(proto, "value").set.call(el, ${q(value)});
            el.dispatchEvent(new Event("input", { bubbles: true }));
            return true;
        })()`);

    // a step that throws is a failed step, not the end of the run
    const runner = (rec) => async (name, fn) => {
        try {
            await fn(name);
        } catch (e) {
            rec(name, false, `the step threw: ${String(e?.message ?? e)}`);
        }
    };

    // --- phase: the chat footer, + menu and initiative card ---------------------------------------------------------

    async function chatPhase(h, ctx, rec) {
        const run = runner(rec);
        const A = ctx.tab.tabId;
        const chip = `[data-agent-chat="${A}"] [data-chat-model]`;
        const MAIN = parentOf(menuOf("Model"));
        const EFFORT = parentOf(menuOf("Effort"));
        const MORE = parentOf(menuOf("More models"));
        const modelMenuUp = () => until(h, `!!document.querySelector(${q(menuOf("Model"))})`);
        const modelMenuGone = () => until(h, `!document.querySelector(${q(menuOf("Model"))})`);
        const openModelMenu = async () => {
            await click(h, chip);
            return modelMenuUp();
        };

        await AC.focusAgent(h, A);
        const shown = await until(h, `(${layerOf(A)}?.querySelectorAll("[data-chat-item]").length ?? 0) >= 2 && !!document.querySelector(${q(chip)})`, WAIT_MS);
        if (!shown) rec("0. the fixture agent's Chat shows its conversation and its model chip", false, "it did not within the wait");

        await run("1. model menu", async (name) => {
            const up = await openModelMenu();
            const v = await probePanel(h, MAIN);
            await shot(h, "1-model-menu");
            rec(`${name}: the footer's model menu is a frosted panel`, up && v.ok, v.detail);
        });

        // the submenus: a sibling of the menu's panel (not inside it), each frosting what is behind it; a choice picked with a real
        // pointer click closes the menu and applies (the outside-press handler does not take the submenu as outside)
        await run("2. effort submenu", async (name) => {
            if (!(await exists(h, menuOf("Model")))) await openModelMenu();
            const row = await centerOf(h, '[data-opens-sub="effort"]');
            if (row != null) await moveTo(h, row.x, row.y);
            const subUp = await until(h, `!!document.querySelector(${q(menuOf("Effort"))})`);
            const main = await probePanel(h, MAIN);
            const sub = await probePanel(h, EFFORT);
            const geo = await h.ev(`(() => {
                const m = document.querySelector(${q(MAIN)});
                const s = document.querySelector(${q(EFFORT)});
                if (!m || !s) return null;
                const a = m.getBoundingClientRect();
                const b = s.getBoundingClientRect();
                return { nested: m.contains(s), gap: Math.round((b.left - a.right) * 10) / 10, below: Math.round((b.bottom - a.bottom) * 10) / 10 };
            })()`);
            await shot(h, "2-effort-submenu");
            const before = (await typedInputs(h)).length;
            const clicked = await clickReal(h, '[data-chat-effort-choice="high"]');
            let applied = false;
            for (let i = 0; i < 40 && !applied; i++) {
                applied = (await typedInputs(h)).slice(before).some((t) => t.includes("/effort high"));
                if (!applied) await polishNap(100);
            }
            const closed = await modelMenuGone();
            const chipText = await h.ev(`document.querySelector(${q(chip)})?.textContent.trim() ?? null`);
            rec(
                `${name}: the Effort submenu is its own frosted panel beside the menu's (not inside it, 5px past its right edge and 6px below its bottom, as the old markup placed it), and a real click on High types /effort high, closes the menu and reads High on the chip`,
                subUp && main.ok && sub.ok && geo != null && geo.nested === false && Math.abs(geo.gap - 5) <= 1 && Math.abs(geo.below - 6) <= 1 && clicked && applied && closed && /High$/.test(chipText ?? ""),
                { main: main.detail, sub: sub.detail, geo, clicked, applied, closed, chipText }
            );
        });

        await run("3. more models submenu", async (name) => {
            await openModelMenu();
            const row = await centerOf(h, '[data-opens-sub="more"]');
            if (row != null) await moveTo(h, row.x, row.y);
            const subUp = await until(h, `!!document.querySelector(${q(menuOf("More models"))})`);
            const main = await probePanel(h, MAIN);
            const sub = await probePanel(h, MORE);
            const nested = await h.ev(`document.querySelector(${q(MAIN)})?.contains(document.querySelector(${q(MORE)})) ?? null`);
            await shot(h, "3-more-models-submenu");
            const before = (await typedInputs(h)).length;
            const clicked = await clickReal(h, `${menuOf("More models")} [data-chat-model-choice="claude-opus-4-8"]`);
            let applied = false;
            for (let i = 0; i < 40 && !applied; i++) {
                applied = (await typedInputs(h)).slice(before).some((t) => t.includes("/model claude-opus-4-8"));
                if (!applied) await polishNap(100);
            }
            const closed = await modelMenuGone();
            rec(
                `${name}: the More models submenu is its own frosted panel beside the menu's, and a real click on Opus 4.8 types /model claude-opus-4-8 and closes the menu`,
                subUp && main.ok && sub.ok && nested === false && clicked && applied && closed,
                { main: main.detail, sub: sub.detail, nested, clicked, applied, closed }
            );
        });

        await run("4. permission mode menu", async (name) => {
            const wrote = await h.ev(`(() => {
                const t = window.__arcTerms?.[${q(ctx.tab.blockId)}]?.terminal;
                if (!t) return { ok: false, why: "no xterm in window.__arcTerms" };
                const lines = ${JSON.stringify(SCREENS.mode3)}.slice(-t.rows);
                const first = t.rows - lines.length;
                let out = "\\x1b[2J\\x1b[H";
                lines.forEach((l, i) => { out += "\\x1b[" + (first + i + 1) + ";1H\\x1b[2K" + l.slice(0, t.cols); });
                t.write(out);
                return { ok: true };
            })()`);
            const chipUp = await until(h, `!!${layerOf(A)}?.querySelector("button[data-chat-mode]")`, WAIT_MS);
            await h.ev(`${layerOf(A)}?.querySelector("button[data-chat-mode]")?.click()`);
            const up = await until(h, `!!document.querySelector(${q(menuOf("Permission mode"))})`);
            const v = await probePanel(h, parentOf(menuOf("Permission mode")));
            await shot(h, "4-mode-menu");
            await press(h, KEYS.escape);
            const closed = await until(h, `!document.querySelector(${q(menuOf("Permission mode"))})`);
            rec(`${name}: the permission mode menu is a frosted panel, and Escape closes it`, wrote?.ok === true && chipUp && up && v.ok && closed, { wrote, v: v.detail, closed });
        });

        await run("5. plus menu", async (name) => {
            await click(h, `[data-agent-chat="${A}"] [data-chat-plus]`);
            const up = await until(h, `!!document.querySelector("[data-chat-plus-menu]")`);
            const v = await probePanel(h, parentOf("[data-chat-plus-menu]"));
            await shot(h, "5-plus-menu");
            await press(h, KEYS.escape);
            const closed = await until(h, `!document.querySelector("[data-chat-plus-menu]")`);
            rec(`${name}: the + menu is a frosted panel, and Escape closes it`, up && v.ok && closed, { v: v.detail, closed });
        });

        await run("6. initiative chunk list", async (name) => {
            const card = `${layerOf(A)}?.querySelector('[data-chat-initiative-origin="agent"]')`;
            const cardUp = await until(h, `!!${card}`, WAIT_MS);
            await h.ev(`(${card})?.scrollIntoView({ block: "center" })`);
            await h.ev(`(${card})?.querySelector("[data-chat-initiative-edit]")?.click()`);
            const editing = await until(h, `(() => { const c = ${card}; return !!c && !!c.querySelector("[data-chat-initiative-text]") && !c.querySelector("[data-chat-initiative-quote]"); })()`, WAIT_MS);
            await polishNap(400);
            await h.ev(`(${card})?.querySelector("[data-chat-initiative-chunk]")?.click()`);
            const up = await until(h, `!!document.querySelector("[data-chat-initiative-chunk-list]")`);
            const v = await probePanel(h, parentOf("[data-chat-initiative-chunk-list]"));
            const rows = await h.ev(`document.querySelectorAll("[data-chat-initiative-chunk-option]").length`);
            await shot(h, "6-chunk-list");
            await press(h, KEYS.escape);
            const closed = await until(h, `!document.querySelector("[data-chat-initiative-chunk-list]")`);
            rec(`${name}: the initiative card's chunk list is a frosted panel over the three chunks, and Escape closes it`, cardUp && editing && up && v.ok && rows === CHUNKS.length && closed, { cardUp, editing, v: v.detail, rows, closed });
        });
    }

    // --- phase: the document Outline ---------------------------------------------------------------------------------

    async function outlinePhase(h, ctx, rec) {
        const run = runner(rec);
        const A = ctx.tab.tabId;
        await run("7. document outline", async (name) => {
            const md = join(ctx.dir, "retry-notes.md");
            writeFileSync(md, OUTLINE_MD);
            await AC.agentPage(
                h,
                `const R = await mod("app/view/agents/agentrailstore.ts");
                R.openFileInPanel(agentsModel(), ${q(A)}, { abs: ${q(md)}, root: ${q(ctx.dir)} });
                return true;`
            );
            const button = await until(h, `!!document.querySelector("[data-outline-button]")`, WAIT_MS);
            await h.ev(`document.querySelector("[data-outline-button]")?.click()`);
            const up = await until(h, `!!document.querySelector("[data-outline-list]")`);
            const v = await probePanel(h, parentOf("[data-outline-list]"));
            const items = await h.ev(`document.querySelectorAll("[data-outline-item]").length`);
            await shot(h, "7-outline");
            // the button toggles it (Escape is the file tab's own key here, which this step leaves alone)
            await click(h, "[data-outline-button]");
            const closed = await until(h, `!document.querySelector("[data-outline-list]")`);
            rec(`${name}: the Outline popover is a frosted panel listing the headings, and the button closes it`, button && up && v.ok && items >= 4 && closed, { button, v: v.detail, items, closed });
        });
    }

    // --- phase: the route picker (Settings) --------------------------------------------------------------------------

    async function routePhase(h, rec) {
        const run = runner(rec);
        const flat = scenario("route-picker-flat");
        let fctx = null;
        try {
            fctx = await flat.arrange(h);
            await run("8. route picker", async (name) => {
                await h.goto("settings");
                await h.ev(`(() => { document.querySelector('[data-section="runs"]')?.click(); return true; })()`);
                await polishNap(300);
                const present = await until(h, `!!document.querySelector('[data-testid="route-picker"]')`);
                await h.ev(`document.querySelector('[data-testid="route-picker"]')?.scrollIntoView({ block: "center" })`);
                await polishNap(200);
                await click(h, '[data-testid="route-picker"]');
                const up = await until(h, `!!document.querySelector('[aria-label="Available routes"]')`);
                const v = await probePanel(h, parentOf('[aria-label="Available routes"]'));
                await shot(h, "8-route-picker");
                await press(h, KEYS.escape);
                const closed = await until(h, `!document.querySelector('[aria-label="Available routes"]')`);
                rec(`${name}: the route picker is a frosted panel, and Escape closes it`, present && up && v.ok && closed, { present, v: v.detail, closed });
            });
        } catch (e) {
            rec("8. route picker", false, `the fixtures did not arrange: ${String(e?.message ?? e)}`);
        } finally {
            try {
                if (fctx != null) await flat.teardown(h, fctx);
            } catch (e) {
                console.error(`overlays-frost-chat: route-picker-flat teardown failed: ${e?.message ?? e}`);
            }
        }
    }

    // --- phase: the harness picker (Jarvis peek) ---------------------------------------------------------------------

    async function harnessPhase(h, rec) {
        const run = runner(rec);
        await run("9. harness picker", async (name) => {
            await h.goto("cockpit");
            await polishNap(300);
            const PEEK_PICKER = '[data-pet-peek] [data-testid="harness-picker"]';
            if (!(await exists(h, "[data-pet-peek]"))) await h.ev(`document.querySelector('[aria-label="Jarvis condition"]')?.click()`);
            const peek = await until(h, `!!document.querySelector(${q(PEEK_PICKER)})`, WAIT_MS);
            await polishNap(500);
            await click(h, PEEK_PICKER);
            const up = await until(h, `!!document.querySelector('[data-testid^="harness-option-"]')`);
            const v = await probePanel(h, parentOf('div > [data-testid^="harness-option-"]'));
            await shot(h, "9-harness-picker");
            await press(h, KEYS.escape);
            const closed = await until(h, `!document.querySelector('[data-testid^="harness-option-"]')`);
            await h.ev(`document.querySelector('[data-pet-peek] button[aria-label="Close Jarvis panel"]')?.click()`);
            rec(`${name}: the harness picker is a frosted panel, and Escape closes it`, peek && up && v.ok && closed, { peek, v: v.detail, closed });
        });
    }

    // --- phase: the line review tray's Send menu (Diff surface) --------------------------------------------------------

    // the roster the page boots with (public/cockpit-fixtures/active.json, which line-review's own fixtures write the same way):
    // the scoped agent has no block, so it is never one of the project's live agents; the two others have one, so Send is a menu
    const LR_PROJECT = "verify-line-review";
    const LR_LIVE = [
        { id: "fx-of-live-a", name: "lint-fixer", blockId: "fx-blk-of-live-a" },
        { id: "fx-of-live-b", name: "test-writer", blockId: "fx-blk-of-live-b" },
    ];
    const ROSTER_FILE = new URL("../../../public/cockpit-fixtures/active.json", import.meta.url);

    async function reviewPhase(h, rec) {
        const run = runner(rec);
        const lr = scenario("line-review");
        let lctx = null;
        try {
            lctx = await lr.arrange(h);
            if (lctx.arrangeError != null) throw new Error(lctx.arrangeError);
            writeFileSync(
                ROSTER_FILE,
                JSON.stringify(
                    [
                        { id: "fx-lr-agent", name: "review-writer", project: LR_PROJECT, task: "edit the policy", state: "working", agent: "claude", model: "opus", activeMs: 30_000, transcriptPath: lctx.transcriptPath, previousInfo: [{ kind: "message", text: "Edited the policy." }] },
                        ...LR_LIVE.map((a) => ({ id: a.id, name: a.name, project: LR_PROJECT, task: "help with the policy", state: "working", agent: "claude", model: "opus", blockId: a.blockId, activeMs: 20_000, previousInfo: [{ kind: "message", text: "Looking at the policy." }] })),
                    ],
                    null,
                    2
                )
            );
            if (!(await ahReload(h))) throw new Error("the page did not come back after the reload");
            await run("10. line review send menu", async (name) => {
                await h.goto("files");
                // scoped to the project (a group of the source picker), not the agent: two live agents make Send a menu
                const picked = await h.ev(`(async () => {
                    const until = async (fn, ms) => { for (let t = 0; t < ms && !fn(); t += 100) await new Promise((r) => setTimeout(r, 100)); return fn(); };
                    document.querySelector('[data-folded-source]')?.click();
                    if (!document.querySelector('[data-source-picker="open"]')) {
                        if (!(await until(() => document.querySelector('[data-source-picker-trigger]'), 5000))) return false;
                        document.querySelector('[data-source-picker-trigger]').click();
                    }
                    if (!(await until(() => document.querySelector('[data-source-picker="open"]'), 3000))) return false;
                    const option = ${q(`[data-files-source-option=${q(LR_PROJECT)}]`)};
                    if (!(await until(() => document.querySelector(option), 1500))) {
                        const g = await until(() => document.querySelector(${q(`[data-worktree-group=${q(LR_PROJECT)}]`)}), 5000);
                        if (g?.getAttribute("aria-expanded") === "false") g.click();
                    }
                    const row = await until(() => document.querySelector(option), 8000);
                    if (!row) return false;
                    row.click();
                    return true;
                })()`);
                await until(h, `!!document.querySelector('[data-panel-tab="log"]')`, 8000);
                await click(h, '[data-panel-tab="log"]');
                await polishNap(500);
                const history = await until(h, `document.querySelectorAll("[data-history-row]").length >= 1`, WAIT_MS);
                await click(h, '[data-history-row] button');
                await until(h, `!!document.querySelector("[data-diff-mode]")`, 8000);
                await click(h, '[data-diff-mode-option="review"]');
                const listed = await until(h, `!!document.querySelector('[data-review-file="README.md"]')`, 8000);
                // one comment on README.md line 12, as line-review's own step 19 makes it
                const ROW = `[data-review-file="README.md"]`;
                await h.ev(`document.querySelector(${q(ROW)})?.parentElement?.querySelector('[data-review-row="new:12"] [data-review-add]')?.click()`);
                const boxUp = await until(h, `!!document.querySelector("[data-review-box]")`);
                await typeInto(h, "[data-review-box] textarea", "Pick one agent.");
                await h.ev(`[...document.querySelectorAll("[data-review-box] button")].find((b) => b.textContent.trim() === "Add Comment")?.click()`);
                const sendUp = await until(h, `!!document.querySelector("[data-review-send]")`);
                await click(h, "[data-review-send]");
                const up = await until(h, `!!document.querySelector("[data-review-agent-menu]")`);
                const v = await probePanel(h, parentOf("[data-review-agent-menu]"));
                const names = await h.ev(`[...document.querySelectorAll("[data-review-agent-menu] [role=menuitem]")].map((e) => e.innerText.trim())`);
                await shot(h, "10-line-review-menu");
                await h.ev(`document.querySelector("[data-review-send]")?.click()`);
                const closed = await until(h, `!document.querySelector("[data-review-agent-menu]")`);
                rec(
                    `${name}: the line review tray's Send menu (two live agents on the project) is a frosted panel naming both, and the Send button closes it`,
                    picked && listed && boxUp && sendUp && up && v.ok && names.length === 2 && closed,
                    { picked, history, listed, boxUp, sendUp, v: v.detail, names, closed }
                );
            });
        } catch (e) {
            rec("10. line review send menu", false, `the fixtures did not arrange: ${String(e?.message ?? e)}`);
        } finally {
            try {
                if (lctx != null) await lr.teardown(h, lctx);
            } catch (e) {
                console.error(`overlays-frost-chat: line-review teardown failed: ${e?.message ?? e}`);
            }
        }
    }

    // --- phase: the council's popovers -----------------------------------------------------------------------------------

    async function councilPhase(h, rec) {
        const run = runner(rec);
        const disc = scenario("council-discussion");
        let cctx = null;
        try {
            cctx = await disc.arrange(h);
            await h.ev(`(() => { try { localStorage.removeItem("council.ideasRail.folded"); } catch {} })()`);
            // the Agent surface stays mounted when another shows, with every layer at no size: the steps need it on screen
            await h.goto("agent");
            const id = await CF.seedCouncil(h, cctx, "round2");
            await CF.openCouncil(h, id, "discussion");
            await until(h, `!!document.querySelector('[data-council-discussion="${id}"]')`, WAIT_MS);
            await h.cdp("Emulation.setFocusEmulationEnabled", { enabled: true });

            await run("11. council seats popover", async (name) => {
                const SEATS = "[data-council-discussion] header [data-council-seats]";
                await until(h, `!!document.querySelector(${q(SEATS)})`, WAIT_MS);
                await click(h, SEATS);
                const up = await until(h, `!!document.querySelector("[data-council-seat-list]")`);
                const v = await probePanel(h, parentOf("[data-council-seat-list]"));
                await shot(h, "11-council-seats");
                await click(h, SEATS);
                const closed = await until(h, `!document.querySelector("[data-council-seat-list]")`);
                rec(`${name}: the seats popover is a frosted panel, and a second click on the stack closes it`, up && v.ok && closed, { up, v: v.detail, closed });
            });

            await run("12. council files list", async (name) => {
                const trigger = "[data-council-files-open]";
                const there = await until(h, `!!document.querySelector(${q(trigger)})`, WAIT_MS);
                await click(h, trigger);
                const OPEN = '[data-council-files-list][data-open="true"]';
                const up = await until(h, `!!document.querySelector(${q(OPEN)})`);
                const v = await probePanel(h, OPEN);
                await shot(h, "12-council-files");
                await click(h, trigger);
                const closed = await until(h, `!document.querySelector(${q(OPEN)})`);
                rec(`${name}: an idea's files list is a frosted panel, and a second click on its icon closes it`, there && up && v.ok && closed, { there, up, v: v.detail, closed });
            });

            await run("13. council mention list", async (name) => {
                const INPUT = '[data-council-composer="channel"] [data-council-composer-input]';
                const there = await until(h, `!!document.querySelector(${q(INPUT)})`, WAIT_MS);
                await h.ev(`document.querySelector(${q(INPUT)})?.focus()`);
                await typeInto(h, INPUT, "@");
                const up = await until(h, `!!document.querySelector("[data-council-mentions]")`);
                const v = await probePanel(h, "[data-council-mentions]");
                await shot(h, "13-council-mentions");
                await typeInto(h, INPUT, "");
                const closed = await until(h, `!document.querySelector("[data-council-mentions]")`);
                rec(`${name}: the @ mention list is a frosted panel, and clearing the box closes it`, there && up && v.ok && closed, { there, up, v: v.detail, closed });
            });

            await run("14. council message More menu", async (name) => {
                const trigger = "[data-council-more]";
                const there = await until(h, `!!document.querySelector(${q(trigger)})`, WAIT_MS);
                await h.ev(`document.querySelector(${q(trigger)})?.scrollIntoView({ block: "center" })`);
                const clicked = await click(h, trigger);
                const MENU = `${trigger} + [role="menu"]`;
                const up = await until(h, `(() => { const r = document.querySelector(${q(MENU)})?.getBoundingClientRect(); return !!r && r.width > 0 && r.height > 0; })()`);
                const v = await probePanel(h, MENU);
                const state = await h.ev(`(() => { const t = document.querySelector(${q(trigger)}); const m = document.querySelector(${q(MENU)}); return { expanded: t?.getAttribute("aria-expanded") ?? null, menu: !!m, display: m ? getComputedStyle(m).display : null, triggers: document.querySelectorAll(${q(trigger)}).length }; })()`);
                await shot(h, "14-council-more");
                await press(h, KEYS.escape);
                const closed = await until(h, `(() => { const r = document.querySelector(${q(MENU)})?.getBoundingClientRect(); return !r || r.width === 0; })()`);
                rec(`${name}: a message's More menu is a frosted panel, and Escape closes it`, there && clicked && up && v.ok && closed, { there, clicked, up, v: v.detail, closed, state });
            });

            await run("15. council memory details popover", async (name) => {
                const mid = await CF.seedCouncil(h, cctx, "done", {
                    id: `${CF.councilFixtureId("done")}-frost`,
                    edit: (c) => {
                        const ts = (s) => c.started + s * 1000;
                        c.replies = [{ id: "r21", proposalid: "", author: "ux", text: "Ten answers is enough for now.", round: 3, ts: ts(705) }];
                        c.memory = {
                            entries: [
                                { id: "m1", kind: "agreed", text: "A cached answer expires after ten minutes", by: "auto", round: 3, messages: ["r21"], at: Date.now() - 8 * 60_000 },
                                { id: "m6", kind: "open", text: "Who clears the cache on logout", by: "you", at: Date.now() - 15 * 60_000 },
                            ],
                            nextentry: 6,
                        };
                    },
                });
                await CF.openCouncil(h, mid, "discussion");
                await until(h, `!!document.querySelector("[data-council-rail]")`, WAIT_MS);
                await click(h, '[data-council-rail] [data-council-rail-tab="memory"]');
                const tab = await until(h, `!!document.querySelector("[data-council-memory]")`, WAIT_MS);
                const BTN = '[data-council-memory-entry="m1"] [data-council-memory-details]';
                const entries = await until(h, `!!document.querySelector(${q(BTN)})`);
                await h.ev(`document.querySelector(${q(BTN)})?.focus()`);
                const up = await until(h, `!!document.querySelector("[data-council-memory-popover]")`);
                const v = await probePanel(h, "[data-council-memory-popover]");
                const state = await h.ev(`({ entries: document.querySelectorAll("[data-council-memory-entry]").length, ids: [...document.querySelectorAll("[data-council-memory-entry]")].map((e) => e.getAttribute("data-council-memory-entry")), focused: document.activeElement?.getAttribute("data-council-memory-details") ?? document.activeElement?.tagName ?? null })`);
                await shot(h, "15-council-memory-details");
                await press(h, KEYS.escape);
                const closed = await until(h, `!document.querySelector("[data-council-memory-popover]")`);
                rec(`${name}: a memory entry's details popover is a frosted panel, and Escape closes it`, tab && entries && up && v.ok && closed, { tab, entries, up, v: v.detail, closed, state });
            });

            // Setup draws every one of its menus (Group, Attach, Add agent, Add expert) with one MenuButton, one PopoverReveal panel;
            // the Group menu is the one Setup always has
            await run("16. council setup menu", async (name) => {
                await h.goto("agent");
                await CF.openCouncilSetup(h, cctx.repo, { feature: "Rail apps" });
                const trigger = "[data-council-group]";
                const there = await until(h, `!!document.querySelector(${q(trigger)})`, WAIT_MS);
                await click(h, trigger);
                const up = await until(h, `!!document.querySelector(${q(menuOf("Group of experts"))})`);
                const v = await probePanel(h, parentOf(menuOf("Group of experts")));
                await shot(h, "16-council-setup-menu");
                await press(h, KEYS.escape);
                const closed = await until(h, `!document.querySelector(${q(menuOf("Group of experts"))})`);
                rec(`${name}: Setup's Group menu (the MenuButton every Setup menu is) is a frosted panel, and Escape closes it`, there && up && v.ok && closed, { there, up, v: v.detail, closed });
            });
        } catch (e) {
            rec("11. the council fixtures", false, `the fixtures did not arrange: ${String(e?.message ?? e)}`);
        } finally {
            try {
                if (cctx != null) await disc.teardown(h, cctx);
            } catch (e) {
                console.error(`overlays-frost-chat: council-discussion teardown failed: ${e?.message ?? e}`);
            }
        }
    }

    return [
        {
            name: "overlays-frost-chat",
            surface: "agent",
            async arrange(h) {
                const ctx = { dir: mkdtempSync(join(tmpdir(), "verify-of-chat-")), prev: {} };
                let at = "reading the keys";
                try {
                    for (const k of [GRID_KEY, ...LS_KEYS_EXTRA]) ctx.prev[k] = await h.ev(`localStorage.getItem(${q(k)})`);
                    at = "writing the transcript";
                    const base = Date.now() - 3_600_000;
                    const o = (sec) => ({ cwd: ctx.dir, ts: new Date(base + sec * 1000).toISOString() });
                    ctx.transcript = AC.writeTranscript(ctx.dir, "overlays-frost-chat", [
                        AC.userText("file the follow-ups for the sync retry work", o(0)),
                        AC.assistantText(REPLY, o(2)),
                        AC.userText("and how does the backoff work?", o(10)),
                        AC.assistantText("Retries back off exponentially, capped at 30 seconds, with 20% jitter.", o(12)),
                    ]);
                    at = "resetting the grid and the stored cards";
                    await h.ev(`localStorage.setItem(${q(GRID_KEY)}, ${q(JSON.stringify(GRID_EMPTY))})`);
                    for (const k of LS_KEYS_EXTRA) await h.ev(`localStorage.removeItem(${q(k)})`);
                    if (!(await ahReload(h))) throw new Error("the page did not come back after the reload");
                    await h.goto("agent");
                    at = "making the tab";
                    ctx.tab = await makeTab(h, ctx, { label: NAME });
                    at = "stubbing the commands";
                    await CF.stubRpc(h, ["ControllerInputCommand", "EffortListCommand", "EffortGetCommand"], {
                        EffortListCommand: { value: { efforts: [effortSummary()] } },
                        EffortGetCommand: { value: { effort: effortDetail() } },
                    });
                    at = "setting the roster";
                    await AC.setRoster(h, [
                        {
                            project: PROJECT,
                            task: "",
                            agent: "claude",
                            model: "opus",
                            state: "idle",
                            idleSince: Date.now() - 60_000,
                            usage: { contextpct: 42 },
                            id: ctx.tab.tabId,
                            name: NAME,
                            blockId: ctx.tab.blockId,
                            transcriptPath: ctx.transcript,
                            effortId: OID,
                        },
                    ]);
                } catch (e) {
                    ctx.arrangeError = `${at}: ${String(e?.message ?? e)}`;
                }
                return ctx;
            },

            async assert(h, ctx) {
                const steps = [];
                const rec = (step, ok, detail) => steps.push({ step, ok: ok === true, detail: typeof detail === "string" ? detail : JSON.stringify(detail) });
                if (ctx.arrangeError != null) {
                    rec("0. the fixture agent, its transcript and the stubbed commands", false, ctx.arrangeError);
                    return steps;
                }
                await h.cdp("Emulation.setFocusEmulationEnabled", { enabled: true });
                const phases = [
                    ["chat", () => chatPhase(h, ctx, rec)],
                    ["outline", () => outlinePhase(h, ctx, rec)],
                    ["route", () => routePhase(h, rec)],
                    ["harness", () => harnessPhase(h, rec)],
                    ["review", () => reviewPhase(h, rec)],
                    ["council", () => councilPhase(h, rec)],
                ];
                for (const [name, fn] of phases) {
                    try {
                        await fn();
                    } catch (e) {
                        rec(`${name}: the phase ran to its end`, false, String(e?.message ?? e));
                    }
                }
                return steps;
            },

            async teardown(h, ctx) {
                const step = async (what, fn) => {
                    try {
                        await fn();
                    } catch (e) {
                        console.error(`overlays-frost-chat teardown: ${what} failed: ${e?.message ?? e}`);
                    }
                };
                await step("restore the commands", () => CF.unstubRpc(h));
                await step("restore the roster", () => AC.restoreRoster(h));
                await step("close the fixture tab", () => closeTabs(h, ctx));
                await step("restore the keys", () =>
                    h.ev(`(() => {
                        for (const [k, v] of Object.entries(${JSON.stringify(ctx.prev ?? {})})) {
                            if (v == null) localStorage.removeItem(k);
                            else localStorage.setItem(k, v);
                        }
                        return true;
                    })()`)
                );
                await step("remove the temp dir", () => rmSync(ctx.dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 }));
            },
        },
    ];
}
