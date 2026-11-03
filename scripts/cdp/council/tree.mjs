// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0
//
// council-tree (docs/superpowers/plans/2026-10-21-council.md, Task 13): the council rows in the Agent tree, the New
// dialog's Council row and the palette's New council… row. The fixture project holds the round2, awaiting, done and notrun
// councils and a terminal; a second registered project holds a terminal and no council, and so no Councils block. Nothing
// here starts a council or calls a model: New council only opens Setup, and Remove from queue (a queued council, step 10)
// and Pin / Unpin (the Report's tab bar, a tree row and a Councils row, step 11) have their stop and pin commands replaced
// in the page. Steps 11d to 11f (docs/superpowers/plans/2026-11-03-council-ux.md, Task 6) check the tree rule with two
// councils placed three days back and marked opened: the pinned one drawn at its folder's top, the unpinned one off the
// tree, and Unpin from the Report taking the pinned one off too. Step 11g
// (docs/superpowers/plans/2026-11-03-council-ux-fix-1.md) does the same for a pinned, stopped council with no summary,
// whose ended time is its `updated`: Unpin from its tree row takes it off the tree.
//
// The hooks are called by councilscenarios.mjs as arrange(h, fx), assert(h, ctx, fx), teardown(h, ctx, fx). The tree is
// read as one flat list (the rows of [data-agent-active-rows] in the order they are drawn), cut at each project's folder.
//
// Steps 1 to 11 expect the four councils and no agent rows. Steps 12 on (docs/superpowers/plans/2026-10-29-council-live-agents.md,
// Task 10) put the room's two live agents in the tree (the fixture roster, writeRoomRoster, which reloads the page), seat
// them in the `room` councils and a queued one behind them, and drive the tree's multi-select with real clicks: Ctrl+click,
// Shift+click, a plain click, the right-click menu and its Discuss together, which opens Setup with both agents seated.
// The second agent works in a second registered project (ROOM_AGENTS), so Discuss together can find its path.

import { waitFor } from "../attach.mjs";
import {
    announceCouncil,
    arrangeCouncilProject,
    COUNCIL_ID_PREFIX,
    COUNCIL_PROJECT,
    councilFixtureId,
    loadCouncilFixture,
    openCouncil,
    openSetupFromNew,
    restoreRoomRoster,
    ROOM_AGENTS,
    rpcCalls,
    seedCouncil,
    stubRpc,
    teardownCouncilProject,
    unstubRpc,
    writeCouncil,
    writeRoomRoster,
} from "./fixtures.mjs";

export const EMPTY_PROJECT = "council-empty";

// oldest first: the tree lists them newest first, so the order they are written in is not the order they are drawn in
const SEEDED = ["notrun", "done", "awaiting", "round2"];
const TREE_ORDER = ["round2", "awaiting", "done", "notrun"];
const METAS = ["Running", "Waiting on you", "Done", "Not run"];

const ROWS_WAIT_MS = 10_000;
const UI_WAIT_MS = 5_000;
const NOTICE_SETTLE_MS = 600;
const DAY_MS = 24 * 60 * 60 * 1000;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// the corner toasts whose text holds `text`, and the row's meta and unread dot, as the page shows them
const toastsWith = (text) =>
    `[...document.querySelectorAll("[data-notification-toast]")].filter((t) => (t.textContent || "").includes(${JSON.stringify(text)}))`;
const rowMeta = (id) =>
    `(document.querySelector(${JSON.stringify(`[data-council-row="${id}"] [data-council-meta]`)})?.textContent ?? "").trim()`;
const unreadDot = (id) => `!!document.querySelector(${JSON.stringify(`[data-council-row="${id}"] [data-council-unread]`)})`;

// every row of the Active tree in the order drawn, each reduced to what a step reads
const TREE_ROWS = `(() => {
    const flat = (el) => (el?.textContent ?? "").replace(/\\s+/g, " ").trim();
    return [...document.querySelectorAll("[data-agent-active-rows] > *")].map((w) => {
        const folder = w.querySelector("[data-project-folder]");
        if (folder) return { kind: "folder", project: folder.dataset.projectFolder };
        const head = w.querySelector("[data-council-head]");
        if (head) return { kind: "head", project: head.dataset.councilHead, text: flat(head) };
        const row = w.querySelector("[data-council-row]");
        if (row) {
            return {
                kind: "council",
                id: row.dataset.councilRow,
                feature: flat(row.querySelector("[data-council-feature]")),
                meta: flat(row.querySelector("[data-council-meta]")),
                tone: row.dataset.councilTone,
                current: row.getAttribute("aria-current") === "true",
            };
        }
        if (w.querySelector("[data-project-divider]")) return { kind: "divider" };
        if (w.querySelector("[data-agent-terminal-row]")) return { kind: "terminal" };
        return { kind: "other" };
    });
})()`;

// the rows under one project's folder, up to the next folder; null when the tree has no such folder
function folderRows(rows, project) {
    const at = rows.findIndex((r) => r.kind === "folder" && r.project === project);
    if (at < 0) return null;
    const next = rows.findIndex((r, i) => i > at && r.kind === "folder");
    return rows.slice(at + 1, next < 0 ? undefined : next);
}

// a meta's color next to the token it should be drawn in, both as the browser computes them
const metaColor = (id, token) => `(() => {
    const probe = document.createElement("span");
    probe.style.color = ${JSON.stringify(`var(--color-${token})`)};
    document.body.appendChild(probe);
    const want = getComputedStyle(probe).color;
    probe.remove();
    const meta = document.querySelector(${JSON.stringify(`[data-council-row="${id}"] [data-council-meta]`)});
    return { want, got: meta ? getComputedStyle(meta).color : null };
})()`;

