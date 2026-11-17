// agent-header-redesign: the left side of the agent header in each case of its board
// (docs/superpowers/specs/2026-11-16-agent-header-redesign-design.md; frontend/app/view/agents/agentheader.tsx, headermodel.ts).
// The roster is the `agent-header` cockpit fixture (scripts/cockpit-fixtures/scenarios.mjs), set straight into the page's
// dev mock roster atom, so no agent launches and no file is written. What it links to is real where the header reads it
// from wavesrv: a channel on a temp dir with two deferred orchestrator runs started from the plain session (the lead's run
// and one more), and an initiative for the Chat agent. The worker's run and the dag naming its task are seeded in the
// page's object cache only (the engine never sees them), and its queued heavy command is set into the job queue atom.
// Narrow and very narrow are the header given a fixed width, which its ResizeObserver reads as a 2x2 cell's.
// kit is scenarios.mjs's RT_KIT (waveService, polishWaitFor, polishNap).

import { randomUUID } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { AGENT_HEADER_IDS as IDS, agentHeader } from "../cockpit-fixtures/scenarios.mjs";

const NAME = "agent-header-redesign";
const WAIT_MS = 8_000;
const RPC = { timeout: 30_000 };
const INITIATIVE = "Submit the ASIACCS draft";
const shot = (h, step) => h.shot(`cdp-shots/${NAME}-${step}.png`);

// the app's own module instances, and the app's one AgentsViewModel (as scenarios-agent-start-failed.mjs reads them)
const LIB = `
    const mod = async (path) => {
        const names = performance.getEntriesByType("resource").map((e) => e.name.split("?")[0]);
        const hit = names.filter((n) => n.endsWith("/" + path)).pop();
        const base = names.find((n) => n.endsWith("/app/store/jotaiStore.ts"));
        if (hit == null && base == null) throw new Error("no app module url for " + path);
        return import(hit ?? base.replace("app/store/jotaiStore.ts", path));
    };
    const { globalStore } = await mod("app/store/jotaiStore.ts");
    const WOS = await mod("app/store/wos.ts");
    const agentsModel = () => {
        const nav = document.querySelector("nav");
        const key = nav && Object.keys(nav).find((k) => k.startsWith("__reactFiber$"));
        for (let f = key ? nav[key] : null; f; f = f.return) {
            if (f.memoizedProps?.model?.pendingLaunchesAtom) return f.memoizedProps.model;
        }
        throw new Error("no AgentsViewModel above the nav rail");
    };
`;
const pageEval = (h, body) => h.ev(`(async () => { ${LIB} ${body} })()`);

const setRoster = (h, roster) =>
    pageEval(
        h,
        `const { devMockAgentsAtom } = await mod("app/view/agents/devmock.ts");
        globalStore.set(devMockAgentsAtom, ${JSON.stringify(roster)});
        return true;`
    );

// a run and its dag that only the page holds: what the worker's lineage reads
const seedObjects = (h, objs) =>
    pageEval(
        h,
        `for (const obj of ${JSON.stringify(objs)}) {
            const oref = WOS.makeORef(obj.otype, obj.oid);
            await WOS.loadAndPinWaveObject(oref).catch(() => null);
            WOS.setObjectValue(obj);
        }
        return true;`
    );

const setQueue = (h, data) =>
    pageEval(
        h,
        `const { jobQueueAtom } = await mod("app/cockpit/jobqueuestore.ts");
        const prev = globalStore.get(jobQueueAtom);
        globalStore.set(jobQueueAtom, ${JSON.stringify(data)});
        return prev;`
    );

// Chat or Terminal for one agent (chatmodestore.ts), and the agent in focus on the Agent surface
const showRaw = (h, id, mode) =>
    pageEval(
        h,
        `const { setChatMode } = await mod("app/view/agents/chatmodestore.ts");
        setChatMode(${JSON.stringify(id)}, ${JSON.stringify(mode)});
        const model = agentsModel();
        globalStore.set(model.focusIdAtom, ${JSON.stringify(id)});
        globalStore.set(model.surfaceAtom, "agent");
        return true;`
    );

