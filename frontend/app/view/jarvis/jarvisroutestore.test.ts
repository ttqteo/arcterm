// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { globalStore } from "@/app/store/jotaiStore";
import { atom, type PrimitiveAtom } from "jotai";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const calls: string[] = [];
const ensureNoFolder = vi.fn();
const assign = vi.fn();
const postMessage = vi.fn();
const consult = vi.fn();
const launchAgent = vi.fn();
const closeTabLogged = vi.fn();
const openTarget = vi.fn();
const loadCouncils = vi.fn();
const councilsAtom = atom<any[] | null>(null) as PrimitiveAtom<any[] | null>;

vi.mock("@/app/store/wshclientapi", () => ({
    RpcApi: {
        EnsureNoFolderCommand: (...a: any[]) => ensureNoFolder(...a),
        AgentsAssignCommand: (...a: any[]) => assign(...a),
        PostChannelMessageCommand: (...a: any[]) => postMessage(...a),
        ConsultCommand: (...a: any[]) => consult(...a),
    },
}));
vi.mock("@/app/store/wshrpcutil", () => ({ TabRpcClient: {} }));
vi.mock("@/app/cockpit/cockpit-actions", async (orig) => ({
    ...(await orig<typeof import("@/app/cockpit/cockpit-actions")>()),
    launchAgent: (...a: any[]) => launchAgent(...a),
}));
vi.mock("@/app/view/agents/closetab", () => ({
    logClose: vi.fn(),
    closeTabLogged: (...a: any[]) => closeTabLogged(...a),
}));
vi.mock("@/app/store/global-atoms", async (orig) => {
    const real = await orig<typeof import("@/app/store/global-atoms")>();
    return { ...real, atoms: { ...real.atoms, workspace: atom({ oid: "ws1", tabids: [] as string[] }) } };
});
vi.mock("./openref", async (orig) => ({
    ...(await orig<typeof import("./openref")>()),
    openTarget: (...a: any[]) => openTarget(...a),
}));
vi.mock("@/app/view/agents/councilstore", async (orig) => ({
    ...(await orig<typeof import("@/app/view/agents/councilstore")>()),
    councilListAtom: () => councilsAtom,
    loadCouncils: (...a: any[]) => loadCouncils(...a),
}));
vi.mock("@/app/view/agents/projectsstore", async (orig) => ({
    ...(await orig<typeof import("@/app/view/agents/projectsstore")>()),
    projectsAtom: atom<Record<string, { path: string }>>({}),
}));

import { emptyHarnessPreference, harnessesAtom, harnessPreferenceAtom } from "@/app/view/agents/harnessstore";
import { HOME_NAME } from "@/app/view/agents/launcher";
import { launcherRuntimeAtom } from "@/app/view/agents/launcherstore";
import { projectsAtom } from "@/app/view/agents/projectsstore";
import { NO_FOLDER_PROJECT } from "./jarvisroute";
import {
    applyRouteAction,
    dismissRouteBand,
    forgetNoFolder,
    jarvisRouteBandAtom,
    pickRouteChoice,
    rerouteAgent,
    routeRuntime,
    routeWorld,
    sendRoutedErrand,
    setRouteModel,
} from "./jarvisroutestore";
import { NO_FOLDER_DEST, petErrandAtom, petPeekOpenAtom, petRouteCardAtom } from "./petstore";

const NO_FOLDER_PATH = "C:/Users/me/.arc/no-folder";
const LOOM = "D:/work/loom";
const ATLAS = "D:/work/atlas";

function vm(over: { id: string } & Record<string, unknown>) {
    return { name: over.id, kind: "agent", agent: "claude", project: "loom", state: "idle", task: "", ...over };
}

const agentsAtom = atom<any[]>([]) as PrimitiveAtom<any[]>;
const model = { agentsAtom, surfaceAtom: atom("cockpit") } as any;

function harness(runtime: string, installed = true) {
    return { runtime, installed, runworkercapable: true } as any;
}
const ALL_HARNESSES = ["claude", "pi", "agy", "codex"].map((r) => harness(r));

