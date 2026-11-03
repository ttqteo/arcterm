// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0
//
// council-summary (docs/superpowers/plans/2026-10-21-council.md, Task 15; the report: docs/superpowers/plans/
// 2026-10-22-council-v1-ui.md, Task 4): the Summary of the `done` council, the report it opens on (what was asked, the
// answer, the ranked directions and the matrix folded under them), and what it hands on. The hooks are called by councilscenarios.mjs as arrange(h, fx),
// assert(h, ctx, fx), teardown(h, ctx, fx).
//
// Nothing here calls a model. Summarize again, and the Setup that Run again opens (it may suggest roles when it shows),
// have their RpcApi commands replaced in the page. Start an agent on it opens an agent through launchAgent, which makes a
// tab with a real CreateTab and then writes the launch (the claude command and the prompt) with SetMetaCommand: that and
// AgentSyncApplyCommand are replaced, so the tab stays a plain shell, the recorded SetMetaCommand call holds the prompt,
// and teardown closes the tab. Save as doc writes into the temp project, and Create initiative makes an initiative that
// teardown deletes: both are real.
//
// Two steps after the failed synthesis are the "Was this useful?" row (docs/superpowers/specs/2026-10-22-council-agent-team-design.md,
// Storage): CouncilRateCommand is replaced in the page, so no click reaches the data dir's council-bench.jsonl.
//
// The last two steps are the Brainstorm report (docs/superpowers/plans/2026-10-22-council-v1-room.md, Task 5): a done
// fixture seeded as a Brainstorm, with a saved document written into the temp project first so Open the document opens it.

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, isAbsolute, join } from "node:path";
import { SURFACE_LABEL, waitFor } from "../attach.mjs";
import {
    arrangeCouncilProject,
    loadCouncilFixture,
    openCouncil,
    rpcCalls,
    seedCouncil,
    stubRpc,
    teardownCouncilProject,
} from "./fixtures.mjs";

const WAIT_MS = 10_000;
const SUMMARY = "[data-council-summary]";
const DIRECTION = (rank) => `${SUMMARY} [data-council-direction="${rank}"]`;

// the fixture's four directions, in rank order (rail-apps-done.json)
const TITLES = [
    "Move the rail pins from localStorage to settings",
    "Show asleep and waking on the rail icon",
    "Keep the last-used app awake, once a measurement allows it",
    "Show the empty rail slots with a pin hint",
];

const slashes = (p) => (p || "").replace(/\\/g, "/").replace(/\/+$/, "").toLowerCase();
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const q = (s) => JSON.stringify(s);

const exists = (h, sel) => h.ev(`!!document.querySelector(${q(sel)})`);
const textOf = (h, sel) => h.ev(`document.querySelector(${q(sel)})?.innerText?.replace(/\\s+/g, " ").trim() ?? null`);
const click = (h, sel) =>
    h.ev(`(() => { const el = document.querySelector(${q(sel)}); if (el == null || el.disabled) return false; el.click(); return true; })()`);
const until = (h, expr, ms = WAIT_MS) => waitFor((e) => h.ev(e), expr, ms);

// a real mouse click at the middle of the first element `sel` matches (the shared menu opens where the pointer is); false
// when it is not on screen
async function mouseClick(h, sel) {
    const box = await h.ev(`(() => {
        const el = document.querySelector(${q(sel)});
        el?.scrollIntoView({ block: "nearest" });
        const r = el?.getBoundingClientRect();
        return r && r.width > 0 ? { x: Math.round(r.x + r.width / 2), y: Math.round(r.y + r.height / 2) } : null;
    })()`);
    if (box == null) return false;
    await h.cdp("Input.dispatchMouseEvent", { type: "mouseMoved", x: box.x, y: box.y });
    await h.cdp("Input.dispatchMouseEvent", { type: "mousePressed", x: box.x, y: box.y, button: "left", buttons: 1, clickCount: 1 });
    await h.cdp("Input.dispatchMouseEvent", { type: "mouseReleased", x: box.x, y: box.y, button: "left", buttons: 0, clickCount: 1 });
    return true;
}

// the Summary of the council (or of another seeded from the same fixture, by id), reopened (a step that left it for the
// Discussion or Setup comes back this way) and drawn
async function openSummary(h, ctx, id = ctx.councilId) {
    await openCouncil(h, id, "summary");
    // the root of an earlier council's Summary may still be up for a moment, so the council it shows is named too
    const drawn = `document.querySelector(${q(SUMMARY)})?.dataset.councilId === ${q(id)} &&
        document.querySelectorAll(${q(`${SUMMARY} [data-council-direction]`)}).length === 4`;
    if (!(await until(h, drawn))) {
        throw new Error("the Summary did not draw its four directions");
    }
}

// an action behind the `⋯` menu: open the menu, then click the item (false when it is missing or disabled)
async function menuClick(h, action) {
    await click(h, "[data-council-menu]");
    if (!(await until(h, `!!document.querySelector(${q(`[role="menuitem"][data-council-action="${action}"]`)})`))) {
        return false;
    }
    return click(h, `[role="menuitem"][data-council-action="${action}"]`);
}

// the first sentence of the fixture's summary text: what the report's bold line reads for a council with no answer
const FIRST_SENTENCE = loadCouncilFixture("done").summary.text.match(/^.*?[.!?](?=\s|$)/)[0];

// a direction opened (the open ones are kept in an atom, so a reopened Summary may have it open already)
// (the card is the toggle; its detail sits under the grid, one card open at a time)
const DETAIL = (rank) => `${SUMMARY} [data-council-direction-detail="${rank}"]`;
async function openDirection(h, rank) {
    const toggle = `${DIRECTION(rank)}[data-council-direction-toggle]`;
    if ((await h.ev(`document.querySelector(${q(toggle)})?.getAttribute("aria-expanded")`)) !== "true") {
        await click(h, toggle);
    }
    if (!(await until(h, `!!document.querySelector(${q(DETAIL(rank))})`))) {
        throw new Error(`direction ${rank} did not open`);
    }
}

// true once a call of `name` that `pred` accepts has been recorded by the page's stand-ins, false past ms
async function callSeen(h, name, pred, ms = 5_000) {
    for (const start = Date.now(); ; ) {
        if ((await rpcCalls(h, name)).some(pred)) return true;
        if (Date.now() - start >= ms) return false;
        await sleep(200);
    }
}

// the `⋯` menu's items as `action=label`, opened and closed again (a click on its button toggles it)
async function menuItems(h) {
    await click(h, "[data-council-menu]");
    await until(h, `!!document.querySelector('[role="menu"]')`);
    const items = await h.ev(
        `[...document.querySelectorAll('[role="menuitem"][data-council-action]')].map((b) => b.dataset.councilAction + "=" + b.innerText.trim())`
    );
    await click(h, "[data-council-menu]");
    return items;
}

// the Summary of a Brainstorm council opened by id, drawn once its three directions are (not openSummary's four)
async function openBrainstormSummary(h, id) {
    await openCouncil(h, id, "summary");
    const drawn = `document.querySelector(${q(SUMMARY)})?.dataset.councilId === ${q(id)} &&
        document.querySelectorAll(${q(`${SUMMARY} [data-council-direction]`)}).length === 3`;
    if (!(await until(h, drawn))) {
        throw new Error("the Summary did not draw its three directions");
    }
}

