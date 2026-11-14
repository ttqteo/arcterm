// surfaces-spring-brief: Jarvis's brief page on the spring (docs/superpowers/specs/2026-11-14-surfaces-chat-look-design.md §1-§3,
// Task 4 of the plan). Each step times a motion with springprobe.mjs: a spring is judged by where the box is on the frames
// between two states, not by its two ends.
//   1. the Waiting strip's Show all opens its rows under the strip and folds them back: the strip's height is between closed
//      and open at some frame, and not there in one frame. (The strip's rows are the live Brief's one disclosure with a detail
//      to open: the row-detail sites in briefrowviews.tsx, InitiativeRow's and IdeaRow's `children`, are drawn by no live row.)
//   2. the initiatives list's "+N more" opens the rest of the list and "Show less" folds it: the list's height is between.
//   3. one idea arriving (created through the page's own createIdea, so the Brief refreshes as it does for the person) opens
//      its row on the spring: the Ideas region's height is between.
// Arrange reuses jarvis-brief-cards' (nine initiatives, two pinned, so the list holds more than its window) and adds two
// initiatives with a blocked chunk each, which are what the Waiting strip draws; teardown removes all of it.
// kit is scenarios.mjs's SS_KIT: kit.jarvis is JARVIS_KIT, kit.scenario(name) a registered scenario.

import { agentPage } from "../agent-page-fixtures.mjs";
import { atOnce, between, readSampler, singleCopy, startSampler } from "./springprobe.mjs";

const WAIT_TITLES = ["ssb-wait-1", "ssb-wait-2"];
const IDEA_TITLE = "ssb-idea-arriving";
const STRIP = "[data-jarvis-waiting-strip]";
const LIST = "[data-jarvis-initiative-list]";
const IDEAS = "[data-jarvis-ideas]";

