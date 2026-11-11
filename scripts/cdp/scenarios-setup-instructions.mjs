// setup-instructions-sync: Setup's Instructions tab Sync now with the dry run's counts, a blank shared doc, a warn-tone harness note,
// a file preview, Ctrl+S and what an outside edit changed in the conflict notice; and the Skills tab's link rows, a vault skill's own
// copy beside the vault copy and the choice to leave a skill alone (docs/superpowers/plans/2026-11-12-kael-sync-code-diff-usage-setup.md,
// Task 15; the fork's feb98d599, 27d06199b, ce7a5fecd and c3a8bf971, and its scenarios-setup-instructions.mjs).
//
// It runs on the isolated Setup fixture (setup-fixtures.mjs, `setup-instructions`), so no real vault or harness folder is touched. The
// fixture's wire is older than Task 1's fields, so this module wraps its page-side mock call: a Pi row with a warn note, the blank
// state, agentsync's real action kinds in an apply's reply, a link in the skills reply, and the vault flag on a vault skill's own copy.
// kit is scenarios.mjs's KAEL_KITS ({ rt, code, files, jarvis }).

import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import {
    arrangeSetupFixture,
    assertSetupFixtureInstalled,
    controlSetupFixture,
    readSetupFixture,
    teardownSetupFixture,
} from "./setup-fixtures.mjs";

const NOTE = "pi settings do not point at the synced skills";
const DRAFT = "# Shared instructions\n\nStep four draft line.\n";
const OUTSIDE = "# Shared instructions\n\nAdded outside.\n";

// installs over the fixture's mock: the fixture keeps its own log and state, this only shapes what the app is told
const patchScript = (piPath) => `(() => {
    const f = window.__arcSetupFixture;
    if (!f) return "no-fixture";
    if (window.__kaelSetup) return "already-patched";
    const st = (window.__kaelSetup = { blank: true, piSteering: "absent", applies: [] });
    const orig = f.mock.mockWshRpcCall.bind(f.mock);
    const piRow = () => ({
        runtime: "pi", label: "Pi", path: ${JSON.stringify(piPath)}, present: true,
        steering: st.blank ? "blank" : st.piSteering, skillsmanaged: 0, skillsunmanaged: 0,
        note: ${JSON.stringify(NOTE)}, notetone: "warn",
    });
    f.mock.mockWshRpcCall = async (client, command, data, opts) => {
        if (command === "agentsyncapply") {
            const dry = data?.dryrun === true;
            const behind = f.runtime.snapshot().status.harnesses.filter((x) => x.present && x.steering !== "current").length
                + (st.piSteering !== "current" ? 1 : 0);
            st.applies.push({ dryrun: dry });
            await orig(client, command, data, opts);
            if (!dry) st.piSteering = "current";
            const kinds = [...Array(behind).fill("steering-write"), "skill-write", "skill-write", "skill-write", "skill-unmanaged"];
            return { actions: kinds.map((kind, i) => ({ kind, runtime: "x" + i, path: "/h/" + i })) };
        }
        const r = await orig(client, command, data, opts);
        if (command === "agentsyncstatus") {
            const rows = r.harnesses.map((x) => (st.blank && x.present ? { ...x, steering: "blank" } : x));
            return { ...r, harnesses: [...rows, piRow()] };
        }
        if (command === "agentsyncskills") {
            return {
                ...r,
                linked: [{ runtime: "claude", name: "dangling-tool", path: "/h/claude/skills/dangling-tool", target: "\\\\??\\\\D:\\\\gone\\\\dangling-tool" }],
                unmanaged: r.unmanaged.map((m) => (m.name === "commit-helper" ? { ...m, vault: true } : m)),
            };
        }
        return r;
    };
    return "ok";
})()`;

// page-side reads, as expressions
const FLAT = `((el) => (el?.textContent ?? "").replace(/\\s+/g, " ").trim())`;
const click = (selector) =>
    `(() => { const el = document.querySelector(${JSON.stringify(selector)}); if (!el || el.disabled) return false; el.click(); return true; })()`;
