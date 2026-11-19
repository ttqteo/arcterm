// Chat's summary line after long turns and the usage-limit strip above the composer
// (docs/superpowers/specs/2026-11-18-chat-suggest-card-design.md, plan 2026-11-18-chat-suggest-card.md Task 5), two scenarios:
//
//   chat-summary-line: a finished turn whose closing reply is over 1,200 characters asks the model call for a summary too
//   (`summary: true` in what window.__chatSuggestFake is asked), and the line it answers with draws as [data-chat-summary]
//   in the conversation, under the last reply (not in the dock over the box), with or without a chip; a chip sent takes
//   it away with the row; a short turn asks for none and draws none.
//
//   chat-limit-strip: [data-chat-limit-strip] above the chips and the box, for the weekly window at 80%
//   or more (data-chat-limit-window="week", the 5-hour reading in the same line when it is past too) or the 5-hour at 90%
//   or more ("fivehour"); with a second account it names the one the agent runs on ([data-chat-limit-account]) and offers
//   [data-chat-limit-switch] to the one with the most room; the Switch writes claude:activeaccount and this agent's
//   agent:claudeaccount and restarts the agent; Snooze hides the strip. The identity, the saved windows and the active
//   account come from the DEV-only window.__chatLimitFake (a dev store holds no second account).
//
// One to three fixture Claude agents over real tabs and the page's dev mock roster, as scenarios-chat-initiative-band.mjs
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
const boxOf = (id) => `${layerOf(id)}?.querySelector("[data-agent-chat-composer] [data-chat-input]")`;
const FLAT = `((el) => (el?.textContent ?? "").replace(/\\s+/g, " ").trim())`;
const RECT = `((el) => { if (!el) return null; const b = el.getBoundingClientRect(); return { top: Math.round(b.top), bottom: Math.round(b.bottom), width: Math.round(b.width) }; })`;

// --- the summary scenario's turns -------------------------------------------------------------------------------------

// a long closing reply (over 1,200 characters) in each of the two agents that are asked for a summary, and a short one
const LONG_A = [
    "Mình đã đọc nhật ký khởi động của arcterm và đối chiếu với danh sách tiến trình lúc lỗi BOOT ERROR xảy ra.",
    "Nhật ký ghi hai lần khởi động cách nhau chưa đầy một giây: lần đầu mở cửa sổ chính và đặt biểu tượng xuống khay hệ thống, lần sau chạy khi tiến trình đầu vẫn còn giữ khóa của kho dữ liệu. Lần sau không lấy được khóa nên dừng với đúng dòng lỗi bạn thấy.",
    "Danh sách tiến trình cũng khớp: lúc đó có hai wave-tauri.exe và hai wavesrv đang chạy, mỗi cặp một thư mục dữ liệu khác nhau.",
    "Vì sao có cái thứ hai: lối tắt ở thanh tác vụ và mục khởi động cùng Windows đều mở arcterm, và cửa sổ đầu đã được thu xuống khay nên không có gì báo rằng nó vẫn đang chạy. Bản cài từ trước khi có khay không gặp chuyện này vì khi đóng cửa sổ nó thoát hẳn.",
    "Những gì mình đã làm: đọc waveapp.log và waveapp.1.log, liệt kê tiến trình, đối chiếu mốc thời gian. Những gì mình chưa làm: chưa sửa code, chưa dừng tiến trình nào, chưa đổi cách mở của lối tắt.",
    "Hướng sửa gọn nhất là để lần mở thứ hai tìm cửa sổ đang ở khay và đưa nó lên, thay vì khởi động một kho dữ liệu nữa. Việc đó nằm ở phần mở ứng dụng của máy chủ Tauri, không đụng tới wavesrv.",
    "Một hướng khác là cho lần mở thứ hai đợi tối đa vài giây rồi báo rõ rằng arcterm đang chạy dưới khay, nhưng cách đó vẫn để người dùng nhìn thấy một lỗi không cần thiết, nên mình nghiêng về hướng đầu hơn.",
].join("\n\n");
const LONG_B = [
    "Đã chạy xong bộ kiểm tra của phần Chat và đọc từng lỗi trong kết quả.",
    "Ba bài kiểm tra về dòng tóm tắt đều qua; hai bài về thanh cảnh báo giới hạn dùng vẫn đỏ vì chúng đọc giờ hiện tại thay vì giờ giả, nên kết quả đổi theo múi giờ của máy chạy. Mình đã ghi lại tên hai bài và dòng nào trong tệp thử gây ra chuyện đó.",
    "Phần còn lại của bộ kiểm tra không đổi so với lần chạy trước: không có bài nào mới hỏng, không có bài nào tự khỏi.",
    "Mình chưa sửa hai bài đỏ. Cách sửa gọn là truyền giờ vào hàm tính thay vì để nó gọi Date.now() bên trong, việc này chỉ chạm tệp thử và một dòng ở hàm chọn giờ nhắc lại.",
    "Chạy lại cả bộ sau khi sửa mất khoảng hai phút trên máy này, nên mình để bạn quyết định có chạy ngay không. Nếu chạy, kết quả mong đợi là toàn bộ bài qua và không có cảnh báo mới nào.",
    "Ghi chú thêm cho lần sau: hai bài đỏ đều nằm trong tệp kiểm tra của thanh cảnh báo, không bài nào nằm trong phần dòng tóm tắt. Bài thứ nhất kiểm tra dòng chữ có giờ đặt lại của cửa sổ tuần, bài thứ hai kiểm tra giờ của cửa sổ năm giờ; cả hai so với một chuỗi giờ viết sẵn theo múi giờ của người viết bài.",
    "Vì chúng chỉ sai khi múi giờ của máy khác múi giờ đó, trên máy của bạn chúng vẫn qua, và trên máy chạy kiểm tra tự động thì đỏ. Sửa bằng cách dựng chuỗi giờ từ cùng hàm định dạng mà thanh cảnh báo dùng sẽ làm hai bài này không còn phụ thuộc vào máy chạy chúng.",
].join("\n\n");
const SHORT = "Xong: retry giờ thử lại 3 lần, cách nhau 2 giây.";