export default (kit) => {
    const { briefNap, briefReload, briefSeedInitiative, briefDeleteEfforts, polishWaitFor } = kit.jarvis;

    const press = (h, selector) => h.ev(`document.querySelector(${JSON.stringify(selector)})?.click()`);
    const scrollTo = (h, selector) =>
        h.ev(`document.querySelector(${JSON.stringify(selector)})?.scrollIntoView({ block: 'center' })`);

    // starts the sampler on `selector`, runs `trigger`, and returns what the box did on every frame
    async function timed(h, selector, trigger, ms = 900) {
        await h.ev(startSampler(selector, { ms }));
        await trigger();
        return h.ev(readSampler());
    }

    // the verdicts on the height: it passed through the space between (a spring), and not in one frame (a snap)
    const springs = (samples) => between(samples, "height") && !atOnce(samples, "height") && singleCopy(samples);
    const brief = (samples) => ({
        first: samples[0]?.rect?.height ?? null,
        last: samples[samples.length - 1]?.rect?.height ?? null,
        frames: samples.length,
        between: between(samples, "height"),
        atOnce: atOnce(samples, "height"),
    });

    const scenario = {
        name: "surfaces-spring-brief",
        surface: "jarvis",
        async arrange(h) {
            const ctx = { titles: [] };
            ctx.cards = kit.scenario("jarvis-brief-cards");
            try {
                ctx.cardsCtx = await ctx.cards.arrange(h);
                if (ctx.cardsCtx.arrangeError != null) {
                    throw new Error(ctx.cardsCtx.arrangeError);
                }
                for (const title of WAIT_TITLES) {
                    await briefDeleteEfforts(h, title).catch(() => {});
                    await briefSeedInitiative(h, title, ["Stuck", "Next"], [
                        { op: "setChunkStatus", chunk: "Stuck", status: "blocked", note: "needs: a DEV soak" },
                    ]);
                    ctx.titles.push(title);
                }
                await briefDeleteEfforts(h, IDEA_TITLE).catch(() => {});
                await briefReload(h);
            } catch (e) {
                ctx.arrangeError = String(e?.message ?? e);
            }
            return ctx;
        },
        async assert(h, ctx) {
            const steps = [];
            const rec = (step, ok, detail) => steps.push({ step, ok, detail });
            if (ctx.arrangeError != null) {
                rec("0. the initiatives are seeded", false, ctx.arrangeError);
                return steps;
            }
            await h.goto("jarvis");
            const ready = await polishWaitFor(
                h,
                `!!document.querySelector('[data-jarvis-strip-show-all="shut"]') && !!document.querySelector('${LIST}')`,
                30000
            );
            await briefNap(600);
            if (!ready) {
                rec("0. the Brief drew its Waiting strip with Show all, and the initiatives list", false, "not drawn in 30s");
                return steps;
            }

            // 1. Show all opens the strip's rows on the spring, Show less folds them
            await scrollTo(h, STRIP);
            await briefNap(300);
            const opened = await timed(h, STRIP, () => press(h, '[data-jarvis-strip-show-all="shut"]'));
            await h.shot("cdp-shots/surfaces-spring-brief-waiting-open.png");
            const folded = await timed(h, STRIP, () => press(h, '[data-jarvis-strip-show-all="open"]'));
            await h.shot("cdp-shots/surfaces-spring-brief-waiting-fold.png");
            rec(
                "1. Show all opens the Waiting strip's rows on the spring (height between closed and open), and Show less folds them the same way",
                springs(opened) && springs(folded) && opened[opened.length - 1].rect.height > opened[0].rect.height,
                JSON.stringify({ opened: brief(opened), folded: brief(folded) })
            );

            // 2. "+N more" opens the rest of the initiatives list on the spring, Show less folds it
            await scrollTo(h, LIST);
            await briefNap(300);
            const hasMore = await h.ev(`!!document.querySelector('[data-jarvis-initiatives-more="more"]')`);
            const listOpened = hasMore
                ? await timed(h, LIST, () => press(h, '[data-jarvis-initiatives-more="more"]'))
                : [];
            await h.shot("cdp-shots/surfaces-spring-brief-more-open.png");
            const listFolded = hasMore
                ? await timed(h, LIST, () => press(h, '[data-jarvis-initiatives-more="less"]'))
                : [];
            await h.shot("cdp-shots/surfaces-spring-brief-more-fold.png");
            rec(
                "2. the initiatives list's +N more opens the rest on the spring (height between), and Show less folds it the same way",
                hasMore &&
                    springs(listOpened) &&
                    springs(listFolded) &&
                    listOpened[listOpened.length - 1].rect.height > listOpened[0].rect.height,
                JSON.stringify(hasMore ? { opened: brief(listOpened), folded: brief(listFolded) } : { hasMore })
            );

            // 3. one idea arriving opens its row on the spring: the briefing refresh lands a moment after the call, so the window is long
            await scrollTo(h, IDEAS);
            await briefNap(300);
            const arrived = await timed(
                h,
                IDEAS,
                () =>
                    agentPage(
                        h,
                        `const S = await mod("app/view/jarvis/effortstore.ts");
                        return await S.createIdea(${JSON.stringify(IDEA_TITLE)});`
                    ),
                3000
            );
            await h.shot("cdp-shots/surfaces-spring-brief-idea-arrives.png");
            const drawn = await h.ev(`document.querySelector('${IDEAS}')?.innerText.includes(${JSON.stringify(IDEA_TITLE)}) ?? false`);
            rec(
                "3. one idea arriving opens its row on the spring: the Ideas region's height is between its old and new",
                drawn === true &&
                    arrived[arrived.length - 1].rect.height > arrived[0].rect.height &&
                    springs(arrived),
                JSON.stringify({ drawn, ...brief(arrived) })
            );
            return steps;
        },
        async teardown(h, ctx) {
            for (const title of [...WAIT_TITLES, IDEA_TITLE]) {
                await briefDeleteEfforts(h, title).catch(() => {});
            }
            if (ctx?.cardsCtx != null) {
                await ctx.cards.teardown(h, ctx.cardsCtx).catch(() => {});
            }
        },
    };
    return [scenario];
};
