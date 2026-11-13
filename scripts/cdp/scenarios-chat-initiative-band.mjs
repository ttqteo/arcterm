// The initiative band in Chat (docs/superpowers/specs/2026-11-14-chat-initiative-link-design.md, plan
// 2026-11-14-chat-initiative-link.md Task 6): one band under a linked agent's Chat header in place of the header's ◇ chip
// and its popover, which opens in place (pushing the conversation, never covering it), moves the agent to another chunk
// (Work on this), and queues the line that tells the agent (the waiting line), plus the chunk chips the box offers
// (done: and go on with:). It is written against the plan's DOM contract (decision 14), not against the components:
//   [data-initiative-band="<agentId>"][data-band-open][data-band-narrow], [data-band-line], [data-band-title],
//   [data-band-progress], [data-band-segments], [data-band-on], [data-band-pick], [data-band-mark-done],
//   [data-band-toggle], [data-band-row="done|mine|next|other|plan"][data-chunk-label], [data-band-tag],
//   [data-band-work-on], [data-band-all], [data-band-all-list], [data-band-note], [data-band-add-note],
//   [data-band-open-jarvis], [data-band-error], [data-chat-switch-line], [data-chat-switch-drop], and the lean header's
//   [data-initiative-link] chip.
//
// Two fixture Claude agents over real tabs and a fixture roster (the page's dev mock roster), as scenarios-chat-redesign.mjs
// makes one: a fixture transcript long enough to scroll for the main agent, and a second agent that holds a chunk of
// its own so a row can carry another agent's name. What the page types into the main agent's block is recorded by a
// small RPC mock (the block has no controller, so a send would otherwise have nowhere to go), which is how the switched
// line is seen in front of the person's text. The initiatives are real ones made over RPC (effortcreate / effortmutate)
// and deleted in teardown; every step that reads a plan makes its own, so a step that fails leaves the next one a clean
// start. No real agent is launched. Keys and clicks are real CDP input events: the band's keys need focus, and a
// script's .click() does not take it.

import { appendFileSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import * as AC from "./agent-page-fixtures.mjs";

const NAME_A = "band main";
const NAME_B = "band other";
const PROJECT = "verify-chat-band";
const WAIT_MS = 15000;
const SHORT_MS = 5000;
const PENDING_KEY = "chat.initiative.pending";
const BAND_KEY = "chat.initiative.band";
const MOCK_KEY = "__bandInputMock";
// the band is narrow below this width (plan decision 10), and the step narrows the window until the band is about this
const NARROW_PX = 640;
const NARROW_WANT = 540;
const NARROW_PASSES = 6;
const NARROW_TOLERANCE = 24;

// the initiative of steps 2-4: seven chunks around the agent, one of them held by the second agent
const TITLE = "Band: the Chat initiative band";
const C = {
    spec: "Spec the band",
    draw: "Draw the band",
    keys: "Wire the band keys",
    docs: "Write the band docs",
    other: "Tune the band for others",
    free1: "Free chunk one",
    free2: "Free chunk two",
};
const NOTE = "Drew the rows, the keys are next.";
const MESSAGE = "carry on with the keys";

// --- page expressions -----------------------------------------------------------------------------------------------

const layerOf = (id) => `document.querySelector('[data-agent-chat="${id}"]')`;
const bandOf = (id) => `document.querySelector('[data-initiative-band="${id}"]')`;
const inputOf = (id) => `${layerOf(id)}?.querySelector("[data-chat-input]")`;
// the conversation's scroller: the band holds a scrolling list of its own (All chunks), so it is not the first match
const scrollerOf = (id) =>
    `((layer) => [...(layer?.querySelectorAll(".overflow-y-auto") ?? [])].find((el) => !el.closest("[data-initiative-band]")))(${layerOf(id)})`;
const FLAT = `((el) => (el?.textContent ?? "").replace(/\\s+/g, " ").trim())`;
const pendingBubbles = (id) =>
    `[...(${layerOf(id)}?.querySelectorAll("[data-chat-pending]") ?? [])].map((p) => p.firstElementChild?.textContent.trim())`;
const youBubbles = (id) => `[...(${layerOf(id)}?.querySelectorAll("[data-chat-you]") ?? [])].map(${FLAT})`;

const VK = { Enter: 13, Escape: 27, ArrowUp: 38, ArrowDown: 40 };

export default function (kit) {
    const { waveService, polishWaitFor, polishNap, ahReload, GRID_KEY, GRID_EMPTY } = kit;
    const { makeTab, closeTabs } = AC.tabFixtures({ waveService });
    const LS_KEYS = [GRID_KEY, "agent.chatmode", BAND_KEY, PENDING_KEY];

    const ts = (ctx, offsetMs = 0) => ({ cwd: ctx.dir, ts: new Date(Date.now() + offsetMs).toISOString() });
    const append = (ctx, ...lines) => appendFileSync(ctx.transcriptA, lines.join("\n") + "\n");

    // --- input -----------------------------------------------------------------------------------------------------

    // A key as a person types it. A letter goes as keyDown with its text; the rest as rawKeyDown.
    async function press(h, key, nap = 300) {
        const vk = VK[key];
        if (vk == null) {
            const code = `Key${key.toUpperCase()}`;
            const windowsVirtualKeyCode = key.toUpperCase().charCodeAt(0);
            await h.cdp("Input.dispatchKeyEvent", { type: "keyDown", key, code, text: key, windowsVirtualKeyCode });
            await h.cdp("Input.dispatchKeyEvent", { type: "keyUp", key, code, windowsVirtualKeyCode });
        } else {
            await h.cdp("Input.dispatchKeyEvent", { type: "rawKeyDown", key, code: key, windowsVirtualKeyCode: vk });
            if (key === "Enter") {
                await h.cdp("Input.dispatchKeyEvent", { type: "char", key, code: key, text: "\r", windowsVirtualKeyCode: vk });
            }
            await h.cdp("Input.dispatchKeyEvent", { type: "keyUp", key, code: key, windowsVirtualKeyCode: vk });
        }
        await polishNap(nap);
    }

    // A mouse click at the middle of the element `expr` evaluates to; false when none is drawn. A band or a chip that is
    // still springing into place is clicked where it settles, not where it was.
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

    // the keys the surface answers to need focus off the message box, which a click on the header's blank does for a person
    const focusSurface = (h) => h.ev(`document.querySelector("[data-cockpit-surface-wrap]")?.focus()`);
    // a click into the band (a row's click opens its menu, a plain press on the root does nothing) or a Tab to it: the root
    // takes the focus
    const focusBand = (h, id) => h.ev(`(() => { const b = ${bandOf(id)}; b?.focus({ preventScroll: true }); return !!b && b.contains(document.activeElement); })()`);

    async function typeInBox(h, id, text) {
        await h.ev(`(${inputOf(id)})?.focus()`);
        await h.cdp("Input.insertText", { text });
    }
    // Enter in the message box, as the redesign's scenario sends one: a key down and up, with no character
    async function enterInBox(h) {
        for (const type of ["keyDown", "keyUp"]) {
            await h.cdp("Input.dispatchKeyEvent", { type, key: "Enter", code: "Enter", windowsVirtualKeyCode: 13 });
        }
        await polishNap(400);
    }

    async function shot(h, name) {
        try {
            await h.shot(`cdp-shots/chat-initiative-band-${name}.png`);
        } catch (e) {
            console.error(`chat-initiative-band: the shot ${name} failed: ${e?.message ?? e}`);
        }
    }

    // polls a Node-side check (an RPC read) until it holds
    async function until(check, ms = SHORT_MS) {
        for (let waited = 0; waited < ms; waited += 250) {
            if (await check()) return true;
            await polishNap(250);
        }
        return false;
    }

    // --- the store -------------------------------------------------------------------------------------------------

    const mutate = (h, oid, ops) => h.rpc("effortmutate", { effortoid: oid, author: "you", ops });
    const getEffort = async (h, oid) => (await h.rpc("effortget", { effortoid: oid }))?.effort;
    // label -> its status and the orefs holding it
    const chunkState = async (h, oid) =>
        Object.fromEntries(((await getEffort(h, oid))?.chunks ?? []).map((c) => [c.label, { status: c.status, holders: (c.workrefs ?? []).map((w) => w.oref) }]));

    // The page reads an initiative when its agent's state changes, and nothing pushes a write made over RPC: this reads it again.
    const refreshEffort = (h, oid) =>
        AC.agentPage(
            h,
            `const S = await mod("app/view/jarvis/effortstore.ts");
            await S.loadEffortDetail(${JSON.stringify("effort:" + oid)}, Number.MAX_SAFE_INTEGER);
            return true;`
        );

    const setBand = (h, id, open) =>
        AC.agentPage(h, `const S = await mod("app/view/agents/initiativebandstore.ts"); S.setBandPart(${JSON.stringify(id)}, ${open ? '"initiative"' : "null"}); return true;`);
    // the waiting lines of an agent, taken out (a step starts with none)
    const takePending = (h, id) =>
        AC.agentPage(h, `const S = await mod("app/view/agents/chatinitiativestore.ts"); S.takeResultLines(${JSON.stringify(id)}); return true;`);
    const pendingLines = async (h, id) => (await h.ev(`JSON.parse(localStorage.getItem(${JSON.stringify(PENDING_KEY)}) ?? "{}")[${JSON.stringify(id)}] ?? []`)) ?? [];
    const switchLines = async (h, id) => (await pendingLines(h, id)).filter((l) => l.startsWith("initiative: switched "));

    // what the page typed into the main agent's block, as the person's text: the bytes read with atob are Latin-1, the
    // bracketed-paste markers go and xterm's "\r" line ends read as "\n"
    const unbracket = (i) =>
        Buffer.from(i, "latin1").toString("utf8").replace(/^\x1b\[200~/, "").replace(/\x1b\[201~$/, "").replace(/\r/g, "\n");
    const typedInputs = async (h) =>
        ((await h.ev(`window.${MOCK_KEY}?.inputs ?? []`)) ?? []).filter((i) => i !== "" && i !== "\r" && !/^\x1b\[[IO]$/.test(i)).map(unbracket);

    // --- the band's DOM, read in one call ---------------------------------------------------------------------------

    const readBand = (h, id) =>
        h.ev(`(() => {
            const flat = ${FLAT};
            const band = ${bandOf(id)};
            if (!band) return null;
            const rowOf = (r) => ({
                kind: r.getAttribute("data-band-row"),
                label: r.dataset.chunkLabel,
                tag: flat(r.querySelector("[data-band-tag]")),
                workOn: !!r.querySelector("[data-band-work-on]"),
                struck: getComputedStyle(r.querySelector("span.truncate") ?? r).textDecorationLine.includes("line-through"),
                current: r.getAttribute("aria-current") === "true",
            });
            const rows = [...band.querySelectorAll("[data-band-row]")];
            const all = band.querySelector("[data-band-all]");
            const mark = band.querySelector("[data-band-mark-done]");
            const pick = band.querySelector("[data-band-pick]");
            const br = band.getBoundingClientRect();
            return {
                open: band.hasAttribute("data-band-open"),
                narrow: band.hasAttribute("data-band-narrow"),
                width: Math.round(br.width),
                title: flat(band.querySelector("[data-band-title]")),
                progress: flat(band.querySelector("[data-band-progress]")),
                segments: !!band.querySelector("[data-band-segments]"),
                on: flat(band.querySelector("[data-band-on]")),
                pick: pick ? flat(pick) : null,
                markDone: mark ? flat(mark) : null,
                markDoneKey: !!mark?.querySelector("kbd"),
                rows: rows.filter((r) => !r.closest("[data-band-all-list]")).map(rowOf),
                allRows: [...band.querySelectorAll("[data-band-all-list] [data-band-row]")].map(rowOf),
                allText: flat(all),
                allCurrent: all?.getAttribute("aria-current") === "true",
                allListOpen: !!band.querySelector("[data-band-all-list]"),
                note: flat(band.querySelector("[data-band-note]")),
                addNote: !!band.querySelector("[data-band-add-note]"),
                openJarvis: !!band.querySelector("[data-band-open-jarvis]"),
                error: flat(band.querySelector("[data-band-error]")),
                focused: band.contains(document.activeElement),
            };
        })()`);
    const rowLabels = (rows) => rows.map((r) => r.label).join(" | ");

    const scenario = {
        name: "chat-initiative-band",
        surface: "agent",
        async arrange(h) {
            const ctx = { dir: mkdtempSync(join(tmpdir(), "verify-chat-band-")), prev: {}, oids: [], patchA: {} };
            let at = "reading the keys";
            try {
                for (const k of LS_KEYS) ctx.prev[k] = await h.ev(`localStorage.getItem(${JSON.stringify(k)})`);

                at = "writing the transcripts";
                // 24 earlier turns, so the conversation scrolls, then the request this run answers
                const base = Date.now() - 3_600_000;
                const o = (sec) => ({ cwd: ctx.dir, ts: new Date(base + sec * 1000).toISOString() });
                const lines = [];
                for (let i = 0; i < 24; i++) {
                    lines.push(AC.userText(`question ${i}: how does part ${i} of the band work?`, o(i * 10)));
                    lines.push(
                        AC.assistantText(`Reply ${i}. The band reads the initiative the agent works on and says which chunk it is on, so a reader never has to open Jarvis to find out. `.repeat(3), o(i * 10 + 2))
                    );
                }
                lines.push(AC.userText("draw the band for the agent", o(300)));
                ctx.transcriptA = AC.writeTranscript(ctx.dir, "chat-initiative-band-main", lines);
                ctx.transcriptB = AC.writeTranscript(ctx.dir, "chat-initiative-band-other", [
                    AC.userText("tune the band for the other agents", o(0)),
                    AC.assistantText("Tuning it: the rows name who holds each chunk.", o(2)),
                ]);

                at = "resetting the stores";
                await h.ev(`localStorage.setItem(${JSON.stringify(GRID_KEY)}, ${JSON.stringify(JSON.stringify(GRID_EMPTY))})`);
                await h.ev(`localStorage.removeItem("agent.chatmode")`);
                // both are read once, when the page loads: no band is open and no line waits
                await h.ev(`localStorage.removeItem(${JSON.stringify(BAND_KEY)})`);
                await h.ev(`localStorage.removeItem(${JSON.stringify(PENDING_KEY)})`);
                if (!(await ahReload(h))) throw new Error("the page did not come back after the reload");
                // the suggested replies' model call is answered here with none: no haiku call runs
                await h.ev(`(() => { window.__chatSuggestFake = () => []; return true; })()`);
                await h.goto("agent");

                at = "making the tabs";
                ctx.tabA = await makeTab(h, ctx, { label: NAME_A });
                ctx.tabB = await makeTab(h, ctx, { label: NAME_B });

                at = "installing the input mock";
                const mock = await AC.agentPage(
                    h,
                    `const api = (await mod("app/store/wshclientapi.ts")).RpcApi;
                    if (!api || typeof api.setMockRpcClient !== "function") return "no-api";
                    if (window.${MOCK_KEY}) return "already-installed";
                    const prev = api.mockClient ?? null;
                    const m = { api, prev, inputs: [] };
                    api.setMockRpcClient({
                        mockWshRpcCall(client, command, data, opts) {
                            if (command === "controllerinput" && data?.blockid === ${JSON.stringify(ctx.tabA.blockId)}) {
                                m.inputs.push(atob(data.inputdata64 ?? ""));
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
                if (mock !== "installed") throw new Error(`input mock: ${mock}`);

                at = "setting the roster";
                await AC.setRoster(h, rosterOf(ctx));
            } catch (e) {
                ctx.arrangeError = `${at}: ${String(e?.message ?? e)}`;
            }
            return ctx;
        },

        async assert(h, ctx) {
            const steps = [];
            const rec = (step, ok, detail) => steps.push({ step, ok: ok === true, detail: typeof detail === "string" ? detail : JSON.stringify(detail) });
            if (ctx.arrangeError != null) {
                rec("0. the fixture agents, their transcripts and the input mock", false, ctx.arrangeError);
                return steps;
            }
            const A = ctx.tabA.tabId;
            const B = ctx.tabB.tabId;
            const refA = `agent:${A}`;
            const refB = `agent:${B}`;
            // a step that throws is a failed step, not the end of the run: the ones after it read what they need themselves
            const run = async (name, fn) => {
                try {
                    await fn(name);
                } catch (e) {
                    rec(name, false, `the step threw: ${String(e?.message ?? e)}`);
                }
            };
            // the main agent's roster row, with the state under test kept between calls
            const setA = (patch) => {
                ctx.patchA = { ...ctx.patchA, ...patch };
                return AC.setRoster(h, rosterOf(ctx, ctx.patchA));
            };
            // An initiative with the chunks of `specs` ({ label, status?, hold?: "A" | "B", note? }), made over RPC. The
            // done ones go first, so an agent that holds a finished chunk and then a live one is never refused.
            async function makeEffort(title, specs) {
                const made = await h.rpc("effortcreate", { title, project: PROJECT, chunks: specs.map((s) => ({ label: s.label })) });
                const oid = made.effortoid;
                ctx.oids.push(oid);
                const ordered = [...specs.filter((s) => s.status === "done"), ...specs.filter((s) => s.status !== "done")];
                for (const s of ordered) {
                    const ops = [];
                    if (s.status != null && s.status !== "pending") ops.push({ op: "setChunkStatus", chunk: s.label, status: s.status });
                    if (s.hold != null) ops.push({ op: "attachWork", chunk: s.label, kind: "agent", oref: s.hold === "A" ? refA : refB });
                    if (s.note != null) ops.push({ op: "appendNote", chunk: s.label, note: s.note });
                    if (ops.length > 0) await mutate(h, oid, ops);
                }
                return oid;
            }
            // the steps' own initiative: the agent finished the spec and is on the drawing, the other agent is on its own
            const makeMain = (title = TITLE) =>
                makeEffort(title, [
                    { label: C.spec, status: "done", hold: "A" },
                    { label: C.draw, status: "active", hold: "A", note: NOTE },
                    { label: C.keys },
                    { label: C.docs },
                    { label: C.other, status: "active", hold: "B" },
                    { label: C.free1 },
                    { label: C.free2 },
                ]);
            // links the agent to an initiative and waits for its band to draw it, collapsed, with no line waiting
            async function link(oid, title) {
                await setBand(h, A, false);
                await takePending(h, A);
                await setA({ effortId: oid });
                return polishWaitFor(h, `${bandOf(A)}?.querySelector("[data-band-title]")?.textContent === ${JSON.stringify(title)} && !${bandOf(A)}.hasAttribute("data-band-open")`, WAIT_MS);
            }
            // the cursor's row label (the band's own, while its list is open)
            const cursorLabel = (h2) =>
                h2.ev(`${bandOf(A)}?.querySelector('[data-band-row][aria-current="true"]')?.dataset.chunkLabel ?? null`);
            // moves the cursor to the row with this label (the window's, before the All chunks row): the arrows stop at the
            // ends, so it goes to the top first and then down
            async function cursorTo(label) {
                for (let i = 0; i < 10; i++) await press(h, "ArrowUp", 60);
                for (let i = 0; i < 10; i++) {
                    if ((await cursorLabel(h)) === label) return true;
                    await press(h, "ArrowDown", 150);
                }
                return (await cursorLabel(h)) === label;
            }
            const workOnBtn = (label) => `${bandOf(A)}?.querySelector('[data-band-row][data-chunk-label="${label}"] [data-band-work-on]')`;
            await h.cdp("Emulation.setFocusEmulationEnabled", { enabled: true });
            await AC.focusAgent(h, A);
            await polishWaitFor(h, `(${layerOf(A)}?.querySelectorAll("[data-chat-item]").length ?? 0) >= 6`, WAIT_MS);

            // 1. unlinked: no band, a link chip with its key, `i` opens the picker
            await run("1. unlinked header", async (name) => {
                await setA({ effortId: undefined });
                await polishWaitFor(h, `!!document.querySelector("[data-agent-header] [data-initiative-link]")`, WAIT_MS);
                const got = await h.ev(`(() => {
                    const chip = document.querySelector("[data-agent-header] [data-initiative-link]");
                    return {
                        band: !!${bandOf(A)},
                        chip: chip?.textContent.replace(/\\s+/g, " ").trim() ?? null,
                        keycap: [...(chip?.querySelectorAll("span") ?? [])].some((s) => /^i$/i.test(s.textContent.trim())),
                        menuRow: !!document.querySelector("[data-agent-header] [data-initiative-link-menu]"),
                        oldChip: !!document.querySelector("[data-agent-header] [data-initiative-link-open]"),
                    };
                })()`);
                await focusSurface(h);
                await press(h, "i");
                const picker = await polishWaitFor(h, `!!document.querySelector("[data-initiative-picker]")`, SHORT_MS);
                await polishNap(400);
                await shot(h, "1-unlinked");
                await press(h, "Escape");
                const closed = await polishWaitFor(h, `!document.querySelector("[data-initiative-picker]")`, SHORT_MS);
                rec(
                    `${name}: no [data-initiative-band]; the Chat header shows [data-initiative-link] ("+ Link to initiative") with its i keycap and no [data-initiative-link-menu] or ◇ chip; i opens the picker`,
                    got.band === false && /Link to initiative/.test(got.chip ?? "") && got.keycap && !got.menuRow && !got.oldChip && picker && closed,
                    { ...got, picker, closed }
                );
            });

            // 2. linked and collapsed: the band's line, no ◇ chip in the header
            await run("2. band collapsed", async (name) => {
                const oid = await makeMain();
                const up = await link(oid, TITLE);
                await polishNap(500);
                const got = await readBand(h, A);
                const header = await h.ev(`({ link: !!document.querySelector("[data-agent-header] [data-initiative-link-open]"), chip: !!document.querySelector("[data-agent-header] [data-initiative-link]") })`);
                await shot(h, "2-collapsed");
                rec(
                    `${name}: collapsed [data-initiative-band] reads the title, [data-band-segments], 1/7 in [data-band-progress], "On 2 ${C.draw}" in [data-band-on] and a Mark done with its m key; the Chat header has no [data-initiative-link-open] and no link chip`,
                    up &&
                        got?.open === false &&
                        got.title === TITLE &&
                        got.segments &&
                        got.progress === "1/7" &&
                        /^On\s*2\s*Draw the band$/.test(got.on) &&
                        /Mark done/.test(got.markDone ?? "") &&
                        got.markDoneKey &&
                        !header.link &&
                        !header.chip,
                    { up, got, header }
                );
            });

            // 3. expanded: the rows, All chunks, the note, pushes and never covers, Esc, `i`, survives another agent
            await run("3. band expanded", async (name) => {
                const oid = await makeMain();
                await link(oid, TITLE);
                // a click on the chevron opens it, and the band takes the focus
                const clicked = await click(h, `${bandOf(A)}?.querySelector("[data-band-toggle]")`);
                const open = await polishWaitFor(h, `${bandOf(A)}?.hasAttribute("data-band-open") === true && !!${bandOf(A)}.querySelector("[data-band-row]")`, SHORT_MS);
                await polishNap(700);
                const win = await readBand(h, A);
                const rowsOk =
                    rowLabels(win?.rows ?? []) === [C.spec, C.draw, C.keys, C.docs, C.other].join(" | ") &&
                    (win?.rows ?? []).map((r) => r.kind).join() === "done,mine,next,next,other" &&
                    (win?.rows ?? []).map((r) => r.tag).join() === ["done", "this agent", "next", "next", NAME_B].join() &&
                    win.rows[0].struck &&
                    !win.rows[1].struck &&
                    (win?.rows ?? []).filter((r) => r.workOn).map((r) => r.label).join() === [C.keys, C.docs].join();
                // All chunks opens the whole plan
                const allClicked = await click(h, `${bandOf(A)}?.querySelector("[data-band-all]")`);
                const allUp = await polishWaitFor(h, `!!${bandOf(A)}?.querySelector("[data-band-all-list]")`, SHORT_MS);
                await polishNap(400);
                const all = await readBand(h, A);
                const allOk =
                    all?.allText.includes("All chunks (7)") &&
                    (all?.allRows ?? []).map((r) => r.kind).join() === "done,mine,next,next,other,plan,plan" &&
                    rowLabels(all.allRows) === [C.spec, C.draw, C.keys, C.docs, C.other, C.free1, C.free2].join(" | ");
                const geo = await h.ev(`(() => {
                    const b = ${bandOf(A)}?.getBoundingClientRect();
                    const s = ${scrollerOf(A)}?.getBoundingClientRect();
                    return b && s ? { bandBottom: Math.round(b.bottom), scrollerTop: Math.round(s.top) } : null;
                })()`);
                await shot(h, "3-expanded");
                const pushes = geo != null && geo.bandBottom <= geo.scrollerTop + 1;
                // fold the list again, so the steps after start with it shut
                await click(h, `${bandOf(A)}?.querySelector("[data-band-all]")`);
                await polishWaitFor(h, `!${bandOf(A)}?.querySelector("[data-band-all-list]")`, SHORT_MS);
                // Esc collapses and gives the keyboard back to the message box
                await focusBand(h, A);
                await press(h, "Escape");
                const collapsed = await polishWaitFor(h, `${bandOf(A)}?.hasAttribute("data-band-open") === false`, SHORT_MS);
                await polishNap(500);
                const afterEsc = await h.ev(`(() => { const a = document.activeElement; return { box: a?.hasAttribute?.("data-chat-input") === true, band: !!${bandOf(A)}?.contains(a) }; })()`);
                // `i` opens it again (the surface has the focus, not the box)
                await focusSurface(h);
                await press(h, "i");
                const reopened = await polishWaitFor(h, `${bandOf(A)}?.hasAttribute("data-band-open") === true`, SHORT_MS);
                await polishNap(500);
                const viaKey = await readBand(h, A);
                // another agent and back: the band is still open
                await AC.focusAgent(h, B);
                await polishWaitFor(h, `!!${layerOf(B)}`, WAIT_MS);
                await polishNap(300);
                await AC.focusAgent(h, A);
                await polishWaitFor(h, `!!${bandOf(A)}`, WAIT_MS);
                const survives = await polishWaitFor(h, `${bandOf(A)}?.hasAttribute("data-band-open") === true`, SHORT_MS);
                await setBand(h, A, false);
                rec(
                    `${name}: a click on [data-band-toggle] opens the band (focus in it) on rows done (struck) · mine "this agent" · next · next · other (tagged "${NAME_B}"); All chunks (7) lists the whole plan; its bottom is at or above the conversation's top; the latest note, Add note and Open in Jarvis show; Esc collapses and the message box takes the focus; i opens it again; picking another agent and back keeps it open`,
                    clicked &&
                        open &&
                        win?.focused === true &&
                        rowsOk &&
                        allClicked &&
                        allUp &&
                        allOk &&
                        pushes &&
                        win?.note === NOTE &&
                        win.addNote &&
                        win.openJarvis &&
                        collapsed &&
                        afterEsc.box &&
                        reopened &&
                        viaKey?.open === true &&
                        survives,
                    { clicked, open, win, rowsOk, allUp, allOk, geo, pushes, collapsed, afterEsc, reopened, survives }
                );
            });

            // 3b. the reading position holds across open and close
            await run("3b. reading position", async (name) => {
                const oid = await makeMain();
                await link(oid, TITLE);
                const topOf = `(() => {
                    const s = ${scrollerOf(A)};
                    if (!s) return null;
                    const sr = s.getBoundingClientRect();
                    const items = [...s.querySelectorAll("[data-chat-item]")];
                    const idx = items.findIndex((el) => el.getBoundingClientRect().bottom > sr.top + 1);
                    if (idx < 0) return null;
                    return { idx, text: items[idx].textContent.slice(0, 48), offset: items[idx].getBoundingClientRect().top - sr.top };
                })()`;
                // the same message as before: its offset from the scroller's top, read again
                const offsetOf = (idx, text) => `(() => {
                    const s = ${scrollerOf(A)};
                    const el = s ? [...s.querySelectorAll("[data-chat-item]")][${idx}] : null;
                    if (!el || !el.textContent.startsWith(${JSON.stringify(text)})) return null;
                    return el.getBoundingClientRect().top - s.getBoundingClientRect().top;
                })()`;
                const scrollTo = (where) =>
                    h.ev(`(() => {
                        const s = ${scrollerOf(A)};
                        if (!s) return null;
                        s.scrollTop = ${where === "middle" ? "Math.max(0, (s.scrollHeight - s.clientHeight) / 2)" : "s.scrollHeight"};
                        s.dispatchEvent(new Event("scroll"));
                        return { top: Math.round(s.scrollTop), height: s.scrollHeight, client: s.clientHeight };
                    })()`);
                const atTail = () => h.ev(`(() => { const s = ${scrollerOf(A)}; return !!s && s.scrollHeight - s.scrollTop - s.clientHeight <= 8; })()`);
                const lastItem = () =>
                    h.ev(`(() => {
                        const s = ${scrollerOf(A)};
                        const items = [...(s?.querySelectorAll("[data-chat-item]") ?? [])];
                        const last = items[items.length - 1];
                        if (!s || !last) return null;
                        return last.getBoundingClientRect().bottom <= s.getBoundingClientRect().bottom + 8;
                    })()`);
                const toggle = async () => {
                    await click(h, `${bandOf(A)}?.querySelector("[data-band-toggle]")`);
                    await polishNap(900);
                };
                // scrolled to the middle
                const geo = await scrollTo("middle");
                await polishNap(400);
                const before = await h.ev(topOf);
                await toggle();
                const opened = await h.ev(`${bandOf(A)}?.hasAttribute("data-band-open") === true`);
                const afterOpen = before ? await h.ev(offsetOf(before.idx, before.text)) : null;
                await shot(h, "3b-open-middle");
                await toggle();
                const closed = await h.ev(`${bandOf(A)}?.hasAttribute("data-band-open") === false`);
                const afterClose = before ? await h.ev(offsetOf(before.idx, before.text)) : null;
                const near = (x) => x != null && before != null && Math.abs(x - before.offset) <= 4;
                // scrolled to the tail: it still ends on the last message
                await scrollTo("tail");
                await polishNap(400);
                const tail0 = (await atTail()) && (await lastItem());
                await toggle();
                const tailOpen = (await atTail()) && (await lastItem());
                await toggle();
                const tailClosed = (await atTail()) && (await lastItem());
                await shot(h, "3b-tail");
                rec(
                    `${name}: scrolled to the middle, the top message keeps its offset from the conversation's top (within 4px) across open and close; scrolled to the tail it still ends on the last message`,
                    geo != null && geo.height > geo.client && before != null && opened && near(afterOpen) && closed && near(afterClose) && tail0 && tailOpen && tailClosed,
                    { geo, before, opened, afterOpen, closed, afterClose, tail0, tailOpen, tailClosed }
                );
            });

            // 4. the switch and the waiting line
            await run("4. switch and the waiting line", async (name) => {
                const oid = await makeMain();
                await link(oid, TITLE);
                await setBand(h, A, true);
                await polishWaitFor(h, `${bandOf(A)}?.hasAttribute("data-band-open") === true && !!${workOnBtn(C.keys)}`, SHORT_MS);
                await polishNap(600);
                // a. Work on this on a free chunk
                const clicked = await click(h, workOnBtn(C.keys));
                const moved = await until(async () => {
                    const st = await chunkState(h, oid);
                    return st[C.keys]?.status === "active" && st[C.keys].holders.includes(refA) && st[C.draw]?.status === "pending" && !st[C.draw].holders.includes(refA);
                });
                const st1 = await chunkState(h, oid);
                const bandOn = await polishWaitFor(h, `(${FLAT}(${bandOf(A)}?.querySelector("[data-band-on]"))).includes(${JSON.stringify(C.keys)})`, SHORT_MS);
                const lineUp = await polishWaitFor(h, `!!${layerOf(A)}?.querySelector("[data-chat-switch-line]")`, SHORT_MS);
                await polishNap(500);
                const lineText = await h.ev(`${FLAT}(${layerOf(A)}?.querySelector("[data-chat-switch-line]"))`);
                const queued1 = await switchLines(h, A);
                await shot(h, "4-waiting-line");
                // b. ✕ drops it, and only it
                const dropClicked = await click(h, `${layerOf(A)}?.querySelector("[data-chat-switch-drop]")`);
                const lineGone = await polishWaitFor(h, `!${layerOf(A)}?.querySelector("[data-chat-switch-line]")`, SHORT_MS);
                const dropped = (await switchLines(h, A)).length === 0;
                const stAfterDrop = await chunkState(h, oid);
                // c. w on the cursor's row switches again: one line waits
                await focusBand(h, A);
                const onDocs = await cursorTo(C.docs);
                await press(h, "w");
                const movedAgain = await until(async () => {
                    const st = await chunkState(h, oid);
                    return st[C.docs]?.status === "active" && st[C.docs].holders.includes(refA) && st[C.keys]?.status === "pending" && !st[C.keys].holders.includes(refA);
                });
                const queued2 = await switchLines(h, A);
                // d. a third switch replaces it: still one line, naming the newest chunk
                const clicked3 = await click(h, workOnBtn(C.free1));
                const movedThird = await until(async () => (await chunkState(h, oid))[C.free1]?.holders.includes(refA) === true);
                const queued3 = await switchLines(h, A);
                // e. a message: the line goes in front of it and leaves the queue; the bubble is the person's own text
                await typeInBox(h, A, MESSAGE);
                await enterInBox(h);
                const bubble = await polishWaitFor(h, `${pendingBubbles(A)}.includes(${JSON.stringify(MESSAGE)})`, SHORT_MS);
                const keyAfter = await pendingLines(h, A);
                const sentOk = await until(async () => (await typedInputs(h)).some((t) => t.includes(MESSAGE)), SHORT_MS);
                const typed = (await typedInputs(h)).find((t) => t.includes(MESSAGE)) ?? "";
                const bubbleTexts = await h.ev(pendingBubbles(A));
                // the transcript line Claude Code writes for it, with the line in front: the conversation draws only the text
                append(ctx, AC.userText(typed, ts(ctx, 0)));
                const youShown = await polishWaitFor(h, `${youBubbles(A)}.some((t) => t.includes(${JSON.stringify(MESSAGE)}))`, WAIT_MS);
                const youTexts = await h.ev(youBubbles(A));
                const youLeak = youTexts.some((t) => t.includes("initiative: switched"));
                await polishNap(500);
                await shot(h, "4-sent");
                rec(
                    `${name}: Work on this on "${C.keys}" makes it active with the agent and sets "${C.draw}" pending without it, the band reads it and [data-chat-switch-line] waits; its ✕ drops the line; w on the cursor's row switches again with exactly one initiative: switched line queued (a third switch replaces it, still one); a message takes the line out of chat.initiative.pending, the line goes in front of the typed text, and the bubble shows the text without it`,
                    clicked &&
                        moved &&
                        bandOn &&
                        lineUp &&
                        /switched to chunk 3 Wire the band keys/.test(lineText) &&
                        queued1.length === 1 &&
                        queued1[0].startsWith(`initiative: switched you to chunk 3 ${C.keys}`) &&
                        dropClicked &&
                        lineGone &&
                        dropped &&
                        stAfterDrop[C.keys].status === "active" &&
                        onDocs &&
                        movedAgain &&
                        queued2.length === 1 &&
                        queued2[0].startsWith(`initiative: switched you to chunk 4 ${C.docs}`) &&
                        clicked3 &&
                        movedThird &&
                        queued3.length === 1 &&
                        queued3[0].startsWith(`initiative: switched you to chunk 6 ${C.free1}`) &&
                        bubble &&
                        keyAfter.length === 0 &&
                        sentOk &&
                        typed.indexOf("initiative: switched you to chunk 6") >= 0 &&
                        typed.indexOf("initiative: switched you to chunk 6") < typed.indexOf(MESSAGE) &&
                        bubbleTexts.includes(MESSAGE) &&
                        !bubbleTexts.some((t) => (t ?? "").includes("initiative:")) &&
                        youShown &&
                        !youLeak,
                    { clicked, moved, st1, bandOn, lineUp, lineText, queued1, dropClicked, lineGone, dropped, onDocs, movedAgain, queued2, clicked3, movedThird, queued3, bubble, keyAfter, sentOk, typed, bubbleTexts, youShown, youTexts }
                );
            });

            // 4b. a failed switch leaves the agent where it was and says why
            await run("4b. failed switch", async (name) => {
                const FAIL = "verify: the switch was refused";
                const oid = await makeMain();
                await link(oid, TITLE);
                await setBand(h, A, true);
                await polishWaitFor(h, `${bandOf(A)}?.hasAttribute("data-band-open") === true && !!${workOnBtn(C.keys)}`, SHORT_MS);
                await polishNap(600);
                await h.ev(`window.__initiativeSwitchFail = ${JSON.stringify(FAIL)}`);
                try {
                    await click(h, workOnBtn(C.keys));
                    const shown = await polishWaitFor(h, `${FLAT}(${bandOf(A)}?.querySelector("[data-band-error]")).includes(${JSON.stringify(FAIL)})`, SHORT_MS);
                    // the rollback runs for real, so read the store once it has
                    await polishNap(800);
                    const st = await chunkState(h, oid);
                    const lineShown = await h.ev(`!!${layerOf(A)}?.querySelector("[data-chat-switch-line]")`);
                    const queued = await switchLines(h, A);
                    const band = await readBand(h, A);
                    await shot(h, "4b-failed-switch");
                    rec(
                        `${name}: with window.__initiativeSwitchFail set, Work on this leaves the agent on "${C.draw}" (active, its workref kept; "${C.keys}" has none), [data-band-error] shows the message, and no waiting line appears`,
                        shown &&
                            st[C.draw]?.status === "active" &&
                            st[C.draw].holders.includes(refA) &&
                            !st[C.keys]?.holders.includes(refA) &&
                            st[C.keys]?.status === "pending" &&
                            !lineShown &&
                            queued.length === 0 &&
                            /On\s*2\s*Draw the band/.test(band?.on ?? ""),
                        { shown, st, lineShown, queued, on: band?.on, error: band?.error }
                    );
                } finally {
                    await h.ev(`delete window.__initiativeSwitchFail`);
                }
            });

            // 5. no chunk for this agent
            await run("5. no chunk", async (name) => {
                const oid = await makeEffort("Band: no chunk for the agent", [{ label: "No chunk one" }, { label: "No chunk two" }, { label: "No chunk three" }]);
                const up = await link(oid, "Band: no chunk for the agent");
                await polishNap(400);
                const collapsed = await readBand(h, A);
                await shot(h, "5-no-chunk");
                const picked = await click(h, `${bandOf(A)}?.querySelector("[data-band-pick]")`);
                await polishWaitFor(h, `${bandOf(A)}?.hasAttribute("data-band-open") === true`, SHORT_MS);
                await polishNap(600);
                const expanded = await readBand(h, A);
                const cursor = (expanded?.rows ?? []).find((r) => r.current);
                await shot(h, "5-pick-expanded");
                await setBand(h, A, false);
                // an initiative whose chunks all have holders, or none to move to: no Pick a chunk…
                const oid2 = await makeEffort("Band: nothing to pick", [
                    { label: "Held by the other", status: "active", hold: "B" },
                    { label: "Already done", status: "done" },
                    { label: "Skipped one", status: "skipped" },
                ]);
                const up2 = await link(oid2, "Band: nothing to pick");
                await polishNap(400);
                const none = await readBand(h, A);
                await shot(h, "5-nothing-to-pick");
                rec(
                    `${name}: with no chunk the band reads "No chunk for this agent" and Pick a chunk… but no Mark done; Pick a chunk… expands it with the cursor on the first Work on this (the band holds the focus); where no chunk offers it there is no Pick a chunk…`,
                    up &&
                        collapsed?.open === false &&
                        /No chunk for this agent/.test(collapsed.on) &&
                        /Pick a chunk/.test(collapsed.pick ?? "") &&
                        collapsed.markDone == null &&
                        picked &&
                        expanded?.open === true &&
                        expanded.focused &&
                        cursor?.label === "No chunk one" &&
                        cursor.workOn &&
                        up2 &&
                        /No chunk for this agent/.test(none?.on ?? "") &&
                        none.pick == null &&
                        none.markDone == null,
                    { up, collapsed, picked, expandedRows: expanded?.rows, cursor, focused: expanded?.focused, up2, none }
                );
            });

            // 6. a narrow cell
            await run("6. narrow cell", async (name) => {
                const oid = await makeMain();
                await link(oid, TITLE);
                ctx.viewport ??= await h.ev("({ width: window.innerWidth, height: window.innerHeight })");
                const wide = await readBand(h, A);
                // the window narrowed until the band is about NARROW_WANT wide; the band follows the window while the layout holds
                let width = ctx.viewport.width;
                let bandW = wide?.width ?? 0;
                for (let pass = 0; pass < NARROW_PASSES && Math.abs(bandW - NARROW_WANT) > NARROW_TOLERANCE; pass++) {
                    width += NARROW_WANT - bandW;
                    await h.cdp("Emulation.setDeviceMetricsOverride", { width, height: ctx.viewport.height, deviceScaleFactor: 1, mobile: false });
                    await polishNap(700);
                    bandW = (await readBand(h, A))?.width ?? 0;
                }
                await polishWaitFor(h, `${bandOf(A)}?.hasAttribute("data-band-narrow") === true`, SHORT_MS);
                await polishNap(400);
                const narrow = await readBand(h, A);
                await shot(h, "6-narrow");
                await h.cdp("Emulation.clearDeviceMetricsOverride", {});
                ctx.viewport = null;
                await polishNap(700);
                const wideAgain = await polishWaitFor(h, `${bandOf(A)}?.hasAttribute("data-band-narrow") === false && !!${bandOf(A)}.querySelector("[data-band-segments]")`, SHORT_MS);
                rec(
                    `${name}: with the band under ${NARROW_PX}px it has data-band-narrow, no [data-band-segments] and its button reads "Done"; wide again it draws the bar and "Mark done"`,
                    narrow != null && narrow.width < NARROW_PX && narrow.narrow && !narrow.segments && narrow.markDone === "Done" && wide?.narrow === false && wideAgain,
                    { wide: { width: wide?.width, narrow: wide?.narrow }, narrow: { width: narrow?.width, narrow: narrow?.narrow, segments: narrow?.segments, markDone: narrow?.markDone }, wideAgain }
                );
            });

            // 7. the chunk chips
            await run("7. chunk chips", async (name) => {
                const chipOf = (kind) => `${layerOf(A)}?.querySelector('[data-chat-suggest-kind="${kind}"]')`;
                const chipKinds = () => h.ev(`[...(${layerOf(A)}?.querySelectorAll("[data-chat-suggest-chip]") ?? [])].map((b) => b.getAttribute("data-chat-suggest-kind"))`);
                const X = ["Build the chips", "Run the scenario", "Ship the chips"];
                // a. a committed turn on a held chunk offers done:; its click marks it done and carries the agent on
                const oidA = await makeEffort("Band: chips on a held chunk", [{ label: X[0], status: "active", hold: "A" }, { label: X[1] }, { label: X[2] }]);
                await setBand(h, A, false);
                await takePending(h, A);
                // the turn ended after the agent took the chunk, so the chunk is that turn's work
                append(ctx, AC.userText("commit it", ts(ctx, 0)), AC.assistantText("Committed 1a2b3c4: the chips' first cut.", ts(ctx, 500)));
                await setA({ effortId: oidA, committed: true, idleSince: Date.now() });
                const doneChip = await polishWaitFor(h, `${FLAT}(${chipOf("done")}) === ${JSON.stringify(`done: ${X[0]}`)}`, WAIT_MS);
                await polishNap(400);
                const kindsBefore = await chipKinds();
                await shot(h, "7-chip-done");
                const clickedDone = await click(h, chipOf("done"));
                const carried = await until(async () => {
                    const st = await chunkState(h, oidA);
                    return st[X[0]]?.status === "done" && st[X[1]]?.status === "active" && st[X[1]].holders.includes(refA);
                }, WAIT_MS);
                const bandOn = await polishWaitFor(h, `(${FLAT}(${bandOf(A)}?.querySelector("[data-band-on]"))).includes(${JSON.stringify(X[1])})`, SHORT_MS);
                // the chip belongs to the turn: none for the chunk the agent was just carried to, now or a moment later
                await polishNap(700);
                const kindsAfter = await chipKinds();
                await shot(h, "7-chip-after-done");

                // b. an agent that holds only done chunks is offered go on with:, whose click switches and sends
                await setA({ committed: false });
                // the waiting line watched from here on: whether its element is ever added, how long it lives, and its height in
                // each frame it is there (a frame it has height is a frame a person sees it)
                await h.ev(`(() => {
                    window.__bandLine?.obs?.disconnect();
                    const probe = { seen: false, added: null, removed: null, heights: [], on: true, obs: null };
                    const isLine = (n) => n.nodeType === 1 && (n.matches?.("[data-chat-switch-line]") || !!n.querySelector?.("[data-chat-switch-line]"));
                    probe.obs = new MutationObserver((ms) => {
                        for (const m of ms) {
                            for (const n of m.addedNodes) if (isLine(n)) { probe.seen = true; probe.added ??= performance.now(); }
                            for (const n of m.removedNodes) if (isLine(n)) probe.removed = performance.now();
                        }
                    });
                    probe.obs.observe(document.body, { childList: true, subtree: true });
                    const tick = () => {
                        const el = document.querySelector("[data-chat-switch-line]");
                        if (el) probe.heights.push(Math.round(el.getBoundingClientRect().height));
                        if (probe.on) requestAnimationFrame(tick);
                    };
                    requestAnimationFrame(tick);
                    window.__bandLine = probe;
                    return true;
                })()`);
                const Y = ["Spec the chips", "Draw the chips", "Test the chips"];
                const oidB = await makeEffort("Band: chips on a finished chunk", [{ label: Y[0], status: "done", hold: "A" }, { label: Y[1] }, { label: Y[2] }]);
                await takePending(h, A);
                const before = (await typedInputs(h)).length;
                append(ctx, AC.userText("finish the spec", ts(ctx, 1000)), AC.assistantText("The spec for the chips is done.", ts(ctx, 1500)));
                await setA({ effortId: oidB, idleSince: Date.now() });
                const nextChip = await polishWaitFor(h, `${FLAT}(${chipOf("next")}) === ${JSON.stringify(`go on with: ${Y[1]}`)}`, WAIT_MS);
                await polishNap(400);
                const kindsGoOn = await chipKinds();
                await shot(h, "7-chip-go-on");
                const clickedNext = await click(h, chipOf("next"));
                const switched = await until(async () => {
                    const st = await chunkState(h, oidB);
                    return st[Y[1]]?.status === "active" && st[Y[1]].holders.includes(refA);
                }, WAIT_MS);
                const sent = await until(async () => (await typedInputs(h)).slice(before).some((t) => t.includes(`go on with: ${Y[1]}`)), WAIT_MS);
                const typed = (await typedInputs(h)).slice(before).find((t) => t.includes(`go on with: ${Y[1]}`)) ?? "";
                const bubbleTexts = await h.ev(pendingBubbles(A));
                const line = await h.ev(`(() => { const p = window.__bandLine; return p ? { seen: p.seen, lifeMs: p.added != null && p.removed != null ? Math.round(p.removed - p.added) : null, heights: p.heights } : null; })()`);
                const lineSeen = line?.seen === true;
                const lineNow = await h.ev(`!!${layerOf(A)}?.querySelector("[data-chat-switch-line]")`);
                const queued = await switchLines(h, A);
                await h.ev(`(() => { const p = window.__bandLine; if (p) { p.on = false; p.obs?.disconnect(); } delete window.__bandLine; return true; })()`);
                await polishNap(400);
                await shot(h, "7-chip-go-on-sent");
                rec(
                    `${name}: a committed turn on a held chunk offers [data-chat-suggest-kind="done"] "done: ${X[0]}"; its click marks it done and carries the agent to "${X[1]}" (the band reads it, no done: chip for it); an agent holding only done chunks is offered "go on with: ${Y[1]}", whose click makes it active with the agent and sends the text with the switched line in front, the waiting line never showing`,
                    doneChip &&
                        kindsBefore.join() === "done" &&
                        clickedDone &&
                        carried &&
                        bandOn &&
                        !kindsAfter.includes("done") &&
                        nextChip &&
                        kindsGoOn.join() === "next" &&
                        clickedNext &&
                        switched &&
                        sent &&
                        typed.indexOf(`initiative: switched you to chunk 2 ${Y[1]}`) >= 0 &&
                        typed.indexOf(`initiative: switched you to chunk 2 ${Y[1]}`) < typed.indexOf(`go on with: ${Y[1]}`) &&
                        bubbleTexts.includes(`go on with: ${Y[1]}`) &&
                        !lineSeen &&
                        !lineNow &&
                        queued.length === 0,
                    { doneChip, kindsBefore, clickedDone, carried, bandOn, kindsAfter, nextChip, kindsGoOn, clickedNext, switched, sent, typed, bubbleTexts, line, lineNow, queued }
                );
            });

            return steps;
        },

        async teardown(h, ctx) {
            const step = async (what, fn) => {
                try {
                    await fn();
                } catch (e) {
                    console.error(`chat-initiative-band teardown: ${what} failed: ${e?.message ?? e}`);
                }
            };
            await step("remove the probes", () =>
                h.ev(`(() => { if (window.__bandLine) { window.__bandLine.on = false; window.__bandLine.obs?.disconnect(); } delete window.__bandLine; delete window.__initiativeSwitchFail; delete window.__chatSuggestFake; return true; })()`)
            );
            await step("put the window back", () => h.cdp("Emulation.clearDeviceMetricsOverride", {}));
            await step("close an open picker", async () => {
                if (await h.ev(`!!document.querySelector("[data-initiative-picker]")`)) await press(h, "Escape");
            });
            if (ctx.tabA != null) {
                await step("put the band and the waiting lines back", () =>
                    AC.agentPage(
                        h,
                        `const B = await mod("app/view/agents/initiativebandstore.ts");
                        const S = await mod("app/view/agents/chatinitiativestore.ts");
                        for (const id of ${JSON.stringify([ctx.tabA.tabId, ctx.tabB?.tabId].filter(Boolean))}) { B.setBandPart(id, null); S.takeResultLines(id); }
                        return true;`
                    )
                );
                await step("remove the input mock", () =>
                    AC.agentPage(
                        h,
                        `const m = window.${MOCK_KEY};
                        if (m) { m.api.setMockRpcClient(m.prev); delete window.${MOCK_KEY}; }
                        return true;`
                    )
                );
            }
            await step("restore the roster", () => AC.restoreRoster(h));
            for (const oid of ctx.oids ?? []) {
                await step(`delete ${oid}`, () => h.rpc("effortdelete", { effortoid: oid }));
            }
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

    // the roster rows: the main agent (`patch` is the state under test: its initiative, its turn) and the one holding a chunk
    // of its own
    function rosterOf(ctx, patch = {}) {
        return [
            {
                project: PROJECT,
                task: "",
                agent: "claude",
                model: "opus",
                state: "idle",
                idleSince: Date.now() - 60_000,
                usage: { contextpct: 42 },
                id: ctx.tabA.tabId,
                name: NAME_A,
                blockId: ctx.tabA.blockId,
                transcriptPath: ctx.transcriptA,
                ...patch,
            },
            {
                project: PROJECT,
                task: "",
                agent: "claude",
                model: "opus",
                state: "idle",
                idleSince: Date.now() - 60_000,
                usage: { contextpct: 12 },
                id: ctx.tabB.tabId,
                name: NAME_B,
                blockId: ctx.tabB.blockId,
                transcriptPath: ctx.transcriptB,
            },
        ];
    }

    return [scenario];
}
