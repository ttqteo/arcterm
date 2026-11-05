// The lobby Christmas tree (docs/superpowers/specs/2026-11-05-christmas-tree-game-design.md, "Verification"), from a
// fixture season ledger put in place of wavesrv's answer by the DEV hook window.__cockpitOfficeTree: the tree in the
// Office hall, the Agent rail's pine at the season's stage, the milestone toast and the walk to the tree it opens, and
// the 1 January scene. The Christmas preset is on with its effects, and every
// `xmas.tree.*` key (the arrangement, the announced milestone) is cleared first, so a step starts from nothing
// announced. The roster is the christmas-office fixture, whose asking agent gives the rail. kit holds scenarios.mjs's
// and cockpitofficescenarios.mjs's helpers.

import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";

// the fixture's season; any year works, since the tree reads its dates from the fixture, not the clock
const SEASON = 2026;
const RAIL_VISIBLE_KEY = "agent.rail.visible";
const ASIDE = `document.querySelector('aside[aria-label="Agent details"]')`;
const PINE = `${ASIDE}?.querySelector("svg[data-rail-tree]")`;
const HALL_TREE = `document.querySelector("[data-cockpit-office] svg[data-xmas-tree]")`;
// the hall tree's cells by colour, its milestone and its size on screen
const HALL_TREE_READ = `(() => {
    const t = ${HALL_TREE};
    if (!t) return null;
    const fills = [...t.querySelectorAll("rect")].map((r) => r.getAttribute("fill"));
    const r = t.getBoundingClientRect();
    return {
        milestone: t.getAttribute("data-xmas-tree-milestone"),
        w: Math.round(r.width),
        h: Math.round(r.height),
        bulbs: fills.filter((f) => f === "var(--color-xmas-bulb)").length,
        rare: fills.filter((f) => f === "var(--color-xmas-snow)").length,
        big: fills.filter((f) => f === "var(--color-accent)").length,
    };
})()`;

// a season ledger of n finished tasks, a minute apart from 8 November
export function xmasTreeFixture(n, phase = "season") {
    const start = Date.UTC(SEASON, 10, 8, 9);
    return { season: SEASON, phase, done: Array.from({ length: n }, (_, i) => start + i * 60_000) };
}

