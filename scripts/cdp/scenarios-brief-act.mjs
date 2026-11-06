// brief-act-blocked: the Brief acts on a blocked chunk it shows (Task 9 of docs/superpowers/plans/2026-11-06-kael-sync-surfaces.md,
// from commit 3a462a716 of the kaeltran16 fork). The Waiting strip's row for a blocked chunk says what it needs, how long it
// has waited and the note written after the block, and carries Unblock and Done; Unblock writes the chunk back to pending
// with an Undo that blocks it again; opening the row lands on the chunk in its initiative's plan.
//
// Seeded like `brief-surface` (scenarios.mjs): one real initiative, since the router checks the store before it opens one,
// with a chunk blocked by a note ("needs: ...") and a later note on it. kit is scenarios.mjs's JARVIS_KIT: it has no
// briefCloseSheet, so that is duplicated here, as the plan says.
//
// The dev store may hold blocked chunks of its own, so every row is found by this scenario's initiative title.

const TITLE = "verify-brief-act-blocked";
const CHUNK = "Stuck";
const NEEDS = "needs: a DEV soak";
const LATER = "the blocker is gone on DEV";

// the Waiting strip's queue rows, and the one for this scenario's chunk (found by its initiative's title)
const QUEUE_ROWS = `[...document.querySelectorAll('[data-jarvis-waiting-strip] [data-jarvis-brief-row="queue"]')]`;
const OUR_ROW = `${QUEUE_ROWS}.find((r) => r.innerText.includes(${JSON.stringify(TITLE)}))`;

// what the row draws: its text parts, its buttons, and where it is in the queue
const readRow = (h) =>
    h.ev(`(() => {
        const row = ${OUR_ROW};
        if (!row) return null;
        const text = (sel) => row.querySelector(sel)?.textContent.trim() ?? null;
        return {
            text: row.innerText,
            title: row.querySelector('span[title]')?.getAttribute('title') ?? null,
            age: text('[data-jarvis-queue-age]'),
            latest: text('[data-jarvis-queue-latest]'),
            acts: [...row.querySelectorAll('[data-jarvis-queue-act]')].map((b) => b.dataset.jarvisQueueAct + ':' + b.textContent.trim()),
        };
    })()`);

const closeSheet = (h) =>
    h.ev(`(() => {
        const s = document.querySelector('[data-jarvis-brief-sheet]');
        const b = s && [...s.querySelectorAll('button')].find((b) => /^Close/.test(b.getAttribute('aria-label') ?? ''));
        b?.click();
        return !!b;
    })()`);

