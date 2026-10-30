// The brainstorm's Run step (the Run-Blocked and Run-Landed boards). kit holds scenarios.mjs's brainstorm helpers.
//
// Each run scenario pairs a brainstorm terminal (bsArrangeAgent) with a deferred fixture run whose dag is seeded
// into a settled state (docs/reference/cdp-run-fixtures.md, "A state the engine has not reached"): every task done
// and merged, none linked to a child run, and a final the engine leaves alone. A failed final makes the dag blocked
// and a passed or unverified one done; the watchdog skips both while no task is in flight, and notifiedcondition
// is seeded too, so a tick that does run (t-1's child cancelled) announces nothing.
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const DISPATCH_WAIT_MS = 60_000;
const RUN_WAIT_MS = 15_000;
const ID_CHARS = 8;
const SHA = "78671429d0c4f1e2a3b4c5d6e7f8091a2b3c4d5e";
const SHA_CHARS = 7;
const MISSING_RUN = "3b0d5e1f-9a7c-4c2e-8f10-6d2a4b9e7c31";

// the boards' lanes, chained so only t-1 dispatches a worker
const BLOCKED_LANES = [
    "Settings, context fields, the CE reader and migration 080",
    "Parser into src and rule reading",
    "Lint and check_rule_text",
    "The library: embeddings client, refresh, search and the ce_library tool",
    "Store text rules: hypotheses, candidates and the readers of scenario",
    "Management Panel: rule_text mapped, text rules on the Hypotheses page",
    "Measure a text rule",
    "The engine writes text rules: prompt, schema, tools, gate and the pass",
    "Drop the unread watch_days setting",
    "A text rule’s check reads as a rule check, and the library copy follows O2",
];
const LANDED_LANES = [
    "Migration 085, candidate severity columns",
    "Severity settings",
    "Suppress-free rule text",
    "Measure every rule at the fixed suppress",
    "Proposal schema: severity and reason",
    "The prompt teaches severity and stops teaching suppress",
    "Store severity: gate text, entry, candidate keeps the highest",
    "Offline rubric check script",
    "MP backend: approval at the proposed severity",
    "MP webapp: severity in the drawer proposal and on the Rules tab",
];
const tasksOf = (lanes) =>
    lanes.map((label, i) => ({
        id: `t-${i + 1}`,
        label,
        description: "do nothing, stop immediately",
        deps: i === 0 ? [] : [`t-${i}`],
        state: "",
    }));

const BLOCKED_DECISIONS = [
    ["Intent and why", "Flexibility over measured equivalence.", "answer 1"],
    ["Where it starts from", "Today the model fills a fixed scenario form that check_rule compiles and measure_rule replays.", "recon"],
    ["What makes a rule approvable", "Secondary to this design.", "answer 2"],
    ["From approval to live alerts", "Out of scope: this design is about how the model writes rules.", "answer 2"],
    ["How the model writes a rule", "Any rule the CE language allows.", "answer 3"],
    ["How the model finds library examples", "Reuse the assistant’s search and drafter: 6 sound rules out of 10, untuned.", "answer 5"],
    ["Checking a draft", "Parse with CERule.g4 and lint, in the gate, before a human sees it.", "agent’s call"],
    ["Measuring a draft", "A best-effort replay of the shapes the library uses most.", "agent’s call"],
    ["The library copy", "Refreshed from the live correlations table, test rules dropped, literals censored.", "agent’s call"],
    ["What changes downstream", "A proposal carries CE rule text instead of a scenario.", "agent’s call"],
    ["Non-goals", "No per-attack-class rule kinds.", "agent’s call"],
    ["Left to the builder", "The lint list, the shape key, replay coverage order and prompt wording.", "agent’s call"],
];
const LANDED_DECISIONS = [
    ["How it works today", "Approval creates every engine rule at severity 3, inactive.", "recon"],
    ["How the SOC’s library sets severity", "Read from the 186 active tenant-0 rules on DEV.", "recon"],
    ["Intent and why", "Suppress follows severity, so a rule created at medium is only right if it really is medium.", "answer 1"],
    ["How severity gets decided", "The model proposes it, code turns it into suppress, the analyst has the last word.", "agent’s call"],
    ["What a wrong severity costs", "Too low hurts more, and is the cheaper way to cheat the gate.", "agent’s call"],
    ["What the analyst sees at approval", "Level plus one line of reason, placed with the rule.", "answer 6"],
    ["Left to the builder", "Where the proposed severity and its reason are stored.", "agent’s call"],
];
const partsOf = (decisions) =>
    decisions.map(([title, gist, from], i) => ({ id: `d${i + 1}`, title, state: "yours", from, gist, body: gist }));

