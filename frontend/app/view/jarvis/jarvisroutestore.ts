// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0
//
// The impure half of the pet's Ask at No folder (docs/superpowers/specs/2026-11-16-jarvis-no-folder-ask-design.md,
// "Quyết định khi xây" D2-D4, D8-D12), whose pure half is jarvisroute.ts: that module decides answer / send / launch /
// choose, this one reads the world it decides over, runs the routing consult, and carries the decision out. Every failure
// lands where the person is looking (the errand reply, the card row that was picked, the band), never on a toast and never
// silently: a hand-off that was refused is the one thing Jarvis must not lose.

import { launchAgent } from "@/app/cockpit/cockpit-actions";
import { atoms } from "@/app/store/global-atoms";
import { globalStore } from "@/app/store/jotaiStore";
import { RpcApi } from "@/app/store/wshclientapi";
import { TabRpcClient } from "@/app/store/wshrpcutil";
import type { AgentsViewModel } from "@/app/view/agents/agents";
import { closeTabLogged } from "@/app/view/agents/closetab";
import { councilListAtom, loadCouncils } from "@/app/view/agents/councilstore";
import { harnessesAtom, harnessPreferenceAtom, resolveDefaultRuntime } from "@/app/view/agents/harnessstore";
import { composeStartupCommand, isRuntimeOffered, runtimeStartupCommand, type Runtime } from "@/app/view/agents/launch";
import { HOME_NAME, homeOffered } from "@/app/view/agents/launcher";
import { launcherRuntimeAtom } from "@/app/view/agents/launcherstore";
import { naFlagsAtom } from "@/app/view/agents/naflagsstore";
import { projectsAtom } from "@/app/view/agents/projectsstore";
import { atom, type PrimitiveAtom } from "jotai";
import {
    buildRoutePrompt,
    decideForProject,
    decideRoute,
    NO_FOLDER_PROJECT,
    openAgentsForRouting,
    PICKED_REASON,
    resolveChoice,
    ROUTABLE_HARNESSES,
    splitRouteReply,
    type RouteAction,
    type RouteChoice,
    type RouteProject,
    type RouteWorld,
} from "./jarvisroute";
import { openTarget } from "./openref";
import { closePeek } from "./peekstore";
import { streamConsult } from "./petactrun";
import { petErrandAtom, petPeekOpenAtom, petRouteCardAtom } from "./petstore";

// What a hand-off came to: the caller places a failure (the errand, a card row, the band).
export type RouteOutcome = { ok: true } | { ok: false; message: string };

// The world a routing decision is made over, and the channel the routing consult is filed in.
export type RouteWorldFull = RouteWorld & { noFolderChannelId: string };

// The note an agent carries after Jarvis handed it a job (D11): which project Jarvis chose and why, the job as it was
// handed over (a "Wrong project?" pick hands it on again), and whether the agent was opened for it (`fresh`, so a wrong
// pick closes it). `project` is a registered project's name or NO_FOLDER_PROJECT; show it through routeProjectLabel.
// Session-only, keyed by tab id: it ends when the person closes it, types into the agent or changes the project.
export type RouteBand = { project: string; reason: string; task: string; fresh: boolean };
export const jarvisRouteBandAtom = atom<Record<string, RouteBand>>({}) as PrimitiveAtom<Record<string, RouteBand>>;

export function dismissRouteBand(tabId: string): void {
    const bands = globalStore.get(jarvisRouteBandAtom);
    if (!(tabId in bands)) {
        return;
    }
    const { [tabId]: _gone, ...rest } = bands;
    globalStore.set(jarvisRouteBandAtom, rest);
}

function setBand(tabId: string, band: RouteBand): void {
    globalStore.set(jarvisRouteBandAtom, { ...globalStore.get(jarvisRouteBandAtom), [tabId]: band });
}

const OK: RouteOutcome = { ok: true };

function errText(e: unknown): string {
    return e instanceof Error ? e.message : String(e);
}

function fail(e: unknown): RouteOutcome {
    return { ok: false, message: errText(e) };
}

// The cockpit model, kept for the DEV hook and the band: PetPeek hands it over on mount, since the pet lives in window
// chrome and has no model of its own.
let routeModel: AgentsViewModel | null = null;

export function setRouteModel(model: AgentsViewModel): void {
    routeModel = model;
}

// No folder's path and channel, asked of wavesrv once a session. A failure is not kept, so the next Ask reads it again.
// Exported for the destination picker, which leaves that channel out of its project rows (it is No folder's, not a project's).
let noFolderCache: { path: string; channelid: string } | null = null;

