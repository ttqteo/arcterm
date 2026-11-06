// agent-subagents-background: an idle claude agent that started two subagents in the background, and what the Agent tree and
// the details rail say of them while their parent only holds the launch ack, then at each one's <task-notification>
// (ported from the fork's commit 108c9d5fe, onto our tree rows and rail; the fork's "standing by" header step is not ours).
// Both spawns are answered by an async launch ack: the Explore one by the receipt text and both toolUseResult marks, the
// Plan one by neither the text nor isAsync, only toolUseResult.status "async_launched", so it is a launch only because the
// ack is read from the record. Each child's own file ends on a tool result, so it reads as still working until its
// handback lands. The Explore agent ends with a completed notification (success, where its finished file alone read the
// neutral "done"), the Plan agent with a failed one. The roster is a page fixture over a real tab with no controller (a fake
// block id would fail its terminal's resync and read "failed to start"); every transcript lives in a temp dir teardown
// removes. kit is scenarios.mjs's RT_KIT (waveService, polishWaitFor).

import { appendFileSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
    agentPage,
    assistantText,
    focusAgent,
    restoreRoster,
    setRoster,
    tabFixtures,
    taskNotification,
    toolResult,
    toolUse,
    userText,
    writeSubagent,
    writeTranscript,
} from "./agent-page-fixtures.mjs";

const NAME = "agent-subagents-background";
const PARENT_NAME = "subagents parent";
const SESSION = "parent";
const HANDBACK = "subagenthandback";
const LOAD_WAIT_MS = 15_000;
// the parent's subagents are re-read every WORKING_CHILD_POLL_MS (15s) while one still reads as working
const POLL_WAIT_MS = 40_000;

const EXPLORE = {
    spawnId: "toolu_bg_explore",
    childId: "bgexplore",
    type: "Explore",
    prompt: "survey the agent tree for stale rows",
    read: "agenttree.tsx",
};
const PLAN = {
    spawnId: "toolu_bg_plan",
    childId: "bgplan",
    type: "Plan",
    prompt: "plan the cleanup of the stale rows",
    read: "cleanup-plan.md",
};

const RAIL_SELECTOR = 'aside[aria-label="Agent details"]';
const flatOf = (expr) => `((${expr})?.textContent ?? "").replace(/\\s+/g, " ").trim()`;

// a subagent's row in the Agent tree: whether it is drawn, and whether its dot is the working color, both as the browser
// computes them
const treeRow = (type) => `(() => {
    const tree = document.querySelector("[data-agent-tree]");
    const label = tree && [...tree.querySelectorAll("div")].find(
        (d) => d.children.length === 0 && d.textContent.trim() === ${JSON.stringify(type)}
    );
    const row = label?.parentElement?.parentElement;
    const dot = row?.querySelector("span.rounded-full");
    if (!dot) return { row: false };
    const probe = document.createElement("span");
    probe.style.backgroundColor = "var(--color-working)";
    document.body.appendChild(probe);
    const working = getComputedStyle(probe).backgroundColor;
    probe.remove();
    return { row: true, working: getComputedStyle(dot).backgroundColor === working, text: row.textContent.trim() };
})()`;

// the state word the rail's Subagents section reads for a subagent, or null with no such row
const railState = (type) => `(() => {
    const section = document.querySelector('${RAIL_SELECTOR} [data-rail-section="subagents"]');
    const label = section && [...section.querySelectorAll("div")].find(
        (d) => d.children.length === 0 && d.textContent.trim() === ${JSON.stringify(type)}
    );
    const row = label?.parentElement?.parentElement;
    return row ? row.lastElementChild?.textContent.trim() ?? null : null;
})()`;

// the interior's own pane: the breadcrumb's bar sits in it
const INTERIOR = `document.querySelector('button[title="Back to parent (Esc)"]')?.parentElement?.parentElement`;
const RAIL = `document.querySelector('${RAIL_SELECTOR}')`;

