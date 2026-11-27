// The agent's later card (docs/superpowers/specs/2026-11-27-ask-later-design.md Decision 4 and "The agent's list card",
// Builder's call 13; plan docs/superpowers/plans/2026-11-27-ask-later.md Task 7), one scenario:
//
//   later-card: a Claude agent's reply holds an ```arc-initiative block of kind chunk with `later: true` and four items.
//   Chat draws it as a card of its own (`[data-chat-initiative-later]`): the heading, one row per item with a remove ×
//   (`[data-later-card-row]`), the target and Add. Linked to an initiative, the target is that initiative; not linked, the
//   target button opens the picker with Recent first. Add writes every row that is left as a later chunk whose first note
//   holds the passage, the agent's session and the conversation, and the card folds to its result line.
//
// A fixture Claude agent over real tabs and the page's dev mock roster, as scenarios-chat-suggest-card.mjs makes them; no
// real agent is launched. The initiatives are real ones this scenario makes through effortcreate and deletes in teardown, so
// what Add wrote is read back from wavesrv. kit is scenarios.mjs's CR_KIT (the Chat redesign's: waveService, polishWaitFor,
// polishNap, ahReload, GRID_KEY, GRID_EMPTY).

import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import * as AC from "./agent-page-fixtures.mjs";

const WAIT_MS = 15000;
const SHORT_MS = 6000;
const PROJECT = "verify-later-card";
// the four chat.initiative.* maps the store reads once, when the page loads
const STORE_KEYS = {
    handled: "chat.initiative.handled",
    cards: "chat.initiative.cards",
    drafts: "chat.initiative.drafts",
    pending: "chat.initiative.pending",
};
const TITLE = {
    linked: "verify-later-card linked",
    recentA: "verify-later-card recent A",
    recentB: "verify-later-card recent B",
};
const NAME = { linked: "later card linked", free: "later card free" };
// the transcripts' stems are the conversation ids the notes must carry
const SESSION = { linked: "later-card-linked", free: "later-card-free" };
const ITEMS_LINKED = [
    "Push DEV once the parser branch is merged",
    "Delete the backup branch on origin",
    "Check where the parser branch stands",
    "Decide which parser takes the audit: logs",
];
const ITEMS_FREE = ["Ask a colleague whether 9306 or 1050 takes audit: logs", "Rename the backup branch before Friday"];
const HEADING = { linked: "Left for later", free: "To take to a colleague" };

const fence = (body) => "```arc-initiative\n" + JSON.stringify(body) + "\n```";
const replyOf = (lead, heading, items) =>
    [lead, "", fence({ kind: "chunk", later: true, text: heading, chunks: items })].join("\n");

// --- page expressions -------------------------------------------------------------------------------------------------

const FLAT = `((el) => (el?.textContent ?? "").replace(/\\s+/g, " ").trim())`;
const chatOf = (id) => `document.querySelector('[data-agent-chat="${id}"]')`;
const cardOf = (id) => `${chatOf(id)}?.querySelector("[data-chat-initiative-later]")`;
const PICKER = `document.querySelector("[data-initiative-picker]")`;

