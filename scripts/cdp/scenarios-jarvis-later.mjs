// jarvis-brief-later: the Brief's For later region (docs/superpowers/specs/2026-11-13-jarvis-later-design.md). Marks are
// written to the workspace's `session:later` as the row menus write them; the sessions they name are injected into the
// page's by-id lookup (sessionsarchivestore.ts sessionLookupAtom), as the Agent fixtures inject a roster, so nothing is
// written into ~/.claude/projects: one ended session, one live (its agent on a mock roster), one mark with no session.
// The steps read the rows before the lookup answers, the three kinds of row, Done and its Undo, the "+N more" window,
// a click on an ended row, and the empty region. Teardown puts the workspace's own marks and roster back.
// kit is scenarios.mjs's JARVIS_KIT.

import { agentPage, restoreRoster, setRoster } from "./agent-page-fixtures.mjs";

const DAY = 86_400_000;
const ENDED = "jbl-ended-0000-4000-8000-000000000001";
const LIVE = "jbl-live-00000-4000-8000-000000000002";
const GONE = "jbl-gone-00000-4000-8000-000000000003";
const EXTRA = [4, 5, 6, 7, 8].map((n) => `jbl-extra-0000-4000-8000-00000000000${n}`);
const LIVE_TAB = "jbl-live-tab";
const ENDED_TITLE = "JBL ended: tidy the release notes";
const LIVE_TITLE = "JBL live: wire the Done button";
const PROJECT = "jbl-project";

const transcript = (id) => `C:\\arc-verify-jbl\\projects\\jbl\\${id}.jsonl`;
const session = (id, task, over = {}) => ({
    id,
    runtime: "claude",
    projectpath: "C:\\arc-verify-jbl\\project",
    projectname: PROJECT,
    branch: "main",
    task,
    model: "opus",
    tokenstotal: 0,
    lastactivets: Date.now() - 2 * DAY,
    resumecommand: `claude --resume ${id}`,
    transcriptpath: transcript(id),
    status: "done",
    startedts: Date.now() - 3 * DAY,
    durationms: 60_000,
    events: [],
    ...over,
});
const SESSIONS = [session(ENDED, ENDED_TITLE), session(LIVE, LIVE_TITLE, { lastactivets: Date.now() })];

const nap = (ms) => new Promise((r) => setTimeout(r, ms));

// the region as drawn: each row's state, title, detail, age and buttons, the empty sentence, the more control
const readRegion = (h) =>
    h.ev(`(() => {
        const region = document.querySelector('[data-jarvis-brief-region="later"]');
        if (!region) return null;
        const flat = (el) => (el?.textContent ?? '').replace(/\\s+/g, ' ').trim();
        return {
            rows: [...region.querySelectorAll('[data-jarvis-brief-row="later"]')].map((r) => {
                const spans = r.querySelectorAll(':scope > div > span');
                return {
                    state: r.dataset.jarvisLaterState,
                    title: flat(spans[0]),
                    detail: flat(spans[1]),
                    resume: !!r.querySelector('[data-jarvis-later-resume]'),
                    done: !!r.querySelector('[data-jarvis-later-done]'),
                    age: flat(r.lastElementChild),
                };
            }),
            empty: flat(region.querySelector('[data-jarvis-brief-empty="later"]')) || null,
            more: flat(region.querySelector('[data-jarvis-brief-later-more]')) || null,
            lastInSide: document.querySelector('[data-jarvis-brief-side]')?.contains(region) === true,
        };
    })()`);

async function waitRegion(h, ok, ms = 8000) {
    let last = null;
    for (let waited = 0; waited < ms; waited += 200) {
        last = await readRegion(h).catch(() => null);
        if (last != null && ok(last)) return last;
        await nap(200);
    }
    return last;
}

// the workspace's oid and its marks as the page holds them
const readMarks = (h) =>
    agentPage(
        h,
        `const { atoms } = await mod("app/store/global-atoms.ts");
        const ws = globalStore.get(atoms.workspace);
        return { oid: ws?.oid ?? null, marks: ws?.meta?.["session:later"] ?? null };`
    );

const writeMarks = (h, oid, marks) => h.rpc("setmeta", { oref: `workspace:${oid}`, meta: { "session:later": marks } });

// The Brief looks the marks up on its own when they change; once that lookup has answered for `ids`, its answer is
// replaced with the fixture sessions. `sessions` null leaves the lookup unanswered: the rows still loading.
const injectLookup = (h, ids, sessions) =>
    agentPage(
        h,
        `const S = await mod("app/view/agents/sessionsarchivestore.ts");
        const want = ${JSON.stringify([...ids].sort())};
        await until(() => JSON.stringify([...globalStore.get(S.sessionLookupAtom).ids].sort()) === JSON.stringify(want), 8000);
        const sessions = ${JSON.stringify(sessions)};
        globalStore.set(S.sessionLookupAtom, sessions == null ? { ids: [], sessions: [] } : { ids: want, sessions });
        return true;`
    );

