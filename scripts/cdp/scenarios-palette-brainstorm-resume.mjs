// palette-brainstorm-resume: the command palette's Resume brainstorm picker (Task 8 of
// docs/superpowers/plans/2026-11-06-kael-sync-surfaces.md). A registered project holds three brainstorms, two open (never
// approved) and one approved (done), the approved one the newest file of the three so that leaving it out is the rule at
// work and not its age. The steps:
//   1. Commands → Resume brainstorm… lists the two open ones, newest first, each with its title, the open question and its
//      age and project; the approved one is not there.
//   2. The older row's alt (Mod+Enter, the row's own second action; no key handler of the picker's) dismisses it: the row
//      goes and an empty `dismissed` file sits beside its brainstorm.json, none beside the other.
//   3. Enter on the row left starts the default runtime on the resume prompt in the project and attaches the brainstorm
//      file to the new tab (session:brainstorm), and the new agent's brainstorm pane shows that brainstorm.
// Step 3 would start a real agent (the harness's default runtime, on a prompt that has it read and carry on the file), so
// the page's rpc client is wrapped for it: the block's start request (setmeta with controller "cmd") is recorded and
// replaced by a plain shell in ~, as openCanvasTerminal makes its terminal, and the tab's own setmeta is recorded. What the
// start asked for (the command's last argument is the resume prompt on the chosen file, in the project's folder, no
// worktree) is judged from that record; the pane is judged from the tab's meta, which is the real write.
//
// kit is scenarios.mjs's BS_KIT. What brainstorm-mode's arrange and steps use that the kit lacks is duplicated here, not added
// to scenarios.mjs: the palette's input and keys, the Mod key, and the read of the palette's rows.

