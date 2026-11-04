// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0
//
// council-ideas (docs/superpowers/specs/2026-11-04-council-ideas-memory-design.md, section 1; the plan: docs/superpowers/
// plans/2026-11-04-council-ideas-memory.md, Task 7): the Ideas tab of the council's rail grouped by where the seats stand
// on each idea (board Ideas-by-stance, .superpowers/design/council-ideas-memory). The hooks are called by
// councilscenarios.mjs as arrange(h, fx), assert(h, ctx, fx), teardown(h, ctx, fx).
//
// Nothing here calls a model. The council is the running round-2 fixture with its ideas and replies replaced by nine
// ideas, an idea or two in every group (one held for the person, one withdrawn by its author in round 2, one cut by the
// person), written into the data dir as a JSON file. Step 2 writes it again with one stance changed.

import { waitFor } from "../attach.mjs";
import { announceCouncil, arrangeCouncilProject, councilFixtureId, openCouncil, teardownCouncilProject, writeCouncil } from "./fixtures.mjs";

const WAIT_MS = 10_000;
const RAIL = "[data-council-rail]";
const SEATS = "[data-council-discussion] header [data-council-seats]";
const SEAT_LIST = "[data-council-seat-list]";

// the six groups in the order the rail draws them, with the name each header gives it and the `@theme` token it is
// drawn in
const GROUPS = [
    { key: "waiting", name: "Waiting on you", tone: "muted" },
    { key: "agreed", name: "Agreed", tone: "success" },
    { key: "doubts", name: "Has doubts", tone: "warning" },
    { key: "against", name: "Someone against it", tone: "error" },
    { key: "none", name: "No stance yet", tone: "ink-faint" },
    { key: "withdrawn", name: "Withdrawn", tone: "edge-strong" },
];

const q = (s) => JSON.stringify(s);
const until = (h, expr, ms = WAIT_MS) => waitFor((e) => h.ev(e), expr, ms);
const click = (h, sel) =>
    h.ev(`(() => { const el = document.querySelector(${q(sel)}); if (el == null || el.disabled) return false; el.click(); return true; })()`);

// the fixture's ideas, P1 to P9, in the order they arrive:
//   P1, P2   Agreed             (RAM and New user accept P1; UX accepts P2)
//   P3       Has doubts         (Skeptic challenges, UX accepts)
//   P4       Someone against it (Skeptic opposes, RAM accepts)
//   P5, P6   No stance yet      (nobody has answered)
//   P7       Waiting on you     (a draft held for the person)
//   P8       Withdrawn          (Skeptic withdrew it in round 2: its author's revising reply)
//   P9       Withdrawn          (cut by the person at the pause)
// `moved` is step 2's change: Skeptic opposes P2, so it leaves Agreed for Someone against it
function ideasOf(c, { moved = false } = {}) {
    const ts = (s) => c.started + s * 1000;
    const idea = (id, author, s, title, extra = {}) => ({ id, author, title, argument: `${title}.`, ts: ts(s), ...extra });
    const reply = (id, proposalid, author, s, text, extra = {}) => ({ id, proposalid, author, text, round: 2, ts: ts(s), ...extra });
    c.proposals = [
        idea("P1", "ux", 100, "Show asleep and waking on the rail icon"),
        idea("P2", "ram", 105, "Keep the last-used pinned app awake"),
        idea("P3", "newuser", 110, "Show the empty rail slots with a pin hint"),
        idea("P4", "ux", 115, "Move the rail pins from localStorage to settings"),
        idea("P5", "ram", 120, "Measure a woken app before keeping any awake"),
        idea("P6", "newuser", 125, "Let a pinned app open from the palette"),
        idea("P7", "skeptic", 130, "Cap the rail at three apps", { draft: "held" }),
        idea("P8", "skeptic", 135, "Drop the cap of 3 apps", { withdrawn: true }),
        idea("P9", "ux", 140, "Draw the rail in two columns", { cut: true }),
    ];
    c.replies = [
        { ...reply("r1", "P1", "ram", 200, "The state is already in ServiceStatus."), stance: "accept" },
        { ...reply("r2", "P1", "newuser", 205, "I would wait instead of clicking twice."), stance: "accept" },
        { ...reply("r3", "P2", "ux", 210, "Fine, if the number decides."), stance: "accept" },
        { ...reply("r4", "P3", "skeptic", 215, "Chrome on a rail that should stay quiet."), stance: "challenge" },
        { ...reply("r5", "P3", "ux", 220, "Teaches the cap before it bites."), stance: "accept" },
        { ...reply("r6", "P4", "skeptic", 225, "A migration with no rollback."), stance: "oppose" },
        { ...reply("r7", "P4", "ram", 230, "No cost."), stance: "accept" },
        // the author's own revising reply is the withdrawal: round 2
        reply("r8", "P8", "skeptic", 235, "Withdrawn.", { revised: true }),
    ];
    if (moved) {
        c.replies.push({ ...reply("r9", "P2", "skeptic", 260, "Holding one awake costs memory."), stance: "oppose" });
    }
}