export function xmasTreeScenarios(kit) {
    const { XMAS_KEYS, CHRISTMAS_ASKER, TREE_RAIL_FIXTURE, xmasRoster, xmasClip, polishWaitFor, ahReload, waitForOffice, probe, settleBoss } = kit;
    const nap = (ms) => new Promise((r) => setTimeout(r, ms));
    const setKey = (h, key, raw) =>
        h.ev(raw == null ? `localStorage.removeItem(${JSON.stringify(key)})` : `localStorage.setItem(${JSON.stringify(key)}, ${JSON.stringify(raw)})`);
    const setTree = (h, data) => h.ev(`window.__cockpitOfficeTree?.(${JSON.stringify(data)})`);
    const treeKeys = (h) => h.ev(`Object.fromEntries(Object.keys(localStorage).filter((k) => k.startsWith("xmas.tree.")).map((k) => [k, localStorage.getItem(k)]))`);
    const clearTreeKeys = (h) => h.ev(`Object.keys(localStorage).filter((k) => k.startsWith("xmas.tree.")).forEach((k) => localStorage.removeItem(k))`);
    // the toasts whose text holds `title`
    const toasts = (h, title) =>
        h.ev(`[...document.querySelectorAll("[data-notification-toast]")].filter((t) => (t.textContent || "").includes(${JSON.stringify(title)})).map((t) => t.textContent.trim())`);
    // the close button is the toast body's sibling
    const dismissAll = (h) =>
        h.ev(`[...document.querySelectorAll("[data-notification-toast]")].forEach((t) => t.parentElement?.querySelector("[data-notification-close]")?.click())`);
    // the hall around the tree, scrolled into view: from the hall's left to its right wall, the board's top to under the
    // tree's sign
    const hallShot = async (h, name) => {
        await h.ev(`${HALL_TREE}?.scrollIntoView({ block: "center", inline: "center" })`);
        await nap(300);
        const r = await h.ev(`(() => {
            const t = ${HALL_TREE};
            if (!t) return null;
            const b = t.getBoundingClientRect();
            return { x: Math.max(0, Math.floor(b.right + 12 - 234)), y: Math.max(0, Math.floor(b.top - 40)), vw: window.innerWidth, vh: window.innerHeight };
        })()`);
        if (r == null) return false;
        const clip = { x: r.x, y: r.y, width: Math.min(250, r.vw - r.x), height: Math.min(200, r.vh - r.y), scale: 2 };
        const { data } = await h.cdp("Page.captureScreenshot", { format: "png", clip });
        const path = `cdp-shots/${name}.png`;
        mkdirSync("cdp-shots", { recursive: true });
        writeFileSync(path, Buffer.from(data, "base64"));
        h.shots.push({ name, png: `${name}.png`, path });
        return true;
    };

    const scenario = {
        name: "office-xmas-tree",
        surface: "cockpit",
        async arrange(h) {
            const ctx = { prev: {} };
            for (const [k, key] of Object.entries(XMAS_KEYS)) {
                ctx.prev[k] = await h.ev(`localStorage.getItem(${JSON.stringify(key)})`);
            }
            ctx.prevRail = await h.ev(`localStorage.getItem(${JSON.stringify(RAIL_VISIBLE_KEY)})`);
            ctx.prevTree = await treeKeys(h);
            ctx.prevFixture = existsSync(TREE_RAIL_FIXTURE) ? readFileSync(TREE_RAIL_FIXTURE, "utf8") : null;
            // a throw past this point still returns ctx, so teardown puts back whatever was already changed
            try {
                ctx.wroteFixture = true;
                // the fixture's folder is gitignored, so a fresh tree (a run's final stage) has none
                mkdirSync(new URL(".", TREE_RAIL_FIXTURE), { recursive: true });
                await xmasRoster(h, true);
                // the Christmas preset, its effects on, the Cockpit opening on the Office, the rail shown, and no tree
                // arrangement or announced milestone
                await setKey(h, XMAS_KEYS.preset, JSON.stringify("christmas"));
                await setKey(h, XMAS_KEYS.effectsOff, null);
                await setKey(h, XMAS_KEYS.view, JSON.stringify("office"));
                await setKey(h, RAIL_VISIBLE_KEY, "true");
                await clearTreeKeys(h);
                // the stored atoms and the fixture roster are read at boot
                if (!(await ahReload(h))) throw new Error("the page did not come back after the reload");
                await h.goto("cockpit");
                // the Office mounts the DEV hooks, __cockpitOfficeTree among them
                const missing = await waitForOffice(h);
                if (missing) throw new Error(missing);
                ctx.ready = await polishWaitFor(h, `typeof window.__cockpitOfficeTree === "function"`, 10000);
            } catch (e) {
                ctx.arrangeError = String(e?.message ?? e);
            }
            return ctx;
        },
        async assert(h, ctx) {
            const steps = [];
            const rec = (step, ok, detail) => steps.push({ step, ok: !!ok, detail: typeof detail === "string" ? detail : JSON.stringify(detail) });
            if (ctx.arrangeError || !ctx.ready) {
                rec("0. arrange: the Christmas preset, the christmas-office roster and the Office's tree hook", false, {
                    error: ctx.arrangeError,
                    ready: ctx.ready,
                });
                return steps;
            }

            // hall-tree: 214 tasks in season; the Office on G draws the tree in the hall at milestone 4, board A's 14
            // small, 10 big and 1 rare, at 3 px a cell (15 x 25 cells)
            await setTree(h, xmasTreeFixture(214));
            await h.goto("cockpit");
            const hallShown = await polishWaitFor(h, `${HALL_TREE}?.getAttribute("data-xmas-tree-milestone") === "4"`, 5000);
            await nap(400);
            const hallTree = await h.ev(HALL_TREE_READ);
            const hallProbe = await probe(h);
            await hallShot(h, "office-xmas-tree-hall-zoom");
            await h.shot("cdp-shots/office-xmas-tree-hall.png");
            rec(
                "hall-tree. with 214 tasks this season, the Office on G draws the tree in the hall at milestone 4 with 14 small, 10 big and 1 rare ornaments",
                hallShown &&
                    hallProbe?.floor === 0 &&
                    hallProbe?.xmasTree != null &&
                    hallTree?.milestone === "4" &&
                    hallTree.w === 45 &&
                    hallTree.h === 75 &&
                    hallTree.bulbs === 14 &&
                    hallTree.big === 10 &&
                    hallTree.rare === 1,
                { hallTree, floor: hallProbe?.floor, xmasTree: hallProbe?.xmasTree }
            );

            // rail-pine: 214 tasks in season are milestone 4 (four tiers); the asker's Agent details rail, on Overview,
            // draws the pine at that stage with its ornaments
            await h.goto("agent");
            await h.ev(`document.querySelector('[data-agent-row="${CHRISTMAS_ASKER}"]')?.click()`);
            await polishWaitFor(h, `!!${ASIDE}?.querySelector('button[aria-label="Overview"]')`, 5000);
            await h.ev(`${ASIDE}?.querySelector('button[aria-label="Overview"]')?.click()`);
            const shown = await polishWaitFor(h, `${PINE}?.getAttribute("data-rail-tree-milestone") === "4"`, 5000);
            await nap(400);
            const pine = await h.ev(`(() => {
                const t = ${PINE};
                if (!t) return null;
                const fills = [...t.querySelectorAll("rect")].map((r) => r.getAttribute("fill"));
                const r = t.getBoundingClientRect();
                return {
                    milestone: t.getAttribute("data-rail-tree-milestone"),
                    w: Math.round(r.width),
                    h: Math.round(r.height),
                    bulbs: fills.filter((f) => f === "var(--color-xmas-bulb)").length,
                    rare: fills.filter((f) => f === "var(--color-xmas-snow)").length,
                    big: fills.filter((f) => f === "var(--color-accent)").length,
                };
            })()`);
            await h.shot("cdp-shots/office-xmas-tree-rail-pine.png");
            await xmasClip(h, "office-xmas-tree-rail-pine-zoom", 'aside[aria-label="Agent details"] svg[data-rail-tree]', 120, 100, 3).catch(() => false);
            // board A at 214: 14 small, 10 big, 1 rare; no star before milestone 7, so the accent cells are the big ones
            rec(
                "rail-pine. with 214 tasks this season, the asker's Agent details rail, on Overview, draws the pine at milestone 4 with its small, big and rare ornaments",
                shown && pine?.milestone === "4" && pine.w > 0 && pine.bulbs === 14 && pine.big === 10 && pine.rare === 1,
                pine
            );

            // milestone-toast: 249 tasks stay at milestone 4; the 250th grows the fifth tier and one toast says so; a
            // second answer at 250 adds none
            await dismissAll(h);
            await setTree(h, xmasTreeFixture(249));
            await nap(600);
            const before = await toasts(h, "The tree grew its 5th tier");
            await setTree(h, xmasTreeFixture(250));
            const toasted = await polishWaitFor(
                h,
                `[...document.querySelectorAll("[data-notification-toast]")].some((t) => (t.textContent || "").includes("The tree grew its 5th tier"))`,
                5000
            );
            const after = await toasts(h, "The tree grew its 5th tier");
            await h.shot("cdp-shots/office-xmas-tree-milestone-toast.png");
            await setTree(h, xmasTreeFixture(250));
            await nap(1000);
            const again = await toasts(h, "The tree grew its 5th tier");
            const announced = await h.ev(`localStorage.getItem("xmas.tree.announced.${SEASON}")`);
            rec(
                'milestone-toast. going from 249 to 250 tasks shows one toast "The tree grew its 5th tier" with "250 tasks finished this season", and a second answer at 250 adds none',
                toasted && before.length === 0 && after.length === 1 && after[0].includes("250 tasks finished this season") && again.length === 1 && announced === "5",
                { before, after, again, announced }
            );

            // milestone-toast, opened: clicking the toast (here from the Agent surface) opens the Cockpit's Office on G
            // and walks the boss to the tree, its cursor on the tree's key
            const clicked = await h.ev(
                `(() => { const t = [...document.querySelectorAll("[data-notification-toast]")].find((x) => (x.textContent || "").includes("The tree grew its 5th tier")); t?.click(); return !!t; })()`
            );
            const atOffice = await polishWaitFor(h, `!!${HALL_TREE}`, 5000);
            await polishWaitFor(h, `window.__cockpitOfficeProbe?.()?.cursor === "xmas-tree"`, 5000);
            const walked = await settleBoss(h, 8000);
            const spot = walked?.xmasTree?.spot;
            const onSpot =
                spot != null && walked?.boss != null && Math.abs(walked.boss.x - spot.x) <= 3 && Math.abs(walked.boss.y - spot.y) <= 3;
            await hallShot(h, "office-xmas-tree-toast-walk-zoom");
            rec(
                "milestone-toast. clicking the toast opens the Office on G and the boss walks to the tree, the cursor on xmas-tree",
                clicked && atOffice && walked?.floor === 0 && walked?.cursor === "xmas-tree" && onSpot,
                { clicked, atOffice, floor: walked?.floor, cursor: walked?.cursor, boss: walked?.boss, spot }
            );

            // new-year: 1 January, 1,632 tasks this season; fireworks go off over the hall and a sign under the tree
            // gives the season's total
            await setTree(h, xmasTreeFixture(1632, "newyear"));
            const fired = await polishWaitFor(h, `!!document.querySelector("[data-cockpit-office] [data-xmas-fireworks]")`, 5000);
            await nap(500);
            const ny = await h.ev(`(() => {
                const fw = document.querySelector("[data-cockpit-office] [data-xmas-fireworks]");
                const sign = document.querySelector("[data-cockpit-office] [data-xmas-sign]");
                const tree = ${HALL_TREE};
                const s = sign?.getBoundingClientRect();
                const t = tree?.getBoundingClientRect();
                return {
                    sparks: fw ? fw.querySelectorAll("rect").length : -1,
                    sign: sign ? (sign.textContent || "").trim() : null,
                    milestone: tree?.getAttribute("data-xmas-tree-milestone") ?? null,
                    signUnderTree: !!(s && t && s.top >= t.bottom && s.right <= t.right + 20),
                };
            })()`);
            await hallShot(h, "office-xmas-tree-new-year-zoom");
            await h.shot("cdp-shots/office-xmas-tree-new-year.png");
            rec(
                'new-year. on 1 January with 1,632 tasks, fireworks go off over the hall and the sign under the tree reads "This season: 1,632 tasks"',
                fired && ny?.sparks > 0 && ny.sign === "This season: 1,632 tasks" && ny.signUnderTree && ny.milestone === "7",
                ny
            );
            return steps;
        },
        async teardown(h, ctx) {
            const step = async (what, fn) => {
                try {
                    await fn();
                } catch (e) {
                    console.error(`office-xmas-tree teardown: ${what} failed: ${e?.message ?? e}`);
                }
            };
            await step("clear the tree fixture", () => setTree(h, null));
            await step("restore the stored theme, effects, Office view and rail", async () => {
                for (const [k, key] of Object.entries(XMAS_KEYS)) await setKey(h, key, ctx.prev?.[k]);
                await setKey(h, RAIL_VISIBLE_KEY, ctx.prevRail);
            });
            await step("restore the tree's stored arrangement and announcements", async () => {
                await clearTreeKeys(h);
                for (const [key, v] of Object.entries(ctx.prevTree ?? {})) await setKey(h, key, v);
            });
            if (ctx.wroteFixture) {
                await step("restore the fixture roster", () =>
                    ctx.prevFixture != null ? writeFileSync(TREE_RAIL_FIXTURE, ctx.prevFixture) : rmSync(TREE_RAIL_FIXTURE, { force: true })
                );
            }
            // the restored atoms and roster are read at boot
            await step("reload onto the restored state", async () => {
                if (!(await ahReload(h))) throw new Error("the page did not come back after the reload");
            });
            await step("leave on the Cockpit", () => h.goto("cockpit"));
        },
    };
    return [scenario];
}