const BLOCKED = {
    label: "bs-run-blocked",
    topic: "llm-authored-ce-rules",
    title: "LLM-authored CE rules from the library",
    spec: "docs/superpowers/specs/2026-10-19-llm-authored-ce-rules-design.md",
    decisions: BLOCKED_DECISIONS,
};
const LANDED = {
    label: "bs-run-landed",
    topic: "engine-rule-severity",
    title: "Severity of engine-created rules",
    spec: "docs/superpowers/specs/2026-10-20-engine-rule-severity-design.md",
    decisions: LANDED_DECISIONS,
};
const FAILED_FINAL = { state: "failed", round: 2, detail: "e2e FD10 detail gone" };
const UNVERIFIED_FINAL = { state: "unverified", round: 1, unverified: ["the plan has no Verify"] };
const PASSED_FINAL = { state: "passed", round: 1 };

const id8 = (id) => id.slice(0, ID_CHARS);

const RUN_READ = (pane) => `(() => {
    const flat = (el) => (el?.innerText ?? "").replace(/\\s+/g, " ").trim();
    const pane = ${pane};
    const open = pane?.querySelector("[data-brainstorm-open-run]");
    const close = pane?.querySelector("[data-brainstorm-close]");
    const phases = [...(pane?.querySelectorAll("[data-brainstorm-phase] > li:not([aria-hidden])") ?? [])];
    const rail = pane?.querySelector("[data-brainstorm-run-rail]");
    return {
        view: pane?.getAttribute("data-brainstorm-view") ?? null,
        state: pane?.querySelector("[data-brainstorm-run]")?.getAttribute("data-brainstorm-run") ?? null,
        title: flat(pane?.querySelector("h1")),
        open: open ? { text: flat(open), primary: open.className.includes("bg-accent") } : null,
        card: flat(pane?.querySelector("[data-brainstorm-run-card]")),
        closeOff: flat(pane?.querySelector("[data-brainstorm-close-off]")),
        close: close ? { text: flat(close), disabled: close.disabled } : null,
        closeError: flat(pane?.querySelector("[data-brainstorm-close-error]")),
        handedHead: flat(pane?.querySelector("[data-brainstorm-handed] h2")?.parentElement),
        handed: [...(pane?.querySelectorAll("[data-brainstorm-handed-row]") ?? [])].map((r) => ({
            title: flat(r.children[1]),
            from: flat(r.children[3]),
        })),
        progress: !!pane?.querySelector("[data-brainstorm-progress]"),
        current: phases.filter((li) => li.getAttribute("aria-current") === "step").map(flat),
        done: phases.filter((li) => li.querySelector("svg.text-success")).length,
        rail: rail ? flat(rail) : null,
    };
})()`;