// what a Brainstorm report shows, reduced to what a step reads
const BRAINSTORM_FACTS = `(() => {
    const root = document.querySelector(${q(SUMMARY)});
    const t = (el) => el?.innerText?.replace(/\\s+/g, " ").trim() ?? null;
    const all = (sel) => [...root.querySelectorAll(sel)];
    return {
        heading: t(root.querySelector("[data-council-directions-heading]")),
        titles: all("[data-council-direction] [data-council-title]").map(t),
        steps: all("[data-council-direction] [data-council-first-step]").map(t),
        meta: all("[data-council-direction] [data-council-meta]").map(t),
        keptHeading: t(root.querySelector("[data-council-kept] h2")),
        kept: all("[data-council-kept-idea]").map((k) => ({
            title: t(k.querySelector("[data-council-title]")),
            meta: t(k.querySelector("[data-council-meta]")),
        })),
        jumps: all("[data-council-jump]").map((j) => j.dataset.councilJump).join(","),
        keptGrid: root.querySelector("[data-council-kept] [data-council-kept-idea]")?.parentElement
            ? getComputedStyle(root.querySelector("[data-council-kept] [data-council-kept-idea]").parentElement).display
            : null,
        keptBorder: root.querySelector("[data-council-kept-idea]")
            ? getComputedStyle(root.querySelector("[data-council-kept-idea]")).borderTopWidth
            : null,
        dropped: t(root.querySelector("[data-council-dropped]")),
        docpath: t(root.querySelector("[data-council-docpath]")),
        docSaved: !!root.querySelector("[data-council-doc-saved]"),
    };
})()`;

// the "Was this useful?" row under the report, and what it shows: its question or thanks line, its buttons as
// `rate=label`, and its Change link (null where it has none); null for the facts when the row is not drawn
const RATING = `${SUMMARY} [data-council-rating]`;
const RATING_THANKS = `${RATING} [data-council-rating-thanks]`;
const ratingFacts = (h) =>
    h.ev(`(() => {
        const row = document.querySelector(${q(RATING)});
        if (row == null) return null;
        const t = (el) => el?.innerText?.replace(/\\s+/g, " ").trim() ?? null;
        return {
            text: t(row.querySelector("[role='status']")),
            thanks: !!row.querySelector("[data-council-rating-thanks]"),
            buttons: [...row.querySelectorAll("[data-council-rate]")].map((b) => b.dataset.councilRate + "=" + t(b)),
            change: t(row.querySelector("[data-council-rating-change]")),
        };
    })()`);

const ASKS = { text: "Was this useful?", thanks: false, buttons: ["useful=Useful", "not=Not really"], change: null };
const THANKS = { text: "Thanks: this goes into the council benchmark", thanks: true, buttons: [], change: "Change" };

// the tabs of the workspace, to find what a click opened
async function tabIds(h, ctx) {
    const list = await h.rpc("workspacelist", null);
    return list.find((w) => w.workspacedata?.oid === ctx.workspaceId)?.workspacedata?.tabids ?? [];
}

