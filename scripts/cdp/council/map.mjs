// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0
//
// council-map (docs/superpowers/plans/2026-11-03-council-stronger.md, Task 10; board Map-tab.dc.html in .superpowers/
// design/council-stronger): the third tab of a council, Map (Bản đồ in a Vietnamese one), open while the council runs and
// after it. The hooks are called by councilscenarios.mjs as arrange(h, fx), assert(h, ctx, fx), teardown(h, ctx, fx).
//
// Nothing here calls a model. The councils are JSON files written into the data dir, each built in this file on top of a
// rail-apps fixture (fixtures.mjs `seedCouncil` with an `edit`), so every field the Map reads (labels, runs, cites, the
// timeline, the language) is set by hand:
//   vi          a Vietnamese council still in round 2, four seats: one idea Ran, one Disproved, one Read code (with a wrong
//               cite), two Guess (one withdrawn), a revised cell, and a verify command running now (Tìm bug)
//   seven       an English council that is done, seven seats, three ideas: the matrix has to scroll sideways
//   brainstorm  a Brainstorm that is done: Builds on pills, no badge, no evidence bar
//   round1      a council in round 1 whose seats have sent no idea yet
//
// The Seats popover's timeline (Task 11): a click on a card sets the seat the popover is asked to show, read off the DEV hook
// `window.__arcCouncil.timeline(id)`, and the popover opens on that seat's timeline.

import { waitFor } from "../attach.mjs";
import { arrangeCouncilProject, seedCouncil, teardownCouncilProject } from "./fixtures.mjs";

const WAIT_MS = 10_000;
const MAP = "[data-council-map]";

const q = (s) => JSON.stringify(s);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const until = (h, expr, ms = WAIT_MS) => waitFor((e) => h.ev(e), expr, ms);
const click = (h, sel) =>
    h.ev(`(() => { const el = document.querySelector(${q(sel)}); if (el == null || el.disabled) return false; el.click(); return true; })()`);

// ---- the councils ----

// one expert: the seat's id is a stock role's, its name the council's language
const seat = (id, name, extra = {}) => ({ id, name, brief: `You review as ${name}.`, model: "sonnet", ...extra });
const coordinator = (name) => seat("coordinator", name, { model: "opus", coordinator: true });

// a proposal / reply / piece of evidence with the fields a fixture leaves out
const idea = (t0, n, id, author, title, argument, extra = {}) => ({ id, author, title, argument, ts: t0 + n * 1000, ...extra });
const reply = (t0, n, id, proposalid, author, stance, text, extra = {}) => ({
    id,
    proposalid,
    author,
    ...(stance ? { stance } : {}),
    text,
    round: 2,
    ts: t0 + n * 1000,
    ...extra,
});

// The Vietnamese council. Arrival order P3, P1, P4, P2, P5; by agreement the Map must order them P1, P2, P3, P4, P5:
//   P1  Ran        3 agree                       (Tìm bug's command failed, as it expected)
//   P2  Read code  2 agree · 1 doubt             (one cite holds, one is a wrong cite; its author revised after the doubt)
//   P3  Disproved  1 agree · 1 doubt             (the command passed or failed against what its author expected)
//   P4  Guess      1 agree · 1 doubt · 1 against
//   P5  Guess      1 doubt · 2 against, withdrawn
export const VI_ORDER = ["P1", "P2", "P3", "P4", "P5"];
export const VI_REASON_P1_NEWUSER = "Mình đang tải trang thì nó tắt, mình sẽ nghĩ app hỏng.";
export const VI_RUNNING = "go test ./pkg/services -run TestIdleStop";

