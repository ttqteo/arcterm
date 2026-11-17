// session-search-find: opening a search result at its hit, with the find bar
// (docs/superpowers/plans/2026-11-17-session-search.md, Task 7). One scenario, `session-search-find`: it answers
// `getsessionsactivity` and `getagenttranscript` in-page through RpcApi.setMockRpcClient (as installAhMock in
// scenarios.mjs does), so it never depends on the developer's transcripts, and it opens a hit by calling openSessionHit
// (sessionsfind.ts) with a mocked SessionSearchResult, so it does not depend on History's search box either.
//
// The one session has a transcript of more lines than the 2,000-line tail the app reads first: its first turn holds a
// match, 228 items follow (more than the 200 CompactTranscript draws at first, so the hit is out of the drawn window and
// is drawn back to), and further matches sit at the end. A tail read would count 3; the whole file counts 4.
//
// The page's modules are reached the way ahResolveModules does (the url the app imported each by, read out of an
// importer's source), and the app's one AgentsViewModel through the nav rail's React fiber, as the agent-header scenario
// does. scenarios.mjs exports neither helper, so the few lines they need are repeated here.

import { randomUUID } from "node:crypto";

const NAME = "session-search-find";
const TERM = "zebra";
const SOLO_ID = "ssf-solo";
const SOLO_KEY = `claude:${SOLO_ID}`;
const SOLO_TITLE = "ssf zebra crossing";
const SOLO_PATH = "C:/ssf/solo.jsonl";
const OTHER_ID = "ssf-other";
const OTHER_TITLE = "ssf other conversation";
// the transcript: turn 1 (a match), a long reply, FILLERS prompt/reply pairs, WORK_A tool calls, a prompt and a long reply
// holding "zebra layer" and "zebra stripes", WORK_B tool calls, a last prompt (a match) and reply
const FILLERS = 110;
const WORK_A = 1000;
const WORK_B = 100;
const MATCHES = 4;
const TAIL_MATCHES = 3; // what the 2,000-line tail alone holds
const EVENT_ORD = 25;
const EVENT_TEXT = `committed the ${TERM} crossing layer`;
const MOCK_KEY = "__arcSessionSearchFindMock";
const STAGE_WAIT_MS = 15_000;
const SETTLE_MS = 400;

const nap = (ms) => new Promise((r) => setTimeout(r, ms));
const shot = (h, step) => h.shot(`cdp-shots/${NAME}-${step}.png`);

// ---- fixtures ------------------------------------------------------------------------------------------------------

// a long first prompt: the transcript shows six lines of it behind a Show more, and its match is on the ninth
const FIRST_PROMPT_LINE = `The ${TERM} crossing goes here, on the ninth line.`;
const FIRST_PROMPT = [
    "Please add a crossing to the map layer.",
    ...Array.from({ length: 7 }, (_, k) => `Context line ${k + 1} of this long prompt, which the transcript clamps to six lines.`),
    FIRST_PROMPT_LINE,
].join("\n");

const paragraph = (tag, k) =>
    `Paragraph ${tag}${k} keeps this reply long enough to scroll: ordinary words, one more clause, and nothing a search term touches.`;
const longReply = (tag, extra) =>
    Array.from({ length: 24 }, (_, k) => (k === 12 && extra ? extra : paragraph(tag, k))).join("\n\n");

// one Claude transcript, record by record, in the shapes the app's projector reads
function buildTranscript() {
    const lines = [];
    let t = Date.now() - 7_200_000;
    const base = () => ({
        cwd: "C:/ssf/waveterm",
        sessionId: SOLO_ID,
        uuid: randomUUID(),
        timestamp: new Date((t += 1000)).toISOString(),
    });
    const push = (rec) => lines.push(JSON.stringify(rec));
    const prompt = (text) => push({ ...base(), type: "user", message: { role: "user", content: text } });
    const answer = (text) =>
        push({
            ...base(),
            type: "assistant",
            message: { role: "assistant", model: "claude-opus-5-5", content: [{ type: "text", text }] },
        });
    const tool = (k) => {
        const id = `toolu_ssf${k}`;
        push({
            ...base(),
            type: "assistant",
            message: {
                role: "assistant",
                model: "claude-opus-5-5",
                content: [{ type: "tool_use", id, name: "Read", input: { file_path: `/work/file-${k}.txt` } }],
            },
        });
        push({
            ...base(),
            type: "user",
            message: { role: "user", content: [{ type: "tool_result", tool_use_id: id, content: "ok" }] },
        });
    };
    prompt(FIRST_PROMPT);
    answer(longReply("a", null));
    for (let k = 0; k < FILLERS; k++) {
        prompt(`filler question ${k}`);
        answer(`filler answer ${k}`);
    }
    for (let k = 0; k < WORK_A; k++) tool(`a${k}`);
    prompt("How far along is it?");
    answer(longReply("b", `The ${TERM} layer is done, and it draws ${TERM} stripes at every crossing.`));
    for (let k = 0; k < WORK_B; k++) tool(`b${k}`);
    prompt(`thanks, the ${TERM} map works`);
    answer("You're welcome.");
    return lines;
}