// the fake model call's answers: a chip and a summary; no chip and a summary; the chips alone, as an array
const CHIP_A = "sửa theo hướng đó đi";
const SUMMARY_A =
    "Lỗi BOOT ERROR là do một arcterm thứ hai được mở khi cái đầu vẫn đang chạy dưới khay hệ thống. Mình chưa sửa code và chưa dừng tiến trình nào.";
const SUMMARY_B = "Bộ kiểm tra chạy xong: hai bài về giờ còn đỏ, mình chưa sửa chúng.";
const CHIP_C = "tiếp đi";

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
    // what was typed into the block as the person's text (stringToBase64 encodes it as UTF-8); the bracketed-paste markers go
    const typedInputs = async (h) =>
        ((await mockCalls(h, "controllerinput")) ?? [])
            .map((c) => Buffer.from(c.data.inputdata64 ?? "", "base64").toString("utf8"))
            .filter((i) => i !== "" && i !== "\r" && !/^\x1b\[[IO]$/.test(i))
            .map((i) => i.replace(/^\x1b\[200~/, "").replace(/\x1b\[201~$/, "").replace(/\r/g, "\n"));

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

    // --- chat-summary-line ------------------------------------------------------------------------------------------

    const summaryScenario = {
        name: "chat-summary-line",
        surface: "agent",
        async arrange(h) {
            const ctx = { dir: mkdtempSync(join(tmpdir(), "verify-chat-summary-")), prev: {}, tabs: {} };
            let at = "reading the keys";
            try {
                for (const k of [GRID_KEY, "agent.chatmode"]) ctx.prev[k] = await h.ev(`localStorage.getItem(${JSON.stringify(k)})`);

                at = "writing the transcripts";
                if (LONG_A.length <= 1200 || LONG_B.length <= 1200 || SHORT.length > 1200) throw new Error(`a fixture reply is on the wrong side of 1,200 characters (long ${LONG_A.length}, none ${LONG_B.length}, short ${SHORT.length})`);
                const o = (sec) => ({ cwd: ctx.dir, ts: new Date(Date.now() - 600_000 + sec * 1000).toISOString() });
                ctx.files = {
                    long: AC.writeTranscript(ctx.dir, "chat-summary-long", [
                        AC.userText("vì sao arcterm báo BOOT ERROR khi mình mở nó lần nữa?", o(0)),
                        AC.assistantText(LONG_A, o(2)),
                    ]),
                    none: AC.writeTranscript(ctx.dir, "chat-summary-none", [
                        AC.userText("chạy bộ kiểm tra của phần Chat đi", o(0)),
                        AC.assistantText(LONG_B, o(2)),
                    ]),
                    short: AC.writeTranscript(ctx.dir, "chat-summary-short", [
                        AC.userText("thêm retry vào sync client", o(0)),
                        AC.assistantText(SHORT, o(2)),
                    ]),
                };

                at = "resetting the stores";
                await h.ev(`localStorage.setItem(${JSON.stringify(GRID_KEY)}, ${JSON.stringify(JSON.stringify(GRID_EMPTY))})`);
                await h.ev(`localStorage.removeItem("agent.chatmode")`);
                if (!(await ahReload(h))) throw new Error("the page did not come back after the reload");
                await h.goto("agent");

                at = "making the tabs";
                ctx.tabs.long = await makeTab(h, ctx, { label: "summary long" });
                ctx.tabs.none = await makeTab(h, ctx, { label: "summary none" });
                ctx.tabs.short = await makeTab(h, ctx, { label: "summary short" });

                at = "installing the model fake and the input mock";
                // the replies are told apart by their first words; what each call was asked is kept for the steps
                const answers = [
                    { start: LONG_A.slice(0, 30), rtn: { replies: [CHIP_A], summary: SUMMARY_A } },
                    { start: LONG_B.slice(0, 30), rtn: { replies: [], summary: SUMMARY_B } },
                    { start: SHORT.slice(0, 30), rtn: [CHIP_C] },
                ];
                await h.ev(`(() => {
                    window.__suggestCardAsked = [];
                    const answers = ${JSON.stringify(answers)};
                    window.__chatSuggestFake = (d) => {
                        window.__suggestCardAsked.push(d);
                        return answers.find((a) => d.reply.startsWith(a.start))?.rtn ?? [];
                    };
                    return true;
                })()`);
                await installMock(h, ctx.tabs.long.blockId);

                at = "setting the roster";
                await AC.setRoster(
                    h,
                    roster([
                        { id: ctx.tabs.long.tabId, name: "summary long", blockId: ctx.tabs.long.blockId, transcriptPath: ctx.files.long },
                        { id: ctx.tabs.none.tabId, name: "summary none", blockId: ctx.tabs.none.blockId, transcriptPath: ctx.files.none },
                        { id: ctx.tabs.short.tabId, name: "summary short", blockId: ctx.tabs.short.blockId, transcriptPath: ctx.files.short },
                    ])
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
                rec("0. the fixture agents, their transcripts, the model fake and the input mock", false, ctx.arrangeError);
                return steps;
            }
            const L = ctx.tabs.long.tabId;
            const N = ctx.tabs.none.tabId;
            const S = ctx.tabs.short.tabId;
            await h.cdp("Emulation.setFocusEmulationEnabled", { enabled: true });

            // the summary line and the chips of one agent's Chat, as drawn, with where each sits: the line's own text (less its
            // "Summary" label), whether it is the conversation's (under its last item) and not the dock's, and each chip's
            // label (less the key it shows)
            const read = (id) =>
                h.ev(`(() => {
                    const flat = ${FLAT};
                    const rect = ${RECT};
                    const layer = ${layerOf(id)};
                    const line = layer?.querySelector("[data-chat-summary]");
                    const chips = [...(layer?.querySelectorAll("[data-chat-suggest-chip]") ?? [])];
                    const items = [...(layer?.querySelectorAll("[data-chat-conversation] [data-chat-item]") ?? [])];
                    return {
                        has: !!line,
                        text: flat(line?.querySelector("span:last-child") ?? null),
                        label: flat(line?.querySelector("span:first-child") ?? null),
                        inConversation: !!line?.closest("[data-chat-conversation]"),
                        inDock: !!line?.closest("[data-agent-chat-composer]"),
                        lastItem: rect(items.at(-1)),
                        chips: chips.map((b) => flat(b.querySelector("span.truncate") ?? b)),
                        line: rect(line),
                        chip: rect(chips[0]),
                        box: rect(layer?.querySelector("[data-chat-box]")),
                        width: Math.round(layer?.getBoundingClientRect().width ?? 0),
                    };
                })()`);
            const asked = (start) =>
                h.ev(`(window.__suggestCardAsked ?? []).filter((d) => d.reply.startsWith(${JSON.stringify(start.slice(0, 30))})).map((d) => ({ summary: d.summary, question: d.question, len: d.reply.length }))`);

            // 1. a long turn with a chip: the call asked for a summary, and its line stands under the last reply, in the
            // conversation, above the chip and the box
            await run("1. a long turn's summary under its reply", async (name) => {
                await AC.focusAgent(h, L);
                const up = await polishWaitFor(h, `!!${layerOf(L)}?.querySelector("[data-chat-summary]") && !!${layerOf(L)}?.querySelector("[data-chat-suggest-chip]")`, WAIT_MS);
                await polishNap(500);
                const got = await read(L);
                const asks = await asked(LONG_A);
                await shot(h, "summary-1-with-chip");
                rec(
                    `${name}: the call was asked with summary:true, [data-chat-summary] reads Summary and the model's line, in [data-chat-conversation] under its last item and not in the dock, above the [data-chat-suggest-chip] "${CHIP_A}", which sits above the box`,
                    up &&
                        asks.length === 1 &&
                        asks[0].summary === true &&
                        got.text === SUMMARY_A &&
                        got.label === "Summary" &&
                        got.inConversation &&
                        !got.inDock &&
                        got.lastItem != null &&
                        got.lastItem.bottom <= got.line.top &&
                        got.chips.length === 1 &&
                        got.chips[0] === CHIP_A &&
                        got.line.bottom <= got.chip.top &&
                        got.chip.bottom <= got.box.top,
                    { up, asks, got }
                );
            });

            // 2. a long turn the model found no chip for: the line shows alone, above the box
            await run("2. a long turn's summary with no chip", async (name) => {
                await AC.focusAgent(h, N);
                const up = await polishWaitFor(h, `!!${layerOf(N)}?.querySelector("[data-chat-summary]")`, WAIT_MS);
                await polishNap(600);
                const got = await read(N);
                const asks = await asked(LONG_B);
                await shot(h, "summary-2-no-chip");
                rec(
                    `${name}: the call was asked with summary:true, [data-chat-summary] reads the line and no [data-chat-suggest-chip] stands under it, above the box`,
                    up && asks.length === 1 && asks[0].summary === true && got.text === SUMMARY_B && got.inConversation && !got.inDock && got.chips.length === 0 && got.line.bottom <= got.box.top,
                    { up, asks, got }
                );
            });

            // 3. a chip sent: the line goes with the row
            await run("3. sending the chip takes the line away", async (name) => {
                await AC.focusAgent(h, L);
                const back = await polishWaitFor(h, `!!${layerOf(L)}?.querySelector("[data-chat-summary]") && !!${layerOf(L)}?.querySelector("[data-chat-suggest-chip]")`, WAIT_MS);
                await h.ev(`(${boxOf(L)})?.focus()`);
                await press(h, "Tab");
                const picked = await polishWaitFor(h, `!!${layerOf(L)}?.querySelector("[data-chat-suggest-picked]")`, SHORT_MS);
                await press(h, "Enter", 500);
                const gone = await polishWaitFor(h, `!${layerOf(L)}?.querySelector("[data-chat-summary]")`, WAIT_MS);
                const typedChip = await until(async () => (await typedInputs(h)).some((t) => t.includes(CHIP_A)));
                const after = await read(L);
                await shot(h, "summary-3-sent");
                rec(
                    `${name}: Tab picks the chip, Enter sends its text to the agent, and [data-chat-summary] and the chips are gone`,
                    back && picked && typedChip && gone && !after.has && after.chips.length === 0,
                    { back, picked, typedChip, gone, after, typed: await typedInputs(h) }
                );
            });

            // 4. a short turn: no summary asked, none drawn, the chips as before
            await run("4. a short turn has no summary", async (name) => {
                await AC.focusAgent(h, S);
                const chips = await polishWaitFor(h, `!!${layerOf(S)}?.querySelector("[data-chat-suggest-chip]")`, WAIT_MS);
                await polishNap(600);
                const got = await read(S);
                const asks = await asked(SHORT);
                await shot(h, "summary-4-short");
                rec(
                    `${name}: the call was asked with no summary (the fake answers with an array), the chip "${CHIP_C}" shows and no [data-chat-summary] is drawn`,
                    chips && asks.length === 1 && !asks[0].summary && got.chips.length === 1 && got.chips[0] === CHIP_C && !got.has,
                    { chips, asks, got }
                );
            });

            return steps;
        },

        async teardown(h, ctx) {
            const step = async (what, fn) => {
                try {
                    await fn();
                } catch (e) {
                    console.error(`chat-summary-line teardown: ${what} failed: ${e?.message ?? e}`);
                }
            };
            await step("remove the fake", () => h.ev(`(() => { delete window.__chatSuggestFake; delete window.__suggestCardAsked; return true; })()`));
            await step("remove the input mock", () => removeMock(h));
            await step("restore the roster", () => AC.restoreRoster(h));
            await step("close the fixture tabs", () => closeTabs(h, ctx));
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
            if (ctx.dir) await step(`remove ${ctx.dir}`, () => rmSync(ctx.dir, { recursive: true, force: true, maxRetries: 20, retryDelay: 500 }));
            await step("go home", () => h.goto("cockpit"));
        },
    };

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

    return [summaryScenario, limitScenario];
}
