// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0
//
// council-final-proposal (docs/superpowers/specs/2026-11-04-council-final-proposal-design.md, plan docs/superpowers/plans/
// 2026-11-04-council-final-proposal.md, Task 6): Copy and Pin to Report on every sent seat message in a council's chat, the
// Pinned to Report pill, and the Final proposal section the pinned message becomes at the end of the Report (Open in
// Discussion, Copy, Unpin), with a summary and without one. The hooks are called by councilscenarios.mjs as arrange(h, fx),
// assert(h, ctx, fx), teardown(h, ctx, fx).
//
// Nothing here calls a model, and CouncilFinalPickCommand stays real: a pin is written to the temp project's fixture, and a
// step reads the file back. The clipboard is a spy on navigator.clipboard.writeText that records what the page writes
// (window.__copies), never the OS clipboard.
//
// The council is the `done` fixture with a seat reply holding a markdown table in P2's thread (r30), a message of the
// person's to the channel (r31) and a seat's answer to it (r32), so a reply in a thread and one in the channel both have
// the buttons; a second council, the same with no summary and an idea pinned, is the Report without one.

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { waitFor } from "../attach.mjs";
import {
    arrangeCouncilProject,
    loadCouncilFixture,
    openCouncil,
    seedCouncil,
    teardownCouncilProject,
} from "./fixtures.mjs";

const WAIT_MS = 10_000;
const SUMMARY = "[data-council-summary]";
const FINAL = `${SUMMARY} [data-council-final]`;
const TABBAR = `${SUMMARY} [data-council-tabbar]`;
const BOX = `${SUMMARY} [data-council-scroll]`;
const CHANNEL = "[data-council-channel]";
const THREAD = (idea) => `[data-council-thread="${idea}"]`;
const OPEN_THREAD = (idea) => `${CHANNEL} [data-council-thread-open="${idea}"]`;

const NO_SUMMARY_ID = "fx-council-final-nosummary";

// the seat reply in P2's thread holds a table after a line of words, so the copy has something to trim and the section
// something to draw as a table; the channel's seat answer holds a list. Both are the text a seat wrote, as the file keeps it
const TABLE_REPLY =
    "Awake cost per app, measured on a cold start:\n\n| App | RAM | Reopen |\n|---|---|---|\n| Docs | 60 MB | 1 s |\n| Dev server | 140 MB | 3 s |\n";
const CHANNEL_ASK = "Which of these would you ship first?";
const CHANNEL_ANSWER = "Ship the pin hint first, it costs nothing:\n\n- no new state\n- one line of copy\n";

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const q = (s) => JSON.stringify(s);
const until = (h, expr, ms = WAIT_MS) => waitFor((e) => h.ev(e), expr, ms, 60);
const exists = (h, sel) => h.ev(`!!document.querySelector(${q(sel)})`);
const count = (h, sel) => h.ev(`document.querySelectorAll(${q(sel)}).length`);
const attr = (h, sel, name) => h.ev(`document.querySelector(${q(sel)})?.getAttribute(${q(name)}) ?? null`);
const textOf = (h, sel) => h.ev(`document.querySelector(${q(sel)})?.innerText?.replace(/\\s+/g, " ").trim() ?? null`);
const click = (h, sel) =>
    h.ev(`(() => { const el = document.querySelector(${q(sel)}); if (el == null || el.disabled) return false; el.click(); return true; })()`);
const movePointer = (h, x, y) => h.cdp("Input.dispatchMouseEvent", { type: "mouseMoved", x, y });

// the pointer moved onto the middle of an element, as a person reading it has it
async function hover(h, sel) {
    const at = await h.ev(`(() => {
        const el = document.querySelector(${q(sel)});
        if (el == null) return null;
        el.scrollIntoView({ block: "nearest" });
        const b = el.getBoundingClientRect();
        return { x: Math.round(b.left + b.width / 2), y: Math.round(b.top + b.height / 2) };
    })()`);
    if (at == null) return false;
    await movePointer(h, at.x, at.y);
    await sleep(300);
    return true;
}

