// chat-read-picture: a picture the agent read, in Chat's steps (frontend/app/view/agents/chatstepsview.tsx PictureThumb,
// chatsteps.ts pictureOf). One fixture Claude agent over a real tab, whose transcript (a temp file) holds one finished
// turn: the agent reads a picture (a copy of the app's logo in the temp folder) and a source file, then answers. The
// stretch's folded line ends with the picture's thumbnail; opened, the Read row of the picture ends with it too, and a
// click on that row opens the picture under it. Nothing runs and nothing is written into ~/.claude/projects.
// kit is scenarios.mjs's RT_KIT (polishWaitFor, polishNap, waveService).

import { copyFileSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import * as AC from "./agent-page-fixtures.mjs";

const NAME = "chat-read-picture";
const AGENT_NAME = "reads a picture";
const SESSION = "chat-read-picture";
const WAIT_MS = 15_000;

const layerOf = (id) => `document.querySelector('[data-agent-chat="${id}"]')`;

// what the agent's Chat shows of its one stretch, read in one call
const seen = (id) => `(() => {
    const work = ${layerOf(id)}?.querySelector("[data-chat-work]");
    const loaded = (el) => el?.tagName === "IMG" && el.complete && el.naturalWidth > 0;
    const rows = [...(work?.querySelectorAll("[data-chat-step]") ?? [])];
    return {
        work: work != null,
        line: work?.querySelector("[data-fold-sentence]")?.textContent.trim() ?? null,
        lineThumbs: [...(work?.querySelectorAll("[data-fold-thumbs] [data-chat-step-thumb]") ?? [])].map(loaded),
        rows: rows.map((r) => ({
            verb: r.querySelector("[data-chat-step-verb]")?.textContent.trim() ?? null,
            text: r.textContent.trim(),
            thumb: loaded(r.querySelector("[data-chat-step-thumb]")),
            opens: r.getAttribute("role") === "button",
        })),
        picture: loaded(work?.querySelector("[data-chat-step-picture] img")),
    };
})()`;

function writeFixture(dir) {
    const shot = join(dir, "screenshot.png");
    copyFileSync(join(process.cwd(), "public", "logos", "arcterm.png"), shot);
    const src = join(dir, "panel.tsx");
    const at = (agoMs) => ({ cwd: dir, ts: new Date(Date.now() - agoMs).toISOString() });
    const path = AC.writeTranscript(dir, SESSION, [
        AC.userText(`Why does the panel look off?\n\nAttached images:\n- ${shot}`, at(5 * 60_000)),
        AC.toolUse("toolu_pic_read", "Read", { file_path: shot }, at(4 * 60_000)),
        AC.toolResult("toolu_pic_read", [{ type: "image", source: { type: "base64", media_type: "image/png", data: "" } }], at(4 * 60_000)),
        AC.toolUse("toolu_pic_src", "Read", { file_path: src }, at(4 * 60_000 - 2_000)),
        AC.toolResult("toolu_pic_src", "export function Panel() {\n    return null;\n}", at(4 * 60_000 - 2_000)),
        AC.assistantText("The panel's padding is doubled: the frame and the body both add 12px.", at(3 * 60_000)),
    ]);
    return { path, shot };
}

export default function (kit) {
    const { polishWaitFor, polishNap } = kit;
    const { makeTab, closeTabs } = AC.tabFixtures(kit);

    const roster = (ctx) => [
        {
            id: ctx.id,
            name: AGENT_NAME,
            project: "fx-chat-read-picture",
            task: "",
            state: "idle",
            idleSince: Date.now() - 30_000,
            agent: "claude",
            model: "opus",
            blockId: ctx.blockId,
            transcriptPath: ctx.path,
        },
    ];

    return [
        {
            name: NAME,
            surface: "agent",
            async arrange(h) {
                const ctx = { dir: mkdtempSync(join(tmpdir(), "verify-chat-picture-")) };
                try {
                    Object.assign(ctx, writeFixture(ctx.dir));
                    await h.goto("agent");
                    const { tabId, blockId } = await makeTab(h, ctx, { label: AGENT_NAME });
                    ctx.id = tabId;
                    ctx.blockId = blockId;
                    await AC.setRoster(h, roster(ctx));
                    await AC.agentPage(h, `const M = await mod("app/view/agents/chatmodestore.ts"); M.setChatMode(${JSON.stringify(tabId)}, "chat"); return true;`);
                    await AC.focusAgent(h, tabId);
                } catch (e) {
                    ctx.arrangeError = String(e?.message ?? e);
                }
                return ctx;
            },
            async assert(h, ctx) {
                const steps = [];
                const rec = (step, ok, detail) => steps.push({ step, ok: ok === true, detail: typeof detail === "string" ? detail : JSON.stringify(detail) });
                if (ctx.arrangeError != null) {
                    rec(`${NAME}: arrange`, false, ctx.arrangeError);
                    return steps;
                }
                const id = ctx.id;
                const until = (cond) => polishWaitFor(h, `((s) => ${cond})(${seen(id)})`, WAIT_MS);
                const run = async (name, fn) => {
                    try {
                        await fn(name);
                    } catch (e) {
                        rec(name, false, `the step threw: ${String(e?.message ?? e)}`);
                    }
                };
                const click = (sel) =>
                    h.ev(`(() => { const el = ${layerOf(id)}?.querySelector(${JSON.stringify(sel)}); el?.scrollIntoView({ block: "center" }); el?.click(); return !!el; })()`);

                await run("1. folded line", async (name) => {
                    const ok = await until(`s.work && s.lineThumbs.length === 1 && s.lineThumbs[0]`);
                    await polishNap(400);
                    const s = await h.ev(seen(id));
                    await h.shot("cdp-shots/chat-read-picture-1-folded.png");
                    rec(`${name}: the stretch's folded line ends with the thumbnail of the one picture it read`, ok && s.rows.length === 0, s);
                });

                await run("1b. thumbnail zooms", async (name) => {
                    await click("[data-fold-thumbs] [data-chat-step-thumb-open]");
                    const zoom = `document.querySelector("[data-image-zoom] [data-image-zoom-img]")`;
                    const ok = await polishWaitFor(h, `!!${zoom}`, WAIT_MS);
                    await polishNap(400);
                    const s = await h.ev(seen(id));
                    await h.shot("cdp-shots/chat-read-picture-1b-zoom.png");
                    await h.ev(`document.querySelector("[data-modal-scrim]")?.click()`);
                    await polishWaitFor(h, `!document.querySelector("[data-image-zoom]")`, 3000);
                    rec(
                        `${name}: one click on the folded line's thumbnail opens the picture full size over Chat, and leaves the line folded`,
                        ok && s.rows.length === 0,
                        { ok, rows: s.rows.length }
                    );
                });

                await run("2. opened rows", async (name) => {
                    await click("[data-chat-work] [data-fold]");
                    const ok = await until(`s.rows.length === 2`);
                    await polishNap(500);
                    const s = await h.ev(seen(id));
                    await h.shot("cdp-shots/chat-read-picture-2-rows.png");
                    rec(
                        `${name}: opened, the line drops its thumbnail and the picture's Read row ends with it, and opens; the source file's row has none`,
                        ok && s.lineThumbs.length === 0 && s.rows[0].verb === "Read" && s.rows[0].thumb && s.rows[0].opens && !s.rows[1].thumb,
                        s
                    );
                });

                await run("3. picture opened", async (name) => {
                    await click("[data-chat-work] [data-chat-step]");
                    const ok = await until(`s.picture`);
                    await polishNap(500);
                    const s = await h.ev(seen(id));
                    await h.shot("cdp-shots/chat-read-picture-3-opened.png");
                    rec(`${name}: a click on the picture's row opens the picture under it`, ok, s);
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
                await step("restore the roster", () => AC.restoreRoster(h));
                await step("drop the focus", () => AC.agentPage(h, `globalStore.set(agentsModel().focusIdAtom, undefined); return true;`));
                await step("close the fixture tab", () => closeTabs(h, ctx));
                await step("remove the fixture transcript", () => rmSync(ctx.dir, { recursive: true, force: true, maxRetries: 20, retryDelay: 500 }));
                await step("go home", () => h.goto("cockpit"));
            },
        },
    ];
}