function buildSessions(now) {
    const base = {
        runtime: "claude",
        projectpath: "C:/ssf/waveterm",
        projectname: "waveterm",
        branch: "main",
        model: "opus",
        tokenstotal: 1200,
        status: "done",
        startedts: now - 7_200_000,
        durationms: 60_000,
    };
    const types = (i) => (i === 0 ? "started" : i === 39 ? "finished" : i % 5 === 0 ? "committed" : "asked");
    const events = Array.from({ length: 40 }, (_, i) => ({
        type: types(i),
        ts: now - (40 - i) * 60_000,
        text: i === EVENT_ORD ? EVENT_TEXT : `event ${i} of the session`,
    }));
    return [
        {
            ...base,
            id: SOLO_ID,
            task: SOLO_TITLE,
            lastactivets: now - 60_000,
            resumecommand: `claude --resume ${SOLO_ID}`,
            transcriptpath: SOLO_PATH,
            events,
        },
        {
            ...base,
            id: OTHER_ID,
            task: OTHER_TITLE,
            lastactivets: now - 600_000,
            resumecommand: `claude --resume ${OTHER_ID}`,
            transcriptpath: "C:/ssf/other.jsonl",
            events: [],
        },
    ];
}

// the result the History search would answer for TERM: the solo with a turn hit at its first match and an event hit
function buildResult(solo) {
    const turnHit = {
        kind: "turn",
        speaker: "user",
        ord: 0,
        text: FIRST_PROMPT_LINE,
        marks: [[4, 4 + TERM.length]],
    };
    const eventHit = {
        kind: "event",
        speaker: "committed",
        ord: EVENT_ORD,
        text: EVENT_TEXT,
        marks: [[14, 14 + TERM.length]],
    };
    return { result: { session: solo, hits: [turnHit, eventHit], turnhits: MATCHES, eventhits: 1 }, turnHit, eventHit };
}

// ---- the page ------------------------------------------------------------------------------------------------------

// Runs IN THE PAGE (resolveModules sends its source). The urls the dev server serves the app's own modules from: the one
// the app imported each by, since a dynamic import of any other spelling is a second instance. Starts from the entry
// script main.tsx, reads the url it imports jotaiStore by, then reads each other module's url out of a known importer.
async function resolveInPage() {
    const sourceOf = async (url) => {
        const res = await fetch(url);
        if (!res.ok) throw new Error(`${url} answered ${res.status}`);
        return res.text();
    };
    const urlIn = (source, base, file) => {
        const m = source.match(new RegExp(`["']([^"'\\s]*${file.replace(/\./g, "\\.")}(?:\\?[^"'\\s]*)?)["']`));
        return m ? new URL(m[1], base).href : null;
    };
    const entry = [...document.querySelectorAll('script[type="module"][src]')].find((s) =>
        /\/main\.tsx(\?|$)/.test(s.src)
    );
    if (!entry) throw new Error("the page has no module script for main.tsx");
    const store = urlIn(await sourceOf(entry.src), entry.src, "/store/jotaiStore.ts");
    if (!store) throw new Error(`${entry.src} does not import /store/jotaiStore.ts`);
    const via = async (importer, file) => {
        const from = new URL(importer, store).href;
        const url = urlIn(await sourceOf(from), from, file);
        if (!url) throw new Error(`${from} does not import ${file}`);
        return url;
    };
    return {
        store,
        api: await via("../view/agents/sessionsarchivestore.ts", "/store/wshclientapi.ts"),
        find: await via("../view/agents/sessionsdetail.tsx", "/sessionsfind.ts"),
    };
}

async function resolveModules(h) {
    try {
        return { urls: await h.ev(`(${resolveInPage.toString()})()`) };
    } catch (e) {
        return { error: String(e?.message ?? e) };
    }
}

