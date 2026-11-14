// surfaces-spring-cockpit: the Cockpit's cards view on the spring (docs/superpowers/specs/2026-11-14-surfaces-chat-look-design.md,
// Design §1-§3; the plan's Task 2). The roster is a fixture the page holds in its dev roster atom, changed under the open
// cards view without a reload (a reload is a first load and lands at once, so it cannot show a card arriving). One card
// arrives by flipping a parked idle agent to working: it joins the grid at the slot it already holds, so the cards after it
// are re-dealt to the other column, which is the change the spring has to carry. Each step samples every animation frame
// with springprobe.mjs and takes a screenshot:
//   1  one card arriving: it pops in (its scale is mid-way at an early frame), a card re-dealt to the other column passes
//      between its old and new place, and a column-mate's height passes between its old and new (a spring, not a jump); the
//      re-dealt cards' parts (header, banner, body...) stay unscaled and inside the card while the card around them is scaled
//      and moves (the layout's squash, counter-scaled, and a part that trails its card by the distance the card travels)
//   2  a status tab switch (live -> working): the cards that stay take their new height in one frame
//   3  three cards arriving in one update, and the three leaving again: no card mid-scale, the cards that stay resize in one frame
//   4  a card's composer opens from nothing and folds to nothing (no stop at its padding)
// Every sample counts only the copies of a card that are not hidden: a card re-dealt to the other column is the same card
// by its layoutId (the columns are separate parents, so React remounts it), and for a frame or two AnimatePresence still
// holds the old copy in the old column, hidden by the layout (visibility), until its exit completes.

import * as AC from "../agent-page-fixtures.mjs";
import { atOnce, between, readSampler, singleCopy, startSampler } from "./springprobe.mjs";

const VIEWPORT = { width: 1280, height: 1000, deviceScaleFactor: 1, mobile: false };
// the spring settles in ~0.35s; a sampler window is 900ms, so the next change waits a beat after it is over
const SETTLE_MS = 700;
// "early": a pop is judged on the frames before the spring has covered most of its way
const EARLY_MS = 250;

const HOUR = 3_600_000;
const card = (id) => `[data-agent-id="${id}"]:not([style*="visibility: hidden"])`;

// plain agents with a narration entry (cardHasContent) and, for a working one, a heartbeat; an idle one an hour old parks in
// the Idle section instead of taking a card
function agent(id, state, now) {
    const base = {
        id,
        name: id,
        task: `Spring task ${id}`,
        state,
        model: "sonnet",
        project: "arcterm",
        blockId: `ss-blk-${id}`,
        previousInfo: [
            { kind: "message", text: `Working on ${id}.` },
            { kind: "action", verb: "ran", target: "go test ./pkg/x/...", outcome: "ok" },
        ],
    };
    if (state === "working") return { ...base, activeMs: 30_000 };
    if (state === "idle") return { ...base, idleSince: now - HOUR };
    return {
        ...base,
        blockedMs: 45_000,
        ask: {
            askId: id,
            oref: `block:ss-blk-${id}`,
            questions: [{ question: `Proceed with ${id}?`, options: [{ label: "Yes" }, { label: "No" }] }],
        },
    };
}

// the roster in order: ids hold the slot they first appear in (syncCardOrder), so the parked agent "ss-x" keeps its second
// place and a card flipped to working lands there, with w2, w3, w4 and the asker after it
const roster = (now, { x = "idle", extra = [] } = {}) => [
    agent("ss-w1", "working", now),
    agent("ss-x", x, now),
    agent("ss-w2", "working", now),
    agent("ss-w3", "working", now),
    agent("ss-w4", "working", now),
    agent("ss-a1", "asking", now),
    ...extra.map((id) => agent(id, "working", now)),
];

// the tab whose label is `label` (need you, working, ready for review, live): pressing the selected one returns to live
const clickTab = (label) => `(() => {
    const b = [...document.querySelectorAll("[data-cockpit-surface] button")].find(
        (x) => x.lastElementChild?.textContent.trim() === ${JSON.stringify(label)}
    );
    b?.click();
    return b != null;
})()`;

// a key's value at each frame it changed, as [ms, value]: what a failed step reads to see whether it slid or jumped twice
const changes = (samples, key) => {
    const out = [];
    for (const s of samples) {
        const v = s.rect == null ? null : Math.round(s.rect[key] * 10) / 10;
        if (out.length === 0 || out[out.length - 1][1] !== v) out.push([Math.round(s.t), v]);
    }
    return out.slice(0, 12);
};