// what the page has written to the clipboard since the spy went in, oldest first
const copies = (h) => h.ev(`window.__copies ?? []`);
async function installSpy(h) {
    const kind = await h.ev(`(() => {
        window.__copies = [];
        if (navigator.clipboard == null) return "none";
        Object.defineProperty(navigator.clipboard, "writeText", {
            configurable: true,
            value: async (t) => { window.__copies.push(String(t)); },
        });
        return typeof navigator.clipboard.writeText;
    })()`);
    if (kind !== "function") throw new Error(`the clipboard spy did not go in (navigator.clipboard.writeText is ${kind})`);
}

// the message markdown the spec fixes (Go's council.MessageMarkdown, councilfinalmodel.ts): a reply is its text, trimmed; an
// idea is `## <title>`, its argument, then one `- ` line per evidence item (a weak one says so)
function evidenceLine(e) {
    const ref = e.ref ?? "";
    const note = e.note ?? "";
    if (!e.weak) return ref;
    if (ref !== "" && note !== "") return `${ref} (weak: ${note})`;
    if (ref !== "") return `${ref} (weak)`;
    return note !== "" ? `weak: ${note}` : "weak";
}
function ideaMarkdown(p) {
    const parts = [`## ${p.title}`];
    if (p.argument.trim() !== "") parts.push(p.argument.trim());
    if ((p.evidence ?? []).length > 0) parts.push(p.evidence.map((e) => `- ${evidenceLine(e)}`).join("\n"));
    return parts.join("\n\n");
}

// the council as the file keeps it: `finalpick` is what CouncilFinalPickCommand writes (undefined while nothing is pinned)
function savedCouncil(ctx, id) {
    return JSON.parse(readFileSync(join(ctx.dataDir, "councils", `${id}.json`), "utf8"));
}
async function savedPick(h, ctx, id, want, ms = 5_000) {
    let got;
    for (const start = Date.now(); ; ) {
        try {
            got = savedCouncil(ctx, id).finalpick ?? "";
        } catch {
            got = "(unreadable)";
        }
        if (got === want) return true;
        if (Date.now() - start >= ms) return false;
        await sleep(150);
    }
}

// the done fixture with the three messages this scenario pins and copies
function addMessages(c) {
    const last = Math.max(...c.replies.map((r) => r.ts));
    c.replies.push(
        {
            id: "r30",
            proposalid: "P2",
            author: "ram",
            stance: "accept",
            text: TABLE_REPLY,
            round: 3,
            ts: last + 60_000,
        },
        {
            id: "r31",
            proposalid: "",
            author: "you",
            text: CHANNEL_ASK,
            to: ["ux"],
            answered: true,
            round: 3,
            ts: last + 120_000,
        },
        {
            id: "r32",
            proposalid: "",
            parentid: "r31",
            author: "ux",
            text: CHANNEL_ANSWER,
            round: 3,
            ts: last + 150_000,
        }
    );
}

// opens the council's Discussion and waits for the three messages (the channel's are there at once; P2's thread opens on a
// press of its replies button and holds r30)
async function openDiscussion(h, id) {
    await openCouncil(h, id, "discussion");
    const drawn = `!!document.querySelector('[data-council-discussion="${id}"]') &&
        !!document.querySelector('${CHANNEL} [data-council-reply-post="r32"]') &&
        !!document.querySelector('${CHANNEL} [data-council-idea="P2"]')`;
    if (!(await until(h, drawn))) throw new Error("the Discussion did not draw the channel's messages");
}

async function openThread(h, idea, reply) {
    if (!(await exists(h, THREAD(idea)))) {
        if (!(await click(h, OPEN_THREAD(idea)))) throw new Error(`the replies button of ${idea} is missing`);
    }
    if (!(await until(h, `!!document.querySelector('${THREAD(idea)} [data-council-reply-post="${reply}"]')`))) {
        throw new Error(`the thread of ${idea} did not draw ${reply}`);
    }
}