const present = (selector) => `!!document.querySelector(${JSON.stringify(selector)})`;
const click = (selector) => `(() => {
    const el = document.querySelector(${JSON.stringify(selector)});
    if (!el) return false;
    el.click();
    return true;
})()`;

// Input.dispatchMouseEvent's modifiers bitmask: Ctrl=2, Meta=4, Shift=8. The tree toggles on Ctrl or Cmd, and Control+click
// is the right click on a Mac, so the toggle is Command there
const TOGGLE_BIT = process.platform === "darwin" ? 4 : 2;
const SHIFT_BIT = 8;

// a real click (or right click) at the middle of the first element `selector` matches, with the modifiers held; false when
// it is not on screen
async function mouseOn(h, selector, { button = "left", modifiers = 0 } = {}) {
    const box = await h.ev(`(() => {
        const el = document.querySelector(${JSON.stringify(selector)});
        el?.scrollIntoView({ block: "nearest" });
        const r = el?.getBoundingClientRect();
        return r && r.width > 0 ? { x: Math.round(r.x + r.width / 2), y: Math.round(r.y + r.height / 2) } : null;
    })()`);
    if (box == null) return false;
    const held = button === "right" ? 2 : 1;
    await h.cdp("Input.dispatchMouseEvent", { type: "mouseMoved", x: box.x, y: box.y, modifiers });
    await h.cdp("Input.dispatchMouseEvent", {
        type: "mousePressed",
        x: box.x,
        y: box.y,
        button,
        buttons: held,
        clickCount: 1,
        modifiers,
    });
    await h.cdp("Input.dispatchMouseEvent", {
        type: "mouseReleased",
        x: box.x,
        y: box.y,
        button,
        buttons: 0,
        clickCount: 1,
        modifiers,
    });
    return true;
}

// the pointer moved onto the middle of the first element `selector` matches, with no click; false when it is not on
// screen
async function hoverOn(h, selector) {
    const box = await h.ev(`(() => {
        const el = document.querySelector(${JSON.stringify(selector)});
        el?.scrollIntoView({ block: "nearest" });
        const r = el?.getBoundingClientRect();
        return r && r.width > 0 ? { x: Math.round(r.x + r.width / 2), y: Math.round(r.y + r.height / 2) } : null;
    })()`);
    if (box == null) return false;
    await h.cdp("Input.dispatchMouseEvent", { type: "mouseMoved", x: box.x, y: box.y });
    return true;
}

// hoverOn until shown holds, hovering again at the row's current place each try: a row that moves under the pointer
// (a council just pinned climbs to its folder's top) leaves the hover on whichever row took its place
async function hoverUntil(h, selector, shown, tries = 5, ms = 1500) {
    for (let i = 0; i < tries; i++) {
        if (await hoverOn(h, selector)) {
            if (await waitFor((e) => h.ev(e), shown, ms)) return true;
        } else {
            await new Promise((r) => setTimeout(r, 200));
        }
    }
    return false;
}

async function pressEscape(h) {
    for (const type of ["keyDown", "keyUp"]) {
        await h.cdp("Input.dispatchKeyEvent", { type, key: "Escape", code: "Escape", windowsVirtualKeyCode: 27 });
    }
}

// the agent rows the tree draws as picked (Ctrl/Cmd+click, Shift+click), and the right-click menu's rows, as the page shows them
const PICKED = `[...document.querySelectorAll("[data-agent-picked]")].map((e) => e.dataset.agentRow).sort()`;
const MENU_ITEMS = `[...document.querySelectorAll("[data-menu-item]")].map((e) => e.dataset.menuItem)`;
const sameIds = (got, want) => JSON.stringify([...(got ?? [])].sort()) === JSON.stringify([...want].sort());
// the `in council` tag at the end of an agent row's second line, and the row's text
const inCouncilTag = (id) =>
    `(document.querySelector(${JSON.stringify(`[data-agent-row="${id}"] [data-agent-in-council]`)})?.textContent ?? "").trim()`;

const PALETTE_INPUT = `document.querySelector('input[data-palette-input]')`;
// React reads the palette's keys off its input's own keydown, so they go there
const paletteEnter = `(() => {
    const el = ${PALETTE_INPUT};
    if (!el) return false;
    el.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", code: "Enter", bubbles: true }));
    return true;
})()`;
const paletteType = (text) => `(() => {
    const el = ${PALETTE_INPUT};
    if (!el) return false;
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value").set.call(el, ${JSON.stringify(text)});
    el.dispatchEvent(new Event("input", { bubbles: true }));
    return true;
})()`;
const PALETTE_SELECTED = `(() => {
    const row = document.querySelector('input[data-palette-input]')
        ?.closest('[role="dialog"]')
        ?.querySelector('[role="listbox"][aria-label="Results"] button[data-idx][aria-selected="true"]');
    return (row?.textContent ?? "").replace(/\\s+/g, " ").trim();
})()`;

