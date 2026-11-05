// jarvis-brief-cards: the Brief's pinned initiative cards and the compact list under them
// (docs/superpowers/specs/2026-11-05-jarvis-revamp-design.md decisions 3 and 4, plan docs/superpowers/plans/2026-11-05-jarvis-revamp.md
// Task 4). Nine real initiatives, two of them pinned through the pin command; the steps read the cards, the heading, the
// list under them, the fallback cards once the pins are gone, and the two-column grid on a narrow window.
// kit is scenarios.mjs's JARVIS_KIT. The scenario passes once Task 8 mounts InitiativeCards and InitiativeList.
//
// The dev store may hold initiatives of its own, so every count is read against effortlist rather than assumed to be
// the nine seeded here: M is the live initiatives (archived ones and ideas left out), and the list holds M minus the
// two cards. Pins already in the store are lifted for the run and put back in their order by teardown.

const PREFIX = "JBC ";
const PINNED = [PREFIX + "pinned first", PREFIX + "pinned second"];
const OTHERS = [1, 2, 3, 4, 5, 6, 7].map((n) => `${PREFIX}other ${n}`);
const LIST_CAP = 6;
const CARDS = `[...document.querySelectorAll('[data-jarvis-card]')]`;
const ROWS = `[...document.querySelectorAll('[data-jarvis-initiative-row]')]`;

const oidOf = (oref) => String(oref ?? "").replace(/^effort:/, "");

// the live, non-idea initiatives and the pinned ones, as the cards model counts them (briefcards.ts)
async function storeCounts(h) {
    const { efforts = [] } = (await h.rpc("effortlist", {})) ?? {};
    const live = efforts.filter((e) => e.status !== "archived" && (e.total ?? 0) > 0);
    const pins = live.filter((e) => (e.pinnedts ?? 0) > 0).sort((a, b) => a.pinnedts - b.pinnedts);
    return { live: live.length, pins: pins.map((e) => oidOf(e.oref)) };
}

// what the region draws: the cards in order, the heading, the pin slot, the list rows, the +N more and the grid's columns
const readRegion = (h) =>
    h.ev(`(() => {
        const grid = document.querySelector('[data-jarvis-cards-grid]');
        const more = document.querySelector('[data-jarvis-initiatives-more="more"]');
        return {
            cards: ${CARDS}.map((c) => c.getAttribute('data-jarvis-card').replace(/^effort:/, '')),
            heading: document.querySelector('[data-jarvis-cards-count]')?.textContent.trim() ?? null,
            pinSlot: !!document.querySelector('[data-jarvis-pin-slot]'),
            rows: ${ROWS}.map((r) => r.getAttribute('data-jarvis-initiative-row').replace(/^effort:/, '')),
            more: more ? more.textContent.trim() : null,
            columns: grid ? getComputedStyle(grid).gridTemplateColumns.split(' ').filter(Boolean).length : 0,
        };
    })()`);

async function waitRegion(h, ok, ms = 10000) {
    let last = null;
    for (let waited = 0; waited < ms; waited += 300) {
        last = await readRegion(h).catch(() => null);
        if (last != null && ok(last)) return last;
        await new Promise((r) => setTimeout(r, 300));
    }
    return last;
}