// What a layout animation does to a card's parts, read at every animation frame. A card that slides or resizes is scaled and
// moved by motion's layout; its direct parts (header, banner, body...) are counter-scaled and must stay put inside it. Two
// readings per part, off the transforms and the boxes:
//   the scale the screen applies to it (every transform from the part up to the page multiplied: exact, where a box's size
//   is rounded to whole pixels), which is 1 when it is not squashed;
//   how far its left and right edges sit from the card's own (the parts span the card's width), which is the card's border
//   when it travels with the card and tens of pixels when it trails or leads it (a card re-dealt to the other column is a
//   new instance, and a part with nothing to slide from lags it by the distance the card travels).
// Also the card's own scale (so a step can tell the card really was scaled) and a line of its body's.
const startParts = (selector, key, { ms = 900 } = {}) => `(() => {
    const samples = [];
    const t0 = performance.now();
    const scale = (el) => {
        let x = 1;
        let y = 1;
        for (let e = el; e != null && e !== document.body; e = e.parentElement) {
            const m = new DOMMatrix(getComputedStyle(e).transform);
            x *= m.a;
            y *= m.d;
        }
        return { x, y };
    };
    (window.__arcPartsProbe ??= {})[${JSON.stringify(key)}] = new Promise((resolve) => {
        const tick = () => {
            const t = performance.now() - t0;
            const card = document.querySelector(${JSON.stringify(selector)});
            const box = card?.getBoundingClientRect();
            const line = card?.lastElementChild?.querySelector("span, p");
            samples.push({
                t,
                card: card ? scale(card) : null,
                line: line ? scale(line) : null,
                parts: card
                    ? [...card.children].map((el) => {
                          const b = el.getBoundingClientRect();
                          return { ...scale(el), left: b.left - box.left, right: b.right - box.right, top: b.top - box.top };
                      })
                    : [],
            });
            if (t < ${Number(ms)}) requestAnimationFrame(tick);
            else resolve(samples);
        };
        tick();
    });
    return true;
})()`;
const readParts = (key) =>
    `(() => window.__arcPartsProbe?.[${JSON.stringify(key)}] ?? Promise.reject(new Error("readParts: startParts was not run first")))()`;
// the least and the most of a reading `pick` takes off the card's own box, or off each of its parts, over the frames
const rangeOf = (samples, pick) => {
    const v = samples.flatMap((s) => pick(s)).filter((x) => x != null);
    return v.length === 0 ? null : [Math.round(Math.min(...v) * 10) / 10, Math.round(Math.max(...v) * 10) / 10];
};
const cardScale = (axis) => (s) => [s.card?.[axis]];
const partScale = (axis) => (s) => s.parts.map((p) => p[axis]);
const partEdge = (edge) => (s) => s.parts.map((p) => p[edge]);

const cardsShown =`[...document.querySelectorAll("[data-cockpit-surface] [data-agent-id]")].map((e) => e.getAttribute("data-agent-id"))`;

