// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0
//
// council-summary (docs/superpowers/plans/2026-10-21-council.md, Task 15): the Summary of the `done` council, its ranked
// directions and its matrix, and what it hands on. The hooks are called by councilscenarios.mjs as arrange(h, fx),
// assert(h, ctx, fx), teardown(h, ctx, fx).
//
// Nothing here calls a model. Summarize again, and the Setup that Run again opens (it may suggest roles when it shows),
// have their RpcApi commands replaced in the page. Brainstorm this opens an agent through launchAgent, which makes a
// tab with a real CreateTab and then writes the launch (the claude command and the prompt) with SetMetaCommand: that and
// AgentSyncApplyCommand are replaced, so the tab stays a plain shell, the recorded SetMetaCommand call holds the prompt,
// and teardown closes the tab. Save as doc writes into the temp project, and Create initiative makes an initiative that
// teardown deletes: both are real.

import { existsSync, readFileSync } from "node:fs";
import { waitFor } from "../attach.mjs";
import { openCouncil, rpcCalls, seedCouncil, stubRpc, teardownCouncilProject, arrangeCouncilProject } from "./fixtures.mjs";

const WAIT_MS = 10_000;
const SUMMARY = "[data-council-summary]";
const DIRECTION = (rank) => `${SUMMARY} [data-council-direction="${rank}"]`;

// the fixture's four directions, in rank order (rail-apps-done.json)
const TITLES = [
    "Move the rail pins from localStorage to settings",
    "Show asleep and waking on the rail icon",
    "Keep the last-used app awake, once a measurement allows it",
    "Show the empty rail slots with a pin hint",
];

const slashes = (p) => (p || "").replace(/\\/g, "/").replace(/\/+$/, "").toLowerCase();
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const q = (s) => JSON.stringify(s);

const exists = (h, sel) => h.ev(`!!document.querySelector(${q(sel)})`);
const textOf = (h, sel) => h.ev(`document.querySelector(${q(sel)})?.innerText?.replace(/\\s+/g, " ").trim() ?? null`);
const click = (h, sel) =>
    h.ev(`(() => { const el = document.querySelector(${q(sel)}); if (el == null || el.disabled) return false; el.click(); return true; })()`);
const until = (h, expr, ms = WAIT_MS) => waitFor((e) => h.ev(e), expr, ms);

// the Summary of the council, reopened (a step that left it for the Discussion or Setup comes back this way) and drawn
async function openSummary(h, ctx) {
    await openCouncil(h, ctx.councilId, "summary");
    // the root of an earlier council's Summary may still be up for a moment, so the council it shows is named too
    const drawn = `document.querySelector(${q(SUMMARY)})?.dataset.councilId === ${q(ctx.councilId)} &&
        document.querySelectorAll(${q(`${SUMMARY} [data-council-direction]`)}).length === 4`;
    if (!(await until(h, drawn))) {
        throw new Error("the Summary did not draw its four directions");
    }
}

// a direction opened (the open ones are kept in an atom, so a reopened Summary may have it open already)
async function openDirection(h, rank) {
    const toggle = `${DIRECTION(rank)} [data-council-direction-toggle]`;
    if ((await h.ev(`document.querySelector(${q(toggle)})?.getAttribute("aria-expanded")`)) !== "true") {
        await click(h, toggle);
    }
    if (!(await until(h, `!!document.querySelector(${q(`${DIRECTION(rank)} [data-council-direction-body]`)})`))) {
        throw new Error(`direction ${rank} did not open`);
    }
}

// true once a call of `name` that `pred` accepts has been recorded by the page's stand-ins, false past ms
async function callSeen(h, name, pred, ms = 5_000) {
    for (const start = Date.now(); ; ) {
        if ((await rpcCalls(h, name)).some(pred)) return true;
        if (Date.now() - start >= ms) return false;
        await sleep(200);
    }
}

// the tabs of the workspace, to find what a click opened
async function tabIds(h, ctx) {
    const list = await h.rpc("workspacelist", null);
    return list.find((w) => w.workspacedata?.oid === ctx.workspaceId)?.workspacedata?.tabids ?? [];
}

