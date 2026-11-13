// agent-start-failed: the Agent surface's start-failure state, through a real refusal on the resync path (ported from the
// fork's commit 43835037e, onto our header and tree rows: frontend/app/view/agents/agentheader.tsx, agenttree.tsx). Two
// agent tabs made as launchAgent makes them (CreateTab, the launch meta, the tab's session meta, a pending launch). The
// failing one's block names a remote connection, which ResyncController refuses before it starts anything
// (pkg/blockcontroller/blockcontroller.go: a shell or cmd controller on a non-local connection); the booting one has no
// controller, so it never starts and stays a pending launch. Nothing runs and nothing is written to disk.
// kit is scenarios.mjs's RT_KIT (waveService, polishWaitFor).

import { randomUUID } from "node:crypto";

const NAME = "agent-start-failed";
const REMOTE_CONN = "ssh:arc-verify-none";
const REFUSAL = "remote connections are not supported";
const ROSTER_WAIT_MS = 5_000;
const REFUSAL_WAIT_MS = 10_000;

// the app's own module instances, and the app's one AgentsViewModel
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
    // the nav rail, not the Agent tree: with no agent yet the Agent surface renders the launch hero and no tree
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

const focusAgent = (h, tabId) =>
    pageEval(
        h,
        `const model = agentsModel();
        globalStore.set(model.focusIdAtom, ${JSON.stringify(tabId)});
        globalStore.set(model.surfaceAtom, "agent");
        return true;`
    );

// Chat or Terminal for one agent (chatmodestore.ts); "chat" drops the stored entry again
const setMode = (h, tabId, mode) =>
    pageEval(
        h,
        `const { setChatMode } = await mod("app/view/agents/chatmodestore.ts");
        setChatMode(${JSON.stringify(tabId)}, ${JSON.stringify(mode)});
        return true;`
    );

const HEADER = `document.querySelector("[data-agent-header]")`;
// the header's runtime mark carries its runtime's label as a title: "Claude Code", or "Unknown" for an agent with none
const headerState = `(() => {
    const hd = ${HEADER};
    if (!hd) return null;
    const flat = (el) => (el?.textContent ?? "").replace(/\\s+/g, " ").trim();
    const pill = hd.querySelector("[data-agent-state-pill]");
    const err = hd.querySelector("[data-agent-start-error]");
    return {
        text: flat(hd),
        runtime: [...hd.querySelectorAll("span[title]")].map((el) => el.getAttribute("title")).find((t) => t === "Claude Code" || t === "Unknown") ?? null,
        pill: flat(pill),
        pillError: pill?.classList.contains("text-error") ?? false,
        error: err ? flat(err) : null,
    };
})()`;

// the row's glyph against the theme's error color, both as the browser computes them, and what the row says
const treeRow = (tabId) => `(() => {
    const row = document.querySelector('[data-agent-row="${tabId}"]');
    if (!row) return { row: false };
    const flat = (el) => (el?.textContent ?? "").replace(/\\s+/g, " ").trim();
    const mark = row.querySelector("[data-tree-start-error]");
    const probe = document.createElement("span");
    probe.style.color = "var(--color-error)";
    document.body.appendChild(probe);
    const want = getComputedStyle(probe).color;
    probe.remove();
    return {
        row: true,
        text: flat(row),
        mark: mark != null,
        color: mark ? getComputedStyle(mark).color : null,
        want,
        glyphState: row.querySelector("[data-agent-glyph-state]")?.getAttribute("data-agent-glyph-state") ?? null,
    };
})()`;

const termLines = (tabId) => `(() => {
    const view = document.querySelector('[data-agent-terminal="${tabId}"] [data-term-view]');
    const key = view && Object.keys(view).find((k) => k.startsWith("__reactFiber$"));
    let tw = null;
    for (let f = key ? view[key] : null; f && !tw; f = f.return) {
        if (f.memoizedProps?.model?.termRef?.current?.terminal) tw = f.memoizedProps.model.termRef.current;
    }
    const b = tw?.terminal.buffer.active;
    const out = [];
    for (let y = 0; b && y < b.length; y++) out.push(b.getLine(y)?.translateToString(true) ?? "");
    return out;
})()`;

// CreateTab is a wavesrv service call, which the page cannot reach cross-origin, so Node makes it
async function makeAgentTab(kit, h, ctx, label, blockMeta) {
    const tabId = await kit.waveService(h, "workspace", "CreateTab", [ctx.workspaceId, label, false]);
    ctx.tabIds.push(tabId);
    const tab = await kit.waveService(h, "object", "GetObject", [`tab:${tabId}`]);
    const blockId = tab?.blockids?.[0];
    if (!blockId) throw new Error(`the new tab ${label} has no block`);
    await h.rpc("setmeta", { oref: `block:${blockId}`, meta: blockMeta });
    await h.rpc("setmeta", { oref: `tab:${tabId}`, meta: { "session:agent": "claude", "session:project": label } });
    await pageEval(
        h,
        `await WOS.reloadWaveObject(WOS.makeORef("block", ${JSON.stringify(blockId)}));
        const model = agentsModel();
        const pending = { tabId: ${JSON.stringify(tabId)}, blockId: ${JSON.stringify(blockId)}, name: ${JSON.stringify(label)},
            project: ${JSON.stringify(label)}, ts: Date.now(), runtime: "claude" };
        globalStore.set(model.pendingLaunchesAtom, [...globalStore.get(model.pendingLaunchesAtom), pending]);
        return true;`
    );
    return tabId;
}