export const councilTree = {
    async arrange(h, fx) {
        // the room's second agent works in a project of its own, which has to be registered for its path to be known
        const ctx = await arrangeCouncilProject(h, fx, { extraProjects: [EMPTY_PROJECT, ROOM_AGENTS[1].project] });
        try {
            ctx.ids = {};
            // seedCouncil announces each one, so the tree (already loaded, empty) reads the list again
            for (const name of SEEDED) ctx.ids[name] = await seedCouncil(h, ctx, name);
            // best effort: the tree is mounted while the surface is hidden, so the rows can be waited for before goto, and
            // the scenario's first shot then shows them. The first step reads them again and says what is missing.
            await waitFor(
                (e) => h.ev(e),
                `document.querySelectorAll("[data-council-row]").length === ${SEEDED.length}`,
                ROWS_WAIT_MS
            );
        } catch (e) {
            await teardownCouncilProject(h, ctx).catch(() => {});
            throw e;
        }
        return ctx;
    },

    async assert(h, ctx, fx) {
        const steps = [];
        const rec = (step, ok, detail) => steps.push({ step, ok, detail });
        const expected = TREE_ORDER.map((n) => councilFixtureId(n));
        const rows = () => h.ev(TREE_ROWS);
        const until = (expr, ms = UI_WAIT_MS) => waitFor((e) => h.ev(e), expr, ms);

        await until(`document.querySelectorAll("[data-council-row]").length === ${SEEDED.length}`, ROWS_WAIT_MS);
        const all = await rows();

        // 1. the fixture project's folder
        const mine = folderRows(all, COUNCIL_PROJECT);
        const councils = (mine ?? []).filter((r) => r.kind === "council");
        const head = (mine ?? [])[0];
        const tail = (mine ?? []).slice(1 + councils.length);
        rec(
            "1. the fixture project's folder lists Councils and four councils newest first, ahead of its terminal, with no New council row",
            mine != null &&
                head?.kind === "head" &&
                head.text === "Councils" &&
                (mine ?? [])[1]?.kind === "council" &&
                councils.length === expected.length &&
                councils.every((c, i) => c.id === expected[i]) &&
                tail.every((r) => r.kind === "divider" || r.kind === "terminal") &&
                tail.some((r) => r.kind === "terminal"),
            JSON.stringify(mine)
        );

        // 2. their metas
        rec(
            "2. their metas read Running, Waiting on you, Done and Not run",
            councils.length === METAS.length && councils.every((c, i) => c.meta === METAS[i]),
            JSON.stringify(councils.map((c) => ({ id: c.id, meta: c.meta, tone: c.tone })))
        );

        // 3. the Waiting on you meta is the amber token, drawn apart from the working and muted ones
        const asking = await h.ev(metaColor(councilFixtureId("awaiting"), "asking"));
        const working = await h.ev(metaColor(councilFixtureId("round2"), "working"));
        const muted = await h.ev(metaColor(councilFixtureId("done"), "muted"));
        rec(
            "3. the Waiting on you meta is drawn in the amber token, Running in the working one and Done in the muted one",
            asking.got != null &&
                asking.got === asking.want &&
                working.got === working.want &&
                muted.got === muted.want &&
                asking.want !== working.want &&
                asking.want !== muted.want,
            JSON.stringify({ asking, working, muted })
        );

        // 4. the project with no council
        const empty = folderRows(all, EMPTY_PROJECT);
        rec(
            "4. the project with no council has no Councils block: its folder holds only its terminal",
            empty != null && empty.length > 0 && empty.every((r) => r.kind === "terminal"),
            JSON.stringify(empty)
        );

        // 4b. each row reads as a chat-list row (docs/superpowers/specs/2026-11-02-council-chat-rows-design.md): two seat
        // circles overlapped in a 32px square (the first two panel seats, UX and RAM, the front one ringed), the feature,
        // and under it the state word then ` · <age>`; the Running council's picture carries the working dot
        const chat = await h.ev(`(() => {
            const box = (el) => { const r = el.getBoundingClientRect(); return { x: r.left, y: r.top, w: r.width, h: r.height }; };
            return ${JSON.stringify(expected)}.map((id) => {
                const row = document.querySelector('[data-council-row="' + id + '"]');
                const pic = row?.querySelector("[data-council-seats]");
                const discs = [...(pic?.querySelectorAll("[data-council-seat]") ?? [])];
                const feature = row?.querySelector("[data-council-feature]");
                const meta = row?.querySelector("[data-council-meta]");
                const age = row?.querySelector("[data-council-age]");
                return {
                    id,
                    row: row ? box(row).h : null,
                    pic: pic ? box(pic) : null,
                    seats: discs.map((d) => d.dataset.councilSeat),
                    discs: discs.map(box),
                    ring: discs.map((d) => getComputedStyle(d).boxShadow !== "none"),
                    dot: pic?.dataset.councilDot ?? null,
                    twoLines: !!feature && !!meta && box(meta).y >= box(feature).y + box(feature).h - 1,
                    age: (age?.textContent ?? "").replace(/\\s+/g, " ").trim(),
                };
            });
        })()`);
        const chatOk = (r) =>
            r.pic != null &&
            Math.round(r.pic.w) === 32 &&
            Math.round(r.pic.h) === 32 &&
            r.seats.join() === "UX,RA" &&
            r.discs.every((d) => Math.round(d.w) === 22) &&
            // the back circle sits top right, the front one bottom left, and they overlap
            r.discs[0].x > r.discs[1].x &&
            r.discs[0].y < r.discs[1].y &&
            r.discs[1].x + r.discs[1].w > r.discs[0].x &&
            r.ring[0] === false &&
            r.ring[1] === true &&
            r.twoLines &&
            /^· (<1m|\d+[mhd])$/.test(r.age) &&
            r.row >= 40 &&
            r.row <= 48;
        rec(
            "4b. each council row is a chat-list row: two overlapped seat circles (UX, RA; the front one ringed), the feature over `state · age`, about 44px tall, and the Running one's picture dotted working",
            chat.length === expected.length &&
                chat.every(chatOk) &&
                chat.every((r, i) => r.dot === (i === 0 ? "working" : null)),
            JSON.stringify(chat)
        );
        await h.shot("cdp-shots/council-tree-chat-rows.png");

        // 5. a council row opens its Discussion, and reads as selected there
        const round2 = councilFixtureId("round2");
        await h.ev(click(`[data-council-row="${round2}"]`));
        const discussion = await until(present("[data-council-discussion]"));
        const afterOpen = (folderRows(await rows(), COUNCIL_PROJECT) ?? []).filter((r) => r.kind === "council");
        rec(
            "5. clicking the Running row opens that council's Discussion",
            discussion && afterOpen.filter((c) => c.current).map((c) => c.id).join() === round2,
            JSON.stringify(afterOpen.map((c) => ({ id: c.id, current: c.current })))
        );

        // 6. New → Council → the project with no council → Set up council opens Setup there
        await h.ev(`window.__openLauncher?.("agent")`);
        await until(present("[data-launcher]"));
        await fx.openLauncherStart(h);
        await until(present('[data-start-row="council"]'));
        await h.ev(click('[data-start-row="council"]'));
        await until(present("[data-launcher-council-note]"));
        await h.shot("cdp-shots/council-tree-new-dialog.png");
        const fromNew = await openSetupFromNew(h, EMPTY_PROJECT, fx);
        rec(
            "6. the New dialog's Council row, with a project picked, reads Set up council and opens Setup",
            fromNew.ok && fromNew.label === "Set up council",
            JSON.stringify(fromNew)
        );
        await h.shot("cdp-shots/council-tree-setup-from-new.png");

        // 7. back on a council, the palette's New council… row opens Setup again
        await h.ev(click(`[data-council-row="${round2}"]`));
        const back = await until(`${present("[data-council-discussion]")} && !${present("[data-council-setup]")}`);
        const opened = await fx.openPalette(h);
        let picked = "";
        let viaPalette = false;
        if (opened) {
            await h.ev(paletteType("New council"));
            await until(`(${PALETTE_SELECTED}).startsWith("New council")`, 3000);
            picked = await h.ev(PALETTE_SELECTED);
            await h.ev(paletteEnter);
            viaPalette = await until(present("[data-council-setup]"));
        }
        rec(
            "7. the palette's New council… row (search, Enter) opens Setup",
            back && opened && picked.startsWith("New council") && viaPalette,
            JSON.stringify({ back, opened, picked, viaPalette })
        );

        // 8. a council that ends while you are on Setup: a toast, an unread dot, and the toast opens its Summary
        const away = `${COUNCIL_ID_PREFIX}ended-away`;
        await seedCouncil(h, ctx, "round2", { id: away });
        const running = await until(`${rowMeta(away)} === "Running"`);
        const onSetup = await h.ev(present("[data-council-setup]"));
        writeCouncil(ctx, "done", { id: away });
        await announceCouncil(h, ctx, away);
        const toasted = await until(`${toastsWith("Council done")}.length === 1`);
        const dotted = await until(`${unreadDot(away)} && ${rowMeta(away)} === "Done"`);
        await h.shot("cdp-shots/council-tree-ended.png");
        const clicked = await h.ev(`(() => {
            const t = ${toastsWith("Council done")}[0];
            if (!t) return false;
            t.click();
            return true;
        })()`);
        const summary = await until(present("[data-council-summary]"));
        const read = await until(`!${unreadDot(away)}`);
        rec(
            "8. a council that ends while Setup shows raises a Council done toast and an unread dot; the toast opens its Summary and clears the dot",
            running && onSetup && toasted && dotted && clicked && summary && read,
            JSON.stringify({ running, onSetup, toasted, dotted, clicked, summary, read })
        );

        // 9. one that ends while you are looking at it says nothing
        const seen = `${COUNCIL_ID_PREFIX}ended-seen`;
        await seedCouncil(h, ctx, "round2", { id: seen });
        await until(`${rowMeta(seen)} === "Running"`);
        await openCouncil(h, seen, "discussion");
        writeCouncil(ctx, "done", { id: seen });
        await announceCouncil(h, ctx, seen);
        const ended = await until(`${rowMeta(seen)} === "Done"`);
        await sleep(NOTICE_SETTLE_MS);
        const stray = await h.ev(`${toastsWith("Council done")}.length`);
        const dot = await h.ev(unreadDot(seen));
        rec(
            "9. a council that ends while its Discussion is open raises no toast and no dot",
            ended && stray === 0 && dot === false,
            JSON.stringify({ ended, stray, dot })
        );

        // 10. a queued council: its row names the council it waits on, and Remove from queue asks wavesrv to stop it
        const queued = `${councilFixtureId("round1")}-queued`;
        const ahead = loadCouncilFixture("round2").feature;
        await seedCouncil(h, ctx, "round1", {
            id: queued,
            edit: (c) => {
                c.state = "queued";
                c.round = 0;
                c.queuedafter = councilFixtureId("round2");
            },
        });
        const wording = `Queued · after ${ahead}`;
        const worded = await until(`${rowMeta(queued)} === ${JSON.stringify(wording)}`);
        const queuedRow = (folderRows(await rows(), COUNCIL_PROJECT) ?? []).find((r) => r.kind === "council" && r.id === queued);
        const removeOf = (id) =>
            `document.querySelector(${JSON.stringify(`[data-council-row="${id}"]`)})?.parentElement?.querySelector('[data-council-act="remove"]')`;
        // a running or waiting council offers no Remove: it offers Pin (step 11b), not this
        const offered = await h.ev(
            `${removeOf(queued)}?.title === "Remove from queue" && !${removeOf(councilFixtureId("round2"))} && !${removeOf(councilFixtureId("awaiting"))}`
        );
        await h.shot("cdp-shots/council-tree-queued.png");
        await stubRpc(h, ["CouncilStopCommand"]);
        const removed = await h.ev(`(() => {
            const el = ${removeOf(queued)};
            if (!el) return false;
            el.click();
            return true;
        })()`);
        await until(`(window.__arcCouncilStub?.calls ?? []).filter((c) => c.name === "CouncilStopCommand").length >= 1`);
        const stops = await rpcCalls(h, "CouncilStopCommand");
        await unstubRpc(h);
        rec(
            "10. a queued council reads Queued · after <the council it waits on> in the muted tone and offers one Remove from queue, which asks to stop it",
            worded &&
                queuedRow?.tone === "muted" &&
                offered &&
                removed &&
                stops.length === 1 &&
                stops[0].data?.id === queued,
            JSON.stringify({ wording, queuedRow, offered, removed, stops })
        );

        // 11a. Pin in the Report's tab bar: an unpinned council's button reads Pin and asks wavesrv to pin it; once the
        // pin is saved it reads Pinned. Nothing in the Report offers Close or Reopen any more.
        const doneId = councilFixtureId("done");
        await openCouncil(h, doneId, "summary");
        const pinIn = `document.querySelector("[data-council-tabbar] [data-council-pin]")`;
        const pinText = `(${pinIn}?.textContent ?? "").trim()`;
        const unpinnedShown = await until(`${pinIn}?.dataset.councilPin === "pin" && ${pinText} === "Pin"`);
        await stubRpc(h, ["CouncilPinCommand"]);
        await h.ev(`${pinIn}?.click()`);
        await until(`(window.__arcCouncilStub?.calls ?? []).filter((c) => c.name === "CouncilPinCommand").length >= 1`);
        const pins = await rpcCalls(h, "CouncilPinCommand");
        await unstubRpc(h);
        // what wavesrv saves for that pin
        writeCouncil(ctx, "done", { edit: (c) => (c.pinned = Date.now()) });
        await announceCouncil(h, ctx, doneId);
        const pinnedShown = await until(`${pinIn}?.dataset.councilPin === "pinned" && ${pinText} === "Pinned"`);
        const noClose = await h.ev(`!document.querySelector("[data-council-close]")`);
        await h.shot("cdp-shots/council-report-pinned.png");
        // back to the terminal for the steps that follow
        await pressEscape(h);
        rec(
            "11a. the Report's tab bar offers Pin, which asks wavesrv to pin the council, and reads Pinned once it is saved",
            unpinnedShown &&
                pins.length === 1 &&
                pins[0].data?.id === doneId &&
                pins[0].data?.pinned === true &&
                pinnedShown &&
                noClose,
            JSON.stringify({ unpinnedShown, pins, pinnedShown, noClose })
        );

        // 11b. a tree row's hover button: Unpin on the pinned council (it stays in the tree), Pin on an unpinned one,
        // running ones too, and Close council on none; Unpin asks wavesrv to unpin it
        const actOf = (id, act) =>
            `document.querySelector(${JSON.stringify(`[data-council-row="${id}"]`)})?.parentElement?.querySelector('[data-council-act="${act}"]')`;
        const actShown = (id, act) => `(() => {
            const el = ${actOf(id, act)};
            return !!el && getComputedStyle(el.parentElement).opacity === "1";
        })()`;
        const stays = await until(present(`[data-council-row="${doneId}"]`));
        const unpinOffered = await hoverUntil(h, `[data-council-row="${doneId}"] [data-council-feature]`, actShown(doneId, "unpin"));
        const unpinTitle = await h.ev(`${actOf(doneId, "unpin")}?.title ?? null`);
        await h.shot("cdp-shots/council-tree-unpin.png");
        const runningId = councilFixtureId("round2");
        const pinOffered = await hoverUntil(h, `[data-council-row="${runningId}"] [data-council-feature]`, actShown(runningId, "pin"));
        const pinTitle = await h.ev(`${actOf(runningId, "pin")}?.title ?? null`);
        await h.shot("cdp-shots/council-tree-pin.png");
        const closeLeft = await h.ev(`!!document.querySelector('[data-council-act="close"]')`);
        await stubRpc(h, ["CouncilPinCommand"]);
        await h.ev(`${actOf(doneId, "unpin")}?.click()`);
        await until(`(window.__arcCouncilStub?.calls ?? []).filter((c) => c.name === "CouncilPinCommand").length >= 1`);
        const unpins = await rpcCalls(h, "CouncilPinCommand");
        await unstubRpc(h);
        // the fixture as it was, unpinned, for the steps that follow
        writeCouncil(ctx, "done");
        await announceCouncil(h, ctx, doneId);
        await until(`!!${actOf(doneId, "pin")}`);
        rec(
            "11b. a council row's hover button reads Unpin on a pinned council and Pin on an unpinned one, a running one too, never Close council; Unpin asks wavesrv to unpin it",
            stays &&
                unpinOffered &&
                unpinTitle === "Unpin" &&
                pinOffered &&
                pinTitle === "Pin" &&
                !closeLeft &&
                unpins.length === 1 &&
                unpins[0].data?.id === doneId &&
                unpins[0].data?.pinned === false,
            JSON.stringify({ stays, unpinOffered, unpinTitle, pinOffered, pinTitle, closeLeft, unpins })
        );

        // 11c. Councils (the button at the sidebar's top) marks the pinned council's row with a pin, and the row's hover
        // button reads Unpin there (Pin on an unpinned one) and asks wavesrv to unpin it; once saved, the mark goes
        writeCouncil(ctx, "done", { edit: (c) => (c.pinned = Date.now()) });
        await announceCouncil(h, ctx, doneId);
        const historyRow = (id) => `[data-council-history-row="${id}"]`;
        const historyAct = (id, act) =>
            `document.querySelector(${JSON.stringify(`[data-council-history-item="${id}"] [data-council-history-act="${act}"]`)})`;
        const historyActShown = (id, act) => `(() => {
            const el = ${historyAct(id, act)};
            return !!el && getComputedStyle(el.parentElement).opacity === "1";
        })()`;
        const markOn = (id) =>
            `!!document.querySelector(${JSON.stringify(`${historyRow(id)}[data-council-history-pinned] [data-council-history-pin-mark]`)})`;
        const listOpened = await h.ev(click("[data-agent-councils-open]"));
        const listShown = await until(present(historyRow(doneId)));
        const marked = await until(markOn(doneId));
        const unmarkedOther = await h.ev(`!${markOn(runningId)}`);
        const listPinOffered = await hoverUntil(h, historyRow(runningId), historyActShown(runningId, "pin"));
        const listUnpinOffered = await hoverUntil(h, historyRow(doneId), historyActShown(doneId, "unpin"));
        const listUnpinTitle = await h.ev(`${historyAct(doneId, "unpin")}?.title ?? null`);
        await h.shot("cdp-shots/council-history-pinned.png");
        await stubRpc(h, ["CouncilPinCommand"]);
        await h.ev(`${historyAct(doneId, "unpin")}?.click()`);
        await until(`(window.__arcCouncilStub?.calls ?? []).filter((c) => c.name === "CouncilPinCommand").length >= 1`);
        const listUnpins = await rpcCalls(h, "CouncilPinCommand");
        await unstubRpc(h);
        // what wavesrv saves for that unpin: the fixture as it was
        writeCouncil(ctx, "done");
        await announceCouncil(h, ctx, doneId);
        const unmarked = await until(`${present(historyRow(doneId))} && !${markOn(doneId)}`);
        // back to the terminal for the steps that follow (the search box is not focused, so one Escape leaves Councils)
        await pressEscape(h);
        rec(
            "11c. Councils marks a pinned council's row with a pin; the row's hover button reads Unpin there and Pin on an unpinned one, and Unpin asks wavesrv to unpin it, after which the mark goes",
            listOpened &&
                listShown &&
                marked &&
                unmarkedOther &&
                listPinOffered &&
                listUnpinOffered &&
                listUnpinTitle === "Unpin" &&
                listUnpins.length === 1 &&
                listUnpins[0].data?.id === doneId &&
                listUnpins[0].data?.pinned === false &&
                unmarked,
            JSON.stringify({
                listOpened,
                listShown,
                marked,
                unmarkedOther,
                listPinOffered,
                listUnpinOffered,
                listUnpinTitle,
                listUnpins,
                unmarked,
            })
        );

        // ---- the tree rule (docs/superpowers/plans/2026-11-03-council-ux.md, Task 6) ----
        // Two copies of the done fixture placed three days back, both marked opened now in the last-opened map (so
        // neither is unread): `old-pinned` is pinned, `old-read` is not. The tree keeps a council that is live, pinned,
        // unread or ended less than a day ago, so only the pinned one is drawn, at the top of its folder.
        const oldPinned = `${COUNCIL_ID_PREFIX}old-pinned`;
        const oldRead = `${COUNCIL_ID_PREFIX}old-read`;
        const threeDaysAgo = Date.now() - 3 * DAY_MS;
        ctx.openedBefore = await h.ev(`window.__arcCouncil.opened()`);
        await h.ev(`(() => {
            const map = window.__arcCouncil.opened();
            const now = Date.now();
            window.__arcCouncil.setOpened({
                seededAt: map.seededAt,
                opened: { ...map.opened, ${JSON.stringify(oldPinned)}: now, ${JSON.stringify(oldRead)}: now },
            });
        })()`);
        await seedCouncil(h, ctx, "done", { id: oldRead, now: threeDaysAgo });
        await seedCouncil(h, ctx, "done", { id: oldPinned, now: threeDaysAgo, edit: (c) => (c.pinned = Date.now()) });

        // 11d. the pinned council is drawn first in its folder, above the Councils label and the councils under it
        const pinnedDrawn = await until(present(`[data-council-row="${oldPinned}"]`), ROWS_WAIT_MS);
        const ruled = folderRows(await rows(), COUNCIL_PROJECT) ?? [];
        rec(
            "11d. a pinned council, ended three days ago, is drawn at the top of its folder, ahead of the Councils label and the other councils",
            pinnedDrawn &&
                ruled[0]?.kind === "council" &&
                ruled[0].id === oldPinned &&
                ruled[1]?.kind === "head" &&
                ruled.filter((r) => r.kind === "council" && r.id === oldPinned).length === 1 &&
                ruled.slice(2).some((r) => r.kind === "council"),
            JSON.stringify(ruled.map((r) => (r.kind === "council" ? `c:${r.id}` : r.kind)))
        );
        await h.shot("cdp-shots/council-tree-pinned-top.png");

        // 11e. the unpinned one, ended three days ago and opened since, is in no folder of the tree, though Councils
        // lists it
        const readGone = await h.ev(`!${present(`[data-council-row="${oldRead}"]`)}`);
        await h.ev(click("[data-agent-councils-open]"));
        const readListed = await until(present(historyRow(oldRead)));
        await pressEscape(h);
        rec(
            "11e. an ended, unpinned council older than a day that was opened is not in the tree, and Councils still lists it",
            readGone && readListed,
            JSON.stringify({ readGone, readListed })
        );

        // 11f. Unpin from that pinned council's Report takes it off the tree at once
        await openCouncil(h, oldPinned, "summary");
        const reportPinned = await until(`${pinIn}?.dataset.councilPin === "pinned"`);
        await stubRpc(h, ["CouncilPinCommand"]);
        await h.ev(`${pinIn}?.click()`);
        await until(`(window.__arcCouncilStub?.calls ?? []).filter((c) => c.name === "CouncilPinCommand").length >= 1`);
        const reportUnpins = await rpcCalls(h, "CouncilPinCommand");
        await unstubRpc(h);
        // what wavesrv saves for that unpin
        writeCouncil(ctx, "done", { id: oldPinned, now: threeDaysAgo });
        await announceCouncil(h, ctx, oldPinned);
        const unpinnedGone = await until(
            `${pinIn}?.dataset.councilPin === "pin" && !${present(`[data-council-row="${oldPinned}"]`)}`
        );
        await h.shot("cdp-shots/council-tree-unpinned-gone.png");
        await pressEscape(h);
        rec(
            "11f. Unpin in the Report of a council that ended more than a day ago asks wavesrv to unpin it, and once saved the council leaves the tree",
            reportPinned &&
                reportUnpins.length === 1 &&
                reportUnpins[0].data?.id === oldPinned &&
                reportUnpins[0].data?.pinned === false &&
                unpinnedGone,
            JSON.stringify({ reportPinned, reportUnpins, unpinnedGone })
        );

        // 11g. the same rule for a council with no summary (docs/superpowers/plans/2026-11-03-council-ux-fix-1.md): its
        // ended time is its `updated`, which a pin leaves as it was. A stopped copy of the done fixture, its summary
        // dropped, placed three days back, pinned and marked opened now, is in the tree; Unpin from its tree row's hover
        // button asks wavesrv to unpin it, and once saved (`updated` still three days back) it leaves the tree.
        const oldStopped = `${COUNCIL_ID_PREFIX}old-stopped`;
        const stoppedEdit = (pinned) => (c) => {
            c.state = "stopped";
            delete c.summary;
            c.pinned = pinned;
        };
        await h.ev(`(() => {
            const map = window.__arcCouncil.opened();
            window.__arcCouncil.setOpened({
                seededAt: map.seededAt,
                opened: { ...map.opened, ${JSON.stringify(oldStopped)}: Date.now() },
            });
        })()`);
        await seedCouncil(h, ctx, "done", { id: oldStopped, now: threeDaysAgo, edit: stoppedEdit(Date.now()) });
        const stoppedDrawn = await until(present(`[data-council-row="${oldStopped}"]`), ROWS_WAIT_MS);
        const stoppedRead = await h.ev(`!${unreadDot(oldStopped)}`);
        const stoppedUnpinOffered = await hoverUntil(h, `[data-council-row="${oldStopped}"] [data-council-feature]`, actShown(oldStopped, "unpin"));
        await stubRpc(h, ["CouncilPinCommand"]);
        await h.ev(`${actOf(oldStopped, "unpin")}?.click()`);
        await until(`(window.__arcCouncilStub?.calls ?? []).filter((c) => c.name === "CouncilPinCommand").length >= 1`);
        const stoppedUnpins = await rpcCalls(h, "CouncilPinCommand");
        await unstubRpc(h);
        // what wavesrv saves for that unpin: the pin gone, `updated` as it was
        writeCouncil(ctx, "done", { id: oldStopped, now: threeDaysAgo, edit: stoppedEdit(0) });
        await announceCouncil(h, ctx, oldStopped);
        const stoppedGone = await until(`!${present(`[data-council-row="${oldStopped}"]`)}`);
        await h.shot("cdp-shots/council-tree-unpinned-stopped-gone.png");
        rec(
            "11g. a pinned, stopped council with no summary, ended three days ago and opened, is in the tree; Unpin from its tree row asks wavesrv to unpin it, and once saved it leaves the tree",
            stoppedDrawn &&
                stoppedRead &&
                stoppedUnpinOffered &&
                stoppedUnpins.length === 1 &&
                stoppedUnpins[0].data?.id === oldStopped &&
                stoppedUnpins[0].data?.pinned === false &&
                stoppedGone,
            JSON.stringify({ stoppedDrawn, stoppedRead, stoppedUnpinOffered, stoppedUnpins, stoppedGone })
        );

        // ---- the room's agents (steps 12 on) ----
        // The roster write reloads the page onto the Jarvis surface, so go back to Agent. The councils so far seat no agent.
        ctx.roster = await writeRoomRoster(h);
        await h.goto("agent");
        const [witness, uxaudit] = ROOM_AGENTS.map((a) => a.tabId);
        const bothAgents = [witness, uxaudit];
        const rowOf = (id) => `[data-agent-row="${id}"]`;
        const agentRowsShown = await until(`${present(rowOf(witness))} && ${present(rowOf(uxaudit))}`, ROWS_WAIT_MS);
        const calm = (await h.ev(inCouncilTag(witness))) === "" && (await h.ev(inCouncilTag(uxaudit))) === "";

        // the room (running, one held draft), the same room waiting on two held ideas, and a council queued behind the
        // running one
        const roomAwaiting = await seedCouncil(h, ctx, "room-awaiting");
        const room = await seedCouncil(h, ctx, "room");
        const behind = `${councilFixtureId("room")}-queued`;
        await seedCouncil(h, ctx, "round1", {
            id: behind,
            edit: (c) => {
                c.state = "queued";
                c.round = 0;
                c.queuedafter = room;
            },
        });

        // 12. a seated agent's row says `in council` while a council it sits in runs or waits on you, and not before
        const seatedTags = await until(
            `${inCouncilTag(witness)} === "in council" && ${inCouncilTag(uxaudit)} === "in council"`
        );
        await h.shot("cdp-shots/council-tree-in-council.png");
        rec(
            "12. the room's two agents' rows read in council once a council they sit in is running or waiting on you, and read none before",
            agentRowsShown && calm && seatedTags,
            JSON.stringify({
                agentRowsShown,
                calm,
                seatedTags,
                witness: await h.ev(inCouncilTag(witness)),
                uxaudit: await h.ev(inCouncilTag(uxaudit)),
            })
        );

        // 13. the Councils rows of the room say what waits on you, in the amber token
        const waitingTwo = await until(`${rowMeta(roomAwaiting)} === "2 drafts wait for you"`);
        const waitingOne = await until(`${rowMeta(room)} === "1 draft waits for you"`);
        const drafts = await h.ev(metaColor(roomAwaiting, "asking"));
        const draftsOne = await h.ev(metaColor(room, "asking"));
        rec(
            "13. the room waiting on two held ideas reads 2 drafts wait for you, and the running room with one held reply 1 draft waits for you, both in the amber token",
            waitingTwo &&
                waitingOne &&
                drafts.got != null &&
                drafts.got === drafts.want &&
                draftsOne.got === draftsOne.want,
            JSON.stringify({ waitingTwo, waitingOne, drafts, draftsOne })
        );

        // 14. the queued council names the council it waits on and the agent that council is waiting for
        const waiting = `Queued · after ${loadCouncilFixture("room").feature} · waiting for ${ROOM_AGENTS[0].name}`;
        const namesBoth = await until(`${rowMeta(behind)} === ${JSON.stringify(waiting)}`);
        const behindRow = (folderRows(await rows(), COUNCIL_PROJECT) ?? []).find((r) => r.kind === "council" && r.id === behind);
        rec(
            "14. a council queued behind the room reads Queued · after Rail apps · waiting for Witness synthesis, in the muted tone",
            namesBoth && behindRow?.tone === "muted",
            JSON.stringify({ waiting, behindRow })
        );

        // 15. Ctrl/Cmd+click picks agent rows and picks a picked one off again. The focus goes to the project's terminal
        // first, so the picks start from nothing rather than from the agent the page opened on
        await h.ev(click(`[data-agent-terminal-row]`));
        const nonePicked = sameIds(await h.ev(PICKED), []);
        const toggledOn = await mouseOn(h, rowOf(witness), { modifiers: TOGGLE_BIT });
        const oneRow = sameIds(await h.ev(PICKED), [witness]);
        await mouseOn(h, rowOf(uxaudit), { modifiers: TOGGLE_BIT });
        const twoRows = sameIds(await h.ev(PICKED), bothAgents);
        await h.shot("cdp-shots/council-tree-picked.png");
        await mouseOn(h, rowOf(uxaudit), { modifiers: TOGGLE_BIT });
        const offAgain = sameIds(await h.ev(PICKED), [witness]);
        await mouseOn(h, rowOf(uxaudit), { modifiers: TOGGLE_BIT });
        const onAgain = sameIds(await h.ev(PICKED), bothAgents);
        rec(
            "15. Ctrl+click picks the two agent rows (a picked row toggles off and on again), both drawn as selected",
            toggledOn && nonePicked && oneRow && twoRows && offAgain && onAgain,
            JSON.stringify({ toggledOn, nonePicked, oneRow, twoRows, offAgain, onAgain })
        );

        // 16. a plain click clears the picks and selects the one row; a single selected agent's menu has no Discuss together
        await mouseOn(h, rowOf(witness));
        const cleared = sameIds(await h.ev(PICKED), []);
        const rightClicked = await mouseOn(h, rowOf(witness), { button: "right" });
        const single = await until(`${MENU_ITEMS}.includes("Rename")`);
        const singleItems = await h.ev(MENU_ITEMS);
        await pressEscape(h);
        const menuGone = await until(`!document.querySelector("[data-menu-item]")`);
        rec(
            "16. a plain click on an agent row clears the picks, and the menu of that one selected agent offers no Discuss together",
            cleared && rightClicked && single && !singleItems.includes("Discuss together") && menuGone,
            JSON.stringify({ cleared, rightClicked, single, singleItems, menuGone })
        );

        // 17. Shift+click ranges from that last clicked row to the one clicked
        const ranged = await mouseOn(h, rowOf(uxaudit), { modifiers: SHIFT_BIT });
        const rangeRows = sameIds(await h.ev(PICKED), bothAgents);
        rec(
            "17. Shift+click on the other agent's row extends from the last clicked row, both rows drawn as selected",
            ranged && rangeRows,
            JSON.stringify({ ranged, picked: await h.ev(PICKED) })
        );

        // 18. the menu of a picked row offers Discuss together, which opens Setup with both agents seated
        await mouseOn(h, rowOf(witness), { button: "right" });
        const discussOffered = await until(`${MENU_ITEMS}.includes("Discuss together")`);
        const pickedItems = await h.ev(MENU_ITEMS);
        await h.shot("cdp-shots/council-tree-discuss-menu.png");
        const chosen = await h.ev(`(() => {
            const row = [...document.querySelectorAll("[data-menu-item]")].find((r) => r.dataset.menuItem === "Discuss together");
            if (!row) return false;
            row.click();
            return true;
        })()`);
        const setupShown = await until(present("[data-council-setup]"));
        const seatedAgents = await until(`document.querySelectorAll("[data-council-seat-agent]").length === ${bothAgents.length}`);
        const seatAgents = await h.ev(`[...document.querySelectorAll("[data-council-seat-agent]")].map((e) => e.dataset.councilSeatAgent)`);
        await h.shot("cdp-shots/council-tree-discuss-setup.png");
        rec(
            "18. the menu of a picked agent offers Discuss together, which opens council Setup with both agents in seat rows",
            discussOffered && chosen && setupShown && seatedAgents && sameIds(seatAgents, bothAgents),
            JSON.stringify({ discussOffered, pickedItems, chosen, setupShown, seatedAgents, seatAgents })
        );

        return steps;
    },

    async teardown(h, ctx) {
        // the last-opened map as it was before steps 11d to 11g marked their councils opened; their council files go
        // with the other fixtures' in teardownCouncilProject (ctx.written)
        if (ctx.openedBefore) {
            await h
                .ev(`window.__arcCouncil?.setOpened(${JSON.stringify(ctx.openedBefore)})`)
                .catch((e) => console.error(`council-tree teardown: restoring the opened map failed: ${e?.message ?? e}`));
        }
        // the roster first: putting it back reloads the page, and the fixture agents leave the tree with it
        if (ctx.roster) {
            await restoreRoomRoster(ctx.roster).catch((e) =>
                console.error(`council-tree teardown: restoring the roster failed: ${e?.message ?? e}`)
            );
        }
        await teardownCouncilProject(h, ctx);
    },
};
