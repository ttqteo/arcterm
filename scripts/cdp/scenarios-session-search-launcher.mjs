// session-search-launcher: the magnifier and filter box in the New agent dialog's Project and Session columns
// (spec docs/superpowers/specs/2026-11-17-session-search-design.md; board A of the `session-search` canvas). One scenario,
// `session-search-launcher`: it answers `searchsessions`, `getrecentsessions` and `getsessionpeek` in-page through
// RpcApi.setMockRpcClient, so it never depends on the developer's transcripts, and registers two temp projects the way
// launcher-resume does. It never presses Launch or Resume. kit is scenarios.mjs's KAEL_KITS ({ rt, code, files, jarvis }).

import { mkdtempSync, rmSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { agentPage } from "./agent-page-fixtures.mjs";

const PROJECT_A = "verify-ssl-alpha";
const PROJECT_B = "verify-ssl-beta";
// the filter that keeps project A alone
const PROJECT_QUERY = "ssl-alpha";
const SESSION_QUERY = "sidecar";
const RECENT_PROJECTS_KEY = "agent.launch.recentprojects";
const MOCK_KEY = "__arcSessionSearchMock";
const VIEWPORT = { width: 1600, height: 950, deviceScaleFactor: 1, mobile: false };
const MIN = 60_000;

const LAUNCHER = `document.querySelector('[data-launcher]')`;
const OPEN_NEW_AGENT = `(() => {
    const mac = /Mac/.test(navigator.platform);
    document.dispatchEvent(new KeyboardEvent('keydown', {
        key: 'n', code: 'KeyN', shiftKey: false, ctrlKey: !mac, metaKey: mac, bubbles: true,
    }));
    return true;
})()`;

// real key events, so a key reaches the dialog the way a person's does
const KEYS = {
    Escape: { code: "Escape", keyCode: 27 },
    ArrowDown: { code: "ArrowDown", keyCode: 40 },
    "/": { code: "Slash", keyCode: 191 },
};
async function press(h, key, nap, { type = false } = {}) {
    const spec = KEYS[key] ?? (/^[0-9]$/.test(key) ? { code: `Digit${key}`, keyCode: 48 + Number(key) } : null);
    if (spec == null) throw new Error(`press: no key spec for ${key}`);
    for (const event of [type ? "keyDown" : "rawKeyDown", "keyUp"]) {
        await h.cdp("Input.dispatchKeyEvent", {
            type: event,
            key,
            code: spec.code,
            windowsVirtualKeyCode: spec.keyCode,
            modifiers: 0,
            ...(type && event === "keyDown" ? { text: key } : {}),
        });
    }
    await nap(150);
}

// sets a field the way React reads typing: through its own prototype's value setter, then an input event
const setField = (elExpr, value) => `(() => {
    const el = ${elExpr};
    if (!el) return false;
    Object.getOwnPropertyDescriptor(Object.getPrototypeOf(el), 'value').set.call(el, ${JSON.stringify(value)});
    el.dispatchEvent(new Event('input', { bubbles: true }));
    return true;
})()`;

// what the Project column shows: its header, its box and the rows it lists
const projectState = `(() => {
    const d = ${LAUNCHER};
    const col = d?.querySelector('[data-launcher-column="project"]');
    if (!col) return null;
    const flat = (el) => (el?.textContent ?? '').replace(/\\s+/g, ' ').trim();
    const magnifier = col.querySelector('[data-launcher-search-open="project"]');
    const box = col.querySelector('[data-launcher-search="project"]');
    const active = document.activeElement;
    return {
        magnifier: !!magnifier,
        magnifierLabel: magnifier?.getAttribute('aria-label') ?? null,
        header: magnifier ? flat(magnifier.parentElement) : null,
        box: !!box,
        boxInput: box?.querySelector('input')?.value ?? null,
        boxFocused: !!box && active === box.querySelector('input'),
        boxHint: box ? flat(box) : null,
        close: !!box?.querySelector('[data-launcher-search-close]'),
        oldFilter: !!col.querySelector('[data-launcher-filter]'),
        rows: [...col.querySelectorAll('[data-project-row]')].map((r) => r.getAttribute('data-project-row')),
        picked: col.querySelector('[data-project-row][aria-checked="true"]')?.getAttribute('data-project-row') ?? null,
        focus: active?.getAttribute('data-launcher-column') ?? null,
        open: !!d,
    };
})()`;

// what the Session column shows: its header, its box, the title rows and the content group
const sessionState = `(() => {
    const d = ${LAUNCHER};
    const col = d?.querySelector('[data-launcher-column="third"]');
    if (!col) return null;
    const flat = (el) => (el?.textContent ?? '').replace(/\\s+/g, ' ').trim();
    const magnifier = col.querySelector('[data-launcher-search-open="session"]');
    const box = col.querySelector('[data-launcher-search="session"]');
    const list = col.querySelector('[data-launcher-resume]');
    const active = document.activeElement;
    const key = (r) => flat(r.querySelector('.font-mono'));
    const primary = [...(d?.querySelectorAll('button') ?? [])].map((b) => flat(b)).find((t) => /^(Resume agent|Launch agent)/.test(t)) ?? null;
    return {
        list: !!list,
        magnifier: !!magnifier,
        header: magnifier ? flat(magnifier.parentElement) : null,
        box: !!box,
        boxInput: box?.querySelector('input')?.value ?? null,
        boxFocused: !!box && active === box.querySelector('input'),
        boxHint: box ? flat(box) : null,
        newKey: key(list?.querySelector('[data-resume-new]') ?? document.body),
        newPicked: list?.querySelector('[data-resume-new]')?.getAttribute('aria-checked') === 'true',
        titles: [...(list?.querySelectorAll('[data-resume-id]') ?? [])].map((r) => ({
            id: r.getAttribute('data-resume-id'),
            text: flat(r),
            key: key(r),
            on: r.getAttribute('aria-checked') === 'true',
            marks: r.querySelectorAll('[data-search-mark]').length,
        })),
        label: flat(list?.querySelector('[data-resume-content-label]')) || null,
        content: [...(list?.querySelectorAll('[data-resume-content-id]') ?? [])].map((r) => ({
            id: r.getAttribute('data-resume-content-id'),
            title: flat(r.querySelector('span.truncate')),
            age: flat(r.querySelector('[data-resume-age]')),
            snippet: flat(r.querySelector('[data-search-snippet]')),
            marks: [...r.querySelectorAll('[data-search-snippet] [data-search-mark]')].map((m) => flat(m)),
            key: key(r),
            on: r.getAttribute('aria-checked') === 'true',
        })),
        empty: flat(col.querySelector('[data-resume-search-empty]')) || null,
        error: flat(col.querySelector('[data-resume-search-error]')) || null,
        step: !!d?.querySelector('[data-launcher-step="resume"]'),
        peek: d?.querySelector('[data-launcher-peek]')?.getAttribute('data-peek-session') ?? null,
        primary,
        focusInList: !!list && list.contains(active),
        focusRow: active?.getAttribute?.('data-resume-content-id') ?? active?.getAttribute?.('data-resume-id') ?? (active?.hasAttribute?.('data-resume-new') ? 'new' : null),
    };
})()`;

// answers searchsessions, getrecentsessions and getsessionpeek with the fixture (counting the searches) and delegates every
// other command to what was there. state.mode: "results" (the fixture's), "empty" or "error"; state.incomplete marks an
// answer still indexing; state.delay is how long an answer takes, so a step can see what shows before it.
function installMock(h, fixture) {
    return agentPage(
        h,
        `const { RpcApi } = await mod("app/store/wshclientapi.ts");
        if (window.${MOCK_KEY}) return "already-installed";
        const prev = RpcApi.mockClient ?? null;
        const fx = ${JSON.stringify(fixture)};
        const state = { mode: "results", incomplete: false, delay: 600, queries: [] };
        const norm = (p) => String(p ?? "").split(String.fromCharCode(92)).join("/").replace(/[/]+$/, "").toLowerCase();
        const terms = (q) => String(q ?? "").toLowerCase().split(/\\s+/).filter(Boolean);
        const mock = {
            async mockWshRpcCall(client, command, data, opts) {
                if (command === "searchsessions") {
                    state.queries.push({ query: data.query, runtime: data.runtime, projectpath: data.projectpath });
                    await new Promise((r) => setTimeout(r, state.delay));
                    if (state.mode === "error") throw new Error("digest store unavailable");
                    return {
                        results: state.mode === "empty" ? [] : fx.results,
                        terms: terms(data.query),
                        incomplete: state.incomplete,
                    };
                }
                if (command === "getrecentsessions") {
                    const here = fx.recent.filter((s) => s.runtime === data.runtime && norm(s.projectpath) === norm(data.projectpath));
                    // an agent with no search (codex, opencode, agy) gets one session of its own, so its list draws
                    const own = { ...fx.recent[0], id: "ss-" + data.runtime, runtime: data.runtime, task: "A " + data.runtime + " session" };
                    const sessions = here.length > 0 || data.runtime === "claude" || norm(data.projectpath) !== norm(fx.recent[0].projectpath) ? here : [own];
                    return { sessions, nextcursor: "" };
                }
                if (command === "getsessionpeek") {
                    return { messages: [], capped: false, before: 0, answered: false };
                }
                return prev ? prev.mockWshRpcCall(client, command, data, opts) : client.wshRpcCall(command, data, opts);
            },
            mockWshRpcStream(client, command, data, opts) {
                return prev ? prev.mockWshRpcStream(client, command, data, opts) : client.wshRpcStream(command, data, opts);
            },
        };
        window.${MOCK_KEY} = { api: RpcApi, prev, state };
        RpcApi.setMockRpcClient(mock);
        return "ok";`
    );
}

const removeMock = (h) =>
    h.ev(`(() => {
        const f = window.${MOCK_KEY};
        if (!f) return "absent";
        f.api.setMockRpcClient(f.prev);
        delete window.${MOCK_KEY};
        return "restored";
    })()`);

const mockState = (patch) =>
    `(() => { const f = window.${MOCK_KEY}; if (!f) return false; Object.assign(f.state, ${JSON.stringify(patch)}); return true; })()`;

// one hit: the snippet, and the [start, end) range of `word` in it
function hit(text, word, ord) {
    const at = text.indexOf(word);
    return { kind: "turn", speaker: "user", ord, text, marks: [[at, at + word.length]] };
}

// The fixture the mock answers with. Project A's loaded sessions: one whose title holds the query and one that matches
// nothing. The search answers three: the loaded title match (it also has a hit), and two that only the content holds and
// no loaded page does, so picking one is found only through the search.
function buildFixture(dir) {
    const now = Date.now();
    const info = (id, task, ageMin) => ({
        id,
        runtime: "claude",
        projectpath: dir,
        projectname: PROJECT_A,
        branch: "main",
        task,
        model: "",
        tokenstotal: 0,
        lastactivets: now - ageMin * MIN,
        resumecommand: `claude --resume ${id}`,
        transcriptpath: join(dir, `${id}.jsonl`),
    });
    const result = (s, hits) => ({
        session: { ...s, status: "ended", startedts: s.lastactivets - 5 * MIN, durationms: 5 * MIN, events: [] },
        hits,
        turnhits: hits.length,
        eventhits: 0,
    });
    const titleMatch = info("ss-title", "Fix the sidecar window", 2);
    const unrelated = info("ss-unrelated", "Tidy the lint config", 40);
    const contentA = info("ss-content-a", "Ideas for arcterm", 7);
    const contentB = info("ss-content-b", "Canvas has no active card", 19);
    return {
        recent: [titleMatch, unrelated],
        results: [
            result(titleMatch, [hit("a sidecar window needs its own tab strip", "sidecar", 0)]),
            result(contentA, [hit("…a sidecar window for the second screen, only the…", "sidecar", 3)]),
            result(contentB, [hit("…the wall of the sidecar keeps the asking card at the top…", "sidecar", 5)]),
        ],
        ids: { title: titleMatch.id, a: contentA.id, b: contentB.id },
    };
}

export default function (kits) {
    const { polishNap, polishWaitFor, polishReload, waitForProjectInConfig } = kits.jarvis;
    const waitFor = (h, expr, ms) => polishWaitFor(h, expr, ms);

    return [
        {
            name: "session-search-launcher",
            surface: "cockpit",
            async arrange(h) {
                const ctx = { dirs: [], projects: [] };
                // a throw past this point still returns ctx, so teardown removes whatever was already made
                try {
                    for (const name of [PROJECT_A, PROJECT_B]) {
                        // not under the temp dir: the session scan drops a session whose project sits there
                        const dir = mkdtempSync(join(homedir(), `.${name}-`));
                        ctx.dirs.push(dir);
                        await h.rpc("createproject", { name, path: dir });
                        ctx.projects.push(name);
                        await waitForProjectInConfig(h, name);
                    }
                    // recent-first puts A on top; the developer's own list is put back in teardown
                    ctx.prevRecent = await h.ev(`localStorage.getItem(${JSON.stringify(RECENT_PROJECTS_KEY)})`);
                    const recent = [PROJECT_A, PROJECT_B, ...JSON.parse(ctx.prevRecent ?? "[]")];
                    await h.ev(
                        `localStorage.setItem(${JSON.stringify(RECENT_PROJECTS_KEY)}, ${JSON.stringify(JSON.stringify(recent))})`
                    );
                    await polishReload(h);
                } catch (e) {
                    ctx.arrangeError = String(e?.message ?? e);
                }
                return ctx;
            },
            async assert(h, ctx) {
                const steps = [];
                const rec = (step, ok, detail) => steps.push({ step, ok, detail });
                if (ctx.arrangeError != null) {
                    rec("0. two projects were registered", false, ctx.arrangeError);
                    return steps;
                }
                const project = () => h.ev(projectState);
                const session = () => h.ev(sessionState);
                const sessionWhen = async (ok, ms = 6000) => {
                    const end = Date.now() + ms;
                    let st = await session();
                    while (!ok(st) && Date.now() < end) {
                        await polishNap(100);
                        st = await session();
                    }
                    return st;
                };
                const startRows = async () => {
                    await h.ev(`${LAUNCHER}?.querySelector('[data-launcher-column="start"]')?.focus()`);
                    await polishNap(100);
                    return (await h.ev(`[...(${LAUNCHER}?.querySelectorAll('[data-start-row]') ?? [])].map((r) => r.getAttribute('data-start-row'))`)) ?? [];
                };
                // Picks a Start row by its digit, focus staying on Start; false when the row is not offered
                const pickStart = async (id) => {
                    const at = (await startRows()).indexOf(id);
                    if (at < 0) return false;
                    if (at > 8) {
                        await h.ev(`${LAUNCHER}?.querySelector('[data-start-row="${id}"]')?.click()`);
                    } else {
                        await press(h, String(at + 1), polishNap);
                    }
                    return waitFor(h, `${LAUNCHER}?.querySelector('[data-start-row="${id}"]')?.getAttribute('aria-checked') === 'true'`, 3000);
                };
                const typeInto = (column, value) =>
                    h.ev(setField(`${LAUNCHER}?.querySelector('[data-launcher-search="${column}"] input')`, value));

                const fixture = buildFixture(ctx.dirs[0]);
                ctx.mock = await installMock(h, { recent: fixture.recent, results: fixture.results });
                if (ctx.mock !== "ok") {
                    rec("0. the in-page mock answered searchsessions", false, String(ctx.mock));
                    return steps;
                }
                await h.cdp("Emulation.setDeviceMetricsOverride", VIEWPORT);
                await h.goto("cockpit");
                await h.ev(OPEN_NEW_AGENT);
                await waitFor(h, `!!${LAUNCHER}`, 5000);
                await polishNap(400);
                const offered = await startRows();
                if (!offered.includes("claude")) {
                    rec("0. the dialog opens with Claude offered", false, JSON.stringify({ offered }));
                    return steps;
                }
                await pickStart("claude");
                // the dialog may start on another project: A is the one the mock's sessions belong to
                await h.ev(`${LAUNCHER}?.querySelector('[data-project-row="${PROJECT_A}"]')?.click()`);
                await waitFor(h, `${LAUNCHER}?.querySelector('[data-project-row="${PROJECT_A}"]')?.getAttribute('aria-checked') === 'true'`, 3000);
                await polishNap(300);
                const total = (await project())?.rows.length ?? 0;

                // 1. the Project column's header carries the magnifier, and no box
                let p = await project();
                await h.shot("cdp-shots/session-search-launcher-1-project-header.png");
                rec(
                    "1. the Project column header shows the magnifier at its right, and no search box",
                    p != null && p.magnifier && p.magnifierLabel === "Search" && /^Project/.test(p.header ?? "") && !p.box && total >= 2,
                    JSON.stringify({ ...p, total })
                );

                // 2. the magnifier swaps the header for a focused box; typing narrows the projects, the count reads "N of M"
                await h.ev(`${LAUNCHER}?.querySelector('[data-launcher-search-open="project"]')?.click()`);
                await waitFor(h, `!!${LAUNCHER}?.querySelector('[data-launcher-search="project"] input')`, 3000);
                await polishNap(150);
                const opened = await project();
                await typeInto("project", PROJECT_QUERY);
                await polishNap(300);
                p = await project();
                await h.shot("cdp-shots/session-search-launcher-2-project-search.png");
                rec(
                    "2. the magnifier shows a box in place of the header, with focus and a ×; typing narrows the projects and the count reads N of M",
                    opened != null &&
                        opened.box &&
                        opened.boxFocused &&
                        opened.close &&
                        !opened.magnifier &&
                        p.boxInput === PROJECT_QUERY &&
                        p.rows.length === 1 &&
                        p.rows[0] === PROJECT_A &&
                        p.boxHint === `1 of ${total}` &&
                        !p.oldFilter,
                    JSON.stringify({ opened, p, total })
                );

                // 3. Escape brings the header back with the full list, focus on the column, the dialog still open
                await press(h, "Escape", polishNap);
                await polishNap(300);
                p = await project();
                await h.shot("cdp-shots/session-search-launcher-3-project-closed.png");
                rec(
                    "3. Esc closes the box and brings the header back with the full list; focus is on the column and the dialog stays open",
                    p != null &&
                        p.open &&
                        !p.box &&
                        p.magnifier &&
                        /^Project/.test(p.header ?? "") &&
                        p.rows.length === total &&
                        p.focus === "project" &&
                        p.picked === PROJECT_A,
                    JSON.stringify(p)
                );

                // 4. the Session column of a claude agent: / opens its box; the title row shows at once, then the content group
                await waitFor(h, `!!${LAUNCHER}?.querySelector('[data-resume-id="${fixture.recent[0].id}"]')`, 8000);
                await h.ev(`${LAUNCHER}?.querySelector('[data-resume-new]')?.focus()`);
                await polishNap(150);
                const before = await session();
                await press(h, "/", polishNap, { type: true });
                await waitFor(h, `!!${LAUNCHER}?.querySelector('[data-launcher-search="session"] input')`, 3000);
                await polishNap(100);
                const boxOpen = await session();
                await typeInto("session", SESSION_QUERY);
                await polishNap(120);
                const early = await session();
                const settled = await sessionWhen((st) => (st?.content.length ?? 0) === 2 && st.boxHint?.includes("content"));
                await h.shot("cdp-shots/session-search-launcher-4-session-search.png");
                const ageOk = (c) => /^(just now|\d+[mhd])$/.test(c.age);
                rec(
                    "4. in the Session column / opens the box; the title row shows at once, then Matched by content holds two rows with a marked snippet and an age each, and the hint reads 1 title · 2 content",
                    before?.list &&
                        before.magnifier &&
                        boxOpen?.box &&
                        boxOpen.boxFocused &&
                        early?.titles.map((t) => t.id).join() === fixture.ids.title &&
                        early.content.length === 0 &&
                        early.label == null &&
                        settled?.label === "Matched by content" &&
                        settled.titles.length === 1 &&
                        settled.titles[0].key === "2" &&
                        settled.titles[0].marks === 1 &&
                        settled.content.map((c) => c.id).join() === [fixture.ids.a, fixture.ids.b].join() &&
                        settled.content.every((c) => c.marks.length >= 1 && c.marks[0] === "sidecar" && ageOk(c)) &&
                        settled.content.map((c) => c.key).join() === "3,4" &&
                        settled.content[0].title === "Ideas for arcterm" &&
                        settled.boxHint === "1 title · 2 content",
                    JSON.stringify({ before: before && { list: before.list, magnifier: before.magnifier }, boxOpen: boxOpen && { box: boxOpen.box, focused: boxOpen.boxFocused }, early, settled })
                );

                // 5. clicking a content row picks it as a title row is picked: its row is checked, and the dialog can resume it
                await h.ev(`${LAUNCHER}?.querySelector('[data-resume-content-id="${fixture.ids.a}"]')?.click()`);
                await waitFor(h, `!!${LAUNCHER}?.querySelector('[data-launcher-step="resume"]')`, 3000);
                const picked = await sessionWhen(
                    (st) => st?.step && st.content.some((c) => c.id === fixture.ids.a && c.on) && st.primary?.startsWith("Resume agent")
                );
                await h.shot("cdp-shots/session-search-launcher-5-content-picked.png");
                rec(
                    "5. clicking a content row picks it: its row is aria-checked, the box and its query stay, and the dialog offers Resume agent for it",
                    picked?.step &&
                        picked.content.some((c) => c.id === fixture.ids.a && c.on) &&
                        picked.content.filter((c) => c.on).length === 1 &&
                        !picked.newPicked &&
                        picked.box &&
                        picked.boxInput === SESSION_QUERY &&
                        picked.primary?.startsWith("Resume agent") &&
                        picked.peek === fixture.ids.a,
                    JSON.stringify(picked)
                );

                // 6. an answer still indexing: the hint ends "indexing…". Back first, to the columns (the step is
                // dismissed): focus in the box must not take the dialog into the step again
                await h.ev(`${LAUNCHER}?.querySelector('[data-launcher-back]')?.click()`);
                await waitFor(h, `!${LAUNCHER}?.querySelector('[data-launcher-step="resume"]') && !!${LAUNCHER}?.querySelector('[data-launcher-column="project"]')`, 3000);
                await h.ev(mockState({ incomplete: true }));
                await h.ev(`${LAUNCHER}?.querySelector('[data-launcher-search="session"] input')?.focus()`);
                await typeInto("session", `${SESSION_QUERY} window`);
                const indexing = await sessionWhen((st) => (st?.boxHint ?? "").endsWith("indexing…"));
                const stillColumns = await session();
                await h.shot("cdp-shots/session-search-launcher-6-indexing.png");
                rec(
                    "6. while the backend is still indexing the hint ends indexing…, and focus in the box leaves the dialog on its columns",
                    (indexing?.boxHint ?? "").endsWith("· indexing…") && indexing.boxHint.startsWith("1 title") && !stillColumns.step && stillColumns.boxFocused,
                    JSON.stringify({ indexing: indexing?.boxHint, step: stillColumns?.step, focused: stillColumns?.boxFocused })
                );
                await h.ev(mockState({ incomplete: false }));

                // 7. a query nothing matches: one line says so, and there are no rows to number
                await h.ev(mockState({ mode: "empty" }));
                await typeInto("session", "zzzqqq");
                const empty = await sessionWhen((st) => st?.empty != null);
                await h.shot("cdp-shots/session-search-launcher-7-no-match.png");
                rec(
                    "7. a query the search answers with nothing shows No sessions match, with no title or content rows",
                    empty?.empty === "No sessions match" && empty.titles.length === 0 && empty.content.length === 0 && empty.label == null && empty.error == null,
                    JSON.stringify(empty)
                );

                // 8. a rejected search: one muted line names the failure, and the title rows still filter
                await h.ev(mockState({ mode: "error" }));
                await typeInto("session", "boom");
                const failed = await sessionWhen((st) => st?.error != null);
                await h.shot("cdp-shots/session-search-launcher-8-search-failed.png");
                rec(
                    "8. a rejected search shows one Search failed: … line under the box",
                    (failed?.error ?? "").startsWith("Search failed:") && failed.error.includes("digest store unavailable") && failed.empty == null && failed.content.length === 0,
                    JSON.stringify({ error: failed?.error, empty: failed?.empty })
                );
                await h.ev(mockState({ mode: "results" }));

                // 9. the box's × closes it and the header is back with the full list; Esc does the same from the rows
                await h.ev(`${LAUNCHER}?.querySelector('[data-launcher-search="session"] [data-launcher-search-close]')?.click()`);
                await polishNap(300);
                const closed = await session();
                await h.shot("cdp-shots/session-search-launcher-9-closed.png");
                rec(
                    "9. the box's × closes it, clears the query and brings the header back with the plain list and no content group",
                    closed != null &&
                        !closed.box &&
                        closed.magnifier &&
                        /^Session/.test(closed.header ?? "") &&
                        closed.label == null &&
                        closed.content.length === 0 &&
                        closed.titles.length === fixture.recent.length &&
                        closed.error == null &&
                        closed.empty == null &&
                        closed.focusInList,
                    JSON.stringify(closed)
                );

                // 10. an agent whose sessions are not searched: its list shows, with no magnifier
                const other = ["codex", "opencode", "agy"].find((id) => offered.includes(id));
                if (other == null) {
                    rec("10. an agent with no search shows no magnifier in the Session column", false, `no codex, opencode or agy is offered: ${JSON.stringify(offered)}`);
                } else {
                    // closing the box put focus back in the list, which takes a picked session into the resume step, where
                    // the Start column is not drawn: Back returns to the columns first
                    if (closed?.step) {
                        await h.ev(`${LAUNCHER}?.querySelector('[data-launcher-back]')?.click()`);
                        await waitFor(h, `!!${LAUNCHER}?.querySelector('[data-launcher-column="start"]')`, 3000);
                    }
                    await pickStart(other);
                    const noSearch = await sessionWhen((st) => st?.list === true && st.titles.length > 0);
                    await h.shot("cdp-shots/session-search-launcher-10-no-search-agent.png");
                    rec(
                        `10. with ${other} picked the Session column lists its sessions and shows no magnifier`,
                        noSearch?.list === true && noSearch.titles.length > 0 && !noSearch.magnifier && !noSearch.box,
                        JSON.stringify({ other, list: noSearch?.list, titles: noSearch?.titles.length, magnifier: noSearch?.magnifier, box: noSearch?.box })
                    );
                }
                // the dialog is closed from Project, where Escape closes it; Launch and Resume are never pressed
                await h.ev(`${LAUNCHER}?.querySelector('[data-launcher-column="project"]')?.focus()`);
                await press(h, "Escape", polishNap);
                return steps;
            },
            async teardown(h, ctx) {
                const step = async (what, fn) => {
                    try {
                        await fn();
                    } catch (e) {
                        console.error(`session-search-launcher teardown: ${what} failed: ${e?.message ?? e}`);
                    }
                };
                await step("remove the in-page mock", () => removeMock(h));
                if (ctx.prevRecent !== undefined) {
                    const key = JSON.stringify(RECENT_PROJECTS_KEY);
                    await step("restore the recent projects", () =>
                        h.ev(
                            ctx.prevRecent === null
                                ? `localStorage.removeItem(${key})`
                                : `localStorage.setItem(${key}, ${JSON.stringify(ctx.prevRecent)})`
                        )
                    );
                }
                for (const name of ctx.projects ?? []) {
                    // the store replaces projects.json by rename, which Windows refuses while something else holds the file
                    await step(`delete ${name}`, async () => {
                        for (let attempt = 1; ; attempt++) {
                            try {
                                return await h.rpc("deleteproject", { name });
                            } catch (e) {
                                if (attempt >= 3) throw e;
                                await polishNap(400);
                            }
                        }
                    });
                }
                // deleteproject leaves the channel createproject made, so the channels at the projects' paths go too
                await step("delete the projects' channels", async () => {
                    const norm = (p) => (p || "").replace(/\\/g, "/").replace(/\/+$/, "").toLowerCase();
                    const dirs = (ctx.dirs ?? []).map(norm);
                    const channels = (await h.rpc("getchannels", null))?.channels ?? [];
                    for (const c of channels.filter((c) => dirs.includes(norm(c.projectpath)))) {
                        await h.rpc("deletechannel", { channelid: c.oid });
                    }
                });
                // the dialog's draft lives in memory; a reload hands the next scenario a fresh one
                await step("reload", async () => {
                    await h.ev("location.reload()");
                    await polishNap(2500);
                });
                for (const dir of ctx.dirs ?? []) {
                    await step("remove a project dir", () => rmSync(dir, { recursive: true, force: true }));
                }
            },
        },
    ];
}
