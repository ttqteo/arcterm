// usage-lens: the Workflow lens on the Usage surface (docs/superpowers/plans/2026-11-12-kael-sync-code-diff-usage-setup.md,
// Task 13; the fork's 81731000e, a78430d79, 212e92228, cc7b84f3d and f5d09f0f2, and its workflow-scan scenario in
// scenarios-usage.mjs). One scenario, `usage-workflow-lens`.
//
// Each lens state is seeded on a deferred quick run's own record (a run that spawns nothing), the way the fork's did, and the
// lens follows the run through WOS. No step clicks an enabled Scan workflow button: that starts a real Opus agent. Ours differs
// from the fork's in what the scan record can hold: the scan's agent asks the owner which fixes to apply (the workflowscan:
// address lands on it), so the record has no picks and the lens has no picks bar, no applying state and no Apply/Drop buttons;
// its cards are read-only findings. The lens finds the seeded run itself (the newest scan among the runs it loads), so the
// scenario writes no atom: that path is the one a fresh start of the app takes.
//
// kit is scenarios.mjs's KAEL_KITS ({ rt, code, files, jarvis }). What it lacks is here: the run-record writer, the address
// hook, the clipboard stub and the page-side module read that reaches the Diff surface's scope.

import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { SURFACE_LABEL } from "./attach.mjs";

const PROJECT = "verify-workflow-lens";
const OTHER_PROJECT = "verify-workflow-lens-other";
const DAY_MS = 24 * 60 * 60 * 1000;
// the host's own window and tab ids are empty in a scenario's UpdateObject, as scenarios.mjs's FINAL_SHOTS_UICTX has them
const UICTX = { windowid: "", activetabid: "" };

const norm = (p) => (p || "").replace(/\\/g, "/").replace(/\/+$/, "").toLowerCase();
const LENS = (kind) => `document.querySelector('[data-workflow-lens="${kind}"]')`;
const SCAN_BUTTON = `document.querySelector('[data-workflow-scan-button]')`;
const DETAIL = (kind) => `document.querySelector('[data-workflow-detail="${kind}"]')`;
const CARD = (id) => `document.querySelector('[data-workflow-card="${id}"]')`;
const COUNT = (sel) => `document.querySelectorAll(${JSON.stringify(sel)}).length`;
const LENS_BUTTON = (label) =>
    `[...document.querySelectorAll('[aria-label="Lens"] button')].find((b) => b.textContent.trim() === ${JSON.stringify(label)})`;
const SELECT = `document.querySelector('[data-workflow-project-select]')`;

// the stage column as [label, phase, fact]
const STAGES = `[...document.querySelectorAll('[data-workflow-stage]')].map((s) => [
    s.getAttribute('data-workflow-stage'),
    s.getAttribute('data-phase'),
    s.querySelector('[data-workflow-stage-fact]')?.textContent.trim() ?? null,
])`;
const ELAPSED = `document.querySelector('[data-workflow-elapsed]')?.textContent.trim() ?? null`;
const ELAPSED_FORMAT = /^\d+s$|^\d+m \d{2}s$/;
const phases = (stages) => JSON.stringify((stages ?? []).map((s) => s[1]));
const fact = (stages, label) => (stages ?? []).find((s) => s[0] === label)?.[2] ?? null;

const openAddressExpr = (address) => `(async () => {
    for (let i = 0; i < 20 && typeof window.__openAddress !== "function"; i++) {
        await new Promise((r) => setTimeout(r, 250));
    }
    if (typeof window.__openAddress !== "function") return { ok: false, why: "no __openAddress hook" };
    return window.__openAddress(${JSON.stringify(address)});
})()`;

// an own property over Clipboard.prototype's: never the real write, which a window without OS focus rejects and which would
// overwrite the user's clipboard
const CLIP_STUB = `(() => {
    window.__lensClip = [];
    navigator.clipboard.writeText = (text) => {
        window.__lensClip.push(text);
        return Promise.resolve();
    };
    return true;
})()`;
const CLIP_RESTORE = `(() => { delete navigator.clipboard.writeText; delete window.__lensClip; return true; })()`;

