// jarvis-initiative-sheet and jarvis-chunk-sheet: an initiative in the right sheet, and a chunk inside it
// (docs/superpowers/specs/2026-11-05-jarvis-revamp-design.md, plan docs/superpowers/plans/2026-11-05-jarvis-revamp.md).
// kit is scenarios.mjs's JARVIS_KIT.
//
// jarvis-initiative-sheet (Task 6; spec decision 7, board Sheet.dc.html): a real initiative with two stages (Design all
// done, Build where the work goes on), a chunk an agent proposed and a sub-initiative, opened through the router
// (window.__openAddress, openref.ts), as any route opens one. Its head (title, count, bar), the next chunk's accent →,
// both stages, the proposed group and the sub-initiative; then the plan edited in the sheet (+ Add chunk, a double-click
// rename, Alt+↓), Pin, Activity ↗ and back, and j stepping the chunk cursor. Every write goes to the initiatives this
// scenario made, which teardown deletes.

import { waitFor } from "./attach.mjs";

const TITLE = "verify-initiative-sheet";
const SUB = "verify-initiative-sheet sub";
const ADDED = "Sheet scenario added chunk";
const RENAMED = "Chunk keys, renamed in the sheet";
// [label, stage, status]: Design finished (it starts folded and previews its two rows), Build under way
const CHUNKS = [
    ["Write the sheet spec", "Design", "done"],
    ["Draw the Sheet board", "Design", "done"],
    ["Cards model", "Build", "active"],
    ["Sheet head", "Build", "pending"],
    ["Chunk list", "Build", "pending"],
    ["Chunk keys", "Build", "pending"],
];
const PROPOSED = "An agent's extra chunk";

const SHEET = '[data-jarvis-brief-sheet="effort"]';
const PLAN = `${SHEET} [data-jarvis-initiative-detail="sheet"]`;
const q = (s) => JSON.stringify(s);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const until = (h, expr, ms = 10_000) => waitFor((e) => h.ev(e), expr, ms);

// a real key through CDP: the binding registry listens on the window, as it does for a person's keys
async function press(h, key, { code = key, vk = 0, alt = false } = {}) {
    for (const type of ["keyDown", "keyUp"]) {
        await h.cdp("Input.dispatchKeyEvent", {
            type,
            key,
            code,
            windowsVirtualKeyCode: vk,
            modifiers: alt ? 1 : 0,
            ...(type === "keyDown" && key.length === 1 ? { text: key } : {}),
        });
    }
}

// a real click (or double-click) at the middle of an element, so the row's own click timing is what runs
async function mouse(h, expr, clicks = 1) {
    const at = await h.ev(`(() => {
        const el = ${expr};
        if (!el) return null;
        el.scrollIntoView({ block: "center", behavior: "instant" });
        const b = el.getBoundingClientRect();
        return { x: Math.round(b.x + Math.min(40, b.width / 2)), y: Math.round(b.y + b.height / 2) };
    })()`);
    if (at == null) return false;
    await h.cdp("Input.dispatchMouseEvent", { type: "mouseMoved", x: at.x, y: at.y });
    for (let n = 1; n <= clicks; n++) {
        await h.cdp("Input.dispatchMouseEvent", { type: "mousePressed", x: at.x, y: at.y, button: "left", clickCount: n });
        await h.cdp("Input.dispatchMouseEvent", { type: "mouseReleased", x: at.x, y: at.y, button: "left", clickCount: n });
    }
    return true;
}

const chunkRow = (label) => `document.querySelector(${q(`${PLAN} [data-jarvis-tracker-chunk="${label}"]`)})`;
// the server's chunks, in plan order
const serverChunks = async (h, oid) => ((await h.rpc("effortget", { effortoid: oid }))?.effort?.chunks ?? []);