export async function noFolderInfo(): Promise<{ path: string; channelid: string }> {
    if (noFolderCache != null) {
        return noFolderCache;
    }
    const rtn = await RpcApi.EnsureNoFolderCommand(TabRpcClient);
    if (!rtn?.path || !rtn.channelid) {
        throw new Error("Could not set up No folder");
    }
    noFolderCache = { path: rtn.path, channelid: rtn.channelid };
    return noFolderCache;
}

// Drops the remembered No folder, for a caller that learns it moved or was removed.
export function forgetNoFolder(): void {
    noFolderCache = null;
}

// Everything a decision needs, read fresh: the registered projects (those with a path), No folder, and the agents a job
// may go to. `excludeTab` is a tab that has just been closed or is being left, which never counts as open. The council
// seats are read only after the councils loaded (D4): the list is null until then, and a null read as "no seats" would let
// every council agent through; loadCouncils swallows its errors, so a list still null after it is an error here.
export async function routeWorld(model: AgentsViewModel, excludeTab?: string): Promise<RouteWorldFull> {
    const noFolder = await noFolderInfo();
    await loadCouncils("");
    const councils = globalStore.get(councilListAtom(""));
    if (councils == null) {
        throw new Error("Could not read councils");
    }
    const seats = new Set<string>();
    for (const council of councils) {
        for (const expert of council.experts ?? []) {
            if (expert.agent) {
                seats.add(expert.agent);
            }
        }
    }
    const projects: RouteProject[] = Object.entries(globalStore.get(projectsAtom))
        .filter(([, p]) => p?.path)
        .map(([name, p]) => ({ name, path: p.path }))
        .sort((a, b) => a.name.localeCompare(b.name));
    const agents = globalStore.get(model.agentsAtom).filter((a) => a.id !== excludeTab);
    return {
        projects,
        agents: openAgentsForRouting(agents, seats, projects),
        noFolderPath: noFolder.path,
        noFolderChannelId: noFolder.channelid,
    };
}

// The harness a new agent starts on (D10 and the harness amendment). Only a harness AgentsAssignCommand can reach later
// (ROUTABLE_HARNESSES) and that is installed, never a plain terminal, which would lose the job: the launcher's remembered
// one, else the harness preference, else claude, which is also what an empty catalog gets. In No folder it must be one
// the launcher offers there (homeOffered), which today is claude alone. Nothing usable throws.
export function routeRuntime(project: string, noFolderPath: string): Runtime {
    const harnesses = globalStore.get(harnessesAtom);
    const atNoFolder = project === NO_FOLDER_PROJECT;
    const usable = (runtime: string): runtime is Runtime =>
        ROUTABLE_HARNESSES.has(runtime) &&
        isRuntimeOffered(runtime as Runtime, harnesses) &&
        (!atNoFolder || homeOffered("agent", runtime as Runtime, noFolderPath));
    const remembered = globalStore.get(launcherRuntimeAtom);
    if (remembered != null && usable(remembered)) {
        return remembered;
    }
    const preferred = resolveDefaultRuntime(globalStore.get(harnessPreferenceAtom).route?.runtime ?? "", harnesses);
    if (preferred !== "" && usable(preferred)) {
        return preferred;
    }
    if (usable("claude")) {
        return "claude";
    }
    throw new Error("No agent harness to start");
}

// DEV only: the CDP scenarios drive the post-stream path on a canned reply (see the hook at the bottom). A card the hook
// made keeps its hook terms when a row is picked from it, so a scenario that clicks a launch row opens no real agent.
let hookCard = false;
let dryRun = false;
let lastApplied: RouteAction | null = null;

// The job is with the agent: the card is done, the receiving tab gets its band, and the peek leaves the way an escort
// does. A send is followed to its agent (the same landing as the Open button, D4); a launch has already focused its new
// tab. A landing that cannot open leaves the person where they were, and its failure is the outcome, which says the job
// was sent: it is not a failed hand-off.
async function handedOver(
    model: AgentsViewModel,
    tabId: string | null,
    action: Extract<RouteAction, { kind: "send" | "launch" }>
): Promise<RouteOutcome> {
    globalStore.set(petRouteCardAtom, null);
    if (tabId != null) {
        setBand(tabId, {
            project: action.project,
            reason: action.reason,
            task: action.task,
            fresh: action.kind === "launch",
        });
    }
    if (action.kind === "send") {
        // the failure is the outcome's, not a toast's: a toast would say it twice, and elsewhere
        const result = await openTarget(model, { kind: "agent", tabId: action.agentId }, () => {});
        if ("reason" in result && result.reason !== "superseded") {
            return { ok: false, message: `${result.message} (the job was already sent)` };
        }
    }
    closePeek();
    return OK;
}

