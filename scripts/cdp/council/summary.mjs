// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0
//
// council-summary (docs/superpowers/plans/2026-10-21-council.md, Task 15; the report: docs/superpowers/plans/
// 2026-10-22-council-v1-ui.md, Task 4): the Summary of the `done` council, the report it opens on (what was asked, the
// answer, the ranked directions and the matrix folded under them), and what it hands on. The hooks are called by councilscenarios.mjs as arrange(h, fx),
// assert(h, ctx, fx), teardown(h, ctx, fx).
//
// Nothing here calls a model. Summarize again, and the Setup that Run again opens (it may suggest roles when it shows),
// have their RpcApi commands replaced in the page. Start an agent on it opens an agent through launchAgent, which makes a
// tab with a real CreateTab and then writes the launch (the claude command and the prompt) with SetMetaCommand: that and
// AgentSyncApplyCommand are replaced, so the tab stays a plain shell, the recorded SetMetaCommand call holds the prompt,
// and teardown closes the tab. Save as doc writes into the temp project, and Create initiative makes an initiative that
// teardown deletes: both are real.
//
// The last two steps are the Brainstorm report (docs/superpowers/plans/2026-10-22-council-v1-room.md, Task 5): a done
// fixture seeded as a Brainstorm, with a saved document written into the temp project first so Open the document opens it.

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { SURFACE_LABEL, waitFor } from "../attach.mjs";
import {
    arrangeCouncilProject,
    loadCouncilFixture,
    openCouncil,
    rpcCalls,
    seedCouncil,
    stubRpc,
    teardownCouncilProject,
} from "./fixtures.mjs";

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

// an action behind the `⋯` menu: open the menu, then click the item (false when it is missing or disabled)
async function menuClick(h, action) {
    await click(h, "[data-council-menu]");
    if (!(await until(h, `!!document.querySelector(${q(`[role="menuitem"][data-council-action="${action}"]`)})`))) {
        return false;
    }
    return click(h, `[role="menuitem"][data-council-action="${action}"]`);
}

// the first sentence of the fixture's summary text: what the report's bold line reads for a council with no answer
const FIRST_SENTENCE = loadCouncilFixture("done").summary.text.match(/^.*?[.!?](?=\s|$)/)[0];

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

// the `⋯` menu's items as `action=label`, opened and closed again (a click on its button toggles it)
async function menuItems(h) {
    await click(h, "[data-council-menu]");
    await until(h, `!!document.querySelector('[role="menu"]')`);
    const items = await h.ev(
        `[...document.querySelectorAll('[role="menuitem"][data-council-action]')].map((b) => b.dataset.councilAction + "=" + b.innerText.trim())`
    );
    await click(h, "[data-council-menu]");
    return items;
}

// the Summary of a Brainstorm council opened by id, drawn once its three directions are (not openSummary's four)
async function openBrainstormSummary(h, id) {
    await openCouncil(h, id, "summary");
    const drawn = `document.querySelector(${q(SUMMARY)})?.dataset.councilId === ${q(id)} &&
        document.querySelectorAll(${q(`${SUMMARY} [data-council-direction]`)}).length === 3`;
    if (!(await until(h, drawn))) {
        throw new Error("the Summary did not draw its three directions");
    }
}