// what the rail draws: its tab label and caption, each group with the dot's colour and its rows (the bar's colour and
// tone, whether the title is struck through, the quiet line), and the colour each token resolves to (read through a
// probe element, so a theme override is followed)
const readRail = (h) =>
    h.ev(`(() => {
        const rail = document.querySelector(${q(RAIL)});
        if (!rail) return null;
        const norm = (e) => (e?.textContent ?? "").replace(/\\s+/g, " ").trim();
        const colour = (css) => {
            const probe = document.createElement("i");
            probe.style.background = css;
            document.body.appendChild(probe);
            const v = getComputedStyle(probe).backgroundColor;
            probe.remove();
            return v;
        };
        const tones = {};
        for (const tone of ["muted", "success", "warning", "error", "ink-faint", "edge-strong"]) {
            tones[tone] = colour("var(--color-" + tone + ")");
        }
        return {
            tab: rail.getAttribute("data-rail-tab"),
            tabLabel: norm(rail.querySelector('[data-council-rail-tab="ideas"]')),
            caption: norm(rail.querySelector("[data-council-rail-caption]")),
            tones,
            groups: [...rail.querySelectorAll("[data-council-rail-group]")].map((g) => ({
                key: g.getAttribute("data-council-rail-group"),
                name: norm(g.querySelector("[data-council-rail-group-name]")),
                count: Number(norm(g.querySelector("[data-council-rail-group-count]"))),
                dot: getComputedStyle(g.querySelector("[data-council-rail-dot]")).backgroundColor,
                rows: [...g.querySelectorAll("[data-council-rail-idea]")].map((r) => {
                    const bar = r.querySelector("[data-council-rail-bar]");
                    return {
                        id: r.getAttribute("data-council-rail-idea"),
                        who: norm(r.querySelector("[data-council-rail-who]")),
                        meta: norm(r.querySelector("[data-council-rail-meta]")),
                        tone: bar?.getAttribute("data-council-rail-bar") ?? null,
                        bar: bar ? getComputedStyle(bar).backgroundColor : null,
                        struck: getComputedStyle(r.querySelector("[data-council-rail-title]")).textDecorationLine.includes("line-through"),
                    };
                }),
            })),
        };
    })()`);

// the rail's groups as `key:P1,P2` words, in the order drawn
const shape = (rail) => (rail?.groups ?? []).map((g) => `${g.key}:${g.rows.map((r) => r.id).join(",")}`);
const rowOf = (rail, id) => (rail?.groups ?? []).flatMap((g) => g.rows).find((r) => r.id === id);

// the seat list opened (true) or closed (false) by a click on the stack, which toggles it; true once it is as asked
async function setSeats(h, want) {
    await until(h, `!!document.querySelector(${q(SEATS)})`);
    await h.ev(`(() => {
        const b = document.querySelector(${q(SEATS)});
        if (b && (b.getAttribute("aria-expanded") === "true") !== ${want}) b.click();
    })()`);
    return until(h, want ? `!!document.querySelector(${q(SEAT_LIST)})` : `!document.querySelector(${q(SEAT_LIST)})`);
}

