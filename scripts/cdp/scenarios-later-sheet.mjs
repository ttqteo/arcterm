// later-sheet: the Later group on the initiative page (docs/superpowers/specs/2026-11-27-ask-later-design.md, Builder's
// calls 4 and 5; plan docs/superpowers/plans/2026-11-27-ask-later.md, Task 4). A chunk saved for later is kept on Jarvis,
// not worked: the initiative's plan, its count and its next arrow leave it out, and the sheet draws it in a "Later · N"
// group after the plan, on the ordinary chunk row.
// kit is scenarios.mjs's JARVIS_KIT.
//
// Two initiatives made here, both deleted in teardown, written through effortmutate as the person's own ops. The first
// holds three plan chunks (one done) and two later ones; the due one stands FIRST in the chunk order, where a rule that
// reads the list in order would pick it up as next. Its Later group is read, then "Not later" moves one chunk into the
// plan. The second holds one chunk, and it is later: the Later group draws alone. The sheet's body has no facts row, so
// the plan's count is read where the person reads it, the head's done/total.

import { waitFor } from "./attach.mjs";

const TITLE = "verify-later-sheet";
const ONLY_TITLE = "verify-later-sheet only";
// [label, status]: the plan. "Plan two" is the first chunk left open, so it holds the next arrow
const PLAN = [
    ["Plan one", "done"],
    ["Plan two", "pending"],
    ["Plan three", "pending"],
];
const DUE_LATER = "Saved item due today";
const PLAIN_LATER = "Saved item with no date";
const ONLY_LATER = "The only saved item";

const SHEET = '[data-jarvis-brief-sheet="effort"]';
const GROUP = `${SHEET} [data-initiative-later-group]`;
const q = (s) => JSON.stringify(s);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const until = (h, expr, ms = 10_000) => waitFor((e) => h.ev(e), expr, ms);

// today as the server holds a due date against it: the local day, YYYY-MM-DD
function localDay(now = new Date()) {
    const pad = (n) => String(n).padStart(2, "0");
    return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
}

const serverChunks = async (h, oid) => (await h.rpc("effortget", { effortoid: oid }))?.effort?.chunks ?? [];

// what the sheet draws, read in one pass: the plan's rows are the chunk rows outside the Later group
const readSheet = (h) =>
    h.ev(`(() => {
        const sheet = document.querySelector(${q(SHEET)});
        if (!sheet) return null;
        const t = (el) => (el?.innerText ?? "").replace(/\\s+/g, " ").trim();
        const label = (r) => r.getAttribute("data-jarvis-tracker-chunk");
        const inGroup = (el) => el.closest("[data-initiative-later-group]") != null;
        const rows = [...sheet.querySelectorAll("[data-jarvis-tracker-chunk]")];
        const next = sheet.querySelector('[data-jarvis-next-chunk="true"]');
        const group = sheet.querySelector("[data-initiative-later-group]");
        return {
            title: t(sheet.querySelector("[data-jarvis-initiative-sheet-title]")),
            count: t(sheet.querySelector("[data-jarvis-initiative-sheet-count]")),
            segments: sheet.querySelector("[data-jarvis-segment-bar]")?.children.length ?? 0,
            next: next ? label(next) : null,
            nextInGroup: next ? inGroup(next) : false,
            nextArrow: !!next?.querySelector("svg.text-accent"),
            plan: rows.filter((r) => !inGroup(r)).map(label),
            group: group
                ? {
                      heading: t(group.firstElementChild),
                      size: group.getAttribute("data-initiative-later-group"),
                      rows: [...group.querySelectorAll("[data-jarvis-tracker-chunk]")].map((r) => ({
                          label: label(r),
                          due: r.querySelector("[data-jarvis-chunk-due]")?.getAttribute("data-jarvis-chunk-due") ?? null,
                          chip: t(r.querySelector("[data-jarvis-chunk-due]")),
                          next: r.getAttribute("data-jarvis-next-chunk") === "true",
                          status: r.querySelector("[data-jarvis-chunk-status]")?.getAttribute("data-jarvis-chunk-status") ?? null,
                      })),
                  }
                : null,
            ideaDetail: !!sheet.querySelector("[data-jarvis-idea-detail]"),
        };
    })()`);

