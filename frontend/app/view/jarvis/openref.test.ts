// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const rpc = vi.hoisted(() => ({
    GetDossierCommand: vi.fn(),
    ListTaskDossiersCommand: vi.fn(),
    GetChannelRunsCommand: vi.fn(),
    GetChannelRunChangesCommand: vi.fn(),
    GetChannelMessagesCommand: vi.fn(),
    SetChannelReadCommand: vi.fn(),
    EffortGetCommand: vi.fn(),
    FileInfoCommand: vi.fn(),
    FileReadCommand: vi.fn(),
    SetMetaCommand: vi.fn(),
    ReadVaultNoteCommand: vi.fn(),
    ListMemoryHygieneCommand: vi.fn(),
    BoardListCommand: vi.fn(),
}));
const openBoardSpy = vi.hoisted(() => vi.fn());
const loadAndPin = vi.hoisted(() => vi.fn());
const resolveCwd = vi.hoisted(() => vi.fn());
const pushToast = vi.hoisted(() => vi.fn());

vi.mock("@/app/store/wshclientapi", () => ({ RpcApi: rpc }));
vi.mock("@/app/store/wshrpcutil", () => ({ TabRpcClient: {} }));
vi.mock("@/app/store/wos", async () => {
    const { atom } = await import("jotai");
    return {
        loadAndPinWaveObject: (...a: unknown[]) => loadAndPin(...a),
        makeORef: (otype: string, oid: string) => `${otype}:${oid}`,
        getWaveObjectAtom: () => atom(null),
    };
});
vi.mock("../agents/agentcwdresolve", () => ({ resolveCwd: (...a: unknown[]) => resolveCwd(...a) }));
vi.mock("@/app/cockpit/notificationstore", () => ({ pushToast: (...a: unknown[]) => pushToast(...a) }));
// openBoard drives the cell (focus, chat mode, the grid), which the split's own tests cover: here only that the router calls it
vi.mock("../boards/boardsplitstore", async (importOriginal) => ({
    ...(await importOriginal<typeof import("../boards/boardsplitstore")>()),
    openBoard: (...a: unknown[]) => openBoardSpy(...a),
}));

import { globalStore } from "@/app/store/jotaiStore";
import { setPlatform } from "@/util/platformutil";
import { atom } from "jotai";
import { centerModeAtom } from "../agents/agentcenter";
import type { AgentsViewModel, SurfaceKey } from "../agents/agents";
import type { AgentVM } from "../agents/agentsviewmodel";
import { attachBrainstorm, detachBrainstorm, getBrainstorm } from "../agents/brainstormstore";
import { attachCanvas, detachCanvas, getCanvas, setCanvasMode } from "../agents/canvasstore";
import { activeChannelIdAtom } from "../agents/channelsstore";
import { councilOpenedAtom } from "../agents/councilopened";
import { councilAtom, councilLastViewAtom, councilSelAtom, councilViewAtom } from "../agents/councilstore";
import { memorySelectedChangeAtom, memorySelectedProjectAtom } from "../agents/memorystore";
import { setupTabAtom } from "../agents/setupstore";
import {
    libraryBoardSelAtom,
    libraryCouncilSelAtom,
    libraryCouncilViewAtom,
    libraryTabAtom,
} from "../library/librarystore";
import { dagModalStateAtom, dismissDagModal } from "../orchestrate/dagmodalstate";
import { selectedTaskIdAtom } from "../orchestrate/dagstore";
import type { OpenTarget } from "./address";
import { effortDetailAtom } from "./effortstore";
import { initiativeSheetAtom } from "./initiativesheetstore";
import { briefPeekRecordAtom, briefSheetOpenAtom } from "./jarvisstore";
import { activeRunIdAtom, activeSubjectAtom, recordDetailAtom } from "./jarvissubjectstore";
import {
    isPeekable,
    isPeekableAddress,
    openAddress,
    openOrPeek,
    openOrPeekAddress,
    openTarget,
    peekAddress,
    peekTarget,
} from "./openref";
import { peekItemAtom, type PeekItem } from "./peekstore";
import { pendingDecisionAnchorAtom, petPeekOpenAtom } from "./petstore";
import { taskListAtom, tasksErrorAtom } from "./tasksstore";

const objects = new Map<string, unknown>();

function makeModel(roster: string[] = [], terminals: string[] = []): AgentsViewModel {
    const vm = (id: string) => ({ id, name: id, task: "", state: "working", blockId: `block-${id}` }) as AgentVM;
    return {
        surfaceAtom: atom<SurfaceKey>("cockpit"),
        focusIdAtom: atom<string | undefined>(undefined),
        agentsAtom: atom(roster.map(vm)),
        terminalsAtom: atom<AgentVM[]>(terminals.map(vm)),
        baseRosterAtom: atom(roster.map(vm)),
    } as unknown as AgentsViewModel;
}

function deferred<T>() {
    let resolve!: (value: T) => void;
    const promise = new Promise<T>((r) => (resolve = r));
    return { promise, resolve };
}

beforeEach(() => {
    vi.resetAllMocks();
    objects.clear();
    loadAndPin.mockImplementation((oref: string) => Promise.resolve(objects.get(oref) ?? null));
    rpc.GetChannelRunsCommand.mockResolvedValue({ runs: [] });
    rpc.GetChannelRunChangesCommand.mockResolvedValue({ runids: [], runs: [] });
    rpc.GetChannelMessagesCommand.mockResolvedValue({ messages: [] });
    rpc.SetChannelReadCommand.mockResolvedValue(undefined);
    rpc.EffortGetCommand.mockResolvedValue({ effort: null });
    globalStore.set(taskListAtom, null);
    globalStore.set(tasksErrorAtom, null);
    globalStore.set(briefPeekRecordAtom, null);
    globalStore.set(briefSheetOpenAtom, false);
    globalStore.set(initiativeSheetAtom, { view: "plan", chunk: null });
    globalStore.set(pendingDecisionAnchorAtom, null);
    globalStore.set(activeSubjectAtom, null);
    globalStore.set(activeRunIdAtom, {});
    globalStore.set(recordDetailAtom, {});
    globalStore.set(effortDetailAtom, new Map());
    globalStore.set(peekItemAtom, null);
    globalStore.set(petPeekOpenAtom, false);
    globalStore.set(setupTabAtom, "instructions");
    globalStore.set(memorySelectedProjectAtom, null);
    globalStore.set(memorySelectedChangeAtom, null);
});

describe("run and channel landings", () => {
    it("lands a run on its channel's sheet, on that run", async () => {
        const model = makeModel();
        objects.set("run:r1", { oid: "r1", channeloid: "c1" });
        objects.set("channel:c1", { oid: "c1" });
        expect(await openTarget(model, { kind: "run", runId: "r1" })).toEqual({ ok: true });
        expect(globalStore.get(activeSubjectAtom)).toEqual({ kind: "channel", id: "c1" });
        expect(globalStore.get(activeRunIdAtom)["c1"]).toBe("r1");
        expect(globalStore.get(briefSheetOpenAtom)).toBe(true);
        expect(globalStore.get(model.surfaceAtom)).toBe("jarvis");
    });

    it("reports a missing run and leaves the user where they were", async () => {
        const model = makeModel();
        const result = await openTarget(model, { kind: "run", runId: "r-gone" });
        expect(result).toEqual({ ok: false, reason: "unavailable", message: "That run no longer exists" });
        expect(globalStore.get(model.surfaceAtom)).toBe("cockpit");
        expect(pushToast).toHaveBeenCalledWith({ title: "That run no longer exists", message: "", level: "warn" });
    });

    it("reports a run that has no channel to open it in", async () => {
        const model = makeModel();
        objects.set("run:r1", { oid: "r1", channeloid: "" });
        expect(await openTarget(model, { kind: "run", runId: "r1" })).toEqual({
            ok: false,
            reason: "unavailable",
            message: "That run has no channel to open it in",
        });
        expect(globalStore.get(briefSheetOpenAtom)).toBe(false);
    });

    it("reports a channel that no longer exists", async () => {
        const model = makeModel();
        expect(await openTarget(model, { kind: "channel", channelId: "c-gone" })).toEqual({
            ok: false,
            reason: "unavailable",
            message: "That channel no longer exists",
        });
        expect(rpc.GetChannelRunsCommand).not.toHaveBeenCalled();
    });

    it("names the target when a load throws", async () => {
        const model = makeModel();
        loadAndPin.mockRejectedValue(new Error("db closed"));
        expect(await openTarget(model, { kind: "run", runId: "r1" })).toEqual({
            ok: false,
            reason: "failed",
            message: "Couldn't open run r1: db closed",
        });
        expect(pushToast).toHaveBeenCalledWith({
            title: "Couldn't open run r1: db closed",
            message: "",
            level: "error",
        });
    });
});

