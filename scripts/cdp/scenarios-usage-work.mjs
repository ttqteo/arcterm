// usage-work: the Usage surface's finer attribution: a session's task, chunk, effort, lead and project, and the pricing,
// window, forecast and colour models (docs/superpowers/plans/2026-11-12-kael-sync-code-diff-usage-setup.md, Task 14; the fork's
// 17759a7cd, 7bf83577a, 75c5a9c0b, 4e2c45b83, 9444377ac, b71bbd99c, e636caf9c, 8904b6f4d, dce4a7900, bd5863c89 and 8846762ec,
// and its scenarios-usage.mjs). One scenario, `usage-work`.
//
// It runs on a seeded {buckets, sessions, efforts} usage fixture (the dev-only localStorage seam usagestore.ts reads) and a
// seeded Claude quota snapshot, so no transcript is scanned. Ours has no scope-card provider rail: the provider page is the
// tabs and the Live limits section, and a provider's quota is on its tab already, so the steps check that those are still
// where they were (and that the forecast beside them reads the fixed 28-day history) beside the By work page this task adds.
// No step presses a key: Escape's Back and the cursor keys are Task 16's bindings (scenario `kael-keys`).
//
// kit is scenarios.mjs's KAEL_KITS ({ rt, code, files, jarvis }); the page-side helpers and the fixture are here.

const FIXTURE_KEY = "wave:dev-usage-buckets";
const RATE_KEY = "wave:ratelimits";

// paths use forward slashes and an upper-case drive letter, the form the surface normalises a project to, so
// data-usage-project equals what was seeded
const ARC = "C:/work/arc";
const SIEM = "C:/work/siem";
const ARC_NAME = "Arc";
// names no stored run or channel: Open run reaches the router
const RUN = "fx-usage-run";
const CHANNEL = "fx-usage-channel";
const RUN_ITEM = `run:${RUN}`;
const LEAD_ITEM = "session:claude:fx-arc-3";
const PI_ITEM = "session:pi:fx-pi-local";
const EFFORT = "fx-effort-usage-review";
const EFFORT_SCOPE = `effort:${EFFORT}`;
const EFFORT_TITLE = "Usage review";
const CHUNK = "Chunk 2: wire fields";
const GOAL = "Usage attribution fixture run";
const TASKS = { "t-1": "Wire types", "t-2": "By work lens" };
const OPUS = "claude-opus-5-5";
const SONNET = "claude-sonnet-5-5";
const PAGE_ROWS = 34;
const COLLAPSED = 8;
const PAGE_STEP = 25;
const WEEK_COLUMNS = 7;
// the quota snapshot: 97% of the week used with two days left, so the day-of-week pace crosses 100% before the reset
// whatever the fixture's own shape of days is
const WEEK_PCT = 97;

// a local day key n days back, as the fixture's buckets are keyed
const dayAgo = (n) => {
    const d = new Date();
    d.setHours(12, 0, 0, 0);
    d.setDate(d.getDate() - n);
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
};