export const councilSummary = {
    async arrange(h, fx) {
        const ctx = await arrangeCouncilProject(h, fx);
        try {
            ctx.councilId = await seedCouncil(h, ctx, "done");
            ctx.efforts = [];
        } catch (e) {
            await teardownCouncilProject(h, ctx).catch(() => {});
            throw e;
        }
        return ctx;
    },

    async assert(h, ctx) {
        const steps = [];
        const step = async (name, run) => {
            try {
                const r = await run();
                steps.push({ step: name, ok: r.ok === true, detail: r.detail });
            } catch (e) {
                steps.push({ step: name, ok: false, detail: String(e?.message ?? e) });
            }
        };
        await openSummary(h, ctx);

        await step("the header: breadcrumb, title, state chip, written line and one chip per expert with its model", async () => {
            const header = await h.ev(`(() => {
                const root = document.querySelector(${q(SUMMARY)});
                const t = (s) => root.querySelector(s)?.innerText?.replace(/\\s+/g, " ").trim() ?? null;
                return {
                    back: t("[data-council-back]"),
                    title: t("h1"),
                    chip: t("[data-council-state-chip]"),
                    written: t("[data-council-written]"),
                    experts: [...root.querySelectorAll("[data-council-expert]")].map((e) => e.innerText.replace(/\\s+/g, " ").trim()),
                };
            })()`);
            const want = ["UX sonnet", "RAM sonnet", "New user sonnet", "Skeptic sonnet", "Coordinator opus"];
            const ok =
                header.back === "Discussion" &&
                header.title === "Summary · Rail apps" &&
                /Done · 4 experts · 3 rounds · \d+ min · [\d.]+M tokens/.test(header.chip ?? "") &&
                /^Written by the coordinator at \d\d:\d\d from 18 replies$/.test(header.written ?? "") &&
                header.experts.length === want.length &&
                want.every((w, i) => header.experts[i].endsWith(w));
            return { ok, detail: JSON.stringify(header) };
        });

        await step("the breadcrumb goes back to the Discussion", async () => {
            await click(h, "[data-council-back]");
            const shown = await until(h, `!!document.querySelector("[data-council-discussion]")`);
            await openSummary(h, ctx);
            return { ok: shown, detail: shown ? "the Discussion showed" : "[data-council-discussion] did not show" };
        });

        await step("four directions in rank order, the third Split, each with a stance chip per expert", async () => {
            const dirs = await h.ev(`[...document.querySelectorAll(${q(`${SUMMARY} [data-council-direction]`)})].map((d) => ({
                rank: d.dataset.councilDirection,
                title: d.querySelector("[data-council-title]")?.innerText ?? null,
                tag: d.querySelector("[data-council-tag]")?.innerText ?? null,
                chips: d.querySelectorAll("[data-council-chip]").length,
                open: d.querySelector("[data-council-direction-toggle]")?.getAttribute("aria-expanded"),
            }))`);
            const ok =
                dirs.length === 4 &&
                dirs.every((d, i) => d.rank === String(i + 1) && d.title === TITLES[i] && d.chips === 4 && d.open === "false") &&
                dirs[0].tag === "Agreed" &&
                dirs[2].tag === "Split";
            return { ok, detail: JSON.stringify(dirs.map((d) => [d.rank, d.tag, d.chips, d.open])) };
        });

        await step("direction 3 opens to its reasoning, each expert's position, a weak chip, its Ideas line and Brainstorm this", async () => {
            await openDirection(h, 3);
            const open = await h.ev(`(() => {
                const d = document.querySelector(${q(DIRECTION(3))});
                const body = d.querySelector("[data-council-direction-body]");
                return {
                    reasoning: body.querySelector("[data-council-reasoning]")?.innerText ?? null,
                    positions: [...body.querySelectorAll("[data-council-position]")].map((p) => p.dataset.councilPosition),
                    weak: [...body.querySelectorAll('[data-council-evidence="weak"]')].map((e) => e.innerText.trim()),
                    refs: [...body.querySelectorAll('[data-council-evidence="ref"]')].map((e) => e.innerText.trim()),
                    idea: body.querySelector("[data-council-idea]")?.innerText ?? null,
                    brainstorm: body.querySelector('[data-council-action="brainstorm"]')?.innerText ?? null,
                    askAgain: body.querySelector('[data-council-action="ask-again"]')?.innerText ?? null,
                    meta: d.querySelector("[data-council-meta]")?.innerText ?? null,
                };
            })()`);
            const ok =
                /P2 and P3 meet in one step/.test(open.reasoning ?? "") &&
                open.positions.join() === "ux,ram,newuser,skeptic" &&
                open.weak.length === 1 &&
                open.weak[0] === 'Weak · "about 3 s" has no measurement' &&
                open.refs.includes("pkg/services/model.go:36") &&
                open.idea === "In Ideas as fx-idea-3" &&
                open.brainstorm === "Brainstorm this" &&
                open.askAgain === "Ask the experts again" &&
                open.meta === "Merged UX P2 + RAM P3 · 1 file · 1 weak claim · in Ideas";
            await h.shot("cdp-shots/council-summary.png");
            return { ok, detail: JSON.stringify(open) };
        });

        await step("Jump to the matrix brings it into the scroller's view: six rows, Withdrawn in round 2 on P6", async () => {
            const place = `(() => {
                const sc = document.querySelector("[data-council-scroll]");
                const m = document.getElementById("council-matrix");
                const s = sc.getBoundingClientRect();
                return { top: Math.round(m.getBoundingClientRect().top - s.top), height: Math.round(s.height) };
            })()`;
            await h.ev(`document.querySelector("[data-council-scroll]").scrollTop = 0`);
            const before = await h.ev(place);
            await click(h, "[data-council-jump]");
            await sleep(300);
            const after = await h.ev(place);
            const rows = await h.ev(`[...document.querySelectorAll("#council-matrix tbody tr")].map((r) => ({
                id: r.dataset.councilMatrixRow,
                outcome: r.querySelector("[data-council-matrix-outcome]")?.innerText?.trim() ?? null,
                cells: r.querySelectorAll("[data-council-matrix-cell]").length,
            }))`);
            await h.shot("cdp-shots/council-summary-matrix.png");
            const ok =
                after.top >= -1 &&
                after.top < after.height &&
                rows.map((r) => r.id).join() === "P5,P1,P2,P3,P4,P6" &&
                rows.every((r) => r.cells === 4) &&
                rows.find((r) => r.id === "P6")?.outcome === "Withdrawn in round 2";
            return { ok, detail: JSON.stringify({ before, after, rows: rows.map((r) => [r.id, r.outcome]) }) };
        });

        await step("the banner reads Outdated · 1 reply since, and Summarize again (stubbed) records one summarize call", async () => {
            await stubRpc(h, ["CouncilSummarizeCommand"]);
            const banner = await textOf(h, "[data-council-banner='outdated']");
            const clicked = await click(h, "[data-council-action='summarize-again']");
            await callSeen(h, "CouncilSummarizeCommand", () => true);
            const calls = await rpcCalls(h, "CouncilSummarizeCommand");
            const ok = banner === "Outdated · 1 reply since" && clicked && calls.length === 1 && calls[0].data?.id === ctx.councilId;
            return { ok, detail: JSON.stringify({ banner, clicked, calls }) };
        });

        await step("Save as doc writes the doc into the project and shows its path", async () => {
            await click(h, "[data-council-action='save-doc']");
            const shown = await until(h, `!!document.querySelector("[data-council-doc-saved]")`);
            const saved = await h.ev(`(() => {
                const el = document.querySelector("[data-council-doc-saved]");
                return el == null ? null : { path: el.dataset.path, text: el.innerText.replace(/\\s+/g, " ").trim() };
            })()`);
            const path = saved?.path ?? "";
            const inProject = slashes(path).startsWith(`${slashes(ctx.repo)}/docs/council/`);
            const body = shown && existsSync(path) ? readFileSync(path, "utf8") : "";
            const ok = shown && inProject && /\.md$/.test(path) && body.includes("# Council: Rail apps") && body.includes("## Matrix") && /docs\/council\/.+\.md/.test(saved.text);
            return { ok, detail: JSON.stringify({ saved, exists: existsSync(path) }) };
        });

        await step("Create initiative makes an initiative named after the feature with a chunk per direction", async () => {
            await click(h, "[data-council-action='initiative']");
            const shown = await until(h, `!!document.querySelector("[data-council-initiative-made]")`);
            const oid = shown ? await h.ev(`document.querySelector("[data-council-initiative-made]").dataset.effortOid`) : null;
            if (oid) ctx.efforts.push(oid);
            const effort = oid ? (await h.rpc("effortget", { effortoid: oid })).effort : null;
            const labels = (effort?.chunks ?? []).map((c) => c.label);
            const ok = effort != null && effort.title === "Rail apps" && effort.project === ctx.project && labels.join("|") === TITLES.join("|");
            return { ok, detail: JSON.stringify({ oid, title: effort?.title, project: effort?.project, labels }) };
        });

        await step("Run again opens Setup with the feature, files and experts of the council", async () => {
            // Setup may ask for roles when it shows a feature and a file: never for real
            await stubRpc(h, ["CouncilSuggestCommand", "CouncilStartCommand"], {
                CouncilSuggestCommand: { value: { files: [], roles: [], group: "" } },
            });
            await click(h, "[data-council-action='run-again']");
            const shown = await until(h, `!!document.querySelector("[data-council-setup]")`);
            // the text of the form and what its inputs hold
            const form = shown
                ? await h.ev(`(() => {
                      const root = document.querySelector("[data-council-setup]");
                      const fields = [...root.querySelectorAll("input, textarea")].map((e) => e.value);
                      return [root.innerText, ...fields].join("\\n");
                  })()`)
                : "";
            const wants = ["Rail apps", "railapps.ts", "railappsstore.ts", "model.go", "UX", "RAM", "New user", "Skeptic"];
            const missing = wants.filter((w) => !form.includes(w));
            await openSummary(h, ctx);
            return { ok: shown && missing.length === 0, detail: shown ? `missing: ${JSON.stringify(missing)}` : "[data-council-setup] did not show" };
        });

        // Summarize on the Discussion returns once the run has launched, so the Summary opens on a council that is running
        // at round 3: with the old summary it says so in a banner, with none it says the coordinator is writing it
        await step("a council synthesizing again keeps its old summary under an Updating banner, or says it is being written", async () => {
            const edited = (id, edit) => seedCouncil(h, ctx, "done", { id, edit });
            const again = await edited("fx-council-resumming", (c) => {
                c.state = "running";
                c.round = 3;
                c.activity = { coordinator: { text: "Writing the summary" } };
            });
            await openCouncil(h, again, "summary");
            const bannerShown = await until(h, `!!document.querySelector("[data-council-banner='running']")`);
            const withOld = await h.ev(`({
                banner: document.querySelector("[data-council-banner='running']")?.innerText ?? null,
                outdated: !!document.querySelector("[data-council-banner='outdated']"),
                directions: document.querySelectorAll("[data-council-summary] [data-council-direction]").length,
            })`);
            const none = await edited("fx-council-writing", (c) => {
                c.state = "running";
                c.round = 3;
                c.activity = { coordinator: { text: "Writing the summary" } };
                delete c.summary;
            });
            await openCouncil(h, none, "summary");
            const writingShown = await until(h, `!!document.querySelector("[data-council-nosummary]")`);
            const writing = await textOf(h, "[data-council-nosummary]");
            await openSummary(h, ctx);
            const ok =
                bannerShown &&
                withOld.banner === "Updating the summary…" &&
                !withOld.outdated &&
                withOld.directions === 4 &&
                writingShown &&
                writing === "The coordinator is writing the summary…";
            return { ok, detail: JSON.stringify({ withOld, writing }) };
        });

        // after a failed synthesis the council is failed with the old summary kept: Retry reruns the coordinator's call
        await step("a failed synthesis keeps the old summary, with the error and Retry on the coordinator", async () => {
            const failed = await seedCouncil(h, ctx, "done", {
                id: "fx-council-synthfailed",
                edit: (c) => {
                    c.state = "failed";
                    c.failed = { coordinator: { round: 3, error: "the model was overloaded" } };
                    c.error = "the coordinator failed in round 3";
                },
            });
            await stubRpc(h, ["CouncilRetryCommand"]);
            await openCouncil(h, failed, "summary");
            const shown = await until(h, `!!document.querySelector("[data-council-banner='failed']")`);
            const banner = await textOf(h, "[data-council-banner='failed']");
            const directions = await h.ev(`document.querySelectorAll("[data-council-summary] [data-council-direction]").length`);
            const clicked = await click(h, "[data-council-action='retry']");
            await callSeen(h, "CouncilRetryCommand", () => true);
            const calls = await rpcCalls(h, "CouncilRetryCommand");
            await openSummary(h, ctx);
            const ok =
                shown &&
                banner === "The coordinator failed: the model was overloaded" &&
                directions === 4 &&
                clicked &&
                calls.length === 1 &&
                calls[0].data?.id === failed &&
                calls[0].data?.expertid === "coordinator";
            return { ok, detail: JSON.stringify({ banner, directions, calls }) };
        });

        await step("Ask the experts again on direction 1 opens the Discussion on its first proposal", async () => {
            await openDirection(h, 1);
            const before = await h.ev(`window.__arcCouncil.openProposal(${q(ctx.councilId)})`);
            await click(h, `${DIRECTION(1)} [data-council-action='ask-again']`);
            const shown = await until(h, `!!document.querySelector("[data-council-discussion]")`);
            const open = await h.ev(`window.__arcCouncil.openProposal(${q(ctx.councilId)})`);
            // the Discussion draws the open proposal as a post of its own
            const post = await until(h, `!!document.querySelector("[data-council-discussion] [data-council-post='P5']")`);
            await openSummary(h, ctx);
            return { ok: shown && open === "P5" && post, detail: JSON.stringify({ shown, before, open, post }) };
        });

        await step("Brainstorm this (the launch stubbed) records a prompt with the direction and opens no agent", async () => {
            await stubRpc(h, ["SetMetaCommand", "AgentSyncApplyCommand"]);
            await openDirection(h, 3);
            const tabsBefore = new Set(await tabIds(h, ctx));
            const clicked = await click(h, `${DIRECTION(3)} [data-council-action='brainstorm']`);
            // the launch writes the block's meta, then the tab's
            const wrote = await callSeen(h, "SetMetaCommand", (c) => String(c.data?.oref).startsWith("tab:"), 15_000);
            // whatever tab the click made goes at teardown, however far the launch got
            for (const tabId of await tabIds(h, ctx)) {
                if (!tabsBefore.has(tabId)) ctx.terminals.push({ tabId });
            }
            const calls = await rpcCalls(h, "SetMetaCommand");
            const launch = calls.find((c) => Array.isArray(c.data?.meta?.["cmd:args"]));
            const prompt = String(launch?.data?.meta?.["cmd:args"]?.[0] ?? "");
            const ok =
                clicked &&
                wrote &&
                launch?.data?.meta?.cmd === "claude" &&
                slashes(launch.data.meta["cmd:cwd"]) === slashes(ctx.repo) &&
                prompt.includes(TITLES[2]) &&
                prompt.includes("wsh idea add") &&
                prompt.includes("P2") &&
                (await rpcCalls(h, "AgentSyncApplyCommand")).length >= 1;
            return { ok, detail: JSON.stringify({ clicked, wrote, cmd: launch?.data?.meta?.cmd, cwd: launch?.data?.meta?.["cmd:cwd"], prompt: prompt.slice(0, 160) }) };
        });

        return steps;
    },

    async teardown(h, ctx) {
        for (const oid of ctx.efforts ?? []) {
            await h.rpc("effortdelete", { effortoid: oid }).catch((e) => console.error(`council summary: delete ${oid} failed: ${e?.message ?? e}`));
        }
        // an initiative a failed step made and never reported
        try {
            const list = await h.rpc("effortlist", { project: ctx.project, includearchived: true });
            for (const e of list?.efforts ?? []) {
                if (e.title === "Rail apps") await h.rpc("effortdelete", { effortoid: String(e.oref).replace(/^effort:/, "") });
            }
        } catch (e) {
            console.error(`council summary: sweeping the initiatives failed: ${e?.message ?? e}`);
        }
        await teardownCouncilProject(h, ctx);
    },
};