describe("dag landing", () => {
    // Ctrl is the Windows peek key (ctrlheld.ts isPeekGesture), and the file's other suites restore darwin
    beforeEach(() => setPlatform("win32"));
    afterEach(() => {
        dismissDagModal();
        setPlatform("darwin");
    });

    // the dag names its owner, so the sheet underneath is the owner's whichever run asked
    it("opens the owner run's sheet and the modal on the dag, with the task selected", async () => {
        const model = makeModel();
        objects.set("dag:d1", { oid: "d1", runid: "r1", channelid: "c1" });
        objects.set("channel:c1", { oid: "c1" });
        expect(await openTarget(model, { kind: "dag", dagId: "d1", taskId: "t-2" })).toEqual({ ok: true });
        expect(globalStore.get(activeSubjectAtom)).toEqual({ kind: "channel", id: "c1" });
        expect(globalStore.get(activeRunIdAtom)["c1"]).toBe("r1");
        expect(globalStore.get(briefSheetOpenAtom)).toBe(true);
        expect(globalStore.get(model.surfaceAtom)).toBe("jarvis");
        expect(globalStore.get(dagModalStateAtom)).toEqual({
            kind: "live",
            channelId: "c1",
            runId: "r1",
            dagOref: "dag:d1",
            error: "",
        });
        expect(globalStore.get(selectedTaskIdAtom)).toBe("t-2");
    });

    it("opens the modal with nothing selected when no task is named", async () => {
        const model = makeModel();
        objects.set("dag:d1", { oid: "d1", runid: "r1", channelid: "c1" });
        objects.set("channel:c1", { oid: "c1" });
        expect(await openAddress(model, "dag:d1")).toEqual({ ok: true });
        expect(globalStore.get(dagModalStateAtom)).toMatchObject({ dagOref: "dag:d1" });
        expect(globalStore.get(selectedTaskIdAtom)).toBeNull();
    });

    it("reports a dag that no longer exists, and opens nothing", async () => {
        const model = makeModel();
        expect(await openTarget(model, { kind: "dag", dagId: "gone" })).toEqual({
            ok: false,
            reason: "unavailable",
            message: "That DAG no longer exists",
        });
        expect(globalStore.get(briefSheetOpenAtom)).toBe(false);
        expect(globalStore.get(dagModalStateAtom)).toBeNull();
        expect(globalStore.get(model.surfaceAtom)).toBe("cockpit");
    });

    it("peeks the owner run on Ctrl, and leaves the modal shut", async () => {
        const model = makeModel();
        objects.set("dag:d1", { oid: "d1", runid: "r1", channelid: "c1" });
        objects.set("run:r1", { oid: "r1", channeloid: "c1" });
        objects.set("channel:c1", { oid: "c1" });
        const event = { ctrlKey: true, preventDefault: vi.fn(), stopPropagation: vi.fn() };
        expect(await openOrPeek(model, { kind: "dag", dagId: "d1", taskId: "t-2" }, event)).toEqual({ ok: true });
        expect(globalStore.get(peekItemAtom)?.target).toEqual({ kind: "run", runId: "r1" });
        expect(globalStore.get(dagModalStateAtom)).toBeNull();
        expect(globalStore.get(model.surfaceAtom)).toBe("cockpit");
    });
});

describe("agent landing", () => {
    it("focuses an agent still in the roster", async () => {
        const model = makeModel(["t1"]);
        expect(await openAddress(model, "tab:t1")).toEqual({ ok: true });
        expect(globalStore.get(model.focusIdAtom)).toBe("t1");
        expect(globalStore.get(model.surfaceAtom)).toBe("agent");
    });

    it("reports an agent that has left the roster", async () => {
        const model = makeModel(["t1"]);
        expect(await openAddress(model, "agent:t2")).toEqual({
            ok: false,
            reason: "unavailable",
            message: "That agent session has ended",
        });
        expect(globalStore.get(model.surfaceAtom)).toBe("cockpit");
    });
});

describe("record landing", () => {
    it("opens a decision's record in the peek with the decision anchored", async () => {
        const model = makeModel();
        globalStore.set(taskListAtom, [{ id: "task-a" } as SpaceSummary]);
        expect(await openAddress(model, "task:task-a", { sourceType: "decision", anchor: "dec-1" })).toEqual({
            ok: true,
        });
        expect(globalStore.get(briefPeekRecordAtom)).toBe("task-a");
        expect(globalStore.get(pendingDecisionAnchorAtom)).toBe("dec-1");
        expect(globalStore.get(model.surfaceAtom)).toBe("jarvis");
        expect(rpc.ListTaskDossiersCommand).not.toHaveBeenCalled();
    });

    it("loads the record list before calling a record gone, and says so", async () => {
        const model = makeModel();
        rpc.ListTaskDossiersCommand.mockResolvedValue({ dossiers: [{ id: "other" }] });
        expect(await openAddress(model, "task:task-a")).toEqual({
            ok: false,
            reason: "unavailable",
            message: "That record no longer exists",
        });
        expect(rpc.ListTaskDossiersCommand).toHaveBeenCalled();
        expect(globalStore.get(briefPeekRecordAtom)).toBeNull();
        expect(globalStore.get(model.surfaceAtom)).toBe("cockpit");
    });

    // the list loads once per Brief mount, so a record created since is not in it yet
    it("refreshes a loaded list once before calling a record gone", async () => {
        const model = makeModel();
        globalStore.set(taskListAtom, [{ id: "old" } as SpaceSummary]);
        rpc.ListTaskDossiersCommand.mockResolvedValue({ dossiers: [{ id: "old" }, { id: "task-new" }] });
        expect(await openAddress(model, "task:task-new")).toEqual({ ok: true });
        expect(globalStore.get(briefPeekRecordAtom)).toBe("task-new");
    });

    it("reports a list that failed to load as a failure, not as a missing record", async () => {
        const model = makeModel();
        rpc.ListTaskDossiersCommand.mockRejectedValue(new Error("vault locked"));
        const result = await openAddress(model, "task:task-a");
        expect(result.ok).toBe(false);
        expect("reason" in result ? result.reason : null).toBe("failed");
        expect("reason" in result ? result.message : "").toContain("record task-a");
    });

    it("a record target opens the Brief peek", async () => {
        const model = makeModel();
        globalStore.set(taskListAtom, [{ id: "task-a" } as SpaceSummary]);
        rpc.GetDossierCommand.mockResolvedValue({ id: "task-a", status: "active", decisions: [] });
        expect(await openTarget(model, { kind: "record", dossierId: "task-a" })).toEqual({ ok: true });
        expect(globalStore.get(briefPeekRecordAtom)).toBe("task-a");
        expect(globalStore.get(model.surfaceAtom)).toBe("jarvis");
        await vi.waitFor(() => expect(globalStore.get(recordDetailAtom)["task-a"]).toBeDefined());
    });
});

// a note has no surface, so opening one peeks it: a plain click and wsh ui reveal both show the popup
describe("memory note landing", () => {
    it("opens a note as a ready peek, writing no selection", async () => {
        for (const open of [
            (model: AgentsViewModel) => openTarget(model, { kind: "note", noteId: "n1" }),
            (model: AgentsViewModel) => openAddress(model, "memnote:n1"),
        ]) {
            const model = makeModel();
            rpc.ReadVaultNoteCommand.mockResolvedValue({ id: "n1", title: "n1", body: "", updated: 1 });
            seedSelections(model);
            globalStore.set(peekItemAtom, null);
            globalStore.set(petPeekOpenAtom, false);
            const before = selections(model);

            expect(await open(model)).toEqual({ ok: true });

            expect(selections(model)).toEqual(before);
            expect(globalStore.get(peekItemAtom)).toEqual({
                target: { kind: "note", noteId: "n1" },
                status: "ready",
            });
            expect(globalStore.get(petPeekOpenAtom)).toBe(true);
            expect(rpc.ReadVaultNoteCommand).toHaveBeenLastCalledWith({}, { id: "n1" });
        }
    });

    it("says a missing note no longer exists and opens nothing", async () => {
        const model = makeModel();
        rpc.ReadVaultNoteCommand.mockRejectedValue(new Error('wavevault: node "n-gone" not in scope'));
        expect(await openTarget(model, { kind: "note", noteId: "n-gone" })).toEqual({
            ok: false,
            reason: "unavailable",
            message: "That note no longer exists",
        });
        expect(pushToast).toHaveBeenCalledWith({ title: "That note no longer exists", message: "", level: "warn" });
        expect(globalStore.get(peekItemAtom)).toBeNull();
        expect(globalStore.get(petPeekOpenAtom)).toBe(false);
        expect(globalStore.get(model.surfaceAtom)).toBe("cockpit");
    });
});