// the Diff surface's stored scope. The app modules are imported by the urls the dev server serves them at (outside the
// vite root they sit under /@fs/), found from the page's resource timing or, when that buffer has dropped them, from the
// entry script's own source; that is the instance the app uses on a dev server that has not hot-updated them (Final
// starts a fresh one). A page that cannot be read gives null, which the step reports rather than throwing.
const DIFF_ORIGIN = `(async () => {
    try {
        const names = performance.getEntriesByType("resource").map((e) => e.name);
        const hit = names.find((n) => /\\/frontend\\/app\\/store\\/jotaiStore\\.ts(\\?|$)/.test(n));
        let base = hit != null ? hit.replace(/app\\/store\\/jotaiStore\\.ts.*$/, "") : null;
        if (base == null) {
            const main = [...document.querySelectorAll('script[type="module"][src]')].find((s) => /\\/main\\.tsx(\\?|$)/.test(s.src));
            const source = main == null ? "" : await fetch(main.src).then((r) => r.text());
            const m = source.match(/["'](\\/@fs\\/[^"']*?\\/frontend\\/)/);
            base = m == null ? null : new URL(m[1], location.href).href;
        }
        if (base == null) return { error: "no module url" };
        const { globalStore } = await import(base + "app/store/jotaiStore.ts");
        const { diffScopeAtom } = await import(base + "app/view/agents/diffscopeatom.ts");
        const origin = globalStore.get(diffScopeAtom)?.repo.origin;
        return origin == null ? null : { kind: origin.kind, runId: origin.runId, cwd: origin.cwd };
    } catch (e) {
        return { error: String(e?.message ?? e) };
    }
})()`;

// a made-up run id per quote, except p1's first, which is the fixture run itself so its link opens a run that exists
function pattern(ctx, id, title, runs, days, projects, texts) {
    const quotes = texts.map((text, i) => ({
        runid: id === "p1" && i === 0 ? ctx.runId : `${`f0${id}${i}`.padEnd(8, "0")}-0000-4000-8000-000000000000`,
        project: PROJECT,
        date: "2026-10-2" + i,
        text,
    }));
    return { id, title, fixtarget: "AGENTS.md · Plans", runs, days, projects, quotes };
}

function scanRecord(ctx, extra) {
    const now = Date.now();
    return {
        state: "picking",
        stage: "checking",
        project: PROJECT,
        windowdays: 14,
        fromts: now - 14 * DAY_MS,
        tots: now,
        runs: 47,
        projects: 4,
        candidates: 7,
        kept: 5,
        dropped: 0,
        survivors: [
            pattern(ctx, "p1", "Final's dev app starts on an empty store; scenarios read data it lacks", 4, 2, [{ name: PROJECT, runs: 4 }], [
                "Final runs on a fresh empty store (final-verify.mjs gives it a new ARC_DEV_DATA_DIR).",
                "It also expects the modal to open in Project scope, but a fresh final store has no projects.",
                "The scenario read the project list, and the final store had none to read.",
                "Step 3 found no runs: the store Final booted was empty.",
            ]),
            pattern(
                ctx,
                "p2",
                "A skipped red step is filed under Differs from plan, not Not verified",
                11,
                7,
                [
                    { name: "cyber_anomaly_detector", runs: 7 },
                    { name: "cyber_assistant", runs: 2 },
                    { name: PROJECT, runs: 2 },
                ],
                [
                    "Red step skipped: I wrote the tests and then the implementation, and ran Maven once afterwards.",
                    "Step 2 (watch the tests fail first) was not run on its own: the implementation was written first",
                    "The failing run was skipped; the tests were written after the change.",
                ]
            ),
            pattern(ctx, "p3", "Plans put whole-package runs in task steps; no reviewer flags them", 7, 4, [{ name: PROJECT, runs: 7 }], [
                "I ran Step 9's package-wide verify.mjs, although the worker instructions say to skip whole-package runs.",
                "Step 4 says to run `go test ./pkg/jarvis` for the whole package.",
            ]),
            pattern(ctx, "p4", "Untracked plan copy blocks the land", 12, 6, [{ name: PROJECT, runs: 12 }], [
                "The land was held: an untracked copy of the plan sits in the tree.",
            ]),
            pattern(ctx, "p5", "Held-store EPERM line reported", 7, 5, [{ name: PROJECT, runs: 7 }], [
                "EPERM on the held store was reported as a failure again.",
            ]),
        ],
        underfloor: [
            pattern(ctx, "u1", "Plan reviewer cites the wrong spec section", 2, 2, [{ name: PROJECT, runs: 2 }], [
                "The reviewer quoted a section the spec does not have.",
            ]),
            pattern(ctx, "u2", "Setup junction left behind after cleanup", 1, 1, [{ name: PROJECT, runs: 1 }], [
                "The node_modules junction was still there after worktree cleanup.",
            ]),
        ],
        verdicts: [
            {
                id: "p1",
                verdict: "suggest",
                file: "AGENTS.md",
                where: "Plans the engine runs",
                fixproject: PROJECT,
                edit: "+ That app starts on a fresh, empty store: a scenario arranges every record it reads.",
            },
            {
                id: "p2",
                verdict: "suggest",
                file: "pkg/orchestrate/engine.go",
                where: "workerContract",
                fixproject: "waveterm",
                edit: "+ A step the task asked for that you skipped goes under Not verified.",
            },
            {
                id: "p3",
                verdict: "suggest",
                file: "pkg/orchestrate/planreview.go",
                where: "Tests lens",
                fixproject: PROJECT,
                edit: "- no whole-package runs\n+ no task step runs a whole package, the full suite or the plan's Verify;",
                declinedat: 4,
            },
            { id: "p4", verdict: "covered", note: "8bc284e7" },
            { id: "p5", verdict: "covered", note: "f93850e9" },
        ],
        ...extra,
    };
}