export default function (kit) {
    const {
        bsArrangeAgent,
        bsShowFile,
        bsTeardownAgent,
        bsWrite,
        bsClick,
        bsFile,
        polishWaitFor,
        polishNap,
        skipStep,
        waveService,
        arrangeSheetDagRun,
        teardownFixtureRun,
        seedDag,
        fstWriteRun,
        BS_PANE,
        BS_TREE_LINE,
        flatText,
    } = kit;

    const readRun = (h) => h.ev(RUN_READ(BS_PANE));
    const treeText = (h) => h.ev(flatText(BS_TREE_LINE));

    // the DOM can hold the state while the line's truncation hides it: measure the state's drawn right edge
    // against the right edge of the truncating element that clips it
    const treeStateFit = (h, state) =>
        h.ev(`(() => {
            const line = ${BS_TREE_LINE};
            if (!line) return { ok: false, why: "no tree line" };
            const walker = document.createTreeWalker(line, NodeFilter.SHOW_TEXT);
            for (let node = walker.nextNode(); node; node = walker.nextNode()) {
                const at = node.data.indexOf(${JSON.stringify(state)});
                if (at < 0) continue;
                const range = document.createRange();
                range.setStart(node, at);
                range.setEnd(node, at + ${state.length});
                const clip = node.parentElement.closest(".truncate");
                if (!clip || !line.contains(clip)) return { ok: false, why: "no truncating element around the state" };
                const right = range.getBoundingClientRect().right;
                const clipRight = clip.getBoundingClientRect().right;
                return { ok: right <= clipRight + 0.5, right, clipRight, lineWidth: line.getBoundingClientRect().width };
            }
            return { ok: false, why: "state not in the line" };
        })()`);

    // the tree line reads want, and its state is drawn inside the line's visible box
    async function treeStep(h, want, state) {
        const tree = await treeUntil(h, want);
        const fit = await treeStateFit(h, state).catch((e) => ({ ok: false, why: String(e?.message ?? e) }));
        return { ok: tree.ok && fit.ok, detail: { text: tree.text, [state]: fit } };
    }

    // polls the Run step until want(read) holds; the last read and whether it did
    async function runUntil(h, want, ms = RUN_WAIT_MS) {
        const start = Date.now();
        let s;
        do {
            s = await readRun(h).catch((e) => ({ error: String(e?.message ?? e) }));
            if (s.error == null && want(s)) return { ...s, ok: true };
            await polishNap(250);
        } while (Date.now() - start < ms);
        return { ...s, ok: false };
    }

    async function treeUntil(h, want, ms = RUN_WAIT_MS) {
        const start = Date.now();
        let text = "";
        do {
            text = await treeText(h).catch(() => "");
            if (text === want) return { ok: true, text };
            await polishNap(250);
        } while (Date.now() - start < ms);
        return { ok: false, text };
    }

    async function waitForDispatch(h, ctx, taskId) {
        const start = Date.now();
        while (Date.now() - start < DISPATCH_WAIT_MS) {
            const group = (await h.rpc("dagstatus", { channelid: ctx.channelId, runid: ctx.runId })).group;
            const runId = group?.tasks?.find((t) => t.id === taskId)?.runid;
            if (runId) return runId;
            await polishNap(500);
        }
        throw new Error(`task ${taskId} never dispatched a worker`);
    }

    const seedPrint = (dag) =>
        JSON.stringify([
            dag?.status,
            dag?.final?.state,
            dag?.final?.round,
            (dag?.tasks ?? []).map((t) => [t.state, !!t.merged, t.runid ?? ""]),
        ]);

    // every task landed and unlinked from its child run, the dag settled on `status` with `final`
    const seedSettled = (h, ctx, status, final) =>
        seedDag(
            h,
            ctx,
            (dag) => ({
                ...dag,
                status,
                notifiedcondition: status === "blocked" ? "blocked:final-failed" : status,
                final,
                tasks: dag.tasks.map(({ runid: _runid, ...t }) => ({ ...t, state: "done", merged: true })),
            }),
            seedPrint
        );

    const storedFinal = async (h, ctx) => (await waveService(h, "object", "GetObject", [`dag:${ctx.dagId}`]))?.final;

    // the fixture run, settled, with a brainstorm terminal whose file names it; ctx.bs is the brainstorm's
    async function arrangeRunStep(h, fx, status, final, land, canvasSetup) {
        const ctx = await arrangeSheetDagRun(h, fx.label, tasksOf(fx === BLOCKED ? BLOCKED_LANES : LANDED_LANES));
        if (ctx.arrangeError != null) return ctx;
        try {
            ctx.dagId = (await h.rpc("dagstatus", { channelid: ctx.channelId, runid: ctx.runId })).group?.oid;
            if (!ctx.dagId) throw new Error("the run has no dag");
            ctx.childRunId = await waitForDispatch(h, ctx, "t-1");
            await seedSettled(h, ctx, status, final);
            ctx.runDone = status === "done";
            // unlinked by the seed, so its end derives nothing; cancelled, so its worker frees the temp dir
            await h.rpc("cancelrun", { channelid: ctx.channelId, runid: ctx.childRunId });
            // a run on its own branch, which says nothing has merged until it lands; the path is never made
            await fstWriteRun(h, ctx.runId, (run) => ({
                ...run,
                basebranch: "main",
                landpath: join(ctx.cwd, "wave-tree"),
                ...(land ? { land } : {}),
            }));
        } catch (e) {
            ctx.arrangeError = String(e?.message ?? e);
            return ctx;
        }
        const file = bsFile({
            done: true,
            title: fx.title,
            spec: fx.spec,
            canvas: fx.topic,
            parts: partsOf(fx.decisions),
            run: ctx.runId,
        });
        ctx.bs = await bsArrangeAgent(h, fx.topic, file);
        ctx.bsFile = file;
        if (canvasSetup) canvasSetup(ctx.bs);
        return ctx;
    }

    async function teardownRunStep(h, ctx, name) {
        if (ctx.bs) await bsTeardownAgent(h, ctx.bs, name);
        if (ctx.childRunId) {
            await h.rpc("cancelrun", { channelid: ctx.channelId, runid: ctx.childRunId }).catch((e) => {
                console.error(`${name} teardown: cancel the child run failed: ${e?.message ?? e}`);
            });
        }
        // a run seeded done refuses a cancel, so the shared teardown skips it
        await teardownFixtureRun(h, ctx.runDone ? { ...ctx, runId: null } : ctx, name);
    }

    // shows the brainstorm's pane; null once drawn, else why it could not be
    async function showRunStep(h, ctx) {
        if (ctx.arrangeError != null) return `the fixture run failed: ${ctx.arrangeError}`;
        return bsShowFile(h, ctx.bs);
    }

    const finalUnchanged = async (h, ctx, want, rec, step) => {
        const final = await storedFinal(h, ctx).catch((e) => ({ error: String(e?.message ?? e) }));
        rec(step, final?.state === want.state && final?.round === want.round, JSON.stringify(final));
    };

    const recorder = (steps) => (step, ok, detail) =>
        steps.push({ step, ok, detail: typeof detail === "string" ? detail : JSON.stringify(detail) });

    const blocked = {
        name: "brainstorm-run-blocked",
        surface: "agent",
        arrange: (h) => arrangeRunStep(h, BLOCKED, "blocked", FAILED_FINAL, null),
        async assert(h, ctx) {
            const missing = await showRunStep(h, ctx);
            if (missing != null) return [skipStep("could not verify", `could not verify: ${missing}`)];
            const steps = [];
            const rec = recorder(steps);
            const short = id8(ctx.runId);

            const s = await runUntil(h, (x) => x.state === "final-failed" && (x.rail ?? "").includes("10/10"));
            rec(
                "1. header with Open run <id8> primary, the final-failed card (round 2, nothing merged), What you handed over · 12 with sources and caption, RunSection in the rail, no Progress segments",
                s.ok &&
                    s.title === BLOCKED.title &&
                    s.open?.text === `Open run ${short}` &&
                    s.open.primary &&
                    s.card.includes("The run built every task, but its final check failed") &&
                    s.card.includes(`All 10 tasks landed on wave/${short}`) &&
                    s.card.includes("The final check failed in round 2, so nothing has merged into main yet") &&
                    s.handedHead === "What you handed over · 12 the design the run builds from" &&
                    s.handed.length === 12 &&
                    s.handed.every((r, i) => r.title === BLOCKED_DECISIONS[i][0] && r.from === BLOCKED_DECISIONS[i][2]) &&
                    s.close == null &&
                    !s.progress &&
                    s.current.join() === "Run",
                s
            );
            await h.shot("cdp-shots/brainstorm-run-blocked-1.png");

            // the row's chip names the brainstorm, so the line has no "Brainstorm ·" lead (71181210f dropped it)
            const tree = await treeStep(h, `final failed · run ${short}`, "final failed");
            rec("2. the tree line reads final failed · run <id8>, the state drawn inside it", tree.ok, tree.detail);

            const from = await h.activeSurfaceLabel();
            const clicked = await bsClick(h, BS_PANE, `Open run ${short}`);
            const opened = await polishWaitFor(
                h,
                `!!document.querySelector("[data-run-sheet]") && (document.querySelector("[data-run-sheet]").innerText || "").includes(${JSON.stringify(`verify ${BLOCKED.label}`)})`,
                RUN_WAIT_MS
            );
            const to = await h.activeSurfaceLabel();
            rec("3. Open run opens the run", clicked === "clicked" && opened && from === "Agent" && to === "Jarvis", {
                clicked,
                opened,
                from,
                to,
            });

            await finalUnchanged(h, ctx, FAILED_FINAL, rec, "4. the seeded final is unchanged (failed, round 2)");
            return steps;
        },
        teardown: (h, ctx) => teardownRunStep(h, ctx, "brainstorm-run-blocked"),
    };

    const landed = {
        name: "brainstorm-run-landed",
        surface: "agent",
        arrange: (h) =>
            arrangeRunStep(h, LANDED, "done", UNVERIFIED_FINAL, { state: "landed", commit: SHA }, (bs) => {
                // the fixture canvas, a sibling Close must leave, and what a canvas of ../escape would name
                bs.canvasDir = join(bs.cwd, ".superpowers", "design", LANDED.topic);
                mkdirSync(join(bs.canvasDir, "project"), { recursive: true });
                writeFileSync(join(bs.canvasDir, "project", "Main.dc.html"), "<!doctype html><title>fixture</title>\n");
                bs.sibling = join(bs.cwd, ".superpowers", "keep.txt");
                writeFileSync(bs.sibling, "stays\n");
                bs.escape = join(bs.cwd, ".superpowers", "escape");
                mkdirSync(bs.escape, { recursive: true });
                writeFileSync(join(bs.escape, "keep.txt"), "stays\n");
                bs.brainstormDir = join(bs.cwd, ".superpowers", "brainstorm", LANDED.topic);
            }),
        async assert(h, ctx) {
            const missing = await showRunStep(h, ctx);
            if (missing != null) return [skipStep("could not verify", `could not verify: ${missing}`)];
            const steps = [];
            const rec = recorder(steps);
            const short = id8(ctx.runId);
            const sha7 = SHA.slice(0, SHA_CHARS);
            const merged = `Built and merged into main at ${sha7}`;

            let s = await runUntil(h, (x) => x.state === "merged" && x.closeOff !== "");
            rec(
                "1. with the final unverified and the land landed: the merged card, no Close, the closeOff line",
                s.ok &&
                    s.card.includes(merged) &&
                    s.close == null &&
                    s.closeOff.includes("could not verify everything") &&
                    s.open?.text === `Open run ${short}` &&
                    !s.open.primary,
                s
            );
            await h.shot("cdp-shots/brainstorm-run-landed-1-unverified.png");

            try {
                await seedSettled(h, ctx, "done", PASSED_FINAL);
            } catch (e) {
                rec("2. the final reseeded as passed", false, String(e?.message ?? e));
                return steps;
            }
            const deletes = `The ${LANDED.topic} canvas stays in the Canvas gallery. Closing deletes .superpowers/brainstorm/${LANDED.topic} and ends this agent.`;
            s = await runUntil(h, (x) => x.close != null && (x.rail ?? "").includes("Done"));
            rec(
                "2. with the final passed: Built and merged into main at <sha7>, Close the brainstorm, RunSection finished, all three phases done",
                s.ok &&
                    s.card.includes(merged) &&
                    s.card.includes("The final check passed. The spec stays in docs/.") &&
                    s.card.includes(deletes) &&
                    s.close?.text === "Close the brainstorm" &&
                    !s.close.disabled &&
                    s.closeOff === "" &&
                    s.handedHead === "What you handed over · 7" &&
                    s.current.length === 0 &&
                    s.done === 3 &&
                    !s.progress,
                s
            );
            await h.shot("cdp-shots/brainstorm-run-landed-2-passed.png");

            const tree = await treeStep(h, `merged · run ${short}`, "merged");
            rec("3. the tree line reads merged · run <id8>, the state drawn inside it", tree.ok, tree.detail);

            const bs = ctx.bs;
            // a canvas that names another folder no longer matters: Close leaves every canvas in the gallery
            bsWrite(bs, { ...ctx.bsFile, canvas: "../escape" });
            s = await runUntil(h, (x) => x.close?.disabled === false);
            const closed = s.ok ? await bsClick(h, BS_PANE, "Close the brainstorm") : "never enabled";
            const ended = await polishWaitFor(h, `!document.querySelector('[data-agent-row="${bs.tabId}"]')`, RUN_WAIT_MS);
            const after = {
                closed,
                ended,
                brainstorm: existsSync(bs.brainstormDir),
                canvas: existsSync(bs.canvasDir),
                sibling: existsSync(bs.sibling),
                escape: existsSync(join(bs.escape, "keep.txt")),
            };
            rec(
                "4. Close (the canvas naming ../escape) deletes only the brainstorm folder, keeps every canvas and ends the idle agent",
                closed === "clicked" && ended && !after.brainstorm && after.canvas && after.sibling && after.escape,
                after
            );
            await h.shot("cdp-shots/brainstorm-run-landed-4-closed.png");

            await finalUnchanged(h, ctx, PASSED_FINAL, rec, "5. the seeded final is unchanged (passed, round 1)");
            return steps;
        },
        teardown: (h, ctx) => teardownRunStep(h, ctx, "brainstorm-run-landed"),
    };

    const missingRun = {
        name: "brainstorm-run-missing",
        surface: "agent",
        arrange: (h) =>
            bsArrangeAgent(
                h,
                BLOCKED.topic,
                bsFile({
                    done: true,
                    title: BLOCKED.title,
                    spec: BLOCKED.spec,
                    canvas: BLOCKED.topic,
                    parts: partsOf(BLOCKED.decisions),
                    run: MISSING_RUN,
                })
            ),
        async assert(h, ctx) {
            const missing = await bsShowFile(h, ctx);
            if (missing != null) return [skipStep("could not verify", `could not verify: ${missing}`)];
            const steps = [];
            const rec = recorder(steps);
            const short = id8(MISSING_RUN);
            const s = await runUntil(h, (x) => x.state === "missing");
            rec(
                "1. the card says Arc can’t find run <id8>, with no rail and no Close",
                s.ok && s.card.includes(`Arc can’t find run ${short}`) && s.rail == null && s.close == null,
                s
            );
            await h.shot("cdp-shots/brainstorm-run-missing.png");
            const tree = await treeStep(h, `not found · run ${short}`, "not found");
            rec("2. the tree line reads not found · run <id8>, the state drawn inside it", tree.ok, tree.detail);
            return steps;
        },
        teardown: (h, ctx) => bsTeardownAgent(h, ctx, "brainstorm-run-missing"),
    };

    return [blocked, landed, missingRun];
}
