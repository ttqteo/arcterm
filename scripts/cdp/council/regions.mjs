// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0
//
// council-regions (docs/superpowers/specs/2026-11-04-council-screenshot-regions-design.md): a seat cites part of a
// screenshot as `screenshot:<file>#<name>@x,y,w,h`, and Go draws the box. The done fixture is given a screenshot, its P1
// idea and the skeptic's reply on it each box a region of it, and its P2 idea names one with no box. The council goes in
// as a file with the refs only; a pin (a real `councilpin`, which saves it) is what makes wavesrv draw the crops, so the
// scenario checks Go's half too: each boxed cite comes back with a region whose PNG is on disk. Then the crop shows under
// the idea in the channel and under both messages in the thread panel, a click opens the whole screenshot with the box on
// it in Sources, and P2's name-only cite is the weak chip that says the region has no box.
//
// The hooks are called by councilscenarios.mjs as arrange(h, fx), assert(h, ctx, fx), teardown(h, ctx, fx). Nothing here
// calls a model or starts an agent.

import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { waitFor } from "../attach.mjs";
import { makePng } from "./discussion.mjs";
import {
    announceCouncil,
    arrangeCouncilProject,
    councilFixtureId,
    openCouncil,
    teardownCouncilProject,
    writeCouncil,
} from "./fixtures.mjs";

const WAIT_MS = 8000;
const sel = (s) => JSON.stringify(s);
const until = (h, expr, ms = WAIT_MS) => waitFor((e) => h.ev(e), expr, ms);
const click = (h, s) => h.ev(`document.querySelector(${sel(s)})?.click()`);

const SHOT = "rail-home.png";
const IDEA_REF = `screenshot:${SHOT}#rail-dot@0.05,0.3,0.08,0.12`;
const REPLY_REF = `screenshot:${SHOT}#status-line@0.4,0.82,0.5,0.1`;
const UNBOXED_REF = `screenshot:${SHOT}#header`;

const IDEA = '[data-council-idea="P1"]';
const THREAD = '[data-council-thread="P1"]';