// what the sheet draws, read in one pass
const readSheet = (h) =>
    h.ev(`(() => {
        const sheet = document.querySelector(${q(SHEET)});
        if (!sheet) return null;
        const t = (el) => (el?.innerText ?? "").replace(/\\s+/g, " ").trim();
        const next = sheet.querySelector('[data-jarvis-next-chunk="true"]');
        const rows = [...sheet.querySelectorAll("[data-jarvis-tracker-chunk]")];
        return {
            title: t(sheet.querySelector("[data-jarvis-initiative-sheet-title]")),
            meta: t(sheet.querySelector("[data-jarvis-initiative-sheet-meta]")),
            count: t(sheet.querySelector("[data-jarvis-initiative-sheet-count]")),
            segments: sheet.querySelector("[data-jarvis-segment-bar]")?.children.length ?? 0,
            next: next?.getAttribute("data-jarvis-tracker-chunk") ?? null,
            nextArrow: !!next?.querySelector("svg.text-accent"),
            nextWord: t(next?.querySelector("[data-jarvis-chunk-status]")),
            stages: [...sheet.querySelectorAll("[data-jarvis-tracker-stage]")].map((s) => s.getAttribute("data-jarvis-tracker-stage")),
            rows: rows.map((r) => r.getAttribute("data-jarvis-tracker-chunk")),
            cursor: rows.findIndex((r) => r.getAttribute("aria-pressed") === "true"),
            proposed: !!sheet.querySelector("[data-jarvis-proposed-chunk]"),
            sub: !!sheet.querySelector("[data-jarvis-linked-sub]"),
            pin: sheet.querySelector("[data-jarvis-sheet-pin]")?.getAttribute("data-jarvis-sheet-pin") ?? null,
            work: !!sheet.querySelector("[data-jarvis-initiative-sheet-head] [data-jarvis-work-on]"),
        };
    })()`);