export default function (kit) {
    const { polishWaitFor, waveService } = kit;
    return [
        {
            name: NAME,
            surface: "agent",
            async arrange(h) {
                const tag = randomUUID().slice(0, 8);
                const ctx = { tabIds: [] };
                await h.goto("agent");
                const bootTab = String(await h.ev("window.TabRpcClient.routeId")).replace(/^tab:/, "");
                const wslist = await h.rpc("workspacelist", null);
                const ws = wslist.find((w) => (w.workspacedata?.tabids ?? []).includes(bootTab)) ?? wslist[0];
                ctx.workspaceId = ws.workspacedata.oid;
                // a throw past this point still returns ctx, so teardown closes whatever was already made
                try {
                    // no controller: ResyncController returns without starting anything, so it stays booting
                    ctx.bootingId = await makeAgentTab(kit, h, ctx, `start-booting-${tag}`, { view: "term" });
                    ctx.failingId = await makeAgentTab(kit, h, ctx, `start-failed-${tag}`, {
                        view: "term",
                        controller: "cmd",
                        cmd: "claude",
                        "cmd:args": [],
                        "agent:baseargs": [],
                        "cmd:shell": false,
                        "cmd:jwt": true,
                        "cmd:cwd": "~",
                        connection: REMOTE_CONN,
                    });
                } catch (e) {
                    ctx.arrangeError = String(e?.message ?? e);
                }
                return ctx;
            },
            async assert(h, ctx) {
                const steps = [];
                const rec = (step, ok, detail) => steps.push({ step, ok, detail });
                if (ctx.arrangeError != null) {
                    rec("arrange the agent tabs", false, ctx.arrangeError);
                    return steps;
                }

                await focusAgent(h, ctx.bootingId);
                // an agent opens in Chat, whose header is lean by design (d41f145c5): no runtime mark and no state word,
                // the dot keeping the state as its title. The full header this step reads is Terminal's
                await setMode(h, ctx.bootingId, "terminal");
                await polishWaitFor(h, `(${HEADER}?.textContent ?? "").includes("start-booting-")`, ROSTER_WAIT_MS);
                await polishWaitFor(h, `!!${HEADER}?.querySelector("[data-agent-state-pill]")`, ROSTER_WAIT_MS);
                const booting = await h.ev(headerState);
                const bootingRow = await h.ev(treeRow(ctx.bootingId));
                await h.shot("cdp-shots/agent-start-failed-1-booting.png");
                rec(
                    "1. a booting launch's header names its runtime, not Unknown, and reads working",
                    booting != null &&
                        booting.runtime === "Claude Code" &&
                        booting.pill === "working" &&
                        booting.error == null,
                    JSON.stringify(booting)
                );
                rec(
                    "1b. its tree row is not marked failed",
                    bootingRow.row && !bootingRow.mark && !bootingRow.text.includes("failed to start"),
                    JSON.stringify(bootingRow)
                );

                await focusAgent(h, ctx.failingId);
                await polishWaitFor(h, `!!${HEADER}?.querySelector("[data-agent-start-error]")`, REFUSAL_WAIT_MS);
                const failed = await h.ev(headerState);
                await h.shot("cdp-shots/agent-start-failed-2-header.png");
                rec(
                    "2. a launch whose controller is refused reads failed to start with the error in the Agent header",
                    failed != null &&
                        failed.text.includes("start-failed-") &&
                        failed.pill === "failed to start" &&
                        failed.pillError &&
                        (failed.error ?? "").includes(REFUSAL),
                    JSON.stringify(failed)
                );

                const row = await h.ev(treeRow(ctx.failingId));
                await h.shot("cdp-shots/agent-start-failed-3-tree.png");
                rec(
                    "3. its tree row reads failed to start, in the error tone, and is no longer working",
                    row.row &&
                        row.mark &&
                        row.color === row.want &&
                        row.text.includes("failed to start") &&
                        row.glyphState !== "working",
                    JSON.stringify(row)
                );

                const printed = await polishWaitFor(
                    h,
                    `${termLines(ctx.failingId)}.some((l) => l.includes("[arc] could not start:"))`,
                    REFUSAL_WAIT_MS
                );
                const lines = (await h.ev(termLines(ctx.failingId))).filter((l) => l.trim() !== "");
                rec(
                    "4. the terminal prints could not start",
                    printed && lines.some((l) => l.includes("[arc] could not start:") && l.includes(REFUSAL)),
                    JSON.stringify(lines.slice(-4))
                );
                return steps;
            },
            // best-effort, so one failed step does not strand the rest
            async teardown(h, ctx) {
                const step = async (what, fn) => {
                    try {
                        await fn();
                    } catch (e) {
                        console.error(`${NAME} teardown: ${what} failed: ${e?.message ?? e}`);
                    }
                };
                const ids = JSON.stringify(ctx.tabIds ?? []);
                await step("drop the pending launches", () =>
                    pageEval(
                        h,
                        `const model = agentsModel();
                        const ids = ${ids};
                        globalStore.set(model.pendingLaunchesAtom, globalStore.get(model.pendingLaunchesAtom).filter((p) => !ids.includes(p.tabId)));
                        return true;`
                    )
                );
                if (ctx.bootingId) {
                    await step("drop the booting agent's Terminal mode", () => setMode(h, ctx.bootingId, "chat"));
                }
                for (const tabId of ctx.tabIds ?? []) {
                    await step(`close tab ${tabId}`, () =>
                        waveService(h, "workspace", "CloseTab", [ctx.workspaceId, tabId, false])
                    );
                }
                await step("go home", () => h.goto("cockpit"));
            },
        },
    ];
}
