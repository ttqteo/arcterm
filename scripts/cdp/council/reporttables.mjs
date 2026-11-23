// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0
//
// council-report-tables (docs/superpowers/plans/2026-11-23-council-report-tables.md, Task 6; spec decision 5, planning
// decisions 4, 8 and 10): the Report's two tables first under the answer, and At a glance folded under About the council.
// The council is the `report-tables` fixture: a finished Review in Vietnamese, one direction with every task field (task,
// why, kind, files) and one with none (its row falls back to the title and the reasoning's first sentence, File and Loại
// "—"), two figures Go verified and one it found wrong. The steps: Việc cần làm first under the answer; Số liệu lists only
// the verified figures with their `path:line`; About the council is folded until opened, then holds At a glance and the
// failed figure with its note; at a narrow pane the tables fit without the page scrolling sideways; an English council
// (the `done` fixture) heads its table in English.
//
// The hooks are called by councilscenarios.mjs as arrange(h, fx), assert(h, ctx, fx), teardown(h, ctx, fx). Nothing here
// calls a model or spends a token: the councils are written into the data dir (fixtures.mjs `seedCouncil`).

import { waitFor } from "../attach.mjs";
import { arrangeCouncilProject, openCouncil, seedCouncil, teardownCouncilProject } from "./fixtures.mjs";

const WAIT_MS = 10_000;
const SUMMARY = "[data-council-summary]";
const TODO = '[data-council-section="todo"]';
const FIGURES = '[data-council-section="figures"]';
const ABOUT = '[data-council-section="about"]';
const TOGGLE = "[data-council-about-toggle]";

const q = (s) => JSON.stringify(s);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const until = (h, expr, ms = WAIT_MS) => waitFor((e) => h.ev(e), expr, ms);

// the step runner the council scenarios share: a thrown step is a failed one, with its message
function stepper(steps) {
    return async (name, run) => {
        try {
            const r = await run();
            steps.push({ step: name, ok: r.ok === true, detail: r.detail });
        } catch (e) {
            steps.push({ step: name, ok: false, detail: String(e?.message ?? e) });
        }
    };
}

// the Report of a council, drawn down to its directions
async function openReport(h, id, directions) {
    await openCouncil(h, id, "summary");
    const drawn = `document.querySelector(${q(SUMMARY)})?.dataset.councilId === ${q(id)} &&
        document.querySelectorAll("[data-council-direction]").length === ${directions} &&
        !!document.querySelector(${q(TODO)})`;
    if (!(await until(h, drawn))) throw new Error(`the Report of ${id} did not draw its directions and its to-do table`);
    // the sections fade in as they mount
    await sleep(500);
    await h.ev(`document.querySelector("${SUMMARY} [data-council-scroll]").scrollTop = 0`);
}

// a table section's heading, column heads and rows, each row's cells as text, whitespace folded
const tableOf = (sel) => `(() => {
    const s = document.querySelector(${q(sel)});
    const t = (el) => el?.innerText?.replace(/\\s+/g, " ").trim() ?? null;
    if (s == null) return null;
    return {
        heading: t(s.querySelector("h2")),
        heads: [...s.querySelectorAll("thead th")].map(t),
        rows: [...s.querySelectorAll("tbody tr")].map((r) => [...r.children].map(t)),
    };
})()`;