function writeFixture(dir) {
    const o = { cwd: dir };
    const spawn = (s, description, ack) => [
        toolUse(
            s.spawnId,
            "Agent",
            { subagent_type: s.type, description, prompt: s.prompt, run_in_background: true },
            o
        ),
        ack,
    ];
    const parentPath = writeTranscript(dir, SESSION, [
        userText("survey the tree and plan the cleanup in the background", o),
        ...spawn(
            EXPLORE,
            "survey the tree",
            toolResult(EXPLORE.spawnId, "Async agent launched successfully", {
                toolUseResult: { isAsync: true, status: "async_launched", agentId: EXPLORE.childId },
                ...o,
            })
        ),
        // not the receipt's words and no isAsync: only the record's status says it went async
        ...spawn(
            PLAN,
            "plan the cleanup",
            toolResult(PLAN.spawnId, "Started in the background.", {
                toolUseResult: { status: "async_launched", agentId: PLAN.childId },
                ...o,
            })
        ),
        assistantText("Both agents run in the background; I will report when they land.", o),
    ]);
    // each child's last record is a tool result that is not a handback's, so its file reads as still working
    const child = (s) =>
        writeSubagent(dir, SESSION, s.childId, [
            userText(s.prompt, o),
            toolUse(`toolu_${s.childId}_read`, "Read", { file_path: join(dir, s.read) }, o),
            toolResult(`toolu_${s.childId}_read`, "export function Row() {}", o),
        ]);
    return { parentPath, childPaths: { [EXPLORE.childId]: child(EXPLORE), [PLAN.childId]: child(PLAN) } };
}

// a child ends: it hands its report back, and its parent is told in a <task-notification>. The parent's record goes first, so
// a read between the two never sees a finished file with no notification (the neutral "done").
function endSubagent(ctx, s, status, summary) {
    const o = { cwd: ctx.dir };
    appendFileSync(
        ctx.parentPath,
        taskNotification({ taskId: s.childId, toolUseId: s.spawnId, status, summary, ...o }) + "\n"
    );
    const id = `toolu_${s.childId}_handback`;
    appendFileSync(
        ctx.childPaths[s.childId],
        [
            toolUse(id, "SubagentHandback", { description: `hand the ${s.type} report back` }, o),
            toolResult(id, "handed back", o),
        ].join("\n") + "\n"
    );
}