const initiativeSheet = (kit) => ({
    name: "jarvis-initiative-sheet",
    surface: "jarvis",
    async arrange(h) {
        const ctx = {};
        await h.goto("jarvis");
        // a run that stopped half way left these behind
        await h.rpc("effortlist", {}).then(async (r) => {
            for (const e of (r?.efforts ?? []).filter((x) => x.title === TITLE || x.title === SUB)) {
                await h.rpc("effortdelete", { effortoid: e.oref.replace(/^effort:/, "") }).catch(() => {});
            }
        });
        try {
            const made = await h.rpc("effortcreate", { title: TITLE, chunks: CHUNKS.map(([label]) => ({ label })) });
            ctx.oid = made.effortoid;
            await h.rpc("effortmutate", {
                effortoid: ctx.oid,
                author: "you",
                ops: [
                    ...CHUNKS.map(([chunk, stage]) => ({ op: "setChunkStage", chunk, stage })),
                    ...CHUNKS.filter(([, , s]) => s !== "pending").map(([chunk, , status]) => ({ op: "setChunkStatus", chunk, status })),
                    { op: "appendNote", chunk: "Cards model", note: "pins sort the cards by the time they were pinned" },
                    { op: "addChunk", label: PROPOSED, stage: "Build", status: "proposed" },
                ],
            });
            const sub = await h.rpc("effortcreate", { title: SUB, parentoid: ctx.oid, chunks: [{ label: "A sub chunk" }] });
            ctx.subOid = sub.effortoid;
        } catch (e) {
            ctx.arrangeError = String(e?.message ?? e);
        }
        return ctx;
    },

    async assert(h, ctx) {
        if (ctx.arrangeError != null) {
            return [{ step: "0. the initiative and its sub-initiative were made", ok: false, detail: ctx.arrangeError }];
        }
        // the briefing (the card's pin, the sub-initiative under it) is read at boot: reload so it holds what was seeded
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

        await step("sheet open", async () => {
            await until(h, `typeof window.__openAddress === "function"`, 5_000);
            const opened = await h.ev(`window.__openAddress(${q("effort:" + ctx.oid)})`);
            if (!(await until(h, `!!document.querySelector(${q(`${PLAN} [data-jarvis-tracker-chunk]`)})`))) {
                return { ok: false, detail: `the sheet drew no plan (open: ${JSON.stringify(opened)})` };
            }
            await until(h, `!!document.querySelector(${q(`${SHEET} [data-jarvis-linked-sub]`)})`, 5_000);
            await sleep(400);
            await h.shot("cdp-shots/jarvis-initiative-sheet.png");
            const r = await readSheet(h);
            const problems = [];
            if (r.title !== TITLE) problems.push(`title "${r.title}"`);
            if (!r.meta.includes("active") || !r.meta.includes("updated")) problems.push(`meta "${r.meta}"`);
            if (r.count !== "2/6") problems.push(`count "${r.count}"`);
            if (r.segments !== 6) problems.push(`${r.segments} bar segments`);
            if (r.next !== "Cards model" || !r.nextArrow || r.nextWord !== "next") {
                problems.push(`next ${r.next} (arrow ${r.nextArrow}, word "${r.nextWord}")`);
            }
            if (r.stages.join(",") !== "Design,Build") problems.push(`stages ${r.stages.join(",")}`);
            // Design is all done: it starts folded, and its preview still shows both its rows
            if (r.rows.length !== 6) problems.push(`${r.rows.length} chunk rows`);
            if (!r.proposed) problems.push("no proposed chunk");
            if (!r.sub) problems.push("no sub-initiative");
            if (!r.work) problems.push("no Work on in the head");
            return { ok: problems.length === 0, detail: problems.join("; ") || `${r.count}, next ${r.next}` };
        });

        await step("edit plan", async () => {
            const problems = [];
            // + Add chunk at the end of Build, the last run
            const adds = await h.ev(`document.querySelectorAll(${q(`${PLAN} [data-jarvis-add-chunk]`)}).length`);
            await h.ev(`[...document.querySelectorAll(${q(`${PLAN} [data-jarvis-add-chunk]`)})].at(-1)?.click()`);
            if (!(await until(h, `document.activeElement?.getAttribute("aria-label") === "New chunk label"`, 3_000))) {
                return { ok: false, detail: `no chunk input after + Add chunk (${adds} add buttons)` };
            }
            await h.cdp("Input.insertText", { text: ADDED });
            await press(h, "Enter", { vk: 13 });
            if (!(await until(h, `!!${chunkRow(ADDED)}`))) problems.push("the added chunk never drew");
            const afterAdd = await serverChunks(h, ctx.oid);
            const added = afterAdd.find((c) => c.label === ADDED);
            if (added?.stage !== "Build") problems.push(`added chunk's stage "${added?.stage}"`);

            // a double-click renames in place (the row's single click waits for it, so no chunk opens)
            await mouse(h, chunkRow("Chunk keys"), 2);
            if (!(await until(h, `document.activeElement?.hasAttribute("data-jarvis-rename-input")`, 3_000))) {
                problems.push("no rename box after the double-click");
            } else {
                await h.ev(`document.activeElement.select()`);
                await h.cdp("Input.insertText", { text: RENAMED });
                await press(h, "Enter", { vk: 13 });
                if (!(await until(h, `!!${chunkRow(RENAMED)}`))) problems.push("the renamed chunk never drew");
            }
            const chunkOpen = await h.ev(`!!document.querySelector('[data-jarvis-chunk-view]')`);
            if (chunkOpen) problems.push("the double-click opened the chunk");

            // Alt+↓ moves the chunk under the cursor down its stage: j puts the cursor on the next chunk first
            await press(h, "j", { code: "KeyJ", vk: 74 });
            await sleep(200);
            const cursorAt = await h.ev(`document.querySelector(${q(`${PLAN} [data-jarvis-tracker-chunk][aria-pressed="true"]`)})?.getAttribute("data-jarvis-tracker-chunk")`);
            const before = (await serverChunks(h, ctx.oid)).map((c) => c.label);
            await press(h, "ArrowDown", { code: "ArrowDown", vk: 40, alt: true });
            let after = before;
            for (let waited = 0; waited < 5_000 && after.indexOf(cursorAt) <= before.indexOf(cursorAt); waited += 250) {
                await sleep(250);
                after = (await serverChunks(h, ctx.oid)).map((c) => c.label);
            }
            if (cursorAt == null) problems.push("j put no cursor on a chunk");
            else if (!(after.indexOf(cursorAt) > before.indexOf(cursorAt))) {
                problems.push(`Alt+↓ left "${cursorAt}" at ${after.indexOf(cursorAt)} (was ${before.indexOf(cursorAt)})`);
            }
            await sleep(300);
            await h.shot("cdp-shots/jarvis-initiative-sheet-edited.png");
            return { ok: problems.length === 0, detail: problems.join("; ") || `added, renamed, moved "${cursorAt}" down` };
        });

        await step("pin", async () => {
            const before = await readSheet(h);
            await h.ev(`document.querySelector(${q(`${SHEET} [data-jarvis-sheet-pin]`)})?.click()`);
            const pinned = await until(h, `document.querySelector(${q(`${SHEET} [data-jarvis-sheet-pin]`)})?.getAttribute("data-jarvis-sheet-pin") === "pinned"`);
            const text = await h.ev(`document.querySelector(${q(`${SHEET} [data-jarvis-sheet-pin]`)})?.innerText?.trim() ?? ""`);
            const effort = (await h.rpc("effortget", { effortoid: ctx.oid }))?.effort;
            await h.shot("cdp-shots/jarvis-initiative-sheet-pinned.png");
            return {
                ok: pinned && text === "Pinned" && (effort?.pinnedts ?? 0) > 0,
                detail: `was ${before?.pin}, now "${text}", pinnedts ${effort?.pinnedts ?? 0}`,
            };
        });

        await step("activity", async () => {
            await h.ev(`document.querySelector(${q(`${SHEET} [data-jarvis-sheet-activity]`)})?.click()`);
            const feed = await until(
                h,
                `!!document.querySelector(${q(`${SHEET} [data-jarvis-initiative-sheet-body="activity"] [data-jarvis-effort-section="notes"]`)})`
            );
            await sleep(300);
            await h.shot("cdp-shots/jarvis-initiative-sheet-activity.png");
            // the feed's rows under its heading: a chunk's head, its notes and events
            const entries = await h.ev(`document.querySelector(${q(`${SHEET} [data-jarvis-effort-section="notes"]`)})?.querySelectorAll("button, .relative").length ?? 0`);
            await h.ev(`document.querySelector(${q(`${SHEET} [data-jarvis-activity-back]`)})?.click()`);
            const back = await until(h, `!!document.querySelector(${q(PLAN)})`, 5_000);
            return { ok: feed && entries > 0 && back, detail: `feed ${feed}, ${entries} entries, back to the plan ${back}` };
        });

        await step("chunk keys", async () => {
            // the cursor sits where the last step left it; read it, then two j presses
            const at0 = (await readSheet(h)).cursor;
            // the page's errors while the keys land, so a crash names itself
            await h.ev(`(() => {
                window.__sheetErrors = [];
                window.addEventListener("error", (e) => window.__sheetErrors.push(String(e.message)));
                const orig = console.error;
                console.error = (...a) => { window.__sheetErrors.push(a.map(String).join(" ").slice(0, 400)); orig(...a); };
                return true;
            })()`);
            await press(h, "j", { code: "KeyJ", vk: 74 });
            await sleep(150);
            await press(h, "j", { code: "KeyJ", vk: 74 });
            await sleep(250);
            const r = await readSheet(h);
            const chunkOpen = await h.ev(`!!document.querySelector('[data-jarvis-chunk-view]')`);
            await h.shot("cdp-shots/jarvis-initiative-sheet-keys.png");
            if (r == null) {
                const errors = await h.ev(`window.__sheetErrors ?? []`).catch(() => []);
                return { ok: false, detail: `the sheet is gone after j; page errors: ${JSON.stringify(errors).slice(0, 1500)}` };
            }
            return {
                ok: at0 >= 0 && r.cursor === at0 + 2 && !chunkOpen,
                detail: `cursor ${at0} -> ${r.cursor} ("${r.rows[r.cursor]}"), a chunk opened ${chunkOpen}`,
            };
        });

        return steps;
    },

    async teardown(h, ctx) {
        await h.ev(`document.querySelector(${q(`${SHEET} [data-jarvis-initiative-sheet-head] button[aria-label="Close (Esc)"]`)})?.click()`).catch(() => {});
        for (const oid of [ctx.subOid, ctx.oid]) {
            if (oid != null) await h.rpc("effortdelete", { effortoid: oid }).catch(() => {});
        }
    },
});