export const councilReportTables = {
    async arrange(h, fx) {
        const ctx = await arrangeCouncilProject(h, fx);
        try {
            ctx.councilId = await seedCouncil(h, ctx, "report-tables");
            ctx.englishId = await seedCouncil(h, ctx, "done");
        } catch (e) {
            await teardownCouncilProject(h, ctx).catch(() => {});
            throw e;
        }
        return ctx;
    },

    async assert(h, ctx) {
        const steps = [];
        const step = stepper(steps);
        await openReport(h, ctx.councilId, 2);

        await step("the Report opens with Việc cần làm first under the answer, a row per direction, the row with no task fields falling back to its title and reasoning with — in File and Loại", async () => {
            const table = await h.ev(tableOf(TODO));
            const facts = await h.ev(`(() => {
                const root = document.querySelector(${q(SUMMARY)});
                const after = (a, b) => !!a && !!b && !!(a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING);
                const cover = root.querySelector("[data-council-cover]");
                const todo = root.querySelector(${q(TODO)});
                const sections = [...root.querySelectorAll("[data-council-section]")].map((s) => s.dataset.councilSection);
                return {
                    sections,
                    afterCover: after(cover, todo),
                    beforeDirections: after(todo, root.querySelector("[data-council-direction]")),
                    rowMarks: [...todo.querySelectorAll("[data-council-todo-row]")].map((r) => r.dataset.councilTodoRow).join(","),
                    jumps: [...root.querySelectorAll("[data-council-tabbar] [data-council-jump]")].map((j) => j.dataset.councilJump).join(","),
                };
            })()`);
            await h.shot("cdp-shots/council-report-tables-todo.png");
            const [one, two] = table?.rows ?? [];
            const ok =
                table?.heading === "Việc cần làm" &&
                table.heads.join("|") === "#|Việc|Vì sao|File đụng tới|Loại" &&
                table.rows.length === 2 &&
                facts.rowMarks === "1,2" &&
                // the first section under the cover (the answer's) is the to-do table, and it comes before the cards
                facts.sections.slice(0, 2).join(",") === "answer,todo" &&
                facts.afterCover &&
                facts.beforeDirections &&
                facts.jumps.startsWith("todo,figures,") &&
                one[0] === "1" &&
                one[1] === "Chuyển danh sách ghim rail sang settings" &&
                one[2] === "Xoá hồ sơ WebView2 hiện làm mất ghim của người dùng." &&
                one[3] === "frontend/app/view/agents/railappsstore.ts pkg/wconfig/settingsconfig.go" &&
                one[4] === "việc mới" &&
                two[0] === "2" &&
                two[1] === "Đo một ứng dụng nguội trước khi giữ nó thức" &&
                two[2] === "Giữ một ứng dụng thức giữ cả dev server của nó." &&
                two[3] === "—" &&
                two[4] === "—";
            return { ok, detail: JSON.stringify({ table, facts }) };
        });

        await step("Số liệu lists only the figures Go verified, each with its path:line in mono", async () => {
            const table = await h.ev(tableOf(FIGURES));
            const facts = await h.ev(`(() => {
                const root = document.querySelector(${q(SUMMARY)});
                const after = (a, b) => !!a && !!b && !!(a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING);
                const figures = root.querySelector(${q(FIGURES)});
                const src = figures?.querySelector('[data-council-figure-cell="source"]');
                return {
                    afterTodo: after(root.querySelector(${q(TODO)}), figures),
                    beforeDirections: after(figures, root.querySelector("[data-council-direction]")),
                    rowMarks: figures?.querySelectorAll("[data-council-figure-row]").length ?? 0,
                    mono: src == null ? null : /mono/i.test(getComputedStyle(src).fontFamily),
                    wrong: root.innerText.includes("pkg/services/model.go:99"),
                };
            })()`);
            await h.ev(`document.querySelector(${q(FIGURES)})?.scrollIntoView({ block: "start" })`);
            await sleep(300);
            await h.shot("cdp-shots/council-report-tables-figures.png");
            await h.ev(`document.querySelector("${SUMMARY} [data-council-scroll]").scrollTop = 0`);
            const rows = (table?.rows ?? []).map((r) => r.join("|"));
            const ok =
                table?.heading === "Số liệu" &&
                table.heads.join("|") === "Giá trị|Đo gì|Nguồn" &&
                rows.join("\n") ===
                    [
                        "3|số ứng dụng tối đa ghim trên rail|frontend/app/view/agents/railapps.ts:10",
                        "1,248 ms|thời gian mở lại một ứng dụng nguội|pkg/services/model.go:38",
                    ].join("\n") &&
                facts.rowMarks === 2 &&
                facts.afterTodo &&
                facts.beforeDirections &&
                facts.mono === true &&
                // the figure that did not check out is About the council's, which is folded
                !facts.wrong;
            return { ok, detail: JSON.stringify({ table, facts }) };
        });

        await step("At a glance is not on screen until About the council is opened, which unfolds over a motion and shows the glance figures and the failed figure with its note", async () => {
            const folded = await h.ev(`(() => {
                const toggle = document.querySelector(${q(TOGGLE)});
                return {
                    expanded: toggle?.getAttribute("aria-expanded") ?? null,
                    line: toggle?.innerText?.replace(/\\s+/g, " ").trim() ?? null,
                    glance: !!document.querySelector('[data-council-figure="glance"], [data-council-figure="stance-grid"]'),
                    body: !!document.querySelector("[data-council-about-body]"),
                };
            })()`);
            await h.ev(`document.querySelector(${q(ABOUT)})?.scrollIntoView({ block: "center" })`);
            await sleep(300);
            await h.shot("cdp-shots/council-report-tables-about-folded.png");
            await h.ev(`document.querySelector(${q(TOGGLE)}).click()`);
            // a moment after the click the body is on its way: drawn, but shorter than where it settles
            const midway = await h.ev(`new Promise((r) => setTimeout(() => r(document.querySelector("[data-council-about-body]")?.getBoundingClientRect().height ?? -1), 60))`);
            await sleep(700);
            const open = await h.ev(`(() => {
                const t = (el) => el?.innerText?.replace(/\\s+/g, " ").trim() ?? null;
                const about = document.querySelector(${q(ABOUT)});
                const failed = [...about.querySelectorAll("[data-council-failed-row]")];
                return {
                    expanded: document.querySelector(${q(TOGGLE)})?.getAttribute("aria-expanded") ?? null,
                    height: Math.round(document.querySelector("[data-council-about-body]")?.getBoundingClientRect().height ?? 0),
                    blocks: [...about.querySelectorAll("[data-council-about-block]")].map((b) => b.dataset.councilAboutBlock + ":" + t(b.querySelector("h2"))),
                    glance: !!about.querySelector('[data-council-figure="stance-grid"]'),
                    failed: failed.map((r) => [...r.children].map(t).join("|")),
                    note: t(failed[0]?.querySelector("[data-council-failed-note]")),
                };
            })()`);
            await h.ev(`document.querySelector(${q(ABOUT)})?.scrollIntoView({ block: "start" })`);
            await sleep(300);
            await h.shot("cdp-shots/council-report-tables-about-open.png");
            const ok =
                folded.expanded === "false" &&
                folded.line === "About the council At a glance · 1 figure did not check out" &&
                !folded.glance &&
                !folded.body &&
                midway >= 0 &&
                midway < open.height - 4 &&
                open.expanded === "true" &&
                open.blocks.join(",") === "glance:At a glance,failed:Figures that did not check out" &&
                open.glance &&
                open.failed.join("\n") === "3 s|thời gian mở lại một ứng dụng, theo trí nhớ|pkg/services/model.go:99|line 99 is past the end (64 lines)" &&
                open.note === "line 99 is past the end (64 lines)";
            return { ok, detail: JSON.stringify({ folded, midway, open }) };
        });

        await step("at a narrow pane (520px) the tables fit: the page does not scroll sideways, and each table stays inside its own box", async () => {
            const original = await h.ev(`(() => {
                const root = document.querySelector(${q(SUMMARY)});
                const prev = root.getAttribute("style") ?? "";
                root.style.width = "520px";
                root.style.maxWidth = "520px";
                root.style.flex = "none";
                return prev;
            })()`);
            try {
                await sleep(500);
                await h.ev(`document.querySelector("${SUMMARY} [data-council-scroll]").scrollTop = 0`);
                await h.ev(`document.querySelector(${q(TODO)})?.scrollIntoView({ block: "start" })`);
                await sleep(300);
                const m = await h.ev(`(() => {
                    const root = document.querySelector(${q(SUMMARY)});
                    const box = root.querySelector("[data-council-scroll]");
                    const br = box.getBoundingClientRect();
                    const tables = [...root.querySelectorAll("[data-council-table-scroll]")].map((w) => {
                        const r = w.getBoundingClientRect();
                        return { right: Math.round(r.right), scroll: w.scrollWidth - w.clientWidth };
                    });
                    return {
                        width: Math.round(root.getBoundingClientRect().width),
                        boxRight: Math.round(br.right),
                        pageScroll: box.scrollWidth - box.clientWidth,
                        tables,
                    };
                })()`);
                await h.shot("cdp-shots/council-report-tables-narrow.png");
                const ok =
                    m.width === 520 &&
                    m.pageScroll <= 1 &&
                    m.tables.length >= 2 &&
                    m.tables.every((t) => t.right <= m.boxRight + 1);
                return { ok, detail: JSON.stringify(m) };
            } finally {
                await h.ev(`document.querySelector(${q(SUMMARY)})?.setAttribute("style", ${q(original)})`);
                await sleep(300);
            }
        });

        await step("an English council heads its to-do table in English, with no Figures table when it declared none", async () => {
            await openReport(h, ctx.englishId, 4);
            const table = await h.ev(tableOf(TODO));
            const figures = await h.ev(`!!document.querySelector(${q(FIGURES)})`);
            await h.shot("cdp-shots/council-report-tables-english.png");
            const ok =
                table?.heading === "To do" &&
                table.heads.join("|") === "#|Task|Why|Files|Kind" &&
                table.rows.length === 4 &&
                // the fixture's direction 1 carries a written why; the rest fall back to their reasoning
                table.rows[0][2] === "A cleared WebView2 profile no longer loses the pins." &&
                !figures;
            return { ok, detail: JSON.stringify({ table, figures }) };
        });

        return steps;
    },

    async teardown(h, ctx) {
        await teardownCouncilProject(h, ctx);
    },
};