export function viCouncil(c) {
    const t0 = c.started;
    c.feature = "Services tự dừng sau 1 phút có ổn không?";
    c.question = "Services tự dừng sau 1 phút không dùng, như vậy có ổn không?";
    c.lang = "vi";
    c.experts = [
        seat("newuser", "Khách"),
        seat("skeptic", "Tìm bug"),
        seat("ram", "Đo RAM"),
        seat("ux", "UX"),
        coordinator("Thư ký"),
    ];
    c.state = "running";
    c.round = 2;
    c.proposals = [
        idea(t0, 1, "P3", "ram", "Đo RAM của từng service trước khi chốt mốc 1 phút", "Mốc 1 phút chưa có số đo nào đứng sau.", {
            label: "disproved",
            runs: [
                {
                    command: "go test ./pkg/memgate -run TestEstimate",
                    expect: "pass",
                    state: "fail",
                    exit: 1,
                    matched: false,
                    tail: "--- FAIL: TestEstimate",
                },
            ],
        }),
        idea(t0, 2, "P1", "skeptic", "Dừng service khi còn request đang chạy sẽ cắt ngang người dùng", "Busy chỉ xét tiến trình con, không xét request đang mở.", {
            label: "ran",
            evidence: [{ ref: "pkg/services/model.go:88", cite: "ok" }],
            runs: [
                {
                    command: "go test ./pkg/services -run TestBusyStop",
                    expect: "fail",
                    state: "fail",
                    exit: 1,
                    matched: true,
                    tail: "--- FAIL: TestBusyStop",
                },
            ],
        }),
        idea(t0, 3, "P4", "newuser", "Hiện đồng hồ đếm ngược trước khi tắt", "Người dùng cần biết service sắp tắt.", { label: "guess" }),
        idea(t0, 4, "P2", "ux", "Service đã ghim lên rail thì không tự dừng", "Đã ghim nghĩa là người dùng muốn nó luôn sẵn sàng.", {
            label: "read",
            evidence: [
                { ref: "railapps.ts:41", cite: "ok" },
                { ref: "railapps.ts:900", cite: "wrong", citenote: "line 900 is past the end (412 lines)" },
            ],
        }),
        idea(t0, 5, "P5", "ux", "Bỏ hẳn tự dừng, để người dùng tự bấm Stop", "Tự dừng gây nhiều phiền hơn lợi.", { label: "guess", withdrawn: true }),
    ];
    c.replies = [
        reply(t0, 10, "r1", "P1", "newuser", "accept", VI_REASON_P1_NEWUSER),
        reply(t0, 11, "r2", "P1", "ram", "accept", "Đồng ý, và giữ thêm vài giây không tốn bao nhiêu RAM."),
        reply(t0, 12, "r3", "P1", "ux", "accept", "Cắt ngang giữa chừng là lỗi trải nghiệm nặng nhất ở đây."),
        reply(t0, 13, "r4", "P2", "newuser", "accept", "Ghim rồi thì mình mong nó luôn sẵn sàng."),
        reply(t0, 14, "r5", "P2", "skeptic", "challenge", "Ghim nhưng không dùng cả tuần vẫn chiếm RAM.", { label: "read" }),
        reply(t0, 15, "r6", "P2", "ram", "accept", "Chấp nhận nếu có giới hạn số service ghim."),
        reply(t0, 16, "r7", "P2", "ux", "", "Mình sửa ý: ghim chỉ giữ thức khi RAM còn dư.", { parentid: "r5", revised: true }),
        reply(t0, 17, "r8", "P3", "skeptic", "accept", "Có số đo thì mốc 1 phút mới có cơ sở."),
        reply(t0, 18, "r9", "P3", "ux", "challenge", "Đo xong vẫn phải hỏi người dùng có chịu chờ không."),
        reply(t0, 19, "r10", "P4", "skeptic", "oppose", "Đếm ngược thêm một thứ để lỗi."),
        reply(t0, 20, "r11", "P4", "ram", "challenge", "Đồng hồ chạy thêm một timer cho mỗi service."),
        reply(t0, 21, "r12", "P4", "ux", "accept", "Nhìn thấy đếm ngược thì người dùng yên tâm."),
        reply(t0, 22, "r13", "P5", "newuser", "challenge", "Bỏ hẳn thì mình quên tắt và máy nặng lên."),
        reply(t0, 23, "r14", "P5", "skeptic", "oppose", "Không tự dừng là rò rỉ có chủ đích."),
        reply(t0, 24, "r15", "P5", "ram", "oppose", "Phản đối: RAM sẽ chỉ tăng."),
    ];
    c.stats = {
        newuser: { ms: 125_000, tokens: 96_000, calls: 3 },
        skeptic: { ms: 288_000, tokens: 214_000, calls: 5 },
        ram: { ms: 190_000, tokens: 131_000, calls: 4 },
        ux: { ms: 92_000, tokens: 58_000, calls: 2 },
    };
    c.tokens = 499_000;
    c.calls = 14;
    // Tìm bug's second verify command is running now: its last step is a run with no result yet
    c.activity = { skeptic: { text: VI_RUNNING } };
    c.timeline = {
        skeptic: [
            { ts: t0 + 1000, kind: "read", target: "pkg/services/model.go" },
            { ts: t0 + 2000, kind: "search", target: "Busy", result: "7 matches" },
            { ts: t0 + 3000, kind: "run", target: "go test ./pkg/services -run TestBusyStop", result: "fail" },
            { ts: t0 + 4000, kind: "propose", target: "Dừng service khi còn request đang chạy sẽ cắt ngang người dùng" },
            { ts: t0 + 5000, kind: "run", target: VI_RUNNING },
        ],
    };
    delete c.failed;
    delete c.summary;
}

// seven seats, three ideas, no summary: the matrix is wider than any pane
export const SEVEN_SEATS = [
    ["ux", "Ease of use"],
    ["ram", "Memory watcher"],
    ["newuser", "New user"],
    ["skeptic", "Bug hunter"],
    ["designer", "Designer"],
    ["builder", "Builder"],
    ["contrarian", "Other side"],
];

export function sevenCouncil(c) {
    const t0 = c.started;
    c.feature = "Seven seats on the rail";
    c.experts = [...SEVEN_SEATS.map(([id, name]) => seat(id, name)), coordinator("Summarizer")];
    c.state = "done";
    c.round = 3;
    c.proposals = [
        idea(t0, 1, "P1", "ux", "Show asleep and waking on the rail icon", "A sleeping app looks the same as a running one.", {
            label: "read",
            evidence: [{ ref: "railapps.ts:72", cite: "ok" }],
        }),
        idea(t0, 2, "P2", "skeptic", "Keep the last-used app awake", "Waking costs a second of the person's time.", { label: "guess" }),
        idea(t0, 3, "P3", "builder", "Move the pins to settings", "A cleared profile loses the pins today.", {
            label: "read",
            evidence: [{ ref: "railappsstore.ts:20", cite: "ok" }],
        }),
    ];
    const stances = ["accept", "challenge", "oppose"];
    c.replies = [];
    let n = 10;
    for (const p of c.proposals) {
        for (const [i, [id]] of SEVEN_SEATS.entries()) {
            if (id !== p.author) {
                c.replies.push(reply(t0, n++, `r${n}`, p.id, id, stances[(i + Number(p.id.slice(1))) % 3], `${id} on ${p.id}.`));
            }
        }
    }
    c.stats = Object.fromEntries(SEVEN_SEATS.map(([id], i) => [id, { ms: 60_000 + i * 20_000, tokens: 40_000 + i * 10_000, calls: 2 }]));
    delete c.activity;
    delete c.failed;
    delete c.summary;
}