function replyOf(json: object, lead = "On it."): string {
    return `${lead}\n\n\`\`\`arc-route\n${JSON.stringify(json)}\n\`\`\`\n`;
}
function verdictJson(over: Record<string, unknown> = {}) {
    return {
        project: "loom",
        agent: "",
        ambiguous: false,
        task: "fix the race",
        reason: "it names loom",
        considered: [],
        ...over,
    };
}
function streamOf(...chunks: string[]) {
    return (async function* () {
        for (const text of chunks) {
            yield { text };
        }
    })();
}
// the reply as a stream cut into pieces of `size` characters, so the fence arrives in parts
function pieces(text: string, size: number): string[] {
    const out: string[] = [];
    for (let i = 0; i < text.length; i += size) {
        out.push(text.slice(i, i + size));
    }
    return out;
}

beforeEach(() => {
    calls.length = 0;
    ensureNoFolder.mockResolvedValue({ path: NO_FOLDER_PATH, channelid: "nf-ch" });
    assign.mockImplementation(async () => {
        calls.push("assign");
        return { tabid: "x", sentts: 1, midturn: false };
    });
    postMessage.mockResolvedValue(undefined);
    launchAgent.mockImplementation(async () => {
        calls.push("launch");
        return "new-tab";
    });
    closeTabLogged.mockImplementation(async () => {
        calls.push("close");
        return {};
    });
    openTarget.mockResolvedValue({ ok: true });
    loadCouncils.mockImplementation(async () => {
        // the list arrives a tick after the call: a caller that did not await it would read null
        await Promise.resolve();
        globalStore.set(councilsAtom, []);
    });
    globalStore.set(projectsAtom as any, { loom: { path: LOOM }, atlas: { path: ATLAS } });
    globalStore.set(harnessesAtom, ALL_HARNESSES);
    globalStore.set(harnessPreferenceAtom, emptyHarnessPreference);
    globalStore.set(launcherRuntimeAtom, null);
    globalStore.set(agentsAtom, []);
    globalStore.set(councilsAtom, null);
    setRouteModel(model);
});

afterEach(() => {
    vi.clearAllMocks();
    globalStore.set(petErrandAtom, null);
    globalStore.set(petRouteCardAtom, null);
    globalStore.set(petPeekOpenAtom, false);
    globalStore.set(jarvisRouteBandAtom, {});
});

describe("routeWorld", () => {
    it("lists the registered projects, the No folder path and the open agents of the cockpit", async () => {
        globalStore.set(agentsAtom, [vm({ id: "t1", task: "fix it" })]);
        const world = await routeWorld(model);
        expect(world.noFolderPath).toBe(NO_FOLDER_PATH);
        expect(world.projects).toEqual([
            { name: "atlas", path: ATLAS },
            { name: "loom", path: LOOM },
        ]);
        expect(world.agents.map((a) => a.id)).toEqual(["t1"]);
    });

    it("leaves out the tab it is told to exclude", async () => {
        globalStore.set(agentsAtom, [vm({ id: "t1" }), vm({ id: "t2" })]);
        expect((await routeWorld(model, "t1")).agents.map((a) => a.id)).toEqual(["t2"]);
    });

    it("drops an agent sitting in a council seat, reading the list only after it loaded", async () => {
        globalStore.set(agentsAtom, [vm({ id: "t1" }), vm({ id: "t2" })]);
        loadCouncils.mockImplementation(async () => {
            await Promise.resolve();
            globalStore.set(councilsAtom, [{ experts: [{ id: "e1", agent: "t1" }, { id: "e2" }] }]);
        });
        const world = await routeWorld(model);
        expect(loadCouncils).toHaveBeenCalledWith("");
        expect(world.agents.map((a) => a.id)).toEqual(["t2"]);
    });

    // loadCouncils swallows its errors: a null list after it is a list that never loaded, not "no seats"
    it("refuses to read an unloaded council list as no seats", async () => {
        loadCouncils.mockResolvedValue(undefined);
        await expect(routeWorld(model)).rejects.toThrow("Could not read councils");
    });
});

