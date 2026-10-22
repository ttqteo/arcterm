// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0
//
// council-needs-you (docs/superpowers/plans/2026-10-22-council-v1-ui.md, Task 7): a council paused after step 1 is a row in
// Jarvis's Needs you, counted by the Jarvis nav badge, and opens on its Discussion; one resolved elsewhere leaves on the
// next attention refresh. The hooks are called by councilscenarios.mjs as arrange(h, fx), assert(h, ctx, fx),
// teardown(h, ctx, fx); the scenario opens on Jarvis (`surface`).
//
// Nothing here calls a model. The councils are JSON files written into the data dir; the attention list is the server's
// own, read again by its 10 s poll, so the waits below are longer than one poll.

import { waitFor } from "../attach.mjs";
import { arrangeCouncilProject, councilFixtureId, teardownCouncilProject, writeCouncil } from "./fixtures.mjs";

// the attention poll is 10 s (attentionpoller.tsx): a row shows or goes within one of them, plus the RPC
const POLL_WAIT_MS = 25_000;
const UI_WAIT_MS = 8_000;
const ROW_TEXT = "Council waiting on you: Rail apps";

const q = (s) => JSON.stringify(s);

// the Needs you rows of the Brief (WaitingRow) whose text holds `text`, as a page expression
const ROWS = (text) => `[...document.querySelectorAll('[data-jarvis-brief-row="queue"]')]
    .filter((r) => (r.textContent ?? "").replace(/\\s+/g, " ").includes(${q(text)}))`;

// the Jarvis nav badge's count: 0 when it is not drawn
const BADGE = `Number(document.querySelector('[data-nav-badge="jarvis"]')?.textContent ?? 0) || 0`;

export const councilNeedsYou = {
    surface: "jarvis",

    async arrange(h, fx) {
        const ctx = await arrangeCouncilProject(h, fx);
        try {
            ctx.id = councilFixtureId("awaiting");
            writeCouncil(ctx, "awaiting");
        } catch (e) {
            await teardownCouncilProject(h, ctx).catch(() => {});
            throw e;
        }
        return ctx;
    },

    async assert(h, ctx, fx) {
        const steps = [];
        const rec = (step, ok, detail) => steps.push({ step, ok, detail });
        const until = (expr, ms = UI_WAIT_MS) => waitFor((e) => h.ev(e), expr, ms);

        // 1. the awaiting council is a Needs you row, and the Jarvis badge counts it
        const shown = await until(`${ROWS(ROW_TEXT)}.length === 1`, POLL_WAIT_MS);
        const row = await h.ev(`(() => {
            const r = ${ROWS(ROW_TEXT)}[0];
            if (!r) return null;
            const flat = (el) => (el?.textContent ?? "").replace(/\\s+/g, " ").trim();
            return { text: flat(r), act: r.querySelector("[data-jarvis-queue-act]")?.textContent?.trim() ?? null };
        })()`);
        const before = await h.ev(BADGE);
        await h.shot("cdp-shots/council-needs-you-row.png");
        rec(
            "1. the council waiting on you is one Needs you row reading Council waiting on you: Rail apps, with an Open button",
            shown && row != null && row.text.includes(ROW_TEXT) && row.act === "Open",
            JSON.stringify(row)
        );
        rec("2. the Jarvis nav badge counts it", before >= 1, `badge ${before}`);

        // 3. a click on the row opens that council's Discussion in the Agent surface
        await h.ev(`${ROWS(ROW_TEXT)}[0]?.click()`);
        const opened = await until(`document.querySelector("[data-council-discussion]")?.dataset.councilId === ${q(ctx.id)}`);
        const surface = await h.activeSurfaceLabel();
        await h.shot("cdp-shots/council-needs-you-open.png");
        rec(
            "3. clicking the row opens that council's Discussion in the Agent surface",
            opened && surface === "Agent",
            JSON.stringify({ opened, surface })
        );

        // 4. the palette's Needs you scope lists the council still awaiting (written again under the same id); its row
        //    opens that council's Discussion and closes the palette. Back on Jarvis first, so the Discussion shown by step 3
        //    is not what the assert reads
        writeCouncil(ctx, "awaiting", { id: ctx.id });
        await h.goto("jarvis");
        const PALETTE = `document.querySelector('input[data-palette-input]')?.closest('[role="dialog"]')`;
        const palRow = `[...(${PALETTE}?.querySelectorAll("button[data-idx]") ?? [])].find((b) => (b.textContent ?? "").includes("Rail apps"))`;
        const palOpened = await fx.openPalette(h);
        await h.ev(`document.querySelector('[data-palette-scope="needs"]')?.click()`);
        const palListed = await until(`!!${palRow}`, POLL_WAIT_MS);
        await h.shot("cdp-shots/council-needs-you-palette.png");
        await h.ev(`${palRow}?.click()`);
        const palLanded = await until(
            `document.querySelector("[data-council-discussion]")?.dataset.councilId === ${q(ctx.id)} && !document.querySelector('input[data-palette-input]')`
        );
        const palSurface = await h.activeSurfaceLabel();
        rec(
            "4. the palette's Needs you row for the waiting council opens its Discussion and closes the palette",
            palOpened && palListed && palLanded && palSurface === "Agent",
            JSON.stringify({ palOpened, palListed, palLanded, palSurface })
        );

        // 5. the same council written as done: its row is gone after the next refresh, and the badge is one less
        writeCouncil(ctx, "done", { id: ctx.id });
        await h.goto("jarvis");
        const gone = await until(`${ROWS(ROW_TEXT)}.length === 0`, POLL_WAIT_MS);
        const after = await h.ev(BADGE);
        await h.shot("cdp-shots/council-needs-you-gone.png");
        rec(
            "5. once the council is done its Needs you row is gone on the next refresh, and the Jarvis badge counts one less",
            gone && after === before - 1,
            JSON.stringify({ gone, before, after })
        );

        return steps;
    },

    async teardown(h, ctx) {
        await teardownCouncilProject(h, ctx);
    },
};
