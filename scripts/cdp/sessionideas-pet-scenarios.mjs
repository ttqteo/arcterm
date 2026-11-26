// sessionideas-pet: Sprout's popup and the Waiting line for session ideas (docs/superpowers/specs/2026-11-26-session-ideas-design.md,
// plan docs/superpowers/plans/2026-11-26-session-ideas.md, Task 9). The module holds the fixture the popup's steps run against:
// fixture mode on (the scan reads the seeded sessions below, never ~/.claude, and its model call returns the seeded
// reply and spends nothing), two ideas on a real initiative, one new idea, and the fixture sessions they came from. No step
// calls a model, reads a real transcript or opens a real agent: a press of Discuss or Go through runs under Task 6's launch
// hook (`__waveSessionIdeasLaunch`), and a typed route runs on a canned reply under the route hook (`__waveJarvisRoute`).
// kit is scenarios.mjs's JARVIS_KIT. The Brief's own module (sessionideas-brief-scenarios.mjs) seeds the same shape under
// its own titles, so the two never share an initiative.

import { agentPage } from "./agent-page-fixtures.mjs";

const DAY = 86_400_000;
const TITLE = "SIP initiative";
const PROJECT = "sip-project";
const PROJECT_PATH = "C:\\arc-verify-sip\\project";

// the gists the steps read back; the first is the idea whose transcript is deleted soonest, so it is Discuss's
const GIST_LEAVING = "Let the popup list the ideas that lose their transcript first";
const GIST_TWO = "Say how many ideas are waiting under the updates";
const GIST_NEW = "Offer a quick pass through every idea in one agent";

const PEEK = "[data-pet-peek]";
const LINE = `${PEEK} [data-pet-ideas-line]`;
const chip = (kind) => `${PEEK} [data-pet-idea-chip="${kind}"]`;
const started = (kind) => `${PEEK} [data-pet-idea-started="${kind}"]`;
const LIST_ROWS = `${PEEK} [data-pet-ideas-list] [data-pet-idea-row]`;
const WAITING_ROW = `${PEEK} [data-pet-row="session-ideas"]`;
const TOASTS = "[data-notification-toast]";

const transcript = (id) => `${PROJECT_PATH}\\.claude\\${id}.jsonl`;

// The seed the popup's steps share. Session 1 is 85 days old, so its transcript is deleted in 5 days: its idea is the one
// the chips call leaving soon, and the first row. Session 2 gave the other two ideas and is a long way from deletion; session 3
// is quiet and not yet scanned. `foundAgo` is how long ago the scan found the ideas, and `seenAgo` how long ago the person
// last looked (0: never), which is what the 7-day Waiting line counts from.
function sessionIdeasPetSeed(effortoid, { now = Date.now(), foundAgo = 1, seenAgo = 0, scan } = {}) {
    const session = (n, ageDays, over = {}) => {
        const lastwritets = now - ageDays * DAY;
        return {
            sessionid: `sip-session-${n}`,
            title: `SIP session ${n}`,
            project: PROJECT,
            transcriptpath: transcript(`sip-session-${n}`),
            size: 30_000 + n,
            lastwritets,
            deletests: lastwritets + 90 * DAY,
            outcome: "not-scanned",
            ideas: 0,
            ...over,
        };
    };
    const sessions = [
        session(1, 85, { outcome: "ideas", ideas: 1 }),
        session(2, 12, { outcome: "ideas", ideas: 2 }),
        session(3, 4),
    ];
    const mark = (s, ideas) => ({
        transcriptpath: s.transcriptpath,
        sessionid: s.sessionid,
        sessiontitle: s.title,
        project: PROJECT,
        size: s.size,
        mtimems: s.lastwritets,
        scannedts: now - DAY,
        lastturnts: s.lastwritets,
        ideas,
        outcome: "ideas",
    });
    const idea = (n, s, over) => ({
        id: `sip-idea-${n}`,
        project: PROJECT,
        projectpath: PROJECT_PATH,
        why: "It came up while fixing something else and nobody picked it up.",
        sessionid: s.sessionid,
        sessiontitle: s.title,
        transcriptpath: s.transcriptpath,
        saidts: s.lastwritets - 3_600_000,
        deletests: s.deletests,
        foundts: now - foundAgo * DAY,
        state: "review",
        resolvedts: 0,
        keptas: "",
        ...over,
    });
    const ideas = [
        idea(1, sessions[0], {
            gist: GIST_LEAVING,
            effortoid,
            efforttitle: TITLE,
            quotes: [{ who: "you", text: "which of these goes away soonest?" }],
        }),
        idea(2, sessions[1], {
            gist: GIST_TWO,
            effortoid,
            efforttitle: TITLE,
            quotes: [{ who: "agent", text: "A single line under the updates would do." }],
        }),
        idea(3, sessions[1], {
            gist: GIST_NEW,
            effortoid: "",
            efforttitle: "",
            quotes: [{ who: "you", text: "one agent could walk them with me" }],
        }),
    ];
    return {
        data: {
            ideas,
            marks: [mark(sessions[0], 1), mark(sessions[1], 2)],
            sessions: [],
            lastscants: now - DAY,
            nextscants: now + 6 * DAY,
            seents: seenAgo > 0 ? now - seenAgo * DAY : 0,
            snoozeduntil: 0,
            firstscandone: true,
            ...(scan != null ? { scan } : {}),
        },
        fixture: true,
        sessions,
        reply: "[]",
    };
}