describe("routeRuntime", () => {
    it("uses the launcher's remembered harness while it is one Jarvis can hand a job to", () => {
        globalStore.set(launcherRuntimeAtom, "pi");
        expect(routeRuntime("loom", NO_FOLDER_PATH)).toBe("pi");
    });

    it("never starts a plain terminal: a remembered terminal falls back to the harness preference", () => {
        globalStore.set(launcherRuntimeAtom, "terminal");
        globalStore.set(harnessPreferenceAtom, { ...emptyHarnessPreference, route: { runtime: "agy" } as any });
        expect(routeRuntime("loom", NO_FOLDER_PATH)).toBe("agy");
    });

    it("falls back from a remembered codex, which AgentsAssignCommand cannot reach", () => {
        globalStore.set(launcherRuntimeAtom, "codex");
        globalStore.set(harnessPreferenceAtom, { ...emptyHarnessPreference, route: { runtime: "codex" } as any });
        expect(routeRuntime("loom", NO_FOLDER_PATH)).toBe("claude");
    });

    it("skips a remembered harness whose CLI is not installed", () => {
        globalStore.set(launcherRuntimeAtom, "pi");
        globalStore.set(harnessesAtom, [harness("claude"), harness("pi", false)]);
        expect(routeRuntime("loom", NO_FOLDER_PATH)).toBe("claude");
    });

    it("starts claude when the harness catalog is empty", () => {
        globalStore.set(harnessesAtom, []);
        expect(routeRuntime("loom", NO_FOLDER_PATH)).toBe("claude");
    });

    it("starts only claude in No folder, whatever is remembered or preferred", () => {
        globalStore.set(launcherRuntimeAtom, "pi");
        globalStore.set(harnessPreferenceAtom, { ...emptyHarnessPreference, route: { runtime: "agy" } as any });
        expect(routeRuntime(NO_FOLDER_PROJECT, NO_FOLDER_PATH)).toBe("claude");
    });

    it("throws when nothing usable is installed", () => {
        globalStore.set(harnessesAtom, [harness("claude", false), harness("pi", false)]);
        expect(() => routeRuntime("loom", NO_FOLDER_PATH)).toThrow("No agent harness to start");
    });
});