describe("effort landing", () => {
    it("opens the initiative's sheet", async () => {
        const model = makeModel();
        rpc.EffortGetCommand.mockResolvedValue({ effort: { oid: "e-1" } });
        expect(await openAddress(model, "effort:e-1")).toEqual({ ok: true });
        expect(globalStore.get(activeSubjectAtom)).toEqual({ kind: "effort", id: "e-1" });
        expect(globalStore.get(briefSheetOpenAtom)).toBe(true);
        expect(globalStore.get(model.surfaceAtom)).toBe("jarvis");
    });

    // a plan-review item whose agent has closed opens its initiative: the sheet's plan keeps the Proposed group's
    // Accept and Drop (spec decision 7), so it opens in the sheet like any other
    it("opens an initiative with a plan to review in the sheet, on its plan", async () => {
        const model = makeModel();
        const chunks = [
            { label: "Spec", status: "done" },
            { label: "Radial layout model", status: "proposed" },
        ];
        rpc.EffortGetCommand.mockResolvedValue({ effort: { oid: "e-1", chunks } });
        expect(await openAddress(model, "effort:e-1")).toEqual({ ok: true });
        expect(globalStore.get(briefSheetOpenAtom)).toBe(true);
        expect(globalStore.get(activeSubjectAtom)).toEqual({ kind: "effort", id: "e-1" });
        expect(globalStore.get(initiativeSheetAtom)).toEqual({ view: "plan", chunk: null });
        expect(globalStore.get(model.surfaceAtom)).toBe("jarvis");
    });

    it("opens the sheet on the initiative's Activity feed when asked for it", async () => {
        const model = makeModel();
        rpc.EffortGetCommand.mockResolvedValue({
            effort: { oid: "e-1", chunks: [{ label: "Radial layout model", status: "proposed" }] },
        });
        expect(await openTarget(model, { kind: "effort", effortId: "e-1", view: "activity" })).toEqual({ ok: true });
        expect(globalStore.get(activeSubjectAtom)).toEqual({ kind: "effort", id: "e-1" });
        expect(globalStore.get(briefSheetOpenAtom)).toBe(true);
        expect(globalStore.get(initiativeSheetAtom)).toEqual({ view: "activity", chunk: null });
    });

    it("starts the sheet on the plan again when another initiative opens after the feed", async () => {
        const model = makeModel();
        rpc.EffortGetCommand.mockResolvedValue({ effort: { oid: "e-1" } });
        await openTarget(model, { kind: "effort", effortId: "e-1", view: "activity" });
        rpc.EffortGetCommand.mockResolvedValue({ effort: { oid: "e-2" } });
        expect(await openAddress(model, "effort:e-2")).toEqual({ ok: true });
        expect(globalStore.get(activeSubjectAtom)).toEqual({ kind: "effort", id: "e-2" });
        expect(globalStore.get(initiativeSheetAtom)).toEqual({ view: "plan", chunk: null });
    });

    it("reports an initiative the store cannot find, instead of opening an empty sheet", async () => {
        const model = makeModel();
        rpc.EffortGetCommand.mockRejectedValue(new Error("effort e-gone: not found"));
        expect(await openAddress(model, "effort:e-gone")).toEqual({
            ok: false,
            reason: "unavailable",
            message: "That initiative no longer exists",
        });
        expect(globalStore.get(briefSheetOpenAtom)).toBe(false);
        expect(globalStore.get(activeSubjectAtom)).toBeNull();
        expect(globalStore.get(model.surfaceAtom)).toBe("cockpit");
    });

    it("reports an initiative whose fetch returns nothing", async () => {
        const model = makeModel();
        expect(await openAddress(model, "effort:e-none")).toEqual({
            ok: false,
            reason: "unavailable",
            message: "That initiative no longer exists",
        });
        expect(globalStore.get(briefSheetOpenAtom)).toBe(false);
    });
});

describe("memory hygiene landing", () => {
    const projects = (...names: string[]) => ({ projects: names.map((project) => ({ project })) });

    it("writes the Memory tab and the project before it switches to Setup", async () => {
        const model = makeModel();
        rpc.ListMemoryHygieneCommand.mockResolvedValue(projects("other", "a:b"));
        globalStore.set(memorySelectedChangeAtom, "c-old");
        let atSwitch: unknown = null;
        const unsub = globalStore.sub(model.surfaceAtom, () => {
            atSwitch = {
                tab: globalStore.get(setupTabAtom),
                project: globalStore.get(memorySelectedProjectAtom),
                change: globalStore.get(memorySelectedChangeAtom),
            };
        });
        expect(await openAddress(model, "memhygiene:a:b")).toEqual({ ok: true });
        unsub();
        expect(atSwitch).toEqual({ tab: "memory", project: "a:b", change: null });
        expect(globalStore.get(model.surfaceAtom)).toBe("setup");
    });

    it("refuses a project that is not registered, and switches nothing", async () => {
        const model = makeModel();
        rpc.ListMemoryHygieneCommand.mockResolvedValue(projects("other"));
        expect(await openAddress(model, "memhygiene:gone")).toEqual({
            ok: false,
            reason: "unavailable",
            message: "gone is not a registered project",
        });
        expect(globalStore.get(model.surfaceAtom)).toBe("cockpit");
        expect(globalStore.get(setupTabAtom)).toBe("instructions");
        expect(globalStore.get(memorySelectedProjectAtom)).toBeNull();
    });

    it("says the list failed rather than that the project is missing", async () => {
        const model = makeModel();
        rpc.ListMemoryHygieneCommand.mockRejectedValue(new Error("EC-TIME"));
        expect(await openAddress(model, "memhygiene:waveterm")).toEqual({
            ok: false,
            reason: "failed",
            message: "Couldn't open memory of waveterm: EC-TIME",
        });
        expect(globalStore.get(model.surfaceAtom)).toBe("cockpit");
    });

    it("is not peekable: a peek lands", async () => {
        const model = makeModel();
        rpc.ListMemoryHygieneCommand.mockResolvedValue(projects("waveterm"));
        const target: OpenTarget = { kind: "memhygiene", project: "waveterm" };
        expect(isPeekable(target)).toBe(false);
        expect(await peekTarget(model, target)).toEqual({ ok: true });
        expect(globalStore.get(model.surfaceAtom)).toBe("setup");
        expect(globalStore.get(peekItemAtom)).toBeNull();
    });
});

