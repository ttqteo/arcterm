// surfaces-spring-office: the Cockpit's Office on Chat's spring (docs/superpowers/specs/2026-11-14-surfaces-chat-look-design.md,
// section 1; the plan's Task 3). The Office has two shape changes: the desk's card panel (OfficeCardPanel, springSheet) and the
// office's pan (its root's x, animate(root, { x: -pan }) on MOTION.spring, as the panel opens and shuts). Each is judged by where
// it is on the frames between its two states (springprobe.mjs), not by its two ends.
//
//   1. the card panel opens from a desk: its x passes between the edge and its rest
//   2. the office pans under the panel at the right-most desk: the root's x passes between 0 and -pan, and back to 0 as it shuts
//   3. under prefers-reduced-motion (the page reloaded under it: useReducedMotion reads it at mount): the pan and the panel
//      land at once, and the panel leaves with no slide
//
// It reuses cockpit-office's arrange and teardown (its fixture run, the roster, the dev state); teardown also clears the media
// emulation and reloads, so the next scenario does not start on a page that mounted under reduced motion.

import { dev, focusCockpit, key, OFFICE_RUNS, probe, settleBoss, waitForOffice } from "../cockpitofficescenarios.mjs";
import { atOnce, between, readSampler, singleCopy, startSampler } from "./springprobe.mjs";

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const QUILL = "fx-office-quill";
const REDUCE = [{ name: "prefers-reduced-motion", value: "reduce" }];
const PANEL = "[data-office-popup]";
const ROOT = "[data-office-root]";

// the samples from the first one that has the element: a panel that opens is not there on the sampler's first frame
const present = (samples) => {
    const from = samples.findIndex((s) => s.n > 0);
    return from === -1 ? [] : samples.slice(from);
};
// a part that never moved: it has at least two frames and every one of them is at the same x (mounted at its end state,
// and left with no exit slide)
const stayed = (samples, key) => {
    const seen = samples.filter((s) => s.n > 0);
    return seen.length >= 2 && seen.every((s) => s.rect[key] === seen[0].rect[key]);
};
// milliseconds from the first sample to the first one strictly between its value and the last's; null if none
const earlyMs = (samples, key) => {
    const v = samples.map((s) => s.rect?.[key]);
    const first = v[0];
    const last = v.at(-1);
    const lo = Math.min(first, last);
    const hi = Math.max(first, last);
    const at = v.findIndex((x) => x !== undefined && x > lo && x < hi);
    return at === -1 ? null : Math.round(samples[at].t - samples[0].t);
};
const xs = (samples, key) => samples.filter((s) => s.n > 0).map((s) => Math.round(s.rect[key] * 10) / 10);
const rootX = (h) => h.ev(`new DOMMatrix(getComputedStyle(document.querySelector(${JSON.stringify(ROOT)})).transform).m41`);
const rightMostDesk = (h) =>
    h.ev(`(() => {
        const all = [...document.querySelectorAll("[data-office-root] [data-office-desk], [data-office-root] [data-office-seat]")];
        all.sort((a, b) => b.getBoundingClientRect().left - a.getBoundingClientRect().left);
        all[0]?.click();
        return all.length;
    })()`);
const scrollLeft = (h) => h.ev(`document.querySelector("[data-cockpit-office]")?.scrollLeft ?? null`);
// the boss at a desk with the panel shut, ready for `f`
async function atDesk(h, pick) {
    await h.goto("cockpit");
    await pick();
    await settleBoss(h, 6000);
    await focusCockpit(h);
}
// one gesture, sampled: start the sampler, do it, read the frames
async function sampled(h, selector, gesture) {
    await h.ev(startSampler(selector));
    await gesture();
    return h.ev(readSampler());
}