describe("sendRoutedErrand", () => {
    it("hands a clear job to the one open agent, as the raw task, and escorts there", async () => {
        globalStore.set(agentsAtom, [vm({ id: "t1" })]);
        globalStore.set(petPeekOpenAtom, true);
        consult.mockReturnValue(streamOf(replyOf(verdictJson({ task: "fix the race" }), "Sending it to loom.")));
        await sendRoutedErrand(model, "claude", "please fix the race in loom");
        expect(assign).toHaveBeenCalledTimes(1);
        expect(assign).toHaveBeenCalledWith(expect.anything(), { tab: "t1", text: "fix the race" });
        expect(openTarget).toHaveBeenCalledWith(model, { kind: "agent", tabId: "t1" }, expect.any(Function));
        expect(launchAgent).not.toHaveBeenCalled();
        expect(globalStore.get(petPeekOpenAtom)).toBe(false);
        expect(globalStore.get(petRouteCardAtom)).toBeNull();
        expect(globalStore.get(jarvisRouteBandAtom)["t1"]).toEqual({
            project: "loom",
            reason: "it names loom",
            task: "fix the race",
            fresh: false,
        });
        expect(globalStore.get(petErrandAtom)).toEqual({
            prompt: "please fix the race in loom",
            runtime: "claude",
            text: "Sending it to loom.",
            status: "done",
        });
    });

    it("posts only the person's words and sends the routing prompt to the consult", async () => {
        consult.mockReturnValue(streamOf("It is 42."));
        await sendRoutedErrand(model, "claude", "what is 6 x 7?");
        expect(postMessage).toHaveBeenCalledWith(
            expect.anything(),
            expect.objectContaining({ channelid: "nf-ch", kind: "consult", author: "you", text: "what is 6 x 7?" })
        );
        const sent = consult.mock.calls[0][1];
        expect(sent.channelid).toBe("nf-ch");
        expect(sent.runtime).toBe("claude");
        expect(sent.prompt).toContain("arc-route");
        expect(sent.prompt.endsWith("what is 6 x 7?")).toBe(true);
    });

    it("settles a reply with no block as an answer and does nothing else", async () => {
        globalStore.set(petPeekOpenAtom, true);
        consult.mockReturnValue(streamOf("Use ", "`git rebase --onto`."));
        await sendRoutedErrand(model, "claude", "how do I move a branch?");
        expect(globalStore.get(petErrandAtom)).toMatchObject({ text: "Use `git rebase --onto`.", status: "done" });
        expect(assign).not.toHaveBeenCalled();
        expect(launchAgent).not.toHaveBeenCalled();
        expect(globalStore.get(petRouteCardAtom)).toBeNull();
        expect(globalStore.get(petPeekOpenAtom)).toBe(true);
        expect(globalStore.get(jarvisRouteBandAtom)).toEqual({});
    });

    it("never shows the arc-route block, however the stream is cut", async () => {
        const reply = replyOf(verdictJson(), "Sending it to loom.");
        const seen: string[] = [];
        const unsub = globalStore.sub(petErrandAtom, () => {
            const e = globalStore.get(petErrandAtom);
            if (e != null) {
                seen.push(e.text);
            }
        });
        for (const size of [1, 3, 7, reply.length]) {
            consult.mockReturnValue(streamOf(...pieces(reply, size)));
            await sendRoutedErrand(model, "claude", "fix the race in loom");
        }
        unsub();
        expect(seen.length).toBeGreaterThan(4);
        for (const text of seen) {
            expect(text).not.toContain("arc-route");
            expect(text).not.toContain("```");
            expect(text).not.toContain("{");
        }
    });

    it("launches a fresh agent in the project when none is open: path, no branch, the remembered harness", async () => {
        globalStore.set(launcherRuntimeAtom, "pi");
        globalStore.set(petPeekOpenAtom, true);
        consult.mockReturnValue(streamOf(replyOf(verdictJson({ project: "atlas", task: "add the chart" }))));
        await sendRoutedErrand(model, "claude", "add a chart to atlas");
        expect(launchAgent).toHaveBeenCalledTimes(1);
        const [m, opts] = launchAgent.mock.calls[0];
        expect(m).toBe(model);
        expect(opts).toMatchObject({
            runtime: "pi",
            startupCommand: "pi",
            task: "add the chart",
            projectPath: ATLAS,
            projectName: "atlas",
        });
        expect(opts.branch).toBeUndefined();
        expect(assign).not.toHaveBeenCalled();
        expect(globalStore.get(petPeekOpenAtom)).toBe(false);
        expect(globalStore.get(jarvisRouteBandAtom)["new-tab"]).toEqual({
            project: "atlas",
            reason: "it names loom",
            task: "add the chart",
            fresh: true,
        });
    });

    it("launches claude in No folder under the name Home, whatever harness is preferred", async () => {
        globalStore.set(harnessPreferenceAtom, { ...emptyHarnessPreference, route: { runtime: "pi" } as any });
        consult.mockReturnValue(streamOf(replyOf(verdictJson({ project: "no-folder", task: "tidy my notes" }))));
        await sendRoutedErrand(model, "claude", "tidy my notes");
        expect(launchAgent).toHaveBeenCalledTimes(1);
        expect(launchAgent.mock.calls[0][1]).toMatchObject({
            runtime: "claude",
            startupCommand: "claude",
            projectPath: NO_FOLDER_PATH,
            projectName: HOME_NAME,
            task: "tidy my notes",
        });
        expect(globalStore.get(jarvisRouteBandAtom)["new-tab"]).toMatchObject({ project: NO_FOLDER_PROJECT });
    });

    it("never sends to an agent sitting in a council seat", async () => {
        globalStore.set(agentsAtom, [vm({ id: "t1" })]);
        loadCouncils.mockImplementation(async () => {
            await Promise.resolve();
            globalStore.set(councilsAtom, [{ experts: [{ id: "e1", agent: "t1" }] }]);
        });
        consult.mockReturnValue(streamOf(replyOf(verdictJson({ agent: "t1" }))));
        await sendRoutedErrand(model, "claude", "fix the race in loom");
        expect(assign).not.toHaveBeenCalled();
        expect(launchAgent).toHaveBeenCalledTimes(1);
    });

    it("fills the chooser card for an ambiguous verdict and calls nothing", async () => {
        globalStore.set(agentsAtom, [vm({ id: "t1" })]);
        globalStore.set(petPeekOpenAtom, true);
        consult.mockReturnValue(
            streamOf(
                replyOf(
                    verdictJson({
                        ambiguous: true,
                        project: "",
                        reason: "both could own it",
                        considered: ["loom", "atlas"],
                    }),
                    "Not sure."
                )
            )
        );
        await sendRoutedErrand(model, "claude", "fix the chart");
        expect(assign).not.toHaveBeenCalled();
        expect(launchAgent).not.toHaveBeenCalled();
        expect(closeTabLogged).not.toHaveBeenCalled();
        const card = globalStore.get(petRouteCardAtom);
        expect(card?.why).toBe("both could own it");
        expect(card?.task).toBe("fix the race");
        expect(card?.choices.map((c) => c.kind)).toEqual(["project", "project", "launch"]);
        expect(globalStore.get(petPeekOpenAtom)).toBe(true);
        expect(globalStore.get(petErrandAtom)).toMatchObject({ text: "Not sure.", status: "done" });
        expect(globalStore.get(jarvisRouteBandAtom)).toEqual({});
    });

    it("offers every project on a block that does not read", async () => {
        consult.mockReturnValue(streamOf("Trying.\n```arc-route\n{not json\n```"));
        await sendRoutedErrand(model, "claude", "do something");
        expect(assign).not.toHaveBeenCalled();
        expect(globalStore.get(petRouteCardAtom)?.choices.map((c) => c.kind)).toEqual(["project", "project", "launch"]);
    });

    it("leaves the errand failed, with the refusal's message, and the peek open when the hand-off is refused", async () => {
        globalStore.set(agentsAtom, [vm({ id: "t1" })]);
        globalStore.set(petPeekOpenAtom, true);
        assign.mockRejectedValue(new Error("tab t1 is not a live agent session"));
        consult.mockReturnValue(streamOf(replyOf(verdictJson())));
        await sendRoutedErrand(model, "claude", "fix the race in loom");
        expect(globalStore.get(petErrandAtom)).toEqual({
            prompt: "fix the race in loom",
            runtime: "claude",
            text: "tab t1 is not a live agent session",
            status: "error",
        });
        expect(globalStore.get(petPeekOpenAtom)).toBe(true);
        expect(openTarget).not.toHaveBeenCalled();
        expect(globalStore.get(jarvisRouteBandAtom)).toEqual({});
    });

    it("reports a launch that cannot start a harness on the errand", async () => {
        globalStore.set(harnessesAtom, [harness("claude", false)]);
        globalStore.set(petPeekOpenAtom, true);
        consult.mockReturnValue(streamOf(replyOf(verdictJson())));
        await sendRoutedErrand(model, "claude", "fix the race in loom");
        expect(launchAgent).not.toHaveBeenCalled();
        expect(globalStore.get(petErrandAtom)).toMatchObject({ text: "No agent harness to start", status: "error" });
        expect(globalStore.get(petPeekOpenAtom)).toBe(true);
    });

    it("reports a consult that failed, keeping what streamed first", async () => {
        consult.mockReturnValue(
            (async function* () {
                yield { text: "Partial. " };
                throw new Error("runtime not installed");
            })()
        );
        await sendRoutedErrand(model, "claude", "q");
        // a reply with no block is shown as it came, as sendErrand shows one
        expect(globalStore.get(petErrandAtom)).toMatchObject({ text: "Partial. ", status: "error" });
        expect(assign).not.toHaveBeenCalled();
    });

    it("reports a failed world read on the errand before any consult", async () => {
        // the cache holds a success only, so a failure is read again next time
        ensureNoFolder.mockRejectedValue(new Error("no such folder"));
        forgetNoFolder();
        await sendRoutedErrand(model, "claude", "q");
        expect(globalStore.get(petErrandAtom)).toMatchObject({ text: "no such folder", status: "error" });
        expect(consult).not.toHaveBeenCalled();
    });

    it("reports an agent that was sent the job but could not be opened, and keeps the peek", async () => {
        globalStore.set(agentsAtom, [vm({ id: "t1" })]);
        globalStore.set(petPeekOpenAtom, true);
        openTarget.mockResolvedValue({ ok: false, reason: "failed", message: "Couldn't open agent t1: gone" });
        consult.mockReturnValue(streamOf(replyOf(verdictJson())));
        await sendRoutedErrand(model, "claude", "fix the race in loom");
        const errand = globalStore.get(petErrandAtom);
        expect(errand?.status).toBe("error");
        expect(errand?.text).toContain("Couldn't open agent t1: gone");
        expect(globalStore.get(petPeekOpenAtom)).toBe(true);
    });
});