export default (kit) => [
    {
        name: "surfaces-spring-cockpit",
        surface: "cockpit",
        async arrange() {
            return {};
        },

        async assert(h) {
            const steps = [];
            const rec = (step, ok, detail) =>
                steps.push({ step, ok: ok === true, detail: typeof detail === "string" ? detail : JSON.stringify(detail) });
            const shot = (name) => h.shot(`cdp-shots/surfaces-spring-cockpit-${name}.png`);
            const now = Date.now();
            const setRoster = (extra, x) => AC.setRoster(h, roster(now, { x, extra }));
            // sample `selector` over the change `trigger` makes; the first frame is taken before it
            const sample = async (selector, trigger) => {
                await h.ev(startSampler(selector));
                await trigger();
                return h.ev(readSampler());
            };
            const last = (samples) => samples[samples.length - 1];

            await h.cdp("Emulation.setDeviceMetricsOverride", VIEWPORT);
            await h.goto("cockpit");
            // the cards view on live (an earlier scenario may have left Office or a tab on)
            await h.ev(`(() => {
                const cards = [...document.querySelectorAll("[data-cockpit-view-toggle] button")].find((b) => b.textContent.trim() === "Cards");
                if (cards?.getAttribute("aria-pressed") !== "true") cards?.click();
                return true;
            })()`);
            await kit.polishNap(500);
            await h.ev(clickTab("live"));
            await setRoster([], "idle");
            await kit.polishNap(SETTLE_MS);
            const base = await h.ev(cardsShown);
            const baseOk = ["ss-w1", "ss-w2", "ss-w3", "ss-w4", "ss-a1"].every((id) => base.includes(id)) && !base.includes("ss-x");
            rec("0. the fixture roster is on the grid: five cards, the parked agent off it", baseOk, base);
            await shot("0-base");
            if (!baseOk) return steps;

            // 1. one card arriving, the cards after it re-dealt
            const pop = await sample(card("ss-x"), () => setRoster([], "working"));
            const earlyPop = pop.some((s) => s.t < EARLY_MS && s.rect != null && s.rect.width > 0 && s.rect.width < last(pop).rect.width - 0.5);
            rec("1a. the arriving card pops in on the spring: its width is under its final one at an early frame", earlyPop && last(pop).n === 1, {
                widths: pop.filter((s) => s.rect).slice(0, 8).map((s) => Math.round(s.rect.width * 10) / 10),
                final: last(pop).rect?.width,
            });
            await kit.polishNap(SETTLE_MS);
            await shot("1a-pop");

            await setRoster([], "idle");
            await kit.polishNap(SETTLE_MS);
            // a frame shot while the spring runs (the roster call returns as the cards start to move): the cards mid-slide
            // are scaled by their layout animation, and this is the frame to read the distortion from
            // two cards are re-dealt by this change, a working one and the asking one (a banner and a question as parts of its own)
            await h.ev(startParts(card("ss-w2"), "w2"));
            await h.ev(startParts(card("ss-a1"), "a1"));
            const redeal = await sample(card("ss-w2"), async () => {
                await setRoster([], "working");
                await shot("1b-redeal-midflight");
            });
            const w2 = await h.ev(readParts("w2"));
            const a1 = await h.ev(readParts("a1"));
            rec(
                "1b. a card re-dealt to the other column passes between its old and new place, one visible copy at every frame",
                between(redeal, "top") && between(redeal, "left") && singleCopy(redeal),
                {
                    top: [redeal[0].rect?.top, last(redeal).rect?.top],
                    left: [redeal[0].rect?.left, last(redeal).rect?.left],
                    copies: Math.max(...redeal.map((s) => s.n)),
                }
            );
            // the card is resized while it slides (it is re-dealt into a column with more cards), so its own box is scaled by the
            // layout animation; its parts are counter-scaled, so none of them is squashed with it (screen scale within 1% of 1)
            // and none trails or leads it (its edges stay within the card's border, 3px, of the card's own; a part that has
            // nothing to slide from is tens of px off at the first frame)
            const scaleOk = (r) => r != null && r[0] >= 0.99 && r[1] <= 1.01;
            const edgeOk = (r) => r != null && r[0] >= -3 && r[1] <= 3;
            const read = (parts) => ({
                partsX: rangeOf(parts, partScale("x")),
                partsY: rangeOf(parts, partScale("y")),
                lineY: rangeOf(parts, (s) => [s.line?.y]),
                left: rangeOf(parts, partEdge("left")),
                right: rangeOf(parts, partEdge("right")),
                // the first part is the header, which starts at the card's top edge
                headerTop: rangeOf(parts, (s) => [s.parts[0]?.top]),
            });
            const held = (r) =>
                scaleOk(r.partsX) &&
                scaleOk(r.partsY) &&
                (r.lineY == null || scaleOk(r.lineY)) &&
                edgeOk(r.left) &&
                edgeOk(r.right) &&
                edgeOk(r.headerTop);
            const cardY = rangeOf(w2, cardScale("y"));
            const w2Read = read(w2);
            const a1Read = read(a1);
            rec(
                "1c. a re-dealt card's parts stay unsquashed and travel with it: the working card and the asking one, every frame",
                // the working card itself must have been scaled (it is re-dealt into a smaller slot, so it is stretched, not
                // squashed), or the scale half proves nothing
                cardY != null && !scaleOk(cardY) && held(w2Read) && held(a1Read) && a1.some((s) => s.parts.length > 3),
                { cardY, w2: w2Read, a1: a1Read, a1Parts: Math.max(...a1.map((s) => s.parts.length)) }
            );
            await kit.polishNap(SETTLE_MS);
            await shot("1b-redeal");

            await setRoster([], "idle");
            await kit.polishNap(SETTLE_MS);
            const mate = await sample(card("ss-w1"), () => setRoster([], "working"));
            rec("1d. a column-mate's height passes between its old and new height (it resizes on the spring)", between(mate, "height"), {
                height: [mate[0].rect?.height, last(mate).rect?.height],
            });
            await kit.polishNap(SETTLE_MS);
            await shot("1c-column-mate");

            // 2. a status tab switch: the new list lands in one frame
            const tab = await sample(card("ss-w3"), () => h.ev(clickTab("working")));
            const afterTab = await h.ev(cardsShown);
            rec(
                "2. live -> working: the asker leaves and the cards that stay take their new height in one frame",
                atOnce(tab, "height") && !afterTab.includes("ss-a1") && afterTab.includes("ss-w3"),
                { height: [tab[0].rect?.height, last(tab).rect?.height], shown: afterTab }
            );
            await kit.polishNap(SETTLE_MS);
            await shot("2-tab-switch");

            // 3. three cards at once land in one frame, arriving and leaving
            const arrive = await sample(card("ss-n1"), () => setRoster(["ss-n1", "ss-n2", "ss-n3"], "working"));
            rec(
                "3a. three cards arriving in one update land in one frame: the first is full size from its first frame, not mid-scale",
                atOnce(arrive, "width") && atOnce(arrive, "height") && last(arrive).n === 1,
                { widths: arrive.filter((s) => s.rect).slice(0, 6).map((s) => Math.round(s.rect.width * 10) / 10) }
            );
            await kit.polishNap(SETTLE_MS);
            await shot("3a-three-arrive");

            // the grid is scrolled here (eight cards overflow it): the clamp when they leave must not set the cards sliding
            const leave = await sample(card("ss-w1"), () => setRoster([], "working"));
            rec("3b. the three leaving in one update: the cards that stay resize in one frame", atOnce(leave, "height"), {
                height: changes(leave, "height"),
            });
            await kit.polishNap(SETTLE_MS);
            await shot("3b-three-leave");

            // 4. a card's composer opens from nothing and folds to nothing: the folding box carries no padding of its own, so it
            // is not left standing at its padding for a frame before it vanishes, nor does it open from there. One card's
            // composer closes when another card's opens (one open composer at a time), which is the fold sampled here.
            const composerOf = (id) => `[data-agent-id="${id}"] .shrink-0.border-t > .overflow-hidden:has(textarea)`;
            const openComposer = (id) => `(() => {
                const row = [...document.querySelectorAll('[data-agent-id="${id}"] .cursor-text')].find((e) =>
                    e.textContent.includes("message ${id}")
                );
                row?.click();
                return row != null;
            })()`;
            // the heights the composer box had on the frames it existed
            const heights = (samples) => samples.filter((s) => s.rect != null).map((s) => Math.round(s.rect.height * 10) / 10);
            const FOLDED_PX = 6;
            const opening = await sample(composerOf("ss-w1"), () => h.ev(openComposer("ss-w1")));
            const openH = heights(opening);
            rec(
                "4a. a card's composer opens from nothing: its first frame is under 6px, then it passes between and ends at its height",
                openH.length > 2 &&
                    openH[0] < FOLDED_PX &&
                    openH[openH.length - 1] > 40 &&
                    openH.some((x) => x > openH[0] + 1 && x < openH[openH.length - 1] - 1),
                { heights: openH.slice(0, 10), final: openH[openH.length - 1] }
            );
            await kit.polishNap(SETTLE_MS);
            await shot("4a-composer-open");

            const folding = await sample(composerOf("ss-w1"), () => h.ev(openComposer("ss-w2")));
            const foldH = heights(folding);
            rec(
                "4b. a card's composer folds to nothing: the last frame it exists is under 6px, it does not stop at its padding and vanish",
                foldH.length > 2 &&
                    foldH[0] > 40 &&
                    foldH[foldH.length - 1] < FOLDED_PX &&
                    foldH.some((x) => x > foldH[foldH.length - 1] + 1 && x < foldH[0] - 1),
                { heights: foldH.slice(-10), first: foldH[0] }
            );
            await kit.polishNap(SETTLE_MS);
            await shot("4b-composer-fold");
            return steps;
        },

        async teardown(h) {
            const step = async (what, fn) => {
                try {
                    await fn();
                } catch (e) {
                    console.error(`surfaces-spring-cockpit teardown: ${what} failed: ${e?.message ?? e}`);
                }
            };
            await step("restore the roster", () => AC.restoreRoster(h));
            await step("back to live", () => h.ev(clickTab("live")));
            await step("clear the window size", () => h.cdp("Emulation.clearDeviceMetricsOverride", {}));
        },
    },
];