export default (kit) => {
    const base = () => kit.scenario("cockpit-office");
    return [
        {
            name: "surfaces-spring-office",
            surface: "cockpit",
            arrange: (h) => base().arrange(h),
            async assert(h, ctx) {
                const steps = [];
                const rec = (step, ok, detail) => steps.push({ step, ok: !!ok, detail });
                if (ctx.missing) {
                    rec("0. the office loads", false, ctx.missing);
                    return steps;
                }

                // 1. quill's card in the panel on the office's right: its x passes between the edge it slides from and its rest
                await atDesk(h, async () => {
                    await h.ev(`document.querySelector('[data-office-desk="${QUILL}"]')?.click()`);
                });
                await key(h, "Escape");
                await sleep(200);
                const opened = await sampled(h, PANEL, () => key(h, "f"));
                const panel = present(opened);
                await sleep(300);
                await h.shot("cdp-shots/surfaces-spring-office-panel.png");
                const early1 = panel.length ? earlyMs(panel, "left") : null;
                rec(
                    "1. the desk's card panel slides in on the spring: its x passes between the edge and its rest, at an early frame",
                    panel.length > 2 &&
                        between(panel, "left") &&
                        singleCopy(panel) &&
                        early1 != null &&
                        early1 < 400 &&
                        panel[0].rect.left > panel.at(-1).rect.left,
                    JSON.stringify({ frames: panel.length, x: xs(panel, "left").slice(0, 10), restX: panel.at(-1)?.rect.left, earlyMs: early1 })
                );
                await focusCockpit(h);
                await key(h, "f");
                await sleep(600);

                // 2. the right-most desk: the boss stands near the panel's edge, so the office slides left under it (panelPan).
                // The root's x passes between 0 and -pan as the panel opens, and between -pan and 0 as it shuts
                await atDesk(h, () => rightMostDesk(h));
                const scrollBefore = await scrollLeft(h);
                const slideOpen = await sampled(h, ROOT, () => key(h, "f"));
                await sleep(200);
                const slid = await probe(h);
                const xSlid = await rootX(h);
                await h.shot("cdp-shots/surfaces-spring-office-pan.png");
                const scrollOpen = await scrollLeft(h);
                const slideShut = await sampled(h, ROOT, () => key(h, "Escape"));
                await sleep(200);
                const unslid = await probe(h);
                const xBack = await rootX(h);
                await key(h, "Escape");
                await sleep(200);
                const pan = slid?.pan ?? 0;
                const first = slideOpen[0].rect.left;
                rec(
                    "2a. opening the panel at the right-most desk, the office's x passes between 0 and -pan and lands on -pan",
                    slid?.popup !== "" &&
                        pan > 0 &&
                        scrollBefore === scrollOpen &&
                        between(slideOpen, "left") &&
                        Math.abs(slideOpen.at(-1).rect.left - first + pan) < 0.6 &&
                        Math.abs(xSlid + pan) < 0.6,
                    JSON.stringify({ pan, popup: slid?.popup, scroll: [scrollBefore, scrollOpen], early: earlyMs(slideOpen, "left"), x: xSlid, left: xs(slideOpen, "left").slice(0, 10) })
                );
                rec(
                    "2b. shutting it, the office's x passes between -pan and 0 and is back at 0",
                    unslid?.popup === "" &&
                        unslid.pan === 0 &&
                        between(slideShut, "left") &&
                        Math.abs(slideShut.at(-1).rect.left - first) < 0.6 &&
                        Math.abs(xBack) < 0.01,
                    JSON.stringify({ popup: unslid?.popup, pan: unslid?.pan, x: xBack, early: earlyMs(slideShut, "left"), left: xs(slideShut, "left").slice(0, 10) })
                );

                // 3. reduced motion. useReducedMotion reads the preference when a component mounts, so the page starts over
                // under it (the office's dev state is in memory: the roster is handed in again). The pan lands at once, the
                // panel mounts at its rest and leaves with no slide
                ctx.reduced = true;
                await h.cdp("Emulation.setEmulatedMedia", { features: REDUCE });
                await h.reload();
                await h.goto("cockpit");
                const missing = await waitForOffice(h);
                if (missing) {
                    rec("3. the office loads under reduced motion", false, missing);
                    return steps;
                }
                await dev(h, { runs: OFFICE_RUNS, afterHours: false, energy: 63, entrance: "skip" });
                const emulated = await h.ev(`matchMedia("(prefers-reduced-motion: reduce)").matches`);
                await atDesk(h, () => rightMostDesk(h));
                const redOpen = await sampled(h, ROOT, () => key(h, "f"));
                await sleep(200);
                const redSlid = await probe(h);
                const redX = await rootX(h);
                await h.shot("cdp-shots/surfaces-spring-office-reduced.png");
                const redShut = await sampled(h, ROOT, () => key(h, "Escape"));
                await sleep(200);
                const redBack = await rootX(h);
                await key(h, "Escape");
                await sleep(200);
                // the panel itself, on a second open and shut of the same desk
                await atDesk(h, () => rightMostDesk(h));
                const redPanelOpen = await sampled(h, PANEL, () => key(h, "f"));
                await sleep(200);
                await focusCockpit(h);
                const redPanelShut = await sampled(h, PANEL, () => key(h, "f"));
                await sleep(200);
                const redPan = redSlid?.pan ?? 0;
                rec(
                    "3a. under reduced motion the office's pan lands at once, both ways",
                    emulated === true &&
                        redPan > 0 &&
                        atOnce(redOpen, "left") &&
                        Math.abs(redX + redPan) < 0.6 &&
                        atOnce(redShut, "left") &&
                        Math.abs(redBack) < 0.01,
                    JSON.stringify({ emulated, pan: redPan, x: [redX, redBack], open: xs(redOpen, "left").slice(0, 6), shut: xs(redShut, "left").slice(0, 6) })
                );
                rec(
                    "3b. under reduced motion the panel mounts at its rest and leaves with no slide",
                    present(redPanelOpen).length > 2 &&
                        stayed(redPanelOpen, "left") &&
                        redPanelShut.some((s) => s.n > 0) &&
                        stayed(redPanelShut, "left") &&
                        redPanelShut.at(-1).n === 0,
                    JSON.stringify({ open: xs(redPanelOpen, "left").slice(0, 6), shut: xs(redPanelShut, "left").slice(0, 6), end: redPanelShut.at(-1)?.n })
                );
                return steps;
            },
            async teardown(h, ctx) {
                try {
                    await h.cdp("Emulation.setEmulatedMedia", { features: [] });
                    // the page that mounted under reduced motion would carry it into the next scenario
                    if (ctx.reduced) await h.reload();
                } finally {
                    await base().teardown(h, ctx);
                }
            },
        },
    ];
};