describe("pickRouteChoice", () => {
    it("sends the card's job to the agent whose row was picked and sets a band that says the person picked it", async () => {
        globalStore.set(petPeekOpenAtom, true);
        const out = await pickRouteChoice(
            model,
            { kind: "agent", agentId: "t2", project: "loom", label: "t2" },
            "fix the race"
        );
        expect(out).toEqual({ ok: true });
        expect(assign).toHaveBeenCalledWith(expect.anything(), { tab: "t2", text: "fix the race" });
        expect(globalStore.get(jarvisRouteBandAtom)["t2"]).toMatchObject({ reason: "you picked it", fresh: false });
        expect(globalStore.get(petPeekOpenAtom)).toBe(false);
    });

    it("replaces the card when a project row still has several agents to choose from", async () => {
        globalStore.set(agentsAtom, [vm({ id: "t1" }), vm({ id: "t2" })]);
        globalStore.set(petRouteCardAtom, { why: "unsure", task: "fix the race", choices: [] });
        const out = await pickRouteChoice(model, { kind: "project", project: "loom", label: "loom" }, "fix the race");
        expect(out).toEqual({ ok: true });
        expect(assign).not.toHaveBeenCalled();
        const card = globalStore.get(petRouteCardAtom);
        expect(card?.choices.map((c) => c.kind)).toEqual(["agent", "agent", "launch"]);
    });

    it("returns a refusal for the row to show and leaves the card where it is", async () => {
        const card = { why: "unsure", task: "t", choices: [] };
        globalStore.set(petRouteCardAtom, card);
        assign.mockRejectedValue(new Error("tab t2 has a question open, and the job would answer it"));
        const out = await pickRouteChoice(model, { kind: "agent", agentId: "t2", project: "loom", label: "t2" }, "t");
        expect(out).toEqual({ ok: false, message: "tab t2 has a question open, and the job would answer it" });
        expect(globalStore.get(petRouteCardAtom)).toBe(card);
    });
});