// the app's one AgentsViewModel, found above the nav rail (which takes it as a prop)
const MODEL_LIB = `
    const agentsModel = () => {
        const nav = document.querySelector("nav");
        const key = nav && Object.keys(nav).find((k) => k.startsWith("__reactFiber$"));
        for (let f = key ? nav[key] : null; f; f = f.return) {
            if (f.memoizedProps?.model?.pendingLaunchesAtom) return f.memoizedProps.model;
        }
        throw new Error("no AgentsViewModel above the nav rail");
    };
`;

// answers getsessionsactivity with the sessions and getagenttranscript for the solo's path like wavesrv does (the last
// maxlines lines for a tail, every line for -1, nothing after a frombyte: the file does not grow), recording each
// transcript question; every other command goes where it went before
function installMock(h, apiUrl, sessions, lines) {
    return h.ev(`(async () => {
        const mod = await import(${JSON.stringify(apiUrl)});
        const api = mod.RpcApi;
        if (!api || typeof api.setMockRpcClient !== "function") return "no-api";
        if (window.${MOCK_KEY}) return "already-installed";
        const prev = api.mockClient ?? null;
        const sessions = ${JSON.stringify(sessions)};
        const lines = ${JSON.stringify(lines)};
        const enc = new TextEncoder();
        let off = 0;
        const ends = lines.map((l) => (off += enc.encode(l).length + 1));
        const state = { asks: [] };
        const mock = {
            mockWshRpcCall(client, command, data, opts) {
                if (command === "getsessionsactivity") {
                    return Promise.resolve({ sessions });
                }
                if (command === "getagenttranscript" && data?.path === ${JSON.stringify(SOLO_PATH)}) {
                    state.asks.push({ maxlines: data.maxlines ?? null, frombyte: data.frombyte ?? null });
                    const total = lines.length;
                    if (data.frombyte) {
                        return Promise.resolve({ lines: [], start: 0, total: 0, end: data.frombyte });
                    }
                    const n = data.maxlines == null || data.maxlines < 0 ? total : Math.min(total, data.maxlines);
                    return Promise.resolve({ lines: lines.slice(total - n), start: total - n, total, end: ends[total - 1] });
                }
                return prev ? prev.mockWshRpcCall(client, command, data, opts) : client.wshRpcCall(command, data, opts);
            },
            mockWshRpcStream(client, command, data, opts) {
                return prev ? prev.mockWshRpcStream(client, command, data, opts) : client.wshRpcStream(command, data, opts);
            },
        };
        window.${MOCK_KEY} = { api, prev, state };
        api.setMockRpcClient(mock);
        const probe = await api.GetSessionsActivityCommand(window.TabRpcClient, { windowdays: 30, limit: 100 });
        return (probe.sessions ?? []).some((s) => s.id === ${JSON.stringify(SOLO_ID)}) ? "ok" : "not-intercepted";
    })()`);
}

const removeMock = (h) =>
    h.ev(`(() => {
        const f = window.${MOCK_KEY};
        if (!f) return "absent";
        f.api.setMockRpcClient(f.prev);
        delete window.${MOCK_KEY};
        return "restored";
    })()`);

const mockAsks = (h) => h.ev(`window.${MOCK_KEY}?.state.asks ?? null`);

// Reloads and waits for the new document's nav rail. A bare wait for the nav can be answered by the old document before
// the navigation commits, so the old document carries a mark the new one lacks.
async function reload(h) {
    await h.ev("window.__arcSsfReloading = true");
    try {
        await h.ev("location.reload()");
    } catch {
        /* the evaluate is cut off by the navigation it just started */
    }
    for (let i = 0; i < 120; i++) {
        await nap(500);
        const ready = await h
            .ev(`!window.__arcSsfReloading && !!document.querySelector("nav button")`)
            .catch(() => false);
        if (ready) return true;
    }
    return false;
}

