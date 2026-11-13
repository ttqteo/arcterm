// sidebar-columns: the Agent sidebar's rows at 280px with RAM · tokens · age in three fixed cells at the end of every
// agent's, lead's and worker's second line (docs/superpowers/specs/2026-11-13-sidebar-declutter-design.md; prototype
// .superpowers/design/sidebar-declutter/project/A-cot-thang-hang.dc.html). The roster is a fixture (devMockAgentsAtom):
// an agent with an unread turn, a lead whose run has a dag (its task strip and a worker row under it), a second lead
// with no dag and no RAM reading, an agent asking, and a working agent that started both runs (its `2 runs` chip) and
// holds 1.6 GB. The runs and the dag are pushed into the page's object store as waveobj:updates, as
// project-overview-history does; the RAM is a pinned Resource Manager snapshot (window.__resmonFixture); the tokens come
// from a temp transcript per agent. Nothing is started and nothing outside the temp dir is written. kit is
// scenarios.mjs's RT_KIT (polishWaitFor, polishNap, ahReload).

import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import * as AC from "./agent-page-fixtures.mjs";

const NAME = "sidebar-columns";
const PROJECT = "verify-sidebar-columns";
const RUN = "sdcols-run";
const RUN2 = "sdcols-run-2";
const CHILD = "sdcols-child";
const DAG = "sdcols-dag";
const FIELDS_KEY = "agent.row.fields";
const MB = 1024 * 1024;

// the rows the columns are measured across, by roster id
const IDS = {
    unread: "fx-sdcols-unread",
    lead: "fx-sdcols-lead",
    worker: "fx-sdcols-w1",
    ask: "fx-sdcols-ask",
    origin: "fx-sdcols-origin",
    lead2: "fx-sdcols-lead2",
};
const BLOCK = (id) => id.replace("fx-", "fx-blk-");
// the RAM each block holds in the pinned snapshot; lead2 has none, so its RAM cell is the empty one
const RAM = {
    [IDS.unread]: 820 * MB,
    [IDS.lead]: 401 * MB,
    [IDS.worker]: 200 * MB,
    [IDS.ask]: 310 * MB,
    [IDS.origin]: Math.round(1.6 * 1024 * MB),
};
// each transcript's one usage turn: input + output + cache read + cache creation is the row's token total
const TOKENS = {
    [IDS.unread]: 7_900_000,
    [IDS.lead]: 12_200_000,
    [IDS.worker]: 1_400_000,
    [IDS.ask]: 3_400_000,
    [IDS.origin]: 96_300_000,
};

// a transcript whose one assistant turn carries `total` tokens of usage, then a user turn, so it reads as one session
function writeTranscript(dir, id, total) {
    const path = join(dir, `${id}.jsonl`);
    const usageTurn = JSON.stringify({
        type: "assistant",
        timestamp: new Date().toISOString(),
        requestId: `req_${id}`,
        message: {
            id: `msg_${id}`,
            role: "assistant",
            model: "claude-opus-4-1",
            usage: { input_tokens: 1000, output_tokens: 1000, cache_read_input_tokens: total - 3000, cache_creation_input_tokens: 1000 },
        },
    });
    const userTurn = JSON.stringify({ type: "user", message: { role: "user", content: "go on" } });
    writeFileSync(path, `${usageTurn}\n${userTurn}\n`);
    return path;
}

function roster(dir, now) {
    const t = (id) => (TOKENS[id] != null ? { transcriptPath: writeTranscript(dir, id, TOKENS[id]) } : {});
    const base = (id, name, extra) => ({ id, name, project: PROJECT, agent: "claude", model: "opus", blockId: BLOCK(id), ...t(id), ...extra });
    return [
        base(IDS.origin, "origin builder", { task: "started two runs", state: "working", activeMs: 3 * 3_600_000, stateSince: now - 3 * 3_600_000 }),
        base(IDS.unread, "unread scribe", { task: "wrote the notes", state: "idle", idleSince: now - 120_000 }),
        base(IDS.lead, "columns lead", { task: "line the columns up", state: "working", activeMs: 300_000, runId: RUN }),
        base(IDS.worker, "columns worker", {
            project: "sdcols0001-t-1",
            task: "Row cells",
            state: "working",
            model: "sonnet",
            activeMs: 60_000,
            stateSince: now - 60_000,
            runId: CHILD,
        }),
        base(IDS.ask, "asking picker", { task: "pick a branch", state: "asking", blockedMs: 60_000 }),
        base(IDS.lead2, "planning lead", { task: "plan the rest", state: "idle", idleSince: now - 300_000, runId: RUN2 }),
    ];
}