const sideToRegion = (h) =>
    h.ev(`document.querySelector('[data-jarvis-brief-region="later"]')?.scrollIntoView({ block: 'center' })`);

export default function (kit) {
    const { briefNap, briefViewport } = kit;

    const jarvisBriefLater = {
        name: "jarvis-brief-later",
        surface: "jarvis",
        async arrange(h) {
            const ctx = {};
            try {
                const { oid, marks } = await readMarks(h);
                if (oid == null) throw new Error("no workspace in the page");
                ctx.oid = oid;
                ctx.prevMarks = marks;
                await setRoster(h, [
                    {
                        id: LIVE_TAB,
                        name: "jbl live agent",
                        project: PROJECT,
                        task: LIVE_TITLE,
                        state: "idle",
                        agent: "claude",
                        model: "opus",
                        transcriptPath: transcript(LIVE),
                    },
                ]);
                ctx.roster = true;
                await briefViewport(h, 1600, 1000);
            } catch (e) {
                ctx.arrangeError = String(e?.message ?? e);
            }
            return ctx;
        },
        async assert(h, ctx) {
            const steps = [];
            const rec = (step, ok, detail) => steps.push({ step, ok, detail });
            if (ctx.arrangeError != null) {
                rec("0. the workspace and the mock roster are ready", false, ctx.arrangeError);
                return steps;
            }
            const now = Date.now();
            const marks = { [ENDED]: now - 3 * DAY, [LIVE]: now - DAY, [GONE]: now - 30 * DAY };
            const ids = Object.keys(marks);
            await h.goto("jarvis");
            // a freshly booted app draws the Brief's skeleton until its first briefing lands: no side column yet
            for (let waited = 0; waited < 60_000; waited += 300) {
                if (await h.ev(`!!document.querySelector('[data-jarvis-brief-side]')`).catch(() => false)) break;
                await nap(300);
            }
            await writeMarks(h, ctx.oid, marks);

            // 1. before the lookup answers: every mark is a row, named by its short id, dim, never "(session not found)"
            await injectLookup(h, ids, null);
            const looking = await waitRegion(h, (r) => r.rows.length === 3);
            await sideToRegion(h);
            await briefNap(200);
            await h.shot("cdp-shots/jarvis-brief-later-looking.png");
            rec(
                "1. lookup not answered: three rows by short id, none reading not found",
                looking != null &&
                    looking.rows.length === 3 &&
                    looking.rows.every((r) => r.state === "looking" && r.title.length === 8) &&
                    !looking.rows.some((r) => r.title === "(session not found)"),
                JSON.stringify(looking)
            );

            // 2. answered: newest mark first; the live one says live, the ended one offers Resume, the gone one is named
            //    "(session not found)" with Done and no Resume; the region is in the side column, after Ideas
            await injectLookup(h, ids, SESSIONS);
            const found = await waitRegion(h, (r) => r.rows.length === 3 && r.rows[0].state !== "looking");
            await sideToRegion(h);
            await briefNap(200);
            await h.shot("cdp-shots/jarvis-brief-later-rows.png");
            const want = [
                { state: "live", title: LIVE_TITLE, resume: false, age: "1d" },
                { state: "found", title: ENDED_TITLE, resume: true, age: "3d" },
                { state: "missing", title: "(session not found)", resume: false, age: "30d" },
            ];
            const order = await h.ev(`(() => {
                const side = document.querySelector('[data-jarvis-brief-side]');
                const ideas = side?.querySelector('[data-jarvis-ideas]');
                const later = side?.querySelector('[data-jarvis-brief-region="later"]');
                return ideas == null || later == null ? null : !!(ideas.compareDocumentPosition(later) & Node.DOCUMENT_POSITION_FOLLOWING);
            })()`);
            rec(
                "2. rows newest mark first: live, ended with Resume, not found with Done only; after Ideas in the side column",
                found != null &&
                    found.rows.length === 3 &&
                    want.every(
                        (w, i) =>
                            found.rows[i].state === w.state &&
                            found.rows[i].title === w.title &&
                            found.rows[i].resume === w.resume &&
                            found.rows[i].age === w.age &&
                            found.rows[i].done === true
                    ) &&
                    found.rows[0].detail === `${PROJECT} · live` &&
                    found.rows[1].detail === PROJECT &&
                    found.lastInSide === true &&
                    order === true,
                JSON.stringify({ found, order })
            );

            // 3. Done hides the row at once with an Undo toast, and Undo brings it back with the mark left as it was
            await h.ev(`[...document.querySelectorAll('[data-jarvis-brief-row="later"]')].find((r) => r.dataset.jarvisLaterState === 'missing')?.querySelector('[data-jarvis-later-done]')?.click()`);
            const hidden = await waitRegion(h, (r) => r.rows.length === 2, 3000);
            const toast = await h.ev(`!!document.querySelector('[data-jarvis-toast-undo]')`);
            await h.shot("cdp-shots/jarvis-brief-later-done.png");
            await h.ev(`document.querySelector('[data-jarvis-toast-undo]')?.click()`);
            const back = await waitRegion(h, (r) => r.rows.length === 3, 3000);
            await briefNap(5500); // past the undo window: an undone Done never writes
            const after = await readMarks(h);
            rec(
                "3. Done hides the row with Undo; Undo brings it back and the mark keeps its time",
                hidden?.rows.length === 2 &&
                    toast === true &&
                    back?.rows.length === 3 &&
                    after.marks?.[GONE] === marks[GONE],
                JSON.stringify({ hidden: hidden?.rows.length, toast, back: back?.rows.length, gone: after.marks?.[GONE] })
            );

            // 4. Done left alone clears the mark when the window closes
            await h.ev(`[...document.querySelectorAll('[data-jarvis-brief-row="later"]')].find((r) => r.dataset.jarvisLaterState === 'missing')?.querySelector('[data-jarvis-later-done]')?.click()`);
            await briefNap(5800);
            const cleared = await readMarks(h);
            rec(
                "4. Done clears the mark once the undo window closes",
                cleared.marks != null && !(GONE in cleared.marks) && ENDED in cleared.marks,
                JSON.stringify(cleared.marks)
            );

            // 5. seven marks: five rows and "+2 more", which opens the rest in place
            const many = { [ENDED]: now - 3 * DAY, [LIVE]: now - DAY };
            EXTRA.forEach((id, i) => (many[id] = now - (10 + i) * DAY));
            await writeMarks(h, ctx.oid, many);
            await injectLookup(h, Object.keys(many), SESSIONS);
            const windowed = await waitRegion(h, (r) => r.rows.length === 5 && r.more != null);
            await sideToRegion(h);
            await briefNap(200);
            await h.shot("cdp-shots/jarvis-brief-later-more.png");
            await h.ev(`document.querySelector('[data-jarvis-brief-later-more]')?.click()`);
            const opened = await waitRegion(h, (r) => r.rows.length === 7, 3000);
            rec(
                "5. seven marks: five rows and +2 more, which opens all seven in place",
                windowed?.rows.length === 5 && windowed?.more === "+2 more" && opened?.rows.length === 7,
                JSON.stringify({ windowed: windowed?.rows.length, more: windowed?.more, opened: opened?.rows.length })
            );
            await h.ev(`document.querySelector('[data-jarvis-brief-later-more]')?.click()`);

            // 6. a click on the ended row opens its transcript on Agent, no agent started
            await h.ev(`[...document.querySelectorAll('[data-jarvis-brief-row="later"]')].find((r) => r.dataset.jarvisLaterState === 'found')?.click()`);
            await briefNap(800);
            const opened6 = await agentPage(
                h,
                `const C = await mod("app/view/agents/agentcenter.ts");
                const pane = document.querySelector('[data-agent-session]');
                return {
                    mode: globalStore.get(C.centerModeAtom),
                    pane: !!pane,
                    notInArchive: (pane?.textContent ?? '').includes('not in the archive'),
                    title: (pane?.textContent ?? '').includes(${JSON.stringify(ENDED_TITLE)}),
                };`
            );
            await h.shot("cdp-shots/jarvis-brief-later-open.png");
            rec(
                "6. a click on an ended row opens its transcript on Agent",
                opened6?.mode === "session" && opened6.pane === true && opened6.notInArchive === false && opened6.title === true,
                JSON.stringify(opened6)
            );

            // 7. no marks: the region says so instead of an empty frame
            await h.goto("jarvis");
            await writeMarks(h, ctx.oid, null);
            const empty = await waitRegion(h, (r) => r.rows.length === 0 && r.empty != null);
            await sideToRegion(h);
            await briefNap(200);
            await h.shot("cdp-shots/jarvis-brief-later-empty.png");
            rec(
                "7. no marks: Nothing marked for later.",
                empty?.empty === "Nothing marked for later." && empty.rows.length === 0,
                JSON.stringify(empty)
            );
            return steps;
        },
        async teardown(h, ctx) {
            if (ctx.oid != null) {
                await writeMarks(h, ctx.oid, ctx.prevMarks ?? null).catch(() => {});
            }
            if (ctx.roster) {
                await restoreRoster(h).catch(() => {});
            }
            await h.cdp("Emulation.clearDeviceMetricsOverride").catch(() => {});
            await h.goto("cockpit");
        },
    };

    return [jarvisBriefLater];
}