export default function (kit) {
    const { briefNap, briefViewport, briefReload, briefSeedInitiative, briefDeleteEfforts } = kit;

    const pin = (h, oid, on) => h.rpc("effortpin", { effortoid: oid, pin: on });

    const jarvisBriefCards = {
        name: "jarvis-brief-cards",
        surface: "jarvis",
        async arrange(h) {
            const ctx = { efforts: [], pinned: [], liftedPins: [] };
            try {
                // a run cut short leaves its initiatives behind; start from none of them
                for (const t of [...PINNED, ...OTHERS]) {
                    await briefDeleteEfforts(h, t).catch(() => {});
                }
                // the store's own pins would take card slots: lift them, oldest first, for teardown to put back
                ctx.liftedPins = (await storeCounts(h)).pins;
                for (const oid of ctx.liftedPins) {
                    await pin(h, oid, false);
                }
                for (const title of [...OTHERS, ...PINNED]) {
                    const oid = await briefSeedInitiative(h, title, ["One", "Two", "Three"], [
                        { op: "setChunkStatus", chunk: "One", status: "done" },
                    ]);
                    ctx.efforts.push(oid);
                    if (PINNED.includes(title)) ctx.pinned.push(oid);
                }
                // pinned one after the other, so the first is the older pin and leads the cards
                for (const oid of ctx.pinned) {
                    await pin(h, oid, true);
                    await briefNap(30);
                }
                await briefViewport(h, 1600, 1000);
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
                rec("0. nine initiatives seeded, two pinned", false, ctx.arrangeError);
                return steps;
            }
            await h.goto("jarvis");
            const counts = await storeCounts(h);

            // 1. pinned cards: the two pins only, in pin order, then the Pin an initiative slot, under "Pinned 2 of M"
            const pinned = await waitRegion(h, (r) => r.cards.length > 0);
            await h.ev(`document.querySelector('[data-jarvis-cards]')?.scrollIntoView({ block: 'start' })`);
            await briefNap(300);
            await h.shot("cdp-shots/jarvis-brief-cards-pinned.png");
            rec(
                "1. pinned cards: two cards in pin order, the Pin an initiative slot and Pinned 2 of M",
                pinned != null &&
                    JSON.stringify(pinned.cards) === JSON.stringify(ctx.pinned) &&
                    pinned.pinSlot === true &&
                    pinned.heading === `Pinned 2 of ${counts.live}` &&
                    pinned.columns === 3,
                JSON.stringify({ want: { cards: ctx.pinned, live: counts.live }, got: pinned })
            );

            // 2. list: six rows of the others, then +N more, and no card repeated in it
            const others = counts.live - ctx.pinned.length;
            const wantRows = Math.min(LIST_CAP, others);
            const wantMore = others > LIST_CAP ? `+${others - LIST_CAP} more` : null;
            const list = await readRegion(h);
            const repeated = list.rows.filter((oid) => list.cards.includes(oid));
            rec(
                `2. list: ${wantRows} of the other ${others} rows with ${wantMore ?? "no more"} and no card repeated`,
                list.rows.length === wantRows && list.more === wantMore && repeated.length === 0,
                JSON.stringify({ wantRows, wantMore, rows: list.rows.length, more: list.more, repeated })
            );

            // 3. no pins: unpinned through the command, the cards fall back to the first six of the ordered list
            for (const oid of ctx.pinned) {
                await pin(h, oid, false);
            }
            await briefReload(h);
            const wantFallback = Math.min(6, counts.live);
            const fallback = await waitRegion(h, (r) => r.cards.length === wantFallback);
            const fallbackRepeated = (fallback?.rows ?? []).filter((oid) => (fallback?.cards ?? []).includes(oid));
            rec(
                `3. no pins: ${wantFallback} fallback cards, no pin slot, none of them repeated in the list`,
                fallback != null &&
                    fallback.cards.length === wantFallback &&
                    fallback.pinSlot === false &&
                    fallback.heading === `Pinned 0 of ${counts.live}` &&
                    fallbackRepeated.length === 0,
                JSON.stringify({ wantFallback, got: fallback, repeated: fallbackRepeated })
            );
            await h.shot("cdp-shots/jarvis-brief-cards-fallback.png");

            // 4. narrow: a 1200px window draws the cards in two columns
            await briefViewport(h, 1200, 900);
            await briefNap(800);
            const narrow = await waitRegion(h, (r) => r.columns === 2, 4000);
            await h.ev(`document.querySelector('[data-jarvis-cards]')?.scrollIntoView({ block: 'start' })`);
            await briefNap(300);
            await h.shot("cdp-shots/jarvis-brief-cards-narrow.png");
            rec("4. narrow: at 1200px the cards are two columns", narrow?.columns === 2, JSON.stringify(narrow));
            return steps;
        },
        async teardown(h, ctx) {
            for (const oid of ctx.efforts ?? []) {
                await h.rpc("effortdelete", { effortoid: oid }).catch(() => {});
            }
            // the store's own pins back, oldest first, so their order holds
            for (const oid of ctx.liftedPins ?? []) {
                await pin(h, oid, true).catch(() => {});
                await briefNap(30);
            }
            await h.cdp("Emulation.clearDeviceMetricsOverride").catch(() => {});
            await h.goto("cockpit");
        },
    };

    return [jarvisBriefCards];
}
