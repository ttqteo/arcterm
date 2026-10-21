// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0
//
// council-setup and council-ask (docs/superpowers/plans/2026-10-21-council.md, Task 16): the Setup form, the coordinator's
// suggestion and Start council; and Ask the council on an Ideas question. Nothing here starts a council or spends a
// token: the coordinator's suggestion and Start council are always stubbed in the page (fixtures.mjs stubRpc), and the
// estimate Setup shows is the real, free RPC.
//
// council-setup opens Setup from the fixture project's tree (New council), fills it in, reopens it prefilled through the
// DEV hook window.__arcCouncil (two files and a temp PNG) to see the suggestion pending, resolved, and rejected, and
// starts a council with the stub. council-ask arranges an agent in the fixture project whose session has one open
// question in its Ideas, the way the ideas-rail scenario does (a roster fixture, a transcript, the session's ideas via
// `ideaadd`), and asks the council from that question's row.
//
// The hooks are called by councilscenarios.mjs as arrange(h, fx), assert(h, ctx, fx), teardown(h, ctx, fx).

import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { waitFor } from "../attach.mjs";
import {
    arrangeCouncilProject,
    COUNCIL_PROJECT,
    councilFixtureId,
    loadCouncilFixture,
    openCouncilSetup,
    placeCouncil,
    resolveStub,
    rpcCalls,
    stubRpc,
    teardownCouncilProject,
    writeCouncil,
} from "./fixtures.mjs";

const UI_WAIT_MS = 6_000;
const SUGGEST_WAIT_MS = 8_000; // the page waits a moment after the last edit before it asks
const ESTIMATE_RE = /≈ \d+ calls · ~[\d.]+M tokens · ~\d+ min/;

// a 1x1 png: the screenshot the prefilled draft names
const PNG_1X1 = Buffer.from(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==",
    "base64"
);

const SUGGESTED_FILES = ["railappsstore.ts", "appsurface.tsx"];
const SUGGESTED_ROLE = {
    id: "mac",
    name: "Mac user",
    brief: "You use arcterm on a Mac. Ask what the feature does there that it does on Windows.",
    model: "sonnet",
    why: "The frame reload is Windows-only for now (appsurface.tsx:111)",
};

// ---- page-side helpers (expressions h.ev runs) ----

const present = (selector) => `!!document.querySelector(${JSON.stringify(selector)})`;
const click = (selector) => `(() => {
    const el = document.querySelector(${JSON.stringify(selector)});
    if (!el) return false;
    el.click();
    return true;
})()`;
// React reads a controlled input's value through its own setter, so the native one is called and an input event follows
const setValue = (selector, text) => `(() => {
    const el = document.querySelector(${JSON.stringify(selector)});
    if (!el) return false;
    el.focus();
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value").set.call(el, ${JSON.stringify(text)});
    el.dispatchEvent(new Event("input", { bubbles: true }));
    return true;
})()`;
const escape = `document.activeElement?.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", code: "Escape", bubbles: true })) ?? false`;

// the form as the page draws it, reduced to what a step reads
const SETUP = `(() => {
    const flat = (el) => (el?.textContent ?? "").replace(/\\s+/g, " ").trim();
    const root = document.querySelector("[data-council-setup]");
    if (!root) return null;
    const q = (s) => root.querySelector(s);
    const text = (s) => { const el = q(s); return el ? flat(el) : null; };
    const start = q("[data-council-start]");
    return {
        feature: q('[data-council-input="feature"]')?.value ?? null,
        question: q('[data-council-input="question"]')?.value ?? null,
        group: text("[data-council-group]"),
        experts: [...root.querySelectorAll("[data-council-expert]")].map((r) => ({
            id: r.dataset.councilExpert,
            coordinator: r.hasAttribute("data-council-coordinator"),
            model: flat(r.querySelector("[data-council-model]")),
            remove: r.querySelector("[data-council-expert-remove]") != null,
        })),
        files: [...root.querySelectorAll("[data-council-file]")].map((c) => ({
            path: c.dataset.councilFile,
            remove: c.querySelector("[data-council-file-remove]") != null,
        })),
        screenshots: [...root.querySelectorAll("[data-council-screenshot]")].map((c) => c.dataset.councilScreenshot),
        add: text("[data-council-add]"),
        suggesting: text("[data-council-suggesting]"),
        failed: text("[data-council-suggest-failed]"),
        retry: q("[data-council-suggest-retry]") != null,
        suggested: [...root.querySelectorAll("[data-council-suggested]")].map((r) => ({
            id: r.dataset.councilSuggested,
            text: flat(r),
            add: r.querySelector("[data-council-suggested-add]") != null,
        })),
        pause: q("[data-council-pause]")?.getAttribute("aria-checked") ?? null,
        estimate: text("[data-council-estimate]"),
        footnote: text("[data-council-footnote]"),
        start: start ? { disabled: start.disabled, text: flat(start) } : null,
    };
})()`;