// Runs IN THE PAGE: the transcript under History, its scroll, the find bar, and the painted matches (the CSS Custom
// Highlight registry: `all` is every drawn match but the current one, `current` the one the bar stands on)
function readFindInPage() {
    const root = document.querySelector("[data-agent-history] [data-compact-transcript]");
    const scroller = root?.parentElement ?? null;
    const bar = document.querySelector("[data-agent-history] [data-session-find]");
    const input = bar?.querySelector("input") ?? null;
    const all = CSS.highlights.get("session-find");
    const cur = CSS.highlights.get("session-find-current");
    const range = cur ? [...cur][0] : null;
    let visible = false;
    let clipped = false;
    let inEntry = null;
    let inNode = null;
    let more = null;
    if (range && scroller) {
        const r = range.getBoundingClientRect();
        const box = scroller.getBoundingClientRect();
        visible = r.height > 0 && r.top >= box.top && r.bottom <= box.bottom;
        const entry = range.startContainer.parentElement?.closest("[data-find-entry]");
        inEntry = (entry?.textContent ?? "").slice(0, 80);
        // the text node the match is in (the entry's first 80 characters do not reach a match in a long message)
        inNode = (range.startContainer.textContent ?? "").slice(0, 80);
        // a long prompt is clamped behind a Show more: a match below its six lines lies past its element's box
        more = entry?.querySelector("button")?.textContent?.trim() ?? null;
        clipped = entry != null && r.bottom > entry.getBoundingClientRect().bottom + 1;
    }
    return {
        transcript: root != null,
        items: root?.querySelectorAll(":scope > [data-compact-item]").length ?? 0,
        endsWithReply: (root?.textContent ?? "").includes("You're welcome."),
        scrollTop: Math.round(scroller?.scrollTop ?? -1),
        bar: bar != null,
        pos: bar?.querySelector("[data-find-pos]")?.textContent ?? null,
        query: input?.value ?? null,
        focused: input != null && document.activeElement === input,
        stepDisabled: [...(bar?.querySelectorAll('button[aria-label$=" match"]') ?? [])].map((b) => b.disabled),
        all: all?.size ?? 0,
        current: cur?.size ?? 0,
        currentText: range ? range.toString() : null,
        inEntry,
        inNode,
        more,
        clipped,
        visible,
    };
}
const read = (h) => h.ev(`(${readFindInPage.toString()})()`);

// polls a page expression to truthy (false past STAGE_WAIT_MS)
async function until(h, expr) {
    for (const t0 = Date.now(); Date.now() - t0 < STAGE_WAIT_MS; await nap(150)) {
        if (await h.ev(`!!(${expr})`)) return true;
    }
    return false;
}

// polls the read until `ok` holds of it (or STAGE_WAIT_MS passes), lets the paint and the scroll settle, reads again
async function readWhen(h, ok) {
    let r = await read(h);
    for (const t0 = Date.now(); !ok(r) && Date.now() - t0 < STAGE_WAIT_MS; r = await read(h)) await nap(150);
    await nap(SETTLE_MS);
    return read(h);
}

// a key on the find bar's input as the input receives it (CDP key events may never reach the WebView)
const keyInFind = (h, key, shift = false) =>
    h.ev(`(() => {
        const input = document.querySelector("[data-session-find] input");
        if (!input) return false;
        input.dispatchEvent(new KeyboardEvent("keydown", { key: ${JSON.stringify(key)}, shiftKey: ${shift}, bubbles: true, cancelable: true }));
        return true;
    })()`);

// types into the find bar's query the way a person does: the input's own setter, then the event React listens for
const setQuery = (h, q) =>
    h.ev(`(() => {
        const input = document.querySelector("[data-session-find] input");
        if (!input) return false;
        Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value").set.call(input, ${JSON.stringify(q)});
        input.dispatchEvent(new Event("input", { bubbles: true }));
        return true;
    })()`);

// openSessionHit on the app's own model, as History's click on a result calls it
const openHit = (h, urls, result, hit) =>
    h.ev(`(async () => {
        ${MODEL_LIB}
        const { openSessionHit } = await import(${JSON.stringify(urls.find)});
        openSessionHit(agentsModel(), ${JSON.stringify(result)}, ${JSON.stringify(TERM)}, ${JSON.stringify([TERM])}, ${JSON.stringify(hit)});
        return true;
    })()`);

const readFindAtom = (h, urls) =>
    h.ev(`(async () => {
        const { globalStore } = await import(${JSON.stringify(urls.store)});
        const { sessionFindAtom } = await import(${JSON.stringify(urls.find)});
        return globalStore.get(sessionFindAtom);
    })()`);

// the activity row a search hit outlined (aria-current), and whether it is inside its scroller's view
const READ_EVENT_MARK = `(() => {
    const view = document.querySelector('[data-agent-history] [aria-label="Session view"] [aria-pressed="true"]')?.textContent ?? null;
    const marked = [...document.querySelectorAll('[data-agent-history] [aria-current="true"]')];
    const row = marked[0];
    const scroller = row?.closest(".overflow-y-auto");
    const r = row?.getBoundingClientRect();
    const box = scroller?.getBoundingClientRect();
    return {
        view,
        marked: marked.length,
        text: (row?.textContent ?? "").replace(/\\s+/g, " ").trim(),
        visible: r != null && box != null && r.height > 0 && r.top >= box.top && r.bottom <= box.bottom,
        bar: document.querySelector("[data-agent-history] [data-session-find]") != null,
    };
})()`;

