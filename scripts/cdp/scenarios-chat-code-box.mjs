// Fenced code in Chat: the message box draws what you type as typed (no code box, no quote bar), and your
// bubble keeps code typed on the fence's own line (```curl https://…) in its block instead of reading it as the
// language (chatfences.ts splitFenceInfo). Read through the editor's text (it holds no <code> or <em>), and the code block (its [data-code-head] and rows) in a [data-chat-you] bubble.
//
// One fixture Claude agent over a real tab, a fixture roster row for it (the page's dev mock roster) and a fixture
// transcript holding the sent prompt. kit holds scenarios.mjs's helpers.

import { copyFileSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import * as AC from "./agent-page-fixtures.mjs";

const NAME = "chat code box";
const WAIT_MS = 15000;
const SHORT_MS = 3000;

// the prompt sent with code on the fence's line: its first line must stay in the block
const SENT = '```curl https://api.example.test/v1/one \\\n  -H "Authorization: Bearer KEY" \\\n  -d \'{"model": "x"}\'\n```';
const SENT_FIRST = "curl https://api.example.test/v1/one";
// the reply's one-line command: a compact row with Run and Copy, as Claude Desktop draws it (codeblock.tsx)
const COMPACT = "! task install";
// a command the reply wrote as a bare line, not in code: Chat fences it (bashlines.ts), so its `**` stay and it draws as a
// command row instead of prose with a bold word in it (step 1b2)
const BARE = `! python -c "t.replace('**WAITING.**','**SIGNED.**')"`;
// a reply paragraph long enough to wrap in the box (step 7)
const LONG_PARA =
    "The endpoint took 180 ms on the first call and 40 ms on the next ones, so the cold start is the token check, not the model. " +
    "Caching the key for a minute would cut the first call to about the same as the rest, and the logs show no retries in the last hour. " +
    "If you want, I can add the cache behind a flag so we can compare both on the same traffic before keeping it.";

const layerOf = (id) => `document.querySelector('[data-agent-chat="${id}"]')`;
const inputOf = (id) => `${layerOf(id)}?.querySelector("[data-chat-input]")`;

const KEYS = {
    backspace: { key: "Backspace", code: "Backspace", windowsVirtualKeyCode: 8 },
    shiftEnter: { key: "Enter", code: "Enter", windowsVirtualKeyCode: 13, modifiers: 8 },
};

export default function (kit) {
    const { waveService, polishWaitFor, polishNap, ahReload, GRID_KEY, GRID_EMPTY } = kit;
    const { makeTab, closeTabs } = AC.tabFixtures({ waveService });

    async function key(h, k) {
        for (const type of ["keyDown", "keyUp"]) await h.cdp("Input.dispatchKeyEvent", { type, ...k });
    }
    async function clearBox(h, id) {
        await h.ev(`(${inputOf(id)})?.focus()`);
        const mac = await h.ev(`/Mac/i.test(navigator.platform)`);
        for (const type of ["keyDown", "keyUp"]) {
            await h.cdp("Input.dispatchKeyEvent", { type, key: "a", code: "KeyA", windowsVirtualKeyCode: 65, modifiers: mac ? 4 : 2, commands: ["selectAll"] });
        }
        await key(h, KEYS.backspace);
        await polishNap(150);
    }
    // lines typed as a person does: each line's text, Shift+Enter between them
    async function typeLines(h, id, lines) {
        await h.ev(`(${inputOf(id)})?.focus()`);
        for (let i = 0; i < lines.length; i++) {
            if (i > 0) await key(h, KEYS.shiftEnter);
            if (lines[i] !== "") await h.cdp("Input.insertText", { text: lines[i] });
        }
        await polishNap(200);
    }
    async function shot(h, name) {
        try {
            await h.shot(`cdp-shots/chat-code-box-${name}.png`);
        } catch (e) {
            console.error(`chat-code-box: the shot ${name} failed: ${e?.message ?? e}`);
        }
    }
    // the box's text, and any markdown drawn in it (none: it draws the text as typed)
    const readBox = (h, id) =>
        h.ev(`(() => {
            const input = ${inputOf(id)};
            return {
                text: (input?.innerText ?? "").replace(/\\n$/, ""),
                drawn: input?.querySelectorAll("code, em").length ?? -1,
                layers: input?.parentElement?.querySelectorAll("[data-chat-code-layer]").length ?? -1,
            };
        })()`);

    const scenario = {
        name: "chat-code-box",
        surface: "agent",
        async arrange(h) {
            const ctx = { dir: mkdtempSync(join(tmpdir(), "verify-chat-code-box-")), prev: {} };
            let at = "reading the keys";
            try {
                ctx.prev[GRID_KEY] = await h.ev(`localStorage.getItem(${JSON.stringify(GRID_KEY)})`);
                at = "copying the image";
                // a local image the reply names by its full path (step 8), and one by a relative path
                ctx.image = join(ctx.dir, "shot.png");
                copyFileSync(join(process.cwd(), "public", "logos", "arcterm.png"), ctx.image);
                at = "writing the transcript";
                const o = (sec) => ({ cwd: ctx.dir, ts: new Date(Date.now() - 600_000 + sec * 1000).toISOString() });
                ctx.transcript = AC.writeTranscript(ctx.dir, "chat-code-box", [
                    AC.userText(SENT, o(0)),
                    AC.assistantText(`Sent it to the endpoint; it answered 200.\n\n${LONG_PARA}\n\n![the shot](${ctx.image})\n\n![relative](cdp-shots/none.png)\n\nTo install it, type:\n\n\`\`\`\n${COMPACT}\n\`\`\`\n\nThen sign it:\n\n${BARE}`, o(5)),
                ]);
                at = "resetting the grid";
                await h.ev(`localStorage.setItem(${JSON.stringify(GRID_KEY)}, ${JSON.stringify(JSON.stringify(GRID_EMPTY))})`);
                if (!(await ahReload(h))) throw new Error("the page did not come back after the reload");
                await h.ev(`(() => { window.__chatSuggestFake = () => []; return true; })()`);
                await h.goto("agent");
                at = "making the tab";
                ctx.tab = await makeTab(h, ctx, { label: NAME });
                at = "setting the roster";
                await AC.setRoster(h, [
                    {
                        project: "verify-chat-code-box",
                        task: "",
                        agent: "claude",
                        model: "opus",
                        state: "idle",
                        idleSince: Date.now() - 60_000,
                        id: ctx.tab.tabId,
                        name: NAME,
                        blockId: ctx.tab.blockId,
                        transcriptPath: ctx.transcript,
                    },
                ]);
            } catch (e) {
                ctx.arrangeError = `${at}: ${String(e?.message ?? e)}`;
            }
            return ctx;
        },

        async assert(h, ctx) {
            const steps = [];
            const rec = (step, ok, detail) => steps.push({ step, ok: ok === true, detail: typeof detail === "string" ? detail : JSON.stringify(detail) });
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
            await h.cdp("Emulation.setFocusEmulationEnabled", { enabled: true });

            // 1. the sent prompt: code on the fence's line stays in the block, the first line of the block
            await run("1. sent fence keeps its first line", async (name) => {
                await AC.focusAgent(h, A);
                // CodeBlock (codeblock.tsx): a head ([data-code-head], the language tag in it), then one row per line, its
                // number and its text
                const up = await polishWaitFor(h, `!!${layerOf(A)}?.querySelector("[data-chat-you] [data-code-head]")`, WAIT_MS);
                const got = await h.ev(`(() => {
                    const head = ${layerOf(A)}?.querySelector("[data-chat-you] [data-code-head]");
                    const rows = [...(head?.parentElement?.querySelectorAll("div.font-mono") ?? [])];
                    const lines = rows.map((r) => r.lastElementChild?.textContent ?? "").filter((l) => l.trim() !== "");
                    const lang = head?.querySelector(".uppercase")?.textContent ?? null;
                    return { first: lines[0] ?? null, lines: lines.length, lang };
                })()`);
                await shot(h, "1-sent-bubble");
                rec(
                    `${name}: the [data-chat-you] bubble draws a code block whose first line is "${SENT_FIRST} \\", three lines, with no "curl" language tag`,
                    up && (got.first ?? "").startsWith(SENT_FIRST) && got.lines === 3 && got.lang !== "curl",
                    { up, ...got }
                );
            });

            // 1b. the reply's one-line command: one compact row, no head and no line number, Run (▷) and Copy at its right
            await run("1b. one-line command is a compact row", async (name) => {
                const up = await polishWaitFor(h, `!!${layerOf(A)}?.querySelector("[data-code-compact]")`, WAIT_MS);
                const got = await h.ev(`(() => {
                    const row = ${layerOf(A)}?.querySelector("[data-code-compact]");
                    const line = row?.querySelector("[data-code-line]");
                    return {
                        text: line?.textContent ?? null,
                        head: !!row?.querySelector("[data-code-head]"),
                        run: !!row?.querySelector("[data-code-run]"),
                        runTitle: row?.querySelector("[data-code-run]")?.getAttribute("title") ?? null,
                        copy: !!row?.querySelector("[data-code-copy] button"),
                        height: row ? Math.round(row.getBoundingClientRect().height) : null,
                        // as wide as its command, not the reply column
                        width: row ? Math.round(row.getBoundingClientRect().width) : null,
                        column: row?.parentElement ? Math.round(row.parentElement.getBoundingClientRect().width) : null,
                        mono: line ? /mono/i.test(getComputedStyle(line).fontFamily) : false,
                    };
                })()`);
                await h.ev(`${layerOf(A)}?.querySelector("[data-code-compact]")?.scrollIntoView({ block: "center" })`);
                await shot(h, "1b-compact-command");
                rec(
                    `${name}: "${COMPACT}" in the reply is one [data-code-compact] row in mono, no head, a Run (into this agent, as \`! command\`) and a Copy button, under 48px tall, narrower than the column`,
                    up && got.text === COMPACT && !got.head && got.run && got.runTitle === "Run in this agent (! in Chat)" && got.copy && got.mono && got.height != null && got.height < 48 && got.width != null && got.column != null && got.width < got.column - 40,
                    { up, ...got }
                );
            });

            // 1c. a local image in the reply: read from disk and drawn (not the webview's broken image); a relative one is named
            // 1b2. a `! cmd` the reply wrote bare: a compact row too, its text as written (the `**` kept, no bold in the reply)
            await run("1b2. bare command line is a compact row", async (name) => {
                const find = `[...(${layerOf(A)}?.querySelectorAll("[data-code-compact]") ?? [])].find((r) => r.querySelector("[data-code-line]")?.textContent === ${JSON.stringify(BARE)})`;
                const up = await polishWaitFor(h, `!!(${find})`, WAIT_MS);
                const got = await h.ev(`(() => {
                    const row = ${find};
                    return {
                        rows: ${layerOf(A)}?.querySelectorAll("[data-code-compact]").length ?? 0,
                        run: !!row?.querySelector("[data-code-run]"),
                        copy: !!row?.querySelector("[data-code-copy] button"),
                        bold: [...(${layerOf(A)}?.querySelectorAll("strong") ?? [])].map((s) => s.textContent).filter((t) => /WAITING|SIGNED/.test(t)),
                    };
                })()`);
                await h.ev(`(${find})?.scrollIntoView({ block: "center" })`);
                await shot(h, "1b2-bare-command");
                rec(
                    `${name}: the bare line ${BARE} draws as a second [data-code-compact] row with its text as written, Run and Copy, and no <strong> holds WAITING or SIGNED`,
                    up && got.rows === 2 && got.run && got.copy && got.bold.length === 0,
                    { up, ...got }
                );
            });

            await run("1c. local image in a reply is drawn", async (name) => {
                const drawn = await polishWaitFor(h, `!!${layerOf(A)}?.querySelector("[data-reply-image] img")?.complete`, WAIT_MS);
                const got = await h.ev(`(() => {
                    const img = ${layerOf(A)}?.querySelector("[data-reply-image] img");
                    const named = [...(${layerOf(A)}?.querySelectorAll("[data-prompt-image-gone]") ?? [])].map((e) => e.textContent);
                    return { src: img?.getAttribute("src")?.slice(0, 5) ?? null, natural: img?.naturalWidth ?? 0, alt: img?.alt ?? null, named };
                })()`);
                await h.ev(`${layerOf(A)}?.querySelector("[data-reply-image]")?.scrollIntoView({ block: "center" })`);
                await shot(h, "1c-reply-image");
                rec(
                    `${name}: the reply's ![the shot](<full path>) is an <img> from a blob: URL with pixels; the relative one is named "none.png · not a full path"`,
                    drawn && got.src === "blob:" && got.natural > 0 && got.named.some((t) => t.includes("none.png") && t.includes("not a full path")),
                    { drawn, ...got }
                );
            });

            // 2. a fenced block, a quote and inline code typed in the box: drawn as typed, no markdown
            await run("2. the box draws markdown as typed", async (name) => {
                await clearBox(h, A);
                await typeLines(h, A, ["look at this:", "```bash", "npm run build", "```", "> see `npm test` here"]);
                const got = await readBox(h, A);
                await shot(h, "2-typed-plain");
                rec(
                    `${name}: the text is as typed; no <code> or <em> in the editor and no [data-chat-code-layer] beside it`,
                    got.drawn === 0 && got.layers === 0 && got.text === "look at this:\n```bash\nnpm run build\n```\n> see `npm test` here",
                    got
                );
            });

            // 6. a stack trace pasted goes in fenced; one undo leaves the raw paste
            await run("6. pasted log is fenced, undo leaves it raw", async (name) => {
                await clearBox(h, A);
                await typeLines(h, A, ["it breaks:"]);
                const pasted = "    at MergeChecks (MergeChecks.tsx:11:38)\n    at div\nreact-dom.development.js:26962 Uncaught TypeError: Cannot read properties of undefined";
                await h.ev(`(() => {
                    const input = ${inputOf(A)};
                    const data = new DataTransfer();
                    data.setData("text/plain", ${JSON.stringify(pasted)});
                    input.dispatchEvent(new ClipboardEvent("paste", { clipboardData: data, bubbles: true, cancelable: true }));
                    return true;
                })()`);
                const fenced = await polishWaitFor(h, `(${inputOf(A)})?.innerText?.includes("\`\`\`")`, SHORT_MS);
                const after = await readBox(h, A);
                // the box grows on a spring: the shot and the measure wait for it to settle
                await polishNap(600);
                const size = await h.ev(`(() => {
                    const input = ${inputOf(A)};
                    return { client: input?.clientHeight ?? -1, scroll: input?.scrollHeight ?? -1 };
                })()`);
                after.size = size;
                // five lines fit under the editor's max height, so it shows them all without scrolling
                after.allShown = size.client > 0 && size.scroll <= size.client + 1;
                await shot(h, "6-pasted-log");
                const mac = await h.ev(`/Mac/i.test(navigator.platform)`);
                for (const type of ["keyDown", "keyUp"]) {
                    await h.cdp("Input.dispatchKeyEvent", { type, key: "z", code: "KeyZ", windowsVirtualKeyCode: 90, modifiers: mac ? 4 : 2 });
                }
                await polishNap(250);
                const undone = await readBox(h, A);
                await shot(h, "6b-undo-raw");
                rec(
                    `${name}: the paste after "it breaks:" goes in as "it breaks:\\n\`\`\`\\n<log>\\n\`\`\`" with all its lines shown; one Ctrl+Z leaves "it breaks:<log>" with no fence`,
                    fenced &&
                        after.allShown &&
                        after.text === "it breaks:\n```\n" + pasted + "\n```" &&
                        undone.text === "it breaks:" + pasted,
                    { fenced, after, undone }
                );
            });

            // 7. Reply, type, Reply again, type: each quote lands in the text where the person is, as a `> ` line, so the
            // draft reads quote, text, quote, text; nothing is drawn over the editor
            await run("7. Reply quotes stay where they were put", async (name) => {
                await clearBox(h, A);
                const reply = async (needle) => {
                    const picked = await h.ev(`(() => {
                        const layer = ${layerOf(A)};
                        const walk = document.createTreeWalker(layer, NodeFilter.SHOW_TEXT);
                        for (let n = walk.nextNode(); n != null; n = walk.nextNode()) {
                            if (n.parentElement?.closest("[data-chat-input]") != null) continue;
                            const at = n.textContent.indexOf(${JSON.stringify(needle)});
                            if (at < 0) continue;
                            n.parentElement.scrollIntoView({ block: "center" });
                            const r = document.createRange();
                            r.setStart(n, at);
                            r.setEnd(n, at + ${JSON.stringify(needle)}.length);
                            const sel = getSelection();
                            sel.removeAllRanges();
                            sel.addRange(r);
                            return true;
                        }
                        return false;
                    })()`);
                    const shown = picked && (await polishWaitFor(h, `!!document.querySelector("[data-chat-quote-button]")`, SHORT_MS));
                    if (shown) await h.ev(`document.querySelector("[data-chat-quote-button]").click()`);
                    await polishNap(250);
                    return shown;
                };
                const first = await reply("Sent it to the endpoint; it answered 200.");
                await typeLines(h, A, ["có, thêm cache đi"]);
                const second = await reply(LONG_PARA);
                await typeLines(h, A, ["cái này thì sao?"]);
                const got = await h.ev(`(() => {
                    const layer = ${layerOf(A)};
                    return {
                        overEditor: layer?.querySelectorAll("[data-chat-quotes], [data-chat-quote-chip]").length ?? 0,
                    };
                })()`);
                const draft = await readBox(h, A).then((b) => b.text).catch(() => "");
                const at = (t) => draft.indexOf(t);
                const ordered =
                    at("> Sent it to the endpoint") === 0 &&
                    at("> Sent it to the endpoint") < at("có, thêm cache đi") &&
                    at("có, thêm cache đi") < at("> " + LONG_PARA.slice(0, 20)) &&
                    at("> " + LONG_PARA.slice(0, 20)) < at("cái này thì sao?");
                await shot(h, "7-quotes-in-place");
                rec(
                    `${name}: the draft reads quote, text, quote, text; no quote block over the editor`,
                    first && second && ordered && got.overEditor === 0,
                    { first, second, ordered, ...got, draft }
                );
            });

            return steps;
        },

        async teardown(h, ctx) {
            const step = async (what, fn) => {
                try {
                    await fn();
                } catch (e) {
                    console.error(`chat-code-box teardown: ${what} failed: ${e?.message ?? e}`);
                }
            };
            if (ctx.tab != null) await step("empty the box", () => clearBox(h, ctx.tab.tabId));
            await step("remove the probe", () => h.ev(`(() => { delete window.__chatSuggestFake; return true; })()`));
            await step("restore the roster", () => AC.restoreRoster(h));
            await step("close the fixture tab", () => closeTabs(h, ctx));
            await step("restore the grid", () =>
                h.ev(`(() => {
                    const v = ${JSON.stringify(ctx.prev?.[GRID_KEY] ?? null)};
                    if (v == null) localStorage.removeItem(${JSON.stringify(GRID_KEY)});
                    else localStorage.setItem(${JSON.stringify(GRID_KEY)}, v);
                    return true;
                })()`)
            );
            await step("reload onto the live roster", () => ahReload(h));
            if (ctx.dir) await step(`remove ${ctx.dir}`, () => rmSync(ctx.dir, { recursive: true, force: true, maxRetries: 20, retryDelay: 500 }));
            await step("go home", () => h.goto("cockpit"));
        },
    };

    return [scenario];
}
