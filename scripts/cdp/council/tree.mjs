// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0
//
// council-tree (docs/superpowers/plans/2026-10-21-council.md, Task 13): the council rows in the Agent tree, the New
// dialog's Council row and the palette's New council… row. The fixture project holds the round2, awaiting, done and notrun
// councils and a terminal; a second registered project holds a terminal and no council, and so no Councils block. Nothing
// here starts a council or calls a model: New council only opens Setup, and Remove from queue (a queued council, step 10)
// and Remove council (an ended one, step 11) have their stop and delete commands replaced in the page.
//
// The hooks are called by councilscenarios.mjs as arrange(h, fx), assert(h, ctx, fx), teardown(h, ctx, fx). The tree is
// read as one flat list (the rows of [data-agent-active-rows] in the order they are drawn), cut at each project's folder.

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
    rpcCalls,
    seedCouncil,
    stubRpc,
    teardownCouncilProject,
    unstubRpc,
    writeCouncil,
} from "./fixtures.mjs";

export const EMPTY_PROJECT = "council-empty";

// oldest first: the tree lists them newest first, so the order they are written in is not the order they are drawn in
const SEEDED = ["notrun", "done", "awaiting", "round2"];
const TREE_ORDER = ["round2", "awaiting", "done", "notrun"];
const METAS = ["Running", "Waiting on you", "Done", "Not run"];

const ROWS_WAIT_MS = 10_000;
const UI_WAIT_MS = 5_000;
const NOTICE_SETTLE_MS = 600;
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
        const ctx = await arrangeCouncilProject(h, fx, { extraProjects: [EMPTY_PROJECT] });
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
        // the dialog opens with its Start column folded into a chip: open it to reach the Council row
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
        // a running or waiting council offers no Remove; an ended one offers Remove council (step 11), not this
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

        // 11. an ended council offers Remove council behind a confirm; confirming asks wavesrv to delete it and the row
        // goes at once
        const doneId = councilFixtureId("done");
        const doneRemove = await h.ev(`${removeOf(doneId)}?.title ?? null`);
        await stubRpc(h, ["CouncilDeleteCommand"]);
        await h.ev(`${removeOf(doneId)}?.click()`);
        const dialog = `[...document.querySelectorAll("h2")].some((e) => e.textContent === "Remove council")`;
        const asked = await until(dialog);
        await h.shot("cdp-shots/council-tree-remove.png");
        await h.ev(`window.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }))`);
        await until(`(window.__arcCouncilStub?.calls ?? []).filter((c) => c.name === "CouncilDeleteCommand").length >= 1`);
        const deletes = await rpcCalls(h, "CouncilDeleteCommand");
        const gone = await until(`!document.querySelector(${JSON.stringify(`[data-council-row="${doneId}"]`)})`);
        await unstubRpc(h);
        rec(
            "11. an ended council offers Remove council, which asks first, then deletes it and drops its row",
            doneRemove === "Remove council" && asked && deletes.length === 1 && deletes[0].data?.id === doneId && gone,
            JSON.stringify({ doneRemove, asked, deletes, gone })
        );

        return steps;
    },

    async teardown(h, ctx) {
        await teardownCouncilProject(h, ctx);
    },
};
