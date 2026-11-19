// session-search-history: the search box and results in Conversation History
// (spec docs/superpowers/specs/2026-11-17-session-search-design.md). One scenario,
// `session-search-history`.
//
// It answers `getsessionsactivity`, `searchsessions` and `getagenttranscript` in-page through RpcApi.setMockRpcClient, as
// agent-history's installAhMock does, so it never depends on the developer's transcripts: the archive holds four made-up
// sessions (three solos, one worker of a run), and the search answers name those four plus a fifth, 20 days old, that no
// loaded page holds. Which answer a query gets is a table in the mock (`incomplete`, `truncated`, empty and a rejected
// call are each one query), so a step changes the answer by typing another query.
//   1. History shows the search box, above the status filter.
//   2. a query shows "N results" in place of "All activity" and the recency groups, one solo card per session with its
//      marked snippet, one of them a session older than the loaded page.
//   3. the status filter narrows the results.
//   4. an incomplete answer reads "· indexing…", a truncated one "· newest 200".
//   5. no results read "No conversations match", a rejected call "Search failed".
//   6. while the box holds a query no older page loads; Esc empties it and brings the paged list back, which then loads
//      the older page its cursor kept.
//   7. clicking a solo result selects it and the detail shows its header, also for the session no loaded page holds.
//   8. clicking a run worker's result shows the run's detail with that member selected.
//   9. j / k walk the results.
// kits is scenarios.mjs's KAEL_KITS; the page reload and the polling wait are kits.rt's. The app's modules are imported in
// the page by agentPage (agent-page-fixtures.mjs), which also finds the app's one AgentsViewModel.

import { agentPage } from "./agent-page-fixtures.mjs";

const NAME = "session-search-history";
const MOCK_KEY = "__arcSessionSearchHistoryMock";
const MIN = 60_000;
const DAY = 86_400_000;

// the page's pieces, as expressions
const HISTORY = `document.querySelector("[data-agent-history]")`;
const SEARCH = `document.querySelector("[data-history-search]")`;
const LIST = `document.querySelector("[data-history-list]")`;
const DETAIL = `document.querySelector("[data-history-detail]")`;
const CARD = (key) => `document.querySelector('[data-history-result="${key}"]')`;
const KEYS = `[...document.querySelectorAll("[data-history-result]")].map((c) => c.getAttribute("data-history-result"))`;
// the element's text on one line; "" when there is no such element, so a wait on it never throws
const FLAT = (expr) => `(((${expr})?.textContent ?? "").replace(/\\s+/g, " ").trim())`;
const HEAD = FLAT(`document.querySelector("[data-history-results-head]")`);
const DETAIL_TITLE = FLAT(`${DETAIL}?.querySelector("h2")`);
const FILTER = (label) =>
    `[...document.querySelectorAll('[data-agent-history] [aria-label="Status filter"] button')].find((b) => b.textContent.trim().startsWith(${JSON.stringify(label)}))`;

const key = (s) => `${s.runtime}:${s.id}`;

// one session as the scan lists it; age is how long ago it last moved
function session(now, o) {
    const { age, ...rest } = o;
    return {
        runtime: "claude",
        projectpath: "C:/ssh/acme-web",
        projectname: "acme-web",
        branch: "main",
        model: "opus",
        tokenstotal: 1200,
        status: "done",
        startedts: now - age - 10 * MIN,
        lastactivets: now - age,
        durationms: 10 * MIN,
        events: [],
        resumecommand: `claude --resume ${o.id}`,
        transcriptpath: `C:/ssh/transcripts/${o.id}.jsonl`,
        ...rest,
    };
}

// a hit on a turn: the text, and the [start, end) UTF-16 range of every occurrence of the term (the matcher's marks)
function hit(text, term, ord) {
    const marks = [];
    const low = text.toLowerCase();
    for (let i = low.indexOf(term); i >= 0; i = low.indexOf(term, i + term.length)) {
        marks.push([i, i + term.length]);
    }
    return { kind: "turn", speaker: "user", ord, text, marks };
}

const result = (s, hits) => ({ session: s, hits, turnhits: hits.length, eventhits: 0 });