describe("council landings", () => {
    it("opens the council's Discussion in the Agent surface", async () => {
        const model = makeModel();
        globalStore.set(centerModeAtom, "terminal");
        globalStore.set(councilSelAtom, null);
        globalStore.set(councilViewAtom, "summary");
        expect(await openAddress(model, "council:c-1")).toEqual({ ok: true });
        expect(globalStore.get(councilSelAtom)).toBe("c-1");
        expect(globalStore.get(councilViewAtom)).toBe("discussion");
        expect(globalStore.get(centerModeAtom)).toBe("council");
        expect(globalStore.get(model.surfaceAtom)).toBe("agent");
    });

    it("opens a council on its report when the target names the summary", async () => {
        const model = makeModel();
        globalStore.set(centerModeAtom, "terminal");
        globalStore.set(councilSelAtom, null);
        globalStore.set(councilViewAtom, "discussion");
        expect(await openTarget(model, { kind: "council", councilId: "c-1", view: "summary" })).toEqual({ ok: true });
        expect(globalStore.get(councilSelAtom)).toBe("c-1");
        expect(globalStore.get(councilViewAtom)).toBe("summary");
        expect(globalStore.get(centerModeAtom)).toBe("council");
        expect(globalStore.get(model.surfaceAtom)).toBe("agent");
    });

    it("opens a council on its default view when the target names none", async () => {
        const model = makeModel();
        globalStore.set(councilViewAtom, "summary");
        expect(await openTarget(model, { kind: "council", councilId: "c-2" })).toEqual({ ok: true });
        expect(globalStore.get(councilViewAtom)).toBe("discussion");
    });

    describe("by whether the Agent tree still lists the council (openCouncil)", () => {
        const DAY = 24 * 60 * 60 * 1000;
        const known = (id: string, over: Partial<Council> = {}): Council =>
            ({
                id,
                project: "/work/a",
                feature: "F",
                experts: [],
                state: "done",
                round: 3,
                updated: Date.now() - 2 * DAY,
                summary: { text: "t", directions: [], outcomes: {}, at: Date.now() - 2 * DAY },
                ...over,
            }) as Council;

        beforeEach(() => {
            globalStore.set(centerModeAtom, "terminal");
            globalStore.set(councilSelAtom, null);
            globalStore.set(councilViewAtom, "discussion");
            globalStore.set(libraryTabAtom, "conversations");
            globalStore.set(libraryCouncilSelAtom, null);
            globalStore.set(libraryCouncilViewAtom, "discussion");
            // a council never opened counts as opened now, so a day-old one is read and has left the tree
            globalStore.set(councilOpenedAtom, { seededAt: Date.now(), opened: {} });
        });
        afterEach(() => {
            for (const id of ["c-run", "c-old"]) {
                globalStore.set(councilAtom(id), null);
                globalStore.set(councilLastViewAtom(id), null);
            }
        });

        it("opens a running council on Agent's council mode", async () => {
            const model = makeModel();
            globalStore.set(councilAtom("c-run"), known("c-run", { state: "running" }));
            expect(await openAddress(model, "council:c-run")).toEqual({ ok: true });
            expect(globalStore.get(councilSelAtom)).toBe("c-run");
            expect(globalStore.get(centerModeAtom)).toBe("council");
            expect(globalStore.get(model.surfaceAtom)).toBe("agent");
            expect(globalStore.get(libraryCouncilSelAtom)).toBeNull();
        });

        it("opens a council that left the tree in Library's Councils tab, on the view the target names", async () => {
            const model = makeModel();
            // with no summary its default view is the Discussion, so landing on the summary is the target's doing
            globalStore.set(councilAtom("c-old"), known("c-old", { summary: undefined }));
            expect(await openTarget(model, { kind: "council", councilId: "c-old", view: "summary" })).toEqual({
                ok: true,
            });
            expect(globalStore.get(libraryCouncilSelAtom)).toBe("c-old");
            expect(globalStore.get(libraryCouncilViewAtom)).toBe("summary");
            expect(globalStore.get(libraryTabAtom)).toBe("councils");
            expect(globalStore.get(model.surfaceAtom)).toBe("library");
            // Agent's own selection and centre are left as they were
            expect(globalStore.get(councilSelAtom)).toBeNull();
            expect(globalStore.get(centerModeAtom)).toBe("terminal");
        });
    });

    it("is not peekable: a peek lands", async () => {
        const model = makeModel();
        const target: OpenTarget = { kind: "council", councilId: "c-1" };
        expect(isPeekable(target)).toBe(false);
        expect(await peekTarget(model, target)).toEqual({ ok: true });
        expect(globalStore.get(model.surfaceAtom)).toBe("agent");
        expect(globalStore.get(peekItemAtom)).toBeNull();
    });
});

describe("board landings", () => {
    const board = (over: Partial<BoardInfo> = {}): BoardInfo => ({
        id: "b1",
        name: "wavesrv-startup",
        project: "arcterm",
        path: "/data/boards/arcterm/b1.excalidraw",
        createdts: 1,
        activets: 2,
        agenttabid: "t1",
        agenttitle: "claude · startup",
        ...over,
    });

    beforeEach(() => {
        globalStore.set(libraryBoardSelAtom, null);
        globalStore.set(libraryTabAtom, "conversations");
    });

    it("opens a board beside the Chat of its agent while the agent is in the roster", async () => {
        const model = makeModel(["t1"]);
        rpc.BoardListCommand.mockResolvedValue({ boards: [board()] });
        expect(await openAddress(model, "board:arcterm/b1")).toEqual({ ok: true });
        expect(rpc.BoardListCommand).toHaveBeenCalledWith(expect.anything(), { project: "arcterm" });
        expect(openBoardSpy).toHaveBeenCalledTimes(1);
        expect(openBoardSpy).toHaveBeenCalledWith(model, "t1", "arcterm", "b1");
        // Library stays as it was
        expect(globalStore.get(libraryBoardSelAtom)).toBeNull();
        expect(globalStore.get(libraryTabAtom)).toBe("conversations");
    });

    it("counts a sleeping agent: its tab is in the roster", async () => {
        const asleep = {
            id: "t1",
            name: "t1",
            task: "",
            state: "idle",
            blockId: "block-t1",
            sleeping: { since: 1, freedBytes: 0 },
        } as AgentVM;
        const model = { ...makeModel(), agentsAtom: atom([asleep]) } as unknown as AgentsViewModel;
        rpc.BoardListCommand.mockResolvedValue({ boards: [board()] });
        expect(await openTarget(model, { kind: "board", project: "arcterm", boardId: "b1" })).toEqual({ ok: true });
        expect(openBoardSpy).toHaveBeenCalledWith(model, "t1", "arcterm", "b1");
    });

    it("opens a board whose agent ended in Library's Boards tab", async () => {
        const model = makeModel(["t9"]);
        rpc.BoardListCommand.mockResolvedValue({ boards: [board()] });
        expect(await openTarget(model, { kind: "board", project: "arcterm", boardId: "b1" })).toEqual({ ok: true });
        expect(openBoardSpy).not.toHaveBeenCalled();
        expect(globalStore.get(libraryBoardSelAtom)).toEqual({ project: "arcterm", boardId: "b1" });
        expect(globalStore.get(libraryTabAtom)).toBe("boards");
        expect(globalStore.get(model.surfaceAtom)).toBe("library");
        expect(globalStore.get(model.focusIdAtom)).toBeUndefined();
    });

    it("opens a board tied to no agent in Library too", async () => {
        const model = makeModel(["t1"]);
        rpc.BoardListCommand.mockResolvedValue({ boards: [board({ agenttabid: undefined })] });
        expect(await openAddress(model, "board:arcterm/b1")).toEqual({ ok: true });
        expect(openBoardSpy).not.toHaveBeenCalled();
        expect(globalStore.get(libraryTabAtom)).toBe("boards");
    });

    it("reports a board the project no longer holds, and goes nowhere", async () => {
        const model = makeModel(["t1"]);
        rpc.BoardListCommand.mockResolvedValue({ boards: [board({ id: "other" })] });
        expect(await openAddress(model, "board:arcterm/b1")).toEqual({
            ok: false,
            reason: "unavailable",
            message: "That board no longer exists",
        });
        expect(openBoardSpy).not.toHaveBeenCalled();
        expect(globalStore.get(model.surfaceAtom)).toBe("cockpit");
        expect(globalStore.get(libraryBoardSelAtom)).toBeNull();
    });

    it("reports a board list that cannot be read", async () => {
        const model = makeModel(["t1"]);
        rpc.BoardListCommand.mockRejectedValue(new Error("wavesrv is down"));
        expect(await openAddress(model, "board:arcterm/b1")).toEqual({
            ok: false,
            reason: "failed",
            message: "Couldn't open board b1: wavesrv is down",
        });
        expect(globalStore.get(model.surfaceAtom)).toBe("cockpit");
    });

    it("is not peekable: a peek lands", async () => {
        const model = makeModel(["t9"]);
        rpc.BoardListCommand.mockResolvedValue({ boards: [board()] });
        const target: OpenTarget = { kind: "board", project: "arcterm", boardId: "b1" };
        expect(isPeekable(target)).toBe(false);
        expect(await peekTarget(model, target)).toEqual({ ok: true });
        expect(globalStore.get(model.surfaceAtom)).toBe("library");
        expect(globalStore.get(peekItemAtom)).toBeNull();
    });
});