// what a Brainstorm report shows, reduced to what a step reads
const BRAINSTORM_FACTS = `(() => {
    const root = document.querySelector(${q(SUMMARY)});
    const t = (el) => el?.innerText?.replace(/\\s+/g, " ").trim() ?? null;
    const all = (sel) => [...root.querySelectorAll(sel)];
    return {
        heading: t(root.querySelector("[data-council-directions-heading]")),
        titles: all("[data-council-direction] [data-council-title]").map(t),
        steps: all("[data-council-direction] [data-council-first-step]").map(t),
        meta: all("[data-council-direction] [data-council-meta]").map(t),
        keptHeading: t(root.querySelector("[data-council-kept] h2")),
        kept: all("[data-council-kept-idea]").map((k) => ({
            title: t(k.querySelector("[data-council-title]")),
            meta: t(k.querySelector("[data-council-meta]")),
        })),
        dropped: t(root.querySelector("[data-council-dropped]")),
        docpath: t(root.querySelector("[data-council-docpath]")),
        docSaved: !!root.querySelector("[data-council-doc-saved]"),
    };
})()`;

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

        await step("the header: title, state chip, Show the discussion, the ⋯ menu and one chip per expert with its model", async () => {
            const header = await h.ev(`(() => {
                const root = document.querySelector(${q(SUMMARY)});
                const t = (s) => root.querySelector(s)?.innerText?.replace(/\\s+/g, " ").trim() ?? null;
                return {
                    back: t("[data-council-action='discussion']"),
                    menu: !!root.querySelector("[data-council-menu]"),
                    title: t("h1"),
                    chip: t("[data-council-state-chip]"),
                    written: t("[data-council-written]"),
                    experts: [...root.querySelectorAll("[data-council-expert]")].map((e) => e.innerText.replace(/\\s+/g, " ").trim()),
                };
            })()`);
            const want = ["UX sonnet", "RAM sonnet", "New user sonnet", "Skeptic sonnet", "Coordinator opus"];
            const ok =
                header.back === "Show the discussion" &&
                header.menu &&
                header.title === "Council · Rail apps" &&
                /^Done · 4 experts · \d+ min · [\d.]+M tokens$/.test(header.chip ?? "") &&
                /^Written by the coordinator at \d\d:\d\d from 18 replies$/.test(header.written ?? "") &&
                header.experts.length === want.length &&
                want.every((w, i) => header.experts[i].endsWith(w));
            return { ok, detail: JSON.stringify(header) };
        });

        await step("Show the discussion goes back to the Discussion", async () => {
            await click(h, "[data-council-action='discussion']");
            const shown = await until(h, `!!document.querySelector("[data-council-discussion]")`);
            await openSummary(h, ctx);
            return { ok: shown, detail: shown ? "the Discussion showed" : "[data-council-discussion] did not show" };
        });

        await step("a finished council opened from its tree row lands on the Summary, asking what was asked and opening on the first sentence", async () => {
            await openCouncil(h, ctx.councilId, "discussion");
            const row = `[data-council-row="${ctx.councilId}"]`;
            const rowShown = await until(h, `!!document.querySelector(${q(row)})`);
            await click(h, row);
            const landed = await until(h, `document.querySelector(${q(SUMMARY)})?.dataset.councilId === ${q(ctx.councilId)}`);
            const asked = await textOf(h, `${SUMMARY} [data-council-asked]`);
            const answer = await h.ev(`(() => {
                const el = document.querySelector(${q(`${SUMMARY} [data-council-answer]`)});
                return el == null ? null : { text: el.innerText.replace(/\\s+/g, " ").trim(), weight: Number(getComputedStyle(el).fontWeight) };
            })()`);
            const ok =
                rowShown &&
                landed &&
                /^You asked: Which changes to pinned apps/.test(asked ?? "") &&
                answer?.text === FIRST_SENTENCE &&
                answer.weight >= 600;
            return { ok, detail: JSON.stringify({ rowShown, landed, asked, answer, want: FIRST_SENTENCE }) };
        });

        await step("a council with an answer opens on it in bold, with the whole summary text under it", async () => {
            const answer = "Do the pins first: they are cheap and nobody objects.";
            const id = await seedCouncil(h, ctx, "done", {
                id: "fx-council-answered",
                edit: (c) => {
                    c.summary.answer = answer;
                },
            });
            await openCouncil(h, id, "summary");
            const shown = await until(h, `document.querySelector(${q(`${SUMMARY} [data-council-answer]`)})?.innerText === ${q(answer)}`);
            const rest = await textOf(h, `${SUMMARY} [data-council-summary-text]`);
            const full = loadCouncilFixture("done").summary.text.replace(/\s+/g, " ").trim();
            await openSummary(h, ctx);
            return { ok: shown && rest === full, detail: JSON.stringify({ shown, rest }) };
        });

        await step("a council without a question shows no You asked line", async () => {
            const id = await seedCouncil(h, ctx, "done", {
                id: "fx-council-noquestion",
                edit: (c) => {
                    delete c.question;
                },
            });
            await openCouncil(h, id, "summary");
            const drawn = await until(h, `document.querySelector(${q(`${SUMMARY} [data-council-answer]`)})?.innerText === ${q(FIRST_SENTENCE)}`);
            const asked = await exists(h, `${SUMMARY} [data-council-asked]`);
            const text = await h.ev(`document.querySelector(${q(SUMMARY)}).innerText`);
            await openSummary(h, ctx);
            return { ok: drawn && !asked && !/You asked/.test(text), detail: JSON.stringify({ drawn, asked }) };
        });

        await step("no proposal id shows anywhere in the Summary's text, directions closed and the matrix folded", async () => {
            const text = await h.ev(`document.querySelector(${q(SUMMARY)}).innerText`);
            const ids = text.match(/\bP\d+\b/g) ?? [];
            return { ok: ids.length === 0 && text.length > 0, detail: JSON.stringify({ ids }) };
        });

        await step("four directions in rank order, each tagged in words, each with a stance chip per expert", async () => {
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
                dirs.map((d) => d.tag).join("|") ===
                    "Everyone agrees|Skeptic has doubts|RAM is against it|Skeptic is against it";
            return { ok, detail: JSON.stringify(dirs.map((d) => [d.rank, d.tag, d.chips, d.open])) };
        });

        await step("direction 3 opens to its reasoning, each expert's position, a weak chip, its Ideas line and Start an agent on it", async () => {
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
                    chips: Object.fromEntries([...d.querySelectorAll("[data-council-chip]")].map((c) => [c.dataset.councilChip, c.innerText.replace(/\\s+/g, " ").trim()])),
                };
            })()`);
            const ok =
                /P2 and P3 meet in one step/.test(open.reasoning ?? "") &&
                open.positions.join() === "ux,ram,newuser,skeptic" &&
                open.weak.length === 1 &&
                open.weak[0] === 'Weak · "about 3 s" has no measurement' &&
                open.refs.includes("pkg/services/model.go:36") &&
                open.idea === "In Ideas as fx-idea-3" &&
                open.brainstorm === "Start an agent on it" &&
                open.askAgain === "Ask the experts again" &&
                open.meta === "from UX and RAM · 1 file · 1 weak claim · in Ideas" &&
                // the chip's text starts with the expert's avatar letter
                open.chips.ram.endsWith(" Is against it") &&
                open.chips.skeptic.endsWith(" Has doubts") &&
                open.chips.newuser.endsWith(" Agrees") &&
                open.chips.ux.endsWith(" Proposed");
            await h.shot("cdp-shots/council-summary.png");
            return { ok, detail: JSON.stringify(open) };
        });

        await step("the matrix is folded under Every expert on every idea, and unfolds to six rows by idea title, Withdrawn on the sixth", async () => {
            const toggle = "[data-council-matrix-toggle]";
            const label = await textOf(h, toggle);
            const foldedRows = await h.ev(`document.querySelectorAll("#council-matrix tbody tr").length`);
            const before = await h.ev(`document.querySelector(${q(toggle)})?.getAttribute("aria-expanded")`);
            await click(h, toggle);
            const unfolded = await until(h, `document.querySelectorAll("#council-matrix tbody tr").length === 6`);
            const rows = await h.ev(`[...document.querySelectorAll("#council-matrix tbody tr")].map((r) => ({
                id: r.dataset.councilMatrixRow,
                first: r.querySelector("td")?.innerText?.replace(/\\s+/g, " ").trim() ?? null,
                text: r.innerText,
                outcome: r.querySelector("[data-council-matrix-outcome]")?.innerText?.trim() ?? null,
                cells: r.querySelectorAll("[data-council-matrix-cell]").length,
            }))`);
            await h.ev(`document.getElementById("council-matrix").scrollIntoView({ block: "start" })`);
            await h.shot("cdp-shots/council-summary-matrix.png");
            const ok =
                label?.startsWith("Every expert on every idea") &&
                foldedRows === 0 &&
                before === "false" &&
                unfolded &&
                rows.map((r) => r.id).join() === "P5,P1,P2,P3,P4,P6" &&
                rows.every((r) => r.cells === 4 && !/\bP\d+\b/.test(r.text)) &&
                rows.find((r) => r.id === "P6")?.first?.startsWith("Drop the cap of 3 apps") &&
                rows.find((r) => r.id === "P6")?.outcome === "Withdrawn";
            return { ok, detail: JSON.stringify({ label, foldedRows, before, rows: rows.map((r) => [r.id, r.first?.slice(0, 40), r.outcome]) }) };
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

        await step("Save as doc (in the ⋯ menu) writes the doc into the project and shows its path", async () => {
            await menuClick(h, "save-doc");
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

        await step("Create initiative (in the ⋯ menu) makes an initiative named after the feature with a chunk per direction", async () => {
            await menuClick(h, "initiative");
            const shown = await until(h, `!!document.querySelector("[data-council-initiative-made]")`);
            const oid = shown ? await h.ev(`document.querySelector("[data-council-initiative-made]").dataset.effortOid`) : null;
            if (oid) ctx.efforts.push(oid);
            const effort = oid ? (await h.rpc("effortget", { effortoid: oid })).effort : null;
            const labels = (effort?.chunks ?? []).map((c) => c.label);
            const ok = effort != null && effort.title === "Rail apps" && effort.project === ctx.project && labels.join("|") === TITLES.join("|");
            return { ok, detail: JSON.stringify({ oid, title: effort?.title, project: effort?.project, labels }) };
        });

        await step("Run again (in the ⋯ menu) opens Setup with the feature, files and experts of the council", async () => {
            // Setup may ask for roles when it shows a feature and a file: never for real
            await stubRpc(h, ["CouncilSuggestCommand", "CouncilStartCommand"], {
                CouncilSuggestCommand: { value: { files: [], roles: [], group: "" } },
            });
            await menuClick(h, "run-again");
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

        await step("Start an agent on it (the launch stubbed) records a prompt with the direction and its ideas by title, and opens no agent", async () => {
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
                prompt.includes('"Keep the last-used pinned app awake" by UX') &&
                (await rpcCalls(h, "AgentSyncApplyCommand")).length >= 1;
            return { ok, detail: JSON.stringify({ clicked, wrote, cmd: launch?.data?.meta?.cmd, cwd: launch?.data?.meta?.["cmd:cwd"], prompt: prompt.slice(0, 160) }) };
        });

        // The done fixture as a Brainstorm: its fourth direction becomes a wild idea kept aside, the other three carry a first
        // step, New user builds on the Skeptic's idea (direction 1), and the Skeptic's other idea (P6) is in no direction and
        // not kept. Its document was saved into the project, so the `⋯` menu opens it instead of saving one.
        const DOC_REL = "docs/council/2026-10-22-x.md";
        await step("a Brainstorm report heads three ideas worth trying, each with a first step and who had and built on it, keeps the wild idea aside, counts the rest, says where it saved itself, and opens that document in Code", async () => {
            await h.goto("agent");
            const doc = join(ctx.repo, ...DOC_REL.split("/"));
            mkdirSync(dirname(doc), { recursive: true });
            writeFileSync(doc, "# Council: Rail apps\n\nA brainstorm, saved with its whole discussion.\n");
            const id = await seedCouncil(h, ctx, "done", {
                id: "fx-council-brainstorm",
                edit: (c) => {
                    const ds = c.summary.directions;
                    c.mode = "brainstorm";
                    c.summary.kept = [{ ...ds[3], rank: 1 }];
                    c.summary.directions = ds.slice(0, 3).map((d) => ({ ...d, firststep: "Try it on one screen" }));
                    const prior = c.replies.find((r) => r.id === "r15");
                    c.replies.push({
                        id: "rb1",
                        proposalid: "P5",
                        author: "newuser",
                        text: "and the pin could carry the hint too",
                        round: 2,
                        ts: prior.ts + 1000,
                        builds: true,
                    });
                    c.docpath = doc;
                },
            });
            await openBrainstormSummary(h, id);
            const facts = await h.ev(BRAINSTORM_FACTS);
            await h.shot("cdp-shots/council-summary-brainstorm.png");
            const items = await menuItems(h);
            await menuClick(h, "open-doc");
            const inCode = await until(h, `document.querySelector("[data-code-path]")?.getAttribute("data-code-path") === ${q(DOC_REL)}`);
            const surface = await h.activeSurfaceLabel();
            // back on the Agent surface for the steps that follow
            await h.goto("agent");
            await openSummary(h, ctx);
            const ok =
                facts.heading === "Ideas worth trying, best first" &&
                facts.titles.join("|") === TITLES.slice(0, 3).join("|") &&
                facts.steps.length === 3 &&
                facts.steps.every((s) => s === "First step: Try it on one screen") &&
                facts.meta[0].startsWith("Had it: Skeptic · built on by New user") &&
                facts.meta[1].startsWith("Had it: UX") &&
                !facts.meta[1].includes("built on by") &&
                facts.meta[2].startsWith("Had it: UX and RAM") &&
                facts.keptHeading === "Wild ideas kept aside" &&
                facts.kept.length === 1 &&
                facts.kept[0].title === TITLES[3] &&
                facts.kept[0].meta === "Had it: New user" &&
                facts.dropped === "1 more idea merged or dropped" &&
                facts.docpath === `Saved to ${DOC_REL} with the whole discussion` &&
                !facts.docSaved &&
                items.includes("open-doc=Open the document") &&
                !items.some((i) => i.startsWith("save-doc=")) &&
                inCode &&
                surface === SURFACE_LABEL.code;
            return { ok, detail: JSON.stringify({ facts, items, inCode, surface }) };
        });

        await step("a Brainstorm that kept nothing aside shows no kept section and offers Save as doc until it has saved itself, and a Review report shows none of the Brainstorm parts", async () => {
            const id = await seedCouncil(h, ctx, "done", {
                id: "fx-council-brainstorm-nokept",
                edit: (c) => {
                    c.mode = "brainstorm";
                    c.summary.kept = [];
                    c.summary.directions = c.summary.directions.slice(0, 3);
                },
            });
            await openBrainstormSummary(h, id);
            const facts = await h.ev(BRAINSTORM_FACTS);
            const items = await menuItems(h);
            await openSummary(h, ctx);
            const review = await h.ev(BRAINSTORM_FACTS);
            const reviewItems = await menuItems(h);
            const ok =
                facts.heading === "Ideas worth trying, best first" &&
                facts.keptHeading == null &&
                facts.kept.length === 0 &&
                facts.dropped === "2 more ideas merged or dropped" &&
                facts.docpath == null &&
                items.includes("save-doc=Save as doc") &&
                !items.some((i) => i.startsWith("open-doc=")) &&
                review.heading == null &&
                review.steps.length === 0 &&
                review.keptHeading == null &&
                review.dropped == null &&
                review.docpath == null &&
                reviewItems.includes("save-doc=Save as doc");
            return { ok, detail: JSON.stringify({ facts, items, review, reviewItems }) };
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