async function applySend(
    model: AgentsViewModel,
    action: Extract<RouteAction, { kind: "send" }>,
    hook: boolean
): Promise<RouteOutcome> {
    try {
        if (!(hook && dryRun)) {
            await RpcApi.AgentsAssignCommand(TabRpcClient, { tab: action.agentId, text: action.task });
        }
    } catch (e) {
        return fail(e);
    }
    return handedOver(model, action.agentId, action);
}

async function applyLaunch(
    model: AgentsViewModel,
    action: Extract<RouteAction, { kind: "launch" }>,
    hook: boolean
): Promise<RouteOutcome> {
    // a hook never opens a real agent, so a scenario costs no tokens and leaves nothing behind: it records the action,
    // and with no tab there is no band to set
    if (hook) {
        return handedOver(model, null, action);
    }
    try {
        const atNoFolder = action.project === NO_FOLDER_PROJECT;
        const runtime = routeRuntime(action.project, atNoFolder ? action.path : "");
        const tabId = await launchAgent(model, {
            runtime,
            // the flags New Agent remembers apply here too, as they do to an initiative's Work on
            startupCommand: composeStartupCommand(
                runtimeStartupCommand(runtime),
                runtime,
                globalStore.get(naFlagsAtom)[runtime] ?? {}
            ),
            task: action.task,
            projectPath: action.path,
            // No folder tabs are filed under Home, as the launcher files them, so the tree grows no second folder
            projectName: atNoFolder ? HOME_NAME : action.project,
        });
        return handedOver(model, tabId, action);
    } catch (e) {
        return fail(e);
    }
}

// Carries a decision out. Never throws: the outcome says how it went. An answer has nothing to do; a choose puts the
// chooser card up; a send hands the job to the agent as the person's own prompt; a launch opens an agent for it.
// `hook` is the DEV hook's terms (see the hook below).
export async function applyRouteAction(
    model: AgentsViewModel,
    action: RouteAction,
    hook = false
): Promise<RouteOutcome> {
    if (import.meta.env.DEV) {
        lastApplied = action;
    }
    switch (action.kind) {
        case "answer":
            return OK;
        case "choose":
            globalStore.set(petRouteCardAtom, { why: action.why, task: action.task, choices: action.choices });
            return OK;
        case "send":
            return applySend(model, action, hook);
        case "launch":
            return applyLaunch(model, action, hook);
    }
}

// A finished reply: its visible text is the errand's, then the rule decides over the world as it is now (a consult can
// run for two minutes, in which time an agent may have closed or started asking). The errand stays "thinking" while a
// hand-off runs and ends "replied", or failed with the refusal's own words. Call it once the stream has ended, never on a
// chunk still in flight: only a finished reply can be told malformed (splitRouteReply).
async function settleReply(
    model: AgentsViewModel,
    runtime: string,
    request: string,
    reply: string,
    hook: boolean
): Promise<void> {
    const split = splitRouteReply(reply);
    const errand = (text: string, status: "streaming" | "done" | "error") =>
        globalStore.set(petErrandAtom, { prompt: request, runtime, text, status });
    let action: RouteAction;
    try {
        action = decideRoute(split, request, await routeWorld(model));
    } catch (e) {
        errand(errText(e), "error");
        return;
    }
    if (action.kind === "answer") {
        errand(split.visible, "done");
        return;
    }
    errand(split.visible, "streaming");
    const outcome = await applyRouteAction(model, action, hook);
    if ("message" in outcome) {
        errand(outcome.message, "error");
        return;
    }
    errand(split.visible, "done");
}

// The Ask at No folder. A question is answered in the popover; a job goes to the right project's agent, a new one, or a
// card (D2). The consult is filed in the No folder channel as the person's own words and run with the routing prompt
// (D3), and only the text before the `arc-route` block is ever shown.
export async function sendRoutedErrand(model: AgentsViewModel, runtime: string, request: string): Promise<void> {
    hookCard = false;
    globalStore.set(petRouteCardAtom, null);
    globalStore.set(petErrandAtom, { prompt: request, runtime, text: "", status: "streaming" });
    let world: RouteWorldFull;
    try {
        world = await routeWorld(model);
    } catch (e) {
        globalStore.set(petErrandAtom, { prompt: request, runtime, text: errText(e), status: "error" });
        return;
    }
    let visible = "";
    let reply: string;
    try {
        reply = await streamConsult(
            world.noFolderChannelId,
            runtime,
            request,
            buildRoutePrompt(request, world),
            (text) => {
                visible = splitRouteReply(text).visible;
                globalStore.set(petErrandAtom, { prompt: request, runtime, text: visible, status: "streaming" });
            }
        );
    } catch (e) {
        // the backend still posts a consult-reply carrying the error, so the channel keeps the full record
        globalStore.set(petErrandAtom, { prompt: request, runtime, text: visible || errText(e), status: "error" });
        return;
    }
    await settleReply(model, runtime, request, reply, false);
}

