// surfaces-spring-setup: Setup on Chat's spring, and the reduced-motion check (docs/superpowers/specs/2026-11-14-surfaces-chat-look-design.md
// §2 and §4; the plan's Task 7). The section it times is Setup → Project's "Global" group (ContextGroupView in projectcontexttab.tsx): it
// starts folded, and its head opens ~/.claude/CLAUDE.md and ~/.claude/settings.json under it and folds them again. The group's
// own box is what is sampled (springprobe.mjs), so both ends exist: the head alone, and the head with its rows.
//
//   1. the head opens the group on the spring: the section's height passes between closed and open, at an early frame and not in one
//      frame; the head folds it the same way
//   2. under prefers-reduced-motion (the page reloaded under it: useReducedMotion reads it at mount): the same group lands open in one
//      frame and folds in one frame
//
// The project is setup-project's fixture (a temp folder registered as a project, with its memory), reused through kit.scenario, so its
// teardown removes all of it; this one's teardown also clears the media emulation and reloads, so the next scenario does not start on a
// page that mounted under reduced motion. The other Setup sites on the spring (the three banners, Tools' other scripts and its rows,
// the Memory card's Details, the Learned lines) are not timed here: the Setup scenarios that already open them keep passing.

import { atOnce, between, readSampler, singleCopy, startSampler } from "./springprobe.mjs";

// setup-project's SP_PROJECT (scenarios.mjs): the registered project its arrange makes
const PROJECT = "verify-setup-project";
const GROUP = '[data-context-group="global"]';
const HEAD = `${GROUP} button[aria-expanded]`;
const ROWS = `${GROUP} [data-context-file], ${GROUP} [data-context-missing]`;
const REDUCE = [{ name: "prefers-reduced-motion", value: "reduce" }];

// milliseconds from the first sample to the first one strictly between its height and the last's; null if none
const earlyMs = (samples) => {
    const v = samples.map((s) => s.rect?.height);
    const first = v[0];
    const last = v.at(-1);
    const lo = Math.min(first, last);
    const hi = Math.max(first, last);
    const at = v.findIndex((x) => x !== undefined && x > lo && x < hi);
    return at === -1 ? null : Math.round(samples[at].t - samples[0].t);
};
const heights = (samples) => samples.map((s) => Math.round((s.rect?.height ?? 0) * 10) / 10);
const brief = (samples) => ({
    first: samples[0]?.rect?.height ?? null,
    last: samples.at(-1)?.rect?.height ?? null,
    frames: samples.length,
    early: earlyMs(samples),
    heights: heights(samples).slice(0, 12),
});

export default (kit) => {
    const { polishWaitFor, polishNap } = kit.rt;
    const press = (h, selector) => h.ev(`document.querySelector(${JSON.stringify(selector)})?.click()`);
    // one gesture, sampled: start the sampler on the group, do it, read the frames
    async function sampled(h, gesture) {
        await h.ev(startSampler(GROUP));
        await gesture();
        return h.ev(readSampler());
    }
    // Setup → Project with the fixture's project chosen and its Global group drawn, folded
    async function atGroup(h) {
        await h.goto("setup");
        await press(h, '[data-setup-tab="project"]');
        const listed = await polishWaitFor(h, `!!document.querySelector('[data-context-project="${PROJECT}"]')`, 10000);
        await press(h, `[data-context-project="${PROJECT}"]`);
        const drawn = await polishWaitFor(h, `!!document.querySelector('${GROUP}')`, 10000);
        await polishNap(500);
        return listed && drawn;
    }
    // the verdicts on the group's height
    const springs = (samples) => between(samples, "height") && !atOnce(samples, "height") && singleCopy(samples);
    const rowCount = (h) => h.ev(`document.querySelectorAll(${JSON.stringify(ROWS)}).length`);

    const scenario = {
        name: "surfaces-spring-setup",
        surface: "setup",
        async arrange(h) {
            const ctx = { base: kit.scenario("setup-project") };
            ctx.baseCtx = await ctx.base.arrange(h);
            if (ctx.baseCtx.arrangeError != null) {
                ctx.arrangeError = ctx.baseCtx.arrangeError;
            }
            return ctx;
        },
        async assert(h, ctx) {
            const steps = [];
            const rec = (step, ok, detail) => steps.push({ step, ok: !!ok, detail });
            rec("0. the fixture project is registered", ctx.arrangeError == null, ctx.arrangeError ?? "");
            if (ctx.arrangeError != null) return steps;

            // 1. the Global group opens on the spring and folds the same way
            const ready = await atGroup(h);
            if (!ready) {
                rec("1. Setup → Project drew the fixture's Global group", false, "not drawn in 10s");
                return steps;
            }
            const closed = await rowCount(h);
            const opened = await sampled(h, () => press(h, HEAD));
            await polishNap(300);
            const open = await rowCount(h);
            await h.shot("cdp-shots/surfaces-spring-setup-open.png");
            const folded = await sampled(h, () => press(h, HEAD));
            await polishNap(300);
            const shut = await rowCount(h);
            await h.shot("cdp-shots/surfaces-spring-setup-fold.png");
            rec(
                "1. a Setup section opens on the spring: the Global group's height passes between closed and open at an early frame and not in one, and its head folds it the same way",
                closed === 0 &&
                    open >= 1 &&
                    shut === 0 &&
                    springs(opened) &&
                    springs(folded) &&
                    opened.at(-1).rect.height > opened[0].rect.height &&
                    folded.at(-1).rect.height < folded[0].rect.height &&
                    (earlyMs(opened) ?? Infinity) < 400,
                JSON.stringify({ rows: [closed, open, shut], opened: brief(opened), folded: brief(folded) })
            );

            // 2. reduced motion. useReducedMotion reads the preference when a component mounts, so the page starts over under it
            // (the project is in wavesrv's config, so it is still registered; the tab and the project are chosen again)
            ctx.reduced = true;
            await h.cdp("Emulation.setEmulatedMedia", { features: REDUCE });
            await h.reload();
            const back = await atGroup(h);
            const emulated = await h.ev(`matchMedia("(prefers-reduced-motion: reduce)").matches`);
            if (!back) {
                rec("2. Setup → Project drew the Global group under reduced motion", false, "not drawn in 10s");
                return steps;
            }
            const redOpened = await sampled(h, () => press(h, HEAD));
            await polishNap(300);
            const redOpen = await rowCount(h);
            await h.shot("cdp-shots/surfaces-spring-setup-reduced-open.png");
            const redFolded = await sampled(h, () => press(h, HEAD));
            await polishNap(300);
            const redShut = await rowCount(h);
            await h.shot("cdp-shots/surfaces-spring-setup-reduced-fold.png");
            rec(
                "2. under prefers-reduced-motion the same group lands open in one frame and folds in one frame",
                emulated === true &&
                    redOpen >= 1 &&
                    redShut === 0 &&
                    atOnce(redOpened, "height") &&
                    atOnce(redFolded, "height") &&
                    redOpened.at(-1).rect.height > redOpened[0].rect.height &&
                    redFolded.at(-1).rect.height < redFolded[0].rect.height,
                JSON.stringify({ emulated, rows: [redOpen, redShut], opened: brief(redOpened), folded: brief(redFolded) })
            );
            return steps;
        },
        async teardown(h, ctx) {
            try {
                await h.cdp("Emulation.setEmulatedMedia", { features: [] });
                // the page that mounted under reduced motion would carry it into the next scenario
                if (ctx.reduced) await h.reload();
            } finally {
                await ctx.base.teardown(h, ctx.baseCtx);
            }
        },
    };
    return [scenario];
};