// the sessions the scenario's archive holds, the one only a search reaches, and what each query is answered with
function seed(now) {
    const a = session(now, { id: "ssh-a", task: "Fix the login redirect bug", age: 10 * MIN });
    const b = session(now, { id: "ssh-b", task: "Refactor the billing module", age: 30 * MIN });
    const c = session(now, { id: "ssh-c", task: "Write the release notes", age: 50 * MIN, status: "waiting" });
    const w = session(now, {
        id: "ssh-w",
        task: "Add retry to the sync job",
        age: 70 * MIN,
        runid: "ssh-run-1",
        channelid: "ssh-ch",
        taskid: "t-1",
        role: "worker",
    });
    const old = session(now, { id: "ssh-old", task: "Investigate the flaky checkout test", age: 20 * DAY });
    const retryHits = {
        a: hit("the redirect came back after we added a retry loop around the login call", "retry", 2),
        c: hit("please add a retry with backoff to the release notes script", "retry", 0),
        w: hit("retry the failed sync job before it gives up", "retry", 0),
        old: hit("the checkout test is flaky, a retry hides it but does not fix it", "retry", 4),
    };
    const answers = {
        retry: {
            results: [result(a, [retryHits.a]), result(c, [retryHits.c]), result(w, [retryHits.w]), result(old, [retryHits.old])],
            terms: ["retry"],
        },
        indexing: {
            results: [result(a, [hit("indexing is still running", "indexing", 1)]), result(b, [hit("indexing the invoices", "indexing", 0)])],
            terms: ["indexing"],
            incomplete: true,
        },
        newest: {
            results: [result(a, [hit("the newest build", "newest", 1)]), result(b, [hit("the newest invoice", "newest", 0)])],
            terms: ["newest"],
            truncated: true,
        },
        nothing: { results: [], terms: ["nothing"] },
    };
    return { loaded: [a, b, c, w], old, answers, fail: { boom: "search backend unavailable" } };
}

// Runs IN THE PAGE (through agentPage): answers the three calls from the table, delegates every other command to what was
// there, and records the queries asked and the older pages requested (a getsessionsactivity with a cursor).
const installMock = (data) => `
    const api = (await mod("app/store/wshclientapi.ts")).RpcApi;
    if (!api || typeof api.setMockRpcClient !== "function") return "no-api";
    if (window.${MOCK_KEY}) return "already-installed";
    const prev = api.mockClient ?? null;
    const data = ${JSON.stringify(data)};
    const state = { searches: [], older: [] };
    const mock = {
        mockWshRpcCall(client, command, d, opts) {
            if (command === "getsessionsactivity") {
                if (d?.cursor) {
                    state.older.push(d.cursor);
                    return Promise.resolve({ sessions: [], nextcursor: "" });
                }
                return Promise.resolve({ sessions: data.loaded });
            }
            if (command === "searchsessions") {
                state.searches.push(d.query);
                if (data.fail[d.query] != null) return Promise.reject(new Error(data.fail[d.query]));
                return Promise.resolve(data.answers[d.query] ?? { results: [], terms: d.query.toLowerCase().split(/\\s+/).filter(Boolean) });
            }
            if (command === "getagenttranscript") return Promise.resolve({ lines: [], start: 0, total: 0, end: 0 });
            return prev ? prev.mockWshRpcCall(client, command, d, opts) : client.wshRpcCall(command, d, opts);
        },
        mockWshRpcStream(client, command, d, opts) {
            return prev ? prev.mockWshRpcStream(client, command, d, opts) : client.wshRpcStream(command, d, opts);
        },
    };
    window.${MOCK_KEY} = { api, prev, state };
    api.setMockRpcClient(mock);
    return "ok";`;

const removeMock = (h) =>
    h.ev(`(() => {
        const f = window.${MOCK_KEY};
        if (!f) return "absent";
        f.api.setMockRpcClient(f.prev);
        delete window.${MOCK_KEY};
        return "restored";
    })()`);

// the archive holds exactly the scenario's sessions (a scan that landed meanwhile would have kept the real ones behind its
// first page), no older page, and Library shows Conversation History
const openHistory = (loaded) => `
    const A = await mod("app/view/agents/sessionsarchivestore.ts");
    const L = await mod("app/view/library/librarystore.ts");
    const model = agentsModel();
    globalStore.set(A.sessionsArchiveAtom, ${JSON.stringify(loaded)});
    globalStore.set(A.sessionsCursorAtom, "");
    globalStore.set(A.sessionsErrorAtom, false);
    globalStore.set(model.sessionsSelAtom, "all");
    globalStore.set(model.sessionsStatusFilterAtom, "all");
    L.showLibrary(model, "conversations");
    return true;`;

const readSelection = (h) =>
    agentPage(
        h,
        `const model = agentsModel();
        return { sel: globalStore.get(model.sessionsSelAtom), member: globalStore.get(model.sessionsMemberAtom) };`
    );
const mockState = (h) => h.ev(`window.${MOCK_KEY}?.state ?? null`);