describe("rerouteAgent", () => {
    it("closes a fresh agent before it launches in the picked project, and never sends to the closed tab", async () => {
        globalStore.set(agentsAtom, [vm({ id: "new-1" }), vm({ id: "t9", project: "atlas" })]);
        globalStore.set(jarvisRouteBandAtom, {
            "new-1": { project: "loom", reason: "it names loom", task: "fix the race", fresh: true },
        });
        // atlas has t9 open, so a pick of loom (now empty once new-1 is excluded) launches
        const out = await rerouteAgent(model, "new-1", "loom");
        expect(out).toEqual({ ok: true });
        expect(calls).toEqual(["close", "launch"]);
        expect(closeTabLogged).toHaveBeenCalledWith("ws1", "new-1", expect.any(String));
        expect(assign).not.toHaveBeenCalled();
        expect(launchAgent.mock.calls[0][1]).toMatchObject({
            projectName: "loom",
            projectPath: LOOM,
            task: "fix the race",
        });
        const bands = globalStore.get(jarvisRouteBandAtom);
        expect(bands["new-1"]).toBeUndefined();
        expect(bands["new-tab"]).toEqual({
            project: "loom",
            reason: "you picked it",
            task: "fix the race",
            fresh: true,
        });
    });

    it("hands the job to the agent open in the picked project instead of launching", async () => {
        globalStore.set(agentsAtom, [vm({ id: "new-1" }), vm({ id: "t9", project: "atlas" })]);
        globalStore.set(jarvisRouteBandAtom, {
            "new-1": { project: "loom", reason: "r", task: "chart it", fresh: true },
        });
        const out = await rerouteAgent(model, "new-1", "atlas");
        expect(out).toEqual({ ok: true });
        expect(calls).toEqual(["close", "assign"]);
        expect(assign).toHaveBeenCalledWith(expect.anything(), { tab: "t9", text: "chart it" });
        expect(globalStore.get(jarvisRouteBandAtom)["t9"]).toMatchObject({ reason: "you picked it", fresh: false });
    });

    it("does not close an agent that was open before, only hands the job on and drops its band", async () => {
        globalStore.set(agentsAtom, [vm({ id: "t1" }), vm({ id: "t9", project: "atlas" })]);
        globalStore.set(jarvisRouteBandAtom, {
            t1: { project: "loom", reason: "r", task: "chart it", fresh: false },
        });
        const out = await rerouteAgent(model, "t1", "atlas");
        expect(out).toEqual({ ok: true });
        expect(closeTabLogged).not.toHaveBeenCalled();
        expect(assign).toHaveBeenCalledWith(expect.anything(), { tab: "t9", text: "chart it" });
        expect(globalStore.get(jarvisRouteBandAtom)["t1"]).toBeUndefined();
    });

    it("never sends back to the agent it is leaving, even when the picked project is its own", async () => {
        globalStore.set(agentsAtom, [vm({ id: "t1" })]);
        globalStore.set(jarvisRouteBandAtom, { t1: { project: "loom", reason: "r", task: "x", fresh: false } });
        await rerouteAgent(model, "t1", "loom");
        expect(assign).not.toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ tab: "t1" }));
        expect(launchAgent).toHaveBeenCalledTimes(1);
    });

    it("returns a failure for the band and keeps a non-fresh agent's band when the hand-off is refused", async () => {
        globalStore.set(agentsAtom, [vm({ id: "t1" }), vm({ id: "t9", project: "atlas" })]);
        const band = { project: "loom", reason: "r", task: "chart it", fresh: false };
        globalStore.set(jarvisRouteBandAtom, { t1: band });
        assign.mockRejectedValue(new Error("tab t9 is not a live agent session"));
        const out = await rerouteAgent(model, "t1", "atlas");
        expect(out).toEqual({ ok: false, message: "tab t9 is not a live agent session" });
        expect(globalStore.get(jarvisRouteBandAtom)["t1"]).toEqual(band);
    });

    // the closed agent has no band left to show it, so the errand says it, with the way the job went
    it("puts the failure on the errand too when it came after a fresh agent was closed", async () => {
        globalStore.set(agentsAtom, [vm({ id: "new-1" }), vm({ id: "t9", project: "atlas" })]);
        globalStore.set(jarvisRouteBandAtom, {
            "new-1": { project: "loom", reason: "r", task: "chart it", fresh: true },
        });
        assign.mockRejectedValue(new Error("tab t9 is not a live agent session"));
        const out = await rerouteAgent(model, "new-1", "atlas");
        expect(out).toEqual({ ok: false, message: "tab t9 is not a live agent session" });
        expect(globalStore.get(jarvisRouteBandAtom)["new-1"]).toBeUndefined();
        const errand = globalStore.get(petErrandAtom);
        expect(errand).toMatchObject({ prompt: "chart it", runtime: "jarvis", status: "error" });
        expect(errand?.text).toContain("tab t9 is not a live agent session");
        expect(globalStore.get(petPeekOpenAtom)).toBe(true);
    });

    it("fails before closing anything when the harness cannot start", async () => {
        globalStore.set(agentsAtom, [vm({ id: "new-1" })]);
        globalStore.set(harnessesAtom, [harness("claude", false)]);
        globalStore.set(jarvisRouteBandAtom, { "new-1": { project: "loom", reason: "r", task: "x", fresh: true } });
        const out = await rerouteAgent(model, "new-1", "atlas");
        expect(out).toEqual({ ok: false, message: "No agent harness to start" });
        expect(closeTabLogged).not.toHaveBeenCalled();
        expect(globalStore.get(jarvisRouteBandAtom)["new-1"]).toBeDefined();
    });

    it("shows the card for a project with several agents, after closing a fresh agent", async () => {
        globalStore.set(agentsAtom, [
            vm({ id: "new-1" }),
            vm({ id: "a1", project: "atlas" }),
            vm({ id: "a2", project: "atlas" }),
        ]);
        globalStore.set(jarvisRouteBandAtom, { "new-1": { project: "loom", reason: "r", task: "x", fresh: true } });
        const out = await rerouteAgent(model, "new-1", "atlas");
        expect(out).toEqual({ ok: true });
        expect(calls).toEqual(["close"]);
        expect(globalStore.get(petRouteCardAtom)?.choices.map((c) => c.kind)).toEqual(["agent", "agent", "launch"]);
        expect(globalStore.get(petPeekOpenAtom)).toBe(true);
    });

    it("says so when the agent no longer has a band", async () => {
        const out = await rerouteAgent(model, "gone", "loom");
        expect(out.ok).toBe(false);
        expect(closeTabLogged).not.toHaveBeenCalled();
    });
});

