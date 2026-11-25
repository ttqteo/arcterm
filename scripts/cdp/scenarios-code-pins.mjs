// code-pins: the Code surface's pinned files, kept in the workspace's `code:pins` meta (frontend/app/view/code/
// codepinsstore.ts), shown at the top of the Agent panel's Files tab (railtreepane.tsx PinnedFiles). One fixture agent
// with no shell (a made-up block id) works in a seeded git repo, its cwd read from a one-line transcript, as the
// rail-worktree-files scenario's agent B does. The roster goes in the page's dev mock roster, so nothing reloads to set it.
//
// Steps: pin (the File tab's pin button writes the meta, and the file heads the Files tab under Pinned), unpin (the
// button again: the key leaves the meta and Pinned goes), external (a SetMetaCommand from outside the page, as
// `wsh setmeta -b workspace:<oid> --json -` sends, redraws Pinned in the map's order with no reload), migrate (pins
// localStorage still holds under `code.pins` move into a workspace without any on load, and the key is removed).
//
// DOM contract: the rail is aside[aria-label="Agent details"]; its tabs [data-rail-tab="tree"|"file"]; the tree
// [data-rail-tree] with rows [data-rail-tree-row="<rel>"]; the Pinned section [data-rail-pinned] with rows
// [data-rail-pinned-row="<rel>"]; the File tab's pin button [data-file-pin][aria-pressed].
//
// Teardown puts back the workspace's `code:pins` and localStorage `code.pins` as they were, the page's roster, and removes
// the temp directory.

import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import * as AC from "./agent-page-fixtures.mjs";

const NAME = "code-pins";
const AGENT = "fx-code-pins";
const BLOCK = "fx-blk-code-pins";
const WAIT_MS = 15_000;
const LEGACY_KEY = "code.pins";
const ASIDE = `document.querySelector('aside[aria-label="Agent details"]')`;
const PINNED_ROWS = `[...(${ASIDE}?.querySelectorAll("[data-rail-pinned-row]") ?? [])].map((r) => r.getAttribute("data-rail-pinned-row"))`;
const shot = (h, step) => h.shot(`cdp-shots/${NAME}-${step}.png`);

function seed(base) {
    const repo = join(base, "repo");
    const logs = join(base, "transcripts");
    mkdirSync(repo);
    mkdirSync(logs);
    const git = (...args) => execFileSync("git", ["-C", repo, "-c", "user.email=v@v", "-c", "user.name=v", ...args], { stdio: "pipe" });
    git("init", "-q", "--initial-branch=main");
    mkdirSync(join(repo, "paper"));
    writeFileSync(join(repo, "paper", "main.tex"), "\\documentclass{article}\n");
    writeFileSync(join(repo, "refs.bib"), "@misc{a}\n");
    writeFileSync(join(repo, "README.md"), "# thesis\n");
    git("add", ".");
    git("commit", "-qm", "seed");
    const transcript = join(logs, "pins.jsonl");
    const prompt = { type: "user", message: { role: "user", content: [{ type: "text", text: "pin the paper" }] } };
    writeFileSync(transcript, JSON.stringify({ cwd: repo, ...prompt }) + "\n");
    return { repo, transcript };
}

const roster = (ctx) => [
    {
        id: AGENT,
        name: "pins agent",
        blockId: BLOCK,
        transcriptPath: ctx.transcript,
        project: "verify-code-pins",
        task: "pin the paper",
        state: "idle",
        agent: "claude",
        model: "opus",
        idleSince: Date.now() - 60_000,
    },
];

// the workspace's meta value of `code:pins`, as the page holds it
const pageMeta = (h) => AC.agentPage(h, `return globalStore.get(window.globalAtoms.workspace)?.meta?.["code:pins"] ?? null;`);
// a pins map with its project paths in one spelling, whichever way the app wrote the separators and the drive letter
const norm = (pins) =>
    pins == null ? null : JSON.stringify(Object.entries(pins).map(([k, v]) => [k.replace(/\\/g, "/").toLowerCase(), v]));
// polls the page's meta until it holds `want` (null: no key)
async function metaIs(h, want, ms = WAIT_MS) {
    for (const end = Date.now() + ms; Date.now() < end; ) {
        if (norm(await pageMeta(h).catch(() => undefined)) === norm(want)) return true;
        await new Promise((done) => setTimeout(done, 200));
    }
    return false;
}