// a button's background next to the accent token, both as the browser computes them
const ACCENT_FILL = `(() => {
    const probe = document.createElement("span");
    probe.style.color = "var(--color-accent)";
    document.body.appendChild(probe);
    const want = getComputedStyle(probe).color;
    probe.remove();
    const btn = document.querySelector("[data-council-start]");
    return { want, got: btn ? getComputedStyle(btn).backgroundColor : null };
})()`;

// the menu items open right now (a menu is drawn only while open, and for a moment after it closes)
const menuItems = (attr) => `[...document.querySelectorAll("[${attr}]")].map((el) => ({
    id: el.getAttribute("${attr}"),
    checked: el.getAttribute("aria-checked"),
    text: (el.textContent ?? "").replace(/\\s+/g, " ").trim(),
}))`;

const sameList = (a, b) => JSON.stringify(a) === JSON.stringify(b);

// ---- council-setup ----

export const councilSetup = {
    async arrange(h, fx) {
        const ctx = await arrangeCouncilProject(h, fx);
        try {
            ctx.shot = join(ctx.base, "rail-apps.png");
            writeFileSync(ctx.shot, PNG_1X1);
            // the council Start council "starts" is the round2 fixture, written to the data dir so its Discussion can load it
            ctx.startedId = councilFixtureId("round2");
            writeCouncil(ctx, "round2");
        } catch (e) {
            await teardownCouncilProject(h, ctx).catch(() => {});
            throw e;
        }
        return ctx;
    },

    async assert(h, ctx) {
        const steps = [];
        const rec = (step, ok, detail) =>
            steps.push({ step, ok: ok === true, detail: typeof detail === "string" ? detail : JSON.stringify(detail) });
        const until = (expr, ms = UI_WAIT_MS) => waitFor((e) => h.ev(e), expr, ms);
        const view = () => h.ev(SETUP);
        const calls = (name) => rpcCalls(h, name);
        const pollUntil = async (fn, ms = UI_WAIT_MS) => {
            for (const start = Date.now(); ; ) {
                if (await fn().catch(() => false)) return true;
                if (Date.now() - start >= ms) return false;
                await new Promise((r) => setTimeout(r, 150));
            }
        };
        const started = placeCouncil(loadCouncilFixture("round2"), "round2", ctx.repo);

        try {
            // nothing in this scenario may reach a model: the suggestion hangs until a step answers it, and Start council
            // answers with the council already written
            await stubRpc(h, ["CouncilSuggestCommand", "CouncilStartCommand"], {
                CouncilSuggestCommand: { pending: true },
                CouncilStartCommand: { value: started },
            });

            // 1. New council in the tree opens Setup on the first group
            const newRow = `[data-council-new="${COUNCIL_PROJECT}"]`;
            await until(present(newRow), 10_000);
            await h.ev(click(newRow));
            await until(`document.querySelectorAll("[data-council-expert]").length === 5`);
            let v = await view();
            const coordinator = v?.experts.find((e) => e.coordinator);
            rec(
                "1. New council opens Setup: the group button reads Review a UI feature, five rows, the coordinator last on opus with no remove",
                v?.group === "Review a UI feature" &&
                    sameList(v.experts.map((e) => e.id), ["ux", "ram", "newuser", "skeptic", "coordinator"]) &&
                    v.experts.at(-1)?.coordinator === true &&
                    coordinator?.model === "opus" &&
                    coordinator?.remove === false &&
                    v.experts.filter((e) => !e.coordinator).every((e) => e.remove && e.model === "sonnet"),
                v
            );

            // 2. the feature, the estimate and the button that waits for it
            const blockedBefore = v?.start?.disabled === true && v.footnote === "Name the feature to review";
            await h.ev(setValue('[data-council-input="feature"]', "Rail apps"));
            await until(`/≈ \\d+ calls · ~[\\d.]+M tokens · ~\\d+ min/.test(document.querySelector("[data-council-estimate]")?.textContent ?? "")`);
            v = await view();
            rec(
                "2. a feature enables Start council, and the footer estimate reads ≈ N calls · ~X.XM tokens · ~N min (≈ 9 calls for four experts)",
                blockedBefore &&
                    v?.feature === "Rail apps" &&
                    v.start?.disabled === false &&
                    ESTIMATE_RE.test(v.estimate ?? "") &&
                    (v.estimate ?? "").startsWith("≈ 9 calls") &&
                    v.footnote === "4 sonnet experts read the code in round 1; rounds 2 and 3 read only text",
                { blockedBefore, feature: v?.feature, start: v?.start, estimate: v?.estimate, footnote: v?.footnote }
            );
            const noAsk = (await calls("CouncilSuggestCommand")).length === 0;

            // 3. removing a row lowers the calls; the coordinator has nothing to remove
            await h.ev(click('[data-council-expert-remove="newuser"]'));
            await until(`(document.querySelector("[data-council-estimate]")?.textContent ?? "").startsWith("≈ 7 calls")`);
            v = await view();
            rec(
                "3. removing the New user row leaves four rows and lowers the estimate to ≈ 7 calls; the coordinator row still has no remove",
                sameList(v?.experts.map((e) => e.id), ["ux", "ram", "skeptic", "coordinator"]) &&
                    (v?.estimate ?? "").startsWith("≈ 7 calls") &&
                    v.experts.find((e) => e.coordinator)?.remove === false &&
                    v.footnote === "3 sonnet experts read the code in round 1; rounds 2 and 3 read only text",
                { experts: v?.experts.map((e) => e.id), estimate: v?.estimate, footnote: v?.footnote }
            );

            // 4. a model menu, and the group menu
            await h.ev(click('[data-council-model="ram"]'));
            await until(`document.querySelectorAll("[data-council-model-item]").length === 3`);
            const models = await h.ev(menuItems("data-council-model-item"));
            await h.ev(click('[data-council-model-item="haiku"]'));
            await until(`(document.querySelector('[data-council-model="ram"]')?.textContent ?? "").trim() === "haiku"`);
            v = await view();
            await h.ev(click("[data-council-group]"));
            await until(`document.querySelectorAll("[data-council-group-item]").length >= 2`);
            const groups = await h.ev(menuItems("data-council-group-item"));
            await h.ev(escape);
            const groupMenuClosed = await until(`document.querySelectorAll("[data-council-group-item]").length === 0`);
            rec(
                "4. a row's model menu offers sonnet, opus and haiku with sonnet checked and haiku sets it; the group menu lists both groups with Review a UI feature checked, and Escape closes it",
                sameList(models.map((m) => m.id), ["sonnet", "opus", "haiku"]) &&
                    models.find((m) => m.id === "sonnet")?.checked === "true" &&
                    v?.experts.find((e) => e.id === "ram")?.model === "haiku" &&
                    v.experts.find((e) => e.id === "ux")?.model === "sonnet" &&
                    groups.some((g) => g.id === "ui-feature" && g.checked === "true" && g.text.includes("Review a UI feature")) &&
                    groups.some((g) => g.id === "paper" && g.text.includes("Paper review")) &&
                    groupMenuClosed,
                { models, groups, groupMenuClosed }
            );

            // 5. prefilled with two files and a screenshot: chips with ×, the add button, the screenshot card
            const FILES = ["docs/superpowers/specs/2026-10-20-rail-apps-design.md", "railapps.ts"];
            await openCouncilSetup(h, ctx.repo, { feature: "Rail apps", files: FILES, screenshots: [ctx.shot] });
            await until(`document.querySelectorAll("[data-council-file]").length === 2 && document.querySelectorAll("[data-council-expert]").length === 5`);
            v = await view();
            const chipsBefore = v?.files;
            await h.ev(click('[data-council-add]'));
            await until(`document.querySelectorAll("[data-council-add-item]").length === 2`);
            const addItems = await h.ev(menuItems("data-council-add-item"));
            await h.ev(escape);
            await until(`document.querySelectorAll("[data-council-add-item]").length === 0`);
            await h.ev(click('[data-council-file-remove="railapps.ts"]'));
            await until(`document.querySelectorAll("[data-council-file]").length === 1`);
            v = await view();
            rec(
                "5. prefilled with two files and a screenshot: two file chips with ×, removing one leaves one; + Add a file or folder offers File… and Folder…; the screenshot card shows rail-apps.png",
                sameList(chipsBefore?.map((c) => c.path), FILES) &&
                    chipsBefore.every((c) => c.remove) &&
                    sameList(v?.files.map((c) => c.path), [FILES[0]]) &&
                    v.add === "+ Add a file or folder" &&
                    sameList(addItems.map((i) => i.text), ["File…", "Folder…"]) &&
                    sameList(v.screenshots, [ctx.shot]) &&
                    v.group === "Review a UI feature",
                { chipsBefore, files: v?.files, add: v?.add, addItems, screenshots: v?.screenshots }
            );

            // 6. the coordinator is asked once, a moment after the last edit: Suggesting… while the call is out
            const asked = await until(`${present("[data-council-suggesting]")}`, SUGGEST_WAIT_MS);
            v = await view();
            const askCalls = await calls("CouncilSuggestCommand");
            // the ask may have left before the chip was removed in step 5, so its files are one of the two or both
            const askedFiles = askCalls[0]?.data?.files ?? [];
            rec(
                "6. with a feature and a file the coordinator is asked once: a muted Suggesting… shows while the (stubbed) call is open, and nothing was asked before there was a file",
                noAsk &&
                    asked &&
                    v?.suggesting === "Suggesting…" &&
                    askCalls.length === 1 &&
                    askCalls[0].data?.feature === "Rail apps" &&
                    askedFiles.includes(FILES[0]) &&
                    askedFiles.every((f) => FILES.includes(f)) &&
                    askCalls[0].data?.project === ctx.repo,
                { noAsk, suggesting: v?.suggesting, calls: askCalls }
            );

            // 7. the answer: its files join the chips, its role waits as a dashed row, Add makes it a sixth row
            await resolveStub(h, "CouncilSuggestCommand", {
                files: SUGGESTED_FILES,
                roles: [SUGGESTED_ROLE],
            });
            await until(`${present('[data-council-suggested="mac"]')}`);
            v = await view();
            const row = v?.suggested.find((s) => s.id === "mac");
            const filesAfter = v?.files.map((c) => c.path);
            // the runner's own shot of this scenario (council-setup) is taken on arrival, before Setup is open
            await h.shot("cdp-shots/council-setup-suggested.png");
            await h.ev(click('[data-council-suggested-add="mac"]'));
            await until(`document.querySelectorAll("[data-council-expert]").length === 6`);
            const added = await view();
            rec(
                "7. the answer's two files join the chip and its role is a dashed row reading Mac user and why, with Add; Add makes it a sixth row before the coordinator",
                v?.suggesting == null &&
                    sameList(filesAfter, [FILES[0], ...SUGGESTED_FILES]) &&
                    v.suggested.length === 1 &&
                    row?.add === true &&
                    row.text.includes("Mac user") &&
                    row.text.includes("The frame reload is Windows-only for now") &&
                    v.experts.length === 5 &&
                    added?.experts.length === 6 &&
                    added.experts.at(-1)?.id === "coordinator" &&
                    added.experts.at(-2)?.id === "mac" &&
                    added.suggested.length === 0,
                { filesAfter, row, before: v?.experts.length, after: added?.experts.map((e) => e.id) }
            );

            // 8. a rerun (Run again hands over its panel with the group counted as picked) is not asked on opening
            const beforeRerun = (await calls("CouncilSuggestCommand")).length;
            const rerunPanel = [
                ["ux", "UX", "sonnet"],
                ["ram", "RAM", "sonnet"],
                ["newuser", "New user", "sonnet"],
                ["skeptic", "Skeptic", "sonnet"],
                ["coordinator", "Coordinator", "opus"],
            ].map(([id, name, model]) => ({ id, name, brief: `${name} brief`, model, coordinator: id === "coordinator" || undefined }));
            await openCouncilSetup(h, ctx.repo, {
                feature: "Rail apps",
                files: [FILES[1]],
                group: "ui-feature",
                experts: rerunPanel,
                groupPicked: true,
                suggestState: "idle",
            });
            await until(`document.querySelectorAll("[data-council-file]").length === 1 && document.querySelectorAll("[data-council-expert]").length === 5`);
            // longer than the page waits before it asks
            await new Promise((r) => setTimeout(r, 1800));
            v = await view();
            const afterRerun = (await calls("CouncilSuggestCommand")).length;
            rec(
                "8. a rerun draft (feature, file, panel set, group picked) shows its form as given and is not asked: no call, no Suggesting…",
                afterRerun === beforeRerun &&
                    v?.suggesting == null &&
                    v.failed == null &&
                    v.suggested.length === 0 &&
                    v.feature === "Rail apps" &&
                    sameList(v.experts.map((e) => e.id), ["ux", "ram", "newuser", "skeptic", "coordinator"]) &&
                    sameList(v.files.map((c) => c.path), [FILES[1]]),
                { beforeRerun, afterRerun, suggesting: v?.suggesting, failed: v?.failed }
            );

            // 9. a rejected suggestion: a note, the group's rows as they were
            await stubRpc(h, ["CouncilSuggestCommand"], { CouncilSuggestCommand: { reject: "claude exited with status 1" } });
            await openCouncilSetup(h, ctx.repo, { feature: "Rail apps", files: [FILES[1]] });
            await until(`${present("[data-council-suggest-failed]")}`, SUGGEST_WAIT_MS);
            v = await view();
            const afterReject = (await calls("CouncilSuggestCommand")).length;
            await h.ev(click("[data-council-suggest-retry]"));
            const retried = await pollUntil(async () => (await calls("CouncilSuggestCommand")).length === afterReject + 1);
            rec(
                "9. a rejected suggestion leaves a note that it failed and the group's five rows unchanged, with Try again that asks once more",
                /suggestion failed/i.test(v?.failed ?? "") &&
                    v.retry === true &&
                    sameList(v.experts.map((e) => e.id), ["ux", "ram", "newuser", "skeptic", "coordinator"]) &&
                    v.suggested.length === 0 &&
                    sameList(v.files.map((c) => c.path), [FILES[1]]) &&
                    v.suggesting == null &&
                    retried === true,
                { failed: v?.failed, retry: v?.retry, experts: v?.experts.map((e) => e.id), afterReject, retried }
            );

            // 10. Pause after round 1 toggles
            const pauseBefore = (await view())?.pause;
            await h.ev(click("[data-council-pause]"));
            await until(`document.querySelector("[data-council-pause]")?.getAttribute("aria-checked") === "true"`);
            const pauseOn = (await view())?.pause;
            await h.ev(click("[data-council-pause]"));
            await until(`document.querySelector("[data-council-pause]")?.getAttribute("aria-checked") === "false"`);
            const pauseOff = (await view())?.pause;
            await h.ev(click("[data-council-pause]"));
            await until(`document.querySelector("[data-council-pause]")?.getAttribute("aria-checked") === "true"`);
            rec(
                "10. Pause after round 1 starts off and toggles on, off and on again",
                pauseBefore === "false" && pauseOn === "true" && pauseOff === "false",
                { pauseBefore, pauseOn, pauseOff }
            );

            // 11. Start council is the accent button; the stubbed start records the draft and opens the Discussion
            const fill = await h.ev(ACCENT_FILL);
            v = await view();
            await h.ev(click("[data-council-start]"));
            await until(`${present("[data-council-discussion]")}`);
            const startCalls = await calls("CouncilStartCommand");
            const sent = startCalls[0]?.data;
            const rowText = `(document.querySelector(${JSON.stringify(newRow)})?.textContent ?? "").replace(/\\s+/g, " ").trim()`;
            await until(`${rowText} === "New council"`);
            const newRowText = await h.ev(rowText);
            rec(
                "11. Start council is drawn in the accent; clicking it (stubbed) sends the draft's feature, files, panel and pause once, opens the Discussion, and the tree's New council row no longer reads draft",
                fill.got != null &&
                    fill.got === fill.want &&
                    v?.start?.text === "Start council" &&
                    startCalls.length === 1 &&
                    sent?.feature === "Rail apps" &&
                    sameList(sent?.files, [FILES[1]]) &&
                    sameList(sent?.experts?.map((e) => e.id), ["ux", "ram", "newuser", "skeptic", "coordinator"]) &&
                    sent.experts.at(-1)?.coordinator === true &&
                    sent.pause === true &&
                    sent.group === "ui-feature" &&
                    sent.project === ctx.repo &&
                    newRowText === "New council",
                { fill, calls: startCalls.length, sent, newRowText }
            );
        } catch (e) {
            rec("the scenario stopped early: a page call failed", false, String(e?.message ?? e));
        }
        return steps;
    },

    async teardown(h, ctx) {
        await teardownCouncilProject(h, ctx);
    },
};