export default function (kit) {
    const { waveService, polishWaitFor, polishNap, ahReload, GRID_KEY, GRID_EMPTY } = kit;
    const { makeTab, closeTabs } = AC.tabFixtures({ waveService });

    // polls a Node-side check until it holds
    async function until(check, ms = SHORT_MS) {
        for (let waited = 0; waited < ms; waited += 250) {
            if (await check()) return true;
            await polishNap(250);
        }
        return false;
    }

    // A real mouse click at the middle of the element `expr` evaluates to; false when none is drawn. A card or a picker that is
    // still springing into place is clicked where it settles.
    async function click(h, expr) {
        const measure = () =>
            h.ev(`(() => {
                const el = ${expr};
                if (!el) return null;
                const r = el.getBoundingClientRect();
                return r.width > 0 && r.height > 0 ? { x: Math.round(r.x + r.width / 2), y: Math.round(r.y + r.height / 2) } : null;
            })()`);
        let box = await measure();
        for (let i = 0; i < 8 && box != null; i++) {
            await polishNap(120);
            const again = await measure();
            const steady = again != null && again.x === box.x && again.y === box.y;
            box = again;
            if (steady) break;
        }
        if (box == null) return false;
        await h.cdp("Input.dispatchMouseEvent", { type: "mouseMoved", x: box.x, y: box.y });
        for (const type of ["mousePressed", "mouseReleased"]) {
            await h.cdp("Input.dispatchMouseEvent", { type, x: box.x, y: box.y, button: "left", clickCount: 1 });
        }
        await polishNap(300);
        return true;
    }

    async function shot(h, name) {
        try {
            await polishNap(500);
            await h.shot(`cdp-shots/later-card-${name}.png`);
        } catch (e) {
            console.error(`later-card: the shot ${name} failed: ${e?.message ?? e}`);
        }
    }

    // a step that throws is a failed step, not the end of the run: the ones after it read what they need themselves
    function stepRunner(steps) {
        const rec = (step, ok, detail) => steps.push({ step, ok: ok === true, detail: typeof detail === "string" ? detail : JSON.stringify(detail) });
        const run = async (name, fn) => {
            try {
                await fn(name);
            } catch (e) {
                rec(name, false, `the step threw: ${String(e?.message ?? e)}`);
            }
        };
        return { rec, run };
    }

    // everything a step asserts about one agent's later card, read at once; null when no such card is drawn
    const readCard = (h, id) =>
        h.ev(`(() => {
            const flat = ${FLAT};
            const c = ${cardOf(id)};
            if (!c) return null;
            const add = c.querySelector("[data-chat-initiative-add],[data-chat-initiative-retry]");
            return {
                phase: c.getAttribute("data-chat-initiative"),
                header: flat(c.firstElementChild),
                heading: flat(c.querySelector("[data-later-card-heading]")),
                rows: [...c.querySelectorAll("[data-later-card-row]")].map((r) => flat(r.firstElementChild)),
                removes: c.querySelectorAll("[data-later-card-remove]").length,
                into: flat(c.querySelector("[data-chat-initiative-into]")),
                target: flat(c.querySelector("[data-later-card-target]")),
                add: add ? flat(add) : null,
                addDisabled: add ? add.disabled : null,
                addTitle: add?.getAttribute("title") ?? null,
                dismiss: flat(c.querySelector("[data-chat-initiative-dismiss]")),
                editor: !!c.querySelector("[data-chat-initiative-edit],[data-chat-initiative-text]"),
            };
        })()`);

    // the folded rows of one agent's Chat: which, the spans of its line (the glyph and the empty filler dropped), Open ↗
    const readRows = (h, id) =>
        h.ev(`[...(${chatOf(id)}?.querySelectorAll("[data-chat-initiative-row]") ?? [])].map((r) => ({
            kind: r.getAttribute("data-chat-initiative-row"),
            parts: [...r.children].filter((c) => c.tagName !== "svg").map((c) => c.textContent.trim()).filter((t) => t !== ""),
            open: !!r.querySelector("[data-chat-initiative-open]"),
        }))`);

    // the picker as drawn: its children in order, the Recent rows (the rows right under the Recent heading), the new row
    const readPicker = (h) =>
        h.ev(`(() => {
            const flat = ${FLAT};
            const dlg = ${PICKER};
            if (!dlg) return null;
            const kids = [...(dlg.querySelector('[role="listbox"]')?.children ?? [])];
            const at = kids.findIndex((k) => k.hasAttribute("data-picker-recent"));
            const recent = [];
            for (let i = at + 1; at >= 0 && i < kids.length && kids[i].hasAttribute("data-picker-row"); i++) {
                recent.push(kids[i].getAttribute("data-picker-row"));
            }
            return {
                label: dlg.getAttribute("aria-label"),
                placeholder: dlg.querySelector("input")?.getAttribute("placeholder") ?? null,
                recentAt: at,
                recent,
                heading: at >= 0 ? flat(kids[at]) : null,
                hasNew: !!dlg.querySelector("[data-picker-new]"),
                others: flat(dlg.querySelector("[data-picker-others]")),
            };
        })()`);

    const storeMap = (h, key) => h.ev(`JSON.parse(localStorage.getItem(${JSON.stringify(key)}) ?? "{}")`);
    const serverEffort = async (h, oid) => (await h.rpc("effortget", { effortoid: oid }))?.effort;

    // the later chunks of an initiative as the server holds them: label, mark, and its first note's session and conversation
    const laterChunks = (effort) =>
        (effort?.chunks ?? [])
            .filter((c) => c.later === true)
            .map((c) => {
                const first = [...(c.notes ?? [])].sort((a, b) => a.ts - b.ts)[0];
                return {
                    label: c.label,
                    status: c.status,
                    session: first?.session ?? null,
                    conversation: first?.conversation ?? null,
                    author: first?.author ?? null,
                    text: first?.text ?? "",
                };
            });

    const roster = (rows) =>
        rows.map((r) => ({
            project: PROJECT,
            task: "",
            agent: "claude",
            model: "opus",
            state: "idle",
            idleSince: Date.now() - 60_000,
            usage: { contextpct: 20 },
            ...r,
        }));

    // --- later-card -----------------------------------------------------------------------------------------------------

    const laterCard = {
        name: "later-card",
        surface: "agent",

        async arrange(h) {
            const ctx = {
                dir: mkdtempSync(join(tmpdir(), "verify-later-card-")),
                tabs: {},
                oids: {},
                prev: {},
            };
            let at = "reading the keys";
            try {
                for (const k of [GRID_KEY, "agent.chatmode", ...Object.values(STORE_KEYS)]) ctx.prev[k] = await h.ev(`localStorage.getItem(${JSON.stringify(k)})`);

                at = "clearing what an earlier run left";
                // a run that stopped half way left these behind
                const listed = await h.rpc("effortlist", {});
                for (const e of (listed?.efforts ?? []).filter((x) => Object.values(TITLE).includes(x.title))) {
                    await h.rpc("effortdelete", { effortoid: e.oref.replace(/^effort:/, "") }).catch(() => {});
                }

                at = "making the initiatives";
                // each holds plan chunks: the picker leaves ideas out. The last one made is the newest, so it heads Recent.
                for (const key of ["linked", "recentA", "recentB"]) {
                    const made = await h.rpc("effortcreate", {
                        title: TITLE[key],
                        project: PROJECT,
                        chunks: [{ label: `${key} plan one` }, { label: `${key} plan two` }],
                    });
                    ctx.oids[key] = made.effortoid;
                }

                at = "writing the transcripts";
                const base = Date.now() - 3_600_000;
                const o = (sec) => ({ cwd: ctx.dir, ts: new Date(base + sec * 1000).toISOString() });
                ctx.files = {
                    linked: AC.writeTranscript(ctx.dir, SESSION.linked, [
                        AC.userText("leave these for later, I'll go on with the parser first", o(0)),
                        AC.assistantText(replyOf("Four things are open. I added none of them; here they are as a card:", HEADING.linked, ITEMS_LINKED), o(2)),
                    ]),
                    free: AC.writeTranscript(ctx.dir, SESSION.free, [
                        AC.userText("these two are for a colleague", o(0)),
                        AC.assistantText(replyOf("Two questions to take to someone:", HEADING.free, ITEMS_FREE), o(2)),
                    ]),
                };

                at = "resetting the grid and the stored cards";
                await h.ev(`localStorage.setItem(${JSON.stringify(GRID_KEY)}, ${JSON.stringify(JSON.stringify(GRID_EMPTY))})`);
                await h.ev(`localStorage.removeItem("agent.chatmode")`);
                // the store reads these once, when the page loads: no card is handled, none waits and no line is pending
                await h.ev(`for (const k of ${JSON.stringify(Object.values(STORE_KEYS))}) localStorage.removeItem(k)`);
                if (!(await ahReload(h))) throw new Error("the page did not come back after the reload");
                await h.goto("agent");

                at = "making the tabs";
                ctx.tabs.linked = await makeTab(h, ctx, { label: NAME.linked });
                ctx.tabs.free = await makeTab(h, ctx, { label: NAME.free });

                at = "setting the roster";
                await AC.setRoster(
                    h,
                    roster([
                        {
                            id: ctx.tabs.linked.tabId,
                            name: NAME.linked,
                            blockId: ctx.tabs.linked.blockId,
                            transcriptPath: ctx.files.linked,
                            effortId: ctx.oids.linked,
                        },
                        { id: ctx.tabs.free.tabId, name: NAME.free, blockId: ctx.tabs.free.blockId, transcriptPath: ctx.files.free },
                    ])
                );
            } catch (e) {
                ctx.arrangeError = `${at}: ${String(e?.message ?? e)}`;
            }
            return ctx;
        },

        async assert(h, ctx) {
            const steps = [];
            const { rec, run } = stepRunner(steps);
            if (ctx.arrangeError != null) {
                rec("0. the fixture agents, their transcripts, the initiatives and the roster", false, ctx.arrangeError);
                return steps;
            }
            const L = ctx.tabs.linked.tabId;
            const F = ctx.tabs.free.tabId;
            const oref = (key) => `effort:${ctx.oids[key]}`;
            await h.cdp("Emulation.setFocusEmulationEnabled", { enabled: true });

            // brings an agent's chat up and scrolls its card into view; true once the card holds `rows` rows
            async function showCard(id, rows) {
                await AC.focusAgent(h, id);
                const up = await polishWaitFor(h, `${cardOf(id)}?.querySelectorAll("[data-later-card-row]").length === ${rows}`, WAIT_MS);
                await h.ev(`${cardOf(id)}?.scrollIntoView({ block: "center", behavior: "instant" })`);
                return up;
            }

            // 1. the linked agent's card: the heading, four rows and the agent's initiative as the target
            await run("1. the card", async (name) => {
                const up = await showCard(L, ITEMS_LINKED.length);
                // the target's chip names the initiative once the list has loaded
                const named = await polishWaitFor(h, `(${FLAT}(${cardOf(L)}?.querySelector("[data-chat-initiative-into]"))).includes(${JSON.stringify(TITLE.linked)})`, WAIT_MS);
                const got = await readCard(h, L);
                await shot(h, "1-card");
                rec(
                    `${name}: the later block draws one card of its own (no editor, no kind switch) with the heading "${HEADING.linked}", four rows in the agent's order, the linked initiative as its target, "Change…", "Add 4 for later" enabled and Dismiss`,
                    up &&
                        named &&
                        got != null &&
                        got.phase === "waiting" &&
                        got.header.startsWith("Save for later · proposed by the agent") &&
                        got.heading === HEADING.linked &&
                        JSON.stringify(got.rows) === JSON.stringify(ITEMS_LINKED) &&
                        got.removes === ITEMS_LINKED.length &&
                        got.into.includes(TITLE.linked) &&
                        got.target === "Change…" &&
                        got.add === "Add 4 for later" &&
                        got.addDisabled === false &&
                        got.dismiss === "Dismiss" &&
                        got.editor === false,
                    { up, named, got }
                );
            });

            // 2. × on a row folds it away and leaves three; the draft keeps the three
            await run("2. remove a row", async (name) => {
                const gone = ITEMS_LINKED[1];
                const kept = ITEMS_LINKED.filter((t) => t !== gone);
                const clicked = await click(h, `${cardOf(L)}?.querySelectorAll("[data-later-card-remove]")[1]`);
                // the removed row folds on the spring; the card holds three rows once it is gone
                const settled = await polishWaitFor(h, `${cardOf(L)}?.querySelectorAll("[data-later-card-row]").length === 3`, WAIT_MS);
                const got = await readCard(h, L);
                const drafts = Object.values(await storeMap(h, STORE_KEYS.drafts));
                await shot(h, "2-removed");
                rec(
                    `${name}: × on the second row leaves three rows (the others in order), Add reads "Add 3 for later", and the stored draft holds the same three`,
                    clicked &&
                        settled &&
                        got != null &&
                        JSON.stringify(got.rows) === JSON.stringify(kept) &&
                        got.add === "Add 3 for later" &&
                        got.addDisabled === false &&
                        drafts.some((d) => JSON.stringify(d?.later) === JSON.stringify(kept)),
                    { clicked, settled, got, drafts: drafts.map((d) => d?.later ?? null) }
                );
            });

            // 3. Add writes three later chunks (the note holds the session and the conversation) and the card folds
            await run("3. Add", async (name) => {
                const kept = ITEMS_LINKED.filter((t) => t !== ITEMS_LINKED[1]);
                const planBefore = ((await serverEffort(h, ctx.oids.linked))?.chunks ?? []).filter((c) => c.later !== true).map((c) => c.label);
                const clicked = await click(h, `${cardOf(L)}?.querySelector("[data-chat-initiative-add]")`);
                const folded = await polishWaitFor(h, `!${cardOf(L)} && ${chatOf(L)}?.querySelectorAll('[data-chat-initiative-row="added"]').length === 1`, WAIT_MS);
                const rows = await readRows(h, L);
                const effort = await serverEffort(h, ctx.oids.linked);
                const later = laterChunks(effort);
                const plan = (effort?.chunks ?? []).filter((c) => c.later !== true).map((c) => c.label);
                const pending = (await storeMap(h, STORE_KEYS.pending))[L] ?? [];
                await h.ev(`${chatOf(L)}?.querySelector('[data-chat-initiative-row="added"]')?.scrollIntoView({ block: "center", behavior: "instant" })`);
                await shot(h, "3-folded");
                rec(
                    `${name}: Add writes the three rows as later chunks of "${TITLE.linked}" (the plan keeps its own chunks), each first note quotes its item under the agent and holds agent:<tab> and the conversation id, the card folds to "Saved for later · ${TITLE.linked} — 3 items" with Open ↗, and the agent's next message will carry "initiative: added 3 chunks for later to …"`,
                    clicked &&
                        folded &&
                        rows.length === 1 &&
                        rows[0].kind === "added" &&
                        JSON.stringify(rows[0].parts.slice(0, 3)) === JSON.stringify(["Saved for later ·", TITLE.linked, "— 3 items"]) &&
                        rows[0].open &&
                        JSON.stringify(later.map((c) => c.label)) === JSON.stringify(kept) &&
                        later.every(
                            (c, i) =>
                                c.session === `agent:${L}` &&
                                c.conversation === SESSION.linked &&
                                c.author === "you" &&
                                c.text.includes(`> ${kept[i]}`) &&
                                c.text.includes(NAME.linked)
                        ) &&
                        JSON.stringify(plan) === JSON.stringify(planBefore) &&
                        pending.some((l) => l.startsWith("initiative: added 3 chunks for later to ") && l.includes(oref("linked"))),
                    { clicked, folded, rows, later, planBefore, plan, pending }
                );
            });

            // 4. an agent that is not linked: the target opens the picker with Recent first; a Recent row takes the items
            await run("4. an unlinked agent's card", async (name) => {
                const up = await showCard(F, ITEMS_FREE.length);
                const before = await readCard(h, F);
                const opened = await click(h, `${cardOf(F)}?.querySelector("[data-later-card-target]")`);
                // Recent draws once the initiatives have loaded
                const listed = await polishWaitFor(h, `!!${PICKER}?.querySelector("[data-picker-recent]")`, WAIT_MS);
                const picker = await readPicker(h);
                await shot(h, "4-picker");
                const row = `${PICKER}?.querySelector('[data-picker-row=${JSON.stringify(oref("recentB"))}]')`;
                const picked = await click(h, row);
                const closed = await polishWaitFor(h, `!${PICKER}`, WAIT_MS);
                const named = await polishWaitFor(h, `(${FLAT}(${cardOf(F)}?.querySelector("[data-chat-initiative-into]"))).includes(${JSON.stringify(TITLE.recentB)})`, WAIT_MS);
                const after = await readCard(h, F);
                const added = await click(h, `${cardOf(F)}?.querySelector("[data-chat-initiative-add]")`);
                const folded = await polishWaitFor(h, `!${cardOf(F)} && ${chatOf(F)}?.querySelectorAll('[data-chat-initiative-row="added"]').length === 1`, WAIT_MS);
                const rows = await readRows(h, F);
                const later = laterChunks(await serverEffort(h, ctx.oids.recentB));
                await h.ev(`${chatOf(F)}?.querySelector('[data-chat-initiative-row="added"]')?.scrollIntoView({ block: "center", behavior: "instant" })`);
                await shot(h, "4-folded");
                rec(
                    `${name}: with no initiative the card's target reads "Pick…" and Add is disabled; the target opens the picker (titled "Save for later in…") whose first section is Recent, holding "${TITLE.recentB}" among at most three rows, with "+ New initiative from this session"; picking that row names it as the target, Add reads "Add 2 for later", and Add writes the two items there as later chunks whose notes hold agent:<tab> and the conversation id`,
                    up &&
                        before != null &&
                        before.target === "Pick…" &&
                        before.addDisabled === true &&
                        before.addTitle === "Pick an initiative first" &&
                        opened &&
                        listed &&
                        picker != null &&
                        picker.recentAt === 0 &&
                        picker.heading === "Recent" &&
                        picker.recent.length >= 1 &&
                        picker.recent.length <= 3 &&
                        picker.recent.includes(oref("recentB")) &&
                        picker.placeholder === "Save for later in…" &&
                        picker.hasNew &&
                        picked &&
                        closed &&
                        named &&
                        after != null &&
                        after.target === "Change…" &&
                        after.add === "Add 2 for later" &&
                        after.addDisabled === false &&
                        added &&
                        folded &&
                        rows.length === 1 &&
                        JSON.stringify(rows[0].parts.slice(0, 3)) === JSON.stringify(["Saved for later ·", TITLE.recentB, "— 2 items"]) &&
                        JSON.stringify(later.map((c) => c.label)) === JSON.stringify(ITEMS_FREE) &&
                        later.every(
                            (c, i) =>
                                c.session === `agent:${F}` &&
                                c.conversation === SESSION.free &&
                                c.text.includes(`> ${ITEMS_FREE[i]}`)
                        ),
                    { up, before, opened, listed, picker, picked, closed, named, after, added, folded, rows, later }
                );
            });

            return steps;
        },

        async teardown(h, ctx) {
            const step = async (what, fn) => {
                try {
                    await fn();
                } catch (e) {
                    console.error(`later-card teardown: ${what} failed: ${e?.message ?? e}`);
                }
            };
            await step("close the picker", () => h.ev(`document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true })); true`));
            await step("restore the roster", () => AC.restoreRoster(h));
            await step("close the fixture tabs", () => closeTabs(h, ctx));
            await step("restore the grid, the chat modes and the stored cards", () =>
                h.ev(`(() => {
                    for (const [key, prev] of Object.entries(${JSON.stringify(ctx.prev ?? {})})) {
                        if (prev == null) localStorage.removeItem(key);
                        else localStorage.setItem(key, prev);
                    }
                    return true;
                })()`)
            );
            for (const [key, oid] of Object.entries(ctx.oids ?? {})) {
                await step(`delete ${key}`, () => h.rpc("effortdelete", { effortoid: oid }));
            }
            await step("remove the fixture transcripts", () => rmSync(ctx.dir, { recursive: true, force: true, maxRetries: 20, retryDelay: 500 }));
            await step("reload onto the live roster", () => ahReload(h));
            await step("go home", () => h.goto("cockpit"));
        },
    };

    return [laterCard];
}
