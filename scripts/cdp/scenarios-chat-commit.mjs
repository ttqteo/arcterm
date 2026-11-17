// The commit suggestion as a card in Chat (docs/superpowers/specs/2026-11-17-chat-commit-card-design.md). An agent that
// must ask before committing writes an ```arc-commit block; Chat draws it as a card with the message in an editable box,
// a tick per file and Commit, which sends the agent one line and folds the card into its ✓ row. Written against the DOM
// contract, not the component:
//   card     [data-chat-bscard-kind="commit"][data-chat-bscard-state="waiting|working|static"][data-chat-ccard="<key>"]
//            [data-chat-ccard-message] (a textarea while waiting), [data-chat-ccard-file="<path>"] with
//            [data-chat-ccard-tick][aria-checked], [data-chat-ccard-commit], [data-chat-ccard-error]
//   ✓ row    [data-chat-bscard-done="commit"]
//
// One fixture Claude agent over a real tab with a shell controller in a throwaway folder (so the line Commit sends has
// somewhere to go; the shell reads it as harmless words), a mock roster row for it and a fixture transcript. The line Arc
// sent is read from the page's send record (`chat.brainstorm.sent`) and appended to the transcript as the user message
// the agent received, with the agent's reply after it, so it pairs and draws nothing.

import { appendFileSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import * as AC from "./agent-page-fixtures.mjs";

const NAME = "chat commit main";
const PROJECT = "verify-chat-commit";
const SESSION = "chat-commit-main";
const SENT_KEY = "chat.brainstorm.sent";
const WAIT_MS = 15000;
const RECORD_WAIT_MS = 8000;

const MESSAGE = "Retry the sync on a lost connection\n\nThe client gave up after the first dropped request.";
const EDITED = "Retry the sync after a dropped request\n\nThe client gave up after the first dropped request.";
const FILES = ["src/sync/client.ts", "src/sync/client_test.ts"];
const BLOCK = ["```arc-commit", MESSAGE, "---", ...FILES, "```"].join("\n");
const INSTRUCTION = "Commit exactly these files with exactly this message, unchanged:";

const layerOf = (id) => `document.querySelector('[data-agent-chat="${id}"]')`;
const scrollerOf = (id) => `document.querySelector('[data-agent-chat="${id}"] .overflow-y-auto')`;
const FLAT = `((el) => (el?.textContent ?? "").replace(/\\s+/g, " ").trim())`;
const cardOf = (id) => `${layerOf(id)}?.querySelector('[data-chat-bscard-kind="commit"]')`;

export default function (kit) {
    const { waveService, polishWaitFor, polishNap, ahReload, GRID_KEY, GRID_EMPTY } = kit;
    const { makeTab, closeTabs } = AC.tabFixtures({ waveService });
    const LS_KEYS = [GRID_KEY, "agent.chatmode", SENT_KEY];

    const stamp = (ctx) => {
        ctx.last = Math.max((ctx.last ?? 0) + 1, Date.now());
        return { cwd: ctx.cwd, ts: new Date(ctx.last).toISOString() };
    };
    const rosterRows = (ctx) => [
        {
            project: PROJECT,
            task: "",
            agent: "claude",
            model: "opus",
            state: "idle",
            idleSince: ctx.idleSince,
            usage: { contextpct: 30 },
            id: ctx.tab.tabId,
            name: NAME,
            blockId: ctx.tab.blockId,
            transcriptPath: ctx.transcript,
        },
    ];

    const scenario = {
        name: "chat-commit",
        surface: "agent",
        async arrange(h) {
            const ctx = {
                dir: mkdtempSync(join(tmpdir(), "verify-ccm-")),
                cwd: mkdtempSync(join(tmpdir(), "verify-ccm-project-")),
                prev: {},
                idleSince: Date.now() - 60_000,
            };
            let at = "reading the keys";
            try {
                for (const k of LS_KEYS) ctx.prev[k] = await h.ev(`localStorage.getItem(${JSON.stringify(k)})`);

                at = "writing the transcript";
                const base = Date.now() - 3_600_000;
                const o = (sec) => ({ cwd: ctx.cwd, ts: new Date(base + sec * 1000).toISOString() });
                ctx.transcript = AC.writeTranscript(ctx.dir, SESSION, [
                    AC.userText("make the sync client retry, then commit it", o(0)),
                    AC.assistantText("The retry is in and its test passes.", o(10)),
                    AC.assistantText(`This repo wants your approval before a commit.\n\n${BLOCK}\n\nCommit these?`, o(20)),
                ]);
                ctx.last = Date.now();

                at = "resetting the grid";
                await h.ev(`localStorage.setItem(${JSON.stringify(GRID_KEY)}, ${JSON.stringify(JSON.stringify(GRID_EMPTY))})`);
                await h.ev(`localStorage.removeItem("agent.chatmode")`);
                await h.ev(`localStorage.removeItem(${JSON.stringify(SENT_KEY)})`);
                if (!(await ahReload(h))) throw new Error("the page did not come back after the reload");
                await h.goto("agent");

                at = "making the tab";
                ctx.tab = await makeTab(h, ctx, {
                    label: NAME,
                    blockMeta: { view: "term", controller: "shell", "cmd:cwd": ctx.cwd, "agent:transcriptpath": ctx.transcript },
                });

                at = "setting the roster";
                await AC.setRoster(h, rosterRows(ctx));
            } catch (e) {
                ctx.arrangeError = `${at}: ${String(e?.message ?? e)}`;
            }
            return ctx;
        },

        async assert(h, ctx) {
            const steps = [];
            const rec = (step, ok, detail) => steps.push({ step, ok: !!ok, detail: typeof detail === "string" ? detail : JSON.stringify(detail) });
            if (ctx.arrangeError != null) {
                rec("0. the fixture agent and its transcript", false, ctx.arrangeError);
                return steps;
            }
            const A = ctx.tab.tabId;
            const run = async (name, fn) => {
                try {
                    await fn(name);
                } catch (e) {
                    rec(name, false, `the step threw: ${String(e?.message ?? e)}`);
                }
            };
            const shot = async (name) => {
                try {
                    await h.shot(`cdp-shots/chat-commit-${name}.png`);
                } catch (e) {
                    console.error(`chat-commit: the shot ${name} failed: ${e?.message ?? e}`);
                }
            };
            const scrollEnd = async () => {
                await h.ev(`(() => { const s = ${scrollerOf(A)}; if (s) s.scrollTop = s.scrollHeight; return true; })()`);
                await polishNap(300);
            };
            const records = () =>
                h.ev(`(() => { try { return JSON.parse(localStorage.getItem(${JSON.stringify(SENT_KEY)}) ?? "{}")[${JSON.stringify(A)}] ?? []; } catch { return []; } })()`);
            const click = (sel) =>
                h.ev(`(() => {
                    const el = ${layerOf(A)}?.querySelector(${JSON.stringify(sel)});
                    if (!el) return "missing";
                    if (el.disabled) return "disabled";
                    el.click();
                    return "clicked";
                })()`);
            const readCard = () =>
                h.ev(`(() => {
                    const flat = ${FLAT};
                    const card = ${cardOf(A)};
                    const box = card?.querySelector("[data-chat-ccard-message]");
                    const commit = card?.querySelector("[data-chat-ccard-commit]");
                    return {
                        state: card?.getAttribute("data-chat-bscard-state") ?? null,
                        key: card?.getAttribute("data-chat-ccard") ?? null,
                        head: flat(card).slice(0, 120),
                        editable: box?.tagName === "TEXTAREA",
                        message: box ? (box.value ?? box.textContent ?? "") : null,
                        files: [...(card?.querySelectorAll("[data-chat-ccard-file]") ?? [])].map((r) => ({
                            path: r.getAttribute("data-chat-ccard-file"),
                            ticked: r.querySelector("[data-chat-ccard-tick]")?.getAttribute("aria-checked") ?? null,
                        })),
                        commit: commit ? { text: flat(commit), disabled: commit.disabled === true } : null,
                        error: flat(card?.querySelector("[data-chat-ccard-error]")),
                    };
                })()`);

            // the server refuses a prompt to a block that is a shell with no child (its agent gone: wshserver_agentmsg.go
            // shellHoldsNothing), so the fixture shell runs a native child that stands in for the agent and ignores what
            // is typed to it: once its prompt printed, a node that sleeps
            const holdShell = async () => {
                const up = await polishWaitFor(
                    h,
                    `(() => { const b = window.__arcTerms?.[${JSON.stringify(ctx.tab.blockId)}]?.terminal.buffer.active; for (let y = 0; b && y < b.length; y++) if ((b.getLine(y)?.translateToString(true) ?? "").trim() !== "") return true; return false; })()`,
                    WAIT_MS
                );
                if (!up) return false;
                await polishNap(1200);
                await h.rpc("controllerinput", {
                    blockid: ctx.tab.blockId,
                    inputdata64: Buffer.from(`node -e "setInterval(() => {}, 1 << 30)"\r`).toString("base64"),
                });
                await polishNap(2000);
                return true;
            };

            await h.cdp("Emulation.setFocusEmulationEnabled", { enabled: true });

            // 1. the card, waiting: the message in an editable box, both files ticked, Commit on
            await run("1. commit card waiting", async (name) => {
                await AC.focusAgent(h, A);
                ctx.held = await holdShell();
                const up = await polishWaitFor(h, `(${cardOf(A)}?.getAttribute("data-chat-bscard-state") ?? null) === "waiting"`, WAIT_MS);
                await polishNap(400);
                await scrollEnd();
                const card = await readCard();
                const blockAsCode = await h.ev(`(${layerOf(A)}?.textContent ?? "").includes("arc-commit")`);
                await shot("1-waiting");
                rec(
                    `${name}: the card waits with the block's message in a text box, ${FILES.length} files ticked, Commit enabled, and no arc-commit code left in the prose`,
                    up &&
                        (card.key ?? "").startsWith("commit:") &&
                        card.head.includes("Commit suggestion · 2 files") &&
                        card.editable &&
                        card.message === MESSAGE &&
                        card.files.map((f) => f.path).join() === FILES.join() &&
                        card.files.every((f) => f.ticked === "true") &&
                        card.commit?.text === "Commit" &&
                        card.commit.disabled === false &&
                        !blockAsCode,
                    { up, blockAsCode, ...card }
                );
            });

            // 2. edit the message and untick the second file
            await run("2. edit the message, untick a file", async (name) => {
                const typed = await h.ev(`(() => {
                    const box = ${cardOf(A)}?.querySelector("textarea[data-chat-ccard-message]");
                    if (!box) return false;
                    const set = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value").set;
                    set.call(box, ${JSON.stringify(EDITED)});
                    box.dispatchEvent(new Event("input", { bubbles: true }));
                    return true;
                })()`);
                const unticked = await click(`[data-chat-ccard-file="${FILES[1]}"] [data-chat-ccard-tick]`);
                await polishWaitFor(h, `${cardOf(A)}?.querySelector('[data-chat-ccard-file="${FILES[1]}"] [data-chat-ccard-tick]')?.getAttribute("aria-checked") === "false"`, WAIT_MS);
                await polishNap(300);
                const card = await readCard();
                await shot("2-edited");
                rec(
                    `${name}: the box holds the edit, ${FILES[1]} is unticked, ${FILES[0]} still ticked, Commit still enabled`,
                    typed &&
                        unticked === "clicked" &&
                        card.message === EDITED &&
                        card.files.map((f) => f.ticked).join() === "true,false" &&
                        card.commit?.disabled === false,
                    { typed, unticked, ...card }
                );
            });

            // 3. Commit: the line holds the edit and the one file left; once the agent took it, the card folds
            await run("3. press Commit, the card folds", async (name) => {
                const before = (await records()).length;
                const clicked = await click("[data-chat-ccard-commit]");
                let record = null;
                for (let waited = 0; waited < RECORD_WAIT_MS && record == null; waited += 250) {
                    record = (await records()).slice(before)[0] ?? null;
                    if (record == null) await polishNap(250);
                }
                const line = record?.text ?? "";
                // the agent receives the line and answers with the hash
                appendFileSync(
                    ctx.transcript,
                    [AC.userText(line, stamp(ctx)), AC.assistantText("Committed 4f2a9c1.", stamp(ctx))].join("\n") + "\n"
                );
                ctx.idleSince = Date.now();
                await AC.setRoster(h, rosterRows(ctx));
                const replied = await polishWaitFor(h, `(${layerOf(A)}?.textContent ?? "").includes("Committed 4f2a9c1.")`, WAIT_MS);
                const folded = await polishWaitFor(
                    h,
                    `[...(${layerOf(A)}?.querySelectorAll('[data-chat-bscard-done="commit"]') ?? [])].some((e) => ${FLAT}(e).includes("Commit sent"))`,
                    WAIT_MS
                );
                await scrollEnd();
                const row = await h.ev(`${FLAT}(${layerOf(A)}?.querySelector('[data-chat-bscard-done="commit"]'))`);
                const cardLeft = await h.ev(`!!${cardOf(A)}`);
                const bubbles = await h.ev(
                    `[...(${layerOf(A)}?.querySelectorAll("[data-chat-you]") ?? [])].filter((e) => ${FLAT}(e).includes(${JSON.stringify(INSTRUCTION)})).length`
                );
                await shot("3-sent");
                rec(
                    `${name}: Commit sends one line holding the edited message and ${FILES[0]} only, recorded as the card's; the card folds into "Commit suggestion · 1 file — Commit sent" and the line draws no bubble`,
                    clicked === "clicked" &&
                        record?.verdictOutcome === "commit" &&
                        (record?.verdictKey ?? "").startsWith("commit:") &&
                        record?.files === 1 &&
                        line.startsWith(INSTRUCTION) &&
                        line.includes(EDITED) &&
                        line.includes(`- ${FILES[0]}`) &&
                        !line.includes(FILES[1]) &&
                        replied &&
                        folded &&
                        row.includes("Commit suggestion · 1 file — Commit sent") &&
                        !cardLeft &&
                        bubbles === 0,
                    { held: ctx.held, clicked, record, replied, folded, row, cardLeft, bubbles }
                );
            });

            return steps;
        },

        async teardown(h, ctx) {
            const step = async (what, fn) => {
                try {
                    await fn();
                } catch (e) {
                    console.error(`chat-commit teardown: ${what} failed: ${e?.message ?? e}`);
                }
            };
            await step("restore the roster", () => AC.restoreRoster(h));
            await step("close the fixture tab", () => closeTabs(h, ctx));
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
            for (const dir of [ctx.dir, ctx.cwd]) {
                if (dir) await step(`remove ${dir}`, () => rmSync(dir, { recursive: true, force: true, maxRetries: 20, retryDelay: 500 }));
            }
            await step("go home", () => h.goto("cockpit"));
        },
    };

    return [scenario];
}