describe("workflow scan landings", () => {
    // a model whose roster holds one agent, working for the given run
    function modelWithAgentOf(runId: string): AgentsViewModel {
        const agent = {
            id: "t-scan",
            name: "t-scan",
            task: "",
            state: "working",
            blockId: "block-t-scan",
            runId,
        } as AgentVM;
        return { ...makeModel(), agentsAtom: atom([agent]) } as unknown as AgentsViewModel;
    }

    it("lands on the scan run's live agent, without loading the run", async () => {
        const model = modelWithAgentOf("r-scan");
        expect(await openAddress(model, "workflowscan:r-scan")).toEqual({ ok: true });
        expect(globalStore.get(model.focusIdAtom)).toBe("t-scan");
        expect(globalStore.get(model.surfaceAtom)).toBe("agent");
        expect(globalStore.get(briefSheetOpenAtom)).toBe(false);
        expect(loadAndPin).not.toHaveBeenCalled();
    });

    it("lands on the run's own sheet when the run has no live agent", async () => {
        const model = makeModel(["t1"]);
        objects.set("run:r-scan", { oid: "r-scan", channeloid: "c1" });
        objects.set("channel:c1", { oid: "c1" });
        expect(await openTarget(model, { kind: "workflowscan", runId: "r-scan" })).toEqual({ ok: true });
        expect(globalStore.get(activeSubjectAtom)).toEqual({ kind: "channel", id: "c1" });
        expect(globalStore.get(activeRunIdAtom)["c1"]).toBe("r-scan");
        expect(globalStore.get(briefSheetOpenAtom)).toBe(true);
        expect(globalStore.get(model.surfaceAtom)).toBe("jarvis");
        expect(globalStore.get(model.focusIdAtom)).toBeUndefined();
    });

    it("does not take another run's agent for the scan's", async () => {
        const model = modelWithAgentOf("r-other");
        objects.set("run:r-scan", { oid: "r-scan", channeloid: "c1" });
        objects.set("channel:c1", { oid: "c1" });
        expect(await openTarget(model, { kind: "workflowscan", runId: "r-scan" })).toEqual({ ok: true });
        expect(globalStore.get(model.focusIdAtom)).toBeUndefined();
        expect(globalStore.get(model.surfaceAtom)).toBe("jarvis");
        expect(globalStore.get(activeRunIdAtom)["c1"]).toBe("r-scan");
    });

    it("reports a run that is gone, when it has no agent either", async () => {
        const model = makeModel();
        expect(await openAddress(model, "workflowscan:r-gone")).toEqual({
            ok: false,
            reason: "unavailable",
            message: "That run no longer exists",
        });
        expect(globalStore.get(model.surfaceAtom)).toBe("cockpit");
    });

    it("is not peekable: a peek lands", async () => {
        const model = modelWithAgentOf("r-scan");
        const target: OpenTarget = { kind: "workflowscan", runId: "r-scan" };
        expect(isPeekable(target)).toBe(false);
        expect(await peekTarget(model, target)).toEqual({ ok: true });
        expect(globalStore.get(model.surfaceAtom)).toBe("agent");
        expect(globalStore.get(peekItemAtom)).toBeNull();
    });

    it("is not peekable from an address either", () => {
        expect(isPeekableAddress("workflowscan:r-scan")).toBe(false);
    });
});

describe("a newer open", () => {
    it("supersedes a landing still loading, which then writes and reports nothing", async () => {
        const model = makeModel(["t1"]);
        const slow = deferred<unknown>();
        objects.set("channel:c1", { oid: "c1" });
        loadAndPin.mockImplementation((oref: string) =>
            oref === "run:r-slow" ? slow.promise : Promise.resolve(objects.get(oref) ?? null)
        );
        const first = openTarget(model, { kind: "run", runId: "r-slow" });
        expect(await openTarget(model, { kind: "agent", tabId: "t1" })).toEqual({ ok: true });

        slow.resolve({ oid: "r-slow", channeloid: "c1" });
        expect(await first).toEqual({ ok: false, reason: "superseded", message: "" });
        expect(globalStore.get(model.surfaceAtom)).toBe("agent");
        expect(globalStore.get(briefSheetOpenAtom)).toBe(false);
        expect(rpc.GetChannelRunsCommand).not.toHaveBeenCalled();
        expect(pushToast).not.toHaveBeenCalled();
    });

    it("includes a click on an address nothing can open", async () => {
        const model = makeModel();
        const slow = deferred<unknown>();
        loadAndPin.mockImplementation(() => slow.promise);
        const first = openTarget(model, { kind: "run", runId: "r-slow" });
        await openAddress(model, "bogus:x");
        slow.resolve({ oid: "r-slow", channeloid: "c1" });
        expect(await first).toEqual({ ok: false, reason: "superseded", message: "" });
        expect(globalStore.get(model.surfaceAtom)).toBe("cockpit");
    });
});

describe("unsupported addresses", () => {
    it("reports an address nothing can open, and stays put", async () => {
        const model = makeModel();
        expect(await openAddress(model, "bogus:x")).toEqual({
            ok: false,
            reason: "unsupported",
            message: "This item can't be opened",
        });
        expect(pushToast).toHaveBeenCalledWith({ title: "This item can't be opened", message: "", level: "warn" });
        expect(globalStore.get(model.surfaceAtom)).toBe("cockpit");
    });

    it("hands the result to a caller that renders failure itself, instead of toasting", async () => {
        const model = makeModel();
        const report = vi.fn();
        await openAddress(model, "vault:dec-1", { sourceType: "decision" }, report);
        expect(report).toHaveBeenCalledWith({
            ok: false,
            reason: "unsupported",
            message: "This citation can't locate its record",
        });
        expect(pushToast).not.toHaveBeenCalled();
    });
});