// ---- council-ask ----

const ASK_AGENT = "fx-council-ask";
const ASK_SESSION = "council-ask-fixture";
const ASK_QUESTION = "Is the rail the right home for pinned apps, or should they live in the Agent tree?";
const ROSTER_FIXTURE = new URL("../../../public/cockpit-fixtures/active.json", import.meta.url);
const UI_ROUTE = { route: "cockpit", timeout: 15000 };
// the page state a known Agent surface with its rail open starts from, put back by teardown (ideas-rail's keys)
const RAIL_KEYS = [
    "agent.rail.visible",
    "cockpit.rail.sections",
    "agent.rail.tab",
    "agent.rail.wideWidth",
    "agent.grids",
    "agent.tree.collapsed",
    "agent.tree.sections.collapsed",
    "agent.tree.conversations.collapsed",
];
const ASIDE = `document.querySelector('aside[aria-label="Agent details"]')`;

const transcript = (cwd, prompt) =>
    JSON.stringify({ cwd, type: "user", message: { role: "user", content: [{ type: "text", text: prompt }] } }) + "\n";

export const councilAsk = {
    async arrange(h, fx) {
        const ctx = await arrangeCouncilProject(h, fx);
        try {
            ctx.prevKeys = {};
            for (const k of RAIL_KEYS) {
                ctx.prevKeys[k] = await h.ev(`localStorage.getItem(${JSON.stringify(k)})`);
            }
            ctx.prevFixture = existsSync(ROSTER_FIXTURE) ? readFileSync(ROSTER_FIXTURE, "utf8") : null;
            // the terminal arrangeCouncilProject opened becomes an agent's: its tab is marked, and its block carries the
            // transcript whose file name is the session the Ideas list belongs to
            const term = ctx.terminals[0];
            ctx.transcript = join(ctx.base, `${ASK_SESSION}.jsonl`);
            writeFileSync(ctx.transcript, transcript(ctx.repo, "weigh the rail apps"));
            await h.rpc("setmeta", { oref: `tab:${term.tabId}`, meta: { "session:agent": "claude" } });
            await h.rpc("setmeta", { oref: `block:${term.blockId}`, meta: { "agent:transcriptpath": ctx.transcript } });
            ctx.dataDir = (await h.rpc("waveinfo", null)).datadir;
            rmSync(join(ctx.dataDir, "ideas", `${ASK_SESSION}.json`), { force: true });
            await h.rpc("ideaadd", { sessionid: ASK_SESSION, text: ASK_QUESTION, kind: "question", by: "agent" });
            ctx.ideasWritten = true;
            mkdirSync(new URL(".", ROSTER_FIXTURE), { recursive: true });
            writeFileSync(
                ROSTER_FIXTURE,
                JSON.stringify(
                    [
                        {
                            id: ASK_AGENT,
                            name: "council ask agent",
                            project: COUNCIL_PROJECT,
                            task: "weigh the rail apps",
                            state: "idle",
                            agent: "claude",
                            model: "opus",
                            idleSince: Date.now() - 60_000,
                            blockId: term.blockId,
                            transcriptPath: ctx.transcript,
                        },
                    ],
                    null,
                    2
                )
            );
            ctx.wroteFixture = true;
            // an open rail on Overview with every section at its default (Ideas is closed), an empty grid, nothing folded
            await h.ev(`(() => {
                localStorage.setItem("agent.rail.visible", "true");
                for (const k of ${JSON.stringify(RAIL_KEYS.filter((k) => k !== "agent.rail.visible" && k !== "agent.grids"))}) localStorage.removeItem(k);
                localStorage.setItem("agent.grids", ${JSON.stringify(JSON.stringify({ project: null, grids: {} }))});
            })()`);
            // the roster fixture is read once at boot
            await fx.polishReload(h);
            await h.goto("agent");
            ctx.inRoster = await waitFor((e) => h.ev(e), present(`[data-agent-terminal="${ASK_AGENT}"]`), 15_000);
            if (ctx.inRoster) {
                await h.rpc("uireveal", { address: `agent:${ASK_AGENT}` }, UI_ROUTE);
            }
        } catch (e) {
            ctx.arrangeError = String(e?.message ?? e);
        }
        return ctx;
    },

    async assert(h, ctx) {
        const steps = [];
        const rec = (step, ok, detail) =>
            steps.push({ step, ok: ok === true, detail: typeof detail === "string" ? detail : JSON.stringify(detail) });
        const until = (expr, ms = UI_WAIT_MS) => waitFor((e) => h.ev(e), expr, ms);
        const view = () => h.ev(SETUP);
        const calls = (name) => rpcCalls(h, name);
        const ready = ctx.arrangeError == null && ctx.inRoster === true;
        rec(
            "0. the fixture agent is in the roster with one open question in its session's Ideas",
            ready,
            ctx.arrangeError ?? JSON.stringify({ inRoster: ctx.inRoster })
        );
        if (!ready) return steps;
        const started = placeCouncil(loadCouncilFixture("round2"), "round2", ctx.repo);

        try {
            writeCouncil(ctx, "round2");
            await stubRpc(h, ["CouncilSuggestCommand", "CouncilStartCommand"], {
                CouncilSuggestCommand: { pending: true },
                CouncilStartCommand: { value: started },
            });

            // 1. the Ideas section lists the question with Ask the council in its actions
            const stat = `${ASIDE}?.querySelector('[data-rail-stat="ideas"]')`;
            await until(`${stat}?.getAttribute("data-count") === "1"`, 10_000);
            await h.ev(`${stat}?.click()`);
            await until(`${ASIDE}?.querySelector("[data-ideas-section]") != null`);
            const rowSel = `${ASIDE}?.querySelector('[data-ideas-section] [data-ideas-row][data-kind="question"]')`;
            await until(`${rowSel} != null`);
            // a person reaches the action by pointing at the row: the strip it sits in is shown on hover
            const box = await h.ev(`(() => {
                ${rowSel}.scrollIntoView({ block: "nearest" });
                const r = ${rowSel}.getBoundingClientRect();
                return { x: Math.round(r.x + r.width / 2), y: Math.round(r.y + r.height / 2) };
            })()`);
            await h.cdp("Input.dispatchMouseEvent", { type: "mouseMoved", x: box.x, y: box.y });
            await until(`(() => {
                const b = ${rowSel}?.querySelector('[data-ideas-action="council"]');
                return b != null && getComputedStyle(b.parentElement).opacity === "1";
            })()`);
            const rowFacts = await h.ev(`(() => {
                const row = ${rowSel};
                const b = row?.querySelector('[data-ideas-action="council"]');
                return {
                    text: row?.querySelector("[data-ideas-text]")?.textContent ?? null,
                    button: (b?.textContent ?? "").trim(),
                    shown: b ? getComputedStyle(b.parentElement).opacity : null,
                };
            })()`);
            rec(
                "1. the agent's Ideas section lists the open question and, pointing at it, its actions include Ask the council",
                rowFacts.text === ASK_QUESTION && rowFacts.button === "Ask the council" && rowFacts.shown === "1",
                rowFacts
            );
            await h.ev(`${rowSel}?.querySelector('[data-ideas-action="council"]')?.click()`);

            // 2. Setup opens with the question, and the coordinator is asked about it
            await until(`${present("[data-council-setup]")}`);
            await until(`document.querySelectorAll("[data-council-expert]").length === 5`);
            const asked = await until(`${present("[data-council-suggesting]")}`, SUGGEST_WAIT_MS);
            let v = await view();
            const askCalls = await calls("CouncilSuggestCommand");
            rec(
                "2. Ask the council opens Setup with the Question holding the line, Start council waiting for a feature, and asks the coordinator once with that question",
                v?.question === ASK_QUESTION &&
                    v.feature === "" &&
                    v.start?.disabled === true &&
                    v.footnote === "Name the feature to review" &&
                    asked &&
                    v.suggesting === "Suggesting…" &&
                    askCalls.length === 1 &&
                    askCalls[0].data?.question === ASK_QUESTION &&
                    askCalls[0].data?.project === ctx.repo,
                { question: v?.question, feature: v?.feature, footnote: v?.footnote, suggesting: v?.suggesting, calls: askCalls }
            );

            // 3. the answer names the Paper review group: the group button and the rows follow it
            await resolveStub(h, "CouncilSuggestCommand", { files: [], roles: [], group: "paper" });
            await until(`(document.querySelector("[data-council-group]")?.textContent ?? "").trim() === "Paper review"`);
            v = await view();
            // the runner's own shot of this scenario (council-ask) is taken on arrival, before the question is asked
            await h.shot("cdp-shots/council-ask-paper.png");
            rec(
                "3. a suggestion naming the paper group makes the group button read Paper review, over the paper panel with its area chair last",
                v?.group === "Paper review" &&
                    v.experts.length === 4 &&
                    v.experts.at(-1)?.id === "areachair" &&
                    v.experts.at(-1)?.coordinator === true &&
                    v.experts.some((e) => e.id === "reader") &&
                    v.suggesting == null,
                { group: v?.group, experts: v?.experts.map((e) => e.id) }
            );

            // 4. the session rides along: starting from here sends it, so the directions come back into that session's Ideas
            await h.ev(setValue('[data-council-input="feature"]', "Rail apps"));
            await until(`document.querySelector("[data-council-start]")?.disabled === false`);
            await h.ev(click("[data-council-start]"));
            await until(`${present("[data-council-discussion]")}`);
            const startCalls = await calls("CouncilStartCommand");
            const sent = startCalls[0]?.data;
            rec(
                "4. Start council from Ask the council (stubbed) sends the question, the paper group and this agent's session, then opens the Discussion",
                startCalls.length === 1 &&
                    sent?.sessionid === ASK_SESSION &&
                    sent.question === ASK_QUESTION &&
                    sent.feature === "Rail apps" &&
                    sent.group === "paper" &&
                    sent.project === ctx.repo,
                { calls: startCalls.length, sessionid: sent?.sessionid, question: sent?.question, group: sent?.group }
            );
        } catch (e) {
            rec("the scenario stopped early: a page call failed", false, String(e?.message ?? e));
        }
        return steps;
    },

    async teardown(h, ctx) {
        const step = async (what, fn) => {
            try {
                await fn();
            } catch (e) {
                console.error(`council-ask teardown: ${what} failed: ${e?.message ?? e}`);
            }
        };
        if (ctx.wroteFixture) {
            await step("restore the fixture roster", () =>
                ctx.prevFixture != null ? writeFileSync(ROSTER_FIXTURE, ctx.prevFixture) : rmSync(ROSTER_FIXTURE, { force: true })
            );
        }
        if (ctx.ideasWritten && ctx.dataDir) {
            await step("delete the session's ideas", () => rmSync(join(ctx.dataDir, "ideas", `${ASK_SESSION}.json`), { force: true }));
        }
        if (ctx.prevKeys) {
            await step("put the rail's page state back", () =>
                h.ev(`(() => {
                    const prev = ${JSON.stringify(ctx.prevKeys)};
                    for (const [k, v] of Object.entries(prev)) {
                        if (v == null) localStorage.removeItem(k);
                        else localStorage.setItem(k, v);
                    }
                })()`)
            );
        }
        // this also reloads, onto the roster and the page state put back above
        await teardownCouncilProject(h, ctx);
    },
};