// the two runs the origin agent started, the worker's run, and the first run's dag, as a pushed waveobj:update puts them
// into the page's object store
async function publishRuns(h, ctx, now) {
    const run = (id, body) => ({
        otype: "run",
        oid: id,
        version: 1,
        meta: {},
        id,
        channeloid: ctx.channelId,
        goal: "Line the columns up",
        runtime: "claude",
        workspaceid: "",
        projectpath: ctx.dir,
        status: "executing",
        phases: [],
        createdts: now - 3_600_000,
        ...body,
    });
    const objects = [
        run(RUN, { mode: "orchestrator", dagoref: DAG, origintabid: IDS.origin }),
        run(RUN2, { mode: "orchestrator", goal: "Plan the rest", status: "planning", origintabid: IDS.origin, createdts: now - 600_000 }),
        run(CHILD, { mode: "quick", goal: "Row cells", dagoref: DAG }),
        {
            otype: "dag",
            oid: DAG,
            version: 1,
            meta: {},
            id: DAG,
            runid: RUN,
            channelid: ctx.channelId,
            title: "Line the columns up",
            parallelism: 2,
            tasks: [
                { id: "t-1", label: "Row cells", state: "running", runid: CHILD, deps: [], spawnedts: now - 60_000 },
                { id: "t-2", label: "Width", state: "done", merged: true, deps: [] },
                { id: "t-3", label: "Scenario", state: "pending", deps: ["t-1"] },
            ],
            status: "running",
            failures: 0,
            createdts: now - 3_600_000,
            updatedts: now,
        },
    ];
    for (const o of objects) {
        await h.rpc("eventpublish", {
            event: "waveobj:update",
            scopes: [`${o.otype}:${o.oid}`],
            data: { updatetype: "update", otype: o.otype, oid: o.oid, obj: o },
        });
    }
}

function snapshot(now) {
    return {
        supported: true,
        ready: true,
        ts: now,
        cpu: 5,
        mem: 8 * 1024 * MB,
        totalmem: 16 * 1024 * MB,
        busycpu: false,
        busymem: false,
        groups: Object.entries(RAM).map(([id, mem]) => ({
            key: `g-${id}`,
            ownerkind: "block",
            ownerid: BLOCK(id),
            label: id,
            killable: true,
            cpu: 1,
            mem,
            rows: [],
        })),
    };
}

// Runs IN THE PAGE: each row's cells, the tree's width, the unread badge's line, the ask note's place and the colours
// the theme gives the warning and the faint ink, as the browser computes them
const readRows = (ids) => `(() => {
    const tree = document.querySelector("[data-agent-tree]");
    const colorOf = (v) => {
        const probe = document.createElement("span");
        probe.style.color = "var(" + v + ")";
        document.body.appendChild(probe);
        const c = getComputedStyle(probe).color;
        probe.remove();
        return c;
    };
    const flat = (el) => (el?.textContent ?? "").replace(/\\s+/g, " ").trim();
    const rows = {};
    for (const id of ${JSON.stringify(ids)}) {
        const row = document.querySelector('[data-agent-tree] [data-agent-row="' + id + '"]');
        if (!row) {
            rows[id] = null;
            continue;
        }
        const group = row.querySelector("[data-row-cols]");
        const line = group?.parentElement ?? null;
        // the name is the row's first truncating span, on its first line
        const nameLine = row.querySelector("span.truncate")?.parentElement ?? null;
        const unread = row.querySelector("[data-agent-unread]");
        const note = row.querySelector("[data-agent-ask-note]");
        rows[id] = {
            text: flat(row),
            cells: [...(group?.querySelectorAll("[data-row-col]") ?? [])].map((c) => {
                const r = c.getBoundingClientRect();
                return {
                    key: c.dataset.rowCol,
                    text: flat(c),
                    right: Math.round(r.right),
                    width: Math.round(r.width),
                    warn: c.hasAttribute("data-row-col-warn"),
                    color: getComputedStyle(c).color,
                };
            }),
            overflow: line ? line.scrollWidth > line.clientWidth + 1 : null,
            unreadOnName: unread ? unread.parentElement === nameLine && !line?.contains(unread) : null,
            note: note
                ? { text: flat(note), leftOfCols: Math.round(note.getBoundingClientRect().right) <= Math.round(group.getBoundingClientRect().left) }
                : null,
            strip: row.querySelector("[role=img]")?.getAttribute("aria-label") ?? null,
        };
    }
    return {
        width: tree ? Math.round(tree.getBoundingClientRect().width) : null,
        warning: colorOf("--color-warning"),
        faint: colorOf("--color-ink-faint"),
        rows,
    };
})()`;