// Twelve kinds of work. arc: an orchestrator run of four sessions (lead, two task workers, a reviewer; chunk-titled, one worker
// tagged with the initiative), a quick run, three sessions no run started (one of them a brainstorm lead with a judge folded in)
// and an unpriced pi session. siem: 34 small sessions (two tagged with the initiative), all active on two days. And one session
// with no project, ten days back, which gives the weekly forecast its history without touching a project's chart.
function buildFixture() {
    const buckets = [];
    const sessions = [];
    // one unit is 117,000 tokens
    const add = (session, model, units, meta, day = 1) => {
        buckets.push({
            harness: "claude",
            provider: "anthropic",
            model,
            session,
            day: dayAgo(day),
            input: 10_000 * units,
            output: 2_000 * units,
            reasoning: 0,
            cacheread: 100_000 * units,
            cachecreate: 5_000 * units,
            cachecreate1h: 0,
            msgs: units,
        });
        if (meta != null) sessions.push({ harness: "claude", session, ...meta });
    };
    const inRun = (role, taskid, extra = {}) => ({
        project: ARC,
        projectname: ARC_NAME,
        runid: RUN,
        channelid: CHANNEL,
        rungoal: `${GOAL}\n\nA goal paragraph the row must not show.`,
        runmode: "orchestrator",
        runchunk: CHUNK,
        role,
        ...(taskid ? { taskid, tasktitle: TASKS[taskid] } : {}),
        ...extra,
    });
    const arc = (title, extra = {}) => ({ title, project: ARC, projectname: ARC_NAME, ...extra });

    add("fx-run-lead", OPUS, 40, { title: "Lead session", ...inRun("lead") });
    add("fx-run-worker-1", SONNET, 40, {
        title: "Add six fields to a struct",
        ...inRun("worker", "t-1", { effort: EFFORT }),
    });
    add("fx-run-worker-2", SONNET, 30, { title: "Render a lens", ...inRun("worker", "t-2") });
    add("fx-run-reviewer", OPUS, 8, { title: "Check the struct", ...inRun("reviewer", "t-1") });
    add("fx-quick", OPUS, 16, {
        ...arc("Quick fix session"),
        runid: "fx-usage-quick",
        rungoal: "Fix the rail's truncated label",
        runmode: "quick",
    });
    add("fx-arc-1", OPUS, 12, arc("Trace the usage scan"));
    add("fx-arc-2", SONNET, 20, arc("Rename the bucket key"));
    add("fx-arc-3", OPUS, 6, arc("Read the price table"));
    // a brainstorm judge started for fx-arc-3: no run of its own, it folds into its lead's session item
    add("fx-judge", SONNET, 3, {
        ...arc("Judge the price table brainstorm"),
        role: "judge",
        leadharness: "claude",
        leadsession: "fx-arc-3",
    });
    for (let i = 0; i < PAGE_ROWS; i++) {
        const id = String(i).padStart(2, "0");
        // small, so siem stays below Arc in the scope bar; falling sizes rank the rows in fixture order
        add(
            `fx-page-${id}`,
            SONNET,
            Math.max(1, Math.round((PAGE_ROWS - i) / 8)),
            {
                title: `Paged session ${i + 1} with a title long enough to be cut`,
                project: SIEM,
                ...(i < 2 ? { effort: EFFORT } : {}),
            },
            1 + (i % 2)
        );
    }
    // the history the forecast reads: Claude tokens on ten more days, in a session no project holds
    for (let d = 3; d <= 12; d++) add(`fx-history-${d}`, SONNET, 2 + (d % 4) * 3, { title: `History ${d}` }, d);
    // an unpriced model that reports no cost: its row and its card read "unpriced"
    buckets.push({
        harness: "pi",
        provider: "fx-local",
        model: "unpriced-test-model",
        session: "fx-pi-local",
        day: dayAgo(1),
        input: 900_000,
        output: 100_000,
        reasoning: 0,
        cacheread: 0,
        cachecreate: 0,
        cachecreate1h: 0,
        msgs: 6,
    });
    sessions.push({ harness: "pi", session: "fx-pi-local", title: "Local model spike", project: ARC, projectname: ARC_NAME });
    return { buckets, sessions, efforts: [{ oid: EFFORT, title: EFFORT_TITLE }] };
}

const rateLimits = () => {
    const nowSec = Math.floor(Date.now() / 1000);
    return {
        "claude:default": {
            fivehourpct: 62,
            fivehourreset: nowSec + 3 * 3600,
            weekpct: WEEK_PCT,
            weekreset: nowSec + 2 * 24 * 3600,
            // an hour ahead: the app also reads the real Claude login's quota once it loads, and a reading takes a window only
            // when it is newer, so the seeded one stands
            capturedAt: Date.now() + 3600_000,
        },
    };
};

const restore = (key, prev) =>
    prev == null ? `localStorage.removeItem(${JSON.stringify(key)})` : `localStorage.setItem(${JSON.stringify(key)}, ${JSON.stringify(prev)})`;