export function brainstormCouncil(c) {
    const t0 = c.started;
    c.feature = "Ideas for the empty rail";
    c.mode = "brainstorm";
    c.experts = [seat("designer", "Designer"), seat("builder", "Builder"), seat("contrarian", "Other side"), coordinator("Host")];
    c.state = "done";
    c.round = 3;
    c.proposals = [
        idea(t0, 1, "P1", "designer", "Draw the empty rail slots with a pin hint", "A dashed slot says where an app would go."),
        idea(t0, 2, "P2", "builder", "Pin the last app the person opened", "One click less for the app they use most."),
    ];
    c.replies = [
        reply(t0, 10, "r1", "P1", "builder", "", "Building on this: the hint can name the shortcut too.", { builds: true }),
        reply(t0, 11, "r2", "P1", "contrarian", "", "Building on this: show it only the first week.", { builds: true }),
        reply(t0, 12, "r3", "P2", "contrarian", "", "A wrong guess is worse than an empty slot."),
    ];
    c.stats = {
        designer: { ms: 70_000, tokens: 44_000, calls: 2 },
        builder: { ms: 80_000, tokens: 52_000, calls: 2 },
        contrarian: { ms: 90_000, tokens: 61_000, calls: 2 },
    };
    delete c.activity;
    delete c.failed;
    delete c.summary;
}

export function roundOneCouncil(c) {
    c.feature = "Nothing sent yet";
    c.experts = [seat("ux", "Ease of use"), seat("ram", "Memory watcher"), seat("skeptic", "Bug hunter"), coordinator("Summarizer")];
    c.state = "running";
    c.round = 1;
    c.proposals = [];
    c.replies = [];
    c.activity = { ux: { text: "Reading railapps.ts" }, ram: { text: "Searching for settings" } };
    c.stats = { ux: { ms: 20_000, tokens: 9_000, calls: 1 }, ram: { ms: 15_000, tokens: 7_000, calls: 1 } };
    c.tokens = 16_000;
    c.calls = 2;
    delete c.failed;
    delete c.summary;
}

// ---- what a step reads ----

// the Map on screen, reduced to what a step reads
const FACTS = `(() => {
    const root = document.querySelector(${q(MAP)});
    const t = (el) => el?.innerText?.replace(/\\s+/g, " ").trim() ?? null;
    const all = (sel, from = root) => [...from.querySelectorAll(sel)];
    return {
        id: root.dataset.councilId,
        lang: root.getAttribute("lang"),
        tabs: all("[data-council-tab]").map((b) => b.dataset.councilTab + "=" + t(b) + (b.getAttribute("aria-selected") === "true" ? "*" : "")),
        cardsTitle: t(root.querySelector("[data-council-map-cards] h2")),
        cardsHint: t(root.querySelector("[data-council-map-cards] h2")?.nextElementSibling),
        cards: all("[data-council-map-card]").map((card) => ({
            id: card.dataset.councilMapCard,
            label: card.getAttribute("aria-label"),
            name: t(card.querySelector("[data-council-map-name]")),
            doing: t(card.querySelector("[data-council-map-doing]")),
            working: card.querySelector("[data-council-map-doing]")?.dataset.working,
            command: t(card.querySelector("[data-council-map-command]")),
            commandMono: card.querySelector("[data-council-map-command]")
                ? /mono/i.test(getComputedStyle(card.querySelector("[data-council-map-command]")).fontFamily)
                : null,
            claims: t(card.querySelector("[data-council-map-claims]")),
            counts: all("[data-council-map-count]", card).map((e) => e.dataset.councilMapCount + "=" + t(e)),
            segments: all("[data-segment]", card.querySelector("[data-council-map-bar]") ?? card).map((e) => e.dataset.segment),
            bar: !!card.querySelector("[data-council-map-bar]"),
            wrong: t(card.querySelector("[data-council-map-wrongcites]")),
            tokens: t(card.querySelector("[data-council-map-tokens]")),
            time: t(card.querySelector("[data-council-map-time]")),
            calls: t(card.querySelector("[data-council-map-calls]")),
        })),
        matrixTitle: t(root.querySelector("[data-council-map-matrix] h2")),
        legend: all("[data-council-map-legend] li").map((li) => li.dataset.legend + "=" + t(li)),
        empty: t(root.querySelector("[data-council-map-empty]")),
        table: !!root.querySelector("[data-council-map-table]"),
        heads: all("[data-council-map-table] thead th").map((th) => t(th.querySelector("[data-council-map-head-name]")) ?? t(th)),
        foot: t(root.querySelector("[data-council-map-foot]")),
        rows: all("[data-council-map-row]").map((r) => ({
            id: r.dataset.councilMapRow,
            title: t(r.querySelector("[data-council-map-title]")),
            dimmed: r.dataset.dimmed,
            opacity: getComputedStyle(r).opacity,
            check: r.querySelector("[data-council-map-check]")?.dataset.councilMapCheck ?? null,
            checkText: t(r.querySelector("[data-council-map-check]")),
            commandMono: r.querySelector("[data-council-map-check] [data-council-map-command]")
                ? /mono/i.test(getComputedStyle(r.querySelector("[data-council-map-check] [data-council-map-command]")).fontFamily)
                : null,
            builds: t(r.querySelector("[data-council-map-builds]")),
            cells: all("[data-council-map-cell]", r).map((c) => c.dataset.councilMapCell + "=" + t(c)),
            stances: all("[data-council-map-cell]", r).map((c) => c.dataset.stance).join(","),
            consensus: t(r.querySelector("[data-council-map-consensus]")),
            outcome: t(r.querySelector("[data-council-map-outcome]")),
        })),
    };
})()`;