export default function (kit) {
    const { polishWaitFor, polishNap, ahReload } = kit;
    return [
        {
            name: NAME,
            surface: "agent",
            async arrange(h) {
                const ctx = { dir: mkdtempSync(join(tmpdir(), "verify-sidebar-columns-")) };
                // a throw past this point still returns ctx, so teardown removes whatever was already made
                try {
                    ctx.prevFields = await h.ev(`localStorage.getItem(${JSON.stringify(FIELDS_KEY)})`);
                    // every field on, as a fresh install has them
                    await h.ev(`localStorage.removeItem(${JSON.stringify(FIELDS_KEY)})`);
                    if (!(await ahReload(h))) throw new Error("the page did not come back after the reload");
                    mkdirSync(join(ctx.dir, "repo"), { recursive: true });
                    ctx.channelId = (await h.rpc("createchannel", { name: PROJECT, projectpath: join(ctx.dir, "repo") })).oid;
                    await h.goto("agent");
                    const now = Date.now();
                    await AC.setRoster(h, roster(ctx.dir, now));
                    ctx.rostered = true;
                    if (!(await polishWaitFor(h, `!!document.querySelector('[data-agent-row="${IDS.lead}"]')`, 15000))) {
                        throw new Error("the fixture roster's rows did not show");
                    }
                    // the rows' first reads of the runs (not found) land before the objects are pushed, not after them
                    await polishNap(1000);
                    await publishRuns(h, ctx, now);
                    await h.ev(`window.__resmonFixture.set(${JSON.stringify(snapshot(now))})`);
                    ctx.pinned = true;
                } catch (e) {
                    ctx.arrangeError = String(e?.message ?? e);
                }
                return ctx;
            },
            async assert(h, ctx) {
                const steps = [];
                const rec = (step, ok, detail) =>
                    steps.push({ step, ok: ok === true, detail: typeof detail === "string" ? detail : JSON.stringify(detail) });
                if (ctx.arrangeError != null) {
                    rec("0. the fixture roster, runs and pinned snapshot", false, ctx.arrangeError);
                    return steps;
                }
                try {
                    // the lead nests once its run and dag are read, and the origin agent's chip counts both runs
                    const nested = await polishWaitFor(
                        h,
                        `!!document.querySelector('[data-agent-row="${IDS.lead}"] [role=img]') &&
                         (document.querySelector('[data-agent-row="${IDS.origin}"]')?.textContent ?? "").includes("2 runs") &&
                         !!document.querySelector('[data-agent-row="${IDS.worker}"]')`,
                        15000
                    );
                    await polishWaitFor(h, `!!document.querySelector('[data-agent-ram="${IDS.origin}"]')`, 8000);
                    // the unread mark goes on last: the tracker keeps a count it did not set while the agent is not viewed
                    const unreadSet = await AC.agentPage(
                        h,
                        `const U = await mod("app/view/agents/unreadagentsstore.ts");
                        globalStore.set(U.unreadAgentsAtom, new Map([[${JSON.stringify(IDS.unread)}, 2]]));
                        return await until(() => !!document.querySelector('[data-agent-row="${IDS.unread}"] [data-agent-unread]'), 5000);`
                    );
                    // the tokens are read from the transcripts on a poll of their own
                    await polishWaitFor(
                        h,
                        `(document.querySelector('[data-agent-row="${IDS.origin}"] [data-row-col="tokens"]')?.textContent ?? "") !== ""`,
                        10000
                    );
                    await polishNap(300);
                    const got = await h.ev(readRows(Object.values(IDS)));
                    await h.shot(`cdp-shots/${NAME}-1-rows.png`);
                    const rows = Object.values(IDS).map((id) => got.rows[id]);

                    rec("1. the Agent sidebar is 280px wide", got.width === 280, { width: got.width });

                    rec(
                        "2. every fixture row (agent, unread agent, lead, worker, asking agent, origin agent, lead without a dag) is in the tree, the lead nested on its run with its task strip and the origin agent reading `2 runs`",
                        nested && rows.every((r) => r != null) && /of 3 tasks done/.test(got.rows[IDS.lead]?.strip ?? "") && (got.rows[IDS.origin]?.text ?? "").includes("2 runs"),
                        { nested, present: Object.fromEntries(Object.entries(got.rows).map(([id, r]) => [id, r != null])), strip: got.rows[IDS.lead]?.strip }
                    );

                    const keysOk = rows.every((r) => r != null && r.cells.map((c) => c.key).join(",") === "ram,tokens,age");
                    const edges = Object.fromEntries(
                        ["ram", "tokens", "age"].map((k) => [k, rows.filter(Boolean).map((r) => r.cells.find((c) => c.key === k)?.right ?? null)])
                    );
                    const lined = Object.values(edges).every((xs) => xs.every((x) => x != null) && Math.max(...xs) - Math.min(...xs) <= 1);
                    rec(
                        "3. every row ends its second line with RAM · tokens · age, and each column's right edge is the same on every row (within 1px)",
                        keysOk && lined,
                        { edges, cells: Object.fromEntries(Object.entries(got.rows).map(([id, r]) => [id, r?.cells.map((c) => `${c.key}:${c.text}`)])) }
                    );

                    const lead2Ram = got.rows[IDS.lead2]?.cells.find((c) => c.key === "ram");
                    rec(
                        "4. a row with no RAM reading keeps an empty RAM cell at its full width, so its tokens and age stay in their columns",
                        lead2Ram != null && lead2Ram.text === "" && lead2Ram.width >= 40,
                        { lead2Ram }
                    );

                    const ramCells = Object.fromEntries(Object.entries(got.rows).map(([id, r]) => [id, r?.cells.find((c) => c.key === "ram") ?? null]));
                    const originRam = ramCells[IDS.origin];
                    const othersPlain = Object.entries(ramCells)
                        .filter(([id]) => id !== IDS.origin)
                        .every(([, c]) => c != null && !c.warn && c.color === got.faint);
                    const numbersFaint = rows.filter(Boolean).every((r) => r.cells.filter((c) => c.key !== "ram").every((c) => c.color === got.faint));
                    rec(
                        "5. the origin agent's RAM, 1.6 GB, is in the warning colour; every other RAM cell and every token and age cell is in the faint ink",
                        originRam?.text === "1.6 GB" && originRam.warn && originRam.color === got.warning && othersPlain && numbersFaint,
                        { originRam, warning: got.warning, faint: got.faint, ramCells }
                    );

                    const unreadRow = got.rows[IDS.unread];
                    rec(
                        "6. the unread count sits at the end of the agent's name line, not among the columns",
                        unreadSet === true && unreadRow?.unreadOnName === true,
                        { unreadSet, unreadOnName: unreadRow?.unreadOnName }
                    );

                    const askRow = got.rows[IDS.ask];
                    rec(
                        "7. the asking agent keeps its three columns, with `asking` in words at the left of its second line",
                        askRow != null && askRow.cells.length === 3 && askRow.note?.text === "asking" && askRow.note.leftOfCols === true,
                        { note: askRow?.note, cells: askRow?.cells.length }
                    );

                    rec(
                        "8. no row's second line spills past the row",
                        rows.every((r) => r != null && r.overflow === false),
                        Object.fromEntries(Object.entries(got.rows).map(([id, r]) => [id, r?.overflow]))
                    );
                } catch (e) {
                    rec("the steps ran to the end", false, String(e?.message ?? e));
                }
                return steps;
            },
            // best-effort, so one failed step does not strand the rest
            async teardown(h, ctx) {
                const step = async (what, fn) => {
                    try {
                        await fn();
                    } catch (e) {
                        console.error(`${NAME} teardown: ${what} failed: ${e?.message ?? e}`);
                    }
                };
                if (ctx.pinned) await step("unpin the snapshot", () => h.ev(`window.__resmonFixture?.clear()`));
                if (ctx.rostered) await step("restore the roster", () => AC.restoreRoster(h));
                if (ctx.channelId) await step("delete the channel", () => h.rpc("deletechannel", { channelid: ctx.channelId }));
                await step("restore the row fields", () =>
                    h.ev(
                        ctx.prevFields == null
                            ? `localStorage.removeItem(${JSON.stringify(FIELDS_KEY)})`
                            : `localStorage.setItem(${JSON.stringify(FIELDS_KEY)}, ${JSON.stringify(ctx.prevFields)})`
                    )
                );
                // the pushed runs live only in the page's object store: the reload drops them
                await step("reload onto the live roster", () => ahReload(h));
                await step("remove the temp dir", () => rmSync(ctx.dir, { recursive: true, force: true, maxRetries: 20, retryDelay: 500 }));
                await step("go home", () => h.goto("cockpit"));
            },
        },
    ];
}
