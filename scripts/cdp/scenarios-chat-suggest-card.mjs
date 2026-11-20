// Chat's usage-limit strip above the composer (docs/superpowers/specs/2026-11-18-chat-suggest-card-design.md; the summary
// line that spec also drew was removed on 2026-11-19), one scenario:
//
//   chat-limit-strip: [data-chat-limit-strip] above the chips and the box, for the weekly window at 80%
//   or more (data-chat-limit-window="week", the 5-hour reading in the same line when it is past too) or the 5-hour at 90%
//   or more ("fivehour"); with a second account it names the one the agent runs on ([data-chat-limit-account]) and offers
//   [data-chat-limit-switch] to the one with the most room; the Switch writes claude:activeaccount and this agent's
//   agent:claudeaccount and restarts the agent; Snooze hides the strip. The identity, the saved windows and the active
//   account come from the DEV-only window.__chatLimitFake (a dev store holds no second account).
//
// A fixture Claude agent over real tabs and the page's dev mock roster, as scenarios-rail-brainstorm-initiative.mjs
// makes them; no real agent is launched. A small RPC mock stands in for wavesrv where a step would otherwise write real
// state (the chip's text typed into the block; the account switch's setconfig, setmeta, controllerdestroy and
// controllerresync), and records what it was given. Keys and clicks are real CDP input events.

import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import * as AC from "./agent-page-fixtures.mjs";

const WAIT_MS = 15000;
const SHORT_MS = 5000;
const PROJECT = "verify-chat-suggest-card";
const SNOOZE_KEY = "arc.chatLimitSnooze";
const VK = { Tab: 9, Enter: 13, Escape: 27 };

// --- page expressions -------------------------------------------------------------------------------------------------

const layerOf = (id) => `document.querySelector('[data-agent-chat="${id}"]')`;
const FLAT = `((el) => (el?.textContent ?? "").replace(/\\s+/g, " ").trim())`;
const RECT = `((el) => { if (!el) return null; const b = el.getBoundingClientRect(); return { top: Math.round(b.top), bottom: Math.round(b.bottom), width: Math.round(b.width) }; })`;

// --- the strip scenario's accounts ------------------------------------------------------------------------------------

const LOGIN = "me@verify.test";
const WORK = { id: "awork", label: "Work", email: "work@verify.test" };
const MOCK_KEY = "__suggestCardMock";