// page-side helpers: every query is scoped to the surface's own data-* containers
const LIB = `
    const text = (el) => (el?.textContent || "").replace(/\\s+/g, " ").trim();
    const detail = () => document.querySelector("[data-usage-detail]");
    const groupButton = (group, label) =>
        [...document.querySelectorAll('[aria-label="' + group + '"] button')].find((b) => text(b) === label) ?? null;
    const pressedIn = (group) =>
        text(document.querySelector('[aria-label="' + group + '"] button[aria-pressed="true"]')) || null;
    // the provider page's own 7 days / All time control has no group label: it is found by its text
    const rangeButton = (label) =>
        document.querySelector('[aria-label="Range"]') != null
            ? groupButton("Range", label)
            : [...document.querySelectorAll("button")].find((b) => text(b) === label && b.closest("[data-usage-detail]") == null) ?? null;
    const press = (el) => {
        if (!el) return false;
        el.click();
        return true;
    };
    const until = async (ok, ms = 10000) => {
        for (let waited = 0; waited < ms && !ok(); waited += 100) {
            await new Promise((r) => setTimeout(r, 100));
        }
        return !!ok();
    };
    // a stat card is label, value, then an optional sub line
    const card = (label) =>
        [...(detail()?.querySelectorAll("[data-usage-stats] > div") ?? [])].find((c) => text(c.children[0]).startsWith(label)) ?? null;
    const snapshot = () => {
        const d = detail();
        const list = d?.querySelector("[data-usage-list]");
        const rows = [...(list?.querySelectorAll("[data-usage-item]") ?? [])];
        return {
            scope: d?.getAttribute("data-usage-detail") ?? null,
            lens: pressedIn("Lens"),
            title: text(d?.querySelector("[data-usage-head] h2")),
            meta: text(d?.querySelector("[data-usage-head]")),
            list: list
                ? {
                      title: text(list.querySelector("h3")),
                      meta: text(list.querySelector("h3")?.parentElement),
                      rows: rows.map((r) => r.getAttribute("data-usage-item")),
                      rowText: rows.map(text),
                      more: text(list.querySelector("[data-usage-more]")) || null,
                      less: text(list.querySelector("[data-usage-less]")) || null,
                  }
                : null,
            split: [...(d?.querySelectorAll("[data-usage-split] [data-usage-split-row]") ?? [])].map(text),
            back: text(d?.querySelector("[data-usage-back]")) || null,
            openRun: text(d?.querySelector("[data-usage-open-run]")) || null,
            dailyDays: Number(d?.querySelector("[data-usage-daily]")?.getAttribute("data-usage-daily-days") ?? NaN),
            switchFailed: d?.querySelector("[data-usage-switch-failed]") != null,
            projects: [...document.querySelectorAll("[data-usage-scopes] [data-usage-project]")].map((b) => ({
                key: b.getAttribute("data-usage-project"),
                pressed: b.getAttribute("aria-pressed") === "true",
                text: text(b),
            })),
            initiatives: [...document.querySelectorAll("[data-usage-scopes] [data-usage-initiative]")].map((b) => ({
                key: b.getAttribute("data-usage-initiative"),
                pressed: b.getAttribute("aria-pressed") === "true",
                text: text(b),
            })),
            figures: [...document.querySelectorAll("[data-usage-scopes] [data-usage-figures]")].map(text),
            window: pressedIn("Range"),
        };
    };
`;

// Runs `act` (an expression that is true once it clicked what it was after), waits for `ready` (an expression over
// the snapshot `s`), and returns the page as it then stands.
const view = (h, act, ready) =>
    h.ev(`(async () => {
        ${LIB}
        const clicked = ${act};
        const settled = await until(() => {
            const s = snapshot();
            return ${ready};
        });
        return { clicked, settled, ...snapshot() };
    })()`);
const click = (selector) => `press(document.querySelector(${JSON.stringify(selector)}))`;
const atScope = (scope) => `s.scope === ${JSON.stringify(scope)} && !s.switchFailed`;

