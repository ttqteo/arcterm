// brainstorm-board-pick: a board opened full size offers the answer it shows under it. The layout question (BS_FILES.layout:
// "Which layout should the page use?", two answers, the part's two boards tied to them by position) has a board per answer
// in the rail; opening a board draws it in the board dialog with its pick under it ("Pick A · Lag first", the agent's pick
// tagged), closing the dialog sends nothing, and the pick on board B sends B's label as the answer, once, and closes the
// dialog on the pane reading the agent writing it up. The pick is brainstormrail.tsx's BoardPickBar (boardPick in
// brainstormmodel.ts); brainstorm-mode's step 2l4 reaches the same pick as part of a long walk, this one is the short
// version Task 7 of docs/superpowers/plans/2026-11-06-kael-sync-surfaces.md asks for.
//
// kit is scenarios.mjs's BS_KIT. What brainstorm-mode's arrange and steps use that the kit lacks is duplicated here, not
// added to scenarios.mjs: the recorder of the lines the page sends an agent, the shell's prompt, and the read of the rail's
// tiles and the board dialog.

import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const NAME = "brainstorm-board-pick";
// the shell's prompt ends its last row: pwsh and cmd end in >, bash and zsh in $, # or %
const PROMPT = /[>$#%]$/;
const PROMPT_WAIT_MS = 20000;
// the tile's click attaches the canvas, and the poller fills its state a beat after
const BOARD_WAIT_MS = 5000;
const CLOSE_WAIT_MS = 3000;
const WORKING_WAIT_MS = 3000;

// records every line the page sends an agent (the agentprompt call), as brainstorm-mode's BS_TYPED_INSTALL does
const TYPED_INSTALL = `(() => {
    const c = window.TabRpcClient;
    if (!c) return false;
    if (c.__bsOrig) return true;
    c.__bsOrig = c.wshRpcCall;
    const call = c.wshRpcCall.bind(c);
    window.__bsTyped = [];
    c.wshRpcCall = (command, data, opts) => {
        if (command === "agentprompt") window.__bsTyped.push({ block: data?.blockid, text: data?.text });
        return call(command, data, opts);
    };
    return true;
})()`;
const TYPED_REMOVE = `(() => {
    const c = window.TabRpcClient;
    if (c?.__bsOrig) {
        c.wshRpcCall = c.__bsOrig;
        delete c.__bsOrig;
    }
    return true;
})()`;

export default function (kit) {
    const {
        BS_BOARDS,
        BS_FILES,
        BS_PANE,
        BS_TOPIC,
        bsAgentTook,
        bsArrangeAgent,
        bsMark,
        bsMouseClick,
        bsShowFile,
        bsTeardownAgent,
        bsTermText,
        bsTyped,
        bsUntil,
        polishNap,
        skipStep,
    } = kit;

    const QUESTION = BS_FILES.layout.question;
    const LETTERS = ["A", "B"];
    const tile = (name) => `${BS_PANE}?.querySelector('[data-brainstorm-board-rail] [data-brainstorm-rail-board="${name}"]')`;
    const tileButton = (name) => `${tile(name)}?.querySelector("button")`;
    const DIALOG = `${BS_PANE}?.querySelector("[data-brainstorm-board-dialog]")`;
    const PICK = `${BS_PANE}?.querySelector("[data-brainstorm-board-pick]")`;
    const CLOSE = `${DIALOG}?.querySelector("[data-brainstorm-rail-close]")`;

    // everything a step judges: the rail's tiles, the board dialog, the board it shows, and the pick row under that board
    const READ = `(() => {
        const flat = (el) => (el?.innerText ?? "").replace(/\\s+/g, " ").trim();
        const pane = ${BS_PANE};
        const dialog = ${DIALOG};
        const wide = dialog?.querySelector("[data-brainstorm-rail-widened]");
        const bar = dialog?.querySelector("[data-brainstorm-board-pick-bar]");
        const pick = bar?.querySelector("[data-brainstorm-board-pick]");
        const scroll = wide?.querySelector("[data-canvas-scroll]");
        const d = dialog?.getBoundingClientRect();
        const b = bar?.getBoundingClientRect();
        const s = scroll?.getBoundingClientRect();
        return {
            tiles: [...(pane?.querySelectorAll("[data-brainstorm-board-rail] [data-brainstorm-rail-board]") ?? [])].map((t) => ({
                name: t.getAttribute("data-brainstorm-rail-board"),
                frame: !!t.querySelector("iframe"),
            })),
            dialog: !!dialog,
            board: wide?.querySelector("[data-canvas-frame]")?.getAttribute("data-canvas-frame") ?? null,
            head: flat(wide?.querySelector("[data-brainstorm-rail-board-head]")),
            bar: flat(bar),
            pick: flat(pick),
            pickOption: pick?.getAttribute("data-brainstorm-board-pick") ?? null,
            pickDisabled: pick?.disabled ?? null,
            // the row is the dialog's last, wholly inside it and under the board's scroll area
            barInside: !!(b && d && b.left >= d.left - 1 && b.right <= d.right + 1 && b.bottom <= d.bottom + 1),
            barUnder: !!(b && s && b.top >= s.bottom - 1),
            // one pick for one board: the row offers the board's answer and no other
            picks: dialog?.querySelectorAll("[data-brainstorm-board-pick]").length ?? 0,
        };
    })()`;
    const read = (h) => h.ev(READ);
    // polls the rail and dialog until want(read) holds; the last read and whether it did
    async function until(h, want, ms = BOARD_WAIT_MS) {
        const start = Date.now();
        let r;
        do {
            r = await read(h).catch((e) => ({ error: String(e?.message ?? e), tiles: [] }));
            if (r.error == null && want(r)) return { ...r, ok: true };
            await polishNap(200);
        } while (Date.now() - start < ms);
        return { ...r, ok: false };
    }

    // a board for each answer, headed by it so the screenshot says which is which
    const boardHtml = (name, label) =>
        `<!doctype html><title>${name}</title><body style="margin:0;font:64px sans-serif"><h1 style="margin:64px">${label}</h1></body>`;

    const scenario = {
        name: NAME,
        surface: "agent",
        async arrange(h) {
            const ctx = await bsArrangeAgent(h, BS_TOPIC, BS_FILES.layout);
            if (ctx.launchError != null || ctx.cwd == null) return ctx;
            // the canvas the file names (.superpowers/design/<topic>/project), written before the pane's reveal attaches it
            try {
                const project = join(ctx.cwd, ".superpowers", "design", BS_TOPIC, "project");
                mkdirSync(project, { recursive: true });
                writeFileSync(
                    join(project, "canvas.json"),
                    JSON.stringify({ boards: Object.fromEntries(BS_BOARDS.map((b) => [b, { w: 1440 }])), order: BS_BOARDS })
                );
                BS_BOARDS.forEach((b, i) => writeFileSync(join(project, b), boardHtml(b, QUESTION.options[i].label)));
            } catch (e) {
                ctx.launchError = String(e?.message ?? e);
            }
            return ctx;
        },
        async assert(h, ctx) {
            const missing = await bsShowFile(h, ctx);
            if (missing != null) return [skipStep(NAME, `could not verify: ${missing}`)];
            const steps = [];
            const rec = (step, ok, detail) => steps.push({ step, ok, detail: typeof detail === "string" ? detail : JSON.stringify(detail) });

            // a line typed before the shell's first prompt can be lost, and the terminal is where a sent line is read
            let prompt = "";
            for (const start = Date.now(); Date.now() - start < PROMPT_WAIT_MS; await polishNap(250)) {
                const rows = (await bsTermText(h, ctx, "\n").catch(() => "")).split("\n").filter((r) => r.trim() !== "");
                prompt = rows.at(-1)?.trim() ?? "";
                if (PROMPT.test(prompt)) break;
            }
            rec("0. the agent's shell is at its prompt, so a sent line can be read", PROMPT.test(prompt), { lastRow: prompt });
            if (!PROMPT.test(prompt)) return steps;
            await h.ev(TYPED_INSTALL);

            // 1. the question with a board tile per answer, and no board open
            const asked = await bsUntil(h, ctx, (s) => s.question.includes(QUESTION.text) && s.options.length === 2);
            const rail = await until(h, (r) => r.tiles.length === 2 && r.tiles.every((t) => t.frame));
            await h.shot("cdp-shots/brainstorm-board-pick-1-question.png");
            rec(
                "1. the layout question is up with its two answers and a live board tile for each in the rail; no board is open and no pick is offered yet",
                asked.ok &&
                    rail.ok &&
                    JSON.stringify(rail.tiles.map((t) => t.name)) === JSON.stringify(BS_BOARDS) &&
                    !rail.dialog &&
                    rail.pick === "",
                { question: asked.ok, tiles: rail.tiles, dialog: rail.dialog, pick: rail.pick }
            );
            if (!asked.ok || !rail.ok) return steps;

            // 2. board A opened full size: its answer's pick under it, tagged as the agent's pick
            const openedA = await bsMouseClick(h, tileButton(BS_BOARDS[0]));
            const a = await until(h, (r) => r.dialog && r.board === BS_BOARDS[0] && r.pick !== "");
            await h.shot("cdp-shots/brainstorm-board-pick-2-board-a.png");
            const wantA = `Pick ${LETTERS[0]} · ${QUESTION.options[0].label}`;
            rec(
                "2. a board opened full size offers its answer under it: board A in the dialog has Pick A · Lag first as its one pick, under the board and inside the dialog, tagged Agent’s pick",
                openedA !== false &&
                    a.ok &&
                    a.pick === wantA &&
                    a.pickOption === "0" &&
                    a.picks === 1 &&
                    a.barInside &&
                    a.barUnder &&
                    a.bar === `${wantA} Agent’s pick`,
                { opened: openedA, board: a.board, pick: a.pick, bar: a.bar, option: a.pickOption, picks: a.picks, inside: a.barInside, under: a.barUnder }
            );

            // 3. the close button leaves the board with nothing sent, the question still on screen
            const typedBefore = await h.ev(`(window.__bsTyped ?? []).length`);
            const closedA = await bsMouseClick(h, CLOSE);
            const gone = await until(h, (r) => !r.dialog, CLOSE_WAIT_MS);
            const sA = await bsUntil(h, ctx, (s) => s.question.includes(QUESTION.text) && s.options.length === 2, 2000);
            const typedAfter = await h.ev(`(window.__bsTyped ?? []).length`);
            rec(
                "3. closing the board sends nothing: the dialog is gone, the question and its two answers still on screen",
                closedA !== false && gone.ok && sA.ok && typedAfter === typedBefore,
                { closed: closedA, dialog: gone.dialog, question: sA.ok, typed: [typedBefore, typedAfter] }
            );
            if (!gone.ok) return steps;

            // 4. board B: its own answer's pick, with no agent's-pick tag since B is not the agent's pick
            const openedB = await bsMouseClick(h, tileButton(BS_BOARDS[1]));
            const b = await until(h, (r) => r.dialog && r.board === BS_BOARDS[1] && r.pick !== "");
            await h.shot("cdp-shots/brainstorm-board-pick-3-board-b.png");
            const lineB = QUESTION.options[1].label;
            const wantB = `Pick ${LETTERS[1]} · ${lineB}`;
            rec(
                "4. board B offers B's answer, not A's: Pick B · Trend first, the only pick in its dialog, with no Agent’s pick tag",
                openedB !== false &&
                    b.ok &&
                    b.pick === wantB &&
                    b.pickOption === "1" &&
                    b.picks === 1 &&
                    b.barInside &&
                    b.barUnder &&
                    b.bar === wantB &&
                    b.pickDisabled === false,
                { opened: openedB, board: b.board, pick: b.pick, bar: b.bar, option: b.pickOption, picks: b.picks, disabled: b.pickDisabled }
            );
            if (!b.ok) return steps;

            // 5. the pick sends the answer as the answer's own row does: B's label, once, to the agent's block, and the
            // dialog closes on the pane reading the agent writing it up
            const mark = await bsMark(h, ctx, lineB);
            const picked = await bsMouseClick(h, PICK);
            const typed = await bsTyped(h, ctx, mark, lineB);
            const closed = await until(h, (r) => !r.dialog, CLOSE_WAIT_MS);
            const writing = await bsUntil(h, ctx, (s) => s.working !== "", WORKING_WAIT_MS);
            await h.shot("cdp-shots/brainstorm-board-pick-4-answered.png");
            rec(
                "5. Pick B sends Trend first as the question's answer, once, and closes the board: the pane reads the agent writing it up, in the question's place, with no answer box",
                picked !== false &&
                    typed.ok &&
                    closed.ok &&
                    writing.ok &&
                    writing.working.includes("Writing up your answer.") &&
                    !writing.answerBox &&
                    writing.question === "",
                { picked, ...typed.detail, dialog: closed.dialog, working: writing.working, answerBox: writing.answerBox, question: writing.question }
            );
            // the agent takes the line and ends its turn, so the pane is left as it would be
            await bsAgentTook(h, ctx);
            return steps;
        },
        async teardown(h, ctx) {
            try {
                await h.ev(TYPED_REMOVE);
            } catch (e) {
                console.error(`${NAME} teardown: stop recording sent lines failed: ${e?.message ?? e}`);
            }
            await bsTeardownAgent(h, ctx, NAME);
        },
    };
    return [scenario];
}