// jarvis-chunk-sheet (Task 7; spec decision 9, board Chunk.dc.html): a three-chunk initiative whose middle chunk holds
// three notes (two the person's, one with no author: the server takes "agent" only from a block, so a scenario cannot
// write one) and two bare status changes, opened in the sheet and its middle chunk clicked. The head
// (back to the initiative, chunk 2 / 3), the trail's blocks and thin lines; s opens the status menu; 3 picks blocked,
// whose reason becomes the change's note, a block tagged → blocked; Notes only hides the thin lines and holds on the
// next chunk; Esc goes back to the initiative's plan.
const CHUNK_TITLE = "verify-chunk-sheet";
const TRAIL = "Trail chunk";
const REASON = "waiting on the API key from ops";

const chunkSheet = (kit) => ({
    name: "jarvis-chunk-sheet",
    surface: "jarvis",
    async arrange(h) {
        const ctx = {};
        await h.goto("jarvis");
        await h.rpc("effortlist", {}).then(async (r) => {
            for (const e of (r?.efforts ?? []).filter((x) => x.title === CHUNK_TITLE)) {
                await h.rpc("effortdelete", { effortoid: e.oref.replace(/^effort:/, "") }).catch(() => {});
            }
        });
        try {
            const made = await h.rpc("effortcreate", {
                title: CHUNK_TITLE,
                chunks: [{ label: "First chunk" }, { label: TRAIL }, { label: "Last chunk" }],
            });
            ctx.oid = made.effortoid;
            // one op per call, so each entry has its own time and the trail's order is the order written here
            const op = async (o, author = "you") => {
                await h.rpc("effortmutate", { effortoid: ctx.oid, ...(author ? { author } : {}), ops: [o] });
                await sleep(30);
            };
            await op({ op: "appendNote", chunk: TRAIL, note: "the oldest note: scoped the chunk" });
            await op({ op: "setChunkStatus", chunk: TRAIL, status: "active" });
            await op({ op: "appendNote", chunk: TRAIL, note: "a note of mine in the middle" });
            await op({ op: "setChunkStatus", chunk: TRAIL, status: "pending" });
            await op({ op: "appendNote", chunk: TRAIL, note: "the newest note, with no author" }, "");
        } catch (e) {
            ctx.arrangeError = String(e?.message ?? e);
        }
        return ctx;
    },

    async assert(h, ctx) {
        if (ctx.arrangeError != null) {
            return [{ step: "0. the initiative was made", ok: false, detail: ctx.arrangeError }];
        }
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
        const VIEW = `${SHEET} [data-jarvis-chunk-view]`;
        const readChunk = () =>
            h.ev(`(() => {
                const sheet = document.querySelector(${q(SHEET)});
                const view = sheet?.querySelector("[data-jarvis-chunk-view]");
                if (!view) return null;
                const t = (el) => (el?.innerText ?? "").replace(/\\s+/g, " ").trim();
                return {
                    label: view.getAttribute("data-jarvis-chunk-view"),
                    back: t(sheet.querySelector("[data-jarvis-chunk-back]")),
                    position: t(sheet.querySelector("[data-jarvis-chunk-position]")),
                    status: sheet.querySelector("[data-jarvis-chunk-status]")?.getAttribute("data-jarvis-chunk-status") ?? null,
                    move: sheet.querySelector("[data-jarvis-chunk-move]")?.getAttribute("data-jarvis-chunk-move") ?? null,
                    blocks: [...view.querySelectorAll("[data-jarvis-trail-block]")].map((b) => ({
                        tag: b.getAttribute("data-jarvis-trail-tag"),
                        text: t(b.querySelector("[data-jarvis-trail-text]")),
                    })),
                    lines: [...view.querySelectorAll("[data-jarvis-trail-line]")].map((l) => t(l)),
                    notesOnly: view.querySelector("[data-jarvis-notes-only]")?.getAttribute("data-jarvis-notes-only") ?? null,
                    menu: sheet.querySelector("[data-jarvis-chunk-status-menu]")?.getAttribute("data-jarvis-chunk-status-menu") ?? null,
                    options: sheet.querySelectorAll("[data-jarvis-chunk-status-option]").length,
                };
            })()`);

        await step("chunk open", async () => {
            await until(h, `typeof window.__openAddress === "function"`, 5_000);
            await h.ev(`window.__openAddress(${q("effort:" + ctx.oid)})`);
            if (!(await until(h, `!!${chunkRow(TRAIL)}`))) {
                return { ok: false, detail: "the sheet drew no plan with the trail chunk" };
            }
            await mouse(h, chunkRow(TRAIL));
            if (!(await until(h, `!!document.querySelector(${q(VIEW)})`, 5_000))) {
                return { ok: false, detail: "clicking the chunk opened no chunk view" };
            }
            await sleep(400);
            await h.shot("cdp-shots/jarvis-chunk-sheet.png");
            const r = await readChunk();
            const problems = [];
            if (r.label !== TRAIL) problems.push(`label "${r.label}"`);
            if (r.back !== CHUNK_TITLE) problems.push(`back "${r.back}"`);
            if (r.position !== "chunk 2 / 3") problems.push(`position "${r.position}"`);
            if (r.status !== "pending" || r.move !== "Start") problems.push(`status ${r.status}, move ${r.move}`);
            const texts = r.blocks.map((b) => b.text);
            if (texts.length !== 3 || !texts[0].includes("newest") || !texts[2].includes("oldest")) {
                problems.push(`blocks ${JSON.stringify(texts)}`);
            }
            if (r.lines.length !== 2 || !r.lines[0].includes("→ pending") || !r.lines[1].includes("→ active")) {
                problems.push(`lines ${JSON.stringify(r.lines)}`);
            }
            return { ok: problems.length === 0, detail: problems.join("; ") || `${r.blocks.length} blocks, ${r.lines.length} lines, ${r.position}` };
        });

        await step("status menu", async () => {
            await press(h, "s", { code: "KeyS", vk: 83 });
            const open = await until(h, `document.querySelector('[data-jarvis-chunk-status-menu]')?.getAttribute("data-jarvis-chunk-status-menu") === "open"`, 3_000);
            await sleep(200);
            await h.shot("cdp-shots/jarvis-chunk-sheet-menu.png");
            const r = await readChunk();
            return { ok: open && r.options === 6, detail: `menu ${r?.menu}, ${r?.options} statuses` };
        });

        await step("blocked reason", async () => {
            // 3 is blocked (pending, active, blocked, deferred, skipped, done): it asks why before it changes anything
            await press(h, "3", { code: "Digit3", vk: 51 });
            if (!(await until(h, `document.activeElement?.hasAttribute("data-jarvis-blocked-reason")`, 3_000))) {
                const r = await readChunk();
                return { ok: false, detail: `no reason box after 3 (menu ${r?.menu})` };
            }
            await h.cdp("Input.insertText", { text: REASON });
            await press(h, "Enter", { vk: 13 });
            const tagged = await until(
                h,
                `[...document.querySelectorAll(${q(`${VIEW} [data-jarvis-trail-block]`)})].some((b) => b.getAttribute("data-jarvis-trail-tag") === "blocked" && b.innerText.includes(${q(REASON)}))`
            );
            await sleep(300);
            await h.shot("cdp-shots/jarvis-chunk-sheet-blocked.png");
            const r = await readChunk();
            const server = (await serverChunks(h, ctx.oid)).find((c) => c.label === TRAIL);
            return {
                ok: tagged && r.status === "blocked" && r.move === "Unblock" && r.menu == null && server?.status === "blocked",
                detail: `tagged block ${tagged}, status ${r.status}, move ${r.move}, menu ${r.menu}, server ${server?.status}`,
            };
        });

        await step("notes only", async () => {
            await h.ev(`document.querySelector(${q(`${VIEW} [data-jarvis-notes-only]`)})?.click()`);
            const hidden = await until(h, `document.querySelectorAll(${q(`${VIEW} [data-jarvis-trail-line]`)}).length === 0`, 3_000);
            const r = await readChunk();
            await h.shot("cdp-shots/jarvis-chunk-sheet-notes-only.png");
            // j steps to the next chunk; Notes only is the viewer's, so it holds there
            await press(h, "j", { code: "KeyJ", vk: 74 });
            const moved = await until(h, `document.querySelector(${q(VIEW)})?.getAttribute("data-jarvis-chunk-view") === "Last chunk"`, 3_000);
            const next = await readChunk();
            const ok = hidden && r.blocks.length === 4 && moved && next.notesOnly === "on" && next.position === "chunk 3 / 3";
            // back off, so the next scenario's chunk shows its whole trail
            await h.ev(`document.querySelector(${q(`${VIEW} [data-jarvis-notes-only]`)})?.click()`);
            return {
                ok,
                detail: `lines hidden ${hidden}, ${r.blocks.length} blocks; j -> ${next?.label} (${next?.position}), notes only ${next?.notesOnly}`,
            };
        });

        await step("back", async () => {
            await press(h, "Escape", { code: "Escape", vk: 27 });
            const back = await until(h, `!document.querySelector(${q(VIEW)}) && !!document.querySelector(${q(PLAN)})`, 3_000);
            const head = await h.ev(`!!document.querySelector(${q(`${SHEET} [data-jarvis-initiative-sheet-head]`)})`);
            await h.shot("cdp-shots/jarvis-chunk-sheet-back.png");
            return { ok: back && head, detail: `plan shown ${back}, initiative head ${head}` };
        });

        return steps;
    },

    async teardown(h, ctx) {
        await h.ev(`document.querySelector(${q(`${SHEET} button[aria-label="Close (Esc)"]`)})?.click()`).catch(() => {});
        if (ctx.oid != null) await h.rpc("effortdelete", { effortoid: ctx.oid }).catch(() => {});
    },
});

export default function (kit) {
    return [initiativeSheet(kit), chunkSheet(kit)];
}