export const councilIdeas = {
    async arrange(h, fx) {
        const ctx = await arrangeCouncilProject(h, fx);
        try {
            // a fresh start: the rail shows unless the person folded it
            await h.ev(`(() => { try { localStorage.removeItem("council.ideasRail.folded"); } catch {} })()`);
            ctx.id = writeCouncil(ctx, "round2", { id: `${councilFixtureId("round2")}-ideas`, edit: (c) => ideasOf(c) });
        } catch (e) {
            await teardownCouncilProject(h, ctx).catch(() => {});
            throw e;
        }
        return ctx;
    },

    async assert(h, ctx) {
        const steps = [];
        const rec = (step, ok, detail) => steps.push({ step, ok, detail: JSON.stringify(detail) });
        const rows = (n) => until(h, `document.querySelectorAll(${q(`${RAIL} [data-council-rail-idea]`)}).length === ${n}`);

        // 1. the Ideas tab of the rail, an idea in every group
        await openCouncil(h, ctx.id, "discussion");
        const drawn = await rows(9);
        const one = await readRail(h);
        await h.shot("cdp-shots/council-ideas-groups.png");
        rec(
            "1. the Ideas tab groups the nine ideas under six headers in the order Waiting on you, Agreed, Has doubts, Someone against it, No stance yet, Withdrawn, each header's name in words with its count, no caption over them (the headers say it), and an idea keeping its arrival order inside its group",
            drawn &&
                one?.tab === "ideas" &&
                one.tabLabel === "Ideas · 9" &&
                one.caption === "" &&
                one.groups.map((g) => g.key).join() === GROUPS.map((g) => g.key).join() &&
                one.groups.map((g) => g.name).join("|") === GROUPS.map((g) => g.name).join("|") &&
                one.groups.map((g) => g.count).join() === "1,2,1,1,2,2" &&
                shape(one).join(" ") === "waiting:P7 agreed:P1,P2 doubts:P3 against:P4 none:P5,P6 withdrawn:P8,P9",
            { drawn, tab: one?.tab, tabLabel: one?.tabLabel, caption: one?.caption, groups: shape(one), names: one?.groups.map((g) => g.name), counts: one?.groups.map((g) => g.count) }
        );

        // each header's dot and each row's bar are in the group's token colour (Waiting on you has no bar: it is
        // transparent), and only the Withdrawn group's titles are struck through
        const tones = Object.fromEntries(GROUPS.map((g) => [g.key, g.tone]));
        const colouredRight = (one?.groups ?? []).every(
            (g) =>
                g.dot === one.tones[tones[g.key]] &&
                g.rows.every((r) =>
                    g.key === "waiting"
                        ? r.tone === "muted" && r.bar === "rgba(0, 0, 0, 0)"
                        : r.tone === tones[g.key] && r.bar === one.tones[tones[g.key]]
                )
        );
        const distinct = new Set((one?.groups ?? []).map((g) => g.dot)).size === GROUPS.length;
        const struckRight = (one?.groups ?? []).every((g) => g.rows.every((r) => r.struck === (g.key === "withdrawn")));
        rec(
            "1. every header's dot and every row's bar is drawn in its group's token colour (six different colours; Waiting on you draws no bar), and only the Withdrawn titles are struck through",
            colouredRight && distinct && struckRight,
            { colouredRight, distinct, struckRight, tones: one?.tones, dots: one?.groups.map((g) => g.dot) }
        );

        const p8 = rowOf(one, "P8");
        const p9 = rowOf(one, "P9");
        rec(
            "1. P8, withdrawn by its author in round 2, reads `withdrawn in round 2`, P9, cut by the person, reads `cut by you`, the held P7 reads `draft waits`, and a row keeps its number and seat (`Idea 8 · Skeptic`)",
            p8?.meta === "withdrawn in round 2" &&
                p9?.meta === "cut by you" &&
                rowOf(one, "P7")?.meta === "draft waits" &&
                // a ` · new` badge may follow, depending on when this profile first opened the app (councilopened.ts)
                /^Idea 8 · Skeptic( · new)?$/.test(p8?.who ?? "") &&
                /^Idea 4 · UX( · new)?$/.test(rowOf(one, "P4")?.who ?? ""),
            { p7: rowOf(one, "P7"), p8, p9, p4: rowOf(one, "P4") }
        );

        // 2. a stance changes in the record: the idea moves group, live
        writeCouncil(ctx, "round2", { id: ctx.id, edit: (c) => ideasOf(c, { moved: true }) });
        await announceCouncil(h, ctx, ctx.id);
        const moved = await until(h, `!!document.querySelector(${q(`${RAIL} [data-council-rail-group="against"] [data-council-rail-idea="P2"]`)})`);
        const two = await readRail(h);
        await h.shot("cdp-shots/council-ideas-moved.png");
        rec(
            "2. once Skeptic opposes P2 it leaves Agreed for Someone against it (arrival order there: P2, then P4), the two counts follow, and its quiet line names the stance",
            moved &&
                shape(two).join(" ") === "waiting:P7 agreed:P1 doubts:P3 against:P2,P4 none:P5,P6 withdrawn:P8,P9" &&
                two.groups.map((g) => g.count).join() === "1,1,1,2,2,2" &&
                /is against it/.test(rowOf(two, "P2")?.meta ?? "") &&
                two.tabLabel === "Ideas · 9",
            { moved, groups: shape(two), counts: two?.groups.map((g) => g.count), p2: rowOf(two, "P2") }
        );

        // 3. one seat chosen: only its ideas show, still grouped (a group it has no idea in is left out)
        const listed = await setSeats(h, true);
        await click(h, `${SEAT_LIST} [data-council-filter='skeptic']`);
        const filtered = await until(h, `document.querySelectorAll(${q(`${RAIL} [data-council-rail-idea]`)}).length === 5`);
        const three = await readRail(h);
        await h.shot("cdp-shots/council-ideas-seat.png");
        rec(
            "3. with Skeptic chosen in the seats' list the rail shows only its five ideas (P2, P3, P4 it replied to, P7 and P8 it wrote), grouped as before, with Agreed and No stance yet left out and the tab reading `Ideas · 5`",
            listed &&
                filtered &&
                shape(three).join(" ") === "waiting:P7 doubts:P3 against:P2,P4 withdrawn:P8" &&
                three.groups.map((g) => g.count).join() === "1,1,2,1" &&
                three.tabLabel === "Ideas · 5",
            { listed, filtered, groups: shape(three), counts: three?.groups.map((g) => g.count), tabLabel: three?.tabLabel }
        );

        // Show everyone gives the nine ideas back, in their six groups
        await click(h, "[data-council-action='show-everyone']");
        const back = await rows(9);
        const all = await readRail(h);
        await setSeats(h, false);
        rec(
            "3. Show everyone brings the nine ideas back, grouped as in step 2",
            back && shape(all).join(" ") === shape(two).join(" "),
            { back, groups: shape(all) }
        );

        return steps;
    },

    async teardown(h, ctx) {
        await teardownCouncilProject(h, ctx);
    },
};