export default function (kit) {
    const { waveService, polishWaitFor, polishNap, ahReload, GRID_KEY, GRID_EMPTY } = kit;
    const { makeTab, closeTabs } = AC.tabFixtures({ waveService });

    // --- input ------------------------------------------------------------------------------------------------------

    async function press(h, name, nap = 300) {
        for (const type of ["keyDown", "keyUp"]) {
            await h.cdp("Input.dispatchKeyEvent", { type, key: name, code: name, windowsVirtualKeyCode: VK[name] });
        }
        await polishNap(nap);
    }

    // A mouse click at the middle of the element `expr` evaluates to; false when none is drawn. A strip or a menu that is
    // still springing into place is clicked where it settles.
    async function click(h, expr) {
        const measure = () =>
            h.ev(`(() => {
                const el = ${expr};
                if (!el) return null;
                const r = el.getBoundingClientRect();
                return r.width > 0 && r.height > 0 ? { x: Math.round(r.x + r.width / 2), y: Math.round(r.y + r.height / 2) } : null;
            })()`);
        let box = await measure();
        for (let i = 0; i < 8 && box != null; i++) {
            await polishNap(120);
            const again = await measure();
            const steady = again != null && again.x === box.x && again.y === box.y;
            box = again;
            if (steady) break;
        }
        if (box == null) return false;
        await h.cdp("Input.dispatchMouseEvent", { type: "mouseMoved", x: box.x, y: box.y });
        for (const type of ["mousePressed", "mouseReleased"]) {
            await h.cdp("Input.dispatchMouseEvent", { type, x: box.x, y: box.y, button: "left", clickCount: 1 });
        }
        await polishNap(300);
        return true;
    }

    async function shot(h, name) {
        try {
            await h.shot(`cdp-shots/chat-suggest-card-${name}.png`);
        } catch (e) {
            console.error(`chat-suggest-card: the shot ${name} failed: ${e?.message ?? e}`);
        }
    }

    // polls a Node-side check until it holds
    async function until(check, ms = SHORT_MS) {
        for (let waited = 0; waited < ms; waited += 250) {
            if (await check()) return true;
            await polishNap(250);
        }
        return false;
    }

    // --- the RPC mock -----------------------------------------------------------------------------------------------

    // Stands in for wavesrv on what a step would otherwise write for real, for one agent's block: the text typed into it, the
    // account switch's setconfig (claude:activeaccount), setmeta (agent:claudeaccount on the block), controllerdestroy and
    // controllerresync. Each is recorded in window.<MOCK_KEY>.calls and answered with null; every other call goes on to
    // whatever client was installed before.
    async function installMock(h, blockId) {
        const got = await AC.agentPage(
            h,
            `const api = (await mod("app/store/wshclientapi.ts")).RpcApi;
            if (!api || typeof api.setMockRpcClient !== "function") return "no-api";
            if (window.${MOCK_KEY}) return "already-installed";
            const block = ${JSON.stringify(blockId)};
            const prev = api.mockClient ?? null;
            const m = { api, prev, calls: [] };
            const held = (command, data) => {
                switch (command) {
                    case "controllerinput":
                        return data?.blockid === block;
                    case "controllerdestroy":
                        return data === block;
                    case "controllerresync":
                        return data?.blockid === block;
                    case "setmeta":
                        return data?.oref === "block:" + block && data?.meta != null && "agent:claudeaccount" in data.meta;
                    case "setconfig":
                        return data != null && "claude:activeaccount" in data;
                    default:
                        return false;
                }
            };
            api.setMockRpcClient({
                mockWshRpcCall(client, command, data, opts) {
                    if (held(command, data)) {
                        m.calls.push({ command, data });
                        return Promise.resolve(null);
                    }
                    return prev ? prev.mockWshRpcCall(client, command, data, opts) : client.wshRpcCall(command, data, opts);
                },
                mockWshRpcStream(client, command, data, opts) {
                    return prev ? prev.mockWshRpcStream(client, command, data, opts) : client.wshRpcStream(command, data, opts);
                },
            });
            window.${MOCK_KEY} = m;
            return "installed";`
        );
        if (got !== "installed") throw new Error(`the RPC mock: ${got}`);
    }
    const removeMock = (h) =>
        AC.agentPage(
            h,
            `const m = window.${MOCK_KEY};
            if (m) { m.api.setMockRpcClient(m.prev); delete window.${MOCK_KEY}; }
            return true;`
        );
    const mockCalls = (h, command) =>
        h.ev(`(window.${MOCK_KEY}?.calls ?? []).filter((c) => c.command === ${JSON.stringify(command)})`);
    const clearMockCalls = (h) => h.ev(`(() => { if (window.${MOCK_KEY}) window.${MOCK_KEY}.calls.length = 0; return true; })()`);

    // a step that throws is a failed step, not the end of the run: the ones after it read what they need themselves
    function stepRunner(steps) {
        const rec = (step, ok, detail) => steps.push({ step, ok: ok === true, detail: typeof detail === "string" ? detail : JSON.stringify(detail) });
        const run = async (name, fn) => {
            try {
                await fn(name);
            } catch (e) {
                rec(name, false, `the step threw: ${String(e?.message ?? e)}`);
            }
        };
        return { rec, run };
    }

    const roster = (rows) =>
        rows.map((r) => ({
            project: PROJECT,
            task: "",
            agent: "claude",
            model: "opus",
            state: "idle",
            idleSince: Date.now() - 60_000,
            usage: { contextpct: 20 },
            ...r,
        }));

    // --- chat-limit-strip -------------------------------------------------------------------------------------------

    // the saved snapshot of one account: its weekly and 5-hour readings, resetting a day and two hours from now
    const snap = (week, five) => {
        const now = Date.now();
        return {
            weekpct: week,
            weekreset: Math.floor((now + 26 * 3_600_000) / 1000),
            fivehourpct: five,
            fivehourreset: Math.floor((now + 2 * 3_600_000) / 1000),
            capturedAt: now,
        };
    };
    const ONE = { loginEmail: LOGIN, accounts: [] };
    const TWO = { loginEmail: LOGIN, accounts: [{ id: WORK.id, label: WORK.label, email: WORK.email }] };
    const keyOf = (email) => `claude:${email}`;
    // the fake as the strip reads it: this agent is on the /login account (its usage names none), the Work account is the
    // other; `own` and `other` are the [week, 5-hour] readings of the two
    const fakeOf = (identity, own, other, extra = {}) => ({
        identity,
        saved: { [keyOf(LOGIN)]: snap(...own), [keyOf(WORK.email)]: snap(...other) },
        active: "",
        ...extra,
    });

    const limitScenario = {
        name: "chat-limit-strip",
        surface: "agent",
        async arrange(h) {
            const ctx = { dir: mkdtempSync(join(tmpdir(), "verify-chat-limit-")), prev: {} };
            let at = "reading the keys";
            try {
                for (const k of [GRID_KEY, "agent.chatmode", SNOOZE_KEY]) ctx.prev[k] = await h.ev(`localStorage.getItem(${JSON.stringify(k)})`);

                at = "writing the transcript";
                // the file's name is the session id the strip's Switch resumes, so the agent is a restart candidate
                ctx.transcript = AC.writeTranscript(ctx.dir, "chat-limit-session", [
                    AC.userText("add a retry to the sync client", { cwd: ctx.dir, ts: new Date(Date.now() - 600_000).toISOString() }),
                    AC.assistantText("Done: the sync client now retries 3 times, 2 seconds apart.", { cwd: ctx.dir, ts: new Date(Date.now() - 598_000).toISOString() }),
                ]);

                at = "resetting the stores";
                await h.ev(`localStorage.setItem(${JSON.stringify(GRID_KEY)}, ${JSON.stringify(JSON.stringify(GRID_EMPTY))})`);
                await h.ev(`localStorage.removeItem("agent.chatmode")`);
                // read once, when the page loads: no account is snoozed
                await h.ev(`localStorage.removeItem(${JSON.stringify(SNOOZE_KEY)})`);
                if (!(await ahReload(h))) throw new Error("the page did not come back after the reload");
                await h.goto("agent");

                at = "making the tab";
                ctx.tab = await makeTab(h, ctx, { label: "limit strip" });

                at = "installing the fakes and the RPC mock";
                // a chip under the strip, so its place above the chips is seen; the identity and the windows start as two
                // accounts with this agent's at 84% of the week
                await h.ev(`(() => { window.__chatSuggestFake = () => ["go on"]; window.__chatLimitFake = ${JSON.stringify(fakeOf(TWO, [84, 10], [30, 5]))}; return true; })()`);
                await installMock(h, ctx.tab.blockId);

                at = "setting the roster";
                await AC.setRoster(
                    h,
                    roster([{ id: ctx.tab.tabId, name: "limit strip", blockId: ctx.tab.blockId, transcriptPath: ctx.transcript }])
                );
            } catch (e) {
                ctx.arrangeError = `${at}: ${String(e?.message ?? e)}`;
            }
            return ctx;
        },

        async assert(h, ctx) {
            const steps = [];
            const { rec, run } = stepRunner(steps);
            if (ctx.arrangeError != null) {
                rec("0. the fixture agent, its transcript, the fakes and the RPC mock", false, ctx.arrangeError);
                return steps;
            }
            const A = ctx.tab.tabId;
            await h.cdp("Emulation.setFocusEmulationEnabled", { enabled: true });
            await AC.focusAgent(h, A);

            // the strip as drawn, with where it, the chip and the box sit; null when no strip is in the pane
            const read = () =>
                h.ev(`(() => {
                    const flat = ${FLAT};
                    const rect = ${RECT};
                    const layer = ${layerOf(A)};
                    const strip = layer?.querySelector("[data-chat-limit-strip]");
                    if (!strip) return null;
                    const account = strip.querySelector("[data-chat-limit-account]");
                    const sw = strip.querySelector("[data-chat-limit-switch]");
                    return {
                        window: strip.getAttribute("data-chat-limit-window"),
                        text: flat(strip.querySelector("[data-chat-limit-text]")),
                        account: account ? flat(account) : null,
                        switchText: sw ? flat(sw) : null,
                        snooze: !!strip.querySelector("[data-chat-limit-snooze]"),
                        strip: rect(strip),
                        chip: rect(layer.querySelector("[data-chat-suggest-chip]")),
                        box: rect(layer.querySelector("[data-chat-box]")),
                    };
                })()`);
            const stripGone = () => polishWaitFor(h, `!${layerOf(A)}?.querySelector("[data-chat-limit-strip]")`, WAIT_MS);
            // reseeds the fake (the strip polls it every 400 ms in DEV) and waits for a strip of `win` to be drawn
            async function seed(fake, win) {
                await h.ev(`(() => { window.__chatLimitFake = ${JSON.stringify(fake)}; return true; })()`);
                await polishNap(700);
                return polishWaitFor(h, `${layerOf(A)}?.querySelector("[data-chat-limit-strip]")?.getAttribute("data-chat-limit-window") === ${JSON.stringify(win)}`, WAIT_MS);
            }
            const WEEK_RESET = "resets (Sun|Mon|Tue|Wed|Thu|Fri|Sat), (Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec) \\d{1,2}, \\d{1,2}:\\d{2} (AM|PM)";
            const FIVE_RESET = "resets \\d{1,2}:\\d{2} (AM|PM)";

            // wait for the finished turn's chip, so every step below has the row the strip stands above
            await polishWaitFor(h, `!!${layerOf(A)}?.querySelector("[data-chat-suggest-chip]")`, WAIT_MS);

            // 1. the weekly window at 84%, two accounts: the week's line, the account, a switch to the one with room
            await run("1. weekly 84% with two accounts", async (name) => {
                const up = await seed(fakeOf(TWO, [84, 10], [30, 5]), "week");
                await polishNap(400);
                const got = await read();
                await shot(h, "limit-1-week-two-accounts");
                rec(
                    `${name}: [data-chat-limit-strip] has data-chat-limit-window="week", reads "Approaching weekly usage limit · 84% · resets <time>", names ${LOGIN} in [data-chat-limit-account], offers "Switch to ${WORK.label}", and stands above the chip and the box`,
                    up &&
                        got != null &&
                        new RegExp(`^Approaching weekly usage limit · 84% · ${WEEK_RESET}$`).test(got.text) &&
                        got.account === LOGIN &&
                        got.switchText === `Switch to ${WORK.label}` &&
                        got.snooze &&
                        got.chip != null &&
                        got.strip.bottom <= got.chip.top &&
                        got.chip.bottom <= got.box.top,
                    { up, got }
                );
            });

            // 2. both windows past: the week is named, the 5-hour one is in the same line
            await run("2. weekly 84% and 5-hour 92%", async (name) => {
                const up = await seed(fakeOf(TWO, [84, 92], [30, 5]), "week");
                const got = await read();
                rec(
                    `${name}: still data-chat-limit-window="week", and the line ends with "· 5-hour 92%"`,
                    up && got != null && new RegExp(`^Approaching weekly usage limit · 84% · ${WEEK_RESET} · 5-hour 92%$`).test(got.text),
                    { up, got }
                );
            });

            // 3. only the 5-hour window past: its own wording and its reset time
            await run("3. 5-hour 92% only", async (name) => {
                const up = await seed(fakeOf(TWO, [40, 92], [30, 5]), "fivehour");
                const got = await read();
                rec(
                    `${name}: data-chat-limit-window="fivehour", reads "Approaching 5-hour usage limit · 92% · resets <clock time>", and still offers "Switch to ${WORK.label}"`,
                    up &&
                        got != null &&
                        new RegExp(`^Approaching 5-hour usage limit · 92% · ${FIVE_RESET}$`).test(got.text) &&
                        got.switchText === `Switch to ${WORK.label}`,
                    { up, got }
                );
            });

            // 4. one account: the warning with no account named and nothing to switch to
            await run("4. one account", async (name) => {
                const up = await seed(
                    { identity: ONE, saved: { [keyOf(LOGIN)]: snap(84, 10) }, active: "" },
                    "week"
                );
                await polishNap(400);
                const got = await read();
                await shot(h, "limit-4-one-account");
                rec(
                    `${name}: the strip shows the week's line with no [data-chat-limit-account] and no [data-chat-limit-switch], and keeps its Snooze`,
                    up && got != null && /^Approaching weekly usage limit · 84% · /.test(got.text) && got.account === null && got.switchText === null && got.snooze,
                    { up, got }
                );
            });

            // 5. a project pinned to its own account: the account is named, no switch
            await run("5. a pinned project", async (name) => {
                const up = await seed(fakeOf(TWO, [84, 10], [30, 5], { pinned: true }), "week");
                const got = await read();
                rec(
                    `${name}: two accounts with the project pinned: the strip names ${LOGIN} and has no [data-chat-limit-switch]`,
                    up && got != null && got.account === LOGIN && got.switchText === null,
                    { up, got }
                );
            });

            // 6. Switch: the app moves to the other account and this agent is restarted on it (nothing reaches wavesrv)
            await run("6. Switch moves the account and this agent", async (name) => {
                const up = await seed(fakeOf(TWO, [84, 10], [30, 5]), "week");
                await clearMockCalls(h);
                const clicked = await click(h, `${layerOf(A)}?.querySelector("[data-chat-limit-switch]")`);
                const settled = await until(async () => (await mockCalls(h, "controllerresync")).length > 0, WAIT_MS);
                const setconfig = await mockCalls(h, "setconfig");
                const setmeta = await mockCalls(h, "setmeta");
                const destroyed = await mockCalls(h, "controllerdestroy");
                const resynced = await mockCalls(h, "controllerresync");
                // this agent is left out of the restart dialog, and no other agent is on the roster: none should open
                const dialog = await h.ev(`!!document.querySelector("[data-claude-restart-dialog]")`);
                if (dialog) await press(h, "Escape");
                rec(
                    `${name}: Switch writes claude:activeaccount = ${WORK.id}, sets agent:claudeaccount = ${WORK.id} on this agent's block, then destroys and resyncs that block; the restart dialog does not open`,
                    up &&
                        clicked &&
                        settled &&
                        setconfig.length === 1 &&
                        setconfig[0].data["claude:activeaccount"] === WORK.id &&
                        setmeta.length === 1 &&
                        setmeta[0].data.oref === `block:${ctx.tab.blockId}` &&
                        setmeta[0].data.meta["agent:claudeaccount"] === WORK.id &&
                        destroyed.length === 1 &&
                        resynced.length === 1 &&
                        resynced[0].data.tabid === A &&
                        resynced[0].data.forcerestart === true &&
                        !dialog,
                    { up, clicked, settled, setconfig, setmeta, destroyed, resynced, dialog }
                );
            });

            // 7. Snooze for an hour hides the strip in the pane, and the choice is kept
            await run("7. Snooze for 1 hour", async (name) => {
                const up = await seed(fakeOf(TWO, [84, 10], [30, 5]), "week");
                const opened = await click(h, `${layerOf(A)}?.querySelector("[data-chat-limit-snooze]")`);
                const choice = await polishWaitFor(h, `!!${layerOf(A)}?.querySelector('[data-chat-limit-snooze-choice="1h"]')`, SHORT_MS);
                const before = Date.now();
                const picked = await click(h, `${layerOf(A)}?.querySelector('[data-chat-limit-snooze-choice="1h"]')`);
                const hidden = await stripGone();
                // the window does not bring it back: the fake is read again and the strip stays away
                await polishNap(1200);
                const still = await h.ev(`!!${layerOf(A)}?.querySelector("[data-chat-limit-strip]")`);
                const kept = JSON.parse((await h.ev(`localStorage.getItem(${JSON.stringify(SNOOZE_KEY)})`)) ?? "{}");
                const until1h = kept[keyOf(LOGIN)]?.until;
                await shot(h, "limit-7-snoozed");
                rec(
                    `${name}: Snooze opens three choices, "1 hour" hides [data-chat-limit-strip] and it stays hidden, and arc.chatLimitSnooze holds an entry for ${keyOf(LOGIN)} an hour out`,
                    up &&
                        opened &&
                        choice &&
                        picked &&
                        hidden &&
                        !still &&
                        typeof until1h === "number" &&
                        until1h >= before + 3_600_000 - 5_000 &&
                        until1h <= Date.now() + 3_600_000 + 5_000,
                    { up, opened, choice, picked, hidden, still, kept }
                );
            });

            return steps;
        },

        async teardown(h, ctx) {
            const step = async (what, fn) => {
                try {
                    await fn();
                } catch (e) {
                    console.error(`chat-limit-strip teardown: ${what} failed: ${e?.message ?? e}`);
                }
            };
            await step("close an open restart dialog", async () => {
                if (await h.ev(`!!document.querySelector("[data-claude-restart-dialog]")`)) await press(h, "Escape");
            });
            await step("remove the fakes", () => h.ev(`(() => { delete window.__chatSuggestFake; delete window.__chatLimitFake; return true; })()`));
            await step("remove the RPC mock", () => removeMock(h));
            await step("restore the roster", () => AC.restoreRoster(h));
            await step("close the fixture tab", () => closeTabs(h, ctx));
            // the snooze is cleared with the other keys put back: the page reads it once, when it loads
            await step("restore the keys", () =>
                h.ev(`(() => {
                    for (const [k, v] of Object.entries(${JSON.stringify(ctx.prev ?? {})})) {
                        if (v == null) localStorage.removeItem(k);
                        else localStorage.setItem(k, v);
                    }
                    localStorage.removeItem(${JSON.stringify(SNOOZE_KEY)});
                    if (${JSON.stringify(ctx.prev?.[SNOOZE_KEY] ?? null)} != null) localStorage.setItem(${JSON.stringify(SNOOZE_KEY)}, ${JSON.stringify(ctx.prev?.[SNOOZE_KEY] ?? "")});
                    return true;
                })()`)
            );
            await step("reload onto the live roster", () => ahReload(h));
            if (ctx.dir) await step(`remove ${ctx.dir}`, () => rmSync(ctx.dir, { recursive: true, force: true, maxRetries: 20, retryDelay: 500 }));
            await step("go home", () => h.goto("cockpit"));
        },
    };

    return [limitScenario];
}
