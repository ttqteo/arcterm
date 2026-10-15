// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0
//
// The Cockpit office's scenarios (docs/superpowers/specs/2026-10-15-cockpit-office-design.md). cockpit-office draws
// the canvas's boards (Main, NextAsk, Night, Tired, States, RamPanel) on a fixture roster, one real run held in
// planning (its meeting room opens a real LeadCard) and fixture runs handed in through the DEV-only hooks
// (frontend/app/view/agents/cockpitofficedevhooks.ts), and drives the boss with real keys.

import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { SCENARIOS as ROSTERS } from "../cockpit-fixtures/scenarios.mjs";
import { busyPct, HOLD_MS, mb, metrics, round1 } from "./officescenarios.mjs";

export const FIXTURE = new URL("../../public/cockpit-fixtures/active.json", import.meta.url);
export const VIEW_KEY = "cockpit.view";
const KEY_CODES = { ArrowUp: 38, ArrowDown: 40, ArrowLeft: 37, ArrowRight: 39, Escape: 27, Enter: 13, j: 74, k: 75, n: 78, o: 79, 1: 49 };
// the boss's walking speed (officeboss.ts BOSS_SPEED), for how long to hold an arrow
const BOSS_PX_PER_S = 160;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// fixture runs the office draws after the live ones
function devRuns(prefix, specs) {
    return specs.map(([title, project, states], r) => ({
        id: `${prefix}-${r + 1}`,
        title,
        project,
        createdTs: r + 1,
        done: false,
        leadAsking: false,
        tasks: states.map((state, t) => ({ id: `t${t + 1}`, label: `${title} task ${t + 1}`, state, asking: false })),
    }));
}
export const OFFICE_RUNS = devRuns("fx-office-run", [
    ["Canvas gallery", "arcterm", ["done", "reviewing", "running"]],
    ["Billing export", "mozox", ["done", "done", "running", "running", "stalled", "failed", "pending"]],
]);
const BENCH_STATES = ["running", "running", "running", "done", "done", "reviewing", "pending", "stalled"];
export const BENCH_RUNS = devRuns("fx-bench-run", [
    ["Bench run one", "arcterm", BENCH_STATES],
    ["Bench run two", "mozox", BENCH_STATES],
    ["Bench run three", "thesis", BENCH_STATES],
]);

// a real key on the page: keyDown, keyUp, or both
export async function key(h, k, type = "both") {
    const code = k.length === 1 ? (/\d/.test(k) ? `Digit${k}` : `Key${k.toUpperCase()}`) : k;
    const base = { key: k, code, windowsVirtualKeyCode: KEY_CODES[k] };
    if (type !== "up") await h.cdp("Input.dispatchKeyEvent", { type: "keyDown", ...base, ...(k.length === 1 ? { text: k } : {}) });
    if (type !== "down") await h.cdp("Input.dispatchKeyEvent", { type: "keyUp", ...base });
}

// holds a key for ms: the boss walks while an arrow is down
export async function hold(h, k, ms) {
    await key(h, k, "down");
    await sleep(ms);
    await key(h, k, "up");
}

export const probe = (h) => h.ev("window.__cockpitOfficeProbe ? window.__cockpitOfficeProbe() : null");
export const dev = (h, o) => h.ev(`window.__cockpitOffice(${JSON.stringify(o)})`);
export const focusCockpit = (h) => h.ev(`document.querySelector("[data-cockpit-surface]")?.focus()`);

// the office and its hooks load after a reload; null when both are there, else what is missing
export async function waitForOffice(h) {
    return h.ev(`(async () => {
        const ready = () => typeof window.__cockpitOffice === "function" && !!document.querySelector("[data-cockpit-office] [data-office-desk]");
        for (let i = 0; i < 120 && !ready(); i++) await new Promise((r) => setTimeout(r, 250));
        return ready() ? null : "after 30 s the Cockpit shows no office or its dev hooks";
    })()`);
}

// waits until the boss stands still and no path hint shows, up to ms
export async function settleBoss(h, ms = 4000) {
    for (let t = 0; t < ms; t += 100) {
        const p = await probe(h);
        if (p?.boss && !p.boss.moving && p.dots === 0) return p;
        await sleep(100);
    }
    return probe(h);
}