import { existsSync, mkdirSync, mkdtempSync, rmSync, statSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

const NAME = "palette-brainstorm-resume";
const PROJECT = "verify-palette-bsresume";
// the topics' own folder names; the files' titles are what the rows show
const OPEN_NEW = "retry-policy";
const OPEN_OLD = "search-cache";
const APPROVED = "importer-approved";
const TITLES = {
    [OPEN_NEW]: "Retry policy for the importer",
    [OPEN_OLD]: "Cache layer for search",
    [APPROVED]: "Importer batching, approved",
};
const QUESTIONS = {
    [OPEN_NEW]: { n: 6, text: "Which retry policy should the importer use when the source rate-limits it?", part: "intent" },
    [OPEN_OLD]: { n: 2, text: "Where should the search cache live?", part: "intent" },
};
// ages: the approved file is the newest, then the open pair three hours and two days old
const HOUR_MS = 3_600_000;
const AGE_MS = { [APPROVED]: 0.5 * HOUR_MS, [OPEN_NEW]: 3 * HOUR_MS, [OPEN_OLD]: 48 * HOUR_MS };
const AGE_TEXT = { [OPEN_NEW]: "3h", [OPEN_OLD]: "2d" };
const DISMISS_ECHO = "Dismisses it until it next changes";

const ON_MAC = process.platform === "darwin";
// Mod is Command on a Mac and Control elsewhere, as the picker's Mod+Enter reads it
const MOD_KEY = ON_MAC ? { metaKey: true } : { ctrlKey: true };
const PALETTE_INPUT = `document.querySelector('input[data-palette-input]')`;
const PALETTE = `${PALETTE_INPUT}?.closest('[role="dialog"]')`;
// React reads keys off the input's own keydown, so they are dispatched there rather than relying on page focus
const paletteKey = (key, mods = {}) => `(() => {
    const el = ${PALETTE_INPUT};
    if (!el) return false;
    el.dispatchEvent(new KeyboardEvent('keydown', { ...${JSON.stringify(mods)}, key: ${JSON.stringify(key)}, code: ${JSON.stringify(key)}, bubbles: true }));
    return true;
})()`;
// the drill's chip, the rows with their keys, the group labels and the footer's lines, as the palette draws them
const READ = `(() => {
    const flat = (el) => (el?.textContent ?? "").replace(/\\s+/g, " ").trim();
    const d = ${PALETTE};
    if (!d) return null;
    const list = d.querySelector('[role="listbox"][aria-label="Results"]');
    return {
        chip: flat(d.querySelector('button[aria-label="Back to all commands"]')),
        placeholder: d.querySelector('input[data-palette-input]')?.placeholder ?? null,
        labels: [...(list?.children ?? [])].map((g) => flat(g.firstElementChild)),
        rows: [...(list?.querySelectorAll("button[data-idx]") ?? [])].map((b) => ({
            key: b.getAttribute("data-palette-key"),
            text: flat(b),
            selected: b.getAttribute("aria-selected") === "true",
        })),
        list: flat(list),
        dialog: flat(d),
    };
})()`;

// records what the page asks the backend to start, and starts a plain shell in ~ instead (see the head of this file)
const START_INSTALL = `(() => {
    const c = window.TabRpcClient;
    if (!c) return false;
    if (c.__bsStartOrig) return true;
    c.__bsStartOrig = c.wshRpcCall;
    const call = c.wshRpcCall.bind(c);
    window.__bsStarts = { block: [], tab: [] };
    c.wshRpcCall = (command, data, opts) => {
        if (command === "setmeta" && data?.meta?.controller === "cmd") {
            window.__bsStarts.block.push({ oref: data.oref, meta: JSON.parse(JSON.stringify(data.meta)) });
            return call(command, { ...data, meta: { view: "term", controller: "shell", "cmd:cwd": "~" } }, opts);
        }
        if (command === "setmeta" && String(data?.oref ?? "").startsWith("tab:") && data?.meta?.["session:brainstorm"]) {
            window.__bsStarts.tab.push({ oref: data.oref, meta: JSON.parse(JSON.stringify(data.meta)) });
        }
        return call(command, data, opts);
    };
    return true;
})()`;
const START_REMOVE = `(() => {
    const c = window.TabRpcClient;
    if (c?.__bsStartOrig) {
        c.wshRpcCall = c.__bsStartOrig;
        delete c.__bsStartOrig;
    }
    delete window.__bsStarts;
    return true;
})()`;
const STARTS = `window.__bsStarts ?? { block: [], tab: [] }`;

// one file spelled two ways: a path on Windows reads back with either slash, and the file system ignores case
const norm = (p) => String(p ?? "").replace(/[\\/]+/g, "/").replace(/\/+$/, "").toLowerCase();
const sameKeys = (got, want) => JSON.stringify(got.map(norm)) === JSON.stringify(want.map(norm));

export default function (kit) {
    const { bsFile, bsParts, bsShowPane, bsTabMeta, bsPublishStatus, bsUntil, polishNap, polishReload, polishWaitFor, skipStep, waitForProjectInConfig, waveService, openPalette, BS_SWITCH } = kit;

    const fileOf = (ctx, topic) => join(ctx.cwd, ".superpowers", "brainstorm", topic, "brainstorm.json");
    const keyOf = (ctx, topic) => `brainstorm:${fileOf(ctx, topic)}`;
    const resumePrompt = (path) => `Resume the brainstorm in ${path} with arc:brainstorm.`;

    // an unfinished brainstorm: its open question, and the intent part asked and empty, as a brainstorm just begun
    const openFile = (topic) =>
        bsFile({
            title: TITLES[topic],
            canvas: undefined,
            question: QUESTIONS[topic],
            parts: bsParts({ intent: "asked" }, { intent: { body: "" } }),
        });
    // an approved one: the agent done, every part yours, no question
    const doneFile = () =>
        bsFile({
            title: TITLES[APPROVED],
            canvas: undefined,
            done: true,
            question: null,
            parts: bsParts({ intent: "yours" }),
        });

    // polls the palette until want(read) holds; the last read and whether it did
    async function until(h, want, ms = 5000) {
        const start = Date.now();
        let r = null;
        do {
            r = await h.ev(READ).catch(() => null);
            if (r != null && want(r)) return { ...r, ok: true };
            await polishNap(200);
        } while (Date.now() - start < ms);
        return { ...(r ?? {}), ok: false };
    }
    const rowKeys = (r) => (r.rows ?? []).map((x) => x.key);

    const scenario = {
        name: NAME,
        surface: "agent",
        async arrange(h) {
            const cwd = mkdtempSync(join(tmpdir(), "verify-palette-bsresume-"));
            const ctx = { cwd };
            // a throw past this point still returns ctx, so teardown removes whatever was already made
            try {
                const now = Date.now();
                for (const topic of [OPEN_NEW, OPEN_OLD, APPROVED]) {
                    const file = fileOf(ctx, topic);
                    mkdirSync(dirname(file), { recursive: true });
                    writeFileSync(file, JSON.stringify(topic === APPROVED ? doneFile() : openFile(topic), null, 2));
                    // the list orders by the file's own modification time
                    const at = new Date(now - AGE_MS[topic]);
                    utimesSync(file, at, at);
                }
                // the workspace of the page's own tab, so the resumed agent's tab lands in the window under test
                const bootTab = String(await h.ev("window.TabRpcClient.routeId")).replace(/^tab:/, "");
                const wslist = await h.rpc("workspacelist", null);
                const ws = wslist.find((w) => (w.workspacedata?.tabids ?? []).includes(bootTab)) ?? wslist[0];
                ctx.workspaceId = ws.workspacedata.oid;
                // the picker lists the registered projects' brainstorms; createproject only writes projects.json, and the
                // frontend reads the project list at boot
                await h.rpc("createproject", { name: PROJECT, path: cwd });
                ctx.project = PROJECT;
                await waitForProjectInConfig(h, PROJECT);
                await polishReload(h);
                await h.goto("agent");
            } catch (e) {
                ctx.arrangeError = String(e?.message ?? e);
            }
            return ctx;
        },
        async assert(h, ctx) {
            if (ctx.arrangeError != null) return [skipStep(NAME, `could not verify: ${ctx.arrangeError}`)];
            const steps = [];
            const rec = (step, ok, detail) => steps.push({ step, ok, detail: typeof detail === "string" ? detail : JSON.stringify(detail) });

            // 1. Commands → Resume brainstorm…: the open ones, newest first, with question, age and project; not the approved
            if (!(await openPalette(h))) return [skipStep(NAME, "could not verify: the palette did not open")];
            // the input takes the keyboard a frame after it opens
            await polishWaitFor(h, `document.activeElement === ${PALETTE_INPUT}`, 2000);
            // "c:" narrows to Commands; the drill row is the best match for what follows, so it is the selected one
            await h.cdp("Input.insertText", { text: "c:resume brainstorm" });
            const drillRow = await until(h, (r) => (r.rows ?? []).some((x) => x.key === "cmd:resume-brainstorm" && x.selected));
            const entered = await h.ev(paletteKey("Enter"));
            const picker = await until(h, (r) => r.chip.includes("Brainstorm") && rowKeys(r).length === 2);
            await h.shot("cdp-shots/palette-brainstorm-resume-1-list.png");
            const [first, second] = picker.rows ?? [];
            const q = (topic) => `Question ${QUESTIONS[topic].n} · ${QUESTIONS[topic].text}`;
            // a row's text is its spans' text run together, so each part is judged as a substring
            rec(
                "1. Resume brainstorm… opens the picker: the two open brainstorms, newest first, each with its title, the open question, its age and project; the approved one is not listed",
                drillRow.ok &&
                    entered === true &&
                    picker.ok &&
                    picker.chip.startsWith("Commands") &&
                    picker.chip.endsWith("Brainstorm") &&
                    picker.placeholder === "Pick a brainstorm to resume…" &&
                    sameKeys(rowKeys(picker), [keyOf(ctx, OPEN_NEW), keyOf(ctx, OPEN_OLD)]) &&
                    !rowKeys(picker).map(norm).includes(norm(keyOf(ctx, APPROVED))) &&
                    first.text.includes(TITLES[OPEN_NEW]) &&
                    first.text.includes(q(OPEN_NEW)) &&
                    first.text.includes(`${AGE_TEXT[OPEN_NEW]} · #${PROJECT}`) &&
                    second.text.includes(TITLES[OPEN_OLD]) &&
                    second.text.includes(q(OPEN_OLD)) &&
                    second.text.includes(`${AGE_TEXT[OPEN_OLD]} · #${PROJECT}`) &&
                    !picker.list.includes(TITLES[APPROVED]) &&
                    first.selected &&
                    picker.dialog.includes(DISMISS_ECHO),
                { drill: drillRow.ok, entered, chip: picker.chip, placeholder: picker.placeholder, keys: rowKeys(picker), first: first?.text, second: second?.text }
            );
            if (!picker.ok) return steps;

            // 2. the older row's alt dismisses it: the row goes and its marker sits beside its brainstorm.json
            const down = await h.ev(paletteKey("ArrowDown"));
            const onOld = await until(h, (r) => r.rows?.[1]?.selected === true);
            const marker = join(dirname(fileOf(ctx, OPEN_OLD)), "dismissed");
            const sent = await h.ev(paletteKey("Enter", MOD_KEY));
            const gone = await until(h, (r) => rowKeys(r).length === 1 && !rowKeys(r).includes(keyOf(ctx, OPEN_OLD)));
            // the row goes at once; the marker is written behind it, and the re-read after the write must agree with it
            let markerOld = false;
            for (let i = 0; i < 15 && !markerOld; i++) {
                markerOld = existsSync(marker);
                if (!markerOld) await polishNap(200);
            }
            await polishNap(800);
            const after = await until(h, (r) => rowKeys(r).length === 1);
            await h.shot("cdp-shots/palette-brainstorm-resume-2-dismissed.png");
            const markerNew = existsSync(join(dirname(fileOf(ctx, OPEN_NEW)), "dismissed"));
            const markerSize = markerOld ? statSync(marker).size : null;
            rec(
                "2. the older row's alt (Mod+Enter) dismisses it: the row is gone, the other stays, and an empty dismissed file sits beside the dismissed one's brainstorm.json and no other",
                down === true &&
                    onOld.ok &&
                    sent === true &&
                    gone.ok &&
                    after.ok &&
                    sameKeys(rowKeys(after), [keyOf(ctx, OPEN_NEW)]) &&
                    markerOld &&
                    markerSize === 0 &&
                    !markerNew,
                { down, onOld: onOld.ok, sent, keys: rowKeys(after), markerOld, markerSize, markerNew }
            );
            if (!gone.ok) return steps;

            // 3. Enter on the row left: the start asked for the resume prompt on its file in the project, the new tab
            // carries the file, and its brainstorm pane shows it
            await h.ev(START_INSTALL);
            const wantFile = fileOf(ctx, OPEN_NEW);
            const resumed = await h.ev(paletteKey("Enter"));
            const started = await polishWaitFor(h, `(${STARTS}).block.length > 0 && (${STARTS}).tab.length > 0`, 10000);
            const rec3 = await h.ev(STARTS);
            const block = rec3.block[0];
            const tab = rec3.tab[0];
            const closed = await polishWaitFor(h, `!${PALETTE_INPUT}`, 3000);
            if (tab != null) {
                ctx.resumed = { tabId: String(tab.oref).replace(/^tab:/, ""), blockId: String(block?.oref ?? "").replace(/^block:/, ""), cwd: ctx.cwd };
            }
            const args = block?.meta?.["cmd:args"] ?? [];
            const tabMeta = ctx.resumed ? await bsTabMeta(h, ctx.resumed).catch((e) => `error: ${e?.message ?? e}`) : null;
            rec(
                "3a. Enter starts an agent on the resume prompt for that file in the project's own folder (no worktree), writes session:brainstorm on the new tab, and closes the palette",
                resumed === true &&
                    started &&
                    closed &&
                    rec3.block.length === 1 &&
                    rec3.tab.length === 1 &&
                    block.meta["cmd:cwd"] != null &&
                    norm(block.meta["cmd:cwd"]) === norm(ctx.cwd) &&
                    // the task is the command's last argument, whatever runtime the harness's default is
                    norm(args.at(-1)) === norm(resumePrompt(wantFile)) &&
                    norm(tab.meta["session:brainstorm"]) === norm(wantFile) &&
                    norm(tabMeta) === norm(wantFile),
                { resumed, started, closed, cmd: block?.meta?.cmd, args, cwd: block?.meta?.["cmd:cwd"], tabBrainstorm: tab?.meta?.["session:brainstorm"], tabMeta }
            );
            if (ctx.resumed == null || !ctx.resumed.blockId) return steps;

            // the new tab runs a plain shell here, so it is made a roster agent as brainstorm-mode's terminal is, and the
            // roster's re-attach then reads session:brainstorm off its tab
            await bsPublishStatus(h, ctx.resumed);
            await h.ev(`document.querySelector('[data-agent-row="${ctx.resumed.tabId}"]')?.click()`);
            const switched = await polishWaitFor(h, `!!${BS_SWITCH}`, 10000);
            const shown = switched && (await bsShowPane(h));
            const pane = await bsUntil(h, ctx.resumed, (s) => s.title === TITLES[OPEN_NEW] && s.question.includes(QUESTIONS[OPEN_NEW].text), 7000);
            await h.shot("cdp-shots/palette-brainstorm-resume-3-resumed.png");
            rec(
                "3b. the resumed agent's tab has the brainstorm attached before the agent writes anything: its brainstorm pane shows the resumed brainstorm's title and open question",
                switched && shown === true && pane.ok,
                { switched, shown, title: pane.title, question: (pane.question ?? "").slice(0, 80) }
            );
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
            await step("close the palette", () => h.ev(`${PALETTE_INPUT} ? (document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', code: 'Escape', bubbles: true })), true) : false`));
            await step("stop recording starts", () => h.ev(START_REMOVE));
            if (ctx.resumed?.tabId) {
                await step("close the resumed agent's tab", () => waveService(h, "workspace", "CloseTab", [ctx.workspaceId, ctx.resumed.tabId, false]));
            }
            if (ctx.project) {
                // deleteproject leaves the channel createproject made, so that goes too
                await step("delete the project", async () => {
                    await h.rpc("deleteproject", { name: ctx.project });
                    const channels = (await h.rpc("getchannels", null))?.channels ?? [];
                    for (const c of channels.filter((c) => norm(c.projectpath) === norm(ctx.cwd))) {
                        await h.rpc("deletechannel", { channelid: c.oid });
                    }
                });
            }
            await step("remove the temp dir", () => rmSync(ctx.cwd, { recursive: true, force: true }));
            await step("go home", () => h.goto("cockpit"));
        },
    };
    return [scenario];
}