// the agent header's button choices (headerbuttonsstore.ts): each button on or off, or null for the defaults
const setHeaderButtons = (h, value) =>
    pageEval(
        h,
        `const { headerButtonsAtom } = await mod("app/view/agents/headerbuttonsstore.ts");
        const { HEADER_BUTTONS, DEFAULT_HEADER_BUTTONS } = await mod("app/view/agents/headerbuttons.ts");
        const want = ${JSON.stringify(value)} ?? DEFAULT_HEADER_BUTTONS;
        for (const b of HEADER_BUTTONS) globalStore.set(headerButtonsAtom, b, want[b]);
        return true;`
    );

const focused = (h) => pageEval(h, `return globalStore.get(agentsModel().focusIdAtom);`);

const HEADER = `document.querySelector("[data-agent-header]")`;
// the header as the steps read it: its width level, each cluster's words, and which buttons it carries
const readHeader = `(() => {
    const hd = ${HEADER};
    if (!hd) return null;
    const flat = (el) => (el?.textContent ?? "").replace(/\\s+/g, " ").trim();
    const run = hd.querySelector("[data-run-link]");
    const ini = hd.querySelector("[data-initiative-link-open]");
    return {
        width: hd.getAttribute("data-header-width"),
        name: flat(hd.querySelector("[data-header-name] .font-semibold")),
        runtime: !!hd.querySelector("[data-header-name] span[title='Claude Code']"),
        state: flat(hd.querySelector("[data-agent-state-pill]")),
        error: hd.querySelector("[data-agent-start-error]") ? flat(hd.querySelector("[data-agent-start-error]")) : null,
        location: flat(hd.querySelector("[data-header-location]")),
        unlinked: hd.querySelector("[data-initiative-link]") ? flat(hd.querySelector("[data-initiative-link]")) : null,
        initiative: ini ? flat(ini) : null,
        initiativeIcon: !!ini?.querySelector("svg"),
        run: run ? { kind: run.getAttribute("data-run-link"), text: flat(run) } : null,
        model: hd.querySelector("[data-header-model]") ? flat(hd.querySelector("[data-header-model]")) : null,
        dots: [...hd.querySelectorAll("[data-header-clusters] *")].some((el) => el.childNodes.length === 1 && el.textContent.trim() === "·"),
        queued: /queued/i.test(flat(hd)),
        altC: [...hd.querySelectorAll("kbd")].some((k) => /alt|⌥/i.test(k.textContent)),
        split: !!hd.querySelector("[data-agent-split]"),
        float: !!hd.querySelector("[data-agent-header-float]"),
        fullscreen: !!hd.querySelector("button[title^='Fullscreen terminal'], button[title^='Exit fullscreen']"),
    };
})()`;

// a real click at the element's centre, so the context menu opens where it is
async function mouse(h, selector) {
    const at = await h.ev(`(() => {
        const r = document.querySelector(${JSON.stringify(selector)})?.getBoundingClientRect();
        return r ? { x: r.left + r.width / 2, y: r.top + r.height / 2 } : null;
    })()`);
    if (at == null) return false;
    for (const type of ["mousePressed", "mouseReleased"]) {
        await h.cdp("Input.dispatchMouseEvent", { type, x: at.x, y: at.y, button: "left", clickCount: 1 });
    }
    return true;
}
const menuText = `(document.querySelector("[data-context-menu]")?.innerText ?? "").replace(/\\s+/g, " ").trim()`;
const closeMenu = (h) => h.cdp("Input.dispatchKeyEvent", { type: "keyDown", key: "Escape", code: "Escape", windowsVirtualKeyCode: 27 }).then(() => h.cdp("Input.dispatchKeyEvent", { type: "keyUp", key: "Escape", code: "Escape", windowsVirtualKeyCode: 27 }));
const narrowTo = (h, px) => h.ev(`(() => { const hd = ${HEADER}; if (!hd) return false; hd.style.width = ${px == null ? '""' : JSON.stringify(px + "px")}; return true; })()`);