describe("canvas landing", () => {
    const CWD = "C:\\p";
    const DIR = "C:\\p\\.superpowers\\design\\t";
    const caller = { blockId: "block-a1", cwd: CWD };
    const noReport = () => {};

    afterEach(() => {
        for (const id of ["a1", "a2", "t9"]) {
            detachCanvas(id);
        }
    });

    it("refuses a caller that is no roster agent, and changes nothing", async () => {
        const model = makeModel(["a1"]);
        const result = await openAddress(model, "canvas:t", { caller: { ...caller, blockId: "block-x" } }, noReport);
        expect("reason" in result ? result.reason : null).toBe("unavailable");
        expect("reason" in result ? result.message : "").toContain("wsh ui reveal canvas:t");
        expect(globalStore.get(model.surfaceAtom)).toBe("cockpit");
        expect(getCanvas("a1")).toBeNull();
        expect(rpc.FileInfoCommand).not.toHaveBeenCalled();
    });

    it("refuses a caller whose working directory is unknown", async () => {
        const model = makeModel(["a1"]);
        const result = await openAddress(model, "canvas:t", { caller: { ...caller, cwd: "" } }, noReport);
        expect("reason" in result ? result.message : "").toContain("wsh ui reveal canvas:t");
        expect(getCanvas("a1")).toBeNull();
    });

    it("refuses a canvas folder that does not exist, naming it", async () => {
        const model = makeModel(["a1"]);
        rpc.FileInfoCommand.mockResolvedValue({ notfound: true });
        const result = await openAddress(model, "canvas:t", { caller }, noReport);
        expect("reason" in result ? result.reason : null).toBe("unavailable");
        expect("reason" in result ? result.message : "").toContain(`${DIR}\\project`);
        expect(rpc.FileInfoCommand).toHaveBeenCalledWith(expect.anything(), {
            info: { path: `${DIR}\\project` },
        });
        expect(getCanvas("a1")).toBeNull();
        expect(globalStore.get(model.surfaceAtom)).toBe("cockpit");
    });

    it("attaches the caller's canvas without moving the user or leaving the terminal", async () => {
        const model = makeModel(["a1", "a2"]);
        globalStore.set(model.focusIdAtom, "a2");
        rpc.FileInfoCommand.mockResolvedValue({ path: "x" });
        expect(await openAddress(model, "canvas:t", { caller }, noReport)).toEqual({ ok: true });
        const s = getCanvas("a1");
        expect(s?.topic).toBe("t");
        expect(s?.dir).toBe(DIR);
        expect(s?.projectDir).toBe(CWD);
        expect(s?.mode).toBe("terminal");
        expect(globalStore.get(model.focusIdAtom)).toBe("a2");
        expect(globalStore.get(model.surfaceAtom)).toBe("cockpit");
    });

    it("leaves a canvas the user is already looking at in canvas mode", async () => {
        const model = makeModel(["a1"]);
        rpc.FileInfoCommand.mockResolvedValue({ path: "x" });
        attachCanvas("a1", { topic: "t", dir: DIR, projectDir: CWD });
        setCanvasMode("a1", "canvas", 2);
        expect(await openAddress(model, "canvas:t", { caller }, noReport)).toEqual({ ok: true });
        expect(getCanvas("a1")?.mode).toBe("canvas");
    });

    it("attaches a background terminal as readily as an agent", async () => {
        const model = makeModel(["a1"], ["t9"]);
        rpc.FileInfoCommand.mockResolvedValue({ path: "x" });
        const result = await openAddress(model, "canvas:t", { caller: { ...caller, blockId: "block-t9" } }, noReport);
        expect(result).toEqual({ ok: true });
        expect(getCanvas("t9")?.topic).toBe("t");
    });

    it("sets the board a reveal names", async () => {
        const model = makeModel(["a1"]);
        rpc.FileInfoCommand.mockResolvedValue({ path: "x" });
        expect(await openAddress(model, "canvas:t/States", { caller }, noReport)).toEqual({ ok: true });
        expect(getCanvas("a1")?.board).toBe("States.dc.html");
    });

    it("without a caller, lands on the agent that already has the canvas", async () => {
        const model = makeModel(["a1", "a2"]);
        attachCanvas("a2", { topic: "t", dir: DIR, projectDir: CWD });
        expect(await openAddress(model, "canvas:t", undefined, noReport)).toEqual({ ok: true });
        expect(getCanvas("a2")?.mode).toBe("canvas");
        expect(globalStore.get(model.focusIdAtom)).toBe("a2");
        expect(globalStore.get(model.surfaceAtom)).toBe("agent");
        expect(rpc.FileInfoCommand).not.toHaveBeenCalled();
    });

    it("without a caller, an owner or a selected agent, asks for an agent to open it on", async () => {
        const model = makeModel(["a1"]);
        expect(await openAddress(model, "canvas:t", undefined, noReport)).toEqual({
            ok: false,
            reason: "unavailable",
            message: "Select an agent to open the canvas t on",
        });
        expect(globalStore.get(model.surfaceAtom)).toBe("cockpit");
        expect(rpc.FileInfoCommand).not.toHaveBeenCalled();
    });

    it("without a caller or an owner, opens the canvas on the selected agent from its folder", async () => {
        const model = makeModel(["a1", "a2"]);
        globalStore.set(model.focusIdAtom, "a2");
        resolveCwd.mockResolvedValue(CWD);
        rpc.FileInfoCommand.mockResolvedValue({ path: "x" });
        expect(await openAddress(model, "canvas:t/States", undefined, noReport)).toEqual({ ok: true });
        expect(resolveCwd).toHaveBeenCalledWith(undefined, "block-a2");
        expect(rpc.FileInfoCommand).toHaveBeenCalledWith(expect.anything(), { info: { path: `${DIR}\\project` } });
        const s = getCanvas("a2");
        expect(s?.dir).toBe(DIR);
        expect(s?.projectDir).toBe(CWD);
        expect(s?.board).toBe("States.dc.html");
        expect(s?.mode).toBe("canvas");
        expect(getCanvas("a1")).toBeNull();
        expect(globalStore.get(model.surfaceAtom)).toBe("agent");
    });

    it("without a caller or an owner, refuses a selected agent with no canvas of that name", async () => {
        const model = makeModel(["a1"]);
        globalStore.set(model.focusIdAtom, "a1");
        resolveCwd.mockResolvedValue(CWD);
        rpc.FileInfoCommand.mockResolvedValue({ notfound: true });
        const result = await openAddress(model, "canvas:t", undefined, noReport);
        expect("reason" in result ? result.message : "").toBe(`No canvas at ${DIR}\\project`);
        expect(getCanvas("a1")).toBeNull();
        expect(globalStore.get(model.surfaceAtom)).toBe("cockpit");
    });

    it("without a caller or an owner, refuses a selected agent whose folder is unknown", async () => {
        const model = makeModel(["a1"]);
        globalStore.set(model.focusIdAtom, "a1");
        resolveCwd.mockResolvedValue(null);
        const result = await openAddress(model, "canvas:t", undefined, noReport);
        expect("reason" in result ? result.reason : null).toBe("unavailable");
        expect(rpc.FileInfoCommand).not.toHaveBeenCalled();
        expect(getCanvas("a1")).toBeNull();
    });

    it("refuses a target built in code with a path in its topic", async () => {
        const model = makeModel(["a1"]);
        rpc.FileInfoCommand.mockResolvedValue({ path: "x" });
        const result = await openTarget(model, { kind: "canvas", topic: ".." }, noReport, caller);
        expect(result.ok).toBe(false);
        expect(rpc.FileInfoCommand).not.toHaveBeenCalled();
        expect(getCanvas("a1")).toBeNull();
    });
});

describe("brainstorm landing", () => {
    const CWD = "C:\\p";
    const PATH = "C:\\p\\.superpowers\\brainstorm\\lag\\brainstorm.json";
    const caller = { blockId: "block-a1", cwd: CWD };
    const noReport = () => {};

    afterEach(() => {
        for (const id of ["a1", "a2", "t9"]) {
            detachBrainstorm(id);
        }
    });

    it("refuses a brainstorm file that does not exist, naming it", async () => {
        const model = makeModel(["a1"]);
        rpc.FileInfoCommand.mockResolvedValue({ notfound: true });
        const result = await openAddress(model, "brainstorm:lag", { caller }, noReport);
        expect(result).toEqual({ ok: false, reason: "unavailable", message: `No brainstorm at ${PATH}` });
        expect(rpc.FileInfoCommand).toHaveBeenCalledWith(expect.anything(), { info: { path: PATH } });
        expect(getBrainstorm("a1")).toBeNull();
        expect(rpc.SetMetaCommand).not.toHaveBeenCalled();
    });

    it("attaches the caller's brainstorm in terminal mode without moving the user, and records it on the tab", async () => {
        const model = makeModel(["a1", "a2"]);
        globalStore.set(model.focusIdAtom, "a2");
        rpc.FileInfoCommand.mockResolvedValue({ path: PATH });
        rpc.SetMetaCommand.mockResolvedValue(undefined);
        expect(await openAddress(model, "brainstorm:lag", { caller }, noReport)).toEqual({ ok: true });
        expect(getBrainstorm("a1")).toMatchObject({ topic: "lag", path: PATH, cwd: CWD, mode: "terminal" });
        expect(globalStore.get(model.focusIdAtom)).toBe("a2");
        expect(globalStore.get(model.surfaceAtom)).toBe("cockpit");
        expect(rpc.SetMetaCommand).toHaveBeenCalledWith(expect.anything(), {
            oref: "tab:a1",
            meta: { "session:brainstorm": PATH },
        });
    });

    it("reads the brainstorm file on each reveal instead of waiting for the next poll", async () => {
        const model = makeModel(["a1"]);
        const text = (title: string) =>
            JSON.stringify({
                v: 1,
                title,
                spec: "",
                question: null,
                working: null,
                parts: [],
                history: [],
                done: false,
            });
        rpc.SetMetaCommand.mockResolvedValue(undefined);
        rpc.FileInfoCommand.mockResolvedValue({ path: PATH, modtime: 1 });
        rpc.FileReadCommand.mockResolvedValue({ data64: btoa(text("first")) });
        await openAddress(model, "brainstorm:lag", { caller }, noReport);
        await vi.waitFor(() => expect(getBrainstorm("a1")?.file?.title).toBe("first"));
        rpc.FileInfoCommand.mockResolvedValue({ path: PATH, modtime: 2 });
        rpc.FileReadCommand.mockResolvedValue({ data64: btoa(text("second")) });
        await openAddress(model, "brainstorm:lag", { caller }, noReport);
        await vi.waitFor(() => expect(getBrainstorm("a1")?.file?.title).toBe("second"));
    });

    it("still attaches when the tab meta write fails", async () => {
        const model = makeModel(["a1"]);
        rpc.FileInfoCommand.mockResolvedValue({ path: PATH });
        rpc.SetMetaCommand.mockRejectedValue(new Error("no route"));
        const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
        expect(await openAddress(model, "brainstorm:lag", { caller }, noReport)).toEqual({ ok: true });
        expect(getBrainstorm("a1")?.topic).toBe("lag");
        expect(warn).toHaveBeenCalled();
        warn.mockRestore();
    });

    it("attaches a background terminal as readily as an agent", async () => {
        const model = makeModel(["a1"], ["t9"]);
        rpc.FileInfoCommand.mockResolvedValue({ path: PATH });
        rpc.SetMetaCommand.mockResolvedValue(undefined);
        const result = await openAddress(
            model,
            "brainstorm:lag",
            { caller: { ...caller, blockId: "block-t9" } },
            noReport
        );
        expect(result).toEqual({ ok: true });
        expect(getBrainstorm("t9")?.topic).toBe("lag");
    });

    it("refuses a caller that is no roster agent, and changes nothing", async () => {
        const model = makeModel(["a1"]);
        const result = await openAddress(
            model,
            "brainstorm:lag",
            { caller: { ...caller, blockId: "block-x" } },
            noReport
        );
        expect("reason" in result ? result.reason : null).toBe("unavailable");
        expect("reason" in result ? result.message : "").toContain("wsh ui reveal brainstorm:lag");
        expect(getBrainstorm("a1")).toBeNull();
        expect(rpc.FileInfoCommand).not.toHaveBeenCalled();
    });

    it("without a caller, lands on the agent that has the brainstorm, in brainstorm mode", async () => {
        const model = makeModel(["a1", "a2"]);
        attachBrainstorm("a2", { topic: "lag", cwd: CWD }, 1);
        expect(await openAddress(model, "brainstorm:lag", undefined, noReport)).toEqual({ ok: true });
        expect(getBrainstorm("a2")?.mode).toBe("brainstorm");
        expect(globalStore.get(model.focusIdAtom)).toBe("a2");
        expect(globalStore.get(model.surfaceAtom)).toBe("agent");
        expect(rpc.FileInfoCommand).not.toHaveBeenCalled();
    });

    it("without a caller or an owner, says no agent has it open", async () => {
        const model = makeModel(["a1"]);
        expect(await openAddress(model, "brainstorm:lag", undefined, noReport)).toEqual({
            ok: false,
            reason: "unavailable",
            message: "No agent has the brainstorm lag open",
        });
        expect(globalStore.get(model.surfaceAtom)).toBe("cockpit");
    });

    it("refuses a target built in code with a path in its topic", async () => {
        const model = makeModel(["a1"]);
        const result = await openTarget(model, { kind: "brainstorm", topic: ".." }, noReport, caller);
        expect(result.ok).toBe(false);
        expect(rpc.FileInfoCommand).not.toHaveBeenCalled();
        expect(getBrainstorm("a1")).toBeNull();
    });

    it("is not peekable: a peek opens it", async () => {
        const model = makeModel(["a1"]);
        attachBrainstorm("a1", { topic: "lag", cwd: CWD }, 1);
        expect(isPeekable({ kind: "brainstorm", topic: "lag" })).toBe(false);
        expect(await peekTarget(model, { kind: "brainstorm", topic: "lag" })).toEqual({ ok: true });
        expect(globalStore.get(model.surfaceAtom)).toBe("agent");
        expect(globalStore.get(peekItemAtom)).toBeNull();
    });
});

