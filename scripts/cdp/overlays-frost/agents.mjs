// overlays-frost-agents: the agent sidebar's, the launcher's and Radar's popovers, frosted (docs/superpowers/plans/
// 2026-11-14-overlays-chat-look.md, Task 5). One step per changed site: open it, wait for its reveal to end, run the
// shared frost check (frostcheck.mjs) on its panel, screenshot it, close it.
//
// The panel is the element that carries `frost`: the PopoverReveal motion element, or the panel itself where the site is a
// plain conditional div. A step marks it with data-ofa-panel and probes that, so a site names its panel in one expression.
//
// Sites, in order (each group is one fixture that its sites share, torn down after them):
//   plain       1 project switcher, 2 consumers, 3 servers            the app bar and footer chips; no fixture
//   initiative  4 initiative popover                                  the initiative-popover scenario's arrange
//   card        5 subagent peek, 6 task popover                       a working agent's Cockpit card (agentrow.tsx)
//   tabs        7 tab switcher                                        two fixture agents, the switcher's atom set
//   bg          8 background-task peek                                the chat-bg-tasks scenario's arrange
//   radar       9 scope selector, 10 audits popover, 11 dismiss menu  the Radar surface's dev scenario
//   git        12 diff options, 13 source picker, 14 ref picker, 15 pull confirm, 16 launcher branch list,
//              17 launcher account menu                               a throwaway repo with a remote, registered as a project
//   canvas     18 canvas link picker                                  the canvas-versions scenario's arrange
//   final      19 End final stage                                     the final-stage scenario's arrange, its stage seeded running
// A site that opens inside the New agent dialog (16, 17) has the dialog's scrim above it, and that scrim has a backdrop
// blur, so it is the panel's backdrop root: the panel frosts the dialog panel behind it, which is the frost there is to
// have (the plan's header decisions). Those two steps accept that one root and no other.
//
// Sites the plan lists that stay solid (so have no step): initiativechunkmenu.tsx (an inline list in the popover's flow),
// launchertoolfields.tsx (cards), toolpicker.tsx and sessionpeek.tsx (ModalShell dialogs: the spec leaves them), usageleversbody.tsx
// (a card), cockpitoffice.tsx (a drag card and buttons), docreviewnotesview.tsx (an inline note editor anchored to a passage).
//
// kit is scenarios.mjs's OF_KIT: CR_KIT plus scenario(name).

import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import * as AC from "../agent-page-fixtures.mjs";
import { frostProbe, frostVerdict } from "./frostcheck.mjs";

const NAME = "overlays-frost-agents";
const PANEL = "[data-ofa-panel]";
const WAIT_MS = 10_000;
const SETTLE_MS = 3_000;
const GIT_PROJECT = "verify-ofa-git";
const RECENT_PROJECTS_KEY = "agent.launch.recentprojects";
// the New agent dialog's scrim (modals/modalshell.tsx BACKDROP.dialog), as frostProbe describes it
const DIALOG_SCRIM = /^div\.fixed\.inset-0\.z-\[70\] \(backdrop-filter\)$/;

const q = (sel) => `document.querySelector(${JSON.stringify(sel)})`;
// a PopoverReveal's motion element, from something inside it
const motionOf = (inner) => `${q(inner)}?.closest('[style*="transform-origin"]')`;
const click = (h, expr) => h.ev(`(${expr})?.click()`);

async function pressKey(h, key, code, vk, modifiers = 0, text) {
    await h.cdp("Input.dispatchKeyEvent", { type: text ? "keyDown" : "rawKeyDown", key, code, text, modifiers, windowsVirtualKeyCode: vk });
    await h.cdp("Input.dispatchKeyEvent", { type: "keyUp", key, code, modifiers, windowsVirtualKeyCode: vk });
}
const pressEscape = (h) => pressKey(h, "Escape", "Escape", 27);

// what the page shows, for a failure's detail: the main area's text, trimmed
const seen = (h) =>
    h
        .ev(`((document.querySelector("main") ?? document.body).innerText || "").replace(/\\s+/g, " ").trim().slice(0, 240)`)
        .catch(() => "(unreadable)");

const git = (dir, ...args) => execFileSync("git", args, { cwd: dir, stdio: "pipe" });