export default function (kit) {
    const { briefNap, briefViewport, briefReload, briefSeedInitiative, briefDeleteEfforts, polishWaitFor } = kit;

    // the strip's rows open under it with Show all; leave them open once they are
    const openRows = async (h) => {
        await h.ev(`document.querySelector('[data-jarvis-strip-show-all="shut"]')?.click()`);
        return polishWaitFor(h, `!!(${OUR_ROW})`, 30000);
    };

    const scenario = {
        name: "brief-act-blocked",
        surface: "jarvis",
        async arrange(h) {
            const ctx = {};
            try {
                await briefDeleteEfforts(h, TITLE);
                ctx.effortId = await briefSeedInitiative(h, TITLE, [CHUNK, "Next"], [
                    { op: "setChunkStatus", chunk: CHUNK, status: "blocked", note: NEEDS },
                    { op: "appendNote", chunk: CHUNK, note: LATER },
                ]);
            } catch (e) {
                ctx.arrangeError = String(e?.message ?? e);
            }
            return ctx;
        },
        async assert(h, ctx) {
            const steps = [];
            if (ctx.arrangeError != null || ctx.effortId == null) {
                return [{ step: "arrange: seed the blocked chunk", ok: false, detail: ctx.arrangeError ?? "no initiative" }];
            }
            await briefViewport(h, 1600, 1000);
            await briefReload(h);
            await h.goto("jarvis");

            // 1. the waiting row says what the chunk needs, how long it has waited and the note written after the block, and
            // has Unblock and Done in place of Open
            const found = await openRows(h);
            await briefNap(400);
            const row = found ? await readRow(h) : null;
            await h.shot("cdp-shots/brief-act-blocked-row.png");
            steps.push({
                step: "1. a blocked chunk's waiting row shows what it needs, its age and the newer note, with Unblock and Done",
                ok:
                    row != null &&
                    row.text.includes(CHUNK) &&
                    row.text.includes(NEEDS) &&
                    /^(· )?(just now|\d+[mhd])$/.test(row.age ?? "") &&
                    (row.latest ?? "").includes(LATER) &&
                    (row.latest ?? "").startsWith("latest ") &&
                    row.acts.join("|") === "unblock-chunk:Unblock|done-chunk:Done",
                detail: JSON.stringify(row ?? { found }),
            });

            // 2. Unblock settles it in place: the row leaves the queue and the toast offers an Undo
            await h.ev(`${OUR_ROW}?.querySelector('[data-jarvis-queue-act="unblock-chunk"]')?.click()`);
            const toasted = await polishWaitFor(
                h,
                `(document.querySelector('[data-jarvis-brief-toast]')?.textContent ?? '').includes('Unblocked · ${CHUNK}')`,
                8000
            );
            const gone = await polishWaitFor(h, `!(${OUR_ROW})`, 30000);
            // the toast outlives the refresh by a moment; shoot it with its Undo
            const undoShown = await h.ev(`!!document.querySelector('[data-jarvis-toast-undo]')`).catch(() => false);
            await h.shot("cdp-shots/brief-act-blocked-undo.png");
            const written = (await h.rpc("effortlist", {}))?.efforts?.find((e) => e.oref === "effort:" + ctx.effortId);
            const status = written?.chunks?.find((c) => c.label === CHUNK)?.status ?? null;
            steps.push({
                step: "2. Unblock writes the chunk back to pending, leaves the queue and offers Undo",
                ok: toasted && gone && undoShown && status === "pending",
                detail: JSON.stringify({ toasted, gone, undoShown, status }),
            });

            // 3. Undo blocks it again with what it needs, so the row comes back
            await h.ev(`document.querySelector('[data-jarvis-toast-undo]')?.click()`);
            const back = await polishWaitFor(h, `!!(${OUR_ROW})`, 30000);
            const again = back ? await readRow(h) : null;
            steps.push({
                step: "3. Undo blocks the chunk again and its row returns saying what it needs",
                ok: back && again != null && again.text.includes(NEEDS),
                detail: JSON.stringify(again ?? { back }),
            });

            // 4. opening the row (not its buttons) lands on the chunk in its initiative's plan
            await h.ev(`${OUR_ROW}?.querySelector('span[title]')?.click()`);
            const landed = await polishWaitFor(
                h,
                `document.querySelector('[data-jarvis-brief-sheet]')?.dataset.jarvisBriefSheet === 'effort' && !!document.querySelector('[data-jarvis-chunk-view=${JSON.stringify(CHUNK)}]')`,
                15000
            );
            // the trail loads with the initiative's detail, a moment after the sheet is up
            await polishWaitFor(
                h,
                `(document.querySelector('[data-jarvis-brief-sheet]')?.innerText ?? '').includes(${JSON.stringify(LATER)})`,
                10000
            );
            await briefNap(300);
            const sheet = await h.ev(`(() => {
                const el = document.querySelector('[data-jarvis-brief-sheet]');
                return {
                    face: el?.dataset.jarvisBriefSheet ?? null,
                    head: el?.querySelector('[data-jarvis-initiative-sheet-head]')?.dataset.jarvisInitiativeSheetHead ?? null,
                    chunk: el?.querySelector('[data-jarvis-chunk-view]')?.dataset.jarvisChunkView ?? null,
                    status: el?.querySelector('[data-jarvis-chunk-status]')?.dataset.jarvisChunkStatus ?? null,
                    notes: el?.innerText.includes(${JSON.stringify(LATER)}) ?? false,
                };
            })()`);
            await h.shot("cdp-shots/brief-act-blocked-chunk.png");
            steps.push({
                step: "4. opening a blocked chunk's row lands on the chunk in its initiative's plan, notes in view",
                ok:
                    landed &&
                    sheet.face === "effort" &&
                    sheet.head === `effort:${ctx.effortId}` &&
                    sheet.chunk === CHUNK &&
                    sheet.status === "blocked" &&
                    sheet.notes === true,
                detail: JSON.stringify(sheet),
            });
            await closeSheet(h);
            return steps;
        },
        async teardown(h, ctx) {
            await closeSheet(h).catch(() => {});
            if (ctx?.effortId != null) {
                await h.rpc("effortdelete", { effortoid: ctx.effortId }).catch(() => {});
            }
            await briefDeleteEfforts(h, TITLE).catch(() => {});
        },
    };
    return [scenario];
}
