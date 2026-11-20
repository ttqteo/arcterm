// The Agent panel's Council tab (canvas rail-council-chat, board B): the chat of the council a fixture agent started,
// in the panel beside its terminal. The agent is a fixture roster entry whose session id the council names
// (`sessionid`), on a real terminal block; the council is one fixture file rewritten through its states: running in
// round 2 (`round2`), paused with two held ideas (`room-awaiting`), then done. Nothing calls a model: Send to the others
// goes to a stand-in for CouncilDraftCommand. kit holds scenarios.mjs's helpers.

import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import {
    announceCouncil,
    arrangeCouncilProject,
    rpcCalls,
    stubRpc,
    teardownCouncilProject,
    writeCouncil,
} from "./council/fixtures.mjs";

const AGENT = "fx-rail-council";
const SESSION = "fx-rail-council-session";
const COUNCIL = "fx-council-rail-tab";
const KEYS = ["agent.rail.visible", "cockpit.rail.sections", "agent.rail.tab", "agent.chatmode"];

const ASIDE = `document.querySelector('aside[aria-label="Agent details"]')`;
const TAB = `${ASIDE}?.querySelector('[data-rail-tab="council"]')`;
const PANE = `${ASIDE}?.querySelector('[data-rail-council="${COUNCIL}"]')`;
const FEED = `${PANE}?.querySelector("[data-rail-council-feed]")`;
const MOVE = (kind) => `${PANE}?.querySelector('[data-rail-council-move="${kind}"]')`;
const ASIDE_WIDTH = `Math.round(${ASIDE}?.getBoundingClientRect().width ?? 0)`;
const SELECTED = `${ASIDE}?.querySelector('[role="tab"][aria-selected="true"]')?.dataset.railTab ?? null`;
const AT_END = `(() => { const f = ${FEED}; return f != null && f.scrollHeight - f.scrollTop - f.clientHeight < 48; })()`;
const buttonIn = (root, text) =>
    `[...(${root}?.querySelectorAll("button") ?? [])].find((b) => b.textContent.trim() === ${JSON.stringify(text)})`;