// a bare remote, a clone of it (the project) and a second clone that pushes to it; same shape as the diff-sync scenario
function makeRepos() {
    const base = mkdtempSync(join(tmpdir(), "verify-ofa-"));
    const dirs = { base, remote: join(base, "remote.git"), a: join(base, "a"), b: join(base, "b") };
    const identify = (dir) => {
        git(dir, "config", "user.name", "verify");
        git(dir, "config", "user.email", "verify@example.invalid");
        git(dir, "config", "core.autocrlf", "false");
    };
    git(base, "init", "-q", "--bare", "--initial-branch=main", dirs.remote);
    git(base, "clone", "-q", dirs.remote, dirs.a);
    identify(dirs.a);
    writeFileSync(join(dirs.a, "seed.txt"), "seed\n");
    git(dirs.a, "add", ".");
    git(dirs.a, "commit", "-q", "-m", "seed the repository");
    git(dirs.a, "branch", "-M", "main");
    git(dirs.a, "push", "-q", "-u", "origin", "main");
    // a second local branch, so the ref picker and the branch list have more than main to offer
    git(dirs.a, "branch", "feature/frost");
    git(base, "clone", "-q", dirs.remote, dirs.b);
    identify(dirs.b);
    return dirs;
}

export default (kit) => {
    const { waveService, polishWaitFor, polishNap, waitForProjectInConfig, scenario } = kit;
    const { makeTab, closeTabs } = AC.tabFixtures(kit);
    // polishWaitFor reads `await h.ev(expr)` as it comes back, and a DOM node does not come back: wait on a boolean
    const waitFor = (h, expr, ms) => polishWaitFor(h, `!!(${expr})`, ms);

    // --- the sites ----------------------------------------------------------------------------------------------------

    const plain = {
        surface: "cockpit",
        sites: [
            {
                id: "project-switcher",
                title: "the project switcher",
                open: (h) =>
                    h.ev(`(() => { const t = ${q('[data-project-switcher="bar"]')}; if (!t) return "no project switcher in the app bar"; t.click(); return true; })()`),
                panel: motionOf('[data-project-option="all"]'),
                close: (h) => click(h, q('[data-project-switcher="bar"]')),
            },
            {
                id: "consumers",
                title: "the consumers panel",
                open: (h) =>
                    h.ev(`(() => { const c = ${q("[data-worker-capacity]")}; if (!c) return "no RAM chip in the app bar"; c.click(); return true; })()`),
                panel: motionOf("[data-consumers-panel]"),
                close: (h) => click(h, q("[data-consumers-backdrop]")),
            },
            {
                id: "servers",
                title: "the servers on this machine panel",
                open: (h) =>
                    h.ev(`(() => { const c = ${q("[data-machine-servers-chip]")}; if (!c) return "no servers chip in the footer"; c.click(); return true; })()`),
                panel: motionOf("[data-machine-servers-panel]"),
                close: (h) => click(h, q("[data-machine-servers-backdrop]")),
            },
        ],
    };

    const initiative = {
        surface: "agent",
        async arrange(h, ctx) {
            ctx.sc = scenario("initiative-popover");
            ctx.fx = await ctx.sc.arrange(h);
            if (ctx.fx.skip) throw new Error(ctx.fx.skip);
            if (ctx.fx.arrangeError != null) throw new Error(ctx.fx.arrangeError);
            if (ctx.fx.focus !== true) throw new Error("the fixture agent never reached the Agent surface");
        },
        async teardown(h, ctx) {
            if (ctx.fx) await ctx.sc.teardown(h, ctx.fx);
        },
        sites: [
            {
                id: "initiative",
                title: "the initiative popover",
                async open(h) {
                    await waitFor(h, `${q("[data-agent-header] [data-initiative-link-open]")}?.innerText.length > 0`, WAIT_MS);
                    await h.ev(`${q("[data-cockpit-surface-wrap]")}?.focus()`);
                    await pressKey(h, "i", "KeyI", 73, 0, "i");
                    return true;
                },
                panel: motionOf("[data-initiative-popover]"),
                close: (h) => pressEscape(h),
            },
        ],
    };

    // a working agent whose transcript holds a TodoWrite and two background subagents (the subagents scenario's shape), shown
    // as a Cockpit card: its chips open the two popovers of agentrow.tsx
    const CARD = { name: "frost card", session: "parent", explore: "ofaexplore", plan: "ofaplan" };
    const card = {
        surface: "cockpit",
        async arrange(h, ctx) {
            ctx.dir = mkdtempSync(join(tmpdir(), "verify-ofa-card-"));
            const o = { cwd: ctx.dir };
            const spawn = (id, type, childId, prompt) => [
                AC.toolUse(id, "Agent", { subagent_type: type, description: prompt, prompt, run_in_background: true }, o),
                AC.toolResult(id, "Async agent launched successfully", {
                    toolUseResult: { isAsync: true, status: "async_launched", agentId: childId },
                    ...o,
                }),
            ];
            const todos = [
                { content: "Frost the popovers", status: "completed", activeForm: "Frosting the popovers" },
                { content: "Check the contrast", status: "in_progress", activeForm: "Checking the contrast" },
                { content: "Write the scenario", status: "pending", activeForm: "Writing the scenario" },
            ];
            ctx.path = AC.writeTranscript(ctx.dir, CARD.session, [
                AC.userText("frost the overlays and check them", o),
                AC.toolUse("toolu_ofa_todo", "TodoWrite", { todos }, o),
                AC.toolResult("toolu_ofa_todo", "Todos have been modified successfully", o),
                ...spawn("toolu_ofa_explore", "Explore", CARD.explore, "survey the popovers"),
                ...spawn("toolu_ofa_plan", "Plan", CARD.plan, "plan the scenario"),
                AC.assistantText("Both agents run in the background.", o),
            ]);
            for (const [childId, prompt] of [[CARD.explore, "survey the popovers"], [CARD.plan, "plan the scenario"]]) {
                AC.writeSubagent(ctx.dir, CARD.session, childId, [
                    AC.userText(prompt, o),
                    AC.toolUse(`toolu_${childId}_read`, "Read", { file_path: join(ctx.dir, "x.ts") }, o),
                    AC.toolResult(`toolu_${childId}_read`, "export const x = 1;", o),
                ]);
            }
            const { tabId, blockId } = await makeTab(h, ctx, { label: CARD.name });
            ctx.id = tabId;
            await AC.setRoster(h, [
                {
                    id: tabId,
                    name: CARD.name,
                    project: "fx-frost",
                    task: "frost the overlays",
                    state: "working",
                    activity: "Editing",
                    agent: "claude",
                    model: "opus",
                    activeMs: 60_000,
                    blockId,
                    transcriptPath: ctx.path,
                },
            ]);
            await h.goto("cockpit");
            // the Cockpit opens on the Office, which draws no AgentRow card: the cards view does
            ctx.prevView = await AC.agentPage(
                h,
                `const O = await mod("app/view/agents/officestore.ts");
                const prev = globalStore.get(O.cockpitViewAtom);
                globalStore.set(O.cockpitViewAtom, "cards");
                return prev;`
            );
            const up = await waitFor(h, q(`[data-agent-id="${tabId}"]`), WAIT_MS);
            if (!up) throw new Error("the fixture agent's card never showed on the Cockpit");
        },
        async teardown(h, ctx) {
            if (ctx.prevView != null) {
                await AC.agentPage(h, `const O = await mod("app/view/agents/officestore.ts"); globalStore.set(O.cockpitViewAtom, ${JSON.stringify(ctx.prevView)}); return true;`).catch(() => {});
            }
            await AC.restoreRoster(h).catch((e) => console.error(`${NAME}: restore the roster: ${e?.message ?? e}`));
            await closeTabs(h, ctx);
            rmSync(ctx.dir, { recursive: true, force: true });
        },
        sites: [
            {
                id: "subagent-peek",
                title: "the subagent peek on a card",
                async open(h, ctx) {
                    const at = await polishWaitFor(
                        h,
                        `[...(${q(`[data-agent-id="${ctx.id}"]`)}?.querySelectorAll("button") ?? [])].some((b) => /subagent/i.test(b.textContent))`,
                        WAIT_MS * 2
                    );
                    if (!at) return "the card shows no subagents chip (the transcript's two background subagents were not read)";
                    const pt = await h.ev(`(() => {
                        const b = [...${q(`[data-agent-id="${ctx.id}"]`)}.querySelectorAll("button")].find((x) => /subagent/i.test(x.textContent));
                        const r = b.getBoundingClientRect();
                        return { x: r.x + r.width / 2, y: r.y + r.height / 2 };
                    })()`);
                    await h.cdp("Input.dispatchMouseEvent", { type: "mouseMoved", x: pt.x, y: pt.y });
                    return true;
                },
                panel: (ctx) => q(`[data-agent-id="${ctx.id}"] [class~="w-[212px]"]`),
                close: (h) => h.cdp("Input.dispatchMouseEvent", { type: "mouseMoved", x: 4, y: 4 }),
            },
            {
                id: "task-popover",
                title: "the task popover on a card",
                async open(h, ctx) {
                    const found = await polishWaitFor(
                        h,
                        `[...(${q(`[data-agent-id="${ctx.id}"]`)}?.querySelectorAll("button") ?? [])].some((b) => /\\d+\\s*\\/\\s*\\d+/.test(b.textContent))`,
                        WAIT_MS * 2
                    );
                    if (!found) return "the card shows no task chip (the TodoWrite was not read)";
                    await h.ev(`[...${q(`[data-agent-id="${ctx.id}"]`)}.querySelectorAll("button")].find((b) => /\\d+\\s*\\/\\s*\\d+/.test(b.textContent)).click()`);
                    return true;
                },
                panel: (ctx) => q(`[data-agent-id="${ctx.id}"] [class~="w-[min(282px,calc(100%-20px))]"]`),
                close: (h, ctx) =>
                    h.ev(`[...${q(`[data-agent-id="${ctx.id}"]`)}.querySelectorAll("button")].find((b) => /\\d+\\s*\\/\\s*\\d+/.test(b.textContent))?.click()`),
            },
        ],
    };

    const tabs = {
        surface: "agent",
        async arrange(h, ctx) {
            const a = await makeTab(h, ctx, { label: "frost tab one" });
            const b = await makeTab(h, ctx, { label: "frost tab two" });
            const row = (t, name) => ({ id: t.tabId, name, project: "fx-frost", task: "", state: "idle", agent: "claude", model: "sonnet", blockId: t.blockId });
            await AC.setRoster(h, [row(a, "frost tab one"), row(b, "frost tab two")]);
            await h.goto("agent");
        },
        async teardown(h, ctx) {
            await AC.agentPage(h, `const T = await mod("app/view/agents/tabswitcherstore.ts"); T.closeSwitcher(); return true;`).catch(() => {});
            await AC.restoreRoster(h).catch((e) => console.error(`${NAME}: restore the roster: ${e?.message ?? e}`));
            await closeTabs(h, ctx);
        },
        sites: [
            {
                id: "tab-switcher",
                title: "the tab switcher",
                async open(h) {
                    const n = await AC.agentPage(
                        h,
                        `const T = await mod("app/view/agents/tabswitcherstore.ts");
                        const model = agentsModel();
                        const ids = [...globalStore.get(model.agentsAtom), ...globalStore.get(model.terminalsAtom)].map((a) => a.id);
                        if (ids.length < 2) return ids.length;
                        globalStore.set(T.tabSwitcherAtom, { ids, sel: 1, mod: "ctrl", shown: true });
                        return ids.length;`
                    );
                    return n >= 2 ? true : `only ${n} tab(s) to switch between`;
                },
                panel: q("[data-tab-switcher]"),
                close: (h) => AC.agentPage(h, `const T = await mod("app/view/agents/tabswitcherstore.ts"); T.closeSwitcher(); return true;`),
            },
        ],
    };

    const bg = {
        surface: "agent",
        async arrange(h, ctx) {
            ctx.sc = scenario("chat-bg-tasks");
            ctx.fx = await ctx.sc.arrange(h);
            if (ctx.fx.arrangeError != null) throw new Error(ctx.fx.arrangeError);
        },
        async teardown(h, ctx) {
            if (ctx.fx) await ctx.sc.teardown(h, ctx.fx);
        },
        sites: [
            {
                id: "background-task-peek",
                title: "the background task peek",
                async open(h, ctx) {
                    const layer = q(`[data-agent-chat="${ctx.fx.id}"]`);
                    if (!(await waitFor(h, `!!${layer}?.querySelector('[data-chat-bg="closed"]')`, WAIT_MS * 2))) return "Chat's background line never showed";
                    await click(h, `${layer}?.querySelector('[data-chat-bg="closed"]')`);
                    if (!(await waitFor(h, `!!${layer}?.querySelector('[data-chat-bg-row="shell"] button')`, WAIT_MS))) return "the list of background tasks never opened";
                    await click(h, `${layer}?.querySelector('[data-chat-bg-row="shell"] button')`);
                    return true;
                },
                panel: q('[data-testid="background-task-peek"]'),
                close: (h) => pressEscape(h),
            },
        ],
    };

    const radarOpenView = async (h) => {
        await AC.agentPage(h, `globalStore.set(agentsModel().surfaceAtom, "radar"); return true;`);
        if (!(await waitFor(h, `typeof window.__setRadarScenario === "function"`, WAIT_MS))) return "the Radar surface never mounted";
        await h.ev(`window.__setRadarScenario("results", ${JSON.stringify({ projectPath: process.cwd() })})`);
        if (!(await waitFor(h, q('[data-radar-view="report"]'), WAIT_MS))) return `the Radar fixture report never showed: ${await seen(h)}`;
        await polishNap(600);
        return true;
    };
    const radarBackdrop = (h) => click(h, q(".fixed.inset-0.z-50"));
    const radar = {
        surface: "radar",
        async arrange(h) {
            const err = await radarOpenView(h);
            if (err !== true) throw new Error(err);
        },
        async teardown(h) {
            await h.ev(`window.__setRadarScenario?.("live")`).catch(() => {});
        },
        sites: [
            {
                id: "radar-scope",
                title: "Radar's scope selector",
                open: (h) =>
                    h.ev(`(() => { const b = ${q('button[aria-label^="Scanned project:"], button[aria-label="Select a project to scan"]')}; if (!b) return "no scope selector"; b.click(); return true; })()`),
                panel: `${q('button[aria-label^="Scanned project:"], button[aria-label="Select a project to scan"]')}?.parentElement.querySelector('[style*="transform-origin"]')`,
                close: radarBackdrop,
            },
            {
                id: "radar-audits",
                title: "Radar's audited-commits popover",
                open: (h) =>
                    h.ev(`(() => { const b = ${q("[data-radar-audits-toggle]")}; if (!b) return "the report has no audits toggle"; b.click(); return true; })()`),
                panel: motionOf("[data-radar-audits-popover]"),
                close: radarBackdrop,
            },
            {
                id: "radar-dismiss",
                title: "Radar's Dismiss menu",
                open: (h) =>
                    h.ev(`(() => {
                        const b = [...document.querySelectorAll("[data-radar-finding-detail] button")].find((x) => (x.textContent || "").trim() === "Dismiss");
                        if (!b) return "the detail has no Dismiss button";
                        b.click();
                        return true;
                    })()`),
                panel: motionOf("[data-radar-dismiss-menu]"),
                close: radarBackdrop,
            },
        ],
    };

    // a registered git project: the Diff surface's menus, the sync bar's Pull confirm and the New agent dialog's pickers
    const gitCtl = {
        async pickSource(h, name) {
            const option = JSON.stringify(`[data-files-source-option=${JSON.stringify(name)}]`);
            const header = JSON.stringify(`[data-worktree-group=${JSON.stringify(name)}]`);
            return h.ev(`(async () => {
                const until = async (fn, ms) => { for (let t = 0; t < ms && !fn(); t += 100) await new Promise((r) => setTimeout(r, 100)); return fn(); };
                document.querySelector('[data-folded-source]')?.click();
                if (!document.querySelector('[data-source-picker="open"]')) {
                    if (!(await until(() => document.querySelector('[data-source-picker-trigger]'), 5000))) return false;
                    document.querySelector('[data-source-picker-trigger]').click();
                }
                if (!(await until(() => document.querySelector('[data-source-picker="open"]'), 3000))) return false;
                if (!(await until(() => document.querySelector(${option}), 1500))) {
                    const g = await until(() => document.querySelector(${header}), 5000);
                    if (g?.getAttribute("aria-expanded") === "false") g.click();
                }
                const row = await until(() => document.querySelector(${option}), 8000);
                if (!row) return false;
                row.click();
                return true;
            })()`);
        },
        // the New agent dialog on the registered project, with Claude picked
        async openLauncher(h) {
            await h.goto("cockpit");
            await click(h, q("[data-launcher-open]"));
            if (!(await waitFor(h, q("[data-launcher]"), WAIT_MS))) return "the New agent dialog never opened";
            await polishNap(500);
            await click(h, q(`[data-launcher] [data-project-row=${JSON.stringify(GIT_PROJECT)}]`));
            await click(h, q('[data-launcher] [data-start-row="claude"]'));
            await polishNap(400);
            return true;
        },
        async closeLauncher(h) {
            for (let i = 0; i < 4 && (await h.ev(`!!${q("[data-launcher]")}`)); i++) {
                await h.ev(`document.activeElement?.blur?.()`);
                await pressEscape(h);
                await polishNap(400);
            }
        },
    };
    const gitGroup = {
        surface: "files",
        async arrange(h, ctx) {
            ctx.dirs = makeRepos();
            ctx.prevRecent = await h.ev(`localStorage.getItem(${JSON.stringify(RECENT_PROJECTS_KEY)})`);
            ctx.prevIdentity = null;
            await h.rpc("createproject", { name: GIT_PROJECT, path: ctx.dirs.a });
            ctx.project = GIT_PROJECT;
            await waitForProjectInConfig(h, GIT_PROJECT);
            // the dialog reads its recent list when it mounts: the project first, so it is the one picked
            await h.ev(`localStorage.setItem(${JSON.stringify(RECENT_PROJECTS_KEY)}, ${JSON.stringify(JSON.stringify([GIT_PROJECT]))})`);
            await h.goto("files");
            if (!(await gitCtl.pickSource(h, GIT_PROJECT))) throw new Error(`source option "${GIT_PROJECT}" not in the source dropdown`);
            if (!(await waitFor(h, q("[data-sync-counts]"), 15_000))) throw new Error(`the Diff surface never read the repository: ${await seen(h)}`);
        },
        async teardown(h, ctx) {
            const step = async (what, fn) => {
                try {
                    await fn();
                } catch (e) {
                    console.error(`${NAME} teardown: ${what} failed: ${e?.message ?? e}`);
                }
            };
            await step("close the dialog", () => gitCtl.closeLauncher(h));
            await step("clear the DEV agents override", () => h.ev(`(delete window.__syncWorkingAgents, true)`));
            await step("restore the Claude identity", () =>
                ctx.prevIdentity == null
                    ? undefined
                    : AC.agentPage(h, `const R = await mod("app/view/agents/ratelimitstore.ts"); R.setClaudeIdentity(${JSON.stringify(ctx.prevIdentity)}); return true;`)
            );
            await step("restore the recent projects", () =>
                h.ev(
                    ctx.prevRecent == null
                        ? `localStorage.removeItem(${JSON.stringify(RECENT_PROJECTS_KEY)})`
                        : `localStorage.setItem(${JSON.stringify(RECENT_PROJECTS_KEY)}, ${JSON.stringify(ctx.prevRecent)})`
                )
            );
            if (ctx.project) {
                await step("remove the project", async () => {
                    await h.rpc("deleteproject", { name: ctx.project });
                    const norm = (s) => (s || "").replace(/\\/g, "/").replace(/\/+$/, "").toLowerCase();
                    const channels = (await h.rpc("getchannels", null))?.channels ?? [];
                    for (const c of channels.filter((c) => norm(c.projectpath) === norm(ctx.dirs.a))) {
                        await h.rpc("deletechannel", { channelid: c.oid });
                    }
                });
            }
            await step("remove the repos", () => rmSync(ctx.dirs.base, { recursive: true, force: true }));
        },
        sites: [
            {
                id: "diff-options",
                title: "the Diff pane's View options menu",
                async open(h) {
                    if (!(await waitFor(h, q("[data-diff-options]"), WAIT_MS))) return "the Diff pane shows no View options button";
                    await click(h, q("[data-diff-options]"));
                    return true;
                },
                panel: `${q("[data-diff-options]")}?.parentElement.querySelector('[role="menu"]')`,
                close: (h) => click(h, q("[data-diff-options]")),
            },
            {
                id: "source-picker",
                title: "the Diff surface's source picker",
                open: (h) =>
                    h.ev(`(() => { const t = ${q("[data-source-picker-trigger]")}; if (!t) return "no source picker trigger"; t.click(); return true; })()`),
                panel: q('[data-source-picker="open"]'),
                close: (h) => click(h, q("[data-source-picker-trigger]")),
            },
            {
                id: "ref-picker",
                title: "the compare bar's ref suggestions",
                async open(h) {
                    await click(h, q('[data-panel-tab="log"]'));
                    if (!(await waitFor(h, q("[data-compare-button]"), WAIT_MS))) return "the Log tab has no Compare button";
                    await click(h, q("[data-compare-button]"));
                    if (!(await waitFor(h, q("[data-compare-bar]"), WAIT_MS))) return "compare never opened";
                    if (await h.ev(`!!${q("[data-ref-pair]")}`)) await click(h, q("[data-ref-pair]"));
                    if (!(await waitFor(h, q("[data-compare-bar] input"), 5000))) return "the ref fields never opened";
                    // a dev app window in the background never fires focus events: emulate a focused page, then focus the field
                    await h.cdp("Emulation.setFocusEmulationEnabled", { enabled: true }).catch(() => {});
                    await h.ev(`document.activeElement?.blur()`);
                    await h.ev(`${q("[data-compare-bar] input")}?.focus()`);
                    return true;
                },
                panel: motionOf("[data-ref-suggestion]"),
                async close(h) {
                    await h.ev(`document.activeElement?.blur()`);
                    await pressEscape(h);
                    await h.cdp("Emulation.setFocusEmulationEnabled", { enabled: false }).catch(() => {});
                },
            },
            {
                id: "pull-confirm",
                title: "the sync bar's Confirm pull popover",
                async open(h, ctx) {
                    const wait = (expr, ms = 15_000) => waitFor(h, expr, ms);
                    const counts = () => `(${q("[data-sync-counts]")}?.textContent || "").trim()`;
                    // B pushes a commit, and an agent is "working here", so Pull asks first
                    git(ctx.dirs.b, "pull", "-q", "--ff-only");
                    writeFileSync(join(ctx.dirs.b, "b1.txt"), "b one\n");
                    git(ctx.dirs.b, "add", "b1.txt");
                    git(ctx.dirs.b, "commit", "-q", "-m", "add b1");
                    git(ctx.dirs.b, "push", "-q");
                    await h.ev(`window.__syncWorkingAgents = ["fixture agent"]`);
                    await click(h, q('[data-sync="fetch"]'));
                    await wait(`${q('[data-sync="fetch"]')} && !${q('[data-sync="fetch"] .animate-spin')}`);
                    if (!(await wait(`${counts()} === "↑0 ↓1"`))) return `after Fetch the counts read ${await h.ev(counts())}, not ↑0 ↓1`;
                    await click(h, q('[data-sync="pull"]'));
                    return true;
                },
                panel: q("[data-pull-confirm]"),
                close: (h) => click(h, q("[data-pull-confirm-no]")),
            },
            {
                id: "launcher-branch-list",
                title: "the New agent dialog's branch list",
                dialog: true,
                async open(h) {
                    const up = await gitCtl.openLauncher(h);
                    if (up !== true) return up;
                    await click(h, q('[data-launcher-task-row] button[role="switch"]'));
                    if (!(await waitFor(h, q("[data-launcher-branch-row]"), 5000))) return "the Worktree switch did not open the branch row";
                    await h.cdp("Emulation.setFocusEmulationEnabled", { enabled: true }).catch(() => {});
                    await h.ev(`document.activeElement?.blur?.(); ${q("#launcher-branch")}?.focus()`);
                    return true;
                },
                panel: motionOf("[data-launcher-branch-row] button[type=button]:not([aria-label])"),
                async close(h) {
                    await gitCtl.closeLauncher(h);
                    await h.cdp("Emulation.setFocusEmulationEnabled", { enabled: false }).catch(() => {});
                },
            },
            {
                id: "launcher-account-menu",
                title: "the New agent dialog's account menu",
                dialog: true,
                async open(h, ctx) {
                    // the menu needs a token account besides the login one
                    ctx.prevIdentity = await AC.agentPage(
                        h,
                        `const R = await mod("app/view/agents/ratelimitstore.ts");
                        const prev = globalStore.get(R.claudeIdentityAtom);
                        R.setClaudeIdentity({ loginEmail: "frost@example.com", accounts: [{ id: "a-frost", label: "Frost work", email: "work@example.com" }] });
                        return prev;`
                    );
                    const up = await gitCtl.openLauncher(h);
                    if (up !== true) return up;
                    if (!(await waitFor(h, q('[data-launcher-footer="account"]'), 5000))) return "the footer shows no account picker";
                    await click(h, q('[data-launcher-footer="account"]'));
                    return true;
                },
                panel: q("[data-launcher-account-menu]"),
                close: (h) => gitCtl.closeLauncher(h),
            },
        ],
    };

    const canvas = {
        surface: "agent",
        async arrange(h, ctx) {
            ctx.sc = scenario("canvas-versions");
            ctx.fx = await ctx.sc.arrange(h);
            if (ctx.fx.arrangeError != null) throw new Error(ctx.fx.arrangeError);
        },
        async teardown(h, ctx) {
            if (ctx.fx) await ctx.sc.teardown(h, ctx.fx);
        },
        sites: [
            {
                id: "canvas-link-picker",
                title: "the canvas viewer's Link an older version picker",
                async open(h) {
                    await h.goto("agent");
                    await click(h, q("[data-agent-canvases-open]"));
                    if (!(await waitFor(h, q("[data-canvas-grid]"), WAIT_MS))) return `the canvas gallery never opened: ${await seen(h)}`;
                    const wrap = q('[data-canvas-card-wrap="vs-home"]');
                    await waitFor(h, `!!${wrap}`, WAIT_MS);
                    await h.ev(`${wrap}?.scrollIntoView({ block: "center" })`);
                    await click(h, `${wrap}?.querySelector("[data-canvas-newer]")`);
                    if (!(await waitFor(h, q("[data-canvas-link-open]"), WAIT_MS))) return "the newer canvas's viewer never opened";
                    await click(h, q("[data-canvas-link-open]"));
                    return true;
                },
                panel: q("[data-canvas-link-picker]"),
                close: (h) => pressEscape(h),
            },
        ],
    };

    // the final-stage scenario's run and lead, then its stage seeded to the Tree step so End final stage is on offer
    const FST = { check: "node --stack-size=4000 node_modules/typescript/lib/tsc.js --noEmit", verify: "node scripts/verify.mjs ./pkg/waveobj" };
    const finalGroup = {
        surface: "agent",
        async arrange(h, ctx) {
            ctx.sc = scenario("final-stage");
            ctx.fx = await ctx.sc.arrange(h);
            if (ctx.fx.arrangeError != null) throw new Error(ctx.fx.arrangeError);
            if (!ctx.fx.leadFocused) throw new Error("the run's lead never took focus");
        },
        async teardown(h, ctx) {
            if (ctx.fx) await ctx.sc.teardown(h, ctx.fx);
        },
        sites: [
            {
                id: "end-final-stage",
                title: "the End final stage popover",
                async open(h, ctx) {
                    const fx = ctx.fx;
                    const oref = `dag:${fx.dagId}`;
                    const seed = async () => {
                        const dag = await waveService(h, "object", "GetObject", [oref]);
                        const { final: _f, pastfinals: _p, check: _c, verify: _v, finalcmd: _fc, ...rest } = dag;
                        const now = Date.now();
                        const next = {
                            ...rest,
                            otype: "dag",
                            check: FST.check,
                            verify: FST.verify,
                            finalcmd: "true",
                            final: { state: "checking", round: 1, step: "tree", stepts: now - 22_000, startedts: now - 22_000 },
                        };
                        await waveService(h, "object", "UpdateObject", [next, false], { windowid: "", activetabid: "" });
                        // UpdateObject publishes nothing; a meta write sends the whole stored dag to the page
                        fx.seeds = (fx.seeds ?? 0) + 1;
                        await h.rpc("setmeta", { oref, meta: { "verify:ofa-seed": fx.seeds } });
                    };
                    await seed();
                    // a watchdog tick that read the dag before the seed writes its own over it: seed again until the row shows
                    for (let i = 0; i < 6 && !(await waitFor(h, q("[data-final-row]"), 5000)); i++) await seed();
                    if (!(await h.ev(`!!${q("[data-final-row]")}`))) return `the final stage's row never showed in the Agent tree: ${await seen(h)}`;
                    await click(h, q("[data-final-row]"));
                    if (!(await waitFor(h, q("[data-final-pane] [data-final-end]"), WAIT_MS))) return `the final stage's pane has no End final stage button: ${await seen(h)}`;
                    await click(h, q("[data-final-pane] [data-final-end]"));
                    return true;
                },
                panel: `${q("[data-run-sheet-end-final]")}?.parentElement`,
                close: (h) =>
                    h.ev(`[...(${q("[data-run-sheet-end-final]")}?.querySelectorAll("button") ?? [])].find((b) => (b.textContent || "").trim() === "Keep running")?.click()`),
            },
        ],
    };

    const GROUPS = [plain, initiative, card, tabs, bg, radar, gitGroup, canvas, finalGroup];

    // --- the check ---------------------------------------------------------------------------------------------------

    const panelExpr = (site, ctx) => (typeof site.panel === "function" ? site.panel(ctx) : site.panel);

    async function verifySite(h, ctx, site, n) {
        const title = `${n}. ${site.title}: the panel draws the frost (blur(18px) over --color-panel) with no backdrop root above it`;
        const opened = await site.open(h, ctx);
        if (opened !== true) return { step: title, ok: false, detail: `could not open it: ${opened}` };
        const panel = panelExpr(site, ctx);
        if (!(await waitFor(h, `!!(${panel})`, WAIT_MS))) return { step: title, ok: false, detail: "its panel never showed" };
        await h.ev(`(() => {
            document.querySelectorAll("[data-ofa-panel]").forEach((n) => n.removeAttribute("data-ofa-panel"));
            (${panel}).setAttribute("data-ofa-panel", "");
        })()`);
        // the reveal ends (its opacity is 1) and, in a dialog, the scrim has finished its own fade
        let r;
        for (let waited = 0; ; waited += 120) {
            r = await h.ev(frostProbe(PANEL));
            const opacity = r.found ? await h.ev(`Number(getComputedStyle(${q(PANEL)}).opacity)`) : 0;
            const clear = r.blockedBy == null || (site.dialog && DIALOG_SCRIM.test(r.blockedBy));
            if ((opacity >= 0.99 && clear) || waited >= SETTLE_MS) break;
            await polishNap(120);
        }
        const underScrim = site.dialog && r.blockedBy != null && DIALOG_SCRIM.test(r.blockedBy);
        const { ok, detail } = frostVerdict(underScrim ? { ...r, blockedBy: null } : r);
        await h.shot(`cdp-shots/${NAME}-${site.id}.png`);
        return { step: title, ok, detail: underScrim ? `${detail} (the dialog's scrim is its backdrop root: it frosts the dialog panel)` : detail };
    }

    return [
        {
            name: NAME,
            surface: "cockpit",
            async arrange() {
                return {};
            },
            async assert(h) {
                const steps = [];
                let n = 1;
                for (const group of GROUPS) {
                    const ctx = {};
                    let arranged = true;
                    try {
                        await h.goto(group.surface === "radar" ? "cockpit" : group.surface);
                        await group.arrange?.(h, ctx);
                    } catch (e) {
                        arranged = false;
                        for (const site of group.sites) {
                            steps.push({ step: `${n++}. ${site.title}: the panel draws the frost`, ok: false, detail: `its fixture failed: ${String(e?.message ?? e)}` });
                        }
                    }
                    if (arranged) {
                        for (const site of group.sites) {
                            try {
                                steps.push(await verifySite(h, ctx, site, n));
                            } catch (e) {
                                steps.push({ step: `${n}. ${site.title}: the panel draws the frost`, ok: false, detail: `the step threw: ${String(e?.message ?? e)}` });
                            }
                            n++;
                            try {
                                await site.close?.(h, ctx);
                                await polishNap(300);
                            } catch (e) {
                                console.error(`${NAME}: closing ${site.id} failed: ${e?.message ?? e}`);
                            }
                        }
                    }
                    try {
                        await group.teardown?.(h, ctx);
                    } catch (e) {
                        // a leaked fixture fails the run: the next group and the next run start on what this one left
                        steps.push({ step: `teardown of the ${group.sites[0].id} group`, ok: false, detail: String(e?.message ?? e) });
                    }
                }
                return steps;
            },
            async teardown(h) {
                await h.ev(`document.querySelectorAll("[data-ofa-panel]").forEach((n) => n.removeAttribute("data-ofa-panel"))`).catch(() => {});
                await h.goto("cockpit");
            },
        },
    ];
};