// ---- the scenario ----------------------------------------------------------------------------------------------------

export default function (_kits) {
    return [
        {
            name: NAME,
            surface: "agent",
            async arrange(h) {
                const ctx = { sessions: buildSessions(Date.now()), lines: buildTranscript() };
                try {
                    ctx.modules = await resolveModules(h);
                    ctx.mock = ctx.modules.urls
                        ? await installMock(h, ctx.modules.urls.api, ctx.sessions, ctx.lines)
                        : `no-module-url (${ctx.modules.error})`;
                } catch (e) {
                    ctx.arrangeError = String(e?.message ?? e);
                }
                return ctx;
            },
            async assert(h, ctx) {
                const steps = [];
                const rec = (step, ok, detail) => steps.push({ step, ok: !!ok, detail: JSON.stringify(detail) });
                // a thrown call (the page went away, a CDP timeout) must not discard the steps recorded so far
                try {
                    const urls = ctx.modules?.urls;
                    rec(
                        `0. the mocked transcript has more lines than the tail, and the page's modules and the mock are in place`,
                        ctx.arrangeError == null && ctx.mock === "ok" && ctx.lines.length > 2000,
                        { arrangeError: ctx.arrangeError, mock: ctx.mock, lines: ctx.lines.length }
                    );
                    if (urls == null || ctx.mock !== "ok") {
                        return steps;
                    }
                    const { result, turnHit, eventHit } = buildResult(ctx.sessions[0]);

                    // History, with the session opened on its tail first: a find that targets it must read it afresh
                    await h.ev(`document.querySelector("[data-agent-history-open]")?.click()`);
                    const historyShown = await until(h, `document.querySelector("[data-agent-history]") != null`);
                    const CARD = `[...document.querySelectorAll("[data-agent-history] button")].find(
                        (b) => b.textContent.includes(${JSON.stringify(SOLO_TITLE)}) && !b.hasAttribute("aria-pressed")
                    )`;
                    await until(h, CARD);
                    await h.ev(`${CARD}?.click()`);
                    const tail = await readWhen(h, (r) => r.transcript && r.endsWithReply);
                    const tailAsks = await mockAsks(h);
                    await shot(h, "0-tail");
                    rec(
                        "0b. History opens the session on its tail (2,000 lines), with no find bar",
                        historyShown === true &&
                            tail.transcript &&
                            tail.endsWithReply &&
                            !tail.bar &&
                            tailAsks?.some((a) => a.maxlines === 2000),
                        { tail, asks: tailAsks }
                    );

                    // 1. a turn hit at the first match, which the tail does not hold
                    await openHit(h, urls, result, turnHit);
                    const s1 = await readWhen(
                        h,
                        (r) => r.pos === `1 / ${MATCHES}` && r.current === 1 && r.visible && !r.clipped
                    );
                    const asks1 = await mockAsks(h);
                    await shot(h, "1-first-hit");
                    rec(
                        `1. opening a turn hit reads the whole transcript and shows the find bar at 1 / ${MATCHES} (the tail holds ${TAIL_MATCHES}): the first turn's match is painted, current and in view, its clamped prompt opened to show it`,
                        s1.bar &&
                            s1.pos === `1 / ${MATCHES}` &&
                            s1.focused &&
                            s1.current === 1 &&
                            s1.all + s1.current === MATCHES &&
                            s1.currentText?.toLowerCase() === TERM &&
                            s1.inEntry?.startsWith("Please add a") &&
                            s1.more === "Show less" &&
                            !s1.clipped &&
                            s1.visible &&
                            s1.items > 200 &&
                            asks1?.some((a) => a.maxlines === -1),
                        { find: s1, asks: asks1 }
                    );

                    // 2. Enter: the next match, in the long reply further down
                    await keyInFind(h, "Enter");
                    const s2 = await readWhen(
                        h,
                        (r) =>
                            r.pos === `2 / ${MATCHES}` && r.current === 1 && r.visible && r.scrollTop !== s1.scrollTop
                    );
                    await shot(h, "2-enter");
                    rec(
                        `2. Enter moves to 2 / ${MATCHES}: the match in the reply is current, in view, and the view moved to it`,
                        s2.pos === `2 / ${MATCHES}` &&
                            s2.current === 1 &&
                            s2.currentText?.toLowerCase() === TERM &&
                            s2.inNode?.includes(`${TERM} layer`) &&
                            s2.visible &&
                            Math.abs(s2.scrollTop - s1.scrollTop) > 500,
                        { find: s2, was: s1.scrollTop }
                    );

                    // 3. Shift+Enter: back to the first
                    await keyInFind(h, "Enter", true);
                    const s3 = await readWhen(
                        h,
                        (r) =>
                            r.pos === `1 / ${MATCHES}` && r.current === 1 && r.visible && r.scrollTop !== s2.scrollTop
                    );
                    await shot(h, "3-shift-enter");
                    rec(
                        `3. Shift+Enter goes back to 1 / ${MATCHES} and the view with it`,
                        s3.pos === `1 / ${MATCHES}` &&
                            s3.current === 1 &&
                            s3.inEntry?.startsWith("Please add a") &&
                            s3.visible &&
                            Math.abs(s3.scrollTop - s1.scrollTop) <= 8,
                        { find: s3, first: s1.scrollTop, second: s2.scrollTop }
                    );

                    // 4. refining the query in the bar changes the count
                    await setQuery(h, `"${TERM} stripes"`);
                    const s4 = await readWhen(h, (r) => r.pos === "1 / 1" && r.current === 1 && r.visible);
                    await shot(h, "4-refined");
                    rec(
                        `4. refining the query to "${TERM} stripes" changes the count from ${MATCHES} to 1, the phrase painted as one match`,
                        s4.pos === "1 / 1" &&
                            s4.all + s4.current === 1 &&
                            s4.currentText?.toLowerCase() === `${TERM} stripes` &&
                            s4.visible,
                        { find: s4 }
                    );

                    // 5. a query with no match in the transcript
                    await setQuery(h, "qqqnomatch");
                    const s5 = await readWhen(h, (r) => r.pos === "No matches");
                    await shot(h, "5-no-matches");
                    rec(
                        "5. a query the transcript does not hold reads No matches, with nothing painted and the step buttons off",
                        s5.pos === "No matches" &&
                            s5.all === 0 &&
                            s5.current === 0 &&
                            s5.stepDisabled.length === 2 &&
                            s5.stepDisabled.every(Boolean),
                        { find: s5 }
                    );

                    // 6. Esc closes the bar and the transcript stays where it is
                    await keyInFind(h, "Escape");
                    const s6 = await readWhen(h, (r) => !r.bar);
                    const atom6 = await readFindAtom(h, urls);
                    await shot(h, "6-closed");
                    rec(
                        "6. Esc closes the find bar and clears its highlights; the transcript stays, whole, at the same place",
                        !s6.bar &&
                            atom6 == null &&
                            s6.all === 0 &&
                            s6.current === 0 &&
                            s6.transcript &&
                            s6.items === s5.items &&
                            s6.scrollTop === s5.scrollTop,
                        { find: s6, before: { items: s5.items, scrollTop: s5.scrollTop }, atom: atom6 }
                    );

                    // 7. an event hit opens the Activity view with the event outlined and in view
                    await openHit(h, urls, result, eventHit);
                    let s7 = null;
                    for (const t0 = Date.now(); Date.now() - t0 < STAGE_WAIT_MS; ) {
                        s7 = await h.ev(READ_EVENT_MARK);
                        if (s7.marked > 0 && s7.visible) break;
                        await nap(150);
                    }
                    await nap(SETTLE_MS);
                    s7 = await h.ev(READ_EVENT_MARK);
                    await shot(h, "7-event");
                    rec(
                        "7. an event hit opens the Activity view with that event outlined (aria-current) and scrolled into view",
                        s7.view === "Activity" &&
                            s7.marked === 1 &&
                            s7.text.includes(EVENT_TEXT) &&
                            s7.visible &&
                            !s7.bar,
                        { event: s7 }
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
                await step("remove the mock", () => removeMock(h));
                // the find, the selection and History's loaded sessions live in the page: a reload hands the next scenario a fresh one
                await step("reload onto the live data", async () => {
                    if (!(await reload(h)))
                        console.error(`${NAME} teardown: the page did not come back after the reload`);
                });
                await step("leave on the Cockpit", () => h.goto("cockpit"));
            },
        },
    ];
}