const setValue = (selector, value) => `(() => {
    const el = document.querySelector(${JSON.stringify(selector)});
    if (!el) return false;
    Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value").set.call(el, ${JSON.stringify(value)});
    el.dispatchEvent(new Event("input", { bubbles: true }));
    return true;
})()`;
const EDITOR = 'textarea[aria-label="Instructions for every harness"]';
const ctrlS = `(() => {
    const el = document.querySelector(${JSON.stringify(EDITOR)});
    if (!el) return false;
    el.dispatchEvent(new KeyboardEvent("keydown", { key: "s", ctrlKey: true, bubbles: true, cancelable: true }));
    return true;
})()`;
const rowsExpr = `(() => Object.fromEntries([...document.querySelectorAll("[data-harness-row]")].map((r) => [r.getAttribute("data-harness-row"), {
    text: ${FLAT}(r),
    note: ${FLAT}(r.querySelector("[data-harness-note]")),
    tone: r.querySelector("[data-harness-note]")?.getAttribute("data-note-tone") ?? null,
}])))()`;
const headerExpr = `(() => {
    const bar = document.querySelector("#setup-tabpanel")?.parentElement?.firstElementChild;
    return ${FLAT}(bar);
})()`;
const manageCount = `(() => { const m = ${FLAT}(document.querySelector("[data-skill-manage]")).match(/Manage (\\d+)/); return m ? Number(m[1]) : 0; })()`;
const clickRadio = (name, index) => `(() => {
    const el = document.querySelectorAll('input[name="${name}"]')[${index}];
    if (!el) return false;
    el.click();
    return true;
})()`;
const rowCells = (name) => `[...document.querySelectorAll('[data-skill-row="${name}"] [role="cell"]')].map((c) => ${FLAT}(c))`;