const laterSheet = (kit) => ({
    name: "later-sheet",
    surface: "jarvis",
    async arrange(h) {
        const ctx = { today: localDay() };
        await h.goto("jarvis");
        // a run that stopped half way left these behind
        await h.rpc("effortlist", {}).then(async (r) => {
            for (const e of (r?.efforts ?? []).filter((x) => x.title === TITLE || x.title === ONLY_TITLE)) {
                await h.rpc("effortdelete", { effortoid: e.oref.replace(/^effort:/, "") }).catch(() => {});
            }
        });
        try {
            const made = await h.rpc("effortcreate", { title: TITLE, chunks: PLAN.map(([label]) => ({ label })) });
            ctx.oid = made.effortoid;
            await h.rpc("effortmutate", {
                effortoid: ctx.oid,
                author: "you",
                ops: [
                    ...PLAN.filter(([, status]) => status !== "pending").map(([chunk, status]) => ({
                        op: "setChunkStatus",
                        chunk,
                        status,
                    })),
                    // the due one goes first in the chunk order, ahead of every plan chunk
                    { op: "addChunk", label: DUE_LATER, later: true, due: ctx.today, at: 1, note: "> passage saved for later" },
                    { op: "addChunk", label: PLAIN_LATER, later: true, note: "> another passage" },
                ],
            });
            // an initiative with one chunk, and that chunk is later (an idea, so it starts with no chunk)
            const only = await h.rpc("effortcreate", { title: ONLY_TITLE, chunks: [] });
            ctx.onlyOid = only.effortoid;
            await h.rpc("effortmutate", {
                effortoid: ctx.onlyOid,
                author: "you",
                ops: [{ op: "addChunk", label: ONLY_LATER, later: true, note: "> the one thing kept" }],
            });
        } catch (e) {
            ctx.arrangeError = String(e?.message ?? e);
        }
        return ctx;
    },

    async assert(h, ctx) {
        if (ctx.arrangeError != null) {
            return [{ step: "0. the initiatives were made", ok: false, detail: ctx.arrangeError }];
        }
        // the briefing (the sheet's head count reads it before the detail) is read at boot: reload so it holds what was seeded
        await kit.briefReload(h);
        const steps = [];
        const step = async (name, run) => {
            try {
                const r = await run();
                steps.push({ step: name, ok: r.ok === true, detail: r.detail });
            } catch (e) {
                steps.push({ step: name, ok: false, detail: String(e?.message ?? e) });
            }
        };
        const open = async (oid, until_) => {
            await until(h, `typeof window.__openAddress === "function"`, 5_000);
            const opened = await h.ev(`window.__openAddress(${q("effort:" + oid)})`);
            const drew = await until(h, until_);
            return { opened, drew };
        };

        await step("1. the plan counts three chunks, and the Later group holds the two saved ones", async () => {
            const { opened, drew } = await open(ctx.oid, `!!document.querySelector(${q(GROUP)})`);
            if (!drew) return { ok: false, detail: `the sheet drew no Later group (open: ${JSON.stringify(opened)})` };
            await sleep(400);
            await h.shot("cdp-shots/later-sheet-1-group.png");
            const r = await readSheet(h);
            const problems = [];
            if (r.title !== TITLE) problems.push(`title "${r.title}"`);
            // the head's done/total over the plan: the saved items are not in it, nor in its bar
            if (r.count !== "1/3") problems.push(`count "${r.count}" (want 1/3)`);
            if (r.segments !== 3) problems.push(`${r.segments} bar segments (want 3)`);
            if (r.plan.join("|") !== PLAN.map(([l]) => l).join("|")) problems.push(`plan rows ${r.plan.join("|")}`);
            // the due chunk stands first in the chunk order and is never next: the arrow is on the plan's first open chunk
            if (r.next !== "Plan two" || r.nextInGroup || !r.nextArrow) {
                problems.push(`next ${r.next} (in the group ${r.nextInGroup}, arrow ${r.nextArrow})`);
            }
            const g = r.group;
            if (g == null) return { ok: false, detail: "no Later group" };
            if (!g.heading.startsWith("Later") || !g.heading.includes("2") || g.size !== "2") {
                problems.push(`heading "${g.heading}", size ${g.size}`);
            }
            if (g.rows.map((x) => x.label).join("|") !== [DUE_LATER, PLAIN_LATER].join("|")) {
                problems.push(`group rows ${g.rows.map((x) => x.label).join("|")}`);
            }
            const due = g.rows.find((x) => x.label === DUE_LATER);
            const plain = g.rows.find((x) => x.label === PLAIN_LATER);
            // the chip reads the day (the year is dropped when it is this one)
            if (due?.due !== ctx.today || !due.chip.startsWith("due ")) problems.push(`due chip ${JSON.stringify(due)}`);
            if (plain?.due != null) problems.push(`the undated item shows a chip ${JSON.stringify(plain)}`);
            if (g.rows.some((x) => x.next)) problems.push("a later row carries the next arrow");
            // the server agrees: the two items are marked, the plan's chunks are not
            const chunks = await serverChunks(h, ctx.oid);
            const marked = chunks.filter((c) => c.later === true).map((c) => c.label);
            if (marked.join("|") !== [DUE_LATER, PLAIN_LATER].join("|")) problems.push(`server marks ${marked.join("|")}`);
            return {
                ok: problems.length === 0,
                detail: problems.join("; ") || `${r.count}, next ${r.next}, group ${g.heading} (${g.rows.length} rows, chip ${due?.chip})`,
            };
        });

        await step("2. Not later moves a saved item into the plan, and the server's chunk loses its mark", async () => {
            const row = `${GROUP} [data-jarvis-tracker-chunk=${q(PLAIN_LATER)}]`;
            await h.ev(`document.querySelector(${q(`${row} [data-jarvis-chunk-status]`)})?.click()`);
            const menuOpen = await until(h, `!!document.querySelector(${q(`${GROUP} [data-jarvis-tracker-menu]`)})`, 3_000);
            if (!menuOpen) return { ok: false, detail: "the later row's status button opened no menu" };
            await sleep(250);
            await h.shot("cdp-shots/later-sheet-2-menu.png");
            const items = await h.ev(
                `[...document.querySelectorAll(${q(`${GROUP} [data-jarvis-tracker-menu] button`)})].map((b) => b.innerText.replace(/\\s+/g, " ").trim())`
            );
            const problems = [];
            // a saved item has no place in the plan to move within, so its menu offers Not later in place of the moves
            if (!items.includes("Not later")) problems.push(`no Not later in ${JSON.stringify(items)}`);
            if (items.some((i) => i.startsWith("Move"))) problems.push(`a move in ${JSON.stringify(items)}`);
            await h.ev(
                `[...document.querySelectorAll(${q(`${GROUP} [data-jarvis-tracker-menu] button`)})].find((b) => b.innerText.includes("Not later"))?.click()`
            );
            const joined = await until(
                h,
                `(() => {
                    const rows = [...document.querySelectorAll(${q(`${SHEET} [data-jarvis-tracker-chunk]`)})];
                    const el = rows.find((r) => r.getAttribute("data-jarvis-tracker-chunk") === ${q(PLAIN_LATER)});
                    return !!el && el.closest("[data-initiative-later-group]") == null;
                })()`
            );
            if (!joined) problems.push("the item never joined the plan");
            // a row that leaves one list folds away on the spring while it opens in the other
            await sleep(600);
            await h.shot("cdp-shots/later-sheet-2-in-plan.png");
            const r = await readSheet(h);
            if (r.count !== "1/4") problems.push(`count "${r.count}" (want 1/4)`);
            if (r.segments !== 4) problems.push(`${r.segments} bar segments (want 4)`);
            if (r.plan.length !== 4 || !r.plan.includes(PLAIN_LATER)) problems.push(`plan rows ${r.plan.join("|")}`);
            if (r.group?.rows.map((x) => x.label).join("|") !== DUE_LATER) {
                problems.push(`group rows ${r.group?.rows.map((x) => x.label).join("|")}`);
            }
            if (r.group?.size !== "1") problems.push(`group size ${r.group?.size}`);
            const server = (await serverChunks(h, ctx.oid)).find((c) => c.label === PLAIN_LATER);
            if (server == null || server.later === true) problems.push(`the server's chunk is still marked ${JSON.stringify(server?.later)}`);
            // it joined where it stood in the chunk order (after the plan's chunks): the next arrow is still on Plan two
            if (r.next !== "Plan two") problems.push(`next ${r.next}`);
            return { ok: problems.length === 0, detail: problems.join("; ") || `${r.count}, ${r.plan.length} plan rows, group of ${r.group?.size}, server mark ${String(server?.later)}` };
        });

        await step("3. an initiative whose only chunk is later still draws its Later group", async () => {
            const { opened, drew } = await open(ctx.onlyOid, `!!document.querySelector(${q(`${GROUP} [data-jarvis-tracker-chunk=${q(ONLY_LATER)}]`)})`);
            if (!drew) return { ok: false, detail: `the Later group never drew (open: ${JSON.stringify(opened)})` };
            await sleep(400);
            await h.shot("cdp-shots/later-sheet-3-only-later.png");
            const r = await readSheet(h);
            const problems = [];
            if (r.title !== ONLY_TITLE) problems.push(`title "${r.title}"`);
            if (r.plan.length !== 0) problems.push(`plan rows ${r.plan.join("|")}`);
            if (r.group?.rows.map((x) => x.label).join("|") !== ONLY_LATER || r.group?.size !== "1") {
                problems.push(`group ${JSON.stringify(r.group)}`);
            }
            // the initiative has no plan yet, so the ways to give it one stay under the group
            if (!r.ideaDetail) problems.push("no way to plan it under the group");
            if (r.next != null) problems.push(`next ${r.next}`);
            return { ok: problems.length === 0, detail: problems.join("; ") || `${r.group?.rows.length} saved item, no plan rows, count ${r.count}` };
        });

        return steps;
    },

    async teardown(h, ctx) {
        await h.ev(`document.querySelector(${q(`${SHEET} [data-jarvis-initiative-sheet-head] button[aria-label="Close (Esc)"]`)})?.click()`).catch(() => {});
        for (const oid of [ctx.oid, ctx.onlyOid]) {
            if (oid != null) await h.rpc("effortdelete", { effortoid: oid }).catch(() => {});
        }
    },
});

export default function (kit) {
    return [laterSheet(kit)];
}