export default function (kit) {
    const { polishWaitFor, polishNap } = kit;
    // the fixture's blocks are not real ones, so a pane's controller start fails ("error getting block: not found") and
    // the header reads failed to start, which rightly wins over the fixture's state (as in scenarios.mjs's job-queue
    // tag). Every agent here but the failed one is about its fixture state: clear that refusal once the pane has tried
    const show = async (h, id, mode) => {
        await showRaw(h, id, mode);
        if (id === IDS.failed) {
            return;
        }
        await polishWaitFor(h, `!!${HEADER}?.querySelector("[data-agent-start-error]")`, 3000);
        await pageEval(
            h,
            `const { getStartErrorAtom } = await mod("app/view/agents/agentcontrollerstore.ts");
            globalStore.set(getStartErrorAtom(${JSON.stringify(`fx-blk-${id.slice(3)}`)}), undefined);
            return true;`
        );
        await polishWaitFor(h, `!${HEADER}?.querySelector("[data-agent-start-error]")`, 3000);
    };
    const waitHeader = async (h, name, extra = "true") => polishWaitFor(h, `(${HEADER}?.querySelector("[data-header-name] .font-semibold")?.textContent ?? "").includes(${JSON.stringify(name)}) && (${extra})`, WAIT_MS);
    return [
        {
            name: NAME,
            surface: "agent",
            async arrange(h) {
                const ctx = { cwd: mkdtempSync(join(tmpdir(), "verify-agent-header-")), runIds: [], effortOids: [] };
                try {
                    await h.goto("agent");
                    const bootTab = String(await h.ev("window.TabRpcClient.routeId")).replace(/^tab:/, "");
                    const wslist = await h.rpc("workspacelist", null);
                    ctx.workspaceId = (wslist.find((w) => (w.workspacedata?.tabids ?? []).includes(bootTab)) ?? wslist[0]).workspacedata.oid;
                    const ch = await h.rpc("createchannel", { name: "verify-agent-header", projectpath: ctx.cwd });
                    ctx.channelId = ch.oid;
                    // two runs the plain session started: the lead's run, and one more
                    for (const goal of ["Schedule runs", "Quiet hours for notifications"]) {
                        const made = await h.rpc(
                            "createrun",
                            { channelid: ctx.channelId, workspaceid: ctx.workspaceId, goal, runtime: "claude", mode: "orchestrator", deferstart: true, origintabid: IDS.plain },
                            RPC
                        );
                        ctx.runIds.push(made.run.id);
                    }
                    ctx.leadRunId = ctx.runIds[0];
                    const effort = await h.rpc("effortcreate", { title: INITIATIVE, project: "mit-thesis", chunks: [{ label: "Fix the figures" }] });
                    ctx.effortOids.push(effort.effortoid);
                    // the worker's run and the dag that names its task under the lead's run, in the page only
                    ctx.workerRunId = randomUUID();
                    const dagId = randomUUID();
                    await seedObjects(h, [
                        { otype: "dag", oid: dagId, version: 1, runid: ctx.leadRunId, status: "executing", tasks: [{ id: "T3", label: "Write servicesmodel.ts", runid: ctx.workerRunId, state: "running" }] },
                        { otype: "run", oid: ctx.workerRunId, version: 1, id: ctx.workerRunId, goal: "T3", mode: "quick", status: "running", dagoref: dagId, workspaceid: ctx.workspaceId, projectpath: ctx.cwd, phases: [], createdts: Date.now() },
                    ]);
                    ctx.roster = agentHeader(Date.now(), { leadRunId: ctx.leadRunId, workerRunId: ctx.workerRunId, effortId: effort.effortoid });
                    ctx.prevQueue = await setQueue(h, {
                        slots: 1,
                        mode: "auto",
                        jobs: [{ id: "fx-hdr-job", name: "task build:backend", bytes: 3.1e9, position: 2, queuedts: Date.now(), blockid: "fx-blk-hdr-worker" }],
                    });
                    await setRoster(h, ctx.roster);
                    ctx.ready = await polishWaitFor(h, `!!document.querySelector('[data-agent-row="${IDS.plain}"]')`, WAIT_MS);
                } catch (e) {
                    ctx.arrangeError = String(e?.message ?? e);
                }
                return ctx;
            },
            async assert(h, ctx) {
                const steps = [];
                const rec = (step, ok, detail) => steps.push({ step, ok: ok === true, detail: typeof detail === "string" ? detail : JSON.stringify(detail) });
                rec("0. the fixture roster, its two runs and the initiative were made", ctx.arrangeError == null && ctx.ready === true, ctx.arrangeError ?? { ready: ctx.ready });
                if (ctx.arrangeError != null) return steps;

                // 1. a plain session in Terminal, wide: three clusters led by icons, no ` · `
                await show(h, IDS.plain, "terminal");
                await waitHeader(h, "Pull history and sync", `!!${HEADER}.querySelector("[data-run-link]")`);
                await polishNap(400);
                const plain = await h.ev(readHeader);
                await shot(h, "1-plain");
                rec(
                    '1. plain session, Terminal: "mit-thesis / + initiative", the run link "2 runs · 2 active" with its menu, "opus 4.5" and its context, no ` · ` between them',
                    plain?.width === "wide" &&
                        /^mit-thesis\s*\/\s*initiative$/.test(plain.location) &&
                        plain.unlinked === "initiative" &&
                        plain.run?.kind === "menu" &&
                        plain.run.text === "2 runs · 2 active" &&
                        /^opus 4\.5\s*\d+(\.\d+)?k$/.test(plain.model ?? "") &&
                        !plain.dots,
                    plain
                );

                // 2. Chat keeps the runtime mark, state word, model and context, and the ◇ initiative
                await show(h, IDS.chat, "chat");
                await waitHeader(h, "Fix table 4.2", `(${HEADER}.querySelector("[data-initiative-link-open]")?.textContent ?? "").includes(${JSON.stringify(INITIATIVE)})`);
                await polishNap(400);
                const chat = await h.ev(readHeader);
                await shot(h, "2-chat");
                rec(
                    `2. Chat: the runtime mark, "working", "sonnet 4.5" and its context, and "mit-thesis / ◇ ${INITIATIVE}"; no Alt+C keycap`,
                    chat?.runtime === true &&
                        chat.state === "working" &&
                        /^sonnet 4\.5\s*\d+(\.\d+)?k$/.test(chat.model ?? "") &&
                        chat.initiative === INITIATIVE &&
                        chat.initiativeIcon &&
                        chat.location.startsWith("mit-thesis") &&
                        !chat.altC,
                    chat
                );

                // 3. the lead: the Workflow icon before its name, its own run's id, and the run menu in sections
                await show(h, IDS.lead, "terminal");
                await waitHeader(h, "Schedule runs", `${HEADER}.querySelector("[data-run-link]")?.getAttribute("data-run-link") === "menu"`);
                const lead = await h.ev(readHeader);
                const leadIcon = await h.ev(`!!${HEADER}?.querySelector("[data-header-name] .font-semibold svg")`);
                await mouse(h, "[data-agent-header] [data-run-link]");
                await polishWaitFor(h, `${menuText}.includes("Started from")`, WAIT_MS);
                await polishNap(300);
                const menu = await h.ev(menuText);
                await shot(h, "3-lead-run-menu");
                await closeMenu(h);
                rec(
                    `3. lead: the Workflow icon before its name, "run ${ctx.leadRunId.slice(0, 8)}" as its run link, and its menu reads This run (id · goal) and Started from (the plain session)`,
                    leadIcon === true &&
                        lead?.run?.text === `run ${ctx.leadRunId.slice(0, 8)}` &&
                        // innerText reads the section titles as their CSS uppercase draws them
                        /this run/i.test(menu) &&
                        menu.includes(`run ${ctx.leadRunId.slice(0, 8)} · Schedule runs`) &&
                        /started from/i.test(menu) &&
                        menu.includes("Pull history and sync"),
                    { lead, leadIcon, menu }
                );

                // 4. a worker whose heavy command waits: "T3 · <label>", the queued tag, no + initiative, ↑ its lead
                await show(h, IDS.worker, "terminal");
                await waitHeader(h, "T3 · Write servicesmodel.ts", `${HEADER}.querySelector("[data-run-link]")?.getAttribute("data-run-link") === "lead"`);
                await polishNap(300);
                const worker = await h.ev(readHeader);
                await shot(h, "4-worker-queued");
                await mouse(h, "[data-agent-header] [data-run-link]");
                const toLead = await polishWaitFor(h, `(${HEADER}?.textContent ?? "").includes("Schedule runs") && !(${HEADER}?.textContent ?? "").includes("T3 ·")`, WAIT_MS);
                rec(
                    '4. worker: "T3 · Write servicesmodel.ts", the queued tag in place of its state word, no "+ initiative", the run link "Schedule runs" focuses the lead',
                    worker?.queued === true && worker.unlinked == null && worker.run?.text === "Schedule runs" && toLead === true && (await focused(h)) === IDS.lead,
                    { worker, toLead }
                );

                // 5. failed to start: the error in red mono, no model cluster
                await show(h, IDS.failed, "terminal");
                await waitHeader(h, "Check secrets before push", `!!${HEADER}.querySelector("[data-agent-start-error]")`);
                const failed = await h.ev(readHeader);
                await shot(h, "5-failed");
                rec(
                    '5. failed to start: "failed to start", the error, "/ + initiative" and no model cluster',
                    failed?.state === "failed to start" && failed.error === "claude: command not found" && failed.model == null && failed.unlinked === "initiative",
                    failed
                );

                // 6. narrow (a 2x2 cell): shorter words, Split / Float / Fullscreen in More
                await show(h, IDS.plain, "terminal");
                await waitHeader(h, "Pull history and sync");
                await narrowTo(h, 560);
                await polishWaitFor(h, `${HEADER}?.getAttribute("data-header-width") === "narrow"`, WAIT_MS);
                await polishNap(300);
                const narrow = await h.ev(readHeader);
                await shot(h, "6-narrow");
                await mouse(h, "[data-agent-header] [data-agent-header-more]");
                await polishWaitFor(h, `${menuText}.includes("Float window")`, WAIT_MS);
                const more = await h.ev(menuText);
                await shot(h, "6b-narrow-more");
                await closeMenu(h);
                rec(
                    '6. narrow (560px): "/ +" with no word, the run link "2", the model "opus", no Split, Float or Fullscreen button, and More holds Split, Fullscreen and Float',
                    narrow?.width === "narrow" &&
                        narrow.unlinked === "" &&
                        narrow.run?.text === "2" &&
                        /^opus\s*\d+(\.\d+)?k$/.test(narrow.model ?? "") &&
                        !narrow.split &&
                        !narrow.float &&
                        !narrow.fullscreen &&
                        more.includes("Split") &&
                        more.includes("Fullscreen terminal") &&
                        more.includes("Float window"),
                    { narrow, more }
                );

                // 6e. the right side's words give way to their icons when the left side does not fit beside them, and
                // nothing on the left runs under the buttons; with the room back the words return
                const readFit = `(() => {
                    const hd = ${HEADER};
                    if (!hd) return null;
                    const cl = hd.querySelector("[data-header-clusters]")?.getBoundingClientRect();
                    const views = [...hd.querySelectorAll("[role=group] button")];
                    const right = views[0]?.parentElement?.parentElement?.getBoundingClientRect();
                    return {
                        labels: hd.getAttribute("data-header-labels"),
                        views: views.map((b) => b.textContent.trim()),
                        clustersRight: cl ? Math.round(cl.right) : null,
                        buttonsLeft: right ? Math.round(right.left) : null,
                    };
                })()`;
                const icons = await h.ev(readFit);
                await narrowTo(h, 1600);
                await polishWaitFor(h, `${HEADER}?.getAttribute("data-header-labels") === "words"`, WAIT_MS);
                await polishNap(200);
                const roomy = await h.ev(readFit);
                rec(
                    "6e. narrow (560px): the view switch is its icons alone and the left side ends before the buttons; at 1600px the words are back (Terminal)",
                    icons?.labels === "icons" &&
                        icons.views.length > 0 &&
                        icons.views.every((t) => t === "") &&
                        icons.clustersRight != null &&
                        icons.buttonsLeft != null &&
                        icons.clustersRight <= icons.buttonsLeft &&
                        roomy?.labels === "words" &&
                        roomy.views.includes("Terminal"),
                    { icons, roomy }
                );
                await narrowTo(h, null);

                // 6c. wide, by default Split and Fullscreen sit in More and Float in the header; Settings → Appearance →
                // Agent header turning all three on puts them back in the header
                await setHeaderButtons(h, null);
                await polishWaitFor(h, `${HEADER}?.getAttribute("data-header-width") !== "narrow" && !!${HEADER}?.querySelector("[data-agent-header-float]")`, WAIT_MS);
                await polishNap(300);
                const wide = await h.ev(readHeader);
                await shot(h, "6c-wide-default");
                await mouse(h, "[data-agent-header] [data-agent-header-more]");
                await polishWaitFor(h, `${menuText}.includes("Fullscreen terminal")`, WAIT_MS);
                const wideMore = await h.ev(menuText);
                await closeMenu(h);
                await setHeaderButtons(h, { split: true, float: true, fullscreen: true });
                await polishWaitFor(h, `!!${HEADER}?.querySelector("[data-agent-split]")`, WAIT_MS);
                const allOn = await h.ev(readHeader);
                await shot(h, "6d-wide-all-buttons");
                await mouse(h, "[data-agent-header] [data-agent-header-more]");
                await polishWaitFor(h, `${menuText}.includes("Fullscreen terminal")`, WAIT_MS);
                const allOnMore = await h.ev(menuText);
                await closeMenu(h);
                await setHeaderButtons(h, null);
                rec(
                    "6c. wide: by default no Split or Fullscreen button, Float shown, and More holds Split and Fullscreen; with all three on in the setting the header shows Split, Float and Fullscreen and More no longer lists Split or Float",
                    wide?.width !== "narrow" && !wide?.split && wide?.float && !wide?.fullscreen &&
                        wideMore.includes("Split") && wideMore.includes("Fullscreen terminal") && !wideMore.includes("Float window") &&
                        allOn?.split && allOn.float && allOn.fullscreen &&
                        !allOnMore.includes("Split") && !allOnMore.includes("Float window"),
                    { wide, wideMore, allOn, allOnMore }
                );

                // 7. very narrow: the initiative is its ◇ alone, the project gives way first
                await show(h, IDS.chat, "chat");
                await waitHeader(h, "Fix table 4.2", `!!${HEADER}.querySelector("[data-initiative-link-open]")`);
                await narrowTo(h, 460);
                await polishWaitFor(h, `${HEADER}?.getAttribute("data-header-width") === "tiny"`, WAIT_MS);
                await polishNap(300);
                const tiny = await h.ev(readHeader);
                const iniTitle = await h.ev(`${HEADER}?.querySelector("[data-initiative-link-open]")?.title ?? ""`);
                await shot(h, "7-very-narrow");
                await narrowTo(h, null);
                rec(
                    "7. very narrow (460px): the initiative is its ◇ alone, its title in the tooltip; the model and context still show",
                    tiny?.width === "tiny" && tiny.initiative === "" && tiny.initiativeIcon && iniTitle.includes(INITIATIVE) && /^sonnet\s*\d+(\.\d+)?k$/.test(tiny.model ?? ""),
                    { tiny, iniTitle }
                );
                return steps;
            },
            async teardown(h, ctx) {
                const failures = [];
                const attempt = async (what, fn) => {
                    try {
                        await fn();
                    } catch (e) {
                        failures.push(`${what}: ${e?.message ?? e}`);
                    }
                };
                await attempt("restore the header width", () => narrowTo(h, null));
                await attempt("restore the header buttons", () => setHeaderButtons(h, null));
                await attempt("drop the fixture roster", () => setRoster(h, null));
                if (ctx.prevQueue !== undefined) await attempt("restore the job queue", () => setQueue(h, ctx.prevQueue));
                for (const runId of ctx.runIds ?? []) {
                    await attempt(`cancel run ${runId}`, () => h.rpc("cancelrun", { channelid: ctx.channelId, runid: runId }, RPC));
                }
                if (ctx.channelId) await attempt("delete the channel", () => h.rpc("deletechannel", { channelid: ctx.channelId }));
                for (const oid of ctx.effortOids ?? []) await attempt("delete the initiative", () => h.rpc("effortdelete", { effortoid: oid }));
                await attempt("remove the temp dir", () => rmSync(ctx.cwd, { recursive: true, force: true }));
                if (failures.length > 0) throw new Error(failures.join("; "));
            },
        },
    ];
}
