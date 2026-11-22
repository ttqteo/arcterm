// Scenario `chat-board-ref`: a board named in Chat by the `@` picker (refmention.ts boardRefs, refbadge.ts, chatrefbadge.tsx).
// One fixture claude agent over a real tab, in a mock roster, with a transcript whose first message names a board as
// `board:<id>`; two fixture boards of its project (the board commands stubbed in the page, boards-fixtures.mjs), the older one
// open beside Chat.
//
//   1. the bubble draws `board:<id>` as a badge: resolved, the Shapes mark, the board's name
//   2. `@draw` in the box lists both boards, the one open beside Chat first
//   3. Enter picks it: the box holds `board:<id> ` as text and draws it as the same badge
//   4. a click on the bubble's badge opens that board beside the agent's Chat

import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import * as AC from "./agent-page-fixtures.mjs";
import { installBoardStubs, putBoard, removeBoardStubs } from "./boards-fixtures.mjs";

const NAME = "chat-board-ref";
const PROJECT = "chat-board-ref-fx";
const SESSION = "chat-board-ref-session";
const OPEN_ID = "b0a4d0a1";
const OPEN_NAME = "huong-luan-van";
const OTHER_ID = "b0a4d0b2";
const OTHER_NAME = "wavesrv-startup";
const AGENT_TITLE = `claude · ${PROJECT}`;
const WAIT_MS = 10000;

const box = (id) => `document.querySelector('[data-agent-chat="${id}"] [data-agent-chat-composer] [data-chat-input]')`;
const bubbleBadge = (id, token) =>
    `document.querySelector('[data-agent-chat="${id}"] [data-chat-conversation] [data-chat-ref="${token}"]')`;

// what one badge shows, from an expression that finds the element carrying data-chat-ref; null when it is not there
const readBadge = (h, expr) =>
    h.ev(`(() => {
        const el = ${expr};
        if (!el) return null;
        return {
            state: el.getAttribute("data-ref-state"),
            mark: el.getAttribute("data-ref-mark"),
            name: el.querySelector("[data-ref-name]")?.textContent ?? null,
            title: el.getAttribute("title"),
        };
    })()`);

// the box's text as the agent receives it, from Lexical's own state (a badge draws a name, not its token)
const boxText = (id) =>
    `((e) => {
        const ed = e?.__lexicalEditor;
        if (!ed) return null;
        const text = (n) =>
            n.type === "ref-mention" ? n.raw
            : n.type === "linebreak" ? "\\n"
            : typeof n.text === "string" ? n.text
            : (n.children ?? []).map(text).join("");
        return ed.getEditorState().toJSON().root.children.map(text).join("\\n");
    })(${box(id)})`;

const mentionRows = (h) =>
    h.ev(`[...document.querySelectorAll("[data-chat-mentions] [data-chat-mention]")].map((li) => ({
        key: li.getAttribute("data-chat-mention"),
        text: li.textContent.trim(),
        selected: li.getAttribute("aria-selected") === "true",
    }))`);

async function key(h, k) {
    for (const type of ["keyDown", "keyUp"]) await h.cdp("Input.dispatchKeyEvent", { type, ...k });
}
const ENTER = { key: "Enter", code: "Enter", windowsVirtualKeyCode: 13 };