// A row of the chooser card was picked: the person chose, so it runs as a clear case (D5) and its band says so. The
// outcome is for the row to show; the card stays up on a failure and is replaced when a project row still leaves several
// agents to choose from.
export async function pickRouteChoice(
    model: AgentsViewModel,
    choice: RouteChoice,
    task: string
): Promise<RouteOutcome> {
    const hook = hookCard;
    try {
        const action = resolveChoice(choice, task, await routeWorld(model));
        const outcome = await applyRouteAction(model, action, hook);
        hookCard = hook && globalStore.get(petRouteCardAtom) != null;
        return outcome;
    } catch (e) {
        return fail(e);
    }
}

// "Wrong project?" (D11): hand the job Jarvis chose a project for to the project the person picked. An agent Jarvis
// opened for it is closed first, since it holds a job that is not its project's; an agent that was open before has read
// the job already, so it keeps it and the job goes on to the right project. Either way the receiving agent carries a
// band that says the person picked it, and this agent's band is gone. The world is read, and a harness for a new agent
// found, before anything is closed, so a failure there loses nothing. A project with several agents shows the chooser
// card, which is the Ask box's, so the popover opens for it. A failure is the outcome for the band to show; one after a
// close has no band left to show it, so the errand carries it too, with the job's own words.
export async function rerouteAgent(model: AgentsViewModel, tabId: string, project: string): Promise<RouteOutcome> {
    const band = globalStore.get(jarvisRouteBandAtom)[tabId];
    if (band == null) {
        return fail("This agent no longer has a routing note, so Jarvis cannot move its job");
    }
    // the DEV hook's dry run (see the hook below) covers this path too, so a scenario that picks a row of the band's
    // list moves the job on a fixture roster without a live session. `dryRun` is only ever set by that hook, which
    // production builds do not have.
    const hook = dryRun;
    let action: RouteAction;
    try {
        action = decideForProject(project, band.task, PICKED_REASON, await routeWorld(model, tabId));
        if (action.kind === "launch") {
            routeRuntime(action.project, action.project === NO_FOLDER_PROJECT ? action.path : "");
        }
    } catch (e) {
        return fail(e);
    }
    if (band.fresh) {
        try {
            const ws = globalStore.get(atoms.workspace);
            if (ws?.oid == null) {
                throw new Error("no active workspace");
            }
            if (!hook) {
                await closeTabLogged(ws.oid, tabId, "jarvis: wrong project");
            }
        } catch (e) {
            return fail(e);
        }
        dismissRouteBand(tabId);
    }
    const outcome = await applyRouteAction(model, action, hook);
    // a card made on hook terms keeps them when a row is picked from it, as pickRouteChoice reads
    hookCard = hook && globalStore.get(petRouteCardAtom) != null;
    if ("message" in outcome) {
        if (band.fresh) {
            globalStore.set(petErrandAtom, {
                prompt: band.task,
                // the reply box's header reads "<runtime> · failed"
                runtime: "jarvis",
                text: `The agent was closed, but its job did not move: ${outcome.message}`,
                status: "error",
            });
            globalStore.set(petPeekOpenAtom, true);
        }
        return outcome;
    }
    dismissRouteBand(tabId);
    if (action.kind === "choose") {
        globalStore.set(petPeekOpenAtom, true);
    }
    return outcome;
}

// cdp reaches the post-stream path without a consult: the Final check may not spend tokens or open an agent just to
// photograph a card, and a fixture agent has no session to take a job. This is compiled out of production builds.
//   finish(request, reply)  runs a canned reply as the stream's end: its visible text into the errand, then the rule.
//   setDryRun(on)           skips AgentsAssignCommand; the escort, the peek, the band and the card still happen. Off by
//                           default: a hand-off to a fixture agent then reaches the real command and its refusal. With
//                           it on, a "Wrong project?" pick (rerouteAgent) takes the same terms, and closes no tab.
//   lastAction()            the action the rule last chose, or null.
// finish never calls the real launchAgent or closeTabLogged, whatever the dry run says: it records a launch, sets no
// band for it (no tab exists), and a card it made keeps these terms. A reroute with the dry run off is the real thing.
if (import.meta.env.DEV) {
    (globalThis as Record<string, unknown>).__waveJarvisRoute = {
        finish: async (request: string, replyText: string): Promise<void> => {
            if (routeModel == null) {
                throw new Error("route model not set: open the pet peek first");
            }
            hookCard = false;
            globalStore.set(petRouteCardAtom, null);
            await settleReply(routeModel, "claude", request, replyText, true);
            hookCard = globalStore.get(petRouteCardAtom) != null;
        },
        setDryRun: (on: boolean) => {
            dryRun = !!on;
        },
        lastAction: (): RouteAction | null => lastApplied,
    };
}