// a real initiative for the two ideas to sit on, then the seed written with fixture mode on; returns the initiative's oid
async function arrangeSessionIdeasPet(h, kit) {
    await kit.briefDeleteEfforts(h, TITLE).catch(() => {});
    const effortoid = await kit.briefSeedInitiative(h, TITLE, ["One", "Two"]);
    await h.rpc("sessionideasseed", sessionIdeasPetSeed(effortoid));
    return effortoid;
}

// the store emptied and fixture mode off, the initiative gone, the launch hook off and the popup closed; each part on its own
// so one failing leaves the others done
async function teardownSessionIdeasPet(h, kit) {
    await h.rpc("sessionideasseed", { clear: true }).catch(() => {});
    await kit.briefDeleteEfforts(h, TITLE).catch(() => {});
    await h
        .ev(`(() => { globalThis.__waveSessionIdeasLaunch?.setHook(false); globalThis.__waveSessionIdeasLaunch?.clear(); })()`)
        .catch(() => {});
    await closePeek(h).catch(() => {});
}

// the app's own atoms, through its modules (agent-page-fixtures.mjs), as an async function's body
const page = (h, body) => agentPage(h, body);
const closePeek = (h) => page(h, `const S = await mod("app/view/jarvis/peekstore.ts"); S.closePeek(); return true;`);

// the review ideas the feed holds, by id, once it holds `count` of them (false past the wait)
const feedHolds = (h, count) =>
    page(
        h,
        `const S = await mod("app/view/jarvis/sessionideasstore.ts");
         const ids = () => (globalStore.get(S.sessionIdeasAtom)?.ideas ?? []).filter((i) => i.state === "review").map((i) => i.id);
         return (await until(() => ids().length === ${count}, 10000)) ? ids() : false;`
    );

// the pet's popup open, as a person opens it: the creature focused and Enter pressed. The creature's key toggles, so a popup
// already open is left as it is.
async function openPeek(h, kit) {
    if (await h.ev(`document.querySelector('${PEEK}') != null`)) return true;
    await h.ev(`document.querySelector('[aria-label="Jarvis condition"]')?.focus()`);
    for (const type of ["keyDown", "keyUp"]) {
        await h.cdp("Input.dispatchKeyEvent", { type, key: "Enter", code: "Enter", windowsVirtualKeyCode: 13 });
    }
    return kit.polishWaitFor(h, `document.querySelector('${PEEK} [data-pet-errand-input]') != null`, 10000);
}

const click = (h, selector) =>
    h.ev(`(() => {
        const el = document.querySelector(${JSON.stringify(selector)});
        if (!el) return false;
        el.click();
        return true;
    })()`);

const textOf = (h, selector) => h.ev(`document.querySelector(${JSON.stringify(selector)})?.textContent?.trim() ?? null`);
const allTexts = (h, selector) =>
    h.ev(`[...document.querySelectorAll(${JSON.stringify(selector)})].map((e) => e.textContent.trim())`);
const launches = (h) => h.ev(`globalThis.__waveSessionIdeasLaunch?.launches() ?? null`);