export default function (kit) {
    const { waveService, polishWaitFor, polishNap, ahReload, GRID_KEY, GRID_EMPTY } = kit;
    const { makeTab, closeTabs } = AC.tabFixtures({ waveService });
    const LS_KEYS = [GRID_KEY, "agent.chatmode", "agent.openboards"];

    const scenario = {
        name: NAME,
        surface: "agent",

        async arrange(h) {
            const ctx = { prev: {}, dir: mkdtempSync(join(tmpdir(), "verify-chat-board-ref-")) };
            let at = "reading the keys";
            try {
                for (const k of LS_KEYS) ctx.prev[k] = await h.ev(`localStorage.getItem(${JSON.stringify(k)})`);

                at = "writing the transcript";
                const base = Date.now() - 3_600_000;
                const o = (sec) => ({ cwd: ctx.dir, ts: new Date(base + sec * 1000).toISOString() });
                ctx.transcript = AC.writeTranscript(ctx.dir, SESSION, [
                    AC.userText(`board:${OPEN_ID} tách khung 4 thành 3 ô`, o(0)),
                    AC.assistantText("Đã nhờ board vẽ lại khung 4.", o(4)),
                ]);

                at = "resetting the grid";
                await h.ev(`localStorage.setItem(${JSON.stringify(GRID_KEY)}, ${JSON.stringify(JSON.stringify(GRID_EMPTY))})`);
                await h.ev(`localStorage.removeItem("agent.chatmode")`);
                if (!(await ahReload(h))) throw new Error("the page did not come back after the reload");
                await h.goto("agent");

                at = "making the tab";
                ctx.agent = await makeTab(h, ctx, {
                    label: PROJECT,
                    blockMeta: { view: "term", "agent:transcriptpath": ctx.transcript },
                });

                at = "setting the roster";
                await AC.setRoster(h, [
                    {
                        project: PROJECT,
                        task: "",
                        agent: "claude",
                        model: "opus",
                        state: "idle",
                        idleSince: Date.now() - 60_000,
                        id: ctx.agent.tabId,
                        name: AGENT_TITLE,
                        blockId: ctx.agent.blockId,
                        transcriptPath: ctx.transcript,
                    },
                ]);

                at = "stubbing the boards";
                await installBoardStubs(h);
                const agent = { tabid: ctx.agent.tabId, title: AGENT_TITLE };
                // the open board is the older one, so only its being open puts it first
                await putBoard(h, { id: OPEN_ID, name: OPEN_NAME, project: PROJECT, agent, createdts: Date.now() - 7_200_000 });
                await putBoard(h, { id: OTHER_ID, name: OTHER_NAME, project: PROJECT, agent, createdts: Date.now() - 60_000 });
                await AC.agentPage(
                    h,
                    `const S = await mod("app/view/boards/boardsplitstore.ts");
                    globalStore.set((await mod("app/view/boards/boardentries.ts")).boardEntriesAtom, [{ project: ${JSON.stringify(PROJECT)}, boardId: ${JSON.stringify(OPEN_ID)} }]);
                    return true;`
                );
                await AC.focusAgent(h, ctx.agent.tabId);
                // the board is open and reads this Chat; its cell joins the agent's grid so it shows as well
                await AC.agentPage(
                    h,
                    `const G = await mod("app/view/agents/gridstore.ts");
                    G.openBoardCell(agentsModel(), { project: ${JSON.stringify(PROJECT)}, boardId: ${JSON.stringify(OPEN_ID)} }, ${JSON.stringify(ctx.agent.tabId)});
                    return true;`
                );
            } catch (e) {
                ctx.arrangeError = `${at}: ${String(e?.message ?? e)}`;
            }
            return ctx;
        },

        async assert(h, ctx) {
            const steps = [];
            const rec = (step, ok, detail) => steps.push({ step, ok: !!ok, detail: typeof detail === "string" ? detail : JSON.stringify(detail) });
            if (ctx.arrangeError != null) {
                rec("0. the fixture agent and boards", false, ctx.arrangeError);
                return steps;
            }
            const A = ctx.agent.tabId;
            const run = async (name, fn) => {
                try {
                    await fn(name);
                } catch (e) {
                    rec(name, false, `the step threw: ${String(e?.message ?? e)}`);
                }
            };
            const token = `board:${OPEN_ID}`;

            await run("1. the bubble draws board:<id> as a resolved badge with the Shapes mark and the board's name", async (name) => {
                const seen = await polishWaitFor(h, `${bubbleBadge(A, token)}?.getAttribute("data-ref-state") === "resolved"`, WAIT_MS);
                const badge = await readBadge(h, bubbleBadge(A, token));
                await polishNap(300);
                await h.shot(`cdp-shots/${NAME}-bubble.png`);
                rec(name, seen && badge?.mark === "board" && badge?.name === OPEN_NAME, { seen, badge });
            });

            await run("2. `@draw` lists both boards, the one open beside Chat first", async (name) => {
                await h.ev(`${box(A)}?.focus()`);
                await h.cdp("Input.insertText", { text: "vẽ thêm @draw" });
                const listed = await polishWaitFor(
                    h,
                    `document.querySelectorAll('[data-chat-mentions] [data-chat-mention^="ref:board:"]').length === 2`,
                    WAIT_MS
                );
                const rows = await mentionRows(h);
                await polishNap(300);
                await h.shot(`cdp-shots/${NAME}-picker.png`);
                const boards = rows.filter((r) => r.key.startsWith("ref:board:"));
                rec(
                    name,
                    listed && boards[0]?.key === `ref:board:${OPEN_ID}` && boards[0].text.includes(OPEN_NAME) && boards[1]?.key === `ref:board:${OTHER_ID}`,
                    { listed, rows }
                );
            });

            await run("3. Enter picks the open board: the box holds `board:<id> ` and draws it as the same badge", async (name) => {
                await key(h, ENTER);
                const drawn = await polishWaitFor(h, `${box(A)}?.querySelector('[data-chat-ref="${token}"]')?.getAttribute("data-ref-state") === "resolved"`, WAIT_MS);
                const text = await h.ev(boxText(A));
                const badge = await readBadge(h, `${box(A)}?.querySelector('[data-chat-ref="${token}"]')`);
                await polishNap(300);
                await h.shot(`cdp-shots/${NAME}-box.png`);
                rec(name, drawn && text === `vẽ thêm ${token} ` && badge?.mark === "board" && badge?.name === OPEN_NAME, { drawn, text, badge });
            });

            await run("4. a click on the bubble's badge opens that board beside the agent's Chat", async (name) => {
                await AC.agentPage(
                    h,
                    `const S = await mod("app/view/boards/boardsplitstore.ts");
                    for (const b of [...globalStore.get((await mod("app/view/boards/boardentries.ts")).openBoardsAtom).values()]) S.closeBoard(agentsModel(), b);
                    return true;`
                );
                await polishNap(300);
                const opened = await h.ev(`(() => { const b = ${bubbleBadge(A, token)}?.closest('[role="button"]'); b?.click(); return !!b; })()`);
                const split = await (async () => {
                    const end = Date.now() + WAIT_MS;
                    let s = null;
                    while (Date.now() < end) {
                        s = await AC.agentPage(
                            h,
                            `const S = await mod("app/view/boards/boardsplitstore.ts");
                            return ([...globalStore.get((await mod("app/view/boards/boardentries.ts")).openBoardsAtom).values()][0] ?? null);`
                        );
                        if (s?.boardId === OPEN_ID) break;
                        await polishNap(250);
                    }
                    return s;
                })();
                // the click is openBoard: the board is a cell beside the agent's Chat
                const cell = await polishWaitFor(h, `document.querySelectorAll('[data-board-cell="${OPEN_ID}"]').length === 1`, WAIT_MS);
                await polishNap(600);
                await h.shot(`cdp-shots/${NAME}-opened.png`);
                rec(name, opened && cell && split?.boardId === OPEN_ID && split?.project === PROJECT, { split, cell });
            });

            return steps;
        },

        async teardown(h, ctx) {
            const step = async (what, fn) => {
                try {
                    await fn();
                } catch (e) {
                    console.error(`${NAME} teardown: ${what} failed: ${e?.message ?? e}`);
                }
            };
            await step("close the board split", () =>
                AC.agentPage(
                    h,
                    `const S = await mod("app/view/boards/boardsplitstore.ts");
                    for (const b of [...globalStore.get((await mod("app/view/boards/boardentries.ts")).openBoardsAtom).values()]) S.closeBoard(agentsModel(), b);
                    return true;`
                )
            );
            await step("restore the board commands", () => removeBoardStubs(h));
            await step("restore the roster", () => AC.restoreRoster(h));
            await step("close the fixture tab", () => closeTabs(h, ctx));
            await step("remove the transcript", () => rmSync(ctx.dir, { recursive: true, force: true }));
            await step("restore the keys", () =>
                h.ev(`(() => {
                    for (const [k, v] of Object.entries(${JSON.stringify(ctx.prev ?? {})})) {
                        if (v == null) localStorage.removeItem(k);
                        else localStorage.setItem(k, v);
                    }
                    return true;
                })()`)
            );
            await step("reload onto the live roster", () => ahReload(h));
            await step("go home", () => h.goto("cockpit"));
        },
    };

    return [scenario];
}