export default function (kits) {
    const { polishWaitFor, polishNap } = kits.rt;

    return [
        {
            name: "setup-instructions-sync",
            surface: "setup",
            async arrange(h) {
                let ctx = null;
                try {
                    ctx = await arrangeSetupFixture(h, "setup-instructions");
                    const claude = ctx.fixture.status.harnesses.find((x) => x.runtime === "claude");
                    // a real file under the fixture's temp root, for the harness row's read-only preview
                    mkdirSync(dirname(claude.path), { recursive: true });
                    writeFileSync(claude.path, "# Claude Code file\nPrefer small diffs.\n");
                    const patched = await h.ev(patchScript(join(dirname(claude.path), "pi-AGENTS.md")));
                    if (patched !== "ok") throw new Error(`the fixture wrap did not install: ${patched}`);
                    return ctx;
                } catch (e) {
                    if (ctx?.handle != null) await teardownSetupFixture(h, ctx).catch(() => {});
                    return { arrangeError: String(e?.message ?? e) };
                }
            },
            async assert(h, ctx) {
                const steps = [];
                const rec = (step, ok, detail) => steps.push({ step, ok, detail });
                rec("0. the Setup fixture intercepts agentsync, wrapped for Pi, blank, links and the vault flag", ctx.arrangeError == null, ctx.arrangeError ?? "installed");
                if (ctx.arrangeError != null) return steps;
                await assertSetupFixtureInstalled(h);
                const calls = () => h.ev(`window.__kaelSetup.applies`);

                // 1. a blank shared doc, read when Setup opened (the wrap starts blank)
                const up = await polishWaitFor(h, `document.querySelectorAll("[data-harness-row]").length >= 4`, 8000);
                await polishNap(300);
                const blank = { rows: await h.ev(rowsExpr), header: await h.ev(headerExpr), sync: await h.ev(`!!document.querySelector("[data-sync-now]")`) };
                await h.shot("cdp-shots/setup-instructions-sync-1-blank.png");
                rec(
                    "1. a blank shared doc: every present row reads Shared doc is empty, the header says so, Pi's note is in the warn tone, and no Sync now is offered",
                    up &&
                        /Shared doc is empty/.test(blank.rows.claude?.text ?? "") &&
                        /Shared doc is empty/.test(blank.rows.pi?.text ?? "") &&
                        blank.rows.pi?.note === NOTE &&
                        blank.rows.pi?.tone === "warn" &&
                        /The shared doc is empty/.test(blank.header) &&
                        !blank.sync,
                    JSON.stringify(blank)
                );

                // 2. a doc with text: each file's own state, the breakdown the header lumps, and Sync now
                await h.ev(`window.__kaelSetup.blank = false`);
                await h.goto("cockpit");
                await h.goto("setup");
                const rows = await polishWaitFor(h, `!!document.querySelector("[data-sync-now-button]")`, 8000);
                await polishNap(300);
                const states = { rows: await h.ev(rowsExpr), header: await h.ev(headerExpr), breakdown: await h.ev(`${FLAT}(document.querySelector("[data-sync-breakdown]"))`) };
                await h.shot("cdp-shots/setup-instructions-sync-2-states.png");
                rec(
                    "2. each harness file's state (Up to date, Out of date, Not written yet), Pi's warn note, the breakdown 1 out of date · 1 not written yet, and Sync now",
                    rows &&
                        /Up to date/.test(states.rows.claude?.text ?? "") &&
                        /Out of date/.test(states.rows.codex?.text ?? "") &&
                        /Not written yet/.test(states.rows.pi?.text ?? "") &&
                        states.rows.pi?.tone === "warn" &&
                        states.breakdown === "1 out of date · 1 not written yet",
                    JSON.stringify(states)
                );

                // 3. Sync now: the dry run first, its counts shown while the write runs, then the write
                await controlSetupFixture(h, "delay", { command: "agentsyncapply", ms: 700 });
                await h.ev(click("[data-sync-now-button]"));
                const planned = await polishWaitFor(h, `!!document.querySelector('[data-sync-result="writing"]')`, 6000);
                const planText = await h.ev(`${FLAT}(document.querySelector("[data-sync-result]"))`);
                await h.shot("cdp-shots/setup-instructions-sync-3-dry-run.png");
                const done = await polishWaitFor(h, `!!document.querySelector('[data-sync-result="done"]')`, 8000);
                await polishNap(300);
                await controlSetupFixture(h, "delay", { command: "agentsyncapply", ms: 0 });
                const after = {
                    result: await h.ev(`${FLAT}(document.querySelector("[data-sync-result]"))`),
                    header: await h.ev(headerExpr),
                    button: await h.ev(`!!document.querySelector("[data-sync-now-button]")`),
                    applies: await calls(),
                };
                await h.shot("cdp-shots/setup-instructions-sync-3-synced.png");
                rec(
                    "3. Sync now runs a dry run (counts shown while the write runs: 2 harness files, 3 skill copies, 1 left alone), then writes, then every harness is up to date",
                    planned &&
                        planText === "Writing the doc into 2 harness files · 3 skill copies updated · 1 left alone" &&
                        done &&
                        after.result === "Synced 2 harness files · 3 skill copies updated · 1 left alone" &&
                        /3 harnesses up to date/.test(after.header) &&
                        !after.button &&
                        JSON.stringify(after.applies) === JSON.stringify([{ dryrun: true }, { dryrun: false }]),
                    JSON.stringify({ planText, ...after })
                );

                // 4. a harness row previews its file read-only, and the shared draft is as it was when the Shared row returns
                await h.ev(setValue(EDITOR, DRAFT));
                await h.ev(click('[data-harness-row="claude"]'));
                const previewed = await polishWaitFor(h, `!!document.querySelector('[data-harness-preview="claude"]') && ${FLAT}(document.querySelector('[data-harness-preview="claude"]')).includes("Prefer small diffs.")`, 6000);
                const editorGone = await h.ev(`!document.querySelector(${JSON.stringify(EDITOR)})`);
                await h.ev(click("[data-shared-row]"));
                await polishWaitFor(h, `!!document.querySelector(${JSON.stringify(EDITOR)})`, 4000);
                const kept = await h.ev(`document.querySelector(${JSON.stringify(EDITOR)})?.value ?? null`);
                rec(
                    "4. a harness row shows its file read-only in the center; the Shared row brings the editor back with the draft intact",
                    previewed && editorGone && kept === DRAFT,
                    JSON.stringify({ previewed, editorGone, kept })
                );

                // 5. Ctrl+S in the editor saves
                await h.ev(ctrlS);
                const saved = await polishWaitFor(h, `window.__arcSetupFixture.runtime.snapshot().log.some((e) => e.kind === "write-attempt")`, 5000);
                const attempts = (await readSetupFixture(h)).log.filter((e) => e.kind === "write-attempt");
                rec(
                    "5. Ctrl+S in the shared editor saves the draft",
                    saved && attempts.length === 1 && attempts[0].data?.content === DRAFT && attempts[0].accepted === true,
                    JSON.stringify(attempts)
                );

                // 6. an outside edit: the conflict notice lists what the disk version added and dropped
                await h.ev(setValue(EDITOR, `${DRAFT}one more\n`));
                await controlSetupFixture(h, "setDisk", { content: OUTSIDE });
                await polishNap(300);
                await h.ev(ctrlS);
                const listed = await polishWaitFor(h, `!!document.querySelector('[data-conflict-disk="changes"]')`, 6000);
                await polishNap(300);
                const conflict = await h.ev(`${FLAT}(document.querySelector("[data-conflict-disk]"))`);
                await h.shot("cdp-shots/setup-instructions-sync-4-conflict.png");
                rec(
                    "6. a save over an outside edit lists the lines the disk version gained and lost",
                    listed && /gained 1 line and lost 1 line/.test(conflict) && conflict.includes("Added outside.") && conflict.includes("Step four draft line."),
                    conflict
                );
                // leave no draft or conflict in the module atoms for the next scenario
                await h.ev(`[...document.querySelectorAll('[role="alert"] button')].find((b) => ${FLAT}(b) === "Reload")?.click()`);
                await polishWaitFor(h, `!document.querySelector("[data-conflict-disk]")`, 4000);

                // 7. Skills: a link row, Pi's line, a vault skill's own copy with Replace, and Leave it where it is
                await h.ev(click('[data-setup-tab="skills"]'));
                const listedSkills = await polishWaitFor(h, `!!document.querySelector('[data-skill-row="dangling-tool"]')`, 8000);
                await polishNap(300);
                const link = await h.ev(`({
                    group: document.querySelector('[data-skill-row="dangling-tool"]')?.closest('[role="rowgroup"]')?.getAttribute("aria-label") ?? null,
                    cells: ${rowCells("dangling-tool")},
                    title: document.querySelector('[data-skill-row="dangling-tool"] [role="cell"][title]')?.getAttribute("title") ?? null,
                    pi: document.querySelector("[data-pi-skills-line]")?.getAttribute("data-tone") ?? null,
                })`);
                await h.ev(click('[data-skill-row="commit-helper"]'));
                const strayUp = await polishWaitFor(h, `!!document.querySelector('[data-skill-rail="commit-helper"] [data-skill-stray]')`, 4000);
                const before = await h.ev(manageCount);
                await h.ev(clickRadio("skill-sync-commit-helper", 1));
                await polishNap(300);
                const replaced = { count: await h.ev(manageCount), cells: await h.ev(`${rowCells("commit-helper")}`) };
                await h.shot("cdp-shots/setup-instructions-sync-5-skills.png");
                rec(
                    "7. Skills shows the dangling link in Linked from another folder with its target, Pi's warn line, and the vault skill's own copy (Replace adds it to Manage and reads Replaced)",
                    listedSkills &&
                        link.group === "Linked from another folder" &&
                        link.cells.includes("Link") &&
                        link.title === "D:\\gone\\dangling-tool" &&
                        link.pi === "warn" &&
                        strayUp &&
                        replaced.count === before + 1 &&
                        replaced.cells.includes("Replaced"),
                    JSON.stringify({ link, strayUp, before, replaced })
                );
                await h.ev(clickRadio("skill-sync-commit-helper", 0));

                await h.ev(click('[data-skill-row="codex-only-skill"]'));
                const leaveUp = await polishWaitFor(h, `!!document.querySelector('[data-skill-rail="codex-only-skill"] [data-skill-leave]')`, 4000);
                const withLeave = await h.ev(manageCount);
                await h.ev(clickRadio("skill-sync-codex-only-skill", 1));
                await polishNap(300);
                const left = { count: await h.ev(manageCount), cells: await h.ev(`${rowCells("codex-only-skill")}`) };
                rec(
                    "8. Leave it where it is takes the skill out of Manage and its cells read Left alone",
                    leaveUp && left.count === withLeave - 1 && left.cells.includes("Left alone"),
                    JSON.stringify({ leaveUp, withLeave, left })
                );
                await h.ev(clickRadio("skill-sync-codex-only-skill", 0));
                return steps;
            },
            async teardown(h, ctx) {
                await h.ev(`delete window.__kaelSetup`).catch(() => {});
                if (ctx.handle != null) await teardownSetupFixture(h, ctx);
            },
        },
    ];
}