export const councilRegions = {
    async arrange(h, fx) {
        const ctx = await arrangeCouncilProject(h, fx);
        try {
            const dir = join(ctx.base, "shots");
            mkdirSync(dir, { recursive: true });
            ctx.shot = join(dir, SHOT);
            writeFileSync(ctx.shot, makePng(640, 400, [70, 120, 170]));
            ctx.id = councilFixtureId("regions");
            writeCouncil(ctx, "done", {
                id: ctx.id,
                edit: (c) => {
                    c.screenshots = [ctx.shot];
                    const p1 = c.proposals.find((p) => p.id === "P1");
                    p1.evidence = [...(p1.evidence ?? []), { ref: IDEA_REF }];
                    p1.label = "read";
                    const p2 = c.proposals.find((p) => p.id === "P2");
                    p2.evidence = [...(p2.evidence ?? []), { ref: UNBOXED_REF }];
                    p2.label = "guess";
                    const r3 = c.replies.find((r) => r.id === "r3");
                    r3.evidence = [{ ref: REPLY_REF }];
                },
            });
        } catch (e) {
            await teardownCouncilProject(h, ctx).catch(() => {});
            throw e;
        }
        return ctx;
    },

    async assert(h, ctx) {
        const steps = [];
        const rec = (step, ok, detail) => steps.push({ step, ok, detail: JSON.stringify(detail) });

        // 1. a save draws the regions: the pin saves the council, and each boxed cite comes back with its crop on disk
        await h.rpc("councilpin", { id: ctx.id, pinned: true });
        const saved = await h.rpc("councilget", { id: ctx.id });
        const regionOf = (ev, ref) => (ev ?? []).find((e) => e.ref === ref)?.region ?? null;
        const ideaRegion = regionOf(saved.proposals.find((p) => p.id === "P1")?.evidence, IDEA_REF);
        const replyRegion = regionOf(saved.replies.find((r) => r.id === "r3")?.evidence, REPLY_REF);
        const unboxed = regionOf(saved.proposals.find((p) => p.id === "P2")?.evidence, UNBOXED_REF);
        rec(
            "1. a save draws each boxed screenshot cite: the idea's and the reply's regions have their PNG on disk, the name-only one none",
            ideaRegion != null &&
                existsSync(ideaRegion.crop) &&
                replyRegion != null &&
                existsSync(replyRegion.crop) &&
                ideaRegion.crop !== replyRegion.crop &&
                unboxed == null,
            { ideaRegion, replyRegion, unboxed }
        );
        await announceCouncil(h, ctx, ctx.id);
        await openCouncil(h, ctx.id, "discussion");

        // 2. the idea card in the channel shows the crop under its words, before the chips
        const shown = await until(h, `!!document.querySelector(${sel(`${IDEA} [data-council-crop] img`)})`);
        const card = await h.ev(`(() => {
            const crop = document.querySelector(${sel(`${IDEA} [data-council-crop]`)});
            const chip = document.querySelector(${sel(`${IDEA} [data-council-evidence]`)});
            return {
                crops: document.querySelectorAll(${sel(`${IDEA} [data-council-crop]`)}).length,
                width: Math.round(crop?.querySelector("img")?.getBoundingClientRect().width ?? 0),
                beforeChips: crop != null && chip != null && !!(crop.compareDocumentPosition(chip) & Node.DOCUMENT_POSITION_FOLLOWING),
            };
        })()`);
        await h.ev(`document.querySelector(${sel(IDEA)})?.scrollIntoView({ block: "center" })`);
        await h.shot("cdp-shots/council-regions-idea.png");
        rec(
            "2. the idea card shows its boxed region as an image about 240px wide, under its words and before the chips",
            shown && card.crops === 1 && card.width >= 200 && card.width <= 240 && card.beforeChips,
            card
        );

        // 3. P2's region named with no box is the weak chip, saying the region has no box, and shows no image
        const weak = await h.ev(
            `(document.querySelector('[data-council-idea="P2"] [data-council-evidence="weak"]')?.textContent ?? "").replace(/\\s+/g, " ").trim()`
        );
        const p2Crops = await h.ev(`document.querySelectorAll('[data-council-idea="P2"] [data-council-crop]').length`);
        rec(
            "3. a region cited with no box is drawn weak, the chip saying the region has no box, with no image",
            weak.includes("rail-home.png#header") && weak.includes("no box") && p2Crops === 0,
            { weak, p2Crops }
        );

        // 4. the thread panel shows the idea's crop and the reply's own crop, each under its message
        await click(h, '[data-council-thread-open="P1"]');
        const threadOpen = await until(h, `document.querySelectorAll(${sel(`${THREAD} [data-council-crop] img`)}).length >= 2`);
        const inThread = await h.ev(
            `[...document.querySelectorAll(${sel(`${THREAD} [data-council-crop]`)})].map((e) => e.getAttribute("data-council-crop"))`
        );
        await h.shot("cdp-shots/council-regions-thread.png");
        rec(
            "4. the thread panel shows the idea's crop and the reply's own, each under its message",
            threadOpen &&
                inThread.length === 2 &&
                inThread.includes(ideaRegion?.crop) &&
                inThread.includes(replyRegion?.crop),
            inThread
        );

        // 5. a click on the reply's crop opens Sources on the whole screenshot, the same box outlined on it
        await click(h, `${THREAD} [data-council-crop=${sel(replyRegion?.crop ?? "")}]`);
        const full = await until(
            h,
            `document.querySelector("[data-council-sources-region]")?.getAttribute("data-state") === "full" && !!document.querySelector("[data-council-sources-region] img")?.naturalWidth`
        );
        const box = await h.ev(`(() => {
            const b = document.querySelector("[data-council-region-box]");
            const img = document.querySelector("[data-council-sources-region] img");
            if (!b || !img) return null;
            const r = b.getBoundingClientRect(), i = img.getBoundingClientRect();
            return {
                x: +((r.left - i.left) / i.width).toFixed(2),
                y: +((r.top - i.top) / i.height).toFixed(2),
                w: +(r.width / i.width).toFixed(2),
                h: +(r.height / i.height).toFixed(2),
                natural: img.naturalWidth,
            };
        })()`);
        await h.shot("cdp-shots/council-regions-sources.png");
        const near = (a, b) => Math.abs(a - b) <= 0.02;
        rec(
            "5. clicking a crop opens Sources on the whole screenshot, with the cite's box outlined where it says",
            full && box != null && box.natural === 640 && near(box.x, 0.4) && near(box.y, 0.82) && near(box.w, 0.5) && near(box.h, 0.1),
            box
        );
        return steps;
    },

    async teardown(h, ctx) {
        await teardownCouncilProject(h, ctx);
    },
};