export default function (kits) {
    const scenario = {
        name: "usage-work",
        surface: "usage",
        async arrange(h) {
            const ctx = {
                prevUsage: await h.ev(`localStorage.getItem(${JSON.stringify(FIXTURE_KEY)})`),
                prevRate: await h.ev(`localStorage.getItem(${JSON.stringify(RATE_KEY)})`),
                fixture: JSON.stringify(buildFixture()),
            };
            await h.ev(`localStorage.setItem(${JSON.stringify(FIXTURE_KEY)}, ${JSON.stringify(ctx.fixture)})`);
            await h.ev(`localStorage.setItem(${JSON.stringify(RATE_KEY)}, ${JSON.stringify(JSON.stringify(rateLimits()))})`);
            // the lens, window and selection atoms are module state, and the quota snapshot is read when the module loads: a reload
            // starts them at By provider, 7 days, with the snapshot in
            await h.ev("location.reload()");
            await h.ev(`(async () => {
                for (let i = 0; i < 60 && !document.querySelector("nav button"); i++) {
                    await new Promise((r) => setTimeout(r, 500));
                }
            })()`);
            return ctx;
        },
        async assert(h, ctx) {
            const steps = [];
            const rec = (step, ok, detail) => steps.push({ step, ok: !!ok, detail });
            const shot = (name) => h.shot(`cdp-shots/usage-work-${name}.png`);
            const scrollTo = (selector) =>
                h.ev(`(async () => {
                    document.querySelector(${JSON.stringify(selector)})?.scrollIntoView({ block: "start" });
                    await new Promise((r) => setTimeout(r, 300));
                })()`);
            const scrollTop = () => h.ev(`document.querySelector("[data-usage-detail]")?.scrollTo(0, 0)`);
            const lensWork = `press(groupButton("Lens", "By work"))`;
            const openAll = () => view(h, click('[data-usage-scopes] [data-usage-harness="all"]'), `${atScope("all")} && s.list != null`);
            const openArc = () => view(h, click(`[data-usage-project="${ARC}"]`), `${atScope(`project:${ARC}`)} && s.list != null`);
            const openItem = (key) => view(h, click(`[data-usage-item="${key}"]`), atScope(key));
            const goBack = (scope) => view(h, click("[data-usage-detail] [data-usage-back]"), `${atScope(scope)} && s.list != null`);

            // 0. By provider is today's page: the lens switch leads with it, Live limits and the range filter are in place,
            // and a provider's quota is on its tab
            const loaded = await view(h, "true", `s.lens === "By provider" && !!document.querySelector('[role="tablist"][aria-label="Provider"]')`);
            const provider = await h.ev(`(() => {
                ${LIB}
                const labels = [...document.querySelectorAll('[aria-label="Lens"] button')].map(text);
                const d = detail();
                const tab = document.querySelector('[role="tab"][data-usage-harness="claude"]');
                return {
                    labels,
                    // the section label is drawn uppercase, and textContent returns it as written
                    liveLimits: /live limits/i.test(d?.innerText ?? ""),
                    historical: /historical/i.test(d?.innerText ?? ""),
                    tablist: document.querySelector('[role="tablist"][aria-label="Provider"]') != null,
                    ranges: ["7 days", "All time"].map((l) => rangeButton(l) != null),
                    tab: text(tab),
                    tabSelected: tab?.getAttribute("aria-selected") ?? null,
                };
            })()`);
            rec(
                "0. By provider is as it was: the lens switch leads with it, Live limits, Historical, the provider tabs and the 7 days / All time filter are in place, and Claude's quota reads on its tab",
                loaded.settled &&
                    JSON.stringify(provider.labels) === JSON.stringify(["By provider", "By work", "Workflow"]) &&
                    provider.liveLimits &&
                    provider.historical &&
                    provider.tablist &&
                    provider.ranges.every(Boolean) &&
                    /5h \d+%/.test(provider.tab) &&
                    /wk \d+%/.test(provider.tab),
                JSON.stringify(provider)
            );

            // 0b. the Claude projection reads the fixed 28-day history, so it is the same under either range
            const forecast = await h.ev(`(async () => {
                ${LIB}
                const read = () => text(detail()?.querySelector('[data-usage-limit="week"]')).match(/~100% by [A-Za-z]{3} \\d+[ap]m/)?.[0] ?? null;
                await until(() => read() != null);
                const week = read();
                press(rangeButton("All time"));
                await until(() => detail() != null && document.querySelector("[data-usage-detail] [data-usage-limit]") != null);
                await new Promise((r) => setTimeout(r, 800));
                const allTime = read();
                press(rangeButton("7 days"));
                await until(() => detail() != null && read() != null);
                return { week, allTime };
            })()`);
            await shot("provider");
            rec(
                "0b. the Claude weekly projection (forecast) shows, and reads the same under 7 days and All time",
                forecast.week != null && forecast.week === forecast.allTime,
                JSON.stringify(forecast)
            );

            // 1. By work: the scope bar and All usage's list
            const all = await view(h, lensWork, `s.lens === "By work" && s.list != null`);
            rec(
                "1a. By work opens on All usage: Spent on, the Arc and siem project cards each with a share pill, and the Usage review initiative card",
                all.settled &&
                    all.scope === "all" &&
                    all.list?.title === "Spent on" &&
                    JSON.stringify(all.projects.map((p) => p.key)) === JSON.stringify([ARC, SIEM]) &&
                    all.projects.every((p) => /\d+%/.test(p.text)) &&
                    all.projects[0].text.startsWith(ARC_NAME) &&
                    all.initiatives.length === 1 &&
                    all.initiatives[0].key === EFFORT &&
                    all.initiatives[0].text.startsWith(EFFORT_TITLE),
                JSON.stringify({ scope: all.scope, list: all.list?.title, projects: all.projects, initiatives: all.initiatives })
            );
            rec(
                "1b. the lens switch is on By work, the range filter is still beside it, and All usage splits by project",
                all.lens === "By work" &&
                    all.window === "7 days" &&
                    all.split.length >= 2 &&
                    all.split.some((r) => r.startsWith(ARC_NAME)) &&
                    all.split.some((r) => r.startsWith("siem")),
                JSON.stringify({ lens: all.lens, window: all.window, split: all.split })
            );
            await shot("all");

            // 2. paging: eight rows, then 25 more per press, then the rest; Show top 8 collapses it
            const more = click("[data-usage-detail] [data-usage-more]");
            const less = click("[data-usage-detail] [data-usage-less]");
            const step1 = await view(h, more, `(s.list?.rows.length ?? 0) > ${COLLAPSED}`);
            // the second press is only there while rows remain past the first page
            const left = Number((step1.list?.more ?? "").match(/\d+/)?.[0] ?? NaN);
            const step2 = await view(h, more, `(s.list?.rows.length ?? 0) > ${COLLAPSED + PAGE_STEP}`);
            const collapsed = await view(h, less, `s.list?.rows.length === ${COLLAPSED}`);
            rec(
                "2. Show more pages the list: eight rows, 25 more, then the last few; Show top 8 collapses it",
                all.list?.rows.length === COLLAPSED &&
                    all.list.more === `Show ${PAGE_STEP} more` &&
                    all.list.less == null &&
                    step1.settled &&
                    step1.list.rows.length === COLLAPSED + PAGE_STEP &&
                    /^Show the last \d+$/.test(step1.list.more ?? "") &&
                    step1.list.less === `Show top ${COLLAPSED}` &&
                    step2.settled &&
                    step2.list.rows.length === COLLAPSED + PAGE_STEP + left &&
                    step2.list.more == null &&
                    step2.list.less === `Show top ${COLLAPSED}` &&
                    collapsed.settled &&
                    collapsed.list.more === `Show ${PAGE_STEP} more`,
                JSON.stringify({
                    first: [all.list?.rows.length, all.list?.more, all.list?.less],
                    step1: [step1.list?.rows.length, step1.list?.more, step1.list?.less],
                    step2: [step2.list?.rows.length, step2.list?.more, step2.list?.less],
                    collapsed: collapsed.list?.rows.length,
                })
            );

            // 3. an initiative card opens its scope
            const initiative = await view(
                h,
                click(`[data-usage-initiative="${EFFORT}"]`),
                `${atScope(EFFORT_SCOPE)} && s.list != null`
            );
            rec(
                "3. the Usage review initiative card opens its scope: its runs and sessions across projects, saying only open tabs' sessions count, split by kind",
                initiative.settled &&
                    initiative.title === EFFORT_TITLE &&
                    initiative.initiatives.some((i) => i.key === EFFORT && i.pressed) &&
                    initiative.list?.title === "Runs and sessions" &&
                    initiative.list.rows.length === 3 &&
                    initiative.list.rows.includes(RUN_ITEM) &&
                    /from open tabs/.test(initiative.list.meta) &&
                    initiative.list.rowText.some((t) => t.includes(ARC_NAME)) &&
                    initiative.list.rowText.some((t) => t.includes("siem")) &&
                    initiative.split.some((r) => /Orchestrator runs/.test(r)) &&
                    initiative.split.some((r) => /Sessions no run started/.test(r)),
                JSON.stringify({ title: initiative.title, list: initiative.list, split: initiative.split })
            );
            await shot("initiative");

            // 4. an arc project page: the run is titled by its chunk, the judge has no row, the unpriced pi session reads unpriced
            const arc = await openArc();
            const runRow = arc.list?.rowText[arc.list.rows.indexOf(RUN_ITEM)] ?? "";
            const piRow = arc.list?.rowText[arc.list.rows.indexOf(PI_ITEM)] ?? "";
            rec(
                "4. attributed rows on Arc's page: the orchestrator run reads its chunk, not its goal; the brainstorm lead has a row and its judge none; the unpriced pi row reads unpriced",
                arc.settled &&
                    arc.title === ARC_NAME &&
                    runRow.startsWith(CHUNK) &&
                    !runRow.includes(GOAL) &&
                    arc.list.rows.includes(LEAD_ITEM) &&
                    !arc.list.rows.some((k) => k.includes("fx-judge")) &&
                    !arc.list.rowText.some((t) => t.includes("Judge the price table")) &&
                    piRow.includes("unpriced") &&
                    !piRow.includes("≈"),
                JSON.stringify({ title: arc.title, runRow, piRow, rows: arc.list?.rows })
            );

            // 5. a run's page: back to its project, Open run, its sessions with their task ids and titles, a split by role
            const run = await openItem(RUN_ITEM);
            const taskRows = Object.entries(TASKS).map(([id, title]) => `${id} · ${title}`);
            const roles = ["lead", "worker", "reviewer"];
            rec(
                "5. the run's page: Back to Arc, Open run, its sessions titled by task id and task title (not the AI title), and a split by role",
                run.settled &&
                    run.back === `Back to ${ARC_NAME}` &&
                    run.openRun === "Open run" &&
                    run.title === CHUNK &&
                    run.list?.title === "Sessions in this run" &&
                    run.list.rows.length === 4 &&
                    taskRows.every((t) => run.list.rowText.some((r) => r.startsWith(t))) &&
                    !run.list.rowText.some((r) => r.includes("Add six fields to a struct")) &&
                    roles.every((r) => run.list.rowText.some((t) => t.includes(`${r} ·`))) &&
                    roles.every((r) => run.split.some((s) => s.toLowerCase().includes(r))),
                JSON.stringify({ title: run.title, back: run.back, openRun: run.openRun, list: run.list, split: run.split })
            );
            await shot("run");
            await goBack(`project:${ARC}`);

            // 6. a brainstorm lead's page: its judge's usage is in it, split by role
            const lead = await openItem(LEAD_ITEM);
            rec(
                "6. a brainstorm lead's page holds its judge: titled by the lead, split by role with the judge, no Open run",
                lead.settled &&
                    lead.title === "Read the price table" &&
                    lead.back === `Back to ${ARC_NAME}` &&
                    lead.split.some((s) => s.toLowerCase().includes("judge")) &&
                    lead.openRun == null &&
                    lead.list?.rows.length === 2,
                JSON.stringify({ title: lead.title, split: lead.split, list: lead.list, openRun: lead.openRun })
            );
            await shot("lead");
            await goBack(`project:${ARC}`);

            // 7. the unpriced session's own page: its API-equivalent card says unpriced, with no priced tokens
            const pi = await openItem(PI_ITEM);
            const piCard = await h.ev(`(() => {
                ${LIB}
                const c = card("API-equivalent");
                return { value: text(c?.children[1]), sub: text(c?.children[2]) };
            })()`);
            rec(
                "7. an unpriced session's page: the API-equivalent card reads unpriced over its share of all spend and its coverage, 0% of tokens priced",
                pi.settled && piCard.value === "unpriced" && /(^| · )0% of tokens priced$/.test(piCard.sub),
                JSON.stringify({ scope: pi.scope, piCard })
            );
            await openAll();
            const coverage = await h.ev(`(() => {
                ${LIB}
                const c = card("API-equivalent");
                return { value: text(c?.children[1]), sub: text(c?.children[2]) };
            })()`);
            rec(
                "7b. All usage shows an estimate and its pricing coverage: the unpriced session is a part of the tokens, so coverage is under 100%",
                /^≈ /.test(coverage.value) && /^\d+% of tokens priced$/.test(coverage.sub) && !coverage.sub.startsWith("100%"),
                JSON.stringify(coverage)
            );

            // 8. a narrow scope's daily chart spans the held window: siem is active on two days, and the 7-day chart has 7 columns
            const siem = await view(h, click(`[data-usage-project="${SIEM}"]`), `${atScope(`project:${SIEM}`)} && s.list != null`);
            rec(
                "8. the daily chart of a project active on two days spans the held window: 7 columns under 7 days",
                siem.settled && siem.dailyDays === WEEK_COLUMNS,
                JSON.stringify({ scope: siem.scope, dailyDays: siem.dailyDays })
            );
            await scrollTo("[data-usage-daily]");
            await shot("daily");
            await scrollTop();

            // 9. a failed range switch: the held figures are the other range's, so the cards drop them and the page offers Retry
            await openAll();
            await h.ev(`localStorage.setItem(${JSON.stringify(FIXTURE_KEY)}, ${JSON.stringify(JSON.stringify({ fail: true }))})`);
            const failed = await view(
                h,
                `press(groupButton("Range", "All time"))`,
                `s.window === "All time" && s.switchFailed`
            );
            const panel = await h.ev(`(() => {
                ${LIB}
                const p = document.querySelector("[data-usage-switch-failed]");
                return {
                    text: text(p),
                    retry: [...(p?.querySelectorAll("button") ?? [])].map(text),
                    list: document.querySelector("[data-usage-list]") != null,
                    stats: document.querySelector("[data-usage-stats]") != null,
                };
            })()`);
            await shot("switch-failed");
            rec(
                "9. a failed range switch shows the switch-failed panel with Retry, and the scope cards read a dash instead of the other range's figures",
                failed.clicked &&
                    failed.settled &&
                    /Couldn.t load usage for all time/.test(panel.text) &&
                    panel.retry.includes("Retry") &&
                    !panel.list &&
                    !panel.stats &&
                    failed.figures.length > 0 &&
                    failed.figures.every((f) => f === "—"),
                JSON.stringify({ window: failed.window, panel, figures: failed.figures })
            );
            // Retry, with the scan back: the page shows All time's usage
            await h.ev(`localStorage.setItem(${JSON.stringify(FIXTURE_KEY)}, ${JSON.stringify(ctx.fixture)})`);
            const retried = await view(h, click("[data-usage-switch-failed] button"), `!s.switchFailed && s.list != null`);
            rec(
                "9b. Retry loads the range again: the panel is gone and the list is back under All time",
                retried.clicked && retried.settled && retried.window === "All time" && retried.scope === "all",
                JSON.stringify({ window: retried.window, scope: retried.scope, list: retried.list?.title })
            );
            await view(h, `press(groupButton("Range", "7 days"))`, `s.window === "7 days" && s.list != null`);

            // 10. By provider again: the provider page is where it was, Live limits and the filters included
            const back = await view(
                h,
                `press(groupButton("Lens", "By provider"))`,
                `s.lens === "By provider" && !!document.querySelector('[role="tablist"][aria-label="Provider"]')`
            );
            const backPage = await h.ev(`(() => {
                ${LIB}
                return {
                    liveLimits: /live limits/i.test(detail()?.innerText ?? ""),
                    ranges: ["7 days", "All time"].map((l) => rangeButton(l) != null),
                    workScopes: document.querySelector("[data-usage-scopes]") != null,
                    projection: /~100% by/.test(text(detail()?.querySelector('[data-usage-limit="week"]'))),
                };
            })()`);
            await shot("provider-again");
            rec(
                "10. By provider brings the provider page back: Live limits, the range filter and the projection, with no By work scope bar",
                back.settled && backPage.liveLimits && backPage.ranges.every(Boolean) && !backPage.workScopes && backPage.projection,
                JSON.stringify({ lens: back.lens, backPage })
            );
            return steps;
        },
        // Restore the developer's pre-existing fixture and quota snapshots (delete only absent keys), reload so the saved quota
        // returns to the original value, then select the 7-day window and return to the Cockpit.
        async teardown(h, ctx) {
            await h.ev(restore(FIXTURE_KEY, ctx.prevUsage));
            await h.ev(restore(RATE_KEY, ctx.prevRate));
            await h.ev("location.reload()");
            await new Promise((r) => setTimeout(r, 2500));
            await h.goto("usage");
            await h.ev(`(() => {
                ${LIB}
                return press(rangeButton("7 days"));
            })()`);
            await h.goto("cockpit");
        },
    };
    return [scenario];
}