describe("dismissRouteBand", () => {
    it("removes one tab's band and leaves the others", () => {
        const band = { project: "loom", reason: "", task: "x", fresh: false };
        globalStore.set(jarvisRouteBandAtom, { a: band, b: band });
        dismissRouteBand("a");
        expect(Object.keys(globalStore.get(jarvisRouteBandAtom))).toEqual(["b"]);
    });
});

describe("applyRouteAction", () => {
    it("treats an answer as nothing to do", async () => {
        expect(await applyRouteAction(model, { kind: "answer" })).toEqual({ ok: true });
        expect(assign).not.toHaveBeenCalled();
    });

    it("takes NO_FOLDER_DEST as the No folder sentinel", () => {
        expect(NO_FOLDER_DEST).toBe("no-folder");
    });
});

describe("the DEV hook", () => {
    const hook = () =>
        (globalThis as any).__waveJarvisRoute as {
            finish(request: string, reply: string): Promise<void>;
            setDryRun(on: boolean): void;
            lastAction(): any;
        };

    afterEach(() => hook().setDryRun(false));

    it("exists in a dev build", () => {
        expect(typeof hook().finish).toBe("function");
    });

    it("runs the post-stream path on a canned reply: visible text first, then the decision", async () => {
        globalStore.set(agentsAtom, [vm({ id: "t1" })]);
        globalStore.set(petPeekOpenAtom, true);
        await hook().finish("fix the race", replyOf(verdictJson(), "On it."));
        expect(globalStore.get(petErrandAtom)).toMatchObject({ text: "On it.", status: "done" });
        expect(hook().lastAction()).toMatchObject({ kind: "send", agentId: "t1" });
        expect(assign).toHaveBeenCalledTimes(1);
    });

    it("skips the hand-off in a dry run but still escorts, closes the peek and sets the band", async () => {
        globalStore.set(agentsAtom, [vm({ id: "t1" })]);
        globalStore.set(petPeekOpenAtom, true);
        hook().setDryRun(true);
        await hook().finish("fix the race", replyOf(verdictJson()));
        expect(assign).not.toHaveBeenCalled();
        expect(openTarget).toHaveBeenCalledWith(model, { kind: "agent", tabId: "t1" }, expect.any(Function));
        expect(globalStore.get(petPeekOpenAtom)).toBe(false);
        expect(globalStore.get(jarvisRouteBandAtom)["t1"]).toMatchObject({ fresh: false });
    });

    it("never launches or closes for real, and a launch it records sets no band", async () => {
        globalStore.set(petPeekOpenAtom, true);
        for (const dry of [true, false]) {
            hook().setDryRun(dry);
            await hook().finish("chart it", replyOf(verdictJson({ project: "atlas", task: "chart it" })));
            expect(hook().lastAction()).toMatchObject({ kind: "launch", project: "atlas", path: ATLAS });
        }
        expect(launchAgent).not.toHaveBeenCalled();
        expect(closeTabLogged).not.toHaveBeenCalled();
        expect(globalStore.get(jarvisRouteBandAtom)).toEqual({});
        expect(globalStore.get(petPeekOpenAtom)).toBe(false);
    });

    it("keeps a card it made on hook terms: a launch row picked from it does not launch for real", async () => {
        await hook().finish("fix the chart", replyOf(verdictJson({ ambiguous: true, project: "" })));
        expect(globalStore.get(petRouteCardAtom)).not.toBeNull();
        await pickRouteChoice(
            model,
            {
                kind: "launch",
                project: NO_FOLDER_PROJECT,
                path: NO_FOLDER_PATH,
                label: "Open a new agent in No folder",
            },
            "fix the chart"
        );
        expect(launchAgent).not.toHaveBeenCalled();
        expect(hook().lastAction()).toMatchObject({ kind: "launch", project: NO_FOLDER_PROJECT });
    });

    it("takes a Wrong project? pick on the dry run's terms: no real hand-off and no tab closed, the band still moves", async () => {
        globalStore.set(agentsAtom, [vm({ id: "t1" }), vm({ id: "t9", project: "atlas" })]);
        globalStore.set(jarvisRouteBandAtom, { t1: { project: "loom", reason: "r", task: "chart it", fresh: true } });
        hook().setDryRun(true);
        const out = await rerouteAgent(model, "t1", "atlas");
        expect(out).toEqual({ ok: true });
        expect(assign).not.toHaveBeenCalled();
        expect(closeTabLogged).not.toHaveBeenCalled();
        expect(launchAgent).not.toHaveBeenCalled();
        const bands = globalStore.get(jarvisRouteBandAtom);
        expect(bands["t1"]).toBeUndefined();
        expect(bands["t9"]).toMatchObject({ reason: "you picked it", fresh: false });
    });

    it("lands a refused hand-off on the errand when dry run is off", async () => {
        globalStore.set(agentsAtom, [vm({ id: "t1" })]);
        globalStore.set(petPeekOpenAtom, true);
        assign.mockRejectedValue(new Error("tab t1 is not a live agent session"));
        await hook().finish("fix the race", replyOf(verdictJson()));
        expect(globalStore.get(petErrandAtom)).toMatchObject({
            status: "error",
            text: "tab t1 is not a live agent session",
        });
        expect(globalStore.get(petPeekOpenAtom)).toBe(true);
    });
});