// every atom an open writes to land somewhere; a peek must leave each one where it was
function selections(model: AgentsViewModel) {
    return {
        sheetOpen: globalStore.get(briefSheetOpenAtom),
        subject: globalStore.get(activeSubjectAtom),
        runIds: globalStore.get(activeRunIdAtom),
        channel: globalStore.get(activeChannelIdAtom),
        record: globalStore.get(briefPeekRecordAtom),
        anchor: globalStore.get(pendingDecisionAnchorAtom),
        focus: globalStore.get(model.focusIdAtom),
        surface: globalStore.get(model.surfaceAtom),
    };
}

// priors that are not the defaults, so a write of the default would still show
function seedSelections(model: AgentsViewModel): void {
    globalStore.set(briefSheetOpenAtom, false);
    globalStore.set(activeSubjectAtom, { kind: "channel", id: "c-prior" });
    globalStore.set(activeRunIdAtom, { "c-prior": "r-prior" });
    globalStore.set(activeChannelIdAtom, "c-prior");
    globalStore.set(briefPeekRecordAtom, "task-prior");
    globalStore.set(pendingDecisionAnchorAtom, "dec-prior");
    globalStore.set(model.focusIdAtom, "t0");
    globalStore.set(model.surfaceAtom, "code");
}

type PeekCase = { kind: string; arrange: () => void; target: OpenTarget; shown: PeekItem["target"] };

const LOADABLE: PeekCase[] = [
    {
        kind: "run",
        arrange: () => {
            objects.set("run:r1", { oid: "r1", channeloid: "c1" });
            objects.set("channel:c1", { oid: "c1" });
        },
        target: { kind: "run", runId: "r1" },
        shown: { kind: "run", runId: "r1" },
    },
    {
        kind: "channel",
        arrange: () => {
            objects.set("channel:c1", { oid: "c1" });
            objects.set("run:r-new", { oid: "r-new", channeloid: "c1" });
            rpc.GetChannelRunsCommand.mockResolvedValue({
                runs: [
                    { id: "r-old", createdts: 1 },
                    { id: "r-new", createdts: 2 },
                ],
            });
        },
        target: { kind: "channel", channelId: "c1" },
        shown: { kind: "run", runId: "r-new" },
    },
    {
        kind: "agent",
        arrange: () => {},
        target: { kind: "agent", tabId: "t1" },
        shown: { kind: "agent", tabId: "t1" },
    },
    {
        kind: "record",
        arrange: () => globalStore.set(taskListAtom, [{ id: "task-a" } as SpaceSummary]),
        target: { kind: "record", dossierId: "task-a", anchor: "dec-1" },
        shown: { kind: "record", dossierId: "task-a", anchor: "dec-1" },
    },
    {
        kind: "effort",
        arrange: () => rpc.EffortGetCommand.mockResolvedValue({ effort: { oid: "e-1" } }),
        target: { kind: "effort", effortId: "e-1" },
        shown: { kind: "effort", effortId: "e-1" },
    },
    {
        kind: "note",
        arrange: () => rpc.ReadVaultNoteCommand.mockResolvedValue({ id: "n1", title: "n1", body: "", updated: 1 }),
        target: { kind: "note", noteId: "n1" },
        shown: { kind: "note", noteId: "n1" },
    },
];

const UNLOADABLE: { kind: string; arrange: () => void; target: OpenTarget; message: string }[] = [
    { kind: "run", arrange: () => {}, target: { kind: "run", runId: "r-gone" }, message: "That run no longer exists" },
    {
        kind: "channel",
        arrange: () => objects.set("channel:c1", { oid: "c1" }),
        target: { kind: "channel", channelId: "c1" },
        message: "That channel has no run to peek",
    },
    {
        kind: "agent",
        arrange: () => {},
        target: { kind: "agent", tabId: "t-gone" },
        message: "That agent session has ended",
    },
    {
        kind: "record",
        arrange: () => rpc.ListTaskDossiersCommand.mockResolvedValue({ dossiers: [{ id: "other" }] }),
        target: { kind: "record", dossierId: "task-gone" },
        message: "That record no longer exists",
    },
    {
        kind: "effort",
        arrange: () => rpc.EffortGetCommand.mockRejectedValue(new Error("not found")),
        target: { kind: "effort", effortId: "e-gone" },
        message: "That initiative no longer exists",
    },
    {
        kind: "note",
        arrange: () => rpc.ReadVaultNoteCommand.mockRejectedValue(new Error("not in scope")),
        target: { kind: "note", noteId: "n-gone" },
        message: "That note no longer exists",
    },
];

const FROM = [
    { from: "closed" as const, popupOpen: false },
    { from: "hub" as const, popupOpen: true },
];