const desk = (id) => `[data-office-desk="${id}"]`;
// how many drawn people show one of these sprites right now (data-office-sprite on each person's <img>)
const spriteCount = (h, names) =>
    h.ev(`[...document.querySelectorAll("[data-office-root] [data-office-sprite]")].filter((i) => ${JSON.stringify(names)}.includes(i.dataset.officeSprite)).length`);
// polls for ms until some person shows one of these sprites; the count seen, 0 if none
async function waitForSprite(h, names, ms) {
    for (let t = 0; t <= ms; t += 100) {
        const n = await spriteCount(h, names);
        if (n > 0) return n;
        await sleep(100);
    }
    return 0;
}
const toggleTo = (h, label) =>
    h.ev(`[...document.querySelectorAll("[data-cockpit-view-toggle] button")].find((b) => b.textContent.trim() === ${JSON.stringify(label)})?.click()`);

// fx: { arrangeFixtureRun, teardownFixtureRun } from scenarios.mjs
export function makeCockpitOfficeScenarios(fx) {
    const cockpitOffice = {
        name: "cockpit-office",
        surface: "cockpit",
        async arrange(h) {
            const ctx = {
                cwd: mkdtempSync(join(tmpdir(), "cockpit-office-")),
                prevFixture: existsSync(FIXTURE) ? readFileSync(FIXTURE, "utf8") : null,
            };
            await fx.arrangeFixtureRun(h, ctx, "cockpit-office", "office lead", { project: "arcterm" });
            // arrangeFixtureRun wrote its own roster around the run's lead: keep the lead, draw the office's roster
            const lead = JSON.parse(readFileSync(FIXTURE, "utf8")).find((a) => a.runId === ctx.runId);
            mkdirSync(new URL(".", FIXTURE), { recursive: true });
            writeFileSync(FIXTURE, JSON.stringify([...(lead ? [lead] : []), ...ROSTERS.office(Date.now())], null, 2));
            ctx.prevView = await h.ev(`localStorage.getItem(${JSON.stringify(VIEW_KEY)})`);
            await h.ev(`localStorage.setItem(${JSON.stringify(VIEW_KEY)}, JSON.stringify("office"))`);
            try {
                await h.ev("location.reload()");
            } catch {
                // the evaluate is cut off by the navigation it just started
            }
            // the old document can still answer for a moment after the reload starts
            await sleep(1500);
            for (let waited = 0; waited < 40000; waited += 500) {
                if (await h.ev("!!window.TabRpcClient && !!document.querySelector('nav button')").catch(() => false)) break;
                await sleep(500);
            }
            await h.goto("cockpit");
            ctx.missing = await waitForOffice(h);
            if (!ctx.missing) await dev(h, { runs: OFFICE_RUNS, afterHours: false, energy: 63 });
            return ctx;
        },
        async assert(h, ctx) {
            const steps = [];
            const rec = (step, ok, detail) => steps.push({ step, ok: !!ok, detail });
            if (ctx.missing) {
                rec("0. the office loads", false, ctx.missing);
                return steps;
            }

            // 0. opening the office draws the boss at a desk with its card shut and a ↵ over the desk offering it
            let p = await settleBoss(h);
            rec(
                "0. opening the office draws the boss at a desk with its card shut, and a ↵ over the desk offers it",
                p?.boss && p.popup === "" && p.prompt !== "",
                JSON.stringify({ cursor: p?.cursor, popup: p?.popup, prompt: p?.prompt })
            );
            await h.shot("cdp-shots/cockpit-office-prompt.png");

            // 1. Main: quill's card beside its desk
            await h.ev(`document.querySelector(${JSON.stringify(desk("fx-office-quill"))})?.click()`);
            p = await settleBoss(h);
            rec(
                "1. a click on quill's desk walks the boss there and opens its card beside the desk",
                p?.cursor === "fx-office-quill" && p.popup === "agent",
                JSON.stringify({ cursor: p?.cursor, popup: p?.popup, boss: p?.boss })
            );
            await h.shot("cdp-shots/cockpit-office-main.png");

            // 2. 1 answers from that card
            await focusCockpit(h);
            await key(h, "1");
            await sleep(200);
            p = await probe(h);
            rec("2. 1 picks quill's first answer from the card beside the desk", JSON.stringify(p?.answerSel?.["0"]) === "[0]", JSON.stringify(p?.answerSel));

            // 3. the real run's meeting room opens its LeadCard
            await h.ev(`[...document.querySelectorAll("[data-office-room]")].find((b) => !b.dataset.officeRoom.includes("fx-office-run"))?.click()`);
            p = await settleBoss(h);
            const runText = await h.ev(`(document.querySelector('[data-office-popup="run"]')?.textContent ?? "").length`);
            rec("3. a click on a meeting room opens its run's card", p?.popup === "run" && runText > 0, JSON.stringify({ popup: p?.popup, cursor: p?.cursor, runText }));
            await h.shot("cdp-shots/cockpit-office-run.png");

            // 4. a wall stops the boss, a door lets it through. From loom's desk (below the door) the boss walks right
            // long enough to reach the room's wall at any office width, and must stop there; then up to the door's
            // middle and right again, into the hall
            await h.ev(`document.querySelector(${JSON.stringify(desk("fx-office-loom"))})?.click()`);
            const start = await settleBoss(h);
            const arc = start?.boxes?.["room:arcterm"];
            const edge = arc ? arc.x + arc.w : NaN;
            await focusCockpit(h);
            await hold(h, "ArrowRight", arc && start?.boss ? Math.round(((edge - start.boss.x) / BOSS_PX_PER_S) * 1000) + 1500 : 4000);
            const blocked = await settleBoss(h, 1000);
            const doorMid = arc?.door ? arc.door.y + arc.door.h / 2 : NaN;
            await hold(h, "ArrowUp", blocked?.boss && arc?.door ? Math.max(0, Math.round(((blocked.boss.y - doorMid) / BOSS_PX_PER_S) * 1000)) : 400);
            await hold(h, "ArrowRight", 2500);
            const through = await settleBoss(h, 1000);
            rec(
                "4. the arrows walk the boss: it stops at the room's wall, and its door lets it into the hall",
                blocked?.boss?.room === "room:arcterm" &&
                    blocked.boss.x >= edge - 3 &&
                    blocked.boss.x <= edge &&
                    through?.boss?.room === "hall",
                JSON.stringify({ edge, doorMid, blocked: blocked?.boss, through: through?.boss })
            );

            // 5. NextAsk: n shows the way, then the boss walks it
            await focusCockpit(h);
            await key(h, "n");
            await sleep(150);
            const hint = await probe(h);
            await h.shot("cdp-shots/cockpit-office-next-ask.png");
            const atAsk = await settleBoss(h, 5000);
            // quill holds the answer step 2 picked: Enter here opens the card, it does not send the answer
            await focusCockpit(h);
            await key(h, "Enter");
            await sleep(200);
            p = await probe(h);
            rec(
                "5. n shows the way to the next Needs you for a second, then the boss walks there and ↵ offers its card; Enter opens it",
                hint?.dots > 0 && atAsk?.cursor === "fx-office-quill" && atAsk.popup === "" && atAsk.prompt === "agent" && p?.popup === "agent",
                JSON.stringify({ dots: hint?.dots, cursor: atAsk?.cursor, offered: [atAsk?.popup, atAsk?.prompt], opened: p?.popup })
            );

            // 6. Esc shuts the card and ↵ offers it again; j and k walk desk by desk in office order, offering each card
            await focusCockpit(h);
            await key(h, "Escape");
            await sleep(200);
            const hid = await probe(h);
            const want = hid?.order?.[hid.order.indexOf(hid.cursor) + 1];
            await focusCockpit(h);
            await key(h, "j");
            const next = await settleBoss(h, 5000);
            await focusCockpit(h);
            await key(h, "Enter");
            await sleep(200);
            const opened = await probe(h);
            await focusCockpit(h);
            await key(h, "k");
            const back = await settleBoss(h, 5000);
            rec(
                "6. Esc shuts the card and ↵ offers it again; j walks to the next desk in office order offering its card, Enter opens it, k walks back with the card shut",
                hid?.popup === "" &&
                    hid.prompt !== "" &&
                    want != null &&
                    next?.cursor === want &&
                    next.popup === "" &&
                    next.prompt !== "" &&
                    opened?.popup !== "" &&
                    back?.cursor === hid.cursor &&
                    back.popup === "" &&
                    back.prompt !== "",
                JSON.stringify({
                    shut: [hid?.popup, hid?.prompt],
                    want,
                    next: [next?.cursor, next?.popup, next?.prompt],
                    opened: opened?.popup,
                    back: [back?.cursor, back?.popup, back?.prompt],
                })
            );

            // 7. a click on the floor walks the boss there; in the hall the cursor stays on the last desk
            const before = await probe(h);
            const hall = before?.hall;
            const spot = hall ? { x: hall.x + hall.w - 36, y: hall.y + Math.min(300, hall.h - 40) } : null;
            if (spot) {
                await h.ev(`(() => {
                    const root = document.querySelector("[data-office-root]");
                    const r = root.getBoundingClientRect();
                    root.querySelector("[data-office-hall]").dispatchEvent(new MouseEvent("click", { bubbles: true, clientX: r.left + ${spot.x}, clientY: r.top + ${spot.y} }));
                })()`);
            }
            p = await settleBoss(h, 5000);
            rec(
                "7. a click on the hall's floor walks the boss there, and the cursor stays on the last desk",
                spot != null &&
                    p?.boss?.room === "hall" &&
                    Math.abs(p.boss.x - spot.x) <= 3 &&
                    Math.abs(p.boss.y - spot.y) <= 3 &&
                    p.cursor === before.cursor &&
                    p.popup === "" &&
                    p.prompt === "",
                JSON.stringify({ spot, boss: p?.boss, cursor: [before?.cursor, p?.cursor], popup: p?.popup })
            );

            // 8. lights
            p = await probe(h);
            rec(
                "8. Home's booth, where no one works, has its lights off; arcterm's room is lit",
                p?.dark?.includes("room:home") && !p.dark.includes("room:arcterm"),
                JSON.stringify(p?.dark)
            );

            // 9. Night
            await dev(h, { afterHours: true });
            await sleep(400);
            p = await probe(h);
            const gone = await h.ev(`document.querySelectorAll('[data-office-desk][data-office-pose="empty"]').length`);
            rec("9. after hours: idle people have gone home, people at work have a lamp", p?.night && p.lamps > 0 && gone > 0, JSON.stringify({ night: p?.night, lamps: p?.lamps, gone }));
            await h.shot("cdp-shots/cockpit-office-night.png");

            // 10. Tired: the boss stands at pike's desk with its card open; the working desks have coffee, the heading
            // says 94 %, and a tired working person yawns one frame in four
            await dev(h, { afterHours: false, energy: 94 });
            await sleep(400);
            await h.ev(`document.querySelector(${JSON.stringify(desk("fx-office-pike"))})?.click()`);
            p = await settleBoss(h);
            const heading = await h.ev(`document.querySelector("[data-office-heading]")?.textContent ?? ""`);
            const tiredYawns = await waitForSprite(h, ["yawn"], 3000);
            rec(
                "10. the 5-hour window at 94 %: the boss at pike's desk with its card open, coffee on the working desks, the heading says 94 %, a working person yawns",
                p?.cursor === "fx-office-pike" && p.popup === "agent" && p.cups > 0 && heading.includes("94") && tiredYawns > 0,
                JSON.stringify({ cursor: p?.cursor, popup: p?.popup, cups: p?.cups, heading, tiredYawns })
            );
            await h.shot("cdp-shots/cockpit-office-tired.png");

            // 11. States, the yawn and the stretch: at 75 % a working person yawns; a drop from 75 % to 5 % (a reset)
            // makes everyone at a desk stretch once
            await dev(h, { energy: 75 });
            const yawns = await waitForSprite(h, ["yawn"], 4000);
            await dev(h, { energy: 5 });
            const stretches = await waitForSprite(h, ["stretch"], 1000);
            const stretchPoses = await h.ev(`document.querySelectorAll('[data-office-desk][data-office-pose="stretch"]').length`);
            await h.shot("cdp-shots/cockpit-office-stretch.png");
            rec(
                "11. at 75 % a working person yawns; the reset to 5 % stretches everyone at a desk",
                yawns > 0 && stretches > 0 && stretchPoses > 0,
                JSON.stringify({ yawns, stretches, stretchPoses })
            );

            // 12. States, the cheer: quiet makes every agent just finished, so the desks that were at work cheer once
            // (after the stretch, which lasts 1.5 s and would draw over the cheer)
            await sleep(1600);
            await dev(h, { quiet: true });
            const cheers = await waitForSprite(h, ["cheer1", "cheer2"], 1200);
            const cheerPoses = await h.ev(`document.querySelectorAll('[data-office-desk][data-office-pose="cheer"]').length`);
            await h.shot("cdp-shots/cockpit-office-cheer.png");
            await dev(h, { quiet: false, energy: 63 });
            rec(
                "12. a desk that turns done cheers once",
                cheers > 0 && cheerPoses > 0,
                JSON.stringify({ cheers, cheerPoses })
            );

            // 13. States: every sprite
            await dev(h, { sheet: true });
            await sleep(400);
            const sheet = await h.ev(`[...document.querySelectorAll("[data-office-sheet] img")].map((i) => (i.getAttribute("src") ?? "").length)`);
            p = await probe(h);
            rec(
                "13. every sprite draws, every colour token resolved",
                sheet.length === 18 && sheet.every((n) => n > 0) && p?.unresolved?.length === 0,
                JSON.stringify({ sheet, unresolved: p?.unresolved })
            );
            await h.shot("cdp-shots/cockpit-office-states.png");
            await dev(h, { sheet: false });

            // 14. animation off
            await h.ev("window.__cockpitOfficeAnimation(false)");
            await sleep(700);
            const off = await probe(h);
            await h.ev("window.__cockpitOfficeAnimation(true)");
            await sleep(700);
            const on = await probe(h);
            rec(
                "14. with the animation off no clock runs; on again, the frame clock runs",
                off?.clock?.frame === false && off.clock.walk === false && on?.clock?.frame === true,
                JSON.stringify({ off: off?.clock, on: on?.clock })
            );

            // 14b. the crowded lounge: 14 more idle agents past the Finished window, several of them 10 min and more,
            // with the animation off so everyone is there at once. The lounge holds its spots, nothing overlaps, and
            // the rest read "+N in the lounge"
            await h.ev("window.__cockpitOfficeAnimation(false)");
            await dev(h, { crowd: 14 });
            await sleep(700);
            const lounge = await h.ev(`(() => {
                const floor = document.querySelector('[data-office-floor="lounge"]')?.getBoundingClientRect();
                const rect = (el) => { const r = el.getBoundingClientRect(); return { l: r.left, t: r.top, r: r.right, b: r.bottom }; };
                const labels = [...document.querySelectorAll("[data-office-lounge-label]")].map(rect);
                const people = [...document.querySelectorAll("[data-office-lounger]")].map(rect);
                const inside = (q) => floor && q.l >= floor.left - 0.5 && q.t >= floor.top - 0.5 && q.r <= floor.right + 0.5 && q.b <= floor.bottom + 0.5;
                const hit = (a, b) => a.l < b.r && b.l < a.r && a.t < b.b && b.t < a.b;
                let overlapping = 0;
                for (let i = 0; i < labels.length; i++) for (let j = i + 1; j < labels.length; j++) if (hit(labels[i], labels[j])) overlapping++;
                return {
                    labels: labels.length,
                    people: people.length,
                    overlapping,
                    outside: labels.filter((q) => !inside(q)).length + people.filter((q) => !inside(q)).length,
                    more: document.querySelector("[data-office-lounge-more]")?.textContent ?? null,
                    moreInside: (() => { const m = document.querySelector("[data-office-lounge-more]"); return m ? inside(rect(m)) : false; })(),
                    images: document.querySelectorAll("[data-office-root] img[data-office-sprite]").length,
                };
            })()`);
            p = await probe(h);
            await h.shot("cdp-shots/cockpit-office-lounge.png");
            await dev(h, { crowd: 0 });
            await h.ev("window.__cockpitOfficeAnimation(true)");
            rec(
                "14b. a crowded lounge: no two labels touch, everyone stays inside it, the rest read +N in the lounge, and People counts the people drawn",
                lounge?.labels > 0 &&
                    lounge.labels === lounge.people &&
                    lounge.overlapping === 0 &&
                    lounge.outside === 0 &&
                    p?.loungeMore > 0 &&
                    lounge.more === `+${p.loungeMore} in the lounge` &&
                    lounge.moreInside &&
                    p.people === lounge.images,
                JSON.stringify({ lounge, loungeMore: p?.loungeMore, people: p?.people })
            );

            // 15. o and the Cards | Office toggle switch the view, and back
            await focusCockpit(h);
            await key(h, "o");
            await sleep(400);
            const cardsByKey = await h.ev(`!document.querySelector("[data-cockpit-office]")`);
            await focusCockpit(h);
            await key(h, "o");
            const officeByKey = (await waitForOffice(h)) == null;
            await toggleTo(h, "Cards");
            await sleep(400);
            const cardsByClick = await h.ev(`!document.querySelector("[data-cockpit-office]")`);
            await toggleTo(h, "Office");
            const officeByClick = (await waitForOffice(h)) == null;
            await settleBoss(h);
            rec(
                "15. o switches to Cards and back to Office, and so does the toggle beside Live only",
                cardsByKey && officeByKey && cardsByClick && officeByClick,
                JSON.stringify({ cardsByKey, officeByKey, cardsByClick, officeByClick })
            );

            // 16. RamPanel: the office's cost, and its button
            await h.ev(`document.querySelector("[data-worker-capacity]")?.click()`);
            await sleep(1500);
            const line = await h.ev(`document.querySelector("[data-consumers-office]")?.textContent ?? ""`);
            await h.shot("cdp-shots/cockpit-office-ram.png");
            await h.ev(`document.querySelector("[data-consumers-office-toggle]")?.click()`);
            await sleep(700);
            const offLine = await h.ev(`document.querySelector("[data-consumers-office]")?.textContent ?? ""`);
            const stopped = await probe(h);
            await h.ev(`document.querySelector("[data-consumers-office-toggle]")?.click()`);
            await h.ev(`window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }))`);
            rec(
                "16. the RAM panel shows the office's JS, people, images and nodes, and its button stops every clock",
                ["Office JS", "People", "Images", "DOM nodes"].every((w) => line.includes(w)) &&
                    offLine.includes("animation off") &&
                    stopped?.clock?.frame === false,
                JSON.stringify({ line, offLine, clock: stopped?.clock })
            );

            // 17. Settings → Appearance → Office: the office's animation switch and the work hours, and the switch is
            // the one the office reads (last: it leaves the Cockpit)
            await h.goto("settings");
            await h.ev(`document.querySelector('button[data-section="appearance"]')?.click()`);
            await h.ev(`(async () => {
                for (let i = 0; i < 50 && !document.querySelector('[data-setting-card="office"]'); i++) await new Promise((r) => setTimeout(r, 100));
            })()`);
            const SWITCH = `document.querySelector('[data-setting-row="appearance.officeanimation"] [role="switch"]')`;
            const card = await h.ev(`(() => {
                const c = document.querySelector('[data-setting-card="office"]');
                c?.scrollIntoView({ block: "center" });
                return {
                    found: !!c,
                    on: ${SWITCH}?.getAttribute("aria-checked") ?? null,
                    hours: c?.querySelector('[data-setting-row="appearance.officehours"]')?.textContent ?? "",
                };
            })()`);
            await h.shot("cdp-shots/cockpit-office-settings.png");
            await h.ev(`${SWITCH}?.click()`);
            await sleep(300);
            const stored = await h.ev(`localStorage.getItem("cockpit.office.animation")`);
            const flipped = await h.ev(`${SWITCH}?.getAttribute("aria-checked") ?? null`);
            await h.ev(`${SWITCH}?.click()`);
            await sleep(300);
            const restored = await h.ev(`localStorage.getItem("cockpit.office.animation")`);
            rec(
                "17. Settings → Appearance → Office holds the animation switch and the work hours (09:00 to 18:00), and the switch sets the office's animation",
                card.found &&
                    card.on === "true" &&
                    card.hours.includes("09:00") &&
                    card.hours.includes("18:00") &&
                    flipped === "false" &&
                    stored === "false" &&
                    restored === "true",
                JSON.stringify({ card, flipped, stored, restored })
            );

            return steps;
        },
        async teardown(h, ctx) {
            await fx.teardownFixtureRun(h, ctx, "cockpit-office", {
                what: "put back the view, the roster and the dev state",
                fn: async () => {
                    await h.ev("window.__cockpitOffice?.(null)");
                    await h.ev(
                        ctx.prevView == null
                            ? `localStorage.removeItem(${JSON.stringify(VIEW_KEY)})`
                            : `localStorage.setItem(${JSON.stringify(VIEW_KEY)}, ${JSON.stringify(ctx.prevView)})`
                    );
                    if (ctx.prevFixture != null) writeFileSync(FIXTURE, ctx.prevFixture);
                    rmSync(ctx.cwd, { recursive: true, force: true });
                },
            });
        },
    };
    // the spec's Benchmark: Cards then Office on the office-bench roster plus three fixture runs (~75 people)
    const cockpitOfficeBench = {
        name: "cockpit-office-bench",
        surface: "cockpit",
        async arrange(h) {
            const ctx = { prevFixture: existsSync(FIXTURE) ? readFileSync(FIXTURE, "utf8") : null };
            mkdirSync(new URL(".", FIXTURE), { recursive: true });
            writeFileSync(FIXTURE, JSON.stringify(ROSTERS["office-bench"](Date.now()), null, 2));
            ctx.prevView = await h.ev(`localStorage.getItem(${JSON.stringify(VIEW_KEY)})`);
            await h.ev(`localStorage.setItem(${JSON.stringify(VIEW_KEY)}, JSON.stringify("cards"))`);
            try {
                await h.ev("location.reload()");
            } catch {
                // the evaluate is cut off by the navigation it just started
            }
            // the old document can still answer for a moment after the reload starts
            await sleep(1500);
            for (let waited = 0; waited < 40000; waited += 500) {
                if (await h.ev("!!window.TabRpcClient && !!document.querySelector('nav button')").catch(() => false)) break;
                await sleep(500);
            }
            await h.goto("cockpit");
            ctx.missing = await h.ev(`(async () => {
                for (let i = 0; i < 120 && !(document.querySelector("[data-cockpit-view-toggle]") && window.__cockpitOffice); i++) await new Promise((r) => setTimeout(r, 250));
                return document.querySelector("[data-cockpit-view-toggle]") && window.__cockpitOffice ? null : "after 30 s the Cockpit has no view toggle or dev hooks";
            })()`);
            return ctx;
        },
        async assert(h, ctx) {
            const steps = [];
            const rec = (step, ok, detail) => steps.push({ step, ok: !!ok, detail });
            if (ctx.missing) {
                rec("0. the Cockpit loads", false, ctx.missing);
                return steps;
            }
            // without it Performance.getMetrics returns nothing and every budget reads NaN
            await h.cdp("Performance.enable");
            const r = {};
            const cards = await metrics(h);
            await sleep(HOLD_MS);
            const cardsHold = await metrics(h);
            r.baseBusyPct = round1(busyPct(cards, cardsHold));

            await dev(h, { runs: BENCH_RUNS });
            r.openMs = Math.round(
                await h.ev(`(async () => {
                    const t0 = performance.now();
                    [...document.querySelectorAll("[data-cockpit-view-toggle] button")].find((b) => b.textContent.trim() === "Office")?.click();
                    for (let i = 0; i < 600 && !document.querySelector("[data-office-desk]"); i++) await new Promise((r) => requestAnimationFrame(r));
                    return performance.now() - t0;
                })()`)
            );
            await sleep(2000);
            const open = await metrics(h);
            r.heapOpenMB = mb(open.heap - cardsHold.heap);
            r.nodesAdded = open.nodes - cardsHold.nodes;

            await dev(h, { patrol: true, walkers: 3 });
            await sleep(1000);
            const walk0 = await metrics(h);
            await sleep(HOLD_MS);
            const walk1 = await metrics(h);
            r.busyRawPct = round1(busyPct(walk0, walk1));
            r.busyPct = round1(r.busyRawPct - r.baseBusyPct);

            // the quiet office (spec: every agent idle inside the Finished window, the hold starting once everyone has
            // settled). Quiet brings the lounge's 18 people back to their desks; walking back three at a time would take
            // a minute, so the animation goes off for a moment and they are there at once. The hold starts when no one
            // walks and no clock runs (the cheers of the desks that just turned done last 1.5 s).
            await dev(h, { patrol: false, walkers: 0 });
            await h.ev("window.__cockpitOfficeAnimation(false)");
            await dev(h, { quiet: true });
            await sleep(300);
            await h.ev("window.__cockpitOfficeAnimation(true)");
            const settleT0 = Date.now();
            let settled = null;
            for (let t = 0; t < 10_000 && settled == null; t += 200) {
                const q = await probe(h);
                if (q?.walking === 0 && q.clock?.frame === false && q.clock?.walk === false) settled = q;
                else await sleep(200);
            }
            r.quietSettleMs = settled ? Date.now() - settleT0 : null;
            const quiet0 = await metrics(h);
            await sleep(HOLD_MS);
            const quiet1 = await metrics(h);
            r.busyQuietPct = round1(busyPct(quiet0, quiet1) - r.baseBusyPct);
            const quietEnd = await probe(h);
            r.clockQuiet = quietEnd?.clock;
            r.walkingQuiet = quietEnd?.walking;

            await h.cdp("Emulation.setEmulatedMedia", { features: [{ name: "prefers-reduced-motion", value: "reduce" }] });
            await dev(h, { quiet: false, patrol: true, walkers: 3 });
            await sleep(1000);
            const red0 = await metrics(h);
            await sleep(HOLD_MS);
            const red1 = await metrics(h);
            r.busyReducedPct = round1(busyPct(red0, red1) - r.baseBusyPct);
            await h.cdp("Emulation.setEmulatedMedia", { features: [] });
            await dev(h, { patrol: false, walkers: 0 });

            // the lounge holds 18 and reads +N past them, so the people drawn are not the roster: count the plan's desks
            // and seats plus the boss, once the walkers who go to the lounge three at a time have arrived
            let p = await probe(h);
            for (let t = 0; t < 20_000 && p?.walking !== 0; t += 250) {
                await sleep(250);
                p = await probe(h);
            }
            r.roster = (p?.desks ?? 0) + (p?.seats ?? 0) + 1;
            r.people = p?.people;
            r.cache = p?.cache?.entries;

            const toggle = (label) =>
                h.ev(`[...document.querySelectorAll("[data-cockpit-view-toggle] button")].find((b) => b.textContent.trim() === ${JSON.stringify(label)})?.click()`);
            await toggle("Cards");
            await sleep(2000);
            const closed = await metrics(h);
            r.heapAfterMB = mb(closed.heap - cardsHold.heap);

            // a second round trip: the first one's figure carries the dev page's own growth (+1.56 MB with the office
            // never opened), so what the office keeps is what a second open and close adds
            await toggle("Office");
            await h.ev(`(async () => {
                for (let i = 0; i < 600 && !document.querySelector("[data-office-desk]"); i++) await new Promise((r) => requestAnimationFrame(r));
            })()`);
            await sleep(2000);
            await toggle("Cards");
            await sleep(2000);
            const trip = await metrics(h);
            r.heapTripMB = mb(trip.heap - closed.heap);

            rec("0. the bench holds about 75 people (desks, seats and the boss)", r.roster >= 70, `${r.roster} (${p?.desks} desks, ${p?.seats} seats, ${p?.people} drawn)`);
            rec("1. JS heap, Office minus Cards <= 5 MB", r.heapOpenMB <= 5, `${r.heapOpenMB} MB`);
            rec("2. DOM nodes added <= 2,000", r.nodesAdded <= 2000, `${r.nodesAdded}`);
            rec("3. main thread busy walking, over the Cards baseline <= 2 %", r.busyPct <= 2, `${r.busyPct} % (${r.busyRawPct} % raw, baseline ${r.baseBusyPct} %)`);
            rec("4. busy under reduced motion <= 0.5 %", r.busyReducedPct <= 0.5, `${r.busyReducedPct} %`);
            rec(
                "5. busy in a quiet office (everyone settled at a desk) <= 0.3 %, no one walking and no clock running",
                r.quietSettleMs != null && r.busyQuietPct <= 0.3 && r.walkingQuiet === 0 && r.clockQuiet?.frame === false && r.clockQuiet?.walk === false,
                `${r.busyQuietPct} %, settled in ${r.quietSettleMs} ms, ${r.walkingQuiet} walking, ${JSON.stringify(r.clockQuiet)}`
            );
            rec("6. sprite cache <= 600 entries", r.cache <= 600, `${r.cache}`);
            rec("7. heap a second Office round trip adds, back in Cards <= 1 MB", r.heapTripMB <= 1, `${r.heapTripMB} MB (first return ${r.heapAfterMB} MB over the first Cards read)`);
            rec("8. toggle click to the office drawn <= 150 ms", r.openMs <= 150, `${r.openMs} ms`);
            console.log(`[cockpit-office-bench] ${JSON.stringify(r)}`);
            return steps;
        },
        async teardown(h, ctx) {
            await h.ev("window.__cockpitOffice?.(null)");
            await h.cdp("Emulation.setEmulatedMedia", { features: [] });
            await h.ev(
                ctx.prevView == null
                    ? `localStorage.removeItem(${JSON.stringify(VIEW_KEY)})`
                    : `localStorage.setItem(${JSON.stringify(VIEW_KEY)}, ${JSON.stringify(ctx.prevView)})`
            );
            if (ctx.prevFixture != null) writeFileSync(FIXTURE, ctx.prevFixture);
            else rmSync(FIXTURE, { force: true });
            await h.ev("location.reload()");
            await sleep(1500);
        },
    };

    return { cockpitOffice, cockpitOfficeBench };
}