// a thread closes by its close button; false when it is not open
async function closeThread(h) {
    if (!(await exists(h, "[data-council-thread]"))) return true;
    await click(h, "[data-council-thread-close]");
    return until(h, `!document.querySelector("[data-council-thread]")`);
}

// a message's Copy and Pin buttons as drawn: the end they sit in (its opacity), the pill, the Pin button's state
const toolFacts = (h, scope, id) =>
    h.ev(`(() => {
        const root = document.querySelector(${q(scope)});
        if (root == null) return null;
        const copy = root.querySelector('[data-council-copy="${id}"]');
        const pin = root.querySelector('[data-council-finalpick="${id}"]');
        const end = copy?.closest("span[data-council-tools]")?.parentElement ?? null;
        return {
            copy: !!copy,
            pin: !!pin,
            pinned: pin?.getAttribute("data-pinned") ?? null,
            label: pin?.getAttribute("aria-label") ?? null,
            pill: !!root.querySelector('[data-council-pinned-pill="${id}"]'),
            copyState: copy?.getAttribute("data-copy-state") ?? null,
            copyText: copy ? copy.textContent.replace(/\\s+/g, " ").trim() : null,
            opacity: end ? getComputedStyle(end).opacity : null,
        };
    })()`);

// every pill and every pressed Pin button in the document, by the id they name
const pins = (h) =>
    h.ev(`({
        pills: [...document.querySelectorAll("[data-council-pinned-pill]")].map((e) => e.getAttribute("data-council-pinned-pill")),
        pressed: [...document.querySelectorAll('[data-council-finalpick][data-pinned="true"]')].map((e) => e.getAttribute("data-council-finalpick")),
    })`);

// the Report of a council, drawn once it holds a Final proposal section
async function openReport(h, id) {
    await openCouncil(h, id, "summary");
    const drawn = `document.querySelector(${q(SUMMARY)})?.dataset.councilId === ${q(id)} && !!document.querySelector(${q(FINAL)})`;
    if (!(await until(h, drawn))) throw new Error("the Report did not draw its Final proposal section");
}

// the Report's section: its header, its body, where it sits among the Report's other parts and the jump links
const REPORT_FACTS = `(() => {
    const root = document.querySelector(${q(SUMMARY)});
    const t = (el) => el?.innerText?.replace(/\\s+/g, " ").trim() ?? null;
    const section = root.querySelector("[data-council-final]");
    const body = section?.querySelector("[data-council-final-body]") ?? null;
    // a Report's part that must come before (-1) or after (1) the section, whichever of them the Report has
    const rel = (sel) => {
        const els = [...root.querySelectorAll(sel)];
        if (els.length === 0 || section == null) return null;
        const flag = (el) => (el.compareDocumentPosition(section) & Node.DOCUMENT_POSITION_FOLLOWING ? -1 : 1);
        return els.map(flag).join("");
    };
    const jumps = [...root.querySelectorAll("[data-council-tabbar] [data-council-jump]")];
    return {
        section: !!section,
        sectionAttr: section?.getAttribute("data-council-section") ?? null,
        heading: t(section?.querySelector("h2")),
        from: t(section?.querySelector("[data-council-final-from]")),
        buttons: section
            ? ["open", "copy", "unpin"].map((b) => b + "=" + (t(section.querySelector("[data-council-final-" + b + "]")) ?? "missing"))
            : [],
        bodyText: t(body),
        rows: body ? body.querySelectorAll("table tr").length : 0,
        cells: body ? [...body.querySelectorAll("table tr")].map((r) => [...r.children].map((c) => t(c)).join("|")) : [],
        table: !!body?.querySelector("table"),
        // DOCUMENT_POSITION_FOLLOWING from the part: the section comes after it (-1 each), or before it (1 each)
        afterDirections: rel("[data-council-direction]"),
        afterKept: rel("[data-council-kept]"),
        beforeAsks: rel("[data-council-asks-next]"),
        beforeDropped: rel("[data-council-dropped]"),
        beforeRating: rel("[data-council-rating]"),
        siblingOfAsks: section && root.querySelector("[data-council-asks-next]")
            ? section.parentElement === root.querySelector("[data-council-asks-next]").parentElement
            : null,
        jumps: jumps.map((j) => j.dataset.councilJump),
        jumpLabel: t(jumps.find((j) => j.dataset.councilJump === "final")),
        nosummary: !!root.querySelector("[data-council-nosummary]"),
        directions: root.querySelectorAll("[data-council-direction]").length,
        rating: !!root.querySelector("[data-council-rating]"),
        // the section's container: the Report's body, which holds only the section when there is no summary
        siblings: section ? section.parentElement.children.length : null,
        inBody: section && root.querySelector("[data-council-tabbar]")
            ? !!(root.querySelector("[data-council-tabbar]").compareDocumentPosition(section.parentElement) & Node.DOCUMENT_POSITION_FOLLOWING)
            : null,
    };
})()`;