// a canned reply as the routing consult's stream end: prose, then the arc-route block; resolves "ok" or the hook's error text
const routeReply = (prose, verdict) => `${prose}\n\n\`\`\`arc-route\n${JSON.stringify(verdict)}\n\`\`\`\n`;
const finishRoute = (h, request, reply) =>
    h.ev(
        `globalThis.__waveJarvisRoute.finish(${JSON.stringify(request)}, ${JSON.stringify(reply)}).then(() => "ok", (e) => String(e?.message ?? e))`
    );
const ideasVerdict = (over) => ({
    project: "",
    agent: "",
    ambiguous: false,
    task: "duyệt giúp tôi",
    reason: "they asked to go through the ideas",
    considered: [],
    ...over,
});

export function sessionIdeasPetScenarios(kit) {
    const sessionIdeasPet = {
        name: "sessionideas-pet",
        surface: "agent",
        async arrange(h) {
            const ctx = {};
            try {
                ctx.effortoid = await arrangeSessionIdeasPet(h, kit);
            } catch (e) {
                ctx.arrangeError = String(e?.message ?? e);
            }
            return ctx;
        },
        async assert(h, ctx) {
            const steps = [];
            const rec = (step, ok, detail) =>
                steps.push({ step, ok: ok === true, detail: typeof detail === "string" ? detail : JSON.stringify(detail) });
            const wait = (expr, ms = 8000) => kit.polishWaitFor(h, expr, ms);
            // the line, the list and the started lines open and close on a spring: a read or a shot waits for it to land
            const settle = () => kit.polishNap(700);
            const shot = (n) => h.shot(`cdp-shots/sessionideas-pet-${n}.png`);
            const reseed = (opts) => h.rpc("sessionideasseed", sessionIdeasPetSeed(ctx.effortoid, opts));

            const fed = ctx.arrangeError == null && (await feedHolds(h, 3));
            // a press of Discuss or Go through records its launch and opens nothing
            await h.ev(`(() => { globalThis.__waveSessionIdeasLaunch?.setHook(true); globalThis.__waveSessionIdeasLaunch?.clear(); })()`);
            const hookOn = await h.ev(`typeof globalThis.__waveSessionIdeasLaunch?.launches === "function"`);
            rec(
                "0. arranged: fixture mode on, the initiative and its three ideas seeded and read by the feed, the launch hook set",
                ctx.arrangeError == null && Array.isArray(fed) && hookOn === true,
                ctx.arrangeError ?? { fed, hookOn }
            );
            if (!Array.isArray(fed) || hookOn !== true) return steps;

            // 1. the popup: the line and the four chips, under the updates and outside the queue
            const opened = await openPeek(h, kit);
            await wait(`document.querySelector('${LINE}') != null`);
            await settle();
            const line = await textOf(h, LINE);
            const chips = await h.ev(`[...document.querySelectorAll('${PEEK} [data-pet-idea-chip]')].map((c) => ({
                kind: c.getAttribute('data-pet-idea-chip'), text: c.textContent.trim() }))`);
            const queued = await h.ev(`document.querySelector('${PEEK} [data-pet-queue] [data-pet-ideas]') != null`);
            await shot(1);
            rec(
                "1. the popup carries the ideas line and four chips, outside the queue",
                opened === true &&
                    line === "3 ideas from your sessions to review" &&
                    JSON.stringify(chips) ===
                        JSON.stringify([
                            { kind: "waiting", text: "What's waiting?" },
                            { kind: "go-through", text: "Go through 3 with an agent" },
                            { kind: "discuss", text: `Discuss: ${GIST_LEAVING}` },
                            { kind: "leaving", text: "Which lose their transcript soon?" },
                        ]) &&
                    queued === false &&
                    (await h.ev(`document.querySelector('${PEEK} [data-pet-ideas-review]')?.textContent.trim()`)) ===
                        "Review in Jarvis",
                { opened, line, chips, queued }
            );

            // 2. What's waiting? opens the list in place, the soonest-deleted first, and presses shut again
            const pressed2 = await click(h, chip("waiting"));
            await wait(`document.querySelectorAll('${LIST_ROWS}').length === 3`);
            await settle();
            const rows2 = await allTexts(h, LIST_ROWS);
            const on2 = await h.ev(`document.querySelector('${chip("waiting")}')?.getAttribute('aria-pressed')`);
            await shot(2);
            await click(h, chip("waiting"));
            const shut2 = await wait(`document.querySelector('${PEEK} [data-pet-ideas-list]') == null`);
            rec(
                "2. What's waiting? opens the ideas list in place and a second press closes it",
                pressed2 === true &&
                    rows2.length === 3 &&
                    rows2[0].startsWith(GIST_LEAVING) &&
                    rows2[0].includes(`${TITLE}`) &&
                    rows2[0].includes("transcript deleted") &&
                    rows2[2].includes(GIST_NEW) &&
                    rows2[2].includes(`New idea · ${PROJECT}`) &&
                    on2 === "true" &&
                    shut2 === true,
                { rows2, on2, shut2 }
            );

            // 3. Which lose their transcript soon? lists only the idea deleted within 7 days
            await click(h, chip("leaving"));
            await wait(`document.querySelectorAll('${LIST_ROWS}').length === 1`);
            await settle();
            const rows3 = await allTexts(h, LIST_ROWS);
            await shot(3);
            await click(h, chip("leaving"));
            await wait(`document.querySelector('${PEEK} [data-pet-ideas-list]') == null`);
            rec(
                "3. Which lose their transcript soon? lists only the idea whose transcript is deleted within 7 days",
                rows3.length === 1 && rows3[0].startsWith(GIST_LEAVING) && rows3[0].includes("transcript deleted"),
                { rows3 }
            );

            // 4. Go through opens one agent for all three (recorded, none opened), shows its started line, and a second press opens no second
            await click(h, chip("go-through"));
            await wait(`document.querySelector('${started("go-through")}') != null`);
            await settle();
            const line4 = await textOf(h, started("go-through"));
            const go4 = await textOf(h, `${started("go-through")} [data-pet-idea-go]`);
            const rec4 = await launches(h);
            await shot(4);
            await click(h, chip("go-through"));
            await settle();
            const again4 = await launches(h);
            rec(
                "4. Go through shows the started line with Go to agent, opens one agent, and a second press opens none",
                line4 != null &&
                    line4.includes("Session ideas") &&
                    line4.includes("No folder · sonnet · started") &&
                    go4 === "Go to agent" &&
                    rec4?.length === 1 &&
                    rec4[0].kind === "go-through" &&
                    JSON.stringify(rec4[0].ideaIds) === JSON.stringify(["sip-idea-1", "sip-idea-2", "sip-idea-3"]) &&
                    rec4[0].task.split("\n")[0] === "[arc:session-ideas]" &&
                    again4?.length === 1,
                { line4, go4, rec4, again4 }
            );

            // 5. Discuss: <gist> opens an agent in the idea's project and shows its own started line
            await click(h, chip("discuss"));
            await wait(`document.querySelector('${started("discuss")}') != null`);
            await settle();
            const line5 = await textOf(h, started("discuss"));
            const go5 = await textOf(h, `${started("discuss")} [data-pet-idea-go]`);
            const rec5 = await launches(h);
            // the Discuss took that idea's tab, so Go through is no longer one agent holding every idea
            const goThroughLeft = await h.ev(`document.querySelector('${started("go-through")}') == null`);
            await shot(5);
            rec(
                "5. Discuss: <gist> shows its started line with Go to agent, in the idea's project",
                line5 != null &&
                    line5.includes(`Discuss: ${GIST_LEAVING}`) &&
                    line5.includes(`${PROJECT} · sonnet · started`) &&
                    go5 === "Go to agent" &&
                    rec5?.length === 2 &&
                    rec5[1].kind === "discuss" &&
                    JSON.stringify(rec5[1].ideaIds) === JSON.stringify(["sip-idea-1"]) &&
                    rec5[1].projectPath === PROJECT_PATH &&
                    rec5[1].task.split("\n")[0] === "[arc:session-ideas]",
                { line5, go5, rec5, goThroughLeft }
            );

            // 6. typed on the canned route reply, under the route hook: a go-through and a discuss become the ideas action and
            // open nothing; a discuss naming no listed idea is a question back
            const before6 = (await launches(h))?.length ?? -1;
            const hookReady = await wait(`typeof globalThis.__waveJarvisRoute?.finish === "function"`, 5000);
            const goDone = await finishRoute(
                h,
                "duyệt giúp tôi",
                routeReply("Mở một agent sonnet ở No folder để đi qua các ý với bạn.", ideasVerdict({ ideas: "go-through" }))
            );
            const goAction = await h.ev(`globalThis.__waveJarvisRoute.lastAction()`);
            const goErrand = await page(
                h,
                `const S = await mod("app/view/jarvis/petstore.ts"); return globalStore.get(S.petErrandAtom);`
            );
            const peekGone6 = await wait(`document.querySelector('${PEEK}') == null`);
            await openPeek(h, kit);
            const discussDone = await finishRoute(
                h,
                "bàn ý search",
                routeReply("Mở Discuss cho ý đó.", ideasVerdict({ ideas: "discuss", idea: "sip-idea-2", task: "bàn ý search" }))
            );
            const discussAction = await h.ev(`globalThis.__waveJarvisRoute.lastAction()`);
            await openPeek(h, kit);
            const unknownDone = await finishRoute(
                h,
                "bàn ý x",
                routeReply("Mở Discuss cho ý đó.", ideasVerdict({ ideas: "discuss", idea: "sip-idea-404", task: "bàn ý x" }))
            );
            const unknownAction = await h.ev(`globalThis.__waveJarvisRoute.lastAction()`);
            await settle();
            const askedBack = await h.ev(`document.querySelector('${PEEK}')?.innerText.includes("which idea you mean") ?? false`);
            const after6 = (await launches(h))?.length ?? -1;
            await shot(6);
            rec(
                "6. a typed 'duyệt giúp tôi' on a canned route reply records the ideas action and opens no agent; an unknown idea is asked back",
                hookReady === true &&
                    goDone === "ok" &&
                    goAction?.kind === "ideas" &&
                    goAction?.op === "go-through" &&
                    goErrand?.status === "done" &&
                    peekGone6 === true &&
                    discussDone === "ok" &&
                    discussAction?.kind === "ideas" &&
                    discussAction?.op === "discuss" &&
                    discussAction?.ideaId === "sip-idea-2" &&
                    unknownDone === "ok" &&
                    unknownAction == null &&
                    askedBack === true &&
                    after6 === before6,
                { goDone, goAction, goErrand, peekGone6, discussDone, discussAction, unknownDone, unknownAction, askedBack, before6, after6 }
            );
            await closePeek(h);

            // 7. a scan that ends with new ideas toasts: the running scan reaches the atom first, since the feed coalesces re-reads
            const startedts = Date.now() - 90_000;
            const running = (extra = {}) => ({
                done: 1,
                total: 3,
                startedts,
                endedts: 0,
                forced: false,
                error: "",
                stoppedat: 0,
                newideas: 0,
                tokens: 0,
                ...extra,
            });
            await reseed({ scan: running() });
            const sawRunning = await page(
                h,
                `const S = await mod("app/view/jarvis/sessionideasstore.ts");
                 return await until(() => { const s = globalStore.get(S.sessionIdeasAtom)?.scan; return s != null && s.startedts === ${startedts} && s.endedts === 0; }, 10000);`
            );
            await reseed({ scan: running({ done: 3, endedts: startedts + 60_000, newideas: 2, tokens: 4200 }) });
            const toasted = await wait(
                `[...document.querySelectorAll('${TOASTS}')].some((t) => t.textContent.includes("Session scan: 2 ideas to review, from 3 sessions"))`,
                10000
            );
            await settle();
            const toastAction = await textOf(h, "[data-notification-action]");
            await shot(7);
            await click(h, "[data-notification-action]");
            const landed7 = await surfaceIs(h, kit, "Jarvis");
            // the request the region would clear, and the toast's own close, so the next step starts clean
            await clearFocusRequest(h);
            await click(h, "[data-notification-close]");
            rec(
                "7. a scan that ended with 2 new ideas toasts, and the toast's Review opens Jarvis",
                sawRunning === true && toasted === true && toastAction === "Review" && landed7 === true,
                { sawRunning, toasted, toastAction, landed7 }
            );
            await h.goto("agent");

            // 8. the Waiting line: ideas unseen for 8 days are one line in Waiting on you, with Review and Next week; 3 days is none
            await reseed({ foundAgo: 3, seenAgo: 3 });
            const quietLoaded = await reloadAttention(h);
            const quiet8 = await page(
                h,
                `const S = await mod("app/view/agents/attentionstore.ts"); return globalStore.get(S.attentionAtom).filter((i) => i.kind === "session-ideas").length;`
            );
            await reseed({ foundAgo: 8, seenAgo: 8 });
            await feedHolds(h, 3);
            const waitLoaded = await reloadAttention(h);
            await openPeek(h, kit);
            const row8 = await wait(`document.querySelector('${WAITING_ROW}') != null`, 10000);
            await settle();
            const rowText = await textOf(h, WAITING_ROW);
            const review8 = await textOf(h, `${WAITING_ROW} [data-pet-act="session-ideas:open"]`);
            const next8 = await textOf(h, `${WAITING_ROW} [data-pet-act="session-ideas:snooze"]`);
            await shot(8);
            rec(
                "8a. ideas unseen for 8 days are one Ideas line with Review and Next week; at 3 days there is none",
                quietLoaded === true &&
                    quiet8 === 0 &&
                    waitLoaded === true &&
                    row8 === true &&
                    rowText != null &&
                    rowText.includes("Ideas") &&
                    rowText.includes("3 ideas from your sessions, waiting 8 days") &&
                    review8 === "Review" &&
                    next8 === "Next week",
                { quietLoaded, quiet8, waitLoaded, row8, rowText, review8, next8 }
            );

            // Review lands on Jarvis (the Brief's region reads the focus request)
            await click(h, `${WAITING_ROW} [data-pet-act="session-ideas:open"]`);
            const landed8 = await surfaceIs(h, kit, "Jarvis");
            const peekGone8 = await wait(`document.querySelector('${PEEK}') == null`);
            // the Brief's region clears the request once it has scrolled, so a set flag here only means no region was there to
            const focused8 = await page(
                h,
                `const S = await mod("app/view/jarvis/sessionideasstore.ts"); return globalStore.get(S.sessionIdeasFocusAtom);`
            );
            await clearFocusRequest(h);
            rec(
                "8b. Review on the Ideas line opens Jarvis on the From your sessions region and leaves the popup",
                landed8 === true && peekGone8 === true,
                { landed8, peekGone8, focusRequestStillSet: focused8 }
            );

            // Next week: the line leaves and wavesrv holds it off for 7 days. Opening the region marks the ideas seen, so the line is
            // seeded again first.
            await h.goto("agent");
            await reseed({ foundAgo: 8, seenAgo: 8 });
            await feedHolds(h, 3);
            await reloadAttention(h);
            await openPeek(h, kit);
            await wait(`document.querySelector('${WAITING_ROW}') != null`, 10000);
            const t0 = Date.now();
            await click(h, `${WAITING_ROW} [data-pet-act="session-ideas:snooze"]`);
            const left9 = await wait(`document.querySelector('${WAITING_ROW}') == null`, 10000);
            const stored = await h.rpc("sessionideasget", null);
            const snoozed = stored?.snoozeduntil ?? 0;
            rec(
                "9. Next week drops the line and wavesrv holds it off for 7 days",
                left9 === true && snoozed >= t0 + 7 * DAY - 60_000 && snoozed <= Date.now() + 7 * DAY + 60_000,
                { left9, snoozed, t0 }
            );
            await closePeek(h);
            return steps;
        },
        async teardown(h) {
            await teardownSessionIdeasPet(h, kit);
        },
    };
    return [sessionIdeasPet];
}

// the attention list read again now, not on the next poll; true once an answer has come back
const reloadAttention = (h) =>
    page(
        h,
        `const S = await mod("app/view/agents/attentionstore.ts"); await S.loadAttention(); return true;`
    );

// true once the nav shows `label` selected (h.activeSurfaceLabel reads it), false past 8 s
async function surfaceIs(h, kit, label) {
    for (let waited = 0; waited < 8000; waited += 250) {
        if ((await h.activeSurfaceLabel().catch(() => null)) === label) return true;
        await kit.polishNap(250);
    }
    return false;
}

// the request that the Brief scroll to its region (sessionIdeasFocusAtom): a Brief that mounted would have cleared it, and one
// that did not would leave it set for the next step
const clearFocusRequest = (h) =>
    page(
        h,
        `const S = await mod("app/view/jarvis/sessionideasstore.ts"); globalStore.set(S.sessionIdeasFocusAtom, false); return true;`
    );