export const councilSummary = {
    async arrange(h, fx) {
        const ctx = await arrangeCouncilProject(h, fx);
        try {
            ctx.councilId = await seedCouncil(h, ctx, "done");
            ctx.efforts = [];
        } catch (e) {
            await teardownCouncilProject(h, ctx).catch(() => {});
            throw e;
        }
        return ctx;
    },

    async assert(h, ctx) {
        const steps = [];
        const step = async (name, run) => {
            try {
                const r = await run();
                steps.push({ step: name, ok: r.ok === true, detail: r.detail });
            } catch (e) {
                steps.push({ step: name, ok: false, detail: String(e?.message ?? e) });
            }
        };
        await openSummary(h, ctx);

        await step("the cover: the title, the tabs and the ⋯ menu; the glance: the state, its figures and each expert with its model and what it did", async () => {
            const cover = await h.ev(`(() => {
                const root = document.querySelector(${q(SUMMARY)});
                const t = (s) => root.querySelector(s)?.innerText?.replace(/\\s+/g, " ").trim() ?? null;
                const bar = root.querySelector("[data-council-tabbar]");
                return {
                    title: t("h1"),
                    eyebrow: t("[data-council-cover] [data-council-eyebrow]"),
                    summaryTab: !!root.querySelector("[data-council-tab='summary'][aria-selected='true']"),
                    discussionTab: !!root.querySelector("[data-council-tab='discussion']"),
                    menu: !!root.querySelector("[data-council-cover] [data-council-menu]"),
                    state: t("[data-council-glance] [data-council-state]"),
                    facts: root.querySelector("[data-council-glance] [data-council-facts]")?.getAttribute("aria-label") ?? null,
                    inBar: !!bar?.querySelector("[data-council-expert], [data-council-state], [data-council-facts]"),
                    written: t("[data-council-written]"),
                    experts: [...root.querySelectorAll("[data-council-glance] [data-council-expert] [data-council-expert-who]")].map((e) => e.innerText.replace(/\\s+/g, " ").trim()),
                    ux: t("[data-council-expert='ux'] [data-council-expert-activity]"),
                    coordinator: t("[data-council-expert='coordinator'] [data-council-expert-activity]"),
                    uxButton: root.querySelector("[data-council-expert='ux']")?.tagName ?? null,
                    coordinatorButton: root.querySelector("[data-council-expert='coordinator']")?.tagName ?? null,
                    showDiscussion: !!root.querySelector("[data-council-action='discussion']"),
                };
            })()`);
            await h.shot("cdp-shots/council-summary-cover.png");
            const want = ["UX sonnet", "RAM sonnet", "New user sonnet", "Skeptic sonnet", "Coordinator opus"];
            const mode = loadCouncilFixture("done").mode === "brainstorm" ? "Brainstorm" : "Review";
            const ok =
                cover.title === "Rail apps" &&
                cover.eyebrow === `Council · ${mode}` &&
                cover.summaryTab &&
                cover.discussionTab &&
                cover.menu &&
                cover.state === "Done" &&
                /^4 experts · \d+ min · [\d.]+M tokens$/.test(cover.facts ?? "") &&
                !cover.inBar &&
                !cover.showDiscussion &&
                /^Written by the coordinator at \d\d:\d\d from 18 replies · 1 reply since$/.test(cover.written ?? "") &&
                cover.experts.length === want.length &&
                want.every((w, i) => cover.experts[i] === w) &&
                cover.ux === "2 ideas, 2 in the summary · 4 replies" &&
                cover.coordinator === "Wrote the summary" &&
                cover.uxButton === "BUTTON" &&
                cover.coordinatorButton === "DIV";
            return { ok, detail: JSON.stringify(cover) };
        });

        await step("the tab bar sticks and its jump links scroll the box", async () => {
            const BAR = `${SUMMARY} [data-council-tabbar]`;
            const BOX = `${SUMMARY} [data-council-scroll]`;
            const entries = await h.ev(`[...document.querySelectorAll(${q(`${BAR} [data-council-jump]`)})].map((e) => e.dataset.councilJump + ":" + e.innerText.replace(/\\s+/g, " ").trim())`);
            const sticky = await h.ev(`getComputedStyle(document.querySelector(${q(BAR)})).position`);
            // the matrix first: it unfolds under the cards, which gives the box the room to scroll as far as the
            // directions' link asks (folded, a report this short cannot scroll its bar into place). It is last in the box,
            // so its heading cannot land 12px under the bar: it only has to be in view.
            await click(h, `${BAR} [data-council-jump='matrix']`);
            const unfolded = await until(h, `document.querySelectorAll("#council-matrix tbody tr").length > 0`);
            await sleep(600);
            const matrix = await h.ev(`(() => {
                const box = document.querySelector(${q(BOX)});
                const bar = document.querySelector(${q(BAR)});
                const head = document.querySelector("[data-council-matrix-toggle]").getBoundingClientRect();
                return { head: Math.round(head.top), barBottom: Math.round(bar.getBoundingClientRect().bottom), boxBottom: Math.round(box.getBoundingClientRect().bottom) };
            })()`);
            await h.ev(`document.querySelector(${q(BOX)}).scrollTop = 0`);
            // where the directions' section would put the box's scrollTop: its top in the content, less the bar and 12px
            const expected = await h.ev(`(() => {
                const box = document.querySelector(${q(BOX)});
                const bar = document.querySelector(${q(BAR)});
                const el = box.querySelector("[data-council-directions-heading]") ?? box.querySelector("[data-council-direction]");
                const target = el.getBoundingClientRect().top - box.getBoundingClientRect().top + box.scrollTop - bar.offsetHeight - 12;
                return Math.max(0, Math.min(target, box.scrollHeight - box.clientHeight));
            })()`);
            await click(h, `${BAR} [data-council-jump='directions']`);
            await sleep(600);
            const placed = await h.ev(`(() => {
                const box = document.querySelector(${q(BOX)});
                const bar = document.querySelector(${q(BAR)});
                return { scrollTop: box.scrollTop, barTop: Math.round(bar.getBoundingClientRect().top), boxTop: Math.round(box.getBoundingClientRect().top) };
            })()`);
            // every card's chevron sits at its footer's right: its right edge on the card's content box (the card's rect
            // less its right padding) and its bottom on the footer's bottom, 2px of slack for the rounding
            const chevrons = await h.ev(`[...document.querySelectorAll(${q(SUMMARY)} + " [data-council-direction]")].map((card) => {
                const cr = card.getBoundingClientRect();
                const pad = parseFloat(getComputedStyle(card).paddingRight);
                const chev = card.querySelector("[data-council-direction-chevron]")?.getBoundingClientRect();
                const foot = card.querySelector("[data-council-direction-footer]")?.getBoundingClientRect();
                return chev && foot
                    ? { rank: card.dataset.councilDirection, right: Math.round((cr.right - pad - chev.right) * 10) / 10, bottom: Math.round((foot.bottom - chev.bottom) * 10) / 10 }
                    : { rank: card.dataset.councilDirection, missing: true };
            })`);
            const chevronsOk =
                chevrons.length > 0 && chevrons.every((c) => !c.missing && Math.abs(c.right) <= 2 && Math.abs(c.bottom) <= 2);
            await h.shot("cdp-shots/council-summary-outline.png");
            // fold the matrix again for the steps after
            await click(h, "[data-council-matrix-toggle]");
            await h.ev(`document.querySelector(${q(BOX)}).scrollTop = 0`);
            const ok =
                entries.join("|") === ["directions:Directions 4", "matrix:Every expert on every idea 6"].join("|") &&
                sticky === "sticky" &&
                Math.abs(placed.scrollTop - expected) <= 4 &&
                placed.barTop === placed.boxTop &&
                unfolded &&
                matrix.head >= matrix.barBottom &&
                matrix.head < matrix.boxBottom &&
                chevronsOk;
            return { ok, detail: JSON.stringify({ entries, sticky, expected, placed, matrix, chevrons }) };
        });

        await step("a seat in the glance opens the Discussion's list on the ideas it wrote or replied to (its filter on), a row opens that idea's thread with the seat's reply in it, and Everyone brings the rest back", async () => {
            await click(h, `${SUMMARY} [data-council-glance] [data-council-expert='ux']`);
            const shown = await until(h, `!!document.querySelector("[data-council-only='ux']")`);
            const only = await h.ev(`({
                // UX wrote P1 and P2 and replied to the other four, so every idea keeps its row, in the Report's order
                ideas: [...document.querySelectorAll("[data-council-list] [data-council-idea]")].map((e) => e.dataset.councilIdea),
                bar: document.querySelector("[data-council-only]")?.innerText.replace(/\\s+/g, " ").trim() ?? null,
                // the button: the Agent tree's council row and Setup's seat list carry data-council-seats too
                pressed: document.querySelector("button[data-council-seats]")?.getAttribute("data-only") ?? null,
            })`);
            await h.shot("cdp-shots/council-discussion-only.png");
            await click(h, "[data-council-list] [data-council-thread-open='P3']");
            // P3 is RAM's idea; UX's reply on it (r7) is in its thread, not in the list
            const thread = await until(
                h,
                `!!document.querySelector("[data-council-thread='P3'] [data-council-post='P3']") && !!document.querySelector("[data-council-thread='P3'] [data-council-reply-post='r7']")`
            );
            const inList = await exists(h, "[data-council-list] [data-council-reply-post]");
            await click(h, "[data-council-action='show-everyone']");
            const all = await until(h, `!document.querySelector("[data-council-only]") && document.querySelectorAll("[data-council-list] [data-council-idea]").length === 6`);
            await openSummary(h, ctx);
            const ok =
                shown &&
                only.ideas.join("|") === "P5|P1|P2|P3|P4|P6" &&
                only.bar === "Only UX: 2 ideas and 4 replies" &&
                only.pressed === "ux" &&
                thread &&
                !inList &&
                all;
            return { ok, detail: JSON.stringify({ shown, only, thread, inList, all }) };
        });

        await step("the Discussion tab opens the Discussion", async () => {
            await click(h, "[data-council-tab='discussion']");
            const shown = await until(h, `!!document.querySelector("[data-council-discussion]")`);
            await openSummary(h, ctx);
            return { ok: shown, detail: shown ? "the Discussion showed" : "[data-council-discussion] did not show" };
        });

        await step("a finished council opened from its tree row lands on the Summary, asking what was asked and opening on the first sentence", async () => {
            // a council never shown opens on its report from the tree (one left on its Discussion reopens there, reopenView),
            // so this one is seeded fresh: the council of the steps above was left on a view by every one of them
            const fresh = await seedCouncil(h, ctx, "done", { id: "fx-council-fresh" });
            await openCouncil(h, ctx.councilId, "discussion");
            const row = `[data-council-row="${fresh}"]`;
            const rowShown = await until(h, `!!document.querySelector(${q(row)})`);
            await click(h, row);
            const landed = await until(h, `document.querySelector(${q(SUMMARY)})?.dataset.councilId === ${q(fresh)}`);
            await until(h, `!!document.querySelector(${q(`${SUMMARY} [data-council-answer]`)})`);
            const asked = await textOf(h, `${SUMMARY} [data-council-asked]`);
            const answer = await h.ev(`(() => {
                const el = document.querySelector(${q(`${SUMMARY} [data-council-answer]`)});
                return el == null ? null : { text: el.innerText.replace(/\\s+/g, " ").trim(), weight: Number(getComputedStyle(el).fontWeight) };
            })()`);
            const ok =
                rowShown &&
                landed &&
                /^You asked Which changes to pinned apps/.test(asked ?? "") &&
                answer?.text === FIRST_SENTENCE &&
                answer.weight >= 600;
            return { ok, detail: JSON.stringify({ rowShown, landed, asked, answer, want: FIRST_SENTENCE }) };
        });

        await step("a council with an answer opens on it in bold, with the whole summary text under it", async () => {
            const answer = "Do the pins first: they are cheap and nobody objects.";
            const id = await seedCouncil(h, ctx, "done", {
                id: "fx-council-answered",
                edit: (c) => {
                    c.summary.answer = answer;
                },
            });
            await openCouncil(h, id, "summary");
            const shown = await until(h, `document.querySelector(${q(`${SUMMARY} [data-council-answer]`)})?.innerText === ${q(answer)}`);
            const rest = await textOf(h, `${SUMMARY} [data-council-summary-text]`);
            const full = loadCouncilFixture("done").summary.text.replace(/\s+/g, " ").trim();
            await openSummary(h, ctx);
            return { ok: shown && rest === full, detail: JSON.stringify({ shown, rest }) };
        });

        await step("a council without a question shows no You asked line", async () => {
            const id = await seedCouncil(h, ctx, "done", {
                id: "fx-council-noquestion",
                edit: (c) => {
                    delete c.question;
                },
            });
            await openCouncil(h, id, "summary");
            const drawn = await until(h, `document.querySelector(${q(`${SUMMARY} [data-council-answer]`)})?.innerText === ${q(FIRST_SENTENCE)}`);
            const asked = await exists(h, `${SUMMARY} [data-council-asked]`);
            const text = await h.ev(`document.querySelector(${q(SUMMARY)}).innerText`);
            await openSummary(h, ctx);
            return { ok: drawn && !asked && !/You asked/.test(text), detail: JSON.stringify({ drawn, asked }) };
        });

        await step("no proposal id shows anywhere in the Summary's text, directions closed and the matrix folded", async () => {
            const text = await h.ev(`document.querySelector(${q(SUMMARY)}).innerText`);
            const ids = text.match(/\bP\d+\b/g) ?? [];
            return { ok: ids.length === 0 && text.length > 0, detail: JSON.stringify({ ids }) };
        });

        await step("four directions in rank order, each tagged in words, each with a stance chip per expert", async () => {
            const dirs = await h.ev(`[...document.querySelectorAll(${q(`${SUMMARY} [data-council-direction]`)})].map((d) => ({
                rank: d.dataset.councilDirection,
                title: d.querySelector("[data-council-title]")?.innerText ?? null,
                tag: d.querySelector("[data-council-tag]")?.innerText ?? null,
                chips: d.querySelectorAll("[data-council-chip]").length,
                open: d.getAttribute("aria-expanded"),
            }))`);
            const ok =
                dirs.length === 4 &&
                dirs.every((d, i) => d.rank === String(i + 1) && d.title === TITLES[i] && d.chips === 4 && d.open === "false") &&
                dirs.map((d) => d.tag).join("|") ===
                    "Everyone agrees|Skeptic has doubts|RAM is against it|Skeptic is against it";
            return { ok, detail: JSON.stringify(dirs.map((d) => [d.rank, d.tag, d.chips, d.open])) };
        });

        await step("direction 3 opens to its reasoning, each expert's position, a weak chip and Start an agent on it", async () => {
            await openDirection(h, 3);
            const open = await h.ev(`(() => {
                const d = document.querySelector(${q(DIRECTION(3))});
                const body = document.querySelector(${q(DETAIL(3))});
                return {
                    expanded: d.getAttribute("aria-expanded"),
                    controls: d.getAttribute("aria-controls") === body.id,
                    underGrid: !d.contains(body),
                    heading: body.firstElementChild?.innerText ?? null,
                    reasoning: body.querySelector("[data-council-reasoning]")?.innerText ?? null,
                    positions: [...body.querySelectorAll("[data-council-position]")].map((p) => p.dataset.councilPosition),
                    weak: [...body.querySelectorAll('[data-council-evidence="weak"]')].map((e) => e.innerText.trim()),
                    refs: [...body.querySelectorAll('[data-council-evidence="ref"]')].map((e) => e.innerText.trim()),
                    brainstorm: body.querySelector('[data-council-action="brainstorm"]')?.innerText ?? null,
                    askAgain: body.querySelector('[data-council-action="ask-again"]')?.innerText ?? null,
                    meta: d.querySelector("[data-council-meta]")?.innerText ?? null,
                    chips: Object.fromEntries([...d.querySelectorAll("[data-council-chip]")].map((c) => [c.dataset.councilChip, c.innerText.replace(/\\s+/g, " ").trim()])),
                };
            })()`);
            // a click on card 1 opens it and closes 3: one detail under the grid
            await openDirection(h, 1);
            const swapped = await until(h, `document.querySelectorAll(${q(`${SUMMARY} [data-council-direction-body]`)}).length === 1 && !document.querySelector(${q(DETAIL(3))})`);
            const one = await h.ev(`({
                one: document.querySelector(${q(DIRECTION(1))}).getAttribute("aria-expanded"),
                three: document.querySelector(${q(DIRECTION(3))}).getAttribute("aria-expanded"),
            })`);
            // frame the shot on the open card and the top of its detail: card 1's row goes just under the sticky bar;
            // if the detail's top is still below the box, the detail is centred instead
            const FRAME = `(() => {
                const box = document.querySelector(${q(`${SUMMARY} [data-council-scroll]`)});
                const bar = document.querySelector(${q(`${SUMMARY} [data-council-tabbar]`)});
                const card = document.querySelector(${q(DIRECTION(1))});
                const detail = document.querySelector(${q(DETAIL(1))});
                const before = box.scrollTop;
                box.scrollTop += card.getBoundingClientRect().top - box.getBoundingClientRect().top - bar.offsetHeight - 12;
                if (detail.getBoundingClientRect().top >= box.getBoundingClientRect().bottom - 40) {
                    detail.scrollIntoView({ block: "center" });
                }
                const br = box.getBoundingClientRect();
                const top = detail.getBoundingClientRect().top;
                return { before, top: Math.round(top), barBottom: Math.round(bar.getBoundingClientRect().bottom), boxBottom: Math.round(br.bottom) };
            })()`;
            const framed = await h.ev(FRAME);
            await sleep(300);
            const framedAfter = await h.ev(`(() => {
                const bar = document.querySelector(${q(`${SUMMARY} [data-council-tabbar]`)});
                const box = document.querySelector(${q(`${SUMMARY} [data-council-scroll]`)});
                return {
                    top: Math.round(document.querySelector(${q(DETAIL(1))}).getBoundingClientRect().top),
                    barBottom: Math.round(bar.getBoundingClientRect().bottom),
                    boxBottom: Math.round(box.getBoundingClientRect().bottom),
                };
            })()`);
            const detailInFrame = framedAfter.top >= framedAfter.barBottom && framedAfter.top < framedAfter.boxBottom;
            await h.shot("cdp-shots/council-summary-open-card.png");
            await h.ev(`document.querySelector(${q(`${SUMMARY} [data-council-scroll]`)}).scrollTop = ${Number(framed.before)}`);
            // reopen 3 for the checks that follow, then it closes 1
            await openDirection(h, 3);
            const ok =
                open.expanded === "true" &&
                open.controls &&
                open.underGrid &&
                swapped &&
                one.one === "true" &&
                one.three === "false" &&
                /Idea 3/.test(open.heading ?? "") &&
                /P2 and P3 meet in one step/.test(open.reasoning ?? "") &&
                open.positions.join() === "ux,ram,newuser,skeptic" &&
                open.weak.length === 1 &&
                open.weak[0] === 'Weak · "about 3 s" has no measurement' &&
                open.refs.includes("pkg/services/model.go:36") &&
                open.brainstorm === "Start an agent on it" &&
                open.askAgain === "Ask the experts again" &&
                open.meta === "from UX and RAM · 1 file · 1 weak claim" &&
                // the chip's text starts with the expert's avatar letter
                open.chips.ram.endsWith(" Is against it") &&
                open.chips.skeptic.endsWith(" Has doubts") &&
                open.chips.newuser.endsWith(" Agrees") &&
                open.chips.ux.endsWith(" Proposed") &&
                detailInFrame;
            await h.shot("cdp-shots/council-summary.png");
            return { ok, detail: JSON.stringify({ open, swapped, one, framedAfter }) };
        });

        await step("Ask next lists the report's three questions with whom each is for, and a click opens the Discussion with it in the box", async () => {
            await openSummary(h, ctx);
            const rows = await h.ev(
                `[...document.querySelectorAll(${q(`${SUMMARY} [data-council-summary-ask]`)})].map((b) => b.innerText.replace(/\\s+/g, " ").trim())`
            );
            const tiles = await h.ev(`getComputedStyle(document.querySelector(${q(`${SUMMARY} [data-council-summary-ask]`)}).parentElement).display`);
            await h.ev(`document.querySelector(${q(`${SUMMARY} [data-council-asks-next]`)}).scrollIntoView({ block: "center" })`);
            await h.shot("cdp-shots/council-summary-asknext.png");
            await click(h, `${SUMMARY} [data-council-summary-ask="1"]`);
            const box = q('[data-council-composer="channel"] [data-council-composer-input]');
            const opened = await until(h, `document.querySelector(${box})?.value?.startsWith("@")`);
            const filled = await h.ev(`document.querySelector(${box})?.value ?? ""`);
            // back on the Summary for the steps after, the box emptied again
            await h.ev(`(() => {
                const el = document.querySelector(${box});
                if (!el) return;
                Object.getOwnPropertyDescriptor(Object.getPrototypeOf(el), "value").set.call(el, "");
                el.dispatchEvent(new Event("input", { bubbles: true }));
            })()`);
            await openSummary(h, ctx);
            const ok =
                rows.length === 3 &&
                rows[0].endsWith("To RAM") &&
                rows[2].endsWith("To everyone") &&
                tiles === "grid" &&
                opened &&
                filled.endsWith("Would a new user find the pin hint without being told?");
            return { ok, detail: JSON.stringify({ rows, tiles, filled }) };
        });

        await step("the matrix is folded under Every expert on every idea, and unfolds to six rows by idea title, Withdrawn on the sixth", async () => {
            const toggle = "[data-council-matrix-toggle]";
            const label = await textOf(h, toggle);
            const foldedRows = await h.ev(`document.querySelectorAll("#council-matrix tbody tr").length`);
            const before = await h.ev(`document.querySelector(${q(toggle)})?.getAttribute("aria-expanded")`);
            await click(h, toggle);
            const unfolded = await until(h, `document.querySelectorAll("#council-matrix tbody tr").length === 6`);
            const rows = await h.ev(`[...document.querySelectorAll("#council-matrix tbody tr")].map((r) => ({
                id: r.dataset.councilMatrixRow,
                first: r.querySelector("td")?.innerText?.replace(/\\s+/g, " ").trim() ?? null,
                text: r.innerText,
                outcome: r.querySelector("[data-council-matrix-outcome]")?.innerText?.trim() ?? null,
                cells: r.querySelectorAll("[data-council-matrix-cell]").length,
            }))`);
            await h.ev(`document.getElementById("council-matrix").scrollIntoView({ block: "start" })`);
            await h.shot("cdp-shots/council-summary-matrix.png");
            const ok =
                label?.startsWith("Every expert on every idea") &&
                foldedRows === 0 &&
                before === "false" &&
                unfolded &&
                rows.map((r) => r.id).join() === "P5,P1,P2,P3,P4,P6" &&
                rows.every((r) => r.cells === 4 && !/\bP\d+\b/.test(r.text)) &&
                rows.find((r) => r.id === "P6")?.first?.startsWith("Drop the cap of 3 apps") &&
                rows.find((r) => r.id === "P6")?.outcome === "Withdrawn";
            return { ok, detail: JSON.stringify({ label, foldedRows, before, rows: rows.map((r) => [r.id, r.first?.slice(0, 40), r.outcome]) }) };
        });

        // the fixture's one reply after the summary is the person's own (r19): that leaves the summary current
        await step("a plain reply after the summary shows no Outdated banner, only `· 1 reply since` on the Written by line", async () => {
            const facts = await h.ev(`({
                banner: !!document.querySelector("[data-council-banner='outdated']"),
                again: !!document.querySelector("[data-council-action='summarize-again']"),
                written: document.querySelector(${q(`${SUMMARY} [data-council-written]`)})?.innerText?.replace(/\\s+/g, " ").trim() ?? null,
            })`);
            const ok = !facts.banner && !facts.again && / · 1 reply since$/.test(facts.written ?? "");
            return { ok, detail: JSON.stringify(facts) };
        });

        // a new idea and a changed stance posted after the summary: RAM's P7, and RAM turning from Agrees to Is against
        // it on P1 (r1, before the summary)
        await step("a new idea and a changed stance after the summary show the banner Outdated · 1 new idea, 1 changed stance, and Summarize again (stubbed) records one summarize call", async () => {
            const outdated = await seedCouncil(h, ctx, "done", {
                id: "fx-council-outdated",
                edit: (c) => {
                    const at = c.summary.at;
                    c.proposals.push({
                        id: "P7",
                        author: "ram",
                        title: "Keep the pins in the workspace file",
                        argument: "A workspace already saves its layout; the pins are layout.",
                        ts: at + 60_000,
                    });
                    c.replies.push({
                        id: "r20",
                        proposalid: "P1",
                        author: "ram",
                        stance: "oppose",
                        text: "On a second look a settings write per pin is too many writes.",
                        round: 4,
                        ts: at + 90_000,
                    });
                },
            });
            await stubRpc(h, ["CouncilSummarizeCommand"]);
            await openSummary(h, ctx, outdated);
            const shown = await until(h, `!!document.querySelector("[data-council-banner='outdated']")`);
            const banner = await textOf(h, "[data-council-banner='outdated']");
            const written = await textOf(h, `${SUMMARY} [data-council-written]`);
            await h.shot("cdp-shots/council-summary-outdated.png");
            const clicked = await click(h, "[data-council-action='summarize-again']");
            await callSeen(h, "CouncilSummarizeCommand", () => true);
            const calls = await rpcCalls(h, "CouncilSummarizeCommand");
            await openSummary(h, ctx);
            const ok =
                shown &&
                banner === "Outdated · 1 new idea, 1 changed stance" &&
                // the banner speaks for the summary now: the Written by line says nothing about the replies since
                /from 18 replies$/.test(written ?? "") &&
                clicked &&
                calls.length === 1 &&
                calls[0].data?.id === outdated;
            return { ok, detail: JSON.stringify({ banner, written, clicked, calls }) };
        });

        await step("Save as doc (in the ⋯ menu) writes the doc into the project and shows its path", async () => {
            await menuClick(h, "save-doc");
            // the save keeps the path on the council (docpath), and the report's saved line shows it
            const shown = await until(h, `!!document.querySelector("[data-council-docpath]")`);
            const saved = await h.ev(`(() => {
                const el = document.querySelector("[data-council-docpath]");
                return el == null ? null : { path: el.dataset.path, text: el.innerText.replace(/\\s+/g, " ").trim() };
            })()`);
            // a path relative to the project is the project's file
            const asKept = saved?.path ?? "";
            const path = asKept === "" || isAbsolute(asKept) ? asKept : join(ctx.repo, asKept);
            const inProject = slashes(path).startsWith(`${slashes(ctx.repo)}/docs/council/`);
            const body = shown && path !== "" && existsSync(path) ? readFileSync(path, "utf8") : "";
            // the report, then the whole discussion and the run facts (council.Document)
            const sections = ["# Council: Rail apps", "## Matrix", "## The discussion", "## Run facts"].filter((s) => !body.includes(s));
            // now that it has saved, the menu opens the document instead of saving another
            const items = shown ? await menuItems(h) : [];
            const ok =
                shown &&
                inProject &&
                /\.md$/.test(path) &&
                body !== "" &&
                sections.length === 0 &&
                /docs\/council\/.+\.md/.test(saved.text) &&
                items.includes("open-doc=Open the document") &&
                !items.some((i) => i.startsWith("save-doc="));
            return { ok, detail: JSON.stringify({ saved, exists: path !== "" && existsSync(path), missing: sections, items }) };
        });

        await step("Create initiative (in the ⋯ menu) makes an initiative named after the feature with a chunk per direction", async () => {
            await menuClick(h, "initiative");
            const shown = await until(h, `!!document.querySelector("[data-council-initiative-made]")`);
            const oid = shown ? await h.ev(`document.querySelector("[data-council-initiative-made]").dataset.effortOid`) : null;
            if (oid) ctx.efforts.push(oid);
            const effort = oid ? (await h.rpc("effortget", { effortoid: oid })).effort : null;
            const labels = (effort?.chunks ?? []).map((c) => c.label);
            const ok = effort != null && effort.title === "Rail apps" && effort.project === ctx.project && labels.join("|") === TITLES.join("|");
            return { ok, detail: JSON.stringify({ oid, title: effort?.title, project: effort?.project, labels }) };
        });

        await step("Run again (in the ⋯ menu) opens Setup with the feature, files and experts of the council", async () => {
            // Setup may ask for roles when it shows a feature and a file: never for real
            await stubRpc(h, ["CouncilSuggestCommand", "CouncilStartCommand"], {
                CouncilSuggestCommand: { value: { files: [], roles: [], group: "" } },
            });
            await menuClick(h, "run-again");
            const shown = await until(h, `!!document.querySelector("[data-council-setup]")`);
            // the text of the form and what its inputs hold
            const form = shown
                ? await h.ev(`(() => {
                      const root = document.querySelector("[data-council-setup]");
                      const fields = [...root.querySelectorAll("input, textarea")].map((e) => e.value);
                      return [root.innerText, ...fields].join("\\n");
                  })()`)
                : "";
            const wants = ["Rail apps", "railapps.ts", "railappsstore.ts", "model.go", "UX", "RAM", "New user", "Skeptic"];
            const missing = wants.filter((w) => !form.includes(w));
            await openSummary(h, ctx);
            return { ok: shown && missing.length === 0, detail: shown ? `missing: ${JSON.stringify(missing)}` : "[data-council-setup] did not show" };
        });

        // Summarize on the Discussion returns once the run has launched, so the Summary opens on a council that is running
        // at round 3: with the old summary it says so in a banner, with none it says the coordinator is writing it
        await step("a council synthesizing again keeps its old summary under an Updating banner, or says it is being written", async () => {
            const edited = (id, edit) => seedCouncil(h, ctx, "done", { id, edit });
            const again = await edited("fx-council-resumming", (c) => {
                c.state = "running";
                c.round = 3;
                c.activity = { coordinator: { text: "Writing the summary" } };
            });
            await openCouncil(h, again, "summary");
            const bannerShown = await until(h, `!!document.querySelector("[data-council-banner='running']")`);
            // it is re-summarizing over the old summary, so there is no report to rate yet
            const ratingWhileRunning = await exists(h, RATING);
            const withOld = await h.ev(`({
                banner: document.querySelector("[data-council-banner='running']")?.innerText ?? null,
                outdated: !!document.querySelector("[data-council-banner='outdated']"),
                directions: document.querySelectorAll("[data-council-summary] [data-council-direction]").length,
            })`);
            const none = await edited("fx-council-writing", (c) => {
                c.state = "running";
                c.round = 3;
                c.activity = { coordinator: { text: "Writing the summary" } };
                delete c.summary;
            });
            await openCouncil(h, none, "summary");
            const writingShown = await until(h, `!!document.querySelector("[data-council-nosummary]")`);
            const writing = await textOf(h, "[data-council-nosummary]");
            const ratingWithoutSummary = await exists(h, RATING);
            // the cover still draws: NoSummary in its answer slot, the glance, the Report tab selected, no jump links
            const cover = await h.ev(`({
                inCover: !!document.querySelector("[data-council-cover] [data-council-nosummary]"),
                state: !!document.querySelector("[data-council-glance] [data-council-state]"),
                tab: !!document.querySelector("[data-council-tab='summary'][aria-selected='true']"),
                jumps: document.querySelectorAll("[data-council-jump]").length,
            })`);
            await openSummary(h, ctx);
            const ok =
                bannerShown &&
                withOld.banner === "Updating the summary…" &&
                !withOld.outdated &&
                withOld.directions === 4 &&
                writingShown &&
                writing === "The coordinator is writing the summary…" &&
                !ratingWhileRunning &&
                !ratingWithoutSummary &&
                cover.inCover &&
                cover.state &&
                cover.tab &&
                cover.jumps === 0;
            return { ok, detail: JSON.stringify({ withOld, writing, ratingWhileRunning, ratingWithoutSummary, cover }) };
        });

        // after a failed synthesis the council is failed with the old summary kept: Retry reruns the coordinator's call
        await step("a failed synthesis keeps the old summary, with the error and Retry on the coordinator", async () => {
            const failed = await seedCouncil(h, ctx, "done", {
                id: "fx-council-synthfailed",
                edit: (c) => {
                    c.state = "failed";
                    c.failed = { coordinator: { round: 3, error: "the model was overloaded" } };
                    c.error = "the coordinator failed in round 3";
                },
            });
            await stubRpc(h, ["CouncilRetryCommand"]);
            await openCouncil(h, failed, "summary");
            const shown = await until(h, `!!document.querySelector("[data-council-banner='failed']")`);
            const banner = await textOf(h, "[data-council-banner='failed']");
            const directions = await h.ev(`document.querySelectorAll("[data-council-summary] [data-council-direction]").length`);
            // a failed council has no report to rate
            const rating = await exists(h, RATING);
            const clicked = await click(h, "[data-council-action='retry']");
            await callSeen(h, "CouncilRetryCommand", () => true);
            // Retry with… beside it: a menu of the other models, the coordinator's own (opus) left out; a pick retries once
            // on that model
            const withClicked = await mouseClick(h, "[data-council-retry-with='coordinator']");
            const menuShown = await until(h, `!!document.querySelector('[data-menu-item="Retry on sonnet"]')`);
            const menu = await h.ev(`[...document.querySelectorAll("[data-menu-item]")].map((el) => el.dataset.menuItem)`);
            await h.shot("cdp-shots/council-summary-retry-with.png");
            const picked = await mouseClick(h, '[data-menu-item="Retry on sonnet"]');
            await callSeen(h, "CouncilRetryCommand", (c) => c.data?.model === "sonnet");
            const calls = await rpcCalls(h, "CouncilRetryCommand");
            await openSummary(h, ctx);
            const ok =
                shown &&
                banner === "The coordinator failed: the model was overloaded" &&
                directions === 4 &&
                !rating &&
                clicked &&
                withClicked &&
                menuShown &&
                menu.includes("Retry on fable") &&
                !menu.includes("Retry on opus") &&
                picked &&
                calls.length === 2 &&
                calls[0].data?.id === failed &&
                calls[0].data?.expertid === "coordinator" &&
                calls[0].data?.model === undefined &&
                calls[1].data?.id === failed &&
                calls[1].data?.expertid === "coordinator" &&
                calls[1].data?.model === "sonnet";
            return { ok, detail: JSON.stringify({ banner, directions, rating, menu, calls }) };
        });

        // "Was this useful?" (docs/superpowers/specs/2026-10-22-council-agent-team-design.md, Storage). CouncilRateCommand is replaced, so
        // nothing reaches the data dir's council-bench.jsonl and no click rates a real council; the page puts the rating on
        // the council from what it sent, and nothing here announces council:changed (a reload would drop the stubbed rating)
        await step("Was this useful? asks under the report with Useful and Not really; Useful records one rating and thanks, and Change asks again for the other", async () => {
            await stubRpc(h, ["CouncilRateCommand"]);
            const id = await seedCouncil(h, ctx, "done", { id: "fx-council-rate" });
            await openSummary(h, ctx, id);
            const shown = await until(h, `!!document.querySelector(${q(RATING)})`);
            const unrated = await ratingFacts(h);
            await h.ev(`document.querySelector(${q(RATING)})?.scrollIntoView({ block: "center" })`);
            await h.shot("cdp-shots/council-summary-rating.png");

            await click(h, `${RATING} [data-council-rate="useful"]`);
            const usefulSent = await callSeen(h, "CouncilRateCommand", (c) => c.data?.rating === "useful");
            const thanked = await until(h, `!!document.querySelector(${q(RATING_THANKS)})`);
            const afterUseful = await ratingFacts(h);
            await h.shot("cdp-shots/council-summary-rating-thanks.png");

            await click(h, `${RATING} [data-council-rating-change]`);
            const asked = await until(h, `!!document.querySelector(${q(`${RATING} [data-council-rate="not"]`)})`);
            const again = await ratingFacts(h);
            await click(h, `${RATING} [data-council-rate="not"]`);
            const notSent = await callSeen(h, "CouncilRateCommand", (c) => c.data?.rating === "not");
            const thankedAgain = await until(h, `!!document.querySelector(${q(RATING_THANKS)})`);
            const afterNot = await ratingFacts(h);
            const calls = (await rpcCalls(h, "CouncilRateCommand")).map((c) => c.data);
            await openSummary(h, ctx);
            const ok =
                shown &&
                JSON.stringify(unrated) === JSON.stringify(ASKS) &&
                usefulSent &&
                thanked &&
                JSON.stringify(afterUseful) === JSON.stringify(THANKS) &&
                asked &&
                JSON.stringify(again) === JSON.stringify(ASKS) &&
                notSent &&
                thankedAgain &&
                JSON.stringify(afterNot) === JSON.stringify(THANKS) &&
                JSON.stringify(calls) === JSON.stringify([{ id, rating: "useful" }, { id, rating: "not" }]);
            return { ok, detail: JSON.stringify({ unrated, afterUseful, again, afterNot, calls }) };
        });

        await step("a council already rated shows the thanks line at once; a stopped one with a summary shows the row; a benchmark council shows none", async () => {
            const rated = await seedCouncil(h, ctx, "done", {
                id: "fx-council-rated",
                edit: (c) => {
                    c.rating = "useful";
                    c.ratedat = Date.now();
                },
            });
            await openSummary(h, ctx, rated);
            const ratedShown = await until(h, `!!document.querySelector(${q(RATING_THANKS)})`);
            const ratedFacts = await ratingFacts(h);

            const stopped = await seedCouncil(h, ctx, "done", {
                id: "fx-council-rate-stopped",
                edit: (c) => {
                    c.state = "stopped";
                },
            });
            await openSummary(h, ctx, stopped);
            const stoppedShown = await until(h, `!!document.querySelector(${q(RATING)})`);
            const stoppedFacts = await ratingFacts(h);

            // a benchmark council is out of the cockpit's list, but one opened by id must still not ask
            const bench = await seedCouncil(h, ctx, "done", {
                id: "fx-council-rate-bench",
                edit: (c) => {
                    c.bench = true;
                },
            });
            await openSummary(h, ctx, bench);
            const benchRating = await exists(h, RATING);
            await openSummary(h, ctx);
            const ok =
                ratedShown &&
                JSON.stringify(ratedFacts) === JSON.stringify(THANKS) &&
                stoppedShown &&
                JSON.stringify(stoppedFacts) === JSON.stringify(ASKS) &&
                !benchRating;
            return { ok, detail: JSON.stringify({ ratedFacts, stoppedFacts, benchRating }) };
        });

        await step("Ask the experts again on direction 1 opens the Discussion with that idea's thread open", async () => {
            await openDirection(h, 1);
            const before = await h.ev(`window.__arcCouncil.openProposal(${q(ctx.councilId)})`);
            await click(h, `${DETAIL(1)} [data-council-action='ask-again']`);
            const shown = await until(h, `!!document.querySelector("[data-council-discussion]")`);
            const open = await h.ev(`window.__arcCouncil.openProposal(${q(ctx.councilId)})`);
            // the Discussion opens that idea's thread: its panel carries the idea on top, and the list marks its row open
            const post = await until(
                h,
                `!!document.querySelector("[data-council-discussion] [data-council-thread='P5'] [data-council-post='P5']") && document.querySelector("[data-council-list] [data-council-idea='P5']")?.getAttribute("data-open") === "true"`
            );
            await openSummary(h, ctx);
            return { ok: shown && open === "P5" && post, detail: JSON.stringify({ shown, before, open, post }) };
        });

        await step("Start an agent on it (the launch stubbed) records a prompt with the direction and its ideas by title, and opens no agent", async () => {
            await stubRpc(h, ["SetMetaCommand", "AgentSyncApplyCommand"]);
            await openDirection(h, 3);
            const tabsBefore = new Set(await tabIds(h, ctx));
            const clicked = await click(h, `${DETAIL(3)} [data-council-action='brainstorm']`);
            // the launch writes the block's meta, then the tab's
            const wrote = await callSeen(h, "SetMetaCommand", (c) => String(c.data?.oref).startsWith("tab:"), 15_000);
            // whatever tab the click made goes at teardown, however far the launch got
            for (const tabId of await tabIds(h, ctx)) {
                if (!tabsBefore.has(tabId)) ctx.terminals.push({ tabId });
            }
            const calls = await rpcCalls(h, "SetMetaCommand");
            const launch = calls.find((c) => Array.isArray(c.data?.meta?.["cmd:args"]));
            const prompt = String(launch?.data?.meta?.["cmd:args"]?.[0] ?? "");
            const ok =
                clicked &&
                wrote &&
                launch?.data?.meta?.cmd === "claude" &&
                slashes(launch.data.meta["cmd:cwd"]) === slashes(ctx.repo) &&
                prompt.includes(TITLES[2]) &&
                prompt.includes("Start brainstorming it with me.") &&
                prompt.includes('"Keep the last-used pinned app awake" by UX') &&
                (await rpcCalls(h, "AgentSyncApplyCommand")).length >= 1;
            return { ok, detail: JSON.stringify({ clicked, wrote, cmd: launch?.data?.meta?.cmd, cwd: launch?.data?.meta?.["cmd:cwd"], prompt: prompt.slice(0, 160) }) };
        });

        // The done fixture as a Brainstorm: its fourth direction becomes a wild idea kept aside, the other three carry a first
        // step, New user builds on the Skeptic's idea (direction 1), and the Skeptic's other idea (P6) is in no direction and
        // not kept. Its document was saved into the project, so the `⋯` menu opens it instead of saving one.
        const DOC_REL = "docs/council/2026-10-22-x.md";
        await step("a Brainstorm report heads three ideas worth trying, each with a first step and who had and built on it, keeps the wild idea aside, counts the rest, says where it saved itself, and opens that document in Code", async () => {
            await h.goto("agent");
            const doc = join(ctx.repo, ...DOC_REL.split("/"));
            mkdirSync(dirname(doc), { recursive: true });
            writeFileSync(doc, "# Council: Rail apps\n\nA brainstorm, saved with its whole discussion.\n");
            const id = await seedCouncil(h, ctx, "done", {
                id: "fx-council-brainstorm",
                edit: (c) => {
                    const ds = c.summary.directions;
                    c.mode = "brainstorm";
                    c.summary.kept = [{ ...ds[3], rank: 1 }];
                    c.summary.directions = ds.slice(0, 3).map((d) => ({ ...d, firststep: "Try it on one screen" }));
                    const prior = c.replies.find((r) => r.id === "r15");
                    c.replies.push({
                        id: "rb1",
                        proposalid: "P5",
                        author: "newuser",
                        text: "and the pin could carry the hint too",
                        round: 2,
                        ts: prior.ts + 1000,
                        builds: true,
                    });
                    c.docpath = doc;
                },
            });
            await openBrainstormSummary(h, id);
            const facts = await h.ev(BRAINSTORM_FACTS);
            // frame the shot on the cards: the directions heading goes just under the sticky bar, so the First step
            // boxes are in view
            const stepsInFrame = await h.ev(`(() => {
                const box = document.querySelector(${q(`${SUMMARY} [data-council-scroll]`)});
                const bar = document.querySelector(${q(`${SUMMARY} [data-council-tabbar]`)});
                const head = document.querySelector(${q(`${SUMMARY} [data-council-directions-heading]`)});
                box.scrollTop += head.getBoundingClientRect().top - box.getBoundingClientRect().top - bar.offsetHeight - 12;
                const br = box.getBoundingClientRect();
                const bb = bar.getBoundingClientRect().bottom;
                return [...document.querySelectorAll(${q(`${SUMMARY} [data-council-first-step]`)})].some((s) => {
                    const r = s.getBoundingClientRect();
                    return r.top >= bb && r.bottom <= br.bottom;
                });
            })()`);
            await sleep(300);
            await h.shot("cdp-shots/council-summary-brainstorm.png");
            const items = await menuItems(h);
            await menuClick(h, "open-doc");
            const inCode = await until(h, `document.querySelector("[data-code-path]")?.getAttribute("data-code-path") === ${q(DOC_REL)}`);
            const surface = await h.activeSurfaceLabel();
            // the saved line in the column beside the report opens the same document
            await h.goto("agent");
            await openBrainstormSummary(h, id);
            await click(h, `${SUMMARY} [data-council-glance] [data-council-docpath]`);
            const lineOpens = await until(h, `document.querySelector("[data-code-path]")?.getAttribute("data-code-path") === ${q(DOC_REL)}`);
            // back on the Agent surface for the steps that follow
            await h.goto("agent");
            await openSummary(h, ctx);
            const ok =
                facts.heading === "Ideas worth trying, best first" &&
                facts.titles.join("|") === TITLES.slice(0, 3).join("|") &&
                facts.steps.length === 3 &&
                stepsInFrame &&
                facts.steps.every((s) => s === "First step Try it on one screen") &&
                facts.jumps === "directions,kept,matrix" &&
                facts.keptGrid === "grid" &&
                facts.keptBorder === "0px" &&
                facts.meta[0].startsWith("Had it: Skeptic · built on by New user") &&
                facts.meta[1].startsWith("Had it: UX") &&
                !facts.meta[1].includes("built on by") &&
                facts.meta[2].startsWith("Had it: UX and RAM") &&
                facts.keptHeading === "Wild ideas kept aside" &&
                facts.kept.length === 1 &&
                facts.kept[0].title === TITLES[3] &&
                facts.kept[0].meta === "Had it: New user" &&
                facts.dropped === "1 more idea merged or dropped" &&
                facts.docpath === `Saved to ${DOC_REL} with the whole discussion` &&
                !facts.docSaved &&
                items.includes("open-doc=Open the document") &&
                !items.some((i) => i.startsWith("save-doc=")) &&
                inCode &&
                surface === SURFACE_LABEL.code &&
                lineOpens;
            return { ok, detail: JSON.stringify({ facts, items, inCode, surface, lineOpens }) };
        });

        await step("a Brainstorm that kept nothing aside shows no kept section and offers Save as doc until it has saved itself, and a Review report shows none of the Brainstorm parts", async () => {
            const id = await seedCouncil(h, ctx, "done", {
                id: "fx-council-brainstorm-nokept",
                edit: (c) => {
                    c.mode = "brainstorm";
                    c.summary.kept = [];
                    c.summary.directions = c.summary.directions.slice(0, 3);
                },
            });
            await openBrainstormSummary(h, id);
            const facts = await h.ev(BRAINSTORM_FACTS);
            const items = await menuItems(h);
            // a Review council of its own that has saved nothing: the council of the steps above has by now (Save as doc)
            const unsaved = await seedCouncil(h, ctx, "done", { id: "fx-council-review-unsaved" });
            await openSummary(h, ctx, unsaved);
            const review = await h.ev(BRAINSTORM_FACTS);
            const reviewItems = await menuItems(h);
            const ok =
                facts.heading === "Ideas worth trying, best first" &&
                facts.keptHeading == null &&
                facts.kept.length === 0 &&
                facts.dropped === "2 more ideas merged or dropped" &&
                facts.docpath == null &&
                items.includes("save-doc=Save as doc") &&
                !items.some((i) => i.startsWith("open-doc=")) &&
                review.heading == null &&
                review.steps.length === 0 &&
                review.jumps === "directions,matrix" &&
                review.keptHeading == null &&
                review.dropped == null &&
                review.docpath == null &&
                reviewItems.includes("save-doc=Save as doc");
            return { ok, detail: JSON.stringify({ facts, items, review, reviewItems }) };
        });

        await step("on a narrow pane the glance wraps under the text and the cards keep their width", async () => {
            try {
                await h.cdp("Emulation.setDeviceMetricsOverride", { width: 1000, height: 950, deviceScaleFactor: 1, mobile: false });
                await openSummary(h, ctx);
                await sleep(400);
                const m = await h.ev(`(() => {
                    const root = document.querySelector(${q(SUMMARY)});
                    const box = root.querySelector("[data-council-scroll]");
                    const glance = root.querySelector("[data-council-glance]").getBoundingClientRect();
                    const column = root.querySelector("h1").parentElement.getBoundingClientRect();
                    return {
                        glanceTop: Math.round(glance.top),
                        columnBottom: Math.round(column.bottom),
                        widths: [...root.querySelectorAll("[data-council-direction]")].map((d) => Math.round(d.getBoundingClientRect().width)),
                        scrollWidth: box.scrollWidth,
                        clientWidth: box.clientWidth,
                    };
                })()`);
                await h.shot("cdp-shots/council-summary-narrow.png");
                const ok =
                    m.glanceTop >= m.columnBottom &&
                    m.widths.length === 4 &&
                    m.widths.every((w) => w >= 250) &&
                    m.scrollWidth <= m.clientWidth + 1;
                return { ok, detail: JSON.stringify(m) };
            } finally {
                // clearDeviceMetricsOverride drops to the native window size, and verify.mjs pins 1600x950 only between
                // scenarios: set it back
                await h.cdp("Emulation.setDeviceMetricsOverride", { width: 1600, height: 950, deviceScaleFactor: 1, mobile: false });
            }
        });

        return steps;
    },

    async teardown(h, ctx) {
        for (const oid of ctx.efforts ?? []) {
            await h.rpc("effortdelete", { effortoid: oid }).catch((e) => console.error(`council summary: delete ${oid} failed: ${e?.message ?? e}`));
        }
        // an initiative a failed step made and never reported
        try {
            const list = await h.rpc("effortlist", { project: ctx.project, includearchived: true });
            for (const e of list?.efforts ?? []) {
                if (e.title === "Rail apps") await h.rpc("effortdelete", { effortoid: String(e.oref).replace(/^effort:/, "") });
            }
        } catch (e) {
            console.error(`council summary: sweeping the initiatives failed: ${e?.message ?? e}`);
        }
        await teardownCouncilProject(h, ctx);
    },
};