export const councilFinalProposal = {
    async arrange(h, fx) {
        const ctx = await arrangeCouncilProject(h, fx);
        try {
            ctx.councilId = await seedCouncil(h, ctx, "done", { edit: addMessages });
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
        const id = ctx.councilId;
        const fixture = loadCouncilFixture("done");
        const p2 = fixture.proposals.find((p) => p.id === "P2");
        const REPLY_MD = TABLE_REPLY.trim();
        const ANSWER_MD = CHANNEL_ANSWER.trim();
        const IDEA_MD = ideaMarkdown(p2);
        const R30 = `${THREAD("P2")} [data-council-reply-post="r30"]`;
        const R32 = `${CHANNEL} [data-council-reply-post="r32"]`;
        const IDEA_THREAD = `${THREAD("P2")} [data-council-post="P2"]`;
        const IDEA_CHANNEL = `${CHANNEL} [data-council-idea="P2"]`;

        await openDiscussion(h, id);
        await openThread(h, "P2", "r30");
        await installSpy(h);

        await step("the hover end shows Copy and Pin to Report on a seat's reply (in a thread and in the channel) and on an idea, and none on the person's own post", async () => {
            await movePointer(h, 2, 2);
            await sleep(300);
            const away = await toolFacts(h, R30, "r30");
            // focus inside the message shows the end, as a hover does
            const focused = await h.ev(`(() => {
                const b = document.querySelector('${R30} [data-council-copy="r30"]');
                if (b == null) return false;
                b.focus();
                return document.activeElement === b;
            })()`);
            await sleep(300);
            const withFocus = await toolFacts(h, R30, "r30");
            await h.ev(`document.activeElement?.blur?.()`);
            await hover(h, R30);
            const hovered = await toolFacts(h, R30, "r30");
            await h.shot("cdp-shots/council-final-hover.png");
            const reply = await toolFacts(h, R30, "r30");
            const channelReply = await toolFacts(h, R32, "r32");
            const ideaInThread = await toolFacts(h, IDEA_THREAD, "P2");
            const ideaInChannel = await toolFacts(h, IDEA_CHANNEL, "P2");
            // the person's own posts: r19 in the thread, r31 in the channel
            const mine = await h.ev(`[${q(`${THREAD("P2")} [data-council-reply-post="r19"]`)}, ${q(`${CHANNEL} [data-council-reply-post="r31"]`)}].map((s) => {
                const post = document.querySelector(s);
                return post == null ? null : { copy: !!post.querySelector("[data-council-copy]"), pin: !!post.querySelector("[data-council-finalpick]"), tools: !!post.querySelector("[data-council-tools]") };
            })`);
            const bothButtons = (f) => f != null && f.copy && f.pin && f.pinned === null && f.label === "Pin to Report" && !f.pill;
            const ok =
                bothButtons(away) &&
                away.opacity === "0" &&
                focused &&
                withFocus.opacity === "1" &&
                hovered.opacity === "1" &&
                bothButtons(reply) &&
                bothButtons(channelReply) &&
                bothButtons(ideaInThread) &&
                bothButtons(ideaInChannel) &&
                mine.every((m) => m != null && !m.copy && !m.pin && !m.tools);
            return { ok, detail: JSON.stringify({ away, withFocus, hovered, channelReply, ideaInThread, ideaInChannel, mine }) };
        });

        await step("Copy puts the message's markdown on the clipboard, exactly, and reads Copied", async () => {
            await installSpy(h);
            await hover(h, R30);
            await click(h, `${R30} [data-council-copy="r30"]`);
            const shown = await until(h, `document.querySelector('${R30} [data-council-copy="r30"]')?.getAttribute("data-copy-state") === "copied"`, 3_000);
            const reply = await toolFacts(h, R30, "r30");
            await h.shot("cdp-shots/council-final-copy.png");
            // the idea (its thread heading) and the channel's reply, each its own markdown
            await hover(h, IDEA_THREAD);
            await click(h, `${IDEA_THREAD} [data-council-copy="P2"]`);
            await until(h, `document.querySelector('${IDEA_THREAD} [data-council-copy="P2"]')?.getAttribute("data-copy-state") === "copied"`, 3_000);
            await hover(h, R32);
            await click(h, `${R32} [data-council-copy="r32"]`);
            await until(h, `document.querySelector('${R32} [data-council-copy="r32"]')?.getAttribute("data-copy-state") === "copied"`, 3_000);
            const written = await copies(h);
            const ok =
                shown &&
                reply.copyState === "copied" &&
                reply.copyText === "Copied" &&
                written.length === 3 &&
                written[0] === REPLY_MD &&
                written[1] === IDEA_MD &&
                written[2] === ANSWER_MD;
            return { ok, detail: JSON.stringify({ reply, written, want: [REPLY_MD, IDEA_MD, ANSWER_MD] }) };
        });

        await step("Pin to Report shows the pill and reads Unpin; pinning another message moves both, and the pin is saved", async () => {
            await movePointer(h, 2, 2);
            await sleep(1600); // the Copied labels of the step before are back to Copy
            const before = await pins(h);
            await hover(h, R30);
            await click(h, `${R30} [data-council-finalpick="r30"]`);
            const pinned30 = await until(h, `!!document.querySelector('[data-council-pinned-pill="r30"]')`, 5_000);
            const first = {
                reply: await toolFacts(h, R30, "r30"),
                pins: await pins(h),
                saved: await savedPick(h, ctx, id, "r30"),
            };
            await h.shot("cdp-shots/council-final-pin.png");
            // another message takes the pin: r32 in the channel
            await hover(h, R32);
            await click(h, `${R32} [data-council-finalpick="r32"]`);
            const pinned32 = await until(h, `!!document.querySelector('[data-council-pinned-pill="r32"]') && !document.querySelector('[data-council-pinned-pill="r30"]')`, 5_000);
            const second = {
                answer: await toolFacts(h, R32, "r32"),
                reply: await toolFacts(h, R30, "r30"),
                pins: await pins(h),
                saved: await savedPick(h, ctx, id, "r32"),
            };
            // and back to the reply with the table, which the Report steps draw
            await hover(h, R30);
            await click(h, `${R30} [data-council-finalpick="r30"]`);
            const back = await until(h, `!!document.querySelector('[data-council-pinned-pill="r30"]') && !document.querySelector('[data-council-pinned-pill="r32"]')`, 5_000);
            const third = { pins: await pins(h), saved: await savedPick(h, ctx, id, "r30") };
            const ok =
                before.pills.length === 0 &&
                before.pressed.length === 0 &&
                pinned30 &&
                first.reply.pill &&
                first.reply.pinned === "true" &&
                first.reply.label === "Unpin" &&
                first.pins.pills.join() === "r30" &&
                first.pins.pressed.join() === "r30" &&
                first.saved &&
                pinned32 &&
                second.answer.pill &&
                second.answer.pinned === "true" &&
                second.answer.label === "Unpin" &&
                !second.reply.pill &&
                second.reply.pinned === null &&
                second.reply.label === "Pin to Report" &&
                second.pins.pills.join() === "r32" &&
                second.pins.pressed.join() === "r32" &&
                second.saved &&
                back &&
                third.pins.pills.join() === "r30" &&
                third.pins.pressed.join() === "r30" &&
                third.saved;
            return { ok, detail: JSON.stringify({ before, first, second, third }) };
        });

        await step("the Report ends with the Final proposal section, its table drawn, its jump link last", async () => {
            // the thread closes first, so the Open in Discussion step opens it again
            const closed = await closeThread(h);
            await openReport(h, id);
            await sleep(400);
            const f = await h.ev(REPORT_FACTS);
            const jump = await h.ev(`(async () => {
                const box = document.querySelector(${q(BOX)});
                const link = document.querySelector(${q(`${TABBAR} [data-council-jump="final"]`)});
                box.scrollTop = 0;
                link.click();
                await new Promise((r) => setTimeout(r, 1200));
                const section = document.querySelector(${q(FINAL)}).getBoundingClientRect();
                const b = box.getBoundingClientRect();
                return { scrollTop: Math.round(box.scrollTop), inView: section.top >= b.top - 1 && section.top < b.bottom - 40 };
            })()`);
            await h.shot("cdp-shots/council-final-report.png");
            const sameCells = ["App|RAM|Reopen", "Docs|60 MB|1 s", "Dev server|140 MB|3 s"];
            const ok =
                closed &&
                f.section &&
                f.sectionAttr === "final" &&
                f.heading === "Final proposal" &&
                /^RAM( · \d\d:\d\d)?$/.test(f.from ?? "") &&
                f.buttons.join() === "open=Open in Discussion,copy=Copy,unpin=Unpin" &&
                f.table &&
                f.cells.join("\n") === sameCells.join("\n") &&
                (f.bodyText ?? "").startsWith("Awake cost per app, measured on a cold start:") &&
                // the Report's other parts: the directions come before it; Ask next, the rating row follow it
                f.directions === 4 &&
                f.afterDirections === "-1-1-1-1" &&
                (f.afterKept == null || /^(-1)+$/.test(f.afterKept)) &&
                f.beforeAsks === "1" &&
                f.beforeRating === "1" &&
                f.siblingOfAsks === true &&
                // the jump link is the last one, and it is the section's own
                f.jumps.length >= 2 &&
                f.jumps.at(-1) === "final" &&
                f.jumps.includes("directions") &&
                f.jumpLabel === "Final proposal" &&
                jump.scrollTop > 0 &&
                jump.inView;
            return { ok, detail: JSON.stringify({ closed, f, jump }) };
        });

        await step("Copy on the section copies the raw markdown, and reads Copied", async () => {
            await installSpy(h);
            await click(h, "[data-council-final-copy]");
            const shown = await until(h, `document.querySelector("[data-council-final-copy]")?.innerText.trim() === "Copied"`, 3_000);
            await h.shot("cdp-shots/council-final-report-copy.png");
            const written = await copies(h);
            const ok = shown && written.length === 1 && written[0] === REPLY_MD && written[0].includes("|---|---|---|");
            return { ok, detail: JSON.stringify({ shown, written }) };
        });

        await step("Open in Discussion lands on the pinned reply in its thread, ringed", async () => {
            await h.ev(`(() => {
                window.__flashed = [];
                new MutationObserver((list) => {
                    for (const m of list) {
                        const el = m.target;
                        if (el.getAttribute("data-flash") === "true") {
                            window.__flashed.push(el.getAttribute("data-council-reply-post"));
                        }
                    }
                }).observe(document.body, { subtree: true, attributes: true, attributeFilter: ["data-flash"] });
            })()`);
            await click(h, "[data-council-final-open]");
            const landed = await until(
                h,
                `document.querySelector('${R30}')?.getAttribute("data-flash") === "true"`,
                8_000
            );
            const atLanding = await h.ev(`(() => {
                const post = document.querySelector('${R30}');
                if (post == null) return null;
                const b = post.getBoundingClientRect();
                // the box the post scrolls in: its nearest ancestor that scrolls up and down
                let box = post.parentElement;
                while (box != null && !(/(auto|scroll)/.test(getComputedStyle(box).overflowY) && box.scrollHeight > box.clientHeight)) {
                    box = box.parentElement;
                }
                const r = box?.getBoundingClientRect();
                return {
                    flash: post.getAttribute("data-flash"),
                    discussion: !!document.querySelector('[data-council-discussion="${id}"]'),
                    report: !!document.querySelector(${q(SUMMARY)}),
                    thread: !!document.querySelector('${THREAD("P2")}'),
                    inView: r ? b.top >= r.top - 1 && b.bottom <= r.bottom + 1 : b.top >= 0 && b.bottom <= innerHeight,
                    ringed: getComputedStyle(post.querySelector("[data-council-bubble]")).boxShadow !== "none",
                };
            })()`);
            await h.shot("cdp-shots/council-final-open.png");
            const flashed = await h.ev(`window.__flashed ?? []`);
            // the reveal request was consumed once: a second look at the chat finds the ring gone after FLASH_MS
            await sleep(2400);
            const after = await attr(h, R30, "data-flash");
            const ok =
                landed &&
                atLanding != null &&
                atLanding.flash === "true" &&
                atLanding.discussion &&
                !atLanding.report &&
                atLanding.thread &&
                atLanding.inView &&
                flashed.length > 0 &&
                flashed.every((x) => x === "r30") &&
                after === null;
            return { ok, detail: JSON.stringify({ landed, atLanding, flashed, after }) };
        });

        await step("the Report without a summary shows the section under the no-summary state, with only its jump link", async () => {
            const none = await seedCouncil(h, ctx, "done", {
                id: NO_SUMMARY_ID,
                edit: (c) => {
                    addMessages(c);
                    delete c.summary;
                    c.finalpick = "P2";
                },
            });
            await openReport(h, none);
            await sleep(400);
            const f = await h.ev(REPORT_FACTS);
            await h.shot("cdp-shots/council-final-nosummary.png");
            const ok =
                f.nosummary &&
                f.directions === 0 &&
                !f.rating &&
                f.section &&
                f.sectionAttr === "final" &&
                f.heading === "Final proposal" &&
                /^UX( · \d\d:\d\d)?$/.test(f.from ?? "") &&
                (f.bodyText ?? "").includes(p2.title) &&
                // the section is the only thing in its container, and that sits under the tab bar
                f.siblings === 1 &&
                f.inBody === true &&
                f.jumps.join() === "final" &&
                f.jumpLabel === "Final proposal";
            return { ok, detail: JSON.stringify({ none, f }) };
        });

        await step("Unpin removes the section and the jump link, and the pin is gone from the saved council", async () => {
            await click(h, "[data-council-final-unpin]");
            const gone = await until(h, `!document.querySelector("[data-council-final]")`, 5_000);
            const after = await h.ev(`({
                section: !!document.querySelector("[data-council-final]"),
                jumps: document.querySelectorAll("[data-council-jump]").length,
                nosummary: !!document.querySelector("[data-council-nosummary]"),
                error: document.querySelector("[data-council-error]")?.innerText ?? null,
            })`);
            const saved = await savedPick(h, ctx, NO_SUMMARY_ID, "");
            await h.shot("cdp-shots/council-final-unpin.png");
            const ok = gone && !after.section && after.jumps === 0 && after.nosummary && after.error === null && saved;
            return { ok, detail: JSON.stringify({ gone, after, saved }) };
        });

        return steps;
    },

    async teardown(h, ctx) {
        await teardownCouncilProject(h, ctx);
    },
};