export default function (kit) {
    const { polishWaitFor } = kit;
    const { makeTab, closeTabs } = tabFixtures(kit);

    return [
        {
            name: NAME,
            surface: "agent",
            async arrange(h) {
                const ctx = { dir: mkdtempSync(join(tmpdir(), "verify-agent-subagents-")) };
                // a throw past this point still returns ctx, so teardown undoes whatever was already set
                try {
                    Object.assign(ctx, writeFixture(ctx.dir));
                    await h.goto("agent");
                    const { tabId, blockId } = await makeTab(h, ctx, { label: PARENT_NAME });
                    ctx.parentId = tabId;
                    const prev = await agentPage(
                        h,
                        `const R = await mod("app/view/agents/railstore.ts");
                        const S = await mod("app/element/railsections.ts");
                        const prev = { visible: globalStore.get(R.railVisibleAtom), sections: globalStore.get(S.railSectionOpenAtom) };
                        globalStore.set(R.railVisibleAtom, true);
                        globalStore.set(S.railSectionOpenAtom, { ...prev.sections, subagents: true });
                        return prev;`
                    );
                    ctx.prevRail = prev;
                    await setRoster(h, [
                        {
                            id: tabId,
                            name: PARENT_NAME,
                            project: "waveterm",
                            task: "survey the tree",
                            state: "idle",
                            agent: "claude",
                            model: "opus",
                            idleSince: Date.now() - 30_000,
                            blockId,
                            transcriptPath: ctx.parentPath,
                        },
                    ]);
                    await focusAgent(h, tabId);
                } catch (e) {
                    ctx.arrangeError = String(e?.message ?? e);
                }
                return ctx;
            },
            async assert(h, ctx) {
                const steps = [];
                const rec = (step, ok, detail) => steps.push({ step, ok, detail });
                if (ctx.arrangeError != null) {
                    rec("arrange the fixture agent", false, ctx.arrangeError);
                    return steps;
                }
                // a thrown call (the page went away, a CDP timeout) must not discard the steps recorded so far
                try {
                    // 1. both launch acks leave the spawn working, however the ack is marked
                    const bothWorking = `(() => { const e = ${treeRow(EXPLORE.type)}, p = ${treeRow(PLAN.type)}; return e.row && e.working && p.row && p.working; })()`;
                    await polishWaitFor(h, bothWorking, LOAD_WAIT_MS);
                    const e1 = await h.ev(treeRow(EXPLORE.type));
                    const p1 = await h.ev(treeRow(PLAN.type));
                    const rails1 = await h.ev(`[${railState(EXPLORE.type)}, ${railState(PLAN.type)}]`);
                    await h.shot("cdp-shots/agent-subagents-background-1-working.png");
                    rec(
                        "1. after their launch acks the tree shows both background subagents working and the rail reads working for each, the Plan one's ack carrying only toolUseResult.status",
                        e1.row && e1.working && p1.row && p1.working && rails1.every((s) => s === "working"),
                        JSON.stringify({ explore: e1, plan: p1, rail: rails1 })
                    );

                    // 2. the Explore agent's completed notification ends it as a success, not the neutral done, and it leaves the tree
                    endSubagent(ctx, EXPLORE, "completed", 'Agent "survey the tree" completed');
                    await polishWaitFor(h, `${railState(EXPLORE.type)} === "success"`, POLL_WAIT_MS);
                    const rail2 = await h.ev(railState(EXPLORE.type));
                    const e2 = await h.ev(treeRow(EXPLORE.type));
                    const p2 = await h.ev(treeRow(PLAN.type));
                    const planRail2 = await h.ev(railState(PLAN.type));
                    await h.shot("cdp-shots/agent-subagents-background-2-success.png");
                    rec(
                        "2. its completed task notification makes the Explore subagent success in the rail and takes its row out of the tree, while the Plan one still works",
                        rail2 === "success" && !e2.row && p2.row && p2.working && planRail2 === "working",
                        JSON.stringify({ rail: rail2, explore: e2, plan: p2, planRail: planRail2 })
                    );

                    // 3. the Plan agent's failed notification ends it as a failure
                    endSubagent(ctx, PLAN, "failed", 'Agent "plan the cleanup" failed');
                    await polishWaitFor(h, `${railState(PLAN.type)} === "failed"`, POLL_WAIT_MS);
                    const rail3 = await h.ev(railState(PLAN.type));
                    const exploreRail3 = await h.ev(railState(EXPLORE.type));
                    await h.shot("cdp-shots/agent-subagents-background-3-failed.png");
                    rec(
                        "3. its failed task notification makes the Plan subagent failed in the rail, and the Explore one stays success",
                        rail3 === "failed" && exploreRail3 === "success",
                        JSON.stringify({ plan: rail3, explore: exploreRail3 })
                    );

                    // 4. a child's interior and the rail's Tools leave out its SubagentHandback call
                    await agentPage(
                        h,
                        `const S = await mod("app/view/agents/subagentsstore.ts");
                        globalStore.set(S.focusSubagentAtom, {
                            parentId: ${JSON.stringify(ctx.parentId)},
                            agentId: ${JSON.stringify(EXPLORE.childId)},
                            transcriptPath: ${JSON.stringify(ctx.childPaths[EXPLORE.childId])},
                            label: ${JSON.stringify(EXPLORE.type)},
                        });
                        return true;`
                    );
                    await polishWaitFor(
                        h,
                        `${flatOf(INTERIOR)}.includes(${JSON.stringify(EXPLORE.read)}) && ${flatOf(RAIL)}.includes("Tools")`,
                        LOAD_WAIT_MS
                    );
                    const interior = await h.ev(flatOf(INTERIOR));
                    const rail4 = await h.ev(flatOf(RAIL));
                    await h.shot("cdp-shots/agent-subagents-background-4-interior.png");
                    rec(
                        "4. the Explore subagent's interior and the rail's Tools list its Read and leave out the SubagentHandback call",
                        interior.includes(EXPLORE.read) &&
                            !interior.toLowerCase().includes(HANDBACK) &&
                            rail4.includes("Tools") &&
                            /read\s*×1/.test(rail4) &&
                            !rail4.toLowerCase().includes(HANDBACK),
                        JSON.stringify({ interior: interior.slice(0, 200), rail: rail4.slice(0, 400) })
                    );
                } catch (e) {
                    rec("the scenario ran to its end", false, String(e?.message ?? e));
                }
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
                await step("close the subagent interior", () =>
                    agentPage(
                        h,
                        `const S = await mod("app/view/agents/subagentsstore.ts");
                        globalStore.set(S.focusSubagentAtom, null);
                        return true;`
                    )
                );
                await step("restore the roster", () => restoreRoster(h));
                await step("close the fixture tab", () => closeTabs(h, ctx));
                if (ctx.prevRail !== undefined) {
                    await step("restore the rail", () =>
                        agentPage(
                            h,
                            `const R = await mod("app/view/agents/railstore.ts");
                            const S = await mod("app/element/railsections.ts");
                            globalStore.set(R.railVisibleAtom, ${JSON.stringify(ctx.prevRail?.visible)});
                            globalStore.set(S.railSectionOpenAtom, ${JSON.stringify(ctx.prevRail?.sections ?? {})});
                            return true;`
                        )
                    );
                }
                await step("remove the fixture transcripts", () => rmSync(ctx.dir, { recursive: true, force: true }));
                await step("go home", () => h.goto("cockpit"));
            },
        },
    ];
}