export default function (kits) {
    const { polishWaitFor, polishNap, ahReload } = kits.rt;

    const wait = (h, expr, ms = 6000) => polishWaitFor(h, expr, ms);
    // focus the box, replace what it holds and let React take the input
    const typeQuery = async (h, text) => {
        await h.ev(`(() => { const el = ${SEARCH}; el.focus(); el.select(); return !!el; })()`);
        await h.cdp("Input.insertText", { text });
    };
    const pressKey = async (h, key, code, keyCode) => {
        for (const type of ["keyDown", "keyUp"]) {
            await h.cdp("Input.dispatchKeyEvent", { type, key, code, windowsVirtualKeyCode: keyCode });
        }
    };
    const clickCard = (h, k) => h.ev(`(${CARD(k)}?.click(), ${CARD(k)} != null)`);
    const setFilter = (h, label) => h.ev(`(${FILTER(label)}?.click(), ${FILTER(label)} != null)`);

    const scenario = {
        name: NAME,
        surface: "agent",
        async arrange(h) {
            const ctx = { data: seed(Date.now()) };
            // a throw past this point still returns ctx, so teardown undoes whatever was already made
            try {
                ctx.mock = await agentPage(h, installMock(ctx.data));
                await agentPage(h, openHistory(ctx.data.loaded));
                ctx.open = await wait(h, `!!${HISTORY} && !!${SEARCH}`, 10000);
            } catch (e) {
                ctx.arrangeError = String(e?.message ?? e);
            }
            return ctx;
        },
        async assert(h, ctx) {
            const steps = [];
            const rec = (step, ok, detail) => steps.push({ step, ok: !!ok, detail: JSON.stringify(detail) });
            rec(
                "0. the sessions mock is in place and Conversation History is open on the four loaded sessions",
                ctx.arrangeError == null && ctx.mock === "ok" && ctx.open === true,
                ctx.arrangeError ?? { mock: ctx.mock, open: ctx.open }
            );
            if (ctx.arrangeError != null || ctx.open !== true) return steps;
            const { data } = ctx;
            const [a, b, c, w] = data.loaded.map(key);
            const old = key(data.old);

            // a thrown call (the page went away, a CDP timeout) must not discard the steps recorded so far
            try {
                // 1. the box sits under the title, above the status filter, with the paged list as it was
                await wait(h, `!!${LIST} && ${FLAT(LIST)}.includes("All activity")`);
                const box = await h.ev(`(() => {
                    const el = ${SEARCH};
                    const filter = document.querySelector('[data-agent-history] [aria-label="Status filter"]');
                    return {
                        placeholder: el?.placeholder ?? null,
                        aboveFilter: !!el && !!filter && !!(el.compareDocumentPosition(filter) & Node.DOCUMENT_POSITION_FOLLOWING),
                        allActivity: ${FLAT(LIST)}.includes("All activity"),
                        results: document.querySelectorAll("[data-history-result]").length,
                    };
                })()`);
                await h.shot("cdp-shots/session-search-history-1-box.png");
                rec(
                    "1. History shows the search box under its title, above the status filter, with the paged list (All activity) as before",
                    box.placeholder === "Search conversations" && box.aboveFilter && box.allActivity && box.results === 0,
                    box
                );

                // 2. a query: "4 results" in place of the paged list, a card per session with its marked snippet
                await typeQuery(h, "retry");
                const shown = await wait(h, `${HEAD} === "4 results"`);
                const two = await h.ev(`(() => {
                    const mark = (k) => [...(document.querySelector('[data-history-result="' + k + '"]')?.querySelectorAll("[data-search-mark]") ?? [])].map((m) => m.textContent);
                    return {
                        head: ${HEAD},
                        keys: ${KEYS},
                        marks: Object.fromEntries(${JSON.stringify([a, c, w, old])}.map((k) => [k, mark(k)])),
                        allActivity: ${FLAT(LIST)}.includes("All activity"),
                    };
                })()`);
                await h.shot("cdp-shots/session-search-history-2-results.png");
                const markedEach = [a, c, w, old].every((k) => JSON.stringify(two.marks?.[k]) === JSON.stringify(["retry"]));
                rec(
                    "2. a query shows '4 results' in place of All activity, one card per session in the answer's order, each with its marked snippet; one is a session no loaded page holds",
                    shown === true &&
                        two.head === "4 results" &&
                        JSON.stringify(two.keys) === JSON.stringify([a, c, w, old]) &&
                        markedEach &&
                        two.allActivity === false &&
                        !data.loaded.some((s) => key(s) === old),
                    { shown, head: two.head, keys: two.keys, marks: two.marks, allActivity: two.allActivity }
                );

                // 3. the status filter narrows the results as it narrows solo rows
                const narrowed = {};
                for (const [label, head] of [
                    ["Needs you", "1 result"],
                    ["Done", "3 results"],
                    ["All", "4 results"],
                ]) {
                    await setFilter(h, label);
                    const ok = await wait(h, `${HEAD} === ${JSON.stringify(head)}`, 4000);
                    narrowed[label] = { ok, head: await h.ev(HEAD), keys: await h.ev(KEYS) };
                    if (label === "Needs you") await h.shot("cdp-shots/session-search-history-3-needs-you.png");
                }
                rec(
                    "3. the status filter narrows the results: Needs you keeps the waiting session, Done the three finished ones, All gives all four back",
                    narrowed["Needs you"].ok &&
                        JSON.stringify(narrowed["Needs you"].keys) === JSON.stringify([c]) &&
                        narrowed.Done.ok &&
                        JSON.stringify(narrowed.Done.keys) === JSON.stringify([a, w, old]) &&
                        narrowed.All.ok &&
                        narrowed.All.keys.length === 4,
                    narrowed
                );

                // 4. an answer still being built reads "· indexing…", a cut one "· newest 200"
                await typeQuery(h, "indexing");
                const indexing = await wait(h, `${HEAD} === "2 results · indexing…"`);
                const indexingHead = await h.ev(HEAD);
                await h.shot("cdp-shots/session-search-history-4-indexing.png");
                await typeQuery(h, "newest");
                const newest = await wait(h, `${HEAD} === "2 results · newest 200"`);
                const newestHead = await h.ev(HEAD);
                await h.shot("cdp-shots/session-search-history-4-newest.png");
                rec(
                    "4. an incomplete answer reads '2 results · indexing…', a truncated one '2 results · newest 200'",
                    indexing && newest,
                    { indexingHead, newestHead }
                );

                // 5. nothing found, and a call that fails
                await typeQuery(h, "nothing");
                const empty = await wait(h, `!!document.querySelector("[data-history-search-empty]")`);
                const emptyText = await h.ev(FLAT(`document.querySelector("[data-history-search-empty]")`));
                const emptyCards = await h.ev(`document.querySelectorAll("[data-history-result]").length`);
                await h.shot("cdp-shots/session-search-history-5-empty.png");
                await typeQuery(h, "boom");
                const failed = await wait(h, `!!document.querySelector("[data-history-search-error]")`);
                const failedText = await h.ev(FLAT(`document.querySelector("[data-history-search-error]")`));
                await h.shot("cdp-shots/session-search-history-5-error.png");
                rec(
                    "5. no results read 'No conversations match' and a rejected call 'Search failed: …', with no cards",
                    empty &&
                        emptyText === "No conversations match" &&
                        emptyCards === 0 &&
                        failed &&
                        failedText === "Search failed: search backend unavailable",
                    { emptyText, emptyCards, failedText }
                );

                // 6. no older page loads while the box holds a query; Esc brings the paged list back, which loads it
                await agentPage(
                    h,
                    `const A = await mod("app/view/agents/sessionsarchivestore.ts");
                    globalStore.set(A.sessionsCursorAtom, "cursor-1");
                    return true;`
                );
                await polishNap(900);
                const whileSearching = (await mockState(h))?.older ?? null;
                await pressKey(h, "Escape", "Escape", 27);
                const back = await wait(h, `!!${LIST} && ${FLAT(LIST)}.includes("All activity")`);
                const loadedOlder = await wait(h, `(window.${MOCK_KEY}?.state.older.length ?? 0) > 0`, 4000);
                const after = await h.ev(`(() => ({
                    value: ${SEARCH}?.value ?? null,
                    older: window.${MOCK_KEY}?.state.older ?? null,
                    results: document.querySelectorAll("[data-history-result]").length,
                    list: ${FLAT(LIST)},
                }))()`);
                const archive = await agentPage(
                    h,
                    `const A = await mod("app/view/agents/sessionsarchivestore.ts");
                    return { size: globalStore.get(A.sessionsArchiveAtom)?.length ?? null, cursor: globalStore.get(A.sessionsCursorAtom) };`
                );
                await h.shot("cdp-shots/session-search-history-6-cleared.png");
                rec(
                    "6. while the box holds a query no older page loads; Esc empties it and brings the paged list back (All activity, the loaded sessions), which then loads the older page its cursor kept",
                    JSON.stringify(whileSearching) === "[]" &&
                        back &&
                        after.value === "" &&
                        after.results === 0 &&
                        // the three solos by their titles, the run's one card by the title a run with no lead gets
                        [...data.loaded.slice(0, 3).map((s) => s.task), "Orchestrator run"].every((t) => after.list.includes(t)) &&
                        loadedOlder &&
                        JSON.stringify(after.older) === JSON.stringify(["cursor-1"]) &&
                        archive.size === data.loaded.length &&
                        archive.cursor === "",
                    { whileSearching, back, ...after, archive }
                );

                // 7. a click on a solo result selects it, and its header is the detail's, for the older session too
                await typeQuery(h, "retry");
                await wait(h, `${HEAD} === "4 results"`);
                await clickCard(h, a);
                const soloShown = await wait(h, `${DETAIL_TITLE} === ${JSON.stringify(data.loaded[0].task)}`);
                const soloSel = await readSelection(h);
                const soloActive = await h.ev(`${CARD(a)}?.className.includes("border-accent") ?? false`);
                await h.shot("cdp-shots/session-search-history-7-solo.png");
                await clickCard(h, old);
                const oldShown = await wait(h, `${DETAIL_TITLE} === ${JSON.stringify(data.old.task)}`);
                const oldSel = await readSelection(h);
                const oldActive = await h.ev(`${CARD(old)}?.className.includes("border-accent") ?? false`);
                await h.shot("cdp-shots/session-search-history-7-older.png");
                rec(
                    "7. clicking a solo result selects it and the right pane shows that session's header, also for the session older than the loaded page",
                    soloShown &&
                        soloSel.sel === a &&
                        soloActive &&
                        oldShown &&
                        oldSel.sel === old &&
                        oldActive,
                    { soloShown, soloSel, soloActive, oldShown, oldSel, oldActive }
                );

                // 8. a run worker's result opens the run, with the worker's member in view
                await clickCard(h, w);
                const runShown = await wait(h, `!!${DETAIL}?.querySelector('[role="group"][aria-label="Sessions in this run"]')`);
                const run = await h.ev(`(() => {
                    const group = ${DETAIL}?.querySelector('[role="group"][aria-label="Sessions in this run"]');
                    const current = group?.querySelector('button[aria-current="true"]');
                    const member = [...(${DETAIL}?.querySelectorAll("h3") ?? [])].map((h3) => h3.textContent.trim()).find((t) => t.startsWith("Task"));
                    return {
                        title: ${DETAIL_TITLE},
                        current: current?.textContent.replace(/\\s+/g, " ").trim() ?? null,
                        member: member ?? null,
                        active: ${CARD(w)}?.className.includes("border-accent") ?? false,
                    };
                })()`);
                const runSel = await readSelection(h);
                await h.shot("cdp-shots/session-search-history-8-run.png");
                rec(
                    "8. clicking a run worker's result shows the run's detail with that worker's member selected",
                    runShown &&
                        runSel.sel === "run:ssh-run-1" &&
                        runSel.member === "t-1" &&
                        /Add retry to the sync job/.test(run.current ?? "") &&
                        run.active,
                    { runShown, runSel, ...run }
                );

                // 9. j / k walk the results: the cursor is the selected result, so j moves to the next one
                await h.ev(`document.activeElement?.blur?.()`);
                await pressKey(h, "j", "KeyJ", 74);
                const next = await wait(h, `${CARD(old)}?.className.includes("border-accent")`, 3000);
                const nextSel = await readSelection(h);
                await pressKey(h, "k", "KeyK", 75);
                const prev = await wait(h, `${CARD(w)}?.className.includes("border-accent")`, 3000);
                const prevSel = await readSelection(h);
                rec(
                    "9. j walks to the next result and k back, in the answer's order, with the box still holding the query",
                    next && nextSel.sel === old && prev && prevSel.sel === "run:ssh-run-1" && (await h.ev(`${SEARCH}?.value`)) === "retry",
                    { next, nextSel, prev, prevSel }
                );
            } catch (e) {
                rec("the scenario stopped early: a page call failed", false, String(e?.message ?? e));
            }
            return steps;
        },
        async teardown(h) {
            const step = async (what, fn) => {
                try {
                    await fn();
                } catch (e) {
                    console.error(`${NAME} teardown: ${what} failed: ${e?.message ?? e}`);
                }
            };
            await step("remove the sessions mock", () => removeMock(h));
            // the reload drops the seeded archive, the selection, the filter and the find with the page
            await step("reload onto the live archive", async () => {
                if (!(await ahReload(h))) console.error(`${NAME} teardown: the page did not come back after the reload`);
            });
            await step("leave on the Cockpit", () => h.goto("cockpit"));
        },
    };
    return [scenario];
}