export default function (kit) {
    const { waveService, polishWaitFor, polishNap, openRailTerminal, ahReload, waitForProjectInConfig, polishReload, TREE_RAIL_FIXTURE, UI_ROUTE } = kit;
    const fx = { waveService, openRailTerminal, waitForProjectInConfig, polishReload };

    // the fixture council, as `name`, under the one id this agent started it with
    const place = (h, ctx, name) => {
        writeCouncil(ctx, name, { id: COUNCIL, edit: (c) => (c.sessionid = SESSION) });
        return announceCouncil(h, ctx, COUNCIL);
    };

    // the agent's pane is the one shown, its terminal in the centre
    async function show(h) {
        await h.rpc("uireveal", { address: `agent:${AGENT}` }, UI_ROUTE);
        return polishWaitFor(h, `(() => { const p = document.querySelector('[data-agent-terminal="${AGENT}"]'); return p != null && !p.classList.contains("hidden"); })()`, 10000);
    }

    async function pressC(h) {
        await h.ev(`document.activeElement?.blur?.(); document.querySelector("[data-cockpit-surface-wrap]")?.focus()`);
        const e = { key: "c", code: "KeyC", windowsVirtualKeyCode: 67, text: "c" };
        await h.cdp("Input.dispatchKeyEvent", { type: "keyDown", ...e });
        await h.cdp("Input.dispatchKeyEvent", { type: "keyUp", ...e });
        await polishNap(500);
    }

    const scenario = {
        name: "rail-council-tab",
        surface: "agent",
        async arrange(h) {
            let ctx = { prevKeys: {} };
            try {
                for (const k of KEYS) ctx.prevKeys[k] = await h.ev(`localStorage.getItem(${JSON.stringify(k)})`);
                ctx = { ...(await arrangeCouncilProject(h, fx)), prevKeys: ctx.prevKeys };
                ctx.prevFixture = existsSync(TREE_RAIL_FIXTURE) ? readFileSync(TREE_RAIL_FIXTURE, "utf8") : null;
                mkdirSync(new URL(".", TREE_RAIL_FIXTURE), { recursive: true });
                writeFileSync(
                    TREE_RAIL_FIXTURE,
                    JSON.stringify(
                        [
                            {
                                id: AGENT,
                                name: "council starter",
                                project: ctx.project,
                                task: "weigh the rail apps with a council",
                                state: "idle",
                                agent: "claude",
                                model: "opus",
                                idleSince: Date.now() - 60_000,
                                blockId: ctx.terminals[0].blockId,
                                sessionId: SESSION,
                            },
                        ],
                        null,
                        2
                    )
                );
                ctx.wroteFixture = true;
                writeCouncil(ctx, "round2", { id: COUNCIL, edit: (c) => (c.sessionid = SESSION) });
                // a known rail: open, on Overview, the agent on Terminal
                await h.ev(`(() => {
                    localStorage.setItem("agent.rail.visible", "true");
                    for (const k of ["cockpit.rail.sections", "agent.rail.tab"]) localStorage.removeItem(k);
                    localStorage.setItem("agent.chatmode", JSON.stringify({ [${JSON.stringify(AGENT)}]: "terminal" }));
                })()`);
                if (!(await ahReload(h))) throw new Error("the page did not come back after the reload");
                await h.goto("agent");
                ctx.inRoster = await polishWaitFor(h, `!!document.querySelector('[data-agent-terminal="${AGENT}"]')`, 20000);
                ctx.shown = ctx.inRoster && (await show(h));
            } catch (e) {
                ctx.arrangeError = String(e?.message ?? e);
            }
            return ctx;
        },
        async assert(h, ctx) {
            const steps = [];
            const rec = (step, ok, detail) => steps.push({ step, ok, detail });
            if (ctx.arrangeError != null || !ctx.shown) {
                rec("0. the fixture agent, its council and its terminal are in place", false, ctx.arrangeError ?? JSON.stringify({ inRoster: ctx.inRoster, shown: ctx.shown }));
                return steps;
            }
            try {
                // 1. the strip has a Council tab after the others, dotted green while the council runs
                const tab1 = await polishWaitFor(h, `!!${TAB}`, 15000);
                const tabs1 = await h.ev(`[...(${ASIDE}?.querySelectorAll('[role="tab"]') ?? [])].map((t) => t.dataset.railTab)`);
                const label1 = await h.ev(`${TAB}?.getAttribute("aria-label") ?? ""`);
                const dot1 = await h.ev(`!!${TAB}?.querySelector(".bg-working")`);
                rec(
                    "1. the strip shows a Council tab last, named for the council and its round, dotted green while it runs",
                    tab1 && tabs1.at(-1) === "council" && label1.startsWith("Council: Rail apps · Round 2 of 2") && dot1,
                    JSON.stringify({ tabs1, label1, dot1 })
                );

                // 2. the tab's body is the council's chat, at Overview's width, read to its newest message
                await h.ev(`${TAB}?.click()`);
                const pane2 = await polishWaitFor(h, `!!${PANE}`, 10000);
                await polishNap(600);
                const head2 = await h.ev(`${PANE}?.querySelector("#rail-council-title")?.textContent ?? ""`);
                const posts2 = await h.ev(`${PANE}?.querySelectorAll("[data-rail-council-post]").length ?? 0`);
                const round2 = await h.ev(`!!${PANE}?.querySelector('[data-rail-council-divider="2"]')`);
                const end2 = await h.ev(AT_END);
                const box2 = await h.ev(`!!${PANE}?.querySelector("[data-council-composer-input]")`);
                const w2 = await h.ev(ASIDE_WIDTH);
                await h.shot("cdp-shots/rail-council-tab-running.png");
                await h.whatsnewShot("rail-council", { selector: 'aside[aria-label="Agent details"]' });
                rec(
                    "2. clicking it shows the council's chat in the 300px panel: its head, the ideas and the round 2 replies in the list, read to the end, the message box under it",
                    pane2 && head2 === "Rail apps" && posts2 >= 20 && round2 && end2 && box2 && Math.abs(w2 - 300) <= 2,
                    JSON.stringify({ pane2, head2, posts2, round2, end2, box2, w2 })
                );

                // 3. a long message opens with Show more
                const more = `${PANE}?.querySelector('button[aria-expanded="false"]')`;
                const hasMore = await h.ev(`!!${more}`);
                await h.ev(`${more}?.click()`);
                await polishNap(300);
                const opened3 = await h.ev(`!!${PANE}?.querySelector('button[aria-expanded="true"]')`);
                rec("3. a message cut at four lines opens in full on Show more", hasMore && opened3, JSON.stringify({ hasMore, opened3 }));

                // 4. Open shows the full Discussion in the centre
                await h.ev(`${PANE}?.querySelector("[data-rail-council-open]")?.click()`);
                const disc4 = await polishWaitFor(h, `!!document.querySelector("[data-council-discussion]")`, 10000);
                rec("4. Open shows the council's full Discussion", disc4, JSON.stringify({ disc4 }));

                // 5. back on the terminal and on Overview, `c` selects the Council tab
                await show(h);
                await h.ev(`${ASIDE}?.querySelector('[data-rail-tab="overview"]')?.click()`);
                await polishNap(300);
                const before5 = await h.ev(SELECTED);
                await pressC(h);
                const after5 = await polishWaitFor(h, `(${SELECTED}) === "council"`, 5000);
                rec("5. `c` on the agent selects the Council tab", before5 === "overview" && after5, JSON.stringify({ before5, after5: await h.ev(SELECTED) }));

                // 6. paused with two held ideas: the amber row sends them on, one call each
                await place(h, ctx, "room-awaiting");
                const move6 = await polishWaitFor(h, `!!${MOVE("drafts")}`, 10000);
                const text6 = await h.ev(`${MOVE("drafts")}?.textContent ?? ""`);
                const dot6 = await h.ev(`!!${TAB}?.querySelector(".bg-asking")`);
                const held6 = await h.ev(`[...(${PANE}?.querySelectorAll("[data-rail-council-post]") ?? [])].filter((p) => p.textContent.includes("Waiting for you")).length`);
                await h.shot("cdp-shots/rail-council-tab-drafts.png");
                await stubRpc(h, ["CouncilDraftCommand"]);
                await h.ev(`${buttonIn(MOVE("drafts"), "Send to the others")}?.click()`);
                const sent6 = await polishWaitFor(h, `(window.__arcCouncilStub?.calls ?? []).length >= 2`, 5000);
                const calls6 = await rpcCalls(h, "CouncilDraftCommand");
                rec(
                    "6. with two held ideas the tab dots amber, both show Waiting for you, and Send to the others sends each on",
                    move6 && text6.includes("2 drafts wait for you") && dot6 && held6 === 2 && calls6.length === 2 && calls6.every((c) => c.data?.action === "send" && c.data?.id === COUNCIL),
                    JSON.stringify({ move6, text6, dot6, held6, sent6, calls6 })
                );

                // 7. done: no dot, and Read the report opens the Report
                await place(h, ctx, "done");
                const move7 = await polishWaitFor(h, `!!${MOVE("done")}`, 10000);
                const dot7 = await h.ev(`!!${TAB}?.querySelector(".bg-working, .bg-asking, .bg-error")`);
                await h.shot("cdp-shots/rail-council-tab-done.png");
                await h.ev(`${buttonIn(MOVE("done"), "Read the report")}?.click()`);
                const report7 = await polishWaitFor(h, `!!document.querySelector("[data-council-summary]")`, 10000);
                rec("7. once done the tab has no dot, and Read the report opens the Report", move7 && !dot7 && report7, JSON.stringify({ move7, dot7, report7 }));
            } catch (e) {
                rec("the scenario threw", false, String(e?.stack ?? e));
            }
            return steps;
        },
        async teardown(h, ctx) {
            const step = async (what, fn) => {
                try {
                    await fn();
                } catch (e) {
                    console.error(`rail-council-tab teardown: ${what} failed: ${e?.message ?? e}`);
                }
            };
            if (ctx.wroteFixture) {
                await step("restore the fixture roster", () =>
                    ctx.prevFixture != null ? writeFileSync(TREE_RAIL_FIXTURE, ctx.prevFixture) : rmSync(TREE_RAIL_FIXTURE, { force: true })
                );
            }
            await step("restore the keys", async () => {
                for (const [k, v] of Object.entries(ctx.prevKeys ?? {})) {
                    await h.ev(v == null ? `localStorage.removeItem(${JSON.stringify(k)})` : `localStorage.setItem(${JSON.stringify(k)}, ${JSON.stringify(v)})`);
                }
            });
            if (ctx.fx != null) {
                // the terminals, the council, the project, then a reload onto the restored roster
                await step("tear down the council project", () => teardownCouncilProject(h, ctx));
            }
        },
    };
    return [scenario];
}