export default function (kit) {
    const { polishWaitFor, ahReload, UI_ROUTE } = kit;

    // the fixture agent shown, its panel open on the Files tab, the tree drawn
    const showFiles = async (h, ctx) => {
        await AC.setRoster(h, roster(ctx));
        await h.goto("agent");
        if (!(await polishWaitFor(h, `!!document.querySelector('[data-agent-terminal="${AGENT}"]')`, WAIT_MS))) return false;
        await h.rpc("uireveal", { address: `agent:${AGENT}` }, UI_ROUTE);
        await AC.agentPage(
            h,
            `const { railVisibleAtom } = await mod("app/view/agents/railstore.ts");
            globalStore.set(railVisibleAtom, true);
            return true;`
        );
        for (let waited = 0; waited < WAIT_MS * 4; waited += 1500) {
            await h.ev(`${ASIDE}?.querySelector('[data-rail-tab="tree"]')?.click()`);
            if (await polishWaitFor(h, `!!${ASIDE}?.querySelector('[data-rail-tree-row="README.md"]')`, 1500)) return true;
        }
        return false;
    };
    const setPins = (h, ctx, pins) => h.rpc("setmeta", { oref: `workspace:${ctx.workspaceId}`, meta: { "code:pins": pins } });
    const pinnedIs = (h, rels) => polishWaitFor(h, `JSON.stringify(${PINNED_ROWS}) === ${JSON.stringify(JSON.stringify(rels))}`, WAIT_MS);

    return [
        {
            name: NAME,
            surface: "agent",
            async arrange(h) {
                const base = mkdtempSync(join(tmpdir(), "vcp-"));
                const ctx = { base };
                try {
                    Object.assign(ctx, seed(base));
                    ctx.workspaceId = await AC.agentPage(h, `return globalStore.get(window.globalAtoms.workspace)?.oid ?? null;`);
                    if (ctx.workspaceId == null) throw new Error("the page has no workspace");
                    ctx.prevMeta = await pageMeta(h);
                    ctx.prevLegacy = await h.ev(`localStorage.getItem(${JSON.stringify(LEGACY_KEY)})`);
                    await h.ev(`localStorage.removeItem(${JSON.stringify(LEGACY_KEY)})`);
                    await setPins(h, ctx, null);
                    ctx.ready = await showFiles(h, ctx);
                } catch (e) {
                    ctx.arrangeError = String(e?.message ?? e);
                }
                return ctx;
            },
            async assert(h, ctx) {
                const steps = [];
                const rec = (step, ok, detail) => steps.push({ step, ok: ok === true, detail: JSON.stringify(detail) });
                rec("0. the fixture agent's Files tab shows its repo", ctx.ready === true && ctx.arrangeError == null, {
                    arrangeError: ctx.arrangeError,
                });
                if (ctx.ready !== true) return steps;
                try {
                    // 1. pin: open paper/main.tex in the File tab and press its pin
                    await h.ev(`${ASIDE}?.querySelector('[data-rail-tree-row="paper"]')?.click()`);
                    await polishWaitFor(h, `!!${ASIDE}?.querySelector('[data-rail-tree-row="paper/main.tex"]')`, WAIT_MS);
                    await h.ev(`${ASIDE}?.querySelector('[data-rail-tree-row="paper/main.tex"]')?.dispatchEvent(new MouseEvent("dblclick", { bubbles: true }))`);
                    const pinBtn = `${ASIDE}?.querySelector("[data-file-pin]")`;
                    const hasBtn = await polishWaitFor(h, `!!${pinBtn}`, WAIT_MS);
                    await h.ev(`${pinBtn}?.click()`);
                    const pressed = await polishWaitFor(h, `${pinBtn}?.getAttribute("aria-pressed") === "true"`, WAIT_MS);
                    const metaPinned = await metaIs(h, { [ctx.repo]: ["paper/main.tex"] });
                    const server = await h.rpc("getmeta", { oref: `workspace:${ctx.workspaceId}` });
                    await h.ev(`${ASIDE}?.querySelector('[data-rail-tab="tree"]')?.click()`);
                    const listed = await pinnedIs(h, ["paper/main.tex"]);
                    await shot(h, "1-pinned");
                    rec("1. the pin button writes code:pins to the workspace, and Pinned lists the file", hasBtn && pressed && metaPinned && listed, {
                        hasBtn,
                        pressed,
                        metaPinned,
                        server: server?.["code:pins"] ?? null,
                        rows: await h.ev(PINNED_ROWS),
                    });

                    // 2. unpin: the same button in the File tab
                    await h.ev(`${ASIDE}?.querySelector('[data-rail-tab="file"]')?.click()`);
                    await polishWaitFor(h, `${pinBtn}?.getAttribute("aria-pressed") === "true"`, WAIT_MS);
                    await h.ev(`${pinBtn}?.click()`);
                    const metaGone = await metaIs(h, null);
                    const serverGone = (await h.rpc("getmeta", { oref: `workspace:${ctx.workspaceId}` }))?.["code:pins"] ?? null;
                    await h.ev(`${ASIDE}?.querySelector('[data-rail-tab="tree"]')?.click()`);
                    const sectionGone = await polishWaitFor(h, `!${ASIDE}?.querySelector("[data-rail-pinned]")`, WAIT_MS);
                    rec("2. unpinning the last file removes code:pins and the Pinned section", metaGone && serverGone == null && sectionGone, {
                        metaGone,
                        serverGone,
                        sectionGone,
                    });

                    // 3. external: a write from outside the page, in an order of its own
                    await h.ev(`window.__codePinsMark = true`);
                    await setPins(h, ctx, { [ctx.repo]: ["refs.bib", "paper/main.tex"] });
                    const live = await pinnedIs(h, ["refs.bib", "paper/main.tex"]);
                    const noReload = await h.ev(`window.__codePinsMark === true`);
                    await shot(h, "3-external");
                    await setPins(h, ctx, { [ctx.repo]: ["README.md"] });
                    const liveAgain = await pinnedIs(h, ["README.md"]);
                    await setPins(h, ctx, null);
                    const liveCleared = await polishWaitFor(h, `!${ASIDE}?.querySelector("[data-rail-pinned]")`, WAIT_MS);
                    rec("3. code:pins set from outside redraws Pinned live, in its order, with no reload", live && noReload && liveAgain && liveCleared, {
                        live,
                        noReload,
                        liveAgain,
                        liveCleared,
                        rows: await h.ev(PINNED_ROWS),
                    });

                    // 4. migrate: the old localStorage pins, a workspace without any, a reload
                    const legacy = JSON.stringify({ [ctx.repo]: ["paper/main.tex", "refs.bib"] });
                    await h.ev(`localStorage.setItem(${JSON.stringify(LEGACY_KEY)}, ${JSON.stringify(legacy)})`);
                    const reloaded = await ahReload(h);
                    const migrated = await metaIs(h, { [ctx.repo]: ["paper/main.tex", "refs.bib"] });
                    const keyGone = await polishWaitFor(h, `localStorage.getItem(${JSON.stringify(LEGACY_KEY)}) === null`, WAIT_MS);
                    const shown = (await showFiles(h, ctx)) && (await pinnedIs(h, ["paper/main.tex", "refs.bib"]));
                    await shot(h, "4-migrated");
                    rec("4. localStorage pins move into the workspace on load, the old key goes, Pinned lists them", reloaded && migrated && keyGone && shown, {
                        reloaded,
                        migrated,
                        keyGone,
                        shown,
                        meta: await pageMeta(h),
                    });
                } catch (e) {
                    rec("the steps ran to the end", false, String(e?.message ?? e));
                }
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
                if (ctx.workspaceId != null) {
                    await step("restore code:pins", () => setPins(h, ctx, ctx.prevMeta ?? null));
                }
                await step("restore localStorage code.pins", () =>
                    h.ev(
                        ctx.prevLegacy == null
                            ? `localStorage.removeItem(${JSON.stringify(LEGACY_KEY)})`
                            : `localStorage.setItem(${JSON.stringify(LEGACY_KEY)}, ${JSON.stringify(ctx.prevLegacy)})`
                    )
                );
                await step("restore the roster", () => AC.restoreRoster(h));
                await step("remove the temp dir", () => rmSync(ctx.base, { recursive: true, force: true, maxRetries: 5, retryDelay: 500 }));
            },
        },
    ];
}