// opens a council's Map through the DEV hook (fixtures.mjs openCouncil opens only the Discussion and the Summary)
async function openMap(h, id) {
    if (!(await h.ev("!!window.__arcCouncil"))) throw new Error("window.__arcCouncil is missing: the DEV build installs it (councilpane.tsx)");
    await h.ev(`window.__arcCouncil.showCouncil(${q(id)}, "map")`);
    const drawn = `document.querySelector(${q(MAP)})?.dataset.councilId === ${q(id)} && !!document.querySelector("[data-council-map-cards]")`;
    if (!(await until(h, drawn))) throw new Error(`the Map of ${id} did not draw`);
    // the cards and the matrix settle (a council that just loaded draws twice)
    await sleep(300);
}

const rowIds = (facts) => facts.rows.map((r) => r.id).join(",");

export const councilMap = {
    async arrange(h, fx) {
        const ctx = await arrangeCouncilProject(h, fx);
        try {
            ctx.ids = {
                vi: await seedCouncil(h, ctx, "round2", { id: "fx-council-map-vi", edit: viCouncil }),
                seven: await seedCouncil(h, ctx, "done", { id: "fx-council-map-seven", edit: sevenCouncil }),
                brainstorm: await seedCouncil(h, ctx, "done", { id: "fx-council-map-brainstorm", edit: brainstormCouncil }),
                round1: await seedCouncil(h, ctx, "round1", { id: "fx-council-map-round1", edit: roundOneCouncil }),
            };
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
        const { vi, seven, brainstorm, round1 } = ctx.ids;

        await step("the Map is the third tab, after Report and Discussion, open while the council runs: Bản đồ in a Vietnamese council, selected, the other two words unchanged; the tabs go to and from it", async () => {
            // from the Discussion of the running council, the Map tab is a click away
            await h.ev(`window.__arcCouncil.showCouncil(${q(vi)}, "discussion")`);
            await until(h, `document.querySelector("[data-council-discussion]")?.dataset.councilId === ${q(vi)}`);
            const fromDiscussion = await h.ev(`[...document.querySelectorAll("[data-council-discussion] [data-council-tab]")].map((b) => b.dataset.councilTab + "=" + b.innerText.replace(/\\s+/g, " ").trim()).join("|")`);
            await click(h, "[data-council-discussion] [data-council-tab='map']");
            const opened = await until(h, `document.querySelector(${q(MAP)})?.dataset.councilId === ${q(vi)}`);
            await sleep(300);
            const f = await h.ev(FACTS);
            await h.shot("cdp-shots/council-map-vi.png");
            // and back: the Report tab opens the Report, the Discussion tab the Discussion
            await click(h, `${MAP} [data-council-tab='discussion']`);
            const backDiscussion = await until(h, `!!document.querySelector("[data-council-discussion]") && !document.querySelector(${q(MAP)})`);
            await click(h, "[data-council-discussion] [data-council-tab='map']");
            const again = await until(h, `document.querySelector(${q(MAP)})?.dataset.councilId === ${q(vi)}`);
            await click(h, `${MAP} [data-council-tab='summary']`);
            const backReport = await until(h, `!!document.querySelector("[data-council-summary]") && !document.querySelector(${q(MAP)})`);
            await openMap(h, vi);
            const ok =
                fromDiscussion.startsWith("summary=Report|discussion=Discussion") &&
                fromDiscussion.endsWith("|map=Bản đồ") &&
                opened &&
                f.tabs.length === 3 &&
                f.tabs[0] === "summary=Report" &&
                f.tabs[1].startsWith("discussion=Discussion") &&
                f.tabs[2] === "map=Bản đồ*" &&
                f.lang === "vi" &&
                backDiscussion &&
                again &&
                backReport;
            return { ok, detail: JSON.stringify({ fromDiscussion, tabs: f.tabs, lang: f.lang, opened, backDiscussion, again, backReport }) };
        });

        await step("one card per seat: its name, what it does (Xong vòng 2, or the verify command running in mono beside the working dot), the evidence bar with its four counts in words, tokens, time and calls", async () => {
            const f = await h.ev(FACTS);
            const by = Object.fromEntries(f.cards.map((c) => [c.id, c]));
            await h.shot("cdp-shots/council-map-cards.png");
            const sk = by.skeptic;
            const ok =
                f.cardsTitle === "Từng chuyên gia" &&
                f.cardsHint === "Bấm một người để xem dòng thời gian của họ" &&
                f.cards.map((c) => c.id).join() === "newuser,skeptic,ram,ux" &&
                f.cards.map((c) => c.name).join("|") === "Khách|Tìm bug|Đo RAM|UX" &&
                f.cards.every((c) => c.label === `Mở dòng thời gian của ${c.name}`) &&
                // Tìm bug runs its second verify command: the dot works, the command is in mono
                sk.working === "true" &&
                sk.command === "go test ./pkg/services -run TestIdleStop" &&
                sk.commandMono === true &&
                sk.doing.startsWith("Đang chạy go test ./pkg/services -run TestIdleStop") &&
                // the others are done with round 2 and do not work
                ["newuser", "ram", "ux"].every((id) => by[id].working === "false" && by[id].doing === "Xong vòng 2" && by[id].command == null) &&
                // four counts in words, always: 2 claims for Tìm bug (P1 ran, r5 read), 1 disproved for Đo RAM, ...
                sk.claims === "2 nhận định" &&
                sk.counts.join("|") === "ran=1 đã chạy|disproved=0 bị bác|read=1 đã đọc|guess=0 đoán" &&
                sk.segments.join() === "ran,read" &&
                by.ram.claims === "1 nhận định" &&
                by.ram.counts.join("|") === "ran=0 đã chạy|disproved=1 bị bác|read=0 đã đọc|guess=0 đoán" &&
                by.ram.segments.join() === "disproved" &&
                by.ux.claims === "2 nhận định" &&
                by.ux.counts.join("|") === "ran=0 đã chạy|disproved=0 bị bác|read=1 đã đọc|guess=1 đoán" &&
                by.ux.segments.join() === "read,guess" &&
                by.newuser.claims === "1 nhận định" &&
                by.newuser.counts.join("|") === "ran=0 đã chạy|disproved=0 bị bác|read=0 đã đọc|guess=1 đoán" &&
                // the wrong cite on P2 counts on its author's card, and on that card alone
                by.ux.wrong === "1 trích sai" &&
                f.cards.filter((c) => c.wrong != null).length === 1 &&
                // tokens, time, calls
                sk.tokens === "0.21M token" &&
                sk.time === "4 phút 48 giây" &&
                sk.calls === "5 lượt gọi" &&
                by.newuser.tokens === "96k token" &&
                by.newuser.time === "2 phút 5 giây" &&
                by.newuser.calls === "3 lượt gọi";
            return { ok, detail: JSON.stringify(f.cards.map((c) => [c.id, c.doing, c.working, c.claims, c.counts, c.segments, c.wrong, c.tokens, c.time, c.calls])) };
        });

        await step("the matrix is sorted by agreement, highest first, whatever order the ideas arrived in (P3, P1, P4, P2, P5)", async () => {
            const f = await h.ev(FACTS);
            const ok =
                f.matrixTitle === "Ai đồng ý với ý nào" &&
                rowIds(f) === VI_ORDER.join() &&
                f.heads.length === 7 &&
                f.heads[0] === "Ý" &&
                f.heads.slice(1, 5).join("|") === "Khách|Tìm bug|Đo RAM|UX" &&
                f.heads[5] === "Đồng thuận" &&
                f.heads[6] === "Kết cục" &&
                f.rows.map((r) => r.consensus).join("|") ===
                    "3 đồng ý|2 đồng ý · 1 nghi ngờ|1 đồng ý · 1 nghi ngờ|1 đồng ý · 1 nghi ngờ · 1 phản đối|1 nghi ngờ · 2 phản đối";
            return { ok, detail: JSON.stringify({ order: rowIds(f), heads: f.heads, consensus: f.rows.map((r) => r.consensus) }) };
        });

        await step("every badge in Vietnamese under its idea's title: Đã chạy with its command in mono and what happened, Bị bác, Đã đọc code with its cite, Chỉ đoán; the legend names them and the wrong cite", async () => {
            const f = await h.ev(FACTS);
            const by = Object.fromEntries(f.rows.map((r) => [r.id, r]));
            await h.shot("cdp-shots/council-map-matrix.png");
            const ok =
                by.P1.check === "ran" &&
                by.P1.checkText === "Đã chạy go test ./pkg/services -run TestBusyStop thất bại, đúng như dự đoán" &&
                by.P1.commandMono === true &&
                by.P3.check === "disproved" &&
                by.P3.checkText === "Bị bác go test ./pkg/memgate -run TestEstimate thất bại, nhưng dự đoán là đạt" &&
                by.P2.check === "read" &&
                by.P2.checkText === "Đã đọc code railapps.ts:41" &&
                by.P4.check === "guess" &&
                by.P4.checkText === "Chỉ đoán" &&
                by.P5.check === "guess" &&
                f.legend.join("|") ===
                    [
                        "ran=Đã chạy: Go chạy lệnh, thấy kết quả",
                        "disproved=Bị bác: Go chạy lệnh và kết quả ngược với nhận định",
                        "read=Đã đọc code: trích dẫn khớp",
                        "guess=Chỉ đoán: không có gì để kiểm tra",
                        "wrong-cite=Trích sai: file, dòng hoặc đoạn trích không khớp",
                    ].join("|");
            return { ok, detail: JSON.stringify({ checks: f.rows.map((r) => [r.id, r.check, r.checkText]), legend: f.legend }) };
        });

        await step("every pill in Vietnamese with its word (Đưa ra ý, Đồng ý, Còn nghi ngờ, Phản đối, chưa nói), one cell per seat in panel order", async () => {
            const f = await h.ev(FACTS);
            const by = Object.fromEntries(f.rows.map((r) => [r.id, r]));
            const stances = (id) => by[id].stances;
            const ok =
                stances("P1") === "accept,proposed,accept,accept" &&
                stances("P2") === "accept,challenge,accept,proposed" &&
                stances("P3") === "none,accept,proposed,challenge" &&
                stances("P4") === "proposed,oppose,challenge,accept" &&
                stances("P5") === "challenge,oppose,oppose,proposed" &&
                by.P1.cells.join("|") ===
                    "newuser=Đồng ý|skeptic=Đưa ra ý|ram=Đồng ý|ux=Đồng ý" &&
                by.P3.cells.join("|") === "newuser=chưa nói|skeptic=Đồng ý|ram=Đưa ra ý|ux=Còn nghi ngờ" &&
                by.P4.cells.join("|") === "newuser=Đưa ra ý|skeptic=Phản đối|ram=Còn nghi ngờ|ux=Đồng ý";
            return { ok, detail: JSON.stringify(f.rows.map((r) => [r.id, r.cells])) };
        });

        await step("the cell where the author revised after a doubt says đã sửa ở vòng 2 (under Tìm bug on P2, and nowhere else), with the footnote; the withdrawn idea is dim and says Đã rút", async () => {
            const f = await h.ev(FACTS);
            const by = Object.fromEntries(f.rows.map((r) => [r.id, r]));
            const revised = f.rows.flatMap((r) => r.cells.filter((c) => c.includes("đã sửa ở vòng")).map((c) => `${r.id}:${c}`));
            const ok =
                revised.join() === "P2:skeptic=Còn nghi ngờ đã sửa ở vòng 2" &&
                f.foot === "Ô có chữ “đã sửa ở vòng 2” là chỗ người đưa ra ý đã sửa ý của mình sau khi bị nghi ngờ." &&
                by.P5.dimmed === "true" &&
                Number(by.P5.opacity) < 1 &&
                by.P5.outcome === "Đã rút" &&
                // the others stand at full strength
                ["P1", "P2", "P3", "P4"].every((id) => by[id].dimmed === "false" && Number(by[id].opacity) === 1);
            return { ok, detail: JSON.stringify({ revised, foot: f.foot, p5: [by.P5.dimmed, by.P5.opacity, by.P5.outcome] }) };
        });

        await step("a click on an idea opens its reasons under each seat's column, a second click closes it; Enter does the same from the keyboard; one row is open at a time", async () => {
            const reasons = (id) => `${MAP} [data-council-map-reasons='${id}']`;
            const read = (id) =>
                h.ev(`(() => {
                    const row = document.querySelector(${q(reasons(id))});
                    if (row == null) return null;
                    const t = (el) => el?.innerText?.replace(/\\s+/g, " ").trim() ?? null;
                    return {
                        label: t(row.querySelector("td")),
                        reasons: [...row.querySelectorAll("[data-council-map-reason]")].map((c) => c.dataset.councilMapReason + "=" + t(c)),
                        expanded: document.querySelector(${q(`${MAP} [data-council-map-row='${id}'] [data-council-map-toggle]`)})?.getAttribute("aria-expanded"),
                    };
                })()`);
            const open = () => h.ev(`window.__arcCouncil.mapOpen(${q(vi)})`);
            const before = await open();
            await click(h, `${MAP} [data-council-map-row='P1']`);
            await until(h, `!!document.querySelector(${q(reasons("P1"))})`);
            const p1 = await read("P1");
            const openAfterClick = await open();
            await h.shot("cdp-shots/council-map-reasons.png");
            // a second click closes it
            await click(h, `${MAP} [data-council-map-row='P1']`);
            const closed = await until(h, `!document.querySelector(${q(reasons("P1"))})`);
            const openAfterClose = await open();
            // Enter on the idea's toggle opens it
            await h.ev(`document.querySelector(${q(`${MAP} [data-council-map-row='P2'] [data-council-map-toggle]`)}).focus()`);
            await h.cdp("Input.dispatchKeyEvent", { type: "keyDown", key: "Enter", code: "Enter", windowsVirtualKeyCode: 13, text: "\r" });
            await h.cdp("Input.dispatchKeyEvent", { type: "keyUp", key: "Enter", code: "Enter", windowsVirtualKeyCode: 13 });
            const byEnter = await until(h, `!!document.querySelector(${q(reasons("P2"))})`);
            const p2 = await read("P2");
            // opening another idea closes that one
            await click(h, `${MAP} [data-council-map-row='P3']`);
            await until(h, `!!document.querySelector(${q(reasons("P3"))})`);
            const onlyOne = await h.ev(`document.querySelectorAll("[data-council-map-reasons]").length`);
            const p2Gone = !(await h.ev(`!!document.querySelector(${q(reasons("P2"))})`));
            await click(h, `${MAP} [data-council-map-row='P3']`);
            await until(h, `document.querySelectorAll("[data-council-map-reasons]").length === 0`);
            const ok =
                before === null &&
                p1 != null &&
                p1.label === "Lý do của từng người" &&
                p1.expanded === "true" &&
                p1.reasons.join("|") ===
                    [
                        `newuser=${VI_REASON_P1_NEWUSER}`,
                        "skeptic=Busy chỉ xét tiến trình con, không xét request đang mở.",
                        "ram=Đồng ý, và giữ thêm vài giây không tốn bao nhiêu RAM.",
                        "ux=Cắt ngang giữa chừng là lỗi trải nghiệm nặng nhất ở đây.",
                    ].join("|") &&
                openAfterClick === "P1" &&
                closed &&
                openAfterClose === null &&
                byEnter &&
                p2 != null &&
                p2.reasons.length === 4 &&
                p2.reasons[1] === "skeptic=Ghim nhưng không dùng cả tuần vẫn chiếm RAM." &&
                onlyOne === 1 &&
                p2Gone;
            return { ok, detail: JSON.stringify({ before, p1, openAfterClick, closed, openAfterClose, byEnter, p2, onlyOne, p2Gone }) };
        });

        await step("seven seats: the matrix scrolls sideways inside its own box with the idea column in place, and the page itself does not", async () => {
            await openMap(h, seven);
            const measure = () =>
                h.ev(`(() => {
                    const box = document.querySelector("[data-council-map-box]");
                    const root = document.querySelector(${q(MAP)});
                    const idea = document.querySelector("[data-council-map-row='P1'] td");
                    const firstSeat = document.querySelector("[data-council-map-row='P1'] [data-council-map-cell]");
                    const lastSeat = document.querySelector("[data-council-map-row='P1'] [data-council-map-cell='contrarian']");
                    const outcome = document.querySelector("[data-council-map-row='P1'] [data-council-map-outcome]");
                    const r = (el) => Math.round(el.getBoundingClientRect().left);
                    return {
                        scrollWidth: box.scrollWidth,
                        clientWidth: box.clientWidth,
                        boxLeft: r(box),
                        ideaLeft: r(idea),
                        ideaPosition: getComputedStyle(idea).position,
                        firstSeatLeft: r(firstSeat),
                        lastSeatRight: Math.round(lastSeat.getBoundingClientRect().right),
                        outcomeRight: Math.round(outcome.getBoundingClientRect().right),
                        boxRight: Math.round(box.getBoundingClientRect().right),
                        scrollLeft: box.scrollLeft,
                        seatCols: document.querySelectorAll("[data-council-map-head]").length,
                        pageOverflow: root.scrollWidth > root.clientWidth + 1,
                    };
                })()`);
            const at0 = await measure();
            await h.shot("cdp-shots/council-map-seven.png");
            await h.ev(`document.querySelector("[data-council-map-box]").scrollLeft = 400`);
            await sleep(200);
            const scrolled = await measure();
            await h.shot("cdp-shots/council-map-seven-scrolled.png");
            await h.ev(`document.querySelector("[data-council-map-box]").scrollLeft = 0`);
            const ok =
                at0.seatCols === 7 &&
                at0.scrollWidth > at0.clientWidth + 1 &&
                at0.ideaPosition === "sticky" &&
                !at0.pageOverflow &&
                // the last column (the outcome) is past the box's edge at first; scrolled, the seats moved left, the idea column
                // did not, and the outcome came into the box
                at0.outcomeRight > at0.boxRight &&
                scrolled.scrollLeft > 0 &&
                scrolled.firstSeatLeft < at0.firstSeatLeft &&
                Math.abs(scrolled.ideaLeft - scrolled.boxLeft) <= 2 &&
                Math.abs(at0.ideaLeft - at0.boxLeft) <= 2 &&
                scrolled.outcomeRight <= scrolled.boxRight + 1;
            return { ok, detail: JSON.stringify({ at0, scrolled }) };
        });

        await step("a Brainstorm: the Builds on pill under the idea that two seats build on, no check badge, no evidence bar on any card, and the cards keep tokens, time and calls", async () => {
            await openMap(h, brainstorm);
            const f = await h.ev(FACTS);
            const by = Object.fromEntries(f.rows.map((r) => [r.id, r]));
            await h.shot("cdp-shots/council-map-brainstorm.png");
            const ok =
                f.cards.length === 3 &&
                f.cards.every((c) => !c.bar && c.claims == null && c.counts.length === 0 && c.tokens != null && c.time != null && c.calls != null) &&
                f.cards.map((c) => c.calls).join("|") === "2 calls|2 calls|2 calls" &&
                f.rows.length === 2 &&
                by.P1.builds === "Builds on · 2" &&
                by.P2.builds == null &&
                f.rows.every((r) => r.check == null) &&
                // the legend says what a badge means, and a Brainstorm has none
                f.legend.length === 0 &&
                (await h.ev(`document.querySelectorAll("[data-council-map-check], [data-council-map-evidence], [data-council-map-bar]").length`)) === 0;
            return { ok, detail: JSON.stringify({ cards: f.cards.map((c) => [c.id, c.bar, c.tokens, c.time, c.calls]), rows: f.rows.map((r) => [r.id, r.builds, r.check]) }) };
        });

        await step("a council whose seats have sent no idea yet shows No ideas yet under the cards, and its working seats show the working dot", async () => {
            await openMap(h, round1);
            const f = await h.ev(FACTS);
            await h.shot("cdp-shots/council-map-empty.png");
            const by = Object.fromEntries(f.cards.map((c) => [c.id, c]));
            const ok =
                f.tabs.join("|").endsWith("map=Map*") &&
                f.cardsTitle === "Each expert" &&
                f.matrixTitle === "Who agrees with which idea" &&
                f.empty === "No ideas yet" &&
                !f.table &&
                f.rows.length === 0 &&
                f.legend.length === 0 &&
                f.cards.length === 3 &&
                by.ux.working === "true" &&
                by.ux.doing === "Reading railapps.ts" &&
                by.ram.working === "true" &&
                // a seat with no call yet waits
                by.skeptic.working === "false" &&
                by.skeptic.doing === "Waiting" &&
                by.skeptic.calls === "0 calls";
            return { ok, detail: JSON.stringify({ tabs: f.tabs, empty: f.empty, table: f.table, cards: f.cards.map((c) => [c.id, c.working, c.doing, c.calls]) }) };
        });

        // last: a click on a card opens the Seats popover, which hangs from the Seats button in the Map's header, on that
        // seat's timeline (Task 11). No key is pressed here: Escape in the Agent surface leaves the council, so the popover is
        // closed by the Seats button's own click.
        await step("a click on an expert card opens the Seats popover on that seat's timeline: Dòng thời gian của Tìm bug, five rows oldest first, the commands in mono, the one running now marked Đang chạy, and a way back to the list", async () => {
            await openMap(h, vi);
            const TL = "[data-council-timeline]";
            const timeline = () => h.ev(`window.__arcCouncil.timeline(${q(vi)})`);
            const before = await timeline();
            const popoverBefore = await h.ev(`!!document.querySelector(${q(TL)})`);
            await click(h, `${MAP} [data-council-map-card='skeptic']`);
            const opened = await until(h, `!!document.querySelector('[data-council-timeline="skeptic"]')`);
            const asked = await timeline();
            const facts = () =>
                h.ev(`(() => {
                    const root = document.querySelector(${q(TL)});
                    if (!root) return null;
                    const t = (el) => el?.textContent?.replace(/\\s+/g, " ").trim() ?? null;
                    return {
                        id: root.dataset.councilTimeline,
                        title: t(root.querySelector("[data-council-timeline-title]")),
                        back: t(root.querySelector("[data-council-timeline-back]")),
                        empty: t(root.querySelector("[data-council-timeline-empty]")),
                        inSeats: !!root.closest("[class*='shadow-popover']"),
                        rows: [...root.querySelectorAll("[data-council-timeline-row]")].map((r) => {
                            const cmd = r.querySelector("[data-council-timeline-command]");
                            return {
                                kind: r.dataset.councilTimelineRow,
                                word: t(r.querySelector("[data-council-timeline-kind]")),
                                target: t(r.querySelector("[data-council-timeline-command], [data-council-timeline-target]")),
                                mono: cmd ? /mono/i.test(getComputedStyle(cmd).fontFamily) : false,
                                result: r.querySelector("[data-council-timeline-result]")?.dataset.councilTimelineResult ?? null,
                                resultText: t(r.querySelector("[data-council-timeline-result]")),
                                top: Math.round(r.getBoundingClientRect().top),
                            };
                        }),
                    };
                })()`);
            const sk = await facts();
            await h.shot("cdp-shots/council-map-card-click.png");
            // another card swaps the timeline in the same popover; a seat with no step says so
            await h.ev(`document.querySelector(${q(TL)}).parentElement.__keptOpen = true`);
            await click(h, `${MAP} [data-council-map-card='ram']`);
            await until(h, `!!document.querySelector('[data-council-timeline="ram"]')`);
            const second = await timeline();
            const ram = await facts();
            const kept = await h.ev(`document.querySelectorAll(${q(TL)}).length === 1 && document.querySelector(${q(TL)}).parentElement.__keptOpen === true`);
            // Back shows the list of seats, and the Seats button closes the popover
            await click(h, "[data-council-timeline-back]");
            const list = await until(h, `!!document.querySelector("[data-council-seat-list]")`);
            const afterBack = await timeline();
            const seats = `${MAP} header [data-council-seats]`;
            const inHeader = await h.ev(`!!document.querySelector(${q(seats)})`);
            await click(h, seats);
            const closed = await until(h, `!document.querySelector(${q(TL)}) && !document.querySelector("[data-council-seat-list]")`);
            await sleep(300);
            const afterClose = await timeline();
            const ok =
                before === null &&
                !popoverBefore &&
                opened &&
                asked === "skeptic" &&
                sk.inSeats &&
                sk.title === "Dòng thời gian của Tìm bug" &&
                sk.back === "Quay lại danh sách" &&
                sk.rows.map((r) => r.kind).join() === "read,search,run,propose,run" &&
                sk.rows.map((r) => r.word).join("|") === "Đọc|Tìm|Chạy lệnh|Đưa ra ý|Chạy lệnh" &&
                sk.rows.every((r, i) => i === 0 || r.top > sk.rows[i - 1].top) &&
                sk.rows[2].target === "go test ./pkg/services -run TestBusyStop" &&
                sk.rows[2].mono &&
                sk.rows[2].resultText === "Thất bại" &&
                sk.rows[1].resultText === "7 matches" &&
                sk.rows.filter((r) => r.kind !== "run").every((r) => !r.mono) &&
                sk.rows[4].target === VI_RUNNING &&
                sk.rows[4].mono &&
                sk.rows[4].result === "running" &&
                sk.rows[4].resultText === "Đang chạy" &&
                second === "ram" &&
                kept &&
                ram.id === "ram" &&
                ram.empty === "Chưa có bước nào" &&
                list &&
                afterBack === null &&
                inHeader &&
                closed &&
                afterClose === null;
            return { ok, detail: JSON.stringify({ before, popoverBefore, opened, asked, sk, second, kept, ram, list, afterBack, inHeader, closed, afterClose }) };
        });

        // the narrow header: the tabs are icons at every width, the word (Bản đồ here) in title and aria-label
        await step("at a 1000px window the Map's tabs are icons with Bản đồ in the Map tab's title and aria-label, and its header stays one 44px row with the title, the seats and the actions menu inside the pane", async () => {
            try {
                await h.cdp("Emulation.setDeviceMetricsOverride", { width: 1000, height: 950, deviceScaleFactor: 1, mobile: false });
                await openMap(h, vi);
                await sleep(400);
                const f = await h.ev(`(() => {
                    const root = document.querySelector(${q(MAP)});
                    const head = root.querySelector("header");
                    const row = head.firstElementChild;
                    const rootBox = root.getBoundingClientRect();
                    const inside = (el) => {
                        const b = el?.getBoundingClientRect();
                        return !!b && b.width > 0 && b.left >= rootBox.left - 1 && b.right <= rootBox.right + 1;
                    };
                    const title = head.querySelector("[data-council-map-title]");
                    return {
                        height: Math.round(row.getBoundingClientRect().height),
                        rootW: Math.round(rootBox.width),
                        tabs: [...head.querySelectorAll("[data-council-tab]")].map((b) => {
                            const word = b.querySelector("[data-council-tab-label]");
                            const wb = word.getBoundingClientRect();
                            return {
                                id: b.dataset.councilTab,
                                word: word.textContent.trim(),
                                wordShown: wb.width > 2 && wb.height > 2,
                                title: b.getAttribute("title"),
                                aria: b.getAttribute("aria-label"),
                                icon: !!b.querySelector("svg"),
                                selected: b.getAttribute("aria-selected") === "true",
                            };
                        }),
                        titleW: Math.round(title.clientWidth),
                        seatsIn: inside(head.querySelector("[data-council-seats]")),
                        lastIn: inside([...row.lastElementChild.children].pop()),
                        fits: row.scrollWidth <= row.clientWidth + 1,
                    };
                })()`);
                await h.shot("cdp-shots/council-map-header-narrow.png");
                const ok =
                    f.rootW < 900 &&
                    f.height === 44 &&
                    f.tabs.map((t) => t.word).join("|") === "Report|Discussion|Bản đồ" &&
                    f.tabs.every((t) => !t.wordShown && t.icon && t.title === t.word) &&
                    f.tabs[2].aria === "Bản đồ" &&
                    f.tabs[2].selected &&
                    f.titleW >= 60 &&
                    f.seatsIn &&
                    f.lastIn &&
                    f.fits;
                return { ok, detail: JSON.stringify(f) };
            } finally {
                await h.cdp("Emulation.setDeviceMetricsOverride", { width: 1600, height: 950, deviceScaleFactor: 1, mobile: false });
                await sleep(300);
            }
        });

        return steps;
    },

    async teardown(h, ctx) {
        await teardownCouncilProject(h, ctx);
    },
};