export default function (kits) {
    const { waveService, waitForProjectInConfig, polishReload, polishWaitFor, polishNap, teardownFixtureRun } = kits.jarvis;

    // object.UpdateObject publishes nothing, so the stored run is sent to the page as the update it would have been
    async function writeRun(h, runId, change) {
        const oref = `run:${runId}`;
        const next = { ...change(await waveService(h, "object", "GetObject", [oref])), otype: "run" };
        await waveService(h, "object", "UpdateObject", [next, false], UICTX);
        const stored = await waveService(h, "object", "GetObject", [oref]);
        await h.rpc("eventpublish", {
            event: "waveobj:update",
            scopes: [oref],
            data: { updatetype: "update", otype: "run", oid: runId, obj: { ...stored, otype: "run" } },
        });
        return stored;
    }

    // writes the run's record and waits for the lens to draw the state it maps to
    async function seed(h, ctx, kind, change) {
        await writeRun(h, ctx.runId, (run) => change({ ...run, status: ctx.status }));
        return polishWaitFor(h, `!!${LENS(kind)}`, 10000);
    }

    // a scan at the given stage; the lens kind stays scanning across stages, so the wait is on the stage's own pane
    async function seedScanning(h, ctx, stage, extra) {
        const seeded = await seed(h, ctx, "scanning", (run) => ({
            ...run,
            workflowscan: scanRecord(ctx, { state: "scanning", stage, ...extra }),
        }));
        const pane = await polishWaitFor(h, `!!${DETAIL(stage)}`, 10000);
        return seeded && pane;
    }

    const headerEnabled = (h) => h.ev(`${SCAN_BUTTON} ? !${SCAN_BUTTON}.disabled : null`);
    // the head row and its status: text of the status element for the view kind, null when absent
    const head = (h, kind) =>
        h.ev(`({
            head: !!document.querySelector('[data-workflow-head]'),
            headText: document.querySelector('[data-workflow-head]')?.innerText ?? null,
            status: document.querySelector('[data-workflow-status="${kind}"]')?.innerText ?? null,
            elapsed: ${ELAPSED},
        })`);
    const chrome = (h) => h.ev(`({ head: ${COUNT("[data-workflow-head]")}, stage: ${COUNT("[data-workflow-stage]")} })`);

    // leaves the lens and comes back, so it mounts again and looks for the newest scan itself
    async function remountLens(h) {
        await h.ev(`${LENS_BUTTON("By provider")}?.click()`);
        const provider = await polishWaitFor(h, `!!document.querySelector('[data-usage-detail]')`, 10000);
        await h.ev(`${LENS_BUTTON("Workflow")}?.click()`);
        const lens = await polishWaitFor(h, `!!document.querySelector('[data-workflow-lens]')`, 10000);
        return provider && lens;
    }

    const scenario = {
        name: "usage-workflow-lens",
        surface: "usage",
        async arrange(h) {
            const ctx = {
                cwd: mkdtempSync(join(tmpdir(), "verify-workflow-lens-")),
                otherCwd: mkdtempSync(join(tmpdir(), "verify-workflow-lens-other-")),
            };
            try {
                const wslist = await h.rpc("workspacelist", null);
                // two registered projects, so the picker has a choice: the scan run lives in the first, and the second is
                // the active one, so the default the picker shows is the active project's, as the palette's rule has it
                await h.rpc("createproject", { name: PROJECT, path: ctx.cwd });
                ctx.projects = [PROJECT];
                await waitForProjectInConfig(h, PROJECT);
                await h.rpc("createproject", { name: OTHER_PROJECT, path: ctx.otherCwd });
                ctx.projects.push(OTHER_PROJECT);
                await waitForProjectInConfig(h, OTHER_PROJECT);
                const channels = (await h.rpc("getchannels", null))?.channels ?? [];
                const channelAt = (path) => channels.find((c) => norm(c.projectpath) === norm(path))?.oid;
                ctx.channelId = channelAt(ctx.cwd);
                ctx.otherChannelId = channelAt(ctx.otherCwd);
                if (!ctx.channelId || !ctx.otherChannelId) throw new Error("createproject made no channel at a project's path");
                const created = await h.rpc(
                    "createrun",
                    {
                        channelid: ctx.channelId,
                        workspaceid: wslist[0].workspacedata.oid,
                        goal: "verify usage-workflow-lens: do nothing",
                        runtime: "claude",
                        model: "opus",
                        mode: "quick",
                        deferstart: true,
                    },
                    { timeout: 30000 }
                );
                ctx.runId = created.run.id;
                ctx.landPath = created.run.landpath;
                ctx.status = created.run.status;
                // a reload re-primes the boot-primed channel list and clears every module atom the lens keeps
                await polishReload(h);
                ctx.openedChannel = await h.ev(openAddressExpr(`channel:${ctx.otherChannelId}`));
            } catch (e) {
                ctx.arrangeError = String(e?.message ?? e);
            }
            return ctx;
        },
        async assert(h, ctx) {
            const steps = [];
            const rec = (step, ok, detail) => steps.push({ step, ok: !!ok, detail });
            const shot = (name) => h.shot(`cdp-shots/usage-workflow-lens-${name}.png`);
            rec(
                "0. arranged: two projects, the other one active, a deferred scan run in the first",
                ctx.arrangeError == null && ctx.openedChannel?.ok === true,
                ctx.arrangeError ?? JSON.stringify({ runId: ctx.runId, opened: ctx.openedChannel })
            );
            if (ctx.arrangeError != null) return steps;

            // 1. the lens switch: By provider is today's page, unchanged, and Workflow sits beside it
            await h.goto("usage");
            const providerShown = await polishWaitFor(h, `!!document.querySelector('[data-usage-detail]')`, 15000);
            const provider = await h.ev(`(() => {
                const switchEl = document.querySelector('[aria-label="Lens"]');
                const buttons = [...(switchEl?.querySelectorAll('button') ?? [])];
                const detail = document.querySelector('[data-usage-detail]');
                return {
                    labels: buttons.map((b) => b.textContent.trim()),
                    pressed: buttons.filter((b) => b.getAttribute('aria-pressed') === 'true').map((b) => b.textContent.trim()),
                    // the section label is drawn uppercase, and innerText returns it as drawn
                    liveLimits: /live limits/i.test(detail?.innerText ?? ''),
                    window: !!(document.querySelector('button') && [...document.querySelectorAll('button')].find((b) => b.textContent.trim() === '7 days')),
                    workflow: !!document.querySelector('[data-workflow-lens]'),
                };
            })()`);
            await shot("provider");
            rec(
                "1. Usage opens on By provider as before (Live limits, the range toggle); the header's lens switch offers By provider and Workflow",
                providerShown &&
                    // both options, in that order; a later lens (By work) may sit after them
                    provider?.labels?.[0] === "By provider" &&
                    provider.labels.includes("Workflow") &&
                    JSON.stringify(provider.pressed) === JSON.stringify(["By provider"]) &&
                    provider.liveLimits &&
                    provider.window &&
                    !provider.workflow,
                JSON.stringify({ providerShown, provider })
            );

            // 2. pick the Workflow lens: with no scan yet it is idle
            await h.ev(`${LENS_BUTTON("Workflow")}?.click()`);
            const idleShown = await polishWaitFor(h, `!!${LENS("idle")}`, 10000);
            const idle = await h.ev(`(() => {
                const lens = ${LENS("idle")};
                const pressed = [...document.querySelectorAll('[aria-label="Lens"] button')]
                    .filter((b) => b.getAttribute('aria-pressed') === 'true').map((b) => b.textContent.trim());
                return lens && {
                    big: !!lens.querySelector('[data-workflow-idle-scan]'),
                    line: (lens.innerText || '').includes('last 14 days · every project'),
                    last: !!lens.querySelector('[data-workflow-last]'),
                    pressed,
                    providerPage: !!document.querySelector('[data-usage-detail]'),
                };
            })()`);
            const idleHeader = await headerEnabled(h);
            await shot("idle");
            rec(
                "2. the Workflow lens, no scan yet: idle with the big Scan workflow button and the window line, the lens switch still in the header, the provider page gone, the header button enabled",
                idleShown &&
                    idle?.big &&
                    idle.line &&
                    !idle.last &&
                    JSON.stringify(idle.pressed) === JSON.stringify(["Workflow"]) &&
                    !idle.providerPage &&
                    idleHeader === true,
                JSON.stringify({ idleShown, idle, header: idleHeader })
            );

            // 2a. the project picker: it names the active project, and a pick changes the scan's project
            const selectState = () =>
                h.ev(`({ value: ${SELECT}?.value ?? null, options: [...(${SELECT}?.options ?? [])].map((o) => o.value), title: ${SCAN_BUTTON}?.title ?? null })`);
            const before = await selectState();
            const target = [PROJECT, OTHER_PROJECT].find((n) => n !== before.value) ?? PROJECT;
            await h.ev(`(() => {
                const el = ${SELECT};
                if (!el) return false;
                el.value = ${JSON.stringify(target)};
                el.dispatchEvent(new Event('change', { bubbles: true }));
                return true;
            })()`);
            const picked = await polishWaitFor(h, `(${SCAN_BUTTON}?.title ?? '').endsWith('#${target}')`, 3000);
            const after = await selectState();
            await shot("picker");
            rec(
                "2a. the picker names the active project and lists both; a pick changes the project the Scan button scans from",
                before.value === OTHER_PROJECT &&
                    (before.title ?? "").endsWith(`#${OTHER_PROJECT}`) &&
                    before.options.includes(PROJECT) &&
                    before.options.includes(OTHER_PROJECT) &&
                    picked &&
                    after.value === target &&
                    (after.title ?? "").endsWith(`#${target}`),
                JSON.stringify({ before, target, picked, after })
            );

            // 3. scanning at the checking stage: the lens finds the seeded scan on its own (no atom is written), the kept
            // patterns sit under the Opus pane and the clock ticks
            await writeRun(h, ctx.runId, (run) => ({
                ...run,
                status: ctx.status,
                workflowscan: scanRecord(ctx, { state: "scanning", stage: "checking", verdicts: [], kept: 5 }),
            }));
            const remounted = await remountLens(h);
            const scanning = await polishWaitFor(h, `!!${LENS("scanning")} && !!${DETAIL("checking")}`, 15000);
            const stages = await h.ev(STAGES);
            const scanningHead = await head(h, "scanning");
            const scanningHeader = await headerEnabled(h);
            const scanningTitle = await h.ev(`${SCAN_BUTTON}?.title ?? null`);
            const keptView = await h.ev(`(() => {
                const pane = ${DETAIL("checking")};
                const kept = (id) => pane?.querySelector('[data-workflow-kept="' + id + '"]')?.innerText ?? '';
                return {
                    rows: pane ? pane.querySelectorAll('[data-workflow-kept]').length : 0,
                    p1: kept("p1"),
                    p2: kept("p2"),
                    text: pane?.innerText ?? '',
                };
            })()`);
            await polishNap(2200);
            const elapsedLater = await h.ev(ELAPSED);
            await shot("scanning");
            rec(
                "3. scanning at Opus checks files (found by the lens itself): three stages done, the head row with a ticking clock, five kept rows, the header button disabled and saying a scan is running",
                remounted &&
                    scanning &&
                    stages?.length === 4 &&
                    phases(stages) === JSON.stringify(["done", "done", "done", "now"]) &&
                    stages[3][0] === "Opus checks files" &&
                    scanningHead.head &&
                    scanningHead.status != null &&
                    ELAPSED_FORMAT.test(scanningHead.elapsed ?? "") &&
                    ELAPSED_FORMAT.test(elapsedLater ?? "") &&
                    elapsedLater !== scanningHead.elapsed &&
                    keptView.rows === 5 &&
                    keptView.p1.includes(`#${PROJECT}`) &&
                    keptView.p2.includes("3 projects") &&
                    keptView.text.includes("2 under 3 runs set aside") &&
                    fact(stages, "Sonnet patterns") === "7 named" &&
                    scanningHeader === false &&
                    scanningTitle === "A scan is running",
                JSON.stringify({ remounted, scanning, stages, head: scanningHead, elapsedLater, keptView, header: scanningHeader, scanningTitle })
            );

            // 3a. scanning at the patterns stage
            const early = await seedScanning(h, ctx, "patterns");
            const earlyStages = await h.ev(STAGES);
            const earlyText = await h.ev(`${DETAIL("patterns")}?.innerText ?? ''`);
            await shot("scanning-early");
            rec(
                "3a. scanning at Sonnet patterns: the first stage done, the pane says what Sonnet reads",
                early &&
                    phases(earlyStages) === JSON.stringify(["done", "now", "todo", "todo"]) &&
                    earlyText.includes("Sonnet reads 47 runs from 4 projects"),
                JSON.stringify({ early, earlyStages, earlyText })
            );

            // 3b. scanning at the read stage, before the counts exist
            const reading = await seedScanning(h, ctx, "read", { runs: 0, projects: 0 });
            const readHead = await head(h, "scanning");
            await shot("scanning-read");
            rec(
                "3b. scanning at the read stage: the head row shows no run count, the read pane shows",
                reading && readHead.head && !(readHead.headText ?? "").includes("runs"),
                JSON.stringify({ reading, head: readHead })
            );

            // 3c. scanning at the recount stage
            const recounting = await seedScanning(h, ctx, "recount");
            const recountStages = await h.ev(STAGES);
            const recountText = await h.ev(`${DETAIL("recount")}?.innerText ?? ''`);
            await shot("scanning-recount");
            rec(
                "3c. scanning at Recount: two stages done, the pane names the pattern count",
                recounting &&
                    phases(recountStages) === JSON.stringify(["done", "done", "now", "todo"]) &&
                    recountText.includes("Recounting 7 patterns"),
                JSON.stringify({ recounting, recountStages, recountText })
            );

            // 4. its findings: three suggestions, one raised again, one with its fix in another project; read-only, since the
            // scan's agent is where the owner picks
            const picking = await seed(h, ctx, "picking", (run) => ({ ...run, workflowscan: scanRecord(ctx) }));
            const cards = await h.ev(`({
                cards: ${COUNT("[data-workflow-card]")},
                raised: ${COUNT("[data-workflow-raised]")},
                copy: ${COUNT("[data-workflow-copy]")},
                elsewhere: !!${CARD("p2")}?.querySelector('[data-workflow-elsewhere]'),
                controls: ${COUNT("[data-workflow-pick], [data-workflow-send], [data-workflow-reason]")},
                openAgent: document.querySelector('[data-workflow-open-run]')?.textContent.trim() ?? null,
            })`);
            const pickingHeader = await headerEnabled(h);
            const pickingTitle = await h.ev(`${SCAN_BUTTON}?.title ?? null`);
            const pickingHead = await head(h, "picking");
            await shot("findings");
            rec(
                "4. a scan waiting on its owner lists its findings: head row with 3 to decide and no clock, three read-only cards (no Apply, Drop or send), one raised again, Copy for #project on the other project's fix, an Open agent button; the header button disabled",
                picking &&
                    pickingHead.head &&
                    (pickingHead.status ?? "").includes("3 to decide") &&
                    pickingHead.elapsed == null &&
                    cards.cards === 3 &&
                    cards.raised === 1 &&
                    cards.copy === 1 &&
                    cards.elsewhere &&
                    cards.controls === 0 &&
                    cards.openAgent === "Open agent" &&
                    pickingHeader === false &&
                    (pickingTitle ?? "").includes("waiting on your answers"),
                JSON.stringify({ picking, cards, head: pickingHead, header: pickingHeader, pickingTitle })
            );
            await h.ev(`document.querySelector('[data-workflow-covered-toggle]')?.click()`);
            const covered = await polishWaitFor(h, `${COUNT('[data-workflow-filed="covered"]')} === 2`, 3000);
            await shot("findings-covered");
            rec("4a. Already covered › expands its two rows in place", covered, JSON.stringify({ covered }));
            await h.ev(`document.querySelector('[data-workflow-under-toggle]')?.click()`);
            const under = await polishWaitFor(h, `${COUNT('[data-workflow-filed="under"]')} === 2`, 3000);
            await shot("findings-under");
            rec("4b. Under 3 runs › expands its two rows in place", under, JSON.stringify({ under }));

            // 5. Copy for #project: the stub stands in for the clipboard, which a window without OS focus refuses
            await h.ev(CLIP_STUB);
            ctx.clipStubbed = true;
            await h.ev(`document.querySelector('[data-workflow-copy="p2"]')?.click()`);
            const copied = await polishWaitFor(h, `document.querySelector('[data-workflow-copy="p2"]')?.textContent.trim() === 'Copied'`, 3000);
            const clip = await h.ev(`window.__lensClip ?? null`);
            await shot("copied");
            rec(
                "5. Copy for #waveterm shows Copied and copies the file, where and the edit",
                copied &&
                    clip?.length === 1 &&
                    clip[0].startsWith("pkg/orchestrate/engine.go · workerContract\n+ A step the task asked for"),
                JSON.stringify({ copied, clip })
            );

            // 6. Open agent: the workflowscan: address, unchanged, lands on the scan's agent, and with none up on the run's sheet
            await h.ev(`document.querySelector('[data-workflow-open-run]')?.click()`);
            const agentSheet = await polishWaitFor(
                h,
                `!!document.querySelector('[data-run-sheet]') && (document.querySelector('[data-run-sheet]').innerText || '').includes('verify usage-workflow-lens')`,
                10000
            );
            const agentSurface = await h.activeSurfaceLabel();
            await shot("open-agent");
            rec(
                "6. Open agent opens the scan through the workflowscan: address: with no agent up, the run's sheet on Jarvis",
                agentSheet && agentSurface === SURFACE_LABEL.jarvis,
                JSON.stringify({ agentSheet, agentSurface })
            );
            await h.goto("usage");
            const backToFindings = await polishWaitFor(h, `!!${LENS("picking")}`, 10000);

            // 6a. a quote's run id opens that run
            await h.ev(`document.querySelector('[data-workflow-quote-run="${ctx.runId}"]')?.click()`);
            const quoteSheet = await polishWaitFor(
                h,
                `!!document.querySelector('[data-run-sheet]') && (document.querySelector('[data-run-sheet]').innerText || '').includes('verify usage-workflow-lens')`,
                10000
            );
            const quoteSurface = await h.activeSurfaceLabel();
            await shot("open-quote-run");
            rec(
                "6a. back on Usage > Workflow (the lens kept its scan), a quote's run id opens that run",
                backToFindings && quoteSheet && quoteSurface === SURFACE_LABEL.jarvis,
                JSON.stringify({ backToFindings, quoteSheet, quoteSurface })
            );
            await h.goto("usage");

            // 7. done, with a commit and a row per suggested fix
            const commit = "3f9c2d1e8b7a6c5d4e3f2a1b0c9d8e7f6a5b4c3d";
            const done = await seed(h, ctx, "done", (run) => ({
                ...run,
                status: "done",
                endcommit: commit,
                workflowscan: scanRecord(ctx),
            }));
            const doneView = await h.ev(`({
                commit: document.querySelector('[data-workflow-commit]')?.textContent.trim() ?? null,
                rows: [...document.querySelectorAll('[data-workflow-done-row]')].map((r) => r.getAttribute('data-workflow-done-row')),
                openRun: document.querySelector('[data-workflow-open-run]')?.textContent.trim() ?? null,
            })`);
            const doneHeader = await headerEnabled(h);
            const doneHead = await head(h, "done");
            const doneStages = await h.ev(STAGES);
            const doneInPane = await h.ev(`!!${DETAIL("done")}?.querySelector('[data-workflow-commit]')`);
            await shot("done");
            rec(
                "7. done: all four stages done with their facts, the commit and a suggested row per fix in the pane, the head reads done, and the header button is enabled",
                done &&
                    doneView.commit === commit.slice(0, 8) &&
                    JSON.stringify(doneView.rows) === JSON.stringify(["suggested", "suggested", "suggested"]) &&
                    doneView.openRun === "Open run" &&
                    doneInPane &&
                    phases(doneStages) === JSON.stringify(["done", "done", "done", "done"]) &&
                    fact(doneStages, "Opus checks files") === "3 suggested · 2 covered" &&
                    (doneHead.status ?? "").includes("done") &&
                    doneHead.elapsed == null &&
                    doneHeader === true,
                JSON.stringify({ done, doneView, doneInPane, doneStages, head: doneHead, header: doneHeader })
            );

            // 7a. Open in Diff lands on the Diff surface for the scan run, in the scan's project
            await h.ev(`document.querySelector('[data-workflow-open-diff]')?.click()`);
            let diffSurface = null;
            for (let i = 0; i < 40 && diffSurface !== SURFACE_LABEL.files; i++) {
                await polishNap(250);
                diffSurface = await h.activeSurfaceLabel();
            }
            const origin = await h.ev(DIFF_ORIGIN);
            await shot("open-in-diff");
            rec(
                "7a. Open in Diff lands on the Diff surface scoped to the scan run, in that scan's project",
                diffSurface === SURFACE_LABEL.files &&
                    origin?.kind === "run" &&
                    origin.runId === ctx.runId &&
                    norm(origin.cwd) === norm(ctx.landPath || ctx.cwd),
                JSON.stringify({ diffSurface, origin, landPath: ctx.landPath, cwd: ctx.cwd })
            );
            await h.goto("usage");
            await polishWaitFor(h, `!!${LENS("done")}`, 5000);

            // 8. nothing to suggest, with the Not raised list
            const nothing = await seed(h, ctx, "nothing", (run) => ({
                ...run,
                status: "done",
                workflowscan: scanRecord(ctx, {
                    verdicts: [
                        { id: "p1", verdict: "covered", note: "AGENTS.md" },
                        { id: "p2", verdict: "covered", note: "8bc284e7" },
                        { id: "p3", verdict: "declined", declinedat: 7 },
                        { id: "p4", verdict: "covered", note: "8bc284e7" },
                        { id: "p5", verdict: "covered", note: "f93850e9" },
                    ],
                }),
            }));
            const notRaised = await h.ev(`(() => {
                const pane = ${DETAIL("nothing")};
                return {
                    title: (${LENS("nothing")}?.innerText || '').includes('Nothing to suggest'),
                    rows: [...document.querySelectorAll('[data-workflow-filed]')].map((r) => r.getAttribute('data-workflow-filed')),
                    inPane: pane ? pane.querySelectorAll('[data-workflow-filed]').length : 0,
                    heading: (pane?.innerText || '').includes('Not raised'),
                };
            })()`);
            const nothingHead = await head(h, "nothing");
            const nothingStages = await h.ev(STAGES);
            await shot("nothing");
            rec(
                "8. nothing to suggest: one pane holds the Not raised heading and the covered, declined and under-floor rows, the head reads done",
                nothing &&
                    notRaised.title &&
                    JSON.stringify(notRaised.rows) ===
                        JSON.stringify(["covered", "covered", "covered", "covered", "declined", "under", "under"]) &&
                    notRaised.inPane === notRaised.rows.length &&
                    notRaised.heading &&
                    phases(nothingStages) === JSON.stringify(["done", "done", "done", "done"]) &&
                    fact(nothingStages, "Opus checks files") === "4 covered · 1 declined" &&
                    (nothingHead.status ?? "").includes("done"),
                JSON.stringify({ nothing, notRaised, nothingStages, head: nothingHead })
            );

            // 9. a cancelled run left in scanning blocks nothing
            const cancelled = await seed(h, ctx, "idle", (run) => ({
                ...run,
                status: "cancelled",
                workflowscan: scanRecord(ctx, { state: "scanning", stage: "patterns" }),
            }));
            const cancelledLast = await h.ev(`document.querySelector('[data-workflow-last="cancelled"]')?.textContent.trim() ?? null`);
            const cancelledHeader = await headerEnabled(h);
            const cancelledChrome = await chrome(h);
            await shot("cancelled");
            rec(
                "9. a cancelled run left scanning shows as idle with its last: line, no head row or stage rows, and the header button is enabled",
                cancelled &&
                    /^last: \d\d-\d\d · cancelled$/.test(cancelledLast ?? "") &&
                    cancelledChrome.head === 0 &&
                    cancelledChrome.stage === 0 &&
                    cancelledHeader === true,
                JSON.stringify({ cancelled, cancelledLast, chrome: cancelledChrome, header: cancelledHeader })
            );

            // 10. failed: idle, with the last: line and the error
            const failure = "the Sonnet reply had no json block";
            const failed = await seed(h, ctx, "idle", (run) => ({
                ...run,
                status: ctx.status,
                workflowscan: scanRecord(ctx, { state: "failed", error: failure }),
            }));
            const failedLast = await h.ev(`document.querySelector('[data-workflow-last="failed"]')?.textContent.trim() ?? null`);
            const failedHeader = await headerEnabled(h);
            const failedChrome = await chrome(h);
            await shot("failed");
            rec(
                "10. failed shows as idle with its last: line and the error, no head row or stage rows",
                failed &&
                    (failedLast ?? "").includes("failed") &&
                    (failedLast ?? "").includes(failure) &&
                    failedChrome.head === 0 &&
                    failedChrome.stage === 0 &&
                    failedHeader === true,
                JSON.stringify({ failed, failedLast, chrome: failedChrome, header: failedHeader })
            );

            // 11. the lens switch back: By provider is the same page it was
            await h.ev(`${LENS_BUTTON("By provider")}?.click()`);
            const back = await polishWaitFor(h, `!!document.querySelector('[data-usage-detail]')`, 10000);
            const backView = await h.ev(`({
                liveLimits: /live limits/i.test(document.querySelector('[data-usage-detail]')?.innerText ?? ''),
                workflow: !!document.querySelector('[data-workflow-lens]'),
                pressed: [...document.querySelectorAll('[aria-label="Lens"] button')]
                    .filter((b) => b.getAttribute('aria-pressed') === 'true').map((b) => b.textContent.trim()),
            })`);
            await shot("provider-again");
            rec(
                "11. By provider brings the provider page back, Live limits and all",
                back && backView.liveLimits && !backView.workflow && JSON.stringify(backView.pressed) === JSON.stringify(["By provider"]),
                JSON.stringify({ back, backView })
            );
            return steps;
        },
        async teardown(h, ctx) {
            await teardownFixtureRun(h, ctx, "usage-workflow-lens", {
                what: "restore the clipboard and delete the projects",
                fn: async () => {
                    if (ctx.clipStubbed) await h.ev(CLIP_RESTORE);
                    // a run seeded done cannot be cancelled; the teardown cancels it as the run it was made
                    await writeRun(h, ctx.runId, (run) => ({ ...run, status: ctx.status, workflowscan: undefined })).catch(() => {});
                    // deleteproject drops only the config entry, so the second project's channel would outlive the run
                    if (ctx.otherChannelId) await h.rpc("deletechannel", { channelid: ctx.otherChannelId });
                    for (const name of ctx.projects ?? []) await h.rpc("deleteproject", { name });
                },
            });
            if (ctx.cwd) rmSync(ctx.cwd, { recursive: true, force: true });
            if (ctx.otherCwd) rmSync(ctx.otherCwd, { recursive: true, force: true });
        },
    };
    return [scenario];
}