describe("peek", () => {
    for (const c of LOADABLE) {
        for (const { from, popupOpen } of FROM) {
            it(`shows a ${c.kind} in the popup from ${from}, writing no selection`, async () => {
                const model = makeModel(["t1"]);
                c.arrange();
                seedSelections(model);
                globalStore.set(petPeekOpenAtom, popupOpen);
                const before = selections(model);

                expect(await peekTarget(model, c.target)).toEqual({ ok: true });

                expect(selections(model)).toEqual(before);
                expect(globalStore.get(peekItemAtom)).toEqual({ target: c.shown, status: "ready" });
                expect(globalStore.get(petPeekOpenAtom)).toBe(true);
                expect(pushToast).not.toHaveBeenCalled();
            });
        }
    }

    for (const c of UNLOADABLE) {
        for (const { from, popupOpen } of FROM) {
            it(`says a ${c.kind} cannot be peeked and leaves the popup ${from}`, async () => {
                const model = makeModel(["t1"]);
                c.arrange();
                seedSelections(model);
                globalStore.set(petPeekOpenAtom, popupOpen);
                const before = selections(model);

                expect(await peekTarget(model, c.target)).toEqual({
                    ok: false,
                    reason: "unavailable",
                    message: c.message,
                });

                expect(pushToast).toHaveBeenCalledWith({ title: c.message, message: "", level: "warn" });
                expect(globalStore.get(peekItemAtom)).toBeNull();
                expect(globalStore.get(petPeekOpenAtom)).toBe(popupOpen);
                expect(selections(model)).toEqual(before);
            });
        }
    }

    it("opens the popup on a loading item before the load lands", async () => {
        const model = makeModel();
        const slow = deferred<unknown>();
        objects.set("channel:c1", { oid: "c1" });
        loadAndPin.mockImplementation((oref: string) =>
            oref === "run:r1" ? slow.promise : Promise.resolve(objects.get(oref) ?? null)
        );
        const peeking = peekTarget(model, { kind: "run", runId: "r1" });
        expect(globalStore.get(peekItemAtom)).toEqual({
            target: { kind: "run", runId: "r1" },
            status: "loading",
        });
        expect(globalStore.get(petPeekOpenAtom)).toBe(true);
        slow.resolve({ oid: "r1", channeloid: "c1" });
        expect(await peeking).toEqual({ ok: true });
        expect(globalStore.get(peekItemAtom)?.status).toBe("ready");
    });

    it("peeks the run a channel target names", async () => {
        const model = makeModel();
        objects.set("run:r1", { oid: "r1", channeloid: "c1" });
        objects.set("channel:c1", { oid: "c1" });
        expect(await peekTarget(model, { kind: "channel", channelId: "c1", runId: "r1" })).toEqual({ ok: true });
        expect(globalStore.get(peekItemAtom)?.target).toEqual({ kind: "run", runId: "r1" });
        expect(rpc.GetChannelRunsCommand).not.toHaveBeenCalled();
    });

    it("a failed peek over an item already shown puts that item back", async () => {
        const model = makeModel(["t1"]);
        const shown: PeekItem = { target: { kind: "agent", tabId: "t1" }, status: "ready" };
        globalStore.set(peekItemAtom, shown);
        globalStore.set(petPeekOpenAtom, true);
        await peekTarget(model, { kind: "run", runId: "r-gone" });
        expect(globalStore.get(peekItemAtom)).toEqual(shown);
        expect(globalStore.get(petPeekOpenAtom)).toBe(true);
    });

    it("keeps only the later of two peeks, and says nothing about the first", async () => {
        const model = makeModel(["t1"]);
        const slow = deferred<unknown>();
        loadAndPin.mockImplementation((oref: string) =>
            oref === "run:r-slow" ? slow.promise : Promise.resolve(objects.get(oref) ?? null)
        );
        const first = peekTarget(model, { kind: "run", runId: "r-slow" });
        expect(await peekTarget(model, { kind: "agent", tabId: "t1" })).toEqual({ ok: true });

        // gone by the time it lands: a current peek would toast this
        slow.resolve(null);
        expect(await first).toEqual({ ok: false, reason: "superseded", message: "" });
        expect(globalStore.get(peekItemAtom)).toEqual({
            target: { kind: "agent", tabId: "t1" },
            status: "ready",
        });
        expect(globalStore.get(petPeekOpenAtom)).toBe(true);
        expect(pushToast).not.toHaveBeenCalled();
    });

    it("an open started while a peek loads clears the loading item", async () => {
        const model = makeModel(["t1"]);
        const slow = deferred<unknown>();
        objects.set("channel:c1", { oid: "c1" });
        loadAndPin.mockImplementation((oref: string) =>
            oref === "run:r-slow" ? slow.promise : Promise.resolve(objects.get(oref) ?? null)
        );
        const peeking = peekTarget(model, { kind: "run", runId: "r-slow" });
        expect(globalStore.get(peekItemAtom)?.status).toBe("loading");

        expect(await openTarget(model, { kind: "agent", tabId: "t1" })).toEqual({ ok: true });
        expect(globalStore.get(peekItemAtom)).toBeNull();
        expect(globalStore.get(petPeekOpenAtom)).toBe(false);

        slow.resolve({ oid: "r-slow", channeloid: "c1" });
        expect(await peeking).toEqual({ ok: false, reason: "superseded", message: "" });
        expect(globalStore.get(peekItemAtom)).toBeNull();
        expect(globalStore.get(petPeekOpenAtom)).toBe(false);
        expect(globalStore.get(model.surfaceAtom)).toBe("agent");
    });

    it("a dead address clears a peek still loading", async () => {
        const model = makeModel();
        const slow = deferred<unknown>();
        loadAndPin.mockImplementation(() => slow.promise);
        const peeking = peekTarget(model, { kind: "run", runId: "r-slow" });
        expect(await peekAddress(model, "bogus:x")).toEqual({
            ok: false,
            reason: "unsupported",
            message: "This item can't be opened",
        });
        expect(globalStore.get(peekItemAtom)).toBeNull();
        expect(globalStore.get(petPeekOpenAtom)).toBe(false);
        slow.resolve(null);
        expect(await peeking).toEqual({ ok: false, reason: "superseded", message: "" });
    });

    it("hands a canvas to openTarget: there is nothing to peek", async () => {
        const model = makeModel(["a1"]);
        attachCanvas("a1", { topic: "t", dir: "C:\\p\\t", projectDir: "C:\\p" });
        expect(isPeekable({ kind: "canvas", topic: "t" })).toBe(false);
        expect(await peekTarget(model, { kind: "canvas", topic: "t" })).toEqual({ ok: true });
        expect(globalStore.get(model.surfaceAtom)).toBe("agent");
        expect(globalStore.get(peekItemAtom)).toBeNull();
        detachCanvas("a1");
    });
});

describe("openOrPeek", () => {
    const gesture = (ctrlKey: boolean, metaKey = false) => ({
        ctrlKey,
        metaKey,
        preventDefault: vi.fn(),
        stopPropagation: vi.fn(),
    });
    // Ctrl is the Windows peek key; a Mac's is Command (ctrlheld.ts isPeekGesture)
    beforeEach(() => setPlatform("win32"));
    afterEach(() => setPlatform("darwin"));

    it("peeks on Command on a Mac, where Ctrl+click is the right click", async () => {
        setPlatform("darwin");
        const model = makeModel(["t1"]);
        const cmd = gesture(false, true);
        expect(await openOrPeek(model, { kind: "agent", tabId: "t1" }, cmd)).toEqual({ ok: true });
        expect(globalStore.get(peekItemAtom)?.target).toEqual({ kind: "agent", tabId: "t1" });
        expect(cmd.preventDefault).toHaveBeenCalled();

        const ctrl = gesture(true);
        expect(await openOrPeekAddress(model, "tab:t1", ctrl)).toEqual({ ok: true });
        expect(globalStore.get(model.surfaceAtom)).toBe("agent");
        expect(ctrl.preventDefault).not.toHaveBeenCalled();
    });

    it("peeks on Ctrl and consumes the click", async () => {
        const model = makeModel(["t1"]);
        const event = gesture(true);
        expect(await openOrPeek(model, { kind: "agent", tabId: "t1" }, event)).toEqual({ ok: true });
        expect(globalStore.get(peekItemAtom)?.target).toEqual({ kind: "agent", tabId: "t1" });
        expect(globalStore.get(model.surfaceAtom)).toBe("cockpit");
        expect(event.preventDefault).toHaveBeenCalled();
        expect(event.stopPropagation).toHaveBeenCalled();
    });

    it("opens without Ctrl and leaves the click alone", async () => {
        const model = makeModel(["t1"]);
        const event = gesture(false);
        expect(await openOrPeek(model, { kind: "agent", tabId: "t1" }, event)).toEqual({ ok: true });
        expect(globalStore.get(model.surfaceAtom)).toBe("agent");
        expect(globalStore.get(peekItemAtom)).toBeNull();
        expect(event.preventDefault).not.toHaveBeenCalled();
        expect(event.stopPropagation).not.toHaveBeenCalled();
    });

    it("opens a canvas even with Ctrl", async () => {
        const model = makeModel(["a1"]);
        attachCanvas("a1", { topic: "t", dir: "C:\\p\\t", projectDir: "C:\\p" });
        const event = gesture(true);
        expect(await openOrPeek(model, { kind: "canvas", topic: "t" }, event)).toEqual({ ok: true });
        expect(globalStore.get(model.surfaceAtom)).toBe("agent");
        expect(globalStore.get(peekItemAtom)).toBeNull();
        expect(event.preventDefault).not.toHaveBeenCalled();
        detachCanvas("a1");
    });

    it("does the same for an address", async () => {
        const model = makeModel(["t1"]);
        const ctrl = gesture(true);
        expect(await openOrPeekAddress(model, "tab:t1", ctrl)).toEqual({ ok: true });
        expect(globalStore.get(peekItemAtom)?.target).toEqual({ kind: "agent", tabId: "t1" });
        expect(globalStore.get(model.surfaceAtom)).toBe("cockpit");
        expect(ctrl.stopPropagation).toHaveBeenCalled();

        const plain = gesture(false);
        expect(await openOrPeekAddress(model, "tab:t1", plain)).toEqual({ ok: true });
        expect(globalStore.get(model.surfaceAtom)).toBe("agent");
        expect(plain.stopPropagation).not.toHaveBeenCalled();
    });
});
